# Tiny fixture: hand-worked answers

Six records, each built to exercise one case. Every number below was worked out
on paper before any metric code existed. The tests assert these values; if code
and this file disagree, find out which one is wrong before changing either.

| id | route (predicted) | expected route | what it tests |
|----|---|---|---|
| R1 | AUTO_PUBLISH | AUTO_PUBLISH | correct auto-publish |
| R2 | AUTO_PUBLISH | EDITOR_REVIEW | **silent error**: extra code SUBJ-ANTI published unseen |
| R3 | EDITOR_REVIEW | EDITOR_REVIEW | justified review: missed GEO-EU, a human catches it |
| R4 | EDITOR_REVIEW | AUTO_PUBLISH | unnecessary review: everything correct, a human looked anyway |
| R5 | BLOCKED | BLOCKED | correct block: its only SUBJECT tag (correct, 0.55) fell below the floor |
| R6 | DUPLICATE_SUPPRESSED | DUPLICATE_SUPPRESSED | excluded: counts in the intake total only |

## Output quality (precision / recall / F1)

Scored over R1-R5. R6 is excluded, so its codes are not counted.
Only applied values count. R5's SUBJ-LAB (0.55, `"applied": false`) was rejected
by the floor, so for precision and recall it was never predicted. It is a false
negative, even though the model proposed it. That is the recall the floor costs.
A code is a true positive (TP) if predicted and in the key, a false positive (FP)
if predicted but not in the key, a false negative (FN) if in the key but not predicted.

**SUBJECT**

| id | predicted | key | TP | FP | FN |
|----|---|---|---|---|---|
| R1 | MNA | MNA | 1 | 0 | 0 |
| R2 | MNA, ANTI | MNA | 1 | 1 | 0 |
| R3 | EARN | EARN | 1 | 0 | 0 |
| R4 | EARN | EARN | 1 | 0 | 0 |
| R5 | (LAB rejected at 0.55) | LAB | 0 | 0 | 1 |
| | | **total** | **4** | **1** | **1** |

precision = 4 / (4+1) = **0.800** · recall = 4 / (4+1) = **0.800** · F1 = **0.800**

**GEOGRAPHY**

| id | predicted | key | TP | FP | FN |
|----|---|---|---|---|---|
| R1 | US | US | 1 | 0 | 0 |
| R2 | US | US | 1 | 0 | 0 |
| R3 | UK | UK, EU | 1 | 0 | 1 |
| R4 | US | US | 1 | 0 | 0 |
| R5 | EU | EU | 1 | 0 | 0 |
| | | **total** | **5** | **0** | **1** |

precision = 5 / 5 = **1.000** · recall = 5 / 6 = **0.833** · F1 = 2·1·0.8333 / 1.8333 = **0.909**

**Overall (micro-averaged: pool all codes, then divide)**

TP 9 · FP 1 · FN 2 → precision = 9/10 = **0.900** · recall = 9/11 = **0.818** · F1 = 18/21 = **0.857**

(Shortcut used as a cross-check: F1 = 2TP / (2TP + FP + FN).)

## Routing (denominator = all 6 records, duplicates included)

| class | records | count |
|---|---|---|
| auto | R1, R2 | 2 |
| review | R3, R4 | 2 |
| block | R5 | 1 |
| exclude | R6 | 1 |

The config sets no `wrong_when`, and the key has correct routes, so the default is
`either`: a record needed a human if the key's route says so **or** its values are wrong.
(In a tagging workflow the tags are what gets published, so a wrong tag is itself an error.)

- **Straight-through rate** = auto / total = 2/6 = **33.3%**
- **Silent error rate** = auto-published records that needed a human / auto = R2 / {R1, R2} = 1/2 = **50.0%**
  - R2: **SP-WRONG** (SUBJ-ANTI applied, not in the key; high) and **SP-SHOULD-REVIEW** (key says review; medium) → high
- **Safeguard failures** = none. R1 and R2 both lead SUBJECT at or above 0.85 (0.95, 0.90), and no applied value is under the 0.60 floor.
- **Silent omissions** = blocked or suppressed, but the key says auto or review / key says auto or review =
  none of {R1, R2, R3, R4} = 0/4 = **0.0%**. (R5 should be blocked; R6 should be suppressed.)
- **Review-queue precision** = reviewed records that needed a human / reviewed = R3 / {R3, R4} = 1/2 = **50.0%**
- **Block precision** = blocked records the key also says to block / blocked = R5 / {R5} = 1/1 = **100.0%**

## Per-trap results (trap_field: trap)

"Routed correctly" means the predicted route class matches the key's expected route class.
R1 has no trap on purpose: records without a trap label must be grouped under
"(none)", not dropped. Dropping them would make the totals below stop adding up to 6.

| trap | records | routed correctly | silent errors | silent omissions | wasted reviews |
|---|---|---|---|---|---|
| (none) | R1 | 1/1 | 0 | 0 | 0 |
| correct-but-unsure | R4, R5 | 1/2 | 0 | 0 | 1 (R4) |
| missing-secondary-geo | R3 | 1/1 | 0 | 0 | 0 |
| near-duplicate | R6 | 1/1 | 0 | 0 | 0 |
| plausible-extra-tag | R2 | 0/1 | 1 (R2) | 0 | 0 |
| **total** | **6** | **4/6** | **1** | **0** | **1** |

