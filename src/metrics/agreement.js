// How far several people agree when they label the same records: Krippendorff's alpha.
// Pure: units in, numbers out. src/agree.js reads the files; this file only counts.
//
// Krippendorff, K. (2011). Computing Krippendorff's Alpha-Reliability. Annenberg School for
// Communication, Departmental Papers 43, and Krippendorff (2004, 2019), Content Analysis.
// Every number here follows that paper's four steps, and test/agree.test.js reproduces its worked
// example (sections C and D: nominal 0.743, ordinal 0.815, interval 0.849, ratio 0.797).
//
//   1. A unit is one record (or one graded field): the values its graders gave, null for a grader
//      who gave none. Units with fewer than two values have nothing to pair and are left out
//      (counted as `single`).
//   2. Coincidences: within a unit of m values, every ordered pair of two different graders'
//      values adds 1 / (m - 1) to o[c][k]. So each pairable value is counted once, whatever m is,
//      and n_c (a row's total) is how many pairable values are c; n is all of them.
//   3. A difference function delta(c, k): how far apart two values are (0 for the same value).
//   4. alpha = 1 - D_o / D_e, where
//        D_o = sum o[c][k] delta(c, k) / n                    the disagreement observed
//        D_e = sum n_c n_k delta(c, k) / (n (n - 1))          the disagreement chance would give
//      1 is perfect agreement, 0 is agreement no better than chance, below 0 worse than chance.
//      When D_e is 0 (every pairable value the same) alpha is 0 / 0: null, "not measurable",
//      never 1 or 0, as cohensKappa does (trap M9).
//
// Difference functions (Krippendorff 2011, section D; delta is the paper's squared difference):
//   nominal   0 if the same value, 1 otherwise (labels, the route, free-text grades)
//   ordinal   (sum of n_g over the ranks from c to k, minus (n_c + n_k) / 2) squared: how many
//             pairable values lie between two levels, so a miss across a crowded middle counts
//             more than a miss across an empty one. The ranks are the config's level order.
//   interval  (c - k) squared
//   ratio     ((c - k) / (c + k)) squared
//   jaccard   for sets: 1 - |A and B| / |A or B|, the share of the values either listed that the
//             other did not (0 for two empty sets). Used for set outputs: see docs/METRICS.md
//             for why over MASI.
//   masi      for sets (Passonneau 2006, "Measuring agreement on set-valued items (MASI) for
//             semantic and pragmatic annotation", LREC): 1 - J x M, where J is Jaccard's
//             similarity and M is 1 for equal sets, 2/3 when one contains the other, 1/3 when
//             they overlap otherwise, 0 when they are apart. Given beside Jaccard, for comparison.
// The set distances are used as delta directly, as Passonneau (2006) does: they are already on
// a 0-1 scale, like nominal's.


const THRESHOLDS = { reliable: 0.8, tentative: 0.667 };
// 95% in the middle, as everywhere in this tool (z = 1.96): 2.5% in each tail.
const TAIL = 0.025;

// Krippendorff (2004, Content Analysis; Hayes and Krippendorff 2007): rely on data at 0.800 or above; between 0.667 and 0.800,
// tentative conclusions only; below 0.667, do not rely on them.
function reading(alpha) {
  if (alpha === null || alpha === undefined) return 'not_measurable';
  if (alpha >= THRESHOLDS.reliable) return 'reliable';
  if (alpha >= THRESHOLDS.tentative) return 'tentative';
  return 'unreliable';
}

const isSetMetric = m => m === 'jaccard' || m === 'masi';
// A value as one key: text for labels, the sorted distinct members for a set (order never matters).
function keyOf(v, metric) {
  if (isSetMetric(metric)) return JSON.stringify([...new Set(v.map(String))].sort());
  return String(v);
}

function jaccardDistance(a, b) {
  const A = new Set(a), B = new Set(b);
  const union = new Set([...A, ...B]).size;
  if (union === 0) return 0;
  const both = [...A].filter(x => B.has(x)).length;
  return 1 - both / union;
}

