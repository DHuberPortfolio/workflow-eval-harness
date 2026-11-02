# Roadmap

Built in small, reviewed pieces. Each piece lands with its tests and, where it
computes a number, with that number worked out by hand in a fixture first.

**Design rule: the core never learns about a specific workflow.** Everything
specific to one workflow (its config, its adapter, its notes) lives in
`examples/<workflow>/`. If supporting a new workflow means changing `src/`,
the design is wrong.

## Day 1: inputs and output quality
- [x] Scaffold, zero dependencies, `node --test`
- [x] Config schema and validation (`src/config.js`, `wfeval check`)
- [x] Tiny fixture with hand-worked answers (`test/fixtures/tiny/EXPECTED.md`)
- [x] Rates with 95% Wilson intervals (`src/metrics/stats.js`)
- [x] Trap labels declared in config (`trap_field`)
- [x] Tool trap catalogue (`test/TRAPS.md`) and silent error types (`docs/SILENT_ERRORS.md`)
- [x] Strict mode (default) and `--lenient` (`src/problems.js`)
- [x] `load.js`: read JSON and n8n item exports, normalize values (traps A, B1/B7/B8, C10, D, E, F, H3/H4); `wfeval check --pred --key`
- [x] Platform-neutral input: JSON and JSON Lines; `records_at`, `unwrap`, dotted field paths,
      renamed value/confidence keys, predictions and answers in one file (`test/fixtures/shapes/`)
- [x] CSV input (spreadsheets, Zapier Tables and other exports): `A@0.95 | B` cells, configurable
      separators, `rejected_field` and label `confidence_field` (both work for JSON too)
- [x] `align.js`: match predictions to key by id, resolve route classes (traps A8, B2-B6, B9, C1-C5);
      `wfeval check` shows matched records and route counts
- [x] Second hand-worked fixture shaped like a compliance review, as CSV (`test/fixtures/compliance/`)
- [x] Precision / recall / F1 per output, per value and overall; label accuracy, per-label scores,
      confusion matrix; exact-match rate (`src/metrics/classification.js`)

## Day 2: routing
- [x] Silent error rate (headline), straight-through, silent omissions, review-queue precision,
      block precision, safeguard failures (`src/metrics/judge.js`, `routing.js`)
- [x] Silent error types and severity; `wrong_when`: either / gold_route / any_mismatch
- [x] Per-output breakdown
- [x] Per-trap breakdown and coverage check (`min_per_trap`)
- [x] `wfeval score` terminal report, `--json` results file, `--fail-on <severity>` for CI

## Day 3: across runs
- [x] Calibration: bucket per stated confidence value (fixed width optional); inherited values
      excluded; interval per bucket; per output; the config's thresholds checked (`calibration.js`)
- [x] `wfeval variance`: N runs, mean and spread per metric, records that change between runs (`test/fixtures/runs/`)
- [x] Possible key gaps in `variance`: values stated in every run that the key lacks, listed for a person (trap I7)
- [x] `wfeval compare`: metric deltas, verdict against a `--noise` baseline, the records that flipped and whether each was fixed or broken

## Day 4: what-if and publishing
- [x] `wfeval whatif --gate`: sweep each gated output's threshold. Only records marked
      `movable` (their route was decided by the confidence gate, or they went through)
      can change route; values never change, so precision/recall stay fixed. Counts beside rates.
- [x] `wfeval whatif --floor`: re-admit or evict values by the floor and recompute precision,
      recall and the gate. Records whose route depended on something the harness cannot
      recompute are reported as "needs replay", never guessed. A workflow-specific replay
      (caps, hierarchies, cue lists) can be supplied by its adapter.
- [x] Self-contained HTML report (no CDN): headline, tiles, silent errors, quality, traps, calibration chart
      with hover and keyboard tooltips, every record; light and dark; escaped input values (`--html`)
- [x] README: architecture and the reasoning behind each metric; `docs/CONFIG.md` config reference
- [x] Published to GitHub, private until the owner decides it is ready to be public

