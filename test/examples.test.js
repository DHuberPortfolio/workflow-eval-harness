// Real data: the metadata enrichment workflow's run 49, through its adapter, must reproduce
// the figures that workflow's own scorecard reported (asserted there by verify.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig } = require('../src/config.js');
const { scoreRun } = require('../src/score.js');
const { gateSweep } = require('../src/metrics/whatif.js');
const { branchOf } = require('../examples/metadata-enrichment/adapter.js');

const dir = path.join(__dirname, '..', 'examples', 'metadata-enrichment');
const config = loadConfig(path.join(dir, 'config.json'));
const file = path.join(dir, 'run49.json');
const R = scoreRun({ config, predPath: file, keyPath: file });

test('run 49: routing figures match the workflow scorecard', () => {
  const r = R.routing;
  assert.deepEqual(r.by_route, { AUTO_PUBLISH: 7, EDITOR_REVIEW: 15, DUPLICATE_SUPPRESSED: 2 });
  assert.deepEqual([r.straight_through.n, r.straight_through.d, r.straight_through.pct], [7, 24, 29.2]);
  assert.deepEqual([r.silent_errors.rate.n, r.silent_errors.rate.d], [0, 7]);
  assert.equal(r.silent_errors.rate.high_pct, 35.4);   // 0 of 7 could still be 35%
  assert.deepEqual([r.review_queue.precision.n, r.review_queue.precision.d, r.review_queue.precision.pct], [14, 15, 93.3]);
  assert.deepEqual(r.review_queue.wasted, ['A24']);
});

test('run 49: facet quality matches the workflow scorecard', () => {
  const q = R.quality.outputs;
  const row = f => [q[f].precision.pct, q[f].recall.pct, q[f].f1, q[f].tp + '/' + q[f].fp + '/' + q[f].fn];
  assert.deepEqual(row('SUBJECT'), [93.8, 73.2, 0.822, '30/2/11']);
  assert.equal(q.SUBJECT.exact_match.pct, 54.5);
  assert.deepEqual(row('INDUSTRY'), [100, 82.8, 0.906, '24/0/5']);
  assert.deepEqual(row('GEOGRAPHY'), [100, 95, 0.974, '38/0/2']);
  assert.deepEqual(row('COMPANY'), [100, 100, 1, '16/0/0']);
  assert.deepEqual(R.quality.left_out.suppressed_duplicates, ['A02', 'A19']);
});

test('run 49: every applied value is in the controlled vocabulary or authority file', () => {
  assert.ok(!R.routing.not_measured.some(n => n.what === 'SP-INVALID'));
  assert.ok(!R.records.some(x => Object.keys(x.differences.invalid).length));
});

test('run 49: the gate what-if reproduces every gate-decided route at the current thresholds', () => {
  const g = gateSweep(R.paired, config, { outputs: ['INDUSTRY'] });
  assert.equal(g.check.differing.length, 0);
  assert.equal(g.check.movable, 9);
  assert.deepEqual(g.rows.find(x => x.threshold === 0.6).silent_errors, ['A21']);
});

test('the adapter stops on a decision reason it does not recognise', () => {
  assert.equal(branchOf({ article_id: 'A1', decision_reason: 'All tags in vocabulary, ...' }), 'auto');
  assert.throws(() => branchOf({ article_id: 'A1', decision_reason: 'Something new' }), /unrecognised decision_reason/);
});

// Real data: three fresh runs of the same workflow (executions 61-63), saved from its
// Harness Export node. Each file was checked against that run's own scorecard when saved.
test('runs 61-63: identical code, the numbers that moved and the one value stated every run', () => {
  const { varianceRun } = require('../src/score.js');
  const runs = [61, 62, 63].map(n => path.join(dir, 'runs', 'exec-' + n + '.json'));
  const v = varianceRun({ config, keyPath: runs[0], predPaths: runs });
  const metric = name => v.metrics.find(m => m.name === name).values;
  assert.deepEqual(metric('silent error rate'), [0, 0, 0]);
  assert.deepEqual(metric('straight-through'), [29.2, 33.3, 33.3]);
  assert.deepEqual(v.records.route_changed.map(r => [r.id, r.routes.join(' ')]), [['A22', 'EDITOR_REVIEW AUTO_PUBLISH AUTO_PUBLISH']]);
  // SUBJ-ANTI on A01 is stated in every run and the key leaves it out on purpose: the
  // workflow's salience gate exists for exactly this marginal claim (trap I7).
  assert.deepEqual(v.records.key_gap_candidates.filter(g => g.runs === g.of).map(g => [g.id, g.value]), [['A01', 'SUBJ-ANTI']]);
  assert.deepEqual(v.problems, []);
});
