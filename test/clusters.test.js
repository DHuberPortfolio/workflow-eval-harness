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
const PRED = {
  main: path.join(dir, 'predictions.json'), clumped: path.join(dir, 'predictions-clumped.json'),
  even: path.join(dir, 'predictions-even.json'), perfect: path.join(dir, 'predictions-perfect.json'),
};
const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const plain = loadConfig(configPath);
const withClusters = (clusters = { field: 'story' }) => {
  const { config, errors } = validateConfig({ ...raw, clusters });
  assert.deepEqual(errors, []);
  return config;
};
const scored = {};
const S = (which, clusters, mode = 'strict') => (clusters ? scoreRun({ config: withClusters(clusters), predPath: PRED[which], keyPath, mode })
  : (scored[which] ??= scoreRun({ config: withClusters(), predPath: PRED[which], keyPath })));
const near = (actual, expected, places) => assert.ok(Math.abs(actual - expected) < 0.5 * 10 ** -places, actual + ' is not ' + expected);
const cli = args => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'wfeval.js'), ...args], { encoding: 'utf8' });

// ---------- The arithmetic (src/metrics/stats.js) ----------

// The fixture's clusters with records out without review (A, B, C, D and N13 alone), as
// { n: records out, y: silent errors }.
const MAIN = [{ n: 4, y: 3 }, { n: 3, y: 0 }, { n: 2, y: 0 }, { n: 2, y: 0 }, { n: 1, y: 0 }];
const CLUMPED = [{ n: 4, y: 3 }, { n: 3, y: 0 }, { n: 2, y: 1 }, { n: 2, y: 0 }, { n: 1, y: 0 }];
const EVEN = [{ n: 4, y: 1 }, { n: 3, y: 1 }, { n: 2, y: 0 }, { n: 2, y: 1 }, { n: 1, y: 0 }];
const PERFECT = MAIN.map(x => ({ n: x.n, y: 0 }));

test('G14: errors piled up in story A, one more in C: var_c 0.038580, design effect 1.909722, 6.283636 records\' worth, 9.9-69.4%', () => {
  const c = stats.clusteredRange(CLUMPED);
  assert.deepEqual([c.n, c.y, c.clusters, c.method, c.why], [12, 4, 5, 'design_effect', null]);
  near(c.var_clustered, 50 / 1296, 12);
  near(c.var_simple, 2 / 99, 12);   // p(1-p)/(n-1)
  near(c.design_effect, 1.909722, 6);
  near(c.effective, 6.283636, 6);
  near(c.low, 0.099395, 6);
  near(c.high, 0.693741, 6);
  // The headline counts every record: 13.8-60.9%.
  const w = stats.wilson(4, 12);
  near(w.low, 0.138118, 6);
  near(w.high, 0.609382, 6);
});

test('G17: errors spread across clusters: the design effect (0.318) is floored at 1, so the range is the headline\'s', () => {
  const c = stats.clusteredRange(EVEN);
  near(c.var_clustered, 0.78125 / 144, 12);
  near(c.var_clustered / c.var_simple, 0.318287, 6);   // what the data says, before the floor
  assert.equal(c.design_effect, 1);
  assert.equal(c.effective, 12);
  assert.deepEqual([c.low, c.high], [stats.wilson(3, 12).low, stats.wilson(3, 12).high]);
});

// The fixture's clusters out are 4, 3, 2, 2 and 1 records: taken to go together, they are
// Kish's (sum n_c)^2 / sum n_c^2 = 144 / 34 = 72/17 records' worth, not one per cluster (5).
const TOGETHER = 144 / 34;

test('G16: with no silent errors the design effect is 0 / 0, so each cluster\'s records count as going together', () => {
  const c = stats.clusteredRange(PERFECT);
  assert.deepEqual([c.method, c.why, c.design_effect, c.clusters], ['clusters_together', 'no_silent_errors', null, 5]);
  near(c.effective, 4.235294, 6);
  assert.equal(c.low, 0);
  near(c.high, 0.475628, 6);   // 0 of 4.235294, against 0 of 12's 0.242501
  // Every record a silent error, and a single cluster: the same fallback.
  const all = stats.clusteredRange(MAIN.map(x => ({ n: x.n, y: x.n })));
  assert.deepEqual([all.method, all.why, all.effective], ['clusters_together', 'all_silent_errors', TOGETHER]);
  near(all.high, 1, 9);
  const one = stats.clusteredRange([{ n: 12, y: 3 }]);
  assert.deepEqual([one.method, one.why, one.effective, one.clusters], ['clusters_together', 'one_cluster', 1, 1]);
  // Wilson at 0.25 over 1 record: 1 + 3.8416 = 4.8416; center 2.1708 / 4.8416; half 1.96 x sqrt(1.1479) / 4.8416.
  near(one.low, 0.014634, 6);
  near(one.high, 0.882094, 6);
});

