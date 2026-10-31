// Scores one run: load and pair the files, judge every record, compute every metric.
// Returns one results object; the terminal, JSON and HTML reports all render this same
// object, so they cannot disagree with each other.

const { problems } = require('./problems.js');
const { loadRun, loadKey } = require('./load.js');
const { applyRulings, addToKey, annotateGaps } = require('./rulings.js');
const { judgeAll, judgeRecord, buildContext } = require('./metrics/judge.js');
const { scoreQuality } = require('./metrics/classification.js');
const { scoreRouting } = require('./metrics/routing.js');
const { scoreTraps } = require('./metrics/traps.js');
const { scoreGroups } = require('./metrics/groups.js');
const { scoreClusters } = require('./metrics/clusters.js');
const { scoreMix } = require('./metrics/mix.js');
const { scoreCalibration } = require('./metrics/calibration.js');
const { targetCheck } = require('./metrics/target.js');

// Per-record summary kept in the results, for reports and for comparing runs.
function recordSummary(j) {
  return {
    id: j.id, route: j.route, route_class: j.route_class, gold_route: j.gold_route, gold_class: j.gold_class,
    traps: j.traps, needs_human: j.needs_human,
    silent: j.silent, omission: j.omission, safeguards: j.safeguards, wasted_review: j.wasted_review, key_leaves_out: j.key_leaves_out,
    differences: j.values,
  };
}

// Every metric from paired records. Pure: no files, no problems collector. Used by
// score, variance, compare and what-if alike. `groups` only when the config has groups.
function scoreRecords(records, config) {
  const judgments = judgeAll(records, config);
  const groups = scoreGroups(judgments, config, records);
  return {
    routing: scoreRouting(judgments, config, records),
    quality: scoreQuality(records, config),
    traps: scoreTraps(judgments, config),
    ...(groups ? { groups } : {}),
    calibration: scoreCalibration(records, config),
    records: judgments.map(recordSummary),
  };
}

// target: a percentage the silent error rate should be shown to be under (5 for 5%), or null.
// chance: the probability the plan for that target aims at.
// rulings: a rulings file read by loadRulings (rulings.js), or null. Its adds join the answer
// key for scoring, in memory only; results.rulings says what they were (trap I11).
// mix: a mix file read by loadMix (mix.js), or null. results.mix is the silent error rate weighted
// to that real mix of traffic (traps G18-G21); nothing else in the results changes.
function scoreRun({ config, predPath, keyPath, mode = 'strict', target = null, chance = 0.8, rulings = null, mix = null }) {
  const p = problems(mode);
  const run = loadRun({ config, predPath, keyPath, mode, p });
  const ruled = rulings ? applyRulings(rulings, run.key, config, p) : null;
  const records = ruled ? addToKey(run.records, ruled.added) : run.records;
  const results = scoreRecords(records, config);
  // The silent error rate's range counting clusters (trap G14): only with clusters in the config.
  const clusters = scoreClusters(results.records, records, config);
  if (clusters) results.clusters = clusters;
  // The rate on a real mix (trap G18). Its stops (G19-G21) join the run's, reported together below.
  if (mix) {
    const m = scoreMix(mix, results.records, records, config, { key: keyPath, predictions: predPath }, p);
    if (m) results.mix = m;
  }
  if (target !== null) {
    const se = results.routing.silent_errors.rate;
    results.target = targetCheck(se.n, se.d, target, { chance, out_of: { n: se.d, d: results.routing.total } });
  }

  // H5: trap types with too few records to prove anything.
  if (results.traps) {
    for (const t of results.traps.coverage.below) {
      p.strict('H5', keyPath, 'trap "' + t.trap + '" has ' + t.records + ' record(s); min_per_trap is ' + config.min_per_trap +
        '. One record passing a trap can be luck.');
    }
  }
  p.throwIfStopped();
  results.key_gaps = keyGapsOf(records, results, config, ruled);
  if (ruled) results.rulings = { ...ruled, if_pending_added: pendingAdded(records, results, config, ruled) };

  return {
    inputs: { predictions: predPath, key: keyPath, mode, wrong_when: config.wrong_when, ...(rulings ? { rulings: rulings.file } : {}), ...(mix ? { mix: mix.file } : {}) },
    ...results,
    problems: p.items,
    paired: records,   // the paired records themselves (with any added values); not written to the JSON results
  };
}

