// The tuning half and the held-out half in the reports (config.split; traps O1-O26): one line saying
// which half the numbers are, and the held-out half: not looked at (the default: what a look would
// be), or, with --held-out, its summary (rates and likely ranges, never its records), the look it is
// at and the claims made on it. Sentences are wrapped to 100 columns; the held-out table has the same
// words as the HEADLINE table. The terminal and the HTML report say the same sentences.

const { pct, count, range, table, omissionWhat, thousands, sized, plural } = require('./format.js');

// Words wrapped to 100 columns, every line indented.
function wrap(text, indent = '  ', width = 100) {
  const out = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (indent + line + ' ' + word).length > width) { out.push(indent + line); line = word; } else line = line ? line + ' ' + word : word;
  }
  if (line) out.push(indent + line);
  return out.join('\n');
}

// A section's first line, with its header, and the lines after it indented: all within 100 columns.
function headed(text, width = 100) {
  const out = [];
  let line = '';
  for (const word of text.split(' ')) {
    const indent = out.length ? '  ' : '';
    if (line && (indent + line + ' ' + word).length > width) { out.push(indent + line); line = word; } else line = line ? line + ' ' + word : word;
  }
  if (line) out.push((out.length ? '  ' : '') + line);
  return out.join('\n');
}

// A share of the 5%, as a percentage: 2.5%, 1.25%, 0.625%, 0.313%.
const share = level => Number((level * 100).toPrecision(3)) + '%';
const percent = x => Number((x * 100).toPrecision(3)) + '%';
// A date as the reader's own calendar has it (split.log keeps the exact time, in UTC).
function localDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  const two = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
}
const ALLOWED = 'of the 5% allowed for being wrong';
const PROOF = 'Over all looks, a false "shown" stays under 5%: proven if no version tested was chosen by its held-out numbers; ' +
  'if one was, that held in simulation, not by proof.';
// Said once in each held-out section (trap O27): suspects leaves the held-out half out.
const KEY_NOTE = 'Its answer key has not been checked by suspects (suspects leaves the held-out half out): a wrong entry there reads as a ' +
  'silent error, or hides one. docs/CONFIG.md says how to check it before the first look, without looking.';

// How the halves were drawn, in words.
function howSplit(s) {
  const by = s.by === 'id' ? 'each record\'s own id' : 'each record\'s cluster, a duplicate\'s primary, or its id';
  return s.hash === 'crc32' ? 'odd CRC-32 checksums of ' + by + ' held out' : percent(s.held_out_share) + ' held out by a hash of ' + by + (s.salt ? ' (salt "' + s.salt + '")' : '');
}
// Whether this report lists the held-out records (--show-held-out).
const listsIds = s => Boolean(s.look && s.look.ids_shown);

