// No report and no stop ever prints NaN, undefined or [object Object]. A wrong operator, or a field
// a line expects and no longer finds, shows up in the text as one of those words long before anyone
// reads the line closely. So every report section and stop message below is reached once, and only
// that is asserted: the wording is free to change. The mutation run (docs/ENGINEERING.md) showed
// that many lines of report text could break this way with every other test still passing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const WFEVAL = path.join(ROOT, 'bin', 'wfeval.js');
const cli = (args, cwd = ROOT) => spawnSync(process.execPath, [WFEVAL, ...args], { cwd, encoding: 'utf8' });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-nonan-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
function folder(files) {
  const dir = fs.mkdtempSync(path.join(tmp, 'f-'));
  for (const [name, x] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof x === 'string' ? x : JSON.stringify(x));
  return dir;
}
const read = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
// No word boundaries: a broken join glues NaN to the next word.
const BROKEN = /NaN|undefined|\[object Object\]/;
const FX = 'test/fixtures/';
const fixture = (name, pred = 'predictions.json', key = 'key.json') => ['--config', FX + name + '/config.json', '--pred', FX + name + '/' + pred, '--key', FX + name + '/' + key];

// Each report once: a label and the command.
const REPORTS = [
  ['score, every section', ['score', ...fixture('tiny'), '--target', '10']],
  ['score, groups', ['score', ...fixture('queue'), '--group-by', 'channel']],
  ['score, clusters and a mix', ['score', ...fixture('clusters'), '--group-by', 'section', '--mix', FX + 'clusters/mix.json']],
  ['score, declines', ['score', ...fixture('declines')]],
  ['score, alternatives', ['score', ...fixture('alternatives')]],
  ['score, ordinal', ['score', ...fixture('ordinal')]],
  ['score, rulings', ['score', ...fixture('rulings'), '--rulings', FX + 'rulings/rulings.json']],
  ['score, a split, looked at', ['score', ...fixture('split', 'predictions-v2.json'), '--target', '40', '--held-out']],
  ['score, the held-out half listed', ['score', ...fixture('split', 'predictions-v2.json'), '--target', '40', '--show-held-out']],
  ['score, safeguard failures', ['score', '--config', FX + 'split/gate.json', '--pred', FX + 'split/gate-sg.json', '--key', FX + 'gate/key.json']],
  ['check, with files', ['check', ...fixture('tiny')]],
  ['variance', ['variance', '--config', 'examples/compliance-reviewer/config.json', '--key', 'examples/compliance-reviewer/key.json',
    ...[56, 57, 58, 59].map(n => 'examples/compliance-reviewer/runs/exec-' + n + '.harness.json')]],
  ['variance, runs that differ', ['variance', '--config', FX + 'tiny/config.json', '--key', FX + 'tiny/key.json', ...['a', 'b', 'c'].map(n => FX + 'runs/run-' + n + '.json')]],
  ['variance, rulings', ['variance', '--config', FX + 'rulings/config.json', '--key', FX + 'rulings/key.json', '--rulings', FX + 'rulings/rulings.json',
    FX + 'rulings/predictions.json', FX + 'rulings/predictions.json']],
  ['variance, a split', ['variance', '--config', FX + 'split/config.json', '--key', FX + 'split/key.json', '--held-out',
    FX + 'split/predictions.json', FX + 'split/predictions-v2.json']],
  ['variance, the held-out half listed', ['variance', '--config', FX + 'split/config.json', '--key', FX + 'split/key.json', '--show-held-out',
    FX + 'split/predictions.json', FX + 'split/predictions-v2.json']],
  ['compare, the held-out half listed', ['compare', '--config', FX + 'split/config.json', '--key', FX + 'split/key.json', '--before', FX + 'split/predictions.json', '--after', FX + 'split/predictions-v2.json', '--show-held-out']],
  ['compare', ['compare', '--config', FX + 'queue/config.json', '--key', FX + 'queue/key.json', '--before', FX + 'queue/predictions.json', '--after', FX + 'queue/predictions-after.json']],
  ['compare, a split', ['compare', '--config', FX + 'split/config.json', '--key', FX + 'split/key.json', '--before', FX + 'split/predictions.json', '--after', FX + 'split/predictions-v2.json', '--held-out']],
  ['whatif, gate', ['whatif', ...fixture('gate'), '--gate', '--target', '30']],
  ['whatif, floor', ['whatif', ...fixture('tiny'), '--floor']],
  ['whatif, policies', ['whatif', ...fixture('policy'), '--policies', FX + 'policy/policies.json', '--target', '30']],
  ['rate', ['rate', '2', '15', '--target', '5']],
  ['rate, a perfect run', ['rate', '0', '15', '--target', '5']],
  ['estimate', ['estimate', '--config', FX + 'estimate/config.json', '--pred', FX + 'estimate/predictions.json', '--judge-key', FX + 'estimate/judge-key.json',
    '--key', FX + 'estimate/person-key.json', '--target', '60']],
  ['estimate --pick', ['estimate', '--config', FX + 'estimate/config.json', '--pred', FX + 'estimate/predictions.json', '--judge-key', FX + 'estimate/judge-key.json', '--pick', '10', '--seed', '1']],
  ['monitor', ['monitor', '--counts', FX + 'monitor/counts.csv', '--target', '5']],
  ['monitor, segments', ['monitor', '--counts', FX + 'monitor-segments/counts.csv', '--segment-by', 'segment', '--segments', 'chat,email,phone', '--target', '5', '--acceptable', '2.5']],
  ['monitor, segments from run files', ['monitor', '--config', FX + 'monitor-segments/config.json', ...['40', '41', '42'].map(w => FX + 'monitor-segments/runs/2026-W' + w + '.json'),
    '--watch', 'silent-omissions', '--target', '20', '--acceptable', '10', '--segment-by', 'channel']],
  ['agree, three graders', ['agree', '--config', FX + 'agree/config.json', '--keys', ...['ann', 'ben', 'cai'].map(n => FX + 'agree/' + n + '.json')]],
  ['agree, grades', ['agree', '--grades', FX + 'freetext/grades-a.json', FX + 'freetext/grades-b.json', FX + 'agree/grades-c.json']],
  ['suspects', ['suspects', '--config', FX + 'suspects/config.json', '--key', FX + 'suspects/key.json', FX + 'suspects/run-a.json', FX + 'suspects/run-b.json',
    '--rulings', FX + 'suspects/rulings-pending.json']],
  ['score --grades', ['score', '--grades', FX + 'freetext/grades-a.json', '--second-reviewer', FX + 'freetext/grades-b.json']],
];

