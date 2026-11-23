"""Crop sheets for looking at pictures at full size (2026-11-22). python -I crops.py <out.jpg> <spec.json>
spec: {"rows": [[{"p": path, "box": [x0,y0,x1,y1] (optional), "k": zoom (default 1), "w": width to fit (optional), "tag": text}, ...], ...]}
Paths are relative to scripts/night_edit; "G:" at a path's start stands for the game's day pictures' folder."""
import json, os, sys
import cv2
import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = os.path.normpath(os.path.join(HERE, "..", "..", "public", "images", "animations", "locations", "britannic"))


def tile(t):
    p = t["p"]
    p = os.path.join(G, p[2:]) if p.startswith("G:") else os.path.join(HERE, p)
    im = cv2.imread(p)
    if im is None:
        im = np.full((120, 320, 3), 40, np.uint8)
        cv2.putText(im, "missing", (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
    b = t.get("box")
    if b:
        im = im[max(0, b[1]):b[3], max(0, b[0]):b[2]]
    k = float(t.get("k", 1))
    if "w" in t:
        k = t["w"] / im.shape[1]
    if k != 1:
        im = cv2.resize(im, None, fx=k, fy=k, interpolation=cv2.INTER_NEAREST if k >= 2 else (cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC))
    im = np.ascontiguousarray(im)
    tag = t.get("tag", "")
    if tag:
        cv2.putText(im, tag, (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
        cv2.putText(im, tag, (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
    return im


spec = json.load(open(sys.argv[2], encoding="utf-8"))
rows = []
for r in spec["rows"]:
    ts = [tile(t) for t in r]
    h = max(t.shape[0] for t in ts)
    ts = [np.concatenate([t, np.full((h - t.shape[0], t.shape[1], 3), 30, np.uint8)], 0) if t.shape[0] < h else t for t in ts]
    rows.append(np.concatenate(ts, 1))
w = max(r.shape[1] for r in rows)
rows = [np.concatenate([r, np.full((r.shape[0], w - r.shape[1], 3), 30, np.uint8)], 1) if r.shape[1] < w else r for r in rows]
out = np.concatenate(rows, 0)
cv2.imwrite(sys.argv[1], out, [cv2.IMWRITE_JPEG_QUALITY, int(spec.get("q", 92))])
print("SHEET", sys.argv[1], out.shape[1], "x", out.shape[0])
