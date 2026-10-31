// "Any of these is right" (any_of slots in the answer key) and equivalent values, checked
// against test/fixtures/alternatives/EXPECTED.md. Named after traps D20-D23, F13 and I10.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateConfig, loadConfig } = require('../src/config.js');
const { problems } = require('../src/problems.js');
const { normalizePredictions, normalizeKey, parseRecords, loadRun } = require('../src/load.js');
const { decodeCsvRecords } = require('../src/csv.js');
const { scoreRun } = require('../src/score.js');
const { varianceOf } = require('../src/metrics/runs.js');
const { floorSweep } = require('../src/metrics/whatif.js');
const { renderTerminal } = require('../src/report/terminal.js');
const { renderHtml } = require('../src/report/html.js');

const dir = path.join(__dirname, 'fixtures', 'alternatives');
const files = { configPath: path.join(dir, 'config.json'), predPath: path.join(dir, 'predictions.json'), keyPath: path.join(dir, 'key.json') };
// Loaded on first use, so each test fails on its own if the fixture cannot be read.
let cached = null;
function fixture() {
  if (!cached) {
    const config = loadConfig(files.configPath);
    cached = { config, S: scoreRun({ config, predPath: files.predPath, keyPath: files.keyPath }) };
  }
  return cached;
}
const rec = id => fixture().S.records.find(r => r.id === id);
const counts = o => o.tp + '/' + o.fp + '/' + o.fn;
const cli = args => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wfeval.js'), ...args], { encoding: 'utf8' });

function run(fn, mode = 'strict') {
  const p = problems(mode);
  const result = fn(p);
  return { result, flagged: p.items.map(i => i.level + ':' + i.trap), items: p.items };
}
const SET = validateConfig({ outputs: { cites: { type: 'set' } }, routing: { map: { A: 'auto' } } }).config;
const readKey = (cites, mode, config = SET) => run(p => normalizeKey([{ id: 'K1', cites }], config, 'key', p), mode);

// ---------- The fixture ----------

test('D20: one value fills an any_of slot, and two values from one slot are both right', () => {
  const q = fixture().S.quality.outputs.cites;
  assert.equal(counts(q), '7/1/2');
  assert.deepEqual([q.precision.pct, q.recall.pct, q.f1], [87.5, 77.8, 0.824]);
  assert.deepEqual([q.exact_match.n, q.exact_match.d], [4, 6]);
  assert.deepEqual(rec('A1').differences.missing, {});
  assert.deepEqual(rec('A2').differences, { wrong: {}, missing_rejected: {}, missing: {}, invalid: {}, near_miss: {}, declined: {}, should_decline: {} });
});

test('D20: an unfilled slot is one miss, counted under "one of ..."', () => {
  const v = fixture().S.quality.outputs.cites.by_value;
  assert.deepEqual(Object.keys(v), ['ep-01', 'ep-02', 'ep-04', 'ep-05', 'ep-12', 'ep-20', 'one of ep-07, ep-08, ep-09', 'one of ep-10, ep-11']);
  assert.deepEqual([v['ep-02'].tp, v['ep-12'].tp, v['ep-04'].fp], [2, 2, 1]);
  assert.deepEqual([v['one of ep-07, ep-08, ep-09'].fn, v['one of ep-10, ep-11'].fn], [1, 1]);
});

test('D20: an unfilled slot shows as "one of ...", and a set-aside alternative shows that value', () => {
  assert.deepEqual(rec('A3').differences.wrong, { cites: ['ep-04'] });
  assert.deepEqual(rec('A3').differences.missing, { cites: ['one of ep-07, ep-08, ep-09'] });
  assert.deepEqual(rec('A4').differences.missing_rejected, { cites: ['ep-11 (one of ep-10, ep-11)'] });
  assert.deepEqual(rec('A4').differences.missing, {});
});

