// What an independent review of the Nov 3 audit's own stops and gates found: stops on fields a
// command does not use, gates that failed healthy workflows, and the ways round the rest.
// test/TRAPS.md, section P.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { rate, boundPct } = require('../src/metrics/stats.js');
const { targetCheck } = require('../src/metrics/target.js');
const { scoreRun } = require('../src/score.js');
const { loadConfig } = require('../src/config.js');
const { escapeControls, closedReader } = require('../src/text.js');
const { thousands } = require('../src/values.js');

const WFEVAL = path.join(__dirname, '..', 'bin', 'wfeval.js');
const MAP = { PUB: 'auto', ASK: 'review', DENY: 'block', DUP: 'exclude' };
const cli = (args, cwd) => spawnSync(process.execPath, [WFEVAL, ...args], { cwd, encoding: 'utf8' });
function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-review-'));
  for (const [name, x] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof x === 'string' ? x : JSON.stringify(x));
  }
  return dir;
}
const value = v => ({ value: v, confidence: 0.9 });
const CFG = { outputs: { tags: { type: 'set' } }, routing: { field: 'route', map: MAP } };
const GOLD = { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP } };
const SCORE = ['score', '--config', 'c.json', '--pred', 'p.json', '--key', 'k.json'];
const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));

// ---------- P1 across a command's files: one quiet file is not a misspelt field ----------

// n8n drops empty lists: a week with nothing found has no "tags" on any record.
const QUIET = [{ id: 'q1', route: 'PUB' }, { id: 'q2', route: 'PUB' }];
const BUSY = [{ id: 'b1', route: 'PUB', tags: [value('x')] }, { id: 'b2', route: 'PUB' }];
const COMBINED = { outputs: { tags: { type: 'set', key_field: 'answer' } }, routing: { field: 'route', map: MAP } };
const answered = rows => rows.map(r => ({ ...r, answer: r.tags ? ['x'] : [] }));

test('P1: monitor: a period with no record holding the field warns; the series runs, whichever comes first', () => {
  for (const names of [['2026-W01.json', '2026-W02.json'], ['2026-W02.json', '2026-W01.json']]) {
    const [busy, quiet] = names;
    const dir = folder({ 'c.json': COMBINED, [busy]: answered(BUSY), [quiet]: answered(QUIET) });
    const r = cli(['monitor', '--config', 'c.json', '2026-W01.json', '2026-W02.json', '--target', '5'], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp('\\[P1\\] ' + quiet.replace('.', '\\.') + ': no record has "tags"'));
    assert.doesNotMatch(r.stdout, new RegExp('\\[P1\\] ' + busy.replace('.', '\\.')));
  }
});

test('P1: monitor: no period holds the field: strict, saying what --lenient is for', () => {
  const dir = folder({ 'c.json': COMBINED, 'w1.json': answered(QUIET), 'w2.json': answered([{ id: 'q3', route: 'PUB' }]) });
  const args = ['monitor', '--config', 'c.json', 'w1.json', 'w2.json', '--target', '5'];
  const r = cli(args, dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\* \[P1\].*no record in any of the 2 files has "tags" \(outputs\.tags\.field\).*if the workflow leaves out empty lists, use --lenient/);
  const lenient = cli([...args, '--lenient'], dir);
  assert.equal(lenient.status, 0, lenient.stderr);
  assert.match(lenient.stdout, /\[P1\]/);
});

test('P1: variance: one run lacking the field warns; every run lacking it stops', () => {
  const key = [{ id: 'a', tags: [] }, { id: 'b', tags: [] }];
  const has = [{ id: 'a', route: 'PUB', tags: [] }, { id: 'b', route: 'PUB', tags: [value('x')] }];
  const lacks = [{ id: 'a', route: 'PUB' }, { id: 'b', route: 'PUB' }];
  const dir = folder({ 'c.json': CFG, 'k.json': key, 'r1.json': has, 'r2.json': lacks, 'r3.json': [...lacks].reverse() });
  const one = cli(['variance', '--config', 'c.json', '--key', 'k.json', 'r1.json', 'r2.json'], dir);
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /\[P1\] r2\.json: no record has "tags"/);
  const all = cli(['variance', '--config', 'c.json', '--key', 'k.json', 'r2.json', 'r3.json'], dir);
  assert.equal(all.status, 1);
  assert.match(all.stderr, /\* \[P1\].*no record in any of the 2 files has "tags"/);
});

test('P1: compare: either run may be the quiet one; noise runs count as the command\'s files', () => {
  const key = [{ id: 'a', tags: [] }, { id: 'b', tags: [] }];
  const has = [{ id: 'a', route: 'PUB', tags: [] }, { id: 'b', route: 'PUB', tags: [value('x')] }];
  const lacks = [{ id: 'a', route: 'PUB' }, { id: 'b', route: 'PUB' }];
  const dir = folder({ 'c.json': CFG, 'k.json': key, 'has.json': has, 'lacks.json': lacks, 'lacks2.json': [...lacks].reverse() });
  const args = (b, a) => ['compare', '--config', 'c.json', '--key', 'k.json', '--before', b, '--after', a];
  for (const [b, a] of [['has.json', 'lacks.json'], ['lacks.json', 'has.json']]) {
    const r = cli(args(b, a), dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\[P1\] lacks\.json: no record has "tags"/);
  }
  assert.equal(cli(args('lacks.json', 'lacks2.json'), dir).status, 1);
  const noise = cli([...args('lacks.json', 'lacks2.json'), '--noise', 'has.json', '--noise', 'lacks.json'], dir);
  assert.equal(noise.status, 0, noise.stderr);
});

