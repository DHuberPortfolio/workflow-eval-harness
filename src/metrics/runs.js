// Across runs: variance (how much identical code moves between runs) and compare (did a
// change help, or did it move within that noise?).
//
// Every run is scored against the same key and config, so the runs always cover the same
// records (trap I2) and are judged by the same rules (I4) by construction.

const { pairedDifference } = require('./stats.js');
const { accepted } = require('./slots.js');

const round = (x, d = 1) => (x === null ? null : Number(x.toFixed(d)));

// A rate as an exact percentage, never the rounded one (trap G6).
const exact = r => (r === null || r === undefined || r.d === 0 ? null : (r.n / r.d) * 100);

// The metrics followed across runs: name, unit ("points" for percentages), and how to read
// each from a results object. Built from one run's results, so outputs come from the config.
function metricList(results) {
  const list = [
    { name: 'silent error rate', unit: 'points', get: r => exact(r.routing.silent_errors.rate) },
    { name: 'straight-through', unit: 'points', get: r => exact(r.routing.straight_through) },
  ];
  if (results.routing.silent_omissions) list.push({ name: 'silent omissions', unit: 'points', get: r => exact(r.routing.silent_omissions.rate) });
  list.push({ name: 'review precision', unit: 'points', get: r => exact(r.routing.review_queue.precision) });
  if (results.routing.block) list.push({ name: 'block precision', unit: 'points', get: r => exact(r.routing.block.precision) });
  list.push({ name: 'safeguard failures', unit: 'records', get: r => r.routing.safeguard_failures.records });
  list.push({ name: 'model calls failed', unit: 'records', get: r => r.quality.left_out.model_failed.length });
  for (const [name, o] of Object.entries(results.quality.outputs)) {
    if (o.type === 'set') {
      list.push({ name: name + ' precision', unit: 'points', get: r => exact(r.quality.outputs[name].precision) });
      list.push({ name: name + ' recall', unit: 'points', get: r => exact(r.quality.outputs[name].recall) });
      list.push({ name: name + ' F1', unit: 'F1', get: r => r.quality.outputs[name].f1 });
    } else if (o.declines) {
      // A label that may decline: accuracy is on what was answered, so coverage goes beside it.
      list.push({ name: name + ' accuracy when answered', unit: 'points', get: r => exact(r.quality.outputs[name].accuracy) });
      list.push({ name: name + ' coverage', unit: 'points', get: r => exact(r.quality.outputs[name].declines.coverage) });
      list.push({ name: name + ' unnecessary declines', unit: 'points', get: r => exact(r.quality.outputs[name].declines.unnecessary.rate) });
      if (o.declines.should_have_declined) {
        list.push({ name: name + ' answers that should have been declines', unit: 'points', get: r => exact(r.quality.outputs[name].declines.should_have_declined.rate) });
      }
    } else {
      list.push({ name: name + ' accuracy', unit: 'points', get: r => exact(r.quality.outputs[name].accuracy) });
      if (o.type === 'ordinal') {
        list.push({ name: name + ' within one step', unit: 'points', get: r => exact(r.quality.outputs[name].within_one) });
        list.push({ name: name + ' closeness', unit: 'F1', get: r => r.quality.outputs[name].closeness });
      }
    }
  }
  list.push({ name: 'average calibration gap', unit: 'gap', get: r => r.calibration.overall.ece });
  return list;
}

const decimals = unit => (unit === 'F1' || unit === 'gap' ? 3 : unit === 'records' ? 0 : 1);

function spread(values) {
  const known = values.filter(v => v !== null);
  if (known.length === 0) return { mean: null, sd: null, min: null, max: null, range: null };
  const mean = known.reduce((s, v) => s + v, 0) / known.length;
  // Sample standard deviation (divide by n - 1): the runs are a sample of all the runs
  // this workflow could produce.
  const sd = known.length > 1 ? Math.sqrt(known.reduce((s, v) => s + (v - mean) ** 2, 0) / (known.length - 1)) : null;
  const min = Math.min(...known);
  const max = Math.max(...known);
  return { mean, sd, min, max, range: max - min };
}

