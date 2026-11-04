// wfeval estimate: the silent error rate from an AI judge's answer key for every record, checked
// by a person on a sample (traps K1-K13; the arithmetic is in metrics/estimate.js).
//
// In production most records have no answer key. A judge (an LLM grader run outside the harness;
// the harness never calls a model) can write one for every record, in the config's own answer-key
// format, but it is wrong sometimes. A person checks some records and writes their answer key for
// those. Both keys are scored by the harness's own rules (judge.js), so every definition carries
// over: any_of slots, equivalents, wrong_when. Each record out without review then has the
// judge's verdict (silent error or not) and, if checked, the person's.
//
// What it needs to be right: the person picked records at random, either from all the records
// out or within each judge verdict group, and checked them without seeing the judge's verdict.
// Neither can be proved from the files; a sample bunched in one part of the run is warned about (K7).

const fs = require('fs');
const nodePath = require('path');
const { problems } = require('./problems.js');
const { own } = require('./values.js');
const { readText } = require('./text.js');
const { readRecords, formatOf, normalizePredictions, normalizeKey, keySample, keyIsRun } = require('./load.js');
const { decodeCsvRecords } = require('./csv.js');
const { align } = require('./align.js');
const { judgeAll, judgeRecord, buildContext } = require('./metrics/judge.js');
const { rate, cohensKappa, pct, pct1 } = require('./metrics/stats.js');
const { estimateRange, worthOf, targetOf, allocate } = require('./metrics/estimate.js');
const { failedShare } = require('./metrics/routing.js');

const GROUPS = ['flagged', 'passed'];
const list = ids => ids.slice(0, 20).map(id => '"' + id + '"').join(', ') + (ids.length > 20 ? ' and ' + (ids.length - 20) + ' more' : '');

// One side's records, read as loadRun reads them (load.js), without pairing.
// kept.raws: the records as read, for the A8 check.
function readSide(config, file, which, p, kept = {}) {
  const input = config.input[which];
  let raws = readRecords(file, p, input);
  if (formatOf(file, input) === 'csv') raws = decodeCsvRecords(raws, config, which === 'predictions' ? 'predictions' : 'key', input, file, p);
  kept.raws = raws;
  return which === 'predictions' ? normalizePredictions(raws, config, file, p) : normalizeKey(raws, config, file, p);
}

// A8 here as in score (trap P20): a key that holds what the run holds, read from the same fields.
function selfScored(config, run, key, predPath, keyPath, p) {
  if (!keyIsRun(run.raws, keySample(key.raws, config), () => key.raws, config)) return;
  p.stop('A8', predPath, predPath + ' and ' + keyPath + ' hold the same records and the same fields, so every record would be scored against itself. Set key_field on each output to where the answers are.');
}

// K8: an output one key never fills on the checked records while the other fills it on some. The
// judge may have been asked about fewer outputs than the person (or the other way round): every
// record would then disagree, or agree, for a reason that is not the workflow's. But an empty list
// is an answer ("none of these"), and a rare value can rightly be missing from every check, so this
// is a warning only. An output missing from a key's records altogether already stops (D2, F4).
function filled(v) {
  if (v === null || v === undefined) return false;
  return Array.isArray(v) ? v.length > 0 : true;
}
function differentOutputs(config, judgeKey, personKey, judgePath, personPath, p) {
  const checked = new Set(personKey.map(k => k.id));
  const judged = judgeKey.filter(k => checked.has(k.id));
  for (const name of Object.keys(config.outputs)) {
    const j = judged.some(k => filled(k.outputs[name]));
    const q = personKey.some(k => filled(k.outputs[name]));
    if (j === q) continue;
    const [has, lacks] = j ? [judgePath, personPath] : [personPath, judgePath];
    p.warn('K8', lacks, 'never gives a value for "' + name + '" on the checked records, while ' + has + ' does. Fine if none of them has one; if the two keys ' +
      'cover different outputs, the person and the judge disagree (or agree) for a reason that is not the workflow\'s. Give both keys every output');
  }
}

