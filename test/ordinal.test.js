// Ordinal outputs (ordered labels), checked against test/fixtures/ordinal/EXPECTED.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig, validateConfig } = require('../src/config.js');
const { scoreRun, compareRun } = require('../src/score.js');

const dir = path.join(__dirname, 'fixtures', 'ordinal');
const args = { predPath: path.join(dir, 'predictions.json'), keyPath: path.join(dir, 'key.json') };
const R = scoreRun({ config: loadConfig(path.join(dir, 'config.json')), ...args });

test('ordinal: exact, within one step, average distance, lean and closeness', () => {
  const b = R.quality.outputs.band;
  assert.equal(b.type, 'ordinal');
  assert.deepEqual([b.accuracy.n, b.accuracy.d, b.accuracy.pct], [2, 6, 33.3]);
  assert.deepEqual([b.within_one.n, b.within_one.pct], [4, 66.7]);
  assert.deepEqual([b.mean_distance, b.mean_signed, b.closeness], [1.17, -0.83, 0.708]);
  assert.deepEqual([b.predicted_higher, b.predicted_lower], [1, 3]);
  assert.deepEqual(b.miss_distances, { 1: 2, 2: 1, 3: 1 });
});

test('ordinal: a near miss is a low-severity silent error, a far miss a high one', () => {
  const s = R.routing.silent_errors;
  assert.deepEqual([s.rate.n, s.rate.d], [2, 4]);
  assert.deepEqual(s.records.map(x => [x.id, x.severity, x.types]), [
    ['C2', 'low', ['SP-NEAR-MISS']],
    ['C5', 'high', ['SP-WRONG', 'SP-SHOULD-REVIEW']],
  ]);
  assert.deepEqual(s.records[0].differences.near_miss, { band: ['4 for 5'] });
  assert.deepEqual(s.records[1].differences.wrong, { band: ['1 for 4'] });
});

test('ordinal: routing around the bands', () => {
  const r = R.routing;
  assert.deepEqual([r.straight_through.n, r.straight_through.d], [4, 6]);
  assert.deepEqual(r.silent_omissions.records.map(x => [x.id, x.types[0]]), [['C3', 'SO-FALSE-BLOCK']]);
  assert.deepEqual([r.review_queue.precision.n, r.review_queue.precision.d], [1, 1]);
  assert.deepEqual([r.block.precision.n, r.block.precision.d], [0, 1]);
});

test('ordinal: near_miss_steps 0 makes every miss a full miss', () => {
  const config = loadConfig(path.join(dir, 'config.json'));
  config.outputs.band.near_miss_steps = 0;
  const c2 = scoreRun({ config, ...args }).routing.silent_errors.records.find(x => x.id === 'C2');
  assert.deepEqual([c2.severity, c2.types], ['high', ['SP-WRONG']]);
});

test('ordinal: the config checks labels and near_miss_steps', () => {
  const base = { routing: { map: { A: 'auto' } } };
  assert.deepEqual(validateConfig({ ...base, outputs: { b: { type: 'ordinal', labels: [1, 2, 3], near_miss_steps: 2 } } }).errors, []);
  assert.deepEqual(validateConfig({ ...base, outputs: { b: { type: 'ordinal', labels: [1, 2, 3] } } }).config.outputs.b.labels, ['1', '2', '3']);
  assert.match(validateConfig({ ...base, outputs: { b: { type: 'ordinal' } } }).errors[0], /labels must list/);
  assert.match(validateConfig({ ...base, outputs: { b: { type: 'label', labels: ['x', 'y'], near_miss_steps: 1 } } }).errors[0], /near_miss_steps only applies to type "ordinal"/);
  assert.match(validateConfig({ ...base, outputs: { b: { type: 'ordinal', labels: [1, 2], near_miss_steps: -1 } } }).errors[0], /whole number of 0 or more/);
});

test('ordinal: variance and compare follow within-one-step and closeness', () => {
  const config = loadConfig(path.join(dir, 'config.json'));
  const c = compareRun({ config, keyPath: args.keyPath, beforePath: args.predPath, afterPath: args.predPath });
  assert.ok(c.metrics.some(m => m.name === 'band within one step'));
  assert.ok(c.metrics.some(m => m.name === 'band closeness'));
});
