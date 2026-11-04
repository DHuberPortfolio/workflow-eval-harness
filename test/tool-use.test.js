// How an agent used its tools (section R of test/TRAPS.md): checked against
// test/fixtures/tools/EXPECTED.md, worked out by hand before the code existed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig, validateConfig } = require('../src/config.js');
const { scoreRun } = require('../src/score.js');

const dir = path.join(__dirname, 'fixtures', 'tools');
const f = name => path.join(dir, name);
const config = loadConfig(f('config.json'));
const cli = args => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wfeval.js'), ...args], { encoding: 'utf8' });
const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-tools-'));
function json(name, content, d = folder()) {
  const p = path.join(d, name);
  fs.writeFileSync(p, JSON.stringify(content));
  return p;
}
const preds = () => JSON.parse(fs.readFileSync(f('predictions.json'), 'utf8'));
const keys = () => JSON.parse(fs.readFileSync(f('key.json'), 'utf8'));
const score = (over = {}) => scoreRun({ config, predPath: f('predictions.json'), keyPath: f('key.json'), ...over });
const typesOf = (r, id) => {
  const p = r.routing.tool_use.problems.find(x => x.id === id);
  return p ? p.findings.map(x => x.type) : [];
};
const rate = r => [r.n, r.d, r.pct];

test('R4: every record shows what EXPECTED.md worked out by hand', () => {
  const r = score();
  assert.deepEqual(['A1', 'A7', 'A11', 'A12'].map(id => typesOf(r, id)), [[], [], [], []]);
  assert.deepEqual(typesOf(r, 'A2'), ['TU-MISSING']);
  assert.deepEqual(typesOf(r, 'A3'), ['TU-ORDER']);
  assert.deepEqual(typesOf(r, 'A4'), ['TU-ARGS']);
  assert.deepEqual(typesOf(r, 'A5'), ['TU-FORBIDDEN']);
  assert.deepEqual(typesOf(r, 'A6'), ['TU-ACTED']);
  assert.deepEqual(typesOf(r, 'A8'), ['TU-FORBIDDEN']);
  assert.deepEqual(typesOf(r, 'A9'), ['TU-REPEAT']);
  assert.deepEqual(typesOf(r, 'A10'), ['TU-REPEAT']);
});

test('R4: the rates are the hand-worked ones', () => {
  const t = score().routing.tool_use;
  assert.deepEqual(rate(t.records), [8, 12, 66.7]);
  assert.deepEqual(rate(t.acted_while_held), [2, 3, 66.7]);
  const count = Object.fromEntries(Object.entries(t.by_type).map(([k, v]) => [k, v.records]));
  assert.deepEqual(count, { 'TU-MISSING': 1, 'TU-ORDER': 1, 'TU-ARGS': 1, 'TU-FORBIDDEN': 2, 'TU-ACTED': 1, 'TU-REPEAT': 2 });
  assert.equal(t.by_type['TU-ACTED'].severity, 'critical');
  assert.equal(t.by_type['TU-ARGS'].severity, 'high');
});

test('R5: a tool problem on a record out without review is a silent error', () => {
  const s = score().routing.silent_errors;
  assert.deepEqual(rate(s.rate), [6, 9, 66.7]);
  assert.deepEqual(s.records.map(x => x.id).sort(), ['A10', 'A2', 'A3', 'A4', 'A5', 'A9']);
  assert.equal(s.records.find(x => x.id === 'A5').severity, 'critical');
});

test('R5: under gold_route too: wrong_when decides about values and routes, and a wrong action is neither', () => {
  const c = validateConfig({ ...JSON.parse(fs.readFileSync(f('config.json'), 'utf8')), wrong_when: 'gold_route' }).config;
  assert.deepEqual(rate(scoreRun({ config: c, predPath: f('predictions.json'), keyPath: f('key.json') }).routing.silent_errors.rate), [6, 9, 66.7]);
});

test('R6: acting while held is not a silent error, and has its own number', () => {
  const r = score();
  assert.ok(!r.routing.silent_errors.records.some(x => x.id === 'A6'));
  assert.deepEqual(r.routing.tool_use.problems.filter(p => p.acted).map(p => p.id), ['A6', 'A8']);
});