test('no report prints NaN, undefined or [object Object]', () => {
  for (const [label, args] of REPORTS) {
    const r = cli(args);
    assert.equal(r.status, 0, label + '\n' + r.stderr);
    assert.ok(r.stdout.length > 0, label + ': nothing printed');
    assert.doesNotMatch(r.stdout + r.stderr, BROKEN, label);
  }
});

const noScripts = html => html.replace(/<script[\s\S]*?<\/script>/g, '');

test('no HTML report or grading page prints them either', () => {
  const dir = folder({});
  const page = name => path.join(dir, name);
  const cases = [
    ['score', ...fixture('tiny'), '--target', '10', '--html', page('a.html')],
    ['score', ...fixture('declines'), '--html', page('b.html')],
    ['score', ...fixture('split', 'predictions-v2.json'), '--target', '40', '--held-out', '--html', page('c.html')],
    ['score', ...fixture('ordinal'), '--html', page('d.html')],
    ['score', ...fixture('split', 'predictions-v2.json'), '--show-held-out', '--html', page('f.html')],
    ['score', '--config', FX + 'split/gate.json', '--pred', FX + 'split/gate-sg.json', '--key', FX + 'gate/key.json', '--html', page('g.html')],
    ['grade', '--config', FX + 'freetext/grading.json', '--pred', FX + 'freetext/forms.json', '--out', page('e.html')],
  ];
  for (const args of cases) {
    const r = cli(args);
    assert.equal(r.status, 0, args.join(' ') + '\n' + r.stderr);
    const file = args[args.length - 1];
    assert.doesNotMatch(noScripts(fs.readFileSync(file, 'utf8')), BROKEN, args.join(' '));
  }
});

