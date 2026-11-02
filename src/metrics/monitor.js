// Live samples over time (wfeval monitor): the arithmetic. Pure functions, no files.
//
// After launch, a person checks a sample of the records that went out without review every week
// or month. Two questions, each with its own method (docs/METRICS.md, "Live samples over time";
// the simulations that chose them: scripts/monitor-sim.js):
//
// 1. Has the silent error rate gone up? A one-sided CUSUM (Page 1954) of the binomial
//    log-likelihood ratio, from an acceptable rate p0 to an alarming rate p1 (the Bernoulli
//    CUSUM of Reynolds & Stoumbos 1999, one update per period).
// 2. Is it shown to be under the target, in a way that stays valid however often you look? A
//    one-sided confidence sequence: the beta-binomial mixture (Robbins 1970; Howard, Ramdas,
//    McAuliffe & Sekhon 2021), with the mixing rates spread evenly below the target.
//
// Rates are proportions here (0.05 is 5%).
//
// The same arithmetic watches the records the workflow blocked or suppressed (--watch
// silent-omissions): its base is then those records checked, and what counts against it the silent
// omissions among them. And each segment of the traffic (--segment-by) gets its own CUSUM and bound
// beside the whole's (monitorSegments, at the end).

const { rate } = require('./stats.js');
const { targetCheck } = require('./target.js');

// ---------- 1. The CUSUM ----------
//
// Each record checked adds the log of how much likelier it is at p1 than at p0:
//   ln(p1 / p0)              for a silent error (positive)
//   ln((1 - p1) / (1 - p0))  for a record that was right (negative)
// In whole-number scores, as Reynolds & Stoumbos (1999) do for the Bernoulli CUSUM: a right record
// takes `down` steps off, a silent error adds `up` steps, with up / down the ratio of those two logs
// rounded to whole steps (down chosen so up is at least 50: the rounding moves the ratio by at
// most 1%). Whole steps make the Markov chain below exact for the detector itself; it matches a
// simulation of the same detector within 1.3% (scripts/monitor-sim.js chain).
// A period with y silent errors of n records adds y up - (n - y) down:
//   S = max(0, S + y up - (n - y) down),  starting at 0;  ALARM when S >= H.
// The order of records inside a period is not known, so S is floored at 0 only at a period's end.
function cusumScores(p0, p1) {
  if (!(p0 > 0 && p1 > p0 && p1 < 1)) throw new RangeError('the CUSUM needs 0 < acceptable < alarming < 1');
  const lnUp = Math.log(p1 / p0), lnDown = -Math.log((1 - p1) / (1 - p0));
  const down = Math.max(1, Math.ceil((50 * lnDown) / lnUp));
  return { up: Math.round((down * lnUp) / lnDown), down, step: lnDown / down };
}

// One period: S after it, from S before it.
const cusumStep = (S, y, n, scores) => Math.max(0, S + y * scores.up - (n - y) * scores.down);

// The chances of y silent errors in n records at a rate p, worked in logarithms from y = 0, so a
// big period cannot underflow them to 0 ((1 - p)^n is 0 in floating point at 3,000 records and
// 25%). Only the y within e^-40 of the likeliest are kept: { from: the first y kept, probs }.
function binomialChances(n, p) {
  const lp = Math.log(p), lq = Math.log1p(-p);
  const logs = new Float64Array(n + 1);
  let lc = 0, max = -Infinity;   // lc: ln C(n, y)
  for (let y = 0; y <= n; y++) {
    if (y > 0) lc += Math.log((n - y + 1) / y);
    logs[y] = lc + (y === 0 ? 0 : y * lp) + (y === n ? 0 : (n - y) * lq);
    if (logs[y] > max) max = logs[y];
  }
  let from = 0, to = n;
  while (logs[from] < max - 40) from++;
  while (logs[to] < max - 40) to--;
  const probs = [];
  for (let y = from; y <= to; y++) probs.push(Math.exp(logs[y]));
  return { from, probs };
}

// The most steps an alarm level may take: past this the chain is too big to follow.
const MAX_LEVEL = 4000000;

