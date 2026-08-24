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