// Pairs each prediction with its answer, by id, and works out each side's route class.
//
// Like matching exams to an answer key by student number: this is where problems that
// only show up when the two files are compared are caught (traps A8, B2-B6, B9, C1-C5).
// Every metric after this works from the paired records it returns:
//   { id, route, route_class, gold_route, gold_class, scored, movable, traps, duplicate_of, pred, key }
// where pred and key are the two sides' outputs, as load.js produced them. With groups in the
// config, each also carries groups: { name: [labels] }, each group's labels from its own side;
// with clusters, cluster: its cluster's value from its own side, or null for a cluster of its own.

const { resolveSet } = require('./metrics/slots.js');
const { markId } = require('./problems.js');

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

// One problem naming up to 20 ids, rather than one line per id: 200 missing records
// should read as one problem with a list.
function reportIds(p, trap, where, ids, what) {
  if (ids.length === 0) return;
  const shown = ids.slice(0, 20).map(id => '"' + markId(id) + '"').join(', ');
  const more = ids.length > 20 ? ' and ' + (ids.length - 20) + ' more' : '';
  p.stop(trap, where, ids.length + ' ' + what + ': ' + shown + more);
}

// id -> record, reporting ids that appear more than once (B2, B3).
function indexById(records, trap, where, p) {
  const byId = new Map();
  const repeats = new Map();
  for (const r of records) {
    if (byId.has(r.id)) repeats.set(r.id, (repeats.get(r.id) || 1) + 1);
    else byId.set(r.id, r);
  }
  for (const [id, n] of repeats) p.stop(trap, where, 'id "' + markId(id) + '" appears ' + n + ' times');
  return byId;
}

// The route class ("auto", "review", "block", "exclude") for a workflow decision, or
// null after reporting. Spaces around a decision are trimmed; a case difference is not
// guessed, because the guess could turn a review into an auto-publish (C3).
function routeClass(value, map, where, p, label, missingTrap, unknownTrap) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    p.stop(missingTrap, where, 'has no ' + label);
    return null;
  }
  if (typeof value !== 'string') { p.stop(unknownTrap, where, label + ' must be text, got ' + typeof value); return null; }
  if (has(map, value)) return map[value];

  const trimmed = value.trim();
  if (has(map, trimmed)) {
    p.fix('C3', where, 'trimmed spaces from ' + label + ' ' + JSON.stringify(value));
    return map[trimmed];
  }
  const near = Object.keys(map).find(d => d.toLowerCase() === trimmed.toLowerCase());
  if (near) {
    p.stop('C3', where, label + ' ' + JSON.stringify(value) + ' is not in routing.map (did you mean "' + near +
      '"? Case must match exactly, so a typo can never change where a record goes)');
  } else {
    p.stop(unknownTrap, where, label + ' ' + JSON.stringify(value) + ' is not in routing.map. Known decisions: ' + Object.keys(map).join(', '));
  }
  return null;
}

// A number within its output's tolerance of the key's is the key's number from here on, so every count agrees on it
// (F15). The number as given is kept beside it for the report.
function withinTolerance(rec, config) {
  for (const [name, o] of Object.entries(config.outputs)) {
    if ((o.type !== 'number' && o.type !== 'text') || !o.tolerance) continue;
    const given = rec.pred[name];
    const right = rec.key[name];
    if (!given || right === null || right === undefined || given.value === right) continue;
    const a = Number(given.value);
    const b = Number(right);
    // The small allowance keeps 27.615 within 0.005 of 27.61, which floating point puts a hair outside.
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= o.tolerance + 1e-9 * Math.max(1, Math.abs(b))) {
      rec.pred = { ...rec.pred, [name]: { ...given, value: right, as_given: given.value } };
    }
  }
}

// True if a prediction's applied values are exactly the key's, for every output: for a set,
// nothing wrong and no slot unfilled (slots.js).
function sameAsKey(pred, key, config) {
  return Object.entries(config.outputs).every(([name, o]) => {
    if (o.type !== 'set') return pred[name] !== null && pred[name].value === key[name];
    const { wrong, unfilled } = resolveSet(pred[name], key[name]);
    return wrong.length === 0 && unfilled.length === 0;
  });
}
const hasNoConfidence = (pred, config) => Object.entries(config.outputs).every(([name, o]) =>
  o.type !== 'set' ? pred[name] === null || pred[name].confidence === null : pred[name].every(v => v.confidence === null));

