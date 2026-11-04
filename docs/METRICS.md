# The metrics, and why each exists

What each number measures and why it is there. For how to read them in a report, see
[READING_A_REPORT.md](READING_A_REPORT.md); for the words used, its first table.

## Silent error rate (the headline)

Of the records that went out without review, the share that needed a person. A record
needed a person if the answer key says it should not have gone out without review, or if
its values are wrong: the config's `wrong_when` chooses which evidence counts
([SILENT_ERRORS.md](SILENT_ERRORS.md)).

These are the only mistakes that reach the outside world with nobody having looked. Every
other mistake was caught by a person or a guard: it cost time, not trust.

Every silent error is typed and given a severity. "Should have been blocked" is critical;
"the model found the right value, but it was set aside for low confidence" is medium. The
rate cannot say which kind of mistake is getting through; the types can.

## Every rate carries its likely range

0 silent errors in 7 records looks perfect, and is consistent with a true rate as high as
35%. A bare percentage hides whether it came from 7 records or 700. The likely range
(a 95% Wilson score interval) makes that visible. The Wilson interval is used because the
textbook formula claims a range of exactly 0 to 0 at 0 of 7.

The report also says how far one record moves the rate at this size: with 7 records, one
record is 14 points.

**What the range does not cover.** It assumes each record is a separate piece of evidence,
drawn from the records you care about. Three common cases break that:

