// wfeval monitor: live samples over time. Checked against test/fixtures/monitor/EXPECTED.md,
// and the traps of test/TRAPS.md section L.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('../src/config.js');
const { cusumScores, cusumStep, cusumArl, cusumThreshold, mixtureLogE, mixtureUpper } = require('../src/metrics/monitor.js');
const { monitorRun } = require('../src/monitor.js');
const { renderMonitor } = require('../src/report/monitor.js');

const dir = path.join(__dirname, 'fixtures', 'monitor');
const configPath = path.join(dir, 'config.json');
const config = loadConfig(configPath);
const run = w => path.join(dir, 'runs', '2026-W' + w + '.json');
const csv = path.join(dir, 'counts.csv');
const bin = path.join(__dirname, '..', 'bin', 'wfeval.js');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-monitor-'));
process.on('exit', () => fs.rmSync(tmpDir, { recursive: true, force: true }));
// Each file in a folder of its own, so its name (the period's name) stays as given.
const tmp = (name, text) => { const f = path.join(fs.mkdtempSync(path.join(tmpDir, 'f-')), name); fs.writeFileSync(f, text); return f; };
const countsFile = rows => tmp('counts.json', JSON.stringify(rows));
const week = (w, out, silent) => ({ period: '2026-W' + w, out_without_review: out, silent_errors: silent });
const SETTINGS = { target: 5, acceptable: 2.5 };
const fromCounts = (file, extra = {}) => monitorRun({ countsPath: file, ...SETTINGS, ...extra });
const traps = (m, trap) => m.problems.filter(i => i.trap === trap);
const stops = (fn, re) => assert.throws(fn, re);

// ---------- The arithmetic ----------

test('CUSUM scores: from 2.5% to 5%, a silent error adds 53 steps and a right record takes 2 off', () => {
  const s = cusumScores(0.025, 0.05);
  assert.deepEqual([s.up, s.down], [53, 2]);
  assert.throws(() => cusumScores(0.05, 0.05), /acceptable < alarming/);
});

test('CUSUM step: floored at 0 only at the end of a period', () => {
  const s = cusumScores(0.025, 0.05);
  assert.equal(cusumStep(0, 1, 30, s), 0);        // 53 - 58 = -5, floored
  assert.equal(cusumStep(0, 3, 30, s), 105);      // 159 - 54
  assert.equal(cusumStep(105, 2, 30, s), 155);    // 105 + 106 - 56
  assert.equal(cusumStep(155, 3, 30, s), 260);
});

test('CUSUM alarm level: the smallest whole H with at least the records per false alarm asked for', () => {
  const H = cusumThreshold(0.025, 0.05, 2000, 30);
  assert.equal(H, 156);
  assert.ok(cusumArl(0.025, 0.05, H, 0.025, 30) >= 2000);
  assert.ok(cusumArl(0.025, 0.05, H - 1, 0.025, 30) < 2000);
  assert.equal(Math.round(cusumArl(0.025, 0.05, H, 0.025, 30)), 2065);
  assert.equal(Math.round(cusumArl(0.025, 0.05, H, 0.05, 30)), 219);
  // A check after every record false-alarms more often at the same H: it needs a higher one.
  assert.ok(cusumThreshold(0.025, 0.05, 2000, 1) > H);
});

test('CUSUM chain: agrees with a simulation of the detector itself', () => {
  const H = 156, n = 30, s = cusumScores(0.025, 0.05);
  let seed = 12345;
  const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  for (const p of [0.025, 0.05]) {
    let total = 0;
    const R = 3000;
    for (let i = 0; i < R; i++) {
      let S = 0, t = 0;
      do {
        let y = 0;
        for (let k = 0; k < n; k++) if (rand() < p) y++;
        S = cusumStep(S, y, n, s);
        t++;
      } while (S < H);
      total += t * n;
    }
    const chain = cusumArl(0.025, 0.05, H, p, n);
    assert.ok(Math.abs(total / R / chain - 1) < 0.06, 'rate ' + p + ': simulated ' + total / R + ', chain ' + chain);
  }
});

test('mixture: the closed form equals the integral it stands for', () => {
  for (const [S, F, t] of [[3, 200, 0.05], [0, 40, 0.05], [12, 300, 0.1], [1, 0, 0.05]]) {
    let sum = 0;
    const N = 200000;
    for (let i = 0; i < N; i++) { const x = (i + 0.5) / N; sum += Math.exp(S * Math.log(x) + F * Math.log((1 - t * x) / (1 - t))); }
    assert.ok(Math.abs(mixtureLogE(S, F, t) - Math.log(sum / N)) < 1e-6, S + ' ' + F + ' ' + t);
  }
  assert.equal(mixtureLogE(0, 0, 0.05), 0);   // nothing checked: no evidence, E = 1
});

