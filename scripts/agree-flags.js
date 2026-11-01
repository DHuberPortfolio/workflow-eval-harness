// When is alpha's likely range too narrow to trust? The report warns on something it can see in
// the data (trap M16); this simulation picks what and where, by how often the range wfeval agree
// gives holds the real alpha (95% is right). That range is BCa, or Krippendorff's bootstrap when every
// compared record has exactly two values (bootstrapAlpha), so every count is also split by the two.
//
// Data as in scripts/agree-coverage.js (nominal, 3 categories, each grader right with chance 0.8,
// otherwise a category at random), over a wide grid: the true share of the most common category
// 50%, 80% or 95%; 2, 3 or 5 graders; 3, 5, 8, 12, 20, 50 or 150 records; 0% or 20% missing. 100
// data sets per setting, each range from 1,000 resamples. Every data set with a range is then
// grouped by two things the report can count: the values that are not the most common value
// ("rare values"), and the records compared. Seeded:  node scripts/agree-flags.js
const { krippendorffAlpha, bootstrapAlpha } = require('../src/metrics/agreement.js');

function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = seeded(7);
const pick = w => { let r = rand(), i = 0; while (i < w.length - 1 && r >= w[i]) { r -= w[i]; i++; } return i; };
const simulate = (n, graders, missing, p) => Array.from({ length: n }, () => {
  const t = pick(p);
  return Array.from({ length: graders }, () => (rand() < missing ? null : rand() < 0.8 ? t : Math.floor(rand() * 3)));
});

const runs = [];
for (const top of [0.5, 0.8, 0.95]) {
  const p = [top, (1 - top) * 0.6, (1 - top) * 0.4];
  const truth = krippendorffAlpha(simulate(200000, 3, 0, p), { metric: 'nominal' }).alpha;
  for (const graders of [2, 3, 5]) for (const n of [3, 5, 8, 12, 20, 50, 150]) for (const missing of [0, 0.2]) {
    for (let d = 0; d < 100; d++) {
      const units = simulate(n, graders, missing, p);
      const r = bootstrapAlpha(units, { metric: 'nominal' }, { resamples: 1000, seed: d + 1 });
      if (r.low === null) continue;
      const a = krippendorffAlpha(units, { metric: 'nominal' });
      runs.push({ method: r.method, rare: Math.round(a.values * (1 - a.top.share)), records: a.units, hit: r.low <= truth && truth <= r.high });
    }
  }
}
const show = (label, list) => console.log('  ' + label.padEnd(22) + (list.length ? (100 * list.filter(x => x.hit).length / list.length).toFixed(1) + '%' : '-').padStart(7) + '  (' + list.length + ' data sets)');
console.log(runs.length + ' data sets with a range. Coverage by rare values (not the most common value):');
for (const [lo, hi] of [[0, 4], [5, 9], [10, 14], [15, 19], [20, 29], [30, 49], [50, 1e9]]) show(lo + (hi < 1e9 ? '-' + hi : '+') + ' rare values', runs.filter(x => x.rare >= lo && x.rare <= hi));
console.log('By records compared:');
for (const [lo, hi] of [[2, 4], [5, 7], [8, 11], [12, 19], [20, 49], [50, 1e9]]) show(lo + (hi < 1e9 ? '-' + hi : '+') + ' records', runs.filter(x => x.records >= lo && x.records <= hi));
console.log('By both (20+ rare values):');
for (const [lo, hi] of [[2, 4], [5, 7], [8, 11], [12, 1e9]]) show(lo + (hi < 1e9 ? '-' + hi : '+') + ' records', runs.filter(x => x.rare >= 20 && x.records >= lo && x.records <= hi));
for (const k of [10, 15, 20, 25]) {
  show('flag: rare < ' + k, runs.filter(x => x.rare < k));
  show('  not flagged', runs.filter(x => x.rare >= k));
}

for (const method of ['bca', 'krippendorff']) {
  const mine = runs.filter(x => x.method === method);
  console.log();
  console.log('Only the ' + method + ' ranges (' + mine.length + ' data sets), by rare values:');
  for (const [lo, hi] of [[0, 4], [5, 9], [10, 14], [15, 19], [20, 29], [30, 49], [50, 1e9]]) show(lo + (hi < 1e9 ? '-' + hi : '+') + ' rare values', mine.filter(x => x.rare >= lo && x.rare <= hi));
  for (const k of [15, 20, 25]) { show('flag: rare < ' + k, mine.filter(x => x.rare < k)); show('  not flagged', mine.filter(x => x.rare >= k)); }
}
