// Policy what-ifs and score reports, after a newcomer used them end to end from the docs
// (a support-ticket triage agent). Checked against test/fixtures/policy/EXPECTED.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, validateConfig } = require('../src/config.js');
const { scoreRun } = require('../src/score.js');
const { readPolicies, policyFields, checkPolicyData, parseHoldIf } = require('../src/policy.js');
const { policySweep } = require('../src/metrics/policy.js');
const { renderWhatif, renderTerminal } = require('../src/report/terminal.js');
const { renderHtml } = require('../src/report/html.js');
const { problems } = require('../src/problems.js');

const dir = path.join(__dirname, 'fixtures', 'policy');
const files = { config: path.join(dir, 'config.json'), pred: path.join(dir, 'predictions.json'), key: path.join(dir, 'key.json') };
const raw = JSON.parse(fs.readFileSync(files.config, 'utf8'));
const baseConfig = loadConfig(files.config);
const fixturePolicies = JSON.parse(fs.readFileSync(path.join(dir, 'policies.json'), 'utf8')).policies;
const read = (pols, cfg = baseConfig) => readPolicies({ policies: pols }, cfg, 'policies.json');
const run = (cfg, pols, opts) => {
  const c = policyFields(cfg, pols);
  const { paired } = scoreRun({ config: c, predPath: files.pred, keyPath: files.key });
  return { c, paired, w: policySweep(paired, c, pols, opts) };
};
const withPreds = (change, fn) => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-nc-'));
  const preds = JSON.parse(fs.readFileSync(files.pred, 'utf8'));
  change(preds);
  const f = path.join(t, 'p.json');
  fs.writeFileSync(f, JSON.stringify(preds));
  try { return fn(f); } finally { fs.rmSync(t, { recursive: true }); }
};

