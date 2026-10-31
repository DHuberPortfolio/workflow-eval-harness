# Alternatives fixture: hand-worked answers

Six questions answered by an assistant that cites podcast episodes. One set output, `cites`:
the episodes it cites. It sends an answer on its own (ANSWER, auto) or asks a person
(REVIEW, review). Built for two things the answer key could not say before:

- **"Any of these is right."** Several episodes cover the same point, and citing any one of
  them is right. The key writes that as one slot: `{ "any_of": ["ep-01", "ep-02", "ep-03"] }`.
- **Equivalent values.** Episode 12 was re-released as `ep-12-rerun`: the same episode under
  two ids. The config says so: `"equivalents": { "cites": [["ep-12", "ep-12-rerun"]] }`, and
  both are read as `ep-12`, the group's first value, on both sides.

Every number below was worked out by hand before the code that computes it existed.

```
node bin/wfeval.js score --config test/fixtures/alternatives/config.json \
  --pred test/fixtures/alternatives/predictions.json --key test/fixtures/alternatives/key.json
```

## The records

Floor 0.60 (below it a value is set aside); gate: the strongest cited episode needs 0.80 for
the answer to go out without review.

| id | decision | key | cited (confidence) | what it tests |
|---|---|---|---|---|
| A1 | ANSWER | one of ep-01, ep-02, ep-03 | ep-02 (0.90) | one alternative fills the slot |
| A2 | ANSWER | ep-05; one of ep-01, ep-02 | ep-05 (0.95), ep-01 (0.85), ep-02 (0.82) | two values from one slot: **both** right |
| A3 | ANSWER | one of ep-07, ep-08, ep-09 | ep-04 (0.90) | a wrong value, and a slot nothing fills |
| A4 | ANSWER | ep-20; one of ep-10, ep-11 | ep-20 (0.90); ep-11 (0.55, set aside) | a slot whose alternative was found but set aside |
| A5 | ANSWER | ep-12 | ep-12-rerun (0.90); ep-12 (0.58, set aside) | two equivalent values in one prediction: merged |
| A6 | REVIEW | ep-12-rerun | ep-12 (0.75) | an equivalent in the key: right, so the review was unnecessary |

Expected decision: ANSWER for all six. `wrong_when` is the default with a correct route,
`either`: a record needed a person if the key does not send it out on its own, or its values
are wrong.

## Reading the files

**Equivalents.** `ep-12-rerun` is read as `ep-12` wherever it appears: once in the predictions
(A5) and once in the key (A6). The report says so, once per file.

**A5 merges.** After that, A5 cites `ep-12` twice: applied at 0.90 (written `ep-12-rerun`) and
set aside at 0.58. One episode cited twice is one value, so the two merge: **applied** (either
was) at **0.90**, the applied copy's confidence. The report lists this as a clean-up: "merged 2
equivalent values". The 0.58 copy is gone from everything after: calibration and the what-ifs
see one value.

The confidence kept is always an applied copy's when there is one, never a higher one set aside:
had A5 applied ep-12 at 0.58 and set ep-12-rerun aside at 0.90, the merge would be applied at
0.58, under the gate and the floor, as it would be read without equivalents. When two applied
copies differ, the highest is kept and the lowest beside it, for the floor and a "weakest" gate
(`test/alternatives.test.js` checks both).

The key keeps its slots as written. Which values count as right is worked out per record, from
what that record applied, every time a number is computed (so the what-if below re-works it at
every floor).

## Per record: which slots are filled

A slot is **filled** when any of its values was applied. Every applied value in a filled slot
is right (a true positive, TP). An applied value in no slot is wrong (a false positive, FP).
Each slot left unfilled is one miss (a false negative, FN): "found but set aside" when one of
its values was proposed but not applied, otherwise "never found".

