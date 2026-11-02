// Rulings on possible key gaps, key gaps from one run, the bracket for pending rulings, and one
// run against two keys: checked against test/fixtures/rulings/EXPECTED.md (traps I11-I17).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig, validateConfig } = require('../src/config.js');
const { scoreRun, varianceRun, compareRun } = require('../src/score.js');

const dir = path.join(__dirname, 'fixtures', 'rulings');
const f = name => path.join(dir, name);
const config = loadConfig(f('config.json'));
const pred = f('predictions.json');
const keyPath = f('key.json');
const tiny = path.join(__dirname, 'fixtures', 'tiny');
const tinyConfig = loadConfig(path.join(tiny, 'config.json'));
const tinyKey = path.join(tiny, 'key.json');
const run = x => path.join(__dirname, 'fixtures', 'runs', 'run-' + x + '.json');
const cli = args => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wfeval.js'), ...args], { encoding: 'utf8' });
// Required inside each test, so each test fails on its own where the module does not exist.
const loadRulings = (file, cfg = config, mode = 'strict') => require('../src/rulings.js').loadRulings(file, cfg, mode);
const rate = r => [r.n, r.d, r.pct, r.low_pct, r.high_pct];
const triple = x => x.id + ' ' + x.output + ' ' + x.value;

// A temporary rulings file (or any JSON) and the folder to clean up.
function tmpFile(name, content) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-rulings-'));
  const file = path.join(d, name);
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return { file, done: () => fs.rmSync(d, { recursive: true }) };
}
const ruling = (over = {}) => ({ id: 'K1', output: 'SUBJECT', value: 'SUBJ-ANTI', ruling: 'pending', by: 'DH', on: '2026-10-30', ...over });
// The stop or strict problems loading a rulings file raises, as one error message.
function loadError(rulings, cfg = config, mode = 'strict') {
  const t = tmpFile('r.json', rulings);
  try { loadRulings(t.file, cfg, mode); return null; } catch (e) { return e.message; } finally { t.done(); }
}

// ---------- I11: the rulings file ----------

test('I11: an add joins the key for scoring; pending and reject stay wrong', () => {
  const plain = scoreRun({ config, predPath: pred, keyPath });
  assert.deepEqual(rate(plain.routing.silent_errors.rate), [5, 7, 71.4, 35.9, 91.8]);
  const R = scoreRun({ config, predPath: pred, keyPath, rulings: loadRulings(f('rulings.json')) });
  assert.deepEqual(rate(R.routing.silent_errors.rate), [4, 7, 57.1, 25, 84.2]);
  assert.deepEqual(R.routing.silent_errors.records.map(x => x.id), ['K1', 'K3', 'K4', 'K5']);
  const s = R.quality.outputs.SUBJECT;
  assert.deepEqual([s.tp, s.fp, s.fn, s.precision.pct, s.f1], [9, 4, 0, 69.2, 0.818]);
  assert.deepEqual(rate(R.routing.straight_through), [7, 9, 77.8, 45.3, 93.7]);
});

test('I11: the report says which values the rulings added, and the key file is never changed', () => {
  const before = fs.readFileSync(keyPath, 'utf8');
  const R = scoreRun({ config, predPath: pred, keyPath, rulings: loadRulings(f('rulings.json')) });
  assert.equal(fs.readFileSync(keyPath, 'utf8'), before);
  const r = R.rulings;
  assert.equal(r.file, f('rulings.json'));
  assert.deepEqual(r.added.map(triple), ['K2 SUBJECT SUBJ-MNA']);
  assert.deepEqual(r.added[0], { id: 'K2', output: 'SUBJECT', value: 'SUBJ-MNA', by: 'DH', on: '2026-10-30', note: 'the earnings release announces an acquisition' });
  assert.deepEqual(r.rejected.map(triple), ['K3 SUBJECT SUBJ-ANTI']);
  assert.deepEqual(r.pending.map(triple), ['K1 SUBJECT SUBJ-ANTI', 'K5 SUBJECT SUBJ-EARN']);
  assert.deepEqual(r.set_aside.map(x => triple(x) + ' ' + x.ruling), ['K7 SUBJECT SUBJ-LAB add']);
  assert.equal(R.inputs.rulings, f('rulings.json'));
  // The paired records carry the added value; the answer key read from the file does not.
  assert.deepEqual(R.paired.find(x => x.id === 'K2').key.SUBJECT, ['SUBJ-EARN', 'SUBJ-MNA']);
});