test('D20: silent errors and routing', () => {
  const r = fixture().S.routing;
  assert.deepEqual([r.silent_errors.rate.n, r.silent_errors.rate.d, r.silent_errors.rate.low_pct, r.silent_errors.rate.high_pct], [2, 5, 11.8, 76.9]);
  assert.deepEqual(r.silent_errors.records.map(x => [x.id, x.severity, x.types.join(' ')]),
    [['A3', 'high', 'SP-WRONG SP-MISSING'], ['A4', 'medium', 'SP-MISSING-REJECTED']]);
  assert.deepEqual([r.straight_through.n, r.straight_through.d], [5, 6]);
  assert.equal(r.safeguard_failures.records, 0);
  assert.deepEqual([r.review_queue.precision.n, r.review_queue.precision.d, r.review_queue.wasted], [0, 1, ['A6']]);
});

test('D20: a claim is right when its value is any alternative of a slot, applied or set aside', () => {
  const c = fixture().S.calibration;
  assert.deepEqual([c.overall.n, c.overall.correct, c.overall.ece], [9, 8, 0.187]);
  const at = s => c.overall.buckets.find(b => b.from === s);
  assert.deepEqual([at(0.55).n, at(0.55).correct], [1, 1]);   // A4's set-aside ep-11
  assert.deepEqual([at(0.9).n, at(0.9).correct], [4, 3]);
  const t = name => c.thresholds.find(x => x.name === name);
  assert.deepEqual([t('floor').at_or_above.n, t('floor').at_or_above.d, t('floor').below.n, t('floor').below.d], [7, 8, 1, 1]);
  assert.deepEqual([t('auto_publish').at_or_above.n, t('auto_publish').at_or_above.d], [6, 7]);
});

test('D23: equivalent values are read as the group\'s first, on both sides; two in one prediction merge', () => {
  const { config } = fixture();
  const loaded = loadRun({ config, predPath: files.predPath, keyPath: files.keyPath });
  const a5 = loaded.records.find(r => r.id === 'A5');
  assert.deepEqual(a5.pred.cites, [{ value: 'ep-12', confidence: 0.9, applied: true, inherited: false }]);
  assert.deepEqual(loaded.records.find(r => r.id === 'A6').key.cites, ['ep-12']);
  const fixes = loaded.problems.map(i => i.level + ' [' + i.trap + '] ' + path.basename(i.where) + ': ' + i.message);
  assert.deepEqual(fixes, [
    'fix [D23] predictions.json A5: cites: merged 2 equivalent values, "ep-12-rerun" and "ep-12", into "ep-12" (applied, confidence 0.9)',
    'fix [D23] predictions.json: cites: 1 predicted value read as its equivalent: ep-12-rerun as ep-12',
    'fix [D23] key.json: cites: 1 answer key value read as its equivalent: ep-12-rerun as ep-12',
  ]);
});

test('D23: merged values are applied if either was, at the applied copy\'s confidence; a value written twice is still D6', () => {
  const cfg = validateConfig({ outputs: { cites: { type: 'set' } }, routing: { map: { A: 'auto' } }, equivalents: { cites: [['x', 'x2', 'x3']] } }).config;
  const pred = cites => run(p => normalizePredictions([{ id: 'P1', route: 'A', cites }], cfg, 'preds', p), 'lenient');
  // x applied at 0.7; x2 (0.4) and x3 (0.9) proposed but not applied. The workflow acted on 0.7.
  const merged = pred([{ value: 'x2', confidence: 0.4, applied: false }, { value: 'x', confidence: 0.7, applied: true }, { value: 'x3', confidence: 0.9, applied: false }]);
  assert.deepEqual(merged.result[0].outputs.cites, [{ value: 'x', confidence: 0.7, applied: true, inherited: false }]);
  assert.deepEqual(merged.flagged, ['fix:D23', 'fix:D23', 'fix:D23']);
  // With no applied copy, the higher confidence, as before.
  const none = pred([{ value: 'x2', confidence: 0.4, applied: false }, { value: 'x3', confidence: 0.9, applied: false }]);
  assert.deepEqual(none.result[0].outputs.cites, [{ value: 'x', confidence: 0.9, applied: false, inherited: false }]);
  assert.match(none.items[0].message, /\(not applied, confidence 0\.9\)$/);
  // Three applied copies: the highest is kept, and the lowest beside it.
  const three = pred([{ value: 'x2', confidence: 0.5 }, { value: 'x', confidence: 0.7 }, { value: 'x3', confidence: 0.9 }]);
  assert.deepEqual(three.result[0].outputs.cites, [{ value: 'x', confidence: 0.9, applied: true, inherited: false, floor_confidence: 0.5 }]);
  assert.deepEqual(pred(['x', 'x']).flagged, ['warn:D6']);
  assert.deepEqual(pred(['x2', 'x2']).flagged, ['warn:D6', 'fix:D23']);
});

