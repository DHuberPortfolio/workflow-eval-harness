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
//     or a list of plain values (key); a label output is one of those, not a list
//   - confidence is a number from 0 to 1, or null when not given
//   - applied is a real true/false
// Anything that cannot be cleaned up safely is recorded as a problem (see problems.js)
// and named after its trap in test/TRAPS.md. Checks that need both files at once
// (duplicate ids, records missing from one side, unknown routes) are in align.js.
const fs = require('fs');
const nodePath = require('path');
const { problems } = require('./problems.js');
const { csvToRecords, decodeCsvRecords } = require('./csv.js');

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const describe = v => (v === null ? 'null' : v === undefined ? 'nothing' : Array.isArray(v) ? 'a list'
  : typeof v === 'string' ? 'the text ' + JSON.stringify(v) : typeof v);
// Only the record's own fields, never built-in JavaScript properties like "constructor".
const has = (obj, k) => obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, k);

// Reads a field by name or dotted path: "output.subject" is "subject" inside "output".
// A field literally named "output.subject" is used first, because spreadsheet-style
// exports flatten nested fields into names like that (trap A9).
function getPath(obj, path) {
  if (has(obj, path)) return obj[path];
  let cur = obj;
  for (const part of path.split('.')) {
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
  try { text = fs.readFileSync(path, 'utf8'); } catch (e) { p.stop('A1', path, 'cannot read the file: ' + e.message); return []; }
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
  if (typeof v === 'string' && id !== v) p.fix('B8', where, 'trimmed spaces from id ' + JSON.stringify(v));
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
    p.stop('D4', where, 'each value must be text or { "' + vk + '": "..." }, got ' +
      (isObj(item) ? 'an object with no "' + vk + '" text' : describe(item)));
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === '') { p.stop('D9', where, 'the value is empty'); return null; }
  if (trimmed !== value) p.fix('D7', where, 'trimmed spaces from ' + JSON.stringify(value));
  return isKey ? trimmed : { value: trimmed, confidence, applied, inherited };
}

// Reads a set output: a list of values (D1-D9).
function readSet(raw, name, o, where, p, isKey, gated) {
  if (raw === undefined || raw === null) {
    // D1: a prediction without this output means the model returned nothing for it.
    // D2: a key without it means we do not know the right answer, and [] would be a guess.
    if (isKey) p.stop('D2', where, 'the key has no ' + name + '. Write [] if the correct answer is "nothing".');
    return [];
  }
  if (!Array.isArray(raw)) { p.stop('D5', where, name + ' must be a list, got ' + describe(raw)); return []; }

  const kept = new Map();   // value -> the entry kept for it
  raw.forEach((item, i) => {
    const at = where + ' ' + name + '[' + i + ']';
    const v = readValue(item, o, at, p, isKey);
    if (v === null) return;
    const value = isKey ? v : v.value;

    if (!isKey && gated && v.applied && v.confidence === null) {
      p.strict('E1', at, JSON.stringify(value) + ' has no confidence, but ' + name + ' has a confidence gate');
    }
    if (kept.has(value)) {
      // D6: listed twice. A sign something upstream is not de-duplicating.
      p.strict('D6', where, name + ' lists ' + JSON.stringify(value) + ' more than once');
      const prev = kept.get(value);
      if (!isKey && (v.confidence ?? -1) > (prev.confidence ?? -1)) kept.set(value, v);
      return;
    }
    kept.set(value, v);
  });
  return [...kept.values()];
}

