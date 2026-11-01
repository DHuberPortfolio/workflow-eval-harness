// The simulations behind `wfeval monitor`'s choice of methods (docs/METRICS.md, "Live samples
// over time"). Seeded, so every run prints the same tables:
//
//   node scripts/monitor-sim.js            (all of it, under a minute)
//   node scripts/monitor-sim.js chain      (or 1, 2, wobble, restart, tuning: one part)
//
// The chain check: the Markov chain's average records to an alarm (src/metrics/monitor.js)
// against 20,000 simulated runs of the detector itself.
// Part 1, change detection. Each detector watches one period at a time (n records checked, y
// silent errors) and is tuned to the same false-alarm rate: one false alarm per 2,000 records
// checked on average, with the rate steady at the acceptable rate p0. Then the rate rises to 2x
// or 3x p0 after 9 calm periods, and we count the records checked from the rise to the alarm
// (runs that false-alarmed before the rise are left out). Fewer is better.
//   - CUSUM, exact level for the periods' size: the shipped choice. The smallest whole-number
//     level whose Markov chain (Brook & Evans 1972) gives at least 2,000 records per false alarm.
//   - CUSUM, exact level for a check after every record: safe for any period size (checked once
//     a period, it false-alarms less often, never more), at a cost in speed.
//   - CUSUM, level tuned by simulation to these periods' size: the best a CUSUM could do here.
//   - CUSUM, Lorden's bound h = ln(2000 / n): guaranteed, no calculation (Lorden 1971).
//   - p-chart with exact binomial limits (Shewhart): alarm when y reaches the limit.
//   - EWMA of the period rates, one-sided, lambda 0.1 and 0.2 (Roberts 1959), tuned by simulation.
// Part 2, "shown under the target, however often you look". A check after every period, for
// 104 periods (two years of weekly checks):
//   - validity: the chance of EVER showing "under 5%" when the true rate is exactly 5%
//   - tightness: records checked until it shows "under 5%" when the true rate is 2.5% (or 1%)
//   - drift: the same chance when the rate alternates 8%, 2%, 8%, ... (its running average
//     never below 5% at a period's end), and when each period's rate is drawn between 2% and 8%
//     (wrong only if shown while the average of the period rates so far is 5% or more)
// for the one-sided beta-binomial mixture (the shipped choice: Robbins 1970; Howard, Ramdas,
// McAuliffe & Sekhon 2021), a betting confidence sequence (Waudby-Smith & Ramdas 2023), the
// Hoeffding normal mixture (Robbins 1970; Howard et al. 2021, valid for the running average of
// drifting rates), and the naive checks the peeking problem is about: the Wilson range of all
// records so far, or of the period alone, checked every period.
// Part 3 (wobble), the shipped CUSUM's false alarms when the rate wobbles from period to period.
// Part 4 (restart), what --since may restart without breaking the bound's 5%.
// Part 5 (tuning), the default tuning's numbers, from the chain alone.
'use strict';
const { cusumThreshold, cusumArl, mixtureLogE, cusumScores, cusumStep } = require('../src/metrics/monitor.js');
const { wilson, chanceAtMost } = require('../src/metrics/stats.js');

// A small seeded random number generator (mulberry32), so every run prints the same tables.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// A binomial count from one uniform number, by its cumulative chances (kept per n and p).
const samplers = new Map();
function binom(n, p) {
  const k0 = n + ':' + p;
  if (!samplers.has(k0)) {
    const cdf = [];
    let pr = Math.pow(1 - p, n), c = 0;
    for (let k = 0; k <= n; k++) { if (k > 0) pr *= ((n - k + 1) / k) * (p / (1 - p)); c += pr; cdf.push(c); }
    samplers.set(k0, u => { let k = 0; while (k < n && u > cdf[k]) k++; return k; });
  }
  return samplers.get(k0);
}

// ---------- Part 1 ----------
const A = 2000;            // false-alarm target: one per A records
const RUNS = 3000;
const TAU = 10;            // the rise starts at this period

const detectors = {
  // The shipped CUSUM, in whole-number steps; its threshold in steps.
  cusum: (p0, p1, H) => { const sc = cusumScores(p0, p1); let S = 0; return (y, n) => { S = cusumStep(S, y, n, sc); return S >= H; }; },
  pchart: (p0, p1, c) => (y) => y >= c,
  ewma: lam => (p0, p1, c) => { let Z = p0; return (y, n) => { Z = Math.max(p0, lam * (y / n) + (1 - lam) * Z); return Z >= c; }; },
};

