# Answer key review: compliance reviewer

Prompt v2 names more violation codes per document than the v1 answer key lists. On
2026-09-23 the workflow's owner decided these are **gaps in the key**, to be noted here and
added to answer keys. Every candidate below comes from `wfeval variance`'s "possible key
gaps": codes stated in **every one** of the four prompt v2 runs (executions 56-59) that the
key does not list.

```
node bin/wfeval.js variance --config examples/compliance-reviewer/config.json \
  --key examples/compliance-reviewer/runs/exec-56.harness.json examples/compliance-reviewer/runs/exec-5{6,7,8,9}.harness.json
```

Consistency alone does not make a code right (trap I7: the same mistake can repeat every
run), so each one was read against the copy. The rule used: **add** a code when it names a
different rule from the codes the key already lists; **don't add** it when it restates a code
already in the key under its "implied" twin (the same words counted twice); **ask** when the
reading is arguable.

## Added to the key (key v2)

| doc | the copy at issue | added | model confidence, 4 runs |
|---|---|---|---|
| E02 | "call the team that wins" | IMPLIED_GUARANTEE | 0.85 every run (below Florida's 0.90, so never applied) |
| E15 | "Our track record speaks for itself" | RESULTS_NO_DISCLAIMER | 0.80-0.85 |
| E16 | "Charges tend not to survive our cross-examination" | RESULTS_NO_DISCLAIMER | 0.75-0.85 |
| E17 | "Every client ... is still here with their family today" | STATISTIC_NO_CONTEXT | 0.85-0.90 |
| E19 | "walk out of court with the parenting time they asked for" | RESULTS_NO_DISCLAIMER | 0.90-0.95 |
| E20 | "No other firm in the city handles retaliation claims the way we do. Others settle; we litigate." | UNVERIFIABLE_COMPARISON | 0.92 |
| E21 | "you are settling for less than your case is worth" | IMPLIED_GUARANTEE | 0.85-0.90 |
| E22 | "Most estate planning attorneys use templates. We do not." | IMPLIED_SUPERIORITY | 0.80-0.85 |

E20 and E22 show the two comparison codes overlap: the v1 key lists both on E21, and on E20
and E22 the key and the model each picked the other one.

Where the change lives:
- `key.json` in this folder: the key the harness scores against (all 40 documents)
- n8n: the node **Answer Key v2 Additions**, right after the eval set, adds the same 8 as a
  dated amendment. The eval set itself is unchanged, so the v1 key stays readable.

## Not gaps: the same rule counted twice

| doc | stated every run | why not added |
|---|---|---|
| E03, E04 | IMPLIED_SUPERIORITY | "premier" and "top-rated" are the superlatives the key already lists as SUPERLATIVE |
| E09, E10, E11 | IMPLIED_GUARANTEE | the explicit GUARANTEE is already in the key, and the prompt tells the model not to re-report it |
| E08 | SPECIALIST | from the regex layer; the key's more specific SPECIALIST_CERT_UNNAMED covers it (a certified specialist may say so once the certifier is named) |
| E13 | FL_PREFILING_REVIEW | an advisory process flag (Florida's pre-publication review), not a violation |

These are what prompt v2 still costs in precision. They change no route: every one is on
copy that is blocked anyway. A later prompt change could target them ("do not re-code a
violation the deterministic layer already names").

## Borderline: the owner's call

| doc | stated every run | the case for | the case against |
|---|---|---|---|
| E04 | AWARD_CLAIM_REVIEW (0.85-0.90) | "top-rated" implies a rating, and names no rater | same words as the SUPERLATIVE already in the key |
| E06 | RESULTS_NO_DISCLAIMER (0.72-0.75) | "guided thousands of families through the naturalization process" implies outcomes | it states volume, not results |
| E11 | STATISTIC_NO_CONTEXT (0.75-0.85) | "we do not lose" claims a perfect record with no context | same words as the GUARANTEE already in the key |
| E16 | IMPLIED_SUPERIORITY (0.75) | "prosecutors know what is coming" | the model rates it only "probably", and never applied it |
| E19 | STATISTIC_NO_CONTEXT (0.75-0.80) | implies every client gets the parenting time asked for | overlaps the RESULTS_NO_DISCLAIMER just added |
| E20 | IMPLIED_GUARANTEE (0.55-0.65) | "Others settle; we litigate" as a promised approach | the model itself rates it arguable |
| E22 | IMPLIED_GUARANTEE (0.75-0.85) | "That difference shows up when the will is contested" | an implied benefit, not a promised outcome |
| E23, E25 | RESULTS_NO_DISCLAIMER (0.75-0.90) | testimonials describing results ("way more than I expected", "saved my family a fortune") | TESTIMONIAL_NO_DISCLAIMER's own definition already covers "implying typical results" |
| E39 | RESULTS_NO_DISCLAIMER (0.80-0.85) | a statistic about case outcomes | STATISTIC_NO_CONTEXT is already in the key, and "resolve" is not "win" |

To add one: put it in `key.json` and in the n8n node, and move its row to the first table.

## What key v2 changes

Routes: nothing. Every amended document was already a violation, and routes are judged on
the verdict (`wrong_when: gold_route`). Codes, over runs 50-52 (prompt v1) and 56-59
(prompt v2):

| | v1 key | key v2 |
|---|---|---|
| prompt v1: precision | 80.0-89.7% | 89.3-90.0% |
| prompt v1: recall | 77.4-83.9% | 64.1-69.2% |
| prompt v2: precision | 65.9-72.5% | 81.8-87.5% |
| prompt v2: recall | 90.3-93.5% | 87.2-92.3% |
| F1, prompt v1 vs v2 | | 0.746-0.783 vs 0.850-0.889, beyond noise |

With the v1 key, prompt v2 looked 10-20 points less precise. Most of that was the key, not
the model: the codes it "invented" were real violations the key had not listed.

**For every answer key**: list every rule a piece of content breaks, not only the headline
one. A key that lists one code per document scores a thorough model as a careless one.
