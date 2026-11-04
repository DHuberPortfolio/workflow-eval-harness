# How it is built

```
config.json ──> config.js ──┐
                            ▼
predictions ──> load.js ──> align.js ──> judge.js ──> routing.js ─────┐
answer key  ──>  (csv.js)   (pairs by id)  (one judgment   classification.js │──> results ──> terminal / JSON / HTML
                                            per record)    traps.js          │
                                                           groups.js         │
                                                           clusters.js       │
                                                           mix.js            │
                                                           calibration.js ───┘
                                           variance · compare · whatif reuse the same judgments
                                           (whatif --policies: policy.js reads the rules, metrics/policy.js replays them)

free text:  grading config + forms ──> grading.js ──> grading-page.js ──> one HTML page
            a reviewer grades each field, the page saves a grades file
            grades file ──> grading.js ──> metrics/grades.js ──> terminal / JSON

after launch, with no full answer key:
  run + a judge's key + a person's checks ──> estimate.js ──> metrics/estimate.js   (wfeval estimate)
  periods of checked records, in order ─────> monitor.js ───> metrics/monitor.js    (wfeval monitor)
people who made the answer keys or grades:
  two or more keys or grades files ─────────> agree.js ─────> metrics/agreement.js  (wfeval agree)
the answer key's own mistakes:
  one key, one or more runs (+ rulings) ────> suspects.js ──> metrics/suspects.js   (wfeval suspects)
```

- **Text at the edges.** `text.js` reads every input file, stopping on a file that is not UTF-8, and
  makes results safe for a terminal. Every report reaches the terminal through `report()` in
  `bin/wfeval.js`, so no renderer has to think about control characters, and a test holds it to that.
- **Messy input is handled in one place.** `load.js` (and `csv.js` for spreadsheets) is
  the only code that reads predictions and answer keys. After it, every id is trimmed text, every confidence
  is a number or null, every `applied` a real true or false. Nothing downstream re-checks.
- **Pairs, never totals.** `align.js` pairs each prediction with its answer by id.
  Totals can match while records do not: two misroutes in opposite directions cancel out.
- **One judgment per record.** `judge.js` decides, once, whether each record needed a
  person, which error types apply and which safeguards failed. Every number, the per-trap
  and per-group tables and the what-ifs are counts over these judgments, so they cannot disagree.
- **Metrics are pure functions.** Records in, numbers out; no files, no printing. That
  is what makes them testable with a few lines of data.
- **A reviewer's rulings, never the tool's.** `rulings.js` reads a rulings file (`--rulings`):
  a reviewer's add, reject and pending decisions on possible key gaps. A reviewer is a person or an
  AI judge. The harness calls no model: `judges.js` writes questions and reads answers, whatever
  ran the judges is outside it (`.claude/skills/wfeval`), and every report counts an AI judge's
  rulings apart and gives the rate without them. Adds join the paired
  records' answer key in memory, before judging, so every metric counts them alike; the key
  file is never written, and every report names the values added.
- **One results object, three renderings.** Terminal, JSON and HTML all draw from it, and
  share their wording (`src/report/format.js`), so the same idea has the same name everywhere.
