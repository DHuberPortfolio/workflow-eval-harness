"""Run the harness as a black box and the oracle on the same files; compare field by field,
record by record. usage: python compare_runs.py [examples|fixtures|all] [--reading name=value ...]
Writes results/<set>.json and prints the disagreements grouped by field."""
import glob
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from fractions import Fraction

import oracle_core as oc
import oracle_stats as st

from where import HERE, BASE, WF
os.makedirs(os.path.join(HERE, "results"), exist_ok=True)


def harness(args, cwd=BASE):
    fd, out = tempfile.mkstemp(suffix=".json", dir=os.path.join(HERE, "tmp"))
    os.close(fd)
    os.remove(out)
    r = subprocess.run(["node", WF] + args + ["--json", out, "--quiet"], capture_output=True, text=True, cwd=cwd,
                       encoding="utf-8", errors="replace")
    d = None
    if r.returncode in (0, 3) and os.path.exists(out):
        with open(out, encoding="utf-8") as f:
            d = json.load(f)
    if os.path.exists(out):
        os.remove(out)
    return r.returncode, (r.stdout or "") + (r.stderr or ""), d


class Cmp:
    def __init__(self):
        self.values = Counter()
        self.agree = Counter()
        self.diffs = []

    def eq(self, area, field, rid, h, o):
        self.values[area] += 1
        if h == o:
            self.agree[area] += 1
        else:
            self.diffs.append(dict(area=area, field=field, id=rid, harness=h, oracle=o))

    def num(self, area, field, rid, h, exact, dp):
        self.values[area] += 1
        if st.close(h, exact, dp):
            self.agree[area] += 1
        else:
            self.diffs.append(dict(area=area, field=field, id=rid, harness=h,
                                   oracle=None if exact is None else float(st.D(exact))))

    def rate(self, area, field, rid, h, r):
        """h: {n,d,pct,low_pct,high_pct}; r: oracle Rate"""
        if r is None or h is None:
            self.eq(area, field, rid, None if h is None else "present", None if r is None else "present")
            return
        self.eq(area, field + ".n", rid, h["n"], r.n)
        self.eq(area, field + ".d", rid, h["d"], r.d)
        self.num(area, field + ".pct", rid, h["pct"], r.pct, 1)
        self.num(area, field + ".low_pct", rid, h["low_pct"], r.low_pct, 1)
        self.num(area, field + ".high_pct", rid, h["high_pct"], r.high_pct, 1)


def norm_list(x):
    return sorted(x) if x is not None else None


