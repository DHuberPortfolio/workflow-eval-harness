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

const { clusteredRange } = require('./stats.js');

const pct1 = x => (x === null ? null : Number((x * 100).toFixed(1)));

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

module.exports = { scoreClusters };
