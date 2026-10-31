// Ranges that count clusters within a run (traps G14-G17), checked against
// test/fixtures/clusters/EXPECTED.md.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateConfig, loadConfig } = require('../src/config.js');
const { problems } = require('../src/problems.js');
const { normalizeKey, normalizePredictions } = require('../src/load.js');
const { align } = require('../src/align.js');
const { scoreRun } = require('../src/score.js');
const stats = require('../src/metrics/stats.js');
const { renderTerminal } = require('../src/report/terminal.js');
const { renderHtml } = require('../src/report/html.js');
const { resultsJson } = require('../src/report/json.js');

const dir = path.join(__dirname, 'fixtures', 'clusters');
const configPath = path.join(dir, 'config.json');
const keyPath = path.join(dir, 'key.json');
const PRED = { main: path.join(dir, 'predictions.json'), even: path.join(dir, 'predictions-even.json'), perfect: path.join(dir, 'predictions-perfect.json') };
const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const plain = loadConfig(configPath);
const withClusters = (clusters = { field: 'story' }) => {
  const { config, errors } = validateConfig({ ...raw, clusters });
  assert.deepEqual(errors, []);
  return config;
};
const scored = {};
const S = (which, clusters) => (clusters ? scoreRun({ config: withClusters(clusters), predPath: PRED[which], keyPath })
  : (scored[which] ??= scoreRun({ config: withClusters(), predPath: PRED[which], keyPath })));
const near = (actual, expected, places) => assert.ok(Math.abs(actual - expected) < 0.5 * 10 ** -places, actual + ' is not ' + expected);
const cli = args => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wfeval.js'), ...args], { encoding: 'utf8' });

// ---------- The arithmetic (src/metrics/stats.js) ----------

// The fixture's clusters with records out without review, as { n: records out, y: silent errors }.
const MAIN = [{ n: 4, y: 3 }, { n: 3, y: 0 }, { n: 2, y: 0 }, { n: 2, y: 0 }, { n: 1, y: 0 }];
const EVEN = [{ n: 4, y: 1 }, { n: 3, y: 1 }, { n: 2, y: 0 }, { n: 2, y: 1 }, { n: 1, y: 0 }];

test('G14: errors in one cluster: var_c 0.044488, design effect 2.847222, 4.214634 records\' worth, 4.7-69.1%', () => {
  const c = stats.clusteredRange(MAIN);
  assert.deepEqual([c.n, c.y, c.clusters, c.method, c.why], [12, 3, 5, 'design_effect', null]);
  near(c.var_clustered, 6.40625 / 144, 12);
  near(c.var_simple, 0.015625, 12);
  near(c.design_effect, 2.847222, 6);
  near(c.effective, 4.214634, 6);
  near(c.low, 0.047311, 6);
  near(c.high, 0.691113, 6);
  // The headline counts every record: 8.9-53.2%.
  const w = stats.wilson(3, 12);
  near(w.low, 0.088940, 6);
  near(w.high, 0.532310, 6);
});

test('G17: errors spread across clusters: the design effect (0.347) is floored at 1, so the range is the headline\'s', () => {
  const c = stats.clusteredRange(EVEN);
  near(c.var_clustered, 0.78125 / 144, 12);
  near(c.var_clustered / c.var_simple, 0.347222, 6);   // what the data says, before the floor
  assert.equal(c.design_effect, 1);
  assert.equal(c.effective, 12);
  assert.deepEqual([c.low, c.high], [stats.wilson(3, 12).low, stats.wilson(3, 12).high]);
});

