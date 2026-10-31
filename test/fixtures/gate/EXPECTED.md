# Gate fixture: hand-worked answers

Sixty news articles tagged by a workflow with one topic each (`TOPIC`: EARNINGS, DEALS or
MARKETS). An article goes out on its own (AUTO_PUBLISH, auto) when its topic's confidence is at
least the gate, 0.80; otherwise an editor sees it (EDITOR_REVIEW, review). No correct route in
the key, so an article needed a person if its topic is wrong (`wrong_when` `any_mismatch`).

Built for one thing: a gate certified to keep silent errors under a target, among all the gates
a sweep tries (`wfeval whatif --gate --target`, trap E9).

## The records

Ten bands of six articles, each band at one confidence, set between the sweep's steps so every
step lets one more band out. In each band the first articles listed as wrong say the next topic
round (EARNINGS -> DEALS -> MARKETS -> EARNINGS) instead of the right one.

| band | ids | confidence | wrong | wrong ids |
|---|---|---|---|---|
| 1 | G01-G06 | 0.97 | 0 | - |
| 2 | G07-G12 | 0.92 | 0 | - |
| 3 | G13-G18 | 0.87 | 0 | - |
| 4 | G19-G24 | 0.82 | 1 | G19 |
| 5 | G25-G30 | 0.77 | 2 | G25 G26 |
| 6 | G31-G36 | 0.72 | 5 | G31-G35 |
| 7 | G37-G42 | 0.67 | 4 | G37-G40 |
| 8 | G43-G48 | 0.62 | 4 | G43-G46 |
| 9 | G49-G54 | 0.57 | 4 | G49-G52 |
| 10 | G55-G60 | 0.52 | 4 | G55-G58 |

At the actual gate, 0.80, bands 1-4 went out (24 articles) and bands 5-10 went to an editor.
There is no `whatif.movable_field`, so every article is assumed movable by the gate; at 0.80 the
simulation reproduces all 60 actual routes.

## The sweep

The default sweep, 0.50 to 1.00 in steps of 0.05: **11 gates**. A gate lets out every band at or
above it. n is the articles out without review at that gate, k the silent errors among them.

| gate | bands out | n | k | silent error rate | likely range reaches (Wilson) |
|---|---|---|---|---|---|
| 1.00 | none | 0 | 0 | none went out | - |
| 0.95 | 1 | 6 | 0 | 0.0% | 39.0% |
| 0.90 | 1-2 | 12 | 0 | 0.0% | 24.3% |
| 0.85 | 1-3 | 18 | 0 | 0.0% | 17.6% |
| 0.80 | 1-4 | 24 | 1 | 4.2% | 20.2% |
| 0.75 | 1-5 | 30 | 3 | 10.0% | 25.6% |
| 0.70 | 1-6 | 36 | 8 | 22.2% | 38.1% |
| 0.65 | 1-7 | 42 | 12 | 28.6% | 43.6% |
| 0.60 | 1-8 | 48 | 16 | 33.3% | 47.5% |
| 0.55 | 1-9 | 54 | 20 | 37.0% | 50.4% |
| 0.50 | 1-10 | 60 | 24 | 40.0% | 52.6% |

## Certified under 30%, at 95% confidence

**The test, one gate at a time.** Suppose a gate's true silent error rate were 30% or more. How
likely would it be to see as few silent errors as this gate did, or fewer? That chance is the
gate's p-value: p = P(Bin(n, 0.30) <= k), the exact binomial chance of at most k silent errors in
n articles at a 30% rate. A small p means "a rate of 30% or more would rarely look this good".

**Bonferroni.** The sweep tries 11 gates, so the 5% chance of being wrong (1 - 0.95) is shared
among them: a gate is certified when p <= 0.05 / 11 = **0.004545**. Then the chance that any
certified gate is really at or above 30% is at most 11 x 0.004545 = 5%.

| gate | n | k | p = P(Bin(n, 0.30) <= k) | p <= 0.004545? |
|---|---|---|---|---|
| 1.00 | 0 | 0 | 1 (nothing went out: nothing to certify) | no |
| 0.95 | 6 | 0 | 0.7^6 = 0.1176 | no |
| 0.90 | 12 | 0 | 0.7^12 = 0.01384 | no |
| 0.85 | 18 | 0 | 0.7^18 = 0.001628 | **yes** |
| 0.80 | 24 | 1 | 0.7^24 + 24 x 0.3 x 0.7^23 = 0.0001916 + 7.2 x 0.0002737 = 0.002162 | **yes** |
| 0.75 | 30 | 3 | see below = 0.009317 | no |
| 0.70 | 36 | 8 | 0.2037 | no |
| 0.65 | 42 | 12 | 0.4957 | no |
| 0.60 | 48 | 16 | 0.7495 | no |
| 0.55 | 54 | 20 | 0.8974 | no |
| 0.50 | 60 | 24 | 0.9638 | no |

