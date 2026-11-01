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
            a person grades each field, the page saves a grades file
            grades file ──> grading.js ──> metrics/grades.js ──> terminal / JSON

after launch, with no full answer key:
  run + a judge's key + a person's checks ──> estimate.js ──> metrics/estimate.js   (wfeval estimate)
  periods of checked records, in order ─────> monitor.js ───> metrics/monitor.js    (wfeval monitor)
people who made the answer keys or grades:
  two or more keys or grades files ─────────> agree.js ─────> metrics/agreement.js  (wfeval agree)
```

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
- **A person's rulings, never the tool's.** `rulings.js` reads a rulings file (`--rulings`):
  a person's add, reject and pending decisions on possible key gaps. Adds join the paired
  records' answer key in memory, before judging, so every metric counts them alike; the key
  file is never written, and every report names the values added.
- **One results object, three renderings.** Terminal, JSON and HTML all draw from it, and
  share their wording (`src/report/format.js`), so the same idea has the same name everywhere.
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
  `agree-coverage.js`, `agree-flags.js`, `agree-set-distance.js` and `agree-crosscheck.js`
  (agreement; the last against an independent implementation).

## It refuses to guess

An evaluation tool that quietly miscounts is worse than none. Every way the harness itself
could compute a wrong number is listed in [`test/TRAPS.md`](../test/TRAPS.md) (200 of them),
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
- `test/fixtures/agree/`: three people's answer keys and a third reviewer's grades for the same
  records: Krippendorff's alpha for a label, an ordinal level, a set and the route, by hand.
- `examples/`: real runs of two real workflows (see each example's NOTES.md).

The tests were checked for teeth by breaking the code on purpose (swapping precision and
recall, ignoring `key_field`, weakening the "record never came out" stop) and confirming a
test fails each time.
