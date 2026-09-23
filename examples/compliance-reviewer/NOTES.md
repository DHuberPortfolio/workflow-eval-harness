# Compliance reviewer: notes for this workflow

A two-layer reviewer for advertising copy: a deterministic layer (regex rules) and an LLM
layer for implied violations. Each LLM finding gates the copy only at or above the
client's threshold (0.80-0.90); below it, the finding becomes a note and the copy gets
`PASS_WITH_NOTES`. The 40-document answer key is built into the workflow.

## Runs

`runs/exec-N.json`: one run each, trimmed to what the adapter needs (decision, the client's
threshold, each layer's findings, the answer key). `runs/*.harness.json` are the same runs
after the adapter (`node adapter.js runs/exec-50.json > runs/exec-50.harness.json`).

| runs | workflow version |
|---|---|
| 50, 51, 52 | prompt v1 |
| 56, 57, 58, 59 | prompt v2 (59 also writes the pass-with-notes log) |

Each run carries the answer key it ran with (v1). `key.json` is **key v2**, the v1 key plus
8 violations it was missing (see `KEY_GAPS.md`); score against it:

```
node bin/wfeval.js score --config examples/compliance-reviewer/config.json \
  --pred examples/compliance-reviewer/runs/exec-59.harness.json --key examples/compliance-reviewer/key.json
node bin/wfeval.js variance --config examples/compliance-reviewer/config.json \
  --key examples/compliance-reviewer/key.json examples/compliance-reviewer/runs/exec-5{6,7,8,9}.harness.json
```

Not kept: 53-55 (started together; see below) and 60 (one model call failed and went to a
person; trap I6).

## Routing

| Decision | Route class | Why |
|---|---|---|
| PASS | auto | goes live |
| PASS_WITH_NOTES | **auto** | goes live without a person (confirmed by the workflow's owner, 2026-09-23); its notes are logged, see below. `config.notes-reviewed.json` shows the alternative, where a person reads every note first |
| REVIEW_REQUIRED | review | |
| BLOCK | review | the workflow's README: "anything blocked or flagged, a person signs off" |

The answer key has no route, only `expected_flag`; the adapter turns it into a correct route
(`VIOLATION` must reach a person, `CLEAN` may go live). `wrong_when` is `gold_route`, because
the violation codes are the reasons for a verdict, not content that is published.

`trap_field` is the key's `detectable_by`: which layer should catch the violation
(deterministic, llm, both, none), so the per-trap table shows which layer's catches get through.

## Pass-with-notes log

PASS_WITH_NOTES copy goes live unseen, so its notes would otherwise be seen by nobody. Since
2026-09-23 the workflow writes each note to the n8n data table **Compliance Reviewer:
Pass-with-Notes Log**, one row per note (nodes "Collect Notes" and "Pass-with-Notes Log").
Sort by `code` to see which problems keep coming back.

| column | what it holds |
|---|---|
| code, confidence, threshold, short_by | the finding, and how far below the client's threshold it fell |
| doc_id, client_id, state, content | the copy that went live |
| quote, reasoning | the words at issue and the model's one-line reason |
| key_verdict, key_codes | for eval-set runs, what the answer key says (live copy has no key) |
| layer, source, run_id, reviewed_at | which layer, eval set or live, which execution, when |

With prompt v2, each run logs one row: E38, the award claim at 0.75 against Florida's 0.90.
The key says it is a violation, so every E38 row is a known silent error until award claims
are fixed (see below). A code that shows up again and again in the log, on copy the key
calls clean, would be the sign of a threshold that is too low; a code the key calls a
violation, the sign of one that is too high.

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
  (E11's STATISTIC_NO_CONTEXT). The owner ruled these gaps in the key; each one is reviewed
  in `KEY_GAPS.md`.

## Experiment: prompt v2 (2026-09-23)

The finding above says the model *found* the violations but stated them below the
threshold, so the fix is the model, not the threshold. The v1 prompt told the model to
"be conservative", and it hedged the confidence of findings it did report.

**Change** (n8n workflow version "Prompt v2", LLM prompt only; every deterministic rule
verified unchanged on 18 edge-case documents first):
- anchored the confidence scale (0.90+ = most reviewers would flag it on sight, and so on)
- kept conservatism for *whether* to report, and said not to hedge the confidence of a report
- renamed `TESTIMONIAL_ISSUE` to the key's `TESTIMONIAL_NO_DISCLAIMER`

**Result**: runs 50-52 (v1) against 56-59 (v2), `compare --noise` with the v1 runs as noise.
Codes are scored against key v2 (`key.json`); the v1 key's figures are in `KEY_GAPS.md`.

| | v1 (50-52) | v2 (56-59) | verdict |
|---|---|---|---|
| silent error rate (notes go live) | 22.2-30.0% | **6.7% in all four** | beyond noise |
| violations reaching a person | 20-22 of 26 | **25 of 26** | 5 routes fixed, 0 broken |
| false alarms on the 14 clean documents | 0 | 0 | unchanged |
| code recall | 64.1-69.2% | **87.2-92.3%** | beyond noise |
| code precision | 89.3-90.0% | 81.8-87.5% | beyond noise, slightly worse |
| code F1 | 0.746-0.783 | **0.850-0.889** | beyond noise |

- The one remaining note is **E38** (an award listing, 0.65-0.75 against Florida's 0.90).
  Tuning the prompt for one of 40 documents would fit the golden set rather than the problem;
  it needs more award-claim documents in the golden set first.
- Against the v1 key, precision looked 10-20 points worse, because v2 states secondary codes
  with confidence (RESULTS_NO_DISCLAIMER next to an implied guarantee). The owner ruled
  those are gaps in the key; the 8 that hold up on reading are now in key v2 (`KEY_GAPS.md`).
  What is left of the precision drop is the model naming a violation the key already has a
  second time, under its "implied" twin. No route changed because of it.
- 14 clean documents is a small base: 0 false alarms in 14 is consistent with a rate up to
  21.5%. More clean documents (especially near-misses) would show whether v2 over-flags real copy.

**Discarded runs 53-55**: started at the same time, they hit the API together and 20-47.5% of
their model calls failed. Every failed call routed to a person (the workflow failed safe), but
those runs measured the failures, not the prompt. They were rerun one at a time as 56-58. The
harness now tracks `model calls failed` per run and warns (trap I6) before comparing such a run.

To undo v2: restore n8n workflow version `d167d897-989f-44a1-b8fa-d3784cadd2cb`.