// Average periods until the alarm, from S = 0, with n records checked a period at a true rate p
// and the alarm at S >= H (a Markov chain: Brook & Evans 1972). Follows the chance of each value
// of S period by period (the states 0..H-1; the rest has alarmed) and adds up the chance of no
// alarm yet. Once the chance left shrinks by the same factor every period, the rest of the sum is
// a geometric series.
function chainArl(scores, H, n, p) {
  const { up: m, down: K } = scores;
  const { from: y0, probs } = binomialChances(n, p);
  let dist = new Float64Array(H), next = new Float64Array(H);
  dist[0] = 1;
  let total = 0, mass = 1, lastRatio = 0, steady = 0;
  for (let t = 0; t < 10000000; t++) {
    total += mass;
    next.fill(0);
    for (let s = 0; s < H; s++) {
      const d = dist[s];
      if (d === 0) continue;
      for (let j = 0; j < probs.length; j++) {
        const y = y0 + j;
        const to = s + y * m - (n - y) * K;
        if (to >= H) break;
        next[to < 0 ? 0 : to] += d * probs[j];
      }
    }
    const now = next.reduce((a, b) => a + b, 0);
    const ratio = now / mass;
    [dist, next] = [next, dist];
    mass = now;
    if (mass < 1e-13) break;
    steady = Math.abs(ratio - lastRatio) < 1e-12 ? steady + 1 : 0;
    lastRatio = ratio;
    // A chance left that no longer shrinks at all (a level far above anything the rate reaches):
    // no alarm, ever, in floating point.
    if (steady >= 20) return ratio < 1 ? total + mass / (1 - ratio) : Infinity;
  }
  return total;
}

// The average number of records checked until an alarm at a true rate p, for the CUSUM from p0 to
// p1 with the alarm at H steps, checked after every period of n records. At p0 it is the records
// per false alarm; at a higher rate, how soon a rise to it is flagged (from a standing start).
function cusumArl(p0, p1, H, p, n = 1) {
  return n * chainArl(cusumScores(p0, p1), H, n, p);
}

// The alarm level H for at most one false alarm per `records` records checked at p0, in periods of
// n records, set exactly by the chain (cusumArl). Lorden's (1971) guaranteed bound, h = ln(records / n)
// in log units (at least e^h periods per false alarm), is always enough, so it gives the top of the
// search; it is not used itself because it flags a real rise much later
// (scripts/monitor-sim.js). Smaller periods false-alarm more often at the same H (n = 1, a check
// after every record, most often of all), which is why the size matters.
function cusumThreshold(p0, p1, records, n = 1) {
  if (!(records > n)) throw new RangeError('records per false alarm must be more than the records in one period');
  const scores = cusumScores(p0, p1);
  let lo = 1, hi = Math.max(2, Math.ceil(Math.log(records / n) / scores.step));
  // Lorden's bound is for the exact logs; whole steps can fall a little short of it, so make sure.
  while (n * chainArl(scores, hi, n, p0) < records) {
    hi *= 2;
    if (hi > MAX_LEVEL) throw new Error('could not set the alarm level for one false alarm per ' + records + ' records in periods of ' + n + ': ask for fewer records per false alarm (--false-alarm-every)');
  }
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (n * chainArl(scores, mid, n, p0) >= records) hi = mid; else lo = mid + 1;
  }
  return lo;
}

// ---------- 2. The confidence sequence ----------
//
// To show the rate is under `target`, bet against "the rate is target or more". After S silent
// errors and F right records, the evidence is the likelihood of each rate q below the target
// against the target's own, averaged over q spread evenly from 0 to the target:
//   E = (1 / target) * integral from 0 to target of (q / target)^S ((1 - q) / (1 - target))^F dq
// While the true rate is at or above the target, every period's records multiply E by 1 or less
// on average (a supermartingale), so the chance E EVER reaches 1 / alpha is at most alpha (Ville
// 1939), however often it is looked at. Shown under the target: E >= 20 (alpha = 5%).
// The integral in closed form (x = q / target, then term by term; the binomial-tail form of the
// incomplete beta function), with r = target / (1 - target):
//   E = 1/(S+1) * sum over i = 0..F of  prod over k < i of  r (F - k) / (S + 2 + k)
// summed in logarithms, because E can pass e^700 on a few thousand records.
function mixtureLogE(S, F, target) {
  if (!(target > 0 && target < 1)) throw new RangeError('target must be between 0 and 1');
  const lr = Math.log(target / (1 - target));
  let term = -Math.log(S + 1);
  let max = term, sum = 1;   // the sum so far, as a multiple of e^max
  for (let i = 0; i < F; i++) {
    term += Math.log(F - i) - Math.log(S + 2 + i) + lr;
    if (term > max) { sum = sum * Math.exp(max - term) + 1; max = term; }
    else {
      sum += Math.exp(term - max);
      if (term < max - 40) break;   // the terms only fall from here: the rest adds under e^-40 of the sum
    }
  }
  return max + Math.log(sum);
}

