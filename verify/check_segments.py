"""`monitor --segment-by` on counts files: the shared alarm budget, each member's bar, "shown" and
upper bound, against METRICS.md "Each segment". usage: python check_segments.py [seed] [count]"""
import json
import math
import os
import random
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction

import oracle_monitor as om
import oracle_stats as st
from check_stats import Tally, WF, BASE, HERE

WORK = os.path.join(HERE, "tmp", "seg")
os.makedirs(WORK, exist_ok=True)


def node(args, cwd):
    return subprocess.run(["node", WF] + args, capture_output=True, text=True, cwd=cwd, encoding="utf-8", errors="replace")


def gen(rng):
    names = ["chat", "email", "phone", "fax", "web"][:rng.choice([1, 2, 2, 3, 3, 5])]
    if rng.random() < 0.15:
        names = names + [""]
    T = rng.choice([5, 5, 10, 20])
    base = {n: rng.choice([3, 10, 20, 30, 50]) for n in names}
    P = rng.choice([3, 6, 10, 16, 24])
    rate = {n: T / 100 * rng.choice([0, 0.3, 0.5, 1, 2]) for n in names}
    rows = []
    for k in range(P):
        for n in names:
            size = base[n] if rng.random() < 0.8 else rng.randint(1, base[n] * 2)
            y = sum(1 for _ in range(size) if rng.random() < rate[n])
            rows.append(("P-%d" % (k + 1), n, size, y))
    declared = None
    if rng.random() < 0.35 and len(names) >= 2:
        declared = [x for x in names if x][:max(1, len(names) - 1)]
    return dict(rows=rows, T=T, names=names, declared=declared, fae=rng.choice([None, None, 1000, 5000]))


def run_one(a):
    i, s = a
    d = os.path.join(WORK, "c%04d" % i)
    os.makedirs(d, exist_ok=True)
    json.dump([dict(period=p, segment=g, out_without_review=n, silent_errors=y) for p, g, n, y in s["rows"]], open(os.path.join(d, "c.json"), "w"))
    args = ["monitor", "--counts", "c.json", "--segment-by", "segment", "--target", str(s["T"]), "--json", "o.json"]
    if s["declared"]:
        args += ["--segments", ",".join(s["declared"])]
    if s["fae"]:
        args += ["--false-alarm-every", str(s["fae"])]
    r = node(args, d)
    f = os.path.join(d, "o.json")
    o = json.load(open(f, encoding="utf-8")) if os.path.exists(f) else None
    shutil.rmtree(d, ignore_errors=True)
    return s, r, o


