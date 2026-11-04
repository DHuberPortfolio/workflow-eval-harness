"""Reruns every check against the harness and says what each one found. See README.md.

usage: python verify/run_all.py [--base <checkout>] [--out <folder>] [--quick]

--base   the checkout to test (WFEVAL_ROOT), by default this repository
--out    where scenarios, logs and results go (WFEVAL_VERIFY_OUT), by default verify/out
--quick  a tenth of the random cases, and only the statistics that take seconds: a few minutes
         instead of about ten

Exit 0 when nothing is left unexplained, 1 when a check crashed or disagreed in a way README.md
does not list. Each step's full output is in <out>/logs/<step>.log.
"""
import argparse
import os
import re
import subprocess
import sys
import time

CODE = os.path.dirname(os.path.abspath(__file__))
SEED = "20261103"

# Disagreements README.md explains. A label that is not here stops the run being clean.
EXPLAINED = (
    "plan.n = first n reaching the chance",            # two readings of "the records a test needs": the one kept is the next line's
    "plan present when not shown",
    "plan in the JSON although the target is shown",
    "plan.n = n from which the chance never drops under (exact=False)",   # past the exact sum's limit the plan is an estimate
    "plan: approximate n never under the stable n",
    "plan: chance at its n really reaches the ask (exact=False)",
    "plan.exact false",
    "gate.p_value exact binomial",                     # the last digits, at 100,000 records
    "held.p_value exact binomial",
    "mon.scores",                                      # which whole-number pair stands for a ratio
    "mon.design.false_alarm_records given",            # a false alarm past what a double can count
)


def steps(quick):
    n = lambda full: str(max(10, int(full) // 10)) if quick else full
    out = [("scenarios", ["gen_scenarios.py"]),
           ("examples_fixtures", ["compare_runs.py", "all"]),
           ("generated_default", ["compare_generated.py"]),
           ("generated_lenient", ["compare_generated.py", "--lenient"]),
           ("grades_itself", ["harness_grades_itself.py"])]
    out += [("stats_" + a, ["check_stats.py", a]) for a in (("gate", "tango", "cluster") if quick else ("rate", "target", "gate", "heldout", "tango", "cluster"))]
    out += [("monitor", ["check_monitor.py", "series", SEED, n("400")]),
            ("monitor_files", ["check_monitor_files.py"]),
            ("segments", ["check_segments.py", SEED, n("150")]),
            ("split", ["check_split.py", SEED, n("300")]),
            ("estimate", ["check_estimate.py", SEED, n("500")]),
            ("policies", ["check_policies.py"]),
            ("doc_numbers", ["check_doc_numbers.py"])]
    if not quick:
        out.append(("by_cause", ["by_cause.py"]))
    return out


def read(text):
    """values compared, values that disagree, and the labels of what disagreed, from one step's log."""
    values = agree = 0
    labels = []
    for line in text.split("\n"):
        m = re.match(r"\s+TOTAL\s+values\s+(\d+)\s+agree\s+(\d+)\s+disagree\s+(\d+)", line)
        if m:
            values += int(m.group(1))
            agree += int(m.group(2))
            continue
        m = re.match(r"\s*\S.*?\s(\d+)\s+agree\s+(\d+)\s*$", line)
        if m and " values " not in line:
            values += int(m.group(1))
            agree += int(m.group(2))
        m = re.match(r"\s+DISAGREE\s+\d+\s+(.+)$", line)
        if m:
            labels.append(m.group(1).strip())
    m = re.search(r"field compare: values (\d+) agree (\d+)", text)
    if m:
        values += int(m.group(1))
        agree += int(m.group(2))
    counts = re.findall(r"python count, .* equal: (\d+) of (\d+)", text)
    if counts:
        values = sum(int(b) for a, b in counts)
        agree = sum(int(a) for a, b in counts)
    m = re.search(r"doc numbers recomputed: (\d+) agree: (\d+)", text)
    if m:
        values, agree = int(m.group(1)), int(m.group(2))
    return values, values - agree, labels


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base")
    ap.add_argument("--out")
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    env = os.environ
    if args.base:
        env["WFEVAL_ROOT"] = os.path.abspath(args.base)
    if args.out:
        env["WFEVAL_VERIFY_OUT"] = os.path.abspath(args.out)
    out = env.get("WFEVAL_VERIFY_OUT") or os.path.join(CODE, "out")
    logs = os.path.join(out, "logs")
    os.makedirs(logs, exist_ok=True)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    bad = []
    started = time.time()
    print("%-22s %10s %10s  %s" % ("step", "values", "differ", "seconds"))
    for name, cmd in steps(args.quick):
        t0 = time.time()
        r = subprocess.run([sys.executable, os.path.join(CODE, cmd[0])] + cmd[1:], cwd=CODE, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
        text = r.stdout + r.stderr
        with open(os.path.join(logs, name + ".log"), "w", encoding="utf-8") as f:
            f.write(text)
        values, differ, labels = read(text)
        print("%-22s %10d %10d  %d" % (name, values, differ, time.time() - t0), flush=True)
        if r.returncode != 0:
            bad.append("%s crashed: see logs/%s.log" % (name, name))
        if name in ("examples_fixtures", "generated_default", "generated_lenient", "grades_itself") and differ:
            bad.append("%s: %d values disagree" % (name, differ))
        bad += ["%s: %s" % (name, l) for l in labels if not l.startswith(EXPLAINED)]
        if "doc numbers recomputed" in text and differ:
            bad.append("doc_numbers: %d differ" % differ)
    print("\nfinished in %d minutes; logs in %s" % ((time.time() - started) / 60, logs))
    if bad:
        print("NOT EXPLAINED:")
        for b in bad:
            print("  " + b)
        return 1
    print("every difference is one README.md explains")
    return 0


if __name__ == "__main__":
    sys.exit(main())
