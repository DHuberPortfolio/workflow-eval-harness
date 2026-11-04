"""Numbers the docs state, recomputed by the oracle alone (no harness). A disagreement here means
the docs or the oracle are wrong. usage: python check_doc_numbers.py"""
from decimal import Decimal
from fractions import Fraction

import oracle_monitor as om
import oracle_stats as st
from check_estimate import mover, group_range

rows = []


def show(what, got, quoted, dp=1):
    ok = st.close(quoted, got, dp) if quoted is not None else got is None
    rows.append((ok, what, float(got) if got is not None else None, quoted))


def wil(x, n):
    return st.wilson(x, n)


for x, n, lo, hi in [(6, 20, 14.5, 51.9), (25, 256, 6.7, 14.0), (18, 210, 5.5, 13.1), (8, 105, 3.9, 14.3), (44, 615, 5.4, 9.5),
                     (3, 30, 3.5, 25.6), (4, 12, 13.8, 60.9), (1, 24, 0.7, 20.2), (3, 30, 3.5, 25.6)]:
    a, b = wil(x, n)
    show("wilson %d of %d low" % (x, n), a * 100, lo)
    show("wilson %d of %d high" % (x, n), b * 100, hi)
for n, hi in [(7, 35.4), (8, 32.4), (12, 24.3), (10, 27.8), (20, 16.1)]:
    show("wilson 0 of %d high" % n, wil(0, n)[1] * 100, hi)
show("plain high of 0 of 12 counted as 144/34 records", wil(0, Fraction(144, 34))[1] * 100, 47.6)
show("3 of 12 at 144/34", wil(Fraction(3, 12) * Fraction(144, 34), Fraction(144, 34))[1] * 100, 69.0)
show("3 of 12 independent", wil(3, 12)[1] * 100, 53.2)
show("1 of 12 at 144/34", wil(Fraction(1, 12) * Fraction(144, 34), Fraction(144, 34))[1] * 100, 55.6)
show("1 of 12 independent", wil(1, 12)[1] * 100, 35.4)
show("exact bound 0 of 10 at 2.5%", st.cp_upper(0, 10, Decimal("0.025")) * 100, 30.8)
show("exact bound 10 of 105 at 2.5%", st.cp_upper(10, 105, Decimal("0.025")) * 100, 16.8)
show("exact bound 10 of 105 at fifth look", st.cp_upper(10, 105, Decimal("0.05") / 32) * 100, 20.9)
show("records 5% target, none wrong", st.perfect_run(Decimal("0.05")), 73, 0)
show("records 1% target, none wrong", st.perfect_run(Decimal("0.01")), 381, 0)
show("gate 0.75 p-value 3 of 30 at 30%", st.binom_cdf(3, 30, Decimal("0.3")), 0.0093, 4)
show("0.05 / 11", Decimal("0.05") / 11, 0.0045, 4)
show("0.95^100", Decimal("0.95") ** 100 * 100, 0.59, 2)

# monitor
p0, p1 = .025, .05
show("up steps", om.scores(p0, p1)[0], 53, 0)
show("down steps", om.scores(p0, p1)[1], 2, 0)
show("break-even", Fraction(200, 55), 3.6)
show("E(0,87)", om.evidence(0, 87, .05), 19.49, 2)
show("E(0,88)", om.evidence(0, 88, .05), 20.30, 2)
for p00, m, rate, quoted in [(.01, 50, .01, 2153), (.01, 50, .02, 380), (.025, 50, .025, 2242), (.025, 50, .05, 229), (.05, 50, .05, 2380), (.05, 50, .10, 148)]:
    u, d = om.scores(p00, 2 * p00)
    H = om.alarm_level(u, d, m, p00, 2000)
    show("chain table p0=%s m=%d at %s" % (p00, m, rate), om.arl(H, u, d, m, rate) * m, quoted, 0)
u, d = om.scores(.025, .05)
H = om.alarm_level(u, d, 30, .025, 2000)
for rate, quoted in [(.025, 2065), (.03, 992), (.035, 576), (.04, 384), (.045, 280), (.05, 219)]:
    show("steady rate, weeks of 30, %s" % rate, om.arl(H, u, d, 30, rate) * 30, quoted, 0)
for fa, a, b, c in [(1000, 1033, 169, 88), (2000, 2242, 229, 112), (5000, 5633, 309, 141), (10000, 10191, 364, 164)]:
    H = om.alarm_level(u, d, 50, .025, fa)
    show("fa %d at 2.5%%" % fa, om.arl(H, u, d, 50, .025) * 50, a, 0)
    show("fa %d flag 5%%" % fa, om.arl(H, u, d, 50, .05) * 50, b, 0)
    show("fa %d flag 7.5%%" % fa, om.arl(H, u, d, 50, .075) * 50, c, 0)
# the omissions table: 10% to 20%
u2, d2 = om.scores(.10, .20)
for m, fa, pfa, pfl in [(3, 250, 88, 12.8), (3, 2000, 690, 26.0), (5, 250, 51, 7.7), (5, 500, 101, 10.1), (5, 2000, 401, 15.6), (10, 500, 59, 5.4), (10, 2000, 223, 8.1)]:
    H = om.alarm_level(u2, d2, m, .10, fa)
    show("omissions m=%d fa=%d periods per false alarm" % (m, fa), om.arl(H, u2, d2, m, .10), pfa, 0)
    show("omissions m=%d fa=%d periods to flag" % (m, fa), om.arl(H, u2, d2, m, .20), pfl, 1)
# records before a member can be shown, by bar
for t, vals in [(.02, (224, 266, 307, 361, 400, 439)), (.05, (88, 105, 121, 142, 158, 173)), (.10, (43, 51, 59, 69, 77, 84))]:
    for bar, q in zip((20, 40, 80, 200, 400, 800), vals):
        show("records at target %s bar %d" % (t, bar), om.records_for_bar(t, bar), q, 0)

# estimate
r, lo, hi = mover(20, 5, 4, 3, 6, 1)
show("estimate fixture rate", r * 100, 31.3)
show("estimate fixture low", lo * 100, 12.8)
show("estimate fixture high", hi * 100, 64.2)
r, lo, hi = mover(10, 2, 2, 2, 8, 0)
show("READING 2 of 2 flags, 0 of 8 passes, rate", r * 100, 20.0)
show("READING low", lo * 100, 0.0)
show("READING high", hi * 100, 60.4)

bad = [x for x in rows if not x[0]]
print("doc numbers recomputed:", len(rows), "agree:", len(rows) - len(bad))
for ok, what, got, q in bad:
    print("  DIFF %-52s oracle %s  docs %s" % (what, got, q))
