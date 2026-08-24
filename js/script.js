/* =====================================================================
   CONFIG — thresholds are general defaults, calibrate to your instrument
   ===================================================================== */
const CONFIG = {
  independentAccuracy: 0.97,
  instructionalAccuracy: 0.90,
  mispronunciationThreshold: 0.4,
  disruptionThresholdPer100: 8,
  gradeBenchmarks: { 'Grade 1': 50, 'Grade 2': 70, 'Grade 3': 90 }, // approx. wcpm, general reference — replace with your study's norms
};
const LANG_CODES = { en: 'en-US', fil: 'fil-PH' };

const SAMPLE_PASSAGES = {
  en: {
    'Grade 1': "Ana has a small black cat. The cat likes to sleep in the sun. Every day, Ana gives the cat some milk.",
    'Grade 2': "Every morning, Miguel walks to school with his sister Lina. On the way, they pass a small bakery. The warm smell of fresh bread makes them hungry. Miguel always waves at Mang Jose, the baker, and Mang Jose waves back with a big smile.",
    'Grade 3': "On Saturday morning, Ana and her mother walk to the market near their house. The market is busy and full of colors. Vendors call out the prices of fresh fish, ripe mangoes, and sweet bananas. Ana always carries the small basket while her mother carries the big one. By the time they get home, the sun is already high in the sky.",
  },
  fil: {
    'Grade 1': "May alagang pusa si Ana. Itim ang balahibo ng kanyang pusa. Araw-araw, binibigyan ni Ana ng gatas ang kanyang pusa.",
    'Grade 2': "Tuwing umaga, naglalakad si Miguel papuntang paaralan kasama ang kapatid niyang si Lina. Sa daan, dumadaan sila sa isang maliit na panaderya. Ang mainit na amoy ng sariwang tinapay ay nagpapagutom sa kanila. Kinakaway lagi ni Miguel si Mang Jose, ang panadero, at kinakaway rin siya nito nang may malaking ngiti.",
    'Grade 3': "Tuwing Sabado, naglalakad papunta sa palengke sina Ana at ang kanyang ina. Masigla at makulay ang palengke. Sumisigaw ang mga tindero habang inaanunsyo ang presyo ng sariwang isda, hinog na mangga, at matamis na saging. Lagi nang dala ni Ana ang maliit na basket, habang ang ina niya ang may dalang malaki. Pagdating nila sa bahay, mataas na ang araw sa langit.",
  },
};

/* =====================================================================
   CORE ALGORITHM — tokenization, Levenshtein alignment, decision tree
   (validated separately against a battery of miscue scenarios)
   ===================================================================== */
function tokenize(text) {
  return text.trim().split(/\s+/).filter(Boolean)
    .map((raw) => ({ raw, norm: raw.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '') }))
    .filter((w) => w.norm.length > 0);
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function alignWords(refTokens, hypTokens) {
  const m = refTokens.length, n = hypTokens.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  const bt = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(null));
  for (let i = 0; i <= m; i++) { dp[i][0] = i; if (i > 0) bt[i][0] = 'del'; }
  for (let j = 0; j <= n; j++) { dp[0][j] = j; if (j > 0) bt[0][j] = 'ins'; }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const isMatch = refTokens[i - 1].norm === hypTokens[j - 1].norm;
      const subCost = dp[i - 1][j - 1] + (isMatch ? 0 : 1);
      const delCost = dp[i - 1][j] + 1;
      const insCost = dp[i][j - 1] + 1;
      let best = subCost, op = isMatch ? 'match' : 'sub';
      if (delCost < best) { best = delCost; op = 'del'; }
      if (insCost < best) { best = insCost; op = 'ins'; }
      dp[i][j] = best; bt[i][j] = op;
    }
  }
  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    const op = bt[i][j];
    if (op === 'match' || op === 'sub') { ops.unshift({ op, ref: refTokens[i - 1], hyp: hypTokens[j - 1] }); i--; j--; }
    else if (op === 'del') { ops.unshift({ op, ref: refTokens[i - 1], hyp: null }); i--; }
    else { ops.unshift({ op, ref: null, hyp: hypTokens[j - 1] }); j--; }
  }
  return ops;
}

