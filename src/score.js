// Scores one run: load and pair the files, judge every record, compute every metric.
// Returns one results object; the terminal, JSON and HTML reports all render this same
// object, so they cannot disagree with each other.

const { problems, addNew } = require('./problems.js');
const { loadRun, loadKey, acrossFiles } = require('./load.js');
const { applyRulings, addToKey, applyToKey, annotateGaps, pendingKind, judgeDecided, judgeChanges, withoutJudges } = require('./rulings.js');
const { judgeAll, judgeRecord, buildContext } = require('./metrics/judge.js');
const { scoreQuality } = require('./metrics/classification.js');
const { scoreRouting, nothingEvaluated } = require('./metrics/routing.js');
const { scoreTraps, trapCounts } = require('./metrics/traps.js');
const { scoreGroups } = require('./metrics/groups.js');
const { scoreClusters, scoreOutputClusters } = require('./metrics/clusters.js');
const { scoreMix } = require('./metrics/mix.js');
const { scoreCalibration } = require('./metrics/calibration.js');
const { targetCheck } = require('./metrics/target.js');
const { rate } = require('./metrics/stats.js');
const { addAll, compareText } = require('./values.js');

// Per-record summary kept in the results, for reports and for comparing runs.
function recordSummary(j) {
  return {
    id: j.id, route: j.route, route_class: j.route_class, gold_route: j.gold_route, gold_class: j.gold_class,
    traps: j.traps, needs_human: j.needs_human,
    silent: j.silent, omission: j.omission, safeguards: j.safeguards, wasted_review: j.wasted_review, key_leaves_out: j.key_leaves_out,
    differences: j.values,
    ...(j.tool ? { tool: j.tool } : {}),
  };
}

// Every metric from paired records. Pure: no files, no problems collector. Used by
// score, variance, compare and what-if alike. `groups` only when the config has groups.
// parts: as for scoreRun.
function scoreRecords(records, config, parts = 'all') {
  if (parts === 'paired') return { traps: trapCounts(records, config) };
  const all = parts === 'all';
  const judgments = judgeAll(records, config);
  const groups = all ? scoreGroups(judgments, config, records) : null;
  return {
    routing: scoreRouting(judgments, config, records),
    quality: scoreQuality(records, config),
    traps: all ? scoreTraps(judgments, config) : trapCounts(records, config),
    ...(groups ? { groups } : {}),
    calibration: scoreCalibration(records, config, !all),
    records: judgments.map(recordSummary),
  };
}

