// The tuning half and the held-out half (config.split): traps O1-O16. Every number below is worked
// out by hand in test/fixtures/split/EXPECTED.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { loadConfig, validateConfig } = require('../src/config.js');
const { scoreRun, compareRun, varianceRun } = require('../src/score.js');
const { crc32, sha256Point, unitsOf, splitOf, heldOut, balanceOf } = require('../src/split.js');
const { lookLevel } = require('../src/split-log.js');
const { renderTerminal, renderCompare, renderVariance } = require('../src/report/terminal.js');
const { renderHtml } = require('../src/report/html.js');
const { resultsJson } = require('../src/report/json.js');

const F = path.join(__dirname, 'fixtures', 'split');
const f = name => path.join(F, name);
const GATE = path.join(__dirname, 'fixtures', 'gate');
const CLI = path.join(__dirname, '..', 'bin', 'wfeval.js');
const HELD = ['S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S13', 'S21'];
const TUNING = ['S01', 'S02', 'S12', 'S14', 'S15', 'S16', 'S17', 'S18', 'S19', 'S20', 'S22', 'S23', 'S24'];
const NOW = new Date('2026-11-01T12:00:00.000Z');

// A copy of a fixture config in a fresh folder, with split.log beside it (the log is written there).
function withLog(name = 'config.json', change = s => s) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-split-'));
  const raw = JSON.parse(fs.readFileSync(f(name), 'utf8'));
  raw.split = change({ ...raw.split, log: 'split-log.json' });
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));
  return { dir, file, config: loadConfig(file), log: path.join(dir, 'split-log.json') };
}
const score = (config, pred, opts = {}) => scoreRun({ config, predPath: f(pred), keyPath: f(opts.key || 'key.json'), applySplit: true, heldOut: true, look: true, now: NOW, ...opts, key: undefined });
const noIds = (text, ids) => ids.filter(id => new RegExp('\\b' + id + '\\b').test(text));

// ---------- the hash and the units ----------

test('O2: CRC-32 as zlib computes it, and sha256 points as hashlib computes them', () => {
  assert.equal(crc32('123456789'), 0xcbf43926);
  // First 4 bytes of SHA-256, as a number from 0 to 1 (EXPECTED.md, checked with Python's hashlib).
  assert.equal(sha256Point('S01', '').toFixed(4), '0.6736');
  assert.equal(sha256Point('S03', '').toFixed(4), '0.1308');
  assert.equal(sha256Point('S20', '').toFixed(4), '0.4942');
});

test('O1: halves by a hash of each record\'s unit; a duplicate goes with its primary', () => {
  const config = loadConfig(f('config.json'));
  const { paired } = scoreRun({ config, predPath: f('predictions.json'), keyPath: f('key.json') });
  const halves = splitOf(paired, config);
  assert.deepEqual(halves.held_out, HELD);
  assert.deepEqual(halves.tuning, TUNING);
  // S20 is a duplicate of S01: its own id would be held out (0.4942), its primary's is not (0.6736).
  assert.equal(unitsOf(paired, config).get('S20'), 'S01');
  assert.deepEqual(halves.straddling, { clusters: 0, duplicates: 0 });
  // For another command (suspects): one record at a time.
  const byId = new Map(paired.map(r => [r.id, r]));
  assert.equal(heldOut(byId.get('S20'), config, paired), false);
  assert.equal(heldOut(byId.get('S21'), config, paired), true);
  assert.equal(heldOut(byId.get('S21'), { ...config, split: undefined }, paired), false);
});

test('O3: split by id, the duplicate pair straddles the halves, and the report says so', () => {
  const { config } = withLog('config.json', s => ({ ...s, by: 'id' }));
  const r = score(config, 'predictions.json');
  assert.deepEqual(r.split.straddling, { clusters: 0, duplicates: 1 });
  assert.equal(r.split.held_out.records, 12);   // S20 joins the held-out half
  const w = r.problems.find(i => i.trap === 'O3');
  assert.ok(w && w.level === 'warn' && /1 duplicate/.test(w.message), JSON.stringify(r.problems));
});

