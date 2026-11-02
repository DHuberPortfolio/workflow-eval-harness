// The score report as plain text for the terminal. Headline first: what went out without
// review but needed a person, how sure we can be of that number, then everything else.

const {
  pct, count, range, num, signed, list, table, CLASS_LABELS, WRONG_WHEN, TYPE_LABELS, TARGET_WORDS, typesIn, omissionWhat, declineRows, targetLines,
  groupSource, GROUP_RANGES, severalLabels, rulingsWords, pendingLine, rulingStatus, clusterLine, CLUSTER_GROUP_NOTE, CLUSTER_TARGET_NOTE, mixLines, thousands,
} = require('./format.js');
const { withKeyLabels } = require('./format.js');
// The tuning half and the held-out half (config.split): its own module, hooked in below.
const SPLIT = require('./split.js');

// Words wrapped to 100 columns, every line indented; a word longer than that (a long path) stays whole.
function wrapWords(text, indent) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (indent + line + ' ' + word).length > 100) { lines.push(indent + line); line = word; } else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(indent + line);
  return lines.join('\n');
}

// "RULINGS  1 value added to the answer key by rulings in ...", and the rest indented (trap I11),
// wrapped to 100 columns.
function rulingsSection(r, against = '') {
  const [first, ...rest] = rulingsWords(r, against);
  return [wrapWords('RULINGS  ' + first, '  ').slice(2), ...rest.map(l => wrapWords(l, '  '))].join('\n');
}

// Possible key gaps from this one run (results.key_gaps; trap I16). At most 12 rows, like the
// other lists; the full list is in --json.
function keyGapSection(results) {
  const g = results.key_gaps;
  const n = g.candidates.length;
  const ruled = results.rulings || null;
  const lines = ['POSSIBLE KEY GAPS  ' + (n
    ? n + ' applied value' + (n === 1 ? '' : 's') + ' the answer key does not list. Each is a mistake, or a value the answer key is missing: a person rules on ' + (n === 1 ? 'it' : 'each') + '.'
    : g.rejected ? 'none left to rule on: every other applied value is in the answer key' : 'none: every applied value is in the answer key')];
  const classOf = new Map(results.records.map(x => [x.id, x.route_class]));
  const where = c => (c.silent_error
    ? 'silent error, ' + (c.silent_error.if_added.length ? 'stays one if added: ' + c.silent_error.if_added.join(', ') : 'clears if added')
    : 'not a silent error (' + CLASS_LABELS[classOf.get(c.id)] + ')');
  const rows = g.candidates.slice(0, 12).map(c => [c.id, c.output, c.value, c.confidence === null ? '-' : c.confidence.toFixed(2), where(c), ...(ruled ? [rulingStatus(c)] : [])]);
  if (rows.length) lines.push(table(rows, [3]));
  if (n > 12) lines.push('  +' + (n - 12) + ' more (all in --json)');
  if (g.rejected) lines.push('  ' + g.rejected + ' ruled not a gap in ' + ruled.file + ', not listed.');
  if (g.candidates.some(c => c.silent_error)) lines.push('  "If added": if every gap listed for that record were added to the answer key.');
  if (n && !ruled) lines.push('  Record a ruling on each (add, reject or pending) in a rulings file, and pass it with --rulings (docs/CONFIG.md).');
  return lines.join('\n');
}

// "TARGET  under 5%: ..." and its indented details. extra: lines to add after them.
function targetSection(t, words, extra = []) {
  const [first, ...rest] = targetLines(t, words);
  return ['TARGET  ' + first, ...[...rest, ...extra].map(l => '  ' + l)].join('\n');
}

// "Q4 Q9 Q10   (sent to a person, but could have gone out)", then the ones the answer key
// leaves out, which never needed a person either (trap G12).
function unnecessaryReviews(q) {
  const leftOut = new Set(q.key_leaves_out);
  const couldGo = q.wasted.filter(id => !leftOut.has(id));
  const lines = [];
  if (couldGo.length) lines.push(list(couldGo) + '   (sent to a person, but could have gone out)');
  if (leftOut.size) lines.push(list(q.key_leaves_out) + '   (sent to a person, but the answer key blocks or suppresses them: no person was needed)');
  return 'UNNECESSARY REVIEWS  ' + (lines.length ? lines.join('\n                     ') : '-');
}

// "SUBJECT  applied, not in the answer key: SUBJ-ANTI" lines for one record's differences.
function differenceLines(d) {
  const labels = {
    wrong: 'applied, not in the answer key', missing_rejected: 'in the answer key, found but set aside',
    missing: 'in the answer key, never found', invalid: 'not an allowed value', near_miss: 'near miss',
    declined: 'declined, but the answer key has', should_decline: 'answered, but the answer key says to decline',
  };
  const out = [];
  for (const [bucket, label] of Object.entries(labels)) {
    for (const [output, values] of Object.entries(d[bucket] || {})) out.push(output + '  ' + label + ': ' + values.join(', '));
  }
  return out;
}