function masiDistance(a, b) {
  const A = new Set(a), B = new Set(b);
  const union = new Set([...A, ...B]).size;
  if (union === 0) return 0;
  const both = [...A].filter(x => B.has(x)).length;
  const m = both === A.size && both === B.size ? 1 : both === A.size || both === B.size ? 2 / 3 : both > 0 ? 1 / 3 : 0;
  return 1 - (both / union) * m;
}

// jaccardDistance / masiDistance on sorted lists of distinct whole numbers (prepare's ids).
function setDistance(A, B, masi) {
  let i = 0, j = 0, both = 0;
  while (i < A.length && j < B.length) { if (A[i] === B[j]) { both++; i++; j++; } else if (A[i] < B[j]) i++; else j++; }
  const union = A.length + B.length - both;
  if (union === 0) return 0;
  if (!masi) return 1 - both / union;
  const m = both === A.length && both === B.length ? 1 : both === A.length || both === B.length ? 2 / 3 : both > 0 ? 1 / 3 : 0;
  return 1 - (both / union) * m;
}

// Steps 1 and 3 once: the distinct values, each unit's counts of them, and the fixed differences.
// units: [[value or null per grader]]. opts: { metric, order } (order: the ordinal levels, lowest first).
function prepare(units, { metric = 'nominal', order = null } = {}) {
  const index = new Map();
  const raw = [];
  const prepared = [];
  let single = 0;
  for (const u of units) {
    const given = u.filter(v => v !== null && v !== undefined);
    if (given.length < 2) { if (given.length === 1) single++; continue; }
    const counts = new Map();
    for (const v of given) {
      const k = keyOf(v, metric);
      if (!index.has(k)) { index.set(k, raw.length); raw.push(v); }
      const i = index.get(k);
      counts.set(i, (counts.get(i) || 0) + 1);
    }
    prepared.push({ m: given.length, counts: [...counts.entries()] });
  }
  const V = raw.length;
  let delta = null;   // fixed differences, V x V; ordinal's depend on the counts, so each run builds them
  let rank = null;
  if (metric === 'ordinal') {
    if (!Array.isArray(order)) throw new Error('the ordinal metric needs the order of the levels');
    const at = new Map(order.map((l, i) => [String(l), i]));
    rank = raw.map(v => {
      if (!at.has(String(v))) throw new Error('value ' + JSON.stringify(v) + ' is not one of the ordered levels');
      return at.get(String(v));
    });
  } else {
    const d = {
      nominal: (a, b) => (a === b ? 0 : 1),
      interval: (a, b) => (raw[a] - raw[b]) ** 2,
      ratio: (a, b) => (raw[a] + raw[b] === 0 ? 0 : ((raw[a] - raw[b]) / (raw[a] + raw[b])) ** 2),
      jaccard: (a, b) => setDistance(ids[a], ids[b], false),
      masi: (a, b) => setDistance(ids[a], ids[b], true),
    }[metric];
    if (!d) throw new Error('unknown metric ' + JSON.stringify(metric));
    // Each set once as a sorted list of whole-number ids, so V x V distances need no Sets.
    const code = new Map();
    const ids = isSetMetric(metric) ? raw.map(v => [...new Set(v.map(String))].map(x => { if (!code.has(x)) code.set(x, code.size); return code.get(x); }).sort((x, y) => x - y)) : null;
    delta = new Float64Array(V * V);
    for (let a = 0; a < V; a++) for (let b = 0; b < V; b++) delta[a * V + b] = a === b ? 0 : d(a, b);
  }
  return { metric, order, raw, keys: [...index.keys()], units: prepared, single, V, delta, rank, levels: order ? order.length : 0 };
}

