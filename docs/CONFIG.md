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
| `input.key.any_of_separator` | - | CSV answer key only: between the alternatives of one slot, so `EP-12 \| EP-7 / EP-8` with `"/"` is EP-12 and one of EP-7 or EP-8 ([below](#any-of-these-is-right-and-equivalent-values)). Off unless set, so a value containing the character is never split by surprise. Once set, it applies to **every set output** in the key: a real value holding the character, a tag `TCP/IP`, is split into a slot (one of `TCP`, `IP`), and a label cell holding it stops (a slot is for sets). To limit it, use `any_of_outputs`. |
| `input.key.any_of_outputs` | every set output | CSV answer key only, with `any_of_separator`: the set outputs it splits, such as `["cites"]`. Every other output reads its cells whole, so `TCP/IP` in another output stays one value. Each name must be a set output. |

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
  `ep-01 / ep-02 / ep-03` inside the cell. It splits the cells of every set output in the key,
  so a real value holding the character is read as alternatives: in another output, the tag
  `TCP/IP` would become a slot filled by `TCP` or `IP`. Pick a character no real value holds, or
  name the outputs it is for: `"any_of_outputs": ["cites"]` leaves every other output's cells
  whole.

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
  `ep-12-rerun`), the two merge into one, applied if either was. Its confidence is the one the
  workflow acted on: the highest **applied** copy's, never a higher one it set aside (with
  neither applied, the higher). When two applied copies differ, the lowest is kept too, and the
  floor and a `"weakest"` gate check that one. So a merge never hides a weak value that was
  applied: `ep-12` applied at 0.4 beside `ep-12-rerun` set aside at 0.9 is applied at 0.4, under
  the gate and the floor, as it would be without equivalents.
  The report lists each merge ("merged 2 equivalent values", with the confidences kept) and, per
  file, which values were read as another and how often. `wfeval check` prints the groups it
  will read.

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
| `thresholds.auto_publish` | - | `{ output: threshold }`. Only listed outputs gate. A record may go out without review only if each gated output's lead value is at or above its threshold. A threshold may instead name a prediction field holding each record's own ([below](#each-records-own-threshold)). |
| `thresholds.gate_uses` | `"lead"` | `lead`: the strongest applied value. `weakest`: every applied value (stricter; a weak but correct broader term holds back the record). |
| `whatif.movable_field` / `movable_values` | - | The prediction field that says a record's route was decided by the gate (or that it went out without review), and its values for those records. Without it, what-if assumes every auto or review record is movable: an upper bound. |
| `calibration.buckets` | `"auto"` | `distinct` (one group per stated value), a width such as `0.1`, or `auto` (distinct up to 12 values). |

## Routing policies (`whatif --policies`, `--hold-if`)

A policies file asks "what if we routed differently?" for several policies at once, each shown
as one row beside the run as it was (reading the table: [READING_A_REPORT.md](READING_A_REPORT.md#policies-side-by-side);
what is exact and what is assumed: [METRICS.md](METRICS.md#routing-policies)). It is a file of
its own, not part of the config: the config says how to read a workflow and is shared by every
command, while policies are questions asked of one run, tried and thrown away. Kept apart, what
certification pays for is plain: every row tested, which is the run as it was, each policy in the
file and one more for any `--hold-if` (the report says "5 rows: the run as it was and 4 policies";
trap E9).

```json
{
  "policies": [
    { "name": "Award claims always go to a person",
      "hold_if": [{ "output": "violations", "value": "AWARD_CLAIM_REVIEW" }] },
    { "name": "Strong unapplied findings to a person",
      "hold_if": [{ "output": "violations", "applied": false, "confidence_at_least": 0.85 }] },
    { "name": "Weak matches to a person",
      "hold_if": [{ "field": "match_strength", "in": ["weak", "none"] }] },
    { "name": "Gate 0.90 for every record", "auto_publish": { "violations": 0.9 } },
    { "name": "Cap each client's gate at 0.85", "auto_publish_cap": { "violations": 0.85 } }
  ]
}
```

| Key | Meaning |
|---|---|
| `name` | The row's name, as text. Each must differ, and none may be "as run" in any case (trap E11). |
| `hold_if` | A list of conditions. A record that went out without review is sent to a person when **any** condition holds. |
| `auto_publish` | `{ output: threshold }`: that gated output's threshold for every record. |
| `auto_publish_cap` | `{ output: cap }`: each record's own threshold, but never above the cap (the lower of the two). |

A policy needs at least one of the three (trap E11). Threshold changes come first, then hold-if:
a record the new gate lets out is still held if a condition holds, so "always goes to a person"
means always.

A condition holds when **all** its clauses hold:

| Clause | Meaning |
|---|---|
| `output` | The output (a set or a label) states a value that meets every clause below. With none of them, any value. A declined label counts as a stated value, "(declined)": a decline that went out unseen is one a person may want to see. |
| `value` / `values` | That value, or one of these. Trimmed, and read through `equivalents` as the predictions are (an old name is read as its group's first value, and the report says so). `"value": "*"` means any value, as on the command line. |
| `applied` | `true`: applied. `false`: stated but not applied (the floor, or a client's threshold, kept it out). Left out: either. |
| `confidence_at_least` | Stated at this confidence or more. A value with no confidence never meets it (trap E19). |
| `field` | A prediction field, by name or dotted path, with one of the four below. Never the answer key (trap E17), and never the route's own field (`routing.field`, trap E13): it holds the route as run, not the route under the policy. A field a key-side group or cluster also reads (`groups.channel` reading `channel` from the key) is read from the prediction when the predictions are a file of their own and have it; it stops when only the key has it, and whenever one file is passed as both `--pred` and `--key` (same name or same content), since every record there carries the key's fields, and if the workflow saw it, put it in the predictions and set `groups.<name>.from` to `"predictions"`. |
| `equals` / `in` | That value, or one of these. Numbers compare as numbers, also when written as text (`"0.90"` equals `0.9`); true and false in any case (`"TRUE"` equals `true`); other text exactly, after trimming (`North` is not `north`, as route decisions are not). A value no record has is probably misspelt (trap E14). |
| `below` / `at_least` | Under this number, or at or above it. A number written as text counts; other text never holds (trap E16). |
| `all` | A list of conditions that must all hold: for two field clauses, or two values both stated. Alone in its condition. |

So `[{ "field": "client", "equals": "north", "output": "codes", "value": "B" }]` holds a north
record that states B; `[{ "all": [{ "output": "codes", "value": "A" }, { "output": "codes", "value": "B" }] }]`
holds a record that states both A and B; and a list of two conditions holds a record that meets
either. A list of `all` groups can say any rule built from these clauses with "and" and "or".

`--hold-if` writes one condition on the command line. Repeat it for "or"; all the flags together
are one more policy, named after them, beside any policies file:

| `--hold-if` | Holds a record that went out without review when |
|---|---|
| `codes=B` | codes states B (applied or not) |
| `codes=A,B` | codes states A or B |
| `codes=*` | codes states any value |
| `codes=*@0.85` | codes states any value at a confidence of 0.85 or more |
| `codes.unapplied=B` | codes states B without applying it (`codes.applied=B`: applied) |
| `field:client=north,west` | the prediction field `client` is north or west |
| `field:match<0.5` | the prediction field `match` is under 0.5 (`field:match>=0.5`: at least 0.5) |
| `field:client=north and codes=*@0.9` | both: clauses joined by " and " (in any case) must all hold |

There is no `<=`, `>` or `==`: write `field:match<0.5` or `field:match>=0.5`, and the quick form refuses the others rather than read them as part of a value.

Hold-if needs no gate in the config: a workflow without `thresholds` can still ask whether
sending weak matches to a person pays off. Threshold changes need one (trap E13).

### Each record's own threshold

`thresholds.auto_publish` may name a prediction field instead of giving a number:
`{ "auto_publish": { "violations": "client_threshold" } }` gates each record at its own
`client_threshold`. The gate check, the SG-GATE safeguard and every what-if read it. Each
record the gate could route must have a number from 0 to 1 there (trap E18); text that reads as a
number, such as a CSV's `0.9`, is read as the number. A threshold below `thresholds.floor` is
warned about: a value under the floor is never applied, so that gate never decides anything. A
number written in quotes in the config (`"0.8"`) is refused rather than read as a field named
"0.8". A number in `auto_publish` works exactly
as before.

`whatif --gate` then sets one threshold for every record in place of each one's own, so no row
is marked current; its check runs at each record's own threshold and says whether that
reproduces the real routes (a record whose gate is unknown is listed as not checked). To lower each record's own instead, use a policy with
`auto_publish_cap`.

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
| `clusters.field` | required | Where each record's cluster is (a name or a dotted path): text, a number or true/false, read as text. A record is in one cluster, so a list is an error, naming the record (as is an object: point `field` at the value inside it). In a CSV, a cell holding the list separator (`A \| B`) is a list too. A record with no value (missing, `null` or empty) is a cluster of its own, and the report says how many records were. |
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
- the group is not one of the run's, or a share is text (`"0.7"`), negative, or every share is 0,
  or the shares are too big to add up (`1e308` twice: their total is more than a number can hold).

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
key and is read with it; the key file itself is never changed. A real one:
[the compliance reviewer's](../examples/compliance-reviewer/rulings.json), 25 rulings from its
[key review](../examples/compliance-reviewer/KEY_GAPS.md).

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

## A judge's answer key checked by a person (`wfeval estimate`)

In production there is no answer key. `wfeval estimate` reads two, both in the config's own
answer-key format, so nothing new goes in the config:

```
node bin/wfeval.js estimate --config test/fixtures/estimate/config.json \
  --pred test/fixtures/estimate/predictions.json \
  --judge-key test/fixtures/estimate/judge-key.json --key test/fixtures/estimate/person-key.json
```

- `--judge-key`: an AI judge's answer key for **every record that went out without review**. The
  judge only needs to grade those: records sent to a person or blocked never enter the rate, so
  grading them costs judge calls for nothing (a key that has them is fine too). The judge (an LLM
  grader) runs outside the harness, which never calls a model: export its answers the way you
  would write an answer key.
- `--key`: a person's answer key for the records they checked, and only those.

Each key is scored against the run by the usual rules (`wrong_when`, any_of slots,
`equivalents`), so "silent error" means the same thing for the judge, the person and `score`.

The easiest way to pick them: let the harness do it, before anyone checks.

```
node bin/wfeval.js estimate --config test/fixtures/estimate/config.json \
  --pred test/fixtures/estimate/predictions.json \
  --judge-key test/fixtures/estimate/judge-key.json --pick 10 --seed 1
```

It lists the records to check, in the run's order (so the list does not show the judge's
verdicts), split between the judge's verdicts the way that gives the narrowest range, and chosen
at random within each. The same `--seed` (a whole number up to 4294967295) picks the same
records; `--json picks.json` saves the list. When the judge flags a small share of the records
out (the usual case when errors are rare), most checks go to the records it passes; checking
every flag first is the worst way to spend them ([METRICS.md](METRICS.md#which-records-to-check)).
It needs at least one check per verdict group, so `--pick 1` is refused.

However they are picked, for the estimate to hold:

- **At random**: either from all the records that went out without review, or within each of the
  judge's verdicts (as `--pick` does). Not the first 30 of the run, not the ones that looked
  interesting. A sample bunched at one end of the run is warned about (trap K7).
- **Blind**: the person checks without seeing the judge's verdict.
- **Some in every verdict group**: with none checked among the records the judge passes, their
  rate could be anything, and there is no estimate, only bounds (K3).

Save the pick with `--json picks.json` and give it back with `--picks picks.json` when you
estimate: the report then confirms that the person checked exactly the picked records, or names
the differences (trap K14), and says plainly when the picks file was made from another run. With
`--json` the pick's last line already suggests `--picks` with that file.

`--target 5` says whether the estimate is shown under 5%, and if not, roughly how many more
checks, and in which verdict group, would show it. With `--fail-if-not-shown` it exits with code 3 when the
whole range is not under the target, for a scheduled job (as `compare --fail-if-worse` does). `--lenient` and `--json <file>` work as for
`score`. What is reported, and why this method: [METRICS.md](METRICS.md#a-judges-answer-key-checked-by-a-person).

## Live samples over time (`wfeval monitor`)

`monitor` reads a series of periods (weeks, months) in time order. Each period is the records
out without review that a person checked that period, with their answers. Two ways in, never
mixed (trap L6):

**Run files, scored here.** One file per period, each holding that period's checked records with
the person's answers in the same file, the way the golden-set files in `examples/*/golden500` do:
each output's `field` reads the workflow's value and its `key_field` the person's (the key path
is the predictions path). Every period is scored with the one `--config`, so every definition
matches `score`'s. The period is named after its file: `2026-W41.json` is period `2026-W41`.

    node bin/wfeval.js monitor --config test/fixtures/monitor/config.json test/fixtures/monitor/runs/2026-W40.json test/fixtures/monitor/runs/2026-W41.json test/fixtures/monitor/runs/2026-W42.json --target 5

**Answers kept apart.** When the person's answers are in their own files, put each period's key
in a folder, under the same file name as its period file, and add `--keys <folder>`:
`weeks/2026-W41.json` is then answered by `keys/2026-W41.json` (the config's `key_field`s are read
from the key files). Names are matched without regard to case, on every system; two key files
whose names differ only by case stop. A period file without a key file of the same name stops,
and key files that match no period file are listed in a note (trap A1).

Records in a period file that did not go out without review (sent to a person, blocked or
suppressed) are not part of the silent error rate; the report counts them in a note (trap L17).

**A counts file, scored elsewhere** (a spreadsheet, a Python project). One row per period, in
time order, as a JSON list or a `.csv` file with a header row. The CSV may be split by commas,
";" (Excel in many countries) or tabs: the header row says which, and the report notes it. Column
names are read loosely: `Out Without Review` and `silent-errors` are `out_without_review` and
`silent_errors` (trap L15).

```csv
period,out_without_review,silent_errors,scored_with
2026-W40,30,1,scorecard v2
2026-W41,30,0,scorecard v2
```

| Column | Required | Meaning |
|---|---|---|
| `period` | yes | The period's name |
| `out_without_review` | yes | Records out without review that were checked this period (a whole number) |
| `silent_errors` | yes | Silent errors among them (a whole number, no more than `out_without_review`) |
| `scored_with` | no | What scored them, e.g. `scorecard v2`. When given, every period must say the same, so a change in the scoring is never read as a change in the workflow. After a change in the scoring, start a new list of periods |

    wfeval monitor --counts weekly.csv --target 5

**Names that give the order.** Name each period by its date (`2026-10-05`), month (`2026-10`),
ISO week (`2026-W41`) or a number after the same text (`week-2`, `week-10`: compared as numbers),
all the same way. Period files given out of order (a shell's `weeks/*.json` puts `week-10`
before `week-2`) are put in the order their names give, with a note, but only when they came in
plain text order, the order a glob produces; files listed in any other order out of time stop,
since someone chose that order; a counts file's rows are
written in an order on purpose, so a row out of place there stops (trap L1). Names that give no
order stop in strict mode, and `--lenient` takes the order given.

**Options.**

| Option | Default | Meaning |
|---|---|---|
| `--target <percent>` | none | The rate the silent error rate should be shown to be under |
| `--acceptable <percent>` | half the target | The rate the workflow normally runs at |
| `--alarming <percent>` | double the acceptable rate | The rise worth an alarm |
| `--false-alarm-every <records>` | 2000 | On average at most one false alarm per this many records checked, at the acceptable rate, for periods of the median size so far (or `--period-size`) |
| `--period-size <records>` | the median so far | The period size the alarm level is set for, the same for every row. Without it, each row uses the median of the periods up to it, so a printed status never changes later |
| `--since <period>` | the first period | Restart the alarm at this period, after an alarm was looked into and fixed. The bound keeps counting every period ([why](METRICS.md#is-it-shown-under-the-target-valid-however-often-you-look)) |
| `--fail-on-alarm` | off | Exit with code 3 when the alarm is raised, for a scheduled job |

Percentages are percentages: `--target 0.05` means 0.05%, not 5%; the report warns when a
value of 0.5 or less may have been meant as a fraction (trap L16). **Set `--acceptable` to the rate measured before launch** (score on
a golden set, or the first weeks checked): the alarm watches for a rise from it and dates the rise
by it. Left at half the target, a workflow that normally runs above that is flagged at once and
its rise dated too early; the report then suggests a value (trap L18). At least one of `--target` and `--acceptable` is needed. The acceptable rate is half the target unless given; the alarming rate is double the acceptable rate unless given, and must be under 100%. The target must be above the acceptable
rate, and the alarming rate above the acceptable rate too (trap L4). Why these defaults:
[METRICS.md](METRICS.md#live-samples-over-time-wfeval-monitor).

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

## Agreement among graders (`wfeval agree`)

`wfeval agree` needs no settings of its own. Each grader's answer key is a key file in the
config's usual key format (JSON, JSON Lines or CSV, `input.key`, `key_field`, `equivalents`,
`any_of` slots: all read exactly as `score` reads a key), so it takes the same config:

```
wfeval agree --config config.json --keys ann.json ben.json cai.json
wfeval agree --config config.json --keys key-1.json key-2.json --names Ann,Ben --output verdict --output route
wfeval agree --grades grades-A.json grades-B.json grades-C.json
```

| Option | Default | Meaning |
|---|---|---|
| `--keys <file> <file> ...` | - | Two or more answer keys for the same records, one per grader. |
| `--grades <file> <file> ...` | - | Or two or more grades files from the grading page; no `--config`. |
| `--names a,b,c` | file names (grades: the reviewer's name in the file) | One name per file, in order. |
| `--output <name>` | every output, and `route` when `routing.gold_field` is set | Compare only these (repeatable). For keys in which not every grader labelled every output. |
| `--resamples <n>` | 2000 | Resamples for the likely range (100 to 100,000). |
| `--seed <n>` | 1 | The resampling seed: the same seed and files always give the same range. |
| `--write-key <file>` | - | Keys only, every output (not with `--output`: a partial key is one the config refuses): also write a majority answer key the config reads back, JSON or JSON Lines by the same rule the loader uses (`input.key.format`, else the extension; CSV is refused), each output under its `key_field`, the route under `routing.gold_field`, inside `input.key.unwrap` / `records_at` if set. Per record and output, the value most graders gave, compared as agree compares them (the route by class, written as the name most of them used). A set is decided value by value: a value is in it when more than half of the graders who labelled the record list it. A majority set that is no grader's own set (empty though each said something, or a mix of theirs) is left for a person. A duplicate whose primary record was left out is left out too. The other fields scoring reads from the key (`trap_field`, the `groups` and `clusters` read from the key, `duplicate_of_field`) are carried over by the same majority; a field the graders split on is left off that record and listed, loudly, since per-trap and per-group tables would put the record in "(none)". A record with a tie on any output (a set value listed by exactly half the graders included), or labelled by one grader, is left out and listed: `score` stops on a prediction whose record has no answer (trap B4), so settle those records and add them, or score the others only. |
| `--lenient`, `--json <file>` | - | As for `score`. |

A label output is compared as names, an ordinal on its `labels` order, a set as sets, and the
route as the class `routing.map` gives the gold route. `allowed_values` is checked on set values
(trap M8). Graders need not label the same records: a record only one grader labelled is left out
and listed. What each number means: [METRICS.md](METRICS.md#agreement-among-graders).
