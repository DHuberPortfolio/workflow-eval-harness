// Reads prediction and answer-key files and turns every record into one clean shape.
//
// Nothing here knows about any particular platform. Whatever produced the file (n8n,
// Zapier, a script, an API), the config says where things are:
//   input.<file>.records_at / unwrap   where the records are
//   id_field, routing.field, outputs.*.field / key_field   where each field is, as a
//                                      name or a dotted path like "output.subject"
//   outputs.*.value_key / confidence_key   what the value and confidence are called
// Exports that need restructuring rather than locating (merging two lists into one,
// say) go through an adapter first; see examples/.
//
// After this file, everything can rely on:
//   - ids are trimmed text
//   - a set output is a list of { value, confidence, applied, inherited } (predictions)
//     or a list of slots (key): a plain value, or { any_of: [values] } when any one of
//     several is right (slots.js resolves them); a label output is one value, not a list
//   - every value is read through the config's equivalents: an alias as its group's first
//   - confidence is a number from 0 to 1, or null when not given
//   - applied is a real true/false
// Anything that cannot be cleaned up safely is recorded as a problem (see problems.js)
// and named after its trap in test/TRAPS.md. Checks that need both files at once
// (duplicate ids, records missing from one side, unknown routes) are in align.js.
const nodePath = require('path');
const { readText, ENCODING } = require('./text.js');
const { problems, markId } = require('./problems.js');
const { csvToRecords, decodeCsvRecords } = require('./csv.js');
const { align } = require('./align.js');
const { DECLINED, equivalentOf, FREE_TYPES } = require('./config.js');

// A free text answer as it is compared: case and runs of spaces do not matter, nor the quotes, brackets and commas
// around it, so ('Alan Payne',) as a database row prints it is Alan Payne (F15). Inner punctuation is kept.
const EDGES = /^[\s"'`‘’“”()[\]{},]+|[\s"'`‘’“”()[\]{},]+$/g;
const tidyText = s => String(s).normalize('NFC').replace(EDGES, '').replace(/\s+/g, ' ').toLowerCase();
// A number as it is compared: 27.610 and 27.61 are one number. Text that is not plainly a number is not read as one
// (no thousands commas, no units): a wrong answer, never a guess.
const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/;
function readAnswer(type, given) {
  const t = tidyText(given);
  if (type === 'text') return t;
  if (!NUMBER.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? String(n) : null;
}
const { isObj, isLabel, describe, own: ownOf } = require('./values.js');

// Only the record's own fields, never built-in JavaScript properties like "constructor".
const has = (obj, k) => obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, k);

// Reads a field by name or dotted path: "output.subject" is "subject" inside "output".
// A field literally named "output.subject" is used first, because spreadsheet-style
// exports flatten nested fields into names like that (trap A9).
const PATH_PARTS = new Map();   // a config names few paths and every record reads them all: each is split once
function getPath(obj, path) {
  if (has(obj, path)) return obj[path];
  if (!PATH_PARTS.has(path)) PATH_PARTS.set(path, path.split('.'));
  let cur = obj;
  for (const part of PATH_PARTS.get(path)) {
    if (!has(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

// ---------- Reading a file into a list of plain records (traps A1-A6) ----------

// For error messages: where in this object are there lists that could be the records?
function listHint(data) {
  if (!isObj(data)) return '.';
  const found = [];
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) found.push(k);
    else if (isObj(v)) for (const [k2, v2] of Object.entries(v)) if (Array.isArray(v2)) found.push(k + '.' + k2);
  }
  return found.length
    ? '. Lists found at: ' + found.map(f => '"' + f + '"').join(', ') + '. Set "records_at" for this file under "input" in the config.'
    : '. No list of records was found in it.';
}

// JSON Lines: one record per line, the usual log format for scripts and eval tools.
// Returns null if any line is broken (each broken line is reported).
function parseJsonLines(text, source, p) {
  const records = [];
  let ok = true;
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '') return;   // blank lines, including the usual one at the end
    try { records.push(JSON.parse(line)); } catch (e) { ok = false; p.stop('A2', source + ' line ' + (i + 1), 'not valid JSON: ' + e.message); }
  });
  return ok ? records : null;
}

// Which format a file is in: the config's setting, otherwise its extension.
function formatOf(source, input = {}) {
  if (input.format) return input.format;
  if (/\.(jsonl|ndjson)$/i.test(source)) return 'jsonl';
  if (/\.(csv|tsv)$/i.test(source)) return 'csv';
  return 'json';
}

// Turns file text into a list of records. `input` is the config's input.predictions or
// input.key; with nothing set, the file must be a plain list of records.
// CSV records come back with every cell as text; loadRun decodes them (see csv.js).
function parseRecords(text, source, p, input = {}) {
  if (text.charCodeAt(0) === 0xFEFF) {
    // Windows tools often write this invisible marker at the start of UTF-8 files.
    text = text.slice(1);
    p.fix('A3', source, 'removed an invisible byte-order mark from the start of the file');
  }
  if (text.trim() === '') { p.stop('A4', source, 'the file is empty'); return []; }

  const format = formatOf(source, input);
  let data;
  if (format === 'csv') {
    if (input.records_at || input.unwrap) { p.stop('A5', source, '"records_at" and "unwrap" do not apply to CSV: each row is one record'); return []; }
    return csvToRecords(text, source, p, input.delimiter || (/\.tsv$/i.test(source) ? '\t' : ','));
  } else if (format === 'jsonl') {
    if (input.records_at) { p.stop('A5', source, '"records_at" does not apply to JSON Lines: each line is already one record'); return []; }
    data = parseJsonLines(text, source, p);
    if (data === null) return [];
  } else {
    try { data = JSON.parse(text); } catch (e) { p.stop('A2', source, 'not valid JSON: ' + e.message); return []; }
    if (input.records_at) {
      if (Array.isArray(data)) { p.stop('A5', source, '"records_at" is "' + input.records_at + '", but the file is already a list of records'); return []; }
      const found = getPath(data, input.records_at);
      if (!Array.isArray(found)) {
        p.stop('A5', source, 'expected the list of records at "' + input.records_at + '", found ' + describe(found) + listHint(data));
        return [];
      }
      data = found;
    } else if (!Array.isArray(data)) {
      p.stop('A5', source, 'expected a list of records, got ' + (isObj(data) ? 'an object' : describe(data)) + listHint(data));
      return [];
    }
  }
  if (data.length === 0) { p.stop('A4', source, 'the list of records is empty'); return []; }

  if (input.unwrap) {
    const records = [];
    data.forEach((d, i) => {
      const inner = getPath(d, input.unwrap);
      if (isObj(inner)) records.push(inner);
      else p.stop('A6', source + ' record #' + (i + 1), 'has no "' + input.unwrap + '" to unwrap');
    });
    return records;
  }
  return data;
}

function readRecords(path, p, input = {}) {
  let text;
  try { text = readText(path); } catch (e) { p.stop(e.code === ENCODING ? e.trap : 'A1', path, (e.code === ENCODING ? '' : 'cannot read the file: ') + e.message); return []; }
  return parseRecords(text, path, p, input);
}

// Before reading records one by one: is the id field there at all? If not, every record
// would fail the same way, so say it once. If the id sits inside the same field in every
// record, the records are wrapped (an n8n export puts each one in "json"), so name the
// exact setting that fixes it rather than guessing (trap A6).
function idsFound(raws, idField, source, which, p) {
  if (raws.some(r => getPath(r, idField) !== undefined)) return true;
  const first = raws.find(isObj) || {};
  const wrapper = Object.keys(first).find(k => raws.every(r => isObj(r) && isObj(r[k]) && getPath(r[k], idField) !== undefined));
  if (wrapper) {
    p.stop('A6', source, 'no record has "' + idField + '", but every record has it inside "' + wrapper +
      '". The records are wrapped: add "unwrap": "' + wrapper + '" under input.' + which + ' in the config.');
  } else {
    p.stop('B1', source, 'no record has "' + idField + '". Check id_field in the config.');
  }
  return false;
}

