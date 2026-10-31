// The review queue, targets, paired compare and rates per group, checked against
// test/fixtures/queue/EXPECTED.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig, validateConfig } = require('../src/config.js');
const { scoreRun, compareRun } = require('../src/score.js');
const { renderTerminal, renderCompare } = require('../src/report/terminal.js');
const { renderHtml } = require('../src/report/html.js');
const { resultsJson } = require('../src/report/json.js');

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

// ---------- H6-H8: rates per group ----------

// The queue config plus the two groups EXPECTED.md works by hand. Built on first use, so the
// tests above still run on code that does not know about groups.
let grouped;
const withGroups = extra => {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  return validateConfig({ ...raw, groups: { channel: { field: 'channel' }, branch: { field: 'branch', from: 'predictions' }, ...extra } }).config;
};
const G = () => (grouped ??= scoreRun({ config: withGroups(), predPath: before, keyPath }));
const group = name => G().groups.find(g => g.name === name);
const five = r => [r.n, r.d, r.pct, r.low_pct, r.high_pct];
const NA = n => [0, 0, null, null, null].map((v, i) => (i === 0 ? n : v));

test('per group: the channel rows, worked by hand (one label has the silent error, one has none)', () => {
  const g = group('channel');
  assert.deepEqual([g.field, g.from], ['channel', 'key']);
  assert.deepEqual(g.rows.map(x => [x.label, x.records]), [['chat', 4], ['email', 6], ['(none)', 1]]);   // "(none)" last
  const [chat, email, none] = g.rows;
  assert.deepEqual(five(chat.silent_errors.rate), [1, 1, 100, 20.7, 100]);
  assert.deepEqual(chat.silent_errors.ids, ['Q2']);
  assert.deepEqual(five(chat.straight_through), [1, 4, 25, 4.6, 69.9]);
  assert.deepEqual(five(chat.review_precision.rate), [1, 3, 33.3, 6.1, 79.2]);
  assert.deepEqual(chat.review_precision.unnecessary, ['Q9', 'Q10']);
  assert.deepEqual(five(chat.silent_omissions.rate), [0, 4, 0, 0, 49]);
  assert.deepEqual(five(chat.routed_correctly), [1, 4, 25, 4.6, 69.9]);

  assert.deepEqual(five(email.silent_errors.rate), [0, 1, 0, 0, 79.3]);
  assert.deepEqual(email.silent_errors.ids, []);
  assert.deepEqual(five(email.straight_through), [1, 6, 16.7, 3, 56.4]);
  assert.deepEqual(five(email.review_precision.rate), [1, 5, 20, 3.6, 62.4]);
  assert.deepEqual(email.review_precision.unnecessary, ['Q4', 'Q5', 'Q8', 'Q10']);
  assert.deepEqual(five(email.silent_omissions.rate), [0, 4, 0, 0, 49]);
  assert.deepEqual(five(email.routed_correctly), [1, 6, 16.7, 3, 56.4]);

  // Q7 has no channel. Nothing of it went out or to a person: "nothing to measure", never 0% (G1).
  assert.deepEqual(five(none.silent_errors.rate), NA(0));
  assert.deepEqual(five(none.straight_through), [0, 1, 0, 0, 79.3]);
  assert.deepEqual(five(none.review_precision.rate), NA(0));
  assert.deepEqual(five(none.silent_omissions.rate), NA(0));
  assert.deepEqual(five(none.routed_correctly), [1, 1, 100, 20.7, 100]);
});

test('per group: branch is read from the predictions, as text; its rows add up to the headline', () => {
  const g = group('branch');
  assert.deepEqual([g.field, g.from], ['branch', 'predictions']);
  assert.deepEqual(g.rows.map(x => [x.label, x.records]), [['1', 2], ['2', 8]]);
  const [one, two] = g.rows;
  assert.deepEqual(five(one.silent_errors.rate), NA(0));
  assert.deepEqual(five(one.straight_through), [0, 2, 0, 0, 65.8]);
  assert.deepEqual(five(one.review_precision.rate), [0, 1, 0, 0, 79.3]);
  assert.deepEqual(one.review_precision.unnecessary, ['Q8']);
  assert.deepEqual(five(one.silent_omissions.rate), NA(0));
  assert.deepEqual(five(one.routed_correctly), [1, 2, 50, 9.5, 90.5]);
  assert.deepEqual(five(two.silent_errors.rate), [1, 2, 50, 9.5, 90.5]);
  assert.deepEqual(two.silent_errors.ids, ['Q2']);
  assert.deepEqual(five(two.straight_through), [2, 8, 25, 7.1, 59.1]);
  assert.deepEqual(five(two.review_precision.rate), [2, 6, 33.3, 9.7, 70]);
  assert.deepEqual(two.review_precision.unnecessary, ['Q4', 'Q5', 'Q9', 'Q10']);
  assert.deepEqual(five(two.silent_omissions.rate), [0, 7, 0, 0, 35.4]);
  assert.deepEqual(five(two.routed_correctly), [2, 8, 25, 7.1, 59.1]);
  // One branch per record, so the counts add up to the headline's.
  const h = G().routing;
  const sum = pick => g.rows.reduce((s, x) => [s[0] + pick(x).n, s[1] + pick(x).d], [0, 0]);
  assert.deepEqual(sum(x => x.silent_errors.rate), [h.silent_errors.rate.n, h.silent_errors.rate.d]);
  assert.deepEqual(sum(x => x.review_precision.rate), [h.review_queue.precision.n, h.review_queue.precision.d]);
  assert.deepEqual(sum(x => x.silent_omissions.rate), [h.silent_omissions.rate.n, h.silent_omissions.rate.d]);
});

