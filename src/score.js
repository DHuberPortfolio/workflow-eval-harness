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

module.exports = { scoreRun, scoreRecords };
