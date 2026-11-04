#!/usr/bin/env node
// How long each command takes, and how much it holds in memory, on one copy of the code. Run it on
// two copies to measure a change before believing in it (docs/ENGINEERING.md: under about 5% is not
// worth a change unless the code also gets clearer).
//
//   node scripts/bench.js [<code dir>] [--repeats 5] [--sizes 10,100] [--out <file>]
//
// code dir  the copy to measure; by default the one this script is in
// repeats   each command is run this many times (at most 3 at the large sizes); wall time is the
//           median, and memory, CPU and file counts come from that median run
// sizes     how many times to tile the 500-record golden sets. The larger files are built for this
//           run, in a temp folder, from examples/: every id gets a suffix, and duplicates keep
//           pointing at their own tile's primary. --sizes "" leaves them out
// out       the rows as JSON; by default only printed
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs } = require('util');

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  repeats: { type: 'string' }, sizes: { type: 'string' }, out: { type: 'string' },
} });
const code = path.resolve(positionals[0] || path.join(__dirname, '..'));
const REPEATS = Number(values.repeats || 5);
const SIZES = (values.sizes === undefined ? '10,100' : values.sizes).split(',').filter(Boolean).map(Number);
const hook = path.join(__dirname, 'bench-hook.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-bench-'));
process.on('exit', () => fs.rmSync(work, { recursive: true, force: true }));
const sample = path.join(work, 'sample.json');

const G = 'examples/metadata-enrichment/golden500';
const C = 'examples/compliance-reviewer';
const runs = d => [70, 71, 72].map(n => d + '/exec-' + n + '.json');

// The golden sets, tiled.
function tile(records, times) {
  const all = [];
  for (let t = 0; t < times; t++) {
    for (const r of records) {
      const x = JSON.parse(JSON.stringify(r));
      x.id = r.id + '-' + t;
      if (x.expected && x.expected.duplicate_of) x.expected.duplicate_of += '-' + t;
      all.push(x);
    }
  }
  return all;
}
function scaled(times) {
  const dir = path.join(work, 'x' + times);
  fs.mkdirSync(dir);
  const source = path.join(code, G);
  for (const n of [70, 71, 72]) {
    fs.writeFileSync(path.join(dir, 'exec-' + n + '.json'), JSON.stringify(tile(JSON.parse(fs.readFileSync(path.join(source, 'exec-' + n + '.json'), 'utf8')), times)));
  }
  // The config, with its allowed-value files pointed back at the code.
  const cfg = JSON.parse(fs.readFileSync(path.join(source, 'config.json'), 'utf8'));
  for (const v of Object.values(cfg.allowed_values)) v.file = path.resolve(source, v.file).replace(/\\/g, '/');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
  return dir;
}

