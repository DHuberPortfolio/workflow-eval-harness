// The command line and the files around it, as the Nov 3 audit found them: what reaches a terminal,
// how files are read, which options are refused, and how the process ends. test/TRAPS.md, section P.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { escapeControls, forTerminal } = require('../src/text.js');
const { renderTerminal } = require('../src/report/terminal.js');

const WFEVAL = path.join(__dirname, '..', 'bin', 'wfeval.js');
const MAP = { PUB: 'auto', ASK: 'review' };
const CFG = { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP } };
const cli = (args, cwd) => spawnSync(process.execPath, [WFEVAL, ...args], { cwd, encoding: 'utf8' });
function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-cli-'));
  for (const [name, x] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), Buffer.isBuffer(x) || typeof x === 'string' ? x : JSON.stringify(x));
  }
  return dir;
}
const KEY = [{ id: 'a', gold: 'PUB', tags: ['x'] }, { id: 'b', gold: 'PUB', tags: ['y'] }];
const PRED = [{ id: 'a', route: 'PUB', tags: [{ value: 'x', confidence: 0.9 }] }, { id: 'b', route: 'PUB', tags: [{ value: 'z', confidence: 0.9 }] }];
const FILES = ['--config', 'c.json', '--pred', 'p.json', '--key', 'k.json'];
const basic = (extra = {}) => folder({ 'c.json': CFG, 'k.json': KEY, 'p.json': PRED, ...extra });

// ---------- P12: control characters ----------

test('P12: escapeControls shows control characters as text, and leaves everything else alone', () => {
  assert.equal(escapeControls('a\x1b[2Jb\x07c', true), 'a\\x1b[2Jb\\x07c');
  assert.equal(escapeControls('a\rb', true), 'a\\rb');
  assert.equal(escapeControls('a\nb', true), 'a\nb');
  assert.equal(escapeControls('a\nb', false), 'a\\nb');
  assert.equal(escapeControls('a\u009bb', true), 'a\\x9bb');
  assert.equal(escapeControls('tab\there · é ñ 中文 \u{1F600}', false), 'tab\there · é ñ 中文 \u{1F600}');
});

test('P12: forTerminal copies only what it changes, and gives back the same object for ordinary text', () => {
  const frozen = Object.freeze({ a: 1 });
  const clean = { id: 'x', list: ['y', { z: 'w' }], shared: frozen, m: new Map([['k', 'v']]), s: new Set(['q']) };
  assert.equal(forTerminal(clean), clean);
  const dirty = { id: 'x\ny', list: ['fine', { z: 'a\x1bb' }], shared: frozen, n: 5, nothing: null };
  Object.defineProperty(dirty, 'hidden', { value: 'stays', enumerable: false });
  const out = forTerminal(dirty);
  assert.deepEqual([out.id, out.list[1].z, out.n, out.nothing], ['x\\ny', 'a\\x1bb', 5, null]);
  assert.equal(out.shared, frozen);
  assert.equal(out.hidden, 'stays');
  assert.equal(dirty.id, 'x\ny', 'the original is never changed');
  const m = forTerminal({ m: new Map([['k\n', new Set(['v\x07'])]]) }).m;
  assert.deepEqual([...m.keys()], ['k\\n']);
  assert.deepEqual([...m.get('k\\n')], ['v\\x07']);
  const cyclic = { a: 'x\n' };
  cyclic.self = cyclic;
  assert.equal(forTerminal(cyclic).a, 'x\\n');
});