test('mixture: with no silent error, 88 records show under 5% (E 20.30), 87 do not (E 19.49)', () => {
  // EXPECTED.md: E = (1 - 0.95^(F+1)) / (0.05 (F+1) 0.95^F) with no silent error.
  const byHand = F => (1 - 0.95 ** (F + 1)) / (0.05 * (F + 1) * 0.95 ** F);
  for (const F of [60, 87, 88, 90]) assert.ok(Math.abs(Math.exp(mixtureLogE(0, F, 0.05)) - byHand(F)) < 1e-9);
  assert.equal(Number(Math.exp(mixtureLogE(0, 87, 0.05)).toFixed(2)), 19.49);
  assert.equal(Number(Math.exp(mixtureLogE(0, 88, 0.05)).toFixed(2)), 20.3);
  assert.ok(mixtureUpper(0, 88) < 0.05 && mixtureUpper(0, 87) > 0.05);
});

test('mixture: the evidence rises with the rate tested, so every rate above the bound is ruled out too', () => {
  for (const [S, F] of [[3, 197], [0, 50], [20, 400]]) {
    let prev = -Infinity;
    for (let p = (S + 0.5) / (S + F); p < 0.6; p += 0.001) {
      const v = mixtureLogE(S, F, p);
      assert.ok(v >= prev - 1e-12, S + '/' + F + ' at ' + p);
      prev = v;
    }
  }
});

// ---------- The fixture, period by period (EXPECTED.md) ----------

const M = fromCounts(csv);

test('fixture: each period\'s records out, silent errors and likely range', () => {
  assert.deepEqual(M.periods.map(p => p.period), ['2026-W36', '2026-W37', '2026-W38', '2026-W39', '2026-W40', '2026-W41', '2026-W42']);
  assert.deepEqual(M.periods.map(p => [p.rate.n, p.rate.d]), [[0, 30], [0, 30], [0, 30], [1, 30], [3, 30], [2, 30], [3, 30]]);
  assert.deepEqual([M.periods[4].rate.pct, M.periods[4].rate.low_pct, M.periods[4].rate.high_pct], [10, 3.5, 25.6]);
});

test('fixture: the CUSUM, its alarm and the likely start of the rise', () => {
  assert.deepEqual(M.periods.map(p => p.cusum.steps), [0, 0, 0, 0, 105, 155, 260]);
  assert.deepEqual(M.periods.map(p => p.alarm), [false, false, false, false, false, false, true]);
  assert.equal(M.settings.alarm_at, 156);
  assert.equal(M.settings.period_size, 30);
  assert.deepEqual([M.detector.status, M.detector.alarm_since, M.detector.rise_started], ['alarm', '2026-W42', '2026-W40']);
  assert.equal(M.periods[5].cusum.level_pct, 99.4);   // 155 of 156: one step short
});

test('fixture: shown under 5% in W38 only, with the running upper bound', () => {
  assert.deepEqual(M.periods.map(p => p.shown), [false, false, true, false, false, false, false]);
  assert.deepEqual(M.periods.map(p => p.upper_pct), [13.8, 7.2, 4.9, 5.6, 8.0, 8.5, 9.4]);
  assert.deepEqual([M.bound.shown, M.bound.shown_since, M.bound.last_shown], [false, null, '2026-W38']);
  assert.deepEqual([M.bound.records, M.bound.silent], [210, 9]);
});

test('fixture: the design numbers in plain words', () => {
  assert.deepEqual(M.design, { period_size: 30, false_alarm_records: 2065, detect_records: 219, detect_periods: 7.3, break_even_pct: 3.6, under_target: { rate_pct: 4.5, records: 280 } });
  const text = renderMonitor(M);
  assert.match(text, /ALARM since 2026-W42/);
  assert.match(text, /likely started in 2026-W40/);
  assert.match(text, /valid however often you look/);
  assert.match(text, /a rise to 5\.0% would be flagged after about 219 records/);
  assert.match(text, /about one false alarm per 2,065 records checked when the rate is 2\.5%/);
});

test('fixture: the counts as JSON give the same as the CSV', () => {
  const J = fromCounts(path.join(dir, 'counts.json'));
  assert.deepEqual(J.periods, M.periods);
  assert.deepEqual(J.detector, M.detector);
});

