// whatif with a split (config.split; traps O16, O25): choose on the tuning half, check on the held-out half.
//
// With a split, `whatif` sweeps gates and compares policies on the tuning half only: scoreRun hands
// it the tuning half's records, so every table, every certification and the choice it names come
// from records the held-out half never joins. With --target, the loosest gate or policy certified
// there is the choice. With --held-out it is then tried once on the held-out half: its silent error
// rate and likely range and, when looks are counted (split.log), whether it is still shown under the
// target at this look's share of the 5% (split-log.js). That is one look, recorded like any other.
// Without --held-out nothing of the held-out half is shown and no look is spent: the report names
// the choice and says how to check it (the next look's number and share).
//
// What the report says when the held-out half does not show it:
//   - "disagrees" when the held-out rate is at or above the target (or its whole likely range is);
//   - "not confirmed: the tuning half flattered it" when the rate the choice was certified at on the
//     tuning half sits below the held-out half's whole likely range;
//   - "too few" only when even no silent error at all could not show it at this look (or a first);
//   - otherwise, not confirmed at this look, which is not evidence against the choice.
//
// Without --target nothing is chosen, so nothing of the held-out half is shown and no look is
// spent: the report says the sweep is the tuning half's.

const { gateSweep } = require('./metrics/whatif.js');
const { policySweep } = require('./metrics/policy.js');
const { splitSettings, heldOutClaim } = require('./split.js');
const { commitLook, notRecorded, lookStatus } = require('./split-log.js');

// w: the what-if as computed on the tuning half. split: scoreRun's results.split for the run (its
// hidden every, halves and moved). kind: "gate", "floor" or "policies". policies: the policies tried.
// heldOut: whether to look at the held-out half (--held-out; --show-held-out too).
// files, options: what the look's identity is made of, with the config and mode (split-log.js).
function heldOutWhatif(w, { split, config, kind, policies = [], heldOut = false, look = false, showHeldOut = false, now = undefined, files, options, mode = 'strict' }) {
  const halves = split.halves;
  const out = { ...splitSettings(config), tuning: { records: halves.tuning.length }, held_out: { records: halves.held_out.length }, looked: false, chosen: null, look: null };
  const best = w.certification && w.certification.best;
  if (!best) return out;   // nothing chosen on the tuning half: nothing to check, no look
  const named = kind === 'gate' ? { threshold: best.threshold } : { name: best.name };
  const tuning = best.silent_error_rate;
  if (!heldOut && !showHeldOut) {
    // The choice, and how to check it: nothing of the held-out half is read.
    out.chosen = { ...named, tuning_silent_errors: tuning };
    out.next_look = lookStatus(config, halves.held_out);
    return out;
  }
  const held = split.every.filter(r => halves.half.get(r.id) === 'held_out');
  let row;
  if (kind === 'gate') {
    const g = gateSweep(held, config, { outputs: w.outputs, from: best.threshold, to: best.threshold, step: 1 });
    row = g.rows.find(r => r.threshold === best.threshold);
  } else {
    const pol = policies.find(x => x.name === best.name);
    const ps = policySweep(held, config, pol ? [pol] : []);
    row = pol ? ps.rows[1] : ps.rows[0];   // the run as it was, when that is the one chosen
  }
  const lk = look ? commitLook({ config, identity: { command: 'whatif', files, options }, halves, moved: split.moved || [], idsShown: showHeldOut, mode, now })
    : notRecorded(config, halves, showHeldOut);
  out.looked = true;
  out.look = lk;
  const se = row.silent_error_rate;
  const target = w.certification.target_pct;
  out.chosen = {
    ...named,
    silent_errors: se, straight_through: row.straight_through, tuning_silent_errors: tuning,
    target: heldOutClaim(se, target, lk.half.level),
    // The held-out rate at or above the target, or its whole likely range above it: it disagrees.
    disagrees: se.d > 0 && (se.n / se.d >= target / 100 || se.low_pct >= target),
    // The rate certified on the tuning half below the held-out half's whole likely range: the tuning
    // half flattered the choice, whatever the held-out count can show.
    flattered: se.d > 0 && tuning.d > 0 && se.low_pct !== null && (tuning.n / tuning.d) * 100 < se.low_pct,
    // --show-held-out only: which held-out records were silent errors at the chosen row.
    ...(showHeldOut ? { silent_error_ids: row.silent_errors } : {}),
  };
  return out;
}

module.exports = { heldOutWhatif };
