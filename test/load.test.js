// Tests for src/load.js. Each test is named after the trap it covers (see test/TRAPS.md).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateConfig, loadConfig } = require('../src/config.js');
const { problems } = require('../src/problems.js');
const { getPath, parseRecords, readRecords, normalizePredictions, normalizeKey, loadRun } = require('../src/load.js');

// A config with one output of each type, and a confidence gate on SUBJECT.
const CONFIG = validateConfig({
  trap_field: 'trap',
  outputs: {
    SUBJECT: { type: 'set' },
    GEOGRAPHY: { type: 'set' },
    verdict: { type: 'label', labels: ['pass', 'elevate', 'fail'] },
  },
  routing: { gold_field: 'expected_route', map: { AUTO: 'auto', REVIEW: 'review' } },
  thresholds: { floor: 0.6, auto_publish: { SUBJECT: 0.85 } },
}).config;

// Run a load step and return what it produced plus a short list of what it flagged,
// e.g. ['stop:D12', 'fix:D7'].
function run(fn, mode = 'strict') {
  const p = problems(mode);
  const result = fn(p);
  return { result, flagged: p.items.map(i => i.level + ':' + i.trap), items: p.items };
}
const pred = (extra) => ({ id: 'R1', route: 'AUTO', SUBJECT: [], GEOGRAPHY: [], verdict: 'pass', ...extra });
const key = (extra) => ({ id: 'R1', expected_route: 'AUTO', SUBJECT: [], GEOGRAPHY: [], verdict: 'pass', ...extra });
const readPred = (rec, mode) => run(p => normalizePredictions([rec], CONFIG, 'preds', p), mode);
const readKey = (rec, mode) => run(p => normalizeKey([rec], CONFIG, 'key', p), mode);

// ---------- A. Reading files ----------

test('A1: a missing file stops and names the file', () => {
  const { flagged, items } = run(p => readRecords('no/such/file.json', p));
  assert.deepEqual(flagged, ['stop:A1']);
  assert.match(items[0].where, /no\/such\/file\.json/);
});

test('A2: broken JSON stops', () => {
  assert.deepEqual(run(p => parseRecords('[{"id": "R1",}]', 'f', p)).flagged, ['stop:A2']);
});

test('A3: an invisible byte-order mark is removed, and that is reported', () => {
  const { result, flagged } = run(p => parseRecords('﻿[{"id":"R1"}]', 'f', p));
  assert.deepEqual(result, [{ id: 'R1' }]);
  assert.deepEqual(flagged, ['fix:A3']);
});

test('A4: an empty file or an empty list stops', () => {
  assert.deepEqual(run(p => parseRecords('   ', 'f', p)).flagged, ['stop:A4']);
  assert.deepEqual(run(p => parseRecords('[]', 'f', p)).flagged, ['stop:A4']);
});

test('A5: an object instead of a list stops, and says where lists were found', () => {
  const { flagged, items } = run(p => parseRecords('{"status":"ok","data":{"results":[{"id":"R1"}]}}', 'f', p));
  assert.deepEqual(flagged, ['stop:A5']);
  assert.match(items[0].message, /Lists found at: "data\.results"/);
  assert.match(items[0].message, /records_at/);
});

test('A5: records_at finds the list inside the file', () => {
  const { result, flagged } = run(p => parseRecords('{"data":{"results":[{"id":"R1"}]}}', 'f', p, { records_at: 'data.results' }));
  assert.deepEqual(result, [{ id: 'R1' }]);
  assert.deepEqual(flagged, []);
});

test('A5: records_at pointing at nothing, or used on a plain list, stops', () => {
  assert.deepEqual(run(p => parseRecords('{"data":{"items":[]}}', 'f', p, { records_at: 'data.results' })).flagged, ['stop:A5']);
  assert.deepEqual(run(p => parseRecords('[{"id":"R1"}]', 'f', p, { records_at: 'data' })).flagged, ['stop:A5']);
});

