// Calibration: does a stated confidence mean what it says? If the threshold is 0.85,
// are values stated at 0.85 right 85% of the time?
//
// Every value the model proposed with a confidence is a claim, whether or not it was
// applied (a value the floor rejected was still a claim). A claim is right if the value
// is in the answer key. Claims are grouped by stated confidence; each group's accuracy
// is compared with what was stated.
//
// Left out: values without a confidence, and values inherited from another value (they
// copy its confidence; counting them would count one claim twice, trap D17).
//
// Average calibration gap (expected calibration error): each group's |accuracy - stated|,
// weighted by its size. 0 means perfectly calibrated. Model confidences are often closer
// to a ranking than a probability; this number says how far.

const { rate } = require('./stats.js');
const { scorePopulation } = require('./classification.js');

const round = (x, d) => Number(x.toFixed(d));

function claims(records, config) {
  const out = [];
  let noConfidence = 0;
  let inherited = 0;
  for (const r of scorePopulation(records)) {
    for (const [name, o] of Object.entries(config.outputs)) {
      if (o.type === 'set') {
        const inKey = new Set(r.key[name]);
        for (const v of r.pred[name]) {
          if (v.inherited) { inherited++; continue; }
          if (v.confidence === null) { noConfidence++; continue; }
          out.push({ output: name, id: r.id, value: v.value, confidence: v.confidence, correct: inKey.has(v.value) });
        }
      } else {
        const v = r.pred[name];
        if (!v) continue;
        if (v.confidence === null) { noConfidence++; continue; }
        out.push({ output: name, id: r.id, value: v.value, confidence: v.confidence, correct: v.value === r.key[name] });
      }
    }
  }
  return { claims: out, noConfidence, inherited };
}

// "distinct": one bucket per stated value. A width: fixed-width buckets. The small nudge
// before rounding down keeps 0.7 in the 0.7-0.8 bucket: in binary, 0.7 / 0.1 is
// 6.999999..., which would otherwise land it in 0.6-0.7 (trap G10).
function bucketKey(c, mode) {
  if (mode === 'distinct') return { from: c, to: c };
  let i = Math.floor(c / mode + 1e-9);
  if (i * mode >= 1 - 1e-9) i -= 1;   // 1.0 joins the top bucket
  return { from: round(i * mode, 4), to: round(Math.min(1, (i + 1) * mode), 4) };
}

function bucketize(list, mode) {
  const map = new Map();
  for (const c of list) {
    const b = bucketKey(round(c.confidence, 6), mode);
    const k = b.from + '|' + b.to;
    if (!map.has(k)) map.set(k, { ...b, items: [] });
    map.get(k).items.push(c);
  }
  const buckets = [...map.values()].sort((a, b) => a.from - b.from).map(b => {
    const n = b.items.length;
    const correct = b.items.filter(c => c.correct).length;
    const stated = b.items.reduce((s, c) => s + c.confidence, 0) / n;
    return {
      from: b.from, to: b.to, stated: round(stated, 4), n, correct,
      accuracy: rate(correct, n),
      gap: round(correct / n - stated, 2),
      claims: b.items.map(c => ({ id: c.id, output: c.output, value: c.value, correct: c.correct })),
    };
  });
  const total = list.length;
  const ece = total === 0 ? null : round(buckets.reduce((s, b) => s + b.n * Math.abs(b.correct / b.n - b.stated), 0) / total, 3);
  return { n: total, correct: list.filter(c => c.correct).length, accuracy: rate(list.filter(c => c.correct).length, total), ece, buckets };
}

function scoreCalibration(records, config) {
  const { claims: all, noConfidence, inherited } = claims(records, config);
  const distinct = new Set(all.map(c => round(c.confidence, 6))).size;
  const setting = config.calibration.buckets;
  const mode = setting === 'auto' ? (distinct <= 12 ? 'distinct' : 0.1) : setting;

  const outputs = {};
  for (const name of Object.keys(config.outputs)) {
    const mine = all.filter(c => c.output === name);
    if (mine.length) outputs[name] = bucketize(mine, mode);
  }

  // The config's own thresholds, checked against what happened: of the claims stated at
  // or above each one, how many were right?
  const thresholds = [];
  const t = config.thresholds;
  if (t) {
    const at = (list, v) => { const above = list.filter(c => c.confidence >= v); return rate(above.filter(c => c.correct).length, above.length); };
    if (t.floor !== null) thresholds.push({ name: 'floor', output: null, threshold: t.floor, at_or_above: at(all, t.floor), below: rate(all.filter(c => c.confidence < t.floor && c.correct).length, all.filter(c => c.confidence < t.floor).length) });
    if (t.provisional_below !== null) thresholds.push({ name: 'provisional_below', output: null, threshold: t.provisional_below, at_or_above: at(all, t.provisional_below) });
    for (const [name, v] of Object.entries(t.auto_publish)) {
      thresholds.push({ name: 'auto_publish', output: name, threshold: v, at_or_above: at(all.filter(c => c.output === name), v) });
    }
  }

  return {
    buckets: mode === 'distinct' ? 'distinct' : 'width ' + mode,
    overall: bucketize(all, mode),
    outputs,
    thresholds,
    left_out: { no_confidence: noConfidence, inherited },
  };
}

module.exports = { scoreCalibration };
