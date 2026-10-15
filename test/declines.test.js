// Declining to answer as its own outcome, checked against test/fixtures/declines/EXPECTED.md.
// Tests on reading are named after their trap in test/TRAPS.md (F5-F10).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, validateConfig, DECLINED } = require('../src/config.js');
const { problems } = require('../src/problems.js');
const { normalizePredictions, normalizeKey } = require('../src/load.js');
const { align } = require('../src/align.js');
const { scoreRun, scoreRecords, compareRun } = require('../src/score.js');
const { renderTerminal } = require('../src/report/terminal.js');
const { renderHtml } = require('../src/report/html.js');

const dir = path.join(__dirname, 'fixtures', 'declines');
const RAW_CONFIG = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
const PREDS = JSON.parse(fs.readFileSync(path.join(dir, 'predictions.json'), 'utf8'));
const KEY = JSON.parse(fs.readFileSync(path.join(dir, 'key.json'), 'utf8'));
const args = { predPath: path.join(dir, 'predictions.json'), keyPath: path.join(dir, 'key.json') };
const R = scoreRun({ config: loadConfig(path.join(dir, 'config.json')), ...args });
const nd = r => [r.n, r.d, r.pct, r.low_pct, r.high_pct];

// Score records given in memory, with a changed config or changed records.
function scoreRaw(rawConfig, preds, keys) {
  const { config, errors } = validateConfig(rawConfig);
  assert.deepEqual(errors, []);
  const p = problems('strict');
  const records = align(normalizePredictions(preds, config, 'preds', p), normalizeKey(keys, config, 'key', p), config, p);
  p.throwIfStopped();
  return scoreRecords(records, config);
}

// ---------- The fixture ----------

test('declines: coverage, accuracy when answered, and the decline rates', () => {
  const c = R.quality.outputs.category;
  assert.deepEqual(nd(c.accuracy), [4, 6, 66.7, 30, 90.3]);   // on what was answered
  const d = c.declines;
  assert.deepEqual(nd(d.coverage), [6, 10, 60, 31.3, 83.2]);
  assert.deepEqual(nd(d.declined), [4, 10, 40, 16.8, 68.7]);
  assert.deepEqual(nd(d.unnecessary.rate), [2, 4, 50, 15, 85]);
  assert.deepEqual(d.unnecessary.ids, ['L5', 'L8']);
  assert.deepEqual(nd(d.should_have_declined.rate), [1, 6, 16.7, 3, 56.4]);
  assert.deepEqual(d.should_have_declined.ids, ['L6']);
  assert.deepEqual(d.correct_declines, ['L4', 'L9']);
  assert.equal(d.key_declines, 3);
});

test('declines: the confusion matrix has a declined column and row; precision and recall per category', () => {
  const c = R.quality.outputs.category;
  assert.deepEqual(c.confusion.news, { case_results: 0, attorneys: 0, awards: 0, news: 0, [DECLINED]: 2 });
  assert.deepEqual(c.confusion[DECLINED], { case_results: 0, attorneys: 0, awards: 1, news: 0, [DECLINED]: 2 });
  const row = l => [c.per_label[l].tp, c.per_label[l].fp, c.per_label[l].fn, c.per_label[l].f1];
  assert.deepEqual(row('case_results'), [2, 0, 0, 1]);
  assert.deepEqual(row('awards'), [0, 1, 1, 0]);   // FP from L6 (the key says decline), FN from L3
  assert.deepEqual(row('news'), [0, 1, 2, 0]);     // a decline is a miss for recall, never a false positive
  assert.equal(c.per_label[DECLINED], undefined);
});

test('declines: a wrong category and an answer that should have been a decline are high-severity silent errors', () => {
  const s = R.routing.silent_errors;
  assert.deepEqual(nd(s.rate), [2, 6, 33.3, 9.7, 70]);
  assert.deepEqual(s.records.map(x => [x.id, x.severity, x.types]), [
    ['L3', 'high', ['SP-WRONG']],
    ['L6', 'high', ['SP-SHOULD-DECLINE']],
  ]);
  assert.deepEqual(s.records[1].differences.should_decline, { category: ['awards'] });
  assert.deepEqual(nd(R.routing.straight_through), [6, 10, 60, 31.3, 83.2]);
});

