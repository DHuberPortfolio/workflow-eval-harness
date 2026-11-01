// Policy what-ifs (wfeval whatif --policies / --hold-if), checked against
// test/fixtures/policy/EXPECTED.md, and per-record thresholds (thresholds.auto_publish naming a
// field). Traps E10-E19.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig, validateConfig } = require('../src/config.js');
const { scoreRun } = require('../src/score.js');
const { gateSweep } = require('../src/metrics/whatif.js');
const { judgeAll, gatePasses } = require('../src/metrics/judge.js');
const { readPolicies, parseHoldIf, policyFields, checkPolicyData } = require('../src/policy.js');
const { policySweep, holds } = require('../src/metrics/policy.js');
const { renderWhatif } = require('../src/report/terminal.js');
const { problems } = require('../src/problems.js');

const dir = path.join(__dirname, 'fixtures', 'policy');
const files = { config: path.join(dir, 'config.json'), pred: path.join(dir, 'predictions.json'), key: path.join(dir, 'key.json'), policies: path.join(dir, 'policies.json') };
const baseConfig = loadConfig(files.config);
const policies = readPolicies(JSON.parse(fs.readFileSync(files.policies, 'utf8')), baseConfig, files.policies);
const config = policyFields(baseConfig, policies);
const { paired } = scoreRun({ config, predPath: files.pred, keyPath: files.key });
const cli = args => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wfeval.js'), ...args], { encoding: 'utf8' });
const base = ['whatif', '--config', files.config, '--pred', files.pred, '--key', files.key];
const frac = r => (r.d === 0 ? 'none' : r.n + '/' + r.d);

const W = policySweep(paired, config, policies);
const row = name => W.rows.find(r => r.name === name);
const summary = name => {
  const r = row(name);
  return [r.through.join(' '), frac(r.silent_error_rate), r.silent_errors.join(' '), r.wasted_reviews.join(' '), frac(r.review_queue_precision),
    frac(r.straight_through), frac(r.silent_omissions), r.held.join(' '), r.moved_in.join(' '), r.moved_out.join(' ')];
};

test('per-record thresholds: each record is gated at its own "gate" field, and the run is reproduced', () => {
  assert.equal(baseConfig.thresholds.auto_publish.codes, 'gate');
  const own = Object.fromEntries(paired.map(r => [r.id, r.fields.gate]));
  assert.deepEqual(own, { P1: 0.9, P2: 0.9, P3: 0.8, P4: 0.8, P5: 0.8, P6: 0.9, P7: 0.9, P8: 0.9 });
  const routes = paired.filter(r => r.route_class !== 'block').map(r => r.id + (gatePasses(r, config) ? ' auto' : ' review'));
  assert.deepEqual(routes, ['P1 auto', 'P2 auto', 'P3 auto', 'P4 auto', 'P5 review', 'P6 review', 'P8 auto']);
  // Nothing went out against its own gate, so no SG-GATE.
  assert.ok(judgeAll(paired, config).every(j => !j.safeguards.includes('SG-GATE')));
});

test('per-record thresholds: SG-GATE reads the record\'s own threshold', () => {
  const lowered = paired.map(r => (r.id === 'P3' ? { ...r, fields: { ...r.fields, gate: 0.9 } } : r));
  const j = judgeAll(lowered, config).find(x => x.id === 'P3');
  assert.deepEqual(j.safeguards, ['SG-GATE']);
});

test('per-record thresholds: a number in auto_publish behaves exactly as before', () => {
  const r = { id: 'x', route_class: 'auto', pred: { codes: [{ value: 'A', confidence: 0.85, applied: true }] } };
  const numeric = validateConfig({ outputs: { codes: { type: 'set' } }, routing: { map: { A: 'auto' } }, thresholds: { auto_publish: { codes: 0.85 } } }).config;
  assert.equal(gatePasses(r, numeric), true);
  assert.equal(gatePasses(r, numeric, { codes: 0.9 }), false);
  assert.equal(r.fields, undefined);
});

