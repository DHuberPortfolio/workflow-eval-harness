// The silent error rate on a real mix of traffic (score --mix; traps G18-G21).
//
// A golden set built from traps holds far more hard records than real traffic, so its rate is a
// stress-test rate (G18). Given each label's share of real traffic for one group, this weights
// the group's labels (strata) by those shares: the rate a real mix would see, by stratified
// estimation (mixedRate in stats.js). The headline and the group rows are left as they are: this
// is one more estimate under the headline, never a replacement for it.
//
// Weights need each record in exactly one group, and a weight for every group, so the run's
// labels and the file's must match one for one:
//   - a label in the run with no share stops (G19): the report cannot guess its weight. A record
//     with no label is in "(none)", which needs a share too, and the stop names the record
//   - a share for a label the run does not have stops (G20): those records were never tested
//   - a record with several labels stops (G21): weighted in each, it would count twice
// Every one stops in lenient mode too, as a list of cluster values does (G15): there is no
// weighting to fall back on.

const { mixedRate } = require('./stats.js');
const { NONE } = require('./traps.js');

const pct1 = x => (x === null ? null : Number((x * 100).toFixed(1)));

// mix: loadMix() of the file; summaries: results.records (each with id, route_class, silent);
// records: the paired records, with their groups; sources: the files a record is named by, so a
// stop says where it is ({ key, predictions }). Stops go to p. Returns results.mix, or null after
// a stop (the caller's p.throwIfStopped() then reports them all).
function scoreMix(mix, summaries, records, config, sources, p) {
  const { field, from } = config.groups[mix.group];
  const shareOf = new Map(mix.shares.map(x => [x.label, x.given]));
  const where = id => sources[from] + ' ' + id;
  const byLabel = new Map();
  let stopped = false;
  for (const r of records) {
    const labels = r.groups[mix.group];
    if (labels.length > 1) {
      p.stop('G21', where(r.id), 'has ' + labels.length + ' labels for group "' + mix.group + '" (' + labels.join(', ') + '); on a mix each record must sit in exactly one group, ' +
        'or its weight would count twice. Give it one label');
      stopped = true;
      continue;
    }
    const label = labels.length ? labels[0] : NONE;
    // A record with no label is in "(none)": named here, since a share for "(none)" is easy to forget.
    if (label === NONE && !shareOf.has(NONE)) {
      p.stop('G19', where(r.id), 'has no label for group "' + mix.group + '", so it sits in no group of the mix in ' + mix.file + ': give it a label, or give "' + NONE + '" a share');
      stopped = true;
      continue;
    }
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(r.id);
  }
  for (const [label, ids] of byLabel) {
    if (shareOf.has(label)) continue;
    p.stop('G19', mix.file, '"' + label + '" is a group of this run (' + ids.length + ' record' + (ids.length === 1 ? '' : 's') + ') with no share: the report cannot guess ' +
      'the weight of a kind of record. Give it its share of real traffic (0 if real traffic has none)');
    stopped = true;
  }
  // The labels the run has, whatever stopped above, so a share is only called untested when it is.
  const runLabels = [...new Set(records.flatMap(r => (r.groups[mix.group].length ? r.groups[mix.group] : [NONE])))];
  for (const { label } of mix.shares) {
    if (runLabels.includes(label)) continue;
    const near = runLabels.find(l => l.toLowerCase() === label.trim().toLowerCase());
    p.stop('G20', mix.file, 'gives "' + label + '" a share, but no record in this run has that label for group "' + mix.group + '" (labels here: ' + runLabels.join(', ') +
      '): its records were never tested, so nothing can be said about them' + (near ? ' (did you mean "' + near + '"? Labels must match exactly)' : '') +
      '. Test records like them, or take "' + label + '" out of the mix');
    stopped = true;
  }
  if (stopped) return null;

  const byId = new Map(summaries.map(s => [s.id, s]));
  const strata = mix.shares.map(({ label, given }) => {
    const mine = byLabel.get(label).map(id => byId.get(id));
    const out = mine.filter(s => s.route_class === 'auto');
    return { label, given, records: mine.length, out: out.length, silent_errors: out.filter(s => s.silent).length };
  });
  const m = mixedRate(strata.map(x => ({ share: x.given, N: x.records, a: x.out, s: x.silent_errors })));
  const st = m.straight_through;
  return {
    file: mix.file, group: mix.group, field, from,
    strata: strata.map((x, i) => ({ label: x.label, given: x.given, share_pct: pct1(m.shares[i]), records: x.records, out: x.out, silent_errors: x.silent_errors })),
    // The records' worth as worked out, not rounded: the reports round it once, where they show it.
    // Rounded here too, 5.46 would become 5.5, then "about 6" (trap G6).
    silent_error_rate: { pct: pct1(m.rate), low_pct: pct1(m.low), high_pct: pct1(m.high), effective_records: m.effective },
    straight_through: { pct: pct1(st.rate), low_pct: pct1(st.low), high_pct: pct1(st.high), effective_records: st.effective },
    why: m.rate === null ? 'nothing_out' : null,
    // A group the mix gives weight to that sent nothing out: it lowers the straight-through on the
    // mix and adds nothing to the rate, which then rests on the other groups alone.
    none_out: strata.filter((x, i) => m.shares[i] > 0 && x.out === 0).map(x => x.label),
  };
}

module.exports = { scoreMix };
