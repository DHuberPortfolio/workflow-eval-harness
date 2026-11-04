// Fields a config names that no record has, numbers at the edge of what a report can print, and
// work with no end to it, as the Nov 3 audit found them. test/TRAPS.md, section P. The limits are
// tested by counting or by the plain stop, never by the clock.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { rate, recordsNeeded, pct, boundPct } = require('../src/metrics/stats.js');
const { targetCheck } = require('../src/metrics/target.js');
const { unitsOf } = require('../src/split.js');
const { compareText, maxOf, minOf } = require('../src/values.js');
const { resolveSet } = require('../src/metrics/slots.js');
const { orderKey } = require('../src/monitor.js');
const { cusumThreshold, MAX_EVERY, MAX_WORK } = require('../src/metrics/monitor.js');
const { steps } = require('../src/metrics/whatif.js');
const { maskProblems } = require('../src/split.js');

const WFEVAL = path.join(__dirname, '..', 'bin', 'wfeval.js');
const MAP = { PUB: 'auto', ASK: 'review', DUP: 'exclude' };
const cli = (args, cwd) => spawnSync(process.execPath, [WFEVAL, ...args], { cwd, encoding: 'utf8' });
function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-limits-'));
  for (const [name, x] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof x === 'string' ? x : JSON.stringify(x));
  return dir;
}

// ---------- P1: a field no record has ----------

const KEY = [{ id: 'a', gold: 'PUB', tags: ['t1'], violations: [], trap: 't', chan: 'c', story: 's', dup: null },
  { id: 'b', gold: 'PUB', tags: ['t2'], violations: [], trap: 't', chan: 'c', story: 's', dup: null }];
const PRED = [{ id: 'a', route: 'PUB', tags: [{ value: 't1', confidence: 0.9 }], violations: [{ value: 'BAD', confidence: 0.3 }], branch: 1 },
  { id: 'b', route: 'PUB', tags: [{ value: 't2', confidence: 0.9 }], violations: [{ value: 'BAD', confidence: 0.3 }], branch: 1 }];
const BASE = { outputs: { tags: { type: 'set' }, violations: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP } };
const FILES = ['--config', 'c.json', '--pred', 'p.json', '--key', 'k.json'];
const score = (cfg, extra = [], key = KEY, pred = PRED) => {
  const dir = folder({ 'c.json': cfg, 'k.json': key, 'p.json': pred });
  const r = cli(['score', ...FILES, ...extra], dir);
  const checked = cli(['check', ...FILES, ...extra.filter(x => x === '--lenient')], dir);
  fs.rmSync(dir, { recursive: true });
  return { r, checked };
};

test('P1: a set output\'s field no record has stops, naming the config key and the file; check says the same', () => {
  const cfg = { ...BASE, outputs: { ...BASE.outputs, violations: { type: 'set', field: 'violation', key_field: 'violations' } } };
  const { r, checked } = score(cfg, ['--fail-on', 'low']);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /\* \[P1\] p\.json: no record has "violation" \(outputs\.violations\.field\)/);
  assert.equal(checked.status, 1, checked.stdout);
  assert.match(checked.stderr, /\[P1\] p\.json/);
  const lenient = score(cfg, ['--lenient']).r;
  assert.equal(lenient.status, 0, lenient.stderr);
  assert.match(lenient.stdout, /warn \[P1\] p\.json: no record has "violation"/);
});

test('P1: an output on the key side no record has stops once, in lenient mode too, naming the config key', () => {
  const cfg = { ...BASE, outputs: { ...BASE.outputs, violations: { type: 'set', key_field: 'violation_key' } } };
  const { r } = score(cfg, ['--lenient']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\[D2\] k\.json: no record has "violation_key" \(outputs\.violations\.key_field\)/);
  assert.equal((r.stderr.match(/\[D2\]/g) || []).length, 1, 'one line, not one per record');
});