test('per-record thresholds: the gate sweep sets one threshold for every record; the check runs at each record\'s own', () => {
  const g = gateSweep(paired, config);
  assert.ok(g.rows.every(r => r.current === false));
  assert.deepEqual(g.rows.map(r => r.threshold), [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1]);
  assert.deepEqual(g.check, { threshold: null, own: 'gate', movable: 7, reproduced: 7, differing: [] });
  assert.deepEqual(g.rows.find(r => r.threshold === 0.9).through, ['P1', 'P2', 'P8']);
  assert.match(renderWhatif(g), /at each record's own threshold \("gate"\) the simulation reproduces the actual route of all 7 movable records/);
});

test('policies: one row per policy plus as run, as worked by hand', () => {
  assert.deepEqual(W.rows.map(r => r.name), ['as run', 'Weak matches to a person', 'Strong B to a person', 'Both', 'South to a person',
    'Gate 0.90 for every record', 'Cap each gate at 0.75']);
  //                                    out              silent  errors   unnecessary  precision straight omissions held           in    out
  assert.deepEqual(summary('as run'), ['P1 P2 P3 P4 P8', '2/5', 'P2 P4', 'P5', '1/2', '5/8', '0/7', '', '', '']);
  assert.deepEqual(summary('Weak matches to a person'), ['P1 P4 P8', '1/3', 'P4', 'P3 P5', '2/4', '3/8', '0/7', 'P2 P3', '', 'P2 P3']);
  assert.deepEqual(summary('Strong B to a person'), ['P1 P3 P4', '1/3', 'P4', 'P5 P8', '2/4', '3/8', '0/7', 'P2 P8', '', 'P2 P8']);
  assert.deepEqual(summary('Both'), ['P1 P4', '1/2', 'P4', 'P3 P5 P8', '2/5', '2/8', '0/7', 'P2 P3 P8', '', 'P2 P3 P8']);
  assert.deepEqual(summary('South to a person'), ['P1 P3 P8', '0/3', '', 'P5', '3/4', '3/8', '0/7', 'P2 P4', '', 'P2 P4']);
  assert.deepEqual(summary('Gate 0.90 for every record'), ['P1 P2 P8', '1/3', 'P2', 'P3 P5', '2/4', '3/8', '0/7', '', '', 'P3 P4']);
  assert.deepEqual(summary('Cap each gate at 0.75'), ['P1 P2 P3 P4 P5 P8', '2/6', 'P2 P4', '', '1/1', '6/8', '0/7', '', 'P5', '']);
});

test('policies: paired against as run, silent errors fixed and unnecessary reviews added', () => {
  const p = name => { const x = row(name).paired; return [x.silent_errors.fixed, x.silent_errors.broke, x.unnecessary_reviews.fixed, x.unnecessary_reviews.broke]; };
  assert.deepEqual(p('Weak matches to a person'), [1, 0, 0, 1]);
  assert.deepEqual(p('Strong B to a person'), [1, 0, 0, 1]);
  assert.deepEqual(p('Both'), [1, 0, 0, 2]);
  assert.deepEqual(p('South to a person'), [2, 0, 0, 0]);
  assert.deepEqual(p('Gate 0.90 for every record'), [1, 0, 0, 1]);
  assert.deepEqual(p('Cap each gate at 0.75'), [0, 0, 1, 0]);
  assert.equal(row('as run').paired, null);
  assert.equal(row('South to a person').paired.records, 8);
});

test('policies: hold-if alone is exact; a threshold change rests on the gate what-if\'s assumption', () => {
  assert.deepEqual(W.rows.map(r => r.exact), [true, true, true, true, true, false, false]);
  assert.match(W.assumption, /upper bound/);
});

// Holding moves a record that went out without review to a person and changes nothing else, so
// every other judgment of every record stays as it was (EXPECTED.md, "Why hold-if is exact").
test('policies: holding changes nothing but the held records\' route, and only fixes silent errors', () => {
  const before = judgeAll(paired, config);
  const strip = j => { const { route, route_class, silent, safeguards, wasted_review, routed_correctly, ...rest } = j; return rest; };
  for (const pol of policies.filter(p => !p.auto_publish && !p.auto_publish_cap)) {
    const held = new Set(row(pol.name).held);
    const moved = paired.map(r => (held.has(r.id) ? { ...r, route_class: 'review', route: '(held)' } : r));
    const after = judgeAll(moved, config);
    after.forEach((a, i) => {
      assert.deepEqual(strip(a), strip(before[i]), pol.name + ' ' + a.id);
      if (!held.has(a.id)) assert.deepEqual(a, before[i]);
      else assert.equal(before[i].route_class, 'auto');
    });
    assert.ok(after.every((a, i) => !a.silent || before[i].silent), 'no silent error is created');
  }
});

test('hold-if: blocked records are never held, even when a condition holds for them', () => {
  // P7 (blocked) has match 0.2 and client south.
  assert.ok(!row('Weak matches to a person').held.includes('P7'));
  assert.ok(!row('South to a person').held.includes('P7'));
  assert.equal(holds(paired.find(r => r.id === 'P7'), policies[0].hold_if, config), true);
});

test('hold-if: clauses inside one condition must all hold; any one condition holds a record', () => {
  const rec = id => paired.find(r => r.id === id);
  const southStrong = [{ field: 'client', in: ['south'], output: 'codes', confidence_at_least: 0.9 }];
  assert.deepEqual(['P2', 'P4'].map(id => holds(rec(id), southStrong, config)), [true, false]);
  const unapplied = [{ output: 'codes', applied: false }];
  assert.deepEqual(['P1', 'P2', 'P6'].map(id => holds(rec(id), unapplied, config)), [false, true, true]);
  const appliedB = [{ output: 'codes', value: 'B', applied: true }];
  assert.deepEqual(['P2', 'P5', 'P8'].map(id => holds(rec(id), appliedB, config)), [false, true, true]);
  // "all": two clauses of the same kind, both holding. P2 states A and B; P4 states only A.
  const both = [{ all: [{ output: 'codes', values: ['A'] }, { output: 'codes', values: ['B'] }] }];
  assert.deepEqual(['P2', 'P4'].map(id => holds(rec(id), both, config)), [true, false]);
  const twoFields = [{ all: [{ field: 'client', equals: 'north' }, { field: 'match', below: 0.5 }] }];
  assert.deepEqual(['P1', 'P3'].map(id => holds(rec(id), twoFields, config)), [false, true]);
  const either = [{ field: 'match', at_least: 0.85 }, { field: 'client', equals: 'west' }];
  assert.deepEqual(['P1', 'P3', 'P6'].map(id => holds(rec(id), either, config)), [true, false, true]);
  const anyValueIn = [{ output: 'codes', values: ['C', 'X'] }];
  assert.deepEqual(['P1', 'P3', 'P6'].map(id => holds(rec(id), anyValueIn, config)), [false, true, true]);
});

test('hold-if: a value with no confidence never meets confidence_at_least', () => {
  const r = { id: 'n', route_class: 'auto', pred: { codes: [{ value: 'A', confidence: null, applied: false }] }, fields: {} };
  assert.equal(holds(r, [{ output: 'codes', confidence_at_least: 0 }], config), false);
  assert.equal(holds(r, [{ output: 'codes' }], config), true);
});

test('--hold-if: the quick form reads like the file form', () => {
  const p = text => parseHoldIf(text, config);
  assert.deepEqual(p('codes=B'), { output: 'codes', values: ['B'] });
  assert.deepEqual(p('codes=*'), { output: 'codes' });
  assert.deepEqual(p('codes=*@0.85'), { output: 'codes', confidence_at_least: 0.85 });
  assert.deepEqual(p('codes=A,B@0.9'), { output: 'codes', values: ['A', 'B'], confidence_at_least: 0.9 });
  assert.deepEqual(p('codes.unapplied=B'), { output: 'codes', values: ['B'], applied: false });
  assert.deepEqual(p('codes.applied=*'), { output: 'codes', applied: true });
  assert.deepEqual(p('field:client=south,west'), { field: 'client', in: ['south', 'west'] });
  assert.deepEqual(p('field:match<0.5'), { field: 'match', below: 0.5 });
  assert.deepEqual(p('field:match>=0.5'), { field: 'match', at_least: 0.5 });
  assert.deepEqual(p('field:client=south and codes=*@0.9'), { all: [{ field: 'client', in: ['south'] }, { output: 'codes', confidence_at_least: 0.9 }] });
  assert.deepEqual(p('codes=A and codes=B'), { all: [{ output: 'codes', values: ['A'] }, { output: 'codes', values: ['B'] }] });
  for (const bad of ['codes', 'nope=B', 'codes=B@high', 'codes=B@1.5', 'field:match<x', 'field:=a', 'codes.maybe=B', 'codes=B and ', 'codes=B and nope=C']) {
    assert.throws(() => p(bad), /--hold-if/, bad);
  }
});

// ---------- Certification across policies ----------

const C = policySweep(paired, config, policies, { target: 90 });
const sig = x => Number(x.toPrecision(4));

test('certification: every policy tried, as run included, tested on its own records (Bonferroni over 7)', () => {
  const c = C.certification;
  assert.deepEqual([c.target_pct, c.confidence, c.policies_tested], [90, 0.95, 7]);
  assert.equal(sig(c.level), 0.007143);
  assert.deepEqual(C.rows.map(r => sig(r.p_value)), [0.00856, 0.028, 0.028, 0.19, 0.001, 0.028, 0.00127]);
  assert.deepEqual(C.rows.filter(r => r.certified).map(r => r.name), ['South to a person', 'Cap each gate at 0.75']);
  assert.equal(c.best.name, 'Cap each gate at 0.75');
  assert.deepEqual(c.looks_under_alone, { name: 'Cap each gate at 0.75', high_pct: 70, certified: true });
  assert.equal(c.least_records_out, 3);
});

test('certification: the report names the loosest certified policy and says the policies flatter themselves', () => {
  const text = renderWhatif(C);
  assert.match(text, /CERTIFIED UNDER 90%  at 95% confidence, among 7 rows \(the run as it was and 6 policies\) tested/);
  assert.match(text, /The loosest certified policy is "Cap each gate at 0\.75": silent error rate 33\.3% \(2 of 6 out without review/);
  assert.match(text, /chosen on the same records/);
  assert.match(text, /rests on the assumption above/);
});

// ---------- Traps E10-E19 ----------

const read = (raw, cfg = baseConfig) => readPolicies(raw, cfg, 'policies.json');

test('E10: a policies file that is not { "policies": [...] } with at least one policy stops', () => {
  for (const raw of [[], {}, { policies: [] }, { policies: {} }, { rules: [] }]) assert.throws(() => read(raw), /\[E10\]/);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-pol-')), 'p.json');
  fs.writeFileSync(tmp, '{ not json');
  const bad = cli([...base, '--policies', tmp]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /\[E10\]/);
  fs.rmSync(path.dirname(tmp), { recursive: true });
});

test('E11: a policy without a name, with a duplicate name, or with no rule stops', () => {
  assert.throws(() => read({ policies: [{ hold_if: [{ output: 'codes' }] }] }), /\[E11\].*name/);
  assert.throws(() => read({ policies: [{ name: 'a', hold_if: [{ output: 'codes' }] }, { name: 'a', hold_if: [{ output: 'codes', value: 'B' }] }] }), /\[E11\].*"a" twice/);
  assert.throws(() => read({ policies: [{ name: 'empty' }] }), /\[E11\].*no rule/);
  assert.throws(() => read({ policies: [{ name: 'as run', hold_if: [{ output: 'codes' }] }] }), /\[E11\]/);
});

test('E12: a misspelt key, or a field condition with no comparison or two, stops', () => {
  assert.throws(() => read({ policies: [{ name: 'a', hold_if: [{ output: 'codes', confidence_atleast: 0.8 }] }] }), /\[E12\].*confidence_atleast/);
  assert.throws(() => read({ policies: [{ name: 'a', hold_if: [{ output: 'codes' }], hold: [] }] }), /\[E12\].*"hold"/);
  assert.throws(() => read({ policies: [{ name: 'a', hold_if: [{ field: 'match' }] }] }), /\[E12\].*one of equals, in, below, at_least/);
  assert.throws(() => read({ policies: [{ name: 'a', hold_if: [{ field: 'match', below: 0.5, at_least: 0.2 }] }] }), /\[E12\]/);
  assert.throws(() => read({ policies: [{ name: 'a', hold_if: [{ output: 'codes', confidence_at_least: 2 }] }] }), /\[E12\]/);
  assert.throws(() => read({ policies: [{ name: 'a', hold_if: [{ output: 'codes', value: 'A', values: ['B'] }] }] }), /\[E12\]/);
  assert.throws(() => read({ policies: [{ name: 'a', hold_if: [] }] }), /\[E12\]/);
  assert.throws(() => read({ policies: [{ name: 'a', hold_if: [{ all: [], output: 'codes' }] }] }), /\[E12\].*"all" stands alone/);
  assert.throws(() => read({ policies: [{ name: 'a', hold_if: [{ all: [{ field: 'match', under: 0.5 }] }] }] }), /\[E12\].*"under"/);
  for (const bad of [[null], [{ all: 5 }], [{ all: [null] }], ['codes=B']]) assert.throws(() => read({ policies: [{ name: 'a', hold_if: bad }] }), /\[E12\]/);
});

test('E13: a condition or threshold change on an output that does not exist, is the route, or has no gate stops', () => {
  assert.throws(() => read({ policies: [{ name: 'a', hold_if: [{ output: 'code' }] }] }), /\[E13\].*"code"/);
  const routed = validateConfig({ outputs: { verdict: { type: 'label', field: 'decision', labels: ['A', 'R'] } }, routing: { field: 'decision', map: { A: 'auto', R: 'review' } } }).config;
  assert.throws(() => read({ policies: [{ name: 'a', hold_if: [{ output: 'verdict', value: 'A' }] }] }, routed), /\[E13\].*route/);
  assert.throws(() => read({ policies: [{ name: 'a', auto_publish: { nope: 0.8 } }] }), /\[E13\]/);
  const ungated = validateConfig({ outputs: { codes: { type: 'set' } }, routing: { map: { A: 'auto' } } }).config;
  assert.throws(() => read({ policies: [{ name: 'a', auto_publish_cap: { codes: 0.8 } }] }, ungated), /\[E13\].*no auto_publish/);
});

const dataProblems = (pols, records = paired, mode = 'strict') => {
  const p = problems(mode);
  checkPolicyData(read({ policies: pols }), records, config, p);
  return p.items;
};

test('E14: a value no record states for that output is probably misspelt (strict; --lenient warns)', () => {
  const items = dataProblems([{ name: 'a', hold_if: [{ output: 'codes', value: 'AWARD' }] }]);
  assert.deepEqual(items.map(i => [i.trap, i.level]), [['E14', 'stop']]);
  assert.match(items[0].message, /"AWARD"/);
  assert.deepEqual(dataProblems([{ name: 'a', hold_if: [{ output: 'codes', value: 'AWARD' }] }], paired, 'lenient').map(i => i.level), ['warn']);
  assert.deepEqual(dataProblems([{ name: 'a', hold_if: [{ output: 'codes', value: 'X' }] }]), []);
});

test('E15: a field no record has stops; a field some records lack is strict', () => {
  const cfg = policyFields(baseConfig, read({ policies: [{ name: 'a', hold_if: [{ field: 'matc', below: 0.5 }] }] }));
  const recs = scoreRun({ config: cfg, predPath: files.pred, keyPath: files.key }).paired;
  const p = problems('lenient');
  checkPolicyData(read({ policies: [{ name: 'a', hold_if: [{ field: 'matc', below: 0.5 }] }] }), recs, cfg, p);
  assert.deepEqual(p.items.map(i => [i.trap, i.level]), [['E15', 'stop']]);
  const partial = paired.map(r => (r.id === 'P2' ? { ...r, fields: { ...r.fields, match: undefined } } : r));
  const items = dataProblems([{ name: 'a', hold_if: [{ field: 'match', below: 0.5 }] }], partial);
  assert.deepEqual(items.map(i => [i.trap, i.level]), [['E15', 'stop']]);
  assert.ok(items[0].strict);
  assert.match(items[0].message, /P2/);
});

test('E16: below or at_least on a field that is not a number is strict, and that record is not held', () => {
  const texty = paired.map(r => (r.id === 'P3' ? { ...r, fields: { ...r.fields, match: 'low' } } : r));
  const items = dataProblems([{ name: 'a', hold_if: [{ field: 'match', below: 0.5 }] }], texty);
  assert.deepEqual(items.map(i => [i.trap, i.strict]), [['E16', true]]);
  assert.equal(holds(texty.find(r => r.id === 'P3'), [{ field: 'match', below: 0.5 }], config), false);
});

test('E17: a condition that reads the answer key stops: a routing policy can only use what the workflow knew', () => {
  assert.throws(() => read({ policies: [{ name: 'a', hold_if: [{ field: 'verdict', equals: 'REVIEW' }] }] }), /\[E17\].*answer key/);
  assert.throws(() => parseHoldIf('field:verdict=REVIEW', config), /\[E17\]/);
});

test('E18: a per-record threshold that is missing or not a number from 0 to 1 is strict; --lenient leaves the record where it was', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-pol-'));
  const preds = JSON.parse(fs.readFileSync(files.pred, 'utf8'));
  delete preds[2].gate;
  preds[3].gate = 1.5;
  fs.writeFileSync(path.join(tmp, 'p.json'), JSON.stringify(preds));
  assert.throws(() => scoreRun({ config: baseConfig, predPath: path.join(tmp, 'p.json'), keyPath: files.key }), /\* \[E18\][^\n]*P3[\s\S]*\[E18\][^\n]*P4/);
  const r = scoreRun({ config: baseConfig, predPath: path.join(tmp, 'p.json'), keyPath: files.key, mode: 'lenient' });
  assert.deepEqual(r.problems.filter(i => i.trap === 'E18').map(i => i.level), ['warn', 'warn']);
  const p3 = r.paired.find(x => x.id === 'P3');
  assert.equal(gatePasses(p3, baseConfig), null);
  fs.rmSync(tmp, { recursive: true });
  // A field name that is not a path is refused by the config.
  assert.match(validateConfig({ outputs: { codes: { type: 'set' } }, routing: { map: { A: 'auto' } }, thresholds: { auto_publish: { codes: '' } } }).errors.join(), /auto_publish\.codes/);
});

test('E19: confidence_at_least on an output whose values never carry a confidence holds nothing (strict)', () => {
  const noConf = paired.map(r => ({ ...r, pred: { codes: r.pred.codes.map(v => ({ ...v, confidence: null })) } }));
  const items = dataProblems([{ name: 'a', hold_if: [{ output: 'codes', confidence_at_least: 0.5 }] }], noConf);
  assert.deepEqual(items.map(i => [i.trap, i.strict]), [['E19', true]]);
});

// ---------- The command line ----------

test('whatif --policies and --hold-if on the command line, terminal and JSON', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-pol-')), 'w.json');
  const ok = cli([...base, '--policies', files.policies, '--hold-if', 'field:client=south', '--json', out]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /WHAT-IF: POLICIES/);
  assert.match(ok.stdout, /^ +South to a person +0\.0% \(0\/3\) +3 \(37\.5%\) +1$/m);
  assert.match(ok.stdout, /^ +hold if field:client=south +0\.0% \(0\/3\) +3 /m);
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(j.kind, 'policies');
  assert.equal(j.rows.length, 8);
  assert.deepEqual(j.rows[7].held, ['P2', 'P4']);
  fs.rmSync(path.dirname(out), { recursive: true });

  const t = cli([...base, '--policies', files.policies, '--target', '90']);
  assert.equal(t.status, 0, t.stderr);
  assert.match(t.stdout, /loosest certified policy is "Cap each gate at 0\.75"/);

  const refused = [
    [['--policies', files.policies, '--gate'], /exactly one of --gate, --floor or --policies/],
    [['--hold-if', 'codes'], /--hold-if/],
    [['--floor', '--hold-if', 'codes=B'], /--hold-if goes with --policies or alone/],
    [['--hold-if', 'codes=B', '--from', '0.6'], /--from go\(es\) with --gate or --floor/],
  ];
  for (const [args, message] of refused) {
    const bad = cli([...base, ...args]);
    assert.equal(bad.status, 1, args.join(' '));
    assert.match(bad.stderr, message);
  }
});

