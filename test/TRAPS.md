# Tool traps

Ways the harness itself could quietly compute a wrong number. Each trap gets a
test that fails before the code handles it and passes after.

These test the **harness**, not a workflow. Traps for a workflow (entity
disambiguation, weak-but-correct tags, near-duplicates) belong in that
workflow's golden set and are reported by `trap_field`.

**What the tool does**

| Action | Meaning |
|---|---|
| **STOP** | Refuse to score. Name every offending record. Exit with an error. |
| **FIX** | Clean it up and keep going, but count what was fixed in the report. |
| **WARN** | Keep going unchanged, print a warning in the report. |
| **RULE** | Not bad input; a definition the metric code must get right. |
| **STRICT** | STOP in strict mode (the default: golden sets, fixtures), WARN with `--lenient` (production samples). |

Why two modes: when testing against a golden set, anything odd is a bug to find
and fix, so the tool refuses to continue. When scoring a sample of real production
output, one odd record should not block the whole report, so it warns instead.

## A. Reading files (`load.js`)

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| A1 | File missing or unreadable | Obvious, but the message must say which file | STOP |
| A2 | Not valid JSON | Message must say where it broke (for JSON Lines, which line) | STOP |
| A3 | File starts with an invisible byte-order mark (Windows PowerShell adds one) | `JSON.parse` fails on a file that looks perfect | FIX |
| A4 | Empty file, or `[]` | Every rate becomes "nothing to measure"; better said up front | STOP |
| A5 | The records aren't where expected: the file is an object (an API's `{ "data": { "results": [...] } }`), or `records_at` leads to nothing | Probably wrapped by whatever produced it | STOP, listing where lists were found and naming the `records_at` setting |
| A6 | Every record is inside a wrapper field (n8n: `{ "json": {...} }`; other tools use other names) | The id and every value are one level down | RULE: declared with `unwrap`, never guessed. If the id is inside the same field in every record, STOP once, naming the exact setting to add |
| A7 | Key file passed where predictions belong (no route field) | Scores the key against itself | STOP |
| A8 | Predictions identical to the key | Everything scores 100%; almost always a wrong-file mistake | STOP if one file and the same fields are read as both prediction and answer. WARN if the values are identical and no prediction has a confidence (a real perfect run is possible) |
| A9 | A field literally named `output.subject` next to a nested `output` → `subject` | Two ways to read the same path | RULE: the literal name wins (spreadsheet-style exports flatten nested names that way) |
| A10 | Predictions and answers in the same file | The key's fields sit beside the workflow's | RULE: allowed; outputs name the key's fields with `key_field`; H4 does not apply |

| A11 | CSV: a quoted cell is never closed | Everything after it merges into one cell | STOP, naming the line the quote opened on |
| A12 | CSV: a row with more or fewer cells than the header (usually an unquoted comma inside a value), or a `;`-separated file read as `,`-separated | Values land in the wrong columns | STOP, naming the line, or the `delimiter` setting to change |
| A13 | CSV: a header with an empty or repeated column name | A column can't be addressed, or two claim one name | STOP |
| A14 | CSV cell conventions | A cell only holds text | RULE: `\|` between values, `@` before a confidence (both configurable); an empty set cell means "no values"; a missing column means missing (D1/D2); a value that itself contains `@` needs another `confidence_separator` (otherwise STOP); in the answer key only, `any_of_separator` (off unless set) splits one slot's alternatives: `EP-7 / EP-8` (D20), in every set output's cells (a real value holding it, `TCP/IP`, becomes a slot; a label cell holding it stops, F13) unless `any_of_outputs` names the set outputs it is for |

Formats: JSON (a list of records, or a list inside an object via `records_at`),
JSON Lines (`.jsonl` / `.ndjson`, one record per line) and CSV (`.csv`, `.tsv`).
Nothing is specific to a platform; where things are is declared in the config's
`input` and field settings.

## B. Matching records (`align.js`)

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| B1 | Record has no id | Can't be paired with anything | STOP |
| B2 | Same id twice in predictions | Record counted twice | STOP |
| B3 | Same id twice in key | Which answer is right? | STOP |
| B4 | In predictions, not in key | No answer to grade against | STOP |
| B5 | In key, not in predictions (workflow dropped or crashed on it) | Totals shrink silently: 23 records while you believe it's 24. A record that goes in and never comes out is a workflow bug | STOP, always (both modes) |
| B6 | Files in a different order | A tool that pairs by position grades the wrong records against each other | RULE: pair by id only |
| B7 | id is `1` in one file and `"1"` in the other | Numbers and text don't match in JavaScript | FIX: compare as text |
| B8 | id has stray spaces: `"A01 "` | Looks identical, doesn't match | FIX: trim |
| B9 | id differs by case: `"a01"` vs `"A01"` | Could be a typo or two real records | STOP, with "did you mean" |

## C. Routing values

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| C1 | Route not in the config map (`ESCALATED`) | Record silently belongs to no class | STOP |
| C2 | Route missing or `null` | Same | STOP |
| C3 | Route with different case or spaces: `"auto_publish "` | Guessing could turn a review into an auto-publish | FIX spaces only; case is STOP |
| C4 | Gold route missing on a key record (when grading by gold route) | Can't tell if it was a silent error | STOP |
| C5 | Gold route not in the config map | Same | STOP |
| C6 | Key says duplicate, workflow let it through anyway | The same thing counted twice | RULE: silent publish, type SP-DUPLICATE (see docs/SILENT_ERRORS.md) |
| C7 | Workflow suppressed a record as a duplicate, key says it isn't one | A real record never goes through, nobody told | RULE: silent omission, type SO-FALSE-DUPLICATE |
| C8 | Workflow kept a duplicate and suppressed the primary record it duplicates | The right content went through, from the wrong copy | RULE: SP-WRONG-PRIMARY + SO-PRIMARY-SUPPRESSED; needs `duplicate_of` in the key |
| C9 | Key record marked as a duplicate points at an id that isn't in the key | The duplicate group is broken | STOP |
| C10 | Record where the model call failed (no output at all) | Its empty tags would count as misses and drag recall down for a reason that isn't tagging quality | RULE: counts in routing; excluded from precision/recall and calibration; exempt from E1 (marked `"scored": false`) |
| C11 | Key marks a record as a duplicate, but its correct route doesn't suppress it | The key contradicts itself | STRICT |

