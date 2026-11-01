// Routing policies for wfeval whatif --policies and --hold-if (traps E10-E19): read, checked,
// and the prediction fields they need. The arithmetic is in metrics/policy.js.
//
//   { "policies": [
//       { "name": "Award claims go to a person",
//         "hold_if": [{ "output": "violations", "value": "AWARD_CLAIM_REVIEW" }] },
//       { "name": "Weak matches to a person", "hold_if": [{ "field": "match_strength", "below": 0.5 }] },
//       { "name": "Gate 0.90 for everyone", "auto_publish": { "violations": 0.9 } },
//       { "name": "Cap each client's gate at 0.85", "auto_publish_cap": { "violations": 0.85 } } ] }
//
// hold_if is a list of conditions. A record that went out without review is sent to a person
// when ANY condition holds; a condition holds when ALL its clauses hold. Clauses:
//   output                the output (a set or a label) states a value that matches all of:
//     value or values       that value, or one of these (left out: any value)
//     applied               true: applied; false: stated but not applied (left out: either)
//     confidence_at_least   stated at this confidence or more (a value with none never is)
//   field                 a prediction field (never the answer key, trap E17; never the route,
//                         E13), and one of:
//     equals or in          that value, or one of these (sameValue in metrics/policy.js: numbers
//                           as numbers, true/false in any case, other text exactly, trimmed)
//     below or at_least     a number under, or at or above, this one
// Values are trimmed and read through the config's equivalents, as the predictions are (D23);
// "*" as a value means any value, as on the command line. A declined label is a stated value
// ("(declined)"), so "any value" holds it: a decline that went out unseen is one a person may
// want to see.
// A condition with both an output and a field clause holds when both do. For more clauses that
// must hold together (two fields, or two values both stated), a condition is { "all": [...] }:
// every condition in the list holds. So any rule built from these clauses with "and" and "or"
// can be written: a list ("or") of "all" groups ("and").
//
// auto_publish sets a gated output's threshold for every record; auto_publish_cap lowers each
// record's own to at most this (the lower of the two). Both are gate what-ifs: they move only
// records the gate can move (whatif.js), and rest on the same assumption.

const fs = require('fs');
const { problems } = require('./problems.js');
const { equivalentOf, DECLINED } = require('./config.js');

const POLICY_KEYS = ['name', 'hold_if', 'auto_publish', 'auto_publish_cap'];
const CONDITION_KEYS = ['all', 'output', 'value', 'values', 'applied', 'confidence_at_least', 'field', 'equals', 'in', 'below', 'at_least'];
const COMPARISONS = ['equals', 'in', 'below', 'at_least'];
const VALUE_CLAUSES = ['value', 'values', 'applied', 'confidence_at_least'];
const AS_RUN = 'as run';
// Operators the quick form does not have, and what to write instead.
const NOT_AN_OPERATOR = 'use < or >= (there is no <=, > or ==): field:match<0.5, field:match>=0.5, field:client=north';

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isName = v => typeof v === 'string' && v.trim().length > 0;
const isPath = v => isName(v) && v.split('.').every(part => part.length > 0);
const isProb = v => typeof v === 'number' && v >= 0 && v <= 1;
// What equals and in compare: text, a number or true/false, as trimmed text (as group labels are).
const isLabel = x => typeof x === 'string' || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x));
const describe = v => (v === null ? 'null' : v === undefined ? 'nothing' : Array.isArray(v) ? 'a list'
  : typeof v === 'string' ? 'the text ' + JSON.stringify(v) : typeof v);

