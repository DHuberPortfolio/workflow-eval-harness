// The tuning half and the held-out half (config.split; traps O1-O12).
//
// A golden set that a workflow is tuned on (a gate chosen, a policy written, a prompt reworked
// after reading its mistakes) flatters whatever was tuned on it. Some of its records, held out
// from tuning, keep an honest check. The tuning half is reported in full; the held-out half as a
// summary only (its rates and likely ranges, never its records' ids), and every claim made on it
// counts how often it has been looked at (the looks: split-log.js).
//
// Which half a record is in comes from a hash of one name, its unit:
//   - its cluster's value, when the config names clusters read from the answer key and the
//     record has one (config.clusters): retellings of one story go together;
//   - else, for a duplicate (duplicate_of_field), its primary's unit, followed to the first record
//     that is not a duplicate: a retelling goes with the story it retells;
//   - else its own id.
// split.by "id" uses each record's own id whatever the config says, to reproduce a split made
// that way; the report then counts the clusters and duplicates whose records straddle the halves
// (trap O3), since retellings on both sides make the held-out half look better than it is.
//
// Why a hash of the unit's name: the same on every machine, and stable as the golden set grows.
// A record's half depends on its own name only, never on the other records, so adding records
// never moves one already there from the tuning half into the held-out half (which would put a
// record that was tuned on into the check). A shuffle or a sort would move them.
//
// The hash (the simulation in scripts/split-sim.js chose it; docs/METRICS.md):
//   sha256  (the default) the first 4 bytes of SHA-256 of the salt, a colon and the name, read
//           as a number from 0 to 1: held out when it is under split.held_out. A salt draws a
//           different split, for a new golden set or before the first look.
//   crc32   CRC-32 of the name alone (zlib's), held out when it is odd: half the records. Kept
//           to reproduce a split made by hand that way (the metadata example's). CRC-32 is
//           linear: for names of one length a salt can only swap the two halves, never draw a
//           new split, so it takes no salt (trap O2).

const crypto = require('crypto');

// CRC-32 as zlib computes it (the standard check value: "123456789" gives 0xcbf43926). Written
// out because zlib.crc32 needs Node 22.2, and CI runs Node 18.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(text) {
  let c = 0xffffffff;
  for (const b of Buffer.from(text, 'utf8')) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// A unit's place on the line from 0 to 1 under sha256: the first 4 bytes of the hash as a number.
function sha256Point(name, salt) {
  const h = crypto.createHash('sha256').update(salt === '' ? name : salt + ':' + name, 'utf8').digest();
  return h.readUInt32BE(0) / 4294967296;
}

// Is the unit named `name` held out? split: config.split.
function heldOutName(name, split) {
  if (split.hash === 'crc32') return crc32(name) % 2 === 1;
  return sha256Point(name, split.salt) < split.held_out;
}

// Each record's unit, by id. records: the paired records (align.js), each with its id, its
// duplicate_of, and with clusters its cluster. Clusters read from the predictions are refused by
// the config (a run could move a record between halves), so a cluster here is the answer key's.
function unitsOf(records, config) {
  const by = config.split ? config.split.by : 'cluster';
  const byId = new Map(records.map(r => [r.id, r]));
  const units = new Map();
  const unitOf = r => {
    if (units.has(r.id)) return units.get(r.id);
    let u = r.id;
    if (by !== 'id') {
      if (r.cluster !== undefined && r.cluster !== null) u = r.cluster;
      else {
        // Follow duplicate_of to the first record that is not a duplicate (or that has a cluster).
        // A loop (two records each the other's duplicate, a key mistake) takes the first of its ids
        // in text order, so every record in it still gets one unit.
        const path = [r.id];
        let at = r;
        for (;;) {
          const to = at.duplicate_of;
          if (!to) { u = at.id; break; }
          if (path.includes(to)) { u = path.slice(path.indexOf(to)).sort()[0]; break; }
          const next = byId.get(to);
          if (!next) { u = to; break; }
          if (next.cluster !== undefined && next.cluster !== null) { u = next.cluster; break; }
          path.push(to);
          at = next;
        }
      }
    }
    units.set(r.id, u);
    return u;
  };
  for (const r of records) unitOf(r);
  return units;
}