test('defaults: --target alone sets the acceptable rate at half of it and the alarming rate at the target', () => {
  const T = monitorRun({ countsPath: csv, target: 5 });
  assert.deepEqual([T.settings.acceptable_pct, T.settings.alarming_pct, T.settings.target_pct, T.settings.false_alarm_every], [2.5, 5, 5, 2000]);
  const A = monitorRun({ countsPath: csv, acceptable: 2 });
  assert.deepEqual([A.settings.acceptable_pct, A.settings.alarming_pct, A.settings.target_pct, A.bound], [2, 4, null, null]);
  assert.throws(() => monitorRun({ countsPath: csv }), /--target <percent>.*or --acceptable/);
});

test('--since (L13): restarts the alarm only; the bound keeps every period, so its 5% promise holds', () => {
  const R = fromCounts(csv, { since: '2026-W41' });
  assert.deepEqual(R.periods.map(p => p.counted), [false, false, false, false, false, true, true]);
  assert.deepEqual(R.periods.slice(5).map(p => p.cusum.steps), [50, 155]);   // 106 - 56; 50 + 159 - 54
  assert.equal(R.periods[0].cusum, null);
  assert.equal(R.detector.status, 'in control');
  // A restart picked after an alarm is picked by the numbers: restarting the bound there would
  // break its promise (scripts/monitor-sim.js restart). The bound counts from the first period.
  assert.deepEqual([R.bound.records, R.bound.silent], [210, 9]);
  assert.deepEqual(R.periods.map(p => p.upper_pct), M.periods.map(p => p.upper_pct));
  assert.deepEqual(R.periods.map(p => p.shown), M.periods.map(p => p.shown));
});

test('run files: each period scored with the config, named after its file (and L12)', () => {
  const R = monitorRun({ config, runPaths: [run(40), run(41), run(42)], ...SETTINGS });
  assert.deepEqual(R.periods.map(p => [p.period, p.rate.n, p.rate.d]), [['2026-W40', 1, 4], ['2026-W41', 0, 3], ['2026-W42', 2, 5]]);
  // 53 - 6 = 47; 47 - 6 = 41; 41 + 106 - 6 = 141
  assert.deepEqual(R.periods.map(p => p.cusum.steps), [47, 41, 141]);
  assert.equal(R.inputs.runs.length, 3);
  // One perfect week (W41) is normal in a scorecard: no "matches the answer key exactly" warning.
  assert.equal(traps(R, 'A8').length, 0);
  // Every week perfect suggests the answers were copied from the outputs: warned.
  const perfect = w => tmp('2026-W' + w + '.json', JSON.stringify([{ id: 'P' + w, decision: 'SENT', output: { TOPIC: 'billing' }, expected: { TOPIC: 'billing' } }]));
  assert.equal(traps(monitorRun({ config, runPaths: [perfect(50), perfect(51)], ...SETTINGS }), 'A8').length, 2);
});

// ---------- Traps (test/TRAPS.md, section L) ----------

test('L1: periods out of time order stop; names the order cannot be read from are strict', () => {
  stops(() => fromCounts(countsFile([week(37, 30, 0), week(36, 30, 0)])), /\[L1\].*2026-W36.*comes after 2026-W37/s);
  stops(() => fromCounts(countsFile([{ period: '2026-10-12', out_without_review: 9, silent_errors: 0 }, { period: '2026-10-05', out_without_review: 9, silent_errors: 0 }])), /\[L1\]/);
  stops(() => fromCounts(countsFile([{ period: 'march', out_without_review: 9, silent_errors: 0 }, { period: 'april', out_without_review: 9, silent_errors: 0 }])), /\* \[L1\].*cannot be read/s);
  const L = fromCounts(countsFile([{ period: 'march', out_without_review: 9, silent_errors: 0 }, { period: 'april', out_without_review: 9, silent_errors: 0 }]), { lenient: true });
  assert.equal(traps(L, 'L1')[0].level, 'warn');
  // week-2 before week-10: numbers compare as numbers, not as text
  const N = fromCounts(countsFile([{ period: 'week-2', out_without_review: 9, silent_errors: 0 }, { period: 'week-10', out_without_review: 9, silent_errors: 0 }]));
  assert.equal(traps(N, 'L1').length, 0);
});

