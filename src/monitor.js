// wfeval monitor: live samples over time. Reads the periods (run files scored with the config, or
// a counts file scored elsewhere), checks them (test/TRAPS.md, section L), and hands the counts to
// the arithmetic in metrics/monitor.js. Returns one results object for the terminal and JSON.
// The series watched is the records out without review, or with --watch silent-omissions the
// records blocked or suppressed; with --segment-by, each segment gets its own series too.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { problems } = require('./problems.js');
const { scoreRun } = require('./score.js');
const { csvToRecords } = require('./csv.js');
const { addGroupBy } = require('./config.js');
const { declineOutputs } = require('./metrics/judge.js');
const { NONE } = require('./metrics/traps.js');
const { monitorSeries, monitorSegments, SERIES } = require('./metrics/monitor.js');
const { rate } = require('./metrics/stats.js');

const fingerprint = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// The largest period may hold this many times the smallest's records before L7 warns.
const UNEVEN = 4;

// L20: the records left out (blocked, or suppressed as a duplicate) whose omission the answer key
// can judge, each judged as score judges a silent omission (src/metrics/judge.js): with a correct
// route (routing.gold_field), every one; without one, only a blocked record whose label was
// declined, on an output that may decline, where the key gives that label (SO-DECLINED: the key's
// answer says whether something was lost). Returns (record summary, paired record) -> true or
// false, or null after a stop, when nothing left out could be judged.
function omissionBase(config, p) {
  const classes = Object.values(config.routing.map);
  if (!classes.includes('block') && !classes.includes('exclude')) {
    p.stop('L20', '--watch silent-omissions', 'the workflow never blocks or suppresses a record (routing.map has no block or exclude route): there is nothing left out to watch');
    return null;
  }
  if (config.routing.gold_field !== null) return r => r.route_class === 'block' || r.route_class === 'exclude';
  const names = declineOutputs(config);
  if (!names.length) {
    p.stop('L20', '--watch silent-omissions', 'the answer key has no correct route (routing.gold_field), so nothing says whether a record left out should have gone out or to a person. ' +
      'Add the correct route to the answer key, or give a label that may decline (outputs.<name>.decline)');
    return null;
  }
  return (r, paired) => r.route_class === 'block' && names.some(n => paired.pred[n] && paired.pred[n].declined && paired.key[n] !== null && paired.key[n] !== undefined);
}

// --segment-by for run files: a group the config names (groups.<name>), read as declared, or else a
// field read from the answer key, as score --group-by reads it (config.js addGroupBy). Returns the
// config to score with, and the group's name, field and side.
function segmentGroup(config, segmentBy) {
  if (config.groups[segmentBy]) return { config, name: segmentBy, ...config.groups[segmentBy], declared: true };
  return { config: addGroupBy(config, [segmentBy]), name: segmentBy, field: segmentBy, from: 'key', declared: false };
}

