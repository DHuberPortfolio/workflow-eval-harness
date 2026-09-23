// The score report as plain text for the terminal. Headline first: what reached
// people without a human, how sure we can be of that number, then everything else.

const { pct, count, range, num, signed, list, table } = require('./format.js');

const WRONG_WHEN = {
  either: "the key's route says so, or its values are wrong",
  gold_route: "the key's route says so",
  any_mismatch: 'its values are wrong',
};

// "SUBJECT  applied, not in key: SUBJ-ANTI" lines for one record's differences.
function differenceLines(d) {
  const labels = {
    wrong: 'applied, not in key', missing_rejected: 'in key, proposed but not applied',
    missing: 'in key, never proposed', invalid: 'not an allowed value',
  };
  const out = [];
  for (const [bucket, label] of Object.entries(labels)) {
    for (const [output, values] of Object.entries(d[bucket] || {})) out.push(output + '  ' + label + ': ' + values.join(', '));
  }
  return out;
}

function headline(results) {
  const r = results.routing;
  const rows = [['', 'rate', 'count', '95% range']];
  rows.push(['Silent error rate', pct(r.silent_errors.rate), count(r.silent_errors.rate), range(r.silent_errors.rate)]);
  rows.push(['Straight-through', pct(r.straight_through), count(r.straight_through), range(r.straight_through)]);
  if (r.silent_omissions) rows.push(['Silent omissions', pct(r.silent_omissions.rate), count(r.silent_omissions.rate), range(r.silent_omissions.rate)]);
  rows.push(['Review-queue precision', pct(r.review_queue.precision), count(r.review_queue.precision), range(r.review_queue.precision)]);
  if (r.block) rows.push(['Block precision', pct(r.block.precision), count(r.block.precision), range(r.block.precision)]);
  rows.push(['Safeguard failures', '', r.safeguard_failures.records + ' record(s)', '']);
  const lines = ['HEADLINE', table(rows, [1, 2])];
  if (r.silent_errors.one_record_moves_pct !== null) {
    lines.push('  At this size one record moves the silent error rate by ' + r.silent_errors.one_record_moves_pct.toFixed(1) + ' points.');
  }
  return lines.join('\n');
}

function silentSection(title, block, showDiffs) {
  if (!block || block.records.length === 0) return title + '  none';
  const sev = Object.entries(block.by_severity || {}).filter(([, n]) => n > 0).map(([s, n]) => s + ' ' + n).join(' · ');
  const lines = [title + '  ' + block.records.length + ' record(s)' + (sev ? '  (' + sev + ')' : '')];
  for (const x of block.records) {
    lines.push('  ' + x.id.padEnd(8) + x.severity.padEnd(10) + x.types.join(', ') + (x.traps.length ? '   [' + x.traps.join(', ') + ']' : ''));
    lines.push('  ' + ''.padEnd(8) + 'went: ' + x.route + '   should: ' + x.gold_route);
    if (showDiffs) for (const d of differenceLines(x.differences)) lines.push('  ' + ''.padEnd(8) + d);
  }
  return lines.join('\n');
}

function quality(results) {
  const q = results.quality;
  const left = [];
  if (q.left_out.model_failed.length) left.push('model failed: ' + list(q.left_out.model_failed));
  if (q.left_out.suppressed_duplicates.length) left.push('suppressed duplicates: ' + list(q.left_out.suppressed_duplicates));
  const lines = ['OUTPUT QUALITY  ' + q.population + ' records' + (left.length ? '  (left out: ' + left.join('; ') + ')' : '')];
  const sets = Object.entries(q.outputs).filter(([, o]) => o.type === 'set');
  if (sets.length) {
    const rows = [['output', 'precision', 'recall', 'F1', 'exact match', 'TP/FP/FN']];
    for (const [name, o] of sets) rows.push([name, pct(o.precision), pct(o.recall), num(o.f1), pct(o.exact_match), o.tp + '/' + o.fp + '/' + o.fn]);
    if (q.overall && sets.length > 1) rows.push(['overall', pct(q.overall.precision), pct(q.overall.recall), num(q.overall.f1), '', q.overall.tp + '/' + q.overall.fp + '/' + q.overall.fn]);
    lines.push(table(rows, [1, 2, 3, 4]));
  }
  for (const [name, o] of Object.entries(q.outputs).filter(([, x]) => x.type === 'label')) {
    lines.push('  ' + name + ' (label): accuracy ' + pct(o.accuracy) + ' (' + count(o.accuracy) + ')');
    const labels = Object.keys(o.per_label);
    const rows = [['', ...labels.map(l => 'as ' + l), '', 'precision', 'recall', 'F1']];
    for (const k of labels) {
      const s = o.per_label[k];
      rows.push(['key ' + k, ...labels.map(p => o.confusion[k][p]), '', pct(s.precision), pct(s.recall), num(s.f1)]);
    }
    lines.push(table(rows, labels.map((_, i) => i + 1).concat([labels.length + 2, labels.length + 3, labels.length + 4]), '    '));
  }
  return lines.join('\n');
}

