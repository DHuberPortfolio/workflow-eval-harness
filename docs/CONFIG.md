# Config reference

One JSON file per workflow. Only `outputs` and `routing.map` are required; everything
else has a default, and a misspelled key is an error rather than a silent fallback.
`wfeval check --config <file>` validates a config and prints what it understood.

```json
{
  "id_field": "id",
  "input": {
    "predictions": { "unwrap": "json" },
    "key": {}
  },
  "outputs": {
    "SUBJECT": { "type": "set" },
    "verdict": { "type": "label", "labels": ["pass", "elevate", "fail"], "confidence_field": "confidence" }
  },
  "routing": {
    "field": "decision",
    "gold_field": "expected_decision",
    "map": { "AUTO_PUBLISH": "auto", "EDITOR_REVIEW": "review", "DENY": "block", "DUPLICATE": "exclude" }
  },
  "wrong_when": "either",
  "thresholds": { "floor": 0.6, "provisional_below": 0.75, "auto_publish": { "SUBJECT": 0.85 }, "gate_uses": "lead" },
  "trap_field": "trap",
  "min_per_trap": 3
}
```

## Where things are

| Key | Default | Meaning |
|---|---|---|
| `id_field` | `"id"` | The field that identifies a record in both files. |
| `input.<predictions\|key>.format` | from the extension | `json`, `jsonl` (`.jsonl`, `.ndjson`) or `csv` (`.csv`, `.tsv`). |
| `input.<file>.records_at` | - | The list of records is inside the file, e.g. `"data.results"` in an API response. |
| `input.<file>.unwrap` | - | Each record is inside a field, e.g. `"json"` in an n8n export. Never guessed: if every record's id sits inside the same field, the tool stops and names this setting. |
| `input.<file>.delimiter` | `,` (tab for `.tsv`) | CSV only: `,` `;` `\t` or `\|`. |
| `input.<file>.list_separator` | `\|` | CSV only: between several values in one cell: `A \| B`. |
| `input.<file>.confidence_separator` | `@` | CSV only: before a value's confidence: `SUBJ-MNA@0.95`. |

Every field name can be a dotted path (`"output.subject"` is `subject` inside `output`).
A field literally named with a dot is used first, because spreadsheet exports flatten names that way.

## What the workflow outputs

`outputs` is an object of output name to settings.

| Key | Default | Meaning |
|---|---|---|
| `type` | required | `set`: zero or more values per record (tags, violation codes). `label`: exactly one value from `labels`. `ordinal`: one value from `labels` in order (bands 1-5), where a near miss counts less than a far one. |
| `labels` | - | Label and ordinal outputs: every allowed label (for ordinal, lowest to highest). Numbers are accepted and compared as text. |
| `near_miss_steps` | `1` | Ordinal: a miss by this many steps or fewer is SP-NEAR-MISS (low severity) instead of SP-WRONG. `0` makes every miss a full miss. |
| `field` | the output's name | Where the workflow's values are. |
| `key_field` | same as `field` | Where the answer key's values are. Different when predictions and answers share one file. |
| `value_key` / `confidence_key` | `"value"` / `"confidence"` | Inside a value object, which fields hold the value and its confidence. |
| `rejected_field` | - | Sets: a separate field listing values proposed but not applied; read as `applied: false`. |
| `confidence_field` | - | Labels and ordinals: a separate field holding the label's confidence. |

A value is written as `"text"` or `{ "value": "text", "confidence": 0.9, "applied": true, "inherited_from": "..." }`.
`applied` must be a real `true`/`false`; `inherited_from` marks a value copied from another
(a broader term), which is left out of calibration.

## Routing

| Key | Default | Meaning |
|---|---|---|
| `routing.field` | `"route"` | The workflow's decision for the record. |
| `routing.map` | required | Every decision name to a route class: `auto` (went through, no human), `review` (a person decides), `block` (never processed, no human), `exclude` (duplicate suppressed, no human). At least one must be `auto`. |
| `routing.gold_field` | - | The answer key's correct decision. Without it, route-based error types, silent omissions and block precision are "not measured". |
| `wrong_when` | `either` with a gold field, else `any_mismatch` | What decides that a record needed a human: `either` (the key's route, or any wrong value), `gold_route` (only the key's route: right when outputs are reasons, not published content), `any_mismatch` (only the values). |

## Thresholds, what-if and calibration

| Key | Default | Meaning |
|---|---|---|
| `thresholds.floor` | - | Values below it should never be applied. |
| `thresholds.provisional_below` | - | A label on values, not a gate; reported in calibration. |
| `thresholds.auto_publish` | - | `{ output: threshold }`. Only listed outputs gate. A record may go through only if each gated output's lead value is at or above its threshold. |
| `thresholds.gate_uses` | `"lead"` | `lead`: the strongest applied value. `weakest`: every applied value (stricter; a weak but correct broader term holds back the record). |
| `whatif.movable_field` / `movable_values` | - | The prediction field that says a record's route was decided by the gate (or that it went through), and its values for those records. Without it, what-if assumes every auto or review record is movable: an upper bound. |
| `calibration.buckets` | `"auto"` | `distinct` (one group per stated value), a width such as `0.1`, or `auto` (distinct up to 12 values). |

## The answer key and traps

| Key | Default | Meaning |
|---|---|---|
| `trap_field` | - | The key's field naming what each record is designed to test (text, or a list). Results are also broken down by trap. |
| `min_per_trap` | - | Every trap type must have at least this many records; below it stops in strict mode. |
| `duplicate_of_field` | - | The key's field giving the id of the primary a duplicate repeats. Enables SP-WRONG-PRIMARY and SO-PRIMARY-SUPPRESSED. |
| `allowed_values` | - | `{ output: [values] }` or `{ output: { "file": "vocab.json", "field": "code" } }` (relative to the config). An applied value outside it is SP-INVALID. |
| `severity` | see docs/SILENT_ERRORS.md | `{ "SP-DUPLICATE": "medium" }`: override any error type's severity. |