// ---------- Reading single values ----------

// Returns the id as trimmed text, or null if the record has no usable id (B1, B7, B8).
function readId(raw, idField, where, p) {
  const v = getPath(raw, idField);
  if (typeof v !== 'string' && typeof v !== 'number') { p.stop('B1', where, 'has no "' + idField + '"'); return null; }
  const id = String(v).trim();   // 7 and "7" become the same id
  if (id === '') { p.stop('B1', where, 'has an empty "' + idField + '"'); return null; }
  if (typeof v === 'string' && id !== v) p.fix('B8', where, 'trimmed spaces from id "' + markId(id, JSON.stringify(v).slice(1, -1)) + '"');
  return id;
}

// Returns a number from 0 to 1, or undefined if the confidence is unusable (E2-E4).
function readConfidence(c, where, p) {
  if (typeof c === 'string') {
    p.stop('E2', where, 'confidence is ' + describe(c) + '; it must be a number, without quotes');
    return undefined;
  }
  if (typeof c !== 'number' || !Number.isFinite(c)) { p.stop('E4', where, 'confidence must be a number, got ' + describe(c)); return undefined; }
  if (c > 1 && c <= 100) { p.stop('E3', where, 'confidence ' + c + ' looks like a percentage; write it as ' + (c / 100)); return undefined; }
  if (c < 0 || c > 1) { p.stop('E4', where, 'confidence must be between 0 and 1, got ' + c); return undefined; }
  return c;
}

// Reads one value, given as "text" or an object like { value, confidence, applied, inherited_from }
// (the value and confidence fields can be renamed in the config). Predictions keep confidence
// and applied; the key keeps only the value (E6). Returns null if the value is unusable.
function readValue(item, o, where, p, isKey) {
  const vk = o.value_key;
  const ck = o.confidence_key;
  let value;
  let confidence = null;
  let applied = true;       // D11: most exports only list what was applied
  let inherited = false;

  if (typeof item === 'string') {
    value = item;
  } else if (isObj(item) && typeof item[vk] === 'string') {
    value = item[vk];
    if (!isKey) {
      if (item[ck] !== undefined && item[ck] !== null) {
        confidence = readConfidence(item[ck], where, p);
        if (confidence === undefined) return null;
      }
      if (item.applied !== undefined) {
        // D12: the text "false" would count as true in JavaScript, so only real true/false is accepted.
        if (typeof item.applied !== 'boolean') {
          p.stop('D12', where, '"applied" must be true or false without quotes, got ' + describe(item.applied));
          return null;
        }
        applied = item.applied;
      }
      inherited = item.inherited_from !== undefined && item.inherited_from !== null;   // D17
    }
  } else {
    const nearAnyOf = isKey && isObj(item) && Object.keys(item).some(k => /^(any|one)[-_ ]?of$/i.test(k));
    p.stop('D4', where, 'each value must be text or { "' + vk + '": "..." }, got ' +
      (isObj(item) ? 'an object with no "' + vk + '" text' : describe(item)) + (nearAnyOf ? ' (did you mean "any_of"?)' : ''));
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === '') { p.stop('D9', where, 'the value is empty'); return null; }
  if (trimmed !== value) p.fix('D7', where, 'trimmed spaces from ' + JSON.stringify(value));
  return isKey ? trimmed : { value: trimmed, confidence, applied, inherited };
}

// Two copies of one value in one record, kept as one: two values that the config's equivalents
// make one (D23), or the same text twice, kept once in lenient mode (D6). Applied if either copy
// was: one episode cited twice under two ids was still cited. The confidence kept is the one a
// lead gate would see: with an applied copy, the highest applied copy's, never a copy's the
// workflow did not apply (an applied 0.4 merged with a 0.9 set aside would otherwise become an
// applied 0.9, or not applied at all, and hide the gate and floor failures, SG-GATE and SG-FLOOR).
// With no applied copy, the higher, as before. When applied copies differ, the lowest is kept as
// well (floor_confidence), for the floor check and a "weakest" gate (judge.js): a merge never
// hides a weak value that was applied. A value that is the result of an earlier merge brings its
// own lowest along.
function mergeCopies(a, b, isKey) {
  if (isKey) return a;
  const conf = v => v.confidence ?? -1;
  const applied = [a, b].filter(v => v.applied);
  const from = applied.length ? applied : [a, b];
  const merged = { ...(from.length === 2 && conf(from[1]) > conf(from[0]) ? from[1] : from[0]) };
  delete merged.floor_confidence;
  const lows = applied.map(v => v.floor_confidence ?? v.confidence).filter(c => c !== null);
  const low = lows.length ? Math.min(...lows) : null;
  if (low !== null && low < merged.confidence) merged.floor_confidence = low;
  return merged;
}
// What a merge kept, for its line (D23's FIX, D6's lenient warning): applied or not, the
// confidence kept and whose it is when that is not plain, and the lowest applied copy's when it
// was kept too.
function keptWords(a, b, m) {
  if (m.confidence === null) return m.applied ? 'applied' : 'not applied';
  let s = (m.applied ? 'applied' : 'not applied') + ', confidence ' + m.confidence;
  const low = m.floor_confidence;
  const unused = m.applied ? [a, b].filter(v => !v.applied && v.confidence !== null && v.confidence > m.confidence) : [];
  if (low !== undefined || unused.length) s += ', the ' + (low !== undefined ? 'highest applied' : 'applied') + " copy's";
  if (unused.length) s += ': the ' + unused[0].confidence + ' of a copy not applied is not used';
  if (low !== undefined) s += '; the floor and a "weakest" gate check the lowest, ' + low;
  return s;
}
const mergedMessage = (name, first, second, value, kept) => name + ': merged 2 equivalent values, ' + JSON.stringify(first) + ' and ' +
  JSON.stringify(second) + ', into ' + JSON.stringify(value) + (kept ? ' (' + kept + ')' : '');

// One slot of a set output's answer key: { "any_of": [...] }, any one of whose values is right
// (D20). Each value is text, trimmed and read through equivalents like a plain value. Anything
// else is a stop (D21), naming the record: an empty list could never be filled, an object inside
// it has no one value, and a key beside any_of would be ignored. Returns { any_of } or null.
function readSlot(item, name, at, p, eq) {
  const extra = Object.keys(item).filter(k => k !== 'any_of');
  if (extra.length) { p.stop('D21', at, 'an any_of slot holds only "any_of", got ' + extra.map(k => JSON.stringify(k)).join(', ') + ' beside it'); return null; }
  const list = item.any_of;
  if (!Array.isArray(list) || list.length === 0) {
    p.stop('D21', at, 'any_of must be a list of one or more values, got ' + (Array.isArray(list) ? 'an empty list' : describe(list)));
    return null;
  }
  const values = [];
  const written = [];   // how each value was written, to tell a repeat (D6) from an equivalent (D23)
  let ok = true;
  list.forEach((x, i) => {
    const xat = at + '.any_of[' + i + ']';
    if (typeof x !== 'string') { ok = false; p.stop('D21', xat, 'each value in any_of must be text, got ' + (isObj(x) ? 'an object' : describe(x))); return; }
    const t = x.trim();
    if (t === '') { ok = false; p.stop('D9', xat, 'the value is empty'); return; }
    if (t !== x) p.fix('D7', xat, 'trimmed spaces from ' + JSON.stringify(x));
    const v = eq.read(name, t);
    const j = values.indexOf(v);
    if (j === -1) { values.push(v); written.push([t]); }
    else if (written[j].includes(t)) p.strict('D6', at, name + ' any_of lists ' + JSON.stringify(v) + ' more than once');
    else { p.fix('D23', at, mergedMessage(name, written[j][0], t, v, null)); written[j].push(t); }
  });
  return ok ? { any_of: values } : null;
}

