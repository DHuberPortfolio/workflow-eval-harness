"""The monitor, from METRICS.md "Live samples over time". Standard library only."""
import math
from decimal import Decimal
from fractions import Fraction
from functools import lru_cache

import oracle_stats as st


def scores(p0, p1):
    """(up, down): the ratio of the two logs, in whole steps with the larger at least 50."""
    up = math.log(p1 / p0)
    down = math.log((1 - p0) / (1 - p1))
    r = up / down
    if r >= 1:
        d = 1
        while True:
            u = int(math.floor(r * d + 0.5))
            if u >= 50:
                return u, d
            d += 1
    else:
        u = 1
        while True:
            d = int(math.floor(u / r + 0.5))
            if d >= 50:
                return u, d
            u += 1


def scores_unrounded(p0, p1):
    """The other reading: scale until the larger reaches 50 BEFORE rounding."""
    up = math.log(p1 / p0)
    down = math.log((1 - p0) / (1 - p1))
    r = up / down
    if r >= 1:
        d = int(math.ceil(50 / r))
        return int(math.floor(r * d + 0.5)), d
    u = int(math.ceil(50 * r))
    return u, int(math.floor(u / r + 0.5))


def binom_pmf_table(m, p):
    """[(y, prob)] for y where the prob is not negligible."""
    if p <= 0:
        return [(0, 1.0)]
    if p >= 1:
        return [(m, 1.0)]
    lp, lq = math.log(p), math.log1p(-p)
    mode = int((m + 1) * p)
    lmode = math.lgamma(m + 1) - math.lgamma(mode + 1) - math.lgamma(m - mode + 1) + mode * lp + (m - mode) * lq
    out = []
    cur = math.exp(lmode)
    out.append((mode, cur))
    y, v = mode, cur
    while y > 0:
        v = v * y / (m - y + 1) * (1 - p) / p
        y -= 1
        if v < 1e-20:
            break
        out.append((y, v))
    y, v = mode, cur
    while y < m:
        v = v * (m - y) / (y + 1) * p / (1 - p)
        y += 1
        if v < 1e-20:
            break
        out.append((y, v))
    s = sum(x[1] for x in out)
    return [(a, b / s) for a, b in sorted(out)]


def arl_periods(H, up, down, m, p):
    """Average periods until S >= H, from S = 0, S floored at 0 at each period's end,
    by following the chance of every value of S (Brook & Evans)."""
    g = math.gcd(up, down)
    u, d = up // g, down // g
    # states in units of g; an alarm when S*g >= H
    H2 = (H + g - 1) // g
    pm = binom_pmf_table(m, p)
    moves = [((u + d) * y - d * m, pr) for y, pr in pm]
    # a jump that always leaves the band
    dist = {0: 1.0}
    total = 0.0
    surv = 1.0
    prev_ratio = None
    t = 0
    while True:
        total += surv
        new = {}
        for s, ps in dist.items():
            if ps < 1e-24 * surv:
                continue
            for st_, pr in moves:
                ns = s + st_
                if ns <= 0:
                    new[0] = new.get(0, 0.0) + ps * pr
                elif ns < H2:
                    new[ns] = new.get(ns, 0.0) + ps * pr
        s2 = sum(new.values())
        t += 1
        if s2 <= 1e-300:
            return total
        ratio = s2 / surv
        surv = s2
        dist = new
        if t > 30 and prev_ratio is not None and abs(ratio - prev_ratio) < 1e-14:
            # a ratio that rounds to 1: an alarm chance per period under what a double can hold
            return total + surv / (1 - ratio) if ratio < 1 else float("inf")
        prev_ratio = ratio
        if t > 3000000:
            return total + surv / (1 - ratio)


def arl_renewal(H, up, down, m, p):
    """The same average as arl_periods, by cycles: from S = 0, a cycle ends on the first return to
    0 or on an alarm. A(s) is the chance of an alarm before 0 from s, T(s) the average periods to
    either. Sweeping s upward, a record of right answers (the usual move, downward) is already
    solved, so few sweeps are needed; a downward sweep follows, for the upward moves."""
    g = math.gcd(up, down)
    u, d = up // g, down // g
    H2 = (H + g - 1) // g
    pm = binom_pmf_table(m, p)
    moves = [((u + d) * y - d * m, pr) for y, pr in pm]
    T = [0.0] * (H2 + 1)
    A = [0.0] * (H2 + 1)
    for sweep in range(200000):
        change = 0.0
        for order in (range(1, H2), range(H2 - 1, 0, -1)):
            for s in order:
                t = 1.0
                a = 0.0
                for st_, pr in moves:
                    ns = s + st_
                    if ns <= 0:
                        continue
                    if ns >= H2:
                        a += pr
                    else:
                        t += pr * T[ns]
                        a += pr * A[ns]
                dt = abs(t - T[s])
                if dt > change * (1 + t):
                    change = dt / (1 + t)
                da = abs(a - A[s])
                if da > change:
                    change = da
                T[s] = t
                A[s] = a
        if change < 1e-13:
            break
    stay = 0.0
    total = 1.0
    alarm_mass = 0.0
    for st_, pr in moves:
        ns = st_
        if ns <= 0:
            stay += pr
        elif ns >= H2:
            alarm_mass += pr
        else:
            total += pr * T[ns]
            stay += pr * (1 - A[ns])
    return total / (1 - stay)


