// The silent error rate weighted to a real mix of traffic (score --mix; traps G18-G21), checked
// against test/fixtures/clusters/EXPECTED.md ("Weighted to a real mix") and, for the stops,
// test/fixtures/queue/EXPECTED.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateConfig, loadConfig, addGroupBy } = require('../src/config.js');
const { scoreRun } = require('../src/score.js');

const dir = path.join(__dirname, 'fixtures', 'clusters');
const f = name => path.join(dir, name);
const keyPath = f('key.json');
const PRED = f('predictions.json');
const raw = JSON.parse(fs.readFileSync(f('config.json'), 'utf8'));
// The clusters config with the key's section (or story) as a group, as --group-by gives it.
const grouped = (...fields) => addGroupBy(loadConfig(f('config.json')), fields);
const Q = path.join(__dirname, 'fixtures', 'queue');
const near = (actual, expected, places) => assert.ok(Math.abs(actual - expected) < 0.5 * 10 ** -places, actual + ' is not ' + expected);
const cli = args => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wfeval.js'), ...args], { encoding: 'utf8' });
// Required inside each test, so each test fails on its own where the code does not exist.
const mixedRate = strata => require('../src/metrics/stats.js').mixedRate(strata);
const loadMix = (file, config) => require('../src/mix.js').loadMix(file, config);
const withMix = (file, config = grouped('section'), mode = 'strict', pred = PRED, key = keyPath) =>
  scoreRun({ config, predPath: pred, keyPath: key, mode, mix: loadMix(file, config) });

// A temporary mix file (or any text) and the folder to clean up.
function tmpFile(content, name = 'mix.json') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-mix-'));
  const file = path.join(d, name);
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return { file, done: () => fs.rmSync(d, { recursive: true }) };
}
// The error scoring with this mix stops with, or null if it does not stop.
function mixError(content, config = grouped('section'), mode = 'strict', pred = PRED, key = keyPath) {
  const t = tmpFile(content);
  try { withMix(t.file, config, mode, pred, key); return null; } catch (e) { return e.message; } finally { t.done(); }
}
// The fixture's two sections on predictions.json: { share, N records, a out without review, s silent errors }.
const SECTIONS = (business, general) => [{ share: business, N: 8, a: 7, s: 3 }, { share: general, N: 7, a: 5, s: 0 }];

// ---------- The arithmetic (src/metrics/stats.js) ----------

test('G18: business 10%, general 90%: R 0.051345 over 6.369455 records\' worth, 0.4-43.7%; straight-through 0.730357, 40.2-91.6%', () => {
  const m = mixedRate(SECTIONS(0.1, 0.9));
  near(m.rate, 0.051345, 6);
  near(m.effective, 6.369455, 6);
  near(m.low, 0.003767, 6);
  near(m.high, 0.436508, 6);
  near(m.straight_through.rate, 0.730357, 6);
  near(m.straight_through.effective, 8.549618, 6);
  near(m.straight_through.low, 0.401733, 6);
  near(m.straight_through.high, 0.916148, 6);
  // The shares used, divided by their total.
  assert.deepEqual(m.shares, [0.1, 0.9]);
});

test('G18: weighted by the golden set\'s own counts (8 and 7), the mix is the golden set: the headline\'s rate and ranges exactly', () => {
  const { wilson } = require('../src/metrics/stats.js');
  const m = mixedRate(SECTIONS(8, 7));
  near(m.rate, 0.25, 12);
  near(m.effective, 12, 9);
  near(m.low, wilson(3, 12).low, 9);
  near(m.high, wilson(3, 12).high, 9);
  near(m.straight_through.rate, 0.8, 12);
  near(m.straight_through.effective, 15, 9);
  near(m.straight_through.low, wilson(12, 15).low, 9);
  near(m.straight_through.high, wilson(12, 15).high, 9);
  near(m.shares[0], 8 / 15, 12);
});