// Periods until the alarm, with the rate at pBefore before period `tau` and pAfter from it.
function runLength(make, p0, p1, thr, n, pBefore, pAfter, tau, seed, maxPeriods) {
  const r = rng(seed);
  const step = make(p0, p1, thr);
  const b = binom(n, pBefore), a = binom(n, pAfter);
  for (let t = 1; t <= maxPeriods; t++) {
    const y = (t < tau ? b : a)(r());
    if (step(y, n)) return t;
  }
  return maxPeriods;
}
function arl0(make, p0, p1, thr, n, seedBase) {
  const max = Math.ceil((40 * A) / n);
  let total = 0;
  for (let i = 0; i < RUNS; i++) total += runLength(make, p0, p1, thr, n, p0, p0, 1, seedBase + i, max);
  return (total / RUNS) * n;
}
function delay(make, p0, p1, thr, n, pAfter, seedBase) {
  let total = 0, used = 0;
  for (let i = 0; i < RUNS; i++) {
    const t = runLength(make, p0, p1, thr, n, p0, pAfter, TAU, seedBase + i, TAU + Math.ceil((40 * A) / n));
    if (t < TAU) continue;
    total += (t - TAU + 1) * n;
    used++;
  }
  return total / used;
}
// Tune a continuous threshold by halving, on one set of seeds (checked on another).
function tune(make, p0, p1, n, lo, hi) {
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (arl0(make, p0, p1, mid, n, 1e6) < A) lo = mid; else hi = mid;
  }
  return hi;
}
// Smallest c with P(Y >= c) <= n / A, so its false alarms are at most one per A records.
function pchartLimit(p0, n) {
  for (let c = 1; c <= n; c++) if (1 - chanceAtMost(c - 1, n, p0) <= n / A) return c;
  return n + 1;
}

function part1() {
  console.log('PART 1: change detection, tuned to one false alarm per ' + A + ' records; rise after ' + (TAU - 1) + ' calm periods');
  console.log('records checked from the rise to the alarm (average); false alarms: records per false alarm, measured on fresh seeds\n');
  const rows = [];
  for (const p0 of [0.01, 0.02, 0.05]) {
    const p1 = 2 * p0;
    const hRecord = cusumThreshold(p0, p1, A);
    for (const n of [20, 50, 100]) {
      const cands = [
        ['CUSUM exact h (chain, period size)', detectors.cusum, cusumThreshold(p0, p1, A, n)],
        ['CUSUM exact h (chain, per record)', detectors.cusum, hRecord],
        ['CUSUM h tuned by simulation', detectors.cusum, tune(detectors.cusum, p0, p1, n, 0, 20 / cusumScores(p0, p1).step)],
        ['CUSUM Lorden h = ln(A/n)', detectors.cusum, Math.ceil(Math.log(A / n) / cusumScores(p0, p1).step)],
        ['p-chart exact binomial', detectors.pchart, pchartLimit(p0, n)],
        ['EWMA lambda 0.1', detectors.ewma(0.1), tune(detectors.ewma(0.1), p0, p1, n, p0, 1)],
        ['EWMA lambda 0.2', detectors.ewma(0.2), tune(detectors.ewma(0.2), p0, p1, n, p0, 1)],
      ];
      for (const [name, make, thr] of cands) {
        rows.push({
          p0: (p0 * 100) + '%', n, detector: name,
          'records/false alarm': Math.round(arl0(make, p0, p1, thr, n, 5e6)),
          'delay at 2x': Math.round(delay(make, p0, p1, thr, n, 2 * p0, 9e6)),
          'delay at 3x': Math.round(delay(make, p0, p1, thr, n, 3 * p0, 13e6)),
        });
      }
    }
  }
  console.table(rows);
}

// The Markov chain against simulation, from a standing start.
function chainCheck() {
  console.log('CUSUM: average records checked until an alarm, Markov chain vs simulation (20,000 runs), h for one false alarm per ' + A + ' records');
  const rows = [];
  for (const p0 of [0.01, 0.025, 0.05]) {
    const p1 = 2 * p0;
    for (const n of [1, 50]) {
      const h = cusumThreshold(p0, p1, A, n);
      for (const p of [p0, p1]) {
        const r = rng(77);
        const draw = binom(n, p);
        let total = 0;
        for (let i = 0; i < 20000; i++) {
          const step = detectors.cusum(p0, p1, h);
          let t = 1;
          while (!step(draw(r()), n)) t++;
          total += t * n;
        }
        rows.push({ p0, 'period size': n, rate: p, 'h (log units)': Number((h * cusumScores(p0, p1).step).toFixed(3)), chain: Math.round(cusumArl(p0, p1, h, p, n)), simulated: Math.round(total / 20000), 'Lorden bound n e^h': Math.round(n * Math.exp(h * cusumScores(p0, p1).step)) });
      }
    }
  }
  console.table(rows);
}

