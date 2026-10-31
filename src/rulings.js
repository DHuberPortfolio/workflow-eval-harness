// A person's rulings on possible key gaps (trap I7): values a workflow states that the answer
// key does not list. Each is the same mistake made every time, or a value the key is missing,
// and only a person can tell which. Kept in a file, each ruling is made once, with who made it
// and when, instead of in a notes table and again on every run (traps I11-I14).
//
//   { "rulings": [{ "id": "R2", "output": "SUBJECT", "value": "SUBJ-ANTI", "ruling": "reject",
//                   "by": "DH", "on": "2026-10-30", "note": "the article is about M&A only" }] }
//
//   add     - the value belongs in the key. For scoring it joins that record's key as a plain
//             value (one more slot to fill). The key file is never changed: every report says
//             how many values the rulings added, and from which file.
//   reject  - not a gap: the value stays wrong, and is never listed as a possible gap again.
//   pending - not decided: scored as wrong, the strict reading. score also gives the silent
//             error rate as if every pending ruling were an add (trap I15).
//
// Values are read as the key's are: trimmed, and through the config's equivalents, so a ruling
// written with an alias rules on the value the key and the predictions are read as.

const fs = require('fs');
const { problems } = require('./problems.js');
const { equivalentOf } = require('./config.js');
const { accepted } = require('./metrics/slots.js');

const RULINGS = ['add', 'reject', 'pending'];
const KEYS = ['id', 'output', 'value', 'ruling', 'by', 'on', 'note'];
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const describe = v => (v === null ? 'null' : v === undefined ? 'nothing' : Array.isArray(v) ? 'a list'
  : typeof v === 'string' ? 'the text ' + JSON.stringify(v) : typeof v);
const named = x => x.id + ' ' + x.output + ' ' + x.value;

// One entry of the file, or null after reporting why it cannot be read (I12, I13).
function readRuling(r, at, config, p) {
  if (!isObj(r)) { p.stop('I12', at, 'must be an object: { "id", "output", "value", "ruling", "by", "on" }, got ' + describe(r)); return null; }
  let ok = true;
  const bad = message => { p.stop('I12', at, message); ok = false; };
  for (const k of Object.keys(r)) if (!KEYS.includes(k)) bad('unknown key "' + k + '" (allowed: ' + KEYS.join(', ') + ')');
  // Ids are read as a record's are: text or a number, compared as trimmed text (B7, B8).
  const id = typeof r.id === 'string' || (typeof r.id === 'number' && Number.isFinite(r.id)) ? String(r.id).trim() : '';
  if (id === '') bad('needs "id": the answer key record the ruling is for');
  const o = typeof r.output === 'string' ? config.outputs[r.output] : undefined;
  if (typeof r.output !== 'string' || r.output === '') bad('needs "output": the set output the value belongs to');
  else if (!o) bad('"' + r.output + '" is not an output in the config (outputs: ' + Object.keys(config.outputs).join(', ') + ')');
  // A label has one answer per record, so a key cannot be missing one: its mistakes are wrong labels.
  else if (o.type !== 'set') bad(r.output + ' is a ' + o.type + ' output; rulings are for the values of a set output, which a key can leave out');
  const value = typeof r.value === 'string' ? r.value.trim() : '';
  if (value === '') bad('needs "value": the value ruled on, as text');
  if (!RULINGS.includes(r.ruling)) {
    // A guess at what "Add" or "accept" means could change the key, so it is never guessed.
    const near = typeof r.ruling === 'string' ? RULINGS.find(x => x === r.ruling.trim().toLowerCase()) : undefined;
    bad('ruling is ' + describe(r.ruling) + '; it must be one of: ' + RULINGS.join(', ') + (near ? ' (did you mean "' + near + '"?)' : ''));
  }
  for (const k of ['by', 'on', 'note']) if (r[k] !== undefined && r[k] !== null && typeof r[k] !== 'string') bad('"' + k + '" must be text, got ' + describe(r[k]));
  if (!ok) return null;

  if (value !== r.value) p.fix('D7', at, 'trimmed spaces from ' + JSON.stringify(r.value));
  const as = equivalentOf(config.equivalents, r.output)(value);
  if (as !== value) p.fix('D23', at, r.output + ': the ruling\'s value ' + JSON.stringify(value) + ' read as its equivalent ' + JSON.stringify(as));
  const text = k => (typeof r[k] === 'string' && r[k].trim() !== '' ? r[k].trim() : null);
  // I13: a ruling nobody can trace is what this file exists to replace.
  for (const [k, what] of [['by', 'who made it'], ['on', 'when (a date)']]) {
    if (text(k) === null) p.strict('I13', at, named({ id, output: r.output, value: as }) + ' has no "' + k + '": say ' + what + ', so the ruling can be traced');
  }
  return { id, output: r.output, value: as, ruling: r.ruling, by: text('by'), on: text('on'), note: text('note'), at };
}

