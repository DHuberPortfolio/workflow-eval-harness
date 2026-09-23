// Variance and compare, checked against test/fixtures/runs/EXPECTED.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig } = require('../src/config.js');
const { varianceRun, compareRun } = require('../src/score.js');

const tiny = path.join(__dirname, 'fixtures', 'tiny');
const runs = path.join(__dirname, 'fixtures', 'runs');
const config = loadConfig(path.join(tiny, 'config.json'));
const keyPath = path.join(tiny, 'key.json');
const run = x => path.join(runs, 'run-' + x + '.json');
const metric = (result, name) => result.metrics.find(m => m.name === name);

const V = varianceRun({ config, keyPath, predPaths: [run('a'), run('b'), run('c')] });

test('variance: silent error rate per run, mean, spread, range', () => {
  const m = metric(V, 'silent error rate');
  assert.deepEqual(m.values, [50, 0, 33.3]);
  assert.deepEqual([m.mean, m.sd, m.min, m.max, m.range], [27.8, 25.5, 0, 50, 50]);
});

test('variance: straight-through and review-queue precision per run', () => {
  const st = metric(V, 'straight-through');
  assert.deepEqual(st.values, [33.3, 16.7, 50]);
  assert.deepEqual([st.mean, st.sd, st.range], [33.3, 16.7, 33.3]);
  assert.deepEqual(metric(V, 'review-queue precision').values, [50, 66.7, 100]);
});

test('variance: the records that behave differently from run to run', () => {
  assert.deepEqual(V.records.route_changed.map(r => [r.id, r.routes.join(' ')]), [
    ['R2', 'AUTO_PUBLISH EDITOR_REVIEW AUTO_PUBLISH'],
    ['R4', 'EDITOR_REVIEW EDITOR_REVIEW AUTO_PUBLISH'],
  ]);
  assert.deepEqual(V.records.silent_changed, [{ id: 'R2', silent: [true, false, true] }]);
});

test('I1: variance needs at least two runs', () => {
  assert.throws(() => varianceRun({ config, keyPath, predPaths: [run('a')] }), /I1/);
});

test('I3: the same run passed twice is a warning', () => {
  const v = varianceRun({ config, keyPath, predPaths: [run('a'), path.join(tiny, 'predictions.json')] });
  assert.deepEqual(v.problems.map(p => p.trap), ['I3']);
});

test('compare a -> b: a 50-point drop in silent errors, yet within the noise of identical runs', () => {
  const c = compareRun({ config, keyPath, beforePath: run('a'), afterPath: run('b'), noisePaths: [run('a'), run('b'), run('c')] });
  const m = metric(c, 'silent error rate');
  assert.deepEqual([m.before, m.after, m.delta, m.noise_range, m.verdict], [50, 0, -50, 50, 'within noise']);
  assert.deepEqual(c.records.route_changed, [{ id: 'R2', before: 'AUTO_PUBLISH', after: 'EDITOR_REVIEW', should: 'EDITOR_REVIEW', outcome: 'fixed' }]);
  assert.deepEqual(c.records.no_longer_silent.map(x => x.id), ['R2']);
  assert.deepEqual(c.summary, { routes_fixed: 1, routes_broken: 0 });
});

test('compare a -> c: R4 fixed; straight-through +16.7 points, within noise', () => {
  const c = compareRun({ config, keyPath, beforePath: run('a'), afterPath: run('c'), noisePaths: [run('a'), run('b'), run('c')] });
  const st = metric(c, 'straight-through');
  assert.deepEqual([st.delta, st.verdict], [16.7, 'within noise']);
  assert.deepEqual(c.records.route_changed.map(x => [x.id, x.outcome]), [['R4', 'fixed']]);
});

test('compare without a noise baseline says so rather than guessing', () => {
  const c = compareRun({ config, keyPath, beforePath: run('a'), afterPath: run('b') });
  assert.equal(metric(c, 'silent error rate').verdict, 'no noise baseline');
  assert.equal(metric(c, 'GEOGRAPHY F1').verdict, 'no change');
});
