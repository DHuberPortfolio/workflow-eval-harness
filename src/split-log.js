// Counting the looks at the held-out half (config.split.log; traps O7-O14, O17).
//
// Every report that shows held-out numbers uses that half up a little: the more often it has been
// looked at, the more likely one look's good news is luck, and the more an analyst who keeps what
// the held-out numbers liked has fitted the half rather than the workflow. So a claim made on the
// held-out half ("shown under the target") may use only a share of the 5% allowed for being wrong:
//
//   each look gets half of what the looks before it left: 2.5% at the first, 1.25% at the second,
//   0.625% at the third, and so on. All the looks together never use more than 5%.
//
// What is proven, and what is not. If no version tested was chosen using held-out numbers (only
// the tuning half, and the yes or no of earlier claims), the chance of any false "shown", over
// every look, is at most 5%: the shares add up to less than 5% (a union bound). An analyst who sees
// the held-out rates and keeps what they liked breaks that argument: each look shows a count, not
// just a yes or no. For that case there is no proof, only scripts/split-sim.js: halving held a
// false "shown" under 5% against every adaptive attack simulated (keeping changes that lowered the
// held-out count; Blum and Hardt's boosting attack; adaptive group testing that finds the held-out
// errors and holds them), at targets of 1-30%, where declared budgets and 1/k^2 sequences did not.
// docs/METRICS.md has the tables. Without a log no look is counted, so no claim is made at all.
//
// What counts as a look, and as the same look:
//   - one report (score, compare, variance, or whatif with a held-out row) that shows numbers from
//     the held-out half, whether or not it makes a claim: numbers shown are what an analyst fits to;
//   - the same command, on the same files (fingerprints of the predictions, the key, and any rulings
//     or policies file), with the same config (every setting, after --group-by and --cluster-by),
//     the same mode (strict or --lenient) and, for whatif, the same options shows the same numbers
//     again, so it is not a new look: the report says which look it repeats (trap O8);
//   - a look with --show-held-out lists the held-out records. After it, claims on the records it
//     listed may spend nothing: they could be fixed one by one (trap O13).
//
// Records added later (a golden set that grows) have had no look. The log keeps the look at which
// each held-out record was first shown, so the newest batch of held-out records gets a claim of its
// own, counted from its first look: what "add fresh records" means when a held-out half is used up.
// Each batch spends its own 5%.
//
// The log also keeps the look at which each tuning record was first seen. A record that changed half
// since (its cluster or primary changed, an id was reused), in either direction, stops a strict run:
// one tuned on would flatter the held-out half, and one held out, now shown in the tuning half, would
// reveal what it held (trap O10). With --lenient it is set aside, in neither half, listed under
// "moved" in the log, never written as held out and never counted as fresh.
//
// Several runs at once (trap O17): the log is read, changed and written under a lock file beside it
// (<log>.lock, created only if absent), and written to a temporary file that then replaces it, so no
// look is lost and no two reports claim the same look number.

const fs = require('fs');
const { readText } = require('./text.js');
const { maxOf, minOf } = require('./values.js');
const { sha256: hash, fingerprint: fingerprintFile } = require('./hash.js');

const FORMAT = 'wfeval-split-log/1';
const ALPHA = 0.05;

// The share of the 5% look k (1, 2, 3, ...) may use: half of what the looks before it left.
const lookLevel = (k, alpha = ALPHA) => alpha / Math.pow(2, k);

const sha256 = data => hash(data).digest('hex');
const isPlain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
// A log keeps records by id, and an id named __proto__ is an id like any other (trap P14).
const setOwn = (obj, key, value) => Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });

// Any value as JSON with every object's keys in order, so the same settings always read the same.
function canonical(x) {
  if (Array.isArray(x)) return x.map(canonical);
  if (isPlain(x)) return Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])]));
  return x;
}

// Every setting of the loaded config, except where the log is kept (moving the log changes no number).
function configFingerprint(config) {
  const { split, ...rest } = config;
  const s = split ? { held_out: split.held_out, salt: split.salt, hash: split.hash, by: split.by } : null;
  return sha256(JSON.stringify(canonical({ ...rest, split: s })));
}

// The settings that decide which half each record is in (trap O9): the split's own, and what makes a
// record's unit (its id, its cluster, its primary). A log for other settings counts another split.
const splitKey = config => ({
  held_out: config.split.held_out, salt: config.split.salt, hash: config.split.hash, by: config.split.by,
  id_field: config.id_field, clusters: config.clusters ? { field: config.clusters.field, from: config.clusters.from } : null,
  duplicate_of_field: config.duplicate_of_field,
});
const logFile = config => config.split.log_path || config.split.log || null;
const emptyLog = config => ({ format: FORMAT, split: splitKey(config), looks: [], listings: [], moved: {}, records: { held_out: {}, tuning: {} } });