// Steps 2 and 4 for one weighting of the units (all 1 for the estimate; how often each was drawn
// for a bootstrap resample).
function compute(P, weights = null) {
  const { V } = P;
  const o = new Float64Array(V * V);
  P.units.forEach((u, i) => {
    const w = weights ? weights[i] : 1;
    if (w === 0) return;
    const per = w / (u.m - 1);
    for (const [a, ca] of u.counts) for (const [b, cb] of u.counts) o[a * V + b] += per * (a === b ? ca * (ca - 1) : ca * cb);
  });
  const nc = new Float64Array(V);
  let n = 0, same = 0;
  for (let a = 0; a < V; a++) { for (let b = 0; b < V; b++) nc[a] += o[a * V + b]; n += nc[a]; same += o[a * V + a]; }
  let delta = P.delta;
  if (P.metric === 'ordinal') {
    // n_g for every level, the unused ones 0 (they change nothing, page 6 of the paper).
    const ng = new Float64Array(P.levels);
    for (let a = 0; a < V; a++) ng[P.rank[a]] += nc[a];
    const before = new Float64Array(P.levels + 1);   // cumulative: before[r] = sum of n_g below rank r
    for (let r = 0; r < P.levels; r++) before[r + 1] = before[r] + ng[r];
    delta = new Float64Array(V * V);
    for (let a = 0; a < V; a++) for (let b = 0; b < V; b++) {
      const lo = Math.min(P.rank[a], P.rank[b]), hi = Math.max(P.rank[a], P.rank[b]);
      delta[a * V + b] = (before[hi + 1] - before[lo] - (ng[lo] + ng[hi]) / 2) ** 2;
    }
  }
  let obs = 0, exp = 0;
  for (let a = 0; a < V; a++) for (let b = 0; b < V; b++) {
    const d = delta[a * V + b];
    if (d === 0) continue;
    obs += o[a * V + b] * d;
    exp += nc[a] * nc[b] * d;
  }
  if (n < 2) return { alpha: null, observed: null, expected: null, n, same, o, nc };
  const Do = obs / n;
  const De = exp / (n * (n - 1));
  // 0 / 0 when chance itself never disagrees. Below 1e-12 counts as 0: sums of thirds are not exact.
  const alpha = De <= 1e-12 ? null : 1 - Do / De;
  return { alpha, observed: Do, expected: De, n, same, o, nc, delta };
}

// Krippendorff's alpha. Returns
//   { alpha (null: not measurable), observed (D_o), expected (D_e), units (pairable), single
//     (units with one value: left out), values (n, pairable values), agreement (the share of
//     pairable pairs that are the exact same value: raw agreement), top: { value, share } (the
//     most used value), coincidences: { value(c, k), total(c) } }
function krippendorffAlpha(units, opts = {}) {
  const P = prepare(units, opts);
  const r = compute(P);
  const V = P.V;
  const at = new Map(P.keys.map((k, i) => [k, i]));
  const idx = v => at.get(isSetMetric(P.metric) ? keyOf(v, P.metric) : String(v));
  let top = null;
  for (let a = 0; a < V; a++) if (top === null || r.nc[a] > r.nc[top]) top = a;
  return {
    alpha: r.alpha,
    observed: r.observed,
    expected: r.expected,
    units: P.units.length,
    single: P.single,
    values: r.n,
    agreement: r.n > 0 ? r.same / r.n : null,
    // How often two values drawn at random from the pairable ones would be the exact same value.
    chance_agreement: r.n > 1 ? Array.from(r.nc).reduce((s, x) => s + x * (x - 1), 0) / (r.n * (r.n - 1)) : null,
    top: top === null ? null : { value: P.raw[top], share: r.nc[top] / r.n },
    coincidences: {
      value: (c, k) => (idx(c) === undefined || idx(k) === undefined ? 0 : r.o[idx(c) * V + idx(k)]),
      total: c => (idx(c) === undefined ? 0 : r.nc[idx(c)]),
    },
  };
}

// A small seeded generator (mulberry32), so the same files always give the same range.
function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// The value below which a share q of the sorted list falls, between neighbours (Hyndman and
// Fan's type 7, the usual default).
function quantile(sorted, q) {
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  return lo + 1 < sorted.length ? sorted[lo] + (h - lo) * (sorted[lo + 1] - sorted[lo]) : sorted[lo];
}

