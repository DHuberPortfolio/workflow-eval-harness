// wfeval agree: how far the people who made the answer keys (or graded free text) agree.
//
// An answer key is made by people. If three people would label the same records differently,
// the key's "right answer" is shaky, and every rate measured against it inherits that. This file
// reads two or more graders' files for the same records, lines up their values record by record,
// and hands each output to metrics/agreement.js (Krippendorff's alpha). Nothing here scores a
// workflow, calls a model or the network.
//
// Two kinds of input:
//   answer keys  - in the config's key format, read exactly as `score` reads a key (load.js), so
//                  equivalents, CSV cells and any_of slots mean the same thing here. Compared per
//                  output: a label as names (nominal), an ordinal on the config's level order
//                  (ordinal), a set with the Jaccard distance (MASI given beside it), and the
//                  routing gold field as its route class (nominal).
//   grades files - from the page `wfeval grade` writes: faithful / invented / missing (nominal),
//                  and "invented or not" alone, as score --grades --second-reviewer does for two.
// Traps: test/TRAPS.md, section M.
const fs = require('fs');
const nodePath = require('path');
const { problems } = require('./problems.js');
const { readRecords, normalizeKey, formatOf, getPath } = require('./load.js');
const { decodeCsvRecords } = require('./csv.js');
const { routeClass } = require('./align.js');
const { DECLINED } = require('./config.js');
const { readGrades } = require('./grading.js');
const { slotLabel } = require('./metrics/slots.js');
const { krippendorffAlpha, bootstrapAlpha, reading, THRESHOLDS } = require('./metrics/agreement.js');

const ROUTE = 'route';
// One value making up this share of the pairable values or more: alpha can be low while the raw
// agreement is high (the prevalence paradox: Feinstein and Cicchetti 1990, for kappa; alpha shares
// it, since both measure agreement beyond what the values' frequencies give by chance).
const DOMINANT = 0.8;
// A BCa range on fewer values than this that are not the most common value ("rare values") is
// probably too narrow (trap M16). What a range stands on is the rare values, whatever their share
// or the number of records: in scripts/agree-flags.js (7,546 simulated data sets with a BCa range)
// it held the real alpha 30.0% of the time with 0-4 rare values, 77.6% with 5-9, 89.1% with 10-14,
// 92.8% with 15-19, and 92.9-94.9% from 20 on (95% is right); unflagged at 20, 94.5%. Few records
// always means few rare values, so this also covers very small sets. Krippendorff's bootstrap (used
// for names when every compared record has exactly two values) held 95.7-98.1% with under 15: not flagged.
const FEW_RARE = 20;

const pctOf = x => (x === null ? null : Number((x * 100).toFixed(1)));

// ---------- Files and graders (M1-M4) ----------

// Checks the list of files and names the graders. Stops go into p.
function graderList(paths, names, p, nameOf) {
  if (paths.length < 2) p.stop('M1', paths[0] || '(no file)', 'agreement needs two or more graders\' files; got ' + paths.length);
  const seen = new Map();
  paths.forEach(f => {
    const full = nodePath.resolve(f);
    if (seen.has(full)) p.stop('M2', f, 'is given twice: a grader always agrees with themselves, which proves nothing');
    seen.set(full, f);
  });
  if (names && names.length !== paths.length) p.stop('M4', '--names', 'gives ' + names.length + ' name(s) for ' + paths.length + ' file(s)');
  const list = paths.map((f, i) => (names && names.length === paths.length ? names[i].trim() : nameOf(f)));
  if (list.some(n => n === '')) p.stop('M4', names ? '--names' : paths.join(', '), 'every grader needs a name; one is empty');
  const dup = list.filter((n, i) => list.indexOf(n) !== i);
  if (dup.length) p.stop('M4', paths.join(', '), 'two graders are both named ' + [...new Set(dup)].map(n => JSON.stringify(n)).join(', ') + '; give each a name with --names');
  // M3: two different files with the same content. A real perfect agreement is possible, but a
  // copied file is likelier, so it is said.
  const content = paths.map(f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } });
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    if (content[i] !== null && content[i] === content[j] && nodePath.resolve(paths[i]) !== nodePath.resolve(paths[j])) {
      p.warn('M3', paths[j], 'has exactly the same content as ' + paths[i] + '; if it is a copy, their agreement proves nothing');
    }
  }
  return list;
}

const baseName = f => nodePath.basename(f).replace(/\.[^.]+$/, '');

// ---------- One output, all graders ----------

