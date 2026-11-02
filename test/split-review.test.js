// The tuning half and the held-out half: the cases an independent review found (traps O1-O20).
// Each was a test that failed on the code before its fix. Numbers worked by hand are in
// test/fixtures/split/EXPECTED.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { loadConfig, addClusterBy } = require('../src/config.js');
const { scoreRun, compareRun, varianceRun } = require('../src/score.js');
const { renderTerminal } = require('../src/report/terminal.js');
const { renderHtml } = require('../src/report/html.js');
const { resultsJson } = require('../src/report/json.js');

const F = path.join(__dirname, 'fixtures', 'split');
const f = name => path.join(F, name);
const CLI = path.join(__dirname, '..', 'bin', 'wfeval.js');
const HELD = ['S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S13', 'S21'];
const NOW = new Date('2026-11-01T12:00:00.000Z');
const named = (text, ids) => ids.filter(id => new RegExp('\\b' + id + '\\b').test(text));

// A copy of a fixture config in a fresh folder, with split.log beside it; change edits the raw config.
function withLog(change = raw => raw, name = 'config.json') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-split-'));
  const raw = JSON.parse(fs.readFileSync(f(name), 'utf8'));
  raw.split = { ...raw.split, log: 'split-log.json' };
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify(change(raw), null, 2));
  return { dir, file, config: loadConfig(file), log: path.join(dir, 'split-log.json') };
}
const score = (config, pred, opts = {}) => scoreRun({ config, predPath: f(pred), keyPath: f(opts.key || 'key.json'), applySplit: true, heldOut: true, look: true, now: NOW, ...opts, key: undefined });
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

// ---------- 1. a split reaches only the callers that ask for it ----------

test('O1: monitor scores every record whether or not the config has a split', () => {
  const { monitorRun } = require('../src/monitor.js');
  const { renderMonitor } = require('../src/report/monitor.js');
  const M = path.join(__dirname, 'fixtures', 'monitor');
  const config = loadConfig(path.join(M, 'config.json'));
  const runPaths = ['2026-W40', '2026-W41', '2026-W42'].map(w => path.join(M, 'runs', w + '.json'));
  const without = monitorRun({ config, runPaths, target: 5 });
  const withSplit = monitorRun({ config: { ...config, split: { held_out: 0.5, salt: '', hash: 'sha256', by: 'cluster', log: null } }, runPaths, target: 5 });
  // The same numbers; monitor's own note on the split (L34) is the only difference.
  const lines = r => renderMonitor(r).split('\n').filter(l => !l.includes('[L34]') && !/^NOTES \(\d+\)$/.test(l));
  assert.deepEqual(lines(withSplit), lines(without));
  assert.deepEqual(withSplit.periods.map(x => x.rate.d), [4, 3, 5]);
  assert.deepEqual(without.periods.map(x => x.rate.d), [4, 3, 5]);
});

test('O1: scoreRun applies a split only when its caller asks (applySplit)', () => {
  const config = loadConfig(f('config.json'));
  const plain = scoreRun({ config, predPath: f('predictions.json'), keyPath: f('key.json') });
  assert.equal(plain.routing.total, 24);
  assert.ok(!('split' in plain));
  const split = scoreRun({ config, predPath: f('predictions.json'), keyPath: f('key.json'), applySplit: true, heldOut: true });
  assert.equal(split.routing.total, 13);
});

// ---------- 2. a look's identity covers everything that changes the held-out numbers ----------

test('O8: an edited config, or another mode, is a new look', () => {
  const a = withLog();
  const first = score(a.config, 'predictions-v2.json', { target: 40 }).split;
  assert.deepEqual([first.look.look, first.held_out.silent_errors.n], [1, 1]);
  // The same files, with C and D read as one value: S05's D is now right, so the held-out numbers change.
  fs.writeFileSync(a.file, JSON.stringify({ ...JSON.parse(fs.readFileSync(a.file, 'utf8')), equivalents: { codes: [['C', 'D']] } }));
  const eq = score(loadConfig(a.file), 'predictions-v2.json', { target: 40 }).split;
  assert.deepEqual([eq.look.look, eq.look.repeat, eq.held_out.silent_errors.n], [2, null, 0]);
  assert.equal(eq.target.level, 0.0125);
  const lenient = score(loadConfig(a.file), 'predictions-v2.json', { target: 40, mode: 'lenient' }).split;
  assert.deepEqual([lenient.look.look, lenient.look.repeat], [3, null]);
});

