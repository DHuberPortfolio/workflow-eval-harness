"""Statistics for the oracle, written from docs/METRICS.md. Standard library only.
Exact (Fraction) or high-precision (Decimal, 120 digits) wherever a value should be exact."""
import math
from decimal import Decimal, getcontext, MAX_EMAX, MIN_EMIN, ROUND_HALF_EVEN
from fractions import Fraction

ctx = getcontext()
ctx.prec = 120
ctx.Emax = MAX_EMAX
ctx.Emin = MIN_EMIN

Z = Decimal("1.96")


def D(x):
    if isinstance(x, Decimal):
        return x
    if isinstance(x, Fraction):
        return Decimal(x.numerator) / Decimal(x.denominator)
    if isinstance(x, float):
        return Decimal(repr(x))
    return Decimal(x)


def wilson(x, n, z=Z):
    """Wilson 95% score interval for x of n. x may be a real (p*n) and n a real."""
    x, n = D(x), D(n)
    if n <= 0:
        return None
    p = x / n
    z2 = z * z
    den = 1 + z2 / n
    centre = p + z2 / (2 * n)
    half = z * ((p * (1 - p) / n + z2 / (4 * n * n)).sqrt())
    lo = (centre - half) / den
    hi = (centre + half) / den
    if x == 0:
        lo = Decimal(0)
    if x == n:
        hi = Decimal(1)
    return max(lo, Decimal(0)), min(hi, Decimal(1))


class Rate:
    __slots__ = ("n", "d", "lo", "hi")

    def __init__(self, n, d):
        self.n, self.d = n, d
        w = wilson(n, d) if d else None
        self.lo, self.hi = w if w else (None, None)

    @property
    def pct(self):
        return None if self.d == 0 else Fraction(100 * self.n, self.d)

    @property
    def low_pct(self):
        return None if self.d == 0 else self.lo * 100

    @property
    def high_pct(self):
        return None if self.d == 0 else self.hi * 100


def rate_obj(n, d):
    return Rate(n, d)


def f1(tp, fp, fn):
    d = 2 * tp + fp + fn
    return None if d == 0 else Fraction(2 * tp, d)


def close(harness, exact, dp):
    """harness (a JSON number rounded to dp places) agrees with exact: within half a unit
    of the last place (ties may go either way, rounding of a tie is not specified)."""
    if harness is None or exact is None:
        return harness is None and exact is None
    e = D(exact)
    h = D(Fraction(harness).limit_denominator(10 ** (dp + 3)))
    return abs(h - e) <= Decimal(5) / (Decimal(10) ** (dp + 1)) + Decimal("1e-12")


# ---------- exact binomial ----------

def binom_cdf(k, n, p):
    """P(Bin(n,p) <= k), to about 100 digits. p: Fraction/Decimal/float-as-repr."""
    p = D(p)
    if k < 0:
        return Decimal(0)
    if k >= n:
        return Decimal(1)
    if p == 0:
        return Decimal(1)
    if p == 1:
        return Decimal(0)
    q = 1 - p
    # term j=0 can be below any float, Decimal is fine with that
    term = q ** n
    total = term
    ratio = p / q
    for j in range(0, k):
        term = term * (n - j) / (j + 1) * ratio
        total += term
    return total if total < 1 else Decimal(1)


def binom_sf(k, n, p):
    """P(Bin(n,p) >= k)."""
    return 1 - binom_cdf(k - 1, n, p)


def cp_upper(k, n, alpha):
    """One-sided Clopper-Pearson upper bound: the p with P(Bin(n,p) <= k) = alpha."""
    if k >= n:
        return Decimal(1)
    lo, hi = Decimal(0), Decimal(1)
    alpha = D(alpha)
    for _ in range(70):
        mid = (lo + hi) / 2
        if binom_cdf(k, n, mid) > alpha:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def cp_lower(x, n, alpha):
    """One-sided Clopper-Pearson lower bound: the p with P(Bin(n,p) >= x) = alpha."""
    if x <= 0:
        return Decimal(0)
    lo, hi = Decimal(0), Decimal(1)
    alpha = D(alpha)
    for _ in range(70):
        mid = (lo + hi) / 2
        if binom_sf(x, n, mid) < alpha:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


# ---------- planning ----------

def wilson_high_float(k, n):
    z = 1.96
    p = k / n
    z2 = z * z
    if k == n:
        return 1.0
    return (p + z2 / (2 * n) + z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n)


