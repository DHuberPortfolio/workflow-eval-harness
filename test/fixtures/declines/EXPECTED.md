# Declines fixture: hand-worked answers

Ten internal links from competitor homepages, shaped like the competitor registry builder:
a model reads each link and either names its page category or declines. A named category is
written to the registry (`WRITTEN`, route class auto: nobody reviews it, and the watch
workflow reads the registry as fact). A declined link is left out (`LEFT_OUT`, route class
block: nobody sees it either). There is no review step.

The answer key gives each link's category, or `none`: no category fits, so declining is the
correct outcome. A prediction is declined when its category is `none` (`decline.values`), or
when `declined` is `true` (`decline.field`), whatever category it names beside it.

| id | went | predicted | key | outcome | what it tests |
|---|---|---|---|---|---|
| L1 | WRITTEN | case_results @0.9 | case_results | right answer | |
| L2 | WRITTEN | attorneys @0.9 | attorneys | right answer | |
| L3 | WRITTEN | news @0.7 | awards | **wrong category written** | SP-WRONG, high |
| L4 | LEFT_OUT | none | none | right decline | |
| L5 | LEFT_OUT | news @0.4, `declined: true` | news | **unnecessary decline** | SO-DECLINED, medium. The field form: the category it set aside is shown, never counted as an answer |
| L6 | WRITTEN | awards @0.6 | none | **answered, but the key says decline** | SP-SHOULD-DECLINE, high |
| L7 | WRITTEN | case_results @0.9 | case_results | right answer | |
| L8 | LEFT_OUT | none | news | **unnecessary decline** | SO-DECLINED, medium. The value form |
| L9 | LEFT_OUT | none | none | right decline | |
| L10 | WRITTEN | attorneys @0.9 | attorneys | right answer | |

Answered: L1 L2 L3 L6 L7 L10 (6). Declined: L4 L5 L8 L9 (4). The key says decline: L4 L6 L9 (3).

## Declines

| | count | rate | likely range |
|---|---|---|---|
| **Coverage** (answered, of all) | L1 L2 L3 L6 L7 L10: 6 of 10 | **60.0%** | 31.3-83.2% |
| **Accuracy when answered** | L1 L2 L7 L10 right; L3 wrong, L6 should have declined: 4 of 6 | **66.7%** | 30.0-90.3% |
| **Declined** (of all) | L4 L5 L8 L9: 4 of 10 | **40.0%** | 16.8-68.7% |
| **Unnecessary declines** (of the declines, the key has an answer) | L5 L8: 2 of 4 | **50.0%** | 15.0-85.0% |
| **Answers that should have been declines** (of the answers, the key says decline) | L6: 1 of 6 | **16.7%** | 3.0-56.4% |

Correct declines: L4, L9.

A decline is neither a wrong label nor dropped: it is out of accuracy's denominator (accuracy
is on what was answered), and coverage and the decline rate are always reported beside it. A
workflow that declines everything it is unsure of scores high accuracy and low coverage; the
pair shows the trade.

## Confusion matrix (rows: answer key; columns: predicted)

| key \ predicted | case_results | attorneys | awards | news | (declined) |
|---|---|---|---|---|---|
| case_results | 2 (L1 L7) | 0 | 0 | 0 | 0 |
| attorneys | 0 | 2 (L2 L10) | 0 | 0 | 0 |
| awards | 0 | 0 | 0 | 1 (L3) | 0 |
| news | 0 | 0 | 0 | 0 | 2 (L5 L8) |
| (declined) | 0 | 0 | 1 (L6) | 0 | 2 (L4 L9) |

Per category: precision is about what was written (a decline writes nothing, so it is never a
false positive); recall counts a decline as a miss (the page was not found).

| category | TP | FP | FN | precision | recall | F1 |
|---|---|---|---|---|---|---|
| case_results | 2 | 0 | 0 | 100.0% | 100.0% | 1.000 |
| attorneys | 2 | 0 | 0 | 100.0% | 100.0% | 1.000 |
| awards | 0 | 1 (L6) | 1 (L3) | 0.0% | 0.0% | 0.000 |
| news | 0 | 1 (L3) | 2 (L5 L8) | 0.0% | 0.0% | 0.000 |

## Routing

- **Straight-through** = written: 6 of 10 = **60.0%**
- **Silent error rate** = written and needed a person: L3, L6 = 2 of 6 = **33.3%** (likely 9.7-70.0%)
  - L3: SP-WRONG (news for awards) → **high**
  - L6: SP-SHOULD-DECLINE (awards, where the key says decline) → **high**
  - by severity: high 2
- **Silent omissions** = declined and left out, but the key has an answer: L5, L8 = 2 of the 7
  links the key gives an answer for (L1 L2 L3 L5 L7 L8 L10) = **28.6%** (likely 8.2-64.1%).
  Both SO-DECLINED, **medium**. There is no correct route in this key, so these are found from
  the declines alone; every other omission type needs a correct route and is "not measured".
- **Review precision**: nothing was sent to a person: n/a (0 of 0)
- **Block precision**: not measured (no correct route in the key)
- **Safeguard failures**: not measured (no thresholds)

## Calibration

Declined links make no claim, so they are left out (4, including L5's 0.4). Claims: L1 L2 L7
L10 at 0.9 (all right), L3 at 0.7 (wrong), L6 at 0.6 (wrong).

| stated | claims | right | accuracy |
|---|---|---|---|
| 0.60 | 1 | 0 | 0.0% |
| 0.70 | 1 | 0 | 0.0% |
| 0.90 | 4 | 4 | 100.0% |

Average gap = (1 × 0.6 + 1 × 0.7 + 4 × 0.1) / 6 = 1.7 / 6 = **0.283**

## Variants, asserted in test/declines.test.js

- **With a correct route** (`expected_outcome` in the key: `WRITTEN` when it has a category,
  `LEFT_OUT` for `none`): L5 and L8 are SO-DECLINED, not SO-FALSE-BLOCK (the decline is why
  they were left out, and one mistake gets one type). L6 is then also SP-FORBIDDEN, critical,
  because the key's route says it should have been left out.
- **A decline that goes out**: if L8 had been written with no category, it would be a silent
  error of type SP-DECLINED (medium): it went out without the answer the key has.
