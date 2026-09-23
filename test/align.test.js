// Tests for src/align.js: pairing predictions with answers. Named after traps in test/TRAPS.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateConfig, loadConfig } = require('../src/config.js');
const { problems } = require('../src/problems.js');
const { align } = require('../src/align.js');
const { loadRun } = require('../src/load.js');

const CONFIG = validateConfig({
  outputs: { tags: { type: 'set' } },
  routing: { gold_field: 'gold', map: { AUTO: 'auto', REVIEW: 'review', BLOCK: 'block', DUP: 'exclude' } },
}).config;

// Records as load.js hands them over.
const tag = (value, confidence = 0.9) => ({ value, confidence, applied: true, inherited: false });
const P = (id, route = 'AUTO', tags = [tag('A')]) => ({ id, route, scored: true, outputs: { tags } });
const K = (id, gold = 'AUTO', tags = ['A'], traps = []) => ({ id, gold_route: gold, traps, outputs: { tags } });

function run(preds, keys, { mode = 'strict', config = CONFIG, opts = {} } = {}) {
  const p = problems(mode);
  const result = align(preds, keys, config, p, { predSource: 'preds', keySource: 'key', ...opts });
  return { result, flagged: p.items.map(i => i.level + ':' + i.trap), items: p.items };
}

// ---------- Pairing ----------

test('B6: records are paired by id, whatever order the files are in, and come out in key order', () => {
  const { result, flagged } = run([P('R2', 'REVIEW'), P('R1')], [K('R1'), K('R2', 'REVIEW')]);
  assert.deepEqual(flagged, []);
  assert.deepEqual(result.map(r => [r.id, r.route, r.gold_route]), [['R1', 'AUTO', 'AUTO'], ['R2', 'REVIEW', 'REVIEW']]);
});

test('each paired record carries both sides and both route classes', () => {
  const { result } = run([P('R1', 'REVIEW')], [K('R1', 'AUTO', ['A'], ['weak-tag'])]);
  assert.deepEqual(result[0], {
    id: 'R1', route: 'REVIEW', route_class: 'review', gold_route: 'AUTO', gold_class: 'auto',
    scored: true, traps: ['weak-tag'], pred: { tags: [tag('A')] }, key: { tags: ['A'] },
  });
});

test('B2 + B3: the same id twice in either file stops', () => {
  assert.deepEqual(run([P('R1'), P('R1')], [K('R1')]).flagged, ['stop:B2']);
  assert.deepEqual(run([P('R1')], [K('R1'), K('R1')]).flagged, ['stop:B3']);
});

test('B4: a prediction with no answer in the key stops', () => {
  const { flagged, items } = run([P('R1'), P('R9')], [K('R1')]);
  assert.deepEqual(flagged, ['stop:B4']);
  assert.match(items[0].message, /R9/);
});

test('B5: a record in the key that never came out of the workflow stops, even in lenient mode', () => {
  const { flagged, items } = run([P('R1')], [K('R1'), K('R2')], { mode: 'lenient' });
  assert.deepEqual(flagged, ['stop:B5']);
  assert.match(items[0].message, /R2/);
  assert.match(items[0].message, /workflow bug/);
});

test('B9: ids that differ only in upper/lower case stop with the likely match', () => {
  const { flagged, items } = run([P('r1')], [K('R1')]);
  assert.deepEqual(flagged, ['stop:B9']);   // not also B4 and B5 for the same pair
  assert.match(items[0].message, /"r1".*"R1"/);
});

test('many missing records are one problem with a list, not hundreds of lines', () => {
  const keys = Array.from({ length: 25 }, (_, i) => K('R' + (i + 1)));
  const { flagged, items } = run([P('R1')], keys);
  assert.deepEqual(flagged, ['stop:B5']);
  assert.match(items[0].message, /^24 /);
  assert.match(items[0].message, /and 4 more/);
});

// ---------- Routes ----------

test('C1: a route missing from routing.map stops and lists the known ones', () => {
  const { flagged, items } = run([P('R1', 'ESCALATED')], [K('R1')]);
  assert.deepEqual(flagged, ['stop:C1']);
  assert.match(items[0].message, /Known decisions: AUTO, REVIEW, BLOCK, DUP/);
});

