// Routing metrics: what reached people without a human, and what the human queue cost.
//
//   silent error rate      - of the records that went straight through, the share that
//                            needed a human. The headline: the only errors nobody saw.
//   straight-through       - went through / all records (including suppressed duplicates).
//                            Meaningless alone: sending everything through scores 100%.
//   silent omissions       - of the records that should have gone through or to a person,
//                            the share blocked or suppressed with nobody told.
//   review-queue precision - of the records sent to a person, the share that needed one. A
//                            queue full of records nobody changes teaches reviewers to rubber-stamp.
//   block precision        - of the records blocked, the share the key also blocks.
//   safeguard failures     - records that went through although a safeguard (the confidence
//                            gate, the floor) should have held them. Counted apart from the
//                            silent error rate: the content can be right and the process still broken.

const { rate } = require('./stats.js');
const { SEVERITIES } = require('../config.js');

const ids = list => list.map(j => j.id);

// { type: { records, severity } } over the given judgments' types.
function countTypes(list, pick, config) {
  const out = {};
  for (const j of list) for (const t of pick(j)) {
    if (!out[t]) out[t] = { records: 0, severity: config.severity[t] };
    out[t].records++;
  }
  return out;
}

// Error types this run cannot measure, and why. Reported as "not measured", never as zero.
function notMeasured(config) {
  const out = [];
  const gold = config.routing.gold_field !== null;
  if (!gold) out.push({ what: 'SP-FORBIDDEN, SP-SHOULD-REVIEW, SP-DUPLICATE, silent omissions, block precision', why: 'the answer key has no correct route (routing.gold_field)' });
  if (Object.keys(config.allowed_values).length === 0) out.push({ what: 'SP-INVALID', why: 'no allowed_values list' });
  if (!config.duplicate_of_field && Object.values(config.routing.map).includes('exclude')) {
    out.push({ what: 'SP-WRONG-PRIMARY, SO-PRIMARY-SUPPRESSED', why: 'no duplicate_of_field, so duplicate groups are unknown' });
  }
  if (!config.thresholds || Object.keys(config.thresholds.auto_publish).length === 0) out.push({ what: 'SG-GATE', why: 'no thresholds.auto_publish' });
  if (!config.thresholds || config.thresholds.floor === null) out.push({ what: 'SG-FLOOR', why: 'no thresholds.floor' });
  return out;
}

function scoreRouting(judgments, config) {
  const gold = config.routing.gold_field !== null;
  const total = judgments.length;
  const byClass = { auto: 0, review: 0, block: 0, exclude: 0 };
  const byRoute = {};
  for (const j of judgments) { byClass[j.route_class]++; byRoute[j.route] = (byRoute[j.route] || 0) + 1; }

  const auto = judgments.filter(j => j.route_class === 'auto');
  const silent = auto.filter(j => j.silent);
  const bySeverity = Object.fromEntries(SEVERITIES.map(s => [s, silent.filter(j => j.silent.severity === s).length]));
  const guarded = auto.filter(j => j.safeguards.length);
  const reviewed = judgments.filter(j => j.route_class === 'review');
  const blocked = judgments.filter(j => j.route_class === 'block');
  const shouldBeSeen = judgments.filter(j => j.gold_class === 'auto' || j.gold_class === 'review');
  const omitted = judgments.filter(j => j.omission);

  return {
    total,
    by_class: byClass,
    by_route: byRoute,
    straight_through: rate(auto.length, total),
    silent_errors: {
      rate: rate(silent.length, auto.length),
      // Resolution: how far one record moves the rate at this size.
      one_record_moves_pct: auto.length ? Number((100 / auto.length).toFixed(1)) : null,
      by_severity: bySeverity,
      by_type: countTypes(silent, j => j.silent.types, config),
      records: silent.map(j => ({
        id: j.id, severity: j.silent.severity, types: j.silent.types, route: j.route, gold_route: j.gold_route,
        traps: j.traps, differences: j.values,
      })),
    },
    safeguard_failures: {
      records: guarded.length,
      by_type: countTypes(guarded, j => j.safeguards, config),
      detail: guarded.map(j => ({ id: j.id, types: j.safeguards })),
    },
    silent_omissions: gold ? {
      rate: rate(omitted.length, shouldBeSeen.length),
      by_type: countTypes(omitted, j => j.omission.types, config),
      records: omitted.map(j => ({ id: j.id, severity: j.omission.severity, types: j.omission.types, route: j.route, gold_route: j.gold_route, traps: j.traps })),
    } : null,
    review_queue: {
      precision: rate(reviewed.filter(j => j.needs_human).length, reviewed.length),
      wasted: ids(reviewed.filter(j => j.wasted_review)),
    },
    block: gold ? {
      precision: rate(blocked.filter(j => j.gold_class === 'block').length, blocked.length),
      wrongly_blocked: ids(blocked.filter(j => j.gold_class !== 'block')),
    } : null,
    not_measured: notMeasured(config),
  };
}

module.exports = { scoreRouting };