function headline(results) {
  const r = results.routing;
  const rows = [['', 'rate', 'count', 'likely range', 'what it counts']];
  const row = (name, rate, what) => rows.push([name, pct(rate), count(rate), range(rate), what]);
  row('Silent error rate', r.silent_errors.rate, 'went out without review, but needed a person');
  row('Straight-through', r.straight_through, 'went out without review');
  if (r.silent_omissions) row('Silent omissions', r.silent_omissions.rate, omissionWhat(results));
  row('Review precision', r.review_queue.precision, 'sent to a person, and needed one');
  if (r.block) row('Block precision', r.block.precision, 'blocked, and the answer key agrees');
  rows.push(['Safeguard failures', '', r.safeguard_failures.records + ' record(s)', '', "went out past the workflow's own confidence gate or floor"]);
  const lines = ['HEADLINE', table(rows, [1, 2])];
  const se = r.silent_errors;
  // Trap I15: the rate with pending rulings counted wrong (above), and counted as added.
  const b = results.rulings && results.rulings.if_pending_added;
  if (b && se.rate.d > 0) lines.push('  ' + pendingLine(b, se.rate));
  if (se.one_record_moves_pct !== null && se.rate.d > 1) {
    lines.push('  The likely range is where the true rate on records like these probably sits (95%). With ' + se.rate.d +
      ' records out without review, each one moves the silent error rate by ' + se.one_record_moves_pct.toFixed(1) + ' points.');
  }
  // Trap G14: the same rate's range counting clusters, only when the config names them.
  if (results.clusters) lines.push('  ' + clusterLine(results.clusters));
  // Trap G18: the same rate weighted to a real mix of traffic, only with --mix.
  if (results.mix) lines.push(...mixLines(results.mix, results).map(l => '  ' + l));
  return lines.join('\n');
}

// "  SP-SHOULD-REVIEW   went out, but should have gone to a person" for each type used.
function typeLegend(types) {
  if (!types.length) return [];
  return ['  what the types mean', table(types.map(t => [t, TYPE_LABELS[t] || '']), [], '    ')];
}

function silentSection(title, what, block, showDiffs, keyed = (id, d) => d) {
  if (!block || block.records.length === 0) return title + '  none';
  const sev = Object.entries(block.by_severity || {}).filter(([, n]) => n > 0).map(([s, n]) => s + ' ' + n).join(' · ');
  const lines = [title + '  ' + block.records.length + ' record(s)' + (sev ? '  (' + sev + ')' : '') + ': ' + what];
  for (const x of block.records) {
    lines.push('  ' + x.id.padEnd(8) + x.severity.padEnd(10) + x.types.join(', ') + (x.traps.length ? '   [' + x.traps.join(', ') + ']' : ''));
    lines.push('  ' + ''.padEnd(8) + 'went: ' + x.route + (x.gold_route === null ? '' : '   answer key: ' + x.gold_route));
    if (showDiffs) for (const d of differenceLines(keyed(x.id, x.differences))) lines.push('  ' + ''.padEnd(8) + d);
    if (x.declined) for (const d of differenceLines({ declined: x.declined })) lines.push('  ' + ''.padEnd(8) + d);
  }
  lines.push(...typeLegend(typesIn(block.records)));
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
  for (const [name, o] of Object.entries(q.outputs).filter(([, x]) => x.type !== 'set')) {
    lines.push('  ' + name + ' (' + o.type + '): accuracy ' + (o.declines ? 'when answered ' : '') + pct(o.accuracy) + ' (' + count(o.accuracy) + ')');
    if (o.type === 'ordinal') {
      const lean = o.mean_signed === null || o.mean_signed === 0 ? 'no lean' : o.mean_signed > 0 ? 'leans higher than the answer key' : 'leans lower than the answer key';
      lines.push('    within one step ' + pct(o.within_one) + ' · average distance ' + num(o.mean_distance, 2) + ' steps · closeness ' + num(o.closeness) +
        ' · ' + lean + ' (' + o.predicted_higher + ' higher, ' + o.predicted_lower + ' lower)');
      const md = Object.entries(o.miss_distances);
      if (md.length) lines.push('    misses by distance: ' + md.map(([d, c]) => d + ' step' + (d === '1' ? '' : 's') + ': ' + c).join(' · '));
    }
    // Rows are the answer key's labels, columns the workflow's; with declines, both can include "(declined)".
    const keys = Object.keys(o.confusion);
    const labels = Object.keys(o.confusion[keys[0]]);
    const rows = [['', ...labels.map(l => 'as ' + l), '', 'precision', 'recall', 'F1']];
    for (const k of keys) {
      const s = o.per_label[k];
      rows.push(['key ' + k, ...labels.map(p => o.confusion[k][p]), '', s ? pct(s.precision) : '', s ? pct(s.recall) : '', s ? num(s.f1) : '']);
    }
    lines.push(table(rows, labels.map((_, i) => i + 1).concat([labels.length + 2, labels.length + 3, labels.length + 4]), '    '));
    if (o.declines) lines.push(declineLines(o.declines));
  }
  return lines.join('\n');
}

// A label that may decline: how much it answered, and what each kind of decline mistake cost.
function declineLines(d) {
  const rows = [['declines', 'rate', 'count', 'likely range', 'what it counts']];
  for (const [name, rate, what, ids] of declineRows(d)) rows.push([name, pct(rate), count(rate), range(rate), what + (ids && ids.length ? ': ' + list(ids) : '')]);
  const lines = [table(rows, [1, 2], '    ')];
  lines.push('    Correct declines: ' + list(d.correct_declines) + '. A decline is neither a wrong label nor left out: accuracy is on what was answered, and coverage sits beside it.');
  if (!d.should_have_declined) lines.push('    Answers that should have been declines: not measured (no decline.values, so the answer key cannot say to decline).');
  return lines.join('\n');
}

function traps(results) {
  const t = results.traps;
  if (!t) return null;
  const rows = [['trap', 'records', 'routed right', 'silent errors', 'omissions', 'unnecessary reviews']];
  for (const g of t.groups) {
    rows.push([g.trap, g.records.length, count(g.routed_correctly) || 'n/a', list(g.silent_errors), list(g.silent_omissions), list(g.wasted_reviews)]);
  }
  const lines = ['PER TRAP', table(rows, [1])];
  if (t.records_with_several_traps) lines.push('  ' + t.records_with_several_traps + ' record(s) carry several traps and count in each, so the rows add up to more than the records.');
  if (t.coverage.below.length) lines.push('  Below min_per_trap (' + t.coverage.min_per_trap + '): ' + t.coverage.below.map(b => b.trap + ' (' + b.records + ')').join(', '));
  return lines.join('\n');
}