// The answer key's fields, which a policy may not read (trap E17): a routing rule can only use
// what the workflow knew when it routed. A field the predictions also use for an output or the
// route is the workflow's own (both files may use the same names).
// A group or cluster the config reads from the key may name a field the predictions also have
// (a ticket's channel): with two files, a policy then reads the prediction's own. It stops (E17,
// checkPolicyData) when no prediction has it, and whenever the predictions and the key are one
// file: there every record carries the key's fields, so the field is the answer key's.
function keyPaths(config) {
  const own = new Set([config.routing.field, ...Object.values(config.outputs).map(o => o.field)]);
  const key = [config.routing.gold_field, config.trap_field, config.duplicate_of_field,
    ...Object.values(config.outputs).map(o => o.key_field)];
  return key.filter(k => typeof k === 'string' && !own.has(k));
}
// The config's name for a key-side group or cluster reading this field, or null.
function keySideGroup(field, config) {
  const g = Object.entries(config.groups || {}).find(([, x]) => x.from === 'key' && x.field === field);
  if (g) return 'groups.' + g[0] + '.from';
  return config.clusters && config.clusters.from === 'key' && config.clusters.field === field ? 'clusters.from' : null;
}
const readsKey = (field, config) => keyPaths(config).find(k => field === k || field.startsWith(k + '.') || k.startsWith(field + '.'));

// One condition's problems: [trap, message] pairs, so the file and --hold-if report them alike.
function conditionProblems(c, config) {
  if (!isObj(c)) return [['E12', 'a condition must be an object such as { "output": "codes", "value": "B" }, got ' + describe(c)]];
  if (c.all !== undefined) {
    if (Object.keys(c).length > 1) return [['E12', '"all" stands alone in its condition: put the other clauses inside its list']];
    if (!Array.isArray(c.all) || c.all.length === 0) return [['E12', '"all" must be a list of at least one condition']];
    return c.all.flatMap(x => conditionProblems(x, config));
  }
  const out = [];
  for (const k of Object.keys(c)) if (!CONDITION_KEYS.includes(k)) out.push(['E12', 'unknown key "' + k + '" (allowed: ' + CONDITION_KEYS.join(', ') + ')']);
  if (c.output === undefined && c.field === undefined) out.push(['E12', 'needs "output" or "field": what the condition looks at']);
  if (c.output !== undefined) {
    const o = typeof c.output === 'string' ? config.outputs[c.output] : undefined;
    if (!o) out.push(['E13', 'output ' + JSON.stringify(c.output) + ' is not declared in the config (outputs: ' + Object.keys(config.outputs).join(', ') + ')']);
    else if (o.type !== 'set' && o.field === config.routing.field) out.push(['E13', 'output "' + c.output + '" is the route itself; a policy changes routes, so it cannot read them']);
    if (c.value !== undefined && c.values !== undefined) out.push(['E12', 'give "value" or "values", not both']);
    if (c.value !== undefined && !isName(c.value)) out.push(['E12', '"value" must be text, got ' + describe(c.value)]);
    if (c.values !== undefined && !(Array.isArray(c.values) && c.values.length > 0 && c.values.every(isName))) out.push(['E12', '"values" must be a list of text, got ' + describe(c.values)]);
    else if (Array.isArray(c.values) && c.values.length > 1 && c.values.some(v => v.trim() === '*')) out.push(['E12', '"*" means any value, so it stands alone: give "value": "*" or a list of values without it']);
    if (c.applied !== undefined && typeof c.applied !== 'boolean') out.push(['E12', '"applied" must be true or false without quotes, got ' + describe(c.applied)]);
    if (c.confidence_at_least !== undefined && !isProb(c.confidence_at_least)) out.push(['E12', '"confidence_at_least" must be a number from 0 to 1, got ' + describe(c.confidence_at_least)]);
  } else {
    for (const k of VALUE_CLAUSES) if (c[k] !== undefined) out.push(['E12', '"' + k + '" goes with "output"']);
  }
  const given = COMPARISONS.filter(k => c[k] !== undefined);
  if (c.field !== undefined) {
    if (!isPath(c.field)) out.push(['E12', '"field" must be a field name, or a dotted path like "output.match", got ' + describe(c.field)]);
    else if (c.field === config.routing.field) {
      out.push(['E13', 'field "' + c.field + '" is the route itself (routing.field): it holds the route as run, not the route under the policy, so a policy cannot read it']);
    } else {
      const k = readsKey(c.field, config);
      if (k) out.push(['E17', 'field "' + c.field + '" is read from the answer key ("' + k + '"); a routing policy can only use what the workflow knew']);
    }
    if (given.length !== 1) out.push(['E12', 'a field condition needs exactly one of equals, in, below, at_least' + (given.length ? ', got ' + given.join(' and ') : '')]);
    if (c.equals !== undefined && !isLabel(c.equals)) out.push(['E12', '"equals" must be text, a number or true/false, got ' + describe(c.equals)]);
    if (c.in !== undefined && !(Array.isArray(c.in) && c.in.length > 0 && c.in.every(isLabel))) out.push(['E12', '"in" must be a list of text, numbers or true/false, got ' + describe(c.in)]);
    for (const k of ['below', 'at_least']) if (c[k] !== undefined && !Number.isFinite(c[k])) out.push(['E12', '"' + k + '" must be a number, got ' + describe(c[k])]);
  } else {
    for (const k of given) out.push(['E12', '"' + k + '" goes with "field"']);
  }
  return out;
}

