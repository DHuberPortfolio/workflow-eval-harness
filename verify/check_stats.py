"""Black-box checks of the statistics: `wfeval rate`, `score --target`, `whatif --gate --target`
(exact binomial p-values), `score --held-out --target` (exact bound), `compare` (Tango) and
`score --cluster-by` (design effect), on random inputs including the extremes.
usage: python check_stats.py [rate|gate|heldout|tango|cluster|all] [seed]"""
import hashlib
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from fractions import Fraction

import oracle_stats as st

from where import HERE, BASE, WF
WORK = os.path.join(HERE, "tmp", "stats")
os.makedirs(WORK, exist_ok=True)
os.makedirs(os.path.join(HERE, "results"), exist_ok=True)


def node(args, cwd):
    return subprocess.run(["node", WF] + args, capture_output=True, text=True, cwd=cwd, encoding="utf-8", errors="replace")


class Tally:
    def __init__(self):
        self.c = Counter()
        self.ok = Counter()
        self.bad = []

    def add(self, area, good, detail=None):
        self.c[area] += 1
        if good:
            self.ok[area] += 1
        elif len(self.bad) < 4000:
            self.bad.append((area, detail))

    def show(self, title):
        print("==", title)
        for a in self.c:
            print("  %-34s %7d  agree %7d" % (a, self.c[a], self.ok[a]))
        g = Counter(a for a, d in self.bad)
        for a, n in g.most_common():
            print("  DISAGREE %5d %s" % (n, a))
            for x, d in [b for b in self.bad if b[0] == a][:5]:
                print("      ", str(d)[:230])


# ---- float helpers for screening large plans (never the final word when an exact sum is possible)

def betacf(a, b, x):
    FPMIN = 1e-300
    qab, qap, qam = a + b, a + 1, a - 1
    c = 1.0
    d = 1 - qab * x / qap
    d = 1 / (d if abs(d) > FPMIN else FPMIN)
    h = d
    for m in range(1, 200000):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1 + aa * d
        d = 1 / (d if abs(d) > FPMIN else FPMIN)
        c = 1 + aa / c
        c = c if abs(c) > FPMIN else FPMIN
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1 + aa * d
        d = 1 / (d if abs(d) > FPMIN else FPMIN)
        c = 1 + aa / c
        c = c if abs(c) > FPMIN else FPMIN
        de = d * c
        h *= de
        if abs(de - 1) < 3e-15:
            break
    return h


def betai(a, b, x):
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    lb = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x)
    if x < (a + 1) / (a + b + 2):
        return math.exp(lb + math.log(betacf(a, b, x)) - math.log(a))
    return 1 - math.exp(lb + math.log(betacf(b, a, 1 - x)) - math.log(b))


def cdf_float(k, n, p):
    if k < 0:
        return 0.0
    if k >= n:
        return 1.0
    return betai(n - k, k + 1, 1 - p)


def n_for_c(c, target, lo):
    """smallest n >= lo with wilson high of c of n under target"""
    hi = max(lo, 2 * c + 2)
    while not st.wilson_high_float(c, hi) < target:
        hi *= 2
        if hi > 1 << 42:
            return None
    while lo < hi:
        m = (lo + hi) // 2
        if st.wilson_high_float(c, m) < target:
            hi = m
        else:
            lo = m + 1
    return lo


def plan_first(p, target, wanted, max_n=2 * 10 ** 8):
    """Smallest n whose chance reaches `wanted`. Within one allowed count c the chance falls as n
    grows, so it can only first reach the ask at an n where c rises. The chance at those n climbs
    with small wiggles: bisect to the crossing, then scan back for an earlier c that reaches it."""
    t = float(target)
    p = float(p)

    def at(c):
        n = n_for_c(c, t, max(1, c + 1))
        if n is None or n > max_n:
            return None, None
        return n, cdf_float(c, n, p)

    lo, hi = 0, 1
    while True:
        n, ch = at(hi)
        if n is None:
            return None, None
        if ch >= wanted:
            break
        lo = hi
        hi *= 2
    while lo + 1 < hi:
        mid = (lo + hi) // 2
        n, ch = at(mid)
        if n is None or ch >= wanted:
            hi = mid
        else:
            lo = mid
    best = hi
    span = max(400, int(6 * math.sqrt(hi + 1)))
    for c in range(max(0, hi - span), hi):
        n, ch = at(c)
        if n is not None and ch >= wanted:
            best = c
            break
    n, ch = at(best)
    return n, ch


