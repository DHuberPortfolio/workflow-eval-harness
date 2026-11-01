#!/usr/bin/env node
// Which likely range for `wfeval estimate`? A seeded simulation that compares the candidate
// methods on the owner's kind of work, and prints the table docs/METRICS.md quotes.
//
//   node scripts/estimate-simulation.js [--reps 4000] [--seed 20261031] [--cells] [--jeffreys]
//
// Every run with the same seed prints the same numbers. --cells adds one line per grid cell.
//
// The set-up. N records went out without review. An AI judge gives each one a verdict: a silent
// error or not (J = 1 or 0). A person checks n of them (Y = 1 or 0). The true silent error rate
// is theta: the chance a fresh record like these is a silent error (the rate the workflow would
// have on the next records, not only on these N), and it is the generating parameter below. The
// judge catches a silent error with probability `sens` (sensitivity) and passes a good record
// with probability `spec` (specificity). So the judge flags a share
//   pi = theta x sens + (1 - theta) x (1 - spec)
// and the rate in each verdict group is
//   p1 = theta x sens / pi                       (the judge flagged it)
//   p0 = theta x (1 - sens) / (1 - pi)           (the judge passed it)
// with theta = pi x p1 + (1 - pi) x p0 exactly.
//
// Two ways the person picks records:
//   random:    n records at random from the N
//   by verdict: up to half the checks on records the judge flagged (all of them, if fewer),
//              the rest at random from the records it passed
// Each replicate draws a fresh set of N records, so the share the judge flags varies as it would.
//
// The methods (each gives a 95% range, z = 1.96):
//   person      Wilson on the person's checks alone. Valid only for a random sample: under
//               the by-verdict design it is biased, so it is scored on the random design only
//   ppi         prediction-powered inference, lambda = 1, with a normal (Wald) range
//               (Angelopoulos, Bates, Fannjiang, Jordan, Zrnic 2023, Science 382:669)
//   ppi++       PPI with the power-tuned lambda (Angelopoulos, Duchi, Zrnic 2023, arXiv 2311.01453)
//   strat-wald  post-stratified by the judge's verdict, Wald range, with the delta-method term for
//               the share the judge flags (Cochran 1977, sec. 5A.9; Holt and Smith 1979)
//   strat-neff  post-stratified, Wilson range over a design-based effective number of records
//               (Korn and Graubard 1998; Dean and Pagano 2015)
//   mover       post-stratified, each group's Wilson limits combined by MOVER, with the share the
//               judge flags as a third piece (Zou and Donner 2008; Newcombe 1998)
//   jeffreys    post-stratified, Jeffreys prior on each group's rate and on the share, 2.5% and
//               97.5% points of 400 seeded draws (Brown, Cai and DasGupta 2001 for the prior)
// Under the by-verdict design, ppi and ppi++ weight each group by its share of the N records
// (stratified PPI; Fisch et al. 2024): their estimate is then the post-stratified one.
// When the random design leaves a verdict group with no checked records, strat-wald and
// strat-neff fall back to the person's checks alone (collapsing the groups, the usual remedy),
// and mover and jeffreys give that group's rate the whole 0-100% range.

const { estimateRange } = require('../src/metrics/estimate.js');
const { wilson: wilsonOf } = require('../src/metrics/stats.js');
// Wilson's range at a rate p over m records, m not necessarily whole.
const bounds = (p, m) => wilsonOf(p * m, m);
const Z = 1.96;