// One table per group (results.groups): each label's rates with their counts, and the likely
// ranges on the line below, so no group's rate is ever shown without them (trap H6).
function groupSections(results) {
  if (!results.groups) return [];
  const omissions = results.routing.silent_omissions !== null;
  return results.groups.map(g => {
    const routed = g.rows.some(x => x.routed_correctly);
    const rates = x => [x.silent_errors.rate, x.straight_through, x.review_precision.rate,
      ...(omissions ? [x.silent_omissions.rate] : []), ...(routed ? [x.routed_correctly] : [])];
    const rows = [['label', 'records', 'silent error rate', 'straight-through', 'review precision',
      ...(omissions ? ['silent omissions'] : []), ...(routed ? ['routed as the answer key says'] : [])]];
    for (const x of g.rows) {
      rows.push([x.label, x.records, ...rates(x).map(r => pct(r) + '  ' + count(r))]);
      rows.push(['', '', ...rates(x).map(r => (range(r) ? 'likely ' + range(r) : ''))]);
    }
    // "chat: Q2 · email: Q4 Q5", for the labels that have any.
    const byLabel = pick => g.rows.filter(x => pick(x).length).map(x => x.label + ': ' + list(pick(x))).join(' · ') || '-';
    const idRows = [['silent errors', byLabel(x => x.silent_errors.ids)]];
    if (omissions) idRows.push(['silent omissions', byLabel(x => x.silent_omissions.ids)]);
    idRows.push(['unnecessary reviews', byLabel(x => x.review_precision.unnecessary)]);
    const lines = ['PER GROUP  ' + g.name + '  (' + groupSource(g) + ')', table(rows, [1]).replace(/ +$/gm, ''), table(idRows)];
    if (g.records_with_several_labels) lines.push('  ' + severalLabels(g.records_with_several_labels, results.routing.total));
    lines.push('  ' + GROUP_RANGES);
    if (results.clusters) lines.push('  ' + CLUSTER_GROUP_NOTE);
    return lines.join('\n');
  });
}

function calibration(results) {
  const c = results.calibration;
  if (c.overall.n === 0) return 'CALIBRATION  no values with a confidence';
  const lines = ['CALIBRATION  does a stated confidence mean what it says? ' + c.overall.n + ' claims, ' + (c.buckets === 'distinct' ? 'one bucket per stated value' : 'buckets of ' + c.buckets.replace('width ', '')) +
    ' · average gap ' + num(c.overall.ece)];
  const rows = [['stated', 'claims', 'right', 'accuracy', 'gap', 'likely range']];
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
  parts.push(r.total + ' records · ' + results.inputs.mode + ' mode · a record needed a person if ' + WRONG_WHEN[results.inputs.wrong_when]);
  if (results.split) parts.push(SPLIT.splitLine(results.split));   // config.split only
  if (results.rulings) parts.push(rulingsSection(results.rulings));
  parts.push(headline(results));
  if (results.target) {
    const ts = targetSection(results.target, TARGET_WORDS.run, results.clusters ? [CLUSTER_TARGET_NOTE] : []);
    parts.push(results.split ? ts.replace(/^TARGET {2}/, 'TARGET (tuning half)  ') : ts);   // config.split: the tuning half's
  }
  if (results.split) parts.push(SPLIT.heldOutSection(results));   // config.split only
  parts.push(silentSection('SILENT ERRORS', 'went out without review, but needed a person', r.silent_errors, true, withKeyLabels(results)));
  if (r.silent_omissions) parts.push(silentSection('SILENT OMISSIONS', omissionWhat(results), r.silent_omissions, false));
  parts.push(r.safeguard_failures.records === 0 ? 'SAFEGUARD FAILURES  none'
    : 'SAFEGUARD FAILURES  ' + r.safeguard_failures.detail.map(d => d.id + ' (' + d.types.join(', ') + ')').join('  ') +
      '\n  Critical, and a workflow bug even when the content is right: find the branch that routed these records\n' +
      '  and why it did not apply the check (SG-GATE: lead confidence below the gate; SG-FLOOR: a value below the floor was applied).\n' +
      '  If the answer key agrees with the record, the fix is a model that clears the threshold, not a lower threshold.');
  parts.push(unnecessaryReviews(r.review_queue) +
    (r.block && r.block.wrongly_blocked.length ? '\nWRONGLY BLOCKED  ' + list(r.block.wrongly_blocked) : ''));
  const CLASSES = ['auto', 'review', 'block', 'exclude'];
  const should = { auto: 0, review: 0, block: 0, exclude: 0 };
  for (const x of results.records) if (x.gold_class) should[x.gold_class]++;
  const routeRows = [['ROUTES', ...CLASSES.map(k => CLASS_LABELS[k])], ['  this run', ...CLASSES.map(k => r.by_class[k])]];
  if (results.records.some(x => x.gold_class)) routeRows.push(['  answer key', ...CLASSES.map(k => should[k])]);
  parts.push(table(routeRows, [1, 2, 3, 4], ''));
  parts.push(quality(results));
  if (results.key_gaps) parts.push(keyGapSection(results));
  const t = traps(results);
  if (t) parts.push(t);
  parts.push(...groupSections(results));
  parts.push(calibration(results));
  if (r.not_measured.length) parts.push('NOT MEASURED\n' + r.not_measured.map(n => '  ' + n.what + ': ' + n.why).join('\n'));
  const notes = results.problems.filter(i => i.level !== 'stop');
  if (notes.length) parts.push('WARNINGS AND CLEAN-UPS\n' + notes.map(i => '  ' + i.level + ' [' + i.trap + '] ' + i.where + ': ' + i.message).join('\n'));
  // config.split with --show-held-out: the held-out half in full, after everything else.
  if (results.split && results.split.held_out_report) {
    parts.push('HELD-OUT HALF IN FULL  (--show-held-out: this look is recorded as listing the held-out records)\n\n' +
      renderTerminal({ inputs: results.inputs, ...results.split.held_out_report, problems: [] }).trimEnd());
  }
  return parts.join('\n\n') + '\n';
}

