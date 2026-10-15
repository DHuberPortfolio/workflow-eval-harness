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
  // 0 silent errors in 23 records out is the same 8 articles again and again (trap I8). The
  // figure to quote is one run's: all three are 0%, and 0 of 7 has the widest range.
  const w = v.silent_error_rate.worst_run;
  assert.deepEqual([w.run, w.n, w.d, w.high_pct], [1, 0, 7, 35.4]);
  assert.deepEqual([v.silent_error_rate.times_out, v.silent_error_rate.records_out], [23, 8]);
});

// Real data: both workflows on their 500-record golden sets. These pin the figures the README
// and the example notes publish.
test('Golden 500, compliance run 67: 25 silent errors in 256, 15 of them award claims', () => {
  const C = path.join(__dirname, '..', 'examples', 'compliance-reviewer');
  const run = path.join(C, 'golden500', 'exec-67.harness.json');
  const r = scoreRun({ config: loadConfig(path.join(C, 'config.json')), predPath: run, keyPath: run });
  assert.deepEqual([r.routing.silent_errors.rate.n, r.routing.silent_errors.rate.d], [25, 256]);
  assert.deepEqual([r.routing.silent_errors.rate.low_pct, r.routing.silent_errors.rate.high_pct], [6.7, 14]);
  assert.equal(r.routing.review_queue.wasted.length, 26);
  const award = r.records.filter(x => x.silent && (x.differences.missing_rejected.violations || []).includes('AWARD_CLAIM_REVIEW'));
  assert.equal(award.length, 15);
});

test('Golden 500, metadata: v3 below 10% in three identical runs, beyond the noise of v2', () => {
  const { varianceRun, compareRun } = require('../src/score.js');
  const G = path.join(dir, 'golden500');
  const cfg = loadConfig(path.join(G, 'config.json'));
  const run = n => path.join(G, 'exec-' + n + '.json');
  const v = varianceRun({ config: cfg, keyPath: run(70), predPaths: [run(70), run(71), run(72)] });
  assert.deepEqual(v.metrics.find(m => m.name === 'silent error rate').values, [6.5, 6.3, 8.6]);
  // The figure to quote is the worst run, never the runs added together (trap I8): their 615
  // records out are 254 different articles.
  const w = v.silent_error_rate.worst_run;
  assert.deepEqual([w.run, w.n, w.d, w.low_pct, w.high_pct], [3, 18, 210, 5.5, 13.1]);
  assert.deepEqual([v.silent_error_rate.times_out, v.silent_error_rate.records_out], [615, 254]);
  const c = compareRun({ config: cfg, keyPath: run(70), beforePath: run(69), afterPath: run(71), noisePaths: [run(70), run(71), run(72)] });
  assert.equal(c.metrics.find(m => m.name === 'silent error rate').verdict, 'beyond noise');
  const v1 = scoreRun({ config: cfg, predPath: run(68), keyPath: run(68) });
  assert.deepEqual([v1.routing.silent_errors.rate.n, v1.routing.silent_errors.rate.d], [54, 200]);
  // Inside the 500, v1 again sent the original 24 articles out without an error (0 of 9).
  const out = v1.records.filter(r => r.route_class === 'auto');
  const original = out.filter(r => /^A\d+$/.test(r.id));
  assert.deepEqual([original.filter(r => r.silent).length, original.length], [0, 9]);
});

// The guard's 0.40 was chosen on the articles whose id's CRC-32 (zlib's) is even, and checked
// on the odd ones. Written out because zlib.crc32 needs Node 22.2.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = s => { let c = 0xffffffff; for (const b of Buffer.from(s)) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

test('Golden 500, metadata: v3 run by run on the tuning and held-out halves, and v1 articles missing a regulation or litigation subject', () => {
  const { rate } = require('../src/metrics/stats.js');
  assert.equal(crc32('123456789'), 0xcbf43926);   // the standard CRC-32 check value
  const G = path.join(dir, 'golden500');
  const cfg = loadConfig(path.join(G, 'config.json'));
  const run = n => path.join(G, 'exec-' + n + '.json');
  // Each run on its own; never added up (trap I8).
  const halves = { tuning: [], held_out: [] };
  for (const n of [70, 71, 72]) {
    const out = scoreRun({ config: cfg, predPath: run(n), keyPath: run(n) }).records.filter(r => r.route_class === 'auto');
    for (const [name, parity] of [['tuning', 0], ['held_out', 1]]) {
      const half = out.filter(r => crc32(r.id) % 2 === parity);
      halves[name].push([half.filter(r => r.silent).length, half.length]);
    }
  }
  assert.deepEqual(halves.tuning, [[8, 107], [6, 100], [10, 105]]);
  assert.deepEqual(halves.held_out, [[5, 92], [7, 106], [8, 105]]);
  const worst = rate(8, 105);
  assert.deepEqual([worst.pct, worst.low_pct, worst.high_pct], [7.6, 3.9, 14.3]);
  // v1: count articles, not problems. B223 is missing both subjects.
  const silent = scoreRun({ config: cfg, predPath: run(68), keyPath: run(68) }).records.filter(r => r.silent);
  const missing = (r, code) => ['missing', 'missing_rejected'].some(b => ((r.differences[b] || {}).SUBJECT || []).includes(code));
  assert.equal(silent.filter(r => missing(r, 'SUBJ-REG') || missing(r, 'SUBJ-LIT')).length, 36);
  assert.deepEqual(silent.filter(r => missing(r, 'SUBJ-REG') && missing(r, 'SUBJ-LIT')).map(r => r.id), ['B223']);
});
