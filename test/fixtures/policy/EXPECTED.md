# Policy fixture: hand-worked answers

Eight records tagged with codes (`codes`, a set). Each record carries three prediction fields a
routing policy can read: its own gate threshold (`gate`, a client's, say), a match strength
(`match`) and a client region (`client`). A record goes out on its own (AUTO, auto) when its
strongest applied code is at least its own `gate` (`thresholds.auto_publish.codes` is `"gate"`,
a field's name, not a number); otherwise a person sees it (REVIEW, review). P7 is blocked by a
rule. The key has a correct route (`verdict`) and the right codes; `wrong_when` is `either`.

Built for one thing: routing policies compared side by side (`wfeval whatif --policies`,
`--hold-if`), and per-record thresholds.

## The records

| id | route | own gate | match | client | codes stated (confidence, applied?) | key codes | correct route |
|---|---|---|---|---|---|---|---|
| P1 | AUTO | 0.90 | 0.9 | north | A 0.95 yes | A | AUTO |
| P2 | AUTO | 0.90 | 0.4 | south | A 0.92 yes, B 0.86 no | A, B | REVIEW |
| P3 | AUTO | 0.80 | 0.3 | north | C 0.85 yes | C | AUTO |
| P4 | AUTO | 0.80 | 0.7 | south | A 0.88 yes | B | REVIEW |
| P5 | REVIEW | 0.80 | 0.8 | north | B 0.75 yes | B | AUTO |
| P6 | REVIEW | 0.90 | 0.5 | west | C 0.70 yes, A 0.60 no | C, A | REVIEW |
| P7 | BLOCK | 0.90 | 0.2 | south | X 0.99 yes | X | BLOCK |
| P8 | AUTO | 0.90 | 0.6 | west | B 0.91 yes | B | AUTO |

Who needed a person: P2 (its key says review; B was stated but not applied), P4 (A applied, B
missing; key says review) and P6 (key says review). P1, P3, P5 and P8 are right and should go
out; P7 should be blocked and was.

## Per-record thresholds

Each record against its own gate, strongest applied code first:

| id | strongest | own gate | passes? | went |
|---|---|---|---|---|
| P1 | 0.95 | 0.90 | yes | auto |
| P2 | 0.92 | 0.90 | yes | auto |
| P3 | 0.85 | 0.80 | yes | auto |
| P4 | 0.88 | 0.80 | yes | auto |
| P5 | 0.75 | 0.80 | no | review |
| P6 | 0.70 | 0.90 | no | review |
| P8 | 0.91 | 0.90 | yes | auto |

All 7 records the gate could move (P7 is blocked) went where their own gate sends them: the
check reproduces 7 of 7. Nothing went out against its own gate, so no SG-GATE. Raise P3's own
gate to 0.90 and it would have gone out against it (0.85 < 0.90): SG-GATE.

Calibration checks each claim against its own record's gate. At or above it: P1 A (0.95 vs
0.90), P2 A (0.92 vs 0.90), P3 C (0.85 vs 0.80), P4 A (0.88 vs 0.80, wrong), P7 X (0.99 vs 0.90),
P8 B (0.91 vs 0.90): 5 of 6 right. Below it: P2 B, P5 B, P6 C, P6 A.

The gate sweep sets one threshold for every record in place of each one's own, so no row is
"current". At 0.90: P1 (0.95), P2 (0.92) and P8 (0.91) pass; P3 (0.85) and P4 (0.88) do not.

`predictions.csv` holds the same records as a spreadsheet, with only the applied codes: its `gate` cells are text ("0.9"), read as numbers, so every record has the same own gate as above and the check again reproduces 7 of 7.

## As run

- Went out without review: P1 P2 P3 P4 P8 = 5 of 8 (straight-through 62.5%).
- Silent errors: P2, P4 = 2 of 5 (40.0%).
- Sent to a person: P5, P6. P5 needed none: 1 unnecessary review; review precision 1 of 2.
- Silent omissions: the records that should go out or to a person are P1-P6 and P8 (7); none
  was blocked or suppressed: 0 of 7.

## The policies (`policies.json`)

Threshold changes come first, then hold-if: a record that would go out without review and meets
any hold-if condition goes to a person instead.

1. **Weak matches to a person**: hold if `match` < 0.5. Out without review: P2 (0.4) and P3
   (0.3) meet it. P7 (0.2) also does, but it is blocked: a hold never touches it.
2. **Strong B to a person**: hold if `codes` states B at 0.85 or more (applied or not). P2 (B
   0.86, not applied) and P8 (B 0.91). P5's B is 0.75, and P5 went to a person anyway.
3. **Both**: either condition: P2, P3, P8.
4. **South to a person**: hold if `client` is one of [south]: P2, P4 (P7 is blocked).
5. **Gate 0.90 for every record**: `auto_publish.codes` 0.90 for everyone (the table above):
   P3 and P4 move to a person; P5, P6 stay there.
6. **Cap each gate at 0.75**: each record's own gate becomes the lower of it and 0.75, which is
   0.75 for all of them. P5 (0.75) now passes and goes out; P6 (0.70) does not.

| policy | out without review | silent errors | rate | unnecessary reviews | review precision | straight-through | held | moved in | moved out |
|---|---|---|---|---|---|---|---|---|---|
| as run | P1 P2 P3 P4 P8 | P2 P4 | 2/5 | P5 | 1/2 | 5/8 | - | - | - |
| Weak matches | P1 P4 P8 | P4 | 1/3 | P3 P5 | 2/4 (P2, P6) | 3/8 | P2 P3 | - | P2 P3 |
| Strong B | P1 P3 P4 | P4 | 1/3 | P5 P8 | 2/4 (P2, P6) | 3/8 | P2 P8 | - | P2 P8 |
| Both | P1 P4 | P4 | 1/2 | P3 P5 P8 | 2/5 (P2, P6) | 2/8 | P2 P3 P8 | - | P2 P3 P8 |
| South | P1 P3 P8 | none | 0/3 | P5 | 3/4 (P2, P4, P6) | 3/8 | P2 P4 | - | P2 P4 |
| Gate 0.90 | P1 P2 P8 | P2 | 1/3 | P3 P5 | 2/4 (P4, P6) | 3/8 | - | - | P3 P4 |
| Cap 0.75 | P1 P2 P3 P4 P5 P8 | P2 P4 | 2/6 | none | 1/1 (P6) | 6/8 | - | P5 | - |

Silent omissions stay 0 of 7 in every row: no policy blocks or suppresses anything.

Hold-if rows are exact. The two threshold rows assume every auto or review record was routed by
the gate alone (no `whatif.movable_field`): an upper bound on what can move.

### Paired against as run

Record by record (all 8): a silent error fixed is one in as run and not under the policy; an
unnecessary review added is one under the policy and not in as run.

| policy | silent errors fixed | broke | unnecessary reviews removed | added |
|---|---|---|---|---|
| Weak matches | 1 (P2) | 0 | 0 | 1 (P3) |
| Strong B | 1 (P2) | 0 | 0 | 1 (P8) |
| Both | 1 (P2) | 0 | 0 | 2 (P3, P8) |
| South | 2 (P2, P4) | 0 | 0 | 0 |
| Gate 0.90 | 1 (P4) | 0 | 0 | 1 (P3) |
| Cap 0.75 | 0 | 0 | 1 (P5) | 0 |

A hold-if policy never breaks a silent error: holding only takes records out of "went out
without review". The paired likely ranges are Tango's (as `compare` gives them) and are not
worked here; with 8 records every one is "unclear".

### Why hold-if is exact

Holding P2 under "Weak matches" changes its route from auto to review and nothing else. Its
values, its key and every other record's route are as they were, so every judgment that does not
read the route is unchanged (the test compares them all, for every hold-if policy). The ones
that read it: P2 is no longer a silent error (it went to a person), has no safeguard check (those
are for records that went out), and is not an unnecessary review (it needed a person). P3, also
held, needed none: it becomes an unnecessary review. Blocked P7 is never held.

## Certified under 90%

The target is high so that eight records can certify anything. Seven rows are tried (as run and
the six policies), so each is certified when p <= 0.05 / 7 = 0.007143, with
p = P(Bin(n, 0.9) <= k) for its k silent errors in n out without review:

| row | k / n | p |
|---|---|---|
| as run | 2/5 | 0.1^5 + 5(0.9)(0.1^4) + 10(0.81)(0.1^3) = 0.00001 + 0.00045 + 0.0081 = 0.00856 |
| Weak matches | 1/3 | 0.1^3 + 3(0.9)(0.1^2) = 0.001 + 0.027 = 0.028 |
| Strong B | 1/3 | 0.028 |
| Both | 1/2 | 0.1^2 + 2(0.9)(0.1) = 0.01 + 0.18 = 0.19 |
| South | 0/3 | 0.1^3 = 0.001: certified |
| Gate 0.90 | 1/3 | 0.028 |
| Cap 0.75 | 2/6 | 0.1^6 + 6(0.9)(0.1^5) + 15(0.81)(0.1^4) = 0.000001 + 0.000054 + 0.001215 = 0.00127: certified |

The loosest certified policy is Cap 0.75 (6 out of 8). Its likely range (Wilson, z = 1.96) for
2 of 6: centre (1/3 + 1.96²/12) / (1 + 1.96²/6) = 0.65347 / 1.64027 = 0.39839, half-width
1.96 × sqrt(1/27 + 1.96²/144) / 1.64027 = 0.30163, so up to 70.0%: under 90% read alone too.
The fewest records out any policy here would need: 0.1^n <= 0.007143 first holds at n = 3.
