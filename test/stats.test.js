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
