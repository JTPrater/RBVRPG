"""Day -> night edit of one game location picture.

python -I night.py <day.png> <moon.webp> <out_dir> [moon_x moon_y]

1. Finds the outside: blue sky/sea areas; a window's opening is the convex hull of its blue, the open sky (touching the
   frame's top/right edge) has its clouds filled in. Edges matted with a guided filter on the picture itself.
2. Horizon fitted from the sky->sea step inside the windows; clouds measured against the clear sky in each area.
3. Night sky from the game's own night palette (game.js SKY_PALETTES.night, zenith -> horizon) by elevation, the game's
   moon (moon phase/full.webp) with its glow, stars (fading at the horizon, near the moon and behind cloud), the
   picture's clouds re-lit by the moon; the sea reflects the night sky (Fresnel), keeping the picture's wave texture.
4. The rest graded for moonlight in linear light: darker, more contrast, desaturated, blue; then a soft vignette.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SRC, MOON, OUT = sys.argv[1:4]
MOON_XY = (float(sys.argv[4]), float(sys.argv[5])) if len(sys.argv) > 5 else None
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(1915)

NIGHT = ["#04070e", "#080d18", "#0d1422", "#141c2c", "#1e2836"]     # game.js SKY_PALETTES.night, zenith -> horizon
FOCAL = 771.0          # px: 70 deg vertical field of view on 1080 rows (the renders' camera)
GLASS = 0.80           # what the window glass lets through (the day picture's window sky is darker than the open sky)
MOON_D = 46            # moon diameter in px (drawn larger than life, as the game's sky does)


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


im = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32) / 255
H, W = im.shape[:2]
L = lin(im)
Yd = L @ np.array([0.2126, 0.7152, 0.0722], np.float32)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
sat = (im.max(2) - im.min(2)) / np.maximum(im.max(2), 1e-6)

# ---- 1. the outside
blue = (b - r > 0.18) & (sat > 0.22)
lab, n = ndi.label(blue)
sizes = ndi.sum(blue, lab, range(1, n + 1))
view = np.zeros((H, W), bool)
win = np.zeros((H, W), bool)
wins = []
for c in [int(i) + 1 for i in np.argsort(-sizes)[:3] if sizes[i] > 20000]:
    m = lab == c
    ys, xs = np.nonzero(m)
    if ys.min() == 0 or xs.max() == W - 1:                         # open sky: fill the clouds (even those on the edge)
        p = np.pad(m, ((1, 0), (0, 1)), constant_values=True)
        view |= ndi.binary_fill_holes(p)[1:, :-1]
    else:                                                          # window opening = convex hull of its blue
        hull = cv2.convexHull(np.stack([xs, ys], 1).astype(np.int32))
        mm = np.zeros((H, W), np.uint8)
        cv2.fillPoly(mm, [hull], 1)
        view |= mm > 0
        win |= mm > 0
        wins.append((mm > 0, xs.min(), xs.max()))

# the open sky also takes the paler haze beside it (above the rail it fails the blue test): sky-coloured, i.e. green and
# blue well above red, which the white screen (b - r ~ 0.07, g - r ~ 0.02) and the wood (b < r) are not
open_m = view & ~win
cand = ((b - r) > 0.08) & ((g - r) > 0.06)
view |= ndi.binary_propagation(open_m, mask=(open_m | cand) & ndi.binary_dilation(open_m, iterations=10))

alpha = np.clip(guided(im, view.astype(np.float32), 2, 2e-3), 0, 1)
inner = ndi.binary_erosion(view, iterations=3)
outer = ndi.binary_dilation(view, iterations=3)
alpha = np.where(inner, 1.0, np.where(outer, alpha, 0.0)).astype(np.float32)

# ---- 2. horizon (sky -> sea step inside the windows) and clouds
Yl = 0.299 * r + 0.587 * g + 0.114 * b
hp = []
for m, x0, x1 in wins:
    core = ndi.binary_erosion(m, iterations=8)
    for x in range(int(x0 + 0.15 * (x1 - x0)), int(x1 - 0.15 * (x1 - x0)), 3):
        rows = np.nonzero(core[:, x])[0]
        if len(rows) < 20:
            continue
        d = np.diff(Yl[rows, x])
        k = int(np.argmin(d))
        if d[k] < -0.04:
            hp.append((x, rows[k] + 0.5 + (Yl[rows[k], x] - 0.5 * (Yl[rows[k], x] + Yl[rows[k + 1], x])) / -d[k]))
hp = np.array(hp)
A = np.c_[hp[:, 0], np.ones(len(hp))]
coef = np.linalg.lstsq(A, hp[:, 1], rcond=None)[0]
for _ in range(3):                                                 # drop outliers (a cloud edge, a wave)
    res = hp[:, 1] - A @ coef
    keep = np.abs(res) < max(1.0, 3 * np.median(np.abs(res)))
    coef = np.linalg.lstsq(A[keep], hp[keep, 1], rcond=None)[0]
print(f"horizon: y = {coef[0]:.5f} x + {coef[1]:.2f} ({keep.sum()}/{len(hp)} points)")

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
hy = coef[0] * xx + coef[1]
elev = np.degrees(np.arctan((H / 2 - yy) / FOCAL) - np.arctan((H / 2 - hy) / FOCAL))
sea_cov = np.clip(yy + 0.5 - hy, 0, 1) * win                       # anti-aliased horizon, sea only in the windows
sky_here = view & (yy < hy - 1)

cloud = np.zeros((H, W), np.float32)
cloudlum = np.zeros((H, W), np.float32)
for name, region in (("open", view & ~win), ("windows", win)):
    s = region & (yy < hy - 2)
    q = np.full(H, np.inf, np.float32)
    for y in np.unique(yy[s].astype(int)):
        q[y] = np.percentile(r[y][s[y]], 35)
    clear = s & (r <= q[:, None])
    rows = np.arange(H)
    cnt = np.bincount(yy[clear].astype(int), minlength=H)
    good = cnt > 8
    if good.sum() < 2:
        continue
    cc = np.stack([np.bincount(yy[clear].astype(int), weights=im[..., k][clear], minlength=H) for k in range(3)], 1)
    cc = cc[good] / cnt[good, None]
    clear_row = np.stack([np.interp(rows, rows[good], ndi.median_filter(cc[:, k], 9, mode="nearest")) for k in range(3)], 1)
    white = np.percentile(im[s], 99.7, axis=0)
    dv = white[None, :] - clear_row                                # per row: clear -> white
    pc = im - clear_row[:, None, :]
    t = (pc * dv[:, None, :]).sum(-1) / np.maximum((dv * dv).sum(-1), 1e-6)[:, None]
    cloud = np.where(s, np.clip(t, 0, 1), cloud)
    cloudlum = np.where(s, Yd / max(float(np.percentile(Yd[s], 99.7)), 1e-4), cloudlum)
    print(f"{name}: clear {np.round(clear_row[good].mean(0) * 255)} white {np.round(white * 255)}, cloud>0.2 {(cloud[s] > 0.2).mean():.1%}")
cloud = np.clip((cloud - 0.14) / 0.86, 0, 1)
edge_d = ndi.distance_transform_edt(np.pad(view, ((1, 0), (0, 1)), constant_values=True))[1:, :-1]
cloud = ndi.gaussian_filter(cloud, 0.7) * np.clip((edge_d - 2) / 10.0, 0, 1)

# ---- 3. the night outside
pal = np.stack([hexrgb(h) for h in NIGHT])                          # sRGB, zenith -> horizon
tz = np.clip(elev / 90.0, 0, 1)                                    # 0 horizon .. 1 zenith
pos = (1 - tz) * (len(NIGHT) - 1)
i0 = np.clip(np.floor(pos).astype(int), 0, len(NIGHT) - 2)
f = (pos - i0)[..., None]
sky = lin(pal[i0] * (1 - f) + pal[i0 + 1] * f)                     # CSS-like interpolation in sRGB, then linear

# moon: the game's own full moon, low and a little warm
if MOON_XY is None:
    # clearest spot of the open sky, well inside it and high enough to light the cab from above
    dist_in = ndi.distance_transform_edt(np.pad(view & ~win, 1))[1:-1, 1:-1]   # the frame's edge counts as an edge
    score = dist_in - 400 * ndi.gaussian_filter(cloud, 12) - 0.25 * np.abs(yy - 120)
    score[(dist_in < MOON_D)] = -1e9
    my, mx_ = np.unravel_index(np.argmax(score), score.shape)
    MOON_XY = (float(mx_), float(my))
mx_, my = MOON_XY
print(f"moon at ({mx_:.0f}, {my:.0f}), elevation {elev[int(my), int(mx_)]:.1f} deg")
d = np.hypot(xx - mx_, yy - my)
R = MOON_D / 2
warm = np.array([1.0, 0.93, 0.80], np.float32)
glow = (0.018 * np.exp(-d / 230.0))[..., None] * np.array([0.80, 0.90, 1.0], np.float32) \
     + (0.060 * np.exp(-np.maximum(d - R, 0) / 22.0))[..., None] * warm
sky = sky + glow

# stars: power-law brightness, fading at the horizon, near the moon and behind cloud
N = 2600
sx, sy = rng.uniform(0, W, N), rng.uniform(0, H, N)
mag = rng.uniform(0, 1, N) ** 3.2
amp = 0.006 + 0.22 * mag
temp = rng.uniform(0, 1, N)
col = np.where(temp[:, None] < 0.55, [0.86, 0.92, 1.0], np.where(temp[:, None] < 0.88, [1.0, 0.97, 0.90], [1.0, 0.86, 0.72]))
stars = np.zeros((H, W, 3), np.float32)
for x, y, a, c in zip(sx, sy, amp, col):
    xi, yi = int(x), int(y)
    if not (2 <= xi < W - 2 and 2 <= yi < H - 2) or not sky_here[yi, xi]:
        continue
    e = elev[yi, xi]
    vis = np.clip((e - 0.5) / 7.0, 0, 1) ** 1.5 * np.clip((np.hypot(x - mx_, y - my) - 2 * R) / 260.0, 0, 1)
    if vis <= 0:
        continue
    sg = 0.55 + 0.5 * (a > 0.08)
    ox, oy = np.meshgrid(np.arange(xi - 2, xi + 3), np.arange(yi - 2, yi + 3))
    k = np.exp(-((ox + 0.5 - x) ** 2 + (oy + 0.5 - y) ** 2) / (2 * sg * sg))
    stars[yi - 2:yi + 3, xi - 2:xi + 3] += (a * vis * k)[..., None] * np.array(c, np.float32)
sky = sky + stars * ((1 - cloud) ** 2)[..., None]

mimg = Image.open(MOON).convert("RGBA")
bb = mimg.getbbox()
mimg = mimg.crop(bb).resize((MOON_D * 4, MOON_D * 4), Image.LANCZOS).resize((MOON_D, MOON_D), Image.LANCZOS)
ma = np.asarray(mimg).astype(np.float32) / 255
mrgb = lin(ma[..., :3]) * 1.15 * warm
x0, y0 = int(round(mx_ - R)), int(round(my - R))
sub = sky[y0:y0 + MOON_D, x0:x0 + MOON_D]
sky[y0:y0 + MOON_D, x0:x0 + MOON_D] = sub * (1 - ma[..., 3:]) + mrgb * ma[..., 3:]

# clouds re-lit: a little lighter than the sky, silver near the moon
near = np.exp(-d / 230.0)[..., None]
tight = np.exp(-np.maximum(d - R, 0) / 60.0)[..., None]
cl = sky * 0.75 + (0.0045 + 0.030 * near + 0.16 * tight) * (0.55 + 0.6 * cloudlum[..., None]) * np.array([0.88, 0.93, 1.0], np.float32)
sky = sky * (1 - 0.9 * cloud[..., None]) + cl * (0.9 * cloud[..., None])

# sea: the night sky mirrored, Fresnel by depression, damped by waves; the picture's own wave texture kept
dep = np.clip(-elev, 0.0, 89.0)
fres = 0.02 + 0.98 * (1 - np.sin(np.radians(dep))) ** 5
pos_m = (1 - np.clip(dep / 90, 0, 1)) * (len(NIGHT) - 1)
j0 = np.clip(np.floor(pos_m).astype(int), 0, len(NIGHT) - 2)
fm = (pos_m - j0)[..., None]
mirror = lin(pal[j0] * (1 - fm) + pal[j0 + 1] * fm)
seaY = np.where(sea_cov > 0, Yd, 0)
tex = np.zeros_like(Yd)
s = sea_cov > 0.5
blur = ndi.gaussian_filter(np.where(s, Yd, 0), 6) / np.maximum(ndi.gaussian_filter(s.astype(np.float32), 6), 1e-3)
tex[s] = (Yd[s] - blur[s]) / np.maximum(blur[s], 1e-3)
sea = mirror * (0.55 * fres)[..., None] * np.clip(1 + 2.6 * tex, 0.3, 2.5)[..., None] + np.array([0.0006, 0.0010, 0.0016], np.float32)
crest = np.clip(tex * 7.0, 0, 1) ** 2 * np.clip(1 - dep / 14.0, 0, 1)
sea = sea + (0.0030 * crest)[..., None] * np.array([0.75, 0.85, 1.0], np.float32)
# faint wave streaks (the day sea is a flat gradient): noise laid on the water plane, so it compresses toward the horizon
pb = np.maximum(yy - hy, 0.5)                                       # px below the horizon
nz = ndi.gaussian_filter(rng.standard_normal((512, 2048)).astype(np.float32), (1.0, 6.0), mode="wrap")
nz /= nz.std()
wu = np.mod((xx - W / 2) / pb * 40.0, 2048).astype(np.float32)
wv = np.mod(6000.0 / pb, 512).astype(np.float32)
wave = cv2.remap(nz, wu, wv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
sea = sea * np.clip(1 + 0.30 * wave, 0.5, 1.8)[..., None] \
    + (0.0040 * np.clip(wave - 1.0, 0, 2) ** 2 * np.clip(1 - pb / 220.0, 0, 1))[..., None] * np.array([0.75, 0.85, 1.0], np.float32)
outside = sky * (1 - sea_cov[..., None]) + sea * sea_cov[..., None]
outside = outside * np.where(win, GLASS, 1.0)[..., None]

# ---- 4. the cab in moonlight
Yn = 0.30 * np.power(Yd, 1.45) + 0.0022
tt = np.clip(Yn / 0.11, 0, 1)[..., None]                          # 0 shadow .. 1 moonlit
keep = 0.22 + 0.16 * tt
desat = Yd[..., None] + (L - Yd[..., None]) * keep
tint = (1 - tt) * np.array([0.717, 1.004, 1.793], np.float32) + tt * np.array([0.869, 1.010, 1.293], np.float32)
night = desat * (Yn / np.maximum(Yd, 1e-5))[..., None] * tint
# (1) near the outside, take the cab's colour from just inside it, so no old sky bleeds into the edges
band = ndi.binary_dilation(view, iterations=3)
_, (iy, ix) = ndi.distance_transform_edt(band, return_indices=True)
skyish = np.clip(((b - r) - 0.10) / 0.05, 0, 1) * band
night = night * (1 - skyish[..., None]) + night[iy, ix] * skyish[..., None]

out = night * (1 - alpha[..., None]) + outside * alpha[..., None]
rr = np.hypot((xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2)) / np.sqrt(2)
out = out * (1 - 0.32 * rr ** 2)[..., None]

o = srgb(out) * 255 + rng.triangular(-0.5, 0, 0.5, out.shape).astype(np.float32)   # dither: no banding in the dark
o8 = np.clip(np.round(o), 0, 255).astype(np.uint8)
base = os.path.splitext(os.path.basename(SRC))[0]
Image.fromarray(o8).save(os.path.join(OUT, f"{base} (night).png"))

# debug sheet: alpha | sea | clouds
dbg = np.concatenate([np.stack([alpha] * 3, -1), np.stack([sea_cov] * 3, -1), np.stack([cloud] * 3, -1)], 1)
Image.fromarray((dbg * 255).astype(np.uint8)).resize((W * 3 // 4, H // 4)).save(os.path.join(OUT, "dbg_masks.png"))
side = np.concatenate([np.asarray(Image.open(SRC).convert("RGB")), o8], 1)
Image.fromarray(side).resize((W, H // 2), Image.LANCZOS).save(os.path.join(OUT, "compare.png"))
print("saved")

for pt in os.environ.get("NIGHT_PROBE", "").split(";"):
    if pt:
        x, y = map(int, pt.split(","))
        print(f"({x},{y}) view {int(view[y, x])} win {int(win[y, x])} alpha {alpha[y, x]:.2f} cloud {cloud[y, x]:.2f} "
              f"sky_here {int(sky_here[y, x])} day {np.round(im[y, x] * 255)} night {np.round(srgb(night[y, x]) * 255)} "
              f"outside {np.round(srgb(outside[y, x]) * 255)} stars {stars[y, x].sum():.4f} out {o8[y, x]}")
