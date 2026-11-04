// Results per trap type. The overall silent error rate cannot say which kind of trap
// caused it; grouping the same judgments by the key's trap labels can.
// A record with several traps counts in each group (trap H3), so group totals can exceed
// the number of records. A record with none is grouped as "(none)" (H1), never dropped.

const { rate } = require('./stats.js');
const { compareText } = require('../values.js');

const NONE = '(none)';

// Paired records or their judgments, per trap: [trap, list], "(none)" first, then by name.
function byTrap(list) {
  const groups = new Map();
  for (const j of list) {
    for (const t of j.traps.length ? j.traps : [NONE]) {
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(j);
    }
  }
  const names = [...groups.keys()].sort((a, b) => (a === NONE ? -1 : b === NONE ? 1 : compareText(a, b)));
  return names.map(trap => [trap, groups.get(trap)]);
}

// H5: a trap type with too few records proves nothing about that trap.
function coverageOf(rows, config) {
  const min = config.min_per_trap;
  return { min_per_trap: min, below: min === null ? [] : rows.filter(r => r.trap !== NONE && r.records.length < min).map(r => ({ trap: r.trap, records: r.records.length })) };
}

function scoreTraps(judgments, config) {
  if (!config.trap_field) return null;
  const ids = list => list.map(j => j.id);
  const rows = byTrap(judgments).map(([trap, list]) => {
    const judged = list.filter(j => j.routed_correctly !== null);
    return {
      trap,
      records: ids(list),
      routed_correctly: rate(judged.filter(j => j.routed_correctly).length, judged.length),
      silent_errors: ids(list.filter(j => j.silent)),
      silent_omissions: ids(list.filter(j => j.omission)),
      wasted_reviews: ids(list.filter(j => j.wasted_review)),
      safeguard_failures: ids(list.filter(j => j.safeguards.length)),
    };
  });
  return {
    groups: rows,
    records_with_several_traps: judgments.filter(j => j.traps.length > 1).length,
    coverage: coverageOf(rows, config),
  };
}

// Only the records per trap, from the paired records, for a command that shows no trap table: its
// H5 check needs no judgments.
function trapCounts(records, config) {
  if (!config.trap_field) return null;
  const rows = byTrap(records).map(([trap, list]) => ({ trap, records: list.map(r => r.id) }));
  return { groups: rows, coverage: coverageOf(rows, config) };
}

module.exports = { scoreTraps, trapCounts, NONE };