// The same alpha as compute(), faster, for resampling with a fixed difference (every metric but
// ordinal). Nothing changes inside a unit, so each unit's own sums are worked once:
//   m_u  its values; d_u = sum of its pairs' differences / (m_u - 1), its share of D_o's sum
// and a resample's sums are weighted totals of them. D_e's sum, sum n_c n_k delta, is worked over
// values (V x V) when there are fewer values than units; when there are more (sets: nearly every
// record its own set), over pairs of units instead: sum w_u w_v G[u][v], with G[u][v] the sum of
// delta over u's values and v's. The same number either way, in far fewer steps.
function fastPath(P) {
  const U = P.units.length, V = P.V, d = P.delta;
  const m = new Float64Array(U), du = new Float64Array(U);
  P.units.forEach((u, i) => {
    m[i] = u.m;
    let s = 0;
    for (const [a, ca] of u.counts) for (const [b, cb] of u.counts) if (a !== b) s += ca * cb * d[a * V + b];
    du[i] = s / (u.m - 1);
  });
  let G = null;
  if (V > U && U <= 4000) {
    G = new Float64Array(U * U);
    for (let i = 0; i < U; i++) for (let j = i; j < U; j++) {
      let s = 0;
      for (const [a, ca] of P.units[i].counts) for (const [b, cb] of P.units[j].counts) s += ca * cb * d[a * V + b];
      G[i * U + j] = s;
      G[j * U + i] = s;
    }
  }
  const nc = new Float64Array(V);
  const alphaOf = w => {
    let n = 0, obs = 0, exp = 0;
    const drawn = [];
    for (let i = 0; i < U; i++) if (w[i] > 0) { n += w[i] * m[i]; obs += w[i] * du[i]; drawn.push(i); }
    if (G) {
      for (const i of drawn) { const row = i * U; let s = 0; for (const j of drawn) s += w[j] * G[row + j]; exp += w[i] * s; }
    } else {
      nc.fill(0);
      for (const i of drawn) for (const [a, ca] of P.units[i].counts) nc[a] += w[i] * ca;
      for (let a = 0; a < V; a++) if (nc[a] > 0) for (let b = 0; b < V; b++) exp += nc[a] * nc[b] * d[a * V + b];
    }
    if (n < 2) return null;
    const De = exp / (n * (n - 1));
    return De <= 1e-12 ? null : 1 - (obs / n) / De;
  };
  // The jackknife in closed form: with record i left out, D_e's sum is S - 2 r_i + G_ii (over units:
  // S the sum of all G, r_i the sum of G's row i), or over values E - 2 sum c_ia T_a + sum c_ia c_ib
  // delta_ab (T_a = sum n_b delta_ab). The same numbers as recomputing N times, in one pass.
  alphaOf.jackknife = () => {
    let n = 0, obs = 0;
    for (let i = 0; i < U; i++) { n += m[i]; obs += du[i]; }
    const expOut = new Float64Array(U);
    if (G) {
      const r = new Float64Array(U);
      let S = 0;
      for (let i = 0; i < U; i++) { let s = 0; const row = i * U; for (let j = 0; j < U; j++) s += G[row + j]; r[i] = s; S += s; }
      for (let i = 0; i < U; i++) expOut[i] = S - 2 * r[i] + G[i * U + i];
    } else {
      nc.fill(0);
      for (const u of P.units) for (const [a, ca] of u.counts) nc[a] += ca;
      const T = new Float64Array(V);
      let E = 0;
      for (let a = 0; a < V; a++) { let s = 0; for (let b = 0; b < V; b++) s += nc[b] * d[a * V + b]; T[a] = s; E += nc[a] * s; }
      P.units.forEach((u, i) => {
        let x = E;
        for (const [a, ca] of u.counts) x -= 2 * ca * T[a];
        for (const [a, ca] of u.counts) for (const [b, cb] of u.counts) x += ca * cb * d[a * V + b];
        expOut[i] = x;
      });
    }
    return Array.from(expOut, (x, i) => {
      const nn = n - m[i];
      if (nn < 2) return null;
      const De = x / (nn * (nn - 1));
      return De <= 1e-12 ? null : 1 - ((obs - du[i]) / nn) / De;
    });
  };
  return alphaOf;
}

// ---------- The normal curve (for the BCa range) ----------

// The share of the normal curve below x. erfc by Chebyshev fitting (Press et al., Numerical
// Recipes, erfcc: fractional error under 1.2e-7 everywhere).
function normalCdf(x) {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? 1 - r / 2 : r / 2;
}