test('policies: a threshold change comes first, then hold-if, so a held record stays with a person', () => {
  const pol = read({ policies: [{ name: 'cap and hold', auto_publish_cap: { codes: 0.75 }, hold_if: [{ field: 'match', below: 0.5 }] }] });
  const r = policySweep(paired, config, pol).rows[1];
  // The cap releases P5 (0.75 at a cap of 0.75); the hold then sends P2 and P3 to a person.
  assert.deepEqual([r.through, r.held, r.moved_in, r.moved_out, r.exact], [['P1', 'P4', 'P5', 'P8'], ['P2', 'P3'], ['P5'], ['P2', 'P3'], false]);
});

test('hold-if needs no gate: a config without thresholds can ask whether sending weak matches to a person pays off', () => {
  const cfg = validateConfig({ outputs: { answer: { type: 'label', labels: ['yes', 'no'] } }, routing: { field: 'route', map: { send: 'auto', check: 'review' } } }).config;
  const rec = (id, route, value, key, strength) => ({ id, route, route_class: route === 'send' ? 'auto' : 'review', gold_route: null, gold_class: null, scored: true,
    movable: null, traps: [], duplicate_of: null, pred: { answer: { value, confidence: null, applied: true, inherited: false } }, key: { answer: key }, fields: { match_strength: strength } });
  const records = [rec('Q1', 'send', 'yes', 'yes', 'strong'), rec('Q2', 'send', 'no', 'yes', 'weak'), rec('Q3', 'send', 'yes', 'yes', 'weak'), rec('Q4', 'check', 'no', 'no', 'strong')];
  const w = policySweep(records, policyFields(cfg, []), [{ name: 'weak to a person', hold_if: [{ field: 'match_strength', in: ['weak', 'none'] }], auto_publish: null, auto_publish_cap: null }]);
  const r = w.rows[1];
  assert.deepEqual([frac(w.rows[0].silent_error_rate), frac(r.silent_error_rate), r.held, r.wasted_reviews], ['1/3', '0/1', ['Q2', 'Q3'], ['Q3', 'Q4']]);
  assert.doesNotMatch(w.assumption, /gate what-if/);
});

