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
