// Names every JavaScript object already has: "__proto__", "constructor", "toString". As the name of
// an output or a group they are refused; as data (an id, a value, a label, a segment, a group label,
// a grade kind) they must simply work, and reach the JSON. test/TRAPS.md, section P.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateConfig, addGroupBy, addClusterBy } = require('../src/config.js');

const WFEVAL = path.join(__dirname, '..', 'bin', 'wfeval.js');
const RESERVED = ['__proto__', 'constructor', 'toString', 'toLocaleString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', '__defineGetter__', '__lookupSetter__'];
const MAP = { PUB: 'auto', ASK: 'review' };
const cli = (args, cwd) => spawnSync(process.execPath, [WFEVAL, ...args], { cwd, encoding: 'utf8' });
function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-names-'));
  for (const [name, x] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof x === 'string' ? x : JSON.stringify(x));
  return dir;
}
// JSON, as a file holds it: a key named __proto__ written by hand, so it stays one.
const parse = text => JSON.parse(text);

test('P13: an output, a group or a cluster with a reserved name stops at the config, naming the key', () => {
  for (const name of RESERVED) {
    const outputs = parse('{"' + name + '":{"type":"set","field":"t"}}');
    const a = validateConfig({ outputs, routing: { field: 'route', map: MAP } });
    assert.ok(a.errors.some(e => e.includes('outputs.' + name) && e.includes('reserved')), name + ': ' + a.errors.join(' | '));
    const groups = parse('{"' + name + '":{"field":"g"}}');
    const b = validateConfig({ outputs: { t: { type: 'set' } }, routing: { field: 'route', map: MAP }, groups });
    assert.ok(b.errors.some(e => e.includes('groups.' + name) && e.includes('reserved')), name + ': ' + b.errors.join(' | '));
  }
  const c = validateConfig({ outputs: { t: { type: 'set' } }, routing: { field: 'route', map: MAP }, clusters: { field: 'constructor' } });
  assert.ok(c.errors.some(e => e.includes('clusters.field') && e.includes('reserved')), c.errors.join(' | '));
});

test('P13: a reserved name given on the command line stops too, and says how to read such a field', () => {
  const { config } = validateConfig({ outputs: { t: { type: 'set' } }, routing: { field: 'route', map: MAP } });
  for (const name of ['constructor', 'toString']) {
    assert.throws(() => addGroupBy(config, [name]), new RegExp('--group-by ' + name + ':.*reserved.*groups'));
    assert.throws(() => addClusterBy(config, name), new RegExp('--cluster-by ' + name + ':.*reserved'));
  }
  assert.throws(() => addGroupBy(config, ['__proto__']), /__proto__/);
  // Any other name is as it was, and a config's own group of that name is read.
  assert.deepEqual(addGroupBy(config, ['channel']).groups.channel, { field: 'channel', from: 'key' });
});

test('P13: a group may read a field called constructor: the field is data, the group has another name', () => {
  const dir = folder({
    'c.json': { outputs: { t: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP }, groups: { made_by: { field: 'constructor' } } },
    'k.json': [{ id: 'a', gold: 'PUB', t: ['x'], constructor: 'acme' }],
    'p.json': [{ id: 'a', route: 'PUB', t: ['x'] }],
  });
  const r = cli(['score', '--config', 'c.json', '--pred', 'p.json', '--key', 'k.json', '--json', 'o.json', '--quiet'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'o.json'), 'utf8')).groups[0].rows.map(x => x.label), ['acme']);
  fs.rmSync(dir, { recursive: true });
});

test('P13: a lookup by a name from the command line or a file reads only what the config declares', () => {
  const dir = folder({
    'c.json': { outputs: { tags: { type: 'set' } }, routing: { field: 'route', map: MAP }, thresholds: { auto_publish: { tags: 0.5 } } },
    'k.json': [{ id: 'a', tags: ['x'] }, { id: 'b', tags: ['y'] }],
    'p.json': [{ id: 'a', route: 'PUB', tags: [{ value: 'x', confidence: 0.9 }] }, { id: 'b', route: 'PUB', tags: [{ value: 'y', confidence: 0.9 }] }],
    'r.json': { rulings: [{ id: 'a', output: 'constructor', value: 'x', ruling: 'add', by: 'p', on: '2026-01-01' }] },
    'pol.json': { policies: [{ name: 'p', auto_publish: { constructor: 0.5 } }] },
  });
  const files = ['--config', 'c.json', '--pred', 'p.json', '--key', 'k.json'];
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const held = cli(['whatif', ...files, '--hold-if', name + '=*'], dir);
    assert.equal(held.status, 1, name + ': ' + held.stdout);
    assert.match(held.stderr, /\[E13\]/, name);
  }
  const ruled = cli(['score', ...files, '--rulings', 'r.json'], dir);
  assert.equal(ruled.status, 1);
  assert.match(ruled.stderr, /"constructor" is not an output in the config/);
  const policy = cli(['whatif', ...files, '--policies', 'pol.json'], dir);
  assert.equal(policy.status, 1);
  assert.match(policy.stderr, /\[E13\].*"constructor" is not declared/);
  const gate = cli(['whatif', ...files, '--gate', '--output', 'constructor'], dir);
  assert.equal(gate.status, 1);
  assert.match(gate.stderr, /"constructor" has no auto_publish threshold to sweep/);
  fs.rmSync(dir, { recursive: true });
});

