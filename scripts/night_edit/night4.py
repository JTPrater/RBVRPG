"""Day -> night for a game location picture, the ship's own lights worked in 3D (round 4, 2026-11-16).

python -I night4.py <day.png> <out.png> [ann.json|-] [debug_dir] [disp.npy]
TOD=twilight python -I night4.py ...   the sunrise/sunset set instead (2026-11-17: one set for both, from the same
analysis: the light recoloured for a sun a few degrees up, a sunset sky, clouds and sea, the ship's lights faint)

Round 4 over round 3 (night3.py): the picture's depth (depth.py: Depth Anything V2 Small, calibrated here on the deck
plane through light3d.Scene) gives every pixel a place and a facing, so the lamps' and the lit windows' light falls off
with distance, follows the surfaces' slope and is shadowed by what stands in the way; the moonlight is darker and softer.

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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import light3d  # noqa: E402
import ports  # noqa: E402
import sam_rules  # noqa: E402

SRC, DST = sys.argv[1], sys.argv[2]
ANN = json.load(open(sys.argv[3])) if len(sys.argv) > 3 and sys.argv[3] not in ("", "-") else {}
DBG = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] not in ("", "-") else None
DISP = sys.argv[5] if len(sys.argv) > 5 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "work", "depth",
                                                          os.path.splitext(os.path.basename(SRC))[0] + ".disp.npy")
HERE = os.path.dirname(os.path.abspath(__file__))
MOON = os.path.join(HERE, "..", "..", "public", "images", "moon phase", "full.webp")
rng = np.random.default_rng(1915)

NIGHT = ["#04070e", "#080d18", "#0d1422", "#141c2c", "#1e2836"]     # game.js SKY_PALETTES.night, zenith -> horizon
FOCAL = 771.0          # px: 70 deg vertical field of view on 1080 rows
MOON_D = 46            # moon diameter in px (as the game's sky draws it)
WARM = np.array([1.0, 0.60, 0.26], np.float32)      # lamp light (linear): warm incandescent
WIN_GLOW = np.array([1.0, 0.56, 0.21], np.float32)  # lit interior through glass (linear)
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)

# 2026-11-17 the user: "do sunset/sunrise (id just do a universal one for that). make sure you THOROUGHLY analyze every
# aspect of those images". TOD=twilight renders that one set from the same analysis (outside, horizon, depth, windows,
# lamps): the day's light split into the sun's and the sky's and each recoloured for a sun a few degrees up; the sky,
# its clouds and the sea re-made for it; the ship's lights on but faint (they are coming on, or going off)
TOD = os.environ.get("TOD", "night")
# PLATE=1 (2026-11-17): the outside only, the ship taken away: the sky with the day picture's own clouds (filled in where
# the ship hid them) and the sea with its own waves, relit as the night or sunset version; for the Blender model's renders
# to stand in front of (the user: the Blender sea looked "so big ... unnatural" and its sky had "zero clouds")
PLATE = os.environ.get("PLATE") == "1"
TWI = TOD == "twilight"
TWI_SKY = ["#3a5585", "#5d6d99", "#9a85a2", "#e09a78", "#f7b56c"]   # zenith -> horizon (the game's ms-1/ms-2)
SUN_TW = np.array([1.0, 0.50, 0.17], np.float32) * 1.00              # the low sun's direct light (linear)
SKY_TW = np.array([0.36, 0.40, 0.72], np.float32) * 0.25             # the dusk sky's light in shade
SUN_DAY = np.array([1.0, 1.0, 1.0], np.float32)                      # the day's, as the renders show it
SKY_DAY = np.array([0.85, 0.95, 1.15], np.float32) * 0.33
TWI_LIGHTS = 0.40                                                   # the ship's lights, against the night's


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
        elif len(p) == 5 and not isinstance(p[0], (list, tuple)):        # an ellipse [x, y, rx, ry, angle deg]
            cv2.ellipse(m, (int(round(p[0])), int(round(p[1]))), (int(round(p[2])), int(round(p[3]))), float(p[4]), 0, 360, 1, -1)
        elif len(p) == 4 and not isinstance(p[0], (list, tuple)):
            x0, y0, x1, y1 = (int(round(v)) for v in p)
            m[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = 1
        else:
            cv2.fillPoly(m, [np.array(p, np.int32)], 1)
    return m > 0


def fill_behind(a, known, fade_px=70.0):
    """A field (clouds, wave texture) carried on behind the ship: the mean of what the picture shows round it (a weighted
    blur at three scales, the nearest first), fading to nothing with distance from it, so no streak or cut shows where
    the field was never seen."""
    k = known.astype(np.float32)
    out = np.zeros_like(a, np.float32)
    got = np.zeros_like(a, np.float32)
    for sig in (6.0, 24.0, 80.0):
        num = gblur(a * k, sig)
        den = gblur(k, sig)
        v = num / np.maximum(den, 1e-6)
        w = np.clip(den * 4.0, 0, 1) * (1 - got)
        out += v * w
        got += w
    d = ndi.distance_transform_edt(~known)
    filled = out * np.exp(-d / fade_px)
    return np.where(known, a, filled).astype(np.float32)


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
# SAM 2.1's regions of the picture (sam_seg.py), when made: glass and sky are then decided region by region
SAMP = os.path.join(HERE, "work", "sam", os.path.splitext(os.path.basename(SRC))[0] + ".sam.png")
SAM = sam_rules.load(SAMP, H, W) if (os.environ.get("USE_SAM") == "1" and os.path.exists(SAMP)) else None      # (off: see study/patch_r24.py)
rep["sam"] = SAM is not None
zones = poly_mask(ANN.get("zones"), H, W)
litp = poly_mask(ANN.get("lit"), H, W)
intp = poly_mask(ANN.get("interior"), H, W)            # lit rooms seen through doors: never sky (blue upholstery, carpets)
disp = np.load(DISP) if os.path.exists(DISP) else None
if disp is not None:
    # what the depth model puts at the sky's zero and is sky or sea coloured is the outside, whatever an annotation drew
    # over it: no window zone, lit shape or interior may claim it (it would block the night sky there and light it as glass)
    real_out = (disp < 0.05) & ((b - r) > 0.08) & ((g - r) > 0.06)
    rep["ann_real_sky_px"] = int(((zones | litp | intp) & real_out).sum())
    zones &= ~real_out
    litp &= ~real_out
    intp &= ~real_out
# round windows (ports.py, 2026-11-17): each fitted to its own glass, lit as a cabin ("on"), as a door to a lit room
# ("room"), or left dark ("off": a door standing open); their glass is never sky, whatever it mirrors
PM, PRHO, PTY, PLVL, rep["ports"] = ports.port_masks(im, ANN.get("ports"), H, W, seed=len(os.path.basename(SRC)))
port_any = (PM["on"] + PM["room"] + PM["off"]) > 0.35
litg = litp.copy()                       # lit glass drawn as rectangles and polygons
litp = litp | port_any                   # never sky

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
# sky seen through the glass of windows and screens, too small or pale for the tests above: clear sky blue (blue well over
# green, green over red, bright), not the teal of upholstery or the grey-blue of paint in shade
if n:
    cm2 = np.stack([ndi.mean(im[..., k], lab, range(1, n + 1)) for k in range(3)], 1)
    ys2 = cm2 @ np.array([0.299, 0.587, 0.114])
    for i in range(1, n + 1):
        if not keep[i] and sizes[i - 1] >= 20:
            cr, cg, cb = cm2[i - 1]
            keep[i] = (cb - cr) > 0.15 and (cg - cr) > 0.06 and (cb - cg) > 0.06 and ys2[i - 1] > 0.42
seed = keep[lab] & ~zones & ~litp & ~intp
outside = flood(seed, cloudlike & ~hard & ~zones & ~litp & ~intp)
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
        if n_in > bestn and abs(a) < 0.03:          # the camera does not roll: the horizon is near level (seen 0.003-0.015)
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
noann = ~zones & ~litp & ~intp
# sea colour: blue and green over red (the sea's teal), saturated; it takes in the dark troughs of the near waves, which
# fail the sky's brightness test (the sea's darkest pixels read b 0.2-0.3)
seacol = ((b - r) > 0.07) & ((g - r) > 0.04) & ((b - g) > 0.02) & (sat > 0.30)
seadeep = seacol & (Ys < 0.50) & (sat > 0.40)          # plain sea: not glitter, not the light blue of sky in a window
# the sea seen between rail bars and stanchions: small parts wholly under the horizon, deep sea coloured
labs, ns = ndi.label(seadeep & below & noann)
if ns:
    szs = ndi.sum(np.ones_like(Ys), labs, range(1, ns + 1))
    oks = np.zeros(ns + 1, bool)
    oks[1:] = szs >= 30
    outside |= oks[labs]
# sky seen through a structure's gaps where the annotation says so (cells between a platform's braces)
sc_ = poly_mask(ANN.get("sky_cand"), H, W)
if sc_.any():
    outside |= sc_ & (cloudlike | blue | (((b - r) > 0.06) & ((g - r) > 0.03))) & ~hard
# the near waves' troughs: flooded from the sea through sea colour, across the waves' own edges
outside |= flood(outside & below, seacol & below & noann)
seaband = ndi.binary_dilation(outside & below & blue, iterations=40)
glit = below & seaband & ((b - r) > 0.10) & (sat > 0.12) & (Ys > 0.45) & ~hard & ~zones & ~litp
outside |= flood(outside & below, glit)
holes = ndi.binary_fill_holes(outside) & ~outside
hl, hn = ndi.label(holes)
if hn:
    hs = ndi.sum(np.ones_like(Ys), hl, range(1, hn + 1))
    hc = ndi.sum(cloudlike | blue | (seacol & below), hl, range(1, hn + 1))
    fill = np.zeros(hn + 1, bool)
    fill[1:] = (hc / np.maximum(hs, 1) > 0.9) & (hs < 4000)
    outside |= fill[hl]
if disp is not None:
    # above the horizon the depth decides: the model gives the sky (clouds too) exactly 0 and the ship's parts, however
    # far and however white (boats, davits, funnel tops against bright cloud), 0.3 or more
    SKY_D = float(ANN.get("sky_disp", 0.12))
    upper = yy < hy + 1.5
    clear_blue = ((b - r) > 0.10) & ((g - r) > 0.09) & (sat > 0.15)        # clear sky, as seen through a window too
    # through a window the model sees the glass: the blue sky round a white cloud there has the window's depth, not 0;
    # there the colour decides (no veto)
    cb = (clear_blue & outside & upper).astype(np.float32)
    lsd, lw = masked_blur(disp.astype(np.float32), cb, 60)
    THROUGH = bool(ANN.get("through_glass", bool(ANN.get("covered"))))
    windowed = (lw > 0.004) & (lsd > SKY_D) & (np.abs(disp - lsd) < 0.30 * np.maximum(disp, lsd) + 0.08)
    if not THROUGH:
        windowed[:] = False
    near_struct = upper & (disp > SKY_D) & ~clear_blue & ~windowed
    rep["sky_vetoed_px"] = int((outside & near_struct).sum())
    outside &= ~near_struct
    # and sky the colour flood missed (a cloud cut off by hard edges): depth 0, sky- or cloud-coloured
    # (not inside a lit room seen through a door: its white ceiling is cloud-coloured and the model often puts it at 0)
    cand_sky = (yy < hy - 1) & (disp <= 0.02) & (cloudlike | blue | (((b - r) > 0.04) & ((g - r) > 0.02))) & ~zones & ~litp & ~intp
    rep["sky_added_px"] = int((cand_sky & ~outside).sum())
    outside |= cand_sky
# below the horizon there is no cloud: what is not blue there (a white hatch top, a grey roof, a boat seen against the
# sea) is ship, however it got in (a flood through a soft edge, a filled hole)
below_h = yy > hy + 1
seaish = ((b - r) > 0.05) & ((g - r) > 0.06) & (sat > 0.10)
rep["below_not_blue_px"] = int((outside & below_h & ~seaish).sum())
# (2026-11-17: but far and blue it is sea, however grey: a calm hazy sea reads g-r 0.06, on the test's edge, and pixel
# noise made a speckled dark island of it under a low sun)
far_sea = (disp < 0.25) & ((b - r) > 0.08) & (sat > 0.12) if disp is not None else np.zeros((H, W), bool)
# (a stay or a wire crossing the sea is blue-blended too: a thin line darker than the sea round it stays rigging)
far_sea &= ~((cv2.morphologyEx(Ys, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)) - Ys) > 0.025)
outside &= ~(below_h & ~seaish & ~far_sea)
if disp is not None:
    # and the ship stands up out of the sea: nearer than the sea at the same row of the picture. The sea's depth by row
    # from its plainest pixels (deep, saturated blue), smoothed; a pixel well nearer than that is ship
    sea_core = below_h & ((b - r) > 0.15) & (sat > 0.40) & (Ys < 0.55) & outside
    scl, scn = ndi.label(outside & below_h)
    if scn:
        at_h = np.unique(scl[(np.abs(yy - hy) < 4) & (scl > 0)])
        reach = np.zeros(scn + 1, bool)
        reach[at_h] = True
        sea_core &= reach[scl]
    rows_ = np.arange(H)
    cnt_ = np.bincount(yy[sea_core].astype(int), minlength=H)
    if sea_core.sum() > 800 and (cnt_ > 5).sum() > 20:
        p90 = np.zeros(H, np.float32)
        okr_ = cnt_ > 5
        for y_ in np.nonzero(okr_)[0]:
            p90[y_] = np.percentile(disp[y_][sea_core[y_]], 90)
        p90s = np.interp(rows_, rows_[okr_], ndi.maximum_filter1d(p90[okr_], 9))
        lim = np.maximum(0.6, 1.5 * p90s + 0.3)[:, None]
        nearer = below_h & (disp > lim)
        rep["sea_vetoed_px"] = int((outside & nearer).sum())
        outside &= ~nearer
outside &= ~poly_mask(ANN.get("not_sky"), H, W) & ~zones & ~litp & ~intp
# 2026-11-17: a lit room's far windows (seen through its door) show the night, its walls and ceiling stay the room: in an
# interior only light sky blue is the outside; a "sky" annotation marks where to look and takes its sky-coloured pixels
# only (the whole box pasted flat night over the room's back wall)
skyish = ((b - r) > 0.05) & ((b - g) > -0.01) & (Ys > 0.22) & (sat > 0.10)
lightsky = ((b - r) > 0.18) & ((b - g) > 0.08) & (Ys > 0.45)
outside |= poly_mask(ANN.get("sky"), H, W) & skyish
outside |= intp & lightsky
# 2026-11-17: the horizon line itself. The far sea there reads a little nearer than the sky to the depth model (0.1-0.2),
# so the sky's depth veto took a sliver of it for ship: a dark island under a low sun. Sea coloured and far (the ship's
# own parts there read several), it is the outside
if disp is not None:
    hzb = (np.abs(yy - hy) < 4.0) & (seaish | far_sea) & (disp < 0.30) & ~zones & ~litp & ~intp
    rep["horizon_sea_px"] = int((hzb & ~outside).sum())
    outside |= hzb
if SAM is not None:
    # a region that is mostly ship (a deckhead panel, a wall in blue shade) takes back the sky that crept into it
    skycol_ = ((b - r) > 0.10) & ((g - r) > 0.05) & (sat > 0.15)
    near_ = (disp > 0.30) if disp is not None else np.ones((H, W), bool)
    outside, rep["sam_sky_vetoed_px"] = sam_rules.veto_sky(SAM, outside, skycol_, near_)

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
# ---- 1c. 2026-11-17: thin rigging against the sky (stays, the rope ladders' rungs, wires): one or two pixels darker
# than the sky round them, so the flood took them (soft edges, the depth model's zero) and a sunset showed a ladder in
# scattered dashes. Found as the dark residue of a small closing inside the sky, put back as dark rope, its coverage from
# how far it falls below the sky round it
up_sky = (alpha > 0.5) & (yy < hy - 1)
rep["rigging_px"] = 0
if up_sky.sum() > 5000:
    clo = cv2.morphologyEx(Ys, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    bh = clo - Ys
    covl = np.clip(1.6 * (bh - 0.022) / np.maximum(clo - 0.10, 0.10), 0, 1)     # (thin wires are antialiased)
    covl = np.where(ndi.binary_dilation(up_sky, iterations=2) & (alpha > 0.3), covl, 0).astype(np.float32)
    lab_, nl_ = ndi.label(covl > 0.12)
    if nl_:
        sz_ = ndi.sum(np.ones_like(covl), lab_, range(1, nl_ + 1))
        okl = np.zeros(nl_ + 1, bool)
        okl[1:] = sz_ >= 8                                              # lines, not specks in a cloud
        covl = covl * ndi.binary_dilation(okl[lab_], iterations=1)
        mline = covl > 0.02
        fg = np.where(mline[..., None], np.array([0.11, 0.11, 0.12], np.float32), fg)
        alpha = np.where(mline, alpha * (1 - covl), alpha).astype(np.float32)
        rep["rigging_px"] = int((covl > 0.2).sum())
rep["outside"] = round(float(alpha.mean()), 4)
if DBG:
    # the ship's outline: the mask itself (white = sky and sea replaced, black = ship kept), for checking
    os.makedirs(DBG, exist_ok=True)
    Image.fromarray(np.clip(alpha * 255, 0, 255).astype(np.uint8)).save(
        os.path.join(DBG, os.path.splitext(os.path.basename(SRC))[0] + ".mask.png"))
    if os.environ.get("MASK_ONLY") == "1":
        print(json.dumps(rep))
        sys.exit(0)

# (2026-11-23) a window found by win6.py is the ship's, whatever the matte took it for (a pane that mirrors the sky is sky-blue)
_w5p = os.path.join(HERE, "work", os.environ.get("W5_DIR", "win6"), os.path.splitext(os.path.basename(SRC))[0] + ".w5.npz")
if os.environ.get("W5", "1") != "0" and os.path.exists(_w5p):
    _wa = np.load(_w5p)["alpha"].astype(np.float32) / 255.0
    if _wa.shape == alpha.shape:
        rep["w5_taken_from_matte_px"] = int(((alpha > 0.5) & (_wa > 0.5)).sum())
        alpha = (alpha * (1 - _wa)).astype(np.float32)
        outside = outside & (_wa < 0.5)
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
    # (2026-11-23) the classes: soft, read from the picture without its 8-bit grain; white paint's takes in its blue shade
    Lb_ = cv2.GaussianBlur(L, (0, 0), 1.5)
    u = np.log(np.maximum(Lb_[..., 0], 1e-4) / np.maximum(Lb_[..., 1], 1e-4))
    w = np.log(np.maximum(Lb_[..., 2], 1e-4) / np.maximum(Lb_[..., 1], 1e-4))
    usable = cov & (Yd > 0.004)

    def _ramp(x_, a_, b_):
        return np.clip((x_ - a_) / (b_ - a_), 0, 1)
    classes = {"neutral": (1 - _ramp(np.abs(u), 0.10, 0.16)) * (1 - _ramp(w, 0.42, 0.55)) * (1 - _ramp(-w, 0.18, 0.26)),
               "warm": _ramp(u, 0.10, 0.16) * _ramp(-w, 0.03, 0.08)}
    for name, wgt in classes.items():
        wgt = (wgt * usable).astype(np.float32)
        m = wgt > 0.5
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
        p = np.clip((ex - np.log(1.8)) / 0.25, 0, 1) * wgt              # clearly brighter than its shade: sun
        # the patch's own level, so its grain is kept when it is brought down
        pl, pd = masked_blur(logY, (p > 0.5).astype(np.float32), 6)
        sh = np.where(pd > 0.05, pl - lvl2, ex)
        sunp = np.maximum(sunp, p)
        shiftlog = np.maximum(shiftlog, p * np.clip(sh, 0, 3.5))
    sunp = np.clip(cv2.GaussianBlur(sunp, (0, 0), 1.2), 0, 1)
    rep["sun_patches_px"] = int((sunp > 0.5).sum())
# (at sunrise and sunset the sun's patches under a deckhead stay: a low sun reaches further in, not less)
relit = L * np.exp(-shiftlog)[..., None] if not TWI else L.copy()
Yr = relit @ LUM

# ============================================================================== 4. moonlight grade (v1's curve)
EXPO = float(ANN.get("exposure", 1.0))
if not TWI:
    Yn = (float(ANN.get("moon_gain", 0.20)) * np.power(Yr, float(ANN.get("moon_gamma", 1.30))) + 0.0024) * EXPO
    tt = np.clip(Yn / 0.11, 0, 1)[..., None]
    keepc = 0.22 + 0.16 * tt
    desat = Yr[..., None] + (relit - Yr[..., None]) * keepc
    tint = (1 - tt) * np.array([0.717, 1.004, 1.793], np.float32) + tt * np.array([0.869, 1.010, 1.293], np.float32)
    night = desat * (Yn / np.maximum(Yr, 1e-5))[..., None] * tint

# the de-sunned picture as the albedo the ship's own lights fall on (normalised, a little desaturated)
# the albedo the ship's own lights fall on, by material and not by how the sun found it (a deck in a deckhead's shade is
# as light a wood as a sunlit one): white paint 0.70, black paint 0.05, light wood 0.32, varnished wood 0.10, the rest
# 0.15; the colour and the grain (luminance over its local mean) from the de-sunned picture
uu0 = np.log(np.maximum(relit[..., 0], 1e-4) / np.maximum(relit[..., 1], 1e-4))
ww0 = np.log(np.maximum(relit[..., 2], 1e-4) / np.maximum(relit[..., 1], 1e-4))
# 2026-11-23: the albedo by MATERIAL, as it was until 2026-11-22 (so that decks and paint take the lamps' light as in the set
# the user called fine), without what made it speckle: soft classes read from a slightly smoothed picture, a ramp for
# bright / dark within a class, and white paint's class taking in its blue shade under a deckhead.
_Lb = cv2.GaussianBlur(relit, (0, 0), 1.5)
_ub = np.log(np.maximum(_Lb[..., 0], 1e-4) / np.maximum(_Lb[..., 1], 1e-4))
_wb = np.log(np.maximum(_Lb[..., 2], 1e-4) / np.maximum(_Lb[..., 1], 1e-4))


def _ramp01(x_, a_, b_):
    return np.clip((x_ - a_) / (b_ - a_), 0, 1)


_wn = (1 - _ramp01(np.abs(_ub), 0.10, 0.16)) * (1 - _ramp01(_wb, 0.42, 0.55)) * (1 - _ramp01(-_wb, 0.18, 0.26))     # paint, its blue shade too
_ww = _ramp01(_ub, 0.10, 0.16) * _ramp01(-_wb, 0.03, 0.08)                                                           # wood
_wo = np.clip(1 - _wn - _ww, 0, 1)
ref = 0.15 * _wo
for _wt, hi_, lo_ in ((_wn, 0.70, 0.05), (_ww, 0.32, 0.10)):
    mm = ((_wt > 0.5) & solid).astype(np.float32)
    if mm.sum() < 100:
        ref = ref + _wt * 0.15
        continue
    lvl_, ld_ = masked_blur(np.sqrt(np.maximum(Yr, 0)), mm, 60)      # a local level of the class (sqrt: robust)
    lvl_ = np.where(ld_ > 0.02, lvl_ ** 2, float(np.percentile(Yr[mm > 0.5], 80)))
    _br = _ramp01(Yr / np.maximum(lvl_, 1e-4), 0.22, 0.40)                                           # (was: bright if over 0.30 of the level)
    if hi_ > 0.5:
        # (2026-11-23 02:25) and white paint is never near black: a big black thing that falls in this class (a bollard, a
        # cowl, a stay: bluish black) was measured against its own level, came out "white" (0.70) and glowed grey and
        # mottled under the lamps and in the sunset's fill
        _br = _br * _ramp01(Yr, 0.012, 0.028)
    ref = ref + _wt * (lo_ + (hi_ - lo_) * _br)
ref = (ref / np.maximum(_wn + _ww + _wo, 1e-4)).astype(np.float32)
grain = np.clip(Yr / np.maximum(gblur(Yr, 6), 1e-4), 0.6, 1.5)
chrom = relit / np.maximum(Yr, 1e-4)[..., None]
chrom = (chrom @ LUM)[..., None] * 0.3 + chrom * 0.7
alb = (ref * grain)[..., None] * chrom
TWI_S = None
if TWI:
    # ---- 4t. sunrise/sunset: the day's light at each pixel is the picture over its material's albedo; well over the
    # sky's share it is the sun's. Each share is recoloured (day sun white -> low sun orange, day sky blue-white -> dusk
    # violet) as a ratio on the picture, so its texture, paint and shadows stay; decks (lit at a glance by a low sun)
    # take less of it than walls facing it
    # (2026-11-23) the sun's share as it was before 2026-11-22 (the user found the sunset pictures fine), its material classes
    # soft and read from a slightly smoothed picture (hard limits flipped from pixel to pixel)
    Lb_ = cv2.GaussianBlur(relit, (0, 0), 1.5)
    ub_ = np.log(np.maximum(Lb_[..., 0], 1e-4) / np.maximum(Lb_[..., 1], 1e-4))
    wb_ = np.log(np.maximum(Lb_[..., 2], 1e-4) / np.maximum(Lb_[..., 1], 1e-4))

    def _rmp(x_, a_, b_):
        return np.clip((x_ - a_) / (b_ - a_), 0, 1)
    wn_ = (1 - _rmp(np.abs(ub_), 0.09, 0.15)) * (1 - _rmp(np.abs(wb_), 0.17, 0.27))      # (was |u| < 0.12 and |w| < 0.22)
    ww_ = _rmp(ub_, 0.09, 0.15) * _rmp(-wb_, 0.02, 0.08)                                   # (was u > 0.12 and w < -0.05)
    wo_ = np.clip(1 - wn_ - ww_, 0, 1)
    ref_s = 0.15 * wo_
    for wt_, hi_, lo_ in ((wn_, 0.70, 0.05), (ww_, 0.32, 0.10)):
        mm = ((wt_ > 0.5) & solid).astype(np.float32)
        if mm.sum() < 100:
            ref_s = ref_s + wt_ * 0.15
            continue
        lvl_, ld_ = masked_blur(np.sqrt(np.maximum(Yr, 0)), mm, 60)
        lvl_ = np.where(ld_ > 0.02, lvl_ ** 2, float(np.percentile(Yr[mm > 0.5], 80)))
        ref_s = ref_s + wt_ * (lo_ + (hi_ - lo_) * _rmp(Yr / np.maximum(lvl_, 1e-4), 0.22, 0.40))    # (was: bright if over 0.30 of the level)
    ref_s = ref_s / np.maximum(wn_ + ww_ + wo_, 1e-4)
    grain_ = np.clip(Yr / np.maximum(gblur(Yr, 6), 1e-4), 0.6, 1.5)
    Ei = Yr / np.maximum(ref_s * grain_, 1e-4)
    s_ = np.clip((np.log(np.maximum(Ei, 1e-4)) - np.log(0.42)) / (np.log(0.95) - np.log(0.42)), 0, 1)
    s_ = s_ * s_ * (3 - 2 * s_)
    s_ = np.maximum(s_, sunp) if cov.any() else s_                      # a sun patch under a deckhead is sun
    wood_ = ((yy > hy + 25) & solid).astype(np.float32) * ww_            # deck planking seen from above
    s_ = s_ * (1 - 0.38 * wood_)
    s_ = gblur(s_.astype(np.float32), 0.8)
    # under a deckhead the share is evened out over each stretch (it changed from one face of a beam to the next: brown
    # and violet patchwork); everywhere it is smoothed within surfaces, the picture's own edges kept
    s_ = np.clip(light3d.guided(im.astype(np.float32), s_.astype(np.float32), 8, 4e-3), 0, 1)
    TWI_S = s_
    num = SUN_TW[None, None, :] * s_[..., None] + SKY_TW[None, None, :]
    den = SUN_DAY[None, None, :] * s_[..., None] + SKY_DAY[None, None, :]
    night = relit * (num / den) * float(ANN.get("twi_exposure", 1.0))   # ("exposure" is the night's: bridges 1.9)
    # a warmer, softer fill in the deepest shade (the low sky's glow reaches under things the high sky did not)
    night = night + alb * (0.010 * (1 - s_))[..., None] * np.array([1.0, 0.70, 0.62], np.float32)
    rep["twi_sun_share"] = round(float(s_[solid].mean()), 3) if solid.any() else 0.0
emis = np.zeros((H, W, 3), np.float32)
lightadd = np.zeros((H, W, 3), np.float32)

# ============================================================================== 5. the ship's own lights
covf = gblur(cov.astype(np.float32), 25)
LS = TWI_LIGHTS if TWI else 1.0                       # the ship's own lights' share (faint at sunrise/sunset)
FILL = float(ANN.get("fill", 0.0)) * LS
if FILL > 0:
    lightadd += WARM * (FILL * 0.025 * covf)[..., None]

glass = np.zeros((H, W), bool)
# ---- 5a. AUTO glass zones (2026-11-22; the user: "some of the windows dont have a light at all and makes it look weird").
# Glass was lit only inside the annotation's hand-drawn zones, so a window outside them (or in a picture with none) stayed
# dark. Every pane that is plainly glass by day now joins the zones: dark navy (the game's panes read 16-34, 28-50, 40-85 of
# 255), a compact patch on the ship and ringed by ship (the dark sea seen past a rail borders the outside, and is far more
# blue), not one of the round ports (they have their own rule). AUTO_GLASS=0 turns it off.
# Not on the bridge (its windows look OUT at the night and stay dark; the test run lit telegraph dials and the binnacle
# there), and a pane must be darker than what rings it (a window in a wall, not a patch inside something dark).
W5P = os.path.join(HERE, "work", os.environ.get("W5_DIR", "win6"), os.path.splitext(os.path.basename(SRC))[0] + ".w5.npz")
W5ON = os.environ.get("W5", "1") != "0" and os.path.exists(W5P)
if not W5ON and os.environ.get("AUTO_GLASS", "1") != "0" and "bridge" not in os.path.basename(SRC).lower() and ANN.get("auto_glass", True):      # (20:40: every deck again: a patch lying on a deck is now told from a window by its depth)
    navy = solid & (Ys < 0.22) & (Ys > 0.02) & ((b - r) > 0.02) & ((b - r) < 0.26) & (g >= r - 0.01) & (b >= g - 0.02) & ~port_any
    # (20:40: closed 17 x 17, so a window of many panes between white bars is ONE patch and what rings it is the wall;
    #  pane by pane the ring was the other panes, and the boat deck's arched windows were thrown out)
    navy = ndi.binary_closing(navy, structure=np.ones((17, 17), bool)) & solid
    # (20:55) on an OPEN deck the panes mirror the sky and are neither dark nor navy (the boat deck's arched windows stayed
    # dark): there a blue patch counts too, under harder terms (bigger, ringed more wholly by paint and by ship)
    open_ = not ANN.get("covered")
    navy0_ = navy
    navy &= ~poly_mask(ANN.get("not_glass"), H, W)             # (an annotation's "not_glass" polygons: never glass)
    if open_:
        blue2_ = solid & (Ys < 0.45) & ((b - r) > 0.10) & ((g - r) > 0.03) & (sat > 0.30) & ~port_any
        navy = navy | (ndi.binary_closing(blue2_, structure=np.ones((17, 17), bool)) & solid)
    paint_ = solid & (sat < 0.22) & (Ys > 0.12)                 # white or grey paint: what a house wall is
    nl_, nn_ = ndi.label(navy)
    auto = np.zeros((H, W), bool)
    na_ = 0
    for i_, sl_ in enumerate(ndi.find_objects(nl_), 1):
        sub_ = nl_[sl_] == i_
        a_ = int(sub_.sum())
        hh_, ww_ = sub_.shape
        strict_ = open_ and float(navy0_[sl_][sub_].mean()) < 0.5        # a sky-mirroring patch
        if a_ < (600 if strict_ else 400 if open_ else 150):
            continue
        if sl_[0].start <= 1 or sl_[1].start <= 1 or sl_[0].stop >= H - 1 or sl_[1].stop >= W - 1:
            continue                                                 # (cut by the picture's edge: the near patch of "1C B overlook prom4")
        if min(hh_, ww_) < 6 or a_ > 0.06 * H * W or a_ < 0.35 * hh_ * ww_ or hh_ > 7 * ww_ or ww_ > 6 * hh_:
            continue
        y0_, y1_ = max(0, sl_[0].start - 40), min(H, sl_[0].stop + 40)
        x0_, x1_ = max(0, sl_[1].start - 40), min(W, sl_[1].stop + 40)
        blob_ = nl_[y0_:y1_, x0_:x1_] == i_
        ring_ = ndi.binary_dilation(blob_, iterations=6) & ~blob_
        if ring_.sum() < 20 or solid[y0_:y1_, x0_:x1_][ring_].mean() < (0.95 if strict_ else 0.85):
            continue
        # (20:40) a dark patch LYING ON A DECK is no window: below the horizon a floor comes nearer down the picture in step with
        # the rows (disparity ~ row - horizon), a wall keeps its depth. The patch's ring: its top third against its bottom third.
        if disp is not None and getattr(disp, "shape", None) == (H, W):
            rr_, cc_ = np.nonzero(ring_)
            gy_, gx_ = rr_ + y0_, cc_ + x0_
            hz_ = float(np.mean(np.broadcast_to(hy, (H, W))[gy_, gx_]))
            dd_ = disp[gy_, gx_]
            tp_, bt_ = gy_ <= np.percentile(gy_, 33), gy_ >= np.percentile(gy_, 67)
            if tp_.any() and bt_.any():
                yt_, yb_ = float(gy_[tp_].mean()), float(gy_[bt_].mean())
                dt_, db_ = float(np.median(dd_[tp_])), float(np.median(dd_[bt_]))
                if yt_ > hz_ + 8 and dt_ > 1e-3:
                    R_ = (yb_ - hz_) / (yt_ - hz_)
                    if R_ > 1.12 and (db_ / dt_ - 1.0) > 0.5 * (R_ - 1.0):
                        continue
        ys_ = Ys[y0_:y1_, x0_:x1_]
        # (19:20: the ring right round a pane is its own dark red FRAME, so the first test, the ring's median, threw out most
        #  framed windows: a wider ring, and its lighter quarter must be the wall)
        wide_ = ndi.binary_dilation(blob_, iterations=16) & ~ndi.binary_dilation(blob_, iterations=3)
        # (20:15: B deck's windows sit in dark red frames a hand wide, so the wall is looked for further out as well)
        far_ = ndi.binary_dilation(blob_, iterations=36) & ~ndi.binary_dilation(blob_, iterations=12)
        lite_ = max(float(np.percentile(ys_[wide_], 75)) if wide_.sum() >= 40 else 0.0,
                    float(np.percentile(ys_[far_], 75)) if far_.sum() >= 40 else 0.0)
        if lite_ < float(ys_[blob_].mean()) + 0.07:
            continue
        # (19:40: and it stands in a painted WALL: pass 2 lit shadow patches on the open decks' planks, "1C B overlook prom4",
        #  "Starboard Officer's Promenade2"; over half of what rings a window, frame apart, is paint)
        pw_ = paint_[y0_:y1_, x0_:x1_]
        if max(float(pw_[wide_].mean()) if wide_.sum() else 0.0, float(pw_[far_].mean()) if far_.sum() else 0.0) < (0.70 if strict_ else 0.55):
            continue
        if zones[y0_:y1_, x0_:x1_][blob_].mean() > 0.5:          # already in a hand-drawn zone
            continue
        auto[y0_:y1_, x0_:x1_] |= ndi.binary_dilation(blob_, iterations=7)
        na_ += 1
    rep["auto_glass"] = na_
    zones = zones | auto
if zones.any():
    brown = (r > g + 0.02) & (g > b) & (sat > 0.30)
    # glass is dark against the paint round it: the wall's level from its neutral pixels nearby (a wall in shade sets a
    # low level, so its own shade is not taken for glass)
    neutral = zones & (sat < 0.20) & (Ys > 0.12)
    wall, wd = masked_blur(Ys, neutral.astype(np.float32), 30)
    wall = np.where(wd > 0.02, wall, 0.8)
    # (very dark glass is very saturated navy: sat 0.95 at the top of a tall pane, which then lit in its lower half only)
    darkg = (Ys < float(ANN.get("glass_max", 0.40))) & (Ys < 0.66 * wall) & ((b - r) > 0.015) & ((sat < 0.80) | (Ys < 0.15))
    # 2026-11-17: and glass is very dark or clearly coloured; white paint in shade (a beam under the deckhead, darker than
    # the sunlit wall round it) is neither, and was lit as a ragged pane
    darkg &= (Ys < 0.20) | (sat > 0.18)
    blueg = ((b - r) > 0.20) & (sat > 0.35) & ((g - r) > 0.08) & (Ys < 0.80)        # light-blue glass, not blue-grey shade
    fine = poly_mask(ANN.get("zones_fine"), H, W)
    g_c = zones & ~fine & (darkg | blueg) & ~brown
    g_c = ndi.binary_opening(g_c, iterations=1)
    if fine.any():
        med = cv2.medianBlur(np.clip(Ys * 255, 0, 255).astype(np.uint8), 31).astype(np.float32) / 255
        dk = fine & (Ys < float(ANN.get("fine_dark", 0.80)) * med) & (Ys > 0.035)
        k3 = np.ones((3, 3), bool)
        dk = ndi.binary_opening(dk, structure=k3)
        dk = ndi.binary_closing(dk, structure=k3)
        dk = ndi.binary_fill_holes(dk) & fine
        fl, fn = ndi.label(dk)
        okf = np.zeros(fn + 1, bool)
        for i, sl in enumerate(ndi.find_objects(fl), 1):
            sub = fl[sl] == i
            sz = int(sub.sum())
            hh, ww = sub.shape
            okf[i] = (10 <= sz <= int(ANN.get("fine_max", 2500)) and min(hh, ww) >= 3 and sz / (hh * ww) >= 0.50
                      and max(hh, ww) / max(min(hh, ww), 1) <= 7)
        g_fine = okf[fl]
    else:
        g_fine = np.zeros((H, W), bool)
    # (the picture's own edge is no zone border: a pane running off the top was rejected and lit in its lower half)
    zin = ndi.binary_erosion(np.pad(zones, 3, mode="edge"), iterations=2)[3:-3, 3:-3]
    gl, gn = ndi.label(g_c)
    if gn:
        idx = range(1, gn + 1)
        gsz = ndi.sum(g_c, gl, idx)
        gin = ndi.sum(zin, gl, idx)
        okk = np.zeros(gn + 1, bool)
        zarea = float(zones.sum())
        for i, (sz, inn) in enumerate(zip(gsz, gin), 1):
            sl = ndi.find_objects((gl == i).astype(np.uint8))[0]
            bh, bw = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
            fill_r = sz / max(bh * bw, 1)
            sl2 = ndi.find_objects((gl == i).astype(np.uint8))[0]
            dims = (sl2[0].stop - sl2[0].start, sl2[1].stop - sl2[1].start)
            in_fine = bool(fine[sl2].any())
            big_enough = (sz >= 4 and min(dims) >= 2) if in_fine else (sz >= 40 and min(dims) >= 5)
            okk[i] = big_enough and inn >= 0.97 * sz and sz < 0.70 * zarea and fill_r > 0.35
        glass = okk[gl]
    glass |= g_fine
    # the panes inside a frame (mahogany, teak, brass): whatever enclosed by the frame looks like glass (bluish, or dark),
    # so frosted or sun-struck panes are lit whole, not in specks; white muntins (neutral and bright) stay unlit
    # 2026-11-16 outline pass: white-painted tracery frames too (an arched window's fanlight sits in white tracery, so it
    # stayed dark blue while the panes under it glowed)
    white_fr = (Ys > 0.18) & (sat < 0.16) & (np.abs(b - r) < 0.06)   # white paint, lit or in a deckhead's shade (prom9's
    #                                                                   tracery reads Ys 0.29 under the deckhead)
    # (21:05) dark red glazing bars are a frame too: the boat deck's arched windows are FROSTED (98, 115, 146: nearly the wall's
    # colour by day), so only their bars say "window"; without this their panes were never enclosed and stayed dark at night
    red_fr = (r > g + 0.05) & (r > b + 0.05) & (Ys < 0.40)
    frame = (brown | white_fr | red_fr) & zones
    # (22:00) an annotation's "frame_close": n thickens the frame n px for this step: a small window's thin bars leave gaps
    # and its panes were not enclosed ("BD first starb prom2", the two left arched windows)
    fc_ = int(ANN.get("frame_close", 0))
    panes = ndi.binary_fill_holes(ndi.binary_dilation(frame, iterations=fc_) if fc_ else frame) & ~frame & zones
    # (inside wooden frames any glass-like pane counts, frosted grey included; inside white paint only dark or coloured
    # glass, since a beam's shade ringed by sunlit white was taken for a pane)
    # (22:10) an annotation's "red_frames": true counts dark red bars as the wooden frame here too (what they enclose is glass,
    # whole): far windows' bars are too mixed with the pale panes to pass as `brown` ("BD first starb prom2", left two)
    # (22:20) and "dark_frames": t counts whatever is darker than t as frame: those two windows' bars read (69, 56, 69) in the
    # de-sunned picture, a dull dark purple that is neither brown nor red, but darker than their panes and the wall
    df_ = float(ANN.get("dark_frames", 0.0))
    # ("dark_frames_zone": [x0, y0, x1, y1] keeps it to one part of the picture: over the whole of the zones it lit flecks of a
    #  speckled door panel at the picture's right edge)
    dkz_ = poly_mask([ANN["dark_frames_zone"]], H, W) if ANN.get("dark_frames_zone") else np.ones((H, W), bool)
    wood_ = ((brown | red_fr) if ANN.get("red_frames") else brown) | (((Ys < df_) & dkz_) if df_ > 0 else False)
    wood_ = wood_ & zones
    in_wood = ndi.binary_fill_holes(ndi.binary_dilation(wood_, iterations=fc_) if fc_ else wood_) & ~wood_
    glass_like = ((b - r) > 0.03) | (Ys < 0.40)
    muntin = (Ys > 0.72) & (np.abs(b - r) < 0.035) & (sat < 0.12)
    muntin &= ~ndi.binary_opening(muntin, iterations=3)          # thin bars only: a reflected cloud is glass
    # (and dark or coloured, as glass is: a beam's shade ringed by sunlit white paint was taken for a pane)
    panes &= glass_like & ~muntin & (in_wood | (Ys < 0.20) | (sat > 0.18))
    # whatever a wooden frame encloses is its glass, whole: frosted glass's bright flecks failed the pixel tests and
    # left the lit pane full of dark holes
    panes |= in_wood & zones
    panes = ndi.binary_opening(panes, iterations=1)
    pl_, pn_ = ndi.label(panes)
    if pn_:
        idx = range(1, pn_ + 1)
        psz = ndi.sum(panes, pl_, idx)
        pin = ndi.sum(zin, pl_, idx)
        okp = np.zeros(pn_ + 1, bool)
        okp[1:] = (psz >= 80) & (pin >= 0.97 * psz)          # (bolts and rivets ringed by white paint are no panes)
        bmr = ndi.median(b - r, pl_, idx)
        med = np.zeros(pn_ + 1, np.float32)
        med[1:] = bmr
        stray = (pl_ > 0) & ((b - r) < med[pl_] - 0.12) & (med[pl_] > 0.15)
        glass |= okp[pl_] & ~ndi.binary_dilation(stray, iterations=1)
    if SAM is not None:
        # 2026-11-17: SAM's regions make the pixel tests' glass whole (a pane is lit whole or not at all) and drop specks
        # found inside regions that are not glass (bolts on a pipe); the edges stay the pixel tests' own
        glassy = darkg | blueg | (((b - r) > 0.06) & (sat > 0.25) & (Ys < 0.50))
        glassy &= ~(brown | ((Ys > 0.60) & (sat < 0.15)))
        glass, rep_s = sam_rules.glass_refine(SAM, glass, zones, glassy)
        rep.update(rep_s)
# lit rectangles keep their frames and muntins dark (brown wood, or white paint brighter than the glass); circles and
# polygons are lit whole (a door's porthole, a lamp's box)
rects_ = poly_mask([q for q in (ANN.get("lit") or []) if len(q) == 4 and not isinstance(q[0], (list, tuple))], H, W)
framey = ((r > g + 0.02) & (g > b) & (sat > 0.30)) | ((Ys > 0.60) & (sat < 0.15))
glass |= (litg & ~rects_) | (rects_ & ~framey)
glass |= poly_mask(ANN.get("lit_blue"), H, W) & ((b - r) > 0.08) & ~ndi.binary_dilation((b - r) < 0.06, iterations=1)
glass &= ~poly_mask(ANN.get("dark"), H, W)
glass &= ~ndi.binary_dilation(port_any, iterations=1)       # round windows are drawn by their own pass (5b)
# (tiny lit specks in a dark window are no glass: lit glass under 60 px outside the fine zones is dropped)
if glass.any():
    gl_, gn_ = ndi.label(glass)
    if gn_:
        gsz_ = ndi.sum(np.ones((H, W), np.float32), gl_, np.arange(1, gn_ + 1))
        small_ = np.zeros(gn_ + 1, bool)
        small_[1:] = gsz_ < 60
        # (20:40: a small pane of a many-paned window is no speck: panes within 8 px of each other count together)
        cl_, cn_ = ndi.label(ndi.binary_closing(glass, structure=np.ones((17, 17), bool)) | glass)
        csz_ = ndi.sum(glass.astype(np.float32), cl_, np.arange(1, cn_ + 1))
        bigc_ = np.zeros(cn_ + 1, bool)
        bigc_[1:] = csz_ >= 240
        drop_ = small_[gl_] & ~bigc_[cl_] & ~poly_mask(ANN.get("zones_fine"), H, W) & ~litg
        rep["glass_specks_dropped_px"] = int(drop_.sum())
        glass &= ~drop_
GL2 = None
# ---- 5a'. WINDOWS AS INSTANCES (win6.py; 2026-11-22, the user: "we arent implementing anything until theres no weird
# artifacts ... these need to be perfect"). Every window is one object with its glass matted to the picture's own edges and a
# class; it is lit WHOLE, at one level: 'navy' and 'pale' as an even warm pane (a little brighter towards the top, a touch
# darker at its bars: set back in its frame), no bands, no blobs; 'see' as the room itself, its own pixels raised to a lit
# room, warm, the daylight in its far windows turned to night. Frames, bars and whatever stands in front stay the night's.
W5 = None
if W5ON:
    z_ = np.load(W5P)
    if z_["inst"].shape == (H, W):
        w5a = z_["alpha"].astype(np.float32) / 255.0 * solid
        W5 = dict(i=z_["inst"].astype(np.int32), a=w5a, m={q_["id"]: q_ for q_ in json.load(open(W5P[:-4] + ".json"))["windows"]})
        glass = w5a > 0.5
        for k_ in PM:                                       # a round or oval light that is one of these windows is theirs
            PM[k_] = PM[k_] * (w5a < 0.3)
if W5 is not None and glass.any():
    A5 = W5["a"]
    gsoft = A5
    GL2 = W5["i"] * glass
    dayL = lin(im)
    dayY = dayL @ LUM
    WL = float(ANN.get("window_level", 1.0))
    glow = np.zeros((H, W, 3), np.float32)
    emw = np.zeros((H, W), np.float32)
    _r5 = np.random.default_rng(2026)
    _ph = _r5.uniform(0, 2 * np.pi, 6)

    def _fld(cx_, cy_, k_):
        """A smooth field over the picture, -1 .. 1: like windows side by side come out alike, far ones differ."""
        return float(0.6 * np.sin(2 * np.pi * cx_ / 620.0 + _ph[k_]) * np.cos(2 * np.pi * cy_ / 900.0 + _ph[k_ + 1])
                     + 0.4 * np.sin(2 * np.pi * (cx_ + 0.6 * cy_) / 370.0 + _ph[k_ + 2]))
    for wid, sl in enumerate(ndi.find_objects(W5["i"]), 1):
        if sl is None or wid not in W5["m"]:
            continue
        sl = (slice(max(0, sl[0].start - 2), min(H, sl[0].stop + 2)), slice(max(0, sl[1].start - 2), min(W, sl[1].stop + 2)))
        sub = W5["i"][sl] == wid
        core = sub & (A5[sl] > 0.5)
        if core.sum() < 8:
            continue
        cls = W5["m"][wid]["cls"]
        hh_, ww_ = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        ty = (yy[sl] - sl[0].start) / max(hh_, 1)
        tx = (xx[sl] - sl[1].start) / max(ww_, 1)
        _cx, _cy = 0.5 * (sl[1].start + sl[1].stop), 0.5 * (sl[0].start + sl[0].stop)
        rw = np.random.default_rng(int(1915 + 7919 * wid + 31 * int(_cx) + 17 * int(_cy)))     # this window's own room
        lvl = 0.925 + 0.14 * _fld(_cx, _cy, 0)              # (the earlier 0.75 .. 1.10; neighbours alike: _fld)
        col = WIN_GLOW * (1 + 0.10 * _fld(_cx, _cy, 3) * np.array([0.0, 0.5, 1.0], np.float32))
        forced_see = cls == "see" and bool(W5["m"][wid].get("forced"))
        # the day picture's values from the panes' INSIDES, spread to their rims (a rim pixel is a mixture with the frame)
        inner = ndi.binary_erosion(core, iterations=2)
        if inner.sum() < 0.30 * core.sum():
            inner = ndi.binary_erosion(core, iterations=1)
        if inner.sum() < 0.30 * core.sum():
            inner = core
        iw_ = inner.astype(np.float32)
        den_ = cv2.GaussianBlur(iw_, (0, 0), 2.0)
        den4_ = cv2.GaussianBlur(iw_, (0, 0), 6.0)
        yv = dayY[sl]
        ext_ = np.where(den_ > 0.05, cv2.GaussianBlur(yv * iw_, (0, 0), 2.0) / np.maximum(den_, 1e-4),
                        cv2.GaussianBlur(yv * iw_, (0, 0), 6.0) / np.maximum(den4_, 1e-4))
        Yin = np.where(inner, cv2.GaussianBlur(yv, (0, 0), 0.6), ext_).astype(np.float32)
        c_ = dayL[sl]
        cden_ = np.maximum(den_, 1e-4)[..., None]
        cin_ = np.where((den_ > 0.05)[..., None], cv2.GaussianBlur(c_ * iw_[..., None], (0, 0), 2.0) / cden_, c_)
        chrom = cin_ / np.maximum(cin_ @ LUM, 1e-4)[..., None]
        # each pane set back in its frame: darker towards its edges (by the pane's own size)
        dg = cv2.distanceTransform(core.astype(np.uint8), cv2.DIST_L2, 3)
        pl_, pn_ = ndi.label(core)
        dmx_ = np.ones(pn_ + 1, np.float32)
        if pn_:
            dmx_[1:] = np.maximum(ndi.maximum(dg, pl_, index=np.arange(1, pn_ + 1)), 1.0)
        dmap_ = cv2.dilate(dmx_[pl_], np.ones((5, 5), np.uint8))          # (the alpha fringe takes its pane's)
        recess = 0.60 + 0.40 * np.clip(dg / dmap_ / 0.40, 0, 1) ** 0.8
        if forced_see:
            # the room behind the glass, lit: its own picture as warm light. The glass's veil (the window's darkest level) is
            # taken off; what is left is scaled so that the room's bright parts reach a lit pane's level, over a floor (a lit
            # room is nowhere black), with a little of its own colour; the daylight in the room's far windows (by far its
            # brightest, and bluish) is a dark window now.
            d_ = np.clip(Yin - float(np.percentile(yv[inner], 4)), 0, None)
            med_ = max(float(np.median(d_[inner])), 1e-4)
            far = (d_ > max(4.0 * med_, 0.06)) & (c_[..., 2] > 1.02 * c_[..., 0]) & core
            far = ndi.binary_closing(ndi.binary_opening(far, iterations=1), structure=np.ones((3, 3), bool), iterations=3)
            far = ndi.binary_fill_holes(far) & sub
            fsoft = cv2.GaussianBlur(far.astype(np.float32), (0, 0), 1.6)
            rest = inner & ~far
            p90 = max(float(np.percentile(d_[rest], 90)) if rest.any() else med_, 0.012)      # (a floor: a dark room's grain is not raised into a pattern)
            t_ = np.clip(d_ / p90, 0, 1.25)
            vs_ = (0.24 + 0.76 * t_ ** 0.9) * (1 - fsoft) + 0.12 * fsoft
            g_ = col[None, None, :] * np.clip(0.30 * chrom + 0.70, 0.6, 1.5) * (0.30 * WL * lvl * (0.86 + 0.14 * recess) * vs_)[..., None]
            e_ = 0.40
        else:
            # the room's light as it was drawn before: brighter towards the top, a soft highlight, falling off to the sides
            hx = rw.uniform(0.3, 0.7)
            prof = 0.80 + 0.32 * (1 - ty) ** 1.4 + 0.25 * np.exp(-(((tx - hx) / 0.35) ** 2 + (ty / 0.45) ** 2))
            prof = prof * (0.68 + 0.32 * np.clip(np.sin(np.pi * np.clip(tx, 0, 1)), 0, 1) ** 0.7)
            shape_ = 0.85 + 0.15 * np.clip(prof * lvl, 0, 2) / 1.2
            p85 = max(float(np.percentile(yv[inner], 85)), 1e-3)
            d_ = np.clip(Yin / p85, 0.04, 1.35)
            hp_ = d_ - cv2.GaussianBlur(d_, (0, 0), max(2.0, 0.06 * min(hh_, ww_)))
            # how much of a room the glass shows by day, 0 .. 1 (it was a switch at 0.045 / 0.10)
            ws_ = float(np.clip((float(np.std(hp_[inner])) - 0.035) / 0.035, 0, 1) * np.clip((float(np.std(d_[inner])) - 0.08) / 0.07, 0, 1))
            if cls == "navy":
                ws_ = 0.0
            # a pane that shows nothing by day shows the lit room behind it: its ceiling across the top with its lamp, its
            # walls in the middle, darker below; no texture of any kind, only light falling off
            ceil_ = rw.uniform(0.18, 0.32)
            floor_ = rw.uniform(0.66, 0.80)
            room = np.where(ty < ceil_, 0.95, np.where(ty < floor_, rw.uniform(0.55, 0.70), rw.uniform(0.26, 0.40)))
            room = cv2.GaussianBlur(room.astype(np.float32), (0, 0), max(1.0, 0.05 * hh_))
            lx_, ly_ = rw.uniform(0.25, 0.75), ceil_ * rw.uniform(0.45, 0.75)
            room = room + 0.38 * np.exp(-(((tx - lx_) / 0.20) ** 2 + ((ty - ly_) / 0.11) ** 2))
            room = room * (0.72 + 0.28 * np.clip(np.sin(np.pi * np.clip(tx, 0, 1)), 0, 1) ** 0.6)
            det = np.clip(room, 0.15, 1.35) * (0.94 + 0.12 * np.clip(d_, 0, 1.3)) * (1 - ws_) + d_ * ws_
            det = cv2.GaussianBlur(det.astype(np.float32), (0, 0), 1.8)
            det = 0.40 + 0.60 * np.clip(det, 0, 1.35)                    # lit from behind the glass glows on the whole
            g_ = col[None, None, :] * (0.25 * chrom + 0.75) * ((0.06 + 0.94 * det ** 1.15) * 0.30 * shape_ * WL * recess)[..., None]
            e_ = 0.55
        glow[sl] = np.where(sub[..., None], g_, glow[sl])
        emw[sl] = np.where(sub, e_, emw[sl])
    if TWI:
        night = night + glow * (A5 * LS)[..., None]
        emis += glow * (A5 * emw * LS * 0.5)[..., None]
    else:
        night = night * (1 - A5[..., None]) + glow * A5[..., None]
        emis += glow * (A5 * emw)[..., None]
    rep["w5_windows"] = len(W5["m"])
if W5 is None and glass.any():
    gsoft = np.clip(cv2.GaussianBlur(glass.astype(np.float32), (0, 0), 0.7), 0, 1)
    gsoft = np.maximum(gsoft, glass.astype(np.float32))
    tex = np.clip(Ys / max(float(np.percentile(Ys[glass], 90)), 0.05), 0.35, 1.3)
    gl2, gn2 = ndi.label(ndi.binary_dilation(glass, iterations=3))       # a window's panes together
    gl2 = gl2 * glass
    GL2 = gl2
    shape = np.zeros((H, W), np.float32)
    warmth = np.zeros((H, W), np.float32)
    for i, sl in enumerate(ndi.find_objects(gl2), 1):
        if sl is None:
            continue
        sub = gl2[sl] == i
        y0w, y1w = sl[0].start, sl[0].stop
        x0w, x1w = sl[1].start, sl[1].stop
        ty = (yy[sl] - y0w) / max(y1w - y0w, 1)
        tx = (xx[sl] - x0w) / max(x1w - x0w, 1)
        lvl = rng.uniform(0.75, 1.10)
        hx = rng.uniform(0.3, 0.7)
        prof = 0.80 + 0.32 * (1 - ty) ** 1.4 + 0.25 * np.exp(-(((tx - hx) / 0.35) ** 2 + (ty / 0.45) ** 2))
        # curtains drawn back to the sides: the light falls off towards the window's edges (round lights read as lenses)
        prof = prof * (0.68 + 0.32 * np.clip(np.sin(np.pi * np.clip(tx, 0, 1)), 0, 1) ** 0.7)
        shape[sl] = np.where(sub, prof * lvl, shape[sl])
        warmth[sl] = np.where(sub, rng.uniform(-1, 1), warmth[sl])
    WL = float(ANN.get("window_level", 1.0))
    wcol = WIN_GLOW[None, None, :] * (1 + 0.10 * warmth[..., None] * np.array([0.0, 0.5, 1.0], np.float32))
    # 2026-11-16 (the user: the windows "just look ai generated"; round ones read as lamps even by an open door): the glass
    # shows what the picture has behind it, as the rooms seen through doors do: each window's own pixels, its luminance
    # over its own 85th percentile (curtains, frames, room silhouettes, the panes' gradients kept), warmed, not a flat fill
    dayL = lin(im)
    dayY = dayL @ LUM
    detail = np.zeros((H, W), np.float32)
    dchrom = np.zeros((H, W, 3), np.float32)
    for i, sl in enumerate(ndi.find_objects(gl2), 1):
        if sl is None:
            continue
        sub = gl2[sl] == i
        if not sub.any():
            continue
        p85 = max(float(np.percentile(dayY[sl][sub], 85)), 1e-3)
        d_ = np.clip(dayY[sl] / p85, 0.04, 1.35)
        # what the glass showed by day: its fine detail (curtains, palms, a room), not a smooth gradient (a dark pane
        # mirroring the sky's own gradient shows nothing of a room, however much its brightness spreads)
        hp_ = d_ - cv2.GaussianBlur(d_.astype(np.float32), (0, 0), max(2.0, 0.06 * min(sl[0].stop - sl[0].start, sl[1].stop - sl[1].start)))
        if float(np.std(hp_[sub])) < 0.045 or float(np.std(d_[sub])) < 0.10:
            # a pane that showed nothing by day (dark or sky-mirroring glass) shows the lit room behind it at night, not a
            # flat amber panel (2026-11-17, the user: "look at this lmao ... we can do a lot better"): as soft light only,
            # the room's lit ceiling across the top with its lamp, its walls in the middle, darker below; each window its
            # own room
            hh_, ww_ = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
            ty_ = (yy[sl] - sl[0].start) / max(hh_, 1)
            tx_ = (xx[sl] - sl[1].start) / max(ww_, 1)
            ceil_ = rng.uniform(0.18, 0.32)
            floor_ = rng.uniform(0.66, 0.80)
            room = np.where(ty_ < ceil_, 0.95, np.where(ty_ < floor_, rng.uniform(0.55, 0.70), rng.uniform(0.26, 0.40)))
            room = cv2.GaussianBlur(room.astype(np.float32), (0, 0), max(1.0, 0.05 * hh_))
            lx_, ly_ = rng.uniform(0.25, 0.75), ceil_ * rng.uniform(0.45, 0.75)
            room = room + 0.38 * np.exp(-(((tx_ - lx_) / 0.20) ** 2 + ((ty_ - ly_) / 0.11) ** 2))
            # (no texture of any kind, 2026-11-17: "dont generate an artifical water texture please" holds for the
            # rooms too: only light falling off, darker towards the sides where curtains are drawn back)
            room = room * (0.72 + 0.28 * np.clip(np.sin(np.pi * np.clip(tx_, 0, 1)), 0, 1) ** 0.6)
            d_ = np.clip(room, 0.15, 1.35) * (0.94 + 0.12 * np.clip(d_, 0, 1.3))
        detail[sl] = np.where(sub, d_, detail[sl])
    # 2026-11-17 pass: the day's sparkle in a pane (sky glinting through palms and lace) read as noise once lit:
    # softened a little within the glass
    detail = np.where(glass, masked_blur(detail, glass.astype(np.float32), 1.8)[0], detail)
    # (lit from behind, frosted or patterned glass glows on the whole: its day pattern's dark specks are lifted)
    detail = np.where(glass, 0.40 + 0.60 * np.clip(detail, 0, 1.35), detail)
    # each pane recessed in its frame: darker towards its edges, so a lit pane reads as glass set in a wall, not a flat
    # panel stuck on it (the B deck's dark rounded windows lit as plain amber shapes)
    dg_ = cv2.distanceTransform(glass.astype(np.uint8), cv2.DIST_L2, 3)
    dm_ = np.zeros(gn2 + 1, np.float32)
    if gn2:
        dm_[1:] = ndi.maximum(dg_, gl2, index=np.arange(1, gn2 + 1))
    recess = 0.60 + 0.40 * np.clip(dg_ / np.maximum(dm_[gl2], 1.0) / 0.40, 0, 1) ** 0.8
    dchrom = dayL / np.maximum(dayY, 1e-4)[..., None]
    dchrom = 0.25 * dchrom + 0.75                                            # a trace of the pane's own colour
    shape = 0.85 + 0.15 * np.clip(shape, 0, 2) / 1.2                           # the room's light falls off gently
    glow = wcol * dchrom * ((0.06 + 0.94 * detail ** 1.15) * 0.30 * shape * WL * recess)[..., None]
    if TWI:
        # by twilight the glass mirrors the bright sky (the day picture's own, graded); the room's light only adds
        night = night + glow * (gsoft * LS)[..., None]
        emis += glow * (gsoft * 0.55 * LS * 0.5)[..., None]
    else:
        night = night * (1 - gsoft[..., None]) + glow * gsoft[..., None]
        emis += glow * gsoft[..., None] * 0.55
rep["glass_px"] = int(glass.sum())

# ---- 5b. the round windows (ports.py), each fitted to its glass. A cabin's light ("on") is as bright as a lit window's
# and glows out; a door's light ("room") is the lit room behind frosted glass, no brighter than that room seen through an
# open door and with no glare; an open door's glass ("off") stays the night's (the user, 2026-11-16: lit round windows by
# an open door "just look ai generated")
plit = np.maximum(PM["on"], PM["room"])
if plit.max() > 0:
    selp = plit > 0.5
    dYp = lin(im) @ LUM
    p80 = max(float(np.percentile(dYp[selp], 80)), 1e-3) if selp.any() else 1.0
    tex_ = 0.86 + 0.14 * np.clip(dYp / p80, 0.4, 1.3)                    # a trace of the day glass's own shading
    vig = 0.48 + 0.52 * np.clip((1.0 - PRHO) / 0.42, 0, 1) ** 0.9       # recessed in its rim: darker towards the rim
    # lit from the room's ceiling: brighter at the top; a door's light shows the room behind it, its lamp above and its
    # walls and furniture darker below (not an even disc)
    top_on = 0.78 + 0.34 * (1 - PTY) ** 1.3
    top_room = 0.42 + 0.80 * (1 - PTY) ** 1.6
    wr = PM["room"] / np.maximum(plit, 1e-6)
    top_ = top_on * (1 - wr) + top_room * wr
    lvl_ = (0.24 * PM["on"] + 0.075 * PM["room"]) / np.maximum(plit, 1e-6) * PLVL
    pg = WIN_GLOW[None, None, :] * (lvl_ * vig * top_ * tex_ * float(ANN.get("window_level", 1.0)))[..., None]
    if TWI:
        night = night + pg * (plit * LS)[..., None]
        emis += pg * (0.45 * PM["on"] * LS * 0.5)[..., None]
    else:
        night = night * (1 - plit[..., None]) + pg * plit[..., None]
        emis += pg * (0.45 * PM["on"])[..., None]
# dark glass (an open door's): the sun made it white by day (frosted, sunlit); at night it mirrors the dark, so it is
# darker than the paint round it and takes little of the deck's light (see `own` below)
if not TWI:
    night = night * (1 - 0.55 * PM["off"])[..., None]
rep["port_px"] = {k: int((v > 0.5).sum()) for k, v in PM.items()}

inter = np.zeros((H, W), bool)                               # (its far windows' sky is the outside's, drawn in 6.)
for _q in ANN.get("interior") or []:
    _pm = poly_mask([_q], H, W) & solid
    # (2026-11-23) a shape that a window found by win6 covers is that window's: its panes are exact, the hand-drawn
    # quadrilateral lit the bars with the room
    if W5 is not None and _pm.any() and float((W5["a"][_pm] > 0.5).mean()) > 0.30:
        rep["interior_left_to_windows"] = rep.get("interior_left_to_windows", 0) + 1
        continue
    inter |= _pm
isoft = np.zeros((H, W), np.float32)
if inter.any():
    isoft = gblur(inter.astype(np.float32), 1.0)
    warm_int = lin(im) * np.array([1.0, 0.80, 0.56], np.float32) * float(ANN.get("interior_level", 0.62))
    if TWI:
        # a room by sunrise or sunset: its lamps and the day's last (or first) light, warmer and a little dimmer
        warm_int = lin(im) * np.array([1.0, 0.86, 0.68], np.float32) * 0.78
    night = night * (1 - isoft[..., None]) + warm_int * isoft[..., None]

# ---- 5c. the lights in 3D (light3d): the deck-calibrated depth places every pixel; lamps and lit windows light the
# surfaces by distance and slope, shadowed by what stands between
EYE = float(ANN.get("eye", 1.6))                       # the camera's height over the deck it stands on (m)
uu_ = np.log(np.maximum(L[..., 0], 1e-4) / np.maximum(L[..., 1], 1e-4))
ww_ = np.log(np.maximum(L[..., 2], 1e-4) / np.maximum(L[..., 1], 1e-4))
floor = (yy > hy + 25) & solid & ~glass & ~inter & (uu_ > 0.10) & (ww_ < -0.05)
if "floor" in ANN:
    floor = poly_mask(ANN["floor"], H, W) & solid
LAMP_POWER = {"ceiling": 1.0, "wall": 0.8, "post": 1.3}
GAIN = float(ANN.get("light_gain", 1.0))
E3 = None
if disp is not None:
    sc = light3d.Scene(disp, float(coef[0] * W / 2 + coef[1]), FOCAL, EYE, floor, scale=0.5, rng=np.random.default_rng(11))
    guide_small = cv2.resize(im, (sc.w, sc.h), interpolation=cv2.INTER_AREA)
    sc.normals(guide_small)
    rep["depth_fit"] = sc.fit
    if GL2 is not None and not TWI:
        # 2026-11-17: glass seen at a glance mirrors the dark outside more than it shows the room (Fresnel): each window
        # dimmed by its own facing (the median of its surface normals against the line of sight)
        vv = -sc.P / np.maximum(np.linalg.norm(sc.P, axis=-1, keepdims=True), 1e-6)
        cosf = cv2.resize(np.abs((sc.N * vv).sum(-1)).astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR)
        fr_ = np.zeros(int(GL2.max()) + 1, np.float32)
        for i_ in range(1, len(fr_)):
            mi = GL2 == i_
            if mi.any():
                c_ = float(np.median(cosf[mi]))
                fr_[i_] = 0.04 + 0.96 * (1 - c_) ** 5
        Fm = fr_[GL2] * gsoft
        night = night * (1 - 0.85 * Fm)[..., None]
        emis = emis * (1 - 0.85 * Fm)[..., None]
        rep["fresnel_max"] = round(float(fr_.max()), 3)
    down = -sc.up
    E3 = np.zeros((sc.h, sc.w, 3), np.float32)
    lamp_rep = []
    for lp in ANN.get("lamps", []):
        x0, y0 = lp["p"]
        kind = lp.get("k", "wall")
        s = float(lp.get("s", 1.0)) * LS
        col = np.array(lp["c"], np.float32) if "c" in lp else WARM
        Q, Zl = sc.point(x0, y0, mask=solid)
        R = float(lp.get("r", FOCAL * 0.65 / max(Zl, 0.3)))
        d = np.hypot(xx - x0, yy - y0)
        core = max(1.6, min(R * 0.05, 9.0)) * float(lp.get("core", 1.0))
        if "lens" in lp or "lens_ell" in lp:
            # the fitting's own glass (a round lens, or a bowl seen as an ellipse) glows, brightest at its middle
            erx, ery = (float(lp["lens"]),) * 2 if "lens" in lp else (float(lp["lens_ell"][0]), float(lp["lens_ell"][1]))
            de = np.hypot((xx - x0) / max(erx, 1), (yy - y0) / max(ery, 1))
            lm = np.clip((1.0 - de) * min(erx, ery) + 0.5, 0, 1)
            lglow = col * (s * (0.55 + 0.45 * np.clip(1 - de, 0, 1)))[..., None]
            night = night * (1 - lm[..., None]) + lglow * lm[..., None]
            emis += lglow * lm[..., None] * 0.5
        emis += col * (s * 1.4 * np.exp(-(d / core) ** 2))[..., None]
        emis += col * (s * 0.12 * np.exp(-d / (core * 4)))[..., None]
        if kind == "point":
            continue
        toward = -Q / max(float(np.linalg.norm(Q)), 1e-6)
        if kind == "wall":
            nw = sc.normal_at(x0, y0)
            Q = Q + nw * 0.24 + toward * 0.03
            Rn = FOCAL * 0.55 / max(Zl, 0.3)
            lightadd += col * (s * 0.30 * np.exp(-(d / Rn) ** 2 * 1.4))[..., None]
            lobe = (lambda nn: (lambda dirs: 0.30 + 0.70 * np.clip((dirs * nn).sum(-1), 0, 1)))(nw)
        else:
            Q = Q + down * (0.12 if kind == "ceiling" else 0.08) + toward * 0.05
            lobe = (lambda dn: (lambda dirs: 0.25 + 0.75 * np.clip((dirs * dn).sum(-1), 0, 1)))(down)
        E = sc.irradiance(Q, LAMP_POWER.get(kind, 1.0) * s, lobe, samples=3, soft=0.05)
        E3 += E[..., None] * col
        lamp_rep.append([kind, round(float(Zl), 2)])
    rep["lamps3d"] = lamp_rep
    # lit windows and doorways as soft area lights: one or a few points on each, power by its area in m2, a cosine lobe
    # out of the wall
    srcs = []
    WSPILL = float(ANN.get("window_spill", 2.2))
    WLv = float(ANN.get("window_level", 1.0))
    ILv = float(ANN.get("interior_level", 0.62))
    for mask_, level, kind in ((glass, WSPILL * WLv, "win"), (PM["on"] > 0.5, WSPILL * WLv, "win"),
                               (PM["room"] > 0.5, 0.5 * WSPILL * WLv, "win"), (inter, 1.4 * WSPILL * ILv / 0.55, "door")):
        if not mask_.any():
            continue
        wl_, wn_ = ndi.label(ndi.binary_dilation(mask_, iterations=4))
        for i, sl in enumerate(ndi.find_objects(wl_), 1):
            sub = (wl_[sl] == i) & mask_[sl]
            npx = int(sub.sum())
            if npx < 30:
                continue
            ys_, xs_ = np.nonzero(sub)
            ys_ = ys_ + sl[0].start
            xs_ = xs_ + sl[1].start
            cxw, cyw = float(xs_.mean()), float(ys_.mean())
            zc = float(np.median(sc.Z[ys_, xs_]))
            nw = sc.normal_at(cxw, cyw, r=10)
            if kind == "door":
                # 2026-11-17: a doorway's light comes out of the opening, not from the room's back wall (it lit the
                # room's floor and the jambs in hot spots): the opening's depth and facing from the frame and wall round it
                full = np.zeros((H, W), bool)
                full[ys_, xs_] = True
                ring = ndi.binary_dilation(full, iterations=12) & ~ndi.binary_dilation(full, iterations=3) & solid & ~inter
                if ring.sum() > 40:
                    ry_, rx_ = np.nonzero(ring)
                    zc = float(np.percentile(sc.Z[ry_, rx_], 40))
                    nr = sc.N[np.clip((ry_ * sc.s).astype(int), 0, sc.h - 1), np.clip((rx_ * sc.s).astype(int), 0, sc.w - 1)]
                    # the wall's facing only: the floor and the deckhead round the door (facing up or down) tilted it
                    # up and the light fanned over the wall above the door
                    wallish = np.abs(nr @ sc.up) < 0.35
                    if wallish.sum() > 20:
                        nr = nr[wallish].mean(0)
                        nr = nr - (nr @ sc.up) * sc.up
                        if np.linalg.norm(nr) > 1e-3:
                            nw = nr / np.linalg.norm(nr)
            if zc > 60:
                continue
            area = npx * (zc / FOCAL) ** 2
            Qw = np.array([(cxw - sc.cx) / sc.f * zc, (cyw - sc.cy) / sc.f * zc, zc], np.float32)
            off = 0.30 if kind == "door" else 0.10
            # an area light's own size softens it near (no hot spot on a jamb or a rim right by it)
            srcs.append((level * area * LS, Qw + nw * off, nw, np.sqrt(area) * 0.35, max(0.2, 0.45 * np.sqrt(area))))
    srcs.sort(key=lambda t: -t[0])
    for pw, Qw, nw, soft, r0 in srcs[:int(ANN.get("max_window_lights", 24))]:
        if pw < 0.01:
            continue
        lobe = (lambda nn: (lambda dirs: np.clip((dirs * nn).sum(-1), 0, 1)))(nw)
        # (shadows kept: without them a doorway's light reached the whole deck through pillars and walls)
        E = sc.irradiance(Qw, pw, lobe, samples=2, soft=float(soft), r0=float(r0))
        E3 += E[..., None] * WIN_GLOW
    rep["window_lights"] = min(len(srcs), int(ANN.get("max_window_lights", 24)))
    lightadd += sc.up_res(E3 * GAIN * 0.55, im)
    # (2026-11-22) no surface takes more light than a lit pane gives: the depth map puts a beam or a frame's edge almost
    # ON a window or a lamp, where the inverse square law made a glaring bar of it; the light is held, softly, under a level
    la_ = lightadd @ LUM
    lightadd = lightadd * (0.22 * np.tanh(la_ / 0.22) / np.maximum(la_, 1e-6))[..., None]
    if DBG:
        np.save(os.path.join(DBG, os.path.splitext(os.path.basename(SRC))[0] + ".Z.npy"), sc.Z.astype(np.float16))
gmask = gsoft if glass.any() else np.zeros((H, W), np.float32)
# what shines by its own light (glass, round windows, rooms through doors) takes none of the deck's light added
own = np.maximum(np.maximum(np.maximum(gmask, plit), isoft), 0.75 * PM["off"])[..., None]
if os.environ.get("LAYERS"):
    # (a study aid: the layers at full size, to find which one carries a blemish)
    _ld = os.environ["LAYERS"]
    os.makedirs(_ld, exist_ok=True)
    _b = os.path.splitext(os.path.basename(SRC))[0]
    for _n, _a in (("base", night), ("alb", alb), ("light", lightadd * 3.0), ("lit", alb * lightadd * (1 - own) * 3.0)):
        cv2.imwrite(os.path.join(_ld, _b + "." + _n + ".png"), (np.clip(srgb(np.clip(_a, 0, None)), 0, 1)[..., ::-1] * 255).astype(np.uint8))
night = night + alb * lightadd * (1 - own)
if not TWI and cov.any():
    # 2026-11-17: thin slivers the day's sun lit under a deckhead (an edge, a bolt head) are too thin for the sun-patch
    # pass and stood out at night as sparkling lines: on surfaces that give no light of their own, a small feature far
    # brighter than what is round it is brought down to it
    Ln = night @ LUM
    ref_ = cv2.morphologyEx(Ln, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    med_ = cv2.medianBlur(np.clip(Ln * 4000, 0, 65535).astype(np.uint16), 5).astype(np.float32) / 4000 if False else cv2.blur(ref_, (5, 5))
    spk = (Ln > 1.6 * med_ + 0.002) & (Ln - ref_ > 0.004) & cov & solid & (own[..., 0] < 0.05)
    spk = spk & ~ndi.binary_opening(spk, iterations=2)                 # small and thin only
    k_ = np.where(spk, (1.25 * med_ + 0.001) / np.maximum(Ln, 1e-6), 1.0).astype(np.float32)
    night = night * np.minimum(k_, 1.0)[..., None]
    rep["specks_clamped_px"] = int(spk.sum())
if not TWI and ANN.get("streaks"):
    # (2026-11-23) the day's thin sun streaks on a plain wall (desun.py's base is too coarse for them: pale wavy outlines
    # at night): inside the annotation's shapes a feature thinner than 15 px and brighter than what is round it is
    # brought down to it
    sm_ = poly_mask(ANN["streaks"], H, W) & solid & (own[..., 0] < 0.05)
    Ln = (night @ LUM).astype(np.float32)
    ref_ = cv2.GaussianBlur(cv2.morphologyEx(Ln, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))), (0, 0), 3.0)
    k_ = np.where(sm_ & (Ln > 1.05 * ref_), (1.02 * ref_) / np.maximum(Ln, 1e-6), 1.0).astype(np.float32)
    night = night * np.minimum(cv2.GaussianBlur(k_, (0, 0), 0.7), 1.0)[..., None]
    rep["streaks_px"] = int((k_ < 0.98).sum())
rep["lamps"] = len(ANN.get("lamps", []))

# ============================================================================== 6. the night outside
if PLATE:
    emis[:] = 0
    sky_here = yy < hy - 1                                  # (stars wherever the sky is, behind the ship too)
pal = np.stack([hexrgb(h) for h in NIGHT])
tz = np.clip(elev / 90.0, 0, 1)
pos = (1 - tz) * (len(NIGHT) - 1)
i0 = np.clip(np.floor(pos).astype(int), 0, len(NIGHT) - 2)
f = (pos - i0)[..., None]
sky = lin(pal[i0] * (1 - f) + pal[i0 + 1] * f)

cloud = np.zeros((H, W), np.float32)
cloudlum = np.zeros((H, W), np.float32)
smoke = np.zeros((H, W), np.float32)
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
        # 2026-11-17: the funnels' smoke was taken with the sky (a dark plume over blue, its edges sky-blue): its cover is
        # how far a pixel has moved from the clear sky towards dark smoke grey (a cloud moves the other way, to white)
        Kc = np.array([0.20, 0.20, 0.22], np.float32)
        dk = Kc[None, :] - clear_row
        ts = (pc * dk[:, None, :]).sum(-1) / np.maximum((dk * dk).sum(-1), 1e-6)[:, None]
        smoke = np.where(sreg, np.clip((ts - 0.12) / 0.75, 0, 1), 0).astype(np.float32)
        smoke = gblur(smoke, 0.8)
        rep["smoke_px"] = int((smoke > 0.3).sum())
SUN = ANN.get("sun")
if SUN is not None:
    dsun = np.hypot(xx - SUN[0], yy - SUN[1])
    ray_zone = np.exp(-dsun / 420.0)
    cloud = cloud * (1 - 0.85 * ray_zone) - 0.15 * ray_zone
cloud = np.clip((cloud - 0.14) / 0.86, 0, 1)
if PLATE:
    upper_ = yy < hy - 2
    known_ = ndi.binary_erosion(sreg, iterations=2) | ~upper_
    cloud = np.where(upper_, fill_behind(cloud, known_), 0).astype(np.float32)
    cloudlum = np.where(upper_, fill_behind(cloudlum, known_), 0).astype(np.float32)
    cloud = gblur(np.clip(cloud, 0, 1), 0.7)
    smoke[:] = 0
else:
    edge_d = ndi.distance_transform_edt(np.pad(outside, ((1, 0), (1, 1)), constant_values=True))[1:, 1:-1]
    cloud = gblur(cloud, 0.7) * np.clip((edge_d - 2) / 10.0, 0, 1)

if TWI:
    # ---- 6t. the sky of a sun a few degrees up: the game's sunset palette by elevation, its warm band close over the
    # horizon (most of the change in the lowest 15 deg); the sun where the day's stood (the same bearing, so the ship's
    # lit sides agree), 3 deg up, with its glow along the horizon
    palt = np.stack([hexrgb(h) for h in TWI_SKY])
    nT = len(TWI_SKY) - 1
    post = nT * np.exp(-np.clip(elev, 0, 90) / 16.0)
    k0 = np.clip(np.floor(post).astype(int), 0, nT - 1)
    ft = (post - k0)[..., None]
    sky = lin(palt[k0] * (1 - ft) + palt[k0 + 1] * ft)
    WARMS = np.array([1.0, 0.56, 0.24], np.float32)
    sun_xy = None
    glow_x = None
    if SUN is not None:
        sx_ = float(SUN[0])
        sun_xy = (sx_, float(coef[0] * sx_ + coef[1]) - FOCAL * np.tan(np.radians(3.0)))
        glow_x = sx_
    elif sky_here.sum() > 4000:
        # the sun off the frame: the day sky is brighter towards it; its glow then rises from that side's horizon
        band_ = sky_here & (elev < 25)
        lw_, rw_ = band_ & (xx < W / 3), band_ & (xx > 2 * W / 3)
        if lw_.sum() > 500 and rw_.sum() > 500:
            yl, yr_ = float(Ys[lw_].mean()), float(Ys[rw_].mean())
            if yl > 1.06 * yr_:
                glow_x = -350.0
            elif yr_ > 1.06 * yl:
                glow_x = W + 350.0
    rep["twi_sun"] = [round(v, 1) for v in sun_xy] if sun_xy else ("off frame at %s" % glow_x if glow_x is not None else "none")
    dsn = np.full((H, W), 1e6, np.float32)
    if glow_x is not None:
        horiz = (np.exp(-np.abs(xx - glow_x) / 560.0) * np.exp(-np.clip(elev, 0, 90) / 7.5)).astype(np.float32)
        sky = sky * (1 + 0.85 * horiz)[..., None] + (0.09 * horiz)[..., None] * WARMS
    if sun_xy is not None:
        dsn = np.hypot(xx - sun_xy[0], yy - sun_xy[1]).astype(np.float32)
        sky = sky + (0.32 * np.exp(-dsn / 65.0))[..., None] * np.array([1.0, 0.70, 0.36], np.float32)             + (0.10 * np.exp(-dsn / 230.0))[..., None] * np.array([1.0, 0.60, 0.30], np.float32)
        SUN_R = 15.0
        disc = np.clip(SUN_R + 0.5 - dsn, 0, 1)
        sky = sky * (1 - disc[..., None]) + disc[..., None] * np.array([1.7, 1.2, 0.66], np.float32)
        emis += (0.8 * np.exp(-(dsn / 24.0) ** 2) * sky_here)[..., None] * np.array([1.0, 0.72, 0.38], np.float32)
    # clouds lit from below by the low sun: the day's shading (lit tops, grey bases) is the wrong way round for it, so
    # each cloud takes the light of its height (gold low over the horizon, rose higher, lavender overhead), brighter
    # than the sky behind it, the day's shading kept only faintly; brighter still towards the sun
    e_ = np.clip(elev / 38.0, 0, 1)[..., None] ** 0.8
    c_low = np.array([1.0, 0.50, 0.22], np.float32) * 0.46
    c_high = np.array([0.70, 0.46, 0.60], np.float32) * 0.28
    ccol = c_low * (1 - e_) + c_high * e_
    ccol = ccol * (0.72 + 0.40 * np.clip(cloudlum, 0, 1))[..., None]
    if glow_x is not None:
        ccol = ccol * (1 + 0.9 * np.exp(-np.abs(xx - glow_x) / 450.0)[..., None])
    sky = sky * (1 - 0.92 * cloud[..., None]) + ccol * (0.92 * cloud[..., None])
    # the sea mirrors that sky (its colour at the mirrored elevation, by the Fresnel share) over a deep slate, keeping
    # the day's waves; under the sun its glitter path
    dep = np.clip(-elev, 0.0, 89.0)
    fres = 0.02 + 0.98 * (1 - np.sin(np.radians(dep))) ** 5
    posm = nT * np.exp(-dep / 16.0)
    j0 = np.clip(np.floor(posm).astype(int), 0, nT - 1)
    fm = (posm - j0)[..., None]
    mirror = lin(palt[j0] * (1 - fm) + palt[j0 + 1] * fm)
    if glow_x is not None:
        mirror = mirror * (1 + 0.6 * np.exp(-np.abs(xx - glow_x) / 560.0))[..., None]
    Yday = lin(im) @ LUM
    tex = np.zeros_like(Yday)
    s_ = (sea_cov > 0.5) & outside
    if s_.any():
        blur_ = gblur(np.where(s_, Yday, 0), 6) / np.maximum(gblur(s_.astype(np.float32), 6), 1e-3)
        tex[s_] = np.clip((Yday[s_] - blur_[s_]) / np.maximum(blur_[s_], 1e-3), -1, 1.5)
    if PLATE and s_.any():
        low_ = yy > hy + 1
        tex = np.where(low_, fill_behind(np.maximum(tex, -0.35), ndi.binary_erosion(s_, iterations=2) | ~low_), 0)
        tex = tex.astype(np.float32)            # (bits of far railing taken for sea were dark smudges at the horizon)
    base = np.array([0.010, 0.015, 0.034], np.float32)
    sea = mirror * (0.62 * fres)[..., None] * np.clip(1 + 2.2 * tex, 0.35, 2.4)[..., None] + base * (1 - fres)[..., None]
    crest = np.clip(tex * 7.0, 0, 1) ** 2 * np.clip(1 - dep / 14.0, 0, 1)
    sea = sea + (0.018 * crest)[..., None] * np.array([1.0, 0.72, 0.48], np.float32)
    pb = np.maximum(yy - hy, 0.5)
    # (2026-11-17, the user: "dont generate an artifical water texture please": the sea keeps only the day picture's own
    # waves; no noise is laid over it, and the glitter comes from those waves too)
    if sun_xy is not None:
        width = 12 + 0.55 * pb
        colm = np.exp(-((xx - sun_xy[0]) / width) ** 2)
        glint = 2.0 * np.clip(tex * 4, 0, 2)
        path = colm * (0.03 + 0.20 * glint) * np.exp(-pb / 520.0) * np.clip(pb / 3.0, 0, 1)
        sea = sea + path[..., None] * np.array([1.0, 0.62, 0.30], np.float32)
    # far parts of the ship in the evening haze, towards the horizon's colour
    if E3 is not None:
        Zf = cv2.resize(sc.Z.astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR) if sc.Z.shape != (H, W) else sc.Z
        hz = (0.30 * (1 - np.exp(-np.clip(Zf, 0, 3000) / 420.0)) * solid).astype(np.float32)
        night = night * (1 - hz[..., None]) + (lin(palt[-1]) * 0.55)[None, None, :] * hz[..., None]
else:
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
    if PLATE and s_.any():
        low_ = yy > hy + 1
        tex = np.where(low_, fill_behind(np.maximum(tex, -0.35), ndi.binary_erosion(s_, iterations=2) | ~low_), 0)
        tex = tex.astype(np.float32)            # (bits of far railing taken for sea were dark smudges at the horizon)
    sea = mirror * (0.55 * fres)[..., None] * np.clip(1 + 2.6 * tex, 0.3, 2.5)[..., None] + np.array([0.0006, 0.0010, 0.0016], np.float32)
    crest = np.clip(tex * 7.0, 0, 1) ** 2 * np.clip(1 - dep / 14.0, 0, 1)
    sea = sea + (0.0030 * crest)[..., None] * np.array([0.75, 0.85, 1.0], np.float32)
    pb = np.maximum(yy - hy, 0.5)
    # (no noise laid over the sea: only the day picture's own waves, the moon's glitter from them too)
    if MOONP and my_ < float(coef[0] * mx_ + coef[1]):
        width = 14 + 0.45 * pb
        colm = np.exp(-((xx - mx_) / width) ** 2)
        glint = 2.0 * np.clip(tex * 4, 0, 2)
        path = colm * (0.006 + 0.022 * glint) * np.exp(-pb / 600.0) * np.clip(pb / 3.0, 0, 1)
        sea = sea + path[..., None] * np.array([0.95, 0.92, 0.85], np.float32)
# the smoke laid back over the new sky: near black against the night; dark grey-brown by sunrise or sunset, a little of
# the sky's colour through its thin parts
if smoke.max() > 0:
    sm_ = (0.92 * smoke * sky_here)[..., None]
    kcol = (np.array([0.026, 0.022, 0.024], np.float32) + 0.22 * sky) if TWI else np.array([0.0030, 0.0032, 0.0040], np.float32)
    sky = sky * (1 - sm_) + kcol * sm_
outside_rgb = sky * (1 - sea_cov[..., None]) + sea * sea_cov[..., None]
out = night * (1 - alpha[..., None]) + outside_rgb * alpha[..., None]
if PLATE:
    out = outside_rgb

# ============================================================================== 7. bloom, vignette, dither
bloom = gblur(emis, 3) * 0.35 + gblur(emis, 12) * 0.22 + gblur(emis, 40) * 0.12
out = out + emis * 0.6 + bloom
rr = np.hypot((xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2)) / np.sqrt(2)
if not PLATE:                                          # (a plate's vignette is put on with the ship in front of it)
    out = out * (1 - (0.22 if TWI else 0.30) * rr ** 2)[..., None]
o = srgb(out) * 255 + rng.triangular(-0.5, 0, 0.5, out.shape).astype(np.float32)
o8 = np.clip(np.round(o), 0, 255).astype(np.uint8)
os.makedirs(os.path.dirname(os.path.abspath(DST)), exist_ok=True)
tmp_ = DST + ".part.png"
Image.fromarray(o8).save(tmp_)
os.replace(tmp_, DST)                                                 # whole files only (runs may be stopped)
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
