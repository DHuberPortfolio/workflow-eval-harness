// Judges each paired record: did it need a human, did it go wrong without anyone
// seeing, and how (docs/SILENT_ERRORS.md). Every routing number, the per-trap table
// and the what-if are counts over these judgments, so the rules live in one place.

const { SEVERITIES, DECLINED } = require('../config.js');
const { resolveSet, unfilledLabel } = require('./slots.js');

const nonEmpty = obj => Object.keys(obj).length > 0;
const unique = list => [...new Set(list)];

// The outputs whose values are compared with the key. An output that is also the route
// (a verdict read from routing.field) is left out: a wrong verdict is a routing error,
// and the route types already describe it (SP-FORBIDDEN, SP-SHOULD-REVIEW, ...).
function contentOutputs(config) {
  return Object.entries(config.outputs).filter(([, o]) => !(o.type !== 'set' && o.field === config.routing.field));
}

// A label output as a list of one, so the gate reads sets and labels the same way.
const predValues = (r, name, o) => (o.type === 'set' ? r.pred[name] : r.pred[name] ? [r.pred[name]] : []);
// A value's weakest applied confidence. Two equivalent values merged into one (load.js, D23) keep
// their highest applied confidence and, below it, their lowest (floor_confidence): the floor and a
// "weakest" gate check that one, as they would have checked the two apart.
const weakest = v => v.floor_confidence ?? v.confidence;

// How a record's values differ from the key, per output:
//   wrong            - applied, not in the key
//   missing_rejected - in the key, proposed by the model, not applied (the floor dropped it)
//   missing          - in the key, never proposed
// For a set, "in the key" is per slot (slots.js): an any_of slot nothing applied fills is one
// entry, shown as "one of a, b, c", or with the alternative set aside: "b (one of a, b, c)".
//   invalid          - applied, not in the output's allowed_values
//   near_miss        - ordinal outputs: off by no more than near_miss_steps ("4 for 5")
//   declined         - labels with decline: declined, but the key has an answer (the key's answer)
//   should_decline   - labels with decline: answered, but the key says declining is correct
// A decline is never "wrong": declining and answering wrongly are different mistakes with
// different costs, and they are counted apart (docs/SILENT_ERRORS.md).
// A single-value output (label, ordinal) that is wrong is listed as wrong only: "the right
// label was never proposed" adds nothing when there is exactly one label.
// Most records have no finding of most kinds, and results keep every record's findings, so the
// kinds with none share one frozen empty object: nothing writes to findings after this function.
const NONE = Object.freeze({});
const found = kind => kind !== NONE;
function valueFindings(r, config) {
  const f = { wrong: NONE, missing_rejected: NONE, missing: NONE, invalid: NONE, near_miss: NONE, declined: NONE, should_decline: NONE };
  const add = (bucket, name, vals) => {
    if (vals.length === 0) return;
    if (f[bucket] === NONE) f[bucket] = {};
    f[bucket][name] = vals;
  };
  for (const [name, o] of contentOutputs(config)) {
    if (o.type !== 'set') {
      const p = r.pred[name];
      const k = r.key[name];
      if (k == null) continue;
      if (!p) { add('missing', name, [k]); continue; }
      if (p.declined) {
        if (k !== DECLINED) add('declined', name, [k + (p.set_aside ? ' (set aside: ' + p.set_aside + ')' : '')]);
        continue;
      }
      if (k === DECLINED) { add('should_decline', name, [p.value]); continue; }
      const allowed = config.allowed_values[name];
      if (Array.isArray(allowed) && !allowed.includes(p.value)) add('invalid', name, [p.value]);
      if (p.value === k) continue;
      const steps = o.type === 'ordinal' ? Math.abs(o.labels.indexOf(p.value) - o.labels.indexOf(k)) : null;
      if (steps !== null && steps <= o.near_miss_steps) add('near_miss', name, [p.value + ' for ' + k]);
      else add('wrong', name, [p.value + (o.type === 'ordinal' ? ' for ' + k : '')]);
      continue;
    }
    const { applied, wrong, unfilled } = resolveSet(r.pred[name], r.key[name]);
    add('wrong', name, wrong);
    add('missing_rejected', name, unfilled.filter(u => u.set_aside.length).map(unfilledLabel));
    add('missing', name, unfilled.filter(u => !u.set_aside.length).map(unfilledLabel));
    const allowed = config.allowed_values[name];
    if (Array.isArray(allowed)) add('invalid', name, applied.filter(v => !allowed.includes(v)));
  }
  return f;
}

