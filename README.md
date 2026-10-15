# workflow-eval-harness

[![tests](https://github.com/DHuberPortfolio/workflow-eval-harness/actions/workflows/test.yml/badge.svg)](https://github.com/DHuberPortfolio/workflow-eval-harness/actions/workflows/test.yml)

Measures an AI workflow against a golden set (test records with an answer key), with one
number in front: the **silent error rate**. Of the records the workflow sent out without
anyone reviewing them, the share that needed a person. Those are the only mistakes that
reach the outside world unseen; every other mistake was caught by a person or a guard.

## What it found in two real workflows

Both are AI workflows built in n8n. Each was scored first on a small golden set, then on a
500-record golden set built to cover its traps. The harness reads their exports through a
config, the same way it reads a Zapier export, a script's log, an API response or a spreadsheet.

None of these golden sets is a random sample of real traffic: each record was written to test
something, and the 500-record sets hold far more hard cases than real traffic would. So every
rate below is a **stress-test rate**: how the workflow does on records chosen to trip it, the
right yardstick for comparing versions on the same set, but not the rate its real traffic would
see. That takes a random sample of real traffic with its own answer key, or each kind of record
weighted by its real share (stratified estimation; Cochran 1977, ch. 5).

**A compliance reviewer for law-firm advertising.** A regex layer catches banned words; an
LLM catches implied violations, and holds the copy for a person only when its confidence
clears the client's threshold. Below the threshold, the finding becomes a note and the copy
goes out without review. The workflow's own scorecard counted a note as a catch, and
reported a 100% catch rate.

On its first 40 documents, the harness counted what went out without review: 20, and
**6 of them (30%) needed a person**. In every one, the model had found the violation and then
stated its confidence below the threshold. So the fix belonged in the model, not the
threshold: a prompt that anchors what each confidence level means brought it to 6.7% in four
runs out of four, a drop well beyond the old prompt's run-to-run noise. The workflow's
scorecard now reports the silent error rate too.

On a 500-document stress test (243 violations; 257 clean, 112 of them built to look like
violations) the silent error rate is **9.8%** (25 of 256; likely 6.7-14.0%), with 89.7% of
violations reaching a person. The larger set shows where the rest is: 15 of the 25 silent errors are award claims
("Named to Super Lawyers"), which the model rates 0.75 almost every time, under every client's
threshold; and 23 of the 26 clean documents sent to a person anyway were flagged by regex
rules that cannot read context (a fee counted as a result, "We cannot guarantee" read as a
guarantee). ([notes](examples/compliance-reviewer/NOTES.md))

The same runs showed the answer key was incomplete: the new prompt named real violations the
answer key had never listed. The harness lists every value a model states in every run that
the answer key lacks, for a person to rule on (the same mistake can repeat every run too).
([review](examples/compliance-reviewer/KEY_GAPS.md))

**A news-metadata tagger** (controlled-vocabulary codes on four facets). On 24 articles,
three runs sent 7, 8 and 8 articles out without review, none with an error. They were the same
8 articles each time, and no errors in 8 still allows a true rate up to 32%: the small set
could never have shown the tagger was good enough. On the 500-article stress test, the same
pipeline's rate was **27%**.

Two prompt fixes and a new guard (a tag the model proposed but set aside goes to an editor)
brought it to **6.3% to 8.6% in three runs of identical code**, a drop beyond run-to-run noise.
The worst run is the one to quote: 8.6% (18 of 210, likely 5.5-13.1%). The runs are not added
together: they send out the same articles again (their 615 records out are 254 articles), and
an article's runs tend to go the same way, so an added-up 44 of 615 would claim a narrower
range than the evidence holds (the design effect; Kish 1965). On the half of the articles the
guard's threshold was not tuned on, the runs gave 5.4% to 7.6% (worst: 8 of 105, likely
3.9-14.3%). The price: about 41% of articles now go out without review, down from 47%, and
more than half of the reviews are ones an editor did not need.
([notes](examples/metadata-enrichment/NOTES.md))

![The HTML report for the compliance reviewer before its prompt fix: silent error rate 30.0%, six silent errors listed](docs/samples/compliance-before.png)

Open the full reports, each one self-contained HTML file: the compliance reviewer
[before](https://dhuberportfolio.github.io/workflow-eval-harness/samples/compliance-before.html) and
[after](https://dhuberportfolio.github.io/workflow-eval-harness/samples/compliance-after.html) its prompt fix on 40 documents,
and both workflows on their 500-record stress tests:
[compliance reviewer](https://dhuberportfolio.github.io/workflow-eval-harness/samples/compliance-golden500.html),
[metadata tagger](https://dhuberportfolio.github.io/workflow-eval-harness/samples/metadata-golden500.html).

## Why a harness, if you already have a golden set?

The golden set is the exam and its answer key; the harness is the grader. A golden set says
nothing until something marks it, and the marking is where the two workflows above went wrong.

1. **The workflow graded its own exam.** The compliance reviewer had a golden set and its own
   scorecard, which reported a 100% catch rate because it counted "went out with a note" as
   caught. The harness counted what actually happened: 30% of the copy that went out unseen
   needed a person.
2. **It counts the mistakes that matter.** In the metadata tagger's first 500-article run, 99%
   of the tags it applied were correct, yet 27% of the articles it published without review
   had an error. An average hides that; the silent error rate does not.
3. **It says how far to trust a number.** No errors in the 8 articles the tagger sent out
   looked perfect; it still allowed a rate up to 32%, and on the 500-article stress test the
   rate was 27%. Three identical runs gave 6.3%, 6.5% and 8.6%: `variance` says to quote the
   worst, and why the three are not added up. Likely ranges and repeated runs tell a real
   improvement from luck, and `compare` says whether a change is beyond noise.
4. **It says why, not just how often.** The model had found the violations and understated its
   confidence, so the fix was the prompt, not the threshold. 15 of 25 misses were award claims.
   Regex rules, not the AI, caused most unnecessary reviews. A pass/fail count points at none
   of that.
5. **It answers "what if" for free.** Capping thresholds at 0.85 and sending award claims to a
   person: 1.3% on the same 500 documents, computed from the recorded answers without running
   the workflow again.
6. **It checks the answer key too.** It surfaced 9 real violations the compliance answer key
   had missed, and it stops rather than count anything it cannot read correctly.
7. **One yardstick for every workflow.** Each workflow's home-made scorecard measures in its own
   way. The harness measures n8n, Zapier or custom-code workflows identically, on every change,
   and `--fail-on` can stop a build that lets a serious error through.

If a workflow never decides what goes out unseen, rarely changes, and all you need is how many
it got right, a spreadsheet is enough. The harness earns its keep when a workflow decides what
goes out without review, keeps changing, and has to be trusted.

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
  The likely range is where the true rate on records like these probably sits (95%). With 2 records out without review, each one moves the silent error rate by 50.0 points.

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
| `wfeval variance` | How much do the numbers move between runs of identical code? Mean, spread and range per metric; the worst run's silent error rate, the one to quote (runs are never added together); the records that behave differently run to run; and possible key gaps: values stated in every run that the answer key does not list, for a person to rule on. |
| `wfeval compare` | Did a change help, or did it move within that noise? Every metric's change against the spread of repeated runs, and every record that was fixed or broken. |
| `wfeval whatif` | What would the numbers be at another threshold? Sweeps the confidence gate or the confidence floor. |
| `wfeval check` | Is this config, and this pair of files, readable? Prints what it understood. |
| `wfeval grade` | For free text: writes one HTML page in which a person grades each field against its source. |
| `wfeval score --grades` | How often does the free text say something the source never said? Invented and missing rates from a person's grades, and two reviewers' agreement. |

**Free text is graded by a person, not a model.** A form filled from a transcript has no answer
key; its failure is a field that reads plausibly and says something nobody said. `wfeval grade`
writes one self-contained page (it works offline, from the file) that shows each field beside
its source. The reviewer marks each field faithful, invented or missing and saves the grades;
`score --grades` turns them into invented and missing rates per field, per section and per
form, with likely ranges, and with a second reviewer, how far the two agree (Cohen's kappa):

```
node bin/wfeval.js grade --config test/fixtures/freetext/grading.json \
  --pred test/fixtures/freetext/forms.json --out grading.html
node bin/wfeval.js score --grades test/fixtures/freetext/grades-a.json \
  --second-reviewer test/fixtures/freetext/grades-b.json
```

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

- Scores sets of values, single labels (which may decline to answer: a decline is its own
  outcome, never a wrong label) and ordered labels. Free text is scored only through a
  person's grades: the harness never judges text itself.
- The floor what-if does not re-add broader terms or re-apply per-output caps; records
  whose route could depend on those are marked "needs replay" rather than guessed.
- Every rate is only as strong as the golden set is large. The likely ranges say how strong
  that is.
- A likely range covers chance only. It does not make a golden set like real traffic: a set
  built from traps gives a stress-test rate, and the rate on real traffic needs a random sample
  of it. Nor does it hold for repeated runs of the same records added together, which is why
  `variance` quotes the worst run instead.

## Docs

| | |
|---|---|
| [How to read a report](docs/READING_A_REPORT.md) | The words used, and every number in a report, top to bottom |
| [The metrics](docs/METRICS.md) | What each number measures, and why it exists |
| [Silent errors](docs/SILENT_ERRORS.md) | Every error type, how it is detected, and its severity |
| [Config](docs/CONFIG.md) | Every config option |
| [How it is built](docs/ARCHITECTURE.md) | Architecture, the refuse-to-guess rules, testing |

MIT licence.