test('A6: unwrap takes each record out of its wrapper field, whatever it is called', () => {
  const n8n = run(p => parseRecords('[{"json":{"id":"R1"},"pairedItem":{"item":0}},{"json":{"id":"R2"}}]', 'f', p, { unwrap: 'json' }));
  assert.deepEqual(n8n.result, [{ id: 'R1' }, { id: 'R2' }]);
  assert.deepEqual(n8n.flagged, []);
  const other = run(p => parseRecords('[{"record":{"id":"R1"},"meta":{}}]', 'f', p, { unwrap: 'record' }));
  assert.deepEqual(other.result, [{ id: 'R1' }]);
});

test('A6: a record missing its wrapper field stops', () => {
  assert.deepEqual(run(p => parseRecords('[{"json":{"id":"R1"}},{"id":"R2"}]', 'f', p, { unwrap: 'json' })).flagged, ['stop:A6']);
});

test('A6: wrapped records are never unwrapped by guesswork; the tool names the setting to add', () => {
  const n8nItems = [{ json: pred({ id: 'R1' }), pairedItem: { item: 0 } }, { json: pred({ id: 'R2' }) }];
  const { result, flagged, items } = run(p => normalizePredictions(n8nItems, CONFIG, 'preds', p));
  assert.deepEqual(result, []);
  assert.deepEqual(flagged, ['stop:A6']);   // said once, not once per record
  assert.match(items[0].message, /add "unwrap": "json" under input\.predictions/);
});

test('JSON Lines: one record per line, blank lines skipped, chosen by the file extension', () => {
  const { result, flagged } = run(p => parseRecords('{"id":"R1"}\n\n{"id":"R2"}\r\n', 'run.jsonl', p));
  assert.deepEqual(result, [{ id: 'R1' }, { id: 'R2' }]);
  assert.deepEqual(flagged, []);
  assert.equal(run(p => parseRecords('{"id":"R1"}', 'run.ndjson', p)).result.length, 1);
  assert.equal(run(p => parseRecords('{"id":"R1"}\n{"id":"R2"}', 'run.txt', p, { format: 'jsonl' })).result.length, 2);
});

test('A2: a broken line in JSON Lines stops and names the line', () => {
  const { flagged, items } = run(p => parseRecords('{"id":"R1"}\n{"id": R2}\n', 'run.jsonl', p));
  assert.deepEqual(flagged, ['stop:A2']);
  assert.match(items[0].where, /line 2/);
});

test('A9: dotted paths read nested fields; a field literally named with a dot wins', () => {
  assert.equal(getPath({ output: { subject: 'x' } }, 'output.subject'), 'x');
  assert.equal(getPath({ 'output.subject': 'flat', output: { subject: 'nested' } }, 'output.subject'), 'flat');
  assert.equal(getPath({ content: [{ text: 'hi' }] }, 'content.0.text'), 'hi');
  assert.equal(getPath({ output: {} }, 'output.subject'), undefined);
  assert.equal(getPath({}, 'constructor'), undefined);   // never a built-in property
});

test('value and confidence can have other names', () => {
  const renamed = validateConfig({
    outputs: { tags: { type: 'set', field: 'out.tags', value_key: 'label', confidence_key: 'score' } },
    routing: { map: { AUTO: 'auto' } },
  }).config;
  const { result, flagged } = run(p => normalizePredictions(
    [{ id: 'R1', route: 'AUTO', out: { tags: [{ label: 'X', score: 0.8, applied: false }] } }], renamed, 'preds', p));
  assert.deepEqual(flagged, []);
  assert.deepEqual(result[0].outputs.tags, [{ value: 'X', confidence: 0.8, applied: false, inherited: false }]);
});

test('A7: an answer key passed as predictions stops (no record has a route)', () => {
  const { flagged } = run(p => normalizePredictions([key()], CONFIG, 'preds', p));
  assert.deepEqual(flagged, ['stop:A7']);
});

