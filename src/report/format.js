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
  'SP-MISSING-REJECTED': 'the model found a correct value, but it was set aside for low confidence',
  'SP-MISSING': 'a correct value was never found',
  'SP-NEAR-MISS': 'close, but not exact, on an ordered scale (a 4 for a 5)',
  'SO-FALSE-DUPLICATE': 'a real record was suppressed as a duplicate',
  'SO-PRIMARY-SUPPRESSED': 'the primary copy was suppressed and a duplicate kept',
  'SO-FALSE-BLOCK': 'a good record was blocked',
  'SG-GATE': 'went out below the confidence gate',
  'SG-FLOOR': 'a value below the confidence floor was kept',
};

// The distinct types used by a list of records, in first-seen order.
const typesIn = records => [...new Set(records.flatMap(x => x.types))];

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

module.exports = { pct, count, range, num, signed, list, table, CLASS_LABELS, WRONG_WHEN, TYPE_LABELS, typesIn };
