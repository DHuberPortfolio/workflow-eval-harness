// The silent error rate's likely range, counting clusters (config.clusters, score --cluster-by).
//
// Records that come in clumps (retellings of one news story, one filing's statements) tend to go
// right or wrong together, so they are less evidence than as many separate records, and the
// headline's range, which counts every record as independent, comes out too narrow (trap G14).
// This range counts clusters instead (clusteredRange in stats.js). The headline is left as it is,
// so nothing else in a report moves: this is one more line under it.
//
// Only records out without review count, as in the silent error rate: a cluster none of whose
// records went out is not one of the clusters. A record with no cluster value is a cluster of its
// own, and those are counted, so the report can say how many.
// Per-group rows and --target stay as they are (records counted as independent); the reports say so.

const { clusteredRange, pct1 } = require('./stats.js');
const { resolveSet } = require('./slots.js');
const { DECLINED } = require('../config.js');

// summaries: results.records (each with id, route_class, silent); records: the paired records,
// each with its cluster. null when the config has no clusters, so results without them are unchanged.
function scoreClusters(summaries, records, config) {
  if (!config.clusters) return null;
  const clusterOf = new Map(records.map(r => [r.id, r.cluster ?? null]));
  const out = summaries.filter(s => s.route_class === 'auto');
  const byCluster = new Map();
  let alone = 0;
  for (const s of out) {
    const c = clusterOf.get(s.id);
    // A record with no value: a cluster of its own, keyed so it can never meet a real value.
    const k = c === null ? (alone++, { alone: s.id }) : 'v:' + c;
    if (!byCluster.has(k)) byCluster.set(k, { n: 0, y: 0 });
    const t = byCluster.get(k);
    t.n++;
    if (s.silent) t.y++;
  }
  const r = clusteredRange([...byCluster.values()]);
  const { field, from } = config.clusters;
  return {
    field, from,
    records: out.length,
    silent_errors: out.filter(s => s.silent).length,
    clusters: byCluster.size,
    records_own_cluster: alone,
    method: r ? r.method : null,
    why: r ? r.why : null,
    // As worked out, not rounded: the reports round them once, where they show them. Rounded here
    // too, 5.46 records' worth would become 5.5, then "about 6" (trap G6).
    design_effect: r ? r.design_effect : null,
    effective_records: r ? r.effective : null,
    pct: r ? pct1(r.p) : null,
    low_pct: r ? pct1(r.low) : null,
    high_pct: r ? pct1(r.high) : null,
  };
}

// Each output's own error rate counted in clusters (trap G22): a gate on one output (the attacker's goal, say) reads the same
// clumps as the headline, so it needs the same care. Population and "wrong" are the quality section's: scored records not
// suppressed; for a label that may decline, only the answered ones; a set is wrong unless it matches exactly.
function scoreOutputClusters(records, config) {
  if (!config.clusters) return null;
  const pop = records.filter(r => r.scored && r.route_class !== 'exclude');
  const out = {};
  for (const [name, o] of Object.entries(config.outputs)) {
    const byCluster = new Map();
    let alone = 0;
    let n = 0;
    let wrong = 0;
    for (const r of pop) {
      let bad;
      if (o.type === 'set') {
        const s = resolveSet(r.pred[name], r.key[name]);
        bad = s.wrong.length > 0 || s.unfilled.length > 0;
      } else {
        const p = r.pred[name];
        if (o.decline && (!p || p.value === DECLINED)) continue;   // accuracy on what was answered, as the quality section counts it
        bad = !p || p.value !== r.key[name];
      }
      const c = r.cluster ?? null;
      const k = c === null ? (alone++, { alone: r.id }) : 'v:' + c;
      if (!byCluster.has(k)) byCluster.set(k, { n: 0, y: 0 });
      const t = byCluster.get(k);
      t.n++;
      n++;
      if (bad) { t.y++; wrong++; }
    }
    const rr = n ? clusteredRange([...byCluster.values()]) : null;
    out[name] = {
      records: n, wrong, clusters: byCluster.size, records_own_cluster: alone,
      method: rr ? rr.method : null, why: rr ? rr.why : null,
      design_effect: rr ? rr.design_effect : null, effective_records: rr ? rr.effective : null,
      pct: rr ? pct1(rr.p) : null, low_pct: rr ? pct1(rr.low) : null, high_pct: rr ? pct1(rr.high) : null,
    };
  }
  return out;
}

module.exports = { scoreClusters, scoreOutputClusters };