test('G18: a rate of 0 still has a range: only general, 0 of 5 records\' worth reaches 43.4%; a share of 0 weighs nothing', () => {
  const m = mixedRate(SECTIONS(0, 1));
  assert.equal(m.rate, 0);
  near(m.effective, 5, 9);
  assert.equal(m.low, 0);
  near(m.high, 0.434491, 6);
  near(m.straight_through.rate, 5 / 7, 12);
  near(m.straight_through.effective, 7, 9);
});

test('mixedRate: the story mix is 3/19 over 361/39 records; nothing out is no rate (G1); bad strata are refused', () => {
  const story = [
    { share: 1, N: 4, a: 4, s: 3 }, { share: 1, N: 4, a: 3, s: 0 }, { share: 1, N: 2, a: 2, s: 0 },
    { share: 1, N: 2, a: 2, s: 0 }, { share: 1, N: 2, a: 0, s: 0 }, { share: 1, N: 1, a: 1, s: 0 },
  ];
  const m = mixedRate(story);
  near(m.rate, 3 / 19, 12);
  near(m.effective, 361 / 39, 9);
  near(m.low, 0.036725, 6);
  near(m.high, 0.479741, 6);
  near(m.straight_through.rate, 19 / 24, 12);
  near(m.straight_through.effective, 12, 9);
  // Only the group that sent nothing out has a share: nothing would go out, so there is no rate.
  const none = mixedRate(story.map((x, i) => ({ ...x, share: i === 4 ? 1 : 0 })));
  assert.deepEqual([none.rate, none.effective, none.low, none.high], [null, null, null, null]);
  assert.equal(none.straight_through.rate, 0);
  near(none.straight_through.effective, 2, 9);   // E's 2 records, all kept back
  near(none.straight_through.high, 0.657628, 6);   // 0 of 2: 3.8416 / (2 + 3.8416)
  for (const bad of [[{ share: -1, N: 2, a: 1, s: 0 }], [{ share: 0, N: 2, a: 1, s: 0 }], [{ share: 1, N: 0, a: 0, s: 0 }],
    [{ share: 1, N: 2, a: 1, s: 2 }], [{ share: 1, N: 2, a: 3, s: 0 }], [{ share: 1, N: 2.5, a: 1, s: 0 }], []]) {
    assert.throws(() => mixedRate(bad), RangeError, JSON.stringify(bad));
  }
  // Shares each a number, but too big to add up: the total is Infinity, and every weight would be 0.
  assert.throws(() => mixedRate(SECTIONS(1e308, 1e308)), /the shares add up to more than a number can hold/);
});

// An independent check, written differently from the implementation: read the fixture files
// directly (no load.js, no judge.js, no groups), decide each record's silent error by comparing
// the value sets, weight every record out without review by its section's share over its
// section's records, and add up R and Kish's n_eff record by record.
function bruteForce(shares) {
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const preds = new Map(JSON.parse(fs.readFileSync(PRED, 'utf8')).map(r => [r.id, r]));
  const total = Object.values(shares).reduce((t, x) => t + x, 0);
  const size = s => key.filter(k => k.section === s).length;
  let sw = 0, sw2 = 0, bad = 0;
  for (const k of key) {
    const p = preds.get(k.id);
    if (p.decision !== 'PUBLISH') continue;
    const w = shares[k.section] / total / size(k.section);
    const same = p.SUBJECT.length === k.SUBJECT.length && p.SUBJECT.every(v => k.SUBJECT.includes(v));
    sw += w; sw2 += w * w;
    if (!same) bad += w;
  }
  return { R: bad / sw, n_eff: sw * sw / sw2, out: sw };
}

test('G18: a brute-force weighting of the raw files agrees with the arithmetic and with score --mix', () => {
  const b = bruteForce({ business: 0.1, general: 0.9 });
  near(b.R, 0.051345, 6);
  near(b.n_eff, 6.369455, 6);
  const m = mixedRate(SECTIONS(0.1, 0.9));
  near(m.rate, b.R, 12);
  near(m.effective, b.n_eff, 9);
  near(m.straight_through.rate, b.out, 12);
  const r = withMix(f('mix.json')).mix;
  assert.equal(r.silent_error_rate.pct, Number((b.R * 100).toFixed(1)));
  near(r.silent_error_rate.effective_records, b.n_eff, 9);
  // The golden set's own counts: every record weighs 1/15.
  const g = bruteForce({ business: 8, general: 7 });
  near(g.R, 0.25, 12);
  near(g.n_eff, 12, 9);
});

