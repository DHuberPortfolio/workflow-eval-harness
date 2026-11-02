# Monitor segments fixture: expected numbers, worked by hand

Seven weeks of a live scorecard split by channel (`counts.csv`: one row per week and channel, both
series' columns), and three weeks as run files (`runs/`, a `channel` field on most records, a
correct route in `expected_decision`, scored with `config.json`). Checked by `test/monitor.test.js`.

Settings: silent errors with `--target 5 --acceptable 2.5` (alarming 5%); silent omissions with
`--watch silent-omissions --target 20 --acceptable 10` (alarming 20%); the default
`--false-alarm-every 2000`. The counts file is read by segment with `--segment-by segment` (and,
where said, `--segments chat,email,phone`); the run files with `--segment-by channel`.

The alarm levels are not hand-workable: each is the smallest whole number of steps whose Markov
chain gives at least the records per false alarm asked, for the period size named (as in
`test/fixtures/monitor/EXPECTED.md`). With segments, the whole and every segment are each set for
**4,000** records (twice the 2,000 asked: they share it; docs/METRICS.md, "Each segment"). The
levels used here, from the chain:

| from - to | records a period | set for 2,000 | set for 4,000 |
|---|---|---|---|
| 2.5% - 5% | 1 | 210 | 255 |
| 2.5% - 5% | 2 | 208 | 253 |
| 2.5% - 5% | 3 | 205 | 251 |
| 2.5% - 5% | 4 | 203 | 249 |
| 2.5% - 5% | 20 | 176 | 226 |
| 2.5% - 5% | 43 | 152 | 200 |
| 10% - 20% | 1 | 312 | 362 |
| 10% - 20% | 2 | 305 | 355 |
| 10% - 20% | 3 | 297 | 347 |
| 10% - 20% | 5 | 283 | 334 |
| 10% - 20% | 11 | 251 | 301 |

## The counts file, silent errors

### The whole is the segments added up

| week | chat | email | phone | (none) | whole: out | whole: silent |
|---|---|---|---|---|---|---|
| 2026-W36 | 20, 0 | 20, 0 | 3, 0 | | 43 | 0 |
| 2026-W37 | 20, 0 | 20, 0 | 3, 0 | | 43 | 0 |
| 2026-W38 | 20, 0 | 20, 0 | 3, 0 | | 43 | 0 |
| 2026-W39 | 20, 1 | 20, 0 | 3, 0 | | 43 | 1 |
| 2026-W40 | 20, 2 | 20, 0 | 3, 0 | 2, 0 | 45 | 2 |
| 2026-W41 | 20, 2 | 20, 0 | 3, 0 | | 43 | 2 |
| 2026-W42 | 20, 3 | 20, 0 | 3, 0 | | 43 | 3 |

The W40 row with an empty segment cell is the segment **"(none)"** (never dropped). Four segments:
chat, email, phone, (none).

### The CUSUMs (a silent error +53 steps, a right record -2)

From 2.5% to 5%, as in the monitor fixture: up = 53, down = 2. A week of y silent errors in n
records adds 53y - 2(n - y) = 55y - 2n; S never ends a week below 0.

**The whole** (43 records a week, 45 in W40; median 43): 0 errors -86, so 0; W39: 55 - 86 = -31,
so 0; W40: 110 - 90 = **20**; W41: 20 + 110 - 86 = **44**; W42: 44 + 165 - 86 = **123**. Level
for 43 records set for 4,000: 200. 123 < 200: **in control** (62%). Without segments its level
would be 152 (set for 2,000), and 123 < 152 too: the whole alone never alarms.

**chat** (20 a week): 0 errors -40, so 0 until W38; W39: 55 - 40 = **15**; W40: 15 + 110 - 40 =
**85**; W41: 85 + 70 = **155**; W42: 155 + 165 - 40 = **280**. Level for 20 records set for 4,000:
226. W41: 155 < 226; W42: 280 >= 226: **ALARM since 2026-W42**. S last stood at 0 at the end of
W38, so **the rise likely started in 2026-W39**. The rise is in chat alone, and the whole hides it.

**email** (20 a week, no silent error): S = 0 every week. **phone** (3 a week, none): 0.
**(none)** (2 records in W40, none): 0.

### Shown under 5%? One family: the whole and the four segments

