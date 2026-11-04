"""The harness grades itself. For the generated scenario set, the harness is the workflow being
graded: predictions.json holds what the harness said for each record, key.json what the oracle
says, config.json lets `wfeval score` read them. The result is checked again in plain Python,
because the scorer is the thing under test.
usage: python harness_grades_itself.py [name=value readings ...]"""
import json
import os
import sys
from collections import Counter

import compare_runs as cr
import compare_generated as cg
import oracle_core as oc
import oracle_stats as st

HERE = cr.HERE
OUT = os.path.join(HERE, "grades_itself")
os.makedirs(OUT, exist_ok=True)


def main():
    readings = {}
    for a in sys.argv[1:]:
        k, v = a.split("=")
        readings[k] = json.loads(v)
    tag = "-readings" if readings else ""
    preds, keys = [], []
    for c in cg.cases(False):
        code, text, hj = cr.harness(["score", "--config", c["config"], "--pred", c["pred"], "--key", c["key"]] + c["extra"], cwd=HERE)
        if hj is None:
            print("stopped", c["name"], text[:200])
            continue
        cfg = oc.Config(os.path.join(HERE, c["config"]))
        p, pc = oc.load_records(os.path.join(HERE, c["pred"]), cfg.input.get("predictions"))
        k, kc = oc.load_records(os.path.join(HERE, c["key"]), cfg.input.get("key"))
        run = oc.judge_run(cfg, p, k, pc, kc, readings)
        hr = {r["id"]: r for r in hj["records"]}
        for j in run.records:
            h = hr[j.id]
            rid = c["name"] + "::" + j.id
            preds.append({"id": rid, "route": h["route_class"], "silent": "yes" if h["silent"] else "no",
                          "types": sorted((h["silent"] or {}).get("types", [])),
                          "omission_types": sorted((h["omission"] or {}).get("types", []))})
            keys.append({"id": rid, "gold": j.route_class, "silent": "yes" if j.silent else "no",
                         "types": sorted((j.silent or {}).get("types", [])),
                         "omission_types": sorted((j.omission or {}).get("types", [])),
                         "scenario": c["name"]})
    config = {"outputs": {"silent": {"type": "label", "labels": ["yes", "no"]},
                          "types": {"type": "set"}, "omission_types": {"type": "set"}},
              "routing": {"field": "route", "gold_field": "gold",
                          "map": {"auto": "auto", "review": "review", "block": "block", "exclude": "exclude"}}}
    pf, kf, cf = "predictions%s.json" % tag, "key%s.json" % tag, "config.json"
    json.dump(preds, open(os.path.join(OUT, pf), "w"), indent=0)
    json.dump(keys, open(os.path.join(OUT, kf), "w"), indent=0)
    json.dump(config, open(os.path.join(OUT, cf), "w"), indent=1)
    code, text, hj = cr.harness(["score", "--config", cf, "--pred", pf, "--key", kf], cwd=OUT)
    print("wfeval score exit", code, text.strip()[:300])
    json.dump(hj, open(os.path.join(OUT, "score%s.json" % tag), "w"), indent=1)
    r = hj["routing"]
    q = hj["quality"]
    print("records", r["total"], "by_class", r["by_class"])
    print("silent error rate", r["silent_errors"]["rate"], "by_type", {k: v["records"] for k, v in r["silent_errors"]["by_type"].items()})
    print("straight-through", r["straight_through"])
    print("silent omissions", r["silent_omissions"]["rate"], "review precision", r["review_queue"]["precision"])
    print("block precision", (r.get("block") or {}).get("precision"))
    print("quality silent accuracy", q["outputs"]["silent"]["accuracy"], "confusion", q["outputs"]["silent"]["confusion"])
    for o in ("types", "omission_types"):
        x = q["outputs"][o]
        print(o, "tp", x["tp"], "fp", x["fp"], "fn", x["fn"], "precision", x["precision"]["pct"], "recall", x["recall"]["pct"], "f1", x["f1"], "exact", x["exact_match"])
    print("overall", q["overall"]["tp"], q["overall"]["fp"], q["overall"]["fn"], q["overall"]["f1"])

    # the Python re-check, by plain counting: no oracle_core, no harness
    km = {k["id"]: k for k in keys}
    n = len(preds)
    out = [p for p in preds if p["route"] == "auto"]
    for p in preds:
        k = km[p["id"]]
        vals = p["silent"] != k["silent"] or set(p["types"]) != set(k["types"]) or set(p["omission_types"]) != set(k["omission_types"])
        p["_vals"] = vals
        p["_needs"] = k["gold"] != "auto" or vals
    silent = [p for p in out if p["_needs"]]
    bc = Counter(p["route"] for p in preds)
    base = [p for p in preds if km[p["id"]]["gold"] in ("auto", "review")]
    om = [p for p in base if p["route"] in ("block", "exclude")]
    rev = [p for p in preds if p["route"] == "review"]
    revn = [p for p in rev if p["_needs"] and km[p["id"]]["gold"] not in ("block", "exclude")]
    blk = [p for p in preds if p["route"] == "block"]
    blkk = [p for p in blk if km[p["id"]]["gold"] == "block"]

    def prf(field):
        tp = fp = fn = 0
        ex = 0
        pop = [p for p in preds if p["route"] != "exclude"]
        for p in pop:
            a, b = set(p[field]), set(km[p["id"]][field])
            tp += len(a & b)
            fp += len(a - b)
            fn += len(b - a)
            ex += a == b
        return tp, fp, fn, ex, len(pop)

    check = []

    def eq(name, h, o):
        check.append((name, h, o, h == o))

    eq("total", r["total"], n)
    eq("by_class", r["by_class"], {c: bc.get(c, 0) for c in ("auto", "review", "block", "exclude")})
    eq("silent n", r["silent_errors"]["rate"]["n"], len(silent))
    eq("silent d", r["silent_errors"]["rate"]["d"], len(out))
    eq("omission n", r["silent_omissions"]["rate"]["n"], len(om))
    eq("omission d", r["silent_omissions"]["rate"]["d"], len(base))
    eq("review n", r["review_queue"]["precision"]["n"], len(revn))
    eq("review d", r["review_queue"]["precision"]["d"], len(rev))
    eq("block n", r["block"]["precision"]["n"], len(blkk))
    eq("block d", r["block"]["precision"]["d"], len(blk))
    for f in ("types", "omission_types"):
        tp, fp, fn, ex, pop = prf(f)
        x = q["outputs"][f]
        eq(f + " tp", x["tp"], tp)
        eq(f + " fp", x["fp"], fp)
        eq(f + " fn", x["fn"], fn)
        eq(f + " exact", x["exact_match"]["n"], ex)
        eq(f + " pop", x["exact_match"]["d"], pop)
    hr = st.rate_obj(len(silent), len(out))
    print("python re-check:", sum(c[3] for c in check), "of", len(check), "values agree")
    for c in check:
        if not c[3]:
            print("   DIFF", c)
    print("   silent rate range, python: %.1f%% (%.1f-%.1f); harness %s-%s" % (
        float(hr.pct), float(hr.low_pct), float(hr.high_pct), r["silent_errors"]["rate"]["low_pct"], r["silent_errors"]["rate"]["high_pct"]))
    dis = [p["id"] for p in preds if p["route"] != km[p["id"]]["gold"] or p["_vals"]]
    print("   records where harness and oracle differ at all:", len(dis), Counter(x.split("::")[0] for x in dis).most_common(10))
    print("   python count, silent yes/no equal:", sum(p["silent"] == km[p["id"]]["silent"] for p in preds), "of", n)
    print("   python count, type list equal:", sum(set(p["types"]) == set(km[p["id"]]["types"]) for p in preds), "of", n)
    print("   python count, omission list equal:", sum(set(p["omission_types"]) == set(km[p["id"]]["omission_types"]) for p in preds), "of", n)
    print("   python count, route equal:", sum(p["route"] == km[p["id"]]["gold"] for p in preds), "of", n)


if __name__ == "__main__":
    main()
