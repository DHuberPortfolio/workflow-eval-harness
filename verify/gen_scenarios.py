"""Seeded scenario set in the harness's input format (docs/CONFIG.md), built to hit the edges
in the docs: every route class pair, duplicates and suppressed primaries, declines, any_of
slots, equivalents, floors and gates, failed model calls, ordinal near misses, empty values,
small n. usage: python gen_scenarios.py [seed]  (default 20261103). Writes scenarios/<name>/."""
import json
import os
import random
import shutil
import sys

from where import HERE

OUT = os.path.join(HERE, "scenarios")
CONF = [0.30, 0.59, 0.60, 0.61, 0.74, 0.75, 0.79, 0.80, 0.84, 0.85, 0.86, 0.90, 0.95, 1.0]
ROUTES = {"auto": ["PUBLISH", "PUBLISH_NOTE"], "review": ["ASK", "ESCALATE"], "block": ["DENY"], "exclude": ["DUP"]}
ALLMAP = {n: c for c, ns in ROUTES.items() for n in ns}
VOCAB = ["A", "B", "C", "D", "E", "F", "G"]
TOPICS = ["t1", "t2", "t3", "t4", "t5", "t6"]
GROUP = ["A", "A2", "A3"]


def rid(i):
    return "S%04d" % i


NONE_CONF = 0.0  # share of values with no confidence: 0 where a gate would stop strict mode (E1)


def stated(rng, v, conf=None, applied=None, inherited=None, none_conf=None):
    none_conf = NONE_CONF if none_conf is None else none_conf
    o = {"value": v}
    c = rng.choice(CONF) if conf is None else conf
    if rng.random() >= none_conf:
        o["confidence"] = c
    if applied is not None:
        o["applied"] = applied
    if inherited:
        o["inherited_from"] = inherited
    return o


def gen_set(rng, vocab, equiv=False, slots=True, invalid=False, reject_field=False):
    """(prediction list, rejected list, key list) for one record of a set output."""
    k = []
    pred = []
    rej = []
    pool = vocab[:]
    rng.shuffle(pool)
    n = rng.choice([0, 0, 1, 1, 1, 2, 2, 3])
    for v in pool[:n]:
        k.append(v)
    rest = pool[n:]
    if slots and rng.random() < 0.35 and len(rest) >= 1:
        m = rng.choice([1, 2, 3])
        sl = rest[:m]
        rest = rest[m:]
        k.append({"any_of": [rng.choice(GROUP) if equiv and v == "A" else v for v in sl]})
        act = rng.random()
        if act < 0.3:
            pred.append(stated(rng, rng.choice(sl), conf=rng.choice([0.86, 0.9, 0.95])))
        elif act < 0.45 and len(sl) >= 2:  # two from one slot
            pred.append(stated(rng, sl[0], conf=0.9))
            pred.append(stated(rng, sl[1], conf=0.86))
        elif act < 0.7:  # found, set aside
            x = stated(rng, rng.choice(sl), conf=rng.choice([0.5, 0.55, 0.9]), applied=False)
            (rej if reject_field and rng.random() < 0.5 else pred).append(x)
        # else: never found
    for v in k:
        if isinstance(v, dict):
            continue
        a = rng.random()
        w = v
        if equiv and v == "A":
            w = rng.choice(GROUP)
        if a < 0.62:
            pred.append(stated(rng, w))
        elif a < 0.78:
            x = stated(rng, w, conf=rng.choice([0.3, 0.55, 0.59, 0.9]), applied=False)
            (rej if reject_field and rng.random() < 0.5 else pred).append(x)
        elif a < 0.86 and equiv and v == "A":  # both names in one prediction
            b = rng.choice(["A2", "A3"])
            mode = rng.choice(["aa", "ar", "ra", "rr"])
            pred.append(stated(rng, "A", applied=(mode[0] == "a")))
            pred.append(stated(rng, b, applied=(mode[1] == "a")))
        # else never proposed
    if rng.random() < 0.28 and rest:  # a wrong extra value
        x = rest.pop()
        if rng.random() < 0.2:
            pred.append(stated(rng, x, inherited=rng.choice(vocab)))
        else:
            pred.append(stated(rng, x))
    if rng.random() < 0.2 and rest:  # proposed, rightly not applied
        pred.append(stated(rng, rest.pop(), conf=0.5, applied=False))
    if invalid and rng.random() < 0.07:
        pred.append(stated(rng, "ZZZ"))
    if invalid and rng.random() < 0.05 and k and not isinstance(k[0], dict):
        k.append("ZZZ")  # the key itself lists a value outside the list
        if rng.random() < 0.6 and not any(x["value"] == "ZZZ" for x in pred):
            pred.append(stated(rng, "ZZZ"))
    rng.shuffle(pred)
    return pred, rej, k