// ---------- B. Record ids (the per-record ones; cross-file checks are in align.js) ----------

test('B1: a record with no id stops', () => {
  assert.deepEqual(readPred(pred({ id: undefined })).flagged, ['stop:B1']);
  assert.deepEqual(readPred(pred({ id: '  ' })).flagged, ['stop:B1']);
});

test('B7 + B8: ids are compared as trimmed text', () => {
  assert.equal(readPred(pred({ id: 7 })).result[0].id, '7');
  const { result, flagged } = readPred(pred({ id: ' R1 ' }));
  assert.equal(result[0].id, 'R1');
  assert.deepEqual(flagged, ['fix:B8']);
});

// ---------- D. Set outputs ----------

test('D1 + D3: an output missing or null in a prediction means the model returned nothing', () => {
  assert.deepEqual(readPred(pred({ SUBJECT: undefined })).result[0].outputs.SUBJECT, []);
  assert.deepEqual(readPred(pred({ SUBJECT: null })).result[0].outputs.SUBJECT, []);
});

test('D2 + D3: an output missing or null in the key stops; [] is how the key says "nothing"', () => {
  assert.deepEqual(readKey(key({ SUBJECT: undefined })).flagged, ['stop:D2']);
  assert.deepEqual(readKey(key({ SUBJECT: null })).flagged, ['stop:D2']);
  assert.deepEqual(readKey(key({ SUBJECT: [] })).flagged, []);
});

test('D4: values may be plain text or { value, confidence }', () => {
  const { result } = readPred(pred({ GEOGRAPHY: ['GEO-US', { value: 'GEO-EU', confidence: 0.7 }] }));
  assert.deepEqual(result[0].outputs.GEOGRAPHY, [
    { value: 'GEO-US', confidence: null, applied: true, inherited: false },
    { value: 'GEO-EU', confidence: 0.7, applied: true, inherited: false },
  ]);
  assert.deepEqual(readPred(pred({ GEOGRAPHY: [{ code: 'GEO-US' }] })).flagged, ['stop:D4']);
  assert.deepEqual(readPred(pred({ GEOGRAPHY: [42] })).flagged, ['stop:D4']);
});

test('D5: a single text value where a list belongs stops', () => {
  assert.deepEqual(readPred(pred({ GEOGRAPHY: 'GEO-US|GEO-EU' })).flagged, ['stop:D5']);
  assert.deepEqual(readKey(key({ GEOGRAPHY: 'GEO-US' })).flagged, ['stop:D5']);
});

test('D6: the same value twice stops in strict mode', () => {
  const twice = pred({ GEOGRAPHY: [{ value: 'GEO-US', confidence: 0.7 }, { value: 'GEO-US', confidence: 0.9 }] });
  assert.deepEqual(readPred(twice).flagged, ['stop:D6']);
  assert.deepEqual(readKey(key({ GEOGRAPHY: ['GEO-US', 'GEO-US'] })).flagged, ['stop:D6']);
});

test('D6: in lenient mode it warns and keeps the higher-confidence copy', () => {
  const twice = pred({ GEOGRAPHY: [{ value: 'GEO-US', confidence: 0.7 }, { value: 'GEO-US', confidence: 0.9 }] });
  const { result, flagged } = readPred(twice, 'lenient');
  assert.deepEqual(flagged, ['warn:D6']);
  assert.equal(result[0].outputs.GEOGRAPHY.length, 1);
  assert.equal(result[0].outputs.GEOGRAPHY[0].confidence, 0.9);
});

test('D7: stray spaces around a value are trimmed and reported', () => {
  const { result, flagged } = readPred(pred({ GEOGRAPHY: [' GEO-US '] }));
  assert.equal(result[0].outputs.GEOGRAPHY[0].value, 'GEO-US');
  assert.deepEqual(flagged, ['fix:D7']);
});

