# Split fixture: hand-worked answers

Twenty-four records (S01-S24) coded by a workflow with a set of codes (`codes`: A, B, C), each
with a correct route in the key (AUTO, REVIEW, or DUPLICATE for S20, a duplicate of S01) and a
trap. `config.json` holds out half of them (`"split": { "held_out": 0.5 }`: sha256, no salt, a
record goes with its cluster or its primary). Built for traps O1-O16 (test/TRAPS.md): which
half each record is in, what the reports show of each half, and what each look at the held-out
half may claim. `test/split.test.js` checks every number below.

## Which half each record is in

A record's unit is its own id, except a duplicate, whose unit is its primary's (S20 goes with
S01). The unit's place from 0 to 1 is the first 4 bytes of SHA-256 of its name (no salt: the name
alone), read as a whole number and divided by 2^32 = 4,294,967,296; held out when under 0.5. The
hex digits below are SHA-256's first 8, checked with Python's `hashlib` as well as the tool.

| id | unit | sha256 starts | place | half |
|---|---|---|---|---|
| S01 | S01 | ac7438e8 | 0.6736 | tuning |
| S02 | S02 | bbe97d17 | 0.7340 | tuning |
| S03 | S03 | 217c48f2 | 0.1308 | held out |
| S04 | S04 | 3491f905 | 0.2054 | held out |
| S05 | S05 | 39a6c3d9 | 0.2252 | held out |
| S06 | S06 | 3193b0ff | 0.1937 | held out |
| S07 | S07 | 4fc42779 | 0.3116 | held out |
| S08 | S08 | 33829b0e | 0.2012 | held out |
| S09 | S09 | 7e0b7c84 | 0.4924 | held out |
| S10 | S10 | 3d16e901 | 0.2386 | held out |
| S11 | S11 | 4a1bcaec | 0.2895 | held out |
| S12 | S12 | d30b6fed | 0.8244 | tuning |
| S13 | S13 | 02cfcc7e | 0.0110 | held out |
| S14 | S14 | ec546f04 | 0.9232 | tuning |
| S15 | S15 | dca468ba | 0.8619 | tuning |
| S16 | S16 | 86622033 | 0.5249 | tuning |
| S17 | S17 | b5984841 | 0.7094 | tuning |
| S18 | S18 | d625318b | 0.8365 | tuning |
| S19 | S19 | d87f96c3 | 0.8457 | tuning |
| S20 | **S01** | (S01's) ac7438e8 | 0.6736 | tuning |
| S21 | S21 | 56757a56 | 0.3377 | held out |
| S22 | S22 | b42bb459 | 0.7038 | tuning |
| S23 | S23 | a1489528 | 0.6300 | tuning |
| S24 | S24 | aa82f280 | 0.6661 | tuning |

So the **held-out half** is S03-S11, S13 and S21 (11 records) and the **tuning half** the other 13.
By its own id (`"by": "id"`), S20 would be held out (sha256 starts 7e830ff5: 0.4942, under 0.5):
then 12 are held out, and the duplicate pair S01 / S20 straddles the halves (trap O3, one warning).
With `"held_out": 0.005` no record is held out (the lowest place is S13's, 0.0110): trap O15.

**CRC-32** (zlib's): "123456789" gives 0xcbf43926, the standard check value.

## The records (`key.json`, `predictions.json` = v1)

Key codes cycle with the number: n divisible by 3 is A, B; n = 3k + 1 is A; n = 3k + 2 is C.
S12 and S19 should go to a person (REVIEW); S20 should be suppressed (DUPLICATE, of S01); the rest
should go out (AUTO). Traps: lookalike S03 S07 S12 S16; stub S09 S22; near-duplicate S20; plain the
other 17.

v1 routes every record as the key does, except S16 and S21 (sent to a person though the key says
AUTO), and codes every record right except S02 (D for C) and S15 (A for A, B).

**Tuning half (13 records)**

- Out without review: S01 S02 S14 S15 S17 S18 S22 S23 S24 = **9**. Silent errors: S02 (wrong D,
  missing C: high) and S15 (missing B: medium) = **2 of 9, 22.2%**, likely 6.3-54.7%.
- Straight-through **9 of 13** (69.2%). Sent to a person: S12, S16, S19; needed one: S12, S19
  (their key route is REVIEW) = review precision **2 of 3**; S16 is the unnecessary review.
- Silent omissions: the records the key sends out or to a person (12: all but S20), none blocked
  or suppressed = **0 of 12**.

**Held-out half (11 records)**

- Out without review: S03-S11, S13 = **10**, all right: **0 of 10**. Wilson's range at 0 of 10:
  centre = (z^2 / 20) / (1 + z^2 / 10) = 0.19208 / 1.38416 = 0.13877, and the half-width the same,
  so it reaches **27.8%** (z = 1.96).
- Straight-through **10 of 11**; review precision **0 of 1** (S21 needed no person); silent
  omissions **0 of 11**.

None of these ids may appear in a report without `--show-held-out`: not in the terminal report,
the JSON or the HTML (trap O6). The held-out half has no `near-duplicate` record (S20 went with
S01): the report says it cannot speak for that trap.

**Balance** (trap O5). Per trap, the held-out count against its exact distribution under a fair
split (each unit held out with chance 0.5; two-sided p = twice the smaller tail, at most 1):
plain 8 of 17 (p = 1), lookalike 2 of 4 (p = 1), stub 1 of 2 (p = 1), near-duplicate 0 of 1 (p = 1).
Tarone's bar: only plain can ever reach 5% (its smallest p, 2 x 0.5^17, is under 0.05; lookalike's
is 2 x 0.5^4 = 0.125), so K = 1 and the bar is 0.05. Nothing is beyond chance.

## The other answer keys

- **`key-unbalanced.json`**: the same records with lookalike on S03 S04 S05 S06 S07 S08 S10 (all
  held out) and plain on the other 17. Lookalike: 7 of 7 held out, p = 2 x 0.5^7 = **0.015625**.
  Plain: 4 of 17 held out (S09 S11 S13 S21), over 16 units since S01 and S20 are one (X = Y + 2B,
  Y ~ Bin(15, 0.5), B ~ Bern(0.5)): P(X <= 4) = (P(Y <= 4) + P(Y <= 2)) / 2 = (1941 + 121) / 65536
  = 0.031464, so p = 2062 / 32768 = **0.0629**. Tarone: both labels' smallest p (0.015625 and
  2 x 0.5^16) are under 0.05, too many for K = 1; both are under 0.025, so K = 2 and the bar is
  **0.025**. Lookalike (0.0156) is beyond chance: one O5 warning; plain (0.0629) is not.
- **`key-moved.json`**: S20 is no longer marked a duplicate, so it goes by its own id (0.4942):
  held out. A log that saw it in the tuning half stops (trap O10, strict).
- **`key-grown.json`**: eight records added, S25-S32, all AUTO and coded right. Places: S25 0.5957,
  S26 0.6285, S27 0.5569, S28 0.8658, S29 **0.0662**, S30 0.5543, S31 **0.1897**, S32 **0.0209**:
  three new held-out records (S29, S31, S32). `predictions-grown.json` is v4 plus those eight, all
  out without review and right.

## The versions

| file | differs from v1 | tuning silent errors | held-out silent errors |
|---|---|---|---|
| predictions.json (v1) | - | 2 of 9 (S02, S15) | 0 of 10 |
| predictions-v2.json | S05 coded D (held out) | 2 of 9 | **1 of 10** (S05, high) |
| predictions-v3.json | S02 coded C (fixed) | 1 of 9 | 0 of 10 |
| predictions-v4.json | S02 and S15 fixed | 0 of 9 | 0 of 10 |
| predictions-bad.json | S03-S08 coded D | 2 of 9 | 6 of 10 |

## The claim, look by look (trap O7)

A claim "shown under the target" on the held-out half: k silent errors in the n records out
without review, p = P(Bin(n, target) <= k), shown when p is at most this look's share of the 5%.
Look k may use 0.05 / 2^k: **2.5%, 1.25%, 0.625%, 0.3125%, 0.15625%**, ... (each look half of what
is left). Against a 40% target, with 0.6^9 = 0.010077696 and 0.6^10 = 0.0060466176:

- 0 of 10: p = 0.6^10 = **0.0060466**.
- 1 of 10: p = 0.6^10 + 10 x 0.4 x 0.6^9 = 0.0060466 + 0.0403108 = **0.0463574**.

One log, looks in this order (`test/split.test.js`, "O7, O8"):

| look | file | held-out | share | p | shown |
|---|---|---|---|---|---|
| 1 | v1 | 0 of 10 | 2.5% | 0.0060 | yes |
| 2 | v2 | 1 of 10 | 1.25% | 0.0464 | no |
| (1 again) | v1 | 0 of 10 | 2.5% | 0.0060 | yes: the same command on the same files is the same look, not counted again (O8) |
| 3 | v3 | 0 of 10 | 0.625% | 0.0060 | yes (0.0060466 <= 0.00625) |
| 4 | v4 | 0 of 10 | 0.3125% | 0.0060 | no: **used up** |

At look 4 even no silent error at all among 10 records gives p = 0.0060 > 0.003125. The fewest
records out, none a silent error, that would show it at that share: 0.6^11 = 0.003628 is too big,
0.6^12 = 0.002177 is not, so **12**.

**Records added later (O14).** After those four looks, `key-grown.json` with `predictions-grown.json`
is look 5. The 11 original held-out records were first shown at look 1: the half is at its look
5, share 0.05 / 32 = **0.15625%**. The whole half now has 13 records out, none wrong: p = 0.6^13 =
**0.0013061**, within 0.15625%: shown, the larger half making up for the later look.
S29, S31 and S32 were first shown at look 5 (3 records new: no
look before this one): the newest batch, at **its** look 1, share **2.5%** of its own 5%. Its
silent errors: 0 of 3, p = 0.6^3 = **0.216**, not shown; the fewest records that would show it at
2.5%: 0.6^7 = 0.028 is too big, 0.6^8 = 0.0168 is not, so **8**.

**Listing (O13).** In a fresh log, v1 with `--show-held-out` (look 1, recorded as listing the
records first shown by look 1), then v3: look 2. Every held-out record was first shown at look 1,
listed before look 2, so the claim's share is **0** ("listed at look 1"), whatever p is.

**No log (O12).** Without `split.log` every claim is made as at a first look (2.5%), and the report
says once that looks are not counted, and how to count them.

## Compare and variance

**Compare v1 -> bad.** Tuning half: nothing changes (bad differs only in held-out records): every
paired outcome "no change". Held-out half: silent errors before 0, after 6 (S03-S08), fixed 0,
broke 6, of 11 records: **worse** (exact McNemar on 0 against 6 changed records: two-sided
p = 2 x 0.5^6 = 0.031, under 0.05, as Tango's range, +14.5 to +78.7 points, clears 0).
`--fail-if-worse silent-errors` exits 3, naming "the held-out half", never a record.

**Variance v1, v2, v3.** Tuning half: 2 of 9, 2 of 9, 1 of 9: the worst run is run 1 (runs 1 and 2
tie at the same rate and range, and the first is kept). Held-out half: 0 of 10, 1 of 10, 0 of 10:
the worst is **run 2, 1 of 10**, likely **1.8-40.4%** (Wilson at 1 of 10: centre 0.29208 / 1.38416
= 0.21102, half-width 1.96 x sqrt(0.009 + 0.009604) / 1.38416 = 0.19314).

## What-if, chosen on the tuning half (O16): the gate fixture

`gate.json` and `gate-b.json` read `test/fixtures/gate/` (sixty articles in ten bands of six,
confidences 0.97 down to 0.52; wrong: G19, G25 G26, G31-G35, G37-G40, G43-G46, G49-G52, G55-G58;
see that fixture's EXPECTED.md) with a split: no salt, and salt "b" (the hash of "b:" and the id).

| salt | held-out articles |
|---|---|
| none | G01 G02 G04 G05 G10 G11 G13 G15 G19 G24 G26 G27 G31 G32 G33 G38 G40 G42 G45 G49 G50 G53 G54 G56 G57 G58 G59 (27) |
| "b" | G02 G05 G06 G07 G08 G09 G12 G15 G16 G19 G20 G24 G27 G30 G38 G39 G41 G42 G46 G48 G52 G54 G56 G57 G59 G60 (26) |

**No salt, target 40%.** Tuning half, per gate (out, silent): 0.70: bands 1-6 have 36 articles, 15
held out, so 21 out; wrong in bands 1-6: G19 G25 G26 G31-G35 (8), 5 of them held out (G19 G26 G31
G32 G33), so **3 of 21**. 0.75: 30 - 12 = 18 out, wrong G25 only: **1 of 18**. 0.80: 24 - 10 = 14
out, wrong none (G19 is held out): **0 of 14**. Certified among 11 gates at 0.05 / 11 = 0.004545:
- 0.75: 0.6^18 + 18 x 0.4 x 0.6^17 = 0.0001016 + 0.0012188 = **0.0013203**: certified;
- 0.70: 3 of 21, p = 0.0110: not (its likely range alone reaches 34.6%: "looks under alone");
- 0.80: 0.6^14 = 0.000784: certified, but stricter.

The loosest certified gate is **0.75**. On the held-out half at 0.75: bands 1-5 held out are G01 G02
G04 G05, G10 G11, G13 G15, G19 G24, G26 G27 = **12** out, wrong G19 and G26: **2 of 12**,
p = 0.6^12 + 12 x 0.4 x 0.6^11 + 66 x 0.16 x 0.6^10 = 0.0021768 + 0.0174144 + 0.0638521 =
**0.0834**: above 2.5%, not shown: **the held-out half disagrees**. Straight-through 12 of 27.

**Salt "b", target 40%.** Tuning: 0.75: 30 - 14 = 16 out, wrong G25 G26 (held-out band 5: G27, G30):
2 of 16, p = 0.0183: not certified. 0.80: 24 - 12 = 12 out, none wrong: p = 0.6^12 = 0.0021768:
certified, the loosest. Held out at 0.80: bands 1-4 held out: 3 + 4 + 2 + 3 = **12**, wrong G19:
**1 of 12**, p = 0.0021768 + 0.0174144 = **0.0196**: within 2.5%, **shown**.

**Policies** (`policies.json`, no salt, target 40%): the run as it was (gate 0.80) and two gate
changes, 3 rows, so the bar is 0.05 / 3 = 0.01667 on the tuning half: as run 0 of 14 (0.000784),
"Gate 0.75" 1 of 18 (0.00132), "Gate 0.85" 0 of 10 (0.6^10 = 0.00605): all certified; the loosest is
**"Gate 0.75"** (18 out). On the held-out half it is the gate at 0.75 again: **2 of 12**, not shown.

Without `--target` nothing is chosen: the sweep is the tuning half's, and the held-out half is
neither shown nor looked at.

**No log, no claim (O12).** `gate.json` keeps no log, so the CLI's what-if shows the held-out
numbers (2 of 12) and makes no claim. The claims above come from a copy of the config with a log.
"Disagrees" is said only when the held-out rate is at or above the target: 2 of 12 is 16.7%, under
40% (too few held-out records to confirm at this look), but at or above a 15% target (disagrees).

## The review's cases (`test/split-review.test.js`)

**The exact bound beside the likely range (O7).** The claim is shown when the exact one-sided bound
at this look's share is at or under the target: the rate u with P(Bin(n, u) <= k) = share. For 0 of
10 that is 1 - share^(1/10); at a first look's 2.5%, 1 - 0.025^0.1 = **30.8%**. Wilson's 95% range
for 0 of 10 reaches 27.8%, under a **28%** target, yet the claim is not shown: p = 0.72^10 = 0.0374,
above 2.5%. And it is **too few records**, not "used up": even a first look needs 0.72^n <= 0.025,
and 0.72^11 = 0.0270 is too big, 0.72^12 = 0.0194 is not, so **12** records out, none wrong.

**A new look for a changed config (O8).** v2 against the key is 1 of 10 held out (S05 codes D for
C). With `"equivalents": { "codes": [["C", "D"]] }` added, D is read as C, S05 is right: **0 of
10**, a new look (2, at 1.25%), not "look 1 again". The same files in `--lenient` mode: look 3.

**The halves' settings (O9, O4).** A log written with `duplicate_of_field` stops a config without
it (S20 would go by its own id). `--cluster-by story` with `config.json` (split by cluster, no
clusters) is refused; with `split.by: "id"` it is allowed.

**Moved records (O10).** Look 1 with `key-moved.json` puts S20 (its own id, 0.4942) in the held-out
half; look 2 with `key.json` puts it back with S01 in the tuning half: it left the held-out half,
a stop. In a lenient run after a look with `key.json`, S20 (tuning at look 1) held out now is set
aside: the held-out half has **11** records, none new, and S20 is under `moved` in the log, not in
`records.held_out`; a strict run then stops, with either key.

**Build gates (O19).** `gate-sg.json` is the gate fixture with G27 (held out with no salt) let out
at 0.77, under the 0.80 gate: one SG-GATE. Without a split `--fail-on critical` exits 3 naming
G27; with `gate.json` it exits 3 with "1 held-out record(s) (safeguard)". With 0.5% held out no
record is held out (O15), so `compare --fail-if-worse silent-errors` from v1 to bad judges the
tuning half only, where 6 records broke: worse, exit 3, and a note that the held-out half does not
measure silent errors.

**Pending rulings (O18).** `rulings-pending.json` holds D pending on S05 (held out) and on S02
(tuning). The bracket counts S02's only (1 pending); S05's is counted under the held-out half.

**Names in warnings (O6).** `predictions-space.json` gives S05 the codes "D " and "D": a stray space
trimmed (D7) and, after it, the same code twice (D6, strict). Lenient, the warnings say "1 held-out
record, not named"; strict, the stop does. `gate-desk.json` gives every article a desk except G03
(tuning) and G19 (held out with no salt): the policy check (E15) names G03 and counts G19.

**Half by half (O20, O3).** `min_per_trap: 3` against the answer key: near-duplicate has 1 record (1
in the tuning half), stub 2 (1 in the tuning half), lookalike 4: two H5 warnings. Split by id,
`predictions-dupA.json` (S01 suppressed, S20 let out) and `predictions-dupB.json` (both suppressed)
give S01 the same omission type: the tuning half is judged without the held-out S20.

## The final round: looks asked for, listings by record, two keys, ids by place

**A look is asked for (O25).** Without `--held-out`, nothing of the held-out half is scored: no log
file is written, and the report's one line gives the next look: none yet (look 1, 2.5%); after one
look, "1 look ... the next is look 2, which may use 1.25%"; after two, look 3 at 0.625%. `--quiet`
alone records nothing; `--quiet --held-out` records look 1. With `gate-sg.json`, `--fail-on
critical` without `--held-out` reads the tuning half, which has no safeguard failure: exit 0, and a
note; with `--held-out`, exit 3 (G27).

**The claim in plain words (O7).** v2 at look 1: 1 silent error in 10 held-out records out without
review; the exact bound at 2.5% is **44.5%**, over a 40% target: "Not yet shown under 40%: ... as high
as 44.5%". At look 2 (1.25%) the bound is **49.1%**.

**Whatif wording (O16).** The gate fixture's 0.75, on the held-out half: 2 of 12, 16.7%, likely
**4.7-44.8%**; exact bound at 2.5% **48.4%**, over 40%. Not too few: 12 records with no silent error
would show it (0.6^12 = **0.0022**, under 0.025). Certified on the tuning half at 1 of 18 (5.6%):
inside the held-out range, so "not confirmed at this look". Given 0 of 18 (0.0%) instead, below
4.7%: "the tuning half flattered it".

**Looks and listings per record (O13, O14).** Look 1 `key.json` (the 11 held out), look 2
`key-grown.json` (14: S29, S31 and S32 first seen), look 3 `key.json` with `--show-held-out`
(lists the 11 only), look 4 `key-grown.json` again with a new run. The whole half at look 4: 4
looks, listed at look 3, so it spends **nothing**. The newest 3: at looks 2 and 4 only, never
listed: their look **2**, share **1.25%** (before: look 3, nothing to spend).

**Two keys (O26).** `key-dup-moved.json` marks S05 (held out, 0.2252 by its own id) a duplicate of
S01 (tuning): under it S05 goes with S01. Strict, compare `--after-key` stops counting 1 record;
`--lenient` sets S05 aside in both runs: **13** tuning + **10** held out + **1** set aside = 24. A plain
`score --held-out` afterwards is look 2, with 1 new record (S05, never in a look), and no O10.

**Numeric ids (O6).** `config.json` with ids 1 to 24 holds out **1 3 4 7 8 9 10 11 12 13 17 18 21 22
23** (15) and tunes on 2 5 6 14 15 16 19 20 24. A rulings file with record 7's ruling at
`rulings[7]` and again at `rulings[8]` stops (I12): "rules on codes Z again (first at rulings[7])",
the 7 of the place kept, record 7 counted. D6 on every record (lenient): 9 warnings naming the
tuning records, and one counting **15** held-out records. With the key missing, the halves are
unknown: the same stop counts 1 record, and the run's own stops count all **24**.