function annotate(ops, config) {
  for (const o of ops) {
    if (o.op === 'sub') {
      const d = levenshtein(o.ref.norm, o.hyp.norm);
      const normDist = d / Math.max(o.ref.norm.length, o.hyp.norm.length, 1);
      o.charDistance = d;
      o.subType = normDist <= config.mispronunciationThreshold ? 'mispronunciation' : 'substitution';
    }
  }
  const findNearestRef = (from, step) => {
    for (let k = from; k >= 0 && k < ops.length; k += step) if (ops[k].ref) return ops[k].ref;
    return null;
  };
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].op !== 'ins') continue;
    const prevRef = findNearestRef(k - 1, -1), nextRef = findNearestRef(k + 1, 1);
    if ((prevRef && prevRef.norm === ops[k].hyp.norm) || (nextRef && nextRef.norm === ops[k].hyp.norm)) ops[k].op = 'rep';
  }
  return ops;
}

function computeMetrics(ops, elapsedSeconds) {
  const totalWords = ops.filter((o) => o.ref).length;
  const correctWords = ops.filter((o) => o.op === 'match').length;
  const mispronunciations = ops.filter((o) => o.op === 'sub' && o.subType === 'mispronunciation').length;
  const substitutions = ops.filter((o) => o.op === 'sub' && o.subType === 'substitution').length;
  const omissions = ops.filter((o) => o.op === 'del').length;
  const insertions = ops.filter((o) => o.op === 'ins').length;
  const repetitions = ops.filter((o) => o.op === 'rep').length;
  const elapsedMinutes = Math.max(elapsedSeconds / 60, 1 / 60);
  const accuracy = totalWords ? correctWords / totalWords : 0;
  const wcpm = correctWords / elapsedMinutes;
  return { totalWords, correctWords, mispronunciations, substitutions, omissions, insertions, repetitions, elapsedSeconds, elapsedMinutes, accuracy, wcpm };
}

