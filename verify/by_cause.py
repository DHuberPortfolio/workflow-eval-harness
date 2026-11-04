"""What each settled rule decides on the generated set: with every rule as the docs state it the
oracle and the harness should agree, and putting a rule back to its first reading shows how much
it moves. usage: python by_cause.py"""
import json
import os
import subprocess
import sys

from where import CODE

# Five rules the first reading of the docs got the other way, settled for the harness: each one a
# switch in oracle_core.READINGS, and its FIRST reading (README.md says why). A rule whose first
# reading no longer moves the count is one the generated cases have stopped reaching.
FIRST_READINGS = [("any_mismatch_ignores_key_route", "false", "any_mismatch: a record the key leaves out can need a person"),
                  ("gate_skip_if_any_no_confidence", "false", "--lenient lead gate: a value with no confidence, gate not known"),
                  ("wrong_primary_needs_gold", "false", "SP-WRONG-PRIMARY needs a correct route"),
                  ("floor_checks_labels", "true", "the floor reads set values, not labels"),
                  ("so_declined_on_exclude", "true", "SO-DECLINED: not where the key says exclude")]


def total(args):
    r = subprocess.run([sys.executable, os.path.join(CODE, "compare_generated.py")] + args, capture_output=True, text=True, cwd=CODE)
    for line in r.stdout.split("\n"):
        if "TOTAL" in line:
            return line.strip()
    return r.stdout[-300:]


if __name__ == "__main__":
    print("as the docs state them:", total([]))
    for k, v, name in FIRST_READINGS:
        print("put back: %-64s %s" % (name, total(["%s=%s" % (k, v)])))
    print("all five put back:", total(["%s=%s" % (k, v) for k, v, n in FIRST_READINGS]))
