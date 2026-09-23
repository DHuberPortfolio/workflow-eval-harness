// Loads and validates the harness config.
//
// validateConfig() is pure: object in, { config, errors } out. It collects every
// problem instead of stopping at the first, so a bad config is fixed in one pass.
// The returned config has every default filled in, so no other module needs to
// know what the defaults are.
const fs = require('fs');

const ROUTE_CLASSES = ['auto', 'review', 'block', 'exclude'];
const OUTPUT_TYPES = ['set', 'label'];
const WRONG_WHEN = ['gold_route', 'any_mismatch'];
const GATE_USES = ['lead', 'weakest'];
const FORMATS = ['json', 'jsonl'];
const TOP_LEVEL_KEYS = ['id_field', 'input', 'outputs', 'routing', 'wrong_when', 'thresholds', 'trap_field'];
const OUTPUT_KEYS = ['type', 'field', 'key_field', 'labels', 'value_key', 'confidence_key'];
const INPUT_KEYS = ['format', 'records_at', 'unwrap'];

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
  //   format     - "json" or "jsonl" (one record per line). Default: from the file extension.
  //   records_at - the list is inside the file, e.g. "data.results" in an API response
  //   unwrap     - each record is inside a field, e.g. "json" in an n8n export
  const input = {};
  for (const which of ['predictions', 'key']) input[which] = { format: null, records_at: null, unwrap: null };
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
          if (k !== 'format' && !isPath(v)) errors.push(at + ' ' + PATH_RULE);
          input[which][k] = v;
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

  // wrong_when: how a record is judged wrong for the routing metrics.
  //   gold_route   - the answer key says where it should have gone (preferred)
  //   any_mismatch - any output differs from the answer key
  // Defaults to gold_route whenever a gold field exists.
  const wrongWhen = raw.wrong_when === undefined
    ? (routing && routing.gold_field ? 'gold_route' : 'any_mismatch')
    : raw.wrong_when;
  if (!WRONG_WHEN.includes(wrongWhen)) errors.push('wrong_when must be one of: ' + WRONG_WHEN.join(', '));
  if (wrongWhen === 'gold_route' && routing && !routing.gold_field) errors.push('wrong_when is "gold_route" but routing.gold_field is not set');

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

  const config = errors.length ? null : { id_field: idField, input, outputs, routing, wrong_when: wrongWhen, thresholds, trap_field: trapField };
  return { config, errors };
}

// The only function here that touches the disk. Throws one error listing every problem.
function loadConfig(path) {
  let text;
  try { text = fs.readFileSync(path, 'utf8'); } catch (e) { throw new Error('cannot read config ' + path + ': ' + e.message); }
  let raw;
  try { raw = JSON.parse(text); } catch (e) { throw new Error('config ' + path + ' is not valid JSON: ' + e.message); }
  const { config, errors } = validateConfig(raw);
  if (errors.length) throw new Error('config ' + path + ' has ' + errors.length + ' problem(s):\n  - ' + errors.join('\n  - '));
  return config;
}

module.exports = { validateConfig, loadConfig, ROUTE_CLASSES };
