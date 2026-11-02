# Answer-key suspects fixture: expected results, worked by hand

Thirteen support tickets. The workflow tags each one (`tags`, a set: refund, late, damaged,
wrong-item, fraud) and files it under a `category` (a label: billing, shipping or account, or
`unsure`, a decline). `SEND` goes out without review, `HOLD` goes to a person, `DUP` is a
suppressed duplicate. Each record is built to test one rule of `wfeval suspects` (traps N1-N19
in [test/TRAPS.md](../../TRAPS.md)); `test/suspects.test.js` checks every number below.

| record | answer key | run-a | what it tests |
|---|---|---|---|
| T1, T2 | refund · billing | refund 0.95 · billing 0.95 | agree |
| T3 | refund · billing | refund 0.95, late 0.55 set aside · billing 0.85 | a value the key lacks, stated weakly |
| T4 | late · shipping | late 0.95, damaged 0.95 *inherited*, set aside · shipping 0.95 | an inherited value is never a suspect (N8) |
| T5 | late · shipping | late 0.95, damaged with **no confidence** · shipping 0.85 | no confidence counts as 1 (N18) |
| T6 | late, damaged · shipping | late 0.95, damaged 0.85 · shipping 0.95 | agree |
| T7 | damaged · shipping | damaged 0.85, **refund 0.95** · shipping 0.95 | a value the key may be missing |
| T8 | refund, **late** · **billing** | refund 0.95 · **shipping 0.95** | a value the key may list wrongly, a label it may have wrong |
| T9 | (none) · unsure | misc 0.95 · billing 0.75 (HOLD) | a value outside allowed_values, a key that declines (N8, N17) |
| T10 | **fraud** · account | (none) · account 0.95 (HOLD) | a value the key lists that the workflow never states |
| T11 | one of damaged, wrong-item · shipping | wrong-item 0.85 · unsure (a decline) | an any_of slot, a workflow decline (N8, N17) |
| T12 | late · shipping | late 0.95, refund 0.95 (DUP) | a suppressed duplicate gives no evidence (N8) |
| T13 | refund · billing | the model call failed (`scored: false`) | a failed call gives no evidence (N8, N15) |

## The words

- **x**: the workflow's average confidence in its side over the runs that give evidence: a run
  that does not state the value (or gives another label) counts 0, a value with no confidence
  counts 1. With one run, x is the confidence itself.
- **Bins**: never (x = 0), below 0.50, 0.50-0.59, 0.60-0.69, 0.70-0.79, 0.80-0.89, 0.90 or more.
  Their middles, where a bin sits on a curve: 0, 0.25, 0.55, 0.65, 0.75, 0.85, 0.95.
- **Curve**: per output, how often the answer key sides with the workflow in each bin, with half a
  record added each way ((agree + 0.5) / (n + 1)), made non-decreasing by pooling adjacent bins
  that dip (N6), read in a straight line between bin middles, flat beyond the ends. A set's curve
  starts at the never bin; a label's at the first bin a label was given in. Always leaving the
  suspect's own record out (N4).
- **Weights**, the odds that the key entry is wrong if every entry is equally likely to be wrong:
  - key lacks a value: q / (1 - q), q = (k + 5 C) / (n + 5): of the n other records where the
    workflow states the value in the same bin, k list it; C the curve at x (N5).
  - key lists a value: f0 / f1, f1 = (k1 + 5 F1) / (n1 + 5), f0 = (k0 + 5 F0) / (n0 + 5): of the
    n1 other records whose key lists the value, k1 where the workflow's x falls in the same bin;
    of the n0 whose key lacks it, k0; F1 and F0 the output's shares of listed and unlisted
    entries in that bin, with one entry added to each of the 7 bins.
  - a label: C / (1 - C), C the label curve at x.

## One run: run-a

Records with evidence: T1-T11 (11). T12 is a suppressed duplicate and T13's model call failed.

### tags: every (record, value) entry