// The reviewer's case: gate 0.8, floor 0.6, ep-12 and ep-12-rerun equivalent; one record whose
// cites are as given. Scored with and without the equivalents.
const EQ_RAW = {
  id_field: 'id', outputs: { cites: { type: 'set' } }, routing: { field: 'decision', map: { ANSWER: 'auto', REVIEW: 'review' } },
  thresholds: { floor: 0.6, auto_publish: { cites: 0.8 } },
};
const eqConfig = ({ equivalents = true, gate_uses } = {}) => {
  const { config, errors } = validateConfig({
    ...EQ_RAW, thresholds: { ...EQ_RAW.thresholds, ...(gate_uses ? { gate_uses } : {}) },
    ...(equivalents ? { equivalents: { cites: [['ep-12', 'ep-12-rerun']] } } : {}),
  });
  assert.deepEqual(errors, []);
  return config;
};
function scoreOne(cites, options) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-eq-'));
  try {
    const file = (name, data) => { fs.writeFileSync(path.join(d, name), JSON.stringify(data)); return path.join(d, name); };
    const S = scoreRun({ config: eqConfig(options), predPath: file('pred.json', [{ id: 'E1', decision: 'ANSWER', cites }]), keyPath: file('key.json', [{ id: 'E1', cites: ['ep-12'] }]),
      mode: (options && options.mode) || 'strict' });
    const merges = S.problems.filter(i => i.trap === 'D23' && / merged /.test(i.message)).map(i => i.message);
    return { S, safeguards: S.records[0].safeguards, merges };
  } finally { fs.rmSync(d, { recursive: true }); }
}

test('D23: an applied 0.4 and a 0.9 not applied merge at 0.4: SG-GATE and SG-FLOOR still fire, as without equivalents', () => {
  const cites = [{ value: 'ep-12', confidence: 0.4 }, { value: 'ep-12-rerun', confidence: 0.9, applied: false }];
  assert.deepEqual(scoreOne(cites, { equivalents: false }).safeguards, ['SG-GATE', 'SG-FLOOR']);
  const m = scoreOne(cites);
  assert.deepEqual(m.safeguards, ['SG-GATE', 'SG-FLOOR']);
  assert.equal(m.S.routing.safeguard_failures.records, 1);
  // The FIX line says which confidence was kept, and which was not used.
  assert.deepEqual(m.merges, ['cites: merged 2 equivalent values, "ep-12" and "ep-12-rerun", into "ep-12" ' +
    '(applied, confidence 0.4, the applied copy\'s: the 0.9 of a copy not applied is not used)']);
});

test('D6 in lenient mode keeps one copy by the same rule: the same text applied at 0.4 and set aside at 0.9 still fails the gate and the floor', () => {
  const cites = [{ value: 'ep-12', confidence: 0.4 }, { value: 'ep-12', confidence: 0.9, applied: false }];
  const m = scoreOne(cites, { equivalents: false, mode: 'lenient' });
  assert.deepEqual(m.safeguards, ['SG-GATE', 'SG-FLOOR']);
  assert.deepEqual(m.S.problems.filter(i => i.trap === 'D6').map(i => i.level), ['warn']);
  // Two applied copies: a lead gate sees 0.9, the floor 0.4.
  assert.deepEqual(scoreOne([{ value: 'ep-12', confidence: 0.9 }, { value: 'ep-12', confidence: 0.4 }], { equivalents: false, mode: 'lenient' }).safeguards, ['SG-FLOOR']);
});