// "SPLIT  The tuning half: 13 of 24 records. ..." What every other number in the report is.
function splitText(s, what = 'every other number in this report is the tuning half\'s') {
  const held = s.held_out.records;
  const all = s.tuning.records + held + (s.set_aside || 0) + (s.keys_apart || 0);
  const other = held === 1 ? 'The other record is held out' : 'The other ' + thousands(held) + ' records are held out';
  const how = ' from tuning (' + howSplit(s) + ')';
  const first = s.looked === false ? other + how + ', and not looked at here: every number in this report is the tuning half\'s.'
    : listsIds(s) ? other + how + ': its rates are under HELD-OUT HALF, and which of its records failed is listed too (--show-held-out). ' +
      what.charAt(0).toUpperCase() + what.slice(1) + '.'
      : other + how + ' and shown only as rates under HELD-OUT HALF, never which records: ' + what + '.';
  const extra = [];
  if (s.set_aside) extra.push(setAsideText(s.set_aside));
  if (s.keys_apart) extra.push(plural(s.keys_apart, 'record', 'records') + ' the two answer keys put in different halves ' + (s.keys_apart === 1 ? 'is' : 'are') + ' set aside, in neither half (--lenient).');
  const counted = heldOutRulingsCount(s.rulings && s.rulings.held_out);
  if (counted) extra.push('Rulings on held-out records: ' + counted + ' (counted, not listed; the bracket for pending rulings is the tuning half\'s).');
  return ['The tuning half: ' + thousands(s.tuning.records) + ' of ' + thousands(all) + ' records.', first, ...extra];
}
// Records that changed half since an earlier look, set aside with --lenient (trap O10).
const setAsideText = n => plural(n, 'record', 'records') + ' that changed half since an earlier look ' + (n === 1 ? 'is' : 'are') + ' set aside, in neither half (--lenient).';
// The rulings on held-out records, counted (split.rulings.held_out; trap O18): "0 added, 0 ruled not a
// gap, 1 pending", or null when there are none. removed, kept and replaced exist only when the rulings
// file uses suspects' verbs, and are named only when there are some.
function heldOutRulingsCount(r) {
  if (!r) return null;
  const verbs = [['added', 'added'], ['removed', 'removed'], ['replaced', 'replaced'], ['rejected', 'ruled not a gap'], ['kept', 'kept as the key has it'], ['pending', 'pending']]
    .filter(([k]) => r[k] !== undefined);
  if (verbs.reduce((t, [k]) => t + r[k], 0) + r.set_aside === 0) return null;
  return [...verbs.filter(([k]) => k === 'added' || k === 'rejected' || k === 'pending' || r[k] > 0).map(([k, words]) => r[k] + ' ' + words),
    ...(r.set_aside ? [r.set_aside + ' set aside'] : [])].join(', ');
}
function splitLine(s, what) {
  const [first, ...rest] = splitText(s, what);
  return 'SPLIT  ' + first + '\n' + rest.map(l => wrap(l)).join('\n');
}

// What the next look at the held-out half would be (split-log.js lookStatus), in words: for check,
// and for a report that did not look.
function nextLookWords(lk) {
  if (!lk.counted) return 'not counted: without split.log no look is counted, so no claim is made on the held-out half. Add "log": "split-log.json" to split in the config';
  if (!lk.exists) return 'none yet (' + lk.log + ' does not exist yet): the first look may use ' + share(lk.next.level) + ' ' + ALLOWED;
  const sofar = plural(lk.looks, 'look', 'looks') + ' at this held-out half so far (' + lk.log + ')';
  if (!lk.next) return sofar;
  if (lk.next.level === 0) return sofar + '; some of its records were listed at look ' + lk.next.listed_at + ' (--show-held-out), so a claim on the half can spend nothing now';
  return sofar + '; the next is look ' + lk.next.look + ', which may use ' + share(lk.next.level) + ' ' + ALLOWED;
}
// The held-out half not looked at (no --held-out): one line.
function notLookedLine(s) {
  if (s.not_looked) return 'HELD-OUT HALF  not looked at: ' + s.not_looked + ', so no look was spent.';
  const lk = s.next_look;
  const how = '--held-out looks at it, and counts as a look';
  if (!lk || !lk.counted) return 'HELD-OUT HALF  not looked at. ' + how + ' (without split.log, looks are not counted and no claim is made).';
  return 'HELD-OUT HALF  not looked at. ' + how + ': ' + nextLookWords(lk) + '.';
}

// The look this report is at (split-log.js). claims: whether this report can make a claim on the
// held-out half (score and whatif can; compare and variance only show).
function lookLines(lk, claims = true) {
  if (!lk.counted) {
    if (lk.reason === 'no_log') {
      return [claims ? 'Looks at the held-out half are not counted without split.log, so no claim is made on it: add "log": "split-log.json" to split in the config to make one.'
        : 'Looks at the held-out half are not counted without split.log: add "log": "split-log.json" to split in the config to count them.'];
    }
    return ['This look was not recorded in split.log' + (claims ? ', so no claim is made on it.' : '.')];
  }
  const lines = [];
  // The half's own look number (the looks that were at its records), and the log's when they differ.
  const where = lk.half.look !== lk.look ? 'look ' + lk.look + ' in ' + lk.log : (lk.repeat ? '' : 'counted in ') + lk.log;
  if (lk.repeat) {
    lines.push('Look ' + lk.half.look + ' at this held-out half again (' + where + '): the same command, files, config and mode as on ' + localDate(lk.repeat.date) +
      ', showing the same numbers, so it is not counted again.');
  } else if (lk.new_log) {
    lines.push('The first look at this held-out half: no log file was found at ' + lk.log + ', so a new one was started.');
  } else {
    lines.push('Look ' + lk.half.look + ' at this held-out half (' + where + ').' +
      (lk.half.look > 1 && lk.fresh ? ' ' + plural(lk.fresh, 'of its records is', 'of its records are') + ' new: no look before this one.' : ''));
  }
  if (lk.listed_at !== null && lk.half.level === 0) {
    lines.push('Some of its records were listed at look ' + lk.listed_at + ' (--show-held-out): anything fixed since could be fitted to them, so a claim on the half can spend nothing now.');
  } else if (!claims) {
    lines.push('It makes no claim, but it is a look: each look at the held-out half makes the next one\'s test stricter.');
  }
  return lines;
}

