// Mistakes the Nov 3 mutation run could not see: one small change to the code (a < for a <=, an
// && for an ||) left every test passing. Each test here fails with one of those changes, so a
// real slip of that kind now shows. The numbers are worked by hand in the comments. How the run is
// done, and what was left out and why: docs/ENGINEERING.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('../src/config.js');
const { scoreRun, varianceRun } = require('../src/score.js');
const { floorSweep } = require('../src/metrics/whatif.js');
const { targetCheck } = require('../src/metrics/target.js');
const { pairedDifference, boundPct } = require('../src/metrics/stats.js');
const { worthOf, estimateRange } = require('../src/metrics/estimate.js');
const { bootstrapIntervals, bootstrapAlpha, bcaLevels, bcaShare, krippendorffAlpha } = require('../src/metrics/agreement.js');
const { mixtureLogE, mixtureUpper, monitorSeries, monitorSegments } = require('../src/metrics/monitor.js');
const { monitorRun } = require('../src/monitor.js');

const WFEVAL = path.join(__dirname, '..', 'bin', 'wfeval.js');
const cli = (args, cwd) => spawnSync(process.execPath, [WFEVAL, ...args], { cwd, encoding: 'utf8' });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-mutants-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
function folder(files) {
  const dir = fs.mkdtempSync(path.join(tmp, 'f-'));
  for (const [name, x] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x));
  return dir;
}
const MAP = { PUB: 'auto', ASK: 'review' };
const ROUTING = { field: 'route', gold_field: 'gold', map: MAP };
const out = (id, tags) => ({ id, route: 'PUB', tags: tags.map(value => ({ value, confidence: 0.9 })) });

// ---------- src/metrics: what decides a silent error ----------

test('a near miss, or a decline, alone is a reason for a person: a review of one is not unnecessary', () => {
  // All three should have gone out, by the key's route, and all three went to review. Two had
  // something wrong a person would fix, so one review of three was unnecessary.
  const cfg = { outputs: { band: { type: 'ordinal', labels: [1, 2, 3], near_miss_steps: 1 },
    topic: { type: 'label', labels: ['a', 'b'], decline: { values: ['unsure'] } } }, routing: ROUTING };
  const key = [{ id: 'near', gold: 'PUB', band: 3, topic: 'a' }, { id: 'declined', gold: 'PUB', band: 1, topic: 'b' }, { id: 'right', gold: 'PUB', band: 2, topic: 'a' }];
  const pred = [{ id: 'near', route: 'ASK', band: 2, topic: 'a' }, { id: 'declined', route: 'ASK', band: 1, topic: 'unsure' }, { id: 'right', route: 'ASK', band: 2, topic: 'a' }];
  const dir = folder({ 'c.json': cfg, 'k.json': key, 'p.json': pred });
  const r = scoreRun({ config: loadConfig(path.join(dir, 'c.json')), predPath: path.join(dir, 'p.json'), keyPath: path.join(dir, 'k.json') });
  assert.deepEqual(r.routing.review_queue.wasted, ['right']);
});

test('variance: the key gaps stated in the most runs come first, whatever order they were found in', () => {
  // g1 is on the first record, in run 1 only; g2 on the second, in all three: found second, listed first.
  const cfg = { outputs: { tags: { type: 'set' } }, routing: ROUTING };
  const key = [{ id: 'a', gold: 'PUB', tags: ['x'] }, { id: 'b', gold: 'PUB', tags: ['x'] }];
  const dir = folder({ 'c.json': cfg, 'k.json': key,
    'r1.json': [out('a', ['x', 'g1']), out('b', ['x', 'g2'])], 'r2.json': [out('a', ['x']), out('b', ['x', 'g2'])], 'r3.json': [out('a', ['x']), out('b', ['x', 'g2'])] });
  const v = varianceRun({ config: loadConfig(path.join(dir, 'c.json')), keyPath: path.join(dir, 'k.json'), predPaths: ['r1', 'r2', 'r3'].map(n => path.join(dir, n + '.json')) });
  assert.deepEqual(v.records.key_gap_candidates.map(g => [g.id, g.value, g.runs]), [['b', 'g2', 3], ['a', 'g1', 1]]);
});