test('P1: suspects reads several runs too: one lacking the field warns', () => {
  const key = [{ id: 'a', tags: [] }, { id: 'b', tags: [] }];
  const has = [{ id: 'a', route: 'PUB', tags: [] }, { id: 'b', route: 'PUB', tags: [value('x')] }];
  const lacks = [{ id: 'a', route: 'PUB' }, { id: 'b', route: 'PUB' }];
  const dir = folder({ 'c.json': CFG, 'k.json': key, 'r1.json': has, 'r2.json': lacks });
  const r = cli(['suspects', '--config', 'c.json', '--key', 'k.json', 'r1.json', 'r2.json'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[P1\] r2\.json: no record has "tags"/);
});

test('P1: a file of failed calls says nothing either way about the field', () => {
  const failed = [{ id: 'f1', route: 'ASK', scored: false }, { id: 'f2', route: 'ASK', scored: false }];
  const dir = folder({ 'c.json': COMBINED, 'w1.json': answered(BUSY), 'w2.json': answered(failed).map(r => ({ ...r, answer: [] })) });
  const r = cli(['monitor', '--config', 'c.json', 'w1.json', 'w2.json', '--target', '5'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\[P1\] w2\.json/);
});

test('P1: a single score or check stays strict, and says what --lenient is for', () => {
  const dir = folder({ 'c.json': CFG, 'k.json': [{ id: 'a', tags: [] }], 'p.json': [{ id: 'a', route: 'PUB' }] });
  for (const r of [cli(SCORE, dir), cli(['check', ...SCORE.slice(1)], dir)]) {
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\* \[P1\] p\.json: no record has "tags" \(outputs\.tags\.field\); if the workflow leaves out empty lists, use --lenient/);
  }
});

// ---------- P1 asks only about the fields a command uses ----------

const KEY2 = [{ id: 'a', tags: ['t'] }, { id: 'b', tags: ['t'] }];
const RUN2 = [{ id: 'a', route: 'PUB', tags: [value('t')] }, { id: 'b', route: 'PUB', tags: [value('t')] }];
const run = (cfg, args = SCORE, files = {}) => {
  const dir = folder({ 'c.json': cfg, 'k.json': KEY2, 'p.json': RUN2, ...files });
  return { ...cli(args, dir), dir };
};

test('P1: whatif.movable_field is whatif\'s: score never asks, whatif stops', () => {
  const cfg = { ...CFG, whatif: { movable_field: 'branch', movable_values: [1] } };
  const r = run(cfg);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /branch/);
  const w = run(cfg, ['whatif', ...SCORE.slice(1), '--gate', '--target', '5']);
  assert.equal(w.status, 1);
  assert.match(w.stderr, /\[P1\] p\.json: no record has "branch" \(whatif\.movable_field\)/);
});

test('P1: a cluster or group no record has warns unless the command needs it', () => {
  for (const [extra, at] of [[{ clusters: { field: 'story' } }, 'clusters\\.field'], [{ groups: { chan: { field: 'chan' } } }, 'groups\\.chan\\.field'],
    [{ clusters: { field: 'story', from: 'predictions' } }, 'clusters\\.field'], [{ groups: { chan: { field: 'chan', from: 'predictions' } } }, 'groups\\.chan\\.field']]) {
    const r = run({ ...CFG, ...extra });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp('warn \\[P1\\] [kp]\\.json: no record has "(story|chan)" \\(' + at + '\\)'));
  }
});

test('P1: --cluster-by, --group-by and --mix need their field: they stop', () => {
  const cluster = run(CFG, [...SCORE, '--cluster-by', 'story']);
  assert.equal(cluster.status, 1);
  assert.match(cluster.stderr, /\* \[P1\] k\.json: no record has "story"/);
  const group = run(CFG, [...SCORE, '--group-by', 'chan']);
  assert.equal(group.status, 1);
  assert.match(group.stderr, /\* \[P1\] k\.json: no record has "chan"/);
  const mix = run({ ...CFG, groups: { chan: { field: 'chan' } } }, [...SCORE, '--mix', 'm.json'], { 'm.json': { group: 'chan', shares: { x: 1 } } });
  assert.equal(mix.status, 1);
  assert.match(mix.stderr, /\[P1\] k\.json: no record has "chan"/);
});

