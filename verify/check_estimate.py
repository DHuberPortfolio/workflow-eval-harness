"""The post-stratified estimate and its MOVER range against `wfeval estimate --json`.
usage: python check_estimate.py [seed] [count]"""
import json
import os
import random
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from fractions import Fraction

import oracle_stats as st
from check_stats import Tally, WF, BASE, HERE

WORK = os.path.join(HERE, "tmp", "est")
os.makedirs(WORK, exist_ok=True)


def node(args, cwd):
    return subprocess.run(["node", WF] + args, capture_output=True, text=True, cwd=cwd, encoding="utf-8", errors="replace")


def group_range(x, n, exact_ends=True):
    """Wilson's, with the exact end at 1-2 errors (3 past 50 checks), and the same for the high end."""
    lo, hi = st.wilson(x, n)
    if exact_ends:
        if x in (1, 2) or (x == 3 and n > 50):
            lo = min(lo, st.cp_lower(x, n, Decimal("0.025")))
        y = n - x
        if y in (1, 2) or (y == 3 and n > 50):
            hi = max(hi, 1 - st.cp_lower(y, n, Decimal("0.025")))
    return lo, hi


def mover(N, F, n1, x1, n0, x0, exact_ends=True, share_exact=False):
    W1 = Decimal(F) / N
    W0 = 1 - W1
    p1 = Decimal(x1) / n1
    p0 = Decimal(x0) / n0
    rate = W1 * p1 + W0 * p0
    l1, u1 = group_range(x1, n1, exact_ends)
    l0, u0 = group_range(x0, n0, exact_ends)
    lw, uw = group_range(F, N, exact_ends) if share_exact else st.wilson(F, N)
    gap = p1 - p0
    d_lo = [W1 * (p1 - l1), W0 * (p0 - l0)]
    d_hi = [W1 * (u1 - p1), W0 * (u0 - p0)]
    if gap >= 0:
        d_lo.append(gap * (W1 - lw))
        d_hi.append(gap * (uw - W1))
    else:
        d_lo.append(-gap * (uw - W1))
        d_hi.append(-gap * (W1 - lw))
    lo = rate - sum(x * x for x in d_lo).sqrt()
    hi = rate + sum(x * x for x in d_hi).sqrt()
    return rate, max(lo, Decimal(0)), min(hi, Decimal(1))


def bounds(N, F, n1, x1, n0, x0):
    """A verdict group with no check: 0% for the low end, 100% for the high.
    Reading: the checked group's own range ends, the group's share taken as it stands."""
    W1 = Decimal(F) / N
    W0 = 1 - W1
    out = []
    if n1 and not n0:
        l1, u1 = group_range(x1, n1)
        return W1 * l1, W1 * u1 + W0
    if n0 and not n1:
        l0, u0 = group_range(x0, n0)
        return W0 * l0, W0 * u0 + W1
    return Decimal(0), Decimal(1)


def worth(p, width):
    """Real n whose Wilson width at rate p equals width."""
    p = float(p)

    def w(n):
        lo, hi = st.wilson(Decimal(p) * Decimal(n), Decimal(n))
        return float(hi - lo)

    lo, hi = 1e-6, 1e12
    for _ in range(200):
        mid = (lo * hi) ** 0.5
        if w(mid) > width:
            lo = mid
        else:
            hi = mid
        if hi / lo < 1 + 1e-12:
            break
    return hi


def kappa(a, b, c, d):
    """a both yes, b judge only, c person only, d both no."""
    n = a + b + c + d
    if n == 0:
        return None
    po = Fraction(a + d, n)
    pe = Fraction((a + b) * (a + c) + (c + d) * (b + d), n * n)
    if pe == 1:
        return None
    return (po - pe) / (1 - pe)


CFG = {"outputs": {"tags": {"type": "set"}}, "routing": {"field": "route", "map": {"OUT": "auto", "ASK": "review"}}}


def one(a):
    idx, c = a
    N, F, n1, x1, n0, x0, not_out = c
    d = os.path.join(WORK, "e%04d" % idx)
    os.makedirs(d, exist_ok=True)
    json.dump(CFG, open(os.path.join(d, "c.json"), "w"))
    pred, judge, person = [], [], []
    for i in range(N):
        rid = "R%06d" % i
        pred.append({"id": rid, "route": "OUT", "tags": ["A"]})
        flagged = i < F
        judge.append({"id": rid, "tags": ["B" if flagged else "A"]})
        # the flagged are first: the first n1 of them are checked, the first x1 of those wrong
        if flagged:
            j = i
            if j < n1:
                person.append({"id": rid, "tags": ["B" if j < x1 else "A"], "checked_by": "p"})
        else:
            j = i - F
            if j < n0:
                person.append({"id": rid, "tags": ["B" if j < x0 else "A"], "checked_by": "p"})
    for i in range(not_out):
        rid = "Q%03d" % i
        pred.append({"id": rid, "route": "ASK", "tags": ["A"]})
        judge.append({"id": rid, "tags": ["A"]})
    json.dump(pred, open(os.path.join(d, "p.json"), "w"))
    json.dump(judge, open(os.path.join(d, "j.json"), "w"))
    json.dump(person, open(os.path.join(d, "k.json"), "w"))
    r = node(["estimate", "--config", "c.json", "--pred", "p.json", "--judge-key", "j.json", "--key", "k.json", "--lenient", "--json", "o.json"], d)
    f = os.path.join(d, "o.json")
    o = json.load(open(f, encoding="utf-8")) if os.path.exists(f) else None
    shutil.rmtree(d, ignore_errors=True)
    return c, r, o