// opts: { predSource, keySource } for messages; sameFile when both came from one file.
function align(predictions, key, config, p, opts = {}) {
  const predSource = opts.predSource || 'predictions';
  const keySource = opts.keySource || 'answer key';

  // A8: one file, and every output reads the same field for prediction and answer.
  // Every record would match itself, so every score would be perfect and meaningless.
  if (opts.sameFile && Object.values(config.outputs).every(o => o.key_field === o.field)) {
    p.stop('A8', predSource, (opts.sameContent ? predSource + ' and ' + keySource + ' hold the same records' : 'predictions and answers come from the same file') +
      ' and the same fields, so every record would be scored against itself. Set key_field on each output to where the answers are.');
    return [];
  }

  const preds = indexById(predictions, 'B2', predSource, p);
  const answers = indexById(key, 'B3', keySource, p);

  // Records on only one side. Ids that differ only in case are reported as a pair (B9)
  // instead of as two unrelated missing records.
  const predOnly = [...preds.keys()].filter(id => !answers.has(id));
  const keyOnly = [...answers.keys()].filter(id => !preds.has(id));
  const keyOnlyByLower = new Map(keyOnly.map(id => [id.toLowerCase(), id]));
  const paired = new Set();
  for (const id of predOnly) {
    const match = keyOnlyByLower.get(id.toLowerCase());
    if (match === undefined) continue;
    p.stop('B9', predSource, 'id "' + markId(match, id) + '" is not in the answer key, which has "' + markId(match) + '". Ids must match exactly, including upper and lower case.');
    paired.add(id);
    paired.add(match);
  }
  reportIds(p, 'B4', predSource, predOnly.filter(id => !paired.has(id)), 'record(s) have no answer in the key');
  // B5 is always a stop, in lenient mode too: a record that goes in and never comes out is a bug.
  reportIds(p, 'B5', keySource, keyOnly.filter(id => !paired.has(id)),
    'record(s) in the answer key never came out of the workflow. A record that goes in and does not come out is a workflow bug');

  // Pair up, in answer-key order (B6: never by position).
  const map = config.routing.map;
  const groups = Object.entries(config.groups);
  const records = [];
  for (const [id, k] of answers) {
    const pr = preds.get(id);
    if (!pr) continue;
    const routeClassOf = routeClass(pr.route, map, predSource + ' ' + markId(id), p, 'route', 'C2', 'C1');
    const goldClass = config.routing.gold_field
      ? routeClass(k.gold_route, map, keySource + ' ' + markId(id), p, 'correct route (' + config.routing.gold_field + ')', 'C4', 'C5')
      : null;
    // Duplicate groups (C9, C11): a duplicate must point at a real, different record, and
    // the key should agree with itself that a duplicate is suppressed.
    const dup = k.duplicate_of ?? null;
    if (dup !== null) {
      if (dup === id) p.stop('C9', keySource + ' ' + markId(id), 'is marked as a duplicate of itself');
      else if (!answers.has(dup)) p.stop('C9', keySource + ' ' + markId(id), 'is marked as a duplicate of "' + markId(dup) + '", which is not in the answer key');
      if (goldClass !== null && goldClass !== 'exclude') {
        p.strict('C11', keySource + ' ' + markId(id), 'is marked as a duplicate of "' + markId(dup) + '", but its correct route is "' + k.gold_route + '", not a suppressing one');
      }
    }
    const rec = {
      id,
      route: typeof pr.route === 'string' ? pr.route.trim() : pr.route,
      route_class: routeClassOf,
      gold_route: typeof k.gold_route === 'string' ? k.gold_route.trim() : k.gold_route,
      gold_class: goldClass,
      scored: pr.scored,
      movable: pr.movable ?? null,
      traps: k.traps,
      duplicate_of: dup,
      pred: pr.outputs,
      key: k.outputs,
    };
    // A key-side group's labels come from the key record only, a prediction-side one's from the
    // prediction only: in a combined format both sides are the same records, read twice.
    if (groups.length) rec.groups = Object.fromEntries(groups.map(([name, g]) => [name, ((g.from === 'key' ? k : pr).groups || {})[name] || []]));
    if (config.clusters) rec.cluster = (config.clusters.from === 'key' ? k : pr).cluster ?? null;
    // How an agent used its tools: only with `tools` in the config.
    if (pr.tool_calls) rec.tool_calls = pr.tool_calls;
    if (k.tool_expect) rec.tool_expect = k.tool_expect;
    // Prediction fields kept for a record's own gate threshold or a policy what-if (load.js readFields).
    if (pr.fields) rec.fields = pr.fields;
    withinTolerance(rec, config);
    records.push(rec);
  }

  // A8: predictions identical to the key, and not one confidence anywhere. A real
  // workflow output almost always carries confidences; this is usually the key passed twice.
  // Only a warning: a perfect run of a workflow without confidences is possible.
  // Or a key whose values carry confidences, as no person writes them: an earlier run, perhaps, or
  // this one with its routes taken out (trap P20).
  if (records.length > 0 && records.every(r => (opts.keyConfident || hasNoConfidence(r.pred, config)) && sameAsKey(r.pred, r.key, config))) {
    p.warn('A8', predSource, opts.keyConfident ? 'every prediction matches the answer key exactly, and the key\'s values carry confidences, as a model\'s do: it looks like a run. Check the right files were passed.'
      : 'every prediction matches the answer key exactly and none has a confidence. Check the right files were passed.');
  }
  return records;
}

module.exports = { align, routeClass };
