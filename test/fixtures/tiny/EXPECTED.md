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

- **Straight-through rate** = auto / total = 2/6 = **33.3%**
- **Silent error rate** = auto-published but gold says not auto / auto = R2 / {R1, R2} = 1/2 = **50.0%**
- **Review-queue precision** = review where gold says not auto / review = R3 / {R3, R4} = 1/2 = **50.0%**
- **Block precision** = blocked where gold says not auto / blocked = R5 / {R5} = 1/1 = **100.0%**

## Per-trap results (trap_field: trap)

"Routed correctly" means the predicted route class matches the key's expected route class.
R1 has no trap on purpose: records without a trap label must be grouped under
"(none)", not dropped. Dropping them would make the totals below stop adding up to 6.

| trap | records | routed correctly | silent errors | wasted reviews |
|---|---|---|---|---|
| (none) | R1 | 1/1 | 0 | 0 |
| plausible-extra-tag | R2 | 0/1 | 1 (R2) | 0 |
| missing-secondary-geo | R3 | 1/1 | 0 | 0 |
| correct-but-unsure | R4, R5 | 1/2 | 0 | 1 (R4) |
| near-duplicate | R6 | 1/1 | 0 | 0 |
| **total** | **6** | **4/6** | **1** | **1** |

Reading it: the workflow handled "correct-but-unsure" safely (no silent error), but at a cost:
it held back R4, which was fine. "plausible-extra-tag" is the trap that got through.
The overall silent error rate (1/2) cannot tell you which trap caused it; this table can.

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

Kept for the what-if tests later. Note R4: its lead of 0.80 misses the gate, yet the
key says it was safe to auto-publish. Lowering SUBJECT's threshold to 0.80 would send
R4 through correctly and still let R2 (0.90) through wrongly: straight-through rises
to 3/6 while the silent error rate goes from 1/2 to 1/3, from one fewer
error-free record held back, not from one fewer error. That is the kind of trade-off the
what-if report must make visible. Lowering the floor to 0.55 would apply R5's SUBJ-LAB
and raise SUBJECT recall to 5/5.