function traps(results) {
  const t = results.traps;
  if (!t) return null;
  const rows = [['trap', 'records', 'routed right', 'silent errors', 'omissions', 'wasted reviews']];
  for (const g of t.groups) {
    rows.push([g.trap, g.records.length, count(g.routed_correctly) || 'n/a', list(g.silent_errors), list(g.silent_omissions), list(g.wasted_reviews)]);
  }
  const lines = ['PER TRAP', table(rows, [1])];
  if (t.records_with_several_traps) lines.push('  ' + t.records_with_several_traps + ' record(s) carry several traps and count in each, so the rows add up to more than the records.');
  if (t.coverage.below.length) lines.push('  Below min_per_trap (' + t.coverage.min_per_trap + '): ' + t.coverage.below.map(b => b.trap + ' (' + b.records + ')').join(', '));
  return lines.join('\n');
}

function calibration(results) {
  const c = results.calibration;
  if (c.overall.n === 0) return 'CALIBRATION  no values with a confidence';
  const lines = ['CALIBRATION  ' + c.overall.n + ' claims, ' + (c.buckets === 'distinct' ? 'one bucket per stated value' : 'buckets of ' + c.buckets.replace('width ', '')) +
    ' · average gap ' + num(c.overall.ece)];
  const rows = [['stated', 'claims', 'right', 'accuracy', 'gap', '95% range']];
  for (const b of c.overall.buckets) {
    rows.push([b.from === b.to ? num(b.from, 2) : num(b.from, 2) + '-' + num(b.to, 2), b.n, b.correct, pct(b.accuracy), signed(b.gap), range(b.accuracy)]);
  }
  lines.push(table(rows, [1, 2, 3, 4]));
  for (const t of c.thresholds) {
    const what = t.name === 'auto_publish' ? 'gate ' + t.output + ' ' + t.threshold : t.name + ' ' + t.threshold;
    let line = '  ' + what + ': at or above, ' + pct(t.at_or_above) + ' right (' + count(t.at_or_above) + ')';
    if (t.below && t.below.d > 0) line += '; below, ' + pct(t.below) + ' right (' + count(t.below) + ')';
    lines.push(line);
  }
  if (c.overall.n < 100) lines.push('  ' + c.overall.n + ' claims is too few to set thresholds from; read the ranges, not the rates.');
  return lines.join('\n');
}

function renderTerminal(results) {
  const r = results.routing;
  const parts = [];
  parts.push('SCORE  ' + results.inputs.predictions + '  vs  ' + results.inputs.key);
  parts.push(r.total + ' records · ' + results.inputs.mode + ' mode · a record needed a human if ' + WRONG_WHEN[results.inputs.wrong_when]);
  parts.push(headline(results));
  parts.push(silentSection('SILENT ERRORS', r.silent_errors, true));
  if (r.silent_omissions) parts.push(silentSection('SILENT OMISSIONS', r.silent_omissions, false));
  parts.push(r.safeguard_failures.records === 0 ? 'SAFEGUARD FAILURES  none'
    : 'SAFEGUARD FAILURES  ' + r.safeguard_failures.detail.map(d => d.id + ' (' + d.types.join(', ') + ')').join('  '));
  parts.push('WASTED REVIEWS  ' + list(r.review_queue.wasted) + (r.block && r.block.wrongly_blocked.length ? '\nWRONGLY BLOCKED  ' + list(r.block.wrongly_blocked) : ''));
  const classes = by => ['auto', 'review', 'block', 'exclude'].map(k => k + ' ' + by[k]).join(' · ');
  const should = { auto: 0, review: 0, block: 0, exclude: 0 };
  for (const x of results.records) if (x.gold_class) should[x.gold_class]++;
  parts.push('ROUTES  went:   ' + classes(r.by_class) + (results.records.some(x => x.gold_class) ? '\n        should: ' + classes(should) : ''));
  parts.push(quality(results));
  const t = traps(results);
  if (t) parts.push(t);
  parts.push(calibration(results));
  if (r.not_measured.length) parts.push('NOT MEASURED\n' + r.not_measured.map(n => '  ' + n.what + ': ' + n.why).join('\n'));
  const notes = results.problems.filter(i => i.level !== 'stop');
  if (notes.length) parts.push('WARNINGS AND CLEAN-UPS\n' + notes.map(i => '  ' + i.level + ' [' + i.trap + '] ' + i.where + ': ' + i.message).join('\n'));
  return parts.join('\n\n') + '\n';
}

module.exports = { renderTerminal, WRONG_WHEN };