// Values an output states in run after run that the key does not list. Each is either the
// same mistake made every time, or something the key is missing; the tool cannot tell
// which, so it lists them for a person to decide. Only values a key could list count: not
// invented ones (outside allowed_values), not inherited ones (they follow from a stated
// value), not suppressed duplicates, and only from runs where the model answered. An
// alternative of an any_of slot is never one: the key already lists it (trap I10).
function keyGapCandidates(runs, config) {
  const found = new Map();
  runs.forEach((run, i) => {
    for (const r of run.results.paired) {
      if (!r.scored || r.route_class === 'exclude') continue;
      for (const [name, o] of Object.entries(config.outputs)) {
        if (o.type !== 'set' || r.key[name] == null) continue;
        const inKey = accepted(r.key[name]);
        const allowed = config.allowed_values[name];
        for (const v of r.pred[name] || []) {
          if (inKey.has(v.value) || v.inherited || (Array.isArray(allowed) && !allowed.includes(v.value))) continue;
          const at = JSON.stringify([r.id, name, v.value]);
          if (!found.has(at)) found.set(at, { id: r.id, output: name, value: v.value, runs: new Set(), applied: new Set(), confidences: [] });
          const c = found.get(at);
          c.runs.add(i);
          if (v.applied) c.applied.add(i);
          if (typeof v.confidence === 'number') c.confidences.push(v.confidence);
        }
      }
    }
  });
  // Most consistent first; ties keep the records' order.
  return [...found.values()]
    .map(c => ({
      id: c.id, output: c.output, value: c.value, runs: c.runs.size, of: runs.length, applied: c.applied.size,
      confidence: c.confidences.length ? { min: Math.min(...c.confidences), max: Math.max(...c.confidences) } : null,
    }))
    .sort((a, b) => b.runs - a.runs);
}

// The silent error rate to quote from repeated runs: the worst run's, with its likely range.
// Never the runs added together (trap I8). They repeat the same records, and a record's runs
// tend to go the same way, so an added-up count looks like more evidence than it is and its
// likely range comes out too narrow. Worst means the highest rate, compared as exact fractions
// (trap G6); on a tie, the run with the wider range. times_out counts a record once per run it
// went out in; records_out counts it once.
function silentToQuote(runs) {
  const rates = runs.map(run => run.results.routing.silent_errors.rate);
  let worst = null;
  rates.forEach((r, i) => {
    if (r.d === 0) return;
    const w = worst === null ? null : rates[worst];
    if (w === null || r.n * w.d > w.n * r.d || (r.n * w.d === w.n * r.d && r.high_pct > w.high_pct)) worst = i;
  });
  const out = new Set();
  for (const run of runs) for (const rec of run.results.records) if (rec.route_class === 'auto') out.add(rec.id);
  return {
    worst_run: worst === null ? null : { run: worst + 1, label: runs[worst].label, ...rates[worst] },
    times_out: rates.reduce((s, r) => s + r.d, 0),
    records_out: out.size,
  };
}

// runs: [{ label, results }], two or more.
function varianceOf(runs, config) {
  const metrics = metricList(runs[0].results).map(m => {
    const values = runs.map(run => m.get(run.results));
    const s = spread(values);
    const d = decimals(m.unit);
    return {
      name: m.name, unit: m.unit,
      values: values.map(v => round(v, d)),
      mean: round(s.mean, d), sd: round(s.sd, d), min: round(s.min, d), max: round(s.max, d), range: round(s.range, d),
    };
  });

  // Which records behave differently from run to run.
  const byId = new Map();
  runs.forEach((run, i) => {
    for (const rec of run.results.records) {
      if (!byId.has(rec.id)) byId.set(rec.id, { id: rec.id, gold_route: rec.gold_route, routes: [], silent: [] });
      const row = byId.get(rec.id);
      row.routes[i] = rec.route;
      row.silent[i] = Boolean(rec.silent);
    }
  });
  const rows = [...byId.values()];
  return {
    runs: runs.map(r => r.label),
    metrics,
    silent_error_rate: silentToQuote(runs),
    records: {
      route_changed: rows.filter(r => new Set(r.routes).size > 1).map(r => ({ id: r.id, routes: r.routes, should: r.gold_route })),
      silent_changed: rows.filter(r => new Set(r.silent).size > 1).map(r => ({ id: r.id, silent: r.silent })),
      key_gap_candidates: keyGapCandidates(runs, config),
    },
  };
}