// ---------- the config ----------

test('O2, O4: the config refuses a salted or partial CRC-32, clusters from the predictions, and bad values', () => {
  const base = JSON.parse(fs.readFileSync(f('config.json'), 'utf8'));
  const errs = split => validateConfig({ ...base, split }).errors.join('\n');
  assert.match(errs({ hash: 'crc32', salt: 'x' }), /salt does not go with "crc32".*only swap the two halves/);
  assert.match(errs({ hash: 'crc32', held_out: 0.3 }), /odd checksums, half the records/);
  assert.match(errs({ held_out: 1 }), /split.held_out must be a share above 0 and below 1/);
  assert.match(errs({ held_out: 0.5, sheld: 1 }), /unknown key "split.sheld"/);
  assert.match(errs({ by: 'story' }), /split.by must be "cluster" or "id"/);
  assert.match(validateConfig({ ...base, clusters: { field: 'story', from: 'predictions' }, split: {} }).errors.join('\n'), /clusters.from is "predictions"/);
  assert.equal(validateConfig({ ...base, clusters: { field: 'story', from: 'predictions' }, split: { by: 'id' } }).errors.length, 0);
  const ok = validateConfig({ ...base, split: {} }).config.split;
  assert.deepEqual(ok, { held_out: 0.5, salt: '', hash: 'sha256', by: 'cluster', log: null });
  // Without a split, the config is the same object as before: no split key at all.
  assert.ok(!('split' in validateConfig({ ...base, split: undefined }).config));
});

// ---------- score ----------

test('O1, O6: score reports the tuning half in full, the held-out half as rates only', () => {
  const config = loadConfig(f('config.json'));
  const r = scoreRun({ config, predPath: f('predictions.json'), keyPath: f('key.json'), target: 40, applySplit: true, heldOut: true });
  // The tuning half, in full.
  assert.equal(r.routing.total, 13);
  assert.deepEqual([r.routing.silent_errors.rate.n, r.routing.silent_errors.rate.d], [2, 9]);
  assert.deepEqual(r.routing.silent_errors.records.map(x => x.id), ['S02', 'S15']);
  assert.deepEqual([r.routing.straight_through.n, r.routing.straight_through.d], [9, 13]);
  assert.deepEqual([r.routing.review_queue.precision.n, r.routing.review_queue.precision.d], [2, 3]);
  assert.deepEqual(r.routing.review_queue.wasted, ['S16']);
  assert.deepEqual(r.records.map(x => x.id), TUNING);
  // The held-out half: rates and ranges, no ids.
  const h = r.split.held_out;
  assert.equal(h.records, 11);
  assert.deepEqual([h.silent_errors.n, h.silent_errors.d, h.silent_errors.pct, h.silent_errors.low_pct, h.silent_errors.high_pct], [0, 10, 0, 0, 27.8]);
  assert.deepEqual([h.straight_through.n, h.straight_through.d], [10, 11]);
  assert.deepEqual([h.review_precision.n, h.review_precision.d], [0, 1]);
  assert.deepEqual([h.silent_omissions.n, h.silent_omissions.d], [0, 11]);
  // No log: looks are not counted, so no claim is made, and the report says so once (O12).
  assert.equal(r.split.look.counted, false);
  assert.deepEqual([r.split.target.why, r.split.target.shown], ['not_counted', false]);
  // No held-out id anywhere a default report reaches: terminal, JSON, HTML.
  const text = renderTerminal(r);
  assert.deepEqual(noIds(text, HELD), []);
  assert.deepEqual(noIds(JSON.stringify(resultsJson(r)), HELD), []);
  assert.deepEqual(noIds(renderHtml(r, '2026-11-01T00:00:00.000Z'), HELD), []);
  assert.match(text, /HELD-OUT HALF/);
  assert.match(text, /not counted/);
  assert.equal((text.match(/not counted/g) || []).length, 1);
});

