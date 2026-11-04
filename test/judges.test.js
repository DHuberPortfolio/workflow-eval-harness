// A reviewer may be a person or an AI judge (section Q of test/TRAPS.md): what an AI judge decided
// is labelled in every report and can always be taken back out, only a unanimous panel decides, and
// the skill stops before anything that would bill per token.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('../src/config.js');
const { scoreRun, varianceRun } = require('../src/score.js');
const { loadRulings } = require('../src/rulings.js');
const { loadKey } = require('../src/load.js');

const dir = path.join(__dirname, 'fixtures', 'suspects');
const f = name => path.join(dir, name);
const config = loadConfig(f('config.json'));
const cli = args => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wfeval.js'), ...args], { encoding: 'utf8' });

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-judges-'));
function file(name, content, d = folder()) {
  const p = path.join(d, name);
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
}
const fixture = () => JSON.parse(fs.readFileSync(f('rulings.json'), 'utf8')).rulings;
// The fixture's rulings with the ones whose id passes `which` marked as an AI judge's.
const marked = which => fixture().map(r => (which(r) ? { ...r, reviewer_kind: 'judge' } : r));
const score = rulingsFile => scoreRun({ config, predPath: f('run-a.json'), keyPath: f('key.json'), rulings: loadRulings(rulingsFile, config) });

test('Q1: a ruling says who kind of reviewer made it: left out means a person, and a misspelling stops', () => {
  const judge = loadRulings(file('r.json', { rulings: marked(r => r.id === 'T7') }), config);
  assert.equal(judge.list.find(x => x.id === 'T7').reviewer_kind, 'judge');
  assert.equal(judge.list.find(x => x.id === 'T10').reviewer_kind, undefined);
  const person = loadRulings(file('r.json', { rulings: fixture().map(r => ({ ...r, reviewer_kind: 'person' })) }), config);
  assert.equal(person.list[0].reviewer_kind, undefined);
  assert.throws(() => loadRulings(file('r.json', { rulings: marked(r => r.id === 'T7').map(r => (r.id === 'T7' ? { ...r, reviewer_kind: 'AI' } : r)) }), config),
    /\[I12\][\s\S]*reviewer_kind/);
});

test('Q2: a file with no AI ruling reports exactly as it did before', () => {
  const r = score(f('rulings.json'));
  assert.equal(Object.hasOwn(r.rulings, 'by_judges'), false);
  assert.ok(r.rulings.added.every(x => !Object.hasOwn(x, 'reviewer_kind')));
  const out = cli(['score', '--config', f('config.json'), '--pred', f('run-a.json'), '--key', f('key.json'), '--rulings', f('rulings.json')]).stdout;
  assert.doesNotMatch(out, /AI judge/);
});

test('Q3: the score without the AI rulings is the score of the file without them', () => {
  const some = marked(r => ['T7', 'T10', 'T3'].includes(r.id));
  const withThem = score(file('r.json', { rulings: some }));
  const rest = score(file('r.json', { rulings: some.filter(r => r.reviewer_kind !== 'judge') }));
  assert.equal(withThem.rulings.by_judges.decided, 3);
  assert.equal(withThem.rulings.by_judges.changed_key, 2);   // T3 is a reject: it changes no key entry
  assert.deepEqual(withThem.rulings.by_judges.silent_errors, rest.routing.silent_errors.rate);
  assert.notDeepEqual(withThem.routing.silent_errors.rate, rest.routing.silent_errors.rate);
});

test('Q3: every verb counts as decided, and a pending ruling has decided nothing', () => {
  const all = score(file('r.json', { rulings: marked(() => true) }));
  assert.equal(all.rulings.by_judges.decided, 5);             // add, remove, replace, keep, reject
  assert.equal(all.rulings.by_judges.changed_key, 3);         // add, remove, replace
  const pendingOnly = score(file('r.json', { rulings: marked(r => r.ruling === 'pending') }));
  assert.equal(Object.hasOwn(pendingOnly.rulings, 'by_judges'), false);
});