test('P1: a label no record has says so once, with the config key, instead of once per record', () => {
  const cfg = { outputs: { kind: { type: 'label', labels: ['a', 'b'], field: 'knd', key_field: 'kind' } }, routing: { field: 'route', map: MAP } };
  const { r } = score(cfg, [], [{ id: 'a', kind: 'a' }, { id: 'b', kind: 'b' }], [{ id: 'a', route: 'PUB', kind: 'a' }, { id: 'b', route: 'PUB', kind: 'b' }]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\[F3\] p\.json: no record has "knd" \(outputs\.kind\.field\)/);
  assert.equal((r.stderr.match(/\[F3\]/g) || []).length, 1);
});

test('P1: trap_field with min_per_trap: strict, naming the config key', () => {
  const extra = { trap_field: 'trapp', min_per_trap: 2 };
  const { r, checked } = score({ ...BASE, ...extra });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\[P1\] k\.json: no record has "trapp" \(trap_field\).*min_per_trap/);
  assert.equal(checked.status, 1);
  const lenient = score({ ...BASE, ...extra }, ['--lenient']).r;
  assert.equal(lenient.status, 0, lenient.stderr);
});

test('P1: trap_field alone warns: one config can serve a key with trap labels and a key without', () => {
  const { r } = score({ ...BASE, trap_field: 'trapp' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /warn \[P1\] k\.json: no record has "trapp" \(trap_field\)/);
});

test('P1: a misspelt movable field no longer certifies gates that nothing moved', () => {
  const k = [], p = [];
  for (let i = 0; i < 300; i++) { k.push({ id: 'g' + i, gold: 'PUB', tags: ['x'] }); p.push({ id: 'g' + i, branch: 1, route: 'PUB', tags: [{ value: 'x', confidence: 0.95 }] }); }
  const dir = folder({ 'c.json': { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP }, thresholds: { auto_publish: { tags: 0.9 } }, whatif: { movable_field: 'branchh', movable_values: [1] } }, 'k.json': k, 'p.json': p });
  const r = cli(['whatif', ...FILES, '--gate', '--target', '5'], dir);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /\(whatif\.movable_field\)/);
  fs.rmSync(dir, { recursive: true });
});

test('P1: duplicate_of_field: strict when the key suppresses records, a warning when it does not; a set with no duplicates still runs', () => {
  const cfg = { ...BASE, duplicate_of_field: 'dupp' };
  const none = score(cfg).r;
  assert.equal(none.status, 0, none.stderr);
  assert.match(none.stdout, /warn \[P1\] k\.json: no record has "dupp" \(duplicate_of_field\)/);
  const key = [{ ...KEY[0] }, { ...KEY[1], gold: 'DUP' }];
  const some = score(cfg, [], key).r;
  assert.equal(some.status, 1);
  assert.match(some.stderr, /\* \[P1\] k\.json: no record has "dupp" \(duplicate_of_field\).*suppress/);
});

test('P1: rejected_field and the other optional fields warn: a run may have nothing to put there', () => {
  const cfg = { outputs: { tags: { type: 'set', rejected_field: 'rejectd' }, kind: { type: 'label', labels: ['a', 'b'], confidence_field: 'conff', decline: { field: 'declinedd' } } }, routing: { field: 'route', map: MAP } };
  const key = [{ id: 'a', tags: ['x'], kind: 'a' }];
  const pred = [{ id: 'a', route: 'PUB', tags: ['x'], kind: 'a' }];
  const { r } = score(cfg, [], key, pred);
  assert.equal(r.status, 0, r.stderr);
  for (const [field, at] of [['rejectd', 'outputs\\.tags\\.rejected_field'], ['conff', 'outputs\\.kind\\.confidence_field'], ['declinedd', 'outputs\\.kind\\.decline\\.field']]) {
    assert.match(r.stdout, new RegExp('warn \\[P1\\] p\\.json: no record has "' + field + '" \\(' + at + '\\)'));
  }
});