// Reads a set output: a list of values (D1-D9). In the answer key an element may also be an
// any_of slot (D20-D22); the key keeps its slots as written, and slots.js resolves them per record.
// eq: the config's equivalents, applied to every value read (D23).
function readSet(raw, name, o, where, p, isKey, gated, eq) {
  if (raw === undefined || raw === null) {
    // D1: a prediction without this output means the model returned nothing for it.
    // D2: a key without it means we do not know the right answer, and [] would be a guess.
    if (isKey) p.stop('D2', where, 'the key has no ' + name + '. Write [] if the correct answer is "nothing".');
    return [];
  }
  if (!Array.isArray(raw)) { p.stop('D5', where, name + ' must be a list, got ' + describe(raw)); return []; }

  const out = [];             // what is kept, in the order listed
  const plain = new Map();    // value -> { i: its place in out, as: every way it was written }
  const inSlots = new Set();  // every value in a slot so far: a plain value is a slot of one
  // D22: a value in two slots of one record. Counting is still defined (each slot it is in is
  // filled by it), but which slot the key meant it for is not, so it is a sign of a key mistake.
  const slotted = v => {
    if (inSlots.has(v)) p.strict('D22', where, name + ' lists ' + JSON.stringify(v) + ' in more than one slot (alone or in an any_of)');
    inSlots.add(v);
  };
  raw.forEach((item, i) => {
    const at = where + ' ' + name + '[' + i + ']';
    if (isObj(item) && has(item, 'any_of')) {
      if (!isKey) { p.stop('D21', at, 'any_of is for the answer key; a prediction lists the values the workflow gave'); return; }
      const slot = readSlot(item, name, at, p, eq);
      if (slot !== null) { slot.any_of.forEach(slotted); out.push(slot); }
      return;
    }
    const v = readValue(item, o, at, p, isKey);
    if (v === null) return;
    const as = isKey ? v : v.value;
    const value = eq.read(name, as);
    const entry = isKey ? value : { ...v, value };

    if (!isKey && gated && v.applied && v.confidence === null) {
      p.strict('E1', at, JSON.stringify(value) + ' has no confidence, but ' + name + ' has a confidence gate');
    }
    const prev = plain.get(value);
    if (!prev) {
      if (isKey) slotted(value);
      plain.set(value, { i: out.length, as: [as] });
      out.push(entry);
    } else if (prev.as.includes(as)) {
      // D6: listed twice. A sign something upstream is not de-duplicating. A stop in strict mode;
      // in lenient mode the copies are kept once, by the same rule as equivalents (mergeCopies),
      // and the warning says which confidences were kept.
      const before = out[prev.i];
      out[prev.i] = mergeCopies(before, entry, isKey);
      const kept = !isKey && p.mode === 'lenient' ? '; kept once (' + keptWords(before, entry, out[prev.i]) + ')' : '';
      p.strict('D6', where, name + ' lists ' + JSON.stringify(value) + ' more than once' + kept);
    } else {
      const before = out[prev.i];
      out[prev.i] = mergeCopies(before, entry, isKey);
      p.fix('D23', where, mergedMessage(name, prev.as[0], as, value, isKey ? null : keptWords(before, entry, out[prev.i])));
      prev.as.push(as);
    }
  });
  return out;
}

// Reads a label output: exactly one value from the declared list (F1-F4).
// extConf: the confidence from a separate field (confidence_field), if the config has one.
// extDeclined: the prediction's decline field (outputs.<name>.decline.field), if the config has one.
//
// A declined label (decline.values, or the decline field set to true) comes back as
// { value: DECLINED, declined: true, set_aside, confidence, applied: false } on predictions,
// and as DECLINED in the key, where it means declining is the correct outcome (F5-F10).
// applied is false because nothing was given to anyone: a gate has nothing to stand on.
// F13: { "any_of": [...] } is for set outputs. A label has one answer per record, and its
// confusion matrix needs one key label per row; two names for one label are "equivalents".
// eq: the config's equivalents, applied before the label is checked (D23).
// scored: false for a failed model call, which has no label to read (C10, trap P22).
function readLabel(raw, name, o, where, p, isKey, gated, extConf, extDeclined, eq, scored = true) {
  const d = o.decline;
  if (isObj(raw) && has(raw, 'any_of')) {
    p.stop('F13', where, name + ': any_of is for set outputs. A ' + o.type + ' output holds one label; for two names of one label, use "equivalents" in the config');
    return null;
  }
  let declinedByField = false;
  if (!isKey && d && d.field && extDeclined !== undefined && extDeclined !== null) {
    // F7: like "applied", the text "false" would count as true in JavaScript.
    if (typeof extDeclined !== 'boolean') { p.stop('F7', where, d.field + ' must be true or false without quotes, got ' + describe(extDeclined)); return null; }
    declinedByField = extDeclined;
  }
  if (raw === undefined || raw === null) {
    if (declinedByField) return { value: DECLINED, declined: true, set_aside: null, confidence: null, applied: false, inherited: false };
    if (!scored) return null;
    // F6: a missing label is never read as a decline unless the config says how a decline looks.
    p.stop(isKey ? 'F4' : 'F3', where, name + ' has no label' + (!isKey && d && d.field ? ' and ' + d.field + ' is not true' : ''));
    return null;
  }
  // Bands are often written as numbers (5, not "5"). Labels are compared as text.
  if (typeof raw === 'number' && Number.isFinite(raw)) raw = String(raw);
  else if (isObj(raw) && typeof raw[o.value_key] === 'number' && Number.isFinite(raw[o.value_key])) raw = { ...raw, [o.value_key]: String(raw[o.value_key]) };
  if (Array.isArray(raw)) { p.stop('F2', where, name + ' must be one label, got a list'); return null; }
  const v = readValue(raw, o, where + ' ' + name, p, isKey);
  if (v === null) return null;
  if (FREE_TYPES.includes(o.type)) {
    // A free answer (F15): read as its tidied text or its number, from no fixed list.
    const given = isKey ? v : v.value;
    const answer = readAnswer(o.type, given);
    if (answer === null || answer === '') {
      if (isKey) { p.stop('F15', where, name + ' is ' + JSON.stringify(given) + ', which is not ' + (o.type === 'number' ? 'a number' : 'an answer')); return null; }
      v.value = tidyText(given);   // an answer that is not a number is a wrong answer, kept (tidied) for the report
    } else if (isKey) return answer;
    else v.value = answer;
  }
  const label = FREE_TYPES.includes(o.type) ? v.value : eq.read(name, isKey ? v : v.value);
  if (!isKey) v.value = label;
  const declineValues = d ? d.values : [];
  const isDeclineValue = declineValues.includes(label);
  if (!FREE_TYPES.includes(o.type) && !o.labels.includes(label) && !isDeclineValue) {
    const known = [...o.labels, ...declineValues];
    const near = known.find(l => l.toLowerCase() === label.toLowerCase());
    p.stop('F1', where, name + ' is ' + JSON.stringify(label) + ', which is not one of: ' + o.labels.join(', ') +
      (declineValues.length ? ' (or a decline: ' + declineValues.join(', ') + ')' : '') + (near ? ' (did you mean "' + near + '"?)' : ''));
    return null;
  }
  if (isKey) return isDeclineValue ? DECLINED : label;

  if (extConf !== undefined && extConf !== null) {
    // E8: the same confidence given in two places; which one would be right?
    if (v.confidence !== null) { p.stop('E8', where, name + ' has a confidence in two places: with the label and in ' + o.confidence_field); return null; }
    const c = readConfidence(extConf, where + ' ' + o.confidence_field, p);
    if (c === undefined) return null;
    v.confidence = c;
  }
  if (isDeclineValue || declinedByField) {
    // F9: a label beside a true decline field was set aside, not given: kept for the report only.
    return { value: DECLINED, declined: true, set_aside: isDeclineValue ? null : label, confidence: v.confidence, applied: false, inherited: false };
  }
  if (gated && v.confidence === null) p.strict('E1', where + ' ' + name, 'the label has no confidence, but ' + name + ' has a confidence gate');
  return v;
}