With segments, the whole's bound and the segments' are one family, by closed testing on a weighted
average of their evidence E: the whole weighted 1/2, the four segments 1/8 each. One 5% covers every
"shown". With shortfalls below 20 (20 - E, or 0 when E is 20 or more), the bars are:

    the whole:     20 + (the four segments' shortfalls added up) / 4         (20 to 40)
    a segment k:   20 + 4 x (the whole's shortfall) + (the other three segments' shortfalls)

With no silent error, E after F right records at a 5% target is (monitor fixture):

    E = (1 - 0.95^(F+1)) / (0.05 (F+1) 0.95^F)

| F | 0.95^F | 0.95^(F+1) | E |
|---|---|---|---|
| 2 | 0.902500 | 0.857375 | 0.142625 / 0.135375 = 1.0536 |
| 15 | 0.463291 | 0.440127 | 0.559873 / 0.370633 = 1.5106 |
| 18 | 0.397214 | 0.377354 | 0.622646 / 0.377354 = 1.6500 |
| 21 | 0.340562 | 0.323534 | 0.676466 / 0.374618 = 1.8058 |
| 80 | 0.016515 | 0.015690 | 0.984310 / 0.066887 = 14.716 |
| 100 | 0.005921 | 0.005625 | 0.994375 / 0.029899 = 33.258 |
| 120 | 0.002122 | 0.002016 | 0.997984 / 0.012841 = 77.720 |
| 129 | 0.001338 | 0.001271 | 0.998729 / 0.008695 = 114.87 |
| 140 | 0.000761 | 0.000723 | 0.999277 / 0.005364 = 186.29 |

(E for email at 100, 120 and 140 records; phone at 15, 18 and 21; (none) at 2; the whole at 129, W38.)
A segment with no record yet has E = 1 ((none) before W40). chat's E with silent errors, and the
whole's from W39 on, are the closed-form sum (the monitor fixture's test checks it against the
integral): chat 1.7519, 3.3324, 6.8053, 3.2575, 1.0628, 0.5733, 0.2908 by week; the whole 3.6935,
18.7173, 114.87, 86.524, 25.447, 12.223, 3.7922.

