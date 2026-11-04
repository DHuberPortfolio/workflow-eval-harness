// What keeps the harness quick, and that going quicker changed no answer. These count work (files
// read, modules loaded, passes over the data), never the clock, so a slow machine cannot fail them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig, validateConfig } = require('../src/config.js');
const { scoreRun, varianceRun } = require('../src/score.js');
const { collect, findSuspects, rankSuspects } = require('../src/metrics/suspects.js');
const { gateSweep } = require('../src/metrics/whatif.js');

const root = path.join(__dirname, '..');
const fixture = (...p) => path.join(__dirname, 'fixtures', ...p);
const tiny = loadConfig(fixture('tiny', 'config.json'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-perf-'));

// What a command asks Node to load, from a process of its own: a hook on the loader, then the CLI.
function loaded(args) {
  const code = `const Module = require('module');
    const asked = [];
    const load = Module._load;
    Module._load = function (request, ...rest) { asked.push(request); return load.call(this, request, ...rest); };
    process.on('exit', () => require('fs').writeSync(2, JSON.stringify(asked)));
    process.argv = process.argv.slice(0, 1).concat(${JSON.stringify(path.join(root, 'bin', 'wfeval.js'))}, ${JSON.stringify(args)});
    require(process.argv[1]);`;
  const r = spawnSync(process.execPath, ['-e', code], { cwd: root, encoding: 'utf8' });
  return JSON.parse(r.stderr.slice(r.stderr.lastIndexOf('[')));
}

test('--help loads none of the tool\'s own code, and a command that hashes nothing does not load crypto', () => {
  assert.deepEqual(loaded(['--help']).filter(x => x.includes('src/')), []);
  const tinyFiles = ['--config', fixture('tiny', 'config.json'), '--pred', fixture('tiny', 'predictions.json'), '--key', fixture('tiny', 'key.json')];
  const scored = loaded(['score', ...tinyFiles, '--quiet']);
  assert.ok(scored.some(x => x.endsWith('score.js')), 'score ran');
  assert.ok(!scored.some(x => /(^|:)crypto$/.test(x)), 'score without a split hashes nothing');
  assert.ok(!scored.some(x => x.endsWith('terminal.js')), '--quiet prints no report');
  const hashed = loaded(['variance', '--config', fixture('tiny', 'config.json'), '--key', fixture('tiny', 'key.json'), fixture('runs', 'run-a.json'), fixture('runs', 'run-b.json')]);
  assert.ok(hashed.some(x => /(^|:)crypto$/.test(x)), 'variance fingerprints its runs');
});

// Random paired records, repeatable: any_of slots, values only some records hold, values the key
// does not list, and duplicate groups of two and three.
function pairedRecords() {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const values = ['a', 'b', 'c', 'd', 'e'];
  const paired = [];
  for (let i = 0; i < 60; i++) {
    const key = { tags: values.filter(() => rnd() < 0.3) };
    if (rnd() < 0.3) key.tags.push({ any_of: ['e', 'f'].filter(v => !key.tags.includes(v)) });
    const pred = { tags: values.filter(() => rnd() < 0.4).map(value => ({ value, confidence: Math.round(rnd() * 100) / 100, applied: rnd() < 0.8, inherited: false })) };
    key.tags = key.tags.filter(s => typeof s === 'string' || s.any_of.length);
    paired.push({ id: 'r' + i, scored: true, route_class: 'auto', gold_class: null, duplicate_of: i % 3 ? 'r' + (i - i % 3) : null, pred, key });
  }
  return paired;
}
const suspectsConfig = { wrong_when: 'any_mismatch', routing: { field: 'route' }, outputs: { tags: { type: 'set', field: 'tags' } }, allowed_values: {}, clusters: null };

test('N4: a suspect\'s weight is what it would be had the rest of its group never been in the set', () => {
  const paired = pairedRecords();
  const grouped = { ...suspectsConfig, duplicate_of_field: 'dup' };
  const c = collect([paired], grouped);
  const ranked = rankSuspects(findSuspects(c), c);
  assert.ok(ranked.length > 20, 'enough suspects to mean something');
  for (const s of ranked) {
    const others = new Set(c.groups.get(s.id).filter(id => id !== s.id));
    const without = paired.filter(r => !others.has(r.id));
    const alone = collect([without], { ...suspectsConfig, duplicate_of_field: null });
    const same = rankSuspects(findSuspects(alone), alone).find(x => x.id === s.id && x.value === s.value && x.kind === s.kind);
    assert.equal(s.weight, same.weight, s.id + ' ' + s.value);
    assert.deepEqual(s.evidence, same.evidence);
  }
});

test('suspects counts the cells once, however many duplicate groups the set has', () => {
  const grouped = { ...suspectsConfig, duplicate_of_field: 'dup' };
  const c = collect([pairedRecords()], grouped);
  const suspects = findSuspects(c);
  let passes = 0;
  const cells = c.sets.tags.cells;
  const walk = cells[Symbol.iterator].bind(cells);
  cells[Symbol.iterator] = () => { passes++; return walk(); };
  rankSuspects(suspects, c);
  assert.equal(passes, 1);
});

test('variance reads the key once, and every run says what it would have said reading the key itself', () => {
  const dir = tmp();
  const keyPath = path.join(dir, 'key.json');
  // A byte-order mark and a value with spaces: the key has something to say on every run.
  const key = JSON.parse(fs.readFileSync(fixture('tiny', 'key.json'), 'utf8'));
  key[0].SUBJECT = key[0].SUBJECT.map(v => ' ' + v);
  fs.writeFileSync(keyPath, '﻿' + JSON.stringify(key));
  const runs = ['a', 'b', 'c'].map(x => fixture('runs', 'run-' + x + '.json'));

  const read = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (file, ...rest) { if (file === keyPath) reads++; return read.call(this, file, ...rest); };
  try { varianceRun({ config: tiny, keyPath, predPaths: runs }); } finally { fs.readFileSync = read; }
  assert.equal(reads, 1);

  const keys = new Map();
  for (const predPath of [...runs, runs[0]]) {
    const alone = scoreRun({ config: tiny, predPath, keyPath });
    const shared = scoreRun({ config: tiny, predPath, keyPath, keys });
    assert.ok(alone.problems.some(i => i.trap === 'A3') && alone.problems.some(i => i.trap === 'D7'), 'the key says something');
    assert.deepEqual(shared.problems, alone.problems);
    assert.deepEqual(shared.paired, alone.paired);
    assert.deepEqual(shared.routing, alone.routing);
  }
  fs.rmSync(dir, { recursive: true });
});

test('a key that is also a run file is read with it, and what the later runs are told is unchanged', () => {
  const dir = tmp();
  const config = validateConfig({ id_field: 'id', outputs: { tags: { type: 'set', field: 'tags', key_field: 'answer' } }, routing: { field: 'route', map: { go: 'auto' } } }).config;
  const rows = tag => [{ id: 'a', route: 'go', tags: [{ value: tag, confidence: 0.9 }], answer: ['x'] }];
  const both = path.join(dir, 'both.json');
  const other = path.join(dir, 'other.json');
  // A byte-order mark on the shared file: said once when it is one read, and for the key when it is two.
  fs.writeFileSync(both, '﻿' + JSON.stringify(rows('x')));
  fs.writeFileSync(other, JSON.stringify(rows('y')));
  for (const order of [[both, other, both], [other, both, other]]) {
    const keys = new Map();
    for (const predPath of order) {
      const alone = scoreRun({ config, predPath, keyPath: both });
      const shared = scoreRun({ config, predPath, keyPath: both, keys });
      assert.deepEqual(shared.problems, alone.problems);
      assert.deepEqual(shared.paired, alone.paired);
    }
  }
  fs.rmSync(dir, { recursive: true });
});

test('a key that says a great deal is said again on every run, however much it says', () => {
  const dir = tmp();
  const config = validateConfig({ id_field: 'id', outputs: { tags: { type: 'set', field: 'tags' } }, routing: { field: 'route', map: { go: 'auto' } } }).config;
  const keyPath = path.join(dir, 'key.json');
  const runs = ['x', 'y'].map(name => path.join(dir, name + '.json'));
  // Over 200,000 clean-ups, one for each value written with spaces: more than one call can take as a spread.
  fs.writeFileSync(keyPath, JSON.stringify([{ id: 'a', tags: Array.from({ length: 200000 }, (_, i) => ' v' + i) }]));
  for (const f of runs) fs.writeFileSync(f, JSON.stringify([{ id: 'a', route: 'go', tags: [{ value: 'v0', confidence: 0.9 }] }]));
  const keys = new Map();
  const first = scoreRun({ config, predPath: runs[0], keyPath, keys, parts: 'paired' });
  const second = scoreRun({ config, predPath: runs[1], keyPath, keys, parts: 'paired' });
  assert.equal(second.problems.length, first.problems.length);
  assert.ok(first.problems.length >= 200000);
  fs.rmSync(dir, { recursive: true });
});

test('a gate sweep compares each record with the key once, however many gates it tries', () => {
  const config = loadConfig(fixture('gate', 'config.json'));
  const { paired } = scoreRun({ config, predPath: fixture('gate', 'predictions.json'), keyPath: fixture('gate', 'key.json') });
  const readsAt = step => {
    let reads = 0;
    const watched = paired.map(r => ({ ...r, key: new Proxy(r.key, { get(t, k) { reads++; return t[k]; } }) }));
    const sweep = gateSweep(watched, config, { from: 0.5, to: 1, step });
    return { reads, rows: sweep.rows.length, sweep };
  };
  const few = readsAt(0.25);
  const many = readsAt(0.05);
  assert.ok(many.rows > few.rows);
  assert.equal(many.reads, few.reads);
  // The same answers as a sweep that shares nothing: each row judged on its own.
  const at = many.sweep.rows.find(r => r.threshold === 0.75);
  const single = gateSweep(paired, config, { from: 0.75, to: 0.75, step: 1 }).rows.find(r => r.threshold === 0.75);
  assert.deepEqual(at, single);
});

test('parts: every choice raises the same problems, and leaves out what its command never reads', () => {
  const raw = JSON.parse(fs.readFileSync(fixture('tiny', 'config.json'), 'utf8'));
  const config = validateConfig({ ...raw, min_per_trap: 50 }).config;
  const files = { config, predPath: fixture('tiny', 'predictions.json'), keyPath: fixture('tiny', 'key.json') };
  const all = scoreRun({ ...files, mode: 'lenient' });
  assert.ok(all.problems.some(i => i.trap === 'H5'), 'H5 raised');
  for (const parts of ['rates', 'paired']) {
    const some = scoreRun({ ...files, mode: 'lenient', parts });
    assert.deepEqual(some.problems, all.problems);
    assert.deepEqual(some.paired, all.paired);
    assert.equal(some.key_gaps, undefined);
  }
  // Strict: H5 stops every one of them, with the same words.
  const stops = ['all', 'rates', 'paired'].map(parts => { try { scoreRun({ ...files, parts }); return null; } catch (e) { return e.message; } });
  assert.ok(stops[0].includes('[H5]'));
  assert.deepEqual([stops[1], stops[2]], [stops[0], stops[0]]);

  const rates = scoreRun({ ...files, mode: 'lenient', parts: 'rates' });
  assert.deepEqual(rates.routing, all.routing);
  assert.deepEqual(rates.quality, all.quality);
  assert.deepEqual(rates.records, all.records);
  assert.equal(rates.calibration.overall.ece, all.calibration.overall.ece);
  assert.ok(rates.calibration.overall.buckets.every(b => b.claims === undefined), 'no per-claim lists');
  assert.equal(scoreRun({ ...files, mode: 'lenient', parts: 'paired' }).routing, undefined);
});

test('possible key gaps and pending rulings look each record up, not through every record', () => {
  // Many records, each with a gap on a silent error and a pending ruling on it, in a list that counts
  // how often it is searched: a search per record is what made these quadratic.
  const dir = tmp();
  const config = validateConfig({ id_field: 'id', outputs: { tags: { type: 'set', field: 'tags', key_field: 'answer' } }, routing: { field: 'route', map: { go: 'auto' } } }).config;
  const rows = Array.from({ length: 300 }, (_, i) => ({ id: 'r' + i, route: 'go', tags: [{ value: 'x', confidence: 0.9 }], answer: ['y'] }));
  const file = path.join(dir, 'run.json');
  fs.writeFileSync(file, JSON.stringify(rows));
  const rulingsFile = path.join(dir, 'rulings.json');
  fs.writeFileSync(rulingsFile, JSON.stringify({ rulings: rows.map(r => ({ id: r.id, output: 'tags', value: 'x', ruling: 'pending' })) }));
  const rulings = require('../src/rulings.js').loadRulings(rulingsFile, config, 'lenient');
  let scans = 0;
  const filter = Array.prototype.filter;
  const find = Array.prototype.find;
  const long = list => { if (list.length >= rows.length) scans++; };
  Array.prototype.filter = function (...a) { long(this); return filter.apply(this, a); };
  Array.prototype.find = function (...a) { long(this); return find.apply(this, a); };
  let r;
  try { r = scoreRun({ config, predPath: file, keyPath: file, mode: 'lenient', rulings }); } finally {
    Array.prototype.filter = filter;
    Array.prototype.find = find;
  }
  // The answers: every record's gap, on a silent error that adding it would not clear ("y" stays unfilled).
  assert.equal(r.key_gaps.candidates.length, rows.length);
  assert.ok(r.key_gaps.candidates.every(c => c.silent_error && c.silent_error.if_added.length > 0));
  assert.equal(r.rulings.if_pending_added.pending, rows.length);
  assert.ok(scans < rows.length, scans + ' passes over the whole list, for ' + rows.length + ' records');
  fs.rmSync(dir, { recursive: true });
});

test('agree lists the records in the order they first appear, without searching the list for each', () => {
  const dir = tmp();
  const row = id => ({ id, expected_route: 'AUTO_PUBLISH', SUBJECT: ['s'], GEOGRAPHY: ['g'] });
  const first = Array.from({ length: 300 }, (_, i) => row('r' + i));
  // "extra" opens the second key but comes after all of the first's; r150 is in the first alone.
  const second = [row('extra'), ...first.filter(r => r.id !== 'r150')];
  const keyPaths = ['a.json', 'b.json'].map(n => path.join(dir, n));
  fs.writeFileSync(keyPaths[0], JSON.stringify(first));
  fs.writeFileSync(keyPaths[1], JSON.stringify(second));
  const { agreeKeys } = require('../src/agree.js');
  let scans = 0;
  const includes = Array.prototype.includes;
  Array.prototype.includes = function (...a) { if (this.length >= first.length) scans++; return includes.apply(this, a); };
  let a;
  try { a = agreeKeys({ config: tiny, keyPaths, resamples: 100, mode: 'lenient' }); } finally { Array.prototype.includes = includes; }
  assert.deepEqual(a.outputs[0].graded_by_one, ['r150', 'extra']);
  assert.ok(scans < first.length, scans + ' searches of the whole list, for ' + first.length + ' records');
  fs.rmSync(dir, { recursive: true });
});

test('findings with nothing in them are the same to every reader as ever', () => {
  const r = scoreRun({ config: tiny, predPath: fixture('tiny', 'predictions.json'), keyPath: fixture('tiny', 'key.json') });
  const clean = r.records.find(x => Object.values(x.differences).every(d => Object.keys(d).length === 0));
  assert.deepEqual(JSON.parse(JSON.stringify(clean.differences)),
    { wrong: {}, missing_rejected: {}, missing: {}, invalid: {}, near_miss: {}, declined: {}, should_decline: {} });
});