| value | listed by the key (record, x) | not listed (record, x) | neither, on the other records |
|---|---|---|---|
| refund | T1 0.95, T2 0.95, T3 0.95, T8 0.95 | T7 0.95 | 6 |
| late | T4 0.95, T5 0.95, T6 0.95, T8 0 | T3 0.55 | 6 |
| damaged | T6 0.85, T7 0.85 | T4 0.95 (inherited), T5 1 | 6 (T11 holds it as an alternative: not counted) |
| fraud | T10 0 | | 10 |

wrong-item is only ever an any_of alternative (T11), and misc is outside allowed_values (T9): no
entries. Pooled over the values:

| bin | never | 0.50-0.59 | 0.80-0.89 | 0.90 or more | all |
|---|---|---|---|---|---|
| listed (k1) | 2 | 0 | 2 | 7 | 11 |
| not listed (k0) | 28 | 1 | 0 | 3 | 32 |

### The suspects, in order

**1. T8 category: the key says billing, run-a says shipping at 0.95.** Label entries with
evidence: T1-T8 and T10 (T9's key declines, T11's run declines). Leaving T8 out: 0.80-0.89 has
T3 and T5, both agreeing: (2 + 0.5) / 3 = 5/6; 0.90 or more has T1, T2, T4, T6, T7, T10, all
agreeing: (6 + 0.5) / 7 = 13/14. Rising, so nothing to pool. C(0.95) = 13/14.
Weight (13/14) / (1/14) = **13**. Why: 6 of 6 other records at 0.90 or more agree.

**2. T8 tags: the key lists late, run-a never states it.** x = 0, the never bin.
late: k1 = 1 (T8 itself) of n1 = 4 listed; k0 = 6 of n0 = 7 not listed. Leaving T8 out:
F1 = (2 - 1 + 1) / (11 - 1 + 7) = 2/17; F0 = (28 + 1) / (32 + 7) = 29/39.
f1 = (0 + 5 x 2/17) / (3 + 5) = 5/68; f0 = (6 + 5 x 29/39) / (7 + 5) = 379/468.
Weight (379/468) / (5/68) = 6443/585 = **11.0137**. Why: of the 3 other records whose key lists
late, the workflow never states it on 0; of the 7 whose key lacks it, on 6.

**3. T10 tags: the key lists fraud, run-a never states it.** fraud: k1 = 1 (T10) of 1; k0 = 10
of 10. f1 = (0 + 5 x 2/17) / (0 + 5) = 2/17; f0 = (10 + 5 x 29/39) / 15 = 107/117.
Weight (107/117) / (2/17) = 1819/234 = **7.7735**. Why: no other record's key lists fraud.

**4. T7 tags: the key lacks refund, run-a states it at 0.95.** refund, 0.90 or more: listed on
4 other records (T1, T2, T3, T8), not listed on none besides T7: k = 4, n = 4.
The curve without T7 (its 0.95 leaves k0 at 0.90 or more 2): never (2 + 0.5) / 31 = 5/62;
0.50-0.59 (0 + 0.5) / 2 = 1/4; 0.80-0.89 5/6; 0.90 or more (7 + 0.5) / 10 = 3/4. 5/6 > 3/4 dips,
so the two pool: (5/6 x 2 + 3/4 x 9) / 11 = 101/132. C(0.95) = 101/132.
q = (4 + 5 x 101/132) / (4 + 5) = 1033/1188; weight 1033/155 = **6.6645**.

**5. T5 tags: the key lacks damaged, run-a states it with no confidence (x = 1).** damaged, 0.90
or more: not listed on 1 other record (T4, inherited), listed on none: k = 0, n = 1. The curve
without T5 is the one in 4 (T5 also takes one k0 out of 0.90 or more), flat beyond 0.95:
C(1) = 101/132. q = (0 + 5 x 101/132) / (1 + 5) = 505/792; weight 505/287 = **1.7596**.

**6. T3 tags: the key lacks late, run-a states it at 0.55, set aside.** late, 0.50-0.59: no other
record (k = 0, n = 0), so q = C(0.55). The curve without T3: never 5/62; 0.50-0.59 now empty;
0.80-0.89 5/6 and 0.90 or more 15/22 pool to 70/99. Between 0 and 0.85:
C(0.55) = 5/62 + (70/99 - 5/62) x 0.55/0.85 = 25355/52173 = 0.4860. Weight 25355/26818 = **0.9454**.

