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
| A14 | CSV cell conventions | A cell only holds text | RULE: `\|` between values, `@` before a confidence (both configurable); an empty set cell means "no values"; a missing column means missing (D1/D2); a value that itself contains `@` needs another `confidence_separator` (otherwise STOP) |

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
| D6 | Same code twice in one facet | Counted twice, inflating TP or FP; also a sign the workflow's de-duplication is broken | STRICT. In lenient mode: keep once (highest confidence) |
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

## F. Label outputs (pass / elevate / fail)

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| F1 | Label not in the declared list: `"Pass"`, `"elevate "` | Becomes a class nobody reports on | FIX spaces; otherwise STOP |
| F2 | Label given as a list | Label outputs hold exactly one value | STOP |
| F3 | Label missing on a prediction | No verdict was made | STOP |
| F4 | Label missing on the key | No right answer | STOP |

## G. Arithmetic (metric code, Day 1-2)

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| G1 | No auto-published records | Silent error rate is 0 / 0: "nothing to measure", not "0% errors" | RULE: null, and the report says why |
| G2 | No records sent for review | Same, for review-queue precision | RULE: null |
| G3 | A facet with nothing predicted and nothing expected anywhere | Precision and recall are 0 / 0 | RULE: null, never NaN |
| G4 | Precision 0, recall above 0 | Some code (including run 49's scorecard) returns null here; the correct F1 is 0 | RULE: F1 = 0 |
| G5 | All records excluded | Nothing left to score | RULE: every rate null; report says why |
| G6 | Rounding before dividing | Small errors compound | RULE: compute from raw counts; round only for display |
| G7 | Straight-through denominator | Must include excluded records (your choice) | RULE: all records |
| G8 | Silent error with a small base: 0/7 | Looks perfect, could be 35% | RULE: every rate shows its range |
| G10 | Fixed-width calibration buckets: in binary, 0.7 / 0.1 is 6.9999…, so 0.7 lands in the 0.6–0.7 bucket | Every value on a bucket edge is misfiled, and models love round numbers | RULE: nudge before rounding down; 1.0 joins the top bucket |
| G11 | Totals that match while records don't: two misroutes in opposite directions | "routed" and "should be" counts agree, and nothing looks wrong | RULE: every metric is computed record by record, from the pairs |
| G9 | Comparing two different populations (run 4's negative rejection rate: applied included inherited, proposed did not) | Impossible numbers, or worse, plausible wrong ones | RULE: every ratio's top and bottom count the same kind of thing |

## H. Traps inside the trap labels

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| H1 | Record with no trap label | Dropped from the per-trap table; totals stop adding up | RULE: grouped as "(none)" |
| H2 | Trap name typo: `entity-disambig` vs `entity-disambiguation` | Splits one trap type into two small groups | Caught by H5 |
| H3 | Record with several traps (e.g. a duplicate that also has a weak-but-correct value) | Which group does it count in? | RULE: the trap field may be a list; the record counts in each group; the table notes that group totals can exceed the record count |
| H4 | Trap field present on **predictions** | The workflow may have seen what it was being tested on | STRICT, except for a combined format (the config reads the key from other fields than the predictions), where the key sits in each record by design |
| H5 | A trap type with too few records (below `min_per_trap`, e.g. 3) | One record passing can be luck; it proves nothing about the trap | STRICT. The report always lists every trap type with its count |

## I. Multiple runs (Day 3)

| # | Trap | Why it's dangerous | Action |
|---|---|---|---|
| I1 | Only one run given to `variance` | Spread of one number is meaningless | STOP |
| I2 | Runs cover different record sets | Differences may come from different records, not different behavior | STOP |
| I3 | The same file passed twice | Makes the runs look more stable than they are | WARN |
| I4 | `compare` given runs scored with different configs | Changes caused by the config look like changes in the workflow | STOP |
| I5 | A difference smaller than run-to-run noise | Looks like progress | RULE: `compare` says "within noise" when a variance baseline exists |

## Note on duplicates

"Duplicate" means a record that repeats one already kept, not necessarily an identical
copy (in a news workflow, the same event retold by another outlet). The workflow keeps
the primary and suppresses the rest. The key marks a duplicate with `duplicate_of`,
pointing at the primary record's id. See docs/SILENT_ERRORS.md.
