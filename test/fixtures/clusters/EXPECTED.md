# Clusters fixture: hand-worked answers

Fifteen news articles tagged by a workflow: publish on its own (PUBLISH, auto) or send to an
editor (REVIEW, review). One set output, `SUBJECT`. The answer key's `story` says which story
each article retells: articles A, B, C, D and E are five stories, and N13 has no `story`. No
correct route in the key, so a record needed a person if its values differ from the key
(`wrong_when` `any_mismatch`).

Three runs of the same articles, all scored with `--cluster-by story` (or, in the config,
`"clusters": { "field": "story" }`):

- `predictions.json`: three silent errors, all in story A. Retellings of one story share their
  wording, so a mistake on one tends to repeat on the others.
- `predictions-even.json`: three silent errors, one each in stories A, B and D.
- `predictions-perfect.json`: no silent errors (N8, sent to an editor, has a wrong value: a
  mistake someone saw).

Built for two things: the likely range when records come in clusters (traps G14-G17), and the
silent error rate weighted to a real mix of traffic (G18-G21, [at the end](#weighted-to-a-real-mix-g18-g21)),
which uses one more key field, `section`: business (N1-N8) or general (N9-N15).

## Why clusters change the range

The headline range (Wilson) assumes each record is a separate piece of evidence. Ten reviews of
one restaurant by the same person are one opinion, not ten. Three retellings of story A tagged
wrong for the same reason are closer to one mistake seen three times than to three independent
mistakes, so a range that counts them as three is too narrow.

The arithmetic is the standard survey-sampling one for a rate (a ratio) when records come in
clusters (Kish 1965; Miller 2024, "Adding Error Bars to Evals", arXiv 2411.00640, Eq. 4). Over
the clusters that have records out without review, with y_c a cluster's silent errors, n_c its
records out without review, C the number of such clusters, n = sum of n_c, and p = sum of y_c / n:

- **Clustered variance:** var_c = C/(C-1) x sum over clusters of (y_c - p x n_c)^2 / n^2
- **Simple variance** (as if every record were independent): var_srs = p(1 - p) / n
- **Design effect:** deff = var_c / var_srs, never below 1
- **Effective records:** n_eff = n / deff
- **Range:** Wilson at rate p over n_eff records (z = 1.96). n_eff need not be a whole number.

When p is 0 or 1, or there is one cluster, the data cannot show how much a cluster's records go
together: var_c and var_srs are both 0 (or there is no spread between clusters to measure). Then
n_eff = C, each cluster counted as one record: the cautious choice.

Only records out without review count, and a cluster counts in C only if it has one. A record
with no `story` is a cluster of its own.

## The records

| id | story | key SUBJECT | predictions | even | perfect |
|---|---|---|---|---|---|
| N1 | A | merger | PUBLISH, **+antitrust** | PUBLISH | PUBLISH |
| N2 | A | merger | PUBLISH, **+antitrust** | PUBLISH | PUBLISH |
| N3 | A | merger | PUBLISH, **+antitrust** | PUBLISH | PUBLISH |
| N4 | A | merger | PUBLISH | PUBLISH, **+antitrust** | PUBLISH |
| N5 | B | earnings | PUBLISH | PUBLISH, **+layoffs** | PUBLISH |
| N6 | B | earnings | PUBLISH | PUBLISH | PUBLISH |
| N7 | B | earnings | PUBLISH | PUBLISH | PUBLISH |
| N8 | B | earnings | REVIEW | REVIEW | REVIEW, +layoffs |
| N9 | C | court | PUBLISH | PUBLISH | PUBLISH |
| N10 | C | court | PUBLISH | PUBLISH | PUBLISH |
| N11 | D | weather | PUBLISH | PUBLISH, **+travel** | PUBLISH |
| N12 | D | weather | PUBLISH | PUBLISH | PUBLISH |
| N13 | (none) | sports | PUBLISH | PUBLISH | PUBLISH |
| N14 | E | court | REVIEW | REVIEW | REVIEW |
| N15 | E | court | REVIEW | REVIEW | REVIEW |

"+antitrust": the value applied on top of the right one, which the key does not list (SP-WRONG).
In bold: a silent error. Every run sends the same 12 records out without review (all but N8, N14
and N15), so n = 12 in each.

The clusters with records out without review:

| cluster | records out without review | n_c |
|---|---|---|
| A | N1 N2 N3 N4 | 4 |
| B | N5 N6 N7 (N8 went to an editor) | 3 |
| C | N9 N10 | 2 |
| D | N11 N12 | 2 |
| N13 | N13 (no story: a cluster of its own) | 1 |
| | | 12 |

Story E's two articles both went to an editor: E has no records out, so it is not one of the
clusters counted. **C = 5**, and **1** record out without review had no story.

## predictions.json: errors in one story

Silent errors N1 N2 N3: 3 of 12, p = 0.25. The headline is unchanged: **25.0%, 3 of 12, likely
8.9-53.2%** (Wilson: 1 + 3.8416/12 = 1.320133; center (0.25 + 0.160067) / 1.320133 = 0.310625;
half 1.96 x sqrt(0.015625 + 0.006669) / 1.320133 = 0.221685; 0.088940 to 0.532310).

| cluster | n_c | y_c | p x n_c | y_c - p x n_c | squared |
|---|---|---|---|---|---|
| A | 4 | 3 | 1.00 | 2.00 | 4.0000 |
| B | 3 | 0 | 0.75 | -0.75 | 0.5625 |
| C | 2 | 0 | 0.50 | -0.50 | 0.2500 |
| D | 2 | 0 | 0.50 | -0.50 | 0.2500 |
| N13 | 1 | 0 | 0.25 | -0.25 | 0.0625 |
| sum | 12 | 3 | 3.00 | 0.00 | **5.1250** |

(The fifth column always sums to 0: p is the share over all clusters together.)

- var_c = 5/4 x 5.125 / 12^2 = 6.40625 / 144 = **0.044488**
- var_srs = 0.25 x 0.75 / 12 = **0.015625**
- deff = 0.044488 / 0.015625 = 6.40625 / 2.25 = **2.847222** (above 1, kept)
- n_eff = 12 / 2.847222 = **4.214634** records' worth

Wilson at p = 0.25 over 4.214634 records:

- z^2 / n_eff = 3.8416 / 4.214634 = 0.911491; 1 + that = 1.911491
- center = (0.25 + 0.911491 / 2) / 1.911491 = 0.705745 / 1.911491 = 0.369212
- p(1 - p) / n_eff = 0.1875 / 4.214634 = 0.044488 (var_c itself, as it must be)
- z^2 / (4 n_eff^2) = 0.911491 / (4 x 4.214634) = 0.054067
- half = 1.96 x sqrt(0.044488 + 0.054067) / 1.911491 = 1.96 x 0.313934 / 1.911491 = 0.321901
- range 0.369212 - 0.321901 = 0.047311 to 0.369212 + 0.321901 = 0.691113: **4.7-69.1%**

Counting clusters, the range reaches 69.1%, not 53.2%. The terminal line:

    Records out without review came from 5 clusters (answer key field "story"); counting clusters, the likely range is 4.7-69.1% (design effect 2.8: about 4 independent records' worth). 1 record had no value there and is a cluster of its own.

## predictions-even.json: errors spread across stories

Silent errors N4 (A), N5 (B), N11 (D): still 3 of 12, p = 0.25, headline 8.9-53.2%.

| cluster | n_c | y_c | p x n_c | y_c - p x n_c | squared |
|---|---|---|---|---|---|
| A | 4 | 1 | 1.00 | 0.00 | 0.0000 |
| B | 3 | 1 | 0.75 | 0.25 | 0.0625 |
| C | 2 | 0 | 0.50 | -0.50 | 0.2500 |
| D | 2 | 1 | 0.50 | 0.50 | 0.2500 |
| N13 | 1 | 0 | 0.25 | -0.25 | 0.0625 |
| sum | 12 | 3 | 3.00 | 0.00 | **0.6250** |

- var_c = 5/4 x 0.625 / 144 = 0.78125 / 144 = **0.005425**
- deff = 0.005425 / 0.015625 = 0.78125 / 2.25 = 0.347222, **floored at 1**: the clusters vary
  less than independent records would, and the range never claims more evidence than the
  records themselves.
- n_eff = 12. The range is the headline's: **8.9-53.2%**. Clustering changes nothing.

## predictions-perfect.json: no silent errors (the fallback)

0 of 12, p = 0. Headline: **0.0-24.3%** (3.8416 / (12 + 3.8416) = 0.242501).

Every y_c - p x n_c is 0, and so is p(1 - p): the design effect is 0 / 0. With no errors, nothing
shows whether errors would clump, so the range assumes the worst: every cluster's records go
together, and each cluster is one record's worth. n_eff = C = **5**, method "cluster_count":

- 0 of 5: high = 3.8416 / (5 + 3.8416) = 0.434491: **0.0-43.4%**, against 0.0-24.3% counting
  every record.

## Every record a cluster of its own

With `"from": "predictions"`, the field is read from the predictions file only, which has no
`story`: every record out without review is a cluster of its own. C = 12, and 12 records had no
value. p = 0.25: three clusters (N1 N2 N3) with residual 0.75 (squared 0.5625), nine with -0.25
(0.0625): sum 3 x 0.5625 + 9 x 0.0625 = 2.25.

- var_c = 12/11 x 2.25 / 144 = 0.017045
- deff = 0.017045 / 0.015625 = 12/11 = **1.090909**; n_eff = **11**
- Wilson at 0.25 over 11: 1 + 3.8416/11 = 1.349236; center (0.25 + 0.174618) / 1.349236 = 0.314710;
  half 1.96 x sqrt(0.017045 + 0.007937) / 1.349236 = 0.229608; **8.5-54.4%**

With every cluster a single record, var_c = p(1 - p) / (n - 1): the C/(C-1) factor is the usual
small-sample correction, and here it costs one record. Miller's Eq. 4 gives the same value in this
case, since its plain standard error divides by n - 1 too.

## Weighted to a real mix (G18-G21)

A golden set built from traps holds far more hard records than real traffic: this one is half
business news (8 of 15), where every mistake is. Its 25.0% is a stress-test rate. A driving test
taken mostly on icy roads says little about a sunny commute until each kind of road is weighted
by how often it is icy. `--mix` does that weighting: stratified estimation, as the combined
ratio estimate (Cochran 1977, ch. 5-6), since the rate is a ratio of two counts.

The answer key's `section` puts every record in exactly one group (a stratum). Scored on
`predictions.json` with `--group-by section --mix <file>`:

| section | records | N_h | out without review | a_h | silent errors | s_h |
|---|---|---|---|---|---|---|
| business | N1-N8 | 8 | N1-N7 (N8 went to an editor) | 7 | N1 N2 N3 | 3 |
| general | N9-N15 | 7 | N9-N13 (N14 N15 went to an editor) | 5 | none | 0 |

The golden set's own numbers: silent error rate 3 of 12 = **25.0%** (8.9-53.2%, above);
straight-through 12 of 15 = **80.0%**.

With W_h each group's share of real traffic, divided by the shares' total so they add up to 1:

- **Silent errors per record, on the mix:** sum of W_h x s_h / N_h
- **Records out without review per record, on the mix** (the weighted straight-through): sum of
  W_h x a_h / N_h
- **Weighted silent error rate:** R = the first divided by the second
- **Weights:** each record out without review in group h stands for w = W_h / N_h of the mix
- **Effective records** (Kish 1965, for unequal weights): n_eff = (sum of w)^2 / sum of w^2, over
  the records out without review
- **Range:** Wilson at R over n_eff records (z = 1.96), as for the clusters above

### mix.json: business 10%, general 90%

`{ "group": "section", "shares": { "business": 0.1, "general": 0.9 } }`. The shares add up to 1.

- Silent errors per record: 0.1 x 3/8 + 0.9 x 0/7 = 0.1 x 0.375 = **0.0375**
- Out without review per record: 0.1 x 7/8 + 0.9 x 5/7 = 0.0875 + 0.642857 = **0.730357**
- R = 0.0375 / 0.730357 = **0.051345**: **5.1%**, against 25.0% on the golden set

The general group has no silent errors, and real traffic is 90% general, so the rate falls to a
fifth. How sure is that? The weights:

| group | records out | w = W_h / N_h | w^2 | sum of w | sum of w^2 |
|---|---|---|---|---|---|
| business | 7 | 0.1 / 8 = 0.0125 | 0.00015625 | 0.0875 | 0.001094 |
| general | 5 | 0.9 / 7 = 0.128571 | 0.016531 | 0.642857 | 0.082653 |
| | 12 | | | **0.730357** | **0.083747** |

(The sum of w is the weighted straight-through, as it must be.)

- n_eff = 0.730357^2 / 0.083747 = 0.533422 / 0.083747 = **6.369455** records' worth. Twelve
  records went out, but the five general ones carry 88% of the weight (0.642857 of 0.730357).

Wilson at R = 0.051345 over 6.369455 records:

- z^2 / n_eff = 3.8416 / 6.369455 = 0.603129; 1 + that = 1.603129
- center = (0.051345 + 0.603129 / 2) / 1.603129 = 0.352909 / 1.603129 = 0.220138
- p(1 - p) / n_eff = 0.051345 x 0.948655 / 6.369455 = 0.007647
- z^2 / (4 n_eff^2) = 0.603129 / (4 x 6.369455) = 0.023673
- half = 1.96 x sqrt(0.007647 + 0.023673) / 1.603129 = 1.96 x 0.176974 / 1.603129 = 0.216370
- range 0.220138 - 0.216370 = 0.003767 to 0.220138 + 0.216370 = 0.436508: **0.4-43.7%**

The rate moves from 25.0% to about 5.1%, and the range stays wide: five general records out
without review cannot pin down the rate of 90% of the traffic.

**The weighted straight-through**, 0.730357: **73.0%**, against 80.0%. Its range counts every
record, each weighing W_h / N_h, so n_eff = 1 / (sum of W_h^2 / N_h) = 1 / (0.01/8 + 0.81/7)
= 1 / (0.00125 + 0.115714) = 1 / 0.116964 = **8.549618**. Wilson at 0.730357 over 8.549618:
z^2/n = 0.449330; center 0.955022 / 1.449330 = 0.658940; half 1.96 x sqrt(0.023034 + 0.013139)
/ 1.449330 = 0.257207; **40.2-91.6%**.

The terminal lines, under the headline:

    On the real mix in test/fixtures/clusters/mix.json (business 10%, general 90%), the silent error rate would be about 5.1% (likely 0.4-43.7%; about 6 records' worth), against 25.0% on this golden set. A reweighting, not a measurement: it is only as good as the shares, and as the records tested in each group.
    On that mix, about 73.0% of records would go out without review (likely 40.2-91.6%; about 9 records' worth), against 80.0% on this golden set.

### mix-golden.json: the golden set's own mix, as counts

`{ "group": "section", "shares": { "business": 8, "general": 7 } }`: counts, not shares. Divided
by their total, 15: W = 8/15 and 7/15. Every record then weighs the same, (8/15) / 8 = (7/15) / 7
= 1/15, so the mix is the golden set itself:

- R = (3/15) / (12/15) = **0.25**; n_eff = (12/15)^2 / (12 x (1/15)^2) = **12**; range
  **8.9-53.2%**: the headline's, exactly
- straight-through 12/15 = **80.0%**; n_eff = 1 / (8 x (1/15)^2 + 7 x (1/15)^2) = **15**; range
  Wilson 12 of 15: center 0.928053 / 1.256107 = 0.738833, half 0.190693, **54.8-93.0%**

A check on the method: weighted by the golden set's own shares, it changes nothing.

### Only general: a rate of 0

`{ "business": 0, "general": 1 }`. A share of 0 is allowed: real traffic has no business news,
so its records weigh nothing. R = 0 / (5/7) = **0**, n_eff = (5 x 1/7)^2 / (5 x (1/7)^2) = **5**
(the five general records out, all weighing the same), and Wilson at 0 over 5 reaches
3.8416 / (5 + 3.8416) = 0.434491: **0.0-43.4%**. The range works at a rate of 0. Straight-through
5/7 = 71.4%, n_eff 7.

### mix-story.json: a group with no records out, and "(none)"

With `--group-by story`, N13 has no story and is grouped as "(none)"; the file gives it a share.
Every story gets the same share (1 each, so 1/6 after dividing by 6):

| story | N_h | a_h | s_h | W x a_h / N_h | W x s_h / N_h | w per record out |
|---|---|---|---|---|---|---|
| A | 4 | 4 | 3 | 1/6 | 1/8 | 1/24 |
| B | 4 | 3 | 0 | 1/8 | 0 | 1/24 |
| C | 2 | 2 | 0 | 1/6 | 0 | 1/12 |
| D | 2 | 2 | 0 | 1/6 | 0 | 1/12 |
| E | 2 | 0 | 0 | 0 | 0 | (none out) |
| (none) | 1 | 1 | 0 | 1/6 | 0 | 1/6 |
| sum | | 12 | 3 | **19/24 = 0.791667** | **1/8 = 0.125** | |

- R = 0.125 / 0.791667 = 3/19 = **0.157895**: **15.8%**
- sum of w^2 = 4/576 + 3/576 + 2/144 + 2/144 + 1/36 = (4 + 3 + 8 + 8 + 16) / 576 = 39/576
- n_eff = (19/24)^2 / (39/576) = 361/39 = **9.256410**
- Wilson: z^2/n = 0.415020; center 0.365405 / 1.415020 = 0.258233; half 1.96 x
  sqrt(0.014365 + 0.011209) / 1.415020 = 0.221508; **3.7-48.0%**
- straight-through 19/24 = **79.2%**; n_eff = 1 / (1/36 x (1/4 + 1/4 + 1/2 + 1/2 + 1/2 + 1)) =
  36 / 3 = **12**; **50.9-93.3%**

Story E has a share (16.7%) and sent none of its 2 records out without review, so it lowers the
straight-through on the mix and adds nothing to the silent error rate: the report says so in a
note.

### What stops (G18-G21)

Each record must sit in exactly one group, and every group must have a share:

- **A group in the run with no share (G19).** `{ "business": 1 }` alone: general has records
  here and no share. The report cannot guess the weight of a kind of record. With `--group-by
  story` and no "(none)" share, N13 is in no group: the stop names it.
- **A share for a group the run does not have (G20).** `{ "business": 1, "general": 8, "opinion": 1 }`:
  no record here is opinion. Its records were never tested, so nothing can be said about them.
  The stop names "opinion".
- **A record in two groups (G21).** The queue fixture's Q10 came in by chat and by email: it
  stops there ([queue EXPECTED.md](../queue/EXPECTED.md#weighted-to-a-real-mix-stops-g19-g21)).
- **Shares that cannot be weights, or an unknown group (G18).** Text (`"0.9"`), a negative
  number, all zero; or a group that is not in the config's `groups` or `--group-by`.