test('I11: a ruling on an alias is read through the config\'s equivalents, and the report says so', () => {
  const rl = loadRulings(f('rulings.json'));
  assert.equal(rl.list.find(x => x.id === 'K2').value, 'SUBJ-MNA');
  const fix = rl.problems.find(p => p.trap === 'D23');
  assert.equal(fix.level, 'fix');
  assert.ok(fix.where.startsWith(f('rulings.json')));
  assert.match(fix.message, /SUBJ-MERGERS.*SUBJ-MNA/);
});

// ---------- I14: a ruling for a value the key already has ----------

test('I14: an add for a value the key already accepts (an any_of alternative, a plain value, an alias) warns and changes nothing', () => {
  const t = tmpFile('r.json', { rulings: [
    ruling({ id: 'K7', value: 'SUBJ-LAB', ruling: 'add' }),
    ruling({ id: 'K1', value: 'SUBJ-MERGERS', ruling: 'add' }),   // K1's key has SUBJ-MNA
    ruling({ id: 'K4', value: 'SUBJ-MNA', ruling: 'reject' }),
  ] });
  const R = scoreRun({ config, predPath: pred, keyPath, rulings: loadRulings(t.file) });
  t.done();
  const warns = R.problems.filter(p => p.trap === 'I14');
  assert.equal(warns.length, 3);
  assert.ok(warns.every(w => w.level === 'warn'));
  assert.match(warns[0].message, /already/);
  assert.deepEqual(R.rulings.added, []);
  assert.deepEqual(R.rulings.set_aside.map(triple), ['K7 SUBJECT SUBJ-LAB', 'K1 SUBJECT SUBJ-MNA', 'K4 SUBJECT SUBJ-MNA']);
  assert.deepEqual(rate(R.routing.silent_errors.rate), [5, 7, 71.4, 35.9, 91.8]);
});

// ---------- I12: a rulings file that is not rulings ----------

test('I12: a file that is not { "rulings": [...] } stops', () => {
  assert.match(loadError('{ not json'), /not valid JSON/);
  assert.match(loadError([ruling()]), /\[I12\].*"rulings"/);
  assert.match(loadError({ rulings: [], extra: 1 }), /\[I12\].*unknown key "extra"/);
  assert.match(loadError({ rulings: ['K1 SUBJECT SUBJ-ANTI'] }), /\[I12\].*rulings\[0\].*must be an object/);
  assert.match(loadError({ rulings: [ruling({ value: undefined })] }), /\[I12\].*"value"/);
  assert.match(loadError({ rulings: [ruling({ value: '' })] }), /\[I12\].*"value"/);
  assert.match(loadError({ rulings: [ruling({ notes: 'typo' })] }), /\[I12\].*unknown key "notes"/);
  assert.match(loadError({ rulings: [ruling({ by: 7 })] }), /\[I12\].*"by" must be text/);
  assert.equal(loadError({ rulings: [] }), null);   // nothing ruled yet is a valid file
});

test('I12: an unknown ruling stops, with "did you mean" for case', () => {
  assert.match(loadError({ rulings: [ruling({ ruling: 'accept' })] }), /\[I12\].*"accept".*add, reject, pending/);
  assert.match(loadError({ rulings: [ruling({ ruling: 'Add' })] }), /\[I12\].*did you mean "add"/);
});

test('I12: an output that is not a set output stops', () => {
  assert.match(loadError({ rulings: [ruling({ output: 'TOPIC' })] }), /\[I12\].*"TOPIC" is not an output/);
  const { config: withLabel } = validateConfig({
    outputs: { TAGS: { type: 'set' }, verdict: { type: 'label', labels: ['pass', 'fail'] } },
    routing: { map: { GO: 'auto' } },
  });
  assert.match(loadError({ rulings: [ruling({ output: 'verdict', value: 'pass' })] }, withLabel), /\[I12\].*verdict.*label.*set output/);
});

