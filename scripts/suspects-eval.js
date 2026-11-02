#!/usr/bin/env node
// Which ranking for `wfeval suspects`? A seeded comparison of the candidate rankings, and the
// tables docs/METRICS.md quotes ("Answer-key suspects").
//
//   node scripts/suspects-eval.js [--reps 20] [--label-reps 100] [--seed 20261101] [--part rulings|inject|labels]
//
// Every run with the same seed prints the same numbers. Three tests, each scoring how high a
// ranking puts real key errors, by average precision (AP: 1 when every key error is at the top)
// and precision at the top 5 and 10 (the share of key errors among the first suspects a person
// reads). Ties are scored as their average over every order within the tie (McSherry and Najork
// 2008), so no ranking gains from the order the records happen to be in.
//
//   rulings  real ground truth: the compliance reviewer's 25 rulings (examples/compliance-reviewer/
//            rulings.json: 9 adds, real key gaps; 16 rejects, the model's mistakes), on its runs
//            against the v1 key the run files carry. Only the 25 ruled suspects are ranked.
//   inject   errors put into the real answer keys of the two 500-record golden sets, at 1% and 3%
//            of their values, with every real model mistake as a distractor: a value dropped from
//            the key; a wrong value added, either one the model confuses with a value the record
//            has (it states it wrongly on records whose key lists that value) or any value; a value
//            swapped for one the model confuses with it; and three mixes of the four (dropped /
//            added, confusable / added, any / swapped): a quarter each, drop-heavy 60/10/10/20 (the
//            one real key review found missing values only) and add-heavy 10/50/30/10. The
//            metadata tagger's runs 70, 71 and 72 (one prompt version), one at a time and together;
//            the compliance reviewer's run 67, its only run.
//   labels   a simulated label workflow (no real example has labels): 500 records, six labels in
//            three pairs the model confuses, runs that repeat a record's mistakes, confidences in
//            steps of 0.05; key labels changed at 1, 3 and 5%, to the confusable label or any.
//
// The rankings (higher = read first). x is the average confidence over the runs in the
// workflow's side (0 for a run that does not state the value, or gives another label):
//   runs        how many runs disagree with the key (today's order of possible key gaps, trap I7)
//   confidence  the model's confidence: its mean where it states the value or label; for a value
//               the key lists, 1 - x
//   CL self     confident learning (Northcutt, Jiang and Chuang 2021, JAIR 70:1373), one class
//               per value: a disagreement counts when x is at least the value's per-class threshold
//               (the average x where the key agrees); counted ones first, each group by
//               self-confidence (the model's probability for the key's side, lowest first)
//   CL margin   the same, ranked by the normalized margin (the key's side minus the other)
//   average     x alone (self-consistency with confidence: agreement over runs and confidence in one)
//   per cell    the key's agreement, leave-one-out: q = how often the key sides with the workflow
//               where it answers like this on other records, per value and bin, shrunk 5 records'
//               worth toward the output's bin; key_lacks and labels by q, key_lists by 1 - q
//   per entry   the same evidence as odds, each key entry equally likely wrong: key_lacks q/(1-q);
//               key_lists f0/f1 (the workflow's answer, on records whose key lacks the value
//               against those whose key lists it); labels q/(1-q)
//   ratio alone per entry with key_lacks by the likelihood ratio f1/f0 alone, as key_lists is: without
//               the value's base-rate odds that q/(1-q) carries
//   shipped     src/metrics/suspects.js: per entry, with key_lacks shrunk toward the output's
//               calibration curve at x, and labels by that curve alone
// Every ranking that reads the key's other records leaves the suspect's own entry out, and, with
// duplicate_of_field or clusters in the config, the rest of its duplicate group or cluster (N4).
const path = require('path');
const { loadConfig } = require('../src/config.js');
const { scoreRun } = require('../src/score.js');
const S = require('../src/metrics/suspects.js');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const REPS = Number(opt('reps', 20));
const LABEL_REPS = Number(opt('label-reps', 100));
const SEED = Number(opt('seed', 20261101));
const PART = opt('part', 'all');

// ---------- seeded random numbers ----------
// mulberry32: a small, fast 32-bit generator; plenty for a simulation, and reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, a) => a[Math.floor(rand() * a.length)];