test('P1: a run where every model call failed is told so, not that a field is missing; one record with the field is enough', () => {
  const failed = PRED.map(({ id }) => ({ id, route: 'ASK', scored: false }));
  const { r } = score(BASE, [], KEY, failed);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\[P1\]/);
  const partly = [{ ...PRED[0] }, { id: 'b', route: 'PUB', tags: [{ value: 't2', confidence: 0.9 }] }];
  assert.equal(score(BASE, [], KEY, partly).r.status, 0);
});

test('P1: monitor checks the outputs it scores, and leaves a golden set\'s traps and groups out of a live period', () => {
  const dir = folder({
    'c.json': { outputs: { tags: { type: 'set', key_field: 'answer' } }, routing: { field: 'route', map: MAP }, trap_field: 'trap', groups: { chan: { field: 'chan' } } },
    'bad.json': { outputs: { tags: { type: 'set', field: 'tagz', key_field: 'answer' } }, routing: { field: 'route', map: MAP } },
    'week-1.json': [{ id: 'a', route: 'PUB', tags: ['x'], answer: ['x'] }],
    'week-2.json': [{ id: 'b', route: 'PUB', tags: ['x'], answer: ['y'] }],
  });
  assert.equal(cli(['monitor', '--config', 'c.json', 'week-1.json', 'week-2.json', '--target', '5'], dir).status, 0);
  const bad = cli(['monitor', '--config', 'bad.json', 'week-1.json', 'week-2.json', '--target', '5'], dir);
  assert.equal(bad.status, 1, bad.stdout);
  assert.match(bad.stderr, /\[P1\]/);
  fs.rmSync(dir, { recursive: true });
});

test('P1: estimate checks the run\'s outputs too', () => {
  const dir = folder({
    'c.json': { outputs: { tags: { type: 'set', field: 'tagz', key_field: 'tags' } }, routing: { field: 'route', map: MAP } },
    'p.json': [{ id: 'a', route: 'PUB', tags: ['x'] }], 'j.json': [{ id: 'a', tags: ['y'] }], 'k.json': [{ id: 'a', tags: ['x'] }],
  });
  const r = cli(['estimate', '--config', 'c.json', '--pred', 'p.json', '--judge-key', 'j.json', '--key', 'k.json'], dir);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /\[P1\]/);
  fs.rmSync(dir, { recursive: true });
});

// ---------- P11: the hard minimum ----------

test('P11: the records a target needs have no cap of a million: 3.8416 x (1/target - 1), the next whole number', () => {
  assert.equal(recordsNeeded(0, 0.05), 73);
  assert.equal(recordsNeeded(0, 0.000001), 3841597);     // 3.8416 x 999,999 = 3,841,596.2
  assert.equal(recordsNeeded(0, 0.0000001), 38415997);   // 3.8416 x 9,999,999 = 38,415,996.2
  assert.equal(recordsNeeded(0.01, 0.05), 115);   // Wilson's upper end at 1% over 115 records: 4.97%; over 114: 5.00%
  assert.equal(recordsNeeded(0.1, 0.2), 62);
  const t = targetCheck(1, 1000000, 0.0001);
  assert.equal(t.perfect_run.n, 3841597);
  const dir = folder({});
  const r = cli(['rate', '1', '1000000', '--target', '0.0001'], dir);
  assert.match(r.stdout, /The least any test needs: 3,841,597 records with no mistake at all/);
  fs.rmSync(dir, { recursive: true });
});

// ---------- P25-P27: numbers at a report's edge ----------