- **A golden set built from traps.** It holds far more hard cases than real traffic, so its
  rate is a stress-test rate: how the workflow does on records chosen to trip it. That is the
  right yardstick for comparing versions on the same records, and the range says how precise
  it is, but it is not the rate real traffic would see, and no range can say how far off it
  is. The rate on real traffic needs a random sample of that traffic with its own answer key,
  or each kind of record weighted by its real share (stratified estimation; Cochran 1977,
  ch. 5). `score --mix` does that weighting, for the kinds of record a group tells apart
  ([below](#weighted-to-a-real-mix)). The reports say "the true rate on records like these" for
  this reason.
- **Repeated runs of the same records, added together.** A record's runs tend to go the same
  way, so three runs of 200 records are not 600 records' worth of evidence, and a range drawn
  from the added-up count comes out too narrow (records that repeat are clustered: the design
  effect; Kish 1965). `variance` never adds runs up; see below.
- **Records that come in clumps within one run.** Retellings of one news story, or the
  statements of one filing, tend to go right or wrong together, so ten of them are not ten
  independent pieces of evidence either. Within one run, `clusters` in the config (or
  `score --cluster-by`) now covers this: a second range under the headline that counts the
  clumps ([below](#ranges-that-count-clusters)).

**How often the range holds.** A 95% range should miss the true rate about 5% of the time.
Wilson's does on average, but not at every rate. At very low true rates on small sets it
misses more often, up to about 16% at 10 records, and every one of those extra misses is on
the safe side: the range sits above the true rate, overstating the errors. Misses on the risky
side, a range below the true rate, stay close to the promised 2.5%, at most 4.3% at 10 records.
These figures were added up exactly, for thousands of rates and sizes, by error-rate-calculator's
audit ([AUDIT.md](https://github.com/DHuberPortfolio/error-rate-calculator/blob/main/AUDIT.md),
check 2.1), which runs the same formula with the same z = 1.96.

## Ranges that count clusters

Ten reviews of one restaurant written by the same person are one opinion, not ten. In the same
way, three retellings of one news story that the workflow tagged wrong for the same reason are
closer to one mistake seen three times than to three separate mistakes. A range that counts them
as three records is too narrow: it claims more evidence than there is.

With `clusters` in the config (or `score --cluster-by <field>`), each record belongs to a cluster
(its story, its filing), and the report adds one line under the headline:

> Records out without review came from 5 clusters (answer key field "story"); counting clusters,
> the likely range is 9.9-69.4% (design effect 1.9: about 6 independent records' worth).

That is the clusters fixture (`test/fixtures/clusters/`, `predictions-clumped.json`): 4 silent
errors in 12 records out without review, three of them in one story and one in another. Counted
as 12 independent records the range is 13.8-60.9%; counted by story, 9.9-69.4%.

**How it is worked out.** The standard survey-sampling answer for a rate when records come in
clusters (Kish 1965; for evals, Miller 2024, "Adding Error Bars to Evals", Eq. 4). Only the
records out without review count, as in the silent error rate itself.

1. For each cluster, compare its silent errors with what the overall rate would give it: a
   cluster of 4 records at a rate of one in three "should" have 1.3; story A has 3, 1.7 more.
   Square each difference and add them up. Clusters whose errors pile up give big differences.
2. That sum, times C/(C-1) for C clusters (a correction for having few of them), divided by the
   number of records squared, is the rate's variance counting clusters. The variance counting
   every record as independent is p(1-p)/(n-1): the same kind of correction, so that the two
   agree when every record is a cluster of its own.
3. The **design effect** is the first divided by the second: how many times less certain the
   clusters make the rate (1.9 here). It is never taken below 1: clusters that vary less than
   separate records would still never count as more evidence than the records themselves.
4. The records divided by the design effect are the **independent records' worth** (12 / 1.9,
   about 6), and the range is the usual Wilson range for the same rate over that many records.

A design effect needs something to compare: silent errors in at least two clusters, and records
without one in at least two. Otherwise nothing shows how far a cluster's records go together,
and the range assumes the worst, the cautious choice, and says why: each cluster's records go
right or wrong together. That covers no silent errors (or nothing but), a single cluster, and
every silent error in one cluster (or every record without one).

How much evidence is that? If each cluster's records go together, each cluster is one outcome,
weighted by its records, and Kish's (1965) effective number says what they are worth: the
records added up and squared, divided by the clusters' sizes squared and added up. For clusters
of the same size it is the number of clusters; for clusters of different sizes it is fewer, the
way one big cluster is a single outcome that carries much of the weight. The clusters fixture's
5 clusters of 4, 3, 2, 2 and 1 records are 144 / 34, about 4.2 records' worth. 0 of 12 records
there reaches 47.6%, where 0 of 12 independent records reaches 24.3%; `predictions.json`, its 3
silent errors all in one story, reaches 69.0%, against 53.2%.

Worked out as a design effect, a single wrong record would look like no clumping at all: one
error in the clusters fixture would then reach only 35.4%, lower than no error, where taken this
way it reaches 55.6%. So while every error sits in one cluster, one more never narrows the
range. Once errors sit in two clusters or more, an error that spreads them out can narrow it:
evidence that they do not pile up.

With every record a cluster of its own, the design effect is exactly 1 and the range is the
headline's: such records show no clumping. Miller's formula gives the same variance in that case.

The headline range is unchanged, so nothing else in a report moves. **Per-group rows and
`--target` still count every record as independent**, and the report says so beside them: a
group's records may share clusters with other groups, and a target's plan is about records not
yet tested. Records that come in clusters need more of them to show a target than the plan says.

## Weighted to a real mix

A golden set built from traps is mostly hard cases, so its silent error rate is a stress-test
rate. A driving test taken mostly on icy roads says little about a sunny commute until each kind
of road is weighted by how often it is icy. With `score --mix <file>`, each label of one group
gets its share of real traffic ([CONFIG.md](CONFIG.md#weighting-to-a-real-mix---mix)), and the
report adds the rate that mix would see, under the headline:

> On the real mix in test/fixtures/clusters/mix.json (business 10%, general 90%), the silent error
> rate would be about 5.1% (likely 0.4-43.7%; about 6 records' worth), against 25.0% on this
> golden set. A reweighting, not a measurement: it is only as good as the shares, and as the
> records tested in each group.

That is the clusters fixture (`test/fixtures/clusters/`): every mistake is in business news,
which is 8 of its 15 records but a tenth of the traffic in this mix. A second line gives the
straight-through on the mix the same way (73.0%, against 80.0%).

**How it is worked out.** Stratified estimation, as the combined ratio estimate (Cochran 1977,
ch. 5-6). Each group (a stratum) has N records, a of them out without review and s silent
errors, and a share W of real traffic (the shares divided by their total).

1. On the mix, the silent errors per record are the sum over the groups of W x s / N, and the
   records out without review per record the sum of W x a / N. The second is the **weighted
   straight-through**.
2. The **weighted silent error rate** is the first divided by the second: 0.0375 / 0.7304, or
   5.1%, here.
3. How much evidence is that? Each record out without review stands for W / N of the mix: a
   general one for 0.9 / 7 = 0.129, a business one for 0.1 / 8 = 0.0125. When a few records
   carry most of the weight, they are worth fewer records than there are, the way a poll that
   counts a few people many times over knows less than its headcount suggests. Kish's (1965)
   **effective number** says how many: the weights added up and squared, divided by the squared
   weights added up. Here 6.4 records' worth, from 12 records out.
4. The range is the usual Wilson range at that rate over that many records. It works at a rate
   of 0 too: the five general records alone, 0 silent errors, reach 43.4%.

With the golden set's own counts as the shares, every record weighs the same, and the rate and
range come back exactly as the headline's: the weighting adds nothing of its own. When no group
with a share sent anything out without review, nothing would go out on the mix and there is no
rate, as with no records out at all; a group with a share that sent nothing out lowers the
straight-through, adds nothing to the rate, and the report says so.

**What it cannot do.** It reweights the records tested; it tests nothing new. A group with few
records out gets a wide range however big its share: the five general records carry 90% of the
traffic above, so the range runs to 43.7%. A kind of record the golden set never tested cannot be
weighted at all, so a share for it stops scoring. Within a group, the records stand for that
group's real traffic only as well as they were chosen: hard cases picked inside a group still
make its rate a stress-test rate, which no weighting between groups can undo. The shares are
taken as known, with no range of their own. And the range counts every record as independent,
even with `clusters` (the report says so).

## A judge's answer key checked by a person

In production there is no answer key for most records. An AI judge (an LLM grader, run outside
the harness) can write one for every record, but it is wrong sometimes; a person can check only a
sample. `wfeval estimate` combines the two
([CONFIG.md](CONFIG.md#a-judges-answer-key-checked-by-a-person-wfeval-estimate)). Think of a
smoke alarm and an inspector: the alarm sorts every room into "smoke" and "no smoke", the
inspector visits some rooms of each kind, and the fire rate is each kind's share of the rooms
times the inspector's fire rate in that kind. A faulty alarm does not fool the count; it only
makes the inspector's job harder.

**What it estimates.** The silent error rate of records like these: the chance that a fresh record
out without review is a silent error, the same rate `score` reports, here for production records.
Its base, the records out without review ("records out" below), comes from the run's routes and is
known exactly. So the judge only needs to grade the records that went out without review: the
others never enter the rate, and grading them costs judge calls for nothing.

**How it is worked out.** Each key is scored against the run by the usual rules, so each record
out without review has the judge's verdict (it **flags** the record as a silent error, or
**passes** it) and, if checked, the person's. Then

- rate = W1 x p1 + W0 x p0

W1 is the share of the records out that the judge flags, p1 the person's silent error rate among
the flagged records they checked; W0 and p0 the same for the passed ones. In plain words: the
judge decides how big each group is, and the person's checks decide how wrong each group is. The
judge never sets a group's rate, only its weight, so its mistakes, in either direction, do not
bias the estimate (a poor judge widens the range), provided:

- the person picked the records **at random**, either from all the records out or within each
  verdict group (as `wfeval estimate --pick` does, [below](#which-records-to-check)); and
- the person checked them **without seeing the judge's verdict**.

The report states both every time; neither can be proved from the files.

For a statistician: this is post-stratification by the judge's verdict (Cochran 1977, sec. 5A.9;
Holt and Smith 1979), a two-phase sample (Neyman 1938; Cochran 1977, ch. 12), and equal to
stratified prediction-powered inference with the verdicts as strata (Fisch et al. 2024) and to the
regression estimator; plain PPI (lambda = 1; Angelopoulos et al. 2023) is not the same: on the
fixture it gives 25.0%, because the checks' two disagreements, E04 and E07, cancel
(`test/fixtures/estimate/EXPECTED.md`, "Plain PPI").

**The likely range** is MOVER, the method of variance estimates recovery (Zou and Donner 2008;
Newcombe 1998 combines Wilson ranges the same way for a difference). Three pieces move the rate:
W1 x p1, W0 x p0, and the share W1 itself, which is an estimate from the records out too
(rate = p0 + W1 (p1 - p0), so a point of share moves the rate by p1 - p0). Each piece gets its own
95% range: Wilson's for p1, p0 and the share. The rate's range runs from the rate minus the square
root of the pieces' squared distances down to their low ends, to the rate plus the same upwards.
One change to Wilson: in a group with 1 or 2 errors (3 past 50 checks), its low end is taken from
the exact binomial (Clopper and Pearson 1934) when that is lower, and the same for the high end
with 1 or 2 records fine. Wilson's low end sits too high there; Brown, Cai and DasGupta (2001)
show the dip and modify Wilson's end there in the same spirit (with a Poisson limit). The
hand-worked example is in `test/fixtures/estimate/EXPECTED.md`: 31.3%, likely 12.8-64.2%.

**The plain rule.** The shipped range held the true rate at least 94.5% of the time in every one of
648 simulated settings (97.4% on average). The other methods tried, PPI among them, fell far below
that somewhere. The evidence:

<details>
<summary>The simulation that chose the method, and its table</summary>

**Why this method: a simulation.** `node scripts/estimate-simulation.js` (seeded, about 20
seconds) draws 4,000 runs in each of 648 settings: a true rate of 1, 3, 8 or 15%; a judge that
catches 60, 80 or 95% of silent errors and passes 90, 97 or 99.5% of good records; 200, 1,000 or
5,000 records out; 30, 60 or 150 checks; and two ways of picking them (at random, or by the
judge's verdict: up to half the checks on the flags, the rest on the passes). Each run draws a
fresh set of records, so the share the judge flags varies as it would; each setting has its own
seeded stream of random numbers. The candidates, judged first on how often their 95% range holds
the true rate (in the worst setting and on average; under about 93% anywhere is out), then on how
often the range is zero wide, then on width:

| method | worst coverage | average coverage | settings under 93% | worst risky-side miss | zero wide | average width | runs with no estimate: average (most) | worst coverage, runs with an estimate |
|---|---|---|---|---|---|---|---|---|
| person alone, Wilson (random picks only) | 92.6% | 95.7% | 3 of 324 | 2.2% | 0.0% | 12.6 pts | 0 | 92.6% |
| PPI (lambda = 1), normal range | 18.4% | 90.0% | 259 of 648 | 81.6% | 0.2% | 8.5 pts | 0 | 18.4% |
| PPI++ (tuned lambda), normal range | 8.2% | 73.9% | 629 | 82.9% | 12.6% | 6.4 pts | 0 | 8.2% |
| post-stratified, normal range | 8.2% | 78.0% | 546 | 82.2% | 10.4% | 6.7 pts | 0 | 8.2% |
| post-stratified, Wilson over an effective number (Korn and Graubard 1998; Dean and Pagano 2015) | 17.6% | 89.6% | 289 | 81.0% | 0.0% | 8.1 pts | 0 | 17.6% |
| post-stratified, MOVER with Wilson's ends | 88.7% | 96.0% | 38 | 2.4% | 0.0% | 12.5 pts | 3.9% (72.3%) | 88.7% |
| **post-stratified, MOVER with exact ends at 1-2 errors (shipped)** | **94.5%** | **97.4%** | **0** | **2.4%** | **0.0%** | **12.8 pts** | **3.9% (72.3%)** | **94.5%** |
| Jeffreys prior, 400 seeded draws (1,000 runs per setting) | 86.3% | 95.5% | 57 | 5.3% | 0.0% | 10.4 pts | 3.9% (70.6%) | 85.9% |

A risky-side miss is a range wholly below the true rate, one that understates the errors; a 95%
range should do that about 2.5% of the time. **No estimate**: when a random sample leaves a verdict
group with no checks, the shipped method gives bounds, not an estimate (trap K3). That happens in
7.8% of the random-design runs on average, and in 72.3% of them in the worst setting (few flags
and 30 checks: often no flag among them); never by verdict, where every group gets checks. The
coverage columns score those bounds as ranges; the last column leaves them out, and the shipped
method still holds the true rate at least 94.5% of the time. The fallback methods (post-stratified
normal and effective-number ranges) use the person's checks alone there instead. The Jeffreys row is from
`node scripts/estimate-simulation.js --reps 1000 --jeffreys` (its draws are slow); the others are
from the default command. The normal ranges fail because rare errors often leave a group with no
error in its checks: its spread then reads as zero, and the range shrinks around a rate that is
too low. Plain PPI fails when the checks show no disagreement with the judge (no flag found fine,
no pass found wrong, common with 30 checks): its correction is then zero with no spread, and it
trusts the judge's share entirely.

</details>

Where the shipped method loses: it is conservative (97.4% on average, so its ranges are a little
wider than they strictly need to be), and the judge narrows the range only when it is good. Against
the person alone on a random sample, its range is 0.95 as wide on average: 0.53 at best (a 15%
rate, a judge catching 95% and passing 99.5%, 5,000 records out, 150 checks), 0.87 with that good
a judge, 1.02 with a judge catching 60% and passing 90%, and 1.15 at worst. The price of never
trusting the judge is that a poor judge costs a little width rather than accuracy. Its advantage
over the person alone is that it stays right when the checks are picked by the judge's verdict,
which is where the person alone is not a fair rate at all.

### Which records to check

**The plain rule.** Let `wfeval estimate --pick` choose the records. It splits the checks between
the judge's verdicts so the range comes out narrowest: when the judge flags a small share of the
records out (the usual case when errors are rare), most checks go to the records it passes; when
it flags many, more go to the flags. Do not check every flag first: that is the worst way found.

<details>
<summary>The simulation that compared ways of picking, and its table</summary>

Where a judge could pay off more is in which records the person checks. `node
scripts/estimate-designs.js` (seeded, about 40 seconds) compares ways of spending the same number
of checks, on the same grid, 4,000 runs per setting. In each run every design starts from the
same records out and the same judge's flags, and draws its own checks and what they find. The
grid's judges flag up to about 23% of the records out (a 15% error rate, a judge catching 95% and
passing 90%). All but the first use the shipped estimate and range. Width is given against the
person alone on a random sample, setting by setting (1.00 is as wide; 0.91 is 9% narrower):

| how the checks are picked | worst coverage | average coverage | settings under 93% | worst risky-side miss | average width | width against the person alone: average (best-worst) | against a random sample with the judge: average, worst, narrower in |
|---|---|---|---|---|---|---|---|
| random, the person alone | 92.8% | 95.7% | 3 of 324 | 2.1% | 12.6 pts | 1.00 | |
| random, with the judge | 94.6% | 97.6% | 0 | 2.4% | 11.7 pts | 0.95 (0.52-1.15) | 1.00 |
| by verdict, proportional | 93.0% | 97.4% | 0 | 2.6% | 11.5 pts | 0.93 (0.52-1.14) | 0.98, 1.01, 308 of 324 |
| by verdict, square-root shares | 94.7% | 96.9% | 0 | 1.9% | 11.5 pts | 0.93 (0.49-1.17) | 0.98, 1.04, 246 |
| by verdict, 10% on the flags | 92.6% | 97.4% | 1 | 3.0% | 11.8 pts | 0.95 (0.57-1.17) | 1.00, 1.27, 193 |
| by verdict, 20% on the flags | 93.8% | 97.1% | 0 | 2.7% | 11.5 pts | 0.93 (0.49-1.15) | 0.98, 1.13, 261 |
| by verdict, a third on the flags | 94.2% | 97.0% | 0 | 1.9% | 12.2 pts | 0.98 (0.50-1.33) | 1.03, 1.31, 145 |
| by verdict, half on the flags | 94.4% | 97.1% | 0 | 2.1% | 13.8 pts | 1.11 (0.56-1.65) | 1.16, 1.63, 64 |
| every flag, the rest random | 93.9% | 98.3% | 0 | 2.3% | 53.5 pts | 4.62 (0.77-24.41) | 5.00, 24.61, 58 |
| **by verdict, planned (`--pick`)** | **94.3%** | **97.2%** | **0** | **2.2%** | **11.3 pts** | **0.91 (0.50-1.12)** | **0.96, 1.02, 304** |

The random sample with the judge has no estimate, only bounds, in 7.8% of its runs on average
(71.9% at most), scored as ranges above; leaving those out, its worst coverage is still 94.6%.
Every by-verdict design checks both groups, so it always has an estimate.

</details>

What it shows:

- **Checking every flag is the worst idea, and the most tempting.** When the judge flags more
  records than there are checks, nothing is left for the records it passes, and their rate, which
  carries most of the weight, stays almost unknown: ranges 4.6 times as wide on average. Even half
  the checks on the flags is worse than a random sample. With rare errors, most of the range comes
  from the passes: no error in 20 checked passes still allows a rate near 16% among them, and they
  are most of the records. A Neyman split worked out with the normal approximation would put more
  checks on the flags, where the rate is most uncertain; that approximation misses how slowly the
  range of a group with no errors yet shrinks.
- **The planned split is best, by a little.** It is narrower than a random sample with the judge in
  304 of 324 settings, never more than 2% wider, and 4% narrower on average; 9% narrower than the
  person alone (6% at a 3% error rate, 14% at 8%, 18% at 15%; 3% wider at 1%, where nothing helps
  much). Its coverage is as good as any, and it never leaves a group unchecked.
- So the judge's real value with checks this few is modest either way. The gain grows with the
  error rate (0.50 against the person alone at best).

**The planned split.** Before anyone checks, only two things are known: how many records went out,
and how many the judge flags. The plan tries every split of the n checks (at least one in each
group, no group more than it has) and takes the one whose range would be narrowest if the checked
flags turned out half wrong (the widest a rate can be) and the checked passes all right (the
commonest case when errors are rare), worked out with the shipped range itself. For 10 checks on
the fixture's 20 records out, 5 of them flagged, it puts 2 on the flags and 8 on the passes
(`test/fixtures/estimate/EXPECTED.md` works a 4-check case by hand).

**The recommended way to pick.** `wfeval estimate --config c.json --pred run.json --judge-key
judge.json --pick 60 --seed 1` lists the 60 records to check: split by the plan, chosen at random
within each verdict group by a seeded shuffle (Fisher-Yates; the same seed always picks the same
records), and listed in the run's order so the list does not show which ones the judge flagged.
The person checks them without looking at the judge's verdicts and writes an answer key for those
records alone; `estimate --key` then reads it, and says whether the checks were split the way
`--pick` splits them. Checks picked another way are fine if they were picked at random from all
the records out or within each verdict group.

**Worth about N records checked by a person alone.** The number of random checks whose own Wilson
range, at this estimate, is as wide as this one: found by halving, since Wilson's width shrinks as
records are added. Above the number actually checked, the judge earns its keep.

**For contrast**, the report gives the judge alone (the judge's flags of the records out, as if it
were always right) and the person alone (the checks' own rate, with its Wilson range). The person
alone is shown as a fair rate only when the checks' share of judge flags is within chance of the
run's (|z| <= 1.96 against the run's share), as a random sample's would be.

**The judge's quality, on the checked records**: of the person's silent errors, how many the
judge flagged; of the judge's flags, how many the person confirmed; and Cohen's kappa
(stats.js). And every record where they disagree, to fix the judge with.

**A sample that looks non-random (trap K7).** Within each verdict group, the checked records'
places in the run are compared with a random pick's by the Wilcoxon rank-sum test (Wilcoxon 1945;
Mann and Whitney 1947; normal approximation), warned at |z| > 1.96, the same z as every range here:
the first 30 records, or the last, are what a pick by position looks like. An honest random pick
trips it about 1 time in 20 per verdict group: 3.5% to 5.1% across eleven group sizes from 8 to
5,000 records, 100,000 random picks each. So the warning says the checks *may* not be random; a
pick by anything other than position cannot be seen at all.

**`--target`.** Shown when the whole range is under the target. If not, and the estimate is under
it, a break-even guide: about how many extra checks, and how many in each verdict group, would
clear the target if each group's rate stayed where it is, allowing for the checks already made,
never more in a group than it has records left. First a search on a smooth projection (each
group's rate held exactly, with Wilson's ends): for each number of extra checks on the flags,
the fewest on the passes that clear it, by halving. Then that split is checked with the range
the report shows (whole errors, exact ends), adding a check at a time where it helps most until
it clears, so the guide never names a split the shown range would miss. The count is approximate,
and errs high: rounding can let a lucky split clear sooner. Like the break-even in `score --target`, it is not a plan: a fresh sample that size
lands under the target only about half the time. When no split of the records left would clear
the target, the report says so and why: these records out are too few to pin the rate down that
far, whichever group the checks go to (on the fixture, 20 records out). More records out are
needed, not more checks. The search stops past 200,000 extra checks on the flags, and says so.

**What it does not cover.** The silent error rate only (not silent omissions or unnecessary
reviews). No `--rulings`, `--mix` or clusters: the range counts every record as independent. A
group with no checked record has no estimate, only bounds: that group counted at 0% for the low
end and 100% for the high (trap K3), never a silent 0%.

## How many records would show a target

`score --target 5` asks whether the silent error rate is shown to be under 5%: whether its
whole likely range is. If not, it gives two numbers, in records out without review (and in
all records, at the run's straight-through rate):

- **The plan.** If the real rate is the one this run saw, how many records give an 80% chance
  (`--chance 0.9` or `0.95` for more) that a fresh test shows it. The chance is added up
  exactly from the binomial distribution, not estimated, and because whole-number counts make it
  zigzag as records are added, the plan is the size from which the chance never drops back under
  what was asked. Above about 5,000 records it is the textbook estimate alone (`exact: false` in
  `--json`), and the report says "a textbook estimate". It runs a little short of the exact size:
  on 38 generated cases, 0.1% to 6.7% under (median 0.9%, `python verify/check_stats.py`), so add
  a margin when a plan that size matters.
- **The hard minimum.** A perfect run: how many records with no silent error at all. At 5%,
  73; at 1%, 381. No test can show less, and the figure has no cap: at 0.0001%, 3,841,597.

When the rate seen is already at or above the target, no number of records can show it is
under; the report says the rate has to come down first.

Why not the size where this run's range would just clear the target? A fresh test of that size
often lands under the target only about half the time (error-rate-calculator measured 42% to
92%), because the next sample's rate wobbles. And
choose the number before testing: checking after every record and stopping as soon as the
range dips under the target makes the result look better than it is.

`wfeval rate 2 15 --target 5` gives the same for any count, without a run: a reviewer's spot
check, a production sample. The arithmetic is error-rate-calculator's, so the two tools agree.

## Straight-through rate

The share of all records that went out without review. The throughput number, and
meaningless alone: sending everything out scores 100%. It only means something beside the
silent error rate.

## Silent omissions

The other direction: records blocked or suppressed as duplicates that the answer key says
should have gone out or to a person. Nobody sees these either.

## Review precision

Of the records sent to a person, the share that needed one. A review queue full of records
nobody changes teaches reviewers to rubber-stamp, and then the review protects nothing.
Records sent to a person that could have gone out are listed as **unnecessary reviews**.

So are records sent to a person that the answer key blocks or suppresses: an email the key
files, a duplicate the key drops. Such a record must not go out (letting it out unseen is a
silent error), but it needs no person either: the workflow should leave it out on its own.
The report lists these apart, as "the answer key blocks or suppresses them" (`key_leaves_out` in
`--json`, of the records sent to a person), whatever their values.

That is the rule where the key's route counts (`wrong_when` `either` or `gold_route`). With
`any_mismatch` only the values decide, so nothing is left out this way: a record the key blocks,
sent to a person with its values right, is a plain unnecessary review, and with a value wrong it
needed the person.

## Block precision

Of the records blocked, the share the answer key also blocks. Only shown when the workflow
blocks anything.

## Safeguard failures

Records that went out without review although the workflow's own confidence gate or floor
should have held them. Reported beside the silent error rate, not inside it: the content may
happen to be right, but the next record through the same hole may not be. Each one is a bug
to find (see [SILENT_ERRORS.md](SILENT_ERRORS.md#safeguard-failures)).

## Precision, recall, F1

Per output, per value and overall. **Precision**: of the values the workflow applied, the
share the answer key lists. **Recall**: of the values the answer key lists, the share the
workflow applied. **F1** balances the two (1 is perfect). A value the workflow found but set
aside does not count as applied. Duplicates and records whose model call failed are left
out, and named.

For single labels: accuracy, per-label scores and a confusion matrix. For ordered labels (a
1-5 band): how far off each miss was (within one step, average distance), whether scores lean
high or low, and a closeness score where a near miss loses a little and a miss across the
scale loses everything. A near miss that goes out is a low-severity silent error; a far miss
is a high one.

## Any of these is right

When an answer key says any one of several values is right (`{ "any_of": [...] }`, a **slot**:
[CONFIG.md](CONFIG.md#any-of-these-is-right-and-equivalent-values)), the counting follows the
values the workflow actually applied, record by record:

- Every applied value that is in a slot is **right** (a true positive). If the workflow
  applied two values from one slot, **both count as right**: neither is a mistake.
- An applied value in no slot is **wrong** (a false positive), as before.
- A slot none of whose values was applied is **one miss** (a false negative), however many
  values it lists. The report shows it as `one of a, b, c`, or as `b (one of a, b, c)` when the
  model found b but set it aside.

Think of a slot as a seat at a table with several people who may sit in it: the seat is
taken if any one of them sits down, two of them squeezing in is still no mistake, and an
empty seat is one miss, not three.

That is the same as rewriting each record's answer key to the values it cited, which is what
projects did by hand before every run: the key is resolved per record. One consequence: what
recall is out of (right values plus misses) can change from run to run, because a slot filled
twice adds two right values and a slot filled once adds one. Precision and recall still mean
what they say; only their totals move. The floor what-if resolves the slots again at every
floor, since a different floor changes what was applied (`test/fixtures/alternatives/`).

Calibration counts a claim as right when its value is any of a slot's values, applied or set
aside, and `variance` never lists an alternative as a possible key gap: the key already has it.
Equivalent values (`equivalents`) are simpler still: they are read as one value before anything
is counted. Two of them in one prediction become one value, at the confidence the workflow acted
on (its highest applied copy's) and, for the floor and a "weakest" gate, its lowest applied
copy's: a merge never turns a weak applied value into a strong one.

## Declines

A label output can be allowed to decline (`decline` in the config): to say "none of these"
rather than guess. A decline is neither counted as a wrong label (that would make a workflow
that declines honestly look worse than one that guesses) nor dropped (that would let a
workflow that declines everything hard look perfect). Instead, five numbers, each with its
likely range:

| Number | Out of | Why |
|---|---|---|
| **Coverage** | all records | the share answered |
| **Accuracy when answered** | the answers | how good the answers are; it replaces accuracy for this output |
| **Declined** | all records | 100% minus coverage, stated plainly |
| **Unnecessary declines** | the declines | the answer key has an answer: what declining cost |
| **Answers that should have been declines** | the answers | the answer key says no label fits: overconfidence. Not measured when the key cannot say decline |

Read accuracy and coverage together: declining more raises one and lowers the other. In the
confusion matrix a decline gets its own column (and row, when the key can decline). Per label,
precision counts only what was given, so a decline is never a false positive; recall counts a
decline as a miss. Calibration leaves declines out: they claim nothing.

Routing applies as for any record. A wrong label or an answer that should have been a decline
going out is a high-severity silent error; a decline left out where the key has an answer is a
medium silent omission ([SILENT_ERRORS.md](SILENT_ERRORS.md#declines)).

## Free text, graded by a person

A free-text field (a paragraph of an assessment form filled from a visit transcript) has no
answer key to compare against, and its failure is a form that reads plausibly and says
something the person never said. So a person grades it: `wfeval grade` writes a page that
shows each field beside its source, and the reviewer gives each field one grade.

| Grade | Means | Severity |
|---|---|---|
| **faithful** | everything in it is supported by the source, and nothing it should hold is left out | |
| **invented** | it says something the source does not support | high: wrong information in a record someone will rely on |
| **missing** | it leaves out something the source says that belongs in it, and invents nothing | medium: incomplete, not false |

The grades are then scored as labels, each field one label out of three: the **invented
rate** and **missing rate** over all fields, per field and per section, and the share of
**forms with an invented field**, each with its likely range. A section pools its fields'
grades, so it counts fields, not forms; the per-form rate is the one to read for "how often
does a whole form need correcting". `--fail-on high` stops a build on any invented field.

**Why "figure altered" and "contradiction smoothed over" are not grades of their own.** They
are ways of inventing: a changed figure states a number nobody said; a smoothed-over
contradiction states one account as fact when two were given (and usually drops the other,
so it also leaves something out). As separate grades they would overlap with invented and
with each other, a field could earn two at once, and two reviewers could disagree on the
label while agreeing the field is wrong. Kept as three exclusive grades, every field gets one
label and agreement can be measured; the kinds are tick boxes on an invented grade, set in
the grading config, and counted in the report, so the diagnosis is not lost. A field that
both invents and leaves something out is graded invented (the worse) with the kind "also
leaves something out".

**Two reviewers.** With `--second-reviewer`, the report gives observed agreement, **Cohen's
kappa** (agreement beyond what chance would give: 1 is perfect, 0 is chance level) over the
three grades and on "invented or not" alone, and lists every disagreement for a person to
settle. With few fields, kappa is a rough guide; the disagreements are what matter.

The harness never grades anything itself: no model, no LLM-as-judge, no network. A person
grades; the harness counts.

## Agreement among graders

Every rate in this tool is measured against an answer key, and answer keys (and free-text
grades) are made by people. If three people would label the same records differently, the key's
"right answer" is shaky, and every rate measured against it inherits that. `wfeval agree` takes
two or more people's answer keys for the same records (or two or more grades files) and says how
far they agree, output by output.

**The measure: Krippendorff's alpha.** Cohen's kappa (used by `score --grades
--second-reviewer`) handles exactly two people who graded everything. Alpha handles any number of
graders, records that not everyone labelled, and values that are names, ordered levels or
numbers (Krippendorff 2004, 2019, *Content Analysis*; Hayes and Krippendorff 2007). It is
computed by the four steps of Krippendorff (2011), "Computing Krippendorff's Alpha-Reliability"
(src/metrics/agreement.js):

1. Each record labelled by two or more graders is a unit. A record labelled by one grader only has
   no one to agree with: it is left out and listed (trap M5).
2. Coincidences (a tally of which values were paired with which, over all records): within a record of m values, each ordered pair of two graders' values adds
   1 / (m - 1) to o(c, k), so every value counts once whatever m is. n_c is how many values are c,
   n all of them ("values that can be paired").
3. A difference delta(c, k) between two values (0 for the same value).
4. alpha = 1 - D_o / D_e: how much the graders disagree, against how much they would by chance. D_o = sum o(c,k) delta(c,k) / n the **disagreement observed** and
   D_e = sum n_c n_k delta(c,k) / (n (n - 1)) the **disagreement expected by chance**, given how
   often each value was used. 1 is perfect agreement, 0 is what chance alone gives. When D_e is 0
   (everyone used one value) alpha is 0 / 0: "not measurable", never 1 or 0 (trap M9).

The arithmetic reproduces the paper's worked example (4 observers, 12 units, 7 values missing):
nominal 0.743, ordinal 0.815, interval 0.849, ratio 0.797, all four pinned in test/agree.test.js.
It also matches an independent implementation, the Python package `krippendorff` (version 0.9.0; installed
in a throwaway environment outside the repository, never a dependency), on 400 random data sets
(nominal, ordinal, interval and ratio, 100 each; 2-6 graders, 5-80 records, 0-50% missing): the
largest absolute difference in alpha is 5.55e-16, and the one set neither could measure was the
same set (`node scripts/agree-crosscheck.js <python with krippendorff>`).

**How each output is compared.**

| Output | Compared as | Difference |
|---|---|---|
| label | names | 0 if the same label, 1 otherwise (nominal) |
| ordinal | the config's level order | ordinal: (the values on the levels from c to k, minus half of c's and k's) squared, so a miss across levels many values use counts more than one across an empty level. Krippendorff (2011), section D |
| set | sets of slots | Jaccard distance: the values one key lists and the other does not, out of the values either lists. MASI is given beside it |
| route | the routing gold field's class | nominal. Two decision names with one class (`publish`, `auto_publish`, both `auto`) are scored the same, so they agree |
| free-text grade | faithful / invented / missing | nominal; and "invented or not" alone, as `--second-reviewer` gives for two |

**Jaccard, not MASI, for sets.** MASI (Passonneau 2006) multiplies Jaccard's similarity by a
weight for how the sets relate: 1 for equal sets, 2/3 when one holds the other, 1/3 when they only
overlap. The harness scores a set value by value: a value one key lists and the other does not
changes one true positive, false positive or false negative, whether or not the sets nest. So the
disagreement that matters is the share of values the keys differ on, which is exactly Jaccard's
distance. Over every pair of subsets of five values, Jaccard depends on that share alone; MASI
gives two different distances for the same share in 6 of 20 cases (2 values differing out of 3:
0.778 for {a} against {a, b, c}, 0.889 for {a, b} against {a, c}). Both keep the triangle
inequality on all 32,768 triples (`node scripts/agree-set-distance.js`). MASI's alpha is reported
beside Jaccard's (`masi_alpha` in --json), so a reader used to it can compare.

**What counts as the same value in a key** (trap M13). Keys are read exactly as `score` reads
them, so equivalents are applied first: an alias and its group's first value agree. An `any_of`
slot is compared whole: `{ "any_of": ["a", "b"] }` agrees with another slot with the same
alternatives in any order, and differs from a plain `"a"`, since the two keys would score a
prediction of `b` differently. An empty set `[]` is an answer ("nothing applies"): wholly apart
from any non-empty set, the same as another `[]` (trap M10).

**Krippendorff's reading.** 0.800 and up: reliable. 0.667 to 0.800: tentative conclusions only.
Below 0.667: do not rely on it (Krippendorff 2004; Hayes and Krippendorff 2007; Krippendorff's bootstrap note suggests 0.800 as the minimum). For an answer key, a low alpha on an
output says its rates are measured against a shaky key: settle the listed disagreements first.

**Each pair of graders.** Alpha again for every two graders, on the records both labelled, so
the odd one out is visible (one grader who reads the guidelines differently pulls every pair
they are in down).

**Who differs: alpha without each grader.** With three graders or more, alpha again with each grader
left out in turn, like Cronbach's alpha-if-item-deleted; the report names the grader whose removal
raises alpha most. Chosen over each grader's average pairwise alpha because it is the headline
number itself, recomputed: it uses every remaining grader's values together, as alpha does,
weights records as alpha does when graders labelled different records (an average of pairs weights
each pair equally, however many records it shares), and it answers the question a team asks ("would
the key be more reliable without this person's labels?") in the units of the reading bands. With
three graders, alpha without one grader is the other two graders' pair alpha, so the two
diagnostics always name the same grader there. It shows who differs, not who is wrong: one careful grader among two
careless ones would be "the odd one out" too.

**A majority key** (`--write-key`): from three keys to one. Per record and output, the value most
graders gave; for a set, value by value (a value is in when more than half of the record's graders
list it, so {a, b, c} / {b, c} / {a} gives {a, b, c}: each value has 2 of 3). The trap, group,
cluster and duplicate fields are carried over by the same majority. A tie (for a set, a value listed
by exactly half), or a record labelled by one grader, is never decided by the tool: the record is
left out and listed for a person, and `score` stops on a prediction whose record has no answer (B4). A majority of two careless graders can outvote one careful
one, so the leave-one-out line and the list to settle are worth reading before the key is used.

**The disagreement line** gives D_o / D_e as a share ("25.4% of what chance alone would give"): the
same for every metric, where the raw values are not (an ordinal's are squared rank distances). Alpha
is 1 minus that share. The raw D_o and D_e stay in --json (observed, expected).

**The likely range, in plain words.** The records are re-drawn at random 2,000 times (some
twice, some not at all) and alpha is recomputed each time; the middle 95% of those alphas is the
range. A standard correction, BCa, adjusts it for alpha's lopsidedness (alpha cannot go above 1, so
its spread is uneven). For labels compared as names, when every compared record has exactly two
values (two graders, or more graders who each labelled in pairs), Krippendorff's own resampling is
used instead: it did better there, and only there. The same files always give the same range (seeded).

<details><summary>How the range is computed</summary>

The records are what was sampled, so they
are what is resampled: each of 2,000 resamples (`--resamples`) draws as many records as there
are, with replacement, keeping each record's values together, and recomputes alpha in full (for
ordinal data, the differences too). Seeded (`--seed`, default 1): the same files always give the
same range. Zapf et al. (2016, BMC Medical Research Methodology 16:93) recommend a bootstrap
interval for alpha. The range read off the resamples is **BCa**, bias-corrected and accelerated
(Efron 1987; Efron and Tibshirani 1993, ch. 14): the middle 95% of the resampled alphas (z = 1.96),
moved to correct for two things alpha does at small sizes. Its resamples sit off-centre from the
estimate (the bias, z0 = the normal curve's point for the share of resamples below the estimate,
ties counted half), and its spread changes with its value, since alpha is bounded at 1 (the
acceleration a, from the jackknife over records: alpha with each record left out once,
a = sum (mean - each)^3 / (6 (sum (mean - each)^2)^1.5)). The range is read at the shares
Phi(z0 + (z0 + z) / (1 - a (z0 + z))) for z = -1.96 and +1.96. Where BCa is undefined, it falls
back: every resample on one side of the estimate (z0 infinite) gives the percentile range; a
jackknife whose values are all the same gives a = 0 (bias correction alone); jackknife values
that are not measurable are left out of a.

</details>

**Which range, and when it is flagged** (plain rules; the evidence is folded below):

- names (labels, the route, grades) with exactly two values on every compared record:
  Krippendorff's bootstrap; everything else (ordinal and set outputs always) BCa
- a BCa range resting on fewer than 20 values that are not the most common value: the report says
  it is probably too narrow (trap M16)

<details><summary>The simulation behind these choices</summary>

**Chosen by simulation** (`node scripts/agree-coverage.js`, a few minutes). Four ranges, the first
three from the same resamples by the code that ships (`bootstrapIntervals` in agreement.js):

- **percentile**: the middle 95% of the resampled alphas (Efron and Tibshirani 1993, ch. 13)
- **BCa**: as above
- **log jackknife**: a normal range on log(1 - alpha) (1 - alpha is D_o / D_e, a ratio) with the
  jackknife's standard error; percentile where it is undefined
- **Krippendorff**: Krippendorff's own bootstrap ("Bootstrapping Distributions for Krippendorff's
  Alpha", 2006, revised 2016; the KALPHA macro of Hayes and Krippendorff 2007), which keeps D_e
  from the data and redraws only the pairs behind D_o (nominal settings only; one step of the
  note, a re-pick when a second pick repeats the first, is not clear and was left out)

58 settings: nominal data with 3 categories, 2, 3 or 5 graders, 20, 50 or 150 records, 0% or 20%
of values missing at random; plus ordinal and set data with 3 graders, 20 or 50 records and 20%
missing. How the values are made:

- **nominal**: each record has a true category; the most common one is the truth for 50%, 80% or
  95% of records ("true share"). Each grader gives the truth with chance 0.8, otherwise one of the
  3 categories at random (the truth included). So the most common category is a smaller share of
  the values given than of the truths: about 46.7%, 70.7% and 82.7% for true shares of 50%, 80%
  and 95%.
- **ordinal** (5 levels, true level 10/20/40/20/10%): a grader gives the true level with chance
  0.6, a level one away with chance 0.3, and a level at random with chance 0.1 (kept on the scale).
- **sets** (6 codes, each in the true set with chance 0.25): a grader drops each true code with
  chance 0.15 and adds each other code with chance 0.05.

The real alpha is alpha on 200,000 records of the same process. Each setting: 300 data sets, each
range from 1,000 resamples; data sets with no range at all (trap M15) are left out for every method
alike. Coverage is the share of ranges holding the real alpha (95% is right; the simulation error
of a share of 300 is about 1.3 points). Worst and mean coverage over the settings, then mean width:

| Range | Worst setting | Mean | Mean width | Worst at 150 records |
|---|---|---|---|---|
| percentile | 52.6% | 89.7% | 0.412 | 90.7% |
| **BCa** | **53.4%** | **91.8%** | 0.422 | **93.0%** |
| log jackknife | 53.0% | 90.1% | 0.476 | 90.7% |
| Krippendorff (54 nominal settings) | 64.7% | 86.4% | 0.424 | 64.7% |

By data and size (worst / mean over the graders and missing shares):

| Data | Records | percentile | BCa | log jackknife | Krippendorff |
|---|---|---|---|---|---|
| nominal, true share 50% (about 47% of values given) | 20 | 91.0% / 93.5% | 94.7% / 96.6% | 90.0% / 93.2% | 66.7% / 82.8% |
| | 50 | 92.7% / 94.4% | 95.0% / 95.8% | 92.3% / 94.6% | 74.0% / 85.0% |
| | 150 | 94.0% / 95.2% | 95.3% / 96.2% | 94.7% / 95.6% | 68.7% / 86.1% |
| nominal, true share 80% (about 71% of values given) | 20 | 86.6% / 90.0% | 90.4% / 94.1% | 86.3% / 90.7% | 71.7% / 85.4% |
| | 50 | 90.7% / 92.8% | 92.0% / 95.1% | 91.0% / 93.3% | 65.0% / 84.2% |
| | 150 | 91.7% / 93.9% | 93.0% / 94.6% | 92.7% / 94.6% | 64.7% / 84.0% |
| nominal, true share 95% (about 83% of values given) | 20 | 52.6% / 66.2% | 53.4% / 68.6% | 53.0% / 68.1% | 77.0% / 90.6% |
| | 50 | 84.0% / 85.4% | 86.3% / 88.0% | 84.7% / 85.9% | 70.0% / 89.6% |
| | 150 | 90.7% / 92.8% | 93.3% / 95.3% | 90.7% / 92.7% | 71.7% / 89.8% |
| ordinal | 20 | 94.3% | 93.3% | 92.3% | |
| | 50 | 94.7% | 94.3% | 93.7% | |
| sets (Jaccard) | 20 | 90.3% | 93.0% | 92.0% | |
| | 50 | 95.3% | 96.3% | 96.7% | |

BCa has the best worst setting and the best mean of the three ranges over records, for 2% more
width than percentile; it is used. Percentile beat it in 3 of the 58 settings (both ordinal ones,
and nominal at true share 80% with 5 graders and 150 records), each by 1.0 point or less, within
one simulation error.

Krippendorff's bootstrap, implemented as his note describes it (checked against the note again:
each unit draws its m(m-1)/2 pairs one by one, independently and uniformly, from all the data's
pairs), is a different story by number of graders. **With exactly two graders it is the better
range here**: worst 92.0% and mean 96.0% over the 18 two-grader settings, against BCa's 53.4% and
91.6%, and it beat BCa in 8 of them, mostly where one value dominates (where it is also much wider:
1.254 against 0.716 at true share 95%, 20 records and none missing). With 3 or 5 graders it is too narrow
(64.7-96.3%; 64.7% at 150 records), and more records do not fix it. The likely reason: drawing
every pair independently treats the pairs of one record as unrelated, when a record's values go
together; with two graders a record has exactly one pair, so nothing is broken. (That column is
the script's own code for the same algorithm, nominal only.)

With the shipped code, on the same data sets, `node scripts/agree-two-graders.js` compares the two
ranges whenever every record has two values (300 data sets per setting; nominal at true shares 50%,
80% and 95%, 20, 50 or 150 records; ordinal and sets at 20 or 50; 0% or 20% missing):

| Data | BCa worst / mean | Krippendorff worst / mean |
|---|---|---|
| nominal (18 settings) | 57.3% / 92.2% | **90.0% / 95.7%** |
| ordinal (4 settings) | **89.7% / 91.7%** | 79.7% / 85.5% |
| sets, Jaccard (4 settings) | **93.3% / 94.3%** | 90.0% / 91.8% |

So wfeval agree uses Krippendorff's bootstrap only for names (nominal) with exactly two values on
every compared record (two graders, or more graders who each labelled in pairs: the code tests the
records, not the number of graders), with q the share of its resamples below the threshold; BCa for
everything else. On ordinal data Krippendorff's bootstrap was clearly too narrow (79.7% at 20
records with 20% missing, against BCa's 89.7%); on sets it was a little behind BCa everywhere.

BCa ranges fail where there is almost nothing to resample: few values that are not the most
common one ("rare values"). `node scripts/agree-flags.js` (10,697 simulated data sets with a range,
3 to 150 records; 7,546 with a BCa range, 3,151 with Krippendorff's) groups them by that count. BCa
held the real alpha 30.0% of the time with 0-4 rare values, 77.6% with 5-9, 89.1% with 10-14, 92.8%
with 15-19, and 92.9-94.9% from 20 on, whatever the share or the number of records (very small sets
always have few). Krippendorff's bootstrap, used when every record has two values, held 98.1%, 96.3%
and 95.7% with 0-4, 5-9 and 10-14: it is not too narrow there. So only a BCa range on fewer than 20
rare values gets the note that it is probably too narrow (trap M16); BCa ranges it does not flag were
covered 94.5% of the time.

</details>

**The chance alpha is below 0.800, and below 0.667.** Hayes and Krippendorff's (2007) q, the
probability that the real alpha fails the threshold, read through the same mapping as the BCa
range so the two agree (Efron and Tibshirani 1993, ch. 14): with G the share of resamples below the
threshold, u = Phi^-1(G) - z0 and q = Phi(u / (1 + a u) - z0), the level at which the BCa range would
put its end at the threshold. Where BCa fell back to percentile, q is G itself. Resamples in which
every value is the same have no alpha; they are counted and left out of the range and the chances.

**No range at all** (trap M15), in the cases Krippendorff's bootstrap note says bootstrapping
does not apply to: alpha is 1 (every resample would be 1 too, and "1 to 1" from a handful of
records is the same overconfidence as a rate's "0 of 7, range 0 to 0"); every value but one is
the same (alpha is 0 by computation, and each resample either holds the odd value or has no
alpha); alpha not measurable; one record compared (every resample is that record again); and
every resample giving the same alpha (look-alike records: a range of zero width). The report says
which, instead of a range.

**The prevalence paradox** (trap M14). When one value is most of the values (a route almost
always `auto`), chance alone agrees almost as often as the graders do, so alpha can be low, even
0, while 80-90% of pairs agree: all the information is in the rare value. Alpha is right to say
the graders have not shown they agree on the rare value; raw agreement is right that they mostly
agree. When one value is 80% or more of the values and alpha is under 0.800, the report says so
plainly and gives raw agreement, the agreement chance alone would give (the share of pairs of
values drawn at random that would match) and alpha (Feinstein and Cicchetti 1990 describe the same paradox for kappa).

## Per trap

A golden set is built from traps: records designed to provoke one kind of mistake. Grouping
results by the answer key's trap labels shows which kind of trap gets through, which a
single rate hides. With `min_per_trap`, a trap with too few records stops the run: one record
passing a trap can be luck.

## Per group

The same rates for each value of one field (`groups` in the config, or `score --group-by`):
silent error rate, straight-through, review precision, silent omissions and routed as the answer
key says, each with its count and likely range. It exists for questions a single rate cannot
answer: did the prompt, tuned on one half of the golden set, do as well on the held-out half it
never saw? Does the workflow do worse on one kind of record (chat against email, one branch of
the workflow against another)? Each row is the headline's own arithmetic on that row's records,
so the rows and the headline cannot disagree.

A group is smaller than the run, so **its range is wider**: with one record in a group, one
mistake reads as 100% and none as 0%, and both ranges span most of the scale. Compare the ranges,
not the percentages: when two groups' ranges overlap widely, these records cannot tell the
groups apart (the queue fixture's two channels, 100% and 0%, overlap from 20.7% to 79.3%). A
record with several labels counts in each group, so the rows can add up to more than the
records; the report says when. And a group of a golden set built from traps is still a
stress-test rate, not the rate real traffic would see, however the group is chosen. With
`clusters`, a group's range still counts every record as independent
([above](#ranges-that-count-clusters)).

## Calibration

Does a stated confidence mean what it says? If the gate is 0.85, are claims stated at 0.85
right 85% of the time? Claims are grouped by stated value (models favour round numbers, so a
fixed 0.1-wide bucket would blur exactly the values that matter) and each group's accuracy
is compared with what was stated. The average gap is 0 for a perfectly calibrated model. The
config's own thresholds are checked too: how often were values below the floor actually right?

## Variance and compare

Identical code can produce different numbers from run to run, and one run cannot claim more
precision than that spread. `variance` measures it over repeated runs. `compare` judges a
change against it: a change no bigger than the spread of identical runs is "within noise",
a bigger one "beyond noise".

`variance` names **the figure to quote**: the worst run's silent error rate, with its likely
range. It never adds the runs together, and says how many different records the runs' totals
really are: on the metadata tagger's Golden 500, three runs sent out 615 records, but only 254
different articles. Added up, 44 of 615 gives a range of 5.4-9.5%; the worst run alone, 18 of
210, gives 5.5-13.1%.

**Silent in at least one run.** Different runs go wrong on different records, so `variance` also
counts the different records that were a silent error in at least one run, out of the different
records that went out without review in at least one, with the share's likely range (an idea
from Inspect AI's epoch reducers). It answers a different question from the worst run. The worst
run answers "how bad is one run?"; this count answers "how many records can this workflow get
wrong unseen, at least sometimes?". A record counted once stays counted whatever later runs do,
so the count only grows as runs are added: it is always given with its number of runs, and a
count from three runs is not comparable with one from ten. In the runs fixture
(`test/fixtures/runs/`), R2 was a silent error in runs a and c, and no other record in any run:
1 of the 3 records that went out in at least one of the 3 runs.

`variance` also lists **possible key gaps**: values the workflow states in every run that
the answer key does not list. Each is either the same mistake made every time, or a gap in
the answer key; the tool cannot tell which, so a person decides
([below](#possible-key-gaps-and-rulings)).

**Paired counts: judging a change without repeated runs.** Repeated runs cost money, and a
change replayed on fixed inputs has no noise to measure. But both runs scored the same
records, and only the records that changed say anything about the change. For each outcome
(silent errors, silent omissions, unnecessary reviews, routed against the answer key),
`compare` counts the records the change **fixed** and the ones it **broke**, and gives the
likely range of the change (Tango's paired score interval, 1998; its verdict agrees with
McNemar's test). It says **better** or **worse** only when that range clears zero, and
**unclear** otherwise. Run-to-run noise flips records both ways alike, so a change that
fixes far more than it breaks is real whether or not noise runs exist. On the compliance
reviewer's 40 documents, the prompt fix fixed 5 silent errors and broke none: better, with
no repeated runs. On the metadata tagger's Golden 500, from the v2 prompt's run to one of the
v3 guard's runs, 18 silent errors were fixed and 4 broken (better) while unnecessary reviews
rose by 31 (worse): the price, counted.

These are counts of records, not rates, on purpose: a rate's base moves when routes move. On
the queue fixture (`test/fixtures/queue/`) the silent error rate falls from 50% to 20% while
the same number of silent errors goes out: one fixed, one broken. The arithmetic is
error-rate-calculator's paired mode, so the two tools agree.

**Stopping a build that makes things worse.** `compare --fail-if-worse silent-errors,misroutes`
exits with code 3 when any outcome named is judged **worse**, and says which, with the records it
fixed and broke (`any` names every outcome the run measures; misroutes are the records routed
against the answer key). "Unclear" never fails the build: failing on it would fail nearly every
small change, since few records change, and "worse" already asks for more broken records than
chance would give. An outcome named that the run does not measure (silent omissions with no
correct route in the key) stops with an error rather than passing unchecked.

## Possible key gaps and rulings

An answer key can be wrong too: it can leave out a value that is right. The harness counts
every applied value the key does not list as wrong, so a gap in the key looks exactly like a
mistake by the workflow. Only a person reading the record can tell them apart.

**Possible key gaps.** `score` lists, from one run, every value the workflow applied that the
answer key does not list (repeated runs cost money); `variance` lists them across runs, those
stated in every run first. Both leave out what cannot be a gap: a value outside
`allowed_values` (invented, not missing from the key), a value inherited from another (it
follows from one already stated), a suppressed duplicate, a record whose model call failed,
and an alternative of an any_of slot (the key already has it). Stated in every run is still not
proof: the tiny fixture's R2 states the wrong SUBJ-ANTI in all three runs.

`score` marks each gap that sits on a silent error, and says whether adding it to the key would
clear that silent error (with every gap listed on that record added). Usually it would. But a
record the key routes to a person stays a silent error whatever its values: "stays one if
added: SP-SHOULD-REVIEW". No ruling on its values can change that.

**Rulings.** A person rules on each gap: **add** (the key is missing it), **reject** (it is a
mistake) or **pending** (not decided yet), in a rulings file with who decided and when
([CONFIG.md](CONFIG.md#rulings-on-possible-key-gaps---rulings)). The tool never edits the key.
Think of the answer key as a printed exam key and the rulings as the teacher's dated notes
clipped to it ("7b is also right"): whoever marks the exams reads the key and the notes, and
the report says the notes were used and which values they added. A rejected gap is never listed
again, only counted; an added one is part of the key from then on.

### The bracket for pending rulings

A pending value is counted as wrong: the strict reading, which gives the higher silent error
rate. `score` also scores the run again as if every pending ruling were an add, and prints the
two side by side, under the headline:

```
If the 2 pending rulings were all added to the answer key: 42.9% (3 of 7, likely 15.8-75.0%),
against 57.1% with them counted wrong. However they are ruled, the rate lands between the two.
```

Why it is a bracket: each pending value was applied by the workflow in this run. Adding an
applied value to the key can only turn a wrong value into a right one; it can never create an
error. So as pending rulings become adds, a record can only go from silent error to fine, never
back, and the records that went out without review (the rate's base) do not depend on the key
at all. Whatever the person decides, all add, all reject or any mix, the count lands between
the two figures: here, 3 or 4 of the same 7 records.

One exception, and the report names it. A pending value this run did **not** apply (stated in
another run, say) becomes, once added, a value the run should have given and did not: a miss,
which can create a silent error. Then "all added" is not the low end, and the line says how
many such values there are and that the two figures are not a bracket.

The bracket is checked, not assumed. `score` tries every way the pending rulings could be ruled,
record by record (a set value kept as the key has it or changed as proposed; a label pending with
`wfeval suspects`' verbs, any of the output's labels, not only the one proposed), and compares the
lowest and highest silent error rate with the two figures. When they differ, the line gives them:
"Ruled other ways, it could be anywhere from 42.9% (3 of 7) to 71.4% (5 of 7)" in the rulings
fixture with `rulings-unstated.json`. Only records that went out without review count: a pending
ruling on a record sent to a person, blocked or suppressed cannot move the rate, so it never makes
the two figures less of a bracket. With pending removes or label replaces the line reads "made as
proposed" instead of "added" ([below](#answer-key-suspects)); a label pending on "billing, replace
with shipping" whose run said "account" is no bracket, as ruling it "account" clears the record.

The bracket is about decisions; each figure's likely range is about chance. Both matter: in
the fixture, the open decisions move the count by one record, and chance alone allows each
rate a range more than 50 points wide (`test/fixtures/rulings/`).

### One run against two keys

`compare --key old.json --after-key new.json --before run.json --after run.json` scores the
same predictions against two answer keys. Routes do not change, so every change in the rates
comes from the key ("from the key" in the verdict column), and the paired table names the
records the new key turned from silent errors into fine (fixed) and the reverse (broke). It is
how to say how much of an apparent improvement was the key, as the compliance reviewer's key
review did by hand ([KEY_GAPS.md](../examples/compliance-reviewer/KEY_GAPS.md)). The two keys
must cover the same records, or it stops. Given two different runs, each change mixes the
workflow's and the key's, and a warning says so.

## Answer-key suspects

Every rate here assumes the answer key is right, and a key is written by people. A run shows a key
entry may be wrong wherever it disagrees with it, in three ways: a set value the run states that
the key does not list (a possible key gap, as above), a set value the key lists that the run does
not apply (the key may hold it wrongly), and a label the run gives in place of the key's. Each is a
mistake by the workflow or by the key; only a person reading the record can tell which.
`wfeval suspects` lists them all, ranked, so that a person with an hour rules on the likeliest key
errors first ([CONFIG.md](CONFIG.md#rulings-on-possible-key-gaps---rulings) for the rulings,
[READING_A_REPORT.md](READING_A_REPORT.md#in-the-terminal-answer-key-suspects-wfeval-suspects) for
the report).

**The plain rule.** A suspect ranks high when the workflow's answer would be surprising if the key
entry were right, judged by how the workflow does on the key's other records. In the metadata
tagger's run 70, the key lacks IND-SEMI on article B318 and the run states it at 0.85; on the 17
other articles where the run states IND-SEMI at 0.80-0.89, the key lists it all 17 times: a strong
suspect. In the compliance reviewer's runs 56-59, the key lacks IMPLIED_GUARANTEE on E20 and the
runs state it at 0.55-0.65 without applying it; of codes stated about that weakly, the key listed
0 of 3 at 0.50-0.59 and 1 of 6 at 0.70-0.79, which the tool reads, between the two, as about 15%:
a weak one. It works with one run; with several, agreement between them counts too.

**How it is worked out.** Think of two witnesses to the same event, the answer key and the
workflow, who disagree. Who to believe depends on how often each is right in the same kind of
situation; the key is right far more often overall, so the question is how unusual this
particular disagreement is for the workflow.

1. **The workflow's side, x.** For each disagreement, the workflow's confidence in its own side,
   averaged over the runs that give evidence for the record: a run that does not state the value,
   or gives another label, counts 0, so runs that agree count for more (self-consistency; Wang et
   al. 2023). A value stated with no confidence (a rule's output, such as the compliance reviewer's
   regex layer) counts 1. Then x falls in a bin: never, below 0.50, 0.50-0.59, ..., 0.90 or more.
2. **The output's calibration curve.** In each bin, how often the key sides with the workflow,
   pooled over the output's values (or labels): half a record added each way, made non-decreasing
   by pooling adjacent bins that dip (pool adjacent violators, as in isotonic calibration; Ayer et
   al. 1955, Zadrozny and Elkan 2002), read in a straight line between the bins' middles. A set
   output's curve starts at the never bin, so a confidence lower than any other record's is read
   toward "the key lists a value the workflow never states", not as the lowest bin above it. A value
   read off the curve is an estimate, mostly between two levels, so the report gives the levels and
   counts first, then the reading, and says why the two differ: "it listed 9 of 11 at 0.80 or more;
   with so few records, the tool reads that as about 77%" (fewer than 20 records in the counts read,
   where the half record each way shows), or "reading between them" when it lies between two levels.
3. **The weight.** Every suspect's weight is the odds that its key entry is wrong, up to one factor
   shared by all of them, if the key leaves out a share e of the values that belong and wrongly
   lists the same share e of the values it lists (Bayes' rule: posterior odds are prior odds times
   the likelihood ratio, how much more often the workflow answers this way when the entry is wrong
   than when it is right). The two kinds of set entry start from different priors, so their weights
   have different forms:
   - *The key lacks a value*: the odds q / (1 - q), where q is how often the key lists this value on
     the other records where the workflow states it in the same bin, shrunk toward the curve at x by
     5 records' worth (an empirical-Bayes prior: a value seen on 2 records does not swing to 0 or
     100%). q / (1 - q) is the likelihood ratio times the value's base-rate odds (how often the key
     lists it, against not): an unlisted value belongs with a prior chance of its base rate times
     e, so a common value's absence is likelier to be a gap than a rare one's.
   - *The key lists a value*: the likelihood ratio alone, f0 / f1: how much more common the
     workflow's answer (never stating it, or stating it in that bin) is on records whose key lacks
     the value than on the other records whose key lists it, each share shrunk 5 records' worth
     toward the output's share. A listed value is wrong with a prior chance of e whatever its base
     rate, so no base-rate factor. Confidence says nothing about a value the workflow never states;
     how rarely it misses this value does. In run 70 the key lists GEO-US on article A18 and the run
     does not state it, where on the 156 other articles whose key lists GEO-US it stated it every
     time: the first suspect of that run.
   - *A label*: the odds C / (1 - C), with C the label curve at x.

   The equal share e for the two kinds is an assumption nothing in the files can check, and it
   decides how the kinds interleave. Putting both kinds on the likelihood ratio alone ("ratio alone"
   below) was compared and kept out: it does better on one dataset and far worse on the other.
4. **Leave-one-out.** Every count and every curve leaves the suspect's own entry out: otherwise the
   key's own entry would vouch for itself (a label the key gives would count as agreeing). With
   `duplicate_of_field` or `clusters` in the config, the rest of the suspect's duplicate group or
   cluster is left out altogether too: a retelling whose key entry was copied would otherwise vouch
   for its original (in the suspects fixture, a copy of T7 drops T7's weight from 6.66 to 3.22).

Ties go to the stronger answer from the runs, then the key's record order. The report gives each
suspect's numbers in plain words (the why line); `--json` gives them all, with the weight.

<details>
<summary>The comparison that chose the ranking, and its tables</summary>

**The candidates.** `node scripts/suspects-eval.js` (seeded; about half a minute) ranks the same
suspects nine ways. x is as above. Every ranking that reads the key's other records leaves the
same records out as the shipped one.

- **runs**: how many runs disagree with the key; ties in the records' order. The order `variance`
  lists possible key gaps in today (trap I7).
- **confidence**: the model's confidence on its side: its mean where it states the value or label;
  for a value the key lists, 1 - x.
- **CL self** and **CL margin**: confident learning (Northcutt, Jiang and Chuang 2021, "Confident
  Learning: Estimating Uncertainty in Dataset Labels", JAIR 70:1373), each value a class of its own:
  a disagreement counts when x reaches the value's per-class threshold, the average x on the records
  where the key agrees; counted ones first, each group ranked by self-confidence (the model's
  probability for the key's side, lowest first) or by the normalized margin (the key's side minus
  the best other).
- **average**: x alone: agreement across runs and confidence in one number.
- **per cell**: the key's agreement measured leave-one-out, per value and bin, shrunk 5 records'
  worth toward the output's bin: for a gap and a label q, for a listed value 1 - q.
- **per entry**: the same evidence on the odds scale above.
- **ratio alone**: per entry, with a gap weighed by its likelihood ratio f1 / f0 alone, as a listed
  value is: without the value's base-rate odds.
- **shipped**: per entry, with a gap's estimate shrunk toward the output's curve and a label read
  from the curve alone.

**Scored by** average precision (AP: 1 when every key error is above every other suspect; a random
order scores about the share of key errors) and precision at the top 10 (the share of key errors
among the first ten suspects a person reads). Ties are scored as their average over every order
within the tie (McSherry and Najork 2008), so no ranking gains from the order the records happen
to be in.

**(i) Real ground truth: the compliance reviewer's 25 rulings.** On the v1 key that its run files
carry, a person ruled on 25 possible key gaps (`examples/compliance-reviewer/rulings.json`): 9 adds
(the key was missing them) and 16 rejects (the model's mistakes). Only those 25 are ranked; AP, then
precision at 5 and 10:

| ranking | prompt v2, one run (56-59, each) | prompt v2, runs 56-59 | prompt v1, one run (50-52, each) | prompt v1, runs 50-52 |
|---|---|---|---|---|
| runs | 0.44, 0.36, 0.36 | 0.44, 0.36, 0.36 | 0.46, 0.38, 0.38 | 0.51, 0.44, 0.44 |
| confidence | 0.40, 0.20, 0.42 | 0.41, 0.20, 0.40 | 0.41, 0.18, 0.44 | 0.40, 0.20, 0.45 |
| CL self | 0.38, 0.20, 0.38 | 0.40, 0.20, 0.40 | 0.39, 0.20, 0.41 | 0.40, 0.20, 0.40 |
| CL margin | 0.38, 0.20, 0.38 | 0.40, 0.20, 0.40 | 0.39, 0.20, 0.41 | 0.40, 0.20, 0.40 |
| average | 0.40, 0.20, 0.42 | 0.41, 0.20, 0.40 | 0.41, 0.18, 0.44 | 0.42, 0.20, 0.50 |
| per cell | 0.48, 0.44, 0.45 | 0.52, 0.40, 0.50 | 0.39, 0.20, 0.44 | 0.38, 0.00, 0.40 |
| per entry | 0.48, 0.44, 0.45 | 0.52, 0.40, 0.50 | 0.39, 0.20, 0.44 | 0.38, 0.00, 0.40 |
| ratio alone | 0.45, 0.45, 0.37 | 0.42, 0.40, 0.20 | 0.38, 0.40, 0.27 | 0.40, 0.20, 0.40 |
| **shipped** | **0.42, 0.18, 0.45** | **0.43, 0.20, 0.50** | **0.40, 0.20, 0.43** | **0.39, 0.20, 0.40** |

A random order of 9 adds among 25 scores AP 0.44 on average, and 95% of random orders fall between
0.28 and 0.67 (10,000 seeded orders). **No ranking does better than chance here.** Today's order
beats the shipped ranking in all four columns (0.44-0.51 against 0.39-0.43) and scores highest of
all in the two prompt v1 columns, within chance; the per-cell and per-entry rankings score highest
in the prompt v2 columns (0.48 and 0.52), within chance too; the shipped ranking is below the chance
average of 0.44 in all four. The prompt v1 runs state 21-23 of the 25
(on average 8.3 adds in 21.7, one run at a time).

**(ii) Errors put into the real 500-record keys.** In each repetition, errors are put into the
answer key of a real 500-record golden set, at 1% or 3% of its values, and every real disagreement
of the real runs stays as a distractor. The kinds: a value **dropped** from the key; a wrong value
**added**, either one the model **confuses** with a value the record has (one it states wrongly on
records whose key lists that value: the mistake a person makes too) or **any** allowed value; a value
**swapped** for one the model confuses with it. Nobody knows the mix of a real key's errors, so three
mixes of the four (dropped / added, confusable / added, any / swapped): a quarter each; **drop-heavy**,
60/10/10/20, since the one real key review here found missing values only (its 9 adds); and
**add-heavy**, 10/50/30/10. 20 seeded repetitions per cell. AP, 1% / 3%:

| ranking | metadata, one run: quarters | drop-heavy | add-heavy | metadata, three runs: quarters | drop-heavy | add-heavy | compliance, one run: quarters | drop-heavy | add-heavy |
|---|---|---|---|---|---|---|---|---|---|
| runs | 0.14 / 0.30 | 0.13 / 0.29 | 0.14 / 0.29 | 0.21 / 0.42 | 0.20 / 0.41 | 0.21 / 0.41 | 0.03 / 0.05 | 0.02 / 0.04 | 0.02 / 0.04 |
| confidence | 0.26 / 0.50 | 0.21 / 0.42 | 0.31 / 0.54 | 0.42 / 0.66 | 0.33 / 0.58 | 0.48 / 0.71 | 0.06 / 0.11 | 0.05 / 0.08 | 0.07 / 0.12 |
| CL self | 0.26 / 0.50 | 0.21 / 0.42 | 0.31 / 0.54 | 0.42 / 0.67 | 0.35 / 0.59 | 0.49 / **0.72** | 0.06 / 0.11 | 0.05 / 0.08 | 0.07 / 0.12 |
| CL margin | 0.26 / 0.50 | 0.21 / 0.42 | 0.31 / 0.54 | 0.42 / 0.67 | 0.35 / 0.59 | 0.49 / **0.72** | 0.06 / 0.11 | 0.05 / 0.08 | 0.07 / 0.12 |
| average | 0.26 / 0.50 | 0.21 / 0.42 | 0.31 / 0.54 | 0.41 / 0.66 | 0.33 / 0.57 | 0.48 / 0.71 | 0.06 / 0.11 | 0.05 / 0.08 | 0.07 / 0.12 |
| per cell | 0.38 / 0.57 | 0.35 / 0.49 | **0.39 / 0.57** | 0.55 / 0.73 | 0.52 / 0.68 | **0.55** / 0.71 | 0.31 / 0.42 | 0.15 / 0.24 | 0.52 / **0.60** |
| per entry | 0.37 / 0.57 | 0.45 / 0.58 | 0.32 / 0.50 | 0.53 / 0.71 | 0.57 / 0.74 | 0.49 / 0.64 | **0.36 / 0.48** | **0.23 / 0.30** | **0.53 / 0.60** |
| ratio alone | 0.36 / 0.52 | **0.51 / 0.64** | 0.28 / 0.42 | 0.43 / 0.58 | 0.54 / 0.69 | 0.33 / 0.48 | 0.11 / 0.17 | 0.15 / 0.21 | 0.04 / 0.11 |
| **shipped** | **0.41 / 0.60** | 0.46 / 0.59 | 0.37 / 0.53 | **0.59 / 0.74** | **0.61 / 0.75** | **0.55** / 0.68 | 0.35 / **0.48** | **0.23 / 0.30** | **0.53 / 0.60** |

Over those 18 cells, the shipped ranking is the best in 12 (ties included) and never more than 0.05
below the best; per entry is best in 6 and at most 0.08 below; per cell is best in 4 and up to 0.16
below (metadata, one run, drop-heavy 1%); ratio alone is best in 2 and up to 0.49 below (compliance,
add-heavy 1%); the confidence-based rankings and today's order are best in at most 1 and up to 0.56
below. Precision at 10, one run, quarters, 1% / 3%: runs 0.12 / 0.29, confidence 0.23 / 0.48, per
cell 0.31 / 0.48, per entry 0.48 / 0.74, ratio alone 0.54 / 0.86, shipped 0.45 / 0.77 (metadata);
0.01 / 0.03, 0.03 / 0.10, 0.20 / 0.53, 0.21 / 0.60, 0.11 / 0.21, 0.21 / 0.60 (compliance).
"One run" is each of the metadata tagger's runs 70, 71 and 72 alone (one prompt version), averaged;
"three runs" is the three together; the compliance reviewer has one run, 67. Its run states 294
values the key lacks and misses 78 it lists, so 5 errors at 1% sit among 375 suspects. AP for each
kind alone, metadata one run, 3%:

| ranking | dropped | added, confusable | added, any | swapped |
|---|---|---|---|---|
| runs | 0.24 | 0.28 | 0.28 | 0.40 |
| confidence | 0.30 | **0.56** | 0.57 | **0.59** |
| CL self, CL margin, average | 0.30 | 0.56 | 0.57 | 0.59 |
| per cell | 0.33 | 0.40 | **0.68** | 0.53 |
| per entry | 0.47 | 0.32 | 0.47 | 0.55 |
| ratio alone | **0.74** | 0.27 | 0.34 | 0.56 |
| shipped | 0.46 | 0.33 | 0.51 | 0.56 |

How many errors can be seen at all: a key error the runs agree with makes no disagreement, so no
ranking can list it. At 1%, 86% of the errors were suspects with the quarters mix (metadata, one
run), 80% drop-heavy and 90% add-heavy; 89% with three runs; 89% on the compliance key; a dropped
value alone 75-80% on the metadata key (the rest the model left out too) and 90-93% on the
compliance key; a value added at random 93-98%.

**(iii) Labels, simulated.** Neither real example has a label output, so a simulated workflow
stands in: 500 records, six labels in three pairs the model confuses, a quarter of the records hard
(wrong 45% of the time, else 6%), a wrong answer the record's habitual one 80% of the time (so runs
repeat their mistakes), confidences in steps of 0.05, right answers more confident than wrong ones
with overlap; key labels changed at 1, 3 and 5%, to the confusable label or to any. 100 seeded
worlds per cell. AP:

| ranking | one run: confusable 1% / 3% / 5% | one run: any 1% / 3% / 5% | three runs: confusable | three runs: any |
|---|---|---|---|---|
| runs | 0.10 / 0.19 / 0.26 | 0.10 / 0.20 / 0.28 | 0.32 / 0.51 / 0.61 | 0.40 / 0.60 / 0.70 |
| confidence | 0.38 / 0.49 / 0.57 | 0.37 / 0.46 / 0.57 | 0.21 / 0.33 / 0.41 | 0.18 / 0.32 / 0.40 |
| CL self | 0.38 / 0.49 / 0.57 | 0.37 / 0.46 / 0.57 | 0.68 / 0.78 / 0.83 | **0.76 / 0.84 / 0.89** |
| CL margin | 0.38 / 0.49 / 0.57 | 0.37 / 0.46 / 0.57 | 0.68 / 0.79 / 0.83 | 0.74 / 0.83 / 0.88 |
| average | 0.38 / 0.49 / 0.57 | 0.37 / 0.46 / 0.57 | 0.68 / 0.78 / 0.83 | 0.71 / 0.78 / 0.84 |
| per cell, per entry | 0.27 / 0.40 / 0.48 | 0.27 / 0.38 / 0.48 | 0.57 / 0.67 / 0.72 | 0.59 / 0.66 / 0.73 |
| **shipped** (and ratio alone) | **0.38 / 0.49 / 0.57** | **0.37 / 0.46 / 0.57** | **0.68 / 0.77 / 0.82** | **0.71 / 0.78 / 0.84** |

</details>

What it shows:

- **On the real rulings, nothing beat chance.** Today's order scored above the shipped ranking in
  every column, and highest of all in two, within chance; the shipped ranking scored below the
  chance average in every column. The errors in that key
  were systematic (below), and 25 rulings cannot tell the rankings apart.
- **On the injected errors, no ranking wins everywhere; the shipped one comes closest.** It is best
  in 12 of the 18 mixed cells and never more than 0.05 below the best, where every other ranking
  falls further behind somewhere. Where it is not best, it says so in the table:
  - **Errors mostly missing values** (drop-heavy, the kind the one real review found): the shipped
    ranking is best with three runs (0.61 / 0.75) and on the compliance key (level with per entry),
    but on single metadata runs the likelihood ratio alone does better (0.51 against 0.46 at 1%),
    a ranking that falls to 0.15 on the compliance key.
  - **Errors mostly wrong values added** (add-heavy): the per-cell agreement does slightly better on
    the metadata tagger (0.39 against 0.37 at 1%, one run; confident learning 0.72 against 0.68 at
    3% with three runs), and level on the compliance key.
  - **One kind alone**: a wrong value added that the model confuses (0.56 for plain confidence
    against 0.33) or any value added (0.68 for per cell against 0.51) is ranked better by others;
    a dropped value by the likelihood ratio alone (0.74 against 0.46).
- **The model's confidence ranks each kind well on its own and merges them badly.** A value the key
  lists that the workflow never states gets 1 - x = 1, so every such miss sits above every gap; on
  the compliance reviewer, its rule layer's statements (no confidence, counted 1) fill the top.
- **Confident learning's thresholds add nothing with one run.** The workflows state one confidence
  per value, so for each value the question is binary, and CL's rankings come out as plain
  confidence. With three runs on labels its self-confidence is the best ranking of all on labels
  changed at random (0.84 against 0.78 at 3%).
- **On labels, the curve keeps the model's own order.** Estimated label by label, the key's agreement
  was noisier than the confidence it estimates (0.27-0.48 against 0.37-0.57 with one run), so labels
  are read from the output's curve alone, which ranks exactly as the averaged confidence does and puts
  labels on the same scale as values. Plain confidence (the mean only where a run gives the label)
  falls below today's order with three runs (0.18-0.41 against 0.32-0.70).

**Where it loses, and why it is kept.** The shipped ranking is not the best for every kind of key
error, and the real mix of a key's errors is unknown. It is kept because it is never far from the
best across both datasets, one run or three, and every mix tried, where each alternative that beats
it somewhere falls well behind elsewhere. With several runs on labels, confident learning's
self-confidence (how much of the runs' confidence is left for the key's label) ranked labels changed
at random higher (0.84 against 0.78 at 3%); it is not on the common scale, so it is not shipped, and
the gap is stated here.

**What a synthetic test cannot show.** The injected errors are spread at random, one record at a
time. Real key errors can be systematic: the compliance reviewer's v1 key left out the codes the
model stated on its LLM-judged documents, document after document, and the model's 16 real mistakes
were systematic too (re-coding a rule layer's code under its "implied" twin). Measured against the
key itself, a value the key systematically leaves out looks like a value the workflow systematically
over-states, and no ranking built from the key can tell them apart: on the real rulings above, no
ranking beat chance. The suspects list finds the errors a run disagrees with; a person decides
every one, and a pattern a person finds (the same code missing on every document of a kind) is a
reason to read the rest of that kind, whatever their rank.

**Routes are out of scope.** The route (`routing.field`, and a label output that is the route) is not
a suspect: a route is decided by the workflow's rules and thresholds as much as by the model, so a
disagreement with the key's route says more about the routing than about the key, and the routing
types already list every such record. A wrong correct-route in the key is found by reading the
silent errors and unnecessary reviews, and changed in the key file itself, compared with
`compare --after-key`.

## What-if

What would the numbers be at another threshold? A threshold change can only move a record
whose route the confidence gate decided, so the what-if moves only those (named by
`whatif.movable_field`; without it, it assumes every record that went out or was sent to a
person is movable, and says so). At the current threshold it must reproduce the actual
routes, or it reports that its assumption is wrong. It shows the silent error count beside
the rate, because a rate can fall only because correct records joined the denominator, with
no error prevented.

### A certified gate

The gate sweep shows the silent error rate at every gate, and the natural move is to pick the
loosest gate that looks under the target. But the sweep tried eleven gates, and one of eleven
can look good by luck alone. Trying twenty keys and announcing the one that opened the lock
proves less than one key that opens it the first time: the golden set flatters the gate picked
from it (trap E9).

`whatif --gate --target 5` certifies gates instead, the way Learn then Test does (Angelopoulos,
Bates, Candès, Jordan and Lei, 2021, arXiv 2110.01052). For each gate it asks: if this gate's
true silent error rate were 5% or more, how often would so few silent errors turn up among the
records it let out? That chance is the gate's p-value, worked out exactly (binomial). The 5%
allowed for being wrong (1 - confidence) is shared among the gates tried, and a gate is
**certified** when its p-value is at most its share: 0.05 / 11 with eleven gates (Bonferroni).
Then the chance that *any* certified gate is really at or above the target is at most 5%.
`--confidence 0.99` holds that to 1% (0.9, 0.95 and 0.99 are the choices; 0.95 is the default).
A gate that let nothing out is never certified.

The report adds a **certified** column and names the loosest certified gate (the most
straight-through; when several let out the same records, the strictest of them, because the
golden set has no records between them to test the looser ones on). It also names a looser gate
that only looks under the target read alone. When no gate is certified, it gives the fewest
records out without review, none of them a silent error, that a gate would need.

On the gate fixture (`test/fixtures/gate/`, 60 articles), against a 30% target:

```
node bin/wfeval.js whatif --config test/fixtures/gate/config.json \
  --pred test/fixtures/gate/predictions.json --key test/fixtures/gate/key.json --gate --target 30
```

By the rate alone, every gate from 0.65 up looks under 30% (0.65 lets out 12 silent errors in 42,
28.6%). By the likely range, 0.75 does (3 of 30, reaching 25.6%). Neither is certified: 0.75's
p-value, 0.0093, would pass as the only gate tried, but not as one of eleven (0.0045). The
loosest certified gate is 0.80: 1 silent error in 24, with 40% straight-through. The fixture's
EXPECTED.md works every p-value out by hand.

What the guarantee rests on, and the report says each:

- **Records like these.** It holds for records drawn the way the golden set's were. A golden set
  built from traps gives a stress-test guarantee, not one for real traffic.
- **The what-if's assumption** about which records the gate can move (printed at the top).
- **Every gate looked at.** The count is of the gates in this sweep. Sweeping again over a
  narrower range after seeing the first sweep is still picking from many.

Why each gate is tested on its own (Bonferroni) rather than in order from strictest to loosest
(Learn then Test's fixed sequence, which pays nothing for the number of gates but stops at the
first gate that fails): the strictest gates let out few records or none, so the sequence would
stop at once and certify nothing.

### Routing policies

The gate takes one threshold per output, so the gate what-if cannot ask "what if award claims
always went to a person?" or "what if each client's threshold were capped at 0.85?". `whatif
--policies <file>` (and `--hold-if`) asks those, for several policies side by side with the run
as it was. The file's format is in [CONFIG.md](CONFIG.md#routing-policies-whatif---policies---hold-if).

**Hold-if is exact.** A hold-if rule sends a record that went out without review to a person when
a condition on what the workflow stated holds. It changes that record's route from auto to
review and nothing else: no value, no answer key, no other record's route. So the judgments that
do not read the route cannot change, and the ones that do move exactly as they would on a real
run with the rule in place (`judge.js`, `routing.js`):

- a silent error and the safeguard checks (SG-GATE, SG-FLOOR) count only for records that went
  out: a held record has neither, because a person saw it;
- whether the record was routed as the answer key says (a misroute): a held record whose correct
  route is review is now routed right, one whose correct route is auto is now routed wrong;
- an unnecessary review counts for a record sent to a person that needed none: a held record that
  needed none becomes one;
- silent omissions read only blocked and suppressed records, and the duplicate checks only which
  records were suppressed: a hold touches neither;
- a record whose model call failed, a label output and a decline are held or not on what they
  stated, and are otherwise left as they are.

`test/policy.test.js` checks this on every record: under each hold-if policy, every judgment of
every record not held is identical, and a held record differs only in its route, its silent
error, its safeguards, whether it was an unnecessary review and whether it was routed as the key
says. The same invariant is checked on the compliance golden 500 (each policy in its
policies.json) and on the tiny fixture. So a hold-if policy can fix
silent errors and add unnecessary reviews, never the reverse. The one thing it takes on trust is
the rule itself: that the workflow could apply it after routing, and that a person who sees a
held record would catch what is wrong with it (the same trust every review route gets).

**Threshold changes are not.** `auto_publish` and `auto_publish_cap` re-decide the gate, as the
gate what-if does, and rest on its assumption about which records the gate can move (no
`whatif.movable_field`: an upper bound). Each row says which kind it is: "exact" or "assumes the
gate decided". When any policy changes a threshold, the report runs the gate what-if's self-check
at the config's own gates and prints CHECK FAILED, naming the records, when the simulation does
not reproduce the real routes; a record whose gate is unknown is listed as not checked, never
counted as reproduced. "Moved by the gate" counts the records the threshold change moved, either
way, before any hold. In a policy with both, the threshold change comes first and the hold-if second,
so a record the new gate lets out is still held: "always goes to a person" means always. The
other order would let a looser gate release a held record.

**How conditions combine.** A list of conditions, any of which holds a record; the clauses
inside one condition must all hold; `{ "all": [...] }` groups conditions that must all hold. In
plain words: "this and that, or this other thing". Any rule built from the clauses with "and" and
"or" can be rewritten that way, so nothing a routing rule needs is out of reach.

<details><summary>Why not a simpler or a fuller form</summary>

A flat list of "and" clauses could not say "award claims, or anything stated at 0.85 or more"
(the compliance "Both" row). A full expression language with nesting and "not" would say nothing
more here, since every clause can already be turned round (`applied: false`, `below` beside
`at_least`). Logicians call an "or" of "and" groups the disjunctive normal form.

</details>

**A value with no confidence never meets `confidence_at_least`.** In the compliance run the
regex layer's findings carry no confidence and the model's do. The compliance project's "every
note goes to a person" means the model's findings: holding every record that states a value with
a confidence (`violations=*@0`) gives 0 silent errors in 211 and 46 unnecessary reviews, its
published figures; holding every record that states any value (`violations=*`) gives 0 in 204
and 53, which it did not publish. Reading "no confidence" as 0 or as 1 would have broken that,
and either would be a guess.

**Each record's own threshold.** `thresholds.auto_publish` may name a prediction field, so the gate
check, SG-GATE and the what-ifs read each record's own threshold (a client's). The gate sweep then
gives one threshold to every record in place of its own, which is what "the gate at 0.80" means;
its check runs at each record's own threshold, so it still says whether the movable assumption
reproduces the real routes. Lowering each record's own threshold is a policy (`auto_publish_cap`:
the lower of its own and the cap) rather than a sweep, so that each cap tried is counted.

**Paired against the run as it was.** Each row is paired with the run, record by record: the
silent errors it fixed and broke, the unnecessary reviews it added and removed, and Tango's
likely range of each change in points of all records (`pairedDifference`, as `compare` uses it;
trap I9). Counts, not rates, because a policy moves the rate's base: holding a correct record
lowers the rate's denominator with no error prevented.

**Certified policies.** With `--target`, every row (the run as it was included) is tested as the
gate what-if tests gates ([above](#a-certified-gate)): an exact binomial p-value on its own records
out without review, certified when p <= (1 - confidence) / rows tried (Bonferroni). The report
names the loosest certified policy, the most straight-through; on a tie, the one with fewer
silent errors, then the one listed first. The run as it was counts as one of the rows because
keeping it is one of the choices; on the compliance run it costs little (a share of 0.01 instead
of 0.0125 at 5%, the same two policies certified). Holm's step-down (Holm 1979) could certify a
few more rows with the same guarantee; it is not used, so gates and policies are certified one way.
Policies chosen on the same records flatter themselves, exactly as gates do: writing new policies
after seeing the table is still picking from many, and the report says so. When the loosest
certified policy lets out more silent errors than the run as it was (paired, record by record),
the report says so on the next line: certified under the target is not the same as better.

**The compliance what-if, reproduced.** The compliance project's notes give a what-if table it
computed with its own replay script ([NOTES.md](../examples/compliance-reviewer/NOTES.md)).
`examples/compliance-reviewer/policies.json` asks the same four questions of the same run:

```
node bin/wfeval.js whatif --config examples/compliance-reviewer/config.json \
  --pred examples/compliance-reviewer/golden500/exec-67.harness.json \
  --key examples/compliance-reviewer/golden500/exec-67.harness.json \
  --policies examples/compliance-reviewer/policies.json --target 5
```

| Policy | Silent error rate | Unnecessary reviews | Held | Certified under 5% |
|---|---|---|---|---|
| As run | 9.8% (25 of 256) | 26 | - | no |
| Cap every client's threshold at 0.85 | 7.2% (18 of 249) | 26 | 7 | no |
| Award claims always go to a person | 4.1% (10 of 241) | 26 | 15 | no |
| Both | 1.3% (3 of 234) | 26 | 22 | yes (p = 0.0024) |
| Every note goes to a person | 0% (0 of 211) | 46 | 45 | yes |

Every figure matches the notes (`test/examples.test.js` pins them). "Cap at 0.85" is a hold-if rule
here, not a threshold: the client's threshold in that workflow decides whether a finding is
*applied*, and any applied finding sends the document to a person, so it is not the auto-publish
gate. The data has no client or threshold field either. Capping it at 0.85 applies exactly the
findings stated at 0.85 or more and not applied, which the test checks rather than assumes: no
model finding at 0.90 or more was left unapplied, none under 0.80 was applied, no document has
both an unapplied finding at 0.85 or more and an applied one under 0.90, and no document that
went out without review has an applied finding. Under 2%, no policy is certified: one would need
at least 228 records out without review, none a silent error.

## A tuning half and a held-out half (`split`)

A golden set that a workflow is tuned on flatters whatever was tuned on it. The compliance what-if
table above chose and measured its policies on the same 500 documents, and its own notes say a
fresh run should confirm them; the gate and policy certifications above warn that "policies chosen
on the same records flatter themselves". Think of a teacher who writes the exam from the homework:
a pupil who practised the homework scores well on it, and the mark says little about the next
test. The fix is a sealed exam: some records set aside before tuning, used only to check.

With `split` in the config ([CONFIG.md](CONFIG.md#a-tuning-half-and-a-held-out-half-split)),
`score`, `compare` and `variance` report the **tuning half** in full, exactly as they report a run
without a split, and nothing of the **held-out half** unless asked: `--held-out` adds its summary,
its rates with their likely ranges, never which of its records were wrong. `whatif` chooses on the
tuning half, and with `--held-out` checks its choice once on the held-out half. A **look** is asked
for (`--held-out`, or `--show-held-out`, which lists the records too): ordinary tuning reads the
tuning half and spends nothing (trap O25). Each look is counted in `split.log`, and a claim made on
the held-out half ("shown under the target") may spend only that look's share of the 5% allowed
for being wrong; without a log, no claim is made. `suspects` leaves the held-out records out, both
as suspects and as evidence (traps O21-O24). The split applies to those five commands only, never
to `monitor`, `estimate` or `agree` (trap O1).

Why a look is asked for, not taken by every report: when every report with a split was a look, a
newcomer's ordinary session (score, a what-if, a compare, a variance, a second score) used the
first five looks. The next version had 10 silent errors in 105 held-out records: at the fifth look's
0.156% the exact bound is 20.9%, at a first look's 2.5% it is 16.8%, so under a 20% target it would
have been shown at a first look and was not at the fifth. Compare and variance had spent a share
while making no claim. A look is still a look, so the arithmetic of the
claim is unchanged; what changed is that nothing spends it by accident.

### Which half a record is in

A hash of one name, the record's **unit**: its cluster's value (`clusters`, read from the answer
key), or for a duplicate its primary's unit, or else its own id. Held out when the hash, read as a
number from 0 to 1, is under `held_out` (default 0.5). Three properties matter, and a hash has all
three where a shuffle or a sort has none:

- **The same on every machine**, every time.
- **Stable as the golden set grows**: a record's half depends on its own name only, never on the
  other records. Records added later never move one already there, which would put a record that
  was tuned on into the held-out half.
- **A salt draws a different split**, for a new golden set, or before anyone has looked at either
  half.

**SHA-256, not CRC-32.** The metadata example's hand split used CRC-32 (even tuning, odd held out),
and `"hash": "crc32"` reproduces it exactly (`examples/metadata-enrichment/golden500/config-split.json`;
`test/examples.test.js` pins its halves: tuning 8 of 107, 6 of 100 and 10 of 105 in runs 70-72, held
out 5 of 92, 7 of 106 and 8 of 105). But a CRC is a linear code (Peterson and Brown 1961): for names
of one length, a salt put in front adds the same bits to every checksum, so it can only swap the
two halves or change nothing, never draw a new split; and names that differ by a fixed pattern
land by that pattern. `node scripts/split-sim.js balance` (no randomness; under half a minute):

<details><summary>CRC-32 against SHA-256</summary>

A salt in front of the metadata set's ids, under CRC-32: records that changed half, by id length.

| salt | 3-character ids (24) | 4-character ids (476) |
|---|---|---|
| "x" | 24 | 476 |
| "salt1" | 24 | 476 |
| "golden-2026" | 0 | 0 |
| "abc:" | 0 | 476 |
| "zz" | 24 | 0 |
| "v2" | 0 | 476 |

Duplicates split by their own id: the share of pairs whose two records land in different halves.
Chance alone gives half.

| primaries and duplicates (500 pairs) | SHA-256, 200 salts: average (least-most) | CRC-32 |
|---|---|---|
| duplicate of R0001 is R0501, and so on | 49.8% (43.0-55.4%) | **99.8%** |
| duplicate of R0001 is R0001-dup | 50.2% (43.6-56.6%) | 50.4% |
| duplicate of R0001 is R0001b | 50.0% (44.6-56.2%) | 49.8% |
| duplicate of R0001 is R0002, R0003 of R0004, ... | 50.2% (44.6-55.8%) | 58.2% |

Patterned ids, 1,000 records each: the spread of each kind's z (its held-out count against a fair
split's, in standard deviations; 1 for a fair split). CRC-32 splits patterned kinds by its own
pattern, mostly far more evenly than chance (0.00 to 0.20) and once less (1.12): never like chance.

| ids and kinds | SHA-256 (200 salts) | CRC-32 |
|---|---|---|
| R0001-R1000, a kind per block of 50 | 0.97 | 0.19 |
| R0001-R1000, kind = number mod 10 | 0.99 | 0.06 |
| R0001-R1000, kind = number mod 16 | 0.99 | 1.12 |
| case-1 to case-1000, kind = number mod 10 | 0.95 | 0.19 |
| 5 clients x 200 (acme-001 ...), kind = client | 0.94 | 0.00 |
| TKT-2026-00001 ..., a kind per block of 25 | 1.00 | 0.20 |

</details>

So SHA-256 is the default, and `"crc32"` is kept only to reproduce a split made that way: with a
salt, or a share other than half, the config stops (trap O2).

### Retellings stay together

Two retellings of one story on both sides leak: what tuning fixed on one copy carries over to the
other, and the held-out half looks better than it is. If tuning fixed every story it saw fail and
nothing else, a split by record would hide 1 - h^(c-1) of the held-out errors of stories of c
records (h the share held out): half for pairs, three quarters for stories of three, at h = 0.5
(simulated: 50.5% and 74.8%; split by story: none). So a duplicate goes with its primary and a
cluster stays whole. On the metadata golden set, the hand split by id put **13 of its 34
duplicates** in the other half from their primary; in runs 68-72 none of them went out without
review (every duplicate was suppressed or sent to a person), and 3 or 4 held-out records per run
had a retelling in the tuning half, none a silent error, so no figure the notes report moved. A
split by id still says how many straddle (trap O3). Each half is judged on its own records, so no
judgment in one half reads a record of the other: split by id, a tuning primary whose duplicate is
held out is "a real record suppressed as a duplicate" (SO-FALSE-DUPLICATE) whether or not that
duplicate went out, where judged across the halves its type would have said which.

What decides the halves is the split's settings and what makes a record's unit (`id_field`,
`clusters`, `duplicate_of_field`): a log written for other settings stops (trap O9), and `score
--cluster-by` is refused when the split follows clusters the config does not name (trap O4): one
such run moved a held-out record into the tuning half and named it there.

### Balance between the halves

A held-out half with none of a trap type cannot speak for it, and a broken hash could put whole
kinds of record on one side. But chance alone splits small kinds unevenly (a kind with 3 records
falls wholly in one half a quarter of the time), so a warning must fire only on what chance alone
would rarely produce. Each label's held-out count is compared with its exact distribution under a
fair split, every unit held out with chance `held_out` and carrying all its records of that label;
two-sided p, twice the smaller tail. The 5% is shared among the labels by **Tarone's modified
Bonferroni** (Tarone 1990): a label whose smallest possible p-value cannot reach the bar is not
counted, so tiny kinds do not dull the warning for the others. How often each rule fired on fair
splits (SHA-256, 1,000 salts) of the owner's two golden sets, trap types and groups together:

| golden set, share held out | "more than two thirds on one side" | each label at 5% | Bonferroni | **Tarone** |
|---|---|---|---|---|
| compliance, 50% | 4.6% | 22.8% | 2.9% | **2.9%** |
| compliance, 30% | 99.9% | 23.3% | 2.5% | **2.5%** |
| metadata, 50% | 63.0% | 36.8% | 2.7% | **2.7%** |
| metadata, 30% | 100.0% | 35.0% | 4.1% | **4.1%** |

Tarone's rule stays under 5% everywhere, as it must; on these sets every kind is big enough to
count, so it equals Bonferroni, and `test/split.test.js` pins a case where it does not. A label
with no record at all in one half is stated in the report, as a fact, whatever chance says.
`check` prints the balance before any look, when drawing another split with a new salt is still
free; re-drawing a split for balance before anything is looked at is sound (rerandomization;
Morgan and Rubin 2012), changing it after is not (trap O9).

### What a report shows of the held-out half

Its rates (silent error rate, straight-through, silent omissions, review precision, block
precision) with likely ranges, its safeguard failures and its silent errors' count by severity;
never an id, in the terminal, the HTML or the JSON. Listing which held-out records failed is
exactly what lets someone fix those records and fit the held-out half instead of the workflow; the
reusable holdout (Dwork, Feldman, Hardt, Pitassi, Reingold and Roth 2015, *Science* 349:636) rests
on limiting what each look reveals. So a warning or a stop about a held-out record (a stray space
trimmed, a field missing in a policy check) counts it instead of naming it, and rulings on held-out
records are counted, not listed (trap O6). Which words of a warning are record ids is known from
where each was written (the code marks an id as it writes it into a problem), never found by
searching the text, so a number in a sentence ("12 records", "rulings[7]") is never taken for a
record whatever the ids look like; when the answer key cannot be read, the halves are unknown and
no record is named at all. `--show-held-out` lists them anyway, for when it is worth it, and the log
records which records it listed (below). With `--held-out` the build gates read both halves: `score
--fail-on` counts the held-out silent errors, silent omissions and safeguard failures, and `compare --fail-if-worse`
the held-out paired verdicts, by number only; without it they read the tuning half, and say so
(trap O19).

Each held-out section also says, once, that its answer key has not been checked by `suspects`,
which leaves the held-out half out. A wrong key entry there reads as a silent error, or hides one: in
a generated test of 300 records with 10 key mistakes planted, 6 fell in the held-out half, and a
run's held-out silent error rate read 16.5% (18 of 109) against 12.8% (14 of 109) on the true key.
Listing the held-out records to clean their key would spend the half. The clean way is a second
person's labels for the held-out records, made on their own and before the first look, settled
with `wfeval agree` ([CONFIG.md](CONFIG.md#the-held-out-halfs-answer-key)): no model output is
involved, so nothing about how the workflow does there leaks.

### Counting the looks

**The plain rule.** Each look at the held-out half gets half of what the looks before it left of
the 5% allowed for being wrong: a claim at the first look may use 2.5%, at the second 1.25%, the
third 0.625%, and so on, so all the looks together never use more than 5%. The report says it in
plain words: "each look at the held-out half must pass a stricter test than the one before; this
is look 2, which may use 1.25% of the 5% allowed for being wrong". The claim is the exact
binomial test `whatif` certifies gates with: shown when, for k silent errors among n held-out
records out without review, P(Bin(n, target) <= k) is at most this look's share. The report shows
that as the **exact bound** the claim rests on: the highest rate these records do not rule out at
this look's share (Clopper and Pearson's one-sided bound); shown when it is at or under the target.

**What is proven, and what is not.**

- *Proven.* If no version tested was chosen using the held-out numbers (only the tuning half, and the
  yes or no of earlier claims), the chance of any false "shown", over every look, is at most 5%: each
  look's chance of a false "shown" is at most its share, and the shares add up to less than 5% (a
  union bound). Up to the first "shown" the answers are all "no", so even an analyst who adapts to
  them has nothing to adapt to.
- *Not proven.* The reports show more than a yes or no: each look shows the held-out count, and an
  analyst who keeps what the counts liked breaks the argument above. For that, there is only the
  simulation below: halving held a false "shown" under 5% against every adaptive attack tried, at
  targets of 1% to 30%, where declared budgets of 10 and 20 looks and the 1 / k^2 sequences did not.
  That is evidence, not proof, and the reports say so.

**Two different numbers.** The likely range is the usual 95% range (Wilson's), an approximation;
the claim uses the exact bound at the look's share, which is stricter at small counts, and stricter
again at every later look. So a likely range wholly under the target can come with "not shown": at
a first look, 0 of 10 records has a likely range reaching 27.8%, under a 28% target, while the
exact bound at 2.5% reaches 30.8%. The report says so on the line after, when it happens.

**Too few records, or used up.** When even no silent error at all among the held-out records could
not show the target at a first look, there are **too few records**, whatever the looks. When a
first look could have but this look's share cannot be reached even with no silent error, the
held-out half is **used up** for that target. Either way the report says how many records out
without review, none a silent error, would show it at this look.

**No log, no claim.** Looks that are not counted could be repeated without end: probing the
held-out counts run after run recovered the fixture's one held-out silent error in 11 runs. So
without `split.log` the held-out rates and ranges are shown, and no claim is made (trap O12).

<details><summary>The simulation that chose the rule, and its tables</summary>

`node scripts/split-sim.js looks` (seeded, about three minutes at the default 4,000 analysts per
row). An analyst tries version after version and looks at the held-out half after each, stopping at
the first "shown under the target". "False" is the share of analysts who ever got "shown" for a
version whose true rate is at or above the target: the promise is at most 5%. The analysts:

- **blind** (they never use the held-out numbers): versions at exactly 5%, every one looked at; or
  drawn between 5% and 7% and looked at only when the tuning half is under 5%; 100 or 250 records
  out in each half; versions that agree on which records are hard a little (0.3) or a lot (0.8);
  and gates chosen by eye on the tuning half, then tried on the held-out half;
- **adaptive** (they use the held-out counts):
  - *hill-climb*: each look tries one change on top of the version kept so far and keeps it when the
    held-out count fell; the changes fix and break records in balance, so the true rate never moves
    (20 looks of larger changes, or 40 of small ones);
  - *boosting*, Blum and Hardt's attack on a leaderboard (2015, "The Ladder: A Reliable Leaderboard
    for Machine Learning Competitions", ICML), adapted to records: versions that each hold a random
    half of the held-out records, kept when the held-out rate beat the first look's, then one
    version holding the records most kept versions held;
  - *group testing*: each look holds every held-out error found so far plus one block of records;
    the count says how many errors the block holds, and blocks with errors are halved again, so it
    finds the held-out errors one by one and holds them (200 looks, targets of 1% to 30%).
  Holding records by name says nothing about the next records, so in every attack the true rate
  stays at the target and every "shown" is false.
- for power: versions at 6% until look L, then at 2.5% (L from 1 to 12); versions improving from
  7.5% to 2.5%, looked at when the tuning half is under 5%; gates certified on the tuning half.

The rules compared: 5% every look; a declared budget of 5, 10 or 20 looks, 5% shared equally
(Bonferroni), nothing after the budget; the alpha-spending sequences 5% x 6 / (pi^2 k^2) and
5% / (k (k + 1)) for look k (Lan and DeMets 1983 for spending in general); and a fixed share of what
is left each look (two thirds, half, a third). A rule that could not show anything at all with a
row's records (a budget of 10 looks gives 0.5% a look, below 0.95^100 = 0.59%, the chance of no
silent error in 100 records at 5%) is not counted as holding there: those rows are counted apart.

| rule | worst false "shown": blind | worst: adaptive | rows over 5% | rows where it cannot show anything | first truly-under version at look 1 | look 2 | look 3 | look 5 | look 8 | look 12 | improving, looked at when the tuning half is under | gates certified on the tuning half |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5% every look | 48.6% | 100.0% | 23 of 26 | 0 | 100.0% | 99.2% | 98.6% | 97.4% | 95.9% | 93.0% | 83.3% | 93.9% |
| budget of 5 looks | 2.5% | 4.0% | 0 of 26 | 0 | 71.0% | 62.1% | 54.4% | 24.4% | 0.0% | 0.0% | 7.8% | 72.9% |
| budget of 10 looks | 4.3% | 12.5% | 4 of 21 | 5 | 87.0% | 84.2% | 82.0% | 73.1% | 53.9% | 0.0% | 34.8% | 67.3% |
| budget of 20 looks | 2.2% | 26.9% | 5 of 21 | 5 | 82.0% | 82.2% | 78.8% | 77.6% | 71.3% | 62.0% | 27.2% | 53.9% |
| spending 6 / (pi^2 k^2) | 2.4% | 100.0% | 9 of 26 | 0 | 70.5% | 55.9% | 44.5% | 32.5% | 22.9% | 10.7% | 9.4% | 71.5% |
| spending 1 / (k (k + 1)) | 2.5% | 100.0% | 10 of 26 | 0 | 73.3% | 60.8% | 51.5% | 41.4% | 29.7% | 16.8% | 12.7% | 71.4% |
| two thirds of what is left | 3.9% | 4.4% | 0 of 26 | 0 | 71.6% | 39.5% | 22.2% | 7.7% | 0.4% | 0.0% | 3.3% | 71.6% |
| **half of what is left (shipped)** | **2.6%** | **3.6%** | **0 of 26** | **0** | **72.0%** | **57.0%** | **46.3%** | **24.0%** | **4.4%** | **0.4%** | **7.4%** | **73.7%** |
| a third of what is left | 3.1% | 5.3% | 1 of 26 | 0 | 79.2% | 68.9% | 63.1% | 44.5% | 21.7% | 5.6% | 15.7% | 74.4% |

Where each rule broke, adaptive analysts (false "shown"; "cannot" where it could show nothing):

| attack | 5% every look | budget of 10 | budget of 20 | 6 / (pi^2 k^2) | 1 / (k (k + 1)) | a third | **half** |
|---|---|---|---|---|---|---|---|
| hill-climb, 20 looks, n 250 | 82.6% | 12.5% | 21.5% | 4.2% | 5.3% | 5.3% | **3.2%** |
| hill-climb, small changes, 40 looks, n 1,000 | 99.4% | 6.9% | 26.9% | 24.0% | 29.4% | 4.9% | **2.7%** |
| boosting, 16 versions then their majority, n 1,000 | 36.7% | 2.5% | 4.5% | 2.3% | 2.5% | 2.5% | **2.8%** |
| group testing, 200 looks, target 5%, n 1,000 | 100.0% | 1.4% | 1.4% | 98.6% | 98.8% | 2.8% | **3.5%** |
| group testing, 200 looks, target 10%, n 250 | 100.0% | 1.1% | 2.1% | 100.0% | 100.0% | 1.3% | **2.0%** |
| group testing, 200 looks, target 30%, n 1,000 | 99.8% | 1.5% | 0.9% | 36.2% | 40.3% | 2.8% | **3.6%** |

**Showing less each look.** The same adaptive attacks, with each look showing the held-out rate
only when it beats the best shown so far by a step (one standard error; Blum and Hardt's Ladder), or
only whether the claim was shown (yes or no, where the union bound holds against any analyst):

| attack | what each look shows | looks that show a rate | 5% every look | budget of 20 | 6 / (pi^2 k^2) | **half** |
|---|---|---|---|---|---|---|
| hill-climb, small changes, n 1,000 | the count | 100.0% | 99.4% | 26.9% | 24.0% | **2.7%** |
| | a new best only (Ladder) | 4.0% | 33.8% | 2.5% | 2.5% | **2.5%** |
| | yes or no | 0.0% | 20.5% | 1.1% | 2.0% | **2.1%** |
| boosting, n 1,000 | the count | 100.0% | 36.7% | 4.5% | 2.3% | **2.8%** |
| | a new best only (Ladder) | 11.3% | 27.8% | 2.5% | 2.7% | **3.2%** |
| | yes or no | 0.0% | 27.6% | 2.3% | 2.3% | **2.5%** |
| group testing, target 5%, n 1,000 | the count | 100.0% | 100.0% | 1.4% | 98.6% | **3.5%** |
| | a new best only (Ladder) | 9.5% | 10.9% | 0.8% | 2.5% | **3.0%** |
| | yes or no | 0.0% | 10.1% | 0.6% | 2.1% | **2.5%** |

**Thresholdout** (Dwork et al. 2015) answers with the tuning half's rate unless the held-out half's
differs by more than a noisy threshold. Its answers are accurate to about 4 / sqrt(n) (the paper's
threshold, 4 sigma with sigma = 1 / sqrt(n)): 40.0% at 100 records out, 25.3% at 250, 12.6% at 1,000,
wider than a 5% target until about 6,400 records. A claim that allowed for that accuracy could never
show a rate under 5% at the sizes a golden set has, so it was not simulated as a claim.

</details>

What the tables show, and why halving:

- **A claim at 5% every look is not a claim.** Looking after every version, up to 48.6% of analysts
  whose versions were all at 5% got "shown under 5%"; adapting to the counts, up to 100%.
- **Adding up to 5% is only proof when the looks reveal nothing to adapt to.** Every rule held
  against blind analysts. Against adaptive ones, declared budgets of 10 and 20 looks broke under
  hill-climbing (12.5% and 26.9%), and the 1 / k^2 spending sequences broke under group testing
  (up to 100%): their late looks still allow enough to show a version fitted to the held-out records.
  Halving held everywhere (at most 3.6%), because each look's share falls faster than any attack
  tried could fit the half; two thirds of what is left and a budget of 5 looks held too.
- **Of the rules that held, halving shows a truly-under version about as often as any,** without a
  budget declared up front or a dead stop after it: 72.0% when it comes at look 1 (a budget of 5:
  71.0%; two thirds: 71.6%), 57.0% at look 2 (62.1%; 39.5%), 46.3% at look 3 (54.4%; 22.2%), and
  still a little at look 8 (4.4%, where a budget of 5 can show nothing). Its price is late looks:
  a climb of 20 changes that each truly help a little was shown 19.7% of the time (a budget of 20
  looks: 91.5%, but that rule broke under hill-climbing).
- **Showing less each look buys little here.** A Ladder release or a yes-or-no-only release brought
  the uncorrected rule down (to 10.1-33.8%) and gave the corrected ones the proof, but halving was
  already under 5% in every attack, and the held-out rates would show on only 4-11% of looks (Ladder)
  or none (yes or no). For someone who wants to see the held-out half's rates, showing them every
  look with halving is the better trade; the proof covers analysts who choose versions without them,
  and the simulation, not a proof, covers the rest.

**The same look again.** A look is the command, the fingerprints of its files (predictions, answer
key, rulings, policies), the fingerprint of the loaded config (every setting, after `--group-by` and
`--cluster-by`), the mode (strict or `--lenient`) and, for `whatif`, its options. Shown again
unchanged, it reveals nothing new, so it is "look N again" and spends nothing (trap O8). Any other
look (`--held-out` or `--show-held-out`) is a new look, whether or not it makes a claim: an edited
config that turned a held-out silent error right was a new look, not "look 1 again".

**Looks count per record.** Each look keeps the held-out records it was at. A claim's look number
is the number of looks that were at any of its records: a look on an older version of the key,
before records were added, is no look at the records added since. In the newcomer's test, records
added later were charged a look made on the old key that never had them; now they are not.

**Records listed.** A look with `--show-held-out` lists held-out records, and the log keeps which:
`score`, `compare`, `variance` and `whatif` list the whole half, `suspects` the held-out suspects it
shows (`--top`'s, or all with `--json`). From then on, a claim on any record it listed spends
nothing, anything fixed since could be fitted to exactly them; a claim on records it never showed
is untouched (trap O13). In the newcomer's test, a `suspects --show-held-out` on the old 300-record
key had voided the claim on the 37 held-out records added after it, which it never listed.

**Fresh records.** Records added to the golden set later have had no look. The log keeps each
held-out record's first look, so when the held-out half holds records first shown at a later look
than its oldest, the newest batch gets a claim of its own, counted over the looks that were at
them: its own 5% (trap O14). That is what "add fresh records" means when a held-out half is used up. Each batch is a
new claim; adding a few records at every look to get a fresh 2.5% each time is the peeking this
section exists to stop, in another form.

**Records that change half.** The log keeps the look at which each record was first seen in each
half. A record in the other half now, either way, stops a strict run: one tuned on would flatter the
held-out half, and one held out, now shown in the tuning half, would reveal what it held. With
`--lenient` it is set aside, in neither half, listed under `moved` in the log, never written as held
out and never counted as fresh (trap O10). Runs at the same time take turns through a lock file
beside the log (trap O17): ten runs at once had recorded only 6 to 9 looks before it.

### `whatif`: chosen on the tuning half, checked on the held-out half

With a split, the gate sweep, the policies and their certification are the tuning half's alone.
With `--target`, the loosest gate or policy certified there is the choice. Without `--held-out` the
report names it and says how to check it (the next look's number and share); with `--held-out` it is
tried once on the held-out half: one look, one claim at that look's share (when looks are counted).
When it is not shown there, the report says which of these it is:

- **the held-out half disagrees**: the held-out rate is at or above the target (or its whole likely
  range is);
- **not confirmed: the tuning half flattered it**: the rate it was certified at on the tuning half
  sits below the held-out half's whole likely range. In the newcomer's test a policy certified at
  4.3% (2 of 46) ran at 17.9% (10 of 56) on the held-out half, under a 20% target; the report had
  called that "too few held-out records", which it was not;
- **too few records**: even no silent error at all among them could not show it, at a first look;
- otherwise **not confirmed at this look**, which is not evidence against the choice.

Without `--target` nothing is chosen, and nothing of the held-out half is shown (trap O16).

On the compliance golden set split in halves (`examples/compliance-reviewer/config-split.json`, 230
documents tuning, 270 held out; `test/examples.test.js` pins it), as a demonstration of the
mechanics, not evidence:

```
node bin/wfeval.js whatif --config examples/compliance-reviewer/config-split.json \
  --pred examples/compliance-reviewer/golden500/exec-67.harness.json \
  --key examples/compliance-reviewer/golden500/exec-67.harness.json \
  --policies examples/compliance-reviewer/policies.json --target 5 --held-out
```

On the tuning half, "Both" gives 2 silent errors in 108 and is not certified under 5% (on all 500
it gave 3 in 234 and was); only "Every note goes to a person" is, 0 in 95. Its held-out numbers are
0 in 116. No claim is made on them: the policies were chosen on all 500 documents before the split
existed, so the held-out half has been looked at already, and the example keeps no log rather than
count a first look that is not one. Confirming a policy needs records that played no part in
choosing it: a fresh run, or records added to the golden set later.

**What it does not cover.** The held-out half is a golden set's too: a stress-test rate, for
records like these. Its claim is as strong as the record of looks, and the tool only sees the looks
it is shown (a held-out number copied by hand from an old report is a look the log never saw).
`compare`'s held-out verdicts and `variance`'s worst held-out run are looks and are counted, but
are not adjusted for looks themselves: only "shown under the target" is. The evidence for adaptive
analysts covers the attacks simulated, not every analyst.

## Live samples over time (`wfeval monitor`)

After launch, a person checks a sample of the records that went out without review every week
or month. Each period's rate alone is noisy: 3 silent errors in 30 records is 10%, likely
3.5-25.6%: one period alone cannot tell a bad week from a worse workflow. `wfeval monitor` reads the periods in time
order and answers two questions, each with its own method, chosen by simulation
(`node scripts/monitor-sim.js`, seeded: it prints the same tables every time, in under a
minute; every figure below comes from it). Rates in this section are of records out without review
(and, under [Silent omissions over time](#silent-omissions-over-time---watch-silent-omissions), of
records blocked or suppressed; its figures, and those of [Each segment](#each-segment---segment-by),
come from `node scripts/monitor-segments-sim.js`).

### Has the silent error rate gone up? (the alarm)

A tally of strikes that slowly forgives: each silent error adds a strike, each right record takes a
little off, the tally never goes below zero, and the alarm rings when it reaches a line.
The CUSUM (Page 1954) adds up, period by period, how much likelier each period's count is at the
**alarming rate** p1 than at the **acceptable rate** p0, never going below 0:

- each silent error adds ln(p1 / p0); each record that was right takes off ln((1 - p0) / (1 - p1));
- in whole-number steps, as Reynolds & Stoumbos (1999) do for this Bernoulli CUSUM: from 2.5% to
  5%, a silent error adds 53 steps and a right record takes 2 off (the ratio of the two logs,
  rounded to whole steps with the larger at least 50, so it moves by at most 1%);
- S = max(0, S + 53 y - 2 (n - y)) after a period with y silent errors in n records; **ALARM**
  when S reaches the alarm level H. S is floored at 0 only at a period's end, since the order of
  the records inside a period is not known.

**The likely start of the rise** is the period after the last one at which S stood at 0: where
the evidence for a rise started adding up, the CUSUM's own estimate of when the change came.

**The alarm level** is set exactly so that, at the acceptable rate, false alarms come on average
no more often than once per `--false-alarm-every` records checked (2,000 by default), for
periods of the median size so far (or `--period-size`). A Markov chain (Brook & Evans 1972: a
step-by-step tally of the chance of every possible total) follows the chance of each value of S period by period and adds up the chance of no alarm yet: the average records until a false alarm, and, at p1, the
average records until a real rise is flagged. The report prints both. Whole-number steps make
the chain exact for the detector itself, so it can be checked against a simulation of that same
detector, 20,000 runs per row (`node scripts/monitor-sim.js chain`):

<details><summary>The chain against the simulation</summary>

| acceptable | records a period | true rate | chain: records to an alarm | simulated |
|---|---|---|---|---|
| 1% | 50 | 1% | 2,153 | 2,135 |
| 1% | 50 | 2% | 380 | 376 |
| 2.5% | 50 | 2.5% | 2,242 | 2,215 |
| 2.5% | 50 | 5% | 229 | 226 |
| 5% | 50 | 5% | 2,380 | 2,355 |
| 5% | 50 | 10% | 148 | 147 |

</details>

False alarms come a little less often than asked (2,242 records, not 2,000) because the alarm
level is a whole number of steps: the smallest that gives at least 2,000.

**Why the CUSUM, and why this alarm level.** Every detector was set for at most one false alarm
per 2,000 records at p0; only the exact CUSUM and the EWMA are tuned to it (Lorden's level, the
level for a check after every record and the p-chart came out far above it, below). The rate then rose to double or triple after 9 calm periods,
and the simulation counted the records checked from the rise to the alarm (3,000 runs per cell;
runs that false-alarmed before the rise left out). 5 of the 9 settings, at a rise to double
(`node scripts/monitor-sim.js 1` prints all 63 rows):

<details><summary>The records to an alarm, by detector</summary>

| p0 | records a period | CUSUM, exact level (shipped) | CUSUM, level for a check after every record | CUSUM, Lorden's level | p-chart, exact binomial limit | EWMA, lambda 0.1 |
|---|---|---|---|---|---|---|
| 1% | 20 | 341 | 383 | 1,010 | 2,824 | 345 |
| 1% | 100 | 376 | 522 | 757 | 708 | 358 |
| 2% | 50 | 238 | 315 | 451 | 357 | 229 |
| 5% | 20 | 132 | 159 | 218 | 469 | 126 |
| 5% | 100 | 167 | 241 | 227 | 184 | 160 |

</details>

- **Lorden's bound** (Lorden 1971: a CUSUM with level h false-alarms at most once per e^h
  periods) needs no calculation and is always safe, but it is far too cautious here: its false
  alarms came once per 11,574 to 38,891 records instead of 2,000, and it flagged a rise to double
  later in every cell (1,010 records against 341 at 1% with 20 a period; 227 against 167 at 5%
  with 100).
- **A level for a check after every record** is safe whatever the periods' sizes (checked once
  a period, S is floored and looked at less often, so it alarms later, never sooner), but it was
  slower in every cell (383 against 341 at 1% with 20 a period; 241 against 167 at 5% with 100):
  checked once a period, it false-alarmed only once per 2,649 to 15,495
  records.
- **The p-chart** (Shewhart: the classic control chart, each period judged alone against an exact binomial limit) was the slowest
  of all at 1% and 5% with 20 records a period (2,824 and 469 records): with 20 records a period,
  one silent error at 1% is already 5%, so its limit has to sit high, and at 1% it false-alarmed
  once per 20,002 records instead of 2,000.
- **The EWMA** (Roberts 1959: a running average of the period rates, one-sided) flagged a rise
  to double sooner than the CUSUM in 8 of the 9 settings (in the table: 358 against 376, 229
  against 238, 126 against 132, 160 against 167; the CUSUM sooner only at 1% with 20 a period, 341
  against 345). In those 8 the CUSUM also false-alarmed less often than asked, from 2,029 to
  2,911 records per false alarm, where the EWMA was tuned to about 2,000 (Part 1 of the script).
  The CUSUM is kept because it weighs every period by its records exactly (the EWMA's limit
  assumes one period size, and had to be tuned by simulation for every setting), its alarm level
  is computed exactly by the chain, and it dates the start of the rise.

The level is set for periods of the **median** size, because smaller periods false-alarm more
often at the same level (a check after every record most often of all). Each row's level is set
from the periods up to that row only, so a status, once printed, never changes when later periods
arrive (a level from every period would move with each new one, and could raise or remove an
alarm after the fact). `--period-size` pins one level for every row.
The report prints the level used. With very uneven sizes the report warns (trap L7).

**When the rate wobbles.** The CUSUM assumes each period's count comes from one steady rate.
When the rate itself wobbles from period to period around the acceptable rate (a busy week, a
holiday), the counts spread more than that, and false alarms come sooner. In the simulation
(acceptable 2%, 50 records a period, tuned to one false alarm per 2,000 records; 3,000 runs),
false alarms came once per 1,990 records at a steady 2%, 1,912 with each period's rate drawn
between 1.5% and 2.5%, 1,756 between 1% and 3%, and 1,317 between 0% and 4%. If false alarms come
more often than the report says, that is the likely reason: raise `--false-alarm-every`.

**Defaults, and why.** `--acceptable` is the rate the workflow normally runs at; `--alarming`
the rise worth an alarm. The rule: the acceptable rate is half the target unless given, and the
alarming rate is double the acceptable rate unless given (it must stay under 100%). So
`--target 5` alone watches for a rise from 2.5% to 5%. Better still, set `--acceptable` to the rate measured before
launch (score on a golden set, or the first weeks checked): with the default, a workflow that
normally runs above half the target is flagged at once and its rise dated too early, and the
report says so (trap L18).

That is not "tell me only once it reaches the target". A CUSUM climbs on average at any rate
where a silent error's steps up outweigh the right records' steps down: from 2.5% to 5%, above
2 / (53 + 2) = 3.6%, its break-even rate. So a workflow sitting steadily just under the target is
flagged too, only later. From the chain, weeks of 30, the records to an alarm at a steady rate
(`node scripts/monitor-sim.js tuning`):

| steady rate | 2.5% | 3.0% | 3.5% | 4.0% | 4.5% | 5.0% |
|---|---|---|---|---|---|---|
| records to an alarm | 2,065 | 992 | 576 | 384 | 280 | 219 |

These defaults are kept because the alarm is an early warning for a line not to cross: a rate
that has drifted from 2.5% to 4.5% has used up most of the room under a 5% target, and is worth
a look before it crosses (the bound, not the alarm, says whether the rate is shown under the
target). Moving the acceptable rate closer to the target would quiet those early alarms, but would
also flag a real rise to the target later. Double is what the simulations above tuned for, and a
CUSUM tuned to a doubling still catches a tripling sooner (the simulation's "delay at 3x" column:
59 to 196 records). The report prints the break-even rate and the records to an alarm at 90% of
the target. At 50 records a week, one false alarm per 2,000 records is one per 2,000 / 50 = 40
weeks at most. Fewer false alarms cost slower flags; from the chain, at 2.5% with 50 records a period:

| --false-alarm-every | records per false alarm at 2.5% | records to flag a rise to 5% | to 7.5% |
|---|---|---|---|
| 1,000 | 1,033 | 169 | 88 |
| 2,000 (default) | 2,242 | 229 | 112 |
| 5,000 | 5,633 | 309 | 141 |
| 10,000 | 10,191 | 364 | 164 |

### Is it shown under the target? (valid however often you look)

`score --target 5` asks once, of one test whose size was fixed in advance. Asked every week,
"is the likely range under 5% yet?" is a different question: every look is another chance for
luck to make it so, the way a coin tossed every week will sooner or later land heads five times
running. This is the peeking problem. In the simulation (4,000 runs, 104 periods, a check after
every period), with the true rate exactly 5%, the share of runs that EVER showed "under 5%":

| records a period | likely range of all periods so far | likely range of the period alone | confidence sequence (shipped) |
|---|---|---|---|
| 20 | 13.5% | 0% | 2.9% |
| 50 | 15.3% | 0% | 2.7% |
| 100 | 16.4% | 45.6% | 2.1% |

The likely range promises at most 2.5% on that side. A period alone of 20 or 50 records can
never show it (73 records are needed even with no silent error), but at 100 records a period,
nearly half the runs showed "under 5%" at some point.

**In one sentence:** the bound keeps a running evidence score; "shown under 5%" means the score
has passed 20; with the rate steady, it is wrongly shown at most 1 time in 20, however often you
look.

`monitor` uses a **confidence sequence** instead: a range valid however often you look. It bets
against "the true rate is the target or more". After S silent errors and F right records, the
evidence is the likelihood of each rate q below the target against the target's own, averaged
over q spread evenly from 0 to the target (a mixture: Robbins 1970; Howard, Ramdas, McAuliffe &
Sekhon 2021 build confidence sequences this way):

<details><summary>The formula</summary>

    E = (1 / target) × integral over q from 0 to target of (q / target)^S ((1 - q) / (1 - target))^F dq

</details>

While the true rate is at or above the target, each period's records multiply E by 1 or less on
average, so the chance that E EVER reaches 20 is at most 1 in 20 (Ville 1939: a fair bet's winnings reach 20 times the stake at most 1 time in
20), however often it
is looked at. **Shown under the target** when E is 20 or more. The **upper bound** printed for
each period is the lowest rate the same evidence rules out (E rises with the rate tested, which
the tests check). The integral has a closed form, a finite sum (test/monitor.test.js checks it
against the integral itself). With no silent error it is
E = (1 - 0.95^(F+1)) / (0.05 (F+1) 0.95^F) at a 5% target: 87 right records give 19.49, 88 give
20.30. So with no silent error at all, 88 records show "under 5%", against 73 for one test of
fixed size: looking any time costs a little.

**Why this one.** Compared in the same simulation, with the median records until "under 5%"
shows when the true rate is 2.5% and when it is 1%:

<details><summary>The bounds compared</summary>

| records a period | method | ever "under 5%" at a true 5% | true 2.5%: median records | true 1% |
|---|---|---|---|---|
| 20 | mixture (shipped) | 2.9% | 420 | 140 |
| 20 | betting (Waudby-Smith & Ramdas 2023) | 1.9% | 440 | 200 |
| 20 | Hoeffding normal mixture | 0% | not within 2,080 | 1,440 |
| 50 | mixture (shipped) | 2.7% | 450 | 150 |
| 50 | betting | 1.7% | 500 | 250 |
| 50 | Hoeffding normal mixture | 0% | 3,850 | 1,450 |
| 100 | mixture (shipped) | 2.1% | 500 | 200 |
| 100 | betting | 1.7% | 600 | 300 |
| 100 | Hoeffding normal mixture | 0% | 3,900 | 1,500 |

</details>

All three stayed under 5%. The mixture showed a real 2.5% or 1% soonest. The betting sequence (a
bet sized from the rate so far, the same for every record of a period since their order is not
known, capped at half the most it could stake) lags because each period's bet can use only the
periods before it. The Hoeffding bound (one that assumes only that each record is 0 or 1: Robbins' normal mixture with the widest spread a share
can have; Howard et al. 2021) assumes a rate near 50%: at a few percent it needed 1,440 to 3,900
records where the mixture needed 140 to 500.

**When the rate drifts.** The guarantee is for a rate that stays put, or stays at or above the
target the whole time. If it moves, "shown under 5%" means the rate was under 5% for at least
part of the time, not that it is now. With the rate alternating 8%, 2%, 8%, ... (its running
average never below 5% at a period's end), the share of runs ever showing "under 5%" was 2.4%,
2.1% and 1.5% (20, 50 and 100 records a period). With each period's rate drawn at random between
2% and 8%, the share of runs that ever showed "under 5%" while the average of the period rates so
far was 5% or more was 1.1%, 0.9% and 0.5%. Under 5% in both cases, but no theorem promises it.
The Hoeffding bound holds for the running average of drifting rates by its construction
(Howard et al. 2021), but showed nothing in time to be useful. What watches for a drift upward is
the alarm. So:

- the report gives the bound as it stands now: if silent errors pile up after a "shown", the
  evidence falls back below the bar and the report says it is no longer shown;
- with an alarm raised, the report says to read the bound as all the periods together, not as
  the rate now;
- after a fix, `--since <period>` restarts the **alarm** only (the usual practice once an alarm
  has been looked into: the CUSUM starts again from 0). The bound keeps counting every period.

**Why `--since` does not restart the bound.** A restart chosen after an alarm is chosen by the
numbers, and the bound's promise only covers looks it did not choose that way. In the simulation
(`node scripts/monitor-sim.js restart`: a true rate of exactly 5%, weeks of 30, 104 weeks, the
default alarm, 4,000 runs, nothing really fixed), "under 5%" was ever shown in 3.1% of runs when
nothing was restarted, in 29.7% when the alarm and the bound were both restarted after each
alarm (14 alarms a run), and in 3.1% when only the alarm was. A **new list of periods** (a new
counts file, or a new set of period files) is a new claim: start one only when the workflow
itself changed (a fix shipped, a new prompt or model), never because of the numbers, and know
that each new list spends its own 5%.

**What it rests on.** Each period's records are a random sample of the records out without
review in that period, checked by a person against the answer the workflow should have given (a
scorecard of real traffic, not a golden set built from traps), scored the same way every period
(trap L6). Every record checked counts the same: a period in which a bigger share of the records
was checked counts for more than its share of the traffic (trap L7).

### Silent omissions over time (`--watch silent-omissions`)

The alarm and the bound above read only the records that went out without review. A workflow that
wrongly blocks or suppresses records looks perfect to them, and a record wrongly left out reaches
nobody, so nobody complains. `--watch silent-omissions` runs the same two methods on the records
the workflow blocked or suppressed that a person checked: the base is those records, and the rate
the share of them **wrongly left out**, each judged as `score` judges a silent omission (the answer
key says the record should have gone out or to a person;
[SILENT_ERRORS.md](SILENT_ERRORS.md#family-2-silent-omissions)). In the segments fixture's run
files, 4 of the 9 records blocked or suppressed should have gone out or to a person; the silent
error rate shows none of them.

**Not score's silent omission rate.** Both count the same records as wrong; they divide by
different ones. Score's silent omission rate is "of the records that should have gone out or to a
person, the share left out unseen": its base is the records that should have been seen, which a
golden set knows and a sample of live traffic does not. Monitor's is "of the records left out, the
share that should not have been": its base is the records blocked or suppressed, which is what a
person checking a sample of them can count. In the segments fixture's W40, score gives 1 of 6
(16.7%) and monitor 1 of 3 (33.3%). So the report names it differently ("wrongly left out"), and
when it suggests where to measure the acceptable rate before launch, it points to monitor itself:
`--watch silent-omissions` on the golden-set run file, as a single period, gives the matching
share. (On a golden set built from traps, that is a stress-test share, as with the silent error
rate.) With the key in a file of its own, that run needs `--keys`: a folder holding the key under
the run file's name (trap L35). And with a split in the config, the golden-set file holds both
halves: monitor ignores the split and says so, and reading the share there would be an uncounted
look at the held-out half (trap L34). The tuning half's figures come from `score` instead, which
keeps the halves apart: its silent omissions over the records it blocked or suppressed (CONFIG.md
says where). For the same reason, the single test of fixed size the omission report compares with
is `rate --target` (any count), not `score --target` (the silent error rate only).

**One series a report.** The two rates sit on different scales (the share of the left-out records
left out wrongly need not be anywhere near the silent error rate), so each needs its own target,
acceptable and alarming rate. Both in one report would need a second copy of every setting, and a
label on every number saying which rate it belongs to; a reader who mixed them up would read one
rate's alarm as the other's. So a report watches one series, the settings on the command line are
that series', and `--fail-on-alarm` is that series' alarm. A scheduled job runs two commands.

**Do the methods hold for this series?** Two things differ from the records out without review
(`node scripts/monitor-segments-sim.js omissions`):

- **Few records a period, wrong more often.** A person may check only 1 to 10 blocked records a
  week, and their rate can be 5% to 20%. The CUSUM's chain is exact for any period size, and the
  bound is built record by record, so neither assumes many records. Checked: the chain against
  20,000 simulated runs of the detector, at 1, 3, 5 and 10 records a period and acceptable rates of
  5%, 10% and 20% (alarming double), was off by 1.1% at most in all 24 cells. The bound's chance of
  ever showing "under the target" when the true rate is exactly the target, over 104 periods (4,000
  runs): 1.1% to 3.4% at targets of 5%, 10% and 20%, under its 5% in every cell.
- **The false-alarm unit is this series' records.** `--false-alarm-every` counts the records
  blocked or suppressed that were checked, so at a few a week the default 2,000 is years: from the
  chain, at 10% to 20% and 5 records a week, one false alarm per 401 weeks, and a rise to double
  flagged after 15.6 weeks. Set it for this series' size: 500 gives one false alarm per 101 weeks
  and flags a doubling in 10.1; 250, one per 51 weeks and 7.7. The report's TUNED TO line gives both
  in periods.

<details><summary>Periods to flag a rise from 10% to 20%, by records a period and setting</summary>

| records a period | --false-alarm-every | periods per false alarm | periods to flag 20% |
|---|---|---|---|
| 3 | 250 | 88 | 12.8 |
| 3 | 2,000 | 690 | 26.0 |
| 5 | 250 | 51 | 7.7 |
| 5 | 500 | 101 | 10.1 |
| 5 | 2,000 | 401 | 15.6 |
| 10 | 500 | 59 | 5.4 |
| 10 | 2,000 | 223 | 8.1 |

</details>

**What it rests on**, besides the above: the records checked are a random sample of the period's
records left out, and the answer key gives each one's correct route (`routing.gold_field`). Without
a correct route, nothing says a suppressed record was not a duplicate; only a blocked record whose
label was declined can still be judged (SO-DECLINED), and the base is then those records (trap L20).

### Each segment (`--segment-by`)

One monitor over all traffic can hide a rise confined to one channel or one customer. In the
segments fixture, chat's silent error rate rises from W39 while email's stays at 0: the whole's
CUSUM ends at 62% of its alarm level, chat's at 124%. `--segment-by` gives each segment its own
CUSUM and bound, beside the whole's. Three questions follow, each answered by a seeded simulation
(`node scripts/monitor-segments-sim.js alarms`, `bounds`, `whole`, `late` and `overlap`; the whole
script takes about 22 minutes): what does the false-alarm setting promise once there are several
alarms, what does "shown under the target" promise for the whole and several segments at once, and
what happens when a segment first appears in a later period?

**The alarms.** Each segment's alarm level is set as the whole's is: per records checked, for the
median size of its own periods. False alarms then come per record checked, so the segments together
should false-alarm about as often per record as the whole alone. Simulated with every segment's
size drawn at random each period around its share (2.5% to 5%, 300 runs of 600 periods, each
detector restarted after its alarm):

<details><summary>Records checked per false alarm, at 2.5% everywhere</summary>

| segments | each detector set for | segments together | the whole alone | the whole and the segments | first false alarm anywhere |
|---|---|---|---|---|---|
| 5 equal, 50 a period | 2,000 | 2,041 | 2,266 | 1,074 | 1,543 |
| 5 equal, 50 a period | 4,000 | 4,414 | 4,169 | 2,144 | 2,979 |
| uneven: 50/25/12.5/12.5%, 40 a period | 2,000 | 2,074 | 2,142 | 1,054 | 1,391 |
| uneven: 50/25/12.5/12.5%, 40 a period | 4,000 | 4,380 | 4,358 | 2,184 | 2,759 |
| 10 segments, 2 to 10 a period | 2,000 | 2,081 | 2,247 | 1,080 | 1,617 |
| 10 segments, 2 to 10 a period | 4,000 | 4,371 | 4,111 | 2,119 | 2,970 |
| small: 30 a period, one of 88% and three of 4% | 2,000 | 2,133 | 2,074 | 1,051 | 1,821 |
| small: 30 a period, one of 88% and three of 4% | 4,000 | 4,222 | 4,110 | 2,083 | 3,361 |

</details>

So per record checked, the segments together keep the promise (2,041 to 2,133 records per false
alarm, set for 2,000), uneven and small segments included. But a person reading the report every
week sees the whole's alarm and every segment's, and `--fail-on-alarm` stops on any of them: set
that way, the report false-alarmed about twice as often as asked (once per 1,051 to 1,080 records
checked), its first false alarm after 1,391 to 1,821 records. That is the wrong promise for a weekly
reader, so `--false-alarm-every` covers the report as one: the whole and every segment are each set
for twice the records asked (half the budget for the whole, half for the segments, whose false
alarms add up). The report in all then false-alarmed once per 2,083 to 2,184 records checked, its
first after 2,759 to 3,361 (trap L28). This is how schemes that watch many streams at once are
usually set: by the false alarms of the scheme as a whole, not each stream's (Mei 2010, Biometrika
97(2), 419-433). With one segment with records, and no record in two, the segment is the whole:
there is nothing to share, and the alarms keep the budget asked. The report gives the whole's alarm
level and time to flag both ways ("Alarm level 200 steps (152 without --segment-by)", "about 281
records (219 without segments)" in the segments fixture), and says so when the whole alone would
have alarmed and, sharing the budget, has not.

The price is time to flag: each alarm is set for fewer false alarms. A rise to 5% in one segment
only (the smallest, from period 10; 2,000 runs) was flagged after 644 to 1,481 records checked in
all with every detector set for 2,000, against 924 to 2,602 when set for 4,000; a rise in every
segment after 187 to 198, against 243 to 253. Lower `--false-alarm-every` for quicker flags,
knowing what it then means.

**The bounds.** Each segment's bound alone keeps its 5%, but with several the chance that some
segment at or above the target is ever shown under it grows: at a true 5% in every segment of 20
records a period, 5.9% with 2 segments, 14.9% with 5 and 25.5% with 10 (trap L24). Picking the
best-looking of many segments ("customer X is under 5%") is where luck passes for a result. Every
method below uses the bound's own evidence E for each segment, an e-value (with the rate at the
target, its average is at most 1, at any time), and was checked after every period for 104 periods
(2,000 runs; `node scripts/monitor-segments-sim.js bounds`):

- **per segment**, each at 5%: no correction;
- **Bonferroni** at 5% / S for S segments, which on this bound is the same rule as
  **e-Bonferroni**, E >= S / 5% (Vovk & Wang 2021);
- **Holm's** step-down (Holm 1979) on the anytime p-values 1 / E;
- **closed testing** (Marcus, Peritz & Gabriel 1976) on the arithmetic mean of the e-values (Vovk &
  Wang 2021, Annals of Statistics 49(3), 1736-1754; section 5, Algorithm 1): a segment is shown
  when every set of segments that includes it averages E of 20 or more. The average of e-values is
  an e-value whatever their dependence, so if several segments were at or above the target, their
  average would have to reach 20, which happens at most 5% of the time, however often it is looked
  at (Ville 1939). The hardest sets add the segments whose E is under 20, so a segment's bar comes
  to 20 plus each other segment's shortfall below 20;
- **e-BH** (Wang & Ramdas 2022), which keeps the share of wrong "shown" among those shown (the
  false discovery rate) under 5%, a weaker promise than "none wrong".

<details><summary>The bounds compared (20 records a period in each segment)</summary>

| segments | true rates | method | any wrong "shown" | segments under 5% shown by week 52 | median records to "shown" |
|---|---|---|---|---|---|
| 5 | all at 5% | per segment | 14.9% | | |
| 5 | all at 5% | Bonferroni, Holm, closed testing, e-BH | 3.3% | | |
| 5 | half at 5%, half at 2.5% | per segment | 8.4% | 94.8% | 420 |
| 5 | half at 5%, half at 2.5% | Bonferroni | 2.0% | 84.0% | 620 |
| 5 | half at 5%, half at 2.5% | Holm | 2.3% | 85.9% | 620 |
| 5 | half at 5%, half at 2.5% | closed testing (shipped) | 2.6% | 86.7% | 600 |
| 5 | half at 5%, half at 2.5% | e-BH | 4.0% | 88.5% | 560 |
| 5 | all at 2.5% | Bonferroni | | 83.5% | 620 |
| 5 | all at 2.5% | Holm | | 91.7% | 560 |
| 5 | all at 2.5% | closed testing (shipped) | | 93.2% | 520 |
| 5 | all at 2.5% | e-BH | | 93.7% | 500 |
| 10 | all at 5% | per segment | 25.5% | | |
| 10 | all at 5% | Bonferroni, Holm, e-BH | 2.0% | | |
| 10 | all at 5% | closed testing (shipped) | 2.1% | | |
| 10 | one at 5%, the rest at 2.5% | Bonferroni | 0.1% | 77.3% | 740 |
| 10 | one at 5%, the rest at 2.5% | Holm | 0.6% | 86.0% | 680 |
| 10 | one at 5%, the rest at 2.5% | closed testing (shipped) | 1.2% | 89.0% | 600 |
| 10 | one at 5%, the rest at 2.5% | e-BH | 1.6% | 92.9% | 540 |
| 10 | all at 2.5% | Bonferroni | | 77.1% | 740 |
| 10 | all at 2.5% | Holm | | 88.2% | 660 |
| 10 | all at 2.5% | closed testing (shipped) | | 91.7% | 580 |
| 10 | all at 2.5% | e-BH | | 93.3% | 520 |

</details>

Every method but "per segment" kept the chance of any wrong "shown" under 5% in every setting of
the script (equal and uneven segments, 2, 5 and 10 of them, five mixes of rates). Of the ones that
promise none wrong, closed testing showed the segments truly under the target as soon as
Bonferroni and Holm or sooner in every setting: with 10 segments at 2.5%, 91.7% of them by week
52, against 77.1% for Bonferroni and 88.2% for Holm (a median of 580 records, against 740 and 660).
e-BH was quicker still, but promises only the share among those shown, and its chance of any wrong
"shown" was the highest of the corrected methods (4.0% with half the segments at the target). So
the segments are counted by closed testing.

**The whole joins the family.** The whole's "shown" is a claim in the same report, so it is counted
with the segments' rather than given a 5% of its own (which would let the report's claims together
be wrong up to 10% of the time, trap L32). Four ways were compared on the same evidence, the whole
being the segments added up (`node scripts/monitor-segments-sim.js whole`; 2,000 runs, 104 periods,
5 or 10 segments of 20 records a period, or one of 40 and the rest of 10):

- **apart**: the whole at 5% on its own, the segments' closed test at 5% (up to 10% in all);
- **equal weight**: the whole as one more member of the segments' closed test;
- **split**: the whole at 2.5% (a bar of 40), the segments' closed test at 2.5%;
- **weighted** (shipped): closed testing on a weighted average of the evidence, the whole weighted
  1/2 and the segments sharing the other 1/2 equally. A weighted average of e-values, with weights
  fixed in advance, is an e-value too (Vovk & Wang 2021), so the same argument holds: one 5% for
  every "shown" in the report.

<details><summary>Where the whole goes</summary>

| segments | true rates (the whole) | way | any wrong "shown" | the whole: median records to "shown" | segments under 5% shown by week 52 | their median records |
|---|---|---|---|---|---|---|
| 10 of 20 a period | all at 5% (5%) | apart | 4.8% | | | |
| | | equal weight | 3.1% | | | |
| | | split | 2.8% | | | |
| | | weighted (shipped) | 2.8% | | | |
| 10 of 20 a period | half at 5%, half at 2.5% (3.75%) | apart | 2.0% | 2,200 | 82.3% | 660 |
| | | equal weight | 2.0% | 3,600 | 82.3% | 660 |
| | | split | 1.1% | 2,600 | 75.2% | 760 |
| | | weighted (shipped) | 2.0% | 2,600 | 82.3% | 680 |
| 10 of 20 a period | all at 2.5% | apart | | 600 | 91.4% | 580 |
| | | equal weight | | 800 | 91.4% | 580 |
| | | split | | 600 | 85.6% | 680 |
| | | weighted (shipped) | | 600 | 91.4% | 580 |
| 10 of 20 a period | all at 4% | apart | | 3,400 | | |
| | | equal weight | | 5,800 | | |
| | | split | | 4,400 | | |
| | | weighted (shipped) | | 4,200 | | |
| 40, then 4 of 10 | one at 8%, the rest at 2.5% (5.25%) | apart | 0.6% | | 47.4% | 540 |
| | | equal weight | 0.2% | | 43.6% | 580 |
| | | split | 0.5% | | 35.3% | 650 |
| | | weighted (shipped) | 0.5% | | 33.5% | 680 |

</details>

The whole apart is the quickest, but its promise is two 5%s: the chance of any wrong "shown"
reached 4.8% with 10 segments at the target, and nothing holds it under 5%. The three that keep
one 5% stayed at 3.1% (equal weight), 2.8% (split) and 2.8% (weighted) at most, in all 24 settings.
Of those, the weighted test showed the whole as soon as the split or sooner in every setting, and
far sooner than equal weight (2,600 records against 3,600 with half the segments at the target;
4,200 against 5,800 with all at 4%). Against the whole kept apart, it needed 0% to 25% more records
before the whole was shown: none more when every segment's evidence was strong (600 either way with
all at 2.5%), 25% at most (1,000 against 800 with one of ten segments at 8%; 650 against 520 with
uneven segments all at 2.5%). The segments were shown as soon as with the whole apart when the
whole's evidence was strong, and later when it was weak: with one segment of five at 8% and the
whole above the target, 33.5% of the others by week 52 against 47.4% (a median of 680 records
against 540). Against the split, the weighted test showed segments as soon or sooner in all but two
of the 24 settings (8.3% against 8.4%, and 33.5% against 35.3%, by week 52). So the whole joins the
segments in one weighted closed test (trap L32). Its price, then: the whole's bar is 20 to 40
rather than 20, and a segment's rises by the number of segments times the whole's shortfall.

In plain words, with a member's **shortfall** the amount its evidence falls short of 20 (0 when it
is 20 or more):

- the **whole's bar** is 20 plus the segments' average shortfall: 20 when every segment's evidence
  is strong, 40 at most;
- a **segment's bar** is 20, plus each other segment's shortfall, plus the number of segments times
  the whole's shortfall: 20 when the others' evidence is strong, up to 40 for each segment when none
  has any.

Each member's **upper bound** is the rate its bar rules out (the lowest rate at which its E reaches
the bar), so "shown" and "upper bound under the target" always agree. `test/monitor.test.js` checks
both bars against every set of members that includes them, for 2,000 random families, and checks
that with the whole left out and equal weights the bar is 20 plus the others' shortfalls.

**An upper bound holds for its own segment.** In the same simulation (the weighted test), a given segment's upper bound was ever
below its true rate in at most 2.0% of runs (the worst segment of each of the 24 settings), under 5%
as for one series. But the chance that SOME segment's bound was ever below its own true rate reached
13.5% (ten segments, all at 2.5%): the bounds do not hold together, and the lowest of several is the
one most likely to be luck. So the report says, beside the
bounds, that each holds for that segment on its own, and that only "shown" is counted across
segments: the lowest of several upper bounds is not a result (trap L33).

**Small segments.** The bar needs records. With no silent error at all, the records needed before a
member can be shown (`node scripts/monitor-segments-sim.js small`):

| target | bar 20 (one series, or any member when the others' evidence is strong) | the whole at most (bar 40) | a segment at most, 2 segments (80) | 5 (200) | 10 (400) | 20 (800) |
|---|---|---|---|---|---|---|
| 2% | 224 | 266 | 307 | 361 | 400 | 439 |
| 5% | 88 | 105 | 121 | 142 | 158 | 173 |
| 10% | 43 | 51 | 59 | 69 | 77 | 84 |

A segment with fewer records than its own bar needs, even with none wrong, shows "too few: N needed"
instead of an upper bound, which would be noise (trap L25). Its rate and likely range are still
shown, and its alarm still runs: set per its own records, a small segment's alarm is as calibrated
as a big one's, it only needs more periods.

**Segments that first appear later: name them in advance.** Closed testing keeps its 5% for a family
fixed in advance. A segment with no records yet adds E = 1 (no evidence), so when one first appears
in a later period, the bars of every earlier period change (a segment's always rise, the whole's
usually do), and a "shown" printed then can be taken back (in the tests: the whole's W42, shown with email alone, is taken back once phone arrives in
W43). Leaving a segment out until it appears does not fix it: an average over a set that grows is
no longer one bet. In the simulation (`node scripts/monitor-segments-sim.js late`: every segment at 5% or
under, 20 records a week each, a report run every week on the weeks so far, 2,000 runs), the reports
using the family seen so far printed a wrong "shown" somewhere in 1.8% to 3.85% of runs, against
0.95% to 1.9% with the family named in advance: about twice as often, still under 5% here, but only
thanks to the bound's slack, not by any proof. And in up to 2.85% of runs a "shown" printed one
week was taken back once the later segments came. So `--segments chat,email,phone` names the family before the first
period: those segments, "(other)" for every value not named (pooled, and listed in the report), and
"(none)", all from the start, whatever comes. Then what is printed is valid and never changes.
Without `--segments`, the family is the segments in the periods given, and the report marks every
"shown" as provisional (trap L31). Decide the list before the first period: a list changed after
seeing the numbers is chosen by them.

<details><summary>Segments that first appear later</summary>

| segments | wrong "shown" ever printed, family seen so far | named in advance | a printed "shown" taken back |
|---|---|---|---|
| 2 at 5%: A from week 1, B from week 27 | 3.7% | 1.75% | 2.35% |
| 2 at 5%: A from week 1, B from week 9 | 3.05% | 1.8% | 0.95% |
| 5 at 5%: A from week 1, 4 from week 53 | 3.85% | 1.9% | 2.85% |
| 10 at 5%, one more every 5 weeks | 3.05% | 1.85% | 1.7% |
| 10 at 5%, one more every week | 1.8% | 1.7% | 0.05% |
| A at 5% from week 1, 4 at 2.5% from week 13 | 2.4% | 0.95% | 1.3% |

</details>

**Segments that overlap.** A record in several segments counts in each (trap L22); the average of
e-values holds whatever their dependence, so overlap does not break the bound. The alarms are another
matter: each is set per record checked, so the segments together false-alarm as often as their
memberships, and with overlap those are more than the records. So each segment's alarm is set for
the shared budget times the memberships per record so far (rounded up to a twentieth), and the
segments together keep their half of `--false-alarm-every` (trap L36). With no record in two segments
the ratio is 1, and nothing changes. Simulated (`node scripts/monitor-segments-sim.js overlap`: 2.5%
to 5%, the whole set for 4,000; a share of the records also in a second segment at random; 300 runs
of 600 periods for the false alarms, 2,000 runs for a rise to 5% in one segment's own records from
period 10):

<details><summary>Segments that overlap</summary>

| segments | in two segments | each segment set for | records per false alarm in all | records to flag the rise |
|---|---|---|---|---|
| 5 equal, 50 a period | none | 4,000 | 2,094 | 900 |
| 5 equal, 50 a period | 10% | 4,000 | 1,879 | 922 |
| 5 equal, 50 a period | 10% | 4,000 x memberships per record | 2,051 | 949 |
| 5 equal, 50 a period | 30% | 4,000 | 1,709 | 920 |
| 5 equal, 50 a period | 30% | 4,000 x memberships per record | 2,012 | 976 |
| 5 equal, 50 a period | 60% | 4,000 | 1,562 | 993 |
| 5 equal, 50 a period | 60% | 4,000 x memberships per record | 2,069 | 1,090 |
| uneven: 50/25/12.5/12.5%, 40 a period | none | 4,000 | 2,161 | 1,293 |
| uneven | 10% | 4,000 | 1,975 | 1,337 |
| uneven | 10% | 4,000 x memberships per record | 2,143 | 1,367 |
| uneven | 30% | 4,000 | 1,787 | 1,360 |
| uneven | 30% | 4,000 x memberships per record | 2,036 | 1,432 |
| uneven | 60% | 4,000 | 1,669 | 1,479 |
| uneven | 60% | 4,000 x memberships per record | 2,002 | 1,648 |

</details>

Without the correction, the report false-alarmed more often than asked as the overlap grew (once per
1,562 to 1,975 records checked, against 2,000); with it, within the budget in every setting (2,002
to 2,143). The price is a little time: a rise in one segment was flagged after 2% to 11% more records
(1,090 against 993 with 60% of the records in two segments; 1,648 against 1,479 with uneven ones).
Each row's level uses the memberships of the periods up to it, so a status once printed does not
change (trap L14). The report says what each segment's alarm is set for when it applies.

**What it rests on**, besides the above: within each segment, the records checked are a random
sample of that segment's records in the period. A segment checked more heavily than its share
counts for more than its share in the whole (trap L7).
