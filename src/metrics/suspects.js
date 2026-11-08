// Answer-key suspects (traps N1-N19): the entries of an answer key most likely wrong, ranked so a
// person with limited time rules on the likeliest first. Pure: paired records in, suspects out.
//
// Every rate the harness reports assumes the key is right, but a key is written by people. A run
// shows a key entry may be wrong whenever it disagrees with it:
//   key_lacks  a set value the workflow states that the key does not list (a possible key gap, I7)
//   key_lists  a set value the key lists that the workflow does not apply (the key may hold it wrongly)
//   label      a label or ordinal answer that differs from the key's
// Each disagreement is a mistake by the workflow or by the key; only a person can say which. The
// ranking says which to read first, from the key itself: how surprising the workflow's answer would
// be if this key entry were right, measured on the key's other records (leave-one-out, N4).
//
// The ranking, chosen by a seeded comparison (scripts/suspects-eval.js, docs/METRICS.md):
//   - x: the workflow's average confidence in its side over the runs that give evidence, a run
//     that does not state the value (or gives another label) counting 0, and a value stated with no
//     confidence (a rule's output) counting 1 (N18). With several runs it carries their agreement (N3).
//   - key_lacks: the odds q / (1 - q), q = how often the key lists the value on the other records
//     where the workflow states it at about x, shrunk toward the output's calibration curve at x
//     (SMOOTH records' worth; N5).
//   - key_lists: f0 / f1: how much more common the workflow's answer (never states it, or states it
//     at about x) is on records whose key lacks the value than on the other records whose key lists
//     it. Confidence says nothing about a value the workflow never states; how rarely it misses
//     this value does.
//   - label: the odds q / (1 - q), q = the output's calibration curve at x: how often the key agrees
//     when this workflow gives a label at about x. Per label it was worse in the comparison.
// One scale for the three, the odds that the key is wrong, if every key entry is equally likely to
// be wrong. Ties: the stronger answer from the runs first, then the key's record order (N7).

const { DECLINED, FREE_TYPES } = require('../config.js');
const { minOf, maxOf } = require('../values.js');

// Confidence bins: never stated, below 0.50, 0.50-0.59, ..., 0.80-0.89, 0.90 or more.
const EDGES = [0.5, 0.6, 0.7, 0.8, 0.9];
const BINS = EDGES.length + 2;
// The records' worth the output's own figure counts for beside a value's own records (N5).
const SMOOTH = 5;

// A record the answer key blocks or suppresses as a duplicate, where the key's route decides
// (wrong_when not any_mismatch): it must not go out, and sent to a person it is an unnecessary
// review, whatever its values (G12), so its values change no routing rate (N8).
const keyLeavesOut = config => r => config.wrong_when !== 'any_mismatch' && (r.gold_class === 'block' || r.gold_class === 'exclude');

// Which records give evidence (N8): the model answered (C10), the run did not suppress the record as
// a duplicate (its values were never meant to go anywhere), and the answer key does not leave it out
// (above). The one place records are filtered.
function evidenceRecords(paired, config) {
  const left = keyLeavesOut(config);
  return paired.filter(r => r.scored && r.route_class !== 'exclude' && !left(r));
}

// A label output that is also the route is judged as the route, by the routing types: out of scope
// here (N16), as in the value comparison (judge.js contentOutputs).
const isRouteOutput = (o, config) => o.type !== 'set' && o.field === config.routing.field;

// A confidence on an edge is in the bin above it, and an average a hair under an edge in binary
// arithmetic (three runs at 0.7 average 0.6999999999999998) counts as on it, as in calibration (G10).
function binOf(x) {
  if (x === 0) return 0;
  let b = 1;
  for (const e of EDGES) if (x >= e - 1e-9) b++;
  return b;
}
const binWords = b => (b === 0 ? 'never' : b === 1 ? 'below ' + EDGES[0].toFixed(2)
  : b === BINS - 1 ? EDGES[EDGES.length - 1].toFixed(2) + ' or more' : EDGES[b - 2].toFixed(2) + '-' + (EDGES[b - 1] - 0.01).toFixed(2));