// Trap I16: possible key gaps from this one run, since repeated runs cost money. The values
// applied that the key does not list, with the exclusions variance makes (keyGapCandidates:
// not invented, inherited, suppressed or from a failed model call; never an any_of alternative).
// Each is marked with the silent error it sits on, if any, and the types that would be left if
// every gap listed on that record were added to the key: none left means a ruling could clear
// it; a route type left (the key sends the record to a person) means no ruling can.
// Silent errors first, then the records' order.
function keyGapsOf(records, results, config, ruled) {
  let candidates = keyGapCandidates([{ results: { paired: records } }], config).filter(c => c.applied === 1)
    .map(c => ({ id: c.id, output: c.output, value: c.value, confidence: c.confidence ? c.confidence.max : null }));
  let rejected = 0;
  if (ruled) ({ candidates, rejected } = annotateGaps(candidates, ruled));
  const silent = new Map(results.records.map(x => [x.id, x.silent]));
  const byId = new Map(records.map(r => [r.id, r]));
  const ctx = buildContext(records);   // adding values to a key changes no route, so one context serves
  const left = new Map();
  for (const id of new Set(candidates.map(c => c.id))) {
    if (!silent.get(id)) continue;
    const j = judgeRecord(addToKey([byId.get(id)], candidates.filter(c => c.id === id))[0], config, ctx);
    left.set(id, j.silent ? j.silent.types : []);
  }
  const marked = candidates.map(({ id, output, value, confidence, ...ruling }) => ({
    id, output, value, confidence,
    silent_error: silent.get(id) ? { types: silent.get(id).types, if_added: left.get(id) } : null,
    ...ruling,
  }));
  return { candidates: [...marked.filter(c => c.silent_error), ...marked.filter(c => !c.silent_error)], rejected };
}

// Trap I15: a pending ruling is scored as wrong, the strict reading. Scored again with every
// pending ruling as an add, the two silent error rates bracket the rate once they are ruled,
// provided this run applied each pending value: adding an applied value to the key can only
// clear a wrong value, so each record can only go from silent to not as rulings become adds,
// and the base (records out without review) does not depend on the key. A pending value this
// run did not apply would be a miss once added, so those are named: with any, it is no bracket.
function pendingAdded(records, results, config, ruled) {
  if (ruled.pending.length === 0) return null;
  const alt = scoreRecords(addToKey(records, ruled.pending), config).routing.silent_errors;
  const was = new Set(results.routing.silent_errors.records.map(x => x.id));
  const now = new Set(alt.records.map(x => x.id));
  const byId = new Map(records.map(r => [r.id, r]));
  const applied = x => byId.get(x.id).pred[x.output].some(v => v.applied && v.value === x.value);
  return {
    pending: ruled.pending.length,
    not_applied: ruled.pending.filter(x => !applied(x)).map(({ id, output, value }) => ({ id, output, value })),
    silent_errors: alt.rate,
    cleared: [...was].filter(id => !now.has(id)),
    became: [...now].filter(id => !was.has(id)),
  };
}

// What a rulings file did, without score's bracket: for variance and compare, which report it once.
function rulingsSummary(results) {
  const { if_pending_added, ...rest } = results.rulings;
  return rest;
}
// The rulings file's own clean-ups and warnings in one run's problems. Every run of a variance
// or compare reads the same file, so these are reported once, not once per run.
const rulingNotes = (results, file) => results.problems.filter(i => i.level !== 'stop' && i.where.startsWith(file + ' rulings['));

// ---------- Across runs ----------

const fs = require('fs');
const crypto = require('crypto');
const { varianceOf, compareOf, keyGapCandidates } = require('./metrics/runs.js');

