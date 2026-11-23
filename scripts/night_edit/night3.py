"""Day -> night for a game location picture, with the ship's own lights (round 3, 2026-11-16).

python -I night3.py <day.png> <out.png> [ann.json|-] [debug_dir]

What it does (after night_v1_recovered.py, the bridge-wing picture the user liked on 2026-11-15):
1. The outside: blue sky and sea, the clouds flooded into from the sky (stopped by hard edges), the sea's glitter under
   the horizon; its edge matted pixel by pixel with a two-colour model (the outside's local colour against the most
   different ship colour within 3 px), so thin rigging and rails keep their own colour and no cloud bleeds onto them.
2. The horizon (RANSAC on the sky -> sea step) and the elevation of every pixel (the renders' 70 deg vertical field).
3. Under deckheads ('covered' in the annotation) the sun's patches are taken off: per material (neutral paint, warm
   wood), a pixel far brighter than the local shade level of its own material is brought down to it, keeping its grain.
   On open decks the sun's shadows stay, as the moon's (day for night).
4. Moonlight grade: v1's curve (darker, desaturated, blue in shade, silver in the light).
5. The ship's own lights, only those the picture shows (annotation): lamps (a warm core, bloom, light on what is round
   them and a pool where it falls, lit through the de-sunned picture), window glass inside annotated zones lit from
   within, interiors seen through open doors kept lit, mast and side lights; a warm fill under covered decks from the
   lamps the camera does not see.
6. The night outside: the game's night palette by elevation, stars, clouds re-lit, the moon where the sun stood (the
   shadows then agree with it) with its path on the sea; the sea mirrors the night sky and keeps its waves.
7. Bloom from what glows, vignette, dither.

Annotation (json; all optional; picture pixels):
  covered: "all" | [polygon | [x0, y0, x1, y1], ...]     regions under a deckhead
  fill: float                                           warm light under covered decks from unseen lamps (0)
  sun: [x, y]   moon: [x, y] | false                    the sun in the frame -> the moon there (or set the moon)
  lamps: [{p: [x, y], k: ceiling|wall|post|point, r: px, s: strength, pool: [cx, cy, rx, ry], c: [r, g, b]}]
  zones: [rect | polygon]   dark: [...]   lit: [...]    window glass lit inside zones / left dark / always lit
  interior: [...]   interior_level: float               lit interiors seen through doors
  not_sky / sky: [...]                                  corrections to the outside
  horizon: [y_at_x0, y_at_xW]   horizon_y: float        the horizon when the picture's own is not found
  exposure: float   window_level: float
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
FOCAL = 771.0          # px: 70 deg vertical field of view on 1080 rows
MOON_D = 46            # moon diameter in px (as the game's sky draws it)
WARM = np.array([1.0, 0.60, 0.26], np.float32)      # lamp light (linear): warm incandescent
WIN_GLOW = np.array([1.0, 0.56, 0.21], np.float32)  # lit interior through glass (linear)
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)


def hexrgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255


def gblur(x, s):
    return cv2.GaussianBlur(x, (0, 0), s, borderType=cv2.BORDER_REFLECT)


def masked_blur(val, w, s):
    num = gblur(val * w, s)
    den = gblur(w, s)
    return num / np.maximum(den, 1e-6), den


def poly_mask(polys, H, W):
    m = np.zeros((H, W), np.uint8)
    for p in polys or []:
        if len(p) == 3 and not isinstance(p[0], (list, tuple)):          # a circle [x, y, r]
            cv2.circle(m, (int(round(p[0])), int(round(p[1]))), int(round(p[2])), 1, -1)
        elif len(p) == 4 and not isinstance(p[0], (list, tuple)):
            x0, y0, x1, y1 = (int(round(v)) for v in p)
            m[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = 1
        else:
            cv2.fillPoly(m, [np.array(p, np.int32)], 1)
    return m > 0


def shifted(a, dy, dx):
    """a shifted by (dy, dx) with edge replication."""
    H, W = a.shape[:2]
    ys = np.clip(np.arange(H) - dy, 0, H - 1)
    xs = np.clip(np.arange(W) - dx, 0, W - 1)
    return a[ys][:, xs]


# ============================================================================== load
im = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32) / 255
H, W = im.shape[:2]
r, g, b = im[..., 0], im[..., 1], im[..., 2]
Ys = 0.299 * r + 0.587 * g + 0.114 * b
mx, mn = im.max(2), im.min(2)
sat = (mx - mn) / np.maximum(mx, 1e-6)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
rep = {"src": os.path.basename(SRC)}
zones = poly_mask(ANN.get("zones"), H, W)
litp = poly_mask(ANN.get("lit"), H, W)

# ============================================================================== 1. the outside (first pass)
gm = cv2.morphologyEx(Ys, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
# hard edges: a step in brightness, or in hue (a grey-blue crow's nest against the hazy sky round the sun differs little
# in brightness but much in green-over-red)
k3 = np.ones((3, 3), np.uint8)
hard = (gm > float(ANN.get("hard", 0.09))) | (cv2.morphologyEx(g - r, cv2.MORPH_GRADIENT, k3) > 0.08)     | (cv2.morphologyEx(b - r, cv2.MORPH_GRADIENT, k3) > 0.10)
# sky and sea hold green well over red (sky g-r 0.2, sea 0.13, the milky horizon 0.05); grey-blue paint in shade, a black
# funnel seen through the sun's haze and window glass mostly do not (g-r 0.02-0.03)
blue = ((b - r) > 0.10) & ((g - r) > 0.05) & (sat > 0.12) & (b > 0.30)
cloudlike = (Ys > 0.50) & (sat < 0.30) & ((b - r) > -0.012)


def flood(seed, allowed):
    return ndi.binary_propagation(seed, mask=allowed | seed)


lab, n = ndi.label(blue)
sizes = ndi.sum(blue, lab, range(1, n + 1)) if n else np.zeros(0)
touch = np.zeros(n + 1, bool)
for edge in (lab[0, :], lab[:, 0], lab[:, -1]):
    touch[np.unique(edge)] = True
keep = np.zeros(n + 1, bool)
for i in range(1, n + 1):
    keep[i] = sizes[i - 1] >= 8000 or (touch[i] and sizes[i - 1] >= 400)
# small patches of sky between members (a platform's braces, a rail's bars): blue parts whose colour is the clear sky's at
# their own height, as the big parts show it
big = keep[lab]
if big.any() and n:
    rows_ = np.arange(H)
    cntb = np.bincount(yy[big].astype(int), minlength=H)
    okr = cntb > 20
    if okr.sum() >= 2:
        rowcol = np.stack([np.interp(rows_, rows_[okr], (np.bincount(yy[big].astype(int), weights=im[..., k][big], minlength=H)[okr] /
                                                             cntb[okr])) for k in range(3)], 1)
        cm = np.stack([ndi.mean(im[..., k], lab, range(1, n + 1)) for k in range(3)], 1)
        cy_ = ndi.mean(yy, lab, range(1, n + 1))
        for i in range(1, n + 1):
            if not keep[i] and sizes[i - 1] >= 30:
                ref = rowcol[int(np.clip(cy_[i - 1], 0, H - 1))]
                keep[i] = float(np.abs(cm[i - 1] - ref).max()) < 0.06
seed = keep[lab] & ~zones & ~litp
outside = flood(seed, cloudlike & ~hard & ~zones & ~litp)
cand = ((b - r) > 0.06) & ((g - r) > 0.04) & ~hard
outside |= flood(outside, cand & ndi.binary_dilation(outside, iterations=10))

# ============================================================================== 2. horizon
hp = []
core = ndi.binary_erosion(outside, iterations=4)
for x in range(2, W - 2, 3):
    rows = np.nonzero(core[:, x])[0]
    if len(rows) < 16:
        continue
    for run in np.split(rows, np.nonzero(np.diff(rows) > 1)[0] + 1):
        if len(run) < 16:
            continue
        d = np.diff(Ys[run, x])
        k = int(np.argmin(d))
        if d[k] < -0.035 and 3 < k < len(run) - 4:
            below = im[run[min(len(run) - 1, k + 4)], x]
            if below[2] - below[0] > 0.18 and Ys[run[k + 2], x] < Ys[run[k - 1], x]:
                hp.append((x, run[k] + 0.5))
hp = np.array(hp, np.float64)
coef = None
if "horizon" in ANN:
    y0_, y1_ = ANN["horizon"]
    coef = np.array([(y1_ - y0_) / W, y0_])
elif len(hp) >= 12:
    best, bestn = None, 0
    for _ in range(500):
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
        coef = np.linalg.lstsq(np.c_[hp[inl, 0], np.ones(inl.sum())], hp[inl, 1], rcond=None)[0]
        rep["horizon_pts"] = [int(inl.sum()), len(hp)]
if coef is None:
    coef = np.array([0.0, float(ANN.get("horizon_y", H * 0.62))])
    rep["horizon_pts"] = "assumed"
hy = coef[0] * xx + coef[1]
rep["horizon"] = [round(float(coef[1]), 1), round(float(coef[0] * W + coef[1]), 1)]
elev = np.degrees(np.arctan((H / 2 - yy) / FOCAL) - np.arctan((H / 2 - hy) / FOCAL))

# under the horizon the sea also takes its glitter (light blue-white): flooded from the sea, stopped by hard edges
below = yy > hy + 1
# the sea seen between rail bars and stanchions: small blue parts wholly under the horizon
labs, ns = ndi.label(blue & below & ~zones & ~litp)
if ns:
    szs = ndi.sum(np.ones_like(Ys), labs, range(1, ns + 1))
    oks = np.zeros(ns + 1, bool)
    oks[1:] = szs >= 30
    outside |= oks[labs]
# sky seen through a structure's gaps where the annotation says so (cells between a platform's braces)
sc_ = poly_mask(ANN.get("sky_cand"), H, W)
if sc_.any():
    outside |= sc_ & (cloudlike | blue | (((b - r) > 0.06) & ((g - r) > 0.03))) & ~hard
seaband = ndi.binary_dilation(outside & below & blue, iterations=40)
glit = below & seaband & ((b - r) > 0.10) & (sat > 0.12) & (Ys > 0.45) & ~hard & ~zones & ~litp
outside |= flood(outside & below, glit)
holes = ndi.binary_fill_holes(outside) & ~outside
hl, hn = ndi.label(holes)
if hn:
    hs = ndi.sum(np.ones_like(Ys), hl, range(1, hn + 1))
    hc = ndi.sum(cloudlike | blue, hl, range(1, hn + 1))
    fill = np.zeros(hn + 1, bool)
    fill[1:] = (hc / np.maximum(hs, 1) > 0.9) & (hs < 4000)
    outside |= fill[hl]
outside &= ~poly_mask(ANN.get("not_sky"), H, W) & ~zones & ~litp
outside |= poly_mask(ANN.get("sky"), H, W)

# ============================================================================== 1b. the edge, matted (two colours)
inner = ndi.binary_erosion(outside, iterations=2)
band = ndi.binary_dilation(outside, iterations=3) & ~inner
O, wO = masked_blur(im, inner.astype(np.float32)[..., None].repeat(3, -1), 4)
O = np.where(wO > 1e-3, O, im)
best_c = im.copy()
best_d = np.full((H, W), -1.0, np.float32)
ship = ~outside
for dy in range(-3, 4):
    for dx in range(-3, 4):
        c = shifted(im, dy, dx)
        okc = shifted(ship, dy, dx)
        dist = ((c - O) ** 2).sum(-1)
        upd = band & okc & (dist > best_d)
        best_d = np.where(upd, dist, best_d)
        best_c = np.where(upd[..., None], c, best_c)
F = best_c
den = np.maximum(((O - F) ** 2).sum(-1), 1e-4)
a2 = np.clip(((im - F) * (O - F)).sum(-1) / den, 0, 1)
a2 = np.where(best_d < 0.004, outside.astype(np.float32), a2)        # no contrast: keep the binary answer
alpha = np.where(inner, 1.0, np.where(band, a2, 0.0)).astype(np.float32)
fg = np.where((band & ~inner)[..., None], F, im)                      # the ship's own colour in the edge
rep["outside"] = round(float(alpha.mean()), 4)

sea_cov = np.clip(yy + 0.5 - hy, 0, 1)
sky_here = outside & (yy < hy - 1)
solid = alpha < 0.5

# ============================================================================== 3. the sun under deckheads
L = lin(fg)
Yd = L @ LUM
logY = np.log(np.maximum(Yd, 1e-4))
cov = np.zeros((H, W), bool)
cv_ann = ANN.get("covered")
if cv_ann == "all":
    cov[:] = True
elif cv_ann:
    cov = poly_mask(cv_ann, H, W)
cov &= solid
sunp = np.zeros((H, W), np.float32)
shiftlog = np.zeros((H, W), np.float32)
if cov.any():
    u = np.log(np.maximum(L[..., 0], 1e-4) / np.maximum(L[..., 1], 1e-4))
    w = np.log(np.maximum(L[..., 2], 1e-4) / np.maximum(L[..., 1], 1e-4))
    usable = cov & (Yd > 0.004)
    classes = {"neutral": usable & (np.abs(u) < 0.12) & (np.abs(w) < 0.22),
               "warm": usable & (u > 0.12) & (w < -0.05)}
    for name, m in classes.items():
        if m.sum() < 500:
            continue
        mf = m.astype(np.float32)
        lvl, _ = masked_blur(logY, mf, 40)
        hi = m & (logY > lvl + 0.35)
        shade_m = m & ~hi
        gshade = float(logY[shade_m].mean()) if shade_m.any() else float(logY[m].mean())
        lvl2, d2 = masked_blur(logY, shade_m.astype(np.float32), 90)
        lvl2 = np.where(d2 > 0.03, lvl2, gshade)
        hi = m & (logY > lvl2 + 0.35)
        lvl2, d2 = masked_blur(logY, (m & ~hi).astype(np.float32), 90)
        lvl2 = np.where(d2 > 0.03, lvl2, gshade)
        ex = logY - lvl2
        p = np.clip((ex - np.log(1.8)) / 0.25, 0, 1) * m                # clearly brighter than its shade: sun
        # the patch's own level, so its grain is kept when it is brought down
        pl, pd = masked_blur(logY, (p > 0.5).astype(np.float32), 6)
        sh = np.where(pd > 0.05, pl - lvl2, ex)
        sunp = np.maximum(sunp, p)
        shiftlog = np.where(m, np.maximum(shiftlog, p * np.clip(sh, 0, 3.5)), shiftlog)
    sunp = np.clip(cv2.GaussianBlur(sunp, (0, 0), 1.2), 0, 1)
    rep["sun_patches_px"] = int((sunp > 0.5).sum())
relit = L * np.exp(-shiftlog)[..., None]
Yr = relit @ LUM

# ============================================================================== 4. moonlight grade (v1's curve)
EXPO = float(ANN.get("exposure", 1.0))
Yn = (0.30 * np.power(Yr, 1.45) + 0.0022) * EXPO
tt = np.clip(Yn / 0.11, 0, 1)[..., None]
keepc = 0.22 + 0.16 * tt
desat = Yr[..., None] + (relit - Yr[..., None]) * keepc
tint = (1 - tt) * np.array([0.717, 1.004, 1.793], np.float32) + tt * np.array([0.869, 1.010, 1.293], np.float32)
night = desat * (Yn / np.maximum(Yr, 1e-5))[..., None] * tint

# the de-sunned picture as the albedo the ship's own lights fall on (normalised, a little desaturated)
alb = relit / max(float(np.percentile(Yr[solid], 99.0)), 1e-3)
alb = (alb @ LUM)[..., None] * 0.25 + alb * 0.75
emis = np.zeros((H, W, 3), np.float32)
lightadd = np.zeros((H, W, 3), np.float32)

# ============================================================================== 5. the ship's own lights
covf = gblur(cov.astype(np.float32), 25)
FILL = float(ANN.get("fill", 0.0))
if FILL > 0:
    lightadd += WARM * (FILL * 0.025 * covf)[..., None]

glass = np.zeros((H, W), bool)
if zones.any():
    brown = (r > g + 0.02) & (g > b) & (sat > 0.30)
    # glass is dark against the paint round it: the wall's level from its neutral pixels nearby (a wall in shade sets a
    # low level, so its own shade is not taken for glass)
    neutral = zones & (sat < 0.20) & (Ys > 0.12)
    wall, wd = masked_blur(Ys, neutral.astype(np.float32), 30)
    wall = np.where(wd > 0.02, wall, 0.8)
    darkg = (Ys < float(ANN.get("glass_max", 0.40))) & (Ys < 0.66 * wall) & ((b - r) > 0.015) & (sat < 0.80)
    blueg = ((b - r) > 0.20) & (sat > 0.35) & ((g - r) > 0.08) & (Ys < 0.80)        # light-blue glass, not blue-grey shade
    g_c = zones & (darkg | blueg) & ~brown
    fine = poly_mask(ANN.get("zones_fine"), H, W)
    g_c = (ndi.binary_opening(g_c & ~fine, iterations=1)) | (g_c & fine)
    zin = ndi.binary_erosion(zones, iterations=2)
    gl, gn = ndi.label(g_c)
    if gn:
        idx = range(1, gn + 1)
        gsz = ndi.sum(g_c, gl, idx)
        gin = ndi.sum(zin, gl, idx)
        okk = np.zeros(gn + 1, bool)
        zarea = float(zones.sum())
        for i, (sz, inn) in enumerate(zip(gsz, gin), 1):
            sl = ndi.find_objects((gl == i).astype(np.uint8))[0] if sz > 4000 else None
            fill_r = 1.0
            if sl is not None:
                bh, bw = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
                fill_r = sz / max(bh * bw, 1)
            okk[i] = sz >= 4 and inn >= 0.97 * sz and sz < 0.70 * zarea and fill_r > 0.35
        glass = okk[gl]
    # the panes inside a frame (mahogany, teak, brass): whatever enclosed by the frame looks like glass (bluish, or dark),
    # so frosted or sun-struck panes are lit whole, not in specks; white muntins (neutral and bright) stay unlit
    frame = brown & zones
    panes = ndi.binary_fill_holes(frame) & ~frame & zones
    glass_like = ((b - r) > 0.03) | (Ys < 0.40)
    muntin = (Ys > 0.72) & (np.abs(b - r) < 0.035) & (sat < 0.12)
    panes &= glass_like & ~muntin
    panes = ndi.binary_opening(panes, iterations=1)
    pl_, pn_ = ndi.label(panes)
    if pn_:
        idx = range(1, pn_ + 1)
        psz = ndi.sum(panes, pl_, idx)
        pin = ndi.sum(zin, pl_, idx)
        okp = np.zeros(pn_ + 1, bool)
        okp[1:] = (psz >= 25) & (pin >= 0.97 * psz)
        glass |= okp[pl_]
glass |= litp
glass &= ~poly_mask(ANN.get("dark"), H, W)
if glass.any():
    gsoft = np.clip(cv2.GaussianBlur(glass.astype(np.float32), (0, 0), 0.7), 0, 1)
    gsoft = np.maximum(gsoft, glass.astype(np.float32))
    tex = np.clip(Ys / max(float(np.percentile(Ys[glass], 90)), 0.05), 0.35, 1.3)
    gl2, gn2 = ndi.label(glass)
    per = rng.uniform(0.70, 1.10, gn2 + 1).astype(np.float32)          # each window its own brightness
    var = per[gl2]
    var = np.where(glass, var, gblur(var, 2))
    WL = float(ANN.get("window_level", 1.0))
    glow = WIN_GLOW * ((0.42 + 0.18 * tex) * var * WL)[..., None]
    night = night * (1 - gsoft[..., None]) + glow * gsoft[..., None]
    emis += glow * gsoft[..., None] * 0.55
    spill = gblur(gsoft, 6) * 0.8 + gblur(gsoft, 26) * 0.45
    lightadd += WIN_GLOW * (0.10 * WL * spill)[..., None] * (1 - gsoft[..., None])
rep["glass_px"] = int(glass.sum())

inter = poly_mask(ANN.get("interior"), H, W)
if inter.any():
    isoft = gblur(inter.astype(np.float32), 1.0)
    warm_int = lin(im) * np.array([1.0, 0.80, 0.56], np.float32) * float(ANN.get("interior_level", 0.55))
    night = night * (1 - isoft[..., None]) + warm_int * isoft[..., None]
    lightadd += WIN_GLOW * (0.10 * gblur(isoft, 45))[..., None] * (1 - isoft[..., None])

EYE = float(ANN.get("eye", 1.6))                       # the camera's height over the deck it stands on (m)
LAMP_H = {"ceiling": 2.6, "wall": 2.0, "post": 2.4}     # a lamp's height over the deck (m), by kind
POOL_M = {"ceiling": 1.6, "wall": 1.4, "post": 2.0}     # the radius of the pool it throws on the deck (m)
pools = []
for lp in ANN.get("lamps", []):
    x0, y0 = lp["p"]
    kind = lp.get("k", "wall")
    s = float(lp.get("s", 1.0))
    col = np.array(lp["c"], np.float32) if "c" in lp else WARM
    d = np.hypot(xx - x0, yy - y0)
    # where the lamp's light falls, from the horizon: a lamp h over the deck seen (hy - y) px above the horizon stands
    # Z = f (h - eye) / (hy - y) m away; the deck under it is (hy - y) eye / (h - eye) px under the horizon
    hyl = float(coef[0] * x0 + coef[1])
    hab = float(lp.get("h", LAMP_H.get(kind, 2.0))) - EYE
    Z = FOCAL * hab / (hyl - y0) if (kind in LAMP_H and hab > 0.05 and hyl - y0 > 4) else None
    R = float(lp.get("r", FOCAL * 0.65 / Z if Z else 34))
    core = max(1.6, min(R * 0.05, 9.0)) * float(lp.get("core", 1.0))
    if "lens" in lp:
        lm = np.clip((float(lp["lens"]) + 0.5 - d) / 1.0, 0, 1)
        lglow = col * (s * (0.55 + 0.45 * np.clip(1 - d / max(float(lp["lens"]), 1), 0, 1)))[..., None]
        night = night * (1 - lm[..., None]) + lglow * lm[..., None]
        emis += lglow * lm[..., None] * 0.5
    emis += col * (s * 1.4 * np.exp(-(d / core) ** 2))[..., None]
    emis += col * (s * 0.12 * np.exp(-d / (core * 4)))[..., None]
    if kind == "point":
        continue
    near = s * 0.42 * np.exp(-(d / R) ** 2 * 1.6)
    if "pool" in lp:
        cx, cy, rx, ry = lp["pool"]
    elif Z:
        cy = hyl + (hyl - y0) * EYE / hab
        rx = FOCAL * POOL_M[kind] / Z
        cx, ry = x0, max(rx * EYE / Z, 0.18 * rx)
    else:
        cx, cy, rx, ry = x0, y0 + 2.2 * R, 1.8 * R, 0.9 * R
    pools.append([round(float(v), 1) for v in (x0, y0, cx, cy, rx, ry, R)])
    pool = s * 0.95 * np.exp(-(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2) * 1.8)
    lightadd += col * (near + pool)[..., None]
rep["pools"] = pools
night = night + alb * lightadd * (1 - gsoft[..., None] if glass.any() else 1.0)
rep["lamps"] = len(ANN.get("lamps", []))

# ============================================================================== 6. the night outside
pal = np.stack([hexrgb(h) for h in NIGHT])
tz = np.clip(elev / 90.0, 0, 1)
pos = (1 - tz) * (len(NIGHT) - 1)
i0 = np.clip(np.floor(pos).astype(int), 0, len(NIGHT) - 2)
f = (pos - i0)[..., None]
sky = lin(pal[i0] * (1 - f) + pal[i0 + 1] * f)

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
        cloudlum = np.where(sreg, (lin(im) @ LUM) / max(float(np.percentile((lin(im) @ LUM)[sreg], 99.7)), 1e-4), 0).astype(np.float32)
SUN = ANN.get("sun")
if SUN is not None:
    dsun = np.hypot(xx - SUN[0], yy - SUN[1])
    ray_zone = np.exp(-dsun / 420.0)
    cloud = cloud * (1 - 0.85 * ray_zone) - 0.15 * ray_zone
cloud = np.clip((cloud - 0.14) / 0.86, 0, 1)
edge_d = ndi.distance_transform_edt(np.pad(outside, ((1, 0), (1, 1)), constant_values=True))[1:, 1:-1]
cloud = gblur(cloud, 0.7) * np.clip((edge_d - 2) / 10.0, 0, 1)

MOONP = ANN.get("moon", SUN)
R = MOON_D / 2
if MOONP:
    mx_, my_ = MOONP
    dm = np.hypot(xx - mx_, yy - my_)
    sky = sky + (0.018 * np.exp(-dm / 230.0))[..., None] * np.array([0.80, 0.90, 1.0], np.float32) \
        + (0.060 * np.exp(-np.maximum(dm - R, 0) / 22.0))[..., None] * np.array([1.0, 0.93, 0.80], np.float32)
else:
    mx_, my_ = -9999.0, -9999.0
    dm = np.full((H, W), 1e6, np.float32)

NS = 2600
sx, sy = rng.uniform(0, W, NS), rng.uniform(0, H, NS)
mag = rng.uniform(0, 1, NS) ** 3.2
amp = 0.006 + 0.22 * mag
temp = rng.uniform(0, 1, NS)
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
    x0_, y0_ = int(round(mx_ - R)), int(round(my_ - R))
    xa, ya, xb, yb = max(0, x0_), max(0, y0_), min(W, x0_ + MOON_D), min(H, y0_ + MOON_D)
    if xb > xa and yb > ya:
        ms_, mr_ = ma[ya - y0_:yb - y0_, xa - x0_:xb - x0_, 3:], mrgb[ya - y0_:yb - y0_, xa - x0_:xb - x0_]
        sky[ya:yb, xa:xb] = sky[ya:yb, xa:xb] * (1 - ms_) + mr_ * ms_
near_m = np.exp(-dm / 230.0)[..., None]
tight = np.exp(-np.maximum(dm - R, 0) / 60.0)[..., None]
cl = sky * 0.75 + (0.0045 + 0.030 * near_m + 0.16 * tight) * (0.55 + 0.6 * cloudlum[..., None]) * np.array([0.88, 0.93, 1.0], np.float32)
sky = sky * (1 - 0.9 * cloud[..., None]) + cl * (0.9 * cloud[..., None])

dep = np.clip(-elev, 0.0, 89.0)
fres = 0.02 + 0.98 * (1 - np.sin(np.radians(dep))) ** 5
pos_m = (1 - np.clip(dep / 90, 0, 1)) * (len(NIGHT) - 1)
j0 = np.clip(np.floor(pos_m).astype(int), 0, len(NIGHT) - 2)
fm = (pos_m - j0)[..., None]
mirror = lin(pal[j0] * (1 - fm) + pal[j0 + 1] * fm)
Yday = lin(im) @ LUM
tex = np.zeros_like(Yday)
s_ = (sea_cov > 0.5) & outside
if s_.any():
    blur_ = gblur(np.where(s_, Yday, 0), 6) / np.maximum(gblur(s_.astype(np.float32), 6), 1e-3)
    tex[s_] = np.clip((Yday[s_] - blur_[s_]) / np.maximum(blur_[s_], 1e-3), -1, 1.5)
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
    width = 14 + 0.45 * pb
    colm = np.exp(-((xx - mx_) / width) ** 2)
    glint = np.clip(wave - 0.3, 0, None) ** 2 + 2.0 * np.clip(tex * 4, 0, 2)
    path = colm * (0.006 + 0.022 * glint) * np.exp(-pb / 600.0) * np.clip(pb / 3.0, 0, 1)
    sea = sea + path[..., None] * np.array([0.95, 0.92, 0.85], np.float32)
outside_rgb = sky * (1 - sea_cov[..., None]) + sea * sea_cov[..., None]
out = night * (1 - alpha[..., None]) + outside_rgb * alpha[..., None]

# ============================================================================== 7. bloom, vignette, dither
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
    tiles = [np.stack([alpha] * 3, -1), np.stack([sea_cov * alpha] * 3, -1), np.stack([cloud] * 3, -1),
             np.stack([sunp, cov.astype(np.float32), np.clip(shiftlog / 2, 0, 1)], -1),
             np.stack([glass.astype(np.float32)] * 3, -1), np.clip(srgb(lightadd), 0, 1)]
    top = np.concatenate(tiles[:3], 1)
    bot = np.concatenate(tiles[3:], 1)
    Image.fromarray((np.concatenate([top, bot], 0) * 255).astype(np.uint8)).resize((W, H * 2 // 3)).save(
        os.path.join(DBG, f"{base}_masks.jpg"), quality=85)
    side = np.concatenate([np.asarray(Image.open(SRC).convert("RGB")), o8], 1)
    Image.fromarray(side).resize((W, H // 2), Image.LANCZOS).save(os.path.join(DBG, f"{base}_compare.jpg"), quality=88)
    json.dump(rep, open(os.path.join(DBG, f"{base}_report.json"), "w"), indent=1)
print(json.dumps(rep))
