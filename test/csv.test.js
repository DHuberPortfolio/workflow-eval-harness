// Tests for src/csv.js and CSV loading. Named after traps in test/TRAPS.md where they cover one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateConfig, loadConfig } = require('../src/config.js');
const { problems } = require('../src/problems.js');
const { parseCsvText, csvToRecords, decodeCsvRecords } = require('../src/csv.js');
const { parseRecords, normalizePredictions, normalizeKey, loadRun } = require('../src/load.js');

function run(fn, mode = 'strict') {
  const p = problems(mode);
  const result = fn(p);
  return { result, flagged: p.items.map(i => i.level + ':' + i.trap), items: p.items };
}
const cells = rows => rows.map(r => r.cells);

// ---------- Step 1: text into rows ----------

test('quoted cells may hold the delimiter, line breaks and "" for a quote mark', () => {
  const text = 'id,note\nR1,"a, b"\nR2,"two\nlines"\nR3,"say ""hi"""\n';
  const { result, flagged } = run(p => parseCsvText(text, ',', 'f', p));
  assert.deepEqual(flagged, []);
  assert.deepEqual(cells(result), [['id', 'note'], ['R1', 'a, b'], ['R2', 'two\nlines'], ['R3', 'say "hi"']]);
  assert.equal(result[3].line, 5);   // R3 starts on line 5, because R2's cell spans two lines
});

test('Windows line endings and a missing final line break both work', () => {
  assert.deepEqual(cells(run(p => parseCsvText('id,x\r\nR1,1\r\n', ',', 'f', p)).result), [['id', 'x'], ['R1', '1']]);
  assert.deepEqual(cells(run(p => parseCsvText('id,x\nR1,1', ',', 'f', p)).result), [['id', 'x'], ['R1', '1']]);
});

test('A11: a quoted cell that is never closed stops, naming the line it started on', () => {
  const { flagged, items } = run(p => parseCsvText('id,note\nR1,"oops\nR2,fine\n', ',', 'f', p));
  assert.deepEqual(flagged, ['stop:A11']);
  assert.match(items[0].where, /line 2/);
});

test('rows become records keyed by the header; blank lines are skipped', () => {
  const { result } = run(p => csvToRecords('id , route\n\nR1,AUTO\n  \nR2,REVIEW\n', 'f', p, ','));
  assert.deepEqual(result, [{ id: 'R1', route: 'AUTO' }, { id: 'R2', route: 'REVIEW' }]);
});

test('A12: a row with the wrong number of cells stops, and says why it usually happens', () => {
  const { flagged, items } = run(p => csvToRecords('id,note\nR1,a, b\n', 'f', p, ','));
  assert.deepEqual(flagged, ['stop:A12']);
  assert.match(items[0].where, /line 2/);
  assert.match(items[0].message, /must be in double quotes/);
});

test('A12: a ;-separated file read as ,-separated stops with the setting to change', () => {
  const { flagged, items } = run(p => csvToRecords('id;route\nR1;AUTO\n', 'f', p, ','));
  assert.deepEqual(flagged, ['stop:A12']);
  assert.match(items[0].message, /"delimiter": ";"/);
  assert.deepEqual(run(p => csvToRecords('id;route\nR1;AUTO\n', 'f', p, ';')).result, [{ id: 'R1', route: 'AUTO' }]);
});

test('A13: a header with an empty or repeated column name stops', () => {
  assert.deepEqual(run(p => csvToRecords('id,,x\nR1,a,b\n', 'f', p, ',')).flagged, ['stop:A13']);
  assert.deepEqual(run(p => csvToRecords('id,x,x\nR1,a,b\n', 'f', p, ',')).flagged, ['stop:A13']);
});

test('A4: a header row with no records stops', () => {
  assert.deepEqual(run(p => csvToRecords('id,route\n', 'f', p, ',')).flagged, ['stop:A4']);
});

test('.csv and .tsv are recognised by extension; .tsv splits on tabs', () => {
  assert.deepEqual(run(p => parseRecords('id,route\nR1,AUTO\n', 'run.csv', p)).result, [{ id: 'R1', route: 'AUTO' }]);
  assert.deepEqual(run(p => parseRecords('id\troute\nR1\tAUTO\n', 'run.tsv', p)).result, [{ id: 'R1', route: 'AUTO' }]);
});

// ---------- Step 2: cells into values ----------

const CONFIG = validateConfig({
  trap_field: 'trap',
  outputs: {
    tags: { type: 'set', rejected_field: 'tags_rejected' },
    verdict: { type: 'label', labels: ['pass', 'elevate', 'fail'], confidence_field: 'confidence' },
  },
  routing: { gold_field: 'expected', map: { AUTO: 'auto', REVIEW: 'review' } },
}).config;
const S = CONFIG.input.predictions;   // the default separators: | and @
const decodePred = (row, mode) => run(p => decodeCsvRecords([row], CONFIG, 'predictions', S, 'f', p), mode);
const row = extra => ({ id: 'R1', route: 'AUTO', tags: '', tags_rejected: '', verdict: 'pass', confidence: '', ...extra });