test('G16: records that go together are worth (sum n_c)^2 / sum n_c^2: the number of clusters when they are the same size, fewer when not', () => {
  // Four clusters of 3: exactly 4. Clusters of 9 and 1: 100 / 82, nearer one record than two,
  // since the record alone carries a tenth of the weight.
  assert.equal(stats.clusteredRange(Array(4).fill({ n: 3, y: 0 })).effective, 4);
  near(stats.clusteredRange([{ n: 9, y: 0 }, { n: 1, y: 0 }]).effective, 100 / 82, 12);
  // Every record a cluster of its own: every record counts.
  assert.equal(stats.clusteredRange(Array(7).fill({ n: 1, y: 0 })).effective, 7);
  // Never more than the clusters, never fewer than one.
  for (const sizes of [[4, 3, 2, 2, 1], [50, 1, 1], [2, 2], [1, 30]]) {
    const r = stats.clusteredRange(sizes.map(n => ({ n, y: 0 })));
    assert.ok(r.effective <= sizes.length && r.effective >= 1, sizes.join(','));
  }
});

test('G16: every silent error in one cluster (or every other record) is one clump: no design effect, each cluster\'s records together', () => {
  // predictions.json: N1 N2 N3, all in story A. 0.25 over 4.235294 records: 4.7-69.0%.
  const c = stats.clusteredRange(MAIN);
  assert.deepEqual([c.method, c.why, c.design_effect, c.effective, c.clusters], ['clusters_together', 'silent_errors_in_one_cluster', null, TOGETHER, 5]);
  near(c.low, 0.047474, 6);
  near(c.high, 0.690340, 6);
  // The other way round: every record but the silent errors in one cluster (only N13 right).
  const rest = stats.clusteredRange(MAIN.map(x => ({ n: x.n, y: x.n === 1 ? 0 : x.n })));
  assert.deepEqual([rest.method, rest.why, rest.effective], ['clusters_together', 'others_in_one_cluster', TOGETHER]);
  // One silent error is one clump too: N1 alone gives 1/12 over 4.235294 records, 0.7-55.6%.
  const first = stats.clusteredRange(MAIN.map((x, i) => ({ n: x.n, y: i === 0 ? 1 : 0 })));
  assert.deepEqual([first.why, first.effective], ['silent_errors_in_one_cluster', TOGETHER]);
  near(first.high, 0.556480, 6);
});

test('G16: one more silent error never lowers the ceiling while every silent error sits in one cluster', () => {
  const high = clusters => stats.clusteredRange(clusters).high;
  // From no silent errors (47.6%), a first one anywhere: the ceiling goes up. Before, a first error
  // looked like no clumping (a design effect near 1, about 12 records' worth) and gave 35.4%.
  MAIN.forEach((x, i) => {
    const one = PERFECT.map((c, j) => ({ n: c.n, y: j === i ? 1 : 0 }));
    assert.ok(high(one) >= high(PERFECT), 'a first error in cluster ' + i + ' lowers the ceiling: ' + high(one) + ' < ' + high(PERFECT));
  });
  // Piling more into the same cluster, one at a time, to every record of it.
  MAIN.forEach((x, i) => {
    for (let y = 1; y <= x.n; y++) {
      const less = PERFECT.map((c, j) => ({ n: c.n, y: j === i ? y - 1 : 0 }));
      const more = PERFECT.map((c, j) => ({ n: c.n, y: j === i ? y : 0 }));
      assert.ok(high(more) >= high(less), 'error ' + y + ' in cluster ' + i + ' lowers the ceiling');
    }
  });
  // And through the tool, on the reviewer's run: predictions-perfect.json with "antitrust" added to N1.
  const t = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wfeval-clusters-'));
  try {
    const preds = JSON.parse(fs.readFileSync(PRED.perfect, 'utf8'));
    preds.find(r => r.id === 'N1').SUBJECT.push('antitrust');
    fs.writeFileSync(path.join(t, 'one.json'), JSON.stringify(preds));
    const one = scoreRun({ config: withClusters(), predPath: path.join(t, 'one.json'), keyPath }).clusters;
    assert.deepEqual([one.silent_errors, one.method, one.why, one.effective_records, one.high_pct], [1, 'clusters_together', 'silent_errors_in_one_cluster', TOGETHER, 55.6]);
    assert.ok(one.high_pct >= S('perfect').clusters.high_pct);
  } finally { fs.rmSync(t, { recursive: true }); }
});