// The claim "shown under the target" on held-out records (split.js heldOutClaim). rate: the held-out
// silent error rate, to say when its likely range and the exact bound disagree. lookNo: the look this
// claim is at for these records. fresh: whether to point at fresh records (not for the newest batch).
function claimLines(c, rate, lookNo, what = 'the held-out half', fresh = true) {
  if (c.why === 'not_counted') return [];   // lookLines has said no claim is made
  if (c.why === 'nothing_out') return ['Under ' + c.target_pct + '%: nothing to show, with no record out without review.'];
  if (c.why === 'listed') return ['Not shown under ' + c.target_pct + '%: some of these records were listed, so this look has nothing left to spend.'];
  const lines = [c.shown
    ? 'Shown under ' + c.target_pct + '% on ' + what + ': its true silent error rate is at most ' + c.bound_pct + '%.'
    : 'Not yet shown under ' + c.target_pct + '%: with these records the true rate could still be as high as ' + c.bound_pct + '%.'];
  lines.push('Each look at the held-out half must pass a stricter test than the one before; this is look ' + lookNo + ', which may use ' + share(c.level) + ' ' + ALLOWED + '. ' + PROOF);
  if (!c.shown && rate && rate.high_pct !== null && rate.high_pct < c.target_pct) {
    lines.push('The likely range above is the usual 95% range (Wilson\'s, an approximation); the claim uses an exact bound, which is stricter at small counts.');
  }
  const need = 'It takes ' + sized(c.records_needed, 'records out without review') + ', none a silent error, at this look.';
  const above = c.rate_at_or_above ? ' The rate itself is at or above the target, too.' : '';
  if (c.why === 'too_few') {
    lines.push('Too few records: even with no silent error at all, ' + plural(c.tested, 'record', 'records') + ' out could not show it, even at a first look. ' + need + above);
  } else if (c.why === 'used_up') {
    lines.push('Used up for a ' + c.target_pct + '% target: a first look could have shown it with these ' + thousands(c.tested) + ' records, but at this look even no silent error would not. ' + need + above +
      (fresh ? ' Records added to the golden set later have had no look, and get a claim of their own.' : ''));
  } else if (c.rate_at_or_above) {
    lines.push('The rate itself is at or above the target.');
  }
  return lines;
}

// score's notes under the held-out numbers: the look, the claims, the newest batch, the kinds missing.
// The same sentences in the terminal and the HTML report.
function heldOutNotes(results) {
  const s = results.split;
  const notes = [];
  const sev = Object.entries(s.held_out.silent_errors.by_severity || {}).filter(([, n]) => n > 0).map(([v, n]) => v + ' ' + n);
  if (sev.length) notes.push('Silent errors by severity: ' + sev.join(' · ') + '.');
  if (s.held_out.model_calls_failed) notes.push(plural(s.held_out.model_calls_failed, 'model call', 'model calls') + ' failed in the held-out half.');
  notes.push(...lookLines(s.look));
  if (s.target) notes.push(...claimLines(s.target, s.held_out.silent_errors, s.look.half.look));
  if (s.batch) {
    const b = s.batch;
    notes.push('NEWEST RECORDS  ' + plural(b.records, 'held-out record', 'held-out records') + ' first shown at look ' + b.since + ' in the log; this is look ' + b.look +
      ' at them: a claim on them alone has its own 5%, and may use ' + (b.level === 0 ? 'nothing (some of them were listed)' : share(b.level)) + ' of it.');
    notes.push('Their silent error rate: ' + pct(b.held_out.silent_errors) + ' (' + count(b.held_out.silent_errors) + (range(b.held_out.silent_errors) ? ', likely ' + range(b.held_out.silent_errors) : '') + ').');
    if (b.target) notes.push(...claimLines(b.target, b.held_out.silent_errors, b.look, 'these records', false));
  }
  const none = s.balance.none_held_out;
  if (none.length) notes.push('The held-out half has no record of ' + none.map(x => x.dimension + ' "' + x.label + '" (' + plural(x.records, 'record', 'records') + ')').join(', ') + ': it cannot speak for ' + (none.length === 1 ? 'it' : 'them') + '.');
  notes.push(KEY_NOTE);
  return notes;
}

