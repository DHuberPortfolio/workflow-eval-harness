// The tuning half and the held-out half: the cases a newcomer's end-to-end test and an integration
// review found (traps O6, O13, O25, O26 and the wording). Each was a test that failed on the code
// before its fix. Numbers worked by hand are in test/fixtures/split/EXPECTED.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('../src/config.js');
const { scoreRun, compareRun, varianceRun } = require('../src/score.js');
const { splitOf } = require('../src/split.js');
const { lookLevel } = require('../src/split-log.js');
const { renderTerminal } = require('../src/report/terminal.js');
const { resultsJson } = require('../src/report/json.js');
const { claimLines, lookLines, localDate } = require('../src/report/split.js');

const F = path.join(__dirname, 'fixtures', 'split');
const f = name => path.join(F, name);
const GATE = path.join(__dirname, 'fixtures', 'gate');
const SUS = path.join(__dirname, 'fixtures', 'suspects');
const CLI = path.join(__dirname, '..', 'bin', 'wfeval.js');
const HELD = ['S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S13', 'S21'];
const NOW = new Date('2026-11-01T12:00:00.000Z');
const named = (text, ids) => ids.filter(id => new RegExp('(?<![A-Za-z0-9])' + id + '(?![A-Za-z0-9])').test(text));
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const flat = text => text.replace(/\s+/g, ' ');

// A copy of a fixture config in a fresh folder, with split.log beside it; change edits the raw config.
function withLog(change = raw => raw, name = 'config.json') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-split-'));
  const raw = JSON.parse(fs.readFileSync(name.includes(path.sep) ? name : f(name), 'utf8'));
  raw.split = { ...raw.split, log: 'split-log.json' };
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify(change(raw), null, 2));
  return { dir, file, config: loadConfig(file), log: path.join(dir, 'split-log.json') };
}
const looks = a => (fs.existsSync(a.log) ? JSON.parse(fs.readFileSync(a.log, 'utf8')).looks.length : 0);

// ---------- 1, 13. a look at the held-out half is asked for (--held-out) ----------

test('O25: without --held-out nothing of the held-out half is shown and no look is spent; --held-out looks', () => {
  const a = withLog();
  const base = ['--config', a.file, '--key', f('key.json')];
  // score: the tuning half only, and one line on what a look would be.
  const json = path.join(a.dir, 's.json');
  const plain = cli('score', ...base, '--pred', f('predictions-v2.json'), '--target', '40', '--json', json);
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(looks(a), 0);
  assert.match(flat(plain.stdout), /HELD-OUT HALF not looked at\. --held-out looks at it, and counts as a look: none yet \(split-log\.json does not exist yet\): the first look may use 2\.5% of the 5% allowed for being wrong\./);
  assert.match(flat(plain.stdout), /The other 11 records are held out from tuning \(.*\), and not looked at here: every number in this report is the tuning half's\./);
  const s = JSON.parse(fs.readFileSync(json, 'utf8')).split;
  assert.deepEqual([s.looked, s.held_out, s.next_look.next.look, 'target' in s], [false, { records: 11 }, 1, false]);
  // --quiet alone records nothing; --quiet --held-out records a look (its exit code can say something).
  cli('score', ...base, '--pred', f('predictions.json'), '--quiet');
  assert.equal(looks(a), 0);
  cli('score', ...base, '--pred', f('predictions.json'), '--quiet', '--held-out');
  assert.equal(looks(a), 1);
  // compare, variance and whatif without --held-out: no look either.
  const c = cli('compare', ...base, '--before', f('predictions.json'), '--after', f('predictions-v2.json'));
  assert.match(flat(c.stdout), /HELD-OUT HALF not looked at\. --held-out looks at it, and counts as a look: 1 look at this held-out half so far \(split-log\.json\); the next is look 2, which may use 1\.25% of the 5% allowed for being wrong\./);
  cli('variance', ...base, f('predictions.json'), f('predictions-v2.json'));
  const g = withLog(raw => raw, 'gate.json');
  const w = cli('whatif', '--config', g.file, '--pred', path.join(GATE, 'predictions.json'), '--key', path.join(GATE, 'key.json'), '--gate', '--target', '40');
  assert.match(flat(w.stdout), /HELD-OUT HALF not looked at\. The choice made on the tuning half is gate 0\.75, certified there at a silent error rate of 5\.6% \(1 of 18\)\. To check it on the 27 held-out records, run this again with --held-out, which counts as a look: none yet/);
  assert.equal(looks(a), 1);
  assert.equal(looks(g), 0);
  // With --held-out each is a look; --show-held-out is one too.
  cli('compare', ...base, '--before', f('predictions.json'), '--after', f('predictions-v2.json'), '--held-out');
  cli('variance', ...base, f('predictions.json'), f('predictions-v2.json'), '--held-out');
  cli('score', ...base, '--pred', f('predictions-v3.json'), '--show-held-out');
  assert.equal(looks(a), 4);
  // check: the looks so far, and the next one's share.
  assert.match(cli('check', ...base, '--pred', f('predictions.json')).stdout, /looks {7}4 looks at this held-out half so far \(split-log\.json\); some of its records were listed at look 4/);
  assert.match(cli('check', '--config', a.file).stdout, /looks {7}4 looks at this held-out half so far \(split-log\.json\)/);
  // --held-out without a split is refused, as --show-held-out is.
  const none = cli('score', '--config', path.join(GATE, 'config.json'), '--pred', path.join(GATE, 'predictions.json'), '--key', path.join(GATE, 'key.json'), '--held-out');
  assert.equal(none.status, 1);
  assert.match(none.stderr, /--held-out goes with a split in the config/);
});

test('O19, O25: --fail-on and --fail-if-worse read the held-out half only with --held-out', () => {
  // G27, held out, went out past its gate: a critical safeguard failure only the held-out half has.
  const r = cli('score', '--config', f('gate.json'), '--pred', f('gate-sg.json'), '--key', path.join(GATE, 'key.json'), '--quiet', '--fail-on', 'critical');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /fail-on: the tuning half only; --held-out reads the held-out half too \(a look\)/);
  assert.equal(cli('score', '--config', f('gate.json'), '--pred', f('gate-sg.json'), '--key', path.join(GATE, 'key.json'), '--quiet', '--fail-on', 'critical', '--held-out').status, 3);
  const c = cli('compare', '--config', f('config.json'), '--key', f('key.json'), '--before', f('predictions.json'), '--after', f('predictions-bad.json'), '--fail-if-worse', 'silent-errors');
  assert.match(c.stderr, /fail-if-worse: the tuning half only; --held-out reads the held-out half too \(a look\)/);
  assert.doesNotMatch(c.stderr, /on the held-out half/);
});

