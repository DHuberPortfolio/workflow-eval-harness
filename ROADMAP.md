# Roadmap

Built in small, reviewed pieces. Each piece lands with its tests and, where it
computes a number, with that number worked out by hand in a fixture first.

## Day 1: inputs and output quality
- [x] Scaffold, zero dependencies, `node --test`
- [x] Config schema and validation (`src/config.js`, `wfeval check`)
- [x] Tiny fixture with hand-worked answers (`test/fixtures/tiny/EXPECTED.md`)
- [x] Rates with 95% Wilson intervals (`src/metrics/stats.js`)
- [x] Trap labels declared in config (`trap_field`)
- [ ] `load.js`: read JSON, normalize values (trim, applied flag, labels vs sets)
- [ ] `align.js`: match predictions to key by id; fail loudly on missing, duplicate or unknown-route records
- [ ] Precision / recall / F1 per facet and overall, set and label outputs
- [ ] Reproduce run 49 facet figures (golden fixture)

## Day 2: routing
- [ ] Silent error rate (headline), straight-through, review-queue precision, block precision
- [ ] Per-facet breakdown
- [ ] Per-trap breakdown: routed correctly, silent errors, wasted reviews per trap type
- [ ] `wfeval score` terminal report + JSON results file
- [ ] Reproduce run 49 routing figures

## Day 3: across runs
- [ ] Calibration: bucket per stated confidence value (fixed width optional); inherited values excluded; interval per bucket
- [ ] `wfeval variance`: N runs, mean and spread per metric
- [ ] `wfeval compare`: metric deltas plus the records that flipped
- [ ] Pull past runs from n8n executions

## Day 4: what-if and publishing
- [ ] `wfeval whatif`: re-apply floor and per-facet gates across a range; show counts beside rates
- [ ] Route reasons: only confidence-driven routes can move in a what-if
- [ ] Self-contained HTML report (no CDN)
- [ ] README: architecture and the reasoning behind each metric
- [ ] Publish to GitHub

## Open questions
- Which route reasons in each workflow are confidence-driven (needed for what-if)?