// For another command (wfeval suspects, say): is this record in the held-out half? records: the
// run's paired records, so a duplicate can follow its primary (without them, a duplicate goes by
// the id it names). false when the config has no split.
function heldOut(record, config, records = [record]) {
  if (!config.split) return false;
  const all = records.some(r => r.id === record.id) ? records : [...records, record];
  return heldOutName(unitsOf(all, config).get(record.id), config.split);
}

// The two halves of a run's records. Returns the ids in each half, in the records' order, each
// record's unit and half, and the clusters and duplicate pairs whose records straddle the halves
// (only possible with split.by "id", or a duplicate whose own cluster differs from its primary's).
function splitOf(records, config) {
  const units = unitsOf(records, config);
  const half = new Map(records.map(r => [r.id, heldOutName(units.get(r.id), config.split) ? 'held_out' : 'tuning']));
  const tuning = records.filter(r => half.get(r.id) === 'tuning').map(r => r.id);
  const heldOutIds = records.filter(r => half.get(r.id) === 'held_out').map(r => r.id);
  // Clusters with records on both sides, and duplicates on the other side from their primary.
  const sides = new Map();
  for (const r of records) {
    if (r.cluster === undefined || r.cluster === null) continue;
    if (!sides.has(r.cluster)) sides.set(r.cluster, new Set());
    sides.get(r.cluster).add(half.get(r.id));
  }
  const byId = new Map(records.map(r => [r.id, r]));
  const straddling = {
    clusters: [...sides.values()].filter(s => s.size === 2).length,
    duplicates: records.filter(r => r.duplicate_of && byId.has(r.duplicate_of) && half.get(r.duplicate_of) !== half.get(r.id)).length,
  };
  return { units, half, tuning, held_out: heldOutIds, straddling };
}

// ---------- Balance: does a trap type or group fall mostly into one half? (trap O5) ----------
//
// A held-out half with none of a trap type cannot speak for it, and a hash that splits patterned
// names unevenly would leave whole kinds of record on one side. Chance alone also splits some
// kinds unevenly, especially small ones (a kind with 3 records falls wholly in one half a quarter
// of the time), so the warning fires only on what chance alone would rarely produce:
//
//   - each label's held-out count is compared with its exact distribution under a fair split:
//     every unit held out with chance split.held_out, independently, carrying all its records of
//     that label (records that go together move together). Two-sided p-value: twice the smaller
//     tail, at most 1.
//   - Tarone's (1990) modified Bonferroni across every label of every dimension: a label whose
//     smallest possible p-value cannot reach the bar is not counted (a kind with 3 records can
//     never be beyond chance), and the 5% is shared among the labels that can. So a fair split
//     warns at most 1 time in 20, however many labels there are (the simulation measured it).
// Labels with no record at all in one half are listed apart, as a fact: by chance or not, that
// half cannot speak for them.

// The exact distribution of the held-out count: counts[u] records of the label in unit u, each
// unit held out with chance s. Returns the probabilities of 0..total.
function heldOutDistribution(counts, s) {
  let pmf = [1];
  for (const c of counts) {
    const next = new Array(pmf.length + c).fill(0);
    for (let x = 0; x < pmf.length; x++) {
      if (pmf[x] === 0) continue;
      next[x] += pmf[x] * (1 - s);
      next[x + c] += pmf[x] * s;
    }
    pmf = next;
  }
  return pmf;
}

// Two-sided p-value of x under pmf: twice the smaller tail, at most 1. Also the smallest p-value
// any count could give (Tarone's method needs it).
function twoSided(pmf, x) {
  const below = pmf.slice(0, x + 1).reduce((a, b) => a + b, 0);
  const above = pmf.slice(x).reduce((a, b) => a + b, 0);
  return Math.min(1, 2 * Math.min(below, above));
}
function smallestP(pmf) {
  return Math.min(1, 2 * Math.min(pmf[0], pmf[pmf.length - 1]));
}

