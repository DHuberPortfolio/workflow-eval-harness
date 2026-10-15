// The score report as plain text for the terminal. Headline first: what went out without
// review but needed a person, how sure we can be of that number, then everything else.

const { pct, count, range, num, signed, list, table, CLASS_LABELS, WRONG_WHEN, TYPE_LABELS, typesIn, omissionWhat, declineRows } = require('./format.js');

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
  if (se.one_record_moves_pct !== null && se.rate.d > 1) {
    lines.push('  The likely range is where the true rate on records like these probably sits (95%). With ' + se.rate.d +
      ' records out without review, each one moves the silent error rate by ' + se.one_record_moves_pct.toFixed(1) + ' points.');
  }
  return lines.join('\n');
}

// "  SP-SHOULD-REVIEW   went out, but should have gone to a person" for each type used.
function typeLegend(types) {
  if (!types.length) return [];
  return ['  what the types mean', table(types.map(t => [t, TYPE_LABELS[t] || '']), [], '    ')];
}

function silentSection(title, what, block, showDiffs) {
  if (!block || block.records.length === 0) return title + '  none';
  const sev = Object.entries(block.by_severity || {}).filter(([, n]) => n > 0).map(([s, n]) => s + ' ' + n).join(' · ');
  const lines = [title + '  ' + block.records.length + ' record(s)' + (sev ? '  (' + sev + ')' : '') + ': ' + what];
  for (const x of block.records) {
    lines.push('  ' + x.id.padEnd(8) + x.severity.padEnd(10) + x.types.join(', ') + (x.traps.length ? '   [' + x.traps.join(', ') + ']' : ''));
    lines.push('  ' + ''.padEnd(8) + 'went: ' + x.route + (x.gold_route === null ? '' : '   answer key: ' + x.gold_route));
    if (showDiffs) for (const d of differenceLines(x.differences)) lines.push('  ' + ''.padEnd(8) + d);
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
  parts.push(headline(results));
  parts.push(silentSection('SILENT ERRORS', 'went out without review, but needed a person', r.silent_errors, true));
  if (r.silent_omissions) parts.push(silentSection('SILENT OMISSIONS', omissionWhat(results), r.silent_omissions, false));
  parts.push(r.safeguard_failures.records === 0 ? 'SAFEGUARD FAILURES  none'
    : 'SAFEGUARD FAILURES  ' + r.safeguard_failures.detail.map(d => d.id + ' (' + d.types.join(', ') + ')').join('  ') +
      '\n  Critical, and a workflow bug even when the content is right: find the branch that routed these records\n' +
      '  and why it did not apply the check (SG-GATE: lead confidence below the gate; SG-FLOOR: a value below the floor was applied).\n' +
      '  If the answer key agrees with the record, the fix is a model that clears the threshold, not a lower threshold.');
  parts.push('UNNECESSARY REVIEWS  ' + list(r.review_queue.wasted) + (r.review_queue.wasted.length ? '   (sent to a person, but could have gone out)' : '') +
    (r.block && r.block.wrongly_blocked.length ? '\nWRONGLY BLOCKED  ' + list(r.block.wrongly_blocked) : ''));
  const CLASSES = ['auto', 'review', 'block', 'exclude'];
  const should = { auto: 0, review: 0, block: 0, exclude: 0 };
  for (const x of results.records) if (x.gold_class) should[x.gold_class]++;
  const routeRows = [['ROUTES', ...CLASSES.map(k => CLASS_LABELS[k])], ['  this run', ...CLASSES.map(k => r.by_class[k])]];
  if (results.records.some(x => x.gold_class)) routeRows.push(['  answer key', ...CLASSES.map(k => should[k])]);
  parts.push(table(routeRows, [1, 2, 3, 4], ''));
  parts.push(quality(results));
  const t = traps(results);
  if (t) parts.push(t);
  parts.push(calibration(results));
  if (r.not_measured.length) parts.push('NOT MEASURED\n' + r.not_measured.map(n => '  ' + n.what + ': ' + n.why).join('\n'));
  const notes = results.problems.filter(i => i.level !== 'stop');
  if (notes.length) parts.push('WARNINGS AND CLEAN-UPS\n' + notes.map(i => '  ' + i.level + ' [' + i.trap + '] ' + i.where + ': ' + i.message).join('\n'));
  return parts.join('\n\n') + '\n';
}

// ---------- Across runs ----------

const fmt = (v, unit) => (v === null ? 'n/a' : unit === 'points' ? v.toFixed(1) + '%' : unit === 'records' ? String(v) : v.toFixed(3));
const fmtDelta = (v, unit) => (v === null ? 'n/a' : (v > 0 ? '+' : '') + (unit === 'points' ? v.toFixed(1) + ' pts' : unit === 'records' ? String(v) : v.toFixed(3)));
const fmtSpread = (v, unit) => (v === null ? 'n/a' : unit === 'points' ? v.toFixed(1) + ' pts' : unit === 'records' ? v.toFixed(1) : v.toFixed(3));

function renderVariance(v) {
  const parts = ['VARIANCE  ' + v.runs.length + ' runs against ' + v.inputs.key];
  parts.push(v.runs.map((r, i) => '  run ' + (i + 1) + '  ' + r).join('\n'));
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
  const rc = v.records.route_changed;
  parts.push('RECORDS THAT CHANGED ROUTE  ' + (rc.length ? '' : 'none') +
    rc.map(r => '\n  ' + r.id.padEnd(8) + r.routes.join(' / ') + (r.should ? '   (should: ' + r.should + ')' : '')).join(''));
  const sc = v.records.silent_changed;
  parts.push('RECORDS THAT WERE SILENT ERRORS IN SOME RUNS ONLY  ' + (sc.length ? '' : 'none') +
    sc.map(r => '\n  ' + r.id.padEnd(8) + r.silent.map(s => (s ? 'silent' : 'ok')).join(' / ')).join(''));
  const gaps = v.records.key_gap_candidates;
  const every = gaps.filter(g => g.runs === g.of);
  const lines = ['POSSIBLE KEY GAPS  ' + (every.length
    ? 'stated in every run, not in the answer key: the same mistake every time, or a value the answer key is missing. A person decides which.'
    : 'none stated in every run')];
  const conf = c => (c === null ? '' : ' · confidence ' + (c.min === c.max ? c.min.toFixed(2) : c.min.toFixed(2) + '-' + c.max.toFixed(2)));
  for (const g of every) lines.push('  ' + g.id.padEnd(8) + g.output + '  ' + g.value + '   applied in ' + g.applied + ' of ' + g.of + conf(g.confidence));
  const some = gaps.length - every.length;
  if (some) lines.push('  ' + some + ' more stated in some runs only (listed in --json)');
  parts.push(lines.join('\n'));
  if (v.problems.length) parts.push('WARNINGS\n' + v.problems.map(i => '  [' + i.trap + '] ' + i.where + ': ' + i.message).join('\n'));
  return parts.join('\n\n') + '\n';
}

function renderCompare(c) {
  const parts = ['COMPARE  ' + c.inputs.before + '  ->  ' + c.inputs.after];
  parts.push(c.noise_runs ? 'noise baseline: ' + c.noise_runs.length + ' runs of identical code (' + c.noise_runs.join(', ') + ')'
    : 'no noise baseline: pass --noise with repeated runs of the unchanged workflow to tell a real change from run-to-run noise');
  const rows = [['metric', 'before', 'after', 'change', 'noise range', 'verdict']];
  for (const m of c.metrics) rows.push([m.name, fmt(m.before, m.unit), fmt(m.after, m.unit), fmtDelta(m.delta, m.unit), m.noise_range === null ? '' : fmtSpread(m.noise_range, m.unit), m.verdict]);
  parts.push(table(rows, [1, 2, 3, 4]));
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
  return parts.join('\n\n') + '\n';
}

// ---------- What-if ----------

const frac = r => (r === null ? 'n/a' : r.d === 0 ? 'none went out' : pct(r) + ' (' + r.n + '/' + r.d + ')');

function renderWhatif(w) {
  const parts = [];
  if (w.kind === 'gate') {
    parts.push('WHAT-IF: CONFIDENCE GATE  sweeping ' + w.outputs.join(', '));
    parts.push('Assumption: ' + w.assumption + '.');
    const rows = [['gate', 'went out', 'straight-through', 'silent errors', 'silent error rate', 'moved in', 'moved out', 'unnecessary reviews', '']];
    for (const r of w.rows) {
      rows.push([r.threshold.toFixed(2), r.through.length, pct(r.straight_through), list(r.silent_errors, 6), frac(r.silent_error_rate),
        list(r.moved_in, 6), list(r.moved_out, 6), r.wasted_reviews.length, r.current ? '<- current' : '']);
    }
    parts.push(table(rows, [1, 2]));
    if (w.check) {
      parts.push(w.check.differing.length === 0
        ? 'Check: at the current gate (' + w.check.threshold + ') the simulation reproduces the actual route of all ' + w.check.movable + ' movable records.'
        : 'CHECK FAILED: at the current gate (' + w.check.threshold + ') the simulation routes ' + w.check.differing.length + ' of ' + w.check.movable +
          ' movable records differently from the actual run (' + list(w.check.differing) + '). Those records were not routed by the gate alone: ' +
          'set whatif.movable_field so the what-if only moves records the gate decided.');
    }
    parts.push('Read the silent error COUNT beside the rate: a rate can fall because correct records joined the denominator, with no error prevented.');
  } else {
    parts.push('WHAT-IF: CONFIDENCE FLOOR');
    parts.push('Assumption: ' + w.assumption);
    const rows = [['floor', 'precision', 'recall', 'F1', 'TP/FP/FN', 're-admitted', 'evicted', 'routes moved', 'silent errors', 'needs replay', '']];
    for (const r of w.rows) {
      const o = r.overall;
      rows.push([r.floor.toFixed(2), o ? pct(o.precision) : 'n/a', o ? pct(o.recall) : 'n/a', o ? num(o.f1) : 'n/a', o ? o.tp + '/' + o.fp + '/' + o.fn : '',
        r.readmitted.length, r.evicted.length, list(r.moved, 4), frac(r.silent_error_rate), list(r.needs_replay, 6), r.current ? '<- current' : '']);
    }
    parts.push(table(rows, [1, 2, 3, 5, 6]));
  }
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

module.exports = { renderTerminal, renderVariance, renderCompare, renderWhatif, renderGrades };
