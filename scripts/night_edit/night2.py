"""Day -> night for a game location picture, with the ship's own lights (round 2, 2026-11-16).

python -I night2.py <day.png> <out.png> [ann.json] [debug_dir]

Builds on night_v1_recovered.py (the bridge-wing picture the user liked, 2026-11-15):
1. The outside: sky (and the clouds flooded into from it, stopped at hard edges) and sea; a guided-filter matte.
2. The horizon from the sky->sea step; elevation per pixel (the renders' 70 deg vertical field).
3. The sun's light taken apart: every non-outside pixel is put in a material class (log-chroma k-means), each class split
   into sunlit and shade (Otsu on log luminance, only where it is clearly two-level); sunlit pixels are brought towards
   their class's local shade level: fully under deckheads ('covered' in the annotation: no sun patches at night), partly
   on open decks (the moon's shadows are softer than the sun's).
4. Moonlight grade (v1's curve: darker, desaturated, blue in shade, silver in the light).
5. The ship's own lights, only where the picture has them (annotation): lamps (a warm core, bloom and a pool of light on
   what is round them, the pool lit through the de-sunned picture so no sun shadow shows in it), lit windows (glass found
   inside annotated zones, filled with a warm interior glow, a soft spill on the frames and wall), interiors seen through
   open doors (kept lit, warm), mast and side lights (points).
6. The night outside: the game's night palette by elevation, stars, clouds re-lit, the moon where the sun stood (so the
   shadows agree with it) with a glitter path on the sea; the sea mirrors the night sky with the picture's waves.
7. Bloom from everything that glows; vignette; dither.

Annotation (json; every field optional; coordinates in the picture's pixels):
  covered: "all" | [[x, y], ...] polygons            regions under a deckhead (sun patches removed)
  sun: [x, y]                                        the sun in the frame (moon drawn there, rays removed)
  moon: [x, y] | false                               an explicit moon (or none)
  lamps: [{p: [x, y], k: ceiling|wall|post|point, r: px, s: strength, pool: [cx, cy, rx, ry], c: [r, g, b]}]
  zones: [[x0, y0, x1, y1]]                          window zones: the glass inside them is lit
  dark: [[x0, y0, x1, y1]]                           glass left dark inside zones
  lit: [[[x, y], ...]]                               polygons lit as window glass whatever their colour
  interior: [[[x, y], ...]]                          polygons of a lit interior seen through a door
  not_sky / sky: [[[x, y], ...]]                     corrections to the outside mask
  horizon: [y_at_x0, y_at_xW]                        the horizon if the picture's own cannot be found
  exposure: float                                    overall night level (1.0)
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SRC, DST = sys.argv[1], sys.argv[2]
ANN = json.load(open(sys.argv[3])) if len(sys.argv) > 3 and sys.argv[3] not in ("", "-") else {}
DBG = sys.argv[4] if len(sys.argv) > 4 else None
HERE = os.path.dirname(os.path.abspath(__file__))
MOON = os.path.join(HERE, "..", "..", "public", "images", "moon phase", "full.webp")
rng = np.random.default_rng(1915)

NIGHT = ["#04070e", "#080d18", "#0d1422", "#141c2c", "#1e2836"]     # game.js SKY_PALETTES.night, zenith -> horizon
FOCAL = 771.0          # px: 70 deg vertical field of view on 1080 rows (the renders' camera)
GLASS = 0.82           # what window glass lets through of the outside
MOON_D = 46            # moon diameter in px (as the game's sky draws it, larger than life)
OPEN_SUN_KEEP = 0.55   # on open decks the sun/shade log-ratio is kept to this share (moon shadows softer)
WARM = np.array([1.0, 0.62, 0.27], np.float32)      # lamp light (linear): warm incandescent
WIN_GLOW = np.array([1.0, 0.58, 0.22], np.float32)  # lit interior seen through glass (linear)


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)


def hexrgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255


def box(x, r):
    return cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1), normalize=True, borderType=cv2.BORDER_REFLECT)


def guided(I, p, r, eps):
    """He et al. guided filter, colour guide I (HxWx3), input p (HxW)."""
    mI, mp = box(I, r), box(p, r)
    cov = box(I * p[..., None], r) - mI * mp[..., None]
    V = np.empty(I.shape[:2] + (3, 3), np.float32)
    for i in range(3):
        for j in range(i, 3):
            V[..., i, j] = V[..., j, i] = box(I[..., i] * I[..., j], r) - mI[..., i] * mI[..., j]
    V += eps * np.eye(3, dtype=np.float32)
    a = np.linalg.solve(V, cov[..., None])[..., 0]
    b = mp - (a * mI).sum(-1)
    return (box(a, r) * I).sum(-1) + box(b, r)


def poly_mask(polys, H, W):
    m = np.zeros((H, W), np.uint8)
    for p in polys or []:
        if len(p) == 4 and not isinstance(p[0], (list, tuple)):          # a rectangle [x0, y0, x1, y1]
            x0, y0, x1, y1 = (int(round(v)) for v in p)
            m[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = 1
        else:
            cv2.fillPoly(m, [np.array(p, np.int32)], 1)
    return m > 0


def gblur(x, s):
    return cv2.GaussianBlur(x, (0, 0), s, borderType=cv2.BORDER_REFLECT)


def masked_blur(val, w, s):
    """Gaussian average of val over the weight w, and the weight's own blur (where data is thin, it is small)."""
    num = gblur(val * w, s)
    den = gblur(w, s)
    return num / np.maximum(den, 1e-6), den


