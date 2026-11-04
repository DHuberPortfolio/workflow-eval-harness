"""Independent re-implementation of wfeval's record judging, written ONLY from
README.md, docs/SILENT_ERRORS.md, docs/METRICS.md, docs/CONFIG.md,
docs/READING_A_REPORT.md and the shape of the JSON the tool writes.

Nothing under src/, test/ (code), scripts/ or bin/ was read.

READINGS below holds every place where the docs did not fix one answer. The
default of each switch is the reading made from the docs BEFORE looking at the
harness's answer on that point, except five rules the docs have since settled:
each says so below, and by_cause.py lists them with their first reading.
compare_runs.py can flip a switch to see what it decides.
"""
import csv
import json
import os
from fractions import Fraction

import oracle_stats as st

SEVERITY = {
    "SP-FORBIDDEN": "critical", "SP-SHOULD-REVIEW": "medium", "SP-WRONG-PRIMARY": "medium",
    "SP-DUPLICATE": "low", "SP-INVALID": "critical", "SP-WRONG": "high",
    "SP-SHOULD-DECLINE": "high", "SP-MISSING-REJECTED": "medium", "SP-MISSING": "medium",
    "SP-DECLINED": "medium", "SP-NEAR-MISS": "low",
    "SO-FALSE-DUPLICATE": "high", "SO-PRIMARY-SUPPRESSED": "medium",
    "SO-FALSE-BLOCK": "medium", "SO-DECLINED": "medium",
}
ORDER = ["critical", "high", "medium", "low"]

# name -> default reading. README.md says which ones differ from the harness today.
READINGS = {
    # A1 "kept": a duplicate counts as kept when it went out OR went to a person.
    "primary_kept_includes_review": True,
    # A2 a record both SP-DUPLICATE and SP-WRONG-PRIMARY lists both (a record can have several).
    "wrong_primary_keeps_duplicate": True,
    # A3 SP-INVALID on a value the key lists counts as wrong evidence.
    "invalid_is_wrong_evidence": True,
    # A4 SG-GATE with applied values that have no confidence: those values are ignored;
    #    if no applied value has a confidence, the gate cannot be met: it fails.
    "gate_no_confidence_fails": True,
    # A5 the floor checks inherited values too (nothing exempts them).
    "floor_checks_inherited": True,
    # A6 a set value both applied and listed by rejected_field: the applied copy wins.
    # A7 failed model calls are read from a prediction field "scored": false. The five docs
    #    never say how; found by probing the CLI. Everything else about them is judged as usual.
    "failed_field": "scored",
    # A8 SO-DECLINED where the key's route is exclude. First read as firing; settled: it does
    #    not (SILENT_ERRORS: the key's route "does not say block or suppress").
    "so_declined_on_exclude": False,
    # A9 a declined label on a gated output is "nothing applied": fails the gate.
    "declined_fails_gate": True,
    # A10 a value in a set stated both by a decline... n/a
    # A11 the quality population leaves out records the WORKFLOW suppressed (route class exclude).
    "quality_drops_key_duplicates": False,
    # A12 METRICS, Review precision: a record the key blocks or suppresses "needs no person ...
    #    whatever their values". First read as holding for every wrong_when; settled: under
    #    any_mismatch the key's route is not read (METRICS, READING_A_REPORT).
    "any_mismatch_ignores_key_route": True,
    # A1b "kept" also covers a blocked duplicate (anything not suppressed). Default no: blocked
    #    is "never processed further", so it was not kept.
    "primary_kept_any_not_suppressed": False,
    # A4b (--lenient only) any applied value with no confidence on a gated output: skip the gate
    #    for that output instead of judging the values that have one, unless a weakest gate
    #    already fails on a known value. First read as no; settled: it does (SILENT_ERRORS
    #    SG-GATE, CONFIG E1).
    "gate_skip_if_any_no_confidence": True,
    # A13 SP-WRONG-PRIMARY needs a correct route as well as duplicate_of_field. First read as no,
    #    from a table row that named only the field; settled: it does (the row now says so).
    "wrong_primary_needs_gold": True,
    # A14 the floor checks a label's confidence too. First read as yes: SG-FLOOR said "applied
    #    value" and gates reach labels. Settled: set outputs only (SILENT_ERRORS, CONFIG).
    "floor_checks_labels": False,
    # A15 what the harness does, kept only to prove it explains every remaining difference: an
    #    invalid value the key lists is no evidence that the record needed a person, yet still
    #    makes a record that went out a silent error (except under gold_route).
    "invalid_silent_without_needs": False,
}