def pick_routes(rng, i, prim, classes=("auto", "review", "block", "exclude")):
    c = rng.choice(["auto", "auto", "auto"] + list(classes))
    g = rng.choice(["auto", "auto", "auto"] + list(classes))
    return c, g


def base_config(**kw):
    c = {
        "id_field": "id",
        "outputs": {"tags": {"type": "set"}, "topics": {"type": "set"}},
        "routing": {"field": "route", "gold_field": "gold", "map": ALLMAP},
    }
    c.update(kw)
    return c


def duplicates_pass(rng, preds, keys, classes):
    """Give the records the key suppresses a primary; force the interesting pairs."""
    ids = [k["id"] for k in keys]
    for idx, k in enumerate(keys):
        if ROUTE_CLASS[k.get("gold")] == "exclude":
            if idx == 0:
                k["gold"] = "PUBLISH"
                continue
            k["duplicate_of"] = rng.choice(ids[max(0, idx - 12):idx])
            # keep the chain one level deep most of the time
            if rng.random() < 0.8:
                p = next(x for x in keys if x["id"] == k["duplicate_of"])
                if "duplicate_of" in p:
                    k["duplicate_of"] = p["duplicate_of"]


ROUTE_CLASS = dict(ALLMAP)


TAG = random.Random(7)


def write(name, cfg, preds, keys, extra=None):
    # labels that change no judgment: a trap on most scenarios, a channel on all (text, a list or
    # nothing), from a stream of their own so the records stay the same
    cfg = dict(cfg)
    if not name.startswith("small"):
        cfg["trap_field"] = "trap"
    for k in keys:
        a = TAG.random()
        if a < 0.7:
            k["trap"] = TAG.choice(["t-a", "t-b", "t-c"])
        elif a < 0.85:
            k["trap"] = ["t-a", TAG.choice(["t-b", "t-c"])]
        b = TAG.random()
        if b < 0.75:
            k["channel"] = TAG.choice(["chat", "email", "phone"])
        elif b < 0.9:
            k["channel"] = ["chat", "email"]
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    json.dump(cfg, open(os.path.join(d, "config.json"), "w", encoding="utf-8"), indent=1)
    json.dump(preds, open(os.path.join(d, "pred.json"), "w", encoding="utf-8"), indent=0)
    json.dump(keys, open(os.path.join(d, "key.json"), "w", encoding="utf-8"), indent=0)
    for fn, obj in (extra or {}).items():
        json.dump(obj, open(os.path.join(d, fn), "w", encoding="utf-8"), indent=0)


def sets_family(rng, n, cfg, equiv=False, slots=True, invalid=False, reject_field=False, failed=0.05, classes=None,
                thr_field=None, gold=True):
    classes = classes or ("auto", "review", "block", "exclude")
    preds, keys = [], []
    for i in range(n):
        r = rid(i + 1)
        rc, gc = pick_routes(rng, i, None, classes)
        p = {"id": r, "route": rng.choice(ROUTES[rc])}
        k = {"id": r}
        if gold:
            k["gold"] = rng.choice(ROUTES[gc])
        tp, tr, tk = gen_set(rng, VOCAB, equiv=equiv, slots=slots, invalid=invalid, reject_field=reject_field)
        p["tags"] = tp
        k["tags"] = tk
        if tr:
            p["tags_rejected"] = tr
        p2, r2, k2 = gen_set(rng, TOPICS, slots=False)
        p["topics"] = p2 + r2
        k["topics"] = k2
        if rng.random() < failed:
            p["scored"] = False
        elif rng.random() < 0.05:
            p["scored"] = True
        if thr_field:
            p[thr_field] = rng.choice([0.7, 0.75, 0.8, 0.85, 0.9, "0.8", "0.9"])
        preds.append(p)
        keys.append(k)
    return preds, keys