// target: a percentage the silent error rate should be shown to be under (5 for 5%), or null.
// chance: the probability the plan for that target aims at.
// rulings: a rulings file read by loadRulings (rulings.js), or null. Its adds join the answer
// key for scoring, in memory only; results.rulings says what they were (trap I11).
// mix: a mix file read by loadMix (mix.js), or null. results.mix is the silent error rate weighted
// to that real mix of traffic (traps G18-G21); nothing else in the results changes.
// applySplit, heldOut, look, showHeldOut, now, exclude: the split block below. A config's split applies
// only when the caller asks for it with applySplit (score, compare, variance, whatif and suspects do;
// monitor and every other caller score every record, whatever the config says: trap O1). Then the
// tuning half is scored, and the held-out half only when the caller asks to look at it (heldOut:
// --held-out; trap O25): otherwise results.split says how many records it has and what a look at it
// would be, and nothing of it is shown. look: true records the look in split.log (the score command
// does; compare, variance and whatif record their own). showHeldOut: the held-out half in full, ids
// and all (--show-held-out; a look too). exclude: records set aside in both halves before anything is
// read from the log (compare --after-key, where two keys put them in different halves: trap O26).
// parts: what the caller reads, so a command that repeats runs does not pay for what only score's
// report shows. 'all', the default: everything. 'rates': routing, quality, the records' summaries and
// the calibration gap (variance, compare), with no per-claim lists, group tables or trap tables, no
// clusters, key gaps or pending bracket. 'paired': no metric, only the paired records (whatif,
// suspects). Whichever is asked, the files raise the same problems. Only I6 and P2, which score's
// report says of itself, are raised for 'all' alone: variance and compare have their own notes.
// keys: a command's Map of keys already read (load.js loadRun). liveRecords, across, needs: as for
// loadRun; a split that follows clusters needs them, whoever asks.
function scoreRun({ config, predPath, keyPath, mode = 'strict', target = null, chance = 0.8, rulings = null, mix = null,
  applySplit = false, heldOut = false, look = false, showHeldOut = false, now = undefined, exclude = [], parts = 'all', keys = null, liveRecords = false, across = null, needs = {} }) {
  const split = applySplit && config.split ? config.split : null;
  const p = problems(mode);
  const reads = split && split.by === 'cluster' ? { ...needs, clusters: true } : needs;
  // ---- split: a stop that names held-out records names them in no report (trap O6).
  let run;
  try { run = loadRun({ config, predPath, keyPath, mode, p, keys, liveRecords, across, needs: reads }); } catch (e) { throw split && !showHeldOut ? maskLoadStop(e, config, keyPath) : e; }
  const ruled = rulings ? applyRulings(rulings, run.key, config, p) : null;
  // Adds, and with suspects' verbs removes and label replaces too (N14), all in memory.
  const every = ruled ? applyToKey(run.records, ruled) : run.records;
  // ---- split (traps O1-O20): with a split, everything scored below is the tuning half; the held-out
  // half is summarized in results.split (heldOutPart, below). Without it, nothing changes.
  const sp = split ? splitSetUp({ every, config, p, keyPath, showHeldOut, exclude }) : null;
  const halves = sp ? sp.halves : null;
  const records = halves ? every.filter(r => halves.half.get(r.id) === 'tuning' && !sp.setAside.has(r.id)) : every;
  const results = halves ? scoreHalf(every, config, halves.tuning, parts) : scoreRecords(records, config, parts);
  // ---- end split
  // The silent error rate's range counting clusters (trap G14): only with clusters in the config.
  const clusters = parts === 'all' ? scoreClusters(results.records, records, config) : null;
  if (clusters) results.clusters = clusters;
  // Each output's error rate in clusters, apart from the headline's block so that block reads exactly as before (trap G22).
  const byOutput = clusters ? scoreOutputClusters(records, config) : null;
  if (byOutput) results.clusters_by_output = byOutput;
  // The rate on a real mix (trap G18). Its stops (G19-G21) join the run's, reported together below.
  if (mix) {
    const m = scoreMix(mix, results.records, records, config, { key: keyPath, predictions: predPath }, p);
    if (m) results.mix = m;
  }
  if (target !== null) {
    const se = results.routing.silent_errors.rate;
    results.target = targetCheck(se.n, se.d, target, { chance, out_of: { n: se.d, d: results.routing.total } });
  }

  // H5: trap types with too few records to prove anything. With a split, counted in the answer key
  // (the golden set's design), and the report says how many are in the tuning half (trap O20).
  if (results.traps) {
    const below = halves ? trapCoverage(every, config, results.traps) : results.traps.coverage.below;
    for (const t of below) {
      p.strict('H5', keyPath, 'trap "' + t.trap + '" has ' + t.records + ' record(s)' + (t.tuning === undefined ? '' : ' in the answer key (' + t.tuning + ' in the tuning half)') +
        '; min_per_trap is ' + config.min_per_trap + '. One record passing a trap can be luck.');
    }
  }
  p.throwIfStopped();
  if (parts === 'all') results.key_gaps = keyGapsOf(records, results, config, ruled);
  // ---- split: rulings on held-out records are counted, never listed; the bracket is the tuning half's (O18).
  // A ruling on a record in neither half (not in the key) is listed as without a split.
  const shownRulings = ruled && halves ? rulingsWithout(ruled, sp.hidden) : ruled;
  if (ruled) results.rulings = { ...shownRulings, ...(parts === 'all' ? { if_pending_added: pendingAdded(records, results, config, shownRulings), ...judgedPart(run.records, records, config, ruled, shownRulings) } : {}) };
  // Asked to look, the gate reads both halves. A look at a run that evaluated nothing, or at a half of
  // failed calls, would spend the half's share and show nothing: none is spent, and nothing of the
  // half is shown, so a look not counted is never a look (trap P41).
  const looking = Boolean(halves && (heldOut || showHeldOut) && parts !== 'paired');
  const held = looking ? every.filter(r => halves.half.get(r.id) === 'held_out') : null;
  const nothing = parts === 'paired' ? null : nothingEvaluated(looking ? [...records, ...held] : records, config, halves && !looking ? ' in the tuning half' : '');
  if (nothing) results.nothing_evaluated = { why: nothing };
  if (halves) {
    const empty = looking ? nothing || heldHalfFailed(held) : null;
    const identity = { command: 'score', files: { predictions: predPath, key: keyPath, rulings: rulings ? rulings.file : null } };
    results.split = (heldOut || showHeldOut) && !empty ? heldOutPart({ every, config, sp, target, look, showHeldOut, now, mode, identity, ruled }) : notLookedPart({ every, config, sp, ruled, empty });
  }
  // ---- end split
  // What one report says of itself (traps P2, P3). variance and compare have their own notes (I6).
  if (parts === 'all') {
    const failed = failedInRun(results);
    if (failed > 0) p.warn('I6', predPath, failed + ' model call(s) failed in this run; its numbers reflect those failures as well as the workflow. Rerun those records before quoting them.');
    if (!nothing && results.routing.silent_errors.rate.d === 0) {
      p.warn('P2', predPath, 'No record went out without review' + (results.split ? ' in the tuning half' : '') + ', so the silent error rate has nothing to measure: a build gate on it reads no silent error, not a clean run.');
    }
  }

  return {
    inputs: { predictions: predPath, key: keyPath, mode, wrong_when: config.wrong_when, ...(rulings ? { rulings: rulings.file } : {}), ...(mix ? { mix: mix.file } : {}) },
    ...results,
    problems: p.items,
    paired: records,   // the paired records themselves (with any added values); not written to the JSON results
  };
}