// before, after: results objects. noise: a varianceOf() result from repeated runs of
// identical code, or null. A change no larger than the noise range is "within noise".
function compareOf(before, after, noise = null) {
  const metrics = metricList(after).map(m => {
    const b = m.get(before);
    const a = m.get(after);
    const d = decimals(m.unit);
    const delta = a === null || b === null ? null : a - b;
    const band = noise ? noise.metrics.find(x => x.name === m.name) : null;
    let verdict;
    if (delta === null) verdict = 'not measured';
    else if (round(delta, d) === 0) verdict = 'no change';
    else if (!band || band.range === null) verdict = 'no noise baseline';
    else verdict = Math.abs(round(delta, d)) <= band.range ? 'within noise' : 'beyond noise';
    return { name: m.name, unit: m.unit, before: round(b, d), after: round(a, d), delta: round(delta, d), noise_range: band ? band.range : null, verdict };
  });

  const beforeById = new Map(before.records.map(r => [r.id, r]));
  const changes = { route_changed: [], became_silent: [], no_longer_silent: [], became_omission: [], no_longer_omission: [], values_changed: [] };
  for (const a of after.records) {
    const b = beforeById.get(a.id);
    if (!b) continue;
    if (a.route !== b.route) {
      let outcome = null;
      if (a.gold_class !== null) {
        const wasRight = b.route_class === b.gold_class;
        const isRight = a.route_class === a.gold_class;
        outcome = !wasRight && isRight ? 'fixed' : wasRight && !isRight ? 'broke' : isRight ? 'still right' : 'still wrong';
      }
      changes.route_changed.push({ id: a.id, before: b.route, after: a.route, should: a.gold_route, outcome });
    }
    if (a.silent && !b.silent) changes.became_silent.push({ id: a.id, types: a.silent.types });
    if (!a.silent && b.silent) changes.no_longer_silent.push({ id: a.id, types: b.silent.types });
    if (a.omission && !b.omission) changes.became_omission.push({ id: a.id, types: a.omission.types });
    if (!a.omission && b.omission) changes.no_longer_omission.push({ id: a.id, types: b.omission.types });
    if (JSON.stringify(a.differences) !== JSON.stringify(b.differences)) {
      changes.values_changed.push({ id: a.id, before: b.differences, after: a.differences });
    }
  }
  const fixed = changes.route_changed.filter(c => c.outcome === 'fixed').length;
  const broke = changes.route_changed.filter(c => c.outcome === 'broke').length;
  return {
    noise_runs: noise ? noise.runs : null, metrics, paired: pairedOf(before, after), records: changes,
    summary: { routes_fixed: fixed, routes_broken: broke },
  };
}

// The record-by-record outcomes a change can fix or break.
function pairedOutcomes(after) {
  const list = [{ name: 'silent errors', is: r => Boolean(r.silent) }];
  if (after.routing.silent_omissions) list.push({ name: 'silent omissions', is: r => Boolean(r.omission) });
  list.push({ name: 'unnecessary reviews', is: r => r.wasted_review });
  if (after.records.some(r => r.gold_class !== null)) {
    list.push({ name: 'routed against the answer key', is: r => r.gold_class !== null && r.route_class !== r.gold_class });
  }
  return list;
}

// Trap I9: on the same records, only the records that changed say anything about a change.
// For each outcome: how many records it fixed and broke, and the likely range of the change, as
// points of all the records (Tango's paired range; better or worse only when the range clears 0).
// Run-to-run noise flips records both ways alike, so this needs no repeated runs, which the
// metrics above do. Counts, not rates: a rate's base moves when routes move.
function pairedOf(before, after) {
  const beforeById = new Map(before.records.map(r => [r.id, r]));
  const pairs = after.records.filter(a => beforeById.has(a.id)).map(a => [beforeById.get(a.id), a]);
  const tested = pairs.length;
  const outcomes = pairedOutcomes(after).map(o => {
    const fixed = pairs.filter(([b, a]) => o.is(b) && !o.is(a)).map(([, a]) => a.id);
    const broke = pairs.filter(([b, a]) => !o.is(b) && o.is(a)).map(([, a]) => a.id);
    const row = {
      name: o.name, before: pairs.filter(([b]) => o.is(b)).length, after: pairs.filter(([, a]) => o.is(a)).length,
      fixed: fixed.length, broke: broke.length,
    };
    row.change = row.after - row.before;
    if (tested === 0) return { ...row, low_pct: null, high_pct: null, verdict: 'not measured', fixed_ids: fixed, broke_ids: broke };
    // The range is for the drop (before minus after); the change is that turned round (+ 0
    // turns a -0 into 0).
    const d = pairedDifference(fixed.length, broke.length, tested);
    const verdict = fixed.length + broke.length === 0 ? 'no change' : d.low > 0 ? 'better' : d.high < 0 ? 'worse' : 'unclear';
    return { ...row, low_pct: round(-d.high * 100) + 0, high_pct: round(-d.low * 100) + 0, verdict, fixed_ids: fixed, broke_ids: broke };
  });
  return { records: tested, outcomes };
}

module.exports = { varianceOf, compareOf, metricList };