test('L2: a period given twice stops (the same name, or a run file with the same content)', () => {
  stops(() => fromCounts(countsFile([week(36, 30, 0), week(36, 30, 0)])), /\[L2\].*2026-W36/);
  stops(() => fromCounts(countsFile([{ period: 'week-2', out_without_review: 9, silent_errors: 0 }, { period: 'week-02', out_without_review: 9, silent_errors: 0 }])), /\[L2\].*week-2.*week-02.*the same period/s);
  const copy = tmp('2026-W43.json', fs.readFileSync(run(42)));
  stops(() => monitorRun({ config, runPaths: [run(40), run(42), copy], ...SETTINGS }), /\[L2\].*same content/);
});

test('L3: a period with no records out without review is a warning, and adds nothing to either check', () => {
  const Z = fromCounts(countsFile([week(36, 30, 0), week(37, 0, 0), week(38, 30, 0), week(39, 30, 0)]));
  assert.equal(traps(Z, 'L3').length, 1);
  assert.equal(Z.periods[1].rate.pct, null);
  assert.equal(Z.periods[1].cusum.steps, Z.periods[0].cusum.steps);
  assert.equal(Z.periods[1].upper_pct, Z.periods[0].upper_pct);
  assert.equal(Z.settings.period_size, 30);   // the median of the periods with records out
  assert.equal(Z.bound.shown_since, '2026-W39');   // 90 records, none wrong
});

test('L4: a target at or below the acceptable rate, or an alarming rate at or below it, stops', () => {
  stops(() => fromCounts(csv, { target: 5, acceptable: 5 }), /\[L4\]/);
  stops(() => fromCounts(csv, { target: 4, acceptable: 5 }), /\[L4\]/);
  stops(() => fromCounts(csv, { acceptable: 3, alarming: 3 }), /\[L4\]/);
  stops(() => fromCounts(csv, { acceptable: 3, alarming: 2 }), /\[L4\]/);
});

test('L5: impossible counts stop, each named', () => {
  stops(() => fromCounts(countsFile([week(36, 3, 5)])), /\[L5\].*2026-W36.*more silent errors \(5\) than records out without review \(3\)/s);
  stops(() => fromCounts(countsFile([week(36, -1, 0)])), /\[L5\]/);
  stops(() => fromCounts(countsFile([week(36, 30, 1.5)])), /\[L5\]/);
  stops(() => fromCounts(countsFile([{ period: '2026-W36', out_without_review: 30 }])), /\[L5\].*silent_errors/);
  stops(() => fromCounts(countsFile([{ out_without_review: 30, silent_errors: 0 }])), /\[L5\].*period/);
  stops(() => fromCounts(tmp('counts.csv', 'period,out_without_review,silent_errors\n2026-W36,30,x\n')), /\[L5\]/);
  stops(() => fromCounts(countsFile({ periods: [] })), /\[L5\]/);
  stops(() => fromCounts(countsFile([])), /\[L5\]/);
});

test('L6: mixed inputs stop: run files and a counts file together, or counts scored different ways', () => {
  stops(() => monitorRun({ config, runPaths: [run(40)], countsPath: csv, ...SETTINGS }), /\[L6\]/);
  stops(() => fromCounts(countsFile([{ ...week(36, 30, 0), scored_with: 'config v1' }, { ...week(37, 30, 0), scored_with: 'config v2' }])), /\[L6\].*config v1.*config v2/s);
  const same = fromCounts(countsFile([{ ...week(36, 30, 0), scored_with: 'v2' }, { ...week(37, 30, 0), scored_with: 'v2' }]));
  assert.equal(traps(same, 'L6').length, 0);
  // --since restarts the alarm only; the bound counts every period, so it does not excuse a mix.
  stops(() => fromCounts(countsFile([{ ...week(36, 30, 0), scored_with: 'v1' }, { ...week(37, 30, 0), scored_with: 'v2' }]), { since: '2026-W37' }), /\[L6\]/);
});

test('L7: very uneven sample sizes are a warning', () => {
  const U = fromCounts(countsFile([week(36, 30, 0), week(37, 200, 2), week(38, 30, 0), week(39, 5, 0)]));
  assert.equal(traps(U, 'L7').length, 1);
  assert.match(traps(U, 'L7')[0].message, /5 to 200/);
  assert.equal(traps(M, 'L7').length, 0);
});

test('L8: a restart period that does not exist stops', () => {
  stops(() => fromCounts(csv, { since: '2026-W50' }), /\[L8\].*2026-W50/);
});