Not suspects: T4's damaged (only inherited), T9's misc (outside allowed_values), T11's wrong-item
(an any_of alternative) and its slot (alternatives are never questioned), T12 (suppressed
duplicate), T13 (failed call), T9's category (the key declines) and T11's (the run declines).

## Two runs: run-a and run-b

run-b differs from run-a on three records: T3 states only refund; T7 states only damaged; T8
applies late at 0.75 and says billing at 0.85.

| # | suspect | the runs | x | weight |
|---|---|---|---|---|
| 1 | T10 tags lists fraud | none of 2 states it | 0 | 1819/117 = 15.547 |
| 2 | T8 category billing, runs say shipping | 1 of 2 (0.95) | (0.95 + 0) / 2 = 0.475 | 5 |
| 3 | T8 tags lists late | 1 of 2, applied (0.75) | (0 + 0.75) / 2 = 0.375 | 204/65 = 3.1385 |
| 4 | T5 tags lacks damaged | 2 of 2 (no confidence) | 1 | 25/11 = 2.2727 |
| 5 | T7 tags lacks refund | 1 of 2 (0.95) | 0.475 | 1.4965 |
| 6 | T3 tags lacks late | 1 of 2, not applied (0.55) | 0.275 | 1.4542 |

Pooled tags entries with x averaged: listed k1 = never 1 (fraud), below 0.50 1 (T8 late),
0.80-0.89 2, 0.90 or more 7 (n1 = 11); not listed k0 = never 28, below 0.50 2 (T7 refund, T3
late), 0.90 or more 2 (n0 = 32).

- **T10 fraud**: F1 = (1 - 1 + 1) / 17 = 1/17, so f1 = 1/17; f0 = 107/117 as before.
  (107/117) / (1/17) = 1819/117 = 15.547: the second run that never states fraud halves f1.
- **T8 category**: without T8, label entries sit at 0.80-0.89 (T3, T5: 5/6) and 0.90 or more
  (T1, T2, T4, T6, T7, T10: 13/14). x = 0.475 is below both: flat, C = 5/6, weight 5. No other
  record at that level: the why line says so.
- **T8 late** (below 0.50): f1 = (1 - 1 + 5 x 1/17) / (4 - 1 + 5) = 5/136; F0 = (2 + 1) / 39 = 1/13,
  f0 = (1 + 5/13) / 12 = 3/26. (3/26) / (5/136) = 204/65 = 3.1385.
- **T5 damaged**: n = 1 (T4), k = 0. Curve without T5: never 1.5/30 = 0.05; below 0.50 1.5/4 =
  0.375; 0.80-0.89 5/6; 0.90 or more (7 + 0.5) / 9 = 5/6. C(1) = 5/6; q = (5 x 5/6) / 6 = 25/36;
  weight 25/11 = 2.2727.
- **T7 refund**: n = 0. Curve without T7: never 0.05; below 0.50 (T8 late listed, T3 late not)
  1.5/3 = 1/2; 0.80-0.89 5/6 and 0.90 or more 7.5/10 pool to 101/132. C(0.475) =
  1/2 + (101/132 - 1/2) x (0.475 - 0.25) / 0.6 = 0.59943; weight 1.4965.
- **T3 late**: below 0.50 holds one other late entry, T8's, listed: k = 1, n = 1. The curve without
  T3 is the one for T7: C(0.275) = 1/2 + (101/132 - 1/2) x 0.025/0.6 = 0.51105.
  q = (1 + 5 x 0.51105) / 6 = 0.59254; weight 1.4542.

## Rulings: rulings.json with run-a

| ruling | what it does |
|---|---|
| T7 tags refund **add** | refund joins T7's key: run-a agrees, no longer a suspect |
| T10 tags fraud **remove** | fraud leaves T10's key: nothing left to disagree about |
| T8 category billing **replace** with shipping | T8's key says shipping: run-a agrees |
| T8 tags late **keep** | still a suspect, ruled: not listed, counted |
| T3 tags late **reject** | still a suspect, ruled: not listed, counted |
| T5 tags damaged **pending** | listed, with "pending (DH, 2026-11-01)" |

