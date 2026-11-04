#!/usr/bin/env node
// Two checkouts of this repository, the same commands on both: what did a change really change?
// Runs every example run, every fixture variant, every command and the common error paths in each
// checkout, and compares stdout, stderr, the exit code and every file written (the time a report
// was generated is left out). A rate that moved shows up here even when every test passes.
//
//   node scripts/compare-versions.js <old dir> <new dir> [-v]
//
// Prints how many commands came out the same and lists the others; each difference is saved in a
// temp folder, named at the end. Exit 0 when every command is identical, 1 when any differs. The
// commands run from each checkout's own folder, so a file one of them lacks reads as a difference.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const verbose = process.argv.includes('-v');
const [oldArg, newArg] = process.argv.slice(2).filter(a => a !== '-v');
if (!newArg) {
  console.error('usage: node scripts/compare-versions.js <old dir> <new dir> [-v]');
  process.exit(2);
}
const OLD = path.resolve(oldArg), NEW = path.resolve(newArg);
for (const d of [OLD, NEW]) {
  if (!fs.existsSync(path.join(d, 'bin', 'wfeval.js'))) { console.error('no bin/wfeval.js in ' + d); process.exit(2); }
}
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-compare-'));

const cmds = [];
const add = (...a) => cmds.push(a);
const C = 'examples/compliance-reviewer', M = 'examples/metadata-enrichment', G = M + '/golden500';
// The files a folder holds in the new checkout.
const inFolder = d => fs.readdirSync(path.join(NEW, d));

// Every example run.
for (const f of inFolder(C + '/runs')) {
  add('score', '--config', C + '/config.json', '--pred', C + '/runs/' + f, '--key', C + '/key.json', '--json', '@J', '--html', '@H');
  add('score', '--config', C + '/config.notes-reviewed.json', '--pred', C + '/runs/' + f, '--key', C + '/key.json', '--lenient', '--target', '10');
  add('score', '--config', C + '/config.json', '--pred', C + '/runs/' + f, '--key', C + '/key.json', '--rulings', C + '/rulings.json', '--json', '@J');
  add('check', '--config', C + '/config.json', '--pred', C + '/runs/' + f, '--key', C + '/key.json');
}
for (const f of inFolder(M + '/runs')) {
  add('score', '--config', M + '/config.json', '--pred', M + '/runs/' + f, '--key', M + '/runs/' + f, '--json', '@J', '--html', '@H');
  add('whatif', '--config', M + '/config.json', '--pred', M + '/runs/' + f, '--key', M + '/runs/' + f, '--floor', '--json', '@J');
}
for (const f of inFolder(G)) {
  if (f === 'config.json' || f === 'config-split.json') continue;
  add('score', '--config', G + '/config.json', '--pred', G + '/' + f, '--key', G + '/' + f, '--json', '@J', '--html', '@H', '--target', '10');
  add('whatif', '--config', G + '/config.json', '--pred', G + '/' + f, '--key', G + '/' + f, '--gate', '--target', '10', '--json', '@J');
  add('check', '--config', G + '/config.json', '--pred', G + '/' + f, '--key', G + '/' + f);
}
add('score', '--config', C + '/config.json', '--pred', C + '/golden500/exec-67.json', '--key', C + '/golden500/exec-67.json', '--json', '@J', '--html', '@H');
add('score', '--config', C + '/config.json', '--pred', C + '/golden500/exec-67.harness.json', '--key', C + '/golden500/exec-67.harness.json', '--group-by', 'violations', '--fail-on', 'critical');
add('whatif', '--config', C + '/config.json', '--pred', C + '/golden500/exec-67.harness.json', '--key', C + '/golden500/exec-67.harness.json', '--hold-if', 'violations=*', '--target', '5', '--json', '@J');
add('variance', '--config', C + '/config.json', '--key', C + '/key.json', ...['50', '51', '52'].map(n => C + '/runs/exec-' + n + '.harness.json'), '--rulings', C + '/rulings.json', '--json', '@J');
add('compare', '--config', C + '/config.json', '--key', C + '/key.json', '--before', C + '/runs/exec-50.harness.json', '--after', C + '/runs/exec-59.harness.json', '--rulings', C + '/rulings.json', '--fail-if-worse', 'silent-errors,misroutes', '--json', '@J');