// Where a bin's records sit on the curve: its middle (never stated: 0).
const binMiddle = b => (b === 0 ? 0 : b === 1 ? EDGES[0] / 2 : b === BINS - 1 ? (EDGES[EDGES.length - 1] + 1) / 2 : (EDGES[b - 2] + EDGES[b - 1]) / 2);

// A key list as what it holds plainly (a value, or an any_of of one) and as alternatives.
function plainAndAlts(slots) {
  const plain = new Set();
  const alt = new Set();
  for (const s of slots) {
    if (typeof s === 'string') plain.add(s);
    else if (s.any_of.length === 1) plain.add(s.any_of[0]);
    else for (const v of s.any_of) alt.add(v);
  }
  return { plain, alt };
}
const total = a => a.reduce((s, x) => s + x, 0);
const mean = a => total(a) / a.length;

// ---------- the evidence ----------

// runs: one list of paired records per run, all against the same key (the key as ruled). Returns,
// per set output, a cell for each (record, value) that the key lists or a run states, and per label
// output, each record's key label and what each run said.
function collect(runs, config) {
  const evidence = runs.map(run => new Map(evidenceRecords(run, config).map(r => [r.id, r])));
  const ids = runs[0].map(r => r.id);
  const order = new Map(ids.map((id, i) => [id, i]));
  // The records with evidence from any run: what each run gives (null for none), and the first that does.
  const rows = [];
  for (const id of ids) {
    const per = evidence.map(m => m.get(id) || null);
    const first = per.find(Boolean);
    if (first) rows.push({ id, per, first });
  }
  const sets = {};
  const labels = {};
  for (const [name, o] of Object.entries(config.outputs)) {
    if (isRouteOutput(o, config)) continue;
    if (o.type === 'set') sets[name] = setCells(name, rows, config);
    // A free answer (F15) has no list of labels to suggest another from: not a suspect, never a guess.
    else if (!FREE_TYPES.includes(o.type)) labels[name] = labelEntries(name, o, rows);
  }
  return { runs: runs.length, order, sets, labels, groups: groupsOf(runs[0], config) };
}

// N4: records whose answer key was copied are one piece of evidence, not several. With
// duplicate_of_field, a record and the records that duplicate it (and theirs) are one group; with
// clusters, a cluster is one. Each record with others in its group maps to the whole group's ids.
function groupsOf(paired, config) {
  if (!config.duplicate_of_field && !config.clusters) return new Map();
  const parent = new Map(paired.map(r => [r.id, r.id]));
  const find = id => { while (parent.get(id) !== id) id = parent.get(id); return id; };
  const join = (a, b) => { if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b)); };
  const byCluster = new Map();
  for (const r of paired) {
    if (r.duplicate_of) join(r.id, r.duplicate_of);
    if (r.cluster !== null && r.cluster !== undefined) {
      if (byCluster.has(r.cluster)) join(r.id, byCluster.get(r.cluster)); else byCluster.set(r.cluster, r.id);
    }
  }
  const members = new Map();
  for (const r of paired) {
    const root = find(r.id);
    if (members.has(root)) members.get(root).push(r.id); else members.set(root, [r.id]);
  }
  const out = new Map();
  for (const ids of members.values()) if (ids.length > 1) for (const id of ids) out.set(id, ids);
  return out;
}

// What one run says about one value: nothing (no evidence from that run), or whether it states it,
// applies it, only inherits it (D17), and the confidence p it counts for.
function said(r, name, v) {
  if (!r) return null;
  const copies = r.pred[name].filter(x => x.value === v);
  if (copies.length === 0) return { said: false, applied: false, inherited: false, confidence: null, p: 0 };
  const known = copies.map(x => x.confidence).filter(c => c !== null);
  const confidence = known.length ? maxOf(known) : null;
  return { said: true, applied: copies.some(x => x.applied), inherited: copies.every(x => x.inherited), confidence, p: confidence === null ? 1 : confidence };
}