// The headline rows of the held-out half (split.js heldOutNumbers), in the HEADLINE table's words.
function numbersRows(h, omissions) {
  const rows = [];
  const row = (name, rate, what) => rows.push([name, rate, what]);
  row('Silent error rate', h.silent_errors, 'went out without review, but needed a person');
  row('Straight-through', h.straight_through, 'went out without review');
  if (h.silent_omissions) row('Silent omissions', h.silent_omissions, omissions);
  row('Review precision', h.review_precision, 'sent to a person, and needed one');
  if (h.block_precision) row('Block precision', h.block_precision, 'blocked, and the answer key agrees');
  return rows;
}
const SAFEGUARD_WHAT = 'went out past the workflow\'s own confidence gate or floor';
// The section's header, within 100 columns: what it counts, then what is shown of them (here), or
// with --show-held-out, that every record is listed further down.
const heldHeader = (s, what, here) => headed('HELD-OUT HALF  ' + what + ': ' +
  (listsIds(s) ? here.replace(/( only)?, never which records$/, '') + ' here; every record is listed under HELD-OUT HALF IN FULL (--show-held-out)' : here));

// score: the held-out half's summary, look and claims (results.split), or one line when not looked at.
function heldOutSection(results) {
  const s = results.split;
  if (s.looked === false) return headed(notLookedLine(s));
  const lines = [heldHeader(s, plural(s.held_out.records, 'record', 'records') + ' kept out of tuning', 'rates only, never which records')];
  if (s.held_out.records === 0) {
    lines.push(wrap('No record fell in the held-out half: there is nothing to check a choice on.'));
    return lines.join('\n');
  }
  const rows = [['', 'rate', 'count', 'likely range', 'what it counts'], ...numbersRows(s.held_out, omissionWhat(results)).map(([n, r, w]) => [n, pct(r), count(r), range(r), w]),
    ['Safeguard failures', '', s.held_out.safeguard_failures + ' record(s)', '', SAFEGUARD_WHAT]];
  lines.push(table(rows, [1, 2]));
  for (const l of heldOutNotes(results)) lines.push(wrap(l));
  return lines.join('\n');
}

// compare: the paired counts on the held-out half (results.split.held_out.paired), no ids.
function heldOutCompareSection(c) {
  const s = c.split;
  if (s.looked === false) return headed(notLookedLine(s));
  const p = s.held_out.paired;
  const signedPts = x => (x > 0 ? '+' : '') + x.toFixed(1);
  const change = o => (o.low_pct === null ? 'n/a' : (o.change > 0 ? '+' : '') + o.change + ' (likely ' + signedPts(o.low_pct) + ' to ' + signedPts(o.high_pct) + ' pts)');
  const rows = [['outcome', 'before', 'after', 'fixed', 'broke', 'change', 'verdict'], ...p.outcomes.map(o => [o.name, o.before, o.after, o.fixed, o.broke, change(o), o.verdict])];
  const head = heldHeader(s, 'the same ' + plural(p.records, 'held-out record', 'held-out records') + ', before and after', 'counts only, never which records');
  const lines = [head, table(rows, [1, 2, 3, 4])];
  for (const l of [...lookLines(s.look, false), KEY_NOTE]) lines.push(wrap(l));
  return lines.join('\n');
}