test('declines: an unnecessary decline left out is a medium silent omission, found without a correct route', () => {
  const o = R.routing.silent_omissions;
  assert.equal(o.basis, 'declines');
  assert.deepEqual(nd(o.rate), [2, 7, 28.6, 8.2, 64.1]);
  assert.deepEqual(o.records.map(x => [x.id, x.severity, x.types]), [['L5', 'medium', ['SO-DECLINED']], ['L8', 'medium', ['SO-DECLINED']]]);
  assert.deepEqual(o.records[0].declined, { category: ['news (set aside: news)'] });
  assert.deepEqual(o.records[1].declined, { category: ['news'] });
  assert.equal(R.routing.block, null);
  assert.match(R.routing.not_measured[0].what, /silent omissions other than SO-DECLINED/);
});

test('declines: calibration leaves declines out', () => {
  const c = R.calibration;
  assert.equal(c.left_out.declined, 4);
  assert.deepEqual(c.overall.buckets.map(b => [b.from, b.n, b.correct]), [[0.6, 1, 0], [0.7, 1, 0], [0.9, 4, 4]]);
  assert.equal(c.overall.ece, 0.283);
});

test('declines: variance and compare follow coverage and both kinds of decline mistake', () => {
  const config = loadConfig(path.join(dir, 'config.json'));
  const names = compareRun({ config, keyPath: args.keyPath, beforePath: args.predPath, afterPath: args.predPath }).metrics.map(m => m.name);
  for (const n of ['category accuracy when answered', 'category coverage', 'category unnecessary declines', 'category answers that should have been declines']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('category accuracy'));
});

test('declines: the reports say what each decline number counts', () => {
  const text = renderTerminal(R);
  assert.match(text, /Silent omissions\s+28\.6%\s+2 of 7\s+8\.2-64\.1%\s+declined and left out, but the answer key has an answer/);
  assert.match(text, /accuracy when answered 66\.7% \(4 of 6\)/);
  assert.match(text, /Unnecessary declines\s+50\.0%\s+2 of 4/);
  assert.match(text, /category  declined, but the answer key has: news \(set aside: news\)/);
  assert.doesNotMatch(text, /answer key: null/);
  const html = renderHtml(R, 'now');
  assert.match(html, /accuracy when answered 66\.7%/);
  assert.match(html, /What was declined/);
});

// ---------- Variants ----------

test('declines: with a correct route, a declined record left out is SO-DECLINED, not also SO-FALSE-BLOCK', () => {
  const keys = KEY.map(k => ({ ...k, expected_outcome: k.category === 'none' ? 'LEFT_OUT' : 'WRITTEN' }));
  const S = scoreRaw({ ...RAW_CONFIG, routing: { ...RAW_CONFIG.routing, gold_field: 'expected_outcome' } }, PREDS, keys);
  const o = S.routing.silent_omissions;
  assert.equal(o.basis, 'gold_route');
  assert.deepEqual(o.records.map(x => [x.id, x.types]), [['L5', ['SO-DECLINED']], ['L8', ['SO-DECLINED']]]);
  assert.deepEqual([o.rate.n, o.rate.d], [2, 7]);
  // The key's route says L6 should have been left out: "should have been blocked" too, so critical.
  const l6 = S.routing.silent_errors.records.find(x => x.id === 'L6');
  assert.deepEqual([l6.severity, l6.types], ['critical', ['SP-FORBIDDEN', 'SP-SHOULD-DECLINE']]);
  assert.deepEqual([S.routing.block.precision.n, S.routing.block.precision.d], [2, 4]);
});

test('declines: a decline that goes out without review is SP-DECLINED, medium', () => {
  const preds = PREDS.map(p => (p.id === 'L8' ? { ...p, outcome: 'WRITTEN' } : p));
  const S = scoreRaw(RAW_CONFIG, preds, KEY);
  const l8 = S.routing.silent_errors.records.find(x => x.id === 'L8');
  assert.deepEqual([l8.severity, l8.types], ['medium', ['SP-DECLINED']]);
  assert.deepEqual(S.routing.silent_omissions.records.map(x => x.id), ['L5']);
});