test('I12: the same (id, output, value) twice stops, aliases included', () => {
  assert.match(loadError({ rulings: [ruling(), ruling({ ruling: 'reject' })] }), /\[I12\].*K1 SUBJECT SUBJ-ANTI.*rulings\[0\]/);
  assert.match(loadError({ rulings: [ruling({ value: 'SUBJ-MNA' }), ruling({ value: 'SUBJ-MERGERS', ruling: 'add' })] }), /\[I12\].*SUBJ-MNA/);
});

// ---------- I13: an unrecorded ruling, or one for another key ----------

test('I13: a decided ruling without who or when stops in strict mode, warns with --lenient', () => {
  const noBy = { rulings: [ruling({ ruling: 'reject', by: undefined })] };
  const msg = loadError(noBy);
  assert.match(msg, /\* \[I13\].*"by"/);
  assert.match(loadError({ rulings: [ruling({ ruling: 'add', on: '' })] }), /\[I13\].*"on"/);
  const t = tmpFile('r.json', noBy);
  const rl = loadRulings(t.file, config, 'lenient');
  t.done();
  assert.deepEqual(rl.problems.map(p => p.level + ' ' + p.trap), ['warn I13']);
  assert.equal(rl.list[0].by, null);
  // A pending ruling decides nothing yet: it reads without them, in strict mode too.
  assert.equal(loadError({ rulings: [ruling({ by: undefined, on: '' })] }), null);
});

test('I13: a ruling for a record not in the answer key stops in strict mode; with --lenient it is set aside', () => {
  const t = tmpFile('r.json', { rulings: [ruling({ id: 'k2', value: 'SUBJ-MNA', ruling: 'add' }), ruling()] });
  assert.throws(() => scoreRun({ config, predPath: pred, keyPath, rulings: loadRulings(t.file) }), /\[I13\].*"k2".*did you mean "K2"/);
  const R = scoreRun({ config, predPath: pred, keyPath, mode: 'lenient', rulings: loadRulings(t.file, config, 'lenient') });
  t.done();
  assert.deepEqual(R.problems.filter(p => p.trap === 'I13').map(p => p.level), ['warn']);
  assert.deepEqual(R.rulings.added, []);
  assert.deepEqual(R.rulings.set_aside.map(triple), ['k2 SUBJECT SUBJ-MNA']);
});

test('I13: an add for a value outside allowed_values stops in strict mode (a typo would add a value nothing can fill)', () => {
  const { config: cfg } = validateConfig({
    outputs: { SUBJECT: { type: 'set' }, GEOGRAPHY: { type: 'set' } },
    routing: { field: 'route', gold_field: 'expected_route', map: { AUTO_PUBLISH: 'auto', EDITOR_REVIEW: 'review', DUPLICATE_SUPPRESSED: 'exclude' } },
    allowed_values: { SUBJECT: ['SUBJ-MNA', 'SUBJ-ANTI', 'SUBJ-EARN', 'SUBJ-LAB'] },
  });
  const t = tmpFile('r.json', { rulings: [ruling({ id: 'K3', value: 'SUBJ-ANTl', ruling: 'add' })] });
  assert.throws(() => scoreRun({ config: cfg, predPath: pred, keyPath, rulings: loadRulings(t.file, cfg) }), /\[I13\].*SUBJ-ANTl.*allowed_values/);
  t.done();
});

// ---------- I16: possible key gaps from one run ----------

test('I16: score lists the applied values the key lacks, silent errors first, rejected ones counted not listed', () => {
  const R = scoreRun({ config, predPath: pred, keyPath, rulings: loadRulings(f('rulings.json')) });
  assert.deepEqual(R.key_gaps, {
    candidates: [
      { id: 'K1', output: 'SUBJECT', value: 'SUBJ-ANTI', confidence: 0.9, silent_error: { types: ['SP-WRONG'], if_added: [] },
        ruling: 'pending', by: 'DH', on: '2026-10-30', note: 'the deal is under antitrust review; ask the desk' },
      { id: 'K4', output: 'GEOGRAPHY', value: 'GEO-UK', confidence: 0.85, silent_error: { types: ['SP-WRONG'], if_added: [] }, ruling: 'unruled' },
      { id: 'K5', output: 'SUBJECT', value: 'SUBJ-EARN', confidence: 0.88, silent_error: { types: ['SP-WRONG', 'SP-SHOULD-REVIEW'], if_added: ['SP-SHOULD-REVIEW'] },
        ruling: 'pending', by: 'DH', on: '2026-10-30', note: null },
      { id: 'K6', output: 'SUBJECT', value: 'SUBJ-ANTI', confidence: 0.7, silent_error: null, ruling: 'unruled' },
    ],
    rejected: 1,
  });
});

