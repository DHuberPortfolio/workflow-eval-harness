// What the Nov 3 audit found in judging, in the config's rules and in the build gates. Each test
// is named after its row in test/TRAPS.md (section P), and its numbers are worked out by hand in
// its comment: small records built here, so each one can be read beside the rule it tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateConfig } = require('../src/config.js');
const { scoreRun, compareRun } = require('../src/score.js');
const { judgeAll, gatePasses, buildContext } = require('../src/metrics/judge.js');

const WFEVAL = path.join(__dirname, '..', 'bin', 'wfeval.js');
const MAP = { PUB: 'auto', ASK: 'review', DEN: 'block', DUP: 'exclude' };
const cli = (args, cwd) => spawnSync(process.execPath, [WFEVAL, ...args], { cwd, encoding: 'utf8' });
function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-audit-'));
  for (const [name, x] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof x === 'string' ? x : JSON.stringify(x));
  return dir;
}
function run(raw, pred, key, opts = {}) {
  const { config, errors } = validateConfig(raw);
  assert.deepEqual(errors, []);
  const dir = folder({ 'p.json': pred, 'k.json': key });
  const r = scoreRun({ config, predPath: path.join(dir, 'p.json'), keyPath: path.join(dir, 'k.json'), ...opts });
  fs.rmSync(dir, { recursive: true });
  return r;
}
const byId = (r, id) => r.records.find(x => x.id === id);

test('P5: an unknown key inside routing stops, as in every other block', () => {
  const { errors } = validateConfig({ outputs: { t: { type: 'set' } }, routing: { field: 'route', gold_fild: 'gold', map: MAP } });
  assert.ok(errors.some(e => e.includes('unknown key "routing.gold_fild"')), errors.join(' | '));
});

test('P6: a value outside allowed_values that the key also lists: a silent error always needed a person', () => {
  const raw = { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP }, allowed_values: { tags: ['A'] } };
  const r = run(raw, [{ id: '1', route: 'PUB', tags: ['Z'] }, { id: '2', route: 'ASK', tags: ['Z'] }, { id: '3', route: 'PUB', tags: ['A'] }],
    [{ id: '1', gold: 'PUB', tags: ['Z'] }, { id: '2', gold: 'PUB', tags: ['Z'] }, { id: '3', gold: 'PUB', tags: ['A'] }]);
  assert.deepEqual(byId(r, '1').silent.types, ['SP-INVALID']);
  assert.equal(byId(r, '1').needs_human, true);
  // Sent to a person, the same record was worth the review.
  assert.equal(byId(r, '2').needs_human, true);
  assert.equal(byId(r, '2').wasted_review, false);
  assert.deepEqual([r.routing.review_queue.precision.n, r.routing.review_queue.precision.d], [1, 1]);
  assert.equal(byId(r, '3').needs_human, false);
});

test('P6: under wrong_when gold_route the values decide nothing, so an invalid value needs no person there', () => {
  const raw = { outputs: { tags: { type: 'set' } }, wrong_when: 'gold_route', routing: { field: 'route', gold_field: 'gold', map: MAP }, allowed_values: { tags: ['A'] } };
  const r = run(raw, [{ id: '1', route: 'PUB', tags: ['Z'] }], [{ id: '1', gold: 'PUB', tags: ['Z'] }]);
  assert.equal(byId(r, '1').silent, null);
  assert.equal(byId(r, '1').needs_human, false);
});

test('P6: over random records, every silent error needed a person', () => {
  let seed = 11;
  const rnd = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return Math.floor((seed / 4294967296) * n); };
  const pick = a => a[rnd(a.length)];
  for (const wrong_when of ['either', 'gold_route', 'any_mismatch']) {
    const raw = { outputs: { tags: { type: 'set' } }, wrong_when, routing: { field: 'route', gold_field: 'gold', map: MAP }, allowed_values: { tags: ['A', 'B'] } };
    const pred = [], key = [];
    for (let i = 0; i < 300; i++) {
      pred.push({ id: 'r' + i, route: pick(['PUB', 'PUB', 'ASK', 'DEN']), tags: [pick(['A', 'B', 'Z'])] });
      key.push({ id: 'r' + i, gold: pick(['PUB', 'ASK', 'DEN', 'DUP']), tags: [pick(['A', 'B', 'Z'])] });
    }
    for (const x of run(raw, pred, key, { mode: 'lenient' }).records) if (x.silent) assert.equal(x.needs_human, true, x.id);
  }
});

