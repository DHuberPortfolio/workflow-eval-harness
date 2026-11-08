// A reviewer's rulings on possible key gaps (trap I7): values a workflow states that the answer
// key does not list. Each is the same mistake made every time, or a value the key is missing,
// and the numbers alone cannot tell which: a reviewer does, a person or an AI judge
// (reviewer_kind, section Q of test/TRAPS.md). Kept in a file, each ruling is made once, with who made it
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
//
// Answer-key suspects (wfeval suspects, traps N11-N14) also question what the key holds:
//   remove  - a set value the key lists is wrong: for scoring it leaves that record's key.
//   keep    - the key is right: a set value it lists, or its label, stays, and is not asked again.
//   replace - a label is wrong: for scoring the key's label (value) becomes "with".
//   pending - for a value the key lists, with "proposed": "remove"; for a label, with "with":
//             scored as the key stands; score gives the rate as if made, too (trap I15).
// A plain pending, or "proposed": "add", is the possible key gap it always was.

const { problems, markId } = require('./problems.js');
const { readText } = require('./text.js');
const { equivalentOf, DECLINED, FREE_TYPES } = require('./config.js');
const { accepted } = require('./metrics/slots.js');
const { isObj, describe, own, addAll } = require('./values.js');

const RULINGS = ['add', 'reject', 'pending', 'remove', 'keep', 'replace'];
const KEYS = ['id', 'output', 'value', 'ruling', 'by', 'on', 'note', 'with', 'proposed', 'reviewer_kind'];
// Left out, a ruling is a person's. An AI judge's is marked, so that every report can count it
// apart and take it back out (Q1-Q5).
const REVIEWER_KINDS = ['person', 'judge'];
// The verbs that fit each kind of output (N11): a set value the key lacks, add or reject; one it
// lists, remove or keep; a label, replace or keep. pending for any.
const LABEL_RULINGS = ['replace', 'keep', 'pending'];
const PROPOSED = ['add', 'remove'];
// A file that uses none of what suspects added reads, and reports, exactly as before.
const isNew = x => ['remove', 'keep', 'replace'].includes(x.ruling) || x.with !== undefined || x.proposed !== undefined;
const named = x => markId(x.id) + ' ' + x.output + ' ' + x.value;   // the id marked: see problems.js

// "a label output", "an ordinal output".
const article = type => (/^[aeiou]/.test(type) ? 'an ' : 'a ') + type;

