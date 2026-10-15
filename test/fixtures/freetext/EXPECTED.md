# Free-text fixture: hand-worked answers

Three synthetic home visits, shaped like the assessment template workflow: a model fills an
assessment form from the transcript of a visit. Five free-text fields per form, in three
sections. Nothing here was produced by a model; the transcripts, forms and grades were all
written by hand to exercise each case.

There is no answer key for free text. A person grades each field against the transcript
instead (`wfeval grade` writes the page they do it in), and the grades are scored as labels:
each field is one label out of three.

| Grade | Meaning |
|---|---|
| **faithful** | Everything in the field is supported by the source, and nothing it should hold is left out |
| **invented** | The field says something the source does not support. The serious error: a form that reads plausibly and says something the person never said |
| **missing** | The field leaves out something the source says that belongs in it, and invents nothing |

A field that both invents and leaves something out is graded **invented** (the worse of the
two), with the kind "also leaves something out", so each field has exactly one grade.

## Reviewer A (`grades-a.json`)

| form | type | reason | enjoyed | independence | manage_now |
|---|---|---|---|---|---|
| V1 | faithful | **invented**: a lunch visit nobody asked for, copied from the template's example (figure altered) | faithful | faithful | **missing**: Joan helps with his socks |
| V2 | faithful | **invented**: the daughter's account stated as fact, Mrs Okafor's denial dropped (contradiction smoothed over; also leaves something out) | **invented**: "a nurse"; she worked in the hospital canteen | faithful | faithful |
| V3 | faithful | faithful | faithful | **missing**: looked after his grandchildren every day | faithful |

15 fields graded: faithful 10, invented 3, missing 2.

## Rates (reviewer A)

| | invented | likely range | missing | likely range | faithful |
|---|---|---|---|---|---|
| **All fields** | 3 of 15 = **20.0%** | 7.0-45.2% | 2 of 15 = **13.3%** | 3.7-37.9% | 10 of 15 = 66.7% (41.7-84.8%) |

Per field (3 forms each):

| field | section | invented | missing |
|---|---|---|---|
| type | Is this a | 0 of 3 = 0.0% (0.0-56.2%) | 0 of 3 = 0.0% (0.0-56.2%) |
| reason | Reason for contacting | 2 of 3 = **66.7%** (20.8-93.9%) | 0 of 3 = 0.0% |
| enjoyed | Unique strengths | 1 of 3 = 33.3% (6.1-79.2%) | 0 of 3 = 0.0% |
| independence | Unique strengths | 0 of 3 = 0.0% | 1 of 3 = 33.3% (6.1-79.2%) |
| manage_now | Unique strengths | 0 of 3 = 0.0% | 1 of 3 = 33.3% (6.1-79.2%) |

Per section (pooled over its fields' grades, so a section's rate counts fields, not forms):

| section | grades | invented | missing |
|---|---|---|---|
| Is this a | 3 | 0 of 3 = 0.0% (0.0-56.2%) | 0 of 3 = 0.0% |
| Reason for contacting | 3 | 2 of 3 = 66.7% (20.8-93.9%) | 0 of 3 = 0.0% |
| Unique strengths | 9 | 1 of 9 = **11.1%** (2.0-43.5%) | 2 of 9 = **22.2%** (6.3-54.7%) |

Per form: **forms with at least one invented field** = V1, V2 = 2 of 3 = **66.7%** (20.8-93.9%).
V1 has 1 invented field, V2 has 2, V3 none.

Kinds of invented field: figure altered 1 (V1 reason), contradiction smoothed over 1 (V2
reason), also leaves something out 1 (V2 reason), none given 1 (V2 enjoyed). One invented
field (V2 reason) also leaves something out; it counts as invented only.

Severity: invented is **high** (wrong information in the record), missing **medium**
(incomplete). `--fail-on high` trips on the three invented fields; `--fail-on medium` on all five.

## A second reviewer (`grades-b.json`)

Reviewer B graded the same forms independently and differs on two fields:
V2 enjoyed (A invented, B faithful) and V3 reason (A faithful, B missing).

| A \ B | faithful | invented | missing | A total |
|---|---|---|---|---|
| faithful | 9 | 0 | 1 (V3 reason) | 10 |
| invented | 1 (V2 enjoyed) | 2 | 0 | 3 |
| missing | 0 | 0 | 2 | 2 |
| B total | 10 | 2 | 3 | 15 |

- **Observed agreement** = 13 of 15 = **86.7%** (62.1-96.3%)
- **Agreement expected by chance** = (10×10 + 3×2 + 2×3) / 15² = 112/225 = 0.498
- **Cohen's kappa** = (195/225 - 112/225) / (1 - 112/225) = 83/113 = **0.735**
- **On "invented or not"** (the serious error alone): A says invented 3, B 2; they differ only
  on V2 enjoyed. Observed 14 of 15 = 93.3% (70.2-98.8%); by chance (3×2 + 12×13) / 225 =
  162/225; kappa = (210 - 162) / (225 - 162) = 48/63 = 16/21 = **0.762**

Kappa is 1 for perfect agreement and 0 for agreement no better than chance. With 15 grades it
is a rough guide; the list of disagreements is what a person settles.

If both reviewers gave every field the same single grade, chance agreement is 1 and kappa is
0/0: **not measurable**, never 1 or 0.