test('A14: "A@0.9 | B" is two values, the first with a confidence; an empty cell is no values', () => {
  const { result, flagged } = decodePred(row({ tags: 'A@0.9 | B', tags_rejected: '' }));
  assert.deepEqual(flagged, []);
  assert.deepEqual(result[0].tags, [{ value: 'A', confidence: 0.9 }, 'B']);
  assert.deepEqual(result[0].tags_rejected, []);
});

test('A14: a value containing @ with no number after it stops, suggesting another separator', () => {
  const { flagged, items } = decodePred(row({ tags: 'someone@example.com' }));
  assert.deepEqual(flagged, ['stop:E4']);
  assert.match(items[0].message, /set a different confidence_separator/);
});

test('E7: a decimal comma stops, showing the dot version', () => {
  const { flagged, items } = decodePred(row({ tags: 'A@0,95' }));
  assert.deepEqual(flagged, ['stop:E7']);
  assert.match(items[0].message, /0\.95/);
});

test('an empty piece between separators is kept, so D9 reports it', () => {
  const { result, flagged } = run(p => normalizePredictions(
    decodeCsvRecords([row({ tags: 'A | | B' })], CONFIG, 'predictions', S, 'f', p), CONFIG, 'f', p));
  assert.deepEqual(flagged, ['stop:D9']);
  assert.deepEqual(result[0].outputs.tags.map(v => v.value), ['A', 'B']);
});

test('a label with its confidence in its own column', () => {
  const { result, flagged } = run(p => normalizePredictions(
    decodeCsvRecords([row({ verdict: 'fail', confidence: '0.42' })], CONFIG, 'predictions', S, 'f', p), CONFIG, 'f', p));
  assert.deepEqual(flagged, []);
  assert.deepEqual(result[0].outputs.verdict, { value: 'fail', confidence: 0.42, applied: true, inherited: false });
});

test('F2: a label cell holding two labels stops', () => {
  const { flagged } = run(p => normalizePredictions(
    decodeCsvRecords([row({ verdict: 'pass | fail' })], CONFIG, 'predictions', S, 'f', p), CONFIG, 'f', p));
  assert.deepEqual(flagged, ['stop:F2']);
});

test('"scored" accepts true/false in any case; anything else is left for C10 to report', () => {
  assert.equal(decodePred(row({ scored: 'FALSE' })).result[0].scored, false);
  assert.equal(decodePred(row({ scored: 'True' })).result[0].scored, true);
  const { flagged } = run(p => normalizePredictions(
    decodeCsvRecords([row({ scored: 'no' })], CONFIG, 'predictions', S, 'f', p), CONFIG, 'f', p));
  assert.deepEqual(flagged, ['stop:C10']);
});

test('trap cells split into a list on the list separator', () => {
  const decodeKey = r => run(p => normalizeKey(decodeCsvRecords([r], CONFIG, 'key', S, 'f', p), CONFIG, 'f', p)).result[0].traps;
  const k = extra => ({ id: 'R1', expected: 'AUTO', tags: '', verdict: 'pass', ...extra });
  assert.deepEqual(decodeKey(k({ trap: 'near-duplicate | weak-tag' })), ['near-duplicate', 'weak-tag']);
  assert.deepEqual(decodeKey(k({ trap: 'near-duplicate' })), ['near-duplicate']);
  assert.deepEqual(decodeKey(k({ trap: '' })), []);
});

test('an empty id or route cell counts as not given', () => {
  const { result } = decodePred(row({ id: '', route: '' }));
  assert.equal(result[0].id, undefined);
  assert.equal(result[0].route, undefined);
});

test('a spreadsheet and a spreadsheet answer key load exactly like the JSON versions', () => {
  const tiny = path.join(__dirname, 'fixtures', 'tiny');
  const shapes = path.join(__dirname, 'fixtures', 'shapes');
  const expected = loadRun({ config: loadConfig(path.join(tiny, 'config.json')), predPath: path.join(tiny, 'predictions.json'), keyPath: path.join(tiny, 'key.json') });
  const got = loadRun({ config: loadConfig(path.join(shapes, 'sheet.config.json')), predPath: path.join(shapes, 'sheet.csv'), keyPath: path.join(shapes, 'key.csv') });
  assert.deepEqual(got.predictions, expected.predictions);
  assert.deepEqual(got.key, expected.key);
  assert.deepEqual(got.problems, []);
});