const fingerprint = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// N result files from repeated runs of identical code: mean and spread per metric.
// rulings: as for scoreRun; every run is scored against the key plus its adds, and the
// possible key gaps carry their rulings, rejected ones counted rather than listed.
function varianceRun({ config, keyPath, predPaths, mode = 'strict', rulings = null }) {
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
  const runs = predPaths.map(f => ({ label: f, results: scoreRun({ config, predPath: f, keyPath, mode, rulings }) }));
  notes.push(...failedCallNotes(runs));
  const v = varianceOf(runs, config);
  if (rulings) {
    // One key, so the rulings apply alike to every run: reported once, from the first.
    const { candidates, rejected } = annotateGaps(v.records.key_gap_candidates, runs[0].results.rulings);
    v.records.key_gap_candidates = candidates;
    v.records.key_gaps_rejected = rejected;
    v.rulings = rulingsSummary(runs[0].results);
    notes.push(...rulingNotes(runs[0].results, rulings.file));
  }
  return { inputs: { key: keyPath, runs: predPaths, mode, ...(rulings ? { rulings: rulings.file } : {}) }, ...v, problems: notes };
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
// afterKeyPath: score the after run against this key instead (trap I17): the same predictions
// against an old key and a new one, so every change is the key's. rulings apply to both keys.
function compareRun({ config, keyPath, afterKeyPath = null, beforePath, afterPath, noisePaths = [], mode = 'strict', rulings = null }) {
  const notes = [];
  let samePredictions = false;
  if (afterKeyPath !== null) {
    if (noisePaths.length) {
      throw new Error('--noise goes with two runs against one answer key: the same predictions against two keys have no run-to-run noise to judge a change by');
    }
    sameRecords(config, keyPath, afterKeyPath, mode);
    samePredictions = fingerprint(beforePath) === fingerprint(afterPath);
    if (!samePredictions) {
      notes.push({ level: 'warn', trap: 'I17', where: afterPath, message: 'differs from ' + beforePath + ', and the two are scored against different answer keys: ' +
        'each change below mixes what the workflow did with what the key says. Give the same run as --before and --after to see the key\'s part alone.' });
    }
  }
  const before = scoreRun({ config, predPath: beforePath, keyPath, mode, rulings });
  const after = scoreRun({ config, predPath: afterPath, keyPath: afterKeyPath || keyPath, mode, rulings });
  const noise = noisePaths.length ? varianceRun({ config, keyPath, predPaths: noisePaths, mode, rulings }) : null;
  notes.push(...failedCallNotes([{ label: beforePath, results: before }, { label: afterPath, results: after }]), ...(noise ? noise.problems : []));
  if (rulings) {
    // Both runs read the same rulings file: each of its notes once, whichever key raised it.
    const seen = new Set(notes.map(i => i.trap + i.where + i.message));
    for (const i of [...rulingNotes(before, rulings.file), ...rulingNotes(after, rulings.file)]) {
      if (!seen.has(i.trap + i.where + i.message)) { seen.add(i.trap + i.where + i.message); notes.push(i); }
    }
  }
  const inputs = { key: keyPath, ...(afterKeyPath !== null ? { after_key: afterKeyPath } : {}), before: beforePath, after: afterPath, noise: noisePaths, mode,
    ...(rulings ? { rulings: rulings.file } : {}) };
  return {
    inputs,
    ...(afterKeyPath !== null ? { same_predictions: samePredictions } : {}),
    ...compareOf(before, after, noise, { without_noise: samePredictions ? 'from the key' : null }),
    ...(rulings ? { rulings: { before: rulingsSummary(before), after: rulingsSummary(after) } } : {}),
    problems: notes,
  };
}

// Trap I17: two keys compared on one run must cover the same records, or a change could come
// from a record one key has and the other lacks. Checked before either key meets the run, so
// the message names the keys rather than records missing from a run.
function sameRecords(config, keyPath, afterKeyPath, mode) {
  const ids = file => new Set(loadKey({ config, keyPath: file, mode }).map(k => k.id));
  const a = ids(keyPath);
  const b = ids(afterKeyPath);
  const onlyA = [...a].filter(id => !b.has(id));
  const onlyB = [...b].filter(id => !a.has(id));
  if (onlyA.length === 0 && onlyB.length === 0) return;
  const show = list => (list.length ? ': ' + list.slice(0, 20).map(id => '"' + id + '"').join(', ') + (list.length > 20 ? ' and ' + (list.length - 20) + ' more' : '') : '');
  throw new Error('[I17] the two answer keys cover different records: ' + onlyA.length + ' only in ' + keyPath + show(onlyA) + '; ' +
    onlyB.length + ' only in ' + afterKeyPath + show(onlyB) + '. Two keys are compared on the same records.');
}

// ---------- Free text, graded by a person ----------

const { readGrades } = require('./grading.js');
const { scoreGrades, agreementOf } = require('./metrics/grades.js');

// A reviewer's grades file, and optionally a second reviewer's grades of the same forms.
function scoreGradesRun({ gradesPath, secondPath = null, mode = 'strict' }) {
  const p = problems(mode);
  const first = readGrades(gradesPath, p);
  const second = secondPath ? readGrades(secondPath, p) : null;
  p.throwIfStopped();
  let agreement = null;
  if (second) {
    // J7: agreement means something only if both graded exactly the same text.
    if (second.fingerprint !== first.fingerprint) {
      p.stop('J7', secondPath, 'graded different forms from ' + gradesPath + ' (their fingerprints differ: the forms or their text changed between the two gradings)');
    } else if (JSON.stringify(second.fields.map(f => f.name)) !== JSON.stringify(first.fields.map(f => f.name)) || JSON.stringify(second.forms) !== JSON.stringify(first.forms)) {
      p.stop('J7', secondPath, 'lists different forms or fields from ' + gradesPath);
    }
    // J8: the same file twice agrees with itself perfectly, and proves nothing.
    if (fingerprint(gradesPath) === fingerprint(secondPath)) p.warn('J8', secondPath, 'has exactly the same content as ' + gradesPath + '; agreement with itself proves nothing');
    p.throwIfStopped();
    agreement = agreementOf(first, second);
  }
  return { kind: 'grades', inputs: { grades: gradesPath, second: secondPath, mode }, ...scoreGrades(first), agreement, problems: p.items };
}

module.exports = { scoreRun, scoreRecords, varianceRun, compareRun, scoreGradesRun };
