// Scores one run: load and pair the files, judge every record, compute every metric.
// Returns one results object; the terminal, JSON and HTML reports all render this same
// object, so they cannot disagree with each other.

const { problems } = require('./problems.js');
const { loadRun } = require('./load.js');
const { judgeAll } = require('./metrics/judge.js');
const { scoreQuality } = require('./metrics/classification.js');
const { scoreRouting } = require('./metrics/routing.js');
const { scoreTraps } = require('./metrics/traps.js');
const { scoreCalibration } = require('./metrics/calibration.js');

// Per-record summary kept in the results, for reports and for comparing runs.
function recordSummary(j) {
  return {
    id: j.id, route: j.route, route_class: j.route_class, gold_route: j.gold_route, gold_class: j.gold_class,
    traps: j.traps, needs_human: j.needs_human,
    silent: j.silent, omission: j.omission, safeguards: j.safeguards, wasted_review: j.wasted_review,
    differences: j.values,
  };
}

// Every metric from paired records. Pure: no files, no problems collector. Used by
// score, variance, compare and what-if alike.
function scoreRecords(records, config) {
  const judgments = judgeAll(records, config);
  return {
    routing: scoreRouting(judgments, config),
    quality: scoreQuality(records, config),
    traps: scoreTraps(judgments, config),
    calibration: scoreCalibration(records, config),
    records: judgments.map(recordSummary),
  };
}

function scoreRun({ config, predPath, keyPath, mode = 'strict' }) {
  const p = problems(mode);
  const run = loadRun({ config, predPath, keyPath, mode, p });
  const results = scoreRecords(run.records, config);

  // H5: trap types with too few records to prove anything.
  if (results.traps) {
    for (const t of results.traps.coverage.below) {
      p.strict('H5', keyPath, 'trap "' + t.trap + '" has ' + t.records + ' record(s); min_per_trap is ' + config.min_per_trap +
        '. One record passing a trap can be luck.');
    }
  }
  p.throwIfStopped();

  return {
    inputs: { predictions: predPath, key: keyPath, mode, wrong_when: config.wrong_when },
    ...results,
    problems: p.items,
    paired: run.records,   // the paired records themselves; not written to the JSON results
  };
}

// ---------- Across runs ----------

const fs = require('fs');
const crypto = require('crypto');
const { varianceOf, compareOf } = require('./metrics/runs.js');

const fingerprint = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// N result files from repeated runs of identical code: mean and spread per metric.
function varianceRun({ config, keyPath, predPaths, mode = 'strict' }) {
  // I1: the spread of one number is meaningless.
  if (predPaths.length < 2) throw new Error('[I1] variance needs two or more runs, got ' + predPaths.length);
  const notes = [];
  // I3: the same run passed twice makes the runs look more stable than they are.
  const seen = new Map();
  for (const f of predPaths) {
    const h = fingerprint(f);
    if (seen.has(h)) notes.push({ level: 'warn', trap: 'I3', where: f, message: 'has exactly the same content as ' + seen.get(h) + '; the spread will look smaller than it is' });
    else seen.set(h, f);
  }
  const runs = predPaths.map(f => ({ label: f, results: scoreRun({ config, predPath: f, keyPath, mode }) }));
  notes.push(...failedCallNotes(runs));
  return { inputs: { key: keyPath, runs: predPaths, mode }, ...varianceOf(runs, config), problems: notes };
}

// I6: a run where model calls failed is measuring the failures (every failed record went to a
// person), not the workflow. Comparing it with clean runs mixes the two.
function failedCallNotes(runs) {
  return runs.filter(r => r.results.quality.left_out.model_failed.length > 0).map(r => ({
    level: 'warn', trap: 'I6', where: r.label,
    message: r.results.quality.left_out.model_failed.length + ' model call(s) failed in this run; its numbers reflect those failures, not the workflow. Rerun it before comparing.',
  }));
}

// Two runs, and optionally repeated runs of identical code to judge them against.
function compareRun({ config, keyPath, beforePath, afterPath, noisePaths = [], mode = 'strict' }) {
  const before = scoreRun({ config, predPath: beforePath, keyPath, mode });
  const after = scoreRun({ config, predPath: afterPath, keyPath, mode });
  const noise = noisePaths.length ? varianceRun({ config, keyPath, predPaths: noisePaths, mode }) : null;
  const problems = [...failedCallNotes([{ label: beforePath, results: before }, { label: afterPath, results: after }]), ...(noise ? noise.problems : [])];
  return { inputs: { key: keyPath, before: beforePath, after: afterPath, noise: noisePaths, mode }, ...compareOf(before, after, noise), problems };
}

module.exports = { scoreRun, scoreRecords, varianceRun, compareRun };