// Fixture variants.
const K = 'test/fixtures/clusters', Q = 'test/fixtures/queue', P = 'test/fixtures/policy', R = 'test/fixtures/rulings';
for (const p of ['predictions-clumped', 'predictions-even', 'predictions-perfect', 'predictions']) {
  for (const mix of ['mix', 'mix-golden', 'mix-story']) add('score', '--config', K + '/config.json', '--pred', K + '/' + p + '.json', '--key', K + '/key.json', '--group-by', 'section', '--cluster-by', 'story', '--mix', K + '/' + mix + '.json', '--json', '@J', '--html', '@H');
}
add('score', '--config', Q + '/config.json', '--pred', Q + '/predictions-after.json', '--key', Q + '/key.json', '--group-by', 'channel', '--mix', Q + '/mix.json', '--json', '@J', '--html', '@H');
add('whatif', '--config', P + '/combined/config.json', '--pred', P + '/combined/pred.json', '--key', P + '/combined/key.json', '--policies', P + '/combined/combined.json', '--target', '30', '--json', '@J');
add('score', '--config', P + '/combined/config.json', '--pred', P + '/combined/pred.json', '--key', P + '/combined/key.json');
for (const k of ['key', 'key-v2']) for (const r of ['rulings', 'rulings-unstated', 'tiny-rulings']) {
  add('score', '--config', R + '/config.json', '--pred', R + '/predictions.json', '--key', R + '/' + k + '.json', '--rulings', R + '/' + r + '.json', '--lenient', '--html', '@H');
  add('variance', '--config', R + '/config.json', '--key', R + '/' + k + '.json', R + '/predictions.json', R + '/predictions.json', '--rulings', R + '/' + r + '.json', '--lenient');
  add('compare', '--config', R + '/config.json', '--key', R + '/' + k + '.json', '--before', R + '/predictions.json', '--after', R + '/predictions.json', '--rulings', R + '/' + r + '.json', '--lenient');
}
for (const s of ['agent', 'api', 'combined', 'n8n', 'sheet']) {
  const ext = { agent: 'jsonl', api: 'json', combined: 'json', n8n: 'json', sheet: 'csv' }[s];
  add('score', '--config', 'test/fixtures/shapes/' + s + '.config.json', '--pred', 'test/fixtures/shapes/' + s + '.' + ext, '--key', 'test/fixtures/shapes/key.csv', '--json', '@J');
}
for (const [a, b] of [['a', 'b'], ['b', 'c'], ['a', 'c']]) {
  add('compare', '--config', 'test/fixtures/tiny/config.json', '--key', 'test/fixtures/tiny/key.json', '--before', 'test/fixtures/runs/run-' + a + '.json', '--after', 'test/fixtures/runs/run-' + b + '.json');
}
add('variance', '--config', 'test/fixtures/tiny/config.json', '--key', 'test/fixtures/tiny/key.json', 'test/fixtures/runs/run-a.json', 'test/fixtures/runs/run-b.json', 'test/fixtures/runs/run-c.json', '--json', '@J');

// The other commands.
const E = 'test/fixtures/estimate', A = 'test/fixtures/agree', F = 'test/fixtures/freetext', L = 'test/fixtures/monitor';
add('estimate', '--config', E + '/config.json', '--pred', E + '/predictions.json', '--judge-key', E + '/judge-key.json', '--key', E + '/person-key.json', '--json', '@J');
add('estimate', '--config', E + '/config.json', '--pred', E + '/predictions.json', '--judge-key', E + '/judge-key.json', '--key', E + '/person-key.json', '--target', '5', '--fail-if-not-shown');
add('estimate', '--config', E + '/config.json', '--pred', E + '/predictions.json', '--judge-key', E + '/judge-key.json', '--pick', '20', '--seed', '7', '--json', '@J');
add('agree', '--config', A + '/config.json', '--keys', A + '/ann.json', A + '/ben.json', '--json', '@J', '--seed', '3', '--resamples', '500');
add('agree', '--config', A + '/config.json', '--keys', A + '/ann.json', A + '/ben.json', A + '/cai.json', '--write-key', '@J', '--names', 'a,b,c');
add('agree', '--config', A + '/config.json', '--keys', A + '/ann.json', A + '/ben.json', A + '/cai.json', '--output', 'verdict', '--lenient');
add('agree', '--grades', F + '/grades-a.json', F + '/grades-b.json', '--json', '@J');
add('score', '--grades', F + '/grades-a.json', '--json', '@J', '--fail-on', 'high');
add('grade', '--config', F + '/grading.json', '--pred', F + '/forms.json', '--out', '@H');
add('rate', '0', '30', '--target', '10', '--chance', '0.9', '--json', '@J');
add('rate', '3', '3');
add('monitor', '--counts', L + '/counts.json', '--target', '5', '--json', '@J', '--fail-on-alarm');
add('monitor', '--config', L + '/config.json', L + '/runs/2026-W40.json', L + '/runs/2026-W41.json', L + '/runs/2026-W42.json', '--target', '5', '--since', '2026-W41', '--json', '@J');