test('R6: a review that was needed because a tool went wrong is not an unnecessary review', () => {
  assert.ok(!score().routing.review_queue.wasted.includes('A6'));
  // Where the key would have let the record out, only the tool says a person was needed.
  const k = keys().map(x => (x.id === 'A6' ? { ...x, gold_route: 'send' } : x));
  assert.ok(!score({ keyPath: json('k.json', k) }).routing.review_queue.wasted.includes('A6'));
});

test('R6: --fail-on stops a run whose only fault is acting while held', () => {
  const p = preds().filter(x => ['A6', 'A7'].includes(x.id));
  const k = keys().filter(x => ['A6', 'A7'].includes(x.id));
  const d = folder();
  const r = cli(['score', '--config', f('config.json'), '--pred', json('p.json', p, d), '--key', json('k.json', k, d), '--fail-on', 'critical', '--quiet']);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr + r.stdout, /A6 \(critical, acted while held\)/);
});

test('R7: a tool the key requires is not acting out of turn, even on a held record', () => {
  const k = keys().map(x => (x.id === 'A6' ? { ...x, expected_tools: ['lookup_contact', 'send_email'] } : x));
  assert.deepEqual(typesOf(score({ keyPath: json('k.json', k) }), 'A6'), []);
});

test('R7: every reason to act out of turn is caught on block as well as review, but not on a record out', () => {
  const p = preds().map(x => (x.id === 'A7' ? { ...x, route: 'drop', tool_calls: [{ tool: 'book_meeting' }] } : x));
  const k = keys().map(x => (x.id === 'A7' ? { ...x, expected_tools: [] } : x));
  assert.deepEqual(typesOf(score({ predPath: json('p.json', p), keyPath: json('k.json', k) }), 'A7'), ['TU-ACTED']);
});

test('R8: a config with no tools reports exactly as before', () => {
  const tiny = path.join(__dirname, 'fixtures', 'tiny');
  const c = loadConfig(path.join(tiny, 'config.json'));
  const r = scoreRun({ config: c, predPath: path.join(tiny, 'predictions.json'), keyPath: path.join(tiny, 'key.json') });
  assert.equal(Object.hasOwn(r.routing, 'tool_use'), false);
  assert.ok(r.records.every(x => !Object.hasOwn(x, 'tool')));
  assert.equal(Object.hasOwn(c, 'tools'), false);
});

test('R2: calls can be names, objects, or nested the way an n8n agent writes them', () => {
  const c = validateConfig({ ...JSON.parse(fs.readFileSync(f('config.json'), 'utf8')), tools: { field: 'output.intermediateSteps', key_field: 'expected_tools', name_key: 'action.tool', args_key: 'action.toolInput', side_effects: ['send_email'] } }).config;
  const p = [{ id: 'A1', route: 'send', category: 'question', output: { intermediateSteps: [
    { action: { tool: 'lookup_contact', toolInput: '{}' }, observation: 'found' },
    { action: { tool: 'send_email', toolInput: '{"to":"a@example.com"}' }, observation: 'sent' },
  ] } }];
  const k = keys().filter(x => x.id === 'A1');
  const r = scoreRun({ config: c, predPath: json('p.json', p), keyPath: json('k.json', k) });
  assert.deepEqual(rate(r.routing.tool_use.records), [0, 1, 0]);   // args written as JSON text are read as JSON
});

test('R2: a call with no name, or a list that is not a list, stops the run', () => {
  const bad = [[{ id: 'A1', route: 'send', category: 'question', tool_calls: [{ args: {} }] }, /\[R3\][\s\S]*name_key/],
    [{ id: 'A1', route: 'send', category: 'question', tool_calls: 'send_email' }, /\[R3\][\s\S]*list/]];
  for (const [rec, re] of bad) {
    const pred = preds().map(x => (x.id === 'A1' ? rec : x));
    assert.throws(() => score({ predPath: json('p.json', pred) }), re);
  }
});

test('R2: a record with no list is not a record with no calls', () => {
  const pred = preds().map(x => { if (x.id !== 'A5') return x; const { tool_calls: gone, ...rest } = x; return rest; });
  assert.throws(() => score({ predPath: json('p.json', pred) }), /\[R2\][\s\S]*A5/);
  const r = score({ predPath: json('p.json', pred), mode: 'lenient' });
  assert.deepEqual(r.routing.tool_use.not_recorded, ['A5']);
  assert.deepEqual(rate(r.routing.tool_use.records), [7, 11, 63.6]);   // left out, not counted clean
  assert.ok(r.routing.not_measured.some(x => /tool use/.test(x.what)));
});

