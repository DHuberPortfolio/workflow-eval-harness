// Cross-checks src/metrics/agreement.js against an independent implementation of Krippendorff's
// alpha: the Python package `krippendorff` (Santiago Castro, pypi.org/project/krippendorff).
// Not part of the tool and not run by npm test: it needs Python with that package, which this
// repository never installs. Use a throwaway virtual environment outside the repository:
//
//   py -3.11 -m venv <somewhere>/kvenv
//   <somewhere>/kvenv/Scripts/python -m pip install krippendorff numpy
//   node scripts/agree-crosscheck.js <somewhere>/kvenv/Scripts/python
//
// It draws random reliability data (seeded: the same data every time), with 2 to 6 graders,
// 5 to 80 records, 2 to 6 values and 0% to 50% of the values missing, computes alpha both ways
// for nominal, ordinal, interval and ratio data, and prints the largest absolute difference.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { krippendorffAlpha } = require('../src/metrics/agreement.js');

const python = process.argv[2];
if (!python) { console.error('usage: node scripts/agree-crosscheck.js <python with krippendorff installed>'); process.exit(2); }

// mulberry32, as in agreement.js
function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = seeded(20261031);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const METRICS = ['nominal', 'ordinal', 'interval', 'ratio'];
const cases = [];
for (let c = 0; c < 400; c++) {
  const graders = int(2, 6), units = int(5, 80), levels = int(2, 6), missing = rand() * 0.5;
  // Values 1..levels; each record has a "true" level that graders mostly agree on.
  const data = Array.from({ length: graders }, () => []);
  for (let u = 0; u < units; u++) {
    const truth = int(1, levels);
    for (let g = 0; g < graders; g++) data[g].push(rand() < missing ? null : rand() < 0.6 ? truth : int(1, levels));
  }
  const metric = METRICS[c % 4];
  const unitsOf = data[0].map((_, u) => data.map(row => row[u]));
  const order = Array.from({ length: levels }, (_, i) => i + 1);
  const ours = krippendorffAlpha(unitsOf, { metric, order }).alpha;
  cases.push({ metric, levels, data, ours });
}

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wfeval-xcheck-')), 'cases.json');
fs.writeFileSync(file, JSON.stringify(cases));
const py = `
import json, sys, math
import numpy as np, krippendorff
cases = json.load(open(sys.argv[1]))
out = []
for c in cases:
    data = np.array([[np.nan if v is None else v for v in row] for row in c["data"]], dtype=float)
    try:
        a = krippendorff.alpha(reliability_data=data, level_of_measurement=c["metric"], value_domain=list(range(1, c["levels"] + 1)))
        out.append(None if a is None or (isinstance(a, float) and math.isnan(a)) else float(a))
    except Exception as e:
        out.append("error: " + str(e))
print(json.dumps({"version": getattr(krippendorff, "__version__", None) or __import__("importlib.metadata").metadata.version("krippendorff"), "alphas": out}))
`;
const r = spawnSync(python, ['-I', '-c', py, file], { encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const parsed = JSON.parse(r.stdout);
const theirs = parsed.alphas;
console.log("independent implementation: Python package krippendorff " + parsed.version);
let max = 0, compared = 0, bothUndefined = 0, mismatch = [];
cases.forEach((c, i) => {
  const t = theirs[i];
  if (typeof t === 'string' || t === null) {
    if (c.ours === null) bothUndefined++;
    else mismatch.push({ i, metric: c.metric, ours: c.ours, theirs: t });
    return;
  }
  if (c.ours === null) { mismatch.push({ i, metric: c.metric, ours: null, theirs: t }); return; }
  compared++;
  max = Math.max(max, Math.abs(c.ours - t));
});
const per = METRICS.map(m => m + ' ' + cases.filter(c => c.metric === m).length).join(', ');
console.log(cases.length + ' random data sets (' + per + '), 2-6 graders, 5-80 records, 0-50% missing');
console.log('compared: ' + compared + '; not measurable in both: ' + bothUndefined + '; one side only: ' + mismatch.length);
console.log('largest absolute difference in alpha: ' + max.toExponential(2));
if (mismatch.length) console.log(JSON.stringify(mismatch.slice(0, 5)));
process.exit(mismatch.length || max > 1e-9 ? 1 : 0);