// ---------- Across runs ----------

const fmt = (v, unit) => (v === null ? 'n/a' : unit === 'points' ? v.toFixed(1) + '%' : unit === 'records' ? String(v) : v.toFixed(3));
const fmtDelta = (v, unit) => (v === null ? 'n/a' : (v > 0 ? '+' : '') + (unit === 'points' ? v.toFixed(1) + ' pts' : unit === 'records' ? String(v) : v.toFixed(3)));
const fmtSpread = (v, unit) => (v === null ? 'n/a' : unit === 'points' ? v.toFixed(1) + ' pts' : unit === 'records' ? v.toFixed(1) : v.toFixed(3));

function renderVariance(v) {
  const parts = ['VARIANCE  ' + v.runs.length + ' runs against ' + v.inputs.key];
  parts.push(v.runs.map((r, i) => '  run ' + (i + 1) + '  ' + r).join('\n'));
  if (v.split) parts.push(SPLIT.splitLine(v.split));   // config.split only
  if (v.rulings) parts.push(rulingsSection(v.rulings));
  const rows = [['metric', ...v.runs.map((_, i) => 'run ' + (i + 1)), 'mean', 'spread (sd)', 'min', 'max', 'range']];
  for (const m of v.metrics) {
    rows.push([m.name, ...m.values.map(x => fmt(x, m.unit)), fmt(m.mean, m.unit), fmtSpread(m.sd, m.unit), fmt(m.min, m.unit), fmt(m.max, m.unit), fmtSpread(m.range, m.unit)]);
  }
  parts.push(table(rows, rows[0].map((_, i) => i).filter(i => i > 0)));
  const silent = v.metrics.find(m => m.name === 'silent error rate');
  if (silent && silent.range === 0) {
    parts.push('Every run gave the same silent error rate, ' + fmt(silent.min, 'points') + '. ' + v.runs.length +
      ' runs are a small sample: that makes a steady rate likely, not certain.');
  } else if (silent && silent.range !== null) {
    parts.push('Identical code put the silent error rate anywhere from ' + fmt(silent.min, 'points') + ' to ' + fmt(silent.max, 'points') +
      '. A single run cannot claim more precision than that ' + fmtSpread(silent.range, 'points') + ' range.');
  }
  // Trap I8: quote the worst run, never the runs added together.
  const q = v.silent_error_rate;
  if (q.worst_run) {
    const w = q.worst_run;
    parts.push('The figure to quote is the worst run, run ' + w.run + ': ' + pct(w) + ' (' + count(w) + '; likely ' + range(w) + ').' +
      (q.records_out < q.times_out
        ? ' Not the runs added together: their ' + q.times_out + ' records out without review are ' + q.records_out +
          ' different records, and a record\'s runs tend to go the same way, so the added-up count would look like more evidence than it is.'
        : ''));
  }
  // Trap I18: records silent in at least one run. It grows with every run added, so the number
  // of runs is part of the sentence.
  const a = q.any_run;
  if (a && a.d > 0) {
    parts.push('In at least one of the ' + a.runs + ' runs, ' + a.n + ' of the ' + a.d + ' different records that went out without review ' +
      (a.n === 1 ? 'was' : 'were') + ' a silent error: ' + pct(a) + ' (likely ' + range(a) + '). This answers "how many records can this workflow ' +
      'get wrong unseen, at least sometimes?"; the worst run answers "how bad is one run?". The count only grows as runs are added, so it always ' +
      'comes with its number of runs.');
  }
  const rc = v.records.route_changed;
  parts.push('RECORDS THAT CHANGED ROUTE  ' + (rc.length ? '' : 'none') +
    rc.map(r => '\n  ' + r.id.padEnd(8) + r.routes.join(' / ') + (r.should ? '   (should: ' + r.should + ')' : '')).join(''));
  const sc = v.records.silent_changed;
  parts.push('RECORDS THAT WERE SILENT ERRORS IN SOME RUNS ONLY  ' + (sc.length ? '' : 'none') +
    sc.map(r => '\n  ' + r.id.padEnd(8) + r.silent.map(s => (s ? 'silent' : 'ok')).join(' / ')).join(''));
  const gaps = v.records.key_gap_candidates;
  const every = gaps.filter(g => g.runs === g.of);
  const rejected = v.records.key_gaps_rejected || 0;
  const lines = ['POSSIBLE KEY GAPS  ' + (every.length
    ? 'stated in every run, not in the answer key: the same mistake every time, or a value the answer key is missing. A person decides which.'
    : rejected ? 'none left to rule on: every value stated in every run is in the answer key or ruled not a gap' : 'none stated in every run')];
  const conf = c => (c === null ? '' : ' · confidence ' + (c.min === c.max ? c.min.toFixed(2) : c.min.toFixed(2) + '-' + c.max.toFixed(2)));
  // With a rulings file, each gap shows its ruling (trap I11); without one, nothing changes.
  const status = g => (g.ruling === undefined ? '' : '   ' + rulingStatus(g));
  for (const g of every) lines.push('  ' + g.id.padEnd(8) + g.output + '  ' + g.value + '   applied in ' + g.applied + ' of ' + g.of + conf(g.confidence) + status(g));
  const some = gaps.length - every.length;
  if (some) lines.push('  ' + some + ' more stated in some runs only (listed in --json)');
  if (rejected) lines.push('  ' + rejected + ' ruled not a gap in ' + v.rulings.file + ', not listed');
  parts.push(lines.join('\n'));
  if (v.split) parts.push(SPLIT.heldOutVarianceSection(v));   // config.split only
  if (v.problems.length) parts.push('WARNINGS\n' + v.problems.map(i => '  [' + i.trap + '] ' + i.where + ': ' + i.message).join('\n'));
  if (v.split && v.split.held_out_report) {
    parts.push('HELD-OUT HALF IN FULL  (--show-held-out: this look is recorded as listing the held-out records)\n\n' +
      renderVariance({ inputs: v.inputs, ...v.split.held_out_report, problems: [] }).trimEnd());
  }
  return parts.join('\n\n') + '\n';
}

