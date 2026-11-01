// wfeval monitor: live samples over time. Reads the periods (run files scored with the config, or
// a counts file scored elsewhere), checks them (test/TRAPS.md, section L), and hands the counts to
// the arithmetic in metrics/monitor.js. Returns one results object for the terminal and JSON.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { problems } = require('./problems.js');
const { scoreRun } = require('./score.js');
const { csvToRecords } = require('./csv.js');
const { monitorSeries } = require('./metrics/monitor.js');
const { rate } = require('./metrics/stats.js');

const fingerprint = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// The largest period may hold this many times the smallest's records before L7 warns.
const UNEVEN = 4;

// One period from each run file: scored exactly as `score` would score it, with the answers in
// the same file (the key path is the predictions path, as the golden-set files do). Named after
// the file: 2026-W41.json is period "2026-W41".
// keysDir: a folder holding each period's answer key in a file of the same name as its period
// file (weeks/2026-W41.json is answered by keys/2026-W41.json), for teams that keep the person's
// answers apart from the workflow's output; null when the answers are in the period files.
function readRuns(config, runPaths, mode, p, keysDir = null) {
  const seen = new Map();      // content -> file (L2)
  const checked = new Map();   // record id -> period that checked it (L9)
  const periods = [];
  const perfect = [];          // A8 notes: every answer the same as the output
  const notOut = [];           // L17: checked records that did not go out without review, per period
  // --keys must be a folder: checked once, not once per period file.
  if (keysDir !== null && !(fs.existsSync(keysDir) && fs.statSync(keysDir).isDirectory())) {
    p.stop('A1', path.normalize(keysDir), (fs.existsSync(keysDir) ? 'is a file: ' : 'does not exist: ') + '--keys must be a folder holding a key file of the same name for each period file');
    return [];
  }
  // Key files matched to period files by name, without regard to case (Windows ignores case,
  // Linux does not: the same folder must give the same answer on both).
  let keyFiles = null;
  if (keysDir !== null) {
    keyFiles = new Map();
    for (const f of fs.readdirSync(keysDir).filter(f => fs.statSync(path.join(keysDir, f)).isFile())) {
      const k = f.toLowerCase();
      if (keyFiles.has(k)) { p.stop('A1', path.normalize(keysDir), 'holds key files whose names differ only by case: ' + keyFiles.get(k) + ' and ' + f); continue; }
      keyFiles.set(k, f);
    }
    const wanted = new Set(runPaths.map(f => path.basename(f).toLowerCase()));
    const extra = [...keyFiles].filter(([k]) => !wanted.has(k)).map(([, f]) => f);
    if (extra.length) p.warn('A1', path.normalize(keysDir), extra.length + ' key file(s) match no period file: ' + extra.slice(0, 12).join(', ') + (extra.length > 12 ? ', ...' : '') + '. Their periods are not in this report.');
  }
  for (const file of runPaths) {
    const h = fingerprint(file);
    if (seen.has(h)) { p.stop('L2', file, 'has the same content as ' + seen.get(h) + ': the same period given twice would count its records twice'); continue; }
    seen.set(h, file);
    const match = keyFiles === null ? null : keyFiles.get(path.basename(file).toLowerCase());
    const keyPath = keysDir === null ? file : path.join(keysDir, match || path.basename(file));
    // Both paths in the system's own style (path.normalize), never a mix of \ and /.
    if (keysDir !== null && !match) { p.stop('A1', path.normalize(keyPath), 'no answer key for period file ' + path.normalize(file) + ' (--keys looks for a file of the same name)'); continue; }
    const results = scoreRun({ config, predPath: file, keyPath, mode });
    const name = path.basename(file, path.extname(file));
    const notes = results.problems.filter(i => i.level !== 'stop');
    perfect.push(...notes.filter(i => i.trap === 'A8'));
    p.items.push(...notes.filter(i => i.trap !== 'A8'));
    const again = [];
    for (const r of results.records.filter(x => x.route_class === 'auto')) {
      if (checked.has(r.id)) again.push('"' + r.id + '" (also in ' + checked.get(r.id) + ')');
      else checked.set(r.id, name);
    }
    if (again.length) {
      p.strict('L9', file, 'checks records already checked in an earlier period: ' + again.slice(0, 10).join(', ') + (again.length > 10 ? ' and ' + (again.length - 10) + ' more' : '') +
        '. A record counted twice is evidence counted twice.');
    }
    const se = results.routing.silent_errors.rate;
    const held = results.records.filter(x => x.route_class !== 'auto').length;
    if (held) notOut.push({ name, held });
    periods.push({ period: name, file, out: se.d, silent: se.n });
  }
  // L17: the rate's base is the records out without review; the others checked are left out, and said so.
  if (notOut.length) {
    const total = notOut.reduce((t, x) => t + x.held, 0);
    p.warn('L17', 'period files', total + ' checked record(s) did not go out without review (sent to a person, blocked or suppressed) and are not part of the silent error rate: ' +
      notOut.slice(0, 12).map(x => x.name + ' ' + x.held).join(', ') + (notOut.length > 12 ? ', ...' : '') + '.');
  }
  // A8 warns when every answer matches the output exactly. In a scorecard, one perfect week is
  // normal; every week perfect suggests the answers were copied from the outputs, so it is
  // reported only then.
  if (perfect.length > 1 && perfect.length === runPaths.length) p.items.push(...perfect);
  return periods;
}

