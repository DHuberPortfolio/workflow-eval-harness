// The metrics, checked against the hand-worked answers in test/fixtures/*/EXPECTED.md.
// If a test here fails, find out whether the code or EXPECTED.md is wrong before changing either.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig, validateConfig } = require('../src/config.js');
const { scoreRun, scoreRecords } = require('../src/score.js');

const fixture = name => {
  const dir = path.join(__dirname, 'fixtures', name);
  const csv = name === 'compliance';
  return scoreRun({
    config: loadConfig(path.join(dir, 'config.json')),
    predPath: path.join(dir, csv ? 'predictions.csv' : 'predictions.json'),
    keyPath: path.join(dir, csv ? 'key.csv' : 'key.json'),
  });
};
const TINY = fixture('tiny');
const COMP = fixture('compliance');
const pcts = r => [r.n, r.d, r.pct];

// ---------- tiny: output quality ----------

test('tiny: SUBJECT, GEOGRAPHY and overall precision / recall / F1', () => {
  const q = TINY.quality;
  assert.equal(q.population, 5);
  assert.deepEqual(q.left_out, { model_failed: [], suppressed_duplicates: ['R6'] });
  const s = q.outputs.SUBJECT;
  assert.deepEqual([s.tp, s.fp, s.fn, s.precision.pct, s.recall.pct, s.f1], [4, 1, 1, 80, 80, 0.8]);
  const g = q.outputs.GEOGRAPHY;
  assert.deepEqual([g.tp, g.fp, g.fn, g.precision.pct, g.recall.pct, g.f1], [5, 0, 1, 100, 83.3, 0.909]);
  const o = q.overall;
  assert.deepEqual([o.tp, o.fp, o.fn, o.precision.pct, o.recall.pct, o.f1], [9, 1, 2, 90, 81.8, 0.857]);
});

test('tiny: per-value scores show which code is the problem', () => {
  const v = TINY.quality.outputs.SUBJECT.by_value;
  assert.deepEqual([v['SUBJ-ANTI'].tp, v['SUBJ-ANTI'].fp, v['SUBJ-ANTI'].f1], [0, 1, 0]);   // G4: 0, not null
  assert.deepEqual([v['SUBJ-LAB'].tp, v['SUBJ-LAB'].fn, v['SUBJ-LAB'].recall.pct], [0, 1, 0]);
  assert.equal(v['SUBJ-LAB'].precision.pct, null);   // never applied: 0 / 0 is "nothing to measure" (G3)
});

// ---------- tiny: routing ----------

test('tiny: headline routing numbers', () => {
  const r = TINY.routing;
  assert.deepEqual(r.by_class, { auto: 2, review: 2, block: 1, exclude: 1 });
  assert.deepEqual(pcts(r.straight_through), [2, 6, 33.3]);
  assert.deepEqual(pcts(r.silent_errors.rate), [1, 2, 50]);
  assert.deepEqual([r.silent_errors.rate.low_pct, r.silent_errors.rate.high_pct], [9.5, 90.5]);
  assert.equal(r.silent_errors.one_record_moves_pct, 50);
  assert.deepEqual(pcts(r.silent_omissions.rate), [0, 4, 0]);
  assert.deepEqual(pcts(r.review_queue.precision), [1, 2, 50]);
  assert.deepEqual(r.review_queue.wasted, ['R4']);
  assert.deepEqual(pcts(r.block.precision), [1, 1, 100]);
  assert.equal(r.safeguard_failures.records, 0);
});

test('tiny: R2 is a silent error of two types, high severity, and shows what differed', () => {
  const [r2] = TINY.routing.silent_errors.records;
  assert.equal(r2.id, 'R2');
  assert.deepEqual(r2.types, ['SP-WRONG', 'SP-SHOULD-REVIEW']);
  assert.equal(r2.severity, 'high');
  assert.deepEqual(r2.differences.wrong, { SUBJECT: ['SUBJ-ANTI'] });
  assert.deepEqual(TINY.routing.silent_errors.by_severity, { critical: 0, high: 1, medium: 0, low: 0 });
});