// ---------- Through `wfeval score` ----------

// results.mix keeps the records' worth as worked out (trap G6); compared here to six places.
const six = r => ({ ...r, effective_records: r.effective_records === null ? null : Number(r.effective_records.toFixed(6)) });

test('G18: score --mix gives results.mix for the fixture; the headline and the group rows do not move', () => {
  const r = withMix(f('mix.json'));
  assert.deepEqual({ ...r.mix, silent_error_rate: six(r.mix.silent_error_rate), straight_through: six(r.mix.straight_through) }, {
    file: f('mix.json'), group: 'section', field: 'section', from: 'key',
    strata: [
      { label: 'business', given: 0.1, share_pct: 10, records: 8, out: 7, silent_errors: 3 },
      { label: 'general', given: 0.9, share_pct: 90, records: 7, out: 5, silent_errors: 0 },
    ],
    silent_error_rate: { pct: 5.1, low_pct: 0.4, high_pct: 43.7, effective_records: 6.369455 },
    straight_through: { pct: 73, low_pct: 40.2, high_pct: 91.6, effective_records: 8.549618 },
    why: null,
    none_out: [],
  });
  assert.equal(r.inputs.mix, f('mix.json'));
  const plain = scoreRun({ config: grouped('section'), predPath: PRED, keyPath });
  assert.deepEqual(r.routing, plain.routing);
  assert.deepEqual(r.groups, plain.groups);
  assert.deepEqual(r.routing.silent_errors.rate, { n: 3, d: 12, pct: 25, low_pct: 8.9, high_pct: 53.2 });
});

test('G18: the golden set\'s own counts give back the headline: 25.0%, 8.9-53.2%, 12 records\' worth; 80.0%, 15', () => {
  const r = withMix(f('mix-golden.json'));
  assert.deepEqual(r.mix.strata.map(x => [x.label, x.given, x.share_pct]), [['business', 8, 53.3], ['general', 7, 46.7]]);
  assert.deepEqual(six(r.mix.silent_error_rate), { pct: 25, low_pct: 8.9, high_pct: 53.2, effective_records: 12 });
  const se = r.routing.silent_errors.rate;
  assert.deepEqual([se.pct, se.low_pct, se.high_pct], [25, 8.9, 53.2]);
  const st = r.routing.straight_through;
  assert.deepEqual(six(r.mix.straight_through), { pct: st.pct, low_pct: st.low_pct, high_pct: st.high_pct, effective_records: 15 });
});

test('a group with a share and nothing out is named; "(none)" with a share is a group like any other (the story mix)', () => {
  const r = withMix(f('mix-story.json'), grouped('story'));
  assert.deepEqual(r.mix.strata.map(x => [x.label, x.records, x.out, x.silent_errors]),
    [['A', 4, 4, 3], ['B', 4, 3, 0], ['C', 2, 2, 0], ['D', 2, 2, 0], ['E', 2, 0, 0], ['(none)', 1, 1, 0]]);
  assert.deepEqual(six(r.mix.silent_error_rate), { pct: 15.8, low_pct: 3.7, high_pct: 48, effective_records: 9.25641 });
  assert.deepEqual(six(r.mix.straight_through), { pct: 79.2, low_pct: 50.9, high_pct: 93.3, effective_records: 12 });
  assert.deepEqual(r.mix.none_out, ['E']);
  assert.equal(r.mix.strata[4].share_pct, 16.7);
});

test('G1: when nothing would go out on the mix, the rate is null and the report says why', () => {
  const t = tmpFile({ group: 'story', shares: { A: 0, B: 0, C: 0, D: 0, E: 1, '(none)': 0 } });
  try {
    const r = withMix(t.file, grouped('story'));
    assert.deepEqual(r.mix.silent_error_rate, { pct: null, low_pct: null, high_pct: null, effective_records: null });
    assert.equal(r.mix.why, 'nothing_out');
    assert.deepEqual(six(r.mix.straight_through), { pct: 0, low_pct: 0, high_pct: 65.8, effective_records: 2 });
    const line = require('../src/report/terminal.js').renderTerminal(r);
    assert.match(line, /the silent error rate cannot be estimated: no group with a share sent a record out without review, so nothing would go out on that mix\./);
  } finally { t.done(); }
});

