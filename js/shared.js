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
   CORE TOKENIZATION — used by both the Setup stage (validation) and the
   Diagnosis stage (alignment)
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

/* =====================================================================
   APP STATE + DOM helper — shared by every stage
   ===================================================================== */
const state = { lang: 'en', grade: 'Grade 2', source: 'sample', passageText: '', learnerName: '' };

const el = (id) => document.getElementById(id);
const stepperEl = el('stepper');

/* =====================================================================
   PAGE NAVIGATION — shared by every stage
   ===================================================================== */
function goToStage(name) {
  ['setup', 'read', 'report'].forEach((s) => { el('stage-' + s).hidden = s !== name; });
  [...stepperEl.children].forEach((li) => {
    const step = li.dataset.step;
    li.classList.toggle('active', step === name);
    li.classList.toggle('done', ['setup', 'read', 'report'].indexOf(step) < ['setup', 'read', 'report'].indexOf(name));
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}