// A counts file: one row per period, in time order, with
//   period              the period's name (2026-W41, 2026-10, 2026-10-05, week-12)
//   out_without_review  records out without review that were checked
//   silent_errors       silent errors among them
//   scored_with         (optional) what scored them, e.g. "config v3": every period counted must say the same
// as a JSON list of objects, or a CSV file (.csv) with those column names.
function readCounts(file, p) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { p.stop('A1', file, 'cannot read the counts file: ' + e.message); return []; }
  if (text.charCodeAt(0) === 0xFEFF) {   // A3: Windows PowerShell starts files with a byte-order mark
    text = text.slice(1);
    p.fix('A3', file, 'removed an invisible byte-order mark from the start of the file');
  }
  let rows;
  if (path.extname(file).toLowerCase() === '.csv') {
    const delimiter = csvDelimiter(text, file, p);
    if (delimiter === null) return [];
    rows = csvToRecords(text, file, p, delimiter);
    if (!columnsPresent(rows, text, delimiter, file, p)) return [];
  } else {
    try { rows = JSON.parse(text); } catch (e) { p.stop('L5', file, 'is not valid JSON: ' + e.message); return []; }
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    p.stop('L5', file, 'holds no periods: a counts file is a list of periods, each with period, out_without_review and silent_errors');
    return [];
  }
  rows = Array.isArray(rows) ? looseNames(rows, file, p) : rows;
  const whole = (v, csv) => (csv ? (/^\s*\d+\s*$/.test(String(v)) ? Number(v) : NaN) : Number.isInteger(v) && v >= 0 ? v : NaN);
  const csv = path.extname(file).toLowerCase() === '.csv';
  const periods = [];
  rows.forEach((row, i) => {
    const name = row && row.period !== undefined && row.period !== null ? String(row.period).trim() : '';
    const where = file + ' ' + (name ? 'period "' + name + '"' : 'row ' + (i + 1));
    if (!row || typeof row !== 'object') { p.stop('L5', where, 'is not a row with period, out_without_review and silent_errors'); return; }
    if (!name) { p.stop('L5', where, 'has no period name'); return; }
    let ok = true;
    for (const col of ['out_without_review', 'silent_errors']) {
      if (row[col] === undefined || row[col] === '') { p.stop('L5', where, 'has no ' + col); ok = false; continue; }
      if (Number.isNaN(whole(row[col], csv))) { p.stop('L5', where, col + ' must be a whole number of 0 or more, got ' + JSON.stringify(row[col])); ok = false; }
    }
    if (!ok) return;
    const out = whole(row.out_without_review, csv), silent = whole(row.silent_errors, csv);
    if (silent > out) { p.stop('L5', where, 'has more silent errors (' + silent + ') than records out without review (' + out + ')'); return; }
    const sw = row.scored_with === undefined || String(row.scored_with).trim() === '' ? '(not given)' : String(row.scored_with).trim();
    periods.push({ period: name, out, silent, scored_with: sw });
  });
  return periods;
}

// L15: the delimiter, read from the header row: commas, ";" (Excel in many countries) or tabs.
// null after a stop when the header mixes them.
function csvDelimiter(text, file, p) {
  const header = text.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '');
  const used = [[',', 'commas'], [';', '";"'], ['\t', 'tabs']].map(([d, name]) => ({ d, name, n: header.split(d).length - 1 })).filter(c => c.n > 0);
  if (used.length > 1) {
    p.stop('L15', file, 'the header row has ' + used.map(c => c.n + ' ' + c.name).join(' and ') + ': cannot tell which one splits the columns. Use one of them throughout');
    return null;
  }
  if (used.length === 1 && used[0].d !== ',') p.fix('L15', file, 'the columns are split by ' + used[0].name + ', and were read that way');
  return used.length ? used[0].d : ',';
}

