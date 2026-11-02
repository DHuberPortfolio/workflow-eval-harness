#!/usr/bin/env node
// The tuning half and the held-out half (config.split): which hash, which balance warning, how
// much leakage between the halves costs, and how a claim on the held-out half should count its
// looks. Seeded simulations that print the tables docs/METRICS.md quotes.
//
//   node scripts/split-sim.js [balance | leak | looks | all] [--reps 4000] [--seed 20261101]
//
// Every run with the same seed prints the same numbers. The hashes, units, halves and balance
// test are the shipped code (src/split.js); the looks part uses the shipped exact binomial
// (stats.js chanceAtMost) and the shipped look rules (split-log.js lookLevel).
//
// balance  The two hashes on the owner's two 500-record golden sets and on made-up patterned ids
//          (sequential numbers, shared prefixes, duplicates numbered after their primaries): how
//          evenly each kind of record splits, against what chance alone gives; how often each
//          candidate warning rule fires on a fair split; and what a salt does to CRC-32.
// leak     The metadata golden set's duplicates: how many retellings straddle the halves when
//          records are split by their own id (the hand split), and how much that could flatter
//          the held-out half.
// looks    An analyst tries version after version and checks the held-out half each time until
//          it says "shown under the target". How often that claim is false, and how often a
//          version that really is under gets shown, for each way of counting the looks: with
//          analysts who never use the held-out numbers, and with adaptive ones who do (keeping
//          changes that lowered the held-out count; Blum and Hardt's boosting attack; group
//          testing that finds the held-out errors and holds them). The adaptive attacks again
//          with less shown each look (a Ladder-style release, or only a yes or no); cells where a
//          rule could never show anything are marked. And Thresholdout's accuracy band by size.