// Tarone (1990): the smallest K such that at most K labels have a smallest possible p-value at or
// under alpha / K. Those labels are tested at alpha / K; the others can never warn.
function taroneLevel(minPs, alpha) {
  for (let K = 1; K <= minPs.length; K++) {
    if (minPs.filter(p => p <= alpha / K).length <= K) return alpha / K;
  }
  return alpha / Math.max(1, minPs.length);
}

const ALPHA = 0.05;

// The dimensions balance is checked on: the trap types, and each group read from the answer key
// (a group read from the predictions can change from run to run). Each: name, labels of a record.
function dimensions(config) {
  const out = [];
  if (config.trap_field) out.push({ name: 'trap', field: config.trap_field, labels: r => (r.traps.length ? r.traps : ['(none)']) });
  for (const [name, g] of Object.entries(config.groups || {})) {
    if (g.from !== 'key') continue;
    out.push({ name: 'group ' + name, field: g.field, labels: r => ((r.groups && r.groups[name] && r.groups[name].length) ? r.groups[name] : ['(none)']) });
  }
  return out;
}

// records: the paired records; halves: splitOf(). Returns one entry per dimension, each with a
// row per label (records, held out, expected, p), the level the labels were tested at, and the
// labels beyond chance and with nothing in one half.
function balanceOf(records, config, halves) {
  const s = config.split.hash === 'crc32' ? 0.5 : config.split.held_out;
  const rows = [];
  const dims = dimensions(config).map(d => {
    const byLabel = new Map();
    for (const r of records) {
      for (const label of d.labels(r)) {
        if (!byLabel.has(label)) byLabel.set(label, { records: 0, held_out: 0, units: new Map() });
        const x = byLabel.get(label);
        x.records++;
        if (halves.half.get(r.id) === 'held_out') x.held_out++;
        const u = halves.units.get(r.id);
        x.units.set(u, (x.units.get(u) || 0) + 1);
      }
    }
    const labels = [...byLabel.entries()].sort((a, b) => (a[0] === '(none)' ? 1 : b[0] === '(none)' ? -1 : a[0].localeCompare(b[0]))).map(([label, x]) => {
      const pmf = heldOutDistribution([...x.units.values()], s);
      const row = { label, records: x.records, held_out: x.held_out, tuning: x.records - x.held_out, expected: x.records * s,
        p_value: twoSided(pmf, x.held_out), smallest_p: smallestP(pmf) };
      rows.push(row);
      return row;
    });
    return { name: d.name, field: d.field, labels };
  });
  const level = taroneLevel(rows.map(r => r.smallest_p), ALPHA);
  for (const d of dims) {
    for (const r of d.labels) r.beyond_chance = r.smallest_p <= level && r.p_value <= level;
  }
  return {
    held_out_share: s, level, tested: rows.filter(r => r.smallest_p <= level).length,
    dimensions: dims,
    beyond_chance: dims.flatMap(d => d.labels.filter(r => r.beyond_chance).map(r => ({ dimension: d.name, ...r }))),
    none_held_out: dims.flatMap(d => d.labels.filter(r => r.held_out === 0).map(r => ({ dimension: d.name, label: r.label, records: r.records }))),
    none_tuning: dims.flatMap(d => d.labels.filter(r => r.tuning === 0).map(r => ({ dimension: d.name, label: r.label, records: r.records }))),
  };
}

// ---------- What a report shows of the held-out half ----------

// The split's settings, as reports name them.
function splitSettings(config) {
  const s = config.split;
  return { held_out_share: s.hash === 'crc32' ? 0.5 : s.held_out, hash: s.hash, salt: s.salt, by: s.by, log: s.log };
}

// The held-out half's numbers (trap O6): the headline's rates with their likely ranges, and the
// silent errors' count by severity. Never an id: listing which held-out records failed is what lets
// someone fix exactly those, and fit the held-out half instead of the workflow.
function heldOutNumbers(h) {
  const r = h.routing;
  return {
    records: r.total,
    silent_errors: { ...r.silent_errors.rate, by_severity: r.silent_errors.by_severity },
    straight_through: r.straight_through,
    silent_omissions: r.silent_omissions ? r.silent_omissions.rate : null,
    review_precision: r.review_queue.precision,
    block_precision: r.block ? r.block.precision : null,
    safeguard_failures: r.safeguard_failures.records,
    model_calls_failed: h.quality.left_out.model_failed.length,
  };
}