// ---------- scoring a ranking ----------
// Tie-aware AP and precision at k: the expected value over random orders within ties.
function evaluate(scores, truth, ks = [5, 10]) {
  const idx = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  const groups = [];
  for (const i of idx) {
    const g = groups[groups.length - 1];
    if (g && scores[g[0]] === scores[i]) g.push(i); else groups.push([i]);
  }
  const R = truth.filter(Boolean).length;
  let seen = 0, before = 0, sum = 0;
  const top = ks.map(() => 0);
  for (const g of groups) {
    const n = g.length;
    const r = g.filter(i => truth[i]).length;
    if (r) for (let j = 1; j <= n; j++) sum += (r / n) * (before + 1 + (n > 1 ? (j - 1) * (r - 1) / (n - 1) : 0)) / (seen + j);
    ks.forEach((k, i) => { if (k > seen) top[i] += Math.min(n, k - seen) * r / n; });
    seen += n; before += r;
  }
  return { ap: R ? sum / R : null, ...Object.fromEntries(ks.map((k, i) => ['p' + k, top[i] / Math.min(k, scores.length)])) };
}

// ---------- the rankings ----------
const BINS = S.EDGES.length + 2;
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const odds = p => p / Math.max(1 - p, 1e-9);

// Per-value bin counts (as the module's), and per label output the per-label counts. without:
// records left out altogether (a suspect's duplicate group or cluster).
function setCounts(s, without = null) {
  const out = id => without !== null && without.has(id);
  const records = without === null ? s.records : [...s.recordIds].filter(id => !out(id)).length;
  const per = new Map();
  const pooled = { k1: Array(BINS).fill(0), k0: Array(BINS).fill(0) };
  for (const [v, byId] of s.cells) {
    const k1 = Array(BINS).fill(0), k0 = Array(BINS).fill(0);
    let sum1 = 0, sum0 = 0, cells = 0;
    for (const cell of byId.values()) {
      if (out(cell.id)) continue;
      cells++;
      (cell.listed ? k1 : k0)[S.binOf(cell.x)]++; if (cell.listed) sum1 += cell.x; else sum0 += cell.x;
    }
    k0[0] += records - cells - (without === null ? s.alts.get(v) || 0 : [...(s.altIds.get(v) || [])].filter(id => !out(id)).length);
    const n1 = k1.reduce((a, b) => a + b, 0), n0 = k0.reduce((a, b) => a + b, 0);
    per.set(v, { k1, k0, n1, n0, t1: n1 ? sum1 / n1 : 1, t0: n0 ? 1 - sum0 / n0 : 1 });
    for (let b = 0; b < BINS; b++) { pooled.k1[b] += k1[b]; pooled.k0[b] += k0[b]; }
  }
  pooled.n1 = pooled.k1.reduce((a, b) => a + b, 0);
  pooled.n0 = pooled.k0.reduce((a, b) => a + b, 0);
  return { per, pooled };
}
// Per label output: what a run gives each label: its confidence when it gave that label, else the
// rest spread evenly over the other labels (the workflow states one confidence only).
const labelP = (e, label) => mean(e.runs.filter(Boolean).map(r => (r.label === label ? r.p : (1 - r.p) / (e.labels.length - 1))));
const labelX = (e, label) => mean(e.runs.filter(Boolean).map(r => (r.label === label ? r.p : 0)));
function labelCounts(entries, without = null) {
  const per = new Map();   // label -> { n[b], right[b] }
  const pooled = { n: Array(BINS).fill(0), right: Array(BINS).fill(0) };
  const thr = new Map();   // label -> mean p(label) where the key says it
  for (const e of entries.values()) {
    if (without !== null && without.has(e.id)) continue;
    for (const label of new Set(e.runs.filter(Boolean).map(r => r.label))) {
      const b = S.binOf(labelX(e, label));
      if (!per.has(label)) per.set(label, { n: Array(BINS).fill(0), right: Array(BINS).fill(0) });
      per.get(label).n[b]++; pooled.n[b]++;
      if (label === e.key) { per.get(label).right[b]++; pooled.right[b]++; }
    }
    const t = thr.get(e.key) || [];
    t.push(labelP(e, e.key));
    thr.set(e.key, t);
  }
  return { per, pooled, thr: new Map([...thr].map(([k, v]) => [k, mean(v)])) };
}

