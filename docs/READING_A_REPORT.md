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
| Review precision | 100.0% (20 of 20) | Of the records sent to a person, the share that needed one. Low means reviewers are wasting their time. Where the key's route counts, a record the answer key blocks or suppresses never needed one: the workflow should have left it out on its own |
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
the price of safety; many teach reviewers to stop looking. Records the answer key blocks or
suppresses are listed apart there (`key_leaves_out` in `--json`), since no person was needed for
them either; with `"wrong_when": "any_mismatch"` the key's route counts for nothing, so that list
is empty, and only the values say whether a review was needed.

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

A report whose run evaluated nothing says so first: `NOTHING WAS EVALUATED  every model call failed
(40 of 40 records)`, or `most model calls failed (31 of 40 records, 77.5%)` when more than half did,
and the numbers under it say nothing about the workflow. A build gate fails on it
([exit code 3](CONFIG.md#build-gates)).

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

## In the terminal: answer-key suspects (`wfeval suspects`)

`wfeval suspects` lists the answer-key entries one or more runs disagree with, the likeliest key
errors first, for a person to read and rule on. On the fixture in `test/fixtures/suspects/`
(`--config config.json --key key.json run-a.json`):

```
  #  record  output    the answer key  the run
  1  T8      category  says billing    says shipping (0.95)
       Where this workflow gives a category label at about this level on other records, the answer
       key agreed on 6 of 6 at 0.90 or more; with so few records, the tool reads that as about 93%.
       Rule: replace (with shipping) or keep.
  2  T8      tags      lists late      does not say it
       This workflow leaves late out on 0 of the 3 other records whose answer key lists it, and on
       6 of the 7 whose key lacks it. Rule: remove or keep.
```

- **The answer key column** says what is questioned: **lacks** a value (the key may be missing it),
  **lists** a value (it may hold it wrongly), or **says** a label (it may have the wrong one).
- **The run column** says what the runs did: how many state the value or give the label, how many
  applied it, and their confidences ("no confidence" for a rule's output). With several runs,
  "4 of 4 say it" is stronger than "1 of 4".
- **The line under each** says why it is listed, in the numbers the ranking used, measured on the
  answer key's other records: where the workflow answers like this elsewhere, how often the key
  agrees. The higher that agreement, the more surprising this disagreement, and the higher the
  suspect. Counts ("0 of the 3") are what happened on other records. A percentage comes after the
  counts it was read from, as what "the tool reads that as": half a record each way pulls a level
  with few records toward even, so 6 of 6 reads as about 93% ("with so few records" says so, under
  20 records), and between two levels it is read in a straight line ("reading between them").
  With several runs, the line starts with the number the suspect is ranked on: "Average 0.48 over
  2 runs, counting 0 for the run that does not say it" (or "that gives another label"). A value
  stated with no confidence is counted as 1, and the line says so. It ends with the rulings to
  choose from.
- **A suspect is not proof.** Each is a mistake by the workflow or by the answer key; read the
  record. The ranking puts the likeliest key errors first, but it measures the key against itself,
  so a key that leaves the same code out of every document of a kind looks like a workflow that
  over-states it. A pattern you find is a reason to read the rest of that kind, whatever their rank
  ([what the ranking can and cannot do](METRICS.md#answer-key-suspects)).
- **Rulings.** Record each decision in a rulings file (add or reject, remove or keep, replace or
  keep, or pending; [CONFIG.md](CONFIG.md#rulings-on-what-the-key-holds-wfeval-suspects)) and pass
  it with `--rulings`: a ruled suspect is not listed again, only counted ("2 more were ruled ... not
  listed again"), a pending one is listed with who and when, one whose ruling no longer fits the
  key is listed as "set aside", and a **RULINGS** section names every change the rulings made to the
  key. `--write-rulings new.json` starts the file for you: the listed suspects as pending rulings,
  with any rulings you already have (a set-aside one replaced, with a note), and `by` and `on` left
  to fill in. A pending ruling reads without them. To decide one, change "pending" to the ruling and
  fill in `by` and `on` (strict mode stops without them): a "proposed" left behind, or a keep's
  "with", is dropped with a note.
- **Records the answer key blocks or suppresses as duplicates** (with a correct route,
  `routing.gold_field`) are left out, as suspects and as evidence, and one line says how many
  (`key_leaves_out` in `--json`; with a split, of the half shown):
  they must not go out whatever their values, so their values change no routing rate (only output
  quality counts them). With `"wrong_when": "any_mismatch"` the values decide, and nothing is left
  out.
- `--top 20` (the default) lists the first 20; `--json` has every suspect, with its weight and the
  counts behind it.
- **With a split in the config**, a **SPLIT** line under the header says how many held-out records
  were left out. They are neither listed nor read as evidence for the others: a held-out record in
  the list would say the workflow got it wrong, which is what the held-out half keeps hidden. On
  the same fixture with `--config config-split.json`:

  ```
  SPLIT  The tuning half: 8 of 13 records.
    The other 5 records are held out from tuning (30% held out by a hash of each record's cluster, a
    duplicate's primary, or its id): left out here, both as suspects and from the evidence each
    suspect is ranked on. --show-held-out includes them.
  ```

  Rulings on held-out records are counted on the line after it, never named, and a warning about a
  held-out record counts it instead. `--show-held-out` lists both halves, and with `split.log` the
  log records that the held-out records were listed
  ([CONFIG.md](CONFIG.md#a-tuning-half-and-a-held-out-half-split)).

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
  values stated in every run that the answer key does not list, for a reviewer to rule on (with
  `--rulings`, each shows its ruling, and rejected ones are only counted).
- **`wfeval compare`**: what changed between two runs, judged two ways, each asking its own
  question.
  - **The noise check** (the first table's verdict column) compares each change with the
    spread of repeated runs of the unchanged workflow (`--noise`): the highest minus the lowest
    value of the same metric over those runs. A bigger change is "beyond noise", one no bigger
    is "within noise". It asks: did the number move more than re-running the same workflow moves
    it? Without `--noise` it says "no noise baseline" and judges nothing.
  - **The paired verdict** (the PAIRED table) needs no repeated runs. On the same records, for
    silent errors, unnecessary reviews and the rest, it counts the records the change fixed and
    the ones it broke, and asks whether the fixed outnumber the broken by more than chance would:
    better, worse or unclear.
  - **When they disagree, act on the paired verdict** for the outcomes it counts. Re-running
    flips records both ways alike, so the noise is already in its counts; and a rate can move
    only because records joined or left its base, which a count of records fixed and broken
    cannot. "Beyond noise" beside "unclear" usually means the rate's base moved, or a few repeated
    runs gave a narrow spread: not a win yet. "Within noise" beside "better" means the change
    fixed clearly more records than it broke, though the rate's run-to-run spread hides it: the
    paired verdict stands. For the metrics the paired table does not count (straight-through, an
    output's precision and recall, calibration), the noise check is the only verdict.

  Plus every record whose route was fixed or broken. With `--after-key`, the same run against an
  old and a new answer key: every change is the key's.
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

## A tuning half and a held-out half (`split`)

With `split` in the config, a report has two halves, and reads them differently
([CONFIG.md](CONFIG.md#a-tuning-half-and-a-held-out-half-split)).

- **SPLIT**, at the top: how many records are in the tuning half, how many are held out, and how
  they were drawn. Every other number in the report (the headline, the target, every list of
  records, the quality, traps, groups, calibration, possible key gaps) is the **tuning half's**: the
  records you may read, fix and tune on. The target says "(tuning half)".
- **HELD-OUT HALF  not looked at**, by default: nothing of the held-out half is in the report, and
  no look was spent. The line says what `--held-out` would be: "2 looks at this held-out half so
  far (split-log.json); the next is look 3, which may use 0.625% of the 5% allowed for being
  wrong". Tune as often as you like; look on purpose. `wfeval check` says the same.
- **HELD-OUT HALF**, with `--held-out`: the records kept out of tuning, as rates only. The same rows
  and words as the headline, each with its count and likely range, its safeguard failures, and the
  silent errors' count by severity; never which records. Seeing which held-out records failed is
  what would let you fix exactly those, and then the held-out half would flatter you as the tuning
  half does. Warnings about a held-out record count it instead of naming it. With `--show-held-out`
  the header says the records are listed in full further down.

Under it, the look this report is, and the claim. From the split fixture's second look
(`test/fixtures/split/`, `predictions-v2.json`, `--target 40 --held-out`, with a log):

```
  Look 2 at this held-out half (counted in split-log.json).
  Not yet shown under 40%: with these records the true rate could still be as high as 49.1%.
  Each look at the held-out half must pass a stricter test than the one before; this is look 2,
  which may use 1.25% of the 5% allowed for being wrong. Over all looks, a false "shown" stays under
  5%: proven if no version tested was chosen by its held-out numbers; if one was, that held in
  simulation, not by proof.
```

- **Look N**: how many looks at this held-out half (`split.log` counts them, per record: a look on
  an older key, before records were added, is no look at those records). "Look 2 ... again" means
  the same command, files, config and mode as before: nothing new was shown, so nothing was spent.
  **Without a log, no claim is made**: the rates and ranges are shown, and one line says how to
  count looks.
- **Shown under 40% / Not yet shown under 40%**: the yes or no, with the exact binomial bound it
  rests on: the highest rate these records do not rule out at this look. Shown when that bound is at
  or under the target. "Must pass a stricter test than the one before" is the look count at work:
  each look may use half of what the looks before it left of the 5%.
- **The likely range and the bound.** The likely range is the usual 95% range (Wilson's, an
  approximation); the claim uses the exact bound at this look's share, which is stricter at small
  counts and grows tighter to reach with every look. So a likely range wholly under the target can
  still come with "not yet shown". At a first look, 0 of 10 records has a likely range reaching
  27.8%, under a 28% target, while the exact bound at 2.5% reaches 30.8%: "not yet shown", and the
  report says why on the next line.
- **Too few records**: even no silent error at all among these held-out records could not show it,
  even at a first look: more records are needed. **Used up**: a first look could have, but this
  look's share is too small (if the rate itself is above the target, the report says that too): add
  fresh records to the golden set; they have had no look, and appear as **NEWEST RECORDS** with a
  claim of their own.
- **listed at look N**: a report with `--show-held-out` listed some of the held-out records then
  (`suspects` lists only the suspects it shows); a claim on the half spends nothing since, while
  records it never listed keep their own claim.
- A line names any trap type or group the held-out half has no record of: it cannot speak for it.
- **Its answer key has not been checked by suspects**: said once. `suspects` leaves the held-out
  half out, so a key mistake there reads as a silent error, or hides one; [CONFIG.md](CONFIG.md#the-held-out-halfs-answer-key)
  says how to check it before the first look, without looking.

**`compare --held-out`** adds the held-out half's PAIRED table (fixed, broke, verdict) without ids;
**`variance --held-out`** each run's held-out silent error rate and its worst run, the one to quote
for the held-out half. Both are looks, and make no claim. **`whatif --target`** computes everything
on the tuning half and names the gate or policy it certified; with `--held-out` it tries it on the
held-out half once. "The held-out half disagrees" means its rate there is at or above the target.
"Not confirmed: ... the tuning half flattered it" means the rate it was certified at on the tuning
half sits below the held-out half's whole likely range. "Too few records" means even no silent error
could not show it. "Not confirmed at this look" means it could not be shown yet, which is not
evidence against it.

Build gates: `--fail-on` and `--fail-if-worse` read the held-out half only with `--held-out`; without
it, a note on the error stream says the gate was the tuning half's.

Warnings to act on: **O5** (a kind of record fell mostly into one half, beyond what chance gives:
before anyone looks, draw another split with a new `split.salt`), **O3** (retellings of one story on
both sides), **O10** (a record changed half since an earlier look), **O26** (`compare --after-key`:
the two keys put a record in different halves).

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

**Wrongly left out** (`--watch silent-omissions`): the same report for the records the workflow
blocked or suppressed. The header says "rate: wrongly left out: of the blocked or suppressed records
a person checked, the share that should have gone out or to a person"; the columns are **left out** (the
records blocked or suppressed that were checked) and **wrongly** (those the answer key says should
have gone out or to a person). This share is **not score's silent omission rate**: score divides by
the records that should have been seen, this report by the records left out (the segments fixture's
W40: score 1 of 6, monitor 1 of 3). Every number below the table is about this share, with the
settings given for it; when the report suggests where to measure the acceptable rate, it points to
monitor itself on the golden-set run file, not to score (with the key in a file of its own, add
`--keys`; with a split in the config, the report warns that the file shows both halves, and the
figure comes from score's tuning half instead: [CONFIG.md](CONFIG.md#live-samples-over-time-wfeval-monitor)).
"One test of a size fixed in advance" is then `rate --target`, which takes any count; `score
--target` tests the silent error rate only. A workflow can look perfect on the records it sends out
and still lose good records unseen: this is the report that shows it.

**Segments** (`--segment-by channel`; for a counts file, `--segment-by` and the column's name): after
the whole's report, **SEGMENTS** gives one row per segment, each with its own alarm and bound, from
all its periods: records, the rate with its likely range, how far its alarm has climbed, its status,
and its upper bound. Small segments have wide ranges: compare the ranges, not the percentages. Then:

- **HAS ANY SEGMENT GONE UP?** An alarm in a segment says that segment's rate has likely risen,
  with the period the rise likely started, even when the whole shows nothing: a rise confined to
  one channel is diluted by the others. The alarms share `--false-alarm-every`, so the report in all
  (the whole and every segment) keeps about one false alarm per that many records checked. The
  whole's alarm is then set for fewer false alarms than it would be alone, so it flags a rise later:
  its alarm level and its TUNED TO line give both figures ("Alarm level 200 steps (152 without
  --segment-by)", "flagged after about 281 records on average (219 without segments)"), and if the
  whole alone would have alarmed, the report says so. With one segment, and no record in two, the
  segment is the whole and nothing is shared. `--fail-on-alarm` counts every segment's alarm.
- **SHOWN UNDER 5% in** a segment, and the whole's **SHOWN UNDER 5%** above: because the whole and
  the segments are checked at once, each needs more evidence (a higher **bar**) before it is called
  shown; that keeps the chance of any wrong "shown" in the report at 5%, however often you look. The
  whole's bar is 20 to 40 (the report gives it: "a bar of 34.2 here, against 20 alone"). The exact
  rule follows in the report: the whole's bar is 20 plus the segments' average shortfall below 20; a
  segment's is 20 plus each other segment's shortfall plus the number of segments times the whole's.
  Picking the best-looking of many segments is how luck gets mistaken for a result; the bars are what
  pay for the picking.
- **Shown before, not now**: a segment that was shown under the target in earlier periods and is not
  any more is named, with the last period it was shown, as the whole's is.
- **Provisional** (`shown*`): without `--segments`, the family is the segments in the periods given.
  A segment that first appears later joins it and changes the bars, so a "shown" printed today can be
  taken back next week: every such mark is starred, in the table and in the JSON (`"provisional":
  true`). Name the segments with `--segments chat,email,phone`, chosen before the first period
  counted, and the family is fixed (those, "(other)" and "(none)"): what is printed stays. Naming
  them after seeing the numbers is choosing them by the numbers.
- **Upper bounds**: each segment's holds for that segment on its own (the JSON gives one for every
  period it is shown). Only "shown" is counted across segments: the lowest of several upper bounds
  is not a result.
- **too few: N needed**: the segment has fewer records than its bar needs even with no silent error
  at all, so it cannot be shown under the target yet, and no bound is printed: it would be noise.
- A segment with no record in the series watched is named on its own line, as are the values pooled
  into "(other)"; records with several segment values count in each, and the report says how many,
  and what each segment's alarm is then set for so that the report still keeps its false-alarm
  budget.

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

## Rulings made by AI judges

A ruling can come from an AI judge (`"reviewer_kind": "judge"`, written by `wfeval judges`). A report using
such rulings says how many there are, and `score` gives the silent error rate without them (`by_judges` in
`--json`), so you can see what they moved. A file with no AI ruling reads as it always did. See
[CONFIG.md](CONFIG.md#ai-judges-wfeval-judges) for how far to trust them.
