// One output's error rate counting clusters (trap G22): records that come in clusters go wrong together on one output as on the
// headline, so a gate on that output alone needs the clustered range too, or a run where whole tasks failed looks surer than it is.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateConfig } = require('../src/config.js');
const { scoreRun } = require('../src/score.js');

const config = (extra = {}) => {
  const r = validateConfig({ id_field: 'id', outputs: { outcome: { type: 'label', labels: ['safe', 'attacker won'] } }, routing: { field: 'route', map: { send: 'auto', hold: 'review' } }, ...extra });
  assert.deepEqual(r.errors, []);
  return r.config;
};
// 160 tasks crossed with 3 attacks each; the attacker wins every attack on 4 tasks: 12 of 480, all in 4 clusters.
function files() {
  const key = [];
  const pred = [];
  for (let t = 0; t < 160; t++) for (let a = 0; a < 3; a++) {
    const id = `t${t}a${a}`;
    key.push({ id, outcome: 'safe', task: `task${t}` });
    pred.push({ id, route: 'send', outcome: t < 4 ? 'attacker won' : 'safe' });
  }
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-cluster-outputs-'));
  const w = (n, c) => { const p = path.join(d, n); fs.writeFileSync(p, JSON.stringify(c)); return p; };
  return { keyPath: w('k.json', key), predPath: w('p.json', pred) };
}

test('G22: each output gets its own error rate counted in clusters, as wide as the clusters make it', () => {
  const r = scoreRun({ config: config({ clusters: { field: 'task' } }), ...files() });
  const o = r.clusters_by_output.outcome;
  assert.deepEqual([o.records, o.wrong, o.clusters, o.method], [480, 12, 160, 'design_effect']);
  const plainHigh = 100 - r.quality.outputs.outcome.accuracy.low_pct;
  assert.ok(o.high_pct > plainHigh, `clustered ${o.high_pct}% must be wider than the plain ${plainHigh}%`);
  assert.ok(o.high_pct > 5, 'whole tasks failing: the upper bound is over 5%');
});

test('G22: a config with no clusters has no per-output block, and nothing else moves', () => {
  const r = scoreRun({ config: config(), ...files() });
  assert.equal(Object.hasOwn(r, 'clusters_by_output'), false);
  assert.equal(Object.hasOwn(r, 'clusters'), false);
});