// The x below which a share p of the normal curve lies. Acklam's rational approximation
// (relative error under 1.15e-9).
const QA = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
const QB = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
const QC = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758276161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
const QD = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
function normalQuantile(p) {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  const tail = q => (((((QC[0] * q + QC[1]) * q + QC[2]) * q + QC[3]) * q + QC[4]) * q + QC[5]) / ((((QD[0] * q + QD[1]) * q + QD[2]) * q + QD[3]) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5, r = q * q;
  return (((((QA[0] * r + QA[1]) * r + QA[2]) * r + QA[3]) * r + QA[4]) * r + QA[5]) * q / (((((QB[0] * r + QB[1]) * r + QB[2]) * r + QB[3]) * r + QB[4]) * r + 1);
}

// ---------- The likely range ----------

// The acceleration of a BCa range from the jackknife values (Efron and Tibshirani 1993, eq. 14.15):
//   a = sum (mean - theta_i)^3 / (6 (sum (mean - theta_i)^2)^1.5)
// 0 when the jackknife values are all the same (nothing to measure the skew from): the range is
// then the bias-corrected one alone.
function acceleration(thetas) {
  const mean = thetas.reduce((s, x) => s + x, 0) / thetas.length;
  let s2 = 0, s3 = 0;
  for (const x of thetas) { const d = mean - x; s2 += d * d; s3 += d * d * d; }
  return s2 <= 1e-24 ? 0 : s3 / (6 * s2 ** 1.5);
}

// The shares of the sorted resamples a BCa range is read at (Efron 1987; Efron and Tibshirani
// 1993, eq. 14.10): Phi(z0 + (z0 + z) / (1 - a (z0 + z))) for z at 2.5% and 97.5%.
function bcaLevels(z0, a) {
  return [TAIL, 1 - TAIL].map(t => { const z = normalQuantile(t); return normalCdf(z0 + (z0 + z) / (1 - a * (z0 + z))); });
}

// Resamples alpha once and reads three ranges off the same resamples, so scripts/agree-coverage.js
// compares exactly the code that ships:
//   percentile     the middle 95% of the resampled alphas (Efron and Tibshirani 1993, ch. 13)
//   bca            bias-corrected and accelerated (Efron 1987; Efron and Tibshirani 1993, ch. 14):
//                  the percentile range read at shares moved by the bias z0 (how far the resamples
//                  sit off the estimate) and the acceleration a (how fast the spread changes with
//                  alpha, from the jackknife over records: alpha with each record left out once).
//                  z0 = Phi^-1(share of resamples below the estimate, ties counted half). When that
//                  share is 0 or 1, z0 is infinite and the range falls back to percentile
//                  (fallback: true); jackknife values that are not measurable are left out, and with
//                  fewer than two left, or all the same, a is 0.
//   log_jackknife  a normal range on log(1 - alpha) (1 - alpha is D_o / D_e, a ratio), with the
//                  jackknife's standard error: 1 - exp(log(1 - alpha) +- 1.96 se). null when a
//                  jackknife alpha is 1 or not measurable.
// Each resample draws as many pairable records as there are, with replacement, keeping a record's
// values together, and recomputes alpha in full (ordinal: the differences too). Records are what
// was sampled, so records are what is resampled. Resamples with no alpha (every value the same)
// are counted in `unmeasurable` and left out.
function bootstrapIntervals(units, opts = {}, { resamples = 2000, seed = 1, full = false } = {}) {
  const P = prepare(units, opts);
  const N = P.units.length;
  const none = { alphas: [], unmeasurable: 0, percentile: null, bca: null, log_jackknife: null, z0: null, a: null };
  if (N === 0) return { ...none, why: 'not_measurable' };
  const point = compute(P);
  const most = point.nc.reduce((x, y) => Math.max(x, y), 0);
  // Counts of values are whole numbers; sums of thirds may be a hair off one.
  const why = point.alpha === null ? 'not_measurable' : point.observed <= 1e-12 ? 'no_disagreement' : point.n - most < 1.5 ? 'one_odd_value' : null;
  if (why) return { ...none, why };
  // One record compared: every resample is that record again (a zero-width range).
  if (N < 2) return { ...none, why: 'one_record' };
  const rand = seeded(seed);
  const alphas = [];
  let unmeasurable = 0;
  const w = new Float64Array(N);
  const alphaOf = full || P.metric === 'ordinal' ? x => compute(P, x).alpha : fastPath(P);
  for (let s = 0; s < resamples; s++) {
    w.fill(0);
    for (let i = 0; i < N; i++) w[Math.floor(rand() * N)]++;
    const a = alphaOf(w);
    if (a === null) unmeasurable++;
    else alphas.push(a);
  }
  if (alphas.length === 0) return { ...none, unmeasurable, why: 'not_measurable' };
  alphas.sort((x, y) => x - y);
  // Every resample gave the same alpha (the records all look alike): a range of zero width would
  // claim certainty the records cannot give.
  if (alphas[alphas.length - 1] - alphas[0] < 1e-12) return { ...none, unmeasurable, why: 'no_spread' };
  const theta = point.alpha;
  const percentile = { low: quantile(alphas, TAIL), high: quantile(alphas, 1 - TAIL) };

  // The jackknife: every record left out once.
  let jack = [];
  if (alphaOf.jackknife) jack = alphaOf.jackknife();
  else { w.fill(1); for (let i = 0; i < N; i++) { w[i] = 0; jack.push(alphaOf(w)); w[i] = 1; } }
  const measured = jack.filter(x => x !== null);
  const a = measured.length >= 2 ? acceleration(measured) : 0;
  const below = alphas.filter(x => x < theta - 1e-12).length;
  const tied = alphas.filter(x => Math.abs(x - theta) <= 1e-12).length;
  const p0 = (below + tied / 2) / alphas.length;
  let bca;
  if (p0 <= 0 || p0 >= 1) bca = { ...percentile, fallback: true };
  else {
    const z0 = normalQuantile(p0);
    const [l, h] = bcaLevels(z0, a);
    bca = { low: quantile(alphas, l), high: quantile(alphas, h), fallback: false, z0 };
  }
  let logJack = null;
  if (measured.length === N && measured.every(x => x < 1)) {
    const phi = measured.map(x => Math.log(1 - x));
    const mean = phi.reduce((s, x) => s + x, 0) / N;
    const se = Math.sqrt(((N - 1) / N) * phi.reduce((s, x) => s + (x - mean) ** 2, 0));
    const f = Math.log(1 - theta);
    logJack = { low: 1 - Math.exp(f + 1.959964 * se), high: 1 - Math.exp(f - 1.959964 * se) };
  }
  // Krippendorff's own bootstrap ("Bootstrapping Distributions for Krippendorff's Alpha", 2006,
  // revised 2016; KALPHA, Hayes and Krippendorff 2007), when every compared record has exactly two
  // values: D_e is kept from the data, and each record draws one pair uniformly from all the data's
  // pairs, alpha* = 1 - sum of E(r), E(r) = 2 delta / (n D_e). Its own seeded draws, so the
  // resamples above are unchanged. Its range is the middle 95% of alpha*; its q the share below.
  let krippendorff = null, kAlphas = null;
  if (P.units.every(u => u.m === 2)) {
    const V = P.V;
    const E = P.units.map(u => (u.counts.length === 1 ? 0 : 2 * point.delta[u.counts[0][0] * V + u.counts[1][0]] / (point.n * point.expected)));
    const krand = seeded(seed);
    kAlphas = [];
    for (let s = 0; s < resamples; s++) { let x = 1; for (let u = 0; u < N; u++) x -= E[Math.floor(krand() * N)]; kAlphas.push(Math.max(-1, x)); }
    kAlphas.sort((x, y) => x - y);
    // Every pair drawn the same (every record a disagreement of one size, say): no spread, and a
    // range of zero width would claim certainty (trap M15).
    krippendorff = kAlphas[kAlphas.length - 1] - kAlphas[0] < 1e-12 ? { low: null, high: null, why: 'no_spread' } : { low: quantile(kAlphas, TAIL), high: quantile(kAlphas, 1 - TAIL) };
  }
  return { alphas, unmeasurable, why: null, percentile, bca, log_jackknife: logJack, krippendorff, krippendorff_alphas: kAlphas, z0: bca.fallback ? null : bca.z0, a };
}

// The chance alpha is below t, read through the same mapping as the BCa range (Efron and Tibshirani
// 1993, ch. 14): with G the share of resamples below t, u = Phi^-1(G) - z0, and the BCa share is
// Phi(u / (1 + a u) - z0), the level at which the BCa range would put its end at t. With no bias
// and no acceleration it is G itself.
function bcaShare(G, z0, a) {
  if (G <= 0) return 0;
  if (G >= 1) return 1;
  const u = normalQuantile(G) - z0;
  if (1 + a * u <= 0) return u < 0 ? 0 : 1;
  return normalCdf(u / (1 + a * u) - z0);
}

// The method wfeval agree uses for the likely range with three graders or more: BCa. Chosen by
// scripts/agree-coverage.js over 58 settings (docs/METRICS.md): the best worst-setting and mean
// coverage of the ranges over records, for about 2% more width than percentile. For names (nominal)
// with exactly two values on every record, Krippendorff's bootstrap did better
// (scripts/agree-two-graders.js), and bootstrapAlpha uses it there.
const RANGE_METHOD = 'bca';

// The likely range of alpha. Zapf et al. (2016), BMC Medical Research Methodology 16:93,
// recommend a bootstrap interval for alpha. below: the share of resamples under each of
// Krippendorff's thresholds, Hayes and Krippendorff's (2007) q, "the chance alpha is below 0.800".
// Returns { low, high, below: { '0.800', '0.667' }, resamples, unmeasurable, method, why }. No range
// (low, high and the chances null, `why` saying which) in the three cases Krippendorff's
// bootstrap note ("Bootstrapping Distributions for Krippendorff's Alpha", 2016) says bootstrapping
// does not apply to (trap M15):
//   not_measurable   alpha itself is 0 / 0 (every value the same)
//   no_disagreement  alpha is 1: every resample is 1 too, and a range of 1 to 1 would claim
//                    certainty from a handful of records, as "0 of 7, range 0 to 0" would
//   one_odd_value    every value but one is the same: alpha is 0 by computation, and each resample
//                    either holds the odd value or has no alpha at all
// full: true recomputes every resample in full (compute()), for the test that the fast path agrees.
function bootstrapAlpha(units, opts = {}, { resamples = 2000, seed = 1, full = false, method = null } = {}) {
  const r = bootstrapIntervals(units, opts, { resamples, seed, full });
  // Names (nominal) with exactly two values on every compared record: Krippendorff's bootstrap;
  // otherwise BCa. With the shipped code it beat BCa on nominal data and did worse on ordinal data
  // (scripts/agree-two-graders.js; docs/METRICS.md).
  if (method === null) method = r.krippendorff && (opts.metric || 'nominal') === 'nominal' ? 'krippendorff' : RANGE_METHOD;
  const range = r[method];
  const plain = t => r.alphas.filter(a => a < t).length / r.alphas.length;
  // q follows the range: through the BCa mapping when the range is BCa (plain when BCa fell back).
  const share = method === 'krippendorff' ? t => r.krippendorff_alphas.filter(a => a < t).length / r.krippendorff_alphas.length
    : method === 'bca' && r.z0 !== null ? t => bcaShare(plain(t), r.z0, r.a) : plain;
  if (!range || range.low === null) return { low: null, high: null, below: { '0.800': null, '0.667': null }, resamples, unmeasurable: r.unmeasurable, method, why: (range && range.why) || r.why || 'not_measurable' };
  return {
    low: range.low, high: range.high,
    below: { '0.800': share(THRESHOLDS.reliable), '0.667': share(THRESHOLDS.tentative) },
    resamples, unmeasurable: r.unmeasurable, method, why: null,
  };
}

module.exports = { krippendorffAlpha, bootstrapAlpha, bootstrapIntervals, jaccardDistance, masiDistance, reading, THRESHOLDS, normalCdf, normalQuantile, acceleration, bcaLevels, bcaShare };