test('Q4: terminal and page both name the AI rulings and give the rate without them', () => {
  const r = file('r.json', { rulings: marked(r => r.id === 'T7') });
  const html = path.join(path.dirname(r), 'report.html');
  const out = cli(['score', '--config', f('config.json'), '--pred', f('run-a.json'), '--key', f('key.json'), '--rulings', r, '--html', html]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /1 of the decided rulings was made by an AI judge, not a person/);
  assert.match(out.stdout, /Without the 1 ruling made by an AI judge: \d/);
  const page = fs.readFileSync(html, 'utf8');
  assert.match(page, /made by an AI judge, not a person/);
  assert.match(page, /Without the 1 ruling made by an AI judge/);
});

test('Q5: commands that read rulings say so too, with one judge or several', () => {
  const r = file('r.json', { rulings: marked(r => ['T7', 'T10'].includes(r.id)) });
  const v = varianceRun({ config, keyPath: f('key.json'), predPaths: [f('run-a.json'), f('run-b.json')], rulings: loadRulings(r, config) });
  const { rulingsWords } = require('../src/report/format.js');
  assert.match(rulingsWords(v.rulings).join(' '), /2 of the decided rulings were made by AI judges, not a person/);
});

test('Q6: a grades file says when an AI judge graded it, and a misspelling stops', () => {
  const dirFree = path.join(__dirname, 'fixtures', 'freetext');
  const grades = JSON.parse(fs.readFileSync(path.join(dirFree, 'grades-a.json'), 'utf8'));
  const d = folder();
  const args = g => ['score', '--grades', g];
  const judged = cli(args(file('g.json', { ...grades, reviewer_kind: 'judge' }, d)));
  assert.equal(judged.status, 0, judged.stderr);
  assert.match(judged.stdout, /fields graded by an AI judge against the source/);
  const person = cli(args(path.join(dirFree, 'grades-a.json')));
  assert.match(person.stdout, /fields graded by a reviewer against the source/);
  const typo = cli(args(file('g.json', { ...grades, reviewer_kind: 'robot' }, d)));
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /\[J1\][\s\S]*reviewer_kind/);
  const second = cli(['score', '--grades', path.join(dirFree, 'grades-a.json'), '--second-reviewer', file('g2.json', { ...JSON.parse(fs.readFileSync(path.join(dirFree, 'grades-b.json'), 'utf8')), reviewer_kind: 'judge' }, d)]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /AGREEMENT .*\(an AI judge\)/);
});

test('Q7: reports say a reviewer rules, whoever that is', () => {
  const out = cli(['suspects', '--config', f('config.json'), '--key', f('key.json'), f('run-a.json'), f('run-b.json')]).stdout;
  assert.match(out, /a\s+reviewer\s+reads\s+the\s+record\s+and\s+rules/);
});

// ---------- wfeval judges ----------

const pending = [
  { id: 'T1', output: 'tags', value: 'refund', ruling: 'pending', proposed: 'add', note: 'run 1 and 2 say it' },
  { id: 'T2', output: 'tags', value: 'fraud', ruling: 'pending', proposed: 'remove', note: 'no run says it' },
  { id: 'T3', output: 'category', value: 'billing', ruling: 'pending', with: 'shipping', note: 'both runs' },
  { id: 'T4', output: 'tags', value: 'late', ruling: 'reject', by: 'DH', on: '2026-11-01' },
];
const yes = (id, value) => ({ id, output: 'tags', value, belongs: true, why: 'it says so' });
const no = (id, value) => ({ id, output: 'tags', value, belongs: false, why: 'it does not' });
const label = (id, l) => ({ id, output: 'category', label: l, why: 'read the text' });
const judge = (name, answers) => ({ judge: name, answers });
const allAgree = name => judge(name, [yes('T1', 'refund'), no('T2', 'fraud'), label('T3', 'shipping')]);

function merge(answers, opts = {}) {
  const { mergeAnswers } = require('../src/judges.js');
  const rulings = loadRulings(file('p.json', { rulings: opts.rulings || pending }), config);
  return mergeAnswers(rulings, config, answers.map((a, i) => ({ file: 'a' + i + '.json', data: a })), { on: '2026-11-04' });
}