test('P1: a split that follows clusters needs them, a split by id does not', () => {
  const key = many(8, i => ({ id: 'r' + i, tags: ['t'] }));
  const pred = many(8, i => ({ id: 'r' + i, route: 'PUB', tags: [value('t')] }));
  const cfg = by => ({ ...CFG, clusters: { field: 'story' }, split: { held_out: 0.5, by } });
  const follows = run(cfg('cluster'), SCORE, { 'k.json': key, 'p.json': pred });
  assert.equal(follows.status, 1);
  assert.match(follows.stderr, /\* \[P1\] k\.json: no record has "story"/);
  const byId = run(cfg('id'), SCORE, { 'k.json': key, 'p.json': pred });
  assert.equal(byId.status, 0, byId.stderr);
});

test('P1: variance and compare ask nothing of clusters or groups, which they do not read', () => {
  const cfg = { ...CFG, groups: { chan: { field: 'chan' } }, clusters: { field: 'story' } };
  const dir = folder({ 'c.json': cfg, 'k.json': KEY2, 'r1.json': RUN2, 'r2.json': [...RUN2].reverse() });
  assert.equal(cli(['variance', '--config', 'c.json', '--key', 'k.json', 'r1.json', 'r2.json'], dir).status, 0);
  assert.equal(cli(['compare', '--config', 'c.json', '--key', 'k.json', '--before', 'r1.json', '--after', 'r2.json'], dir).status, 0);
});

// ---------- P2: monitor's gate fails only when nothing was evaluated ----------

const out = (r, dir) => JSON.parse(fs.readFileSync(path.join(dir, r)));

test('P2: monitor: every record sent to a person, scored and right: the gate reads no alarm, and the report warns', () => {
  const week = (w, route) => many(3, i => ({ id: w + i, route, tags: [value('t')], answer: ['t'] }));
  const dir = folder({ 'c.json': COMBINED, 'w1.json': week('a', 'ASK'), 'w2.json': week('b', 'ASK') });
  const r = cli(['monitor', '--config', 'c.json', 'w1.json', 'w2.json', '--target', '5', '--fail-on-alarm', '--json', 'o.json'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /NOTHING WAS EVALUATED/);
  assert.match(r.stdout, /\[P2\].*No record went out without review in any period/);
  assert.equal(out('o.json', dir).nothing_evaluated, undefined);
});

test('P2: monitor --watch silent-omissions with nothing blocked is a healthy workflow, not nothing evaluated', () => {
  const cfg = { outputs: { tags: { type: 'set', key_field: 'answer' } }, routing: { field: 'route', gold_field: 'gold', map: MAP } };
  const week = w => many(3, i => ({ id: w + i, route: 'PUB', gold: 'PUB', tags: [value('t')], answer: ['t'] }));
  const dir = folder({ 'c.json': cfg, 'w1.json': week('a'), 'w2.json': week('b') });
  const r = cli(['monitor', '--config', 'c.json', 'w1.json', 'w2.json', '--target', '5', '--watch', 'silent-omissions', '--fail-on-alarm'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[P2\].*blocked or suppressed/);
});

test('P2: monitor: no period with a scored record is nothing evaluated, with --since counting from that period', () => {
  const failed = w => many(2, i => ({ id: w + i, route: 'ASK', scored: false, answer: ['t'] }));
  const fine = w => many(2, i => ({ id: w + i, route: 'PUB', tags: [value('t')], answer: ['t'] }));
  const dir = folder({ 'c.json': COMBINED, '2026-W01.json': failed('a'), '2026-W02.json': failed('b'), '2026-W03.json': fine('c') });
  const args = f => ['monitor', '--config', 'c.json', ...f, '--target', '5', '--fail-on-alarm'];
  const none = cli(args(['2026-W01.json', '2026-W02.json']), dir);
  assert.equal(none.status, 3);
  assert.match(none.stderr, /nothing was evaluated: no record was scored in any period/);
  const some = cli(args(['2026-W01.json', '2026-W02.json', '2026-W03.json']), dir);
  assert.equal(some.status, 0, some.stderr);
  const late = cli([...args(['2026-W03.json', '2026-W04.json']), '--since', '2026-W04'], folder({ 'c.json': COMBINED, '2026-W03.json': fine('c'), '2026-W04.json': failed('d') }));
  assert.equal(late.status, 3);
  assert.match(late.stderr, /no record was scored in any period from 2026-W04 on/);
});

test('P2: a counts file: every count column zero is nothing evaluated; records out but none blocked is not', () => {
  const row = (period, a, b, c, d) => ({ period, out_without_review: a, silent_errors: b, blocked_or_suppressed: c, silent_omissions: d });
  const args = file => ['monitor', '--counts', file, '--target', '5', '--fail-on-alarm'];
  const zero = folder({ 'n.json': [row('2026-W01', 0, 0, 0, 0), row('2026-W02', 0, 0, 0, 0)] });
  const r0 = cli(args('n.json'), zero);
  assert.equal(r0.status, 3);
  assert.match(r0.stderr, /nothing was evaluated: every count is zero in every period/);
  const blocked = folder({ 'n.json': [row('2026-W01', 0, 0, 4, 0), row('2026-W02', 0, 0, 3, 0)] });
  const r1 = cli(args('n.json'), blocked);
  assert.equal(r1.status, 0, r1.stderr);
  assert.match(r1.stdout, /\[P2\]/);
  const out2 = folder({ 'n.json': [row('2026-W01', 50, 0, 0, 0), row('2026-W02', 50, 0, 0, 0)] });
  const r2 = cli([...args('n.json'), '--watch', 'silent-omissions'], out2);
  assert.equal(r2.status, 0, r2.stderr);
  const plain = folder({ 'n.json': [{ period: '2026-W01', out_without_review: 0, silent_errors: 0 }] });
  assert.equal(cli(args('n.json'), plain).status, 3);
});

// ---------- P20: the key is the run, however it was rearranged ----------

const SIX = many(6, i => ({ id: 'r' + i, route: 'PUB', tags: [value('wrong-' + i)] }));
const self = (key, cfg = CFG, pred = SIX) => {
  const dir = folder({ 'c.json': cfg, 'p.json': pred, 'k.json': key });
  return cli([...SCORE, '--fail-on', 'low'], dir);
};

test('P20: a key that is the run in another order stops', () => {
  const r = self([...SIX].reverse());
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /\[A8\] p\.json: p\.json and k\.json hold the same records/);
});

test('P20: fields written in another order, a note added: the same', () => {
  const swapped = SIX.map(({ id, route, tags }) => ({ tags: tags.map(({ value: v, confidence }) => ({ confidence, value: v })), route, id }));
  const noted = SIX.map((r, i) => (i === 0 ? { ...r, note: 'x' } : r));
  for (const key of [swapped, noted]) {
    const r = self(key);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /\[A8\]/);
  }
});