test('the lines only some settings reach: any_of, min_per_trap, nothing counted, no estimate yet, pending too many ways', () => {
  const MAP = { PUB: 'auto', ASK: 'review' };
  const base = { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP } };
  const key = [{ id: 'a', gold: 'PUB', tags: ['x'], trap: 't' }, { id: 'b', gold: 'ASK', tags: ['y'], trap: 'u' }];
  const pred = [{ id: 'a', route: 'PUB', tags: [{ value: 'x', confidence: 0.9 }] }, { id: 'b', route: 'PUB', tags: [{ value: 'z', confidence: 0.4 }] }];
  const dir = folder({
    'c.json': { ...base, trap_field: 'trap', min_per_trap: 3, input: { key: { any_of_separator: ' / ' } } }, 'k.json': key, 'p.json': pred,
    'zero.csv': 'period,out_without_review,silent_errors\nW1,0,0\nW2,0,0\n',
  });
  const files = ['--config', 'c.json', '--pred', 'p.json', '--key', 'k.json'];
  const checks = [['check', '--config', 'c.json'], ['score', ...files, '--lenient', '--html', 'p.html'], ['monitor', '--counts', 'zero.csv', '--target', '5', '--since', 'W2']];
  for (const args of checks) {
    const r = cli(args, dir);
    assert.equal(r.status, 0, args.join(' ') + '\n' + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, BROKEN, args.join(' '));
  }
  assert.doesNotMatch(noScripts(fs.readFileSync(path.join(dir, 'p.html'), 'utf8')), BROKEN);

  // A person checked only what the judge passes, and the judge covers more than the records out.
  const E = FX + 'estimate/';
  const preds = read(E + 'predictions.json');
  const judge = read(E + 'judge-key.json');
  const flagged = new Set(judge.filter(j => preds.find(p => p.id === j.id).category !== j.category).map(j => j.id));
  const held = preds.filter(x => x.outcome === 'HOLD').map(x => x.id);
  const some = folder({ 'c.json': read(E + 'config.json'), 'p.json': preds, 'k.json': read(E + 'person-key.json').filter(x => !flagged.has(x.id)),
    'j.json': judge.filter(j => !held.slice(1).includes(j.id)) });
  const r = cli(['estimate', '--config', 'c.json', '--pred', 'p.json', '--judge-key', 'j.json', '--key', 'k.json'], some);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, BROKEN);

  // One record: no other to compare a label with.
  const lone = folder({ 'c.json': read(FX + 'suspects/config.json'), 'k.json': [{ id: 'T1', tags: ['refund'], category: 'billing' }],
    'r.json': [{ id: 'T1', route: 'SEND', tags: [{ value: 'refund', confidence: 0.9 }], category: 'shipping', category_confidence: 0.9 }] });
  const suspects = cli(['suspects', '--config', 'c.json', '--key', 'k.json', 'r.json'], lone);
  assert.equal(suspects.status, 0, suspects.stderr);
  assert.match(suspects.stdout, /No other record has/);
  assert.doesNotMatch(suspects.stdout + suspects.stderr, BROKEN);

  // Thirteen pending values on one record: too many ways to try, so the record is named.
  const many = folder({ 'c.json': base, 'k.json': key, 'p.json': pred,
    'r.json': { rulings: Array.from({ length: 13 }, (_, i) => ({ id: 'b', output: 'tags', value: 'v' + i, ruling: 'pending', proposed: 'add', by: 'DH', on: '2026-10-30' })) } });
  const pending = cli(['score', '--config', 'c.json', '--pred', 'p.json', '--key', 'k.json', '--rulings', 'r.json'], many);
  assert.equal(pending.status, 0, pending.stderr);
  assert.doesNotMatch(pending.stdout + pending.stderr, BROKEN);
});