test('P25: no "shown under 5%" beside a printed 5.0%: the range gets the decimals that tell them apart', () => {
  const t = targetCheck(0, 73, 5);
  assert.equal(t.shown, true);
  assert.equal(t.high_pct, 4.999);
  assert.equal(boundPct(0.0499932, 0.05), 4.999);
  assert.equal(boundPct(0.0504, 0.05), 5.04);
  assert.equal(boundPct(0.0612, 0.05), 6.1);
  const dir = folder({});
  assert.match(cli(['rate', '0', '73', '--target', '5'], dir).stdout, /under 5%: shown\. The whole likely range is under it \(it reaches 4\.999%\)/);
  assert.match(cli(['rate', '49999', '1000000', '--target', '5'], dir).stdout, /not shown: the likely range reaches 5\.04%/);
  const near = cli(['rate', '14', '282', '--target', '5'], dir).stdout;
  assert.match(near, /If the real rate is 4\.96% \(this count's\)/);
  fs.rmSync(dir, { recursive: true });
});

test('P25: the same in estimate\'s high end', () => {
  const { targetOf } = require('../src/metrics/estimate.js');
  const t = targetOf({ out: 100, flagged: 0, checked: { flagged: { n: 0, errors: 0 }, passed: { n: 73, errors: 0 } } }, { estimate: 0, low: 0, high: 0.04999 }, 5);
  assert.equal(t.shown, true);
  assert.equal(t.high_pct, 4.999);
});

test('P26: ties round alike, and a rate that would round under 0.1 keeps two figures', () => {
  assert.equal(pct(1, 2000), 0.1);    // 0.05 exactly: up
  assert.equal(pct(3, 2000), 0.2);    // 0.15 exactly: up, where binary arithmetic went down
  assert.equal(pct(23, 2000), 1.2);   // 1.15 exactly
  assert.equal(pct(1, 8), 12.5);
  assert.equal(pct(1, 3000), 0.033);
  assert.equal(pct(1, 70000), 0.0014);
  assert.equal(pct(0, 3000), 0);
  assert.equal(pct(0, 0), null);
  assert.equal(rate(1, 3000).pct, 0.033);
  const dir = folder({});
  assert.match(cli(['rate', '1', '2000'], dir).stdout, /^RATE {2}0\.1%/);
  assert.match(cli(['rate', '3', '2000'], dir).stdout, /^RATE {2}0\.2%/);
  assert.match(cli(['rate', '1', '3000'], dir).stdout, /^RATE {2}0\.033%/);
  fs.rmSync(dir, { recursive: true });
});

test('P27: a count past what a number can hold exactly stops, and only plain decimal numbers are read', () => {
  const dir = folder({});
  const huge = cli(['rate', '1', '9'.repeat(400), '--target', '5'], dir);
  assert.equal(huge.status, 1);
  assert.match(huge.stderr, /too large/);
  assert.equal(cli(['rate', '1', '9007199254740993'], dir).status, 1);
  assert.equal(cli(['rate', '1', '9007199254740991'], dir).status, 0);
  for (const bad of ['0x10', '0b11', '0o7', 'Infinity', ' 5', '5 ', '1_000']) {
    const r = cli(['rate', '1', '10', '--target', bad], dir);
    assert.equal(r.status, 1, bad + ': ' + r.stdout);
    assert.match(r.stderr, /--target must be a percentage/);
  }
  for (const good of ['5', '5.5', '.5', '5e0', '1e1']) assert.equal(cli(['rate', '1', '10', '--target', good], dir).status, 0, good);
  fs.rmSync(dir, { recursive: true });
});

// ---------- P28-P31 ----------

test('P28: a trap listed twice counts once, and a blank trap is no trap', () => {
  const cfg = { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP }, trap_field: 'trap', min_per_trap: 2 };
  const key = [{ id: 'a', gold: 'PUB', tags: [], trap: ['t', ' t '] }, { id: 'b', gold: 'PUB', tags: [], trap: 'u' }, { id: 'c', gold: 'PUB', tags: [], trap: 'u' }, { id: 'd', gold: 'PUB', tags: [], trap: '  ' }, { id: 'e', gold: 'PUB', tags: [], trap: ['', 'u'] }];
  const pred = key.map(k => ({ id: k.id, route: 'PUB', tags: [] }));
  const strict = score(cfg, [], key, pred).r;
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /trap "t" has 1 record\(s\)/);
  const dir = folder({ 'c.json': cfg, 'k.json': key, 'p.json': pred });
  assert.equal(cli(['score', ...FILES, '--lenient', '--json', 'o.json', '--quiet'], dir).status, 0);
  const o = JSON.parse(fs.readFileSync(path.join(dir, 'o.json'), 'utf8'));
  assert.deepEqual(o.traps.groups.map(g => [g.trap, g.records.length]), [['(none)', 1], ['t', 1], ['u', 3]]);
  assert.equal(o.traps.records_with_several_traps, 0);
  fs.rmSync(dir, { recursive: true });
});