// The upper bound: the lowest rate the evidence rules out with E >= 1 / alpha, found by
// halving between the rate seen and 100%. E rises with the rate tested above the rate seen
// (test/monitor.test.js checks it), so every rate above the bound is ruled out too.
// null with nothing checked.
function mixtureUpper(S, F, alpha = 0.05) {
  const t = S + F;
  if (t === 0) return null;
  const need = Math.log(1 / alpha);
  let lo = S / t, hi = 1 - 1e-12;
  if (mixtureLogE(S, F, hi) < need) return 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mid <= 0 || mixtureLogE(S, F, mid) < need) lo = mid; else hi = mid;
  }
  return hi;
}

// ---------- Period by period ----------

const ALPHA = 0.05;   // 95%, as everywhere in this tool
const round1 = x => Number(x.toFixed(1));
const pctOf = x => Number((x * 100).toPrecision(12));   // 0.025 -> 2.5, without 2.5000000000000004
const median = xs => { const s = [...xs].sort((a, b) => a - b); const h = Math.floor(s.length / 2); return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

// Records out without review, none of them a silent error, the bound needs to show `target`.
// E rises with every right record, so doubling then halving finds the first that reaches 20 (or
// `bar`: a segment's, counting the other segments; see closedBars).
function perfectRunAnytime(target, bar = 1 / ALPHA) {
  const enough = F => mixtureLogE(0, F, target) >= Math.log(bar);
  let hi = 1;
  while (!enough(hi)) { hi *= 2; if (hi > 1000000) return Infinity; }
  let lo = Math.floor(hi / 2);
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (enough(mid)) hi = mid; else lo = mid; }
  return hi;
}


// An upper bound as a percentage: one decimal, or more when one decimal would print the target
// itself (4.98% is under 5%; "upper bound 5.0%" beside "shown under 5%" reads as a contradiction).
function boundPct(upper, target) {
  let d = 1;
  while (d < 4 && target !== null && Number((upper * 100).toFixed(d)) === pctOf(target)) d++;
  return Number((upper * 100).toFixed(d));
}

