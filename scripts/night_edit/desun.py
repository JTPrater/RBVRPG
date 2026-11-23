"""The game's day pictures WITHOUT their sun and cast shadows (2026-11-21; blender/tod_renders/monday/PLAN.md, "DE-SUN").

The night and sunset edits kept the day picture's sun patches and hard shadows (they came out as bright "moonlit"
patches). The Blender model knows where the sun falls: for each located view it is rendered twice in its own day light,
with the sun and with the sun's energy 0 (blender/tod_renders/tod_render.py, TOD_RB=1, modes day / daynosun, into
work/desun_raw/day|daynosun). Both renders hold the same paint, so in light units (u = -ln(1 - linear), the Roblox display
law) their quotient is the sun's share alone: 1 in shadow, about 0.2 in full sun. That quotient, its edges snapped to
the PICTURE's own edges (a guided filter with the picture's log luminance as the guide) and scaled by one gain a picture
(so that the picture's lit and shaded sides come level), multiplies the picture's light: the picture as under an even sky.
Nothing is generated: every pixel is the day picture's own, darker where the sun lay.

python -I desun.py <name> [<name> ...] | --all      ->  work/desun/<name>.png (+ work/desun/dbg/<name>.jpg: before | after)
Env: DESUN_R (filter radius at 1920 wide, 22), DESUN_EPS (0.06), DESUN_GAIN (fix the gain; else fitted, 0.6 .. 1.5)."""
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
G = os.path.normpath(os.path.join(HERE, "..", "..", "public", "images", "animations", "locations", "britannic"))
W = os.path.join(HERE, "work")
R, EPS = int(os.environ.get("DESUN_R", "22")), float(os.environ.get("DESUN_EPS", "0.06"))
GAIN = os.environ.get("DESUN_GAIN")
R2 = int(os.environ.get("DESUN_R2", "70"))
RB, EPSB = int(os.environ.get("DESUN_RB", "30")), float(os.environ.get("DESUN_EPSB", "0.10"))   # the picture's base: radius, edge keeping
C_HI, MARGIN = float(os.environ.get("DESUN_C", "0.25")), float(os.environ.get("DESUN_MARGIN", "0.30"))
CLOSE = int(os.environ.get("DESUN_CLOSE", "121"))                         # the scale of a sun patch (px at 1920 wide)
E = 0.01                                                           # a floor on the light (u) in the quotient


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def to_u(d):
    return -np.log(np.clip(1.0 - d, 1e-4, 1.0))


def read_rgba16(p):
    a = cv2.imread(p, cv2.IMREAD_UNCHANGED)
    assert a is not None and a.ndim == 3 and a.shape[2] == 4, p
    a = a.astype(np.float64) / (65535.0 if a.dtype == np.uint16 else 255.0)
    return a[..., [2, 1, 0]], a[..., 3]


def box(x, r):
    return cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1), borderType=cv2.BORDER_REFLECT)


def guided(I, p, r, eps):
    mI, mp = box(I, r), box(p, r)
    var = box(I * I, r) - mI * mI
    a = (box(I * p, r) - mI * mp) / (var + eps)
    b = mp - a * mI
    return box(a, r) * I + box(b, r), a, var


