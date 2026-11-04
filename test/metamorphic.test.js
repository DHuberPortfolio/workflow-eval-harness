// Properties that must hold whatever the right answer is. Most tests here compare one run with a
// changed copy of it: shuffle the records and every rate stays; fix a value and the silent errors
// cannot rise. They need no worked answer, so they run on real example data and on a small set
// generated from a fixed seed, and they find a different kind of mistake from the hand-worked tests:
// code that depends on something it should not (the order of a file, the name of an id).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('../src/config.js');
const { scoreRun, compareRun, varianceRun } = require('../src/score.js');
const { gateSweep } = require('../src/metrics/whatif.js');
const { resultsJson } = require('../src/report/json.js');
const { monitorRun } = require('../src/monitor.js');
const { agreeKeys } = require('../src/agree.js');
const { estimateRun } = require('../src/estimate.js');
const { suspectsRun } = require('../src/suspects.js');

const ROOT = path.join(__dirname, '..');
const WFEVAL = path.join(ROOT, 'bin', 'wfeval.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-meta-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const NOW = '2026-11-04T00:00:00.000Z';

function folder(files) {
  const dir = fs.mkdtempSync(path.join(tmp, 'f-'));
  for (const [name, x] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof x === 'string' ? x : JSON.stringify(x));
  return dir;
}
const seeded = seed => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function shuffled(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- A small set, from a seed ----------

const CONFIG = {
  id_field: 'id', trap_field: 'trap', duplicate_of_field: 'dup',
  outputs: {
    tags: { type: 'set' },
    topic: { type: 'label', labels: ['billing', 'refund', 'shipping'], confidence_field: 'topic_confidence' },
    level: { type: 'ordinal', labels: ['low', 'mid', 'high'], near_miss_steps: 1 },
  },
  routing: { field: 'route', gold_field: 'gold', map: { PUB: 'auto', ASK: 'review', STOP: 'block', DUP: 'exclude' } },
  groups: { channel: { field: 'channel' } },
  thresholds: { floor: 0.4, auto_publish: { tags: 0.7 } },
  allowed_values: { tags: ['a', 'b', 'c', 'd', 'e', 'f'] },
};
const TAGS = CONFIG.allowed_values.tags;
const LABELS = CONFIG.outputs.topic.labels;
const LEVELS = CONFIG.outputs.level.labels;
function generated(seed, n = 80) {
  const rand = seeded(seed);
  const pick = list => list[Math.floor(rand() * list.length)];
  const key = [], pred = [];
  for (let i = 0; i < n; i++) {
    const id = 'R' + String(i + 1).padStart(3, '0');
    const gold = i > 2 && rand() < 0.08 ? 'DUP' : rand() < 0.65 ? 'PUB' : rand() < 0.8 ? 'ASK' : 'STOP';
    const tags = shuffled(TAGS, rand).slice(0, 1 + Math.floor(rand() * 3));
    const k = { id, gold, tags, topic: pick(LABELS), level: pick(LEVELS), trap: pick(['t1', 't2', 't3']), channel: pick(['chat', 'email', 'phone']),
      dup: gold === 'DUP' ? 'R00' + (1 + Math.floor(rand() * 3)) : null };
    const stated = tags.filter(() => rand() < 0.9);
    if (rand() < 0.25) stated.push(pick(TAGS.filter(t => !tags.includes(t))));
    const route = rand() < 0.8 ? gold : pick(['PUB', 'PUB', 'ASK', 'STOP']);
    key.push(k);
    pred.push({ id, route, tags: [...new Set(stated)].map(value => ({ value, confidence: Number((0.45 + rand() * 0.55).toFixed(2)) })),
      topic: rand() < 0.85 ? k.topic : pick(LABELS), topic_confidence: Number((0.4 + rand() * 0.6).toFixed(2)), level: rand() < 0.8 ? k.level : pick(LEVELS) });
  }
  return { config: CONFIG, key, pred };
}
// META_SEED tries another set: the properties hold for every seed, not only this one.
const gen = generated(Number(process.env.META_SEED) || 7);

function scored({ config, key, pred, opts = {} }) {
  const dir = folder({ 'c.json': config, 'k.json': key, 'p.json': pred });
  return scoreRun({ config: loadConfig(path.join(dir, 'c.json')), predPath: path.join(dir, 'p.json'), keyPath: path.join(dir, 'k.json'), ...opts });
}

// Every number in a set of results by where it sits, each place's numbers sorted, and the length of
// every list. Ids are text, so they drop out. Paths that name a file differ from folder to folder,
// so inputs and problems are left out.
const SKIP = new Set(['inputs', 'problems', 'generated_at', 'tool', 'version', 'paired']);
function numbers(x, at = '', out = {}) {
  if (typeof x === 'number') (out[at] = out[at] || []).push(x);
  else if (Array.isArray(x)) { (out[at + '#'] = out[at + '#'] || []).push(x.length); for (const v of x) numbers(v, at + '[]', out); }
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) if (!SKIP.has(k)) numbers(v, at + '.' + k, out);
  return out;
}
const everyNumber = results => {
  const out = numbers(resultsJson(results, NOW));
  for (const v of Object.values(out)) v.sort((a, b) => a - b);
  return out;
};
const silentCount = r => r.routing.silent_errors.rate.n;

// Real runs, each with its config, as read from examples/.
const C = path.join(ROOT, 'examples', 'compliance-reviewer');
const M = path.join(ROOT, 'examples', 'metadata-enrichment');
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const compliance = () => ({ config: readJson(path.join(C, 'config.json')), key: readJson(path.join(C, 'key.json')), pred: readJson(path.join(C, 'runs', 'exec-59.harness.json')) });
const metadata = () => {
  const dir = path.join(M, 'golden500');
  const config = readJson(path.join(dir, 'config.json'));
  for (const v of Object.values(config.allowed_values)) v.file = path.resolve(dir, v.file);   // the copy of the config lives elsewhere
  const pred = readJson(path.join(dir, 'exec-72.json'));
  return { config, key: pred, pred };
};
const SETS = () => [['generated', gen], ['compliance', compliance()], ['metadata', metadata()]];

// ---------- Order and names ----------

test('shuffling the records in the predictions, or in the key, leaves every number the same', () => {
  const rand = seeded(11);
  for (const [name, set] of SETS()) {
    const base = everyNumber(scored(set));
    assert.deepEqual(everyNumber(scored({ ...set, pred: shuffled(set.pred, rand) })), base, name + ': predictions');
    assert.deepEqual(everyNumber(scored({ ...set, key: shuffled(set.key, rand) })), base, name + ': key');
  }
});

test('renaming every id consistently leaves every number the same', () => {
  const rename = id => 'x-' + String(id).split('').reverse().join('');
  const rec = r => ({ ...r, id: rename(r.id), ...(r.dup ? { dup: rename(r.dup) } : {}),
    ...(r.expected && r.expected.duplicate_of ? { expected: { ...r.expected, duplicate_of: rename(r.expected.duplicate_of) } } : {}) });
  for (const [name, set] of SETS()) {
    assert.deepEqual(everyNumber(scored({ ...set, key: set.key.map(rec), pred: set.pred.map(rec) })), everyNumber(scored(set)), name);
  }
});

// ---------- File formats ----------

test('the same run as JSON, JSON Lines and CSV gives the same results', () => {
  const lines = list => list.map(r => JSON.stringify(r)).join('\n') + '\n';
  const cell = s => '"' + String(s === null ? '' : s).replace(/"/g, '""') + '"';
  const csv = (cols, rows) => [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n') + '\n';
  const { config, key, pred } = gen;
  const flatKey = key.map(k => ({ ...k, tags: k.tags.join('|') }));
  const flatPred = pred.map(p => ({ ...p, tags: p.tags.map(t => t.value + '@' + t.confidence).join('|') }));
  const dir = folder({ 'c.json': config, 'k.json': key, 'p.json': pred, 'k.jsonl': lines(key), 'p.jsonl': lines(pred),
    'k.csv': csv(['id', 'gold', 'tags', 'topic', 'level', 'trap', 'channel', 'dup'], flatKey),
    'p.csv': csv(['id', 'route', 'tags', 'topic', 'topic_confidence', 'level'], flatPred) });
  const config2 = loadConfig(path.join(dir, 'c.json'));
  const of = ext => everyNumber(scoreRun({ config: config2, predPath: path.join(dir, 'p.' + ext), keyPath: path.join(dir, 'k.' + ext) }));
  assert.deepEqual(of('jsonl'), of('json'));
  assert.deepEqual(of('csv'), of('json'));
});

// ---------- Changing one value ----------

// Each record with a tag the key does not list: the same run with that one tag put right.
function oneValueFixed(set, rand, most = 10) {
  const list = [];
  for (const r of shuffled(set.pred, rand)) {
    const k = set.key.find(x => x.id === r.id);
    const wrong = r.tags.find(t => !k.tags.includes(t.value));
    if (!wrong || list.length >= most) continue;
    const absent = k.tags.find(t => !r.tags.some(x => x.value === t));
    const tags = r.tags.flatMap(t => (t !== wrong ? [t] : absent ? [{ ...t, value: absent }] : []));
    list.push(set.pred.map(x => (x === r ? { ...r, tags } : x)));
  }
  return list;
}
// Each record that went out with a tag the key lists: the same run with that tag made wrong.
function oneValueBroken(set, rand, most = 10) {
  const list = [];
  for (const r of shuffled(set.pred, rand)) {
    const k = set.key.find(x => x.id === r.id);
    const right = r.tags.find(t => k.tags.includes(t.value));
    const other = TAGS.find(t => !k.tags.includes(t) && !r.tags.some(x => x.value === t));
    if (r.route !== 'PUB' || !right || !other || list.length >= most) continue;
    list.push(set.pred.map(x => (x === r ? { ...r, tags: r.tags.map(t => (t === right ? { ...t, value: other } : t)) } : x)));
  }
  return list;
}

test('fixing one wrong value never raises the silent errors; breaking a right one that went out never lowers them', () => {
  for (const wrong_when of ['either', 'any_mismatch', 'gold_route']) {
    const set = { ...gen, config: { ...gen.config, wrong_when } };
    const base = silentCount(scored(set));
    const rand = seeded(13);
    const fixed = oneValueFixed(set, rand);
    const broken = oneValueBroken(set, rand);
    assert.ok(fixed.length >= 5 && broken.length >= 5, 'enough cases');
    for (const pred of fixed) assert.ok(silentCount(scored({ ...set, pred })) <= base, wrong_when + ': a fix raised the count');
    for (const pred of broken) assert.ok(silentCount(scored({ ...set, pred })) >= base, wrong_when + ': a break lowered the count');
  }
});

test('adding a record that is right, gone out or held, leaves the silent error count alone', () => {
  const base = scored(gen).routing.silent_errors.rate;
  const row = (route, id) => ({
    key: { id, gold: route, tags: ['a'], topic: 'billing', level: 'mid', trap: 't1', channel: 'chat', dup: null },
    pred: { id, route, tags: [{ value: 'a', confidence: 0.9 }], topic: 'billing', topic_confidence: 0.9, level: 'mid' },
  });
  for (const [route, more] of [['PUB', 1], ['ASK', 0]]) {
    const add = row(route, 'added');
    const r = scored({ ...gen, key: [...gen.key, add.key], pred: [...gen.pred, add.pred] }).routing.silent_errors.rate;
    assert.deepEqual([r.n, r.d], [base.n, base.d + more], route);
  }
});

// ---------- Parts and wholes ----------

const REAL_SPLIT = () => {
  const dir = path.join(C, 'golden500');
  const pred = readJson(path.join(dir, 'exec-67.harness.json'));
  return { ...compliance(), config: { ...compliance().config, split: { held_out: 0.5 } }, key: pred, pred };
};

test('the two halves of a split add up to the whole', () => {
  for (const [name, set] of [['generated', { ...gen, config: { ...gen.config, split: { held_out: 0.5 } } }], ['compliance', REAL_SPLIT()]]) {
    const { split, ...plain } = set.config;
    const whole = scored({ ...set, config: plain });
    const halves = scored({ ...set, opts: { applySplit: true, heldOut: true, look: true, now: new Date(NOW) } });
    const held = halves.split.held_out, tuning = halves.routing;
    assert.equal(halves.split.tuning.records + held.records, whole.records.length, name + ': records');
    for (const [what, a, b, all] of [
      ['silent errors', tuning.silent_errors.rate, held.silent_errors, whole.routing.silent_errors.rate],
      ['straight-through', tuning.straight_through, held.straight_through, whole.routing.straight_through],
    ]) {
      assert.deepEqual([a.n + b.n, a.d + b.d], [all.n, all.d], name + ': ' + what);
    }
  }
});

test('the groups add up to the total when each record has one label, and the traps too', () => {
  const r = scored(gen);
  const total = r.routing.silent_errors.rate;
  const rows = r.groups[0].rows;
  assert.equal(rows.reduce((t, x) => t + x.records, 0), r.records.length);
  assert.equal(rows.reduce((t, x) => t + x.silent_errors.rate.n, 0), total.n);
  assert.equal(rows.reduce((t, x) => t + x.silent_errors.rate.d, 0), total.d);
  assert.equal(rows.reduce((t, x) => t + x.straight_through.n, 0), r.routing.straight_through.n);
  const traps = r.traps.groups;
  assert.equal(traps.reduce((t, x) => t + x.records.length, 0), r.records.length);
  assert.equal(traps.reduce((t, x) => t + x.silent_errors.length, 0), total.n);
});

// ---------- Gates and repeats ----------

test('a stricter gate never lets more records out', () => {
  for (const [name, dir] of [['tiny', 'tiny'], ['gate', 'gate']]) {
    const folderOf = path.join(__dirname, 'fixtures', dir);
    const config = loadConfig(path.join(folderOf, 'config.json'));
    const { paired } = scoreRun({ config, predPath: path.join(folderOf, 'predictions.json'), keyPath: path.join(folderOf, 'key.json') });
    const rows = gateSweep(paired, config).rows;
    for (let i = 1; i < rows.length; i++) {
      const before = new Set(rows[i - 1].through);
      assert.ok(rows[i].through.every(id => before.has(id)), name + ' at ' + rows[i].threshold);
    }
  }
  const dir = folder({ 'c.json': gen.config, 'k.json': gen.key, 'p.json': gen.pred });
  const config = loadConfig(path.join(dir, 'c.json'));
  const { paired } = scoreRun({ config, predPath: path.join(dir, 'p.json'), keyPath: path.join(dir, 'k.json') });
  const counts = gateSweep(paired, config).rows.map(r => r.through.length);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  assert.ok(counts[0] > counts[counts.length - 1], 'the sweep moved something');
});

test('compare of a run with itself says no change, on every outcome and every metric', () => {
  const rand = seeded(17);
  for (const [name, set] of SETS()) {
    const dir = folder({ 'c.json': set.config, 'k.json': set.key, 'a.json': set.pred, 'b.json': shuffled(set.pred, rand) });
    const c = compareRun({ config: loadConfig(path.join(dir, 'c.json')), keyPath: path.join(dir, 'k.json'), beforePath: path.join(dir, 'a.json'), afterPath: path.join(dir, 'b.json') });
    assert.ok(c.paired.outcomes.every(o => o.fixed === 0 && o.broke === 0), name);
    assert.ok(c.paired.outcomes.every(o => o.verdict === 'no change' || o.verdict === 'not measured'), name + ': ' + c.paired.outcomes.map(o => o.verdict));
    assert.ok(c.metrics.every(m => m.verdict === 'no change' || m.verdict === 'not measured'), name);
    for (const [k, v] of Object.entries(c.records)) if (Array.isArray(v)) assert.deepEqual(v, [], name + ': ' + k);
  }
});

test('compare with its two sides swapped: what one calls fixed, the other calls broke', () => {
  const broken = oneValueBroken(gen, seeded(31), 3).reduce((pred, next) => next.map((x, i) => (x === gen.pred[i] ? pred[i] : x)), gen.pred);
  const dir = folder({ 'c.json': gen.config, 'k.json': gen.key, 'a.json': gen.pred, 'b.json': broken });
  const way = (before, after) => compareRun({ config: loadConfig(path.join(dir, 'c.json')), keyPath: path.join(dir, 'k.json'), beforePath: path.join(dir, before), afterPath: path.join(dir, after) }).paired.outcomes;
  const forth = way('a.json', 'b.json'), back = way('b.json', 'a.json');
  assert.ok(forth.some(o => o.fixed + o.broke > 0), 'something changed');
  assert.deepEqual(forth.map(o => [o.name, o.fixed, o.broke]), back.map(o => [o.name, o.broke, o.fixed]));
});

test('variance of identical runs, in different orders, gives no spread', () => {
  const rand = seeded(19);
  for (const [name, set] of SETS()) {
    const dir = folder({ 'c.json': set.config, 'k.json': set.key, 'a.json': set.pred, 'b.json': shuffled(set.pred, rand), 'd.json': shuffled(set.pred, rand) });
    const v = varianceRun({ config: loadConfig(path.join(dir, 'c.json')), keyPath: path.join(dir, 'k.json'), predPaths: ['a', 'b', 'd'].map(n => path.join(dir, n + '.json')) });
    for (const m of v.metrics) if (m.values.some(x => x !== null)) assert.deepEqual([m.name, m.range, m.sd], [m.name, 0, 0]);
    assert.equal(v.records.route_changed.length, 0, name);
    assert.equal(v.records.silent_changed.length, 0, name);
    assert.equal(v.silent_error_rate.any_run.n, v.silent_error_rate.worst_run.n, name + ': no run failed on a record the others passed');
  }
});

// ---------- The other commands ----------

test('monitor: the running bound depends on the records, not on how they are cut into periods', () => {
  const counts = rows => {
    const dir = folder({ 'c.json': rows.map(([period, out_without_review, silent_errors]) => ({ period, out_without_review, silent_errors })) });
    return monitorRun({ countsPath: path.join(dir, 'c.json'), target: 5, acceptable: 2.5 });
  };
  const weeks = counts([['W1', 100, 0], ['W2', 150, 1], ['W3', 250, 2]]);
  const whole = counts([['all', 500, 3]]);
  assert.equal(weeks.bound.upper_pct, whole.bound.upper_pct);
  assert.equal(weeks.bound.shown, whole.bound.shown);
});

test('agree: the order of the graders, and of a key\'s records, changes no number', () => {
  const A = path.join(__dirname, 'fixtures', 'agree');
  const config = loadConfig(path.join(A, 'config.json'));
  const paths = ['ann', 'ben', 'cai'].map(n => path.join(A, n + '.json'));
  const nums = keyPaths => {
    const out = numbers({ outputs: agreeKeys({ config, keyPaths, seed: 5 }).outputs.map(o => ({ alpha: o.alpha, units: o.units, disagreements: o.disagreements.length })) });
    for (const v of Object.values(out)) v.sort((a, b) => a - b);
    return out;
  };
  const rand = seeded(23);
  const copy = (p, i) => { const dir = folder({ ['g' + i + '.json']: shuffled(readJson(p), rand) }); return path.join(dir, 'g' + i + '.json'); };
  assert.deepEqual(nums([paths[2], paths[0], paths[1]]), nums(paths));
  assert.deepEqual(nums(paths.map(copy)), nums(paths));
});

test('estimate and suspects: shuffling the records changes no number', () => {
  const rand = seeded(29);
  const E = path.join(__dirname, 'fixtures', 'estimate');
  const preds = readJson(path.join(E, 'predictions.json')), judge = readJson(path.join(E, 'judge-key.json')), person = readJson(path.join(E, 'person-key.json'));
  const est = (p, j, k) => {
    const dir = folder({ 'c.json': readJson(path.join(E, 'config.json')), 'p.json': p, 'j.json': j, 'k.json': k });
    return numbers(estimateRun({ config: loadConfig(path.join(dir, 'c.json')), predPath: path.join(dir, 'p.json'), judgeKeyPath: path.join(dir, 'j.json'), personKeyPath: path.join(dir, 'k.json') }).estimate);
  };
  assert.deepEqual(est(shuffled(preds, rand), shuffled(judge, rand), shuffled(person, rand)), est(preds, judge, person));

  const S = path.join(__dirname, 'fixtures', 'suspects');
  const runA = readJson(path.join(S, 'run-a.json')), runB = readJson(path.join(S, 'run-b.json')), key = readJson(path.join(S, 'key.json'));
  const sus = (a, b, k) => {
    const dir = folder({ 'c.json': readJson(path.join(S, 'config.json')), 'a.json': a, 'b.json': b, 'k.json': k });
    const r = suspectsRun({ config: loadConfig(path.join(dir, 'c.json')), keyPath: path.join(dir, 'k.json'), predPaths: [path.join(dir, 'a.json'), path.join(dir, 'b.json')] });
    return r.suspects.map(s => [s.id, s.output, s.value, s.weight]).sort();
  };
  assert.deepEqual(sus(shuffled(runA, rand), shuffled(runB, rand), shuffled(key, rand)), sus(runA, runB, key));
});

// ---------- Every command, twice ----------

test('every command gives the same bytes twice, apart from the timestamp', () => {
  const F = path.join(__dirname, 'fixtures');
  const dir = folder({});
  const at = name => path.join(dir, name);
  const fx = (name, pred = 'predictions.json', key = 'key.json') => ['--config', path.join(F, name, 'config.json'), '--pred', path.join(F, name, pred), '--key', path.join(F, name, key)];
  const runs = n => ['a', 'b', 'c'].slice(0, n).map(x => path.join(F, 'runs', 'run-' + x + '.json'));
  const est = ['--config', path.join(F, 'estimate/config.json'), '--pred', path.join(F, 'estimate/predictions.json'), '--judge-key', path.join(F, 'estimate/judge-key.json')];
  const COMMANDS = [
    ['score', ...fx('tiny'), '--json', at('o.json'), '--html', at('o.html')],
    ['check', ...fx('tiny')],
    ['variance', '--config', path.join(F, 'tiny/config.json'), '--key', path.join(F, 'tiny/key.json'), ...runs(3), '--json', at('o.json')],
    ['compare', '--config', path.join(F, 'tiny/config.json'), '--key', path.join(F, 'tiny/key.json'), '--before', runs(1)[0], '--after', path.join(F, 'runs/run-b.json'), '--json', at('o.json')],
    ['whatif', ...fx('gate'), '--gate', '--target', '30', '--json', at('o.json')],
    ['whatif', ...fx('tiny'), '--floor'],
    ['whatif', ...fx('policy'), '--policies', path.join(F, 'policy/policies.json'), '--target', '30'],
    ['rate', '2', '15', '--target', '5', '--json', at('o.json')],
    ['estimate', ...est, '--key', path.join(F, 'estimate/person-key.json'), '--target', '60', '--json', at('o.json')],
    ['estimate', ...est, '--pick', '10', '--seed', '1'],
    ['monitor', '--counts', path.join(F, 'monitor/counts.csv'), '--target', '5', '--json', at('o.json')],
    ['agree', '--config', path.join(F, 'agree/config.json'), '--keys', ...['ann', 'ben', 'cai'].map(n => path.join(F, 'agree', n + '.json')), '--json', at('o.json')],
    ['suspects', '--config', path.join(F, 'suspects/config.json'), '--key', path.join(F, 'suspects/key.json'), path.join(F, 'suspects/run-a.json'), path.join(F, 'suspects/run-b.json'), '--json', at('o.json')],
    ['grade', '--config', path.join(F, 'freetext/grading.json'), '--pred', path.join(F, 'freetext/forms.json'), '--out', at('o.html')],
  ];
  const stamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
  const once = args => {
    fs.rmSync(at('o.json'), { force: true });
    fs.rmSync(at('o.html'), { force: true });
    const r = spawnSync(process.execPath, [WFEVAL, ...args], { encoding: 'utf8' });
    const file = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(stamp, 'T') : null);
    return JSON.stringify([r.status, r.stdout, r.stderr, file(at('o.json')), file(at('o.html'))]);
  };
  for (const args of COMMANDS) assert.equal(once(args), once(args), args.slice(0, 2).join(' '));
});