test('P20: whole records alike in another order stop with no confidence too; a note added then leaves the warning', () => {
  const plain = many(3, i => ({ id: 'r' + i, route: 'PUB', tags: ['t' + i] }));
  assert.equal(self([...plain].reverse(), CFG, plain).status, 1);
  const noted = plain.map(r => ({ ...r, note: 'checked' }));
  const r = self(noted, CFG, plain);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /warn \[A8\] p\.json: every prediction matches the answer key exactly and none has a confidence/);
});

test('P20: a perfect run against a key with no route and no confidence is the warning, as it was', () => {
  const pred = many(3, i => ({ id: 'r' + i, route: 'PUB', tags: ['t' + i] }));
  const r = self(pred.map(({ id, tags }) => ({ id, tags })), CFG, pred);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /warn \[A8\]/);
});

test('P20: every prediction matches and the key\'s values carry confidences: warned, though the routes differ', () => {
  const key = SIX.map(({ id, tags }) => ({ id, tags }));
  const r = self(key);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /warn \[A8\] p\.json: every prediction matches the answer key exactly, and the key's values carry confidences/);
  const earlier = SIX.map(({ id, tags }) => ({ id, tags: tags.map(t => ({ ...t, confidence: 0.5 })) }));
  assert.match(self(earlier).stdout, /warn \[A8\].*carry confidences/);
});

test('P20: a real key with the same id is not read as the run', () => {
  const key = SIX.map(({ id }, i) => ({ id, tags: ['wrong-' + i] }));
  const r = self(key);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /\[A8\]/);
});

test('P20: variance stops when the second run is the key, in another order, against a key already read', () => {
  const key = SIX;
  const other = SIX.map(r => ({ ...r, route: 'ASK' }));
  const dir = folder({ 'c.json': CFG, 'k.json': key, 'r1.json': other, 'r2.json': [...SIX].reverse() });
  const r = cli(['variance', '--config', 'c.json', '--key', 'k.json', 'r1.json', 'r2.json'], dir);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /\[A8\] r2\.json/);
});

test('P20: estimate sees the same, by id and with keys in any order', () => {
  const person = SIX.map(({ id }) => ({ id, tags: ['t'] }));
  const dir = folder({ 'c.json': CFG, 'p.json': SIX, 'k.json': [...SIX].reverse(), 'q.json': person });
  const r = cli(['estimate', '--config', 'c.json', '--pred', 'p.json', '--judge-key', 'k.json', '--key', 'q.json'], dir);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /\[A8\] p\.json: p\.json and k\.json hold the same records/);
});

test('P20: the normal path reads a key once, whatever the number of runs', () => {
  const dir = folder({ 'c.json': CFG, 'k.json': KEY2, 'r1.json': RUN2, 'r2.json': [...RUN2].reverse(), 'r3.json': RUN2 });
  const config = loadConfig(path.join(dir, 'c.json'));
  const keyPath = path.join(dir, 'k.json');
  const keys = new Map();
  const read = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function counted(file, ...rest) {
    if (file === keyPath) reads++;
    return read.call(fs, file, ...rest);
  };
  try {
    for (const f of ['r1.json', 'r2.json', 'r3.json']) scoreRun({ config, predPath: path.join(dir, f), keyPath, parts: 'rates', keys });
  } finally { fs.readFileSync = read; }
  assert.equal(reads, 1);
});

// ---------- P1: null, and a field almost no record has ----------