function setCells(name, rows, config) {
  const allowed = config.allowed_values[name];
  const cells = new Map();   // value -> Map id -> cell
  const alts = new Map();    // value -> records where it is an any_of alternative (no cell: I10)
  const altIds = new Map();  // value -> those records' ids
  const recordIds = new Set();
  const held = new Map();    // id -> that record's cells and alternatives (moveRecord)
  let records = 0;
  for (const { id, per, first } of rows) {
    records++;
    recordIds.add(id);
    const { plain, alt } = plainAndAlts(first.key[name]);
    for (const v of alt) {
      alts.set(v, (alts.get(v) || 0) + 1);
      if (!altIds.has(v)) altIds.set(v, new Set());
      altIds.get(v).add(id);
    }
    const own = { cells: [], alts: [...alt] };
    held.set(id, own);
    const values = new Set(plain);
    for (const r of per) if (r) for (const x of r.pred[name]) values.add(x.value);
    for (const v of values) {
      if (alt.has(v)) continue;
      // A value outside allowed_values is invented, not missing from the key (I7); one the key lists stays.
      if (!plain.has(v) && Array.isArray(allowed) && !allowed.includes(v)) continue;
      const runs = per.map(r => said(r, name, v));
      const known = runs.filter(Boolean);
      if (!cells.has(v)) cells.set(v, new Map());
      const cell = { id, output: name, value: v, listed: plain.has(v), runs, x: mean(known.map(e => e.p)) };
      cells.get(v).set(id, cell);
      own.cells.push(cell);
    }
  }
  return { cells, alts, altIds, records, recordIds, held };
}

function labelEntries(name, o, rows) {
  const entries = new Map();
  for (const { id, per, first } of rows) {
    const key = first.key[name];
    // A decline is not a label: neither side's decline is a suspect (N17).
    if (key === null || key === undefined || key === DECLINED) continue;
    const runs = per.map(r => (!r || !r.pred[name] || r.pred[name].declined ? null
      : { label: String(r.pred[name].value), confidence: r.pred[name].confidence, p: r.pred[name].confidence === null ? 1 : r.pred[name].confidence }));
    if (!runs.some(Boolean)) continue;
    entries.set(id, { id, output: name, key: String(key), runs, labels: o.labels.map(String) });
  }
  return entries;
}

// The average confidence the runs give a label: 0 for a run that gave another one.
const labelX = (e, label) => { const k = e.runs.filter(Boolean); return mean(k.map(r => (r.label === label ? r.p : 0))); };

// ---------- the suspects ----------

function findSuspects(c) {
  const out = [];
  for (const s of Object.values(c.sets)) {
    for (const byId of s.cells.values()) {
      for (const cell of byId.values()) {
        const known = cell.runs.filter(Boolean);
        if (!cell.listed) {
          // Only a value the workflow states itself: an inherited one follows from another (D17, I7).
          if (!known.some(e => e.said && !e.inherited)) continue;
          out.push({ kind: 'key_lacks', id: cell.id, output: cell.output, value: cell.value, cell });
        } else if (known.some(e => !e.applied)) {
          out.push({ kind: 'key_lists', id: cell.id, output: cell.output, value: cell.value, cell });
        }
      }
    }
  }
  for (const entries of Object.values(c.labels)) {
    for (const e of entries.values()) {
      const other = e.runs.filter(r => r && r.label !== e.key);
      if (other.length === 0) continue;
      // The label the runs put in the key's place: the most common, then the more confident, then
      // the config's order.
      const tally = new Map();
      for (const r of other) tally.set(r.label, [...(tally.get(r.label) || []), r.p]);
      const [proposed] = [...tally.entries()].sort((a, b) => b[1].length - a[1].length || mean(b[1]) - mean(a[1]) ||
        e.labels.indexOf(a[0]) - e.labels.indexOf(b[0]))[0];
      out.push({ kind: 'label', id: e.id, output: e.output, value: e.key, with: proposed, entry: e });
    }
  }
  return out;
}

// ---------- the statistics the ranking reads ----------

// Pool adjacent violators (N6): the closest non-decreasing rates, weighted by their records. A calibration
// curve that dipped would rank a stronger answer below a weaker one. Returns the pooled blocks, each
// with the indices it covers.
function pooled(rates, weights) {
  const blocks = [];
  rates.forEach((r, i) => {
    blocks.push({ r, w: weights[i], members: [i] });
    while (blocks.length > 1 && blocks[blocks.length - 2].r > blocks[blocks.length - 1].r) {
      const y = blocks.pop();
      const x = blocks.pop();
      blocks.push({ r: (x.r * x.w + y.r * y.w) / (x.w + y.w), w: x.w + y.w, members: [...x.members, ...y.members] });
    }
  });
  return blocks;
}
const monotone = (rates, weights) => pooled(rates, weights).flatMap(b => b.members.map(() => b.r));