// A threshold change: { output: number } for gated outputs only.
function thresholdProblems(changes, key, config) {
  if (!isObj(changes) || Object.keys(changes).length === 0) return [['E12', '"' + key + '" must map a gated output to a number from 0 to 1']];
  const gates = config.thresholds ? config.thresholds.auto_publish : {};
  const out = [];
  for (const [o, x] of Object.entries(changes)) {
    if (!config.outputs[o]) out.push(['E13', key + ': output "' + o + '" is not declared in the config']);
    else if (!(o in gates)) out.push(['E13', key + ': output "' + o + '" has no auto_publish threshold in the config, so there is no gate to change']);
    if (!isProb(x)) out.push(['E12', key + '.' + o + ' must be a number from 0 to 1, got ' + describe(x)]);
  }
  return out;
}

// The policies file's contents, checked (E10-E13, E17: all stop). Returns the policies, each
// { name, hold_if, auto_publish, auto_publish_cap } with null for what it does not set.
function readPolicies(raw, config, source, p = problems('strict')) {
  if (!isObj(raw) || !Array.isArray(raw.policies) || raw.policies.length === 0) {
    p.stop('E10', source, 'must be { "policies": [ { "name": ..., "hold_if": [...] }, ... ] } with at least one policy');
    p.throwIfStopped();
  }
  for (const k of Object.keys(raw)) if (k !== 'policies') p.stop('E12', source, 'unknown key "' + k + '" (the file holds only "policies")');
  const seen = new Set();
  const policies = raw.policies.map((pol, i) => {
    const at = source + ' policy #' + (i + 1);
    if (!isObj(pol)) { p.stop('E11', at, 'must be an object with a "name", got ' + describe(pol)); return null; }
    const where = isName(pol.name) ? source + ' "' + pol.name.trim() + '"' : at;
    if (pol.name !== undefined && typeof pol.name !== 'string') p.stop('E11', at, '"name" must be text, got ' + describe(pol.name));
    else if (!isName(pol.name)) p.stop('E11', at, 'needs a "name": the row it is shown as');
    else if (pol.name.trim().toLowerCase() === AS_RUN) p.stop('E11', where, '"' + AS_RUN + '" is the row for the run as it was; give the policy another name');
    else if (seen.has(pol.name.trim())) p.stop('E11', where, 'the file names "' + pol.name.trim() + '" twice; each row needs its own name');
    if (isName(pol.name)) seen.add(pol.name.trim());
    for (const k of Object.keys(pol)) if (!POLICY_KEYS.includes(k)) p.stop('E12', where, 'unknown key "' + k + '" (allowed: ' + POLICY_KEYS.join(', ') + ')');
    if (pol.hold_if === undefined && pol.auto_publish === undefined && pol.auto_publish_cap === undefined) {
      p.stop('E11', where, 'has no rule (hold_if, auto_publish or auto_publish_cap): it would be the run as it was, tried twice');
    }
    if (pol.hold_if !== undefined) {
      if (!Array.isArray(pol.hold_if) || pol.hold_if.length === 0) p.stop('E12', where, '"hold_if" must be a list of at least one condition');
      else pol.hold_if.forEach((c, j) => { for (const [trap, m] of conditionProblems(c, config)) p.stop(trap, where + ' hold_if #' + (j + 1), m); });
    }
    for (const key of ['auto_publish', 'auto_publish_cap']) {
      if (pol[key] !== undefined) for (const [trap, m] of thresholdProblems(pol[key], key, config)) p.stop(trap, where, m);
    }
    return {
      name: isName(pol.name) ? pol.name.trim() : null,
      hold_if: Array.isArray(pol.hold_if) ? pol.hold_if.map(c => normalize(c, config, where, p)) : null,
      auto_publish: pol.auto_publish || null,
      auto_publish_cap: pol.auto_publish_cap || null,
    };
  });
  p.throwIfStopped();
  return policies;
}