Listed: T5 damaged only; 2 not listed (T3 late, T8 late). With the ruled key the evidence moves:
refund is listed at 0.90 or more on 5 records, fraud has no entries at all. Pooled: k1 never 1,
0.80-0.89 2, 0.90 or more 8; k0 never 18, 0.50-0.59 1, 0.90 or more 2. Without T5 the curve is
never 1.5/20, 0.50-0.59 0.25, 0.80-0.89 5/6, 0.90 or more (8 + 0.5) / 10 = 0.85: rising.
q = (0 + 5 x 0.85) / (1 + 5) = 17/24; weight **17/7 = 2.4286**.

score with run-a and rulings.json: 3 of the 9 records out without review are silent errors
(T5 damaged, T8 late, T11 declined), down from 4 (T7's refund is now right; T8's category too, but
T8 still misses late). T10 now matches its key, so its review was unnecessary: review precision
2 of 3. The pending T5 damaged, added, would clear T5: 2 of 9, a bracket (an add of a value run-a
applied can only clear an error).

## Pending removes and replaces: rulings-pending.json with run-a (trap N13)

Strict: 4 of 9 silent (T5, T7, T8, T11). Every pending ruling made as proposed: T10 loses fraud
(T10 went to a person: no change), T8's category becomes shipping (T8 still misses late: still a
silent error), T6 loses late, which run-a **applied**: T6's late becomes wrong, a new silent error.
5 of 9 (55.6%, likely 26.7-81.1%). T6's pending remove is not one-way (it turns a right answer
wrong), and the JSON names it in `not_one_way`.

Is it a bracket? Every way the three could be ruled, record by record among the records out
without review: T10 went to a person (not in the rate). T8 misses late whatever its label is
(billing, shipping or account): silent in every case. T6: late kept, right; removed, wrong. So the
lowest is 4 of 9 and the highest 5 of 9: the two figures themselves. A bracket: "However they are
ruled, the rate lands between the two."

Not a bracket (built in the test, not a file here): a pending add of refund on T7 beside a pending
remove of damaged on T7, run-a having applied both. As the key stands T7 is wrong (refund);
as proposed it is wrong too (damaged, removed, is now wrong); added and kept, it is right. The
other 3 silent errors (T5, T8, T11) do not move: lowest 3 of 9 (33.3%), highest 4 of 9 (44.4%),
both figures 4 of 9. The line: "ruled other ways, it could be anywhere from 33.3% (3 of 9) to
44.4% (4 of 9)".

## Leave-one-out with a copied record (built in the test)

T14 retells T7: the same answer key (damaged, shipping) and the same answers (damaged 0.85,
refund 0.95, shipping 0.95). Read as independent, T14's refund is a second entry where the key lacks
refund at 0.90 or more, so for T7: refund at 0.90 or more is listed on 4 of n = 5 other records.
The curve without T7: 0.80-0.89 holds T6, T7 and T14's damaged, listed, (3 + 0.5) / 4 = 7/8; 0.90 or
more 7 listed of 10, (7 + 0.5) / 11 = 15/22; they dip and pool, (7/8 x 3 + 15/22 x 10) / 13 = 0.72640.
q = (4 + 5 x 0.72640) / (5 + 5) = 0.76320; weight **3.2230**. With `clusters` (T7 and T14 in one
story) or `duplicate_of_field` (T14 a duplicate of T7), T14 is left out of T7's evidence altogether,
and T7's weight is its weight without T14: **1033/155 = 6.6645**, as in "One run" above.

## With a split (`config-split.json`; traps O21-O24)

The same config with `"split": { "held_out": 0.3 }`: sha256, no salt, a record's unit is its id (no
duplicates or clusters here). A unit's place from 0 to 1 is the first 4 bytes of SHA-256 of its name,
read as a whole number and divided by 2^32; held out when under 0.3. The hex digits were checked with
.NET's SHA256 as well as the tool. `test/suspects-split.test.js` checks every number below.