test('no stop or warning about a bad file or option prints them', () => {
  const MAP = { PUB: 'auto', ASK: 'review' };
  const cfg = { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP } };
  const key = [{ id: 'a', gold: 'PUB', tags: ['x'] }];
  const pred = [{ id: 'a', route: 'PUB', tags: [{ value: 'x', confidence: 0.9 }] }];
  const A = FX + 'agree/';
  const keys = ['ann', 'ben', 'cai'].map(n => path.join(ROOT, A + n + '.json'));
  const files = ['--config', 'c.json', '--pred', 'p.json', '--key', 'k.json'];
  const dir = extra => folder({ 'c.json': cfg, 'k.json': key, 'p.json': pred, ...extra });
  const gate = { ...cfg, thresholds: { auto_publish: { tags: 'gate' } } };
  const graded = read(FX + 'freetext/grades-a.json');
  graded.grades[0].kinds = ['figure altered'];
  const CASES = [
    ['--fail-on', dir(), ['score', '--fail-on', 'nope']],
    ['--target', dir(), ['monitor', '--counts', path.join(ROOT, FX, 'monitor/counts.csv'), '--target', '0']],
    ['--names', dir(), ['agree', '--config', path.join(ROOT, A, 'config.json'), '--keys', ...keys, '--names', 'a,b']],
    ['config, a separator', dir({ 'c.json': { ...cfg, input: { predictions: { list_separator: '' } } } }), ['check', '--config', 'c.json']],
    ['config, gate_uses', dir({ 'c.json': { ...cfg, thresholds: { gate_uses: 'nope' } } }), ['check', '--config', 'c.json']],
    ['config, an output type', dir({ 'c.json': { ...cfg, outputs: { tags: { type: 'nope' } } } }), ['check', '--config', 'c.json']],
    ['config, provisional_below', dir({ 'c.json': { ...cfg, thresholds: { provisional_below: 2 } } }), ['check', '--config', 'c.json']],
    ['csv, a column with no name', dir({ 'p.csv': 'id,,route\na,b,PUB\n' }), ['score', '--config', 'c.json', '--pred', 'p.csv', '--key', 'k.json']],
    ['csv, a row of the wrong size', dir({ 'p.csv': 'id,route\na,PUB,extra\n' }), ['score', '--config', 'c.json', '--pred', 'p.csv', '--key', 'k.json']],
    ['grades, kinds on a faithful field', dir({ 'g.json': graded }), ['score', '--grades', 'g.json']],
    ['records_at', dir({ 'c.json': { ...cfg, input: { predictions: { records_at: 'data' } } }, 'p.json': { data: 5 } }), ['score', ...files]],
    ['an empty id', dir({ 'p.json': [{ ...pred[0], id: ' ' }] }), ['score', ...files]],
    ['own gate threshold, not a number', dir({ 'c.json': gate, 'p.json': [{ ...pred[0], gate: 'high' }] }), ['score', ...files]],
    ['counts, no periods', dir({ 'w.json': [] }), ['monitor', '--counts', 'w.json', '--target', '5']],
    ['counts, a row that is not one', dir({ 'w.json': [5] }), ['monitor', '--counts', 'w.json', '--target', '5']],
    ['target under acceptable', dir(), ['monitor', '--counts', path.join(ROOT, FX, 'monitor/counts.csv'), '--target', '1', '--acceptable', '2']],
    ['two keys, different records', dir({ 'k2.json': [{ id: 'z', gold: 'PUB', tags: ['x'] }] }),
      ['compare', '--config', 'c.json', '--key', 'k.json', '--after-key', 'k2.json', '--before', 'p.json', '--after', 'p.json']],
    ['two keys, more ids apart than a message lists', dir({
      'k.json': Array.from({ length: 30 }, (_, i) => ({ id: 'a' + i, gold: 'PUB', tags: ['x'] })),
      'k2.json': Array.from({ length: 30 }, (_, i) => ({ id: 'z' + i, gold: 'PUB', tags: ['x'] })),
      'p.json': Array.from({ length: 30 }, (_, i) => ({ ...pred[0], id: 'a' + i })) }),
    ['compare', '--config', 'c.json', '--key', 'k.json', '--after-key', 'k2.json', '--before', 'p.json', '--after', 'p.json']],
  ];
  for (const [label, cwd, args] of CASES) {
    const r = cli(args, cwd);
    assert.notEqual(r.status, 0, label + ' should stop\n' + r.stdout);
    assert.ok(r.stderr.length > 0, label);
    assert.doesNotMatch(r.stdout + r.stderr, BROKEN, label);
  }
});

test('a segment field no record has, and a copied answer key, are said in plain words', () => {
  const S = FX + 'monitor-segments/';
  const grouped = { ...read(S + 'config.json'), groups: { desk: { field: 'no_such_field', from: 'predictions' } } };
  const declared = cli(['monitor', '--config', 'c.json', ...['40', '41'].map(w => path.join(ROOT, S, 'runs/2026-W' + w + '.json')), '--target', '20', '--segment-by', 'desk'], folder({ 'c.json': grouped }));
  assert.equal(declared.status, 1);
  assert.match(declared.stderr, /\[L23\]/);
  assert.doesNotMatch(declared.stdout + declared.stderr, BROKEN);
  const absent = cli(['monitor', '--config', S + 'config.json', ...['40', '41'].map(w => S + 'runs/2026-W' + w + '.json'), '--target', '20', '--segment-by', 'nope']);
  assert.equal(absent.status, 1);
  assert.doesNotMatch(absent.stdout + absent.stderr, BROKEN);
  const raw = read(FX + 'agree/ann.json');
  const dir = folder({ 'one.json': raw, 'two.json': raw });
  const same = cli(['agree', '--config', path.join(ROOT, FX, 'agree/config.json'), '--keys', 'one.json', 'two.json'], dir);
  assert.match(same.stdout + same.stderr, /\[M3\]/);
  assert.doesNotMatch(same.stdout + same.stderr, BROKEN);
});
