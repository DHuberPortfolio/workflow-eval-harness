# Silent errors: types and severity

A **silent error** is a mistake no person saw before it had an effect. The overall
rate says how often that happens; the types below say what kind, and the severity
says how much it matters. Everything else the workflow gets wrong was caught by a
person or by a guard, so it cost time, not trust.

Every report shows each code below with its meaning in plain words.

There are two families:

- **Silent publishes**: something went out without review that should not have, or not in that form.
- **Silent omissions**: something that should have gone out or reached a person never did, and nobody was told.

A record can have several types at once (it can carry a wrong value *and* be missing
a correct one). The headline rate counts **records**; the breakdown counts **types**,
so its rows can add up to more than the record count. A record's severity is its worst type.

## Route classes

Every workflow's decisions are mapped (in its config) onto four classes:

| Class | In the reports | What happens | A person sees it? |
|---|---|---|---|
| auto | went out without review | released as it is | no |
| review | sent to a person | the middle band: a person decides | **yes** |
| block | blocked | an obvious no: never processed further | no |
| exclude | suppressed as a duplicate | repeats a record already kept | no |

## Severity levels

| Level | Meaning |
|---|---|
| **critical** | A safeguard that should make this impossible failed, or something that must never go out went out. Investigate before the next run. |
| **high** | Wrong information went out, or a real record was lost. |
| **medium** | Something incomplete, or the wrong copy of a record, went out. |
| **low** | Noise: the content is right but distorts counts or emphasis. |

These are defaults. Every type's severity can be changed in the config, because what
counts as serious differs between workflows.

## What decides that a record needed a person (`wrong_when`)

| Setting | A record needed a person when | Use it when |
|---|---|---|
| `either` (default with a gold route) | the answer key's route says it should not go out without review, **or** its values are wrong | the outputs are what gets published (tags): a wrong tag is itself an error |
| `gold_route` | the answer key's route says it should not go out without review | the outputs are *reasons*, not published content (a compliance reviewer's violation codes) |
| `any_mismatch` (default without one) | its values are wrong | the answer key has no correct route |

A record that went out without review and needed a person is a silent error. All the types that
apply are listed for it, including ones from the evidence `wrong_when` does not count,
because they explain it: "should have gone to a person" (SP-SHOULD-REVIEW) *because* "the
floor dropped the correct value" (SP-MISSING-REJECTED).

## Family 1: silent publishes

The record went out without review (route class auto), and it needed a person.

**Route types** (need a correct route in the answer key):

| Code | Type | How the tool detects it | Default severity |
|---|---|---|---|
| SP-FORBIDDEN | **Should have been blocked** | Key route class is block | critical |
| SP-SHOULD-REVIEW | **Should have gone to a person** | Key route class is review | medium |
| SP-WRONG-PRIMARY | **Wrong copy kept**: a duplicate went out while its primary was suppressed | Needs `duplicate_of_field` | medium |
| SP-DUPLICATE | **Duplicate went out** | Key route class is exclude | low |

**Value types** (compare the outputs with the answer key):

| Code | Type | How the tool detects it | Default severity |
|---|---|---|---|
| SP-INVALID | **Value outside the allowed list** | Applied value not in `allowed_values`; "not measured" without one | critical |
| SP-WRONG | **Wrong value** | Applied value not in the answer key | high |
| SP-MISSING-REJECTED | **Correct value thrown away**: proposed, but not applied (the floor dropped it) | Key value present in predictions with `applied: false` | medium |
| SP-MISSING | **Correct value never proposed** | Key value absent from predictions | medium |
| SP-NEAR-MISS | **Near miss on an ordered scale**: off by no more than `near_miss_steps` (a 4 for a 5) | Ordinal outputs | low |

An output that is also the route (a verdict label read from `routing.field`) is judged by
the route types only: a wrong verdict *is* the routing error, and counting it again as a
wrong value would count one mistake twice. A wrong label on any other output is SP-WRONG.

## Safeguard failures

Not silent errors, and not in the silent error rate, but reported beside it at critical
severity: a record went out without review although one of the workflow's own safeguards should have
held it. The content may happen to be right; the process is still broken, and the next
record through the same hole may not be so lucky.

Every safeguard failure is a bug to find and fix:
1. Find the branch that routed the record and why it skipped the check (a path around the
   gate, a threshold read from the wrong place, a confidence parsed as text).
2. If the answer key says the record *should* go out, the fix is not a lower threshold: it is a
   model (prompt, examples) that states enough confidence on correct records while staying
   right on everything else. `wfeval compare --noise` tells whether a change actually did that.

| Code | Type | How the tool detects it |
|---|---|---|
| SG-GATE | **Went out below the confidence gate** | Recompute the gate from the applied values and `thresholds.auto_publish` (the lead value, or the weakest with `gate_uses: weakest`). A gated output with nothing applied fails the gate |
| SG-FLOOR | **A value under the floor was applied** | Applied value with confidence < `thresholds.floor` |

Splitting the two missing-value types matters for tuning: **MISSING-REJECTED** is the
floor's cost (the model knew; the guard dropped it), so a lower floor would fix it.
**MISSING** is the model's blind spot, and no threshold fixes it.

## Family 2: silent omissions

The workflow routed the record where **no person sees it** (block or exclude), and the
answer key says it should have gone out or to a person.

| Code | Type | How the tool detects it | Default severity |
|---|---|---|---|
| SO-FALSE-DUPLICATE | **Real record suppressed as a duplicate**: the answer key says it is not a duplicate | Workflow route class exclude; key does not mark it as a duplicate | high |
| SO-PRIMARY-SUPPRESSED | **Primary suppressed**: the answer key marks this as the primary, the workflow kept a duplicate instead | Needs `duplicate_of` in the key | medium |
| SO-FALSE-BLOCK | **Good record blocked**: never processed, but the answer key says it should go out or to a person | Workflow route class block; key route class auto or review | medium |

A record that went in and never came out at all is not measured here. It stops the
run (TRAPS.md, B5), because it is a workflow bug to fix, not a rate to report.

## What "duplicate" means

A duplicate is a record that repeats one already kept, not necessarily an identical copy.
In a news workflow it is the same event retold by another outlet; the workflow keeps the
primary source so one event does not look like many. The answer key marks a duplicate with
`duplicate_of`, pointing at the primary record's id.

## How the types show up in different workflows

| Type | Tagging (metadata enrichment) | Compliance review (bar compliance) |
|---|---|---|
| SP-FORBIDDEN | n/a (nothing is blocked) | **"pass" on copy the answer key says must fail**: the expensive failure |
| SP-MISSING | a subject code the model never suggested | the violation behind a wrong pass, never even proposed |
| SP-WRONG | an extra wrong code | n/a with `wrong_when: gold_route` (a false flag on copy that goes out without review changes nothing) |
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