| id | sha256 starts | place | half |
|---|---|---|---|
| T1 | 1f93603d | 0.1233 | held out |
| T2 | 0f617ba9 | 0.0601 | held out |
| T3 | 5dd67f7f | 0.3666 | tuning |
| T4 | 11ee5e9a | 0.0700 | held out |
| T5 | 020d01e5 | 0.0080 | held out |
| T6 | 6dbdaf93 | 0.4287 | tuning |
| T7 | f005e93d | 0.9376 | tuning |
| T8 | 605fc1d6 | 0.3765 | tuning |
| T9 | 78a78a4e | 0.4713 | tuning |
| T10 | f7ef0de3 | 0.9685 | tuning |
| T11 | 691802e8 | 0.4105 | tuning |
| T12 | 8fd4b56e | 0.5618 | tuning |
| T13 | 43d5d400 | 0.2650 | held out |
| T14 (built in the tests) | 7fe51a27 | 0.4996 | tuning, by its own id |

So the **held-out half** is T1, T2, T4, T5 and T13 (5 records) and the **tuning half** the other 8.
Without `--show-held-out` those 5 are left out altogether: never listed, and never read as evidence
for the others (O21). Nothing the command writes names them (O21, O22).

### run-a, the tuning half only

Records with evidence: T3, T6, T7, T8, T9, T10, T11 (7; T12 is a suppressed duplicate). T13's failed
call is held out, so no N15 warning: its record gives no evidence either way.

| value | listed by the key (record, x) | not listed (record, x) | neither, on the other records |
|---|---|---|---|
| refund | T3 0.95, T8 0.95 | T7 0.95 | 4 |
| late | T6 0.95, T8 0 | T3 0.55 | 4 |
| damaged | T6 0.85, T7 0.85 | | 4 (T11 holds it as an alternative: not counted) |
| fraud | T10 0 | | 6 |

Pooled over the values: listed (k1) never 2, 0.80-0.89 2, 0.90 or more 3 (n1 = 7); not listed (k0)
never 18, 0.50-0.59 1, 0.90 or more 1 (n0 = 20). Shares with one entry added to each of the 7 bins,
for the never bin: F1 = (2 - 1 + 1) / (7 - 1 + 7) = 2/13; F0 = (18 + 1) / (20 + 7) = 19/27.

**1. T7 tags: the key lacks refund, run-a states it at 0.95.** refund at 0.90 or more: listed on 2
other records (T3, T8), not listed on none besides T7: k = 2, n = 2. The curve without T7's entry:
never (2 + 0.5) / 21 = 5/42; 0.50-0.59 (0 + 0.5) / 2 = 1/4; 0.80-0.89 (2 + 0.5) / 3 = 5/6; 0.90 or
more (3 + 0.5) / 4 = 7/8. Rising, so nothing to pool. C(0.95) = 7/8.
q = (2 + 5 x 7/8) / (2 + 5) = 51/56; weight (51/56) / (5/56) = **51/5 = 10.2**. Why: 2 of 2 other
records, and about 88% from 3 of 3 at 0.90 or more. With the held-out records it was 4th, at 6.6645:
T4's inherited damaged and T5's damaged with no confidence sat unlisted at 0.90 or more, and pulled
that bin's curve down to 101/132. That is why held-out records must not be evidence either.

**2. T8 category: the key says billing, run-a says shipping at 0.95.** Label entries: T3 billing
0.85 (agrees), T6, T7 and T10 at 0.95 (agree), T8 at 0.95 (disagrees); T9's key declines and T11's
run declines. Without T8: 0.80-0.89 (1 + 0.5) / 2 = 3/4; 0.90 or more (3 + 0.5) / 4 = 7/8. C(0.95) =
7/8; weight **7**.

**3. T8 tags: the key lists late, run-a never states it.** late: k1 never 1 (T8 itself) of n1 = 2;
k0 never 4, 0.50-0.59 1 (T3), n0 = 5. f1 = (1 - 1 + 5 x 2/13) / (2 - 1 + 5) = 5/39;
f0 = (4 + 5 x 19/27) / (5 + 5) = 203/270. Weight (203/270) / (5/39) = 7917/1350 = **2639/450 =
5.8644**. Why: never on 0 of the 1 other record whose key lists late, on 4 of the 5 whose key lacks it.