test('L9: the same record checked in two periods is strict', () => {
  const again = tmp('2026-W43.json', JSON.stringify([{ id: 'W42-1', decision: 'SENT', output: { TOPIC: 'billing' }, expected: { TOPIC: 'billing' } }]));
  stops(() => monitorRun({ config, runPaths: [run(42), again], ...SETTINGS }), /\* \[L9\].*W42-1/s);
  const L = monitorRun({ config, runPaths: [run(42), again], ...SETTINGS, lenient: true });
  assert.equal(traps(L, 'L9')[0].level, 'warn');
});

test('L10: peeking: 73 records with no silent error clear one likely range, not the confidence sequence (88 do)', () => {
  const { wilson } = require('../src/metrics/stats.js');
  assert.ok(wilson(0, 73).high < 0.05);
  const P = fromCounts(countsFile([week(36, 73, 0)]));
  assert.deepEqual([P.periods[0].shown, P.periods[0].upper_pct], [false, 6]);
  const Q = fromCounts(countsFile([week(36, 73, 0), week(37, 15, 0)]));
  assert.deepEqual(Q.periods.map(p => p.shown), [false, true]);
  assert.deepEqual(Q.bound.perfect_run, { anytime: 88, fixed: 73 });
});

test('L11: one period\'s high rate alone does not raise the alarm', () => {
  const O = fromCounts(countsFile([week(36, 10, 1)]));
  assert.deepEqual([O.periods[0].rate.pct, O.periods[0].rate.low_pct, O.periods[0].rate.high_pct], [10, 1.8, 40.4]);
  assert.deepEqual([O.periods[0].cusum.steps, O.detector.status], [35, 'in control']);   // 53 - 18, of 191
});

// ---------- The command ----------

const cli = args => spawnSync(process.execPath, [bin, 'monitor', ...args], { encoding: 'utf8' });

test('CLI: --fail-on-alarm exits with code 3 on an alarm, 0 without; --json writes the results', () => {
  const out = path.join(tmpDir, 'monitor.json');
  const a = cli(['--counts', csv, '--target', '5', '--fail-on-alarm', '--json', out]);
  assert.equal(a.status, 3, a.stderr);
  assert.match(a.stderr, /fail-on-alarm/);
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual([j.kind, j.detector.status, j.detector.alarm_since], ['monitor', 'alarm', '2026-W42']);
  const b = cli(['--counts', csv, '--target', '5', '--fail-on-alarm', '--since', '2026-W41']);
  assert.equal(b.status, 0, b.stderr);
  const c = cli(['--config', configPath, run(40), run(41), run(42), '--target', '5']);
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /2026-W42/);
});

test('CLI: bad options stop with exit code 1', () => {
  assert.equal(cli(['--counts', csv]).status, 1);
  assert.equal(cli(['--counts', csv, '--target', '0']).status, 1);
  assert.equal(cli(['--counts', csv, '--target', '5', '--false-alarm-every', '20']).status, 1);   // checked once the period size is known
  assert.equal(cli(['--counts', csv, '--target', '5', '--period-size', '0']).status, 1);
  assert.equal(cli(['--target', '5']).status, 1);
});

// ---------- Fixes from the independent review ----------

const rows = list => countsFile(list.map(([w, out, silent]) => ({ period: 'week-' + w, out_without_review: out, silent_errors: silent })));

test('L14: a past status never changes when later periods arrive (the level uses the periods up to each row)', () => {
  const early = fromCounts(rows([[1, 20, 2], [2, 20, 1], [3, 20, 2]]));
  const later = fromCounts(rows([[1, 20, 2], [2, 20, 1], [3, 20, 2], [4, 50, 1], [5, 50, 1], [6, 50, 1], [7, 50, 1]]));
  assert.deepEqual(later.periods.slice(0, 3).map(p => [p.alarm, p.cusum.alarm_at]), early.periods.map(p => [p.alarm, p.cusum.alarm_at]));
  const v1 = fromCounts(rows([[1, 30, 4]]));
  const v2 = fromCounts(rows([[1, 30, 4], [2, 10, 0], [3, 10, 0], [4, 10, 0], [5, 10, 0]]));
  assert.deepEqual([v2.periods[0].alarm, v2.periods[0].cusum.alarm_at], [v1.periods[0].alarm, v1.periods[0].cusum.alarm_at]);
  assert.equal(v1.periods[0].alarm, true);   // 4 of 30: 212 - 52 = 160 >= 156
  // --period-size pins the level for every row, and the report says which level was used.
  const pinned = fromCounts(rows([[1, 20, 2], [2, 20, 1], [3, 20, 2], [4, 50, 1]]), { periodSize: 30 });
  assert.deepEqual(pinned.periods.map(p => p.cusum.alarm_at), [156, 156, 156, 156]);
  assert.deepEqual([pinned.settings.period_size, pinned.settings.period_size_pinned], [30, true]);
  assert.match(renderMonitor(pinned), /Alarm level 156 steps, for periods of 30 records \(--period-size\)/);
  assert.match(renderMonitor(M), /Alarm level 156 steps, for periods of 30 records \(the median so far\)/);
});