test('G16: with no silent errors the design effect is 0 / 0, so each cluster counts as one record', () => {
  const c = stats.clusteredRange(MAIN.map(x => ({ n: x.n, y: 0 })));
  assert.deepEqual([c.method, c.why, c.design_effect, c.effective, c.clusters], ['cluster_count', 'no_silent_errors', null, 5, 5]);
  assert.equal(c.low, 0);
  near(c.high, 0.434491, 6);   // 0 of 5, against 0 of 12's 0.242501
  // Every record a silent error, and a single cluster: the same fallback.
  const all = stats.clusteredRange(MAIN.map(x => ({ n: x.n, y: x.n })));
  assert.deepEqual([all.method, all.why, all.effective], ['cluster_count', 'all_silent_errors', 5]);
  near(all.high, 1, 9);
  const one = stats.clusteredRange([{ n: 12, y: 3 }]);
  assert.deepEqual([one.method, one.why, one.effective, one.clusters], ['cluster_count', 'one_cluster', 1, 1]);
  // Wilson at 0.25 over 1 record: 1 + 3.8416 = 4.8416; center 2.1708 / 4.8416; half 1.96 x sqrt(1.1479) / 4.8416.
  near(one.low, 0.014634, 6);
  near(one.high, 0.882094, 6);
});

test('clusteredRange: nothing out is nothing to measure; empty clusters do not count; every record alone costs one record', () => {
  assert.equal(stats.clusteredRange([]), null);
  assert.equal(stats.clusteredRange([{ n: 0, y: 0 }]), null);
  // A cluster with no records out (story E) is not one of C.
  assert.deepEqual(stats.clusteredRange([...MAIN, { n: 0, y: 0 }]), stats.clusteredRange(MAIN));
  // Twelve clusters of one record each: var_c = p(1-p)/(n-1), design effect 12/11, 11 records' worth.
  const alone = stats.clusteredRange([...Array(3).fill({ n: 1, y: 1 }), ...Array(9).fill({ n: 1, y: 0 })]);
  near(alone.design_effect, 12 / 11, 12);
  near(alone.effective, 11, 12);
  near(alone.low, 0.085102, 6);
  near(alone.high, 0.544318, 6);
  // A bad cluster is refused, not guessed at.
  assert.throws(() => stats.clusteredRange([{ n: 2, y: 3 }]), RangeError);
  assert.throws(() => stats.clusteredRange([{ n: 1.5, y: 0 }]), RangeError);
});

// An independent check, written differently from the implementation: read the fixture files
// directly (no load.js, no judge.js), decide each record's silent error by comparing the value
// sets, and add up var_c the way Miller writes it (Eq. 4): every pair of records in the same
// cluster, (s_i - p)(s_j - p), the pair of a record with itself included.
function bruteForce(predFile) {
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const preds = new Map(JSON.parse(fs.readFileSync(predFile, 'utf8')).map(r => [r.id, r]));
  const out = key.filter(k => preds.get(k.id).decision === 'PUBLISH').map(k => {
    const got = preds.get(k.id).SUBJECT;
    const same = got.length === k.SUBJECT.length && got.every(v => k.SUBJECT.includes(v));
    return { cluster: k.story === undefined ? 'alone:' + k.id : 'story:' + k.story, s: same ? 0 : 1 };
  });
  const n = out.length;
  const p = out.reduce((t, r) => t + r.s, 0) / n;
  let sum = 0;
  for (const a of out) for (const b of out) if (a.cluster === b.cluster) sum += (a.s - p) * (b.s - p);
  const C = new Set(out.map(r => r.cluster)).size;
  return { n, p, C, var_c: (C / (C - 1)) * sum / (n * n) };
}

test('G14: a brute-force var_c from the raw files agrees with the implementation, for every run', () => {
  const b = bruteForce(PRED.main);
  assert.deepEqual([b.n, b.p, b.C], [12, 0.25, 5]);
  near(b.var_c, 0.044487847, 9);
  near(stats.clusteredRange(MAIN).var_clustered, b.var_c, 15);
  near(stats.clusteredRange(EVEN).var_clustered, bruteForce(PRED.even).var_c, 15);
  assert.equal(bruteForce(PRED.perfect).var_c, 0);
  // And through the whole tool: the design effect it reports is the brute force's over p(1-p)/n.
  near(S('main').clusters.design_effect, b.var_c / (b.p * (1 - b.p) / b.n), 3);
});

// ---------- Through `wfeval score` ----------