const fs = require('fs');
const path = require('path');
const { splitOf, balanceOf, crc32, heldOutName } = require('../src/split.js');
const { chanceAtMost } = require('../src/metrics/stats.js');
const { lookLevel } = require('../src/split-log.js');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? Number(args[i + 1]) : dflt; };
const part = args.find(a => !a.startsWith('--') && isNaN(Number(a))) || 'all';
const REPS = opt('reps', 4000);
const SEED = opt('seed', 20261101);

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
// A seed per setting, from its name, so adding a setting never changes another's numbers.
const seedOf = name => (SEED ^ crc32(name)) >>> 0;
const normal = u => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
// The normal curve's quantile (Acklam's rational approximation; relative error under 1.2e-9).
function qnorm(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - lo) return -qnorm(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
const fmtPct = x => (x * 100).toFixed(1) + '%';
const md = rows => rows.map(r => '| ' + r.join(' | ') + ' |').join('\n');
const header = cols => md([cols, cols.map(() => '---')]);

// ======================================================================================
// balance
// ======================================================================================

// The owner's two golden sets, as the records split.js reads: id, trap labels, groups, duplicate.
const EX = path.join(__dirname, '..', 'examples');
function complianceSet() {
  const raw = JSON.parse(fs.readFileSync(path.join(EX, 'compliance-reviewer', 'golden500', 'exec-67.harness.json'), 'utf8'));
  return raw.map(r => ({ id: r.id, traps: [r.expected.trap], groups: { verdict: [r.expected.verdict], batch: [r.id.replace(/\d+$/, '')] }, duplicate_of: null }));
}
// The metadata set's trap sentences, read into kinds by their opening words (the set has no
// trap_field: each record's trap is a sentence). Order matters: the first match wins.
const KINDS = [
  [/duplicate|republication/, 'duplicate'], [/^(baseline )?clean|^canonical|genuine/, 'clean'], [/^alias/, 'alias resolution'],
  [/^entity trap/, 'entity trap'], [/^passing-mention/, 'passing mention'], [/^signal-starved/, 'signal-starved stub'],
  [/^deprecated-code/, 'deprecated code'], [/taxonomy gap|^no industry code/, 'taxonomy gap'], [/^ambiguous place/, 'ambiguous place'],
  [/^multi-subject|^two primary/, 'multi-subject'], [/^unnamed/, 'unnamed company'], [/jurisdiction/, 'subordinate-clause jurisdiction'],
];
const kindOf = sentence => { const s = sentence.toLowerCase(); const k = KINDS.find(([re]) => re.test(s)); return k ? k[1] : 'other'; };
function metadataSet() {
  const raw = JSON.parse(fs.readFileSync(path.join(EX, 'metadata-enrichment', 'golden500', 'exec-70.json'), 'utf8'));
  return raw.map(r => ({ id: r.id, traps: [kindOf(r.trap)], groups: { batch: [r.id.replace(/\d+$/, '')] }, duplicate_of: r.expected.duplicate_of || null }));
}
const cfgFor = (split, groups) => ({ trap_field: 'trap', groups: Object.fromEntries(groups.map(g => [g, { field: g, from: 'key' }])), split });

// The rules a warning could follow, each read off one balanceOf() result:
//   two thirds  any label of 3 or more records with more than two thirds of them in one half
//   each at 5%  any label whose own two-sided p-value is under 5%
//   Bonferroni  any label under 5% / the number of labels
//   Tarone      the shipped rule: Bonferroni over the labels that can reach the bar (Tarone 1990)
const RULES = {
  'two thirds': b => b.dimensions.some(d => d.labels.some(r => r.records >= 3 && Math.max(r.held_out, r.tuning) > (2 / 3) * r.records)),
  'each at 5%': b => b.dimensions.some(d => d.labels.some(r => r.p_value < 0.05)),
  'Bonferroni': b => { const all = b.dimensions.flatMap(d => d.labels); return all.some(r => r.p_value <= 0.05 / all.length); },
  'Tarone (shipped)': b => b.beyond_chance.length > 0,
};

// How far one split is from chance: each label's z = (held out - expected) / its sd under a fair
// split of its units. Over many labels a fair split gives z's with a spread (sd) near 1; a hash
// that splits patterned names too evenly gives less, one that moves them in blocks gives more.
function zSpread(records, cfg, halves) {
  const s = cfg.split.hash === 'crc32' ? 0.5 : cfg.split.held_out;
  const b = balanceOf(records, cfg, halves);
  const zs = [];
  for (const d of b.dimensions) {
    for (const r of d.labels) {
      const units = new Map();
      for (const rec of records) {
        const labels = d.name === 'trap' ? rec.traps : rec.groups[d.name.replace('group ', '')];
        if (labels.includes(r.label)) units.set(halves.units.get(rec.id), (units.get(halves.units.get(rec.id)) || 0) + 1);
      }
      const v = [...units.values()].reduce((a, c) => a + c * c, 0) * s * (1 - s);
      if (v > 0) zs.push((r.held_out - r.expected) / Math.sqrt(v));
    }
  }
  return Math.sqrt(zs.reduce((a, z) => a + z * z, 0) / zs.length);
}

function balancePart() {
  console.log('## balance\n');
  const SALTS = 1000;
  const sets = [
    { name: 'compliance golden 500 (4 trap types; verdict; E/G batch)', records: complianceSet(), groups: ['verdict', 'batch'] },
    { name: 'metadata golden 500 (12 trap kinds; A/B batch; 34 duplicates with their primaries)', records: metadataSet(), groups: ['batch'] },
  ];
  console.log('Real golden sets: how often each warning rule fires on a fair split (sha256, ' + SALTS + ' salts), and on the CRC-32 split.\n');
  console.log(header(['golden set', 'held out', ...Object.keys(RULES).map(r => r + ': sha256'), 'Tarone: CRC-32', 'spread of z: sha256 (CRC-32)', 'a kind of 5+ records with none held out: sha256']));
  for (const set of sets) {
    for (const share of [0.5, 0.3]) {
      const fired = Object.fromEntries(Object.keys(RULES).map(k => [k, 0]));
      let none5 = 0, spread = 0;
      for (let i = 1; i <= SALTS; i++) {
        const cfg = cfgFor({ held_out: share, salt: 'salt-' + i, hash: 'sha256', by: 'cluster' }, set.groups);
        const halves = splitOf(set.records, cfg);
        const b = balanceOf(set.records, cfg, halves);
        for (const [k, rule] of Object.entries(RULES)) if (rule(b)) fired[k]++;
        if (b.none_held_out.some(x => x.records >= 5)) none5++;
        spread += zSpread(set.records, cfg, halves) / SALTS;
      }
      let crcCell = '', crcSpread = '';
      if (share === 0.5) {
        const cfg = cfgFor({ held_out: 0.5, salt: '', hash: 'crc32', by: 'cluster' }, set.groups);
        const halves = splitOf(set.records, cfg);
        const b = balanceOf(set.records, cfg, halves);
        crcCell = RULES['Tarone (shipped)'](b) ? 'fires (' + b.beyond_chance.map(x => x.label).join(', ') + ')' : 'no';
        crcSpread = ' (' + zSpread(set.records, cfg, halves).toFixed(2) + ')';
      }
      console.log(md([[set.name, fmtPct(share), ...Object.keys(RULES).map(k => fmtPct(fired[k] / SALTS)), crcCell || '-', spread.toFixed(2) + crcSpread, fmtPct(none5 / SALTS)]]));
    }
  }

  // Patterned ids. Each: the records, and the kinds of record on them.
  const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const pad = (i, w) => String(i).padStart(w, '0');
  const patterns = [
    { name: 'R0001-R1000, a kind per block of 50', records: seq(1000, i => ({ id: 'R' + pad(i + 1, 4), traps: ['block ' + Math.floor(i / 50)] })) },
    { name: 'R0001-R1000, kind = number mod 10', records: seq(1000, i => ({ id: 'R' + pad(i + 1, 4), traps: ['mod10=' + ((i + 1) % 10)] })) },
    { name: 'R0001-R1000, kind = number mod 4', records: seq(1000, i => ({ id: 'R' + pad(i + 1, 4), traps: ['mod4=' + ((i + 1) % 4)] })) },
    { name: 'R0001-R1000, kind = number mod 16', records: seq(1000, i => ({ id: 'R' + pad(i + 1, 4), traps: ['mod16=' + ((i + 1) % 16)] })) },
    { name: 'R0001-R1000, kind = number mod 20', records: seq(1000, i => ({ id: 'R' + pad(i + 1, 4), traps: ['mod20=' + ((i + 1) % 20)] })) },
    { name: 'case-1 to case-1000 (no padding), kind = number mod 10', records: seq(1000, i => ({ id: 'case-' + (i + 1), traps: ['mod10=' + ((i + 1) % 10)] })) },
    { name: '5 clients x 200 (acme-001 ...), kind = client', records: seq(1000, i => ({ id: ['acme', 'beta', 'cora', 'dyne', 'elmo'][Math.floor(i / 200)] + '-' + pad(i % 200 + 1, 3), traps: ['client ' + Math.floor(i / 200)] })) },
    { name: '5 clients x 200, kind = client and number mod 5', records: seq(1000, i => ({ id: ['acme', 'beta', 'cora', 'dyne', 'elmo'][Math.floor(i / 200)] + '-' + pad(i % 200 + 1, 3), traps: ['c' + Math.floor(i / 200) + ' m' + ((i % 200 + 1) % 5)] })) },
    { name: 'TKT-2026-00001 ..., a kind per block of 25', records: seq(1000, i => ({ id: 'TKT-2026-' + pad(i + 1, 5), traps: ['block ' + Math.floor(i / 25)] })) },
  ];
  for (const pt of patterns) for (const r of pt.records) { r.groups = {}; r.duplicate_of = null; }
  console.log('\nPatterned ids, 1,000 records each, half held out. sha256 over 200 salts: how often the shipped warning fires,');
  console.log('and the spread of the kinds\' z (1 for a fair split). CRC-32: the one split it can draw.\n');
  console.log(header(['ids and kinds', 'kinds', 'sha256: warned', 'sha256: spread of z', 'CRC-32: warned', 'CRC-32: spread of z', 'CRC-32: largest kind\'s share held out']));
  for (const pt of patterns) {
    let warned = 0, spread = 0;
    const S = 200;
    for (let i = 1; i <= S; i++) {
      const cfg = cfgFor({ held_out: 0.5, salt: 'salt-' + i, hash: 'sha256', by: 'cluster' }, []);
      const halves = splitOf(pt.records, cfg);
      if (balanceOf(pt.records, cfg, halves).beyond_chance.length) warned++;
      spread += zSpread(pt.records, cfg, halves) / S;
    }
    const cfg = cfgFor({ held_out: 0.5, salt: '', hash: 'crc32', by: 'cluster' }, []);
    const halves = splitOf(pt.records, cfg);
    const b = balanceOf(pt.records, cfg, halves);
    const worst = b.dimensions[0].labels.reduce((w, r) => (Math.abs(r.held_out / r.records - 0.5) > Math.abs(w.held_out / w.records - 0.5) ? r : w));
    console.log(md([[pt.name, b.dimensions[0].labels.length, fmtPct(warned / S), spread.toFixed(2), b.beyond_chance.length ? 'yes (' + b.beyond_chance.length + ' kinds)' : 'no',
      zSpread(pt.records, cfg, halves).toFixed(2), worst.held_out + ' of ' + worst.records]]));
  }

  // Duplicates numbered after their primaries, split by their own id (split.by "id").
  console.log('\nDuplicates split by their own id (split.by "id"): the share of duplicate pairs whose two records land in different halves.');
  console.log('Chance alone puts half of them on different sides. With the default (a duplicate goes with its primary), none.\n');
  console.log(header(['primaries and duplicates', 'pairs', 'sha256 (200 salts): average, least-most', 'CRC-32']));
  const dupSets = [
    { name: 'R0001-R0500, duplicate of R(n) is R(n+500)', make: () => seq(1000, i => ({ id: 'R' + pad(i + 1, 4), duplicate_of: i >= 500 ? 'R' + pad(i - 499, 4) : null })) },
    { name: 'R0001-R0500, duplicate of R(n) is R(n)-dup', make: () => [...seq(500, i => ({ id: 'R' + pad(i + 1, 4), duplicate_of: null })), ...seq(500, i => ({ id: 'R' + pad(i + 1, 4) + '-dup', duplicate_of: 'R' + pad(i + 1, 4) }))] },
    { name: 'R0001-R0500, duplicate of R(n) is R(n)b', make: () => [...seq(500, i => ({ id: 'R' + pad(i + 1, 4), duplicate_of: null })), ...seq(500, i => ({ id: 'R' + pad(i + 1, 4) + 'b', duplicate_of: 'R' + pad(i + 1, 4) }))] },
    { name: 'R0001-R1000, duplicate of R(2n-1) is R(2n)', make: () => seq(1000, i => ({ id: 'R' + pad(i + 1, 4), duplicate_of: i % 2 === 1 ? 'R' + pad(i, 4) : null })) },
  ];
  for (const ds of dupSets) {
    const recs = ds.make();
    const pairs = recs.filter(r => r.duplicate_of);
    const across = split => pairs.filter(r => heldOutName(r.id, split) !== heldOutName(r.duplicate_of, split)).length / pairs.length;
    const shares = seq(200, i => across({ held_out: 0.5, salt: 'salt-' + (i + 1), hash: 'sha256' }));
    console.log(md([[ds.name, pairs.length, fmtPct(shares.reduce((a, b) => a + b, 0) / shares.length) + ', ' + fmtPct(Math.min(...shares)) + '-' + fmtPct(Math.max(...shares)),
      fmtPct(across({ hash: 'crc32' }))]]));
  }

  // What a salt does to CRC-32: for names of one length, CRC-32 is affine, so a salt in front adds
  // the same bits to every name's checksum. Its parity flips for all of them or for none.
  console.log('\nCRC-32 with a salt in front of the id (salt + id), on the metadata golden set: of each id length, how many records change half.\n');
  console.log(header(['salt', '3-character ids (24)', '4-character ids (476)']));
  const ids = metadataSet().map(r => r.id);
  for (const salt of ['x', 'salt1', 'golden-2026', 'abc:', 'zz', 'v2']) {
    const moved = L => ids.filter(id => id.length === L && (crc32(salt + id) % 2) !== (crc32(id) % 2)).length;
    console.log(md([[JSON.stringify(salt), moved(3), moved(4)]]));
  }
  console.log('');
}

// ======================================================================================
// leak
// ======================================================================================

// The metadata golden set split by its own ids with CRC-32 (the hand split behind its notes),
// against the same hash with each duplicate kept with its primary (the default). Runs 68-72.
function leakPart() {
  console.log('## leak\n');
  const { loadConfig } = require('../src/config.js');
  const { scoreRun } = require('../src/score.js');
  const G = path.join(EX, 'metadata-enrichment', 'golden500');
  const cfg = loadConfig(path.join(G, 'config.json'));
  console.log('The metadata golden set (34 duplicates, each of one primary), CRC-32 parity. "By id" is the hand split; "with primaries"');
  console.log('keeps each duplicate with its primary. Held-out silent errors are of the held-out records out without review.\n');
  console.log(header(['run', 'pairs on both sides (by id)', 'held-out silent errors: by id', 'with primaries', 'held-out records out whose retelling is in the tuning half (by id)', 'silent errors among them']));
  for (const n of [68, 69, 70, 71, 72]) {
    const f = path.join(G, 'exec-' + n + '.json');
    const R = scoreRun({ config: cfg, predPath: f, keyPath: f });
    const sum = new Map(R.records.map(r => [r.id, r]));
    const twin = new Map();
    for (const r of R.paired) if (r.duplicate_of) { twin.set(r.id, r.duplicate_of); twin.set(r.duplicate_of, r.id); }
    const halves = by => splitOf(R.paired, { ...cfg, split: { held_out: 0.5, salt: '', hash: 'crc32', by } });
    const byId = halves('id');
    const byPrimary = halves('cluster');
    const out = h => R.paired.filter(r => h.half.get(r.id) === 'held_out' && sum.get(r.id).route_class === 'auto');
    const cell = h => { const o = out(h); return o.filter(r => sum.get(r.id).silent).length + ' of ' + o.length; };
    const leaked = out(byId).filter(r => twin.has(r.id) && byId.half.get(twin.get(r.id)) === 'tuning');
    console.log(md([[n, byId.straddling.duplicates + ' of 34', cell(byId), cell(byPrimary), leaked.length, leaked.filter(r => sum.get(r.id).silent).length]]));
  }
  // Worst case: if tuning fixed every story whose record it saw fail (pure memorizing, nothing that
  // carries over to new stories), every held-out silent error whose story has a record in the
  // tuning half would vanish from the held-out count, with the true rate unchanged. Under a split
  // by record, a held-out record of a story of c records has another record in the tuning half
  // with chance 1 - h^(c-1) (h the share held out); split by story, never.
  console.log('\nIf tuning fixed every story it saw fail, and fixed nothing else: the share of held-out silent errors that would vanish');
  console.log('with no real improvement (the held-out rate\'s flattery), stories of c records that go right or wrong together. Simulated,');
  console.log(REPS + ' golden sets of 600 records each, a 10% rate; the formula 1 - h^(c-1) beside it.\n');
  console.log(header(['records per story', 'held out', 'split by record: simulated', 'formula', 'split by story']));
  for (const c of [1, 2, 3, 5]) {
    for (const h of [0.5, 0.3]) {
      const u = rng(seedOf('leak ' + c + ' ' + h));
      let vanished = 0, total = 0, vanishedStory = 0;
      for (let rep = 0; rep < REPS; rep++) {
        for (let s = 0; s < 600 / c; s++) {
          const wrong = u() < 0.1;
          const held = seq(c, () => u() < h);            // by record: each record its own draw
          const storyHeld = u() < h;                      // by story: one draw for the story
          if (!wrong) continue;
          const anyTuning = held.some(x => !x);
          for (const x of held) if (x) { total++; if (anyTuning) vanished++; }
          if (storyHeld) vanishedStory += 0;              // nothing of the story is in the tuning half
        }
      }
      console.log(md([[c, fmtPct(h), fmtPct(vanished / total), fmtPct(1 - Math.pow(h, c - 1)), fmtPct(vanishedStory)]]));
    }
  }
  console.log('');
}
const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));

