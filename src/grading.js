// Free-text outputs, graded by a person.
//
// A free-text field (a paragraph of an assessment form) has no answer key to compare with.
// Instead a reviewer reads each field beside its source (the transcript) and gives it one of
// three grades, and the grades are then scored as labels (metrics/grades.js):
//   faithful - everything in it is supported by the source, and nothing it should hold is left out
//   invented - it says something the source does not support (the serious error)
//   missing  - it leaves out something the source says that belongs in it, and invents nothing
// A field that does both is graded invented, with the kind "also leaves something out", so
// every field has exactly one grade (trap J10). Kinds are tags on an invented grade that say
// how it was invented ("figure altered", "contradiction smoothed over"); they are listed in
// the grading config, so nothing here knows about any particular workflow.
//
// This file reads three things, and nothing in it calls a model or the network:
//   the grading config  - where the forms' fields and source are, their sections, the kinds
//   the forms           - the workflow's output, through load.js's file reading
//   a grades file       - what the grading page saved (format GRADES_FORMAT)
const fs = require('fs');
const crypto = require('crypto');
const { problems } = require('./problems.js');
const { readRecords, readId, getPath } = require('./load.js');

const GRADES = ['faithful', 'invented', 'missing'];
const GRADES_FORMAT = 'wfeval-grades/1';
const DEFAULT_KINDS = ['figure altered', 'contradiction smoothed over', 'also leaves something out'];
const CONFIG_KEYS = ['title', 'id_field', 'input', 'source_field', 'fields', 'kinds'];
const FIELD_KEYS = ['field', 'section', 'label'];
const INPUT_KEYS = ['format', 'records_at', 'unwrap', 'delimiter'];

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isName = v => typeof v === 'string' && v.trim().length > 0;
const isPath = v => isName(v) && v.split('.').every(part => part.length > 0);
const describe = v => (v === null ? 'null' : v === undefined ? 'nothing' : Array.isArray(v) ? 'a list' : typeof v === 'string' ? 'the text ' + JSON.stringify(v) : typeof v);

// ---------- The grading config ----------

// Pure: object in, { config, errors } out, every problem listed at once (like config.js).
function validateGradingConfig(raw) {
  const errors = [];
  if (!isObj(raw)) return { config: null, errors: ['grading config must be a JSON object'] };
  for (const k of Object.keys(raw)) if (!CONFIG_KEYS.includes(k)) errors.push('unknown key "' + k + '" (allowed: ' + CONFIG_KEYS.join(', ') + ')');
  const idField = raw.id_field === undefined ? 'id' : raw.id_field;
  if (!isPath(idField)) errors.push('id_field must be a field name, or a dotted path like "output.id"');
  if (raw.title !== undefined && !isName(raw.title)) errors.push('title must be non-empty text');
  if (raw.source_field !== undefined && !isPath(raw.source_field)) errors.push('source_field must be a field name, or a dotted path');

  const input = { format: null, records_at: null, unwrap: null, delimiter: null, list_separator: '|', confidence_separator: '@' };
  if (raw.input !== undefined) {
    if (!isObj(raw.input)) errors.push('input must be an object');
    else for (const [k, v] of Object.entries(raw.input)) {
      if (!INPUT_KEYS.includes(k)) { errors.push('unknown key "input.' + k + '" (allowed: ' + INPUT_KEYS.join(', ') + ')'); continue; }
      if (k === 'format' && !['json', 'jsonl', 'csv'].includes(v)) errors.push('input.format must be one of: json, jsonl, csv');
      if ((k === 'records_at' || k === 'unwrap') && !isPath(v)) errors.push('input.' + k + ' must be a field name, or a dotted path');
      if (k === 'delimiter' && ![',', ';', '\t', '|'].includes(v)) errors.push('input.delimiter must be one of: "," ";" "\\t" (tab) "|"');
      input[k] = v;
    }
  }

  // fields: every free-text field to grade, in the order the page shows them.
  const fields = [];
  if (!isObj(raw.fields) || Object.keys(raw.fields).length === 0) {
    errors.push('fields must be an object with at least one entry');
  } else {
    for (const [name, f] of Object.entries(raw.fields)) {
      const at = 'fields.' + name;
      if (!isObj(f)) { errors.push(at + ' must be an object'); continue; }
      for (const k of Object.keys(f)) if (!FIELD_KEYS.includes(k)) errors.push('unknown key "' + at + '.' + k + '" (allowed: ' + FIELD_KEYS.join(', ') + ')');
      if (f.field !== undefined && !isPath(f.field)) errors.push(at + '.field must be a field name, or a dotted path');
      if (f.section !== undefined && !isName(f.section)) errors.push(at + '.section must be non-empty text');
      if (f.label !== undefined && !isName(f.label)) errors.push(at + '.label must be non-empty text');
      fields.push({ name, field: f.field || name, section: f.section || null, label: f.label || name });
    }
  }

  // kinds: how an invented field was invented, offered as tick boxes on the page.
  let kinds = DEFAULT_KINDS;
  if (raw.kinds !== undefined) {
    if (!Array.isArray(raw.kinds) || !raw.kinds.every(isName) || new Set(raw.kinds).size !== raw.kinds.length) errors.push('kinds must be a list of distinct, non-empty texts');
    else kinds = raw.kinds;
  }

  const config = errors.length ? null : { title: raw.title || null, id_field: idField, input, source_field: raw.source_field || null, fields, kinds };
  return { config, errors };
}