// ---------- 3. settings that decide the halves ----------

test('O4: --cluster-by is refused when the split follows clusters the config does not name', () => {
  const r = cli('score', '--config', f('config.json'), '--pred', f('predictions.json'), '--key', f('key-story.json'), '--cluster-by', 'story');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--cluster-by.*split follows clusters/);
  assert.deepEqual(named(r.stdout + r.stderr, HELD), []);
  // With split.by "id", clusters do not move records between the halves: allowed.
  assert.doesNotThrow(() => addClusterBy({ ...loadConfig(f('config.json')), split: { held_out: 0.5, salt: '', hash: 'sha256', by: 'id', log: null } }, 'story'));
});

test('O9: a log stops when a setting that decides the halves changed (duplicate_of_field)', () => {
  const a = withLog();
  score(a.config, 'predictions.json');
  const { duplicate_of_field, ...noDup } = JSON.parse(fs.readFileSync(a.file, 'utf8'));
  fs.writeFileSync(a.file, JSON.stringify(noDup));
  assert.throws(() => score(loadConfig(a.file), 'predictions.json', { key: 'key-moved.json' }), /\[O9\]/);
});

test('O10: a record that left the held-out half stops too', () => {
  const a = withLog();
  score(a.config, 'predictions.json', { key: 'key-moved.json' });   // S20 by its own id: held out
  assert.throws(() => score(a.config, 'predictions.json'), /\[O10\].*1 record\(s\).*tuning half/);
});

// ---------- 4. build gates and the HTML report ----------

test('O19: score --fail-on critical counts held-out safeguard failures, by number only', () => {
  const G = path.join(__dirname, 'fixtures', 'gate');
  const plain = cli('score', '--config', path.join(G, 'config.json'), '--pred', f('gate-sg.json'), '--key', path.join(G, 'key.json'), '--quiet', '--fail-on', 'critical');
  assert.equal(plain.status, 3);
  const r = cli('score', '--config', f('gate.json'), '--pred', f('gate-sg.json'), '--key', path.join(G, 'key.json'), '--quiet', '--fail-on', 'critical', '--held-out');
  assert.equal(r.status, 3);
  assert.match(r.stderr, /1 held-out record\(s\) \(safeguard\)/);
  assert.doesNotMatch(r.stderr, /G27/);
});

test('O6: the HTML report shows the held-out half as the terminal does, below the split line', () => {
  const a = withLog();
  for (const p of ['predictions.json', 'predictions-v2.json', 'predictions-v3.json', 'predictions-v4.json']) score(a.config, p, { target: 40 });
  const r = score(a.config, 'predictions-grown.json', { key: 'key-grown.json', target: 40 });
  const html = renderHtml(r, '2026-11-01T00:00:00.000Z');
  for (const want of [/Safeguard failures/, /newest records/i, /no record of trap/, /Target \(tuning half\)/]) assert.match(html, want);
  // With a held-out silent error, its count by severity, as in the terminal.
  assert.match(renderHtml(score(a.config, 'predictions-v2.json', { target: 40 }), '2026-11-01T00:00:00.000Z'), /Silent errors by severity: high 1/);
  assert.ok(html.indexOf('The tuning half') > 0 && html.indexOf('The tuning half') < html.indexOf('class="hero-value"'), 'the split line comes before the headline');
  assert.match(renderTerminal(r), /TARGET \(tuning half\)/);
  assert.deepEqual(named(html, HELD), []);
});

// ---------- 5. a pending ruling on a held-out record ----------

