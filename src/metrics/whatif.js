// What-if: what would the numbers be with different thresholds?
//
// A threshold change can only move a record whose route the confidence gate decided.
// Which records those are comes from config.whatif.movable_field; without it, every
// record that went through or was reviewed is assumed movable, which gives an upper bound
// on what can move. Blocked and suppressed records never move.
//
// Gate sweep: values never change, only routes, so precision and recall stay fixed.
// Floor sweep: values are re-admitted or evicted; records that change but cannot move are
// reported as "needs replay" rather than guessed. Each floor's numbers come from judgeAll and
// scoreQuality on the changed records, which resolve the key's any_of slots against what is
// applied at that floor (slots.js): a slot an evicted value filled is unfilled there.
// Gate certification: with a target, which gates are shown to keep silent errors under it,
// counting every gate the sweep tried (certifyGates, below; trap E9).

const { judgeAll, gatePasses } = require('./judge.js');
const { scoreRouting } = require('./routing.js');
const { scoreQuality } = require('./classification.js');
const { chanceAtMost, wilson } = require('./stats.js');

const round = (x, d) => Number(x.toFixed(d));

function steps(from, to, step) {
  if (!(from >= 0 && to <= 1 && from <= to && step > 0)) throw new Error('thresholds must satisfy 0 <= from <= to <= 1 and step > 0');
  const out = [];
  for (let i = 0; round(from + i * step, 4) <= to + 1e-9; i++) out.push(round(from + i * step, 4));
  return out;
}

function movableFn(config) {
  return r => (r.route_class === 'auto' || r.route_class === 'review') && (config.whatif ? r.movable === true : true);
}

// The config as it would be with other thresholds, so the judgments (including the
// safeguard checks) use the what-if thresholds, not the real ones.
function withThresholds(config, changes) {
  return { ...config, thresholds: { ...config.thresholds, ...changes } };
}

function summarize(records, config, extra) {
  const routing = scoreRouting(judgeAll(records, config), config, records);
  return {
    ...extra,
    through: records.filter(r => r.route_class === 'auto').map(r => r.id),
    straight_through: routing.straight_through,
    silent_errors: routing.silent_errors.records.map(x => x.id),
    silent_error_rate: routing.silent_errors.rate,
    silent_omissions: routing.silent_omissions ? routing.silent_omissions.rate : null,
    review_queue_precision: routing.review_queue.precision,
    wasted_reviews: routing.review_queue.wasted,
    safeguard_failures: routing.safeguard_failures.records,
  };
}

// outputs: which gated outputs to sweep together (default: all of them). target: a percentage
// (5 means 5%) to certify the gates against, at `confidence` (certifyGates).
function gateSweep(records, config, { outputs = null, from = 0.5, to = 1, step = 0.05, target = null, confidence = 0.95 } = {}) {
  if (target !== null) checkCertify(target, confidence);
  const gates = config.thresholds ? config.thresholds.auto_publish : {};
  if (Object.keys(gates).length === 0) throw new Error('the gate what-if needs thresholds.auto_publish in the config');
  const swept = outputs || Object.keys(gates);
  for (const o of swept) if (!(o in gates)) throw new Error('"' + o + '" has no auto_publish threshold to sweep');

  const canMove = movableFn(config);
  const current = new Set(swept.map(o => gates[o])).size === 1 ? gates[swept[0]] : null;
  const grid = steps(from, to, step);
  if (current !== null && !grid.includes(current)) { grid.push(current); grid.sort((a, b) => a - b); }

  const rows = grid.map(t => {
    const auto = { ...gates };
    for (const o of swept) auto[o] = t;
    const cfg = withThresholds(config, { auto_publish: auto });
    const moved = records.map(r => {
      if (!canMove(r)) return r;
      const pass = gatePasses(r, cfg);
      if (pass === null) return r;   // a confidence is missing: leave the record where it was
      const cls = pass ? 'auto' : 'review';
      return cls === r.route_class ? r : { ...r, route_class: cls, route: '(what-if ' + cls + ')' };
    });
    return summarize(moved, cfg, {
      threshold: t,
      current: t === current,
      moved_in: moved.filter((m, i) => m.route_class === 'auto' && records[i].route_class !== 'auto').map(m => m.id),
      moved_out: moved.filter((m, i) => m.route_class !== 'auto' && records[i].route_class === 'auto').map(m => m.id),
    });
  });

  // Self-check: at the current threshold the simulation should reproduce the real routes.
  // If it does not, the movable assumption is wrong for this workflow.
  let check = null;
  if (current !== null) {
    const cfg = withThresholds(config, {});
    const movable = records.filter(canMove);
    const differing = movable.filter(r => { const p = gatePasses(r, cfg); return p !== null && (p ? 'auto' : 'review') !== r.route_class; }).map(r => r.id);
    check = { threshold: current, movable: movable.length, reproduced: movable.length - differing.length, differing };
  }

  return {
    kind: 'gate',
    outputs: swept,
    assumption: config.whatif ? 'records marked movable by ' + config.whatif.movable_field
      : 'no whatif.movable_field: every record that went out without review or was sent to a person is assumed routed by the gate alone (an upper bound)',
    as_run: summarize(records, config, { threshold: null, current: false, moved_in: [], moved_out: [] }),
    ...(target === null ? { rows, certification: null } : certifyGates(rows, target, confidence)),
    check,
  };
}

