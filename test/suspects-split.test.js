// wfeval suspects with a split in the config (traps O21-O24): the held-out records are neither
// suspects nor evidence unless --show-held-out, and nothing the command writes names them. Every
// number is worked by hand in test/fixtures/suspects/EXPECTED.md, "With a split".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig, validateConfig } = require('../src/config.js');
const { scoreRun } = require('../src/score.js');
const { splitOf, sha256Point } = require('../src/split.js');
const { loadRulings } = require('../src/rulings.js');

const root = path.join(__dirname, '..');
const S = 'test/fixtures/suspects';
const f = name => path.join(root, S, name);
const rel = name => S + '/' + name;   // as typed on the command line, from the repository's folder
const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin', 'wfeval.js'), 'suspects', ...args], { encoding: 'utf8', cwd: root });
// The held-out half of config-split.json (30% held out, sha256, no salt), and the tuning half.
const HELD = ['T1', 'T2', 'T4', 'T5', 'T13'];
const TUNING = ['T3', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];
const named = (text, ids = HELD) => ids.filter(id => new RegExp('\\b' + id + '\\b').test(text));
const flat = out => out.replace(/\s+/g, ' ');
const wide = out => out.split('\n').filter(l => l.length > 100);
const config = loadConfig(f('config-split.json'));
const plain = loadConfig(f('config.json'));
const runA = f('run-a.json');
const runB = f('run-b.json');
// Required inside each test, so each test fails on its own where the code is missing.
const suspectsRun = opts => require('../src/suspects.js').suspectsRun({ config, keyPath: f('key.json'), applySplit: true, ...opts });
const render = (r, top) => require('../src/report/suspects.js').renderSuspects(r, top);
const close = (a, b, d = 1e-4) => assert.ok(Math.abs(a - b) < d, a + ' is not ' + b);
const row = s => [s.rank, s.kind, s.id, s.output, s.value];

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-suspects-split-'));
  return { dir, file: name => path.join(dir, name), done: () => fs.rmSync(dir, { recursive: true }) };
}
// A copy of a fixture config in a fresh folder, with split.log beside it; change edits the raw config.
function withLog(change = raw => raw) {
  const t = tmp();
  const raw = JSON.parse(fs.readFileSync(f('config-split.json'), 'utf8'));
  raw.split = { ...raw.split, log: 'split-log.json' };
  fs.writeFileSync(t.file('config.json'), JSON.stringify(change(raw), null, 2));
  return { ...t, config: t.file('config.json'), log: t.file('split-log.json') };
}
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
// T14 retells T5: the same answer key and the same answers. dup: the key marks it a duplicate of T5.
function withT14(t, { dup = true, story = false } = {}) {
  const key = readJson(f('key.json'));
  const t5 = key.find(k => k.id === 'T5');
  const k = [...key.map(x => (story && x.id === 'T5' ? { ...x, story: 's5' } : x)),
    { ...t5, id: 'T14', ...(dup ? { duplicate_of: 'T5' } : {}), ...(story ? { story: 's5' } : {}) }];
  const pred = readJson(runA);
  const name = 'key' + (dup ? '-dup' : '') + (story ? '-story' : '') + '.json';
  fs.writeFileSync(t.file(name), JSON.stringify(k));
  fs.writeFileSync(t.file('run-14.json'), JSON.stringify([...pred, { ...pred.find(x => x.id === 'T5'), id: 'T14' }]));
  return { key: t.file(name), run: t.file('run-14.json') };
}
const cfg = extra => validateConfig({ ...readJson(f('config-split.json')), ...extra }).config;

// ---------- which records are held out ----------

test('O21: the suspects fixture split 30% held out, as score splits it: T1, T2, T4, T5 and T13 held out', () => {
  // The first 4 bytes of SHA-256 of each id, from 0 to 1 (EXPECTED.md; checked with .NET's SHA256 too).
  const points = Object.fromEntries(['T1', 'T2', 'T3', 'T4', 'T5', 'T13', 'T6', 'T8', 'T12'].map(id => [id, sha256Point(id, '').toFixed(4)]));
  assert.deepEqual(points, { T1: '0.1233', T2: '0.0601', T3: '0.3666', T4: '0.0700', T5: '0.0080', T13: '0.2650', T6: '0.4287', T8: '0.3765', T12: '0.5618' });
  const { paired } = scoreRun({ config: plain, predPath: runA, keyPath: f('key.json') });
  const halves = splitOf(paired, config);
  assert.deepEqual(halves.held_out, HELD);
  assert.deepEqual(halves.tuning, TUNING);
});