test('traps: a record with exactly two traps counts as carrying several', () => {
  const cfg = { outputs: { tags: { type: 'set' } }, routing: ROUTING, trap_field: 'trap' };
  const key = [{ id: 'a', gold: 'PUB', tags: ['x'], trap: ['t1', 't2'] }, { id: 'b', gold: 'PUB', tags: ['x'], trap: ['t1'] }];
  const dir = folder({ 'c.json': cfg, 'k.json': key, 'p.json': [out('a', ['x']), out('b', ['x'])] });
  const r = scoreRun({ config: loadConfig(path.join(dir, 'c.json')), predPath: path.join(dir, 'p.json'), keyPath: path.join(dir, 'k.json') });
  assert.equal(r.traps.records_with_several_traps, 1);
});

test('floor what-if: a floor that takes a record\'s only value away fails its gate, and the record moves to review', () => {
  // Floor 0.5, gate 0.7. At floor 0.95 the 0.9 value is evicted, so nothing stands on the gate.
  const cfg = { outputs: { tags: { type: 'set' } }, routing: ROUTING, thresholds: { floor: 0.5, auto_publish: { tags: 0.7 } } };
  const key = [{ id: 'a', gold: 'PUB', tags: ['x'] }];
  const dir = folder({ 'c.json': cfg, 'k.json': key, 'p.json': [out('a', ['x'])] });
  const config = loadConfig(path.join(dir, 'c.json'));
  const { paired } = scoreRun({ config, predPath: path.join(dir, 'p.json'), keyPath: path.join(dir, 'k.json') });
  const rows = floorSweep(paired, config, { from: 0.5, to: 0.95, step: 0.45 }).rows;
  assert.deepEqual(rows.map(r => [r.floor, r.moved]), [[0.5, []], [0.95, ['a -> review']]]);
});

test('target: no plan at no mistakes (the perfect run says it), and none at or above the target', () => {
  assert.equal(targetCheck(0, 30, 5).plan, null);
  assert.equal(targetCheck(1, 10, 5).plan, null);       // 10%, above 5%
  assert.equal(targetCheck(1, 20, 5).plan, null);       // exactly 5%
  assert.ok(targetCheck(1, 30, 5).plan.n > 30);
});

test('target: in all, rounded up: 73 records out, when 3 of every 10 go out, take 244 records (243.3)', () => {
  assert.equal(targetCheck(0, 30, 5, { out_of: { n: 3, d: 10 } }).perfect_run.all_records, 244);
});

test('paired change: a count that is not a whole number is refused, whichever of the two it is', () => {
  assert.throws(() => pairedDifference(1.5, 1, 10), /whole numbers/);
  assert.throws(() => pairedDifference(1, 1.5, 10), /whole numbers/);
});

test('monitor: the running bound refuses a target that is not between 0 and 1', () => {
  assert.throws(() => mixtureLogE(1, 1, 1), /between 0 and 1/);
  assert.throws(() => mixtureLogE(1, 1, 0), /between 0 and 1/);
});

// ---------- src/metrics: estimate, agreement, monitor ----------

test('estimate: no "worth about" for a range wider than any records give, or narrower than a billion give', () => {
  assert.equal(worthOf(0.5, 0, 1), null);                // a person's range is under 1 wide at any size
  assert.equal(worthOf(0.5, 0.5, 0.500001), null);       // Wilson at a billion: 6.2e-5 wide, far wider
  // At 100 records and 50%: Wilson 0.404 to 0.596, so that range is worth 100 records.
  assert.ok(Math.abs(worthOf(0.5, 0.40382, 0.59618) - 100) < 0.5);
});

test('estimate: the exact end takes over at 3 errors only past 50 checks', () => {
  const range = n => estimateRange({ out: n, flagged: 0, checked: { flagged: { n: 0, errors: 0 }, passed: { n, errors: 3 } } });
  assert.ok(Math.abs(range(50).low - 0.0206) < 0.0005, 'Wilson at 3 of 50');
  assert.ok(Math.abs(range(51).low - 0.0123) < 0.0005, 'exact at 3 of 51');
});