## Real-world fixtures (one per workflow, in `examples/`)
- [x] Metadata enrichment: adapter + reproduce run 49's facet and routing figures (`examples/metadata-enrichment/`)
- [x] Compliance reviewer: adapter, three live runs from n8n (executions 50-52), variance (`examples/compliance-reviewer/`)
- [x] Compliance reviewer: prompt v2 measured (runs 56-59), pass-with-notes log in n8n, answer key v2 from the key-gap review (`KEY_GAPS.md`)
- [x] Metadata enrichment: Harness Export node in n8n (compact records, `decision_branch` emitted), three fresh runs (61-63) for variance
- [x] Compliance reviewer: its own scorecard now leads with the silent error rate (a note is no longer a catch)
- [x] Golden 500: both workflows scored on 500-record golden sets (`examples/*/golden500/`): compliance 9.8% (award claims 15 of 25); metadata 27% in v1, 6.3-8.6% in three runs of v3 (worst 18 of 210), 5.4-7.6% on the held-out half
- [x] Readability: one vocabulary across reports and docs ("went out without review", "answer key", "needed a person"); every error code explained where it appears; docs/READING_A_REPORT.md, docs/METRICS.md, docs/ARCHITECTURE.md; example notes in one shape
- [x] Declining to answer as its own outcome for label outputs (`decline` in the config): coverage,
      accuracy when answered, decline rate, unnecessary declines, answers that should have been
      declines; SP-SHOULD-DECLINE, SP-DECLINED, SO-DECLINED (`test/fixtures/declines/`)
- [x] Honest ranges: `variance` quotes the worst run and never adds runs of the same records together (trap I8); golden-set rates labelled as stress-test rates, not rates for real traffic; reports say the likely range is for "records like these"
- [ ] Competitor registry: config in `examples/competitor-registry/`. Not yet scored: it has never
      been run against an answer key. Needs an adapter that turns each run into one record per
      link (the workflow writes only the links it classified) and a labelled set of homepages
- [x] Ordinal labels (bands 1-5: near misses count less than far misses), with a hand-worked
      fixture (`test/fixtures/ordinal/`). Competitor watch's own runs not scored: running it writes
      to its snapshot tables

## Free text, graded by a person
- [x] `wfeval grade`: one self-contained HTML page (offline, escaped, keyboard-usable, light and
      dark) in which a reviewer grades each field faithful / invented / missing against its
      source, with kinds and a note, and saves a grades file (`src/grading.js`, `src/report/grading-page.js`)
- [x] `wfeval score --grades`: invented and missing rates per field, per section and per form,
      with likely ranges; invented is high severity (`--fail-on high`); two reviewers' agreement
      with Cohen's kappa (`test/fixtures/freetext/`, traps J1-J14)
- [ ] Assessment template: grade its real output. Needs a set of transcripts to run it on, and
      a reviewer; nothing has been graded yet
- [ ] An HTML report for `score --grades` (terminal and JSON only for now)

## From six projects' use (Oct 30, 2026)
What the projects that used the harness had to build around it, ranked by how many needed it.
- [x] Review precision no longer counts a record the key blocks or suppresses as needing a
      person (trap G12, `test/fixtures/queue/`)
- [x] `score --target` and `wfeval rate`: whether a rate is shown under a target, the plan for
      showing it and the hard minimum; error-rate-calculator's arithmetic (trap G13)
- [x] `compare` counts what a change fixed and broke on the same records, judged with Tango's
      paired range, so no repeated runs are needed (trap I9)
- [x] Rates per group: the headline rates for each value of a field from the key or the
      predictions, each with its count and likely range (`groups`, `score --group-by`; traps
      H6-H8, `test/fixtures/queue/`)
- [x] Weighted to a real mix: groups weighted by their share of real traffic (stratified
      estimation): `score --mix <file>`; the combined ratio estimate (Cochran 1977, ch. 5-6) with
      the Wilson range over Kish's effective number of records (Kish 1965), and the weighted
      straight-through, under the headline beside the golden set's rate (traps G18-G21,
      `test/fixtures/clusters/`)
- [x] "Any of these is right" and equivalent values in the answer key: `{ "any_of": [...] }` slots
      in a set output's key, resolved per record by every metric alike; `equivalents` in the
      config, read as one value on both sides (traps D20-D23, F13, I10, `test/fixtures/alternatives/`)
- [x] A rulings file for possible key gaps (add, reject, pending), and comparing two keys:
      `--rulings` on score, variance and compare; possible key gaps from one run in `score`; the
      silent error rate with pending rulings counted wrong and as added; `compare --after-key`
      (traps I11-I17, `test/fixtures/rulings/`)
