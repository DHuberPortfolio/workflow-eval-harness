# A second implementation, written from the docs

The harness's own tests are written by the people who wrote the code, so they can share its
misreadings. This folder is a separate implementation in Python, standard library only. It was
written only from `README.md` and `docs/`, by someone who had not read `src/`, `bin/`, `scripts/` or
the test code, and it judges the same records through to the same numbers. Then the two are
compared, value by value.

**That independence is its whole value, so keep it.** When the harness changes, change this from
what the docs now say, never from what the code does. If the docs do not settle a question, write
down the reading first and add a switch for it (`READINGS` in `oracle_core.py`), so that a choice
is never quietly copied from the code. Do not import anything from the harness; the scripts only
run `bin/wfeval.js` and read what it prints or writes.

## Run it

```
python verify/run_all.py [--base <checkout>] [--out <folder>] [--quick]
```

Python 3.11 and Node. It tests this repository unless `--base` (or `WFEVAL_ROOT`) names another
checkout, and writes to `verify/out/` unless `--out` (or `WFEVAL_VERIFY_OUT`) names another folder.
The full run takes about 10 minutes on four cores; `--quick` a few. It prints one line per step, keeps each step's
output in `logs/`, and exits 0 only when nothing is left unexplained. Any one script also runs alone
(`python verify/check_split.py`); each says how at the top.

## What is here

| File | What it does |
|---|---|
| `oracle_core.py` | Reads the files and judges each record: routes, silent errors, omissions, safeguards, quality |
| `oracle_stats.py` | Wilson, exact binomial, Clopper-Pearson, Tango, kappa, clusters, in exact fractions where it can |
| `oracle_monitor.py` | The CUSUM, its alarm level from the Markov chain, the mixture bound, the family's bars |
| `gen_scenarios.py` | A seeded set of scenarios built to hit the edges in the docs |
| `compare_runs.py`, `compare_generated.py` | Harness against oracle, field by field, on the examples, the fixtures and the scenarios |
| `harness_grades_itself.py` | The harness grades its own output against the oracle's, and the result is added up again in plain Python |
| `check_stats.py`, `check_monitor.py`, `check_monitor_files.py`, `check_segments.py`, `check_split.py`, `check_estimate.py`, `check_policies.py` | Seeded random cases for each statistic and command |
| `check_doc_numbers.py` | Numbers the docs state, recomputed with no harness at all |
| `by_cause.py` | What each settled rule decides: each is put back to its first reading in turn |
| `run_all.py`, `where.py` | The one command, and where things are |

## Five rules the docs settled

The first reading of the docs differed from what the harness does in five places. Each was settled
the same way: the harness's behaviour stands, and the docs state it. The oracle's defaults follow the
docs, so a difference on any of these now fails the run instead of being listed as a known cause.

| Switch, set to | The rule | First read as |
|---|---|---|
| `any_mismatch_ignores_key_route`, true | With `wrong_when: any_mismatch` the key's route is never read, so a record the key blocks can still need a person | false |
| `gate_skip_if_any_no_confidence`, true | With `--lenient`, a value with no confidence leaves a lead gate unknown, not failed. A weakest gate still fails on a value known to be under it | false |
| `wrong_primary_needs_gold`, true | SP-WRONG-PRIMARY needs a correct route as well as `duplicate_of_field` | false |
| `floor_checks_labels`, false | The floor reads set values only, not a label's confidence | true |
| `so_declined_on_exclude`, false | SO-DECLINED does not apply where the key's route is exclude | true |

On the examples and fixtures the first reading already agreed on every value; these showed only on
the generated scenarios, built to reach the edges. `by_cause.py` puts each rule back to its first
reading, one at a time: a rule that no longer moves the count is one those scenarios stopped reaching.

## The other differences

`run_all.py` lists these labels as explained. Any label not on its list fails the run.

- **The records a test needs** (`plan...`). The docs can be read as the first size that reaches the
  chance, or the size from which the chance never drops under again. The harness gives the second;
  the first is tallied beside it to show how far apart they are. The plan is also in the JSON when the
  target is already shown; the report does not print it.
- **Past the exact limit** (`plan... exact=False`). Over about 5,000 records the plan is an estimate,
  marked as one (`exact: false`). It comes out a little under the exact size (median about 0.9%,
  worst 6.7%).
- **Last digits** (`gate.p_value`, `held.p_value`). At 100,000 records the exact fractions and the
  harness's logarithms differ in about the ninth digit. No verdict changed.
- **Whole-number scores** (`mon.scores`). Which small whole numbers stand for the CUSUM's ratio is a
  choice with more than one fair answer; the harness's differ on a few settings.
- **A false alarm past counting** (`mon.design.false_alarm_records`). At an alarm level of 1 the
  figure passes what a double can hold, and the harness prints no number.

## Its limits

It shares any mistake in the docs: where they ask for the wrong thing, both will do the wrong thing
and agree. It was written once by one reader, and the same reader chose what to compare, so a
number nobody thought to compare is not checked. Agreement here says the code matches the docs, and
no more than that. The five rules above were settled after seeing the harness's answers, in the
harness's favour: agreement on them says the docs and the code match, not that each rule is the best
one. And the labels in `run_all.py` were set after seeing those answers too: they record the
differences, they do not settle whether the docs or the harness should give way.
