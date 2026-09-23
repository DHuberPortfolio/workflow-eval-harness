// Small shared arithmetic used by every metric.
//
// rate() is how every percentage in this tool is reported: the count, the base,
// the percentage, and the range the true value plausibly sits in. A bare "0.0%"
// hides whether it came from 0/7 or 0/700; the range makes that visible.

// Percentage to one decimal, or null when there is nothing to divide by.
// null (not 0) because "no auto-published records" is not "no errors".
const pct = (n, d) => (d === 0 ? null : Number(((n / d) * 100).toFixed(1)));

// Wilson score interval: the range of true rates consistent with seeing
// n successes in d trials, at 95% confidence (z = 1.96).
// Chosen over the textbook "p +/- 1.96 * sqrt(p(1-p)/d)" because that one
// breaks at small counts and at 0% or 100% - it says 0/7 has a range of
// exactly 0 to 0, which is the overconfidence we are trying to expose.
function wilson(n, d, z = 1.96) {
  if (d === 0) return null;
  const p = n / d;
  const z2 = z * z;
  const denom = 1 + z2 / d;
  const center = (p + z2 / (2 * d)) / denom;
  const half = (z * Math.sqrt(p * (1 - p) / d + z2 / (4 * d * d))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

function rate(n, d) {
  const w = wilson(n, d);
  return {
    n, d,
    pct: pct(n, d),
    low_pct: w === null ? null : Number((w.low * 100).toFixed(1)),
    high_pct: w === null ? null : Number((w.high * 100).toFixed(1)),
  };
}

module.exports = { pct, wilson, rate };