// Error paths.
add('score', '--config', 'nope.json', '--pred', 'x', '--key', 'y');
add('score', '--config', 'test/fixtures/tiny/config.json');
add('score', '--config', 'test/fixtures/tiny/config.json', '--pred', 'test/fixtures/tiny/predictions.json', '--key', 'test/fixtures/tiny/key.json', '--bogus');
add('score', '--config', 'test/fixtures/tiny/config.json', '--pred', 'test/fixtures/tiny/predictions.json', '--key', 'test/fixtures/tiny/key.json', '--rulings', 'test/fixtures/rulings/rulings.json');
add('variance', '--config', 'test/fixtures/tiny/config.json', '--key', 'test/fixtures/tiny/key.json', 'test/fixtures/tiny/predictions.json');
add('whatif', '--config', 'test/fixtures/tiny/config.json', '--pred', 'test/fixtures/tiny/predictions.json', '--key', 'test/fixtures/tiny/key.json');
add('whatif', '--config', 'test/fixtures/tiny/config.json', '--pred', 'test/fixtures/tiny/predictions.json', '--key', 'test/fixtures/tiny/key.json', '--gate', '--rulings', 'x');
add('suspects');
add('nosuch');
add('monitor', '--counts', L + '/counts.csv', '--segments', 'a,b');
add('monitor', '--counts', L + '/counts.csv', '--segment-by', 'x');

// Suspects, a split, and segments.
const T = 'test/fixtures/suspects', Z = 'test/fixtures/split', W = 'test/fixtures/gate', Y = 'test/fixtures/monitor-segments';
add('suspects', '--config', T + '/config.json', '--key', T + '/key.json', T + '/run-a.json', '--json', '@J');
add('suspects', '--config', T + '/config.json', '--key', T + '/key.json', T + '/run-a.json', T + '/run-b.json', '--rulings', T + '/rulings.json', '--json', '@J', '--top', '3');
add('suspects', '--config', T + '/config-split.json', '--key', T + '/key.json', T + '/run-a.json', T + '/run-b.json', '--rulings', T + '/rulings-pending.json');
add('suspects', '--config', C + '/config.json', '--key', C + '/runs/exec-56.harness.json', ...[56, 57, 58, 59].map(n => C + '/runs/exec-' + n + '.harness.json'), '--rulings', C + '/rulings.json', '--json', '@J');
add('suspects', '--config', C + '/config-split.json', '--key', C + '/runs/exec-56.harness.json', ...[56, 57, 58, 59].map(n => C + '/runs/exec-' + n + '.harness.json'), '--json', '@J');
add('suspects', '--config', G + '/config.json', '--key', G + '/exec-70.json', G + '/exec-70.json', G + '/exec-71.json', G + '/exec-72.json', '--json', '@J');
for (const p of ['predictions', 'predictions-v2', 'predictions-v3', 'predictions-v4']) {
  add('score', '--config', Z + '/config.json', '--pred', Z + '/' + p + '.json', '--key', Z + '/key.json', '--json', '@J', '--html', '@H', '--target', '40');
  add('score', '--config', Z + '/config.json', '--pred', Z + '/' + p + '.json', '--key', Z + '/key.json', '--json', '@J', '--html', '@H', '--target', '40', '--held-out');
  add('score', '--config', Z + '/config.json', '--pred', Z + '/' + p + '.json', '--key', Z + '/key.json', '--show-held-out');
}
add('check', '--config', Z + '/config.json', '--pred', Z + '/predictions.json', '--key', Z + '/key.json');
add('check', '--config', Z + '/config.json', '--pred', Z + '/predictions.json', '--key', Z + '/key-unbalanced.json');
add('compare', '--config', Z + '/config.json', '--key', Z + '/key.json', '--before', Z + '/predictions.json', '--after', Z + '/predictions-v2.json', '--held-out', '--json', '@J');
add('variance', '--config', Z + '/config.json', '--key', Z + '/key.json', Z + '/predictions.json', Z + '/predictions-v2.json', Z + '/predictions-v3.json', '--held-out', '--json', '@J');
add('whatif', '--config', Z + '/gate.json', '--pred', W + '/predictions.json', '--key', W + '/key.json', '--gate', '--target', '40', '--held-out', '--json', '@J');
add('whatif', '--config', Z + '/gate.json', '--pred', W + '/predictions.json', '--key', W + '/key.json', '--policies', Z + '/policies.json', '--target', '40', '--held-out');
add('whatif', '--config', C + '/config-split.json', '--pred', C + '/golden500/exec-67.harness.json', '--key', C + '/golden500/exec-67.harness.json', '--policies', C + '/policies.json', '--target', '5', '--held-out', '--json', '@J');
add('variance', '--config', G + '/config-split.json', '--key', G + '/exec-70.json', G + '/exec-70.json', G + '/exec-71.json', G + '/exec-72.json', '--held-out', '--json', '@J');
add('monitor', '--counts', Y + '/counts.csv', '--target', '5', '--acceptable', '2.5', '--segment-by', 'segment', '--json', '@J');
add('monitor', '--counts', Y + '/counts.csv', '--target', '5', '--acceptable', '2.5', '--segment-by', 'segment', '--segments', 'chat,email', '--json', '@J');
add('monitor', '--config', Y + '/config.json', Y + '/runs/2026-W40.json', Y + '/runs/2026-W41.json', Y + '/runs/2026-W42.json', '--watch', 'silent-omissions', '--target', '20', '--acceptable', '10', '--segment-by', 'channel', '--json', '@J');
add('monitor', '--config', Y + '/config.json', Y + '/runs/2026-W40.json', Y + '/runs/2026-W41.json', Y + '/runs/2026-W42.json', '--target', '20', '--acceptable', '5', '--segment-by', 'channel');
add('--help');