test('O6: a held-out silent error stays hidden; --show-held-out lists it, and the look records that', () => {
  const { config, log } = withLog();
  const r = score(config, 'predictions-v2.json');
  assert.deepEqual(noIds(renderTerminal(r) + JSON.stringify(resultsJson(r)), HELD), []);
  assert.deepEqual(r.split.held_out.silent_errors.by_severity, { critical: 0, high: 1, medium: 0, low: 0 });
  const shown = score(config, 'predictions-v2.json', { showHeldOut: true });
  assert.deepEqual(shown.split.held_out_report.routing.silent_errors.records.map(x => x.id), ['S05']);
  assert.match(renderTerminal(shown), /S05/);
  const l = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.equal(l.looks.length, 1);   // the same files again: the same look, now with ids shown
  assert.equal(l.looks[0].ids_shown, true);
});

test('O7, O8: each look spends half of what is left of the 5%; the same files again are the same look', () => {
  assert.deepEqual([1, 2, 3, 4].map(k => lookLevel(k)), [0.025, 0.0125, 0.00625, 0.003125]);
  const { config, log } = withLog();
  const look = (pred, opts) => score(config, pred, { target: 40, ...opts }).split;
  const a = look('predictions.json');
  assert.deepEqual([a.look.look, a.look.half.level, a.target.shown], [1, 0.025, true]);
  const b = look('predictions-v2.json');
  assert.deepEqual([b.look.look, b.look.half.level, b.target.p_value.toFixed(7), b.target.shown], [2, 0.0125, '0.0463574', false]);
  const again = look('predictions.json');
  assert.deepEqual([again.look.look, again.look.repeat.look, again.target.level, again.target.shown], [1, 1, 0.025, true]);
  const c = look('predictions-v3.json');
  assert.deepEqual([c.look.look, c.target.level, c.target.shown], [3, 0.00625, true]);   // 0.0060466 <= 0.00625
  const d = look('predictions-v4.json');
  assert.deepEqual([d.look.look, d.target.level, d.target.shown, d.target.why, d.target.records_needed], [4, 0.003125, false, 'used_up', 12]);
  const text = renderTerminal(score(config, 'predictions-v4.json', { target: 40 }));
  assert.match(text, /look 4 at this held-out half/i);
  assert.match(text, /used up/i);
  const l = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.deepEqual(l.looks.map(x => [x.look, x.command, x.held_out_records]), [[1, 'score', 11], [2, 'score', 11], [3, 'score', 11], [4, 'score', 11]]);
  assert.equal(l.looks[0].date, NOW.toISOString());
});

test('O9, O11: a log for another split, or a file that is not a log, stops', () => {
  const { config, log } = withLog();
  score(config, 'predictions.json');
  const other = { ...config, split: { ...config.split, salt: 'x' } };
  assert.throws(() => score(other, 'predictions.json'), /\[O9\].*written for the split/);
  fs.writeFileSync(log, '{ not json');
  assert.throws(() => score(config, 'predictions.json'), /\[O11\].*not valid JSON/);
  fs.writeFileSync(log, '{"looks": []}');
  assert.throws(() => score(config, 'predictions.json'), /\[O11\].*not a split log/);
});

test('O10: a record that was in the tuning half and is held out now stops (strict) or warns (lenient)', () => {
  const { config } = withLog();
  score(config, 'predictions.json');
  assert.throws(() => score(config, 'predictions.json', { key: 'key-moved.json' }), /\[O10\].*1 record\(s\) held out now were in the tuning half/);
  const r = score(config, 'predictions.json', { key: 'key-moved.json', mode: 'lenient' });
  assert.ok(r.problems.some(i => i.trap === 'O10' && i.level === 'warn'));
});

