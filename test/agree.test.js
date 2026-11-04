// wfeval agree: Krippendorff's alpha for any number of graders. The arithmetic is pinned to the
// worked example in Krippendorff (2011), "Computing Krippendorff's Alpha-Reliability", sections C
// and D, and to test/fixtures/agree/EXPECTED.md, which works every number by hand. Trap tests are
// named after their entry in test/TRAPS.md (section M).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { krippendorffAlpha, bootstrapAlpha, jaccardDistance, masiDistance, reading } = require('../src/metrics/agreement.js');
const { agreeKeys, agreeGrades } = require('../src/agree.js');
const { loadConfig } = require('../src/config.js');
const { renderAgree } = require('../src/report/agree.js');

const dir = path.join(__dirname, 'fixtures', 'agree');
const CONFIG = loadConfig(path.join(dir, 'config.json'));
const KEYS = ['ann', 'ben', 'cai'].map(n => path.join(dir, n + '.json'));
const GA = path.join(__dirname, 'fixtures', 'freetext', 'grades-a.json');
const GB = path.join(__dirname, 'fixtures', 'freetext', 'grades-b.json');
const GC = path.join(dir, 'grades-c.json');
const r3 = x => (x === null ? null : Number(x.toFixed(3)));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-agree-'));
const write = (name, data) => { const f = path.join(tmp, name); fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data)); return f; };
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const flagged = r => r.problems.map(i => i.level + ':' + i.trap);
const throwsTrap = (fn, trap) => assert.throws(fn, e => e.message.includes('[' + trap + ']'), 'expected a stop for ' + trap);

// ---------- Krippendorff (2011), sections C and D: 4 observers, 12 units, 7 values missing ----------
// The reliability data matrix as printed on page 4 (null: no value).
const _ = null;
const PAPER = {
  A: [1, 2, 3, 3, 2, 1, 4, 1, 2, _, _, _],
  B: [1, 2, 3, 3, 2, 2, 4, 1, 2, 5, _, 3],
  C: [_, 3, 3, 3, 2, 3, 4, 2, 2, 5, 1, _],
  D: [1, 2, 3, 3, 2, 4, 4, 1, 2, 5, 1, _],
};
const paperUnits = PAPER.A.map((x, u) => ['A', 'B', 'C', 'D'].map(o => PAPER[o][u]));

test('Krippendorff 2011, section C: the coincidence matrix and nominal alpha = 0.743', () => {
  const r = krippendorffAlpha(paperUnits, { metric: 'nominal' });
  assert.equal(r.alpha.toFixed(3), '0.743');
  assert.equal(r.values, 40);        // n: pairable values (the lone 3 in unit 12 is not one)
  assert.equal(r.units, 11);         // units with two values or more
  assert.equal(r.single, 1);         // unit 12
  const o = r.coincidences;
  // Page 4: o11 = 7, o12 = 4/3, o22 = 10, o33 = 8, o44 = 4, o55 = 3; margins 9, 13, 10, 5, 3.
  assert.equal(o.value('1', '1'), 7);
  assert.ok(Math.abs(o.value('1', '2') - 4 / 3) < 1e-12);
  assert.ok(Math.abs(o.value('2', '3') - 4 / 3) < 1e-12);
  assert.equal(o.value('5', '5'), 3);
  assert.deepEqual(['1', '2', '3', '4', '5'].map(c => Number(o.total(c).toFixed(9))), [9, 13, 10, 5, 3]);
});

test('Krippendorff 2011, section D: ordinal 0.815, interval 0.849, ratio 0.797 on the same data', () => {
  assert.equal(krippendorffAlpha(paperUnits, { metric: 'ordinal', order: [1, 2, 3, 4, 5] }).alpha.toFixed(3), '0.815');
  // An unused rank changes nothing (page 6 adds a sixth to show it).
  assert.equal(krippendorffAlpha(paperUnits, { metric: 'ordinal', order: [1, 2, 3, 4, 5, 6] }).alpha.toFixed(3), '0.815');
  assert.equal(krippendorffAlpha(paperUnits, { metric: 'interval' }).alpha.toFixed(3), '0.849');
  assert.equal(krippendorffAlpha(paperUnits, { metric: 'ratio' }).alpha.toFixed(3), '0.797');
});

test('set distances: Jaccard and MASI (Passonneau 2006), worked in EXPECTED.md', () => {
  assert.equal(jaccardDistance([], []), 0);
  assert.equal(jaccardDistance([], ['a']), 1);
  assert.equal(jaccardDistance(['a'], ['a', 'b']), 0.5);
  assert.ok(Math.abs(jaccardDistance(['a', 'b'], ['b', 'c']) - 2 / 3) < 1e-12);
  assert.equal(masiDistance([], []), 0);
  assert.equal(masiDistance(['a'], ['b']), 1);
  assert.ok(Math.abs(masiDistance(['a'], ['a', 'b']) - 2 / 3) < 1e-12);           // subset: M = 2/3
  assert.ok(Math.abs(masiDistance(['a', 'b'], ['b', 'c']) - 8 / 9) < 1e-12);      // overlap: M = 1/3
  assert.equal(masiDistance(['b', 'a'], ['a', 'b']), 0);
});

test('the reading: 0.800 and up reliable, 0.667 to 0.800 tentative, below unreliable, null not measurable', () => {
  assert.equal(reading(0.8), 'reliable');
  assert.equal(reading(0.7999), 'tentative');
  assert.equal(reading(0.667), 'tentative');
  assert.equal(reading(0.6669), 'unreliable');
  assert.equal(reading(null), 'not_measurable');
});

