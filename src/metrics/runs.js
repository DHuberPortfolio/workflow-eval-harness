// Across runs: variance (how much identical code moves between runs) and compare (did a
// change help, or did it move within that noise?).
//
// Every run is scored against the same key and config, so the runs always cover the same
// records (trap I2) and are judged by the same rules (I4) by construction.

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
  list.push({ name: 'review-queue precision', unit: 'points', get: r => exact(r.routing.review_queue.precision) });
  if (results.routing.block) list.push({ name: 'block precision', unit: 'points', get: r => exact(r.routing.block.precision) });
  list.push({ name: 'safeguard failures', unit: 'records', get: r => r.routing.safeguard_failures.records });
  for (const [name, o] of Object.entries(results.quality.outputs)) {
    if (o.type === 'set') {
      list.push({ name: name + ' precision', unit: 'points', get: r => exact(r.quality.outputs[name].precision) });
      list.push({ name: name + ' recall', unit: 'points', get: r => exact(r.quality.outputs[name].recall) });
      list.push({ name: name + ' F1', unit: 'F1', get: r => r.quality.outputs[name].f1 });
    } else {
      list.push({ name: name + ' accuracy', unit: 'points', get: r => exact(r.quality.outputs[name].accuracy) });
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

// runs: [{ label, results }], two or more.
function varianceOf(runs) {
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
    records: {
      route_changed: rows.filter(r => new Set(r.routes).size > 1).map(r => ({ id: r.id, routes: r.routes, should: r.gold_route })),
      silent_changed: rows.filter(r => new Set(r.silent).size > 1).map(r => ({ id: r.id, silent: r.silent })),
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
  return { noise_runs: noise ? noise.runs : null, metrics, records: changes, summary: { routes_fixed: fixed, routes_broken: broke } };
}

module.exports = { varianceOf, compareOf, metricList };
