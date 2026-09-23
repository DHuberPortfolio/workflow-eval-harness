// What-if: what would the numbers be with different thresholds?
//
// A threshold change can only move a record whose route the confidence gate decided.
// Which records those are comes from config.whatif.movable_field; without it, every
// record that went through or was reviewed is assumed movable, which gives an upper bound
// on what can move. Blocked and suppressed records never move.
//
// Gate sweep: values never change, only routes, so precision and recall stay fixed.
// Floor sweep: values are re-admitted or evicted; records that change but cannot move are
// reported as "needs replay" rather than guessed.

const { judgeAll, gatePasses } = require('./judge.js');
const { scoreRouting } = require('./routing.js');
const { scoreQuality } = require('./classification.js');

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
  const routing = scoreRouting(judgeAll(records, config), config);
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

// outputs: which gated outputs to sweep together (default: all of them).
function gateSweep(records, config, { outputs = null, from = 0.5, to = 1, step = 0.05 } = {}) {
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
      : 'no whatif.movable_field: every record that went through or was reviewed is assumed routed by the gate alone (an upper bound)',
    as_run: summarize(records, config, { threshold: null, current: false, moved_in: [], moved_out: [] }),
    rows,
    check,
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

module.exports = { gateSweep, floorSweep, steps };