// periods: [{ period, out, silent }] in time order: records out without review checked, and
// silent errors among them. acceptable, alarming, target: proportions (target may be null).
// falseAlarmEvery: records checked per false alarm at the acceptable rate, at the least.
// from: the index of the period the ALARM restarts at (--since, after an alarm was looked into);
// the bound always counts every period, because a restart chosen after an alarm is chosen by the
// numbers, and restarting the bound there would break its 5% (scripts/monitor-sim.js restart).
// periodSize: the period size the alarm level is set for (--period-size), or null: then each
// row's level is set for the median size of the periods up to it, from the restart on, so a
// status once printed never changes when later periods arrive.
// light: for a segment's series (monitorSegments): the alarm only, with no upper bound per row, no
// "shown" (the family's closed test sets those) and none of the bound's or the design's figures,
// which only the whole's report prints.
// Alarm levels already set, by their settings and period size: the chain behind one takes a moment,
// and with segments the same level is asked for again and again. cusumThreshold is a pure function
// of these four numbers, so a level kept is the level it would set again.
const LEVELS = new Map();
// falseAlarmEvery may also be a list, one budget per period (a segment's, when segments overlap:
// monitorSegments), each row's level then set for its own.
function monitorSeries(periods, { acceptable, alarming, target = null, falseAlarmEvery = 2000, from = 0, periodSize = null, light = false }) {
  const scores = cusumScores(acceptable, alarming);
  const everyAt = i => (Array.isArray(falseAlarmEvery) ? falseAlarmEvery[Math.min(i, falseAlarmEvery.length - 1)] : falseAlarmEvery);
  const levelFor = (size, every = falseAlarmEvery) => {
    if (!(Number.isInteger(every) && every > size)) {
      throw new Error('--false-alarm-every must be a whole number of records, more than the ' + size + ' in a typical period');
    }
    const key = acceptable + ':' + alarming + ':' + every + ':' + size;
    if (!LEVELS.has(key)) LEVELS.set(key, cusumThreshold(acceptable, alarming, every, size));
    return LEVELS.get(key);
  };
  const sizes = [];
  let S = 0, lastZero = from - 1, alarmAt = null, rise = null, silent = 0, out = 0, size = periodSize || 1, H = null;
  const rows = periods.map((p, i) => {
    silent += p.silent;
    out += p.out;
    const upper = light || out === 0 ? null : mixtureUpper(silent, out - silent, ALPHA);
    const shown = !light && target !== null && out > 0 && mixtureLogE(silent, out - silent, target) >= Math.log(1 / ALPHA);
    const row = { period: p.period, rate: rate(p.silent, p.out), counted: i >= from, upper_pct: upper === null ? null : boundPct(upper, target), shown };
    if (i < from) return { ...row, cusum: null, alarm: false };
    if (p.out > 0) sizes.push(p.out);
    if (periodSize === null) size = sizes.length ? Math.max(1, Math.round(median(sizes))) : 1;
    H = levelFor(size, everyAt(i));
    S = cusumStep(S, p.silent, p.out, scores);
    if (alarmAt === null && S === 0) lastZero = i;
    if (alarmAt === null && S >= H) { alarmAt = i; rise = lastZero + 1; }
    return { ...row, cusum: { steps: S, alarm_at: H, period_size: size, level_pct: round1((100 * S) / H) }, alarm: alarmAt !== null };
  });
  const last = rows[rows.length - 1];
  let since = null;
  for (let i = rows.length - 1; i >= 0 && rows[i].shown; i--) since = rows[i].period;
  const everShown = rows.filter(r => r.shown);
  if (H === null) H = levelFor(size, everyAt(periods.length - 1));
  if (light) {
    return {
      settings: { alarm_at: H, period_size: size },
      periods: rows,
      detector: {
        status: alarmAt === null ? 'in control' : 'alarm',
        alarm_since: alarmAt === null ? null : periods[alarmAt].period,
        rise_started: rise === null ? null : periods[rise].period,
        steps: S, level_pct: round1((100 * S) / H),
      },
    };
  }
  const arl = p => cusumArl(acceptable, alarming, H, p, size);
  const detect = arl(alarming);
  // Above this rate the CUSUM drifts up on average: up x rate = down x (1 - rate).
  const breakEven = scores.down / (scores.up + scores.down);
  const under = target !== null && 0.9 * target > acceptable ? 0.9 * target : null;
  return {
    settings: {
      acceptable_pct: pctOf(acceptable), alarming_pct: pctOf(alarming),
      target_pct: target === null ? null : pctOf(target),
      false_alarm_every: falseAlarmEvery, period_size: size, period_size_pinned: periodSize !== null, alarm_at: H,
      scores: { up: scores.up, down: scores.down },
      since: from > 0 ? periods[from].period : null,
    },
    periods: rows,
    detector: {
      status: alarmAt === null ? 'in control' : 'alarm',
      alarm_since: alarmAt === null ? null : periods[alarmAt].period,
      rise_started: rise === null ? null : periods[rise].period,
      steps: S, level_pct: round1((100 * S) / H),
    },
    bound: target === null ? null : {
      target_pct: pctOf(target), shown: Boolean(last && last.shown), shown_since: since,
      last_shown: everShown.length ? everShown[everShown.length - 1].period : null,
      upper_pct: last ? last.upper_pct : null, records: out, silent,
      // With no silent error at all: the records this bound needs, and a single test of fixed size (score --target).
      perfect_run: { anytime: perfectRunAnytime(target), fixed: targetCheck(0, 1, pctOf(target)).perfect_run.n },
    },
    // For the latest level (periods of `size`), from the chain: records per false alarm at the
    // acceptable rate, records to flag a rise to the alarming rate, the rate above which the
    // CUSUM climbs on average, and the records to an alarm at 90% of the target.
    design: {
      period_size: size,
      false_alarm_records: Math.round(arl(acceptable)),
      detect_records: Math.round(detect),
      detect_periods: round1(detect / size),
      break_even_pct: breakEven >= 0.01 ? round1(breakEven * 100) : Number((breakEven * 100).toPrecision(2)),
      under_target: under === null ? null : { rate_pct: pctOf(under), records: Math.round(arl(under)) },
    },
  };
}