// ---------- 3. a listing covers the records it showed; a look counts for the records in it ----------

test('O13, O14: a listing on the old key leaves records added later alone, and is no look at them', () => {
  const a = withLog();
  const score = (pred, key, opts = {}) => scoreRun({ config: a.config, predPath: pred, keyPath: f(key), applySplit: true, heldOut: true, look: true, now: NOW, target: 40, ...opts });
  score(f('predictions.json'), 'key.json');                       // look 1: the 11 first held-out records
  score(f('predictions-grown.json'), 'key-grown.json');           // look 2: S29, S31 and S32 first seen
  score(f('predictions-v2.json'), 'key.json', { showHeldOut: true }); // look 3: lists the first 11 only
  // Look 4 on the grown key, a new version of the run (a tuning record changed).
  const grown = JSON.parse(fs.readFileSync(f('predictions-grown.json'), 'utf8')).map(r => (r.id === 'S01' ? { ...r, codes: ['A', 'X'] } : r));
  const v2 = path.join(a.dir, 'grown-v2.json');
  fs.writeFileSync(v2, JSON.stringify(grown));
  const s = score(v2, 'key-grown.json').split;
  const log = JSON.parse(fs.readFileSync(a.log, 'utf8'));
  assert.deepEqual(log.listings.map(l => [l.after, l.covers, l.ids.length]), [[3, 3, 11]]);
  assert.deepEqual(log.looks.map(l => l.held_out_ids.length), [11, 14, 11, 14]);
  // The whole half: some of its records were listed at look 3, so a claim on it spends nothing.
  assert.deepEqual([s.look.look, s.look.half.look, s.look.half.level, s.look.listed_at, s.target.why], [4, 4, 0, 3, 'listed']);
  // The newest records: at looks 2 and 4 only, never listed. Before the fix: look 3 of theirs, and nothing to spend.
  assert.deepEqual([s.batch.since, s.batch.records, s.batch.look, s.batch.level], [2, 3, 2, lookLevel(2)]);
  const text = flat(renderTerminal(scoreRun({ config: a.config, predPath: v2, keyPath: f('key-grown.json'), applySplit: true, heldOut: true, look: true, now: NOW, target: 40 })));
  assert.match(text, /NEWEST RECORDS 3 held-out records first shown at look 2 in the log; this is look 2 at them: a claim on them alone has its own 5%, and may use 1\.25% of it\./);
  assert.doesNotMatch(text, /they were listed/);
});

