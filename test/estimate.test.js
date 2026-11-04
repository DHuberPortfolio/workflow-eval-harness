// wfeval estimate: a judge's answer key for every record, checked by a person on a sample
// (traps K1-K9). Checked against test/fixtures/estimate/EXPECTED.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('../src/config.js');

const dir = path.join(__dirname, 'fixtures', 'estimate');
const f = name => path.join(dir, name);
const CONFIG = f('config.json');
const PRED = f('predictions.json');
const JUDGE = f('judge-key.json');
const PERSON = f('person-key.json');
const near = (actual, expected, places) => assert.ok(Math.abs(actual - expected) < 0.5 * 10 ** -places, actual + ' is not ' + expected);
const cli = args => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wfeval.js'), ...args], { encoding: 'utf8' });
// Required inside each test, so each test fails on its own where the code does not exist.
const metrics = () => require('../src/metrics/estimate.js');
const estimateRun = opts => require('../src/estimate.js').estimateRun({ config: loadConfig(CONFIG), predPath: PRED, judgeKeyPath: JUDGE, personKeyPath: PERSON, ...opts });

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
// Temporary files for one test: { name: content } -> { name: path }, and a clean-up.
function tmp(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-estimate-'));
  const out = {};
  for (const [name, content] of Object.entries(files)) {
    out[name] = path.join(d, name);
    fs.writeFileSync(out[name], typeof content === 'string' ? content : JSON.stringify(content));
  }
  return { ...out, done: () => fs.rmSync(d, { recursive: true }) };
}
// The error estimateRun stops with, or null when it does not stop; or its results with ok().
function attempt(files, mode = 'strict') {
  const t = tmp(files);
  try {
    return { results: estimateRun({ predPath: t.pred || PRED, judgeKeyPath: t.judge || JUDGE, personKeyPath: t.person || PERSON, mode }), error: null };
  } catch (e) {
    return { results: null, error: e.message };
  } finally { t.done(); }
}

// ---------- the arithmetic (EXPECTED.md, "The estimate") ----------

test('estimate: post-stratified rate and its MOVER range, worked by hand', () => {
  const r = metrics().estimateRange({ out: 20, flagged: 5, checked: { flagged: { n: 4, errors: 3 }, passed: { n: 6, errors: 1 } } });
  assert.equal(r.estimate, 0.3125);
  near(r.low, 0.128219, 6);
  near(r.high, 0.642003, 6);
  assert.equal(r.why, null);
});

test('estimate: a group end beside 1 or 2 errors comes from the exact binomial when that is wider', () => {
  // 1 error in 6: Wilson's low is 3.0%, the exact low 1 - 0.975^(1/6) = 0.42%.
  // 3 of 4 (1 record fine): Wilson's high 95.4%, the exact high 0.975^(1/4) = 99.37%.
  // One group only (the judge flags none), so the range is that group's own.
  const one = metrics().estimateRange({ out: 20, flagged: 0, checked: { flagged: { n: 0, errors: 0 }, passed: { n: 6, errors: 1 } } });
  near(one.low, 1 - 0.975 ** (1 / 6), 6);
  near(one.high, 0.563509, 6);
  const all = metrics().estimateRange({ out: 20, flagged: 20, checked: { flagged: { n: 4, errors: 3 }, passed: { n: 0, errors: 0 } } });
  near(all.low, 0.300636, 6);
  near(all.high, 0.975 ** 0.25, 6);
});

test('estimate: worth about 9.3 records checked by a person alone', () => {
  const { estimateRange, worthOf } = metrics();
  const r = estimateRange({ out: 20, flagged: 5, checked: { flagged: { n: 4, errors: 3 }, passed: { n: 6, errors: 1 } } });
  near(worthOf(r.estimate, r.low, r.high), 9.26, 2);
  // A person's own Wilson range over 40 records is worth exactly 40.
  const { wilson } = require('../src/metrics/stats.js');
  const w = wilson(10, 40);
  near(worthOf(0.25, w.low, w.high), 40, 6);
});

test('K3: a verdict group with checks missing gives bounds, never an estimate', () => {
  const r = metrics().estimateRange({ out: 20, flagged: 5, checked: { flagged: { n: 0, errors: 0 }, passed: { n: 6, errors: 1 } } });
  assert.equal(r.estimate, null);
  assert.equal(r.why, 'group_unchecked');
  // Low: the flagged quarter at 0%, the rest at its own low. High: the flagged quarter at 100%.
  near(r.low, 0.75 * (1 - 0.975 ** (1 / 6)), 6);
  near(r.high, 0.25 + 0.75 * 0.563509, 6);
});

// ---------- the fixture, end to end (EXPECTED.md) ----------