test('O18: a pending ruling on a held-out record is counted, never named, and crashes nothing', () => {
  const { loadRulings } = require('../src/rulings.js');
  const config = loadConfig(f('config.json'));
  const rulings = loadRulings(f('rulings-pending.json'), config);
  const r = scoreRun({ config, predPath: f('predictions-v2.json'), keyPath: f('key.json'), rulings, applySplit: true, heldOut: true });
  assert.equal(r.rulings.if_pending_added.pending, 1);   // S02's, in the tuning half
  assert.equal(r.split.rulings.held_out.pending, 1);     // S05's, counted
  assert.deepEqual(named(JSON.stringify(resultsJson(r)) + renderTerminal(r), ['S05']), []);
  assert.doesNotThrow(() => compareRun({ config, keyPath: f('key.json'), beforePath: f('predictions.json'), afterPath: f('predictions-v2.json'), rulings, applySplit: true, heldOut: true }));
  assert.doesNotThrow(() => varianceRun({ config, keyPath: f('key.json'), predPaths: [f('predictions.json'), f('predictions-v2.json')], rulings, applySplit: true, heldOut: true }));
});

// ---------- 6. compare --fail-if-worse with an empty held-out half ----------

test('O19: compare --fail-if-worse skips what the held-out half does not measure, with a note', () => {
  const a = withLog(raw => ({ ...raw, split: { held_out: 0.005 } }));
  // Every record is in the tuning half, where the change breaks 6: worse there (exit 3), not a stop (exit 1).
  const r = cli('compare', '--config', a.file, '--key', f('key.json'), '--before', f('predictions.json'), '--after', f('predictions-bad.json'), '--fail-if-worse', 'silent-errors', '--held-out');
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /held-out half does not measure silent-errors.*checked on the tuning half only/);
  assert.match(r.stderr, /silent-errors \(fixed 0, broke 6\)/);
});

// ---------- 7. --lenient never launders a moved record ----------

test('O10: in lenient mode a moved record is set aside, never written as held out, never fresh', () => {
  const a = withLog();
  score(a.config, 'predictions.json');
  const r = score(a.config, 'predictions.json', { key: 'key-moved.json', mode: 'lenient' }).split;
  assert.equal(r.held_out.records, 11);   // S20 set aside: in neither half
  assert.equal(r.look.fresh, 0);
  const log = JSON.parse(fs.readFileSync(a.log, 'utf8'));
  assert.ok(!('S20' in log.records.held_out));
  assert.ok('S20' in log.moved);
  // Once moved, it stops a strict run whatever half it is in.
  assert.throws(() => score(a.config, 'predictions.json', { key: 'key-moved.json' }), /\[O10\]/);
  assert.throws(() => score(a.config, 'predictions-v3.json'), /\[O10\]/);
});

// ---------- 8. runs at the same time ----------