test('tiny: per trap', () => {
  const rows = TINY.traps.groups.map(g => [g.trap, g.records.join(' '), g.routed_correctly.n + '/' + g.routed_correctly.d,
    g.silent_errors.join(' '), g.silent_omissions.join(' '), g.wasted_reviews.join(' ')]);
  assert.deepEqual(rows, [
    ['(none)', 'R1', '1/1', '', '', ''],
    ['correct-but-unsure', 'R4 R5', '1/2', '', '', 'R4'],
    ['missing-secondary-geo', 'R3', '1/1', '', '', ''],
    ['near-duplicate', 'R6', '1/1', '', '', ''],
    ['plausible-extra-tag', 'R2', '0/1', 'R2', '', ''],
  ]);
});

// ---------- tiny: calibration ----------

test('tiny: calibration buckets, one per stated value, and the average gap', () => {
  const c = TINY.calibration;
  assert.equal(c.buckets, 'distinct');
  assert.deepEqual([c.overall.n, c.overall.correct, c.overall.ece], [11, 10, 0.278]);
  assert.deepEqual(c.overall.buckets.map(b => [b.stated, b.n, b.correct, b.gap]), [
    [0.55, 1, 1, 0.45], [0.65, 1, 1, 0.35], [0.7, 2, 2, 0.3], [0.75, 1, 1, 0.25], [0.8, 1, 1, 0.2],
    [0.88, 1, 0, -0.88], [0.9, 2, 2, 0.1], [0.92, 1, 1, 0.08], [0.95, 1, 1, 0.05],
  ]);
});

test('tiny: the config\'s thresholds, checked against what happened', () => {
  const gate = TINY.calibration.thresholds.find(t => t.name === 'auto_publish');
  // SUBJECT claims at or above 0.85: MNA 0.95, MNA 0.90, ANTI 0.88 -> 2 of 3 right
  assert.deepEqual([gate.output, gate.threshold, gate.at_or_above.n, gate.at_or_above.d], ['SUBJECT', 0.85, 2, 3]);
  const floor = TINY.calibration.thresholds.find(t => t.name === 'floor');
  // Below the 0.60 floor: only R5's SUBJ-LAB at 0.55, and it was right
  assert.deepEqual([floor.below.n, floor.below.d], [1, 1]);
});

test('G10: fixed-width buckets put 0.7 in 0.7-0.8, not 0.6-0.7, and 1.0 in the top bucket', () => {
  const cfg = validateConfig({
    outputs: { t: { type: 'set' } }, routing: { map: { A: 'auto' } }, calibration: { buckets: 0.1 },
  }).config;
  const rec = (id, conf) => ({ id, route: 'A', route_class: 'auto', gold_class: null, scored: true, traps: [], duplicate_of: null,
    pred: { t: [{ value: 'x', confidence: conf, applied: true, inherited: false }] }, key: { t: ['x'] } });
  const b = scoreRecords([rec('a', 0.7), rec('b', 1.0), rec('c', 0.95)], cfg).calibration.overall.buckets;
  assert.deepEqual(b.map(x => [x.from, x.to, x.n]), [[0.7, 0.8, 1], [0.9, 1, 2]]);
});

// ---------- compliance: routing ----------

test('compliance: headline routing numbers', () => {
  const r = COMP.routing;
  assert.deepEqual(r.by_class, { auto: 4, review: 3, block: 2, exclude: 0 });
  assert.deepEqual(pcts(r.straight_through), [4, 9, 44.4]);
  assert.deepEqual([...pcts(r.silent_errors.rate), r.silent_errors.rate.low_pct, r.silent_errors.rate.high_pct], [2, 4, 50, 15, 85]);
  assert.deepEqual(pcts(r.silent_omissions.rate), [1, 6, 16.7]);
  assert.deepEqual(pcts(r.review_queue.precision), [2, 3, 66.7]);
  assert.deepEqual(r.review_queue.wasted, ['D5']);
  assert.deepEqual(pcts(r.block.precision), [1, 2, 50]);
  assert.deepEqual(r.block.wrongly_blocked, ['D6']);
});

test('compliance: silent errors, their types and severity', () => {
  const s = COMP.routing.silent_errors;
  assert.deepEqual(s.records.map(x => [x.id, x.severity, x.types]), [
    ['D2', 'critical', ['SP-FORBIDDEN', 'SP-MISSING']],
    ['D7', 'medium', ['SP-SHOULD-REVIEW', 'SP-MISSING-REJECTED']],
  ]);
  assert.deepEqual(s.records[1].differences.missing_rejected, { violations: ['TESTIMONIAL'] });
  assert.deepEqual(s.by_severity, { critical: 1, high: 0, medium: 1, low: 0 });
});

