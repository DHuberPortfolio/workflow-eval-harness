// Judges each paired record: did it need a human, did it go wrong without anyone
// seeing, and how (docs/SILENT_ERRORS.md). Every routing number, the per-trap table
// and the what-if are counts over these judgments, so the rules live in one place.

const { SEVERITIES } = require('../config.js');

const nonEmpty = obj => Object.keys(obj).length > 0;
const unique = list => [...new Set(list)];

// The outputs whose values are compared with the key. An output that is also the route
// (a verdict read from routing.field) is left out: a wrong verdict is a routing error,
// and the route types already describe it (SP-FORBIDDEN, SP-SHOULD-REVIEW, ...).
function contentOutputs(config) {
  return Object.entries(config.outputs).filter(([, o]) => !(o.type === 'label' && o.field === config.routing.field));
}

// A label output as a list of one, so sets and labels are compared the same way.
const predValues = (r, name, o) => (o.type === 'set' ? r.pred[name] : r.pred[name] ? [r.pred[name]] : []);
const keyValues = (r, name, o) => (o.type === 'set' ? r.key[name] : r.key[name] != null ? [r.key[name]] : []);

// How a record's values differ from the key, per output:
//   wrong            - applied, not in the key
//   missing_rejected - in the key, proposed by the model, not applied (the floor dropped it)
//   missing          - in the key, never proposed
//   invalid          - applied, not in the output's allowed_values
function valueFindings(r, config) {
  const f = { wrong: {}, missing_rejected: {}, missing: {}, invalid: {} };
  for (const [name, o] of contentOutputs(config)) {
    const pv = predValues(r, name, o);
    const kv = keyValues(r, name, o);
    const applied = pv.filter(v => v.applied).map(v => v.value);
    const proposed = new Set(pv.map(v => v.value));
    const inKey = new Set(kv);
    const add = (bucket, vals) => { if (vals.length) f[bucket][name] = vals; };
    add('wrong', applied.filter(v => !inKey.has(v)));
    add('missing_rejected', kv.filter(v => proposed.has(v) && !applied.includes(v)));
    add('missing', kv.filter(v => !proposed.has(v)));
    const allowed = config.allowed_values[name];
    if (Array.isArray(allowed)) add('invalid', applied.filter(v => !allowed.includes(v)));
  }
  return f;
}

// Would the confidence gate let this record through? true or false, or null when a
// confidence it needs is missing. `overrides` replaces thresholds (for the what-if).
// At or above the threshold passes (trap E5). A gated output with nothing applied fails:
// there is nothing strong enough to stand on.
function gatePasses(r, config, overrides = {}) {
  const t = config.thresholds;
  if (!t || !nonEmpty(t.auto_publish)) return true;
  let unknown = false;
  for (const [name, configured] of Object.entries(t.auto_publish)) {
    const threshold = name in overrides ? overrides[name] : configured;
    const confs = predValues(r, name, config.outputs[name]).filter(v => v.applied).map(v => v.confidence);
    if (confs.length === 0) return false;
    if (confs.some(c => c === null)) { unknown = true; continue; }
    const lead = t.gate_uses === 'weakest' ? Math.min(...confs) : Math.max(...confs);
    if (lead < threshold) return false;
  }
  return unknown ? null : true;
}

// Facts about the whole run that single-record judgments need.
function buildContext(records) {
  const classById = new Map(records.map(r => [r.id, r.route_class]));
  // Primaries with at least one duplicate that was not suppressed: if the primary itself
  // was suppressed, the content went out through the wrong copy.
  const keptDuplicateOf = new Set(records.filter(r => r.duplicate_of && r.route_class !== 'exclude').map(r => r.duplicate_of));
  return { classById, keptDuplicateOf };
}

function worst(types, config) {
  const rank = t => SEVERITIES.indexOf(config.severity[t]);
  return types.length ? config.severity[types.reduce((a, b) => (rank(b) < rank(a) ? b : a))] : null;
}
// Types in a stable order: the order they are listed in config.js, most severe first.
const ordered = (types, config) => unique(types).sort((a, b) => Object.keys(config.severity).indexOf(a) - Object.keys(config.severity).indexOf(b));

function judgeRecord(r, config, ctx) {
  const gold = r.gold_class;   // null without a gold route
  const values = valueFindings(r, config);
  const mismatch = nonEmpty(values.wrong) || nonEmpty(values.missing_rejected) || nonEmpty(values.missing);

  // Which evidence decides that a record needed a human (config: wrong_when).
  const useGold = gold !== null && config.wrong_when !== 'any_mismatch';
  const useValues = config.wrong_when !== 'gold_route';
  const needsHuman = (useGold && gold !== 'auto') || (useValues && mismatch);

  // What would be wrong if this record went through.
  const routeTypes = [];
  if (gold === 'block') routeTypes.push('SP-FORBIDDEN');
  if (gold === 'review') routeTypes.push('SP-SHOULD-REVIEW');
  if (gold === 'exclude') {
    routeTypes.push('SP-DUPLICATE');
    if (r.duplicate_of && ctx.classById.get(r.duplicate_of) === 'exclude') routeTypes.push('SP-WRONG-PRIMARY');
  }
  const valueTypes = [];
  if (nonEmpty(values.invalid)) valueTypes.push('SP-INVALID');
  if (nonEmpty(values.wrong)) valueTypes.push('SP-WRONG');
  if (nonEmpty(values.missing_rejected)) valueTypes.push('SP-MISSING-REJECTED');
  if (nonEmpty(values.missing)) valueTypes.push('SP-MISSING');

  let silent = null;
  const safeguards = [];
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
    if (config.thresholds && gatePasses(r, config) === false) safeguards.push('SG-GATE');
    const floor = config.thresholds ? config.thresholds.floor : null;
    if (floor !== null && Object.entries(config.outputs).some(([name, o]) => o.type === 'set' &&
        r.pred[name].some(v => v.applied && v.confidence !== null && v.confidence < floor))) safeguards.push('SG-FLOOR');
  }

  // Blocked or suppressed, but the key says it should have gone through or to a person.
  let omission = null;
  if ((gold === 'auto' || gold === 'review') && (r.route_class === 'block' || r.route_class === 'exclude')) {
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
    omission,
    wasted_review: r.route_class === 'review' && !needsHuman,
  };
}

function judgeAll(records, config) {
  const ctx = buildContext(records);
  return records.map(r => judgeRecord(r, config, ctx));
}

module.exports = { judgeAll, judgeRecord, buildContext, gatePasses, valueFindings, contentOutputs, worst };