// Reads and checks a rulings file against the config. Throws one error listing every stop
// (I12, and I13 in strict mode). Returns { file, list, problems }: the clean-ups and warnings
// go into each run's report. Which rulings apply to a key is decided per key: applyRulings.
function loadRulings(file, config, mode = 'strict') {
  const p = problems(mode);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    p.stop('I12', file, (e.code ? 'cannot read the rulings file: ' : 'not valid JSON: ') + e.message);
    p.throwIfStopped();
  }
  if (!isObj(raw) || !Array.isArray(raw.rulings)) {
    p.stop('I12', file, 'expected { "rulings": [...] }, got ' + (Array.isArray(raw) ? 'a list (put it inside { "rulings": ... })'
      : isObj(raw) ? 'an object with no "rulings" list' : describe(raw)));
    p.throwIfStopped();
  }
  for (const k of Object.keys(raw)) if (k !== 'rulings') p.stop('I12', file, 'unknown key "' + k + '" (allowed: rulings)');
  const list = [];
  const first = new Map();   // (id, output, value) -> where it was first ruled on
  raw.rulings.forEach((r, i) => {
    const at = file + ' rulings[' + i + ']';
    const x = readRuling(r, at, config, p);
    if (x === null) return;
    // Two rulings on one value may disagree, and which one counts would be a guess. Compared as
    // read, so an alias and its value are one value here too.
    const k = JSON.stringify([x.id, x.output, x.value]);
    if (first.has(k)) { p.stop('I12', at, 'rules on ' + named(x) + ' again (first at rulings[' + first.get(k) + ']); one ruling per value'); return; }
    first.set(k, i);
    list.push(x);
  });
  p.throwIfStopped();
  return { file, list, problems: p.items };
}

const entry = x => ({ id: x.id, output: x.output, value: x.value, by: x.by, on: x.on, note: x.note });

// Which rulings apply to this answer key (keyRecords: load.js's normalized key). Each goes to
// added, rejected or pending, or is set aside, with the reason reported in p:
//   - a record not in this key: STRICT (I13). A ruling for another key, or a typo
//   - a value the key already accepts, in any slot (an any_of alternative or an equivalent
//     counts): WARN (I14). There is nothing to add, and a reject cannot make a right value wrong
//   - an add outside the output's allowed_values: STRICT (I13). A typo would add a value nothing
//     can fill, and every run would then miss it
// The file's own clean-ups and warnings are added to p, so the run's report lists them.
function applyRulings(rulings, keyRecords, config, p) {
  p.items.push(...rulings.problems);
  const keyById = new Map(keyRecords.map(k => [k.id, k]));
  const byLower = new Map(keyRecords.map(k => [k.id.toLowerCase(), k.id]));
  const out = { file: rulings.file, added: [], rejected: [], pending: [], set_aside: [] };
  const into = { add: out.added, reject: out.rejected, pending: out.pending };
  for (const x of rulings.list) {
    const aside = why => out.set_aside.push({ ...entry(x), ruling: x.ruling, why });
    const k = keyById.get(x.id);
    if (!k) {
      const near = byLower.get(x.id.toLowerCase());
      p.strict('I13', x.at, 'record "' + x.id + '" is not in the answer key' +
        (near ? ' (did you mean "' + near + '"? Ids must match exactly)' : '') + '; a ruling is for the records of the key it was made on');
      aside('the record is not in the answer key');
      continue;
    }
    const slots = k.outputs[x.output];
    if (accepted(slots).has(x.value)) {
      const alt = !slots.includes(x.value) ? ' (an alternative in an any_of slot)' : '';
      const why = { add: 'there is nothing to add', reject: 'a reject cannot make a value the key lists wrong', pending: 'there is nothing left to decide' };
      p.warn('I14', x.at, named(x) + ' is already in the answer key' + alt + ': ' + why[x.ruling] + '. The ruling is set aside');
      aside('already in the answer key');
      continue;
    }
    const allowed = config.allowed_values[x.output];
    if (x.ruling === 'add' && Array.isArray(allowed) && !allowed.includes(x.value)) {
      p.strict('I13', x.at, 'adds ' + JSON.stringify(x.value) + ' to ' + x.id + ' ' + x.output + ', which is not in allowed_values.' + x.output +
        ': a typo would add a value nothing can fill');
      aside('not an allowed value');
      continue;
    }
    into[x.ruling].push(entry(x));
  }
  return out;
}

// Paired records (align.js) with values added to their key, each as a plain value: one more
// slot. New objects, so the records read from the files stay as they were.
function addToKey(records, list) {
  if (list.length === 0) return records;
  const byId = new Map();
  for (const x of list) byId.set(x.id, [...(byId.get(x.id) || []), x]);
  return records.map(r => {
    const mine = byId.get(r.id);
    if (!mine) return r;
    const key = { ...r.key };
    for (const x of mine) key[x.output] = [...key[x.output], x.value];
    return { ...r, key };
  });
}

// Possible key gaps with their rulings. A rejected one is dropped and counted: it was ruled not
// a gap, so listing it again would ask the same question on every run. A pending one carries who
// and when; the rest are unruled. An added value is in the key now, so it is never a candidate.
function annotateGaps(candidates, ruled) {
  const k = x => JSON.stringify([x.id, x.output, x.value]);
  const rejected = new Set(ruled.rejected.map(k));
  const pending = new Map(ruled.pending.map(x => [k(x), x]));
  const kept = candidates.filter(c => !rejected.has(k(c)));
  return {
    candidates: kept.map(c => {
      const x = pending.get(k(c));
      return x ? { ...c, ruling: 'pending', by: x.by, on: x.on, note: x.note } : { ...c, ruling: 'unruled' };
    }),
    rejected: candidates.length - kept.length,
  };
}

module.exports = { loadRulings, applyRulings, addToKey, annotateGaps, RULINGS };
