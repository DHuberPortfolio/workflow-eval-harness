# Input shapes

The six records of the tiny fixture, written the way four different kinds of tools
produce output. Each has a config that says where things are; nothing else differs.
The tests assert all four load to exactly the same records as `../tiny/predictions.json`.

| File | Stands for | What the config adds |
|---|---|---|
| `n8n.json` | an n8n export: each record inside `"json"` | `"input": { "predictions": { "unwrap": "json" } }` |
| `agent.jsonl` | a script or custom agent logging one JSON record per line, with its own field names and nesting | dotted paths (`"output.subject"`, `"decision.route"`) and renamed keys (`"value_key": "label"`, `"confidence_key": "score"`) |
| `api.json` | an API response with the records inside `"data.results"` | `"input": { "predictions": { "records_at": "data.results" } }` |
| `combined.json` | predictions and answers in one file, each record carrying its own `"expected"` | `"key_field": "expected.SUBJECT"`; pass the same file as `--pred` and `--key` |

Try any of them:

```
node bin/wfeval.js check --config test/fixtures/shapes/agent.config.json --pred test/fixtures/shapes/agent.jsonl --key test/fixtures/tiny/key.json
node bin/wfeval.js check --config test/fixtures/shapes/combined.config.json --pred test/fixtures/shapes/combined.json --key test/fixtures/shapes/combined.json
```
