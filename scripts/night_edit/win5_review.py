"""Overlay sheets of win5.py's windows for review (2026-11-22). python -I win5_review.py <w5 dir> <out dir> [per_sheet] <name> ...
(--all for every exterior picture). Each picture at 960 x 540: every window's glass outlined, yellow = navy (opaque), green =
see (a room shows), cyan = pale (curtain / frosted), with its id; the glass itself tinted faintly; the annotation's lamps as
magenta rings, Grounding DINO's lamp boxes as thin magenta boxes, the annotation's ports as orange rings."""
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
G = os.path.normpath(os.path.join(HERE, "..", "..", "public", "images", "animations", "locations", "britannic"))
COL = {"navy": (0, 255, 255), "see": (0, 255, 0), "pale": (255, 255, 0)}
wd, od = sys.argv[1], sys.argv[2]
a = sys.argv[3:]
per = 6
if a and a[0].isdigit():
    per, a = int(a[0]), a[1:]
if a == ["--all"]:
    a = [os.path.splitext(l.rstrip("\n").split("\t")[1])[0] for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
os.makedirs(od, exist_ok=True)


def tile(n):
    im = cv2.imread(os.path.join(G, n + ".png"))
    H, W = im.shape[:2]
    mp_ = os.path.join(HERE, "work", os.environ.get("W6_MATTE", "auto_night"), "dbg", n + ".mask.png")
    if os.path.exists(mp_) and not os.environ.get("NO_MATTE"):      # the matte's outside: tinted magenta
        o_ = cv2.imread(mp_, cv2.IMREAD_UNCHANGED) > 127
        im[o_] = (0.62 * im[o_] + 0.38 * np.array([255, 0, 255])).astype(np.uint8)
    p = os.path.join(wd, n + ".w5.npz")
    cnt = ""
    if os.path.exists(p):
        z = np.load(p)
        inst, al = z["inst"], z["alpha"].astype(np.float32) / 255
        meta = json.load(open(os.path.join(wd, n + ".w5.json")))
        for m in meta["windows"]:
            c = COL.get(m["cls"], (0, 0, 255))
            g = (inst == m["id"]) & (al > 0.5)
            im[g] = (0.72 * im[g] + 0.28 * np.array(c)).astype(np.uint8)
            cs, _ = cv2.findContours(g.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(im, cs, -1, c, 2)
        for b in meta["lamps"]:
            cv2.rectangle(im, (int(b[0]), int(b[1])), (int(b[2]), int(b[3])), (255, 0, 255), 1)
        cnt = " %dw" % len(meta["windows"])
    ap = os.path.join(HERE, "ann", n + ".json")
    if os.path.exists(ap):
        j = json.load(open(ap, encoding="utf-8"))
        for key_ in ("zones", "zones_fine", "lit"):          # the annotation's window zones: thin white; none found in it: red
            for q in j.get(key_) or []:
                if len(q) == 4 and not isinstance(q[0], (list, tuple)):
                    e_ = os.path.exists(p) and not (inst[max(0, int(q[1])):int(q[3]), max(0, int(q[0])):int(q[2])] > 0).any()
                    cv2.rectangle(im, (int(q[0]), int(q[1])), (int(q[2]), int(q[3])), (0, 0, 255) if e_ else (255, 255, 255), 3 if e_ else 1)
        for q in j.get("interior") or []:                    # doorway interiors: orange outline
            if len(q) >= 3 and isinstance(q[0], (list, tuple)):
                cv2.polylines(im, [np.array(q, np.int32)], True, (0, 140, 255), 2)
        for L in j.get("lamps", []):
            cv2.circle(im, (int(L["p"][0]), int(L["p"][1])), 16, (255, 0, 255), 3)
        for P in j.get("ports", []):
            c = P.get("c")
            if c:
                cv2.ellipse(im, (int(c[0]), int(c[1])), (int(max(c[2], 3)) + 4, int(max(c[3], 3)) + 4), float(c[4]) if len(c) > 4 else 0.0, 0, 360, (0, 140, 255), 2)
    im = cv2.resize(im, (960, 540), interpolation=cv2.INTER_AREA)
    if os.path.exists(p):
        for m in meta["windows"]:
            x, y = int(m["box"][0] / 2), int(m["box"][1] / 2) - 3
            cv2.putText(im, str(m["id"]), (x, max(10, y)), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 0), 3)
            cv2.putText(im, str(m["id"]), (x, max(10, y)), cv2.FONT_HERSHEY_SIMPLEX, 0.42, COL.get(m["cls"], (0, 0, 255)), 1)
    cv2.putText(im, n + cnt, (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 3)
    cv2.putText(im, n + cnt, (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
    return im


for k in range(0, len(a), per):
    part = [tile(n) for n in a[k:k + per]]
    while len(part) % 2:
        part.append(np.full((540, 960, 3), 255, np.uint8))
    rows = [np.concatenate(part[i:i + 2], axis=1) for i in range(0, len(part), 2)]
    o = os.path.join(od, "w5_%02d.jpg" % (k // per + 1))
    cv2.imwrite(o, np.concatenate(rows, axis=0), [cv2.IMWRITE_JPEG_QUALITY, 88])
    print("SHEET", o, len(a[k:k + per]))