function classifyDifficulty(metrics, config) {
  const { accuracy, wcpm, mispronunciations, substitutions, omissions, insertions, repetitions, totalWords } = metrics;
  const benchmark = config.wcpmBenchmark;
  const pct = (x) => Math.round(x * 100);

  if (accuracy >= config.independentAccuracy) {
    const disruptions = insertions + repetitions;
    const disruptionPer100 = totalWords ? (disruptions / totalWords) * 100 : 0;
    const meetsRate = wcpm >= benchmark;
    const highDisruption = disruptionPer100 > config.disruptionThresholdPer100;
    const rateNote = meetsRate ? '' : ` Rate (${Math.round(wcpm)} wcpm) is also below the ${benchmark} wcpm benchmark.`;

    if (meetsRate && !highDisruption) {
      return { type: 'No Significant Reading Difficulty', band: 'Independent',
        explanation: `Accuracy is ${pct(accuracy)}% (at or above the ${pct(config.independentAccuracy)}% independent threshold) and rate is ${Math.round(wcpm)} wcpm (at or above the ${benchmark} wcpm benchmark).` };
    }
    if (highDisruption && repetitions >= insertions) {
      return { type: 'Dysfluency / Repetition Difficulty', band: 'Independent accuracy, frequent repetition',
        explanation: `Word recognition is accurate (${pct(accuracy)}%) but words are repeated often (${repetitions} repetitions / ${totalWords} words) — a sign of halting, dysfluent reading despite correct word recognition.${rateNote}` };
    }
    if (highDisruption) {
      return { type: 'Self-Monitoring Difficulty (Insertions)', band: 'Independent accuracy, frequent insertions',
        explanation: `Word recognition is accurate (${pct(accuracy)}%) but extra words are frequently added (${insertions} insertions / ${totalWords} words), suggesting guessing or impulsive reading rather than careful tracking of the text.${rateNote}` };
    }
    return { type: 'Fluency / Reading Rate Difficulty', band: 'Independent accuracy, below-benchmark rate',
      explanation: `Accuracy is high (${pct(accuracy)}%) but rate is ${Math.round(wcpm)} wcpm, below the ${benchmark} wcpm benchmark for this grade level — accurate but slow or effortful reading.` };
  }

  if (accuracy >= config.instructionalAccuracy) {
    const counts = {
      'Decoding / Phonics Difficulty': mispronunciations,
      'Word Recognition Difficulty': substitutions,
      'Tracking / Omission Difficulty': omissions,
      'Self-Monitoring Difficulty (Insertions)': insertions,
      'Dysfluency / Repetition Difficulty': repetitions,
    };
    const [label, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const rateNote = wcpm < benchmark ? ` Rate (${Math.round(wcpm)} wcpm) is also below the ${benchmark} wcpm benchmark.` : '';
    return { type: count > 0 ? label : 'Mixed Instructional-Level Difficulty', band: 'Instructional',
      explanation: `Accuracy is ${pct(accuracy)}%, in the instructional range. The most frequent miscue type is ${label.toLowerCase()} (${count} of ${totalWords} words).${rateNote}` };
  }

  return { type: 'Frustration-Level / Multiple Reading Difficulties', band: 'Frustration',
    explanation: `Accuracy is ${pct(accuracy)}%, below the ${pct(config.instructionalAccuracy)}% instructional threshold, with errors spread across several miscue types. This passage is likely too difficult for independent or guided reading right now; consider an easier passage and a fuller follow-up assessment.` };
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* =====================================================================
   STATE + DOM refs
   ===================================================================== */
const state = { lang: 'en', grade: 'Grade 2', source: 'sample', passageText: '', learnerName: '' };

const el = (id) => document.getElementById(id);
const stepperEl = el('stepper');
const samplePreview = el('samplePreview');
const customWrap = el('customWrap');
const samplePreviewWrap = el('samplePreviewWrap');
const passageHint = el('passageHint');

function updateSamplePreview() {
  samplePreview.textContent = SAMPLE_PASSAGES[state.lang][state.grade];
}
updateSamplePreview();

function wireSegmented(id, onPick) {
  const wrap = el(id);
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    [...wrap.children].forEach((b) => b.classList.toggle('active', b === btn));
    onPick(btn.dataset.value);
  });
}
wireSegmented('langSeg', (v) => { state.lang = v; updateSamplePreview(); });
wireSegmented('gradeSeg', (v) => { state.grade = v; updateSamplePreview(); });
wireSegmented('sourceSeg', (v) => {
  state.source = v;
  const isSample = v === 'sample';
  samplePreviewWrap.style.display = isSample ? '' : 'none';
  customWrap.style.display = isSample ? 'none' : '';
  passageHint.style.display = isSample ? '' : 'none';
});