test('G14: score reports the clustered range for the fixture; the headline does not move', () => {
  const c = S('main').clusters;
  assert.deepEqual(c, {
    field: 'story', from: 'key', records: 12, silent_errors: 3, clusters: 5, records_own_cluster: 1,
    method: 'design_effect', why: null, design_effect: 2.847, effective_records: 4.2, pct: 25, low_pct: 4.7, high_pct: 69.1,
  });
  const plainRun = scoreRun({ config: plain, predPath: PRED.main, keyPath });
  assert.deepEqual(S('main').routing, plainRun.routing);
  assert.deepEqual(S('main').routing.silent_errors.rate, { n: 3, d: 12, pct: 25, low_pct: 8.9, high_pct: 53.2 });
});

test('G17: score on the even run: design effect 1, the headline\'s range', () => {
  const c = S('even').clusters;
  assert.deepEqual([c.method, c.design_effect, c.effective_records, c.low_pct, c.high_pct], ['design_effect', 1, 12, 8.9, 53.2]);
});

test('G16: score on the perfect run falls back to the 5 clusters: 0.0-43.4%, against 0.0-24.3%', () => {
  const r = S('perfect');
  assert.deepEqual(r.clusters, {
    field: 'story', from: 'key', records: 12, silent_errors: 0, clusters: 5, records_own_cluster: 1,
    method: 'cluster_count', why: 'no_silent_errors', design_effect: null, effective_records: 5, pct: 0, low_pct: 0, high_pct: 43.4,
  });
  assert.equal(r.routing.silent_errors.rate.high_pct, 24.3);
});

test('clusters read from the predictions read the predictions only: no story there, so every record is alone', () => {
  const c = S('main', { field: 'story', from: 'predictions' }).clusters;
  assert.deepEqual([c.from, c.clusters, c.records_own_cluster, c.design_effect, c.effective_records, c.low_pct, c.high_pct],
    ['predictions', 12, 12, 1.091, 11, 8.5, 54.4]);
});

test('results.clusters appears only when clusters are configured, and the JSON carries it', () => {
  const p = scoreRun({ config: plain, predPath: PRED.main, keyPath });
  assert.equal(p.clusters, undefined);
  assert.equal('clusters' in resultsJson(p), false);
  assert.equal(resultsJson(S('main')).clusters.design_effect, 2.847);
  assert.equal(plain.clusters, null);
});

test('nothing out without review: the clusters say there is nothing to count', () => {
  const config = withClusters();
  const records = scoreRun({ config, predPath: PRED.main, keyPath }).paired.map(r => ({ ...r, route: 'REVIEW', route_class: 'review' }));
  const { scoreRecords } = require('../src/score.js');
  const { scoreClusters } = require('../src/metrics/clusters.js');
  const c = scoreClusters(scoreRecords(records, config).records, records, config);
  assert.deepEqual([c.records, c.clusters, c.method, c.pct, c.low_pct, c.high_pct], [0, 0, null, null, null, null]);
  const { clusterLine } = require('../src/report/format.js');
  assert.equal(clusterLine(c), 'Clusters (answer key field "story"): nothing went out without review, so there is nothing to count.');
});

// ---------- Reading the cluster field (G15) ----------

const KCONFIG = validateConfig({
  outputs: { tags: { type: 'set' } },
  routing: { map: { AUTO: 'auto', REVIEW: 'review' } },
  clusters: { field: 'meta.story' },
}).config;
const readKey = (story, mode = 'strict') => {
  const p = problems(mode);
  const result = normalizeKey([{ id: 'R1', tags: [], meta: { story } }], KCONFIG, 'key', p);
  return { result, flagged: p.items.map(i => i.level + ':' + i.trap), items: p.items };
};

test('a cluster value is text, a number or true/false, read as trimmed text; missing, null or empty is no cluster', () => {
  const cluster = story => readKey(story).result[0].cluster;
  assert.equal(cluster(' s1 '), 's1');
  assert.equal(cluster(7), '7');   // as text, so a CSV's "7" and a JSON 7 are one cluster
  assert.equal(cluster(true), 'true');
  for (const none of [undefined, null, '', '   ']) assert.equal(cluster(none), null, JSON.stringify(none));
  assert.deepEqual(readKey('s1').flagged, []);
  // Without clusters in the config, records carry none.
  const noClusters = validateConfig({ outputs: { tags: { type: 'set' } }, routing: { map: { AUTO: 'auto' } } }).config;
  assert.equal('cluster' in normalizeKey([{ id: 'R1', tags: [] }], noClusters, 'key', problems('strict'))[0], false);
});