test('I16: without rulings, every applied gap is listed, with no ruling status', () => {
  const R = scoreRun({ config, predPath: pred, keyPath });
  assert.deepEqual(R.key_gaps.candidates.map(c => triple(c) + (c.silent_error ? ' silent' + (c.silent_error.if_added.length ? ' stays' : ' clears') : '')), [
    'K1 SUBJECT SUBJ-ANTI silent clears', 'K2 SUBJECT SUBJ-MNA silent clears', 'K3 SUBJECT SUBJ-ANTI silent clears',
    'K4 GEOGRAPHY GEO-UK silent clears', 'K5 SUBJECT SUBJ-EARN silent stays', 'K6 SUBJECT SUBJ-ANTI',
  ]);
  assert.ok(R.key_gaps.candidates.every(c => !('ruling' in c)));
  assert.equal(R.key_gaps.rejected, 0);
  // Nothing about rulings appears without a rulings file.
  assert.equal(R.rulings, undefined);
  assert.equal(R.inputs.rulings, undefined);
});

test('I16: the tiny fixture\'s R2 is a silent error a ruling cannot clear: its key routes it to a person', () => {
  const R = scoreRun({ config: tinyConfig, predPath: run('a'), keyPath: tinyKey });
  assert.deepEqual(R.key_gaps.candidates, [
    { id: 'R2', output: 'SUBJECT', value: 'SUBJ-ANTI', confidence: 0.88, silent_error: { types: ['SP-WRONG', 'SP-SHOULD-REVIEW'], if_added: ['SP-SHOULD-REVIEW'] } },
  ]);
  const ruled = scoreRun({ config: tinyConfig, predPath: run('a'), keyPath: tinyKey, rulings: loadRulings(path.join(dir, 'tiny-rulings.json'), tinyConfig) });
  assert.deepEqual(ruled.key_gaps, { candidates: [], rejected: 1 });
});

test('I16: the terminal lists the gaps, truncated like the other lists, the full list in JSON', () => {
  const { renderTerminal } = require('../src/report/terminal.js');
  const { resultsJson } = require('../src/report/json.js');
  const R = scoreRun({ config, predPath: pred, keyPath, rulings: loadRulings(f('rulings.json')) });
  const out = renderTerminal(R);
  assert.match(out, /POSSIBLE KEY GAPS {2}4 applied values the answer key does not list/);
  assert.match(out, /K1 +SUBJECT +SUBJ-ANTI +0\.90 +silent error, clears if added +pending \(DH, 2026-10-30\)/);
  assert.match(out, /K5 +SUBJECT +SUBJ-EARN +0\.88 +silent error, stays one if added: SP-SHOULD-REVIEW +pending/);
  assert.match(out, /K6 +SUBJECT +SUBJ-ANTI +0\.70 +not a silent error \(sent to a person\) +unruled/);
  assert.match(out, /1 ruled not a gap/);
  assert.deepEqual(resultsJson(R).key_gaps.candidates.length, 4);

  // 14 records, each with one gap: 12 shown, then "+2 more".
  const ids = Array.from({ length: 14 }, (_, i) => 'G' + (i + 1));
  const k = tmpFile('key.json', ids.map(id => ({ id, expected_route: 'EDITOR_REVIEW', SUBJECT: ['SUBJ-MNA'], GEOGRAPHY: ['GEO-US'] })));
  const p = tmpFile('pred.json', ids.map(id => ({ id, route: 'EDITOR_REVIEW', SUBJECT: [{ value: 'SUBJ-MNA', confidence: 0.7 }, { value: 'SUBJ-ANTI', confidence: 0.7 }], GEOGRAPHY: [{ value: 'GEO-US', confidence: 0.7 }] })));
  const many = scoreRun({ config, predPath: p.file, keyPath: k.file });
  k.done(); p.done();
  const text = renderTerminal(many);
  assert.equal(many.key_gaps.candidates.length, 14);
  assert.match(text, /G12 +SUBJECT/);
  assert.doesNotMatch(text, /G13 +SUBJECT/);
  assert.match(text, /\+2 more \(all in --json\)/);
});

