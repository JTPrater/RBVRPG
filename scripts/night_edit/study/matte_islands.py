"""Where does the night sky show THROUGH the ship? (2026-11-23.) night4's matte (work/<run>/dbg/<name>.mask.png: white = sky
and sea replaced) sometimes takes a blue or pale thing of the ship for sky: at night the stars show through it. This lists,
for every picture, the matte's small parts that are ringed by ship (not joined to the big sky or sea), leaves out what win6
found as a window (night4 gives those back to the ship), and draws the biggest ones: the day picture's crop, the part
outlined in magenta, and the same crop from the night picture.

python -I matte_islands.py <run dir under work/> <out dir> [min_px=60] [max_frac=0.004]"""
import json
import os
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = os.path.normpath(os.path.join(HERE, "..", "..", "public", "images", "animations", "locations", "britannic"))
W = os.path.join(HERE, "work")
run, od = sys.argv[1], sys.argv[2]
min_px = int(sys.argv[3]) if len(sys.argv) > 3 else 60
max_frac = float(sys.argv[4]) if len(sys.argv) > 4 else 0.004
os.makedirs(od, exist_ok=True)
names = [os.path.splitext(l.rstrip("\n").split("\t")[1])[0] for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
found = []
for n in names:
    mp = os.path.join(W, run, "dbg", n + ".mask.png")
    if not os.path.exists(mp):
        continue
    out = cv2.imread(mp, cv2.IMREAD_UNCHANGED) > 127
    H, Wd = out.shape
    wp = os.path.join(W, "win6", n + ".w5.npz")
    if os.path.exists(wp):
        out &= ~(np.load(wp)["alpha"] > 127)
    lab, k = ndi.label(out)
    if not k:
        continue
    sizes = ndi.sum(out, lab, np.arange(1, k + 1))
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        a = int(sizes[i - 1])
        if a < min_px or a > max_frac * H * Wd:
            continue
        if sl[0].start == 0 or sl[1].start == 0 or sl[0].stop == H or sl[1].stop == Wd:
            continue
        m = lab[sl] == i
        hh, ww = m.shape
        # ringed by ship: what lies round it is not outside
        y0, y1, x0, x1 = max(0, sl[0].start - 24), min(H, sl[0].stop + 24), max(0, sl[1].start - 24), min(Wd, sl[1].stop + 24)
        blob = lab[y0:y1, x0:x1] == i
        ring = ndi.binary_dilation(blob, iterations=int(os.environ.get("RING_W", "8"))) & ~ndi.binary_dilation(blob, iterations=2)
        if ring.sum() < 20 or float(out[y0:y1, x0:x1][ring].mean()) > float(os.environ.get("RING_MAX", "0.25")):
            continue
        compact = a / float(hh * ww)
        if compact < float(os.environ.get("COMPACT_MIN", "0")) or a > int(os.environ.get("MAX_PX", "100000000")):
            continue
        found.append(dict(n=n, box=[int(sl[1].start), int(sl[0].start), int(sl[1].stop), int(sl[0].stop)], a=a, compact=round(compact, 2)))
found.sort(key=lambda q: -q["a"])
json.dump(found, open(os.path.join(od, "islands.json"), "w"), indent=0)
by = {}
for q in found:
    by.setdefault(q["n"], []).append(q)
print("ISLANDS: %d parts in %d pictures" % (len(found), len(by)))
for n in sorted(by, key=lambda v: -sum(q["a"] for q in by[v]))[:60]:
    print("  %-34s %2d parts, %5d px, biggest %s" % (n, len(by[n]), sum(q["a"] for q in by[n]), by[n][0]["box"]))
# crops of the biggest: day (outlined) | night
tiles = []
for q in found[:int(os.environ.get("TOP", "72"))]:
    n = q["n"]
    day = cv2.imread(os.path.join(G, n + ".png"))
    night = cv2.imread(os.path.join(W, run, n + ".png"))
    out = cv2.imread(os.path.join(W, run, "dbg", n + ".mask.png"), cv2.IMREAD_UNCHANGED) > 127
    x0, y0, x1, y1 = q["box"]
    pad = int(max(30, 1.2 * max(x1 - x0, y1 - y0)))
    X0, Y0, X1, Y1 = max(0, x0 - pad), max(0, y0 - pad), min(day.shape[1], x1 + pad), min(day.shape[0], y1 + pad)
    d = day[Y0:Y1, X0:X1].copy()
    cs, _ = cv2.findContours(out[Y0:Y1, X0:X1].astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    k = min(3.0, 260.0 / max(d.shape[:2]))
    d = cv2.resize(d, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC if k > 1 else cv2.INTER_AREA)
    for c in cs:
        cv2.polylines(d, [(c.astype(np.float32) * k).astype(np.int32)], True, (255, 0, 255), 1)
    nn = night[Y0:Y1, X0:X1] if night is not None else np.zeros_like(day[Y0:Y1, X0:X1])
    nn = cv2.resize(nn, (d.shape[1], d.shape[0]), interpolation=cv2.INTER_CUBIC if k > 1 else cv2.INTER_AREA)
    t = np.concatenate([d, nn], 1)
    lab_ = np.full((16, t.shape[1], 3), 25, np.uint8)
    cv2.putText(lab_, ("%s %d,%d %dpx" % (n, (x0 + x1) // 2, (y0 + y1) // 2, q["a"]))[:t.shape[1] // 6], (2, 12), cv2.FONT_HERSHEY_SIMPLEX, 0.36, (200, 255, 255), 1)
    tiles.append(np.concatenate([lab_, t], 0))
sheets, rows, cur, cw, rh, th = [], [], [], 0, 0, 0
for t in tiles:
    if cur and cw + t.shape[1] + 4 > 1900:
        rows.append((cur, rh))
        th += rh + 4
        cur, cw, rh = [], 0, 0
    if rows and th + max(rh, t.shape[0]) > 1300:
        sheets.append(rows)
        rows, th = [], 0
    cur.append(t)
    cw += t.shape[1] + 4
    rh = max(rh, t.shape[0])
if cur:
    rows.append((cur, rh))
if rows:
    sheets.append(rows)
for si, rows in enumerate(sheets, 1):
    outimg = []
    for cur, rh in rows:
        line = []
        for t in cur:
            line.append(np.concatenate([t, np.full((rh - t.shape[0], t.shape[1], 3), 25, np.uint8)], 0))
            line.append(np.full((rh, 4, 3), 25, np.uint8))
        line = np.concatenate(line, 1)
        outimg.append(np.concatenate([line, np.full((rh, max(0, 1900 - line.shape[1]), 3), 25, np.uint8)], 1)[:, :1900])
        outimg.append(np.full((4, 1900, 3), 25, np.uint8))
    o = os.path.join(od, "islands_%02d.jpg" % si)
    cv2.imwrite(o, np.concatenate(outimg, 0), [cv2.IMWRITE_JPEG_QUALITY, 90])
    print("SHEET", o)
