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

## Per trap

A golden set is built from traps: records designed to provoke one kind of mistake. Grouping
results by the answer key's trap labels shows which kind of trap gets through, which a
single rate hides. With `min_per_trap`, a trap with too few records stops the run: one record
passing a trap can be luck.

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

`variance` also lists **possible key gaps**: values the workflow states in every run that
the answer key does not list. Each is either the same mistake made every time, or a gap in
the answer key; the tool cannot tell which, so a person decides.

## What-if

What would the numbers be at another threshold? A threshold change can only move a record
whose route the confidence gate decided, so the what-if moves only those (named by
`whatif.movable_field`; without it, it assumes every record that went out or was sent to a
person is movable, and says so). At the current threshold it must reproduce the actual
routes, or it reports that its assumption is wrong. It shows the silent error count beside
the rate, because a rate can fall only because correct records joined the denominator, with
no error prevented.