// ---------- O21: left out, both as suspects and as evidence ----------

test('O21: with a split, held-out records are neither suspects nor evidence: five suspects, weights worked by hand', () => {
  const R = suspectsRun({ predPaths: [runA] });
  assert.deepEqual(R.suspects.map(row), [
    [1, 'key_lacks', 'T7', 'tags', 'refund'],
    [2, 'label', 'T8', 'category', 'billing'],
    [3, 'key_lists', 'T8', 'tags', 'late'],
    [4, 'key_lists', 'T10', 'tags', 'fraud'],
    [5, 'key_lacks', 'T3', 'tags', 'late'],
  ]);
  const w = R.suspects.map(s => s.weight);
  close(w[0], 51 / 5);
  close(w[1], 7);
  close(w[2], 2639 / 450);
  close(w[3], 3341 / 594);
  close(w[4], 5609 / 5101);
  const [refund, label, late, fraud, late3] = R.suspects.map(s => s.evidence);
  const top = [{ where: 'at 0.90 or more', agree: 3, of: 3 }];
  assert.deepEqual(refund, { kind: 'key_lacks', bin: '0.90 or more', listed: 2, of: 2, curve: 0.875, curve_from: top, q: 0.9107 });
  assert.deepEqual(label, { kind: 'label', bin: '0.90 or more', agree: 3, of: 3, curve: 0.875, curve_from: top });
  assert.deepEqual(late, { kind: 'key_lists', bin: 'never', when_listed: 0, listed: 1, when_lacking: 4, lacking: 5 });
  assert.deepEqual(fraud, { kind: 'key_lists', bin: 'never', when_listed: 0, listed: 0, when_lacking: 6, lacking: 6 });
  assert.deepEqual(late3, { kind: 'key_lacks', bin: '0.50-0.59', listed: 0, of: 0, curve: 0.5237,
    curve_from: [{ where: 'never stated', agree: 2, of: 20 }, { where: 'at 0.80 or more', agree: 5, of: 6 }], q: 0.5237 });
  assert.deepEqual(R.counts, { key_lacks: 2, key_lists: 2, label: 1, total: 5 });
  // In numbers: how many were left out, and no look (nothing of the held-out half was shown).
  assert.deepEqual(R.split, { held_out_share: 0.3, hash: 'sha256', salt: '', by: 'cluster', log: null,
    tuning: { records: 8 }, held_out: { records: 5, left_out: 5 }, set_aside: 0, look: null });
  // T13's failed call is in the held-out half: no N15 warning names it (its record gives no evidence anyway).
  assert.deepEqual(R.problems, []);
  // The split is opt-in for a library caller, as for score: without applySplit, every record, as before.
  const all = require('../src/suspects.js').suspectsRun({ config, keyPath: f('key.json'), predPaths: [runA] });
  assert.deepEqual(all.suspects.map(s => s.id + ' ' + s.value), ['T8 billing', 'T8 late', 'T10 fraud', 'T7 refund', 'T5 damaged', 'T3 late']);
  assert.equal(all.split, undefined);
});