test('O13: after a look that listed the held-out records, later looks at them can show nothing', () => {
  const { config } = withLog();
  score(config, 'predictions.json', { target: 40, showHeldOut: true });
  const next = score(config, 'predictions-v3.json', { target: 40 }).split;
  assert.deepEqual([next.look.look, next.look.listed_at, next.target.level, next.target.shown, next.target.why], [2, 1, 0, false, 'listed']);
  assert.match(renderTerminal(score(config, 'predictions-v3.json', { target: 40 })), /listed at look 1/);
});

test('O14: records added later get a claim of their own, counted from their first look', () => {
  const { config } = withLog();
  for (const p of ['predictions.json', 'predictions-v2.json', 'predictions-v3.json', 'predictions-v4.json']) score(config, p, { target: 40 });
  const r = score(config, 'predictions-grown.json', { key: 'key-grown.json', target: 40 }).split;
  assert.deepEqual([r.look.look, r.look.half.look, r.look.half.level, r.look.fresh], [5, 5, 0.0015625, 3]);
  // The whole half, now 13 out with none wrong: p = 0.6^13 = 0.0013061, within look 5's 0.15625%.
  assert.deepEqual([r.held_out.silent_errors.n, r.held_out.silent_errors.d, r.target.p_value.toFixed(7), r.target.shown], [0, 13, '0.0013061', true]);
  assert.deepEqual([r.batch.since, r.batch.look, r.batch.level, r.batch.records], [5, 1, 0.025, 3]);
  assert.deepEqual([r.batch.held_out.silent_errors.n, r.batch.held_out.silent_errors.d], [0, 3]);
  assert.deepEqual([r.batch.target.p_value.toFixed(3), r.batch.target.shown, r.batch.target.records_needed], ['0.216', false, 8]);
  assert.ok(!('ids' in JSON.parse(JSON.stringify(r.batch))));
});

test('O5: a trap type wholly in the held-out half, beyond what chance gives, is warned about', () => {
  const config = loadConfig(f('config.json'));
  const r = scoreRun({ config, predPath: f('predictions.json'), keyPath: f('key-unbalanced.json'), applySplit: true, heldOut: true });
  const b = r.split.balance;
  assert.equal(b.level, 0.025);
  const look = b.dimensions[0].labels.find(x => x.label === 'lookalike');
  assert.deepEqual([look.records, look.held_out, look.p_value, look.beyond_chance], [7, 7, 0.015625, true]);
  // Plain: 4 of 17 held out, over 16 units (S01 and S20 are one unit, both plain): p = 2062 / 32768.
  const plain = b.dimensions[0].labels.find(x => x.label === 'plain');
  assert.deepEqual([plain.records, plain.held_out, plain.p_value, plain.beyond_chance], [17, 4, 2062 / 32768, false]);
  assert.ok(r.problems.some(i => i.trap === 'O5' && /lookalike/.test(i.message)));
  // The balanced key: no warning.
  const ok = scoreRun({ config, predPath: f('predictions.json'), keyPath: f('key.json'), applySplit: true, heldOut: true });
  assert.deepEqual(ok.split.balance.beyond_chance, []);
  assert.ok(!ok.problems.some(i => i.trap === 'O5'));
});

test('O15: a held-out half with no record says so, and claims nothing', () => {
  const config = loadConfig(f('config.json'));
  const { config: c2 } = withLog('config.json', s => ({ ...s, held_out: 0.005 }));
  const r = score(c2, 'predictions.json', { target: 40 });
  assert.equal(r.split.held_out.records, 0);
  assert.equal(r.split.target.why, 'nothing_out');
  assert.ok(r.problems.some(i => i.trap === 'O15'));
});

// ---------- compare and variance ----------

