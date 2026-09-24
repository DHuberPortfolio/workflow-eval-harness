# Compliance reviewer

## What the workflow does

It reviews law-firm advertising copy against attorney advertising rules, in two layers:

- **A regex layer** catches the unambiguous: banned words ("best", "specialist",
  "guarantee"), results without a disclaimer, New York's labelling rule. Its hits block the
  copy or send it to a person.
- **An LLM layer** catches what regex cannot: claims that break the rules by what they imply.
  A finding holds the copy for a person only when its confidence reaches the client's
  threshold (0.80-0.90). Below the threshold, the finding becomes a note.

| Decision | What happens to the copy | Route class |
|---|---|---|
| PASS | goes out without review | auto |
| PASS_WITH_NOTES | goes out without review; its notes are logged, not read first (confirmed by the workflow's owner) | auto |
| REVIEW_REQUIRED | a person reviews it | review |
| BLOCK | a person signs off (the workflow's rule: "anything blocked or flagged, a person signs off") | review |

The golden set is 40 documents built into the workflow: 26 with violations, 14 clean. The
answer key gives each one's violation codes, and which layer should catch them
(`detectable_by`: deterministic, llm, both or none).

## How it is measured

- **Needed a person** means the answer key says the copy has a violation. Routes are judged
  on that verdict alone (`wrong_when: gold_route`), because the violation codes are the
  reasons for a verdict, not content that gets published. The adapter turns the key's
  violation flag into a correct route: a violation must reach a person, clean copy may go out.
- **Per trap** uses `detectable_by`, so the report shows which layer's catches get through.
- **`config.notes-reviewed.json`** scores the alternative where a person reads every note
  before the copy goes out.

Each run is saved twice: `runs/exec-N.json`, trimmed from the workflow's output (the
decision, the client's threshold, each layer's findings, the answer key), and
`runs/exec-N.harness.json`, the same run after the adapter
(`node adapter.js runs/exec-N.json > runs/exec-N.harness.json`). `key.json` is the current
answer key (key v2, below); score every run against it:

```
node bin/wfeval.js score --config examples/compliance-reviewer/config.json \
  --pred examples/compliance-reviewer/runs/exec-59.harness.json --key examples/compliance-reviewer/key.json
node bin/wfeval.js variance --config examples/compliance-reviewer/config.json \
  --key examples/compliance-reviewer/key.json examples/compliance-reviewer/runs/exec-5{6,7,8,9}.harness.json
```

| Runs | Workflow version | Kept? |
|---|---|---|
| 50, 51, 52 | prompt v1 | yes |
| 53, 54, 55 | prompt v2 | no: started at the same time, 20-47.5% of their model calls failed (trap I6) |
| 56, 57, 58, 59 | prompt v2 (59 also writes the pass-with-notes log) | yes |
| 60 | prompt v2, answer key v2 | no: one model call failed |

## What we found

### The model found the violations, then understated its confidence

With prompt v1, on the current golden set:

| | Notes go out without review (the workflow) | A person reads every note |
|---|---|---|
| Silent error rate, run 50 | **30.0%** (6 of 20; likely 14.5-51.9%) | 0.0% (0 of 14) |
| Silent error rate, runs 50-52 | 22.2-30.0% | 0% |

- **Every note was a real violation**, all of the kind only the LLM can catch (E15, E16, E20,
  E22, E38, E39). Each is typed SP-SHOULD-REVIEW + SP-MISSING-REJECTED: the model found the
  violation, and its confidence fell below the client's threshold (0.55-0.85 against
  0.80-0.90), so the copy went out with only a note.
- **The workflow's own scorecard counted a note as a catch**, so it reported a 100% catch rate.
- **E16 and E22 changed route between runs** of identical code: their strongest finding
  landed at 0.75 in two runs and 0.85 in the third, where it cleared the threshold.
- **The 14 clean documents drew no LLM finding in any run.** On this set the thresholds
  prevented no false alarm; they only set true findings aside. (0 of 14 is still consistent
  with a false alarm rate up to 21.5%.)

### The answer key was missing violations