const METHODS = ['runs', 'confidence', 'CL self', 'CL margin', 'average', 'per cell', 'per entry', 'ratio alone', 'shipped'];
function rankings(c) {
  const sus = S.findSuspects(c);
  const shipped = new Map(S.rankSuspects(sus.map((s, i) => ({ ...s, i })), c).map(s => [sus[s.i], s.weight]));
  const memo = new Map();
  const countsFor = id => {
    const others = (c.groups.get(id) || []).filter(x => x !== id).sort();
    const k = others.join('|');
    if (!memo.has(k)) {
      const without = others.length ? new Set(others) : null;
      memo.set(k, { SC: Object.fromEntries(Object.entries(c.sets).map(([n, s]) => [n, setCounts(s, without)])),
        LC: Object.fromEntries(Object.entries(c.labels).map(([n, e]) => [n, labelCounts(e, without)])) });
    }
    return memo.get(k);
  };
  const M = 5;
  const score = (s, method) => {
    const { SC, LC } = countsFor(s.id);
    if (s.kind === 'label') {
      const e = s.entry;
      const known = e.runs.filter(Boolean);
      const x = labelX(e, s.with);
      const L = LC[s.output];
      const b = S.binOf(x);
      const P = L.per.get(s.with);
      const qb = L.pooled.right[b] / Math.max(L.pooled.n[b] - 1, 1);
      const q = (P.right[b] + M * qb) / (P.n[b] - 1 + M);
      switch (method) {
        case 'runs': return known.filter(r => r.label !== e.key).length;
        case 'confidence': return mean(known.filter(r => r.label === s.with).map(r => r.p));
        case 'CL self':
        case 'CL margin': {
          const pk = labelP(e, e.key);
          const flagged = labelP(e, s.with) >= L.thr.get(s.with) - 1e-12 || !L.thr.has(s.with);
          const other = Math.max(...e.labels.filter(l => l !== e.key).map(l => labelP(e, l)));
          return (flagged ? 10 : 0) - (method === 'CL self' ? pk : pk - other);
        }
        case 'average': return x;
        case 'per cell': return q;
        case 'per entry': return odds(q);
        default: return shipped.get(s);   // shipped, and ratio alone (labels as shipped)
      }
    }
    const cell = s.cell;
    const known = cell.runs.filter(Boolean);
    const v = SC[s.output].per.get(s.value);
    const Q = SC[s.output].pooled;
    const b = S.binOf(cell.x);
    const gap = s.kind === 'key_lacks';
    switch (method) {
      case 'runs': return gap ? known.filter(e => e.said).length : known.filter(e => !e.applied).length;
      case 'confidence': return gap ? mean(known.filter(e => e.said).map(e => e.p)) : 1 - cell.x;
      case 'CL self':
      case 'CL margin': {
        const flagged = gap ? cell.x >= v.t1 - 1e-12 : 1 - cell.x >= v.t0 - 1e-12;
        const self = gap ? 1 - cell.x : cell.x;
        return (flagged ? 10 : 0) - (method === 'CL self' ? self : self - (1 - self));
      }
      case 'average': return gap ? cell.x : 1 - cell.x;
      case 'per cell':
      case 'per entry': {
        if (gap) {
          const qb = Q.k1[b] / Math.max(Q.k1[b] + Q.k0[b] - 1, 1);
          const q = (v.k1[b] + M * qb) / (v.k1[b] + v.k0[b] - 1 + M);
          return method === 'per cell' ? q : odds(q);
        }
        if (method === 'per cell') {
          const qb = (Q.k1[b] - 1) / Math.max(Q.k1[b] + Q.k0[b] - 1, 1);
          return 1 - (v.k1[b] - 1 + M * qb) / (v.k1[b] + v.k0[b] - 1 + M);
        }
        const F1 = (Q.k1[b] - 1 + 1) / (Q.n1 - 1 + BINS);
        const F0 = (Q.k0[b] + 1) / (Q.n0 + BINS);
        return ((v.k0[b] + M * F0) / (v.n0 + M)) / Math.max((v.k1[b] - 1 + M * F1) / (v.n1 - 1 + M), 1e-9);
      }
      case 'ratio alone': {
        if (!gap) return shipped.get(s);   // key_lists is f0/f1 already
        // The likelihood ratio f1/f0 for the value, own entry (a k0) left out, shrunk as key_lists is.
        const F1 = (Q.k1[b] + 1) / (Q.n1 + BINS);
        const F0 = (Q.k0[b] - 1 + 1) / (Q.n0 - 1 + BINS);
        return ((v.k1[b] + M * F1) / (v.n1 + M)) / Math.max((v.k0[b] - 1 + M * F0) / (v.n0 - 1 + M), 1e-9);
      }
      default: return shipped.get(s);
    }
  };
  return { sus, scores: Object.fromEntries(METHODS.map(m => [m, sus.map(s => score(s, m))])) };
}

