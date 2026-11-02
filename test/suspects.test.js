// Answer-key suspects (wfeval suspects) and the rulings verbs it added: checked against
// test/fixtures/suspects/EXPECTED.md (traps N1-N19).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig, validateConfig } = require('../src/config.js');
const { scoreRun } = require('../src/score.js');

const dir = path.join(__dirname, 'fixtures', 'suspects');
const f = name => path.join(dir, name);
const config = loadConfig(f('config.json'));
const keyPath = f('key.json');
const runA = f('run-a.json');
const runB = f('run-b.json');
const root = path.join(__dirname, '..');
const cli = (args, cwd = root) => spawnSync(process.execPath, [path.join(root, 'bin', 'wfeval.js'), ...args], { encoding: 'utf8', cwd });
// Lines of a report wider than 100 columns, leaving out those that hold a file path the user typed.
const wide = (out, ...paths) => out.split('\n').filter(l => l.length > 100 && !paths.some(p => l.includes(p)));
// A report with its line breaks and indents read as single spaces, to match sentences whatever the wrapping.
const flat = out => out.replace(/\s+/g, ' ');
// Required inside each test, so each test fails on its own where the module does not exist.
const run = (predPaths, opts = {}) => require('../src/suspects.js').suspectsRun({ config, keyPath, predPaths, ...opts });
const loadRulings = (file, cfg = config, mode = 'strict') => require('../src/rulings.js').loadRulings(file, cfg, mode);
const render = (r, top) => require('../src/report/suspects.js').renderSuspects(r, top);
const close = (a, b, d = 1e-4) => assert.ok(Math.abs(a - b) < d, a + ' is not ' + b);
const row = s => [s.rank, s.kind, s.id, s.output, s.value];

function tmp(name, content) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-suspects-'));
  const file = path.join(d, name);
  if (content !== undefined) fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return { file, dir: d, done: () => fs.rmSync(d, { recursive: true }) };
}
const ruling = (over = {}) => ({ id: 'T8', output: 'tags', value: 'late', ruling: 'keep', by: 'DH', on: '2026-11-01', ...over });
function loadError(rulings, cfg = config) {
  const t = tmp('r.json', rulings);
  try { loadRulings(t.file, cfg); return null; } catch (e) { return e.message; } finally { t.done(); }
}

// ---------- the ranking, worked by hand ----------

test('one run: six suspects in the order and with the weights worked out by hand', () => {
  const R = run([runA]);
  assert.deepEqual(R.suspects.map(row), [
    [1, 'label', 'T8', 'category', 'billing'],
    [2, 'key_lists', 'T8', 'tags', 'late'],
    [3, 'key_lists', 'T10', 'tags', 'fraud'],
    [4, 'key_lacks', 'T7', 'tags', 'refund'],
    [5, 'key_lacks', 'T5', 'tags', 'damaged'],
    [6, 'key_lacks', 'T3', 'tags', 'late'],
  ]);
  const w = R.suspects.map(s => s.weight);
  close(w[0], 13);
  close(w[1], 6443 / 585);
  close(w[2], 1819 / 234);
  close(w[3], 1033 / 155);
  close(w[4], 505 / 287);
  close(w[5], 25355 / 26818);
  assert.equal(R.suspects[0].with, 'shipping');
  assert.deepEqual(R.counts, { key_lacks: 3, key_lists: 2, label: 1, total: 6 });
  assert.deepEqual(R.suspects.map(s => s.verbs), [['replace', 'keep'], ['remove', 'keep'], ['remove', 'keep'], ['add', 'reject'], ['add', 'reject'], ['add', 'reject']]);
});

test('one run: the evidence behind each weight', () => {
  const [label, late, fraud, refund, damaged, late3] = run([runA]).suspects.map(s => s.evidence);
  // curve_from: the levels each curve value was read from, with their counts (the pooled 0.80-0.89
  // and 0.90 or more read as one level, "at 0.80 or more").
  const top = [{ where: 'at 0.80 or more', agree: 9, of: 11 }];
  assert.deepEqual(label, { kind: 'label', bin: '0.90 or more', agree: 6, of: 6, curve: 0.9286, curve_from: [{ where: 'at 0.90 or more', agree: 6, of: 6 }] });
  assert.deepEqual(late, { kind: 'key_lists', bin: 'never', when_listed: 0, listed: 3, when_lacking: 6, lacking: 7 });
  assert.deepEqual(fraud, { kind: 'key_lists', bin: 'never', when_listed: 0, listed: 0, when_lacking: 10, lacking: 10 });
  assert.deepEqual(refund, { kind: 'key_lacks', bin: '0.90 or more', listed: 4, of: 4, curve: 0.7652, curve_from: top, q: 0.8695 });
  assert.deepEqual(damaged, { kind: 'key_lacks', bin: '0.90 or more', listed: 0, of: 1, curve: 0.7652, curve_from: top, q: 0.6376 });
  assert.deepEqual(late3, { kind: 'key_lacks', bin: '0.50-0.59', listed: 0, of: 0, curve: 0.486,
    curve_from: [{ where: 'never stated', agree: 2, of: 30 }, { where: 'at 0.80 or more', agree: 9, of: 12 }], q: 0.486 });
});

// N3: several runs combine as one average per entry, 0 where a run does not state it.
test('N3: two runs: each entry\'s confidence averaged over the runs, 0 where a run does not state it', () => {
  const R = run([runA, runB]);
  assert.deepEqual(R.suspects.map(s => [s.id, s.value, s.average_confidence, s.said.said, s.said.runs]), [
    ['T10', 'fraud', 0, 0, 2], ['T8', 'billing', 0.475, 1, 2], ['T8', 'late', 0.375, 1, 2],
    ['T5', 'damaged', 1, 2, 2], ['T7', 'refund', 0.475, 1, 2], ['T3', 'late', 0.275, 1, 2],
  ]);
  const w = R.suspects.map(s => s.weight);
  close(w[0], 1819 / 117);
  close(w[1], 5);
  close(w[2], 204 / 65);
  close(w[3], 25 / 11);
  close(w[4], 1.49645);
  close(w[5], 1.45423);
  assert.deepEqual(R.suspects[2].said, { runs: 2, said: 1, applied: 1, confidence: { min: 0.75, max: 0.75 } });
  // A disagreement from any run is a suspect: here only the second run states "a", and only the
  // first misses "b".
  const { suspectsOf } = require('../src/metrics/suspects.js');
  const { config: cfg } = validateConfig({ outputs: { tags: { type: 'set' } }, routing: { field: 'route', map: { GO: 'auto' } } });
  const rec = (tags) => ({ id: 'Y1', route: 'GO', route_class: 'auto', scored: true, key: { tags: ['b'] },
    pred: { tags: tags.map(([value, confidence]) => ({ value, confidence, applied: true, inherited: false })) } });
  const two = suspectsOf([[rec([])], [rec([['a', 0.8], ['b', 0.9]])]], cfg);
  assert.deepEqual(two.map(s => [s.kind, s.value, s.said.said, s.average_confidence]).sort(), [['key_lacks', 'a', 1, 0.4], ['key_lists', 'b', 1, 0.45]]);
  // Three runs at 0.7 average 0.6999999999999998 in binary arithmetic: still the 0.70-0.79 bin.
  const { binOf, binWords } = require('../src/metrics/suspects.js');
  assert.equal(binWords(binOf((0.7 + 0.7 + 0.7) / 3)), '0.70-0.79');
  assert.deepEqual([0, 0.3, 0.5, 0.59, 0.9, 1].map(x => binWords(binOf(x))), ['never', 'below 0.50', '0.50-0.59', '0.50-0.59', '0.90 or more', '0.90 or more']);
});