// ---------- I15: the bracket for pending rulings ----------

test('I15: score again with every pending ruling as an add: 3 of 7, beside the strict 4 of 7', () => {
  const R = scoreRun({ config, predPath: pred, keyPath, rulings: loadRulings(f('rulings.json')) });
  const b = R.rulings.if_pending_added;
  assert.equal(b.pending, 2);
  assert.deepEqual(b.not_applied, []);
  assert.deepEqual(rate(b.silent_errors), [3, 7, 42.9, 15.8, 75]);
  assert.deepEqual([b.cleared, b.became], [['K1'], []]);
  // key-v2 is the key with the add and both pending values written in: the same figure.
  const v2 = scoreRun({ config, predPath: pred, keyPath: f('key-v2.json') });
  assert.deepEqual(rate(v2.routing.silent_errors.rate), rate(b.silent_errors));
});

test('I15: the terminal and HTML say it under the headline, and when it is not a bracket', () => {
  const { renderTerminal } = require('../src/report/terminal.js');
  const { renderHtml } = require('../src/report/html.js');
  const R = scoreRun({ config, predPath: pred, keyPath, rulings: loadRulings(f('rulings.json')) });
  const out = renderTerminal(R);
  assert.match(out, /If the 2 pending rulings were all added to the answer key: 42\.9% \(3 of 7, likely 15\.8-75\.0%\), against 57\.1% with them counted wrong\. However they are ruled, the rate lands between the two\./);
  assert.ok(out.indexOf('If the 2 pending') < out.indexOf('SILENT ERRORS'));
  // Wrapped to 100 columns: a long path takes a line of its own, and where the rest breaks depends
  // on how long the folder's path is, so any space may be a line break.
  assert.match(out, /RULINGS {2}1 value added to the answer key by rulings in\s+\S*rulings\.json:\s+K2\s+SUBJECT\s+SUBJ-MNA\./);
  assert.match(out, /the key file itself is unchanged/);
  assert.match(out, /1 ruled not a gap, 2 pending \(counted wrong\), 1 set aside/);
  const html = renderHtml(R, '2026-10-31T00:00:00.000Z');
  assert.match(html, /1 value added to the answer key by rulings in/);
  assert.match(html, /If the 2 pending rulings were all added to the answer key: 42\.9%/);
  assert.doesNotMatch(renderHtml(scoreRun({ config, predPath: pred, keyPath }), '2026-10-31T00:00:00.000Z'), /by rulings in|pending rulings? were|ruled not a gap/);

  const U = scoreRun({ config, predPath: pred, keyPath, rulings: loadRulings(f('rulings-unstated.json')) });
  const b = U.rulings.if_pending_added;
  assert.deepEqual([b.pending, b.not_applied.map(triple), rate(b.silent_errors), b.cleared, b.became],
    [3, ['K9 GEOGRAPHY GEO-CA'], [4, 7, 57.1, 25, 84.2], ['K1'], ['K9']]);
  assert.match(renderTerminal(U), /If the 3 pending rulings were all added to the answer key: 57\.1% \(4 of 7.*1 of them is a value this run did not apply: added, it is a miss here, so the two are not a bracket\./);
});

test('I15: no pending ruling, no bracket', () => {
  const { renderTerminal } = require('../src/report/terminal.js');
  const R = scoreRun({ config: tinyConfig, predPath: run('a'), keyPath: tinyKey, rulings: loadRulings(path.join(dir, 'tiny-rulings.json'), tinyConfig) });
  assert.equal(R.rulings.if_pending_added, null);
  const out = renderTerminal(R);
  assert.doesNotMatch(out, /pending rulings? were/);
  assert.match(out, /RULINGS {2}no values added to the answer key by rulings in\s+\S*tiny-rulings\.json\./);
});

// ---------- variance with rulings ----------

test('variance: a rejected gap is never listed again, only counted; every metric is unchanged', () => {
  const { renderVariance } = require('../src/report/terminal.js');
  const rl = loadRulings(path.join(dir, 'tiny-rulings.json'), tinyConfig);
  const V = varianceRun({ config: tinyConfig, keyPath: tinyKey, predPaths: [run('a'), run('b'), run('c')], rulings: rl });
  assert.deepEqual(V.records.key_gap_candidates, []);
  assert.equal(V.records.key_gaps_rejected, 1);
  assert.deepEqual(V.metrics.find(m => m.name === 'silent error rate').values, [50, 0, 33.3]);
  const out = renderVariance(V);
  assert.match(out, /POSSIBLE KEY GAPS {2}none left to rule on/);
  assert.match(out, /1 ruled not a gap/);
  assert.match(out, /RULINGS {2}no values added/);
});

test('variance: a pending gap is listed with its ruling', () => {
  const { renderVariance } = require('../src/report/terminal.js');
  const t = tmpFile('r.json', { rulings: [{ id: 'R2', output: 'SUBJECT', value: 'SUBJ-ANTI', ruling: 'pending', by: 'DH', on: '2026-10-30' }] });
  const V = varianceRun({ config: tinyConfig, keyPath: tinyKey, predPaths: [run('a'), run('b'), run('c')], rulings: loadRulings(t.file, tinyConfig) });
  t.done();
  assert.deepEqual(V.records.key_gap_candidates, [
    { id: 'R2', output: 'SUBJECT', value: 'SUBJ-ANTI', runs: 3, of: 3, applied: 3, confidence: { min: 0.8, max: 0.88 }, ruling: 'pending', by: 'DH', on: '2026-10-30', note: null },
  ]);
  assert.equal(V.records.key_gaps_rejected, 0);
  assert.match(renderVariance(V), /R2 +SUBJECT {2}SUBJ-ANTI {3}applied in 3 of 3 · confidence 0\.80-0\.88 {3}pending \(DH, 2026-10-30\)/);
});

test('variance: the rulings file\'s warnings are reported once, not once per run', () => {
  const V = varianceRun({ config, keyPath, predPaths: [pred, pred], rulings: loadRulings(f('rulings.json')) });
  assert.deepEqual(V.problems.map(p => p.trap).sort(), ['D23', 'I14', 'I3']);
  assert.deepEqual(V.rulings.added.map(triple), ['K2 SUBJECT SUBJ-MNA']);
});

// ---------- I17: one run against two keys ----------

test('I17: the same predictions against two keys: every change is the key\'s', () => {
  const { renderCompare } = require('../src/report/terminal.js');
  const C = compareRun({ config, keyPath, afterKeyPath: f('key-v2.json'), beforePath: pred, afterPath: pred });
  const m = name => C.metrics.find(x => x.name === name);
  const se = m('silent error rate');
  assert.deepEqual([se.before, se.after, se.delta, se.verdict], [71.4, 42.9, -28.6, 'from the key']);
  assert.deepEqual([m('SUBJECT precision').before, m('SUBJECT precision').after, m('SUBJECT F1').before, m('SUBJECT F1').after], [61.5, 84.6, 0.762, 0.917]);
  assert.equal(m('straight-through').verdict, 'no change');
  const o = name => C.paired.outcomes.find(x => x.name === name);
  const s = o('silent errors');
  assert.deepEqual([s.before, s.after, s.fixed, s.broke, s.low_pct, s.high_pct, s.verdict, s.fixed_ids], [5, 3, 2, 0, -54.7, 14.3, 'unclear', ['K1', 'K2']]);
  assert.equal(o('routed against the answer key').verdict, 'no change');
  assert.equal(C.inputs.after_key, f('key-v2.json'));
  assert.deepEqual(C.problems, []);
  const out = renderCompare(C);
  assert.match(out, /the same predictions against two answer keys/);
  assert.match(out, /K1 +no longer a silent error/);
});

test('I17: rulings apply to both keys; the new key already holds three of them', () => {
  const C = compareRun({ config, keyPath, afterKeyPath: f('key-v2.json'), beforePath: pred, afterPath: pred, rulings: loadRulings(f('rulings.json')) });
  const s = C.paired.outcomes.find(x => x.name === 'silent errors');
  assert.deepEqual([s.before, s.after, s.fixed_ids, s.broke], [4, 3, ['K1'], 0]);
  assert.deepEqual(C.rulings.after.set_aside.map(triple), ['K1 SUBJECT SUBJ-ANTI', 'K2 SUBJECT SUBJ-MNA', 'K5 SUBJECT SUBJ-EARN', 'K7 SUBJECT SUBJ-LAB']);
  assert.deepEqual(C.rulings.before.added.map(triple), ['K2 SUBJECT SUBJ-MNA']);
  assert.equal(C.problems.filter(p => p.trap === 'I14').length, 4);   // K7 once, though both keys set it aside
});

test('I17: two keys that do not cover the same records stop', () => {
  const rows = JSON.parse(fs.readFileSync(f('key-v2.json'), 'utf8')).filter(r => r.id !== 'K9');
  const t = tmpFile('key-v3.json', rows);
  assert.throws(() => compareRun({ config, keyPath, afterKeyPath: t.file, beforePath: pred, afterPath: pred }), /\[I17\].*1 only in .*key\.json: "K9"/);
  t.done();
});

test('I17: two different runs against two keys warn: each change mixes the run\'s and the key\'s', () => {
  const rows = JSON.parse(fs.readFileSync(pred, 'utf8'));
  rows[5].route = 'AUTO_PUBLISH';
  rows[5].SUBJECT[0].confidence = 0.9;
  const t = tmpFile('pred-b.json', rows);
  const C = compareRun({ config, keyPath, afterKeyPath: f('key-v2.json'), beforePath: pred, afterPath: t.file });
  t.done();
  assert.deepEqual(C.problems.map(p => p.level + ' ' + p.trap), ['warn I17']);
  assert.equal(C.metrics.find(x => x.name === 'silent error rate').verdict, 'no noise baseline');
});

test('I17: --noise does not go with two keys', () => {
  assert.throws(() => compareRun({ config, keyPath, afterKeyPath: f('key-v2.json'), beforePath: pred, afterPath: pred, noisePaths: [pred, pred] }), /--noise/);
});

test('compare with rulings and one key scores both runs against the key plus the rulings', () => {
  const C = compareRun({ config, keyPath, beforePath: pred, afterPath: pred, rulings: loadRulings(f('rulings.json')) });
  const se = C.metrics.find(x => x.name === 'silent error rate');
  assert.deepEqual([se.before, se.after], [57.1, 57.1]);
  assert.equal(C.inputs.rulings, f('rulings.json'));
});

// ---------- the command line ----------

test('CLI: score, variance and compare take --rulings; compare takes --after-key', () => {
  const s = cli(['score', '--config', f('config.json'), '--pred', pred, '--key', keyPath, '--rulings', f('rulings.json')]);
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /If the 2 pending rulings were all added to the answer key: 42\.9%/);
  assert.match(s.stdout, /POSSIBLE KEY GAPS/);
  const v = cli(['variance', '--config', path.join(tiny, 'config.json'), '--key', tinyKey, run('a'), run('b'), run('c'), '--rulings', path.join(dir, 'tiny-rulings.json')]);
  assert.equal(v.status, 0, v.stderr);
  assert.match(v.stdout, /1 ruled not a gap/);
  const c = cli(['compare', '--config', f('config.json'), '--key', keyPath, '--after-key', f('key-v2.json'), '--before', pred, '--after', pred]);
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /silent errors +5 +3 +2 +0/);
  const bad = tmpFile('r.json', { rulings: [ruling({ ruling: 'accept' })] });
  const b = cli(['score', '--config', f('config.json'), '--pred', pred, '--key', keyPath, '--rulings', bad.file]);
  bad.done();
  assert.equal(b.status, 1);
  assert.match(b.stderr, /\[I12\]/);
  const g = cli(['score', '--grades', path.join(__dirname, 'fixtures', 'freetext', 'grades-a.json'), '--rulings', f('rulings.json')]);
  assert.equal(g.status, 1);
  assert.match(g.stderr, /--rulings/);
  assert.match(cli(['--help']).stdout, /--rulings <file>[\s\S]*--after-key <file>/);
});