test('P7: the primary suppressed and its only duplicate blocked: nothing was kept, so it is a false duplicate', () => {
  const raw = { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP }, duplicate_of_field: 'dup' };
  const key = [{ id: 'P', gold: 'PUB', tags: ['A'] }, { id: 'D', gold: 'DUP', tags: ['A'], dup: 'P' }];
  const blocked = run(raw, [{ id: 'P', route: 'DUP', tags: ['A'] }, { id: 'D', route: 'DEN', tags: ['A'] }], key);
  assert.deepEqual(byId(blocked, 'P').omission, { types: ['SO-FALSE-DUPLICATE'], severity: 'high' });
  // The duplicate suppressed too: nothing kept, the same.
  const both = run(raw, [{ id: 'P', route: 'DUP', tags: ['A'] }, { id: 'D', route: 'DUP', tags: ['A'] }], key);
  assert.deepEqual(byId(both, 'P').omission.types, ['SO-FALSE-DUPLICATE']);
  // Kept by going out, or by going to a person: the wrong copy was kept.
  for (const route of ['PUB', 'ASK']) {
    const kept = run(raw, [{ id: 'P', route: 'DUP', tags: ['A'] }, { id: 'D', route, tags: ['A'] }], key);
    assert.deepEqual(byId(kept, 'P').omission, { types: ['SO-PRIMARY-SUPPRESSED'], severity: 'medium' }, route);
  }
});

test('P8: SP-WRONG-PRIMARY with no correct route is listed under not measured, never a silent zero', () => {
  const raw = { outputs: { tags: { type: 'set' } }, routing: { field: 'route', map: MAP }, duplicate_of_field: 'dup' };
  const r = run(raw, [{ id: 'P', route: 'DUP', tags: ['A'] }, { id: 'D', route: 'PUB', tags: ['A'] }], [{ id: 'P', tags: ['A'] }, { id: 'D', tags: ['A'], dup: 'P' }]);
  const line = r.routing.not_measured.find(n => n.why.includes('routing.gold_field'));
  assert.ok(line.what.includes('SP-WRONG-PRIMARY'), line.what);
});

test('P9: a weakest gate with a known value under it fails, whatever the value with no confidence says', () => {
  const config = validateConfig({ outputs: { tags: { type: 'set' } }, routing: { field: 'route', map: MAP }, thresholds: { auto_publish: { tags: 0.8 }, gate_uses: 'weakest' } }).config;
  const rec = list => ({ pred: { tags: list.map(([value, confidence]) => ({ value, confidence, applied: true })) } });
  assert.equal(gatePasses(rec([['A', 0.5], ['B', null]]), config), false);
  assert.equal(gatePasses(rec([['A', 0.9], ['B', null]]), config), null);
  assert.equal(gatePasses(rec([['A', 0.9], ['B', 0.85]]), config), true);
  // A lead gate: the value with no confidence could be the strongest, so nothing is known yet.
  const lead = validateConfig({ outputs: { tags: { type: 'set' } }, routing: { field: 'route', map: MAP }, thresholds: { auto_publish: { tags: 0.8 } } }).config;
  assert.equal(gatePasses(rec([['A', 0.5], ['B', null]]), lead), null);
});

test('P9: a gate no record could be checked at is listed under not measured, with the count', () => {
  for (const [gate_uses, flagged] of [['lead', false], ['weakest', true]]) {
    const raw = { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP }, thresholds: { auto_publish: { tags: 0.8 }, gate_uses } };
    const r = run(raw, [{ id: '1', route: 'PUB', tags: [{ value: 'A', confidence: 0.5 }, { value: 'B' }] }, { id: '2', route: 'PUB', tags: [{ value: 'A', confidence: 0.9 }, { value: 'B' }] }, { id: '3', route: 'PUB', tags: [{ value: 'A', confidence: 0.9 }] }],
      [{ id: '1', gold: 'PUB', tags: ['A', 'B'] }, { id: '2', gold: 'PUB', tags: ['A', 'B'] }, { id: '3', gold: 'PUB', tags: ['A'] }], { mode: 'lenient' });
    assert.deepEqual(byId(r, '1').safeguards, flagged ? ['SG-GATE'] : [], gate_uses);
    const line = r.routing.not_measured.find(n => n.what.startsWith('SG-GATE'));
    assert.ok(line, gate_uses);
    // lead: records 1 and 2 are unknown. weakest: record 1 failed, so only record 2 is unknown.
    assert.ok(line.what.includes(flagged ? 'on 1 record' : 'on 2 records'), line.what);
    assert.ok(line.why.includes('no confidence'), line.why);
  }
});

