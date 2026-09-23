// Output quality: precision, recall and F1 per output, per value and overall.
//
// Population: records whose model call succeeded (scored) and that were not suppressed
// as duplicates (a duplicate's output is not an independent decision). Only applied values
// count as predicted; a value the workflow rejected was never given to anyone.
//
//   precision = of the values applied, the share that were right      TP / (TP + FP)
//   recall    = of the values that should be there, the share applied   TP / (TP + FN)
//   F1        = one number balancing the two: 2TP / (2TP + FP + FN)
// F1 is computed from counts, never from rounded percentages (trap G6), and is 0, not
// "unknown", when nothing was right (G4); it is null only when there was nothing at all (G3).

const { rate } = require('./stats.js');

const f1 = (tp, fp, fn) => (2 * tp + fp + fn === 0 ? null : Number(((2 * tp) / (2 * tp + fp + fn)).toFixed(3)));
const scores = (tp, fp, fn) => ({ tp, fp, fn, precision: rate(tp, tp + fp), recall: rate(tp, tp + fn), f1: f1(tp, fp, fn) });

function scorePopulation(records) {
  return records.filter(r => r.scored && r.route_class !== 'exclude');
}

function scoreSet(pop, name) {
  let tp = 0, fp = 0, fn = 0, exact = 0;
  const byValue = new Map();
  const count = (v, field) => {
    if (!byValue.has(v)) byValue.set(v, { tp: 0, fp: 0, fn: 0 });
    byValue.get(v)[field]++;
  };
  for (const r of pop) {
    const applied = new Set(r.pred[name].filter(v => v.applied).map(v => v.value));
    const key = new Set(r.key[name]);
    let same = applied.size === key.size;
    for (const v of applied) { if (key.has(v)) { tp++; count(v, 'tp'); } else { fp++; count(v, 'fp'); same = false; } }
    for (const v of key) if (!applied.has(v)) { fn++; count(v, 'fn'); same = false; }
    if (same) exact++;
  }
  const by_value = {};
  for (const v of [...byValue.keys()].sort()) { const c = byValue.get(v); by_value[v] = scores(c.tp, c.fp, c.fn); }
  return { type: 'set', ...scores(tp, fp, fn), exact_match: rate(exact, pop.length), by_value };
}

function scoreLabel(pop, name, labels) {
  const confusion = {};   // confusion[key label][predicted label] = count
  for (const k of labels) { confusion[k] = {}; for (const p of labels) confusion[k][p] = 0; }
  let correct = 0;
  for (const r of pop) {
    const predicted = r.pred[name] ? r.pred[name].value : null;
    if (predicted === null) continue;
    confusion[r.key[name]][predicted]++;
    if (predicted === r.key[name]) correct++;
  }
  const per_label = {};
  for (const l of labels) {
    const tp = confusion[l][l];
    const fp = labels.reduce((s, k) => s + (k === l ? 0 : confusion[k][l]), 0);   // predicted l, key says otherwise
    const fn = labels.reduce((s, p) => s + (p === l ? 0 : confusion[l][p]), 0);   // key says l, predicted otherwise
    per_label[l] = scores(tp, fp, fn);
  }
  return { type: 'label', accuracy: rate(correct, pop.length), per_label, confusion };
}

function scoreQuality(records, config) {
  const pop = scorePopulation(records);
  const outputs = {};
  let tp = 0, fp = 0, fn = 0, anySet = false;
  for (const [name, o] of Object.entries(config.outputs)) {
    outputs[name] = o.type === 'set' ? scoreSet(pop, name) : scoreLabel(pop, name, o.labels);
    if (o.type === 'set') { anySet = true; tp += outputs[name].tp; fp += outputs[name].fp; fn += outputs[name].fn; }
  }
  return {
    population: pop.length,
    left_out: {
      model_failed: records.filter(r => !r.scored).map(r => r.id),
      suppressed_duplicates: records.filter(r => r.scored && r.route_class === 'exclude').map(r => r.id),
    },
    outputs,
    // Pooled over set outputs only: a label is one decision per record, reported by its accuracy.
    overall: anySet ? scores(tp, fp, fn) : null,
  };
}

module.exports = { scoreQuality, scorePopulation, f1 };
