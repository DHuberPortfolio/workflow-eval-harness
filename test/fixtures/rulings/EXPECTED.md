# Rulings fixture: hand-worked answers

Nine news articles tagged with SUBJECT and GEOGRAPHY codes, one run (`predictions.json`),
scored against an answer key (`key.json`) and a person's rulings on the key's possible gaps
(`rulings.json`). Built for: the rulings file (traps I11-I14), possible key gaps from one run
(I16), the bracket for pending rulings (I15), and one run against two keys (I17).

`wrong_when` is the default with a correct route, `either`: a record needed a person if the key
does not send it out on its own, or its values are wrong. The config reads `SUBJ-MERGERS` as
`SUBJ-MNA` (equivalents). Gate: SUBJECT lead at or above 0.85; floor 0.60.

## The records

| id | went | key route | key SUBJECT | SUBJECT applied | key GEOGRAPHY | GEOGRAPHY applied | ruling |
|---|---|---|---|---|---|---|---|
| K1 | auto | auto | MNA | MNA .95, **ANTI .90** | US | US | ANTI **pending** |
| K2 | auto | auto | EARN | EARN .92, **MNA .88** | US | US | `SUBJ-MERGERS` **add** |
| K3 | auto | auto | EARN | EARN .90, **ANTI .86** | UK | UK | ANTI **reject** |
| K4 | auto | auto | MNA | MNA .93 (LAB .50 set aside) | US | US, **UK .85** | - |
| K5 | auto | review | MNA | MNA .90, **EARN .88** | US | US | EARN **pending** |
| K6 | review | review | LAB | LAB .80, **ANTI .70** | UK | UK, EU (inherited from UK) | - |
| K7 | auto | auto | one of EARN, LAB | EARN .90 | EU | EU | LAB **add** |
| K8 | duplicate | duplicate | MNA | MNA, ANTI | US | US | - |
| K9 | auto | auto | EARN | EARN .95 | US | US | - |

Bold: an applied value the key does not list. Every gated record's SUBJECT lead is at or
above 0.85 and nothing applied is under the floor, so there are no safeguard failures.

## The rulings file, read