// One period from each run file: scored exactly as `score` would score it, with the answers in
// the same file (the key path is the predictions path, as the golden-set files do). Named after
// the file: 2026-W41.json is period "2026-W41".
// keysDir: a folder holding each period's answer key in a file of the same name as its period
// file (weeks/2026-W41.json is answered by keys/2026-W41.json), for teams that keep the person's
// answers apart from the workflow's output; null when the answers are in the period files.
// watch: the series (SERIES): silent errors among the records out without review, or silent
// omissions among the records blocked or suppressed. segment: segmentGroup's, or null; then each
// period also carries segments: label -> { out, silent }, a record with no label in "(none)" (H1)
// and one with several in each (H7); info.several counts those.
function readRuns(config, runPaths, mode, p, keysDir = null, watch = 'silent-errors', segment = null, info = {}) {
  const seen = new Map();      // content -> file (L2)
  const checked = new Map();   // record id -> period that checked it (L9)
  const periods = [];
  const perfect = [];          // A8 notes: every answer the same as the output
  const notOut = [];           // L17: checked records that did not go out without review, per period
  const omissions = watch === 'silent-omissions';
  const judgeable = omissions ? omissionBase(config, p) : null;
  if (omissions && judgeable === null) return [];
  const unjudged = [];         // L20: records left out that the key cannot judge, per period
  let labelled = 0, several = 0;   // L23: records with a segment value at all; L22: with several
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
    let results;
    try {
      results = scoreRun({ config: segment ? segment.config : config, predPath: file, keyPath, mode });
    } catch (e) {
      // L35: a run file without its answers (the key in a file of its own) stops at A8, which names
      // key_field. In monitor the usual cause is a key kept apart: say how to give it.
      if (keysDir === null && /predictions and answers come from the same file and the same fields/.test(e.message)) {
        e.message += '\n  monitor reads each period file as the run and its answer key at once. When the answers are in a file of their own, ' +
          'put the key in a folder under the same name as the period file (keys/2026-W41.json for 2026-W41.json) and add --keys <that folder>.';
      }
      throw e;
    }
    const name = path.basename(file, path.extname(file));
    const notes = results.problems.filter(i => i.level !== 'stop');
    perfect.push(...notes.filter(i => i.trap === 'A8'));
    p.items.push(...notes.filter(i => i.trap !== 'A8'));
    const paired = new Map(results.paired.map(r => [r.id, r]));
    // The series' base: the records out without review, or the records left out the key can judge.
    const inBase = omissions ? r => judgeable(r, paired.get(r.id)) : r => r.route_class === 'auto';
    const base = results.records.filter(inBase);
    const again = [];
    for (const r of base) {
      if (checked.has(r.id)) again.push('"' + r.id + '" (also in ' + checked.get(r.id) + ')');
      else checked.set(r.id, name);
    }
    if (again.length) {
      p.strict('L9', file, 'checks records already checked in an earlier period: ' + again.slice(0, 10).join(', ') + (again.length > 10 ? ' and ' + (again.length - 10) + ' more' : '') +
        '. A record counted twice is evidence counted twice.');
    }
    const se = results.routing.silent_errors.rate;
    const leftOut = r => r.route_class === 'block' || r.route_class === 'exclude';
    const held = results.records.filter(x => (omissions ? !leftOut(x) : x.route_class !== 'auto')).length;
    if (held) notOut.push({ name, held });
    const row = omissions ? { period: name, file, out: base.length, silent: base.filter(r => r.omission).length } : { period: name, file, out: se.d, silent: se.n };
    if (omissions) {
      const n = results.records.filter(r => leftOut(r) && !inBase(r)).length;
      if (n) unjudged.push({ name, n });
    }
    if (segment) {
      row.segments = new Map();
      row.memberships = 0;   // L36: more than the records when a record is in several segments
      for (const r of results.paired) if (paired.get(r.id).groups[segment.name].length) labelled++;
      for (const r of base) {
        const labels = paired.get(r.id).groups[segment.name];
        if (labels.length > 1) several++;
        row.memberships += Math.max(1, labels.length);
        for (const label of labels.length ? labels : [NONE]) {
          const c = row.segments.get(label) || { out: 0, silent: 0 };
          c.out++;
          if (omissions ? r.omission : r.silent) c.silent++;
          row.segments.set(label, c);
        }
      }
    }
    periods.push(row);
  }
  // L17: the rate's base is the records out without review; the others checked are left out, and said so.
  if (notOut.length) {
    const total = notOut.reduce((t, x) => t + x.held, 0);
    const list = notOut.slice(0, 12).map(x => x.name + ' ' + x.held).join(', ') + (notOut.length > 12 ? ', ...' : '') + '.';
    if (omissions) p.warn('L17', 'period files', total + ' checked record(s) were not blocked or suppressed (went out without review or sent to a person) and are not part of the share wrongly left out: ' + list);
    else p.warn('L17', 'period files', total + ' checked record(s) did not go out without review (sent to a person, blocked or suppressed) and are not part of the silent error rate: ' + list);
  }
  if (unjudged.length) {
    p.warn('L20', 'period files', unjudged.reduce((t, x) => t + x.n, 0) + ' checked record(s) blocked or suppressed cannot be judged without a correct route in the answer key (routing.gold_field), and are not counted in the share wrongly left out: ' +
      'only a blocked record whose label was declined can be (the key says whether it had an answer): ' + unjudged.slice(0, 12).map(x => x.name + ' ' + x.n).join(', ') + (unjudged.length > 12 ? ', ...' : '') + '.');
  }
  // L23: a field no record has (a typo) would put every record in "(none)", one segment that is the whole.
  if (segment && periods.length && labelled === 0) {
    p.stop('L23', '--segment-by', '"' + segment.name + '": no record in the period files has a value there, so every record would be in "(none)", one segment that is the whole. ' +
      (segment.declared ? 'It is the config\'s group "' + segment.name + '", read from the ' + (segment.from === 'key' ? 'answer key' : 'predictions') + ' field "' + segment.field + '"'
        : 'It is read from the answer key (the period files, when the answers are in them), as score --group-by reads it; to read the predictions instead, name a group in the config\'s groups'));
  }
  info.several = several;
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
// With --watch silent-omissions, the columns counted are instead (L21)
//   blocked_or_suppressed  records blocked or suppressed as a duplicate that were checked
//   silent_omissions       silent omissions among them
// and with --segment-by <column>, one row per period and segment: the whole is the segments added
// up (L26, L27). info.segment_column is then that column's name. Without --segment-by a segment
// column is not read (L29).
// The columns a counts file counts with (and scored_with): none of them can be a segment.
const COUNTED = ['out_without_review', 'silent_errors', 'blocked_or_suppressed', 'silent_omissions', 'scored_with'];
const COUNT_COLUMNS = { 'silent-errors': ['out_without_review', 'silent_errors'], 'silent-omissions': ['blocked_or_suppressed', 'silent_omissions'] };
function readCounts(file, p, watch = 'silent-errors', segmentBy = null, info = {}) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { p.stop('A1', file, 'cannot read the counts file: ' + e.message); return []; }
  if (text.charCodeAt(0) === 0xFEFF) {   // A3: Windows PowerShell starts files with a byte-order mark
    text = text.slice(1);
    p.fix('A3', file, 'removed an invisible byte-order mark from the start of the file');
  }
  const [baseCol, hitCol] = COUNT_COLUMNS[watch];
  const omissions = watch === 'silent-omissions';
  // Problems with the series' own columns: L5 as ever for silent errors; L21 for the omission columns.
  const colTrap = omissions ? 'L21' : 'L5';
  let rows, found = null;
  if (path.extname(file).toLowerCase() === '.csv') {
    const delimiter = csvDelimiter(text, file, p);
    if (delimiter === null) return [];
    rows = csvToRecords(text, file, p, delimiter);
    found = headerColumns(text, delimiter);
    if (!columnsPresent(rows, text, delimiter, file, p, watch)) return [];
  } else {
    try { rows = JSON.parse(text); } catch (e) { p.stop('L5', file, 'is not valid JSON: ' + e.message); return []; }
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    p.stop('L5', file, 'holds no periods: a counts file is a list of periods, each with period, ' + baseCol + ' and ' + hitCol);
    return [];
  }
  rows = Array.isArray(rows) ? looseNames(rows, file, p) : rows;
  // The segment column: the one --segment-by names, read loosely, as every column name is.
  const isRow = r => r && typeof r === 'object' && !Array.isArray(r);
  const has = col => (found ? found.includes(col) : rows.some(r => isRow(r) && r[col] !== undefined));
  const segCol = segmentBy !== null ? looseName(segmentBy) : null;
  // L23: the period, or a column that is counted, holds no segment.
  if (segCol !== null && (segCol === 'period' || COUNTED.includes(segCol))) {
    p.stop('L23', file, '--segment-by names "' + segmentBy + '", the counts file\'s ' + (segCol === 'period' ? 'period' : segCol === 'scored_with' ? 'scored_with' : 'count') +
      ' column: name the column that holds each row\'s segment');
    return [];
  }
  if (segCol !== null && !has(segCol)) {
    p.stop('L23', file, 'has no ' + segCol + ' column for --segment-by. Columns found: ' + (found || [...new Set(rows.filter(isRow).flatMap(r => Object.keys(r)))]).join(', '));
    return [];
  }
  info.segment_column = segCol;
  const whole = (v, csv) => (csv ? (/^\s*\d+\s*$/.test(String(v)) ? Number(v) : NaN) : Number.isInteger(v) && v >= 0 ? v : NaN);
  const csv = path.extname(file).toLowerCase() === '.csv';
  const periods = [];
  rows.forEach((row, i) => {
    const name = row && row.period !== undefined && row.period !== null ? String(row.period).trim() : '';
    const where = file + ' ' + (name ? 'period "' + name + '"' : 'row ' + (i + 1));
    if (!row || typeof row !== 'object') { p.stop('L5', where, 'is not a row with period, ' + baseCol + ' and ' + hitCol); return; }
    if (!name) { p.stop('L5', where, 'has no period name'); return; }
    let ok = true;
    for (const col of [baseCol, hitCol]) {
      if (row[col] === undefined || row[col] === '') { p.stop(colTrap, where, 'has no ' + col); ok = false; continue; }
      if (Number.isNaN(whole(row[col], csv))) { p.stop(colTrap, where, col + ' must be a whole number of 0 or more, got ' + JSON.stringify(row[col])); ok = false; }
    }
    if (!ok) return;
    const out = whole(row[baseCol], csv), silent = whole(row[hitCol], csv);
    if (silent > out) {
      p.stop(colTrap, where, omissions ? 'has more silent omissions (' + silent + ') than records blocked or suppressed (' + out + ')' : 'has more silent errors (' + silent + ') than records out without review (' + out + ')');
      return;
    }
    const sw = row.scored_with === undefined || String(row.scored_with).trim() === '' ? '(not given)' : String(row.scored_with).trim();
    const x = { period: name, out, silent, scored_with: sw };
    if (segCol !== null) {
      const v = row[segCol];
      // As a group label (H8): text, a number or true/false; an object would pool as "[object Object]".
      if (v !== undefined && v !== null && typeof v === 'object') { p.stop('L23', where, segCol + ' must be text or a number, got ' + JSON.stringify(v)); return; }
      x.segment = v === undefined || v === null || String(v).trim() === '' ? NONE : String(v).trim();
    }
    periods.push(x);
  });
  // L29: segments are read only with --segment-by. A segment column alone is an extra column, as in
  // any counts file; but with periods given again, one row per period and segment was meant.
  if (segCol === null && has('segment')) {
    const names = periods.map(x => x.period);
    const twice = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    if (twice.length) {
      p.stop('L29', file, 'has a segment column and gives periods more than once (' + twice.slice(0, 6).join(', ') + (twice.length > 6 ? ', ...' : '') + '): one row per period and segment is read only with --segment-by. To read it so, add --segment-by segment');
      return [];
    }
  }
  if (segCol === null) return periods;
  // L23: a segment column left empty everywhere would make one segment, "(none)", that is the whole.
  if (periods.length && periods.every(x => x.segment === NONE)) {
    p.stop('L23', file, 'the ' + segCol + ' column is empty in every row, so every row would be in "(none)", one segment that is the whole. Fill it in, or leave the column out');
    return [];
  }
  return bySegment(periods, file, p);
}

