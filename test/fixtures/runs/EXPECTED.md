# Three runs of the same workflow: hand-worked answers

The tiny fixture's workflow run three times on the same six records, scored against the
same key (`../tiny/key.json`) and config (`../tiny/config.json`). Nothing changed between
runs except what the model returned, which is how identical code produces different
numbers.

| run | what differs from run a | R2 | R4 |
|---|---|---|---|
| a | (it is `../tiny/predictions.json`) | AUTO_PUBLISH | EDITOR_REVIEW |
| b | R2's subjects came back at 0.84 and 0.80; its lead is below the 0.85 gate | **EDITOR_REVIEW** | EDITOR_REVIEW |
| c | R4's SUBJ-EARN came back at 0.86, clearing the gate | AUTO_PUBLISH | **AUTO_PUBLISH** |

R2 always carries the wrong SUBJ-ANTI and the key wants it reviewed. R4 is always correct
and the key says it may go through.

## Per run

| run | went through | silent errors | silent error rate | straight-through | reviewed (needed) | review-queue precision |
|---|---|---|---|---|---|---|
| a | R1 R2 | R2 | 1/2 = 50.0% | 2/6 = 33.3% | R3 R4 (R3) | 1/2 = 50.0% |
| b | R1 | - | 0/1 = 0.0% | 1/6 = 16.7% | R2 R3 R4 (R2 R3) | 2/3 = 66.7% |
| c | R1 R2 R4 | R2 | 1/3 = 33.3% | 3/6 = 50.0% | R3 (R3) | 1/1 = 100.0% |

## Variance

Computed from the exact fractions, not the rounded percentages (trap G6).
Spread is the sample standard deviation: how far a typical run sits from the average.

**Silent error rate**: 50, 0, 33.33
- mean = 83.33 / 3 = **27.8**
- deviations 22.22, -27.78, 5.56; squared 493.8, 771.6, 30.9; sum 1296.3; / (3 - 1) = 648.1; square root = **25.5**
- min 0.0 · max 50.0 · range **50.0**

**Straight-through**: 33.33, 16.67, 50
- mean **33.3** · deviations 0, -16.67, 16.67; squared 0, 277.8, 277.8; / 2 = 277.8; spread **16.7**
- min 16.7 · max 50.0 · range **33.3**

**Records that changed route between runs**: R2 (auto, review, auto) and R4 (review, review, auto).
**Records whose silent-error status changed**: R2 (silent in a and c, caught in b).

Read it this way: three runs of *identical code* put the silent error rate anywhere from
0% to 50%. No single run of this workflow can claim a silent error rate more precise than that.

## Compare

**a → b**: silent error rate 50.0% → 0.0% (-50.0 points). Against the three-run noise range
of 50.0 points, that is **within noise**: identical code already moves this much. R2's route
changed AUTO_PUBLISH → EDITOR_REVIEW, where the key wants it: **fixed**. R2 is no longer a
silent error.

**a → c**: straight-through 33.3% → 50.0% (+16.7 points), within the noise range of 33.3.
R4's route changed EDITOR_REVIEW → AUTO_PUBLISH, where the key wants it: **fixed**.
