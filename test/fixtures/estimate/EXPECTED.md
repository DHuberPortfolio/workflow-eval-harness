# Estimate fixture: hand-worked answers

22 support tickets, each given one category (refund, billing, shipping, other). `SEND` goes out
without review (route class auto); `HOLD` goes to a person (review). A record needed a person
when its category differs from the answer key's.

There are two answer keys, in the config's own format:

- `judge-key.json`: an AI judge's answer for **every** record. Where it differs from the
  prediction, the judge says "silent error" (it **flags** the record); where it agrees, it
  **passes** it.
- `person-key.json`: a person's answer for the **10** records they checked, picked within each
  verdict group, spread through the run.

| id | went | judge | checked by the person | person |
|---|---|---|---|---|
| E01 | SEND | flags | yes | silent error |
| E02 | SEND | flags | yes | silent error |
| E03 | SEND | flags | no | |
| E04 | SEND | flags | yes | **fine** (the judge was wrong) |
| E05 | SEND | flags | yes | silent error |
| E06 | SEND | passes | no | |
| E07 | SEND | passes | yes | **silent error** (the judge missed it) |
| E08 | SEND | passes | no | |
| E09 | SEND | passes | yes | fine |
| E10 | SEND | passes | no | |
| E11 | SEND | passes | yes | fine |
| E12, E13 | SEND | passes | no | |
| E14 | SEND | passes | yes | fine |
| E15, E16 | SEND | passes | no | |
| E17 | SEND | passes | yes | fine |
| E18, E19 | SEND | passes | no | |
| E20 | SEND | passes | yes | fine |
| E21, E22 | HOLD | | no | |

Records out without review: E01-E20, **20**. The judge flags E01-E05, **5**, and passes **15**.

## For contrast

- **Judge alone**: 5 of 20, **25.0%** (Wilson 11.2-46.9%): what you would report trusting the judge.
- **Person alone**: E01 E02 E05 E07, 4 of 10, **40.0%** (Wilson 16.8-68.7%). Fair only if the 10
  were a random sample of the 20. Their share of judge flags is 4 of 10 against 5 of 20 in the run:
  z = (4 - 10 x 0.25) / sqrt(10 x 0.25 x 0.75) = 1.5 / 1.369 = 1.10, within 1.96, so it is shown.

## The estimate

The share the judge flags, W1 = 5 / 20 = 0.25; it passes W0 = 0.75. In the checks:

- flagged: 4 checked, 3 silent errors: p1 = 3 / 4 = 0.75
- passed: 6 checked, 1 silent error: p0 = 1 / 6 = 0.1667

**Estimate** = W1 x p1 + W0 x p0 = 0.25 x 0.75 + 0.75 x 0.1667 = 0.1875 + 0.125 = **0.3125, 31.3%**.

**Each group's range.** Wilson at z = 1.96 (z² = 3.8416):

- 3 of 4: centre (0.75 + 3.8416 / 8) / (1 + 3.8416 / 4) = 1.2302 / 1.9604 = 0.6275; half-width
  1.96 x sqrt(0.75 x 0.25 / 4 + 3.8416 / 64) / 1.9604 = 1.96 x 0.32696 / 1.9604 = 0.3269.
  So 0.3006 to 0.9544. One record of the 4 is fine (n - x = 1), so the high end is the exact one
  if wider: 0.975^(1/4) = **0.99369** (the rate at which 4 errors in 4 would turn up 2.5% of the
  time). Range **0.3006 to 0.9937**.
- 1 of 6: Wilson 0.0301 to 0.5635. One error (x = 1), so the low end is the exact one if lower:
  1 - 0.975^(1/6) = **0.004211**. Range **0.004211 to 0.5635**.
- The share, 5 of 20: Wilson **0.11186 to 0.46871**.

**MOVER** adds up how far each piece can move, squared:

| piece | estimate | down to | up to | down by | up by |
|---|---|---|---|---|---|
| W1 x p1 | 0.25 x 0.75 = 0.1875 | 0.25 x 0.3006 = 0.07516 | 0.25 x 0.99369 = 0.24842 | 0.11234 | 0.06092 |
| W0 x p0 | 0.75 x 0.1667 = 0.125 | 0.75 x 0.004211 = 0.003158 | 0.75 x 0.5635 = 0.42263 | 0.12184 | 0.29763 |
| the share | 0 | (p1 - p0) x (0.11186 - 0.25) = 0.5833 x -0.13814 = -0.08058 | 0.5833 x 0.21871 = 0.12758 | 0.08058 | 0.12758 |

- low = 0.3125 - sqrt(0.11234² + 0.12184² + 0.08058²) = 0.3125 - sqrt(0.012620 + 0.014845 + 0.006493)
  = 0.3125 - 0.18428 = **0.12822, 12.8%**
- high = 0.3125 + sqrt(0.06092² + 0.29763² + 0.12758²) = 0.3125 + sqrt(0.003712 + 0.088585 + 0.016276)
  = 0.3125 + 0.32950 = **0.64200, 64.2%**

**Worth about 9 records checked by a person alone.** The range is 0.51378 wide. A person's own
Wilson range at 31.25% is that wide from about 9.26 records (Wilson at 0.3125 over 9.26 records:
centre (0.3125 + 3.8416 / 18.52) / (1 + 3.8416 / 9.26) = 0.5199 / 1.4149 = 0.3675, half-width
1.96 x sqrt(0.3125 x 0.6875 / 9.26 + 3.8416 / 343.0) / 1.4149 = 1.96 x 0.18548 / 1.4149 = 0.2569,
twice that 0.5139; 9.26 is rounded). The person checked 10: on this small, noisy run the judge does not narrow the
range at all, which is the honest answer.

## The judge, on the checked records