function goToStage(name) {
  ['setup', 'read', 'report'].forEach((s) => { el('stage-' + s).hidden = s !== name; });
  [...stepperEl.children].forEach((li) => {
    const step = li.dataset.step;
    li.classList.toggle('active', step === name);
    li.classList.toggle('done', ['setup', 'read', 'report'].indexOf(step) < ['setup', 'read', 'report'].indexOf(name));
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

el('beginBtn').addEventListener('click', () => {
  const custom = el('customPassage').value.trim();
  state.passageText = state.source === 'sample' ? SAMPLE_PASSAGES[state.lang][state.grade] : custom;
  state.learnerName = el('learnerName').value.trim();

  if (!state.passageText || tokenize(state.passageText).length < 3) {
    el('customPassage').style.borderColor = 'var(--red)';
    if (state.source !== 'custom') { el('sourceSeg').querySelector('[data-value="custom"]').click(); }
    el('customPassage').focus();
    return;
  }
  el('readPassageText').textContent = state.passageText;
  resetReadStage();
  goToStage('read');
});

el('backToSetup').addEventListener('click', () => { stopSession(true); goToStage('setup'); });

/* =====================================================================
   WEB SPEECH API — recognition + live audio level ring
   ===================================================================== */
const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null, listening = false, stopping = false, fatalError = false;
let startTime = 0, endTime = 0, timerInterval = null, stopSafetyTimer = null;
let finalChunks = [];
let audioStream = null, audioCtx = null, analyser = null, meterRAF = null;

const micBtn = el('micBtn'), micIcon = el('micIcon'), micRing = el('micRing'), micStatus = el('micStatus');
const timerEl = el('timer'), transcriptBox = el('transcriptBox'), readBanner = el('readBanner');

function showBanner(msg) { readBanner.textContent = msg; readBanner.hidden = false; }
function clearBanner() { readBanner.hidden = true; readBanner.textContent = ''; }

function resetReadStage() {
  clearBanner();
  transcriptBox.textContent = '';
  timerEl.textContent = '00:00';
  finalChunks = [];
  setMicUIState('idle');
  if (!SpeechRecognitionImpl) {
    showBanner('This browser does not support live speech recognition. Open this page in Chrome or Edge (desktop or Android) to run a reading session.');
    micBtn.disabled = true;
  } else {
    micBtn.disabled = false;
  }
}

function setMicUIState(uiState) {
  if (uiState === 'listening') {
    micBtn.classList.add('recording'); micRing.classList.add('listening');
    micIcon.outerHTML = '<svg id="micIcon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';
    micStatus.textContent = 'Listening…';
  } else if (uiState === 'processing') {
    micBtn.disabled = true;
    micStatus.textContent = 'Finishing up…';
  } else {
    micBtn.disabled = !SpeechRecognitionImpl;
    micBtn.classList.remove('recording'); micRing.classList.remove('listening');
    micRing.style.setProperty('--level', 0);
    document.getElementById('micIcon') && (document.getElementById('micIcon').outerHTML =
      '<svg id="micIcon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"></rect><path d="M5 10a7 7 0 0 0 14 0"></path><line x1="12" y1="17" x2="12" y2="21"></line><line x1="8" y1="21" x2="16" y2="21"></line></svg>');
    micStatus.textContent = 'Ready when you are';
  }
}

function updateTimer() {
  const secs = Math.floor((Date.now() - startTime) / 1000);
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  timerEl.textContent = `${mm}:${ss}`;
}

async function startAudioMeter() {
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(audioStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    drawMeter();
  } catch (e) { /* non-fatal: the ring just won't animate with live level */ }
}
function drawMeter() {
  if (!listening || !analyser) return;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  micRing.style.setProperty('--level', Math.min(avg / 85, 1).toFixed(2));
  meterRAF = requestAnimationFrame(drawMeter);
}
function cleanupMeter() {
  if (meterRAF) cancelAnimationFrame(meterRAF);
  meterRAF = null;
  if (audioStream) { audioStream.getTracks().forEach((t) => t.stop()); audioStream = null; }
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  analyser = null;
}

function startSession() {
  if (!SpeechRecognitionImpl) return;
  clearBanner();
  fatalError = false; stopping = false; finalChunks = [];
  recognition = new SpeechRecognitionImpl();
  recognition.lang = LANG_CODES[state.lang];
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalChunks.push(chunk); else interim += chunk;
    }
    transcriptBox.textContent = (finalChunks.join(' ') + ' ' + interim).trim();
    transcriptBox.scrollTop = transcriptBox.scrollHeight;
  };

  recognition.onerror = (event) => {
    const err = event.error;
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      fatalError = true; listening = false;
      showBanner('Microphone access was blocked. Allow microphone access for this page (check the icon in your browser\u2019s address bar), then try again.');
      setMicUIState('idle'); clearInterval(timerInterval);
    } else if (err === 'audio-capture') {
      fatalError = true; listening = false;
      showBanner('No microphone was found. Connect a microphone and try again.');
      setMicUIState('idle'); clearInterval(timerInterval);
    } else if (err === 'no-speech') {
      // benign — keep going
    } else if (err === 'network') {
      showBanner('Speech recognition needs an internet connection. Check the connection and try again.');
    }
  };

  recognition.onend = () => {
    if (stopping) { forceFinalize(); return; }
    if (listening && !fatalError) { try { recognition.start(); } catch (e) {} }
    else { setMicUIState('idle'); }
  };

  listening = true;
  startTime = Date.now();
  timerInterval = setInterval(updateTimer, 500);
  try {
    recognition.start();
    setMicUIState('listening');
    startAudioMeter();
  } catch (e) {
    listening = false;
    showBanner('Could not start the microphone. Please try again.');
  }
}