// variance: each run's held-out silent error rate, and the worst run (results.split.held_out).
function heldOutVarianceSection(v) {
  const s = v.split;
  if (s.looked === false) return headed(notLookedLine(s));
  const h = s.held_out;
  const lines = [heldHeader(s, plural(h.records, 'record', 'records') + ' kept out of tuning', 'each run\'s silent error rate, never which records')];
  lines.push(wrap(h.runs.map((r, i) => 'run ' + (i + 1) + ' ' + pct(r) + ' (' + count(r) + ')').join(' · ')));
  if (h.worst_run) {
    const w = h.worst_run;
    lines.push(wrap('The figure to quote for the held-out half is its worst run, run ' + w.run + ': ' + pct(w) + ' (' + count(w) + '; likely ' + range(w) + '), never the runs added together.'));
  }
  for (const l of [...lookLines(s.look, false), KEY_NOTE]) lines.push(wrap(l));
  return lines.join('\n');
}

// whatif: the gate or policy chosen on the tuning half, checked on the held-out half with --held-out
// (traps O16, O25).
function heldOutWhatifSection(w) {
  const s = w.split;
  if (!s.chosen) {
    return 'HELD-OUT HALF  not looked at: ' + (w.certification ? 'nothing was certified on the tuning half, so there is no choice to check.' : 'without --target nothing is chosen.');
  }
  const c = s.chosen;
  const name = c.name !== undefined ? 'policy "' + c.name + '"' : 'gate ' + c.threshold.toFixed(2);
  const tuning = pct(c.tuning_silent_errors) + ' (' + count(c.tuning_silent_errors) + ')';
  if (s.not_looked) {
    return headed('HELD-OUT HALF  not looked at: ' + s.not_looked + ', so no look was spent. The choice made on the tuning half is ' + name + ', certified there at a silent error rate of ' + tuning + '.');
  }
  if (!s.looked) {
    const lk = s.next_look;
    const next = !lk || !lk.counted ? ' (without split.log, looks are not counted and no claim is made).' : ': ' + nextLookWords(lk) + '.';
    return headed('HELD-OUT HALF  not looked at. The choice made on the tuning half is ' + name + ', certified there at a silent error rate of ' + tuning +
      '. To check it on the ' + plural(s.held_out.records, 'held-out record', 'held-out records') + ', run this again with --held-out, which counts as a look' + next);
  }
  const lines = [headed('HELD-OUT HALF  ' + name + ', chosen on the tuning half, tried on the ' + plural(s.held_out.records, 'held-out record', 'held-out records') +
    (listsIds(s) ? ' (its silent errors there are listed below: --show-held-out)' : ''))];
  const held = pct(c.silent_errors) + ' (' + count(c.silent_errors) + ')';
  lines.push(wrap('Silent error rate ' + pct(c.silent_errors) + ' (' + count(c.silent_errors) + ' out without review' + (range(c.silent_errors) ? ', likely ' + range(c.silent_errors) : '') +
    '); straight-through ' + pct(c.straight_through) + ' (' + count(c.straight_through) + ').'));
  for (const l of [...lookLines(s.look), ...claimLines(c.target, c.silent_errors, s.look && s.look.half ? s.look.half.look : null)]) lines.push(wrap(l));
  if (c.disagrees) {
    lines.push(wrap('The held-out half disagrees: the ' + name + ' was certified under ' + c.target.target_pct + '% on the tuning half, and on records it was not chosen on its silent error rate is ' +
      (c.silent_errors.low_pct >= c.target.target_pct ? 'wholly above' : 'at or above') + ' the target. The tuning half\'s certification flattered it.'));
  } else if (!c.target.shown && c.flattered) {
    lines.push(wrap('Not confirmed: on the held-out half it ran at ' + held + ', against ' + tuning + ' on the tuning half, below the held-out half\'s whole likely range: the tuning half flattered it.'));
  } else if (!c.target.shown && !['listed', 'not_counted', 'too_few', 'used_up', 'nothing_out'].includes(c.target.why)) {
    lines.push(wrap('Not confirmed at this look: on the held-out half it ran at ' + held + ', under the target, but these records cannot show it yet. That is not evidence against the choice.'));
  }
  if (c.silent_error_ids) {
    lines.push(wrap('Listed (--show-held-out' + (s.look && s.look.counted ? '; the log records the listing' : '') + '): the held-out silent errors there are ' +
      (c.silent_error_ids.length ? c.silent_error_ids.join(' ') : 'none') + '.'));
  }
  lines.push(wrap(KEY_NOTE));
  return lines.join('\n');
}

