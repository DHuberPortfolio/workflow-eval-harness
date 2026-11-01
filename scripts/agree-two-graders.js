// With exactly two values on every record, which range: BCa or Krippendorff's own bootstrap? Both
// from bootstrapIntervals(), the code wfeval agree runs, on the same data sets, for nominal,
// ordinal and set data (the data as in scripts/agree-coverage.js; 2 graders; 20, 50 or 150 records
// for nominal, 20 or 50 for the others; 0% or 20% missing). 300 data sets per setting, each range
// from 1,000 resamples; data sets where either method gives no range are left out for both.
// Coverage is the share of ranges holding the real alpha (95% is right). Seeded:
//   node scripts/agree-two-graders.js
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
const rand = seeded(11);
const pick = w => { let r = rand(), i = 0; while (i < w.length - 1 && r >= w[i]) { r -= w[i]; i++; } return i; };
const MAKERS = {
  nominal: top => { const p = [top, (1 - top) * 0.6, (1 - top) * 0.4]; return () => { const t = pick(p); return () => (rand() < 0.8 ? t : Math.floor(rand() * 3)); }; },
  ordinal: () => () => { const t = pick([0.1, 0.2, 0.4, 0.2, 0.1]); return () => { const r = rand(); const v = r < 0.6 ? t : r < 0.9 ? t + (rand() < 0.5 ? -1 : 1) : Math.floor(rand() * 5); return Math.min(4, Math.max(0, v)); }; },
  jaccard: () => () => { const t = [0, 1, 2, 3, 4, 5].filter(() => rand() < 0.25); return () => [0, 1, 2, 3, 4, 5].filter(c => (t.includes(c) ? rand() >= 0.15 : rand() < 0.05)).map(String); },
};
// Missing values are dropped from the pair: a record keeps both values or is left with one.
const simulate = (n, missing, make) => Array.from({ length: n }, () => { const value = make(); return [0, 1].map(() => (rand() < missing ? null : value())); });

const CELLS = [];
for (const top of [0.5, 0.8, 0.95]) for (const n of [20, 50, 150]) for (const missing of [0, 0.2]) CELLS.push({ metric: 'nominal', top, n, missing });
for (const metric of ['ordinal', 'jaccard']) for (const n of [20, 50]) for (const missing of [0, 0.2]) CELLS.push({ metric, top: null, n, missing });

const summary = {};
console.log('| data | records | missing | real alpha | sets | BCa | Krippendorff |');
console.log('|---|---|---|---|---|---|---|');
for (const c of CELLS) {
  const make = MAKERS[c.metric](c.top);
  const opts = { metric: c.metric, order: c.metric === 'ordinal' ? [0, 1, 2, 3, 4] : null };
  const truth = krippendorffAlpha(simulate(200000, 0, make), opts).alpha;
  const t = { bca: [0, 0], krippendorff: [0, 0] };
  let sets = 0;
  for (let d = 0; d < 300; d++) {
    const r = bootstrapIntervals(simulate(c.n, c.missing, make), opts, { resamples: 1000, seed: d + 1 });
    if (!r.bca || !r.krippendorff || r.krippendorff.low === null) continue;
    sets++;
    for (const m of ['bca', 'krippendorff']) { t[m][0] += r[m].low <= truth && truth <= r[m].high ? 1 : 0; t[m][1] += r[m].high - r[m].low; }
  }
  const cov = m => (100 * t[m][0] / sets);
  for (const m of ['bca', 'krippendorff']) { (summary[c.metric + ' ' + m] = summary[c.metric + ' ' + m] || []).push(cov(m)); }
  console.log('| ' + (c.metric === 'nominal' ? 'nominal, true share ' + Math.round(c.top * 100) + '%' : c.metric) + ' | ' + c.n + ' | ' + Math.round(c.missing * 100) + '% | ' + truth.toFixed(3) + ' | ' + sets + ' | ' +
    cov('bca').toFixed(1) + '% (' + (t.bca[1] / sets).toFixed(3) + ') | ' + cov('krippendorff').toFixed(1) + '% (' + (t.krippendorff[1] / sets).toFixed(3) + ') |');
}
console.log('');
for (const [k, v] of Object.entries(summary)) console.log('  ' + k.padEnd(22) + ' worst ' + Math.min(...v).toFixed(1) + '% · mean ' + (v.reduce((s, x) => s + x, 0) / v.length).toFixed(1) + '%');