def main():
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 20261103
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 150
    rng = random.Random(seed)
    T = Tally()
    series = [gen(rng) for _ in range(count)]
    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(run_one, enumerate(series)))
    for i, (s, r, o) in enumerate(results):
        tag = "s%d" % i
        if o is None:
            T.add("seg.refused by the harness (not compared)", True, (r.stdout + r.stderr)[:200])
            continue
        t = s["T"] / 100
        periods = []
        for p, g, n, y in s["rows"]:
            if p not in periods:
                periods.append(p)
        # the family
        def member(g):
            g2 = g if g else "(none)"
            if s["declared"]:
                if g2 == "(none)":
                    return g2
                return g2 if g2 in s["declared"] else "(other)"
            return g2
        fam = sorted({member(g) for p, g, n, y in s["rows"]})
        if s["declared"]:
            fam = sorted(set(s["declared"]) | {"(other)", "(none)"})
        seg = o["segments"]
        T.add("seg.members", seg["members"] == len(fam), (tag, seg["members"], fam))
        T.add("seg.provisional", seg["provisional"] == (s["declared"] is None), (tag, seg["provisional"]))
        by = {m: {} for m in fam}
        whole = {}
        for p, g, n, y in s["rows"]:
            m = member(g)
            a, b = by[m].get(p, (0, 0))
            by[m][p] = (a + n, b + y)
            a, b = whole.get(p, (0, 0))
            whole[p] = (a + n, b + y)
        withrec = [m for m in fam if sum(v[0] for v in by[m].values()) > 0]
        budget = s["fae"] or 2000
        shared = len(withrec) > 1
        each = budget * 2 if shared else budget
        hs = o["settings"]
        T.add("seg.whole budget doubled", hs.get("alarm_set_for", budget) == each, (tag, hs.get("alarm_set_for"), each, withrec))
        T.add("seg.each budget doubled", seg["false_alarm_every_each"] == each, (tag, seg["false_alarm_every_each"], each))
        up, down = hs["scores"]["up"], hs["scores"]["down"]
        p0 = hs["acceptable_pct"] / 100
        cum = {m: [0, 0] for m in fam}
        cumw = [0, 0]
        hrows = {x["segment"]: x for x in seg["rows"]}
        S_ = len(fam)
        cus = {m: 0 for m in fam}
        sizes = {m: [] for m in fam}
        cusw = 0
        sizew = []
        for pi, p in enumerate(periods):
            for m in fam:
                n, y = by[m].get(p, (0, 0))
                cum[m][0] += y
                cum[m][1] += n - y
                cus[m] = max(0, cus[m] + up * y - down * (n - y))
                if n:
                    sizes[m].append(n)
            n, y = whole[p]
            cumw[0] += y
            cumw[1] += n - y
            cusw = max(0, cusw + up * y - down * (n - y))
            if n:
                sizew.append(n)
            E = {m: om.evidence(cum[m][0], cum[m][1], t) for m in fam}
            short = {m: max(0.0, 20 - E[m]) for m in fam}
            Ew = om.evidence(cumw[0], cumw[1], t)
            sw = max(0.0, 20 - Ew)
            barw = 20 + sum(short.values()) / S_
            hp = o["periods"][pi]
            rt = (tag, p)
            T.add("seg.whole bar (20 + mean shortfall)", abs(hp["bar"] - barw) <= 0.0051, (rt, hp["bar"], barw))
            T.add("seg.whole shown (E >= bar)", bool(hp["shown"]) == (Ew >= barw), (rt, hp["shown"], Ew, barw))
            ub = om.upper_bound(cumw[0], cumw[1], barw)
            if hp["upper_pct"] is not None and ub is not None:
                T.add("seg.whole upper bound at its bar", st.close(hp["upper_pct"], ub * 100, 1), (rt, hp["upper_pct"], ub * 100, barw))
            med = int(math.floor(om.median(sizew) + Fraction(1, 2)))
            H = om.alarm_level(up, down, med, p0, each)
            T.add("seg.whole alarm level at the shared budget", hp["cusum"]["alarm_at"] == H, (rt, hp["cusum"]["alarm_at"], H))
            T.add("seg.whole steps", hp["cusum"]["steps"] == cusw, (rt, hp["cusum"]["steps"], cusw))
            for m in fam:
                hr = hrows.get(m)
                if hr is None:
                    T.add("seg.member listed or named empty", sum(v[0] for v in by[m].values()) == 0, (rt, m))
                    continue
                hps = {x["period"]: x for x in hr["periods"]}
                x = hps.get(p)
                if x is None:
                    continue
                bar = 20 + sum(v for k, v in short.items() if k != m) + S_ * sw
                T.add("seg.member bar (20 + others + S x whole)", abs(x["bar"] - bar) <= max(0.0051, 2e-6 * bar), (rt, m, x["bar"], bar))
                T.add("seg.member shown (E >= bar)", bool(x["shown"]) == (E[m] >= bar), (rt, m, x["shown"], E[m], bar))
                T.add("seg.member steps", x["cusum"]["steps"] == cus[m], (rt, m, x["cusum"]["steps"], cus[m]))
                if sizes[m]:
                    med = int(math.floor(om.median(sizes[m]) + Fraction(1, 2)))
                    T.add("seg.member period size (own median)", x["cusum"]["period_size"] == med, (rt, m, x["cusum"]["period_size"], med))
                    Hm = om.alarm_level(up, down, med, p0, each)
                    T.add("seg.member alarm level", x["cusum"]["alarm_at"] == Hm, (rt, m, x["cusum"]["alarm_at"], Hm))
                need = om.records_for_bar(t, bar)
                rec = cum[m][0] + cum[m][1]
                too_few = rec < need
                last = pi == len(periods) - 1
                # READING_A_REPORT: the JSON gives a segment's bound for every period it is shown
                # (and the summary, the last row, gives the bound as it stands)
                want = (bool(x["shown"]) or last) and not too_few
                T.add("seg.member upper bound in the row only when shown, or last, and not too few", (x["upper_pct"] is not None) == want,
                      (rt, m, x["upper_pct"], x["shown"], last, rec, need, bar))
                if x["upper_pct"] is not None:
                    ubm = om.upper_bound(cum[m][0], cum[m][1], bar)
                    T.add("seg.member upper bound at its bar", st.close(x["upper_pct"], ubm * 100, 1), (rt, m, x["upper_pct"], ubm * 100, bar))
                    T.add("seg.member shown iff upper bound under the target", bool(x["shown"]) == (ubm < t), (rt, m, x["shown"], ubm, t))
    T.show("segments")
    with open(os.path.join(HERE, "results", "segments.json"), "w") as f:
        json.dump(dict(counts=dict(T.c), agree=dict(T.ok), bad=[(a, str(d)[:400]) for a, d in T.bad]), f, indent=1)


if __name__ == "__main__":
    main()