// rejected_field: values the workflow proposed but did not apply, listed separately.
// They join the output's list marked applied: false, so from here on they are handled
// exactly like values written with "applied": false.
function withRejected(value, raw, name, o, where, p) {
  const rejected = getPath(raw, o.rejected_field);
  if (rejected === undefined || rejected === null) return value;
  if (!Array.isArray(rejected)) { p.stop('D5', where, o.rejected_field + ' must be a list, got ' + describe(rejected)); return value; }
  if (value !== undefined && value !== null && !Array.isArray(value)) return value;   // readSet reports it

  const marked = [];
  rejected.forEach((item, i) => {
    if (isObj(item) && item.applied !== undefined && item.applied !== false) {
      // D19: listed as rejected but marked applied. Contradictory, so neither is trusted.
      p.stop('D19', where + ' ' + o.rejected_field + '[' + i + ']', 'is in the rejected list but has "applied": ' + JSON.stringify(item.applied));
      return;
    }
    marked.push(typeof item === 'string' ? { [o.value_key]: item, applied: false } : isObj(item) ? { ...item, applied: false } : item);
  });
  return [...(value || []), ...marked];
}

// scored: false for a record whose model call failed. It has no confidences to check (E1).
// absent: the outputs no record of this file has, reported once for the file (trap P1).
function readOutputs(raw, config, where, p, isKey, eq, scored = true, absent = NO_OUTPUTS) {
  const gates = config.thresholds ? config.thresholds.auto_publish : {};
  const outputs = {};
  for (const [name, o] of Object.entries(config.outputs)) {
    if (absent.has(name)) { outputs[name] = o.type === 'set' ? [] : null; continue; }
    let value = getPath(raw, isKey ? o.key_field : o.field);
    const gated = scored && Object.hasOwn(gates, name);
    if (o.type === 'set') {
      if (!isKey && o.rejected_field) value = withRejected(value, raw, name, o, where, p);
      outputs[name] = readSet(value, name, o, where, p, isKey, gated, eq);
    } else {
      const extConf = !isKey && o.confidence_field ? getPath(raw, o.confidence_field) : undefined;
      const extDeclined = !isKey && o.decline && o.decline.field ? getPath(raw, o.decline.field) : undefined;
      outputs[name] = readLabel(value, name, o, where, p, isKey, gated, extConf, extDeclined, eq, scored);
    }
  }
  return outputs;
}

// ---------- A field the config names and no record has (trap P1) ----------
//
// A misspelt path reads as nothing, and nothing is a value: every prediction an empty list, every
// record its own cluster, no record movable. Each is what the file seems to say, so nothing downstream
// can tell, and a run with every value wrong has scored 0%. The rule looks at the whole file once, at
// the cost of the first record that has the field. null is no value: a broken n8n expression writes it
// on every record.
const NO_OUTPUTS = new Set();
const anyHas = (raws, path, keep = () => true) => raws.some(r => keep(r) && getPath(r, path) != null);
const notFailed = r => !isObj(r) || r.scored !== false;
const noRecord = (path, at) => 'no record has "' + path + '" (' + at + ')';
const EMPTY_LISTS = 'if the workflow leaves out empty lists, use --lenient. Otherwise every record would read as having none: check that setting against ';

// One command's files read together (variance, compare, suspects, monitor). A workflow that leaves out
// empty lists, as n8n does, writes a quiet period with no record holding the field; a typo leaves it
// out of every file. A set output is judged on all of them, once all are read: a file that alone lacks
// it warns, and only a field no file has is strict. A file of failed calls says nothing either way.
function acrossFiles() {
  const found = new Set();
  const missing = new Map();   // output name -> { field, at, files }
  return {
    found(name) { found.add(name); },
    missing(name, field, at, file) {
      if (!missing.has(name)) missing.set(name, { field, at, files: new Set() });
      missing.get(name).files.add(file);
    },
    report(p) {
      for (const [name, { field, at, files }] of missing) {
        const list = [...files];
        if (found.has(name)) {
          for (const f of list) p.warn('P1', f, noRecord(field, at) + ', though other files here do: every record reads as having none. That is a quiet period if the workflow leaves out empty lists');
        } else if (list.length === 1) {
          p.strict('P1', list[0], noRecord(field, at) + '; ' + EMPTY_LISTS + 'the file');
        } else {
          p.strict('P1', list[0], 'no record in any of the ' + list.length + ' files has "' + field + '" (' + at + '); ' + EMPTY_LISTS + 'the files');
        }
      }
    },
  };
}

// Outputs the predictions never hold. A failed model call holds nothing to read, so only records
// scored count, and a run with none says so elsewhere (trap P2). Returns the labels with none: a
// label cannot be read as empty, so each record would stop on its own, and one line says it for all.
function outputsAbsentFromRun(raws, config, source, p, across = null) {
  if (raws.every(r => !notFailed(r))) return NO_OUTPUTS;
  const absent = new Set();
  for (const [name, o] of Object.entries(config.outputs)) {
    if (anyHas(raws, o.field, notFailed)) { if (across) across.found(name); continue; }
    const at = 'outputs.' + name + '.field';
    if (o.type === 'set') {
      // Values set aside are values: the run has this output, only none it applied.
      if (o.rejected_field && anyHas(raws, o.rejected_field, notFailed)) { if (across) across.found(name); continue; }
      if (across) across.missing(name, o.field, at, source);
      else p.strict('P1', source, noRecord(o.field, at) + '; ' + EMPTY_LISTS + 'the file');
    } else if (!(o.decline && o.decline.field && anyHas(raws, o.decline.field, notFailed))) {
      p.stop('F3', source, noRecord(o.field, at) + (o.decline && o.decline.field ? ' and ' + o.decline.field + ' is not true' : '') + ', so no record has a label. Check that setting against the file');
      absent.add(name);
    }
  }
  return absent;
}

// Outputs the answer key never holds: nothing to score against, in lenient mode too (D2, F4).
function outputsAbsentFromKey(raws, config, source, p) {
  const absent = new Set();
  for (const [name, o] of Object.entries(config.outputs)) {
    if (anyHas(raws, o.key_field)) continue;
    p.stop(o.type === 'set' ? 'D2' : 'F4', source, noRecord(o.key_field, 'outputs.' + name + '.key_field') + '. Write [] on a record whose correct answer is "nothing"; check that setting against the file');
    absent.add(name);
  }
  return absent;
}

