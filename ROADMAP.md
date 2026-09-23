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
- [ ] `align.js`: match predictions to key by id (traps B, C)
- [ ] Second tiny fixture shaped like a compliance review: a label output (pass / elevate / fail)
      plus a set of violation codes, so both output types are proven from the start
- [ ] Precision / recall / F1 per output and overall, set and label outputs

## Day 2: routing
- [ ] Silent error rate (headline), straight-through, review-queue precision, block precision
- [ ] Silent error types and severity: silent publishes and silent omissions
- [ ] Per-output breakdown
- [ ] Per-trap breakdown: routed correctly, silent errors, wasted reviews per trap type
- [ ] Trap coverage check: every trap type listed with its count; below `min_per_trap` stops in strict mode
- [ ] `wfeval score` terminal report + JSON results file

## Day 3: across runs
- [ ] Calibration: bucket per stated confidence value (fixed width optional); inherited values
      excluded; interval per bucket; per output
- [ ] `wfeval variance`: N runs, mean and spread per metric
- [ ] `wfeval compare`: metric deltas plus the records that flipped

## Day 4: what-if and publishing
- [ ] `wfeval whatif --gate`: sweep each gated output's threshold. Only records marked
      `movable` (their route was decided by the confidence gate, or they went through)
      can change route; values never change, so precision/recall stay fixed. Counts beside rates.
- [ ] `wfeval whatif --floor`: re-admit or evict values by the floor and recompute precision,
      recall and the gate. Records whose route depended on something the harness cannot
      recompute are reported as "needs replay", never guessed. A workflow-specific replay
      (caps, hierarchies, cue lists) can be supplied by its adapter.
- [ ] Self-contained HTML report (no CDN)
- [ ] README: architecture and the reasoning behind each metric
- [ ] Publish to GitHub

## Real-world fixtures (one per workflow, in `examples/`)
- [ ] Metadata enrichment: adapter + reproduce run 49's facet and routing figures
- [ ] Bar compliance: adapter + its 40-document ground truth set
- [ ] Competitor registry: needs "declined to classify" handled as its own outcome
- [ ] Competitor watch: needs **ordinal labels** (bands 1-5, where near-misses count less than
      far misses)

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
