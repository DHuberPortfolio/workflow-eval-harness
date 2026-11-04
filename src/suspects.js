// wfeval suspects: the answer-key entries most likely wrong, ranked for a person to rule on (traps
// N1-N19; the evidence and the ranking are in metrics/suspects.js).
//
// Every run is scored against the same key, as score does, rulings included: what a person has
// ruled add, remove or replace is in the key in use, so the evidence for every other suspect reads
// the key as ruled. A suspect ruled before (reject, keep, or a change already made) is never listed
// again, only counted; a pending one is listed with who and when.
//
// With a split in the config (traps O21-O24), and only when the caller asks for it (applySplit, as
// score), the held-out records are left out altogether: never listed, and never read as evidence
// for the tuning half's suspects (their answers would move every weight). A record's half is decided
// as score decides it (scoreRun: a duplicate with its primary, a cluster whole), its problems and
// stops are masked as score masks them, and the records that changed half since an earlier look are
// checked before anything is shown (O10). showHeldOut lists them too, as without a split; with look
// (the CLI) and a split.log, that is recorded as a look whose ids were shown, so later claims on
// those records spend nothing (O13). Without showHeldOut nothing of the held-out half is shown, so
// nothing is recorded.

const { fingerprint } = require('./hash.js');
const { addNew, problems } = require('./problems.js');
const { acrossFiles } = require('./load.js');
const { scoreRun } = require('./score.js');
const { suspectsOf, keyLeavesOut } = require('./metrics/suspects.js');
const { splitSettings } = require('./split.js');
const { commitLook, notRecorded } = require('./split-log.js');

const KINDS = ['key_lacks', 'key_lists', 'label'];

// The records a run gives evidence from: every record; with a split, the tuning half's (scoreRun's
// paired records), or with showHeldOut both halves'. Records set aside (O10, --lenient) are in neither.
function recordsOf(results, showHeldOut) {
  const s = results.split;
  if (!s || !showHeldOut) return results.paired;
  const aside = new Set(s.moved);
  return s.every.filter(r => !aside.has(r.id));
}

// predPaths: one or more runs. rulings: a rulings file read by loadRulings, or null.
// applySplit, look, showHeldOut, now: with config.split only (above). lookOptions: what changes which
// suspects a look lists (the CLI's --top, or all with --json), part of the look's identity (O8).
function suspectsRun({ config, keyPath, predPaths, mode = 'strict', rulings = null,
  applySplit = false, look = false, showHeldOut = false, now = undefined, lookOptions = {} }) {
  // N1: a disagreement needs at least one run to disagree.
  if (predPaths.length === 0) throw new Error('[N1] suspects needs one or more runs (prediction files) after its options');
  const split = Boolean(applySplit && config.split);
  const notes = [];
  // N2: one run twice would read as two runs agreeing ("2 of 2 say it"). Read once, and said.
  const seen = new Map();
  const used = [];
  for (const f of predPaths) {
    const h = fingerprint(f);
    if (seen.has(h)) notes.push({ level: 'fix', trap: 'N2', where: f, message: 'has exactly the same content as ' + seen.get(h) + ': read once, so one run is not counted as two that agree' });
    else { seen.set(h, f); used.push(f); }
  }
  // With a split, scoreRun draws the halves, checks the log for moved records, and masks every
  // problem and stop that names a held-out record (unless showHeldOut).
  const keys = new Map();
  const files = acrossFiles();
  const runs = used.map(f => {
    const results = scoreRun({ config, predPath: f, keyPath, mode, rulings, applySplit: split, showHeldOut, parts: 'paired', keys, across: files });
    return { label: f, results, records: recordsOf(results, showHeldOut) };
  });
  const fields = problems(mode);
  files.report(fields);
  fields.throwIfStopped();
  addNew(notes, fields.items);
  // N15 (as I6): a record whose model call failed gives no evidence from that run. Read from the
  // records that give evidence: with a split, a held-out record's failure is left out with it.
  for (const r of runs) {
    const failed = r.records.filter(x => !x.scored).map(x => x.id);
    if (failed.length) {
      notes.push({ level: 'warn', trap: 'N15', where: r.label, message: failed.length + ' model call(s) failed in this run; those records give no evidence from it: ' +
        failed.slice(0, 12).join(' ') + (failed.length > 12 ? ' +' + (failed.length - 12) + ' more' : '') });
    }
  }
  // The run's own clean-ups and warnings (the first run's, which every run shares for the key and the
  // rulings file; the others' are their own).
  addNew(notes, runs.flatMap(r => r.results.problems.filter(x => x.level !== 'stop')));

  const all = suspectsOf(runs.map(r => r.records), config);
  // With a split, results.rulings holds the tuning half's rulings only (score counts the rest);
  // showHeldOut lists the held-out half's suspects, so it reads every ruling.
  const first = runs[0].results;
  const ruled = !rulings ? null : split && showHeldOut ? first.split.ruled : first.rulings;
  const status = ruled ? rulingStatus(ruled, config) : null;
  const listed = [];
  let notListed = 0;
  for (const s of all) {
    const st = status ? status(s) : null;
    if (st && st.ruling !== 'pending' && st.ruling !== 'set aside') { notListed++; continue; }
    // A ruling set aside (N12) decided nothing for this key: the suspect is listed, saying so.
    const ruling = !status ? {} : !st ? { ruling: 'unruled' } : { ruling: st.ruling, by: st.by, on: st.on, note: st.note,
      ...(st.ruling === 'set aside' ? { set_aside: { ruling: st.made, why: st.why } } : {}) };
    listed.push({ rank: listed.length + 1, ...s, ...ruling });
  }
  const counts = Object.fromEntries(KINDS.map(k => [k, listed.filter(s => s.kind === k).length]));
  // N8: the records the answer key blocks or suppresses, left out as suspects and as evidence: a
  // count only (with a split, of the records shown, so a held-out record is never counted here).
  const keyLeft = runs[0].records.filter(keyLeavesOut(config)).length;
  return {
    kind: 'suspects',
    inputs: { key: keyPath, runs: used, mode, ...(rulings ? { rulings: rulings.file } : {}) },
    runs: used.length,
    suspects: listed,
    counts: { ...counts, total: listed.length },
    ...(keyLeft ? { key_leaves_out: keyLeft } : {}),
    ...(rulings ? { rulings: { ...summary(ruled), not_listed: notListed } } : {}),
    // ---- split: the halves in numbers, and the look when the held-out records were listed. The log
    // records which held-out records this report lists (the suspects shown: --top's, or all with
    // --json), so later claims spend nothing on those, and only those (trap O13).
    ...(split ? { split: splitPart({ first, config, keyPath, used, rulings, look, showHeldOut, now, mode, lookOptions,
      shown: listed.slice(0, typeof lookOptions.listed === 'number' ? lookOptions.listed : undefined).map(s => s.id) }) } : {}),
    problems: notes,
  };
}