function loadGradingConfig(file) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { throw new Error('cannot read grading config ' + file + ': ' + e.message); }
  const { config, errors } = validateGradingConfig(raw);
  if (errors.length) throw new Error('grading config ' + file + ' has ' + errors.length + ' problem(s):\n  - ' + errors.join('\n  - '));
  return config;
}

// ---------- The forms ----------

// A field's text. Numbers and true/false become text; null or absent is an empty field, which
// is still graded (an empty field can leave something out, trap J13). Anything else stops.
function readText(v, where, p) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  p.stop('J13', where, 'must be text, got ' + describe(v));
  return null;
}

// Reads the workflow's output: [{ id, source, fields: [{ name, text }] }], in file order.
// Throws, listing every problem, if anything must stop.
function readForms({ config, predPath, mode = 'strict' }) {
  const p = problems(mode);
  const raws = readRecords(predPath, p, config.input);
  const forms = [];
  const seen = new Set();
  raws.forEach((raw, i) => {
    const at = predPath + ' record #' + (i + 1);
    if (!isObj(raw)) { p.stop('B1', at, 'is ' + describe(raw) + ', not a record'); return; }
    const id = readId(raw, config.id_field, at, p);
    if (id === null) return;
    if (seen.has(id)) { p.stop('B2', predPath, 'id "' + id + '" appears more than once'); return; }
    seen.add(id);
    const where = predPath + ' ' + id;
    let source = null;
    if (config.source_field) {
      source = readText(getPath(raw, config.source_field), where + ' ' + config.source_field, p);
      // Grading without the source means grading from memory.
      if (source === '') p.strict('J13', where, 'has no source text in "' + config.source_field + '"');
    }
    const fields = config.fields.map(f => ({ name: f.name, text: readText(getPath(raw, f.field), where + ' ' + f.field, p) }));
    forms.push({ id, source, fields });
  });
  p.throwIfStopped();
  return { forms, fingerprint: fingerprint(forms), problems: p.items };
}

