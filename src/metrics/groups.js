// Rates per group: the headline's rates again for each label of a field the config names
// (config.groups): a tuning half against a held-out half, one kind of email against another,
// one routing branch against another.
//
// Each label's rates come from scoreRouting() run on that label's judgments alone, so a row is
// the headline's own arithmetic on fewer records and can never disagree with it. The judgments
// are made once, on the whole run, because some depend on other records (a duplicate's primary
// may sit in another group).
//
// As for traps: a record with several labels counts in each (trap H7), so the rows can add up
// to more than the records; a record with none is grouped as "(none)" (H1), never dropped.

const { rate } = require('./stats.js');
const { scoreRouting } = require('./routing.js');
const { NONE } = require('./traps.js');

// One row per label, from that label's records: every rate with its count and range (trap H6).
function groupRow(label, list, config, recordById) {
  const r = scoreRouting(list, config, list.map(j => recordById.get(j.id)));
  const judged = list.filter(j => j.routed_correctly !== null);
  return {
    label,
    records: list.length,
    straight_through: r.straight_through,
    silent_errors: { rate: r.silent_errors.rate, ids: r.silent_errors.records.map(x => x.id) },
    // null when the run cannot measure them (no correct route and no declines), as in the headline.
    silent_omissions: r.silent_omissions ? { rate: r.silent_omissions.rate, ids: r.silent_omissions.records.map(x => x.id) } : null,
    review_precision: { rate: r.review_queue.precision, unnecessary: r.review_queue.wasted },
    // Only with a correct route in the key; without one, nothing says where a record belonged.
    routed_correctly: config.routing.gold_field === null ? null : rate(judged.filter(j => j.routed_correctly).length, judged.length),
  };
}

// judgments: judgeAll() of the whole run; records: the paired records they judge, with groups.
// null when the config has no groups, so results without groups are unchanged.
function scoreGroups(judgments, config, records) {
  const names = Object.keys(config.groups);
  if (names.length === 0) return null;
  const recordById = new Map(records.map(r => [r.id, r]));
  return names.map(name => {
    const labelsOf = j => {
      const labels = recordById.get(j.id).groups[name];
      return labels.length ? labels : [NONE];
    };
    const byLabel = new Map();
    for (const j of judgments) {
      for (const label of labelsOf(j)) {
        if (!byLabel.has(label)) byLabel.set(label, []);
        byLabel.get(label).push(j);
      }
    }
    // By text, with "(none)" last: it is what is left over, not a group of its own.
    const labels = [...byLabel.keys()].sort((a, b) => (a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b)));
    const { field, from } = config.groups[name];
    return {
      name, field, from,
      rows: labels.map(label => groupRow(label, byLabel.get(label), config, recordById)),
      records_with_several_labels: judgments.filter(j => labelsOf(j).length > 1).length,
    };
  });
}

module.exports = { scoreGroups };
