// Pairs each prediction with its answer, by id, and works out each side's route class.
//
// Like matching exams to an answer key by student number: this is where problems that
// only show up when the two files are compared are caught (traps A8, B2-B6, B9, C1-C5).
// Every metric after this works from the paired records it returns:
//   { id, route, route_class, gold_route, gold_class, scored, movable, traps, duplicate_of, pred, key }
// where pred and key are the two sides' outputs, as load.js produced them.

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

// One problem naming up to 20 ids, rather than one line per id: 200 missing records
// should read as one problem with a list.
function reportIds(p, trap, where, ids, what) {
  if (ids.length === 0) return;
  const shown = ids.slice(0, 20).map(id => '"' + id + '"').join(', ');
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
  for (const [id, n] of repeats) p.stop(trap, where, 'id "' + id + '" appears ' + n + ' times');
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

// True if a prediction's applied values are exactly the key's, for every output.
function sameAsKey(pred, key, config) {
  return Object.entries(config.outputs).every(([name, o]) => {
    if (o.type !== 'set') return pred[name] !== null && pred[name].value === key[name];
    const applied = pred[name].filter(v => v.applied).map(v => v.value).sort();
    return applied.join('\u0000') === [...key[name]].sort().join('\u0000');
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
    p.stop('A8', predSource, 'predictions and answers come from the same file and the same fields, so every record would be scored against itself. ' +
      'Set key_field on each output to where the answers are.');
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
    p.stop('B9', predSource, 'id "' + id + '" is not in the answer key, which has "' + match + '". Ids must match exactly, including upper and lower case.');
    paired.add(id);
    paired.add(match);
  }
  reportIds(p, 'B4', predSource, predOnly.filter(id => !paired.has(id)), 'record(s) have no answer in the key');
  // B5 is always a stop, in lenient mode too: a record that goes in and never comes out is a bug.
  reportIds(p, 'B5', keySource, keyOnly.filter(id => !paired.has(id)),
    'record(s) in the answer key never came out of the workflow. A record that goes in and does not come out is a workflow bug');

  // Pair up, in answer-key order (B6: never by position).
  const map = config.routing.map;
  const records = [];
  for (const [id, k] of answers) {
    const pr = preds.get(id);
    if (!pr) continue;
    const routeClassOf = routeClass(pr.route, map, predSource + ' ' + id, p, 'route', 'C2', 'C1');
    const goldClass = config.routing.gold_field
      ? routeClass(k.gold_route, map, keySource + ' ' + id, p, 'correct route (' + config.routing.gold_field + ')', 'C4', 'C5')
      : null;
    // Duplicate groups (C9, C11): a duplicate must point at a real, different record, and
    // the key should agree with itself that a duplicate is suppressed.
    const dup = k.duplicate_of ?? null;
    if (dup !== null) {
      if (dup === id) p.stop('C9', keySource + ' ' + id, 'is marked as a duplicate of itself');
      else if (!answers.has(dup)) p.stop('C9', keySource + ' ' + id, 'is marked as a duplicate of "' + dup + '", which is not in the answer key');
      if (goldClass !== null && goldClass !== 'exclude') {
        p.strict('C11', keySource + ' ' + id, 'is marked as a duplicate of "' + dup + '", but its correct route is "' + k.gold_route + '", not a suppressing one');
      }
    }
    records.push({
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
    });
  }

  // A8: predictions identical to the key, and not one confidence anywhere. A real
  // workflow output almost always carries confidences; this is usually the key passed twice.
  // Only a warning: a perfect run of a workflow without confidences is possible.
  if (records.length > 0 && records.every(r => hasNoConfidence(r.pred, config) && sameAsKey(r.pred, r.key, config))) {
    p.warn('A8', predSource, 'every prediction matches the answer key exactly and none has a confidence. Check the right files were passed.');
  }
  return records;
}

module.exports = { align };