test('G6: the records\' worth is rounded once, where the line shows it: 5.4598 is about 5, not 5.5 and then 6', () => {
  // The reviewer's mix: business 36, general 964.
  const t = tmpFile({ group: 'section', shares: { business: 36, general: 964 } });
  try {
    const r = withMix(t.file);
    near(r.mix.silent_error_rate.effective_records, 5.459771, 6);
    const line = require('../src/report/terminal.js').renderTerminal(r);
    assert.match(line, /the silent error rate would be about 1\.9% \(likely 0\.0-43\.5%; about 5 records' worth\)/);
  } finally { t.done(); }
});

// ---------- What stops (G18-G21) ----------

test('G19: a group in the run with no share stops, naming it, in lenient mode too', () => {
  for (const mode of ['strict', 'lenient']) {
    const e = mixError({ group: 'section', shares: { business: 1 } }, grouped('section'), mode);
    assert.match(e, /\[G19\] .*mix\.json: "general" is a group of this run \(7 records\) with no share: the report cannot guess the weight of a kind of record/, mode);
    assert.doesNotMatch(e, /\* \[G19\]/);   // not a strict-only stop
  }
});

test('G19: a record with no label stops, naming it, unless "(none)" has a share', () => {
  const shares = { A: 1, B: 1, C: 1, D: 1, E: 1 };
  const e = mixError({ group: 'story', shares }, grouped('story'));
  assert.match(e, /\[G19\] .*key\.json N13: has no label for group "story", so it sits in no group of the mix in .*mix\.json: give it a label, or give "\(none\)" a share/);
  assert.equal((e.match(/\[G19\]/g) || []).length, 1);   // one stop, for the record; not again for "(none)"
  assert.equal(mixError({ group: 'story', shares: { ...shares, '(none)': 0 } }, grouped('story')), null);
});

test('G20: a share for a group the run does not have stops, naming it, with "did you mean" for case or spaces', () => {
  const e = mixError({ group: 'section', shares: { business: 1, general: 8, opinion: 1 } });
  assert.match(e, /\[G20\] .*mix\.json: gives "opinion" a share, but no record in this run has that label for group "section" \(labels here: business, general\): its records were never tested, so nothing can be said about them/);
  // A zero share for it too: the file names a kind of record this run never tested.
  assert.match(mixError({ group: 'section', shares: { business: 1, general: 8, opinion: 0 } }), /\[G20\] .*"opinion"/);
  const typo = mixError({ group: 'section', shares: { Business: 1, general: 8 } });
  assert.match(typo, /\[G20\] .*gives "Business" a share.*\(did you mean "business"\? Labels must match exactly\)/);
  assert.match(typo, /\[G19\] .*"business" is a group of this run \(8 records\) with no share/);
});

test('G21 and G19 on the queue fixture: Q10 has two channels and Q7 none; both named at once, in lenient mode too', () => {
  const config = addGroupBy(loadConfig(path.join(Q, 'config.json')), ['channel']);
  for (const mode of ['strict', 'lenient']) {
    let e = null;
    try { withMix(path.join(Q, 'mix.json'), config, mode, path.join(Q, 'predictions.json'), path.join(Q, 'key.json')); } catch (x) { e = x.message; }
    assert.match(e, /2 problem\(s\) stop scoring/, mode);
    assert.match(e, /\[G21\] .*key\.json Q10: has 2 labels for group "channel" \(chat, email\); on a mix each record must sit in exactly one group, or its weight would count twice/);
    assert.match(e, /\[G19\] .*key\.json Q7: has no label for group "channel"/);
  }
  // A share for "(none)" clears Q7; Q10 still stops.
  const e = mixError({ group: 'channel', shares: { email: 0.7, chat: 0.3, '(none)': 0 } }, config, 'strict', path.join(Q, 'predictions.json'), path.join(Q, 'key.json'));
  assert.match(e, /1 problem\(s\) stop scoring[\s\S]*\[G21\] .*Q10/);
});

test('G18: a mix file the tool cannot use stops before scoring, naming what is wrong', () => {
  const config = grouped('section');
  const err = content => {
    const t = tmpFile(content);
    try { loadMix(t.file, config); return null; } catch (e) { return e.message; } finally { t.done(); }
  };
  const cases = [
    [{ group: 'channel', shares: { a: 1 } }, /\[G18\] .*mix\.json: group "channel" is not a group of this run \(groups: section\)/],
    [{ group: 'section', shares: { business: '0.1', general: 0.9 } }, /the share for "business" is the text "0\.1"; a share must be a number \(a fraction, a percentage or a count\)/],
    [{ group: 'section', shares: { business: -1, general: 2 } }, /the share for "business" is negative \(-1\)/],
    [{ group: 'section', shares: { business: 0, general: 0 } }, /every share is 0: there is nothing to weight by/],
    // Each a number, but their total overflows to Infinity: every weight would come out 0 (or NaN).
    ['{ "group": "section", "shares": { "business": 1e308, "general": 1e308 } }', /the shares add up to more than a number can hold \(Infinity\): write them smaller, as fractions or percentages/],
    [{ group: 'section', shares: {} }, /"shares" is empty: give each group of the run its share of real traffic/],
    [{ group: 'section', shares: [0.1, 0.9] }, /"shares" must be an object: \{ "<label>": <share>, \.\.\. \}/],
    [{ shares: { business: 1 } }, /needs "group": the name of a group from the config's groups or --group-by/],
    [{ group: 'section', shares: { business: 1, general: 1 }, note: 'x' }, /unknown key "note" \(allowed: group, shares\)/],
    [[{ group: 'section' }], /expected \{ "group": "<group>", "shares": \{ "<label>": <share>, \.\.\. \} \}, got a list/],
    ['{ "group": ', /not valid JSON/],
  ];
  for (const [content, expected] of cases) assert.match(err(content) || 'no error', expected, JSON.stringify(content));
  // With no groups at all, the message says how to name one.
  const t = tmpFile({ group: 'section', shares: { business: 1 } });
  try {
    assert.throws(() => loadMix(t.file, loadConfig(f('config.json'))), /this run has no groups: name the group with --group-by <field> or in the config's groups/);
  } finally { t.done(); }
  assert.throws(() => loadMix(path.join(dir, 'no-such-mix.json'), config), /\[G18\] .*cannot read the mix file/);
  // A clean file reads as its group and its shares, in the file's order.
  assert.deepEqual(loadMix(f('mix.json'), config), { file: f('mix.json'), group: 'section', shares: [{ label: 'business', given: 0.1 }, { label: 'general', given: 0.9 }] });
});

// ---------- The reports ----------

const LINE = file => 'On the real mix in ' + file + ' (business 10%, general 90%), the silent error rate would be about 5.1% ' +
  '(likely 0.4-43.7%; about 6 records\' worth), against 25.0% on this golden set. A reweighting, not a measurement: it is only ' +
  'as good as the shares, and as the records tested in each group.';
const ST_LINE = 'On that mix, about 73.0% of records would go out without review (likely 40.2-91.6%; about 9 records\' worth), against 80.0% on this golden set.';

test('the terminal says it under the headline, with the straight-through, and notes a group with nothing out', () => {
  const { renderTerminal } = require('../src/report/terminal.js');
  const t = renderTerminal(withMix(f('mix.json')));
  assert.ok(t.includes('\n  ' + LINE(f('mix.json')) + '\n  ' + ST_LINE + '\n'), t);
  assert.ok(t.indexOf('HEADLINE') < t.indexOf('On the real mix') && t.indexOf('On the real mix') < t.indexOf('SILENT ERRORS'));
  const story = renderTerminal(withMix(f('mix-story.json'), grouped('story')));
  assert.match(story, /\(A 16\.7%, B 16\.7%, C 16\.7%, D 16\.7%, E 16\.7%, \(none\) 16\.7%\), the silent error rate would be about 15\.8% \(likely 3\.7-48\.0%; about 9 records' worth\)/);
  assert.match(story, /\n {2}Group "E" \(16\.7% of the mix\) sent none of its 2 records out without review: on the mix it lowers the straight-through, and adds nothing to the silent error rate, which rests on the other groups\.\n/);
  assert.doesNotMatch(renderTerminal(scoreRun({ config: grouped('section'), predPath: PRED, keyPath })), /On the real mix|On that mix/);
  // With clusters too, the mix's range says it counts records as independent.
  const config = { ...grouped('section'), clusters: { field: 'story', from: 'key' } };
  assert.match(renderTerminal(withMix(f('mix.json'), config)), /against 80\.0% on this golden set\.\n {2}The range on the mix counts every record as independent, not clusters\./);
});

test('the HTML report carries the same lines under the headline, escaped', () => {
  const { renderHtml } = require('../src/report/html.js');
  const h = renderHtml(withMix(f('mix.json')), '2026-10-31T00:00:00.000Z');
  const esc = s => s.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
  assert.ok(h.includes('<p>' + esc(LINE(f('mix.json'))) + '<br>' + esc(ST_LINE) + '</p>'), 'mix lines in the HTML');
  assert.ok(h.indexOf('class="card hero"') < h.indexOf('On the real mix') && h.indexOf('On the real mix') < h.indexOf('<h2>Silent errors</h2>'));
  assert.doesNotMatch(renderHtml(scoreRun({ config: grouped('section'), predPath: PRED, keyPath }), '2026-10-31T00:00:00.000Z'), /On the real mix/);
  const evil = structuredClone(withMix(f('mix.json')));
  evil.mix.strata[0].label = '<img src=x onerror=alert(1)>';
  evil.mix.file = '<script>x</script>';
  const bad = renderHtml(evil, '2026-10-31T00:00:00.000Z');
  assert.doesNotMatch(bad, /<img src=x|<script>x/);
});

test('the JSON carries results.mix only with --mix', () => {
  const { resultsJson } = require('../src/report/json.js');
  const j = resultsJson(withMix(f('mix.json')));
  assert.equal(j.mix.silent_error_rate.pct, 5.1);
  assert.equal(j.inputs.mix, f('mix.json'));
  const plain = resultsJson(scoreRun({ config: grouped('section'), predPath: PRED, keyPath }));
  assert.equal('mix' in plain, false);
  assert.equal('mix' in plain.inputs, false);
});

// ---------- The command line ----------

test('wfeval score --group-by section --mix: the line, exit 0; refused with --grades; an unknown group exits 1', () => {
  const args = ['score', '--config', f('config.json'), '--pred', PRED, '--key', keyPath];
  const ok = cli([...args, '--group-by', 'section', '--mix', f('mix.json')]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(ok.stdout.includes('  ' + LINE(f('mix.json')) + '\n  ' + ST_LINE + '\n'), ok.stdout);
  const noGroup = cli([...args, '--mix', f('mix.json')]);
  assert.equal(noGroup.status, 1);
  assert.match(noGroup.stderr, /\[G18\] .*this run has no groups: name the group with --group-by <field>/);
  const grades = cli(['score', '--grades', 'g.json', '--mix', f('mix.json')]);
  assert.equal(grades.status, 1);
  assert.match(grades.stderr, /does not take --mix/);
  assert.match(cli(['--help']).stdout, /--mix <file>/);
  // The config's own groups serve as well as --group-by.
  const t = tmpFile({ ...raw, groups: { section: { field: 'section' } } }, 'config.json');
  try {
    const viaConfig = cli(['score', '--config', t.file, '--pred', PRED, '--key', keyPath, '--mix', f('mix.json')]);
    assert.equal(viaConfig.status, 0, viaConfig.stderr);
    assert.match(viaConfig.stdout, /the silent error rate would be about 5\.1%/);
  } finally { t.done(); }
  assert.ok(validateConfig(raw).errors.length === 0);
});