// L26: a counts file with segments: one row per period and segment, in either layout (period by
// period, or segment by segment), each segment's rows in time order and each period once. Returns
// the whole's periods, each the segments added up and carrying them (segments: label -> counts),
// in time order: the order the names give when every name gives one (L1), or else the order they
// first come in. L27: a segment that holds the others added up (a spreadsheet's total row).
function bySegment(rows, file, p) {
  const segs = new Map();
  for (const r of rows) { if (!segs.has(r.segment)) segs.set(r.segment, []); segs.get(r.segment).push(r); }
  const names = [...new Set(rows.map(r => r.period))];
  const keys = names.map(orderKey);
  const byName = keys.every(k => k !== null) && new Set(keys.map(k => k.kind)).size === 1;
  const order = byName ? names.map((n, i) => i).sort((a, b) => (keys[a].key < keys[b].key ? -1 : keys[a].key > keys[b].key ? 1 : a - b)).map(i => names[i]) : names;
  const index = new Map(order.map((n, i) => [n, i]));
  for (const [seg, list] of segs) {
    const seen = new Set();
    list.forEach((r, i) => {
      if (seen.has(r.period)) { p.stop('L26', file, 'period ' + r.period + ' is given twice for segment "' + seg + '"'); return; }
      seen.add(r.period);
      if (i > 0 && index.get(r.period) < index.get(list[i - 1].period)) {
        p.stop('L26', file, 'segment "' + seg + '": period ' + r.period + ' comes after ' + list[i - 1].period + ' in the input but is earlier: give each segment\'s rows in time order');
      }
    });
  }
  const byPeriod = new Map(order.map(n => [n, []]));
  for (const r of rows) byPeriod.get(r.period).push(r);
  // L27: a row that holds the other segments of its period (two or more) added up: STRICT when a
  // segment does so in every period it has (two or more), a WARN when in some; and a WARN for two
  // segments with the same counts in every period (a total of one segment, or a copy).
  const sums = new Map([...byPeriod].map(([n, list]) => [n, { n: list.length, out: list.reduce((t, x) => t + x.out, 0), silent: list.reduce((t, x) => t + x.silent, 0) }]));
  const holdsOthers = r => { const s = sums.get(r.period); return s.n >= 3 && r.out > 0 && s.out - r.out === r.out && s.silent - r.silent === r.silent; };
  for (const [seg, list] of segs) {
    const hits = list.filter(holdsOthers);
    if (!hits.length) continue;
    if (list.length >= 2 && hits.length === list.length) {
      p.strict('L27', file, 'segment "' + seg + '" holds the other segments added up, in every period: a total row would count every record twice. The whole is worked out from the segments: leave the total row out');
      continue;
    }
    const counts = new Set(hits.map(r => sums.get(r.period).n - 1));
    p.warn('L27', file, 'segment "' + seg + '" holds ' + (counts.size === 1 ? [...counts][0] + ' other segments' : 'the other segments') + ' added up in ' + hits.slice(0, 12).map(r => r.period).join(', ') + (hits.length > 12 ? ', ...' : '') +
      ': if it is a total row there, those records count twice. The whole is worked out from the segments');
  }
  const signature = list => (list.length >= 2 && list.some(r => r.out > 0) ? list.map(r => r.period + ':' + r.out + ':' + r.silent).join('|') : null);
  const alike = new Map();
  for (const [seg, list] of segs) {
    const sig = signature(list);
    if (sig === null) continue;
    if (!alike.has(sig)) alike.set(sig, []);
    alike.get(sig).push(seg);
  }
  for (const same of alike.values()) {
    if (same.length < 2) continue;
    const names = [...same].sort();
    p.warn('L27', file, 'segments ' + names.map(s => '"' + s + '"').join(' and ') + ' hold the same counts in every period: one may be a total of the other, or a copy, and would count those records twice');
  }
  return order.map(name => {
    const mine = byPeriod.get(name);
    return {
      period: name, out: mine.reduce((t, r) => t + r.out, 0), silent: mine.reduce((t, r) => t + r.silent, 0),
      scored_with: mine[0].scored_with, scored: mine,
      segments: new Map(mine.map(r => [r.segment, { out: r.out, silent: r.silent }])),
    };
  });
}