// Bins first to last, in words: "never stated", "below 0.50", "at 0.50-0.59", "at 0.80 or more".
function levelsWords(first, last) {
  if (first === 0) return last === 0 ? 'never stated' : 'never stated or ' + (last === BINS - 1 ? 'at any level' : 'below ' + EDGES[last - 1].toFixed(2));
  const lo = first === 1 ? null : EDGES[first - 2];
  const hi = last === BINS - 1 ? null : EDGES[last - 1];
  if (lo === null) return hi === null ? 'at any level' : 'below ' + hi.toFixed(2);
  return hi === null ? 'at ' + lo.toFixed(2) + ' or more' : 'at ' + lo.toFixed(2) + '-' + (hi - 0.01).toFixed(2);
}

// An output's calibration curve: how often the key agrees with the workflow's side, per bin that
// has records (agree, of n), made non-decreasing, read between bin middles in a straight line and
// flat beyond the first and last. Half a record each way keeps a bin with no disagreement from
// claiming certainty. With no records at all, an even 0.5. from: the first bin; a set output's
// curve starts at the never bin (how often the key lists a value the workflow never states), so a
// confidence below every other record's is read toward it, not as the lowest bin above it.
// Returns, for a confidence x, the estimate and the levels it was read from, with their counts
// (the bins a pooled block covers, added up): an estimate between levels is not an observed rate.
function curveOf(agree, n, from = 1) {
  const bins = [];
  for (let b = from; b < BINS; b++) if (n[b] > 0) bins.push(b);
  if (bins.length === 0) return () => ({ value: 0.5, from: [] });
  const points = [];
  for (const block of pooled(bins.map(b => (agree[b] + 0.5) / (n[b] + 1)), bins.map(b => n[b]))) {
    const covers = block.members.map(i => bins[i]);
    const source = { where: levelsWords(covers[0], covers[covers.length - 1]), agree: covers.reduce((s, b) => s + agree[b], 0), of: covers.reduce((s, b) => s + n[b], 0) };
    for (const b of covers) points.push({ x: binMiddle(b), r: block.r, source });
  }
  return x => {
    if (x <= points[0].x) return { value: points[0].r, from: [points[0].source] };
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1];
      const q = points[i];
      if (x > q.x) continue;
      return { value: p.r + (q.r - p.r) * (x - p.x) / (q.x - p.x), from: x === q.x || p.source === q.source ? [q.source] : [p.source, q.source] };
    }
    const last = points[points.length - 1];
    return { value: last.r, from: [last.source] };
  };
}

// Per set output and value: cells per bin with the key listing it (k1) and not (k0), the records
// that hold none (a value neither listed nor stated on a record counts as k0 in the never bin), and
// the output's pooled figures, over every record. gone: records taken out since (moveRecord).
function setStats(s) {
  const per = new Map();
  const pooledCounts = { k1: Array(BINS).fill(0), k0: Array(BINS).fill(0) };
  for (const [v, byId] of s.cells) {
    const k1 = Array(BINS).fill(0);
    const k0 = Array(BINS).fill(0);
    for (const cell of byId.values()) (cell.listed ? k1 : k0)[binOf(cell.x)]++;
    k0[0] += s.records - byId.size - (s.alts.get(v) || 0);
    per.set(v, { k1, k0 });
    for (let b = 0; b < BINS; b++) { pooledCounts.k1[b] += k1[b]; pooledCounts.k0[b] += k0[b]; }
  }
  return { per, pooled: pooledCounts, gone: 0 };
}