test('D23: an applied 0.9 and an applied 0.4 merge at 0.9, keeping the 0.4: the floor fires, a lead gate passes, a "weakest" gate fails', () => {
  const cites = [{ value: 'ep-12', confidence: 0.9 }, { value: 'ep-12-rerun', confidence: 0.4 }];
  const m = scoreOne(cites);
  assert.deepEqual(m.safeguards, ['SG-FLOOR']);
  assert.deepEqual(m.merges, ['cites: merged 2 equivalent values, "ep-12" and "ep-12-rerun", into "ep-12" ' +
    '(applied, confidence 0.9, the highest applied copy\'s; the floor and a "weakest" gate check the lowest, 0.4)']);
  assert.deepEqual(scoreOne(cites, { gate_uses: 'weakest' }).safeguards, ['SG-GATE', 'SG-FLOOR']);
  // Either order: the merge keeps the same two confidences.
  assert.deepEqual(scoreOne([...cites].reverse()).safeguards, ['SG-FLOOR']);
  // Calibration counts one claim, at the confidence a lead gate sees.
  const c = m.S.calibration;
  assert.deepEqual([c.overall.n, c.overall.correct], [1, 1]);
  assert.equal(c.overall.buckets[0].from, 0.9);
});

test('D23: the what-ifs read a merged value by its copies: a floor above the weakest drops that copy, and the value stays', () => {
  const cites = [{ value: 'ep-12', confidence: 0.9 }, { value: 'ep-12-rerun', confidence: 0.4 }];
  const { S } = scoreOne(cites);
  const row = f => floorSweep(S.paired, eqConfig(), { from: 0.4, to: 0.95, step: 0.05 }).rows.find(r => r.floor === f);
  // At 0.4 the weak copy stands, and it is not under the floor.
  assert.deepEqual([row(0.4).safeguard_failures, row(0.4).evicted, row(0.4).through], [0, [], ['E1']]);
  // From 0.45 the floor drops the 0.4 copy and keeps the 0.9 one: no failure, nothing evicted,
  // as a plain value under the floor is evicted rather than counted as a failure.
  for (const f of [0.45, 0.6, 0.9]) assert.deepEqual([row(f).safeguard_failures, row(f).evicted, row(f).through], [0, [], ['E1']], 'floor ' + f);
  // Above 0.9 the value itself goes.
  assert.deepEqual(row(0.95).evicted, ['E1 ep-12']);
  // The gate sweep sees the lead copy: 0.9 passes a gate of 0.9, not 0.95.
  const { gateSweep } = require('../src/metrics/whatif.js');
  const g = gateSweep(S.paired, eqConfig());
  assert.deepEqual([g.rows.find(r => r.threshold === 0.9).through, g.rows.find(r => r.threshold === 0.95).through], [['E1'], []]);
});

test('D20: the floor what-if fills the slots again at every floor', () => {
  const { config, S } = fixture();
  const F = floorSweep(S.paired, config);
  const row = f => {
    const r = F.rows.find(x => x.floor === f);
    return [r.readmitted.concat(r.evicted.map(e => '-' + e)).join(', '), counts(r.overall), r.overall.precision.pct, r.overall.recall.pct, r.overall.f1, r.silent_errors.join(' '), r.moved.length, r.needs_replay.length];
  };
  assert.deepEqual(row(0.55), ['A4 ep-11', '8/1/1', 88.9, 88.9, 0.889, 'A3', 0, 0]);
  assert.deepEqual(row(0.6), ['', '7/1/2', 87.5, 77.8, 0.824, 'A3 A4', 0, 0]);
  assert.deepEqual(row(0.8), ['-A6 ep-12', '6/1/3', 85.7, 66.7, 0.75, 'A3 A4', 0, 0]);
  // A2 loses ep-02, but ep-01 still fills its slot: one true positive less, no miss more.
  assert.deepEqual(row(0.85), ['-A2 ep-02, -A6 ep-12', '5/1/3', 83.3, 62.5, 0.714, 'A3 A4', 0, 0]);
  // A2 loses ep-01 too: its slot is empty, and A2 becomes a silent error.
  assert.deepEqual(row(0.9), ['-A2 ep-01, -A2 ep-02, -A6 ep-12', '4/1/4', 80, 50, 0.615, 'A2 A3 A4', 0, 0]);
});