// Windows can refuse a file for a moment while another process replaces it: try again, briefly.
const PAUSE = new Int32Array(new SharedArrayBuffer(4));
const pause = ms => Atomics.wait(PAUSE, 0, 0, ms);
function retry(fn) {
  for (let i = 0; ; i++) {
    try { return fn(); } catch (e) {
      if (i >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      pause(25);
    }
  }
}

// The log, or null when the file does not exist yet. Stops on a file that is not a split log (trap
// O11) and on a log written for other settings (trap O9).
function readLog(file, config) {
  if (!fs.existsSync(file)) return null;
  let log;
  // Its name comes from the config, so the error never quotes what the file holds (trap P39).
  try { log = JSON.parse(retry(() => readText(file)).replace(/^﻿/, '')); } catch (e) {
    throw new Error('[O11] split.log ' + file + ' is not valid JSON' + (e.code ? ' (' + e.message + ')' : '') + '. It counts the looks at the held-out half: restore it rather than start a new one');
  }
  const ok = isPlain(log) && log.format === FORMAT && Array.isArray(log.looks) && log.looks.every(isPlain) && isPlain(log.records) &&
    isPlain(log.records.held_out) && isPlain(log.records.tuning) && (log.listings === undefined || (Array.isArray(log.listings) && log.listings.every(isPlain))) &&
    (log.moved === undefined || isPlain(log.moved));
  if (!ok) throw new Error('[O11] split.log ' + file + ' is not a split log (format ' + FORMAT + ', with each record\'s first look kept by id)');
  const want = splitKey(config);
  if (JSON.stringify(canonical(log.split || {})) !== JSON.stringify(canonical(want))) {
    throw new Error('[O9] split.log ' + file + ' was written for the split ' + JSON.stringify(log.split) + ', and the config now says ' + JSON.stringify(want) +
      '. Changing what decides the halves after looking moves records between them. Keep the settings; a new split goes with a new golden set and a new log');
  }
  if (!log.listings) log.listings = [];
  if (!log.moved) log.moved = {};
  return log;
}

// Records that changed half since the log first saw them, either way, and the ones it lists as moved.
function movedRecords(log, halves) {
  if (!log) return { into_held: [], into_tuning: [], listed: [] };
  const was = (id, side) => Object.hasOwn(log.records[side], id);
  const listed = id => Object.hasOwn(log.moved, id);
  return {
    into_held: halves.held_out.filter(id => !listed(id) && was(id, 'tuning') && !was(id, 'held_out')),
    into_tuning: halves.tuning.filter(id => !listed(id) && was(id, 'held_out') && !was(id, 'tuning')),
    listed: [...halves.held_out, ...halves.tuning].filter(listed),
  };
}

// Before anything is scored: read the log (read only) and find the records that changed half (trap
// O10). Strict mode stops; --lenient warns, and the caller sets those records aside. null without a log.
// beforeStop(ids): called with those records before the stop is reported (scoreRun masks them: O6).
function prepareLook({ config, halves, p, beforeStop = () => {} }) {
  const file = logFile(config);
  if (!file) return null;
  const log = readLog(file, config);
  const m = movedRecords(log, halves);
  const moved = [...m.into_held, ...m.into_tuning, ...m.listed];
  if (moved.length && p) {
    const parts = [m.into_held.length ? m.into_held.length + ' record(s) held out now were in the tuning half at an earlier look, so were tuned on' : null,
      m.into_tuning.length ? m.into_tuning.length + ' record(s) in the tuning half now were held out at an earlier look, and would show what they held' : null,
      m.listed.length ? m.listed.length + ' record(s) the log lists as moved' : null].filter(Boolean);
    p.strict('O10', config.split.log, parts.join('; ') + ' (their cluster or primary changed, or an id was reused). Put them back as they were, ' +
      'or leave them out of the golden set; with --lenient they are set aside, in neither half');
    beforeStop(moved);
    p.throwIfStopped();
  }
  return { file, moved };
}

// Runs fn holding <log>.lock, created only if it does not exist (trap O17). Waits for another run's
// lock a few seconds, then stops. The wait can be shortened for tests (WFEVAL_LOCK_WAIT_MS).
function withLock(file, fn) {
  const lock = file + '.lock';
  const deadline = Date.now() + (Number(process.env.WFEVAL_LOCK_WAIT_MS) || 5000);
  let fd;
  for (;;) {
    try { fd = fs.openSync(lock, 'wx'); break; } catch (e) {
      if (e.code !== 'EEXIST' && !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw notWritable(file, e);
      if (Date.now() >= deadline) {
        if (!fs.existsSync(lock)) throw notWritable(file, e);   // no lock there: the folder refused a new file
        throw new Error('[O17] split.log is locked: ' + lock + ' exists. Another run is writing the log, or one stopped part-way: ' +
          'if no other run is going, delete ' + lock + ' and run again');
      }
      pause(20);
    }
  }
  try { return fn(); } finally {
    fs.closeSync(fd);
    try { retry(() => fs.unlinkSync(lock)); } catch (e) { /* gone already */ }
  }
}

// Written whole to a temporary file that then replaces the log, so a reader never sees half of it.
function writeLog(file, log) {
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(log, null, 2) + '\n');
    retry(() => fs.renameSync(tmp, file));
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* it never came to be */ }
    throw notWritable(file, e);
  }
}
// A log that cannot be written: the look is not counted, so nothing is claimed on it (trap P30).
const notWritable = (file, e) => new Error('[O17] split.log cannot be written: ' + file + ' (' + e.code + '). This look is not counted. Make the file and its folder writable, and run again');