// ids: the records (units) in order; grid[g][i]: grader g's value for record i, or null.
// show(v): a value as the report shows it. key(v): a value as compared (same key: same value).
// label(i, g, v): how grader g's value v on record i is shown (default: show(v)); the route shows the
// key's own name there, though it is compared by class.
function compareOutput({ name, type, metric, order = null, ids, grid, graders, show, key, resamples, seed, also = null, label = null }) {
  const units = ids.map((_, i) => grid.map(g => g[i]));
  const opts = { metric, order };
  const a = krippendorffAlpha(units, opts);
  const range = bootstrapAlpha(units, opts, { resamples, seed });
  const gradedByOne = ids.filter((_, i) => units[i].filter(v => v !== null).length === 1);
  const disagreements = [];
  ids.forEach((id, i) => {
    const given = units[i].map((v, g) => [g, v]).filter(([, v]) => v !== null);
    if (given.length < 2 || new Set(given.map(([, v]) => key(v))).size === 1) return;
    disagreements.push({ id, values: Object.fromEntries(given.map(([g, v]) => [graders[g], label ? label(i, g, v) : show(v)])) });
  });
  // Each pair of graders on the records both graded, so the odd one out is visible.
  const pairs = [];
  for (let x = 0; x < graders.length; x++) for (let y = x + 1; y < graders.length; y++) {
    const r = krippendorffAlpha(units.map(u => [u[x], u[y]]), opts);
    pairs.push({ graders: [graders[x], graders[y]], alpha: r.alpha, units: r.units, agreement: r.agreement, agreement_pct: pctOf(r.agreement) });
  }
  // Alpha without each grader (with 3 or more), like Cronbach's alpha-if-item-deleted: the grader
  // whose removal raises alpha most labels most differently from the rest. It shows who differs,
  // not who is wrong (docs/METRICS.md says why this over the average of each grader's pairs).
  let without = null, oddOne = null;
  if (graders.length >= 3) {
    without = graders.map((g, k) => ({ grader: g, alpha: krippendorffAlpha(units.map(u => u.filter((_, j) => j !== k)), opts).alpha }));
    if (a.alpha !== null) {
      let best = null;
      for (const w of without) if (w.alpha !== null && w.alpha > a.alpha + 1e-12 && (best === null || w.alpha > best.alpha)) best = w;
      oddOne = best ? best.grader : null;
    }
  }
  const dominant = a.top === null ? null : { value: show(a.top.value), share: a.top.share, pct: pctOf(a.top.share) };
  const out = {
    name, type, metric,
    alpha: a.alpha,
    reading: reading(a.alpha),
    range,
    units: a.units,
    values: a.values,
    graded_by_one: gradedByOne,
    observed: a.observed,
    expected: a.expected,
    raw_agreement: { share: a.agreement, pct: pctOf(a.agreement) },
    chance_agreement: { share: a.chance_agreement, pct: pctOf(a.chance_agreement) },
    dominant,
    // Only when alpha is short of reliable: a reliable alpha needs no explaining (review 7).
    prevalence_warning: a.alpha !== null && a.alpha < THRESHOLDS.reliable && dominant !== null && dominant.share >= DOMINANT,
    rare_values: a.top === null ? 0 : Math.round(a.values * (1 - a.top.share)),
    range_too_narrow: range.low !== null && range.method === 'bca' && a.top !== null && Math.round(a.values * (1 - a.top.share)) < FEW_RARE,
    pairs,
    without,
    odd_one: oddOne,
    disagreements,
  };
  if (also) out.masi_alpha = krippendorffAlpha(units, { metric: also }).alpha;
  return out;
}

// ---------- Answer keys ----------

// A set's slots as compared: a plain value is itself; an any_of slot is one item, the same as
// another only with the same alternatives (trap M13). Equivalents were applied as the key was read.
// Keys are tagged so a value can never be read as a slot (a value may start with "{"), and a slot
// of one alternative is that value, as slots.js reads it.
const slotKey = s => {
  const alts = typeof s === 'string' ? [s] : [...new Set(s.any_of)].sort();
  return alts.length === 1 ? 'v:' + alts[0] : 's:' + JSON.stringify(alts);
};
const slotShow = k => (k.startsWith('v:') ? k.slice(2) : slotLabel({ any_of: JSON.parse(k.slice(2)) }));