// ======================================================================================
// looks
// ======================================================================================
//
// The analyst's work, as a sequence of looks at the held-out half; the analyst stops at the first
// "shown under the target". The claim is the exact binomial test the reports make: p = P(Bin(n,
// target) <= k) for k silent errors in the n held-out records out without review, shown when p is
// at most this look's share of the 5% (one-sided). Ranges stay 95% (z = 1.96); only the yes or no
// spends.
//
// The rules for a look's share (alpha = 0.05):
//   5% every look   no correction
//   budget B        a declared budget of B looks, 5% / B each (Bonferroni); nothing after the B-th
//   6/(pi^2 k^2)    look k at 5% x 6 / (pi^2 k^2): 3.0%, 0.76%, 0.34%, ... (adds up to 5%)
//   1/(k(k+1))      look k at 5% / (k (k + 1)): 2.5%, 0.83%, 0.42%, ... (adds up to 5%)
//   a share of what is left   each look a fixed share of what the looks before it left: two
//                   thirds (3.3%, 1.1%, ...), half (2.5%, 1.25%, ...; the shipped rule) or a third
// Every rule adds up to at most 5%, so with looks that reveal nothing the analyst can use (a yes or
// no, stopping at the first yes), each holds by the union bound. What the simulation measures is
// what happens when each look shows the held-out count, and the analyst uses it.
//
// The analysts (every "shown" is false unless a row says the versions are truly under):
//   versions        each version has a true rate; looked at after every version, or only when the
//                   tuning half is under the target. Versions share which records are hard (rho).
//   gates           a gate chosen on the tuning half (certified, as whatif does, or by eye), tried
//                   on the held-out half; policies are chosen the same way
//   hill-climb      each look tries one change on top of the version kept so far, kept when the
//                   held-out count fell (changes fix and break records in balance: no real gain)
//   boosting        Blum and Hardt's attack on a leaderboard (2015, "The Ladder", ICML), on records:
//                   versions that each hold a random half of the held-out records, kept when the
//                   held-out rate beat the first look's; then one version holding the records most
//                   kept versions held. Holding records by name says nothing of the next records, so
//                   the true rate never moves.
//   group testing   each look holds every held-out error found so far plus one block of records under
//                   test; the count says how many errors the block holds, and blocks with errors are
//                   halved again. It finds the held-out errors one by one and holds them.
// The releases (what each look shows the analyst):
//   full            the held-out count (and so its rate and likely range): what the reports show
//   ladder          the rate only when it beats the best shown so far by a step (one standard error,
//                   sqrt(T(1-T)/n)), else "no better" (Blum and Hardt's Ladder)
//   yes/no          only whether the claim was shown