// identity: { command, files: { name: path or [paths] }, options }. With the config's fingerprint
// and the mode, the fingerprint of what a look shows.
function identityOf(identity, config, mode) {
  const files = {};
  for (const [name, f] of Object.entries(identity.files)) {
    if (f === null || f === undefined) continue;
    files[name] = Array.isArray(f) ? f.map(fingerprintFile) : fingerprintFile(f);
  }
  const cfg = configFingerprint(config);
  return { command: identity.command, files, config: cfg, mode,
    id: sha256(JSON.stringify(canonical({ command: identity.command, files, options: identity.options || {}, config: cfg, mode }))) };
}

// Which looks were at a record, and which listings showed it (trap O13). Each look keeps the held-out
// records it was at (held_out_ids), and each listing the held-out records it showed (ids). A log
// written before they were kept counts every record first seen at or before that look.
const firstSeen = (log, id) => (Object.hasOwn(log.records.held_out, id) ? log.records.held_out[id] : Infinity);
function lookWasAt(log, entry, ids) {
  if (Array.isArray(entry.held_out_ids)) { const at = new Set(entry.held_out_ids); return ids.some(id => at.has(id)); }
  return ids.some(id => firstSeen(log, id) <= entry.look);
}
function listingShowed(log, listing, ids) {
  if (Array.isArray(listing.ids)) { const shown = new Set(listing.ids); return ids.some(id => shown.has(id)); }
  return ids.some(id => firstSeen(log, id) <= listing.covers);
}
// For a claim on these records at look t: how many looks up to t were at any of them (this one
// included), and the latest look whose listing, made before t, showed any of them (null if none).
function lookCount(log, ids, t) {
  return log.looks.filter(l => l.look <= t && lookWasAt(log, l, ids)).length;
}
function listedAt(log, ids, t) {
  const hits = log.listings.filter(l => l.after < t && listingShowed(log, l, ids)).map(l => l.covers);
  return hits.length ? maxOf(hits) : null;
}