// Trap I9: on the same records, a change is judged by the records it fixed against those it
// broke. Counts, not rates: a rate's base moves when routes move.
function pairedSection(p) {
  const signedPts = x => (x > 0 ? '+' : '') + x.toFixed(1);
  const change = o => (o.low_pct === null ? 'n/a' : (o.change > 0 ? '+' : '') + o.change + ' (likely ' + signedPts(o.low_pct) + ' to ' + signedPts(o.high_pct) + ' pts)');
  const rows = [['outcome', 'before', 'after', 'fixed', 'broke', 'change', 'verdict'],
    ...p.outcomes.map(o => [o.name, o.before, o.after, o.fixed, o.broke, change(o), o.verdict])];
  return ['PAIRED  the same ' + p.records + ' records, before and after. A change is real when it fixes more records than it breaks,',
    '  by more than chance would (95% range, Tango; the verdict agrees with McNemar\'s test). No repeated runs needed.',
    table(rows, [1, 2, 3, 4]),
    '  These are counts of records, not rates: a rate can fall just because correct records joined its base, with no error prevented.'].join('\n');
}

function renderCompare(c) {
  const i = c.inputs;
  const twoKeys = i.after_key !== undefined;
  const parts = ['COMPARE  ' + (twoKeys ? i.before + ' against ' + i.key + '  ->  ' + i.after + ' against ' + i.after_key : i.before + '  ->  ' + i.after)];
  if (c.split) parts.push(SPLIT.splitLine(c.split));   // config.split only
  if (c.rulings) {
    // Rulings apply to each key; when the two keys take them alike, say it once.
    const same = JSON.stringify(c.rulings.before) === JSON.stringify(c.rulings.after);
    if (same) parts.push(rulingsSection(c.rulings.before));
    else parts.push(rulingsSection(c.rulings.before, ' (' + i.key + ')'), rulingsSection(c.rulings.after, ' (' + i.after_key + ')'));
  }
  parts.push(c.noise_runs ? 'noise baseline: ' + c.noise_runs.length + ' runs of identical code (' + c.noise_runs.join(', ') + ')'
    : twoKeys && c.same_predictions ? 'the same predictions against two answer keys: every change below comes from the key, not the workflow. ' +
      'The PAIRED counts say which records the new key fixed and broke.'
      : twoKeys ? 'two different runs against two answer keys: each change below mixes the workflow\'s and the key\'s (see the warning)'
        : 'no noise baseline: the rates below need repeated runs of the unchanged workflow (--noise) to be judged; the PAIRED counts after them do not');
  const rows = [['metric', 'before', 'after', 'change', 'noise range', 'verdict']];
  for (const m of c.metrics) rows.push([m.name, fmt(m.before, m.unit), fmt(m.after, m.unit), fmtDelta(m.delta, m.unit), m.noise_range === null ? '' : fmtSpread(m.noise_range, m.unit), m.verdict]);
  parts.push(table(rows, [1, 2, 3, 4]));
  parts.push(pairedSection(c.paired));
  if (c.split) parts.push(SPLIT.heldOutCompareSection(c));   // config.split only
  const r = c.records;
  const lines = ['RECORDS THAT CHANGED  routes fixed ' + c.summary.routes_fixed + ' · routes broken ' + c.summary.routes_broken];
  for (const x of r.route_changed) lines.push('  ' + x.id.padEnd(8) + x.before + ' -> ' + x.after + (x.should ? '   should: ' + x.should + (x.outcome ? '   ' + x.outcome : '') : ''));
  for (const x of r.became_silent) lines.push('  ' + x.id.padEnd(8) + 'became a silent error (' + x.types.join(', ') + ')');
  for (const x of r.no_longer_silent) lines.push('  ' + x.id.padEnd(8) + 'no longer a silent error (was ' + x.types.join(', ') + ')');
  for (const x of r.became_omission) lines.push('  ' + x.id.padEnd(8) + 'became a silent omission (' + x.types.join(', ') + ')');
  for (const x of r.no_longer_omission) lines.push('  ' + x.id.padEnd(8) + 'no longer a silent omission');
  if (r.values_changed.length) lines.push('  values changed on: ' + list(r.values_changed.map(x => x.id)));
  if (lines.length === 1) lines.push('  none');
  parts.push(lines.join('\n'));
  if (c.problems.length) parts.push('WARNINGS\n' + c.problems.map(i => '  [' + i.trap + '] ' + i.where + ': ' + i.message).join('\n'));
  if (c.split && c.split.held_out_report) {
    parts.push('HELD-OUT HALF IN FULL  (--show-held-out: this look is recorded as listing the held-out records)\n\n' +
      renderCompare({ inputs: c.inputs, ...c.split.held_out_report, problems: [] }).trimEnd());
  }
  return parts.join('\n\n') + '\n';
}

// ---------- A bare count (wfeval rate) ----------

function renderRate(x) {
  const parts = ['RATE  ' + pct(x.rate) + '  ' + count(x.rate) + '  likely ' + range(x.rate) + ' (95%)\n' +
    '  The likely range is where the true rate on records like these probably sits.' +
    (x.rate.d > 1 ? ' With ' + x.rate.d + ' records, each record moves it by ' + (100 / x.rate.d).toFixed(1) + ' points.' : '')];
  if (x.target) parts.push(targetSection(x.target, TARGET_WORDS.count));
  return parts.join('\n\n') + '\n';
}

// ---------- What-if ----------