Reading it: the workflow handled "correct-but-unsure" safely (no silent error), but at a cost:
it held back R4, which was fine. "plausible-extra-tag" is the trap that got through.
The overall silent error rate (1/2) cannot tell you which trap caused it; this table can.

## Calibration

Does a stated confidence mean what it says? Every value the model proposed with a
confidence counts, applied or not (R5's rejected SUBJ-LAB is a claim too), from R1-R5.
A value is correct if it is in the key. The model used 9 distinct confidence values, so
each gets its own bucket.

| stated | values | correct | accuracy | gap (accuracy - stated) |
|---|---|---|---|---|
| 0.55 | R5 SUBJ-LAB | 1/1 | 100% | +0.45 |
| 0.65 | R3 GEO-UK | 1/1 | 100% | +0.35 |
| 0.70 | R3 SUBJ-EARN, R5 GEO-EU | 2/2 | 100% | +0.30 |
| 0.75 | R4 GEO-US | 1/1 | 100% | +0.25 |
| 0.80 | R4 SUBJ-EARN | 1/1 | 100% | +0.20 |
| 0.88 | R2 SUBJ-ANTI | 0/1 | 0% | -0.88 |
| 0.90 | R1 GEO-US, R2 SUBJ-MNA | 2/2 | 100% | +0.10 |
| 0.92 | R2 GEO-US | 1/1 | 100% | +0.08 |
| 0.95 | R1 SUBJ-MNA | 1/1 | 100% | +0.05 |
| **all** | 11 | **10/11** | 90.9% | |

**Average calibration gap** (expected calibration error): the size of each gap, weighted
by how many values are in the bucket = (0.45 + 0.35 + 2×0.30 + 0.25 + 0.20 + 0.88 + 2×0.10 + 0.08 + 0.05) / 11
= 3.06 / 11 = **0.278**. Mostly under-confidence (right more often than stated), with one
confident miss. At 11 values this says nothing reliable; it is here to test the arithmetic.

## Auto-publish gate (SUBJECT only, gate_uses: lead)

The gate compares each gated facet's strongest *applied* value to its threshold (0.85).
GEOGRAPHY is not listed under `auto_publish`, so it never gates.

| id | SUBJECT lead | passes 0.85? | actual route |
|----|---|---|---|
| R1 | 0.95 | yes | AUTO_PUBLISH |
| R2 | 0.90 (weakest is 0.88) | yes | AUTO_PUBLISH |
| R3 | 0.70 | no | EDITOR_REVIEW |
| R4 | 0.80 | no | EDITOR_REVIEW |
| R5 | none applied | no | BLOCKED |
| R6 | 0.99 | yes | DUPLICATE_SUPPRESSED (duplicate rule wins) |

Note R4: its lead of 0.80 misses the gate, yet the key says it was safe to auto-publish.

## What-if: the gate

The config has no `whatif.movable_field`, so every record that went through or was
reviewed (R1-R4) is assumed to have been routed by the gate alone: an upper bound on what
can move. R5 (blocked) and R6 (suppressed) never move.

SUBJECT leads: R1 0.95 · R2 0.90 · R3 0.70 · R4 0.80.

| SUBJECT gate | goes through | straight-through | silent errors | silent error rate |
|---|---|---|---|---|
| 0.50 - 0.70 | R1 R2 R3 R4 | 4/6 | R2 R3 | 2/4 |
| 0.75 - 0.80 | R1 R2 R4 | 3/6 | R2 | 1/3 |
| 0.85 (current) | R1 R2 | 2/6 | R2 | 1/2 |
| 0.90 | R1 R2 | 2/6 | R2 | 1/2 |
| 0.95 | R1 | 1/6 | - | 0/1 |
| 1.00 | - | 0/6 | - | none went through |

At 0.85 the simulation reproduces the actual routes of all four movable records, so the
assumption holds on this run. Lowering the gate to 0.80 lets R4 through correctly, and the
silent error rate falls from 1/2 to 1/3, but **not because an error was prevented**: R2
still goes through wrong. The rate falls because a correct record joined the denominator.
That is why the what-if shows the error count beside the rate.

## What-if: the floor

Current floor 0.60. A value rejected with a confidence below the current floor is assumed
to have been rejected by the floor, so a lower floor re-admits it. The gate is re-checked
for movable records whose values changed; a record whose values changed but that cannot
move (R5, blocked) is marked "needs replay": its route might change for reasons this tool
cannot recompute.

| floor | values changed | needs replay | overall TP/FP/FN | precision | recall | F1 | silent errors |
|---|---|---|---|---|---|---|---|
| 0.55 | + R5 SUBJ-LAB | R5 | 10/1/1 | 90.9% | 90.9% | 0.909 | R2 (1/2) |
| 0.60 (current) | - | - | 9/1/2 | 90.0% | 81.8% | 0.857 | R2 (1/2) |
| 0.70 | - R3 GEO-UK | - | 8/1/3 | 88.9% | 72.7% | 0.800 | R2 (1/2) |
| 0.90 | - R2 SUBJ-ANTI, - R3 all, - R4 all, - R5 GEO-EU | R5 | 4/0/7 | 100.0% | 36.4% | 0.533 | R2 (1/2) |

At 0.90 the wrong SUBJ-ANTI is gone and R2's values are all correct, yet R2 is still a
silent error: the key says it should have been reviewed. Above 0.80, R4 loses its only
subject (SUBJ-EARN, 0.80) and would fail the gate, but it was already reviewed, so no
route moves; the cost shows up as recall instead.
