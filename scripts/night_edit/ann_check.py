"""python -I ann_check.py: for every annotation, how much real sky or sea (the depth model's zero, sky or sea coloured)
lies inside the window zones, lit shapes and interiors, which would block the outside there and light it as glass; and
lamps placed on sky. Lists the worst first."""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.argv = [sys.argv[0]]
G = "C:/Users/JTP20/OneDrive/Desktop/RBVRPG/public/images/animations/locations/britannic"


def poly_mask(polys, H, W):
    m = np.zeros((H, W), np.uint8)
    for p in polys or []:
        if len(p) == 3 and not isinstance(p[0], (list, tuple)):
            cv2.circle(m, (int(round(p[0])), int(round(p[1]))), int(round(p[2])), 1, -1)
        elif len(p) == 5 and not isinstance(p[0], (list, tuple)):
            cv2.ellipse(m, (int(round(p[0])), int(round(p[1]))), (int(round(p[2])), int(round(p[3]))), float(p[4]), 0, 360, 1, -1)
        elif len(p) == 4 and not isinstance(p[0], (list, tuple)):
            x0, y0, x1, y1 = (int(round(v)) for v in p)
            m[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = 1
        else:
            cv2.fillPoly(m, [np.array(p, np.int32)], 1)
    return m > 0


rows = []
for f in sorted(os.listdir("ann")):
    n = f[:-5]
    a = json.load(open(os.path.join("ann", f), encoding="utf-8"))
    im = np.asarray(Image.open(f"{G}/{n}.png").convert("RGB")).astype(np.float32) / 255
    H, W = im.shape[:2]
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    d = np.load(f"work/depth/{n}.disp.npy")
    skyc = ((b - r) > 0.08) & ((g - r) > 0.06)
    far = d < 0.05
    real_out = far & skyc
    for key in ("zones", "zones_fine", "lit", "lit_blue", "interior"):
        m = poly_mask(a.get(key), H, W)
        if not m.any():
            continue
        k = int((m & real_out).sum())
        if k > 50:
            ys, xs = np.nonzero(m & real_out)
            rows.append((k, n, key, int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())))
    for lp in a.get("lamps", []):
        x, y = lp["p"]
        if real_out[int(y), int(x)]:
            rows.append((99999, n, "lamp on sky", x, y, x, y))
for row in sorted(rows, reverse=True):
    print("%6d  %-36s %-10s sky/sea inside at x %d-%d, y %d-%d" % (row[0], row[1], row[2], row[3], row[5], row[4], row[6]))
print("checked", len(os.listdir("ann")), "annotations;", len(rows), "problems")
