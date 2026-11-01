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
  exactly from the binomial distribution, not estimated.
- **The hard minimum.** A perfect run: how many records with no silent error at all. At 5%,
  73; at 1%, 381. No test can show less.

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
The report lists these apart, as "the answer key blocks or suppresses them", whatever their
values.

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

## Live samples over time (`wfeval monitor`)

After launch, a person checks a sample of the records that went out without review every week
or month. Each period's rate alone is noisy: 3 silent errors in 30 records is 10%, likely
3.5-25.6%: one period alone cannot tell a bad week from a worse workflow. `wfeval monitor` reads the periods in time
order and answers two questions, each with its own method, chosen by simulation
(`node scripts/monitor-sim.js`, seeded: it prints the same tables every time, in under a
minute; every figure below comes from it). Rates in this section are of records out without review.

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