test('P13: what a config declares is looked up as its own: a threshold, an allowed list, an equivalent, a severity, a policy', () => {
  const base = { outputs: { t: { type: 'set' } }, routing: { field: 'route', map: MAP } };
  const errs = extra => validateConfig({ ...base, ...extra }).errors.join(' | ');
  assert.match(errs({ thresholds: { auto_publish: { constructor: 0.5 } } }), /auto_publish\.constructor is not a declared output/);
  assert.match(errs({ allowed_values: { toString: ['a'] } }), /allowed_values\.toString is not a declared output/);
  assert.match(errs({ equivalents: { valueOf: [['a', 'b']] } }), /equivalents\.valueOf is not a declared output/);
  assert.match(errs({ severity: { constructor: 'high' } }), /severity\.constructor is not a known error type/);
});

test('P14: ids, values, labels, routes, traps and group labels named after object properties work, and reach the JSON', () => {
  const names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];
  const config = { outputs: { tags: { type: 'set' }, kind: { type: 'label', labels: names } },
    routing: { field: 'route', gold_field: 'gold', map: parse('{"__proto__":"auto","constructor":"auto","toString":"review"}') },
    trap_field: 'trap', groups: { chan: { field: 'chan' } }, clusters: { field: 'story' } };
  // Four records: each named one way throughout. Record constructor applies a value the key does
  // not list (__proto__): one false positive; hasOwnProperty misses x: one false negative.
  const key = names.map(n => ({ id: n, gold: '__proto__', tags: n === 'hasOwnProperty' ? [n, 'x'] : [n], kind: n, trap: n, chan: n, story: n }));
  const pred = names.map(n => ({ id: n, route: n === 'toString' ? 'toString' : n === 'constructor' ? 'constructor' : '__proto__', tags: n === 'constructor' ? [n, '__proto__'] : [n], kind: n }));
  const dir = folder({ 'c.json': config, 'k.json': key, 'p.json': pred });
  const r = cli(['score', '--config', 'c.json', '--pred', 'p.json', '--key', 'k.json', '--json', 'o.json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const raw = fs.readFileSync(path.join(dir, 'o.json'), 'utf8');
  const o = JSON.parse(raw);
  const tags = o.quality.outputs.tags;
  assert.deepEqual([tags.tp, tags.fp, tags.fn], [4, 1, 1]);
  const by = tags.by_value;
  assert.deepEqual(Object.keys(by).sort(), ['__proto__', 'constructor', 'hasOwnProperty', 'toString', 'x']);
  const sum = f => Object.values(by).reduce((s, x) => s + x[f], 0);
  assert.deepEqual([sum('tp'), sum('fp'), sum('fn')], [4, 1, 1]);
  // by_value.__proto__ read by name: one right, one wrong.
  assert.equal(JSON.parse(raw, (k, v) => v).quality.outputs.tags.by_value['__proto__'].tp, 1);
  assert.equal(by['__proto__'].fp, 1);
  const kind = o.quality.outputs.kind;
  assert.deepEqual(Object.keys(kind.confusion).sort(), [...names].sort());
  assert.equal(kind.confusion['__proto__']['__proto__'], 1);
  assert.equal(kind.per_label['__proto__'].tp, 1);
  assert.deepEqual(o.routing.by_route, parse('{"__proto__":2,"constructor":1,"toString":1}'));
  assert.deepEqual(o.traps.groups.map(g => g.trap).sort(), [...names].sort());
  assert.deepEqual(o.groups[0].rows.map(g => g.label).sort(), [...names].sort());
  assert.deepEqual(({}).polluted, undefined);
  fs.rmSync(dir, { recursive: true });
});

test('P14: monitor keeps every segment, pooled or not, under its own name', () => {
  const rows = [['__proto__', 100], ['constructor', 100], ['toString', 50]].map(([segment, n]) => ({ period: 'week-1', segment, out_without_review: n, silent_errors: 1 }));
  const dir = folder({ 'c.json': rows });
  const r = cli(['monitor', '--counts', 'c.json', '--target', '5', '--segment-by', 'segment', '--segments', 'zzz', '--json', 'o.json'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'o.json'), 'utf8')).segments.other_values, parse('{"__proto__":100,"constructor":100,"toString":50}'));
  fs.rmSync(dir, { recursive: true });
});

test('P14: a counts row cannot hand a count to the columns through a key named __proto__', () => {
  const dir = folder({ 'c.json': '[{"period":"week-1","__proto__":{"out_without_review":100,"silent_errors":0}}]' });
  const r = cli(['monitor', '--counts', 'c.json', '--target', '5'], dir);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /has no out_without_review/);
  fs.rmSync(dir, { recursive: true });
});