// L15: column names read loosely: "Out Without Review" and "silent-errors" are out_without_review
// and silent_errors. Returns the rows with their names normalized, and says which were.
const looseName = k => String(k).trim().toLowerCase().replace(/[\s-]+/g, '_');
function looseNames(rows, file, p) {
  const renamed = new Map();
  const out = rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const r = {};
    for (const [k, v] of Object.entries(row)) {
      const n = looseName(k);
      if (n !== k) renamed.set(k, n);
      r[n] = v;
    }
    return r;
  });
  if (renamed.size) p.fix('L15', file, 'read the column names ' + [...renamed].map(([a, b]) => '"' + a + '" as ' + b).join(', '));
  return out;
}

// L15: a required column missing from a CSV header is one problem, named once, not one per row.
function columnsPresent(rows, text, delimiter, file, p) {
  const found = text.split(/\r?\n/, 1)[0].split(delimiter).map(c => looseName(c.replace(/^"|"$/g, ''))).filter(Boolean);
  const missing = ['period', 'out_without_review', 'silent_errors'].filter(c => !found.includes(c));
  if (!missing.length) return true;
  p.stop('L15', file, 'has no ' + missing.join(' or ') + ' column. Columns found: ' + found.join(', ') + '; expected: period, out_without_review, silent_errors (and scored_with, optional)');
  return false;
}

// L6: every period must be scored the same way: the bound counts them all, whatever --since says.
// A change in the scoring starts a new list of periods.
function checkScoredWith(periods, file, p) {
  const ways = new Map();
  for (const x of periods) if (x.scored_with !== undefined && !ways.has(x.scored_with)) ways.set(x.scored_with, x.period);
  if (ways.size < 2) return;
  p.stop('L6', file, 'mixes periods scored different ways: ' + [...ways].map(([sw, first]) => '"' + sw + '" (first ' + first + ')').join(', ') +
    '. A rise could then come from a change in the scoring, not the workflow. Rescore them alike, or start a new list of periods at the first period scored the new way.');
}

// The time order, read from the names: a date (2026-10-05), a month (2026-10), an ISO week
// (2026-W41), or a number after the same text (week-2, week-10: compared as numbers).
function orderKey(name) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(name)) return { kind: 'day', key: name };
  if (/^\d{4}-\d{2}$/.test(name)) return { kind: 'month', key: name };
  if (/^\d{4}-W\d{2}$/.test(name)) return { kind: 'week', key: name };
  const m = /^(.*?)(\d+)(\D*)$/.exec(name);
  return m ? { kind: 'number ' + m[1] + '#' + m[3], key: Number(m[2]) } : null;
}

// sort: run files, whose order a shell's glob chose (week-10 before week-2). When every name gives
// the order, they are put in it, with a note; a counts file's rows are written in an order on
// purpose, so a row out of place there stops.
function checkOrder(periods, where, p, sort = false) {
  const names = new Map();
  for (const x of periods) {
    if (names.has(x.period)) p.stop('L2', where, 'period "' + x.period + '" is given twice');
    names.set(x.period, true);
  }
  if (periods.length < 2) return periods;
  const keys = periods.map(x => orderKey(x.period));
  if (keys.some(k => k === null) || new Set(keys.map(k => k.kind)).size > 1) {
    p.strict('L1', where, 'the time order cannot be read from the period names (' + periods.slice(0, 3).map(x => '"' + x.period + '"').join(', ') + (periods.length > 3 ? ', ...' : '') +
      '). Name each period by its date (2026-10-05), month (2026-10), week (2026-W41) or number (week-12), all the same way, so a period out of order is caught. --lenient takes the order given.');
    return periods;
  }
  // Sorted only when the order given is plain text order, the order a shell's glob produces
  // (week-1, week-10, week-2): any other order was chosen by someone, and out of time it stops.
  const given = periods.map(x => x.period);
  const asText = given.join('\n');
  const textOrder = [...given].sort().join('\n') === asText || [...given].sort((a, b) => a.localeCompare(b)).join('\n') === asText;
  if (sort && textOrder && keys.some((k, i) => i > 0 && k.key < keys[i - 1].key)) {
    const order = periods.map((x, i) => i).sort((a, b) => (keys[a].key < keys[b].key ? -1 : keys[a].key > keys[b].key ? 1 : a - b));
    p.fix('L1', where, 'the period files were given out of order; sorted by their names: ' +
      order.slice(0, 12).map(i => periods[i].period).join(', ') + (order.length > 12 ? ', ...' : ''));
    return checkOrder(order.map(i => periods[i]), where, { ...p, fix: () => {} }, false);
  }
  for (let i = 1; i < keys.length; i++) {
    if (keys[i].key === keys[i - 1].key) p.stop('L2', where, 'periods "' + periods[i - 1].period + '" and "' + periods[i].period + '" are the same period');
    else if (keys[i].key < keys[i - 1].key) {
      p.stop('L1', where, 'period "' + periods[i].period + '" comes after ' + periods[i - 1].period + ' in the input but is earlier: give the periods in time order');
    }
  }
  return periods;
}