// K2: the judge needs a verdict only for the records out without review: the rate counts no other
// record. Whether a record went out comes from its route alone (the config's routing.map), so it is
// known before pairing. The run's other records still pair, so every route is checked as in score:
// a record with no verdict gets an empty stand-in for the pairing, and nothing found on a stand-in
// is reported (it is not the judge's).
const isOutRoute = (r, config) => typeof r.route === 'string' && own(config.routing.map, r.route.trim()) === 'auto';
function judgeRun(config, predictions, judgeKey, predPath, judgeKeyPath, p) {
  const judgeIds = new Set(judgeKey.map(k => k.id));
  const unjudged = predictions.filter(r => isOutRoute(r, config) && !judgeIds.has(r.id)).map(r => r.id);
  if (unjudged.length) {
    p.stop('K2', judgeKeyPath, 'has no verdict for ' + unjudged.length + ' record(s) that went out without review: ' + list(unjudged) +
      '. The judge must grade every record that went out without review (it may skip the others)');
  }
  p.throwIfStopped();
  const empty = Object.fromEntries(Object.entries(config.outputs).map(([name, o]) => [name, o.type === 'set' ? [] : null]));
  const standIns = predictions.filter(r => !judgeIds.has(r.id)).map(r => ({
    id: r.id, gold_route: config.routing.gold_field ? r.route : null, traps: [], duplicate_of: null, outputs: empty,
  }));
  const stood = new Set(standIns.map(k => k.id));
  const q = problems(p.mode);
  const judged = align(predictions, [...judgeKey, ...standIns], config, q, { predSource: predPath, keySource: judgeKeyPath });
  const onStandIn = i => i.where.startsWith(judgeKeyPath + ' ') && stood.has(i.where.slice(judgeKeyPath.length + 1));
  for (const i of q.items) if (!onStandIn(i) && !(i.trap === 'A8' && stood.size > 0)) p.items.push(i);
  p.throwIfStopped();
  return judged;
}

// K7: within a verdict group, are the checked records spread through the run as a random pick
// would spread them? The Wilcoxon rank-sum test (Wilcoxon 1945; Mann and Whitney 1947), normal
// approximation, on the records' places in the run: checked records bunched at the start (the
// first 30) or the end are what a pick by position looks like. Warned at |z| > 1.96, the z used
// everywhere (an honest random pick trips it 3.5-5.1% of the time in each verdict group, measured:
// docs/METRICS.md); a pick by anything else (by topic, by length) cannot be seen here.
const BUNCHED = 1.96;
function bunched(outInOrder, verdictOf, checkedIds, p, predPath) {
  for (const g of GROUPS) {
    const members = outInOrder.filter(id => verdictOf.get(id) === (g === 'flagged'));
    const m = members.length;
    const ranks = members.map((id, i) => (checkedIds.has(id) ? i + 1 : 0)).filter(r => r > 0);
    const k = ranks.length;
    if (k === 0 || k === m) continue;
    const z = (ranks.reduce((s, r) => s + r, 0) - k * (m + 1) / 2) / Math.sqrt(k * (m - k) * (m + 1) / 12);
    if (Math.abs(z) <= BUNCHED) continue;
    p.warn('K7', predPath, 'the ' + k + ' checked records the judge ' + (g === 'flagged' ? 'flags' : 'passes') + ' sit mostly near the ' + (z < 0 ? 'start' : 'end') +
      ' of the run (rank-sum z = ' + z.toFixed(2) + '): if they were picked by position rather than at random, the estimate can be off. Pick them at random within each verdict group');
  }
}

