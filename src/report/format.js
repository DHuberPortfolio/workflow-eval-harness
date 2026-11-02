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
const CLUSTER_FALLBACK = {
  no_silent_errors: 'With no silent errors', all_silent_errors: 'With every record a silent error', one_cluster: 'With one cluster',
  silent_errors_in_one_cluster: 'With every silent error in one cluster', others_in_one_cluster: 'With every record but the silent errors in one cluster',
};
// "4 independent records' worth", "1 record's worth".
const worth = (n, kind = '') => thousands(n) + ' ' + kind + (n === 1 ? "record's" : "records'") + ' worth';
// The design effect and the records' worth arrive as worked out, and are rounded here only, once
// (trap G6): 5.46 records' worth is "about 5", where rounding to 5.5 first would make it 6.
function clusterLine(c) {
  const src = groupSource(c);
  if (c.records === 0) return 'Clusters (' + src + '): nothing went out without review, so there is nothing to count.';
  let s = 'Records out without review came from ' + thousands(c.clusters) + ' cluster' + (c.clusters === 1 ? '' : 's') + ' (' + src +
    '); counting clusters, the likely range is ' + c.low_pct.toFixed(1) + '-' + c.high_pct.toFixed(1) + '%';
  if (c.method === 'design_effect') {
    // At exactly 1 (the floor, or every record a cluster of its own), the range is the headline's,
    // and the line says so.
    s += c.design_effect === 1 ? ' (design effect 1: the clusters show no clumping, so this is the range above).'
      : ' (design effect ' + c.design_effect.toFixed(1) + ': about ' + worth(Math.round(c.effective_records), 'independent ') + ').';
  } else {
    // The records' worth is Kish's for clusters whose records go together (stats.js): the number
    // of clusters when they are the same size, fewer when not.
    s += '. ' + CLUSTER_FALLBACK[c.why] + ", nothing shows how far a cluster's records go together, so each cluster's records are taken to go right or wrong " +
      'together (about ' + worth(Math.round(c.effective_records)) + '): the cautious choice.';
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
// The records' worth arrives as worked out and is rounded once, here (trap G6).
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
  if (r.removed) return rulingsWordsAll(r, against);
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

// The same for a file that uses suspects' verbs (remove, keep, replace; traps N11-N14): every
// change to the key named, removes and replaced labels beside the adds.
const replacedValue = x => x.id + ' ' + x.output + ' ' + x.value + ' with ' + x.with;
function rulingsWordsAll(r, against) {
  const changes = [];
  const n = (k, one, many) => k + ' ' + (k === 1 ? one : many);
  if (r.added.length) changes.push(n(r.added.length, 'value', 'values') + ' added: ' + some(r.added.map(ruledValue)));
  if (r.removed.length) changes.push(n(r.removed.length, 'value', 'values') + ' removed: ' + some(r.removed.map(ruledValue)));
  if (r.replaced.length) changes.push(n(r.replaced.length, 'label', 'labels') + ' replaced: ' + some(r.replaced.map(replacedValue)));
  const words = [changes.length ? 'Changed in the answer key' + against + ' by rulings in ' + r.file + ': ' + changes.join('; ') + '.'
    : 'no changes to the answer key' + against + ' by rulings in ' + r.file + '.'];
  if (changes.length) words.push('Every number below scores against the key file with ' + (changes.length === 1 && r.added.length + r.removed.length + r.replaced.length === 1 ? 'this change' : 'these changes') +
    '; the key file itself is unchanged.');
  const also = [r.rejected.length + ' ruled not a gap', r.kept.length + ' kept as the answer key has ' + (r.kept.length === 1 ? 'it' : 'them'),
    r.pending.length + ' pending (scored as the answer key stands)'];
  if (r.set_aside.length) also.push(r.set_aside.length + ' set aside (see the warnings)');
  words.push('Also in the file: ' + also.join(', ') + '.');
  return words;
}

// The bracket for pending rulings (results.rulings.if_pending_added; trap I15), beside the strict
// silent error rate: pending scored as wrong, against pending scored as added.
function pendingLine(b, strict) {
  if (b.not_one_way) return pendingLineAll(b, strict);
  const n = b.pending;
  const k = b.not_applied.length;
  const s = 'If the ' + n + ' pending ruling' + (n === 1 ? ' were' : 's were all') + ' added to the answer key: ' + pct(b.silent_errors) +
    ' (' + count(b.silent_errors) + ', likely ' + range(b.silent_errors) + '), against ' + pct(strict) + ' with ' + (n === 1 ? 'it' : 'them') + ' counted wrong.';
  // Whether it is a bracket was worked out by trying every way the pending rulings could be ruled
  // (score.js pendingRange): however_ruled is there only when it is not one.
  if (!b.however_ruled) return s + ' However ' + (n === 1 ? 'it is' : 'they are') + ' ruled, the rate lands between the two.';
  const why = k === 0 ? 'The two are not a bracket.' : (n === 1 ? 'It is a value' : k + ' of them ' + (k === 1 ? 'is a value' : 'are values')) +
    ' this run did not apply: added, ' + (k === 1 ? 'it is a miss' : 'they are misses') + ' here, so the two are not a bracket.';
  return s + ' ' + why + ' ' + howeverRuled(b.however_ruled, 'Ruled other ways, it');
}
// With pending removes or label replaces (trap N13): every pending ruling made as proposed. It is a
// bracket when every way of ruling them (a label to any of its labels) lands between the two.
function pendingLineAll(b, strict) {
  const n = b.pending;
  const s = 'If the ' + n + ' pending ruling' + (n === 1 ? ' were' : 's were all') + ' made as proposed (added, removed or replaced): ' + pct(b.silent_errors) +
    ' (' + count(b.silent_errors) + ', likely ' + range(b.silent_errors) + '), against ' + pct(strict) + ' as the answer key stands.';
  if (!b.however_ruled) return s + ' However ' + (n === 1 ? 'it is' : 'they are') + ' ruled, the rate lands between the two.';
  return s + ' ' + howeverRuled(b.however_ruled, 'The two are not a bracket: ruled other ways, it');
}
// The lowest and highest rate over every way of ruling the pending rulings, or, when a record holds
// too many to try them all, the condition under which the two figures are a bracket.
function howeverRuled(h, lead) {
  if (h.exact) return lead + ' could be anywhere from ' + pct(h.lowest) + ' (' + count(h.lowest) + ') to ' + pct(h.highest) + ' (' + count(h.highest) + ').';
  return 'Record' + (h.records.length === 1 ? ' ' : 's ') + h.records.join(', ') + (h.records.length === 1 ? ' holds' : ' hold') +
    ' too many pending rulings to try every way they could be ruled: the two are a bracket only if each pending ruling there, made any way, ' +
    'can only clear an error (an add of a value this run applied, a remove of one it did not, a label replaced with the one this run gave).';
}
// "pending (DH, 2026-10-30)" or "unruled": a possible key gap's ruling, when a rulings file is in use.
const rulingStatus = g => (g.ruling === 'pending' ? 'pending' + (g.by || g.on ? ' (' + [g.by, g.on].filter(Boolean).join(', ') + ')' : '') : 'unruled');

// Rows of cells -> aligned lines. `right` lists the columns aligned right (numbers). gap: between columns.
function table(rows, right = [], indent = '  ', gap = '   ') {
  const widths = [];
  for (const row of rows) row.forEach((c, i) => { widths[i] = Math.max(widths[i] || 0, String(c).length); });
  return rows.map(row => indent + row.map((c, i) => {
    const s = String(c);
    if (i === row.length - 1 && !right.includes(i)) return s;
    return right.includes(i) ? s.padStart(widths[i]) : s.padEnd(widths[i]);
  }).join(gap)).join('\n');
}

// A wrong single label shown with what the answer key says ("shipping for technical"), as an
// ordinal's already is ("medium for high"). Only where it is shown: the results keep the value
// alone. The key comes from the paired records (results.paired), when the report has them.
function withKeyLabels(results) {
  const keys = new Map((results.paired || []).map(r => [r.id, r.key]));
  return (id, d) => {
    const key = keys.get(id);
    if (!key || !d || !d.wrong) return d;
    const wrong = {};
    for (const [name, values] of Object.entries(d.wrong)) {
      const k = key[name];
      wrong[name] = typeof k === 'string' ? values.map(v => (v.endsWith(' for ' + k) ? v : v + ' for ' + k)) : values;
    }
    return { ...d, wrong };
  };
}

module.exports = {
  withKeyLabels, pct, count, range, num, signed, list, table, CLASS_LABELS, WRONG_WHEN, TYPE_LABELS, TARGET_WORDS, typesIn, omissionWhat, declineRows, targetLines,
  groupSource, GROUP_RANGES, severalLabels, some, ruledValue, rulingsWords, pendingLine, rulingStatus, clusterLine, CLUSTER_GROUP_NOTE, CLUSTER_TARGET_NOTE,
  mixLines, thousands,
};
