// Loads and validates the harness config.
//
// validateConfig() is pure: object in, { config, errors } out. It collects every
// problem instead of stopping at the first, so a bad config is fixed in one pass.
// The returned config has every default filled in, so no other module needs to
// know what the defaults are.
const fs = require('fs');
const path = require('path');

const ROUTE_CLASSES = ['auto', 'review', 'block', 'exclude'];
const OUTPUT_TYPES = ['set', 'label'];
const WRONG_WHEN = ['either', 'gold_route', 'any_mismatch'];
const GATE_USES = ['lead', 'weakest'];
const FORMATS = ['json', 'jsonl', 'csv'];
const DELIMITERS = [',', ';', '\t', '|'];
const TOP_LEVEL_KEYS = ['id_field', 'input', 'outputs', 'routing', 'wrong_when', 'thresholds', 'trap_field',
  'duplicate_of_field', 'allowed_values', 'severity', 'min_per_trap', 'calibration', 'whatif'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
// Every silent error type (docs/SILENT_ERRORS.md) and its default severity.
const ERROR_TYPES = {
  'SP-FORBIDDEN': 'critical', 'SP-INVALID': 'critical', 'SP-WRONG': 'high', 'SP-SHOULD-REVIEW': 'medium',
  'SP-MISSING-REJECTED': 'medium', 'SP-MISSING': 'medium', 'SP-WRONG-PRIMARY': 'medium', 'SP-DUPLICATE': 'low',
  'SO-FALSE-DUPLICATE': 'high', 'SO-PRIMARY-SUPPRESSED': 'medium', 'SO-FALSE-BLOCK': 'medium',
  'SG-GATE': 'critical', 'SG-FLOOR': 'critical',
};
const OUTPUT_KEYS = ['type', 'field', 'key_field', 'labels', 'value_key', 'confidence_key', 'rejected_field', 'confidence_field'];
const INPUT_KEYS = ['format', 'records_at', 'unwrap', 'delimiter', 'list_separator', 'confidence_separator'];

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isName = v => typeof v === 'string' && v.length > 0;
const isProb = v => typeof v === 'number' && v >= 0 && v <= 1;
// A field name, or a dotted path into nested fields: "output.subject" is the
// "subject" field inside the "output" field.
const isPath = v => isName(v) && v.split('.').every(part => part.length > 0);
const PATH_RULE = 'must be a field name, or a dotted path like "output.subject"';

function validateConfig(raw) {
  const errors = [];
  if (!isObj(raw)) return { config: null, errors: ['config must be a JSON object'] };

  // A misspelled key ("wrong_whne") would otherwise be ignored and its default
  // used silently - the exact failure this tool exists to measure.
  for (const k of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.includes(k)) errors.push('unknown key "' + k + '" (allowed: ' + TOP_LEVEL_KEYS.join(', ') + ')');
  }

  const idField = raw.id_field === undefined ? 'id' : raw.id_field;
  if (!isPath(idField)) errors.push('id_field ' + PATH_RULE);

  // input: where the records are in each file. Only needed when a file is not a plain
  // list of records. Nothing here is specific to any platform:
  //   format     - "json", "jsonl" (one record per line) or "csv". Default: from the file
  //                extension (.jsonl/.ndjson, .csv, .tsv; anything else is json)
  //   records_at - the list is inside the file, e.g. "data.results" in an API response
  //   unwrap     - each record is inside a field, e.g. "json" in an n8n export
  // CSV only (a spreadsheet cell holds text, so it needs conventions):
  //   delimiter            - between cells: "," (default; tab for .tsv), ";", "\t" or "|"
  //   list_separator       - between several values in one cell (default "|")
  //   confidence_separator - before a value's confidence: "SUBJ-MNA@0.95" (default "@")
  const input = {};
  for (const which of ['predictions', 'key']) {
    input[which] = { format: null, records_at: null, unwrap: null, delimiter: null, list_separator: '|', confidence_separator: '@' };
  }
  const isSeparator = v => isName(v) && !/["\r\n]/.test(v);
  if (raw.input !== undefined) {
    if (!isObj(raw.input)) {
      errors.push('input must be an object');
    } else {
      for (const [which, spec] of Object.entries(raw.input)) {
        if (!(which in input)) { errors.push('unknown key "input.' + which + '" (allowed: predictions, key)'); continue; }
        if (!isObj(spec)) { errors.push('input.' + which + ' must be an object'); continue; }
        for (const [k, v] of Object.entries(spec)) {
          const at = 'input.' + which + '.' + k;
          if (!INPUT_KEYS.includes(k)) { errors.push('unknown key "' + at + '" (allowed: ' + INPUT_KEYS.join(', ') + ')'); continue; }
          if (k === 'format' && !FORMATS.includes(v)) errors.push(at + ' must be one of: ' + FORMATS.join(', '));
          if ((k === 'records_at' || k === 'unwrap') && !isPath(v)) errors.push(at + ' ' + PATH_RULE);
          if (k === 'delimiter' && !DELIMITERS.includes(v)) errors.push(at + ' must be one of: "," ";" "\\t" (tab) "|"');
          if ((k === 'list_separator' || k === 'confidence_separator') && !isSeparator(v)) errors.push(at + ' must be non-empty text without quotes or line breaks');
          input[which][k] = v;
        }
        // The three CSV separators must differ, or a cell could be read two ways.
        const s = input[which];
        if (s.list_separator === s.confidence_separator) errors.push('input.' + which + ': list_separator and confidence_separator are both "' + s.list_separator + '"');
        if (s.delimiter && (s.delimiter === s.list_separator || s.delimiter === s.confidence_separator)) {
          errors.push('input.' + which + ': delimiter "' + s.delimiter + '" is also used as a separator inside cells');
        }
      }
    }
  }

  // outputs: what the workflow assigns. "set" = zero or more values per record
  // (tags, violation codes); "label" = exactly one value from a fixed list (pass/elevate/fail).
  //   field          - where the workflow's values are (default: the output's name)
  //   key_field      - where the answer key's values are (default: same as field). Differs when
  //                    predictions and answers share one file, e.g. "output.x" vs "expected.x"
  //   value_key      - inside a value object, which field holds the value (default "value")
  //   confidence_key - and which holds the confidence (default "confidence")
  //   rejected_field - (sets) a separate field listing values the workflow proposed but did
  //                    not apply; read as applied: false
  //   confidence_field - (labels) a separate field holding the label's confidence, e.g. a
  //                    "confidence" column next to a "verdict" column
  const outputs = {};
  if (!isObj(raw.outputs) || Object.keys(raw.outputs).length === 0) {
    errors.push('outputs must be an object with at least one entry');
  } else {
    for (const [name, o] of Object.entries(raw.outputs)) {
      const at = 'outputs.' + name;
      if (!isObj(o)) { errors.push(at + ' must be an object'); continue; }
      for (const k of Object.keys(o)) {
        if (!OUTPUT_KEYS.includes(k)) errors.push('unknown key "' + at + '.' + k + '" (allowed: ' + OUTPUT_KEYS.join(', ') + ')');
      }
      if (!OUTPUT_TYPES.includes(o.type)) errors.push(at + '.type must be one of: ' + OUTPUT_TYPES.join(', '));
      if (o.field !== undefined && !isPath(o.field)) errors.push(at + '.field ' + PATH_RULE);
      if (o.key_field !== undefined && !isPath(o.key_field)) errors.push(at + '.key_field ' + PATH_RULE);
      if (o.value_key !== undefined && !isName(o.value_key)) errors.push(at + '.value_key must be a non-empty string');
      if (o.confidence_key !== undefined && !isName(o.confidence_key)) errors.push(at + '.confidence_key must be a non-empty string');
      if (o.rejected_field !== undefined) {
        if (!isPath(o.rejected_field)) errors.push(at + '.rejected_field ' + PATH_RULE);
        if (o.type !== 'set') errors.push(at + '.rejected_field only applies to type "set"');
      }
      if (o.confidence_field !== undefined) {
        if (!isPath(o.confidence_field)) errors.push(at + '.confidence_field ' + PATH_RULE);
        if (o.type !== 'label') errors.push(at + '.confidence_field only applies to type "label"');
      }
      if (o.type === 'label') {
        if (!Array.isArray(o.labels) || o.labels.length < 2 || !o.labels.every(isName)) {
          errors.push(at + '.labels must list at least two label names');
        }
      } else if (o.labels !== undefined) {
        errors.push(at + '.labels only applies to type "label"');
      }
      const field = o.field || name;
      outputs[name] = {
        type: o.type,
        field,
        key_field: o.key_field || field,
        labels: o.type === 'label' ? o.labels : null,
        value_key: o.value_key || 'value',
        confidence_key: o.confidence_key || 'confidence',
        rejected_field: o.rejected_field || null,
        confidence_field: o.confidence_field || null,
      };
    }
  }

  // routing: translates this workflow's own decision names into the four classes
  // every metric understands. This map is what keeps the metric code generic.
  const r = raw.routing;
  let routing = null;
  if (!isObj(r)) {
    errors.push('routing must be an object');
  } else {
    const field = r.field === undefined ? 'route' : r.field;
    if (!isPath(field)) errors.push('routing.field ' + PATH_RULE);
    if (r.gold_field !== undefined && !isPath(r.gold_field)) errors.push('routing.gold_field ' + PATH_RULE);
    if (!isObj(r.map) || Object.keys(r.map).length === 0) {
      errors.push('routing.map must map each workflow decision to one of: ' + ROUTE_CLASSES.join(', '));
    } else {
      for (const [decision, cls] of Object.entries(r.map)) {
        if (!ROUTE_CLASSES.includes(cls)) errors.push('routing.map.' + decision + ' is "' + cls + '"; must be one of: ' + ROUTE_CLASSES.join(', '));
      }
      // Without an auto route there is nothing that can publish unseen, so the
      // headline metric would be undefined. Almost certainly a config mistake.
      if (!Object.values(r.map).includes('auto')) errors.push('routing.map has no decision mapped to "auto"');
    }
    routing = { field, map: isObj(r.map) ? r.map : {}, gold_field: r.gold_field || null };
  }

  // wrong_when: what decides that a record needed a human (so letting it through
  // was a silent error, and reviewing it was worth it).
  //   gold_route   - only the answer key's route. Right when the outputs are reasons
  //                  rather than published content (a compliance reviewer's violation codes).
  //   any_mismatch - only whether the outputs match the key. The only option without a gold route.
  //   either       - both. Right when the outputs are what gets published (tags), and the key
  //                  also says where each record should go. The default when a gold route exists.
  const wrongWhen = raw.wrong_when === undefined
    ? (routing && routing.gold_field ? 'either' : 'any_mismatch')
    : raw.wrong_when;
  if (!WRONG_WHEN.includes(wrongWhen)) errors.push('wrong_when must be one of: ' + WRONG_WHEN.join(', '));
  if (wrongWhen !== 'any_mismatch' && routing && !routing.gold_field) errors.push('wrong_when is "' + wrongWhen + '" but routing.gold_field is not set');

  // thresholds: the confidence numbers the workflow used. Optional - only
  // calibration and what-if read them. They act at two levels:
  //   per value  - floor (below: value rejected, never applied)
  //                provisional_below (a label on the value, not a gate)
  //   per record - auto_publish: { facet: threshold }. Only listed facets gate.
  //                A record can auto-publish only if every listed facet passes.
  // gate_uses says which value in a facet is compared to its threshold:
  //   lead    - the strongest value ("is the best tag on this facet strong?")
  //   weakest - the weakest value ("is every tag strong?"). Stricter; a weak
  //             but correct roll-up tag holds back the whole record.
  let thresholds = null;
  if (raw.thresholds !== undefined) {
    const t = raw.thresholds;
    const at = 'thresholds';
    if (!isObj(t)) {
      errors.push(at + ' must be an object');
    } else {
      for (const k of Object.keys(t)) {
        if (!['floor', 'provisional_below', 'auto_publish', 'gate_uses'].includes(k)) errors.push('unknown key "' + at + '.' + k + '"');
      }
      if (t.floor !== undefined && !isProb(t.floor)) errors.push(at + '.floor must be a number from 0 to 1');
      if (t.provisional_below !== undefined && !isProb(t.provisional_below)) errors.push(at + '.provisional_below must be a number from 0 to 1');
      if (isProb(t.floor) && isProb(t.provisional_below) && t.provisional_below < t.floor) {
        errors.push(at + '.provisional_below (' + t.provisional_below + ') is below ' + at + '.floor (' + t.floor + ')');
      }
      const gateUses = t.gate_uses === undefined ? 'lead' : t.gate_uses;
      if (!GATE_USES.includes(gateUses)) errors.push(at + '.gate_uses must be one of: ' + GATE_USES.join(', '));
      const auto = {};
      if (t.auto_publish !== undefined) {
        if (!isObj(t.auto_publish) || Object.keys(t.auto_publish).length === 0) {
          errors.push(at + '.auto_publish must map at least one output name to a threshold');
        } else {
          for (const [facet, v] of Object.entries(t.auto_publish)) {
            if (!outputs[facet]) errors.push(at + '.auto_publish.' + facet + ' is not a declared output');
            if (!isProb(v)) errors.push(at + '.auto_publish.' + facet + ' must be a number from 0 to 1');
            else if (isProb(t.floor) && v < t.floor) errors.push(at + '.auto_publish.' + facet + ' (' + v + ') is below ' + at + '.floor (' + t.floor + ')');
            auto[facet] = v;
          }
        }
      }
      thresholds = {
        floor: isProb(t.floor) ? t.floor : null,
        provisional_below: isProb(t.provisional_below) ? t.provisional_below : null,
        auto_publish: auto,
        gate_uses: gateUses,
      };
    }
  }

  // trap_field: optional field on answer-key records naming what the record is
  // designed to test ("entity-disambiguation", "weak-correct-tag"). Results are then
  // also broken down by trap type, because a good overall rate can hide one kind of
  // trap that fails every time. Read from the key only - the workflow never sees it.
  const trapField = raw.trap_field === undefined ? null : raw.trap_field;
  if (trapField !== null && !isPath(trapField)) errors.push('trap_field ' + PATH_RULE);

  // min_per_trap: every trap type in the key should have at least this many records.
  // One record passing a trap can be luck. Off unless set; in strict mode, below it stops.
  const minPerTrap = raw.min_per_trap === undefined ? null : raw.min_per_trap;
  if (minPerTrap !== null && !(Number.isInteger(minPerTrap) && minPerTrap >= 1)) errors.push('min_per_trap must be a whole number of 1 or more');
  if (minPerTrap !== null && trapField === null) errors.push('min_per_trap is set but trap_field is not');

  // duplicate_of_field: on answer-key records, the id of the primary record this one
  // duplicates. Lets the tool tell "wrong copy kept" from "real record suppressed".
  const duplicateOf = raw.duplicate_of_field === undefined ? null : raw.duplicate_of_field;
  if (duplicateOf !== null && !isPath(duplicateOf)) errors.push('duplicate_of_field ' + PATH_RULE);

  // allowed_values: per set or label output, the complete list of values allowed (a
  // controlled vocabulary). An applied value outside it is an invented value (SP-INVALID).
  // Either the list itself, or { "file": "vocab.json", "field": "code" } to read it from a
  // JSON file next to the config (a list of values, or of objects holding the value in "field").
  const allowed = {};
  if (raw.allowed_values !== undefined) {
    if (!isObj(raw.allowed_values)) errors.push('allowed_values must be an object');
    else {
      for (const [name, v] of Object.entries(raw.allowed_values)) {
        const at = 'allowed_values.' + name;
        if (!outputs[name]) errors.push(at + ' is not a declared output');
        if (Array.isArray(v) && v.length > 0 && v.every(isName)) allowed[name] = v;
        else if (isObj(v) && isName(v.file) && (v.field === undefined || isName(v.field)) && Object.keys(v).every(k => k === 'file' || k === 'field')) allowed[name] = { file: v.file, field: v.field || null };
        else errors.push(at + ' must be a list of values, or { "file": "...", "field": "..." }');
      }
    }
  }

  // severity: override the default severity of any silent error type.
  const severity = { ...ERROR_TYPES };
  if (raw.severity !== undefined) {
    if (!isObj(raw.severity)) errors.push('severity must be an object');
    else {
      for (const [type, level] of Object.entries(raw.severity)) {
        if (!(type in ERROR_TYPES)) errors.push('severity.' + type + ' is not a known error type (known: ' + Object.keys(ERROR_TYPES).join(', ') + ')');
        else if (!SEVERITIES.includes(level)) errors.push('severity.' + type + ' must be one of: ' + SEVERITIES.join(', '));
        else severity[type] = level;
      }
    }
  }

  // calibration.buckets: how stated confidences are grouped.
  //   "distinct" - one bucket per value the model actually used. Models tend to state a few
  //                round numbers (0.6, 0.75, 0.85), and a fixed-width bucket would blur them.
  //   a number   - fixed-width buckets, e.g. 0.1
  //   "auto"     - distinct when the model used 12 values or fewer, otherwise 0.1 (default)
  const calibration = { buckets: 'auto' };
  if (raw.calibration !== undefined) {
    const b = isObj(raw.calibration) ? raw.calibration.buckets : undefined;
    const okWidth = typeof b === 'number' && b > 0 && b <= 0.5;
    if (!isObj(raw.calibration) || Object.keys(raw.calibration).some(k => k !== 'buckets') || !(b === 'auto' || b === 'distinct' || okWidth)) {
      errors.push('calibration must be { "buckets": "auto" | "distinct" | a width such as 0.1 }');
    } else calibration.buckets = b;
  }

  // whatif: which records a what-if may move. A threshold change can only move a record
  // whose route was decided by the confidence gate (or that went through it). Name the
  // prediction field that says so, and its values for those records, e.g.
  // { "movable_field": "decision_branch", "movable_values": [6, 7] }. Without it, a what-if
  // assumes every auto or review route was decided by the gate: an upper bound.
  let whatif = null;
  if (raw.whatif !== undefined) {
    const w = raw.whatif;
    const vals = isObj(w) ? w.movable_values : undefined;
    if (!isObj(w) || !isPath(w.movable_field) || !Array.isArray(vals) || vals.length === 0 ||
        !vals.every(v => isName(v) || Number.isFinite(v)) || Object.keys(w).some(k => k !== 'movable_field' && k !== 'movable_values')) {
      errors.push('whatif must be { "movable_field": "<field>", "movable_values": [<values>] }');
    } else whatif = { movable_field: w.movable_field, movable_values: vals };
  }

  const config = errors.length ? null : {
    id_field: idField, input, outputs, routing, wrong_when: wrongWhen, thresholds, trap_field: trapField,
    min_per_trap: minPerTrap, duplicate_of_field: duplicateOf, allowed_values: allowed, severity, calibration, whatif,
  };
  return { config, errors };
}

// Reads allowed-value lists given as files, relative to the config file's folder.
function resolveAllowedValues(config, configPath) {
  for (const [name, v] of Object.entries(config.allowed_values)) {
    if (Array.isArray(v)) continue;
    const file = path.resolve(path.dirname(configPath), v.file);
    let list;
    try { list = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) {
      throw new Error('allowed_values.' + name + ': cannot read ' + file + ': ' + e.message);
    }
    if (!Array.isArray(list)) throw new Error('allowed_values.' + name + ': ' + file + ' must hold a list');
    const values = list.map(x => (v.field ? (x !== null && typeof x === 'object' ? x[v.field] : undefined) : x));
    if (!values.every(isName)) throw new Error('allowed_values.' + name + ': every entry of ' + file + ' must be ' + (v.field ? 'an object with text in "' + v.field + '"' : 'text'));
    config.allowed_values[name] = values;
  }
  return config;
}

// The only function here that touches the disk. Throws one error listing every problem.
function loadConfig(configPath) {
  let text;
  try { text = fs.readFileSync(configPath, 'utf8'); } catch (e) { throw new Error('cannot read config ' + configPath + ': ' + e.message); }
  let raw;
  try { raw = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { throw new Error('config ' + configPath + ' is not valid JSON: ' + e.message); }
  const { config, errors } = validateConfig(raw);
  if (errors.length) throw new Error('config ' + configPath + ' has ' + errors.length + ' problem(s):\n  - ' + errors.join('\n  - '));
  return resolveAllowedValues(config, configPath);
}

module.exports = { validateConfig, loadConfig, ROUTE_CLASSES, ERROR_TYPES, SEVERITIES };