// Reads every key and compares them. Throws, listing every problem, if anything must stop.
// outputs: the output names to compare (and "route"), or null for every output the config has.
// majority: true also works out the majority answer key (--write-key; majorityOf below).
function agreeKeys({ config, keyPaths, names = null, outputs = null, mode = 'strict', resamples = 2000, seed = 1, majority = false }) {
  const p = problems(mode);
  const graders = graderList(keyPaths, names, p, baseName);
  p.throwIfStopped();

  const hasRoute = Boolean(config.routing && config.routing.gold_field);
  // The gold route is compared under the name "route"; an output of that name would be shadowed.
  if (hasRoute && config.outputs[ROUTE]) p.stop('M11', 'config', 'has an output named "route", the name agree gives the routing gold field ("' + config.routing.gold_field + '"); rename the output so --output and the report can tell them apart');
  p.throwIfStopped();
  const all = [...Object.keys(config.outputs), ...(hasRoute ? [ROUTE] : [])];
  const chosen = outputs || all;
  for (const o of chosen) if (!all.includes(o)) p.stop('M11', '--output', JSON.stringify(o) + ' is not an output of this config (' + all.join(', ') + ')');
  p.throwIfStopped();
  // Only the chosen outputs are read, so a key without the others is not stopped for them.
  const cfg = { ...config, outputs: Object.fromEntries(Object.entries(config.outputs).filter(([n]) => chosen.includes(n))) };

  const rawsOf = [];   // each grader's raw records by id, for the fields --write-key carries over
  const keys = keyPaths.map((file, g) => {
    let raws = readRecords(file, p, config.input.key);
    if (formatOf(file, config.input.key) === 'csv') {
      // M17: a set column blank in every record reads as "nothing applies" everywhere; far likelier
      // the grader did not label it.
      for (const [o, x] of Object.entries(cfg.outputs)) {
        if (x.type === 'set' && raws.length > 0 && raws.every(r => { const c = getPath(r, x.key_field); return c === undefined || String(c).trim() === ''; })) {
          p.warn('M17', file, 'the ' + o + ' column is blank in every record, so every record reads as "nothing applies". If ' + graders[g] + ' did not label ' + o + ', leave it out with --output');
        }
      }
      raws = decodeCsvRecords(raws, cfg, 'key', config.input.key, file, p);
    }
    // M11: an output absent from every record of a file: this grader did not label it.
    const absent = chosen.filter(o => raws.length > 0 && raws.every(r => getPath(r, o === ROUTE ? config.routing.gold_field : cfg.outputs[o].key_field) === undefined));
    if (absent.length) {
      p.stop('M11', file, 'has no ' + absent.map(o => (o === ROUTE ? 'route ("' + config.routing.gold_field + '")' : JSON.stringify(o))).join(', ') +
        ' in any record: ' + graders[g] + ' did not label ' + (absent.length > 1 ? 'them' : 'it') + '. Compare the outputs every grader labelled with --output');
      return [];
    }
    const key = normalizeKey(raws, cfg, file, p);
    rawsOf[g] = new Map(key.map((r, i) => [r.id, raws[i]]));
    const seen = new Set();
    for (const r of key) {
      if (seen.has(r.id)) p.stop('B3', file, 'id "' + r.id + '" appears more than once');
      seen.add(r.id);
    }
    return key;
  });
  p.throwIfStopped();

  // The route, as its class: two names for one class lead to the same outcome when scored.
  if (chosen.includes(ROUTE)) {
    keys.forEach((key, g) => key.forEach(r => {
      const where = keyPaths[g] + ' ' + r.id;
      // Read exactly as score reads it (align.js): text only, own keys only, spaces trimmed and counted (C3).
      r.gold_class = routeClass(r.gold_route, config.routing.map, where, p, 'correct route (' + config.routing.gold_field + ')', 'C4', 'C5');
    }));
  }
  // M8: a set value outside the output's allowed_values. A typo would count as a disagreement
  // about a value nobody meant (labels and ordinal levels stop as the key is read, F1).
  for (const [name, o] of Object.entries(cfg.outputs)) {
    const allowed = config.allowed_values[name];
    if (o.type !== 'set' || !Array.isArray(allowed)) continue;
    keys.forEach((key, g) => key.forEach(r => {
      for (const v of r.outputs[name].flatMap(s => (typeof s === 'string' ? [s] : s.any_of))) {
        if (!allowed.includes(v)) p.strict('M8', keyPaths[g] + ' ' + r.id, name + ' lists ' + JSON.stringify(v) + ', which is not in allowed_values.' + name);
      }
    }));
  }

  // The records, in the order they first appear; each grader's records.
  const ids = [];
  const byGrader = keys.map(key => new Map(key.map(r => [r.id, r])));
  for (const key of keys) for (const r of key) if (!ids.includes(r.id)) ids.push(r.id);
  // M6: graders who labelled different records. Allowed (alpha is built for missing values, and
  // double-labelling a sample is common), but said, with what each grader lacks.
  const lacks = byGrader.map(m => ids.filter(id => !m.has(id)).length);
  if (lacks.some(n => n > 0)) {
    p.warn('M6', keyPaths.join(', '), 'the graders labelled different records: ' +
      graders.map((g, i) => g + ' lacks ' + lacks[i] + ' of ' + ids.length).join(', ') + '. Records labelled by one grader only are left out of alpha and listed');
  }
  // M7: nothing labelled by two people.
  if (!ids.some(id => byGrader.filter(m => m.has(id)).length >= 2)) p.stop('M7', keyPaths.join(', '), 'no record is in two graders\' keys: there is nothing to compare');
  p.throwIfStopped();

  const results = chosen.map(name => {
    const base = { ids, graders, resamples, seed };
    if (name === ROUTE) {
      const grid = byGrader.map(m => ids.map(id => (m.has(id) ? m.get(id).gold_class : null)));
      // Compared by class (two names of one class are scored the same), shown by the key's own name:
      // a class with one name is shown as that name; with several, as the name and its class.
      const namesOf = cls => Object.keys(config.routing.map).filter(n => config.routing.map[n] === cls);
      const show = cls => { const n = namesOf(cls); return n.length === 1 ? n[0] : cls + ' (' + n.join(' / ') + ')'; };
      const label = (i, g, cls) => { const name = String(byGrader[g].get(ids[i]).gold_route).trim(); return namesOf(cls).length === 1 ? name : name + ' (' + cls + ')'; };
      return compareOutput({ ...base, name, type: 'route', metric: 'nominal', grid, show, label, key: v => v });
    }
    const o = cfg.outputs[name];
    const value = r => r.outputs[name];
    if (o.type === 'set') {
      const grid = byGrader.map(m => ids.map(id => (m.has(id) ? value(m.get(id)).map(slotKey) : null)));
      const show = v => v.map(slotShow);
      return compareOutput({ ...base, name, type: 'set', metric: 'jaccard', also: 'masi', grid, show, key: v => JSON.stringify([...new Set(v)].sort()) });
    }
    const grid = byGrader.map(m => ids.map(id => (m.has(id) ? value(m.get(id)) : null)));
    return compareOutput({ ...base, name, type: o.type, metric: o.type === 'ordinal' ? 'ordinal' : 'nominal', order: o.type === 'ordinal' ? o.labels : null, grid, show: v => v, key: v => v });
  });

  return {
    kind: 'agree', source: 'keys',
    inputs: { keys: keyPaths, mode, resamples, seed },
    thresholds: { reliable: THRESHOLDS.reliable, tentative: THRESHOLDS.tentative },
    graders: graders.map((name, g) => ({ name, file: keyPaths[g], records: keys[g].length })),
    records: ids.length,
    outputs: results,
    ...(majority ? { majority: majorityOf({ config, cfg, chosen, ids, byGrader, rawsOf }) } : {}),
    problems: p.items,
  };
}