test('P12: model text cannot clear the screen or forge a line, in any report, a warning or a stop', () => {
  const FORGE = 'x\nSILENT ERRORS  none\n\x1b[2J\x1b]0;pwned\x07';
  const key = [{ id: 'r' + FORGE, gold: 'PUB', tags: ['right'] }, { id: 'b', gold: 'PUB', tags: ['right'] }];
  const pred = [{ id: 'r' + FORGE, route: 'PUB', tags: [{ value: 'v' + FORGE, confidence: 0.9 }] }, { id: 'b', route: 'PUB', tags: [{ value: 'right', confidence: 0.9 }] }];
  const dir = folder({ 'c.json': CFG, 'k.json': key, 'p.json': pred, 'p2.json': pred.map(r => ({ ...r, extra: 1 })), 'bad.json': [{ id: 'b' + FORGE, route: 'PUB', tags: ['a'] }, ...pred] });
  const runs = [
    ['score', ...FILES], ['check', ...FILES],
    ['variance', '--config', 'c.json', '--key', 'k.json', 'p.json', 'p2.json'],
    ['compare', '--config', 'c.json', '--key', 'k.json', '--before', 'p.json', '--after', 'p2.json'],
    ['suspects', '--config', 'c.json', '--key', 'k.json', 'p.json'],
    ['score', '--config', 'c.json', '--pred', 'bad.json', '--key', 'k.json'],
    ['score', ...FILES, '--fail-on', 'low', '--quiet'],
  ];
  for (const a of runs) {
    const r = cli(a, dir);
    const out = r.stdout + r.stderr;
    assert.ok(out.length > 0, a.join(' '));
    assert.doesNotMatch(out, /[\x1b\x07]/, a.join(' '));
    assert.doesNotMatch(out, /^SILENT ERRORS {2}none$/m, a.join(' '));
  }
  // The JSON keeps the text as it was.
  assert.equal(cli(['score', ...FILES, '--json', 'o.json', '--quiet'], dir).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'o.json'), 'utf8')).records[0].id, 'r' + FORGE);
  fs.rmSync(dir, { recursive: true });
});

test('P12: every report reaches the terminal through one place', () => {
  const source = fs.readFileSync(WFEVAL, 'utf8');
  assert.equal(source.split('process.stdout.write(').length - 1, 1, 'print() is the only writer');
  const logs = source.split('\n').filter(l => l.includes('console.log('));
  assert.deepEqual(logs.map(l => l.trim()), ["if (!cmd || cmd === '-h' || cmd === '--help') { console.log(USAGE); return 0; }"]);
});

// ---------- P16, P17: encoding ----------

test('P16: invalid UTF-8 stops, naming the file and saying what to do, in every file a command reads', () => {
  // Windows-1252 as Excel saves "CSV": cafe with an accent in one byte. Read as UTF-8 the two values
  // below both came out as caf�: different answers scored as a match.
  const csvPred = Buffer.from('id,route,tags\r\na,PUB,x\r\nb,PUB,café\r\n', 'latin1');
  const csvKey = Buffer.from('id,gold,tags\r\na,PUB,x\r\nb,PUB,cafè\r\n', 'latin1');
  const dir = folder({ 'c.json': CFG, 'p.csv': csvPred, 'k.csv': csvKey, 'k.json': KEY, 'p.json': PRED });
  const pred = cli(['score', '--config', 'c.json', '--pred', 'p.csv', '--key', 'k.json'], dir);
  assert.equal(pred.status, 1);
  assert.match(pred.stderr, /\[P16\] p\.csv: not valid UTF-8 \(first at line 3\).*[Ss]ave it as UTF-8/);
  const key = cli(['score', '--config', 'c.json', '--pred', 'p.json', '--key', 'k.csv'], dir);
  assert.equal(key.status, 1);
  assert.match(key.stderr, /\[P16\] k\.csv/);
  fs.rmSync(dir, { recursive: true });
});

test('P16: the same for a config, a rulings file, a mix, a policies file, a counts file and a grades file', () => {
  const bad = Buffer.from('{"a":"café"}', 'latin1');
  const dir = basic({ 'bad.json': bad });
  const cases = [
    ['check', '--config', 'bad.json'],
    ['score', ...FILES, '--rulings', 'bad.json'],
    ['score', ...FILES, '--group-by', 'gold', '--mix', 'bad.json'],
    ['whatif', ...FILES, '--policies', 'bad.json'],
    ['monitor', '--counts', 'bad.json', '--target', '5'],
    ['score', '--grades', 'bad.json'],
  ];
  for (const a of cases) {
    const r = cli(a, dir);
    assert.equal(r.status, 1, a.join(' '));
    assert.match(r.stderr, /not valid UTF-8/, a.join(' '));
    assert.doesNotMatch(r.stderr, /\n\s+at /, a.join(' '));
  }
  fs.rmSync(dir, { recursive: true });
});