def compare(cmp, hj, run, s, name):
    # record by record
    hrecs = {r["id"]: r for r in hj["records"]}
    cmp.eq("records", "record set", name, sorted(hrecs), sorted(run.by_id))
    for j in run.records:
        if j.id not in hrecs:
            continue
        h = hrecs[j.id]
        rid = name + ":" + j.id
        cmp.eq("records", "route_class", rid, h["route_class"], j.route_class)
        cmp.eq("records", "gold_class", rid, h["gold_class"], j.gold_class)
        cmp.eq("records", "needs_human", rid, h["needs_human"], bool(j.needs))
        cmp.eq("records", "silent", rid, h["silent"] is not None, j.silent is not None)
        cmp.eq("records", "silent.types", rid, norm_list((h["silent"] or {}).get("types")),
               norm_list((j.silent or {}).get("types")))
        cmp.eq("records", "silent.severity", rid, (h["silent"] or {}).get("severity"), (j.silent or {}).get("severity"))
        cmp.eq("records", "omission.types", rid, norm_list((h["omission"] or {}).get("types")),
               norm_list((j.omission or {}).get("types")))
        cmp.eq("records", "omission.severity", rid, (h["omission"] or {}).get("severity"),
               (j.omission or {}).get("severity"))
        hs = sorted(x["type"] if isinstance(x, dict) else x for x in h["safeguards"])
        cmp.eq("records", "safeguards", rid, hs, sorted(j.safeguards))
        cmp.eq("records", "wasted_review", rid, h["wasted_review"], j.wasted)
        cmp.eq("records", "key_leaves_out", rid, h["key_leaves_out"], j.key_leaves_out)
        for kind in ("wrong", "missing_rejected", "missing", "invalid", "near_miss", "declined", "should_decline"):
            ho = {k: sorted(v) for k, v in h["differences"][kind].items()}
            oo = {k: sorted(v) for k, v in j.diff[kind].items()}
            cmp.eq("records", "differences." + kind, rid, ho, oo)
    # headline
    r = hj["routing"]
    a = "headline"
    cmp.eq(a, "total", name, r["total"], s["total"])
    cmp.eq(a, "by_class", name, r["by_class"], s["by_class"])
    cmp.eq(a, "by_route", name, r["by_route"], s["by_route"])
    cmp.rate(a, "straight_through", name, r["straight_through"], s["straight_through"])
    se = r["silent_errors"]
    cmp.rate(a, "silent_rate", name, se["rate"], s["silent_rate"])
    cmp.num(a, "one_record_moves_pct", name, se.get("one_record_moves_pct"), s["one_record_moves"], 1)
    cmp.eq(a, "by_severity", name, se["by_severity"], s["by_severity"])
    cmp.eq(a, "by_type", name, {k: v["records"] for k, v in se["by_type"].items()}, s["by_type"])
    cmp.eq(a, "silent_ids", name, sorted(x["id"] for x in se["records"]), sorted(s["silent_ids"]))
    sg = r["safeguard_failures"]
    cmp.eq(a, "safeguard_records", name, sg["records"], s["safeguard_records"])
    cmp.eq(a, "safeguard_types", name, {k: (v["records"] if isinstance(v, dict) else v) for k, v in sg["by_type"].items()},
           s["safeguard_types"])
    so = r["silent_omissions"]
    cmp.eq(a, "omission_basis", name, so["basis"] if so else None, s["omission_basis"])
    cmp.rate(a, "omission_rate", name, so["rate"] if so else None, s["omission_rate"])
    cmp.eq(a, "omission_types", name, {k: v["records"] for k, v in (so or {"by_type": {}})["by_type"].items()},
           s["omission_types"])
    rq = r["review_queue"]
    cmp.rate(a, "review_precision", name, rq["precision"], s["review_precision"])
    cmp.eq(a, "wasted", name, sorted(rq["wasted"]), sorted(s["wasted"]))
    cmp.eq(a, "key_leaves_out", name, sorted(rq["key_leaves_out"]), sorted(s["key_leaves_out"]))
    b = r.get("block")
    cmp.rate(a, "block_precision", name, b["precision"] if b else None, s["block_precision"])
    # quality
    q = hj["quality"]
    oq = s["quality"]
    a = "quality"
    cmp.eq(a, "population", name, q["population"], oq["population"])
    cmp.eq(a, "model_failed", name, sorted(q["left_out"]["model_failed"]), sorted(oq["model_failed"]))
    cmp.eq(a, "suppressed_duplicates", name, sorted(q["left_out"]["suppressed_duplicates"]),
           sorted(oq["suppressed_duplicates"]))
    for oname, ho in q["outputs"].items():
        oo = oq["outputs"][oname]
        pre = oname + "."
        if ho["type"] == "set":
            for f in ("tp", "fp", "fn"):
                cmp.eq(a, pre + f, name, ho[f], oo[f])
            cmp.rate(a, pre + "precision", name, ho["precision"], oo["precision"])
            cmp.rate(a, pre + "recall", name, ho["recall"], oo["recall"])
            cmp.num(a, pre + "f1", name, ho["f1"], oo["f1"], 3)
            cmp.rate(a, pre + "exact_match", name, ho["exact_match"], oo["exact_match"])
            for v, hv in ho["by_value"].items():
                ov = oo["by_value"].get(v, {"tp": 0, "fp": 0, "fn": 0})
                cmp.eq(a, pre + "by_value.tp", name + ":" + v, hv["tp"], ov["tp"])
                cmp.eq(a, pre + "by_value.fp", name + ":" + v, hv["fp"], ov["fp"])
                cmp.eq(a, pre + "by_value.fn", name + ":" + v, hv["fn"], ov["fn"])
        else:
            cmp.rate(a, pre + "accuracy", name, ho["accuracy"], oo["accuracy"])
            for L, hv in ho["per_label"].items():
                ov = oo["per_label"].get(L)
                if ov is None:
                    cmp.eq(a, pre + "per_label", name + ":" + L, "present", None)
                    continue
                for f in ("tp", "fp", "fn"):
                    cmp.eq(a, pre + "per_label." + f, name + ":" + L, hv[f], ov[f])
                cmp.rate(a, pre + "per_label.precision", name + ":" + L, hv["precision"], ov["precision"])
                cmp.rate(a, pre + "per_label.recall", name + ":" + L, hv["recall"], ov["recall"])
                cmp.num(a, pre + "per_label.f1", name + ":" + L, hv["f1"], ov["f1"], 3)
            cmp.eq(a, pre + "confusion", name, ho["confusion"], oo["confusion"])
            if "declines" in ho:
                hd, od = ho["declines"], oo.get("declines") or {}
                cmp.rate(a, pre + "coverage", name, hd["coverage"], od.get("coverage"))
                cmp.rate(a, pre + "declined", name, hd["declined"], od.get("declined"))
                cmp.rate(a, pre + "unnecessary", name, hd["unnecessary"]["rate"], od.get("unnecessary"))
                cmp.eq(a, pre + "unnecessary.ids", name, sorted(hd["unnecessary"]["ids"]), sorted(od.get("unnecessary_ids", [])))
                sh = hd.get("should_have_declined")
                cmp.rate(a, pre + "should", name, sh["rate"] if sh else None, od.get("should"))
                cmp.eq(a, pre + "should.ids", name, sorted(sh["ids"]) if sh else [],
                       sorted(od.get("should_ids", [])) if od.get("should") is not None else [])
                cmp.eq(a, pre + "correct", name, sorted(hd["correct_declines"]), sorted(od.get("correct", [])))
                cmp.eq(a, pre + "key_declines", name, hd["key_declines"], od.get("key_declines"))
            if ho["type"] == "ordinal":
                cmp.rate(a, pre + "within_one", name, ho["within_one"], oo["within_one"])
                cmp.num(a, pre + "mean_distance", name, ho["mean_distance"], oo["mean_distance"], 2)
                cmp.num(a, pre + "mean_signed", name, ho["mean_signed"], oo["mean_signed"], 2)
                cmp.num(a, pre + "closeness", name, ho["closeness"], oo["closeness"], 3)
                cmp.eq(a, pre + "predicted_higher", name, ho["predicted_higher"], oo["predicted_higher"])
                cmp.eq(a, pre + "predicted_lower", name, ho["predicted_lower"], oo["predicted_lower"])
                cmp.eq(a, pre + "miss_distances", name, {int(k): v for k, v in ho["miss_distances"].items()},
                       oo["miss_distances"])
    ho = q.get("overall")
    oo = oq["overall"]
    if ho and oo:
        for f in ("tp", "fp", "fn"):
            cmp.eq(a, "overall." + f, name, ho[f], oo[f])
        cmp.rate(a, "overall.precision", name, ho["precision"], oo["precision"])
        cmp.rate(a, "overall.recall", name, ho["recall"], oo["recall"])
        cmp.num(a, "overall.f1", name, ho["f1"], oo["f1"], 3)
    else:
        cmp.eq(a, "overall present", name, ho is not None, oo is not None)
    # per trap and per group: routed as the key says, and the headline rows
    a = "routing_rows"
    cfg = run.cfg
    for j in run.records:
        if j.id in hrecs:
            cmp.eq(a, "traps", name + ":" + j.id, sorted(hrecs[j.id]["traps"]), sorted(j.traps))
    if cfg.trap_field and hj.get("traps"):
        rows = oc.group_rows(run, lambda j: j.traps)
        ids = lambda xs: sorted(x["id"] if isinstance(x, dict) else x for x in xs)
        for g in hj["traps"]["groups"]:
            o = rows.get(g["trap"])
            tag = name + ":trap:" + g["trap"]
            if o is None:
                cmp.eq(a, "trap present", tag, "present", None)
                continue
            cmp.eq(a, "trap.records", tag, ids(g["records"]), sorted(o["ids"]))
            cmp.rate(a, "trap.routed_correctly", tag, g["routed_correctly"], o["routed"] if o["routed"] is not None else o["routed_trap"])
            cmp.eq(a, "trap.silent_errors", tag, ids(g["silent_errors"]), sorted(o["silent_ids"]))
            cmp.eq(a, "trap.silent_omissions", tag, ids(g["silent_omissions"]), sorted(o["omission_ids"]))
            cmp.eq(a, "trap.wasted_reviews", tag, ids(g["wasted_reviews"]), sorted(o["unnecessary"]))
            cmp.eq(a, "trap.safeguard_failures", tag, ids(g["safeguard_failures"]), sorted(o["safeguard_ids"]))
    if hj.get("groups") and getattr(run, "group_field", None):
        for grp in hj["groups"]:
            rows = oc.group_rows(run, lambda j: run.group_labels[j.id])
            for g in grp["rows"]:
                tag = name + ":group:" + g["label"]
                o = rows.get(g["label"])
                if o is None:
                    cmp.eq(a, "group present", tag, "present", None)
                    continue
                cmp.eq(a, "group.records", tag, g["records"], o["records"])
                cmp.rate(a, "group.straight_through", tag, g["straight_through"], o["straight_through"])
                cmp.rate(a, "group.silent", tag, g["silent_errors"]["rate"], o["silent"])
                cmp.eq(a, "group.silent.ids", tag, sorted(g["silent_errors"]["ids"]), sorted(o["silent_ids"]))
                so = g.get("silent_omissions")
                cmp.rate(a, "group.omission", tag, (so or {}).get("rate") if so else None, o["omission"])
                cmp.rate(a, "group.review", tag, g["review_precision"]["rate"], o["review"])
                cmp.eq(a, "group.unnecessary", tag, sorted(g["review_precision"]["unnecessary"]), sorted(o["unnecessary"]))
                cmp.rate(a, "group.routed", tag, g["routed_correctly"], o["routed"])
    hk = sorted((c["id"], c["output"], c["value"]) for c in hj["key_gaps"]["candidates"])
    cmp.eq("key_gaps", "candidates", name, hk, sorted(s["key_gaps"]))


