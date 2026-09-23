// Reads prediction and answer-key files and turns every record into one clean shape.
//
// This is the only place that deals with messy input. Everything after it can rely on:
//   - ids are trimmed text
//   - a set output is a list of { value, confidence, applied, inherited } (predictions)
//     or a list of plain values (key); a label output is one of those, not a list
//   - confidence is a number from 0 to 1, or null when not given
//   - applied is a real true/false
// Anything that cannot be cleaned up safely is recorded as a problem (see problems.js)
// and named after its trap in test/TRAPS.md. Checks that need both files at once
// (duplicate ids, records missing from one side, unknown routes) are in align.js.
const fs = require('fs');
const { problems } = require('./problems.js');

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const describe = v => (v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v === 'string' ? 'the text ' + JSON.stringify(v) : typeof v);

// ---------- Reading a file into a list of plain records (traps A1-A6) ----------

// n8n exports each record as { json: {...}, pairedItem: ... }. These are the only keys
// such an item may have; anything else means it is not an n8n item.
const N8N_KEYS = ['json', 'pairedItem', 'binary', 'error'];
const isN8nItem = d => isObj(d) && isObj(d.json) && Object.keys(d).every(k => N8N_KEYS.includes(k));

function parseRecords(text, source, p) {
  if (text.charCodeAt(0) === 0xFEFF) {
    // Windows PowerShell writes this invisible marker at the start of UTF-8 files.
    text = text.slice(1);
    p.fix('A3', source, 'removed an invisible byte-order mark from the start of the file');
  }
  if (text.trim() === '') { p.stop('A4', source, 'the file is empty'); return []; }

  let data;
  try { data = JSON.parse(text); } catch (e) { p.stop('A2', source, 'not valid JSON: ' + e.message); return []; }

  if (!Array.isArray(data)) {
    const hint = isObj(data)
      ? ' with the keys ' + Object.keys(data).slice(0, 5).join(', ') + '. If the records are inside one of these, export just that list.'
      : '.';
    p.stop('A5', source, 'expected a list of records, got ' + (isObj(data) ? 'an object' : describe(data)) + hint);
    return [];
  }
  if (data.length === 0) { p.stop('A4', source, 'the list of records is empty'); return []; }

  // Unwrap only if EVERY item is n8n-shaped. A mix means something else is going on,
  // and guessing for some records but not others would be worse than not guessing.
  if (data.every(isN8nItem)) {
    p.fix('A6', source, 'read as n8n items: took ' + data.length + ' records out of their "json" field');
    data = data.map(d => d.json);
  }
  return data;
}

function readRecords(path, p) {
  let text;
  try { text = fs.readFileSync(path, 'utf8'); } catch (e) { p.stop('A1', path, 'cannot read the file: ' + e.message); return []; }
  return parseRecords(text, path, p);
}

// ---------- Reading single values ----------