// The other fields a config names, for the commands that read them (loadRun). Those that say what
// a record is, a typo in which changes a table with no sign of it, are STRICT. Those that a run may
// have nothing to put in only warn: values set aside, a label's confidence column, a decline flag.
// A group or a cluster read from this side. Without one, a report's table has a single row, which
// shows; a stop is for a command that needs it. needs: what the command reads, as for loadRun.
function sideFieldsAbsent(raws, config, side, source, p, needs) {
  for (const [name, g] of Object.entries(config.groups)) {
    if (g.from !== side || anyHas(raws, g.field)) continue;
    const say = needs.groups && needs.groups.includes(name) ? 'strict' : 'warn';
    p[say]('P1', source, noRecord(g.field, 'groups.' + name + '.field') + ': every record would be grouped as "(none)"');
  }
  const c = config.clusters;
  if (c && c.from === side && !anyHas(raws, c.field)) {
    p[needs.clusters ? 'strict' : 'warn']('P1', source, noRecord(c.field, 'clusters.field') + ': every record would be a cluster of its own');
  }
}
// A set output on almost no record: a typo in part of the workflow, or a workflow leaving out empty
// lists. Each record is read as nothing found, which is right only in the second case. Counts the
// records that are not failed calls; the usual file stops a tenth of the way in, at the cost of no more.
function mostlyMissing(raws, field) {
  let scored = 0, has = 0;
  for (const r of raws) {
    if (!notFailed(r)) continue;
    scored++;
    if (getPath(r, field) != null) has++;
    if (has * 10 > raws.length) return null;
  }
  return has > 0 && has * 10 <= scored ? { missing: scored - has, scored } : null;
}
function runFieldsAbsent(raws, config, source, p, needs) {
  const anyScored = raws.some(notFailed);
  sideFieldsAbsent(raws, config, 'predictions', source, p, needs);
  const w = config.whatif;
  if (needs.movable && w && !anyHas(raws, w.movable_field)) p.strict('P1', source, noRecord(w.movable_field, 'whatif.movable_field') + ': no record could move, and a what-if would show the run as it was at every threshold');
  if (!anyScored) return;
  for (const [name, o] of Object.entries(config.outputs)) {
    const few = o.type === 'set' && !o.rejected_field ? mostlyMissing(raws, o.field) : null;
    if (few) p.warn('P1', source, few.missing + ' of ' + few.scored + ' records have no "' + o.field + '" (outputs.' + name + '.field): each is read as nothing found. Right if the workflow leaves out empty lists; otherwise check the field');
    if (o.rejected_field && !anyHas(raws, o.rejected_field, notFailed)) p.warn('P1', source, noRecord(o.rejected_field, 'outputs.' + name + '.rejected_field') + ': nothing was set aside, or the setting is misspelt');
    if (o.confidence_field && !anyHas(raws, o.confidence_field, notFailed)) p.warn('P1', source, noRecord(o.confidence_field, 'outputs.' + name + '.confidence_field') + ': no label has a confidence');
    if (o.decline && o.decline.field && !anyHas(raws, o.decline.field, notFailed)) p.warn('P1', source, noRecord(o.decline.field, 'outputs.' + name + '.decline.field') + ': nothing was declined that way, or the setting is misspelt');
  }
}
function keyFieldsAbsent(raws, config, source, p, needs) {
  // One config can serve a key with trap labels and a key without (the compliance reviewer's 500 and
  // its 40): absent, the trap table shows it, so a warning, unless the config asks for traps to be counted.
  if (config.trap_field && !anyHas(raws, config.trap_field)) {
    const words = noRecord(config.trap_field, 'trap_field') + ': every record is in the trap row "(none)"';
    if (config.min_per_trap !== null) p.strict('P1', source, words + ', and min_per_trap would pass with nothing counted');
    else p.warn('P1', source, words);
  }
  sideFieldsAbsent(raws, config, 'key', source, p, needs);
  const d = config.duplicate_of_field;
  if (d && !anyHas(raws, d)) {
    // A set with no duplicates may leave the field out. One that suppresses records has a primary for each.
    const gold = config.routing.gold_field;
    const suppresses = gold !== null && raws.some(r => { const g = getPath(r, gold); return typeof g === 'string' && ownOf(config.routing.map, g.trim()) === 'exclude'; });
    if (suppresses) p.strict('P1', source, noRecord(d, 'duplicate_of_field') + ', and the answer key suppresses records: none names its primary');
    else p.warn('P1', source, noRecord(d, 'duplicate_of_field') + ': no duplicates, or the setting is misspelt');
  }
}

// equivalents (config): every value of a group is read as the group's first, on both sides, as
// it is read, so every metric, the calibration, the key gaps and the what-ifs agree on them with
// no code of their own (trap D23). Counts what it read, so the report can say so: one clean-up
// per output and file, naming each value read as another and how often.
function equivalentsReader(config) {
  const eqs = config.equivalents || {};
  const as = new Map(Object.keys(eqs).map(n => [n, equivalentOf(eqs, n)]));
  const read = new Map();   // output -> Map("from\0to" -> { from, to, n })
  return {
    read(name, v) {
      const to = as.has(name) ? as.get(name)(v) : v;
      if (to === v) return v;
      if (!read.has(name)) read.set(name, new Map());
      const k = v + '\0' + to;
      const m = read.get(name);
      if (!m.has(k)) m.set(k, { from: v, to, n: 0 });
      m.get(k).n++;
      return to;
    },
    report(p, source, side) {
      for (const [name, m] of read) {
        const list = [...m.values()];
        const n = list.reduce((s, x) => s + x.n, 0);
        p.fix('D23', source, name + ': ' + n + ' ' + side + ' value' + (n === 1 ? '' : 's') + ' read as ' + (n === 1 ? 'its' : 'their') + ' equivalent: ' +
          list.map(x => x.from + ' as ' + x.to + (x.n > 1 ? ' (' + x.n + ')' : '')).join(', '));
      }
    },
  };
}

// whatif.movable_field: whether this record's route was decided by the confidence gate.
// Compared as text, so a CSV's "6" matches a config's 6. null when the field is absent.
function readMovable(raw, config) {
  if (!config.whatif) return null;
  const v = getPath(raw, config.whatif.movable_field);
  if (v === undefined || v === null || v === '') return null;
  return config.whatif.movable_values.some(m => String(m) === String(v).trim());
}

// Prediction fields kept beside the outputs, by path: each record's own gate threshold
// (thresholds.auto_publish naming a field) and the fields a policy what-if's conditions read
// (config.policy_fields, added by policy.js). null when there are none, so records stay
// unchanged without them. A missing field is left out.
// A record's own threshold must be a number from 0 to 1 (trap E18). Text that reads as one is read
// as the number: a CSV's cells are all text, and in a JSON file it is cleaned up and counted (ctx).
// Anything else is strict, because a gate with no threshold cannot be checked; in lenient mode it
// is left out and the gate check for that record is unknown. Only for records the gate could
// route (out without review or sent to a person, with a model answer): a blocked record or a
// failed model call never meets the gate. ctx collects, for one line each after the file: numeric
// text read as numbers, and thresholds below thresholds.floor.
function readFields(raw, config, where, p, ctx) {
  const own = config.thresholds ? Object.values(config.thresholds.auto_publish).filter(v => typeof v === 'string') : [];
  const paths = [...new Set([...own, ...(config.policy_fields || [])])];
  if (paths.length === 0) return null;
  const route = getPath(raw, config.routing.field);
  const cls = typeof route === 'string' ? ownOf(config.routing.map, route.trim()) : undefined;
  const gated = ctx.scored && (cls === 'auto' || cls === 'review');
  // Read by name wherever a threshold or a policy names a field: no built-in may answer (trap P43).
  const out = Object.create(null);
  for (const f of paths) {
    let v = getPath(raw, f);
    if (own.includes(f)) {
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
        if (!ctx.csv) ctx.text.push(ctx.id);
        v = Number(v);
      }
      if (!(typeof v === 'number' && v >= 0 && v <= 1)) {
        // The value itself when it is a number (1.2, 85), and for a percentage, the fraction it means.
        const shown = typeof v === 'number' ? String(v) + (Number.isInteger(v) && v > 1 && v <= 100 ? '; it must be a number from 0 to 1 (a percentage? write ' + v / 100 + ')' : '; it must be a number from 0 to 1')
          : describe(v) + '; it must be a number from 0 to 1';
        if (gated) p.strict('E18', where, 'its own gate threshold "' + f + '" is ' + shown + ' (thresholds.auto_publish names this field)');
        continue;
      }
      if (config.thresholds.floor !== null && v < config.thresholds.floor && !ctx.below.includes(ctx.id)) ctx.below.push(ctx.id);
    }
    if (v !== undefined) out[f] = v;
  }
  return out;
}