test('R2: a field no record has stops a strict run: a typo must not read as a clean agent', () => {
  const pred = preds().map(({ tool_calls: gone, ...rest }) => rest);
  assert.throws(() => score({ predPath: json('p.json', pred) }), /\[P1\][\s\S]*tool_calls/);
});

test('R4: what the key does not say is not measured, and says so', () => {
  const t = score().routing;
  assert.equal(t.tool_use.no_expectation, 1);
  assert.ok(t.not_measured.some(x => /TU-MISSING/.test(x.what) && /1 record/.test(x.what)));
});

test('R3: an expectation that cannot be read stops the run', () => {
  for (const [v, re] of [[{ reqired: ['x'] }, /\[R4\][\s\S]*reqired/], [{ required: 'x' }, /\[R4\][\s\S]*required/], ['x', /\[R4\]/], [{ max_calls: 0 }, /\[R4\][\s\S]*max_calls/]]) {
    const k = keys().map(x => (x.id === 'A1' ? { ...x, expected_tools: v } : x));
    assert.throws(() => score({ keyPath: json('k.json', k) }), re);
  }
});

test('R9: a failed model call made no tool calls worth judging', () => {
  // Whatever a failed call left behind is not judged, and with no list at all it does not stop the run.
  for (const rest of [{ tool_calls: [{ tool: 'delete_mailbox' }] }, {}]) {
    const pred = preds().map(x => (x.id === 'A5' ? { id: 'A5', route: 'send', scored: false, ...rest } : x));
    const r = score({ predPath: json('p.json', pred) });
    assert.equal(typesOf(r, 'A5').length, 0);
    assert.ok(r.routing.tool_use.not_recorded.includes('A5'));
  }
});

test('R10: terminal and page both show it', () => {
  const d = folder();
  const html = path.join(d, 'r.html');
  const r = cli(['score', '--config', f('config.json'), '--pred', f('predictions.json'), '--key', f('key.json'), '--html', html]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /TOOL USE/);
  assert.match(r.stdout, /Acted while held\s+66\.7%/);
  assert.match(r.stdout, /A6\s+TU-ACTED/);
  const page = fs.readFileSync(html, 'utf8');
  assert.match(page, /Tool use/);
  assert.match(page, /TU-ACTED/);
  assert.match(page, /Acted while held/);
});

test('R10: the JSON carries it', () => {
  const d = folder();
  const out = path.join(d, 'r.json');
  assert.equal(cli(['score', '--config', f('config.json'), '--pred', f('predictions.json'), '--key', f('key.json'), '--quiet', '--json', out]).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).routing.tool_use.records.n, 8);
});

test('R11: a side-effect tool nothing ever called is named: a typo there switches a safety check off', () => {
  const c = validateConfig({ ...JSON.parse(fs.readFileSync(f('config.json'), 'utf8')), tools: { field: 'tool_calls', key_field: 'expected_tools', side_effects: ['send_emial'] } }).config;
  const r = scoreRun({ config: c, predPath: f('predictions.json'), keyPath: f('key.json') });
  assert.ok(r.problems.some(x => x.trap === 'R5' && /send_emial/.test(x.message)));
});

test('R12: severity can be changed like any other type', () => {
  const c = validateConfig({ ...JSON.parse(fs.readFileSync(f('config.json'), 'utf8')), severity: { 'TU-MISSING': 'critical' } }).config;
  const r = scoreRun({ config: c, predPath: f('predictions.json'), keyPath: f('key.json') });
  assert.equal(r.routing.tool_use.by_type['TU-MISSING'].severity, 'critical');
});

test('R1: settings that cannot work are refused when the config is read', () => {
  const base = JSON.parse(fs.readFileSync(f('config.json'), 'utf8'));
  const errors = tools => validateConfig({ ...base, tools }).errors.join(' ');
  assert.match(errors('x'), /tools must be an object/);
  assert.match(errors({ side_effects: ['a'] }), /tools\.field/);
  assert.match(errors({ field: 'a', sideeffects: [] }), /unknown key "tools\.sideeffects"/);
  assert.match(errors({ field: 'a', side_effects: 'send' }), /tools\.side_effects/);
  assert.match(errors({ field: 'a', never: [1] }), /tools\.never/);
  assert.match(errors({ field: 'a', max_calls: 0 }), /tools\.max_calls/);
  assert.equal(errors({ field: 'a' }), '');
});