const T = 0.05;
const ALPHA_LOOKS = 0.05;
const K = 20;
const LOOK_RULES = {
  '5% every look': k => ALPHA_LOOKS,
  'budget of 5 looks': k => (k <= 5 ? ALPHA_LOOKS / 5 : 0),
  'budget of 10 looks': k => (k <= 10 ? ALPHA_LOOKS / 10 : 0),
  'budget of 20 looks': k => (k <= 20 ? ALPHA_LOOKS / 20 : 0),
  'spending 6/(pi^2 k^2)': k => ALPHA_LOOKS * 6 / (Math.PI * Math.PI * k * k),
  'spending 1/(k(k+1))': k => ALPHA_LOOKS / (k * (k + 1)),
  'two thirds of what is left': k => ALPHA_LOOKS * (2 / 3) * Math.pow(1 / 3, k - 1),
  'half of what is left (shipped)': k => lookLevel(k),
  'a third of what is left': k => ALPHA_LOOKS * (1 / 3) * Math.pow(2 / 3, k - 1),
};
const NAMES = Object.keys(LOOK_RULES);
const SHIPPED = 'half of what is left (shipped)';
// A version's true rate at or above the target: a claim on it is false. (A tolerance, so a rate
// worked out as exactly 5% and stored as 4.9999...% still counts as at the target.)
const atOrAbove = (p, target) => p >= target - 1e-12;

