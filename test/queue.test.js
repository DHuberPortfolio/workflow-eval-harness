// The review queue, targets and paired compare, checked against test/fixtures/queue/EXPECTED.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('../src/config.js');
const { scoreRun, compareRun } = require('../src/score.js');
const { renderTerminal, renderCompare } = require('../src/report/terminal.js');
const { renderHtml } = require('../src/report/html.js');

const dir = path.join(__dirname, 'fixtures', 'queue');
const config = loadConfig(path.join(dir, 'config.json'));
const keyPath = path.join(dir, 'key.json');
const before = path.join(dir, 'predictions.json');
const after = path.join(dir, 'predictions-after.json');
const B = scoreRun({ config, predPath: before, keyPath });
const near = (actual, expected, places) => assert.ok(Math.abs(actual - expected) < 0.5 * 10 ** -places, actual + ' is not ' + expected);
const cli = args => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wfeval.js'), ...args], { encoding: 'utf8' });

// ---------- G12: review precision ----------

test('G12: a record the answer key files or suppresses did not need a person, even when sent to one', () => {
  const q = B.routing.review_queue;
  assert.deepEqual([q.precision.n, q.precision.d, q.precision.pct, q.precision.low_pct, q.precision.high_pct], [2, 7, 28.6, 8.2, 64.1]);
  assert.deepEqual(q.wasted, ['Q4', 'Q5', 'Q8', 'Q9', 'Q10']);
  assert.deepEqual(q.key_leaves_out, ['Q5', 'Q8']);
});

test('G12: Q5\'s wrong value does not make the review necessary: the answer key files it', () => {
  const q5 = B.records.find(r => r.id === 'Q5');
  assert.equal(q5.wasted_review, true);
  assert.equal(q5.key_leaves_out, true);
  // "Needed a person" keeps its meaning for silent errors: had Q5 gone out, it would be one.
  assert.equal(q5.needs_human, true);
});

test('G12: the silent error rate and block precision are unchanged by the fix', () => {
  const r = B.routing;
  assert.deepEqual([r.silent_errors.rate.n, r.silent_errors.rate.d], [1, 2]);
  assert.deepEqual([r.block.precision.n, r.block.precision.d], [1, 1]);
});

test('G12: the reports say why each unnecessary review was unnecessary', () => {
  const t = renderTerminal(B);
  assert.match(t, /Review precision\s+28\.6%\s+2 of 7/);
  assert.match(t, /UNNECESSARY REVIEWS  Q4 Q9 Q10 {3}\(sent to a person, but could have gone out\)/);
  assert.match(t, /Q5 Q8 {3}\(sent to a person, but the answer key blocks or suppresses them: no person was needed\)/);
  const h = renderHtml(B, '2026-10-30T00:00:00.000Z');
  assert.match(h, /unnecessary review: the answer key leaves it out/);
});

// ---------- G13: records needed for a target ----------

test('G13: at 1 of 2 a 5% target cannot be shown; a perfect run would need 73 records out', () => {
  const t = scoreRun({ config, predPath: before, keyPath, target: 5 }).target;
  assert.equal(t.target_pct, 5);
  assert.equal(t.shown, false);
  assert.deepEqual(t.perfect_run, { n: 73, all_records: 365 });   // 73 / (2 of 10 out without review)
  assert.equal(t.plan, null);   // 50% is above 5%: no number of records can show it
});

test('G13: at 1 of 5 a 30% target is planned at 158 records out, about 316 in all', () => {
  const t = scoreRun({ config, predPath: after, keyPath, target: 30 }).target;
  assert.equal(t.shown, false);   // 1 of 5 reaches 62.4%
  assert.equal(t.plan.n, 158);
  assert.equal(t.plan.assumed_pct, 20);
  near(t.plan.chance, 0.835486, 6);
  assert.equal(t.plan.all_records, 316);
  assert.deepEqual(t.perfect_run, { n: 9, all_records: 18 });
});

test('G13: a target already shown says so', () => {
  const t = scoreRun({ config, predPath: after, keyPath, target: 70 }).target;
  assert.equal(t.shown, true);
});

