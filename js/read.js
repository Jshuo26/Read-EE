/* =====================================================================
   STAGE 2: READ ALOUD — Web Speech API + live audio level ring
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

el('backToSetup').addEventListener('click', () => { stopSession(true); goToStage('setup'); });

resetReadStage();