test('P29: an id wider than its column keeps a space after it; shorter ids line up as before', () => {
  const key = [{ id: 'doc-000123', gold: 'PUB', tags: ['x'] }, { id: 'short', gold: 'PUB', tags: ['x'] }];
  const pred = key.map(k => ({ id: k.id, route: 'PUB', tags: ['y'] }));
  const { r } = score({ outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP } }, [], key, pred);
  assert.match(r.stdout, /^ {2}doc-000123 high/m);
  assert.match(r.stdout, /^ {2}short {3}high/m);
});

test('P30: a split log with a broken listing stops as a log that is not one', () => {
  const key = Array.from({ length: 10 }, (_, i) => ({ id: 'r' + i, gold: 'PUB', tags: ['x'] }));
  const pred = key.map(k => ({ id: k.id, route: 'PUB', tags: ['x'] }));
  const dir = folder({ 'c.json': { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP }, split: { held_out: 0.5, log: 'log.json' } }, 'k.json': key, 'p.json': pred });
  assert.equal(cli(['score', ...FILES, '--held-out', '--quiet'], dir).status, 0);
  const log = JSON.parse(fs.readFileSync(path.join(dir, 'log.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ ...log, listings: [null] }));
  const r = cli(['score', ...FILES, '--held-out', '--quiet'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\[O11\].*is not a split log/);
  fs.rmSync(dir, { recursive: true });
});

test('P30: a log that cannot be written gives a plain message and leaves nothing behind', { skip: process.getuid && process.getuid() === 0 }, () => {
  const key = Array.from({ length: 10 }, (_, i) => ({ id: 'r' + i, gold: 'PUB', tags: ['x'] }));
  const pred = key.map(k => ({ id: k.id, route: 'PUB', tags: ['x'] }));
  const dir = folder({ 'c.json': { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP }, split: { held_out: 0.5, log: 'logs/log.json' } }, 'k.json': key, 'p.json': pred, 'q.json': pred.map(r => ({ ...r, v: 2 })) });
  fs.mkdirSync(path.join(dir, 'logs'));
  assert.equal(cli(['score', ...FILES, '--held-out', '--quiet'], dir).status, 0);
  fs.chmodSync(path.join(dir, 'logs', 'log.json'), 0o444);
  if (process.platform !== 'win32') fs.chmodSync(path.join(dir, 'logs'), 0o555);
  const r = spawnSync(process.execPath, [WFEVAL, 'score', '--config', 'c.json', '--pred', 'q.json', '--key', 'k.json', '--held-out', '--quiet'], { cwd: dir, encoding: 'utf8', env: { ...process.env, WFEVAL_LOCK_WAIT_MS: '200' } });
  if (process.platform !== 'win32') fs.chmodSync(path.join(dir, 'logs'), 0o755);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /\[O17\] split\.log cannot be written/);
  assert.doesNotMatch(r.stderr, /EPERM: |EACCES: /);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'logs')), ['log.json']);
  fs.chmodSync(path.join(dir, 'logs', 'log.json'), 0o644);
  fs.rmSync(dir, { recursive: true });
});