test('I10: an alternative of a slot is never a possible key gap; only the wrong value is', () => {
  const { config, S } = fixture();
  const v = varianceOf([{ label: 'run 1', results: S }, { label: 'run 2', results: S }], config);
  assert.deepEqual(v.records.key_gap_candidates.map(g => g.id + ' ' + g.value + ' ' + g.runs + '/' + g.of), ['A3 ep-04 2/2']);
});

test('the reports show an unfilled slot as "one of ..." and list the equivalents read', () => {
  const t = renderTerminal(fixture().S);
  assert.match(t, /cites {2}in the answer key, never found: one of ep-07, ep-08, ep-09/);
  assert.match(t, /cites {2}in the answer key, found but set aside: ep-11 \(one of ep-10, ep-11\)/);
  assert.match(t, /fix \[D23\] .*key\.json: cites: 1 answer key value read as its equivalent: ep-12-rerun as ep-12/);
  const h = renderHtml(fixture().S, '2026-10-31T00:00:00.000Z');
  assert.match(h, /never found: <code>one of ep-07, ep-08, ep-09<\/code>/);
  assert.match(h, /merged 2 equivalent values/);
});

test('wfeval check names the equivalents it will read', () => {
  const r = cli(['check', '--config', files.configPath, '--pred', files.predPath, '--key', files.keyPath]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\n {2}equivalents cites: ep-12-rerun read as ep-12\n/);
  assert.match(r.stdout, /cleaned up \(3\)/);
});

// ---------- Reading any_of (D21, D22, F13) ----------

test('D20: any_of values are trimmed and checked like plain values', () => {
  const ok = readKey(['a', { any_of: [' b ', 'c'] }]);
  assert.deepEqual(ok.result[0].outputs.cites, ['a', { any_of: ['b', 'c'] }]);
  assert.deepEqual(ok.flagged, ['fix:D7']);
  assert.deepEqual(readKey([{ any_of: ['b', ''] }]).flagged, ['stop:D9']);
});

test('D21: an empty any_of, a value that is not text, or anything beside any_of stops, naming the record', () => {
  for (const bad of [{ any_of: [] }, { any_of: 'a' }, { any_of: ['a', 7] }, { any_of: ['a', { value: 'b' }] }, { any_of: ['a', ['b']] }, { any_of: ['a', 'b'], note: 'x' }]) {
    const { flagged, items } = readKey([bad]);
    assert.deepEqual(flagged, ['stop:D21'], JSON.stringify(bad));
    assert.match(items[0].where, /^key K1 cites\[0\]/);
  }
  assert.match(readKey([{ any_of: [] }]).items[0].message, /an empty list/);
  assert.match(readKey([{ any_of: ['a', 7] }]).items[0].message, /must be text/);
  assert.match(readKey([{ any_of: ['a'], note: 'x' }]).items[0].message, /"note"/);
});

test('D21: any_of in a prediction stops: a prediction lists what the workflow gave', () => {
  const { flagged, items } = run(p => normalizePredictions([{ id: 'P1', route: 'A', cites: [{ any_of: ['a', 'b'] }] }], SET, 'preds', p));
  assert.deepEqual(flagged, ['stop:D21']);
  assert.match(items[0].message, /answer key/);
});

test('D21: a misspelled any_of is named', () => {
  const { flagged, items } = readKey([{ anyOf: ['a', 'b'] }]);
  assert.deepEqual(flagged, ['stop:D4']);
  assert.match(items[0].message, /did you mean "any_of"/);
});

test('D22: a value in two slots of one record stops in strict mode; lenient counts it by the rules', () => {
  assert.deepEqual(readKey(['a', { any_of: ['a', 'b'] }]).flagged, ['stop:D22']);
  assert.deepEqual(readKey([{ any_of: ['a', 'b'] }, { any_of: ['c', 'b'] }]).flagged, ['stop:D22']);
  assert.deepEqual(readKey([{ any_of: ['a', 'a'] }]).flagged, ['stop:D6']);
  const lenient = readKey(['a', { any_of: ['a', 'b'] }], 'lenient');
  assert.deepEqual(lenient.flagged, ['warn:D22']);
  assert.deepEqual(lenient.result[0].outputs.cites, ['a', { any_of: ['a', 'b'] }]);
});

