"""Crops with a coordinate grid, for reading window boxes off the day picture (2026-11-22).
python -I grid.py <out.jpg> "<name>:x0,y0,x1,y1[:k]" ...   (k: zoom, default 2; found windows of work/win6 outlined thin;
env NO_OV=1: no outlines; W5_DIR: another windows folder)"""
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = os.path.normpath(os.path.join(HERE, "..", "..", "public", "images", "animations", "locations", "britannic"))
WD = os.path.join(HERE, "work", os.environ.get("W5_DIR", "win6"))
COL = {"navy": (0, 255, 255), "see": (0, 255, 0), "pale": (255, 255, 0)}
tiles = []
for a in sys.argv[2:]:
    parts = a.split(":")
    n = parts[0]
    x0, y0, x1, y1 = [int(v) for v in parts[1].split(",")]
    k = float(parts[2]) if len(parts) > 2 else 2.0
    im = cv2.imread(os.path.join(G, n + ".png"))
    H, W = im.shape[:2]
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
    p = os.path.join(WD, n + ".w5.npz")
    ov = im.copy()
    mp_ = os.path.join(HERE, "work", "auto_night", "dbg", n + ".mask.png")
    if os.environ.get("MATTE") and os.path.exists(mp_):      # MATTE=1: the matte's outside tinted magenta
        o_ = cv2.imread(mp_, cv2.IMREAD_UNCHANGED) > 127
        ov[o_] = (0.55 * ov[o_] + 0.45 * np.array([255, 0, 255])).astype(np.uint8)
    if os.path.exists(p) and not os.environ.get("NO_OV"):
        z = np.load(p)
        meta = json.load(open(p[:-4] + ".json"))
        for m in meta["windows"]:
            g = ((z["inst"] == m["id"]) & (z["alpha"] > 127)).astype(np.uint8)
            cs, _ = cv2.findContours(g, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            cv2.drawContours(ov, cs, -1, COL.get(m["cls"], (0, 0, 255)), 1)
    c = cv2.resize(ov[y0:y1, x0:x1], None, fx=k, fy=k, interpolation=cv2.INTER_NEAREST if k >= 2 else cv2.INTER_CUBIC)
    step = 20 if (x1 - x0) <= 400 else 50 if (x1 - x0) <= 1000 else 100
    for gx in range((x0 // step + 1) * step, x1, step):
        X = int((gx - x0) * k)
        cv2.line(c, (X, 0), (X, c.shape[0] - 1), (255, 255, 255), 1)
        cv2.putText(c, str(gx), (X + 2, 11), cv2.FONT_HERSHEY_SIMPLEX, 0.36, (0, 0, 0), 2)
        cv2.putText(c, str(gx), (X + 2, 11), cv2.FONT_HERSHEY_SIMPLEX, 0.36, (255, 255, 255), 1)
    for gy in range((y0 // step + 1) * step, y1, step):
        Yp = int((gy - y0) * k)
        cv2.line(c, (0, Yp), (c.shape[1] - 1, Yp), (255, 255, 255), 1)
        cv2.putText(c, str(gy), (2, Yp - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.36, (0, 0, 0), 2)
        cv2.putText(c, str(gy), (2, Yp - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.36, (255, 255, 255), 1)
    cv2.putText(c, n, (40, c.shape[0] - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 3)
    cv2.putText(c, n, (40, c.shape[0] - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)
    tiles.append(c)
rows, cur, wsum = [], [], 0                                 # rows of at most 1900 px
for t in tiles:
    if cur and wsum + t.shape[1] > 1900:
        rows.append(cur)
        cur, wsum = [], 0
    cur.append(t)
    wsum += t.shape[1]
if cur:
    rows.append(cur)
out = []
for r in rows:
    h = max(t.shape[0] for t in r)
    out.append(np.concatenate([np.concatenate([t, np.full((h - t.shape[0], t.shape[1], 3), 30, np.uint8)], 0) for t in r], 1))
w = max(o.shape[1] for o in out)
out = np.concatenate([np.concatenate([o, np.full((o.shape[0], w - o.shape[1], 3), 30, np.uint8)], 1) for o in out], 0)
cv2.imwrite(sys.argv[1], out, [cv2.IMWRITE_JPEG_QUALITY, 90])
print("GRID", sys.argv[1], out.shape[1], "x", out.shape[0])