// A gate's threshold for one record: a number; each record's own, when the config names a
// prediction field (load.js keeps it in r.fields); or a policy's cap on either, { of, cap }: the
// lower of the two (policy.js). undefined when the record's own is missing (trap E18, lenient).
function thresholdOf(r, configured) {
  if (typeof configured === 'number') return configured;
  if (typeof configured === 'string') return r.fields ? r.fields[configured] : undefined;
  const own = thresholdOf(r, configured.of);
  return own === undefined ? undefined : Math.min(own, configured.cap);
}

// Would the confidence gate let this record through? true or false, or null when a
// confidence or threshold it needs is missing. `overrides` replaces thresholds (for the what-if).
// At or above the threshold passes (trap E5). A gated output with nothing applied fails:
// there is nothing strong enough to stand on.
function gatePasses(r, config, overrides = {}) {
  const t = config.thresholds;
  if (!t || !nonEmpty(t.auto_publish)) return true;
  const useWeakest = t.gate_uses === 'weakest';
  let unknown = false;
  for (const [name, configured] of Object.entries(t.auto_publish)) {
    const threshold = thresholdOf(r, Object.hasOwn(overrides, name) ? overrides[name] : configured);
    const applied = predValues(r, name, config.outputs[name]).filter(v => v.applied);
    if (applied.length === 0) return false;
    let lead = useWeakest ? Infinity : -Infinity;   // the value the gate compares, among those with a confidence
    let noConfidence = false;
    for (const v of applied) {
      const c = useWeakest ? weakest(v) : v.confidence;
      if (c === null) noConfidence = true;
      else lead = useWeakest ? Math.min(lead, c) : Math.max(lead, c);
    }
    if (threshold === undefined) { unknown = true; continue; }
    // A weakest gate fails on any value under it, known whatever a value with no confidence says
    // (trap P9). A lead gate needs the strongest, and a value with no confidence could be it.
    if (useWeakest && lead < threshold) return false;
    if (noConfidence) { unknown = true; continue; }
    if (lead < threshold) return false;
  }
  return unknown ? null : true;
}

// Facts about the whole run that single-record judgments need.
function buildContext(records) {
  const classById = new Map(records.map(r => [r.id, r.route_class]));
  // Primaries with at least one duplicate kept, out without review or with a person: if the primary
  // itself was suppressed, the wrong copy was kept. A duplicate blocked or suppressed keeps nothing
  // (trap P7): the primary is then a real record suppressed, SO-FALSE-DUPLICATE.
  const keptDuplicateOf = new Set(records.filter(r => r.duplicate_of && (r.route_class === 'auto' || r.route_class === 'review')).map(r => r.duplicate_of));
  return { classById, keptDuplicateOf };
}

function worst(types, config) {
  const rank = t => SEVERITIES.indexOf(config.severity[t]);
  return types.length ? config.severity[types.reduce((a, b) => (rank(b) < rank(a) ? b : a))] : null;
}
// Types in a stable order: the order they are listed in config.js, most severe first.
const ordered = (types, config) => unique(types).sort((a, b) => Object.keys(config.severity).indexOf(a) - Object.keys(config.severity).indexOf(b));

// A what-if judges the same records again at every threshold, and a record's findings read only
// its pred, its key and the config's outputs, never a route or a threshold. So one sweep passes one
// WeakMap to all its judgments (ctx.findings; judgeAll) and each pred is compared with the key once.
// A sweep that changes what a record applies gives it a new pred, which is judged afresh.
function findingsOf(r, config, known) {
  if (!known) return valueFindings(r, config);
  if (!known.has(r.pred)) known.set(r.pred, valueFindings(r, config));
  return known.get(r.pred);
}

// The floor on one record: whether a value it applied has a confidence to compare at all (read), and
// whether one is under the floor (below). Labels are not read: the floor is a per-value rule of set
// outputs (docs/SILENT_ERRORS.md), and the report says so under not measured (trap P10).
function floorCheck(r, config, floor) {
  let read = false;
  for (const [name, o] of Object.entries(config.outputs)) {
    if (o.type !== 'set') continue;
    for (const v of r.pred[name]) {
      if (!v.applied || v.confidence === null) continue;
      read = true;
      if (weakest(v) < floor) return { read, below: true };
    }
  }
  return { read, below: false };
}