test('F13: any_of on a label output stops: it is for set outputs', () => {
  const cfg = validateConfig({ outputs: { verdict: { type: 'label', labels: ['pass', 'fail'] } }, routing: { map: { A: 'auto' } } }).config;
  const k = run(p => normalizeKey([{ id: 'K1', verdict: { any_of: ['pass', 'fail'] } }], cfg, 'key', p));
  assert.deepEqual(k.flagged, ['stop:F13']);
  assert.match(k.items[0].message, /any_of is for set outputs/);
  assert.match(k.items[0].message, /equivalents/);
});

// ---------- Equivalents in the config ----------

test('equivalents: checked in the config', () => {
  const errs = equivalents => validateConfig({
    outputs: { cites: { type: 'set' }, verdict: { type: 'label', labels: ['pass', 'fail'] } },
    routing: { field: 'route', map: { A: 'auto' } }, equivalents,
  }).errors.join('\n');
  assert.equal(errs({ cites: [['a', 'a2'], ['x', 'y', 'z']], verdict: [['fail', 'reject']] }), '');
  assert.match(errs({ cites: [['a', 'a2'], ['b', 'a2']] }), /equivalents\.cites: "a2" is in two groups/);
  assert.match(errs({ cites: [['a', 'a']] }), /equivalents\.cites: "a" is in one group twice/);
  assert.match(errs({ cites: [['a']] }), /equivalents\.cites\[0\] must list two or more values/);
  assert.match(errs({ cites: [['a', 7]] }), /equivalents\.cites\[0\] must list two or more values/);
  assert.match(errs({ cites: [['a', ' b']] }), /without spaces at either end/);
  assert.match(errs({ tags: [['a', 'b']] }), /equivalents\.tags is not a declared output/);
  assert.match(errs({ cites: ['a', 'b'] }), /equivalents\.cites must be a list of groups/);
  assert.match(errs(['a']), /equivalents must be an object/);
  assert.match(errs({ verdict: [['reject', 'fail']] }), /the first value, "reject", must be one of outputs\.verdict\.labels/);
  const route = validateConfig({ outputs: { verdict: { type: 'label', labels: ['A', 'R'] } }, routing: { field: 'verdict', map: { A: 'auto', R: 'review' } }, equivalents: { verdict: [['A', 'a']] } });
  assert.match(route.errors.join('\n'), /outputs\.verdict is also the route/);
});

test('equivalents: a label output reads an alias as its label', () => {
  const cfg = validateConfig({ outputs: { verdict: { type: 'label', labels: ['pass', 'fail'] } }, routing: { map: { A: 'auto' } }, equivalents: { verdict: [['fail', 'reject']] } }).config;
  const pr = run(p => normalizePredictions([{ id: 'P1', route: 'A', verdict: 'reject' }], cfg, 'preds', p));
  assert.deepEqual(pr.result[0].outputs.verdict, { value: 'fail', confidence: null, applied: true, inherited: false });
  assert.deepEqual(pr.flagged, ['fix:D23']);
  assert.deepEqual(run(p => normalizeKey([{ id: 'K1', verdict: 'reject' }], cfg, 'key', p)).result[0].outputs.verdict, 'fail');
});

test('equivalents: an allowed value stays allowed under any of its names', () => {
  const cfg = validateConfig({ outputs: { cites: { type: 'set' } }, routing: { map: { A: 'auto' } },
    allowed_values: { cites: ['a-old', 'b'] }, equivalents: { cites: [['a', 'a-old']] } }).config;
  assert.deepEqual(cfg.allowed_values.cites, ['a', 'b']);
});

// ---------- any_of in a CSV answer key ----------

test('CSV: with input.key.any_of_separator, "ep-07 / ep-08" in a key cell is one slot', () => {
  const cfg = validateConfig({ outputs: { cites: { type: 'set' } }, routing: { map: { A: 'auto' } }, input: { key: { any_of_separator: '/' } } }).config;
  const p = problems('strict');
  const rows = parseRecords('id,cites\nK1,ep-05 | ep-07 / ep-08 /ep-09\nK2,\n', 'key.csv', p, cfg.input.key);
  const decoded = decodeCsvRecords(rows, cfg, 'key', cfg.input.key, 'key.csv', p);
  const key = normalizeKey(decoded, cfg, 'key.csv', p);
  assert.deepEqual(p.items, []);
  assert.deepEqual(key.map(k => k.outputs.cites), [['ep-05', { any_of: ['ep-07', 'ep-08', 'ep-09'] }], []]);
});