// Can a rule show anything at all within these looks, with n records out (even with no silent
// error)? A rule that cannot "holds" for no reason, so such cells are marked, not counted as held.
const canShow = (rule, n, looks, target) => Array.from({ length: looks }, (_, i) => LOOK_RULES[rule](i + 1)).some(l => l > 0 && Math.pow(1 - target, n) <= l);

// One tally per rule. looked: [{ k, n, p (true rate), t (the target) }] in order; the analyst stops
// at the first look shown under the target.
const tallyOf = () => Object.fromEntries(NAMES.map(m => [m, { false: 0, true: 0, looks: [] }]));
function firstShown(tally, looked) {
  const pv = looked.map(x => (x.n > 0 ? chanceAtMost(x.k, x.n, x.t) : 1));
  for (const m of NAMES) {
    const level = LOOK_RULES[m];
    const at = pv.findIndex((p, i) => level(i + 1) > 0 && p <= level(i + 1));
    if (at < 0) continue;
    if (atOrAbove(looked[at].p, looked[at].t)) tally[m].false++; else { tally[m].true++; tally[m].looks.push(at + 1); }
  }
}

// Versions on fixed records. Each record has a difficulty z (normal) that every version shares;
// version v gets record i wrong when sqrt(rho) z_i + sqrt(1 - rho) e_iv clears the cut-off for p_v.
function versions(u, n, rho, rates) {
  const zt = seq(n, () => normal(u)), zh = seq(n, () => normal(u));
  const a = Math.sqrt(rho), b = Math.sqrt(1 - rho);
  return rates.map(p => {
    const cut = qnorm(1 - p);
    let kt = 0, kh = 0;
    for (let i = 0; i < n; i++) { if (a * zt[i] + b * normal(u) > cut) kt++; if (a * zh[i] + b * normal(u) > cut) kh++; }
    return { p, kt, kh };
  });
}
function runVersions(rates, n, rho, onlyWhenTuningUnder, name) {
  const u = rng(seedOf(name));
  const tally = tallyOf();
  for (let rep = 0; rep < REPS; rep++) {
    const looked = versions(u, n, rho, rates(u)).filter(v => !onlyWhenTuningUnder || v.kt / n < T).map(v => ({ k: v.kh, n, p: v.p, t: T }));
    firstShown(tally, looked);
  }
  return { tally, n, looks: K, target: T };
}