// ---------- A certified gate (trap E9) ----------
//
// A sweep tries many gates, and a person picks the loosest one that looks under the target. One
// of eleven gates can look good by luck alone, the way one of twenty keys may open a lock: the
// golden set flatters the gate picked from it (the multiple-comparisons problem). Learn then Test
// (Angelopoulos, Bates, Candès, Jordan, Lei 2021, arXiv 2110.01052) tests every gate tried and
// bounds the chance that ANY gate it certifies is wrong.
//
// One gate, one test. Its records out without review (n) and the silent errors among them (k)
// give the exact binomial p-value p = P(Bin(n, target) <= k): the chance that a true rate at the
// target would look this good or better (a true rate above the target, less often still). With
// n = 0, p = 1: nothing went out, so nothing can be certified.
//
// Bonferroni: a gate is certified when p <= (1 - confidence) / m, m the gates in the sweep. The
// chance that any certified gate's true rate is at or above the target is then at most
// 1 - confidence, however the gates' records overlap. Not LTT's fixed-sequence order (test the
// strictest gate first, loosen until one fails), though it spends nothing on the number of gates:
// the strictest gates let out few records or none (1.00 lets out nothing, so p = 1), so the
// sequence would stop at its first gate and certify nothing. Bonferroni pays for every gate tried
// and lets each one stand on its own records.
//
// The guarantee is for records like these, and only as good as the what-if's assumption about
// which records the gate can move; the report says both.

const CONFIDENCES = [0.9, 0.95, 0.99];

function checkCertify(targetPct, confidence) {
  if (!(typeof targetPct === 'number' && targetPct > 0 && targetPct < 100)) throw new Error('--target must be a percentage above 0 and below 100');
  if (!CONFIDENCES.includes(confidence)) throw new Error('--confidence must be 0.9, 0.95 or 0.99');
}

