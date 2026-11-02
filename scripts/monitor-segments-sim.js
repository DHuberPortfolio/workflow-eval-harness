// The simulations behind `wfeval monitor --watch silent-omissions` and `--segment-by`
// (docs/METRICS.md, "Silent omissions over time" and "Each segment"). Seeded, so every run prints
// the same tables:
//
//   node scripts/monitor-segments-sim.js             (all of it, about 22 minutes)
//   node scripts/monitor-segments-sim.js omissions   (or alarms, bounds, small, whole, late or
//                                                     overlap: one part)
//
// Part 1 (omissions): the two methods on the blocked or suppressed records checked, which may be
// few a period and wrong far more often than records out without review are. The CUSUM's Markov
// chain against 20,000 simulated runs of the detector itself, at 1 to 10 records a period and
// acceptable rates of 5% to 20%; the bound's chance of EVER showing "under the target" when the
// true rate is the target, at those sizes; and how many periods a rise takes to flag.
// Part 2 (alarms): one CUSUM per segment, each with its alarm level set per records checked (the
// segment's own median period size, as the tool does), against the CUSUM of the whole. Segment
// sizes drawn at random every period around their shares (equal, uneven, and with segments of 1
// or 2 records a period). Under the acceptable rate everywhere: the records checked per false
// alarm across all segments together (each restarted after its alarm), against the whole's; and
// the records until the first false alarm anywhere in the report (the whole or any segment). Then
// a rise confined to one segment: the records until it is flagged (by its segment or the whole).
// Two budgets: every detector at --false-alarm-every (A), or every detector at 2A, so the whole
// and the segments together keep A.
// Part 3 (bounds): "shown under 5%" for several segments at once (the segments alone), checked
// after every period for 104 periods: per-segment 5% (no correction); Bonferroni, which on this
// bound is the same rule as e-Bonferroni (E >= S / alpha; Vovk & Wang 2021); Holm (1979) on the
// anytime p-values 1 / E; closed testing on the arithmetic mean of the e-values (Vovk & Wang 2021,
// section 5, Algorithm 1: src/metrics/monitor.js closedBars); and e-BH (Wang & Ramdas 2022), which
// controls the false discovery rate instead. The chance that ANY segment at the target is ever
// shown under it, and how soon segments truly under it are shown.
// Part 4 (small): the records a member needs, with no silent error at all, before it can be shown
// under the target, at its bar (from the formula, no simulation).
// Part 5 (whole): where the whole goes: apart, as an equal member, with the 5% split, or in a
// weighted closed test (the whole 1/2, the segments sharing 1/2: the shipped rule, familyBars). The
// chance anything in the report is ever wrongly shown, how soon the whole and the segments are
// shown, and how often a segment's upper bound (and any segment's) was ever below its true rate.
// Part 6 (late): segments that first appear in later weeks: the family seen so far against the
// family named in advance (--segments), and how often a printed "shown" is later taken back.
// Part 7 (overlap): records in two segments: the report's false alarms in all, and the time to flag
// a rise, with each segment's alarm set for the shared budget, or for it times the memberships per
// record (the correction, src/metrics/monitor.js overlapEvery).
'use strict';
const { cusumThreshold, cusumArl, mixtureLogE, cusumScores, cusumStep, closedBars, familyBars } = require('../src/metrics/monitor.js');

