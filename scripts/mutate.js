#!/usr/bin/env node
// Mutation testing with no dependencies: does the test suite notice when the code is wrong?
// One small change at a time (a < for a <=, an && for an ||, a + for a -) in a throwaway copy of
// the code. If the whole suite and the sample reports still pass, the change survived: the tests
// cannot see that mistake. Each survivor is then a question: can the change matter at all, and if
// it can, should a test say so?
//
//   node scripts/mutate.js [--count 400] [--seed 1] [--workers 4] [--filter <regex>] [--out <file>]
//
// count    about how many changes to try, shared among the files by how many places each has,
//          at least 2 a file (a count too small for that is taken at random from them all);
//          --filter narrows the files, by a regex on their path
// seed     the same seed picks the same changes, on the same code
// workers  copies of the code run side by side; each change runs the whole suite (about 20
//          seconds on four cores), so 400 changes take about an hour
// out      where the results go; by default a new folder in the system's temp folder. A line for
//          each change: where it is, what it changed, and its outcome: caught (a test failed),
//          caught-by-samples (the suite passed but a sample report changed), timeout or SURVIVED
//
// Comments, strings on one line, require lines and exports are left alone. A template literal over
// several lines is not told from code, so the usage text and the grading page's styles get changes
// of their own: read those survivors as noise.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { parseArgs } = require('util');

const { values } = parseArgs({ options: {
  count: { type: 'string' }, seed: { type: 'string' }, workers: { type: 'string' }, filter: { type: 'string' }, out: { type: 'string' },
} });
const code = path.resolve(__dirname, '..');
const COUNT = Number(values.count || 400);
const WORKERS = Number(values.workers || 4);
const filter = values.filter ? new RegExp(values.filter) : /./;
const OUT = values.out ? path.resolve(values.out) : path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-mutate-')), 'results.json');
if (!(COUNT > 0) || !(WORKERS > 0) || !Number.isInteger(Number(values.seed || 1))) throw new Error('--count, --seed and --workers must be whole numbers');

let s = Number(values.seed || 1) >>> 0;
const rand = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const OPS = [
  [/<=/g, '<'], [/>=/g, '>'], [/(?<![<=!>])<(?![<=])/g, '<='], [/(?<![=>-])>(?![>=])/g, '>='],
  [/===/g, '!=='], [/!==/g, '==='], [/&&/g, '||'], [/\|\|/g, '&&'], [/\?\?/g, '&&'],
  [/Math\.min\b/g, 'Math.max'], [/Math\.max\b/g, 'Math.min'], [/Math\.floor\b/g, 'Math.ceil'], [/Math\.ceil\b/g, 'Math.floor'],
  [/ \+ 1\b/g, ' - 1'], [/ - 1\b/g, ' + 1'], [/ \+ /g, ' - '], [/ - /g, ' + '], [/ \* /g, ' / '], [/ \/ /g, ' * '],
  [/\btrue\b/g, 'false'], [/\bfalse\b/g, 'true'], [/\b0\b/g, '1'], [/\b1\b/g, '2'], [/\b100\b/g, '101'], [/1\.96/g, '1.65'],
  [/(?<![!=\w)\]])!(?=[a-zA-Z(])/g, ''], [/\.filter\(/g, '.map('], [/\.some\(/g, '.every('], [/\.every\(/g, '.some('],
];

// Blanks out strings and comments, so only code is changed.
function shadow(line) {
  let out = line.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\/(?![/*\s])(?:[^/\\\n]|\\.)+\/[gimsuy]*(?=[.,;)\s])/g, m => ' '.repeat(m.length));
  const c = out.indexOf('//');
  if (c >= 0) out = out.slice(0, c) + ' '.repeat(out.length - c);
  return out;
}
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
const rel = f => path.relative(code, f).replace(/\\/g, '/');

function sitesIn(file) {
  const sites = [];
  let inBlock = false;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (inBlock) { if (t.includes('*/')) inBlock = false; return; }
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return; }
    if (t.startsWith('*') || t.startsWith('//') || /\brequire\(/.test(t) || /^module\.exports/.test(t)) return;
    const sh = shadow(line);
    for (const [re, to] of OPS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(sh)) !== null) { sites.push({ file: rel(file), line: i, col: m.index, len: m[0].length, from: m[0], to }); if (m[0].length === 0) re.lastIndex++; }
    }
  });
  return sites;
}