// @J and @H stand for a JSON and an HTML file written to a folder of the run's own.
const norm = s => s.replace(/"generated(_at)?": "[^"]*"|generated [0-9T:.\-Z]+|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, 'GEN');
function runIn(root, dir, cmd, i) {
  fs.mkdirSync(dir, { recursive: true });
  const files = {};
  const args = cmd.map(a => (a === '@J' ? (files.J = path.join(dir, i + '.json')) : a === '@H' ? (files.H = path.join(dir, i + '.html')) : a));
  const r = spawnSync(process.execPath, ['bin/wfeval.js', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  // A message that names a file names it in full: the checkout's own folder is not a difference.
  const strip = t => norm(t.split(dir).join('OUT').split(root).join('ROOT'));
  return { code: r.status, stdout: strip(r.stdout), stderr: strip(r.stderr),
    files: Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.existsSync(f) ? norm(fs.readFileSync(f, 'utf8')) : null])) };
}

let same = 0;
const diffs = [];
cmds.forEach((cmd, i) => {
  const o = runIn(OLD, path.join(OUT, 'old'), cmd, i), n = runIn(NEW, path.join(OUT, 'new'), cmd, i);
  const what = [];
  if (o.code !== n.code) what.push('exit ' + o.code + ' -> ' + n.code);
  if (o.stdout !== n.stdout) what.push('stdout');
  if (o.stderr !== n.stderr) what.push('stderr');
  for (const k of Object.keys(o.files)) if (o.files[k] !== n.files[k]) what.push('file ' + k);
  if (what.length) {
    diffs.push(i + ' [' + what.join(', ') + '] ' + cmd.join(' ').slice(0, 200));
    fs.writeFileSync(path.join(OUT, 'd' + i + '.old'), o.stdout + '\n---\n' + o.stderr + '\n---\n' + JSON.stringify(o.files));
    fs.writeFileSync(path.join(OUT, 'd' + i + '.new'), n.stdout + '\n---\n' + n.stderr + '\n---\n' + JSON.stringify(n.files));
  } else same++;
  if (verbose) console.log(i, o.code, cmd.join(' ').slice(0, 100));
});
console.log(cmds.length + ' commands; identical: ' + same + '; different: ' + diffs.length);
for (const d of diffs) console.log('  ' + d);
if (diffs.length) console.log('each difference is in ' + OUT + ' (d<number>.old and .new)');
else fs.rmSync(OUT, { recursive: true, force: true });
process.exitCode = diffs.length ? 1 : 0;