- **The whole, W38** (129 records, none wrong: E = 114.87). Shortfalls: chat and email 20 - 6.8053 =
  13.1947 each, phone 20 - 1.2733 = 18.7267, (none) 20 - 1 = 19. Bar: 20 + 64.1161 / 4 = **36.03**.
  114.87 >= 36.03: **shown**. (Any bar is at most 40, so it is shown whatever the segments' E.)
- **The whole** is shown in W38 and W39 (E 114.87 and 86.52 against bars 36.03 and 34.91), not from
  W40 on (25.45 against 34.09; 12.22 against 34.18; 3.79 against 34.21). Without segments its bar
  would be 20, and W40 (25.45) would have shown it too: counting the segments costs it that week.
- **email, W40** (100 records, E = 33.26). Its bar is at least 20 + (20 - 1.0536) + (20 - 1.5106) =
  **57.44** ((none) and phone alone), whatever chat's and the whole's E: 33.26 is short. **Not
  shown**. (On its own, at a bar of 20, it would have been: the trap L24 guards against.)
- **email, W42** (140 records, E = 186.29). Its bar is at most 20 + 4 x 20 + 3 x 20 = **160**,
  whatever the others' E: **shown since 2026-W42**. Exactly: 20 + 4 x (20 - 3.7922) + (20 - 0.2908) +
  (20 - 1.8058) + (20 - 1.0536) = **141.68**.
- **email, W41** (120 records, E = 77.72): its bar is 20 + 4 x (20 - 12.2231) + (20 - 0.5733) +
  (20 - 1.6500) + (20 - 1.0536) = **107.83**: not shown.
- **chat**: 8 silent errors in 140 records, 5.7%, above the target. For every rate q under 5%,
  (q / 0.05)^8 ((1 - q) / 0.95)^132 is at most 1 (the likelihood rises up to the rate seen, 5.7%,
  and is 1 at q = 5%), so E <= 1: **never shown** (0.2908).
- **phone** (21 records) and **(none)** (2): with no silent error, even a bar of 20 needs 88
  records (monitor fixture: 87 give 19.49, 88 give 20.30). Both are **too few to show anything**;
  the report gives the records their own bar would need: 131 each (bars 123.49 and 122.73).

The family here is the segments in the periods given, so every "shown" is **provisional**: a segment
that first appeared in W43 would join it and change these bars. With `--segments chat,email,phone`
the family is fixed before W36: chat, email, phone, (other) and (none), 5 in all, (other) with no
record (E = 1 throughout). Then the whole's bars are 38.68, 38.03, 36.62, 35.73, 35.07, 35.14, 35.17
(shown in W38 and W39), and email is shown in W42 (bar 176.89), from the same closed forms (as
`monitor --segment-by segment --segments chat,email,phone` prints them). What is printed then never
changes: the test checks it on run files, with three weeks and then four.

The upper bound printed for a segment is the lowest rate its bar rules out, for its last week only
(email: 4.8%). It holds for that segment on its own; only "shown" is counted across segments.

## A segment column, without --segment-by (`segment-column.csv`)

Five weeks labelled "pilot" in a `segment` column, one row a week. Without `--segment-by` the
column is not read, as fcc235f read it: the whole alone, 30, 30, 30, 30, 35 records with 0, 0, 0, 3, 3
silent errors. S: 0, 0, 0, 159 - 54 = **105**, 105 + 159 - 64 = **200**. Level for 30 records set
for 2,000: 156. W40: 200 >= 156: **ALARM since 2026-W40** (128.2%), and `--fail-on-alarm` exits 3.

## The counts file, silent omissions (the share wrongly left out)

The rate here is of the records blocked or suppressed: of them, the share that should have gone out
or to a person. It is not score's silent omission rate, whose base is the records that should have
been seen (in the run files, W40: monitor 1 of 3, score 1 of 6).

blocked_or_suppressed and silent_omissions: chat 5 a week (one omission, W38), email 5 a week
(0, 0, 0, 2, 2, 3, 3), phone 1 a week (none), (none) nothing left out. The whole: 11 a week, with
0, 0, 1, 2, 2, 3, 3.

From 10% to 20%: a silent omission is ln(0.2 / 0.1) = ln 2 = 0.693147 for a rise; a right one
ln(0.9 / 0.8) = 0.117783 against. down: 50 x 0.117783 / 0.693147 = 8.50, so **9**; up =
round(9 x 0.693147 / 0.117783) = round(52.96) = **53**. A week of y in n adds 53y - 9(n - y).

- **The whole** (11): 0 -> -99; 1 -> 53 - 90 = -37; 2 -> 106 - 81 = 25; 3 -> 159 - 72 = 87.
  S: 0, 0, 0, **25**, **50**, **137**, **224**. Level for 11 set for 4,000: 301: **in control**
  (and under 251, its level alone, too).
- **email** (5): 2 -> 106 - 27 = 79; 3 -> 159 - 18 = 141. S: 0, 0, 0, **79**, **158**, **299**,
  **440**. Level for 5 set for 4,000: 334. W41 299 < 334; W42 440 >= 334: **ALARM since 2026-W42**,
  the rise from **2026-W39** (S at 0 at the end of W38).
- **chat**: W38 53 - 36 = 17, W39 17 - 45 -> 0: in control. **phone**: 0.
- **(none)** has no record blocked or suppressed in any week: it has no row in this series, and
  the report names it.

Read as a counts file without segments (11 a week, the same omissions), the whole's level is 251
(set for 2,000) and S ends at 224: in control.

## The run files

| record | channel | went | correct route | value | silent errors series | silent omissions series |
|---|---|---|---|---|---|---|
| W40-1 | chat | SEND (out) | SEND | right | out, right | not in it |
| W40-2 | chat | SEND | SEND | refund for billing | **silent error** | not in it |
| W40-3 | email | SEND | SEND | right | out, right | not in it |
| W40-4 | email | FILE (blocked) | FILE | right | not in it | left out, right |
| W40-5 | email | FILE | SEND | right | not in it | **silent omission** (SO-FALSE-BLOCK) |
| W40-6 | (none) | SEND | SEND | right | out, right | not in it |
| W40-7 | chat | ASK (a person) | ASK | right | not in it | not in it |
| W40-8 | chat | DUPLICATE (suppressed) | DUPLICATE | right | not in it | left out, right |
| W41-1 | chat | SEND | SEND | right | out, right | not in it |
| W41-2 | email | SEND | SEND | right | out, right | not in it |
| W41-3 | email | FILE | FILE | right | not in it | left out, right |
| W41-4 | chat | DUPLICATE | SEND | right | not in it | **silent omission** (SO-FALSE-DUPLICATE) |
| W41-5 | chat | ASK | SEND | right | not in it | not in it |
| W41-6 | (none) | FILE | ASK | right | not in it | **silent omission** (SO-FALSE-BLOCK) |
| W42-1 | chat | SEND | ASK | right | **silent error** (SP-SHOULD-REVIEW) | not in it |
| W42-2 | chat | SEND | SEND | right | out, right | not in it |
| W42-3 | email | SEND | SEND | shipping for billing | **silent error** | not in it |
| W42-4 | email | FILE | SEND | right | not in it | **silent omission** |
| W42-5 | email | FILE | FILE | right | not in it | left out, right |
| W42-6 | chat | FILE | FILE | right | not in it | left out, right |
| W42-7 | email | ASK | ASK | right | not in it | not in it |

**Silent errors** (+53 / -2): the whole 1 of 4, 0 of 2, 2 of 3. S: 53 - 6 = **47**; 47 - 4 =
**43**; 43 + 106 - 2 = **147**. Without segments, levels 203 (4 records), 205 (median of 4 and 2
is 3), 205: in control. By channel: chat 1 of 2, 0 of 1, 1 of 2: 53 - 2 = **51**, 51 - 2 = **49**,
49 + 53 - 2 = **100** (level 253, for 2 a week set for 4,000); email 0 of 1, 0 of 1, 1 of 1: **0, 0,
53**; (none) 0 of 1 in W40 only. The records not out without review, 4 a week, are in the L17 note.

**Silent omissions** (+53 / -9): the whole 1 of 3, 2 of 3, 1 of 3: 53 - 18 = **35**; 35 + 106 - 9 =
**132**; 132 + 53 - 18 = **167** (level 297 for 3 a week, set for 2,000: in control, 56%). Not
blocked or suppressed: W40 5 (W40-1, 2, 3, 6, 7), W41 3 (W41-1, 2, 5), W42 4 (W42-1, 2, 3, 7): **12**,
in the L17 note. By channel: chat 0 of 1, 1 of 1, 0 of 1: **0, 53, 44**; email 1 of 2, 0 of 1, 1 of
2: 53 - 9 = **44**, 44 - 9 = **35**, 35 + 53 - 9 = **79**; (none) 1 of 1 in W41: 53.
