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

Built for one thing: the likely range when records come in clusters (traps G14-G17).

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