test('D9: an empty value stops', () => {
  assert.deepEqual(readPred(pred({ GEOGRAPHY: ['  '] })).flagged, ['stop:D9']);
});

test('D10 + D11: applied is kept when given and assumed true when missing', () => {
  const { result } = readPred(pred({ GEOGRAPHY: [{ value: 'GEO-US', confidence: 0.55, applied: false }, 'GEO-EU'] }));
  assert.equal(result[0].outputs.GEOGRAPHY[0].applied, false);
  assert.equal(result[0].outputs.GEOGRAPHY[1].applied, true);
});

test('D12: "applied" written as the text "false" stops, because text "false" counts as true', () => {
  const { flagged, items } = readPred(pred({ GEOGRAPHY: [{ value: 'GEO-US', confidence: 0.55, applied: 'false' }] }));
  assert.deepEqual(flagged, ['stop:D12']);
  assert.match(items[0].message, /true or false/);
});

test('D17: a value inherited from another is marked as inherited', () => {
  const { result } = readPred(pred({ GEOGRAPHY: [{ value: 'GEO-US', confidence: 0.9, inherited_from: 'GEO-US-NY' }] }));
  assert.equal(result[0].outputs.GEOGRAPHY[0].inherited, true);
});

test('D15: extra fields on records are ignored', () => {
  const { result, flagged } = readPred(pred({ evidence: 'x', cost_usd: 0.01 }));
  assert.deepEqual(flagged, []);
  assert.deepEqual(Object.keys(result[0]), ['id', 'route', 'scored', 'outputs']);
});

// ---------- E. Confidence ----------

test('E1: a missing confidence is allowed, except on a gated output in strict mode', () => {
  assert.deepEqual(readPred(pred({ GEOGRAPHY: ['GEO-US'] })).flagged, []);          // not gated
  assert.deepEqual(readPred(pred({ SUBJECT: ['SUBJ-MNA'] })).flagged, ['stop:E1']);   // gated
  assert.deepEqual(readPred(pred({ SUBJECT: ['SUBJ-MNA'] }), 'lenient').flagged, ['warn:E1']);
});

test('E2: confidence written as text stops', () => {
  assert.deepEqual(readPred(pred({ SUBJECT: [{ value: 'SUBJ-MNA', confidence: '0.9' }] })).flagged, ['stop:E2']);
});

test('E3: a percentage instead of a fraction stops, and suggests the fraction', () => {
  const { flagged, items } = readPred(pred({ SUBJECT: [{ value: 'SUBJ-MNA', confidence: 85 }] }));
  assert.deepEqual(flagged, ['stop:E3']);
  assert.match(items[0].message, /0\.85/);
});

test('E4: a confidence below 0 or far above 1 stops', () => {
  assert.deepEqual(readPred(pred({ SUBJECT: [{ value: 'SUBJ-MNA', confidence: -0.1 }] })).flagged, ['stop:E4']);
  assert.deepEqual(readPred(pred({ SUBJECT: [{ value: 'SUBJ-MNA', confidence: 150 }] })).flagged, ['stop:E4']);
});

test('E6: confidence on answer-key values is ignored', () => {
  const { result, flagged } = readKey(key({ SUBJECT: [{ value: 'SUBJ-MNA', confidence: 0.9 }] }));
  assert.deepEqual(flagged, []);
  assert.deepEqual(result[0].outputs.SUBJECT, ['SUBJ-MNA']);
});

// ---------- F. Label outputs ----------

test('F1: stray spaces on a label are trimmed; a wrong-case label stops with a suggestion', () => {
  assert.equal(readPred(pred({ verdict: ' pass ' })).result[0].outputs.verdict.value, 'pass');
  const { flagged, items } = readPred(pred({ verdict: 'Pass' }));
  assert.deepEqual(flagged, ['stop:F1']);
  assert.match(items[0].message, /did you mean "pass"/);
});

test('F2: a list where one label belongs stops', () => {
  assert.deepEqual(readPred(pred({ verdict: ['pass'] })).flagged, ['stop:F2']);
});

