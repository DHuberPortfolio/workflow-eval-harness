# Metadata enrichment: notes for this workflow

Workflow-specific knowledge lives here, not in the harness. The harness only sees
what this workflow's adapter gives it.

## Reproducing run 49

```
node examples/metadata-enrichment/export-run49.js <showcase>/eval/metadata-enrichment
node bin/wfeval.js score --config examples/metadata-enrichment/config.json \
  --pred examples/metadata-enrichment/run49.json --key examples/metadata-enrichment/run49.json
```

The export uses the showcase repo's own replay (`run.js`) in memory and writes
`run49.json` plus `allowed/*.json` here. `test/examples.test.js` asserts that the harness
reproduces the workflow scorecard's figures: straight-through 7/24, silent errors 0/7,
review-queue precision 14/15 (A24 unnecessary), and every facet's precision, recall, F1 and
TP/FP/FN.

What the harness adds that the scorecard does not show:
- 0 silent errors in 7 could still be a 35.4% rate (95% range).
- Below the 0.60 floor, 8 of the 10 rejected claims were correct. At 10 claims that is a
  lead, not a finding, but it points the same way as the guard code's own run 42-45 notes:
  the thresholds here gate recall more than precision.
- The INDUSTRY gate sweep: at 0.60, A21 goes through as a silent error; at 0.85 four
  more records are held back with no silent error prevented on this run.

## Fresh runs (61-63)

Since 2026-09-23 the workflow has a **Harness Export** node, a side branch after Layer 3
that emits each article already in the harness's shape (the same translation as
`adapter.js`, plus `decision_branch` and the prose `trap`). Layer 3's own items carry the
whole vocabulary, which made a run slow to pull; the export is about 15 KB per run.

```
node examples/metadata-enrichment/save-run.js <execution.json> examples/metadata-enrichment/runs/exec-61.json
node bin/wfeval.js variance --config examples/metadata-enrichment/config.json \
  --key examples/metadata-enrichment/runs/exec-61.json examples/metadata-enrichment/runs/exec-6{1,2,3}.json
```

`save-run.js` takes the execution as n8n's API returns it (with node data) and writes the
file only if its routes match the run's own Operations Scorecard.

Three runs of identical code, one at a time (about $0.33 each by the workflow's own estimate):

| | run 61 | run 62 | run 63 |
|---|---|---|---|
| silent error rate | 0 of 7 | 0 of 8 | 0 of 8 |
| straight-through | 7/24 = 29.2% | 8/24 = 33.3% | 8/24 = 33.3% |
| review-queue precision | 14/15 (A04 unnecessary) | 12/14 (A04, A24) | 13/14 (A04) |
| SUBJECT recall | 70.7% | 73.2% | 75.6% |

- **A22 changed route**: in run 61 the model left out GEO-UK ("open an office in London"),
  the place-name cue caught it and sent A22 to review; in 62 and 63 the model tagged it
  and A22 went through correctly. The guard, not luck, made run 61 safe.
- **0 silent errors in 23 auto-published records across the three runs.** Pooled, that is
  consistent with a true rate up to about 14%, tighter than any single run's 35%.
- **A04 is an unnecessary review in every run**: INDUSTRY IND-TECH at 0.60 against the
  0.70 gate, and IND-TECH is right. One steady wasted review, not noise.
- **Possible key gap, not added**: SUBJ-ANTI on A01, stated in all three runs at 0.75. The
  key leaves it out on purpose: Layer 3's own notes call it a marginal claim (the same
  story from another outlet drew 0.40), and the salience gate sends it to an editor every
  time. Consistent, and still not a gap (trap I7).

## Export shape

One record per article. The answer key is inside the same record (`truth_codes`),
already closed under taxonomy ancestors. Applied values with confidence are under
`applied.*`; values rejected by the guard are under `guard.rejections[]`. The adapter
merges them into one value list per output, marking rejections `applied: false`, and
drops a rejection whose code is applied anyway as a broader term (GEO-US rejected at
0.40, but carried in by GEO-US-TX).

The export's `trap` field is a sentence per record, not a category, so this example does
not set `trap_field`. Per-trap reporting needs the `trap_types` change below.

## Routing ladder (first match wins)

| Branch | Condition | Decision | Route class | Movable by the gate? |
|---|---|---|---|---|
| model-failed | model call failed | SPECIALIST_REVIEW | review | no (not scored for quality) |
| duplicate | not the canonical copy | DUPLICATE_SUPPRESSED | exclude | no |
| hard-rejection | hard guard rejection | EDITOR_REVIEW | review | no |
| empty-required | a required facet is empty | EDITOR_REVIEW | review | no; the floor can empty a facet |
| completeness | completeness cue fired | EDITOR_REVIEW | review | no; the floor can leave a cued value unapplied |
| salience | a secondary subject is below the subject gate | EDITOR_REVIEW | review | no; confidence-driven, but not by the lead gate |
| gate | lead confidence below the per-facet gate (SUBJECT 0.85, INDUSTRY 0.70) | EDITOR_REVIEW | review | **yes** |
| auto | everything passed | AUTO_PUBLISH | auto | **yes** |

The adapter derives the branch from the start of `decision_reason` and stops on a reason
it does not recognise.

A faithful floor replay for this workflow re-admits or evicts values, re-sorts by
confidence, re-applies the cap of 4 model-proposed values per facet, then re-adds
ancestors. The harness's generic floor what-if does none of the last three, and marks
records whose route could depend on them as "needs replay".

## Suggested workflow changes (in n8n)

- Layer 3 emits `decision_branch`, so nothing depends on reason wording (partly done: the
  Harness Export node derives it inside the workflow, so a reworded reason stops the run
  itself rather than a later export)
- Floor rejections keep their `evidence` span
- Answer key carries `trap_types: [...]` (short categories) beside the prose `trap`
- Answer key carries the correct `duplicate_of`, independent of what the workflow computed
- Answer key carries a correct route per record, so silent omissions and route types can be measured