// Gates chosen on the tuning half. Every record has a confidence c from 0.5 to 1 and gets a silent
// error, when it goes out, with chance 2 q (1 - c); the gate g lets out the records at g or above, so
// its true rate is q (1 - g). Each version has its own q (the gate at 0.75 then has a true rate of
// 3.5% to 6.5%); the records and their confidences stay. The tuning half chooses the loosest gate
// certified there (5% shared among 11 gates, as whatif --gate --target does) or, by eye, the loosest
// under the target; the held-out half is looked at only when a gate was chosen.
const GATES = seq(11, i => 0.5 + i * 0.05);
function runGates(n, rule) {
  const u = rng(seedOf(['gates', n, rule].join(' ')));
  const tally = tallyOf();
  const rho = 0.5, a = Math.sqrt(rho), b = Math.sqrt(1 - rho);
  for (let rep = 0; rep < REPS; rep++) {
    const ct = seq(n, () => 0.5 + 0.5 * u()), ch = seq(n, () => 0.5 + 0.5 * u());
    const zt = seq(n, () => normal(u)), zh = seq(n, () => normal(u));
    const looked = [];
    for (let v = 0; v < K; v++) {
      const q = 0.14 + 0.12 * u();
      const err = (c, z) => a * z + b * normal(u) > qnorm(1 - Math.min(1 - 1e-12, 2 * q * (1 - c)));
      const et = ct.map((c, i) => err(c, zt[i])), eh = ch.map((c, i) => err(c, zh[i]));
      let chosen = null;
      for (const g of GATES) {
        let out = 0, k = 0;
        ct.forEach((c, i) => { if (c >= g) { out++; if (et[i]) k++; } });
        const ok = out > 0 && (rule === 'certified' ? chanceAtMost(k, out, T) <= 0.05 / GATES.length : k / out < T);
        if (ok) { chosen = g; break; }   // gates in order from loosest: the first that passes is the loosest
      }
      if (chosen === null) continue;
      let nh = 0, kh = 0;
      ch.forEach((c, i) => { if (c >= chosen) { nh++; if (eh[i]) kh++; } });
      looked.push({ k: kh, n: nh, p: q * (1 - chosen), t: T });
    }
    firstShown(tally, looked);
  }
  return { tally, n: Math.round(n / 2), looks: K, target: T };   // about half the records go out at the gates chosen
}

// What the analyst learns from a look's count under each release. best: the best rate shown so far.
function released(release, k, n, state, step) {
  if (release === 'full') return { shown: true, k };
  if (release === 'ladder' && n > 0 && k / n < state.best - step) { state.best = k / n; return { shown: true, k }; }
  return { shown: false, k: null };
}

// Hill-climb: each look tries one change on top of the version kept so far, kept when the held-out
// count the analyst saw fell. A change fixes each wrong record with chance f and breaks each right
// one with chance f T / (1 - T): no real gain (or half that, when helps: each truly helps a little).
function runClimb(n, f, looks, release, helps = false) {
  const u = rng(seedOf(['climb', n, f, looks, release, helps].join(' ')));
  const tally = tallyOf();
  const bNull = f * T / (1 - T), b = helps ? bNull / 2 : bNull;
  const step = Math.sqrt(T * (1 - T) / n);
  let shownLooks = 0, allLooks = 0;
  for (let rep = 0; rep < REPS; rep++) {
    let cur = seq(n, () => u() < T), curK = cur.filter(Boolean).length, curP = T;
    const state = { best: curK / n };
    const looked = [{ k: curK, n, p: T, t: T }];
    shownLooks++; allLooks++;
    let seen = curK;
    for (let i = 1; i < looks; i++) {
      const cand = cur.map(e => (e ? u() >= f : u() < b));
      const k = cand.filter(Boolean).length;
      const p = helps ? curP * (1 - f) + (1 - curP) * b : T;
      looked.push({ k, n, p, t: T });
      const r = released(release, k, n, state, step);
      allLooks++;
      if (r.shown) shownLooks++;
      if (r.shown && r.k < seen) { cur = cand; curK = k; curP = p; seen = k; }
    }
    firstShown(tally, looked);
  }
  return { tally, n, looks, target: T, shownShare: shownLooks / allLooks };
}

// Boosting (Blum and Hardt 2015), on records: K versions each holding a random half of the held-out
// records, kept when the rate shown beat the first look's; then one version holding the records
// held in most kept versions.
function runBoost(n, Kq, release) {
  const u = rng(seedOf(['boost', n, Kq, release].join(' ')));
  const tally = tallyOf();
  const step = Math.sqrt(T * (1 - T) / n);
  let shownLooks = 0, allLooks = 0;
  for (let rep = 0; rep < REPS; rep++) {
    const e = seq(n, () => u() < T);
    const c0 = e.filter(Boolean).length;
    const looked = [{ k: c0, n, p: T, t: T }];
    const state = { best: c0 / n };
    shownLooks++; allLooks++;
    const kept = [];
    for (let j = 0; j < Kq; j++) {
      const hold = e.map(() => u() < 0.5);
      let k = 0, m = 0;
      e.forEach((x, i) => { if (!hold[i]) { m++; if (x) k++; } });
      looked.push({ k, n: m, p: T, t: T });
      allLooks++;
      const r = released(release, k, m, state, step);
      if (r.shown) { shownLooks++; if (m && r.k / m < c0 / n) kept.push(hold); }
    }
    if (kept.length) {
      const hold = e.map((_, i) => kept.filter(h => h[i]).length > kept.length / 2);
      let k = 0, m = 0;
      e.forEach((x, i) => { if (!hold[i]) { m++; if (x) k++; } });
      looked.push({ k, n: m, p: T, t: T });
      allLooks++;
      if (release === 'full') shownLooks++;
    }
    firstShown(tally, looked);
  }
  return { tally, n, looks: Kq + 2, target: T, shownShare: shownLooks / allLooks };
}

