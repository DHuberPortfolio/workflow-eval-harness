// Small text-formatting helpers and the wording shared by the terminal and HTML reports.

const pct = r => (r === null || r === undefined || r.pct === null ? 'n/a' : r.pct.toFixed(1) + '%');
const count = r => (r === null || r === undefined ? '' : r.n + ' of ' + r.d);
const range = r => (r === null || r === undefined || r.low_pct === null ? '' : r.low_pct.toFixed(1) + '-' + r.high_pct.toFixed(1) + '%');
const num = (x, d = 3) => (x === null || x === undefined ? 'n/a' : x.toFixed(d));
const signed = (x, d = 2) => (x === null ? 'n/a' : (x > 0 ? '+' : '') + x.toFixed(d));
const list = (ids, max = 12) => (ids.length === 0 ? '-' : ids.slice(0, max).join(' ') + (ids.length > max ? ' +' + (ids.length - max) + ' more' : ''));

// The same words for the same ideas in every report.
// What happened to a record, by route class.
const CLASS_LABELS = { auto: 'went out without review', review: 'sent to a person', block: 'blocked', exclude: 'suppressed as a duplicate' };

// What decides that a record needed a person (the config's wrong_when).
const WRONG_WHEN = {
  either: 'the answer key says it should not have gone out without review, or its values are wrong',
  gold_route: 'the answer key says it should not have gone out without review',
  any_mismatch: 'its values differ from the answer key',
};

// Each error type in plain words, shown beside its code. Full definitions, and how each
// is detected: docs/SILENT_ERRORS.md.
const TYPE_LABELS = {
  'SP-FORBIDDEN': 'went out, but should have been blocked',
  'SP-SHOULD-REVIEW': 'went out, but should have gone to a person',
  'SP-WRONG-PRIMARY': 'the wrong copy of a duplicate went out',
  'SP-DUPLICATE': 'a duplicate went out',
  'SP-INVALID': 'a value outside the allowed list went out',
  'SP-WRONG': 'a wrong value went out',
  'SP-SHOULD-DECLINE': 'an answer went out where the answer key says to decline',
  'SP-MISSING-REJECTED': 'the model found a correct value, but it was set aside for low confidence',
  'SP-MISSING': 'a correct value was never found',
  'SP-DECLINED': 'went out declined, but the answer key has an answer',
  'SP-NEAR-MISS': 'close, but not exact, on an ordered scale (a 4 for a 5)',
  'SO-FALSE-DUPLICATE': 'a real record was suppressed as a duplicate',
  'SO-PRIMARY-SUPPRESSED': 'the primary copy was suppressed and a duplicate kept',
  'SO-FALSE-BLOCK': 'a good record was blocked',
  'SO-DECLINED': 'declined and left out, but the answer key has an answer',
  'SG-GATE': 'went out below the confidence gate',
  'SG-FLOOR': 'a value below the confidence floor was kept',
};

// What the silent omission rate counts. Without a correct route, only declines can show that
// something was lost (routing.silent_omissions.basis); with one, declines join the list.
function omissionWhat(results) {
  const o = results.routing.silent_omissions;
  const declines = Object.values(results.quality.outputs).some(x => x.declines);
  if (o && o.basis === 'declines') return 'declined and left out, but the answer key has an answer';
  return declines ? 'blocked, suppressed or declined, but should have gone out or to a person' : 'blocked or suppressed, but should have gone out or to a person';
}

// The rows of a label output's decline table: [name, rate, what it counts, ids].
function declineRows(d) {
  const rows = [
    ['Coverage', d.coverage, 'answered, of all records', null],
    ['Declined', d.declined, 'declined, of all records', null],
    ['Unnecessary declines', d.unnecessary.rate, 'of the declines, the answer key has an answer', d.unnecessary.ids],
  ];
  if (d.should_have_declined) rows.push(['Answers that should have been declines', d.should_have_declined.rate, 'of the answers, the answer key says to decline', d.should_have_declined.ids]);
  return rows;
}