// N4: the suspect's own record is never evidence for or against itself.
test('N4: leave-one-out: a suspect\'s counts and its output\'s curve leave its own record out', () => {
  const { collect, findSuspects, rankSuspects } = require('../src/metrics/suspects.js');
  const R = run([runA]);
  // T7's refund at 0.95 is one of 5 entries at 0.90 or more; its evidence counts the other 4.
  assert.equal(R.suspects[3].evidence.of, 4);
  // T8's label: 7 label entries at 0.90 or more, T8 one of them; the curve without it is 13/14
  // (6 agree of 6), where with it, 6.5/8, the weight would be 13/3, not 13.
  close(R.suspects[0].evidence.curve, 13 / 14);
  // The two-run label case: T8's own billing pair (agreeing) sits in its bin; left out, nothing is.
  const two = run([runA, runB]).suspects.find(s => s.kind === 'label');
  assert.deepEqual([two.evidence.agree, two.evidence.of], [0, 0]);
  // Ranking a suspect never changes when its own entry moves: each record's counts exclude itself.
  const paired = scoreRun({ config, predPath: runA, keyPath }).paired;
  const ranked = rankSuspects(findSuspects(collect([paired], config)), collect([paired], config));
  assert.equal(ranked.length, 6);
});

// N5: few records: shrunk toward the output's own figure, five records' worth.
test('N5: evidence from few records is shrunk toward the output\'s figure', () => {
  const R = run([runA]);
  const late3 = R.suspects.find(s => s.id === 'T3');
  // No other record states late at 0.50-0.59: q is the output's curve itself.
  assert.equal(late3.evidence.of, 0);
  assert.equal(late3.evidence.q, late3.evidence.curve);
  // No other record's key lists fraud: f1 is the output's share, 2/17; the weight (107/117) / (2/17).
  close(R.suspects.find(s => s.id === 'T10').weight, (107 / 117) / (2 / 17));
  const { SMOOTH } = require('../src/metrics/suspects.js');
  assert.equal(SMOOTH, 5);
});

// N6: a calibration curve that dips is made non-decreasing.
test('N6: pool adjacent violators: a dip pools with its neighbour, weighted by records', () => {
  const { monotone } = require('../src/metrics/suspects.js');
  assert.deepEqual(monotone([0.25, 5 / 6, 3 / 4], [1, 2, 9]).map(x => Number(x.toFixed(6))), [0.25, 0.765152, 0.765152]);
  assert.deepEqual(monotone([0.1, 0.2, 0.3], [5, 5, 5]), [0.1, 0.2, 0.3]);
  assert.deepEqual(monotone([0.9, 0.5, 0.1], [1, 1, 2]).map(x => Number(x.toFixed(6))), [0.4, 0.4, 0.4]);
  // In the fixture, 0.80-0.89 (5/6) above 0.90 or more (3/4) pools to 101/132: T7 and T5 read it.
  close(run([runA]).suspects.find(s => s.id === 'T7').evidence.curve, 101 / 132);
});

// N7: ties: the runs' stronger answer first, then the answer key's record order.
test('N7: ties break by the strength of the runs\' answer, then the key\'s record order', () => {
  const { suspectsOf } = require('../src/metrics/suspects.js');
  const { config: cfg } = validateConfig({ outputs: { tags: { type: 'set' } }, routing: { field: 'route', map: { GO: 'auto' } } });
  const rec = (id, conf) => ({ id, route: 'GO', route_class: 'auto', scored: true, pred: { tags: [{ value: 'a', confidence: conf, applied: true, inherited: false }] }, key: { tags: [] } });
  // Four records whose key lacks "a", all at 0.90 or more, past the bin's middle where the curve
  // is flat: every weight is the same (each sees 3 others, none listed), so only the ties decide.
  const R = suspectsOf([[rec('Z1', 0.96), rec('Z2', 0.99), rec('Z3', 0.99), rec('Z4', 0.96)]], cfg);
  assert.ok(R.every(s => s.weight === R[0].weight));
  assert.deepEqual(R.map(s => s.id), ['Z2', 'Z3', 'Z1', 'Z4']);
});

// N8: what is never a suspect.
test('N8: inherited, invented, any_of, suppressed, failed and declined entries are never suspects', () => {
  const R = run([runA]);
  const ids = R.suspects.map(s => s.id + ' ' + s.output + ' ' + s.value);
  for (const not of ['T4 tags damaged', 'T9 tags misc', 'T11 tags wrong-item', 'T11 tags damaged', 'T12 tags refund', 'T12 tags late',
    'T13 tags refund', 'T9 category unsure', 'T11 category shipping']) assert.ok(!ids.includes(not), not + ' is listed');
  // A suppressed duplicate and a failed call give no evidence: 11 records count, not 13.
  const { collect } = require('../src/metrics/suspects.js');
  const c = collect([scoreRun({ config, predPath: runA, keyPath }).paired], config);
  assert.equal(c.sets.tags.records, 11);
  assert.equal(c.labels.category.size, 9);
});

// N18: a value stated with no confidence (a rule's output) counts as 1.
test('N18: no confidence counts as 1, and the report says "no confidence" in both places', () => {
  const R = run([runA]);
  const t5 = R.suspects.find(s => s.id === 'T5');
  assert.equal(t5.average_confidence, 1);
  assert.equal(t5.said.confidence, null);
  const out = flat(render(R));
  assert.match(out, /T5 tags lacks damaged says it \(no confidence\)/);
  assert.match(out, /Stated with no confidence, which counts as 1\. On other records where this workflow says damaged at 0\.90 or more/);
});

// ---------- the report ----------

