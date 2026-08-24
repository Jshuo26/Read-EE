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