// A target ("under 5%") in words: the verdict first, then what would show it (trap G13).
// `words` names what is counted: a run's records out without review, or a bare count's records.
const TARGET_WORDS = {
  run: { out: 'records out without review', mistake: 'silent error', source: 'run' },
  count: { out: 'records', mistake: 'mistake', source: 'count' },
};
// 3372 -> "3,372". Written out rather than toLocaleString, so every machine prints the same.
const thousands = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
function targetLines(t, words) {
  const under = 'under ' + t.target_pct + '%';
  if (t.tested === 0) return [under + ': nothing to show yet, with no ' + words.out + '.'];
  if (t.shown) return [under + ': shown. The whole likely range is under it (it reaches ' + t.high_pct.toFixed(1) + '%).'];
  const all = x => (x.all_records ? ' (about ' + thousands(x.all_records) + ' records in all, at this run\'s straight-through rate)' : '');
  const lines = [under + ': not shown: the likely range reaches ' + t.high_pct.toFixed(1) + '%.'];
  if (t.rate_at_or_above) {
    lines.push('At ' + t.rate_pct.toFixed(1) + '%, no number of ' + words.out + ' can show it: the rate itself is at or above the target, and has to come down first.');
  } else if (t.plan) {
    const chance = Math.round(t.chance * 100);
    lines.push('If the real rate is ' + t.plan.assumed_pct.toFixed(1) + '% (this ' + words.source + '\'s), about ' + thousands(t.plan.n) + ' ' + words.out + ' give ' +
      (chance === 80 ? 'an ' : 'a ') + chance + '% chance of showing it' + all(t.plan) + (t.plan.exact ? '' : ' (a textbook estimate)') + '.');
  }
  lines.push('The least any test needs: ' + thousands(t.perfect_run.n) + ' ' + words.out + ' with no ' + words.mistake + ' at all' + all(t.perfect_run) + '.');
  lines.push('Choose the number of ' + words.out + ' before testing: stopping as soon as the range dips under the target makes the result look better than it is.');
  return lines;
}

// Per group (results.groups): where a group's labels were read, and how to read its rates. A
// group holds a fraction of the records, so one record moves its rate a lot (trap H6).
const groupSource = g => (g.from === 'key' ? 'answer key' : 'predictions') + ' field "' + g.field + '"';
const GROUP_RANGES = 'Small groups have wide ranges, so compare the ranges, not the percentages.';
const severalLabels = (n, total) => n + ' record(s) carry several labels and count in each, so the rows add up to more than the ' + total + ' records.';

// The silent error rate's range counting clusters (results.clusters; traps G14-G17), as one
// sentence under the headline: how many clusters, the range, and how much evidence that is.
const CLUSTER_FALLBACK = { no_silent_errors: 'With no silent errors', all_silent_errors: 'With every record a silent error', one_cluster: 'With one cluster' };
// "4 independent records' worth", "1 record's worth".
const worth = (n, kind = '') => thousands(n) + ' ' + kind + (n === 1 ? "record's" : "records'") + ' worth';
function clusterLine(c) {
  const src = groupSource(c);
  if (c.records === 0) return 'Clusters (' + src + '): nothing went out without review, so there is nothing to count.';
  let s = 'Records out without review came from ' + thousands(c.clusters) + ' cluster' + (c.clusters === 1 ? '' : 's') + ' (' + src +
    '); counting clusters, the likely range is ' + c.low_pct.toFixed(1) + '-' + c.high_pct.toFixed(1) + '%';
  if (c.method === 'design_effect') {
    // At exactly 1 (often the floor), the range is the headline's, and the line says so.
    s += c.design_effect === 1 ? ' (design effect 1: the clusters show no clumping, so this is the range above).'
      : ' (design effect ' + c.design_effect.toFixed(1) + ': about ' + worth(Math.round(c.effective_records), 'independent ') + ').';
  } else {
    s += '. ' + CLUSTER_FALLBACK[c.why] + ", nothing shows how far a cluster's records go together, so each cluster counts as one record (" + worth(c.clusters) + '): the cautious choice.';
  }
  const k = c.records_own_cluster;
  if (k) s += ' ' + (k === 1 ? '1 record had no value there and is a cluster of its own.' : thousands(k) + ' records had no value there and are each a cluster of their own.');
  return s;
}
// Per-group rows and --target count records as independent (trap G14): said beside them.
const CLUSTER_GROUP_NOTE = 'These ranges count every record as independent; only the line under the headline counts clusters.';
const CLUSTER_TARGET_NOTE = 'The verdict and the plan count records as independent; records that come in clusters need more of them.';

// The silent error rate on a real mix (results.mix; traps G18-G21), as lines under the headline:
// the reweighted rate beside the golden set's, called a reweighting so that it is not read as a
// measurement of real traffic in turn (G18); the straight-through on the mix; and a note for each
// group with a share that sent nothing out.
const MIX_CAVEAT = 'A reweighting, not a measurement: it is only as good as the shares, and as the records tested in each group.';
const CLUSTER_MIX_NOTE = 'The range on the mix counts every record as independent, not clusters.';
const likely = r => 'likely ' + r.low_pct.toFixed(1) + '-' + r.high_pct.toFixed(1) + '%; about ' + worth(Math.round(r.effective_records));
function mixLines(m, results) {
  const on = 'On the real mix in ' + m.file + ' (' + m.strata.map(x => x.label + ' ' + x.share_pct + '%').join(', ') + '), the silent error rate ';
  const se = m.silent_error_rate;
  const st = m.straight_through;
  const lines = [m.why === 'nothing_out'
    ? on + 'cannot be estimated: no group with a share sent a record out without review, so nothing would go out on that mix.'
    : on + 'would be about ' + se.pct.toFixed(1) + '% (' + likely(se) + '), against ' + pct(results.routing.silent_errors.rate) + ' on this golden set. ' + MIX_CAVEAT];
  lines.push('On that mix, about ' + st.pct.toFixed(1) + '% of records would go out without review (' + likely(st) + '), against ' +
    pct(results.routing.straight_through) + ' on this golden set.');
  if (results.clusters) lines.push(CLUSTER_MIX_NOTE);
  // With nothing out at all, the first line has said it already.
  if (m.why === null) {
    for (const label of m.none_out) {
      const x = m.strata.find(s => s.label === label);
      lines.push('Group "' + label + '" (' + x.share_pct + '% of the mix) sent none of its ' + x.records + ' record' + (x.records === 1 ? '' : 's') +
        ' out without review: on the mix it lowers the straight-through, and adds nothing to the silent error rate, which rests on the other groups.');
    }
  }
  return lines;
}

