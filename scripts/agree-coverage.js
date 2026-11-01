// How often does alpha's likely range hold the real alpha? A simulation that compares the ranges
// on offer, to choose the one wfeval agree uses by evidence (docs/METRICS.md):
//
//   percentile     the middle 95% of alphas from a bootstrap over records (agreement.js)
//   BCa            bias-corrected and accelerated, from the same resamples, the acceleration from
//                  the jackknife over records (Efron 1987; Efron and Tibshirani 1993, ch. 14)
//   log jackknife  a normal range on log(1 - alpha) with the jackknife's standard error
//   Krippendorff   Krippendorff's own bootstrap, "Bootstrapping Distributions for Krippendorff's
//                  Alpha" (2006, revised 2016), the algorithm in KALPHA (Hayes and Krippendorff
//                  2007): it keeps D_e from the data and redraws only the pairs behind D_o. Each
//                  unit u draws m_u (m_u - 1) / 2 pairs uniformly from all the data's pairs and
//                  subtracts E(r) / (m_u - 1), E(r) = 2 delta / (n D_e). (The note's re-pick when a
//                  second pick repeats the first is left out: it is not clear what it repeats.)
//                  Nominal cells only.
// The first three come from bootstrapIntervals(), the code wfeval agree runs. Where BCa is
// undefined (every resample on one side of the estimate) it falls back to percentile; where the
// log range is undefined (a jackknife alpha of 1, or not measurable) the simulation uses percentile
// too, as the tool would.
//
// Data: graders label each record. A record has a true category; each grader gives it with chance
// 0.8, otherwise a category at random (nominal, 3 categories, the most common one at 50%, 80% or
// 95%). Values are missing at random (0% or 20%). The real alpha of the process is alpha on
// 200,000 records of it. Also two ordinal rows (5 levels, misses mostly by one level) and two set
// rows (6 codes; graders drop a true code at 15%, add another at 5%, Jaccard distance).
// Each cell: 300 data sets, each range from 1,000 resamples; coverage is the share of ranges that
// hold the real alpha (95% is right). Data sets with no range at all (trap M15: alpha 1, or every
// value but one the same) are counted and left out, for every method alike.
// Seeded: the same output every run. Takes a few minutes:  node scripts/agree-coverage.js
const { krippendorffAlpha, bootstrapIntervals } = require('../src/metrics/agreement.js');

function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = seeded(42);
const pick = weights => { let r = rand(), i = 0; while (i < weights.length - 1 && r >= weights[i]) { r -= weights[i]; i++; } return i; };

// One record's values from each grader, null where missing.
const MAKERS = {
  nominal: top => { const p = [top, (1 - top) * 0.6, (1 - top) * 0.4]; return g => { const t = pick(p); return () => (rand() < 0.8 ? t : Math.floor(rand() * 3)); }; },
  ordinal: () => g => { const t = pick([0.1, 0.2, 0.4, 0.2, 0.1]); return () => { const r = rand(); const v = r < 0.6 ? t : r < 0.9 ? t + (rand() < 0.5 ? -1 : 1) : Math.floor(rand() * 5); return Math.min(4, Math.max(0, v)); }; },
  jaccard: () => g => { const t = [0, 1, 2, 3, 4, 5].filter(() => rand() < 0.25); return () => [0, 1, 2, 3, 4, 5].filter(c => (t.includes(c) ? rand() >= 0.15 : rand() < 0.05)).map(String); },
};
function simulate(n, graders, missing, make) {
  return Array.from({ length: n }, () => { const value = make(); return Array.from({ length: graders }, () => (rand() < missing ? null : value())); });
}

// Krippendorff's bootstrap (nominal delta), as described above.
function krippendorffBootstrap(units, resamples) {
  const used = units.map(u => u.filter(v => v !== null)).filter(u => u.length >= 2);
  const point = krippendorffAlpha(units, { metric: 'nominal' });
  const n = point.values, De = point.expected;
  const E = [];
  for (const u of used) for (let i = 0; i < u.length; i++) for (let j = i + 1; j < u.length; j++) E.push(u[i] === u[j] ? 0 : 2 / (n * De));
  const alphas = [];
  for (let s = 0; s < resamples; s++) {
    let a = 1;
    for (const u of used) { const m = u.length; for (let k = 0; k < (m * (m - 1)) / 2; k++) a -= E[Math.floor(rand() * E.length)] / (m - 1); }
    alphas.push(Math.max(-1, a));
  }
  alphas.sort((x, y) => x - y);
  const q = p => alphas[Math.min(alphas.length - 1, Math.max(0, Math.floor(p * alphas.length)))];
  return { low: q(0.025), high: q(0.975) };
}

