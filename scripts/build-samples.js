// Rebuilds the sample reports in docs/samples/ from real runs:
//   - the compliance reviewer before its prompt fix (run 50, prompt v1) and after (run 59,
//     prompt v2), on its 40-document golden set, scored against answer key v2
//   - both workflows on their 500-record golden sets: the compliance reviewer's run 67, and
//     the metadata tagger's run 70 (the middle of its three runs of the current version)
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

const C = 'examples/compliance-reviewer';
const M = 'examples/metadata-enrichment/golden500';
const SAMPLES = [
  { file: 'compliance-before.html', config: C + '/config.json', pred: C + '/runs/exec-50.harness.json', key: C + '/key.json', generated: '2026-09-23T00:00:00.000Z' },
  { file: 'compliance-after.html', config: C + '/config.json', pred: C + '/runs/exec-59.harness.json', key: C + '/key.json', generated: '2026-09-23T00:00:00.000Z' },
  { file: 'compliance-golden500.html', config: C + '/config.json', pred: C + '/golden500/exec-67.harness.json', key: C + '/golden500/exec-67.harness.json', generated: '2026-09-29T00:00:00.000Z' },
  { file: 'metadata-golden500.html', config: M + '/config.json', pred: M + '/exec-70.json', key: M + '/exec-70.json', generated: '2026-09-29T00:00:00.000Z' },
];

fs.mkdirSync('docs/samples', { recursive: true });
for (const s of SAMPLES) {
  const results = scoreRun({ config: loadConfig(s.config), predPath: s.pred, keyPath: s.key });
  fs.writeFileSync('docs/samples/' + s.file, renderHtml(results, s.generated));
  console.log('wrote docs/samples/' + s.file);
}