test('agreement: every resample the same gives no range with three graders too (BCa, not only Krippendorff\'s)', () => {
  // Three graders on five records, each 2 to 1: any resample is the same five records again.
  const units = Array.from({ length: 5 }, () => ['A', 'A', 'B']);
  assert.equal(bootstrapIntervals(units, {}, { resamples: 50 }).why, 'no_spread');
  assert.deepEqual([bootstrapAlpha(units, {}, { resamples: 50 }).low, bootstrapAlpha(units, {}, { resamples: 50 }).why], [null, 'no_spread']);
});

test('agreement: with none of the resamples below t, the chance alpha is below t is 0, whatever the bias', () => {
  assert.equal(bcaShare(0, 0.4, 0.1), 0);
  assert.equal(bcaShare(1, 0.4, 0.1), 1);
});

test('agreement: the log jackknife range, worked from alpha with each record left out', () => {
  const units = [['a', 'a'], ['a', 'b'], ['b', 'b'], ['c', 'c'], ['a', 'c'], ['b', 'b'], ['c', 'c'], ['a', 'a']];
  const alpha = krippendorffAlpha(units).alpha;
  const phi = units.map((_, i) => Math.log(1 - krippendorffAlpha(units.filter((__, j) => j !== i)).alpha));
  const N = units.length;
  const mean = phi.reduce((a, b) => a + b, 0) / N;
  const se = Math.sqrt(((N - 1) / N) * phi.reduce((a, x) => a + (x - mean) ** 2, 0));
  const r = bootstrapIntervals(units, {}, { resamples: 50 }).log_jackknife;
  assert.ok(Math.abs(r.low - (1 - Math.exp(Math.log(1 - alpha) + 1.959964 * se))) < 1e-9, 'low');
  assert.ok(Math.abs(r.high - (1 - Math.exp(Math.log(1 - alpha) - 1.959964 * se))) < 1e-9, 'high');
});

test('monitor: periods of one record each set the alarm for a period of one', () => {
  const periods = ['a', 'b', 'c'].map(period => ({ period, out: 1, silent: 0 }));
  const s = monitorSeries(periods, { acceptable: 0.025, alarming: 0.05 });
  assert.deepEqual(s.periods.map(p => p.cusum.period_size), [1, 1, 1]);
});

const SEG = { acceptable: 0.025, alarming: 0.05, target: 0.05 };
test('segments: the whole\'s bound is worked at a rate of exactly 50% too', () => {
  const whole = [{ period: 'P1', out: 4, silent: 2 }];
  const segments = [{ segment: 'a', periods: [{ period: 'P1', out: 2, silent: 1 }] }, { segment: 'b', periods: [{ period: 'P1', out: 2, silent: 1 }] }];
  const m = monitorSegments(whole, segments, SEG);
  assert.ok(m.periods[0].upper_pct > 50 && m.periods[0].upper_pct <= 100, String(m.periods[0].upper_pct));
});

test('segments: a row shown before the last carries the family\'s bound, worked by hand', () => {
  // No silent error in 200 records (S = 0, F = 200). The mixture over rates from 0 to u then has a
  // closed form: E(u) = (1 - u)^-F (1 - (1 - u)^(F + 1)) / (u (F + 1)). E(2.2%) = 19.1 and
  // E(2.25%) = 20.7, so E reaches the bar of 20 at about 2.2%. Nothing falls short of 20, so 20 is
  // the bar. The last row's bound is worked again at the end; the first row's is the one here.
  const one = (period, n) => ({ period, out: n, silent: 0 });
  const whole = [one('P1', 400), one('P2', 40)];
  const segments = ['a', 'b'].map(segment => ({ segment, periods: [one('P1', 200), one('P2', 20)] }));
  const m = monitorSegments(whole, segments, SEG);
  const row = m.segments.rows[0].periods[0];
  assert.deepEqual([row.shown, row.bar, row.upper_pct], [true, 20, 2.2]);
  // Shown from the very first period, and said so, for the whole and for a segment.
  assert.deepEqual([m.bound.shown_since, m.segments.rows[0].bound.shown_since], ['P1', 'P1']);
});