test('P14: a grade kind keeps its count under its own name', () => {
  const g = { format: 'wfeval-grades/1', fingerprint: 'sha256:x', fields: [{ name: 'a' }], forms: ['f1', 'f2'], kinds: ['__proto__', 'constructor'],
    grades: [{ form: 'f1', field: 'a', grade: 'invented', kinds: ['__proto__'] }, { form: 'f2', field: 'a', grade: 'invented', kinds: ['constructor'] }] };
  const dir = folder({ 'g.json': g });
  assert.equal(cli(['score', '--grades', 'g.json', '--json', 'o.json', '--quiet'], dir).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'o.json'), 'utf8')).kinds.counts, parse('{"__proto__":1,"constructor":1}'));
  fs.rmSync(dir, { recursive: true });
});

test('P14: an id named __proto__ is counted by the split log', () => {
  const ids = ['__proto__', 'constructor', 'toString', ...Array.from({ length: 12 }, (_, i) => 'r' + i)];
  const dir = folder({
    'c.json': { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP }, split: { held_out: 0.5, by: 'id', log: 'log.json' } },
    'k.json': ids.map(id => ({ id, gold: 'PUB', tags: ['x'] })),
    'p.json': ids.map(id => ({ id, route: 'PUB', tags: ['x'] })),
  });
  const r = cli(['score', '--config', 'c.json', '--pred', 'p.json', '--key', 'k.json', '--held-out', '--quiet'], dir);
  assert.equal(r.status, 0, r.stderr);
  const log = fs.readFileSync(path.join(dir, 'log.json'), 'utf8');
  const parsed = JSON.parse(log);
  const seen = [...Object.keys(parsed.records.held_out), ...Object.keys(parsed.records.tuning)];
  assert.deepEqual(seen.sort(), [...ids].sort());
  fs.rmSync(dir, { recursive: true });
});

test('P15: a config cannot reach Object.prototype: input.__proto__ is an unknown key', () => {
  const raw = parse('{"input":{"__proto__":{"list_separator":"|","confidence_separator":"@","records_at":"data"}},"outputs":{"t":{"type":"set"}},"routing":{"field":"route","map":{"A":"auto"}}}');
  const { errors } = validateConfig(raw);
  assert.equal(({}).records_at, undefined);
  assert.equal(({}).list_separator, undefined);
  assert.ok(errors.some(e => e.includes('unknown key "input.__proto__"')), errors.join(' | '));
  const c = validateConfig(parse('{"input":{"constructor":{"records_at":"data"}},"outputs":{"t":{"type":"set"}},"routing":{"field":"route","map":{"A":"auto"}}}'));
  assert.equal(Object.records_at, undefined);
  assert.ok(c.errors.some(e => e.includes('unknown key "input.constructor"')), c.errors.join(' | '));
});

test('P15: no field path may run through __proto__, and --write-key builds only its own objects', () => {
  const r = validateConfig({ outputs: { t: { type: 'set', key_field: '__proto__.polluted' } }, routing: { field: 'route', map: MAP } });
  assert.ok(r.errors.some(e => e.includes('outputs.t.key_field')), r.errors.join(' | '));
  for (const raw of [{ id_field: '__proto__' }, { trap_field: 'a.__proto__.b' }, { duplicate_of_field: '__proto__' }]) {
    assert.ok(validateConfig({ outputs: { t: { type: 'set' } }, routing: { field: 'route', map: MAP }, ...raw }).errors.length > 0, JSON.stringify(raw));
  }
  // constructor.prototype is two ordinary field names here: the key written holds them as its own.
  const dir = folder({
    'c.json': { outputs: { t: { type: 'set', key_field: 'constructor.prototype.t' } }, routing: { field: 'route', map: { A: 'auto' } } },
    'a.json': [{ id: 'x', constructor: { prototype: { t: ['v'] } } }, { id: 'y', constructor: { prototype: { t: [] } } }],
    'b.json': [{ id: 'x', constructor: { prototype: { t: ['v'] } } }, { id: 'y', constructor: { prototype: { t: [] } } }],
  });
  const run = spawnSync(process.execPath, ['-e', `const { agreeKeys, majorityKeyText } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'agree.js'))});
    const { loadConfig } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'config.js'))});
    const config = loadConfig('c.json');
    const a = agreeKeys({ config, keyPaths: ['a.json', 'b.json'], majority: true, resamples: 100 });
    console.log(JSON.stringify([JSON.parse(majorityKeyText(config, a.majority, 'out.json')), ({}).t === undefined, Object.t === undefined]));`], { cwd: dir, encoding: 'utf8' });
  assert.equal(run.stderr, '');
  assert.deepEqual(JSON.parse(run.stdout), [[{ id: 'x', constructor: { prototype: { t: ['v'] } } }, { id: 'y', constructor: { prototype: { t: [] } } }], true, true]);
  fs.rmSync(dir, { recursive: true });
});

test('P15: a bad command named after an object property is an unknown command, exit 2', () => {
  for (const cmd of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'toLocaleString', '__proto__', '__defineGetter__']) {
    const r = cli([cmd], os.tmpdir());
    assert.equal(r.status, 2, cmd + ': ' + r.stderr.slice(0, 200));
    assert.match(r.stderr, new RegExp('^unknown or unbuilt command: ' + cmd));
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  }
});