test('O17: ten runs at once record ten looks', async () => {
  const a = withLog();
  // Ten different versions (a tuning record's codes differ), so each run is a look of its own.
  const v1 = JSON.parse(fs.readFileSync(f('predictions.json'), 'utf8'));
  const preds = Array.from({ length: 10 }, (_, i) => {
    const file = path.join(a.dir, 'p' + i + '.json');
    fs.writeFileSync(file, JSON.stringify(v1.map(r => (r.id === 'S01' ? { ...r, codes: ['A', 'X' + i] } : r))));
    return file;
  });
  const codes = await Promise.all(preds.map(p => new Promise(resolve => {
    const c = spawn(process.execPath, [CLI, 'score', '--config', a.file, '--pred', p, '--key', f('key.json'), '--quiet', '--lenient', '--held-out', '--json', p + '.out.json']);
    c.on('close', code => resolve(code));
  })));
  assert.deepEqual(codes, preds.map(() => 0));
  const log = JSON.parse(fs.readFileSync(a.log, 'utf8'));
  assert.deepEqual(log.looks.map(l => l.look), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const looks = preds.map(p => JSON.parse(fs.readFileSync(p + '.out.json', 'utf8')).split.look.look).sort((x, y) => x - y);
  assert.deepEqual(looks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(!fs.existsSync(a.log + '.lock'));
});

test('O17: a run that cannot take the lock stops, saying so, and records nothing', () => {
  const a = withLog();
  fs.writeFileSync(a.log + '.lock', '');
  const r = spawnSync(process.execPath, [CLI, 'score', '--config', a.file, '--pred', f('predictions.json'), '--key', f('key.json'), '--quiet', '--held-out'],
    { encoding: 'utf8', env: { ...process.env, WFEVAL_LOCK_WAIT_MS: '300' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\[O17\].*locked/);
  assert.ok(!fs.existsSync(a.log));
});

// ---------- 9. whatif says "disagrees" only when the held-out half does ----------

test('O16: whatif says "disagrees" only when the held-out rate is at or above the target', () => {
  const { heldOutWhatif } = require('../src/split-whatif.js');
  const { heldOutWhatifSection } = require('../src/report/split.js');
  const GATE = path.join(__dirname, 'fixtures', 'gate');
  const a = withLog(raw => raw, 'gate.json');
  const { split } = scoreRun({ config: a.config, predPath: path.join(GATE, 'predictions.json'), keyPath: path.join(GATE, 'key.json'), applySplit: true, heldOut: true });
  // tuning: the gate's rate on the tuning half, as certified there (1 of 18 in this fixture).
  const { rate } = require('../src/metrics/stats.js');
  const at = (target, tuning = rate(1, 18)) => {
    const w = { kind: 'gate', outputs: ['TOPIC'], certification: { target_pct: target, best: { threshold: 0.75, silent_error_rate: tuning } } };
    w.split = heldOutWhatif(w, { split, config: a.config, kind: 'gate', heldOut: true, look: true, now: NOW, files: { predictions: path.join(GATE, 'predictions.json') }, options: { target } });
    return heldOutWhatifSection(w).replace(/\s+/g, ' ');
  };
  // 2 of 12 held out, 16.7% (likely 4.7-44.8%): under 40%, but 12 records with 2 silent errors cannot
  // show it at a first look. Not "too few": 12 with none would (0.6^12 is under 2.5%).
  const forty = at(40);
  assert.match(forty, /Not confirmed at this look: on the held-out half it ran at 16\.7% \(2 of 12\), under the target, but these records cannot show it yet/);
  assert.doesNotMatch(forty, /disagrees|choose again|too few|flattered/i);
  assert.match(at(15), /held-out half disagrees/);   // 16.7% is at or above 15%
  // Certified at 0 of 18 on the tuning half, below the held-out half's whole likely range: the tuning
  // half flattered it, whatever 12 records can show.
  assert.match(at(40, rate(0, 18)), /Not confirmed: on the held-out half it ran at 16\.7% \(2 of 12\), against 0\.0% \(0 of 18\) on the tuning half, below the held-out half's whole likely range: the tuning half flattered it\./);
});

// ---------- 10. the likely range and the claim ----------

test('O7: at a first look, too few records is "too few", not "used up", and the exact bound is shown', () => {
  const a = withLog();
  const r = score(a.config, 'predictions.json', { target: 28 });
  assert.equal(r.split.target.why, 'too_few');
  assert.equal(r.split.target.bound_pct, 30.8);   // 1 - 0.025^(1/10)
  const text = renderTerminal(r);
  assert.match(text, /too few/i);
  assert.doesNotMatch(text, /used up/i);
  assert.match(text, /30\.8%/);
  assert.doesNotMatch(text, /p = /);
});

// ---------- 11. held-out ids in warnings and stops ----------

test('O6: no warning or stop names a held-out record without --show-held-out', () => {
  const GATE = path.join(__dirname, 'fixtures', 'gate');
  const held = ['G01', 'G02', 'G04', 'G05', 'G10', 'G11', 'G13', 'G15', 'G19', 'G24', 'G26', 'G27', 'G31', 'G32', 'G33', 'G38', 'G40', 'G42', 'G45', 'G49', 'G50', 'G53', 'G54', 'G56', 'G57', 'G58', 'G59'];
  const runs = [
    ['score', '--config', f('config.json'), '--pred', f('predictions-space.json'), '--key', f('key.json'), '--lenient'],
    ['score', '--config', f('config.json'), '--pred', f('predictions-space.json'), '--key', f('key.json')],
    ['compare', '--config', f('config.json'), '--key', f('key.json'), '--before', f('predictions.json'), '--after', f('predictions-space.json'), '--lenient'],
    ['variance', '--config', f('config.json'), '--key', f('key.json'), f('predictions.json'), f('predictions-space.json'), '--lenient'],
  ];
  for (const args of runs) {
    const r = cli(...args);
    assert.deepEqual(named(r.stdout + r.stderr, HELD), [], args.join(' '));
    // score reports the warnings, or the stop, counting the held-out record instead of naming it.
    if (args[0] === 'score') assert.match(r.stdout + r.stderr, /1 held-out record, not named/, args.join(' '));
  }
  for (const mode of [[], ['--lenient']]) {
    const r = cli('whatif', '--config', f('gate.json'), '--pred', f('gate-desk.json'), '--key', path.join(GATE, 'key.json'), '--policies', f('policies-desk.json'), ...mode);
    assert.deepEqual(named(r.stdout + r.stderr, held), [], 'whatif ' + mode.join(' '));
    assert.match(r.stdout + r.stderr, /G03/);   // the tuning record is still named
  }
  // With --show-held-out, they are named.
  assert.match(cli('score', '--config', f('config.json'), '--pred', f('predictions-space.json'), '--key', f('key.json'), '--lenient', '--show-held-out').stdout, /S05/);
});

test('O6: a rulings file\'s stops count held-out records too, and records that changed half', () => {
  const { loadRulings } = require('../src/rulings.js');
  const a = withLog(raw => ({ ...raw, allowed_values: { codes: ['A', 'B', 'C'] } }));
  let files = 0;   // named by number: a file named after the record would name it in every stop
  const ruling = (id, extra = []) => {
    const file = path.join(a.dir, 'rulings-' + (++files) + '.json');
    const one = { id, output: 'codes', value: 'Z', ruling: 'add', by: 'DH', on: '2026-10-31' };
    fs.writeFileSync(file, JSON.stringify({ rulings: [one, ...extra] }));
    return file;
  };
  const stopOf = fn => { try { fn(); } catch (e) { return e.message; } assert.fail('expected a stop'); };
  // An add outside allowed_values on a held-out record stops the run (I13): counted, not named.
  const s05 = stopOf(() => score(a.config, 'predictions.json', { rulings: loadRulings(ruling('S05'), a.config) }));
  assert.match(s05, /\[I13\]/);
  assert.deepEqual(named(s05, ['S05']), []);
  assert.match(s05, /1 held-out record, not named/);
  // S20 held out at the first look (its own id), in the tuning half now: the log check stops the run
  // (O10), and the rulings stop reported with it does not say which record that was.
  score(a.config, 'predictions.json', { key: 'key-moved.json' });
  const s20 = stopOf(() => score(a.config, 'predictions.json', { rulings: loadRulings(ruling('S20'), a.config) }));
  assert.match(s20, /\[O10\]/);
  assert.match(s20, /\[I13\]/);
  assert.deepEqual(named(s20, ['S20']), []);
  // A rulings file that stops as it is read (I12: one value ruled on twice) is counted the same way.
  const twice = ruling('S05', [{ id: 'S05', output: 'codes', value: 'Z', ruling: 'reject', by: 'DH', on: '2026-10-31' }]);
  for (const cmd of [['score', '--pred', f('predictions.json')], ['variance', f('predictions.json'), f('predictions-v2.json')],
    ['compare', '--before', f('predictions.json'), '--after', f('predictions-v2.json')]]) {
    const r = cli(...cmd, '--config', a.file, '--key', f('key.json'), '--rulings', twice);
    assert.match(r.stderr, /\[I12\]/, cmd[0]);
    assert.deepEqual(named(r.stdout + r.stderr, ['S05']), [], cmd[0]);
    assert.match(r.stderr, /1 held-out record, not named/, cmd[0]);
  }
  // --show-held-out names it.
  assert.match(cli('score', '--pred', f('predictions.json'), '--config', a.file, '--key', f('key.json'), '--rulings', twice, '--show-held-out').stderr, /S05/);
});

// ---------- 12. warnings that read one half ----------

test('O20: failed model calls are counted in both halves; min_per_trap reads the answer key', () => {
  const G = path.join(__dirname, '..', 'examples', 'metadata-enrichment', 'golden500');
  const run = n => path.join(G, 'exec-' + n + '.json');
  const plain = varianceRun({ config: loadConfig(path.join(G, 'config.json')), keyPath: run(70), predPaths: [70, 71, 72].map(run) });
  const split = varianceRun({ config: loadConfig(path.join(G, 'config-split.json')), keyPath: run(70), predPaths: [70, 71, 72].map(run), applySplit: true, heldOut: true });
  const i6 = v => v.problems.filter(x => x.trap === 'I6').map(x => [path.basename(x.where), x.message.match(/^\d+/)[0]]);
  assert.deepEqual(i6(split), i6(plain));
  const c = loadConfig(f('config.json'));
  const r = scoreRun({ config: { ...c, min_per_trap: 3 }, predPath: f('predictions.json'), keyPath: f('key.json'), applySplit: true, heldOut: true, mode: 'lenient' });
  assert.deepEqual(r.problems.filter(x => x.trap === 'H5').map(x => x.message.split(';')[0]),
    ['trap "near-duplicate" has 1 record(s) in the answer key (1 in the tuning half)', 'trap "stub" has 2 record(s) in the answer key (1 in the tuning half)']);
});

// ---------- 13. no log, no claim ----------

test('O12: without split.log, the held-out rates are shown and no claim is made', () => {
  const r = scoreRun({ config: loadConfig(f('config.json')), predPath: f('predictions.json'), keyPath: f('key.json'), target: 40, applySplit: true, heldOut: true, look: true });
  assert.equal(r.split.target.why, 'not_counted');
  assert.ok(!r.split.target.shown);
  assert.match(renderTerminal(r), /no claim is made/);
});

// ---------- 15. the log itself ----------

test('O11: a log whose records are not lists by id stops; a missing log says a new one was started', () => {
  const a = withLog();
  const r = score(a.config, 'predictions.json', { target: 40 });
  assert.match(renderTerminal(r), /no log file was found at split-log\.json/);
  assert.equal(JSON.parse(JSON.stringify(resultsJson(r))).split.look.log, 'split-log.json');
  const log = JSON.parse(fs.readFileSync(a.log, 'utf8'));
  fs.writeFileSync(a.log, JSON.stringify({ ...log, records: { held_out: [], tuning: [] } }));
  assert.throws(() => score(a.config, 'predictions-v2.json'), /\[O11\]/);
});

// ---------- 16. wording ----------

test('wording: shares, plurals, 100 columns, no p-values, no jargon', () => {
  const a = withLog(raw => ({ ...raw, split: { held_out: 0.07, log: 'split-log.json' } }));
  const r = score(a.config, 'predictions.json', { target: 40 });
  const text = renderTerminal(r);
  assert.match(text, /7% held out/);
  assert.doesNotMatch(text, /000000/);
  assert.match(text, /The other record is held out/);
  // Sentences fit 100 columns; the held-out table's rows have the HEADLINE table's words, as wide as its rows.
  const blocks = text.split('\n\n').filter(b => /^(SPLIT|HELD-OUT)/.test(b)).join('\n');
  const tableRow = l => /^ {2}(Silent error rate|Straight-through|Silent omissions|Review precision|Block precision|Safeguard failures) /.test(l);
  assert.deepEqual(blocks.split('\n').filter(l => l.length > 100 && !tableRow(l)), []);
  // The house wording in the held-out table (trap O6's report, item 14).
  assert.match(blocks, /Silent error rate .* went out without review, but needed a person/);
  assert.doesNotMatch(text, /went out unseen/);
  assert.doesNotMatch(text, /monitor|the log records it/);
  const help = cli('--help').stdout;
  assert.deepEqual(help.split('\n').filter(l => /split|held-out/.test(l) && l.length > 100), []);
});

test('O3: split by id, a primary\'s error type does not reveal its held-out duplicate\'s route', () => {
  const config = { ...loadConfig(f('config.json')), split: { held_out: 0.5, salt: '', hash: 'sha256', by: 'id', log: null } };
  const type = pred => scoreRun({ config, predPath: f(pred), keyPath: f('key.json'), applySplit: true, heldOut: true, mode: 'lenient' }).routing.silent_omissions.records.find(x => x.id === 'S01').types;
  assert.deepEqual(type('predictions-dupA.json'), type('predictions-dupB.json'));
});