const fmt = x => (x === null || Number.isNaN(x) ? '  -  ' : x.toFixed(2));
function table(title, cols, rows) {
  console.log('\n' + title);
  console.log('| ranking | ' + cols.join(' | ') + ' |');
  console.log('|---|' + cols.map(() => '---').join('|') + '|');
  for (const [name, cells] of rows) console.log('| ' + name + ' | ' + cells.join(' | ') + ' |');
}

// ---------- (i) the compliance reviewer's rulings ----------
function rulingsPart() {
  const C = path.join(__dirname, '..', 'examples', 'compliance-reviewer');
  const config = loadConfig(path.join(C, 'config.json'));
  const run = n => path.join(C, 'runs', 'exec-' + n + '.harness.json');
  const truth = new Map(require(path.join(C, 'rulings.json')).rulings.map(r => [r.id + ' ' + r.output + ' ' + r.value, r.ruling === 'add']));
  const paired = n => scoreRun({ config, predPath: run(n), keyPath: run(56) }).paired;
  const settings = [['v2, one run (56-59, each)', [[56], [57], [58], [59]]], ['v2, runs 56-59', [[56, 57, 58, 59]]],
    ['v1, one run (50-52, each)', [[50], [51], [52]]], ['v1, runs 50-52', [[50, 51, 52]]]];
  const cols = [];
  const out = Object.fromEntries(METHODS.map(m => [m, []]));
  for (const [label, sets] of settings) {
    const acc = Object.fromEntries(METHODS.map(m => [m, { ap: 0, p5: 0, p10: 0 }]));
    let ruled = 0, adds = 0;
    for (const set of sets) {
      const c = S.collect(set.map(paired), config);
      const { sus, scores } = rankings(c);
      const keep = sus.map((s, i) => [s, i]).filter(([s]) => s.kind === 'key_lacks' && truth.has(s.id + ' ' + s.output + ' ' + s.value));
      const t = keep.map(([s]) => truth.get(s.id + ' ' + s.output + ' ' + s.value));
      ruled += keep.length / sets.length; adds += t.filter(Boolean).length / sets.length;
      for (const m of METHODS) {
        const e = evaluate(keep.map(([, i]) => scores[m][i]), t);
        for (const k of ['ap', 'p5', 'p10']) acc[m][k] += e[k] / sets.length;
      }
    }
    cols.push(label + ' (' + adds.toFixed(adds % 1 ? 1 : 0) + ' adds in ' + ruled.toFixed(ruled % 1 ? 1 : 0) + '): AP, P@5, P@10');
    for (const m of METHODS) out[m].push(fmt(acc[m].ap) + ', ' + fmt(acc[m].p5) + ', ' + fmt(acc[m].p10));
  }
  // What luck alone gives: every order of the 25 equally likely.
  const rand = rng(SEED);
  const aps = [];
  const t = Array.from({ length: 25 }, (_, i) => i < 9);
  for (let i = 0; i < 10000; i++) {
    const s = t.map(() => rand());
    aps.push(evaluate(s, t).ap);
  }
  aps.sort((a, b) => a - b);
  table('(i) THE COMPLIANCE REVIEWER\'S 25 RULINGS: 9 real key gaps (add) among 16 model mistakes (reject)', cols, METHODS.map(m => [m, out[m]]));
  console.log('A random order of 9 adds among 25: AP ' + fmt(mean(aps)) + ' on average, 95% of orders between ' + fmt(aps[249]) + ' and ' + fmt(aps[9749]) +
    ' (10,000 seeded orders); precision at 5 and 10, 0.36.');
}