test('clusteredRange: nothing out is nothing to measure; empty clusters do not count; every record alone is a design effect of exactly 1', () => {
  assert.equal(stats.clusteredRange([]), null);
  assert.equal(stats.clusteredRange([{ n: 0, y: 0 }]), null);
  // A cluster with no records out (story E) is not one of C.
  assert.deepEqual(stats.clusteredRange([...CLUMPED, { n: 0, y: 0 }]), stats.clusteredRange(CLUMPED));
  // Twelve clusters of one record each: var_c = p(1-p)/(n-1), the same as the simple variance
  // over n - 1: the design effect is exactly 1, and the range is the headline's.
  const alone = stats.clusteredRange([...Array(3).fill({ n: 1, y: 1 }), ...Array(9).fill({ n: 1, y: 0 })]);
  assert.deepEqual([alone.method, alone.design_effect, alone.effective], ['design_effect', 1, 12]);
  assert.deepEqual([alone.low, alone.high], [stats.wilson(3, 12).low, stats.wilson(3, 12).high]);
  // At any size and rate, not just this one.
  for (const [n, y] of [[4, 2], [7, 3], [40, 3], [500, 37], [1001, 500]]) {
    const r = stats.clusteredRange([...Array(y).fill({ n: 1, y: 1 }), ...Array(n - y).fill({ n: 1, y: 0 })]);
    assert.deepEqual([r.design_effect, r.effective], [1, n], n + ' records, ' + y + ' errors');
  }
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
  const b = bruteForce(PRED.clumped);
  assert.deepEqual([b.n, b.p, b.C], [12, 1 / 3, 5]);
  near(b.var_c, 50 / 1296, 12);
  near(stats.clusteredRange(CLUMPED).var_clustered, b.var_c, 15);
  near(stats.clusteredRange(EVEN).var_clustered, bruteForce(PRED.even).var_c, 15);
  near(bruteForce(PRED.main).var_c, 6.40625 / 144, 12);
  assert.equal(bruteForce(PRED.perfect).var_c, 0);
  // And through the whole tool: the design effect it reports is the brute force's over p(1-p)/(n-1).
  near(S('clumped').clusters.design_effect, b.var_c / (b.p * (1 - b.p) / (b.n - 1)), 12);
});

// ---------- Through `wfeval score` ----------

test('G14: score reports the clustered range for the clumped run; the headline does not move', () => {
  const { design_effect, effective_records, ...c } = S('clumped').clusters;
  assert.deepEqual(c, {
    field: 'story', from: 'key', records: 12, silent_errors: 4, clusters: 5, records_own_cluster: 1,
    method: 'design_effect', why: null, pct: 33.3, low_pct: 9.9, high_pct: 69.4,
  });
  // Kept as worked out, and rounded only where a report shows them (trap G6).
  near(design_effect, 4950 / 2592, 12);
  near(effective_records, 31104 / 4950, 12);
  const plainRun = scoreRun({ config: plain, predPath: PRED.clumped, keyPath });
  assert.deepEqual(S('clumped').routing, plainRun.routing);
  assert.deepEqual(S('clumped').routing.silent_errors.rate, { n: 4, d: 12, pct: 33.3, low_pct: 13.8, high_pct: 60.9 });
});

test('G16: score on predictions.json, every silent error in story A: the clusters taken together, 4.7-69.0%, against 8.9-53.2%', () => {
  assert.deepEqual(S('main').clusters, {
    field: 'story', from: 'key', records: 12, silent_errors: 3, clusters: 5, records_own_cluster: 1,
    method: 'clusters_together', why: 'silent_errors_in_one_cluster', design_effect: null, effective_records: TOGETHER, pct: 25, low_pct: 4.7, high_pct: 69,
  });
  assert.deepEqual(S('main').routing.silent_errors.rate, { n: 3, d: 12, pct: 25, low_pct: 8.9, high_pct: 53.2 });
});

test('G17: score on the even run: design effect 1, the headline\'s range', () => {
  const c = S('even').clusters;
  assert.deepEqual([c.method, c.design_effect, c.effective_records, c.low_pct, c.high_pct], ['design_effect', 1, 12, 8.9, 53.2]);
});

test('G16: score on the perfect run falls back to the clusters taken together: 0.0-47.6%, against 0.0-24.3%', () => {
  const r = S('perfect');
  assert.deepEqual(r.clusters, {
    field: 'story', from: 'key', records: 12, silent_errors: 0, clusters: 5, records_own_cluster: 1,
    method: 'clusters_together', why: 'no_silent_errors', design_effect: null, effective_records: TOGETHER, pct: 0, low_pct: 0, high_pct: 47.6,
  });
  assert.equal(r.routing.silent_errors.rate.high_pct, 24.3);
});