_arl_cache = {}


def arl(H, up, down, m, p):
    k = (H, up, down, m, round(p, 14))
    if k not in _arl_cache:
        # the two routes give the same average (tmp/t_arl.py). Big periods have many outcomes and
        # short runs, which suits following the chance of every S; small periods the cycles.
        _arl_cache[k] = arl_periods(H, up, down, m, p) if m >= 60 else arl_renewal(H, up, down, m, p)
    return _arl_cache[k]


_lvl_cache = {}


def alarm_level(up, down, m, p0, budget):
    """Smallest whole level whose records per false alarm at p0 reach the budget."""
    k = (up, down, m, round(p0, 14), budget)
    if k in _lvl_cache:
        return _lvl_cache[k]
    lo, hi = 1, max(up, down)
    while arl(hi, up, down, m, p0) * m < budget:
        lo = hi + 1
        hi *= 2
    while lo < hi:
        mid = (lo + hi) // 2
        if arl(mid, up, down, m, p0) * m >= budget:
            hi = mid
        else:
            lo = mid + 1
    _lvl_cache[k] = lo
    return lo


def _betacf(a, b, x):
    FPMIN = 1e-300
    qab, qap, qam = a + b, a + 1, a - 1
    c = 1.0
    d = 1 - qab * x / qap
    d = 1 / (d if abs(d) > FPMIN else FPMIN)
    h = d
    for m in range(1, 500000):
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
        if abs(de - 1) < 3e-16:
            break
    return h


def log_evidence(S, F, t):
    """log E(S, F; t). Up to 3,000 right records, the finite sum below; past that the same
    integral as an incomplete beta function, E = B_t(S+1, F+1) / (t^(S+1) (1-t)^F)."""
    if F <= 3000:
        return log_evidence_sum(S, F, t)
    t = float(t)
    if t <= 0:
        return -math.log(S + 1)
    if t >= 1:
        return float("inf")
    a, b = S + 1, F + 1
    if t < (a + 1) / (a + b + 2):
        return math.log1p(-t) + math.log(_betacf(a, b, t)) - math.log(a)
    lbeta = math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b)
    front = a * math.log(t) + b * math.log1p(-t) - lbeta
    ic = math.exp(front + math.log(_betacf(b, a, 1 - t)) - math.log(b))
    logi = math.log1p(-ic) if ic < 1 else -1e300
    return logi + lbeta - a * math.log(t) - F * math.log1p(-t)


def log_evidence_sum(S, F, t):
    """log E(S, F; t). E = sum_{i=0..F} a_i, a_0 = 1/(S+1), a_{i+1} = a_i r (F-i)/(S+2+i),
    r = t/(1-t): the integral in METRICS.md worked out term by term (all terms positive)."""
    t = float(t)
    if t >= 1:
        return float("inf")
    r = t / (1 - t)
    a = -math.log(S + 1)
    if F == 0 or t <= 0:
        return a
    lr = math.log(r)
    # scaled sum around the largest term
    best = a
    terms = [a]
    cur = a
    sumexp = 1.0
    base = a
    for i in range(F):
        cur += lr + math.log(F - i) - math.log(S + 2 + i)
        if cur > base + 600:
            sumexp *= math.exp(base - cur)
            base = cur
            sumexp += 1.0
            continue
        v = math.exp(cur - base)
        sumexp += v
        if v < 1e-18 and (r * (F - i - 1) / (S + 3 + i)) < 1:
            break
    return base + math.log(sumexp)


def evidence(S, F, t):
    return math.exp(log_evidence(S, F, t))


def evidence_exact(S, F, t):
    """Same sum in Decimal, for the closest calls."""
    t = st.D(t)
    r = t / (1 - t)
    a = Decimal(1) / (S + 1)
    total = a
    for i in range(F):
        a = a * r * (F - i) / (S + 2 + i)
        total += a
    return total


def upper_bound(S, F, bar=20.0):
    """The lowest rate at which E reaches the bar. None when it never does (F = 0)."""
    if F == 0:
        return None
    lb = math.log(bar)
    lo, hi = 0.0, 1 - 1e-12
    if log_evidence(S, F, lo + 1e-15) >= lb:
        return 0.0
    for _ in range(70):
        mid = (lo + hi) / 2
        if log_evidence(S, F, mid) >= lb:
            hi = mid
        else:
            lo = mid
    return hi


def records_for_bar(t, bar=20.0):
    """With no silent error: fewest right records with E >= bar."""
    lb = math.log(bar)
    lo, hi = 0, 1
    while log_evidence(0, hi, t) < lb:
        lo = hi
        hi *= 2
    while lo + 1 < hi:
        mid = (lo + hi) // 2
        if log_evidence(0, mid, t) >= lb:
            hi = mid
        else:
            lo = mid
    return hi


def median(xs):
    s = sorted(xs)
    n = len(s)
    if n % 2:
        return s[n // 2]
    return Fraction(s[n // 2 - 1] + s[n // 2], 2)
