// A target for the silent error rate ("under 5%"): has this run shown it, and if not, how many
// records would (trap G13). The arithmetic is error-rate-calculator's, so the two tools give the
// same answer for the same counts.

const { wilson, pct, recordsNeeded, planTest } = require('./stats.js');

// wrong of tested: the rate's count and base. targetPct: a percentage (5 means 5%). chance: the
// plan's probability (0.8, 0.9 or 0.95). out_of: { n, d } when only n of every d records count
// toward `tested` (records out without review, of all records), to say how many records in all.
function targetCheck(wrong, tested, targetPct, { chance = 0.8, out_of = null } = {}) {
  if (!(typeof targetPct === 'number' && targetPct > 0 && targetPct < 100)) {
    throw new Error('--target must be a percentage above 0 and below 100');
  }
  const target = targetPct / 100;
  // Whole-number counts, never a rounded share: 73 / 0.2 is not exactly 365 in floating point.
  const all = k => (out_of && out_of.n > 0 && Number.isFinite(k) ? Math.ceil((k * out_of.d) / out_of.n) : null);
  const w = wilson(wrong, tested);
  const atOrAbove = tested > 0 && wrong / tested >= target;
  // At 0 mistakes the plan is the perfect run itself, so it is not repeated.
  const plan = tested > 0 && wrong > 0 && !atOrAbove ? planTest(wrong / tested, target, chance) : null;
  const perfect = recordsNeeded(0, target);
  return {
    target_pct: targetPct,
    chance,
    tested,
    rate_pct: pct(wrong, tested),
    shown: w !== null && w.high < target,
    high_pct: w === null ? null : Number((w.high * 100).toFixed(1)),
    // The rate itself is at or above the target: no number of records can show it is under.
    rate_at_or_above: atOrAbove,
    perfect_run: { n: perfect, all_records: all(perfect) },
    plan: plan ? { assumed_pct: pct(wrong, tested), n: plan.n, chance: plan.chance, exact: plan.exact, all_records: all(plan.n) } : null,
  };
}

module.exports = { targetCheck };