test('estimate: the fixture', () => {
  const r = estimateRun({});
  assert.equal(r.kind, 'estimate');
  assert.equal(r.records, 22);
  assert.equal(r.out, 20);
  assert.deepEqual(r.judge, { flagged: 5, rate: { n: 5, d: 20, pct: 25, low_pct: 11.2, high_pct: 46.9 } });
  assert.deepEqual(r.checked.flagged, { n: 4, errors: 3 });
  assert.deepEqual(r.checked.passed, { n: 6, errors: 1 });
  assert.deepEqual(r.checked.not_out, []);
  assert.equal(r.estimate.pct, 31.3);
  assert.equal(r.estimate.low_pct, 12.8);
  assert.equal(r.estimate.high_pct, 64.2);
  near(r.estimate.worth_records, 9.26, 2);
  assert.deepEqual(r.person_only.rate, { n: 4, d: 10, pct: 40, low_pct: 16.8, high_pct: 68.7 });
  assert.equal(r.person_only.looks_random, true);
  assert.deepEqual(r.judge_quality, { person_errors: 4, judge_caught: 3, judge_flags_checked: 4, person_confirmed: 3, kappa: 0.583 });
  assert.deepEqual(r.disagreements.map(x => [x.id, x.judge, x.person]), [['E04', true, false], ['E07', false, true]]);
  assert.deepEqual(r.unchecked_groups, []);
  assert.deepEqual(r.problems.filter(i => i.level !== 'fix'), []);
});

test('estimate: --target says whether the rate is shown under it, and roughly what would show it', () => {
  // Under 50%: not shown (high 64.2%), and no split of the 10 records left would show it: 20
  // records out are too few to pin the rate down that far (EXPECTED.md, "A target").
  const r = estimateRun({ target: 50 });
  assert.equal(r.target.shown, false);
  assert.equal(r.target.at_or_above, false);
  assert.equal(r.target.more, null);
  assert.equal(r.target.why, 'all_records_checked');
  assert.match(cliWith({}, ['--target', '50']), /even checking every record out would not show it/);
  // The guide allows for the checks already made, never asks for more records than are left, and
  // always clears the target with the range the report shows (whole errors, exact ends). Its count
  // is the fewest on a smooth projection (each rate held exactly, Wilson ends), plus any checks the
  // shown range needs on top; rounding can let a lucky split clear sooner on the shown range, so the
  // guide is never fewer than that and errs high, not low.
  const { estimateRange, targetOf } = metrics();
  const projected = (counts, fl, pa) => { const c = counts.checked; const g = (x, e) => ({ n: x.n + e, errors: x.n ? Math.round(x.errors / x.n * (x.n + e)) : 0 });
    return estimateRange({ out: counts.out, flagged: counts.flagged, checked: { flagged: g(c.flagged, fl), passed: g(c.passed, pa) } }).high; };
  const smooth = (counts, fl, pa) => { const c = counts.checked; const g = (x, e) => ({ n: x.n + e, errors: x.n ? x.errors / x.n * (x.n + e) : 0 });
    return estimateRange({ out: counts.out, flagged: counts.flagged, checked: { flagged: g(c.flagged, fl), passed: g(c.passed, pa) } }, 1.96, false).high; };
  const everySplit = (counts, tp, high = projected) => {
    const c = counts.checked, lf = counts.flagged - c.flagged.n, lp = counts.out - counts.flagged - c.passed.n;
    for (let k = 1; k <= 200; k++) for (let fl = Math.max(0, k - lp); fl <= Math.min(k, lf); fl++) if (high(counts, fl, k - fl) < tp / 100) return { total: k, flagged: fl, passed: k - fl };
    return null;
  };
  for (const [counts, tp] of [
    [{ out: 5000, flagged: 250, checked: { flagged: { n: 10, errors: 6 }, passed: { n: 190, errors: 2 } } }, 6],
    [{ out: 2000, flagged: 400, checked: { flagged: { n: 5, errors: 1 }, passed: { n: 300, errors: 3 } } }, 8],
    [{ out: 5000, flagged: 500, checked: { flagged: { n: 10, errors: 3 }, passed: { n: 400, errors: 4 } } }, 6],
    [{ out: 1000, flagged: 100, checked: { flagged: { n: 20, errors: 10 }, passed: { n: 30, errors: 0 } } }, 10],
    [{ out: 60, flagged: 40, checked: { flagged: { n: 10, errors: 3 }, passed: { n: 18, errors: 0 } } }, 32],
  ]) {
    const t = targetOf(counts, estimateRange(counts), tp).more;
    const fewest = everySplit(counts, tp);
    assert.ok(t !== null && fewest !== null, JSON.stringify(counts.checked));
    assert.ok(projected(counts, t.flagged, t.passed) < tp / 100);
    assert.ok(t.flagged <= counts.flagged - counts.checked.flagged.n && t.passed <= counts.out - counts.flagged - counts.checked.passed.n);
    const smoothFewest = everySplit(counts, tp, smooth);
    assert.ok(t.total >= fewest.total, JSON.stringify([t, fewest]));
    if (smoothFewest) assert.ok(t.total <= smoothFewest.total + 5, JSON.stringify([t, smoothFewest]));
  }
  // Every record out already checked (10 out, 2 flagged, no errors): no records left, so no guide,
  // never "1 more check" of a record that does not exist.
  const census = { out: 10, flagged: 2, checked: { flagged: { n: 2, errors: 0 }, passed: { n: 8, errors: 0 } } };
  const tc = targetOf(census, estimateRange(census), 30);
  assert.equal(tc.more, null);
  assert.equal(tc.why, 'all_records_checked');
  // 10 of 100 flags and 0 of 100 passes wrong, 1,000,000 out, 10,000 flagged: under 0.53% takes
  // about 19,800 more checks, past the old cap of 20,000 on the search; it is found now.
  const big = { out: 1000000, flagged: 10000, checked: { flagged: { n: 100, errors: 50 }, passed: { n: 100, errors: 0 } } };
  assert.equal(targetOf(big, estimateRange(big), 0.53).more.total, 19804);
  const shown = estimateRun({ target: 70 }).target;
  assert.equal(shown.shown, true);
  assert.equal(shown.more, null);
  const above = estimateRun({ target: 30 }).target;
  assert.equal(above.at_or_above, true);
  assert.equal(above.more, null);
});