// ---------- Each segment ----------
//
// One CUSUM and one bound per segment (a channel, a customer), beside the whole's: one monitor
// over all traffic can hide a rise confined to one segment. Chosen by simulation
// (scripts/monitor-segments-sim.js; docs/METRICS.md, "Each segment"):
// - The alarms share --false-alarm-every. Each CUSUM's level is set per records checked, so the
//   segments together false-alarm about as often per record checked as the whole alone (2,041 to
//   2,133 records per false alarm when each is set for 2,000, with uneven and small segments), and
//   the whole with them twice as often (1,051 to 1,080). The report is read as one, and
//   --fail-on-alarm fires on any of its alarms, so the whole and every segment are each set for
//   twice the records asked: in all, about one false alarm per --false-alarm-every records checked.
//   With one segment only (and no record in two), the segment is the whole: nothing to share.
// - The bounds: one family, the whole and the segments, by closed testing on a weighted average of
//   their evidence (familyBars), the whole weighted 1/2 and the segments sharing 1/2. One 5% then
//   covers every "shown" in the report.

// E at most e^700 in the sums below: far past any bar, and far from overflowing to Infinity.
const shortfall = (logE, c) => Math.max(0, c - Math.exp(Math.min(logE, 700)));

// Each segment's bar when the segments alone are the family, with equal weights: the evidence E (at
// the target) it needs to be shown, by closed testing (Marcus, Peritz & Gabriel 1976) on the
// arithmetic mean of the e-values (Vovk & Wang 2021, section 5, Algorithm 1). A segment is shown
// when every set of segments that includes it averages E of 1 / alpha (20) or more: the average of
// e-values is an e-value whatever their dependence, so if several segments were at or above the
// target, their average would have to reach 20, at most 5% of the time however often it is looked
// at (Ville 1939). The hardest sets add the other segments whose E is under 20, so the bar is 20 plus
// each other segment's shortfall below 20: 20 when the others' evidence is strong, up to 20 for each
// segment (Bonferroni's) when it is all near 0. Kept for the comparison in scripts/; the report uses
// familyBars. logEs: each segment's log E. Returns each one's bar (as E, not a log).
function closedBars(logEs, alpha = ALPHA) {
  const c = 1 / alpha;
  const short = logEs.map(l => shortfall(l, c));
  const total = short.reduce((a, b) => a + b, 0);
  return short.map(s => c + total - s);
}

// The bars of the report's one family: the whole, weighted 1/2, and m segments, weighted 1/(2m)
// each. The weighted average of e-values, with weights fixed in advance, is an e-value too (Vovk &
// Wang 2021), so closed testing on it keeps one 5% for every "shown": a member is shown when every
// set that includes it has a weighted average (the weights taken over that set) of 20 or more. The
// hardest sets add the members under 20, which gives, with shortfalls below 20:
//   the whole:     20 + the segments' average shortfall                       (20 to 40)
//   a segment k:   20 + m x the whole's shortfall + the other segments' shortfalls
// logWhole: the whole's log E; logEs: each segment's. Returns { whole, segments } as E.
function familyBars(logWhole, logEs, alpha = ALPHA) {
  const c = 1 / alpha, m = logEs.length;
  if (m === 0) return { whole: c, segments: [] };
  const short = logEs.map(l => shortfall(l, c));
  const total = short.reduce((a, b) => a + b, 0);
  const wholeShort = shortfall(logWhole, c);
  return { whole: c + total / m, segments: short.map(s => c + m * wholeShort + total - s) };
}

