// Small shared arithmetic used by every metric.
//
// rate() is how every percentage in this tool is reported: the count, the base,
// the percentage, and the range the true value plausibly sits in. A bare "0.0%"
// hides whether it came from 0/7 or 0/700; the range makes that visible.

// Percentage to one decimal, or null when there is nothing to divide by.
// null (not 0) because "no auto-published records" is not "no errors".
// Worked from the whole-number counts, so ties round the same way: 0.05 and 0.15 both go up (trap P26;
// 0.15 is a little under itself in binary, and toFixed sent it down). A rate that is not zero and
// would round under 0.1 keeps two figures: 1 of 3000 is 0.033, not 0.0.
function pct(n, d) {
  if (d === 0) return null;
  const tenths = Math.round((n * 1000) / d) / 10;
  return n > 0 && tenths < 0.1 ? Number(((n / d) * 100).toPrecision(2)) : tenths;
}

// 95% everywhere, the same as error-rate-calculator, so both tools report identical ranges.
const Z = 1.96;

// Wilson score interval: the range of true rates consistent with seeing
// n successes in d trials, at 95% confidence (z = 1.96).
// Chosen over the textbook "p +/- 1.96 * sqrt(p(1-p)/d)" because that one
// breaks at small counts and at 0% or 100% - it says 0/7 has a range of
// exactly 0 to 0, which is the overconfidence we are trying to expose.
function wilson(n, d, z = Z) {
  if (d === 0) return null;
  return bounds(n / d, d, z);
}

