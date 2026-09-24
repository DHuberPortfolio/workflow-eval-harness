// Rebuilds the sample reports in docs/samples/ from the compliance reviewer's real runs:
// one before its prompt fix (run 50, prompt v1) and one after (run 59, prompt v2), both
// scored against answer key v2.
//
//   node scripts/build-samples.js
//
// The "generated" time is fixed, so the reports come out the same byte for byte on every
// machine. CI rebuilds them and fails if they differ from the committed copies: the samples
// the README links to are always what the tool produces today.
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../src/config.js');
const { scoreRun } = require('../src/score.js');
const { renderHtml } = require('../src/report/html.js');

process.chdir(path.join(__dirname, '..'));   // so the file paths printed in the reports match everywhere

const GENERATED = '2026-09-23T00:00:00.000Z';
const E = 'examples/compliance-reviewer';
const SAMPLES = [
  { file: 'compliance-before.html', pred: E + '/runs/exec-50.harness.json' },
  { file: 'compliance-after.html', pred: E + '/runs/exec-59.harness.json' },
];

const config = loadConfig(E + '/config.json');
fs.mkdirSync('docs/samples', { recursive: true });
for (const s of SAMPLES) {
  const results = scoreRun({ config, predPath: s.pred, keyPath: E + '/key.json' });
  fs.writeFileSync('docs/samples/' + s.file, renderHtml(results, GENERATED));
  console.log('wrote docs/samples/' + s.file);
}