// The lines readFields saves for after the file (trap E18): one for each kind, naming the records.
function reportFields(ctx, config, source, p) {
  const ids = list => list.slice(0, 20).map(id => markId(id)).join(', ') + (list.length > 20 ? ' ...' : '');
  if (ctx.text.length) p.fix('E18', source, ctx.text.length + ' record(s) give their own gate threshold as text; read as the number: ' + ids(ctx.text));
  if (ctx.below.length) {
    p.warn('E18', source, ctx.below.length + ' record(s) have their own gate threshold below thresholds.floor (' + config.thresholds.floor +
      '): ' + ids(ctx.below) + '. A value under the floor is never applied, so the gate below it never decides anything');
  }
}

// Group labels (config.groups) for the groups read from this side: { name: [labels] }, or null
// when this side has none, so records stay unchanged without groups. Read like trap labels:
// text, a number or true/false is one label, as trimmed text (so a CSV's "7" and a JSON 7 are
// one group); a list is one label per element, and the record counts in each (H7); missing,
// null or empty is [] and is grouped as "(none)" (H1). An object has no label to show and would
// pool as "[object Object]", so it stops (H8), naming a field inside it that could be the label.
function readGroups(raw, config, side, where, p) {
  const mine = Object.entries(config.groups).filter(([, g]) => g.from === side);
  if (mine.length === 0) return null;
  const out = {};
  for (const [name, g] of mine) {
    const v = getPath(raw, g.field);
    const labels = [];
    for (const x of Array.isArray(v) ? v : [v]) {
      if (x === undefined || x === null) continue;
      if (!isLabel(x)) {
        const inner = innerText(x);
        p.stop('H8', where, 'group "' + name + '" ("' + g.field + '") is ' + (isObj(x) ? 'an object' : describe(x)) +
          (Array.isArray(v) ? ' inside a list' : '') + '; it must be text, a number, true/false, or a list of them' +
          (inner ? '. Point the group\'s field at the label inside it, such as "' + g.field + '.' + inner + '"' : ''));
        labels.length = 0;
        break;
      }
      const t = String(x).trim();
      if (t !== '' && !labels.includes(t)) labels.push(t);
    }
    out[name] = labels;
  }
  return out;
}

// For an object where a label was expected: the first field inside it holding text, to suggest.
const innerText = x => (isObj(x) ? Object.keys(x).find(k => typeof x[k] === 'string') : undefined);

// The record's cluster (config.clusters), when it is read from this side; undefined otherwise, so
// records stay unchanged without clusters. Read as a group label is (trimmed text, so a CSV's "7"
// and a JSON 7 are one cluster), except that a record is in one cluster: a list stops, even of one
// value, and so does an object, naming a field inside it (trap G15). Missing, null or empty is
// null: the record is a cluster of its own, and the report counts how many were.
function readCluster(raw, config, side, where, p) {
  const c = config.clusters;
  if (!c || c.from !== side) return undefined;
  const v = getPath(raw, c.field);
  if (v === undefined || v === null) return null;
  if (!isLabel(v)) {
    const inner = innerText(v);
    p.stop('G15', where, 'cluster field "' + c.field + '" is ' + (Array.isArray(v)
      ? 'a list; a record is in one cluster. Give each record one value, such as the id of the story or filing it belongs to'
      : (isObj(v) ? 'an object' : describe(v)) + '; it must be text, a number or true/false' +
        (inner ? '. Point clusters.field at the value inside it, such as "' + c.field + '.' + inner + '"' : '')));
    return null;
  }
  const t = String(v).trim();
  return t === '' ? null : t;
}

// ---------- Whole files ----------

// Predictions: what the workflow did.
// Each becomes { id, route, scored, movable, outputs }, plus groups and a cluster when the config
// reads them from the predictions. The route is passed through as given;
// align.js checks it against the config, because that needs the key too.
// opts.sameFile: the answer key is in the same records (see H4 below).
// ---------- How an agent used its tools (`tools` in the config; section R of test/TRAPS.md) ----------

const isToolName = v => typeof v === 'string' && v.trim() !== '';
// n8n and others write a call's arguments as JSON text.
function toolArgs(v) {
  if (typeof v !== 'string') return isObj(v) ? v : {};
  try { const j = JSON.parse(v); return isObj(j) ? j : {}; } catch (e) { return {}; }
}
// A record's calls as [{ name, args }], or undefined. A record with no list is not a record with no
// calls: reading it as none would pass the agent on what nobody saw (R2). A failed model call made none.
function readToolCalls(raw, t, where, p) {
  const list = getPath(raw, t.field);
  if (list === undefined || list === null) {
    p.strict('R2', where, 'has no "' + t.field + '" (tools.field): no list is not the same as no calls. Write [] for a record with none');
    return undefined;
  }
  if (!Array.isArray(list)) { p.stop('R3', where, t.field + ' must be a list of calls, got ' + describe(list)); return undefined; }
  const calls = [];
  for (const c of list) {
    const name = typeof c === 'string' ? c : isObj(c) ? getPath(c, t.name_key) : undefined;
    if (!isToolName(name)) { p.stop('R3', where, 'a call has no tool name at "' + t.name_key + '" (tools.name_key): ' + describe(c)); return undefined; }
    calls.push({ name: name.trim(), args: isObj(c) ? toolArgs(getPath(c, t.args_key)) : {} });
  }
  return calls;
}
// What the key expects of a record: a list is what must run; an object says more. Nothing said is
// not the same as nothing required: it is reported as not measured.
// args_any_of: per tool, the values a field may take (one payee by name or by account number).
// args_not_set: per tool, fields a call must not set at all (a task that changes only an amount).
const EXPECT_KEYS = ['required', 'forbidden', 'order', 'args', 'args_any_of', 'args_not_set', 'max_calls'];
function readToolExpect(raw, t, where, p) {
  const v = getPath(raw, t.key_field);
  if (v === undefined || v === null) return undefined;
  const bad = message => { p.stop('R4', where, t.key_field + ': ' + message); return undefined; };
  const list = x => Array.isArray(x) && x.every(isToolName);
  if (Array.isArray(v)) return list(v) ? { required: v.map(s => s.trim()) } : bad('must list tool names');
  if (!isObj(v)) return bad('must be a list of tool names, or an object with ' + EXPECT_KEYS.join(', ') + ', got ' + describe(v));
  for (const k of Object.keys(v)) if (!EXPECT_KEYS.includes(k)) return bad('unknown key "' + k + '" (allowed: ' + EXPECT_KEYS.join(', ') + ')');
  for (const k of ['required', 'forbidden', 'order']) if (v[k] !== undefined && !list(v[k])) return bad(k + ' must be a list of tool names');
  if (v.args !== undefined && !(isObj(v.args) && Object.values(v.args).every(isObj))) return bad('args must say, per tool, the fields a call must have');
  const lists = x => isObj(x) && Object.values(x).every(l => Array.isArray(l) && l.length > 0);
  if (v.args_any_of !== undefined && !(isObj(v.args_any_of) && Object.values(v.args_any_of).every(lists))) {
    return bad('args_any_of must say, per tool, each field\'s allowed values as a list of one or more');
  }
  if (v.args_not_set !== undefined && !(isObj(v.args_not_set) && Object.values(v.args_not_set).every(l => Array.isArray(l) && l.length > 0 && l.every(isToolName)))) {
    return bad('args_not_set must list, per tool, one or more field names a call must not set');
  }
  if (v.max_calls !== undefined && !(Number.isInteger(v.max_calls) && v.max_calls >= 1)) return bad('max_calls must be a whole number of 1 or more');
  return v;
}