// The column names of a CSV header row, as they are read (loosely: L15).
const headerColumns = (text, delimiter) => text.split(/\r?\n/, 1)[0].split(delimiter).map(c => looseName(c.replace(/^"|"$/g, ''))).filter(Boolean);

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
// With --watch silent-omissions the omission columns are the ones required (L21).
function columnsPresent(rows, text, delimiter, file, p, watch = 'silent-errors') {
  const found = text.split(/\r?\n/, 1)[0].split(delimiter).map(c => looseName(c.replace(/^"|"$/g, ''))).filter(Boolean);
  const missing = ['period', ...COUNT_COLUMNS[watch]].filter(c => !found.includes(c));
  if (!missing.length) return true;
  if (watch === 'silent-omissions') {
    p.stop('L21', file, 'has no ' + missing.join(' or ') + ' column, needed to watch silent omissions. Columns found: ' + found.join(', ') +
      '; expected: period, blocked_or_suppressed, silent_omissions (and segment, scored_with, optional)');
    return false;
  }
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
// watch: the series (--watch): 'silent-errors' (the default: the records out without review) or
// 'silent-omissions' (the records blocked or suppressed; L19-L21). The settings apply to it.
// segmentBy: a record field (run files: a config group's name, or a field read from the answer key)
// or a counts file's column, or null. Then each segment gets its own alarm and bound beside the
// whole's (L22-L33). segments: the segments named in advance (--segments), or null: then the family
// is the segments in the periods given, and "shown" is provisional (L31).
function monitorRun({ config = null, runPaths = [], countsPath = null, keysDir = null, target = null, acceptable = null, alarming = null, falseAlarmEvery = 2000, since = null, periodSize = null, lenient = false, watch = 'silent-errors', segmentBy = null, segments = null }) {
  const mode = lenient ? 'lenient' : 'strict';
  if (!Object.prototype.hasOwnProperty.call(SERIES, watch)) throw new Error('--watch must be silent-errors or silent-omissions, got ' + JSON.stringify(watch));
  if (segmentBy !== null && String(segmentBy).trim() === '') throw new Error('--segment-by needs the name of a field (or of a counts file\'s column), got ' + JSON.stringify(segmentBy));
  if (segments !== null) checkDeclared(segments, segmentBy);
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

  const words = SERIES[watch];
  let segment = null;
  if (segmentBy !== null && !countsPath && config) {
    try { segment = segmentGroup(config, segmentBy); } catch (e) { throw new Error(e.message.replace('--group-by', '--segment-by')); }
  }
  const info = {};
  let periods = countsPath ? readCounts(countsPath, p, watch, segmentBy, info) : readRuns(config, runPaths, mode, p, keysDir, watch, segment, info);
  // L34: monitor ignores a split (trap O1). A golden-set file given here shows both halves, and no
  // look is counted: say so once, with where a figure for --acceptable comes from instead.
  if (!countsPath && config && config.split) {
    p.warn('L34', 'config', 'the config has a split: monitor ignores it and reads every record in the period files. A golden-set run file given here shows both halves, the held-out half too, ' +
      'and split.log does not count that look. For --acceptable from the golden set, use score with this config instead: it keeps the halves apart, and its silent error rate is the tuning half\'s ' +
      '(for the share wrongly left out: its silent omissions over the records it blocked or suppressed)');
  }
  periods = checkOrder(periods, countsPath || 'period files', p, !countsPath);
  for (const x of periods) {
    if (x.out === 0) p.warn('L3', x.file || (countsPath + ' period "' + x.period + '"'), 'no ' + words.base + ' were checked in this period: it adds nothing to either check, and its rate is not measured');
  }
  let from = 0;
  if (since !== null) {
    from = periods.findIndex(x => x.period === since);
    if (from < 0) p.stop('L8', '--since', 'no period is named "' + since + '"; the periods are ' + periods.map(x => x.period).slice(0, 12).join(', ') + (periods.length > 12 ? ', ...' : ''));
  }
  // With segments, every row of the counts file says how it was scored.
  if (countsPath) checkScoredWith(periods.some(x => x.scored) ? periods.flatMap(x => x.scored) : periods, countsPath, p);
  const sizes = periods.filter(x => x.out > 0).map(x => x.out);
  if (sizes.length && Math.max(...sizes) > UNEVEN * Math.min(...sizes)) {
    p.warn('L7', countsPath || 'period files', 'the periods range from ' + Math.min(...sizes) + ' to ' + Math.max(...sizes) + ' ' + words.base + '. ' +
      'Both checks weigh every record the same, so a big period counts for more than a small one; the false-alarm figure is for periods of the median size (or --period-size), and smaller ones false-alarm more often. ' +
      'If a different share of each period\'s records was checked, the records checked do not stand for the periods equally.');
  }
  const segmented = segment !== null || (countsPath !== null && Boolean(info.segment_column));
  const segs = segmented ? segmentSeries(periods, countsPath || '--segment-by', p, segments) : null;
  p.throwIfStopped();
  const opts = { acceptable: p0 / 100, alarming: p1 / 100, target: target === null ? null : target / 100, falseAlarmEvery, from, periodSize };
  // With one segment with records, and no record in two, the segment is the whole: no budget to share (L28).
  const several = countsPath ? 0 : info.several || 0;
  const shared = segmented && (segs.family.filter(s => s.periods.some(x => x.out > 0)).length > 1 || several > 0);
  const memberships = segmented && !countsPath ? periods.map(x => x.memberships || 0) : null;
  const series = segmented ? monitorSegments(periods, segs.family, { ...opts, shared, provisional: segments === null, memberships }) : monitorSeries(periods, opts);
  series.settings.acceptable_given = acceptable !== null;
  baselineNote(series, p0, p, watch);
  if (segmented) {
    const { members, false_alarm_every_each, without_segments, rows, overlap } = series.segments;
    series.segments = {
      by: countsPath ? info.segment_column : segment.name, from: countsPath ? 'counts file' : segment.from,
      declared: segments === null ? null : segments.map(s => String(s).trim()), provisional: segments === null,
      members, false_alarm_every_each, without_segments,
      rows: rows.filter(r => r.records > 0), empty: segs.empty,
      ...(segments !== null ? { other_values: segs.other } : {}),
      ...(countsPath ? {} : { records_in_several: several }),
      ...(overlap ? { overlap } : {}),
    };
  }
  return {
    kind: 'monitor',
    ...(watch === 'silent-errors' ? {} : { watch }),
    inputs: { ...(countsPath ? { counts: countsPath } : { runs: runPaths, ...(keysDir !== null ? { keys: keysDir } : {}) }), mode, ...(since !== null ? { since } : {}) },
    ...series,
    problems: p.items,
  };
}

// The values of a field nobody named in --segments, pooled into one segment (L31).
const OTHER = '(other)';

// --segments: the names, given before the first period counted. Mistakes stop before anything is read.
function checkDeclared(segments, segmentBy) {
  if (segmentBy === null) throw new Error('--segments goes with --segment-by: it names the values of that field to watch');
  const seen = new Set();
  for (const raw of segments) {
    const s = String(raw).trim();
    if (s === '') throw new Error('--segments has an empty name: list the segments separated by commas, chat,email,phone');
    if (s === OTHER || s === NONE) throw new Error('--segments: "' + s + '" is the tool\'s own name for the values not named (' + OTHER + ') and for a record with no value (' + NONE + '); both are always watched');
    if (seen.has(s)) throw new Error('--segments names "' + s + '" twice');
    seen.add(s);
  }
}

// Each segment's periods, aligned with the whole's (0 records where a segment had none): the family
// of the closed test, and the segments of it with no record in this series (named in the report
// rather than given a row of nothing).
// - Named in advance (declared, --segments): the family is those, then "(other)" (every value not
//   named, pooled) and "(none)" (no value), all of them from the start, whatever comes (L31). A value
//   that differs only by case from a name would be pooled away: STRICT (L23).
// - Not named: the segments with records in the periods given, by name, "(none)" last (H1). Two
//   segments whose names differ only by case are one segment split in two: STRICT (L23).
function segmentSeries(periods, where, p, declared = null) {
  const seen = [...new Set(periods.flatMap(x => [...x.segments.keys()]))];
  const other = {};
  let labels;
  if (declared !== null) {
    const named = declared.map(s => String(s).trim());
    const lowerNamed = new Map(named.map(s => [s.toLowerCase(), s]));
    for (const label of seen) {
      if (label === NONE || named.includes(label)) continue;
      const twin = lowerNamed.get(label.toLowerCase());
      if (twin) p.strict('L23', where, 'segment value "' + label + '" differs only by case from "' + twin + '", named in --segments: it would be pooled into ' + OTHER + '. Write it the same way (--lenient pools it)');
    }
    for (const x of periods) {
      const pooled = new Map();
      for (const [label, c] of x.segments) {
        const to = label === NONE || named.includes(label) ? label : OTHER;
        if (to === OTHER) other[label] = (other[label] || 0) + c.out;
        const acc = pooled.get(to) || { out: 0, silent: 0 };
        acc.out += c.out;
        acc.silent += c.silent;
        pooled.set(to, acc);
      }
      x.segments = pooled;
    }
    labels = [...named, OTHER, NONE];
  } else {
    labels = seen.sort((a, b) => (a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b)));
    const lower = new Map();
    for (const label of labels) {
      const k = label.toLowerCase();
      const pair = [lower.get(k), label].sort();
      if (lower.has(k)) p.strict('L23', where, 'segments "' + pair[0] + '" and "' + pair[1] + '" differ only by case: one segment split in two halves its evidence, and can hide a rise. Write them the same way (--lenient keeps them apart)');
      else lower.set(k, label);
    }
  }
  const all = labels.map(segment => ({ segment, periods: periods.map(x => ({ period: x.period, ...(x.segments.get(segment) || { out: 0, silent: 0 }) })) }));
  const records = s => s.periods.reduce((t, x) => t + x.out, 0);
  return {
    family: declared !== null ? all : all.filter(s => records(s) > 0),
    empty: all.filter(s => records(s) === 0).map(s => s.segment),
    other,
  };
}

// L18: the acceptable rate may be set too low for this workflow. Two signs:
// - the alarm dates the rise to the first or second period counted: there is no calm stretch
//   before it to rise from, so the "rise" may only be the workflow's normal rate;
// - or the periods before the alarm (all of them, with no alarm) run clearly above the
//   acceptable rate: their whole likely range is above it.
// Either way the report suggests --acceptable at the rate those periods ran at.
function baselineNote(series, p0, p, watch = 'silent-errors') {
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
    (watch === 'silent-omissions'
      ? ' (better: the share measured before launch, from monitor --watch silent-omissions on the golden-set run file as a single period, or the first weeks; score\'s silent omission rate counts a different base).'
      : ' (better: the rate measured before launch, from score on a golden set or the first weeks).'));
}

module.exports = { monitorRun };