function stopSession(silent) {
  if (!listening || stopping) { if (silent) hardReset(); return; }
  stopping = true;
  clearInterval(timerInterval);
  endTime = Date.now();
  setMicUIState('processing');
  cleanupMeter();
  try { recognition.stop(); } catch (e) { forceFinalize(); return; }
  clearTimeout(stopSafetyTimer);
  stopSafetyTimer = setTimeout(forceFinalize, 3000);
  if (silent) suppressReport = true;
}
let suppressReport = false;
function hardReset() {
  listening = false; stopping = false; fatalError = false;
  clearInterval(timerInterval); cleanupMeter();
  if (recognition) { try { recognition.onend = null; recognition.stop(); } catch (e) {} }
}

function forceFinalize() {
  if (!stopping) return;
  stopping = false; listening = false;
  clearTimeout(stopSafetyTimer);
  if (suppressReport) { suppressReport = false; setMicUIState('idle'); return; }
  const elapsedSeconds = Math.max((endTime - startTime) / 1000, 0.1);
  const transcript = finalChunks.join(' ').trim();
  setMicUIState('idle');
  buildReport(transcript, elapsedSeconds);
  goToStage('report');
}

micBtn.addEventListener('click', () => { listening ? stopSession(false) : startSession(); });

/* =====================================================================
   REPORT RENDERING
   ===================================================================== */
const MISCUE_META = {
  match:   { label: 'Correct',        color: 'var(--ink-muted)' },
  sub:         { label: 'Substitution',   color: 'var(--red)' },
  mispron:     { label: 'Mispronunciation', color: 'var(--amber)' },
  del:     { label: 'Omission',       color: 'var(--ink-muted)' },
  ins:     { label: 'Insertion',      color: 'var(--amber)' },
  rep:     { label: 'Repetition',     color: 'var(--violet)' },
};

function renderRunningRecord(ops) {
  return ops.map((o, idx) => {
    const delay = Math.min(idx * 22, 900) + 'ms';
    if (o.op === 'match') return `<span class="w w-match" style="animation-delay:${delay}">${escapeHtml(o.ref.raw)}</span>`;
    if (o.op === 'sub') {
      const cls = o.subType === 'mispronunciation' ? 'w-mispron' : 'w-sub';
      return `<span class="w ${cls}" style="animation-delay:${delay}" title="Said: ${escapeHtml(o.hyp.raw)}"><span class="said">${escapeHtml(o.hyp.raw)}</span><span class="ref">${escapeHtml(o.ref.raw)}</span></span>`;
    }
    if (o.op === 'del') return `<span class="w w-omit" style="animation-delay:${delay}" title="Omitted"><span class="word">${escapeHtml(o.ref.raw)}</span></span>`;
    if (o.op === 'ins') return `<span class="w w-ins" style="animation-delay:${delay}" title="Inserted"><span class="plus">+</span>${escapeHtml(o.hyp.raw)}</span>`;
    if (o.op === 'rep') return `<span class="w w-rep" style="animation-delay:${delay}" title="Repeated"><span class="tag">R</span><span class="word">${escapeHtml(o.hyp.raw)}</span></span>`;
    return '';
  }).join(' ');
}