def plan_stable(p, target, wanted, first):
    """Smallest n from which the chance never again drops below `wanted`. Inside one allowed count
    the chance is lowest just before the next rise, so those are the only n to test."""
    t = float(target)
    p = float(p)
    c = st.largest_shown(first, t)
    stop = c + 200 + int(10 * math.sqrt(c + 1))
    n = first
    answer = first
    while c < stop:
        nxt = n_for_c(c + 1, t, n + 1)
        if nxt is None:
            break
        if cdf_float(c, nxt - 1, p) < wanted:
            answer = nxt
            stop = max(stop, c + 200 + int(10 * math.sqrt(c + 1)))
        n = nxt
        c += 1
    return answer


def round_ok(h, exact, dp=1):
    return st.close(h, exact, dp)


# ---- rate -------------------------------------------------------------------------------

def rate_cases(rng, count):
    out = []
    TARGETS = ["0.1", "0.5", "1", "2", "2.5", "5", "7.5", "10", "15", "20", "30", "50", "80", "95", "99"]
    ext = [1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 100, 200, 500, 1000, 5000, 10000, 50000, 100000]
    for n in ext:
        for x in sorted(set([0, 1, n - 1, n, n // 2])):
            if x < 0:
                continue
            out.append((x, n, rng.choice(TARGETS), rng.choice(["0.8", "0.9", "0.95"])))
    # cases that need a plan: a rate under the target, not yet shown
    plans = 0
    while plans < 500:
        t = rng.choice(TARGETS)
        tf = float(t) / 100
        n = rng.choice([3, 5, 8, 10, 15, 20, 30, 40, 60, 100, 150, 200, 400])
        x = rng.randint(1, max(1, n))
        if x / n < tf and st.wilson_high_float(x, n) >= tf:
            out.append((x, n, t, rng.choice(["0.8", "0.9", "0.95"])))
            plans += 1
    while len(out) < count + 500:
        n = int(10 ** rng.uniform(0, 5))
        r = rng.random()
        if r < 0.5:
            x = min(n, int(n * 10 ** rng.uniform(-3, 0)))
        else:
            x = rng.randint(0, n)
        out.append((x, n, rng.choice(TARGETS), rng.choice(["0.8", "0.9", "0.95"])))
    return out


PLAN_GAP = []


def check_rate(T, seed, count=1500):
    rng = random.Random(seed)
    cases = rate_cases(rng, count)

    def one(c):
        x, n, t, ch = c
        f = os.path.join(WORK, "rate-%d-%d-%s-%s-%d.json" % (x, n, t, ch, threading.get_ident()))
        r = node(["rate", str(x), str(n), "--target", t, "--chance", ch, "--json", f], BASE)
        d = None
        if os.path.exists(f):
            d = json.load(open(f, encoding="utf-8"))
            os.remove(f)
        return c, r, d

    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(one, cases))
    for (x, n, t, ch), r, d in results:
        tag = (x, n, t, ch)
        if d is None:
            T.add("rate.ran", False, (tag, r.stdout[:200], r.stderr[:200]))
            continue
        R = st.rate_obj(x, n)
        h = d["rate"]
        T.add("rate.n,d", h["n"] == x and h["d"] == n, tag)
        T.add("rate.pct", round_ok(h["pct"], R.pct), (tag, h["pct"], float(R.pct)))
        T.add("rate.wilson_low", round_ok(h["low_pct"], R.low_pct), (tag, h["low_pct"], float(R.low_pct)))
        T.add("rate.wilson_high", round_ok(h["high_pct"], R.high_pct), (tag, h["high_pct"], float(R.high_pct)))
        tt = d["target"]
        tgt = st.D(t) / 100
        shown = R.hi < tgt
        T.add("target.shown (Wilson high < T)", tt["shown"] == shown, (tag, tt["shown"], float(R.hi)))
        T.add("target.rate_at_or_above", tt["rate_at_or_above"] == (Fraction(x, n) >= Fraction(t) / 100),
              (tag, tt["rate_at_or_above"]))
        pr = st.perfect_run(tgt)
        T.add("target.perfect_run.n", tt["perfect_run"]["n"] == pr, (tag, tt["perfect_run"], pr))
        want_plan = (not shown) and x > 0 and Fraction(x, n) < Fraction(t) / 100
        T.add("plan present when not shown, 0 < rate < target", (tt["plan"] is not None) == want_plan,
              (tag, "shown=%s" % shown, tt["plan"]))
        T.add("plan in the JSON although the target is shown (text prints none)", not (shown and tt["plan"] is not None),
              (tag, tt["plan"]))
        if tt["plan"] is not None and want_plan:
            p = Fraction(x, n)
            hn = tt["plan"]["n"]
            nf, chv = plan_first(float(p), float(tgt), float(ch))
            if nf is None:
                T.add("plan.n beyond the oracle's range (skipped)", True, tag)
                continue
            # exact chance at the harness's n
            c = st.largest_shown(hn, float(tgt))
            if c <= 60000 and hn <= 5 * 10 ** 7:
                exact_ch = st.binom_cdf(c, hn, p)
            else:
                exact_ch = None
            exact_flag = tt["plan"]["exact"]
            T.add("plan.n = first n reaching the chance (exact=%s)" % exact_flag, hn == nf,
                  (tag, "harness", hn, "oracle first n", nf, "chance there", chv))
            ns = plan_stable(float(p), float(tgt), float(ch), nf)
            T.add("plan.n = n from which the chance never drops under (exact=%s)" % exact_flag, hn == ns,
                  (tag, "harness", hn, "oracle stable n", ns, "first", nf))
            if not exact_flag:
                T.add("plan: approximate n never under the stable n", hn >= ns, (tag, "harness", hn, "stable", ns, "off by %.3f%%" % (100.0 * (hn - ns) / ns)))
                PLAN_GAP.append((tag, hn, ns))
            if tt["plan"]["chance"] is not None and exact_ch is not None:
                T.add("plan.chance (exact sum at its n)",
                      abs(st.D(tt["plan"]["chance"]) - exact_ch) < Decimal("1e-9"),
                      (tag, tt["plan"]["chance"], float(exact_ch)))
            if exact_ch is not None:
                T.add("plan: chance at its n really reaches the ask (exact=%s)" % exact_flag, exact_ch >= st.D(ch),
                      (tag, hn, float(exact_ch)))
            if exact_flag is False:
                T.add("plan.exact false (docs: 'added up exactly')", False, (tag, "n", hn))


# ---- gate p-values -------------------------------------------------------------------------

def gate_dataset(rng, d, sizes):
    """sizes: list of 11 (records, wrong) for the bands of confidence 0.50, 0.55 ... 1.00."""
    preds, keys = [], []
    i = 0
    bands = [0.5 + 0.05 * b for b in range(11)]
    for b, (n, k) in zip(bands, sizes):
        for j in range(n):
            i += 1
            rid = "G%06d" % i
            conf = round(b, 2)
            wrong = j < k
            preds.append({"id": rid, "route": "OUT" if conf >= 0.8 else "ASK", "tags": [{"value": "B" if wrong else "A", "confidence": conf}]})
            keys.append({"id": rid, "tags": ["A"]})
    cfg = {"outputs": {"tags": {"type": "set"}}, "routing": {"field": "route", "map": {"OUT": "auto", "ASK": "review"}},
           "thresholds": {"auto_publish": {"tags": 0.8}}}
    os.makedirs(d, exist_ok=True)
    json.dump(cfg, open(os.path.join(d, "config.json"), "w"))
    json.dump(preds, open(os.path.join(d, "pred.json"), "w"))
    json.dump(keys, open(os.path.join(d, "key.json"), "w"))


def check_gate(T, seed, count=220):
    rng = random.Random(seed)
    jobs = []
    for i in range(count):
        d = os.path.join(WORK, "gate%04d" % i)
        scale = 10 ** rng.uniform(0, 3.3)
        sizes = []
        for b in range(11):
            n = int(rng.expovariate(1 / scale)) + rng.choice([0, 0, 1, 2])
            k = rng.choice([0, 0, 1, n, max(0, n - 1), rng.randint(0, n) if n else 0])
            k = min(k, n)
            sizes.append((n, k))
        conf = rng.choice(["0.9", "0.95", "0.99"])
        t = rng.choice(["0.1", "0.5", "1", "2", "5", "10", "20", "30", "50", "75", "90"])
        jobs.append((d, sizes, t, conf))
    for i, (n, k, t) in enumerate([(100000, 0, "0.01"), (100000, 1, "0.01"), (100000, 2000, "2"), (100000, 5000, "5"),
                                   (100000, 99999, "50"), (100000, 100000, "99"), (100000, 12, "0.02")]):
        d = os.path.join(WORK, "gateX%d" % i)
        sizes = [(0, 0)] * 6 + [(n, k)] + [(0, 0)] * 4
        jobs.append((d, sizes, t, "0.95"))

    def one(job):
        d, sizes, t, conf = job
        gate_dataset(rng, d, sizes)
        f = os.path.join(d, "out.json")
        r = node(["whatif", "--config", "config.json", "--pred", "pred.json", "--key", "key.json", "--gate", "--target", t,
                  "--confidence", conf, "--json", "out.json"], d)
        res = json.load(open(f, encoding="utf-8")) if os.path.exists(f) else None
        return job, r, res

    # build sequentially: rng is shared
    results = []
    for j in jobs:
        results.append(one(j))
    for (d, sizes, t, conf), r, res in results:
        if res is None:
            T.add("gate.ran", False, (sizes, t, r.stdout[:200] + r.stderr[:200]))
            continue
        rows = res["rows"]
        tgt = st.D(t) / 100
        level = (1 - st.D(conf)) / len(rows)
        T.add("gate.level = (1-conf)/gates", abs(st.D(res["certification"]["level"]) - level) < Decimal("1e-12"),
              (t, conf, res["certification"]["level"]))
        for row in rows:
            n = row["silent_error_rate"]["d"]
            k = row["silent_error_rate"]["n"]
            tag = (n, k, t, conf, row["threshold"])
            wn = sum(s[0] for b, s in enumerate(sizes) if round(0.5 + 0.05 * b, 2) >= row["threshold"] - 1e-9)
            wk = sum(s[1] for b, s in enumerate(sizes) if round(0.5 + 0.05 * b, 2) >= row["threshold"] - 1e-9)
            T.add("gate.row n,k by construction", (n, k) == (wn, wk), (tag, wn, wk))
            if n == 0:
                T.add("gate.no record out: not certified", not row.get("certified"), tag)
                continue
            ex = st.binom_cdf(k, n, tgt)
            hp = row.get("p_value")
            good = hp is not None and (abs(st.D(hp) - ex) <= Decimal("1e-11") * max(ex, Decimal("1e-250")) * 100 or
                                       abs(st.D(hp) - ex) < Decimal("1e-13"))
            T.add("gate.p_value exact binomial", good, (tag, hp, float(ex)))
            T.add("gate.certified p <= level", bool(row.get("certified")) == (ex <= level), (tag, row.get("certified"), float(ex), float(level)))
        if not sizes[0][0] and sizes[6][0] >= 100000:
            shutil.rmtree(d, ignore_errors=True)
    shutil.rmtree(WORK + "/gate0000", ignore_errors=True)


# ---- held-out exact bound ------------------------------------------------------------------

def held_ids(n, salt=""):
    ids = []
    i = 0
    while len(ids) < n:
        i += 1
        rid = "H%07d" % i
        name = (salt + ":" + rid) if salt else rid
        h = int.from_bytes(hashlib.sha256(name.encode()).digest()[:4], "big")
        if h / 2 ** 32 < 0.5:
            ids.append(rid)
    return ids


TUNE = ["T1", "T2", "T3", "T5", "T6", "T7", "T8", "T9"]


def check_heldout(T, seed, count=260):
    rng = random.Random(seed)
    cases = []
    for n in (1, 2, 3, 10, 50, 100, 1000, 5000, 100000):
        for k in sorted(set([0, 1, max(0, n - 1), n])):
            cases.append((n, k, rng.choice(["1", "5", "10", "20", "50", "90"])))
    while len(cases) < count:
        n = int(10 ** rng.uniform(0, 3.7))
        k = rng.choice([0, 0, 1, 2, rng.randint(0, n), n])
        k = min(k, n)
        cases.append((n, k, rng.choice(["0.5", "1", "2", "5", "10", "20", "30", "50", "75"])))
    ids = held_ids(100000)
    tune = []
    i = 0
    while len(tune) < 5:
        i += 1
        rid = "T%d" % i
        h = int.from_bytes(hashlib.sha256(rid.encode()).digest()[:4], "big")
        if h / 2 ** 32 >= 0.5:
            tune.append(rid)
    cfg = {"outputs": {"tags": {"type": "set"}}, "routing": {"field": "route", "map": {"OUT": "auto", "ASK": "review"}},
           "split": {"held_out": 0.5, "log": "log.json"}}

    def one(args):
        idx, (n, k, t) = args
        d = os.path.join(WORK, "held%04d" % idx)
        os.makedirs(d, exist_ok=True)
        json.dump(cfg, open(os.path.join(d, "config.json"), "w"))
        res = []
        looks = 1 if n >= 5000 else (1 + idx % 4)
        for look in range(1, looks + 1):
            pred = [{"id": x, "route": "OUT", "tags": ["A"]} for x in tune]
            key = [{"id": x, "tags": ["A"]} for x in tune]
            for j, x in enumerate(ids[:n]):
                pred.append({"id": x, "route": "OUT", "tags": ["B" if j < k else "A"]})
                key.append({"id": x, "tags": ["A"]})
            # a change in a tuning record makes it a new look without touching the held-out half
            pred[0]["tags"] = ["A"] if look == 1 else (["A", "C%d" % look])
            json.dump(pred, open(os.path.join(d, "pred.json"), "w"))
            json.dump(key, open(os.path.join(d, "key.json"), "w"))
            r = node(["score", "--config", "config.json", "--pred", "pred.json", "--key", "key.json", "--held-out",
                      "--target", t, "--json", "out.json", "--quiet"], d)
            o = None
            f = os.path.join(d, "out.json")
            if os.path.exists(f):
                o = json.load(open(f, encoding="utf-8"))
                os.remove(f)
            res.append((look, r, o))
        shutil.rmtree(d, ignore_errors=True)
        return (n, k, t), res

    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(one, enumerate(cases)))
    for (n, k, t), res in results:
        for look, r, o in res:
            tag = (n, k, t, "look", look)
            if o is None:
                T.add("held.ran", False, (tag, r.stdout[:200], r.stderr[:200]))
                continue
            x = o["split"].get("target")
            T.add("held.n,k", x is not None and x["tested"] == n and x["silent_errors"] == k, (tag, x))
            if x is None:
                continue
            tgt = st.D(t) / 100
            level = Decimal("0.05") / (2 ** look)
            T.add("held.level = 5% / 2^look", abs(st.D(x["level"]) - level) < Decimal("1e-15"), (tag, x["level"]))
            ex = st.binom_cdf(k, n, tgt)
            hp = x["p_value"]
            T.add("held.p_value exact binomial", hp is not None and
                  (abs(st.D(hp) - ex) <= Decimal("1e-9") * max(ex, Decimal("1e-250")) or abs(st.D(hp) - ex) < Decimal("1e-13")),
                  (tag, hp, float(ex)))
            T.add("held.shown p <= level", bool(x["shown"]) == (ex <= level), (tag, x["shown"], float(ex), float(level)))
            ub = st.cp_upper(k, n, level) * 100
            T.add("held.bound_pct Clopper-Pearson one-sided", st.close(x["bound_pct"], ub, 1), (tag, x["bound_pct"], float(ub)))
            # records_needed: fewest records, none wrong, that show it at this look: (1-t)^n <= level
            need = math.ceil(math.log(float(level)) / math.log1p(-float(tgt)))
            while (1 - tgt) ** need > level:
                need += 1
            while need > 1 and (1 - tgt) ** (need - 1) <= level:
                need -= 1
            T.add("held.records_needed", x["records_needed"] == need, (tag, x["records_needed"], need))


# ---- Tango via compare ---------------------------------------------------------------------

LINE = re.compile(r"silent errors\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+) \(likely ([+\-]?[\d.]+) to ([+\-]?[\d.]+) pts\)\s+(.+)")


def check_tango(T, seed, count=420):
    rng = random.Random(seed)
    cases = []
    for n in (1, 2, 3, 5, 10, 25, 100, 1000, 10000, 100000):
        for f, b in {(0, 0), (1, 0), (0, 1), (1, 1), (n, 0), (0, n), (max(n - 1, 0), 1 if n > 1 else 0), (n // 2, n - n // 2)}:
            if f + b <= n:
                cases.append((n, f, b))
    while len(cases) < count:
        n = int(10 ** rng.uniform(0, 3.5))
        kind = rng.random()
        if kind < 0.5:
            f, b = rng.randint(0, min(n, 25)), rng.randint(0, min(n, 25))
        else:
            f = rng.randint(0, n)
            b = rng.randint(0, n - f)
        if f + b > n:
            f = n - b
        cases.append((n, f, b))

    def one(a):
        idx, (n, f, b) = a
        d = os.path.join(WORK, "tango%04d" % idx)
        os.makedirs(d, exist_ok=True)
        cfg = {"outputs": {"tags": {"type": "set"}}, "routing": {"field": "route", "map": {"OUT": "auto", "ASK": "review"}}}
        json.dump(cfg, open(os.path.join(d, "config.json"), "w"))
        key = [{"id": "R%d" % i, "tags": ["A"]} for i in range(n)]
        before = [{"id": "R%d" % i, "route": "OUT", "tags": ["B" if i < f else "A"]} for i in range(n)]
        after = [{"id": "R%d" % i, "route": "OUT", "tags": ["B" if f <= i < f + b else "A"]} for i in range(n)]
        json.dump(key, open(os.path.join(d, "key.json"), "w"))
        json.dump(before, open(os.path.join(d, "before.json"), "w"))
        json.dump(after, open(os.path.join(d, "after.json"), "w"))
        r = node(["compare", "--config", "config.json", "--key", "key.json", "--before", "before.json", "--after", "after.json"], d)
        shutil.rmtree(d, ignore_errors=True)
        return (n, f, b), r

    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(one, enumerate(cases)))
    for (n, f, b), r in results:
        tag = (n, f, b)
        m = LINE.search(r.stdout)
        T.add("tango.line present", m is not None, (tag, r.stdout[:300], r.stderr[:300]))
        if not m:
            continue
        T.add("tango.counts", (int(m[3]), int(m[4])) == (f, b), (tag, m[0]))
        lo, hi = st.tango(b, f, n)
        T.add("tango.low", st.close(float(m[6]), lo * 100, 1), (tag, m[6], float(lo * 100)))
        T.add("tango.high", st.close(float(m[7]), hi * 100, 1), (tag, m[7], float(hi * 100)))
        v = m[8].strip()
        want = "no change" if f == 0 and b == 0 else ("better" if hi < 0 else ("worse" if lo > 0 else "unclear"))
        T.add("tango.verdict", v == want, (tag, v, want, float(lo), float(hi)))
        # McNemar: the verdict agrees with the score test at delta = 0
        if f + b:
            z2 = Fraction((f - b) ** 2, f + b)
            T.add("tango.verdict agrees with McNemar", (v in ("better", "worse")) == (z2 > Fraction(38416, 10000)), (tag, v, float(z2)))


# ---- clusters ------------------------------------------------------------------------------

def check_cluster(T, seed, count=500):
    rng = random.Random(seed)
    cases = []
    for i in range(count):
        C = rng.choice([1, 2, 2, 3, 3, 5, 8, 12, 20, 40, 100])
        spec = []
        shape = rng.random()
        for c in range(C):
            size = 1 if shape < 0.1 else rng.choice([1, 1, 2, 3, 4, 7, 15])
            mode = rng.random()
            if mode < 0.55:
                k = 0
            elif mode < 0.75:
                k = size
            else:
                k = rng.randint(0, size)
            spec.append((size, k))
        own = rng.choice([0, 0, 0, 1, 3])
        cases.append((spec, own, rng.random() < 0.15))
    cases.append(([(50000, 900), (30000, 300), (20000, 0)], 0, False))
    cases.append(([(1, 0)] * 50000 + [(1, 1)] * 50000, 0, False))
    cases.append(([(100000, 1)], 0, False))
    cases.append(([(1, 1)], 0, False))
    cases.append(([(1, 0)], 0, False))
    cases.append(([(2, 1), (2, 1)], 0, False))
    cases.append(([(2, 2), (2, 2), (2, 0), (2, 0)], 0, False))

    def one(a):
        idx, (spec, own, numeric) = a
        d = os.path.join(WORK, "clu%04d" % idx)
        os.makedirs(d, exist_ok=True)
        cfg = {"outputs": {"tags": {"type": "set"}}, "routing": {"field": "route", "map": {"OUT": "auto", "ASK": "review"}}}
        json.dump(cfg, open(os.path.join(d, "config.json"), "w"))
        pred, key = [], []
        i = 0
        for c, (size, k) in enumerate(spec):
            for j in range(size):
                i += 1
                pred.append({"id": "R%d" % i, "route": "OUT", "tags": ["B" if j < k else "A"]})
                key.append({"id": "R%d" % i, "tags": ["A"], "story": c if numeric else "c%d" % c})
        extra = []
        for j in range(own):
            i += 1
            pred.append({"id": "R%d" % i, "route": "OUT", "tags": ["A"]})
            key.append({"id": "R%d" % i, "tags": ["A"]})
            extra.append((1, 0))
        # a record not out never counts
        pred.append({"id": "Q", "route": "ASK", "tags": ["B"]})
        key.append({"id": "Q", "tags": ["A"], "story": "c0"})
        json.dump(pred, open(os.path.join(d, "pred.json"), "w"))
        json.dump(key, open(os.path.join(d, "key.json"), "w"))
        r = node(["score", "--config", "config.json", "--pred", "pred.json", "--key", "key.json", "--cluster-by", "story",
                  "--json", "out.json", "--quiet"], d)
        f = os.path.join(d, "out.json")
        o = json.load(open(f, encoding="utf-8")) if os.path.exists(f) else None
        shutil.rmtree(d, ignore_errors=True)
        return (spec, own), r, o

    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(one, enumerate(cases)))
    for (spec, own), r, o in results:
        tag = (spec[:6], len(spec), own)
        if o is None or not o.get("clusters"):
            T.add("cluster.ran", False, (tag, r.stdout[:200], r.stderr[:200]))
            continue
        c = o["clusters"]
        ora = st.cluster_range(list(spec) + [(1, 0)] * own)
        T.add("cluster.records,errors,clusters", (c["records"], c["silent_errors"], c["clusters"]) == (ora["n"], ora["s"], ora["C"]),
              (tag, c, ora))
        T.add("cluster.records_own_cluster", c["records_own_cluster"] == own, (tag, c["records_own_cluster"], own))
        T.add("cluster.method", (c["method"] == "design_effect") == (ora["method"] == "design_effect"), (tag, c["method"], ora["method"]))
        if ora["deff"] is not None and c.get("design_effect") is not None:
            T.add("cluster.design_effect", abs(st.D(c["design_effect"]) - st.D(ora["deff"])) < Decimal("1e-9"),
                  (tag, c["design_effect"], float(ora["deff"])))
        T.add("cluster.effective_records", abs(st.D(c["effective_records"]) - st.D(ora["eff"])) < Decimal("1e-9"),
              (tag, c["effective_records"], float(ora["eff"])))
        T.add("cluster.low_pct", st.close(c["low_pct"], ora["low"], 1), (tag, c["low_pct"], float(ora["low"])))
        T.add("cluster.high_pct", st.close(c["high_pct"], ora["high"], 1), (tag, c["high_pct"], float(ora["high"])))


def check_score_target(T, seed, count=300):
    rng = random.Random(seed)
    TARGETS = ["0.5", "1", "2", "5", "10", "20", "50"]
    cases = [(0, 0, 5, "5"), (0, 1, 0, "5"), (1, 1, 0, "5"), (0, 30, 70, "5"), (2, 100, 400, "5"), (1, 3, 9, "50")]
    while len(cases) < count:
        out = rng.choice([1, 2, 5, 10, 20, 50, 100, 200, 400])
        k = rng.choice([0, 0, 1, 2, rng.randint(0, out), out])
        k = min(k, out)
        cases.append((k, out, rng.choice([0, 1, 3, 10, 100, out, 3 * out]), rng.choice(TARGETS)))

    def one(a):
        idx, (k, out, other, t) = a
        d = os.path.join(WORK, "st%04d" % idx)
        os.makedirs(d, exist_ok=True)
        cfg = {"outputs": {"tags": {"type": "set"}}, "routing": {"field": "route", "map": {"OUT": "auto", "ASK": "review"}}}
        json.dump(cfg, open(os.path.join(d, "config.json"), "w"))
        pred = [{"id": "R%d" % i, "route": "OUT", "tags": ["B" if i < k else "A"]} for i in range(out)]
        pred += [{"id": "Q%d" % i, "route": "ASK", "tags": ["A"]} for i in range(other)]
        key = [{"id": x["id"], "tags": ["A"]} for x in pred]
        json.dump(pred, open(os.path.join(d, "pred.json"), "w"))
        json.dump(key, open(os.path.join(d, "key.json"), "w"))
        r = node(["score", "--config", "config.json", "--pred", "pred.json", "--key", "key.json", "--target", t, "--json", "o.json", "--quiet"], d)
        f = os.path.join(d, "o.json")
        o = json.load(open(f, encoding="utf-8")) if os.path.exists(f) else None
        shutil.rmtree(d, ignore_errors=True)
        return (k, out, other, t), r, o

    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(one, enumerate(cases)))
    for (k, out, other, t), r, o in results:
        tag = (k, out, other, t)
        if o is None:
            T.add("score.target.ran", False, (tag, (r.stdout + r.stderr)[:220]))
            continue
        tt = o.get("target")
        if out == 0:
            T.add("score.target with nothing out", tt is None or tt.get("shown") in (False, None), (tag, tt))
            continue
        total = out + other
        R = st.rate_obj(k, out)
        tgt = st.D(t) / 100
        shown = R.hi < tgt
        T.add("score.target.tested", tt["tested"] == out, (tag, tt["tested"]))
        T.add("score.target.shown", tt["shown"] == shown, (tag, tt["shown"], float(R.hi)))
        T.add("score.target.high_pct", st.close(tt["high_pct"], R.high_pct, 1), (tag, tt["high_pct"]))
        T.add("score.target.at_or_above", tt["rate_at_or_above"] == (Fraction(k, out) >= Fraction(t) / 100), (tag,))
        pr = st.perfect_run(tgt)
        T.add("score.target.perfect_run.n", tt["perfect_run"]["n"] == pr, (tag, tt["perfect_run"], pr))
        allr = math.ceil(Fraction(pr * total, out))
        T.add("score.target.perfect_run.all_records = ceil(n/straight-through)", tt["perfect_run"]["all_records"] == allr, (tag, tt["perfect_run"], allr))
        p = tt.get("plan")
        if p and not shown and p.get("exact"):
            pf = float(Fraction(k, out))
            nf, _ = plan_first(pf, float(tgt), 0.8)
            ns = plan_stable(pf, float(tgt), 0.8, nf)
            T.add("score.target.plan.n (never drops under)", p["n"] == ns, (tag, p["n"], ns))
            T.add("score.target.plan.all_records", p["all_records"] == math.ceil(Fraction(ns * total, out)), (tag, p, ns))


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 20261103
    T = Tally()
    if which in ("target", "all"):
        check_score_target(T, seed)
    if which in ("rate", "all"):
        check_rate(T, seed)
    if which in ("gate", "all"):
        check_gate(T, seed)
    if which in ("heldout", "all"):
        check_heldout(T, seed)
    if which in ("tango", "all"):
        check_tango(T, seed)
    if which in ("cluster", "all"):
        check_cluster(T, seed)
    T.show(which)
    if PLAN_GAP:
        off = sorted(100.0 * (h - n) / n for t, h, n in PLAN_GAP)
        print("  approximate plans:", len(off), "off from the exact stable n, percent: min %.3f median %.3f max %.3f" % (off[0], off[len(off) // 2], off[-1]))
        print("  smallest approximate plan n:", min(h for t, h, n in PLAN_GAP))
    with open(os.path.join(HERE, "results", "stats-%s.json" % which), "w") as f:
        json.dump(dict(counts=dict(T.c), agree=dict(T.ok), bad=[(a, str(d)[:400]) for a, d in T.bad]), f, indent=1)


if __name__ == "__main__":
    main()