// config: a loaded config. predPath: the run. judgeKeyPath: the judge's answer key for every
// record. personKeyPath: the person's answer key for the records they checked. target: a
// percentage, or null. Throws, listing every stop; returns one results object.
// K14: --picks, the list estimate --pick wrote (--json). The person's key should hold exactly the
// picked records: a record checked that was not picked, or a picked one left unchecked, means the
// checks are no longer the random pick. Strict: it may be a fix-up the person can explain. A picks
// file that names another run is said plainly, rather than as two lists of mismatches.
// Returns { file, seed, n, exact } for the report, or null after a stop.
function picksCheck(picksPath, checkedIds, personKeyPath, predPath, p) {
  let raw;
  try { raw = JSON.parse(readText(picksPath).replace(/^﻿/, '')); } catch (e) {
    p.stop('K14', picksPath, (e.code ? 'cannot read the picks file: ' : 'not valid JSON: ') + e.message);
    return null;
  }
  const picks = raw && Array.isArray(raw.picks) ? raw.picks : null;
  if (!picks || !picks.every(x => typeof x === 'string')) {
    p.stop('K14', picksPath, 'expected the file estimate --pick --json writes, with a "picks" list of record ids');
    return null;
  }
  const from = raw.inputs && typeof raw.inputs.predictions === 'string' ? raw.inputs.predictions : null;
  if (from !== null && nodePath.resolve(from) !== nodePath.resolve(predPath)) {
    p.strict('K14', picksPath, 'this picks file was made from another run: ' + from + ' (this estimate reads ' + predPath + '). Pick again from this run');
    return { file: picksPath, seed: raw.seed ?? null, n: picks.length, exact: false };
  }
  const picked = new Set(picks);
  const missing = picks.filter(id => !checkedIds.has(id));
  const extra = [...checkedIds].filter(id => !picked.has(id));
  if (missing.length) p.strict('K14', personKeyPath, missing.length + ' picked record(s) were not checked: ' + list(missing) + '. Leaving picked records out can bias the estimate: check them');
  if (extra.length) p.strict('K14', personKeyPath, extra.length + ' checked record(s) are not in the picked list ' + picksPath + ': ' + list(extra) + '. Checks added by hand are not a random pick');
  return { file: picksPath, seed: raw.seed ?? null, n: picks.length, exact: missing.length === 0 && extra.length === 0 };
}

