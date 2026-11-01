// Policy what-if: what the numbers would be under other routing policies, side by side
// (wfeval whatif --policies / --hold-if). Policies are read and checked by src/policy.js.
//
// A policy may change thresholds (auto_publish, auto_publish_cap) and hold records (hold_if),
// in that order: the gate is re-decided first, as the gate what-if does it, then every record
// that would go out without review and meets a hold-if condition is sent to a person.
//
// Hold-if is exact, with no assumption about how the workflow decided its routes. Holding only
// moves a record from "went out without review" to "sent to a person": its values, its answer
// key and every other record's route stay as they were. The judgments (judge.js) read the route
// in these places only, and each moves exactly as it would have on a real run:
//   - a silent error, and the safeguard checks (SG-GATE, SG-FLOOR), count only for records that
//     went out: a held record has neither, and was seen by a person
//   - an unnecessary review counts for records sent to a person that did not need one: a held
//     record that needed no person becomes one
//   - silent omissions read only blocked and suppressed records, which a hold never touches;
//     the duplicate checks read whether a record was suppressed, which a hold never changes
// Records whose model call failed, label outputs and declines need nothing more: a hold reads
// their stated values and leaves them as they are. test/policy.test.js checks every judgment of
// every record against this. Threshold changes are a gate what-if and are only as good as its
// assumption about which records the gate can move (whatif.js); a row says which kind it is.
//
// Each policy is also paired with the run as it was, record by record: the silent errors it
// fixed and broke, the unnecessary reviews it fixed and added, with Tango's paired range
// (stats.js pairedDifference, as compare uses it; trap I9). With a target, every policy tried is
// certified as the gate what-if certifies gates (certifyGates: exact binomial, Bonferroni over
// the policies tried, the run as it was counted as one of them).

const { judgeAll, gatePasses } = require('./judge.js');
const { summarize, withThresholds, movableFn, certifyGates, checkCertify, gateCheck } = require('./whatif.js');
const { pairedDifference } = require('./stats.js');
const { asNumber, sameValue, AS_RUN } = require('../policy.js');

const round = x => Number(x.toFixed(1));

// Does one stated value meet a condition's value clauses?
function valueMatches(v, c) {
  if (c.values && !c.values.includes(v.value)) return false;
  if (c.applied !== undefined && Boolean(v.applied) !== c.applied) return false;
  if (c.confidence_at_least !== undefined && !(typeof v.confidence === 'number' && v.confidence >= c.confidence_at_least)) return false;
  return true;
}

// Does a prediction field meet a condition's comparison? A missing field never does (trap E15),
// nor a field that is not a number for below or at_least (E16).
function fieldMatches(v, c) {
  if (v === undefined || v === null) return false;
  if (c.equals !== undefined) return sameValue(v, c.equals);
  if (c.in !== undefined) return c.in.some(x => sameValue(v, x));
  const n = asNumber(v);
  if (n === null) return false;
  return c.below !== undefined ? n < c.below : n >= c.at_least;
}

// One condition: all its clauses hold. value is read as a list of one (as policy.js reads it).
function conditionHolds(r, c, config) {
  if (c.all) return c.all.every(x => conditionHolds(r, x, config));
  if (c.field !== undefined && !fieldMatches(r.fields ? r.fields[c.field] : undefined, c)) return false;
  if (c.output !== undefined) {
    const o = config.outputs[c.output];
    const stated = o.type === 'set' ? r.pred[c.output] || [] : r.pred[c.output] ? [r.pred[c.output]] : [];
    const cc = c.value !== undefined ? { ...c, values: [c.value] } : c;
    if (!stated.some(v => valueMatches(v, cc))) return false;
  }
  return true;
}

// Does any condition hold for this record? (Whether it went out is the caller's to check.)
const holds = (r, conditions, config) => conditions.some(c => conditionHolds(r, c, config));

// The run under one policy: the records with their new routes, the config with its thresholds.
function applyPolicy(records, config, pol, canMove) {
  let cfg = config;
  let moved = records;
  if (pol.auto_publish || pol.auto_publish_cap) {
    const auto = { ...config.thresholds.auto_publish };
    for (const [o, x] of Object.entries(pol.auto_publish || {})) auto[o] = x;
    for (const [o, x] of Object.entries(pol.auto_publish_cap || {})) auto[o] = { of: auto[o], cap: x };
    cfg = withThresholds(config, { auto_publish: auto });
    moved = records.map(r => {
      if (!canMove(r)) return r;
      const pass = gatePasses(r, cfg);
      if (pass === null) return r;   // a confidence or threshold is missing: left where it was
      const cls = pass ? 'auto' : 'review';
      return cls === r.route_class ? r : { ...r, route_class: cls, route: '(what-if ' + cls + ')' };
    });
  }
  // The records the threshold change moved, either way, before any hold.
  const byGate = moved.filter((m, i) => m.route_class !== records[i].route_class).map(m => m.id);
  const held = [];
  if (pol.hold_if) {
    moved = moved.map(r => {
      if (r.route_class !== 'auto' || !holds(r, pol.hold_if, config)) return r;
      held.push(r.id);
      return { ...r, route_class: 'review', route: '(held)' };
    });
  }
  return { cfg, moved, held, byGate };
}