// ---------- 7. compare --after-key: the two keys' halves ----------

test('O26: compare --after-key stops when the keys put a record in different halves; --lenient sets it aside in both runs', () => {
  const a = withLog();
  // key-dup-moved.json marks S05 (held out) a duplicate of S01 (tuning): it would change half.
  const args = ['--config', a.file, '--key', f('key.json'), '--after-key', f('key-dup-moved.json'), '--before', f('predictions.json'), '--after', f('predictions.json'), '--held-out'];
  const strict = cli('compare', ...args);
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /\[O26\] 1 record\(s\) fall in one half under .* and in the other under .* \(their primary or cluster differs between the keys\)/);
  assert.deepEqual(named(strict.stderr, ['S05']), []);
  assert.equal(looks(a), 0);
  const json = path.join(a.dir, 'c.json');
  const lenient = cli('compare', ...args, '--lenient', '--json', json);
  assert.equal(lenient.status, 0, lenient.stderr);
  const c = JSON.parse(fs.readFileSync(json, 'utf8'));
  // 13 tuning + 10 held out + 1 set aside = 24 (before the fix: 13 + 10 = 23, S05 in neither and its outcome in the "after" tuning rate).
  assert.deepEqual([c.split.tuning.records, c.split.held_out.records, c.split.keys_apart], [13, 10, 1]);
  assert.match(flat(lenient.stdout), /1 record the two answer keys put in different halves is set aside, in neither half \(--lenient\)\./);
  assert.deepEqual(named(lenient.stdout + lenient.stderr, ['S05']), []);
  // The look recorded only the halves both keys agree on: a plain score afterwards does not stop (O10).
  const after = cli('score', '--config', a.file, '--pred', f('predictions.json'), '--key', f('key.json'), '--held-out');
  assert.equal(after.status, 0, after.stderr);
  assert.match(flat(after.stdout), /Look 2 at this held-out half \(counted in split-log\.json\)\. 1 of its records is new/);
});

// ---------- 8, 10, 15, 16. no record named, by where each id was written ----------

test('O6: check counts held-out records in its warnings, as score does', () => {
  const r = cli('check', '--config', f('config.json'), '--pred', f('predictions-dup-codes.json'), '--key', f('key.json'), '--lenient');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[D6\] .*predictions-dup-codes\.json: codes lists "C" more than once; kept once \(applied\) \(1 held-out record, not named\)/);
  assert.match(r.stdout, /\[D6\] .*predictions-dup-codes\.json S01: codes lists "A" more than once/);   // the tuning record is named
  assert.deepEqual(named(r.stdout, HELD), []);
  // Strict mode stops on them: counted there too, each stop on its own line, indented as always.
  const s = cli('check', '--config', f('config.json'), '--pred', f('predictions-dup-codes.json'), '--key', f('key.json'));
  assert.equal(s.status, 1);
  assert.deepEqual(named(s.stderr, HELD), []);
  assert.match(s.stderr, /\n {2}- \* \[D6\] [^\n]*predictions-dup-codes\.json: codes lists "C" more than once \(1 held-out record, not named\)\n/);
});