test('clusters read from the predictions read the predictions only: no story there, so with --lenient (trap P1) every record is alone, a design effect of exactly 1', () => {
  const c = S('main', { field: 'story', from: 'predictions' }, 'lenient').clusters;
  assert.deepEqual([c.from, c.clusters, c.records_own_cluster, c.method, c.design_effect, c.effective_records, c.low_pct, c.high_pct],
    ['predictions', 12, 12, 'design_effect', 1, 12, 8.9, 53.2]);
});

test('results.clusters appears only when clusters are configured, and the JSON carries it', () => {
  const p = scoreRun({ config: plain, predPath: PRED.main, keyPath });
  assert.equal(p.clusters, undefined);
  assert.equal('clusters' in resultsJson(p), false);
  assert.equal(resultsJson(S('clumped')).clusters.design_effect, S('clumped').clusters.design_effect);
  assert.equal(resultsJson(S('main')).clusters.why, 'silent_errors_in_one_cluster');
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
  assert.match(ok.stdout, /Records out without review came from 5 clusters \(answer key field "story"\); counting clusters, the likely range is 4\.7-69\.0%/);
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
  const t = renderTerminal(S('clumped'));
  assert.ok(t.includes('\n  Records out without review came from 5 clusters (answer key field "story"); counting clusters, the likely range is 9.9-69.4% ' +
    '(design effect 1.9: about 6 independent records\' worth). 1 record had no value there and is a cluster of its own.\n'));
  // In the HEADLINE section, before the silent errors.
  assert.ok(t.indexOf('HEADLINE') < t.indexOf('came from 5 clusters') && t.indexOf('came from 5 clusters') < t.indexOf('SILENT ERRORS'));
  assert.match(renderTerminal(S('main')), /the likely range is 4\.7-69\.0%\. With every silent error in one cluster, nothing shows how far a cluster's records go together, so each cluster's records are taken to go right or wrong together \(about 4 records' worth\): the cautious choice\./);
  assert.match(renderTerminal(S('even')), /the likely range is 8\.9-53\.2% \(design effect 1: the clusters show no clumping, so this is the range above\)/);
  assert.match(renderTerminal(S('perfect')), /the likely range is 0\.0-47\.6%\. With no silent errors, nothing shows how far a cluster's records go together, so each cluster's records are taken to go right or wrong together \(about 4 records' worth\): the cautious choice\./);
  const alone = renderTerminal(S('main', { field: 'story', from: 'predictions' }, 'lenient'));
  assert.match(alone, /12 records had no value there and are each a cluster of their own\./);
  assert.match(alone, /the likely range is 8\.9-53\.2% \(design effect 1: the clusters show no clumping, so this is the range above\)/);
  assert.doesNotMatch(renderTerminal(scoreRun({ config: plain, predPath: PRED.main, keyPath })), /counting clusters|came from/);
});

test('G6: the design effect and the records\' worth are kept as worked out, and rounded once, in the line', () => {
  const { scoreClusters } = require('../src/metrics/clusters.js');
  const { clusterLine } = require('../src/report/format.js');
  // Records out in clusters of the given sizes, the first `y` of each a silent error.
  const line = sizes => {
    const summaries = [];
    const records = [];
    sizes.forEach(([n, y], c) => {
      for (let i = 0; i < n; i++) {
        summaries.push({ id: c + '-' + i, route_class: 'auto', silent: i < y });
        records.push({ id: c + '-' + i, cluster: 'c' + c });
      }
    });
    const r = scoreClusters(summaries, records, withClusters());
    return { r, text: clusterLine(r) };
  };
  // 5.4857 records' worth is about 5, not 5.5 and then 6.
  const a = line([[2, 1], [1, 1], [4, 0], [1, 0]]);
  near(a.r.effective_records, 5.485714, 6);
  assert.match(a.text, /\(design effect 1\.5: about 5 independent records' worth\)/);
  // A design effect of 2.4495 is 2.4, not 2.450 and then 2.5.
  const b = line([[2, 2], [3, 3], [3, 0], [1, 0], [1, 0], [1, 0], [1, 0]]);
  near(b.r.design_effect, 2.449537, 6);
  assert.match(b.text, /\(design effect 2\.4: about 5 independent records' worth\)/);
  // Every record that is not a silent error in one cluster: the fallback names it.
  assert.match(line([[3, 3], [2, 2], [2, 0]]).text,
    /With every record but the silent errors in one cluster, nothing shows how far a cluster's records go together/);
});

test('the HTML report carries the same line, escaped', () => {
  const h = renderHtml(S('clumped'), '2026-10-31T00:00:00.000Z');
  assert.match(h, /<p>Records out without review came from 5 clusters \(answer key field &quot;story&quot;\); counting clusters, the likely range is 9\.9-69\.4% \(design effect 1\.9: about 6 independent records&#39; worth\)/);
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