// One entry of the file, or null after reporting why it cannot be read (I12, I13).
function readRuling(r, at, config, p) {
  if (!isObj(r)) { p.stop('I12', at, 'must be an object: { "id", "output", "value", "ruling", "by", "on" }, got ' + describe(r)); return null; }
  let ok = true;
  const bad = message => { p.stop('I12', at, message); ok = false; };
  for (const k of Object.keys(r)) if (!KEYS.includes(k)) bad('unknown key "' + k + '" (allowed: ' + KEYS.join(', ') + ')');
  // Ids are read as a record's are: text or a number, compared as trimmed text (B7, B8).
  const id = typeof r.id === 'string' || (typeof r.id === 'number' && Number.isFinite(r.id)) ? String(r.id).trim() : '';
  if (id === '') bad('needs "id": the answer key record the ruling is for');
  const o = typeof r.output === 'string' ? own(config.outputs, r.output) : undefined;
  if (typeof r.output !== 'string' || r.output === '') bad('needs "output": the set output the value belongs to');
  else if (!o) bad('"' + r.output + '" is not an output in the config (outputs: ' + Object.keys(config.outputs).join(', ') + ')');
  // A label that is also the route is judged as the route; no ruling changes where a record should go (N16).
  else if (o.type !== 'set' && o.field === config.routing.field) {
    bad(r.output + ' is the route (routing.field): a wrong route is judged by the routing types, and no ruling changes the answer key\'s route');
  } else if (FREE_TYPES.includes(o.type)) {
    // A ruling names a label or a set value; a free answer (F15) has neither, so none is guessed at.
    bad(r.output + ' is a free ' + o.type + ' answer: rulings do not cover number or text outputs yet; correct the answer key itself');
  }
  const value = typeof r.value === 'string' ? r.value.trim() : '';
  if (value === '') bad('needs "value": the value ruled on, as text');
  if (!RULINGS.includes(r.ruling)) {
    // A guess at what "Add" or "accept" means could change the key, so it is never guessed.
    const near = typeof r.ruling === 'string' ? RULINGS.find(x => x === r.ruling.trim().toLowerCase()) : undefined;
    bad('ruling is ' + describe(r.ruling) + '; it must be one of: ' + RULINGS.join(', ') + (near ? ' (did you mean "' + near + '"?)' : ''));
  }
  for (const k of ['by', 'on', 'note', 'with', 'proposed']) if (r[k] !== undefined && r[k] !== null && typeof r[k] !== 'string') bad('"' + k + '" must be text, got ' + describe(r[k]));
  if (r.reviewer_kind !== undefined && !REVIEWER_KINDS.includes(r.reviewer_kind)) bad('reviewer_kind is ' + describe(r.reviewer_kind) + '; it must be one of: ' + REVIEWER_KINDS.join(', ') + ' (left out, it means person)');
  const label = o && o.type !== 'set' && o.field !== config.routing.field;
  const read = equivalentOf(config.equivalents, typeof r.output === 'string' ? r.output : '');
  // N11: what --write-rulings writes, with "pending" changed to the ruling and nothing else, leaves
  // a pending's "proposed" (set values) or "with" (labels, under keep) behind. The ruling itself
  // says what was decided, so the leftover is dropped and the report says so; a verb is never guessed.
  const leftover = (k, why) => { if (ok) p.fix('N11', at, 'dropped "' + k + '": ' + JSON.stringify(r[k]) + ': ' + why); };
  let dropWith = false;
  let dropProposed = false;
  if (label && r.ruling === 'keep' && typeof r.with === 'string') {
    dropWith = true;
    leftover('with', 'a keep ruling leaves the label as the answer key has it');
  }
  if (o && o.type === 'set' && RULINGS.includes(r.ruling) && r.ruling !== 'pending' && typeof r.proposed === 'string') {
    dropProposed = true;
    leftover('proposed', 'it goes with pending only; the ruling, ' + r.ruling + ', says what was decided');
  }
  const withValue = typeof r.with === 'string' && !dropWith ? read(r.with.trim()) : undefined;
  if (ok && RULINGS.includes(r.ruling)) {
    // N11: a verb that does not fit the output, or "with" and "proposed" where they mean nothing.
    // Each would be a guess at what the ruling changes in the key.
    if (label) {
      const isLabel = l => o.labels.map(String).includes(l);
      if (!LABEL_RULINGS.includes(r.ruling)) {
        bad(r.output + ' is ' + article(o.type) + ' output: its rulings are replace (with "with", the label the answer key should say), keep or pending; ' +
          r.ruling + ' is for the values of a set output');
      } else if (r.ruling !== 'keep' && withValue === undefined) {
        bad(r.output + ' is ' + article(o.type) + ' output: a ' + r.ruling + ' ruling on it needs "with": the label the answer key should say instead of ' +
          JSON.stringify(value) + ' (add, reject and remove are for the values of a set output)');
      } else if (r.ruling === 'keep' && r.with !== undefined && !dropWith) {
        bad('a keep ruling leaves the label as the answer key has it: it takes no "with"');
      }
      for (const [k, v] of [['value', read(value)], ['with', withValue]]) {
        if (v === undefined || v === '' || isLabel(v)) continue;
        const near = o.labels.map(String).find(l => l.toLowerCase() === v.toLowerCase());
        bad('"' + k + '" is ' + JSON.stringify(v) + ', which is not one of ' + r.output + '\'s labels: ' + o.labels.join(', ') + (near ? ' (did you mean "' + near + '"?)' : ''));
      }
      if (withValue !== undefined && withValue === read(value)) bad('replaces ' + JSON.stringify(withValue) + ' with itself');
      if (r.proposed !== undefined) bad('"proposed" goes with a pending ruling on a set value; a label\'s pending names its label in "with"');
    } else if (o && o.type === 'set') {
      if (r.ruling === 'replace') bad('replace is for a label output; for a value of the set output ' + r.output + ' the answer key lists, use remove or keep');
      if (r.with !== undefined) bad('"with" is for a label output\'s replace or pending ruling; ' + r.output + ' is a set output');
      if (r.proposed !== undefined && !dropProposed) {
        if (r.ruling !== 'pending') bad('"proposed" goes with pending only: a ' + r.ruling + ' ruling says what was decided itself');
        else if (!PROPOSED.includes(r.proposed)) {
          const near = typeof r.proposed === 'string' ? PROPOSED.find(x => x === r.proposed.trim().toLowerCase()) : undefined;
          bad('"proposed" is ' + describe(r.proposed) + '; it must be add (a value the key may be missing) or remove (a value it may hold wrongly)' +
            (near ? ' (did you mean "' + near + '"?)' : ''));
        }
      }
    }
  }
  if (!ok) return null;

  if (value !== r.value) p.fix('D7', at, 'trimmed spaces from ' + JSON.stringify(r.value));
  const as = read(value);
  if (as !== value) p.fix('D23', at, r.output + ': the ruling\'s value ' + JSON.stringify(value) + ' read as its equivalent ' + JSON.stringify(as));
  const text = k => (typeof r[k] === 'string' && r[k].trim() !== '' ? r[k].trim() : null);
  // I13: a ruling nobody can trace is what this file exists to replace. A pending ruling decides
  // nothing yet (it is a question, as --write-rulings writes it): it needs no by or on.
  for (const [k, what] of [['by', 'who made it'], ['on', 'when (a date)']]) {
    if (r.ruling !== 'pending' && text(k) === null) p.strict('I13', at, named({ id, output: r.output, value: as }) + ' has no "' + k + '": say ' + what + ', so the ruling can be traced');
  }
  return { id, output: r.output, value: as, ruling: r.ruling, by: text('by'), on: text('on'), note: text('note'), at, label,
    ...(withValue !== undefined ? { with: withValue } : {}), ...(r.proposed !== undefined && !dropProposed ? { proposed: r.proposed } : {}),
    ...(r.reviewer_kind === 'judge' ? { reviewer_kind: 'judge' } : {}) };
}