function estimateRun({ config, predPath, judgeKeyPath, personKeyPath, mode = 'strict', target = null, picksPath = null }) {
  const p = problems(mode);
  if (config.split) p.warn('P31', 'config', 'the config has a split: estimate ignores it and reads every record, the held-out half too, and split.log does not count that look. Keep the held-out half out of the files given here');
  // K9: one file as both keys: the person "agrees" with the judge everywhere, and proves nothing.
  // A copy of the judge's key under another name is the same thing.
  const sameContent = () => { try { return fs.readFileSync(judgeKeyPath).equals(fs.readFileSync(personKeyPath)); } catch (e) { return false; } };
  if (nodePath.resolve(judgeKeyPath) === nodePath.resolve(personKeyPath) || sameContent()) {
    p.stop('K9', personKeyPath, 'is also the judge\'s key (the same file, or exactly the same content): the person\'s checks must be their own answer key, written without seeing the judge\'s verdicts');
    p.throwIfStopped();
  }
  const run = {}, judge = {}, person = {};
  const predictions = readSide(config, predPath, 'predictions', p, run);
  const judgeKey = readSide(config, judgeKeyPath, 'key', p, judge);
  const personKey = readSide(config, personKeyPath, 'key', p, person);
  selfScored(config, run, judge, predPath, judgeKeyPath, p);
  selfScored(config, run, person, predPath, personKeyPath, p);
  p.throwIfStopped();

  const runIds = new Set(predictions.map(r => r.id));
  // K1, K2: both stop in lenient mode too. A checked record the run never produced is a check of
  // something else; a record the judge has no verdict on cannot be put in a verdict group.
  const strangers = [...new Set(personKey.map(k => k.id))].filter(id => !runIds.has(id));
  if (strangers.length) p.stop('K1', personKeyPath, strangers.length + ' checked record(s) are not in the run ' + predPath + ': ' + list(strangers) + '. Ids must match exactly');
  p.throwIfStopped();

  // Pair each key with the run (align.js: duplicate ids, B3; unknown routes; ...). The person's
  // key pairs with the records it checked only. Problems on the run's own side would be found
  // twice, so the second pairing's are added only when new. A8 (every prediction matches the key)
  // is no warning sign for a person's checks: a sample with no error in it is a real outcome.
  const judged = judgeRun(config, predictions, judgeKey, predPath, judgeKeyPath, p);
  const checkedIds = new Set(personKey.map(k => k.id));
  // A checked duplicate's primary may not be among the checks, and align.js looks for it in the
  // key it is given (C9). So the judge's records of those primaries join the person's key for the
  // pairing only, and are dropped after it, with anything found on them: the judge pairing has
  // already reported those. A primary that is not in the run at all still stops.
  const q = problems(mode);
  const judgeById = new Map(judgeKey.map(k => [k.id, k]));
  const primaries = [...new Set(personKey.map(k => k.duplicate_of).filter(d => d && !checkedIds.has(d) && judgeById.has(d)))];
  const pairedKey = [...personKey, ...primaries.map(id => judgeById.get(id))];
  const pairedIds = new Set(pairedKey.map(k => k.id));
  const pairedAll = align(predictions.filter(r => pairedIds.has(r.id)), pairedKey, config, q, { predSource: predPath, keySource: personKeyPath });
  const checkedRecords = pairedAll.filter(r => checkedIds.has(r.id));
  const onPrimary = i => primaries.some(id => i.where === personKeyPath + ' ' + id || i.where === predPath + ' ' + id);
  const seen = new Set(p.items.map(i => i.trap + i.where + i.message));
  for (const i of q.items) if (i.trap !== 'A8' && !onPrimary(i) && !seen.has(i.trap + i.where + i.message)) p.items.push(i);
  if (p.items.some(i => i.level === 'stop')) p.throwIfStopped();
  differentOutputs(config, judgeKey, personKey, judgeKeyPath, personKeyPath, p);
  const picksInfo = picksPath ? picksCheck(picksPath, checkedIds, personKeyPath, predPath, p) : null;

  // Each key scored by the harness's own rules. The person's records are judged with the whole
  // run's routes (a duplicate's primary may not be among the checked records).
  const judgeOf = new Map(judgeAll(judged, config).map(j => [j.id, j]));
  const ctx = { ...buildContext(pairedAll), classById: buildContext(judged).classById };
  const personOf = new Map(checkedRecords.map(r => [r.id, judgeRecord(r, config, ctx)]));

  const outIds = predictions.map(r => r.id).filter(id => judgeOf.get(id).route_class === 'auto');
  const out = outIds.length;
  // Trap P2: every model call failed. A report says so at the top; a gate fails on it (bin/wfeval.js).
  const failed = predictions.filter(r => !r.scored).length;
  const nothing = failedShare(failed, predictions.length);
  if (out === 0) {
    p.stop('K5', predPath, 'no record went out without review: there is no silent error rate to estimate');
    try { p.throwIfStopped(); } catch (e) { e.nothing_evaluated = nothing; throw e; }
  }
  const isOut = new Set(outIds);
  const flaggedOf = new Map(outIds.map(id => [id, Boolean(judgeOf.get(id).silent)]));
  const flagged = outIds.filter(id => flaggedOf.get(id)).length;
  bunched(outIds, flaggedOf, checkedIds, p, personKeyPath);

  // K5: checks of records sent to a person or blocked are no part of this rate's base.
  const notOut = [...checkedIds].filter(id => !isOut.has(id));
  const used = [...checkedIds].filter(id => isOut.has(id));
  if (notOut.length) {
    p.warn('K5', personKeyPath, notOut.length + ' checked record(s) did not go out without review and are left out of the estimate: ' + list(notOut) +
      '. The silent error rate counts only records that went out without review');
  }
  if (used.length === 0) {
    p.stop('K5', personKeyPath, 'none of the checked records went out without review: there is nothing to estimate the silent error rate from');
    p.throwIfStopped();
  }

  const checked = { flagged: { n: 0, errors: 0 }, passed: { n: 0, errors: 0 } };
  const matrix = { error: { error: 0, fine: 0 }, fine: { error: 0, fine: 0 } };   // [person][judge]
  const disagreements = [];
  for (const id of outIds.filter(x => checkedIds.has(x))) {
    const j = flaggedOf.get(id);
    const y = Boolean(personOf.get(id).silent);
    const g = checked[j ? 'flagged' : 'passed'];
    g.n++;
    if (y) g.errors++;
    matrix[y ? 'error' : 'fine'][j ? 'error' : 'fine']++;
    if (j !== y) {
      disagreements.push({ id, judge: j, person: y, judge_types: j ? judgeOf.get(id).silent.types : [], person_types: y ? personOf.get(id).silent.types : [] });
    }
  }

  // K4: the judge used one verdict only. Then it splits nothing, and the estimate is the
  // person's own rate (the one group's).
  if (flagged === 0 || flagged === out) {
    p.warn('K4', judgeKeyPath, 'the judge ' + (flagged === 0 ? 'flags none' : 'flags every one') + ' of the ' + out + ' records out without review, so it splits them into one group only: ' +
      'the estimate is the person\'s own rate, and the judge adds nothing');
  }
  const counts = { out, flagged, checked };
  const est = estimateRange(counts);
  // K3: a group the judge used, with no checked record. Its rate could be anything: bounds only.
  const W = { flagged: flagged / out, passed: 1 - flagged / out };
  const unchecked = GROUPS.filter(g => W[g] > 0 && checked[g].n === 0);
  for (const g of unchecked) {
    p.warn('K3', personKeyPath, 'none of the ' + (g === 'flagged' ? flagged : out - flagged) + ' records the judge ' + (g === 'flagged' ? 'flags' : 'passes') +
      ' was checked, so their rate could be anything from 0% to 100%: there is no estimate, only bounds. Check some of them, picked at random');
  }

  // The person's checks alone are a fair rate only for a random sample of the records out. Its
  // share of flagged records then sits near the run's: |z| <= 1.96 against the run's share.
  const n = checked.flagged.n + checked.passed.n;
  const y = checked.flagged.errors + checked.passed.errors;
  // How the checks were split: exactly as --pick splits that many (the recommended way), or not.
  const pickSplit = allocate(n, out, flagged, PICK_RULE);
  const split = pickSplit.flagged === checked.flagged.n && pickSplit.passed === checked.passed.n ? 'pick' : 'other';
  const shareZ = W.flagged > 0 && W.flagged < 1 ? (checked.flagged.n - n * W.flagged) / Math.sqrt(n * W.flagged * (1 - W.flagged)) : 0;

  p.throwIfStopped();
  return {
    kind: 'estimate',
    inputs: { predictions: predPath, judge_key: judgeKeyPath, person_key: personKeyPath, mode, wrong_when: config.wrong_when, ...(picksPath ? { picks: picksPath } : {}) },
    ...(nothing ? { nothing_evaluated: { why: nothing } } : {}),
    judge_records: judgeKey.length,
    records: predictions.length,
    out,
    judge: { flagged, rate: rate(flagged, out) },
    checked: { ...checked, not_out: notOut },
    estimate: {
      pct: pct1(est.estimate), low_pct: pct1(est.low), high_pct: pct1(est.high), why: est.why,
      // Not rounded here: the reports round it once, where they show it (as the mix does, G6).
      worth_records: worthOf(est.estimate, est.low, est.high),
    },
    person_only: { rate: rate(y, n), looks_random: !picksInfo && Math.abs(shareZ) <= 1.96, why_not: picksInfo ? 'picked_by_verdict' : Math.abs(shareZ) > 1.96 ? 'flag_share' : null, flagged_share_pct: pct(checked.flagged.n, n), run_flagged_share_pct: pct(flagged, out) },
    judge_quality: {
      person_errors: y,
      judge_caught: matrix.error.error,
      judge_flags_checked: checked.flagged.n,
      person_confirmed: checked.flagged.errors,
      kappa: cohensKappa(matrix, ['error', 'fine']),
    },
    disagreements,
    unchecked_groups: unchecked,
    split,
    picks: picksInfo,
    target: target === null ? null : targetOf(counts, est, target),
    problems: p.items,
  };
}

