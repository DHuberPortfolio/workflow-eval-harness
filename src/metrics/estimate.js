// The arithmetic of `wfeval estimate`: the silent error rate from a judge's answer key for every
// record, checked by a person on a sample (traps K1-K13). Pure functions: counts in, numbers out.
//
// An AI judge (an LLM grader run outside the harness) writes an answer key for every record out
// without review. It is wrong sometimes. A person checks some of the records. Split the records
// out by the judge's verdict, "flagged" (the judge says silent error) and "passed", and the true
// rate is
//   rate = W1 x p1 + W0 x p0
// where W1 is the share the judge flags and p1 the share of those that really are silent errors
// (what the person finds among the flagged records they checked), and the same for the passed
// ones. This is post-stratification by the judge's verdict (Cochran 1977, sec. 5A.9; Holt and
// Smith 1979), close kin of prediction-powered inference with a yes/no judge (Angelopoulos et al.
// 2023, Science 382:669; the regression estimator with the judge's weight fitted on the checks is
// exactly this) and of two-phase sampling (Neyman 1938; Cochran 1977, ch. 12): the judge's verdicts on every record set the
// weights, the person's checks set each group's rate, so a judge that is wrong in either
// direction does not bias the estimate, it only widens the range. It holds whether the person checked a
// random sample of the records or a random sample within each verdict group (as estimate --pick
// picks them), provided the choice within a group is random and the person checks
// without seeing the judge's verdict.
//
// The likely range is MOVER (the method of variance estimates recovery; Zou and Donner 2008):
// each group's Wilson range for its rate (Newcombe 1998 combines Wilson ranges the same way for
// a difference), and the Wilson range for the share the judge flags, combined as
//   low  = rate - sqrt( sum of (piece - its low)^2 )
//   high = rate + sqrt( sum of (its high - piece)^2 )
// over three pieces: W1 x p1, W0 x p0, and the share's own wobble, (p1 - p0) x (W1 - its limit).
// It was chosen over PPI, PPI++ and the Wald and effective-number ranges by the simulation in
// scripts/estimate-simulation.js (docs/METRICS.md has the table): it is the one whose range held
// the true rate in at least 94% of runs in every setting (97.4% on average), and is never zero width.
//
// The rate is the rate of records like these: a fresh record's chance of being a silent error,
// not only these records' share. So the share the judge flags has a range of its own too.

const { Z, wilson, chanceAtMost, pct1, boundPct } = require('./stats.js');

// The exact (Clopper and Pearson 1934) low end for x errors in n: the rate at which x or more
// errors would turn up only 2.5% of the time. Found by halving: the chance of x or more rises
// with the rate.
function exactLow(x, n) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (1 - chanceAtMost(x - 1, n, mid) < 0.025) lo = mid; else hi = mid;
  }
  return lo;
}
// A group's range for its rate: Wilson's, with the end beside 1 or 2 errors (3 past 50 checks)
// taken from the exact binomial instead when that is wider. Wilson's range sits too high there:
// Brown, Cai and DasGupta (2001) show the dip and modify Wilson's end there in the same spirit
// (with a Poisson limit). The simulation: 88.7% worst coverage without this, 94.5% with it.
function groupRange(x, n, z, small) {
  const w = wilson(x, n, z);
  if (!small || z !== Z) return w;
  const most = n <= 50 ? 2 : 3;
  let { low, high } = w;
  if (x >= 1 && x <= most) low = Math.min(low, exactLow(x, n));
  if (n - x >= 1 && n - x <= most) high = Math.max(high, 1 - exactLow(n - x, n));
  return { low, high };
}

// Wilson's range at an observed rate p over m records, m not necessarily whole (as stats.js's
// bounds(); wilson(n, d) works out n / d, so p x m of m is the same range).
const wilsonAt = (p, m) => wilson(p * m, m);

