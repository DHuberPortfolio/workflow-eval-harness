# How to read a report

A walk through one real report, top to bottom: the
[compliance reviewer before its prompt fix](https://dhuberportfolio.github.io/workflow-eval-harness/samples/compliance-before.html),
40 pieces of law-firm advertising copy scored against their answer key. The terminal report
(`wfeval score`) shows the same numbers in the same order.

## The words

| Word | What it means |
|---|---|
| **golden set** | The test records: each one chosen or built to check something |
| **answer key** | The correct answer for every record in the golden set: its values, and where it should have gone |
| **went out without review** | The workflow released it and no person looked at it (the config's route class `auto`) |
| **sent to a person** | A person decides before anything happens (`review`) |
| **blocked** | Stopped, and never processed further (`block`) |
| **suppressed as a duplicate** | Dropped because it repeats a record already kept (`exclude`) |
| **needed a person** | The answer key says it should not have gone out without review, or its values are wrong. The config's `wrong_when` chooses which evidence counts |
| **silent error** | Went out without review, but needed a person. Nobody saw it |
| **silent omission** | Blocked or suppressed, but should have gone out or to a person. Nobody saw that either |
| **confidence gate** | The confidence a record's strongest value needs for the record to go out without review |
| **confidence floor** | The confidence a value needs to be kept at all |
| **declined** | The workflow said "none of these" instead of a label (only for outputs configured to decline). Never counted as a wrong label |
| **likely range** | Where the true rate on records like these probably sits (a 95% range). A small golden set gives a wide range. It covers chance only ([what it does not cover](METRICS.md#every-rate-carries-its-likely-range)) |
| **stress-test rate** | A rate on a golden set built from traps, which holds more hard cases than real traffic. Right for comparing versions on the same records; not the rate real traffic would see |

## 1. The headline: silent error rate

> **30.0%** · 6 of the 20 records that went out without review should have had one.
> The true rate on records like these is likely between 14.5% and 51.9% (95% range). With 20
> records, each one moves it by 5.0 points.

Of everything the workflow released unseen, the share a person should have caught. Read all
three parts: the rate, the count behind it (6 of 20) and the likely range. On a golden set this
size the true rate could be anywhere from about 15% to about 52%. What is certain is that it
is not small. "Records like these" matters: these 40 documents were chosen to test the
reviewer (each is labelled with the layer that should catch it, and 26 have violations), so
this is a stress-test rate. The rate on real copy needs a random sample of real copy.

With `--target 10`, a line under the headline says whether the rate is shown to be under 10%
(its whole likely range is), and if not, how many records would show it: the plan, for an 80%
chance if the real rate is this run's, and the hard minimum, a perfect run
([how it is worked out](METRICS.md#how-many-records-would-show-a-target)).

With `clusters` in the config (or `--cluster-by`), one more line gives the likely range counting
clusters of records that go together, such as retellings of one story, instead of every record.
It is wider when the silent errors pile up in a few clusters, and the same as the headline's when
they are spread out across clusters. With no silent errors, or all of them in one cluster, there
is nothing to tell piling up from chance, so each cluster's records are taken to go right or
wrong together, worth at most one record per cluster: at least as wide as the headline's, the
cautious choice, and the line says so
([how it is worked out](METRICS.md#ranges-that-count-clusters)).

With `--mix <file>`, two more lines estimate what a real mix of traffic would see: each group of
the golden set weighted by its share of that traffic, the silent error rate beside this
stress-test rate, then the straight-through. A reweighting of the records tested, not a
measurement of real traffic ([how it is worked out](METRICS.md#weighted-to-a-real-mix)).

## 2. The row of tiles

| Tile | Here | What it tells you |
|---|---|---|
| Straight-through | 50.0% (20 of 40) | The share that went out without review. Never read it alone: sending everything out scores 100% |
| Silent omissions | 0.0% (0 of 40) | Records blocked or suppressed that should not have been |
| Review precision | 100.0% (20 of 20) | Of the records sent to a person, the share that needed one. Low means reviewers are wasting their time. A record the answer key blocks or suppresses never needed one: the workflow should have left it out on its own |
| Safeguard failures | 0 | Records that got past the workflow's own gate or floor. Critical when not 0: the workflow has a hole, even if the content happened to be right |

The pairing that matters: straight-through says how much work the workflow saves, the silent
error rate says what that saving costs.

## 3. The silent errors

One row per record that went out without review but needed a person. Here, six:

| Column | Here (E15) | Meaning |
|---|---|---|
| Severity | medium | How much it matters: critical, high, medium or low. A record takes its worst type's severity |
| Types | SP-SHOULD-REVIEW, SP-MISSING-REJECTED | What went wrong, as codes. The legend below the table says each in plain words |
| Went | PASS_WITH_NOTES | The workflow's own decision |
| Answer key | VIOLATION | What it should have been |
| What differed | violations found, but set aside: IMPLIED_GUARANTEE, RESULTS_NO_DISCLAIMER | The values behind the mistake |
| Trap | llm | The kind of trap this record was built as |

**"Found, but set aside"** and **"never found"** point at different fixes. Found but set aside
means the model knew, and its confidence fell below the bar: a confidence problem, which a
prompt that states confidence better can fix, or (with care) a threshold. Never found is the
model's blind spot, and no threshold fixes it. Here, in all six, the model had found a
violation and set it aside because it understated its confidence. That finding is what led
to the prompt fix.

When the answer key accepts any one of several values (an `any_of` slot), a miss names the
whole slot: `never found: one of ep-07, ep-08, ep-09` means none of the three was given, and
`found, but set aside: ep-11 (one of ep-10, ep-11)` means the model found ep-11 and set it
aside. Values the config calls equivalent are read as one name first, and the clean-ups at the
end of the report say which were read as which.

Below the silent errors come the silent omissions and safeguard failures (none here), then
the **unnecessary reviews**: records sent to a person that could have gone out. A few are
the price of safety; many teach reviewers to stop looking.

## 4. Output quality

| | Here | Meaning |
|---|---|---|
| Precision | 90.0% | Of the values the workflow applied, the share the answer key lists |
| Recall | 67.5% | Of the values the answer key lists, the share the workflow applied |
| F1 | 0.771 | The two balanced into one number; 1 is perfect |
| Exact match | 72.5% | Records whose values match the answer key exactly |
| TP / FP / FN | 27 / 3 / 13 | Right values applied / wrong values applied / right values missed |

A value the model found but set aside counts as missed. That is why recall is low here: the
model found most of the violations, but set many of them aside.

## 5. Per trap

A trap is a record built to provoke one kind of mistake. Here the trap is which layer should
catch the violation, and it tells the whole story in one row: every violation only the LLM
layer can catch (`llm`, 11 records) that got through is here, 6 of them, while the regex
layer's (`deterministic`) are all routed right.

**Per group** comes next when the config has `groups` or the command has `--group-by` (this
sample has neither): the headline rates again for each value of one field, such as the tuning
half against the held-out half. Each row shows its count and likely range under the rate.
A group has fewer records than the whole run, so its range is wider: compare the ranges, not
the percentages ([more](METRICS.md#per-group)).

## 6. Calibration

Does a stated confidence mean what it says? Claims are grouped by the confidence the model
stated. For each group, the chart plots how often those claims were actually right. On the
grey diagonal, stated equals actual; below it, the model was right less often than it
claimed. The average gap is 0 for a perfectly calibrated model.

With 37 claims the ranges are wide (the report says so). Read them as a direction, not as a
basis for new thresholds.

## 7. Every record, and what was not measured

The last table lists every record: where it went, where the answer key says it should have
gone, whether it needed a person, and the outcome. **Not measured** lists what the report
could not check and why (here, no confidence floor in the config). A missing measurement is
always named, never shown as zero.

## In the terminal: possible key gaps and rulings

The terminal report (not the HTML one) adds **POSSIBLE KEY GAPS**: the values the workflow
applied that the answer key does not list. Each is a mistake, or a value the key is missing,
and a person decides which. "Silent error, clears if added" marks the ones a ruling could turn
from a silent error into a correct record; "stays one if added" means the key sends that record
to a person anyway. The decisions go in a rulings file (`--rulings`,
[CONFIG.md](CONFIG.md#rulings-on-possible-key-gaps---rulings)). With one, a **RULINGS** line at
the top names the values added to the key for this report (the key file itself is unchanged),
rejected gaps are counted instead of listed, and if any ruling is still pending, a line under
the headline gives the silent error rate as if every pending ruling were added. Once they are
decided, the rate lands between the two, unless that line says otherwise
([why](METRICS.md#the-bracket-for-pending-rulings)).

## In the terminal: a judge checked by a person (`wfeval estimate`)

For production records with no answer key: an AI judge wrote one for every record, and a person
checked some ([CONFIG.md](CONFIG.md#a-judges-answer-key-checked-by-a-person-wfeval-estimate)).
On the fixture in `test/fixtures/estimate/`:

> 31.3% of the 20 records that went out without review are estimated to be silent errors.
> The true rate on records like these is likely between 12.8% and 64.2% (95% range).
> That is worth about 9 records checked by a person alone: a person's own range would be this
> narrow from about 9 (the person checked 10).

- **The estimate** splits the records out without review ("records out") by the judge's verdict: the ones it **flags** (it says
  silent error) and the ones it **passes**. The person's checks give each group's real rate; the
  judge gives each group's size. A judge that is wrong in either direction does not bias the
  estimate; it widens the range. The line under it states what the estimate rests on: the person
  picked the records at random (from all of them, or within each verdict group) and checked them
  without seeing the judge's verdict. The range can start at 0.0% even after the person confirmed
  errors (10 records out, all checked: 2 of 2 flags wrong, 0 of 8 passes gives 20.0%, 0.0-60.4%): with so few checks it cannot rule
  out that records like these are almost never wrong. It errs on the safe side; more checks lift it.
- **Worth about N records checked by a person alone**: how many random checks a person would
  need, without the judge, for a range this narrow. Above the number checked, the judge is
  earning its keep; at or below it (as here, on 20 records), it is not yet.
- **For contrast**: the **judge alone** (the rate if the judge were always right; how far off it
  is shows how much trusting the judge would mislead) and the **person alone** (fair only if the
  checks were picked at random from all the records out, not by the judge's verdict as `--pick`
  does; the report cannot see how they were picked, so it says so. It shows "not a fair rate" when
  the picks file given with `--picks` says they were picked by verdict, or when they hold far more
  judge flags than the run does). With `--picks`, a **PICKS** line confirms the person checked
  exactly the picked records; any difference is a K14 warning. The header says what the judge's
  key covers: every record, or just the records out without review (all it needs).
- **By the judge's verdict**: each group's records out, checks and silent errors found, then how
  the checks were split: the way `estimate --pick` splits that many (the recommended way), or not,
  which is fine if they were picked at random. With a K7 warning it says the split matches but the
  checks within a group may not have been picked at random.
- **The judge, on the checked records**: of the silent errors the person found, how many the
  judge caught; of the judge's flags the person checked, how many the person confirmed; and
  Cohen's kappa, their agreement beyond chance ("not informative" when the judge gave every
  checked record the same verdict: there is nothing to compare).
- **Where the judge and the person disagree**: the records to read when fixing the judge's prompt.
- **No estimate**: when a verdict group has no checked record, its rate could be anything from 0%
  to 100%, so the report gives only the bounds that follow, and says which group to check.

**Before checking: `--pick`.** `wfeval estimate ... --pick 10 --seed 1` (no `--key` yet) prints
**PICK**: the records to check, in the run's order, so the list does not say which ones the judge
flagged. Check them without looking at the judge's verdicts. Under the list, how they were chosen:
how many from each verdict group (2 of the 5 flags and 8 of the 15 passes on the fixture; when the
judge flags a small share, most go to the passes, [why](METRICS.md#which-records-to-check)), at
random within each, and the command to run, with your files' paths, once your answer key for them
is written.

## Across runs

- **`wfeval variance`**: the same metrics over repeated runs of identical code. The range
  between runs is how precise any single run can claim to be. It names the figure to quote,
  the worst run's silent error rate with its likely range, and never adds the runs together:
  they repeat the same records, so the added-up count would look like more evidence than it
  is. The line after it counts the different records that were a silent error in at least one
  of the runs: how many records the workflow can get wrong unseen at least sometimes. That
  count only grows as runs are added, so read it with the number of runs it names. It also
  lists the records that changed route between runs, and **possible key gaps**:
  values stated in every run that the answer key does not list, for a person to rule on (with
  `--rulings`, each shows its ruling, and rejected ones are only counted).
- **`wfeval compare`**: what changed between two runs, and whether each change is bigger than
  the spread of identical runs ("beyond noise") or not ("within noise"). Its **paired** table
  needs no repeated runs: on the same records, for silent errors, unnecessary reviews and the
  rest, how many records the change fixed and how many it broke, and whether that is better,
  worse or unclear. Plus every record whose route was fixed or broken. With `--after-key`, the
  same run against an old and a new answer key: every change is the key's.
- **`wfeval rate 2 15 --target 5`**: the likely range for any count, and what a target needs.
- **`wfeval whatif`**: what the numbers would be at another threshold. Read the silent error
  count beside the rate: a rate can fall only because correct records joined it. With
  `--gate --target 5`, the **certified** column marks the gates shown to keep silent errors under
  5% after counting every gate tried, and **CERTIFIED UNDER 5%** names the loosest of them; a gate
  that only looks under the target read alone was picked from many, and proves less
  ([why](METRICS.md#a-certified-gate)).
  `--policies <file>` and `--hold-if` compare routing policies side by side instead
  ([how to read it](#policies-side-by-side)).

## Policies side by side

`wfeval whatif --policies <file>` (or `--hold-if`) prints a short table to compare the rows by eye
(silent error rate, went out, unnecessary reviews, and with `--target`, certified; a long name is
cut there and given in full below), then one block per row with every figure, all within 100
columns. "6 rows: the run as it was and 5 policies" is the count certification pays for. In each
block:

- **went out**, **straight-through**: how many records the policy lets out without review.
- **silent error rate** with its **likely range**: of those, the share that needed a person. Read
  the count, not only the rate: holding a correct record lowers the rate's base with no error
  prevented.
- **silent omissions**: unchanged by a hold, which never blocks or suppresses anything.
- **unnecessary reviews** and **review precision**: what the policy costs the people reviewing.
  A policy that holds more always looks safer; this is the price.
- **held**: records the policy's hold-if rules sent to a person. **moved by the gate**: records the
  policy's threshold change moved, in either direction, before any hold (a record the gate let out
  and a rule then held counts in both).
- **vs as run**: the same records, paired with the run as it was: for silent errors (and
  omissions) how many the policy fixed and how many are new, for unnecessary reviews how many it
  removed and added, with the change's likely range in points of all records and whether that is
  better, worse or unclear (the same paired reading as `compare`). A hold-if policy only ever
  fixes silent errors and adds unnecessary reviews; a looser threshold can do the opposite.
- Beside the name, **(exact)** (hold-if only: no assumption) or **(assumes the gate decided)** (a
  threshold change: as good as the gate what-if's assumption, printed at the top).
- A policy that holds and moves no record is named below the blocks: it is the run as it was
  again, usually a condition that matches nothing in this run.

With a threshold change, a **Check** line says whether the simulation reproduces the real routes
at the config's own gates; **CHECK FAILED** means the rows that change a threshold rest on an
assumption this run contradicts. Warnings and clean-ups from reading the files come last.

With `--target 5`, the **certified** column marks the policies shown to keep silent errors under
5% after counting every row tested, and **CERTIFIED UNDER 5%** names the loosest of them. If that
policy lets out more silent errors than the run as it was, the next line says so. As with
gates, a policy picked from many because it looks good proves less than it seems: confirm it on
records it was not chosen on ([why](METRICS.md#routing-policies)).

## Live samples over time (`wfeval monitor`)

After launch, a person checks a sample of the records out without review every week or month.
`wfeval monitor` reads those periods in time order. The report, on the monitor fixture
(`node bin/wfeval.js monitor --counts test/fixtures/monitor/counts.csv --target 5`):

- **One row per period**: records out without review checked, silent errors, the rate with its
  likely range, **to alarm** (how far the alarm's running total has climbed toward its alarm
  level: 100% is an alarm), the status, and the **upper bound** (the highest the true rate is
  likely to be (95%), from every period so far, valid however often you look; "shown" marks the periods
  where it is under the target). One period's rate alone is noisy: 3 of 30 is 10%, likely
  3.5-25.6%. Read the two answers below, not the rows one by one.
- **HAS IT GONE UP?** Either no alarm, with how far the total stands toward it, or **ALARM since**
  a period: the silent error rate has likely risen above the acceptable rate, with the period the
  rise likely started (the period after the total last stood at 0). After a fix, restart the alarm
  with `--since <the first period after the fix>` (the bound keeps counting every period). `--fail-on-alarm` exits with code 3, for a
  scheduled job.
- **SHOWN UNDER 5%** (with `--target 5`), since a period: the true rate is under 5%, valid
  however often you look: with the rate steady, at most a 5% chance of a false "shown" (if the
  rate drifts, "shown" means it was under 5% for at least part of the time). Or **NOT SHOWN**, with the upper bound and the records and silent errors
  it comes from; if it was shown before, the report says when, and that the silent errors since
  have taken the evidence back below the bar. Checking a likely range every week and stopping the
  first time it is under the target shows "under" by luck far more often than 5%; this bound does
  not ([why](METRICS.md#is-it-shown-under-the-target-valid-however-often-you-look)). With an
  alarm raised, read the bound as all the periods together, not as the rate now.
- **NOTES** may suggest `--acceptable` (trap L18): when the alarm dates the rise to the very
  start, or the periods before it run clearly above the acceptable rate, the alarm may only be
  saying that the workflow runs above it. Set `--acceptable` to the rate measured before launch.
- **TUNED TO**: how many records, on average, it takes to flag a rise to the alarming rate, and
  how many records are checked per false alarm when the rate is the acceptable one, for the
  period size named. Also the **break-even rate** (above it the alarm's total climbs, so a rate
  under the alarming one is flagged too, only later) and the records to an alarm at 90% of the
  target. Set with
  `--false-alarm-every` (2,000 by default): fewer false alarms mean slower flags.

The inputs are described in [CONFIG.md](CONFIG.md#live-samples-over-time-wfeval-monitor).

## Agreement among graders (`wfeval agree`)

Not a report on a workflow: a report on the answer key. Two or more people labelled the same
records; the question is whether they would have written the same key. One block per output (and
one for the route, and for free-text grades one for the grade and one for "invented or not"):

- **alpha**: Krippendorff's alpha. 1 is perfect agreement, 0 is what chance alone gives, below 0
  worse than chance. Beside it, its **likely range**, and Krippendorff's reading: 0.800 and up
  reliable; 0.667 to 0.800 tentative conclusions only; below 0.667 do not rely on it. The reading
  comes from alpha alone, so when the likely range reaches below the reading's own bar, the line
  adds "(not shown: the likely range reaches below 0.800)": alpha points to that reading, but
  these records cannot show it. **Not
  measurable** means every grader gave the same value, so chance alone agrees perfectly: there is
  nothing to tell agreement from luck, and no number is given.
- **chance alpha is below 0.800 / 0.667**: the share of the resampled alphas under each threshold,
  read the same way as the range (Hayes and Krippendorff's q). A rough guide, not an exact
  probability: 30% below 0.800 says the records leave plenty of room for the key to fall short of
  the usual bar. When the "probably too narrow" line shows, this share is as unreliable as the range.
- **no likely range**: alpha is 1, every value but one is the same, one record was compared, or
  every resample gave the same alpha. Resampling so few
  disagreements cannot say how sure to be, so no range is given; the line says what would help.
- **! only N value(s) are not the most common one ... probably too narrow**: the range stands on the
  values that differ from the most common one. With fewer than 20 of them, a BCa range (the one used
  except for names with exactly two values on every record) can miss the real alpha far more often than 5% of the
  time, however many records there are. Label more records.
- **compared**: the records labelled by two or more graders, and how many values could be paired.
  Records labelled by one grader only are left out and named.
- **disagreement**: how much the graders disagree, as a share of what chance alone would give
  ("25.4% of what chance alone would give"); alpha is 1 minus that share. The raw numbers are in
  --json. **Raw agreement** is the share of pairs of values that are the same.
- **! one value ... is 90.9% of the values**: the prevalence paradox, said only when alpha is short
  of 0.800. When one value is most of the values, chance alone agrees almost as often as the graders
  (the line gives that chance agreement), so alpha can be low while raw agreement is high. Both are
  right: the graders mostly agree, and they have not shown they agree on the rare value. Check the
  rare value's records.
- **each pair**: alpha for every two graders, on the records both labelled. One grader in every
  low pair is the odd one out: compare their guidelines, not just their answers.
- **leave one out** (three graders or more): alpha without each grader in turn, and the grader whose
  removal raises alpha most. That grader labels most differently from the rest; it does not say they
  are wrong (one careful grader among careless ones would be named too).
- **route values** are the answer key's own names (TO_AGENT, AUTO_REPLY). The route is compared by
  class, so two names that lead to the same class agree; where several names share a class, the
  class is shown beside the name.
- **to settle**: every record the graders labelled differently, with each grader's value. Settle
  these, and the rates measured against the key stand on firmer ground.

For a set output, **MASI alpha** is the same comparison with another way of measuring how far
two sets are apart, given for comparison ([why Jaccard is the one used](METRICS.md#agreement-among-graders)).

Why each number exists: [METRICS.md](METRICS.md). Every error code in full:
[SILENT_ERRORS.md](SILENT_ERRORS.md).
