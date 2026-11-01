#!/usr/bin/env node
// Which records should the person check? A seeded simulation that compares ways of picking the
// same number of checks, and prints the table docs/METRICS.md quotes ("Which records to check").
//
//   node scripts/estimate-designs.js [--reps 4000] [--seed 20261101]
//
// Same set-up and grid as scripts/estimate-simulation.js (true rate 1/3/8/15%, judge sensitivity
// 0.6/0.8/0.95, specificity 0.9/0.97/0.995, 200/1,000/5,000 records out, 30/60/150 checks). Each
// replicate draws one set of records out, and every design picks its checks from that same set,
// so the designs start from the same records out and the same judge's flags; each draws its own
// checks and what they find. The designs:
//   random-person   a random sample, the person's checks alone (Wilson)
//   random-judge    a random sample, with the judge (the shipped estimate: post-stratified, MOVER)
//   proportional    by the judge's verdict, each group by its share of the records
//   sqrt            by verdict, by the square roots of the shares (between proportional and even)
//   flags-10% ... flags-50%: by verdict, that share of the checks on the flags
//   all-flags       every flag checked (leaving at least one check for the passes), the rest random
// Every by-verdict design gives each group at least one check, and no group more than it has
// records (allocate() in src/metrics/estimate.js, the rule `wfeval estimate --pick` uses).
// Criteria as before: coverage of the true rate first (worst setting, average, settings under
// 93%), then width, here as a share of the person-alone width in the same setting.

const { estimateRange, allocate } = require('../src/metrics/estimate.js');
const { wilson } = require('../src/metrics/stats.js');
const { rng, binomial } = require('./estimate-simulation.js');

const DESIGNS = ['random-person', 'random-judge', 'proportional', 'sqrt', 'flags-10%', 'flags-20%', 'flags-33%', 'flags-50%', 'all-flags', 'plan'];
const RULE = { proportional: 'proportional', sqrt: 'sqrt', 'flags-10%': 0.1, 'flags-20%': 0.2, 'flags-33%': 1 / 3, 'flags-50%': 0.5, 'all-flags': 'all_flags', plan: 'plan' };

// n records drawn at random from N, N1 of them flagged: how many flagged ones (hypergeometric).
function hypergeometric(N, N1, n, u) {
  let k = 0, left1 = N1, left = N;
  for (let i = 0; i < n; i++) {
    if (u() * left < left1) { k++; left1--; }
    left--;
  }
  return k;
}

function mover(N, N1, n1, y1, n0, y0) {
  const r = estimateRange({ out: N, flagged: N1, checked: { flagged: { n: n1, errors: y1 }, passed: { n: n0, errors: y0 } } });
  return [r.low, r.high, r.estimate === null];
}

// Each setting gets its own stream, seeded from the seed and the setting's place in the grid, so no
// stream runs past the generator's 2^32 numbers.
const cellSeed = (seed, i) => (seed ^ Math.imul(i + 1, 0x9E3779B1)) >>> 0;

function run({ reps = 4000, seed = 20261101 } = {}) {
  const rows = Object.fromEntries(DESIGNS.map(d => [d, []]));
  let i = 0;
  for (const theta of [0.01, 0.03, 0.08, 0.15])
    for (const sens of [0.6, 0.8, 0.95])
      for (const spec of [0.9, 0.97, 0.995])
        for (const N of [200, 1000, 5000])
          for (const n of [30, 60, 150]) {
            const cell = { theta, sens, spec, N, n };
            const u = rng(cellSeed(seed, i++));
            const pi = theta * sens + (1 - theta) * (1 - spec);
            const p1 = theta * sens / pi, p0 = theta * (1 - sens) / (1 - pi);
            const acc = Object.fromEntries(DESIGNS.map(d => [d, { cover: 0, below: 0, width: 0, none: 0, coverEst: 0 }]));
            for (let r = 0; r < reps; r++) {
              const N1 = binomial(N, pi, u);
              const range = {};
              // A random sample: the person alone, and with the judge, on the same checks.
              const k1 = hypergeometric(N, N1, n, u);
              const a1 = binomial(k1, p1, u), a0 = binomial(n - k1, p0, u);
              const w = wilson(a1 + a0, n);
              range['random-person'] = [w.low, w.high];
              range['random-judge'] = mover(N, N1, k1, a1, n - k1, a0);
              for (const d of DESIGNS.slice(2)) {
                const al = allocate(n, N, N1, RULE[d]);
                range[d] = mover(N, N1, al.flagged, binomial(al.flagged, p1, u), al.passed, binomial(al.passed, p0, u));
              }
              for (const d of DESIGNS) {
                const [low, high, none] = range[d];
                if (none) acc[d].none++;
                else if (low <= theta && theta <= high) acc[d].coverEst++;
                if (low <= theta && theta <= high) acc[d].cover++;
                else if (high < theta) acc[d].below++;
                acc[d].width += high - low;
              }
            }
            for (const d of DESIGNS) rows[d].push({ cell, cover: acc[d].cover / reps, below: acc[d].below / reps, width: acc[d].width / reps, none: acc[d].none / reps,
              cover_est: acc[d].none === reps ? null : acc[d].coverEst / (reps - acc[d].none) });
          }
  return { reps, seed, rows };
}