test('estimate: the CLI prints the estimate, the contrasts and the disagreements, and writes JSON', () => {
  const out = path.join(os.tmpdir(), 'wfeval-estimate-' + process.pid + '.json');
  const r = cli(['estimate', '--config', CONFIG, '--pred', PRED, '--judge-key', JUDGE, '--key', PERSON, '--json', out]);
  assert.equal(r.status, 0, r.stderr);
  for (const s of ['31.3%', '12.8% and 64.2%', 'worth about 9 records checked by a person alone', '25.0%', '40.0%', 'E04', 'E07',
    'picked at random', 'without seeing the judge']) {
    assert.ok(r.stdout.includes(s), 'missing "' + s + '" in:\n' + r.stdout);
  }
  const j = read(out);
  fs.rmSync(out);
  assert.equal(j.estimate.pct, 31.3);
  assert.equal(j.kind, 'estimate');
});

test('estimate: the CLI refuses a missing file flag', () => {
  const r = cli(['estimate', '--config', CONFIG, '--pred', PRED, '--key', PERSON]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--judge-key/);
});

// ---------- the traps ----------

const preds = read(PRED);
const judge = read(JUDGE);
const person = read(PERSON);

test('K1: a checked record not in the run stops, in lenient mode too', () => {
  for (const mode of ['strict', 'lenient']) {
    const { error } = attempt({ person: [...person, { id: 'E99', category: 'refund' }] }, mode);
    assert.match(error, /\[K1\].*E99/);
  }
});

test('K2: a judge key missing records of the run stops, naming them', () => {
  for (const mode of ['strict', 'lenient']) {
    const { error } = attempt({ judge: judge.filter(x => x.id !== 'E12' && x.id !== 'E13') }, mode);
    assert.match(error, /\[K2\].*E12.*E13/);
  }
});

test('K3: a verdict group with no checked records: no estimate, bounds, and a warning saying why', () => {
  const { results: r } = attempt({ person: person.filter(x => !['E01', 'E02', 'E04', 'E05'].includes(x.id)) });
  assert.equal(r.estimate.pct, null);
  assert.equal(r.estimate.why, 'group_unchecked');
  assert.deepEqual(r.unchecked_groups, ['flagged']);
  near(r.estimate.low_pct, 0.3, 1);
  near(r.estimate.high_pct, 67.3, 1);
  assert.ok(r.problems.some(i => i.trap === 'K3' && i.level === 'warn'));
  const out = cliWith({ person: person.filter(x => !['E01', 'E02', 'E04', 'E05'].includes(x.id)) });
  assert.match(out, /no estimate/i);
  assert.doesNotMatch(out, /worth about/);
});

test('K4: the judge flags none of the records out: one group, the person\'s rate, and a warning', () => {
  const { results: r } = attempt({ judge: preds.map(x => ({ id: x.id, category: x.category })) });
  assert.equal(r.judge.flagged, 0);
  assert.equal(r.estimate.pct, 40);   // 4 of 10, the person's own: every check is in the one group
  assert.ok(r.problems.some(i => i.trap === 'K4'));
  // And all: the judge flags every record out.
  const other = { refund: 'billing', billing: 'shipping', shipping: 'other', other: 'refund' };
  const { results: all } = attempt({ judge: preds.map(x => ({ id: x.id, category: other[x.category] })) });
  assert.equal(all.judge.flagged, 20);
  assert.equal(all.estimate.pct, 40);
  assert.ok(all.problems.some(i => i.trap === 'K4'));
});

test('K5: checked records that did not go out without review are left out and named', () => {
  const extra = [...person, { id: 'E21', category: 'refund' }];
  const { results: r } = attempt({ person: extra });
  assert.deepEqual(r.checked.not_out, ['E21']);
  assert.equal(r.checked.flagged.n + r.checked.passed.n, 10);
  assert.ok(r.problems.some(i => i.trap === 'K5' && i.level === 'warn' && /E21/.test(i.message)));
  // Nothing checked among the records out: nothing to estimate from, so it stops.
  const { error } = attempt({ person: [{ id: 'E21', category: 'refund' }] });
  assert.match(error, /\[K5\]/);
});