// target, acceptable, alarming: percentages (5 means 5%), as the command line takes them.
// since: the name of the period the alarm restarts at (after an alarm was looked into), or null;
// the bound always counts every period. periodSize: the period size the alarm level is set for,
// or null for the median of the periods so far.
function monitorRun({ config = null, runPaths = [], countsPath = null, keysDir = null, target = null, acceptable = null, alarming = null, falseAlarmEvery = 2000, since = null, periodSize = null, lenient = false }) {
  const mode = lenient ? 'lenient' : 'strict';
  if (target === null && acceptable === null) {
    throw new Error('monitor needs --target <percent> (to show the rate is under it) or --acceptable <percent> (the rate it normally runs at), or both');
  }
  for (const [flag, v] of [['--target', target], ['--acceptable', acceptable], ['--alarming', alarming]]) {
    if (v !== null && !(typeof v === 'number' && v > 0 && v < 100)) throw new Error(flag + ' must be a percentage above 0 and below 100, got ' + JSON.stringify(v));
  }
  if (periodSize !== null && !(Number.isInteger(periodSize) && periodSize >= 1)) throw new Error('--period-size must be a whole number of records, 1 or more, got ' + JSON.stringify(periodSize));
  // Defaults: the acceptable rate is half the target; the alarming rate is double the acceptable
  // rate (so the target itself when only --target is given). docs/METRICS.md says why.
  const p0 = acceptable !== null ? acceptable : target / 2;
  const p1 = alarming !== null ? alarming : 2 * p0;
  const p = problems(mode);
  // L16: options are percentages. 0.05 means 0.05%: someone who meant 5% would see nothing odd.
  // Only where a fraction was plausibly meant: a value of 0.5 or less, read as a fraction, would be
  // a rate of 50% or less, a sensible setting; 0.7 as a fraction would be 70%, which no one sets,
  // so it was meant as 0.7%. --acceptable and --alarming are not flagged when --target is under 1
  // too: the settings are consistently in small percentages.
  const plausible = (flag, v) => v <= 0.5 && (flag === '--target' || target === null || target >= 1);
  for (const [flag, v] of [['--target', target], ['--acceptable', acceptable], ['--alarming', alarming]]) {
    if (v !== null && plausible(flag, v)) p.warn('L16', flag, flag + ' ' + v + ' is read as a percentage: ' + v + ' means ' + v + '%, not ' + Number((v * 100).toPrecision(12)) + '%');
  }
  if (target !== null && target <= p0) {
    p.stop('L4', 'settings', 'the target (' + target + '%) must be above the acceptable rate (' + p0 + '%): a workflow that runs at the target can never be shown under it');
  }
  if (p1 <= p0) p.stop('L4', 'settings', 'the alarming rate (' + p1 + '%) must be above the acceptable rate (' + p0 + '%): the alarm watches for a rise from one to the other');
  if (p1 >= 100) p.stop('L4', 'settings', 'the alarming rate (' + p1 + '%, double the acceptable rate unless --alarming says otherwise) must be below 100%');
  if (runPaths.length && countsPath) {
    p.stop('L6', countsPath, 'given with period files: one series is scored one way. Give run files (scored here with --config) or --counts (scored elsewhere), not both');
  }
  if (keysDir !== null && countsPath) p.stop('L6', '--keys', '--keys goes with period files: a counts file has no answer keys to read');
  p.throwIfStopped();
  if (!runPaths.length && !countsPath) throw new Error('monitor needs period files (with --config), in time order, or --counts <file>');
  if (runPaths.length && !config) throw new Error('monitor needs --config <file> to score the period files');

  let periods = countsPath ? readCounts(countsPath, p) : readRuns(config, runPaths, mode, p, keysDir);
  periods = checkOrder(periods, countsPath || 'period files', p, !countsPath);
  for (const x of periods) {
    if (x.out === 0) p.warn('L3', x.file || (countsPath + ' period "' + x.period + '"'), 'no records out without review were checked in this period: it adds nothing to either check, and its rate is not measured');
  }
  let from = 0;
  if (since !== null) {
    from = periods.findIndex(x => x.period === since);
    if (from < 0) p.stop('L8', '--since', 'no period is named "' + since + '"; the periods are ' + periods.map(x => x.period).slice(0, 12).join(', ') + (periods.length > 12 ? ', ...' : ''));
  }
  if (countsPath) checkScoredWith(periods, countsPath, p);
  const sizes = periods.filter(x => x.out > 0).map(x => x.out);
  if (sizes.length && Math.max(...sizes) > UNEVEN * Math.min(...sizes)) {
    p.warn('L7', countsPath || 'period files', 'the periods range from ' + Math.min(...sizes) + ' to ' + Math.max(...sizes) + ' records out without review. ' +
      'Both checks weigh every record the same, so a big period counts for more than a small one; the false-alarm figure is for periods of the median size (or --period-size), and smaller ones false-alarm more often. ' +
      'If a different share of each period\'s records was checked, the records checked do not stand for the periods equally.');
  }
  p.throwIfStopped();
  const series = monitorSeries(periods, { acceptable: p0 / 100, alarming: p1 / 100, target: target === null ? null : target / 100, falseAlarmEvery, from, periodSize });
  series.settings.acceptable_given = acceptable !== null;
  baselineNote(series, p0, p);
  return {
    kind: 'monitor',
    inputs: { ...(countsPath ? { counts: countsPath } : { runs: runPaths, ...(keysDir !== null ? { keys: keysDir } : {}) }), mode, ...(since !== null ? { since } : {}) },
    ...series,
    problems: p.items,
  };
}