// The majority answer key. Per record and output, the value most graders gave (compared as agree
// compares them: the route by class, written as the name most of that class's graders used). A set
// is decided value by value: a value (or an any_of slot) is in the majority set when more than half
// of the graders who labelled the record list it; one listed by exactly half is a tie. A record is
// written only when every output has a majority; a tie, or a record labelled by one grader only,
// leaves the record out, listed for a person to settle.
// The other fields scoring reads from the key (trap_field, the groups and clusters read from the
// key, duplicate_of_field) are carried over by the same rule, as written: when no value has more
// than any other, the record is written without that field, and the field is listed.
// Returns { written: [{ id, values, fields }], left_out: [{ id, why }], fields_left_out: [{ id, field, values }] }.
function majorityOf({ config, cfg, chosen, ids, byGrader, rawsOf }) {
  const written = [], leftOut = [], fieldsLeftOut = [];
  const reserved = new Set([config.id_field, config.routing && config.routing.gold_field, ...Object.values(cfg.outputs).map(o => o.key_field)]);
  const extra = [...new Set([config.trap_field, config.duplicate_of_field,
    ...Object.values(config.groups || {}).filter(x => x.from === 'key').map(x => x.field),
    ...(config.clusters && config.clusters.from === 'key' ? [config.clusters.field] : [])].filter(f => f && !reserved.has(f)))];
  for (const id of ids) {
    const graders = byGrader.map((m, g) => g).filter(g => byGrader[g].has(id));
    const given = graders.map(g => byGrader[g].get(id));
    if (given.length < 2) { leftOut.push({ id, why: 'labelled by one grader only' }); continue; }
    const values = {}, ties = [];
    for (const name of chosen) {
      const isRoute = name === ROUTE;
      if (!isRoute && cfg.outputs[name].type === 'set') {
        const count = new Map();
        for (const r of given) for (const k of new Set(r.outputs[name].map(slotKey))) count.set(k, (count.get(k) || 0) + 1);
        const half = given.length / 2;
        const split = [...count.entries()].filter(([, c]) => c === half).map(([k]) => slotShow(k));
        if (split.length) { ties.push(name + ' (listed by exactly half the graders: ' + split.join(', ') + ')'); continue; }
        const inSet = [...count.entries()].filter(([, c]) => c > half).map(([k]) => k).sort();
        // A set no grader gave (empty when each said something different, or a mix of theirs) is
        // made up by the vote, not an answer anyone wrote: a person settles it.
        if (!given.some(r => JSON.stringify([...new Set(r.outputs[name].map(slotKey))].sort()) === JSON.stringify(inSet))) {
          ties.push(name + ' (the values most graders list, ' + (inSet.length ? inSet.map(slotShow).join(', ') : 'none') + ', are no grader\'s set)');
          continue;
        }
        values[name] = inSet.map(k => (k.startsWith('v:') ? k.slice(2) : { any_of: JSON.parse(k.slice(2)) }));
        continue;
      }
      const vals = given.map(r => (isRoute ? String(r.gold_route).trim() : r.outputs[name]));
      const keyOf = isRoute ? v => config.routing.map[v] : cfg.outputs[name].type === 'set' ? v => JSON.stringify(v.map(slotKey).sort()) : v => String(v);
      const groups = new Map();
      for (const v of vals) { const k = keyOf(v); groups.set(k, [...(groups.get(k) || []), v]); }
      const ranked = [...groups.values()].sort((x, y) => y.length - x.length);
      if (ranked.length > 1 && ranked[0].length === ranked[1].length) { ties.push(name + ' (a tie: ' + ranked.filter(g => g.length === ranked[0].length).map(g => JSON.stringify(g[0])).join(' / ') + ')'); continue; }
      let value = ranked[0][0];
      if (isRoute) {
        const n = new Map();
        for (const v of ranked[0]) n.set(v, (n.get(v) || 0) + 1);
        value = [...n.entries()].sort((x, y) => y[1] - x[1])[0][0];
      } else if (value === DECLINED && cfg.outputs[name].decline) value = cfg.outputs[name].decline.values[0];
      values[name] = value;
    }
    if (ties.length) { leftOut.push({ id, why: 'no majority for ' + ties.join(', ') }); continue; }
    const fields = {};
    for (const field of extra) {
      const raw = graders.map(g => getPath(rawsOf[g].get(id), field));
      const groups = new Map();
      raw.forEach(v => { const k = v === undefined ? '' : JSON.stringify(v); groups.set(k, [...(groups.get(k) || []), v]); });
      const ranked = [...groups.entries()].sort((x, y) => y[1].length - x[1].length);
      if (ranked.length > 1 && ranked[0][1].length === ranked[1][1].length) { fieldsLeftOut.push({ id, field, values: raw }); continue; }
      if (ranked[0][0] !== '') fields[field] = ranked[0][1][0];
    }
    written.push({ id, values, fields });
  }
  // A duplicate whose primary record was left out would point at nothing (C9): it waits for the
  // primary to be settled, until no more move.
  const dup = config.duplicate_of_field;
  for (let moved = true; dup && moved;) {
    moved = false;
    const out = new Set(leftOut.map(r => r.id));
    for (let i = written.length - 1; i >= 0; i--) {
      const target = written[i].fields[dup];
      if (target !== undefined && target !== null && out.has(String(target).trim())) {
        leftOut.push({ id: written[i].id, why: 'its ' + dup + ' names ' + target + ', which was left out' });
        written.splice(i, 1);
        moved = true;
      }
    }
  }
  return { written, left_out: leftOut, fields_left_out: fieldsLeftOut };
}