test('declines: with only a decline field, the key cannot say to decline, so that rate is not measured', () => {
  const cfg = { ...RAW_CONFIG, outputs: { category: { ...RAW_CONFIG.outputs.category, decline: { field: 'declined' } } } };
  const preds = PREDS.map(p => (p.category === 'none' ? { ...p, category: undefined, declined: true } : p));
  const keys = KEY.filter(k => k.category !== 'none');
  const S = scoreRaw(cfg, preds.filter(p => keys.some(k => k.id === p.id)), keys);
  const d = S.quality.outputs.category.declines;
  assert.equal(d.should_have_declined, null);
  assert.equal(d.key_declines, null);
  assert.deepEqual([d.unnecessary.rate.n, d.unnecessary.rate.d], [2, 2]);
  assert.equal(S.quality.outputs.category.confusion[DECLINED], undefined);
  assert.match(renderTerminal({ ...S, inputs: { predictions: 'p', key: 'k', mode: 'strict', wrong_when: 'any_mismatch' }, problems: [] }), /not measured \(no decline\.values/);
});

test('declines: a decline on a gated output fails the gate (there is nothing to stand on)', () => {
  const cfg = { ...RAW_CONFIG, thresholds: { auto_publish: { category: 0.5 } } };
  const preds = PREDS.map(p => (p.id === 'L8' ? { ...p, outcome: 'WRITTEN' } : p));
  const S = scoreRaw(cfg, preds, KEY);
  assert.deepEqual(S.routing.safeguard_failures.detail, [{ id: 'L8', types: ['SG-GATE'] }]);
});

// ---------- Config and reading (F5-F10) ----------

const base = extra => ({ routing: { map: { A: 'auto' } }, outputs: { c: { type: 'label', labels: ['x', 'y'], ...extra } } });
const errs = extra => validateConfig(base(extra)).errors;

test('F5: a decline value that is also a label, or the reserved "(declined)", is a config error', () => {
  assert.deepEqual(errs({ decline: { values: ['none'], field: 'd' } }), []);
  assert.deepEqual(validateConfig(base({ decline: { values: ['none'] } })).config.outputs.c.decline, { values: ['none'], field: null });
  assert.match(errs({ decline: { values: ['x'] } })[0], /cannot be an answer and a decline/);
  assert.match(errs({ decline: { values: ['(declined)'] } })[0], /must not include/);
  assert.match(errs({ labels: ['x', '(declined)'] })[0], /must not include "\(declined\)"/);
  assert.match(errs({ decline: {} })[0], /either or both/);
  assert.match(errs({ decline: { value: ['none'] } })[0], /unknown key "outputs\.c\.decline\.value"/);
  assert.match(validateConfig({ routing: { map: { A: 'auto' } }, outputs: { c: { type: 'set', decline: { values: ['none'] } } } }).errors[0], /only applies to type "label"/);
  assert.match(validateConfig({ routing: { field: 'c', map: { x: 'auto' } }, outputs: { c: { type: 'label', labels: ['x', 'y'], decline: { values: ['none'] } } } }).errors[0], /also the route/);
});

const CFG = validateConfig({ ...RAW_CONFIG }).config;
function read(rec, isKey = false) {
  const p = problems('strict');
  const out = isKey ? normalizeKey([rec], CFG, 'key', p) : normalizePredictions([rec], CFG, 'preds', p);
  return { out: out[0] && out[0].outputs.category, flagged: p.items.map(i => i.level + ':' + i.trap), items: p.items };
}
const P = extra => ({ id: 'L1', outcome: 'WRITTEN', ...extra });

test('F6: a missing label is never read as a decline unless the decline field says so', () => {
  assert.deepEqual(read(P({})).flagged, ['stop:F3']);
  assert.match(read(P({})).items[0].message, /and declined is not true/);
  assert.deepEqual(read(P({ declined: false })).flagged, ['stop:F3']);
  assert.deepEqual(read(P({ declined: true })).out, { value: DECLINED, declined: true, set_aside: null, confidence: null, applied: false, inherited: false });
});

test('F7: the decline field must be a real true or false', () => {
  assert.deepEqual(read(P({ category: 'news', declined: 'true' })).flagged, ['stop:F7']);
  assert.equal(read(P({ category: 'news', declined: null })).out.value, 'news');
});

test('F8: a decline value reads as declined on predictions, and as "declining is correct" in the key', () => {
  assert.equal(read(P({ category: 'none' })).out.declined, true);
  assert.equal(read({ id: 'L1', category: 'none' }, true).out, DECLINED);
  assert.equal(read({ id: 'L1', category: 'news' }, true).out, 'news');
});

test('F9: a label beside a true decline field is set aside, not an answer', () => {
  const { out } = read(P({ category: 'news', confidence: 0.4, declined: true }));
  assert.deepEqual(out, { value: DECLINED, declined: true, set_aside: 'news', confidence: 0.4, applied: false, inherited: false });
});

test('F10: a decline value with spaces is trimmed; with another case it stops', () => {
  const spaced = read(P({ category: ' none ' }));
  assert.deepEqual([spaced.out.declined, spaced.flagged], [true, ['fix:D7']]);
  const cased = read(P({ category: 'None' }));
  assert.deepEqual(cased.flagged, ['stop:F1']);
  assert.match(cased.items[0].message, /or a decline: none\) \(did you mean "none"\?\)/);
});