// The split in numbers (trap O21): how many records each half has, how many held-out records were
// left out (none with showHeldOut), the records set aside (O10), the rulings on held-out records
// (counted, never named), and the look: null when nothing of the held-out half was shown. The halves
// are the same in every run (a record's unit is on the key's side), so the first run's are read.
// The look is recorded after every run was scored (each run's moved-record check passed) and before
// anything is shown: a look that cannot be recorded (O17) stops the command.
function splitPart({ first, config, keyPath, used, rulings, look, showHeldOut, now, mode, lookOptions, shown }) {
  const s = first.split;
  const held = s.halves.held_out.length;
  let lk = null;
  if (showHeldOut) {
    const identity = { command: 'suspects', files: { runs: used, key: keyPath, rulings: rulings ? rulings.file : null }, options: lookOptions };
    lk = look ? commitLook({ config, identity, halves: s.halves, moved: s.moved, idsShown: shown, mode, now }) : notRecorded(config, s.halves, true);
  }
  return {
    ...splitSettings(config),
    tuning: { records: s.halves.tuning.length },
    held_out: { records: held, left_out: showHeldOut ? 0 : held },
    set_aside: s.moved.length,
    ...(s.rulings && !showHeldOut ? { rulings: s.rulings } : {}),
    look: lk,
  };
}

// The ruling on a suspect's entry, if any (N14): a set value by (record, output, value), a label by
// (record, output). A ruling set aside (N12: made on another version of the key) took no effect,
// so its suspect is still listed, as "set aside"; --write-rulings puts the new pending ruling in its
// place (N10), as the file may hold one ruling per entry only (I12).
// A label's ruling is found by record and output alone: a record has one label, and after a
// replace the key's label is the ruling's "with", not its value.
const entryKey = (x, isSet) => JSON.stringify(isSet ? [x.id, x.output, x.value] : [x.id, x.output]);
function rulingStatus(ruled, config) {
  const key = x => entryKey(x, config.outputs[x.output].type === 'set');
  const byEntry = new Map();
  for (const [list, ruling] of [[ruled.added, 'add'], [ruled.rejected, 'reject'], [ruled.removed, 'remove'], [ruled.kept, 'keep'],
    [ruled.replaced, 'replace'], [ruled.pending, 'pending']]) {
    for (const x of list || []) byEntry.set(key(x), { ...x, ruling });
  }
  for (const x of ruled.set_aside) byEntry.set(key(x), { ...x, ruling: 'set aside', made: x.ruling });
  return s => byEntry.get(key(s)) || null;
}

const summary = r => {
  const { if_pending_added, ...rest } = r;
  return rest;
};

// --write-rulings (N10): every ruling of the --rulings file as written, then one pending ruling for
// each suspect listed in the report that has none yet, with by and on left empty for the person to
// fill in. A suspect whose ruling was set aside gets its pending ruling in that ruling's place, with
// a note saying what it replaces: two rulings on one entry would stop the file (I12). Returns the
// text and the counts, or null when there is nothing new to write.
function rulingsText(results, rulings, top) {
  const shown = results.suspects.slice(0, top).filter(s => s.ruling === undefined || s.ruling === 'unruled' || s.ruling === 'set aside');
  if (shown.length === 0) return null;
  const entries = rulings ? rulings.entries.slice() : [];
  const appended = [];
  let replaced = 0;
  for (const s of shown) {
    const e = { id: s.id, output: s.output, value: s.value, ruling: 'pending' };
    if (s.kind === 'key_lists') e.proposed = 'remove';
    if (s.kind === 'label') e.with = s.with;
    Object.assign(e, { by: '', on: '' });
    if (s.ruling !== 'set aside') { appended.push(e); continue; }
    const old = rulings.list.find(x => entryKey(x, !x.label) === entryKey(s, s.kind !== 'label'));
    const who = [s.by, s.on].filter(Boolean).join(', ');
    e.note = 'in place of ' + (/^[aeiou]/.test(s.set_aside.ruling) ? 'an ' : 'a ') + s.set_aside.ruling + ' ruling' + (who ? ' (' + who + ')' : '') +
      ' set aside: ' + s.set_aside.why;
    entries[old.index] = e;
    replaced++;
  }
  const line = o => '{ ' + Object.entries(o).map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(', ') + ' }';
  const all = [...entries, ...appended];
  return { text: '{ "rulings": [\n' + all.map(e => '  ' + line(e)).join(',\n') + '\n] }\n', fresh: shown.length, replaced,
    carried: rulings ? rulings.entries.length - replaced : 0 };
}

module.exports = { suspectsRun, rulingsText };