test('P16: a real U+FFFD in a valid UTF-8 file is text like any other, and a byte-order mark is still cleaned up', () => {
  const dir = basic({ 'p.json': '﻿' + JSON.stringify(PRED.map(r => ({ ...r, tags: [{ value: r.id === 'a' ? 'x' : 'caf�', confidence: 0.9 }] }))) });
  const r = cli(['score', ...FILES, '--json', 'o.json', '--quiet'], dir);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(fs.readFileSync(path.join(dir, 'o.json'), 'utf8'));
  assert.deepEqual(o.routing.silent_errors.records[0].differences.wrong.tags, ['caf�']);
  assert.ok(o.problems.some(i => i.trap === 'A3'));
  fs.rmSync(dir, { recursive: true });
});

test('P17: UTF-16, with or without its mark, gets a plain message', () => {
  const u16 = (s, bom = true) => Buffer.concat([bom ? Buffer.from([0xFF, 0xFE]) : Buffer.alloc(0), Buffer.from(s, 'utf16le')]);
  const be = s => { const b = Buffer.from(s, 'utf16le'); b.swap16(); return Buffer.concat([Buffer.from([0xFE, 0xFF]), b]); };
  const dir = basic({ 'le.json': u16(JSON.stringify(PRED)), 'be.json': be(JSON.stringify(PRED)), 'nomark.json': u16(JSON.stringify(PRED), false),
    'le.csv': u16('id,route,tags\r\na,PUB,x\r\n'), 'cfg.json': u16(JSON.stringify(CFG)) });
  for (const file of ['le.json', 'be.json', 'nomark.json', 'le.csv']) {
    const r = cli(['score', '--config', 'c.json', '--pred', file, '--key', 'k.json'], dir);
    assert.equal(r.status, 1, file);
    assert.match(r.stderr, new RegExp('\\[P17\\] ' + file.replace('.', '\\.') + ': saved as UTF-16'), file);
    assert.match(r.stderr, /[Ss]ave it as UTF-8/);
    assert.doesNotMatch(r.stderr, /\0/);
  }
  const c = cli(['check', '--config', 'cfg.json'], dir);
  assert.equal(c.status, 1);
  assert.match(c.stderr, /saved as UTF-16/);
  fs.rmSync(dir, { recursive: true });
});

// ---------- P18: outputs and inputs ----------

test('P18: an output naming an input is refused before any work, and the input is untouched', () => {
  const dir = basic();
  const before = fs.readFileSync(path.join(dir, 'k.json'), 'utf8');
  const cases = [
    [['score', ...FILES, '--json', 'k.json'], /--json k\.json is the same file as --key/],
    [['score', ...FILES, '--html', 'p.json'], /--html p\.json is the same file as --pred/],
    [['score', ...FILES, '--json', 'c.json'], /--json c\.json is the same file as --config/],
    [['score', ...FILES, '--json', './sub/../k.json'], /is the same file as --key/],
    [['compare', '--config', 'c.json', '--key', 'k.json', '--before', 'p.json', '--after', 'p.json', '--json', 'p.json'], /is the same file as --before/],
    [['variance', '--config', 'c.json', '--key', 'k.json', 'p.json', 'p.json', '--json', 'p.json'], /is the same file as a run/],
    [['whatif', ...FILES, '--gate', '--json', 'k.json'], /is the same file as --key/],
    [['suspects', '--config', 'c.json', '--key', 'k.json', 'p.json', '--json', 'p.json'], /is the same file as a run/],
    [['agree', '--config', 'c.json', '--keys', 'k.json', 'p.json', '--write-key', 'k.json'], /--write-key k\.json is the same file as a key/],
    [['grade', '--config', 'c.json', '--pred', 'p.json', '--out', 'p.json'], /--out p\.json is the same file as --pred/],
    [['estimate', '--config', 'c.json', '--pred', 'p.json', '--judge-key', 'k.json', '--pick', '1', '--json', 'k.json'], /is the same file as --judge-key/],
    [['monitor', '--counts', 'k.json', '--target', '5', '--json', 'k.json'], /is the same file as --counts/],
    [['score', '--grades', 'k.json', '--json', 'k.json'], /is the same file as --grades/],
  ];
  fs.mkdirSync(path.join(dir, 'sub'));
  for (const [args, message] of cases) {
    const r = cli(args, dir);
    assert.equal(r.status, 1, args.join(' ') + ': ' + r.stderr);
    assert.match(r.stderr, message, args.join(' '));
    assert.equal(r.stdout, '', 'no report: nothing was done');
  }
  assert.equal(fs.readFileSync(path.join(dir, 'k.json'), 'utf8'), before);
  fs.rmSync(dir, { recursive: true });
});

