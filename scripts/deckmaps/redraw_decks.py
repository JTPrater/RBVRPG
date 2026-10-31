"""Redraw the game's deck maps from Harland & Wolff's 1914 No. 433 (Britannic) general
arrangement scans: dark ink on white, 3200 px wide.

    python scripts/deckmaps/redraw_decks.py [--scans DIR] [--out DIR] [deck ...]

--scans  folder holding the six scans (default: ~/Downloads): 0_Profile_Tank_Top.jpg,
         1_Boat_Deck.jpg, 2_A_Deck_B_Deck.jpg, 3_C_Deck_D_Deck.jpg, 4_E_Deck_F_Deck.jpg,
         5_G_Deck_Orlop_Deck.jpg
--out    where <deck>.jpg go (default: public/images/decks)

For each deck: crop its region of the scan, flatten the linen, turn ink darkness into a soft
alpha, drop specks, straighten on the red centreline, drop lettering outside the drawing (deck
titles, the "No 433." stamp), trim, thicken the ink just enough to survive the game's display,
and save. The crop, angle and trim go to scripts/deckmaps/work/<deck>.json.

Redrawing changes the maps' pixel geometry, so run room_outlines.py afterwards.
"""
import argparse
import json
import math
import os

import cv2
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
WIDTH = 3200
PAPER = (255, 255, 255)
INK = (30, 38, 52)
ACCENT = (176, 58, 46)      # the red centreline and frame marks
SRC_LINE = 4.0              # typical wall line in the scans (px)
MIN_LINE = 1.7              # wanted at the output width (px)

# deck: (scan file, rough region x0, y0, x1, y1 in scan pixels)
DECKS = {
    "boat_deck": ("1_Boat_Deck.jpg", (2650, 2150, 12650, 4350)),
    "a_deck": ("2_A_Deck_B_Deck.jpg", (2850, 120, 13560, 2200)),
    "b_deck": ("2_A_Deck_B_Deck.jpg", (120, 2230, 17800, 4450)),
    "c_deck": ("3_C_Deck_D_Deck.jpg", (450, 380, 17850, 2290)),
    "d_deck": ("3_C_Deck_D_Deck.jpg", (850, 2270, 17900, 4330)),
    "e_deck": ("4_E_Deck_F_Deck.jpg", (450, 380, 16800, 2420)),
    "f_deck": ("4_E_Deck_F_Deck.jpg", (450, 2440, 16800, 4500)),
    "lo_deck": ("5_G_Deck_Orlop_Deck.jpg", (1400, 520, 15350, 3900)),
    "tank_deck": ("0_Profile_Tank_Top.jpg", (1150, 2480, 13750, 4620)),
}


def centreline_angle(red):
    """Rotation (deg) that levels the red centrelines. The door swings are red too, so only
    long, nearly level runs count: probabilistic Hough with a gap allowance for the dashes,
    then the length-weighted median angle."""
    h, w = red.shape
    lines = cv2.HoughLinesP(red.astype(np.uint8) * 255, 1, np.pi / 3600, 200,
                            minLineLength=int(0.15 * w), maxLineGap=250)
    if lines is None:
        return 0.0
    angs, lens = [], []
    for x1, y1, x2, y2 in lines[:, 0]:
        a = np.degrees(np.arctan2(y2 - y1, x2 - x1))
        if abs(a) < 5.0:
            angs.append(a)
            lens.append(np.hypot(x2 - x1, y2 - y1))
    if not angs:
        return 0.0
    order = np.argsort(angs)
    cum = np.cumsum(np.asarray(lens)[order])
    return float(np.asarray(angs)[order][np.searchsorted(cum, cum[-1] / 2.0)])