// ---------- (ii) errors put into the real 500-record keys ----------
const M500 = path.join(__dirname, '..', 'examples', 'metadata-enrichment', 'golden500');
const C500 = path.join(__dirname, '..', 'examples', 'compliance-reviewer', 'golden500');
const DATA = {
  metadata: { config: loadConfig(path.join(M500, 'config.json')), file: n => path.join(M500, 'exec-' + n + '.json') },
  compliance: { config: loadConfig(path.join(__dirname, '..', 'examples', 'compliance-reviewer', 'config.json')), file: n => path.join(C500, 'exec-' + n + '.harness.json') },
};
const cache = new Map();
function pairedRun(ds, n) {
  if (!cache.has(ds + n)) { const f = DATA[ds].file(n); cache.set(ds + n, scoreRun({ config: DATA[ds].config, predPath: f, keyPath: f }).paired); }
  return cache.get(ds + n);
}
const setOutputs = config => Object.entries(config.outputs).filter(([, o]) => o.type === 'set').map(([n]) => n);

// For each key value u, the values the model states wrongly on records whose key lists u: the
// values it confuses with u, the realistic wrong value for a person to add too.
function confusions(runs, config) {
  const conf = new Map();
  for (const run of runs) for (const r of S.evidenceRecords(run, config)) {
    for (const name of setOutputs(config)) {
      const key = new Set(r.key[name].filter(s => typeof s === 'string'));
      const wrong = r.pred[name].filter(v => !key.has(v.value) && !v.inherited).map(v => v.value);
      for (const u of key) for (const w of wrong) conf.set(name + '|' + u, [...(conf.get(name + '|' + u) || []), w]);
    }
  }
  return conf;
}

// Puts n errors of one kind into the key (in place, on keys: id -> { output: slots }); returns the
// suspects each error should produce: [kind, id, output, value].
function injectKind(keys, records, config, kind, n, rand, conf, vocab) {
  const entries = [];
  for (const r of records) for (const o of setOutputs(config)) for (const s of keys.get(r.id)[o]) if (typeof s === 'string') entries.push([r.id, o, s]);
  const pos = [];
  let made = 0, guard = 0;
  while (made < n && guard++ < 100000) {
    const [id, o, u] = pick(rand, entries);
    const key = keys.get(id)[o];
    if (!key.includes(u)) continue;
    let w = null;
    if (kind !== 'drop') {
      const ok = x => x !== u && !key.includes(x);
      const options = kind === 'add-random' ? vocab[o].filter(ok) : (conf.get(o + '|' + u) || []).filter(ok);
      if (options.length === 0) continue;
      w = pick(rand, options);
    }
    if (kind === 'drop' || kind === 'swap') { keys.get(id)[o] = keys.get(id)[o].filter(s => s !== u); pos.push(['key_lacks', id, o, u]); }
    if (kind !== 'drop') { keys.get(id)[o] = [...keys.get(id)[o], w]; pos.push(['key_lists', id, o, w]); }
    made++;
  }
  return pos;
}
const MIXES = { mix: [1, 1, 1, 1], 'drop-heavy': [60, 10, 10, 20], 'add-heavy': [10, 50, 30, 10] };
function inject(runs, config, kind, rate, rand, conf) {
  const base = runs[0];
  const outs = setOutputs(config);
  const keys = new Map(base.map(r => [r.id, Object.fromEntries(outs.map(o => [o, [...r.key[o]]]))]));
  const vocab = Object.fromEntries(outs.map(o => [o, config.allowed_values[o] ||
    [...new Set(base.flatMap(r => [...r.key[o].filter(s => typeof s === 'string'), ...r.pred[o].map(v => v.value)]))].sort()]));
  const total = base.reduce((s, r) => s + outs.reduce((t, o) => t + r.key[o].length, 0), 0);
  const n = Math.max(1, Math.round(rate * total));
  // A mix: the errors split between the four kinds by its weights (dropped, added confusable,
  // added any, swapped), each kind's count rounded, at least one error in all.
  const parts = MIXES[kind] ? ['drop', 'add-confusable', 'add-random', 'swap'].map((k, i) => [k, MIXES[kind][i]]) : [[kind, 1]];
  const sum = parts.reduce((s, [, w]) => s + w, 0);
  const counts = parts.map(([, w]) => Math.round(n * w / sum));
  if (counts.every(x => x === 0)) counts[parts.findIndex(([, w]) => w === Math.max(...parts.map(p => p[1])))] = 1;
  const pos = new Set();
  parts.forEach(([k], i) => {
    if (counts[i] > 0) for (const p of injectKind(keys, base, config, k, counts[i], rand, conf, vocab)) pos.add(p.join('|'));
  });
  // An error a later one undid (a value dropped, then the same added back) is no error.
  for (const p of [...pos]) {
    const [k, id, o, v] = p.split('|');
    if ((k === 'key_lacks') === keys.get(id)[o].includes(v)) pos.delete(p);
  }
  return { runs: runs.map(run => run.map(r => ({ ...r, key: { ...r.key, ...keys.get(r.id) } }))), pos };
}