const key = () => loadKey({ config, keyPath: f('key.json') });

test('Q8: the questions show a judge the case and nothing of who proposed what', () => {
  const { casesFrom } = require('../src/judges.js');
  const cases = casesFrom(loadRulings(file('p.json', { rulings: pending }), config), config, key());
  assert.deepEqual(cases.map(c => c.id), ['T1', 'T2', 'T3']);   // the decided T4 is not asked again
  assert.deepEqual(cases[0], { id: 'T1', output: 'tags', asks: 'belongs', value: 'refund', listed: [] });
  assert.deepEqual(cases[2], { id: 'T3', output: 'category', asks: 'label', labels: config.outputs.category.labels.map(String) });
  assert.doesNotMatch(JSON.stringify(cases), /proposed|"with"|note|run 1/);
  assert.equal(Object.hasOwn(cases[2], 'value'), false);   // the key's label is not shown
});

test('Q8: the questions come sorted by record, so the ranking does not show either', () => {
  const { casesFrom } = require('../src/judges.js');
  const cases = casesFrom(loadRulings(file('p.json', { rulings: [...pending].reverse() }), config), config, key());
  assert.deepEqual(cases.map(c => c.id), ['T1', 'T2', 'T3']);
});

test('Q8: a judge sees what the key lists beside the value asked about, and a label question shows none of it', () => {
  const { casesFrom } = require('../src/judges.js');
  const records = [{ id: 'A', outputs: { tags: ['b', 'a', { any_of: ['c', 'd'] }], category: 'billing' } }];
  const r = { list: [{ id: 'A', output: 'tags', value: 'a', ruling: 'pending' }, { id: 'A', output: 'category', value: 'billing', ruling: 'pending', label: true, with: 'shipping' }], file: 'x' };
  const [asked, labelled] = casesFrom(r, config, records).sort((p, q) => (p.output < q.output ? 1 : -1));
  assert.deepEqual(asked.listed, ['b', 'c', 'd']);   // never the value asked about
  assert.equal(Object.hasOwn(labelled, 'listed'), false);
});

test('Q9: only a unanimous panel decides, each verb following what was proposed', () => {
  const { rulings, counts } = merge([allAgree('j1'), allAgree('j2'), allAgree('j3')]);
  const by = id => rulings.find(r => r.id === id);
  assert.equal(by('T1').ruling, 'add');
  assert.equal(by('T2').ruling, 'remove');
  assert.equal(by('T3').ruling, 'replace');
  assert.equal(by('T3').with, 'shipping');
  for (const id of ['T1', 'T2', 'T3']) {
    assert.equal(by(id).reviewer_kind, 'judge');
    assert.equal(by(id).by, '3 AI judges');
    assert.equal(by(id).on, '2026-11-04');
    assert.equal(by(id).proposed, undefined);
  }
  assert.deepEqual(by('T4'), pending[3]);   // a person's ruling is left word for word
  assert.deepEqual(counts, { judges: 3, cases: 3, decided: 3, split: 0, unanswered: 0 });
});

test('Q9: the verbs for a panel that goes the other way', () => {
  const other = name => judge(name, [no('T1', 'refund'), yes('T2', 'fraud'), label('T3', 'billing')]);
  const { rulings } = merge([other('j1'), other('j2'), other('j3')]);
  const by = id => rulings.find(r => r.id === id);
  assert.equal(by('T1').ruling, 'reject');
  assert.equal(by('T2').ruling, 'keep');
  assert.equal(by('T3').ruling, 'keep');
  assert.equal(by('T3').with, undefined);
});

test('Q10: a split stays pending, as it was, with the split in its note', () => {
  const { rulings, counts } = merge([allAgree('j1'), allAgree('j2'), judge('j3', [no('T1', 'refund'), no('T2', 'fraud'), label('T3', 'billing')])]);
  const t1 = rulings.find(r => r.id === 'T1');
  assert.equal(t1.ruling, 'pending');
  assert.equal(t1.proposed, 'add');
  assert.equal(t1.reviewer_kind, undefined);
  assert.match(t1.note, /AI judges split: 2 yes, 1 no/);
  assert.equal(rulings.find(r => r.id === 'T3').ruling, 'pending');
  assert.equal(rulings.find(r => r.id === 'T2').ruling, 'remove');
  assert.deepEqual(counts, { judges: 3, cases: 3, decided: 1, split: 2, unanswered: 0 });
});

