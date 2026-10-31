# Queue fixture: hand-worked answers

Ten messages triaged by a workflow: send a reply on its own (SEND, auto), ask the owner
(ASK, review), file it (FILE, block), or drop it as a duplicate (DUPLICATE, exclude). One set
output, `TOPIC`. Two runs of the same records: `predictions.json` (before) and
`predictions-after.json` (after a change). Built for three things: what review precision
counts (trap G12), what a target needs (G13), and judging a change on the same records without
repeated runs (I9).

## The records

| id | key | key TOPIC | before | before TOPIC | after | after TOPIC |
|---|---|---|---|---|---|---|
| Q1 | SEND | billing | SEND | billing | SEND | billing |
| Q2 | ASK | billing | **SEND** | billing | ASK | billing |
| Q3 | ASK | refund | ASK | refund | ASK | refund |
| Q4 | SEND | billing | ASK | billing | SEND | billing |
| Q5 | FILE | (none) | ASK | **promo** | FILE | promo |
| Q6 | SEND | refund | ASK | **billing** | **SEND** | **billing** |
| Q7 | FILE | (none) | FILE | (none) | FILE | (none) |
| Q8 | DUPLICATE of Q1 | billing | ASK | billing | DUPLICATE | billing |
| Q9 | SEND | refund | ASK | refund | SEND | refund |
| Q10 | SEND | billing | ASK | billing | SEND | billing |

`wrong_when` is the default with a correct route, `either`: a record needed a person if the key
does not send it out on its own, or its values are wrong.

## Before: review precision (G12)

Sent to a person: Q3 Q4 Q5 Q6 Q8 Q9 Q10 (7).

| id | why it went to a person | needed one? |
|---|---|---|
| Q3 | the key asks the owner | yes |
| Q4 | | no: the key sends it, values right. Could have gone out |
| Q5 | | **no: the key files it.** Its wrong TOPIC does not matter: a filed message is never answered |
| Q6 | | yes: the key sends it, but its TOPIC is wrong |
| Q8 | | **no: the key drops it as a duplicate** |
| Q9 | | no: could have gone out |
| Q10 | | no: could have gone out |

Review precision = 2 of 7 = **28.6%**. Wilson: z^2 = 3.8416; 1 + 3.8416/7 = 1.5488;
center (0.285714 + 0.274400) / 1.5488 = 0.361644; half 1.96 x sqrt(0.029155 + 0.019600) / 1.5488
= 0.279429; range **8.2-64.1%**.

Unnecessary reviews: Q4 Q9 Q10 could have gone out; Q5 Q8 the key leaves out (blocks or
suppresses). Before the fix, Q5 and Q8 counted as "needed a person" (any key route but SEND did),
giving 4 of 7 = 57.1%: a queue padded with messages nobody should have seen looked precise.

Q5 still "needed a person" in the silent-error sense: had it gone out unseen, that would be a
silent error (SP-FORBIDDEN). Not going out and needing a person are different things.

Unchanged: silent error rate 1 of 2 (Q2, SP-SHOULD-REVIEW); block precision 1 of 1 (Q7);
silent omissions 0 of 7 (should go out or to a person: Q1 Q2 Q3 Q4 Q6 Q9 Q10).

## Targets (G13)

Before, `--target 5`: 1 of 2 = 50%, at or above 5%, so no number of records can show it. The
hard minimum for anyone: the smallest n with 0 of n under 5% is **73** (0 of 73 reaches 4.99%,
0 of 72 5.07%). This run sends 2 of 10 records out, so 73 out means 73 x 10 / 2 = **365** in all.

After, `--target 30`: 1 of 5 = 20%, under 30%. Not shown yet (1 of 5 reaches 62.4%). The plan
at a real rate of 20%: **158** records out give at least an 80% chance (83.5%) of a range under
30%, the same as error-rate-calculator's `planTest(0.2, 0.3)`; 158 x 10 / 5 = **316** in all. The
hard minimum: 0 of 9 reaches under 30%, 9 x 10 / 5 = **18** in all.

After, `--target 70`: 1 of 5 reaches 62.4%, under 70%: **shown**.

## Paired: before against after (I9)

The same 10 records. For each outcome, the records it fixed (true before, false after) and
broke (false before, true after):

| outcome | before | after | fixed | broke | McNemar (f - b) / sqrt(f + b) | verdict |
|---|---|---|---|---|---|---|
| silent errors | Q2 | Q6 | Q2 | Q6 | 0 / 1.41 = 0 | unclear |
| silent omissions | - | - | - | - | no change | no change |
| unnecessary reviews | Q4 Q5 Q8 Q9 Q10 | - | all 5 | - | 5 / 2.24 = 2.24 > 1.96 | **better** |
| routed against the key | Q2 Q4 Q5 Q6 Q8 Q9 Q10 | - | all 7 | - | 7 / 2.65 = 2.65 | **better** |

Q6 now goes out with the key's route but the wrong TOPIC: it is routed as the key says, and it
is a silent error (SP-WRONG). Routing and content are counted separately.

Ranges (Tango's score interval, as points of the 10 records, after minus before; the same as
error-rate-calculator's `pairedDifference`): silent errors -34.2 to +34.2; unnecessary reviews
-76.3 to -8.4; routed against the key -89.2 to -22.8.

The silent error *rate* fell from 50.0% (1 of 2) to 20.0% (1 of 5), yet the same number of
silent errors went out: one fixed, one broken. The rate fell because more correct records went
out beside the error. The paired count says so; the rate alone does not.
