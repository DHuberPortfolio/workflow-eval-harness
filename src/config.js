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
const TOP_LEVEL_KEYS = ['id_field', 'outputs', 'routing', 'wrong_when', 'thresholds'];

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isName = v => typeof v === 'string' && v.length > 0;
const isProb = v => typeof v === 'number' && v >= 0 && v <= 1;

function validateConfig(raw) {
  const errors = [];
  if (!isObj(raw)) return { config: null, errors: ['config must be a JSON object'] };

  // A misspelled key ("wrong_whne") would otherwise be ignored and its default
  // used silently - the exact failure this tool exists to measure.
  for (const k of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.includes(k)) errors.push('unknown key "' + k + '" (allowed: ' + TOP_LEVEL_KEYS.join(', ') + ')');
  }

  const idField = raw.id_field === undefined ? 'id' : raw.id_field;
  if (!isName(idField)) errors.push('id_field must be a non-empty string');

  // outputs: what the workflow assigns. "set" = zero or more codes per record
  // (metadata facets); "label" = exactly one value from a fixed list (pass/elevate/fail).
  const outputs = {};
  if (!isObj(raw.outputs) || Object.keys(raw.outputs).length === 0) {
    errors.push('outputs must be an object with at least one entry');
  } else {
    for (const [name, o] of Object.entries(raw.outputs)) {
      const at = 'outputs.' + name;
      if (!isObj(o)) { errors.push(at + ' must be an object'); continue; }
      if (!OUTPUT_TYPES.includes(o.type)) errors.push(at + '.type must be one of: ' + OUTPUT_TYPES.join(', '));
      if (o.field !== undefined && !isName(o.field)) errors.push(at + '.field must be a non-empty string');
      if (o.type === 'label') {
        if (!Array.isArray(o.labels) || o.labels.length < 2 || !o.labels.every(isName)) {
          errors.push(at + '.labels must list at least two label names');
        }
      } else if (o.labels !== undefined) {
        errors.push(at + '.labels only applies to type "label"');
      }
      outputs[name] = { type: o.type, field: o.field || name, labels: o.type === 'label' ? o.labels : null };
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
    if (!isName(field)) errors.push('routing.field must be a non-empty string');
    if (r.gold_field !== undefined && !isName(r.gold_field)) errors.push('routing.gold_field must be a non-empty string');
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

  const config = errors.length ? null : { id_field: idField, outputs, routing, wrong_when: wrongWhen, thresholds };
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
