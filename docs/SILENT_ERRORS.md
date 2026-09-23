# Silent errors: types and severity

A **silent error** is a mistake no human saw before it had an effect. The overall
rate says how often that happens; the types below say what kind, and the severity
says how much it matters. Everything else the workflow gets wrong was caught by a
human or by a guard, so it cost time, not trust.

There are two families:

- **Silent publishes**: something went through that should not have, or not in that form.
- **Silent omissions**: something that should have gone through or reached a human never did, and nobody was told.

A record can have several types at once (it can carry a wrong value *and* be missing
a correct one). The headline rate counts **records**; the breakdown counts **types**,
so its rows can add up to more than the record count. A record's severity is its worst type.

## Route classes

Every workflow's decisions are mapped (in its config) onto four classes:

| Class | What happens | Human sees it? |
|---|---|---|
| auto | goes straight through | no |
| review | the middle band: elevated to a person to decide | **yes** |
| block | an obvious no: never processed further | no |
| exclude | a duplicate of a record already kept | no |

## Severity levels

| Level | Meaning |
|---|---|
| **critical** | A safeguard that should make this impossible failed, or something that must never go through went through. Investigate before the next run. |
| **high** | Wrong information went through, or a real record was lost. |
| **medium** | Something incomplete, or the wrong copy of a record, went through. |
| **low** | Noise: the content is right but distorts counts or emphasis. |

These are defaults. Every type's severity can be changed in the config, because what
counts as serious differs between workflows.

## Family 1: silent publishes

The record went through (route class auto), and the answer key says that was wrong.

| Code | Type | How the tool detects it | Default severity |
|---|---|---|---|
| SP-GATE | **Gate bypassed**: went through although a gated output's lead confidence is below its threshold | Recompute the gate from the applied values and the config thresholds | critical |
| SP-FLOOR | **Below-floor value applied**: a value under the floor was applied and went through | Applied value with confidence < floor | critical |
| SP-FORBIDDEN | **Should have been blocked**: the key says block, the workflow let it through | Key route class is block | critical |
| SP-VERDICT | **Dangerous label**: a label output says a "safe" label where the key has a "blocked" one | Label outputs; the config lists which labels are safe and which are blocked | critical |
| SP-INVALID | **Value outside the allowed list**: an applied value that is not in the list of allowed values | Needs an allowed-values file; "not measured" without one | critical |
| SP-WRONG | **Wrong value**: an applied value that is not in the key | Applied value not in key | high |
| SP-MISSING-REJECTED | **Correct value thrown away**: a key value the model proposed but the floor rejected | Key value present in predictions with `applied: false` | medium |
| SP-MISSING | **Correct value never proposed**: a key value the model never suggested | Key value absent from predictions | medium |
| SP-SHOULD-REVIEW | **Should have gone to a human**: the key says review, and no type above explains why | Key route class is review and no other SP type applies | medium |
| SP-WRONG-PRIMARY | **Wrong copy kept**: a duplicate went through while the primary record it duplicates was suppressed | Needs `duplicate_of` in the key | medium |
| SP-DUPLICATE | **Duplicate went through**: a record the key marks as a duplicate of another also went through | Key route class is exclude | low |

Splitting the two missing-value types matters for tuning: **MISSING-REJECTED** is the
floor's cost (the model knew; the guard dropped it), so a lower floor would fix it.
**MISSING** is the model's blind spot, and no threshold fixes it.

## Family 2: silent omissions

The workflow routed the record where **no human sees it** (block or exclude), and the
key says it should have gone through or been reviewed.

| Code | Type | How the tool detects it | Default severity |
|---|---|---|---|
| SO-FALSE-DUPLICATE | **Real record suppressed as a duplicate**: the key says it is not a duplicate | Workflow route class exclude; key does not mark it as a duplicate | high |
| SO-PRIMARY-SUPPRESSED | **Primary suppressed**: the key marks this as the primary, the workflow kept a duplicate instead | Needs `duplicate_of` in the key | medium |
| SO-FALSE-BLOCK | **Good record blocked**: never processed, but the key says it should go through or be reviewed | Workflow route class block; key route class auto or review | medium |

A record that went in and never came out at all is not measured here. It stops the
run (TRAPS.md, B5), because it is a workflow bug to fix, not a rate to report.

## What "duplicate" means

A duplicate is a record that repeats one already kept, not necessarily an identical copy.
In a news workflow it is the same event retold by another outlet; the workflow keeps the
primary source so one event does not look like many. The key marks a duplicate with
`duplicate_of`, pointing at the primary record's id.

## How the types show up in different workflows

| Type | Tagging (metadata enrichment) | Compliance review (bar compliance) |
|---|---|---|
| SP-MISSING | a subject code the model never suggested | **a violation the review missed, on copy that went live**: the expensive failure |
| SP-WRONG | an extra wrong code | a violation flagged that is not there (only silent if the copy still went through) |
| SP-VERDICT | n/a | "pass" on copy the key says must fail |
| SO-FALSE-BLOCK | n/a | good copy auto-denied, never shown to an analyst |
| SP-DUPLICATE | a retelling of a story already kept | n/a |

## What the config will need

```json
"duplicate_of_field": "duplicate_of",
"labels_safe": ["pass"],
"labels_blocked": ["fail"],
"allowed_values": "allowed.json",
"severity": { "SP-DUPLICATE": "medium" }
```

All optional. A type whose data is missing is reported as "not measured", never as zero.