test('P9: a run with nothing unknown at the gate says nothing new under not measured', () => {
  const raw = { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP }, thresholds: { auto_publish: { tags: 0.8 } } };
  const r = run(raw, [{ id: '1', route: 'PUB', tags: [{ value: 'A', confidence: 0.9 }] }], [{ id: '1', gold: 'PUB', tags: ['A'] }]);
  assert.equal(r.routing.not_measured.filter(n => n.what.startsWith('SG-GATE')).length, 0);
});

test('P10: a floor with no confidence on any value out is listed as not measured, never read as a clean zero', () => {
  const raw = { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP }, thresholds: { floor: 0.5 } };
  const r = run(raw, [{ id: '1', route: 'PUB', tags: ['A'] }], [{ id: '1', gold: 'PUB', tags: ['A'] }]);
  const line = r.routing.not_measured.find(n => n.what.startsWith('SG-FLOOR'));
  assert.ok(line && line.why.includes('no confidence'), JSON.stringify(r.routing.not_measured));
  // One value with a confidence, and the floor was measured.
  const some = run(raw, [{ id: '1', route: 'PUB', tags: [{ value: 'A', confidence: 0.9 }] }], [{ id: '1', gold: 'PUB', tags: ['A'] }]);
  assert.equal(some.routing.not_measured.filter(n => n.what.startsWith('SG-FLOOR')).length, 0);
});

test('P10: the floor never reads a label: it says so, and judging on labels is unchanged', () => {
  const raw = { outputs: { kind: { type: 'label', labels: ['a', 'b'], confidence_field: 'c' } }, routing: { field: 'route', gold_field: 'gold', map: MAP }, thresholds: { floor: 0.6 } };
  const r = run(raw, [{ id: '1', route: 'PUB', kind: 'a', c: 0.3 }], [{ id: '1', gold: 'PUB', kind: 'a' }]);
  assert.deepEqual(byId(r, '1').safeguards, []);
  const line = r.routing.not_measured.find(n => n.what.startsWith('SG-FLOOR'));
  assert.ok(line && line.what.includes('kind') && line.why.includes('set'), JSON.stringify(r.routing.not_measured));
});

test('P22: a failed model call with no label is read as failed, in strict mode and lenient, and left out of quality', () => {
  const raw = { outputs: { kind: { type: 'label', labels: ['ok', 'bad'] }, band: { type: 'ordinal', labels: ['1', '2', '3'] } }, routing: { field: 'route', map: MAP } };
  for (const mode of ['strict', 'lenient']) {
    const r = run(raw, [{ id: 'a', route: 'ASK', scored: false }, { id: 'b', route: 'PUB', kind: 'bad', band: '2' }], [{ id: 'a', kind: 'ok', band: '1' }, { id: 'b', kind: 'bad', band: '2' }], { mode });
    assert.deepEqual(r.quality.left_out.model_failed, ['a']);
    assert.equal(r.quality.population, 1);
    assert.deepEqual([r.quality.outputs.kind.accuracy.n, r.quality.outputs.kind.accuracy.d], [1, 1]);
    assert.equal(byId(r, 'a').route_class, 'review');
  }
  // A scored record with no label still stops: the exemption is for failed calls only.
  assert.throws(() => run(raw, [{ id: 'a', route: 'ASK', band: '1' }], [{ id: 'a', kind: 'ok', band: '1' }]), /\[F3\]/);
});