| | judge: error | judge: fine |
|---|---|---|
| person: error | 3 (E01 E02 E05) | 1 (E07) |
| person: fine | 1 (E04) | 5 |

- Of the person's 4 silent errors, the judge caught 3. Of the 4 judge flags checked, the person confirmed 3.
- Cohen's kappa: observed agreement 8 / 10 = 0.8; by chance 0.4 x 0.4 + 0.6 x 0.6 = 0.52;
  (0.8 - 0.52) / (1 - 0.52) = **0.583**.
- Disagreements: **E04** (judge: silent error, person: fine), **E07** (judge: fine, person: silent error).

## Spread through the run (K7)

Within the 15 passed records (E06-E20, in run order), the checked ones are places 2, 4, 6, 9, 12
and 15: rank sum 48, against 6 x 16 / 2 = 48 for a random pick, z = 0. Within the 5 flagged,
places 1, 2, 4, 5: sum 12, expected 4 x 6 / 2 = 12, z = 0. No warning.

The K7 test checks E06-E11 instead (places 1-6): sum 21, variance 6 x 9 x 16 / 12 = 72,
z = (21 - 48) / 8.485 = **-3.18**, past 2.576: warned, "near the start of the run".

## A group with no checks (K3)

Without E01 E02 E04 E05, no flagged record is checked: no estimate. Bounds: the flagged quarter
at 0% for the low end and 100% for the high, the passed three quarters at their own range:

- low = 0.75 x 0.004211 = **0.0032, 0.3%**
- high = 0.25 + 0.75 x 0.5635 = **0.6726, 67.3%**

## A target (`--target 50`)

The high end, 64.2%, is not under 50%. The estimate, 31.3%, is under it, so more checks could in
principle help, but here they cannot. Checking all 10 records left, with each group's rate held
where it is (3.75 errors in 5 flags, 2.5 in 15 passes, projected with Wilson's ends), leaves
the high end at 54.4%: 20 records out are too few to pin the rate down that far, whichever group
the checks go to. (With whole errors, 4 of 5 and 3 of 15, it is 58.5%.) The report says
"even checking every record out would not show it", and that more records out are needed.

## Picking the checks (`--pick`)

Before anyone checks, only the records out (20) and the judge's flags (5) are known. The plan
tries every split of the checks, at least one in each group, and keeps the one whose range would
be narrowest if the checked flags were half wrong (rounded up from one half) and the checked
passes all right.

**4 checks**: 1, 2 or 3 on the flags. The share's range, 5 of 20, is 0.11186-0.46871 as above.

- **1 flag, 3 passes.** 1 of 1 wrong: p1 = 1, Wilson 0.2065-1; one error (x = 1), so the low end
  is the exact one, 1 - 0.975 = 0.025. 0 of 3 passes: p0 = 0, Wilson 0-0.5615 (3.8416 / 6.8416).
  Estimate 0.25 x 1 = 0.25. Up: flags 0.25 x (1 - 1) = 0, passes 0.75 x 0.5615 = 0.42113, share
  (1 - 0) x (0.46871 - 0.25) = 0.21871; high = 0.25 + sqrt(0 + 0.17735 + 0.04783) = 0.25 + 0.47453
  = **0.72453**. Down: flags 0.25 x (1 - 0.025) = 0.24375, share 0.13814; sqrt(0.05941 + 0.01908)
  = 0.28017, more than 0.25, so the low end is **0**. Width 0.7245.
- **2 flags, 2 passes.** 1 of 2 wrong: p1 = 0.5, high end the exact one (1 record fine):
  0.975^(1/2) = 0.98742. 0 of 2 passes: 2 records fine, so the high end is the exact one,
  1 - 0.025^(1/2) = 0.84189. Estimate 0.125. Up: 0.25 x 0.48742 = 0.12186, 0.75 x 0.84189 =
  0.63142, 0.5 x 0.21871 = 0.10936; high = 0.125 + sqrt(0.01485 + 0.39869 + 0.01196) = 0.125 +
  0.65231 = **0.77731**; low 0. Width 0.7773.
- **3 flags, 1 pass.** 2 of 3 wrong, high end 0.975^(1/3) = 0.99160; 0 of 1 pass, high end
  1 - 0.025 = 0.975. Estimate 0.16667. Up: 0.25 x 0.32493 = 0.08123, 0.75 x 0.975 = 0.73125,
  0.66667 x 0.21871 = 0.14581; high = 0.16667 + sqrt(0.00660 + 0.53473 + 0.02126) = **0.91672**;
  low 0. Width 0.9167.

So 4 checks go **1 on the flags and 3 on the passes**. With 10 checks the same search gives 2 and
8. The records within each group are then chosen by a seeded shuffle; which ones depends on the
seed, so the tests check that the same seed gives the same records, that each group gets its
share, and that the list is in the run's order.

## Plain PPI, for contrast

Plain prediction-powered inference (lambda = 1) takes the judge's share of flags and corrects it by
the checks' average of (person - judge), each 1 for a silent error and 0 for none:

- the judge's share: 5 of 20 = 0.25
- the checks: E04 is 0 - 1 = -1 (the judge flagged it, the person found it fine), E07 is 1 - 0 = +1
  (the judge passed it, the person found an error), the other 8 are 0. Average (-1 + 1) / 10 = 0:
  the two disagreements cancel.
- PPI = 0.25 + 0 = **25.0%**, the judge-alone rate, against the post-stratified 31.3%.

It misses the point that the one flag found wrong is 1 of 4 flags (a quarter of a small group),
while the one pass found wrong is 1 of 6 passes (a sixth of a group three times as big).
Post-stratification weights each check by its group; PPI does not. The test "plain PPI on the
fixture" in `test/estimate.test.js` works this out from the report's own counts.
