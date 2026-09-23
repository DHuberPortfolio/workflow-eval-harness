# Input shapes

The six records of the tiny fixture, written the way five different kinds of tools
produce output. Each has a config that says where things are; nothing else differs.
The tests assert all five load to exactly the same records as `../tiny/predictions.json`
(and the two answer-key versions to the same records as `../tiny/key.json`).

| File | Stands for | What the config adds |
|---|---|---|
| `n8n.json` | an n8n export: each record inside `"json"` | `"input": { "predictions": { "unwrap": "json" } }` |
| `agent.jsonl` | a script or custom agent logging one JSON record per line, with its own field names and nesting | dotted paths (`"output.subject"`, `"decision.route"`) and renamed keys (`"value_key": "label"`, `"confidence_key": "score"`) |
| `api.json` | an API response with the records inside `"data.results"` | `"input": { "predictions": { "records_at": "data.results" } }` |
| `combined.json` | predictions and answers in one file, each record carrying its own `"expected"` | `"key_field": "expected.SUBJECT"`; pass the same file as `--pred` and `--key` |
| `sheet.csv` + `key.csv` | a spreadsheet export (Excel, Google Sheets, Zapier Tables): values as `SUBJ-MNA@0.95 \| SUBJ-ANTI@0.88`, rejected values in their own column, a notes column with commas, quotes and a line break | `"rejected_field": "SUBJECT_rejected"`; the format comes from the `.csv` extension |

Try any of them:

```
node bin/wfeval.js check --config test/fixtures/shapes/agent.config.json --pred test/fixtures/shapes/agent.jsonl --key test/fixtures/tiny/key.json
node bin/wfeval.js check --config test/fixtures/shapes/combined.config.json --pred test/fixtures/shapes/combined.json --key test/fixtures/shapes/combined.json
```
