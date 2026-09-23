// Replays run 49 of the metadata enrichment workflow and writes it in the harness's shape.
//
//   node examples/metadata-enrichment/export-run49.js <path to the showcase's eval/metadata-enrichment>
//
// Uses the showcase repo's own replay (run.js), in memory; nothing is written there.
// Writes, next to this file:
//   run49.json          one combined record per article (see adapter.js)
//   allowed/<FACET>.json  the allowed values per facet: active vocabulary codes, and the
//                         company authority file's ids, so the harness can check for invented values
const fs = require('fs');
const path = require('path');
const { adapt } = require('./adapter.js');

const showcase = process.argv[2];
if (!showcase) { console.error('usage: node export-run49.js <showcase eval/metadata-enrichment folder>'); process.exit(2); }
const { replay, read } = require(path.resolve(showcase, 'run.js'));

const vocab = JSON.parse(read('vocab.json'));
const out = replay(vocab, JSON.parse(read('run49-layer2.json')));
const here = __dirname;

const records = adapt(out.layer3);
fs.writeFileSync(path.join(here, 'run49.json'), '[\n' + records.map(r => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n');

fs.mkdirSync(path.join(here, 'allowed'), { recursive: true });
for (const facet of ['SUBJECT', 'INDUSTRY', 'GEOGRAPHY']) {
  const codes = vocab.filter(v => String(v.facet).trim() === facet && String(v.status || 'active').trim() === 'active').map(v => String(v.code).trim());
  fs.writeFileSync(path.join(here, 'allowed', facet + '.json'), JSON.stringify(codes, null, 1) + '\n');
}
const companies = out.queue[0].entity_master.map(e => e.entity_id);
fs.writeFileSync(path.join(here, 'allowed', 'COMPANY.json'), JSON.stringify(companies, null, 1) + '\n');

console.log('wrote run49.json (' + records.length + ' records) and allowed/*.json');