Gate 0.75, the four terms of P(Bin(30, 0.3) <= 3):

- 0 errors: 0.7^30 = 0.00002254
- 1 error: 30 x 0.3 x 0.7^29 = 9 x 0.00003220 = 0.0002898
- 2 errors: C(30, 2) x 0.3^2 x 0.7^28 = 435 x 0.09 x 0.00004600 = 0.001801
- 3 errors: C(30, 3) x 0.3^3 x 0.7^27 = 4060 x 0.027 x 0.00006571 = 0.007203
- sum **0.009317**, above 0.004545.

**The loosest certified gate is 0.80**: the most straight-through of the two certified gates,
24 of 60 = 40.0%, with 1 silent error in 24 out without review (4.2%, likely 0.7-20.2%).

The least any gate could need here, with no silent errors at all: p = 0.7^n <= 0.004545, and
0.7^15 = 0.004748 is not enough, 0.7^16 = 0.003323 is: **16** articles out without review.

**Why it matters (trap E9).** Read alone, more gates look under 30%:

- by the point rate, every gate from 0.65 up (0.65 is 12 of 42 = 28.6%);
- by the likely range (the standard `score --target` uses for one run), every gate from 0.75 up
  to 0.90: 0 of 12 reaches 24.3%, 3 of 30 reaches 25.6%, both under 30%.

A person sweeping by eye would pick 0.65, or 0.75 if careful. Neither is certified: 0.75's
p = 0.009317 would pass a single test at the 2.5% a Wilson range's upper end stands for, but it
was picked from 11 gates. Trying twenty keys and announcing the one that opened the lock proves
less than one key that opens it the first time.

Strict gates fail too, for the opposite reason: 0.90 has no silent errors, but 12 articles
cannot show a rate under 30% with p <= 0.004545 (0.7^12 = 0.01384). That is why the gates are
not tested in order from strictest to loosest (Learn then Test's fixed sequence): the sequence
would stop at 1.00, where nothing goes out, and certify nothing.

## The same gate among fewer

`--from 0.75 --to 0.75` tries 0.75 and the current gate, 0.80 (the sweep always adds the current
gate): **2 gates**, so a gate is certified when p <= 0.05 / 2 = **0.025**. 0.75's 0.009317 is,
and so is 0.80's 0.002162. The loosest certified gate is now 0.75 (30 of 60 out, 50.0%).
The fewer gates tried, the less luck can explain a good-looking one. The count is of the gates
tried in this sweep: sweeping a second time over a narrower range after seeing the first does
not make the second sweep's gates fewer.

## Ties

`--from 0.78 --to 0.84 --step 0.01`: **7 gates**, certified when p <= 0.05 / 7 = **0.007143**.
Gates 0.78 to 0.82 let out the same 24 articles (bands 1-4: the next band down is at 0.77), 1
silent error, p = 0.002162: all certified. 0.83 and 0.84 let out 18, p = 0.001628: certified.
The most straight-through is 24, at five gates. On the golden set they are the same gate; in
use, 0.78 would also let out articles between 0.78 and 0.82, and the set holds none to test them
on. So the tie goes to the strictest: **0.82**.

## Other targets and confidences

**Under 10%, at 95%**: no gate is certified. With no silent errors, p = 0.9^n, so a gate needs
0.9^n <= 0.004545: 0.9^51 = 0.004638 is not enough, 0.9^52 = 0.004175 is. The least any gate
could need: **52** articles out without review, none of them a silent error. This fixture's
gates with no silent errors let out at most 18 (p = 0.9^18 = 0.1501).

**Under 30%, at 99%**: the bar is 0.01 / 11 = 0.000909. 0.85's 0.001628 and 0.80's 0.002162 both
miss it: no gate is certified. The least: 0.7^19 = 0.001140 is not enough, 0.7^20 = 0.000798 is:
**20** articles out, none a silent error.

**Under 30%, at 90%**: the bar is 0.1 / 11 = 0.009091. 0.75's 0.009317 still misses it, by a
little: the same two gates are certified, 0.85 and 0.80.