// The claim "shown under the target" on the held-out half (traps O7, O12, O13): k silent errors in
// the n records out without review, tested exactly (p = P(Bin(n, target) <= k), the test whatif uses
// to certify a gate), shown when p is at most this look's share of the 5% (split-log.js lookLevel).
// The same as: the exact upper bound at that share (the highest rate k of n does not rule out,
// Clopper and Pearson's one-sided bound) is at or under the target. The report shows that bound, in
// percent, beside the likely range: Wilson's range is an approximation, and at small counts its top
// can sit under the target while the exact bound does not (0 of 10: Wilson reaches 27.8%, the exact
// bound at 2.5% 30.8%).
//   level           this look's share; null when looks are not counted (no claim is made)
//   bound_pct       the exact upper bound at this share
//   why             null; "not_counted" (no split.log: no claim); "nothing_out" (no record out without
//                   review); "listed" (the records were listed at an earlier look: this look may spend
//                   nothing); "too_few" (even no silent error at all among these n could not show it at
//                   a first look: more records are needed, whatever the looks); "used_up" (a first look
//                   could have, but this look's share is too small even for no silent error)
//   records_needed  the fewest records out, none a silent error, that could show it at this share
const FIRST_LOOK = 0.025;
function heldOutClaim(rate, targetPct, level) {
  if (level === null || level === undefined) return { target_pct: targetPct, level: null, shown: false, why: 'not_counted' };
  const target = targetPct / 100;
  const none = n => Math.exp(n * Math.log1p(-target));   // p with no silent error in n
  let needed = null;
  if (level > 0) {
    needed = Math.max(1, Math.ceil(Math.log(level) / Math.log1p(-target)));
    while (needed > 1 && none(needed - 1) <= level) needed--;
    while (none(needed) > level) needed++;
  }
  const base = { target_pct: targetPct, level, tested: rate.d, silent_errors: rate.n, records_needed: needed };
  if (rate.d === 0) return { ...base, bound_pct: null, shown: false, why: 'nothing_out' };
  const p = chanceAtMost(rate.n, rate.d, target);
  const why = level === 0 ? 'listed' : none(rate.d) > FIRST_LOOK ? 'too_few' : none(rate.d) > level ? 'used_up' : null;
  return { ...base, p_value: p, bound_pct: level > 0 ? Number((exactBound(rate.n, rate.d, level) * 100).toFixed(1)) : null,
    rate_at_or_above: rate.n / rate.d >= target, shown: level > 0 && p <= level, why };
}

// The highest rate that k silent errors in n do not rule out at this share: P(Bin(n, u) <= k) = level,
// found by halving the interval (the chance falls as the rate rises).
function exactBound(k, n, level) {
  if (k >= n) return 1;
  let lo = k / n, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (chanceAtMost(k, n, mid) > level) lo = mid; else hi = mid;
  }
  return hi;
}

// Moved records (split-log.js, trap O10) set aside with --lenient: in neither half.
function setAside(halves, moved) {
  if (!moved.length) return halves;
  const out = new Set(moved);
  return { ...halves, half: new Map([...halves.half].filter(([id]) => !out.has(id))),
    tuning: halves.tuning.filter(id => !out.has(id)), held_out: halves.held_out.filter(id => !out.has(id)), set_aside: moved };
}

// ---------- Warnings and stops that name held-out records (trap O6) ----------
//
// A warning or a stop about a held-out record ("S05: codes lists D twice") names a record of the half
// a report must not list. Without --show-held-out, such names are taken out and counted instead
// ("... (1 held-out record, not named: --show-held-out names it)"), and warnings that then read the
// same are given once with their counts added. Which words are record ids is known from where each
// problem wrote them (problems.js markId), never found by searching the text: a number in a sentence
// ("12 records") is never taken for record 12, whatever the ids look like.

const { MARKS, unmark, stopsText, withMarks } = require('./problems.js');