def run_case(cmp, c, readings):
    args = ["score", "--config", c["config"], "--pred", c["pred"], "--key", c["key"]] + c.get("extra", [])
    code, text, hj = harness(args, cwd=c.get("cwd", BASE))
    if hj is None:
        return dict(name=c["name"], code=code, stopped=True, msg=text.strip()[:400])
    root = c.get("cwd", BASE)
    cfg = oc.Config(os.path.join(root, c["config"]))
    preds, pcsv = oc.load_records(os.path.join(root, c["pred"]), cfg.input.get("predictions"))
    keys, kcsv = oc.load_records(os.path.join(root, c["key"]), cfg.input.get("key"))
    only = None
    if c.get("only_ids") is not None:
        only = c["only_ids"](cfg, preds, keys)
    run = oc.judge_run(cfg, preds, keys, pcsv, kcsv, readings, only_ids=only)
    run.group_field = c.get("group_by")
    if run.group_field:
        km = {oc.text(oc.get_path(k, cfg.id_field)[1]): k for k in keys}
        run.group_labels = {}
        for j in run.records:
            v = oc.get_path(km[j.id], run.group_field)[1]
            run.group_labels[j.id] = [] if v in (None, "", []) else ([oc.text(x) for x in v] if isinstance(v, list) else [oc.text(v)])
    s = oc.summarize(run, readings)
    compare(cmp, hj, run, s, c["name"])
    return dict(name=c["name"], code=code, stopped=False, records=len(run.records))