// The distinct types used by a list of records, in first-seen order.
const typesIn = records => [...new Set(records.flatMap(x => x.types))];

// Like list(), for entries that hold spaces themselves ("K2 SUBJECT SUBJ-MNA").
const some = (items, max = 12) => items.slice(0, max).join(', ') + (items.length > max ? ', +' + (items.length - max) + ' more' : '');
const ruledValue = x => x.id + ' ' + x.output + ' ' + x.value;

// What a rulings file did to the answer key (results.rulings), as sentences (trap I11). The key
// in use is not the key file alone, so every report says so, and names the values it added.
// against: which key, when a report has two (" (key-v2.json)").
function rulingsWords(r, against = '') {
  const n = r.added.length;
  const words = [n
    ? n + ' value' + (n === 1 ? '' : 's') + ' added to the answer key' + against + ' by rulings in ' + r.file + ': ' + some(r.added.map(ruledValue)) + '.'
    : 'no values added to the answer key' + against + ' by rulings in ' + r.file + '.'];
  if (n) words.push('Every number below scores against the key file plus ' + (n === 1 ? 'this value' : 'these values') + '; the key file itself is unchanged.');
  const also = [r.rejected.length + ' ruled not a gap', r.pending.length + ' pending (counted wrong)'];
  if (r.set_aside.length) also.push(r.set_aside.length + ' set aside (see the warnings)');
  words.push('Also in the file: ' + also.join(', ') + '.');
  return words;
}

// The bracket for pending rulings (results.rulings.if_pending_added; trap I15), beside the strict
// silent error rate: pending scored as wrong, against pending scored as added.
function pendingLine(b, strict) {
  const n = b.pending;
  const k = b.not_applied.length;
  const s = 'If the ' + n + ' pending ruling' + (n === 1 ? ' were' : 's were all') + ' added to the answer key: ' + pct(b.silent_errors) +
    ' (' + count(b.silent_errors) + ', likely ' + range(b.silent_errors) + '), against ' + pct(strict) + ' with ' + (n === 1 ? 'it' : 'them') + ' counted wrong.';
  if (k === 0) return s + ' However ' + (n === 1 ? 'it is' : 'they are') + ' ruled, the rate lands between the two.';
  return s + ' ' + (n === 1 ? 'It is a value' : k + ' of them ' + (k === 1 ? 'is a value' : 'are values')) + ' this run did not apply: added, ' +
    (k === 1 ? 'it is a miss' : 'they are misses') + ' here, so the two are not a bracket.';
}
// "pending (DH, 2026-10-30)" or "unruled": a possible key gap's ruling, when a rulings file is in use.
const rulingStatus = g => (g.ruling === 'pending' ? 'pending' + (g.by || g.on ? ' (' + [g.by, g.on].filter(Boolean).join(', ') + ')' : '') : 'unruled');

// Rows of cells -> aligned lines. `right` lists the columns aligned right (numbers).
function table(rows, right = [], indent = '  ') {
  const widths = [];
  for (const row of rows) row.forEach((c, i) => { widths[i] = Math.max(widths[i] || 0, String(c).length); });
  return rows.map(row => indent + row.map((c, i) => {
    const s = String(c);
    if (i === row.length - 1 && !right.includes(i)) return s;
    return right.includes(i) ? s.padStart(widths[i]) : s.padEnd(widths[i]);
  }).join('   ')).join('\n');
}

module.exports = {
  pct, count, range, num, signed, list, table, CLASS_LABELS, WRONG_WHEN, TYPE_LABELS, TARGET_WORDS, typesIn, omissionWhat, declineRows, targetLines,
  groupSource, GROUP_RANGES, severalLabels, some, ruledValue, rulingsWords, pendingLine, rulingStatus, clusterLine, CLUSTER_GROUP_NOTE, CLUSTER_TARGET_NOTE,
  mixLines, thousands,
};