test('per-record thresholds: calibration checks each claim against its own record\'s threshold', () => {
  // At or above their own gate: P1 A, P2 A, P3 C, P4 A (wrong), P7 X, P8 B. Below: P2 B, P5 B, P6 C, P6 A.
  const R = scoreRun({ config: baseConfig, predPath: files.pred, keyPath: files.key });
  const g = R.calibration.thresholds.find(t => t.name === 'auto_publish');
  assert.deepEqual([g.threshold, g.at_or_above.n, g.at_or_above.d], ['each record\'s own "gate"', 5, 6]);
});

// ---------- Fixes from an independent review ----------

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-pol-'));
const writeJson = (dirName, name, x) => { const f = path.join(dirName, name); fs.writeFileSync(f, JSON.stringify(x)); return f; };

test('review 1: a threshold written as text that reads as a number is refused, as E2 refuses a confidence', () => {
  const errs = validateConfig({ outputs: { codes: { type: 'set' } }, routing: { map: { A: 'auto' } }, thresholds: { auto_publish: { codes: '0.8' } } }).errors;
  assert.match(errs.join(), /auto_publish\.codes is the text "0\.8": write the number without quotes/);
});

test('review 2: a policy that changes a threshold runs the gate check, and the report says when it fails', () => {
  const off = paired.map(r => (r.id === 'P5' || r.id === 'P6' ? { ...r, route: 'AUTO', route_class: 'auto' } : r));
  const w = policySweep(off, config, read({ policies: [{ name: 'Gate 0.90', auto_publish: { codes: 0.9 } }] }));
  assert.deepEqual([w.check.movable, w.check.reproduced, w.check.differing], [7, 5, ['P5', 'P6']]);
  assert.match(renderWhatif(w), /CHECK FAILED: at the config's gates the simulation routes 2 of 7 movable records differently from the actual run \(P5 P6\)/);
  assert.equal(policySweep(paired, config, read({ policies: [{ name: 'h', hold_if: [{ output: 'codes' }] }] })).check, null);
  assert.match(renderWhatif(policySweep(paired, config, read({ policies: [{ name: 'Gate 0.90', auto_publish: { codes: 0.9 } }] }))),
    /Check: at the config's gates the simulation reproduces the actual route of all 7 movable records/);
});

test('review 3: per-record thresholds from a CSV are read as numbers', () => {
  const R = scoreRun({ config: baseConfig, predPath: path.join(dir, 'predictions.csv'), keyPath: files.key });
  assert.deepEqual(R.paired.map(r => r.fields.gate), [0.9, 0.9, 0.8, 0.8, 0.8, 0.9, 0.9, 0.9]);
  assert.deepEqual(R.problems.filter(i => i.trap === 'E18'), []);
  assert.deepEqual(gateSweep(R.paired, baseConfig).check, { threshold: null, own: 'gate', movable: 7, reproduced: 7, differing: [] });
});

test('review 3: a JSON threshold written as numeric text is read as the number, with a clean-up note', () => {
  const t = tmpDir();
  const preds = JSON.parse(fs.readFileSync(files.pred, 'utf8'));
  preds[0].gate = '0.9';
  const R = scoreRun({ config: baseConfig, predPath: writeJson(t, 'p.json', preds), keyPath: files.key });
  assert.equal(R.paired[0].fields.gate, 0.9);
  assert.deepEqual(R.problems.filter(i => i.trap === 'E18').map(i => i.level), ['fix']);
  fs.rmSync(t, { recursive: true });
});

test('review 3: the gate check reports records whose gate is unknown as not checked, and whatif shows load warnings', () => {
  const unknown = paired.map(r => (r.id === 'P3' ? { ...r, fields: {} } : r));
  const g = gateSweep(unknown, config);
  assert.deepEqual([g.check.movable, g.check.reproduced, g.check.differing, g.check.not_checked], [7, 6, [], ['P3']]);
  assert.match(renderWhatif(g), /1 movable record could not be checked \(a confidence or threshold is missing\): P3/);
  const t = tmpDir();
  const preds = JSON.parse(fs.readFileSync(files.pred, 'utf8'));
  delete preds[2].gate;
  const r = cli(['whatif', '--config', files.config, '--pred', writeJson(t, 'p.json', preds), '--key', files.key, '--gate', '--lenient']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /WARNINGS AND CLEAN-UPS\n  warn \[E18\][^\n]*P3/);
  fs.rmSync(t, { recursive: true });
});

test('review 4: hold-if values are read through the config\'s equivalents (D23)', () => {
  const eq = validateConfig({ ...JSON.parse(fs.readFileSync(files.config, 'utf8')), equivalents: { codes: [['B', 'B-old']] } }).config;
  const p = problems('strict');
  const pol = readPolicies({ policies: [{ name: 'a', hold_if: [{ output: 'codes', value: 'B-old' }] }] }, eq, 'policies.json', p);
  assert.deepEqual(pol[0].hold_if[0].values, ['B']);
  assert.deepEqual(p.items.map(i => [i.trap, i.level]), [['D23', 'fix']]);
  assert.deepEqual(parseHoldIf('codes=B-old', eq).values, ['B']);
  assert.deepEqual(policySweep(paired, eq, pol).rows[1].held, ['P2', 'P8']);
});

test('review 5: "moved by the gate" counts the records the threshold change moved, before any hold', () => {
  const pol = read({ policies: [{ name: 'cap then hold', auto_publish_cap: { codes: 0.75 }, hold_if: [{ field: 'match', at_least: 0.8 }] }] });
  const r = policySweep(paired, config, pol).rows[1];
  assert.deepEqual([r.moved_by_gate, r.held, r.moved_in, r.moved_out], [['P5'], ['P1', 'P5'], [], ['P1']]);
  assert.match(renderWhatif(policySweep(paired, config, pol)), /held 2 · moved by the gate 1/);
});

test('review 6: a field value no record has is probably misspelt (strict), naming the policy each time', () => {
  const items = dataProblems([{ name: 'a', hold_if: [{ field: 'client', in: ['nort', 'south'] }] }, { name: 'b', hold_if: [{ field: 'client', equals: 'nort' }] }]);
  assert.deepEqual(items.map(i => [i.trap, i.where, i.strict]), [['E14', 'policy "a"', true], ['E14', 'policy "b"', true]]);
  assert.match(items[0].message, /no record has "nort" in client/);
});

test('review 6: --hold-if reads " AND " in any case, and refuses == <= and > with a clear message', () => {
  assert.deepEqual(parseHoldIf('field:client=north AND codes=*', config), { all: [{ field: 'client', in: ['north'] }, { output: 'codes' }] });
  assert.throws(() => parseHoldIf('field:client==north', config), /--hold-if.*use < or >=/);
  assert.throws(() => parseHoldIf('field:client=north,<west', config), /--hold-if.*"<west" holds an operator/);
  assert.throws(() => parseHoldIf('field:match<=0.5', config), /use < or >=/);
  assert.throws(() => parseHoldIf('field:match>0.5', config), /use < or >=/);
});

test('review 6: equals and in compare numbers as numbers and true/false in any case', () => {
  const r = { id: 'x', route_class: 'auto', pred: { codes: [] }, fields: { rate: 0.9, flag: true, word: 'North', text: '0.90' } };
  const h = c => holds(r, [c], config);
  assert.deepEqual([h({ field: 'rate', equals: '0.90' }), h({ field: 'text', equals: 0.9 }), h({ field: 'flag', equals: 'TRUE' }), h({ field: 'flag', in: ['false'] }),
    h({ field: 'word', equals: 'north' }), h({ field: 'word', equals: 'North' })], [true, true, true, false, false, true]);
});

test('review: a declared label no record states is a known value; a declined label counts as a stated value', () => {
  const cfg = validateConfig({ id_field: 'id', outputs: { category: { type: 'label', labels: ['news', 'other'], decline: { values: ['none'] } } },
    routing: { field: 'outcome', map: { WRITTEN: 'auto', LEFT_OUT: 'block' } } }).config;
  const rec = (id, value, declined) => ({ id, route_class: 'auto', pred: { category: { value, declined, confidence: 0.9, applied: !declined } }, key: {}, fields: {} });
  const records = [rec('A', 'news', false), rec('B', '(declined)', true)];
  const p = problems('strict');
  checkPolicyData(readPolicies({ policies: [{ name: 'a', hold_if: [{ output: 'category', value: 'other' }] }] }, cfg, 'p'), records, cfg, p);
  assert.deepEqual(p.items.filter(i => i.trap === 'E14'), []);
  assert.deepEqual(records.map(r => holds(r, [{ output: 'category' }], cfg)), [true, true]);
});

test('review: E18 only for records the gate could route; a threshold under the floor warns', () => {
  const t = tmpDir();
  const preds = JSON.parse(fs.readFileSync(files.pred, 'utf8'));
  delete preds[6].gate;   // P7, blocked
  assert.deepEqual(scoreRun({ config: baseConfig, predPath: writeJson(t, 'p.json', preds), keyPath: files.key }).problems.filter(i => i.trap === 'E18'), []);
  fs.rmSync(t, { recursive: true });
  const floored = { ...baseConfig, thresholds: { ...baseConfig.thresholds, floor: 0.85 } };
  const w = scoreRun({ config: floored, predPath: files.pred, keyPath: files.key }).problems.filter(i => i.trap === 'E18');
  assert.deepEqual(w.map(i => i.level), ['warn']);
  assert.match(w[0].message, /3 record\(s\) have their own gate threshold below thresholds\.floor \(0\.85\): P3, P4, P5/);
});

test('review: policy-file values are trimmed; "*" means any value; "As Run" and a non-text name are refused', () => {
  const pol = read({ policies: [{ name: 'a', hold_if: [{ output: 'codes', value: ' B ' }, { output: 'codes', value: '*' }, { field: 'client', in: [' south '] }] }] });
  assert.deepEqual(pol[0].hold_if, [{ output: 'codes', values: ['B'] }, { output: 'codes' }, { field: 'client', in: ['south'] }]);
  assert.throws(() => read({ policies: [{ name: 'a', hold_if: [{ output: 'codes', values: ['*', 'B'] }] }] }), /\[E12\].*"\*"/);
  assert.throws(() => read({ policies: [{ name: 'As Run', hold_if: [{ output: 'codes' }] }] }), /\[E11\].*as run/i);
  assert.throws(() => read({ policies: [{ name: 5, hold_if: [{ output: 'codes' }] }] }), /\[E11\].*"name" must be text, got number/);
});

test('review: a field condition on the route itself stops (E13): it would read the route before the policy', () => {
  assert.throws(() => read({ policies: [{ name: 'a', hold_if: [{ field: 'decision', equals: 'AUTO' }] }] }), /\[E13\].*route/);
});

test('review: the HTML report escapes a per-record threshold\'s name', () => {
  const R = scoreRun({ config: baseConfig, predPath: files.pred, keyPath: files.key });
  const html = require('../src/report/html.js').renderHtml(R);
  assert.match(html, /Gate on codes at each record&#39;s own &quot;gate&quot;/);
});

test('review: a workflow with no route to a person is warned that held records go to a review step it does not have', () => {
  const cfg = validateConfig({ outputs: { codes: { type: 'set' } }, routing: { map: { A: 'auto', B: 'block' } } }).config;
  const p = problems('strict');
  const recs = [{ id: 'x', route_class: 'auto', pred: { codes: [{ value: 'B', confidence: 0.9, applied: true }] }, key: { codes: ['B'] }, fields: {} }];
  checkPolicyData(readPolicies({ policies: [{ name: 'a', hold_if: [{ output: 'codes' }] }] }, cfg, 'p'), recs, cfg, p);
  assert.deepEqual(p.items.map(i => [i.trap, i.level]), [['E13', 'warn']]);
  assert.match(p.items[0].message, /no decision in routing\.map sends a record to a person/);
});

// The exactness invariant beyond the 8-record fixture: on the compliance golden 500 (each policy
// in its policies.json) and the tiny fixture (holding everything that states a value).
test('review: hold-if is exact on the compliance golden 500 and the tiny fixture too', () => {
  const strip = j => { const { route, route_class, silent, safeguards, wasted_review, routed_correctly, ...rest } = j; return rest; };
  const check = (records, cfg, pols) => {
    const before = judgeAll(records, cfg);
    for (const pol of pols) {
      const held = new Set(policySweep(records, cfg, [pol]).rows[1].held);
      assert.ok(held.size > 0, pol.name);
      const after = judgeAll(records.map(r => (held.has(r.id) ? { ...r, route_class: 'review', route: '(held)' } : r)), cfg);
      after.forEach((a, i) => {
        if (held.has(a.id)) assert.deepEqual(strip(a), strip(before[i]), pol.name + ' ' + a.id);
        else assert.deepEqual(a, before[i], pol.name + ' ' + a.id);
        assert.ok(!a.silent || before[i].silent);
      });
    }
  };
  const C = path.join(__dirname, '..', 'examples', 'compliance-reviewer');
  const ccfg = loadConfig(path.join(C, 'config.json'));
  const run = path.join(C, 'golden500', 'exec-67.harness.json');
  check(scoreRun({ config: ccfg, predPath: run, keyPath: run }).paired, ccfg, read({ policies: JSON.parse(fs.readFileSync(path.join(C, 'policies.json'), 'utf8')).policies }, ccfg));
  const T = path.join(__dirname, 'fixtures', 'tiny');
  const tcfg = loadConfig(path.join(T, 'config.json'));
  const outs = Object.keys(tcfg.outputs).filter(o => !(tcfg.outputs[o].type !== 'set' && tcfg.outputs[o].field === tcfg.routing.field));
  check(scoreRun({ config: tcfg, predPath: path.join(T, 'predictions.json'), keyPath: path.join(T, 'key.json') }).paired, tcfg,
    [{ name: 'anything', hold_if: outs.map(o => ({ output: o })), auto_publish: null, auto_publish_cap: null }]);
});