const f1 = x => (x * 100).toFixed(1);
const cellName = c => 'rate ' + f1(c.theta) + '% sens ' + c.sens + ' spec ' + c.spec + ' N ' + c.N + ' n ' + c.n;
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;

function main(argv) {
  const opt = { reps: 4000, seed: 20261101 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--reps') opt.reps = Number(argv[++i]);
    else if (argv[i] === '--seed') opt.seed = Number(argv[++i]);
  }
  const res = run(opt);
  const base = res.rows['random-person'];
  console.log('wfeval estimate: which records to check, ' + opt.reps + ' replicates per setting, seed ' + opt.seed);
  console.log('width ratio: the design\'s average width over the person-alone width on a random sample, in the same setting');
  console.log('design          worst cover  mean cover  under 93%  miss-low max  mean width  ratio mean  ratio best  ratio worst  no estimate (mean, max)  worst cover with an estimate');
  for (const d of DESIGNS) {
    const list = res.rows[d];
    const ratio = list.map((x, i) => x.width / base[i].width);
    const worst = list.reduce((w, x) => (x.cover < w.cover ? x : w), list[0]);
    console.log(d.padEnd(14) + (f1(worst.cover) + '%').padStart(13) + (f1(mean(list.map(x => x.cover))) + '%').padStart(12) +
      String(list.filter(x => x.cover < 0.93).length).padStart(11) + (f1(Math.max(...list.map(x => x.below))) + '%').padStart(14) +
      (f1(mean(list.map(x => x.width))) + ' pts').padStart(12) + mean(ratio).toFixed(2).padStart(12) + Math.min(...ratio).toFixed(2).padStart(12) +
      Math.max(...ratio).toFixed(2).padStart(13) + (f1(mean(list.map(x => x.none))) + '%, ' + f1(Math.max(...list.map(x => x.none))) + '%').padStart(25) +
      (f1(Math.min(...list.filter(x => x.cover_est !== null).map(x => x.cover_est))) + '%').padStart(30));
  }
  // Each by-verdict design against a random sample with the judge, setting by setting.
  const rj = res.rows['random-judge'];
  console.log('\nagainst a random sample with the judge (width ratio, setting by setting):');
  for (const d of DESIGNS.slice(2)) {
    const r = res.rows[d].map((x, i) => x.width / rj[i].width);
    console.log('  ' + d.padEnd(13) + ' mean ' + mean(r).toFixed(2) + ', worst ' + Math.max(...r).toFixed(2) + ', narrower in ' + r.filter(x => x < 1).length + ' of ' + r.length + ' settings');
  }
  console.log('');
  // Where each design does best and worst against the person alone, and by error rate.
  for (const d of DESIGNS.slice(1)) {
    const list = res.rows[d];
    const ratio = list.map((x, i) => x.width / base[i].width);
    const by = t => mean(ratio.filter((r, i) => list[i].cell.theta === t)).toFixed(2);
    console.log('  ' + d.padEnd(13) + ' ratio by true rate 1/3/8/15%: ' + [0.01, 0.03, 0.08, 0.15].map(by).join(' / ') +
      '; worst at ' + cellName(list[ratio.indexOf(Math.max(...ratio))].cell));
  }
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { run, hypergeometric };