test('G15: a list as a cluster value stops, naming the record: a record is in one cluster', () => {
  for (const list of [['s1', 's2'], ['s1'], []]) {
    const { flagged, items } = readKey(list);
    assert.deepEqual(flagged, ['stop:G15'], JSON.stringify(list));
    assert.equal(items[0].where, 'key R1');
    assert.match(items[0].message, /cluster field "meta\.story" is a list; a record is in one cluster/);
  }
  // An object has no value to show: it stops too, suggesting a field inside it.
  const obj = readKey({ id: 's1', source: 'wire' });
  assert.deepEqual(obj.flagged, ['stop:G15']);
  assert.match(obj.items[0].message, /is an object.*"meta\.story\.id"/);
  // Lenient mode too: there is no one cluster to put the record in.
  assert.deepEqual(readKey(['s1', 's2'], 'lenient').flagged, ['stop:G15']);
});

test('clusters: a key-side field reads only the answer key, a prediction-side one only the predictions', () => {
  const both = from => {
    const config = validateConfig({ outputs: { tags: { type: 'set' } }, routing: { map: { AUTO: 'auto' } }, clusters: { field: 'story', from } }).config;
    const p = problems('strict');
    const preds = normalizePredictions([{ id: 'R1', route: 'AUTO', tags: [], story: 'from-pred' }], config, 'preds', p);
    const answers = normalizeKey([{ id: 'R1', tags: [], story: 'from-key' }], config, 'key', p);
    return align(preds, answers, config, p)[0].cluster;
  };
  assert.equal(both('key'), 'from-key');
  assert.equal(both('predictions'), 'from-pred');
});

// ---------- The config and the command line ----------

test('clusters config: field and from, like a group; anything else is an error', () => {
  assert.deepEqual(withClusters().clusters, { field: 'story', from: 'key' });
  assert.deepEqual(withClusters({ field: 'meta.story', from: 'predictions' }).clusters, { field: 'meta.story', from: 'predictions' });
  const errs = c => validateConfig({ ...raw, clusters: c }).errors.join('\n');
  assert.match(errs('story'), /clusters must be \{ "field": "<field>", "from": "key" \| "predictions" \}/);
  assert.match(errs({}), /clusters\.field must be a field name/);
  assert.match(errs({ field: 'a..b' }), /clusters\.field must be a field name/);
  assert.match(errs({ field: 'story', from: 'answers' }), /clusters\.from must be one of: key, predictions/);
  assert.match(errs({ field: 'story', by: 'x' }), /unknown key "clusters\.by" \(allowed: field, from\)/);
});

test('--cluster-by adds clusters read from the answer key; a bad path, a second field or a clash is refused', () => {
  const { addClusterBy } = require('../src/config.js');
  assert.deepEqual(addClusterBy(plain, 'meta.story').clusters, { field: 'meta.story', from: 'key' });
  assert.equal(plain.clusters, null);   // the loaded config is not changed
  assert.deepEqual(addClusterBy(withClusters(), 'story').clusters, { field: 'story', from: 'key' });   // the same: fine
  assert.throws(() => addClusterBy(plain, 'a..b'), /--cluster-by must be a field name/);
  assert.throws(() => addClusterBy(withClusters({ field: 'story', from: 'predictions' }), 'story'), /the config already has clusters/);
  const args = ['score', '--config', configPath, '--pred', PRED.main, '--key', keyPath];
  const ok = cli([...args, '--cluster-by', 'story']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Records out without review came from 5 clusters \(answer key field "story"\); counting clusters, the likely range is 4\.7-69\.1%/);
  const two = cli([...args, '--cluster-by', 'story', '--cluster-by', 'other']);
  assert.equal(two.status, 1);
  assert.match(two.stderr, /--cluster-by takes one field/);
  const grades = cli(['score', '--grades', 'g.json', '--cluster-by', 'story']);
  assert.equal(grades.status, 1);
  assert.match(grades.stderr, /does not take --cluster-by/);
  // check names the clusters a config reads.
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wfeval-clusters-'));
  const withFile = path.join(tmp, 'config.json');
  fs.writeFileSync(withFile, JSON.stringify({ ...raw, clusters: { field: 'story' } }));
  assert.match(cli(['check', '--config', withFile]).stdout, /\n  clusters    key field "story"/);
  assert.doesNotMatch(cli(['check', '--config', configPath]).stdout, /\n  clusters /);
  fs.rmSync(tmp, { recursive: true });
});