test('F3 + F4: a missing label stops on either side', () => {
  assert.deepEqual(readPred(pred({ verdict: undefined })).flagged, ['stop:F3']);
  assert.deepEqual(readKey(key({ verdict: null })).flagged, ['stop:F4']);
});

test('labels keep their confidence in predictions and are plain text in the key', () => {
  assert.deepEqual(readPred(pred({ verdict: { value: 'fail', confidence: 0.4 } })).result[0].outputs.verdict,
    { value: 'fail', confidence: 0.4, applied: true, inherited: false });
  assert.equal(readKey(key({ verdict: 'fail' })).result[0].outputs.verdict, 'fail');
});

// ---------- Other per-record checks ----------

test('C10: "scored" must be true or false when given', () => {
  assert.equal(readPred(pred({ scored: false })).result[0].scored, false);
  assert.deepEqual(readPred(pred({ scored: 'no' })).flagged, ['stop:C10']);
});

test('H3: trap labels may be text or a list; missing means none', () => {
  assert.deepEqual(readKey(key({ trap: 'near-duplicate' })).result[0].traps, ['near-duplicate']);
  assert.deepEqual(readKey(key({ trap: ['near-duplicate', 'weak-tag'] })).result[0].traps, ['near-duplicate', 'weak-tag']);
  assert.deepEqual(readKey(key()).result[0].traps, []);
  assert.deepEqual(readKey(key({ trap: 3 })).flagged, ['stop:H3']);
});

test('H4: a trap label on a prediction is suspicious (the workflow may have seen it)', () => {
  assert.deepEqual(readPred(pred({ trap: 'near-duplicate' })).flagged, ['stop:H4']);
  assert.deepEqual(readPred(pred({ trap: 'near-duplicate' }), 'lenient').flagged, ['warn:H4']);
});

// ---------- The whole thing ----------

test('every problem in a file is reported at once', () => {
  const recs = [
    pred({ id: 'R1', SUBJECT: [{ value: 'SUBJ-MNA', confidence: '0.9' }] }),
    pred({ id: 'R2', verdict: 'Pass' }),
    pred({ id: undefined }),
  ];
  const { flagged } = run(p => normalizePredictions(recs, CONFIG, 'preds', p));
  assert.deepEqual(flagged, ['stop:E2', 'stop:F1', 'stop:B1']);
});

test('the tiny fixture loads with nothing to fix and R5\'s rejected tag intact', () => {
  const dir = path.join(__dirname, 'fixtures', 'tiny');
  const config = loadConfig(path.join(dir, 'config.json'));
  const { predictions, key: answers, problems: found } = loadRun({
    config, predPath: path.join(dir, 'predictions.json'), keyPath: path.join(dir, 'key.json'),
  });
  assert.equal(predictions.length, 6);
  assert.equal(answers.length, 6);
  assert.deepEqual(found, []);
  const r5 = predictions.find(r => r.id === 'R5');
  assert.deepEqual(r5.outputs.SUBJECT, [{ value: 'SUBJ-LAB', confidence: 0.55, applied: false, inherited: false }]);
  assert.deepEqual(answers.find(r => r.id === 'R2').traps, ['plausible-extra-tag']);
});

test('rejected_field: values listed separately join the output as not applied', () => {
  const cfg = validateConfig({
    outputs: { tags: { type: 'set', rejected_field: 'rejected.tags' } },
    routing: { map: { AUTO: 'auto' } },
  }).config;
  const rec = { id: 'R1', route: 'AUTO', tags: ['A'], rejected: { tags: [{ value: 'B', confidence: 0.5 }, 'C'] } };
  const { result, flagged } = run(p => normalizePredictions([rec], cfg, 'preds', p));
  assert.deepEqual(flagged, []);
  assert.deepEqual(result[0].outputs.tags.map(v => [v.value, v.applied]), [['A', true], ['B', false], ['C', false]]);
});

