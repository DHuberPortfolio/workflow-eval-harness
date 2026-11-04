"""Tango through a second door: the paired block of `whatif --policies --json`, on the compliance
golden 500 and the policy fixture. Each row's counts and range are recomputed from fixed and broke,
and each p-value from its own records out. usage: python check_policies.py"""
import json
import os
import subprocess

import oracle_stats as st
from check_stats import Tally, WF, BASE, HERE

T = Tally()
CASES = [
    ("examples/compliance-reviewer/config.json", "examples/compliance-reviewer/golden500/exec-67.harness.json",
     "examples/compliance-reviewer/golden500/exec-67.harness.json", "examples/compliance-reviewer/policies.json", "5"),
    ("test/fixtures/policy/config.json", "test/fixtures/policy/predictions.json", "test/fixtures/policy/key.json",
     "test/fixtures/policy/policies.json", "30"),
]
for cfg, p, k, pol, t in CASES:
    out = os.path.join(HERE, "tmp", "pol.json")
    r = subprocess.run(["node", WF, "whatif", "--config", cfg, "--pred", p, "--key", k, "--policies", pol, "--target", t, "--json", out],
                       capture_output=True, text=True, cwd=BASE, encoding="utf-8", errors="replace")
    d = json.load(open(out, encoding="utf-8"))
    tgt = st.D(t) / 100
    rows = d["rows"]
    level = st.D(0.05) / len(rows)
    for row in rows:
        name = row["name"]
        s = row["silent_error_rate"]
        if s["d"]:
            ex = st.binom_cdf(s["n"], s["d"], tgt)
            T.add("policy.p_value exact binomial", abs(st.D(row["p_value"]) - ex) < st.D("1e-9"), (name, row["p_value"], float(ex)))
            T.add("policy.certified", bool(row["certified"]) == (ex <= level), (name, row["certified"], float(ex), float(level)))
        pr = row.get("paired")
        if not pr:
            continue
        n = pr["records"]
        for outcome in ("silent_errors", "silent_omissions", "unnecessary_reviews"):
            x = pr.get(outcome)
            if not x:
                continue
            lo, hi = st.tango(x["broke"], x["fixed"], n)
            tag = (name, outcome, x["fixed"], x["broke"], n)
            T.add("policy.tango low", st.close(x["low_pct"], lo * 100, 1), (tag, x["low_pct"], float(lo * 100)))
            T.add("policy.tango high", st.close(x["high_pct"], hi * 100, 1), (tag, x["high_pct"], float(hi * 100)))
            want = "no change" if x["fixed"] == 0 and x["broke"] == 0 else ("better" if hi < 0 else ("worse" if lo > 0 else "unclear"))
            T.add("policy.tango verdict", x["verdict"] == want, (tag, x["verdict"], want))
T.show("policies")
with open(os.path.join(HERE, "results", "policies.json"), "w") as f:
    json.dump(dict(counts=dict(T.c), agree=dict(T.ok), bad=[(a, str(b)[:300]) for a, b in T.bad]), f, indent=1)