// ---------- The reports ----------

test('the terminal says it under the headline, in words, for each case', () => {
  const t = renderTerminal(S('main'));
  assert.ok(t.includes('\n  Records out without review came from 5 clusters (answer key field "story"); counting clusters, the likely range is 4.7-69.1% ' +
    '(design effect 2.8: about 4 independent records\' worth). 1 record had no value there and is a cluster of its own.\n'));
  // In the HEADLINE section, before the silent errors.
  assert.ok(t.indexOf('HEADLINE') < t.indexOf('came from 5 clusters') && t.indexOf('came from 5 clusters') < t.indexOf('SILENT ERRORS'));
  assert.match(renderTerminal(S('even')), /the likely range is 8\.9-53\.2% \(design effect 1: the clusters show no clumping, so this is the range above\)/);
  assert.match(renderTerminal(S('perfect')), /the likely range is 0\.0-43\.4%\. With no silent errors, nothing shows how far a cluster's records go together, so each cluster counts as one record \(5 records' worth\): the cautious choice\./);
  assert.match(renderTerminal(S('main', { field: 'story', from: 'predictions' })), /12 records had no value there and are each a cluster of their own\./);
  assert.doesNotMatch(renderTerminal(scoreRun({ config: plain, predPath: PRED.main, keyPath })), /counting clusters|came from/);
});

test('the HTML report carries the same line, escaped', () => {
  const h = renderHtml(S('main'), '2026-10-31T00:00:00.000Z');
  assert.match(h, /<p>Records out without review came from 5 clusters \(answer key field &quot;story&quot;\); counting clusters, the likely range is 4\.7-69\.1%/);
  assert.ok(h.indexOf('class="card hero"') < h.indexOf('came from 5 clusters') && h.indexOf('came from 5 clusters') < h.indexOf('<h2>Silent errors</h2>'));
  assert.doesNotMatch(renderHtml(scoreRun({ config: plain, predPath: PRED.main, keyPath }), '2026-10-31T00:00:00.000Z'), /counting clusters|came from/);
  const evil = structuredClone(S('main'));
  evil.clusters.field = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(renderHtml(evil, '2026-10-31T00:00:00.000Z'), /<img src=x/);
});

test('per-group rows and the target stay unclustered, and the reports say so', () => {
  const r = S('main', { field: 'story' });
  const config = validateConfig({ ...raw, clusters: { field: 'story' }, groups: { story: { field: 'story' } } }).config;
  const g = scoreRun({ config, predPath: PRED.main, keyPath, target: 10 });
  assert.deepEqual(g.clusters, r.clusters);
  const t = renderTerminal(g);
  assert.match(t, /These ranges count every record as independent; only the line under the headline counts clusters\./);
  assert.match(t, /The verdict and the plan count records as independent; records that come in clusters need more of them\./);
  const h = renderHtml(g, '2026-10-31T00:00:00.000Z');
  assert.match(h, /These ranges count every record as independent; only the line under the headline counts clusters\./);
  assert.match(h, /The verdict and the plan count records as independent; records that come in clusters need more of them\./);
  // Without clusters, neither note.
  const noClusters = scoreRun({ config: validateConfig({ ...raw, groups: { story: { field: 'story' } } }).config, predPath: PRED.main, keyPath, target: 10 });
  assert.doesNotMatch(renderTerminal(noClusters), /count records as independent|count every record as independent/);
});
