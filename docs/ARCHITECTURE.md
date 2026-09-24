# How it is built

```
config.json ──> config.js ──┐
                            ▼
predictions ──> load.js ──> align.js ──> judge.js ──> routing.js ─────┐
answer key  ──>  (csv.js)   (pairs by id)  (one judgment   classification.js │──> results ──> terminal / JSON / HTML
                                            per record)    traps.js          │
                                                           calibration.js ───┘
                                           variance · compare · whatif reuse the same judgments
```

- **Messy input is handled in one place.** `load.js` (and `csv.js` for spreadsheets) is
  the only code that reads files. After it, every id is trimmed text, every confidence
  is a number or null, every `applied` a real true or false. Nothing downstream re-checks.
- **Pairs, never totals.** `align.js` pairs each prediction with its answer by id.
  Totals can match while records do not: two misroutes in opposite directions cancel out.
- **One judgment per record.** `judge.js` decides, once, whether each record needed a
  person, which error types apply and which safeguards failed. Every number, the per-trap
  table and the what-ifs are counts over these judgments, so they cannot disagree.
- **Metrics are pure functions.** Records in, numbers out; no files, no printing. That
  is what makes them testable with a few lines of data.
- **One results object, three renderings.** Terminal, JSON and HTML all draw from it, and
  share their wording (`src/report/format.js`), so the same idea has the same name everywhere.
- **The core knows no workflow.** Anything specific to one workflow lives in
  `examples/<workflow>/`: its config and, when its export needs restructuring rather
  than locating, a small adapter.

## It refuses to guess

An evaluation tool that quietly miscounts is worse than none. Every way the harness itself
could compute a wrong number is listed in [`test/TRAPS.md`](../test/TRAPS.md) (80+ of them),
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
- `test/fixtures/shapes/`: the same six records in six file shapes, which must all load identically.
- `examples/`: real runs of two real workflows (see each example's NOTES.md).

The tests were checked for teeth by breaking the code on purpose (swapping precision and
recall, ignoring `key_field`, weakening the "record never came out" stop) and confirming a
test fails each time.
