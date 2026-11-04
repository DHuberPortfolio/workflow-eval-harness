// A set output's answer key, slot by slot. The one place that says which values are right and
// which slots went unfilled; the judgments, precision and recall, calibration, key gaps and the
// A8 check all ask here, so they cannot disagree.
//
// A key list holds slots. A plain value is a slot of one; { "any_of": ["a", "b"] } is one slot
// that any of its values fills (load.js has checked both shapes, traps D20-D22). Nothing is
// resolved when the files are read: which values count is worked out per record, from what that
// record applied, every time. So a what-if that changes what is applied re-resolves the slots
// at every floor, with no code of its own.

const slotValues = s => (typeof s === 'string' ? [s] : s.any_of);

// Every value the key accepts, in any slot: "is this value right?". An applied value is right
// exactly when it is in here (it then fills its slot); a proposed one too (calibration).
function accepted(key) {
  const ok = new Set();
  for (const s of key) {
    if (typeof s === 'string') ok.add(s);
    else for (const v of s.any_of) ok.add(v);
  }
  return ok;
}

// How an unfilled slot is named: "ep-12", or "one of ep-10, ep-11".
function slotLabel(slot) {
  const v = slotValues(slot);
  return v.length === 1 ? v[0] : 'one of ' + v.join(', ');
}

// How an unfilled slot is shown in a record's differences: its name, and first the values of it
// that were found but set aside: "ep-11 (one of ep-10, ep-11)".
function unfilledLabel(u) {
  if (u.set_aside.length === 0 || slotValues(u.slot).length === 1) return slotLabel(u.slot);
  return u.set_aside.join(' or ') + ' (' + slotLabel(u.slot) + ')';
}

// One record and one set output. pred: its predicted values ({ value, applied }); key: its slots.
//   applied   - the values applied, once each
//   right     - applied values in a slot: each a true positive, two from one slot included
//   wrong     - applied values in no slot: each a false positive
//   unfilled  - slots none of whose values was applied: each a false negative. set_aside lists
//               the slot's values that were proposed but not applied (missing_rejected if any)
function resolveSet(pred, key) {
  const ok = accepted(key);
  const chosen = new Set();
  for (const v of pred) if (v.applied) chosen.add(v.value);
  const applied = [...chosen];
  const filled = s => (typeof s === 'string' ? chosen.has(s) : s.any_of.some(v => chosen.has(v)));
  // Most records leave no slot unfilled, so what was proposed is gathered only for one that does.
  let proposed = null;
  const wasProposed = v => {
    if (proposed === null) { proposed = new Set(); for (const p of pred) proposed.add(p.value); }
    return proposed.has(v);
  };
  const unfilled = key.filter(s => !filled(s)).map(slot => ({ slot, set_aside: slotValues(slot).filter(wasProposed) }));
  return { applied, right: applied.filter(v => ok.has(v)), wrong: applied.filter(v => !ok.has(v)), unfilled };
}

module.exports = { accepted, resolveSet, slotLabel, slotValues, unfilledLabel };