// mulberry32, as scripts/monitor-sim.js.
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
// Records per segment this period: the whole's N split at random by the shares (multinomial).
function split(N, shares, r) {
  const out = [];
  let left = N, rest = 1;
  for (let i = 0; i < shares.length; i++) {
    if (i === shares.length - 1) { out.push(left); break; }
    const p = Math.min(1, shares[i] / rest);
    const k = left === 0 ? 0 : binom(left, Math.round(p * 1e6) / 1e6)(r());
    out.push(k);
    left -= k;
    rest -= shares[i];
  }
  return out;
}
const median = xs => { const s = [...xs].sort((a, b) => a - b); const h = Math.floor(s.length / 2); return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const levels = new Map();
const levelFor = (p0, p1, A, n) => { const k = p0 + ':' + p1 + ':' + A + ':' + n; if (!levels.has(k)) levels.set(k, cusumThreshold(p0, p1, A, n)); return levels.get(k); };
// One CUSUM as src/metrics/monitor.js runs it: each period's level for the median size of the
// periods with records so far. restart: back to 0 after an alarm (to count false alarms).
function detector(p0, p1, A) {
  const sc = cusumScores(p0, p1);
  const sizes = [];
  let S = 0;
  return (y, n) => {
    if (n > 0) sizes.push(n);
    const size = sizes.length ? Math.max(1, Math.round(median(sizes))) : 1;
    const H = levelFor(p0, p1, A, size);
    S = cusumStep(S, y, n, sc);
    if (S >= H) { S = 0; return true; }
    return false;
  };
}

// ---------- Part 1: the omission series ----------
function omissions() {
  console.log('PART 1: the two methods on few records a period, at the higher rates of blocked records');
  console.log('CUSUM records to an alarm: chain against 20,000 simulated runs (from 0), one false alarm per 2,000 records at p0');
  const rows = [];
  for (const p0 of [0.05, 0.1, 0.2]) {
    const p1 = 2 * p0;
    for (const n of [1, 3, 5, 10]) {
      const H = cusumThreshold(p0, p1, 2000, n);
      const sc = cusumScores(p0, p1);
      for (const p of [p0, p1]) {
        const r = rng(41e6 + n), draw = binom(n, p);
        let total = 0;
        for (let i = 0; i < 20000; i++) {
          let S = 0, t = 0;
          do { S = cusumStep(S, draw(r()), n, sc); t++; } while (S < H);
          total += t * n;
        }
        const chain = cusumArl(p0, p1, H, p, n);
        rows.push({ p0, 'records a period': n, 'true rate': p, chain: Math.round(chain), simulated: Math.round(total / 20000), 'off by (%)': Number((100 * (total / 20000 / chain - 1)).toFixed(1)), 'periods': Number((chain / n).toFixed(1)) });
      }
    }
  }
  console.table(rows);

  console.log('\nThe bound: chance of EVER showing "under the target" at a true rate of exactly the target, 104 periods, 4,000 runs');
  const rows2 = [];
  for (const target of [0.05, 0.1, 0.2]) {
    for (const n of [1, 3, 5, 10]) {
      let k = 0;
      for (let i = 0; i < 4000; i++) {
        const r = rng(43e6 + i);
        let S = 0, F = 0;
        for (let t = 1; t <= 104; t++) {
          const y = binom(n, target)(r());
          S += y; F += n - y;
          if (mixtureLogE(S, F, target) >= Math.log(20)) { k++; break; }
        }
      }
      rows2.push({ target, 'records a period': n, 'ever shown (%)': Number(((100 * k) / 4000).toFixed(1)) });
    }
  }
  console.table(rows2);

  console.log('\nHow many periods to flag a rise to double, from the chain (acceptable 10%, alarming 20%)');
  const rows3 = [];
  for (const n of [3, 5, 10]) {
    for (const A of [250, 500, 1000, 2000]) {
      if (A <= n) continue;
      const H = cusumThreshold(0.1, 0.2, A, n);
      rows3.push({ 'records a period': n, '--false-alarm-every': A, 'periods per false alarm': Number((cusumArl(0.1, 0.2, H, 0.1, n) / n).toFixed(0)), 'periods to flag 20%': Number((cusumArl(0.1, 0.2, H, 0.2, n) / n).toFixed(1)) });
    }
  }
  console.table(rows3);
}

// ---------- Part 2: one alarm per segment ----------
const LAYOUTS = [
  ['5 equal segments, 50 a period', 50, [0.2, 0.2, 0.2, 0.2, 0.2]],
  ['uneven: 50/25/12.5/12.5%, 40 a period', 40, [0.5, 0.25, 0.125, 0.125]],
  ['10 segments, 2 to 10 a period', 50, [0.2, 0.2, 0.1, 0.1, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05]],
  ['small: 30 a period, one of 88% and three of 4%', 30, [0.88, 0.04, 0.04, 0.04]],
];
function alarms() {
  const p0 = 0.025, p1 = 0.05, A = 2000;
  console.log('\nPART 2: one CUSUM per segment (2.5% to 5%), sizes drawn at random every period around the shares');
  console.log('false alarms at 2.5% everywhere, each detector restarted after its alarm; 300 runs of 600 periods');
  const rows = [];
  for (const [name, N, shares] of LAYOUTS) {
    for (const budget of [A, 2 * A]) {
      let seg = 0, whole = 0, recs = 0;
      const firstAny = [];
      for (let i = 0; i < 300; i++) {
        const r = rng(51e6 + i);
        const dets = shares.map(() => detector(p0, p1, budget));
        const w = detector(p0, p1, budget);
        let first = null;
        for (let t = 1; t <= 600; t++) {
          const ns = split(N, shares, r);
          const ys = ns.map(n => binom(n, p0)(r()));
          let any = false;
          ns.forEach((n, s) => { if (dets[s](ys[s], n)) { seg++; any = true; } });
          if (w(ys.reduce((a, b) => a + b, 0), N)) { whole++; any = true; }
          recs += N;
          if (any && first === null) first = t * N;
        }
        firstAny.push(first === null ? 600 * N : first);
      }
      rows.push({
        layout: name, 'each detector set for': budget,
        'records per false alarm, segments together': Math.round(recs / seg),
        'the whole alone': Math.round(recs / whole),
        'whole and segments together': Math.round(recs / (seg + whole)),
        'records to the first false alarm anywhere': Math.round(firstAny.reduce((a, b) => a + b, 0) / firstAny.length),
      });
    }
  }
  console.table(rows);

  console.log('\nA rise to 5% in one segment only (the smallest, or the 12.5% one), from period 10: records checked in all (the whole\'s) from the rise to the first alarm on it (its segment or the whole); 2,000 runs, runs that false-alarmed before the rise left out');
  const rows2 = [];
  for (const [name, N, shares] of LAYOUTS) {
    const hit = shares.length - 1;
    for (const budget of [A, 2 * A]) {
      for (const where of ['one segment', 'every segment']) {
        let total = 0, used = 0, bySeg = 0;
        for (let i = 0; i < 2000; i++) {
          const r = rng(53e6 + i);
          const dets = shares.map(() => detector(p0, p1, budget));
          const w = detector(p0, p1, budget);
          let t = 1, early = false, found = null;
          for (; t <= 10 + Math.ceil(40000 / N); t++) {
            const ns = split(N, shares, r);
            const ys = ns.map((n, s) => binom(n, t >= 10 && (where === 'every segment' || s === hit) ? p1 : p0)(r()));
            const segAlarm = ns.map((n, s) => dets[s](ys[s], n));
            const wholeAlarm = w(ys.reduce((a, b) => a + b, 0), N);
            if (t < 10 && (segAlarm.some(Boolean) || wholeAlarm)) { early = true; break; }
            if (t >= 10 && ((where === 'one segment' ? segAlarm[hit] : segAlarm.some(Boolean)) || wholeAlarm)) { found = (where === 'one segment' ? segAlarm[hit] : segAlarm.some(Boolean)) ? 'segment' : 'whole'; break; }
          }
          if (early) continue;
          used++;
          total += (t - 10 + 1) * N;
          if (found === 'segment') bySeg++;
        }
        rows2.push({ layout: name, rise: where, 'each detector set for': budget, 'records to an alarm': Math.round(total / used), 'flagged by a segment first (%)': Math.round((100 * bySeg) / used) });
      }
    }
  }
  console.table(rows2);
}

// ---------- Part 3: shown under the target, several segments at once ----------
const ALPHA = 0.05;
// Each takes the segments' e-values (E, not logs: Infinity is fine) and returns which are shown.
const methods = {
  'per segment, 5% each': E => E.map(e => e >= 1 / ALPHA),
  'Bonferroni = e-Bonferroni (E >= S/alpha)': E => E.map(e => e >= E.length / ALPHA),
  'Holm on 1/E': E => {
    const order = E.map((e, i) => i).sort((a, b) => E[b] - E[a]);
    const shown = E.map(() => false);
    for (let i = 0; i < order.length; i++) { if (E[order[i]] >= (E.length - i) / ALPHA) shown[order[i]] = true; else break; }
    return shown;
  },
  // src/metrics/monitor.js closedBars (test/monitor.test.js checks it against every subset).
  'closed testing, mean of E (Vovk & Wang)': E => { const bars = closedBars(E.map(Math.log)); return E.map((e, k) => e >= bars[k]); },
  'e-BH (Wang & Ramdas; false discovery rate)': E => {
    const order = E.map((e, i) => i).sort((a, b) => E[b] - E[a]);
    let k = 0;
    for (let j = 1; j <= order.length; j++) if (E[order[j - 1]] >= E.length / (ALPHA * j)) k = j;
    const shown = E.map(() => false);
    for (let j = 0; j < k; j++) shown[order[j]] = true;
    return shown;
  },
};
const SCENARIOS = [
  ['all at 5%', S => Array(S).fill(0.05)],
  ['half at 5%, half at 2.5%', S => Array.from({ length: S }, (_, i) => (i < S / 2 ? 0.05 : 0.025))],
  ['one at 5%, the rest at 2.5%', S => Array.from({ length: S }, (_, i) => (i === 0 ? 0.05 : 0.025))],
  ['all at 2.5%', S => Array(S).fill(0.025)],
  ['one at 8%, the rest at 2.5%', S => Array.from({ length: S }, (_, i) => (i === 0 ? 0.08 : 0.025))],
];
function bounds() {
  const RUNS = 2000, T = 104, target = 0.05;
  console.log('\nPART 3: shown under 5% for several segments at once (the segments alone), checked after every period, ' + T + ' periods, ' + RUNS + ' runs');
  console.log('wrong: the chance that ANY segment at or above 5% is ever shown under it; under: of the segments truly under 5%, the share shown by period 26 and 52, and the median records (that segment\'s) to the first "shown"');
  const rows = [];
  for (const [label, n] of [['20 a period each', S => Array(S).fill(20)], ['uneven: 40, then 10 each', S => Array.from({ length: S }, (_, i) => (i === 0 ? 40 : 10))]]) {
    for (const S of [2, 5, 10]) {
      const sizes = n(S);
      for (const [scen, rates] of SCENARIOS) {
        const p = rates(S);
        const res = Object.fromEntries(Object.keys(methods).map(m => [m, { wrong: 0, by26: 0, by52: 0, under: 0, firsts: [] }]));
        for (let i = 0; i < RUNS; i++) {
          const r = rng(61e6 + i);
          const s = Array(S).fill(0), f = Array(S).fill(0);
          const state = Object.fromEntries(Object.keys(methods).map(m => [m, { wrong: false, first: Array(S).fill(null) }]));
          for (let t = 1; t <= T; t++) {
            for (let k = 0; k < S; k++) { const y = binom(sizes[k], p[k])(r()); s[k] += y; f[k] += sizes[k] - y; }
            const E = s.map((x, k) => Math.exp(mixtureLogE(x, f[k], target)));
            for (const [m, fn] of Object.entries(methods)) {
              const shown = fn(E);
              shown.forEach((on, k) => {
                if (!on) return;
                if (p[k] >= target) state[m].wrong = true;
                else if (state[m].first[k] === null) state[m].first[k] = t;
              });
            }
          }
          for (const m of Object.keys(methods)) {
            if (state[m].wrong) res[m].wrong++;
            p.forEach((x, k) => {
              if (x >= target) return;
              res[m].under++;
              const t0 = state[m].first[k];
              if (t0 !== null && t0 <= 26) res[m].by26++;
              if (t0 !== null && t0 <= 52) res[m].by52++;
              res[m].firsts.push(t0 === null ? Infinity : t0 * sizes[k]);
            });
          }
        }
        for (const [m, x] of Object.entries(res)) {
          const anyNull = p.some(v => v >= target), anyUnder = p.some(v => v < target);
          const med = x.firsts.length ? x.firsts.sort((a, b) => a - b)[Math.floor(x.firsts.length / 2)] : null;
          rows.push({
            sizes: label, S, rates: scen, method: m,
            'wrong (%)': anyNull ? Number(((100 * x.wrong) / RUNS).toFixed(1)) : '',
            'under: shown by 26 (%)': anyUnder ? Number(((100 * x.by26) / x.under).toFixed(1)) : '',
            'by 52 (%)': anyUnder ? Number(((100 * x.by52) / x.under).toFixed(1)) : '',
            'median records': anyUnder ? (med === Infinity ? 'not within ' + T : med) : '',
          });
        }
      }
    }
  }
  console.table(rows);
}

// ---------- Part 4: how small is too small ----------
// With the whole in the family (Part 5), a segment's bar is 20 + m x the whole's shortfall + the
// other segments' shortfalls: 20 when all of their evidence is strong, 40 m when none has any. The
// whole's bar is 20 to 40.
function small() {
  console.log('\nPART 4: records with no silent error at all before a member can be shown under the target, at its bar');
  const need = (target, bar) => { let F = 0; while (mixtureLogE(0, F, target) < Math.log(bar)) F++; return F; };
  const rows = [];
  for (const target of [0.02, 0.05, 0.1]) {
    const row = { target: target * 100 + '%', 'bar 20 (one series; any member, all others strong)': need(target, 20), 'the whole at most (bar 40)': need(target, 40) };
    for (const m of [2, 5, 10, 20]) row['a segment at most, ' + m + ' segments (bar ' + 40 * m + ')'] = need(target, 40 * m);
    rows.push(row);
  }
  console.table(rows);
}

// ---------- Part 5: where the whole goes ----------
// The whole's "shown" and the segments' in one report. Four ways, all on the same evidence:
//   O1 the whole apart at 5%, the segments' closed test at 5% (the report up to 10%);
//   O2 the whole in the segments' closed test, as one more member of equal weight;
//   O3 split: the whole at 2.5% (E >= 40), the segments' closed test at 2.5%;
//   O4 (shipped, src/metrics/monitor.js familyBars) a weighted closed test, the whole 1/2 and the
//      segments sharing 1/2 (the weighted average of e-values is an e-value: Vovk & Wang 2021).
// "Any wrong": the chance that anything in the report (the whole or a segment) at or above the
// target is ever shown under it. For O4 also: a given segment's upper bound ever below its true rate
// (the worst segment), and ANY segment's.
const OPTIONS = {
  O1: (Ew, Es) => ({ whole: Ew >= 20, segs: closedBars(Es.map(Math.log)).map((b, k) => Es[k] >= b) }),
  O2: (Ew, Es) => { const all = [Ew, ...Es], bars = closedBars(all.map(Math.log)); return { whole: Ew >= bars[0], segs: Es.map((e, k) => e >= bars[k + 1]) }; },
  O3: (Ew, Es) => ({ whole: Ew >= 40, segs: closedBars(Es.map(Math.log), 0.025).map((b, k) => Es[k] >= b) }),
  O4: (Ew, Es) => { const b = familyBars(Math.log(Ew), Es.map(Math.log)); return { whole: Ew >= b.whole, segs: Es.map((e, k) => e >= b.segments[k]) }; },
};
const SCEN_W = [
  ['all at 5%', m => Array(m).fill(0.05)],
  ['half at 5%, half at 2.5%', m => Array.from({ length: m }, (_, i) => (i < m / 2 ? 0.05 : 0.025))],
  ['all at 2.5%', m => Array(m).fill(0.025)],
  ['one at 8%, the rest at 2.5%', m => Array.from({ length: m }, (_, i) => (i === 0 ? 0.08 : 0.025))],
  ['the whole at 5%: one at 10%, the rest under', m => Array.from({ length: m }, (_, i) => (i === 0 ? 0.1 : (0.05 * m - 0.1) / (m - 1)))],
  ['all at 4%', m => Array(m).fill(0.04)],
];
const medianOf = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
function whole() {
  const RUNS = 2000, T = 104, target = 0.05;
  console.log('\nPART 5: where the whole goes: the whole and m segments, checked after every period, ' + T + ' periods, ' + RUNS + ' runs (the whole is the segments added up)');
  const rows = [];
  for (const [label, sizesOf] of [['20 each', m => Array(m).fill(20)], ['40, then 10 each', m => Array.from({ length: m }, (_, i) => (i === 0 ? 40 : 10))]]) {
    for (const m of [5, 10]) {
      const n = sizesOf(m), N = n.reduce((a, b) => a + b, 0);
      for (const [scen, ratesOf] of SCEN_W) {
        const p = ratesOf(m);
        const pooled = p.reduce((t, x, i) => t + x * n[i], 0) / N;
        const wholeNull = pooled >= target - 1e-12;
        const res = Object.fromEntries(Object.keys(OPTIONS).map(o => [o, { wrong: 0, w52: 0, wFirst: [], s52: 0, sUnder: 0, sFirst: [] }]));
        const missed = Array(m).fill(0);
        let missedAny = 0;
        for (let r = 0; r < RUNS; r++) {
          const u = rng(77e6 + r);
          const s = Array(m).fill(0), f = Array(m).fill(0);
          let sw = 0, fw = 0;
          const st = Object.fromEntries(Object.keys(OPTIONS).map(o => [o, { wrong: false, wFirst: null, sFirst: Array(m).fill(null) }]));
          const miss = Array(m).fill(false);
          for (let t = 1; t <= T; t++) {
            for (let k = 0; k < m; k++) { const y = binom(n[k], p[k])(u()); s[k] += y; f[k] += n[k] - y; sw += y; fw += n[k] - y; }
            const logs = s.map((x, k) => mixtureLogE(x, f[k], target)), logW = mixtureLogE(sw, fw, target);
            const Es = logs.map(l => Math.exp(Math.min(l, 700))), Ew = Math.exp(Math.min(logW, 700));
            for (const [o, fn] of Object.entries(OPTIONS)) {
              const out = fn(Ew, Es), q = st[o];
              if (out.whole) { if (wholeNull) q.wrong = true; else if (q.wFirst === null) q.wFirst = t; }
              out.segs.forEach((on, k) => { if (!on) return; if (p[k] >= target) q.wrong = true; else if (q.sFirst[k] === null) q.sFirst[k] = t; });
            }
            // O4's upper bound of each segment: below its true rate exactly when E at that rate (above
            // the rate seen) reaches the segment's bar, since E rises with the rate tested.
            const bars = familyBars(logW, logs).segments;
            for (let k = 0; k < m; k++) if (!miss[k] && p[k] > s[k] / (s[k] + f[k]) && mixtureLogE(s[k], f[k], p[k]) >= Math.log(bars[k])) miss[k] = true;
          }
          miss.forEach((x, k) => { if (x) missed[k]++; });
          if (miss.some(Boolean)) missedAny++;
          for (const o of Object.keys(OPTIONS)) {
            const q = st[o], x = res[o];
            if (q.wrong) x.wrong++;
            if (!wholeNull) { if (q.wFirst !== null && q.wFirst <= 52) x.w52++; x.wFirst.push(q.wFirst === null ? Infinity : q.wFirst * N); }
            p.forEach((pk, k) => { if (pk >= target) return; x.sUnder++; const t0 = q.sFirst[k]; if (t0 !== null && t0 <= 52) x.s52++; x.sFirst.push(t0 === null ? Infinity : t0 * n[k]); });
          }
        }
        for (const [o, x] of Object.entries(res)) {
          const anyNull = wholeNull || p.some(v => v >= target);
          const wm = medianOf(x.wFirst), sm = medianOf(x.sFirst);
          rows.push({
            sizes: label, m, rates: scen, 'the whole': (100 * pooled).toFixed(2) + '%', option: o,
            'any wrong (%)': anyNull ? Number(((100 * x.wrong) / RUNS).toFixed(1)) : '',
            'whole shown by 52 (%)': wholeNull ? '' : Number(((100 * x.w52) / RUNS).toFixed(1)),
            'whole median records': wholeNull ? '' : wm === Infinity ? 'not within ' + T : wm,
            'segments by 52 (%)': x.sUnder ? Number(((100 * x.s52) / x.sUnder).toFixed(1)) : '',
            'segments median records': x.sUnder ? (sm === Infinity ? 'not within ' + T : sm) : '',
            'O4 bound below: worst segment (%)': o === 'O4' ? Number(((100 * Math.max(...missed)) / RUNS).toFixed(1)) : '',
            'O4 bound below: any segment (%)': o === 'O4' ? Number(((100 * missedAny) / RUNS).toFixed(1)) : '',
          });
        }
      }
    }
  }
  console.table(rows);
}

// ---------- Part 6: segments that first appear later ----------
// Each week a person runs the report on the weeks so far. Without --segments the family is the
// segments seen so far (with the whole; Part 5's O4), so the report printed in week t used a smaller
// family than a later report will. With --segments it is every segment named, plus (other) and
// (none), from week 1 (E = 1 until a segment's first records). Every segment here is at exactly 5%
// or under; 20 records a week each. Measured: the chance that ANY report ever printed a wrong
// "shown" (the whole or a segment at or above 5%), and the share of runs in which a "shown" printed
// one week is taken back in the last report's history.
const SCEN_L = [
  ['2 at 5%: A from week 1, B from week 27', [[1, 0.05], [27, 0.05]]],
  ['2 at 5%: A from week 1, B from week 9', [[1, 0.05], [9, 0.05]]],
  ['5 at 5%: A from week 1, 4 from week 53', [[1, 0.05], [53, 0.05], [53, 0.05], [53, 0.05], [53, 0.05]]],
  ['10 at 5%, one more every 5 weeks', Array.from({ length: 10 }, (_, k) => [1 + 5 * k, 0.05])],
  ['10 at 5%, one more every week', Array.from({ length: 10 }, (_, k) => [1 + k, 0.05])],
  ['A at 5% from week 1, 4 at 2.5% from week 13', [[1, 0.05], [13, 0.025], [13, 0.025], [13, 0.025], [13, 0.025]]],
];
function late() {
  const RUNS = 2000, T = 104, n = 20, target = 0.05;
  console.log('\nPART 6: segments that first appear later, the whole and the segments as one family (shipped rule), ' + T + ' weeks, ' + RUNS + ' runs');
  const rows = [];
  for (const [label, segs] of SCEN_L) {
    const m = segs.length;
    let printed = 0, declared = 0, takenBack = 0;
    for (let r = 0; r < RUNS; r++) {
      const u = rng(91e6 + r);
      const s = Array(m).fill(0), f = Array(m).fill(0);
      const hist = [];
      let wp = false, wd = false;
      for (let t = 1; t <= T; t++) {
        for (let k = 0; k < m; k++) if (t >= segs[k][0]) { const y = binom(n, segs[k][1])(u()); s[k] += y; f[k] += n - y; }
        const sw = s.reduce((a, b) => a + b, 0), fw = f.reduce((a, b) => a + b, 0);
        const logs = s.map((x, k) => mixtureLogE(x, f[k], target)), logW = mixtureLogE(sw, fw, target);
        const wholeAtTarget = segs.filter(([a]) => t >= a).every(([, q]) => q >= target);
        // As printed: the segments seen so far.
        const idx = segs.map(([a], k) => (t >= a ? k : -1)).filter(k => k >= 0);
        const b = familyBars(logW, idx.map(k => logs[k]));
        const shownWhole = logW >= Math.log(b.whole), shownSeg = Array(m).fill(false);
        idx.forEach((k, j) => { if (logs[k] >= Math.log(b.segments[j])) shownSeg[k] = true; });
        if ((shownWhole && wholeAtTarget) || shownSeg.some((on, k) => on && segs[k][1] >= target)) wp = true;
        hist.push({ logs: [...logs], logW, shownWhole, shownSeg, wholeAtTarget });
        // Named in advance: every segment, (other) and (none), from week 1.
        const d = familyBars(logW, [...logs, 0, 0]);
        if ((logW >= Math.log(d.whole) && wholeAtTarget) || logs.some((l, k) => segs[k][1] >= target && l >= Math.log(d.segments[k]))) wd = true;
      }
      // The last report's history: the family is every segment that came; a "shown" printed earlier that it does not show is taken back.
      let back = false;
      hist.forEach(h => {
        const b = familyBars(h.logW, h.logs);
        if (h.shownWhole && !(h.logW >= Math.log(b.whole))) back = true;
        h.shownSeg.forEach((on, k) => { if (on && !(h.logs[k] >= Math.log(b.segments[k]))) back = true; });
      });
      if (wp) printed++;
      if (wd) declared++;
      if (back) takenBack++;
    }
    rows.push({
      segments: label,
      'any wrong "shown" ever printed, family seen so far (%)': Number(((100 * printed) / RUNS).toFixed(2)),
      'named in advance (%)': Number(((100 * declared) / RUNS).toFixed(2)),
      'runs where a printed "shown" is taken back (%)': Number(((100 * takenBack) / RUNS).toFixed(2)),
    });
  }
  console.table(rows);
}

// ---------- Part 7: segments that overlap ----------
// A record can carry several segment values (a message in by chat and by email) and then counts in
// each. Set per records checked, the segments' alarms then false-alarm as often as their
// memberships, which are more than the records. N records a period, each in a first segment at
// random by the shares and, with chance o, in a second one too; every record at 2.5%, or, for the
// rise, the records whose first segment is the last one at 5% from period 10. The whole is set for
// 2A (as with segments, Part 2). The segments, two ways: each set for 2A (as before), or for 2A
// times the memberships per record so far, rounded up to a twentieth (the correction, as
// src/metrics/monitor.js overlapEvery does). Measured as in Part 2: records checked per false alarm
// in all (each detector restarted after its alarm; 300 runs of 600 periods), and records from the
// rise to the first alarm on its segment or the whole (2,000 runs).
const overlapBudget = (each, memberships, records) => {
  if (!(records > 0) || memberships <= records) return each;
  return Math.round(each * (Math.ceil((memberships / records) * 20 - 1e-9) / 20));
};
function detectorAt(p0, p1) {
  const sc = cusumScores(p0, p1);
  const sizes = [];
  let S = 0;
  return (y, n, A) => {
    if (n > 0) sizes.push(n);
    const size = sizes.length ? Math.max(1, Math.round(median(sizes))) : 1;
    const H = levelFor(p0, p1, A, size);
    S = cusumStep(S, y, n, sc);
    if (S >= H) { S = 0; return true; }
    return false;
  };
}
function overlap() {
  const p0 = 0.025, p1 = 0.05, A = 2000;
  console.log('\nPART 7: segments that overlap: a share of the records in two segments (2.5% to 5%; the whole and every segment set for 2A = 4,000, or the segments for 2A x memberships per record)');
  const layouts = [['5 equal segments, 50 a period', 50, [0.2, 0.2, 0.2, 0.2, 0.2]], ['uneven: 50/25/12.5/12.5%, 40 a period', 40, [0.5, 0.25, 0.125, 0.125]]];
  const rows = [];
  for (const [name, N, shares] of layouts) {
    const S = shares.length, hit = S - 1;
    const pick = (r, not) => { for (;;) { let u = r(), k = 0; while (k < S - 1 && u > shares[k]) { u -= shares[k]; k++; } if (k !== not) return k; } };
    for (const o of [0, 0.1, 0.3, 0.6]) {
      for (const rule of ['each segment 2A', 'segments 2A x memberships per record']) {
        if (o === 0 && rule !== 'each segment 2A') continue;   // no overlap: the two are the same
        const week = (r, t, rise) => {
          const n = Array(S).fill(0), y = Array(S).fill(0);
          let wy = 0, members = 0;
          for (let i = 0; i < N; i++) {
            const a = pick(r, -1), b = r() < o ? pick(r, a) : -1;
            const wrong = r() < (rise && t >= 10 && a === hit ? p1 : p0) ? 1 : 0;
            wy += wrong;
            for (const k of b < 0 ? [a] : [a, b]) { n[k]++; y[k] += wrong; members++; }
          }
          return { n, y, wy, members };
        };
        // False alarms in all.
        let alarms = 0, recs = 0;
        for (let run = 0; run < 300; run++) {
          const r = rng(71e6 + run);
          const dets = shares.map(() => detectorAt(p0, p1)), w = detectorAt(p0, p1);
          let members = 0;
          for (let t = 1; t <= 600; t++) {
            const x = week(r, t, false);
            members += x.members; recs += N;
            const each = rule === 'each segment 2A' ? 2 * A : overlapBudget(2 * A, members, t * N);
            x.n.forEach((n, k) => { if (dets[k](x.y[k], n, each)) alarms++; });
            if (w(x.wy, N, 2 * A)) alarms++;
          }
        }
        // A rise in the last segment's own records.
        let total = 0, used = 0;
        for (let run = 0; run < 2000; run++) {
          const r = rng(73e6 + run);
          const dets = shares.map(() => detectorAt(p0, p1)), w = detectorAt(p0, p1);
          let members = 0, t = 1, early = false;
          for (; t <= 10 + Math.ceil(40000 / N); t++) {
            const x = week(r, t, true);
            members += x.members;
            const each = rule === 'each segment 2A' ? 2 * A : overlapBudget(2 * A, members, t * N);
            const segAlarm = x.n.map((n, k) => dets[k](x.y[k], n, each));
            const wholeAlarm = w(x.wy, N, 2 * A);
            if (t < 10 && (segAlarm.some(Boolean) || wholeAlarm)) { early = true; break; }
            if (t >= 10 && (segAlarm[hit] || wholeAlarm)) break;
          }
          if (early) continue;
          used++;
          total += (t - 10 + 1) * N;
        }
        rows.push({ layout: name, 'in two segments': (100 * o) + '%', segments: rule, 'records per false alarm in all': Math.round(recs / alarms), 'records to flag a rise in one segment': Math.round(total / used) });
      }
    }
  }
  console.table(rows);
}

const which = process.argv[2] || 'all';
if (which === 'all' || which === 'omissions') omissions();
if (which === 'all' || which === 'alarms') alarms();
if (which === 'all' || which === 'bounds') bounds();
if (which === 'all' || which === 'small') small();
if (which === 'all' || which === 'whole') whole();
if (which === 'all' || which === 'late') late();
if (which === 'all' || which === 'overlap') overlap();