test('the reading is only suggested, not shown, when the likely range reaches below its own bar', () => {
  const text = renderAgree(agreeGrades({ gradePaths: [GA, GB, GC] }));
  // "invented or not": alpha 0.851, likely range down to 0.436
  assert.match(text, /0\.851 .*reliable: 0\.800 or above \(not shown: the likely range reaches below 0\.800\)/);
  // the grade: alpha 0.739, tentative, its range also below 0.667
  assert.match(text, /0\.739 .*tentative conclusions only: 0\.667 to 0\.800 \(not shown: the likely range reaches below 0\.667\)/);
  // a reading below 0.667 has no bar under it to fall short of
  assert.doesNotMatch(text, /do not rely on it: below 0\.667 \(not shown/);
});

// ---------- The fixture: three graders' answer keys (test/fixtures/agree/EXPECTED.md) ----------
const K = agreeKeys({ config: CONFIG, keyPaths: KEYS });
const out = name => K.outputs.find(o => o.name === name);

test('fixture: graders named after their files, every output compared, route included', () => {
  assert.deepEqual(K.graders.map(g => [g.name, g.records]), [['ann', 5], ['ben', 4], ['cai', 3]]);
  assert.deepEqual(K.outputs.map(o => [o.name, o.type, o.metric]), [
    ['verdict', 'label', 'nominal'], ['band', 'ordinal', 'ordinal'], ['codes', 'set', 'jaccard'], ['route', 'route', 'nominal']]);
});

test('fixture: verdict (label, nominal) alpha = 1/3, worked by hand', () => {
  const v = out('verdict');
  assert.equal(r3(v.alpha), 0.333);
  assert.equal(v.units, 4);
  assert.equal(v.values, 11);
  assert.deepEqual(v.graded_by_one, ['r5']);
  assert.equal(r3(v.observed), r3(4 / 11));
  assert.equal(r3(v.expected), r3(6 / 11));
  assert.equal(v.reading, 'unreliable');
  assert.deepEqual(v.pairs.map(p => [p.graders.join('-'), r3(p.alpha), p.units]), [['ann-ben', 0.533, 4], ['ann-cai', 0.444, 3], ['ben-cai', 0.444, 3]]);
  assert.deepEqual(v.disagreements.map(d => [d.id, d.values]), [
    ['r2', { ann: 'pass', ben: 'pass', cai: 'fail' }], ['r4', { ann: 'pass', ben: 'fail' }]]);
});

test('fixture: band (ordinal) alpha = 1 - 735/2156, using the config\'s level order', () => {
  const b = out('band');
  assert.equal(r3(b.alpha), r3(1 - 735 / 2156));
  assert.equal(r3(b.alpha), 0.659);
  assert.equal(b.reading, 'unreliable');
});

test('fixture: codes (set, Jaccard) alpha = 1 - 30/84; MASI given beside it, 1 - 100/262', () => {
  const c = out('codes');
  assert.equal(r3(c.alpha), r3(1 - 30 / 84));
  assert.equal(r3(c.masi_alpha), r3(1 - 100 / 262));
  // r3 is listed as c2, c3 by one grader and c3, c2 by another: the same set, no disagreement.
  assert.deepEqual(c.disagreements.map(d => d.id), ['r1', 'r4']);
});

test('fixture: route (the gold route, as its class) alpha = 0 despite 81.8% raw agreement: the prevalence paradox', () => {
  const r = out('route');
  assert.equal(r3(r.alpha), 0);
  assert.equal(r.raw_agreement.pct, 81.8);
  assert.equal(r.dominant.value, 'publish');   // the key's own name for the class auto
  assert.equal(r.dominant.pct, 90.9);
  assert.equal(r.prevalence_warning, true);
  assert.equal(out('verdict').prevalence_warning, false);
  // ann and ben both say auto on every record they share: not measurable, never 1 (M9).
  assert.deepEqual(r.pairs.map(p => [p.graders.join('-'), p.alpha === null ? null : r3(p.alpha)]), [['ann-ben', null], ['ann-cai', 0], ['ben-cai', 0]]);
});

test('fixture: likely range from a seeded bootstrap over records: deterministic, ordered, chances in 0-1', () => {
  const again = agreeKeys({ config: CONFIG, keyPaths: KEYS });
  for (const o of K.outputs) {
    assert.deepEqual(o.range, again.outputs.find(x => x.name === o.name).range);
    if (o.range.low === null) continue;
    assert.ok(o.range.low <= o.range.high);
    for (const t of ['0.800', '0.667']) assert.ok(o.range.below[t] >= 0 && o.range.below[t] <= 1);
  }
  const other = agreeKeys({ config: CONFIG, keyPaths: KEYS, seed: 7 });
  assert.notDeepEqual(other.outputs[0].range, K.outputs[0].range);
});

test('bootstrap: a reliable set of 60 records sits in a narrow range with a small chance below 0.800', () => {
  // 60 records, 3 graders agreeing on all but 2: alpha is high, and its range says so.
  const units = Array.from({ length: 60 }, (_, i) => { const v = i % 3 === 0 ? 'a' : 'b'; return [v, v, i < 2 ? 'c' : v]; });
  const a = krippendorffAlpha(units, { metric: 'nominal' });
  const b = bootstrapAlpha(units, { metric: 'nominal' }, { resamples: 2000, seed: 1 });
  assert.ok(a.alpha > 0.9);
  assert.ok(b.low > 0.8 && b.high <= 1);
  assert.ok(b.below['0.800'] < 0.05);
});

test('bootstrap: the fast resampling path gives the same alphas as recomputing in full (values and units branches)', () => {
  let s = 1;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const codes = Array.from({ length: 12 }, (_, i) => 'c' + i);
  // 60 records of sets: more distinct sets than records, so the pairs-of-units branch runs.
  const sets = Array.from({ length: 60 }, () => { const base = codes.filter(() => r() < 0.2); return [0, 1, 2].map(() => (r() < 0.1 ? null : base.filter(() => r() < 0.9))); });
  // The same records as 3 labels: fewer values than records, so the values branch runs.
  const labels = sets.map(u => u.map(v => (v === null ? null : String(v.length % 3))));
  for (const [units, metric] of [[sets, 'jaccard'], [sets, 'masi'], [labels, 'nominal'], [labels.map(u => u.map(v => (v === null ? null : Number(v) + 1))), 'interval']]) {
    const fast = bootstrapAlpha(units, { metric }, { resamples: 300, seed: 3 });
    const full = bootstrapAlpha(units, { metric }, { resamples: 300, seed: 3, full: true });
    assert.ok(Math.abs(fast.low - full.low) < 1e-12 && Math.abs(fast.high - full.high) < 1e-12, metric);
    for (const t of ['0.800', '0.667']) assert.ok(Math.abs(fast.below[t] - full.below[t]) < 1e-9, metric);
  }
});

// ---------- The three ranges compared in scripts/agree-coverage.js ----------
const { normalCdf, normalQuantile, acceleration, bcaLevels, bootstrapIntervals } = require('../src/metrics/agreement.js');

test('normal curve: the cumulative share and its inverse at known points', () => {
  assert.ok(Math.abs(normalQuantile(0.975) - 1.959964) < 1e-6);
  assert.ok(Math.abs(normalQuantile(0.025) + 1.959964) < 1e-6);
  assert.equal(normalQuantile(0.5), 0);
  assert.ok(Math.abs(normalCdf(1.959964) - 0.975) < 1e-6);
  assert.ok(Math.abs(normalCdf(-1) - 0.158655) < 1e-6);
  for (const p of [0.001, 0.05, 0.3, 0.7, 0.99]) assert.ok(Math.abs(normalCdf(normalQuantile(p)) - p) < 1e-6);
});

test('BCa: the jackknife acceleration worked by hand; constant jackknife gives 0', () => {
  // [1, 2, 3, 6]: mean 3, mean - each = 2, 1, 0, -3; sum of cubes -18; sum of squares 14.
  // a = -18 / (6 x 14^1.5) = -0.057271
  assert.ok(Math.abs(acceleration([1, 2, 3, 6]) - (-18 / (6 * 14 ** 1.5))) < 1e-12);
  assert.equal(acceleration([0.5, 0.5, 0.5]), 0);
  // No bias and no acceleration: the percentile levels exactly.
  const [lo, hi] = bcaLevels(0, 0);
  assert.ok(Math.abs(lo - 0.025) < 1e-6 && Math.abs(hi - 0.975) < 1e-6);
  // A positive bias moves both levels up.
  const [lo2, hi2] = bcaLevels(0.2, 0);
  assert.ok(lo2 > 0.025 && hi2 > 0.975);
});

test('bootstrapIntervals: the percentile range is bootstrapAlpha\'s own; BCa and the log range come from the same resamples', () => {
  const units = Array.from({ length: 30 }, (_, i) => { const v = i % 4 === 0 ? 'a' : 'b'; return [v, i % 7 === 0 ? 'a' : v, i < 3 ? null : v]; });
  const all = bootstrapIntervals(units, { metric: 'nominal' }, { resamples: 1000, seed: 5 });
  const one = bootstrapAlpha(units, { metric: 'nominal' }, { resamples: 1000, seed: 5, method: 'percentile' });
  assert.deepEqual([all.percentile.low, all.percentile.high], [one.low, one.high]);
  for (const k of ['bca', 'log_jackknife']) assert.ok(all[k].low < all[k].high, k);
  assert.ok(Number.isFinite(all.z0) && Number.isFinite(all.a));
});

test('the likely range is the BCa range (chosen by scripts/agree-coverage.js); falls back to percentile when every resample is on one side', () => {
  const units = Array.from({ length: 30 }, (_, i) => { const v = i % 4 === 0 ? 'a' : 'b'; return [v, i % 7 === 0 ? 'a' : v, i < 3 ? null : v]; });
  const all = bootstrapIntervals(units, { metric: 'nominal' }, { resamples: 1000, seed: 5 });
  const used = bootstrapAlpha(units, { metric: 'nominal' }, { resamples: 1000, seed: 5 });
  assert.equal(used.method, 'bca');
  assert.deepEqual([used.low, used.high], [all.bca.low, all.bca.high]);
  assert.equal(K.outputs[0].range.method, 'bca');
});

test('M16: a BCa range on fewer than 20 values that are not the most common value: the report says it is probably too narrow', () => {
  // 12 records, two graders; they differ on r1 and r2 only: 2 of 24 values are not pass.
  const rec = (id, verdict) => ({ id, verdict, band: 'low', codes: [], gold_route: 'publish' });
  const ids = Array.from({ length: 12 }, (_, i) => 'r' + (i + 1));
  const one = write('m16-a.json', ids.map(id => rec(id, 'pass')));
  const two = write('m16-b.json', ids.map(id => rec(id, id === 'r1' || id === 'r2' ? 'fail' : 'pass')));
  const k = agreeKeys({ config: CONFIG, keyPaths: [one, two], outputs: ['verdict'] });
  const v = k.outputs[0];
  assert.notEqual(v.range.low, null);
  // Two values per record: Krippendorff's bootstrap, which held the real alpha 95.7-98.1% of the
  // time with under 15 rare values (scripts/agree-flags.js): not flagged.
  assert.deepEqual([v.range.method, v.rare_values, v.range_too_narrow], ['krippendorff', 2, false]);
  assert.match(renderAgree(K), /likely range is probably too narrow/);
  // The fixture's verdict: 4 records, 5 values not pass. Flagged, though pass is only 54.5%:
  // what the range stands on is the rare values, whatever their share (scripts/agree-flags.js).
  assert.deepEqual([out('verdict').rare_values, out('verdict').range_too_narrow], [5, true]);
  // No range at all (M15): nothing to flag.
  assert.equal(out('route').range_too_narrow, false);
  // 45 grades from three reviewers (BCa), 15 not faithful: under 20, flagged.
  const g = agreeGrades({ gradePaths: [GA, GB, GC] }).outputs[0];
  assert.deepEqual([g.range.method, g.rare_values, g.range_too_narrow], ['bca', 15, true]);
});

// ---------- Free-text grades from three reviewers ----------
test('grades: three reviewers, faithful / invented / missing: alpha = 187/253; invented or not = 1 - 88/592', () => {
  const g = agreeGrades({ gradePaths: [GA, GB, GC] });
  assert.deepEqual(g.graders.map(x => x.name), ['Reviewer A', 'Reviewer B', 'Reviewer C']);
  const all = g.outputs.find(o => o.name === 'grade');
  const inv = g.outputs.find(o => o.name === 'invented or not');
  assert.equal(r3(all.alpha), r3(187 / 253));
  assert.equal(all.values, 45);
  assert.equal(r3(inv.alpha), r3(1 - 88 / 592));
  assert.deepEqual(all.pairs.map(p => r3(p.alpha)), [r3(1 - 116 / 450), r3(1 - 116 / 448), r3(1 - 116 / 450)]);
  assert.deepEqual(all.disagreements.map(d => d.id), ['V1 manage_now', 'V2 enjoyed', 'V3 reason']);
});

test('grades: two reviewers give alpha close to the kappa score --grades reports (0.742 against 0.735)', () => {
  const g = agreeGrades({ gradePaths: [GA, GB] });
  assert.equal(r3(g.outputs[0].alpha), 0.742);
});

// ---------- Traps (test/TRAPS.md, section M) ----------
test('M1: one grader only stops: agreement needs two or more', () => {
  throwsTrap(() => agreeKeys({ config: CONFIG, keyPaths: [KEYS[0]] }), 'M1');
  throwsTrap(() => agreeGrades({ gradePaths: [GA] }), 'M1');
});

test('M2: the same file given twice stops', () => {
  throwsTrap(() => agreeKeys({ config: CONFIG, keyPaths: [KEYS[0], KEYS[0]] }), 'M2');
  throwsTrap(() => agreeGrades({ gradePaths: [GA, GA] }), 'M2');
});

test('M3: two files with the same content warn: a perfect agreement that may be one file copied', () => {
  const copy = write('ann-copy.json', fs.readFileSync(KEYS[0], 'utf8'));
  const r = agreeKeys({ config: CONFIG, keyPaths: [KEYS[0], copy] });
  assert.ok(flagged(r).includes('warn:M3'));
});

test('M4: two graders with one name stop, unless --names tells them apart', () => {
  const other = path.join(tmp, 'sub');
  fs.mkdirSync(other, { recursive: true });
  const twin = path.join(other, 'ann.json');
  fs.writeFileSync(twin, fs.readFileSync(KEYS[1], 'utf8'));
  throwsTrap(() => agreeKeys({ config: CONFIG, keyPaths: [KEYS[0], twin] }), 'M4');
  const r = agreeKeys({ config: CONFIG, keyPaths: [KEYS[0], twin], names: ['ann', 'ann2'] });
  assert.deepEqual(r.graders.map(g => g.name), ['ann', 'ann2']);
  throwsTrap(() => agreeKeys({ config: CONFIG, keyPaths: KEYS, names: ['a', 'b'] }), 'M4');
});

test('M5: a record graded by one person only is left out of alpha and counted', () => {
  // r5 is in ann's key only (see the fixture tests): 4 records compared, r5 listed.
  for (const o of K.outputs) assert.deepEqual(o.graded_by_one, ['r5']);
  assert.match(renderAgree(K), /r5/);
});

test('M6: graders with different record sets warn, naming how many records each one lacks', () => {
  assert.ok(flagged(K).includes('warn:M6'));
  const w = K.problems.find(i => i.trap === 'M6');
  assert.match(w.message, /ben/);
  assert.match(w.message, /cai/);
});

test('M7: no record graded by two people stops: nothing to compare', () => {
  const only = write('only-r9.json', [{ id: 'r9', verdict: 'pass', band: 'low', codes: [], gold_route: 'publish' }]);
  throwsTrap(() => agreeKeys({ config: CONFIG, keyPaths: [KEYS[2], only] }), 'M7');
});

test('M8: a set value outside allowed_values is STRICT; an unknown label or ordinal level stops (F1)', () => {
  const bad = readJson(KEYS[1]);
  bad[0].codes = ['c9'];
  const f = write('bad-code.json', bad);
  throwsTrap(() => agreeKeys({ config: CONFIG, keyPaths: [KEYS[0], f] }), 'M8');
  const lenient = agreeKeys({ config: CONFIG, keyPaths: [KEYS[0], f], mode: 'lenient' });
  assert.ok(flagged(lenient).includes('warn:M8'));
  const level = readJson(KEYS[1]);
  level[0].band = 'very high';
  throwsTrap(() => agreeKeys({ config: CONFIG, keyPaths: [KEYS[0], write('bad-level.json', level)], mode: 'lenient' }), 'F1');
});

test('M9: every grader using one value: alpha is "not measurable", never 1 or 0', () => {
  const r = krippendorffAlpha([['a', 'a'], ['a', 'a', 'a']], { metric: 'nominal' });
  assert.equal(r.alpha, null);
  assert.equal(r.expected, 0);
  const one = readJson(KEYS[0]).map(x => ({ ...x, verdict: 'pass' }));
  const two = readJson(KEYS[1]).map(x => ({ ...x, verdict: 'pass' }));
  const k = agreeKeys({ config: CONFIG, keyPaths: [write('one.json', one), write('two.json', two)] });
  const v = k.outputs.find(o => o.name === 'verdict');
  assert.equal(v.alpha, null);
  assert.equal(v.reading, 'not_measurable');
  assert.equal(v.range.low, null);
  assert.match(renderAgree(k), /not measurable/);
});

test('M10: a set one grader left empty is a value ("nothing applies"): wholly apart from any non-empty set', () => {
  const r = krippendorffAlpha([[[], ['a']], [['a'], ['a']], [[], []]], { metric: 'jaccard' });
  // Coincidences: {}-{a} once each way, {a}-{a} 2, {}-{} 2; n = 6, n_{} = 3, n_{a} = 3.
  // D_o = 2/6; D_e = 2 x 3 x 3 / 30 = 0.6; alpha = 1 - (1/3)/0.6 = 4/9.
  assert.equal(r3(r.alpha), r3(4 / 9));
  // A set left out of one record (not written as []) is not known to be empty: it stops (D2).
  const noCodes = readJson(KEYS[1]);
  delete noCodes[0].codes;
  throwsTrap(() => agreeKeys({ config: CONFIG, keyPaths: [KEYS[0], write('ben-no-codes.json', noCodes)] }), 'D2');
});

test('M11: key files covering different outputs stop, naming them; --output compares the shared ones', () => {
  const noBand = readJson(KEYS[1]).map(({ band, ...x }) => x);
  const f = write('ben.json', noBand);
  assert.throws(() => agreeKeys({ config: CONFIG, keyPaths: [KEYS[0], f] }), e => e.message.includes('[M11]') && e.message.includes('band'));
  const r = agreeKeys({ config: CONFIG, keyPaths: [KEYS[0], f], outputs: ['verdict', 'codes', 'route'] });
  assert.deepEqual(r.outputs.map(o => o.name), ['verdict', 'codes', 'route']);
  const noRoute = readJson(KEYS[1]).map(({ gold_route, ...x }) => x);
  throwsTrap(() => agreeKeys({ config: CONFIG, keyPaths: [KEYS[0], write('ben-no-route.json', noRoute)] }), 'M11');
  throwsTrap(() => agreeKeys({ config: CONFIG, keyPaths: KEYS, outputs: ['nope'] }), 'M11');
});

test('M12: grades files for different forms (fingerprints differ) stop', () => {
  const other = readJson(GC);
  other.fingerprint = 'sha256:' + '0'.repeat(64);
  throwsTrap(() => agreeGrades({ gradePaths: [GA, write('other-forms.json', other)] }), 'M12');
});

test('M13: any_of slots compare as whole slots; equivalents are read as their group\'s first value', () => {
  const cfg = loadConfig(path.join(dir, 'config.json'));
  cfg.equivalents = { codes: [['c1', 'c1-old']] };
  const a = write('slots-a.json', [{ id: 'x', verdict: 'pass', band: 'low', codes: [{ any_of: ['c1', 'c2'] }], gold_route: 'publish' },
    { id: 'y', verdict: 'fail', band: 'high', codes: ['c1'], gold_route: 'review' }]);
  const b = write('slots-b.json', [{ id: 'x', verdict: 'pass', band: 'low', codes: [{ any_of: ['c2', 'c1'] }], gold_route: 'publish' },
    { id: 'y', verdict: 'fail', band: 'high', codes: ['c1-old'], gold_route: 'review' }]);
  const r = agreeKeys({ config: cfg, keyPaths: [a, b] });
  assert.deepEqual(r.outputs.find(o => o.name === 'codes').disagreements, []);
  const c = write('slots-c.json', [{ id: 'x', verdict: 'pass', band: 'low', codes: ['c1'], gold_route: 'publish' },
    { id: 'y', verdict: 'fail', band: 'high', codes: ['c1'], gold_route: 'review' }]);
  const r2 = agreeKeys({ config: cfg, keyPaths: [a, c] });
  assert.deepEqual(r2.outputs.find(o => o.name === 'codes').disagreements.map(d => d.id), ['x']);
});

test('M14: the prevalence paradox is said plainly, with both numbers', () => {
  const text = renderAgree(K);
  assert.match(text, /81\.8%/);
  assert.match(text, /one value/i);
});

test('M15: alpha 1, or every value but one the same: no likely range, as Krippendorff\'s bootstrap note says', () => {
  const perfect = [['a', 'a', 'a'], ['b', 'b'], ['a', 'a', 'a'], ['c', 'c', 'c']];
  assert.equal(krippendorffAlpha(perfect, { metric: 'nominal' }).alpha, 1);
  const b = bootstrapAlpha(perfect, { metric: 'nominal' });
  assert.deepEqual([b.low, b.high, b.below['0.800'], b.why], [null, null, null, 'no_disagreement']);
  // The fixture's route: auto everywhere but Cai's one review.
  const route = K.outputs.find(o => o.name === 'route');
  assert.deepEqual([route.range.low, route.range.why], [null, 'one_odd_value']);
  const text = renderAgree(K);
  assert.match(text, /no likely range: every value but one/);
  // With two disagreements, there is a range again.
  assert.notEqual(bootstrapAlpha([['a', 'b'], ['a', 'b'], ['a', 'a'], ['a', 'a']], { metric: 'nominal' }).low, null);
});

test('B3 in agree: the same id twice in one grader\'s key stops', () => {
  const twice = readJson(KEYS[1]);
  twice.push(twice[0]);
  throwsTrap(() => agreeKeys({ config: CONFIG, keyPaths: [KEYS[0], write('twice.json', twice)] }), 'B3');
});

// ---------- Fixes from the independent review ----------
const { bcaShare } = require('../src/metrics/agreement.js');
const keyRec = (id, o = {}) => ({ id, verdict: 'pass', band: 'low', codes: [], gold_route: 'publish', ...o });

test('review 2: an output named "route" beside the routing gold field stops (M11): the two would be one name', () => {
  const cfg = loadConfig(path.join(dir, 'config.json'));
  cfg.outputs = { ...cfg.outputs, route: { ...cfg.outputs.verdict, field: 'route_label', key_field: 'route_label' } };
  const a = write('rt-a.json', [keyRec('x', { route_label: 'pass' }), keyRec('y', { route_label: 'fail' })]);
  const b = write('rt-b.json', [keyRec('x', { route_label: 'pass' }), keyRec('y', { route_label: 'pass' })]);
  assert.throws(() => agreeKeys({ config: cfg, keyPaths: [a, b] }), e => e.message.includes('[M11]') && e.message.includes('route'));
});

test('review 3 and 8: a slot of one is its value; a value starting with "{" is a value', () => {
  const cfg = loadConfig(path.join(dir, 'config.json'));
  cfg.allowed_values = {};
  cfg.equivalents = { codes: [['c1', 'c2']] };
  const a = write('one-a.json', [keyRec('x', { codes: [{ any_of: ['c1'] }] }), keyRec('y', { codes: [{ any_of: ['c1', 'c2'] }] }), keyRec('z', { codes: ['{odd'] })]);
  const b = write('one-b.json', [keyRec('x', { codes: ['c1'] }), keyRec('y', { codes: ['c1'] }), keyRec('z', { codes: ['{odd'] })]);
  const r = agreeKeys({ config: cfg, keyPaths: [a, b], outputs: ['codes'] });
  assert.deepEqual(r.outputs[0].disagreements, []);
});

test('review 9: the gold route is read as score reads it: no "toString", no numbers, trimmed spaces counted (C3)', () => {
  const a = write('gr-a.json', [keyRec('x'), keyRec('y', { gold_route: 'review' })]);
  throwsTrap(() => agreeKeys({ config: CONFIG, keyPaths: [a, write('gr-b.json', [keyRec('x', { gold_route: 'toString' }), keyRec('y', { gold_route: 'review' })])] }), 'C5');
  throwsTrap(() => agreeKeys({ config: CONFIG, keyPaths: [a, write('gr-c.json', [keyRec('x', { gold_route: 5 }), keyRec('y', { gold_route: 'review' })])] }), 'C5');
  const r = agreeKeys({ config: CONFIG, keyPaths: [a, write('gr-d.json', [keyRec('x', { gold_route: ' publish' }), keyRec('y', { gold_route: 'review' })])] });
  assert.ok(flagged(r).includes('fix:C3'));
});

test('review 4: no range when every resample gives the same alpha, or one record is compared', () => {
  const same = bootstrapAlpha([['a', 'b'], ['a', 'b'], ['a', 'b']], { metric: 'nominal' });
  assert.deepEqual([same.low, same.why], [null, 'no_spread']);
  const one = bootstrapAlpha([['a', 'b', 'c', 'a'], ['d', null]], { metric: 'nominal' });
  assert.deepEqual([one.low, one.why], [null, 'one_record']);
});

test('review 5: the chance alpha is below a threshold is read through the BCa mapping', () => {
  assert.ok(Math.abs(bcaShare(0.3, 0, 0) - 0.3) < 1e-6); // the normal curve approximations are good to about 1e-7
  // G = 0.5, z0 = 0.1, a = 0: u = 0 - 0.1; q = Phi(-0.1 - 0.1) = Phi(-0.2) = 0.420740
  assert.ok(Math.abs(bcaShare(0.5, 0.1, 0) - 0.420740) < 1e-6);
  const units = Array.from({ length: 30 }, (_, i) => { const v = i % 4 === 0 ? 'a' : 'b'; return [v, i % 7 === 0 ? 'a' : v, i < 3 ? null : v]; });
  const all = bootstrapIntervals(units, { metric: 'nominal' }, { resamples: 1000, seed: 5 });
  const used = bootstrapAlpha(units, { metric: 'nominal' }, { resamples: 1000, seed: 5 });
  const G = all.alphas.filter(x => x < 0.8).length / all.alphas.length;
  assert.ok(Math.abs(used.below['0.800'] - bcaShare(G, all.z0, all.a)) < 1e-12);
});

test('review 7: the prevalence note only when alpha is not reliable, and it gives the chance agreement', () => {
  const ids = Array.from({ length: 40 }, (_, i) => 'r' + i);
  const a = write('pv-a.json', ids.map((id, i) => keyRec(id, { verdict: i < 5 ? 'fail' : 'pass' })));
  const b = write('pv-b.json', ids.map((id, i) => keyRec(id, { verdict: i < 5 ? 'fail' : 'pass' })));
  const c = write('pv-c.json', ids.map((id, i) => keyRec(id, { verdict: i < 4 ? 'fail' : 'pass' })));
  const k = agreeKeys({ config: CONFIG, keyPaths: [a, b, c], outputs: ['verdict'] });
  assert.ok(k.outputs[0].alpha >= 0.8 && k.outputs[0].dominant.share >= 0.8);
  assert.equal(k.outputs[0].prevalence_warning, false);
  assert.match(renderAgree(out('route') ? K : K), /chance alone would agree/);
});

test('review 6: the jackknife in closed form equals leaving each record out (values and units branches)', () => {
  let s = 7;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const codes = Array.from({ length: 12 }, (_, i) => 'c' + i);
  const sets = Array.from({ length: 40 }, () => { const base = codes.filter(() => r() < 0.2); return [0, 1, 2].map(() => (r() < 0.1 ? null : base.filter(() => r() < 0.9))); });
  const labels = sets.map(u => u.map(v => (v === null ? null : String(v.length % 3))));
  for (const [units, metric] of [[sets, 'jaccard'], [labels, 'nominal']]) {
    const fast = bootstrapIntervals(units, { metric }, { resamples: 200, seed: 2 });
    const full = bootstrapIntervals(units, { metric }, { resamples: 200, seed: 2, full: true });
    assert.ok(Math.abs(fast.a - full.a) < 1e-9, metric);
  }
});

test('review: a CSV key whose set column is blank in every record warns (M17): probably not labelled', () => {
  const cfg = loadConfig(path.join(dir, 'config.json'));
  const a = write('blank-a.csv', 'id,verdict,band,codes,gold_route\nr1,pass,low,c1,publish\nr2,fail,high,,review\n');
  const b = write('blank-b.csv', 'id,verdict,band,codes,gold_route\nr1,pass,low,,publish\nr2,fail,high,,review\n');
  const k = agreeKeys({ config: cfg, keyPaths: [a, b] });
  assert.ok(flagged(k).includes('warn:M17'));
});

test('review: --names with an empty name stops (M4)', () => {
  throwsTrap(() => agreeKeys({ config: CONFIG, keyPaths: KEYS, names: ['a', '', 'c'] }), 'M4');
});

test('review: with exactly two graders the likely range is Krippendorff\'s bootstrap (better there in scripts/agree-coverage.js)', () => {
  // 2 graders, 20 records. Krippendorff (2016 note): each record draws one pair uniformly from all
  // the pairs, D_e kept from the data: alpha* = 1 - sum of the drawn deltas / (records x D_e).
  const units = Array.from({ length: 20 }, (_, i) => [i % 5 === 0 ? 'a' : 'b', i % 7 === 0 ? 'a' : (i % 5 === 0 ? 'a' : 'b')]);
  const point = krippendorffAlpha(units, { metric: 'nominal' });
  const r = bootstrapAlpha(units, { metric: 'nominal' }, { resamples: 500, seed: 9 });
  assert.equal(r.method, 'krippendorff');
  // The same draws by hand, with the same seeded generator (mulberry32, seed 9).
  let t = 9 >>> 0;
  const rand = () => { t = (t + 0x6D2B79F5) >>> 0; let x = Math.imul(t ^ (t >>> 15), 1 | t); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const d = units.map(([x, y]) => (x === y ? 0 : 1));
  const alphas = [];
  for (let k = 0; k < 500; k++) { let sum = 0; for (let u = 0; u < 20; u++) sum += d[Math.floor(rand() * 20)]; alphas.push(1 - sum / (20 * point.expected)); }
  alphas.sort((x, y) => x - y);
  const q = p => { const h = (alphas.length - 1) * p, lo = Math.floor(h); return alphas[lo] + (h - lo) * (alphas[lo + 1] - alphas[lo]); };
  assert.ok(Math.abs(r.low - q(0.025)) < 1e-12 && Math.abs(r.high - q(0.975)) < 1e-12);
  assert.ok(Math.abs(r.below['0.800'] - alphas.filter(x => x < 0.8).length / 500) < 1e-12);
  // Three graders: BCa, as before.
  assert.equal(K.outputs[0].range.method, 'bca');
  assert.equal(agreeGrades({ gradePaths: [GA, GB] }).outputs[0].range.method, 'krippendorff');
});

test('review 4: the report says why there is no range for look-alike records and for one record', () => {
  const ids = ['x', 'y', 'z'];
  const a = write('ns-a.json', ids.map(id => keyRec(id, { verdict: 'pass' })));
  const b = write('ns-b.json', ids.map(id => keyRec(id, { verdict: 'fail' })));
  const k = agreeKeys({ config: CONFIG, keyPaths: [a, b], outputs: ['verdict'] });
  assert.equal(k.outputs[0].range.why, 'no_spread');
  const text = renderAgree(k);
  assert.match(text, /no likely range: every record compared looks alike/);
  assert.doesNotMatch(text, /undefined/);
});

// ---------- Readability (newcomer test) ----------
test('readable: disagreement is shown as a share of what chance alone would give; raw values stay in --json', () => {
  const text = renderAgree(K);
  // verdict: D_o / D_e = (4/11) / (6/11) = 66.7%
  assert.match(text, /disagreement  66.7% of what chance alone would give/);
  assert.doesNotMatch(text, /disagreement observed/);
  assert.equal(r3(out('verdict').observed), r3(4 / 11));
});

test('readable: the route shows the key\'s own names, with the class when names share one', () => {
  assert.deepEqual(out('route').disagreements[0].values, { ann: 'publish', ben: 'publish', cai: 'review' });
  assert.equal(out('route').dominant.value, 'publish');
  const cfg = loadConfig(path.join(dir, 'config.json'));
  cfg.routing.map = { ...cfg.routing.map, auto_publish: 'auto' };
  const a = write('rn-a.json', [keyRec('x', { gold_route: 'auto_publish' }), keyRec('y', { gold_route: 'review' })]);
  const b = write('rn-b.json', [keyRec('x', { gold_route: 'publish' }), keyRec('y', { gold_route: 'publish' })]);
  const k = agreeKeys({ config: cfg, keyPaths: [a, b], outputs: ['route'] });
  // x: auto_publish and publish are both auto, so they agree; y differs.
  assert.deepEqual(k.outputs[0].disagreements.map(d => d.values), [{ 'rn-a': 'review', 'rn-b': 'publish (auto)' }]);
});

test('readable: alpha without each grader names the odd one out (3 or more graders)', () => {
  // verdict: without ann = ben-cai 0.444, without ben = ann-cai 0.444, without cai = ann-ben 0.533.
  const v = out('verdict');
  assert.deepEqual(v.without.map(w => [w.grader, r3(w.alpha)]), [['ann', 0.444], ['ben', 0.444], ['cai', 0.533]]);
  assert.equal(v.odd_one, 'cai');
  assert.match(renderAgree(K), /without cai: 0.533/);
  assert.match(renderAgree(K), /who differs, not who is wrong/);
  assert.equal(agreeGrades({ gradePaths: [GA, GB] }).outputs[0].without, null);
});

test('M4: the same reviewer name in two grades files stops', () => {
  const twin = readJson(GB);
  twin.reviewer = 'Reviewer A';
  throwsTrap(() => agreeGrades({ gradePaths: [GA, write('twin-reviewer.json', twin)] }), 'M4');
});

test('M15: Krippendorff\'s resamples all equal: no range (no_spread), never a zero-width range', () => {
  // Two graders who disagree on every record, the same way each time: every pair drawn is a
  // disagreement, so every one of Krippendorff's resamples is the same alpha.
  const ann = ['billing', 'refund', 'billing', 'shipping', 'refund', 'shipping'];
  const ben = ['refund', 'billing', 'shipping', 'refund', 'shipping', 'billing'];
  const r = bootstrapAlpha(ann.map((v, i) => [v, ben[i]]), { metric: 'nominal' });
  assert.deepEqual([r.low, r.high, r.below['0.800'], r.why], [null, null, null, 'no_spread']);
});

test('the switch to Krippendorff\'s bootstrap is for names (nominal) only; ordinal and sets keep BCa (scripts/agree-two-graders.js)', () => {
  const nominal = Array.from({ length: 20 }, (_, i) => [i % 3 === 0 ? 'a' : 'b', i % 4 === 0 ? 'a' : 'b']);
  assert.equal(bootstrapAlpha(nominal, { metric: 'nominal' }).method, 'krippendorff');
  const ordinal = nominal.map(([x, y]) => [x === 'a' ? 'low' : 'high', y === 'a' ? 'low' : 'medium']);
  assert.equal(bootstrapAlpha(ordinal, { metric: 'ordinal', order: ['low', 'medium', 'high'] }).method, 'bca');
  const sets = nominal.map(([x, y]) => [[x], y === 'a' ? ['a'] : ['a', 'b']]);
  assert.equal(bootstrapAlpha(sets, { metric: 'jaccard' }).method, 'bca');
  // The fixture's two-grader band (ordinal) comes out BCa.
  const k = agreeKeys({ config: CONFIG, keyPaths: [KEYS[0], KEYS[1]], outputs: ['band'] });
  assert.equal(k.outputs[0].range.method, 'bca');
});

test('the resample line says what was resampled: records (BCa) or pairs (Krippendorff)', () => {
  assert.match(renderAgree(K), /resamples of the records/);
  const rec = (id, verdict) => ({ id, verdict, band: 'low', codes: [], gold_route: 'publish' });
  const ids = Array.from({ length: 12 }, (_, i) => 'r' + (i + 1));
  const one = write('rs-a.json', ids.map((id, i) => rec(id, i % 3 ? 'pass' : 'fail')));
  const two = write('rs-b.json', ids.map((id, i) => rec(id, i % 4 ? 'pass' : 'fail')));
  const k = agreeKeys({ config: CONFIG, keyPaths: [one, two], outputs: ['verdict'] });
  assert.equal(k.outputs[0].range.method, 'krippendorff');
  const text = renderAgree(k);
  assert.match(text, /resamples of the pairs \(Krippendorff's method\)/);
  assert.doesNotMatch(text, /resamples of the records/);
});

test('--write-key: a majority answer key; ties and records labelled by one grader are left out and listed', () => {
  const { majorityKeyText } = require('../src/agree.js');
  const k = agreeKeys({ config: CONFIG, keyPaths: KEYS, majority: true });
  // r1-r3: every output has a majority (EXPECTED.md tables). r4: ann and ben differ on verdict,
  // band and codes (a tie of one each). r5: ann only.
  assert.deepEqual(k.majority.written.map(r => r.id), ['r1', 'r2', 'r3']);
  assert.deepEqual(k.majority.left_out.map(r => r.id), ['r4', 'r5']);
  assert.match(k.majority.left_out[0].why, /verdict/);
  assert.match(k.majority.left_out[1].why, /one grader/);
  const file = write('majority.json', majorityKeyText(CONFIG, k.majority));
  const { loadKey } = require('../src/load.js');
  const key = loadKey({ config: CONFIG, keyPath: file });
  assert.deepEqual(key.map(r => [r.id, r.outputs.verdict, r.outputs.band, r.outputs.codes, r.gold_route]), [
    ['r1', 'pass', 'high', ['c1'], 'publish'],
    ['r2', 'pass', 'low', [], 'publish'],
    ['r3', 'fail', 'high', ['c2', 'c3'], 'publish'],
  ]);
  const cli = run(['agree', '--config', path.join(dir, 'config.json'), '--keys', ...KEYS, '--write-key', path.join(tmp, 'cli-key.json')]);
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(readJson(path.join(tmp, 'cli-key.json')).length, 3);
  assert.match(cli.stderr, /2 record\(s\) left out/);
});

test('--write-key carries the trap, group, cluster and duplicate fields by the same majority; a split field is left out and listed', () => {
  const { majorityKeyText } = require('../src/agree.js');
  const { loadKey } = require('../src/load.js');
  const cfg = loadConfig(path.join(dir, 'config.json'));
  cfg.trap_field = 'trap';
  cfg.groups = { channel: { field: 'meta.channel', from: 'key' } };
  const rec = (id, o = {}) => ({ id, verdict: 'pass', band: 'low', codes: ['c1'], gold_route: 'publish', trap: 'T-' + id, meta: { channel: id === 'x' ? 'email' : 'chat' }, ...o });
  const a = write('mf-a.json', [rec('x'), rec('y'), rec('z')]);
  const b = write('mf-b.json', [rec('x'), rec('y'), rec('z', { trap: 'other' })]);
  const c = write('mf-c.json', [rec('x'), rec('y'), rec('z', { trap: 'third' })]);
  const k = agreeKeys({ config: cfg, keyPaths: [a, b, c], majority: true });
  const written = write('mf-key.json', majorityKeyText(cfg, k.majority));
  const mine = loadKey({ config: cfg, keyPath: written });
  const theirs = loadKey({ config: cfg, keyPath: a });
  // Where all agree (x, y), what scoring reads per trap and per group is the grader's own.
  for (const id of ['x', 'y']) {
    const m = mine.find(r => r.id === id), t = theirs.find(r => r.id === id);
    assert.deepEqual([m.traps, m.groups], [t.traps, t.groups]);
  }
  // z: three different traps: written without one, and listed.
  const z = mine.find(r => r.id === 'z');
  assert.deepEqual([z.traps, z.groups], [[], { channel: ['chat'] }]);
  assert.deepEqual(k.majority.fields_left_out, [{ id: 'z', field: 'trap', values: ['T-z', 'other', 'third'] }]);
  // Two graders, split: no third value to fall back on, and the same.
  const two = agreeKeys({ config: cfg, keyPaths: [a, b], majority: true });
  assert.deepEqual(two.majority.fields_left_out, [{ id: 'z', field: 'trap', values: ['T-z', 'other'] }]);
});

test('--write-key: a set takes each value most graders listed (more than half); exactly half is a tie', () => {
  const cfg = loadConfig(path.join(dir, 'config.json'));
  cfg.allowed_values = {};
  const rec = (id, codes) => ({ id, verdict: 'pass', band: 'low', codes, gold_route: 'publish' });
  // A016's shape: each value listed by 2 of 3 graders, so all three are in.
  const a = write('sv-a.json', [rec('x', ['p', 'l', 'c']), rec('y', ['a'])]);
  const b = write('sv-b.json', [rec('x', ['l', 'c']), rec('y', ['b'])]);
  const c = write('sv-c.json', [rec('x', ['p']), rec('y', ['a', 'b'])]);
  const k = agreeKeys({ config: cfg, keyPaths: [a, b, c], majority: true });
  assert.deepEqual(k.majority.written.find(r => r.id === 'x').values.codes.slice().sort(), ['c', 'l', 'p']);
  assert.deepEqual(k.majority.written.find(r => r.id === 'y').values.codes.slice().sort(), ['a', 'b']);
  // Two graders, one value each: each is listed by exactly half: a tie, left out.
  const d = write('sv-d.json', [rec('x', ['p'])]);
  const e = write('sv-e.json', [rec('x', ['q'])]);
  const k2 = agreeKeys({ config: cfg, keyPaths: [d, e], majority: true, outputs: ['codes'] });
  assert.deepEqual(k2.majority.left_out.map(r => r.id), ['x']);
});

test('--write-key: when records are left out, the command says score will stop on them (B4)', () => {
  const cli = run(['agree', '--config', path.join(dir, 'config.json'), '--keys', ...KEYS, '--write-key', path.join(tmp, 'b4-key.json')]);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stderr, /2 records were left out: settle them and add them to the key, or score only the other records; score stops on a record with no answer \(trap B4\)/);
});

test('--write-key: JSON Lines when the key is read as JSON Lines; CSV refused; --output refused', () => {
  const { majorityKeyText } = require('../src/agree.js');
  const k = agreeKeys({ config: CONFIG, keyPaths: KEYS, majority: true });
  const lines = majorityKeyText(CONFIG, k.majority, 'maj.jsonl').trim().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(JSON.parse(lines[0]).id, 'r1');
  assert.throws(() => majorityKeyText(CONFIG, k.majority, 'maj.csv'), /CSV/);
  const cli = run(['agree', '--config', path.join(dir, 'config.json'), '--keys', ...KEYS, '--output', 'verdict', '--write-key', path.join(tmp, 'partial.json')]);
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /--write-key writes a whole key/);
});

test('--write-key: an empty or made-up majority set, and a duplicate pointing at a record left out, are left out and listed', () => {
  const cfg = loadConfig(path.join(dir, 'config.json'));
  cfg.allowed_values = {};
  cfg.duplicate_of_field = 'dup_of';
  const rec = (id, o = {}) => ({ id, verdict: 'pass', band: 'low', codes: [], gold_route: 'publish', ...o });
  const a = write('ed-a.json', [rec('c', { codes: ['x'] }), rec('d', { codes: ['x', 'y'] }), rec('m', { verdict: 'pass' }), rec('n', { dup_of: 'm' })]);
  const b = write('ed-b.json', [rec('c', { codes: ['y'] }), rec('d', { codes: ['y', 'z'] }), rec('m', { verdict: 'fail' }), rec('n', { dup_of: 'm' })]);
  const c = write('ed-c.json', [rec('c', { codes: [{ any_of: ['x', 'y'] }] }), rec('d', { codes: ['x', 'z'] })]);
  const k = agreeKeys({ config: cfg, keyPaths: [a, b, c], majority: true });
  // c: every value listed by one of three: the majority set would be [] though everyone said something.
  // d: x, y and z each 2 of 3: {x, y, z}, which no grader gave. m: a tie. n: a duplicate of m.
  assert.deepEqual(k.majority.left_out.map(r => r.id).sort(), ['c', 'd', 'm', 'n']);
  assert.match(k.majority.left_out.find(r => r.id === 'n').why, /m/);
});

// ---------- The command ----------
const BIN = path.join(__dirname, '..', 'bin', 'wfeval.js');
const run = args => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });

test('wfeval agree --keys: report and --json', () => {
  const json = path.join(tmp, 'agree.json');
  const r = run(['agree', '--config', path.join(dir, 'config.json'), '--keys', ...KEYS, '--json', json]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Krippendorff/);
  assert.match(r.stdout, /verdict/i);
  const j = readJson(json);
  assert.equal(j.kind, 'agree');
  assert.equal(r3(j.outputs[0].alpha), 0.333);
});

test('wfeval agree --grades: three reviewers', () => {
  const r = run(['agree', '--grades', GA, GB, GC]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /invented or not/i);
});

test('wfeval agree: bad command lines', () => {
  assert.equal(run(['agree', '--keys', ...KEYS]).status, 1);                       // no --config
  assert.equal(run(['agree', '--config', 'x', '--keys', KEYS[0], '--grades', GA]).status, 1);
  assert.equal(run(['agree']).status, 1);
  assert.equal(run(['agree', '--grades', GA, GB, '--seed=']).status, 2);   // P19: an empty value is a bad command
  const help = run(['--help']).stdout.split('\n');
  const at = help.findIndex(l => l.startsWith('  agree     --grades'));
  assert.ok(help[at + 1].includes('[--resamples <n>] [--seed <n>]'));
  const one = run(['agree', '--config', path.join(dir, 'config.json'), '--keys', KEYS[0]]);
  assert.equal(one.status, 1);
  assert.match(one.stderr, /M1/);
});
