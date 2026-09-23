# Compliance fixture: hand-worked answers

Nine pieces of marketing copy reviewed against advertising rules. Shaped like a
compliance reviewer: one **label** output (`verdict`: pass / elevate / fail) that is
also the route, plus a **set** output (`violations`: the rule codes found).
Written as spreadsheets (`predictions.csv`, `key.csv`) to exercise the CSV path.

Every number was worked out by hand before any metric code existed.

## The records

| id | verdict (conf) | violations applied | rejected | key verdict | key violations | trap | what it tests |
|---|---|---|---|---|---|---|---|
| D1 | pass (0.95) | - | - | pass | - | clean-copy | correct pass |
| D2 | pass (0.90) | - | - | **fail** | GUARANTEE | implied-guarantee | **silent error, critical**: copy that must be blocked went live; the violation was never even proposed |
| D3 | fail (0.92) | SUPERLATIVE 0.93 | - | fail | SUPERLATIVE | superlative | correct block |
| D4 | elevate (0.70) | COMPARISON 0.72 | - | elevate | COMPARISON | unqualified-comparison | justified review |
| D5 | elevate (0.80) | COMPARISON 0.62 | - | pass | - | clean-copy | wasted review, caused by a false flag |
| D6 | fail (0.88) | TESTIMONIAL 0.65 | - | **elevate** | TESTIMONIAL | borderline-testimonial | **silent omission**: needed an analyst, was shut down automatically |
| D7 | pass (0.86) | - | TESTIMONIAL 0.55 | **elevate** | TESTIMONIAL | weak-testimonial | **silent error, medium**: the model proposed the violation, the 0.60 floor dropped it |
| D8 | pass (**0.80**) | - | - | pass | - | clean-copy | **safeguard failure**: went through below the 0.85 gate. The content happens to be right |
| D9 | elevate (none) | - | - | fail | GUARANTEE | implied-guarantee | the model call failed (`scored` = false): counts in routing, not in quality |

Route classes (config: pass → auto, elevate → review, fail → block):

| | auto | review | block | exclude | total |
|---|---|---|---|---|---|
| routed | D1 D2 D7 D8 (4) | D4 D5 D9 (3) | D3 D6 (2) | 0 | 9 |
| should be | D1 D5 D8 (3) | D4 D6 D7 (3) | D2 D3 D9 (3) | 0 | 9 |

## Why `wrong_when` is `gold_route` here

In a compliance workflow the violation codes are the *reasons* for a verdict, not
content that is published. D5 went to review because of a false COMPARISON flag; the
copy itself is clean and the key says pass, so a human looking at it changed nothing.
With `gold_route`, only the key's verdict decides whether a record needed a human. (With
`either`, D5's false flag would count as "needed a human" and hide the wasted review.)

## Routing

- **Straight-through** = auto / all = 4/9 = **44.4%**
- **Silent error rate** = auto-published records that should not have gone through / auto =
  D2 (key: fail) and D7 (key: elevate) of {D1, D2, D7, D8} = 2/4 = **50.0%** (range 15.0–85.0%)
  - D2: **SP-FORBIDDEN** (critical) and SP-MISSING (GUARANTEE never proposed) → critical
  - D7: **SP-SHOULD-REVIEW** and SP-MISSING-REJECTED (TESTIMONIAL proposed at 0.55, below the floor) → medium
  - D1 and D8 are correct content.
- **Safeguard failures** = D8: **SG-GATE** (verdict confidence 0.80 < gate 0.85, went through anyway). Counted
  separately from the silent error rate, because no wrong content went out, but it is still critical: the
  check that should have held the record did not.
- **Silent omissions** = records blocked or suppressed that the key says should go through or be reviewed /
  records the key says should go through or be reviewed = D6 of {D1, D4, D5, D6, D7, D8} = 1/6 = **16.7%**
  - D6: **SO-FALSE-BLOCK** (medium)
- **Review-queue precision** = reviewed records whose key verdict is not pass / reviewed =
  D4 (elevate) and D9 (fail) of {D4, D5, D9} = 2/3 = **66.7%**. D5 is the wasted review.
- **Block precision** = blocked records the key also says to block / blocked = D3 of {D3, D6} = 1/2 = **50.0%**

## Output quality

Population: D1-D8. D9 is excluded: its model call failed, so it has no output to judge.

**violations** (set; only applied values count, so D7's rejected TESTIMONIAL is a miss)

| id | applied | key | TP | FP | FN |
|---|---|---|---|---|---|
| D1 | - | - | 0 | 0 | 0 |
| D2 | - | GUARANTEE | 0 | 0 | 1 |
| D3 | SUPERLATIVE | SUPERLATIVE | 1 | 0 | 0 |
| D4 | COMPARISON | COMPARISON | 1 | 0 | 0 |
| D5 | COMPARISON | - | 0 | 1 | 0 |
| D6 | TESTIMONIAL | TESTIMONIAL | 1 | 0 | 0 |
| D7 | (TESTIMONIAL rejected) | TESTIMONIAL | 0 | 0 | 1 |
| D8 | - | - | 0 | 0 | 0 |
| | | **total** | **3** | **1** | **2** |

precision = 3/4 = **75.0%** · recall = 3/5 = **60.0%** · F1 = 2·3 / (2·3 + 1 + 2) = 6/9 = **0.667**
Exact match (applied set equals key set): D1 D3 D4 D6 D8 = 5/8 = **62.5%**

**verdict** (label)

| | predicted pass | predicted elevate | predicted fail |
|---|---|---|---|
| **key pass** | D1 D8 (2) | D5 (1) | - |
| **key elevate** | D7 (1) | D4 (1) | D6 (1) |
| **key fail** | D2 (1) | - | D3 (1) |

Accuracy = D1 D3 D4 D8 = 4/8 = **50.0%**

| label | precision | recall | F1 |
|---|---|---|---|
| pass | 2/4 = 50.0% | 2/3 = 66.7% | 2·2/(2·2+2+1) = 4/7 = 0.571 |
| elevate | 1/2 = 50.0% | 1/3 = 33.3% | 2/(2+1+2) = 2/5 = 0.400 |
| fail | 1/2 = 50.0% | 1/2 = 50.0% | 2/(2+1+1) = 0.500 |

**Overall** pools set outputs only (a label is reported by its accuracy): same as violations,
TP 3 · FP 1 · FN 2 → 75.0% / 60.0% / 0.667.

## Per trap

| trap | records | routed correctly | silent errors | silent omissions | wasted reviews |
|---|---|---|---|---|---|
| borderline-testimonial | D6 | 0/1 | 0 | 1 | 0 |
| clean-copy | D1 D5 D8 | 2/3 | 0 | 0 | 1 (D5) |
| implied-guarantee | D2 D9 | 0/2 | 1 (D2) | 0 | 0 |
| superlative | D3 | 1/1 | 0 | 0 | 0 |
| unqualified-comparison | D4 | 1/1 | 0 | 0 | 0 |
| weak-testimonial | D7 | 0/1 | 1 (D7) | 0 | 0 |
| **total** | **9** | **4/9** | **2** | **1** | **1** |

The overall silent error rate cannot say that both silent errors came from implied or
weak violations, the kinds keyword matching misses; this table can. "clean-copy" routes
correctly 2 times in 3, yet D8 got there only because the gate failed.