test('O21: the report says once how many held-out records were left out, and that --show-held-out includes them', () => {
  const r = cli('--config', rel('config-split.json'), '--key', rel('key.json'), rel('run-a.json'));
  assert.equal(r.status, 0, r.stderr);
  const out = flat(r.stdout);
  assert.match(out, /SPLIT The tuning half: 8 of 13 records\. The other 5 records are held out from tuning \(30% held out by a hash of each record's cluster, a duplicate's primary, or its id\): left out here, both as suspects and from the evidence each suspect is ranked on\. --show-held-out includes them\./);
  assert.equal(out.match(/--show-held-out includes them/g).length, 1);
  assert.match(out, /measured on the answer key's other records in the tuning half/);
  assert.deepEqual(named(r.stdout + r.stderr), []);
  assert.deepEqual(wide(r.stdout), []);
  // The rows, in the order worked by hand.
  assert.deepEqual(r.stdout.split('\n').filter(l => /^ {2}\d+ {2}T\d/.test(l)).map(l => l.trim().split(/\s+/).slice(0, 4).join(' ')),
    ['1 T7 tags lacks', '2 T8 category says', '3 T8 tags lists', '4 T10 tags lists', '5 T3 tags lacks']);
});

test('O21: rulings on held-out records are counted, never named', () => {
  const rulings = loadRulings(f('rulings.json'), config);
  const R = suspectsRun({ predPaths: [runA], rulings });
  // T7's add, T10's remove and T8's replace leave nothing to disagree about; T3 and T8's late are ruled.
  assert.deepEqual(R.suspects, []);
  assert.equal(R.rulings.not_listed, 2);
  // T5's pending ruling is on a held-out record: counted under the split, in no list.
  assert.deepEqual(R.rulings.pending, []);
  assert.deepEqual(R.split.rulings, { held_out: { added: 0, rejected: 0, pending: 1, set_aside: 0, removed: 0, kept: 0, replaced: 0 } });
  const text = render(R);
  // In score's words (added, ruled not a gap and pending always said; the rest when there are some).
  assert.match(flat(text), /Rulings on held-out records: 0 added, 0 ruled not a gap, 1 pending \(counted, not listed\)\./);
  assert.match(flat(text), /No suspect left to rule on: the run agrees with every entry of the answer key in the tuning half that has no ruling yet\./);
  assert.match(flat(text), /1 value added: T7 tags refund; 1 value removed: T10 tags fraud; 1 label replaced: T8 category billing with shipping/);
  assert.deepEqual(named(text + JSON.stringify(R)), []);
});

// ---------- O21, O22: nothing names a held-out record ----------

test('O21, O22: no output of suspects with a split names a held-out record: terminal, JSON, problems, the written rulings file', () => {
  const t = tmp();
  // A stray space on T5 (a clean-up that names it), T13's failed call, a rulings file with a pending
  // ruling on T5, a remove on T1 that no longer fits the key (a warning that names it), and a keep on T8.
  const pred = readJson(runA).map(x => (x.id === 'T5' ? { ...x, tags: [{ value: 'late ', confidence: 0.95 }, { value: 'damaged', confidence: null }] } : x));
  fs.writeFileSync(t.file('run-space.json'), JSON.stringify(pred));
  const earlier = [
    { id: 'T5', output: 'tags', value: 'damaged', ruling: 'pending', by: 'DH', on: '2026-11-01' },
    { id: 'T1', output: 'tags', value: 'late', ruling: 'remove', by: 'DH', on: '2026-11-01' },
    { id: 'T8', output: 'tags', value: 'late', ruling: 'keep', by: 'DH', on: '2026-11-01' },
  ];
  fs.writeFileSync(t.file('earlier.json'), JSON.stringify({ rulings: earlier }));
  const args = ['--config', rel('config-split.json'), '--key', rel('key.json'), t.file('run-space.json'), rel('run-b.json'), '--rulings', t.file('earlier.json')];
  const r = cli(...args, '--json', t.file('out.json'), '--write-rulings', t.file('new.json'));
  assert.equal(r.status, 0, r.stderr);
  const json = fs.readFileSync(t.file('out.json'), 'utf8');
  assert.deepEqual(named(r.stdout + r.stderr), [], 'terminal');
  assert.deepEqual(named(json), [], 'JSON');
  // The clean-up and the warning that named a held-out record count it instead.
  const problems = JSON.parse(json).problems;
  for (const trap of ['D7', 'N12']) {
    const p = problems.find(x => x.trap === trap);
    assert.ok(p, trap);
    assert.match(p.message, /\(1 held-out record, not named: --show-held-out names it\)$/, trap);
  }
  assert.equal(problems.filter(x => x.trap === 'N15').length, 0);
  // T5's pending ruling, and T1's remove (set aside: the key does not list late on T1).
  assert.deepEqual(JSON.parse(json).split.rulings.held_out, { added: 0, rejected: 0, pending: 1, set_aside: 1, removed: 0, kept: 0, replaced: 0 });
  // The written file: the earlier rulings as written (two on held-out records: dropping them would
  // change the key score uses for the held-out half), then pending rulings for tuning suspects only.
  const written = readJson(t.file('new.json')).rulings;
  assert.deepEqual(written.slice(0, 3), earlier);
  const fresh = written.slice(3);
  assert.ok(fresh.length > 0);
  assert.deepEqual(named(JSON.stringify(fresh)), [], 'written rulings');
  assert.ok(fresh.every(x => TUNING.includes(x.id) && x.ruling === 'pending'));
  assert.match(flat(r.stderr), /written as pending, after the 3 ruling\(s\) of \S+earlier\.json \(2 of them on held-out records, copied as written\)\./);
  // With --show-held-out every one of them is named.
  const shown = cli(...args, '--show-held-out');
  assert.equal(shown.status, 0, shown.stderr);
  assert.deepEqual(named(shown.stdout), ['T1', 'T5', 'T13']);
  t.done();
});

test('O22: stops that name a held-out record count it instead: a rulings file as read and as applied, a run that lacks one', () => {
  const t = tmp();
  const ruling = { id: 'T5', output: 'tags', value: 'damaged', ruling: 'pending', by: 'DH', on: '2026-11-01' };
  // I12, as the file is read: one value ruled on twice.
  fs.writeFileSync(t.file('twice.json'), JSON.stringify({ rulings: [ruling, { ...ruling, ruling: 'reject' }] }));
  // I13, as it is applied: an add outside allowed_values (strict).
  fs.writeFileSync(t.file('typo.json'), JSON.stringify({ rulings: [{ ...ruling, value: 'misc', ruling: 'add' }] }));
  // B5: a run that lacks T5.
  fs.writeFileSync(t.file('lacks.json'), JSON.stringify(readJson(runA).filter(x => x.id !== 'T5')));
  const base = ['--config', rel('config-split.json'), '--key', rel('key.json')];
  for (const [trap, args] of [['I12', [rel('run-a.json'), '--rulings', t.file('twice.json')]], ['I13', [rel('run-a.json'), '--rulings', t.file('typo.json')]],
    ['B5', [t.file('lacks.json')]]]) {
    const r = cli(...base, ...args);
    assert.equal(r.status, 1, trap);
    assert.equal(r.stdout, '', trap);
    assert.match(r.stderr, new RegExp('\\[' + trap + '\\]'), trap);
    assert.deepEqual(named(r.stderr), [], trap);
    assert.match(r.stderr, /1 held-out record, not named: --show-held-out names it/, trap);
    // --show-held-out names it.
    assert.match(cli(...base, ...args, '--show-held-out').stderr, /T5/, trap);
  }
  t.done();
});

// ---------- O23: --show-held-out ----------

test('O23: --show-held-out: held-out records are suspects and evidence exactly as without a split', () => {
  const R = suspectsRun({ predPaths: [runA, runB], showHeldOut: true });
  const P = require('../src/suspects.js').suspectsRun({ config: plain, keyPath: f('key.json'), predPaths: [runA, runB] });
  assert.deepEqual(R.suspects, P.suspects);
  assert.deepEqual(R.problems, P.problems);   // N15 names T13 now
  assert.deepEqual(R.split.held_out, { records: 5, left_out: 0 });
  assert.deepEqual([R.split.look.counted, R.split.look.reason, R.split.look.ids_shown], [false, 'no_log', true]);
  // With rulings: each held-out ruling named and applied as without a split.
  const rulings = loadRulings(f('rulings.json'), config);
  const Rr = suspectsRun({ predPaths: [runA], rulings, showHeldOut: true });
  const Pr = require('../src/suspects.js').suspectsRun({ config: plain, keyPath: f('key.json'), predPaths: [runA], rulings: loadRulings(f('rulings.json'), plain) });
  assert.deepEqual(Rr.suspects, Pr.suspects);
  assert.deepEqual(Rr.rulings, Pr.rulings);
  assert.equal(Rr.split.rulings, undefined);
  const r = cli('--config', rel('config-split.json'), '--key', rel('key.json'), rel('run-a.json'), '--show-held-out');
  assert.equal(r.status, 0, r.stderr);
  assert.match(flat(r.stdout), /SPLIT Both halves, with --show-held-out: the 5 held-out records \(30% held out by a hash of each record's cluster, a duplicate's primary, or its id\) are listed and read as evidence with the tuning half's 8\./);
  assert.match(flat(r.stdout), /Looks at the held-out half are not counted without split\.log, so this listing is not recorded: add "log": "split-log\.json" to split in the config to count it\./);
  assert.deepEqual(named(r.stdout), ['T5', 'T13']);
  assert.deepEqual(wide(r.stdout), []);
});

test('O23: --show-held-out is a look that lists the records; the same again is that look again; a later claim on them spends nothing', () => {
  const a = withLog();
  const args = ['--config', a.config, '--key', rel('key.json'), rel('run-a.json'), '--show-held-out'];
  const first = cli(...args);
  assert.equal(first.status, 0, first.stderr);
  assert.match(flat(first.stdout), /The first look at this held-out half: no log file was found at split-log\.json, so a new one was started\. The log records the held-out records it listed: from now on a claim on them can spend nothing\./);
  let log = readJson(a.log);
  assert.equal(log.looks.length, 1);
  const look = log.looks[0];
  assert.deepEqual([look.look, look.command, look.ids_shown, look.held_out_records, look.mode, look.runs.length, typeof look.key], [1, 'suspects', true, 5, 'strict', 1, 'string']);
  assert.deepEqual(log.listings.map(l => [l.after, l.covers]), [[1, 1]]);
  // The listing names the held-out records it showed (T5, the held-out suspect), and only those (O13).
  assert.deepEqual(log.listings[0].ids, ['T5']);
  assert.deepEqual(Object.keys(log.records.held_out).sort(), [...HELD].sort());
  // The same command on the same files: look 1 again, not counted.
  const again = cli(...args);
  assert.match(flat(again.stdout), /Look 1 at this held-out half again \(split-log\.json\): the same command, files, config and mode as on \d{4}-\d\d-\d\d, so it is not counted again\./);
  assert.equal(readJson(a.log).looks.length, 1);
  // What is listed changes the look: --top 3 lists fewer, --json lists them all.
  cli(...args, '--top', '3');
  const t = tmp();
  cli(...args, '--top', '3', '--json', t.file('all.json'));
  t.done();
  log = readJson(a.log);
  assert.equal(log.looks.length, 3);
  // score's claim on the held-out half after the listing: nothing to spend (trap O13).
  const s = scoreRun({ config: loadConfig(a.config), predPath: runA, keyPath: f('key.json'), target: 40, applySplit: true, heldOut: true, look: true }).split;
  assert.equal(s.look.half.level, 0);
  assert.equal(s.target.why, 'listed');
  a.done();
});

test('O23: without --show-held-out nothing of the held-out half is shown, so no look is recorded', () => {
  const a = withLog();
  const r = cli('--config', a.config, '--key', rel('key.json'), rel('run-a.json'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(a.log), false);
  cli('--config', a.config, '--key', rel('key.json'), rel('run-a.json'), '--show-held-out');
  const before = fs.readFileSync(a.log, 'utf8');
  cli('--config', a.config, '--key', rel('key.json'), rel('run-a.json'), rel('run-b.json'));
  assert.equal(fs.readFileSync(a.log, 'utf8'), before);
  a.done();
});

test('O23: records that changed half are checked before anything is shown: strict stops, --lenient sets them aside', () => {
  const a = withLog(raw => ({ ...raw, duplicate_of_field: 'duplicate_of' }));
  const dup = withT14(a);                 // T14 a duplicate of T5: held out with it
  const own = withT14(a, { dup: false }); // T14 on its own: its id's place, 0.4996, is in the tuning half
  const r1 = cli('--config', a.config, '--key', dup.key, dup.run, '--show-held-out');
  assert.equal(r1.status, 0, r1.stderr);
  assert.ok(Object.hasOwn(readJson(a.log).records.held_out, 'T14'));
  // T14 in the tuning half now: listing it would show what the held-out half held.
  for (const show of [[], ['--show-held-out']]) {
    const r = cli('--config', a.config, '--key', own.key, own.run, ...show);
    assert.equal(r.status, 1, show.join(' '));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /\[O10\] split-log\.json: 1 record\(s\) in the tuning half now were held out at an earlier look/);
    assert.deepEqual(named(r.stderr, [...HELD, 'T14']), []);
  }
  // --lenient: set aside, in neither half, so neither a suspect nor evidence.
  const t = tmp();
  const r = cli('--config', a.config, '--key', own.key, own.run, '--lenient', '--json', t.file('out.json'));
  assert.equal(r.status, 0, r.stderr);
  const out = readJson(t.file('out.json'));
  assert.deepEqual([out.split.tuning.records, out.split.held_out.records, out.split.set_aside], [8, 5, 1]);
  assert.ok(out.suspects.every(s => s.id !== 'T14'));
  assert.match(flat(r.stdout), /1 record that changed half since an earlier look is set aside, in neither half \(--lenient\)\./);
  assert.deepEqual(named(r.stdout, [...HELD, 'T14']), []);
  // With --show-held-out the look records it as moved, never as held out again.
  cli('--config', a.config, '--key', own.key, own.run, '--lenient', '--show-held-out');
  assert.ok(Object.hasOwn(readJson(a.log).moved, 'T14'));
  t.done();
  a.done();
});

// ---------- O21: the same units as score ----------

test('O21: a record\'s half is decided as score decides it: a duplicate goes with its primary, a cluster stays whole', () => {
  const t = tmp();
  const dup = withT14(t);
  const story = withT14(t, { dup: false, story: true });
  const cases = [
    // T14 a duplicate of T5 (held out): it goes with T5, though its own id (0.4996) is in the tuning half.
    ['duplicate', cfg({ duplicate_of_field: 'duplicate_of' }), dup.key, 6, false],
    // split.by "id": T14 by its own id, in the tuning half, and listed (the key lacks damaged).
    ['by id', cfg({ duplicate_of_field: 'duplicate_of', split: { held_out: 0.3, by: 'id' } }), dup.key, 5, true],
    // T5 and T14 in one story, "s5" (place 0.2328): held out together.
    ['cluster', cfg({ clusters: { field: 'story' } }), story.key, 6, false],
  ];
  for (const [name, c, key, held, listed] of cases) {
    const R = require('../src/suspects.js').suspectsRun({ config: c, keyPath: key, predPaths: [dup.run], applySplit: true, mode: 'lenient' });
    const sc = scoreRun({ config: c, predPath: dup.run, keyPath: key, applySplit: true, mode: 'lenient' });
    assert.equal(R.split.held_out.left_out, held, name);
    assert.equal(sc.split.held_out.records, held, name);
    const heldIds = splitOf(sc.split.every, c).held_out;
    assert.ok(R.suspects.every(s => !heldIds.includes(s.id)), name);
    assert.equal(R.suspects.some(s => s.id === 'T14'), listed, name);
  }
  close(sha256Point('s5', ''), 0.2328);
  t.done();
});

// ---------- O24: --write-rulings ----------

test('O24: --write-rulings writes pending rulings for the tuning half\'s suspects only; with --show-held-out, the held-out ones too', () => {
  const t = tmp();
  const base = ['--config', rel('config-split.json'), '--key', rel('key.json'), rel('run-a.json')];
  const r = cli(...base, '--write-rulings', t.file('tuning.json'));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readJson(t.file('tuning.json')).rulings.map(x => x.id + ' ' + x.value), ['T7 refund', 'T8 billing', 'T8 late', 'T10 fraud', 'T3 late']);
  assert.match(r.stderr, /5 listed suspect\(s\) written as pending\./);
  const s = cli(...base, '--write-rulings', t.file('both.json'), '--show-held-out');
  assert.equal(s.status, 0, s.stderr);
  assert.deepEqual(readJson(t.file('both.json')).rulings.map(x => x.id + ' ' + x.value), ['T8 billing', 'T8 late', 'T10 fraud', 'T7 refund', 'T5 damaged', 'T3 late']);
  t.done();
});

// N8 with a split: the line counting the records the answer key blocks or suppresses counts the
// half that is shown, never a held-out record (O22).
test('N8: the records the answer key blocks or suppresses are counted in the half shown only', () => {
  const raw = readJson(f('config-split.json'));
  const cfg = validateConfig({ ...raw, routing: { field: 'route', gold_field: 'expected_route', map: { SEND: 'auto', HOLD: 'review', DUP: 'exclude', SPAM: 'block' } } }).config;
  const routeOf = new Map(readJson(runA).map(r => [r.id, r.route]));
  // T10 and T7 (tuning) and T5 (held out) left out by the key; T12 is a duplicate to the run and the key.
  const gold = { T10: 'SPAM', T7: 'DUP', T5: 'SPAM' };
  const t = tmp();
  fs.writeFileSync(t.file('key.json'), JSON.stringify(readJson(f('key.json')).map(k => ({ ...k, expected_route: gold[k.id] || routeOf.get(k.id) }))));
  const run = showHeldOut => require('../src/suspects.js').suspectsRun({ config: cfg, keyPath: t.file('key.json'), predPaths: [runA], applySplit: true, showHeldOut });
  const R = run(false);
  assert.equal(R.key_leaves_out, 3);
  assert.deepEqual(named(JSON.stringify(R.suspects) + render(R)), []);
  assert.equal(run(true).key_leaves_out, 4);
  t.done();
});

// ---------- the command line ----------

test('--show-held-out without a split in the config stops (exit 1), as for the other commands', () => {
  const r = cli('--config', rel('config.json'), '--key', rel('key.json'), rel('run-a.json'), '--show-held-out');
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /--show-held-out goes with a split in the config/);
});
