"""python -I vp_test.py: the horizon from the deck planks' vanishing point (line segments in the deck's lower part,
pairwise intersections, the densest row), against the horizon found from the sea, for every exterior picture."""
import json
import os

import cv2
import numpy as np
from PIL import Image

G = "C:/Users/JTP20/OneDrive/Desktop/RBVRPG/public/images/animations/locations/britannic"
hz = {r[0]: r for r in json.load(open("work/hz_test.json"))}
rows = [l.rstrip("\n").split("\t") for l in open("exterior_list.tsv", encoding="utf-8") if l.strip()]
lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)


def vp_horizon(path):
    im = np.asarray(Image.open(path).convert("RGB"))
    H, W = im.shape[:2]
    g = cv2.cvtColor(im, cv2.COLOR_RGB2GRAY)
    L = im.astype(np.float32) / 255
    lin = np.where(L <= 0.04045, L / 12.92, ((L + 0.055) / 1.055) ** 2.4)
    u = np.log(np.maximum(lin[..., 0], 1e-4) / np.maximum(lin[..., 1], 1e-4))
    w = np.log(np.maximum(lin[..., 2], 1e-4) / np.maximum(lin[..., 1], 1e-4))
    deck = (u > 0.10) & (w < -0.05)
    segs = lsd.detect(g)[0]
    if segs is None:
        return None, 0
    segs = segs.reshape(-1, 4)
    keep = []
    for x1, y1, x2, y2 in segs:
        ln = np.hypot(x2 - x1, y2 - y1)
        if ln < 60:
            continue
        ang = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1))) % 180
        if ang < 8 or ang > 172 or 82 < ang < 98:          # level or plumb lines tell nothing here
            continue
        ym = int((y1 + y2) / 2)
        xm = int((x1 + x2) / 2)
        if ym < H * 0.45 or not deck[min(H - 1, ym), min(W - 1, xm)]:
            continue
        keep.append((x1, y1, x2, y2, ln))
    if len(keep) < 6:
        return None, len(keep)
    pts, wts = [], []
    for i in range(len(keep)):
        x1, y1, x2, y2, l1 = keep[i]
        for j in range(i + 1, len(keep)):
            x3, y3, x4, y4, l2 = keep[j]
            d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
            if abs(d) < 1e-6:
                continue
            t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d
            px, py = x1 + t * (x2 - x1), y1 + t * (y2 - y1)
            a1 = np.arctan2(y2 - y1, x2 - x1)
            a2 = np.arctan2(y4 - y3, x4 - x3)
            dang = abs(np.sin(a1 - a2))
            if dang < 0.05 or not (-2 * W < px < 3 * W) or not (-200 < py < H * 0.7):
                continue
            pts.append(py)
            wts.append(l1 * l2 * dang)
    if len(pts) < 10:
        return None, len(pts)
    pts, wts = np.array(pts), np.array(wts)
    hist, edges = np.histogram(pts, bins=np.arange(-200, H * 0.7 + 8, 8), weights=wts)
    sm = np.convolve(hist, [1, 2, 3, 2, 1], mode="same")
    k = int(np.argmax(sm))
    c = 0.5 * (edges[k] + edges[k + 1])
    sel = np.abs(pts - c) < 24
    return float(np.average(pts[sel], weights=wts[sel])), int(sel.sum())


errs = []
for room, f in rows:
    n = os.path.splitext(f)[0]
    vp, nn = vp_horizon(f"{G}/{f}")
    _, cur, assumed, st, npt, dh = hz[n]
    ref = st if (st is not None and npt >= 20) else None
    e = (vp - ref) if (vp is not None and ref is not None) else None
    if e is not None:
        errs.append(e)
    print("%-38s step %7s  vp %7s (%4d)  err %s" % (n, "%.1f" % ref if ref else "-", "%.1f" % vp if vp else "-", nn,
                                                    "%+.1f" % e if e is not None else ""), flush=True)
errs = np.array(errs)
print("vp vs step: n %d, median %+.1f, abs median %.1f, p90 abs %.1f" % (len(errs), np.median(errs), np.median(np.abs(errs)),
                                                                          np.percentile(np.abs(errs), 90)))