// The majority key as a JSON key file the config reads: each output under its key_field, the route
// under routing.gold_field, inside input.key.unwrap and records_at when the config has them. A
// config that reads its key as CSV gets JSON all the same, and the error says so.
// outPath decides the format exactly as the loader will when it reads the file back (formatOf):
// the config's input.key.format, else the extension. JSON Lines for jsonl; CSV is refused.
function majorityKeyText(config, majority, outPath = 'key.json') {
  const input = config.input.key || {};
  const format = formatOf(outPath, input);
  if (format === 'csv') throw new Error('--write-key writes JSON or JSON Lines, not CSV (' + (input.format ? 'the config reads its key as CSV: input.key.format' : outPath + ' would be read back as CSV') + '). Write it to a .json or .jsonl file, with a config that reads that');
  const setPath = (obj, path, v) => { const parts = path.split('.'); let o = obj; parts.slice(0, -1).forEach(k => { o = o[k] = o[k] || {}; }); o[parts[parts.length - 1]] = v; return obj; };
  const records = majority.written.map(r => {
    const rec = setPath({}, config.id_field, r.id);
    for (const [field, v] of Object.entries(r.fields || {})) setPath(rec, field, v);
    for (const [name, v] of Object.entries(r.values)) {
      if (name === ROUTE) setPath(rec, config.routing.gold_field, v);
      else setPath(rec, config.outputs[name].key_field, v);
    }
    return input.unwrap ? setPath({}, input.unwrap, rec) : rec;
  });
  if (format === 'jsonl') return records.map(r => JSON.stringify(r)).join('\n') + '\n';
  return JSON.stringify(input.records_at ? setPath({}, input.records_at, records) : records, null, 2) + '\n';
}

