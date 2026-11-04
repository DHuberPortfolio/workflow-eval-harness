"""Which half each record falls in (SHA-256 point, CRC-32 parity), by unit, against the harness:
the held-out ids in split.log, the tuning records in --json, and each half's rates judged on its
own records. usage: python check_split.py [seed] [count]"""
import hashlib
import json
import os
import random
import shutil
import subprocess
import sys
import zlib
from concurrent.futures import ThreadPoolExecutor

import oracle_core as oc
import oracle_stats as st
from check_stats import Tally, WF, BASE, HERE
from compare_runs import Cmp, compare

WORK = os.path.join(HERE, "tmp", "split")
os.makedirs(WORK, exist_ok=True)


def node(args, cwd):
    return subprocess.run(["node", WF] + args, capture_output=True, text=True, cwd=cwd, encoding="utf-8", errors="replace")


def sha_point(salt, name):
    s = (salt + ":" + name) if salt else name
    return int.from_bytes(hashlib.sha256(s.encode("utf-8")).digest()[:4], "big") / 2 ** 32


def crc_odd(name):
    return zlib.crc32(name.encode("utf-8")) & 1 == 1


def partition(cfg, keys, split):
    by = split.get("by", "cluster")
    hash_ = split.get("hash", "sha256")
    salt = split.get("salt", "")
    h = split.get("held_out", 0.5)
    km = {oc.text(oc.get_path(k, cfg.id_field)[1]): k for k in keys}
    cl = cfg.clusters
    df = cfg.duplicate_of_field

    def unit(i, seen=()):
        if by == "id":
            return i
        k = km.get(i)
        if k is not None and cl:
            v = oc.get_path(k, cl["field"])[1]
            if v not in (None, ""):
                return oc.text(v)
        if k is not None and df:
            v = oc.get_path(k, df)[1]
            if v not in (None, "") and oc.text(v) not in seen:
                return unit(oc.text(v), seen + (i,))
        return i

    held = set()
    for i in km:
        u = unit(i)
        if hash_ == "crc32":
            if crc_odd(u):
                held.add(i)
        elif sha_point(salt, u) < h:
            held.add(i)
    return held


NAMES = ["doc-%d", "R%04d", "案件-%d", "é%d", "item %d", "%d", "a:b-%d", "😀-%d", "CASE_%d", "tkt/%d"]


def gen(rng, idx):
    n = rng.choice([5, 12, 30, 60, 120, 240])
    style = rng.choice(NAMES)
    ids = [style % i for i in range(1, n + 1)]
    hash_ = rng.choice(["sha256", "sha256", "sha256", "crc32"])
    split = {"hash": hash_, "log": "log.json"}
    if hash_ == "sha256":
        v = rng.choice([None, 0.5, 0.1, 0.3, 0.7, 0.9, 0.25])
        if v is not None:
            split["held_out"] = v
        s = rng.choice([None, "", "x", "golden-2026", "sälz", "a b", "k:v"])
        if s is not None:
            split["salt"] = s
    by = rng.choice([None, "cluster", "id"])
    if by:
        split["by"] = by
    use_dup = rng.random() < 0.6
    use_clu = rng.random() < 0.5 and not (hash_ == "crc32" and False)
    cfg = {"outputs": {"tags": {"type": "set"}},
           "routing": {"field": "route", "gold_field": "gold", "map": {"OUT": "auto", "ASK": "review", "DENY": "block", "DUP": "exclude"}},
           "split": split}
    if use_dup:
        cfg["duplicate_of_field"] = "dup"
    if use_clu:
        cfg["clusters"] = {"field": "story"}
    pred, key = [], []
    for i, x in enumerate(ids):
        g = rng.choice(["OUT", "OUT", "OUT", "ASK", "DENY"])
        k = {"id": x, "gold": g, "tags": ["A"]}
        if use_clu and rng.random() < 0.6:
            k["story"] = rng.choice(["s1", "s2", "s3", "故事", "s5", 7, 8])
        if use_dup and i > 0 and rng.random() < 0.3:
            k["dup"] = ids[rng.randrange(0, i)]
            k["gold"] = "DUP"
        r = rng.choice(["OUT", "OUT", "OUT", "OUT", "ASK", "DENY", "DUP"])
        pred.append({"id": x, "route": r, "tags": ["A" if rng.random() < 0.8 else "B"]})
        key.append(k)
    return cfg, pred, key