def otsu(x, bins=128):
    h, e = np.histogram(x, bins)
    c = (e[:-1] + e[1:]) / 2
    w0 = np.cumsum(h)
    w1 = w0[-1] - w0
    m0 = np.cumsum(h * c) / np.maximum(w0, 1)
    m1 = (np.sum(h * c) - np.cumsum(h * c)) / np.maximum(w1, 1)
    between = w0 * w1 * (m0 - m1) ** 2
    k = int(np.argmax(between))
    return c[k], between[k] / max(len(x) ** 2 * x.var(), 1e-9), m0[k], m1[k], w0[k] / w0[-1]


# ============================================================================== load
im = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32) / 255
H, W = im.shape[:2]
L = lin(im)
Yd = L @ np.array([0.2126, 0.7152, 0.0722], np.float32)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
Ys = 0.299 * r + 0.587 * g + 0.114 * b
mx, mn = im.max(2), im.min(2)
sat = (mx - mn) / np.maximum(mx, 1e-6)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
rep = {"src": os.path.basename(SRC)}

# ============================================================================== 1. the outside
blue = ((b - r) > 0.10) & (sat > 0.12) & (b > 0.30)
gm = cv2.morphologyEx(Ys, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
hard = ndi.binary_dilation(gm > 0.16, iterations=1)                    # hard edges stop the flood into clouds
cloudlike = (Ys > 0.50) & (sat < 0.30) & ((b - r) > -0.012)
lab, n = ndi.label(blue)
sizes = ndi.sum(blue, lab, range(1, n + 1)) if n else np.zeros(0)
touch = np.zeros(n + 1, bool)
for edge in (lab[0, :], lab[:, 0], lab[:, -1]):
    touch[np.unique(edge)] = True
keep = np.zeros(n + 1, bool)
for i in range(1, n + 1):
    keep[i] = sizes[i - 1] >= 8000 or (touch[i] and sizes[i - 1] >= 400)
seed = keep[lab]
# a big blue part that holds no gradient at all is glass reflecting the sky (the lounge's roof lights), not sky
outside = ndi.binary_propagation(seed, mask=(seed | cloudlike) & ~hard | seed)
# the haze beside the sky above the rails (fails the blue test): sky-coloured, within 10 px of it
cand = ((b - r) > 0.06) & ((g - r) > 0.04) & ~hard
outside |= ndi.binary_propagation(outside, mask=(outside | cand) & ndi.binary_dilation(outside, iterations=10))
# small holes inside the sky (cloud wisps, star-like specks): filled when they are cloud-coloured
holes = ndi.binary_fill_holes(outside) & ~outside
hl, hn = ndi.label(holes)
if hn:
    hs = ndi.sum(np.ones_like(Ys), hl, range(1, hn + 1))
    hc = ndi.sum(cloudlike, hl, range(1, hn + 1))
    fill = np.zeros(hn + 1, bool)
    fill[1:] = (hc / np.maximum(hs, 1) > 0.9) & (hs < 4000)
    outside |= fill[hl]
outside &= ~poly_mask(ANN.get("not_sky"), H, W)
outside |= poly_mask(ANN.get("sky"), H, W)
alpha = np.clip(guided(im, outside.astype(np.float32), 2, 2e-3), 0, 1)
inner = ndi.binary_erosion(outside, iterations=3)
outer = ndi.binary_dilation(outside, iterations=3)
alpha = np.where(inner, 1.0, np.where(outer, alpha, 0.0)).astype(np.float32)
rep["outside"] = round(float(outside.mean()), 4)

# ============================================================================== 2. horizon
hp = []
core = ndi.binary_erosion(outside, iterations=4)
for x in range(2, W - 2, 3):
    rows = np.nonzero(core[:, x])[0]
    if len(rows) < 16:
        continue
    # contiguous runs only (a run crossing a mast is two runs)
    breaks = np.nonzero(np.diff(rows) > 1)[0]
    for run in np.split(rows, breaks + 1):
        if len(run) < 16:
            continue
        d = np.diff(Ys[run, x])
        k = int(np.argmin(d))
        if d[k] < -0.035 and 3 < k < len(run) - 4:
            above, below = im[run[max(0, k - 3)], x], im[run[min(len(run) - 1, k + 4)], x]
            if below[2] - below[0] > 0.18 and Ys[run[k + 2], x] < Ys[run[k - 1], x]:          # blue sea under it
                hp.append((x, run[k] + 0.5))
hp = np.array(hp, np.float64)
coef = None
if "horizon" in ANN:
    y0, y1 = ANN["horizon"]
    coef = np.array([(y1 - y0) / W, y0])
elif len(hp) >= 12:
    best, bestn = None, 0
    for _ in range(400):                                              # RANSAC: the horizon is one straight line
        i, j = rng.choice(len(hp), 2, replace=False)
        if abs(hp[i, 0] - hp[j, 0]) < 40:
            continue
        a = (hp[j, 1] - hp[i, 1]) / (hp[j, 0] - hp[i, 0])
        c0 = hp[i, 1] - a * hp[i, 0]
        n_in = int((np.abs(hp[:, 1] - (a * hp[:, 0] + c0)) < 2.0).sum())
        if n_in > bestn and abs(a) < 0.2:
            best, bestn = (a, c0), n_in
    if best is not None and bestn >= 10:
        inl = np.abs(hp[:, 1] - (best[0] * hp[:, 0] + best[1])) < 2.0
        A = np.c_[hp[inl, 0], np.ones(inl.sum())]
        coef = np.linalg.lstsq(A, hp[inl, 1], rcond=None)[0]
        rep["horizon_pts"] = [int(inl.sum()), len(hp)]
if coef is None:                                                      # no sea seen: an assumed level horizon
    coef = np.array([0.0, float(ANN.get("horizon_y", H * 0.62))])
    rep["horizon_pts"] = "assumed"
hy = coef[0] * xx + coef[1]
rep["horizon"] = [round(float(coef[1]), 1), round(float(coef[0] * W + coef[1]), 1)]
elev = np.degrees(np.arctan((H / 2 - yy) / FOCAL) - np.arctan((H / 2 - hy) / FOCAL))
sea_cov = np.clip(yy + 0.5 - hy, 0, 1) * outside
sky_here = outside & (yy < hy - 1)

# ============================================================================== 3. sun and shade
solid = ~ndi.binary_dilation(outside, iterations=2)
logY = np.log(np.maximum(Yd, 1e-4))
u = np.log(np.maximum(L[..., 0], 1e-4) / np.maximum(L[..., 1], 1e-4))
w = np.log(np.maximum(L[..., 2], 1e-4) / np.maximum(L[..., 1], 1e-4))
ok = solid & (Yd > 0.006)
feat = np.stack([u[ok], w[ok]], 1).astype(np.float32)
K = 7
crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 1e-3)
sub = feat[rng.choice(len(feat), min(len(feat), 60000), replace=False)]
_, _, cent = cv2.kmeans(sub, K, None, crit, 3, cv2.KMEANS_PP_CENTERS)
cls = np.full((H, W), -1, np.int32)
dd = ((feat[:, None, :] - cent[None, :, :]) ** 2).sum(-1)
cls[ok] = dd.argmin(1)
sun = np.zeros((H, W), np.float32)
ratios = []
for c in range(K):
    m = cls == c
    if m.sum() < 2000:
        continue
    thr, sep, m0, m1, f0 = otsu(logY[m])
    if sep > 0.55 and (m1 - m0) > np.log(1.6) and 0.03 < f0 < 0.97:
        sun[m] = 1.0 / (1.0 + np.exp(-(logY[m] - thr) / 0.05))
        ratios.append((float(np.exp(m1 - m0)), int(m.sum())))