test('P18: --json and --html cannot name one file, nor --json and --write-key', () => {
  const dir = basic();
  const r = cli(['score', ...FILES, '--json', 'o.out', '--html', 'o.out'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--html o\.out is the same file as --json/);
  assert.equal(fs.existsSync(path.join(dir, 'o.out')), false);
  const w = cli(['agree', '--config', 'c.json', '--keys', 'k.json', 'p.json', '--write-key', 'o.out', '--json', 'o.out'], dir);
  assert.equal(w.status, 1);
  assert.match(w.stderr, /same file as/);
  fs.rmSync(dir, { recursive: true });
});

test('P18: a file the config names is an input too: the split log and an allowed list', () => {
  const dir = basic({ 'split.json': { ...CFG, split: { held_out: 0.5, log: 'log.json' } }, 'allowed.json': ['x', 'y', 'z'], 'log.json': '',
    'al.json': { ...CFG, allowed_values: { tags: { file: 'allowed.json' } } } });
  fs.rmSync(path.join(dir, 'log.json'));
  const a = cli(['score', '--config', 'split.json', '--pred', 'p.json', '--key', 'k.json', '--json', 'log.json'], dir);
  assert.equal(a.status, 1);
  assert.match(a.stderr, /--json log\.json is the same file as a file the config names/);
  const b = cli(['score', '--config', 'al.json', '--pred', 'p.json', '--key', 'k.json', '--html', 'allowed.json'], dir);
  assert.equal(b.status, 1);
  assert.match(b.stderr, /a file the config names/);
  fs.rmSync(dir, { recursive: true });
});

test('P18: on Windows a path in another case is the same file', { skip: process.platform !== 'win32' }, () => {
  const dir = basic();
  const r = cli(['score', ...FILES, '--json', 'K.JSON'], dir);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /is the same file as --key/);
  fs.rmSync(dir, { recursive: true });
});

// ---------- P19: option values ----------

test('P19: an empty option value is a bad command, whichever the option', () => {
  const dir = basic();
  const cases = [
    ['score', ...FILES, '--rulings='], ['score', ...FILES, '--json='], ['score', ...FILES, '--html='], ['score', ...FILES, '--mix='],
    ['score', '--config', 'c.json', '--pred', 'p.json', '--key='], ['score', ...FILES, '--target='], ['score', ...FILES, '--fail-on='],
    ['compare', '--config', 'c.json', '--key', 'k.json', '--before', 'p.json', '--after', 'p.json', '--after-key='],
    ['estimate', '--config', 'c.json', '--pred', 'p.json', '--judge-key', 'k.json', '--key', 'k.json', '--picks='],
    ['agree', '--config', 'c.json', '--keys', 'k.json', 'p.json', '--write-key='],
    ['monitor', '--counts=', '--target', '5'], ['score', ...FILES, '--group-by='],
  ];
  for (const a of cases) {
    const r = cli(a, dir);
    assert.equal(r.status, 2, a.join(' ') + ': ' + r.stderr);
    assert.match(r.stderr, /^bad command: --[a-z-]+ was given no value/, a.join(' '));
  }
  fs.rmSync(dir, { recursive: true });
});

test('P19: a single-value option given twice is a bad command: the last would otherwise win unseen', () => {
  const dir = basic();
  for (const a of [['score', ...FILES, '--pred', 'k.json'], ['score', ...FILES, '--key', 'p.json'], ['score', ...FILES, '--json', 'a', '--json', 'b'], ['rate', '1', '2', '--target', '5', '--target', '6']]) {
    const r = cli(a, dir);
    assert.equal(r.status, 2, a.join(' ') + ': ' + r.stderr);
    assert.match(r.stderr, /^bad command: --[a-z-]+ was given twice/);
  }
  // Options that take several are as they were.
  assert.equal(cli(['score', ...FILES, '--group-by', 'gold', '--group-by', 'id', '--quiet'], dir).status, 0);
  fs.rmSync(dir, { recursive: true });
});