**4. T10 tags: the key lists fraud, run-a never states it.** fraud: k1 never 1 (T10) of 1; k0 never
6 of 6. f1 = (0 + 5 x 2/13) / 5 = 2/13; f0 = (6 + 5 x 19/27) / 11 = 257/297. Weight
(257/297) / (2/13) = **3341/594 = 5.6246**.

**5. T3 tags: the key lacks late, run-a states it at 0.55, set aside.** late at 0.50-0.59: no other
record (k = 0, n = 0), so q = C(0.55). The curve without T3: never 5/42; 0.80-0.89 5/6 and 0.90 or
more (3 + 0.5) / 5 = 7/10 dip and pool, (5/6 x 2 + 7/10 x 4) / 6 = 67/90, "at 0.80 or more", 5 of 6.
Between 0 and 0.85: C(0.55) = 5/42 + (67/90 - 5/42) x 0.55/0.85 = 5/42 + (197/315)(11/17) =
5609/10710 = 0.5237. Weight 5609/5101 = **1.0996**.

Not listed: T5's damaged (held out; 5th of 6 without a split). The JSON: `split` = 30% held out,
sha256, no salt, by cluster, no log; tuning 8 records; held out 5, **left out 5**; none set aside;
`look` null (nothing of the held-out half was shown, so no look). The report says once that the
other 5 records are left out, both as suspects and from the evidence, and that `--show-held-out`
includes them.

### With rulings.json

T7's add, T10's remove and T8's replace (all tuning) leave nothing to disagree about there; T3's
late (reject) and T8's late (keep) are ruled: **no suspect listed, 2 not listed**. T5's pending
ruling is on a held-out record: counted under the split ("0 added, 0 ruled not a gap, 1 pending"),
in no list, and not named.

### --show-held-out (O23)

Both halves are evidence and suspects again: exactly the six suspects and weights of "One run" (and
of "Two runs" with run-b), with N15 naming T13, and with rulings.json exactly its result without a
split (T5 damaged listed, pending). `held_out.left_out` is 0. With `split.log` it is a look whose
ids were shown: the log's look 1, `"command": "suspects"`, `ids_shown` true, 5 held-out records,
and a listing covering look 1. The same command again is "look 1 again"; `--top 3`, and `--top 3`
with `--json` (every suspect written), are new looks. A `score --target 40` look after them claims
nothing on these records: their share is 0, "listed" (O13). Without `--show-held-out` no look is
recorded, and a log is never started.

### Records that changed half (O10), and units as score draws them (built in the tests)

T14 retells T5 (the same key and answers). Marked a duplicate of T5 (`duplicate_of_field`), it goes
with T5: held out, 6 records left out. By its own id (`split.by: "id"`) its place is 0.4996, in the
tuning half: listed (the key lacks damaged), 5 left out. In a story "s5" with T5 (`clusters`), the
story's place is 0.2328: both held out, 6 left out. score draws the same halves each time.

After a `--show-held-out` look with T14 a duplicate of T5 (held out), a key where it is not makes it
a tuning record that was held out: a strict run stops (O10) before anything is printed, with
`--show-held-out` or without; with `--lenient` it is set aside, in neither half (8 tuning, 5 held
out, 1 set aside), and is not listed.

### --write-rulings (O24)

Without `--show-held-out`, the pending rulings written are the listed suspects', in the order above:
T7 refund, T8 billing, T8 late, T10 fraud, T3 late. With it, the six of "One run", T5 damaged among
them. The `--rulings` file's own rulings are carried as written, those on held-out records too (left
out, the new file would change the key score uses for the held-out half): the message counts them
and names none. In the test that scans every output, the earlier file holds a pending ruling on T5,
a remove on T1 that no longer fits the key (N12: set aside, its warning counts T1 instead of naming
it) and a keep on T8: "2 of them on held-out records, copied as written". A stray space on T5 in
the run (D7) is counted the same way.