test('P31: estimate and agree with a split say they read every record, and that no look is counted', () => {
  const key = Array.from({ length: 6 }, (_, i) => ({ id: 'r' + i, tags: ['x'] }));
  const pred = key.map(k => ({ id: k.id, route: 'PUB', tags: [{ value: 'x', confidence: 0.9 }] }));
  const dir = folder({ 'c.json': { outputs: { tags: { type: 'set' } }, routing: { field: 'route', map: MAP }, split: { held_out: 0.5 } }, 'p.json': pred, 'j.json': key, 'k.json': key.slice(0, 3), 'a.json': key, 'b.json': key.map(k => ({ ...k, tags: ['y'] })) });
  const pick = cli(['estimate', '--config', 'c.json', '--pred', 'p.json', '--judge-key', 'j.json', '--pick', '2'], dir);
  assert.equal(pick.status, 0, pick.stderr);
  assert.match(pick.stdout, /\[P31\].*the config has a split: estimate ignores it/);
  const est = cli(['estimate', '--config', 'c.json', '--pred', 'p.json', '--judge-key', 'j.json', '--key', 'k.json'], dir);
  assert.match(est.stdout, /\[P31\]/);
  const agr = cli(['agree', '--config', 'c.json', '--keys', 'a.json', 'b.json'], dir);
  assert.equal(agr.status, 0, agr.stderr);
  assert.match(agr.stdout, /\[P31\].*the config has a split: agree ignores it/);
  fs.rmSync(dir, { recursive: true });
});

// ---------- P32-P37: work with no end to it ----------