test('compare: the paired verdict on each half, the held-out half without ids', () => {
  const config = loadConfig(f('config.json'));
  const c = compareRun({ config, keyPath: f('key.json'), beforePath: f('predictions.json'), afterPath: f('predictions-bad.json'), applySplit: true, heldOut: true });
  const se = c.paired.outcomes.find(o => o.name === 'silent errors');
  assert.deepEqual([se.before, se.after, se.fixed, se.broke, se.verdict], [2, 2, 0, 0, 'no change']);
  const h = c.split.held_out.paired.outcomes.find(o => o.name === 'silent errors');
  assert.deepEqual([h.before, h.after, h.fixed, h.broke, h.verdict], [0, 6, 0, 6, 'worse']);
  assert.ok(!('fixed_ids' in h) && !('broke_ids' in h));
  assert.deepEqual(noIds(renderCompare(c) + JSON.stringify(resultsJson(c)), HELD), []);
});

test('compare --fail-if-worse reads the held-out half too, without naming its records', () => {
  const r = spawnSync(process.execPath, [CLI, 'compare', '--config', f('config.json'), '--key', f('key.json'), '--before', f('predictions.json'),
    '--after', f('predictions-bad.json'), '--fail-if-worse', 'silent-errors', '--held-out'], { encoding: 'utf8' });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /held-out half/);
  assert.deepEqual(noIds(r.stdout + r.stderr, HELD), []);
});

test('variance: the worst run on each half', () => {
  const config = loadConfig(f('config.json'));
  const v = varianceRun({ config, keyPath: f('key.json'), predPaths: [f('predictions.json'), f('predictions-v2.json'), f('predictions-v3.json')], applySplit: true, heldOut: true });
  const w = v.silent_error_rate.worst_run;
  assert.deepEqual([w.run, w.n, w.d], [1, 2, 9]);
  const h = v.split.held_out.worst_run;
  assert.deepEqual([h.run, h.n, h.d, h.low_pct, h.high_pct], [2, 1, 10, 1.8, 40.4]);
  assert.deepEqual(v.split.held_out.runs.map(x => [x.n, x.d]), [[0, 10], [1, 10], [0, 10]]);
  assert.deepEqual(noIds(renderVariance(v) + JSON.stringify(resultsJson(v)), HELD), []);
});

// ---------- what-if: chosen on the tuning half, checked on the held-out half (O16) ----------

test('O16: whatif --gate --target chooses on the tuning half and reports the gate on the held-out half', () => {
  const run = cfg => execFileSync(process.execPath, [CLI, 'whatif', '--config', f(cfg), '--pred', path.join(GATE, 'predictions.json'),
    '--key', path.join(GATE, 'key.json'), '--gate', '--target', '40', '--held-out'], { encoding: 'utf8' });
  const jsonOf = cfg => {
    const { dir, file } = withLog(cfg);
    const out = path.join(dir, 'w.json');
    execFileSync(process.execPath, [CLI, 'whatif', '--config', file, '--pred', path.join(GATE, 'predictions.json'), '--key', path.join(GATE, 'key.json'),
      '--gate', '--target', '40', '--held-out', '--json', out], { encoding: 'utf8' });
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  };
  // Default salt: 0.75 is certified on the tuning half (1 of 18); on the held-out half, 2 of 12 (16.7%) is under 40% but not
  // shown (p 0.0834): too few held-out records to confirm it at a first look.
  const a = jsonOf('gate.json');
  assert.equal(a.certification.best.threshold, 0.75);
  assert.deepEqual([a.split.chosen.silent_errors.n, a.split.chosen.silent_errors.d, a.split.chosen.target.p_value.toFixed(4), a.split.chosen.target.shown], [2, 12, '0.0834', false]);
  assert.equal(a.rows.find(x => x.threshold === 0.75).silent_error_rate.d, 18);   // the sweep is the tuning half's
  // Salt "b": 0.80 certified on the tuning half (0 of 12), and confirmed on the held-out half (1 of 12, p 0.0196).
  const b = jsonOf('gate-b.json');
  assert.equal(b.certification.best.threshold, 0.8);
  assert.deepEqual([b.split.chosen.silent_errors.n, b.split.chosen.silent_errors.d, b.split.chosen.target.p_value.toFixed(4), b.split.chosen.target.shown], [1, 12, '0.0196', true]);
  const text = run('gate.json');   // no log: the held-out numbers, and no claim
  assert.match(text, /no claim is made/);
  assert.doesNotMatch(text, /disagrees/);
  // Without --target nothing is chosen, so the held-out half is not looked at: the sweep is the tuning half's.
  const plain = execFileSync(process.execPath, [CLI, 'whatif', '--config', f('gate.json'), '--pred', path.join(GATE, 'predictions.json'),
    '--key', path.join(GATE, 'key.json'), '--gate'], { encoding: 'utf8' });
  assert.match(plain, /tuning half/);
  assert.doesNotMatch(plain, /HELD-OUT/);
});