// ---------- P20: scoring a run against itself ----------

const SELF = { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'route', map: MAP } };
const RUN = [{ id: 'a', route: 'PUB', tags: [{ value: 'anything', confidence: 0.9 }] }, { id: 'b', route: 'PUB', tags: [{ value: 'wrong', confidence: 0.9 }] }];

test('P20: a copy of the run as its own answer key stops, as the same path does', () => {
  const dir = folder({ 'c.json': SELF, 'run.json': RUN, 'copy.json': RUN, 'spaced.json': JSON.stringify(RUN, null, 2).replace(/\n/g, '\r\n'), 'bom.json': '﻿' + JSON.stringify(RUN) });
  for (const key of ['copy.json', 'spaced.json', 'bom.json']) {
    const r = cli(['score', '--config', 'c.json', '--pred', 'run.json', '--key', key, '--fail-on', 'low'], dir);
    assert.equal(r.status, 1, key + ': ' + r.stdout);
    assert.match(r.stderr, new RegExp('\\[A8\\] run\\.json: run\\.json and ' + key.replace('.', '\\.') + ' hold the same records'), key);
  }
  fs.rmSync(dir, { recursive: true });
});

test('P20: on Windows another case of the path stops too', { skip: process.platform !== 'win32' }, () => {
  const dir = folder({ 'c.json': SELF, 'run.json': RUN });
  const r = cli(['score', '--config', 'c.json', '--pred', 'run.json', '--key', 'RUN.JSON'], dir);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /\[A8\]/);
  fs.rmSync(dir, { recursive: true });
});

test('P20: variance, compare, whatif and suspects stop the same way, and on every run after the first', () => {
  const dir = folder({ 'c.json': SELF, 'run.json': RUN, 'other.json': RUN.map(r => ({ ...r, note: 'differs' })), 'copy.json': RUN });
  const cases = [
    ['variance', '--config', 'c.json', '--key', 'run.json', 'copy.json', 'other.json'],
    ['variance', '--config', 'c.json', '--key', 'run.json', 'other.json', 'copy.json'],
    ['compare', '--config', 'c.json', '--key', 'run.json', '--before', 'other.json', '--after', 'copy.json'],
    ['whatif', '--config', 'c.json', '--pred', 'copy.json', '--key', 'run.json', '--hold-if', 'tags=*'],
    ['suspects', '--config', 'c.json', '--key', 'run.json', 'copy.json'],
  ];
  for (const a of cases) {
    const r = cli(a, dir);
    assert.equal(r.status, 1, a.join(' ') + ': ' + r.stdout);
    assert.match(r.stderr, /\[A8\]/, a.join(' '));
  }
  fs.rmSync(dir, { recursive: true });
});

test('P20: estimate stops when the judge\'s or the person\'s key is the run itself', () => {
  const C = { outputs: { tags: { type: 'set' } }, routing: { field: 'route', map: MAP } };
  const dir = folder({ 'c.json': C, 'run.json': RUN, 'copy.json': RUN, 'j.json': [{ id: 'a', tags: ['x'] }, { id: 'b', tags: ['y'] }] });
  const judge = cli(['estimate', '--config', 'c.json', '--pred', 'run.json', '--judge-key', 'copy.json', '--key', 'j.json'], dir);
  assert.equal(judge.status, 1, judge.stdout);
  assert.match(judge.stderr, /\[A8\]/);
  const pick = cli(['estimate', '--config', 'c.json', '--pred', 'run.json', '--judge-key', 'copy.json', '--pick', '1'], dir);
  assert.equal(pick.status, 1, pick.stdout);
  assert.match(pick.stderr, /\[A8\]/);
  const person = cli(['estimate', '--config', 'c.json', '--pred', 'run.json', '--judge-key', 'j.json', '--key', 'copy.json'], dir);
  assert.equal(person.status, 1, person.stdout);
  assert.match(person.stderr, /\[A8\]/);
  fs.rmSync(dir, { recursive: true });
});