// The Wilson range for an observed rate p over d records. Split from wilson() so planning
// can ask "what would the range be at a bigger d?" without inventing whole-number counts.
function bounds(p, d, z = Z) {
  const z2 = z * z;
  const denom = 1 + z2 / d;
  const center = (p + z2 / (2 * d)) / denom;
  const half = (z * Math.sqrt(p * (1 - p) / d + z2 / (4 * d * d))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

function rate(n, d) {
  const w = wilson(n, d);
  // A range that would read 0.0-0.0% keeps two figures at each end (trap P42).
  const fine = w !== null && w.high > 0 && w.high < 0.0005;
  const end = x => (w === null ? null : fine ? Number((x * 100).toPrecision(2)) : Number((x * 100).toFixed(1)));
  return { n, d, pct: pct(n, d), low_pct: end(w && w.low), high_pct: end(w && w.high) };
}

// Cohen's kappa: how much two people agree beyond what chance alone would give.
//   kappa = (observed - expected) / (1 - expected)
// observed: the share of items they put in the same category; expected: the share they would
// agree on by chance, given how often each used each category. 1 is perfect agreement, 0 is
// chance level, below 0 worse than chance. matrix[a][b] counts items the first person put in
// category a and the second in b. null when nothing was compared, or when chance agreement is
// already 1 (both used one category only): 0 / 0 is "not measurable", never 1 or 0.
function cohensKappa(matrix, categories) {
  const n = categories.reduce((s, a) => s + categories.reduce((t, b) => t + matrix[a][b], 0), 0);
  if (n === 0) return null;
  const observed = categories.reduce((s, c) => s + matrix[c][c], 0) / n;
  const expected = categories.reduce((s, c) => {
    const row = categories.reduce((t, b) => t + matrix[c][b], 0);
    const col = categories.reduce((t, a) => t + matrix[a][c], 0);
    return s + (row / n) * (col / n);
  }, 0);
  if (Math.abs(1 - expected) < 1e-12) return null;
  return Number(((observed - expected) / (1 - expected)).toFixed(3));
}

// ---------- Planning: how many records to show a rate is under a target ----------
//
// The same arithmetic as error-rate-calculator (stats.js there), so the two tools give the same
// answer for the same counts; test/stats.test.js pins the values both tools' tests pin.
// Rates are proportions here (0.05 is 5%).

// Smallest number of records whose whole likely range sits under `target`, if mistakes turn up at
// exactly `rate`. At rate 0 it is the hard minimum anyone needs: a perfect run of this many. Above
// 0 it is a break-even point, not a plan (a fresh test that size lands under the target only about
// half the time); planTest() is the plan. null when rate >= target: no amount of testing shows a
// rate is under a target it is already at or above. Infinity past what a number counts exactly.
function recordsNeeded(rate, target) {
  checkPlan(rate, target);
  if (rate >= target) return null;
  // The upper end falls as records are added, so the first size under the target is found by doubling
  // and halving: no cap, and no loop over every size (trap P11).
  const under = n => bounds(rate, n).high < target;
  let hi = 1;
  while (!under(hi)) {
    hi *= 2;
    if (hi > Number.MAX_SAFE_INTEGER) return Infinity;
  }
  let lo = Math.floor(hi / 2);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (under(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

function checkPlan(rate, target) {
  if (!(target > 0 && target < 1)) throw new RangeError('target must be between 0 and 1');
  if (!(rate >= 0 && rate <= 1)) throw new RangeError('rate must be between 0 and 1');
}

// An upper bound as a percentage, beside a target it is compared with: one decimal, or more when one
// decimal would print the target itself. 4.98% is under 5%, and "shown under 5%" beside "5.0%" reads
// as a contradiction (traps P25; L14). Both proportions; target may be null.
const pctOf = x => Number((x * 100).toPrecision(12));   // 0.025 -> 2.5, without 2.5000000000000004
// Whether figure v can stand for x, percentages both, beside target t (null for none): not 0 for
// something above it, and on the side of the target x is on (traps P25, P42).
const standsFor = (v, x, t) => (x === 0 || v !== 0) && (t === null || ((v === t) === (x === t) && (v < t) === (x < t)));
// A bound as a percentage: one decimal, or the figures that keep it true beside the target.
function boundPct(upper, target) {
  const x = pctOf(upper);
  const t = target === null ? null : pctOf(target);
  const one = Number((upper * 100).toFixed(1));
  if (standsFor(one, x, t)) return one;
  for (let figures = 2; figures < 12; figures++) {
    const v = Number(x.toPrecision(figures));
    if (standsFor(v, x, t)) return v;
  }
  return x;
}

// ln(i!), grown on demand.
const logFactorial = [0, 0];
function lnFact(n) {
  for (let i = logFactorial.length; i <= n; i++) logFactorial.push(logFactorial[i - 1] + Math.log(i));
  return logFactorial[n];
}

// Exact chance of at most k mistakes in n records at a real rate p, summed in logarithms so a
// large n cannot underflow to zero. Also the p-value of the test "the real rate is p or more"
// after k mistakes in n (whatif.js certifies gates with it).
function chanceAtMost(k, n, p) {
  if (k < 0) return 0;
  if (k >= n || p === 0) return 1;
  const lp = Math.log(p), lq = Math.log1p(-p), ln = lnFact(n);
  let total = 0;
  for (let i = 0; i <= k; i++) total += Math.exp(ln - lnFact(i) - lnFact(n - i) + i * lp + (n - i) * lq);
  return Math.min(1, total);
}

// Most mistakes n records can hold and still have their whole likely range under target (-1 if
// even none is enough). More mistakes always push the range up, so it counts up from below.
function mostMistakesAllowed(n, target, from = -1) {
  let k = from;
  while (k + 1 <= n && bounds((k + 1) / n, n).high < target) k++;
  return k;
}

// z for the planning chances on offer (the normal curve's quantiles).
const Z_FOR_CHANCE = { 0.8: 0.8416212335729143, 0.9: 1.2815515655446004, 0.95: 1.6448536269514722 };
// Above this estimate a plan uses the textbook formula alone, and says so (exact: false).
const EXACT_PLAN_LIMIT = 5000;

// How many records to test to show the real rate is under `target`, with at least `chance`
// probability, if the real rate is `rate`. Starts from the textbook estimate (the normal
// approximation behind the Wilson range), then checks the exact chance at every size up to
// double it. The answer is one past the last size that falls short, so it holds for that many
// records or more: whole-number mistake counts make the chance zigzag as n grows.
// Returns { n, chance, exact }, or null when rate >= target.
function planTest(rate, target, chance = 0.8) {
  checkPlan(rate, target);
  const zb = Z_FOR_CHANCE[chance];
  if (zb === undefined) throw new RangeError('chance must be 0.8, 0.9 or 0.95');
  if (rate >= target) return null;
  if (rate === 0) return { n: recordsNeeded(0, target), chance: 1, exact: true };
  const est = ((Z * Math.sqrt(target * (1 - target)) + zb * Math.sqrt(rate * (1 - rate))) / (target - rate)) ** 2;
  if (est > EXACT_PLAN_LIMIT) return { n: Math.ceil(est), chance: null, exact: false };
  // If a size near the end still falls short, the estimate was low: keep checking further out,
  // so the answer always has clear room after it.
  let limit = Math.max(2 * Math.ceil(est), Math.ceil(est) + 100);
  let lastShort = 0, k = -1;
  const chances = [];
  for (let n = 1; n <= limit; n++) {
    k = mostMistakesAllowed(n, target, k);
    chances[n] = chanceAtMost(k, n, rate);
    if (chances[n] < chance) {
      lastShort = n;
      if (n > limit / 2) limit = 2 * n;
    }
  }
  return { n: lastShort + 1, chance: chances[lastShort + 1], exact: true };
}

// ---------- A change on the same records (paired) ----------
//
// When both versions ran on the same records, the records that came out the same carry no
// information about the change. Only two counts do: fixed (wrong before, right after) and broke
// (right before, wrong after). The drop is exactly (fixed - broke) / tested. Its likely range is
// Tango's score interval (1998), the paired twin of the Wilson range; its verdict agrees with
// McNemar's test. Run-to-run noise flips records both ways equally, so a real change is one that
// fixes more than it breaks by more than chance: no repeated runs are needed to judge it.

// Tango's score statistic for "the real drop is d". It falls as d rises.
function tangoScore(fixed, broke, tested, d) {
  const num = fixed - broke - tested * d;
  if (num === 0) return 0;
  // The most likely "broke" probability if the real drop were d (the constrained maximum-
  // likelihood estimate): a root of a quadratic.
  const a = 2 * tested;
  const b = -fixed - broke + (2 * tested - fixed + broke) * d;
  const c = -broke * d * (1 - d);
  const q = (Math.sqrt(Math.max(0, b * b - 4 * a * c)) - b) / (2 * a);
  const variance = tested * (2 * q + d * (1 - d));
  if (!(variance > 0)) return num > 0 ? Infinity : -Infinity;
  return num / Math.sqrt(variance);
}

// The d where the score crosses `level`, between lo and hi. Halving 200 times is far past
// double precision.
function crossing(fixed, broke, tested, level, lo, hi) {
  for (let i = 0; i < 200 && hi - lo > 1e-15; i++) {
    const mid = (lo + hi) / 2;
    if (tangoScore(fixed, broke, tested, mid) > level) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// The likely range of the real drop (before minus after, as a share of the records tested).
function pairedDifference(fixed, broke, tested) {
  if (!Number.isInteger(tested) || tested < 1) throw new RangeError('tested must be a whole number of at least 1');
  if (!Number.isInteger(fixed) || !Number.isInteger(broke) || fixed < 0 || broke < 0 || fixed + broke > tested) {
    throw new RangeError('fixed and broke must be whole numbers that fit in tested');
  }
  const drop = (fixed - broke) / tested;
  const low = tangoScore(fixed, broke, tested, -1) <= Z ? -1 : crossing(fixed, broke, tested, Z, -1, drop);
  const high = tangoScore(fixed, broke, tested, 1) >= -Z ? 1 : crossing(fixed, broke, tested, -Z, drop, 1);
  return { drop, low, high };
}

// ---------- Records that come in clusters ----------
//
// The Wilson range assumes every record is a separate piece of evidence. Retellings of one news
// story, or the statements of one filing, tend to go right or wrong together: ten reviews of one
// restaurant by the same person are one opinion, not ten. Counted as independent, they make the
// range too narrow. This is the standard survey-sampling answer for a rate (a ratio of two
// counts) when records come in clusters: Kish (1965), Survey Sampling (the variance of a ratio
// mean over clusters, and the design effect); for evals, Miller (2024), "Adding Error Bars to
// Evals", arXiv 2411.00640, Eq. 4 (the clustered standard error).
//
// clusters: [{ n, y }] - each cluster's records out without review (n) and its silent errors (y).
// Clusters with n = 0 have nothing out and are not counted. p = sum y / sum n.
//   var_c   = C/(C-1) x sum_c (y_c - p n_c)^2 / n^2   C: clusters with records out
//   var_srs = p(1-p) / (n-1)                          as if every record were independent
//   deff    = var_c / var_srs, floored at 1           the design effect (Kish)
//   n_eff   = n / deff                                records' worth of evidence
// and the range is Wilson's at p over n_eff records (bounds() takes a non-integer count).
// sum_c (y_c - p n_c)^2 is Miller's Eq. 4 sum written per cluster: within one cluster,
// (sum_i (s_i - p))^2 is every pair (s_i - p)(s_j - p), a record with itself included.
// C/(C-1) is the usual small-sample correction for few clusters. With every record alone it
// gives p(1-p)/(n-1), as Miller's Eq. 4 does, so var_srs divides by n - 1 too: the same
// correction on both sides, and records that are each a cluster of their own have a design
// effect of exactly 1, their range the headline's. (Over n, they would come out at n/(n-1):
// 2 for two records, a clumping that is not there.)
// The floor at 1: when the clusters vary less than independent records would, the range still
// never claims more evidence than the records themselves.
// A design effect needs a spread between clusters to measure: silent errors in two clusters or
// more, and records out without one in two or more. When p is 0 or 1 every term is 0, and the
// design effect is 0 / 0. With every silent error in one cluster (or every other record), there
// is one clump and nothing to compare it with: one wrong record looks like no clumping at all
// (a design effect near 1), so a first error would narrow the range below what no errors give
// (35.4% against 47.6% on the clusters fixture). With one cluster there is no spread at all. In
// each case the data cannot say how far a cluster's records go together, so the range assumes
// the worst: each cluster's records go right or wrong together, the cautious choice. The rate is
// then an average of C outcomes, one per cluster, each weighted by its records, and it is worth
//   n_eff = (sum n_c)^2 / sum n_c^2
// records: Kish's (1965) effective number, with the clusters' sizes as the weights. It is C when
// the clusters are the same size, and fewer when they are not: one big cluster is a single
// outcome carrying much of the weight (4, 3, 2, 2 and 1 records: 144 / 34 = 4.24, not 5).
// method "clusters_together"; `why` says which case it was. With every record a cluster of its
// own it is n, every record counted.
// Returns null when nothing went out.
function clusteredRange(clusters, z = Z) {
  for (const c of clusters) {
    if (!Number.isInteger(c.n) || !Number.isInteger(c.y) || c.y < 0 || c.y > c.n) throw new RangeError('each cluster needs whole counts with 0 <= y <= n');
  }
  const used = clusters.filter(c => c.n > 0);
  const C = used.length;
  const n = used.reduce((s, c) => s + c.n, 0);
  const y = used.reduce((s, c) => s + c.y, 0);
  if (n === 0) return null;
  const p = y / n;
  const varSrs = n > 1 ? y * (n - y) / (n * n * (n - 1)) : null;   // p(1-p)/(n-1)
  const withErrors = used.filter(c => c.y > 0).length;
  const withOthers = used.filter(c => c.y < c.n).length;
  const why = y === 0 ? 'no_silent_errors' : y === n ? 'all_silent_errors' : C < 2 ? 'one_cluster'
    : withErrors < 2 ? 'silent_errors_in_one_cluster' : withOthers < 2 ? 'others_in_one_cluster' : null;
  if (why) {
    const together = (n * n) / used.reduce((s, c) => s + c.n * c.n, 0);
    const b = bounds(p, together, z);
    return { n, y, p, clusters: C, var_clustered: null, var_simple: varSrs, design_effect: null, effective: together, low: b.low, high: b.high, method: 'clusters_together', why };
  }
  // The residuals in whole numbers, n y_c - y n_c = n (y_c - p n_c), and the design effect as one
  // fraction of whole numbers, so records each alone give exactly 1, not 1 give or take a rounding.
  const T = used.reduce((s, c) => s + (n * c.y - y * c.n) ** 2, 0);
  const varC = (C / (C - 1)) * T / n ** 4;
  const deff = Math.max(1, (C * (n - 1) * T) / ((C - 1) * n * n * y * (n - y)));
  const b = bounds(p, n / deff, z);
  return { n, y, p, clusters: C, var_clustered: varC, var_simple: varSrs, design_effect: deff, effective: n / deff, low: b.low, high: b.high, method: 'design_effect', why: null };
}

// ---------- Groups weighted to a real mix ----------
//
// A golden set built from traps holds far more hard records than real traffic, so its silent
// error rate is a stress-test rate. A driving test taken mostly on icy roads says little about a
// sunny commute until each kind of road is weighted by how often it is icy. Weighting each group
// (a stratum) by its share of real traffic does that: stratified estimation, here the combined
// ratio estimate, since the rate is a ratio of two counts (Cochran 1977, ch. 5-6).
//
// strata: [{ share, N, a, s }] - each group's share of real traffic (fractions, percentages or
// counts: divided by their total), its records (N), its records out without review (a) and its
// silent errors (s). With W the share divided by the total:
//   out = sum W a / N    records out without review per record, on the mix: the straight-through
//   bad = sum W s / N    silent errors per record, on the mix
//   R   = bad / out      the silent error rate on the mix; null when out is 0 (nothing would go out, G1)
// Each record out without review in group h stands for w = W / N of the mix, so unequal weights
// make the records worth fewer than there are: Kish's (1965) effective number for unequal
// weights, n_eff = (sum w)^2 / sum w^2, over those records. The range is Wilson's at R over n_eff
// records, as clusteredRange does (bounds() takes a non-integer count, and works at R = 0).
// The straight-through counts every record, so its n_eff is 1 / sum W^2 / N.
// With the golden set's own shares (W = N / all records) every weight is the same, and R, both
// n_eff and both ranges are the run's own exactly: a check that the weighting adds nothing.
// Returns the shares used (W), and both rates with their n_eff and range.
function mixedRate(strata, z = Z) {
  if (strata.length === 0) throw new RangeError('a mix needs at least one group');
  for (const x of strata) {
    if (!(Number.isFinite(x.share) && x.share >= 0)) throw new RangeError('each share must be a number of 0 or more');
    if (!Number.isInteger(x.N) || !Number.isInteger(x.a) || !Number.isInteger(x.s) || x.N < 1 || x.s < 0 || x.s > x.a || x.a > x.N) {
      throw new RangeError('each group needs whole counts with 0 <= s <= a <= N and N >= 1');
    }
  }
  const total = strata.reduce((t, x) => t + x.share, 0);
  if (!(total > 0)) throw new RangeError('the shares add up to 0: there is nothing to weight by');
  // Shares each a number can still add up past the largest one (1e308 + 1e308): divided by
  // Infinity, every weight would be 0, or NaN, and the rate with them.
  if (!Number.isFinite(total)) throw new RangeError('the shares add up to more than a number can hold');
  const W = strata.map(x => x.share / total);
  let out = 0, bad = 0, sw2 = 0, all2 = 0;
  strata.forEach((x, i) => {
    const w = W[i] / x.N;   // what one record of this group stands for
    out += x.a * w;
    bad += x.s * w;
    sw2 += x.a * w * w;
    all2 += x.N * w * w;
  });
  const stEff = 1 / all2;
  const st = { rate: out, effective: stEff, ...bounds(out, stEff, z) };
  if (out === 0) return { shares: W, rate: null, effective: null, low: null, high: null, straight_through: st };
  const R = bad / out;
  const effective = (out * out) / sw2;
  return { shares: W, rate: R, effective, ...bounds(R, effective, z), straight_through: st };
}

// A share as a percentage to one decimal, or null.
const pct1 = x => (x === null ? null : Number((x * 100).toFixed(1)));

// The run to quote from several runs' rates: the highest as an exact fraction (trap G6); on a tie, the
// wider range. Never the runs added together (trap I8). null when no run has a rate.
function worstRun(rates, labels) {
  let worst = null;
  rates.forEach((r, i) => {
    if (r.d === 0) return;
    const w = worst === null ? null : rates[worst];
    if (w === null || r.n * w.d > w.n * r.d || (r.n * w.d === w.n * r.d && r.high_pct > w.high_pct)) worst = i;
  });
  return worst === null ? null : { run: worst + 1, label: labels[worst], ...rates[worst] };
}

module.exports = { Z, pct, pct1, boundPct, standsFor, pctOf, wilson, rate, cohensKappa, recordsNeeded, chanceAtMost, planTest, pairedDifference, clusteredRange, mixedRate, worstRun };