def largest_shown(n, target):
    """Largest k with Wilson's high end under target (float screen, exact check)."""
    z2 = 1.96 * 1.96
    if not z2 / (n + z2) < target:
        return -1
    lo, hi = 0, n
    # high end grows with k
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if wilson_high_float(mid, n) < target:
            lo = mid
        else:
            hi = mid - 1
    # exact check at the edges
    while lo >= 0 and not wilson(lo, n)[1] < D(target):
        lo -= 1
    while lo + 1 <= n and wilson(lo + 1, n)[1] < D(target):
        lo += 1
    return lo


def perfect_run(target):
    """Fewest records, none wrong, whose Wilson high end is under the target.
    high(0,n) = z2/(n+z2). Exact."""
    t = D(target)
    z2 = Z * Z
    n = int(z2 / t - z2)
    if n < 1:
        n = 1
    while n > 1 and z2 / (n - 1 + z2) < t:
        n -= 1
    while not z2 / (n + z2) < t:
        n += 1
    return n


def show_chance(n, p, target):
    c = largest_shown(n, target)
    if c < 0:
        return Decimal(0), c
    return binom_cdf(c, n, p), c


def plan(p, target, chance, limit=2000000):
    """Smallest n whose chance of a fresh test showing it, at true rate p, reaches `chance`."""
    t = float(target)
    start = perfect_run(target)
    n = start
    pd = D(p)
    wanted = D(chance)
    # normal-approximation start for speed: well under the first crossing
    p_f = float(p)
    if p_f > 0:
        gap = t - p_f
        guess = int(0.5 * (1.96 * math.sqrt(p_f * (1 - p_f)) / gap) ** 2)
        n = max(start, guess)
    while n < limit:
        ch, c = show_chance(n, pd, t)
        if ch >= wanted:
            return n, ch
        n += 1
    return None, None


# ---------- Tango's paired score interval ----------

def _tango_T(b, c, n, dlt):
    pa = 2 * n
    pb = -b - c + (2 * n - b + c) * dlt
    pc = -c * dlt * (1 - dlt)
    disc = pb * pb - 4 * pa * pc
    if disc < 0:
        disc = Decimal(0)
    q21 = (disc.sqrt() - pb) / (2 * pa)
    v = n * (2 * q21 + dlt * (1 - dlt))
    if v <= 0:
        return None
    return (b - c - n * dlt) / v.sqrt()


def tango(b, c, n, z=Z):
    """Tango (1998): range of (b - c)/n, b records one way and c the other, n pairs.
    Returned as Decimals in -1..1."""
    b, c, n = D(b), D(c), D(n)
    obs = (b - c) / n

    def solve(target_z, lo, hi):
        # T falls as delta rises
        for _ in range(170):
            mid = (lo + hi) / 2
            t = _tango_T(b, c, n, mid)
            if t is None:
                t = Decimal(0)
            if t > target_z:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    low = solve(z, Decimal(-1), obs) if obs > -1 else Decimal(-1)
    high = solve(-z, obs, Decimal(1)) if obs < 1 else Decimal(1)
    return low, high


# ---------- clusters ----------

def cluster_range(sizes_errors):
    """sizes_errors: list of (n_c, s_c) over the records out. METRICS, Ranges that count clusters.
    Returns dict(method, deff, eff, low, high)."""
    C = len(sizes_errors)
    n = sum(a for a, b in sizes_errors)
    s = sum(b for a, b in sizes_errors)
    if n == 0:
        return None
    p = Fraction(s, n)
    with_err = sum(1 for a, b in sizes_errors if b > 0)
    with_ok = sum(1 for a, b in sizes_errors if a - b > 0)
    if with_err >= 2 and with_ok >= 2 and C >= 2:
        ss = sum((Fraction(b) - p * a) ** 2 for a, b in sizes_errors)
        v_c = ss * Fraction(C, C - 1) / (n * n)
        v_i = p * (1 - p) / (n - 1)
        deff = max(Fraction(1), v_c / v_i)
        eff = Fraction(n) / deff
        method = "design_effect"
    else:
        deff = None
        eff = Fraction(n * n, sum(a * a for a, b in sizes_errors))
        method = "worst_case"
    lo, hi = wilson(p * eff, eff)
    return dict(method=method, deff=deff, eff=eff, low=lo * 100, high=hi * 100, pct=p * 100, s=s, n=n, C=C)