def one(name):
    P = cv2.imread(os.path.join(G, name + ".png"), cv2.IMREAD_COLOR)
    assert P is not None, name
    P = P[..., ::-1].astype(np.float64) / 255.0
    h, w = P.shape[:2]
    F, aF = read_rgba16(os.path.join(W, "desun_raw", "day", name + ".png"))
    N, aN = read_rgba16(os.path.join(W, "desun_raw", "daynosun", name + ".png"))
    uF, uN = to_u(lin(F)), to_u(lin(N))
    q = np.minimum(0.0, np.log((uN + E) / (uF + E)))               # the sun only adds light
    al = np.minimum(aF, aN)
    q[al < 0.5] = 0.0
    q = cv2.GaussianBlur(q, (0, 0), 1.0)
    q = cv2.resize(q, (w, h), interpolation=cv2.INTER_LINEAR)
    al = cv2.resize(al, (w, h), interpolation=cv2.INTER_LINEAR)
    uP = to_u(lin(P))
    lum = uP @ np.array([0.2126, 0.7152, 0.0722])
    I = np.log(lum + 0.02)
    r = max(4, int(round(R * w / 1920.0)))
    qm = q.mean(axis=2)
    # (third way, 2026-11-21 late; the two before it are in monday/PLAN.md.) The picture's own LARGE-SCALE light, B, an
    # edge-preserving base of its log luminance (its sun patches keep their sharp edges in it); the model says only how
    # bright the SHADE of each surface should be: the no-sun render's log luminance, blurred wide (so its being a few
    # pixels off does not matter) and shifted to the picture's level where the model has shade. What the picture has
    # over that, beyond a margin, is sun: it is brought down to a share C_HI of itself. The detail (planks, rivets) is
    # the picture's, untouched.
    rb = max(6, int(round(RB * w / 1920.0)))
    B, _, _ = guided(I, I, rb, EPSB)
    lumN = cv2.resize(uN @ np.array([0.2126, 0.7152, 0.0722]), (w, h), interpolation=cv2.INTER_LINEAR)
    kc = max(9, int(round(CLOSE * w / 1920.0)) | 1)                # the model's small dark things (its windows, doors, ladders stand
    lumN = cv2.morphologyEx(lumN.astype(np.float32), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kc, kc)))
    ko = max(5, int(round(0.25 * kc)) | 1)                         # (and its small bright ones: frames, ladders)
    lumN = cv2.morphologyEx(lumN, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ko, ko))).astype(np.float64)
    ship = (al > 0.5).astype(np.float64)                           # elsewhere than the picture's): closed over, the paint's shade left
    sg = 14.0 * w / 1920.0
    Sm = cv2.GaussianBlur(np.log(lumN + 0.02) * ship, (0, 0), sg) / np.maximum(cv2.GaussianBlur(ship, (0, 0), sg), 1e-3)
    shade = (qm > -0.1) & (al > 0.9)
    off = float(np.median((B - Sm)[shade])) if shade.sum() > 2000 else 0.0
    ex = B - Sm - off
    cut = (1.0 - C_HI) * np.clip(ex - MARGIN, 0.0, None)
    inner = cv2.erode((al > 0.5).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(np.float64)
    inner = cv2.GaussianBlur(inner, (0, 0), 3.0)
    mx, mn = P.max(axis=2), P.min(axis=2)                          # the sky seen past a part the model has a little elsewhere: blue and
    sky = ((P[..., 2] >= P[..., 0] + 0.10) & (mx > 0.45) & ((mx - mn) > 0.18 * mx)).astype(np.float32)      # bright; never the ship's paint
    sky = cv2.GaussianBlur(cv2.dilate(sky, np.ones((5, 5), np.uint8)), (0, 0), 2.0).astype(np.float64)
    inner = inner * (1.0 - np.clip(sky, 0.0, 1.0))
    f = np.exp(-cut * inner)                                       # one factor for the three channels: no colour shift
    out_u = uP * f[..., None]
    g = off
    keep = inner
    gm = -cut
    sel = shade
    D = srgb(1.0 - np.exp(-out_u))
    os.makedirs(os.path.join(W, "desun", "dbg"), exist_ok=True)
    cv2.imwrite(os.path.join(W, "desun", name + ".png"), (np.clip(D, 0, 1) * 255.0 + 0.5).astype(np.uint8)[..., ::-1])
    both = np.concatenate([cv2.resize(P, (960, 540)), cv2.resize(D, (960, 540))], axis=1)
    cv2.imwrite(os.path.join(W, "desun", "dbg", name + ".jpg"), (np.clip(both, 0, 1) * 255.0 + 0.5).astype(np.uint8)[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, 88])
    took = (cut > 0.2) & (al > 0.5)
    print("DESUN %-34s shade offset %+.2f; sun taken down on %.0f %% of the ship (mean cut %.2f in log light)" % (
        name, off, 100.0 * float(took.sum()) / max(1.0, float((al > 0.5).sum())), float(cut[took].mean()) if took.any() else 0.0), flush=True)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["--all"]:
        args = [os.path.splitext(l.rstrip("\n").split("\t")[1])[0] for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
    for n in args:
        try:
            one(n)
        except Exception as e:                                     # one picture's failure does not stop the set
            print("DESUN FAIL", n, repr(e)[:200], flush=True)
