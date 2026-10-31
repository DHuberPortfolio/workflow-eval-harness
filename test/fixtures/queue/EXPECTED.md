# Queue fixture: hand-worked answers

Ten messages triaged by a workflow: send a reply on its own (SEND, auto), ask the owner
(ASK, review), file it (FILE, block), or drop it as a duplicate (DUPLICATE, exclude). One set
output, `TOPIC`. Two runs of the same records: `predictions.json` (before) and
`predictions-after.json` (after a change). Built for four things: what review precision
counts (trap G12), what a target needs (G13), judging a change on the same records without
repeated runs (I9), and rates per group (H6-H8).

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

## Per group (H6-H8)

Two fields were added for this, and change nothing above: the key's `channel` (how the message
came in) and the before run's `branch` (which part of the workflow decided: 1 the rules, 2 the
model). Scored on the before run, with this added to `config.json` (as `test/queue.test.js`
does):

```json
"groups": { "channel": { "field": "channel" }, "branch": { "field": "branch", "from": "predictions" } }
```

For the key's field alone, `wfeval score ... --group-by channel` does the same.

| id | before | key | channel (key) | branch (before) | what happened |
|---|---|---|---|---|---|
| Q1 | SEND | SEND | email | 2 | went out, right |
| Q2 | SEND | ASK | chat | 2 | **silent error** |
| Q3 | ASK | ASK | chat | 2 | sent to a person, needed one |
| Q4 | ASK | SEND | email | 2 | unnecessary review |
| Q5 | ASK | FILE | email | 2 | unnecessary review (the key files it) |
| Q6 | ASK | SEND | email | 2 | sent to a person, needed one (wrong TOPIC) |
| Q7 | FILE | FILE | none | 1 | blocked, right |
| Q8 | ASK | DUPLICATE | email | 1 | unnecessary review (the key drops it) |
| Q9 | ASK | SEND | chat | 2 | unnecessary review |
| Q10 | ASK | SEND | chat **and** email | 2 | unnecessary review |

Q7 has no channel, so it is grouped as "(none)" (as H1), shown last. Q10 has two, so it counts
in both rows (H7): the channel rows hold 4 + 6 + 1 = **11** records, one more than there are.
`branch` is a number in the file and is read as the text "1" or "2".

Each row is the headline's arithmetic on that row's records alone. A rate with nothing to
count (0 of 0) is n/a, never 0% (G1).

**channel**

| label | records | silent error rate | straight-through | review precision | silent omissions | routed as the key says |
|---|---|---|---|---|---|---|
| chat | 4: Q2 Q3 Q9 Q10 | 1 of 1 (Q2) | 1 of 4 | 1 of 3 (Q3; unnecessary Q9 Q10) | 0 of 4 | 1 of 4 (Q3) |
| email | 6: Q1 Q4 Q5 Q6 Q8 Q10 | 0 of 1 | 1 of 6 | 1 of 5 (Q6; unnecessary Q4 Q5 Q8 Q10) | 0 of 4 (Q1 Q4 Q6 Q10) | 1 of 6 (Q1) |
| (none) | 1: Q7 | 0 of 0, n/a | 0 of 1 | 0 of 0, n/a | 0 of 0, n/a (the key files Q7) | 1 of 1 |

**branch**

| label | records | silent error rate | straight-through | review precision | silent omissions | routed as the key says |
|---|---|---|---|---|---|---|
| 1 | 2: Q7 Q8 | 0 of 0, n/a | 0 of 2 | 0 of 1 (unnecessary Q8) | 0 of 0, n/a | 1 of 2 (Q7) |
| 2 | 8: the rest | 1 of 2 (Q2) | 2 of 8 | 2 of 6 (Q3 Q6; unnecessary Q4 Q5 Q9 Q10) | 0 of 7 | 2 of 8 (Q1 Q3) |

Every record has exactly one branch, so the branch rows add up to the headline: silent errors
0 + 1 = 1 of 0 + 2 = 2; reviews 0 + 2 = 2 of 1 + 6 = 7 (28.6%, as above); omissions 0 of 0 + 7 = 7.
The channel rows do not, because Q10 is in two of them.

**The ranges.** Wilson, as above: z^2 = 3.8416; with p = n/d, the center is
(p + z^2/2d) / (1 + z^2/d) and the half-width 1.96 x sqrt(p(1 - p)/d + z^2/4d^2) / (1 + z^2/d).
Worked in full for chat's 1 of 1: 1 + 3.8416 = 4.8416; center (1 + 1.9208) / 4.8416 = 0.603272;
half 1.96 x sqrt(0 + 0.9604) / 4.8416 = 1.96 x 0.98 / 4.8416 = 0.396728; range 0.206544 to 1,
**20.7-100.0%**. The rest the same way:

| count | 1 + z^2/d | center | half | likely range | where |
|---|---|---|---|---|---|
| 1 of 1 | 4.8416 | 0.603272 | 0.396728 | 20.7-100.0% | chat silent; (none) routed |
| 0 of 1 | 4.8416 | 0.396728 | 0.396728 | 0.0-79.3% | email silent; (none) straight-through; branch 1 review |
| 1 of 4 | 1.9604 | 0.372475 | 0.326889 | 4.6-69.9% | chat straight-through and routed |
| 0 of 4 | 1.9604 | 0.244950 | 0.244950 | 0.0-49.0% | chat and email omissions |
| 1 of 3 | 2.280533 | 0.426918 | 0.365427 | 6.1-79.2% | chat review |
| 1 of 6 | 1.640267 | 0.296781 | 0.266728 | 3.0-56.4% | email straight-through and routed |
| 1 of 5 | 1.768320 | 0.330347 | 0.294124 | 3.6-62.4% | email review |
| 0 of 2 | 2.920800 | 0.328814 | 0.328814 | 0.0-65.8% | branch 1 straight-through |
| 1 of 2 | 2.920800 | 0.500000 | 0.405471 | 9.5-90.5% | branch 1 routed; branch 2 silent |
| 2 of 8 | 1.480200 | 0.331104 | 0.259626 | 7.1-59.1% | branch 2 straight-through and routed |
| 2 of 6 | 1.640267 | 0.398391 | 0.301621 | 9.7-70.0% | branch 2 review |
| 0 of 7 | 1.548800 | 0.177169 | 0.177169 | 0.0-35.4% | branch 2 omissions |

**What it shows (H6).** chat's silent error rate is 100% and email's 0%: as far apart as two
rates can be. Each comes from one record out without review, and their ranges, 20.7-100.0% and
0.0-79.3%, overlap from 20.7% to 79.3%. These ten records cannot tell the two channels apart.
That is why the report puts the count and range beside every group rate, and says to compare
the ranges, not the percentages.