def example_cases():
    E = "examples/"
    out = []
    M = E + "metadata-enrichment/"
    for f in ["run49.json"] + ["runs/exec-%d.json" % i for i in (61, 62, 63)]:
        out.append(dict(name="meta/" + f, config=M + "config.json", pred=M + f, key=M + f))
    for i in range(68, 73):
        f = M + "golden500/exec-%d.json" % i
        out.append(dict(name="meta/g500-%d" % i, config=M + "golden500/config.json", pred=f, key=f))
    C = E + "compliance-reviewer/"
    for f in sorted(glob.glob(os.path.join(BASE, C, "runs", "*.harness.json"))) + \
            sorted(glob.glob(os.path.join(BASE, C, "golden500", "*.harness.json"))):
        rel = os.path.relpath(f, BASE).replace("\\", "/")
        out.append(dict(name="comp/" + os.path.basename(f), config=C + "config.json", pred=rel, key=rel))
    return out


def fixture_cases():
    F = "test/fixtures/"
    out = []

    def add(fx, cfg, pred, key, name=None):
        out.append(dict(name=name or "%s/%s" % (fx, os.path.basename(pred)), config=F + fx + "/" + cfg,
                        pred=F + fx + "/" + pred, key=F + fx + "/" + key))

    add("tiny", "config.json", "predictions.json", "key.json")
    add("alternatives", "config.json", "predictions.json", "key.json")
    for p in ("predictions.json", "predictions-clumped.json", "predictions-even.json", "predictions-perfect.json"):
        add("clusters", "config.json", p, "key.json")
    add("compliance", "config.json", "predictions.csv", "key.csv")
    add("declines", "config.json", "predictions.json", "key.json")
    add("gate", "config.json", "predictions.json", "key.json")
    add("ordinal", "config.json", "predictions.json", "key.json")
    add("policy", "config.json", "predictions.json", "key.json")
    add("policy", "config.json", "predictions.csv", "key.json")
    add("policy/combined", "config.json", "pred.json", "key.json", "policy/combined-pair")
    add("policy/combined", "config.json", "combined.json", "combined.json", "policy/combined-one")
    add("queue", "config.json", "predictions.json", "key.json")
    add("queue", "config.json", "predictions-after.json", "key.json")
    add("rulings", "config.json", "predictions.json", "key.json")
    add("rulings", "config.json", "predictions.json", "key-v2.json", "rulings/key-v2")
    for r in ("run-a.json", "run-b.json", "run-c.json"):
        out.append(dict(name="runs/" + r, config=F + "tiny/config.json", pred=F + "runs/" + r, key=F + "tiny/key.json"))
    out.append(dict(name="shapes/n8n", config=F + "shapes/n8n.config.json", pred=F + "shapes/n8n.json", key=F + "tiny/key.json"))
    out.append(dict(name="shapes/agent", config=F + "shapes/agent.config.json", pred=F + "shapes/agent.jsonl", key=F + "tiny/key.json"))
    out.append(dict(name="shapes/api", config=F + "shapes/api.config.json", pred=F + "shapes/api.json", key=F + "tiny/key.json"))
    out.append(dict(name="shapes/combined", config=F + "shapes/combined.config.json", pred=F + "shapes/combined.json", key=F + "shapes/combined.json"))
    out.append(dict(name="shapes/sheet", config=F + "shapes/sheet.config.json", pred=F + "shapes/sheet.csv", key=F + "shapes/key.csv"))
    for r in ("run-a.json", "run-b.json"):
        add("suspects", "config.json", r, "key.json")
    for r in ("2026-W40.json", "2026-W41.json", "2026-W42.json"):
        add("monitor", "config.json", "runs/" + r, "runs/" + r, "monitor/" + r)
        add("monitor-segments", "config.json", "runs/" + r, "runs/" + r, "monitor-seg/" + r)
    add("estimate", "config.json", "predictions.json", "judge-key.json", "estimate/judge")
    return out


