"""Where things are, for every script here.

BASE  the checkout under test: WFEVAL_ROOT if set (run_all.py --base sets it), else this repository.
HERE  where output goes: WFEVAL_VERIFY_OUT if set (run_all.py --out sets it), else verify/out, which
      git ignores. Scenarios, logs, results and scratch files all land there, none beside the code.
CODE  this folder.
"""
import os

CODE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.abspath(os.environ.get("WFEVAL_ROOT") or os.path.dirname(CODE))
HERE = os.path.abspath(os.environ.get("WFEVAL_VERIFY_OUT") or os.path.join(CODE, "out"))
WF = os.path.join(BASE, "bin", "wfeval.js")

for name in ("logs", "results", "scenarios", "tmp"):
    os.makedirs(os.path.join(HERE, name), exist_ok=True)
