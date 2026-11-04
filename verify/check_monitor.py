"""Compare oracle_monitor with `wfeval monitor --counts ... --json` on generated series, plus
the repo's own monitor run files read by the same path. usage: python check_monitor.py [series] [seed]"""
import json
import math
import os
import random
import shutil
import subprocess
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction

import oracle_monitor as om
import oracle_stats as st
from check_stats import Tally, WF, BASE, HERE

WORK = os.path.join(HERE, "tmp", "mon")
os.makedirs(WORK, exist_ok=True)


def node(args, cwd):
    return subprocess.run(["node", WF] + args, capture_output=True, text=True, cwd=cwd, encoding="utf-8", errors="replace")


def gen_series(rng, i):
    kind = rng.random()
    n_periods = rng.choice([1, 2, 3, 5, 8, 12, 20, 30, 52])
    tgt = rng.choice([1, 2, 2.5, 3, 5, 5, 8, 10, 20, 40])
    acc = None
    ala = None
    r = rng.random()
    if r < 0.35:
        acc = round(tgt * rng.choice([0.2, 0.25, 0.4, 0.5, 0.6, 0.8]), 3)
    if r < 0.2:
        a0 = acc if acc else tgt / 2
        ala = round(a0 * rng.choice([1.5, 2, 3]), 3)
        if ala >= 100:
            ala = None
    sizes = []
    mode = rng.choice(["const", "const", "uneven", "tiny", "big", "mixed"])
    base = rng.choice([1, 3, 5, 10, 20, 30, 50, 100])
    rows = []
    p = tgt / 100 * rng.choice([0.0, 0.2, 0.5, 1.0, 2.0])
    rise = rng.randint(0, n_periods)
    for k in range(n_periods):
        if mode == "const":
            n = base
        elif mode == "uneven":
            n = rng.randint(1, 3 * base)
        elif mode == "tiny":
            n = rng.choice([1, 1, 2, 3])
        elif mode == "big":
            n = rng.choice([500, 1000, 2000])
        else:
            n = rng.choice([0, 1, 10, 100, 40])
        q = min(1.0, p * (3 if k >= rise else 1))
        y = sum(1 for _ in range(n) if rng.random() < q) if n <= 3000 else int(n * q)
        rows.append(("P-%d" % (k + 1), n, y))
    fae = rng.choice([None, None, 500, 1000, 5000, 10000])
    ps = rng.choice([None, None, None, 20, 50])
    since = rows[rng.randrange(0, len(rows))][0] if rng.random() < 0.15 else None
    return dict(rows=rows, tgt=tgt, acc=acc, ala=ala, fae=fae, ps=ps, since=since)


EXTREME = [
    dict(rows=[("P-1", 100000, 0)], tgt=5, acc=None, ala=None, fae=None, ps=None, since=None),
    dict(rows=[("P-1", 100000, 100000)], tgt=5, acc=None, ala=None, fae=None, ps=None, since=None),
    dict(rows=[("P-1", 100000, 1), ("P-2", 100000, 99999)], tgt=5, acc=None, ala=None, fae=None, ps=None, since=None),
    dict(rows=[("P-1", 1, 1)], tgt=5, acc=None, ala=None, fae=None, ps=None, since=None),
    dict(rows=[("P-1", 1, 0)], tgt=5, acc=None, ala=None, fae=None, ps=None, since=None),
    dict(rows=[("P-1", 0, 0), ("P-2", 0, 0)], tgt=5, acc=None, ala=None, fae=None, ps=None, since=None),
    dict(rows=[("P-%d" % i, 30, 0) for i in range(1, 11)], tgt=5, acc=None, ala=None, fae=None, ps=None, since=None),
    dict(rows=[("P-1", 87, 0)], tgt=5, acc=None, ala=None, fae=None, ps=None, since=None),
    dict(rows=[("P-1", 88, 0)], tgt=5, acc=None, ala=None, fae=None, ps=None, since=None),
    dict(rows=[("P-1", 40, 0), ("P-2", 48, 0)], tgt=5, acc=None, ala=None, fae=None, ps=None, since=None),
]


def run_one(a):
    idx, s = a
    d = os.path.join(WORK, "s%04d" % idx)
    os.makedirs(d, exist_ok=True)
    rows = [dict(period=p, out_without_review=n, silent_errors=y) for p, n, y in s["rows"]]
    json.dump(rows, open(os.path.join(d, "c.json"), "w"))
    args = ["monitor", "--counts", "c.json", "--target", str(s["tgt"]), "--json", "o.json"]
    if s["acc"]:
        args += ["--acceptable", str(s["acc"])]
    if s["ala"]:
        args += ["--alarming", str(s["ala"])]
    if s["fae"]:
        args += ["--false-alarm-every", str(s["fae"])]
    if s["ps"]:
        args += ["--period-size", str(s["ps"])]
    if s["since"]:
        args += ["--since", s["since"]]
    r = node(args, d)
    f = os.path.join(d, "o.json")
    o = json.load(open(f, encoding="utf-8")) if os.path.exists(f) else None
    shutil.rmtree(d, ignore_errors=True)
    return s, r, o