// Reads and checks a rulings file against the config. Throws one error listing every stop
// (I12, and I13 in strict mode). Returns { file, list, problems }: the clean-ups and warnings
// go into each run's report. Which rulings apply to a key is decided per key: applyRulings.
function loadRulings(file, config, mode = 'strict') {
  const p = problems(mode);
  let raw;
  try {
    raw = JSON.parse(readText(file).replace(/^﻿/, ''));
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
    // read, so an alias and its value are one value here too. A record has one label, so two
    // rulings on it are two rulings on one entry, whatever their values (N11).
    const k = JSON.stringify(x.label ? [x.id, x.output] : [x.id, x.output, x.value]);
    if (first.has(k)) {
      p.stop('I12', at, 'rules on ' + (x.label ? markId(x.id) + ' ' + x.output + '\'s label' : named(x)) + ' again (first at rulings[' + first.get(k) + ']); ' +
        (x.label ? 'one ruling per label' : 'one ruling per value'));
      return;
    }
    first.set(k, i);
    list.push({ ...x, index: i });   // index: its place in the file, for --write-rulings (N10)
  });
  p.throwIfStopped();
  // entries: the file's rulings as written, for suspects --write-rulings to carry over word for word.
  return { file, list, problems: p.items, entries: raw.rulings };
}

const entry = x => ({ id: x.id, output: x.output, value: x.value, by: x.by, on: x.on, note: x.note,
  ...(x.with !== undefined ? { with: x.with } : {}), ...(x.proposed !== undefined ? { proposed: x.proposed } : {}),
  ...(x.reviewer_kind ? { reviewer_kind: x.reviewer_kind } : {}) });