const frac = r => (r === null ? 'n/a' : r.d === 0 ? 'none went out' : pct(r) + ' (' + r.n + '/' + r.d + ')');

// With --target (trap E9): which gate is certified, the gate that only looks under the target
// read alone, how certification works, and what the guarantee rests on.
// The gate what-if's certification, or the policy what-if's (one row per policy, by name).
const GATE_WORDS = { one: 'gate', One: 'Gate', many: 'gates', tested: c => c.gates_tested, name: b => b.threshold.toFixed(2) };
const POLICY_WORDS = { one: 'policy', One: 'Policy', many: 'policies', tested: c => c.policies_tested, name: b => '"' + b.name + '"', rows: true };
function certificationSection(c, w = GATE_WORDS) {
  const under = c.target_pct + '%';
  const tested = w.tested(c);
  // Policies count the run as it was too: "5 rows (the run as it was and 4 policies)".
  const gates = w.rows ? tested + ' rows (the run as it was and ' + (tested - 1) + ' polic' + (tested - 1 === 1 ? 'y' : 'ies') + ')' : tested + ' ' + (tested === 1 ? w.one : w.many);
  const alpha = Math.round((1 - c.confidence) * 100) + '%';
  const lines = ['CERTIFIED UNDER ' + under + '  at ' + Math.round(c.confidence * 100) + '% confidence, among ' + gates + (w.rows ? ' tested' : ' tried')];
  const b = c.best;
  if (b) {
    lines.push('The loosest certified ' + w.one + ' is ' + w.name(b) + ': silent error rate ' + pct(b.silent_error_rate) + ' (' + count(b.silent_error_rate) +
      ' out without review, likely ' + range(b.silent_error_rate) + '), straight-through ' + pct(b.straight_through) + ' (' + count(b.straight_through) + ').');
    const note = w.bestNote ? w.bestNote(b) : null;
    if (note) lines.push(note);
  } else {
    lines.push('No ' + w.one + ' tried is certified under ' + under + '. Among ' + gates + ', a ' + w.one + ' needs at least ' + thousands(c.least_records_out) +
      ' records out without review, with no silent error among them, to be certified (more if it has any).');
  }
  const a = c.looks_under_alone;
  if (a && !a.certified) {
    lines.push(w.One + ' ' + w.name(a) + ' looks under ' + under + ' read alone (its likely range reaches ' + a.high_pct.toFixed(1) + '%), but it was picked from ' + gates + ': not certified.');
  }
  lines.push('How: each ' + w.one + ' is tested on its own records out without review. It is certified if, were its true silent error rate ' + under +
    ' or more, so few silent errors would turn up at most ' + Number((c.level * 100).toPrecision(2)) + '% of the time (exact binomial): the ' +
    alpha + ' allowed for being wrong, shared among the ' + gates + ' tried (Bonferroni). So the chance that any certified ' + w.one + ' is really at or above ' +
    under + ' is at most ' + alpha + '.');
  lines.push('The guarantee holds for records like these: on a golden set built from traps it is a stress-test guarantee, not one for real traffic. ' +
    (w === GATE_WORDS
      ? 'It rests on the assumption above about which records the gate can move, and counts only the gates tried in this sweep: sweeping again over a ' +
        'narrower range after seeing this one is still picking from many.'
      : 'Hold-if rules need no assumption; a threshold change rests on the assumption above about which records the gate can move. It counts only the ' +
        'policies tried in this file: policies chosen on the same records flatter themselves, so writing new ones after seeing this table is still ' +
        'picking from many. Confirm the one you choose on records it was not chosen on.'));
  return lines.join('\n  ');
}

// Where the gate check ran: the one current gate, or each record's own threshold (a field).
const checkAt = k => (k.configured ? 'the config\'s gates' : k.own ? 'each record\'s own threshold ("' + k.own + '")' : 'the current gate (' + k.threshold + ')');

// The gate self-check's lines (whatif.js gateCheck), for the gate and policy what-ifs.
function checkLines(k) {
  const out = [k.differing.length === 0
    ? 'Check: at ' + checkAt(k) + ' the simulation reproduces the actual route of all ' + (k.movable - (k.not_checked || []).length) + ' movable records' +
      (k.not_checked ? ' it could check' : '') + '.'
    : 'CHECK FAILED: at ' + checkAt(k) + ' the simulation routes ' + k.differing.length + ' of ' + k.movable +
      ' movable records differently from the actual run (' + list(k.differing) + '). Those records were not routed by the gate alone: ' +
      'set whatif.movable_field so the what-if only moves records the gate decided.'];
  if (k.not_checked) {
    const n = k.not_checked.length;
    out.push(n + ' movable record' + (n === 1 ? '' : 's') + ' could not be checked (a confidence or threshold is missing): ' + list(k.not_checked) + '.');
  }
  return out.join('\n');
}

// Load warnings and clean-ups, below a what-if.
function whatifNotes(w) {
  const notes = (w.problems || []).filter(i => i.level !== 'stop');
  return notes.length ? ['WARNINGS AND CLEAN-UPS\n' + notes.map(i => '  ' + i.level + ' [' + i.trap + '] ' + i.where + ': ' + i.message).join('\n')] : [];
}