def report(cmp, stops, title):
    print("==", title)
    tot, ag = sum(cmp.values.values()), sum(cmp.agree.values())
    for a in cmp.values:
        print("  %-10s values %8d  agree %8d" % (a, cmp.values[a], cmp.agree[a]))
    print("  TOTAL      values %8d  agree %8d  disagree %d" % (tot, ag, tot - ag))
    print("  stopped cases:", len([s for s in stops if s.get("stopped")]))
    for s in stops:
        if s.get("stopped"):
            print("    ", s["name"], s["code"], s["msg"][:200])
    g = Counter((d["area"], d["field"]) for d in cmp.diffs)
    for (a, f), n in g.most_common():
        ex = [d for d in cmp.diffs if d["area"] == a and d["field"] == f][:2]
        print("  %5d  %s/%s" % (n, a, f))
        for d in ex:
            print("         %s  harness=%s  oracle=%s" % (d["id"], json.dumps(d["harness"], default=str)[:160],
                                                          json.dumps(d["oracle"], default=str)[:160]))


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    readings = {}
    for a in sys.argv[2:]:
        k, v = a.split("=")
        readings[k] = json.loads(v)
    cases = []
    if which in ("examples", "all"):
        cases += example_cases()
    if which in ("fixtures", "all"):
        cases += fixture_cases()
    cmp = Cmp()
    stops = []
    for c in cases:
        stops.append(run_case(cmp, c, readings))
    report(cmp, stops, which)
    with open(os.path.join(HERE, "results", which + ".json"), "w", encoding="utf-8") as f:
        json.dump(dict(values=dict(cmp.values), agree=dict(cmp.agree), diffs=cmp.diffs, cases=stops), f, indent=1, default=str)


if __name__ == "__main__":
    main()