test('K6: a duplicated id in either key stops', () => {
  assert.match(attempt({ person: [...person, person[0]] }).error, /\[B3\].*E01/);
  assert.match(attempt({ judge: [...judge, judge[3]] }).error, /\[B3\].*E04/);
});

test('K7: checked records bunched at the start of the run look non-random: a warning', () => {
  // The first six records the judge passes, E06-E11, instead of six spread through the run.
  const first = ['E01', 'E02', 'E04', 'E05', 'E06', 'E07', 'E08', 'E09', 'E10', 'E11'];
  const p2 = first.map(id => person.find(x => x.id === id) || { id, category: preds.find(x => x.id === id).category });
  const { results: r } = attempt({ person: p2 });
  const w = r.problems.filter(i => i.trap === 'K7');
  assert.equal(w.length, 1);
  assert.equal(w[0].level, 'warn');
  assert.match(w[0].message, /passes/);
  // The fixture's own spread-out checks raise nothing.
  assert.ok(!estimateRun({}).problems.some(i => i.trap === 'K7'));
});

test('K8: keys covering different outputs: an output one key never fills is a warning, in both modes', () => {
  // A config with a second output, a set, which the judge left empty on every record. (A label
  // output left empty already stops: F4.)
  const cfg = read(CONFIG);
  cfg.outputs.tags = { type: 'set' };
  const p2 = preds.map(x => ({ ...x, tags: [] }));
  const j2 = judge.map(x => ({ ...x, tags: [] }));
  const k2 = person.map(x => ({ ...x, tags: ['urgent'] }));
  const t = tmp({ config: cfg, pred: p2, judge: j2, person: k2 });
  const run = mode => {
    try { return require('../src/estimate.js').estimateRun({ config: loadConfig(t.config), predPath: t.pred, judgeKeyPath: t.judge, personKeyPath: t.person, mode }); } catch (e) { return e.message; }
  };
  try {
    for (const mode of ['strict', 'lenient']) {
      const r = run(mode);
      assert.ok(r.problems.some(i => i.trap === 'K8' && i.level === 'warn' && /tags/.test(i.message)), mode);
    }
  } finally { t.done(); }
});

test('estimate: a person who finds no error raises no "every prediction matches the key" warning (A8)', () => {
  const clean = person.map(x => ({ id: x.id, category: preds.find(r => r.id === x.id).category }));
  const { results: r } = attempt({ person: clean });
  assert.equal(r.checked.flagged.errors + r.checked.passed.errors, 0);
  assert.ok(!r.problems.some(i => i.trap === 'A8'), JSON.stringify(r.problems));
  // 0 of 4 flagged and 0 of 6 passed: 0%, and a range above 0 (never zero wide).
  assert.equal(r.estimate.pct, 0);
  assert.ok(r.estimate.high_pct > 0);
});

test('K9: the same file as both keys stops', () => {
  const r = cli(['estimate', '--config', CONFIG, '--pred', PRED, '--judge-key', PERSON, '--key', PERSON]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\[K9\]/);
});

test('estimate: the simulation that chose the method is seeded and repeatable', () => {
  const { run } = require('../scripts/estimate-simulation.js');
  const a = run({ reps: 3, seed: 7 });
  const b = run({ reps: 3, seed: 7 });
  assert.deepEqual(a, b);
  assert.ok(a.per.mover.length === 648);
});

function cliWith(files, extra = []) {
  const t = tmp(files);
  try {
    const r = cli(['estimate', '--config', CONFIG, '--pred', t.pred || PRED, '--judge-key', t.judge || JUDGE, '--key', t.person || PERSON, ...extra]);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  } finally { t.done(); }
}

// ---------- Which records to check: allocate() and --pick (EXPECTED.md, "Picking the checks") ----------

const pickRun = opts => require('../src/estimate.js').pickRun({ config: loadConfig(CONFIG), predPath: PRED, judgeKeyPath: JUDGE, ...opts });

test('allocate: the split rules, worked by hand', () => {
  const { allocate } = metrics();
  // 10 checks, 20 out, 5 flagged (a quarter): proportional 2.5, rounded to 3; half on the flags 5.
  assert.deepEqual(allocate(10, 20, 5, 'proportional'), { flagged: 3, passed: 7 });
  assert.deepEqual(allocate(10, 20, 5, 0.5), { flagged: 5, passed: 5 });
  // Every flag, but at least one check left for the passes.
  assert.deepEqual(allocate(10, 20, 5, 'all_flags'), { flagged: 5, passed: 5 });
  assert.deepEqual(allocate(4, 20, 5, 'all_flags'), { flagged: 3, passed: 1 });
  // At least one check per group: 30 checks, 1,000 out, 2 flagged, proportional 0.06 -> 1.
  assert.deepEqual(allocate(30, 1000, 2, 'proportional'), { flagged: 1, passed: 29 });
  // No group more than it has: 30 checks, 40 out, 38 flagged; 10% would be 3, but only 2 passes.
  assert.deepEqual(allocate(30, 40, 38, 0.1), { flagged: 28, passed: 2 });
  // The judge used one verdict only: everything in that group.
  assert.deepEqual(allocate(6, 20, 0, 'plan'), { flagged: 0, passed: 6 });
  assert.deepEqual(allocate(6, 20, 20, 'plan'), { flagged: 6, passed: 0 });
});