// One row per policy, beside the run as it was (metrics/policy.js).
// One row per policy, beside the run as it was (metrics/policy.js), in 100 columns: a summary
// table to compare them by eye, then one block per row with every figure.
const NAME_WIDTH = 30;
const short = name => (name.length > NAME_WIDTH ? name.slice(0, NAME_WIDTH - 1) + '…' : name);
// "5 rows: the run as it was and 4 policies", the count certification pays for.
const rowsTested = n => n + ' rows: the run as it was and ' + (n - 1) + ' polic' + (n - 1 === 1 ? 'y' : 'ies');
// One paired outcome: the change in records, what moved each way, and Tango's range in points.
function pairedText(x, what, fixWord, brokeWord) {
  const change = x.after - x.before;
  return what + ' ' + (change > 0 ? '+' : '') + change + ' (' + fixWord + ' ' + x.fixed + ', ' + brokeWord + ' ' + x.broke + '; ' +
    (x.verdict === 'no change' || x.low_pct === null ? x.verdict : x.low_pct.toFixed(1) + ' to ' + x.high_pct.toFixed(1) + ' points, ' + x.verdict) + ')';
}
// Paired with the run as it was, a certified policy that lets out more silent errors.
function worseNote(w) {
  return b => {
    const r = w.rows.find(x => x.name === b.name);
    const x = r && r.paired ? r.paired.silent_errors : null;
    if (!x || x.after <= x.before) return null;
    const n = x.after - x.before;
    return 'But paired with the run as it was, it lets out ' + n + ' more silent error' + (n === 1 ? '' : 's') + ' (fixed ' + x.fixed + ', new ' + x.broke + '; ' + x.verdict + ').';
  };
}

function renderPolicies(w) {
  const c = w.certification;
  const parts = ['WHAT-IF: POLICIES  ' + rowsTested(w.rows.length)];
  if (w.split) parts.push(SPLIT.whatifSplitLine(w));   // config.split only
  parts.push('Assumption: ' + w.assumption + '.');
  const rows = [['policy', 'silent error rate', 'went out', 'unnecessary reviews', ...(c ? ['certified'] : [])]];
  for (const r of w.rows) {
    rows.push([short(r.name), frac(r.silent_error_rate), r.through.length + ' (' + pct(r.straight_through) + ')', r.wasted_reviews.length, ...(c ? [r.certified ? 'yes' : ''] : [])]);
  }
  parts.push(table(rows, [1, 2, 3]));
  if (w.check) parts.push(checkLines(w.check));
  const blocks = [];
  for (const r of w.rows) {
    const p = r.paired;
    const lines = ['  ' + r.name + (p === null ? '' : r.exact ? '  (exact)' : '  (assumes the gate decided)')];
    lines.push('    silent error rate ' + pct(r.silent_error_rate) + ' (' + count(r.silent_error_rate) + ')' + (range(r.silent_error_rate) ? ', likely ' + range(r.silent_error_rate) : ''));
    lines.push('    straight-through ' + pct(r.straight_through) + ' (' + count(r.straight_through) + ')' + (p === null ? '' : ' · held ' + r.held.length + ' · moved by the gate ' + r.moved_by_gate.length) +
      (c ? ' · certified under ' + c.target_pct + '%: ' + (r.certified ? 'yes' : 'no') : ''));
    lines.push('    ' + (r.silent_omissions ? 'silent omissions ' + pct(r.silent_omissions) + ' (' + count(r.silent_omissions) + ') · ' : '') +
      'unnecessary reviews ' + r.wasted_reviews.length + ' · review precision ' + pct(r.review_queue_precision) + ' (' + count(r.review_queue_precision) + ')');
    if (p) {
      const vs = [pairedText(p.silent_errors, 'silent errors', 'fixed', 'new'), ...(p.silent_omissions ? [pairedText(p.silent_omissions, 'silent omissions', 'fixed', 'new')] : []),
        pairedText(p.unnecessary_reviews, 'unnecessary reviews', 'removed', 'added')];
      lines.push('    vs as run: ' + vs[0], ...vs.slice(1).map(v => '               ' + v));
    }
    blocks.push(lines.join('\n'));
  }
  parts.push('EACH ROW  every figure; "vs as run" pairs the policy with the run as it was, record by record:\n' +
    'the change in records, and its likely range in points of all ' + (w.rows[1] ? w.rows[1].paired.records : 0) + ' records\n\n' + blocks.join('\n\n'));
  for (const name of w.changes_nothing || []) parts.push('"' + name + '" holds and moves no record: it is the run as it was. Check its conditions.');
  if (c) parts.push(certificationSection(c, { ...POLICY_WORDS, bestNote: worseNote(w) }));
  if (w.split && c) parts.push(SPLIT.heldOutWhatifSection(w));   // config.split only
  parts.push('Read the silent error COUNT beside the rate: a rate can fall because correct records joined the denominator, with no error prevented. ' +
    'A policy that holds more always looks safer: read the unnecessary reviews it adds beside the silent errors it fixes.');
  parts.push(...whatifNotes(w));
  return parts.join('\n\n') + '\n';
}

function renderWhatif(w) {
  if (w.kind === 'policies') return renderPolicies(w);
  const parts = [];
  if (w.kind === 'gate') {
    const c = w.certification;
    parts.push('WHAT-IF: CONFIDENCE GATE  sweeping ' + w.outputs.join(', '));
    if (w.split) parts.push(SPLIT.whatifSplitLine(w));   // config.split only
    parts.push('Assumption: ' + w.assumption + '.');
    const rows = [['gate', 'went out', 'straight-through', 'silent errors', 'silent error rate', ...(c ? ['certified'] : []), 'moved in', 'moved out', 'unnecessary reviews', '']];
    for (const r of w.rows) {
      rows.push([r.threshold.toFixed(2), r.through.length, pct(r.straight_through), list(r.silent_errors, 6), frac(r.silent_error_rate),
        ...(c ? [r.certified ? 'yes' : ''] : []), list(r.moved_in, 6), list(r.moved_out, 6), r.wasted_reviews.length, r.current ? '<- current' : '']);
    }
    parts.push(table(rows, [1, 2]));
    if (w.check) parts.push(checkLines(w.check));
    if (c) parts.push(certificationSection(c));
    if (w.split && c) parts.push(SPLIT.heldOutWhatifSection(w));   // config.split only
    parts.push('Read the silent error COUNT beside the rate: a rate can fall because correct records joined the denominator, with no error prevented.');
  } else {
    parts.push('WHAT-IF: CONFIDENCE FLOOR');
    if (w.split) parts.push(SPLIT.whatifSplitLine(w));   // config.split only
    parts.push('Assumption: ' + w.assumption);
    const rows = [['floor', 'precision', 'recall', 'F1', 'TP/FP/FN', 're-admitted', 'evicted', 'routes moved', 'silent errors', 'needs replay', '']];
    for (const r of w.rows) {
      const o = r.overall;
      rows.push([r.floor.toFixed(2), o ? pct(o.precision) : 'n/a', o ? pct(o.recall) : 'n/a', o ? num(o.f1) : 'n/a', o ? o.tp + '/' + o.fp + '/' + o.fn : '',
        r.readmitted.length, r.evicted.length, list(r.moved, 4), frac(r.silent_error_rate), list(r.needs_replay, 6), r.current ? '<- current' : '']);
    }
    parts.push(table(rows, [1, 2, 3, 5, 6]));
  }
  parts.push(...whatifNotes(w));
  return parts.join('\n\n') + '\n';
}