## D. Set outputs (codes)

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| D1 | Facet missing from a **prediction** | The model returned nothing for it | FIX: empty set |
| D2 | Facet missing from the **key** | We don't know the right answer, and "empty" would be a guess | STOP |
| D3 | Facet is `null` | Same as missing, on either side | as D1 / D2 |
| D4 | Value given as plain `"SUBJ-MNA"` instead of `{ value, confidence }` | Both shapes are reasonable | FIX: accept both; confidence unknown |
| D5 | Facet is a single string, not a list | Could be one code, or `"A\|B"` packed together | STOP |
| D6 | Same code twice in one facet | Counted twice, inflating TP or FP; also a sign the workflow's de-duplication is broken. Kept once at the higher confidence, an applied 0.4 beside the same code set aside at 0.9 became not applied at all, hiding the weak value that went out | STRICT. In lenient mode: keep once, by the same rule as merged equivalents (D23): applied if either copy was, at the highest applied confidence (the higher, when neither was), with the lowest applied one kept for the floor and a `"weakest"` gate; the warning says which were kept |
| D7 | Stray spaces in a code: `" GEO-US"` | Counted as wrong when it's right | FIX: trim |
| D8 | Code differs by case: `"geo-us"` vs `"GEO-US"` | Is it the same code? | RULE: different codes, so it counts as wrong (allowed-value lists are exact); plus STRICT with the near-match named |
| D9 | Empty code `""` | Counted as a false positive | STOP |
| D10 | `"applied": false` | Must not count as predicted | RULE: excluded from precision/recall, kept for calibration and what-if |
| D11 | `applied` missing | Most exports won't include it | FIX: treat as applied |
| D12 | `"applied": "false"` (text, not true/false) | In JavaScript the text "false" counts as **true**, so a rejected tag gets counted as applied | STOP |
| D13 | Order differs: `["A","B"]` vs `["B","A"]` | A naive comparison says they differ | RULE: sets ignore order |
| D14 | Empty prediction and empty key for a facet | Correct, but there is nothing to count | RULE: exact match; adds no TP/FP/FN |
| D15 | Extra fields on records (evidence, notes, cost) | Normal in real exports | RULE: ignored |
| D16 | A facet in the files but not in the config | Probably intentional | RULE: ignored |
| D17 | `inherited_from` on a value | Copies another tag's confidence; not a separate claim by the model | RULE: counts in precision/recall, excluded from calibration and from "proposed by model" counts |
| D19 | A value in the `rejected_field` list marked `"applied": true` | Contradicts itself | STOP |
| D18 | Broader terms added on one side only (predictions rolled up to ancestors, key not, or the reverse) | Every ancestor shows up as a false positive or false negative | STRICT when a value hierarchy is given: check both sides are closed under the same ancestors |
| D20 | Several values are each right (any one of three episodes that cover the point), written in the key as `{ "any_of": ["a", "b", "c"] }` | Listing all three counts two as missed whenever one is cited; listing one counts the others as wrong. Projects rewrote the key before every run to dodge it | RULE: one slot, filled when any of its values is applied. Each applied value in a slot is a TP (two from one slot are both right); each unfilled slot is one FN, shown as `one of a, b, c`, or `b (one of a, b, c)` when b was found but set aside (SP-MISSING-REJECTED). Resolved per record, from what was applied, by every metric alike (`src/metrics/slots.js`), so the floor what-if re-resolves at each floor. Values trimmed like plain ones (D7, D9). `test/fixtures/alternatives/` |
| D21 | A bad any_of: `{ "any_of": [] }`, a value inside it that is not text (`7`, `{ "value": "a" }`, a list), anything beside `any_of` in the object, or any_of in a **prediction** | An empty slot can never be filled; an object inside has no one value; a key beside it would be ignored; a prediction lists what was given, not alternatives | STOP, naming the record. A misspelled `anyOf` stops as D4 with "did you mean any_of" |
| D22 | One value in two slots of one record (`["a", { "any_of": ["a", "b"] }]`, or two any_of lists sharing a value) | Counting is still defined (the value fills each slot it is in), but which slot the key meant it for is not: usually a key mistake | STRICT. In lenient mode: kept, and counted by the D20 rules |
| D23 | One thing under two names: an episode re-released as `ep-12-rerun`, a code and its alias (`equivalents` in the config) | Counted as different values: one right, one wrong; both in one prediction, one value counted twice | FIX: every value of a group is read as the group's first, on both sides and in allowed lists, and the report says which were read and how often. Two that become one value in a record are merged ("merged 2 equivalent values", saying which confidences were kept): applied if either was; the confidence kept is the highest applied copy's, never one the workflow did not apply (the higher, when neither was applied); when applied copies differ, the lowest is kept too, for the floor and a `"weakest"` gate. A merge never hides a weak value that was applied: an applied 0.4 beside a 0.9 set aside stays 0.4, and SG-GATE and SG-FLOOR fire as they would without equivalents. The same text twice is still D6. In the config, a value in two groups, a group of one, an unknown output, a label group whose first value is not a label, or the route's own output: STOP (config error) |