test('O6: numeric ids are taken out where they were written, and numbers elsewhere are never touched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-split-'));
  const config = JSON.parse(fs.readFileSync(f('config.json'), 'utf8'));
  const ids = Array.from({ length: 24 }, (_, i) => i + 1);
  const held = splitOf(ids.map(id => ({ id: String(id) })), loadConfig(f('config.json'))).held_out;
  assert.deepEqual(held, ['1', '3', '4', '7', '8', '9', '10', '11', '12', '13', '17', '18', '21', '22', '23']);
  const write = (name, x) => { fs.writeFileSync(path.join(dir, name), JSON.stringify(x)); return path.join(dir, name); };
  const cfg = write('config.json', config);
  const key = write('key.json', ids.map(id => ({ id, expected_route: 'AUTO', codes: ['A'], trap: 'plain' })));
  const pred = write('pred.json', ids.map(id => ({ id, route: 'AUTO', codes: ['A', 'A'] })));
  // Record 7 is held out: ruled on at rulings[7], and again at rulings[8] (a stop, I12). The 7 in
  // "rulings[7]" is a place in the file, not the record, and stays.
  const tuning = ids.map(String).filter(id => !held.includes(id));
  const before = tuning.slice(0, 7).map((id, i) => ({ id, output: 'codes', value: 'V' + i, ruling: 'pending', by: 'DH', on: '2026-11-01' }));
  const rulings = write('r.json', { rulings: [...before, { id: '7', output: 'codes', value: 'Z', ruling: 'add', by: 'DH', on: '2026-11-01' },
    { id: '7', output: 'codes', value: 'Z', ruling: 'reject', by: 'DH', on: '2026-11-01' }] });
  const r = cli('score', '--config', cfg, '--pred', pred, '--key', key, '--rulings', rulings);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\[I12\] [^\n]*r\.json rulings\[8\]: rules on codes Z again \(first at rulings\[7\]\)/);
  assert.doesNotMatch(r.stderr, /rules on 7 /);
  assert.match(r.stderr, /\(1 held-out record, not named: --show-held-out names it\)/);
  // A warning on every record (D6, lenient): the tuning records named, the held-out ones counted.
  const s = scoreRun({ config: loadConfig(cfg), predPath: pred, keyPath: key, mode: 'lenient', applySplit: true });
  const d6 = s.problems.filter(x => x.trap === 'D6');
  assert.deepEqual(d6.filter(x => x.where !== pred).map(x => x.where.slice(pred.length + 1)).sort(), [...tuning].sort());
  const counted = d6.filter(x => x.where === pred);
  assert.equal(counted.length, 1);
  assert.match(counted[0].message, /\(15 held-out records, not named: --show-held-out names them\)$/);
  // The answer key cannot be read: which half a record is in is not known, so no record is named (item 16).
  const nokey = cli('score', '--config', cfg, '--pred', pred, '--key', path.join(dir, 'missing.json'), '--rulings', rulings);
  assert.equal(nokey.status, 1);
  assert.match(nokey.stderr, /rules on codes Z again \(first at rulings\[7\]\)/);
  assert.match(nokey.stderr, /\(1 record not named: the answer key could not be read, so which half it is in is not known\)/);
  const nokeyRun = cli('score', '--config', cfg, '--pred', pred, '--key', path.join(dir, 'missing.json'));
  assert.equal(nokeyRun.status, 1);
  assert.doesNotMatch(nokeyRun.stderr, /pred\.json \d+:/);
  assert.match(nokeyRun.stderr, /\(24 records not named: the answer key could not be read, so which half each is in is not known\)/);
});

// ---------- 9. variance and compare keep the split's own warnings and the held-out rulings ----------

test('O3, O15, O18: variance and compare give the split\'s warnings and the held-out rulings counts, as score does', () => {
  // An empty held-out half (O15) warns in all three.
  const a = withLog(raw => ({ ...raw, split: { held_out: 0.005 } }));
  const base = ['--config', a.file, '--key', f('key.json')];
  for (const args of [['score', '--pred', f('predictions.json')], ['variance', f('predictions.json'), f('predictions-v2.json')],
    ['compare', '--before', f('predictions.json'), '--after', f('predictions-v2.json')]]) {
    assert.match(cli(...args, ...base).stdout, /\[O15\]/, args[0]);
  }
  // Retellings on both sides (O3: the metadata hand split, by id), in variance too, in the plural's words.
  const G = path.join(__dirname, '..', 'examples', 'metadata-enrichment', 'golden500');
  const run = n => path.join(G, 'exec-' + n + '.json');
  const v = varianceRun({ config: loadConfig(path.join(G, 'config-split.json')), keyPath: run(70), predPaths: [run(70), run(71)], applySplit: true });
  assert.ok(v.problems.some(x => x.trap === 'O3' && /13 duplicates in the other half from their primaries/.test(x.message)));
  // Rulings with suspects' verbs on held-out records: counted in all three, before and after a look.
  const config = loadConfig(path.join(SUS, 'config-split.json'));
  const { loadRulings } = require('../src/rulings.js');
  const rulings = loadRulings(f('rulings-held-verbs.json'), config, 'lenient');
  const runs = [path.join(SUS, 'run-a.json'), path.join(SUS, 'run-b.json')];
  const want = { added: 0, rejected: 0, pending: 1, set_aside: 0, removed: 1, kept: 1, replaced: 1 };
  for (const heldOut of [false, true]) {
    const sc = scoreRun({ config, predPath: runs[0], keyPath: path.join(SUS, 'key.json'), rulings, mode: 'lenient', applySplit: true, heldOut });
    const va = varianceRun({ config, keyPath: path.join(SUS, 'key.json'), predPaths: runs, rulings, mode: 'lenient', applySplit: true, heldOut });
    const co = compareRun({ config, keyPath: path.join(SUS, 'key.json'), beforePath: runs[0], afterPath: runs[1], rulings, mode: 'lenient', applySplit: true, heldOut });
    for (const r of [sc, va, co]) assert.deepEqual(r.split.rulings.held_out, want);
  }
  // A ruling on a record in neither half (not in the key) stays "set aside", as without a split.
  const unknown = loadRulings(f('rulings-unknown.json'), config, 'lenient');
  const sc = scoreRun({ config, predPath: runs[0], keyPath: path.join(SUS, 'key.json'), rulings: unknown, mode: 'lenient', applySplit: true });
  assert.equal(sc.rulings.set_aside.length, 1);
  assert.match(flat(cli('variance', '--config', path.join(SUS, 'config-split.json'), '--key', path.join(SUS, 'key.json'), ...runs, '--rulings', f('rulings-unknown.json'), '--lenient').stdout),
    /Also in the file: .*1 set aside \(see the warnings\)/);
});

