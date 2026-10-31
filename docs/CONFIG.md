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
| `input.key.any_of_separator` | - | CSV answer key only: between the alternatives of one slot, so `EP-12 \| EP-7 / EP-8` with `"/"` is EP-12 and one of EP-7 or EP-8 ([below](#any-of-these-is-right-and-equivalent-values)). Off unless set, so a value containing the character is never split by surprise. |

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
| `decline` | - | Labels: the workflow may decline to answer, and a decline is its own outcome (below). |

A value is written as `"text"` or `{ "value": "text", "confidence": 0.9, "applied": true, "inherited_from": "..." }`.
`applied` must be a real `true`/`false`; `inherited_from` marks a value copied from another
(a broader term), which is left out of calibration.

### "Any of these is right", and equivalent values

Two things an answer key could not say before, without rewriting it before every run:

**Any one of several values is right.** Three episodes cover the point, and citing any one of
them answers the question. In a set output's answer key, write those as one **slot**:

```json
{ "id": "Q1", "cites": ["ep-05", { "any_of": ["ep-01", "ep-02", "ep-03"] }] }
```

This record needs ep-05 and one of ep-01, ep-02, ep-03. A plain value is a slot of one. The
slot is filled when the workflow applied any of its values; each applied value in it is right
(two from one slot are both right), and a slot left unfilled is one miss, shown as
`one of ep-01, ep-02, ep-03`. How that counts: [METRICS.md](METRICS.md#any-of-these-is-right).

- `any_of` holds a list of one or more values, each text, trimmed like any value. An empty
  list, a value that is not text, or anything else in the object stops, naming the record.
- It belongs in the answer key: a prediction lists what the workflow gave.
- Sets only. On a label output it stops ("any_of is for set outputs"): a label has one right
  answer per record, and its confusion matrix needs one key label per row. For two names of
  one label, use `equivalents`.
- A value in two slots of one record (`["a", { "any_of": ["a", "b"] }]`) stops in strict mode:
  usually a key mistake.
- In a CSV answer key, set `input.key.any_of_separator` (say `"/"`) and write the slot as
  `ep-01 / ep-02 / ep-03` inside the cell.

**One thing under two names.** An episode re-released under a new id, a code and its alias:

```json
"equivalents": {
  "cites": [["ep-12", "ep-12-rerun"]],
  "tags": [["SUBJ-MNA", "SUBJ-MERGERS", "SUBJ-ACQUISITIONS"]]
}
```

| Key | Meaning |
|---|---|
| `equivalents.<output>` | A list of groups. Every value in a group is read as the group's **first** value, in the predictions, in the answer key (any_of slots included) and in `allowed_values`, before anything is counted. So every metric, the calibration, the possible key gaps and the what-ifs agree, with no rule of their own. |

- A group lists two or more values; a value may be in one group only; the output must exist.
- For a label output, the first value must be one of its labels (or a decline value): the
  others are read as it. Not on the output that is also the route.
- If one prediction then holds the same value twice (it cited both `ep-12` and
  `ep-12-rerun`), the two merge into one: applied if either was, at the higher confidence.
  The report lists each merge ("merged 2 equivalent values") and, per file, which values were
  read as another and how often. `wfeval check` prints the groups it will read.

### Declines

```json
"category": {
  "type": "label",
  "labels": ["case_results", "attorneys", "awards", "news"],
  "decline": { "values": ["none"], "field": "declined" }
}
```

Either or both:

| Key | Meaning |
|---|---|
| `decline.values` | Label values that mean "declined", such as `"none"` or `"unsure"`. In the answer key, one of them means declining is the correct outcome. Never also a label. |
| `decline.field` | A prediction field that is `true` (a real true, not text) when the workflow declined, whatever label sits beside it. That label is shown as "set aside" and never counted as an answer: useful when the workflow names a category but drops it below its own threshold. |

A missing label is still a stop (trap F3), not a decline, unless `decline.field` is `true`:
"nothing" might be a crash. With only `decline.field`, the answer key cannot say to decline,
so "answers that should have been declines" is reported as not measured. Label outputs only,
and not the output that is also the route. What is reported:
[METRICS.md](METRICS.md#declines); the error types: [SILENT_ERRORS.md](SILENT_ERRORS.md#declines).

## Routing

| Key | Default | Meaning |
|---|---|---|
| `routing.field` | `"route"` | The workflow's decision for the record. |
| `routing.map` | required | Every decision name to a route class: `auto` (went out without review), `review` (a person decides), `block` (never processed, no person sees it), `exclude` (suppressed as a duplicate, no person sees it). At least one must be `auto`. |
| `routing.gold_field` | - | The answer key's correct decision. Without it, route-based error types, silent omissions and block precision are "not measured". |
| `wrong_when` | `either` with a gold field, else `any_mismatch` | What decides that a record needed a person: `either` (the answer key's route, or any wrong value), `gold_route` (only the answer key's route: right when outputs are reasons, not published content), `any_mismatch` (only the values). |

## Thresholds, what-if and calibration

| Key | Default | Meaning |
|---|---|---|
| `thresholds.floor` | - | Values below it should never be applied. |
| `thresholds.provisional_below` | - | A label on values, not a gate; reported in calibration. |
| `thresholds.auto_publish` | - | `{ output: threshold }`. Only listed outputs gate. A record may go out without review only if each gated output's lead value is at or above its threshold. |
| `thresholds.gate_uses` | `"lead"` | `lead`: the strongest applied value. `weakest`: every applied value (stricter; a weak but correct broader term holds back the record). |
| `whatif.movable_field` / `movable_values` | - | The prediction field that says a record's route was decided by the gate (or that it went out without review), and its values for those records. Without it, what-if assumes every auto or review record is movable: an upper bound. |
| `calibration.buckets` | `"auto"` | `distinct` (one group per stated value), a width such as `0.1`, or `auto` (distinct up to 12 values). |

## The answer key and traps

| Key | Default | Meaning |
|---|---|---|
| `trap_field` | - | The answer key's field naming what each record is designed to test (text, or a list). Results are also broken down by trap. |
| `min_per_trap` | - | Every trap type must have at least this many records; below it stops in strict mode. |
| `duplicate_of_field` | - | The answer key's field giving the id of the primary a duplicate repeats. Enables SP-WRONG-PRIMARY and SO-PRIMARY-SUPPRESSED. |
| `allowed_values` | - | `{ output: [values] }` or `{ output: { "file": "vocab.json", "field": "code" } }` (relative to the config). An applied value outside it is SP-INVALID. |
| `severity` | see docs/SILENT_ERRORS.md | `{ "SP-DUPLICATE": "medium" }`: override any error type's severity. |

## Rates per group

The headline rates again, for each value of a field: the tuning half against the held-out half,
one kind of email against another, one branch of the workflow against another.

```json
"groups": {
  "half": { "field": "split" },
  "branch": { "field": "decision_branch", "from": "predictions" }
}
```

| Key | Default | Meaning |
|---|---|---|
| `groups.<name>.field` | required | Where each record's label is (a name or a dotted path). Text, a number or true/false is one label; a list puts the record in each of its labels' groups; missing, `null` or empty puts it in "(none)". An object is an error: point `field` at the text inside it. |
| `groups.<name>.from` | `"key"` | `key` or `predictions`: the only file the field is read from, even when both are one file. The answer key is the usual place, since a label there belongs to the test record and no run can change it. `predictions` is for what the workflow reports about itself, such as which branch decided. |

On the command line, `wfeval score ... --group-by split` adds a group read from the answer key,
named by its path; repeat it for more. What is reported, and how to read it:
[METRICS.md](METRICS.md#per-group).

## Records that come in clusters

Some records come in clumps that tend to go right or wrong together: several retellings of one
news story, or the many statements of one company filing (they share a unit, so one misread unit
makes them all wrong). Ten reviews of one restaurant written by the same person are one opinion,
not ten. The silent error rate's likely range assumes every record is a separate piece of
evidence, so with clumps it comes out too narrow. Name the field that says which clump each
record belongs to, and `score` adds a second range under the headline that counts the clumps
(clusters) instead.

```json
"clusters": { "field": "story" }
```

| Key | Default | Meaning |
|---|---|---|
| `clusters.field` | required | Where each record's cluster is (a name or a dotted path): text, a number or true/false, read as text. A record is in one cluster, so a list is an error, naming the record (as is an object: point `field` at the value inside it). A record with no value (missing, `null` or empty) is a cluster of its own, and the report says how many records were. |
| `clusters.from` | `"key"` | `key` or `predictions`: the only file the field is read from, as for a group. |

On the command line, `--cluster-by` does the same, reading the answer key:

```
wfeval score --config test/fixtures/clusters/config.json --pred test/fixtures/clusters/predictions.json --key test/fixtures/clusters/key.json --cluster-by story
```

It takes one field; a config that already names clusters reading something else is refused
rather than overridden. The field must hold the cluster itself: "the story this retells, or the
record's own id when it is the original" is not a field most answer keys have, so add one (a
`story` field) rather than pointing at `duplicate_of`, which leaves each original out of its own
retellings' cluster. The headline, the per-group rows and `--target` are unchanged. What is
reported, and how it is worked out: [METRICS.md](METRICS.md#ranges-that-count-clusters).

## Weighting to a real mix (`--mix`)

A golden set built from traps holds far more hard records than real traffic, so its silent error
rate is a stress-test rate. A driving test taken mostly on icy roads says little about a sunny
commute, until you weight each kind of road by how often it is icy. `--mix` does that weighting
for one group: give each of its labels its share of real traffic, and `score` adds the silent
error rate that mix would see, under the headline, beside the golden set's own.

The mix is a file of its own, beside the config:

```json
{ "group": "channel", "shares": { "email": 0.7, "chat": 0.3 } }
```

| Key | Meaning |
|---|---|
| `group` | A group the run has: one of the config's `groups`, or a field given with `--group-by`. |
| `shares` | Each label's share of real traffic: fractions (0.7), percentages (70) or counts (a month's 1,400 emails and 600 chats). They are divided by their total, so they need not add up to 1. A share of 0 says real traffic has none of that label: its records then weigh nothing. Records with no label in the group's field are the label "(none)". |

```
wfeval score --config test/fixtures/clusters/config.json --pred test/fixtures/clusters/predictions.json --key test/fixtures/clusters/key.json --group-by section --mix test/fixtures/clusters/mix.json
```

Weights need every record in exactly one group, and a weight for every group, so scoring stops,
in lenient mode too, when:

- a label of the run has no share: the report cannot guess the weight of a kind of record. A
  record with no label needs a share for "(none)", and the stop names the record;
- a share is for a label the run does not have, even a share of 0: those records were never
  tested, so nothing can be said about them ("did you mean" for a label that differs only in case
  or spaces);
- a record has several labels in the group (a message that came in by chat and by email):
  weighted in each, it would count twice;
- the group is not one of the run's, or a share is text (`"0.7"`), negative, or every share is 0.

The shares are taken as known, so the estimate is only as good as they are: count them from real
traffic (a month of production logs by channel, say), not from memory. What is reported, and how
it is worked out: [METRICS.md](METRICS.md#weighted-to-a-real-mix).

## Rulings on possible key gaps (`--rulings`)

`score` and `variance` list **possible key gaps**: values the workflow applied that the answer
key does not list. Each one is either a mistake or a value the key is missing, and only a person
can say which. A rulings file records what that person decided, so each one is decided once:

```json
{ "rulings": [
  { "id": "R2", "output": "SUBJECT", "value": "SUBJ-ANTI", "ruling": "reject", "by": "DH", "on": "2026-10-30", "note": "the article is about M&A only" },
  { "id": "R7", "output": "SUBJECT", "value": "SUBJ-LAB", "ruling": "add", "by": "DH", "on": "2026-10-30" },
  { "id": "R9", "output": "GEOGRAPHY", "value": "GEO-CA", "ruling": "pending", "by": "DH", "on": "2026-10-31", "note": "ask the desk" }
] }
```

Pass it with `--rulings <file>` to `score`, `variance` or `compare`. It sits beside the answer
key and is read with it; the key file itself is never changed.

| Field | Meaning |
|---|---|
| `id` | The answer key record the ruling is for. |
| `output` | A set output from the config. Labels have one answer per record, so a key cannot be missing one. |
| `value` | The value ruled on. Trimmed, and read through the config's `equivalents`, so a ruling written with an alias rules on the value it stands for. |
| `ruling` | `add`, `reject` or `pending` (below). |
| `by`, `on` | Who decided, and when. Required: an untraceable ruling is what the file replaces. Missing, scoring stops (strict mode) or warns (`--lenient`). |
| `note` | Optional: why. |

What each ruling does:

- **`add`**: the value belongs in the key. For scoring, it joins that record's key as a plain
  value: one more value the workflow has to give. Every report says how many values the rulings
  added and names them ("1 value added to the answer key by rulings in rulings.json: K2 SUBJECT
  SUBJ-MNA"), so a reader knows the key in use is not the key file alone.
- **`reject`**: not a gap. The value stays wrong, and it is never listed as a possible key gap
  again; reports count it instead ("1 ruled not a gap").
- **`pending`**: not decided yet. Scored as wrong, the strict reading. `score` also gives the
  silent error rate as if every pending ruling were an add, so you can see how much the open
  questions could move it ([METRICS.md](METRICS.md#possible-key-gaps-and-rulings)).

The file stops scoring, naming the entry, when it is not this shape, has an unknown key, a ruling
other than the three (with "did you mean" for `"Add"`), an output that is not a set output, or
rules on the same value of the same record twice (an alias and its value count as the same). In
strict mode it also stops on a ruling with no `by` or `on`, a record that is not in the answer
key, or an `add` for a value outside the output's `allowed_values` (a typo would add a value
nothing can fill). `--lenient` turns those into warnings: a ruling for an unknown record or a
value not allowed is set aside, and one without `by` or `on` still applies. A ruling for
a value the key already accepts (a plain value, an alternative of an any_of slot, or an
equivalent of either) changes nothing: it is set aside with a warning.

`compare --key old.json --after-key new.json --before run.json --after run.json` scores the same
run against two answer keys, to see what a new key changes; `--rulings` then applies to both
keys ([METRICS.md](METRICS.md#possible-key-gaps-and-rulings)).

## Grading free text (`wfeval grade`)

Free-text outputs have no answer key; a person grades them. `wfeval grade` takes a separate,
smaller config that says where each form's fields and source text are:

```json
{
  "title": "Assessment form v1",
  "id_field": "id",
  "source_field": "transcript",
  "fields": {
    "reason": { "field": "form.reason", "section": "Reason for contacting", "label": "Your reason for contacting People's Services?" },
    "enjoyed": { "field": "form.enjoyed", "section": "Unique strengths" }
  },
  "kinds": ["figure altered", "contradiction smoothed over", "also leaves something out"]
}
```

| Key | Default | Meaning |
|---|---|---|
| `fields` | required | Every free-text field to grade, in the order the page shows them. |
| `fields.<name>.field` | the name | Where the field's text is (a name or dotted path). Text, a number, true/false, or empty; an empty field is still graded. |
| `fields.<name>.section` | - | The form section it belongs to. Rates are also pooled per section. |
| `fields.<name>.label` | the name | The question the page shows for it. |
| `source_field` | - | Where the source text (a transcript) is. Shown beside the fields. Without it the page says to grade against your own copy. |
| `kinds` | `figure altered`, `contradiction smoothed over`, `also leaves something out` | Tick boxes offered on an invented field: how it was invented. Tags on the grade, counted in the report. |
| `id_field`, `input` | `"id"`, - | As above: `input` takes `format`, `records_at`, `unwrap` and `delimiter`. |
| `title` | - | Shown on the page and carried into the grades file. |

```
wfeval grade --config grading.json --pred forms.json --out grading.html
wfeval score --grades grades-A.json [--second-reviewer grades-B.json]
```

The page saves a grades file (format `wfeval-grades/1`) that carries everything `score --grades`
needs, including a fingerprint of exactly what was graded, so no config is passed to `score`.
Why the grades are three and not five: [METRICS.md](METRICS.md#free-text-graded-by-a-person).