// Group testing: every look holds the errors found so far and one block under test; the count says
// how many errors the block holds (under a release that shows it; otherwise the analyst guesses
// none). Depth first, so errors are found soonest.
function runGroup(n, target, looks, release) {
  const u = rng(seedOf(['group', n, target, looks, release].join(' ')));
  const tally = tallyOf();
  const step = Math.sqrt(target * (1 - target) / n);
  let shownLooks = 0, allLooks = 0;
  for (let rep = 0; rep < REPS; rep++) {
    const e = seq(n, () => u() < target);
    const total = e.filter(Boolean).length;
    const looked = [{ k: total, n, p: target, t: target }];
    const state = { best: total / n };
    shownLooks++; allLooks++;
    const found = new Set();
    const stack = [{ ids: seq(n, i => i), errs: total }];
    while (looked.length < looks && stack.length) {
      const blk = stack.pop();
      if (blk.errs === 0) continue;
      if (blk.ids.length === 1) { found.add(blk.ids[0]); continue; }
      const half = blk.ids.slice(0, Math.floor(blk.ids.length / 2)), rest = blk.ids.slice(half.length);
      const held = new Set([...found, ...half]);
      let k = 0, m = 0;
      e.forEach((x, i) => { if (!held.has(i)) { m++; if (x) k++; } });
      looked.push({ k, n: m, p: target, t: target });
      allLooks++;
      const r = released(release, k, m, state, step);
      if (r.shown) shownLooks++;
      const inHalf = r.shown ? total - found.size - r.k : 0;
      stack.push({ ids: rest, errs: Math.max(0, blk.errs - inHalf) }, { ids: half, errs: inHalf });
    }
    firstShown(tally, looked);
  }
  return { tally, n, looks, target, shownShare: shownLooks / allLooks };
}

const median = xs => { if (!xs.length) return '-'; const s = [...xs].sort((a, b) => a - b); return String(s[Math.floor((s.length - 1) / 2)]); };
const CANNOT = 'cannot show';