def label_family(rng, n, gold=True, ordinal=False, steps=None, decline=False, route_is_label=False, conf_share=0.8):
    labels = ["red", "green", "blue", "grey"] if not ordinal else [1, 2, 3, 4, 5, 6]
    preds, keys = [], []
    for i in range(n):
        r = rid(i + 1)
        rc, gc = pick_routes(rng, i, None, ("auto", "review", "block", "exclude"))
        p = {"id": r, "route": rng.choice(ROUTES[rc])}
        k = {"id": r}
        if gold:
            k["gold"] = rng.choice(ROUTES[gc])
        kl = rng.choice(labels)
        if ordinal:
            d = rng.choice([0, 0, 0, 1, -1, 1, -1, 2, -2, 3, -4])
            ix = max(0, min(len(labels) - 1, labels.index(kl) + d))
            pl = labels[ix]
        else:
            pl = kl if rng.random() < 0.65 else rng.choice(labels)
        p["kind"] = str(pl) if ordinal and rng.random() < 0.2 else pl
        k["kind"] = str(kl) if ordinal and rng.random() < 0.2 else kl
        if rng.random() < conf_share:
            p["kind_conf"] = rng.choice(CONF)
        if decline:
            a = rng.random()
            if a < 0.2:
                p["kind"] = "unsure"
                p.pop("kind_conf", None)
            elif a < 0.3:
                p["declined"] = True
                if rng.random() < 0.5:
                    p.pop("kind")
            elif a < 0.35:
                p["declined"] = False
            if rng.random() < 0.25:
                k["kind"] = rng.choice(["unsure", "none"])
        if rng.random() < 0.04:
            p["scored"] = False
        preds.append(p)
        keys.append(k)
    return preds, keys


