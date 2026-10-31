// A certified gate (wfeval whatif --gate --target), checked against test/fixtures/gate/EXPECTED.md
// (trap E9: a gate picked from many as if it had been tested alone).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('../src/config.js');
const { scoreRun } = require('../src/score.js');
const { gateSweep } = require('../src/metrics/whatif.js');
const { renderWhatif } = require('../src/report/terminal.js');

const dir = path.join(__dirname, 'fixtures', 'gate');
const config = loadConfig(path.join(dir, 'config.json'));
const pred = path.join(dir, 'predictions.json');
const key = path.join(dir, 'key.json');
const { paired } = scoreRun({ config, predPath: pred, keyPath: key });
const cli = args => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wfeval.js'), ...args], { encoding: 'utf8' });
const base = ['whatif', '--config', path.join(dir, 'config.json'), '--pred', pred, '--key', key];
// p-values to four significant figures, as EXPECTED.md works them out.
const sig = x => Number(x.toPrecision(4));

const W = gateSweep(paired, config, { target: 30 });
const row = t => W.rows.find(r => r.threshold === t);

test('E9: each gate\'s exact binomial p-value at a 30% target, as worked by hand', () => {
  assert.deepEqual(W.rows.map(r => [r.threshold, r.silent_error_rate.n, r.silent_error_rate.d]), [
    [0.5, 24, 60], [0.55, 20, 54], [0.6, 16, 48], [0.65, 12, 42], [0.7, 8, 36], [0.75, 3, 30],
    [0.8, 1, 24], [0.85, 0, 18], [0.9, 0, 12], [0.95, 0, 6], [1, 0, 0],
  ]);
  assert.deepEqual(W.rows.map(r => sig(r.p_value)), [0.9638, 0.8974, 0.7495, 0.4957, 0.2037, 0.009317, 0.002162, 0.001628, 0.01384, 0.1176, 1]);
});

test('E9: Bonferroni over the 11 gates tried: 0.85 and 0.80 certified, 0.80 the loosest', () => {
  const c = W.certification;
  assert.deepEqual([c.target_pct, c.confidence, c.gates_tested], [30, 0.95, 11]);
  assert.equal(sig(c.level), 0.004545);
  assert.deepEqual(W.rows.filter(r => r.certified).map(r => r.threshold), [0.8, 0.85]);
  const b = c.best;
  assert.equal(b.threshold, 0.8);
  assert.deepEqual([b.silent_error_rate.n, b.silent_error_rate.d, b.silent_error_rate.pct], [1, 24, 4.2]);
  assert.deepEqual([b.straight_through.n, b.straight_through.d, b.straight_through.pct], [24, 60, 40]);
  assert.equal(sig(b.p_value), 0.002162);
});

test('E9: the loosest gate that looks under 30% read alone is not certified', () => {
  // By the point rate, 0.65 looks under (28.6%); by the likely range, 0.75 (it reaches 25.6%).
  assert.deepEqual([row(0.65).silent_error_rate.pct, row(0.65).certified], [28.6, false]);
  assert.deepEqual([row(0.75).silent_error_rate.high_pct, row(0.75).certified], [25.6, false]);
  assert.deepEqual(W.certification.looks_under_alone, { threshold: 0.75, high_pct: 25.6, certified: false });
  // A strict gate with no silent errors also fails: 12 records are too few.
  assert.deepEqual([row(0.9).silent_error_rate.high_pct, row(0.9).certified], [24.3, false]);
});

test('E9: a gate with nothing out has p = 1 and is never certified', () => {
  assert.deepEqual([row(1).p_value, row(1).certified], [1, false]);
});

test('E9: the same gate tried beside only the current one is certified (2 gates, p <= 0.025)', () => {
  const two = gateSweep(paired, config, { from: 0.75, to: 0.75, target: 30 });
  assert.deepEqual(two.rows.map(r => [r.threshold, r.certified]), [[0.75, true], [0.8, true]]);
  assert.deepEqual([two.certification.gates_tested, two.certification.level], [2, 0.025]);
  assert.equal(two.certification.best.threshold, 0.75);
});

test('E9: gates that let out the same records tie; the tie goes to the strictest', () => {
  const t = gateSweep(paired, config, { from: 0.78, to: 0.84, step: 0.01, target: 30 });
  assert.equal(t.certification.gates_tested, 7);
  assert.equal(sig(t.certification.level), 0.007143);
  assert.deepEqual(t.rows.filter(r => r.certified).map(r => r.threshold), [0.78, 0.79, 0.8, 0.81, 0.82, 0.83, 0.84]);
  assert.equal(t.certification.best.threshold, 0.82);
});

