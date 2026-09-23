// Variance and compare, checked against test/fixtures/runs/EXPECTED.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig, validateConfig } = require('../src/config.js');
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

test('I7: a value stated in every run that the key lacks is listed for a person, not trusted', () => {
  assert.deepEqual(V.records.key_gap_candidates, [
    { id: 'R2', output: 'SUBJECT', value: 'SUBJ-ANTI', runs: 3, of: 3, applied: 3, confidence: { min: 0.8, max: 0.88 } },
  ]);
});

test('key gaps leave out invented, inherited, suppressed and unscored values', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { config: cfg, errors } = validateConfig({
    id_field: 'id',
    outputs: { TAGS: { type: 'set' } },
    routing: { field: 'route', map: { GO: 'auto', DUP: 'exclude' } },
    allowed_values: { TAGS: ['A', 'B', 'C', 'D'] },
  });
  assert.deepEqual(errors, []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-gaps-'));
  const write = (name, rows) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(rows)); return f; };
  const A = { value: 'A', confidence: 0.9 };
  const key = write('key.json', ['X1', 'X2', 'X3', 'X4'].map(id => ({ id, TAGS: ['A'] })));
  const one = write('one.json', [
    // B is a candidate; Z is not an allowed value; C only follows from B
    { id: 'X1', route: 'GO', TAGS: [A, { value: 'B', confidence: 0.7 }, { value: 'Z', confidence: 0.9 }, { value: 'C', confidence: 0.8, inherited_from: 'B' }] },
    { id: 'X2', route: 'GO', TAGS: [A, { value: 'B', confidence: 0.6, applied: false }] },
    { id: 'X3', route: 'DUP', TAGS: [A, { value: 'D', confidence: 0.9 }] },
    { id: 'X4', route: 'GO', TAGS: [A, { value: 'B', confidence: 0.8 }] },
  ]);
  const two = write('two.json', [
    { id: 'X1', route: 'GO', TAGS: [A, { value: 'B', confidence: 0.9 }] },
    { id: 'X2', route: 'GO', TAGS: [A] },
    { id: 'X3', route: 'DUP', TAGS: [A, { value: 'D', confidence: 0.9 }] },
    { id: 'X4', route: 'GO', scored: false, TAGS: [] },   // the model call failed
  ]);
  const v = varianceRun({ config: cfg, keyPath: key, predPaths: [one, two] });
  assert.deepEqual(v.records.key_gap_candidates, [
    { id: 'X1', output: 'TAGS', value: 'B', runs: 2, of: 2, applied: 2, confidence: { min: 0.7, max: 0.9 } },
    { id: 'X2', output: 'TAGS', value: 'B', runs: 1, of: 2, applied: 0, confidence: { min: 0.6, max: 0.6 } },
    { id: 'X4', output: 'TAGS', value: 'B', runs: 1, of: 2, applied: 1, confidence: { min: 0.8, max: 0.8 } },
  ]);
  fs.rmSync(dir, { recursive: true });
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

test('I6: a run with failed model calls is flagged before it is compared', () => {
  const E = path.join(__dirname, '..', 'examples', 'compliance-reviewer');
  const cfg = loadConfig(path.join(E, 'config.json'));
  const fs = require('node:fs');
  const os = require('node:os');
  const clean = path.join(E, 'runs', 'exec-56.harness.json');
  const rows = JSON.parse(fs.readFileSync(clean, 'utf8'));
  rows[30] = { ...rows[30], scored: false, output: { violations: [] } };   // one call failed
  const failed = path.join(os.tmpdir(), 'wfeval-failed-run.json');
  fs.writeFileSync(failed, JSON.stringify(rows));
  const c = compareRun({ config: cfg, keyPath: clean, beforePath: clean, afterPath: failed });
  assert.deepEqual(c.problems.map(p => p.trap), ['I6']);
  assert.equal(c.metrics.find(m => m.name === 'model calls failed').after, 1);
  fs.unlinkSync(failed);
});