// ---------- Part 2 ----------
const PERIODS = 104;
const RUNS2 = 4000;
const ALPHA = 0.05;

const bounds = {
  mixture: target => { let S = 0, F = 0; return (y, n) => { S += y; F += n - y; return mixtureLogE(S, F, target) >= Math.log(1 / ALPHA); }; },
  betting: target => {
    let S = 0, t = 0, logK = 0;
    return (y, n) => {
      const q = (S + 0.5) / (t + 1);   // the rate so far, before this period (predictable)
      const lam = Math.min(0.5 / (1 - target), Math.max(0, (target - q) / (target * (1 - target))));
      logK += (n - y) * Math.log1p(lam * target) + y * Math.log1p(-lam * (1 - target));
      S += y; t += n;
      return logK >= Math.log(1 / ALPHA);
    };
  },
  hoeffding: target => {
    let S = 0, t = 0;
    const rho = 250 / (2 * Math.log(1 / ALPHA) + Math.log(1 + 2 * Math.log(1 / ALPHA)));   // tight near 1,000 records
    return (y, n) => {
      S += y; t += n;
      const v = t / 4;
      return t * target - S >= Math.sqrt(2 * (v + rho) * Math.log(Math.sqrt((v + rho) / rho) / ALPHA));
    };
  },
  'naive Wilson, all so far': target => { let S = 0, t = 0; return (y, n) => { S += y; t += n; return wilson(S, t).high < target; }; },
  'naive Wilson, period alone': target => (y, n) => wilson(y, n).high < target,
};

function firstShown(make, target, n, rateAt, seed) {
  const r = rng(seed);
  const check = make(target);
  for (let t = 1; t <= PERIODS; t++) {
    const y = binom(n, rateAt(t))(r());
    if (check(y, n)) return t;
  }
  return null;
}

// Each period's rate drawn at random between 2% and 8% (5% on average): a run counts as wrong if,
// at any period, it shows "under 5%" while the average of the period rates so far (weighted by
// records, which are equal here) is 5% or more.
function everWrong(make, n) {
  let k = 0;
  for (let i = 0; i < RUNS2; i++) {
    const r = rng(11e6 + i), rr = rng(15e6 + i);
    const check = make(0.05);
    let sum = 0;
    for (let t = 1; t <= PERIODS; t++) {
      const rate = Math.round((0.02 + 0.06 * rr()) * 1e4) / 1e4;   // to 0.01%, so the samplers' cache stays small
      sum += rate;
      if (check(binom(n, rate)(r()), n) && sum / t >= 0.05) { k++; break; }
    }
  }
  return Number(((k / RUNS2) * 100).toFixed(1));
}

function part2() {
  console.log('\nPART 2: shown under 5%, checked after every period, ' + PERIODS + ' periods, ' + RUNS2 + ' runs');
  const rows = [];
  for (const n of [20, 50, 100]) {
    for (const [name, make] of Object.entries(bounds)) {
      const ever = rateAt => {
        let k = 0;
        for (let i = 0; i < RUNS2; i++) if (firstShown(make, 0.05, n, rateAt, 3e6 + i) !== null) k++;
        return Number(((k / RUNS2) * 100).toFixed(1));
      };
      const until = rate => {
        const ts = [];
        for (let i = 0; i < RUNS2; i++) { const t = firstShown(make, 0.05, n, () => rate, 7e6 + i); ts.push(t === null ? Infinity : t * n); }
        ts.sort((a, b) => a - b);
        const med = ts[Math.floor(RUNS2 / 2)];
        return med === Infinity ? 'not within ' + PERIODS * n : med;
      };
      rows.push({
        n, bound: name,
        'ever shown at 5% (%)': ever(() => 0.05),
        'ever shown, 8%/2% drift (%)': ever(t => (t % 2 === 1 ? 0.08 : 0.02)),
        'wrong, random 2-8% (%)': everWrong(make, n),
        'median records, true 2.5%': until(0.025),
        'median records, true 1%': until(0.01),
      });
    }
  }
  console.table(rows);
}