// Record by record against the run as it was (trap I9): fixed and broke for each outcome.
function pairedWith(before, after, omissions) {
  const outcomes = { silent_errors: j => Boolean(j.silent), ...(omissions ? { silent_omissions: j => Boolean(j.omission) } : {}), unnecessary_reviews: j => j.wasted_review };
  const out = { records: after.length };
  for (const [name, is] of Object.entries(outcomes)) {
    const fixed = after.filter((a, i) => is(before[i]) && !is(a)).map(a => a.id);
    const broke = after.filter((a, i) => !is(before[i]) && is(a)).map(a => a.id);
    const row = { before: before.filter(is).length, after: after.filter(is).length, fixed: fixed.length, broke: broke.length, fixed_ids: fixed, broke_ids: broke };
    if (after.length === 0) { out[name] = { ...row, low_pct: null, high_pct: null, verdict: 'not measured' }; continue; }
    // The range is for the drop (before minus after); the change is that turned round.
    const d = pairedDifference(fixed.length, broke.length, after.length);
    const verdict = fixed.length + broke.length === 0 ? 'no change' : d.low > 0 ? 'better' : d.high < 0 ? 'worse' : 'unclear';
    out[name] = { ...row, low_pct: round(-d.high * 100) + 0, high_pct: round(-d.low * 100) + 0, verdict };
  }
  return out;
}

// policies: from policy.js. target: a percentage to certify the policies against, at confidence.
function policySweep(records, config, policies, { target = null, confidence = 0.95 } = {}) {
  if (target !== null) checkCertify(target, confidence);
  const canMove = movableFn(config);
  const before = judgeAll(records, config);
  const omissions = summarize(records, config, {}).silent_omissions !== null;
  const asRun = summarize(records, config, { name: AS_RUN, exact: true, held: [], moved_by_gate: [], moved_in: [], moved_out: [], paired: null });
  const rows = [asRun, ...policies.map(pol => {
    const { cfg, moved, held, byGate } = applyPolicy(records, config, pol, canMove);
    return summarize(moved, cfg, {
      name: pol.name,
      exact: !(pol.auto_publish || pol.auto_publish_cap),
      held,
      moved_by_gate: byGate,
      moved_in: moved.filter((m, i) => m.route_class === 'auto' && records[i].route_class !== 'auto').map(m => m.id),
      moved_out: moved.filter((m, i) => m.route_class !== 'auto' && records[i].route_class === 'auto').map(m => m.id),
      paired: pairedWith(before, judgeAll(moved, cfg), omissions),
    });
  })];
  const changesGate = policies.some(p => p.auto_publish || p.auto_publish_cap);
  const gateAssumption = config.whatif ? 'records marked movable by ' + config.whatif.movable_field
    : 'no whatif.movable_field: every record that went out without review or was sent to a person is assumed routed by the gate alone (an upper bound)';
  const result = {
    kind: 'policies',
    assumption: 'hold-if rules are exact: holding only sends a record that went out without review to a person' +
      (changesGate ? '. Threshold changes are a gate what-if: ' + gateAssumption : ''),
    policies,
    // Policies that hold and move no record: the run as it was again, usually a condition that
    // matches nothing in this run (said in the report, so a no-op is not read as a result).
    changes_nothing: rows.slice(1).filter(r => r.held.length === 0 && r.moved_by_gate.length === 0).map(r => r.name),
    // With a threshold change, the gate what-if's self-check at the config's own gates.
    check: changesGate ? { threshold: null, configured: true, ...gateCheck(records, config) } : null,
  };
  if (target === null) return { ...result, rows, certification: null };
  // Ties on straight-through go to the policy with fewer silent errors, then to the one listed first.
  const c = certifyGates(rows, target, confidence, { label: r => ({ name: r.name }), tie: (r, a) => r.silent_error_rate.n < a.silent_error_rate.n });
  const { gates_tested, ...cert } = c.certification;
  return { ...result, rows: c.rows, certification: { ...cert, policies_tested: gates_tested } };
}

module.exports = { policySweep, holds, applyPolicy };