test('E9: no gate certified under 10%; the least any gate could need is 52 records out, none wrong', () => {
  const c = gateSweep(paired, config, { target: 10 }).certification;
  assert.equal(c.best, null);
  assert.equal(c.least_records_out, 52);
});

test('E9: confidence 0.99 certifies nothing under 30% (least 20); 0.90 certifies the same two gates', () => {
  const strict = gateSweep(paired, config, { target: 30, confidence: 0.99 });
  assert.deepEqual([strict.certification.best, strict.certification.least_records_out], [null, 20]);
  assert.equal(sig(strict.certification.level), 0.0009091);
  const loose = gateSweep(paired, config, { target: 30, confidence: 0.9 });
  assert.deepEqual(loose.rows.filter(r => r.certified).map(r => r.threshold), [0.8, 0.85]);
  assert.equal(W.certification.least_records_out, 16);
});

test('E9: without a target nothing changes: no certified column, no certification', () => {
  const plain = gateSweep(paired, config);
  assert.equal(plain.certification, null);
  assert.ok(plain.rows.every(r => !('certified' in r) && !('p_value' in r)));
  assert.doesNotMatch(renderWhatif(plain), /certified/i);
});

test('E9: bad targets and confidences are refused', () => {
  assert.throws(() => gateSweep(paired, config, { target: 0 }), /--target must be a percentage above 0 and below 100/);
  assert.throws(() => gateSweep(paired, config, { target: 30, confidence: 0.8 }), /--confidence must be 0\.9, 0\.95 or 0\.99/);
});

test('E9: the report: a certified column, the loosest certified gate, the gate that only looks under, and the caveat', () => {
  const text = renderWhatif(W);
  assert.match(text, /silent error rate +certified +moved in/);
  assert.match(text, /^ +0\.80 +24 +40\.0% +G19 +4\.2% \(1\/24\) +yes /m);
  assert.match(text, /^ +0\.75 +30 +50\.0% +G19 G25 G26 +10\.0% \(3\/30\) +G25/m);
  assert.match(text, /CERTIFIED UNDER 30%  at 95% confidence, among 11 gates tried/);
  assert.match(text, /The loosest certified gate is 0\.80: silent error rate 4\.2% \(1 of 24 out without review, likely 0\.7-20\.2%\), straight-through 40\.0% \(24 of 60\)\./);
  assert.match(text, /Gate 0\.75 looks under 30% read alone \(its likely range reaches 25\.6%\), but it was picked from 11 gates: not certified\./);
  assert.match(text, /at most 0\.45% of the time/);
  assert.match(text, /the chance that any certified gate is really at or above 30% is at most 5%/);
  assert.match(text, /holds for records like these/);
  assert.match(text, /stress-test guarantee/);
  assert.match(text, /rests on the assumption above/);
});

test('E9: the report when no gate is certified', () => {
  const text = renderWhatif(gateSweep(paired, config, { target: 10 }));
  assert.match(text, /No gate tried is certified under 10%\. Among 11 gates, a gate needs at least 52 records out without review, with no silent error among them, to be certified \(more if it has any\)\./);
  assert.doesNotMatch(text, /loosest certified/);
});

test('E9: whatif --gate --target on the command line, terminal and JSON; bad options refused', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-gate-')), 'w.json');
  const ok = cli([...base, '--gate', '--target', '30', '--json', out]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /The loosest certified gate is 0\.80/);
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(j.rows.map(r => r.certified), [false, false, false, false, false, false, true, true, false, false, false]);
  assert.deepEqual([j.certification.target_pct, j.certification.confidence, j.certification.gates_tested, j.certification.best.threshold], [30, 0.95, 11, 0.8]);
  fs.rmSync(path.dirname(out), { recursive: true });

  const conf = cli([...base, '--gate', '--target', '30', '--confidence', '0.99']);
  assert.equal(conf.status, 0, conf.stderr);
  assert.match(conf.stdout, /No gate tried is certified under 30%/);
  const refused = [
    [['--gate', '--target', '0'], /--target must be a percentage above 0 and below 100/],
    [['--gate', '--target', '30', '--confidence', '0.8'], /--confidence must be 0\.9, 0\.95 or 0\.99/],
    [['--gate', '--confidence', '0.95'], /--confidence goes with --target <percent>/],
    [['--floor', '--target', '30'], /--target goes with --gate/],
  ];
  for (const [args, message] of refused) {
    const bad = cli([...base, ...args]);
    assert.equal(bad.status, 1, args.join(' '));
    assert.match(bad.stderr, message);
  }
});