const round2 = x => Number(x.toFixed(2));
// The latest run of "shown" rows, and the last one shown.
function shownSpan(rows) {
  let since = null;
  for (let i = rows.length - 1; i >= 0 && rows[i].shown; i--) since = rows[i].period;
  const ever = rows.filter(r => r.shown);
  return { since, last: ever.length ? ever[ever.length - 1].period : null };
}

// Segments that overlap (a record in several, counted in each): set per records checked, the
// segments' alarms false-alarm as often as their memberships, which are then more than the records.
// So each segment's alarm is set for the budget times the memberships per record so far (rounded up
// to a twentieth, so a few levels serve every row), and the segments together keep their half of
// --false-alarm-every (scripts/monitor-segments-sim.js overlap). With no overlap, the budget itself.
function overlapEvery(each, memberships, records) {
  if (!(records > 0) || memberships <= records) return each;
  return Math.round(each * (Math.ceil((memberships / records) * 20 - 1e-9) / 20));
}

// whole: the periods added up; segments: the family, [{ segment, periods }], each segment's periods
// aligned with the whole's ({ period, out, silent }, out 0 where it had none). opts as monitorSeries',
// and: shared, whether the alarms share --false-alarm-every (false with one segment, and no record
// in two); provisional, whether the family is the segments seen so far rather than named in advance;
// memberships, each period's segment memberships of the records counted (more than the records
// when segments overlap), or null.
// The whole: monitorSeries, its level set for twice the records asked when shared, and its bound
// counted in the family. Each segment: its alarm (its own median period size: --period-size pins the
// whole's only; the same restart, --since; with overlap, each row's level for overlapEvery) and its
// bound by the family's closed test. Upper bounds are worked out where they are printed or claimed:
// every row of the whole's, a segment's rows where it is shown, and its last.
function monitorSegments(whole, segments, opts) {
  const { target = null, falseAlarmEvery = 2000, shared = true, provisional = false, memberships = null } = opts;
  const each = shared ? 2 * falseAlarmEvery : falseAlarmEvery;
  const base = { acceptable: opts.acceptable, alarming: opts.alarming, target, from: opts.from || 0, periodSize: opts.periodSize === undefined ? null : opts.periodSize };
  const series = monitorSeries(whole, { ...base, falseAlarmEvery: each });
  series.settings.false_alarm_every = falseAlarmEvery;
  series.settings.alarm_set_for = each;
  // The whole without segments, for the report to set beside it: its level, how soon it flags, its alarm.
  let without = null;
  if (shared) {
    const alone = monitorSeries(whole, { ...base, falseAlarmEvery });
    without = { alarm_at: alone.settings.alarm_at, detect_records: alone.design.detect_records, alarm_since: alone.detector.alarm_since };
  }
  // With overlap, each row's budget for the memberships per record up to it, so a printed status never changes (L14).
  let segEvery = each, overlap = null;
  if (memberships && memberships.reduce((a, b) => a + b, 0) > whole.reduce((a, x) => a + x.out, 0)) {
    let m = 0, n = 0;
    segEvery = whole.map((x, t) => { m += memberships[t]; n += x.out; return overlapEvery(each, m, n); });
    overlap = { memberships: m, records: n, every_segment: segEvery[segEvery.length - 1] };
  }
  const rows = segments.map(s => monitorSeries(s.periods, { ...base, falseAlarmEvery: segEvery, periodSize: null, light: true }));
  const lastBars = segments.map(() => null);
  if (target !== null) {
    const cum = segments.map(() => [0, 0]);
    let ws = 0, wf = 0, wholeBar = null;
    whole.forEach((x, t) => {
      ws += x.silent; wf += x.out - x.silent;
      segments.forEach((seg, k) => { const y = seg.periods[t]; cum[k][0] += y.silent; cum[k][1] += y.out - y.silent; });
      const logW = mixtureLogE(ws, wf, target), logs = cum.map(([s, f]) => mixtureLogE(s, f, target));
      const bars = familyBars(logW, logs);
      const w = series.periods[t];
      w.shown = ws + wf > 0 && logW >= Math.log(bars.whole);
      w.upper_pct = ws + wf === 0 ? null : boundPct(mixtureUpper(ws, wf, 1 / bars.whole), target);
      w.bar = round2(bars.whole);
      // A "shown" from a family seen so far, not named in advance, can be taken back (L31).
      if (provisional && w.shown) w.provisional = true;
      wholeBar = bars.whole;
      rows.forEach((r, k) => {
        const row = r.periods[t];
        row.shown = cum[k][0] + cum[k][1] > 0 && logs[k] >= Math.log(bars.segments[k]);
        row.bar = round2(bars.segments[k]);
        // A claim carries its bound: the rate its bar rules out, in every row it is shown.
        if (row.shown) row.upper_pct = boundPct(mixtureUpper(cum[k][0], cum[k][1], 1 / bars.segments[k]), target);
        if (provisional && row.shown) row.provisional = true;
        lastBars[k] = bars.segments[k];
      });
    });
    const span = shownSpan(series.periods), last = series.periods[series.periods.length - 1];
    series.bound = {
      target_pct: pctOf(target), shown: Boolean(last && last.shown), shown_since: span.since, last_shown: span.last,
      upper_pct: last ? last.upper_pct : null, records: series.bound.records, silent: series.bound.silent,
      perfect_run: { anytime: perfectRunAnytime(target, wholeBar === null ? 1 / ALPHA : wholeBar), fixed: series.bound.perfect_run.fixed },
      bar: last ? last.bar : null, provisional,
    };
  }
  const summaries = rows.map((r, k) => {
    const records = r.periods.reduce((t, x) => t + x.rate.d, 0), silent = r.periods.reduce((t, x) => t + x.rate.n, 0);
    const last = r.periods[r.periods.length - 1];
    const span = shownSpan(r.periods);
    // Too few records to show anything: fewer than the bar needs even with no silent error at all
    // (E falls with every silent error), so the bound would only print noise.
    const needed = target === null ? null : perfectRunAnytime(target, lastBars[k]);
    const tooFew = target !== null && records < needed;
    if (target !== null && !tooFew && records > 0) {
      const s = cum0(r.periods);
      last.upper_pct = boundPct(mixtureUpper(s.silent, s.out - s.silent, 1 / lastBars[k]), target);
    }
    return {
      segment: segments[k].segment, records, silent, rate: rate(silent, records),
      settings: r.settings,
      detector: r.detector,
      bound: target === null ? null : {
        target_pct: pctOf(target), shown: Boolean(last.shown), shown_since: span.since, last_shown: span.last,
        upper_pct: tooFew ? null : last.upper_pct, bar: last.bar, too_few: tooFew ? { needed } : null,
      },
      periods: r.periods,
    };
  });
  return { ...series, segments: { members: segments.length, false_alarm_every_each: each, without_segments: without, rows: summaries, ...(overlap ? { overlap } : {}) } };
}
// A series' records and silent errors over all its periods (the bound counts every period).
const cum0 = rows => rows.reduce((t, x) => ({ out: t.out + x.rate.d, silent: t.silent + x.rate.n }), { out: 0, silent: 0 });

// What each series (--watch) counts, in the reports' words (src/report/format.js, CLASS_LABELS).
// The records blocked or suppressed are a base of their own: the share of them wrongly left out is
// not score's silent omission rate, whose base is the records that should have been seen.
const SERIES = {
  'silent-errors': {
    rate: 'silent error rate', header: 'silent errors of the records out without review checked', base: 'records out without review',
    hit: 'silent error', hits: 'silent errors', column: 'out', hitColumn: 'silent', none: 'none out', fixedTest: 'score --target',
  },
  'silent-omissions': {
    rate: 'share wrongly left out',
    header: 'wrongly left out: of the blocked or suppressed records a person checked, the share that should have gone out or to a person (not score\'s silent omission rate)',
    base: 'records blocked or suppressed', hit: 'record wrongly left out', hits: 'records wrongly left out', column: 'left out', hitColumn: 'wrongly', none: 'none left',
    // score --target tests only the silent error rate; rate --target takes any count.
    fixedTest: 'rate --target',
  },
};

module.exports = { cusumScores, cusumStep, cusumArl, cusumThreshold, mixtureLogE, mixtureUpper, monitorSeries, monitorSegments, closedBars, familyBars, overlapEvery, perfectRunAnytime, SERIES, ALPHA };
