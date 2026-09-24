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
- [x] Readability: one vocabulary across reports and docs ("went out without review", "answer key", "needed a person"); every error code explained where it appears; docs/READING_A_REPORT.md, docs/METRICS.md, docs/ARCHITECTURE.md; example notes in one shape
- [ ] Competitor registry: needs "declined to classify" handled as its own outcome
- [x] Ordinal labels (bands 1-5: near misses count less than far misses), with a hand-worked
      fixture (`test/fixtures/ordinal/`). Competitor watch's own runs not scored: running it writes
      to its snapshot tables

## Out of scope for now
- Free-text outputs (assessment template). Scoring them needs a reviewer to grade each field
  first (faithful / invented / missing); the harness could then score those grades as labels.
- Snapshot backdating fixture: a test utility with nothing to score.

## Later
- Golden-set trap design for each workflow (2-3+ records per trap type, plus records combining traps)

## Settled
- Route classes: auto (goes through, unseen), review (a person decides), block (never
  processed, unseen), exclude (duplicate suppressed, unseen). Silent omission = key says auto
  or review, workflow said block or exclude.
- Only routes decided purely by the confidence gate are movable in a gate what-if.