// Identifies exactly what was graded: the ids, the source texts and every field's text, in
// order. Two grades files are compared only if they graded the same thing (trap J7).
function fingerprint(forms) {
  const canonical = JSON.stringify(forms.map(f => [f.id, f.source, f.fields.map(x => [x.name, x.text])]));
  return 'sha256:' + crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ---------- A grades file ----------

// Reads what the grading page saved. Returns
//   { file, reviewer, fingerprint, title, fields: [{ name, section }], kinds, forms: [ids],
//     grades: Map("form\u0000field" -> { form, field, grade, kinds, note }), ungraded: [{ form, field }] }
// and records problems in p (traps J1-J6, J10).
function readGrades(file, p) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) {
    p.stop('J1', file, 'cannot read it as JSON: ' + e.message);
    return null;
  }
  if (!isObj(data) || data.format !== GRADES_FORMAT) {
    p.stop('J1', file, 'is not a grades file from the grading page (expected "format": "' + GRADES_FORMAT + '", got ' + describe(isObj(data) ? data.format : data) + ')');
    return null;
  }
  const lists = ['fields', 'forms', 'grades', 'kinds'];
  for (const k of lists) if (!Array.isArray(data[k])) { p.stop('J1', file, '"' + k + '" must be a list'); return null; }
  if (!isName(data.fingerprint)) { p.stop('J1', file, 'has no "fingerprint" saying which forms were graded'); return null; }

  const fields = [];
  for (const f of data.fields) {
    if (!isObj(f) || !isName(f.name)) { p.stop('J1', file, 'every entry of "fields" needs a "name"'); return null; }
    fields.push({ name: f.name, section: isName(f.section) ? f.section : null });
  }
  const fieldNames = new Set(fields.map(f => f.name));
  const forms = data.forms.map(String);
  const formIds = new Set(forms);
  const kinds = data.kinds.filter(isName);

  const stopsBefore = p.items.filter(i => i.level === 'stop').length;
  const grades = new Map();
  data.grades.forEach((g, i) => {
    const at = file + ' grades[' + i + ']';
    if (!isObj(g)) { p.stop('J1', at, 'is ' + describe(g) + ', not a grade'); return; }
    const form = g.form === undefined || g.form === null ? '' : String(g.form);
    // J3: a grade for something this file does not list.
    if (!formIds.has(form)) { p.stop('J3', at, 'grades form ' + JSON.stringify(form) + ', which is not in this file\'s list of forms'); return; }
    if (!fieldNames.has(g.field)) { p.stop('J3', at, 'grades field ' + JSON.stringify(g.field) + ', which is not in this file\'s list of fields'); return; }
    const where = file + ' ' + form + ' ' + g.field;
    // J2: grades are labels, read exactly as labels are (trap F1): spaces trimmed, case never guessed.
    if (typeof g.grade !== 'string') { p.stop('J2', where, 'grade must be one of: ' + GRADES.join(', ') + '; got ' + describe(g.grade)); return; }
    const grade = g.grade.trim();
    if (grade !== g.grade) p.fix('J2', where, 'trimmed spaces from grade ' + JSON.stringify(g.grade));
    if (!GRADES.includes(grade)) {
      const near = GRADES.find(x => x === grade.toLowerCase());
      p.stop('J2', where, 'grade ' + JSON.stringify(g.grade) + ' is not one of: ' + GRADES.join(', ') + (near ? ' (did you mean "' + near + '"?)' : ''));
      return;
    }
    const key = form + '\u0000' + g.field;
    // J4: one field, two grades. Which one is the reviewer's?
    if (grades.has(key)) { p.stop('J4', where, 'is graded more than once'); return; }
    let tags = [];
    if (g.kinds !== undefined && g.kinds !== null) {
      if (!Array.isArray(g.kinds) || !g.kinds.every(isName)) { p.stop('J6', where, '"kinds" must be a list of texts'); return; }
      const unknown = g.kinds.filter(k => !kinds.includes(k));
      if (unknown.length) { p.stop('J6', where, 'kind(s) ' + unknown.map(k => JSON.stringify(k)).join(', ') + ' are not in this file\'s list of kinds'); return; }
      tags = g.kinds;
      // J6: kinds say how a field was invented; on another grade they contradict it.
      if (tags.length && grade !== 'invented') p.strict('J6', where, 'is graded ' + grade + ' but has kinds (' + tags.join(', ') + '), which describe an invented field');
    }
    const note = typeof g.note === 'string' ? g.note.trim() : '';
    grades.set(key, { form, field: g.field, grade, kinds: tags, note });
  });

  // J5: a field left ungraded. On a golden set every field must be graded; with --lenient it
  // is left out of the rates and counted as ungraded.
  // Only once every grade read cleanly: a rejected grade would otherwise also count as missing.
  const ungraded = [];
  for (const form of forms) for (const f of fields) if (!grades.has(form + '\u0000' + f.name)) ungraded.push({ form, field: f.name });
  if (ungraded.length && p.items.filter(i => i.level === 'stop').length === stopsBefore) {
    const shown = ungraded.slice(0, 10).map(u => u.form + ' ' + u.field).join(', ');
    p.strict('J5', file, ungraded.length + ' field(s) not graded: ' + shown + (ungraded.length > 10 ? ' and ' + (ungraded.length - 10) + ' more' : ''));
  }
  return {
    file, reviewer: isName(data.reviewer) ? data.reviewer.trim() : null, fingerprint: data.fingerprint,
    title: isName(data.title) ? data.title : null, fields, kinds, forms, grades, ungraded,
  };
}

module.exports = { GRADES, GRADES_FORMAT, DEFAULT_KINDS, validateGradingConfig, loadGradingConfig, readForms, fingerprint, readGrades };