// I6: a run where model calls failed is measuring the failures. With a split, its held-out half's too (trap O20).
const failedInRun = results => results.quality.left_out.model_failed.length + (results.split ? results.split.failed : 0);

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
  const onRecord = new Map();
  for (const c of candidates) {
    if (onRecord.has(c.id)) onRecord.get(c.id).push(c); else onRecord.set(c.id, [c]);
  }
  const left = new Map();
  for (const [id, gaps] of onRecord) {
    if (!silent.get(id)) continue;
    const j = judgeRecord(addToKey([byId.get(id)], gaps)[0], config, ctx);
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
//
// Pending removes and label replaces (N13) are made too, as proposed. Each is one-way in the same
// way only when this run does not hold what it takes away: removing a value this run applied, or
// replacing the label this run gave, turns a right answer wrong. Those are named in not_one_way,
// which is there only when the file has such pending rulings, so older results read as before.
//
// Whether the two figures are a bracket is then worked out, not assumed: every way a person could
// rule the pending entries of each record out without review is tried (a set value kept as the key
// has it or changed as proposed; a label, any of the output's labels), and the lowest and highest
// rate are compared with the two figures. When they differ, however_ruled gives them. A record sent
// to a person, blocked or suppressed is not in the rate's base, so nothing ruled on it can move the
// rate: not_applied and not_one_way count records out without review only.
function pendingAdded(records, results, config, ruled) {
  if (ruled.pending.length === 0) return null;
  const of = kind => ruled.pending.filter(x => pendingKind(x) === kind);
  const alt = scoreRecords(applyToKey(records, { added: of('add'), removed: of('remove'), replaced: of('replace') }), config).routing.silent_errors;
  const was = new Set(results.routing.silent_errors.records.map(x => x.id));
  const now = new Set(alt.records.map(x => x.id));
  const byId = new Map(records.map(r => [r.id, r]));
  const out = new Set(results.records.filter(x => x.route_class === 'auto').map(x => x.id));
  const applied = x => byId.get(x.id).pred[x.output].some(v => v.applied && v.value === x.value);
  const gave = x => { const l = byId.get(x.id).pred[x.output]; return Boolean(l) && !l.declined && String(l.value) === x.value; };
  const triple = ({ id, output, value }) => ({ id, output, value });
  const questions = ruled.pending.some(x => pendingKind(x) !== 'add');
  const strict = results.routing.silent_errors.rate;
  const range = pendingRange(records, config, ruled.pending, out, was);
  const bracket = range.exact && range.low === Math.min(strict.n, alt.rate.n) && range.high === Math.max(strict.n, alt.rate.n);
  return {
    pending: ruled.pending.length,
    not_applied: of('add').filter(x => out.has(x.id) && !applied(x)).map(triple),
    ...(questions ? { not_one_way: [...of('remove').filter(x => out.has(x.id) && applied(x)), ...of('replace').filter(x => out.has(x.id) && gave(x))]
      .map(x => ({ ...triple(x), proposed: pendingKind(x) })) } : {}),
    silent_errors: alt.rate,
    cleared: [...was].filter(id => !now.has(id)),
    became: [...now].filter(id => !was.has(id)),
    ...(bracket ? {} : { however_ruled: range.exact ? { lowest: rate(range.low, strict.d), highest: rate(range.high, strict.d), exact: true } : { exact: false, records: range.too_many } }),
  };
}

// Rulings made by AI judges, and the silent error rate with them taken back out (Q3): the same
// records against the key with a person's rulings alone. Only when there are any, so results with
// no AI ruling read as before.
function judgedPart(all, records, config, ruled, shown) {
  const decided = judgeDecided(shown).length;
  if (decided === 0) return {};
  const ids = new Set(records.map(r => r.id));
  const alone = applyToKey(all, withoutJudges(ruled)).filter(r => ids.has(r.id));
  return { by_judges: { decided, changed_key: judgeChanges(shown).length, silent_errors: scoreRecords(alone, config).routing.silent_errors.rate } };
}

// The most combinations of rulings tried on one record; past it the range is not worked out.
const MOST_WAYS = 4096;

// The lowest and highest count of silent errors over every way the pending entries could be ruled.
// Records are independent (a record's key changes only its own judgment), so each record's lowest
// and highest add up. out: the records out without review; was: the silent errors as the key stands.
function pendingRange(records, config, pending, out, was) {
  const ctx = buildContext(records);   // routes only: rulings change no route
  const byId = new Map(records.map(r => [r.id, r]));
  const byRecord = new Map();
  for (const x of pending) if (out.has(x.id)) byRecord.set(x.id, [...(byRecord.get(x.id) || []), x]);
  let low = was.size;
  let high = was.size;
  const tooMany = [];
  for (const [id, list] of byRecord) {
    const r = byId.get(id);
    // Each entry's outcomes: a set value as the key has it or changed as proposed; a label, any label.
    const ways = list.map(x => (pendingKind(x) === 'replace' ? config.outputs[x.output].labels.map(String) : [false, true]));
    const total = ways.reduce((n, w) => n * w.length, 1);
    if (total > MOST_WAYS) { tooMany.push(id); continue; }
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < total; i++) {
      let k = i;
      const change = { added: [], removed: [], replaced: [] };
      list.forEach((x, j) => {
        const pick = ways[j][k % ways[j].length];
        k = Math.floor(k / ways[j].length);
        const kind = pendingKind(x);
        if (kind === 'replace') change.replaced.push({ ...x, with: pick });
        else if (pick) (kind === 'add' ? change.added : change.removed).push(x);
      });
      const silent = judgeRecord(applyToKey([r], change)[0], config, ctx).silent ? 1 : 0;
      lo = Math.min(lo, silent);
      hi = Math.max(hi, silent);
    }
    const now = was.has(id) ? 1 : 0;
    low += lo - now;
    high += hi - now;
  }
  return tooMany.length ? { exact: false, too_many: tooMany } : { exact: true, low, high };
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

const { fingerprint } = require('./hash.js');
const { varianceOf, compareOf, keyGapCandidates, tallyKeyGaps, gapList } = require('./metrics/runs.js');

// N result files from repeated runs of identical code: mean and spread per metric.
// rulings: as for scoreRun; every run is scored against the key plus its adds, and the
// possible key gaps carry their rulings, rejected ones counted rather than listed.
// applySplit, heldOut, look, showHeldOut, now: with config.split only, and only when the caller asks
// (heldOutVariance, below; the held-out half only with heldOut or showHeldOut).
// across: the command's acrossFiles() when these runs are some of its files (compare's noise runs), and
// it reports them; otherwise this reports its own (trap P1).
function varianceRun({ config, keyPath, predPaths, mode = 'strict', rulings = null, applySplit = false, heldOut = false, look = false, showHeldOut = false, now = undefined, keys = new Map(), across = null }) {
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
  // A run's paired records are most of what it holds, and only the key gaps read them here: tallied
  // as each run is scored and let go, so the runs are not all in memory at once.
  const found = new Map();
  const files = across || acrossFiles();
  const runs = predPaths.map((f, i) => {
    const results = scoreRun({ config, predPath: f, keyPath, mode, rulings, applySplit, heldOut, showHeldOut, parts: 'rates', keys, across: files });
    tallyKeyGaps(found, results.paired, i, config);
    results.paired = null;
    return { label: f, results };
  });
  if (!across) addAll(notes, fieldNotes(files, mode));
  addAll(notes, failedCallNotes(runs));
  // ---- split: its own warnings (O3, O5, O15, and O10 with --lenient), once: every run has the same halves.
  if (applySplit && config.split) splitNotes([runs[0].results], notes);
  const v = varianceOf(runs, config, gapList(found, runs.length));
  if (rulings) {
    // One key, so the rulings apply alike to every run: reported once, from the first.
    const { candidates, rejected } = annotateGaps(v.records.key_gap_candidates, runs[0].results.rulings);
    v.records.key_gap_candidates = candidates;
    v.records.key_gaps_rejected = rejected;
    v.rulings = rulingsSummary(runs[0].results);
    addAll(notes, rulingNotes(runs[0].results, rulings.file));
  }
  const result = { inputs: { key: keyPath, runs: predPaths, mode, ...(rulings ? { rulings: rulings.file } : {}) }, ...v, problems: notes };
  // ---- split: every number above is the tuning half's; the worst run on the held-out half too.
  if (applySplit && config.split) {
    const empty = runs.find(r => r.results.split.not_looked);
    result.split = (heldOut || showHeldOut) && !empty ? heldOutVariance({ runs, config, keyPath, predPaths, rulings, look, showHeldOut, now, mode, notes }) : notLookedCommand((empty || runs[0]).results.split, config);
  }
  // ---- end split
  return result;
}

// What several runs say about a field none of them, or only some, has (trap P1). Stops when none has it.
function fieldNotes(files, mode) {
  const p = problems(mode);
  files.report(p);
  p.throwIfStopped();
  return p.items;
}

// I6: a run where model calls failed is measuring the failures (every failed record went to a
// person), not the workflow. Comparing it with clean runs mixes the two.
// With a split, the run's quality is the tuning half's: the held-out half's failures are counted too (trap O20).
function failedCallNotes(runs) {
  return runs.filter(r => failedInRun(r.results) > 0).map(r => ({
    level: 'warn', trap: 'I6', where: r.label,
    message: failedInRun(r.results) + ' model call(s) failed in this run; its numbers reflect those failures, not the workflow. Rerun it before comparing.',
  }));
}

// Two runs, and optionally repeated runs of identical code to judge them against.
// afterKeyPath: score the after run against this key instead (trap I17): the same predictions
// against an old key and a new one, so every change is the key's. rulings apply to both keys.
// applySplit, heldOut, look, showHeldOut, now: with config.split only, and only when the caller asks
// (heldOutCompare, below; the held-out half only with heldOut or showHeldOut).
// beforeLook: called with the paired results before a look at the held-out half is recorded; what it
// throws stops the command with no look spent.
function compareRun({ config, keyPath, afterKeyPath = null, beforePath, afterPath, noisePaths = [], mode = 'strict', rulings = null,
  applySplit = false, heldOut = false, look = false, showHeldOut = false, now = undefined, beforeLook = null }) {
  const notes = [];
  let samePredictions = false;
  const split = applySplit && config.split;
  let apart = [];   // split: records the two keys put in different halves (trap O26)
  if (afterKeyPath !== null) {
    if (noisePaths.length) {
      throw new Error('--noise goes with two runs against one answer key: the same predictions against two keys have no run-to-run noise to judge a change by');
    }
    sameRecords(config, keyPath, afterKeyPath, mode, split && !showHeldOut);
    if (split) apart = halvesApart(config, keyPath, afterKeyPath, mode, showHeldOut, notes);
    samePredictions = fingerprint(beforePath) === fingerprint(afterPath);
    if (!samePredictions) {
      notes.push({ level: 'warn', trap: 'I17', where: afterPath, message: 'differs from ' + beforePath + ', and the two are scored against different answer keys: ' +
        'each change below mixes what the workflow did with what the key says. Give the same run as --before and --after to see the key\'s part alone.' });
    }
  }
  const keys = new Map();
  const files = acrossFiles();
  const before = scoreRun({ config, predPath: beforePath, keyPath, mode, rulings, applySplit, heldOut, showHeldOut, exclude: apart, parts: 'rates', keys, across: files });
  before.paired = null;   // compared by their summaries: nothing here reads a run's paired records
  const after = scoreRun({ config, predPath: afterPath, keyPath: afterKeyPath || keyPath, mode, rulings, applySplit, heldOut, showHeldOut, exclude: apart, parts: 'rates', keys, across: files });
  const noise = noisePaths.length ? varianceRun({ config, keyPath, predPaths: noisePaths, mode, rulings, applySplit, heldOut, showHeldOut, keys, across: files }) : null;
  addAll(notes, fieldNotes(files, mode));
  addAll(notes, failedCallNotes([{ label: beforePath, results: before }, { label: afterPath, results: after }]));
  if (noise) addAll(notes, noise.problems);
  // ---- split: its own warnings (O3, O5, O15, and O10 with --lenient), each once.
  if (split) splitNotes([before, after], notes);
  if (rulings) {
    // Both runs read the same rulings file: each of its notes once, whichever key raised it.
    addNew(notes, [...rulingNotes(before, rulings.file), ...rulingNotes(after, rulings.file)]);
  }
  const inputs = { key: keyPath, ...(afterKeyPath !== null ? { after_key: afterKeyPath } : {}), before: beforePath, after: afterPath, noise: noisePaths, mode,
    ...(rulings ? { rulings: rulings.file } : {}) };
  const result = {
    inputs,
    ...(afterKeyPath !== null ? { same_predictions: samePredictions } : {}),
    ...compareOf(before, after, noise, { without_noise: samePredictions ? 'from the key' : null }),
    ...(rulings ? { rulings: { before: rulingsSummary(before), after: rulingsSummary(after) } } : {}),
    problems: notes,
  };
  // Trap P2: a run that evaluated nothing has nothing to compare: said at the top, and a gate fails on it.
  const nothing = [[beforePath, before], [afterPath, after]].filter(([, r]) => r.nothing_evaluated).map(([file, r]) => ({ file, why: r.nothing_evaluated.why }));
  if (nothing.length) result.nothing_evaluated = nothing;
  if (beforeLook) beforeLook(result.paired);
  // ---- split: every number above is the tuning half's; the paired verdict on the held-out half too.
  if (applySplit && config.split) {
    const named = { before: beforePath, after: afterPath, key: keyPath, after_key: afterKeyPath, rulings: rulings ? rulings.file : null };
    const empty = [before, after].find(r => r.split.not_looked);
    result.split = (heldOut || showHeldOut) && !empty ? heldOutCompare({ before, after, config, files: named, look, showHeldOut, now, mode, notes }) : notLookedCommand((empty || after).split, config);
    if (apart.length) result.split.keys_apart = apart.length;
  }
  // ---- end split
  return result;
}

// Trap I17: two keys compared on one run must cover the same records, or a change could come
// from a record one key has and the other lacks. Checked before either key meets the run, so
// the message names the keys rather than records missing from a run.
// countOnly: with a split (and no --show-held-out), the ids are counted, not named (trap O6).
function sameRecords(config, keyPath, afterKeyPath, mode, countOnly = false) {
  const ids = file => new Set(loadKey({ config, keyPath: file, mode }).map(k => k.id));
  const a = ids(keyPath);
  const b = ids(afterKeyPath);
  const onlyA = [...a].filter(id => !b.has(id));
  const onlyB = [...b].filter(id => !a.has(id));
  if (onlyA.length === 0 && onlyB.length === 0) return;
  const show = list => (countOnly || !list.length ? '' : ': ' + list.slice(0, 20).map(id => '"' + id + '"').join(', ') + (list.length > 20 ? ' and ' + (list.length - 20) + ' more' : ''));
  throw new Error('[I17] the two answer keys cover different records: ' + onlyA.length + ' only in ' + keyPath + show(onlyA) + '; ' +
    onlyB.length + ' only in ' + afterKeyPath + show(onlyB) + '. Two keys are compared on the same records.');
}

// ---------- Free text, graded by a person ----------

// A reviewer's grades file, and optionally a second reviewer's grades of the same forms.
function scoreGradesRun({ gradesPath, secondPath = null, mode = 'strict' }) {
  const { readGrades } = require('./grading.js');
  const { scoreGrades, agreementOf } = require('./metrics/grades.js');
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
  return { kind: 'grades', inputs: { grades: gradesPath, second: secondPath, mode }, ...scoreGrades(first), agreement, problems: p.items,
    ...(first.reviewer_kind ? { reviewer_kind: first.reviewer_kind } : {}), ...(second && second.reviewer_kind ? { second_reviewer_kind: second.reviewer_kind } : {}),
    ...(first.grades.size === 0 ? { nothing_evaluated: { why: 'no field was graded' } } : {}) };
}

// ---------- The tuning half and the held-out half (config.split; traps O1-O20) ----------
//
// With a split, and only when the caller asks for it (applySplit), score, compare and variance
// report the tuning half in full, as they report a run without one, and the held-out half as a
// summary: its rates with their likely ranges, never which records (src/split.js says why). Each
// report that shows held-out numbers is a look at the held-out half, counted in split.log when the
// config names one (src/split-log.js); a claim made on it ("shown under the target") may use only
// that look's share of the 5%, and without a log no claim is made.

const { splitOf, balanceOf, heldOutClaim, heldHalfFailed, splitSettings, heldOutNumbers, worstRun, setAside, maskProblems, maskStop, maskAll } = require('./split.js');
const { prepareLook, commitLook, lookStatus, notRecorded } = require('./split-log.js');

// Values a report never shows (they name held-out records), kept on the split result for the
// commands built on it: left out of JSON.stringify, so --json cannot write them either.
function hide(obj, values) {
  for (const [k, v] of Object.entries(values)) Object.defineProperty(obj, k, { value: v, enumerable: false });
  return obj;
}

// A stop from reading the files (or a rulings file), its held-out names taken out (trap O6). The
// halves come from the answer key alone (a record's unit is its id, cluster or primary, all on the
// key's side). If the key itself cannot be read, which half a record is in is not known: then no
// record is named at all, each counted instead.
function keyHalves(config, keyPath) {
  const key = loadKey({ config, keyPath, mode: 'lenient' });
  return splitOf(key.map(k => ({ id: k.id, duplicate_of: k.duplicate_of, ...(k.cluster !== undefined ? { cluster: k.cluster } : {}) })), config);
}
// note: the words that count them (check, which has no --show-held-out, passes its own).
function maskLoadStop(e, config, keyPath, note = undefined) {
  let halves;
  try { halves = keyHalves(config, keyPath); } catch (e2) { return maskAll(e); }
  return maskStop(e, halves.held_out, note);
}

// Trap O26: compare --after-key with a split draws each run's halves from its own key. A record the two
// keys put in different halves (its primary or cluster differs between them) would be tuning in one run
// and held out in the other. Strict mode stops, counting them; --lenient sets them aside in both runs.
function halvesApart(config, keyPath, afterKeyPath, mode, showHeldOut, notes) {
  const a = keyHalves(config, keyPath);
  const b = keyHalves(config, afterKeyPath);
  const apart = [...a.half.keys()].filter(id => b.half.has(id) && a.half.get(id) !== b.half.get(id));
  if (!apart.length) return [];
  const what = apart.length + ' record(s) fall in one half under ' + keyPath + ' and in the other under ' + afterKeyPath +
    ' (their primary or cluster differs between the keys)' + (showHeldOut ? ': ' + apart.join(' ') : '');
  if (mode === 'strict') {
    throw new Error('[O26] ' + what + '. A record tuned on in one run and held out in the other would mix the halves. Give both keys the same duplicates and clusters; with --lenient they are set aside in both runs');
  }
  notes.push({ level: 'warn', trap: 'O26', where: afterKeyPath, message: what + ': set aside in both runs, in neither half, and not written to split.log' });
  return apart;
}

// The split's own warnings from the runs scored (O3, O5, O15, O10), each once, for variance and
// compare, which keep only some of each run's notes. notes: the notes kept so far, added to.
function splitNotes(results, notes) {
  addNew(notes, results.flatMap(r => r.problems.filter(x => x.level !== 'stop' && ['O3', 'O5', 'O10', 'O15'].includes(x.trap))));
}

// The halves, the log read before anything is scored (records that changed half: set aside with
// --lenient, a stop otherwise: trap O10), and the split's own checks. hidden: the ids no report may
// name without --show-held-out (the held-out half's, and any set aside).
// Trap O6: the problems so far (the files' warnings, a rulings file's I13 and I14) can name a held-out
// record, and the next stop reports every stop raised: from here on they count those records instead
// of naming them, and the records that changed half too, before the log check stops on them. Every
// problem raised after this reads the tuning half (mix) or names no record (H5, O3, O5, O10, O15).
function splitSetUp({ every, config, p, keyPath, showHeldOut, exclude = [] }) {
  let halves = splitOf(every, config);
  if (exclude.length) halves = setAside(halves, exclude);   // compare --after-key: in neither half (O26)
  const hidden = [...halves.held_out, ...exclude];
  const mask = ids => { if (!showHeldOut) maskProblems(p.items, ids); };
  const pre = prepareLook({ config, halves, p, beforeStop: moved => mask([...hidden, ...moved]) });
  const moved = pre ? pre.moved : [];
  if (moved.length) {
    halves = setAside(halves, moved);
    addAll(hidden, moved);
  }
  mask(hidden);
  const out = new Set([...moved, ...exclude]);
  const checked = splitChecks(every.filter(r => !out.has(r.id)), config, halves, p, keyPath);
  return { halves, moved, setAside: out, hidden, checked };
}

// Every metric for one half. Judged with that half's records only, so no judgment in one half reads a
// record of the other: with split.by "id" a primary's omission type would otherwise say whether its
// held-out duplicate was suppressed (trap O3). With the default split, a duplicate and its primary
// are always in one half, so nothing changes. Otherwise exactly scoreRecords, on that half's records.
function scoreHalf(every, config, ids, parts = 'all') {
  const keep = new Set(ids);
  return scoreRecords(every.filter(r => keep.has(r.id)), config, parts);
}

// Trap O20: min_per_trap is about the golden set, so with a split it counts the answer key's records,
// and says how many are in the tuning half.
function trapCoverage(every, config, tuningTraps) {
  if (config.min_per_trap === null) return [];
  const count = new Map();
  for (const r of every) for (const t of r.traps) count.set(t, (count.get(t) || 0) + 1);
  const inTuning = new Map(tuningTraps.groups.map(g => [g.trap, g.records.length]));
  const below = [...count.entries()].filter(([, n]) => n < config.min_per_trap).sort((a, b) => compareText(a[0], b[0]))
    .map(([trap, records]) => ({ trap, records, tuning: inTuning.get(trap) || 0 }));
  tuningTraps.coverage.below = below;   // the PER TRAP line says the same as the stop
  return below;
}

// A rulings file's entries without those on the given records (the held-out half's, and any set
// aside); those are counted by heldOutRulings. A ruling on a record in neither half (one the key does
// not have) stays, as without a split. Every list applyRulings gives is filtered: added, rejected,
// pending and set_aside always, and removed, kept and replaced when the file uses suspects' verbs.
const RULING_LISTS = ['added', 'rejected', 'pending', 'set_aside', 'removed', 'kept', 'replaced'];
function rulingsWithout(ruled, ids) {
  const drop = new Set(ids);
  const out = { ...ruled };
  for (const k of RULING_LISTS) if (Array.isArray(ruled[k])) out[k] = ruled[k].filter(x => !drop.has(x.id));
  return out;
}
function heldOutRulings(ruled, ids) {
  const keep = new Set(ids);
  const out = {};
  for (const k of RULING_LISTS) if (Array.isArray(ruled[k])) out[k] = ruled[k].filter(x => keep.has(x.id)).length;
  return out;
}

// The split's own checks, made before the run's stops are reported: an empty held-out half (O15),
// retellings on both sides (O3), and kinds of record split beyond what chance gives (O5).
const shareText = s => (s.hash === 'crc32' ? 'the odd checksums' : Number((s.held_out * 100).toPrecision(3)) + '%');
function splitChecks(every, config, halves, p, where) {
  const s = config.split;
  if (halves.held_out.length === 0) {
    p.warn('O15', where, 'no record fell in the held-out half (' + every.length + ' records, ' + shareText(s) +
      ' held out): there is nothing to check a choice on. Add records, or hold out a larger share');
  }
  const st = halves.straddling;
  if (st.duplicates || st.clusters) {
    const what = [st.duplicates ? st.duplicates + (st.duplicates === 1 ? ' duplicate in the other half from its primary' : ' duplicates in the other half from their primaries') : null,
      st.clusters ? st.clusters + ' cluster' + (st.clusters === 1 ? '' : 's') + ' with records in both halves' : null].filter(Boolean).join(' and ');
    p.warn('O3', where, what + ' (split.by "' + s.by + '"): retellings of one story on both sides make the held-out half look better than it is, ' +
      'since what is tuned on one copy carries over to the other. ' + (s.by === 'id' ? 'Leave split.by out to keep them together' : 'Give each duplicate its primary\'s cluster'));
  }
  const balance = balanceOf(every, config, halves);
  for (const b of balance.beyond_chance) {
    p.warn('O5', where, b.dimension + ' "' + b.label + '": ' + b.held_out + ' of its ' + b.records + ' records are in the held-out half, where a fair split gives about ' +
      Number(b.expected.toFixed(1)) + ', beyond what chance gives (the test: under ' + Number((balance.level * 100).toPrecision(2)) +
      '%, the 5% shared among the ' + balance.tested + ' kinds that could reach it). Before anyone has looked at either half, a new split.salt draws another split; once a half has been looked at, keep it');
  }
  return { balance };
}

// score's held-out summary, its look, and its claims (the whole held-out half, and the newest batch
// of records added to it when there is one: trap O14). No claim without a counted look (trap O12).
function heldOutPart({ every, config, sp, target, look, showHeldOut, now, mode, identity, ruled }) {
  const { halves } = sp;
  const held = scoreHalf(every, config, halves.held_out);
  const lk = look ? commitLook({ config, identity, halves, moved: sp.moved, idsShown: showHeldOut, mode, now }) : notRecorded(config, halves, showHeldOut);
  const out = {
    ...splitSettings(config), tuning: { records: halves.tuning.length }, held_out: heldOutNumbers(held),
    straddling: halves.straddling, balance: sp.checked.balance, set_aside: sp.moved.length, looked: true, look: lk,
    ...(ruled ? { rulings: { held_out: heldOutRulings(ruled, sp.hidden) } } : {}),
  };
  if (target !== null) out.target = heldOutClaim(held.routing.silent_errors.rate, target, lk.half.level);
  if (lk.batch) {
    const b = scoreHalf(every, config, lk.batch.ids);
    out.batch = { since: lk.batch.since, look: lk.batch.look, level: lk.batch.level, records: lk.batch.records, held_out: heldOutNumbers(b),
      ...(target !== null ? { target: heldOutClaim(b.routing.silent_errors.rate, target, lk.batch.level) } : {}) };
  }
  // --show-held-out: the held-out half in full, ids and all (recorded in the log as ids shown).
  if (showHeldOut) out.held_out_report = held;
  // ruled: every ruling, both halves' (suspects --show-held-out lists the held-out half's suspects with theirs).
  return hide(out, { held, every, halves, moved: sp.moved, hidden: sp.hidden, ruled, failed: failedIn(every, halves) });
}

// Model calls that failed in the held-out half: known from the run alone, without the answer key,
// so counted whether or not the half is looked at (I6; trap O20).
const failedIn = (every, halves) => every.filter(r => halves.half.get(r.id) === 'held_out' && !r.scored).length;

// Without --held-out (trap O25): the held-out half in counts only (its records, the rulings on them),
// and what a look at it would be. Nothing of it is scored, so nothing is shown and no look is spent.
// empty: why a look that was asked for was not made (trap P41); null when none was asked for.
function notLookedPart({ every, config, sp, ruled, empty = null }) {
  const { halves } = sp;
  const out = {
    ...splitSettings(config), tuning: { records: halves.tuning.length }, held_out: { records: halves.held_out.length },
    straddling: halves.straddling, balance: sp.checked.balance, set_aside: sp.moved.length, looked: false, ...(empty ? { not_looked: empty } : {}), next_look: lookStatus(config, halves.held_out),
    ...(ruled ? { rulings: { held_out: heldOutRulings(ruled, sp.hidden) } } : {}),
  };
  return hide(out, { every, halves, moved: sp.moved, hidden: sp.hidden, ruled, failed: failedIn(every, halves) });
}
// The same for compare and variance, from one of their runs.
function notLookedCommand(s, config) {
  return { ...splitSettings(config), tuning: { records: s.tuning.records }, held_out: { records: s.held_out.records }, set_aside: s.set_aside,
    looked: false, ...(s.not_looked ? { not_looked: s.not_looked } : {}), next_look: s.next_look, ...(s.rulings ? { rulings: s.rulings } : {}) };
}

// A look for compare or variance: recorded once for the whole command. A stop (a lock held, say)
// stops the command; its warnings join the command's notes.
function commandLook({ config, command, files, halves, moved, look, showHeldOut, now, mode }) {
  if (!look) return notRecorded(config, halves, showHeldOut);
  return commitLook({ config, identity: { command, files }, halves, moved, idsShown: showHeldOut, mode, now });
}

// compare: the paired verdict on the held-out half, outcome by outcome, as counts only.
function heldOutCompare({ before, after, config, files, look, showHeldOut, now, mode }) {
  const c = compareOf(before.split.held, after.split.held);
  const counts = { records: c.paired.records, outcomes: c.paired.outcomes.map(({ fixed_ids, broke_ids, ...o }) => o) };
  const lk = commandLook({ config, command: 'compare', files, halves: after.split.halves, moved: after.split.moved, look, showHeldOut, now, mode });
  return {
    ...splitSettings(config), tuning: { records: after.split.tuning.records },
    held_out: { records: after.split.held_out.records, paired: counts }, set_aside: after.split.set_aside, looked: true, look: lk,
    ...(after.split.rulings ? { rulings: after.split.rulings } : {}),
    ...(showHeldOut ? { held_out_report: c } : {}),
  };
}

// variance: each run's silent error rate on the held-out half, and the worst of them.
function heldOutVariance({ runs, config, keyPath, predPaths, rulings, look, showHeldOut, now, mode }) {
  const rates = runs.map(r => { const { by_severity, ...rate } = r.results.split.held_out.silent_errors; return rate; });
  const files = { runs: predPaths, key: keyPath, rulings: rulings ? rulings.file : null };
  const first = runs[0].results.split;
  const lk = commandLook({ config, command: 'variance', files, halves: first.halves, moved: first.moved, look, showHeldOut, now, mode });
  const heldOf = r => r.results.split.every.filter(x => r.results.split.halves.half.get(x.id) === 'held_out' && !r.results.split.moved.includes(x.id));
  return {
    ...splitSettings(config), tuning: { records: first.tuning.records },
    held_out: { records: first.held_out.records, runs: rates, worst_run: worstRun(rates, runs.map(r => r.label)) },
    set_aside: first.set_aside, looked: true, look: lk, ...(first.rulings ? { rulings: first.rulings } : {}),
    ...(showHeldOut ? { held_out_report: varianceOf(runs.map(r => ({ label: r.label, results: { ...r.results.split.held, paired: heldOf(r) } })), config) } : {}),
  };
}

module.exports = { scoreRun, scoreRecords, varianceRun, compareRun, scoreGradesRun, maskLoadStop };
