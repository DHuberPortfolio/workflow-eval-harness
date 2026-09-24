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
| **likely range** | Where the true rate probably sits (a 95% range). A small golden set gives a wide range |

## 1. The headline: silent error rate

> **30.0%** · 6 of the 20 records that went out without review should have had one.
> The true rate is likely between 14.5% and 51.9% (95% range). With 20 records, each one
> moves it by 5.0 points.

Of everything the workflow released unseen, the share a person should have caught. Read all
three parts: the rate, the count behind it (6 of 20) and the likely range. On a golden set this
size the true rate could be anywhere from about 15% to about 52%. What is certain is that it
is not small.

## 2. The row of tiles

| Tile | Here | What it tells you |
|---|---|---|
| Straight-through | 50.0% (20 of 40) | The share that went out without review. Never read it alone: sending everything out scores 100% |
| Silent omissions | 0.0% (0 of 40) | Records blocked or suppressed that should not have been |
| Review precision | 100.0% (20 of 20) | Of the records sent to a person, the share that needed one. Low means reviewers are wasting their time |
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

## Across runs

- **`wfeval variance`**: the same metrics over repeated runs of identical code. The range
  between runs is how precise any single run can claim to be. It also lists the records that
  changed route between runs, and **possible key gaps**: values stated in every run that the
  answer key does not list, for a person to rule on.
- **`wfeval compare`**: what changed between two runs, and whether each change is bigger than
  the spread of identical runs ("beyond noise") or not ("within noise"). Plus every record
  whose route was fixed or broken.
- **`wfeval whatif`**: what the numbers would be at another threshold. Read the silent error
  count beside the rate: a rate can fall only because correct records joined it.

Why each number exists: [METRICS.md](METRICS.md). Every error code in full:
[SILENT_ERRORS.md](SILENT_ERRORS.md).
