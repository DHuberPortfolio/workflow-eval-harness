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

## What decides that a record needed a human (`wrong_when`)

| Setting | A record needed a human when | Use it when |
|---|---|---|
| `either` (default with a gold route) | the key's route says so, **or** its values are wrong | the outputs are what gets published (tags): a wrong tag is itself an error |
| `gold_route` | the key's route says so | the outputs are *reasons*, not published content (a compliance reviewer's violation codes) |
| `any_mismatch` (default without one) | its values are wrong | the key has no correct route |

A record that went through and needed a human is a silent error. All the types that
apply are listed for it, including ones from the evidence `wrong_when` does not count,
because they explain it: "should have gone to a human" (SP-SHOULD-REVIEW) *because* "the
floor dropped the correct value" (SP-MISSING-REJECTED).

## Family 1: silent publishes

The record went through (route class auto), and it needed a human.

**Route types** (need a correct route in the key):

| Code | Type | How the tool detects it | Default severity |
|---|---|---|---|
| SP-FORBIDDEN | **Should have been blocked** | Key route class is block | critical |
| SP-SHOULD-REVIEW | **Should have gone to a human** | Key route class is review | medium |
| SP-WRONG-PRIMARY | **Wrong copy kept**: a duplicate went through while its primary was suppressed | Needs `duplicate_of_field` | medium |
| SP-DUPLICATE | **Duplicate went through** | Key route class is exclude | low |

**Value types** (compare the outputs with the key):

| Code | Type | How the tool detects it | Default severity |
|---|---|---|---|
| SP-INVALID | **Value outside the allowed list** | Applied value not in `allowed_values`; "not measured" without one | critical |
| SP-WRONG | **Wrong value** | Applied value not in the key | high |
| SP-MISSING-REJECTED | **Correct value thrown away**: proposed, but not applied (the floor dropped it) | Key value present in predictions with `applied: false` | medium |
| SP-MISSING | **Correct value never proposed** | Key value absent from predictions | medium |
| SP-NEAR-MISS | **Near miss on an ordered scale**: off by no more than `near_miss_steps` (a 4 for a 5) | Ordinal outputs | low |

An output that is also the route (a verdict label read from `routing.field`) is judged by
the route types only: a wrong verdict *is* the routing error, and counting it again as a
wrong value would count one mistake twice. A wrong label on any other output is SP-WRONG.

## Safeguard failures

Not silent errors, and not in the silent error rate, but reported beside it at critical
severity: a record went through although one of the workflow's own safeguards should have
held it. The content may happen to be right; the process is still broken, and the next
record through the same hole may not be so lucky.

Every safeguard failure is a bug to find and fix:
1. Find the branch that routed the record and why it skipped the check (a path around the
   gate, a threshold read from the wrong place, a confidence parsed as text).
2. If the key says the record *should* go through, the fix is not a lower threshold: it is a
   model (prompt, examples) that states enough confidence on correct records while staying
   right on everything else. `wfeval compare --noise` tells whether a change actually did that.

| Code | Type | How the tool detects it |
|---|---|---|
| SG-GATE | **Went through below the confidence gate** | Recompute the gate from the applied values and `thresholds.auto_publish` (the lead value, or the weakest with `gate_uses: weakest`). A gated output with nothing applied fails the gate |
| SG-FLOOR | **A value under the floor was applied** | Applied value with confidence < `thresholds.floor` |

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
| SP-FORBIDDEN | n/a (nothing is blocked) | **"pass" on copy the key says must fail**: the expensive failure |
| SP-MISSING | a subject code the model never suggested | the violation behind a wrong pass, never even proposed |
| SP-WRONG | an extra wrong code | n/a with `wrong_when: gold_route` (a false flag on copy that goes live changes nothing) |
| SO-FALSE-BLOCK | n/a | good copy auto-denied, never shown to an analyst |
| SP-DUPLICATE | a retelling of a story already kept | n/a |

## Config

```json
"wrong_when": "gold_route",
"duplicate_of_field": "duplicate_of",
"allowed_values": { "SUBJECT": { "file": "vocab.json", "field": "code" } },
"severity": { "SP-DUPLICATE": "medium" }
```

All optional. A type whose data is missing is reported as "not measured", never as zero.