const cases = [
  ['help (startup)', ['--help']],
  ['rate (startup + one sum)', ['rate', '3', '100']],
  ['score tiny', ['score', '--config', 'test/fixtures/tiny/config.json', '--pred', 'test/fixtures/tiny/predictions.json', '--key', 'test/fixtures/tiny/key.json', '--quiet']],
  ['score 500', ['score', '--config', G + '/config.json', '--pred', G + '/exec-70.json', '--key', G + '/exec-70.json', '--quiet']],
  ['score 500 + html', ['score', '--config', G + '/config.json', '--pred', G + '/exec-70.json', '--key', G + '/exec-70.json', '--quiet', '--html', path.join(work, 'out.html')]],
  ['variance 3x500', ['variance', '--config', G + '/config.json', '--key', G + '/exec-70.json', ...runs(G)]],
  ['compare 500', ['compare', '--config', G + '/config.json', '--key', G + '/exec-70.json', '--before', G + '/exec-70.json', '--after', G + '/exec-71.json']],
  ['whatif gate 500', ['whatif', '--config', G + '/config.json', '--pred', G + '/exec-70.json', '--key', G + '/exec-70.json', '--gate', '--target', '10']],
  ['whatif policies 500', ['whatif', '--config', C + '/config.json', '--pred', C + '/golden500/exec-67.harness.json', '--key', C + '/golden500/exec-67.harness.json', '--policies', C + '/policies.json', '--target', '5']],
  ['suspects 3x500', ['suspects', '--config', G + '/config.json', '--key', G + '/exec-70.json', ...runs(G)]],
  ['check 500', ['check', '--config', G + '/config.json', '--pred', G + '/exec-70.json', '--key', G + '/exec-70.json']],
  ['agree fixture', ['agree', '--config', 'test/fixtures/agree/config.json', '--keys', 'test/fixtures/agree/ann.json', 'test/fixtures/agree/ben.json', 'test/fixtures/agree/cai.json', '--seed', '3']],
  ['monitor segments', ['monitor', '--counts', 'test/fixtures/monitor-segments/counts.csv', '--target', '5', '--acceptable', '2.5', '--segment-by', 'segment']],
  ['estimate fixture', ['estimate', '--config', 'test/fixtures/estimate/config.json', '--pred', 'test/fixtures/estimate/predictions.json', '--judge-key', 'test/fixtures/estimate/judge-key.json', '--key', 'test/fixtures/estimate/person-key.json']],
];
for (const times of SIZES) {
  const d = scaled(times);
  const cfg = path.join(d, 'config.json');
  const a = path.join(d, 'exec-70.json');
  const n = (500 * times).toLocaleString('en-US');
  cases.push(['score ' + n, ['score', '--config', cfg, '--pred', a, '--key', a, '--quiet']]);
  cases.push(['variance 3x' + n, ['variance', '--config', cfg, '--key', a, ...runs(d)]]);
  cases.push(['compare ' + n, ['compare', '--config', cfg, '--key', a, '--before', a, '--after', path.join(d, 'exec-71.json')]]);
  cases.push(['whatif gate ' + n, ['whatif', '--config', cfg, '--pred', a, '--key', a, '--gate', '--target', '10']]);
  cases.push(['suspects 3x' + n, ['suspects', '--config', cfg, '--key', a, ...runs(d)]]);
  cases.push(['check ' + n, ['check', '--config', cfg, '--pred', a, '--key', a]]);
}

const TIMEOUT = 300000;
const rows = [];
for (const [name, args] of cases) {
  const samples = [];
  const reps = /[0-9],[0-9]{3}/.test(name) ? Math.min(REPEATS, 3) : REPEATS;
  for (let i = 0; i < reps; i++) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(process.execPath, ['--require', hook, path.join(code, 'bin/wfeval.js'), ...args], { cwd: code, encoding: 'utf8', maxBuffer: 1 << 30, timeout: TIMEOUT, env: { ...process.env, BENCH_OUT: sample } });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    let m = {};
    try { m = JSON.parse(fs.readFileSync(sample, 'utf8')); } catch { /* it timed out */ }
    samples.push({ ms, code: r.status, timedOut: r.error ? r.error.code : null, ...m });
    if (r.error) break;
  }
  samples.sort((a, b) => a.ms - b.ms);
  const s = samples[Math.floor(samples.length / 2)];
  const row = { name, ms: Math.round(s.ms), peakMB: s.maxRSSkb ? Math.round(s.maxRSSkb / 1024) : null, cpuMs: s.userMs ? Math.round(s.userMs + s.sysMs) : null,
    reads: s.reads, readMB: s.readBytes ? Number((s.readBytes / 1048576).toFixed(1)) : null, exit: s.code, timedOut: s.timedOut };
  rows.push(row);
  console.log([name.padEnd(30), String(row.ms).padStart(8) + ' ms', String(row.peakMB).padStart(6) + ' MB', String(row.cpuMs).padStart(8) + ' cpu', 'reads ' + s.reads, 'exit ' + s.code, s.timedOut || ''].join('  '));
}
if (values.out) fs.writeFileSync(path.resolve(values.out), JSON.stringify(rows, null, 1));
