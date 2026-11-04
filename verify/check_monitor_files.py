"""Monitor reading run files: the counts each period gets (scored with the oracle), the two
watched series, and the fixture counts files, through the same comparison as check_monitor.
usage: python check_monitor_files.py"""
import json
import os
import shutil
import subprocess

import oracle_core as oc
from check_monitor import compare_series
from check_stats import Tally, WF, BASE, HERE

F = "test/fixtures/"
WORK = os.path.join(HERE, "tmp", "monf")
os.makedirs(WORK, exist_ok=True)


def node(args, cwd=BASE):
    return subprocess.run(["node", WF] + args, capture_output=True, text=True, cwd=cwd, encoding="utf-8", errors="replace")


def counts(cfgp, files):
    cfg = oc.Config(os.path.join(BASE, cfgp))
    out = []
    for f in files:
        recs, c = oc.load_records(os.path.join(BASE, f), None)
        run = oc.judge_run(cfg, recs, recs, c, c)
        s = sum(1 for j in run.records if j.silent)
        o = sum(1 for j in run.records if j.route_class == "auto")
        left = [j for j in run.records if j.route_class in ("block", "exclude")]
        wrong = sum(1 for j in left if j.omission)
        out.append((os.path.splitext(os.path.basename(f))[0], o, s, len(left), wrong))
    return out


T = Tally()
for fx in ("monitor", "monitor-segments"):
    cfgp = F + fx + "/config.json"
    files = [F + fx + "/runs/2026-W%d.json" % w for w in (40, 41, 42)]
    per = counts(cfgp, files)
    for watch, tgt in (("silent-errors", 5), ("silent-omissions", 20)):
        o_f = os.path.join(WORK, "o.json")
        if os.path.exists(o_f):
            os.remove(o_f)
        r = node(["monitor", "--config", cfgp] + files + ["--target", str(tgt), "--watch", watch, "--json", o_f])
        if not os.path.exists(o_f):
            T.add("files.ran", watch == "silent-omissions" and fx == "monitor", (fx, watch, (r.stdout + r.stderr)[:220]))
            continue
        o = json.load(open(o_f, encoding="utf-8"))
        rows = [(p, a, b) if watch == "silent-errors" else (p, c, d) for p, a, b, c, d in per]
        for (p, n, y), h in zip(rows, o["periods"]):
            T.add("files.period counts", (h["rate"]["d"], h["rate"]["n"]) == (n, y), (fx, watch, p, h["rate"], n, y))
        s = dict(rows=rows, tgt=tgt, acc=None, ala=None, fae=None, ps=None, since=None)
        compare_series(T, s, r, o, fx + "/" + watch)
        print(fx, watch, rows)

for f, tgt, watch in ((F + "monitor/counts.csv", 5, None), (F + "monitor/counts.json", 5, None)):
    o_f = os.path.join(WORK, "o.json")
    if os.path.exists(o_f):
        os.remove(o_f)
    r = node(["monitor", "--counts", f, "--target", str(tgt), "--json", o_f])
    o = json.load(open(o_f, encoding="utf-8"))
    rows = [(h["period"], h["rate"]["d"], h["rate"]["n"]) for h in o["periods"]]
    compare_series(T, dict(rows=rows, tgt=tgt, acc=None, ala=None, fae=None, ps=None, since=None), r, o, f)

# the counted series is the second pair of columns with --watch silent-omissions
d = os.path.join(WORK, "w")
os.makedirs(d, exist_ok=True)
rows = [("P-%d" % (i + 1), 10 + i % 7, (i * 3) % 4) for i in range(24)]
json.dump([dict(period=p, out_without_review=100, silent_errors=0, blocked_or_suppressed=n, silent_omissions=y) for p, n, y in rows],
          open(os.path.join(d, "c.json"), "w"))
r = node(["monitor", "--counts", "c.json", "--watch", "silent-omissions", "--target", "20", "--json", "o.json"], d)
o = json.load(open(os.path.join(d, "o.json"), encoding="utf-8"))
compare_series(T, dict(rows=rows, tgt=20, acc=None, ala=None, fae=None, ps=None, since=None), r, o, "watch-counts")
T.show("monitor files")
with open(os.path.join(HERE, "results", "monitor-files.json"), "w") as f:
    json.dump(dict(counts=dict(T.c), agree=dict(T.ok), bad=[(a, str(x)[:400]) for a, x in T.bad]), f, indent=1)