test('P20: one file holding both, read from different fields, is as it was, under any name', () => {
  const C = { outputs: { tags: { type: 'set', key_field: 'answer' } }, routing: { field: 'route', map: MAP } };
  const rows = [{ id: 'a', route: 'PUB', tags: ['x'], answer: ['x'] }];
  const dir = folder({ 'c.json': C, 'run.json': rows, 'copy.json': rows });
  assert.equal(cli(['score', '--config', 'c.json', '--pred', 'run.json', '--key', 'copy.json', '--quiet'], dir).status, 0);
  fs.rmSync(dir, { recursive: true });
});

// ---------- P21: the marks problems put around ids ----------

test('P21: a value holding a mark character reads as text: the run is scored or stops by name, at once', () => {
  const { unmark, markId } = require('../src/problems.js');
  const lone = 'value  here';
  assert.equal(unmark(lone).text, lone);
  assert.deepEqual(unmark(lone).ids, []);
  assert.equal(unmark('ab').text, 'ab');
  const t = unmark('xy ' + markId('id1') + ' z');
  assert.equal(t.text, 'xy id1 z');
  assert.deepEqual(t.ids.map(i => i.id), ['id1']);
  // An id that holds the marks itself keeps them, in the text and as the id a mask compares.
  const odd = unmark('at ' + markId('abc') + ' end');
  assert.equal(odd.text, 'at abc end');
  assert.deepEqual(odd.ids.map(i => i.id), ['abc']);
  const shown = unmark(markId('real', ' real '));
  assert.equal(shown.text, ' real ');
  assert.deepEqual(shown.ids.map(i => i.id), ['real']);

  const dir = basic({
    'set.json': [{ id: 'a', route: 'PUB', tags: [{ value: ' x', confidence: 0.9 }] }, PRED[1]],
    'route.json': [{ id: 'a', route: 'PUB', tags: [] }, PRED[1]],
  });
  const started = Date.now();
  const s = cli(['score', '--config', 'c.json', '--pred', 'set.json', '--key', 'k.json'], dir);
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /trimmed spaces from " x"/);
  const r = cli(['score', '--config', 'c.json', '--pred', 'route.json', '--key', 'k.json'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\[C1\]/);
  assert.ok(Date.now() - started < 5000);
  fs.rmSync(dir, { recursive: true });
});

test('P21: an id holding mark characters is still kept out of a report by the mask', () => {
  const ids = Array.from({ length: 40 }, (_, i) => 'r' + i);
  const dir = folder({
    'c.json': { ...CFG, split: { held_out: 0.5, by: 'id' } },
    'k.json': ids.map(id => ({ id, gold: 'PUB', tags: ['x'] })),
    'p.json': ids.map(id => ({ id: ' ' + id + ' ', route: 'PUB', tags: ['x'] })),
  });
  const r = cli(['check', '--config', 'c.json', '--pred', 'p.json', '--key', 'k.json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const named = (r.stdout.match(/trimmed spaces from id "/g) || []).length;
  assert.ok(named > 0 && named < 40, 'the tuning half is named, the held-out half counted: ' + named);
  assert.match(r.stdout, /held-out record/);
  fs.rmSync(dir, { recursive: true });
});

// ---------- P23: a look is spent only on a report ----------

test('P23: a compare that stops on its gate names spends no look', () => {
  const key = [], pred = [];
  for (let i = 0; i < 30; i++) { key.push({ id: 'r' + i, tags: ['x'] }); pred.push({ id: 'r' + i, route: 'PUB', tags: ['x'] }); }
  const dir = folder({ 'c.json': { outputs: { tags: { type: 'set' } }, routing: { field: 'route', map: MAP }, split: { held_out: 0.5, log: 'log.json' } }, 'k.json': key, 'a.json': pred, 'b.json': pred.map(r => ({ ...r, v: 2 })) });
  const r = cli(['compare', '--config', 'c.json', '--key', 'k.json', '--before', 'a.json', '--after', 'b.json', '--held-out', '--fail-if-worse', 'misroutes'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not measured by this compare/);
  assert.equal(fs.existsSync(path.join(dir, 'log.json')), false, 'no look recorded');
  const ok = cli(['compare', '--config', 'c.json', '--key', 'k.json', '--before', 'a.json', '--after', 'b.json', '--held-out', '--fail-if-worse', 'silent-errors'], dir);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'log.json'), 'utf8')).looks.length, 1);
  fs.rmSync(dir, { recursive: true });
});

