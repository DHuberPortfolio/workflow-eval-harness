# Ordinal fixture: hand-worked answers

Six detected changes, each scored for materiality on a 1-5 band (5 = most material),
shaped like a competitor-watch digest. `INCLUDE` puts the change in the digest with no
human (auto), `ESCALATE` sends it to a person (review), `DROP` leaves it out (block).

The point of an ordinal output: a 4 for a 5 is a near miss, a 1 for a 4 is not, and the
two should not count the same.

| id | band (predicted / key) | off by | route (went / should) | what it tests |
|---|---|---|---|---|
| C1 | 5 / 5 | 0 | INCLUDE / INCLUDE | correct |
| C2 | 4 / 5 | 1 lower | INCLUDE / INCLUDE | **near miss** that went out: a silent error, but low severity |
| C3 | 1 / 3 | 2 lower | DROP / INCLUDE | **silent omission**: a real change scored trivial and dropped |
| C4 | 2 / 2 | 0 | INCLUDE / INCLUDE | correct |
| C5 | 1 / 4 | 3 lower | INCLUDE / ESCALATE | **far miss** that went out: a high-severity silent error |
| C6 | 3 / 2 | 1 higher | ESCALATE / ESCALATE | near miss, but a person saw it |

## Band quality (all six records)

Signed distance (predicted minus key): 0, -1, -2, 0, -3, +1

- **Exact** = C1, C4 = 2/6 = **33.3%**
- **Within one step** = C1, C2, C4, C6 = 4/6 = **66.7%**
- **Average distance** = (0 + 1 + 2 + 0 + 3 + 1) / 6 = 7/6 = **1.17** steps
- **Lean** (average signed distance) = (0 - 1 - 2 + 0 - 3 + 1) / 6 = -5/6 = **-0.83**: scores lean
  lower than the key. 1 predicted higher, 3 lower
- **Closeness** (1 minus distance / 4, the width of the scale, averaged) =
  (1 + 0.75 + 0.5 + 1 + 0.25 + 0.75) / 6 = 4.25/6 = **0.708**
- **Misses by distance**: 1 step: 2 (C2, C6) · 2 steps: 1 (C3) · 3 steps: 1 (C5)

## Routing

- **Straight-through** = C1 C2 C4 C5 = 4/6 = **66.7%**
- **Silent error rate** = records that went out and needed a person = C2, C5 of 4 = **50.0%**
  - C2: **SP-NEAR-MISS** (4 for 5; near_miss_steps defaults to 1) → **low**
  - C5: **SP-SHOULD-REVIEW** and **SP-WRONG** (1 for 4) → **high**
  - by severity: high 1 · low 1. `--fail-on high` trips on C5 only.
- **Silent omissions** = C3 of the 6 the key says should be included or escalated = 1/6 = **16.7%** (SO-FALSE-BLOCK)
- **Review-queue precision** = C6 of C6 = 1/1 = **100.0%**
- **Block precision** = C3 was dropped, the key says include = 0/1 = **0.0%**

With `near_miss_steps: 0`, every miss is a full miss: C2 becomes SP-WRONG, high.
