# Metadata enrichment

## What the workflow does

It tags incoming news articles with controlled-vocabulary codes on four facets: SUBJECT,
INDUSTRY, GEOGRAPHY and COMPANY. Three layers:

- **A structural layer** finds company names, and groups retellings of the same story from
  different outlets. It keeps the best copy (the primary) and suppresses the rest as
  duplicates, so one event does not look like many.
- **An LLM** proposes codes, each with a confidence and the words it rests on.
- **A guard** rejects invented codes and unsupported evidence, sets aside values below the
  confidence floor (0.60), adds each code's broader terms, and routes the article.

| Decision | What happens | Route class |
|---|---|---|
| AUTO_PUBLISH | goes out without review | auto |
| EDITOR_REVIEW, SPECIALIST_REVIEW | an editor or specialist reviews it | review |
| DUPLICATE_SUPPRESSED | suppressed as a duplicate | exclude |

The guard's routing ladder, first match wins:

| Branch | Why the article went where it did | Decision | Can a threshold change move it? |
|---|---|---|---|
| model-failed | the model call failed | SPECIALIST_REVIEW | no (not scored for quality) |
| duplicate | not the primary copy | DUPLICATE_SUPPRESSED | no |
| hard-rejection | the guard rejected an invented code or unsupported evidence | EDITOR_REVIEW | no |
| empty-required | a required facet came back empty | EDITOR_REVIEW | no; the floor can empty a facet |
| completeness | a cue in the text (a regulator, a place name) has no matching code | EDITOR_REVIEW | no; the floor can leave a cued value unapplied |
| salience | a secondary subject is below the subject gate | EDITOR_REVIEW | no; confidence decides it, but not the lead gate |
| gate | a required facet's strongest value is below its gate (SUBJECT 0.85, INDUSTRY 0.70) | EDITOR_REVIEW | **yes** |
| auto | everything passed | AUTO_PUBLISH | **yes** |

The golden set is 24 articles, each built as a trap (a sentence per article says what it
tests). The answer key gives every article's correct codes on every facet, broader terms
included.

## How it is measured

- **Needed a person** means its codes differ from the answer key. The answer key has no
  correct route, so values decide (`wrong_when: any_mismatch`).
- **Allowed values** are the vocabulary and the company list (`allowed/`), so an invented
  code is caught (SP-INVALID).
- **Thresholds** as in the workflow: gates of SUBJECT 0.85 and INDUSTRY 0.70 on each facet's
  strongest value, and a floor of 0.60.

| Run | Where it comes from |
|---|---|
| `run49.json` | run 49, replayed from the showcase repo's saved run by `export-run49.js` through `adapter.js` |
| `runs/exec-61.json` to `exec-63.json` | three fresh runs, saved from the workflow's Harness Export node by `save-run.js` |

```
node bin/wfeval.js score --config examples/metadata-enrichment/config.json \
  --pred examples/metadata-enrichment/run49.json --key examples/metadata-enrichment/run49.json
node bin/wfeval.js variance --config examples/metadata-enrichment/config.json \
  --key examples/metadata-enrichment/runs/exec-61.json examples/metadata-enrichment/runs/exec-6{1,2,3}.json
node examples/metadata-enrichment/save-run.js <execution.json> examples/metadata-enrichment/runs/exec-64.json
```

`save-run.js` takes an execution as n8n's API returns it (with node data), and writes the
file only if its routes match that run's own Operations Scorecard.

**How the export becomes harness records.** One record per article, with the answer key in
the same record (`truth_codes`). Applied values and their confidence become each facet's
values; values the guard rejected are added marked `applied: false`, except a rejected code
that was applied anyway as a broader term (GEO-US rejected at 0.40, but carried in by
GEO-US-TX), which would otherwise be the same value twice. The routing branch comes from the
start of `decision_reason`, and an unrecognised reason stops the export rather than
misfiling a record.

## What we found

### Run 49, reproduced figure for figure

The harness reproduces the workflow scorecard's figures: straight-through 7 of 24, 0 silent
errors in 7, review precision 14 of 15 (A24 unnecessary), and every facet's precision,
recall, F1 and counts (asserted in `test/examples.test.js`). What it adds:

- **0 silent errors in 7 could still be a 35.4% rate.** Seven articles out without review
  cannot show more than that.
- **Below the 0.60 floor, 8 of the 10 set-aside claims were right.** At 10 claims that is a
  lead, not a finding, but it points the same way as the guard code's own notes: the
  thresholds here cost recall more than they protect precision.
- **The INDUSTRY gate what-if**: at 0.60, A21 would go out as a silent error; at 0.85, four
  more articles would be held back with no silent error prevented.

### Three fresh runs of identical code (61-63)

One at a time, about $0.33 each by the workflow's own estimate:

| | Run 61 | Run 62 | Run 63 |
|---|---|---|---|
| Silent error rate | 0 of 7 | 0 of 8 | 0 of 8 |
| Straight-through | 7 of 24 (29.2%) | 8 of 24 (33.3%) | 8 of 24 (33.3%) |
| Review precision | 14 of 15 (A04 unnecessary) | 12 of 14 (A04, A24) | 13 of 14 (A04) |
| SUBJECT recall | 70.7% | 73.2% | 75.6% |

- **0 silent errors in 23 articles out without review**, across the three runs. Pooled, that
  is consistent with a true rate up to about 14%, where one run alone allows 35%.
- **A22 changed route.** In run 61 the model left out GEO-UK ("open an office in London");
  the place-name cue caught it and sent A22 to an editor. In 62 and 63 the model tagged it and
  A22 went out correctly. The guard, not luck, kept run 61 safe.
- **A04 is an unnecessary review in every run**: INDUSTRY IND-TECH at 0.60 against the 0.70
  gate, and IND-TECH is right. One steady unnecessary review, not noise.
- **A possible key gap that is not one**: SUBJ-ANTI on A01, stated in all three runs at 0.75.
  The answer key leaves it out on purpose: the guard's own notes call it a marginal claim
  (the same story from another outlet drew 0.40), and the salience check sends it to an
  editor every time. The same value in every run, and still not a gap (trap I7).

## What we changed

### Harness Export node (2026-09-23)

A side branch after the guard emits each article already in the harness's shape: the same
translation as `adapter.js`, plus the routing branch and the article's trap sentence. The
guard's own items carry the whole vocabulary, which made a run slow to pull; the export is
about 15 KB per run.

## What's left

- **A04's unnecessary review** is the INDUSTRY gate holding back a correct tag. Lowering the
  gate is not a free fix: at 0.60, A21 would go out wrong.
- **SUBJECT recall (70.7-75.6%)** is the weak facet: the model under-proposes regulator
  codes (SUBJ-REG), and the completeness check is catching them for it. The workflow's own
  run brief named A09, A12, A20 and A24.
- **Per-trap results** need short trap categories in the answer key (`trap_types: [...]`)
  beside the trap sentence, which is prose.
- **24 articles is a small base.** A larger golden set is being built.
- **Other suggested workflow changes**: the guard emits its routing branch itself (today the
  export derives it from the reason's wording); rejected values keep their evidence; the
  answer key carries each article's correct route and, for duplicates, its primary, so silent
  omissions and route types can be measured.
- **The floor what-if** re-admits or sets aside values, but does not re-apply this workflow's
  cap of 4 proposed values per facet or re-add broader terms. Articles whose route could depend
  on those are marked "needs replay" rather than guessed.