// ---------- 2, 4, 5, 6, 14. wording ----------

test('wording: plain claims, the house words, the key not checked, --show-held-out\'s header, check\'s columns', () => {
  const a = withLog();
  const r = scoreRun({ config: a.config, predPath: f('predictions-v2.json'), keyPath: f('key.json'), applySplit: true, heldOut: true, look: true, now: NOW, target: 40 });
  const text = renderTerminal(r);
  // 14: the claim in plain words.
  assert.match(flat(text), /Not yet shown under 40%: with these records the true rate could still be as high as 44\.5%\. Each look at the held-out half must pass a stricter test than the one before; this is look 1, which may use 2\.5% of the 5% allowed for being wrong\./);
  assert.doesNotMatch(text, /at this look's share|went out unseen/);
  // 4: once, in the held-out section.
  assert.equal(text.split('Its answer key has not been checked by suspects').length - 1, 1);
  // 5: with --show-held-out the header and the split line say the records are listed.
  const shown = renderTerminal(scoreRun({ config: a.config, predPath: f('predictions-v2.json'), keyPath: f('key.json'), applySplit: true, showHeldOut: true, look: true, now: NOW }));
  assert.match(flat(shown), /HELD-OUT HALF 11 records kept out of tuning: rates here; every record is listed under HELD-OUT HALF IN FULL \(--show-held-out\)/);
  assert.match(flat(shown), /which of its records failed is listed too \(--show-held-out\)/);
  assert.deepEqual(shown.split('\n').filter(l => /^(SPLIT|HELD-OUT HALF {2})/.test(l) && l.length > 100), []);
  assert.doesNotMatch(shown, /never which records/);
  // 6: used up, and the rate above the target too, say both.
  const used = claimLines({ target_pct: 5, level: 0.000156, shown: false, bound_pct: 15.9, why: 'used_up', tested: 105, records_needed: 5530, rate_at_or_above: true }, null, 5);
  assert.match(used.join(' '), /Used up for a 5% target: .* The rate itself is at or above the target, too\./);
  // 6: the date a look is repeated from, as the reader's calendar has it (the log keeps UTC).
  const iso = '2026-11-02T03:30:00.000Z';
  const repeat = lookLines({ counted: true, look: 1, log: 'split-log.json', repeat: { look: 1, date: iso }, half: { look: 1, level: 0.025 }, listed_at: null, fresh: 0 })[0];
  assert.match(repeat, new RegExp('as on ' + localDate(iso) + ','));
  const d = new Date(iso);
  if (d.getDate() !== d.getUTCDate()) assert.doesNotMatch(repeat, /as on 2026-11-02,/);
  // 6: check's balance lines keep a space after a long dimension name.
  const g = withLog(raw => ({ ...raw, groups: { channel: { field: 'trap', from: 'key' } } }));
  assert.match(cli('check', '--config', g.file, '--pred', f('predictions.json'), '--key', f('key.json')).stdout, /\n {2}group channel lookalike 2\/4/);
  // 11: --help names --held-out and --show-held-out for score, compare, variance and whatif.
  const help = cli('--help').stdout;
  for (const cmd of ['score', 'variance', 'compare', 'whatif']) {
    const block = help.split(/\n {2}(?=[a-z]+ {2,})/).find(b => b.startsWith(cmd + ' ') && !b.includes('--grades'));
    assert.match(block, /\[--held-out\] \[--show-held-out\]/, cmd);
  }
});