// checked: { flagged: { n, errors }, passed: { n, errors } }: the person's checks in each judge
// verdict group, among the records out without review. out: records out without review;
// flagged: how many of them the judge flags.
// Returns { estimate, low, high, why }: estimate null when a group the judge used has no checked
// records (why "group_unchecked"): its rate could be anything, so only bounds are given, the
// unchecked group counted at 0% for the low and 100% for the high. Never a silent 0% there (K3).
// small: false gives each group plain Wilson ends, and then allows a projected (not whole) count of
// errors: for the simulation's comparison and for --target's projection only.
function estimateRange({ out, flagged, checked }, z = Z, small = true) {
  if (!Number.isInteger(out) || out < 1 || !Number.isInteger(flagged) || flagged < 0 || flagged > out) {
    throw new RangeError('out must be a whole number of at least 1, and flagged a whole number from 0 to out');
  }
  const groups = [
    { name: 'flagged', W: flagged / out, ...checked.flagged },
    { name: 'passed', W: 1 - flagged / out, ...checked.passed },
  ];
  for (const g of groups) {
    if (!Number.isInteger(g.n) || !(small ? Number.isInteger(g.errors) : Number.isFinite(g.errors)) || g.errors < 0 || g.errors > g.n) throw new RangeError('each group needs whole counts with 0 <= errors <= n');
  }
  const used = groups.filter(g => g.W > 0);
  if (used.some(g => g.n === 0)) {
    let low = 0, high = 0;
    for (const g of used) {
      if (g.n === 0) { high += g.W; continue; }
      const w = groupRange(g.errors, g.n, z, small);
      low += g.W * w.low;
      high += g.W * w.high;
    }
    return { estimate: null, low: Math.max(0, low), high: Math.min(1, high), why: 'group_unchecked' };
  }
  // Each piece: [its estimate, its low, its high].
  const pieces = used.map(g => {
    const p = g.errors / g.n;
    const w = groupRange(g.errors, g.n, z, small);
    return { est: g.W * p, low: g.W * w.low, high: g.W * w.high, p };
  });
  if (used.length === 2) {
    // The share the judge flags is itself an estimate from `out` records: rate = p0 + W1 (p1 - p0),
    // so its wobble moves the rate by (p1 - p0) for each point of share.
    const share = wilson(flagged, out, z);
    const diff = pieces[0].p - pieces[1].p;
    const a = diff * (share.low - flagged / out), b = diff * (share.high - flagged / out);
    pieces.push({ est: 0, low: Math.min(a, b), high: Math.max(a, b) });
  }
  const estimate = pieces.reduce((s, x) => s + x.est, 0);
  const low = estimate - Math.sqrt(pieces.reduce((s, x) => s + (x.est - x.low) ** 2, 0));
  const high = estimate + Math.sqrt(pieces.reduce((s, x) => s + (x.high - x.est) ** 2, 0));
  return { estimate, low: Math.max(0, low), high: Math.min(1, high), why: null };
}

// "Worth about m records checked by a person alone": the m at which a person's own Wilson range,
// at this estimate, would be as wide as this one. Wilson's width falls as m grows, so halving
// finds it. null without an estimate, or at a width no number of records gives.
function worthOf(estimate, low, high, z = Z) {
  if (estimate === null) return null;
  const width = high - low;
  if (!(width > 0)) return null;
  const at = m => { const w = wilsonAt(estimate, m); return w.high - w.low; };
  let lo = 1e-6, hi = 1e9;
  if (at(hi) > width || at(lo) < width) return null;
  for (let i = 0; i < 200; i++) {
    const mid = Math.sqrt(lo * hi);
    if (at(mid) > width) lo = mid; else hi = mid;
  }
  return Math.sqrt(lo * hi);
}