def one(a):
    idx, (cfg, pred, key) = a
    d = os.path.join(WORK, "c%04d" % idx)
    os.makedirs(d, exist_ok=True)
    for fn, o in (("config.json", cfg), ("pred.json", pred), ("key.json", key)):
        json.dump(o, open(os.path.join(d, fn), "w", encoding="utf-8"), ensure_ascii=False)
    r = node(["score", "--config", "config.json", "--pred", "pred.json", "--key", "key.json", "--held-out", "--lenient",
              "--json", "o.json", "--quiet"], d)
    o = log = None
    if os.path.exists(os.path.join(d, "o.json")):
        o = json.load(open(os.path.join(d, "o.json"), encoding="utf-8"))
    if os.path.exists(os.path.join(d, "log.json")):
        log = json.load(open(os.path.join(d, "log.json"), encoding="utf-8"))
    conf = oc.Config(os.path.join(d, "config.json"))
    res = (r, o, log, conf)
    return res


def held_section(T, tag, h, cfg, pred, key, ids):
    run = oc.judge_run(cfg, pred, key, only_ids=ids)
    s = oc.summarize(run)
    T.add("split.held.records", h["records"] == len(run.records), (tag, h["records"], len(run.records)))
    pairs = [("silent_errors", s["silent_rate"]), ("straight_through", s["straight_through"]),
             ("silent_omissions", s["omission_rate"]), ("review_precision", s["review_precision"]),
             ("block_precision", s["block_precision"])]
    for name, r in pairs:
        hv = h.get(name)
        if hv is None or r is None:
            T.add("split.held." + name, (hv is None) == (r is None) or (r is not None and r.d == 0), (tag, hv, None if r is None else (r.n, r.d)))
            continue
        good = hv["n"] == r.n and hv["d"] == r.d and st.close(hv["pct"], r.pct, 1) and st.close(hv["low_pct"], r.low_pct, 1) and st.close(hv["high_pct"], r.high_pct, 1)
        T.add("split.held." + name, good, (tag, hv, (r.n, r.d)))
    T.add("split.held.by_severity", h["silent_errors"].get("by_severity") == s["by_severity"], (tag, h["silent_errors"].get("by_severity"), s["by_severity"]))
    T.add("split.held.safeguard_failures", h["safeguard_failures"] == s["safeguard_records"], (tag, h["safeguard_failures"], s["safeguard_records"]))
    T.add("split.held.model_calls_failed", h["model_calls_failed"] == len(s["quality"]["model_failed"]), (tag, h["model_calls_failed"], s["quality"]["model_failed"]))