// ---------- Which records to check (estimate --pick) ----------
//
// The split between the judge's verdict groups that docs/METRICS.md recommends ('plan' in
// allocate(): the narrowest range if the flags were half wrong and the passes all right), chosen
// by scripts/estimate-designs.js.
const PICK_RULE = 'plan';

// mulberry32: a small seeded generator, so the same seed always picks the same records.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The first k of ids after a seeded Fisher-Yates shuffle: k chosen at random, every set of k
// equally likely.
function choose(ids, k, u) {
  const a = [...ids];
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(u() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

// n records out without review for a person to check, split between the judge's verdict groups
// by PICK_RULE and chosen at random within each with the seed. Listed in the run's order, so the
// list does not tell the person which records the judge flagged (traps K10, K11, K13).
function pickRun({ config, predPath, judgeKeyPath, n, seed = 1, mode = 'strict', configPath = null }) {
  if (!Number.isInteger(n) || n < 1) throw new Error('[K10] --pick must be a whole number of 1 or more, got ' + JSON.stringify(n));
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('[K12] --seed must be a whole number from 0 to 4294967295 (larger ones repeat smaller ones), got ' + JSON.stringify(seed));
  const p = problems(mode);
  if (config.split) p.warn('P31', 'config', 'the config has a split: estimate ignores it and reads every record, the held-out half too, and split.log does not count that look. Keep the held-out half out of the files given here');
  const run = {}, judge = {};
  const predictions = readSide(config, predPath, 'predictions', p, run);
  const judgeKey = readSide(config, judgeKeyPath, 'key', p, judge);
  selfScored(config, run, judge, predPath, judgeKeyPath, p);
  p.throwIfStopped();
  const judged = judgeRun(config, predictions, judgeKey, predPath, judgeKeyPath, p);
  const judgeOf = new Map(judgeAll(judged, config).map(j => [j.id, j]));
  const outIds = predictions.map(r => r.id).filter(id => judgeOf.get(id).route_class === 'auto');
  const out = outIds.length;
  if (out === 0) {
    p.stop('K11', predPath, 'no record went out without review: there is nothing to pick, and no silent error rate to estimate');
    p.throwIfStopped();
  }
  if (n > out) {
    p.stop('K11', predPath, '--pick ' + n + ' asks for more checks than there are records: ' + out + ' records went out without review. Check all ' + out + ' with --pick ' + out + ', or fewer');
    p.throwIfStopped();
  }
  const flaggedIds = outIds.filter(id => judgeOf.get(id).silent);
  const passedIds = outIds.filter(id => !judgeOf.get(id).silent);
  if (flaggedIds.length === 0 || passedIds.length === 0) {
    p.warn('K13', judgeKeyPath, 'the judge ' + (flaggedIds.length === 0 ? 'flags none' : 'flags every one') + ' of the ' + out + ' records out without review, so there is one group only: ' +
      'the pick is a plain random sample, and the judge adds nothing');
  }
  // K10: one check in each verdict group the judge used, or there is no estimate (K3).
  const groupsUsed = (flaggedIds.length > 0 ? 1 : 0) + (passedIds.length > 0 ? 1 : 0);
  if (n < groupsUsed) {
    p.stop('K10', predPath, '--pick ' + n + ' is too few: it takes at least ' + groupsUsed + ' checks, one in each verdict group (the judge flags ' + flaggedIds.length +
      ' and passes ' + passedIds.length + '); with a group unchecked there is no estimate. Use --pick ' + groupsUsed + ' or more');
    p.throwIfStopped();
  }
  const allocation = allocate(n, out, flaggedIds.length, PICK_RULE);
  const u = seeded(seed);
  const chosen = new Set([...choose(flaggedIds, allocation.flagged, u), ...choose(passedIds, allocation.passed, u)]);
  return {
    kind: 'pick',
    inputs: { config: configPath, predictions: predPath, judge_key: judgeKeyPath, mode },
    records: predictions.length,
    out,
    flagged: flaggedIds.length,
    n, seed, rule: PICK_RULE,
    allocation,
    picks: outIds.filter(id => chosen.has(id)),
    problems: p.items,
  };
}

module.exports = { estimateRun, pickRun };