test('newcomer 1: E18 names the threshold it read, and suggests 0.85 for 85', () => {
  withPreds(p => { p[0].gate = 1.2; p[1].gate = 85; }, f => {
    assert.throws(() => scoreRun({ config: baseConfig, predPath: f, keyPath: files.key }),
      e => /P1: its own gate threshold "gate" is 1\.2; it must be a number from 0 to 1 \(thresholds/.test(e.message) &&
        /P2: its own gate threshold "gate" is 85; it must be a number from 0 to 1 \(a percentage\? write 0\.85\)/.test(e.message));
  });
});

test('newcomer 2: a field a key-side group also reads is the prediction\'s own when the predictions have it', () => {
  const grouped = validateConfig({ ...raw, groups: { client: { field: 'client' } } }).config;
  const pols = read([{ name: 'south', hold_if: [{ field: 'client', equals: 'south' }] }], grouped);
  assert.deepEqual(parseHoldIf('field:client=south', grouped), { field: 'client', in: ['south'] });
  const { c, paired, w } = run(grouped, pols);
  const p = problems('strict');
  checkPolicyData(pols, paired, c, p);
  assert.deepEqual(p.items, []);
  assert.deepEqual(w.rows[1].held, ['P2', 'P4']);
});

test('newcomer 2: a field only the answer key has stops (E17), naming groups.<name>.from "predictions"', () => {
  const grouped = validateConfig({ ...raw, groups: { region: { field: 'region' } } }).config;
  const pols = read([{ name: 'r', hold_if: [{ field: 'region', equals: 'east' }] }], grouped);
  const { c, paired } = run(grouped, pols);
  const p = problems('lenient');
  checkPolicyData(pols, paired, c, p);
  assert.deepEqual(p.items.map(i => [i.trap, i.level]), [['E17', 'stop']]);
  assert.match(p.items[0].message, /only the answer key has "region".*groups\.region\.from: "predictions"/);
});

test('newcomer 3: a policy that holds and moves nothing is named, not left to look like a result', () => {
  const pols = read([{ name: 'Nothing B at 0.99', hold_if: [{ output: 'codes', value: 'B', confidence_at_least: 0.99 }] }, fixturePolicies[0]]);
  const { w } = run(baseConfig, pols);
  assert.deepEqual(w.changes_nothing, ['Nothing B at 0.99']);
  assert.match(renderWhatif(w), /"Nothing B at 0\.99" holds and moves no record: it is the run as it was\. Check its conditions\./);
});

test('newcomer 3: applied/unapplied on an output with nothing stated but not applied holds nothing (strict, E19)', () => {
  const cfg = validateConfig({ id_field: 'id', outputs: { category: { type: 'label', labels: ['news', 'other'] } }, routing: { field: 'outcome', map: { W: 'auto', R: 'review' } } }).config;
  const recs = [{ id: 'A', route_class: 'auto', pred: { category: { value: 'news', confidence: 0.9, applied: true } }, key: {}, fields: {} }];
  const p = problems('strict');
  checkPolicyData(readPolicies({ policies: [{ name: 'u', hold_if: [{ output: 'category', applied: false }] }] }, cfg, 'p'), recs, cfg, p);
  assert.deepEqual(p.items.map(i => [i.trap, i.strict]), [['E19', true]]);
  assert.match(p.items[0].message, /no value of category is stated without being applied in this run/);
});

test('newcomer 4: the policies report fits in 100 columns, with every figure still there', () => {
  const pols = read([...fixturePolicies, { name: 'A policy with a long name that runs past forty characters', hold_if: [{ field: 'match', below: 0.5 }] }]);
  const { w } = run(baseConfig, pols, { target: 90 });
  const text = renderWhatif(w);
  const wide = text.split('\n').filter(l => /\S {2,}\S/.test(l) && l.length > 100);
  assert.deepEqual(wide, []);
  // The South row's figures, all of them.
  assert.match(text, /South to a person/);
  for (const bit of ['0.0% (0 of 3)', 'likely 0.0-56.2%', 'straight-through 37.5% (3 of 8)', 'silent omissions 0.0% (0 of 7)', 'unnecessary reviews 1',
    'review precision 75.0% (3 of 4)', 'held 2', 'moved by the gate 0', 'silent errors -2 (fixed 2, new 0;']) assert.ok(text.includes(bit), bit);
  assert.match(text, /A policy with a long name that runs past forty characters/);
});

test('newcomer 5: the loosest certified policy is flagged when it lets out more silent errors than the run as it was', () => {
  const pols = read([{ name: 'Gate 0.50 for every record', auto_publish: { codes: 0.5 } }]);
  const { w } = run(baseConfig, pols, { target: 90 });
  assert.equal(w.certification.best.name, 'Gate 0.50 for every record');
  assert.match(renderWhatif(w), /The loosest certified policy is "Gate 0\.50 for every record"[^\n]*\n  [^\n]*But paired with the run as it was, it lets out 1 more silent error \(fixed 0, new 1; unclear\)/);
});

test('newcomer 6: score shows what the answer key says beside a wrong label, in the terminal and the HTML', () => {
  const D = path.join(__dirname, 'fixtures', 'declines');
  const R = scoreRun({ config: loadConfig(path.join(D, 'config.json')), predPath: path.join(D, 'predictions.json'), keyPath: path.join(D, 'key.json') });
  assert.match(renderTerminal(R), /category {2}applied, not in the answer key: news for awards/);
  assert.match(renderHtml(R), /category applied, not in the answer key: <code>news for awards<\/code>/);
  // The results file is unchanged: the key's label is added only where it is shown.
  assert.deepEqual(R.records.find(r => r.id === 'L3').differences.wrong, { category: ['news'] });
});

// Regression (E17): one combined file passed as both --pred and --key carries the key's fields on
// every prediction record, so a key-side group's field is the answer key's there, never the
// workflow's. Split into two files, the predictions do not have it, and E17 stops as well.
test('E17: a key-side group field stops when the predictions and the key are one file, and when only the key has it', () => {
  const { spawnSync } = require('node:child_process');
  const C = path.join(__dirname, 'fixtures', 'policy', 'combined');
  const cli = args => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wfeval.js'), 'whatif', '--config', path.join(C, 'config.json'), ...args, '--hold-if', 'field:expected.hard=yes'], { encoding: 'utf8' });
  const one = cli(['--pred', path.join(C, 'combined.json'), '--key', path.join(C, 'combined.json')]);
  assert.equal(one.status, 1, one.stdout);
  assert.match(one.stderr, /\[E17\][^\n]*the predictions and the answer key are one file, so "expected\.hard" is the answer key's \(groups\.hard\.from is "key"\)/);
  // The same file under another name (same content) is still one file.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-nc-'));
  fs.copyFileSync(path.join(C, 'combined.json'), path.join(t, 'copy.json'));
  const copy = cli(['--pred', path.join(C, 'combined.json'), '--key', path.join(t, 'copy.json')]);
  fs.rmSync(t, { recursive: true });
  assert.equal(copy.status, 1, copy.stdout);
  assert.match(copy.stderr, /\[E17\]/);
  const split = cli(['--pred', path.join(C, 'pred.json'), '--key', path.join(C, 'key.json')]);
  assert.equal(split.status, 1, split.stdout);
  assert.match(split.stderr, /\[E17\][^\n]*only the answer key has "expected\.hard"/);
  // As a function: the caller says the files are one.
  const cfg = loadConfig(path.join(C, 'config.json'));
  const pols = readPolicies({ policies: [{ name: 'hard', hold_if: [{ field: 'expected.hard', equals: 'yes' }] }] }, cfg, 'p');
  const c = policyFields(cfg, pols);
  const { paired } = scoreRun({ config: c, predPath: path.join(C, 'combined.json'), keyPath: path.join(C, 'combined.json') });
  const p = problems('lenient');
  checkPolicyData(pols, paired, c, p, { sameFile: true });
  assert.deepEqual(p.items.map(i => [i.trap, i.level]), [['E17', 'stop']]);
});