// ---------- Part 3 ----------
// The shipped CUSUM when the rate wobbles from period to period around p0 (each period's rate
// drawn at random, evenly, from the range shown): the binomial counts it assumes are then too
// steady, and false alarms come sooner than tuned.
function wobble() {
  console.log('\nCUSUM false alarms when the rate wobbles between periods (p0 = 2%, 50 records a period, tuned to one per ' + A + ' records; 3,000 runs)');
  const p0 = 0.02, p1 = 0.04, n = 50;
  const H = cusumThreshold(p0, p1, A, n);
  const rows = [];
  for (const [lo, hi] of [[0.02, 0.02], [0.015, 0.025], [0.01, 0.03], [0, 0.04]]) {
    let total = 0;
    for (let i = 0; i < RUNS; i++) {
      const r = rng(21e6 + i), rr = rng(25e6 + i);
      const step = detectors.cusum(p0, p1, H);
      let t = 1;
      for (; t < Math.ceil((40 * A) / n); t++) {
        const rate = Math.round((lo + (hi - lo) * rr()) * 1e4) / 1e4;
        if (step(binom(n, rate)(r()), n)) break;
      }
      total += t * n;
    }
    rows.push({ 'period rates': (lo * 100) + '% to ' + (hi * 100) + '%', 'records per false alarm': Math.round(total / RUNS) });
  }
  console.table(rows);
}

// ---------- Part 4 ----------
// What --since may restart. At a true rate of exactly the target (5%), weeks of 30, 104 weeks,
// the default alarm (2.5% to 5%): the share of runs that EVER show "under 5%" when, after each
// alarm, a person "fixes" nothing and restarts (a) nothing, (b) the alarm and the bound both, or
// (c) the alarm only, the bound counting every week (what --since does).
function restart() {
  console.log('\n--since: ever shown under 5% at a true 5% (weeks of 30, 104 weeks, ' + RUNS2 + ' runs)');
  const n = 30, sc = cusumScores(0.025, 0.05), H = cusumThreshold(0.025, 0.05, A, n), need = Math.log(1 / ALPHA);
  const rows = [];
  for (const how of ['never restart', 'restart the alarm and the bound after each alarm', 'restart the alarm only (--since)']) {
    let shown = 0, alarms = 0;
    for (let i = 0; i < RUNS2; i++) {
      const r = rng(31e6 + i);
      let S = 0, F = 0, C = 0, ever = false, raised = false;
      for (let t = 1; t <= PERIODS; t++) {
        const y = binom(n, 0.05)(r());
        S += y; F += n - y; C = cusumStep(C, y, n, sc);
        if (mixtureLogE(S, F, 0.05) >= need) ever = true;
        if (C >= H && !raised) {
          alarms++;
          if (how === 'never restart') raised = true;   // an alarm stays raised
          else C = 0;
          if (how.startsWith('restart the alarm and the bound')) { S = 0; F = 0; }
        }
      }
      if (ever) shown++;
    }
    rows.push({ after_each_alarm: how, 'alarms per run': Number((alarms / RUNS2).toFixed(1)), 'ever shown under 5% (%)': Number(((shown / RUNS2) * 100).toFixed(1)) });
  }
  console.table(rows);
}

// ---------- Part 5 ----------
// The default tuning, from the chain alone (no simulation): records per false alarm and records to
// an alarm for each --false-alarm-every, at 2.5% to 5% with 50 records a period; and, with the
// default for --target 5 (2.5% to 5%) and weeks of 30, the records to an alarm at steady rates
// from the acceptable rate to the target.
function tuning() {
  console.log('\nThe default tuning, from the chain (acceptable 2.5%, alarming 5%)');
  const rows = [];
  for (const every of [1000, 2000, 5000, 10000]) {
    const H = cusumThreshold(0.025, 0.05, every, 50);
    rows.push({ '--false-alarm-every': every, 'records per false alarm at 2.5%': Math.round(cusumArl(0.025, 0.05, H, 0.025, 50)),
      'records to flag 5%': Math.round(cusumArl(0.025, 0.05, H, 0.05, 50)), 'to flag 7.5%': Math.round(cusumArl(0.025, 0.05, H, 0.075, 50)) });
  }
  console.table(rows);
  const sc = cusumScores(0.025, 0.05), H = cusumThreshold(0.025, 0.05, A, 30);
  console.log('break-even rate ' + ((100 * sc.down) / (sc.up + sc.down)).toFixed(2) + '% (' + sc.down + ' / (' + sc.up + ' + ' + sc.down + ')); weeks of 30, alarm level ' + H);
  console.table([0.025, 0.03, 0.035, 0.04, 0.045, 0.05].map(p => ({ 'steady rate': (p * 100).toFixed(1) + '%', 'records to an alarm': Math.round(cusumArl(0.025, 0.05, H, p, 30)) })));
}

const which = process.argv[2] || 'all';
if (which === 'all' || which === 'chain') chainCheck();
if (which === 'all' || which === '1') part1();
if (which === 'all' || which === '2') part2();
if (which === 'all' || which === 'wobble') wobble();
if (which === 'all' || which === 'restart') restart();
if (which === 'all' || which === 'tuning') tuning();
