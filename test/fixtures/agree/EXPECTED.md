# Agreement among graders: worked by hand

Three people made answer keys for the same five records (`ann.json`, `ben.json`, `cai.json`,
config `config.json`). Ann labelled all five, Ben r1-r4, Cai r1-r3. A fourth file,
`grades-c.json`, is a third reviewer's grades of the free-text fixture
(`../freetext/forms.json`), beside that fixture's `grades-a.json` and `grades-b.json`.

Every number below is Krippendorff's alpha worked by the steps in Krippendorff (2011),
"Computing Krippendorff's Alpha-Reliability" (docs/METRICS.md has the formulas):

- A record labelled by two or more graders is a unit. r5 (Ann only) has no one to agree with:
  it is left out and listed (trap M5). So every output compares 4 records: 3 + 3 + 3 + 2 = **11**
  values that can be paired (n).
- In a unit of m values, each ordered pair of two graders' values adds 1 / (m - 1) to the
  coincidence o(c, k). A unit of 3 adds 1/2 per ordered pair; a unit of 2 adds 1.
- n_c is the row total of o for value c. D_o = sum o(c,k) delta(c,k) / n,
  D_e = sum n_c n_k delta(c,k) / (n (n - 1)), alpha = 1 - D_o / D_e.

## verdict (label: nominal, delta 1 when different)

| record | ann | ben | cai |
|---|---|---|---|
| r1 | pass | pass | pass |
| r2 | pass | pass | fail |
| r3 | fail | fail | fail |
| r4 | pass | fail | |

- r1: 6 ordered pass-pass pairs x 1/2: o(pass, pass) += 3.
- r2: pass, pass, fail: 2 pass-pass pairs x 1/2 = 1; 2 pass-fail pairs x 1/2 = 1, and 1 fail-pass.
- r3: o(fail, fail) += 3.
- r4 (m = 2): o(pass, fail) += 1, o(fail, pass) += 1.
- o(pass, pass) = 4, o(fail, fail) = 3, o(pass, fail) = o(fail, pass) = 2. n_pass = 6, n_fail = 5, n = 11.
- D_o = (2 + 2) / 11 = **4/11 = 0.364**. D_e = 2 x 6 x 5 / (11 x 10) = **6/11 = 0.545**.
- **alpha = 1 - 4/6 = 1/3 = 0.333**: below 0.667, "do not rely on it".
- Raw agreement: (4 + 3) / 11 = 63.6% of pairable pairs are the same value.

Each pair of graders, on the records both labelled:

- ann-ben (r1-r4: pass/pass, pass/pass, fail/fail, pass/fail): o(pass,pass) = 4, o(fail,fail) = 2,
  o(pass,fail) = o(fail,pass) = 1; n_pass = 5, n_fail = 3, n = 8. D_o = 2/8, D_e = 2 x 15 / 56 = 30/56.
  alpha = 1 - (2/8)(56/30) = 1 - 14/30 = **0.533**.
- ann-cai (r1-r3: pass/pass, pass/fail, fail/fail): n_pass = 3, n_fail = 3, n = 6. D_o = 2/6,
  D_e = 2 x 9 / 30 = 0.6. alpha = 1 - (1/3)/0.6 = **0.444**.
- ben-cai: the same three pairs: **0.444**.

To settle: **r2** (ann pass, ben pass, cai fail) and **r4** (ann pass, ben fail).

## band (ordinal: low < medium < high)

| record | ann | ben | cai |
|---|---|---|---|
| r1 | high | high | medium |
| r2 | low | low | low |
| r3 | medium | high | high |
| r4 | low | medium | |

- r1: o(high, high) += 1, o(high, medium) += 1, o(medium, high) += 1.
- r2: o(low, low) += 3.
- r3: o(high, high) += 1, o(medium, high) += 1, o(high, medium) += 1.
- r4: o(low, medium) += 1, o(medium, low) += 1.
- n_low = 3 + 1 = 4, n_medium = 1 + 2 = 3, n_high = 2 + 2 = 4; n = 11.
- Ordinal delta (sum of n_g from c to k, minus (n_c + n_k) / 2, squared):
  delta(low, medium) = (4 + 3 - 3.5)^2 = 12.25; delta(medium, high) = (3 + 4 - 3.5)^2 = 12.25;
  delta(low, high) = (4 + 3 + 4 - 4)^2 = 49.
- Observed: sum o delta = 2 x 1 x 12.25 + 2 x 2 x 12.25 = 73.5.
- Expected: sum n_c n_k delta = 2 x (4 x 3 x 12.25 + 3 x 4 x 12.25 + 4 x 4 x 49) = 2156.
- **alpha = 1 - (n - 1) x 73.5 / 2156 = 1 - 735/2156 = 0.659**: just under 0.667.

## codes (set: Jaccard distance; MASI beside it)

| record | ann | ben | cai |
|---|---|---|---|
| r1 | c1 | c1 | c1, c2 |
| r2 | (none) | (none) | (none) |
| r3 | c2, c3 | c3, c2 | c2, c3 |
| r4 | c1 | c3 | |

Ben lists r3 as c3, c2: the same set as c2, c3 (order never matters), so r3 is no disagreement.
Write the sets A = {c1}, B = {c1, c2}, C = {c2, c3}, D = {c3}, E = {} (empty).

