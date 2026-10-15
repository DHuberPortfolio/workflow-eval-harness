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
const { DECLINED } = require('../config.js');

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

// decline: the output's decline settings, or null. With it, the confusion matrix gains a
// "(declined)" column (and a row, when the key can say declining is correct), and a decline is
// neither a wrong label nor left out of the counts:
//   accuracy  - on what was answered: right answers / answers
//   per label - precision counts what was given (a decline gives nothing, so it is never a
//               false positive); recall counts a decline as a miss (the answer was not given)
//   declines  - coverage, the decline rate, unnecessary declines and answers that should have
//               been declines (see scoreDeclines)
function scoreLabel(pop, name, labels, decline = null) {
  const cols = decline ? [...labels, DECLINED] : labels;
  const rows = decline && decline.values.length ? cols : labels;   // the key can decline only through decline.values
  const confusion = {};   // confusion[key label][predicted label] = count
  for (const k of rows) { confusion[k] = {}; for (const p of cols) confusion[k][p] = 0; }
  let correct = 0;
  let answered = 0;
  for (const r of pop) {
    const predicted = r.pred[name] ? r.pred[name].value : null;
    if (predicted === null) continue;
    confusion[r.key[name]][predicted]++;
    if (predicted === DECLINED) continue;
    answered++;
    if (predicted === r.key[name]) correct++;
  }
  const per_label = {};
  for (const l of labels) {
    const tp = confusion[l][l];
    const fp = rows.reduce((s, k) => s + (k === l ? 0 : confusion[k][l]), 0);   // predicted l, key says otherwise
    const fn = cols.reduce((s, p) => s + (p === l ? 0 : confusion[l][p]), 0);   // key says l, predicted otherwise
    per_label[l] = scores(tp, fp, fn);
  }
  const out = { type: 'label', accuracy: rate(correct, decline ? answered : pop.length), per_label, confusion };
  if (decline) out.declines = scoreDeclines(pop, name, decline);
  return out;
}

// Declining as its own outcome. Every rate says what it is out of:
//   coverage                - answered, of all records
//   declined                - declined, of all records
//   unnecessary             - of the declines, the share where the key has an answer
//   should_have_declined    - of the answers, the share where the key says decline. null when the
//                             key cannot say so (no decline.values): not measured, never 0
function scoreDeclines(pop, name, decline) {
  const ids = list => list.map(r => r.id);
  const declined = pop.filter(r => r.pred[name] && r.pred[name].declined);
  const answered = pop.filter(r => r.pred[name] && !r.pred[name].declined);
  const unnecessary = declined.filter(r => r.key[name] !== DECLINED);
  const shouldHave = answered.filter(r => r.key[name] === DECLINED);
  return {
    coverage: rate(answered.length, pop.length),
    declined: rate(declined.length, pop.length),
    unnecessary: { rate: rate(unnecessary.length, declined.length), ids: ids(unnecessary) },
    should_have_declined: decline.values.length ? { rate: rate(shouldHave.length, answered.length), ids: ids(shouldHave) } : null,
    correct_declines: ids(declined.filter(r => r.key[name] === DECLINED)),
    key_declines: decline.values.length ? pop.filter(r => r.key[name] === DECLINED).length : null,
  };
}

// Ordered labels (bands 1-5, low/medium/high): everything a label gets, plus how FAR off
// each miss was, because a 4 for a 5 is a near miss and a 1 for a 5 is not.
//   exact            - scored on exactly the right step
//   within_one       - at most one step off
//   mean_distance    - how many steps off, on average (0 = always exact)
//   mean_signed      - the same with direction: above 0, predictions lean higher on the scale
//                      than the key; below 0, lower
//   closeness        - 1 minus each miss's distance as a share of the whole scale, averaged:
//                      1 is always exact, a one-step miss on a 5-step scale scores 0.75, a miss
//                      from one end to the other scores 0
//   miss_distances   - how many misses were 1 step off, 2 steps off, ...
function scoreOrdinal(pop, name, labels) {
  const base = scoreLabel(pop, name, labels);
  const span = labels.length - 1;
  const signed = [];
  for (const r of pop) {
    if (!r.pred[name]) continue;
    signed.push(labels.indexOf(r.pred[name].value) - labels.indexOf(r.key[name]));
  }
  const n = signed.length;
  const dist = signed.map(Math.abs);
  const round = (x, d) => (n === 0 ? null : Number(x.toFixed(d)));
  const missDistances = {};
  for (const d of dist) if (d > 0) missDistances[d] = (missDistances[d] || 0) + 1;
  return {
    ...base,
    type: 'ordinal',
    within_one: rate(dist.filter(d => d <= 1).length, n),
    mean_distance: round(dist.reduce((s, d) => s + d, 0) / n, 2),
    mean_signed: round(signed.reduce((s, d) => s + d, 0) / n, 2),
    closeness: round(dist.reduce((s, d) => s + (1 - d / span), 0) / n, 3),
    predicted_higher: signed.filter(d => d > 0).length,
    predicted_lower: signed.filter(d => d < 0).length,
    miss_distances: missDistances,
  };
}

function scoreQuality(records, config) {
  const pop = scorePopulation(records);
  const outputs = {};
  let tp = 0, fp = 0, fn = 0, anySet = false;
  for (const [name, o] of Object.entries(config.outputs)) {
    outputs[name] = o.type === 'set' ? scoreSet(pop, name) : o.type === 'ordinal' ? scoreOrdinal(pop, name, o.labels) : scoreLabel(pop, name, o.labels, o.decline);
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