rep["sun_classes"] = [(round(a, 2), n) for a, n in ratios]
sun = np.clip(guided(im, sun, 3, 4e-3), 0, 1) * solid
covered = np.zeros((H, W), bool)
cv_ann = ANN.get("covered")
if cv_ann == "all":
    covered[:] = True
elif cv_ann:
    covered = poly_mask(cv_ann, H, W)
covered = gblur(covered.astype(np.float32), 6)
# the local log-level of sun and shade in each class (pixels of the other classes do not vote)
shift = np.zeros((H, W), np.float32)
for c in range(K):
    m = (cls == c)
    if m.sum() < 2000:
        continue
    ws, wsh = (sun * m).astype(np.float32), ((1 - sun) * m).astype(np.float32)
    if ws.sum() < 300 or wsh.sum() < 300:
        continue
    ls_, ds = masked_blur(logY, ws, 60)
    lh_, dh = masked_blur(logY, wsh, 60)
    gs, gh = float((logY * ws).sum() / ws.sum()), float((logY * wsh).sum() / wsh.sum())
    ls_ = np.where(ds > 0.02, ls_, gs)
    lh_ = np.where(dh > 0.02, lh_, gh)
    shift[m] = np.clip(ls_ - lh_, 0, 3.0)[m]
keep_share = OPEN_SUN_KEEP * (1 - covered)
logY2 = logY - sun * shift * (1 - keep_share)                         # sun brought towards shade
relit = L * np.exp(logY2 - logY)[..., None]
Yr = relit @ np.array([0.2126, 0.7152, 0.0722], np.float32)