| ruling | read as | what happens |
|---|---|---|
| K1 SUBJECT SUBJ-ANTI pending | as written | scored as wrong (the strict reading); listed as a gap, "pending" |
| K2 SUBJECT SUBJ-MERGERS add | **SUBJ-MNA** (the config's equivalents; a clean-up, D23) | SUBJ-MNA joins K2's key as a plain value |
| K3 SUBJECT SUBJ-ANTI reject | as written | stays wrong; never listed; counted "1 ruled not a gap" |
| K5 SUBJECT SUBJ-EARN pending | as written | scored as wrong; listed, "pending" |
| K7 SUBJECT SUBJ-LAB add | as written | **set aside with a warning** (I14): LAB is already an alternative of K7's any_of slot, so the key already says it is right |

So: 1 value added to the key (K2 SUBJECT SUBJ-MNA), 1 rejected, 2 pending, 1 set aside.
`key.json` itself is not changed: the tool adds K2's value in memory, for scoring only.

## Score: the key alone, and the key plus the rulings

Went out without review (auto): K1 K2 K3 K4 K5 K7 K9 = **7**. Straight-through 7 of 9 = 77.8%
(Wilson 45.3-93.7%). K6 went to a person, K8 was suppressed as a duplicate.

| id | key alone | key + rulings | why |
|---|---|---|---|
| K1 | silent (SP-WRONG) | silent (SP-WRONG) | ANTI is pending: still counted wrong |
| K2 | silent (SP-WRONG) | **ok** | MNA added to its key |
| K3 | silent (SP-WRONG) | silent (SP-WRONG) | ANTI rejected: still wrong |
| K4 | silent (SP-WRONG) | silent (SP-WRONG) | GEO-UK, not ruled. SUBJ-LAB was set aside and is not in the key: neither wrong nor missing |
| K5 | silent (SP-WRONG, SP-SHOULD-REVIEW) | silent (same) | the key routes it to a person anyway |
| K7 | ok | ok | EARN fills the any_of slot |
| K9 | ok | ok | |

- Key alone: **5 of 7 = 71.4%**. Wilson, z = 1.96, z^2 = 3.8416, n = 7: z^2/n = 0.5488,
  denominator 1.5488; center (0.7143 + 0.2744) / 1.5488 = 0.6384; half-width
  1.96 x sqrt(0.7143 x 0.2857 / 7 + 3.8416 / 196) / 1.5488 = 1.96 x sqrt(0.02915 + 0.0196) / 1.5488 = 0.2794;
  range **35.9-91.8%**.
- Key + rulings: **4 of 7 = 57.1%**. Center (0.5714 + 0.2744) / 1.5488 = 0.5461; half-width
  1.96 x sqrt(0.5714 x 0.4286 / 7 + 0.0196) / 1.5488 = 0.2957; range **25.0-84.2%**.

Silent omissions 0 of 8 (every record the key sends out or to a person was sent out or to a
person). Review precision 1 of 1 (K6: the key routes it to a person). No block route, so no
block precision.

SUBJECT, over the 8 scored records (K8 is a duplicate, left out). 13 values applied:

| | right | wrong (FP) | missed (FN) | precision | F1 = 2TP / (2TP + FP + FN) |
|---|---|---|---|---|---|
| key alone | 8 | 5 (K1 ANTI, K2 MNA, K3 ANTI, K5 EARN, K6 ANTI) | 0 | 8/13 = 61.5% | 16/21 = 0.762 |
| key + rulings | 9 | 4 (K2's MNA is now right) | 0 | 9/13 = 69.2% | 18/22 = 0.818 |
| key-v2 (below) | 11 | 2 (K3 ANTI, K6 ANTI) | 0 | 11/13 = 84.6% | 22/24 = 0.917 |

GEOGRAPHY is the same in all three: 10 applied, 8 right, 2 wrong (K4 UK, K6 EU; an inherited
value counts in precision, D17), precision 80.0%.

## Possible key gaps from this one run (I16)

Every **applied** value the key (plus added values) does not list, leaving out what `variance`
leaves out: values outside allowed_values (none here), inherited values (K6's GEO-EU),
suppressed duplicates (K8's ANTI), records whose model call failed (none here). A set-aside
value is not listed either (K4's SUBJ-LAB): it was not applied, so it is not a mistake that
went anywhere.

With the rulings, in this order (silent errors first, then the records' order):

| id | output | value | confidence | silent error? | if every gap listed on the record were added | ruling |
|---|---|---|---|---|---|---|
| K1 | SUBJECT | SUBJ-ANTI | 0.90 | yes (SP-WRONG) | **clears**: nothing left | pending (DH, 2026-10-30) |
| K4 | GEOGRAPHY | GEO-UK | 0.85 | yes (SP-WRONG) | **clears** | unruled |
| K5 | SUBJECT | SUBJ-EARN | 0.88 | yes (SP-WRONG, SP-SHOULD-REVIEW) | **stays one**: SP-SHOULD-REVIEW | pending (DH, 2026-10-30) |
| K6 | SUBJECT | SUBJ-ANTI | 0.70 | no (sent to a person) | - | unruled |

Not listed: K3's ANTI (**1 ruled not a gap**), K2's MNA (added: it is in the key now).

Without the rulings file, six are listed: K1 ANTI, K2 MNA, K3 ANTI, K4 GEO-UK, K5 EARN (all
five on silent errors; all clear if added except K5), then K6 ANTI. No ruling status is shown.

## The bracket for pending rulings (I15)

Scored again with the 2 pending rulings turned into adds (K1 SUBJ-ANTI, K5 SUBJ-EARN):

| id | key + rulings | + pending added |
|---|---|---|
| K1 | silent | **ok** |
| K3 | silent | silent |
| K4 | silent | silent |
| K5 | silent (SP-WRONG, SP-SHOULD-REVIEW) | silent (SP-SHOULD-REVIEW only) |

**3 of 7 = 42.9%**. Wilson: center (0.4286 + 0.2744) / 1.5488 = 0.4539; half-width 0.2957
(the same as 4 of 7: p(1 - p) is symmetric); range **15.8-75.0%**. Cleared: K1. Became silent:
none.

So the headline reads 57.1% (4 of 7) with pending counted wrong, and 42.9% (3 of 7) if both
were added. It is a bracket because both pending values were **applied** in this run: adding
an applied value can only remove a wrong value, never add an error, so each record can only
go from silent to ok as rulings turn into adds. Whatever the person decides, the count lands
from 3 to 4 of the same 7 records out (routes do not depend on the key, so the base stays 7).

### A pending value this run did not apply (`rulings-unstated.json`)

The same rulings plus one: K9 GEOGRAPHY GEO-CA, pending. This run never stated GEO-CA for K9.
Added to the key it becomes a slot nothing filled: a miss (SP-MISSING), and K9 becomes a
silent error. All three pending added: K1 cleared, K9 became silent: **4 of 7 = 57.1%**, the same
as the strict reading. The report must say that 1 pending value was not applied in this run,
so the two figures are not a bracket: ruled add for K1 and reject for K9, the count is 3.

## One run against two keys (I17)

`key-v2.json` is `key.json` with K2's added SUBJ-MNA and both pending values (K1 SUBJ-ANTI,
K5 SUBJ-EARN) written in by hand. So scoring the run against it must give the bracket's
figure: **3 of 7 = 42.9%**.

`compare --key key.json --after-key key-v2.json --before predictions.json --after predictions.json`:
the same predictions, so every route is the same and every change comes from the key.

| metric | before (key) | after (key-v2) | change |
|---|---|---|---|
| silent error rate | 71.4% | 42.9% | -28.6 pts (exact: 3/7 - 5/7 = -2/7) |
| straight-through | 77.8% | 77.8% | no change |
| SUBJECT precision | 61.5% | 84.6% | +23.1 pts |
| SUBJECT F1 | 0.762 | 0.917 | +0.155 |
| GEOGRAPHY precision | 80.0% | 80.0% | no change |

Paired, on the same 9 records:

| outcome | before | after | fixed | broke | McNemar (f - b) / sqrt(f + b) | verdict |
|---|---|---|---|---|---|---|
| silent errors | K1 K2 K3 K4 K5 (5) | K3 K4 K5 (3) | K1 K2 | - | 2 / 1.41 = 1.41 < 1.96 | unclear |
| silent omissions | - | - | - | - | | no change |
| unnecessary reviews | - | - | - | - | | no change |
| routed against the key | K5 | K5 | - | - | | no change |

Tango's range for the silent errors (points of the 9 records, after minus before):
-54.7 to +14.3, computed by `pairedDifference(2, 0, 9)` (as error-rate-calculator's paired
mode); it crosses 0, so "unclear", as McNemar says. Two values fixed on 9 records is not
enough to call the key change better or worse; the record-by-record list says exactly which.

**With the rulings applied to both keys** (`--rulings rulings.json`): before, the key plus
K2's add: K1 K3 K4 K5 silent (4). After, key-v2 already has K2's MNA and both pending values,
so those three rulings and K7's are set aside with a warning (I14), and only K3's reject is
left: K3 K4 K5 (3). Fixed K1, broke none (McNemar 1 / 1 = 1: unclear).

Stops: two keys that do not cover the same record ids (key-v2 without K9). Warns: two
different runs against two keys (each change then mixes the workflow's and the key's).

## Across runs: the tiny fixture's three runs (`../runs/`) with `tiny-rulings.json`

The tiny fixture's R2 states the wrong SUBJ-ANTI in all three runs (I7). With R2 SUBJECT
SUBJ-ANTI ruled **reject**, `variance` lists no possible key gaps and counts **1 ruled not a
gap**; every metric is unchanged (a reject changes no score). Ruled **pending** instead, R2's
gap is listed as before (3 of 3 runs, applied in 3, confidence 0.80-0.88), marked "pending".

`score` on run a with the reject: no gaps listed, 1 ruled not a gap. Without rulings: R2
SUBJECT SUBJ-ANTI 0.88, on a silent error (SP-WRONG, SP-SHOULD-REVIEW) that stays one if added
(SP-SHOULD-REVIEW): the key routes R2 to a person whatever its codes.