test('segments: a segment\'s bound counts its silent errors, not only its records', () => {
  const row = (period, out, silent) => ({ period, out, silent });
  const whole = [row('P1', 400, 6), row('P2', 400, 6)];
  const segments = ['a', 'b'].map(segment => ({ segment, periods: [row('P1', 200, 3), row('P2', 200, 3)] }));
  const r = monitorSegments(whole, segments, SEG).segments.rows[0];
  const last = r.periods[r.periods.length - 1];
  assert.deepEqual([r.records, r.silent], [400, 6]);
  assert.equal(last.upper_pct, boundPct(mixtureUpper(6, 394, 1 / last.bar), SEG.target));
  assert.ok(last.upper_pct > 1.5, 'a bound sits above the 1.5% seen: ' + last.upper_pct);
});

// Worked with Python's statistics.NormalDist from Efron and Tibshirani 1993, eq. 14.10, not from this code.
test('the BCa range is read at the shares its formula gives', () => {
  const near = (got, want) => got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-5, got.join(' ') + ' against ' + want.join(' ')));
  near(bcaLevels(0, 0), [0.025, 0.975]);
  near(bcaLevels(0.1, 0.05), [0.05461, 0.991724]);
  near(bcaLevels(-0.2, 0.03), [0.012923, 0.951348]);
});

test('A7 is about a file with no routes at all: one record without a route is not that', () => {
  const tags = [{ value: 'x', confidence: 0.9 }];
  const dir = folder({
    'c.json': { outputs: { tags: { type: 'set' } }, routing: ROUTING },
    'k.json': [{ id: 'a', gold: 'PUB', tags: ['x'] }, { id: 'b', gold: 'PUB', tags: ['x'] }],
    'p.json': [{ id: 'a', route: 'PUB', tags }, { id: 'b', tags }],
  });
  const r = cli(['check', '--config', 'c.json', '--pred', 'p.json', '--key', 'k.json'], dir);
  assert.doesNotMatch(r.stdout + r.stderr, /\[A7\]/);
});

// ---------- src/monitor.js: which warnings a series raises ----------

function counts(rows, extra = {}) {
  const dir = folder({ 'counts.json': rows.map(([period, out_without_review, silent_errors]) => ({ period, out_without_review, silent_errors })) });
  return monitorRun({ countsPath: path.join(dir, 'counts.json'), target: 5, acceptable: 2.5, ...extra });
}
const traps = (m, trap) => m.problems.filter(i => i.trap === trap);

test('L7: a period with nothing checked is not an uneven period', () => {
  assert.equal(traps(counts([['W1', 30, 0], ['W2', 0, 0], ['W3', 30, 0]]), 'L7').length, 0);
});

test('L18: a rise dated to the second period is at the start, with no calm stretch before it', () => {
  // W1 clean (the sum at 0), W2 and W3 with 3 of 30: the rise starts at W2, the alarm is at W3. Before
  // it, 3 of 60: 5%, likely 1.7-13.7%, so not clearly above 2.5%: only the early sign warns.
  const m = counts([['W1', 30, 0], ['W2', 30, 3], ['W3', 30, 3]]);
  assert.deepEqual([m.detector.alarm_since, m.detector.rise_started], ['W3', 'W2']);
  assert.equal(traps(m, 'L18').length, 1);
});

// ---------- Policies, splits and reading files ----------