test('review 3: the report gives the break-even rate and the records to an alarm just under the target', () => {
  // 53 up, 2 down: S drifts up at any rate above 2 / (53 + 2) = 3.6%.
  assert.equal(M.design.break_even_pct, 3.6);
  assert.deepEqual(M.design.under_target, { rate_pct: 4.5, records: 280 });
  const text = renderMonitor(M);
  assert.match(text, /adds up evidence at any rate above 3\.6%/);
  assert.match(text, /at 4\.5%, just under the target, an alarm comes after about 280 records/);
});

test('review 4: big periods do not underflow the binomial chances', () => {
  const arl = cusumArl(0.25, 0.5, 500, 0.25, 3000);
  assert.ok(arl > 3000 * 2, 'got ' + arl);
  const B = monitorRun({ countsPath: rows([[1, 3000, 700], [2, 3000, 710]]), target: 50, falseAlarmEvery: 20000 });
  assert.ok(B.design.false_alarm_records >= 20000);
});

test('review 5: a counts file with a byte-order mark is read, with an A3 note', () => {
  const B = fromCounts(tmp('counts.json', '﻿' + fs.readFileSync(path.join(dir, 'counts.json'), 'utf8')));
  assert.equal(traps(B, 'A3').length, 1);
  assert.deepEqual(B.periods, M.periods);
  const C = fromCounts(tmp('counts.csv', '﻿' + fs.readFileSync(csv, 'utf8')));
  assert.deepEqual(C.periods, M.periods);
});

test('review 6: an upper bound just under the target is never printed as the target', () => {
  const U = fromCounts(rows([[1, 88, 0]]));
  assert.equal(U.periods[0].shown, true);
  assert.equal(U.periods[0].upper_pct, 4.98);
  assert.match(renderMonitor(U), /upper bound 4\.98%/);
});

test('review, lesser: a missing counts file, a trimmed scored_with, and the alarming rate rule', () => {
  stops(() => fromCounts(path.join(tmpDir, 'no-such-file.json')), /\[A1\].*no-such-file/);
  const T = fromCounts(countsFile([{ ...week(36, 30, 0), scored_with: 'v2 ' }, { ...week(37, 30, 0), scored_with: 'v2' }]));
  assert.equal(traps(T, 'L6').length, 0);
  // The alarming rate is double the acceptable rate, with no hidden cap: 60% would alarm at 120%.
  stops(() => fromCounts(csv, { acceptable: 60 }), /\[L4\].*120%/);
});

// ---------- Fixes from the newcomer test ----------

const csvFile = text => tmp('counts.csv', text);
const WEEKS = 'period,out_without_review,silent_errors\n2026-W36,30,0\n2026-W37,30,0\n2026-W38,30,0\n2026-W39,30,1\n2026-W40,30,3\n2026-W41,30,2\n2026-W42,30,3\n';

test('L15: a counts CSV split by ";" or tabs is read, with a note; an unclear header stops', () => {
  const semi = fromCounts(csvFile(WEEKS.replace(/,/g, ';')));
  assert.deepEqual(semi.periods, M.periods);
  assert.match(traps(semi, 'L15').map(i => i.message).join(' '), /split by ";"/);
  const tab = fromCounts(csvFile(WEEKS.replace(/,/g, '\t')));
  assert.deepEqual(tab.periods, M.periods);
  stops(() => fromCounts(csvFile('period;out_without_review,silent_errors\n2026-W36;30,0\n')), /\[L15\].*cannot tell/);
});

