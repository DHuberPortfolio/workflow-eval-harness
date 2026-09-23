// What-if, checked against the "What-if" sections of test/fixtures/tiny/EXPECTED.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig, validateConfig } = require('../src/config.js');
const { scoreRun } = require('../src/score.js');
const { gateSweep, floorSweep, steps } = require('../src/metrics/whatif.js');

const dir = path.join(__dirname, 'fixtures', 'tiny');
const config = loadConfig(path.join(dir, 'config.json'));
const { paired } = scoreRun({ config, predPath: path.join(dir, 'predictions.json'), keyPath: path.join(dir, 'key.json') });

const G = gateSweep(paired, config);
const row = t => G.rows.find(r => r.threshold === t);
const frac = r => (r.d === 0 ? 'none' : r.n + '/' + r.d);

test('gate sweep: who goes through, and the silent errors, at each threshold', () => {
  const summary = t => [row(t).through.join(' '), frac(row(t).straight_through), row(t).silent_errors.join(' '), frac(row(t).silent_error_rate)];
  assert.deepEqual(summary(0.5), ['R1 R2 R3 R4', '4/6', 'R2 R3', '2/4']);
  assert.deepEqual(summary(0.7), ['R1 R2 R3 R4', '4/6', 'R2 R3', '2/4']);
  assert.deepEqual(summary(0.75), ['R1 R2 R4', '3/6', 'R2', '1/3']);
  assert.deepEqual(summary(0.8), ['R1 R2 R4', '3/6', 'R2', '1/3']);
  assert.deepEqual(summary(0.85), ['R1 R2', '2/6', 'R2', '1/2']);
  assert.deepEqual(summary(0.9), ['R1 R2', '2/6', 'R2', '1/2']);
  assert.deepEqual(summary(0.95), ['R1', '1/6', '', '0/1']);
  assert.deepEqual(summary(1), ['', '0/6', '', 'none']);
});

test('gate sweep: the current threshold is marked, and the simulation reproduces the real routes there', () => {
  assert.deepEqual(G.rows.filter(r => r.current).map(r => r.threshold), [0.85]);
  assert.deepEqual(G.check, { threshold: 0.85, movable: 4, reproduced: 4, differing: [] });
  assert.match(G.assumption, /upper bound/);
});

test('gate sweep: moving the gate reports which records moved in and out', () => {
  assert.deepEqual([row(0.8).moved_in, row(0.8).moved_out], [['R4'], []]);
  assert.deepEqual([row(0.95).moved_in, row(0.95).moved_out], [[], ['R2']]);
});

test('gate sweep: a record moved in is not flagged as a safeguard failure at its own threshold', () => {
  assert.equal(row(0.8).safeguard_failures, 0);
});

const F = floorSweep(paired, config);
const frow = f => F.rows.find(r => r.floor === f);

test('floor sweep: values re-admitted or evicted, precision / recall / F1, needs replay', () => {
  const summary = f => {
    const r = frow(f);
    return [r.readmitted.concat(r.evicted.map(e => '-' + e)).join(', '), r.needs_replay.join(' '),
      r.overall.tp + '/' + r.overall.fp + '/' + r.overall.fn, r.overall.precision.pct, r.overall.recall.pct, r.overall.f1, r.silent_errors.join(' ')];
  };
  assert.deepEqual(summary(0.55), ['R5 SUBJ-LAB', 'R5', '10/1/1', 90.9, 90.9, 0.909, 'R2']);
  assert.deepEqual(summary(0.6), ['', '', '9/1/2', 90, 81.8, 0.857, 'R2']);
  assert.deepEqual(summary(0.7), ['-R3 GEO-UK', '', '8/1/3', 88.9, 72.7, 0.8, 'R2']);
  assert.deepEqual(frow(0.9).overall.tp + '/' + frow(0.9).overall.fp + '/' + frow(0.9).overall.fn, '4/0/7');
  assert.deepEqual([frow(0.9).overall.recall.pct, frow(0.9).overall.f1, frow(0.9).needs_replay], [36.4, 0.533, ['R5']]);
  assert.deepEqual(frow(0.9).moved, []);
  assert.equal(frow(0.6).current, true);
});

test('with whatif.movable_field, only the marked records can move', () => {
  const cfg = validateConfig({
    outputs: { t: { type: 'set' } }, routing: { map: { A: 'auto', R: 'review' } },
    thresholds: { auto_publish: { t: 0.85 } }, whatif: { movable_field: 'branch', movable_values: [6, 7] },
  }).config;
  const rec = (id, cls, conf, movable) => ({ id, route: cls === 'auto' ? 'A' : 'R', route_class: cls, gold_class: null, scored: true, movable,
    traps: [], duplicate_of: null, pred: { t: [{ value: 'x', confidence: conf, applied: true, inherited: false }] }, key: { t: ['x'] } });
  // Both held at 0.80; only the gate-held one may be released when the gate drops to 0.80.
  const records = [rec('gate-held', 'review', 0.8, true), rec('rule-held', 'review', 0.8, false)];
  const g = gateSweep(records, cfg);
  assert.deepEqual(g.rows.find(r => r.threshold === 0.8).through, ['gate-held']);
  assert.match(g.assumption, /movable by branch/);
});

test('the what-ifs refuse configs they cannot use', () => {
  const noGate = validateConfig({ outputs: { t: { type: 'set' } }, routing: { map: { A: 'auto' } } }).config;
  assert.throws(() => gateSweep([], noGate), /needs thresholds\.auto_publish/);
  assert.throws(() => floorSweep([], noGate), /needs thresholds\.floor/);
  assert.throws(() => gateSweep(paired, config, { outputs: ['GEOGRAPHY'] }), /no auto_publish threshold/);
});

test('threshold steps land exactly on round numbers', () => {
  assert.deepEqual(steps(0.5, 1, 0.05), [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1]);
});
