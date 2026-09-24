# workflow-eval-harness

[![tests](https://github.com/DHuberPortfolio/workflow-eval-harness/actions/workflows/test.yml/badge.svg)](https://github.com/DHuberPortfolio/workflow-eval-harness/actions/workflows/test.yml)

Measures an AI workflow against a golden set (test records with an answer key), with one
number in front: the **silent error rate**. Of the records the workflow sent out without
anyone reviewing them, the share that needed a person. Those are the only mistakes that
reach the outside world unseen; every other mistake was caught by a person or a guard.

## What it found in two real workflows

Both are AI workflows built in n8n, each scored on its current golden set. The harness
reads their exports through a config, the same way it reads a Zapier export, a script's log,
an API response or a spreadsheet.

**A compliance reviewer for law-firm advertising** (40 documents). A regex layer catches
banned words; an LLM catches implied violations, and holds the copy for a person only when
its confidence clears the client's threshold. Below the threshold, the finding becomes a
note and the copy goes out without review. The workflow's own scorecard counted a note as a
catch, and reported a 100% catch rate.

The harness counted what went out without review: 20 of the 40 documents, and **6 of them
(30%) needed a person**; 22-30% across three runs of identical code. In every one, the model had found
the violation and then stated its confidence below the threshold (0.55-0.85 against
0.80-0.90). So the fix belonged in the model, not the threshold. A prompt change that anchors
what each confidence level means brought it to **6.7% in all four runs**, a drop well beyond
the old prompt's run-to-run noise: 5 routes fixed, none broken, no new false alarms on clean
copy. The workflow's scorecard now reports the silent error rate too.
([notes](examples/compliance-reviewer/NOTES.md))

The same runs showed the answer key was incomplete. The new prompt named real violations
the answer key had never listed, so it looked 10-20 points less precise than it was. The
harness lists every value a model states in every run that the answer key lacks, for a
person to rule on (the same mistake can repeat every run too); 9 of the 25 went into the
answer key. ([review](examples/compliance-reviewer/KEY_GAPS.md))

**A news-metadata tagger** (24 articles, controlled-vocabulary codes on four facets). The
harness reproduces the workflow's own scorecard figure for figure. Three fresh runs found 0
silent errors in the 23 articles that went out without review, and the harness says what
that is worth: a true rate up to 14% is still consistent with it, where one run's "0 of 7"
allows up to 35%. ([notes](examples/metadata-enrichment/NOTES.md))

![The HTML report for the compliance reviewer before its prompt fix: silent error rate 30.0%, six silent errors listed](docs/samples/compliance-before.png)

Open the full reports, each one self-contained HTML file: the compliance reviewer
[before](https://dhuberportfolio.github.io/workflow-eval-harness/samples/compliance-before.html) and
[after](https://dhuberportfolio.github.io/workflow-eval-harness/samples/compliance-after.html) its prompt fix.

## Try it

Node 18.3 or later. No dependencies, no network, no API key.

```
node bin/wfeval.js score --config test/fixtures/tiny/config.json \
  --pred test/fixtures/tiny/predictions.json --key test/fixtures/tiny/key.json
```

```
HEADLINE
                         rate         count   likely range   what it counts
  Silent error rate     50.0%        1 of 2   9.5-90.5%      went out without review, but needed a person
  Straight-through      33.3%        2 of 6   9.7-70.0%      went out without review
  Silent omissions       0.0%        0 of 4   0.0-49.0%      blocked or suppressed, but should have gone out or to a person
  Review precision      50.0%        1 of 2   9.5-90.5%      sent to a person, and needed one
  Block precision      100.0%        1 of 1   20.7-100.0%    blocked, and the answer key agrees
  Safeguard failures            0 record(s)                  went out past the workflow's own confidence gate or floor
  The likely range is where the true rate probably sits (95%). With 2 records out without review, each one moves the silent error rate by 50.0 points.

SILENT ERRORS  1 record(s)  (high 1): went out without review, but needed a person
  R2      high      SP-WRONG, SP-SHOULD-REVIEW   [plausible-extra-tag]
          went: AUTO_PUBLISH   answer key: EDITOR_REVIEW
          SUBJECT  applied, not in the answer key: SUBJ-ANTI
  what the types mean
    SP-WRONG           a wrong value went out
    SP-SHOULD-REVIEW   went out, but should have gone to a person
```

Add `--html report.html` for the report shown above, or `--json results.json` for the same
numbers as data. [How to read a report](docs/READING_A_REPORT.md) walks through one, number
by number.

## What it does

| Command | Question it answers |
|---|---|
| `wfeval score` | How did this run do? Silent errors by type and severity, routing, output quality, per-trap results, calibration. `--fail-on critical` exits non-zero, to stop a build. |
| `wfeval variance` | How much do the numbers move between runs of identical code? Mean, spread and range per metric, the records that behave differently run to run, and possible key gaps: values stated in every run that the answer key does not list, for a person to rule on. |
| `wfeval compare` | Did a change help, or did it move within that noise? Every metric's change against the spread of repeated runs, and every record that was fixed or broken. |
| `wfeval whatif` | What would the numbers be at another threshold? Sweeps the confidence gate or the confidence floor. |
| `wfeval check` | Is this config, and this pair of files, readable? Prints what it understood. |

It is not tied to any platform. The config says where the records are and what their
fields are called: an n8n export, a Zapier export, a script's JSON Lines log, an API
response, a spreadsheet.

## Using it on your own workflow

1. Export one run of the workflow on its golden set, with the answer key (in the same file or
   a separate one).
2. Write a config saying where the records and their fields are, and which of the
   workflow's decisions mean "went out without review", "sent to a person", "blocked" and
   "suppressed as a duplicate". A minimal one:

   ```json
   {
     "outputs": { "tags": { "type": "set" } },
     "routing": {
       "field": "decision",
       "gold_field": "expected_decision",
       "map": { "AUTO_PUBLISH": "auto", "REVIEW": "review" }
     },
     "thresholds": { "floor": 0.6, "auto_publish": { "tags": 0.85 } }
   }
   ```
3. `wfeval check` until it reads everything the way you mean, then `wfeval score`.

Every config option: [docs/CONFIG.md](docs/CONFIG.md). The two real workflows in
[`examples/`](examples) show complete configs.

## Built not to miscount

An evaluation tool that quietly miscounts is worse than none. Every way the harness itself
could compute a wrong number is listed in [`test/TRAPS.md`](test/TRAPS.md) (80+ of them),
with what it does about each: stop and name the offending record, fix and report it, or
follow a stated rule. On a golden set it stops on anything suspicious; `--lenient` turns
those stops into warnings for samples of production output.

170+ tests check the numbers against answers worked out by hand before the code existed.
GitHub Actions runs them on Linux and Windows with Node 18, 22 and 24 on every push, along
with the commands this README shows, and checks that the sample reports match what the tool
produces today. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Limits

- Scores sets of values, single labels and ordered labels. Free text is not supported:
  it needs a reviewer to grade each field first, and the grades can then be scored as labels.
- The floor what-if does not re-add broader terms or re-apply per-output caps; records
  whose route could depend on those are marked "needs replay" rather than guessed.
- Every rate is only as strong as the golden set is large. The likely ranges say how strong
  that is.

## Docs

| | |
|---|---|
| [How to read a report](docs/READING_A_REPORT.md) | The words used, and every number in a report, top to bottom |
| [The metrics](docs/METRICS.md) | What each number measures, and why it exists |
| [Silent errors](docs/SILENT_ERRORS.md) | Every error type, how it is detected, and its severity |
| [Config](docs/CONFIG.md) | Every config option |
| [How it is built](docs/ARCHITECTURE.md) | Architecture, the refuse-to-guess rules, testing |

MIT licence.