def main():
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 20261103
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 300
    rng = random.Random(seed)
    T = Tally()
    cases = [gen(rng, i) for i in range(count)]
    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(one, enumerate(cases)))
    cmp = Cmp()
    for i, ((cfgd, pred, key), (r, o, log, conf)) in enumerate(zip(cases, results)):
        tag = "c%d" % i
        if o is None:
            T.add("split.ran", False, (tag, cfgd["split"], (r.stdout + r.stderr)[:260]))
            continue
        held = partition(conf, key, cfgd["split"])
        allids = {oc.text(x["id"]) for x in key}
        tune = allids - held
        hj = {x["id"] for x in o["records"]}
        T.add("split.tuning ids (--json records)", hj == tune, (tag, cfgd["split"], sorted(hj ^ tune)[:6]))
        T.add("split.tuning count", o["split"]["tuning"]["records"] == len(tune), (tag, o["split"]["tuning"], len(tune)))
        if log and log.get("looks"):
            ho = set(log["looks"][-1].get("held_out_ids", []))
            T.add("split.held-out ids (split.log)", ho == held, (tag, cfgd["split"], sorted(ho ^ held)[:6]))
        h = o["split"].get("held_out")
        if h and held:
            held_section(T, tag, h, conf, pred, key, held)
        # every field of the tuning half, judged on its own records
        run = oc.judge_run(conf, pred, key, only_ids=tune)
        s = oc.summarize(run)
        compare(cmp, o, run, s, tag)
    # real examples: no log, no look written anywhere in the base folder
    for name, cfgp, runs in (
            ("meta-crc32", "examples/metadata-enrichment/golden500/config-split.json", ["examples/metadata-enrichment/golden500/exec-%d.json" % i for i in (68, 69, 70, 71, 72)]),
            ("comp-sha256", "examples/compliance-reviewer/config-split.json", ["examples/compliance-reviewer/golden500/exec-67.harness.json"])):
        conf = oc.Config(os.path.join(BASE, cfgp))
        for f in runs:
            out = os.path.join(WORK, "ex.json")
            rr = subprocess.run(["node", WF, "score", "--config", cfgp, "--pred", f, "--key", f, "--held-out", "--json", out, "--quiet"],
                                capture_output=True, text=True, cwd=BASE, encoding="utf-8", errors="replace")
            o = json.load(open(out, encoding="utf-8"))
            pred, _ = oc.load_records(os.path.join(BASE, f), None)
            held = partition(conf, pred, conf.split or {})
            allids = {oc.text(x["id"]) for x in pred}
            tune = allids - held
            hj = {x["id"] for x in o["records"]}
            T.add("split.example tuning ids", hj == tune, (name, f, sorted(hj ^ tune)[:6]))
            held_section(T, name + f, o["split"]["held_out"], conf, pred, pred, held)
            run = oc.judge_run(conf, pred, pred, only_ids=tune)
            compare(cmp, o, run, oc.summarize(run), name + ":" + os.path.basename(f))
            print("  %-12s %-34s tuning %3d, silent %d of %d; held out %3d, silent %d of %d" % (
                name, os.path.basename(f), len(tune), o["routing"]["silent_errors"]["rate"]["n"], o["routing"]["silent_errors"]["rate"]["d"],
                len(held), o["split"]["held_out"]["silent_errors"]["n"], o["split"]["held_out"]["silent_errors"]["d"]))
    # the repo's split fixture, against each of its keys
    F = "test/fixtures/split/"
    for kf in ("key.json", "key-grown.json", "key-story.json"):
        for pf in ("predictions.json", "predictions-v2.json", "predictions-v3.json", "predictions-v4.json", "predictions-grown.json"):
            out = os.path.join(WORK, "fx.json")
            if os.path.exists(out):
                os.remove(out)
            rr = subprocess.run(["node", WF, "score", "--config", F + "config.json", "--pred", F + pf, "--key", F + kf, "--held-out", "--lenient", "--json", out, "--quiet"],
                                capture_output=True, text=True, cwd=BASE, encoding="utf-8", errors="replace")
            if not os.path.exists(out):
                continue
            o = json.load(open(out, encoding="utf-8"))
            conf = oc.Config(os.path.join(BASE, F, "config.json"))
            pred, _ = oc.load_records(os.path.join(BASE, F, pf), None)
            key, _ = oc.load_records(os.path.join(BASE, F, kf), None)
            held = partition(conf, key, conf.split)
            pids = {oc.text(x["id"]) for x in pred}
            tune = (({oc.text(x["id"]) for x in key}) - held) & pids
            hj = {x["id"] for x in o["records"]}
            T.add("split.fixture tuning ids", hj == tune, (pf, kf, sorted(hj ^ tune)[:6]))
    T.show("split")
    print("  tuning-half field compare: values", sum(cmp.values.values()), "agree", sum(cmp.agree.values()))
    from collections import Counter
    g = Counter((d["area"], d["field"]) for d in cmp.diffs)
    for (a, f), n in g.most_common(14):
        ex = [d for d in cmp.diffs if d["field"] == f][:1]
        print("   %5d %s/%s %s" % (n, a, f, str(ex)[:220]))
    with open(os.path.join(HERE, "results", "split.json"), "w") as f:
        json.dump(dict(counts=dict(T.c), agree=dict(T.ok), bad=[(a, str(d)[:400]) for a, d in T.bad],
                       tuning_values=sum(cmp.values.values()), tuning_agree=sum(cmp.agree.values())), f, indent=1)


if __name__ == "__main__":
    main()