test('P4: --fail-on reads silent omissions at their severity', () => {
  const dir = folder({
    'c.json': { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP } },
    'k.json': [{ id: 'a', gold: 'PUB', tags: ['x'] }, { id: 'b', gold: 'PUB', tags: ['x'] }],
    'block.json': [{ id: 'a', route: 'DEN', tags: [] }, { id: 'b', route: 'DEN', tags: [] }],
    'dup.json': [{ id: 'a', route: 'DUP', tags: [] }, { id: 'b', route: 'DUP', tags: [] }],
  });
  const base = ['--config', 'c.json', '--key', 'k.json', '--quiet'];
  // SO-FALSE-BLOCK is medium: --fail-on medium trips, --fail-on high does not.
  const med = cli(['score', ...base, '--pred', 'block.json', '--fail-on', 'medium'], dir);
  assert.equal(med.status, 3, med.stderr);
  assert.match(med.stderr, /a \(medium, silent omission\)/);
  assert.equal(cli(['score', ...base, '--pred', 'block.json', '--fail-on', 'high'], dir).status, 0);
  // SO-FALSE-DUPLICATE is high.
  assert.equal(cli(['score', ...base, '--pred', 'dup.json', '--fail-on', 'high'], dir).status, 3);
  fs.rmSync(dir, { recursive: true });
});

test('P4: with a split and --held-out the held-out half\'s omissions trip the gate too, counted, never named', () => {
  const key = [], pred = [];
  for (let i = 0; i < 12; i++) { key.push({ id: 'r' + i, gold: 'PUB', tags: ['x'] }); pred.push({ id: 'r' + i, route: 'DEN', tags: [] }); }
  const dir = folder({ 'c.json': { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP }, split: { held_out: 0.5, log: 'log.json' } }, 'k.json': key, 'p.json': pred });
  const r = cli(['score', '--config', 'c.json', '--pred', 'p.json', '--key', 'k.json', '--quiet', '--held-out', '--fail-on', 'medium'], dir);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /held-out record\(s\) \(medium or worse/);
  const held = spawnSync(process.execPath, ['-e', `const {splitOf}=require(${JSON.stringify(path.join(__dirname, '..', 'src', 'split.js'))});const {loadConfig}=require(${JSON.stringify(path.join(__dirname, '..', 'src', 'config.js'))});
    const c=loadConfig('c.json');console.log(splitOf(require('./k.json').map(k=>({id:k.id,duplicate_of:null})),c).held_out.join(' '))`], { cwd: dir, encoding: 'utf8' }).stdout.trim().split(' ');
  for (const id of held) assert.ok(!new RegExp('\\b' + id + '\\b').test(r.stderr), id + ' named: ' + r.stderr);
  fs.rmSync(dir, { recursive: true });
});

// ---------- Gates fail closed ----------

const failedCalls = n => Array.from({ length: n }, (_, i) => ({ id: 'r' + i, route: 'ASK', scored: false }));
const answers = n => Array.from({ length: n }, (_, i) => ({ id: 'r' + i, gold: 'PUB', tags: ['x'] }));
const rightRuns = n => Array.from({ length: n }, (_, i) => ({ id: 'r' + i, route: 'PUB', tags: ['x'] }));
const CFG = { outputs: { tags: { type: 'set' } }, routing: { field: 'route', gold_field: 'gold', map: MAP } };

test('P2: every model call failed: score --fail-on exits 3 and says why; with no gate the report warns at the top', () => {
  const dir = folder({ 'c.json': CFG, 'k.json': answers(4), 'p.json': failedCalls(4) });
  const files = ['--config', 'c.json', '--pred', 'p.json', '--key', 'k.json'];
  const gated = cli(['score', ...files, '--fail-on', 'critical', '--quiet'], dir);
  assert.equal(gated.status, 3, gated.stderr);
  assert.match(gated.stderr, /fail-on critical: nothing was evaluated: every model call failed \(4 of 4 records\)/);
  const plain = cli(['score', ...files], dir);
  assert.equal(plain.status, 0);
  assert.match(plain.stdout.split('\n').slice(0, 3).join('\n'), /NOTHING WAS EVALUATED/);
  // In the JSON and the HTML as well: one results object.
  assert.equal(cli(['score', ...files, '--json', 'o.json', '--html', 'o.html', '--quiet'], dir).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'o.json'), 'utf8')).nothing_evaluated.why, 'every model call failed (4 of 4 records)');
  assert.match(fs.readFileSync(path.join(dir, 'o.html'), 'utf8').split('Silent error rate')[0], /Nothing was evaluated/);
  fs.rmSync(dir, { recursive: true });
});