test('E17: one record is enough to say a field is the answer key\'s', () => {
  const cfg = { outputs: { tags: { type: 'set' } }, routing: ROUTING, groups: { region: { field: 'region' } } };
  const dir = folder({ 'c.json': cfg, 'k.json': [{ id: 'a', gold: 'PUB', tags: ['x'], region: 'east' }], 'p.json': [out('a', ['x'])],
    'pol.json': { policies: [{ name: 'r', hold_if: [{ field: 'region', equals: 'east' }] }] } });
  const r = cli(['whatif', '--config', 'c.json', '--pred', 'p.json', '--key', 'k.json', '--policies', 'pol.json'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\[E17\]/);
});

test('hold-if below: a value exactly at the line is not below it', () => {
  const cfg = { outputs: { tags: { type: 'set' } }, routing: ROUTING };
  const key = [{ id: 'at', gold: 'PUB', tags: ['x'] }, { id: 'under', gold: 'PUB', tags: ['x'] }];
  const pred = [{ ...out('at', ['x']), match: 0.5 }, { ...out('under', ['x']), match: 0.4 }];
  const dir = folder({ 'c.json': cfg, 'k.json': key, 'p.json': pred });
  cli(['whatif', '--config', 'c.json', '--pred', 'p.json', '--key', 'k.json', '--hold-if', 'field:match<0.5', '--json', 'o.json'], dir);
  const rows = JSON.parse(fs.readFileSync(path.join(dir, 'o.json'), 'utf8')).rows;
  assert.deepEqual(rows[rows.length - 1].held, ['under']);
});

test('a record with no id is named by its place, counting from 1, in the predictions and in the key', () => {
  const cfg = { outputs: { tags: { type: 'set' } }, routing: ROUTING };
  const key = [{ id: 'a', gold: 'PUB', tags: ['x'] }, { gold: 'PUB', tags: ['x'] }];
  const dir = folder({ 'c.json': cfg, 'k.json': key, 'p.json': [out('a', ['x']), { route: 'PUB', tags: [] }] });
  const r = cli(['score', '--config', 'c.json', '--pred', 'p.json', '--key', 'k.json'], dir);
  assert.match(r.stderr, /p\.json record #2/);
  assert.match(r.stderr, /k\.json record #2/);
});

test('split by id: a cluster on both sides is counted as straddling; a record with no cluster is not', () => {
  // S01 is in the tuning half and S03 in the held-out half (test/fixtures/split/EXPECTED.md).
  const config = { split: { held_out: 0.5, salt: '', hash: 'sha256', by: 'id' } };
  const records = [{ id: 'S01', cluster: 'c' }, { id: 'S03', cluster: 'c' }, { id: 'S02', cluster: null }, { id: 'S04' }];
  assert.deepEqual(require('../src/split.js').splitOf(records, config).straddling, { clusters: 1, duplicates: 0 });
});

test('a UTF-16 file with its mark and no NUL in it is called UTF-16; a Windows-1252 file is not', () => {
  const stop = bytes => {
    const dir = folder({ 'x.json': Buffer.from(bytes) });
    try { require('../src/text.js').readText(path.join(dir, 'x.json')); return null; } catch (e) { return e.trap; }
  };
  const han = Array.from({ length: 40 }, (_, i) => [0x41 + i, 0x4e + (i % 8)]).flat();   // no zero byte
  assert.equal(stop([0xFF, 0xFE, ...han]), 'P17');
  assert.equal(stop([0xFE, 0xFF, ...han]), 'P17');
  assert.equal(stop([0xFE, 0x41, 0x42]), 'P16');     // a Windows-1252 thorn, not a byte-order mark
  assert.equal(stop([0x41, 0xFF, 0x42]), 'P16');
});

// ---------- The config refuses what it cannot use ----------

test('config: a gate that names no output, a bucket wider than a half, and an unknown what-if key are refused', () => {
  const { validateConfig } = require('../src/config.js');
  const base = { outputs: { tags: { type: 'set' } }, routing: ROUTING };
  const errors = extra => validateConfig({ ...base, ...extra }).errors.join('; ');
  // A gate on nothing would pass every record.
  assert.match(errors({ thresholds: { auto_publish: {} } }), /auto_publish must map at least one output/);
  assert.equal(errors({ calibration: { buckets: 0.5 } }), '');
  assert.match(errors({ calibration: { buckets: 0.51 } }), /calibration must be/);
  assert.equal(errors({ whatif: { movable_field: 'b', movable_values: [1] } }), '');
  assert.match(errors({ whatif: { movable_field: 'b', movable_values: [1], extra: 1 } }), /whatif must be/);
});

test('grading config: its input settings are checked, every one', () => {
  const { validateGradingConfig } = require('../src/grading.js');
  const errors = input => validateGradingConfig({ source_field: 's', fields: { a: { label: 'A' } }, input }).errors.join('; ');
  assert.equal(errors({ format: 'csv', records_at: 'a.b', unwrap: 'json', delimiter: ';' }), '');
  assert.match(errors(5), /input must be an object/);
  assert.match(errors({ nope: 1 }), /unknown key "input\.nope" \(allowed: .*records_at/);
  assert.match(errors({ format: 'xml' }), /input\.format must be one of/);
  assert.match(errors({ records_at: '' }), /input\.records_at must be/);
  assert.match(errors({ delimiter: '#' }), /input\.delimiter must be one of/);
});

// ---------- The commands' own flow ----------

test('check prints the held-out share as a percentage', () => {
  const dir = folder({ 'c.json': { outputs: { tags: { type: 'set' } }, routing: ROUTING, split: { held_out: 0.3 } } });
  assert.match(cli(['check', '--config', 'c.json'], dir).stdout, /split +30% held out by sha256/);
});

const SPLIT = path.join(__dirname, 'fixtures', 'split');
const GATE = path.join(__dirname, 'fixtures', 'gate');
const splitFiles = ['--pred', path.join(GATE, 'predictions.json'), '--key', path.join(GATE, 'key.json')];

test('compare --fail-if-worse any: a held-out half that measures nothing says the gate read the tuning half only', () => {
  // With so small a share no record falls in the held-out half.
  const raw = JSON.parse(fs.readFileSync(path.join(SPLIT, 'config.json'), 'utf8'));
  raw.split.held_out = 0.001;
  const dir = folder({ 'c.json': raw });
  const r = cli(['compare', '--config', 'c.json', '--key', path.join(SPLIT, 'key.json'), '--before', path.join(SPLIT, 'predictions.json'),
    '--after', path.join(SPLIT, 'predictions.json'), '--fail-if-worse', 'any', '--held-out', '--lenient'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /does not measure any outcome/);
});

test('whatif on a split: the floor what-if says it certifies nothing; the gate what-if says what would be tried', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(SPLIT, 'gate.json'), 'utf8'));
  raw.thresholds.floor = 0.5;
  const dir = folder({ 'c.json': raw });
  const floor = cli(['whatif', '--config', 'c.json', ...splitFiles, '--floor'], dir).stdout.replace(/\s+/g, ' ');
  assert.match(floor, /the floor what-if certifies nothing/);
  assert.doesNotMatch(floor, /with --target and --held-out/);
  const gate = cli(['whatif', '--config', 'c.json', ...splitFiles, '--gate'], dir).stdout.replace(/\s+/g, ' ');
  assert.match(gate, /with --target and --held-out, the loosest gate/);
  assert.doesNotMatch(gate, /the floor what-if certifies nothing/);
});

test('whatif --show-held-out lists the gate\'s held-out silent errors, and claims a log only when there is one', () => {
  const args = [...splitFiles, '--gate', '--target', '40', '--show-held-out'];
  const plain = cli(['whatif', '--config', path.join(SPLIT, 'gate.json'), ...args]).stdout.replace(/\s+/g, ' ');
  assert.match(plain, /Listed \(--show-held-out\): the held-out silent errors there are G19 G26\./);
  const raw = JSON.parse(fs.readFileSync(path.join(SPLIT, 'gate.json'), 'utf8'));
  raw.split.log = 'split-log.json';
  const dir = folder({ 'c.json': raw });
  const logged = cli(['whatif', '--config', 'c.json', ...args, '--lenient'], dir).stdout.replace(/\s+/g, ' ');
  assert.match(logged, /Listed \(--show-held-out; the log records the listing\): the held-out silent errors there are G19 G26\./);
});

test('agree: 100 resamples is the least allowed, and files that differ raise no "same content" warning', () => {
  const A = path.join(__dirname, 'fixtures', 'agree');
  const args = n => ['agree', '--config', path.join(A, 'config.json'), '--keys', ...['ann', 'ben', 'cai'].map(x => path.join(A, x + '.json')), '--resamples', n];
  const r = cli(args('100'));
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /\[M3\]/);
  assert.equal(cli(args('99')).status, 1);
});

test('--write-key: where the config reads the key from is where it writes, whatever the extension says', () => {
  const { agreeKeys, majorityKeyText } = require('../src/agree.js');
  const A = path.join(__dirname, 'fixtures', 'agree');
  const config = loadConfig(path.join(A, 'config.json'));
  const k = agreeKeys({ config, keyPaths: ['ann', 'ben', 'cai'].map(x => path.join(A, x + '.json')), majority: true });
  const atKey = key => ({ ...config, input: { ...config.input, key: { ...config.input.key, ...key } } });
  assert.ok(Array.isArray(JSON.parse(majorityKeyText(atKey({ records_at: 'data.rows' }), k.majority)).data.rows));
  const lines = majorityKeyText(atKey({ format: 'jsonl' }), k.majority, 'key.json').trim().split('\n');
  assert.equal(lines.length, k.majority.written.length);
  assert.ok(lines.every(l => JSON.parse(l).id));
});

test('estimate: a key from a judge that matches the run on every record is said (A8) when no record stood in for a verdict', () => {
  const E = path.join(__dirname, 'fixtures', 'estimate');
  const read = n => JSON.parse(fs.readFileSync(path.join(E, n), 'utf8'));
  const { estimateRun } = require('../src/estimate.js');
  const dir = folder({ 'c.json': read('config.json'), 'p.json': read('predictions.json'), 'pk.json': read('person-key.json'),
    'j.json': read('predictions.json').map(({ id, category }) => ({ id, category })) });
  const r = estimateRun({ config: loadConfig(path.join(dir, 'c.json')), predPath: path.join(dir, 'p.json'), judgeKeyPath: path.join(dir, 'j.json'),
    personKeyPath: path.join(dir, 'pk.json'), mode: 'lenient' });
  assert.ok(r.problems.some(i => i.trap === 'A8'), JSON.stringify(r.problems.map(i => i.trap)));
});

test('variance --rulings: of a run\'s own notes, only the rulings file\'s are carried up', () => {
  const cfg = { outputs: { tags: { type: 'set' } }, routing: ROUTING };
  const key = [{ id: 'a', gold: 'PUB', tags: ['x'] }, { id: 'b', gold: 'PUB', tags: ['x'] }];
  const spaced = { ...out('a', ['x']), id: ' a' };   // trimmed and noted (B8)
  const dir = folder({ 'c.json': cfg, 'k.json': key, 'r1.json': [spaced, out('b', ['x'])], 'r2.json': [out('a', ['x']), out('b', ['x'])],
    'rul.json': { rulings: [{ id: 'a', output: 'tags', value: 'y', ruling: 'reject', by: 'DH', on: '2026-10-30' }] } });
  const config = loadConfig(path.join(dir, 'c.json'));
  const rulings = require('../src/rulings.js').loadRulings(path.join(dir, 'rul.json'), config);
  const v = varianceRun({ config, keyPath: path.join(dir, 'k.json'), predPaths: [path.join(dir, 'r1.json'), path.join(dir, 'r2.json')], rulings });
  assert.deepEqual(v.problems.map(i => i.trap), []);
});

test('variance --rulings: the gaps ruled out are counted, as a plain number', () => {
  const R = path.join(__dirname, 'fixtures', 'rulings');
  const r = cli(['variance', '--config', path.join(R, 'config.json'), '--key', path.join(R, 'key.json'), '--rulings', path.join(R, 'rulings.json'),
    path.join(R, 'predictions.json'), path.join(R, 'predictions.json')]);
  assert.match(r.stdout, /^ +1 ruled not a gap in /m);
});

test('a CSV header with an empty column says which column, counting from 1', () => {
  const dir = folder({ 'c.json': { outputs: { tags: { type: 'set' } }, routing: ROUTING }, 'k.json': [{ id: 'a', gold: 'PUB', tags: ['x'] }], 'p.csv': 'id,,route\na,b,PUB\n' });
  assert.match(cli(['score', '--config', 'c.json', '--pred', 'p.csv', '--key', 'k.json'], dir).stderr, /column 2 has no name/);
});

test('score --grades: warnings are listed, and stops are not among them', () => {
  const F = path.join(__dirname, 'fixtures', 'freetext');
  const g = JSON.parse(fs.readFileSync(path.join(F, 'grades-a.json'), 'utf8'));
  g.grades[0].kinds = ['figure altered'];
  const dir = folder({ 'g.json': g });
  assert.match(cli(['score', '--grades', 'g.json', '--lenient'], dir).stdout, /WARNINGS AND CLEAN-UPS\n +warn \[J6\]/);
});