// A condition in the one form the arithmetic reads: "value" as a list of one, "*" as any value,
// values trimmed and read through the config's equivalents (D23, a FIX naming each one renamed),
// equals and in trimmed.
function normalize(c, config, where, p) {
  if (!isObj(c)) return c;   // already reported (E12)
  if (Array.isArray(c.all)) return { all: c.all.map(x => normalize(x, config, where, p)) };
  const out = { ...c };
  if (out.value !== undefined) { out.values = [out.value]; delete out.value; }
  if (Array.isArray(out.values) && out.values.every(isName)) {
    if (out.values.length === 1 && out.values[0].trim() === '*') delete out.values;
    else {
      const as = config.outputs[out.output] ? equivalentOf(config.equivalents, out.output) : v => v;
      out.values = out.values.map(v => {
        const read = as(v.trim());
        if (read !== v.trim()) p.fix('D23', where, out.output + ': the condition\'s value ' + JSON.stringify(v.trim()) + ' read as its equivalent ' + JSON.stringify(read));
        return read;
      });
    }
  }
  if (typeof out.equals === 'string') out.equals = out.equals.trim();
  if (Array.isArray(out.in)) out.in = out.in.map(x => (typeof x === 'string' ? x.trim() : x));
  return out;
}

// The file on disk (E10).
function loadPolicies(file, config, p = problems('strict')) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error('1 problem(s) stop scoring (details in test/TRAPS.md):\n  - [E10] ' + file + ': cannot be read: ' + e.message); }
  let raw;
  try { raw = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { throw new Error('1 problem(s) stop scoring (details in test/TRAPS.md):\n  - [E10] ' + file + ': is not valid JSON: ' + e.message); }
  return readPolicies(raw, config, file, p);
}