# ============================================================================== 4. moonlight grade (v1's curve)
EXPO = float(ANN.get("exposure", 1.0))
Yn = (0.30 * np.power(Yr, 1.45) + 0.0022) * EXPO
tt = np.clip(Yn / 0.11, 0, 1)[..., None]
keepc = 0.22 + 0.16 * tt
desat = Yr[..., None] + (relit - Yr[..., None]) * keepc
tint = (1 - tt) * np.array([0.717, 1.004, 1.793], np.float32) + tt * np.array([0.869, 1.010, 1.293], np.float32)
night = desat * (Yn / np.maximum(Yr, 1e-5))[..., None] * tint
band = ndi.binary_dilation(outside, iterations=3)
_, (iy, ix) = ndi.distance_transform_edt(band, return_indices=True)
skyish = np.clip(((b - r) - 0.10) / 0.05, 0, 1) * band
night = night * (1 - skyish[..., None]) + night[iy, ix] * skyish[..., None]

# the de-sunned picture as the albedo the ship's own lights fall on (linear, a little desaturated)
alb = relit / np.maximum(np.percentile(Yr[solid], 99.5), 1e-3)
alb = (alb @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None] * 0.25 + alb * 0.75
emis = np.zeros((H, W, 3), np.float32)                                # what glows (for bloom)
lightadd = np.zeros((H, W, 3), np.float32)                            # light falling on surfaces