test('P32: more checks than monitor can follow stop, with the number, before any arithmetic', () => {
  const dir = folder({ 'h.json': [{ period: 'week-1', out_without_review: 10000000000, silent_errors: 1 }], 'i.json': [{ period: 'week-1', out_without_review: 6000000, silent_errors: 1 }, { period: 'week-2', out_without_review: 6000000, silent_errors: 1 }] });
  for (const f of ['h.json', 'i.json']) {
    const r = spawnSync(process.execPath, [WFEVAL, 'monitor', '--counts', f, '--target', '5'], { cwd: dir, encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 1, f);
    assert.match(r.stderr, /\[P32\].*checked in all.*at most 10,000,000/);
  }
  fs.rmSync(dir, { recursive: true });
});

test('P32: settings the alarm level cannot honestly be set for stop by name, with no raw error', () => {
  const dir = folder({ 'c.json': [{ period: 'week-1', out_without_review: 100, silent_errors: 1 }] });
  const bad = [
    ['--acceptable', '5', '--alarming', '5.000001'],
    ['--acceptable', '5', '--alarming', '5.00000000001'],
    ['--target', '0.0000001'],
  ];
  for (const a of bad) {
    const r = spawnSync(process.execPath, [WFEVAL, 'monitor', '--counts', 'c.json', ...a], { cwd: dir, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 1, a.join(' ') + ' status ' + r.status);
    assert.match(r.stderr, /[Cc]annot set the alarm level/, a.join(' '));
    assert.match(r.stderr, /--false-alarm-every|--alarming/);
    assert.doesNotMatch(r.stderr, /allocation failed|Invalid/);
  }
  fs.rmSync(dir, { recursive: true });
});

// Reaching the real limit takes about 7 seconds, so it is pinned here and the stop is shown on a small
// one: settings that finish with the full budget stop with less, so the budget is what stopped them.
test('P32: a search that would take too long stops on a count of its steps, the same on every machine', () => {
  assert.equal(MAX_WORK, 4e9);
  assert.ok(cusumThreshold(0.05, 0.1, 2000, 10) > 0);
  assert.throws(() => cusumThreshold(0.05, 0.1, 2000, 10, 1000), /[Cc]annot set the alarm level/);
});

test('P32: --false-alarm-every past what the arithmetic can resolve stops', () => {
  assert.equal(MAX_EVERY, 1e12);
  const dir = folder({ 'c.json': [{ period: 'week-1', out_without_review: 100, silent_errors: 1 }] });
  const r = cli(['monitor', '--counts', 'c.json', '--target', '5', '--false-alarm-every', '1e300'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--false-alarm-every.*at most 1,000,000,000,000/);
  assert.equal(cli(['monitor', '--counts', 'c.json', '--target', '5', '--false-alarm-every', '1000000000000'], dir).status, 0);
  assert.throws(() => cusumThreshold(0.05, 0.05000001, 2000, 10), /[Cc]annot set the alarm level/);
  fs.rmSync(dir, { recursive: true });
});

test('P33: --step is bounded before anything is allocated: a sweep has at most 10,001 rows', () => {
  assert.equal(steps(0, 1, 0.0001).length, 10001);
  assert.throws(() => steps(0, 1, 0.00001), /--step 0\.00001 would give 100,001 rows.*0\.0001 or more/);
  assert.throws(() => steps(0, 1, 1e-300), /--step .* rows/);
  assert.deepEqual(steps(0.9, 0.9, 1), [0.9]);
});

test('P34: --resamples times the records has a ceiling, named in the stop', () => {
  const { MAX_RESAMPLE_WORK } = require('../src/agree.js');
  assert.equal(MAX_RESAMPLE_WORK, 2e9);
  const key = Array.from({ length: 30000 }, (_, i) => ({ id: 'r' + i, tags: ['x'] }));
  const dir = folder({ 'c.json': { outputs: { tags: { type: 'set' } }, routing: { field: 'route', map: MAP } }, 'a.json': key, 'b.json': key.map(k => ({ ...k, note: 1 })) });
  const r = spawnSync(process.execPath, [WFEVAL, 'agree', '--config', 'c.json', '--keys', 'a.json', 'b.json', '--resamples', '100000'], { cwd: dir, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--resamples 100000 on 30000 records.*use --resamples 66666 or fewer/);
  fs.rmSync(dir, { recursive: true });
});

test('P35: minOf and maxOf take a list of any length, and an empty one says so', () => {
  const big = Array.from({ length: 400000 }, (_, i) => i);
  assert.equal(maxOf(big), 399999);
  assert.equal(minOf(big), 0);
  assert.equal(maxOf([]), -Infinity);
});

test('P35: a run with 300,000 values in one record is scored, and the source has no spread into a call on a list that can grow', () => {
  const vals = Array.from({ length: 300000 }, (_, i) => ({ value: 'v' + i, confidence: 0.9 }));
  const dir = folder({
    'c.json': { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP }, thresholds: { auto_publish: { tags: 0.5 } } },
    'p.json': [{ id: 'a', route: 'PUB', tags: vals }, { id: 'b', route: 'PUB', tags: [{ value: 'x', confidence: 0.9 }] }],
    'k.json': [{ id: 'a', gold: 'PUB', tags: ['x'] }, { id: 'b', gold: 'PUB', tags: ['x'] }],
  });
  const r = spawnSync(process.execPath, [WFEVAL, 'score', ...FILES, '--quiet'], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  fs.rmSync(dir, { recursive: true });
  const src = path.join(__dirname, '..', 'src');
  for (const f of ['metrics/judge.js', 'metrics/runs.js', 'metrics/suspects.js', 'monitor.js', 'split-log.js', 'split.js', 'report/html.js', 'rulings.js', 'score.js']) {
    const text = fs.readFileSync(path.join(src, f), 'utf8');
    assert.doesNotMatch(text, /Math\.(min|max)\(\.\.\./, f);
    assert.doesNotMatch(text, /splice\(.*\.\.\./, f);
  }
});

test('P35: resolveSet does not search the list for each slot', () => {
  const key = Array.from({ length: 2000 }, (_, i) => 'k' + i);
  const pred = Array.from({ length: 2000 }, (_, i) => ({ value: 'p' + i, applied: i % 2 === 0, confidence: 0.9 }));
  let searches = 0;
  const some = pred.some;
  pred.some = function (...a) { searches++; return some.apply(this, a); };
  assert.equal(resolveSet(pred, key).unfilled.length, 2000);
  assert.equal(searches, 0);
});

test('P35: maskProblems takes as many problems as a run can raise', () => {
  const items = Array.from({ length: 300000 }, (_, i) => ({ level: 'fix', trap: 'D7', where: 'w' + i, message: 'm' }));
  maskProblems(items, []);
  assert.equal(items.length, 300000);
});

test('P36: a chain of duplicates is walked once: every record gets its unit in a single pass', () => {
  const n = 20000;
  const records = Array.from({ length: n }, (_, i) => ({ id: 'r' + i, duplicate_of: i ? 'r' + (i - 1) : null }));
  let looks = 0;
  const counted = records.map(r => new Proxy(r, { get(t, k) { if (k === 'duplicate_of') looks++; return t[k]; } }));
  const units = unitsOf(counted, { split: { by: 'cluster' } });
  assert.equal(units.get('r19999'), 'r0');
  assert.ok(looks <= 3 * n, looks + ' looks at a primary for ' + n + ' records');
});

test('P36: a shared chain, a loop and a primary outside the set give what each walk gave', () => {
  const recs = [{ id: 'a', duplicate_of: 'b' }, { id: 'b', duplicate_of: 'c' }, { id: 'c', duplicate_of: 'b' }, { id: 'd', duplicate_of: 'a' }, { id: 'e', duplicate_of: 'gone' }, { id: 'f', duplicate_of: 'e' }, { id: 'g', cluster: 'K', duplicate_of: 'h' }, { id: 'h', duplicate_of: 'g' }, { id: 'i', duplicate_of: null }];
  const u = unitsOf(recs, { split: { by: 'cluster' } });
  assert.deepEqual([...u.entries()].sort(), [['a', 'b'], ['b', 'b'], ['c', 'b'], ['d', 'b'], ['e', 'gone'], ['f', 'gone'], ['g', 'K'], ['h', 'K'], ['i', 'i']]);
});

test('P37: the order read from a period\'s name is the last number in it, on a name of any length', () => {
  assert.deepEqual(orderKey('week-12'), { kind: 'number week-#', key: 12 });
  assert.deepEqual(orderKey('a12b34c'), { kind: 'number a12b#c', key: 34 });
  assert.deepEqual(orderKey('2026-10-05'), { kind: 'day', key: '2026-10-05' });
  assert.deepEqual(orderKey('2026-W41'), { kind: 'week', key: '2026-W41' });
  assert.equal(orderKey('no digits'), null);
  assert.equal(orderKey('line\nbreak 7'), null);
  assert.deepEqual(orderKey('7 tail\nend'), { kind: 'number #  tail\nend'.replace('#  ', '# '), key: 7 });
  const long = orderKey('1'.repeat(2000000) + 'a1');
  assert.equal(long.key, 1);
  assert.equal(long.kind.length, 2000000 + 'number '.length + 2);
});

// ---------- P38 ----------

test('P38: text is ordered by one fixed locale, whatever the machine says', () => {
  assert.deepEqual(['z', 'ä', 'a', 'Z', 'ö', 'o'].sort(compareText), ['a', 'ä', 'o', 'ö', 'z', 'Z']);
  const src = path.join(__dirname, '..', 'src');
  const files = fs.readdirSync(src, { recursive: true }).filter(f => String(f).endsWith('.js'));
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(src, String(f)), 'utf8'), /\.localeCompare\(/, String(f));
});

test('P35: what the language says at the edge of its limits reaches a person in words', () => {
  const dir = folder({ 'c.json': BASE, 'k.json': KEY, 'p.json': PRED,
    'hook.js': "const s = JSON.stringify; JSON.stringify = function (v, r, n) { if (n === 2) throw new RangeError('Invalid string length'); return s(v, r, n); };" });
  const r = spawnSync(process.execPath, ['-r', path.join(dir, 'hook.js'), WFEVAL, 'score', ...FILES, '--json', 'o.json', '--quiet'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /results are too large to write out/);
  assert.doesNotMatch(r.stderr, /Invalid string length/);
  fs.rmSync(dir, { recursive: true });
});