def gen(rng, count):
    cases = [(20, 5, 4, 3, 6, 1, 2), (10, 2, 2, 2, 8, 0, 0)]
    for N in (1, 2, 5, 10, 100, 1000, 10000, 100000):
        for F in sorted({0, 1, N // 2, N - 1, N}):
            if F < 0:
                continue
            P = N - F
            for n1 in sorted({min(F, 1), min(F, 3), min(F, 60), F}):
                for n0 in sorted({min(P, 1), min(P, 2), min(P, 30), min(P, 120)}):
                    if n1 + n0 == 0:
                        continue
                    for x1 in sorted({0, min(1, n1), max(0, n1 - 1), n1}):
                        for x0 in sorted({0, min(1, n0), max(0, n0 - 2), n0}):
                            if rng.random() < 0.08:
                                cases.append((N, F, n1, x1, n0, x0, 0))
    while len(cases) < count:
        N = int(10 ** rng.uniform(0.7, 3.5))
        F = rng.randint(1, max(1, N // 2))
        P = N - F
        n1 = rng.randint(0, F)
        n0 = rng.randint(0, P)
        if n1 == 0 and n0 == 0:
            n0 = 1
        pick = lambda n: min(n, rng.choice([0, 1, 2, 3, n // 4, n // 2, n, max(0, n - 1), max(0, n - 2), max(0, n - 3)]))
        cases.append((N, F, n1, pick(n1), n0, pick(n0), rng.choice([0, 0, 3])))
    return cases


def main():
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 20261103
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 500
    rng = random.Random(seed)
    T = Tally()
    cases = gen(rng, count)
    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(one, enumerate(cases)))
    for c, r, o in results:
        N, F, n1, x1, n0, x0, no = c
        tag = c
        if o is None:
            T.add("est.ran", False, (tag, (r.stdout + r.stderr)[:260]))
            continue
        T.add("est.out,flagged", (o["out"], o["judge"]["flagged"]) == (N, F), (tag, o["out"], o["judge"]))
        ck = o["checked"]
        T.add("est.checked groups", (ck["flagged"]["n"], ck["flagged"]["errors"], ck["passed"]["n"], ck["passed"]["errors"]) == (n1, x1, n0, x0), (tag, ck))
        jr = st.rate_obj(F, N)
        h = o["judge"]["rate"]
        T.add("est.judge alone", st.close(h["pct"], jr.pct, 1) and st.close(h["low_pct"], jr.low_pct, 1) and st.close(h["high_pct"], jr.high_pct, 1), (tag, h))
        e = o["estimate"]
        pr = st.rate_obj(x1 + x0, n1 + n0)
        h = o["person_only"]["rate"]
        T.add("est.person alone", st.close(h["pct"], pr.pct, 1) and st.close(h["low_pct"], pr.low_pct, 1) and st.close(h["high_pct"], pr.high_pct, 1), (tag, h))
        k = kappa(x1, n1 - x1, x0, n0 - x0)
        hk = o["judge_quality"]["kappa"]
        informative = n1 > 0 and n0 > 0
        if informative:
            T.add("est.kappa", st.close(hk, k, 3), (tag, hk, None if k is None else float(k)))
        if F > 0 and F < N and n1 > 0 and n0 > 0 or (F == 0 and n0 > 0) or (F == N and n1 > 0):
            if F == 0:
                rate = Decimal(x0) / n0
                lo, hi = group_range(x0, n0)
            elif F == N:
                rate = Decimal(x1) / n1
                lo, hi = group_range(x1, n1)
            else:
                rate, lo, hi = mover(N, F, n1, x1, n0, x0)
            T.add("est.rate = W1 p1 + W0 p0", st.close(e["pct"], rate * 100, 1), (tag, e["pct"], float(rate * 100)))
            T.add("est.range low", st.close(e["low_pct"], lo * 100, 1), (tag, e["low_pct"], float(lo * 100)))
            T.add("est.range high", st.close(e["high_pct"], hi * 100, 1), (tag, e["high_pct"], float(hi * 100)))
            if e.get("worth_records") is not None and hi > lo:
                wv = worth(rate, float(hi - lo))
                T.add("est.worth_records", abs(e["worth_records"] - wv) <= max(1e-3, 2e-3 * wv), (tag, e["worth_records"], wv))
        else:
            lo, hi = bounds(N, F, n1, x1, n0, x0)
            T.add("est.no estimate when a group is unchecked", e["pct"] is None, (tag, e))
            T.add("est.bounds low", st.close(e["low_pct"], lo * 100, 1), (tag, e["low_pct"], float(lo * 100)))
            T.add("est.bounds high", st.close(e["high_pct"], hi * 100, 1), (tag, e["high_pct"], float(hi * 100)))
    T.show("estimate")
    with open(os.path.join(HERE, "results", "estimate.json"), "w") as f:
        json.dump(dict(counts=dict(T.c), agree=dict(T.ok), bad=[(a, str(d)[:400]) for a, d in T.bad]), f, indent=1)


if __name__ == "__main__":
    main()