test('P1: null on every record is a field no record has', () => {
  const r = run(CFG, SCORE, { 'p.json': RUN2.map(({ id, route }) => ({ id, route, tags: null })) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\* \[P1\] p\.json: no record has "tags"/);
});

test('P1: a field missing on at least 90% of the records is one warning, with the count', () => {
  const pred = (n, have) => many(n, i => ({ id: 'r' + i, route: 'ASK', ...(i < have ? { tags: [value('t')] } : {}) }));
  const key = n => many(n, i => ({ id: 'r' + i, tags: i < 2 ? ['t'] : [] }));
  const nearly = run(CFG, SCORE, { 'p.json': pred(20, 2), 'k.json': key(20) });
  assert.equal(nearly.status, 0, nearly.stderr);
  assert.equal(nearly.stdout.match(/warn \[P1\]/g).length, 1);
  assert.match(nearly.stdout, /warn \[P1\] p\.json: 18 of 20 records have no "tags" \(outputs\.tags\.field\): each is read as nothing found/);
  const under = run(CFG, SCORE, { 'p.json': pred(20, 3), 'k.json': key(20) });
  assert.doesNotMatch(under.stdout, /\[P1\]/);
});

test('P1: failed calls do not count toward that share', () => {
  const pred = many(20, i => ({ id: 'r' + i, route: 'ASK', ...(i < 10 ? { scored: false } : { tags: [value('t')] }) }));
  const r = run(CFG, SCORE, { 'p.json': pred, 'k.json': many(20, i => ({ id: 'r' + i, tags: ['t'] })) });
  assert.doesNotMatch(r.stdout, /\[P1\]/);
});

// ---------- P2: most calls failed, and nothing judged ----------

const failedRun = (n, failed) => many(n, i => ({ id: 'r' + i, route: i < failed ? 'ASK' : 'PUB', ...(i < failed ? { scored: false } : { tags: [value('t')] }) }));
const failedKey = n => many(n, i => ({ id: 'r' + i, tags: ['t'] }));

test('P2: more than half the calls failed: the gate has not passed, with the count and the share', () => {
  const r = run(CFG, [...SCORE, '--fail-on', 'low'], { 'p.json': failedRun(100, 99), 'k.json': failedKey(100) });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /nothing was evaluated: most model calls failed \(99 of 100 records, 99%\)/);
  assert.match(r.stdout, /NOTHING WAS EVALUATED/);
});

test('P2: exactly half is the old rule: a warning, and the gate reads what is left', () => {
  const half = run(CFG, [...SCORE, '--fail-on', 'low'], { 'p.json': failedRun(100, 50), 'k.json': failedKey(100) });
  assert.equal(half.status, 0, half.stderr);
  assert.match(half.stdout, /warn \[I6\]/);
  const over = run(CFG, [...SCORE, '--fail-on', 'low'], { 'p.json': failedRun(100, 51), 'k.json': failedKey(100) });
  assert.equal(over.status, 3);
  assert.match(over.stderr, /51 of 100 records, 51%/);
});

test('P2: compare: more than half failed in either run fails the gate', () => {
  const dir = folder({ 'c.json': CFG, 'k.json': failedKey(100), 'ok.json': failedRun(100, 0), 'bad.json': failedRun(100, 99) });
  const args = (b, a) => ['compare', '--config', 'c.json', '--key', 'k.json', '--before', b, '--after', a, '--fail-if-worse', 'any'];
  for (const [b, a] of [['ok.json', 'bad.json'], ['bad.json', 'ok.json']]) {
    const r = cli(args(b, a), dir);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /most model calls failed \(99 of 100 records, 99%\)/);
  }
});

test('P2: estimate: more than half failed fails the gate too', () => {
  const pred = many(10, i => ({ id: 'r' + i, route: 'PUB', ...(i < 8 ? { scored: false } : { tags: [value('t')] }) }));
  const judge = many(10, i => ({ id: 'r' + i, tags: ['t'] }));
  const person = many(4, i => ({ id: 'r' + (i + 6), tags: ['t'] }));
  const dir = folder({ 'c.json': CFG, 'p.json': pred, 'j.json': judge, 'q.json': person });
  const r = cli(['estimate', '--config', 'c.json', '--pred', 'p.json', '--judge-key', 'j.json', '--key', 'q.json', '--target', '5', '--fail-if-not-shown'], dir);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stderr, /most model calls failed \(8 of 10 records, 80%\)/);
});

test('P2: every record blocked with no correct route to judge them is nothing evaluated', () => {
  const pred = many(4, i => ({ id: 'r' + i, route: 'DENY', tags: [value('t')] }));
  const r = run(CFG, [...SCORE, '--fail-on', 'low'], { 'p.json': pred, 'k.json': failedKey(4) });
  assert.equal(r.status, 3, r.stdout);
  assert.match(r.stderr, /nothing was evaluated: every record was blocked or suppressed \(4 of 4\), with no correct route to judge them/);
});

test('P2: every record blocked with a correct route is judged: the gate reads the silent omissions', () => {
  const pred = many(4, i => ({ id: 'r' + i, route: 'DENY', tags: [value('t')] }));
  const key = many(4, i => ({ id: 'r' + i, tags: ['t'], gold: i === 0 ? 'PUB' : 'DENY' }));
  const bad = run(GOLD, [...SCORE, '--fail-on', 'low'], { 'p.json': pred, 'k.json': key });
  assert.equal(bad.status, 3, bad.stdout);
  assert.doesNotMatch(bad.stderr, /nothing was evaluated/);
  assert.match(bad.stderr, /r0 \(.*silent omission\)/);
});