// ---------- P24: a reader that goes away ----------

function intoClosedPipe(args, cwd) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [WFEVAL, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.stdout.once('data', () => child.stdout.destroy());
    child.on('close', code => resolve({ code, err }));
  });
}

test('P24: a closed pipe ends the report quietly, and the exit code is the one the run earned', async () => {
  const key = [], pred = [];
  for (let i = 0; i < 6000; i++) { key.push({ id: 'record-' + i, gold: 'PUB', tags: ['x' + i] }); pred.push({ id: 'record-' + i, route: 'PUB', tags: ['y' + i] }); }
  const dir = folder({ 'c.json': CFG, 'k.json': key, 'p.json': pred });
  const plain = await intoClosedPipe(['score', ...FILES], dir);
  assert.equal(plain.code, 0, plain.err.slice(0, 400));
  assert.doesNotMatch(plain.err, /EPIPE|\n\s+at /);
  const gated = await intoClosedPipe(['score', ...FILES, '--fail-on', 'low'], dir);
  assert.equal(gated.code, 3, gated.err.slice(0, 400));
  assert.doesNotMatch(gated.err, /EPIPE|\n\s+at /);
  fs.rmSync(dir, { recursive: true });
});

// ---------- P39: files a config names ----------

test('P39: a file a config names is never quoted in an error', () => {
  const dir = basic({ 'secret.txt': 'secret-api-key-123 and more', 'a.json': { ...CFG, allowed_values: { tags: { file: 'secret.txt' } } }, 'l.json': { ...CFG, split: { log: 'secret.txt' } } });
  const a = cli(['check', '--config', 'a.json'], dir);
  assert.equal(a.status, 1);
  assert.match(a.stderr, /allowed_values\.tags: .*secret\.txt.* not valid JSON/);
  assert.doesNotMatch(a.stderr, /secret-a/);
  const b = cli(['score', '--config', 'l.json', '--pred', 'p.json', '--key', 'k.json', '--held-out'], dir);
  assert.equal(b.status, 1);
  assert.match(b.stderr, /\[O11\].*not valid JSON/);
  assert.doesNotMatch(b.stderr, /secret-a/);
  fs.rmSync(dir, { recursive: true });
});

// ---------- P40 ----------

test('P40: compare --json carries the paired table the terminal prints', () => {
  const dir = basic({ 'q.json': PRED.map(r => ({ ...r, route: 'ASK' })) });
  const r = cli(['compare', '--config', 'c.json', '--key', 'k.json', '--before', 'p.json', '--after', 'q.json', '--json', 'o.json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(fs.readFileSync(path.join(dir, 'o.json'), 'utf8'));
  assert.equal(o.paired.records, 2);
  const silent = o.paired.outcomes.find(x => x.name === 'silent errors');
  assert.deepEqual([silent.before, silent.after, silent.fixed, silent.broke, silent.verdict], [1, 0, 1, 0, 'unclear']);
  assert.ok(!Object.hasOwn(JSON.parse(fs.readFileSync(path.join(dir, 'o.json'), 'utf8')), 'records_paired'));
  // score keeps its paired records out of the JSON, as ever: they are the inputs.
  cli(['score', ...FILES, '--json', 's.json', '--quiet'], dir);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 's.json'), 'utf8')).paired, undefined);
  fs.rmSync(dir, { recursive: true });
});

test('a report object is rendered as it was: forTerminal gives renderTerminal the same text for ordinary records', () => {
  const dir = basic();
  const { loadConfig } = require('../src/config.js');
  const { scoreRun } = require('../src/score.js');
  const r = scoreRun({ config: loadConfig(path.join(dir, 'c.json')), predPath: path.join(dir, 'p.json'), keyPath: path.join(dir, 'k.json') });
  assert.equal(renderTerminal(forTerminal(r)), renderTerminal(r));
  fs.rmSync(dir, { recursive: true });
});
