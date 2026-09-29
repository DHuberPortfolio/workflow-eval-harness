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
| doubt (v3, Golden 500 copy) | the model proposed a code at 0.40 or more that the floor set aside | EDITOR_REVIEW | no |
| gate | a required facet's strongest value is below its gate (SUBJECT 0.85, INDUSTRY 0.70) | EDITOR_REVIEW | **yes** |
| auto | everything passed | AUTO_PUBLISH | **yes** |

Two golden sets: the first 24 articles, built into the workflow, and the Golden 500 (the 24
plus 476 more, 34 of them duplicates of another article), held in an n8n data table whose
rows are fingerprinted so a run stops if the answer key changes. Each article is built as a
trap (a sentence says what it tests). The answer key gives every article's correct codes on
every facet, broader terms included, and for a duplicate, the article it repeats.

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
| `golden500/exec-68.json` to `exec-72.json` | the Golden 500 test copy of the workflow, saved the same way, with each duplicate's primary from the answer key added (`expected.duplicate_of`); scored with `golden500/config.json` |

| Golden 500 run | Workflow version | Kept? |
|---|---|---|
| 66 | v1 | no: started together with a 500-document compliance run; 117 of 500 model calls failed (trap I6). The workflow now sends its model calls two at a time |
| 68 | v1 (the demo's pipeline) | yes |
| 69 | v2 prompt | yes |
| 70, 71, 72 | v3 guard | yes: three runs of identical code |

```
node bin/wfeval.js variance --config examples/metadata-enrichment/golden500/config.json \
  --key examples/metadata-enrichment/golden500/exec-70.json examples/metadata-enrichment/golden500/exec-7{0,1,2}.json
node bin/wfeval.js compare --config examples/metadata-enrichment/golden500/config.json \
  --key examples/metadata-enrichment/golden500/exec-70.json \
  --before examples/metadata-enrichment/golden500/exec-69.json --after examples/metadata-enrichment/golden500/exec-71.json \
  --noise examples/metadata-enrichment/golden500/exec-70.json --noise examples/metadata-enrichment/golden500/exec-71.json \
  --noise examples/metadata-enrichment/golden500/exec-72.json
```

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

### On 500 articles (Golden 500)

| | 24 articles (61-63) | v1 (68) | v2 prompt (69) | v3 guard (70, 71, 72) |
|---|---|---|---|---|
| Silent error rate | 0 of 23 (likely up to ~14%) | **27.0%** (54 of 200) | 11.6% (27 of 233) | **6.5%, 6.3%, 8.6%** |
| Straight-through | 29-33% | 40.0% | 46.6% | 39.8-42.0% |
| Review precision | 86-93% | 61.7% | 47.4% | 40.8-44.0% |
| SUBJECT recall | 71-76% | 82.8% | 94.7% | 95.2-95.8% |
| Model calls failed | 0 | 0 | 5 | 1, 0, 1 |

The workflow's own scorecard gives the same silent error rates.

- **The 24 articles were not representative.** Their 0 silent errors in 23 allowed a true rate
  up to about 14%; on 500 articles v1's was 27% (likely 21.3-33.5%). A likely range covers the
  chance in which records a golden set happens to hold, not a golden set that leaves out the
  hard cases.
- **v1's silent errors were mostly one gap**: 36 of the 54 articles were missing a regulation
  (SUBJ-REG, 29 articles) or litigation (SUBJ-LIT, 8) subject beside the main one; B223 was
  missing both, so the two counts overlap by one. The prompt told the model not to tag
  broader terms, and those two are not broader terms of anything the model did tag, so the
  roll-up never added them. The v2 prompt fixed it: SUBJECT recall 82.8% to 94.7%.
- **v3 is below 10% in every run**: pooled over its three runs, 44 of 615 (7.2%, likely
  5.4-9.5%). Compared with v2 against the spread of the three identical runs, the drop is
  beyond noise (5.3 points against a 2.3-point range).
- **It holds on articles it was not tuned on.** The guard's 0.40 was chosen on the articles
  whose id's CRC-32 is even, and checked on the rest. Pooled over v3's runs: 7.7% (24 of 312)
  on the tuning half, 6.6% (20 of 303; likely 4.3-10.0%) on the held-out half. (The v2 prompt
  fixes were written from v1's mistakes across all 500.)
- **The price is reviews.** v3 sends 21-27 articles per run to an editor on the new rung, about
  half of which needed one; straight-through falls from 46.6% to about 41%. Across the ladder,
  148-154 of v3's 256-268 reviews are ones the answer key says an editor did not need: the
  confidence gate (43-49), the salience check (35-38), the completeness check (28), empty
  required facets (21-24, which go to an editor by design as possible taxonomy gaps), and the
  new rung (11-15).
- **The confidence gate is now a mild trade-off.** On run 70, lowering the INDUSTRY gate from
  0.70 to 0.60 would let 25 more articles go out, 3 of them silent errors (6.5% to 7.1%);
  raising it to 0.80 would send 48 more to an editor to catch 4.
- **Duplicates are handled almost perfectly**: every run suppressed 33-34 of the 34 duplicates
  and never suppressed a real article, and the harness finds no wrong copy kept (SP-WRONG-PRIMARY)
  and no primary suppressed (SO-PRIMARY-SUPPRESSED). The only misses, B224 in runs 69 and 70,
  had a failed model call and went to a specialist, which the routing ladder checks first.
- **5 articles are silent errors in all three v3 runs** (B299, B413, B424, B427, B460); 22 more
  in some runs only.

## What we changed

### Harness Export node (2026-09-23)

A side branch after the guard emits each article already in the harness's shape: the same
translation as `adapter.js`, plus the routing branch and the article's trap sentence. The
guard's own items carry the whole vocabulary, which made a run slow to pull; the export is
about 15 KB per 24-article run.

### Golden 500 test copy (2026-09-29)

In a test copy of the workflow, scored on the Golden 500; the demo workflow is unchanged.

- **Model calls two at a time**, two seconds apart. Two 500-record runs at once hit the
  account's concurrency limit, and because the request node never raises an error, a refused
  call was not retried: it failed safe to a person (run 66).
- **v2 prompt**: the rule against tagging broader terms now says what a broader term is, and
  two new rules say when a regulation (SUBJ-REG) or litigation (SUBJ-LIT) subject is tagged
  beside the main one. The company note for Elevance (formerly Anthem) says it is filed under
  both health and insurance; without it the model set IND-HEALTH aside.
- **v3 guard**: a new rung on the routing ladder, after salience, sends an article to an editor
  when the model proposed a code at 0.40 or more that the 0.60 floor set aside. In v2, 13 of
  the 27 silent errors were codes of that kind. The 0.40 was chosen on half the articles and
  checked on the other half (above).

## What's left

- **Reviews**: more than half of v3's reviews are ones an editor did not need. The confidence
  gate and the salience check send the most; the gate's trade-off is measured above.
- **5 articles are silent errors in every v3 run** (B299, B413, B424, B427, B460): the next
  place to look.
- **Per-trap results** need short trap categories in the answer key (`trap_types: [...]`)
  beside the trap sentence, which is prose.
- **A correct route per article** in the answer key would let silent omissions and route types
  be measured; duplicates are now measured through `duplicate_of`.
- **The guard should emit its routing branch itself**: the export derives it from the reason's
  wording, so a reworded reason stops the run.
- **The floor what-if** re-admits or sets aside values, but does not re-apply this workflow's
  cap of 4 proposed values per facet or re-add broader terms. Articles whose route could depend
  on those are marked "needs replay" rather than guessed.