test('P2: one record sent to a person among the blocked is judged', () => {
  const pred = many(4, i => ({ id: 'r' + i, route: i ? 'DENY' : 'ASK', tags: [value('t')] }));
  const r = run(CFG, [...SCORE, '--fail-on', 'low'], { 'p.json': pred, 'k.json': failedKey(4) });
  assert.equal(r.status, 0, r.stderr);
});

test('P2: every record blocked whose label was declined can be judged with no correct route', () => {
  const cfg = { outputs: { kind: { type: 'label', labels: ['a', 'b'], decline: { values: ['none'] } } }, routing: { field: 'route', map: MAP } };
  const pred = many(2, i => ({ id: 'r' + i, route: 'DENY', kind: 'none' }));
  const dir = folder({ 'c.json': cfg, 'p.json': pred, 'k.json': many(2, i => ({ id: 'r' + i, kind: 'a' })) });
  const r = cli([...SCORE, '--fail-on', 'low'], dir);
  assert.doesNotMatch(r.stderr, /nothing was evaluated/);
});

// ---------- P18: a hard link is the same file ----------

test('P18: an output option naming a hard link to an input stops, and the input is whole', () => {
  const dir = folder({ 'c.json': CFG, 'k.json': KEY2, 'p.json': RUN2 });
  try { fs.linkSync(path.join(dir, 'k.json'), path.join(dir, 'hard.json')); } catch { return; }   // no hard links on this disk
  const before = fs.readFileSync(path.join(dir, 'k.json'), 'utf8');
  const r = cli([...SCORE, '--json', 'hard.json'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--json hard\.json is the same file as --key/);
  assert.equal(fs.readFileSync(path.join(dir, 'k.json'), 'utf8'), before);
});

test('P18: a new file is no input, and two files with their own contents are told apart', () => {
  const dir = folder({ 'c.json': CFG, 'k.json': KEY2, 'p.json': RUN2, 'old.json': '{}' });
  assert.equal(cli([...SCORE, '--json', 'new.json'], dir).status, 0);
  assert.equal(cli([...SCORE, '--json', 'old.json'], dir).status, 0);
});

// ---------- P41: no look at a run that evaluated nothing ----------

const SPLIT = { ...GOLD, split: { held_out: 0.5, by: 'id', log: 'split-log.json' } };
const splitKey = many(20, i => ({ id: 'r' + i, tags: ['t'], gold: 'PUB' }));
const splitRun = many(20, i => ({ id: 'r' + i, route: 'PUB', tags: [value('t')] }));
const allFailed = many(20, i => ({ id: 'r' + i, route: 'ASK', scored: false }));
const noLog = dir => assert.equal(fs.existsSync(path.join(dir, 'split-log.json')), false);

test('P41: score --held-out on a run that evaluated nothing spends no look and shows nothing of the half', () => {
  const dir = folder({ 'c.json': SPLIT, 'k.json': splitKey, 'p.json': allFailed });
  const r = cli([...SCORE, '--held-out', '--json', 'o.json'], dir);
  assert.equal(r.status, 0, r.stderr);
  noLog(dir);
  const o = out('o.json', dir);
  assert.equal(o.split.looked, false);
  assert.match(o.split.not_looked, /every model call failed/);
  assert.match(r.stdout, /HELD-OUT HALF {2}not looked at: every model call failed.*so no look was spent/s);
});

test('P41: the gate on it says why, and a look works once the run is good', () => {
  const dir = folder({ 'c.json': SPLIT, 'k.json': splitKey, 'p.json': allFailed, 'good.json': splitRun });
  const r = cli([...SCORE, '--held-out', '--fail-on', 'low'], dir);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /nothing was evaluated: every model call failed \(20 of 20 records\)/);
  noLog(dir);
  const good = cli(['score', '--config', 'c.json', '--pred', 'good.json', '--key', 'k.json', '--held-out'], dir);
  assert.equal(good.status, 0, good.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'split-log.json')), true);
});

test('P41: a held-out half of failed calls alone spends no look either', () => {
  const dir = folder({ 'c.json': SPLIT, 'k.json': splitKey, 'p.json': splitRun });
  const { splitOf } = require('../src/split.js');
  const config = loadConfig(path.join(dir, 'c.json'));
  const { records } = require('../src/load.js').loadRun({ config, predPath: path.join(dir, 'p.json'), keyPath: path.join(dir, 'k.json') });
  const held = new Set(splitOf(records, config).held_out);
  fs.writeFileSync(path.join(dir, 'p.json'), JSON.stringify(splitRun.map(r => (held.has(r.id) ? { id: r.id, route: 'ASK', scored: false } : r))));
  const r = cli([...SCORE, '--held-out', '--json', 'o.json'], dir);
  assert.equal(r.status, 0, r.stderr);
  noLog(dir);
  assert.match(out('o.json', dir).split.not_looked, /held-out half/);
});

