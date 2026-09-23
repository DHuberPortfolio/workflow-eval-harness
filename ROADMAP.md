# Roadmap

Built in small, reviewed pieces. Each piece lands with its tests and, where it
computes a number, with that number worked out by hand in a fixture first.

## Day 1: inputs and output quality
- [x] Scaffold, zero dependencies, `node --test`
- [x] Config schema and validation (`src/config.js`, `wfeval check`)
- [x] Tiny fixture with hand-worked answers (`test/fixtures/tiny/EXPECTED.md`)
- [x] Rates with 95% Wilson intervals (`src/metrics/stats.js`)
- [x] Trap labels declared in config (`trap_field`)
- [x] Tool trap catalogue (`test/TRAPS.md`) and silent error types (`docs/SILENT_ERRORS.md`)
- [ ] Strict mode (default) and `--lenient`
- [ ] `load.js`: read JSON and n8n item exports, normalize values (traps A, D, E, F)
- [ ] `align.js`: match predictions to key by id (traps B, C)
- [ ] Precision / recall / F1 per facet and overall, set and label outputs
- [ ] Adapter for the metadata enrichment export (`adapters/metadata-enrichment.js`):
      applied tags + floor rejections -> one value list with `applied` flags; `truth_codes` -> key
- [ ] Reproduce run 49 facet figures (golden fixture)

## Day 2: routing
- [ ] Silent error rate (headline), straight-through, review-queue precision, block precision
- [ ] Silent error types and severity: silent publishes and silent omissions
- [ ] Per-facet breakdown
- [ ] Per-trap breakdown: routed correctly, silent errors, wasted reviews per trap type
- [ ] Trap coverage check: every trap type listed with its count; below `min_per_trap` stops in strict mode
- [ ] `wfeval score` terminal report + JSON results file
- [ ] Reproduce run 49 routing figures

## Day 3: across runs
- [ ] Calibration: bucket per stated confidence value (fixed width optional); inherited values excluded; interval per bucket; per facet
- [ ] `wfeval variance`: N runs, mean and spread per metric
- [ ] `wfeval compare`: metric deltas plus the records that flipped
- [ ] Pull past runs from n8n executions

## Day 4: what-if and publishing
- [ ] `wfeval whatif --gate`: sweep each facet's auto-publish threshold 0.50-1.00. Only records
      stopped by the confidence gate (branch 6) or auto-published (branch 7) can move; tags never
      change, so precision/recall stay fixed and only routing moves. Counts shown beside rates.
- [ ] `wfeval whatif --floor`: re-admit or evict tags, re-sort, re-apply the per-facet cap, re-roll-up.
      Recomputes precision/recall and the gate. Records whose completeness cue might change (the A24
      case) are marked "needs replay", never guessed. Lowering the floor cannot change a lead tag;
      raising it can.
- [ ] Self-contained HTML report (no CDN)
- [ ] README: architecture and the reasoning behind each metric
- [ ] Publish to GitHub

## Suggested workflow changes (n8n, not this repo)
- [ ] Layer 3 emits `decision_branch: 1..7` so what-if does not depend on reason wording
- [ ] Floor rejections keep their `evidence` span
- [ ] Answer key carries `trap_types: [...]` (short categories) beside the prose `trap`
- [ ] Answer key carries the correct `duplicate_of`, independent of what the workflow computed

## Later
- Golden-set trap design for each workflow (2-3+ records per trap type, plus records combining traps)
- Adapter for the bar compliance reviewer (label output: pass -> auto, elevate -> review, fail -> block)

## Settled
- Route classes: auto (published, unseen), review (analyst decides), block (never processed,
  unseen), exclude (retelling suppressed, unseen). Silent omission = key says auto or review,
  workflow said block or exclude.
- Only the confidence gate (metadata enrichment branch 6) is purely confidence-driven.
  Branches 4 and 5 are affected by the floor indirectly.