// Returns the id as trimmed text, or null if the record has no usable id (B1, B7, B8).
function readId(raw, idField, where, p) {
  const v = raw[idField];
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

// Reads one value, given as "text" or { value, confidence, applied, inherited_from }.
// Predictions keep confidence and applied; the key keeps only the value (E6).
// Returns null if the value is unusable.
function readValue(item, where, p, isKey) {
  let value;
  let confidence = null;
  let applied = true;       // D11: most exports only list what was applied
  let inherited = false;

  if (typeof item === 'string') {
    value = item;
  } else if (isObj(item) && typeof item.value === 'string') {
    value = item.value;
    if (!isKey) {
      if (item.confidence !== undefined && item.confidence !== null) {
        confidence = readConfidence(item.confidence, where, p);
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
    p.stop('D4', where, 'each value must be text or { "value": "..." }, got ' + (isObj(item) ? 'an object with no "value" text' : describe(item)));
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === '') { p.stop('D9', where, 'the value is empty'); return null; }
  if (trimmed !== value) p.fix('D7', where, 'trimmed spaces from ' + JSON.stringify(value));
  return isKey ? trimmed : { value: trimmed, confidence, applied, inherited };
}

// Reads a set output: a list of values (D1-D9).
function readSet(raw, name, where, p, isKey, gated) {
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
    const v = readValue(item, at, p, isKey);
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
function readLabel(raw, name, labels, where, p, isKey) {
  if (raw === undefined || raw === null) { p.stop(isKey ? 'F4' : 'F3', where, name + ' has no label'); return null; }
  if (Array.isArray(raw)) { p.stop('F2', where, name + ' must be one label, got a list'); return null; }
  const v = readValue(raw, where + ' ' + name, p, isKey);
  if (v === null) return null;
  const label = isKey ? v : v.value;
  if (!labels.includes(label)) {
    const near = labels.find(l => l.toLowerCase() === label.toLowerCase());
    p.stop('F1', where, name + ' is ' + JSON.stringify(label) + ', which is not one of: ' + labels.join(', ') +
      (near ? ' (did you mean "' + near + '"?)' : ''));
    return null;
  }
  return v;
}

function readOutputs(raw, config, where, p, isKey) {
  const gates = config.thresholds ? config.thresholds.auto_publish : {};
  const outputs = {};
  for (const [name, o] of Object.entries(config.outputs)) {
    outputs[name] = o.type === 'set'
      ? readSet(raw[o.field], name, where, p, isKey, name in gates)
      : readLabel(raw[o.field], name, o.labels, where, p, isKey);
  }
  return outputs;
}

// ---------- Whole files ----------

// Predictions: what the workflow did.
// Each becomes { id, route, scored, outputs }. The route is passed through as given;
// align.js checks it against the config, because that needs the key too.
function normalizePredictions(raws, config, source, p) {
  if (raws.length === 0) return [];   // reading the file already reported why
  const rf = config.routing.field;
  if (!raws.some(r => isObj(r) && r[rf] !== undefined)) {
    p.stop('A7', source, 'no record has a "' + rf + '" field. Is this the answer key instead of the predictions?');
    return [];
  }

  const out = [];
  raws.forEach((raw, i) => {
    if (!isObj(raw)) { p.stop('B1', source + ' record #' + (i + 1), 'is ' + describe(raw) + ', not a record'); return; }
    const id = readId(raw, config.id_field, source + ' record #' + (i + 1), p);
    if (id === null) return;
    const where = source + ' ' + id;

    if (config.trap_field && raw[config.trap_field] !== undefined) {
      p.strict('H4', where, 'has the trap field "' + config.trap_field + '": the workflow may have seen what it was being tested on');
    }
    let scored = true;   // C10: false for records where the model produced nothing to score
    if (raw.scored !== undefined) {
      if (typeof raw.scored === 'boolean') scored = raw.scored;
      else p.stop('C10', where, '"scored" must be true or false without quotes, got ' + describe(raw.scored));
    }
    out.push({ id, route: raw[rf], scored, outputs: readOutputs(raw, config, where, p, false) });
  });
  return out;
}

// Answer key: what the workflow should have done.
// Each becomes { id, gold_route, traps, outputs }.
function normalizeKey(raws, config, source, p) {
  const out = [];
  raws.forEach((raw, i) => {
    if (!isObj(raw)) { p.stop('B1', source + ' record #' + (i + 1), 'is ' + describe(raw) + ', not a record'); return; }
    const id = readId(raw, config.id_field, source + ' record #' + (i + 1), p);
    if (id === null) return;
    const where = source + ' ' + id;

    let traps = [];
    if (config.trap_field) {
      const t = raw[config.trap_field];
      if (typeof t === 'string') traps = [t.trim()];
      else if (Array.isArray(t) && t.every(x => typeof x === 'string')) traps = t.map(x => x.trim());
      else if (t !== undefined && t !== null) p.stop('H3', where, 'the trap field must be text or a list of text, got ' + describe(t));
    }
    const goldRoute = config.routing.gold_field ? raw[config.routing.gold_field] : null;
    out.push({ id, gold_route: goldRoute, traps, outputs: readOutputs(raw, config, where, p, true) });
  });
  return out;
}

// Loads both files. Throws, listing every problem, if anything must stop scoring.
function loadRun({ config, predPath, keyPath, mode = 'strict' }) {
  const p = problems(mode);
  const predictions = normalizePredictions(readRecords(predPath, p), config, predPath, p);
  const key = normalizeKey(readRecords(keyPath, p), config, keyPath, p);
  p.throwIfStopped();
  return { predictions, key, problems: p.items };
}

module.exports = { parseRecords, readRecords, normalizePredictions, normalizeKey, loadRun };