// L18: the acceptable rate may be set too low for this workflow. Two signs:
// - the alarm dates the rise to the first or second period counted: there is no calm stretch
//   before it to rise from, so the "rise" may only be the workflow's normal rate;
// - or the periods before the alarm (all of them, with no alarm) run clearly above the
//   acceptable rate: their whole likely range is above it.
// Either way the report suggests --acceptable at the rate those periods ran at.
function baselineNote(series, p0, p) {
  const rows = series.periods.filter(r => r.counted);
  const alarm = series.detector.alarm_since === null ? -1 : rows.findIndex(r => r.period === series.detector.alarm_since);
  const rise = series.detector.rise_started === null ? -1 : rows.findIndex(r => r.period === series.detector.rise_started);
  const early = alarm >= 0 && rise <= 1;
  const used = rows.slice(0, alarm >= 0 ? alarm : rows.length);   // the alarm period itself is the rise's, not the normal rate's
  const n = used.reduce((t, r) => t + r.rate.n, 0), d = used.reduce((t, r) => t + r.rate.d, 0);
  if (d === 0) return;
  const r = rate(n, d);
  if (!early && !(r.low_pct > p0)) return;
  // The early sign is a hint, not a measurement, but it needs a rate worth the name: at least 3
  // silent errors before the alarm (1 of 300 is no evidence of a normal rate above 0.2%).
  if (early && !(r.pct > p0 && n >= 3)) return;
  const span = used[0].period + (used.length > 1 ? ' to ' + used[used.length - 1].period : '');
  p.warn('L18', 'settings', (early ? 'the rise is dated to ' + series.detector.rise_started + ', at the start: there is no calm stretch before it to rise from. The periods ' + span + ', before the alarm, ran at '
    : 'the periods ' + span + (alarm >= 0 ? ', before the alarm,' : '') + ' ran at ') +
    r.pct.toFixed(1) + '% (likely ' + r.low_pct.toFixed(1) + '-' + r.high_pct.toFixed(1) + '%)' + (early ? ', above' : ', clearly above') + ' the acceptable rate (' + p0 + '%). ' +
    'The alarm may only be saying the workflow runs above it, and date the rise too early. If ' + r.pct.toFixed(1) + '% is its normal rate, set --acceptable ' + r.pct +
    ' (better: the rate measured before launch, from score on a golden set or the first weeks).');
}

module.exports = { monitorRun };
