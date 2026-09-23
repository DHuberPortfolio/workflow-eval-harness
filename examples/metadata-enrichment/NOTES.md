# Metadata enrichment: notes for this workflow

Workflow-specific knowledge lives here, not in the harness. The harness only sees
what this workflow's adapter gives it.

## Export shape

One record per article. The answer key is inside the same record (`truth_codes`),
already closed under taxonomy ancestors. Applied values with confidence are under
`applied.*`; values rejected by the guard are under `guard.rejections[]`. The adapter
merges them into one value list per output, marking rejections `applied: false`.

## Routing ladder (first match wins)

| # | Condition | Decision | Route class | Confidence-driven? |
|---|---|---|---|---|
| 1 | model call failed | SPECIALIST_REVIEW | review | no (record not scored for quality) |
| 2 | not the canonical copy | DUPLICATE_SUPPRESSED | exclude | no |
| 3 | hard guard rejection | EDITOR_REVIEW | review | no |
| 4 | a required facet is empty | EDITOR_REVIEW | review | indirectly: the floor can empty a facet |
| 5 | completeness cue fired | EDITOR_REVIEW | review | indirectly: the floor can leave a cued value unapplied |
| 6 | lead confidence below the gate | EDITOR_REVIEW | review | **yes** |
| 7 | otherwise | AUTO_PUBLISH | auto | - |

For what-if: records on branches 6 and 7 are movable by the gate. A floor change can
also move records on branches 4 and 5, which the harness cannot resolve without
replaying this workflow's cues, so the adapter marks them "needs replay".

A faithful floor replay for this workflow re-admits or evicts values, re-sorts by
confidence, re-applies the cap of 4 model-proposed values per facet, then re-adds
ancestors. That logic belongs in this adapter, not the harness.

## Suggested workflow changes (in n8n)

- Layer 3 emits `decision_branch: 1..7`, so the adapter does not depend on reason wording
- Floor rejections keep their `evidence` span
- Answer key carries `trap_types: [...]` (short categories) beside the prose `trap`
- Answer key carries the correct `duplicate_of`, independent of what the workflow computed