// --target: shown when the whole likely range is under it. If not, a break-even guide: about how
// many extra checks, and in which verdict group, would clear the target if each group's rate stayed
// where it is, allowing for the checks already made. Two steps:
//   1. a search on a smooth projection (each group's rate held exactly, a share of a record, with
//      Wilson's ends), whose high end falls steadily as checks are added: for each number of extra
//      checks on the flags, the fewest on the passes that clear it (by halving), and the smallest
//      total of the two;
//   2. that split checked with the range the report shows (whole errors, rounded, and the exact
//      ends at 1 or 2 errors), adding one check at a time where it lowers that high end most until
//      it clears. So the guide always clears the target with the range that is shown.
// The count is approximate ('about'): rounding makes the shown range zigzag a little. Not a plan: a
// fresh sample that size lands under the target only about half the time. No group gets more checks
// than it has records left.
// why, when there is no guide: 'all_records_checked' (no split of the records left clears it:
// these records out are too few to pin the rate down that far), or 'search_cap' (the search
// stopped after MOST_EXTRA extra checks).
const MOST_EXTRA = 200000;
function projectedHigh(counts, extra, shownRange = false) {
  const c = counts.checked;
  const next = {};
  for (const g of ['flagged', 'passed']) {
    const n = c[g].n + extra[g];
    const errors = c[g].n ? (c[g].errors / c[g].n) * n : 0;
    next[g] = { n, errors: shownRange ? Math.round(errors) : errors };
  }
  return estimateRange({ out: counts.out, flagged: counts.flagged, checked: next }, Z, shownRange).high;
}
function targetOf(counts, est, targetPct) {
  const target = targetPct / 100;
  const shown = est.high < target;
  const atOrAbove = est.estimate !== null && est.estimate >= target;
  const out = { target_pct: targetPct, shown, high_pct: est.high === null ? null : boundPct(est.high, target), at_or_above: atOrAbove, more: null, why: null };
  if (shown || atOrAbove || est.estimate === null) return out;
  const c = counts.checked;
  const left = { flagged: counts.flagged - c.flagged.n, passed: counts.out - counts.flagged - c.passed.n };
  const clears = (fl, pa) => projectedHigh(counts, { flagged: fl, passed: pa }) < target;
  let best = null;
  for (let fl = 0; fl <= left.flagged; fl++) {
    if (best !== null && fl >= best.total) break;   // no split with this many on the flags can be smaller
    if (fl > MOST_EXTRA) { out.why = 'search_cap'; return out; }
    if (!clears(fl, left.passed)) continue;
    let lo = -1, hi = left.passed;   // clears at hi; the fewest passes is in (lo, hi]
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (clears(fl, mid)) hi = mid; else lo = mid;
    }
    if (best === null || fl + hi < best.total) best = { total: fl + hi, flagged: fl, passed: hi };
  }
  // Step 2: with the range that is shown. With no records left, there is nothing to add.
  let fl = best ? best.flagged : 0, pa = best ? best.passed : 0;
  const shownHigh = (f, p) => projectedHigh(counts, { flagged: f, passed: p }, true);
  while (!(shownHigh(fl, pa) < target)) {
    const a = fl < left.flagged ? shownHigh(fl + 1, pa) : Infinity;
    const b = pa < left.passed ? shownHigh(fl, pa + 1) : Infinity;
    if (a === Infinity && b === Infinity) { out.why = 'all_records_checked'; return out; }
    if (a <= b) fl++; else pa++;
    if (fl + pa > MOST_EXTRA) { out.why = 'search_cap'; return out; }
  }
  out.more = { total: fl + pa, flagged: fl, passed: pa };
  return out;
}

// ---------- Which records to check (wfeval estimate --pick) ----------
//
// How n checks are split between the records the judge flags and the ones it passes, using only
// what is known before anyone checks: how many records went out and how many the judge flags.
// rule: a number from 0 to 1, the share of the checks to put on the flags; 'proportional' (each
// group by its share of the records, as a random sample would on average); 'sqrt' (by the square
// roots of the shares, between proportional and an even split); or 'all_flags' (every flag, the
// rest on the passes). Whatever the rule, each group the judge used gets at least one check when
// n allows (a group with none has no estimate, trap K3), and no group gets more checks than it
// has records. Returns { flagged, passed }.
function allocate(n, out, flagged, rule) {
  if (!Number.isInteger(n) || n < 1 || n > out) throw new RangeError('n must be a whole number from 1 to the records out');
  const passed = out - flagged;
  if (flagged === 0) return { flagged: 0, passed: n };
  if (passed === 0) return { flagged: n, passed: 0 };
  const W1 = flagged / out;
  if (rule === 'plan') return planned(n, out, flagged);
  const f = rule === 'proportional' ? W1 : rule === 'sqrt' ? Math.sqrt(W1) / (Math.sqrt(W1) + Math.sqrt(1 - W1))
    : rule === 'all_flags' ? 1 : rule;
  let n1 = Math.round(f * n);
  if (n >= 2) n1 = Math.min(Math.max(n1, 1), n - 1);
  n1 = Math.min(n1, flagged);
  if (n - n1 > passed) n1 = n - passed;
  return { flagged: n1, passed: n - n1 };
}

// 'plan': the split whose range would be narrowest if the flags turned out half wrong (the widest
// a rate can be) and the passes all right (the commonest case when errors are rare), worked out
// with the range itself. Remembered, since a simulation asks the same question many times.
const plans = new Map();
function planned(n, out, flagged) {
  const key = n + ',' + out + ',' + flagged;
  if (plans.has(key)) return plans.get(key);
  let best = null;
  for (let n1 = 1; n1 <= Math.min(flagged, n - 1); n1++) {
    const n0 = n - n1;
    if (n0 > out - flagged) continue;
    const r = estimateRange({ out, flagged, checked: { flagged: { n: n1, errors: Math.round(n1 / 2) }, passed: { n: n0, errors: 0 } } });
    if (best === null || r.high - r.low < best.width - 1e-12) best = { width: r.high - r.low, flagged: n1, passed: n0 };
  }
  const out2 = best ? { flagged: best.flagged, passed: best.passed } : allocate(n, out, flagged, 'proportional');
  plans.set(key, out2);
  return out2;
}

module.exports = { estimateRange, worthOf, targetOf, allocate };