// ---------- Free text, graded by a person ----------

function renderGrades(g) {
  const parts = ['GRADES  ' + g.inputs.grades + (g.reviewer ? '  (' + g.reviewer + ')' : '') + (g.title ? '  ' + g.title : '')];
  parts.push(g.overall.graded + ' fields graded by a person against the source · ' + g.inputs.mode + ' mode · scored as labels: faithful, invented or missing');
  const row = (name, r, what) => [name, pct(r), count(r), range(r), what];
  const head = [['', 'rate', 'count', 'likely range', 'what it counts']];
  parts.push('HEADLINE\n' + table([...head,
    row('Invented', g.overall.invented, 'says something the source does not support (high)'),
    row('Missing', g.overall.missing, 'leaves out something the source says (medium)'),
    row('Faithful', g.overall.faithful, 'supported by the source, nothing left out'),
    row('Forms with an invented field', g.forms.with_invented, 'of the forms with every field graded'),
  ], [1, 2]));
  const rateRows = (label, list) => table([[label, 'graded', 'invented', '', 'likely range', 'missing', '', 'likely range'],
    ...list.map(x => [x.name || x.section, x.graded, pct(x.invented), count(x.invented), range(x.invented), pct(x.missing), count(x.missing), range(x.missing)])], [1, 2, 3, 5, 6]);
  parts.push('PER FIELD\n' + rateRows('field', g.fields.map(f => ({ ...f, name: f.name + (f.section ? '  [' + f.section + ']' : '') }))));
  if (g.sections.length) parts.push('PER SECTION  a section pools its fields\' grades, so it counts fields, not forms\n' + rateRows('section', g.sections));

  const lines = ['INVENTED  ' + (g.invented.length ? g.invented.length + ' field(s), high: the form says something the source does not' : 'none')];
  for (const x of g.invented) {
    lines.push('  ' + x.form.padEnd(8) + x.field + (x.kinds.length ? '   [' + x.kinds.join(', ') + ']' : ''));
    if (x.note) lines.push('  ' + ''.padEnd(8) + x.note);
  }
  const kinds = Object.entries(g.kinds.counts).filter(([, n]) => n > 0);
  if (kinds.length || g.kinds.none_given) lines.push('  by kind: ' + [...kinds.map(([k, n]) => k + ' ' + n), ...(g.kinds.none_given ? ['none given ' + g.kinds.none_given] : [])].join(' · '));
  parts.push(lines.join('\n'));
  const miss = ['MISSING  ' + (g.missing.length ? g.missing.length + ' field(s), medium: the form leaves out something the source says' : 'none')];
  for (const x of g.missing) {
    miss.push('  ' + x.form.padEnd(8) + x.field);
    if (x.note) miss.push('  ' + ''.padEnd(8) + x.note);
  }
  parts.push(miss.join('\n'));
  parts.push('PER FORM\n' + table([['form', 'graded', 'invented', 'missing'], ...g.forms.per_form.map(f => [f.form, f.graded + ' of ' + f.of, f.invented, f.missing])], [1, 2, 3]));

  const a = g.agreement;
  if (a) {
    const k = v => (v === null ? 'not measurable (chance agreement is already 100%)' : v.toFixed(3));
    const al = ['AGREEMENT  ' + (a.first || g.inputs.grades) + ' and ' + (a.second || g.inputs.second) + ', ' + a.compared + ' fields graded by both'];
    al.push(table([['', 'value', 'count', 'likely range'],
      ['Observed agreement', pct(a.observed), count(a.observed), range(a.observed)],
      ["Cohen's kappa", k(a.kappa), '', ''],
      ['On "invented or not"', pct(a.invented_observed), count(a.invented_observed), range(a.invented_observed)],
      ["  Cohen's kappa", k(a.invented_kappa), '', ''],
    ], [1, 2]));
    al.push('  Kappa is 1 for perfect agreement, 0 for agreement no better than chance.' + (a.graded_by_one_only ? ' ' + a.graded_by_one_only + ' field(s) graded by only one reviewer are left out.' : ''));
    al.push('  disagreements' + (a.disagreements.length ? ', for a person to settle:' : ': none'));
    for (const d of a.disagreements) al.push('    ' + d.form.padEnd(8) + d.field.padEnd(16) + (d.first + ' / ' + d.second).padEnd(22) + (d.first_note || d.second_note ? '   ' + [d.first_note, d.second_note].filter(Boolean).join(' / ') : ''));
    parts.push(al.join('\n'));
  }
  const notes = g.problems.filter(i => i.level !== 'stop');
  if (notes.length) parts.push('WARNINGS AND CLEAN-UPS\n' + notes.map(i => '  ' + i.level + ' [' + i.trap + '] ' + i.where + ': ' + i.message).join('\n'));
  return parts.join('\n\n') + '\n';
}

module.exports = { renderTerminal, renderVariance, renderCompare, renderWhatif, renderGrades, renderRate };