// Note: P('R1', undefined) would NOT make a record without a route. Passing undefined to a
// parameter with a default (route = 'AUTO') uses the default. So the field is removed explicitly.
test('C2: a missing or empty route stops', () => {
  assert.deepEqual(run([{ ...P('R1'), route: undefined }], [K('R1')]).flagged, ['stop:C2']);
  assert.deepEqual(run([P('R1', '  ')], [K('R1')]).flagged, ['stop:C2']);
});

test('C3: spaces around a route are trimmed; a case difference stops, because guessing is unsafe', () => {
  const spaced = run([P('R1', ' AUTO ')], [K('R1')]);
  assert.deepEqual(spaced.flagged, ['fix:C3']);
  assert.equal(spaced.result[0].route_class, 'auto');
  const cased = run([P('R1', 'Auto')], [K('R1')]);
  assert.deepEqual(cased.flagged, ['stop:C3']);
  assert.match(cased.items[0].message, /did you mean "AUTO"/);
});

test('C4 + C5: the key\'s correct route must be there and known', () => {
  assert.deepEqual(run([P('R1')], [{ ...K('R1'), gold_route: undefined }]).flagged, ['stop:C4']);
  assert.deepEqual(run([P('R1')], [K('R1', 'PUBLISH')]).flagged, ['stop:C5']);
});

test('with no gold field configured, there is no correct route to check', () => {
  const noGold = validateConfig({ outputs: { tags: { type: 'set' } }, routing: { map: { AUTO: 'auto' } } }).config;
  const { result, flagged } = run([P('R1')], [K('R1', null)], { config: noGold });
  assert.deepEqual(flagged, []);
  assert.equal(result[0].gold_class, null);
});

// ---------- Suspicious inputs ----------

test('A8: reading the same values as both prediction and answer stops', () => {
  const { flagged, items } = run([P('R1')], [K('R1')], { opts: { sameFile: true } });
  assert.deepEqual(flagged, ['stop:A8']);
  assert.match(items[0].message, /key_field/);
});

test('A8: predictions identical to the key and without any confidence get a warning', () => {
  const plain = [tag('A', null)];
  assert.deepEqual(run([P('R1', 'AUTO', plain)], [K('R1')]).flagged, ['warn:A8']);
  assert.deepEqual(run([P('R1', 'AUTO', [tag('A', 0.9)])], [K('R1')]).flagged, []);   // a real, perfect run
  assert.deepEqual(run([P('R1', 'AUTO', [tag('B', null)])], [K('R1')]).flagged, []);  // not identical
});

// ---------- End to end ----------

test('the tiny fixture pairs up: six records, each with its route classes and traps', () => {
  const dir = path.join(__dirname, 'fixtures', 'tiny');
  const { records, problems: found } = loadRun({
    config: loadConfig(path.join(dir, 'config.json')),
    predPath: path.join(dir, 'predictions.json'), keyPath: path.join(dir, 'key.json'),
  });
  assert.deepEqual(found, []);
  assert.deepEqual(records.map(r => [r.id, r.route_class, r.gold_class]), [
    ['R1', 'auto', 'auto'],
    ['R2', 'auto', 'review'],      // the silent error
    ['R3', 'review', 'review'],
    ['R4', 'review', 'auto'],      // the unnecessary review
    ['R5', 'block', 'block'],
    ['R6', 'exclude', 'exclude'],
  ]);
  assert.deepEqual(records[1].traps, ['plausible-extra-tag']);
});

test('if reading the files failed, matching is skipped rather than adding noise', () => {
  const config = loadConfig(path.join(__dirname, 'fixtures', 'tiny', 'config.json'));
  assert.throws(
    () => loadRun({ config, predPath: 'missing-preds.json', keyPath: path.join(__dirname, 'fixtures', 'tiny', 'key.json') }),
    err => /1 problem\(s\)/.test(err.message) && !/B5/.test(err.message),
  );
});