const files = [...walk(path.join(code, 'src')), ...walk(path.join(code, 'bin'))].filter(f => filter.test(rel(f)));
const byFile = files.map(sitesIn);
const allSites = byFile.reduce((t, x) => t + x.length, 0);
// Each file gets a share of the sample in proportion to its places, at least 2.
const shares = shuffle(byFile.flatMap(sites => shuffle(sites).slice(0, Math.max(2, Math.round((COUNT * sites.length) / allSites)))));
const pick = COUNT < 2 * files.length ? shares.slice(0, COUNT) : shares;
console.log('source files ' + files.length + ', places to change ' + allSites + ', trying ' + pick.length + ', workers ' + WORKERS);

// The test runner's own flag is newer than the oldest Node this project runs on.
const suite = ['--test', ...(process.allowedNodeEnvironmentFlags.has('--test-concurrency') ? ['--test-concurrency=4'] : [])];
const samplesHash = dir => {
  const d = path.join(dir, 'docs', 'samples');
  const h = crypto.createHash('sha256');
  for (const f of fs.readdirSync(d).sort()) if (f.endsWith('.html')) h.update(fs.readFileSync(path.join(d, f)));
  return h.digest('hex');
};
const buildSamples = dir => spawnSync(process.execPath, ['scripts/build-samples.js'], { cwd: dir, stdio: 'ignore', timeout: 60000 });

const results = [];
const clean = new Map();
const workDir = path.dirname(OUT);
let next = 0;
const started = Date.now();

function runOne(dir, m) {
  return new Promise(resolve => {
    const file = path.join(dir, m.file);
    const orig = fs.readFileSync(file, 'utf8');
    const lines = orig.split('\n');
    const before = lines[m.line];
    lines[m.line] = before.slice(0, m.col) + m.to + before.slice(m.col + m.len);
    fs.writeFileSync(file, lines.join('\n'));
    const child = spawn(process.execPath, suite, { cwd: dir, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 240000);
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      let outcome = signal ? 'timeout' : status === 0 ? 'SURVIVED' : 'caught';
      if (outcome === 'SURVIVED') {
        const r = buildSamples(dir);
        if (r.status !== 0 || samplesHash(dir) !== clean.get(dir)) outcome = 'caught-by-samples';
        fs.writeFileSync(file, orig);
        buildSamples(dir);
      } else fs.writeFileSync(file, orig);
      resolve({ outcome, before: before.trim(), after: lines[m.line].trim() });
    });
  });
}

async function worker(w) {
  const dir = path.join(workDir, 'copy-' + process.pid + '-' + w);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(code, dir, { recursive: true, filter: p => !/[\\/](\.git|node_modules)([\\/]|$)/.test(p) });
  buildSamples(dir);
  clean.set(dir, samplesHash(dir));
  if (w === 0) {
    // A change can only be caught by a suite that passes without it.
    const base = spawnSync(process.execPath, suite, { cwd: dir, stdio: 'ignore' });
    if (base.status !== 0) { console.error('the suite fails on the unchanged code: fix that first'); process.exit(1); }
  }
  while (next < pick.length) {
    const m = pick[next++];
    results.push({ ...m, ...await runOne(dir, m) });
    if (results.length % 25 === 0) {
      fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
      console.log(results.length + '/' + pick.length + ', survived ' + results.filter(x => x.outcome === 'SURVIVED').length + ' after ' + Math.round((Date.now() - started) / 1000) + 's');
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(w))).then(() => {
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  const survived = results.filter(x => x.outcome === 'SURVIVED');
  console.log('\ncaught ' + (results.length - survived.length) + ' of ' + results.length + '; survived ' + survived.length);
  const per = {};
  for (const r of results) { const p = (per[r.file] = per[r.file] || { n: 0, s: 0 }); p.n++; if (r.outcome === 'SURVIVED') p.s++; }
  for (const [f, p] of Object.entries(per).sort((a, b) => b[1].s - a[1].s)) if (p.s) console.log(f.padEnd(34), p.s + ' of ' + p.n);
  for (const x of survived) console.log('  ' + x.file + ':' + (x.line + 1) + '  ' + x.from + ' -> ' + x.to);
  console.log('results: ' + OUT);
});