- [x] Ranges that count clusters within a run (retellings of one story, one filing's statements):
      `clusters` in the config or `score --cluster-by`; one line under the headline with the
      silent error rate's range from the design effect (Kish 1965; Miller 2024, Eq. 4), each
      cluster counted as one record when that cannot be measured (traps G14-G17,
      `test/fixtures/clusters/`)
- [x] A gate in `whatif` certified to keep silent errors under a target (Learn then Test):
      `whatif --gate --target`, each gate tested exactly (binomial) on its own records out,
      Bonferroni over the gates tried, the loosest certified gate named (trap E9,
      `test/fixtures/gate/`)
- [x] Records silent in at least one of the runs in `variance`, beside the worst run, with the
      share's likely range and always the number of runs (trap I18)
- [x] A release gate on `compare`: `--fail-if-worse <outcomes>` exits 3 when a named paired
      outcome is judged worse; never on "unclear"; an outcome the run does not measure stops
      (trap I19)

## After launch, and the people behind the key (Oct 31, 2026)
The four items the six-project review left for later. Each method was chosen by a seeded
simulation in `scripts/` against the published alternatives, and each feature had an
independent review before it was merged.
- [x] Routing policies in `whatif`: hold-if rules (always send these records to a person; exact,
      with no assumption), each record's own threshold read from a field, named policies side by
      side with paired counts, certified with `--target` (traps E10-E19, `test/fixtures/policy/`;
      reproduces the compliance reviewer's what-if table)
- [x] A judge's answer key checked by a person: `wfeval estimate`, the silent error rate from an
      AI judge's key for every record and a person's checks of a sample, post-stratified by the
      judge's verdict with a MOVER range; `--pick` chooses which records to check (traps K1-K13,
      `test/fixtures/estimate/`)
- [x] Live samples over time: `wfeval monitor`, a CUSUM alarm for a rise (alarm level from an
      exact Markov chain) and a bound under the target that stays valid however often you look
      (a mixture confidence sequence); `--fail-on-alarm` (traps L1-L14, `test/fixtures/monitor/`)
- [x] Agreement among any number of graders: `wfeval agree`, Krippendorff's alpha for labels,
      levels, sets and routes, or free-text grades, with a bootstrap range (traps M1-M17,
      `test/fixtures/agree/`)

## Answer-key suspects, a held-out half, and what nobody sees (Nov 1, 2026)
- [x] Answer-key suspects: `wfeval suspects`, the key entries one or more runs disagree with (values
      the key may be missing, values it may list wrongly, labels), ranked by the odds the key is
      wrong from leave-one-out evidence on the key's other records, chosen by a seeded comparison
      with today's order, confidence, confident learning and self-consistency; rulings gain remove,
      keep and replace, and `--write-rulings` starts the file (traps N1-N19, `test/fixtures/suspects/`)
- [x] A tuning half and a held-out half: `split` in the config holds a share of the golden set out
      by a SHA-256 hash of each record's unit (retellings kept together; CRC-32 only to reproduce a
      hand split), reports the tuning half, looks at the held-out half only when asked
      (`--held-out`) and then as rates only, has `whatif` choose on the tuning half and check once
      on the held-out half, and counts each look in `split.log`, per record, each getting half of
      what the looks before it left of the 5% (proven for analysts who choose without the held-out
      numbers; chosen by `scripts/split-sim.js` against budgets and 1/k^2 spending under
      hill-climbing, boosting and group-testing attacks); no claim without a log; fresh records get
      a claim of their own; warnings count held-out records by where their ids were written;
      `compare --after-key` keeps the two keys' halves apart; `suspects` joined to the split
      (O21-O24: held-out records left out as suspects and as evidence, `--show-held-out` a look
      that records which records it listed) (traps O1-O26, `test/fixtures/split/`)
- [x] `monitor` watches what nobody sees, and each segment: `--watch silent-omissions` for the
      share of the blocked or suppressed records wrongly left out; `--segment-by` (with
      `--segments` to name them in advance) for one alarm and one bound per channel or customer,
      the alarms sharing `--false-alarm-every` and the whole and the segments shown under the target
      as one family by a weighted closed test on their evidence (Vovk & Wang 2021), chosen by a
      seeded simulation (`scripts/monitor-segments-sim.js`; traps L19-L37,
      `test/fixtures/monitor-segments/`)

## Out of scope for now
- Snapshot backdating fixture: a test utility with nothing to score.

## Later
- Golden-set trap design for each workflow (2-3+ records per trap type, plus records combining traps)

## Settled
- Free text is graded faithful / invented / missing, one grade per field; "figure altered" and
  "contradiction smoothed over" are kinds of invented, not grades, so grades stay exclusive and
  agreement measurable. A person grades; the harness never calls a model.
- Declining is an outcome of a label output, not a route class: a route says who sees a record,
  and a workflow can send declines anywhere. Wrong category out unseen: SP-WRONG, high. Answer
  where the key says decline: SP-SHOULD-DECLINE, high. Unnecessary decline: medium (SO-DECLINED
  when left out, SP-DECLINED when it goes out). Sets do not decline: an empty set is already an answer.
- Route classes: auto (goes through, unseen), review (a person decides), block (never
  processed, unseen), exclude (duplicate suppressed, unseen). Silent omission = key says auto
  or review, workflow said block or exclude.
- Only routes decided purely by the confidence gate are movable in a gate what-if.