function judgeRecord(r, config, ctx) {
  const gold = r.gold_class;   // null without a gold route
  const values = findingsOf(r, config, ctx.findings);
  // An invalid value is in the list too: a value the key lists but allowed_values does not is still
  // a value that needed a person (trap P6), so a silent error always needed one.
  const mismatch = found(values.wrong) || found(values.missing_rejected) || found(values.missing) || found(values.near_miss) ||
    found(values.declined) || found(values.should_decline) || found(values.invalid);

  // Which evidence decides that a record needed a person (config: wrong_when).
  const useGold = gold !== null && config.wrong_when !== 'any_mismatch';
  const useValues = config.wrong_when !== 'gold_route';
  const needsHuman = (useGold && gold !== 'auto') || (useValues && mismatch);
  // A record the answer key blocks or suppresses must not go out (letting it out is a silent
  // error), but it needs no person either: the workflow should leave it out on its own. Sent to
  // a person, it is an unnecessary review, whatever its values (trap G12).
  const keyLeavesOut = useGold && (gold === 'block' || gold === 'exclude');

  // What would be wrong if this record went out without review.
  const routeTypes = [];
  if (gold === 'block') routeTypes.push('SP-FORBIDDEN');
  if (gold === 'review') routeTypes.push('SP-SHOULD-REVIEW');
  if (gold === 'exclude') {
    routeTypes.push('SP-DUPLICATE');
    if (r.duplicate_of && ctx.classById.get(r.duplicate_of) === 'exclude') routeTypes.push('SP-WRONG-PRIMARY');
  }
  const valueTypes = [];
  if (found(values.invalid)) valueTypes.push('SP-INVALID');
  if (found(values.wrong)) valueTypes.push('SP-WRONG');
  if (found(values.should_decline)) valueTypes.push('SP-SHOULD-DECLINE');
  if (found(values.missing_rejected)) valueTypes.push('SP-MISSING-REJECTED');
  if (found(values.missing)) valueTypes.push('SP-MISSING');
  if (found(values.declined)) valueTypes.push('SP-DECLINED');
  if (found(values.near_miss)) valueTypes.push('SP-NEAR-MISS');

  let silent = null;
  const safeguards = [];
  let gateUnknown = false;   // the gate could not be checked: a confidence or a threshold is missing
  let floorRead = false;     // the floor had a confidence to compare
  if (r.route_class === 'auto') {
    // A silent error if the deciding evidence says so; all types found are listed,
    // because the others explain it (D7: "should have been reviewed" because "the floor
    // dropped the violation").
    const counted = [...(useGold ? routeTypes : []), ...(useValues ? valueTypes : [])];
    if (counted.length) {
      const types = ordered([...routeTypes, ...valueTypes], config);
      silent = { types, severity: worst(types, config) };
    }
    // Safeguards that should have held the record, whether or not the content was right.
    const gate = config.thresholds ? gatePasses(r, config) : true;
    if (gate === false) safeguards.push('SG-GATE');
    gateUnknown = gate === null;
    const floor = config.thresholds ? config.thresholds.floor : null;
    if (floor !== null) {
      const f = floorCheck(r, config, floor);
      floorRead = f.read;
      if (f.below) safeguards.push('SG-FLOOR');
    }
  }

  // Blocked or suppressed, but the key says it should have gone through or to a person.
  // A record left out (block) because its label was declined, while the key has an answer,
  // is SO-DECLINED: the decline is why it was left out, so it takes that type instead of
  // SO-FALSE-BLOCK. It needs no correct route: the key's answer says something was lost,
  // unless the key's route says the record should be left out anyway.
  let omission = null;
  if (r.route_class === 'block' && found(values.declined) && (gold === null || gold === 'auto' || gold === 'review')) {
    omission = { types: ['SO-DECLINED'], severity: config.severity['SO-DECLINED'] };
  } else if ((gold === 'auto' || gold === 'review') && (r.route_class === 'block' || r.route_class === 'exclude')) {
    const type = r.route_class === 'block' ? 'SO-FALSE-BLOCK'
      : ctx.keptDuplicateOf.has(r.id) ? 'SO-PRIMARY-SUPPRESSED' : 'SO-FALSE-DUPLICATE';
    omission = { types: [type], severity: config.severity[type] };
  }

  return {
    id: r.id,
    route: r.route,
    route_class: r.route_class,
    gold_route: r.gold_route,
    gold_class: gold,
    traps: r.traps,
    scored: r.scored,
    values,
    mismatch,
    needs_human: needsHuman,
    routed_correctly: gold === null ? null : r.route_class === gold,
    silent,
    safeguards,
    gate_unknown: gateUnknown,
    floor_read: floorRead,
    omission,
    key_leaves_out: keyLeavesOut,
    wasted_review: r.route_class === 'review' && (!needsHuman || keyLeavesOut),
  };
}

// findings: for a sweep (findingsOf).
function judgeAll(records, config, findings = null) {
  const ctx = { ...buildContext(records), findings };
  return records.map(r => judgeRecord(r, config, ctx));
}

// The label outputs that may decline (outputs.<name>.decline).
const declineOutputs = config => Object.entries(config.outputs).filter(([, o]) => o.decline).map(([name]) => name);

module.exports = { declineOutputs, judgeAll, judgeRecord, buildContext, gatePasses, valueFindings, contentOutputs, worst };