test('allocate plan: the split with the narrowest range if the flags were half wrong and the passes all right', () => {
  const { allocate, estimateRange } = metrics();
  // 4 checks, 20 out, 5 flagged: 1, 2 or 3 on the flags. Worked by hand for 1 (EXPECTED.md):
  // 0-72.45%; 2 gives 0-77.7%, 3 gives 0-91.7%. So 1 flag and 3 passes.
  const one = estimateRange({ out: 20, flagged: 5, checked: { flagged: { n: 1, errors: 1 }, passed: { n: 3, errors: 0 } } });
  near(one.high, 0.724533, 6);
  assert.equal(one.low, 0);
  assert.deepEqual(allocate(4, 20, 5, 'plan'), { flagged: 1, passed: 3 });
  // And by brute force on a bigger run: the plan is the narrowest split.
  const plan = allocate(60, 1000, 80, 'plan');
  const width = n1 => { const r = estimateRange({ out: 1000, flagged: 80, checked: { flagged: { n: n1, errors: Math.round(n1 / 2) }, passed: { n: 60 - n1, errors: 0 } } }); return r.high - r.low; };
  for (let n1 = 1; n1 <= 59; n1++) assert.ok(width(plan.flagged) <= width(n1) + 1e-12, n1 + ' is narrower than ' + plan.flagged);
});

test('pick: a seeded, repeatable choice within each verdict group, in run order, without the verdicts', () => {
  const a = pickRun({ n: 10, seed: 1 });
  const b = pickRun({ n: 10, seed: 1 });
  assert.deepEqual(a.picks, b.picks);
  assert.notDeepEqual(pickRun({ n: 10, seed: 2 }).picks, a.picks);
  assert.deepEqual(a.allocation, metrics().allocate(10, 20, 5, 'plan'));
  assert.equal(a.picks.length, 10);
  assert.equal(new Set(a.picks).size, 10);
  const flagged = ['E01', 'E02', 'E03', 'E04', 'E05'];
  assert.equal(a.picks.filter(id => flagged.includes(id)).length, a.allocation.flagged);
  // Only records out without review; in the run's order, so the list says nothing of the verdicts.
  assert.ok(a.picks.every(id => id !== 'E21' && id !== 'E22'));
  assert.deepEqual([...a.picks].sort(), a.picks);
  assert.ok(!('verdict' in a) && !JSON.stringify(a.picks).includes('flag'));
});

test('pick: the CLI prints the records to check and says to check them blind, and the estimate names the split', () => {
  const r = cli(['estimate', '--config', CONFIG, '--pred', PRED, '--judge-key', JUDGE, '--pick', '10', '--seed', '1']);
  assert.equal(r.status, 0, r.stderr);
  const picks = pickRun({ n: 10, seed: 1 }).picks;
  for (const id of picks) assert.ok(r.stdout.includes(id));
  assert.match(r.stdout, /without (looking at|seeing) the judge/);
  // Checks made on exactly those records, split as --pick splits them: the estimate says so.
  const k = picks.map(id => person.find(x => x.id === id) || { id, category: preds.find(x => x.id === id).category });
  const { results } = attempt({ person: k });
  assert.equal(results.split, 'pick');
  assert.equal(estimateRun({}).split, 'other');
});

test('the design simulation is seeded and repeatable', () => {
  const { run } = require('../scripts/estimate-designs.js');
  assert.deepEqual(run({ reps: 2, seed: 5 }), run({ reps: 2, seed: 5 }));
});

test('K10: --pick must be a whole number of 1 or more', () => {
  // A negative number is given as --pick=-3 (written --pick -3, -3 reads as another option, which
  // also stops).
  for (const bad of ['0', '-3', '2.5', 'ten']) {
    const r = cli(['estimate', '--config', CONFIG, '--pred', PRED, '--judge-key', JUDGE, '--pick=' + bad]);
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /\[K10\]/, bad);
  }
});

test('K11: --pick more than the records out stops, saying how many there are', () => {
  assert.throws(() => pickRun({ n: 21 }), /\[K11\].*20 records went out without review/);
  for (const n of [0, 1.5]) assert.throws(() => pickRun({ n }), /\[K10\] --pick must be a whole number/);
  assert.equal(pickRun({ n: 20 }).picks.length, 20);
});