test('P2: nothing out without review on records really scored is no failure of the gate: a warning only', () => {
  const pred = rightRuns(4).map(r => ({ ...r, route: 'ASK' }));
  const dir = folder({ 'c.json': CFG, 'k.json': answers(4), 'p.json': pred });
  const r = cli(['score', '--config', 'c.json', '--pred', 'p.json', '--key', 'k.json', '--fail-on', 'critical'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /NOTHING WAS EVALUATED/);
  assert.match(r.stdout, /No record went out without review/);
  fs.rmSync(dir, { recursive: true });
});

test('P2: half the records scored is enough: the gate reads them', () => {
  const pred = [...failedCalls(2), { id: 'r2', route: 'PUB', tags: ['x'] }, { id: 'r3', route: 'PUB', tags: ['x'] }];
  const dir = folder({ 'c.json': CFG, 'k.json': answers(4), 'p.json': pred });
  const r = cli(['score', '--config', 'c.json', '--pred', 'p.json', '--key', 'k.json', '--fail-on', 'critical', '--quiet'], dir);
  assert.equal(r.status, 0, r.stderr);
  fs.rmSync(dir, { recursive: true });
});

test('P2: compare --fail-if-worse exits 3 when either run evaluated nothing, whatever the outcome named', () => {
  const dir = folder({ 'c.json': CFG, 'k.json': answers(5), 'good.json': rightRuns(5), 'bad.json': failedCalls(5) });
  const base = ['compare', '--config', 'c.json', '--key', 'k.json'];
  const after = cli([...base, '--before', 'good.json', '--after', 'bad.json', '--fail-if-worse', 'any'], dir);
  assert.equal(after.status, 3, after.stderr);
  assert.match(after.stderr, /fail-if-worse any: nothing was evaluated in bad\.json: every model call failed \(5 of 5 records\)/);
  assert.match(after.stdout.split('\n').slice(0, 3).join('\n'), /NOTHING WAS EVALUATED/);
  assert.equal(cli([...base, '--before', 'bad.json', '--after', 'good.json', '--fail-if-worse', 'silent-errors'], dir).status, 3);
  // No gate: the report warns at the top and the command is done.
  const plain = cli([...base, '--before', 'good.json', '--after', 'bad.json'], dir);
  assert.equal(plain.status, 0);
  assert.match(plain.stdout.split('\n').slice(0, 3).join('\n'), /NOTHING WAS EVALUATED/);
  fs.rmSync(dir, { recursive: true });
});

test('P2: monitor --fail-on-alarm exits 3 with every count zero in every period; with checks it reads them as ever', () => {
  const zero = [{ period: 'week-1', out_without_review: 0, silent_errors: 0 }, { period: 'week-2', out_without_review: 0, silent_errors: 0 }];
  const some = [{ period: 'week-1', out_without_review: 0, silent_errors: 0 }, { period: 'week-2', out_without_review: 20, silent_errors: 0 }];
  const dir = folder({ 'z.json': zero, 's.json': some });
  const gated = cli(['monitor', '--counts', 'z.json', '--target', '5', '--fail-on-alarm'], dir);
  assert.equal(gated.status, 3, gated.stderr);
  assert.match(gated.stderr, /fail-on-alarm: nothing was evaluated: every count is zero in every period/);
  assert.match(gated.stdout.split('\n').slice(0, 3).join('\n'), /NOTHING WAS EVALUATED/);
  assert.equal(cli(['monitor', '--counts', 'z.json', '--target', '5'], dir).status, 0);
  assert.equal(cli(['monitor', '--counts', 's.json', '--target', '5', '--fail-on-alarm'], dir).status, 0);
  // --since moves where the alarm starts: with no check from there on, the alarm read nothing.
  const since = cli(['monitor', '--counts', 's.json', '--target', '5', '--fail-on-alarm', '--since', 'week-2'], dir);
  assert.equal(since.status, 0);
  const late = folder({ 'l.json': [{ period: 'week-1', out_without_review: 20, silent_errors: 0 }, { period: 'week-2', out_without_review: 0, silent_errors: 0 }] });
  assert.equal(cli(['monitor', '--counts', 'l.json', '--target', '5', '--fail-on-alarm', '--since', 'week-2'], late).status, 3);
  fs.rmSync(dir, { recursive: true });
  fs.rmSync(late, { recursive: true });
});

test('P2: monitor with --watch silent-omissions counts its own series', () => {
  const dir = folder({ 'z.json': [{ period: 'week-1', blocked_or_suppressed: 0, silent_omissions: 0 }] });
  const r = cli(['monitor', '--counts', 'z.json', '--target', '5', '--watch', 'silent-omissions', '--fail-on-alarm'], dir);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /every count is zero in every period/);
  fs.rmSync(dir, { recursive: true });
});