function looksPart() {
  console.log('## looks\n');
  console.log('Up to ' + K + ' versions (more looks where a row says so), ' + REPS + ' analysts per row. "False" is the share of analysts who ever got');
  console.log('"shown under the target" for a version whose true rate is at or above it (5% is the promise); "true" the share who got');
  console.log('it for a version truly under. "' + CANNOT + '": with these records, no look could show anything under this rule, even with');
  console.log('no silent error at all, so its 0% proves nothing. n is the held-out records out without review.\n');
  const rows = [];
  const add = (label, res, kind, group) => rows.push({ label, kind, group, ...res });
  const flat = (p, from = 0) => () => seq(K, i => (i < from ? 0.06 : p));
  for (const n of [100, 250]) {
    for (const rho of [0.3, 0.8]) {
      add('versions at 5%, every one looked at; n ' + n + ', versions agree ' + rho, runVersions(flat(T), n, rho, false, 'at ' + n + ' ' + rho), 'false', 'blind');
      add('versions at 5-7%, looked at when under 5% on the tuning half; n ' + n + ', agree ' + rho,
        runVersions(uu => seq(K, () => T * (1 + 0.4 * uu())), n, rho, true, 'above ' + n + ' ' + rho), 'false', 'blind');
    }
  }
  for (const n of [500, 1000]) add('gates chosen by eye on the tuning half (' + n + ' records a half)', runGates(n, 'eye'), 'both', 'blind');
  for (const n of [100, 250]) add('hill-climb, 20 looks; n ' + n, runClimb(n, 0.3, 20, 'full'), 'false', 'adaptive');
  for (const n of [250, 500, 1000]) add('hill-climb with small changes, 40 looks; n ' + n, runClimb(n, 0.1, 40, 'full'), 'false', 'adaptive');
  for (const n of [250, 1000]) for (const Kq of [4, 16]) add('boosting, ' + Kq + ' random versions then their majority; n ' + n, runBoost(n, Kq, 'full'), 'false', 'adaptive');
  for (const [n, t] of [[250, 0.05], [1000, 0.05], [1000, 0.01], [250, 0.1], [1000, 0.1], [250, 0.3], [1000, 0.3]]) {
    add('group testing, 200 looks, target ' + Math.round(t * 100) + '%; n ' + n, runGroup(n, t, 200, 'full'), 'false', 'adaptive');
  }
  for (const L of [1, 2, 3, 5, 8, 12]) add('versions at 6% until look ' + L + ', then at 2.5%; n 250, agree 0.5', runVersions(flat(T / 2, L - 1), 250, 0.5, false, 'arrives ' + L), 'both', 'power');
  add('versions improving from 7.5% to 2.5%, looked at when under 5% on the tuning half; n 250, agree 0.5',
    runVersions(() => seq(K, i => T * (1.5 - i / (K - 1))), 250, 0.5, true, 'improving filtered'), 'both', 'power');
  add('hill-climb, each change helping a little, 20 looks; n 250', runClimb(250, 0.3, 20, 'full', true), 'both', 'power');
  add('gates certified on the tuning half (1000 records a half)', runGates(1000, 'certified'), 'both', 'power');

  const cell = (r, m, what) => (!canShow(m, r.n, r.looks, r.target) ? CANNOT : what === 'false' ? fmtPct(r.tally[m].false / REPS) : fmtPct(r.tally[m].true / REPS));
  for (const r of rows) {
    console.log('\n' + r.label + '\n');
    console.log(header(['rule', 'false "shown"', 'true "shown"', 'median looks to a true "shown"']));
    for (const m of NAMES) {
      const t = r.tally[m];
      console.log(md([[m, cell(r, m, 'false'), r.kind === 'false' ? '-' : cell(r, m, 'true'), r.kind === 'false' || !canShow(m, r.n, r.looks, r.target) ? '-' : median(t.looks)]]));
    }
  }
  // The summary the docs quote: the worst false "shown" over the rows where a rule can show
  // something, blind and adaptive analysts apart, and the true "shown" by when a truly-under version came.
  console.log('\nSummary. Worst false "shown" over the rows where the rule can show anything (rows where it cannot are counted');
  console.log('apart), for analysts who never use the held-out numbers ("blind") and those who do ("adaptive"); then the true');
  console.log('"shown" when the first truly-under version comes at look L (versions at 6% before it, 2.5% from it on; n 250).\n');
  const arrivals = rows.filter(r => r.label.startsWith('versions at 6% until look'));
  const falseRows = rows.filter(r => r.group !== 'power');
  console.log(header(['rule', 'worst false: blind', 'worst false: adaptive', 'rows over 5%', 'rows where it cannot show anything',
    ...arrivals.map(r => 'look ' + r.label.match(/look (\d+)/)[1]), 'improving, looked at when the tuning half is under', 'gates certified on the tuning half']));
  const improving = rows.find(r => r.label.startsWith('versions improving'));
  const gates = rows.find(r => r.label.startsWith('gates certified'));
  for (const m of NAMES) {
    const able = falseRows.filter(r => canShow(m, r.n, r.looks, r.target));
    const worst = g => { const xs = able.filter(r => r.group === g).map(r => r.tally[m].false / REPS); return xs.length ? fmtPct(Math.max(...xs)) : '-'; };
    const over = able.filter(r => r.tally[m].false / REPS > 0.05).length;
    console.log(md([[m, worst('blind'), worst('adaptive'), over + ' of ' + able.length, (falseRows.length - able.length) + ' of ' + falseRows.length,
      ...arrivals.map(r => cell(r, m, 'true')), cell(improving, m, 'true'), cell(gates, m, 'true')]]));
  }

  // What limiting the release buys: the adaptive attacks again, with the rate shown only on a new
  // best (ladder) or not at all (yes/no), and how often a look shows a held-out rate.
  console.log('\nThe adaptive attacks under each release. False "shown" for each rule, and the share of looks that show a held-out');
  console.log('rate. Under "yes/no" the analyst learns nothing to adapt to, so every rule holds by the union bound.\n');
  const attacks = [
    ['hill-climb with small changes, 40 looks; n 1000', rel => runClimb(1000, 0.1, 40, rel)],
    ['boosting, 16 random versions then their majority; n 1000', rel => runBoost(1000, 16, rel)],
    ['group testing, 200 looks, target 5%; n 1000', rel => runGroup(1000, 0.05, 200, rel)],
  ];
  const shown = ['5% every look', 'budget of 20 looks', 'spending 6/(pi^2 k^2)', SHIPPED];
  console.log(header(['attack', 'release', 'looks that show a rate', ...shown]));
  for (const [label, run] of attacks) {
    for (const rel of ['full', 'ladder', 'yes/no']) {
      const r = run(rel === 'yes/no' ? 'yesno' : rel);
      console.log(md([[label, rel, fmtPct(rel === 'yes/no' ? 0 : r.shownShare), ...shown.map(m => cell(r, m, 'false'))]]));
    }
  }

  // Thresholdout (Dwork et al. 2015) answers with the tuning half's rate unless the held-out half's
  // differs by more than a noisy threshold. Its answers are accurate to about 4 / sqrt(n) (the paper's
  // threshold, 4 sigma with sigma = 1 / sqrt(n)); a claim that allowed for that could show a rate
  // under the target only if the band were narrower than the target.
  console.log('\nThresholdout\'s accuracy band, about 4 / sqrt(n), against a 5% target: wider at every size a golden set has, so a claim');
  console.log('that allowed for its accuracy could never show a rate under 5%.\n');
  console.log(header(['held-out records out (n)', 'band, about 4 / sqrt(n)', 'narrower than the 5% target?']));
  for (const n of [100, 250, 1000, 6400, 10000]) console.log(md([[thousands(n), percentOf(4 / Math.sqrt(n)), 4 / Math.sqrt(n) < 0.05 ? 'yes' : 'no']]));
  console.log('');
}
const thousands = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const percentOf = x => (x * 100).toFixed(1) + '%';

// ======================================================================================
// main
// ======================================================================================
if (part === 'balance' || part === 'all') balancePart();
if (part === 'leak' || part === 'all') leakPart();
if (part === 'looks' || part === 'all') looksPart();
