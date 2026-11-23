"""Window panes left dark at night (2026-11-22; the user: "some of the windows dont have a light at all and makes it look
weird"). A pane = a compact patch that is dark navy in the DAY picture (the game's glass; the dark sea seen past a rail is
far more blue and is left out); unlit = still dark and not warm in the night picture.
python -I scan_unlit.py <night dir A> [<night dir B>]   ->  per set: views with unlit panes and the pane count; with two
sets, the views where B lights the most panes A left dark (the before/after candidates)."""
import os
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
G = os.path.normpath(os.path.join(HERE, "..", "..", "public", "images", "animations", "locations", "britannic"))
names = [os.path.splitext(l.rstrip("\n").split("\t")[1])[0] for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]


def panes(n):
    d = cv2.resize(cv2.imread(os.path.join(G, n + ".png")), (960, 540), interpolation=cv2.INTER_AREA).astype(int)
    b, g, r = d[..., 0], d[..., 1], d[..., 2]
    lum = (r + g + b) / 3
    p = (lum < 52) & (lum > 6) & (b > r + 5) & (b < r + 42)
    p = ndi.binary_closing(p, structure=np.ones((3, 3), bool))
    lab, k = ndi.label(p)
    res = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        m = lab[sl] == i
        a = int(m.sum())
        h, w = m.shape
        if a < 90 or h < 12 or w < 5 or a > 14000 or a < 0.5 * h * w or h > 6 * w or w > 5 * h:
            continue
        res.append((sl, m))
    return res


def unlit(n, d, ps):
    e = cv2.imread(os.path.join(d, n + ".png"))
    if e is None:
        return None
    e = cv2.resize(e, (960, 540), interpolation=cv2.INTER_AREA).astype(int)
    lum = e.sum(axis=2) / 3
    warm = e[..., 2] - e[..., 0]
    return sum(1 for sl, m in ps if float(lum[sl][m].mean()) < 60 and float(warm[sl][m].mean()) < 12)


dirs = sys.argv[1:3]
tot = [0] * len(dirs)
views = [0] * len(dirs)
rows = []
for n in names:
    if "bridge" in n.lower():                           # (the bridge's glass looks out at the night: dark is right)
        continue
    ps = panes(n)
    u = [unlit(n, d, ps) for d in dirs]
    for k, v in enumerate(u):
        if v:
            tot[k] += v
            views[k] += 1
    rows.append((n, len(ps), u))
for k, d in enumerate(dirs):
    print("%-60s views with unlit panes: %3d, unlit panes: %4d" % (d[-58:], views[k], tot[k]))
if len(dirs) == 2:
    best = sorted([r for r in rows if r[2][0] is not None and r[2][1] is not None], key=lambda r: -(r[2][0] - r[2][1]))
    print("most panes newly lit:", " | ".join("%s %d->%d" % (n, u[0], u[1]) for n, k, u in best[:10]))
    left = sorted([r for r in rows if r[2][1]], key=lambda r: -r[2][1])
    print("still unlit in B:", " | ".join("%s %d" % (n, u[1]) for n, k, u in left[:12]))