test('G13: the HTML report carries the same target lines, escaped', () => {
  const h = renderHtml(scoreRun({ config, predPath: after, keyPath, target: 30 }), '2026-10-30T00:00:00.000Z');
  assert.match(h, /<strong>Target under 30%: not shown: the likely range reaches 62\.4%\.<\/strong>/);
  assert.match(h, /about 158 records out without review give an 80% chance of showing it \(about 316 records in all, at this run&#39;s straight-through rate\)/);
});

test('G13: score --target prints the target lines; a bad target is refused', () => {
  const ok = cli(['score', '--config', path.join(dir, 'config.json'), '--pred', before, '--key', keyPath, '--target', '5']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /TARGET  under 5%: not shown/);
  assert.match(ok.stdout, /73 records out without review with no silent error/);
  const bad = cli(['score', '--config', path.join(dir, 'config.json'), '--pred', before, '--key', keyPath, '--target', '0']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--target must be a percentage above 0 and below 100/);
});

test('wfeval rate: the likely range for any count, and what a target needs', () => {
  const r = cli(['rate', '2', '15', '--target', '5']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /RATE  13\.3%  2 of 15  likely 3\.7-37\.9%/);
  assert.match(r.stdout, /each record moves it by 6\.7 points/);
  assert.match(r.stdout, /TARGET  under 5%: not shown/);
  assert.match(r.stdout, /73 records with no mistake/);
  const zero = cli(['rate', '0', '15', '--target', '10']);
  assert.match(zero.stdout, /RATE  0\.0%  0 of 15/);
  // The metadata tagger's worst Golden 500 run against a 10% target; error-rate-calculator plans 3372 too.
  const plan = cli(['rate', '18', '210', '--target', '10']);
  assert.match(plan.stdout, /If the real rate is 8\.6% \(this count's\), about 3,372 records give an 80% chance of showing it\./);
  assert.match(plan.stdout, /The least any test needs: 35 records with no mistake at all\./);
  const bad = cli(['rate', '3', '2']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /rate needs two whole numbers/);
});

// ---------- I9: compare without repeated runs ----------

test('I9: paired counts on the same 10 records judge a change without any noise runs', () => {
  const c = compareRun({ config, keyPath, beforePath: before, afterPath: after });
  assert.equal(c.paired.records, 10);
  const row = name => c.paired.outcomes.find(o => o.name === name);
  const se = row('silent errors');
  assert.deepEqual([se.before, se.after, se.fixed, se.broke, se.verdict], [1, 1, 1, 1, 'unclear']);
  assert.deepEqual(se.fixed_ids, ['Q2']);
  assert.deepEqual(se.broke_ids, ['Q6']);
  assert.deepEqual([se.low_pct, se.high_pct], [-34.2, 34.2]);
  const ur = row('unnecessary reviews');
  assert.deepEqual([ur.before, ur.after, ur.fixed, ur.broke, ur.verdict, ur.low_pct, ur.high_pct], [5, 0, 5, 0, 'better', -76.3, -8.4]);
  const rk = row('routed against the answer key');
  assert.deepEqual([rk.before, rk.after, rk.fixed, rk.broke, rk.verdict, rk.low_pct, rk.high_pct], [7, 0, 7, 0, 'better', -89.2, -22.8]);
  const so = row('silent omissions');
  assert.deepEqual([so.before, so.after, so.verdict], [0, 0, 'no change']);
});

test('I9: the silent error rate fell from 50% to 20% while the same number of silent errors went out', () => {
  const c = compareRun({ config, keyPath, beforePath: before, afterPath: after });
  const m = c.metrics.find(x => x.name === 'silent error rate');
  assert.deepEqual([m.before, m.after, m.verdict], [50, 20, 'no noise baseline']);
  const t = renderCompare(c);
  assert.match(t, /PAIRED  the same 10 records, before and after/);
  assert.match(t, /silent errors\s+1\s+1\s+1\s+1\s+0 \(likely -34\.2 to \+34\.2 pts\)\s+unclear/);
  assert.match(t, /unnecessary reviews\s+5\s+0\s+5\s+0\s+-5 \(likely -76\.3 to -8\.4 pts\)\s+better/);
});
