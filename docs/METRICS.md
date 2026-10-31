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
drawn from the records you care about. Two common cases break that:

- **A golden set built from traps.** It holds far more hard cases than real traffic, so its
  rate is a stress-test rate: how the workflow does on records chosen to trip it. That is the
  right yardstick for comparing versions on the same records, and the range says how precise
  it is, but it is not the rate real traffic would see, and no range can say how far off it
  is. The rate on real traffic needs a random sample of that traffic with its own answer key,
  or each kind of record weighted by its real share (stratified estimation; Cochran 1977,
  ch. 5). The reports say "the true rate on records like these" for this reason.
- **Repeated runs of the same records, added together.** A record's runs tend to go the same
  way, so three runs of 200 records are not 600 records' worth of evidence, and a range drawn
  from the added-up count comes out too narrow (records that repeat are clustered: the design
  effect; Kish 1965). `variance` never adds runs up; see below.

**How often the range holds.** A 95% range should miss the true rate about 5% of the time.
Wilson's does on average, but not at every rate. At very low true rates on small sets it
misses more often, up to about 16% at 10 records, and every one of those extra misses is on
the safe side: the range sits above the true rate, overstating the errors. Misses on the risky
side, a range below the true rate, stay close to the promised 2.5%, at most 4.3% at 10 records.
These figures were added up exactly, for thousands of rates and sizes, by error-rate-calculator's
audit ([AUDIT.md](https://github.com/DHuberPortfolio/error-rate-calculator/blob/main/AUDIT.md),
check 2.1), which runs the same formula with the same z = 1.96.

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
stress-test rate, not the rate real traffic would see, however the group is chosen.

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

`variance` also lists **possible key gaps**: values the workflow states in every run that
the answer key does not list. Each is either the same mistake made every time, or a gap in
the answer key; the tool cannot tell which, so a person decides.

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

## What-if

What would the numbers be at another threshold? A threshold change can only move a record
whose route the confidence gate decided, so the what-if moves only those (named by
`whatif.movable_field`; without it, it assumes every record that went out or was sent to a
person is movable, and says so). At the current threshold it must reproduce the actual
routes, or it reports that its assumption is wrong. It shows the silent error count beside
the rate, because a rate can fall only because correct records joined the denominator, with
no error prevented.