def main(seed):
    global NONE_CONF
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    rng = random.Random(seed)
    allowed = {"tags": VOCAB + ["A2"], "topics": TOPICS}

    # 1 either, gold route, every feature on, lead gate
    c = base_config(thresholds={"floor": 0.6, "auto_publish": {"tags": 0.85}}, duplicate_of_field="duplicate_of",
                    allowed_values={"tags": VOCAB + ["A2", "A3"]}, equivalents={"tags": [GROUP]})
    c["outputs"]["tags"]["rejected_field"] = "tags_rejected"
    p, k = sets_family(rng, 420, c, equiv=True, invalid=True, reject_field=True)
    duplicates_pass(rng, p, k, None)
    write("either_all", c, p, k)

    NONE_CONF = 0.05
    p, k = sets_family(rng, 240, c, equiv=True, invalid=True, reject_field=True)
    duplicates_pass(rng, p, k, None)
    write("either_all__lenient", c, p, k)
    NONE_CONF = 0.0

    # 2 gold_route: values are reasons
    c = base_config(wrong_when="gold_route", duplicate_of_field="duplicate_of", thresholds={"floor": 0.6, "auto_publish": {"tags": 0.8}, "gate_uses": "weakest"},
                    equivalents={"tags": [GROUP]})
    p, k = sets_family(rng, 300, c, equiv=True)
    duplicates_pass(rng, p, k, None)
    write("gold_route_weakest", c, p, k)

    # 3 any_mismatch given outright, with a gold route
    c = base_config(wrong_when="any_mismatch", duplicate_of_field="duplicate_of")
    p, k = sets_family(rng, 250, c)
    duplicates_pass(rng, p, k, None)
    write("any_mismatch_gold", c, p, k)

    # 4 no gold route at all, duplicate_of_field given
    c = base_config(duplicate_of_field="duplicate_of", thresholds={"auto_publish": {"tags": 0.75, "topics": 0.6}})
    del c["routing"]["gold_field"]
    p, k = sets_family(rng, 220, c, gold=False)
    for idx, x in enumerate(k):
        if idx and rng.random() < 0.15:
            x["duplicate_of"] = k[rng.randrange(0, idx)]["id"]
    write("no_gold_dups", c, p, k)

    # 5 label with declines (values and field), gold route, label gate and floor
    c = {"outputs": {"kind": {"type": "label", "labels": ["red", "green", "blue", "grey"], "confidence_field": "kind_conf",
                              "decline": {"values": ["unsure", "none"], "field": "declined"}}},
         "routing": {"field": "route", "gold_field": "gold", "map": ALLMAP},
         "thresholds": {"floor": 0.6, "auto_publish": {"kind": 0.8}}}
    p, k = label_family(rng, 280, decline=True, conf_share=1.0)
    write("label_decline_gold", c, p, k)
    p, k = label_family(rng, 200, decline=True, conf_share=0.8)
    write("label_decline_gold__lenient", c, p, k)

    # 6 label with declines, no gold route
    c = {"outputs": {"kind": {"type": "label", "labels": ["red", "green", "blue", "grey"], "confidence_field": "kind_conf",
                              "decline": {"values": ["unsure", "none"]}}},
         "routing": {"field": "route", "map": ALLMAP}}
    p, k = label_family(rng, 200, gold=False, decline=True)
    for x in p:
        x.pop("declined", None)
        if "kind" not in x:
            x["kind"] = "unsure"
    write("label_decline_nogold", c, p, k)

    # 7 decline.field only: the key cannot say decline
    c = {"outputs": {"kind": {"type": "label", "labels": ["red", "green", "blue", "grey"], "decline": {"field": "declined"}}},
         "routing": {"field": "route", "gold_field": "gold", "map": ALLMAP}}
    p, k = label_family(rng, 150, decline=True)
    for x in p:
        if x.get("kind") == "unsure":
            x["kind"] = "red"
    for x in k:
        if x.get("kind") in ("unsure", "none"):
            x["kind"] = "blue"
    write("label_declinefield_only", c, p, k)

    # 7b declines under each wrong_when
    for ww in ("gold_route", "any_mismatch"):
        c = {"outputs": {"kind": {"type": "label", "labels": ["red", "green", "blue", "grey"], "confidence_field": "kind_conf",
                                  "decline": {"values": ["unsure", "none"], "field": "declined"}}},
             "routing": {"field": "route", "gold_field": "gold", "map": ALLMAP}, "wrong_when": ww}
        p, k = label_family(rng, 160, decline=True)
        write("label_decline_" + ww, c, p, k)

    # 7c every type of output at once
    c = {"outputs": {"tags": {"type": "set"}, "kind": {"type": "label", "labels": ["red", "green", "blue", "grey"],
                                                        "confidence_field": "kind_conf",
                                                        "decline": {"values": ["unsure"], "field": "declined"}},
                     "band": {"type": "ordinal", "labels": ["low", "mid", "high", "top"], "near_miss_steps": 1}},
         "routing": {"field": "route", "gold_field": "gold", "map": ALLMAP},
         "thresholds": {"auto_publish": {"tags": 0.8, "kind": 0.7}}}
    p, k = label_family(rng, 240, decline=True, conf_share=1.0)
    for x, y in zip(p, k):
        tp, tr, tk = gen_set(rng, VOCAB)
        x["tags"], y["tags"] = tp, tk
        kb = rng.choice(["low", "mid", "high", "top"])
        y["band"] = kb
        x["band"] = rng.choice(["low", "mid", "high", "top", kb, kb])
        if y.get("kind") == "none":
            y["kind"] = "unsure"
    write("mixed_outputs", c, p, k)

    # 7d a value applied and also listed in rejected_field; rejected copies of an alias
    c = {"outputs": {"tags": {"type": "set", "rejected_field": "rej"}}, "equivalents": {"tags": [["A", "A2"]]},
         "routing": {"field": "route", "gold_field": "gold", "map": ALLMAP}}
    write("rejected_field_edges__lenient", c,
          [{"id": "R1", "route": "PUBLISH", "tags": ["A"], "rej": ["A"]},
           {"id": "R2", "route": "PUBLISH", "tags": ["B"], "rej": ["B"]}],
          [{"id": "R1", "gold": "PUBLISH", "tags": ["A"]}, {"id": "R2", "gold": "PUBLISH", "tags": ["A"]}])
    write("rejected_field_edges", c,
          [{"id": "R2", "route": "PUBLISH", "tags": ["A"], "rej": ["A2"]},
           {"id": "R3", "route": "PUBLISH", "tags": [], "rej": ["A2"]},
           {"id": "R4", "route": "PUBLISH", "tags": ["B"], "rej": ["A", "A2"]},
           {"id": "R5", "route": "ASK", "rej": ["A"]},
           {"id": "R6", "route": "PUBLISH", "tags": ["C"], "rej": []}],
          [{"id": x, "gold": "PUBLISH", "tags": ["A"]} for x in ("R2", "R3", "R4", "R5", "R6")])

    # 8-10 ordinal, near_miss_steps default, 0 and 2
    for nm, st in (("ordinal_default", None), ("ordinal_zero", 0), ("ordinal_two", 2)):
        o = {"type": "ordinal", "labels": [1, 2, 3, 4, 5, 6]}
        if st is not None:
            o["near_miss_steps"] = st
        c = {"outputs": {"kind": o}, "routing": {"field": "route", "gold_field": "gold", "map": ALLMAP}}
        p, k = label_family(rng, 120, ordinal=True)
        write(nm, c, p, k)

    # 11 each record's own threshold, severity overrides
    c = base_config(thresholds={"floor": 0.55, "auto_publish": {"tags": "client_threshold"}},
                    severity={"SP-DUPLICATE": "high", "SP-MISSING": "low", "SO-FALSE-BLOCK": "critical"},
                    duplicate_of_field="duplicate_of")
    p, k = sets_family(rng, 200, c, thr_field="client_threshold")
    duplicates_pass(rng, p, k, None)
    write("own_threshold_severity", c, p, k)

    # 12 the verdict label is also the route
    c = {"outputs": {"verdict": {"type": "label", "labels": ["pass", "elevate", "fail"], "key_field": "gold_verdict",
                                 "confidence_field": "conf"},
                     "codes": {"type": "set"}},
         "routing": {"field": "verdict", "gold_field": "gold_verdict",
                     "map": {"pass": "auto", "elevate": "review", "fail": "block"}},
         "wrong_when": "gold_route", "thresholds": {"auto_publish": {"verdict": 0.85}}}
    preds, keys = [], []
    for i in range(160):
        r = rid(i + 1)
        v = rng.choice(["pass", "pass", "elevate", "fail"])
        g = rng.choice(["pass", "pass", "elevate", "fail"])
        tp, tr, tk = gen_set(rng, VOCAB, slots=False)
        preds.append({"id": r, "verdict": v, "conf": rng.choice(CONF), "codes": tp})
        keys.append({"id": r, "gold_verdict": g, "codes": tk})
    write("verdict_is_route", c, preds, keys)

    # 13 only route classes auto and review, no gold-free extras, equivalents in a label
    c = {"outputs": {"kind": {"type": "label", "labels": ["red", "green", "blue", "grey"]}},
         "equivalents": {"kind": [["red", "crimson", "scarlet"]]},
         "routing": {"field": "route", "gold_field": "gold", "map": {"PUBLISH": "auto", "ASK": "review"}}}
    preds, keys = [], []
    for i in range(90):
        r = rid(i + 1)
        kl = rng.choice(["red", "crimson", "green", "blue", "grey"])
        pl = rng.choice(["red", "crimson", "scarlet", kl, "  " + kl + " "])
        preds.append({"id": r, "route": rng.choice(["PUBLISH", "ASK"]), "kind": pl})
        keys.append({"id": r, "gold": rng.choice(["PUBLISH", "ASK"]), "kind": kl})
    write("label_equivalents", c, preds, keys)

    # 14 explicit grid: every (route class, gold class) with right and wrong values, each with
    # and without a duplicate_of link and with primary suppressed or kept
    c = base_config(duplicate_of_field="duplicate_of")
    preds, keys = [], []
    i = 0
    for pr in ("auto", "review", "block", "exclude"):
        for dr in ("auto", "review", "block", "exclude"):
            for gp in ("auto", "review"):
                for good in (True, False):
                    i += 1
                    P = "G%03d" % i
                    i += 1
                    Q = "G%03d" % i
                    preds.append({"id": P, "route": ROUTES[pr][0], "tags": [stated(rng, "A", conf=0.9, none_conf=0)], "topics": []})
                    keys.append({"id": P, "gold": ROUTES[gp][0], "tags": ["A"], "topics": []})
                    preds.append({"id": Q, "route": ROUTES[dr][0],
                                  "tags": [stated(rng, "A" if good else "B", conf=0.9, none_conf=0)], "topics": []})
                    keys.append({"id": Q, "gold": ROUTES["exclude"][0], "tags": ["A"], "topics": [], "duplicate_of": P})
    write("duplicate_grid", c, preds, keys)

    # 15 two kept duplicates of a suppressed primary, chains
    c = base_config(duplicate_of_field="duplicate_of")
    preds = [{"id": "P1", "route": "DUP", "tags": ["A"], "topics": []},
             {"id": "D1", "route": "PUBLISH", "tags": ["A"], "topics": []},
             {"id": "D2", "route": "ASK", "tags": ["A"], "topics": []},
             {"id": "P2", "route": "DUP", "tags": ["B"], "topics": []},
             {"id": "D3", "route": "ASK", "tags": ["B"], "topics": []},
             {"id": "P3", "route": "DUP", "tags": ["C"], "topics": []},
             {"id": "D4", "route": "DENY", "tags": ["C"], "topics": []},
             {"id": "P4", "route": "PUBLISH", "tags": ["C"], "topics": []},
             {"id": "D5", "route": "DUP", "tags": ["C"], "topics": []},
             {"id": "D6", "route": "PUBLISH", "tags": ["C"], "topics": []}]
    keys = [{"id": "P1", "gold": "PUBLISH", "tags": ["A"], "topics": []},
            {"id": "D1", "gold": "DUP", "tags": ["A"], "topics": [], "duplicate_of": "P1"},
            {"id": "D2", "gold": "DUP", "tags": ["A"], "topics": [], "duplicate_of": "P1"},
            {"id": "P2", "gold": "ASK", "tags": ["B"], "topics": []},
            {"id": "D3", "gold": "DUP", "tags": ["B"], "topics": [], "duplicate_of": "P2"},
            {"id": "P3", "gold": "PUBLISH", "tags": ["C"], "topics": []},
            {"id": "D4", "gold": "DUP", "tags": ["C"], "topics": [], "duplicate_of": "P3"},
            {"id": "P4", "gold": "PUBLISH", "tags": ["C"], "topics": []},
            {"id": "D5", "gold": "DUP", "tags": ["C"], "topics": [], "duplicate_of": "P4"},
            {"id": "D6", "gold": "DUP", "tags": ["C"], "topics": [], "duplicate_of": "D5"}]
    write("primary_cases", c, preds, keys)

    # 16 gate edges, by hand: at the threshold, just under, empty, no confidence, weakest,
    # merged equivalents (the CONFIG example ep-12 at 0.4 beside ep-12-rerun set aside at 0.9)
    for gate_uses in ("lead", "weakest"):
        c = {"outputs": {"cites": {"type": "set"}}, "equivalents": {"cites": [["e12", "e12r"]]},
             "routing": {"field": "route", "gold_field": "gold", "map": {"PUBLISH": "auto", "ASK": "review"}},
             "thresholds": {"floor": 0.6, "auto_publish": {"cites": 0.8}, "gate_uses": gate_uses}}
        rows = [
            [{"value": "x", "confidence": 0.8}],
            [{"value": "x", "confidence": 0.7999}],
            [{"value": "x", "confidence": 0.6}],
            [{"value": "x", "confidence": 0.5999}],
            [],
            [{"value": "x", "applied": False, "confidence": 0.95}],
            [{"value": "x", "confidence": 0.9}, {"value": "y", "confidence": 0.7}],
            [{"value": "x", "confidence": 0.9}, {"value": "y", "confidence": 0.5}],
            [{"value": "e12", "confidence": 0.4}, {"value": "e12r", "confidence": 0.9, "applied": False}],
            [{"value": "e12", "confidence": 0.4}, {"value": "e12r", "confidence": 0.9}],
            [{"value": "e12", "confidence": 0.9}, {"value": "e12r", "confidence": 0.7}],
            [{"value": "e12", "applied": False, "confidence": 0.4}, {"value": "e12r", "applied": False, "confidence": 0.9}],
            [{"value": "x", "confidence": 0.9, "inherited_from": "y"}, {"value": "y", "confidence": 0.5, "inherited_from": "x"}],
        ]
        rows_nc = [
            [{"value": "x"}],
            [{"value": "x", "confidence": None}],
            [{"value": "x"}, {"value": "y", "confidence": 0.9}],
            [{"value": "x", "confidence": 0.5}, {"value": "y"}],
            [{"value": "x", "confidence": 0.9}, {"value": "y"}],
            ["x"],
        ]
        for tag, rr_rows in (("", rows), ("__lenient", rows_nc)):
            preds, keys = [], []
            for i, row in enumerate(rr_rows):
                for rr in ("PUBLISH", "ASK"):
                    r = "E%02d%s" % (i, rr[0])
                    preds.append({"id": r, "route": rr, "cites": row})
                    keys.append({"id": r, "gold": "PUBLISH", "cites": ["x"]})
            write("gate_edges_" + gate_uses + tag, c, preds, keys)

    # 17 empty and odd values
    c = base_config(equivalents={"tags": [["A", "A2"]]})
    preds = [
        {"id": "Z1", "route": "PUBLISH", "tags": [], "topics": []},
        {"id": "Z2", "route": "PUBLISH", "tags": [{"value": " A ", "confidence": 0.9}], "topics": []},
        {"id": "Z3", "route": "PUBLISH", "tags": ["A2"], "topics": []},
        {"id": "Z4", "route": "PUBLISH", "tags": ["A", "A2"], "topics": []},
        {"id": "Z5", "route": "ASK", "tags": [], "topics": []},
        {"id": "Z6", "route": "DENY", "tags": [], "topics": []},
        {"id": "Z7", "route": "DUP", "tags": [], "topics": []},
        {"id": "Z8", "route": "PUBLISH", "topics": []},
        {"id": "Z9", "route": "PUBLISH", "tags": None, "topics": []},
        {"id": 10, "route": "PUBLISH", "tags": ["1", "2.5"], "topics": []},
    ]
    keys = [
        {"id": "Z1", "gold": "PUBLISH", "tags": [], "topics": []},
        {"id": "Z2", "gold": "PUBLISH", "tags": ["A"], "topics": []},
        {"id": "Z3", "gold": "PUBLISH", "tags": [" A "], "topics": []},
        {"id": "Z4", "gold": "PUBLISH", "tags": ["A2"], "topics": []},
        {"id": "Z5", "gold": "PUBLISH", "tags": [], "topics": []},
        {"id": "Z6", "gold": "PUBLISH", "tags": [], "topics": []},
        {"id": "Z7", "gold": "PUBLISH", "tags": [], "topics": []},
        {"id": "Z8", "gold": "PUBLISH", "tags": ["A"], "topics": []},
        {"id": "Z9", "gold": "PUBLISH", "tags": [], "topics": []},
        {"id": 10, "gold": "PUBLISH", "tags": ["1", "2.5"], "topics": []},
    ]
    write("empty_values", c, preds, keys)

    # 18 small n: one record per (route class, gold class), no record of a class at all
    k1 = 0
    for pr in ("auto", "review", "block", "exclude"):
        for gr in ("auto", "review", "block", "exclude"):
            k1 += 1
            c = base_config()
            right = k1 % 2 == 0
            write("small_%s_%s" % (pr, gr), c,
                  [{"id": "M1", "route": ROUTES[pr][0], "tags": ["A" if right else "B"], "topics": []}],
                  [{"id": "M1", "gold": ROUTES[gr][0], "tags": ["A"], "topics": []}])
    c = base_config()
    write("small_none_out", c,
          [{"id": "N1", "route": "ASK", "tags": ["A"], "topics": []}, {"id": "N2", "route": "DENY", "tags": [], "topics": []}],
          [{"id": "N1", "gold": "PUBLISH", "tags": ["A"], "topics": []}, {"id": "N2", "gold": "ASK", "tags": [], "topics": []}])
    write("small_all_excluded", c,
          [{"id": "N1", "route": "DUP", "tags": ["A"], "topics": []}, {"id": "N2", "route": "DUP", "tags": [], "topics": []}],
          [{"id": "N1", "gold": "DUP", "tags": ["A"], "topics": []}, {"id": "N2", "gold": "DUP", "tags": [], "topics": []}])
    c = base_config()
    write("small_all_failed", c,
          [{"id": "N1", "route": "PUBLISH", "tags": ["B"], "topics": [], "scored": False},
           {"id": "N2", "route": "ASK", "tags": ["B"], "topics": [], "scored": False}],
          [{"id": "N1", "gold": "PUBLISH", "tags": ["A"], "topics": []}, {"id": "N2", "gold": "PUBLISH", "tags": ["A"], "topics": []}])

    # 19 CSV, with its own separators, an any_of column, a rejected column, a text threshold
    c = {"input": {"predictions": {"delimiter": ";", "list_separator": "+", "confidence_separator": "#"},
                   "key": {"delimiter": ";", "list_separator": "+", "any_of_separator": "/", "any_of_outputs": ["cites"]}},
         "outputs": {"cites": {"type": "set", "rejected_field": "cites_set_aside"}, "tags": {"type": "set"},
                     "kind": {"type": "label", "labels": ["red", "green"], "confidence_field": "conf"}},
         "routing": {"field": "route", "gold_field": "gold", "map": {"OUT": "auto", "ASK": "review", "NO": "block"}},
         "thresholds": {"floor": 0.6, "auto_publish": {"cites": "thr"}}}
    prow = ["id;route;cites;cites_set_aside;tags;kind;conf;thr;scored"]
    krow = ["id;gold;cites;tags;kind"]
    for i in range(1, 121):
        r = "C%03d" % i
        pool = ["e1", "e2", "e3", "e4"]
        rng.shuffle(pool)
        slot = "/".join(pool[:2])
        plain = pool[2]
        krow.append("%s;%s;%s;%s;%s" % (r, rng.choice(["OUT", "OUT", "ASK", "NO"]), rng.choice([plain, plain + "+" + slot, slot]),
                                         rng.choice(["TCP/IP", "x", "x+TCP/IP", ""]), rng.choice(["red", "green"])))
        cites = "+".join("%s#%s" % (v, rng.choice(["0.5", "0.6", "0.7", "0.85", "0.9"])) for v in rng.sample(pool, rng.choice([1, 1, 2, 3])))
        aside = rng.choice(["", "", pool[3] + "#0.4"])
        if aside and pool[3] in cites:
            aside = ""
        prow.append("%s;%s;%s;%s;%s;%s;%s;%s;%s" % (r, rng.choice(["OUT", "OUT", "OUT", "ASK", "NO"]), cites, aside, rng.choice(["TCP/IP", "x", "x+y", ""]),
                                                    rng.choice(["red", "green"]), rng.choice(["0.5", "0.9"]), rng.choice(["0.8", "0.85"]),
                                                    rng.choice(["", "", "true", "false"])))
    d = os.path.join(OUT, "csv_separators")
    os.makedirs(d, exist_ok=True)
    json.dump(c, open(os.path.join(d, "config.json"), "w"), indent=1)
    open(os.path.join(d, "pred.csv"), "w", encoding="utf-8").write("\n".join(prow) + "\n")
    open(os.path.join(d, "key.csv"), "w", encoding="utf-8").write("\n".join(krow) + "\n")

    # 20 a field literally named with a dot is used first
    c = {"outputs": {"tags": {"type": "set", "field": "output.tags", "key_field": "expected.tags"}},
         "routing": {"field": "meta.route", "gold_field": "expected.route", "map": {"OUT": "auto", "ASK": "review"}}}
    write("literal_dots", c,
          [{"id": "L1", "output.tags": ["A"], "output": {"tags": ["B"]}, "meta.route": "OUT", "meta": {"route": "ASK"}},
           {"id": "L2", "output": {"tags": ["A"]}, "meta": {"route": "OUT"}},
           {"id": "L3", "output.tags": ["B"], "output": {"tags": ["A"]}, "meta.route": "ASK", "meta": {"route": "OUT"}}],
          [{"id": "L1", "expected.tags": ["A"], "expected": {"tags": ["B"], "route": "ASK"}, "expected.route": "OUT"},
           {"id": "L2", "expected": {"tags": ["A"], "route": "OUT"}},
           {"id": "L3", "expected.tags": ["B"], "expected": {"tags": ["A"], "route": "OUT"}, "expected.route": "ASK"}])

    # 21 aliases in allowed_values, and allowed_values on a label
    c = base_config(equivalents={"tags": [["A", "A2"]]}, allowed_values={"tags": ["A2", "B", "C"]})
    write("allowed_alias", c,
          [{"id": "V1", "route": "PUBLISH", "tags": ["A"], "topics": []}, {"id": "V2", "route": "PUBLISH", "tags": ["A2"], "topics": []},
           {"id": "V3", "route": "PUBLISH", "tags": ["D"], "topics": []}, {"id": "V4", "route": "ASK", "tags": ["D"], "topics": []}],
          [{"id": "V1", "gold": "PUBLISH", "tags": ["A"], "topics": []}, {"id": "V2", "gold": "PUBLISH", "tags": ["A"], "topics": []},
           {"id": "V3", "gold": "PUBLISH", "tags": ["A"], "topics": []}, {"id": "V4", "gold": "PUBLISH", "tags": ["D"], "topics": []}])
    c = {"outputs": {"kind": {"type": "label", "labels": ["red", "green", "blue"]}},
         "routing": {"field": "route", "gold_field": "gold", "map": {"PUBLISH": "auto", "ASK": "review"}},
         "allowed_values": {"kind": ["red", "green"]}}
    write("label_allowed", c,
          [{"id": "K1", "route": "PUBLISH", "kind": "blue"}, {"id": "K2", "route": "PUBLISH", "kind": "red"}, {"id": "K3", "route": "ASK", "kind": "blue"}],
          [{"id": "K1", "gold": "PUBLISH", "kind": "blue"}, {"id": "K2", "gold": "PUBLISH", "kind": "red"}, {"id": "K3", "gold": "PUBLISH", "kind": "red"}])

    # 22 an alias of a decline value
    c = {"outputs": {"kind": {"type": "label", "labels": ["red", "green"], "decline": {"values": ["unsure"]}}},
         "equivalents": {"kind": [["unsure", "idk", "n/a"], ["red", "rouge"]]},
         "routing": {"field": "route", "gold_field": "gold", "map": ALLMAP}}
    preds, keys = [], []
    for i in range(60):
        r = "Q%03d" % i
        preds.append({"id": r, "route": rng.choice(["PUBLISH", "ASK", "DENY"]), "kind": rng.choice(["idk", "n/a", "unsure", "rouge", "red", "green"])})
        keys.append({"id": r, "gold": rng.choice(["PUBLISH", "ASK", "DENY"]), "kind": rng.choice(["idk", "unsure", "rouge", "green"])})
    write("decline_alias", c, preds, keys)


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 20261103)