test('K12: --pick goes without --key and --target; --seed only with --pick, as a whole number', () => {
  const base = ['estimate', '--config', CONFIG, '--pred', PRED, '--judge-key', JUDGE];
  for (const extra of [['--pick', '5', '--key', PERSON], ['--pick', '5', '--target', '5'], ['--seed', '3', '--key', PERSON], ['--pick', '5', '--seed', '1.5']]) {
    const r = cli([...base, ...extra]);
    assert.equal(r.status, 1, extra.join(' '));
    assert.match(r.stderr, /\[K12\]/, extra.join(' '));
  }
});

test('K13: --pick when the judge flags none of the records out: a plain random sample, and a warning', () => {
  const t = tmp({ judge: preds.map(x => ({ id: x.id, category: x.category })) });
  try {
    const r = require('../src/estimate.js').pickRun({ config: loadConfig(CONFIG), predPath: PRED, judgeKeyPath: t.judge, n: 6, seed: 1 });
    assert.deepEqual(r.allocation, { flagged: 0, passed: 6 });
    assert.ok(r.problems.some(i => i.trap === 'K13' && i.level === 'warn'));
  } finally { t.done(); }
});

// ---------- Fixes from an independent review ----------

test('a checked duplicate whose primary was not checked is judged, not stopped (C9 looks in the run)', () => {
  // The queue fixture, with Q1, Q2, Q4, Q6, Q8 and Q9 sent out; the person checks Q2, Q8 (a
  // duplicate of Q1, which they did not check) and Q9.
  const Q = path.join(__dirname, 'fixtures', 'queue');
  const qp = read(path.join(Q, 'predictions.json')).map(r => ({ ...r, decision: ['Q1', 'Q2', 'Q4', 'Q6', 'Q8', 'Q9'].includes(r.id) ? 'SEND' : r.decision }));
  const qk = read(path.join(Q, 'key.json'));
  const t = tmp({ pred: qp, judge: qk, person: qk.filter(k => ['Q2', 'Q8', 'Q9'].includes(k.id)) });
  try {
    const r = require('../src/estimate.js').estimateRun({ config: loadConfig(path.join(Q, 'config.json')), predPath: t.pred, judgeKeyPath: t.judge, personKeyPath: t.person });
    // The judge's key is the real key here, so the person agrees with it on every check.
    assert.equal(r.checked.flagged.n + r.checked.passed.n, 3);
    assert.equal(r.disagreements.length, 0);
    assert.ok(!r.problems.some(i => i.trap === 'C9'));
  } finally { t.done(); }
  // A duplicate of a record that is not in the run at all still stops.
  const t2 = tmp({ pred: qp, judge: qk, person: qk.filter(k => ['Q2', 'Q9'].includes(k.id)).concat([{ ...qk.find(k => k.id === 'Q8'), duplicate_of: 'Q99' }]) });
  try {
    assert.throws(() => require('../src/estimate.js').estimateRun({ config: loadConfig(path.join(Q, 'config.json')), predPath: t2.pred, judgeKeyPath: t2.judge, personKeyPath: t2.person }), /\[C9\].*Q99/);
  } finally { t2.done(); }
});

test('K8: a rare set output the person rightly leaves empty on every check is a warning, not a stop', () => {
  const cfg = read(CONFIG);
  cfg.outputs.tags = { type: 'set' };
  const p2 = preds.map(r => ({ ...r, tags: r.id === 'E07' ? ['urgent'] : [] }));
  const j2 = judge.map(r => ({ ...r, tags: ['E07', 'E09'].includes(r.id) ? ['urgent'] : [] }));
  const k2 = person.map(r => ({ ...r, tags: [] }));
  const t = tmp({ config: cfg, pred: p2, judge: j2, person: k2 });
  try {
    const r = require('../src/estimate.js').estimateRun({ config: loadConfig(t.config), predPath: t.pred, judgeKeyPath: t.judge, personKeyPath: t.person, mode: 'strict' });
    assert.ok(r.problems.some(i => i.trap === 'K8' && i.level === 'warn'));
  } finally { t.done(); }
});

test('K9: a copy of the judge key given as the person key stops too', () => {
  const { error } = attempt({ person: fs.readFileSync(JUDGE, 'utf8') });
  assert.match(error, /\[K9\]/);
});

// ---------- Fixes from a newcomer's end-to-end test ----------

test('K2: the judge needs verdicts only for the records out without review', () => {
  // E21 and E22 were sent to a person: a judge key without them gives the same estimate.
  const { results: r, error } = attempt({ judge: judge.filter(x => x.id !== 'E21' && x.id !== 'E22') });
  assert.equal(error, null);
  assert.deepEqual(r.estimate, estimateRun({}).estimate);
  assert.equal(r.records, 22);
  const k = require('../src/estimate.js');
  const t = tmp({ judge: judge.filter(x => x.id !== 'E21' && x.id !== 'E22') });
  try { assert.equal(k.pickRun({ config: loadConfig(CONFIG), predPath: PRED, judgeKeyPath: t.judge, n: 10, seed: 1 }).picks.length, 10); } finally { t.done(); }
  // A record out without review with no verdict still stops.
  assert.match(attempt({ judge: judge.filter(x => x.id !== 'E12') }).error, /\[K2\].*E12/);
});