test('P41: compare --held-out: either run evaluating nothing spends no look', () => {
  const dir = folder({ 'c.json': SPLIT, 'k.json': splitKey, 'good.json': splitRun, 'bad.json': allFailed });
  for (const [b, a] of [['good.json', 'bad.json'], ['bad.json', 'good.json']]) {
    const r = cli(['compare', '--config', 'c.json', '--key', 'k.json', '--before', b, '--after', a, '--held-out', '--json', 'o.json'], dir);
    assert.equal(r.status, 0, r.stderr);
    noLog(dir);
    const o = out('o.json', dir);
    assert.equal(o.split.looked, false);
    assert.match(o.split.not_looked, /every model call failed/);
  }
});

test('P41: variance --held-out: a run evaluating nothing spends no look', () => {
  const dir = folder({ 'c.json': SPLIT, 'k.json': splitKey, 'good.json': splitRun, 'bad.json': allFailed });
  const r = cli(['variance', '--config', 'c.json', '--key', 'k.json', 'good.json', 'bad.json', '--held-out', '--json', 'o.json'], dir);
  assert.equal(r.status, 0, r.stderr);
  noLog(dir);
  assert.equal(out('o.json', dir).split.looked, false);
});

test('P41: whatif --held-out: a held-out half of failed calls spends no look', () => {
  const key = many(40, i => ({ id: 'r' + i, tags: ['t'], gold: 'PUB' }));
  const good = many(40, i => ({ id: 'r' + i, route: 'PUB', branch: 1, tags: [value('t')] }));
  const cfg = { ...SPLIT, thresholds: { auto_publish: { tags: 0.5 } }, whatif: { movable_field: 'branch', movable_values: [1] } };
  const dir = folder({ 'c.json': cfg, 'k.json': key, 'p.json': good });
  const { splitOf } = require('../src/split.js');
  const config = loadConfig(path.join(dir, 'c.json'));
  const { records } = require('../src/load.js').loadRun({ config, predPath: path.join(dir, 'p.json'), keyPath: path.join(dir, 'k.json') });
  const held = new Set(splitOf(records, config).held_out);
  fs.writeFileSync(path.join(dir, 'p.json'), JSON.stringify(good.map(r => (held.has(r.id) ? { id: r.id, route: 'ASK', branch: 1, scored: false } : r))));
  const r = cli(['whatif', ...SCORE.slice(1), '--gate', '--target', '50', '--held-out', '--json', 'o.json'], dir);
  assert.equal(r.status, 0, r.stderr);
  noLog(dir);
  const o = out('o.json', dir);
  assert.equal(o.split.looked, false);
  assert.match(o.split.not_looked, /held-out half/);
  assert.match(r.stdout.replace(/\s+/g, ' '), /HELD-OUT HALF not looked at: every model call in the held-out half failed.*so no look was spent/);
});

// ---------- P42: figures that round to nothing, and counts past any sample ----------

test('P42: a bound keeps figures when one decimal would read 0, or fall on the wrong side of the target', () => {
  assert.equal(boundPct(0.00017, 0.0001), 0.017);
  assert.equal(boundPct(0.0000056, 0.000001), 0.00056);
  assert.equal(boundPct(0.0014, 0.0012), 0.14);    // one decimal, 0.1, is below a target it is above
  assert.equal(boundPct(0.00094, 0.00095), 0.094);   // and 0.1 is above a target it is below
  assert.equal(boundPct(0.4, 0.05), 40);
  assert.equal(boundPct(0, 0.05), 0);
  assert.equal(boundPct(0.049966, 0.05), 4.997);
});

test('P42: the rate command keeps what score keeps', () => {
  const one = cli(['rate', '1', '1000000', '--target', '0.0001']).stdout;
  assert.match(one, /RATE {2}0\.0001% {2}1 of 1000000 {2}likely 0\.000018-0\.00057% \(95%\)/);
  assert.match(one, /the likely range reaches 0\.00057%/);
  assert.match(one, /At 0\.0001%, no number of records can show it/);
  assert.doesNotMatch(one, /0\.0%|0\.0 points/);
  const nine = cli(['rate', '9', '100000', '--target', '0.01']).stdout;
  assert.match(nine, /the likely range reaches 0\.017%/);
  assert.doesNotMatch(nine, /0\.0%/);
});

test('P42: one decimal is taken from the number itself, as it was', () => {
  // 1.1500000000001 is above the tie: twelve figures would read it as 1.15, which rounds down in binary.
  assert.equal(boundPct(0.011500000000001, null), 1.2);
});

test('P42: ordinary ranges read as they did', () => {
  const r = rate(1, 1000);
  assert.deepEqual([r.low_pct, r.high_pct], [0, 0.6]);
  assert.equal(rate(5, 100).high_pct, 11.2);
  assert.match(cli(['rate', '1', '1000']).stdout, /likely 0\.0-0\.6% \(95%\)/);
});