test('P2: estimate --fail-if-not-shown exits 3 when every model call failed', () => {
  const C = { outputs: { tags: { type: 'set' } }, routing: { field: 'route', map: MAP } };
  const keys = n => Array.from({ length: n }, (_, i) => ({ id: 'r' + i, tags: ['x'] }));
  const dir = folder({ 'c.json': C, 'j.json': keys(4), 'k.json': keys(4).map(k => ({ ...k, tags: ['x', 'y'] })).slice(0, 2),
    'review.json': failedCalls(4), 'out.json': failedCalls(4).map(r => ({ ...r, route: 'PUB' })) });
  const base = ['estimate', '--config', 'c.json', '--judge-key', 'j.json', '--key', 'k.json', '--target', '5', '--fail-if-not-shown'];
  for (const pred of ['review.json', 'out.json']) {
    const r = cli([...base, '--pred', pred], dir);
    assert.equal(r.status, 3, pred + ': ' + r.stderr);
    assert.match(r.stderr, /fail-if-not-shown: nothing was evaluated: every model call failed \(4 of 4 records\)/);
  }
  // Without the gate, nothing out stays the stop it was (exit 1), and it says why.
  assert.equal(cli(['estimate', '--config', 'c.json', '--judge-key', 'j.json', '--key', 'k.json', '--pred', 'review.json'], dir).status, 1);
  fs.rmSync(dir, { recursive: true });
});

test('P2: score --grades --fail-on exits 3 on a grades file grading nothing; with no gate the report warns at the top', () => {
  const g = { format: 'wfeval-grades/1', fingerprint: 'sha256:x', fields: [{ name: 'a' }], forms: [], grades: [], kinds: [] };
  const dir = folder({ 'g.json': g, 'n.json': { ...g, fields: [], forms: ['f1'] } });
  for (const file of ['g.json', 'n.json']) {
    const r = cli(['score', '--grades', file, '--fail-on', 'high'], dir);
    assert.equal(r.status, 3, file + ' ' + r.stderr);
    assert.match(r.stderr, /fail-on high: nothing was evaluated: no field was graded/);
    assert.match(r.stdout.split('\n').slice(0, 3).join('\n'), /NOTHING WAS EVALUATED/);
    assert.equal(cli(['score', '--grades', file], dir).status, 0);
  }
  fs.rmSync(dir, { recursive: true });
});

test('P3: a failed model call warns in a single score, counted once, with a split counting the held-out half too', () => {
  const dir = folder({ 'k.json': answers(3), 'p.json': [...failedCalls(2), { id: 'r2', route: 'PUB', tags: ['x'] }] });
  const { config } = validateConfig(CFG);
  const r = scoreRun({ config, predPath: path.join(dir, 'p.json'), keyPath: path.join(dir, 'k.json') });
  const notes = r.problems.filter(i => i.trap === 'I6');
  assert.equal(notes.length, 1);
  assert.match(notes[0].message, /^2 model call\(s\) failed in this run/);
  const c = compareRun({ config, keyPath: path.join(dir, 'k.json'), beforePath: path.join(dir, 'p.json'), afterPath: path.join(dir, 'p.json') });
  assert.equal(c.problems.filter(i => i.trap === 'I6').length, 2, 'compare says it of each run, as before');
  fs.rmSync(dir, { recursive: true });
});

test('buildContext keeps what the omission types need: only copies that went out or to a person', () => {
  const recs = [{ id: 'D1', duplicate_of: 'P', route_class: 'block' }, { id: 'D2', duplicate_of: 'Q', route_class: 'review' }, { id: 'D3', duplicate_of: 'R', route_class: 'auto' }, { id: 'D4', duplicate_of: 'S', route_class: 'exclude' }];
  assert.deepEqual([...buildContext(recs).keptDuplicateOf].sort(), ['Q', 'R']);
  assert.equal(typeof judgeAll, 'function');
});