// Reads a label output: exactly one value from the declared list (F1-F4).
// extConf: the confidence from a separate field (confidence_field), if the config has one.
function readLabel(raw, name, o, where, p, isKey, gated, extConf) {
  if (raw === undefined || raw === null) { p.stop(isKey ? 'F4' : 'F3', where, name + ' has no label'); return null; }
  if (Array.isArray(raw)) { p.stop('F2', where, name + ' must be one label, got a list'); return null; }
  const v = readValue(raw, o, where + ' ' + name, p, isKey);
  if (v === null) return null;
  const label = isKey ? v : v.value;
  if (!o.labels.includes(label)) {
    const near = o.labels.find(l => l.toLowerCase() === label.toLowerCase());
    p.stop('F1', where, name + ' is ' + JSON.stringify(label) + ', which is not one of: ' + o.labels.join(', ') +
      (near ? ' (did you mean "' + near + '"?)' : ''));
    return null;
  }
  if (isKey) return v;

  if (extConf !== undefined && extConf !== null) {
    // E8: the same confidence given in two places; which one would be right?
    if (v.confidence !== null) { p.stop('E8', where, name + ' has a confidence in two places: with the label and in ' + o.confidence_field); return null; }
    const c = readConfidence(extConf, where + ' ' + o.confidence_field, p);
    if (c === undefined) return null;
    v.confidence = c;
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

function readOutputs(raw, config, where, p, isKey) {
  const gates = config.thresholds ? config.thresholds.auto_publish : {};
  const outputs = {};
  for (const [name, o] of Object.entries(config.outputs)) {
    let value = getPath(raw, isKey ? o.key_field : o.field);
    if (o.type === 'set') {
      if (!isKey && o.rejected_field) value = withRejected(value, raw, name, o, where, p);
      outputs[name] = readSet(value, name, o, where, p, isKey, name in gates);
    } else {
      const extConf = !isKey && o.confidence_field ? getPath(raw, o.confidence_field) : undefined;
      outputs[name] = readLabel(value, name, o, where, p, isKey, name in gates, extConf);
    }
  }
  return outputs;
}

// ---------- Whole files ----------

// Predictions: what the workflow did.
// Each becomes { id, route, scored, outputs }. The route is passed through as given;
// align.js checks it against the config, because that needs the key too.
// opts.sameFile: the answer key is in the same records (see H4 below).
function normalizePredictions(raws, config, source, p, opts = {}) {
  if (raws.length === 0) return [];   // reading the file already reported why
  if (!idsFound(raws, config.id_field, source, 'predictions', p)) return [];
  const rf = config.routing.field;
  if (!raws.some(r => getPath(r, rf) !== undefined)) {
    p.stop('A7', source, 'no record has "' + rf + '". Is this the answer key instead of the predictions?');
    return [];
  }

  const out = [];
  raws.forEach((raw, i) => {
    if (!isObj(raw)) { p.stop('B1', source + ' record #' + (i + 1), 'is ' + describe(raw) + ', not a record'); return; }
    const id = readId(raw, config.id_field, source + ' record #' + (i + 1), p);
    if (id === null) return;
    const where = source + ' ' + id;

    // H4: a trap label next to the workflow's output suggests the workflow could see it.
    // Not checked when predictions and key share one file: there the key is in each
    // record by design.
    if (config.trap_field && !opts.sameFile && getPath(raw, config.trap_field) !== undefined) {
      p.strict('H4', where, 'has the trap field "' + config.trap_field + '": the workflow may have seen what it was being tested on');
    }
    let scored = true;   // C10: false for records where the model produced nothing to score
    if (raw.scored !== undefined) {
      if (typeof raw.scored === 'boolean') scored = raw.scored;
      else p.stop('C10', where, '"scored" must be true or false without quotes, got ' + describe(raw.scored));
    }
    out.push({ id, route: getPath(raw, rf), scored, outputs: readOutputs(raw, config, where, p, false) });
  });
  return out;
}

// Answer key: what the workflow should have done.
// Each becomes { id, gold_route, traps, outputs }.
function normalizeKey(raws, config, source, p) {
  if (raws.length === 0) return [];
  if (!idsFound(raws, config.id_field, source, 'key', p)) return [];

  const out = [];
  raws.forEach((raw, i) => {
    if (!isObj(raw)) { p.stop('B1', source + ' record #' + (i + 1), 'is ' + describe(raw) + ', not a record'); return; }
    const id = readId(raw, config.id_field, source + ' record #' + (i + 1), p);
    if (id === null) return;
    const where = source + ' ' + id;

    let traps = [];
    if (config.trap_field) {
      const t = getPath(raw, config.trap_field);
      if (typeof t === 'string') traps = [t.trim()];
      else if (Array.isArray(t) && t.every(x => typeof x === 'string')) traps = t.map(x => x.trim());
      else if (t !== undefined && t !== null) p.stop('H3', where, 'the trap field must be text or a list of text, got ' + describe(t));
    }
    const goldRoute = config.routing.gold_field ? getPath(raw, config.routing.gold_field) : null;
    out.push({ id, gold_route: goldRoute, traps, outputs: readOutputs(raw, config, where, p, true) });
  });
  return out;
}

// Loads both files. Throws, listing every problem, if anything must stop scoring.
// The predictions and key may be the same file (A10); it is then read once.
function loadRun({ config, predPath, keyPath, mode = 'strict' }) {
  const p = problems(mode);
  const sameFile = nodePath.resolve(predPath) === nodePath.resolve(keyPath);
  const sameInput = JSON.stringify(config.input.predictions) === JSON.stringify(config.input.key);
  let predRaws = readRecords(predPath, p, config.input.predictions);
  let keyRaws = sameFile && sameInput ? predRaws : readRecords(keyPath, p, config.input.key);
  // CSV cells are text until decoded. Decoding depends on which side is read (a combined
  // file has prediction columns and key columns), so it happens once per side.
  if (formatOf(predPath, config.input.predictions) === 'csv') predRaws = decodeCsvRecords(predRaws, config, 'predictions', config.input.predictions, predPath, p);
  if (formatOf(keyPath, config.input.key) === 'csv') keyRaws = decodeCsvRecords(keyRaws, config, 'key', config.input.key, keyPath, p);
  const predictions = normalizePredictions(predRaws, config, predPath, p, { sameFile });
  const key = normalizeKey(keyRaws, config, keyPath, p);
  p.throwIfStopped();
  return { predictions, key, problems: p.items };
}

module.exports = { getPath, formatOf, parseRecords, readRecords, normalizePredictions, normalizeKey, loadRun };
