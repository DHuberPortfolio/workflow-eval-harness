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

- Layer 3 emits `decision_branch`, so the adapter does not depend on reason wording
- Floor rejections keep their `evidence` span
- Answer key carries `trap_types: [...]` (short categories) beside the prose `trap`
- Answer key carries the correct `duplicate_of`, independent of what the workflow computed
- Answer key carries a correct route per record, so silent omissions and route types can be measured