test('P42: compare and variance print the rate score prints, however small', () => {
  const key = many(3000, i => ({ id: 'r' + i, tags: ['t'] }));
  const pred = many(3000, i => ({ id: 'r' + i, route: 'PUB', tags: [value(i === 0 ? 'x' : 't')] }));
  const pred2 = many(3000, i => ({ id: 'r' + i, route: 'PUB', tags: [value(i < 2 ? 'x' : 't')] }));
  const dir = folder({ 'c.json': CFG, 'k.json': key, 'a.json': pred, 'b.json': pred2 });
  const c = cli(['compare', '--config', 'c.json', '--key', 'k.json', '--before', 'a.json', '--after', 'b.json', '--json', 'o.json'], dir);
  assert.match(c.stdout, /silent error rate +0\.033% +0\.1%/);
  const m = out('o.json', dir).metrics.find(x => x.name === 'silent error rate');
  assert.deepEqual([m.before, m.after], [0.033, 0.1]);
  const v = cli(['variance', '--config', 'c.json', '--key', 'k.json', 'a.json', 'b.json'], dir);
  assert.match(v.stdout, /silent error rate +0\.033% +0\.1%/);
  // Two rates told apart in the table are told apart in the sentence under it.
  assert.doesNotMatch(v.stdout, /Every run gave the same silent error rate/);
  assert.match(v.stdout, /anywhere from 0\.033% to 0\.1%/);
});

test('P42: one way to write a count, and words past what a sample could hold', () => {
  assert.equal(thousands(1234567), '1,234,567');
  assert.equal(thousands(1234.6), '1,235');
  assert.equal(thousands(Infinity), 'more than any sample could hold');
  assert.equal(thousands(1.9e26), 'more than any sample could hold');
  const src = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? src(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
  const copies = src(path.join(__dirname, '..', 'src')).filter(f => /const thousands = /.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(copies.map(f => path.basename(f)), ['values.js']);
});

test('P42: absurd targets read as words, never Infinity or a number with commas in its exponent', () => {
  const tiny = cli(['rate', '0', '10', '--target', '1e-23']).stdout;
  assert.match(tiny, /The least any test needs: more records than any sample could hold, with no mistake at all\./);
  assert.doesNotMatch(tiny, /Infinity/);
  assert.equal(targetCheck(0, 1, 1e-23).perfect_run.all_records, null);
  const plan = cli(['rate', '1', '1000000', '--target', '0.00010000000001']).stdout;
  assert.match(plan, /it takes more records than any sample could hold for an 80% chance of showing it\./);
  assert.doesNotMatch(plan, /e\+|Infinity/);
});

// ---------- P43: a field named after a built-in ----------

test('P43: an own threshold field named "constructor" is a field no record has, not a function', () => {
  const cfg = { ...CFG, thresholds: { auto_publish: { tags: 'constructor' } } };
  const named = { ...CFG, thresholds: { auto_publish: { tags: 'client_gate' } } };
  const files = { 'p.json': [{ id: 'a', route: 'PUB', tags: [{ value: 't', confidence: 0.1 }] }, { id: 'b', route: 'PUB', tags: [{ value: 't', confidence: 0.2 }] }] };
  const a = run(cfg, [...SCORE, '--lenient'], files);
  const b = run(named, [...SCORE, '--lenient'], files);
  assert.equal(a.status, b.status);
  // A function compares as nothing, so the gate read as passed, and "could not be checked" went unsaid.
  assert.match(b.stdout, /SG-GATE on 2 records/);
  assert.match(a.stdout, /SG-GATE on 2 records/);
});

// ---------- Terminal text, and a reader that goes away ----------

test('P12: the Unicode line and paragraph separators are shown as text', () => {
  assert.equal(escapeControls('a\u2028b\u2029c', true), 'a\\u2028b\\u2029c');
  assert.equal(escapeControls('a\u2028b\nc', false), 'a\\u2028b\\nc');
  const key = [{ id: 'a\u2028FORGED', tags: ['t'] }];
  const pred = [{ id: 'a\u2028FORGED', route: 'PUB', tags: [value('x')] }];
  const r = run(CFG, SCORE, { 'k.json': key, 'p.json': pred });
  assert.match(r.stdout, /a\\u2028FORGED/);
  assert.doesNotMatch(r.stdout, /\u2028/);
});

test('P24: a closed reader is EPIPE, a destroyed stream, or EOF; any other error is real', () => {
  for (const code of ['EPIPE', 'ERR_STREAM_DESTROYED', 'EOF']) assert.equal(closedReader({ code }), true, code);
  for (const code of ['ENOSPC', 'EACCES', undefined]) assert.equal(closedReader({ code }), false, code);
});

// ---------- One helper for what a name is ----------

test('Config names: a space is still a separator; a name of spaces is no name, here as everywhere', () => {
  const dir = folder({
    'ok.json': { input: { key: { format: 'csv', delimiter: ';', list_separator: ' ' } }, ...CFG },
    'blank.json': { ...CFG, routing: { field: ' ', map: MAP } },
  });
  assert.doesNotThrow(() => loadConfig(path.join(dir, 'ok.json')));
  assert.throws(() => loadConfig(path.join(dir, 'blank.json')), /routing\.field must be a field name/);
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'config.js'), 'utf8');
  assert.doesNotMatch(source, /const isName =|const isPath =/);
});