// Takes one record out of an output's counts (sign -1), as if it were never in the set, or puts it
// back (+1). Every value then has one record fewer that holds none of it: that is kept as one
// number (gone) rather than written to every value, so a record costs its own cells, not a pass
// over the values, and a value this record does hold (it never counted as holding none) gets its
// one back here. Whole counts, so taking out and putting back leaves them exactly as they were.
function moveRecord(st, own, sign) {
  st.gone -= sign;
  const holds = v => { st.per.get(v).k0[0] -= sign; st.pooled.k0[0] -= sign; };
  for (const cell of own.cells) {
    const side = cell.listed ? 'k1' : 'k0';
    const b = binOf(cell.x);
    st.per.get(cell.value)[side][b] += sign;
    st.pooled[side][b] += sign;
    holds(cell.value);
  }
  for (const v of own.alts) if (st.per.has(v)) holds(v);
}

// One value's counts and the output's pooled ones as they stand, with their totals.
function countsNow(st, value) {
  const v = st.per.get(value);
  const k0 = v.k0.slice();
  k0[0] -= st.gone;
  const pooledK0 = st.pooled.k0.slice();
  pooledK0[0] -= st.gone * st.per.size;
  return {
    v: { k1: v.k1, k0, n1: total(v.k1), n0: total(k0) },
    pooled: { k1: st.pooled.k1, k0: pooledK0, n1: total(st.pooled.k1), n0: total(pooledK0) },
  };
}

// Per label output: for each record and each label a run gave, the average confidence in it and
// whether the key says it; per bin, pooled over the labels. sign -1 takes one record's pairs away.
function labelPairs(e, n, agree, sign = 1) {
  for (const label of new Set(e.runs.filter(Boolean).map(r => r.label))) {
    const b = binOf(labelX(e, label));
    n[b] += sign;
    if (label === e.key) agree[b] += sign;
  }
}
function labelStats(entries) {
  const n = Array(BINS).fill(0);
  const agree = Array(BINS).fill(0);
  for (const e of entries.values()) labelPairs(e, n, agree);
  return { n, agree };
}

// ---------- the ranking ----------

const odds = p => p / Math.max(1 - p, 1e-9);

// One suspect with x, its weight (the ranking score) and the counts behind it, for the why line.
// A suspect's own entry is taken out of its counts here (N4).
function rankOne(s, S, L) {
  if (s.kind === 'label') {
    const x = labelX(s.entry, s.with);
    const b = binOf(x);
    // The suspect's record has a pair for every label its runs gave, the key's own label among
    // them when a run gave it: kept, the key's entry would vouch for itself.
    const n = L[s.output].n.slice();
    const agree = L[s.output].agree.slice();
    labelPairs(s.entry, n, agree, -1);
    const C = curveOf(agree, n)(x);
    return { ...s, x, bin: b, weight: odds(C.value), evidence: { kind: 'label', bin: binWords(b), agree: agree[b], of: n[b], curve: C.value, curve_from: C.from } };
  }
  const x = s.cell.x;
  const b = binOf(x);
  const { v, pooled: p } = countsNow(S[s.output], s.value);
  if (s.kind === 'key_lacks') {
    // This record is one of the k0 in its bin, for the value and for the output's curve alike.
    const n = v.k1[b] + v.k0[b] - 1;
    const k0 = p.k0.slice();
    k0[b]--;
    const C = curveOf(p.k1, p.k1.map((k, i) => k + k0[i]), 0)(x);
    const q = (v.k1[b] + SMOOTH * C.value) / (n + SMOOTH);
    return { ...s, x, bin: b, weight: odds(q), evidence: { kind: 'key_lacks', bin: binWords(b), listed: v.k1[b], of: n, curve: C.value, curve_from: C.from, q } };
  }
  // key_lists: this record is one of the k1 in its bin. The output's shares get one record in
  // each bin, so a bin nobody else is in is rare, not impossible (a share of 0 would make any
  // answer in it infinitely suspect).
  const F1 = (p.k1[b] - 1 + 1) / (p.n1 - 1 + BINS);
  const F0 = (p.k0[b] + 1) / (p.n0 + BINS);
  const f1 = (v.k1[b] - 1 + SMOOTH * F1) / (v.n1 - 1 + SMOOTH);
  const f0 = (v.k0[b] + SMOOTH * F0) / (v.n0 + SMOOTH);
  return { ...s, x, bin: b, weight: f0 / Math.max(f1, 1e-9),
    evidence: { kind: 'key_lists', bin: binWords(b), when_listed: v.k1[b] - 1, listed: v.n1 - 1, when_lacking: v.k0[b], lacking: v.n0 } };
}