function normalizePredictions(raws, config, source, p, opts = {}) {
  if (raws.length === 0) return [];   // reading the file already reported why
  if (!idsFound(raws, config.id_field, source, 'predictions', p)) return [];
  const rf = config.routing.field;
  if (!raws.some(r => getPath(r, rf) !== undefined)) {
    p.stop('A7', source, 'no record has "' + rf + '". Is this the answer key instead of the predictions?');
    return [];
  }
  const absent = outputsAbsentFromRun(raws, config, source, p, opts.across);

  // Predictions that carry their answers beside them (a combined format): the config says so
  // by reading the key from different fields than the predictions.
  const combined = opts.sameFile || Object.values(config.outputs).some(o => o.key_field !== o.field);

  const out = [];
  const eq = equivalentsReader(config);
  const fieldCtx = { csv: formatOf(source, config.input.predictions) === 'csv', text: [], below: [] };
  // A list of tool calls no record has is a typo, not an agent that called nothing (trap P1).
  const tools = config.tools;
  const readTools = Boolean(tools) && anyHas(raws, tools.field);
  if (tools && !readTools) p.strict('P1', source, noRecord(tools.field, 'tools.field') + ': no tool use can be judged');
  const called = new Set();
  raws.forEach((raw, i) => {
    if (!isObj(raw)) { p.stop('B1', source + ' record #' + (i + 1), 'is ' + describe(raw) + ', not a record'); return; }
    const id = readId(raw, config.id_field, source + ' record #' + (i + 1), p);
    if (id === null) return;
    const where = source + ' ' + markId(id);   // marked: a report may count a record instead of naming it (problems.js)

    // H4: a trap label next to the workflow's output suggests the workflow could see it.
    // Not checked for a combined format, where the key sits in each record by design.
    if (config.trap_field && !combined && getPath(raw, config.trap_field) !== undefined) {
      p.strict('H4', where, 'has the trap field "' + config.trap_field + '": the workflow may have seen what it was being tested on');
    }
    let scored = true;   // C10: false for records where the model produced nothing to score
    if (raw.scored !== undefined) {
      if (typeof raw.scored === 'boolean') scored = raw.scored;
      else p.stop('C10', where, '"scored" must be true or false without quotes, got ' + describe(raw.scored));
    }
    const rec = { id, route: getPath(raw, rf), scored, movable: readMovable(raw, config), outputs: readOutputs(raw, config, where, p, false, eq, scored, absent) };
    const groups = readGroups(raw, config, 'predictions', where, p);
    if (groups) rec.groups = groups;
    const cluster = readCluster(raw, config, 'predictions', where, p);
    if (cluster !== undefined) rec.cluster = cluster;
    const fields = readFields(raw, config, where, p, { ...fieldCtx, id, scored });
    if (fields) rec.fields = fields;
    if (readTools && scored) {
      const calls = readToolCalls(raw, tools, where, p);
      if (calls) { rec.tool_calls = calls; for (const c of calls) called.add(c.name); }
    }
    out.push(rec);
  });
  // A misspelt side effect switches its safety check off without a sound (trap R11).
  if (readTools) for (const s of tools.side_effects) if (!called.has(s)) p.warn('R5', source, 'tools.side_effects names ' + JSON.stringify(s) + ', which no record called: if it is misspelt, that tool is not being watched');
  reportFields(fieldCtx, config, source, p);
  eq.report(p, source, 'predicted');
  return out;
}

// Answer key: what the workflow should have done.
// Each becomes { id, gold_route, traps, duplicate_of, outputs }, plus groups and a cluster when
// the config reads them from the key.
function normalizeKey(raws, config, source, p) {
  if (raws.length === 0) return [];
  if (!idsFound(raws, config.id_field, source, 'key', p)) return [];
  const absent = outputsAbsentFromKey(raws, config, source, p);

  const out = [];
  const eq = equivalentsReader(config);
  raws.forEach((raw, i) => {
    if (!isObj(raw)) { p.stop('B1', source + ' record #' + (i + 1), 'is ' + describe(raw) + ', not a record'); return; }
    const id = readId(raw, config.id_field, source + ' record #' + (i + 1), p);
    if (id === null) return;
    const where = source + ' ' + markId(id);   // marked: a report may count a record instead of naming it (problems.js)

    let traps = [];
    if (config.trap_field) {
      const t = getPath(raw, config.trap_field);
      // Each trap once, and a blank one is no trap (trap P28): a record counts once in a row.
      if (typeof t === 'string' || (Array.isArray(t) && t.every(x => typeof x === 'string'))) traps = [...new Set([].concat(t).map(x => x.trim()).filter(x => x !== ''))];
      else if (t !== undefined && t !== null) p.stop('H3', where, 'the trap field must be text or a list of text, got ' + describe(t));
    }
    const goldRoute = config.routing.gold_field ? getPath(raw, config.routing.gold_field) : null;
    let duplicateOf = null;   // the id of the primary record this one duplicates (align.js checks it exists)
    if (config.duplicate_of_field) {
      const d = getPath(raw, config.duplicate_of_field);
      if (typeof d === 'string' || typeof d === 'number') duplicateOf = String(d).trim() || null;
      else if (d !== undefined && d !== null) p.stop('C9', where, config.duplicate_of_field + ' must be the id of another record, got ' + describe(d));
    }
    const rec = { id, gold_route: goldRoute, traps, duplicate_of: duplicateOf, outputs: readOutputs(raw, config, where, p, true, eq, true, absent) };
    const groups = readGroups(raw, config, 'key', where, p);
    if (groups) rec.groups = groups;
    const cluster = readCluster(raw, config, 'key', where, p);
    if (cluster !== undefined) rec.cluster = cluster;
    if (config.tools) {
      const expect = readToolExpect(raw, config.tools, where, p);
      if (expect) rec.tool_expect = expect;
    }
    out.push(rec);
  });
  eq.report(p, source, 'answer key');
  return out;
}

// ---------- A8: a key that is the run (trap P20) ----------
//
// A run scored against itself reads 0%. It need not be the same file, or the same text: records in
// another order, keys in another order, a note added. So the records are compared by id, on what a
// scorer reads of them (the route and each output's fields), with each object's keys in one order.
// Those alike with confidences beside them: no person writes those, so it is the run. Those alike
// with none: a perfect run can look like that, so it stops only if the whole records are alike too.
//
// Every run pays for one record: the key's first against the run's record of that id, kept as a
// sample, so a key read once for many runs is not kept in memory or read again. Only a run that
// matches it is compared in full, and only then is a key another run read read again.