test('O16: whatif --policies --target chooses a policy on the tuning half and checks it on the held-out half', () => {
  const { dir, file } = withLog('gate.json');
  const out = path.join(dir, 'p.json');
  execFileSync(process.execPath, [CLI, 'whatif', '--config', file, '--pred', path.join(GATE, 'predictions.json'), '--key', path.join(GATE, 'key.json'),
    '--policies', f('policies.json'), '--target', '40', '--held-out', '--json', out], { encoding: 'utf8' });
  const w = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(w.certification.best.name, 'Gate 0.75');
  assert.equal(w.split.chosen.name, 'Gate 0.75');
  assert.deepEqual([w.split.chosen.silent_errors.n, w.split.chosen.silent_errors.d, w.split.chosen.target.shown], [2, 12, false]);
});

test('the metadata example: the hand split (CRC-32 of the id, odd held out) as a config', () => {
  const config = loadConfig(f('config.json'));
  assert.ok(config.split);
  const G = path.join(__dirname, '..', 'examples', 'metadata-enrichment', 'golden500');
  const meta = loadConfig(path.join(G, 'config.json'));
  const handSplit = { ...meta, split: { held_out: 0.5, salt: '', hash: 'crc32', by: 'id', log: null } };
  const r = scoreRun({ config: handSplit, predPath: path.join(G, 'exec-70.json'), keyPath: path.join(G, 'exec-70.json'), applySplit: true, heldOut: true });
  // 13 of the 34 duplicate pairs straddle the halves when split by id (O3).
  assert.deepEqual(r.split.straddling, { clusters: 0, duplicates: 13 });
});

test('O5: Tarone leaves out kinds too small to ever be beyond chance, so they do not dull the warning', () => {
  // Seven records of one kind, all held out (p = 2 x 0.5^7 = 0.015625), seven of another all in the
  // tuning half, and three kinds of one record each, which no split can make beyond chance (their
  // smallest p is 1). Plain Bonferroni over all five kinds would set the bar at 0.01 and warn about
  // nothing; Tarone counts only the two kinds that can reach 0.025, and warns about both.
  const config = { trap_field: 'trap', groups: {}, split: { held_out: 0.5, salt: '', hash: 'sha256', by: 'id' } };
  const held = ['S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S10'];
  const tuning = ['S01', 'S02', 'S12', 'S14', 'S15', 'S16', 'S17'];
  const records = [...held.map(id => ({ id, traps: ['x'] })), ...tuning.map(id => ({ id, traps: ['y'] })),
    { id: 'S09', traps: ['a'] }, { id: 'S11', traps: ['b'] }, { id: 'S13', traps: ['c'] }].map(r => ({ ...r, duplicate_of: null }));
  const b = balanceOf(records, config, splitOf(records, config));
  assert.equal(b.level, 0.025);
  assert.equal(b.tested, 2);
  assert.deepEqual(b.beyond_chance.map(x => [x.label, x.held_out, x.records, x.p_value]), [['x', 7, 7, 0.015625], ['y', 0, 7, 0.015625]]);
  assert.deepEqual(b.none_tuning.map(x => x.label), ['a', 'b', 'c', 'x']);
});