| id | slots | applied | filled? | TP | FP | FN | what differs |
|---|---|---|---|---|---|---|---|
| A1 | {ep-01, ep-02, ep-03} | ep-02 | yes, by ep-02 | 1 | 0 | 0 | - |
| A2 | {ep-05}, {ep-01, ep-02} | ep-05, ep-01, ep-02 | yes; yes, by both | 3 | 0 | 0 | - |
| A3 | {ep-07, ep-08, ep-09} | ep-04 | no; nothing of it proposed | 0 | 1 | 1 | wrong: ep-04 · never found: one of ep-07, ep-08, ep-09 |
| A4 | {ep-20}, {ep-10, ep-11} | ep-20 | yes; no, ep-11 set aside | 1 | 0 | 1 | found but set aside: ep-11 (one of ep-10, ep-11) |
| A5 | {ep-12} | ep-12 (merged) | yes | 1 | 0 | 0 | - |
| A6 | {ep-12} (written ep-12-rerun) | ep-12 | yes | 1 | 0 | 0 | - |
| | | | **total** | **7** | **1** | **2** | |

A2's two values from one slot are both right, and its slot adds no miss. That is the same as
rewriting A2's key to the episodes it cited ({ep-05, ep-01, ep-02}), which is what the archive
assistant did by hand before every run: the key is resolved per record.

## Output quality

precision = 7 / (7 + 1) = **87.5%** · recall = 7 / (7 + 2) = **77.8%** · F1 = 2·7 / (2·7 + 1 + 2) = 14 / 17 = **0.824**

Exact match (no wrong value and no unfilled slot): A1 A2 A5 A6 = 4 of 6 = **66.7%**.

Per value (an unfilled slot is counted under its own name, "one of ..."):

| value | TP | FP | FN |
|---|---|---|---|
| ep-01 | 1 (A2) | 0 | 0 |
| ep-02 | 2 (A1, A2) | 0 | 0 |
| ep-04 | 0 | 1 (A3) | 0 |
| ep-05 | 1 (A2) | 0 | 0 |
| ep-12 | 2 (A5, A6) | 0 | 0 |
| ep-20 | 1 (A4) | 0 | 0 |
| one of ep-07, ep-08, ep-09 | 0 | 0 | 1 (A3) |
| one of ep-10, ep-11 | 0 | 0 | 1 (A4) |

## Routing

| class | records |
|---|---|
| auto | A1 A2 A3 A4 A5 (5) |
| review | A6 (1) |

- **Straight-through** = 5 / 6 = **83.3%**
- **Silent error rate** = 2 of 5 = **40.0%**: A3 and A4 went out with wrong or missing values.
  Wilson: z² = 3.8416; 1 + z²/5 = 1.76832; center (0.4 + 0.38416) / 1.76832 = 0.443449;
  half 1.96 × sqrt(0.048 + 0.038416) / 1.76832 = 1.96 × 0.293966 / 1.76832 = 0.325831;
  range **11.8-76.9%**.
  - A3: **SP-WRONG** (ep-04, high) and **SP-MISSING** (one of ep-07, ep-08, ep-09, medium): high
  - A4: **SP-MISSING-REJECTED** (ep-11, one of ep-10, ep-11, medium): medium
