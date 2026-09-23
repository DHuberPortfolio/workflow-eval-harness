# Compliance reviewer: notes for this workflow

A two-layer reviewer for advertising copy: a deterministic layer (regex rules) and an LLM
layer for implied violations. Each LLM finding gates the copy only at or above the
client's threshold (0.80-0.90); below it, the finding becomes a note and the copy gets
`PASS_WITH_NOTES`. The 40-document answer key is built into the workflow.

## Runs

`runs/exec-50.json`, `exec-51.json`, `exec-52.json`: three runs of identical code on the
same 40 documents, trimmed to what the adapter needs (decision, the client's threshold,
each layer's findings, the answer key). `runs/*.harness.json` are the same runs after the
adapter (`node adapter.js runs/exec-50.json`).

```
node bin/wfeval.js score --config examples/compliance-reviewer/config.json \
  --pred examples/compliance-reviewer/runs/exec-50.harness.json --key examples/compliance-reviewer/runs/exec-50.harness.json
node bin/wfeval.js variance --config examples/compliance-reviewer/config.json \
  --key examples/compliance-reviewer/runs/exec-50.harness.json examples/compliance-reviewer/runs/exec-5{0,1,2}.harness.json
```

## Routing

| Decision | Route class | Why |
|---|---|---|
| PASS | auto | goes live |
| PASS_WITH_NOTES | **auto** in `config.json`, review in `config.notes-reviewed.json` | depends on whether a person reads the notes before the copy goes live (open question) |
| REVIEW_REQUIRED | review | |
| BLOCK | review | the workflow's README: "anything blocked or flagged, a person signs off" |

The answer key has no route, only `expected_flag`; the adapter turns it into a correct route
(`VIOLATION` must reach a person, `CLEAN` may go live). `wrong_when` is `gold_route`, because
the violation codes are the reasons for a verdict, not content that is published.

`trap_field` is the key's `detectable_by`: which layer should catch the violation
(deterministic, llm, both, none), so the per-trap table shows which layer's catches get through.

## What the harness found

| | notes go live | notes are reviewed |
|---|---|---|
| silent error rate, run 50 | **30.0%** (6 of 20, range 14.5-51.9%) | 0.0% (0 of 14) |
| silent error rate, 3 runs | 22.2% - 30.0% | 0% |

- **All six notes are real violations**, all of the kind only the LLM can catch (E15, E16, E20,
  E22, E38, E39). Each is typed SP-SHOULD-REVIEW + SP-MISSING-REJECTED: the model found the
  violation, and the client threshold discarded it. The workflow's own scorecard counts a
  note as "flagged", so it reports a 100% catch rate either way.
- **E16 and E22 flip between runs**: their top finding lands at 0.75 in two runs and at 0.85 in
  the third, where it clears the 0.80 / 0.85 threshold. Identical code, different route.
- **The 14 clean documents drew no LLM finding at all in any run**, so on this set the
  thresholds prevent no false alarm; they only discard true findings. (14 clean documents is
  a small base: 0 of 14 is consistent with a false-alarm rate up to 21.5%.)
- The LLM prompt names a code the answer key does not use: `TESTIMONIAL_ISSUE` vs the key's
  `TESTIMONIAL_NO_DISCLAIMER`, so those claims count as wrong in calibration.
- The key lists one or two codes per document; the LLM often finds a further plausible one
  (E11's STATISTIC_NO_CONTEXT). Whether those are errors or gaps in the key is a key decision.

## Experiment: prompt v2 (2026-09-23)

The finding above says the model *found* the violations but stated them below the
threshold, so the fix is the model, not the threshold. The v1 prompt told the model to
"be conservative", and it hedged the confidence of findings it did report.

**Change** (n8n workflow version "Prompt v2", LLM prompt only; every deterministic rule
verified unchanged on 18 edge-case documents first):
- anchored the confidence scale (0.90+ = most reviewers would flag it on sight, and so on)
- kept conservatism for *whether* to report, and said not to hedge the confidence of a report
- renamed `TESTIMONIAL_ISSUE` to the key's `TESTIMONIAL_NO_DISCLAIMER`

**Result**: runs 50-52 (v1) against 56-58 (v2), `compare --noise` with the v1 runs as noise:

| | v1 (50-52) | v2 (56-58) | verdict |
|---|---|---|---|
| silent error rate, if notes go live | 22.2-30.0% | **6.7% in all three** | beyond noise |
| violations reaching a person | 20-22 of 26 | **25 of 26** | 5 routes fixed, 0 broken |
| false alarms on the 14 clean documents | 0 | 0 | unchanged |
| code recall | 77.4-83.9% | **93.5%** | beyond noise |
| code precision | 80.0-89.7% | 65.9-72.5% | beyond noise, **worse** |

- The one remaining note is **E38** (an award listing, 0.65-0.75 against Florida's 0.90).
  Tuning the prompt for one of 40 documents would fit the golden set rather than the problem;
  it needs more award-claim documents in the golden set first.
- Precision fell because v2 states secondary codes with confidence (RESULTS_NO_DISCLAIMER next
  to an implied guarantee). No route changed because of it here: every document it adds codes
  to is already a violation. Whether those codes are errors or gaps in the key is a key decision.
- 14 clean documents is a small base: 0 false alarms in 14 is consistent with a rate up to
  21.5%. More clean documents (especially near-misses) would show whether v2 over-flags real copy.

**Discarded runs 53-55**: started at the same time, they hit the API together and 20-47.5% of
their model calls failed. Every failed call routed to a person (the workflow failed safe), but
those runs measured the failures, not the prompt. They were rerun one at a time as 56-58. The
harness now tracks `model calls failed` per run and warns (trap I6) before comparing such a run.

To undo v2: restore n8n workflow version `d167d897-989f-44a1-b8fa-d3784cadd2cb`.