The key lists one or two codes per document; the model often found a further real one
("Our track record speaks for itself" is a results claim with no disclaimer, beside the
implied guarantee the key lists). The review of every such code is in
[KEY_GAPS.md](KEY_GAPS.md).

## What we changed

### 1. Prompt v2 (2026-09-23)

The model found the violations but stated them below the threshold, so the fix belonged in
the model, not the threshold. Prompt v1 told the model to "be conservative", and it hedged
the confidence of findings it did report. The change (LLM prompt only; every regex rule
checked unchanged on 18 edge-case documents first):

- anchored the confidence scale (0.90 and up: most reviewers would flag it on sight; and so on)
- kept the caution for *whether* to report a finding, and said not to hedge the confidence
  of one it does report
- renamed `TESTIMONIAL_ISSUE` to the answer key's `TESTIMONIAL_NO_DISCLAIMER`

Runs 50-52 (v1) against 56-59 (v2), with the v1 runs as the noise baseline, codes scored
against key v2:

| | v1 (50-52) | v2 (56-59) | Verdict |
|---|---|---|---|
| Silent error rate | 22.2-30.0% | **6.7% in all four** | beyond noise |
| Violations reaching a person | 20-22 of 26 | **25 of 26** | 5 routes fixed, 0 broken |
| False alarms on the 14 clean documents | 0 | 0 | unchanged |
| Code recall | 62.5-67.5% | **87.5-90.0%** | beyond noise |
| Code precision | 89.3-90.0% | 81.8-87.5% | beyond noise, slightly worse |
| Code F1 | 0.735-0.771 | **0.857-0.878** | beyond noise |

The small precision drop is the model naming a violation the regex layer already caught a
second time, under its "implied" twin (an explicit "we guarantee" also coded
IMPLIED_GUARANTEE). It changes no route: that copy is blocked anyway.

### 2. Answer key v2 (2026-09-23)

9 violations the v1 key had not listed were added, after each was read against the copy.
Against the v1 key, prompt v2 had looked 10-20 points less precise than it was.
[KEY_GAPS.md](KEY_GAPS.md) has every candidate, and why each was added or not. In n8n, the
node **Answer Key v2 Additions** adds the same 9 right after the golden set, which itself is
unchanged.

### 3. Pass-with-notes log (2026-09-23)

PASS_WITH_NOTES copy goes out without review, so without a log its notes would be seen by
nobody. The workflow now writes each note to the n8n data table **Compliance Reviewer:
Pass-with-Notes Log**, one row per note. Sort by `code` to see which problems keep coming back.

| Columns | What they hold |
|---|---|
| code, confidence, threshold, short_by | the finding, and how far below the client's threshold it fell |
| doc_id, client_id, state, content | the copy that went out |
| quote, reasoning | the words at issue, and the model's one-line reason |
| key_verdict, key_codes | on golden-set runs, what the answer key says (live copy has no answer key) |
| layer, source, run_id, reviewed_at | which layer, golden set or live, which run, when |

With prompt v2, each run logs one row: E38, the award claim. A code that keeps appearing on
copy the answer key calls clean would mean a threshold is too low; one the answer key calls
a violation, a threshold too high (or a model understating its confidence).

### 4. The workflow's scorecard (2026-09-24)

The scorecard's headline is now the silent error rate, and a note no longer counts as a
catch: the copy still went out. Run 64 shows it agrees with the harness: silent error rate
6.7% (1 of 15), catch rate 96.2% (25 of 26 violations reached a person), false alarms 0 of
14, review precision 100%, straight-through 37.5%.

Every earlier version of the workflow is in its n8n version history.

## What's left

- **E38, the award claim**, is the one remaining silent error: the model finds it at
  0.65-0.75 against Florida's 0.90. Tuning the prompt for one of 40 documents would fit the
  golden set rather than the problem; it needs more award-claim documents first.
- **14 clean documents is a small base.** 0 false alarms in 14 still allows a real rate up to
  21.5%. More clean copy, especially copy that is nearly a violation, would show whether
  prompt v2 over-flags. (A larger golden set is being built.)
- **Precision**: a prompt v3 could stop the model re-coding violations the regex layer
  already names.