// rows: gateSweep's rows. Returns the rows with p_value and certified added, and the summary:
//   best               the loosest certified gate: the most straight-through; on a tie, the
//                      strictest gate (tied gates let out the same records here, and the looser
//                      one would also let out records between them that the set holds none of)
//   looks_under_alone  the loosest gate whose likely range alone is under the target (the test
//                      score --target uses for one run), certified or not
//   least_records_out  the fewest records out without review that could certify any gate here:
//                      all of them without a silent error, (1 - target)^n <= level
function certifyGates(rows, targetPct, confidence = 0.95) {
  checkCertify(targetPct, confidence);
  const target = targetPct / 100;
  // Whole hundredths, so 1 - 0.95 is exactly 0.05, not 0.050000000000000044.
  const level = Math.round((1 - confidence) * 100) / 100 / rows.length;
  const tested = rows.map(r => {
    const { n: k, d: n } = r.silent_error_rate;
    const p = n === 0 ? 1 : chanceAtMost(k, n, target);
    return { ...r, p_value: p, certified: p <= level };
  });
  const loosest = list => list.reduce((a, r) => (a === null || r.straight_through.n > a.straight_through.n ||
    (r.straight_through.n === a.straight_through.n && r.threshold > a.threshold) ? r : a), null);
  const best = loosest(tested.filter(r => r.certified));
  const alone = loosest(tested.filter(r => r.silent_error_rate.d > 0 && wilson(r.silent_error_rate.n, r.silent_error_rate.d).high < target));
  const none = n => Math.exp(n * Math.log1p(-target));   // the chance of no silent error in n at the target
  let least = Math.max(1, Math.ceil(Math.log(level) / Math.log1p(-target)));
  while (least > 1 && none(least - 1) <= level) least--;
  while (none(least) > level) least++;
  return {
    rows: tested,
    certification: {
      target_pct: targetPct, confidence, gates_tested: rows.length, level,
      best: best && { threshold: best.threshold, p_value: best.p_value, silent_error_rate: best.silent_error_rate, straight_through: best.straight_through },
      looks_under_alone: alone && { threshold: alone.threshold, high_pct: alone.silent_error_rate.high_pct, certified: alone.certified },
      least_records_out: least,
    },
  };
}

function floorSweep(records, config, { from = 0.4, to = 0.9, step = 0.05 } = {}) {
  const f0 = config.thresholds ? config.thresholds.floor : null;
  if (f0 === null) throw new Error('the floor what-if needs thresholds.floor in the config');
  const canMove = movableFn(config);
  const sets = Object.entries(config.outputs).filter(([, o]) => o.type === 'set').map(([name]) => name);
  const grid = steps(from, to, step);
  if (!grid.includes(f0)) { grid.push(f0); grid.sort((a, b) => a - b); }

  const rows = grid.map(f => {
    const cfg = withThresholds(config, { floor: f });
    const readmitted = [];
    const evicted = [];
    const needsReplay = [];
    const changed = records.map(r => {
      let touched = false;
      const pred = { ...r.pred };
      for (const name of sets) {
        pred[name] = r.pred[name].map(v => {
          if (v.confidence === null) return v;
          if (v.applied && v.confidence < f) { touched = true; evicted.push(r.id + ' ' + v.value); return { ...v, applied: false }; }
          // Two equivalent values merged into one (D23) whose weakest copy is under f: that copy
          // goes and the value stays, at its highest, as a plain value under f goes rather than
          // counting as a floor failure. Exact for two copies; with more, the ones between are
          // not kept, so a "weakest" gate then sees the highest.
          if (v.applied && v.floor_confidence < f) { touched = true; const kept = { ...v }; delete kept.floor_confidence; return kept; }
          // Assumption: a value rejected below the current floor was rejected by the floor.
          if (!v.applied && v.confidence < f0 && v.confidence >= f) { touched = true; readmitted.push(r.id + ' ' + v.value); return { ...v, applied: true }; }
          return v;
        });
      }
      if (!touched) return r;
      const next = { ...r, pred };
      if (!canMove(r)) { needsReplay.push(r.id); return next; }
      const pass = gatePasses(next, cfg);
      if (pass === null) return next;
      const cls = pass ? 'auto' : 'review';
      return cls === r.route_class ? next : { ...next, route_class: cls, route: '(what-if ' + cls + ')' };
    });
    const q = scoreQuality(changed, cfg);
    return summarize(changed, cfg, {
      floor: f,
      current: f === f0,
      readmitted, evicted, needs_replay: needsReplay,
      overall: q.overall ? { tp: q.overall.tp, fp: q.overall.fp, fn: q.overall.fn, precision: q.overall.precision, recall: q.overall.recall, f1: q.overall.f1 } : null,
      moved: changed.filter((m, i) => m.route_class !== records[i].route_class).map(m => m.id + ' -> ' + m.route_class),
    });
  });

  return {
    kind: 'floor',
    assumption: 'a value rejected with a confidence below the current floor (' + f0 + ') was rejected by the floor, so a lower floor re-admits it. ' +
      'Broader terms of re-admitted values are not added and per-output caps are not applied; records whose route could depend on them are marked "needs replay".',
    rows,
  };
}

module.exports = { gateSweep, floorSweep, steps, certifyGates };
