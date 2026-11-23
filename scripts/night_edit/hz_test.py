"""python -I hz_test.py: the horizon by the sky->sea step with looser run limits, and by the depth map (the deck's inverse
depth is linear in the picture's row and vanishes at the horizon), for every exterior picture, against the current one."""
import json
import os
import re
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

G = "C:/Users/JTP20/OneDrive/Desktop/RBVRPG/public/images/animations/locations/britannic"
rows = [l.rstrip("\n").split("\t") for l in open("exterior_list.tsv", encoding="utf-8") if l.strip()]
rng = np.random.default_rng(5)


def step_horizon(im, outside, ero=2, runmin=8):
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    Ys = 0.299 * r + 0.587 * g + 0.114 * b
    H, W = Ys.shape
    core = ndi.binary_erosion(outside, iterations=ero)
    hp = []
    for x in range(2, W - 2, 2):
        rr = np.nonzero(core[:, x])[0]
        if len(rr) < runmin:
            continue
        for run in np.split(rr, np.nonzero(np.diff(rr) > 1)[0] + 1):
            if len(run) < runmin:
                continue
            d = np.diff(Ys[run, x])
            k = int(np.argmin(d))
            if d[k] < -0.03 and 2 < k < len(run) - 3:
                bel = im[run[min(len(run) - 1, k + 3)], x]
                if bel[2] - bel[0] > 0.15 and Ys[run[k + 2], x] < Ys[run[k - 1], x]:
                    hp.append((x, run[k] + 0.5))
    hp = np.array(hp, np.float64)
    if len(hp) < 8:
        return None, len(hp)
    best, bestn = None, 0
    for _ in range(600):
        i, j = rng.choice(len(hp), 2, replace=False)
        if abs(hp[i, 0] - hp[j, 0]) < 30:
            continue
        a = (hp[j, 1] - hp[i, 1]) / (hp[j, 0] - hp[i, 0])
        c0 = hp[i, 1] - a * hp[i, 0]
        n_in = int((np.abs(hp[:, 1] - (a * hp[:, 0] + c0)) < 2.0).sum())
        if n_in > bestn and abs(a) < 0.03:
            best, bestn = (a, c0), n_in
    if best is None or bestn < 6:
        return None, len(hp)
    inl = np.abs(hp[:, 1] - (best[0] * hp[:, 0] + best[1])) < 2.0
    a, c0 = np.linalg.lstsq(np.c_[hp[inl, 0], np.ones(inl.sum())], hp[inl, 1], rcond=None)[0]
    return (a, c0), int(inl.sum())


def depth_horizon(im, disp, outside):
    """The deck: warm wood pixels in the picture's lower half, not outside; disp = k (y - y_h) fitted robustly (the model
    puts the sky at 0); returns y_h at the picture's middle column."""
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    H, W = r.shape
    yy, xx = np.mgrid[0:H, 0:W]
    L = np.where(im <= 0.04045, im / 12.92, ((im + 0.055) / 1.055) ** 2.4)
    u = np.log(np.maximum(L[..., 0], 1e-4) / np.maximum(L[..., 1], 1e-4))
    w = np.log(np.maximum(L[..., 2], 1e-4) / np.maximum(L[..., 1], 1e-4))
    deck = (yy > H * 0.55) & ~outside & (u > 0.10) & (w < -0.05)
    if deck.sum() < 2000:
        return None, int(deck.sum())
    idx = np.flatnonzero(deck.ravel())
    pick = rng.choice(idx, min(len(idx), 20000), replace=False)
    y = yy.ravel()[pick].astype(np.float64)
    d = disp.ravel()[pick].astype(np.float64)
    best, bestn = None, -1
    for _ in range(400):
        i, j = rng.choice(len(pick), 2, replace=False)
        if abs(y[i] - y[j]) < 40:
            continue
        k = (d[j] - d[i]) / (y[j] - y[i])
        if k <= 0:
            continue
        yh = y[i] - d[i] / k
        res = np.abs(d - k * (y - yh))
        n_in = int((res < 0.05 * (d.max() - d.min() + 1e-6)).sum())
        if n_in > bestn:
            best, bestn = (k, yh), n_in
    return (best[1] if best else None), bestn


out = []
for room, f in rows:
    n = os.path.splitext(f)[0]
    im = np.asarray(Image.open(f"{G}/{f}").convert("RGB")).astype(np.float32) / 255
    m = np.asarray(Image.open(f"work/masks/{n}.mask.png")).astype(np.float32) / 255 > 0.5
    disp = np.load(f"work/depth/{n}.disp.npy")
    log = open(f"work/masks/{n}.log", encoding="utf-8").read()
    cur = re.findall(r'"horizon": \[([-0-9.]+), ([-0-9.]+)\]', log)
    cur_mid = (float(cur[0][0]) + float(cur[0][1])) / 2 if cur else None
    assumed = '"assumed"' in log
    st, npt = step_horizon(im, m)
    st_mid = (st[0] * 960 + st[1]) if st else None
    dh, dn = depth_horizon(im, disp, m)
    out.append((n, cur_mid, assumed, st_mid, npt, dh))
    print("%-38s cur %7s %-8s step %7s (%4d)  depth %7s" % (n, "%.1f" % cur_mid if cur_mid else "-", "assumed" if assumed else "",
          "%.1f" % st_mid if st_mid else "-", npt, "%.1f" % dh if dh is not None else "-"), flush=True)
json.dump(out, open("work/hz_test.json", "w"), indent=0)