- r1: o(A, A) += 1, o(A, B) += 1, o(B, A) += 1. r2: o(E, E) += 3. r3: o(C, C) += 3. r4: o(A, D) += 1, o(D, A) += 1.
- n_A = 3, n_B = 1, n_C = 3, n_D = 1, n_E = 3; n = 11.
- Jaccard distance (1 - shared / either): A-B 1/2; B-C 2/3; C-D 1/2; every other pair 1 (they share nothing, or one is empty).
- Observed: 2 x (1 x 1/2) + 2 x (1 x 1) = 3.
- Expected (each unordered pair n_c n_k delta, doubled): A-B 1.5, A-C 9, A-D 3, A-E 9, B-C 2, B-D 1, B-E 3, C-D 1.5, C-E 9, D-E 3; sum 42, doubled **84**.
- **alpha = 1 - 10 x 3 / 84 = 1 - 30/84 = 0.643**.
- MASI (1 - Jaccard similarity x M; M = 2/3 when one set holds the other, 1/3 when they only overlap):
  A-B 1 - (1/2)(2/3) = 2/3; B-C 1 - (1/3)(1/3) = 8/9; C-D 1 - (1/2)(2/3) = 2/3; the rest 1.
  Observed 2 x 2/3 + 2 x 1 = 10/3. Expected: A-B 2, A-C 9, A-D 3, A-E 9, B-C 8/3, B-D 1, B-E 3, C-D 2,
  C-E 9, D-E 3; sum 131/3, doubled 262/3. **MASI alpha = 1 - 10 x (10/3) / (262/3) = 1 - 100/262 = 0.618**.

To settle: **r1** and **r4**.

## route (the gold route, as its class)

Everyone says publish (class auto), except Cai on r3 (review).

- o(auto, auto) = 3 (r1) + 3 (r2) + 1 (r3) + 2 (r4, m = 2) = 9; o(auto, review) = o(review, auto) = 1.
- n_auto = 10, n_review = 1, n = 11.
- D_o = 2/11; D_e = 2 x 10 x 1 / 110 = 2/11. **alpha = 1 - 1 = 0.000**.
- Raw agreement 9/11 = **81.8%**; auto is 10/11 = **90.9%** of the values: the prevalence paradox
  (trap M14). Chance alone, with one value that common, would agree as often as these graders did.
- Pairs: ann-ben agree on all four records, all auto: D_e = 0, **not measurable** (trap M9);
  ann-cai and ben-cai: 0.000.
- No likely range: every value but one is auto, so each resample either holds the one review or has
  no alpha at all (trap M15).

## The likely range

The range is a BCa range (three graders; with two, Krippendorff's bootstrap) from resampling the records (2,000 resamples, seed 1; docs/METRICS.md), so it is not worked by hand;
the tests check that it is the same on every run, that low <= high, and that the chances below 0.800
and 0.667 are shares between 0 and 1.

Every output here has fewer than 15 values that are not its most common value, so each range
carries the "probably too narrow" note (trap M16): verdict 11 - 6 = 5 (6 pass), band 11 - 4 = 7
(4 low, 4 high), codes 11 - 3 = 8 (three sets used 3 times each). The route has 1 (auto is 10 of 11)
and no range at all (M15), so no note; its prevalence line gives the chance agreement:
(10 x 9 + 1 x 0) / (11 x 10) = 90/110 = 81.8%, the same as the raw agreement, which is why alpha is 0.

## Free-text grades: three reviewers

Reviewer C (`grades-c.json`) is Reviewer A with two grades changed: V1 manage_now faithful (A: missing)
and V3 reason missing (as B). The 15 fields, graded by A, B, C:

- 9 fields faithful by all three; V1 reason and V2 reason invented by all three; V3 independence missing by all three.
- V1 manage_now: missing, missing, faithful. V2 enjoyed: invented, faithful, invented. V3 reason: faithful, missing, missing.

Every field has 3 grades: n = 45.

- o(faithful, faithful) = 9 x 3 = 27; o(invented, invented) = 2 x 3 + 1 (V2 enjoyed) = 7;
  o(missing, missing) = 3 + 1 (V1 manage_now) + 1 (V3 reason) = 5;
  o(faithful, missing) = o(missing, faithful) = 2; o(faithful, invented) = o(invented, faithful) = 1.
- n_faithful = 30, n_invented = 8, n_missing = 7.
- Observed: 2 + 2 + 1 + 1 = 6. Expected: 2 x (30 x 8 + 30 x 7 + 8 x 7) = 1012.
- **alpha = 1 - 44 x 6 / 1012 = 1 - 264/1012 = 187/253 = 0.739**: tentative conclusions only.

Invented or not: invented by all three on V1 reason and V2 reason, two of three on V2 enjoyed.

- o(yes, yes) = 3 + 3 + 1 = 7; o(yes, no) = o(no, yes) = 1; o(no, no) = 12 x 3 = 36. n_yes = 8, n_no = 37.
- **alpha = 1 - 44 x 2 / (2 x 8 x 37) = 1 - 88/592 = 0.851**: reliable.

Each pair (15 fields each, n = 30):

- A-B differ on V2 enjoyed and V3 reason. n_faithful = 20, n_invented = 5, n_missing = 5.
  Expected 2 x (100 + 100 + 25) = 450. **alpha = 1 - 29 x 4 / 450 = 0.742** (kappa for the same two: 0.735, ../freetext/EXPECTED.md).
- A-C differ on V1 manage_now and V3 reason. n_faithful = 20, n_invented = 6, n_missing = 4.
  Expected 2 x (120 + 80 + 24) = 448. **alpha = 1 - 116/448 = 0.741**.
- B-C differ on V1 manage_now and V2 enjoyed: the same counts as A-B, **0.742**.

To settle: V1 manage_now, V2 enjoyed, V3 reason.
