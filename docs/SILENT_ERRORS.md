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

**Declining is not a route class.** A route says who sees a record; a decline says what the
model answered (nothing). The two vary independently: one workflow leaves declined records
out (the competitor registry: block), another sends them to a person (review), a third
publishes them with the field empty (auto). A fifth class would tie the two together and get
two of those three wrong. So a decline is an outcome of a label output
(`outputs.<name>.decline`, [CONFIG.md](CONFIG.md)), and the route types below apply to it as
to any record. See [Declines](#declines).

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
| SP-SHOULD-DECLINE | **Answered where it should have declined**: the answer key says no label fits | Label with `decline`: an answer, where the key holds a decline value | high |
| SP-MISSING-REJECTED | **Correct value thrown away**: proposed, but not applied (the floor dropped it) | Key value present in predictions with `applied: false` | medium |
| SP-MISSING | **Correct value never proposed** | Key value absent from predictions | medium |
| SP-DECLINED | **Went out declined**: no answer, but the answer key has one | Label with `decline`: declined, where the key has a label | medium |
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
| SO-DECLINED | **Declined and left out**: the answer key has an answer | Workflow route class block, a label declined where the key has a label, and the key's route (if any) does not say block. Takes the place of SO-FALSE-BLOCK: the decline is why it was left out | medium |

SO-DECLINED is the one omission type that needs no correct route: the key's answer alone
says something was lost. Without a correct route, the silent omission rate counts SO-DECLINED
out of the records whose answer key has an answer for a declining output, and every other
omission type is "not measured".

A record that went in and never came out at all is not measured here. It stops the
run (TRAPS.md, B5), because it is a workflow bug to fix, not a rate to report.

## What "duplicate" means

A duplicate is a record that repeats one already kept, not necessarily an identical copy.
In a news workflow it is the same event retold by another outlet; the workflow keeps the
primary source so one event does not look like many. The answer key marks a duplicate with
`duplicate_of`, pointing at the primary record's id.

## Declines

Some workflows may decline to answer: the competitor registry builder classifies each link on
a competitor's homepage into a page category, or declines, and leaves declined links out of
the registry on purpose, because the watch workflow downstream reads the registry as fact. A
decline is never counted as a wrong label, and never dropped (see [METRICS.md](METRICS.md#declines)).
Three questions, settled:

**Is a wrong category written to the registry a silent error?** Yes, SP-WRONG, high. It went
out with nobody reviewing it, and it is wrong information that the next workflow treats as
fact: exactly the definition. Not critical: critical is kept for a broken safeguard or
something that must never go out, and this is the ordinary "wrong value went out".

**An answer where the answer key says to decline** (an "About us" page written as `awards`)
is SP-SHOULD-DECLINE, high: it is a wrong category too, because no category fits. It has
its own code because its fix differs: SP-WRONG is the model confusing two categories (fixed
by sharper category definitions); SP-SHOULD-DECLINE is the model answering when it should
abstain (fixed by a stricter "skip if nothing clearly matches", or a higher threshold). The
same reason MISSING and MISSING-REJECTED are split.

**What severity is an unnecessary decline?** Medium. When the declined record is left out
unseen it is SO-DECLINED, a silent omission; when it goes out with the field empty, SP-DECLINED,
a silent publish. Both are "something incomplete": a page the watch workflow will not watch,
not a false fact it will report. That keeps the workflow's own design visible in the numbers:
the costly mistake (a wrong category, high) outranks the cheaper one (a decline, medium). It
is not low, because low is for noise in counts, and a missed case-results page is a real gap.
A workflow where a missing answer costs more can raise it with `severity`.

A decline sent to a person is neither: a person saw it. If the key has an answer, the review
was needed; if the key says decline, it was an unnecessary review.

If the answer key also has a correct route and maps "left out" to block, an answer where the
key says to decline is also SP-FORBIDDEN ("should have been blocked"), critical. That is the
right reading when the route means "must never go out". For a registry, the key's decline
values already say everything, so the example config (`examples/competitor-registry/`) has no
correct route.

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