// Records a look (or finds the same look again) and says what each claim may spend.
//   config      with config.split (and split.log_path, set by loadConfig)
//   identity    see identityOf; mode: "strict" or "lenient"
//   halves      the held-out and tuning ids, with any moved records already set aside
//   moved       the moved records set aside (lenient), listed in the log, never written to a half
//   idsShown    the held-out records this report lists (--show-held-out): true for every one of
//               them, or a list of ids (suspects lists only its suspects); false for none
//   now         the date to record (tests pass a fixed one)
// Returns, for the report:
//   counted     whether looks are counted (a log is configured); without one, no claim is made
//   log         the log as the config names it; new_log: this look started it (no file was found)
//   look        this look's number in the log; repeat: { look, date } when it repeats one
//   half        { look, level, records }: how many looks were at the held-out half (this one
//               included), and the share a claim on it may use
//   batch       the newest batch of held-out records, when it is not the whole half:
//               { since, look, level, records, ids }; look counts only the looks that were at
//               them; ids are kept out of reports and JSON
//   fresh       held-out records with no look before this one
//   listed_at   the look whose listing (of some of the half's records) makes a claim on the
//               whole half spend nothing, if any
function commitLook({ config, identity, halves, moved = [], idsShown = false, mode = 'strict', now = new Date() }) {
  const file = logFile(config);
  if (!file) return notRecorded(config, halves, idsShown);
  const heldIds = halves.held_out;
  const heldSet = new Set(heldIds);
  const shown = idsShown === true ? heldIds : Array.isArray(idsShown) ? idsShown.filter(id => heldSet.has(id)) : [];
  return withLock(file, () => {
    let log = readLog(file, config);
    const started = !log;
    if (!log) log = emptyLog(config);
    const who = identityOf(identity, config, mode);
    const date = now.toISOString();
    const seenIn = log.records;
    let entry = log.looks.find(l => l.identity === who.id);
    let repeat = null;
    if (entry) {
      repeat = { look: entry.look, date: entry.date };
      // The same look again, now listing records: it shows the same, but every look made from now
      // on comes after the listing.
      if (shown.length && !entry.ids_shown) {
        entry.ids_shown = true;
        entry.ids_shown_on = date;
        log.listings.push({ after: log.looks.length, covers: entry.look, date, ids: shown });
      }
    } else {
      entry = {
        look: log.looks.length + 1, date, command: who.command, ...who.files, config: who.config, mode,
        identity: who.id, held_out_records: heldIds.length, ids_shown: shown.length > 0, held_out_ids: heldIds,
      };
      log.looks.push(entry);
      if (shown.length) log.listings.push({ after: entry.look, covers: entry.look, date, ids: shown });
      for (const id of heldIds) if (!Object.hasOwn(seenIn.held_out, id)) setOwn(seenIn.held_out, id, entry.look);
      for (const id of halves.tuning) if (!Object.hasOwn(seenIn.tuning, id)) setOwn(seenIn.tuning, id, entry.look);
    }
    for (const id of moved) if (!Object.hasOwn(log.moved, id)) setOwn(log.moved, id, entry.look);
    const t = entry.look;
    // A record's first look; a record first seen after the look being repeated cannot be in it.
    const first = id => Math.min(firstSeen(log, id), t);
    const firsts = heldIds.map(first);
    const oldest = firsts.length ? minOf(firsts) : t;
    const newest = firsts.length ? maxOf(firsts) : t;
    // A claim on these records: no share once any of them was listed before this look; otherwise
    // the share for the number of looks that were at them.
    const claimOn = ids => {
      const listed = listedAt(log, ids, t);
      const k = Math.max(1, lookCount(log, ids, t));
      return { look: k, level: listed !== null ? 0 : lookLevel(k), listed };
    };
    const whole = claimOn(heldIds);
    const half = { look: whole.look, level: whole.level, records: heldIds.length };
    let batch = null;
    if (newest > oldest) {
      const ids = heldIds.filter((id, i) => firsts[i] === newest);
      const b = claimOn(ids);
      batch = { since: newest, look: b.look, level: b.level, records: ids.length };
      Object.defineProperty(batch, 'ids', { value: ids, enumerable: false });
    }
    writeLog(file, log);
    return {
      counted: true, log: config.split.log, new_log: started, look: t, repeat, half, batch,
      fresh: firsts.filter(x => x === t && !repeat).length, listed_at: whole.listed, ids_shown: shown.length > 0, set_aside: moved.length,
    };
  });
}

// What the next look at the held-out half would be, read from the log without changing it (score,
// compare, variance and whatif without --held-out, and check). heldIds: the held-out half's ids,
// or null when only the log is known. counted: false without split.log.
function lookStatus(config, heldIds = null) {
  const file = logFile(config);
  if (!file) return { counted: false, log: null, looks: null, next: null };
  const log = readLog(file, config);
  if (!log) return { counted: true, log: config.split.log, exists: false, looks: 0, next: { look: 1, level: lookLevel(1), listed_at: null } };
  const t = log.looks.length + 1;
  if (heldIds === null) return { counted: true, log: config.split.log, exists: true, looks: log.looks.length, next: null };
  const k = lookCount(log, heldIds, t) + 1;
  const listed = listedAt(log, heldIds, t);
  return { counted: true, log: config.split.log, exists: true, looks: lookCount(log, heldIds, t), next: { look: k, level: listed !== null ? 0 : lookLevel(k), listed_at: listed } };
}

// A look that is not recorded: no split.log in the config ("no_log"), or a library call that did not
// ask for one ("not_recorded"). No claim is made on it (trap O12): looks that are not counted could be
// repeated without end.
function notRecorded(config, halves, idsShown = false) {
  return {
    counted: false, reason: config.split.log ? 'not_recorded' : 'no_log', look: null, repeat: null,
    half: { look: null, level: null, records: halves.held_out.length }, batch: null, fresh: null, listed_at: null, ids_shown: idsShown,
  };
}

module.exports = { lookLevel, prepareLook, commitLook, lookStatus, notRecorded, readLog, identityOf, configFingerprint, fingerprintFile, FORMAT };