- **Safeguard failures**: none. A1-A5 lead at 0.90 or 0.95, above the 0.80 gate; no applied
  value is under the 0.60 floor (A5's 0.58 copy was merged into its 0.90 one).
- **Silent omissions**: nothing blocked or suppressed: 0 of 6.
- **Review precision** = 0 of 1. A6 was sent to a person (its 0.75 misses the gate), but its
  `ep-12` is the key's `ep-12-rerun`: nothing was wrong. Unnecessary review: **A6**.

**Without these two features**, the same answers scored against a key that lists every
alternative as a plain value, with no equivalents: TP 5, FP 3, FN 9 (A1 misses ep-01 and
ep-03; A4 misses ep-10; A5's ep-12-rerun is wrong and its ep-12 set aside; A6's ep-12 is wrong
and its ep-12-rerun missed). Precision 62.5%, recall 35.7%, and **4 of 5** silent errors (A1,
A3, A4, A5), of which only A3 and A4 are real. Listing just one alternative instead would make
A1's ep-02 wrong whichever one was not listed. That is why the projects rewrote their keys.

## Calibration

Every value proposed with a confidence is a claim, applied or not. A claim is right if its
value is in any of the record's slots. A4's set-aside ep-11 is right: it is one of the
alternatives. A5 is one claim after the merge.

| stated | claims | right | accuracy | gap |
|---|---|---|---|---|
| 0.55 | A4 ep-11 | 1 | 100% | +0.45 |
| 0.75 | A6 ep-12 | 1 | 100% | +0.25 |
| 0.82 | A2 ep-02 | 1 | 100% | +0.18 |
| 0.85 | A2 ep-01 | 1 | 100% | +0.15 |
| 0.90 | A1 ep-02, A3 ep-04, A4 ep-20, A5 ep-12 | 3 | 75% | -0.15 |
| 0.95 | A2 ep-05 | 1 | 100% | +0.05 |
| **all** | **9** | **8** | 88.9% | |

Average gap = (0.45 + 0.25 + 0.18 + 0.15 + 4 × 0.15 + 0.05) / 9 = 1.68 / 9 = **0.187**.

The config's thresholds: at or above the 0.60 floor, 7 of 8 right; below it, 1 of 1 (ep-11).
At or above the 0.80 gate, 6 of 7 right.

## What-if: the floor

A floor change changes what is applied, so the slots are filled again at every floor. Current
floor 0.60. No record changes route at any floor (A1-A5 keep a lead of 0.90 or more; A6 stays
with a person), and none needs a replay (every record went out or to a person, so every one is
movable).

| floor | values changed | TP/FP/FN | precision | recall | F1 | silent errors |
|---|---|---|---|---|---|---|
| 0.55 | + A4 ep-11 | 8/1/1 | 88.9% | 88.9% | 0.889 | A3 (1 of 5) |
| 0.60 (current) | - | 7/1/2 | 87.5% | 77.8% | 0.824 | A3 A4 (2 of 5) |
| 0.80 | - A6 ep-12 | 6/1/3 | 85.7% | 66.7% | 0.750 | A3 A4 (2 of 5) |
| 0.85 | - A2 ep-02, - A6 ep-12 | 5/1/3 | 83.3% | 62.5% | 0.714 | A3 A4 (2 of 5) |
| 0.90 | - A2 ep-01, - A2 ep-02, - A6 ep-12 | 4/1/4 | 80.0% | 50.0% | 0.615 | A2 A3 A4 (3 of 5) |

Reading it:

- **0.55**: ep-11 is applied again and fills A4's slot. A4 is no longer a silent error.
- **0.85**: A2 loses ep-02, but its slot is still filled by ep-01. That costs one true
  positive and adds no miss: TP + FN falls from 9 to 8. With slots, what recall is out of
  depends on what was applied, because a slot filled twice counts twice.
- **0.90**: A2 loses ep-01 too. Its slot is now empty, both values found but set aside:
  "ep-01 or ep-02 (one of ep-01, ep-02)". A2 becomes a silent error (SP-MISSING-REJECTED).
- From 0.80, A6 loses its only value: its review is now needed (1 of 1).

## Possible key gaps (variance)

Scored twice (the same run passed as two runs), the values stated in every run that the key
does not accept: **A3 ep-04** only. A4's ep-11 and A2's ep-01 and ep-02 are alternatives of a
slot: in the key, so never a key-gap candidate, whether applied or set aside.

## Clean-ups the report lists

- predictions, A5: cites: merged 2 equivalent values, "ep-12-rerun" and "ep-12", into "ep-12" (applied, confidence 0.9)
- predictions: cites: 1 predicted value read as its equivalent: ep-12-rerun as ep-12
- answer key: cites: 1 answer key value read as its equivalent: ep-12-rerun as ep-12