test('compliance: a verdict that is also the route is judged by route types, not as a wrong value too', () => {
  const d2 = COMP.routing.silent_errors.records[0];
  assert.equal(d2.differences.wrong.verdict, undefined);
});

test('compliance: D8 went through below the gate: a safeguard failure, not a silent error', () => {
  const sg = COMP.routing.safeguard_failures;
  assert.deepEqual(sg.detail, [{ id: 'D8', types: ['SG-GATE'] }]);
  assert.ok(!COMP.routing.silent_errors.records.some(x => x.id === 'D8'));
});

test('compliance: D6 is a silent omission', () => {
  assert.deepEqual(COMP.routing.silent_omissions.records.map(x => [x.id, x.types, x.severity]), [['D6', ['SO-FALSE-BLOCK'], 'medium']]);
});

// ---------- compliance: output quality ----------

test('compliance: violations precision / recall / F1 and exact match; D9 left out', () => {
  const q = COMP.quality;
  assert.equal(q.population, 8);
  assert.deepEqual(q.left_out.model_failed, ['D9']);
  const v = q.outputs.violations;
  assert.deepEqual([v.tp, v.fp, v.fn, v.precision.pct, v.recall.pct, v.f1, v.exact_match.pct], [3, 1, 2, 75, 60, 0.667, 62.5]);
  assert.deepEqual([q.overall.tp, q.overall.fp, q.overall.fn], [3, 1, 2]);   // sets only
});

test('compliance: verdict accuracy, per-label scores and the confusion matrix', () => {
  const v = COMP.quality.outputs.verdict;
  assert.deepEqual(pcts(v.accuracy), [4, 8, 50]);
  assert.deepEqual(v.confusion, {
    pass: { pass: 2, elevate: 1, fail: 0 },
    elevate: { pass: 1, elevate: 1, fail: 1 },
    fail: { pass: 1, elevate: 0, fail: 1 },
  });
  const row = l => [v.per_label[l].precision.pct, v.per_label[l].recall.pct, v.per_label[l].f1];
  assert.deepEqual(row('pass'), [50, 66.7, 0.571]);
  assert.deepEqual(row('elevate'), [50, 33.3, 0.4]);
  assert.deepEqual(row('fail'), [50, 50, 0.5]);
});

test('compliance: per trap', () => {
  const rows = COMP.traps.groups.map(g => [g.trap, g.routed_correctly.n + '/' + g.routed_correctly.d,
    g.silent_errors.join(' '), g.silent_omissions.join(' '), g.wasted_reviews.join(' ')]);
  assert.deepEqual(rows, [
    ['borderline-testimonial', '0/1', '', 'D6', ''],
    ['clean-copy', '2/3', '', '', 'D5'],
    ['implied-guarantee', '0/2', 'D2', '', ''],
    ['superlative', '1/1', '', '', ''],
    ['unqualified-comparison', '1/1', '', '', ''],
    ['weak-testimonial', '0/1', 'D7', '', ''],
  ]);
});

test('with wrong_when "either", D5\'s false flag would count as needing a human and hide the wasted review', () => {
  const dir = path.join(__dirname, 'fixtures', 'compliance');
  const config = loadConfig(path.join(dir, 'config.json'));
  config.wrong_when = 'either';
  const r = scoreRun({ config, predPath: path.join(dir, 'predictions.csv'), keyPath: path.join(dir, 'key.csv') });
  assert.deepEqual(r.routing.review_queue.wasted, []);
});

// ---------- H5: trap coverage ----------

test('H5: with min_per_trap set, trap types with too few records stop in strict mode', () => {
  const dir = path.join(__dirname, 'fixtures', 'tiny');
  const config = loadConfig(path.join(dir, 'config.json'));
  config.min_per_trap = 2;
  const args = { config, predPath: path.join(dir, 'predictions.json'), keyPath: path.join(dir, 'key.json') };
  assert.throws(() => scoreRun(args), err => /H5/.test(err.message) && /plausible-extra-tag/.test(err.message) && !/correct-but-unsure/.test(err.message));
  const lenient = scoreRun({ ...args, mode: 'lenient' });
  assert.equal(lenient.problems.filter(i => i.trap === 'H5').length, 3);
});