// --hold-if, the quick form of one condition. Clauses joined by " and " must all hold ("all"):
//   codes=B                 the output states B (applied or not)
//   codes=A,B               states A or B
//   codes=*                 states any value
//   codes=*@0.85            any value stated at a confidence of 0.85 or more
//   codes.applied=B         B, applied; codes.unapplied=B: B stated but not applied
//   field:client=north,west a prediction field equal to one of these (as text)
//   field:match<0.5         a prediction field under 0.5; field:match>=0.5 at least 0.5
function parseHoldIf(text, config, p = problems('strict')) {
  const fail = m => { throw new Error('--hold-if ' + JSON.stringify(text) + ': ' + m); };
  if (typeof text !== 'string' || text.trim() === '') fail('needs a rule such as codes=B, codes=*@0.85 or field:match<0.5');
  const all = [];
  for (const part of text.split(/\s+and\s+/i)) {
    const clause = part.trim();
    const c = {};
    all.push(c);
    let m;
    if (/^field:[^<>=]*(<=|>(?!=)|==)/.test(clause)) fail('"' + clause + '": ' + NOT_AN_OPERATOR);
    if ((m = /^field:([^<>=]+)(>=|<|=)(.*)$/.exec(clause))) {
      c.field = m[1].trim();
      if (m[2] === '=') {
        const vals = m[3].split(',').map(s => s.trim());
        if (vals.some(v => v === '')) fail('"' + clause + '" needs values after "="');
        const odd = vals.find(v => /[<>=]/.test(v));
        if (odd) fail('"' + odd + '" holds an operator: ' + NOT_AN_OPERATOR);
        c.in = vals;
      } else {
        const n = m[3].trim() === '' ? NaN : Number(m[3]);
        if (!Number.isFinite(n)) fail('"' + clause + '" needs a number after "' + m[2] + '"');
        c[m[2] === '<' ? 'below' : 'at_least'] = n;
      }
    } else if ((m = /^([^=@.\s]+)(?:\.([a-z]+))?=([^@]+)(?:@(.*))?$/.exec(clause))) {
      c.output = m[1];
      if (m[2] !== undefined) {
        if (m[2] !== 'applied' && m[2] !== 'unapplied') fail('"' + m[1] + '.' + m[2] + '": after the output name, only .applied or .unapplied');
      }
      const vals = m[3].trim() === '*' ? null : m[3].split(',').map(s => s.trim());
      if (vals && vals.some(v => v === '' || v === '*')) fail('"' + clause + '": give values separated by commas, or * for any value');
      if (vals) c.values = vals;
      if (m[2] !== undefined) c.applied = m[2] === 'applied';
      if (m[4] !== undefined) {
        const n = m[4].trim() === '' ? NaN : Number(m[4]);
        if (!(n >= 0 && n <= 1)) fail('"@' + m[4] + '" must be a confidence from 0 to 1');
        c.confidence_at_least = n;
      }
    } else {
      fail('cannot read "' + clause + '"; write output=VALUE, output=*@0.85, output.unapplied=VALUE, field:name=VALUE, field:name<0.5 or field:name>=0.5');
    }
  }
  const c = all.length === 1 ? all[0] : { all };
  const found = conditionProblems(c, config);
  if (found.length) fail(found.map(([trap, m]) => '[' + trap + '] ' + m).join('; '));
  return normalize(c, config, '--hold-if ' + JSON.stringify(text), p);
}

// The single clauses inside a condition, through any "all".
const clausesOf = c => (c.all ? c.all.flatMap(clausesOf) : [c]);

// The config with the prediction fields the policies' conditions read, so load.js keeps them
// on each record (r.fields). Returns a new config; the one passed in is not changed.
function policyFields(config, policies) {
  const fields = policies.flatMap(p => (p.hold_if || []).flatMap(clausesOf).filter(c => c.field !== undefined).map(c => c.field));
  return { ...config, policy_fields: [...new Set([...(config.policy_fields || []), ...fields])] };
}