## E. Confidence values

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| E1 | Confidence missing on an applied value | Can't be gated or calibrated | FIX: unknown; STRICT if on a gated facet |
| E2 | Confidence as text `"0.85"` | Text is compared letter by letter, so `".9"` sorts below `"0.85"`; and adding text glues it together: `"0.8" + "0.9"` is `"0.80.9"`, not 1.7. Works in some places, breaks in others, with no error | STOP |
| E3 | Percent instead of fraction: `85` | Every tag clears every gate | STOP |
| E4 | Negative, above 1, or not a number | Meaningless | STOP |
| E5 | Exactly on the threshold: `0.85` vs gate `0.85` | Off-by-one at the most important number | RULE: at or above passes |
| E6 | Confidence on answer-key values | Leftover from copying predictions into the key | RULE: ignored |
| E7 | Decimal comma: `0,95` (European spreadsheets) | Misread, or read as two values | STOP, showing `0.95` |
| E8 | A label's confidence given twice: with the label and in its `confidence_field` | Which one is right? | STOP |
| E9 | A gate picked from many as if it had been tested alone: the loosest gate in a what-if sweep whose rate, or likely range, looks under the target | A sweep of eleven gates gives eleven chances for one to look good by luck, so the golden set flatters the gate picked from it (multiple comparisons): twenty keys tried and the one that opened the lock announced. In the gate fixture, against 30%, 0.65's rate (28.6%) and 0.75's likely range (up to 25.6%) look under; neither is certified | RULE: `whatif --gate --target` tests each gate on its own records out without review, p = P(Bin(n, target) <= k) exact, and certifies it only when p <= (1 - confidence) / the gates tried (Bonferroni; Learn then Test, Angelopoulos et al. 2021), so the chance that any certified gate is really at or above the target is at most 1 - confidence. Nothing out: p = 1, never certified. It names the loosest certified gate (on a tie, the strictest), a looser gate that only looks under read alone, and with none certified, the fewest records out a gate would need; it says the guarantee is for records like these and rests on the what-if's assumption about which records move. `test/fixtures/gate/` |
| E10 | A policies file (`whatif --policies`) that cannot be read, is not JSON, or is not `{ "policies": [ ... ] }` with at least one policy | Nothing to compare, and a half-read file would compare fewer policies than were written | STOP. `test/fixtures/policy/` |
| E11 | A policy with no name, a name that is not text, a name used twice or "as run" (in any case), or no rule at all (no `hold_if`, `auto_publish` or `auto_publish_cap`) | Two rows with one name cannot be told apart; a policy with no rule is the run as it was, counted twice, and every policy tried makes certification stricter | STOP |
| E12 | A misspelt key (`confidence_atleast`), a field condition with no comparison or two, a value that is not the right kind, `"all"` beside other clauses, or `"*"` inside a list of values. On the command line: `<=`, `>` or `==`, or an operator inside a value | An unknown key would be ignored, so the condition would hold far more records than meant (`confidence_atleast: 0.85` read as "any value"); `field:client==north` would look for the client "=north" | STOP, naming the key and the keys allowed, or saying to use `<` or `>=` |
| E13 | A condition on an output the config does not declare, on the output that is the route, or on the route's own field (`routing.field`); a threshold change for an output with no `auto_publish` gate. A hold-if policy for a workflow with no review route | A condition on nothing holds nothing, and the row would look like a policy that changed nothing; the route field holds the route as run, not the route under the policy. A workflow with no review route has nowhere to send a held record | STOP; WARN for no review route |
| E14 | A hold-if value that no record states for that output and that no `allowed_values` list or declared label has (`AWARD` for `AWARD_CLAIM_REVIEW`); an `equals` or `in` value no record's field has (`nort`) | Probably misspelt: the condition holds nothing for it and the row reads as "this policy fixes nothing". Values are read through `equivalents` first (D23), so an old name is not a misspelling | STRICT, once in each policy it affects |
| E15 | A field condition on a field no record has (misspelt) or that some records lack | Records without the field are never held by it, so the policy looks weaker, or (none have it) does nothing at all | STOP when no record has it; STRICT when some lack it, naming them |
| E16 | `below` or `at_least` on a field that holds text (`"low"`) on some records | Text compared with a number is false either way, so those records are silently never held. A number written as text (a CSV's `"0.4"`) is read as the number | STRICT, naming the records |
| E17 | A field condition that reads the answer key: the correct route, the key's codes, the trap label; or a field a key-side group or cluster reads that no prediction has, or any such field when the predictions and the key are one file (same name or same content) | In a file that carries the key beside the predictions, "hold if the key says review" would score a perfect policy no workflow could run. A field the predictions also have in a file of their own (a ticket's channel) is the workflow's own, and is read from the prediction; in one combined file every record carries the key's fields, so there it is the key's | STOP: a routing policy can only use what the workflow knew. For a group or cluster field, the message names `groups.<name>.from: "predictions"`, for when the workflow saw it |
| E18 | A record's own gate threshold (`thresholds.auto_publish` naming a field) that is missing, not a number, or outside 0 to 1 (the message gives the value, and for 85 suggests 0.85), on a record the gate could route (out without review or sent to a person, with a model answer); a number written as text; a threshold below `thresholds.floor`. In the config, `"0.8"` in quotes | A gate with no threshold cannot be checked: SG-GATE and the what-ifs would quietly skip the record. `"0.8"` in the config would be read as a field named "0.8". A gate below the floor never decides anything | STRICT; with `--lenient` the record's gate is unknown: never an SG-GATE, left where it was by the what-ifs, and listed by the gate check as not checked. FIX: numeric text read as the number (a CSV's cells need no note). WARN below the floor. STOP for a quoted number in the config |
| E19 | `confidence_at_least` on an output whose values never carry a confidence in this run; `applied: false` (`.unapplied`) on an output with no value stated but not applied (a label, or a set with nothing set aside). A policy that holds and moves no record at all | No value can meet the clause, so the condition holds nothing (a value with no confidence never meets `confidence_at_least`), and the row reads as a policy that fixes nothing | STRICT for the clauses; the report names a policy that holds and moves nothing |

## F. Label outputs (pass / elevate / fail)

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| F1 | Label not in the declared list: `"Pass"`, `"elevate "` | Becomes a class nobody reports on | FIX spaces; otherwise STOP |
| F2 | Label given as a list | Label outputs hold exactly one value | STOP |
| F3 | Label missing on a prediction | No verdict was made | STOP |
| F4 | Label missing on the key | No right answer | STOP |
| F13 | `{ "any_of": [...] }` as a label (either side) | A label has one answer per record, and the confusion matrix needs one key label per row: which row would "pass or elevate" go in? | STOP: any_of is for set outputs. Two names for one label are `equivalents` (D23) |

**Declines** (`outputs.<name>.decline`: the workflow may decline to answer)

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| F5 | A decline value that is also a label, or a label spelled `(declined)` (what the harness reads a decline as) | One value would mean both "this answer" and "no answer" | STOP (config error) |
| F6 | Label missing on a prediction, in a config with declines | Reading "nothing" as "declined" is a guess: it may be a crash or an export bug | RULE: still F3 (STOP) unless the decline field is `true`; a missing label is never a decline by default |
| F7 | Decline field as text: `"declined": "false"` | The text "false" counts as true in JavaScript, so every record would read as declined | STOP |
| F8 | A decline counted as a wrong label, or dropped from the counts | As wrong, a workflow that declines honestly looks worse than one that guesses; dropped, a workflow that declines everything hard looks perfect | RULE: accuracy is on what was answered, and coverage, the decline rate, unnecessary declines and answers that should have been declines are always reported beside it. Per label, a decline is a miss for recall and never a false positive. Calibration leaves declines out (they claim nothing) |
| F9 | A label beside a decline field that is `true` (`"category": "news", "declined": true`) | Is it an answer or not? | RULE: declined; the label is kept as "set aside" for the report and never counted as an answer |
| F10 | Decline value with different case or spaces: `"None "` | Same as F1 | FIX spaces; case is STOP with "did you mean" |
| F11 | "Answers that should have been declines" when the answer key cannot say decline (only `decline.field`, no `decline.values`) | 0% would claim the workflow never answers when it should not | RULE: "not measured", never 0 |
| F12 | Declines without a correct route: the silent omission rate has no "should have gone out" to count against | A rate with a guessed denominator | RULE: without `routing.gold_field`, only SO-DECLINED is counted, out of the records whose key has an answer for a declining output; every other omission type is "not measured" |

## G. Arithmetic (metric code, Day 1-2)

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| G1 | No auto-published records | Silent error rate is 0 / 0: "nothing to measure", not "0% errors" | RULE: null, and the report says why |
| G2 | No records sent for review | Same, for review-queue precision | RULE: null |
| G3 | A facet with nothing predicted and nothing expected anywhere | Precision and recall are 0 / 0 | RULE: null, never NaN |
| G4 | Precision 0, recall above 0 | Some code (including run 49's scorecard) returns null here; the correct F1 is 0 | RULE: F1 = 0 |
| G5 | All records excluded | Nothing left to score | RULE: every rate null; report says why |
| G6 | Rounding before dividing | Small errors compound | RULE: compute from raw counts; round only for display. The design effect and the effective records (clusters, `--mix`) are kept as worked out in the results and JSON, and rounded once, in the line: 5.4598 records' worth is "about 5", where rounding to 5.5 first gave "about 6" |
| G7 | Straight-through denominator | Must include excluded records (your choice) | RULE: all records |
| G8 | Silent error with a small base: 0/7 | Looks perfect, could be 35% | RULE: every rate shows its range |
| G10 | Fixed-width calibration buckets: in binary, 0.7 / 0.1 is 6.9999…, so 0.7 lands in the 0.6–0.7 bucket | Every value on a bucket edge is misfiled, and models love round numbers | RULE: nudge before rounding down; 1.0 joins the top bucket |
| G11 | Totals that match while records don't: two misroutes in opposite directions | "routed" and "should be" counts agree, and nothing looks wrong | RULE: every metric is computed record by record, from the pairs |
| G9 | Comparing two different populations (run 4's negative rejection rate: applied included inherited, proposed did not) | Impossible numbers, or worse, plausible wrong ones | RULE: every ratio's top and bottom count the same kind of thing |
| G12 | A record the answer key blocks or suppresses, sent to a person (an email the key files, put on the owner's to-do list) | It must not go out, so it "needed a person" in the silent-error sense; counted that way in review precision, a queue padded with records nobody should have seen looks precise | RULE: review precision counts it as an unnecessary review, whatever its values, and the reports say the answer key leaves it out. Letting it out unseen is still a silent error (SP-FORBIDDEN, SP-DUPLICATE). `test/fixtures/queue/` |
| G13 | "How many records to show it is under 5%?" | Done by hand, people take the break-even size (where the observed rate's range just clears the target), which a fresh test lands under only about half the time; or they keep testing until the range dips under the target and stop, which makes the range too optimistic | RULE: `--target` and `wfeval rate` give the plan (records for an 80% chance, exact binomial) and the hard minimum (a perfect run), the same as error-rate-calculator; no plan when the rate is already at or above the target; the report says to fix the number before testing |
| G14 | Records that come in clusters counted as independent within one run: retellings of one news story, one filing's statements (in one filing they share a unit and fail together) | Ten records from one clump are not ten independent pieces of evidence, so the likely range comes out too narrow (the design effect, as I8 across runs; Kish 1965). In the clusters fixture, three wrong retellings of one story and one more error give 13.8-60.9% counted as independent records, 9.9-69.4% counted by story | RULE: with `clusters` in the config (or `score --cluster-by`), `score` adds one line under the headline, terminal and HTML, and `results.clusters`: the silent error rate's range counting clusters (cluster-robust variance of the ratio over the clusters with records out without review, the design effect against p(1-p)/(n-1), so that records each a cluster of their own give exactly 1, not n/(n-1); effective records = records / design effect, Wilson at that many; Miller 2024, Eq. 4). A record with no value is a cluster of its own, and the report says how many were. The headline range stays as it is; per-group rows and `--target` still count records as independent, and the reports say so beside them. `test/fixtures/clusters/` |
| G15 | A list (or an object) as a cluster value; in a CSV, a cluster cell holding the list separator (`A \| B`) | A record in two clusters would count twice, or its clusters would be merged by guesswork; an object has no value to show. Read as text, a CSV's `A\|B` would be a third cluster named "A\|B" | STOP, naming the record, in lenient mode too; a list stops even with one value; for an object, the message suggests a field inside it. A CSV cluster cell is split on `list_separator`, so it stops as a list does in JSON; a cell without the separator is one value |
| G16 | No silent errors, nothing but silent errors, a single cluster, or every silent error in one cluster (or every record without one) | The design effect is 0 / 0, or there is no spread between clusters, or a single clump with nothing to compare it with: nothing shows how far a cluster's records go together. A formula that fell back to 1 would claim every record is independent; and one wrong record looks like no clumping, so worked out as a design effect, a first silent error narrowed the range: in the clusters fixture, 1 error reached 35.4%, below the 47.6% of none. One record per cluster is not the worst case either when clusters differ in size: a cluster of 4 is one outcome with four times the weight of a cluster of 1 | RULE: each cluster's records are taken to go right or wrong together, the cautious choice (method `clusters_together`), worth Kish's (sum n_c)^2 / sum n_c^2 records: the number of clusters when they are the same size, fewer when not (144 / 34 = 4.24 for the fixture's 4, 3, 2, 2 and 1). The report and `why` say which case it was: 0 of 12 records reaches 47.6%, not the 24.3% of 12 independent records; 1 of 12 reaches 55.6%. While every silent error sits in one cluster, one more never lowers the range's top |
| G17 | Clusters that vary less than independent records would (errors spread one per story) | The two variances' ratio falls below 1 (0.32 in the clusters fixture): taken as it is, the clustered range would come out narrower than counting every record | RULE: the design effect is floored at 1, so the range never claims more evidence than the records themselves |
| G18 | A stress-test rate read as the production rate: the silent error rate of a golden set built from traps quoted as what real traffic would see | The set holds far more hard records than real traffic, and no range says how far off that is. In the clusters fixture every mistake is in business news, 8 of its 15 records: 25.0% on the golden set, about 5.1% on a mix that is 90% general news | RULE: `score --mix <file>` (`{ "group": "<group>", "shares": { "<label>": <share> } }`; fractions, percentages or counts, divided by their total) weights each label of one group by its share of real traffic: the combined ratio estimate (Cochran 1977, ch. 5-6), R = sum W_h s_h / N_h over sum W_h a_h / N_h, and its Wilson range over Kish's effective number of records out without review, each weighing W_h / N_h (Kish 1965), with the weighted straight-through beside it. Lines under the headline, terminal and HTML, say it is a reweighting, not a measurement, beside the golden set's rate; `results.mix` in the JSON. The headline and the group rows stay as they are. Nothing out on the mix: no rate, and the report says why (G1); a group with a share that sent nothing out gets a note. A mix file whose group is not one of the run's, or whose shares are text, negative, all 0, or too big to add up (their total is Infinity, so every weight would be 0): STOP, in lenient mode too. With the golden set's own counts as shares, the rate and range come back as the headline's exactly. `test/fixtures/clusters/` |
| G19 | A group of the run with no share in the mix, "(none)" (records with no label) included | Left out, the estimate is for a mix nobody described; given a weight the tool guessed, it is the tool's mix, not the user's | STOP, naming the label, or each record with no label when "(none)" has no share, in lenient mode too. A share of 0 is allowed: it says real traffic has none |
| G20 | A share for a label the run does not have: a kind of record the golden set never tested, or a typo | Its records were never tested, so nothing can be said about them; dropping its share quietly would estimate a different mix from the one given | STOP, naming the label, even at a share of 0, in lenient mode too; "did you mean" for a label that differs in case or spaces |
| G21 | A record in two groups of the mix (the queue fixture's Q10 came in by chat and by email) | Weighted in each group, its weight counts twice; weighted in one, which one is a guess | STOP, naming the record, in lenient mode too. The per-group rows still count it in each (H7). `test/fixtures/queue/` |

## H. Traps inside the trap labels and group labels

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| H1 | Record with no trap label | Dropped from the per-trap table; totals stop adding up | RULE: grouped as "(none)" |
| H2 | Trap name typo: `entity-disambig` vs `entity-disambiguation` | Splits one trap type into two small groups | Caught by H5 |
| H3 | Record with several traps (e.g. a duplicate that also has a weak-but-correct value) | Which group does it count in? | RULE: the trap field may be a list; the record counts in each group; the table notes that group totals can exceed the record count |
| H4 | Trap field present on **predictions** | The workflow may have seen what it was being tested on | STRICT, except for a combined format (the config reads the key from other fields than the predictions), where the key sits in each record by design |
| H5 | A trap type with too few records (below `min_per_trap`, e.g. 3) | One record passing can be luck; it proves nothing about the trap | STRICT. The report always lists every trap type with its count |
| H6 | A group's rate read alone, without its count and range ("chat: 100% silent errors, email: 0%") | A group holds a fraction of the records, so one record swings its rate: in the queue fixture both rates come from one record each, and their ranges overlap from 20.7% to 79.3% | RULE: every group rate carries its count and likely range, in every report, and the reports say to compare the ranges, not the percentages. `test/fixtures/queue/` |
| H7 | A group value that is a list (a message that came in by chat and by email) | Counted in one group, it vanishes from the other; counted in each, the rows add up to more than the records and look like extra evidence | RULE: as H3, the record counts in each group, and the report says how many records carry several labels and that the rows add up to more than the records. A label listed twice counts once |
| H8 | An object as a group value (`{ "value": "chat", "confidence": 0.9 }`, or one inside a list) | There is no label to show; as text every such record would read "[object Object]" and pool into one group | STOP, naming the record and the group, and suggesting a field inside the object (`"channel.value"`) |

Groups (`groups` in the config, `score --group-by`) otherwise follow the trap labels' rules: a
record with no label is grouped as "(none)" (H1), shown last; a number or true/false is read
as text, so a spreadsheet's `7` and a JSON `7` are one group.

## I. Multiple runs (Day 3)

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| I1 | Only one run given to `variance` | Spread of one number is meaningless | STOP |
| I2 | Runs cover different record sets | Differences may come from different records, not different behavior | STOP |
| I3 | The same file passed twice | Makes the runs look more stable than they are | WARN |
| I4 | `compare` given runs scored with different configs | Changes caused by the config look like changes in the workflow | STOP |
| I5 | A difference smaller than run-to-run noise | Looks like progress | RULE: `compare` says "within noise" when a variance baseline exists |
| I6 | A run where model calls failed (rate limits, several runs started at once) | Every failed record goes to a person, so the run measures the failures, not the workflow | WARN, naming the run; `model calls failed` is tracked as a metric |
| I7 | A value the model states in every run that the key does not list | Consistency is not correctness: it may be the same mistake every time (the tiny fixture's R2 states the wrong SUBJ-ANTI in all three runs), or a gap in the key. Adding it to the key automatically would fit the key to the model | RULE: `variance` (and `score`, from one run: I16) lists these as possible key gaps for a person to decide; the key is never changed by the tool. It applies a person's recorded rulings, and says so (I11) |
| I8 | Repeated runs of the same records added together ("44 of 615" from three runs that sent out 254 different articles) | A record's runs tend to go the same way, so the added-up count looks like more independent records than there are, and its likely range is too narrow (the design effect; Kish 1965): 5.4-9.5% added up, against 5.5-13.1% for the worst run alone. In the tiny fixture, 6 records out across three runs are only R1, R2 and R4 | RULE: `variance` never adds runs up. It names the worst run, with its likely range, as the figure to quote (highest rate as an exact fraction; on a tie, the wider range), and counts how many different records the runs' totals are |
| I9 | `compare` without repeated runs (each run of the workflow costs money, or the change is a deterministic replay with no noise at all) | Every rate says "no noise baseline", even for a change that fixed 12 records and broke none; or worse, two rates are compared as if they came from different records | RULE: `compare` always counts, outcome by outcome, the records the change fixed and broke on the same records, with Tango's paired range (its verdict agrees with McNemar's test). Noise flips records both ways alike, so this needs no repeated runs. Counts, not rates: a rate's base moves when routes move. `test/fixtures/queue/` |
| I10 | A value stated in every run that is an alternative of an any_of slot (D20), applied or set aside | Listed as a possible key gap, it asks a person to add to the key what the key already says is right | RULE: an alternative is in the key, so it is never a key-gap candidate. `test/fixtures/alternatives/` |
| I11 | A person's rulings on possible key gaps kept by hand (a table in a notes file, a hand-edited copy of the key) | A rejected value is listed again on every run; an added one changes the key where no report shows it, so a reader takes the scores for the key file's | RULE: `--rulings <file>` on `score`, `variance` and `compare`. **add**: the value joins that record's key as a plain value (one more slot to fill), for scoring only; every report (terminal, JSON, and HTML when given) says how many values the rulings added, which, and from which file. The tool never edits a key file. **reject**: the value stays wrong and is never listed as a possible key gap again; it is counted ("1 ruled not a gap"). **pending**: scored as wrong (the strict reading). Ruling values are read as the key's are: trimmed (D7) and through `equivalents` (D23). `test/fixtures/rulings/` |
| I12 | A rulings file the tool cannot read as rulings: not `{ "rulings": [...] }`, an entry that is not an object, a missing `id`, `output` or `value`, an unknown key (`"notes"`), `by`/`on`/`note` that are not text, an unknown ruling (`"accept"`, `"Add"`), an output that is not a set output, the same (id, output, value) twice (an alias and its value included) | A guess at what a ruling means changes the key; two rulings on one value may disagree | STOP, naming the entry, with "did you mean" for a ruling's case |
| I13 | A ruling with no `by` or `on`; a ruling for a record not in the answer key; an `add` for a value outside the output's `allowed_values` | An untraceable ruling is what the file exists to replace; an unknown id is a ruling for another key or a typo; a misspelled add would put a value in the key that nothing can fill, and every run would then miss it | STRICT. With `--lenient`, a ruling for an unknown record or a value not allowed is set aside, and one without `by` or `on` still applies |
| I14 | A ruling for a value the answer key already accepts: a plain value, an alternative of an any_of slot (D20), or an equivalent of either | An add changes nothing; a reject would contradict the key, and a ruling never changes the key | WARN; the ruling is set aside and counted |
| I15 | Pending rulings folded into one number | Counted as wrong, the silent error rate may be too high; counted as right, too low; either way it looks settled | RULE: `score` adds one line under the headline: the silent error rate if every pending ruling were an add (scored again with pending as add, with its count and likely range), beside the strict one. It is a bracket when this run applied every pending value: adding an applied value can only clear an error, and the base does not depend on the key. A pending value the run did not apply would be a miss once added, so the line names how many and says the two are then not a bracket |
| I16 | Possible key gaps only from repeated runs | Repeated runs cost money, so projects listed them from one run by hand | RULE: `score` lists the applied values the key does not list, with `variance`'s exclusions (allowed values, inherited values, suppressed duplicates, failed model calls; I10). Each is marked with the silent error it sits on, if any, and whether adding every gap listed on that record would clear it (a key that routes the record to a person keeps it one). With rulings: pending or unruled, rejected ones counted not listed. Terminal (12 rows, like the other lists) and JSON only; not in the HTML report |
| I17 | One run compared against two answer keys that cover different records, or two different runs against two keys | A change could come from a record one key lacks; with two runs, from the workflow rather than the key | `compare --after-key`: STOP if the keys do not cover the same record ids (checked before either meets a run). Two different runs: WARN, each change mixes the workflow's and the key's. The same run: every rate's change is labelled "from the key", and the paired counts say which records the new key fixed and broke. `--noise` does not go with two keys |
| I18 | The records that were a silent error in at least one of several runs, quoted without the number of runs, or read as one run's rate | A record counted once stays counted whatever later runs do, so the count only grows as runs are added: a count of records means nothing without its number of runs. Read as one run's rate, it overstates how bad one run is | RULE: `variance` gives the different records that were a silent error in at least one run, of the different records out without review in at least one, with the share's likely range, always in a sentence that names the number of runs, and says it answers "how many records can this workflow get wrong unseen, at least sometimes?" while the worst run answers "how bad is one run?". In the runs fixture: R2 (silent in runs a and c) of R1, R2 and R4, 1 of 3 over 3 runs; 1 of 2 over runs a and b |
| I19 | A release gate that reads `compare`'s paired verdicts: one that fails on "unclear", or one that names an outcome the run does not measure | Failing on "unclear" fails nearly every small change, so the gate gets switched off; a named outcome with no PAIRED row (silent omissions without a correct route or a decline) is silently skipped, and the build passes an outcome nobody checked | RULE: `compare --fail-if-worse <outcomes>` (silent-errors, silent-omissions, unnecessary-reviews, misroutes, or any) exits 3 only on "worse", which already needs the broken records to outnumber the fixed beyond chance; it names each outcome with its fixed and broken counts. STOP (exit 1, before the report) on a named outcome not measured, and on an unknown name, listing the valid ones. `any` reads every outcome measured. With `--after-key` too. The queue fixture swapped (after as before): unnecessary reviews fixed 0, broke 5, worse; silent errors 1 and 1, unclear |

## J. Free text graded by a person (`wfeval grade`, `wfeval score --grades`)

A free-text field has no answer key; a reviewer grades each field faithful, invented or
missing against its source, and the grades are scored as labels. These traps are about
reading the forms, the page, and the grades file. The harness never grades anything itself:
no model, no network.

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| J1 | A file passed as grades that is not one the grading page saved (another JSON, a hand-edited file missing its lists) | Scores something that is not grades | STOP |
| J2 | A grade other than faithful / invented / missing: `"Invented"`, `"unsure"`, `" faithful "` | A grade nobody reports on, or a guess at what was meant | FIX spaces; otherwise STOP, with "did you mean" for case (grades are labels, F1) |
| J3 | A grade for a form or field the file does not list | Graded against a different version of the form | STOP |
| J4 | One field graded twice | Which grade is the reviewer's? | STOP |
| J5 | A field left ungraded | Rates over a subset that looks like the whole; "no invented field" on a form that was not finished | STRICT. With `--lenient` it is left out of every rate and listed; a form not fully graded is left out of "forms with an invented field" rather than counted as clean. Checked only once every grade read cleanly, so one bad grade is not reported twice |
| J6 | A kind not in the file's list, or kinds on a grade other than invented ("figure altered" on a faithful field) | The tags contradict the grade | Unknown kind: STOP. Kinds on another grade: STRICT |
| J7 | Two reviewers' files that graded different text (the forms changed between gradings, or different forms or fields) | Agreement between people who read different things means nothing | STOP. Every grades file carries a fingerprint of exactly what was graded: ids, sources and every field's text |
| J8 | The same grades file given as both reviewers | Perfect agreement with itself | WARN |
| J9 | Kappa when both reviewers used one grade only | Chance agreement is 100%, so kappa is 0 / 0 | RULE: "not measurable", never 1 or 0 |
| J10 | A field that both invents and leaves something out | Two grades for one field breaks the three-way label and kappa | RULE: graded invented (the worse), with the kind "also leaves something out"; it counts as invented only, and the report counts that kind |
| J11 | A section's rate pooled over its fields | It counts fields, not forms: one bad form with three strengths fields counts three times | RULE: section rates say they count fields; the per-form rate ("forms with an invented field") is reported separately |
| J12 | Hostile text in a transcript, a field, an id, or the grading config (`</script>`, `<img onerror>`, quotes) | The grading page would run it, offline or not | RULE: every value HTML-escaped; the page's data block escapes `<`; the page's own Content-Security-Policy forbids loading anything; the script builds grades from form controls and never writes input values as HTML |
| J13 | A form field that is empty, not text (an object, a list), or a form without its source text | An empty field skipped hides a "missing"; an object would show as `[object Object]`; grading without the source is grading from memory | Empty: RULE, shown as "(empty)" and graded. Not text: STOP. No source text: STRICT |
| J14 | Grades kept in the browser between sessions | A second reviewer on the same computer would open the first reviewer's grades, and their agreement would mean nothing | RULE: the page keeps nothing in browser storage; grades leave only as the downloaded file, and "Load saved grades" resumes from it |

## K. A judge's answer key checked by a person (`wfeval estimate`)

An AI judge writes an answer key for every record; a person checks some of them. The estimate
splits the records out without review by the judge's verdict and takes each group's rate from the
person's checks (docs/METRICS.md, "A judge's answer key checked by a person"). Tests in
`test/estimate.test.js`, worked by hand in `test/fixtures/estimate/EXPECTED.md`.

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| K1 | A checked record that is not in the run | A check of something else, counted as a check of this run | STOP, in lenient mode too, naming the records |
| K2 | The judge's key misses records that went out without review | A record out with no verdict cannot be put in a verdict group, and the judge's share would be wrong | STOP, in lenient mode too, naming the records. Records sent to a person or blocked need no verdict: the judge only needs to grade the records that went out without review (the others are paired with an empty stand-in so their routes are still checked) |
| K3 | A verdict group the judge used, with no checked record (say, the person checked only the flags) | Its rate is unknown; assuming 0% there would hide every error the judge missed | RULE: no estimate, only bounds (that group counted at 0% for the low end and 100% for the high), and a WARN saying which group to check. `--target` gives no plan |
| K4 | The judge flags none, or all, of the records out | One group only: the judge splits nothing | RULE: the estimate is the person's own rate; WARN that the judge adds nothing |
| K5 | Checked records that were sent to a person or blocked | Not part of the silent error rate's base; counted, they would mix two rates | WARN, naming them; they are left out. None of the checks out without review, or no record out at all: STOP |
| K6 | An id twice in the judge's key or the person's key | Which answer counts? | STOP (B3, as in any answer key) |
| K7 | A sample that looks non-random: the checks bunched at the start or end of the run (the first 30) | The estimate is right only if the checks are a random pick within each verdict group | WARN when, within a verdict group, the checked records' places in the run differ from a random pick's (Wilcoxon rank-sum, \|z\| > 1.96, as every range here). An honest random pick trips it about 1 time in 20 per group (3.5-5.1% measured), so it says the checks *may* not be random; when it fires, the report does not call the split "the recommended way". A pick by anything other than position cannot be seen; the report states the assumption every time |
| K8 | The two keys may cover different outputs: an output one key never fills on the checked records, while the other does | The person and the judge would disagree (or agree) for a reason that is not the workflow's | WARN, in both modes: an empty list is an answer, and a rare value can rightly be missing from every check. An output missing from a key's records altogether already stops (D2, F4) |
| K9 | The same file, or a copy of it, given as the judge's key and the person's | The person "agrees" with the judge everywhere, and proves nothing | STOP (same path, or exactly the same content) |
| K10 | `--pick` that is not a whole number of 1 or more (`0`, `--pick=-3`, `2.5`, `ten`), or too few for one check in each verdict group the judge used (`--pick 1` with flags and passes) | No checks, or a fraction of a record, cannot be picked; a group left unchecked means no estimate (K3) | STOP, saying how many are needed |
| K11 | `--pick` more than the records out without review, or no record went out at all | There are not that many records to check | STOP, saying how many went out (`--pick` that many checks them all), or that there is nothing to pick |
| K12 | `--pick` with `--key` or `--target`; `--seed` without `--pick`, not a whole number, or above 4294967295 | Picking comes before there is a person's key; a seed that picks nothing, is rounded, or wraps round to a smaller seed would make a pick nobody can repeat | STOP |
| K13 | `--pick` when the judge flags none, or all, of the records out | One group only: the pick is a plain random sample, and the judge adds nothing | WARN |
| K14 | With `--picks picks.json` (the list `--pick --json` saved): the person's key leaves out a picked record, or holds one that was not picked; or the picks file was made from another run | The checks are no longer the random pick: a record skipped because it looked hard, or one added because it looked interesting, can bias the estimate | STRICT, naming the records, or naming the other run the file came from. A picks file that is not that list: STOP. An exact match is confirmed in the report |

## L. Live samples over time (`wfeval monitor`)

After launch, a person checks a sample of the records out without review every week or month.
`monitor` reads the periods in time order, as run files scored with the config or as a counts
file scored elsewhere, and says whether the silent error rate has gone up and whether it is
shown under a target. These traps are about the series of periods, and about reading it.

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| L1 | Periods out of time order, or named so the order cannot be read (`march`, `april`) | The CUSUM adds up in the wrong order, and dates the rise to the wrong period | Period files in plain text order (a glob puts `week-10` before `week-2`): FIX, put in the order their names give, with a note; in any other order out of time: STOP. A counts file: STOP when the names (dates `2026-10-05`, months `2026-10`, weeks `2026-W41`, or numbers after the same text: `week-2` before `week-10`) put a period too early. Names that give no order: STRICT; `--lenient` takes the order given |
| L2 | A period given twice: the same name, two names for one period (`week-2`, `week-02`), or a run file with the same content as another | Its records count twice: twice the evidence, and its silent errors twice | STOP |
| L3 | A period with no records out without review | 0 of 0 is not 0%: counted as a calm period, it would pull the CUSUM down | WARN. Its rate is "none out"; it adds nothing to the CUSUM or the bound, and does not count toward the typical period size |
| L4 | A target at or below the acceptable rate, or an alarming rate at or below it | A workflow running at the target can never be shown under it; an alarm for a "rise" to a lower rate is backwards | STOP |
| L5 | Impossible counts: more silent errors than records out, negative or fractional counts, a missing column or period name, a file with no periods | A rate above 100%, or one computed from a typo | STOP, each named |
| L6 | Mixed inputs: run files and `--counts` together, or periods whose `scored_with` differ | A rise could come from a change in the scoring (another `wrong_when`, another kind of check), not the workflow | STOP. Run files are all scored here with one config; a counts file says what scored it in `scored_with`, checked over every period (the bound counts them all, whatever `--since` says) |
| L7 | Very uneven sample sizes: the largest period over 4 times the smallest | A big period counts for more than a small one; small periods false-alarm more often than the tuned figure; if different shares of each period were checked, the records checked do not stand for the periods equally | WARN |
| L8 | `--since` names a period that does not exist | A restart that silently starts nowhere, or at the beginning | STOP, listing the periods |
| L9 | The same record checked in two periods' run files | Its evidence counts twice | STRICT |
| L10 | Checking a likely range every period and calling it "under the target" the first time it is (peeking) | Every look is another chance for luck: in the simulation, the likely range of all periods so far showed "under 5%" in 13.5% to 16.4% of runs whose true rate was 5%, and one period of 100 records alone in 45.6% | RULE: "shown under" uses a confidence sequence, valid however often you look (at most 5%); 73 records with no silent error clear a single likely range, the confidence sequence needs 88 |
| L11 | One period's high rate read as a rise | One period is noisy: 1 silent error in 10 records is 10%, likely 1.8-40.4%, from a workflow that runs at 2.5% | RULE: the alarm adds up the evidence over periods, weighed by their records (CUSUM); one period alone raises it only when it holds enough evidence by itself |
| L12 | A perfect week in a scorecard warned about as "every prediction matches the answer key exactly" (A8) | In a scorecard a perfect week is normal; a warning every time one comes trains people to ignore warnings | RULE: A8's warning is kept only when every period file has it (a sign the answers were copied from the outputs) |
| L13 | `--since` restarting the bound too, at a period picked after an alarm | A restart picked by the numbers: at a true 5%, restarting both after each alarm showed "under 5%" in 29.7% of runs (`node scripts/monitor-sim.js restart`) | RULE: `--since` restarts the alarm only; the bound counts every period |
| L15 | A counts CSV split by ";" or tabs, column names written `Out Without Review`, or a required column missing or misspelled | Nothing can be read, or every row reports "has no period name" | FIX: the delimiter is read from the header row (STOP if it mixes them); names are read loosely (case, spaces, hyphens). A missing column: one STOP naming the columns found and expected |
| L16 | A percentage option under 1 (`--target 0.05`) | Read as 0.05%, where 5% may have been meant; nothing would look odd | WARN where a fraction was plausibly meant: a value of 0.5 or less (as a fraction, a rate of 50% or less); not for `--acceptable` or `--alarming` when `--target` is under 1 too. Settings print with all their decimals |
| L17 | Records in a period file that did not go out without review | Left out of the rate's base without a word, the base looks like every record checked | WARN, counting them per period |
| L18 | The acceptable rate left at half the target, below the rate the workflow normally runs at | The alarm goes off at once and dates the "rise" too early | WARN when the rise is dated to the first or second period with at least 3 silent errors before the alarm, or the periods before the alarm run clearly above the acceptable rate, suggesting `--acceptable` at the rate they ran at |
| L14 | The alarm level set from every period's sizes | A new period changes the median, and with it a status already printed (an alarm appears, or goes, after the fact) | RULE: each row's level comes from the periods up to it; `--period-size` pins one |

## M. Agreement among graders (`wfeval agree`)

Two or more people's answer keys (or grades files) for the same records, compared with
Krippendorff's alpha (src/agree.js, src/metrics/agreement.js). These traps are about which
files are compared and what counts as the same value. Tests: test/agree.test.js.

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| M1 | One grader only | Agreement of one person with nobody | STOP |
| M2 | The same file given twice | A grader always agrees with themselves: alpha 1 that proves nothing | STOP |
| M3 | Two different files with exactly the same content | Probably one file copied under two names; a real perfect agreement is possible | WARN |
| M4 | Two graders with one name (`ann.json` in two folders, or the same reviewer name in two grades files), an empty name, or `--names` with the wrong count | Every pair and every disagreement would name the wrong person | STOP; `--names a,b,c` names them |
| M5 | A record labelled by one grader only | It has no one to agree with; counted as agreeing, or as disagreeing, it would move alpha either way | RULE: left out of alpha (not pairable, as Krippendorff's units with one value) and listed per output ("labelled by one grader only") |
| M6 | Graders who labelled different records | Fine by design (alpha handles missing values, and double-labelling a sample is common), but it can also be a wrong or half-finished file | WARN, saying how many records each grader lacks |
| M7 | No record labelled by two or more graders (or no field graded by two reviewers) | Nothing to compare: alpha would be computed from nothing | STOP |
| M8 | A set value outside the output's `allowed_values`; a label or ordinal level not in the config's list | A typo counts as a disagreement about a value nobody meant; an unknown ordinal level has no place on the scale | Set value: STRICT. Label or level: STOP (F1, as the key is read) |
| M9 | Every grader used one value | Chance alone agrees perfectly: alpha is 0 / 0 | RULE: "not measurable", never 1 or 0, with no likely range (as J9) |
| M10 | A set one grader left empty (`[]`) | Empty means "nothing applies", a real answer; a set left out of a record entirely is not known to be empty | RULE: `[]` is a value, wholly apart from any non-empty set (distance 1) and the same as another `[]` (0). A set missing from a record: STOP (D2) |
| M11 | Key files covering different outputs: an output, or the routing gold field, in one grader's file and in no record of another's; `--output` naming no output; or a config output named `route` beside `routing.gold_field` (agree compares the gold route under that name) | Alpha over a grader who never labelled that output; or one name for two things, so one of them is never compared | STOP, naming the file and the output; `--output` compares only the outputs every grader labelled |
| M12 | Grades files for different forms (their fingerprints differ), or listing different forms or fields | Agreement between people who read different text means nothing (as J7) | STOP |
| M13 | `any_of` slots and `equivalents` in the keys | Two keys that say the same thing in different words would count as disagreeing | RULE: equivalents are applied as each key is read (an alias is its group's first value), so they agree. A slot is compared whole: `{ "any_of": ["a", "b"] }` matches another slot with the same alternatives in any order, and differs from a plain `"a"` (the two keys score a prediction of `b` differently). A slot of one alternative (written so, or after equivalents merge its alternatives) is that value, as slots.js reads it. A value that looks like a slot (`"{x"`) is still a value. Set order never matters |
| M14 | One value making up most of the values (the prevalence paradox) | Alpha can be low while almost every pair agrees: chance alone would agree that often, so the rare value carries all the information. A reader sees "81.8% agree" and "alpha 0.000" and trusts neither | RULE: at 80% or more of the pairable values, and alpha under 0.800, the report says so plainly, with raw agreement, the chance agreement and alpha |
| M15 | Alpha of 1 (no disagreement at all), every value but one the same, one record compared, or every resample giving the same alpha | Resampling a perfect set gives a range of 1 to 1, and a set of look-alike records a range of zero width: certainty claimed from a handful of records, the "0 of 7, range 0 to 0" overconfidence. With one odd value, each resample holds it or has no alpha | RULE: no likely range and no chances below the thresholds, and the report says why (Krippendorff's bootstrap note: bootstrapping does not apply to the first two, nor when alpha is not measurable) |
| M16 | A BCa range resting on fewer than 20 values that are not the most common value ("rare values"), on any number of records | In simulation (`node scripts/agree-flags.js`) a BCa range held the real alpha 30.0% of the time with 0-4 rare values, 77.6% with 5-9, 89.1% with 10-14, 92.8% with 15-19, and 92.9-94.9% from 20 on (95% is right). Very small sets always have few rare values. Krippendorff's bootstrap (used for names when every compared record has exactly two values) held 95.7-98.1% with under 15 | RULE: the report says so, per output, for a BCa range only (a line under the range): it is probably too narrow; label more records |
| M17 | A CSV key whose set column is blank in every record | A blank set cell means "nothing applies", so the grader reads as saying "nothing" everywhere, when far likelier they did not label that output | WARN, naming the file and the output; `--output` leaves it out |

## Note on duplicates

"Duplicate" means a record that repeats one already kept, not necessarily an identical
copy (in a news workflow, the same event retold by another outlet). The workflow keeps
the primary and suppresses the rest. The key marks a duplicate with `duplicate_of`,
pointing at the primary record's id. See docs/SILENT_ERRORS.md.
