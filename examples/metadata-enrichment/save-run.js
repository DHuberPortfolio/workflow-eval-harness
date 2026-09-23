// Saves one n8n execution of the metadata enrichment workflow as a harness run.
//
//   node examples/metadata-enrichment/save-run.js <execution.json> <out.json>
//
// <execution.json> is the execution with its node data, as n8n's API returns it (it must
// include the "Harness Export" node, and "Operations Scorecard" for the cross-check).
// The workflow's Harness Export node already emits the harness's shape, so this only
// lifts those records out and checks their routes against the workflow's own scorecard:
// if the counts differ, the file is not written.
const fs = require('fs');

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) { console.error('usage: node save-run.js <execution.json> <out.json>'); process.exit(2); }

const execution = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const runData = execution.data.resultData.runData;
const items = node => {
  if (!runData[node]) throw new Error('the execution has no data for the "' + node + '" node');
  return runData[node][0].data.main[0].map(i => i.json);
};

const records = items('Harness Export');
const scorecard = items('Operations Scorecard')[0];

const counts = {};
for (const r of records) counts[r.decision] = (counts[r.decision] || 0) + 1;
const want = scorecard.routing.by_decision;
const same = Object.keys({ ...counts, ...want }).every(d => counts[d] === want[d]);
if (!same) {
  console.error('routes ' + JSON.stringify(counts) + ' differ from the scorecard ' + JSON.stringify(want) + '; not written');
  process.exit(1);
}

fs.writeFileSync(outPath, '[\n' + records.map(r => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n');
console.log('wrote ' + outPath + ': execution ' + execution.execution.id + ', ' + records.length + ' records, routes match the scorecard ' + JSON.stringify(want));