const CELLS = [];
for (const top of [0.5, 0.8, 0.95]) for (const graders of [2, 3, 5]) for (const n of [20, 50, 150]) for (const missing of [0, 0.2]) CELLS.push({ metric: 'nominal', top, graders, n, missing });
for (const metric of ['ordinal', 'jaccard']) for (const n of [20, 50]) CELLS.push({ metric, top: null, graders: 3, n, missing: 0.2 });
const DATASETS = 300, RESAMPLES = 1000;
const METHODS = ['percentile', 'bca', 'log_jackknife', 'krippendorff'];
const ORDER = [0, 1, 2, 3, 4];

const truthOf = new Map();
const rows = [];
console.log('| data | graders | records | missing | real alpha | sets | percentile | BCa | log jackknife | Krippendorff |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const c of CELLS) {
  const maker = MAKERS[c.metric](c.top);
  const opts = { metric: c.metric, order: c.metric === 'ordinal' ? ORDER : null };
  const tk = c.metric + c.top;
  if (!truthOf.has(tk)) truthOf.set(tk, krippendorffAlpha(simulate(200000, 3, 0, maker), opts).alpha);
  const truth = truthOf.get(tk);
  const t = Object.fromEntries(METHODS.map(m => [m, { hit: 0, width: 0, sets: 0 }]));
  let none = 0;
  for (let d = 0; d < DATASETS; d++) {
    const units = simulate(c.n, c.graders, c.missing, maker);
    const r = bootstrapIntervals(units, opts, { resamples: RESAMPLES, seed: d + 1 });
    if (!r.percentile) { none++; continue; }
    const ranges = { percentile: r.percentile, bca: r.bca, log_jackknife: r.log_jackknife || r.percentile };
    if (c.metric === 'nominal') ranges.krippendorff = krippendorffBootstrap(units, RESAMPLES);
    for (const [m, x] of Object.entries(ranges)) { t[m].sets++; t[m].width += x.high - x.low; if (x.low <= truth && truth <= x.high) t[m].hit++; }
  }
  const row = { ...c, truth, none, t };
  rows.push(row);
  const cell = m => (t[m].sets ? (100 * t[m].hit / t[m].sets).toFixed(1) + '% (' + (t[m].width / t[m].sets).toFixed(3) + ')' : '-');
  console.log('| ' + (c.metric === 'nominal' ? 'nominal, top ' + Math.round(c.top * 100) + '%' : c.metric) + ' | ' + c.graders + ' | ' + c.n + ' | ' + Math.round(c.missing * 100) + '% | ' +
    truth.toFixed(3) + ' | ' + (DATASETS - none) + ' | ' + METHODS.map(cell).join(' | ') + ' |');
}

console.log('\nSummary over the cells each method ran in (coverage: worst cell, mean; mean width):');
for (const m of METHODS) {
  const used = rows.filter(r => r.t[m].sets > 0);
  const cov = used.map(r => r.t[m].hit / r.t[m].sets);
  const width = used.map(r => r.t[m].width / r.t[m].sets);
  const worst = Math.min(...cov);
  const at = used[cov.indexOf(worst)];
  console.log('  ' + m.padEnd(14) + ' worst ' + (100 * worst).toFixed(1) + '% (' + at.metric + (at.top ? ' top ' + at.top : '') + ', ' + at.graders + ' graders, ' + at.n + ' records, ' + Math.round(at.missing * 100) + '% missing)' +
    ' · mean ' + (100 * cov.reduce((s, x) => s + x, 0) / cov.length).toFixed(1) + '% · mean width ' + (width.reduce((s, x) => s + x, 0) / width.length).toFixed(3) + ' · ' + used.length + ' cells');
}