// A value as text, whatever order its objects' keys were written in. undefined for one nested too
// deep to write out (JSON.parse takes what stringify cannot): such a record is not compared.
const sortKeys = (k, v) => (isObj(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v);
const inOneOrder = x => { try { return JSON.stringify(x, sortKeys); } catch { return undefined; } };
const idText = (r, config) => {
  const v = isObj(r) ? getPath(r, config.id_field) : undefined;
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : undefined;
};
const readPaths = config => [config.routing.field, ...Object.values(config.outputs).flatMap(o => [o.field, o.confidence_field, o.rejected_field])].filter(Boolean);
const readsOf = (r, paths) => inOneOrder(paths.map(f => getPath(r, f)));
// Every output reads the answer from the field the prediction is in: one list of records holds one
// side only. A file with both sides, read from different fields, is a combined format (A10), not this.
const answersReadAsOutputs = config => Object.values(config.outputs).every(o => o.key_field === o.field);
const confidenceIn = (r, o, field) => {
  if (o.confidence_field && getPath(r, o.confidence_field) != null) return true;
  const v = getPath(r, field);
  return (Array.isArray(v) ? v : [v]).some(x => isObj(x) && x[o.confidence_key] != null);
};
const anyConfidence = (r, config) => Object.values(config.outputs).some(o => confidenceIn(r, o, o.field));
// What is kept of a key to test a run against; null when A8 cannot apply to this config.
function keySample(keyRaws, config) {
  if (!answersReadAsOutputs(config)) return null;
  const first = keyRaws.find(isObj);
  const id = idText(first, config);
  return id === undefined ? null : { id, reads: readsOf(first, readPaths(config)) };
}
// sample: keySample's. keyRaws: a function giving the key's records, called only for a run that matches.
function keyIsRun(predRaws, sample, keyRaws, config) {
  if (sample === null || sample.reads === undefined) return false;
  const paths = readPaths(config);
  const twin = predRaws.find(r => idText(r, config) === sample.id);
  if (twin === undefined || readsOf(twin, paths) !== sample.reads) return false;
  const key = keyRaws();
  if (key.length !== predRaws.length) return false;
  const byId = new Map(key.map(r => [idText(r, config), r]));
  let whole = true, confident = false;
  for (const r of predRaws) {
    const k = byId.get(idText(r, config));
    if (k === undefined) return false;
    const reads = readsOf(r, paths);
    if (reads === undefined || reads !== readsOf(k, paths)) return false;
    whole = whole && inOneOrder(r) === inOneOrder(k);
    confident = confident || anyConfidence(r, config);
  }
  return whole || confident;
}
// A key's values with confidences, as a model's have and a person's do not: asked of the first record
// with a value, since a copied run has them throughout. Not the same run, if it got past keyIsRun, but
// beside a run that matches it exactly it is a run all the same (align.js warns).
function keyHasConfidences(raws, config) {
  const filled = r => Object.values(config.outputs).some(o => { const v = getPath(r, o.key_field); return Array.isArray(v) ? v.length > 0 : v != null; });
  const first = raws.find(r => isObj(r) && filled(r));
  return first !== undefined && Object.values(config.outputs).some(o => confidenceIn(first, o, o.key_field));
}

// Loads both files and pairs them up (align.js). Throws, listing every problem, if
// anything must stop scoring. Returns the clean records of each file and the pairs.
// The predictions and key may be the same file (A10); it is then read once.
// Pass `p` to collect problems into an existing list (score.js adds its own checks after).
// keys: a Map one command keeps across the runs it scores against one key, with the config and mode
// the same. Each key is then read once, and later runs get what it said again, at the same places:
// a run's problems are as if it had read the key itself. Nothing changes the key's records after
// this (a ruling copies a record before changing it), so the runs can share them. A run that reads
// its predictions and key as one file reads it as ever, since only one read is said, for the
// predictions; the key it read is kept when that read said nothing, so a later read would not.
// liveRecords: a period of live checks (monitor): the golden set's traps, groups and the like are not
// read there, so a period without them is not asked for them (trap P1).
// across: acrossFiles(), for a command that reads several runs: their outputs are judged together.
// needs: what this command reads of the fields only some commands use (trap P1): { movable: whatif's
// movable_field; clusters: true; groups: names of groups }. Any other field in those settings warns.
function loadRun({ config, predPath, keyPath, mode = 'strict', p = problems(mode), keys = null, liveRecords = false, across = null, needs = {} }) {
  const sameFile = nodePath.resolve(predPath) === nodePath.resolve(keyPath);
  const sameInput = JSON.stringify(config.input.predictions) === JSON.stringify(config.input.key);
  const oneRead = sameFile && sameInput;
  const known = keys && !oneRead ? keys.get(keyPath) : undefined;
  const said = {};
  const keyStep = (step, read) => {
    if (known) {
      for (const item of known.said[step]) p.items.push(item);   // one by one: a messy key can say more than a spread can take
      return known[step];
    }
    const at = p.items.length;
    const out = read();
    said[step] = p.items.slice(at);
    return out;
  };
  let predRaws = readRecords(predPath, p, config.input.predictions);
  const quietRead = p.items.length === 0;
  let keyRaws = keyStep('read', () => (oneRead ? predRaws : readRecords(keyPath, p, config.input.key)));
  // CSV cells are text until decoded. Decoding depends on which side is read (a combined
  // file has prediction columns and key columns), so it happens once per side.
  if (formatOf(predPath, config.input.predictions) === 'csv') predRaws = decodeCsvRecords(predRaws, config, 'predictions', config.input.predictions, predPath, p);
  keyRaws = keyStep('decode', () => (formatOf(keyPath, config.input.key) === 'csv' ? decodeCsvRecords(keyRaws, config, 'key', config.input.key, keyPath, p) : keyRaws));
  // A8 goes by what the files hold, not their names (trap P20).
  const sample = known ? known.sample : keySample(keyRaws, config);
  const sameContent = !sameFile && keyIsRun(predRaws, sample, () => (known ? readKeyAgain(keyPath, config) : keyRaws), config);
  const keyConfident = known ? known.confident : keyHasConfidences(keyRaws, config);
  const predictions = normalizePredictions(predRaws, config, predPath, p, { sameFile, across });
  if (!liveRecords && predRaws.length) runFieldsAbsent(predRaws, config, predPath, p, needs);
  const key = keyStep('key', () => {
    if (!liveRecords && keyRaws.length) keyFieldsAbsent(keyRaws, config, keyPath, p, needs);
    return normalizeKey(keyRaws, config, keyPath, p);
  });
  // Matching half-read files would only add noise (every unread record "missing"),
  // so reading problems are reported on their own first.
  p.throwIfStopped();
  if (keys && !known && (!oneRead || quietRead)) keys.set(keyPath, { key, said, sample, confident: keyConfident });
  const records = align(predictions, key, config, p, { sameFile: sameFile || sameContent, sameContent, keyConfident, predSource: predPath, keySource: keyPath });
  p.throwIfStopped();
  return { predictions, key, records, problems: p.items };
}

// The key's records again, for a run that matched a key another run read (above).
function readKeyAgain(keyPath, config) {
  const quiet = problems('lenient');
  const raws = readRecords(keyPath, quiet, config.input.key);
  return formatOf(keyPath, config.input.key) === 'csv' ? decodeCsvRecords(raws, config, 'key', config.input.key, keyPath, quiet) : raws;
}

// The answer key alone, read as loadRun reads it. compare --after-key checks that two keys
// cover the same records before pairing either with a run (trap I17). Throws on any stop.
function loadKey({ config, keyPath, mode = 'strict' }) {
  const p = problems(mode);
  let raws = readRecords(keyPath, p, config.input.key);
  if (formatOf(keyPath, config.input.key) === 'csv') raws = decodeCsvRecords(raws, config, 'key', config.input.key, keyPath, p);
  const key = normalizeKey(raws, config, keyPath, p);
  p.throwIfStopped();
  return key;
}

module.exports = { getPath, formatOf, parseRecords, readRecords, readId, normalizePredictions, normalizeKey, loadRun, loadKey, keySample, keyIsRun, acrossFiles };