READINGS.update(json.loads(os.environ.get("ORACLE_READINGS", "{}")))


def get_path(obj, path):
    """(found, value). A field literally named with a dot is used first."""
    if isinstance(obj, dict) and path in obj:
        return True, obj[path]
    cur = obj
    for p in path.split("."):
        if isinstance(cur, dict) and p in cur:
            cur = cur[p]
        else:
            return False, None
    return True, cur


def text(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return str(v).strip()


def load_records(path, spec):
    spec = spec or {}
    ext = os.path.splitext(path)[1].lower()
    fmt = spec.get("format") or {".jsonl": "jsonl", ".ndjson": "jsonl", ".csv": "csv", ".tsv": "csv"}.get(ext, "json")
    if fmt == "json":
        with open(path, encoding="utf-8-sig") as f:
            data = json.load(f)
        if spec.get("records_at"):
            found, data = get_path(data, spec["records_at"])
            if not found:
                raise ValueError("records_at not found")
    elif fmt == "jsonl":
        with open(path, encoding="utf-8-sig") as f:
            data = [json.loads(line) for line in f if line.strip()]
    else:
        delim = spec.get("delimiter") or ("\t" if ext == ".tsv" else ",")
        if delim == "\\t":
            delim = "\t"
        with open(path, encoding="utf-8-sig", newline="") as f:
            data = list(csv.DictReader(f, delimiter=delim))
        return data, True
    if spec.get("unwrap"):
        data = [get_path(r, spec["unwrap"])[1] for r in data]
    return data, False


class Output:
    def __init__(self, name, o, routing):
        self.name = name
        self.type = o["type"]
        self.field = o.get("field", name)
        self.key_field = o.get("key_field", self.field)
        self.value_key = o.get("value_key", "value")
        self.confidence_key = o.get("confidence_key", "confidence")
        self.rejected_field = o.get("rejected_field")
        self.confidence_field = o.get("confidence_field")
        self.labels = [text(x) for x in o.get("labels", [])]
        self.near_miss_steps = o.get("near_miss_steps", 1)
        d = o.get("decline") or None
        self.decline_values = set(text(x) for x in (d or {}).get("values", []))
        self.decline_field = (d or {}).get("field")
        self.can_decline = d is not None
        self.is_route = self.field == routing.get("field", "route")


class Config:
    def __init__(self, path):
        with open(path, encoding="utf-8-sig") as f:
            self.raw = json.load(f)
        c = self.raw
        self.path = path
        self.dir = os.path.dirname(os.path.abspath(path))
        self.id_field = c.get("id_field", "id")
        self.input = c.get("input", {})
        r = c["routing"]
        self.routing = r
        self.route_field = r.get("field", "route")
        self.gold_field = r.get("gold_field")
        self.map = r["map"]
        self.outputs = {k: Output(k, v, r) for k, v in c["outputs"].items()}
        self.wrong_when = c.get("wrong_when") or ("either" if self.gold_field else "any_mismatch")
        t = c.get("thresholds") or {}
        self.floor = t.get("floor")
        self.auto_publish = t.get("auto_publish") or {}
        self.gate_uses = t.get("gate_uses", "lead")
        self.duplicate_of_field = c.get("duplicate_of_field")
        self.trap_field = c.get("trap_field")
        self.severity = dict(SEVERITY)
        self.severity.update(c.get("severity") or {})
        self.equivalents = {}
        for out, groups in (c.get("equivalents") or {}).items():
            m = {}
            for g in groups:
                first = text(g[0])
                for v in g:
                    m[text(v)] = first
            self.equivalents[out] = m
        self.allowed = {}
        for out, spec in (c.get("allowed_values") or {}).items():
            if isinstance(spec, list):
                vals = spec
            else:
                with open(os.path.join(self.dir, spec["file"]), encoding="utf-8-sig") as f:
                    data = json.load(f)
                if spec.get("field"):
                    vals = [get_path(x, spec["field"])[1] for x in data]
                else:
                    vals = [x if not isinstance(x, dict) else x.get("value", x.get("code")) for x in data]
            m = self.equivalents.get(out, {})
            self.allowed[out] = set(m.get(text(v), text(v)) for v in vals)
        self.clusters = c.get("clusters")
        self.split = c.get("split")

    def canon(self, out, v):
        return self.equivalents.get(out, {}).get(v, v)


class Stated:
    __slots__ = ("value", "conf", "low", "applied", "inherited")

    def __init__(self, value, conf, applied, inherited):
        self.value, self.conf, self.applied, self.inherited = value, conf, applied, inherited
        self.low = conf if applied else None


def _num(x):
    if x is None or x == "":
        return None
    if isinstance(x, bool):
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def read_stated(cfg, out, rec, is_csv):
    spec = cfg.input.get("predictions", {})
    sep = spec.get("list_separator", "|")
    atsep = spec.get("confidence_separator", "@")
    items = []

    def add(raw, forced_rejected):
        if raw is None or raw == "":
            return
        if isinstance(raw, str) and is_csv:
            raw = [x for x in (y.strip() for y in raw.split(sep)) if x]
            parsed = []
            for x in raw:
                if atsep in x:
                    v, c = x.rsplit(atsep, 1)
                    parsed.append({out.value_key: v, out.confidence_key: float(c)})
                else:
                    parsed.append(x)
            raw = parsed
        if not isinstance(raw, list):
            raw = [raw]
        for x in raw:
            if isinstance(x, dict):
                v = text(x.get(out.value_key))
                conf = _num(x.get(out.confidence_key))
                app = x.get("applied", True)
                inh = x.get("inherited_from")
            else:
                v, conf, app, inh = text(x), None, True, None
            if forced_rejected:
                app = False
            items.append(Stated(cfg.canon(out.name, v), conf, app is not False, inh))

    add(get_path(rec, out.field)[1], False)
    if out.rejected_field:
        add(get_path(rec, out.rejected_field)[1], True)

    merged = {}
    for s in items:
        if s.value not in merged:
            merged[s.value] = s
            continue
        a = merged[s.value]
        # highest applied copy's confidence; with neither applied, the higher;
        # lowest applied copy kept for the floor and a weakest gate.
        confs_app = [x.conf for x in (a, s) if x.applied and x.conf is not None]
        lows = [x.low for x in (a, s) if x.applied and x.low is not None]
        if a.applied or s.applied:
            conf = max(confs_app) if confs_app else None
        else:
            cs = [x.conf for x in (a, s) if x.conf is not None]
            conf = max(cs) if cs else None
        m = Stated(a.value, conf, a.applied or s.applied, a.inherited if a.inherited is not None else s.inherited)
        m.low = min(lows) if lows else None
        merged[s.value] = m
    return list(merged.values())


def read_key_slots(cfg, out, rec, is_csv):
    """List of slots; each slot a list of values (key order). Plain value: a slot of one."""
    found, raw = get_path(rec, out.key_field)
    if raw is None or raw == "":
        return []
    spec = cfg.input.get("key", {})
    if isinstance(raw, str) and is_csv:
        sep = spec.get("list_separator", "|")
        anysep = spec.get("any_of_separator")
        aout = spec.get("any_of_outputs")
        cells = [x.strip() for x in raw.split(sep) if x.strip()]
        raw = []
        for c in cells:
            if anysep and anysep in c and (aout is None or out.name in aout):
                raw.append({"any_of": [x.strip() for x in c.split(anysep) if x.strip()]})
            else:
                raw.append(c)
    if not isinstance(raw, list):
        raw = [raw]
    slots = []
    for x in raw:
        if isinstance(x, dict) and "any_of" in x:
            vals = []
            for v in x["any_of"]:
                c = cfg.canon(out.name, text(v))
                if c not in vals:
                    vals.append(c)
            slots.append(vals)
        elif isinstance(x, dict):
            slots.append([cfg.canon(out.name, text(x.get(out.value_key)))])
        else:
            slots.append([cfg.canon(out.name, text(x))])
    # identical slots (two aliases of one value) are one slot
    uniq = []
    for s in slots:
        if s not in uniq:
            uniq.append(s)
    return uniq


def read_label(cfg, out, rec, is_csv):
    """(label or None, confidence, declined, set_aside_label)."""
    found, raw = get_path(rec, out.field)
    conf = None
    if isinstance(raw, dict):
        conf = _num(raw.get(out.confidence_key))
        raw = raw.get(out.value_key)
    if out.confidence_field:
        c = _num(get_path(rec, out.confidence_field)[1])
        if c is not None:
            conf = c
    value = None if raw is None or raw == "" else cfg.canon(out.name, text(raw))
    declined_flag = False
    if out.decline_field:
        fv = get_path(rec, out.decline_field)[1]
        declined_flag = fv is True
    if declined_flag:
        return None, None, True, (value if value not in (None,) and value not in out.decline_values else None)
    if value is not None and value in out.decline_values:
        return None, None, True, None
    return value, conf, False, None


def read_key_label(cfg, out, rec):
    raw = get_path(rec, out.key_field)[1]
    if raw is None or raw == "":
        return None, False
    v = cfg.canon(out.name, text(raw))
    if v in out.decline_values:
        return None, True
    return v, False


def slot_name(slot, stated_rejected):
    if len(slot) == 1:
        return slot[0]
    one = "one of " + ", ".join(slot)
    if stated_rejected:
        return ", ".join(stated_rejected) + " (" + one + ")"
    return one


class Judged:
    pass


def judge_values(cfg, pred, key, pcsv, kcsv, extra_slots=None):
    """Value differences for one record against its key."""
    d = {k: {} for k in ("wrong", "missing_rejected", "missing", "invalid", "near_miss", "declined", "should_decline")}
    info = {}
    for name, out in cfg.outputs.items():
        if out.type == "set":
            stated = read_stated(cfg, out, pred, pcsv)
            slots = read_key_slots(cfg, out, key, kcsv)
            if extra_slots and name in extra_slots:
                for v in extra_slots[name]:
                    if [v] not in slots:
                        slots.append([v])
            union = set(v for s in slots for v in s)
            applied = [s for s in stated if s.applied]
            appvals = set(s.value for s in applied)
            rej = set(s.value for s in stated if not s.applied)
            wrong = [s.value for s in applied if s.value not in union]
            mr, ms = [], []
            for slot in slots:
                if set(slot) & appvals:
                    continue
                r = [v for v in slot if v in rej]
                if r:
                    mr.append(slot_name(slot, r))
                else:
                    ms.append(slot_name(slot, []))
            if wrong:
                d["wrong"][name] = wrong
            if mr:
                d["missing_rejected"][name] = mr
            if ms:
                d["missing"][name] = ms
            if name in cfg.allowed:
                inv = [s.value for s in applied if s.value not in cfg.allowed[name]]
                if inv:
                    d["invalid"][name] = inv
            info[name] = dict(type="set", stated=stated, slots=slots, applied=applied, union=union,
                              tp=[v for v in appvals if v in union], fp=wrong,
                              unfilled=[s for s in slots if not (set(s) & appvals)])
        else:
            label, conf, declined, aside = read_label(cfg, out, pred, pcsv)
            klabel, kdecl = read_key_label(cfg, out, key)
            info[name] = dict(type=out.type, label=label, conf=conf, declined=declined, aside=aside,
                              klabel=klabel, kdecl=kdecl)
            if out.is_route:
                continue  # judged by the route types only
            if name in cfg.allowed and not declined and label not in cfg.allowed[name]:
                d["invalid"][name] = [label]
            if declined and kdecl:
                continue
            if declined and not kdecl:
                s = klabel
                if aside is not None:
                    s = "%s (set aside: %s)" % (klabel, aside)
                d["declined"][name] = [s]
                continue
            if kdecl:
                d["should_decline"][name] = [label]
                continue
            if label == klabel:
                continue
            if out.type == "ordinal":
                dist = abs(out.labels.index(label) - out.labels.index(klabel))
                if dist <= out.near_miss_steps:
                    d["near_miss"][name] = ["%s for %s" % (label, klabel)]
                else:
                    d["wrong"][name] = ["%s for %s" % (label, klabel)]
            else:
                d["wrong"][name] = [label]
    return d, info


def value_wrong(d, readings):
    kinds = ["wrong", "missing_rejected", "missing", "near_miss", "declined", "should_decline"]
    if readings["invalid_is_wrong_evidence"]:
        kinds.append("invalid")
    return any(d[k] for k in kinds)


def safeguards(cfg, pred, info, readings):
    out_fail = []
    if cfg.auto_publish:
        fail = False
        for name, thr in cfg.auto_publish.items():
            if name not in info:
                continue
            if isinstance(thr, str):
                thr = _num(get_path(pred, thr)[1])
            i = info[name]
            if i["type"] == "set":
                app = i["applied"]
                if not app:
                    fail = True
                    continue
                if readings["gate_skip_if_any_no_confidence"] and any(s.conf is None for s in app):
                    # Not on a weakest gate with a value known to be under it (trap P9).
                    known = [s.low for s in app if s.low is not None]
                    if cfg.gate_uses != "weakest" or not known or min(known) >= thr:
                        continue
                if cfg.gate_uses == "weakest":
                    cs = [s.low for s in app]
                    if any(c is None for c in cs):
                        cs2 = [c for c in cs if c is not None]
                        if not cs2:
                            fail = fail or readings["gate_no_confidence_fails"]
                            continue
                        cs = cs2
                    if min(cs) < thr:
                        fail = True
                else:
                    cs = [s.conf for s in app if s.conf is not None]
                    if not cs:
                        fail = fail or readings["gate_no_confidence_fails"]
                        continue
                    if max(cs) < thr:
                        fail = True
            else:
                if i["declined"]:
                    fail = fail or readings["declined_fails_gate"]
                    continue
                if i["conf"] is None:
                    if not readings["gate_skip_if_any_no_confidence"]:
                        fail = fail or readings["gate_no_confidence_fails"]
                    continue
                if i["conf"] < thr:
                    fail = True
        if fail:
            out_fail.append("SG-GATE")
    if cfg.floor is not None:
        under = False
        for name, i in info.items():
            if i["type"] == "set":
                for s in i["applied"]:
                    if s.inherited is not None and not readings["floor_checks_inherited"]:
                        continue
                    c = s.low if s.low is not None else s.conf
                    if c is not None and c < cfg.floor:
                        under = True
            else:
                if readings["floor_checks_labels"] and i["conf"] is not None and not i["declined"] and i["conf"] < cfg.floor:
                    under = True
        if under:
            out_fail.append("SG-FLOOR")
    return out_fail


def worst(types, sev):
    return min((sev[t] for t in types), key=ORDER.index)


class Run:
    pass


def judge_run(cfg, preds, keys, pcsv=False, kcsv=False, readings=None, only_ids=None, extra=None):
    """preds/keys: raw record lists. only_ids: judge these records alone (a split half)."""
    rd = dict(READINGS)
    rd.update(readings or {})
    keymap = {}
    for k in keys:
        keymap[text(get_path(k, cfg.id_field)[1])] = k
    recs = []
    for p in preds:
        i = text(get_path(p, cfg.id_field)[1])
        if only_ids is not None and i not in only_ids:
            continue
        if i in keymap:
            recs.append((i, p, keymap[i]))
    route = {}
    for i, p, k in recs:
        route[i] = cfg.map.get(text(get_path(p, cfg.route_field)[1]))
    primaries = {}
    dupof = {}
    if cfg.duplicate_of_field:
        for i, p, k in recs:
            f, v = get_path(k, cfg.duplicate_of_field)
            if v not in (None, ""):
                dupof[i] = text(v)
                primaries.setdefault(text(v), []).append(i)

    res = Run()
    res.cfg = cfg
    res.records = []
    for i, p, k in recs:
        j = Judged()
        j.id = i
        j.route = text(get_path(p, cfg.route_field)[1])
        j.route_class = route[i]
        j.gold = None
        j.gold_class = None
        if cfg.gold_field:
            f, v = get_path(k, cfg.gold_field)
            if v not in (None, ""):
                j.gold = text(v)
                j.gold_class = cfg.map.get(j.gold)
        fv = get_path(p, rd["failed_field"])[1] if rd["failed_field"] else None
        j.failed = fv is False or (isinstance(fv, str) and fv.strip().lower() == "false")
        j.traps = []
        if cfg.trap_field:
            tv = get_path(k, cfg.trap_field)[1]
            if tv not in (None, "", []):
                j.traps = [text(x) for x in tv] if isinstance(tv, list) else [text(tv)]
        j.diff, j.info = judge_values(cfg, p, k, pcsv, kcsv, (extra or {}).get(i))
        vw = value_wrong(j.diff, rd)
        route_evidence = j.gold_class in ("review", "block", "exclude")
        if cfg.wrong_when == "either":
            j.needs = route_evidence or vw
        elif cfg.wrong_when == "gold_route":
            j.needs = route_evidence
        else:
            j.needs = vw

        # silent error
        j.silent = None
        j.safeguards = []
        if j.route_class == "auto":
            j.safeguards = safeguards(cfg, p, j.info, rd)
        if j.route_class == "auto" and (j.needs or (rd["invalid_silent_without_needs"] and j.diff["invalid"]
                                                    and cfg.wrong_when != "gold_route")):
            ty = []
            if j.gold_class == "block":
                ty.append("SP-FORBIDDEN")
            if j.gold_class == "review":
                ty.append("SP-SHOULD-REVIEW")
            wp = i in dupof and route.get(dupof[i]) == "exclude" and                 (j.gold_class is not None or not rd["wrong_primary_needs_gold"])
            if wp:
                ty.append("SP-WRONG-PRIMARY")
            if j.gold_class == "exclude" and (rd["wrong_primary_keeps_duplicate"] or not wp):
                ty.append("SP-DUPLICATE")
            m = {"invalid": "SP-INVALID", "wrong": "SP-WRONG", "should_decline": "SP-SHOULD-DECLINE",
                 "missing_rejected": "SP-MISSING-REJECTED", "missing": "SP-MISSING",
                 "declined": "SP-DECLINED", "near_miss": "SP-NEAR-MISS"}
            for kind, code in m.items():
                if j.diff[kind]:
                    ty.append(code)
            j.silent = dict(types=ty, severity=worst(ty, cfg.severity))

        # silent omission
        j.omission = None
        ot = []
        decl_with_answer = [n for n, x in j.info.items()
                            if x["type"] != "set" and x["declined"] and not x["kdecl"] and x["klabel"] is not None
                            and not cfg.outputs[n].is_route]
        if j.route_class in ("block", "exclude"):
            if cfg.gold_field:
                should_be_seen = j.gold_class in ("auto", "review")
                if j.route_class == "exclude" and should_be_seen:
                    allowed = ("auto", "review") if rd["primary_kept_includes_review"] else ("auto",)
                    if rd["primary_kept_any_not_suppressed"]:
                        allowed = ("auto", "review", "block")
                    kept = [d for d in primaries.get(i, []) if route.get(d) in allowed]
                    ot.append("SO-PRIMARY-SUPPRESSED" if kept else "SO-FALSE-DUPLICATE")
                if j.route_class == "block":
                    if decl_with_answer and j.gold_class != "block" and \
                            (rd["so_declined_on_exclude"] or j.gold_class != "exclude"):
                        ot.append("SO-DECLINED")
                    elif should_be_seen:
                        ot.append("SO-FALSE-BLOCK")
            else:
                if j.route_class == "block" and decl_with_answer:
                    ot.append("SO-DECLINED")
        if ot:
            j.omission = dict(types=ot, severity=worst(ot, cfg.severity))

        # review
        j.key_leaves_out = j.gold_class in ("block", "exclude") and             not (rd["any_mismatch_ignores_key_route"] and cfg.wrong_when == "any_mismatch")
        j.wasted = j.route_class == "review" and (j.key_leaves_out or not j.needs)
        res.records.append(j)
    res.by_id = {j.id: j for j in res.records}
    res.dupof = dupof
    return res


def rate(n, d):
    return st.rate_obj(n, d)


def summarize(run, readings=None):
    """Everything comparable at run level, from the judged records."""
    rd = dict(READINGS)
    rd.update(readings or {})
    cfg = run.cfg
    recs = run.records
    total = len(recs)
    s = {}
    by_class = {c: 0 for c in ("auto", "review", "block", "exclude")}
    by_route = {}
    for j in recs:
        by_class[j.route_class] += 1
        by_route[j.route] = by_route.get(j.route, 0) + 1
    s["total"] = total
    s["by_class"] = by_class
    s["by_route"] = by_route
    s["straight_through"] = rate(by_class["auto"], total)
    silent = [j for j in recs if j.silent]
    s["silent_rate"] = rate(len(silent), by_class["auto"])
    s["one_record_moves"] = None if by_class["auto"] == 0 else Fraction(100, by_class["auto"])
    bs = {k: 0 for k in ORDER}
    bt = {}
    for j in silent:
        bs[j.silent["severity"]] += 1
        for t in j.silent["types"]:
            bt[t] = bt.get(t, 0) + 1
    s["by_severity"] = bs
    s["by_type"] = bt
    s["silent_ids"] = [j.id for j in silent]
    sg = [j for j in recs if j.safeguards]
    s["safeguard_records"] = len(sg)
    t = {}
    for j in sg:
        for c in j.safeguards:
            t[c] = t.get(c, 0) + 1
    s["safeguard_types"] = t
    om = [j for j in recs if j.omission]
    ot = {}
    for j in om:
        for c in j.omission["types"]:
            ot[c] = ot.get(c, 0) + 1
    s["omission_types"] = ot
    s["omission_ids"] = [j.id for j in om]
    if cfg.gold_field:
        s["omission_basis"] = "gold_route"
        base = sum(1 for j in recs if j.gold_class in ("auto", "review"))
        s["omission_rate"] = rate(len(om), base)
    else:
        decl_outputs = [n for n, o in cfg.outputs.items() if o.can_decline and not o.is_route]
        if decl_outputs:
            s["omission_basis"] = "declines"
            base = 0
            for j in recs:
                if any((not j.info[n]["kdecl"]) and j.info[n]["klabel"] is not None for n in decl_outputs):
                    base += 1
            s["omission_rate"] = rate(len(om), base)
        else:
            s["omission_basis"] = None
            s["omission_rate"] = None
    rev = [j for j in recs if j.route_class == "review"]
    needed = [j for j in rev if not j.wasted]
    s["review_precision"] = rate(len(needed), len(rev))
    s["wasted"] = [j.id for j in rev if j.wasted]
    s["key_leaves_out"] = [j.id for j in rev if j.key_leaves_out]
    if cfg.gold_field and "block" in cfg.map.values():
        b = [j for j in recs if j.route_class == "block"]
        s["block_precision"] = rate(sum(1 for j in b if j.gold_class == "block"), len(b))
    else:
        s["block_precision"] = None

    # quality
    failed = [j.id for j in recs if j.failed]
    dups = [j.id for j in recs if j.route_class == "exclude" and not j.failed]
    pop = [j for j in recs if not j.failed and j.route_class != "exclude"]
    q = {"population": len(pop), "model_failed": failed, "suppressed_duplicates": dups, "outputs": {}}
    TP = FP = FN = 0
    any_set = False
    for name, out in cfg.outputs.items():
        if out.type == "set":
            any_set = True
            tp = fp = fn = 0
            exact = 0
            bv = {}

            def bump(v, f):
                bv.setdefault(v, {"tp": 0, "fp": 0, "fn": 0})[f] += 1

            for j in pop:
                i = j.info[name]
                appvals = set(x.value for x in i["applied"])
                rtp = [x.value for x in i["applied"] if x.value in i["union"]]
                rfp = [x.value for x in i["applied"] if x.value not in i["union"]]
                tp += len(rtp)
                fp += len(rfp)
                fn += len(i["unfilled"])
                if not rfp and not i["unfilled"]:
                    exact += 1
                for v in rtp:
                    bump(v, "tp")
                for v in rfp:
                    bump(v, "fp")
                for sl in i["unfilled"]:
                    bump(sl[0] if len(sl) == 1 else slot_name(sl, []), "fn")
            o = {"type": "set", "tp": tp, "fp": fp, "fn": fn, "precision": rate(tp, tp + fp),
                 "recall": rate(tp, tp + fn), "f1": st.f1(tp, fp, fn),
                 "exact_match": rate(exact, len(pop)), "by_value": bv}
            q["outputs"][name] = o
            TP += tp
            FP += fp
            FN += fn
        else:
            q["outputs"][name] = label_quality(name, out, pop)
    if any_set:
        q["overall"] = {"tp": TP, "fp": FP, "fn": FN, "precision": rate(TP, TP + FP),
                        "recall": rate(TP, TP + FN), "f1": st.f1(TP, FP, FN)}
    else:
        q["overall"] = None
    s["quality"] = q
    s["key_gaps"] = key_gaps(run)
    return s


def label_quality(name, out, pop):
    answers = [j for j in pop if not j.info[name]["declined"]]
    right = [j for j in answers if not j.info[name]["kdecl"] and j.info[name]["label"] == j.info[name]["klabel"]]
    o = {"type": out.type, "accuracy": rate(len(right), len(answers))}
    labels = list(out.labels)
    per = {}
    for L in labels:
        tp = fp = fn = 0
        for j in pop:
            i = j.info[name]
            ans = None if i["declined"] else i["label"]
            k = None if i["kdecl"] else i["klabel"]
            if ans == L and k == L:
                tp += 1
            elif ans == L:
                fp += 1
            elif k == L:
                fn += 1
        per[L] = {"tp": tp, "fp": fp, "fn": fn, "precision": rate(tp, tp + fp),
                  "recall": rate(tp, tp + fn), "f1": st.f1(tp, fp, fn)}
    o["per_label"] = per
    D = "(declined)"
    cols = labels + ([D] if out.can_decline else [])
    conf = {r: {c: 0 for c in cols} for r in cols if r != D or (out.decline_values)}
    for j in pop:
        i = j.info[name]
        r = D if i["kdecl"] else i["klabel"]
        c = D if i["declined"] else i["label"]
        if r in conf and c in cols:
            conf[r][c] += 1
    o["confusion"] = conf
    if out.can_decline:
        decl = [j for j in pop if j.info[name]["declined"]]
        unn = [j.id for j in decl if not j.info[name]["kdecl"]]
        should = [j.id for j in answers if j.info[name]["kdecl"]]
        o["declines"] = {
            "coverage": rate(len(answers), len(pop)), "declined": rate(len(decl), len(pop)),
            "unnecessary": rate(len(unn), len(decl)), "unnecessary_ids": unn,
            "should": None if not out.decline_values else rate(len(should), len(answers)),
            "should_ids": should,
            "correct": [j.id for j in decl if j.info[name]["kdecl"]],
            "key_declines": sum(1 for j in pop if j.info[name]["kdecl"]) if out.decline_values else None,
        }
    if out.type == "ordinal":
        d = []
        for j in pop:
            i = j.info[name]
            if i["label"] is None or i["klabel"] is None:
                continue
            d.append(out.labels.index(i["label"]) - out.labels.index(i["klabel"]))
        n = len(d)
        o["within_one"] = rate(sum(1 for x in d if abs(x) <= 1), n)
        o["mean_distance"] = Fraction(sum(abs(x) for x in d), n) if n else None
        o["mean_signed"] = Fraction(sum(d), n) if n else None
        L = len(out.labels) - 1
        o["closeness"] = 1 - Fraction(sum(abs(x) for x in d), n * L) if n and L else None
        o["predicted_higher"] = sum(1 for x in d if x > 0)
        o["predicted_lower"] = sum(1 for x in d if x < 0)
        md = {}
        for x in d:
            if x:
                md[abs(x)] = md.get(abs(x), 0) + 1
        o["miss_distances"] = md
    return o


def key_gaps(run):
    cfg = run.cfg
    out = []
    for j in run.records:
        if j.route_class == "exclude" or j.failed:
            continue
        for name, o in cfg.outputs.items():
            if o.type != "set":
                continue
            i = j.info[name]
            for s in i["applied"]:
                if s.value in i["union"]:
                    continue
                if s.inherited is not None:
                    continue
                if name in cfg.allowed and s.value not in cfg.allowed[name]:
                    continue
                out.append((j.id, name, s.value))
    return out


def group_rows(run, labels_of):
    """labels_of(judged) -> list of labels. The same arithmetic as the headline, on each row."""
    cfg = run.cfg
    rows = {}
    for j in run.records:
        for L in labels_of(j) or ["(none)"]:
            rows.setdefault(L, []).append(j)
    out = {}
    for L, rs in rows.items():
        auto = [j for j in rs if j.route_class == "auto"]
        rev = [j for j in rs if j.route_class == "review"]
        row = dict(records=len(rs), straight_through=rate(len(auto), len(rs)),
                   silent=rate(sum(1 for j in auto if j.silent), len(auto)),
                   silent_ids=[j.id for j in rs if j.silent],
                   review=rate(sum(1 for j in rev if not j.wasted), len(rev)),
                   unnecessary=[j.id for j in rev if j.wasted],
                   omission_ids=[j.id for j in rs if j.omission],
                   safeguard_ids=[j.id for j in rs if j.safeguards],
                   ids=[j.id for j in rs])
        if cfg.gold_field:
            row["omission"] = rate(sum(1 for j in rs if j.omission), sum(1 for j in rs if j.gold_class in ("auto", "review")))
            row["routed"] = rate(sum(1 for j in rs if j.route_class == j.gold_class), len(rs))
        else:
            decl = [n for n, o in cfg.outputs.items() if o.can_decline and not o.is_route]
            row["omission"] = None
            if decl:
                base = sum(1 for j in rs if any(not j.info[n]["kdecl"] and j.info[n]["klabel"] is not None for n in decl))
                row["omission"] = rate(sum(1 for j in rs if j.omission), base)
            row["routed"] = None
            row["routed_trap"] = rate(0, 0)
        out[L] = row
    return out