function injectPart() {
  const KINDS = ['mix', 'drop-heavy', 'add-heavy', 'drop', 'add-confusable', 'add-random', 'swap'];
  // Each kind's own seed, so a kind added later leaves the others' errors as they were.
  const KIND_SEED = { mix: 0, drop: 1, 'add-confusable': 2, 'add-random': 3, swap: 4, 'drop-heavy': 5, 'add-heavy': 6 };
  const RATES = [0.01, 0.03];
  const settings = [['metadata, one run (70, 71, 72, each)', 'metadata', [[70], [71], [72]]], ['metadata, runs 70-72', 'metadata', [[70, 71, 72]]],
    ['compliance, run 67', 'compliance', [[67]]]];
  for (const [label, ds, sets] of settings) {
    const cols = [];
    const ap = Object.fromEntries(METHODS.map(m => [m, []]));
    const p10 = Object.fromEntries(METHODS.map(m => [m, []]));
    const notes = [];
    for (const kind of KINDS) for (const rate of RATES) {
      const acc = Object.fromEntries(METHODS.map(m => [m, { ap: 0, p10: 0, n: 0 }]));
      let errors = 0, visible = 0, suspects = 0;
      sets.forEach((set, si) => {
        const runs = set.map(n => pairedRun(ds, n));
        const conf = confusions(runs, DATA[ds].config);
        for (let rep = 0; rep < REPS; rep++) {
          // The same errors for every run set of a dataset: seeded by the rep, the kind and the rate.
          const rand = rng(SEED + 7919 * rep + 101 * KIND_SEED[kind] + Math.round(rate * 1000));
          const inj = inject(runs, DATA[ds].config, kind, rate, rand, conf);
          const c = S.collect(inj.runs, DATA[ds].config);
          const { sus, scores } = rankings(c);
          const t = sus.map(s => inj.pos.has([s.kind, s.id, s.output, s.value].join('|')));
          errors += inj.pos.size; visible += t.filter(Boolean).length; suspects += sus.length;
          for (const m of METHODS) {
            const e = evaluate(scores[m], t);
            if (e.ap === null) continue;
            acc[m].ap += e.ap; acc[m].p10 += e.p10; acc[m].n++;
          }
        }
      });
      const reps = REPS * sets.length;
      cols.push(kind + ' ' + Math.round(rate * 100) + '%');
      notes.push(kind + ' ' + Math.round(rate * 100) + '%: ' + (visible / reps).toFixed(1) + ' of ' + (errors / reps).toFixed(1) + ' errors are suspects (' +
        Math.round(100 * visible / errors) + '%), among ' + Math.round(suspects / reps) + ' suspects');
      for (const m of METHODS) { ap[m].push(fmt(acc[m].ap / acc[m].n)); p10[m].push(fmt(acc[m].p10 / acc[m].n)); }
    }
    table('(ii) ' + label + ': AP (' + REPS + ' seeded injections per cell' + (sets.length > 1 ? ', on each run' : '') + ')', cols, METHODS.map(m => [m, ap[m]]));
    table('(ii) ' + label + ': precision at 10', cols, METHODS.map(m => [m, p10[m]]));
    console.log('Found as suspects (the rest the runs agree with, so no ranking can show them): ' + notes.join('; ') + '.');
  }
}