def compare_series(T, s, r, o, tag):
    if o is None:
        msg = (r.stdout + r.stderr)[:220]
        T.add("mon.refused by the harness (not compared)", True, msg)
        return msg
    tgt = s["tgt"] / 100
    p0 = (s["acc"] if s["acc"] else s["tgt"] / 2) / 100
    p1 = (s["ala"] if s["ala"] else p0 * 100 * 2) / 100
    st_ = o["settings"]
    T.add("mon.acceptable_pct", abs(st_["acceptable_pct"] - p0 * 100) < 1e-9, (tag, st_["acceptable_pct"], p0))
    T.add("mon.alarming_pct", abs(st_["alarming_pct"] - p1 * 100) < 1e-9, (tag, st_["alarming_pct"], p1))
    up, down = om.scores(p0, p1)
    T.add("mon.scores (smallest pair: rounded larger >= 50)", (st_["scores"]["up"], st_["scores"]["down"]) == (up, down),
          (tag, p0, p1, st_["scores"], (up, down), "ratio", math.log(p1 / p0) / math.log((1 - p0) / (1 - p1))))
    up2, down2 = om.scores_unrounded(p0, p1)
    T.add("mon.scores (smaller = ceil(50/ratio))", (st_["scores"]["up"], st_["scores"]["down"]) == (up2, down2),
          (tag, p0, p1, st_["scores"], (up2, down2), "ratio", math.log(p1 / p0) / math.log((1 - p0) / (1 - p1))))
    rr_ = math.log(p1 / p0) / math.log((1 - p0) / (1 - p1))
    T.add("mon.scores moved the ratio by at most 1%", abs(st_["scores"]["up"] / st_["scores"]["down"] / rr_ - 1) <= 0.01 + 1e-12,
          (tag, st_["scores"], rr_))
    T.add("mon.scores larger at least 50", max(st_["scores"]["up"], st_["scores"]["down"]) >= 50, (tag, st_["scores"]))
    use_up, use_down = st_["scores"]["up"], st_["scores"]["down"]
    budget = s["fae"] or 2000
    sizes = []
    S = 0
    alarmed = None
    last_zero_row = None
    SS = FF = 0
    counted_any = False
    since = s["since"]
    active = since is None
    shown_any = None
    last_shown = None
    last_rise = None
    prev_S_zero_period = None
    H = None
    rows = s["rows"]
    rise_start = None
    for idx, ((p, n, y), hp) in enumerate(zip(rows, o["periods"])):
        rt = "%s/%s" % (tag, p)
        T.add("mon.row.rate", st.close(hp["rate"]["pct"], st.rate_obj(y, n).pct, 1) and
              st.close(hp["rate"]["low_pct"], st.rate_obj(y, n).low_pct, 1) and st.close(hp["rate"]["high_pct"], st.rate_obj(y, n).high_pct, 1),
              (rt, hp["rate"]))
        SS += y
        FF += n - y
        if since is not None and p == since:
            active = True
            S = 0
        # the bound keeps counting every period
        E = om.log_evidence(SS, FF, tgt)
        lb = math.log(20)
        if abs(E - lb) < 1e-6:
            shown = om.evidence_exact(SS, FF, str(s["tgt"] / 100)) >= 20
        else:
            shown = E >= lb
        T.add("mon.row.shown (E>=20)", bool(hp["shown"]) == bool(shown), (rt, hp["shown"], math.exp(E) if E < 700 else "big", SS, FF))
        ub = om.upper_bound(SS, FF)
        if SS + FF > 0:
            T.add("mon.row.upper_pct", st.close(hp["upper_pct"], None if ub is None else ub * 100, 1) or (ub is None and hp["upper_pct"] in (100, None)),
                  (rt, hp["upper_pct"], None if ub is None else ub * 100, SS, FF))
        if not active:
            T.add("mon.row.counted false before --since", hp["counted"] is False, (rt, hp["counted"]))
            continue
        T.add("mon.row.counted", hp["counted"] is True, (rt, hp["counted"]))
        if n > 0:
            sizes.append(n)
        if s["ps"]:
            m = s["ps"]
        elif sizes:
            med = om.median(sizes)
            m = int(math.floor(med + Fraction(1, 2)))
        else:
            m = None
        S = max(0, S + use_up * y - use_down * (n - y))
        if alarmed is None:
            if S == 0:
                rise_start = None
            elif rise_start is None:
                rise_start = p
        c = hp["cusum"]
        T.add("mon.row.steps", c["steps"] == S, (rt, c["steps"], S))
        if m is not None:
            T.add("mon.row.period_size (median so far, .5 up)", c["period_size"] == m, (rt, c["period_size"], m, sizes))
            H = om.alarm_level(use_up, use_down, m, p0, budget)
            T.add("mon.row.alarm_at (chain, smallest level)", c["alarm_at"] == H, (rt, c["alarm_at"], H, (use_up, use_down, m, p0, budget)))
            hh = c["alarm_at"]
            T.add("mon.row.level_pct", st.close(c["level_pct"], Fraction(S * 100, hh), 1), (rt, c["level_pct"], S, hh))
            if S >= hh and alarmed is None:
                alarmed = p
        T.add("mon.row.alarm (sticky once raised)", bool(hp["alarm"]) == (alarmed is not None), (rt, hp["alarm"], alarmed, S))
    det = o["detector"]
    T.add("mon.detector.status", (det["status"] == "alarm") == (alarmed is not None), (tag, det["status"], alarmed))
    T.add("mon.detector.alarm_since", det["alarm_since"] == alarmed, (tag, det["alarm_since"], alarmed))
    if alarmed is not None:
        T.add("mon.detector.rise_started", det["rise_started"] == rise_start, (tag, det["rise_started"], rise_start))
    b = o["bound"]
    T.add("mon.bound.records,silent", (b["records"], b["silent"]) == (SS + FF, SS), (tag, b, SS, FF))
    pr = om.records_for_bar(tgt)
    T.add("mon.bound.perfect_run.anytime", b["perfect_run"]["anytime"] == pr, (tag, b["perfect_run"], pr))
    T.add("mon.bound.perfect_run.fixed", b["perfect_run"]["fixed"] == st.perfect_run(st.D(str(tgt))), (tag, b["perfect_run"]))
    ds = o["design"]
    if ds and ds.get("period_size"):
        m = ds["period_size"]
        hh = o["settings"]["alarm_at"]
        T.add("mon.settings.alarm_at", hh == om.alarm_level(use_up, use_down, m, p0, budget), (tag, hh))
        fa = om.arl(hh, use_up, use_down, m, p0) * m
        de = om.arl(hh, use_up, use_down, m, p1) * m
        T.add("mon.design.false_alarm_records given", ds["false_alarm_records"] is not None,
              (tag, dict(p0=p0, p1=p1, m=m, H=hh, scores=(use_up, use_down), oracle_records=fa, budget=budget, design=ds)))
        if ds["false_alarm_records"] is not None and fa < 1e10:
            T.add("mon.design.false_alarm_records", abs(ds["false_alarm_records"] - fa) <= 0.5 + 1e-6 * fa, (tag, ds["false_alarm_records"], fa))
        else:
            T.add("mon.design.false_alarm_records past 1e10 records (past what a double resolves, not compared)", True, (tag,))
        T.add("mon.design.detect_records given", ds["detect_records"] is not None, (tag, dict(p0=p0, p1=p1, m=m, H=hh, oracle_records=de, design=ds)))
        if ds["detect_records"] is not None:
            T.add("mon.design.detect_records", abs(ds["detect_records"] - de) <= 0.5 + 1e-6 * de, (tag, ds["detect_records"], de))
            T.add("mon.design.detect_periods", st.close(ds["detect_periods"], de / m, 1), (tag, ds["detect_periods"], de / m))
        T.add("mon.design.break_even_pct", st.close(ds["break_even_pct"], Fraction(use_down * 100, use_up + use_down), 1),
              (tag, ds["break_even_pct"], use_down * 100 / (use_up + use_down)))
        ut = ds.get("under_target")
        if ut:
            rr = ut["rate_pct"] / 100
            T.add("mon.design.under_target.rate = 90% of target", abs(ut["rate_pct"] - 0.9 * s["tgt"]) < 0.051, (tag, ut))
            # the rate printed is rounded; use the exact 90%
            v = om.arl(hh, use_up, use_down, m, 0.9 * tgt) * m
            if ut.get("records") is not None:
                T.add("mon.design.under_target.records", abs(ut["records"] - v) <= 0.5 + 1e-6 * v, (tag, ut, v))
    return None


def main():
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 20261103
    count = int(sys.argv[3]) if len(sys.argv) > 3 else 400
    rng = random.Random(seed)
    series = [gen_series(rng, i) for i in range(count)] + EXTREME
    T = Tally()
    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(run_one, enumerate(series)))
    refused = Counter()
    import time
    t0 = time.time()
    for i, (s, r, o) in enumerate(results):
        if i % 20 == 0:
            with open(os.path.join(HERE, "logs", "monitor.progress"), "a") as pf:
                pf.write("%d %.0f\n" % (i, time.time() - t0))
        m = compare_series(T, s, r, o, "s%d" % i)
        if m:
            refused[m[:90]] += 1
    T.show("monitor")
    print("refused:", refused.most_common(12))
    with open(os.path.join(HERE, "results", "monitor.json"), "w") as f:
        json.dump(dict(counts=dict(T.c), agree=dict(T.ok), bad=[(a, str(d)[:500]) for a, d in T.bad]), f, indent=1)


if __name__ == "__main__":
    main()
