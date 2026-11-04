"""Compare harness and oracle on the generated scenario set. usage: python compare_generated.py [--lenient] [name=value ...]"""
import json, os, sys
import compare_runs as cr
HERE = cr.HERE
def has_channel(folder, ext):
    """Whether a scenario's key has the group field: asking for a field no record has is a stop."""
    with open(os.path.join(folder, "key." + ext), encoding="utf-8") as f:
        return "channel" in f.read()
def cases(lenient):
    d = os.path.join(HERE, "scenarios")
    out = []
    for n in sorted(os.listdir(d)):
        rel = os.path.join("scenarios", n)
        ext = "csv" if os.path.exists(os.path.join(d, n, "pred.csv")) else "json"
        group = has_channel(os.path.join(d, n), ext)
        out.append(dict(name=n, config=rel+"/config.json", pred=rel+"/pred."+ext, key=rel+"/key."+ext, cwd=HERE,
                        group_by="channel" if group else None,
                        extra=(["--lenient"] if (lenient or n.endswith("__lenient")) else []) + (["--group-by", "channel"] if group else [])))
    return out
if __name__ == "__main__":
    lenient = "--lenient" in sys.argv
    readings = {}
    for a in sys.argv[1:]:
        if "=" in a:
            k, v = a.split("=")
            readings[k] = json.loads(v)
    cmp = cr.Cmp(); stops = []
    for c in cases(lenient):
        stops.append(cr.run_case(cmp, c, readings))
    cr.report(cmp, stops, "generated" + (" lenient" if lenient else ""))
    print("records judged:", sum(s.get("records", 0) for s in stops))
    with open(os.path.join(HERE, "results", "generated%s.json" % ("-lenient" if lenient else "")), "w", encoding="utf-8") as f:
        json.dump(dict(values=dict(cmp.values), agree=dict(cmp.agree), diffs=cmp.diffs, cases=stops), f, indent=1, default=str)