test('Q10: a judge who gave no answer leaves the case open: silence is never a vote', () => {
  const { rulings, counts } = merge([allAgree('j1'), allAgree('j2'), judge('j3', [no('T2', 'fraud'), label('T3', 'shipping')])]);
  assert.equal(rulings.find(r => r.id === 'T1').ruling, 'pending');
  assert.match(rulings.find(r => r.id === 'T1').note, /2 of 3 AI judges answered/);
  assert.deepEqual(counts, { judges: 3, cases: 3, decided: 2, split: 0, unanswered: 1 });
});

test('Q11: what the panel writes reads back as a rulings file and scores', () => {
  const real = [{ id: 'T7', output: 'tags', value: 'refund', ruling: 'pending' }];
  const { text } = merge([1, 2, 3].map(n => judge('j' + n, [yes('T7', 'refund')])), { rulings: real });
  const r = score(file('out.json', text));
  assert.equal(r.rulings.by_judges.decided, 1);
  assert.equal(r.rulings.added[0].by, '3 AI judges');
});

test('Q12: answers that cannot be trusted stop the run: nothing is guessed', () => {
  const stop = (answers, re) => assert.throws(() => merge(answers), re);
  stop([allAgree('j1')], /\[Q2\].*at least 2/);
  stop([allAgree('j1'), allAgree('j1')], /\[Q2\].*j1.*twice/);
  stop([allAgree('j1'), { answers: [] }], /\[Q2\].*"judge"/);
  stop([allAgree('j1'), judge('j2', 'none')], /\[Q2\].*"answers"/);
  stop([allAgree('j1'), judge('j2', [yes('T9', 'refund')])], /\[Q3\].*T9/);
  stop([allAgree('j1'), judge('j2', [yes('T1', 'refund'), yes('T1', 'refund')])], /\[Q3\].*twice/);
  stop([allAgree('j1'), judge('j2', [{ id: 'T1', output: 'tags', value: 'refund', belongs: 'yes' }])], /\[Q3\].*belongs/);
  stop([allAgree('j1'), judge('j2', [label('T3', 'nonsense')])], /\[Q3\].*nonsense/);
});

test('Q13: the command writes a new file only, and says what happened', () => {
  const d = folder();
  const p = file('p.json', { rulings: pending }, d);
  const cases = path.join(d, 'cases.json');
  assert.match(cli(['judges', '--config', f('config.json'), '--rulings', p, '--write-cases', cases]).stderr, /--key/);
  const asked = cli(['judges', '--config', f('config.json'), '--key', f('key.json'), '--rulings', p, '--write-cases', cases]);
  assert.equal(asked.status, 0, asked.stderr);
  assert.equal(JSON.parse(fs.readFileSync(cases, 'utf8')).cases.length, 3);
  const answers = ['j1', 'j2', 'j3'].map(n => file(n + '.json', allAgree(n), d));
  const out = path.join(d, 'out.json');
  const made = cli(['judges', '--config', f('config.json'), '--rulings', p, '--write-rulings', out, '--on', '2026-11-04', ...answers]);
  assert.equal(made.status, 0, made.stderr);
  assert.match(made.stdout, /3 AI judges, 3 cases: 3 decided \(all agreed\), 0 split, 0 unanswered/);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).rulings.length, 4);
  const again = cli(['judges', '--config', f('config.json'), '--rulings', p, '--write-rulings', out, '--on', '2026-11-04', ...answers]);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /\[Q4\].*already exists/);
  assert.equal(cli(['judges', '--config', f('config.json'), '--rulings', p, '--write-rulings', path.join(d, 'x.json'), '--on', '11/04', ...answers]).status, 1);
});