// One text with the hidden ids' places taken out, and the comma, space or quotes that went with them.
// The kept ids are marked again, so the result knows where they are.
function rebuild(text, places, hide) {
  let out = '';
  let i = 0;
  for (const x of places) {
    out += text.slice(i, x.start) + (hide(x.id) ? '\u0001' : MARKS.OPEN + text.slice(x.start, x.end) + (text.slice(x.start, x.end) === x.id ? '' : MARKS.MID + x.id) + MARKS.CLOSE);
    i = x.end;
  }
  out += text.slice(i);
  out = out.replace(/"\u0001"/g, '\u0001').replace(/\u0001,\s*/g, '').replace(/,\s*\u0001/g, '').replace(/ \u0001/g, '').replace(/\u0001/g, '').replace(/:\s*$/, '').trimEnd();
  return unmark(out);
}

const heldNote = n => ' (' + n + ' held-out record' + (n === 1 ? '' : 's') + ', not named: --show-held-out names ' + (n === 1 ? 'it' : 'them') + ')';
// For a command without --show-held-out (check).
const plainNote = n => ' (' + n + ' held-out record' + (n === 1 ? '' : 's') + ', not named)';
// When the halves cannot be worked out (the answer key cannot be read), no record is named (trap O6).
const unknownNote = n => ' (' + n + ' record' + (n === 1 ? '' : 's') + ' not named: the answer key could not be read, so which half ' +
  (n === 1 ? 'it is' : 'each is') + ' in is not known)';
const hiding = ids => (typeof ids === 'function' ? ids : (set => id => set.has(id))(new Set(ids)));

// problems: a problems collector's items, changed in place. ids: the ids not to name (a list, or a
// test of an id). note: the words that count them.
function maskProblems(items, ids, note = heldNote) {
  const hide = hiding(ids);
  const kept = [];
  const byText = new Map();
  for (const item of items) {
    const marks = item.marks;
    const gone = marks ? new Set([...marks.where, ...marks.message].map(x => x.id).filter(hide)) : new Set();
    if (gone.size === 0) { kept.push(item); continue; }
    const w = rebuild(item.where, marks.where, hide);
    const m = rebuild(item.message, marks.message, hide);
    const masked = withMarks({ ...item, where: w.text, message: m.text }, w.ids, m.ids);
    const k = JSON.stringify([masked.level, masked.trap, masked.where, masked.message]);
    if (byText.has(k)) { byText.get(k).count += gone.size; continue; }
    byText.set(k, { item: masked, count: gone.size });
    kept.push(masked);
  }
  for (const { item, count } of byText.values()) item.message += note(count);
  items.splice(0, items.length, ...kept);
  return items;
}
// A thrown stop (problems.js throwIfStopped keeps the problems it lists), said again without the
// hidden ids. A stop that lists no problems (a log that cannot be read, say) names no record.
function maskStop(e, ids, note = heldNote) {
  if (!e || !Array.isArray(e.items)) return e;
  const items = maskProblems(e.items.slice(), ids, note);
  e.message = stopsText(items.filter(i => i.level === 'stop'));
  return e;
}
// No half known: every record id is counted, none named.
const maskAll = e => maskStop(e, () => true, unknownNote);

// The worst of several runs' held-out rates, as variance picks the worst run (runs.js): the highest
// rate as an exact fraction; on a tie, the wider range. Never the runs added together (trap I8).
function worstRun(rates, labels) {
  let worst = null;
  rates.forEach((r, i) => {
    if (r.d === 0) return;
    const w = worst === null ? null : rates[worst];
    if (w === null || r.n * w.d > w.n * r.d || (r.n * w.d === w.n * r.d && r.high_pct > w.high_pct)) worst = i;
  });
  return worst === null ? null : { run: worst + 1, label: labels[worst], ...rates[worst] };
}

const { chanceAtMost } = require('./metrics/stats.js');

module.exports = {
  crc32, sha256Point, heldOutName, unitsOf, heldOut, splitOf, balanceOf, heldOutDistribution, twoSided, smallestP, taroneLevel,
  splitSettings, heldOutNumbers, heldOutClaim, exactBound, worstRun, setAside, maskProblems, maskStop, maskAll, plainNote,
};
