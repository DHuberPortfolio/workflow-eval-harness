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

// ---------- What nobody sees, and each segment (test/fixtures/monitor-segments/EXPECTED.md) ----------

const { closedBars, familyBars } = require('../src/metrics/monitor.js');
const { scoreRun } = require('../src/score.js');
const segDir = path.join(__dirname, 'fixtures', 'monitor-segments');
const segConfig = loadConfig(path.join(segDir, 'config.json'));
const segRun = w => path.join(segDir, 'runs', '2026-W' + w + '.json');
const segRuns = [40, 41, 42].map(segRun);
const segCsv = path.join(segDir, 'counts.csv');
const OMIT = { watch: 'silent-omissions', target: 20, acceptable: 10 };
const SEG = { segmentBy: 'segment' };
const bySeg = (m, name) => m.segments.rows.find(r => r.segment === name);
const E0 = F => Math.exp(mixtureLogE(0, F, 0.05));
const Ee = (s, f) => Math.exp(mixtureLogE(s, f, 0.05));
const short = e => Math.max(0, 20 - e);

test('L19: --watch silent-omissions: the blocked or suppressed records checked are the base, those wrongly left out the count', () => {
  const O = monitorRun({ config: segConfig, runPaths: segRuns, ...OMIT });
  assert.equal(O.watch, 'silent-omissions');
  assert.deepEqual(O.periods.map(p => [p.rate.n, p.rate.d]), [[1, 3], [2, 3], [1, 3]]);
  // From 10% to 20%: a record wrongly left out adds 53 steps, a right one takes 9 off. 53 - 18; + 106 - 9; + 53 - 18.
  assert.deepEqual([O.settings.scores.up, O.settings.scores.down], [53, 9]);
  assert.deepEqual(O.periods.map(p => p.cusum.steps), [35, 132, 167]);
  assert.equal(O.settings.alarm_at, 297);
  assert.equal(O.detector.status, 'in control');
  // Not blocked or suppressed (out without review, or sent to a person): 5, 3 and 4, named in a note.
  assert.match(traps(O, 'L17')[0].message, /^12 checked record\(s\) were not blocked or suppressed \(went out without review or sent to a person\) and are not part of the share wrongly left out: 2026-W40 5, 2026-W41 3, 2026-W42 4\./);
  const text = renderMonitor(O);
  assert.match(text, /rate: wrongly left out: of the blocked or suppressed records a person checked, the share that should have gone out or to a person \(not score's silent omission rate\)/);
  assert.match(text, /period +left out +wrongly/);
  assert.match(text, /No alarm: no sign yet that the share wrongly left out has risen above the acceptable 10\.0%/);
  assert.match(text, /from 9 records blocked or suppressed, 4 records wrongly left out/);
  // The same files watched for silent errors: the records out without review, as before.
  const S = monitorRun({ config: segConfig, runPaths: segRuns, ...SETTINGS });
  assert.deepEqual(S.periods.map(p => [p.rate.n, p.rate.d]), [[1, 4], [0, 2], [2, 3]]);
  assert.equal(S.watch, undefined);
});

test('L19: --watch silent-errors (the default) gives exactly what monitor gave before', () => {
  assert.deepEqual(fromCounts(csv, { watch: 'silent-errors' }), M);
  assert.deepEqual(monitorRun({ config, runPaths: [run(40), run(41), run(42)], ...SETTINGS, watch: 'silent-errors' }), monitorRun({ config, runPaths: [run(40), run(41), run(42)], ...SETTINGS }));
  assert.throws(() => fromCounts(csv, { watch: 'omissions' }), /--watch must be silent-errors or silent-omissions, got "omissions"/);
});

test('L30: the share wrongly left out is not score\'s silent omission rate, and the advice says where to measure it', () => {
  // score's base is the records that should have been seen; monitor's, the records left out. W40: 1 of 6 against 1 of 3.
  const sc = scoreRun({ config: segConfig, predPath: segRun(40), keyPath: segRun(40) }).routing.silent_omissions.rate;
  assert.deepEqual([sc.n, sc.d, sc.pct], [1, 6, 16.7]);
  const O = monitorRun({ config: segConfig, runPaths: segRuns, watch: 'silent-omissions', target: 20 });
  assert.deepEqual([O.periods[0].rate.n, O.periods[0].rate.d, O.periods[0].rate.pct], [1, 3, 33.3]);
  const text = renderMonitor(O);
  assert.match(text, /--acceptable was not given.*monitor --watch silent-omissions on the golden-set run file, as a single period \(score's silent omission rate counts a different base\)/s);
  assert.doesNotMatch(text, /score on a golden set/);
  // L18's advice too.
  const L = monitorRun({ config: segConfig, runPaths: segRuns, ...OMIT });
  assert.match(traps(L, 'L18')[0].message, /monitor --watch silent-omissions on the golden-set run file as a single period/);
  assert.doesNotMatch(traps(L, 'L18')[0].message, /from score on a golden set/);
});

test('L19: a counts file\'s blocked_or_suppressed and silent_omissions columns (names read loosely)', () => {
  const whole = [0, 0, 1, 2, 2, 3, 3].map((y, i) => ({ period: '2026-W' + (36 + i), blocked_or_suppressed: 11, silent_omissions: y }));
  const O = fromCounts(countsFile(whole), OMIT);
  // 11 a week, from 10% to 20%: 0 -> -99, 1 -> 53 - 90 = -37, 2 -> 106 - 81 = 25, 3 -> 159 - 72 = 87.
  assert.deepEqual(O.periods.map(p => p.cusum.steps), [0, 0, 0, 25, 50, 137, 224]);
  assert.equal(O.settings.alarm_at, 251);
  const loose = fromCounts(csvFile('Period,Blocked or Suppressed,Silent Omissions\n' + whole.map(r => [r.period, 11, r.silent_omissions].join(',')).join('\n') + '\n'), OMIT);
  assert.deepEqual(loose.periods, O.periods);
  // The silent error columns are not needed to watch omissions; the omission columns are.
  assert.throws(() => fromCounts(csv, OMIT), e => {
    assert.match(e.message, /\[L21\].*no blocked_or_suppressed or silent_omissions column.*found: period, out_without_review, silent_errors/s);
    assert.equal((e.message.match(/\[L/g) || []).length, 1);
    return true;
  });
  stops(() => fromCounts(countsFile([{ period: '2026-W36', blocked_or_suppressed: 2, silent_omissions: 3 }]), OMIT), /\[L21\].*more silent omissions \(3\) than records blocked or suppressed \(2\)/);
  stops(() => fromCounts(countsFile([{ period: '2026-W36', blocked_or_suppressed: 2 }]), OMIT), /\[L21\].*has no silent_omissions/);
  // L3 in the series' own words.
  const Z = fromCounts(countsFile([...whole.slice(0, 2), { period: '2026-W38', blocked_or_suppressed: 0, silent_omissions: 0 }]), OMIT);
  assert.match(traps(Z, 'L3')[0].message, /no records blocked or suppressed were checked in this period/);
});

test('L20: omissions need an answer key that says where each left-out record belonged', () => {
  const noGold = { ...segConfig, routing: { ...segConfig.routing, gold_field: null } };
  stops(() => monitorRun({ config: noGold, runPaths: segRuns, ...OMIT }), /\[L20\].*no correct route \(routing\.gold_field\)/);
  const neverLeftOut = { ...segConfig, routing: { ...segConfig.routing, map: { SEND: 'auto', ASK: 'review', FILE: 'review', DUPLICATE: 'review' } } };
  stops(() => monitorRun({ config: neverLeftOut, runPaths: segRuns, ...OMIT }), /\[L20\].*never blocks or suppresses/);
  // Without a correct route but with a label that may decline: only the blocked records whose label
  // was declined can be judged (SO-DECLINED); the other records left out are counted in a note.
  const dcfg = loadConfig(tmp('config.json', JSON.stringify({
    id_field: 'id',
    outputs: { category: { type: 'label', field: 'category', key_field: 'expected', labels: ['news', 'awards'], decline: { values: ['none'] } } },
    routing: { field: 'outcome', map: { WRITTEN: 'auto', LEFT_OUT: 'block' } },
  })));
  const rec = (id, outcome, category, expected) => ({ id, outcome, category, expected });
  const week = tmp('2026-W40.json', JSON.stringify([rec('D1', 'LEFT_OUT', 'none', 'news'), rec('D2', 'LEFT_OUT', 'none', 'none'), rec('D3', 'LEFT_OUT', 'news', 'news'), rec('D4', 'WRITTEN', 'news', 'news')]));
  const D = monitorRun({ config: dcfg, runPaths: [week], ...OMIT });
  assert.deepEqual([D.periods[0].rate.n, D.periods[0].rate.d], [1, 2]);   // D1 an omission, D2 right; D3 cannot be judged
  assert.match(traps(D, 'L20')[0].message, /1 checked record\(s\) blocked or suppressed cannot be judged without a correct route.*2026-W40 1/s);
});

test('L29: segments only with --segment-by: a counts file\'s segment column alone changes nothing', () => {
  // A weekly file labelled "pilot" throughout: read as it always was, W40 at 128% of the alarm level, an alarm.
  const pilot = path.join(segDir, 'segment-column.csv');
  const P = fromCounts(pilot);
  assert.equal(P.segments, undefined);
  const plain = csvFile(fs.readFileSync(pilot, 'utf8').replace(',segment', '').replace(/,pilot/g, ''));
  const Q = fromCounts(plain);
  assert.deepEqual([P.periods, P.detector, P.bound, P.design], [Q.periods, Q.detector, Q.bound, Q.design]);
  assert.deepEqual([P.periods[4].cusum.level_pct, P.detector.status, P.detector.alarm_since], [128.2, 'alarm', '2026-W40']);
  const c = cli(['--counts', pilot, '--target', '5', '--fail-on-alarm']);
  assert.equal(c.status, 3, c.stderr);
  assert.doesNotMatch(c.stdout, /SEGMENTS/);
  // A segment column (Segment, SEGMENT, a JSON "Segment") with periods given again: one stop, with the way to read it.
  const twice = 'period,Segment,out_without_review,silent_errors\n2026-W36,a,10,0\n2026-W36,b,10,0\n2026-W37,a,10,0\n2026-W37,b,10,1\n';
  assert.throws(() => fromCounts(csvFile(twice)), e => {
    assert.match(e.message, /\[L29\].*has a segment column and gives periods more than once \(2026-W36, 2026-W37\).*add --segment-by segment/s);
    assert.equal((e.message.match(/\[L/g) || []).length, 1);
    return true;
  });
  stops(() => fromCounts(countsFile([{ ...week(36, 10, 0), Segment: 'a' }, { ...week(36, 10, 0), Segment: 'b' }])), /\[L29\].*add --segment-by segment/);
  assert.deepEqual(fromCounts(csvFile(twice), SEG).segments.rows.map(r => r.segment), ['a', 'b']);
});

test('segments (L22): the whole is the segments added up; its alarm shares the budget', () => {
  const G = monitorRun({ countsPath: segCsv, ...SETTINGS, ...SEG });
  assert.deepEqual(G.periods.map(p => [p.rate.n, p.rate.d]), [[0, 43], [0, 43], [0, 43], [1, 43], [2, 45], [2, 43], [3, 43]]);
  assert.deepEqual(G.segments.rows.map(r => r.segment), ['chat', 'email', 'phone', '(none)']);
  assert.equal(G.segments.members, 4);
  const totals = countsFile(G.periods.map(p => ({ period: p.period, out_without_review: p.rate.d, silent_errors: p.rate.n })));
  const T = fromCounts(totals);
  // Its alarm shares the budget with the segments: set for one false alarm per 4,000 records, not 2,000.
  assert.deepEqual(G.periods.map(p => p.cusum.steps), [0, 0, 0, 0, 20, 44, 123]);
  assert.deepEqual([G.settings.alarm_at, G.settings.alarm_set_for, T.settings.alarm_at], [200, 4000, 152]);
  assert.deepEqual([G.settings.false_alarm_every, G.segments.false_alarm_every_each], [2000, 4000]);
  assert.deepEqual(G.segments.without_segments, { alarm_at: 152, detect_records: T.design.detect_records, alarm_since: null });
  assert.equal(G.detector.status, 'in control');
  assert.equal(T.settings.alarm_set_for, undefined);   // without segments, settings are as they were
});

test('segments (L28): one CUSUM per segment finds a rise the whole hides; the alarms share --false-alarm-every', () => {
  const G = monitorRun({ countsPath: segCsv, ...SETTINGS, ...SEG });
  const chat = bySeg(G, 'chat');
  assert.deepEqual(chat.periods.map(p => p.cusum.steps), [0, 0, 0, 15, 85, 155, 280]);
  assert.deepEqual(chat.periods.map(p => p.cusum.alarm_at), [226, 226, 226, 226, 226, 226, 226]);
  assert.deepEqual([chat.detector.status, chat.detector.alarm_since, chat.detector.rise_started], ['alarm', '2026-W42', '2026-W39']);
  assert.deepEqual([chat.records, chat.silent], [140, 8]);
  assert.deepEqual(['email', 'phone', '(none)'].map(s => bySeg(G, s).detector.status), ['in control', 'in control', 'in control']);
  assert.deepEqual(bySeg(G, '(none)').periods.map(p => p.rate.d), [0, 0, 0, 0, 2, 0, 0]);
  const text = renderMonitor(G);
  assert.match(text, /HAS ANY SEGMENT GONE UP\?  ALARM in chat since 2026-W42 \(the rise likely started in 2026-W39\)/);
  assert.match(text, /about one false alarm per 2,000 records checked in all/);
  // The levels with and without segments, side by side (fix from the review).
  assert.match(text, /Alarm level 200 steps \(152 without --segment-by\)/);
  assert.match(text, /flagged after about 281 records on average \(219 without segments\)/);
  assert.doesNotMatch(text, /would have gone off/);
  // --fail-on-alarm counts a segment's alarm.
  const c = cli(['--counts', segCsv, '--target', '5', '--acceptable', '2.5', '--segment-by', 'segment', '--fail-on-alarm']);
  assert.equal(c.status, 3, c.stderr);
  assert.match(c.stderr, /fail-on-alarm: ALARM in segment chat since 2026-W42/);
  // --since restarts every segment's alarm.
  const R = monitorRun({ countsPath: segCsv, ...SETTINGS, ...SEG, since: '2026-W42' });
  assert.deepEqual(bySeg(R, 'chat').periods.map(p => p.cusum && p.cusum.steps), [null, null, null, null, null, null, 125]);
  assert.equal(bySeg(R, 'chat').detector.status, 'in control');
  // When the whole alone would have alarmed but, sharing the budget, does not, the report says so:
  // chat with 4 silent errors in W42 takes the whole to 44 + 220 - 86 = 178, over 152, under 200.
  const more = csvFile(fs.readFileSync(segCsv, 'utf8').replace('2026-W42,chat,20,3', '2026-W42,chat,20,4'));
  const W = monitorRun({ countsPath: more, ...SETTINGS, ...SEG });
  assert.deepEqual([W.periods[6].cusum.steps, W.detector.status, W.segments.without_segments.alarm_since], [178, 'in control', '2026-W42']);
  assert.match(renderMonitor(W), /Without segments, the whole's alarm \(set for 2,000\) would have gone off in 2026-W42/);
  // One segment, and no record in two: it is the whole, and the alarms keep the budget asked.
  const one = fromCounts(csvFile('period,segment,out_without_review,silent_errors\n2026-W36,pilot,30,0\n2026-W37,pilot,30,0\n2026-W38,pilot,30,1\n2026-W39,pilot,30,3\n2026-W40,pilot,30,3\n'), SEG);
  const alone = fromCounts(csvFile('period,out_without_review,silent_errors\n2026-W36,30,0\n2026-W37,30,0\n2026-W38,30,1\n2026-W39,30,3\n2026-W40,30,3\n'));
  assert.deepEqual([one.settings.alarm_at, one.settings.alarm_set_for, one.segments.false_alarm_every_each], [alone.settings.alarm_at, 2000, 2000]);
  assert.match(renderMonitor(one), /One segment with records, and no record in two: it is the whole, so the alarms keep the 2,000 asked for/);
});

test('L24: closed testing on the segments\' evidence: the bar is 20 plus the others\' shortfalls below 20', () => {
  assert.deepEqual(closedBars([Math.log(500), Math.log(500), Math.log(500)]), [20, 20, 20]);
  for (const bar of closedBars([-50, -50, -50, -50])) assert.ok(Math.abs(bar - 80) < 1e-12);
  // 20 + (20 - 1) + (20 - 2) = 57.
  assert.ok(Math.abs(closedBars([Math.log(30), 0, Math.log(2)])[0] - 57) < 1e-12);
  // The bar is the closed test itself: shown exactly when every set of segments that includes it
  // averages 20 or more. Every such set tried, for 2,000 random sets of 2 to 6 segments.
  let seed = 7;
  const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  for (let trial = 0; trial < 2000; trial++) {
    const S = 2 + Math.floor(rand() * 5);
    const logEs = Array.from({ length: S }, () => (rand() < 0.2 ? -20 : Math.log(0.2 + rand() * 120)));
    const E = logEs.map(Math.exp), bars = closedBars(logEs);
    for (let k = 0; k < S; k++) {
      let all = true;
      for (let mask = 0; mask < 1 << S; mask++) {
        if (!(mask & (1 << k))) continue;
        const members = E.filter((x, i) => mask & (1 << i));
        if (members.reduce((t, x) => t + x, 0) / members.length < 20) all = false;
      }
      assert.equal(E[k] >= bars[k] - 1e-9, all, 'trial ' + trial + ': ' + E.map(x => x.toFixed(2)).join(' ') + ', segment ' + k);
    }
  }
});

test('L32: the whole joins the family, weighted 1/2, the segments sharing 1/2: one 5% for every "shown"', () => {
  // Closed forms: the whole's bar is 20 plus the segments' average shortfall (20 to 40); a segment's
  // is 20, plus m times the whole's shortfall, plus the other segments' shortfalls.
  assert.deepEqual(familyBars(Math.log(500), [Math.log(500), Math.log(500), Math.log(500)]), { whole: 20, segments: [20, 20, 20] });
  const low = familyBars(-50, [-50, -50]);
  assert.ok(Math.abs(low.whole - 40) < 1e-12 && low.segments.every(b => Math.abs(b - 80) < 1e-12));
  // Every set that includes it, at the weighted average (weights renormalized over the set), for
  // 2,000 random families of a whole and 1 to 5 segments.
  let seed = 11;
  const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  for (let trial = 0; trial < 2000; trial++) {
    const m = 1 + Math.floor(rand() * 5);
    const logs = Array.from({ length: m + 1 }, () => (rand() < 0.2 ? -20 : Math.log(0.2 + rand() * 150)));
    const E = logs.map(Math.exp), w = [0.5, ...Array(m).fill(0.5 / m)];
    const b = familyBars(logs[0], logs.slice(1)), bars = [b.whole, ...b.segments];
    for (let k = 0; k <= m; k++) {
      let all = true;
      for (let mask = 0; mask < 1 << (m + 1); mask++) {
        if (!(mask & (1 << k))) continue;
        let num = 0, den = 0;
        for (let i = 0; i <= m; i++) if (mask & (1 << i)) { num += w[i] * E[i]; den += w[i]; }
        if (num / den < 20) all = false;
      }
      assert.equal(E[k] >= bars[k] - 1e-9, all, 'trial ' + trial + ', member ' + k);
    }
  }
  // The fixture, week by week: the whole's bar from the four segments' E, and "shown" by it.
  const G = monitorRun({ countsPath: segCsv, ...SETTINGS, ...SEG });
  const segs = ['chat', 'email', 'phone', '(none)'].map(s => bySeg(G, s));
  let sw = 0, fw = 0;
  const cum = segs.map(() => [0, 0]);
  G.periods.forEach((p, t) => {
    sw += p.rate.n; fw += p.rate.d - p.rate.n;
    segs.forEach((s, k) => { cum[k][0] += s.periods[t].rate.n; cum[k][1] += s.periods[t].rate.d - s.periods[t].rate.n; });
    const Es = cum.map(([s, f]) => Ee(s, f)), Ew = Ee(sw, fw);
    const bar = 20 + Es.reduce((a, e) => a + short(e), 0) / 4;
    assert.ok(Math.abs(p.bar - bar) < 0.006 && p.bar >= 20 && p.bar <= 40, p.period + ' ' + p.bar + ' ' + bar);
    assert.equal(p.shown, Ew >= bar, p.period);
    const ebar = 20 + 4 * short(Ew) + Es.reduce((a, e, i) => a + (i === 1 ? 0 : short(e)), 0);
    assert.equal(segs[1].periods[t].shown, Es[1] >= ebar, 'email ' + p.period);
  });
  // email, hand-worked (EXPECTED.md): W40 (100 records, E 33.26) is under any bar of at least
  // 20 + (20 - 1.0536) + (20 - 1.5106) = 57.44; W42 (140, E 186.29) is over any bar, at most 20 + 4 x 20 + 3 x 20 = 160.
  assert.ok(Math.abs(E0(100) - 33.2582) < 1e-4 && Math.abs(E0(140) - 186.2911) < 1e-4);
  assert.deepEqual([segs[1].periods[4].shown, segs[1].periods[6].shown], [false, true]);
  // chat runs above 5% (8 of 140): its evidence is at most 1, and it is not shown.
  assert.ok(Ee(8, 132) <= 1);
  assert.equal(bySeg(G, 'chat').bound.shown, false);
  const text = renderMonitor(G);
  assert.match(text, /SHOWN UNDER 5\.0% in email \(since 2026-W42\)/);
  assert.match(text, /that keeps the chance of any wrong "shown" in this report at 5%, however often you look/);
  assert.match(text, /it needs more evidence before it is called shown: a bar of [\d.]+ here, against 20 alone/);
});

test('L33: each segment\'s upper bound holds for that segment on its own; only "shown" is counted across segments', () => {
  const G = monitorRun({ countsPath: segCsv, ...SETTINGS, ...SEG });
  assert.match(renderMonitor(G), /Each segment's upper bound holds for that segment on its own; only "shown" is counted across segments/);
  // Upper bounds are worked out where they are printed: each segment's last period.
  const email = bySeg(G, 'email');
  assert.ok(email.periods.slice(0, -1).every(p => p.upper_pct === null) && email.bound.upper_pct === email.periods[6].upper_pct && email.bound.upper_pct < 5);
  assert.equal(email.design, undefined);
});

test('L25: a segment with too few records to show anything says so, instead of a bound', () => {
  const G = monitorRun({ countsPath: segCsv, ...SETTINGS, ...SEG });
  const phone = bySeg(G, 'phone'), none = bySeg(G, '(none)');
  // 21 and 2 records: under the 88 that even a bar of 20 needs with no silent error at all.
  assert.deepEqual([phone.records, none.records], [21, 2]);
  assert.ok(phone.bound.too_few.needed >= 88 && none.bound.too_few.needed >= 88);
  assert.equal(phone.bound.upper_pct, null);
  // The bound it would print is noise: 2 records, none wrong, allow up to 86.1% even counted alone.
  assert.equal(Number((100 * mixtureUpper(0, 2)).toFixed(1)), 86.1);
  assert.equal(bySeg(G, 'email').bound.too_few, null);
  const text = renderMonitor(G);
  assert.match(text, new RegExp('phone .*too few: ' + phone.bound.too_few.needed + ' needed'));
  assert.match(text, new RegExp('Too few records to show anything yet .*: phone 21 of ' + phone.bound.too_few.needed + ', \\(none\\) 2 of ' + none.bound.too_few.needed + '\\.'));
});

test('L31: segments that first appear later: --segments fixes the family in advance, or "shown" is provisional', () => {
  const rec = (id, channel) => ({ id, channel, decision: 'SEND', expected_decision: 'SEND', output: { TOPIC: 'billing' }, expected: { TOPIC: 'billing' } });
  const weeks = [40, 41, 42, 43].map(w => tmp('2026-W' + w + '.json', JSON.stringify([
    ...Array.from({ length: 30 }, (_, i) => rec('E' + w + '-' + i, 'email')), ...(w === 43 ? [0, 1, 2].map(i => rec('P' + w + '-' + i, 'phone')) : [])])));
  const by = { config: segConfig, ...SETTINGS, segmentBy: 'channel' };
  // Seen so far: email alone up to W42, so the whole (90 records, E 22.02) is shown in W42; once phone
  // comes in W43, the family has two segments, the whole's bar in W42 is 20 + (0 + 19) / 2 = 29.5: taken back.
  const three = monitorRun({ ...by, runPaths: weeks.slice(0, 3) }), four = monitorRun({ ...by, runPaths: weeks });
  assert.deepEqual([three.periods[2].shown, four.periods[2].shown], [true, false]);
  assert.equal(three.segments.provisional, true);
  assert.match(renderMonitor(three), /a segment that first appears later can take this back: name the segments with --segments, chosen before the first period counted, to make it final/);
  // Named before the first period: email, phone, (other) and (none) are the family from the start, and nothing printed changes.
  const d3 = monitorRun({ ...by, runPaths: weeks.slice(0, 3), segments: ['email', 'phone'] });
  const d4 = monitorRun({ ...by, runPaths: weeks, segments: ['email', 'phone'] });
  assert.deepEqual(d3.periods.map(p => [p.shown, p.bar, p.upper_pct]), d4.periods.slice(0, 3).map(p => [p.shown, p.bar, p.upper_pct]));
  assert.deepEqual(bySeg(d3, 'email').periods.map(p => [p.shown, p.bar]), bySeg(d4, 'email').periods.slice(0, 3).map(p => [p.shown, p.bar]));
  assert.deepEqual([d4.segments.members, d4.segments.provisional, d4.segments.declared], [4, false, ['email', 'phone']]);
  assert.doesNotMatch(renderMonitor(d4), /can take this back/);
  // A value not named is pooled into (other), and the report names it.
  const o = monitorRun({ ...by, runPaths: weeks, segments: ['email'] });
  assert.deepEqual(bySeg(o, '(other)').records, 3);
  assert.deepEqual(o.segments.other_values, { phone: 3 });
  assert.match(renderMonitor(o), /\(other\) holds the values not named in --segments: phone \(3\)/);
  // Mistakes in the list.
  assert.throws(() => monitorRun({ countsPath: segCsv, ...SETTINGS, segments: ['chat'] }), /--segments goes with --segment-by/);
  assert.throws(() => monitorRun({ countsPath: segCsv, ...SETTINGS, ...SEG, segments: ['chat', 'chat'] }), /--segments names "chat" twice/);
  assert.throws(() => monitorRun({ countsPath: segCsv, ...SETTINGS, ...SEG, segments: ['chat', '(other)'] }), /"\(other\)" is the tool's own/);
  assert.throws(() => monitorRun({ countsPath: segCsv, ...SETTINGS, ...SEG, segments: ['chat', ' '] }), /--segments has an empty name/);
  // A value that differs only by case from a name in the list would be pooled away: strict.
  stops(() => monitorRun({ ...by, runPaths: weeks, segments: ['Email', 'phone'] }), /\* \[L23\].*"email" differs only by case from "Email", named in --segments/s);
});

test('segments from run files (--segment-by): read as score --group-by reads groups; no value is "(none)"', () => {
  const R = monitorRun({ config: segConfig, runPaths: segRuns, ...SETTINGS, segmentBy: 'channel' });
  assert.deepEqual(R.segments.rows.map(r => [r.segment, r.records, r.silent]), [['chat', 5, 2], ['email', 3, 1], ['(none)', 1, 0]]);
  assert.deepEqual(bySeg(R, 'chat').periods.map(p => p.cusum.steps), [51, 49, 100]);
  assert.deepEqual(bySeg(R, 'email').periods.map(p => p.cusum.steps), [0, 0, 53]);
  assert.deepEqual(R.periods.map(p => p.cusum.steps), [47, 43, 147]);
  assert.deepEqual([R.segments.by, R.segments.from], ['channel', 'key']);
  const O = monitorRun({ config: segConfig, runPaths: segRuns, ...OMIT, segmentBy: 'channel' });
  assert.deepEqual(O.segments.rows.map(r => [r.segment, r.records, r.silent]), [['chat', 3, 1], ['email', 5, 2], ['(none)', 1, 1]]);
  assert.deepEqual(bySeg(O, 'chat').periods.map(p => p.cusum.steps), [0, 53, 44]);
  assert.deepEqual(bySeg(O, 'email').periods.map(p => p.cusum.steps), [44, 35, 79]);
  // A group named in the config is used as declared (here: read from the predictions).
  const grouped = { ...segConfig, groups: { ch: { field: 'channel', from: 'predictions' } } };
  const P = monitorRun({ config: grouped, runPaths: segRuns, ...SETTINGS, segmentBy: 'ch' });
  assert.deepEqual(P.segments.rows.map(r => r.segment), R.segments.rows.map(r => r.segment));
  assert.equal(P.segments.from, 'predictions');
});

test('segments, omissions: a rise in one segment\'s share wrongly left out, hidden in the whole; a segment with none left out is listed', () => {
  const O = monitorRun({ countsPath: segCsv, ...OMIT, ...SEG });
  assert.deepEqual(O.periods.map(p => [p.rate.n, p.rate.d]), [[0, 11], [0, 11], [1, 11], [2, 11], [2, 11], [3, 11], [3, 11]]);
  assert.deepEqual(O.periods.map(p => p.cusum.steps), [0, 0, 0, 25, 50, 137, 224]);
  assert.equal(O.settings.alarm_at, 301);
  assert.equal(O.detector.status, 'in control');
  const email = bySeg(O, 'email');
  assert.deepEqual(email.periods.map(p => p.cusum.steps), [0, 0, 0, 79, 158, 299, 440]);
  assert.deepEqual([email.periods[6].cusum.alarm_at, email.detector.alarm_since, email.detector.rise_started], [334, '2026-W42', '2026-W39']);
  assert.deepEqual(O.segments.rows.map(r => r.segment), ['chat', 'email', 'phone']);
  assert.deepEqual(O.segments.empty, ['(none)']);
  assert.match(renderMonitor(O), /\(none\): no records blocked or suppressed were checked/);
  // No segment with records at all: the table does not claim any alarm or bound.
  const Z = monitorRun({ countsPath: csvFile('period,segment,blocked_or_suppressed,silent_omissions\n2026-W36,a,0,0\n2026-W37,a,0,0\n'), ...OMIT, ...SEG });
  const text = renderMonitor(Z);
  assert.match(text, /SEGMENTS  by segment .*no segment has records blocked or suppressed checked/);
  assert.doesNotMatch(text, /each with its own alarm and bound/);
});

test('L23: --segment-by naming a field no record has, the period or a counted column stops; segments whose names differ only by case are strict', () => {
  stops(() => monitorRun({ config: segConfig, runPaths: segRuns, ...SETTINGS, segmentBy: 'chanel' }), /\[L23\].*"chanel".*no record/s);
  stops(() => monitorRun({ countsPath: segCsv, ...SETTINGS, segmentBy: 'customer' }), /\[L23\].*no customer column.*found: period, segment/s);
  // The period or a column that is counted is not a segment: one stop, saying so.
  for (const col of ['period', 'silent_errors', 'Out Without Review']) {
    assert.throws(() => monitorRun({ countsPath: segCsv, ...SETTINGS, segmentBy: col }), e => {
      assert.match(e.message, /\[L23\].*--segment-by names .*the counts file's (period|count) column/s);
      assert.equal((e.message.match(/\[L/g) || []).length, 1);
      return true;
    });
  }
  assert.throws(() => monitorRun({ countsPath: segCsv, ...SETTINGS, segmentBy: ' ' }), /--segment-by needs the name of a field/);
  assert.throws(() => monitorRun({ config: segConfig, runPaths: segRuns, ...SETTINGS, segmentBy: '' }), /--segment-by needs the name of a field/);
  const twin = csvFile('period,segment,out_without_review,silent_errors\n2026-W36,Chat,10,0\n2026-W36,chat,10,0\n');
  stops(() => fromCounts(twin, SEG), /\* \[L23\].*"Chat" and "chat" differ only by case/s);
  const L = fromCounts(twin, { ...SEG, lenient: true });
  assert.equal(L.segments.rows.length, 2);
  assert.equal(traps(L, 'L23')[0].level, 'warn');
  // A segment column left empty in every row is the same mistake as a field no record has.
  stops(() => fromCounts(csvFile('period,segment,out_without_review,silent_errors\n2026-W36,,10,0\n2026-W37,,10,1\n'), SEG), /\[L23\].*segment column is empty in every row/);
  // A JSON counts file's segment that is not a label (an object) stops, as a group's does (H8).
  stops(() => fromCounts(countsFile([{ ...week(36, 10, 0), segment: { name: 'chat' } }]), SEG), /\[L23\].*segment must be text or a number/);
  // --segment-by names another column of a counts file: read loosely, as the other column names are.
  const other = fromCounts(csvFile('period,Customer,out_without_review,silent_errors\n2026-W36,north,10,0\n2026-W36,south,10,1\n'), { segmentBy: 'customer' });
  assert.deepEqual(other.segments.rows.map(r => r.segment), ['north', 'south']);
});

test('L22: a record in several segments counts in each, and the report says so', () => {
  const recs = JSON.parse(fs.readFileSync(segRun(40), 'utf8'));
  recs[0].channel = ['chat', 'email'];
  const f = tmp('2026-W40.json', JSON.stringify(recs));
  const R = monitorRun({ config: segConfig, runPaths: [f], ...SETTINGS, segmentBy: 'channel' });
  assert.deepEqual(R.segments.rows.map(r => [r.segment, r.records]), [['chat', 2], ['email', 2], ['(none)', 1]]);
  assert.equal(R.segments.records_in_several, 1);
  assert.match(renderMonitor(R), /1 record\(s\) carry several segments and count in each, so the segments add up to more than the 4 records/);
});

test('L26: a segmented counts file: a segment\'s rows in time order, each period once a segment, in any layout', () => {
  const text = fs.readFileSync(segCsv, 'utf8').trim().split('\n');
  const [head, ...rows] = text;
  const bySegment = [head, ...['chat', 'email', 'phone', ''].flatMap(s => rows.filter(r => r.split(',')[1] === s))].join('\n') + '\n';
  const G = monitorRun({ countsPath: segCsv, ...SETTINGS, ...SEG });
  const B = monitorRun({ countsPath: csvFile(bySegment), ...SETTINGS, ...SEG });
  assert.deepEqual(B.periods, G.periods);
  assert.deepEqual(B.segments.rows, G.segments.rows);
  stops(() => fromCounts(csvFile(head + '\n' + rows[3] + '\n' + rows[0] + '\n'), SEG), /\[L26\].*segment "chat".*2026-W36 comes after 2026-W37/s);
  stops(() => fromCounts(csvFile(head + '\n' + rows[0] + '\n' + rows[0] + '\n'), SEG), /\[L26\].*2026-W36 is given twice for segment "chat"/);
});

test('segments: the report reads right without a target, and with one segment only', () => {
  const N = renderMonitor(monitorRun({ countsPath: segCsv, acceptable: 2.5, ...SEG }));
  const table = N.slice(N.indexOf('SEGMENTS'));
  assert.doesNotMatch(table, /upper bound/);
  for (const line of table.split('\n')) assert.equal(line, line.trimEnd());
  const one = renderMonitor(fromCounts(csvFile('period,segment,out_without_review,silent_errors\n2026-W40,a,10,0\n2026-W41,a,10,1\n'), SEG));
  assert.doesNotMatch(one, /the 1 segments/);
});

test('L27: a total row among the segments: strict when in every period, a warning when in some, or equal to one other', () => {
  const lines = ['period,segment,out_without_review,silent_errors', '2026-W36,a,10,1', '2026-W36,b,20,0', '2026-W36,all,30,1', '2026-W37,a,10,0', '2026-W37,b,20,2', '2026-W37,all,30,2'];
  stops(() => fromCounts(csvFile(lines.join('\n') + '\n'), SEG), /\* \[L27\].*segment "all" holds the other segments added up/s);
  const L = fromCounts(csvFile(lines.join('\n') + '\n'), { ...SEG, lenient: true });
  assert.equal(traps(L, 'L27')[0].level, 'warn');
  // In one period only (the review's c8): counted twice there, so warned, naming the period.
  const some = fromCounts(csvFile('period,segment,out_without_review,silent_errors\n2026-W40,a,10,1\n2026-W40,b,20,0\n2026-W40,all,30,1\n2026-W41,a,10,0\n2026-W41,b,20,2\n'), SEG);
  assert.equal(traps(some, 'L27')[0].level, 'warn');
  assert.match(traps(some, 'L27')[0].message, /segment "all" holds 2 other segments added up in 2026-W40/);
  // Equal to one other segment in every period (the review's c9): a total of one, or a copy.
  const copy = fromCounts(csvFile('period,segment,out_without_review,silent_errors\n2026-W40,a,10,1\n2026-W40,Total,10,1\n2026-W41,a,10,0\n2026-W41,Total,10,0\n'), SEG);
  assert.equal(traps(copy, 'L27').length, 1);
  assert.match(traps(copy, 'L27')[0].message, /segments "Total" and "a" hold the same counts in every period/);
  // Clean segments: no note.
  assert.equal(traps(monitorRun({ countsPath: segCsv, ...SETTINGS, ...SEG }), 'L27').length, 0);
});

test('CLI: --watch, --segment-by and --segments', () => {
  const a = cli(['--config', path.join(segDir, 'config.json'), ...segRuns, '--watch', 'silent-omissions', '--target', '20', '--acceptable', '10', '--segment-by', 'channel']);
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /SEGMENTS  by channel/);
  assert.equal(cli(['--counts', csv, '--target', '5', '--watch', 'everything']).status, 1);
  const out = path.join(tmpDir, 'segments.json');
  const b = cli(['--counts', segCsv, '--target', '5', '--segment-by', 'segment', '--segments', 'chat,email,phone', '--json', out]);
  assert.equal(b.status, 0, b.stderr);
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(j.segments.declared, ['chat', 'email', 'phone']);
  assert.deepEqual(j.segments.rows.map(r => r.segment), ['chat', 'email', 'phone', '(none)']);
  assert.deepEqual([j.settings.false_alarm_every, j.settings.alarm_set_for, j.settings.alarm_at], [2000, 4000, 200]);
  assert.equal(cli(['--counts', segCsv, '--target', '5', '--segments', 'chat']).status, 1);
  // Every line of the segment table fits 100 columns.
  for (const line of b.stdout.split('\n').filter(l => /^  (segment|chat|email|phone|\(none\)) /.test(l))) assert.ok(line.length <= 100, line);
});

// ---------- Fixes from the newcomer test and the integration review ----------

const { cusumThreshold: levelOf } = require('../src/metrics/monitor.js');
// Segment a is shown under 12% in W36 and W37, and not after (30 silent errors a week from W38).
const SHOWN_THEN_NOT = 'period,segment,out_without_review,silent_errors\n2026-W36,a,100,0\n2026-W36,b,100,0\n2026-W37,a,100,0\n2026-W37,b,100,0\n' +
  '2026-W38,a,100,30\n2026-W38,b,100,0\n2026-W39,a,100,30\n2026-W39,b,100,0\n';

test('L34: a config with a split: monitor ignores it, and says once that a golden-set file shows both halves', () => {
  const splitCfg = { ...segConfig, split: { held_out: 0.5, salt: '', hash: 'sha256', by: 'id', log: null } };
  const R = monitorRun({ config: splitCfg, runPaths: segRuns, ...SETTINGS });
  const notes = traps(R, 'L34');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].level, 'warn');
  assert.match(notes[0].message, /the config has a split: monitor ignores it and reads every record in the period files.*both halves, the held-out half too.*split\.log does not count/s);
  assert.match(notes[0].message, /score with this config/);
  assert.deepEqual(R.periods, monitorRun({ config: segConfig, runPaths: segRuns, ...SETTINGS }).periods);
  assert.equal(traps(monitorRun({ config: segConfig, runPaths: segRuns, ...SETTINGS }), 'L34').length, 0);
});

test('L35: a period file without its answers stops (A8), and monitor says how to give the key: --keys', () => {
  const qDir = path.join(__dirname, 'fixtures', 'queue');
  assert.throws(() => monitorRun({ config: loadConfig(path.join(qDir, 'config.json')), runPaths: [path.join(qDir, 'predictions.json')], ...SETTINGS }), e => {
    assert.match(e.message, /\[A8\]/);
    assert.match(e.message, /monitor reads each period file as the run and its answer key at once.*put the key in a folder under the same name as the period file.*--keys <that folder>/s);
    return true;
  });
});

test('L37: a segment shown before and not now is said, and its "shown" rows keep their upper bound', () => {
  const G = fromCounts(csvFile(SHOWN_THEN_NOT), { target: 12, acceptable: 4, ...SEG });
  const a = bySeg(G, 'a');
  assert.deepEqual([a.bound.shown, a.bound.last_shown], [false, '2026-W37']);
  assert.match(renderMonitor(G), /Shown before, not now: a \(last in 2026-W37\)/);
  for (const r of G.segments.rows) for (const p of r.periods) if (p.shown) assert.ok(p.upper_pct !== null && p.upper_pct < 12, r.segment + ' ' + p.period);
});

test('segments: "shown" without --segments is provisional in every place it is printed, and the advice names the timing', () => {
  const G = fromCounts(csvFile(SHOWN_THEN_NOT), { target: 12, acceptable: 4, ...SEG });
  const text = renderMonitor(G);
  assert.match(text, /name the segments with --segments, chosen before the first period counted, to make it final/);
  assert.doesNotMatch(text, /name the segments with --segments to make it final/);
  // The per-period marks: the whole's table and the JSON rows.
  assert.match(text, /^  2026-W36 .*shown\*$/m);
  assert.match(text, /\* provisional: a segment that first appears later can take it back/);
  assert.ok(G.periods.filter(p => p.shown).every(p => p.provisional === true));
  assert.ok(bySeg(G, 'b').periods.filter(p => p.shown).every(p => p.provisional === true));
  // Named in advance: nothing provisional.
  const D = fromCounts(csvFile(SHOWN_THEN_NOT), { target: 12, acceptable: 4, ...SEG, segments: ['a', 'b'] });
  assert.ok(D.periods.every(p => p.provisional === undefined));
  assert.doesNotMatch(renderMonitor(D), /shown\*/);
});

test('report wording: one step, rate --target for the share left out, the header, and the bars in plain words first', () => {
  // A single period of 199 records: the alarm level is 1 step.
  const one = fromCounts(countsFile([week(36, 199, 34)]), { target: 20, acceptable: 10 });
  assert.equal(one.settings.alarm_at, 1);
  assert.match(renderMonitor(one), /Alarm level 1 step, for periods of 199 records/);
  // The share left out: a single test of fixed size is rate --target, not score --target.
  const O = monitorRun({ config: segConfig, runPaths: segRuns, ...OMIT });
  const ot = renderMonitor(O);
  assert.match(ot, /for one test of a size fixed in advance \(rate --target\)/);
  assert.match(ot, /rate: wrongly left out: of the blocked or suppressed records a person checked, the share that should have gone out or to a person/);
  assert.match(renderMonitor(M), /for one test of a size fixed in advance \(score --target\)/);
  // Segments: why the bars are higher, before the exact rule.
  const G = monitorRun({ countsPath: segCsv, ...SETTINGS, ...SEG });
  const gt = renderMonitor(G);
  assert.match(gt, /Because the whole and 4 segments are checked at once, each needs more evidence \(a higher bar\) before it is called shown; that keeps the chance of any wrong "shown" in this report at 5%/);
  assert.match(gt, /The exact rule: closed testing on a weighted average of their evidence/);
  assert.match(gt, /With segments, the whole is checked together with them, so it needs more evidence before it is called shown: a bar of 34\.2 here, against 20 alone/);
});

test('CLI: the monitor command\'s help fits 100 columns', () => {
  const h = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' }).stdout.split('\n');
  const from = h.findIndex(l => l.startsWith('  monitor ')), to = h.findIndex((l, i) => i > from && /^  \w/.test(l));
  assert.ok(from > 0 && to > from);
  for (const line of h.slice(from, to)) assert.ok(line.length <= 100, line.length + ': ' + line);
});

test('L36: segments that overlap: each segment\'s alarm is set for the budget times the memberships per record', () => {
  // W40 with W40-1 in chat and email: 4 records out without review, 5 memberships. Each segment is
  // set for 4,000 x 1.25 = 5,000 records, so the report in all keeps about one false alarm per 2,000.
  const recs = JSON.parse(fs.readFileSync(segRun(40), 'utf8'));
  recs[0].channel = ['chat', 'email'];
  const R = monitorRun({ config: segConfig, runPaths: [tmp('2026-W40.json', JSON.stringify(recs))], ...SETTINGS, segmentBy: 'channel' });
  assert.deepEqual(R.segments.overlap, { memberships: 5, records: 4, every_segment: 5000 });
  assert.equal(bySeg(R, 'chat').periods[0].cusum.alarm_at, levelOf(0.025, 0.05, 5000, 2));
  assert.equal(bySeg(R, 'email').periods[0].cusum.alarm_at, levelOf(0.025, 0.05, 5000, 2));
  assert.equal(R.settings.alarm_set_for, 4000);   // the whole keeps its half of the budget
  assert.match(renderMonitor(R), /each segment's alarm is set for 5,000 records/);
  // No record in two segments: as before, no overlap block.
  assert.equal(monitorRun({ config: segConfig, runPaths: segRuns, ...SETTINGS, segmentBy: 'channel' }).segments.overlap, undefined);
});