test('L15: column names are read loosely, and a missing column stops once, naming what was found', () => {
  const loose = fromCounts(csvFile(WEEKS.replace('period,out_without_review,silent_errors', 'Period,Out Without Review,Silent-Errors')));
  assert.deepEqual(loose.periods, M.periods);
  assert.equal(traps(loose, 'L15').length, 1);
  assert.throws(() => fromCounts(csvFile(WEEKS.replace('silent_errors', 'silent_error'))), e => {
    assert.match(e.message, /\[L15\].*no silent_errors column.*found: period, out_without_review, silent_error/s);
    assert.equal((e.message.match(/\[L/g) || []).length, 1);   // one stop, not one per row
    return true;
  });
});

test('L1: run files given out of order (a shell glob puts week-10 before week-2) are sorted, with a note', () => {
  const one = w => tmp('week-' + w + '.json', JSON.stringify([{ id: 'G' + w, decision: 'SENT', output: { TOPIC: 'billing' }, expected: { TOPIC: w === 2 ? 'refund' : 'billing' } }]));
  const files = [1, 10, 2].map(one);
  const R = monitorRun({ config, runPaths: files, ...SETTINGS });
  assert.deepEqual(R.periods.map(p => p.period), ['week-1', 'week-2', 'week-10']);
  assert.equal(traps(R, 'L1')[0].level, 'fix');
  assert.deepEqual(R.periods.map(p => p.rate.n), [0, 1, 0]);
});

test('L16: a percentage option under 1 is read as a percentage, and said so; settings print with their decimals', () => {
  const T = monitorRun({ countsPath: csv, target: 0.05 });
  assert.match(traps(T, 'L16')[0].message, /0\.05 means 0\.05%, not 5%/);
  assert.match(renderMonitor(T), /acceptable 0\.025% · alarming 0\.05% · target 0\.05%/);
  assert.equal(traps(M, 'L16').length, 0);
});

test('L17: records in run files that did not go out without review are counted and named', () => {
  const R = monitorRun({ config, runPaths: [run(40), run(41), run(42)], ...SETTINGS });
  assert.match(traps(R, 'L17')[0].message, /3 checked record\(s\) did not go out without review/);
});

test('L18: periods that run clearly above the acceptable rate suggest setting --acceptable', () => {
  const steady = Array.from({ length: 12 }, (_, i) => ({ period: 'week-' + (i + 1), out_without_review: 100, silent_errors: 4 }));
  const S = fromCounts(countsFile(steady), { acceptable: undefined, target: 5 });
  const note = traps(S, 'L18');
  assert.equal(note.length, 1);
  assert.match(note[0].message, /ran at 4\.0%.*--acceptable 4/s);
  assert.equal(traps(M, 'L18').length, 0);
  // With --acceptable left at its default, the report says how it was set.
  assert.match(renderMonitor(monitorRun({ countsPath: csv, target: 5 })), /--acceptable was not given/);
});

test('CLI: --period-size that is not a number names the value given', () => {
  const r = cli(['--counts', csv, '--target', '5', '--period-size', 'abc']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--period-size .*got "abc"/);
});

test('--keys: each period\'s answer key in its own file, of the same name, in another folder', () => {
  const preds = fs.mkdtempSync(path.join(tmpDir, 'preds-')), keys = fs.mkdtempSync(path.join(tmpDir, 'keys-'));
  for (const w of [40, 41, 42]) {
    const recs = JSON.parse(fs.readFileSync(run(w), 'utf8'));
    fs.writeFileSync(path.join(preds, '2026-W' + w + '.json'), JSON.stringify(recs.map(({ expected, ...r }) => r)));
    fs.writeFileSync(path.join(keys, '2026-W' + w + '.json'), JSON.stringify(recs.map(r => ({ id: r.id, expected: r.expected }))));
  }
  const split = monitorRun({ config, runPaths: [40, 41, 42].map(w => path.join(preds, '2026-W' + w + '.json')), keysDir: keys, ...SETTINGS });
  const together = monitorRun({ config, runPaths: [run(40), run(41), run(42)], ...SETTINGS });
  assert.deepEqual(split.periods, together.periods);
  fs.renameSync(path.join(keys, '2026-W41.json'), path.join(keys, 'other.json'));
  stops(() => monitorRun({ config, runPaths: [40, 41, 42].map(w => path.join(preds, '2026-W' + w + '.json')), keysDir: keys, ...SETTINGS }), /\[A1\].*2026-W41\.json.*no answer key/s);
  stops(() => monitorRun({ countsPath: csv, keysDir: keys, ...SETTINGS }), /--keys goes with period files/);
});

test('--keys must be a folder: one stop, and paths in one style', () => {
  const file = tmp('keys.json', '[]');
  assert.throws(() => monitorRun({ config, runPaths: [run(40), run(41)], keysDir: file, ...SETTINGS }), e => {
    assert.match(e.message, /--keys must be a folder/);
    assert.equal((e.message.match(/\[A1\]/g) || []).length, 1);
    return true;
  });
  const empty = fs.mkdtempSync(path.join(tmpDir, 'nokeys-'));
  assert.throws(() => monitorRun({ config, runPaths: [run(40)], keysDir: empty.split(path.sep).join('/'), ...SETTINGS }), e => {
    const line = e.message.split('\n').find(l => l.includes('[A1]'));
    assert.ok(!(line.includes('/') && line.includes('\\')), line);
    return true;
  });
});

test('L1: the note for sorted period files is neutral', () => {
  const one = w => tmp('2026-W' + w + '.json', JSON.stringify([{ id: 'N' + w, decision: 'SENT', output: { TOPIC: 'billing' }, expected: { TOPIC: 'billing' } }]));
  // Deliberately shuffled: not plain text order, so it stops (the final review's L1 fix).
  stops(() => monitorRun({ config, runPaths: [12, 10, 11].map(one), ...SETTINGS }), /\[L1\]/);
  // Plain text order out of time (a glob of week-N files) is sorted, with a neutral note.
  const R = monitorRun({ config, runPaths: ['week-1', 'week-10', 'week-2'].map(n => onePeriod(n)), ...SETTINGS });
  assert.match(traps(R, 'L1')[0].message, /^the period files were given out of order; sorted by their names: week-1, week-2, week-10/);
  assert.doesNotMatch(traps(R, 'L1')[0].message, /shell/);
});

// ---------- Fixes from the final code review ----------

const onePeriod = (name, wrong) => tmp(name + '.json', JSON.stringify([{ id: 'R-' + name, decision: 'SENT', output: { TOPIC: 'billing' }, expected: { TOPIC: wrong ? 'refund' : 'billing' } }]));

test('L1: only plain text order (what a shell glob gives) is sorted; any other order out of time stops', () => {
  stops(() => monitorRun({ config, runPaths: ['week-51', 'week-52', 'week-1'].map(n => onePeriod(n)), ...SETTINGS }), /\[L1\].*week-1.*comes after week-52/s);
  const glob = monitorRun({ config, runPaths: ['week-1', 'week-10', 'week-2'].map(n => onePeriod(n)), ...SETTINGS });
  assert.deepEqual(glob.periods.map(p => p.period), ['week-1', 'week-2', 'week-10']);
});

test('L16: warns only where a fraction was plausibly meant', () => {
  assert.equal(traps(monitorRun({ countsPath: csv, target: 0.7, acceptable: 0.3 }), 'L16').length, 0);
  assert.equal(traps(monitorRun({ countsPath: csv, target: 0.05 }), 'L16').length, 1);
  assert.equal(traps(monitorRun({ countsPath: csv, target: 5, acceptable: 0.025 }), 'L16').length, 1);
});

test('L18: one error in a calm stretch is not evidence enough to suggest a new --acceptable', () => {
  const calm = [1, 2, 1, 2, 1].map((s, i) => ({ period: '2026-W0' + (i + 1), out_without_review: 300, silent_errors: s }));
  assert.equal(traps(fromCounts(countsFile(calm), { acceptable: 0.2, target: 1 }), 'L18').length, 0);
});

test('--keys: names matched without regard to case; extra key files noted; names that differ only by case stop', () => {
  const preds = fs.mkdtempSync(path.join(tmpDir, 'p-')), keys = fs.mkdtempSync(path.join(tmpDir, 'k-'));
  const rec = JSON.parse(fs.readFileSync(run(40), 'utf8'));
  fs.writeFileSync(path.join(preds, '2026-W40.json'), JSON.stringify(rec.map(({ expected, ...r }) => r)));
  fs.writeFileSync(path.join(keys, '2026-w40.JSON'), JSON.stringify(rec.map(r => ({ id: r.id, expected: r.expected }))));
  fs.writeFileSync(path.join(keys, '2026-W99.json'), '[]');
  const K = monitorRun({ config, runPaths: [path.join(preds, '2026-W40.json')], keysDir: keys, ...SETTINGS });
  assert.deepEqual([K.periods[0].rate.n, K.periods[0].rate.d], [1, 4]);
  assert.match(traps(K, 'A1').map(i => i.message).join(' '), /1 key file\(s\) match no period file: 2026-W99\.json/);
  const twin = path.join(keys, '2026-w40.json');
  let caseSensitive = true;
  try { fs.writeFileSync(twin, '[]'); caseSensitive = fs.readdirSync(keys).length === 3; } catch { caseSensitive = false; }
  if (caseSensitive) stops(() => monitorRun({ config, runPaths: [path.join(preds, '2026-W40.json')], keysDir: keys, ...SETTINGS }), /\[A1\].*differ only by case/);
});