test('CSV: any_of_separator splits every set output of the key, unless any_of_outputs names some; a label cell holding it stops', () => {
  const raw = { outputs: { cites: { type: 'set' }, tags: { type: 'set' }, verdict: { type: 'label', labels: ['n/a', 'pass'] } }, routing: { map: { A: 'auto' } } };
  const read = (input, text) => {
    const { config, errors } = validateConfig({ ...raw, input });
    assert.deepEqual(errors, []);
    const p = problems('strict');
    const rows = parseRecords(text, 'key.csv', p, config.input.key);
    const key = normalizeKey(decodeCsvRecords(rows, config, 'key', config.input.key, 'key.csv', p), config, 'key.csv', p);
    return { outputs: key[0].outputs, flagged: p.items.map(i => i.level + ':' + i.trap) };
  };
  const text = 'id,cites,tags,verdict\nK1,ep-07 / ep-08,TCP/IP,pass\n';
  // Every set output: the tag "TCP/IP", one real value, becomes a slot of two.
  assert.deepEqual(read({ key: { any_of_separator: '/' } }, text).outputs.tags, [{ any_of: ['TCP', 'IP'] }]);
  // Limited to cites, the tag stays one value.
  assert.deepEqual(read({ key: { any_of_separator: '/', any_of_outputs: ['cites'] } }, text).outputs,
    { cites: [{ any_of: ['ep-07', 'ep-08'] }], tags: ['TCP/IP'], verdict: 'pass' });
  // A label holding the separator stops (any_of is for set outputs), unless the outputs are named.
  const label = 'id,cites,tags,verdict\nK1,,,n/a\n';
  assert.deepEqual(read({ key: { any_of_separator: '/' } }, label).flagged, ['stop:F13']);
  assert.equal(read({ key: { any_of_separator: '/', any_of_outputs: ['cites'] } }, label).outputs.verdict, 'n/a');
  // any_of_outputs names set outputs of the key, with a separator to split on.
  const errs = input => validateConfig({ ...raw, input }).errors.join('\n');
  assert.match(errs({ key: { any_of_separator: '/', any_of_outputs: ['verdict'] } }), /input\.key\.any_of_outputs: "verdict" is not a set output/);
  assert.match(errs({ key: { any_of_separator: '/', any_of_outputs: ['nope'] } }), /input\.key\.any_of_outputs: "nope" is not a set output/);
  assert.match(errs({ key: { any_of_separator: '/', any_of_outputs: [] } }), /input\.key\.any_of_outputs must be a list of one or more output names/);
  assert.match(errs({ key: { any_of_separator: '/', any_of_outputs: 'cites' } }), /input\.key\.any_of_outputs must be a list of one or more output names/);
  assert.match(errs({ key: { any_of_outputs: ['cites'] } }), /input\.key\.any_of_outputs needs input\.key\.any_of_separator/);
  assert.match(errs({ predictions: { any_of_outputs: ['cites'] } }), /input\.predictions\.any_of_outputs: alternatives belong in the answer key only/);
});

test('CSV: any_of_separator is for the answer key only, and differs from the other separators', () => {
  const errs = input => validateConfig({ outputs: { cites: { type: 'set' } }, routing: { map: { A: 'auto' } }, input }).errors.join('\n');
  assert.equal(errs({ key: { any_of_separator: '/' } }), '');
  assert.match(errs({ predictions: { any_of_separator: '/' } }), /input\.predictions\.any_of_separator: alternatives belong in the answer key only/);
  assert.match(errs({ key: { any_of_separator: '|' } }), /any_of_separator and list_separator are both "\|"/);
  assert.match(errs({ key: { any_of_separator: '@' } }), /any_of_separator and confidence_separator are both "@"/);
});