# ============================================================================== 5. the ship's own lights
# 5a. lit windows: dark glass inside the annotated zones, and explicit polygons
glass = np.zeros((H, W), bool)
zones = poly_mask(ANN.get("zones"), H, W)
if zones.any():
    wall = gblur(np.where(zones & (sat < 0.2), Ys, 0), 25) / np.maximum(gblur((zones & (sat < 0.2)).astype(np.float32), 25), 1e-3)
    brown = (r > g) & (g > b) & (sat > 0.32)
    g_c = zones & ~outside & (Ys < 0.62 * np.maximum(wall, 0.2)) & ~brown & ((b - r) > -0.03)
    g_c = ndi.binary_opening(g_c, iterations=1)
    gl, gn = ndi.label(g_c)
    if gn:
        gsz = ndi.sum(g_c, gl, range(1, gn + 1))
        ok_c = np.zeros(gn + 1, bool)
        ok_c[1:] = gsz >= 12
        glass = ok_c[gl]
glass |= poly_mask(ANN.get("lit"), H, W)
glass &= ~poly_mask(ANN.get("dark"), H, W)
if glass.any():
    gsoft = np.clip(guided(im, glass.astype(np.float32), 1, 1e-3), 0, 1) * ndi.binary_dilation(glass, iterations=1)
    tex = np.clip(Ys / max(float(np.percentile(Ys[glass], 90)), 0.05), 0.35, 1.4)
    var = gblur(rng.uniform(0.75, 1.15, (H // 40 + 1, W // 40 + 1)).astype(np.float32), 0.8)
    var = cv2.resize(var, (W, H), interpolation=cv2.INTER_NEAREST)
    glow = WIN_GLOW[None, None, :] * (0.55 * (0.75 + 0.25 * tex) * var * float(ANN.get("window_level", 1.0)))[..., None]
    night = night * (1 - gsoft[..., None]) + glow * gsoft[..., None]
    emis += glow * gsoft[..., None] * 0.6
    spill = gblur(gsoft, 10) * 0.9 + gblur(gsoft, 34) * 0.5
    lightadd += WIN_GLOW[None, None, :] * (0.10 * spill * float(ANN.get("window_level", 1.0)))[..., None] * (1 - gsoft[..., None])
rep["glass_px"] = int(glass.sum())

# 5b. interiors seen through open doors: kept lit, warm, a little dimmer than by day
inter = poly_mask(ANN.get("interior"), H, W)
if inter.any():
    isoft = gblur(inter.astype(np.float32), 1.2)
    warm_int = L * np.array([1.0, 0.80, 0.55], np.float32) * float(ANN.get("interior_level", 0.55))
    night = night * (1 - isoft[..., None]) + warm_int * isoft[..., None]
    spill = gblur(isoft, 40)
    lightadd += WIN_GLOW[None, None, :] * (0.08 * spill)[..., None] * (1 - isoft[..., None])

# 5c. lamps
for lp in ANN.get("lamps", []):
    x0, y0 = lp["p"]
    kind = lp.get("k", "wall")
    R = float(lp.get("r", 40))
    s = float(lp.get("s", 1.0))
    col = np.array(lp["c"], np.float32) if "c" in lp else WARM
    d = np.hypot(xx - x0, yy - y0)
    core = max(2.0, R * 0.07)
    # the fitting itself and its bloom
    emis += col * (s * 1.6 * np.exp(-(d / core) ** 2))[..., None]
    emis += col * (s * 0.10 * np.exp(-d / (core * 4)))[..., None]
    if kind == "point":                                               # a mast or side light: no pool
        continue
    # light on what is round the lamp: a broad falloff round the fitting, and a pool where it falls
    near = s * 0.55 * np.exp(-(d / R) ** 2 * 1.6)
    if "pool" in lp:
        cx, cy, rx, ry = lp["pool"]
    elif kind == "ceiling":
        cx, cy, rx, ry = x0, y0 + 2.6 * R, 2.2 * R, 1.1 * R
    elif kind == "post":
        cx, cy, rx, ry = x0, y0 + 2.2 * R, 1.6 * R, 0.8 * R
    else:                                                             # wall
        cx, cy, rx, ry = x0, y0 + 1.6 * R, 1.8 * R, 1.0 * R
    pool = s * 0.75 * np.exp(-(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2) * 1.4)
    lightadd += col * (near + pool)[..., None]

night = night + alb * lightadd
rep["lamps"] = len(ANN.get("lamps", []))

# ============================================================================== 6. the night outside
pal = np.stack([hexrgb(h) for h in NIGHT])
tz = np.clip(elev / 90.0, 0, 1)
pos = (1 - tz) * (len(NIGHT) - 1)
i0 = np.clip(np.floor(pos).astype(int), 0, len(NIGHT) - 2)
f = (pos - i0)[..., None]
sky = lin(pal[i0] * (1 - f) + pal[i0 + 1] * f)

# clouds against the clear sky of each row (v1's measure)
cloud = np.zeros((H, W), np.float32)
cloudlum = np.zeros((H, W), np.float32)
sreg = outside & (yy < hy - 2)
if sreg.sum() > 2000:
    q = np.full(H, np.inf, np.float32)
    for y in np.unique(yy[sreg].astype(int)):
        q[y] = np.percentile(r[y][sreg[y]], 35)
    clear = sreg & (r <= q[:, None])
    rows = np.arange(H)
    cnt = np.bincount(yy[clear].astype(int), minlength=H)
    good = cnt > 8
    if good.sum() >= 2:
        cc = np.stack([np.bincount(yy[clear].astype(int), weights=im[..., k][clear], minlength=H) for k in range(3)], 1)
        cc = cc[good] / cnt[good, None]
        clear_row = np.stack([np.interp(rows, rows[good], ndi.median_filter(cc[:, k], 9, mode="nearest")) for k in range(3)], 1)
        white = np.percentile(im[sreg], 99.7, axis=0)
        dv = white[None, :] - clear_row
        pc = im - clear_row[:, None, :]
        t = (pc * dv[:, None, :]).sum(-1) / np.maximum((dv * dv).sum(-1), 1e-6)[:, None]
        cloud = np.where(sreg, np.clip(t, 0, 1), 0).astype(np.float32)
        cloudlum = np.where(sreg, Yd / max(float(np.percentile(Yd[sreg], 99.7)), 1e-4), 0).astype(np.float32)
SUN = ANN.get("sun")
if SUN is not None:
    # the sun's rays are not cloud: what brightens the sky along lines from the sun is taken off
    dsun = np.hypot(xx - SUN[0], yy - SUN[1])
    ray_zone = np.exp(-dsun / 420.0)
    cloud = cloud * (1 - 0.85 * ray_zone) - 0.15 * ray_zone
cloud = np.clip((cloud - 0.14) / 0.86, 0, 1)
edge_d = ndi.distance_transform_edt(np.pad(outside, ((1, 0), (1, 1)), constant_values=True))[1:, 1:-1]
cloud = gblur(cloud, 0.7) * np.clip((edge_d - 2) / 10.0, 0, 1)

MOONP = ANN.get("moon", SUN)
if MOONP:
    mx_, my_ = MOONP
    dm = np.hypot(xx - mx_, yy - my_)
    R = MOON_D / 2
    warm = np.array([1.0, 0.93, 0.80], np.float32)
    sky = sky + (0.018 * np.exp(-dm / 230.0))[..., None] * np.array([0.80, 0.90, 1.0], np.float32) \
        + (0.060 * np.exp(-np.maximum(dm - R, 0) / 22.0))[..., None] * warm
else:
    mx_, my_, dm, R = -9999.0, -9999.0, np.full((H, W), 1e6, np.float32), MOON_D / 2

N = 2600
sx, sy = rng.uniform(0, W, N), rng.uniform(0, H, N)
mag = rng.uniform(0, 1, N) ** 3.2
amp = 0.006 + 0.22 * mag
temp = rng.uniform(0, 1, N)
colr = np.where(temp[:, None] < 0.55, [0.86, 0.92, 1.0], np.where(temp[:, None] < 0.88, [1.0, 0.97, 0.90], [1.0, 0.86, 0.72]))
stars = np.zeros((H, W, 3), np.float32)
for x, y, a, c in zip(sx, sy, amp, colr):
    xi, yi = int(x), int(y)
    if not (2 <= xi < W - 2 and 2 <= yi < H - 2) or not sky_here[yi, xi]:
        continue
    vis = np.clip((elev[yi, xi] - 0.5) / 7.0, 0, 1) ** 1.5 * np.clip((np.hypot(x - mx_, y - my_) - 2 * R) / 260.0, 0, 1)
    if vis <= 0:
        continue
    sg = 0.55 + 0.5 * (a > 0.08)
    ox, oy = np.meshgrid(np.arange(xi - 2, xi + 3), np.arange(yi - 2, yi + 3))
    k = np.exp(-((ox + 0.5 - x) ** 2 + (oy + 0.5 - y) ** 2) / (2 * sg * sg))
    stars[yi - 2:yi + 3, xi - 2:xi + 3] += (a * vis * k)[..., None] * np.array(c, np.float32)
sky = sky + stars * ((1 - cloud) ** 2)[..., None]
if MOONP:
    mimg = Image.open(MOON).convert("RGBA")
    mimg = mimg.crop(mimg.getbbox()).resize((MOON_D * 4, MOON_D * 4), Image.LANCZOS).resize((MOON_D, MOON_D), Image.LANCZOS)
    ma = np.asarray(mimg).astype(np.float32) / 255
    mrgb = lin(ma[..., :3]) * 1.15 * np.array([1.0, 0.93, 0.80], np.float32)
    x0, y0 = int(round(mx_ - R)), int(round(my_ - R))
    xa, ya = max(0, x0), max(0, y0)
    xb, yb = min(W, x0 + MOON_D), min(H, y0 + MOON_D)
    if xb > xa and yb > ya:
        ms, mr = ma[ya - y0:yb - y0, xa - x0:xb - x0, 3:], mrgb[ya - y0:yb - y0, xa - x0:xb - x0]
        sky[ya:yb, xa:xb] = sky[ya:yb, xa:xb] * (1 - ms) + mr * ms
        emis[ya:yb, xa:xb] += mr * ms * 0.25
near = np.exp(-dm / 230.0)[..., None]
tight = np.exp(-np.maximum(dm - R, 0) / 60.0)[..., None]
cl = sky * 0.75 + (0.0045 + 0.030 * near + 0.16 * tight) * (0.55 + 0.6 * cloudlum[..., None]) * np.array([0.88, 0.93, 1.0], np.float32)
sky = sky * (1 - 0.9 * cloud[..., None]) + cl * (0.9 * cloud[..., None])

# sea: the night sky mirrored, Fresnel by depression, the picture's own waves, a moon path under the moon
dep = np.clip(-elev, 0.0, 89.0)
fres = 0.02 + 0.98 * (1 - np.sin(np.radians(dep))) ** 5
pos_m = (1 - np.clip(dep / 90, 0, 1)) * (len(NIGHT) - 1)
j0 = np.clip(np.floor(pos_m).astype(int), 0, len(NIGHT) - 2)
fm = (pos_m - j0)[..., None]
mirror = lin(pal[j0] * (1 - fm) + pal[j0 + 1] * fm)
tex = np.zeros_like(Yd)
s_ = sea_cov > 0.5
if s_.any():
    blur_ = gblur(np.where(s_, Yd, 0), 6) / np.maximum(gblur(s_.astype(np.float32), 6), 1e-3)
    tex[s_] = (Yd[s_] - blur_[s_]) / np.maximum(blur_[s_], 1e-3)
sea = mirror * (0.55 * fres)[..., None] * np.clip(1 + 2.6 * tex, 0.3, 2.5)[..., None] + np.array([0.0006, 0.0010, 0.0016], np.float32)
crest = np.clip(tex * 7.0, 0, 1) ** 2 * np.clip(1 - dep / 14.0, 0, 1)
sea = sea + (0.0030 * crest)[..., None] * np.array([0.75, 0.85, 1.0], np.float32)
pb = np.maximum(yy - hy, 0.5)
nz = ndi.gaussian_filter(rng.standard_normal((512, 2048)).astype(np.float32), (1.0, 6.0), mode="wrap")
nz /= nz.std()
wu = np.mod((xx - W / 2) / pb * 40.0, 2048).astype(np.float32)
wv = np.mod(6000.0 / pb, 512).astype(np.float32)
wave = cv2.remap(nz, wu, wv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
sea = sea * np.clip(1 + 0.30 * wave, 0.5, 1.8)[..., None] \
    + (0.0040 * np.clip(wave - 1.0, 0, 2) ** 2 * np.clip(1 - pb / 220.0, 0, 1))[..., None] * np.array([0.75, 0.85, 1.0], np.float32)
if MOONP and my_ < float(coef[0] * mx_ + coef[1]):
    # the moon's path: a column under the moon, glittering on the wave crests, narrowing towards the horizon
    hx = float(coef[0] * mx_ + coef[1])
    width = 18 + 0.55 * pb
    colm = np.exp(-((xx - mx_) / width) ** 2)
    glit = np.clip(wave + 1.6 * np.clip(tex * 6, -1, 2), 0, None) ** 2
    path = colm * (0.012 + 0.030 * glit) * np.exp(-pb / 520.0) * np.clip(pb / 4.0, 0, 1)
    sea = sea + path[..., None] * np.array([0.95, 0.92, 0.85], np.float32)
outside_rgb = sky * (1 - sea_cov[..., None]) + sea * sea_cov[..., None]
out = night * (1 - alpha[..., None]) + outside_rgb * alpha[..., None]

# ============================================================================== 7. bloom, vignette, dither
emis = emis * (1 - alpha[..., None] * 0.0)
bloom = gblur(emis, 3) * 0.35 + gblur(emis, 12) * 0.22 + gblur(emis, 40) * 0.12
out = out + emis * 0.6 + bloom
rr = np.hypot((xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2)) / np.sqrt(2)
out = out * (1 - 0.30 * rr ** 2)[..., None]
o = srgb(out) * 255 + rng.triangular(-0.5, 0, 0.5, out.shape).astype(np.float32)
o8 = np.clip(np.round(o), 0, 255).astype(np.uint8)
os.makedirs(os.path.dirname(os.path.abspath(DST)), exist_ok=True)
Image.fromarray(o8).save(DST)
if DBG:
    os.makedirs(DBG, exist_ok=True)
    base = os.path.splitext(os.path.basename(SRC))[0]
    sunv = np.stack([sun * solid, covered, np.clip(shift / 2, 0, 1)], -1)
    tiles = [np.stack([alpha] * 3, -1), np.stack([sea_cov] * 3, -1), np.stack([cloud] * 3, -1), sunv,
             np.stack([glass.astype(np.float32)] * 3, -1), np.clip(srgb(lightadd), 0, 1)]
    top = np.concatenate(tiles[:3], 1)
    bot = np.concatenate(tiles[3:], 1)
    Image.fromarray((np.concatenate([top, bot], 0) * 255).astype(np.uint8)).resize((W * 3 // 3, H * 2 // 3)).save(
        os.path.join(DBG, f"{base}_masks.jpg"), quality=85)
    side = np.concatenate([np.asarray(Image.open(SRC).convert("RGB")), o8], 1)
    Image.fromarray(side).resize((W, H // 2), Image.LANCZOS).save(os.path.join(DBG, f"{base}_compare.jpg"), quality=88)
    json.dump(rep, open(os.path.join(DBG, f"{base}_report.json"), "w"), indent=1)
print(json.dumps(rep))