// ---------- seeded random numbers ----------
// mulberry32: a small, fast 32-bit generator; plenty for a simulation, and reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Binomial(n, p) exactly, by counting the gaps between successes (geometric waiting times):
// about n x p steps, cheap for the small shares here.
function binomial(n, p, u) {
  if (p <= 0 || n <= 0) return 0;
  if (p >= 1) return n;
  if (p > 0.5) return n - binomial(n, 1 - p, u);
  const lq = Math.log1p(-p);
  let k = 0, pos = 0;
  for (;;) {
    pos += Math.floor(Math.log(1 - u()) / lq) + 1;
    if (pos > n) return k;
    k++;
  }
}
// Standard normal (Box-Muller) and gamma (Marsaglia and Tsang 2000) for the Jeffreys draws.
function normal(u) { return Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()); }
function gamma(shape, u) {
  if (shape < 1) return gamma(shape + 1, u) * Math.pow(1 - u(), 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = normal(u); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const w = 1 - u();
    if (w < 1 - 0.0331 * x ** 4 || Math.log(w) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function beta(a, b, u) { const x = gamma(a, u); return x / (x + gamma(b, u)); }

// ---------- the candidate methods ----------
// t: { N, N1, a, b, c, d }: records out, of them flagged by the judge; checked records by
// (judge, person): a flagged + error, b flagged + fine, c passed + error, d passed + fine.
// design: 'random' or 'verdict'. Each returns { low, high }.

const wilson = (y, n) => (n === 0 ? { low: 0, high: 1 } : bounds(y / n, n));
const wald = (est, v) => ({ low: Math.max(0, est - Z * Math.sqrt(v)), high: Math.min(1, est + Z * Math.sqrt(v)) });

function person(t) {
  return wilson(t.a + t.c, t.a + t.b + t.c + t.d);
}

// Post-stratified pieces: the share flagged, each group's checks and rate.
function strata(t) {
  const n1 = t.a + t.b, n0 = t.c + t.d;
  const W1 = t.N1 / t.N, W0 = 1 - W1;
  return { n1, n0, W1, W0, p1: n1 ? t.a / n1 : null, p0: n0 ? t.c / n0 : null };
}
// A group the judge never used (W = 0) needs no checks; one it used with none checked does.
const unchecked = s => (s.W1 > 0 && s.n1 === 0) || (s.W0 > 0 && s.n0 === 0);
function stratEstimate(s) {
  return (s.W1 > 0 ? s.W1 * s.p1 : 0) + (s.W0 > 0 ? s.W0 * s.p0 : 0);
}
function stratVariance(s, N) {
  let v = 0;
  if (s.W1 > 0) v += s.W1 * s.W1 * s.p1 * (1 - s.p1) / s.n1;
  if (s.W0 > 0) v += s.W0 * s.W0 * s.p0 * (1 - s.p0) / s.n0;
  if (s.W1 > 0 && s.W0 > 0) v += (s.p1 - s.p0) ** 2 * s.W1 * s.W0 / N;
  return v;
}

function ppi(t, design, tuned) {
  const n = t.a + t.b + t.c + t.d;
  const pi = t.N1 / t.N;
  if (design === 'random') {
    // Moments of the checked records, unweighted: a random sample.
    const ey = (t.a + t.c) / n, ej = (t.a + t.b) / n;
    const cov = n > 1 ? (t.a - n * ey * ej) / (n - 1) : 0;
    const varJ = pi * (1 - pi);
    let lam = 1;
    if (tuned) lam = varJ > 0 ? Math.min(1, Math.max(0, cov / ((1 + n / t.N) * varJ))) : 0;
    const est = lam * pi + ey - lam * ej;
    // Sample variance of D = Y - lam J over the checked records.
    const vals = [[1 - lam, t.a], [-lam, t.b], [1, t.c], [0, t.d]];
    const m = ey - lam * ej;
    const s2 = n > 1 ? vals.reduce((s, [x, k]) => s + k * (x - m) ** 2, 0) / (n - 1) : 0;
    return wald(est, lam * lam * varJ / t.N + s2 / n);
  }
  // By verdict: stratified PPI, each group weighted by its share. Within a group the judge's
  // verdict is fixed, so the rectifier's variance is the person's within the group.
  const s = strata(t);
  const est = stratEstimate(s);
  let v = 0;
  for (const [W, y, nh] of [[s.W1, t.a, s.n1], [s.W0, t.c, s.n0]]) {
    if (W === 0) continue;
    const p = y / nh;
    v += nh > 1 ? W * W * (nh * p * (1 - p) / (nh - 1)) / nh : 0;
  }
  // lambda = 1 adds the judge's own variance; the tuned lambda that minimises this is 0.
  if (!tuned) v += pi * (1 - pi) / t.N;
  return wald(est, v);
}

function stratWald(t) {
  const s = strata(t);
  if (unchecked(s)) { const n = s.n1 + s.n0, p = (t.a + t.c) / n; return wald(p, p * (1 - p) / n); }
  return wald(stratEstimate(s), stratVariance(s, t.N));
}

function stratNeff(t) {
  const s = strata(t);
  if (unchecked(s)) return person(t);
  const est = stratEstimate(s);
  const v = stratVariance(s, t.N);
  // At 0 or 100%, or no spread at all, the variance says nothing: Kish's effective number for
  // the records' unequal weights instead (each checked record in group h stands for W_h / n_h).
  const kish = 1 / ((s.W1 > 0 ? s.W1 * s.W1 / s.n1 : 0) + (s.W0 > 0 ? s.W0 * s.W0 / s.n0 : 0));
  const neff = est > 0 && est < 1 && v > 0 ? est * (1 - est) / v : kish;
  return bounds(est, neff);
}

function jeffreys(t, u, draws = 400) {
  const s = strata(t);
  const xs = new Float64Array(draws);
  for (let i = 0; i < draws; i++) {
    const pi = beta(t.N1 + 0.5, t.N - t.N1 + 0.5, u);
    const p1 = beta(t.a + 0.5, t.b + 0.5, u);   // with no checks: Beta(0.5, 0.5), all of 0-100%
    const p0 = beta(t.c + 0.5, t.d + 0.5, u);
    xs[i] = s.W1 === 0 ? p0 : s.W0 === 0 ? p1 : pi * p1 + (1 - pi) * p0;
  }
  xs.sort();
  return { low: xs[Math.floor(0.025 * (draws - 1))], high: xs[Math.ceil(0.975 * (draws - 1))], none: unchecked(s) };
}

// The shipped method (src/metrics/estimate.js), from the same counts.
function mover(t, small) {
  const r = estimateRange({ out: t.N, flagged: t.N1, checked: { flagged: { n: t.a + t.b, errors: t.a }, passed: { n: t.c + t.d, errors: t.c } } }, Z, small);
  return { low: r.low, high: r.high, none: r.estimate === null };
}

const METHODS = {
  person: { fn: t => person(t), random_only: true },
  ppi: { fn: (t, d) => ppi(t, d, false) },
  'ppi++': { fn: (t, d) => ppi(t, d, true) },
  'strat-wald': { fn: t => stratWald(t) },
  'strat-neff': { fn: t => stratNeff(t) },
  'mover-wilson': { fn: t => mover(t, false) },
  mover: { fn: t => mover(t, true) },
  jeffreys: { fn: (t, d, u) => jeffreys(t, u), slow: true },
};

// ---------- one replicate ----------
function replicate(cell, u) {
  const { theta, sens, spec, N, n, design } = cell;
  const pi = theta * sens + (1 - theta) * (1 - spec);
  const p1 = theta * sens / pi;
  const p0 = theta * (1 - sens) / (1 - pi);
  const t = { N, N1: 0, a: 0, b: 0, c: 0, d: 0 };
  if (design === 'random') {
    // The n checked records are n of the N, drawn like any other; the rest add to N1.
    const n1 = binomial(n, pi, u);
    t.a = binomial(n1, p1, u); t.b = n1 - t.a;
    t.c = binomial(n - n1, p0, u); t.d = n - n1 - t.c;
    t.N1 = n1 + binomial(N - n, pi, u);
  } else {
    t.N1 = binomial(N, pi, u);
    const n1 = Math.min(t.N1, Math.ceil(n / 2));
    const n0 = Math.min(N - t.N1, n - n1);
    t.a = binomial(n1, p1, u); t.b = n1 - t.a;
    t.c = binomial(n0, p0, u); t.d = n0 - t.c;
  }
  return t;
}

// ---------- the grid ----------
function grid() {
  const cells = [];
  for (const design of ['random', 'verdict'])
    for (const theta of [0.01, 0.03, 0.08, 0.15])
      for (const sens of [0.6, 0.8, 0.95])
        for (const spec of [0.9, 0.97, 0.995])
          for (const N of [200, 1000, 5000])
            for (const n of [30, 60, 150]) cells.push({ design, theta, sens, spec, N, n });
  return cells;
}

// Each setting gets its own stream, seeded from the seed and the setting's place in the grid: one
// stream for the whole grid would run past the generator's 2^32 numbers with --jeffreys and repeat.
const cellSeed = (seed, i) => (seed ^ Math.imul(i + 1, 0x9E3779B1)) >>> 0;

function run({ reps = 2000, seed = 20261031, jeffreys = false } = {}) {
  const names = Object.keys(METHODS).filter(m => jeffreys || !METHODS[m].slow);
  const per = {};   // method -> list of { cell, cover, below, above, degenerate, width }
  for (const m of names) per[m] = [];
  grid().forEach((cell, i) => {
    const u = rng(cellSeed(seed, i));
    const acc = Object.fromEntries(names.map(m => [m, { cover: 0, below: 0, above: 0, degenerate: 0, width: 0, none: 0, coverEst: 0 }]));
    for (let r = 0; r < reps; r++) {
      const t = replicate(cell, u);
      for (const m of names) {
        if (METHODS[m].random_only && cell.design !== 'random') continue;
        const { low, high, none } = METHODS[m].fn(t, cell.design, u);
        const a = acc[m];
        // A verdict group with no checks gives bounds, not an estimate (trap K3): counted both ways.
        if (none) a.none++;
        else if (low <= cell.theta && cell.theta <= high) a.coverEst++;
        if (low <= cell.theta && cell.theta <= high) a.cover++;
        else if (high < cell.theta) a.below++;
        else a.above++;
        if (high - low < 1e-12) a.degenerate++;
        a.width += high - low;
      }
    }
    for (const m of names) {
      if (METHODS[m].random_only && cell.design !== 'random') continue;
      const a = acc[m];
      per[m].push({ cell, cover: a.cover / reps, below: a.below / reps, above: a.above / reps, degenerate: a.degenerate / reps, width: a.width / reps,
        none: a.none / reps, cover_est: a.none === reps ? null : a.coverEst / (reps - a.none) });
    }
  });
  return { reps, seed, per };
}

function summarize(list) {
  const worst = list.reduce((w, x) => (x.cover < w.cover ? x : w), list[0]);
  const mean = f => list.reduce((s, x) => s + f(x), 0) / list.length;
  return {
    cells: list.length,
    worst_cover: worst.cover, worst_cell: worst.cell,
    mean_cover: mean(x => x.cover),
    cells_under_93: list.filter(x => x.cover < 0.93).length,
    worst_below: Math.max(...list.map(x => x.below)),
    worst_above: Math.max(...list.map(x => x.above)),
    degenerate: mean(x => x.degenerate),
    none: mean(x => x.none), none_max: Math.max(...list.map(x => x.none)),
    worst_cover_est: Math.min(...list.filter(x => x.cover_est !== null).map(x => x.cover_est)),
    width: mean(x => x.width),
  };
}

const f1 = x => (x * 100).toFixed(1);
const cellName = c => c.design + ' rate ' + f1(c.theta) + '% sens ' + c.sens + ' spec ' + c.spec + ' N ' + c.N + ' n ' + c.n;

function main(argv) {
  const opt = { reps: 4000, seed: 20261031, showCells: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--reps') opt.reps = Number(argv[++i]);
    else if (argv[i] === '--seed') opt.seed = Number(argv[++i]);
    else if (argv[i] === '--cells') opt.showCells = true;
    else if (argv[i] === '--jeffreys') opt.jeffreys = true;
  }
  const res = run(opt);
  console.log('wfeval estimate: method simulation, ' + opt.reps + ' replicates per cell, seed ' + opt.seed);
  console.log('grid: rate 1/3/8/15%, judge sensitivity 0.6/0.8/0.95, specificity 0.9/0.97/0.995, records out 200/1000/5000, person checks 30/60/150');
  for (const design of ['random', 'verdict', 'both']) {
    console.log('\ndesign: ' + (design === 'random' ? 'a random sample' : design === 'verdict' ? 'by the judge\'s verdict (flags oversampled)' : 'both designs together'));
    console.log('method       cells  worst cover  mean cover  cells<93%  miss-low max  miss-high max  zero-width  mean width  no estimate (mean, max)  worst cover with an estimate');
    for (const m of Object.keys(res.per)) {
      const list = res.per[m].filter(x => design === 'both' || x.cell.design === design);
      if (list.length === 0) continue;
      const s = summarize(list);
      console.log(m.padEnd(12) + String(s.cells).padStart(6) + (f1(s.worst_cover) + '%').padStart(13) + (f1(s.mean_cover) + '%').padStart(12) +
        String(s.cells_under_93).padStart(11) + (f1(s.worst_below) + '%').padStart(14) + (f1(s.worst_above) + '%').padStart(15) + (f1(s.degenerate) + '%').padStart(12) + (f1(s.width) + ' pts').padStart(12) +
        (f1(s.none) + '%, ' + f1(s.none_max) + '%').padStart(25) + (f1(s.worst_cover_est) + '%').padStart(30));
    }
  }
  console.log('\nworst cell per method:');
  for (const m of Object.keys(res.per)) {
    const s = summarize(res.per[m]);
    console.log('  ' + m.padEnd(13) + f1(s.worst_cover) + '% at ' + cellName(s.worst_cell));
  }
  // Width against the person alone, on the random design: how much the judge adds.
  const pw = res.per.person;
  const mv = res.per.mover.filter(x => x.cell.design === 'random');
  const ratio = mv.map((x, i) => x.width / pw[i].width);
  console.log('\nmover width / person-alone width, random design: mean ' + (ratio.reduce((s, x) => s + x, 0) / ratio.length).toFixed(2) +
    ', best ' + Math.min(...ratio).toFixed(2) + ', worst ' + Math.max(...ratio).toFixed(2));
  const at = r => cellName(mv[ratio.indexOf(r)].cell);
  console.log('  best at ' + at(Math.min(...ratio)) + '; worst at ' + at(Math.max(...ratio)));
  for (const [label, keep] of [['judge sensitivity 0.95 and specificity 0.995', c => c.sens === 0.95 && c.spec === 0.995], ['judge sensitivity 0.6 and specificity 0.9', c => c.sens === 0.6 && c.spec === 0.9]]) {
    const sub = ratio.filter((r, i) => keep(mv[i].cell));
    console.log('  ' + label + ': mean ' + (sub.reduce((t, x) => t + x, 0) / sub.length).toFixed(2));
  }
  if (opt.showCells) {
    for (const m of Object.keys(res.per)) {
      console.log('\n' + m);
      for (const x of res.per[m]) console.log('  ' + cellName(x.cell).padEnd(60) + f1(x.cover).padStart(6) + '%' + f1(x.width).padStart(7) + ' pts');
    }
  }
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { run, summarize, rng, binomial };