test('per group: a field no record has puts every record in "(none)", and that row is the headline', () => {
  const r = scoreRun({ config: withGroups({ nothing: { field: 'not.there' } }), predPath: before, keyPath });
  const [row] = r.groups.find(g => g.name === 'nothing').rows;
  assert.equal(row.label, '(none)');
  assert.equal(row.records, 10);
  assert.deepEqual(row.silent_errors.rate, r.routing.silent_errors.rate);
  assert.deepEqual(row.straight_through, r.routing.straight_through);
  assert.deepEqual(row.review_precision.rate, r.routing.review_queue.precision);
  assert.deepEqual(row.review_precision.unnecessary, r.routing.review_queue.wasted);
  assert.deepEqual(row.silent_omissions.rate, r.routing.silent_omissions.rate);
});

test('H7: Q10 is chat and email, and counts in each; rows add up to more than the records', () => {
  assert.equal(group('channel').records_with_several_labels, 1);
  assert.equal(group('channel').rows.reduce((s, x) => s + x.records, 0), 11);
  assert.equal(group('branch').records_with_several_labels, 0);
  assert.match(renderTerminal(G()), /1 record\(s\) carry several labels and count in each, so the rows add up to more than the 10 records\./);
});

test('results.groups appears only when groups are configured, and the JSON carries it', () => {
  assert.equal(B.groups, undefined);
  assert.equal('groups' in resultsJson(B), false);
  assert.deepEqual(resultsJson(G()).groups.map(g => g.name), ['channel', 'branch']);
});

test('H6: the terminal shows every group rate with its count and likely range, and says to compare the ranges', () => {
  const t = renderTerminal(G());
  assert.match(t, /PER GROUP  channel  \(answer key field "channel"\)/);
  assert.match(t, /PER GROUP  branch  \(predictions field "branch"\)/);
  assert.match(t, /chat\s+4\s+100\.0%  1 of 1\s+25\.0%  1 of 4\s+33\.3%  1 of 3\s+0\.0%  0 of 4\s+25\.0%  1 of 4\n\s+likely 20\.7-100\.0%\s+likely 4\.6-69\.9%\s+likely 6\.1-79\.2%\s+likely 0\.0-49\.0%\s+likely 4\.6-69\.9%/);
  assert.match(t, /email\s+6\s+0\.0%  0 of 1\s+16\.7%  1 of 6/);
  assert.match(t, /\(none\)\s+1\s+n\/a  0 of 0\s+0\.0%  0 of 1/);
  assert.match(t, /\n  silent errors {9}chat: Q2\n  silent omissions {6}-\n  unnecessary reviews {3}chat: Q9 Q10 · email: Q4 Q5 Q8 Q10\n/);
  assert.match(t, /Small groups have wide ranges, so compare the ranges, not the percentages\./);
  // Near the per-trap table's place: after output quality, before calibration.
  assert.ok(t.indexOf('OUTPUT QUALITY') < t.indexOf('PER GROUP') && t.indexOf('PER GROUP') < t.indexOf('CALIBRATION'));
  assert.doesNotMatch(renderTerminal(B), /PER GROUP/);
});

test('the HTML report has a Per group section; every value read from the files is escaped', () => {
  const h = renderHtml(G(), '2026-10-31T00:00:00.000Z');
  assert.match(h, /<h2>Per group<\/h2>/);
  assert.match(h, /Small groups have wide ranges, so compare the ranges, not the percentages\./);
  assert.match(h, /100\.0%<br><span class="muted">1 of 1 · likely 20\.7–100\.0%<\/span>/);
  assert.doesNotMatch(renderHtml(B, '2026-10-31T00:00:00.000Z'), /Per group/);
  // A hostile label, field and id must arrive as text, never as markup.
  const evil = structuredClone(G());
  evil.groups[0].name = '<b>n</b>';
  evil.groups[0].field = '"><i>f';
  evil.groups[0].rows[0].label = '<img src=x onerror=alert(1)>';
  evil.groups[0].rows[0].silent_errors.ids = ['<script>x</script>'];
  const e = renderHtml(evil, '2026-10-31T00:00:00.000Z');
  assert.doesNotMatch(e, /<img src=x|<script>x|<b>n<\/b>|"><i>f/);
  assert.match(e, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('score --group-by <path> adds a group read from the answer key; a bad path is refused', () => {
  const args = ['score', '--config', path.join(dir, 'config.json'), '--pred', before, '--key', keyPath];
  const ok = cli([...args, '--group-by', 'channel']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /PER GROUP  channel  \(answer key field "channel"\)/);
  assert.match(ok.stdout, /chat\s+4\s+100\.0%  1 of 1/);
  const bad = cli([...args, '--group-by', 'channel.']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--group-by must be a field name/);
  const grades = cli(['score', '--grades', 'g.json', '--group-by', 'channel']);
  assert.equal(grades.status, 1);
  assert.match(grades.stderr, /does not take --group-by/);
});