test('K10: --pick too small to put one check in each verdict group stops, saying how many', () => {
  assert.throws(() => pickRun({ n: 1 }), /\[K10\].*at least 2/);
  assert.equal(pickRun({ n: 2 }).allocation.flagged, 1);
});

test('the split note does not call bunched checks the recommended way (K7)', () => {
  // The --pick split of 10 (2 flags, 8 passes), but the first ones of each group in the run.
  const ids = ['E01', 'E02', 'E06', 'E07', 'E08', 'E09', 'E10', 'E11', 'E12', 'E13'];
  const k = ids.map(id => person.find(x => x.id === id) || { id, category: preds.find(x => x.id === id).category });
  const out = cliWith({ person: k });
  assert.match(out, /\[K7\]/);
  assert.doesNotMatch(out, /the recommended way/);
  assert.match(out, /may not have been picked at random/);
});

test('person alone: judged by how the checks were picked (the picks file), never by matching counts', () => {
  const picked = pickRun({ n: 10, seed: 1 });
  const k = picked.picks.map(id => person.find(x => x.id === id) || { id, category: preds.find(x => x.id === id).category });
  // Without a picks file the report cannot know how they were picked: it shows the rate, with the condition.
  const { results: r } = attempt({ person: k });
  assert.equal(r.split, 'pick');
  assert.equal(r.person_only.looks_random, true);
  const plain = cliWith({ person: k });
  assert.match(plain, /a fair rate only if the checks were picked at random from all the records out, not by the judge's verdict as --pick does/);
  assert.doesNotMatch(plain, /the checks were split by the judge's verdict/);
  // With the picks file, it knows: picked by verdict, so not a fair rate, even with one check missing (lenient).
  const t = tmp({ person: k.slice(1), picks: { kind: 'pick', inputs: { predictions: PRED }, out: 20, seed: 1, picks: picked.picks } });
  try {
    const e = require('../src/estimate.js').estimateRun({ config: loadConfig(CONFIG), predPath: PRED, judgeKeyPath: JUDGE, personKeyPath: t.person, picksPath: t.picks, mode: 'lenient' });
    assert.equal(e.person_only.looks_random, false);
    assert.equal(e.person_only.why_not, 'picked_by_verdict');
    const out = cli(['estimate', '--config', CONFIG, '--pred', PRED, '--judge-key', JUDGE, '--key', t.person, '--picks', t.picks, '--lenient']).stdout;
    assert.match(out, /Person alone .*not a fair rate: the picks file says they were picked by the judge's verdict/);
  } finally { t.done(); }
});

test('--picks: confirms an exact match, and names a picks file made from another run', () => {
  const picked = pickRun({ n: 10, seed: 1 });
  const k = picked.picks.map(id => person.find(x => x.id === id) || { id, category: preds.find(x => x.id === id).category });
  const t = tmp({ person: k, picks: { kind: 'pick', inputs: { predictions: PRED }, out: 20, seed: 1, picks: picked.picks },
    other: { kind: 'pick', inputs: { predictions: 'elsewhere/run.json' }, out: 20, seed: 1, picks: picked.picks } });
  try {
    const out = cli(['estimate', '--config', CONFIG, '--pred', PRED, '--judge-key', JUDGE, '--key', t.person, '--picks', t.picks]).stdout;
    assert.ok(out.includes('Checked exactly the 10 records picked in ' + t.picks + ' (seed 1)'), out);
    const r = cli(['estimate', '--config', CONFIG, '--pred', PRED, '--judge-key', JUDGE, '--key', t.person, '--picks', t.other]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\[K14\].*made from another run: elsewhere\/run\.json/);
  } finally { t.done(); }
});

test('the header says what the judge key covers', () => {
  assert.match(cliWith({}), /judge's answer key: .*\(every record\)/);
  const out = cliWith({ judge: judge.filter(x => x.id !== 'E21' && x.id !== 'E22') });
  assert.match(out, /judge's answer key: .*\(20 records: the ones that went out without review\)/);
});

test('the pick suggests --picks with the file --json saved', () => {
  const j = path.join(os.tmpdir(), 'wfeval-picks-' + process.pid + '.json');
  const r = cli(['estimate', '--config', CONFIG, '--pred', PRED, '--judge-key', JUDGE, '--pick', '10', '--json', j]);
  fs.rmSync(j, { force: true });
  assert.ok(r.stdout.includes('--picks ' + j), r.stdout);
});

test('kappa when the judge gave every checked record the same verdict says it is not informative', () => {
  const passes = ['E07', 'E09', 'E11', 'E14', 'E17', 'E20'];
  const out = cliWith({ person: person.filter(x => passes.includes(x.id)).concat([{ id: 'E06', category: preds.find(x => x.id === 'E06').category }]) });
  assert.match(out, /not informative: the judge gave every checked record the same verdict/);
  assert.doesNotMatch(out, /kappa\): 0\.000/);
});

test('a census (every record out checked) words the target line for that case', () => {
  const all = preds.filter(x => x.outcome === 'SEND').map(x => person.find(k => k.id === x.id) || { id: x.id, category: x.category });
  const out = cliWith({ person: all }, ['--target', '30']);
  assert.match(out, /every record out without review was checked/);
  assert.doesNotMatch(out, /even checking every record out would not show it/);
});

test('estimate without --key points to --pick, and the pick names the real paths in its next step', () => {
  const r = cli(['estimate', '--config', CONFIG, '--pred', PRED, '--judge-key', JUDGE]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--pick/);
  const p = cli(['estimate', '--config', CONFIG, '--pred', PRED, '--judge-key', JUDGE, '--pick', '10']);
  assert.ok(p.stdout.includes('--config ' + CONFIG), p.stdout);
  assert.doesNotMatch(p.stdout, /<config>/);
});

test('K7 warns at z = 1.96, as every range in this tool', () => {
  // E07-E20 passes checked at places 2, 3, 4, 5, 9, 10 of 15: rank sum 33, expected 48,
  // variance 6 x 9 x 16 / 12 = 72, z = -15 / 8.485 = -1.77: inside 1.96, no warning. Places 2-6
  // and 10 (E07-E11, E15): sum 30,
  // z = -2.12: past 1.96 but not 2.576, so it shows the switch.
  const k = ids => ids.map(id => person.find(x => x.id === id) || { id, category: preds.find(x => x.id === id).category });
  const flags = ['E01', 'E02', 'E04', 'E05'];
  const warned = ids => attempt({ person: k([...flags, ...ids]) }).results.problems.some(i => i.trap === 'K7');
  assert.equal(warned(['E07', 'E08', 'E09', 'E10', 'E14', 'E15']), false);
  assert.equal(warned(['E07', 'E08', 'E09', 'E10', 'E11', 'E15']), true);
});

test('plain PPI on the fixture, worked by hand in EXPECTED.md: 25.0%', () => {
  // The judge's share, 5 of 20, plus the checks' average of (person - judge): E04 -1, E07 +1,
  // the other 8 zero, so (-1 + 1) / 10 = 0: they cancel. 0.25 + 0 = 25.0%, not 31.3%.
  const r = estimateRun({});
  const share = r.judge.flagged / r.out;
  const d = r.disagreements.reduce((s, x) => s + (x.person ? 1 : 0) - (x.judge ? 1 : 0), 0) / (r.checked.flagged.n + r.checked.passed.n);
  assert.equal(share + d, 0.25);
});

test('K12: --seed above 4294967295 stops (it would repeat a smaller seed)', () => {
  const r = cli(['estimate', '--config', CONFIG, '--pred', PRED, '--judge-key', JUDGE, '--pick', '5', '--seed', '4294967303']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\[K12\].*4294967295/);
});

test('K11: with no record out without review, --pick says there is nothing to pick', () => {
  const t = tmp({ pred: preds.map(x => ({ ...x, outcome: 'HOLD' })) });
  try {
    assert.throws(() => require('../src/estimate.js').pickRun({ config: loadConfig(CONFIG), predPath: t.pred, judgeKeyPath: JUDGE, n: 3 }), e => /\[K11\].*no record went out without review/.test(e.message) && !/--pick 0/.test(e.message));
  } finally { t.done(); }
});

test('--fail-if-not-shown exits 3 when the range is not wholly under the target, 0 when it is', () => {
  const base = ['estimate', '--config', CONFIG, '--pred', PRED, '--judge-key', JUDGE, '--key', PERSON];
  assert.equal(cli([...base, '--target', '50', '--fail-if-not-shown']).status, 3);
  assert.equal(cli([...base, '--target', '70', '--fail-if-not-shown']).status, 0);
  const r = cli([...base, '--fail-if-not-shown']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--target/);
});

test('K14: --picks: checks that differ from the picked list are strict', () => {
  const picked = pickRun({ n: 10, seed: 1 });
  const k = picked.picks.map(id => person.find(x => x.id === id) || { id, category: preds.find(x => x.id === id).category });
  const run = (keyRecords, mode = 'strict') => {
    const t = tmp({ person: keyRecords, picks: { kind: 'pick', picks: picked.picks } });
    try { return require('../src/estimate.js').estimateRun({ config: loadConfig(CONFIG), predPath: PRED, judgeKeyPath: JUDGE, personKeyPath: t.person, picksPath: t.picks, mode }); } catch (e) { return e.message; } finally { t.done(); }
  };
  assert.ok(!run(k).problems.some(i => i.trap === 'K14'));
  const missing = run(k.slice(1));
  assert.match(missing, /\[K14\].*1 picked record\(s\) were not checked/);
  assert.ok(run(k.slice(1), 'lenient').problems.some(i => i.trap === 'K14' && i.level === 'warn'));
  const extraId = preds.find(x => x.outcome === 'SEND' && !picked.picks.includes(x.id)).id;
  assert.match(run([...k, { id: extraId, category: preds.find(x => x.id === extraId).category }]), /\[K14\].*not in the picked list/);
});