// ---------- (iii) a simulated label workflow ----------
const LABELS = ['refund', 'billing', 'shipping', 'returns', 'account', 'login'];
const PARTNER = { refund: 'billing', billing: 'refund', shipping: 'returns', returns: 'shipping', account: 'login', login: 'account' };
const PRIOR = [0.3, 0.2, 0.2, 0.1, 0.12, 0.08];
const labelConfig = { outputs: { category: { type: 'label', labels: LABELS, field: 'category' } }, routing: { field: 'route' }, allowed_values: {} };
function draw(rand, w) { let u = rand(); for (let i = 0; i < w.length; i++) { u -= w[i]; if (u <= 0) return i; } return w.length - 1; }
const step = x => Math.min(0.99, Math.max(0.3, Math.round(x * 20) / 20));
// A quarter of the records are hard (wrong 45% of the time, else 6%). A wrong answer is the record's
// habitual one 80% of the time (mostly its confusable partner), so runs repeat their mistakes.
// Right answers lean confident, wrong ones less so, with overlap.
function labelWorld(rand, N, runs, rate, kind) {
  const truth = [], hard = [];
  for (let i = 0; i < N; i++) { truth.push(LABELS[draw(rand, PRIOR)]); hard.push(rand() < 0.25 ? 0.45 : 0.06); }
  const other = t => LABELS.filter(l => l !== t)[Math.floor(rand() * 5)];
  const habit = truth.map(t => (rand() < 0.75 ? PARTNER[t] : other(t)));
  const said = Array.from({ length: runs }, () => truth.map((t, i) => {
    const wrong = rand() < hard[i];
    const label = wrong ? (rand() < 0.8 ? habit[i] : other(t)) : t;
    const c = wrong ? 0.55 + 0.35 * rand() : 0.7 + 0.3 * rand() - (hard[i] > 0.2 ? 0.15 * rand() : 0);
    return { label, confidence: step(c) };
  }));
  const key = truth.slice();
  const pos = new Set();
  while (pos.size < Math.max(1, Math.round(rate * N))) {
    const i = Math.floor(rand() * N);
    if (pos.has(i)) continue;
    key[i] = kind === 'confusable' ? PARTNER[truth[i]] : other(truth[i]);
    pos.add('T' + i);
  }
  return {
    pos,
    runs: said.map(run => run.map((p, i) => ({ id: 'T' + i, scored: true, route_class: 'auto',
      pred: { category: { value: p.label, confidence: p.confidence, applied: true, declined: false } }, key: { category: key[i] } }))),
  };
}
function labelsPart() {
  for (const runs of [1, 3]) {
    const cols = [];
    const ap = Object.fromEntries(METHODS.map(m => [m, []]));
    for (const kind of ['confusable', 'random']) for (const rate of [0.01, 0.03, 0.05]) {
      const acc = Object.fromEntries(METHODS.map(m => [m, 0]));
      for (let rep = 0; rep < LABEL_REPS; rep++) {
        const rand = rng(SEED + 7919 * rep + 101 * runs + (kind === 'random' ? 7 : 0) + Math.round(rate * 1000));
        const w = labelWorld(rand, 500, runs, rate, kind);
        const c = S.collect(w.runs, labelConfig);
        const { sus, scores } = rankings(c);
        const t = sus.map(s => w.pos.has(s.id));
        for (const m of METHODS) acc[m] += evaluate(scores[m], t).ap / LABEL_REPS;
      }
      cols.push(kind + ' ' + Math.round(rate * 100) + '%');
      for (const m of METHODS) ap[m].push(fmt(acc[m]));
    }
    table('(iii) simulated labels, ' + runs + ' run' + (runs > 1 ? 's' : '') + ': AP (' + LABEL_REPS + ' seeded worlds per cell)', cols, METHODS.map(m => [m, ap[m]]));
  }
}

console.log('suspects-eval  seed ' + SEED + ', ' + REPS + ' injections per cell, ' + LABEL_REPS + ' label worlds per cell');
if (PART === 'all' || PART === 'rulings') rulingsPart();
if (PART === 'all' || PART === 'inject') injectPart();
if (PART === 'all' || PART === 'labels') labelsPart();