// What only the records can show (E14-E16, E19). Run after the run is read, before the what-if.
// opts.sameFile: the predictions and the answer key are one file (the caller knows; whatif
// compares the paths and the contents).
function checkPolicyData(policies, records, config, p, { sameFile = false } = {}) {
  // A hold sends a record to a review step; a workflow without one cannot do what the row shows.
  if (policies.some(pol => pol.hold_if) && !Object.values(config.routing.map).includes('review')) {
    p.warn('E13', 'policies', 'no decision in routing.map sends a record to a person (review): the held records go to a review step this workflow does not have');
  }
  for (const pol of policies) {
    const done = new Set();   // one line per problem in each policy it affects
    const where = 'policy "' + pol.name + '"';
    for (const c of (pol.hold_if || []).flatMap(clausesOf)) {
      const said = (trap, message, strict = true) => {
        const k = trap + '|' + message;
        if (done.has(k)) return;
        done.add(k);
        (strict ? p.strict : p.stop)(trap, where, message);
      };
      if (c.output !== undefined) {
        const o = config.outputs[c.output];
        const stated = r => (o.type === 'set' ? r.pred[c.output] : r.pred[c.output] ? [r.pred[c.output]] : []);
        // Known without a record stating them: the allowed values, and a label output's labels.
        const allowed = [...(Array.isArray(config.allowed_values[c.output]) ? config.allowed_values[c.output] : []),
          ...(Array.isArray(o.labels) ? o.labels.map(equivalentOf(config.equivalents, c.output)) : []), ...(o.decline ? [DECLINED] : [])];
        for (const v of c.values || []) {
          if (!allowed.includes(v) && !records.some(r => stated(r).some(x => x.value === v))) {
            said('E14', 'no record states "' + v + '" for ' + c.output + ', and no allowed_values list has it: probably misspelt, so this condition holds nothing for it');
          }
        }
        if (c.confidence_at_least !== undefined && !records.some(r => stated(r).some(x => x.confidence !== null && x.confidence !== undefined))) {
          said('E19', 'confidence_at_least on ' + c.output + ', but no value of it carries a confidence in this run: the condition holds nothing');
        }
        // A label's answer is applied when given, and a set without set-aside values applies all
        // it states: "stated but not applied" then never holds.
        if (c.applied === false && !records.some(r => stated(r).some(x => x.applied === false && !x.declined))) {
          said('E19', '"applied": false (.unapplied) on ' + c.output + ', but no value of ' + c.output + ' is stated without being applied in this run: the condition holds nothing');
        }
      }
      if (c.field !== undefined) {
        const missing = records.filter(r => !r.fields || r.fields[c.field] === undefined).map(r => r.id);
        const keyName = keySideGroup(c.field, config);
        if (keyName && sameFile) {
          said('E17', 'the predictions and the answer key are one file, so "' + c.field + '" is the answer key\'s (' + keyName + ' is "key"); ' +
            'a routing policy can only use what the workflow knew. If the workflow saw it, set ' + keyName + ': "predictions"', false);
        } else if (missing.length === records.length && records.length > 0 && keyName) {
          said('E17', 'only the answer key has "' + c.field + '" (' + keyName + ' is "key"); a routing policy can only use what the workflow knew. ' +
            'If the workflow saw it, put it in the predictions and set ' + keyName + ': "predictions"', false);
        } else if (missing.length === records.length && records.length > 0) said('E15', 'no record has the field "' + c.field + '": probably misspelt', false);
        else if (missing.length) said('E15', missing.length + ' record(s) lack the field "' + c.field + '" and are never held by it: ' + missing.slice(0, 20).join(', ') + (missing.length > 20 ? ' ...' : ''));
        // E14 for a field: a value to compare with that no record has is probably misspelt.
        if (missing.length < records.length) {
          for (const x of c.equals !== undefined ? [c.equals] : c.in || []) {
            if (!records.some(r => r.fields && r.fields[c.field] !== undefined && sameValue(r.fields[c.field], x))) {
              said('E14', 'no record has ' + JSON.stringify(x) + ' in ' + c.field + ': probably misspelt, so this condition holds nothing for it');
            }
          }
        }
        if (c.below !== undefined || c.at_least !== undefined) {
          const texty = records.filter(r => r.fields && r.fields[c.field] !== undefined && asNumber(r.fields[c.field]) === null).map(r => r.id);
          if (texty.length) said('E16', '"' + c.field + '" is not a number on ' + texty.length + ' record(s), which are never held by it: ' + texty.slice(0, 20).join(', ') + (texty.length > 20 ? ' ...' : ''));
        }
      }
    }
  }
}

// Do a field's value and a condition's value match (equals, in)? Two numbers, or text that reads
// as one ("0.90" and 0.9), as numbers; true/false as true/false in any case ("TRUE" and true);
// any other text exactly, trimmed (case matters, as it does for route decisions).
function sameValue(v, x) {
  const a = asNumber(v);
  const b = asNumber(x);
  if (a !== null && b !== null) return a === b;
  const bool = y => (typeof y === 'boolean' ? y : typeof y === 'string' && /^(true|false)$/i.test(y.trim()) ? y.trim().toLowerCase() === 'true' : null);
  if (bool(v) !== null && bool(x) !== null) return bool(v) === bool(x);
  return String(v).trim() === String(x).trim();
}

// A field value as a number: a number, or text that reads as one (a CSV's "0.4"); else null.
function asNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

module.exports = { readPolicies, loadPolicies, parseHoldIf, policyFields, checkPolicyData, asNumber, sameValue, AS_RUN };