// Leave-one-out (N4): the rest of a suspect's duplicate group or cluster, if the config names
// either, is left out of the statistics altogether, as a copy of its key entry would vouch for it.
// One set of counts serves every suspect, one group at a time: the group's records come out
// together, each suspect's own goes back for its turn, and the group goes back after. So a group
// costs its own records whatever the size of the set (counting afresh per group was quadratic).
function rankSuspects(suspects, c) {
  const S = Object.fromEntries(Object.entries(c.sets).map(([name, s]) => [name, setStats(s)]));
  const L = Object.fromEntries(Object.entries(c.labels).map(([name, e]) => [name, labelStats(e)]));
  const move = (id, sign) => {
    for (const [name, s] of Object.entries(c.sets)) if (s.held.has(id)) moveRecord(S[name], s.held.get(id), sign);
    for (const [name, entries] of Object.entries(c.labels)) if (entries.has(id)) labelPairs(entries.get(id), L[name].n, L[name].agree, sign);
  };
  const inGroup = new Map();   // group (its list of ids, or undefined) -> the places of its suspects
  suspects.forEach((s, i) => {
    const group = c.groups.get(s.id);
    if (inGroup.has(group)) inGroup.get(group).push(i); else inGroup.set(group, [i]);
  });
  const ranked = new Array(suspects.length);
  for (const [group, places] of inGroup) {
    if (group) for (const id of group) move(id, -1);
    for (const i of places) {
      if (group) move(suspects[i].id, 1);
      ranked[i] = rankOne(suspects[i], S, L);
      if (group) move(suspects[i].id, -1);
    }
    if (group) for (const id of group) move(id, 1);
  }
  // Ties (N7): the runs' stronger answer first (a higher average confidence in the workflow's side;
  // for a key_lists suspect, the workflow's side is that the value does not apply), then the key's
  // record order, then the output's and the value's.
  const strength = s => (s.kind === 'key_lists' ? 1 - s.x : s.x);
  const outputs = Object.keys({ ...c.sets, ...c.labels });
  return ranked.sort((a, b) => b.weight - a.weight || strength(b) - strength(a) || c.order.get(a.id) - c.order.get(b.id) ||
    outputs.indexOf(a.output) - outputs.indexOf(b.output) || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

// What the runs said, for the report and the JSON: how many runs gave evidence, stated the value
// (or gave the proposed label), applied it, and the range of their confidences.
function runsSaid(s) {
  if (s.kind === 'label') {
    const known = s.entry.runs.filter(Boolean);
    const gave = known.filter(r => r.label === s.with);
    const confs = gave.map(r => r.confidence).filter(x => x !== null);
    return { runs: known.length, said: gave.length, label: s.with, confidence: confs.length ? { min: minOf(confs), max: maxOf(confs) } : null };
  }
  const known = s.cell.runs.filter(Boolean);
  const stated = known.filter(e => e.said);
  const confs = stated.map(e => e.confidence).filter(x => x !== null);
  return { runs: known.length, said: stated.length, applied: known.filter(e => e.applied).length,
    confidence: confs.length ? { min: minOf(confs), max: maxOf(confs) } : null };
}

// The verbs a person can rule a suspect with (N11).
const VERBS = { key_lacks: ['add', 'reject'], key_lists: ['remove', 'keep'], label: ['replace', 'keep'] };

// From paired runs to the ranked suspects, each in the shape the reports and JSON use.
function suspectsOf(runs, config) {
  const c = collect(runs, config);
  return rankSuspects(findSuspects(c), c).map(s => ({
    kind: s.kind, id: s.id, output: s.output, value: s.value, ...(s.kind === 'label' ? { with: s.with } : {}),
    said: runsSaid(s), average_confidence: Number(s.x.toFixed(4)), weight: Number(s.weight.toPrecision(6)), evidence: round(s.evidence), verbs: VERBS[s.kind],
  }));
}
const round = e => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, typeof v === 'number' && !Number.isInteger(v) ? Number(v.toFixed(4)) : v]));

module.exports = { suspectsOf, collect, findSuspects, rankSuspects, evidenceRecords, keyLeavesOut, binOf, binWords, monotone, EDGES, SMOOTH, VERBS };
