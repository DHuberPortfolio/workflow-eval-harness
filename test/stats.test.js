const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pct, rate } = require('../src/metrics/stats.js');

test('pct rounds to one decimal and returns null for an empty base', () => {
  assert.equal(pct(2, 6), 33.3);
  assert.equal(pct(7, 24), 29.2); // run 49 straight-through
  assert.equal(pct(0, 0), null);
});

// Worked by hand: z^2 = 3.8416, 1 + z^2/7 = 1.5488,
// center = (3.8416/14) / 1.5488 = 0.1772, half = 1.96 * sqrt(3.8416/196) / 1.5488 = 0.1772
// so the range is 0 to 0.354.
test('0 errors in 7 auto-publishes could still be a 35% error rate', () => {
  assert.deepEqual(rate(0, 7), { n: 0, d: 7, pct: 0, low_pct: 0, high_pct: 35.4 });
});

test('the range narrows as the base grows', () => {
  assert.equal(rate(0, 70).high_pct, 5.2);
  assert.equal(rate(0, 700).high_pct, 0.5);
});

test('1 of 2 is centred on 50% and very wide', () => {
  assert.deepEqual(rate(1, 2), { n: 1, d: 2, pct: 50, low_pct: 9.5, high_pct: 90.5 });
});

test('no base means no rate and no range', () => {
  assert.deepEqual(rate(0, 0), { n: 0, d: 0, pct: null, low_pct: null, high_pct: null });
});

// ---------- Planning and paired changes: the same arithmetic as error-rate-calculator ----------
// Each value below is pinned in that tool's own tests (and its published worked examples), so
// the two tools give the same answer for the same counts.
const { recordsNeeded, planTest, pairedDifference, wilson } = require('../src/metrics/stats.js');
const near = (actual, expected, places) => assert.ok(Math.abs(actual - expected) < 0.5 * 10 ** -places, actual + ' is not ' + expected);

test('a perfect run needs 73 records to show a rate under 5%, 381 for 1%', () => {
  assert.equal(recordsNeeded(0, 0.05), 73);
  assert.equal(recordsNeeded(0, 0.01), 381);
  // 0 of 73 reaches 4.99%, 0 of 72 still 5.07%.
  assert.ok(wilson(0, 73).high < 0.05 && wilson(0, 72).high >= 0.05);
});

test('records needed at a rate above zero, and none when the rate is at or above the target', () => {
  assert.equal(recordsNeeded(0.06, 0.10), 217);
  assert.equal(recordsNeeded(0.02, 0.05), 203);
  assert.equal(recordsNeeded(0.05, 0.05), null);
  assert.equal(recordsNeeded(0.06, 0.05), null);
});

test('the 80% plan for 6% against a 10% target is 398 records; 514 for 90%', () => {
  const plan = planTest(0.06, 0.10);
  assert.equal(plan.n, 398);
  assert.equal(plan.exact, true);
  near(plan.chance, 0.835939, 6);
  assert.equal(planTest(0.06, 0.10, 0.9).n, 514);
  assert.deepEqual(planTest(0, 0.05), { n: 73, chance: 1, exact: true });
  assert.equal(planTest(0.06, 0.05), null);
  assert.throws(() => planTest(0.02, 0.05, 0.7), RangeError);
});

test('paired range matches the published worked example (Fagerland 2014, Tango score)', () => {
  // 21 pairs: fixed 1, broke 7. ratesci prints -0.5172 to -0.0260.
  const r = pairedDifference(1, 7, 21);
  near(r.drop, -0.2857, 4);
  near(r.low, -0.5172, 4);
  near(r.high, -0.0260, 4);
});

test('nothing changed in 50 records still leaves a range, equal to Wilson\'s for 0 of 50', () => {
  const r = pairedDifference(0, 0, 50);
  near(r.high, wilson(0, 50).high, 12);
  near(r.low, -wilson(0, 50).high, 12);
});

test('only the records that changed decide the verdict (McNemar boundary)', () => {
  // (fixed - broke) / sqrt(fixed + broke) must pass 1.96: 6 vs 1 is 1.89, 7 vs 1 is 2.12.
  for (const tested of [20, 50, 500]) {
    assert.ok(pairedDifference(6, 1, tested).low < 0);
    assert.ok(pairedDifference(7, 1, tested).low > 0);
    assert.ok(pairedDifference(1, 7, tested).high < 0);
  }
  assert.throws(() => pairedDifference(30, 30, 50), RangeError);
});
