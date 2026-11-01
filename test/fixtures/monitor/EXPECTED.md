# Monitor fixture: expected numbers, worked by hand

Seven weeks of a live scorecard (`counts.csv`, the same as `counts.json`): 30 records out without
review checked each week, with their silent errors. And three weeks as run files (`runs/`), each
holding that week's checked records with the person's answers, scored with `config.json`.
Settings: `--target 5` and `--acceptable 2.5` (so alarming 5%, double the acceptable rate), and
the default `--false-alarm-every 2000`. Checked by `test/monitor.test.js`.

## The CUSUM's steps

From an acceptable 2.5% to an alarming 5%:

- a silent error is ln(0.05 / 0.025) = ln 2 = 0.693147 of evidence for a rise;
- a right record is ln(0.975 / 0.95) = 0.025975 against.

In whole steps, a right record takes `down` steps off, with down the smallest whole number that
makes `up` at least 50: 50 × 0.025975 / 0.693147 = 1.87, so down = 2. Then
up = round(2 × 0.693147 / 0.025975) = round(53.37) = **53**.

A week with y silent errors in 30 records adds 53y - 2(30 - y) = 55y - 60, and S never goes
below 0 at a week's end:

| week | out | silent | rate (likely range) | 55y - 60 | S | share of the alarm level (156) |
|---|---|---|---|---|---|---|
| 2026-W36 | 30 | 0 | 0.0% (0.0-11.4%) | -60 | 0 | 0% |
| 2026-W37 | 30 | 0 | 0.0% (0.0-11.4%) | -60 | 0 | 0% |
| 2026-W38 | 30 | 0 | 0.0% (0.0-11.4%) | -60 | 0 | 0% |
| 2026-W39 | 30 | 1 | 3.3% (0.6-16.7%) | -5 | 0 | 0% |
| 2026-W40 | 30 | 3 | 10.0% (3.5-25.6%) | 105 | 105 | 67.3% |
| 2026-W41 | 30 | 2 | 6.7% (1.8-21.3%) | 50 | 155 | 99.4% |
| 2026-W42 | 30 | 3 | 10.0% (3.5-25.6%) | 105 | 260 | 166.7% |

(The likely ranges are the usual 95% Wilson ranges, from `rate()`.)

**The alarm level, 156 steps**, is not hand-workable: it is the smallest whole number of steps
whose Markov chain (Brook & Evans 1972) gives at least 2,000 records per false alarm at 2.5% in
weeks of 30 (the median week): 2,065 records at 156, and 1,625 at 155. The same chain gives
**219 records** to flag a rise to 5% (7.3 weeks of 30). The test checks the chain against a
simulation of the detector itself (3,000 runs, within 6%); `scripts/monitor-sim.js` checks it
with 20,000 runs a row (within 1.3%).

- W41: 155 of 156, one step short: in control.
- W42: 260 >= 156: **ALARM since 2026-W42**.
- S last stood at 0 at the end of W39, so **the rise likely started in 2026-W40**.

## Shown under 5%?

With S silent errors and F right records, E is the average, over rates q spread evenly from 0 to
5%, of how much likelier the records are at q than at 5%. With no silent error it comes out as

    E = (1 - 0.95^(F+1)) / (0.05 (F+1) 0.95^F)

| week | silent so far | right so far | E | shown (E >= 20)? |
|---|---|---|---|---|
| 2026-W36 | 0 | 30 | 0.796093 / 0.332690 = 2.39 | no |
| 2026-W37 | 0 | 60 | 6.81 | no |
| 2026-W38 | 0 | 90 | 0.990606 / 0.044990 = 22.02 | **yes** |
| 2026-W39 | 1 | 119 | 12.15 | no |
| 2026-W40 | 4 | 146 | 1.64 | no |
| 2026-W41 | 6 | 174 | 0.99 | no |
| 2026-W42 | 9 | 201 | 0.49 | no |

(0.95^30 = 0.214639, 0.95^31 = 0.203907; 0.95^90 = 0.009888, 0.95^91 = 0.009394.) From W39 on,
with silent errors, E is the closed-form sum in `src/metrics/monitor.js`; the test checks that
sum against the integral by quadrature to 6 decimals.

So: shown under 5% in W38 only. At the end, **not shown now**: 210 records, 9 silent errors,
last shown in 2026-W38.

**The upper bound** each week is the rate at which E reaches 20, with the same formula and 5%
replaced by the rate tested. For W36 (no silent error, 30 records): E is 19.91 at 13.8% and 20.19
at 13.85%, so the bound is 13.8%. For W37 (60 records): 19.95 at 7.2%, 20.47 at 7.25%: 7.2%. In
all: 13.8%, 7.2%, 4.9%, 5.6%, 8.0%, 8.5%, 9.4%.

With no silent error at all, 87 right records give E = 19.49 and 88 give 20.30: the confidence
sequence needs **88** records to show "under 5%", against 73 for one test of fixed size (whose
95% Wilson range of 0 of 73 just clears 5%).

## Restarting the alarm with `--since 2026-W41`

The alarm skips W36 to W40. From 0: W41 adds 50 (S = 50), W42 adds 105 (S = 155). The median
week is still 30, so the alarm level is still 156: **in control**, one step short. The bound is
not restarted: it still counts all 210 records with 9 silent errors, as above (a restart picked
after an alarm is picked by the numbers; see docs/METRICS.md).

## The run files

Each file is scored as `score` would, with the answers in the same file:

| week | records | out without review | silent errors | S |
|---|---|---|---|---|
| 2026-W40 | 5 | 4 (W40-1 to W40-4) | 1 (W40-2: refund for billing) | 53 - 2 × 3 = 47 |
| 2026-W41 | 4 | 3 | 0 | 47 - 2 × 3 = 41 |
| 2026-W42 | 6 | 5 | 2 (W42-1, W42-2) | 41 + 106 - 2 × 3 = 141 |

The held records (W40-5, W41-4, W42-6) went to a person and are not in the rate's base. The
median week is 4 records, so the alarm level is 203 steps: in control (141, 69.5%).