// whatif: the sweep is the tuning half's; what, if anything, the held-out half is used for.
function whatifSplitLine(w) {
  const s = w.split;
  const what = w.kind === 'policies' ? 'policy' : 'gate';
  const held = s.held_out.records;
  return 'SPLIT  Computed on the tuning half: ' + thousands(s.tuning.records) + ' of ' + thousands(s.tuning.records + held) + ' records.\n' +
    wrap((held === 1 ? 'The other record is held out' : 'The other ' + thousands(held) + ' records are held out') + ' (' + howSplit(s) + ') to check a choice made here: ' +
      (w.kind === 'floor' ? 'the floor what-if certifies nothing, so they are not shown.' :
        !w.certification ? 'with --target and --held-out, the loosest ' + what + ' certified on the tuning half is tried on them.' :
          s.looked ? 'the loosest ' + what + ' certified below is tried on them under HELD-OUT HALF (--held-out).' :
            'with --held-out, the loosest ' + what + ' certified below is tried on them; this report does not look at them.'));
}

// ---------- HTML ----------

// The split line, above the HTML report's headline.
function splitHtml(results, esc) {
  return '<p class="meta"><strong>Split.</strong> ' + splitText(results.split).map(esc).join('<br>') + '</p>';
}

// The held-out half in the HTML report: the same rows and sentences as the terminal's, escaped.
function heldOutHtml(results, esc) {
  const s = results.split;
  if (s.looked === false) return '<h2>Held-out half</h2>\n<p>' + esc(notLookedLine(s).replace(/^HELD-OUT HALF {2}not looked at([.:])/, 'Not looked at$1')) + '</p>';
  const out = ['<h2>Held-out half</h2>', '<p>' + esc(plural(s.held_out.records, 'record', 'records')) + ' kept out of tuning: ' +
    esc(listsIds(s) ? 'rates here, and the held-out silent errors listed below (--show-held-out).' : 'rates only, never which records.') + '</p>'];
  if (s.held_out.records > 0) {
    const cell = r => (r ? esc(pct(r)) + '<br><span class="muted">' + esc(count(r)) + (range(r) ? ' · likely ' + esc(range(r)) : '') + '</span>' : '');
    const rows = numbersRows(s.held_out, omissionWhat(results));
    out.push('<div class="table-wrap"><table><thead><tr><th></th><th class="num">Held-out half</th><th>What it counts</th></tr></thead><tbody>' +
      rows.map(([name, r, what]) => '<tr><td>' + esc(name) + '</td><td class="num">' + cell(r) + '</td><td>' + esc(what) + '</td></tr>').join('') +
      '<tr><td>Safeguard failures</td><td class="num">' + esc(s.held_out.safeguard_failures) + '</td><td>' + esc(SAFEGUARD_WHAT) + '</td></tr>' +
      '</tbody></table></div>');
    out.push('<p>' + heldOutNotes(results).map(esc).join('<br>') + '</p>');
  }
  if (s.held_out_report) {
    const se = s.held_out_report.routing.silent_errors.records;
    out.push('<p>Listed with --show-held-out: the held-out silent errors are ' + (se.length ? se.map(x => '<code>' + esc(x.id) + '</code>').join(', ') : 'none') + '.</p>');
  }
  return out.join('\n');
}

module.exports = {
  splitLine, splitText, heldOutSection, heldOutCompareSection, heldOutVarianceSection, heldOutWhatifSection, whatifSplitLine, heldOutHtml, splitHtml,
  heldOutNotes, lookLines, claimLines, wrap, howSplit, setAsideText, heldOutRulingsCount, nextLookWords, notLookedLine, localDate,
};
