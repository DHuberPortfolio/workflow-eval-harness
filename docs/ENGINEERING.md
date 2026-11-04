# How this tool is checked

The harness grades other people's work, so the fair question is who grades the harness.

## Why passing tests are not proof

A passing test shows the code does what the test says. It cannot show the test is right. Tests
written by the person who wrote the code share that person's misreadings, and a self-check that
uses the tool's own arithmetic repeats the tool's own mistakes: if the harness grades itself and
says 100%, that may only mean it agrees with itself. Think of a student marking their own exam with
their own answer sheet.

So each check below comes at the code from a different side, and each has a limit of its own. None
is proof. Together they make a mistake hard to keep hidden.

## What we check, and how to run it

| Check | The question it answers | Its limit | How to run it |
|---|---|---|---|
| Worked answers | Is each number the one worked out by hand before the code existed? | Only the cases someone thought of | `npm test` (test/fixtures/, `EXPECTED.md`) |
| Traps | Does each way a number could go quietly wrong stop, get fixed or follow a rule? | Only the traps listed | `npm test` ([test/TRAPS.md](../test/TRAPS.md)) |
| Properties | Does a rule hold whatever the right answer is? Shuffle the records and every rate stays; fix a value and the silent errors cannot rise | Says something is wrong, not what the answer is | `npm test` (test/metamorphic.test.js); `META_SEED=3` tries another generated set |
| Sample reports | Did a change move anything in a real report? | Only those reports | `npm run samples`, then `git diff docs/samples` |
| Mutation | When the code is wrong on purpose, does a test notice? | A sample of small changes; a survivor needs a person to judge it | `node scripts/mutate.js --count 400` (about 95 minutes) |
| A second implementation | Does someone who only read the docs get the same numbers? | It shares any mistake in the docs | `python verify/run_all.py` (about 10 minutes, [verify/README.md](../verify/README.md)) |
| Two versions side by side | What did a change really change, on every example and command? | Says what moved, not whether it should have | `node scripts/compare-versions.js <old dir> <new dir>` |
| Speed and memory | Is it fast enough, and did a change help? | One machine, a few sizes | `node scripts/bench.js [<code dir>]` |
| Simulations | Does a method keep its promise (a 95% range holds the truth 95% of the time)? | Only on the kinds of data simulated | The scripts in [METRICS.md](METRICS.md), each seeded |

Golden sets are built from traps, so their rates are stress-test rates, not production rates. Even
a clean run of everything above says the tool matches its docs and its tests; it cannot say the
docs ask for the right thing. That judgment stays with a person.

## How to read a mutation survivor

A change that survives is one of three things. It may be equivalent: nothing observable can change
(a limit nothing reaches, a sign that stays a sign). It may be a real gap: write a test that fails
with the change. Or it may be real but not worth a test: wording no reader could be misled by. Don't
add a test that only pins a sentence, because that test then has to change with every rewording.
`test/no-nan.test.js` covers most report text at once: a slip in how a line is put together prints
NaN or undefined, and that one check holds every report to it without fixing a word of the wording.

## Rules going forward

- **No dependencies without a strong reason.** The tool, its tests and its checks run on Node's and
  Python's standard libraries. A package is one more thing that can change under the numbers.
- **A failing test first.** A fix without a test that failed on the old code has shown nothing.
  Apply the mistake to a throwaway copy and watch the test fail.
- **Measure before optimizing.** Run `scripts/bench.js` on both versions. Reject a speed change of
  under about 5% unless it also makes the code clearer.
- **Every new stop is tested against a legitimate run too.** A check that stops a bad file must be
  shown to let a good one through; a stop that fires on honest work teaches people to work around it.
- **Never a passing gate on nothing evaluated.** A run where nothing was measured fails its gate
  and says why. No news is not good news.
- **Figures only from commands.** No number goes in a doc, a README or a commit message unless a
  command produced it. Quote the worst of several runs, never the runs added together.
- **Methods chosen by evidence.** Where several published methods could give a range or an alarm, a
  seeded simulation compares them, the one kept is the one closest to its promise, and the script
  stays in the repository so the choice can be rerun.