test('N19: the terminal report: one row and a why line each, estimates with their sources, in 100 columns, with the rule to make', () => {
  const raw = render(run([runA]));
  assert.deepEqual(wide(raw, dir), []);
  const out = flat(raw);
  assert.match(out, /6 suspects: 3 values the answer key may be missing, 2 values it may list wrongly, 1 label it may/);
  assert.match(out, /1 T8 category says billing says shipping \(0\.95\)/);
  // A curve value is an estimate: the line gives the counts first, then what the tool reads them as,
  // saying when there are too few records for the reading to look like the count (6 of 6 is "about 93%").
  assert.match(out, /Where this workflow gives a category label at about this level on other records, the answer key agreed on 6 of 6 at 0\.90 or more; with so few records, the tool reads that as about 93%\. Rule: replace \(with shipping\) or keep\./);
  assert.match(out, /This workflow leaves late out on 0 of the 3 other records whose answer key lists it, and on 6 of the 7 whose key lacks it\. Rule: remove or keep\./);
  assert.match(out, /No other record's answer key lists fraud; this workflow leaves it out on 10 of the 10 records whose key lacks it\./);
  assert.match(out, /On other records where this workflow says refund at 0\.90 or more, the answer key lists it 4 of 4 times\. For tags values said at about that level, it listed 9 of 11 at 0\.80 or more; with so few records, the tool reads that as about 77%\. Rule: add or reject\./);
  assert.match(out, /This workflow says late at 0\.50-0\.59 on no other record\. For tags values said at about that level, the answer key listed 2 of 30 never stated and 9 of 12 at 0\.80 or more; reading between them, the tool puts it at about 49%\./);
  assert.doesNotMatch(out, /estimated from|about \d+% of the time/);
  assert.doesNotMatch(out, /never says it \d+ of/);
  assert.match(out, /3 T10 tags lists fraud does not say it/);
  assert.match(out, /6 T3 tags lacks late says it, not applied \(0\.55\)/);
  assert.match(out, /How they are ranked/);
  assert.match(out, /warn \[N15\]/);
  const t3 = run([runA]).suspects.find(s => s.id === 'T3');
  assert.deepEqual(t3.evidence.curve_from, [{ where: 'never stated', agree: 2, of: 30 }, { where: 'at 0.80 or more', agree: 9, of: 12 }]);
});

test('the terminal report with several runs speaks of averages; --top shortens the list, the JSON keeps all', () => {
  const R = run([runA, runB]);
  const raw = render(R, 2);
  const out = flat(raw);
  assert.match(out, /2 runs against/);
  assert.match(out, /1 T10 tags lists fraud none of 2 says it/);
  assert.match(out, /No other record's answer key lists fraud; the runs leave it out on 10 of the 10 records whose key lacks it\./);
  assert.match(out, /2 T8 category says billing 1 of 2 say shipping \(0\.95\)/);
  // The number each suspect is ranked on, the average over the runs, is printed.
  assert.match(out, /Average 0\.48 over 2 runs, counting 0 for the run that gives another label\. Where the runs give a category label about this average on other records, the answer key agreed on 2 of 2 at 0\.80-0\.89; with so few records, the tool reads that as about 83%\./);
  assert.deepEqual(wide(raw, dir), []);
  const all = flat(render(R, 6));
  assert.match(all, /T7 tags lacks refund 1 of 2 say it \(0\.95\) Average 0\.48 over 2 runs, counting 0 for the run that does not say it\./);
  assert.match(all, /T3 tags lacks late 1 of 2 say it, 0 applied \(0\.55\) Average 0\.28 over 2 runs, counting 0 for the run that does not say it\./);
  assert.match(all, /T5 tags lacks damaged 2 of 2 say it \(no confidence\) Stated with no confidence, which counts as 1\. Average 1\.00 over 2 runs\./);
  // With one run the average is the run's own confidence, already in the run column.
  assert.doesNotMatch(flat(render(run([runA]))), /Average \d/);
  assert.doesNotMatch(out, /T8 +tags +lists late/);
  assert.match(out, /\+4 more \(all in --json; --top 6 lists them all here\)/);
  assert.match(out, /averaged over the runs, 0 where a run does not say it/);
  const { resultsJson } = require('../src/report/json.js');
  assert.equal(resultsJson(R).suspects.length, 6);
  assert.equal(resultsJson(R).kind, 'suspects');
});

test('no suspect at all', () => {
  const t = tmp('pred.json');
  const rows = JSON.parse(fs.readFileSync(keyPath, 'utf8')).map(k => ({ id: k.id, route: 'SEND',
    tags: k.tags.map(v => (typeof v === 'string' ? { value: v, confidence: 0.9 } : { value: v.any_of[0], confidence: 0.9 })), category: k.category, category_confidence: 0.9 }));
  fs.writeFileSync(t.file, JSON.stringify(rows));
  const R = run([t.file]);
  t.done();
  assert.equal(R.counts.total, 0);
  assert.match(render(R), /No suspect: the run agrees with every entry of the answer key\./);
});

// ---------- N1, N2: runs and options ----------

test('N1: no run, or --top that is not a whole number of 1 or more, stops (exit 1) before any file is read', () => {
  assert.throws(() => run([]), /\[N1\].*one or more runs/);
  for (const top of ['0', '2.5', 'ten', '-3']) {
    const r = cli(['suspects', '--config', 'no-such-config.json', '--key', keyPath, runA, '--top=' + top]);
    assert.equal(r.status, 1, top);
    assert.match(r.stderr, /\[N1\] --top must be a whole number of 1 or more/);
  }
  const none = cli(['suspects', '--config', f('config.json'), '--key', keyPath]);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /\[N1\]/);
  assert.equal(cli(['suspects', '--config', f('config.json'), '--key', keyPath, runA, '--bogus']).status, 2);
});

test('N2: the same run twice is read once, and the report says so', () => {
  const t = tmp('copy.json', fs.readFileSync(runA, 'utf8'));
  const R = run([runA, t.file]);
  t.done();
  assert.equal(R.runs, 1);
  assert.deepEqual(R.inputs.runs, [runA]);
  const fix = R.problems.find(p => p.trap === 'N2');
  assert.equal(fix.level, 'fix');
  assert.match(fix.message, /same content as .*run-a\.json: read once/);
  assert.deepEqual(R.suspects.map(s => s.weight), run([runA]).suspects.map(s => s.weight));
});

// N15: a run where model calls failed: those records give no evidence from it.
test('N15: failed model calls are warned about, by run', () => {
  const R = run([runA, runB]);
  assert.deepEqual(R.problems.filter(p => p.trap === 'N15').map(p => [p.level, path.basename(p.where)]), [['warn', 'run-a.json'], ['warn', 'run-b.json']]);
  assert.match(R.problems[0].message, /1 model call\(s\) failed .*T13/);
});

// ---------- rulings: the new verbs ----------

test('N14: ruled suspects are never listed again; changes are made before suspects are found; pending ones show their status', () => {
  const R = run([runA], { rulings: loadRulings(f('rulings.json')) });
  assert.deepEqual(R.suspects.map(s => [s.id, s.value, s.ruling, s.by, s.on, s.note]), [['T5', 'damaged', 'pending', 'DH', '2026-11-01', 'ask the support lead']]);
  close(R.suspects[0].weight, 17 / 7);
  assert.equal(R.rulings.not_listed, 2);
  assert.deepEqual(R.rulings.added.map(x => x.id + ' ' + x.value), ['T7 refund']);
  assert.deepEqual(R.rulings.removed.map(x => x.id + ' ' + x.value), ['T10 fraud']);
  assert.deepEqual(R.rulings.replaced.map(x => [x.id, x.value, x.with]), [['T8', 'billing', 'shipping']]);
  assert.deepEqual(R.rulings.kept.map(x => x.id + ' ' + x.value), ['T8 late']);
  assert.deepEqual(R.rulings.rejected.map(x => x.id + ' ' + x.value), ['T3 late']);
  assert.equal(R.inputs.rulings, f('rulings.json'));
  const out = render(R);
  // Where the wrapped lines break depends on how long the folder's path is: any space may be a break.
  assert.match(out, /RULINGS {2}Changed in the answer key by rulings in\s+\S*rulings\.json:\s+1\s+value\s+added:\s+T7\s+tags\s+refund;\s+1\s+value\s+removed:\s+T10\s+tags\s+fraud;\s+1\s+label\s+replaced:\s+T8\s+category\s+billing\s+with\s+shipping\./);
  assert.deepEqual(wide(out, dir), []);
  assert.match(out, /Also in the file: 1 ruled not a gap, 1 kept as the answer key has it, 1 pending/);
  assert.match(flat(out), /\[pending \(DH, 2026-11-01\)\] Stated with no confidence, which counts as 1\. On other records where this workflow says damaged/);
  assert.match(out, /2 more were ruled in\s+\S*rulings\.json\s+\(add,\s+reject,\s+remove,\s+keep\s+or\s+replace\):\s+not\s+listed\s+again\./);
});

test('N14: score applies remove and replace like add: the key file is never changed, and the report names every change', () => {
  const before = fs.readFileSync(keyPath, 'utf8');
  const R = scoreRun({ config, predPath: runA, keyPath, rulings: loadRulings(f('rulings.json')) });
  assert.equal(fs.readFileSync(keyPath, 'utf8'), before);
  const se = R.routing.silent_errors.rate;
  assert.deepEqual([se.n, se.d], [3, 9]);
  assert.deepEqual(R.routing.silent_errors.records.map(x => x.id), ['T5', 'T8', 'T11']);
  assert.deepEqual([R.routing.review_queue.precision.n, R.routing.review_queue.precision.d], [2, 3]);
  const k = id => R.paired.find(x => x.id === id).key;
  assert.deepEqual(k('T7').tags, ['damaged', 'refund']);
  assert.deepEqual(k('T10').tags, []);
  assert.equal(k('T8').category, 'shipping');
  const b = R.rulings.if_pending_added;
  assert.deepEqual([b.pending, b.silent_errors.n, b.silent_errors.d, b.not_one_way], [1, 2, 9, undefined]);
  const { renderTerminal } = require('../src/report/terminal.js');
  assert.match(renderTerminal(R), /If the 1 pending ruling were added to the answer key: 22\.2% \(2 of 9/);
  // The paired key of an any_of slot loses only the removed alternative.
  const { applyToKey } = require('../src/rulings.js');
  const [r] = applyToKey([{ id: 'X', key: { tags: ['a', { any_of: ['b', 'c'] }, { any_of: ['d'] }] } }],
    { added: [], removed: [{ id: 'X', output: 'tags', value: 'c' }, { id: 'X', output: 'tags', value: 'd' }], replaced: [] });
  assert.deepEqual(r.key.tags, ['a', { any_of: ['b'] }]);
});

test('N13: pending removes and replaces: scored as the key stands and as proposed; a bracket when every way of ruling them lands between', () => {
  const R = scoreRun({ config, predPath: runA, keyPath, rulings: loadRulings(f('rulings-pending.json')) });
  const se = R.routing.silent_errors.rate;
  assert.deepEqual([se.n, se.d], [4, 9]);
  const b = R.rulings.if_pending_added;
  assert.deepEqual([b.pending, b.silent_errors.n, b.silent_errors.d, b.silent_errors.low_pct, b.silent_errors.high_pct], [3, 5, 9, 26.7, 81.1]);
  // T6's remove takes away a value run-a applied: it turns a right answer wrong. Named, but the
  // two figures are still the lowest and highest: T6 is the only record whose outcome can move
  // (T8 misses late whatever its label, T10 went to a person).
  assert.deepEqual(b.not_one_way, [{ id: 'T6', output: 'tags', value: 'late', proposed: 'remove' }]);
  assert.deepEqual([b.cleared, b.became], [[], ['T6']]);
  assert.equal(b.however_ruled, undefined);
  const { renderTerminal } = require('../src/report/terminal.js');
  const out = flat(renderTerminal(R));
  assert.match(out, /If the 3 pending rulings were all made as proposed \(added, removed or replaced\): 55\.6% \(5 of 9, likely 26\.7-81\.1%\), against 44\.4% as the answer key stands\. However they are ruled, the rate lands between the two\./);
  // A pending add of refund on T7 (run-a applied it: clears T7) beside a pending remove of damaged
  // (run-a applied it too: makes T7 wrong again). As proposed T7 stays wrong; added and kept, it is
  // right: 3 of 9, below both figures.
  const t = tmp('r.json', { rulings: [
    { id: 'T7', output: 'tags', value: 'refund', ruling: 'pending', by: 'DH', on: '2026-11-01' },
    { id: 'T7', output: 'tags', value: 'damaged', ruling: 'pending', proposed: 'remove', by: 'DH', on: '2026-11-01' },
  ] });
  const B = scoreRun({ config, predPath: runA, keyPath, rulings: loadRulings(t.file) });
  t.done();
  const c = B.rulings.if_pending_added;
  assert.deepEqual([B.routing.silent_errors.rate.n, c.silent_errors.n, c.however_ruled.lowest.n, c.however_ruled.highest.n, c.however_ruled.exact], [4, 4, 3, 4, true]);
  assert.match(flat(renderTerminal(B)), /against 44\.4% as the answer key stands\. The two are not a bracket: ruled other ways, it could be anywhere from 33\.3% \(3 of 9\) to 44\.4% \(4 of 9\)\./);
});

// rv-sus/e6.js: a label can be ruled with any label, not only kept or replaced as proposed.
test('N13: a label\'s pending ruling: the bracket covers every label a person could rule it to', () => {
  const t = tmp('key.json', [{ id: 'A', tags: ['refund'], category: 'billing' }, { id: 'B', tags: ['refund'], category: 'billing' }]);
  const pred = path.join(t.dir, 'run.json');
  fs.writeFileSync(pred, JSON.stringify([
    { id: 'A', route: 'SEND', tags: [{ value: 'refund', confidence: 0.9 }], category: 'account', category_confidence: 0.9 },
    { id: 'B', route: 'SEND', tags: [{ value: 'refund', confidence: 0.9 }], category: 'billing', category_confidence: 0.9 },
  ]));
  const pending = path.join(t.dir, 'pending.json');
  fs.writeFileSync(pending, JSON.stringify({ rulings: [{ id: 'A', output: 'category', value: 'billing', ruling: 'pending', with: 'shipping', by: 'DH', on: '2026-11-01' }] }));
  const ruled = path.join(t.dir, 'ruled.json');
  fs.writeFileSync(ruled, JSON.stringify({ rulings: [{ id: 'A', output: 'category', value: 'billing', ruling: 'replace', with: 'account', by: 'DH', on: '2026-11-02' }] }));
  const P = scoreRun({ config, predPath: pred, keyPath: t.file, rulings: loadRulings(pending) });
  const Q = scoreRun({ config, predPath: pred, keyPath: t.file, rulings: loadRulings(ruled) });
  t.done();
  const b = P.rulings.if_pending_added;
  // As the key stands and as proposed, A is wrong: 1 of 2 both ways. Ruled "account", it is right.
  assert.deepEqual([P.routing.silent_errors.rate.n, b.silent_errors.n, Q.routing.silent_errors.rate.n], [1, 1, 0]);
  assert.deepEqual([b.however_ruled.lowest.n, b.however_ruled.highest.n], [0, 1]);
  const { renderTerminal } = require('../src/report/terminal.js');
  const out = flat(renderTerminal(P));
  assert.doesNotMatch(out, /lands between the two/);
  assert.match(out, /The two are not a bracket: ruled other ways, it could be anywhere from 0\.0% \(0 of 2\) to 50\.0% \(1 of 2\)\./);
});

// rv-sus/e1.js: a record sent to a person is not in the silent error rate, so nothing ruled on it moves it.
test('N13: pending rulings on a record sent to a person are never "not one-way"', () => {
  const t = tmp('key.json', [
    { id: 'A', tags: ['late'], category: 'shipping' }, { id: 'B', tags: ['refund'], category: 'billing' }, { id: 'C', tags: ['refund'], category: 'billing' },
  ]);
  const pred = path.join(t.dir, 'run.json');
  fs.writeFileSync(pred, JSON.stringify([
    { id: 'A', route: 'HOLD', tags: [{ value: 'late', confidence: 0.9 }], category: 'shipping', category_confidence: 0.9 },
    { id: 'B', route: 'SEND', tags: [{ value: 'refund', confidence: 0.9 }], category: 'billing', category_confidence: 0.9 },
    { id: 'C', route: 'SEND', tags: [{ value: 'late', confidence: 0.9 }], category: 'billing', category_confidence: 0.9 },
  ]));
  const r1 = path.join(t.dir, 'r1.json');
  fs.writeFileSync(r1, JSON.stringify({ rulings: [
    { id: 'A', output: 'tags', value: 'late', ruling: 'pending', proposed: 'remove', by: 'x', on: '2026-11-01' },
    { id: 'A', output: 'category', value: 'shipping', ruling: 'pending', with: 'billing', by: 'x', on: '2026-11-01' },
  ] }));
  // The older kind: a pending add of a value the run did not apply, on the record sent to a person.
  const r2 = path.join(t.dir, 'r2.json');
  fs.writeFileSync(r2, JSON.stringify({ rulings: [{ id: 'A', output: 'tags', value: 'fraud', ruling: 'pending', by: 'x', on: '2026-11-01' }] }));
  const R1 = scoreRun({ config, predPath: pred, keyPath: t.file, rulings: loadRulings(r1) });
  const R2 = scoreRun({ config, predPath: pred, keyPath: t.file, rulings: loadRulings(r2) });
  t.done();
  const { renderTerminal } = require('../src/report/terminal.js');
  assert.deepEqual(R1.rulings.if_pending_added.not_one_way, []);
  assert.equal(R1.rulings.if_pending_added.however_ruled, undefined);
  assert.match(flat(renderTerminal(R1)), /against 50\.0% as the answer key stands\. However they are ruled, the rate lands between the two\./);
  assert.deepEqual(R2.rulings.if_pending_added.not_applied, []);
  assert.match(flat(renderTerminal(R2)), /If the 1 pending ruling were added to the answer key: 50\.0% \(1 of 2, likely 9\.5-90\.5%\), against 50\.0% with it counted wrong\. However it is ruled, the rate lands between the two\./);
});

test('N13: the older pending adds: when the two are not a bracket, the line says how far the rate could go', () => {
  // rulings-unstated: K9's GEO-CA, pending, was not applied by this run: added, it is a miss.
  const rdir = path.join(__dirname, 'fixtures', 'rulings');
  const rcfg = loadConfig(path.join(rdir, 'config.json'));
  const U = scoreRun({ config: rcfg, predPath: path.join(rdir, 'predictions.json'), keyPath: path.join(rdir, 'key.json'),
    rulings: require('../src/rulings.js').loadRulings(path.join(rdir, 'rulings-unstated.json'), rcfg) });
  const b = U.rulings.if_pending_added;
  // K1's add clears K1; K9's add makes K9 a silent error; K5 stays one whatever is ruled.
  assert.deepEqual([b.however_ruled.lowest.n, b.however_ruled.highest.n, b.however_ruled.lowest.d], [3, 5, 7]);
  const { renderTerminal } = require('../src/report/terminal.js');
  assert.match(flat(renderTerminal(U)), /so the two are not a bracket\. Ruled other ways, it could be anywhere from 42\.9% \(3 of 7\) to 71\.4% \(5 of 7\)\./);
});

test('N11: a verb that does not fit the output, "with" or "proposed" where they mean nothing: stop, never guess', () => {
  assert.match(loadError({ rulings: [ruling({ output: 'tags', value: 'late', ruling: 'replace', with: 'refund' })] }), /\[I12\].*replace is for a label output.*remove or keep/);
  assert.match(loadError({ rulings: [ruling({ output: 'category', value: 'billing', ruling: 'add' })] }), /\[I12\].*category is a label output.*replace.*keep or pending; add is for the values of a set output/);
  assert.match(loadError({ rulings: [ruling({ output: 'category', value: 'billing', ruling: 'remove' })] }), /\[I12\].*remove is for the values of a set output/);
  assert.match(loadError({ rulings: [ruling({ output: 'category', value: 'billing', ruling: 'replace' })] }), /\[I12\].*a replace ruling on it needs "with"/);
  assert.match(loadError({ rulings: [ruling({ output: 'category', value: 'billing', ruling: 'pending' })] }), /\[I12\].*a pending ruling on it needs "with"/);
  assert.match(loadError({ rulings: [ruling({ output: 'category', value: 'billing', ruling: 'replace', with: 'Shipping' })] }), /\[I12\].*"with" is "Shipping".*did you mean "shipping"/);
  assert.match(loadError({ rulings: [ruling({ output: 'category', value: 'billing', ruling: 'replace', with: 'billing' })] }), /\[I12\].*replaces "billing" with itself/);
  assert.match(loadError({ rulings: [ruling({ output: 'category', value: 'bill', ruling: 'keep' })] }), /\[I12\].*"value" is "bill", which is not one of category's labels/);
  assert.match(loadError({ rulings: [ruling({ with: 'refund' })] }), /\[I12\].*"with" is for a label output/);
  assert.match(loadError({ rulings: [ruling({ ruling: 'pending', proposed: 'Remove' })] }), /\[I12\].*"proposed" is .*did you mean "remove"/);
  assert.match(loadError({ rulings: [ruling({ ruling: 'pending', proposed: 'drop' })] }), /\[I12\].*must be add .* or remove/);
  assert.match(loadError({ rulings: [ruling({ output: 'category', value: 'billing', ruling: 'pending', with: 'shipping', proposed: 'add' })] }), /\[I12\].*"proposed" goes with a pending ruling on a set value/);
  assert.match(loadError({ rulings: [ruling({ ruling: 'Keep' })] }), /\[I12\].*did you mean "keep"/);
  assert.match(loadError({ rulings: [ruling({ ruling: 'drop' })] }), /\[I12\].*"drop".*add, reject, pending, remove, keep, replace/);
  // One label per record: two rulings on it, whatever their values, stop.
  assert.match(loadError({ rulings: [ruling({ output: 'category', value: 'billing', ruling: 'keep' }), ruling({ output: 'category', value: 'shipping', ruling: 'keep' })] }),
    /\[I12\].*T8 category's label again .*one ruling per label/);
  assert.equal(loadError({ rulings: [ruling(), ruling({ output: 'category', value: 'billing', ruling: 'replace', with: 'shipping' })] }), null);
});

// The file --write-rulings writes, with "pending" changed to a ruling and nothing else (rv-sus's e4):
// a pending's "proposed", or a label pending's "with" under keep, is left over. Dropped, with a note.
test('N11: a leftover "proposed", or a keep\'s leftover "with", is dropped with a note; the verb is still never guessed', () => {
  const t = tmp('w.json', { rulings: [
    { id: 'T8', output: 'category', value: 'billing', ruling: 'keep', with: 'shipping', by: 'DH', on: '2026-11-02' },
    { id: 'T8', output: 'tags', value: 'late', ruling: 'remove', proposed: 'remove', by: 'DH', on: '2026-11-02' },
    { id: 'T10', output: 'tags', value: 'fraud', ruling: 'keep', proposed: 'remove', by: 'DH', on: '2026-11-02' },
    { id: 'T7', output: 'tags', value: 'refund', ruling: 'add', proposed: 'add', by: 'DH', on: '2026-11-02' },
  ] });
  const rl = loadRulings(t.file);
  const R = scoreRun({ config, predPath: runA, keyPath, rulings: rl });
  t.done();
  assert.deepEqual(rl.problems.map(p => p.level + ' ' + p.trap), ['fix N11', 'fix N11', 'fix N11', 'fix N11']);
  assert.match(rl.problems[0].message, /dropped "with": "shipping": a keep ruling leaves the label as the answer key has it/);
  assert.match(rl.problems[1].message, /dropped "proposed": "remove": it goes with pending only; the ruling, remove, says what was decided/);
  assert.ok(rl.list.every(x => x.with === undefined && x.proposed === undefined));
  assert.deepEqual([R.rulings.kept.length, R.rulings.removed.length, R.rulings.added.length, R.rulings.set_aside.length], [2, 1, 1, 0]);
  // Not leftovers the tool writes: "with" on a set value, "proposed" on a label: still stops.
  assert.match(loadError({ rulings: [ruling({ ruling: 'remove', with: 'refund' })] }), /\[I12\].*"with" is for a label output/);
  assert.match(loadError({ rulings: [ruling({ output: 'category', value: 'billing', ruling: 'keep', proposed: 'remove' })] }), /\[I12\].*"proposed" goes with a pending ruling on a set value/);
});

test('N12: a remove, keep or replace that no longer fits the key warns, and is set aside and counted', () => {
  const t = tmp('r.json', { rulings: [
    ruling({ id: 'T7', value: 'refund', ruling: 'remove' }),                       // T7's key lacks refund
    ruling({ id: 'T1', value: 'late', ruling: 'keep' }),                           // T1's key lacks late
    ruling({ id: 'T3', value: 'late', ruling: 'pending', proposed: 'remove' }),    // T3's key lacks late
    ruling({ id: 'T4', output: 'category', value: 'billing', ruling: 'keep' }),    // T4's key says shipping
    ruling({ id: 'T5', output: 'category', value: 'billing', ruling: 'replace', with: 'shipping' }),   // already shipping
    ruling({ id: 'T9', output: 'category', value: 'billing', ruling: 'keep' }),    // T9's key declines
  ] });
  const R = scoreRun({ config, predPath: runA, keyPath, rulings: loadRulings(t.file) });
  t.done();
  assert.deepEqual(R.problems.filter(p => ['N12', 'I14'].includes(p.trap)).map(p => p.level + ' ' + p.trap), ['warn N12', 'warn N12', 'warn N12', 'warn N12', 'warn I14', 'warn N12']);
  assert.match(R.problems.find(p => p.trap === 'N12' && /T4/.test(p.message)).message, /says "shipping", not "billing": the ruling was made on another version of the key/);
  assert.match(R.problems.find(p => p.trap === 'N12' && /T9/.test(p.message)).message, /says to decline/);
  assert.equal(R.rulings.set_aside.length, 6);
  assert.deepEqual([R.rulings.removed, R.rulings.kept, R.rulings.replaced, R.rulings.pending], [[], [], [], []]);
});

test('N14: older rulings files read, score and report exactly as before: no new fields, no new words', () => {
  const C = path.join(__dirname, '..', 'examples', 'compliance-reviewer');
  const cfg = loadConfig(path.join(C, 'config.json'));
  const R = scoreRun({ config: cfg, predPath: path.join(C, 'runs', 'exec-59.harness.json'), keyPath: path.join(C, 'runs', 'exec-56.harness.json'),
    rulings: loadRulings(path.join(C, 'rulings.json'), cfg) });
  assert.deepEqual(Object.keys(R.rulings), ['file', 'added', 'rejected', 'pending', 'set_aside', 'if_pending_added']);
  const { renderTerminal } = require('../src/report/terminal.js');
  assert.match(renderTerminal(R), /RULINGS {2}9 values added to the answer key by rulings in/);
});

// N16: routes are out of scope.
test('N16: a label output that is the route is never a suspect, and a ruling on it stops', () => {
  const cdir = path.join(__dirname, 'fixtures', 'compliance');
  const cfg = loadConfig(path.join(cdir, 'config.json'));
  const R = require('../src/suspects.js').suspectsRun({ config: cfg, keyPath: path.join(cdir, 'key.csv'), predPaths: [path.join(cdir, 'predictions.csv')] });
  assert.ok(R.suspects.every(s => s.output !== 'verdict'));
  assert.ok(R.suspects.length > 0);
  const t = tmp('r.json', { rulings: [{ id: 'D2', output: 'verdict', value: 'fail', ruling: 'keep', by: 'DH', on: '2026-11-01' }] });
  assert.throws(() => loadRulings(t.file, cfg), /\[I12\].*verdict is the route \(routing\.field\)/);
  t.done();
});

// ---------- N9, N10: --write-rulings ----------

test('N9: --write-rulings never writes over an existing file (exit 1, before anything is scored)', () => {
  const t = tmp('existing.json', '{ "rulings": [] }');
  const r = cli(['suspects', '--config', f('config.json'), '--key', keyPath, runA, '--write-rulings', t.file]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\[N9\] --write-rulings writes a new file, and .*existing\.json already exists/);
  assert.equal(r.stdout, '');
  assert.equal(fs.readFileSync(t.file, 'utf8'), '{ "rulings": [] }');
  t.done();
});

test('N10: --write-rulings writes the listed suspects as pending, with by and on to fill in; the file reads back', () => {
  const t = tmp('new.json');
  const r = cli(['suspects', '--config', f('config.json'), '--key', keyPath, runA, '--top', '3', '--write-rulings', t.file]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /3 listed suspect\(s\) written as pending\. Fill in "by" and "on"/);
  const written = JSON.parse(fs.readFileSync(t.file, 'utf8')).rulings;
  assert.deepEqual(written, [
    { id: 'T8', output: 'category', value: 'billing', ruling: 'pending', with: 'shipping', by: '', on: '' },
    { id: 'T8', output: 'tags', value: 'late', ruling: 'pending', proposed: 'remove', by: '', on: '' },
    { id: 'T10', output: 'tags', value: 'fraud', ruling: 'pending', proposed: 'remove', by: '', on: '' },
  ]);
  assert.match(flat(r.stderr), /a ruling still pending reads as it is, and a decided one without "by" and "on" stops in strict mode \(trap I13\)\./);
  // Pending, they read as they are, in strict mode too (I13 is for decided rulings).
  const R = run([runA], { rulings: loadRulings(t.file) });
  assert.deepEqual(R.problems.filter(p => p.trap === 'I13'), []);
  assert.deepEqual(R.suspects.slice(0, 3).map(s => s.ruling), ['pending', 'pending', 'pending']);
  assert.deepEqual(R.suspects.slice(3).map(s => s.ruling), ['unruled', 'unruled', 'unruled']);
  // Decided without by and on, strict mode stops; with --lenient it warns and reads.
  const decided = JSON.parse(fs.readFileSync(t.file, 'utf8'));
  decided.rulings[1].ruling = 'keep';
  delete decided.rulings[1].proposed;
  fs.writeFileSync(t.file, JSON.stringify(decided));
  assert.throws(() => loadRulings(t.file), /\[I13\].*T8 tags late has no "by"/);
  assert.equal(loadRulings(t.file, config, 'lenient').problems.filter(p => p.trap === 'I13').length, 2);
  t.done();
});

test('N10: with --rulings, the new file carries every earlier ruling as written, then the unruled listed suspects', () => {
  const t = tmp('next.json');
  const r = cli(['suspects', '--config', f('config.json'), '--key', keyPath, runA, '--rulings', f('rulings-pending.json'), '--write-rulings', t.file]);
  assert.equal(r.status, 0, r.stderr);
  const written = JSON.parse(fs.readFileSync(t.file, 'utf8')).rulings;
  const earlier = JSON.parse(fs.readFileSync(f('rulings-pending.json'), 'utf8')).rulings;
  assert.deepEqual(written.slice(0, 3), earlier);
  assert.deepEqual(written.slice(3).map(x => x.id + ' ' + x.value + ' ' + x.ruling), ['T8 late pending', 'T7 refund pending', 'T5 damaged pending', 'T3 late pending']);
  assert.match(r.stderr, /4 listed suspect\(s\) written as pending, after the 3 ruling\(s\) of/);
  t.done();
  // Nothing new to write: no file.
  const n = tmp('none.json');
  const s = cli(['suspects', '--config', f('config.json'), '--key', keyPath, runA, '--rulings', f('rulings.json'), '--write-rulings', n.file]);
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stderr, /nothing written to .*every listed suspect already has a ruling/);
  assert.equal(fs.existsSync(n.file), false);
  n.done();
});

// rv-sus/e2.js: rulings made on another version of the key are set aside (N12); the written file
// must not hold a second ruling on the same entry, or it would not load back (I12).
test('N10: a ruling set aside shows as set aside, and --write-rulings puts the pending ruling in its place', () => {
  const t = tmp('rulings.json', { rulings: [
    { id: 'T7', output: 'tags', value: 'refund', ruling: 'remove', by: 'DH', on: '2026-11-01' },
    { id: 'T8', output: 'category', value: 'shipping', ruling: 'replace', with: 'account', by: 'DH', on: '2026-11-01' },
  ] });
  const R = run([runA], { rulings: loadRulings(t.file) });
  const t7 = R.suspects.find(s => s.id === 'T7');
  const t8 = R.suspects.find(s => s.kind === 'label');
  assert.deepEqual([t7.ruling, t7.set_aside, t8.ruling, t8.set_aside], ['set aside', { ruling: 'remove', why: 'not in the answer key' },
    'set aside', { ruling: 'replace', why: 'the answer key no longer says this label' }]);
  assert.match(flat(render(R)), /\[ruled remove \(DH, 2026-11-01\), set aside: not in the answer key\] On other records where this workflow says refund/);
  const out = path.join(t.dir, 'new rulings.json');
  const r = cli(['suspects', '--config', f('config.json'), '--key', keyPath, runA, '--rulings', t.file, '--write-rulings', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /6 listed suspect\(s\) written as pending \(2 in place of rulings set aside\)/);
  const written = JSON.parse(fs.readFileSync(out, 'utf8')).rulings;
  assert.deepEqual(written.slice(0, 2), [
    { id: 'T7', output: 'tags', value: 'refund', ruling: 'pending', by: '', on: '', note: 'in place of a remove ruling (DH, 2026-11-01) set aside: not in the answer key' },
    { id: 'T8', output: 'category', value: 'billing', ruling: 'pending', with: 'shipping', by: '', on: '', note: 'in place of a replace ruling (DH, 2026-11-01) set aside: the answer key no longer says this label' },
  ]);
  assert.equal(written.length, 6);
  // It loads back (lenient, as by and on are still empty) with no ruling twice.
  const back = loadRulings(out, config, 'lenient');
  assert.equal(back.list.length, 6);
  t.done();
});

test('N9: --write-rulings into a folder that does not exist, or onto the --json file, stops before anything is scored', () => {
  const t = tmp('x.json');
  const missing = cli(['suspects', '--config', f('config.json'), '--key', keyPath, runA, '--write-rulings', path.join(t.dir, 'no-such-folder', 'r.json')]);
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /\[N9\] --write-rulings: the folder .*no-such-folder does not exist/);
  const same = cli(['suspects', '--config', f('config.json'), '--key', keyPath, runA, '--json', t.file, '--write-rulings', t.file]);
  assert.equal(same.status, 1);
  assert.equal(same.stdout, '');
  assert.match(same.stderr, /\[N9\] --write-rulings and --json name the same file/);
  assert.equal(fs.existsSync(t.file), false);
  t.done();
});

test('N19: every line of the terminal report fits 100 columns, warnings included', () => {
  const r = cli(['suspects', '--config', 'test/fixtures/suspects/config.json', '--key', 'test/fixtures/suspects/key.json',
    'test/fixtures/suspects/run-a.json', 'test/fixtures/suspects/run-b.json', '--rulings', 'test/fixtures/suspects/rulings-pending.json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(wide(r.stdout), []);
  assert.match(flat(r.stdout), /warn \[N15\] test\/fixtures\/suspects\/run-a\.json: 1 model call\(s\) failed in this run; those records give no evidence from it: T13/);
  // Each note starts at two spaces; its later lines sit under it at four.
  assert.match(r.stdout, /^ {2}warn \[N15\] test\/fixtures\/suspects\/run-a\.json: 1 model call\(s\) failed in this run; those records\n {4}give no evidence/m);
});

// N4: a copied key entry must not vouch for its copy.
test('N4: with duplicates or clusters in the config, a suspect\'s whole duplicate group or cluster is left out of its evidence', () => {
  // T14 retells T7: the same answer key and the same answers.
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const pred = JSON.parse(fs.readFileSync(runA, 'utf8'));
  const t = tmp('key.json', [...key.map(k => (k.id === 'T7' ? { ...k, story: 's7' } : k)), { ...key.find(k => k.id === 'T7'), id: 'T14', story: 's7', duplicate_of: 'T7' }]);
  const p = path.join(t.dir, 'run.json');
  fs.writeFileSync(p, JSON.stringify([...pred, { ...pred.find(x => x.id === 'T7'), id: 'T14' }]));
  const cfg = extra => validateConfig({ ...JSON.parse(fs.readFileSync(f('config.json'), 'utf8')), ...extra }).config;
  const weight = (c, id) => require('../src/suspects.js').suspectsRun({ config: c, keyPath: t.file, predPaths: [p] }).suspects.find(s => s.id === id && s.value === 'refund').weight;
  // Read as independent, T14 vouches against T7 (and T7 against T14): 6.66 falls to 3.22.
  close(weight(cfg({}), 'T7'), 3.2230, 1e-3);
  // Its cluster, or its duplicate group, left out: exactly T7's weight without T14, 1033/155.
  close(weight(cfg({ clusters: { field: 'story' } }), 'T7'), 1033 / 155);
  close(weight(cfg({ clusters: { field: 'story' } }), 'T14'), 1033 / 155);
  close(weight(cfg({ duplicate_of_field: 'duplicate_of' }), 'T7'), 1033 / 155);
  t.done();
});

// ---------- from a newcomer's run and the integration review ----------

// N8: a record the answer key blocks or suppresses as a duplicate cannot go out, so its values change
// no routing figure: its tags and labels are noise at the top of the list.
test('N8: records the answer key blocks or suppresses are left out, as suspects and as evidence, and the report says how many', () => {
  const cfg = validateConfig({ ...JSON.parse(fs.readFileSync(f('config.json'), 'utf8')),
    routing: { field: 'route', gold_field: 'expected_route', map: { SEND: 'auto', HOLD: 'review', DUP: 'exclude', SPAM: 'block' } } }).config;
  const pred = JSON.parse(fs.readFileSync(runA, 'utf8'));
  const routeOf = new Map(pred.map(r => [r.id, r.route]));
  // T10 (the key lists fraud) is spam to the key; T7 (the key lacks refund) a duplicate.
  const gold = id => (id === 'T10' ? 'SPAM' : id === 'T7' ? 'DUP' : routeOf.get(id));
  const t = tmp('key.json', JSON.parse(fs.readFileSync(keyPath, 'utf8')).map(k => ({ ...k, expected_route: gold(k.id) })));
  const R = require('../src/suspects.js').suspectsRun({ config: cfg, keyPath: t.file, predPaths: [runA] });
  t.done();
  const ids = R.suspects.map(s => s.id + ' ' + s.value);
  assert.ok(!ids.includes('T10 fraud') && !ids.includes('T7 refund'), ids.join(', '));
  assert.ok(ids.includes('T8 late') && ids.includes('T5 damaged'));
  // T12, which the run suppresses too and the key calls a duplicate, is the third.
  assert.equal(R.key_leaves_out, 3);
  assert.match(flat(render(R)), /3 records the answer key blocks or suppresses as duplicates are left out, as suspects and as evidence: whatever their values, they change no routing rate \(only output quality counts them\)\./);
  // As evidence too: T7 no longer counts among the records whose key lacks refund.
  const t5 = R.suspects.find(s => s.id === 'T5');
  const t5Before = run([runA]).suspects.find(s => s.id === 'T5');
  assert.notDeepEqual(t5.evidence, t5Before.evidence);
  // Where values decide (any_mismatch), a blocked record's values count: nothing is left out.
  const any = validateConfig({ ...JSON.parse(fs.readFileSync(f('config.json'), 'utf8')), wrong_when: 'any_mismatch',
    routing: { field: 'route', gold_field: 'expected_route', map: { SEND: 'auto', HOLD: 'review', DUP: 'exclude', SPAM: 'block' } } }).config;
  const t2 = tmp('key.json', JSON.parse(fs.readFileSync(keyPath, 'utf8')).map(k => ({ ...k, expected_route: gold(k.id) })));
  const A = require('../src/suspects.js').suspectsRun({ config: any, keyPath: t2.file, predPaths: [runA] });
  t2.done();
  assert.equal(A.key_leaves_out, undefined);
  assert.ok(A.suspects.some(s => s.id === 'T10' && s.value === 'fraud'));
  // Without a correct route in the key, nothing is left out, and nothing is said.
  assert.equal(run([runA]).key_leaves_out, undefined);
  assert.doesNotMatch(flat(render(run([runA]))), /blocks or suppresses/);
});

// I14: a plain pending ruling asks whether to add; on a value the key lists, the warning says how to ask the other question.
test('I14: a pending ruling on a value the key lists, without "proposed", says to add "proposed": "remove"', () => {
  const t = tmp('r.json', { rulings: [ruling({ id: 'T8', value: 'late', ruling: 'pending' })] });
  const R = scoreRun({ config, predPath: runA, keyPath, rulings: loadRulings(t.file) });
  t.done();
  const w = R.problems.find(p => p.trap === 'I14');
  assert.match(w.message, /T8 tags late is already in the answer key: as a possible gap there is nothing left to decide; to ask whether the key holds it wrongly, give the pending ruling "proposed": "remove"\. The ruling is set aside/);
});

// I13: a pending ruling is a question, not a decision: it needs no by or on. A decision still does.
test('I13: by and on are required for decided rulings only; a pending one without them reads in strict mode', () => {
  const t = tmp('r.json', { rulings: [
    { id: 'T8', output: 'tags', value: 'late', ruling: 'pending', proposed: 'remove', by: '', on: '' },
    { id: 'T7', output: 'tags', value: 'refund', ruling: 'pending' },
    { id: 'T8', output: 'category', value: 'billing', ruling: 'pending', with: 'shipping' },
  ] });
  const rl = loadRulings(t.file);
  t.done();
  assert.deepEqual(rl.problems, []);
  assert.deepEqual(rl.list.map(x => [x.by, x.on]), [[null, null], [null, null], [null, null]]);
  for (const verb of ['add', 'reject', 'remove', 'keep']) {
    const v = verb === 'add' || verb === 'reject' ? 'refund' : 'late';
    assert.match(loadError({ rulings: [{ id: verb === 'add' || verb === 'reject' ? 'T7' : 'T8', output: 'tags', value: v, ruling: verb }] }), /\[I13\].*has no "by"/, verb);
  }
  assert.match(loadError({ rulings: [{ id: 'T8', output: 'category', value: 'billing', ruling: 'replace', with: 'shipping', by: 'DH' }] }), /\[I13\].*has no "on"/);
});

test('N11: a label or ordinal output\'s stop names it with the right article', () => {
  const odir = path.join(__dirname, 'fixtures', 'ordinal');
  const ocfg = loadConfig(path.join(odir, 'config.json'));
  assert.match(loadError({ rulings: [{ id: 'C2', output: 'band', value: '5', ruling: 'add', by: 'DH', on: '2026-11-02' }] }, ocfg),
    /\[I12\].*band is an ordinal output: its rulings are replace/);
  assert.match(loadError({ rulings: [ruling({ output: 'category', value: 'billing', ruling: 'add' })] }), /\[I12\].*category is a label output/);
});

test('N19: "no suspect left to rule on", with several runs, fits 100 columns', () => {
  const t = tmp('r.json', { rulings: [
    { id: 'T8', output: 'category', value: 'billing', ruling: 'keep', by: 'DH', on: '2026-11-02' },
    { id: 'T8', output: 'tags', value: 'late', ruling: 'keep', by: 'DH', on: '2026-11-02' },
    { id: 'T10', output: 'tags', value: 'fraud', ruling: 'keep', by: 'DH', on: '2026-11-02' },
    { id: 'T7', output: 'tags', value: 'refund', ruling: 'reject', by: 'DH', on: '2026-11-02' },
    { id: 'T5', output: 'tags', value: 'damaged', ruling: 'reject', by: 'DH', on: '2026-11-02' },
    { id: 'T3', output: 'tags', value: 'late', ruling: 'reject', by: 'DH', on: '2026-11-02' },
  ] });
  const R = run([runA, runB], { rulings: loadRulings(t.file) });
  t.done();
  const out = render(R);
  assert.match(flat(out), /No suspect left to rule on: the runs agree with every entry of the answer key that has no ruling yet\./);
  assert.deepEqual(wide(out, dir, t.dir), []);
});

// The RULINGS section of score, variance and compare, on every path: the new verbs and the older ones.
test('the RULINGS section of score, variance and compare fits 100 columns', () => {
  const R = 'test/fixtures/rulings';
  for (const args of [
    ['score', '--config', 'test/fixtures/suspects/config.json', '--key', 'test/fixtures/suspects/key.json', '--pred', 'test/fixtures/suspects/run-a.json', '--rulings', 'test/fixtures/suspects/rulings.json'],
    ['score', '--config', R + '/config.json', '--key', R + '/key.json', '--pred', R + '/predictions.json', '--rulings', R + '/rulings.json'],
    ['variance', '--config', R + '/config.json', '--key', R + '/key.json', R + '/predictions.json', R + '/predictions.json', '--rulings', R + '/rulings.json'],
    ['compare', '--config', 'examples/compliance-reviewer/config.json', '--key', 'examples/compliance-reviewer/runs/exec-56.harness.json',
      '--before', 'examples/compliance-reviewer/runs/exec-50.harness.json', '--after', 'examples/compliance-reviewer/runs/exec-56.harness.json', '--rulings', 'examples/compliance-reviewer/rulings.json'],
  ]) {
    const r = cli(args);
    const section = r.stdout.split('\n\n').find(p => p.startsWith('RULINGS'));
    assert.ok(section, args.join(' '));
    assert.deepEqual(section.split('\n').filter(l => l.length > 100), [], args.join(' '));
  }
});

// ---------- the command line and the real example ----------

test('CLI: suspects on the compliance reviewer\'s v1 key: the 25 ruled codes among its suspects; with rulings.json, none of them listed again', () => {
  const C = 'examples/compliance-reviewer';
  const runs = [56, 57, 58, 59].map(n => C + '/runs/exec-' + n + '.harness.json');
  const j = tmp('s.json');
  const r = cli(['suspects', '--config', path.join(C, 'config.json'), '--key', runs[0], ...runs, '--json', j.file]);
  assert.equal(r.status, 0, r.stderr);
  const all = JSON.parse(fs.readFileSync(j.file, 'utf8'));
  assert.equal(all.suspects.length, 39);
  const ruled = JSON.parse(fs.readFileSync(path.join(C, 'rulings.json'), 'utf8')).rulings.map(x => x.id + ' ' + x.value);
  const listed = all.suspects.map(s => s.id + ' ' + s.value);
  assert.ok(ruled.every(x => listed.includes(x)));
  assert.match(r.stdout, /4 runs against/);
  assert.deepEqual(wide(r.stdout), []);
  const w = cli(['suspects', '--config', path.join(C, 'config.json'), '--key', runs[0], ...runs, '--rulings', path.join(C, 'rulings.json'), '--json', j.file]);
  assert.equal(w.status, 0, w.stderr);
  const left = JSON.parse(fs.readFileSync(j.file, 'utf8'));
  j.done();
  assert.ok(left.suspects.every(s => !ruled.includes(s.id + ' ' + s.value)));
  // The 16 rejects, and the 4 adds some run does not apply: ruled, so counted, not listed.
  assert.equal(left.rulings.not_listed, 20);
  assert.equal(left.suspects.length, 39 - 20 - 5);
});