function buildReport(transcript, elapsedSeconds) {
  const wrap = el('reportContent');
  const refTokens = tokenize(state.passageText);
  const hypTokens = tokenize(transcript);

  if (hypTokens.length === 0) {
    wrap.innerHTML = `
      <div class="card" style="text-align:center; padding:44px 26px;">
        <h2 style="margin-bottom:10px;">No speech was captured</h2>
        <p style="color:var(--ink-soft); max-width:46ch; margin:0 auto 22px;">The microphone didn\u2019t pick up any recognizable speech during that session. Check the microphone and make sure the learner is reading at a normal volume, then try again.</p>
        <div class="btn-row" style="justify-content:center;">
          <button class="btn btn-primary" id="retryBtn">Try again</button>
        </div>
      </div>`;
    el('retryBtn').addEventListener('click', () => { resetReadStage(); goToStage('read'); });
    return;
  }

  const gradeBenchmark = CONFIG.gradeBenchmarks[state.grade];
  const runConfig = Object.assign({}, CONFIG, { wcpmBenchmark: gradeBenchmark });
  const ops = annotate(alignWords(refTokens, hypTokens), runConfig);
  const metrics = computeMetrics(ops, elapsedSeconds);
  const diagnosis = classifyDifficulty(metrics, runConfig);

  const mm = String(Math.floor(metrics.elapsedSeconds / 60)).padStart(2, '0');
  const ss = String(Math.round(metrics.elapsedSeconds % 60)).padStart(2, '0');
  const dateStr = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  wrap.innerHTML = `
    <div class="report-meta">
      ${state.learnerName ? `<span><strong>${escapeHtml(state.learnerName)}</strong></span>` : ''}
      <span>${state.lang === 'en' ? 'English' : 'Filipino'} passage</span>
      <span>${escapeHtml(state.grade)}</span>
      <span>${dateStr}</span>
    </div>

    <div class="card diagnosis-card">
      <div class="eyebrow">Diagnosis</div>
      <h2>${escapeHtml(diagnosis.type)}</h2>
      <span class="band">${escapeHtml(diagnosis.band)}</span>
      <p>${escapeHtml(diagnosis.explanation)}</p>
    </div>

    <div class="metrics-grid">
      <div class="metric"><div class="val">${Math.round(metrics.accuracy * 100)}%</div><div class="lbl">Accuracy</div></div>
      <div class="metric"><div class="val">${Math.round(metrics.wcpm)}</div><div class="lbl">Words / min</div></div>
      <div class="metric"><div class="val">${mm}:${ss}</div><div class="lbl">Time</div></div>
      <div class="metric"><div class="val">${metrics.correctWords}/${metrics.totalWords}</div><div class="lbl">Words correct</div></div>
    </div>

    <div class="miscue-bar">
      <span class="miscue-chip"><span class="dot" style="background:var(--amber)"></span>Mispronunciations: ${metrics.mispronunciations}</span>
      <span class="miscue-chip"><span class="dot" style="background:var(--red)"></span>Substitutions: ${metrics.substitutions}</span>
      <span class="miscue-chip"><span class="dot" style="background:var(--ink-muted)"></span>Omissions: ${metrics.omissions}</span>
      <span class="miscue-chip"><span class="dot" style="background:var(--amber)"></span>Insertions: ${metrics.insertions}</span>
      <span class="miscue-chip"><span class="dot" style="background:var(--violet)"></span>Repetitions: ${metrics.repetitions}</span>
    </div>

    <div class="card record-card" style="margin-top:18px;">
      <h3>Running record</h3>
      <p class="record-text">${renderRunningRecord(ops)}</p>
      <div class="legend">
        <span class="legend-item"><span class="legend-swatch" style="background:var(--amber-tint); border:1px solid var(--amber);"></span>Mispronunciation</span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--red-tint); border:1px solid var(--red);"></span>Substitution</span>
        <span class="legend-item"><span class="legend-swatch" style="border:1.5px dotted var(--ink-muted);"></span>Omission</span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--amber-tint);"></span>Insertion (+word)</span>
        <span class="legend-item"><span class="legend-swatch" style="border-bottom:2px solid var(--violet);"></span>Repetition (R)</span>
      </div>
    </div>

    <div class="btn-row">
      <button class="btn btn-primary" id="readAgainBtn">Read again</button>
      <button class="btn btn-secondary" id="newSessionBtn">New session</button>
      <button class="btn btn-secondary" id="printBtn">Print report</button>
    </div>
  `;

  el('readAgainBtn').addEventListener('click', () => { resetReadStage(); goToStage('read'); });
  el('newSessionBtn').addEventListener('click', () => goToStage('setup'));
  el('printBtn').addEventListener('click', () => window.print());
}

resetReadStage();