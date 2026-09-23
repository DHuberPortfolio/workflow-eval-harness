# Silent errors: types and severity

A **silent error** is a mistake no human saw before it had an effect. The overall
rate says how often that happens; the types below say what kind, and the severity
says how much it matters. Everything else the workflow gets wrong was caught by a
human or by the guard, so it cost time, not trust.

There are two families:

- **Silent publishes**: something reached readers that should not have, or not in that form.
- **Silent omissions**: something that should have reached readers or a human never did, and nobody was told.

A record can have several types at once (a published record can carry a wrong
code *and* be missing a correct one). The headline rate counts **records**; the
breakdown counts **types**, so its rows can add up to more than the record count.
A record's severity is its worst type.

## Severity levels

| Level | Meaning |
|---|---|
| **critical** | A safeguard that should make this impossible failed, or content that must never go out went out. Investigate before the next run. |
| **high** | Wrong information reached readers, or a real story was lost. |
| **medium** | Readers got something incomplete or from the wrong source; the story itself is right. |
| **low** | Noise: the content is right but distorts counts or emphasis. |

These are defaults. Every type's severity can be changed in the config, because
what counts as serious differs between workflows (a wrong verdict in bar compliance
is a legal risk; a wrong subject code is not).

## Family 1: silent publishes

The workflow auto-published the record, and the answer key says that was wrong.

| Code | Type | How the tool detects it | Default severity |
|---|---|---|---|
| SP-GATE | **Gate bypass**: auto-published although a gated facet's lead value is below its threshold | Recompute the gate from the applied values and config thresholds | critical |
| SP-FLOOR | **Below-floor value applied**: a value under the floor (e.g. 0.60) was applied and published | Applied value with confidence < floor | critical |
| SP-FORBIDDEN | **Forbidden content published**: the key says block, the workflow auto-published | Gold route class is block | critical |
| SP-VERDICT | **Dangerous verdict**: a label output said pass when the key says fail | Label outputs: predicted is a "safe" label, key is a "blocked" label (the config says which labels are which) | critical |
| SP-HALLUCINATED | **Invented code**: an applied code that is not in the controlled vocabulary | Needs the vocabulary file; skipped if none is given | critical |
| SP-WRONG | **Wrong value published**: an applied code that is not in the key | Applied value not in key set | high |
| SP-MISSING-REJECTED | **Correct value thrown away**: a key code the model proposed but the floor rejected (the A24 case) | Key value present in predictions with `applied: false` | medium |
| SP-MISSING | **Correct value never proposed**: a key code the model never suggested | Key value absent from predictions entirely | medium |
| SP-SHOULD-REVIEW | **Should have gone to a human**: the key says review, and none of the types above explains why | Gold route class is review and no other SP type applies | medium |
| SP-WRONG-SOURCE | **Wrong source published**: a retelling was published while the main source for the same story was suppressed | Needs `duplicate_of` in the key | medium |
| SP-DUPLICATE | **Retelling published**: a record the key marks as a retelling of another story was published as well | Gold route class is exclude, workflow route is auto | low |

Splitting the two missing-value types matters for tuning: **MISSING-REJECTED** is the
floor's cost (the model knew; the guard dropped it), so lowering the floor would fix
it. **MISSING** is the model's blind spot, and no threshold will fix it.

## Family 2: silent omissions

The workflow routed the record somewhere **no human sees**, and the answer key says
it should have been published or reviewed. Which routes count as "no human sees" is
set in the config: suppressed duplicates always do; a block might (a full deny) or
might not (a hand-off to an agent or an analyst).

| Code | Type | How the tool detects it | Default severity |
|---|---|---|---|
| SO-FALSE-DUPLICATE | **Real story suppressed**: suppressed as a retelling, but the key says it is its own story | Workflow route exclude; key does not mark it as a retelling | high |
| SO-MAIN-SOURCE | **Main source suppressed**: the key marks this as the main source, the workflow kept a retelling instead | Needs `duplicate_of` in the key | medium |
| SO-FALSE-BLOCK | **Good record denied**: blocked with no human, but the key says publish or review | Workflow route block (unseen); key route auto or review | medium |

A record that went in and never came out at all is not measured here. It stops
the run (see TRAPS.md, B5), because it is a workflow bug to fix, not a rate to report.

## What the config will need

```json
"routing": {
  "unseen": ["DUPLICATE_SUPPRESSED", "DENY"]
},
"duplicate_of_field": "duplicate_of",
"labels_safe": ["pass"],
"labels_blocked": ["fail"],
"vocabulary": "vocab.json",
"severity": { "SP-DUPLICATE": "medium" }
```

All optional. A type whose data is missing (no vocabulary, no `duplicate_of`) is
reported as "not measured", never as zero.