- **A held-out half kept honest.** With `split` in the config, `split.js` puts each record in the
  tuning or the held-out half by a hash of its unit (its cluster, a duplicate's primary, or its id),
  so the halves never depend on the other records. `score`, `compare` and `variance` judge each half
  on its own records only (`scoreHalf`), report the tuning half in full, and only when asked
  (`--held-out`) the held-out half as rates only (what would name its records is kept off the
  results' enumerable fields, so no renderer and no `--json` can print it); `split-whatif.js` checks
  on the held-out half the gate or policy chosen on the tuning half; `split-log.js` counts each look
  in `split.log`, per record, and gives each claim its share of the 5%. Problems mark the record ids
  they write (`problems.js` `markId`), so `split.js` takes held-out ids out of warnings and stops by
  where they were written, never by searching the text. `suspects.js` reads the same halves from
  `score.js` and leaves the held-out records out, as suspects and as evidence, unless
  `--show-held-out` lists them (a look the log records, with the records it listed).
- **The core knows no workflow.** Anything specific to one workflow lives in
  `examples/<workflow>/`: its config and, when its export needs restructuring rather
  than locating, a small adapter.
- **Methods chosen by evidence, kept re-runnable.** Where several published methods could give
  a range or an alarm, a seeded simulation in `scripts/` compared them. The one used is the one
  that came closest to its promise (a 95% range should hold the truth 95% of the time; an alarm
  should go off no more often by mistake than asked for), and then the narrowest or quickest.
  Where no method can keep the promise (agreement measured on a few rare values), the report
  says the range is probably too narrow. Each script prints the tables quoted in
  [METRICS.md](METRICS.md), the same every run: `estimate-simulation.js` and
  `estimate-designs.js` (a judge's key checked by a person), `monitor-sim.js` (live samples),
  `monitor-segments-sim.js` (live samples of what nobody sees, and of each segment),
  `agree-coverage.js`, `agree-flags.js`, `agree-set-distance.js` and `agree-crosscheck.js`
  (agreement; the last against an independent implementation), `split-sim.js` (a held-out half:
  the hash, the balance warning and the rule for counting looks). `suspects-eval.js` ranks answer-key
  suspects every way compared, on a person's real rulings and on errors put into the real keys;
  none won everywhere. The one used is never more than 0.05 below the best on injected errors (the
  three mixes of error kinds); on the real rulings, no ranking does better than chance.

## It refuses to guess

An evaluation tool that quietly miscounts is worse than none. Every way the harness itself
could compute a wrong number is listed in [`test/TRAPS.md`](../test/TRAPS.md) (310 of them),
with what the tool does about each:

- **Stop**, and name every offending record: a record in the answer key that never came out
  of the workflow; `"applied": "false"` as text (in JavaScript, the text "false" counts as
  true); a confidence of `85` or `"0.9"`; a route name with the wrong case; a CSV with a
  decimal comma.
- **Fix, and report it**: stray spaces, the invisible marker Windows puts at the start of files.
- **Rules** the arithmetic must follow: 0 of 0 is "nothing to measure", not 0%; F1 from
  counts, never from rounded percentages; 0.7 goes in the 0.7-0.8 bucket even though
  0.7 / 0.1 is 6.9999… in binary.

**Strict mode** (the default, for golden sets) stops on anything suspicious, because there
it is a bug to find. `--lenient` (for samples of production output) turns those into
warnings. A record that went in and never came out stops the run in both modes.

## Testing

`npm test` runs the suite with Node's built-in runner. On every push, GitHub Actions runs it
on Linux and Windows with Node 18, 22 and 24, runs the commands the README and the example
notes show, checks that `--fail-on high` stops a build with a high-severity silent error,
and rebuilds the sample reports (`npm run samples`), failing if they differ from the
committed copies.

The metric tests are checked against answers worked out by hand before the code existed:

- `test/fixtures/tiny/`: six tagged records, each built to test one case. `EXPECTED.md`
  shows every number's working.
- `test/fixtures/compliance/`: nine documents from a compliance reviewer, as spreadsheets,
  with a verdict label that is also the route.
- `test/fixtures/runs/`: three runs of the same workflow, for variance and compare.
- `test/fixtures/gate/`: sixty articles at ten confidence levels, for the certified gate: each
  gate's binomial p-value and the Bonferroni bar, worked out by hand.
- `test/fixtures/freetext/`: three synthetic visit transcripts, the forms filled from them,
  and two reviewers' grades: invented and missing rates, and their agreement (kappa).
- `test/fixtures/declines/`: ten links classified into page categories or declined, shaped
  like a competitor registry: coverage, accuracy when answered, and both kinds of decline mistake.
- `test/fixtures/alternatives/`: six answers citing podcast episodes, where any one of several
  episodes is right (`any_of` slots) and one episode has two ids (`equivalents`): how slots
  count, and how the floor what-if fills them again at every floor.
- `test/fixtures/shapes/`: the same six records in six file shapes, which must all load identically.
- `test/fixtures/policy/`: eight records, each with its own threshold, for routing policies:
  which records each hold-if rule and threshold change moves, worked out by hand.
- `test/fixtures/estimate/`: a run with 20 records out without review, an AI judge's answer key
  for every record and a person's for ten: the estimate, its range piece by piece, and which
  records to check.
- `test/fixtures/monitor/`: seven weeks of checked records as counts, and three small weeks as
  run files: the CUSUM week by week, when it alarms, and the bound that holds however often you
  look.
- `test/fixtures/monitor-segments/`: the same, split by channel, with records blocked and
  suppressed: a rise in one channel the whole hides, the whole's bound and each channel's counted
  as one family, and the share of the records left out that were left out wrongly.
- `test/fixtures/agree/`: three people's answer keys and a third reviewer's grades for the same
  records: Krippendorff's alpha for a label, an ordinal level, a set and the route, by hand.
- `test/fixtures/suspects/`: thirteen support tickets with tags and a category, two runs and two
  rulings files: every answer-key suspect's weight in exact fractions, the rulings that close each
  one, and the bracket with pending removes and replaces; with a split (`config-split.json`), the
  weights again with the held-out records left out.
- `test/fixtures/split/`: twenty-four records split into a tuning and a held-out half, with versions
  and answer keys for every look: which half each record is in (SHA-256 places, checked with
  Python's hashlib), what each report shows of each half, and what each look may claim; with the
  gate fixture, a gate and a policy chosen on the tuning half and checked on the held-out half.
- `examples/`: real runs of two real workflows (see each example's NOTES.md).

The tests were checked for teeth by breaking the code on purpose (swapping precision and
recall, ignoring `key_field`, weakening the "record never came out" stop) and confirming a
test fails each time; `scripts/mutate.js` does that at scale. `test/metamorphic.test.js` holds
properties that need no worked answer (shuffle the records and every rate stays), and `verify/`
is a second implementation in Python, written only from the docs.
[ENGINEERING.md](ENGINEERING.md) says what each check can and cannot show, and how to run it.