def drop_components(ink, test):
    """Clear the ink components for which test(stats_row) is true."""
    n, lab, stats, _ = cv2.connectedComponentsWithStats((ink > 0.30).astype(np.uint8), connectivity=8)
    kill = np.zeros(n, bool)
    for i in range(1, n):
        kill[i] = test(stats[i])
    gone = cv2.dilate(kill[lab].astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    return np.where(gone, 0.0, ink)


def process(deck, scan_dir, out_dir, work_dir):
    scan_name, box = DECKS[deck]
    src = Image.open(os.path.join(scan_dir, scan_name)).convert("RGB")
    box = (max(0, box[0]), max(0, box[1]), min(src.size[0], box[2]), min(src.size[1], box[3]))
    x0, y0, x1, y1 = box
    rgb = np.asarray(src.crop(box)).astype(np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    gray = 0.299 * r + 0.587 * g + 0.114 * b
    red = ((r - g) > 38) & ((r - b) > 38)
    bg = cv2.GaussianBlur(gray, (0, 0), 30)
    norm = np.clip(gray / np.maximum(bg, 1.0), 0.0, 1.0)
    ink = np.clip((0.93 - norm) / 0.45, 0.0, 1.0)
    ink[red] = 0.0
    mask = (ink > 0.30).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= 24
    solid = cv2.dilate(keep[lab].astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    ink = np.clip(np.where(solid, ink, 0.0) * 1.25, 0.0, 1.0)

    angle = centreline_angle(red)
    h, w = ink.shape
    rot = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), angle, 1.0)
    ink = cv2.warpAffine(ink, rot, (w, h), flags=cv2.INTER_LINEAR, borderValue=0.0)
    redf = cv2.warpAffine(red.astype(np.float32), rot, (w, h), flags=cv2.INTER_LINEAR, borderValue=0.0)

    # Trim to the drawing: the union of the large ink components - hull and deck outlines, which
    # are both long and deep, and long runs such as the tank top's shafts.
    big = (ink > 0.35).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(big, connectivity=8)
    sel = [i for i in range(1, n) if (stats[i, cv2.CC_STAT_WIDTH] > 0.08 * w
                                      and stats[i, cv2.CC_STAT_HEIGHT] > 0.12 * h)
           or stats[i, cv2.CC_STAT_WIDTH] > 0.25 * w]
    # Lettering wholly outside the outlines (deck titles, "No 433.", notes) goes: keep only ink
    # touching the convex hulls of the outlines, grown a little.
    hull = np.zeros((h, w), np.uint8)
    for i in sel:
        cs, _ = cv2.findContours((lab == i).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.fillPoly(hull, [cv2.convexHull(np.vstack(cs))], 1)
    hull = cv2.dilate(hull, np.ones((61, 61), np.uint8))
    n2, lab2 = cv2.connectedComponents((ink > 0.30).astype(np.uint8), connectivity=8)
    inside = np.bincount(lab2[hull > 0].ravel(), minlength=n2) > 0
    inside[0] = True
    gone = cv2.dilate((~inside[lab2]).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    ink = np.where(gone, 0.0, ink)
    redf = np.where(hull > 0, redf, 0.0)
    tx0 = min(stats[i, cv2.CC_STAT_LEFT] for i in sel)
    ty0 = min(stats[i, cv2.CC_STAT_TOP] for i in sel)
    tx1 = max(stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH] for i in sel)
    ty1 = max(stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT] for i in sel)
    m = 40
    tx0, ty0, tx1, ty1 = (int(v) for v in (max(0, tx0 - m), max(0, ty0 - m), min(w, tx1 + m), min(h, ty1 + m)))
    ink, redf = ink[ty0:ty1, tx0:tx1], redf[ty0:ty1, tx0:tx1]
    h, w = ink.shape
    # Lettering cut by the trim (deck titles beyond the ends): drop what touches the edge.
    ink = drop_components(ink, lambda s: (s[0] <= 1 or s[1] <= 1 or s[0] + s[2] >= w - 1
                                          or s[1] + s[3] >= h - 1) and s[2] < 0.08 * w)

    # Thicken just enough that walls stay at least MIN_LINE px wide at the output size.
    f = WIDTH / w
    rad = max(0, math.ceil((MIN_LINE / f - SRC_LINE) / 2.0))
    if rad:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * rad + 1, 2 * rad + 1))
        ink = cv2.dilate(ink, k)
        redf = cv2.dilate(redf, k)
    redf = np.clip(cv2.GaussianBlur(redf, (0, 0), 0.8), 0.0, 1.0)

    out = np.empty((h, w, 3), np.float32)
    for c in range(3):
        v = PAPER[c] * (1.0 - ink) + INK[c] * ink
        out[..., c] = v * (1.0 - redf * 0.85) + ACCENT[c] * redf * 0.85
    oh = round(h * WIDTH / w)
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).resize((WIDTH, oh), Image.LANCZOS)
    img.save(os.path.join(out_dir, deck + ".jpg"), quality=90, optimize=True)
    meta = dict(scan=scan_name, box=list(box), angle=angle, rot_centre=[(x1 - x0) / 2.0, (y1 - y0) / 2.0],
                trim=[tx0, ty0, tx1, ty1], scale=WIDTH / (tx1 - tx0), size=[WIDTH, oh], dilate=rad)
    with open(os.path.join(work_dir, deck + ".json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print(deck, "angle", round(angle, 3), "trim", (tx0, ty0, tx1, ty1), "->", (WIDTH, oh), "dilate", rad)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--scans", default=os.path.join(os.path.expanduser("~"), "Downloads"))
    ap.add_argument("--out", default=os.path.join(ROOT, "public", "images", "decks"))
    ap.add_argument("decks", nargs="*", choices=[[]] + list(DECKS), default=[])
    a = ap.parse_args()
    work = os.path.join(HERE, "work")
    os.makedirs(a.out, exist_ok=True)
    os.makedirs(work, exist_ok=True)
    for deck in a.decks or DECKS:
        process(deck, a.scans, a.out, work)


if __name__ == "__main__":
    main()