test('Q13: with nothing pending there is nothing to ask', () => {
  const d = folder();
  const p = file('p.json', { rulings: [pending[3]] }, d);
  const r = cli(['judges', '--config', f('config.json'), '--key', f('key.json'), '--rulings', p, '--write-cases', path.join(d, 'c.json')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\[Q1\]/);
  assert.equal(fs.existsSync(path.join(d, 'c.json')), false);
});

// ---------- the stop before paid calls ----------

const { routeOf, accountOf } = require('../.claude/skills/wfeval/route.js');
const plan = { authMethod: 'claude.ai', subscriptionType: 'max', apiProvider: 'firstParty' };

test('Q14: a plan login runs the judges with no stop', () => {
  for (const s of ['pro', 'max', 'team', 'enterprise']) assert.equal(routeOf({}, { ...plan, subscriptionType: s }).route, 'plan');
});

test('Q14: anything that bills per token stops', () => {
  for (const env of [{ ANTHROPIC_API_KEY: 'x' }, { ANTHROPIC_AUTH_TOKEN: 'x' }, { CLAUDE_CODE_USE_BEDROCK: '1' }, { CLAUDE_CODE_USE_VERTEX: '1' }, { CLAUDE_CODE_USE_FOUNDRY: '1' }]) {
    assert.equal(routeOf(env, plan).route, 'api', JSON.stringify(env));   // a key outranks a plan login
  }
  for (const authMethod of ['api_key', 'api_key_helper', 'third_party']) assert.equal(routeOf({}, { authMethod }).route, 'api', authMethod);
  assert.equal(routeOf({}, { authMethod: 'claude.ai', apiProvider: 'bedrock', subscriptionType: 'max' }).route, 'api');
});

test('Q14: what cannot be shown to be a plan is asked about, never assumed', () => {
  for (const s of [null, { authMethod: 'none' }, { authMethod: 'oauth_token' }, { authMethod: 'claude.ai' }, { authMethod: 'claude.ai', subscriptionType: null },
    { authMethod: 'claude.ai', subscriptionType: 'free' }, { authMethod: 'something_new', subscriptionType: 'max' }]) {
    assert.equal(routeOf({}, s).route, 'unknown', JSON.stringify(s));
  }
});

test('Q14: an env var set to nothing is not set', () => {
  assert.equal(routeOf({ ANTHROPIC_API_KEY: '', CLAUDE_CODE_USE_BEDROCK: '0' }, plan).route, 'plan');
});

test('Q14: inside the desktop app, a confirmed account runs with no stop, and only that account', () => {
  const me = { CLAUDE_CODE_ACCOUNT_UUID: 'account-1' };
  const note = { account: accountOf(me) };
  const none = { authMethod: 'none' };
  assert.equal(routeOf(me, none, note).route, 'plan');
  assert.equal(routeOf(me, null, note).route, 'plan');
  assert.equal(routeOf({ CLAUDE_CODE_ACCOUNT_UUID: 'account-2' }, none, note).route, 'unknown');
  assert.equal(routeOf({}, none, note).route, 'unknown');
  assert.equal(routeOf(me, none, null).route, 'unknown');
  assert.equal(note.account.includes('account-1'), false);   // the id itself is not kept
});

test('Q14: nothing remembered outranks a key or an API login', () => {
  const me = { CLAUDE_CODE_ACCOUNT_UUID: 'account-1' };
  const note = { account: accountOf(me) };
  assert.equal(routeOf({ ...me, ANTHROPIC_API_KEY: 'x' }, null, note).route, 'api');
  assert.equal(routeOf({ ...me, CLAUDE_CODE_USE_VERTEX: '1' }, null, note).route, 'api');
  assert.equal(routeOf(me, { authMethod: 'api_key' }, note).route, 'api');
});

test('Q15: scoring code calls no model and starts no program, judges or not', () => {
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const root = path.join(__dirname, '..');
  for (const p of [...walk(path.join(root, 'src')), path.join(root, 'bin', 'wfeval.js')]) {
    assert.doesNotMatch(fs.readFileSync(p, 'utf8'), /child_process|require\('https?'\)|node:https?'|\bfetch\(|anthropic\.com/i, p);
  }
});