// ---------- Free-text grades ----------

function agreeGrades({ gradePaths, names = null, mode = 'strict', resamples = 2000, seed = 1 }) {
  const p = problems(mode);
  const files = gradePaths.map(f => readGrades(f, p));
  p.throwIfStopped();
  // The reviewer's own name from the file, or the file's name when it has none.
  const graders = graderList(gradePaths, names, p, f => { const g = files[gradePaths.indexOf(f)]; return g && g.reviewer ? g.reviewer : baseName(f); });
  p.throwIfStopped();
  const first = files[0];
  files.slice(1).forEach((g, i) => {
    // M12 (as J7): agreement means something only if everyone graded exactly the same text.
    if (g.fingerprint !== first.fingerprint) p.stop('M12', gradePaths[i + 1], 'graded different forms from ' + gradePaths[0] + ' (their fingerprints differ: the forms or their text changed between the gradings)');
    else if (JSON.stringify(g.fields.map(f => f.name)) !== JSON.stringify(first.fields.map(f => f.name)) || JSON.stringify(g.forms) !== JSON.stringify(first.forms)) {
      p.stop('M12', gradePaths[i + 1], 'lists different forms or fields from ' + gradePaths[0]);
    }
  });
  p.throwIfStopped();

  const cells = first.forms.flatMap(form => first.fields.map(f => [form, f.name]));
  const ids = cells.map(([form, field]) => form + ' ' + field);
  const gradeOf = g => cells.map(([form, field]) => { const x = g.grades.get(form + '\u0000' + field); return x ? x.grade : null; });
  const grid = files.map(gradeOf);
  if (!ids.some((_, i) => grid.filter(g => g[i] !== null).length >= 2)) p.stop('M7', gradePaths.join(', '), 'no field is graded by two reviewers: there is nothing to compare');
  p.throwIfStopped();
  const base = { ids, graders, resamples, seed, show: v => v, key: v => v };
  const invented = grid.map(g => g.map(v => (v === null ? null : v === 'invented' ? 'invented' : 'not invented')));
  return {
    kind: 'agree', source: 'grades',
    inputs: { grades: gradePaths, mode, resamples, seed },
    thresholds: { reliable: THRESHOLDS.reliable, tentative: THRESHOLDS.tentative },
    graders: graders.map((name, g) => ({ name, file: gradePaths[g], records: files[g].grades.size })),
    records: ids.length,
    outputs: [
      compareOutput({ ...base, name: 'grade', type: 'grade', metric: 'nominal', grid }),
      compareOutput({ ...base, name: 'invented or not', type: 'grade', metric: 'nominal', grid: invented }),
    ],
    problems: p.items,
  };
}

module.exports = { agreeKeys, agreeGrades, majorityKeyText };