// A pending ruling's question: a value the key may be missing (add), one it may hold wrongly
// (remove), or a label it may have wrong (replace).
const pendingKind = x => (x.with !== undefined ? 'replace' : x.proposed === 'remove' ? 'remove' : 'add');

// Which rulings apply to this answer key (keyRecords: load.js's normalized key). Each goes to
// added, rejected or pending, or is set aside, with the reason reported in p:
//   - a record not in this key: STRICT (I13). A ruling for another key, or a typo
//   - a value the key already accepts, in any slot (an any_of alternative or an equivalent
//     counts): WARN (I14). There is nothing to add, and a reject cannot make a right value wrong
//   - an add outside the output's allowed_values: STRICT (I13). A typo would add a value nothing
//     can fill, and every run would then miss it
// The file's own clean-ups and warnings are added to p, so the run's report lists them.
function applyRulings(rulings, keyRecords, config, p) {
  addAll(p.items, rulings.problems);
  const keyById = new Map(keyRecords.map(k => [k.id, k]));
  const byLower = new Map(keyRecords.map(k => [k.id.toLowerCase(), k.id]));
  const out = { file: rulings.file, added: [], rejected: [], pending: [], set_aside: [] };
  // The lists for what suspects added, only when the file uses it: an older file's results stay as they were.
  if (rulings.list.some(isNew)) Object.assign(out, { removed: [], kept: [], replaced: [] });
  const into = { add: out.added, reject: out.rejected, pending: out.pending, remove: out.removed, keep: out.kept, replace: out.replaced };
  for (const x of rulings.list) {
    const aside = why => out.set_aside.push({ ...entry(x), ruling: x.ruling, why });
    const k = keyById.get(x.id);
    if (!k) {
      const near = byLower.get(x.id.toLowerCase());
      p.strict('I13', x.at, 'record "' + (near ? markId(near, x.id) : markId(x.id)) + '" is not in the answer key' +
        (near ? ' (did you mean "' + markId(near) + '"? Ids must match exactly)' : '') + '; a ruling is for the records of the key it was made on');
      aside('the record is not in the answer key');
      continue;
    }
    if (x.label) {
      // N12: a label ruling made on another version of the key: the key no longer says its value.
      const said = k.outputs[x.output];
      if (said === DECLINED || String(said) !== x.value) {
        const now = said === DECLINED ? 'says to decline' : 'says ' + JSON.stringify(String(said));
        const done = x.ruling === 'replace' && String(said) === x.with;
        if (done) p.warn('I14', x.at, markId(x.id) + ' ' + x.output + ': the answer key already says ' + JSON.stringify(x.with) + ': there is nothing to replace. The ruling is set aside');
        else p.warn('N12', x.at, markId(x.id) + ' ' + x.output + ': the answer key ' + now + ', not ' + JSON.stringify(x.value) + ': the ruling was made on another version of the key. It is set aside');
        aside(done ? 'already in the answer key' : 'the answer key no longer says this label');
        continue;
      }
      into[x.ruling].push(entry(x));
      continue;
    }
    const slots = k.outputs[x.output];
    // N12: remove, keep and a pending remove question a value the key lists; on one it lacks
    // (another version of the key), there is nothing to question.
    if (x.ruling === 'remove' || x.ruling === 'keep' || (x.ruling === 'pending' && x.proposed === 'remove')) {
      if (!accepted(slots).has(x.value)) {
        p.warn('N12', x.at, named(x) + ' is not in the answer key: there is nothing to ' + (x.ruling === 'keep' ? 'keep' : 'remove') +
          ' (the ruling was made on another version of the key, or the value needs add or reject). The ruling is set aside');
        aside('not in the answer key');
        continue;
      }
      into[x.ruling].push(entry(x));
      continue;
    }
    if (accepted(slots).has(x.value)) {
      const alt = !slots.includes(x.value) ? ' (an alternative in an any_of slot)' : '';
      const why = { add: 'there is nothing to add', reject: 'a reject cannot make a value the key lists wrong', pending: 'as a possible gap there is nothing left to decide; to ask whether the key holds it wrongly, give the pending ruling "proposed": "remove"' };
      p.warn('I14', x.at, named(x) + ' is already in the answer key' + alt + ': ' + why[x.ruling] + '. The ruling is set aside');
      aside('already in the answer key');
      continue;
    }
    const allowed = config.allowed_values[x.output];
    if (x.ruling === 'add' && Array.isArray(allowed) && !allowed.includes(x.value)) {
      p.strict('I13', x.at, 'adds ' + JSON.stringify(x.value) + ' to ' + markId(x.id) + ' ' + x.output + ', which is not in allowed_values.' + x.output +
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
  for (const x of list) {
    if (!byId.has(x.id)) byId.set(x.id, []);
    byId.get(x.id).push(x);
  }
  return records.map(r => {
    const mine = byId.get(r.id);
    if (!mine) return r;
    const key = { ...r.key };
    for (const x of mine) {
      if (key[x.output] === r.key[x.output]) key[x.output] = [...r.key[x.output]];   // key records are shared: copied once, then added to
      key[x.output].push(x.value);
    }
    return { ...r, key };
  });
}

// Paired records with every change the rulings make to their key, for scoring only (N14): values
// added (addToKey), values removed (from whichever slot holds them; a slot left with no value
// goes), and labels replaced. New objects, so the records read from the files stay as they were.
// ruled: applyRulings' result, or any { added, removed, replaced } lists.
function applyToKey(records, ruled) {
  const removed = ruled.removed || [];
  const replaced = ruled.replaced || [];
  const added = addToKey(records, ruled.added || []);
  if (removed.length === 0 && replaced.length === 0) return added;
  const byId = new Map();
  for (const x of [...removed.map(x => ({ ...x, how: 'remove' })), ...replaced.map(x => ({ ...x, how: 'replace' }))]) byId.set(x.id, [...(byId.get(x.id) || []), x]);
  return added.map(r => {
    const mine = byId.get(r.id);
    if (!mine) return r;
    const key = { ...r.key };
    for (const x of mine) {
      if (x.how === 'replace') { key[x.output] = x.with; continue; }
      key[x.output] = key[x.output].map(s => (typeof s === 'string' ? (s === x.value ? null : s)
        : { any_of: s.any_of.filter(v => v !== x.value) })).filter(s => s !== null && (typeof s === 'string' || s.any_of.length > 0));
    }
    return { ...r, key };
  });
}

// Possible key gaps with their rulings. A rejected one is dropped and counted: it was ruled not
// a gap, so listing it again would ask the same question on every run (so is a value ruled out of
// the key with remove). A pending one carries who and when; the rest are unruled. An added value
// is in the key now, so it is never a candidate.
function annotateGaps(candidates, ruled) {
  const k = x => JSON.stringify([x.id, x.output, x.value]);
  const rejected = new Set([...ruled.rejected, ...(ruled.removed || [])].map(k));
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

// What AI judges decided in results.rulings, and the same rulings with those taken back out. A
// pending ruling has decided nothing, whoever wrote it.
const isJudge = x => x.reviewer_kind === 'judge';
const keyChanges = r => [...r.added, ...(r.removed || []), ...(r.replaced || [])];
const judgeDecided = r => [...keyChanges(r), ...r.rejected, ...(r.kept || [])].filter(isJudge);
const judgeChanges = r => keyChanges(r).filter(isJudge);
const withoutJudges = r => ({ ...r, added: r.added.filter(x => !isJudge(x)), removed: (r.removed || []).filter(x => !isJudge(x)), replaced: (r.replaced || []).filter(x => !isJudge(x)) });

module.exports = { loadRulings, applyRulings, addToKey, applyToKey, annotateGaps, pendingKind, judgeDecided, judgeChanges, withoutJudges, RULINGS };