test('D19: a value in the rejected list marked as applied stops', () => {
  const cfg = validateConfig({ outputs: { tags: { type: 'set', rejected_field: 'rej' } }, routing: { map: { AUTO: 'auto' } } }).config;
  const { flagged } = run(p => normalizePredictions([{ id: 'R1', route: 'AUTO', tags: [], rej: [{ value: 'B', applied: true }] }], cfg, 'preds', p));
  assert.deepEqual(flagged, ['stop:D19']);
});

test('E8: a label confidence given both with the label and in its own field stops', () => {
  const cfg = validateConfig({
    outputs: { verdict: { type: 'label', labels: ['pass', 'fail'], confidence_field: 'conf' } },
    routing: { map: { AUTO: 'auto' } },
  }).config;
  const both = { id: 'R1', route: 'AUTO', verdict: { value: 'pass', confidence: 0.9 }, conf: 0.8 };
  assert.deepEqual(run(p => normalizePredictions([both], cfg, 'preds', p)).flagged, ['stop:E8']);
  const one = { id: 'R1', route: 'AUTO', verdict: 'pass', conf: 0.8 };
  assert.equal(run(p => normalizePredictions([one], cfg, 'preds', p)).result[0].outputs.verdict.confidence, 0.8);
});

test('E1: a gated label with no confidence stops in strict mode', () => {
  const cfg = validateConfig({
    outputs: { verdict: { type: 'label', labels: ['pass', 'fail'] } },
    routing: { map: { AUTO: 'auto' } },
    thresholds: { auto_publish: { verdict: 0.85 } },
  }).config;
  assert.deepEqual(run(p => normalizePredictions([{ id: 'R1', route: 'AUTO', verdict: 'pass' }], cfg, 'preds', p)).flagged, ['stop:E1']);
});

test('the same records from an n8n export, a JSON Lines log and an API response load identically', () => {
  const tiny = path.join(__dirname, 'fixtures', 'tiny');
  const shapes = path.join(__dirname, 'fixtures', 'shapes');
  const keyPath = path.join(tiny, 'key.json');
  const expected = loadRun({ config: loadConfig(path.join(tiny, 'config.json')), predPath: path.join(tiny, 'predictions.json'), keyPath }).predictions;

  for (const [cfg, file] of [['n8n.config.json', 'n8n.json'], ['agent.config.json', 'agent.jsonl'], ['api.config.json', 'api.json']]) {
    const got = loadRun({ config: loadConfig(path.join(shapes, cfg)), predPath: path.join(shapes, file), keyPath });
    assert.deepEqual(got.predictions, expected, file);
    assert.deepEqual(got.problems, [], file);
  }
});

test('A10: predictions and answers can share one file', () => {
  const tiny = path.join(__dirname, 'fixtures', 'tiny');
  const expected = loadRun({ config: loadConfig(path.join(tiny, 'config.json')), predPath: path.join(tiny, 'predictions.json'), keyPath: path.join(tiny, 'key.json') });
  const shapes = path.join(__dirname, 'fixtures', 'shapes');
  const file = path.join(shapes, 'combined.json');
  const got = loadRun({ config: loadConfig(path.join(shapes, 'combined.config.json')), predPath: file, keyPath: file });
  assert.deepEqual(got.predictions, expected.predictions);
  assert.deepEqual(got.key, expected.key);
  assert.deepEqual(got.problems, []);   // no H4: the trap label is in the record by design
});

test('loadRun refuses to continue when anything stops, and lists every problem', () => {
  const config = loadConfig(path.join(__dirname, 'fixtures', 'tiny', 'config.json'));
  assert.throws(
    () => loadRun({ config, predPath: 'missing-preds.json', keyPath: 'missing-key.json' }),
    err => /2 problem\(s\)/.test(err.message) && /missing-preds/.test(err.message) && /missing-key/.test(err.message),
  );
});
