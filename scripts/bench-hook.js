// Loaded before the command with --require (scripts/bench.js): counts file operations, and writes
// them with peak memory and CPU time to the file in BENCH_OUT when the process ends.
const fs = require('fs');

const c = { reads: 0, readBytes: 0, writes: 0, stats: 0 };
const wrap = (name, on) => { const o = fs[name]; fs[name] = function (...a) { const r = o.apply(this, a); on(r, a); return r; }; };
wrap('readFileSync', r => { c.reads++; c.readBytes += r.length; });
wrap('writeFileSync', () => { c.writes++; });
for (const n of ['existsSync', 'statSync', 'readdirSync']) wrap(n, () => { c.stats++; });
const write = fs.writeFileSync;
process.on('exit', () => {
  const u = process.resourceUsage();
  write.call(fs, process.env.BENCH_OUT, JSON.stringify({ ...c, maxRSSkb: u.maxRSS, userMs: u.userCPUTime / 1000, sysMs: u.systemCPUTime / 1000 }));
});
