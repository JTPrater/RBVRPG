"""Fit the clickable room outlines in public/game/data/deckRooms.js to the redrawn deck maps.

    python scripts/deckmaps/room_outlines.py [--check] [deck ...]

Each map (public/images/decks/<deck>.jpg) is split into wall-bounded spaces: its ink, minus
the red centreline, with hairline gaps sealed. Every room on the clickable decks has an entry
in room_overrides.json saying which spaces make it up (coordinates are map pixels):

  "seeds":   [[x, y], ...]  take the whole space under each point
  "clip":    [[x, y], ...]  take the space under each point, but only inside "guide"
  "guide":   [[x, y], ...]  polygon limiting "clip" (an open deck shared by several rooms)
  "exclude": [poly, ...]    cut these polygons out
  "mirror":  true           add the mirror image across the deck's red centreline
  "close":   n              bridge gaps up to n px between the parts (default 9)
  "shape":   "box"          use the bounding rectangle (cabins: ignores door swings)
  "polygon": [[x, y], ...]  use this outline as given

Outlines are grown 2 px to the wall centrelines. Where rooms overlap, the smaller room keeps
the pixels, so cabins keep their walls and a promenade gives way to the cafe on it; a room left
with another room inside it gets a 3 px keyhole so it stays a single SVG polygon.

Writes each room's coordinates, its x/y marker (if it has one: re-placed at the outline's
centre, in percent of the map) and the decks' view boxes into deckRooms.js. --check writes
nothing there; it only renders previews to scripts/deckmaps/work/<deck>.png and reports how
far the result differs from the file. show_spaces.py and grid_zoom.py help pick seeds.
"""
import argparse
import json
import os
import re
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
MAPS = os.path.join(ROOT, "public", "images", "decks")
GAME_JS = os.path.join(ROOT, "public", "game", "data", "deckRooms.js")
OVERRIDES = os.path.join(HERE, "room_overrides.json")
WORK = os.path.join(HERE, "work")
DECKS = ["boat_deck", "a_deck", "b_deck", "c_deck", "d_deck"]
CLASS_BGR = {"first": (247, 149, 65), "second": (111, 191, 63), "third": (58, 168, 224), "crew": (58, 83, 224)}
HOLE_MAX = 6000     # lettering, stair hatching and the like inside a room: filled
GROW = 2


# --- deckRooms.js ---------------------------------------------------------------------------
def span(text, name):
    """(start, end) of the JSON object literal in `const <name> = {...};`."""
    i = text.index("{", text.index("const %s =" % name))
    depth, j, in_str, esc = 0, i, False, False
    while True:
        c = text[j]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i, j + 1
        j += 1


def load(name, text):
    a, b = span(text, name)
    return json.loads(text[a:b])


def points(coord):
    v = [float(t) for t in re.split(r"[\s,]+", coord.strip()) if t]
    return np.array(v, np.float64).reshape(-1, 2)


def fmt(p):
    return " ".join("%d,%d" % (round(x), round(y)) for x, y in p)


# --- spaces -------------------------------------------------------------------------------
def red_mask(img):
    b, g, r = (img[..., k].astype(np.int16) for k in range(3))
    return (r > 120) & (r - g > 50) & (r - b > 50)


def spaces(img):
    """Label the free space between the walls (4-connected); label 0 is the walls."""
    red = red_mask(img)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    walls = ((gray < 175) & ~red).astype(np.uint8)
    walls = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    _, lab = cv2.connectedComponents((walls == 0).astype(np.uint8), connectivity=4)
    return lab


def centreline_row(img):
    return int(np.median(np.nonzero(red_mask(img))[0]))


def seed_label(lab, x, y, reach=8):
    """Space under a point; if it falls on ink (lettering), the commonest space nearby."""
    v = int(lab[int(y), int(x)])
    if v:
        return v
    win = lab[max(0, int(y) - reach):int(y) + reach + 1, max(0, int(x) - reach):int(x) + reach + 1]
    vals = win[win > 0]
    return int(np.bincount(vals).argmax()) if len(vals) else 0


def raster(poly, h, w):
    m = np.zeros((h, w), np.uint8)
    cv2.fillPoly(m, [np.round(np.asarray(poly, np.float64)).astype(np.int32)], 1)
    return m


def fill_holes(m, hole_max):
    """Fill enclosed background components no bigger than hole_max."""
    ys, xs = np.nonzero(m)
    if not len(xs):
        return m
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    sub = np.pad(m[y0:y1, x0:x1], 1)
    n, lab, st, _ = cv2.connectedComponentsWithStats((sub == 0).astype(np.uint8), connectivity=4)
    outer = lab[0, 0]
    fill = np.zeros(n, bool)
    for i in range(1, n):
        fill[i] = i != outer and st[i, cv2.CC_STAT_AREA] <= hole_max
    sub = np.where(fill[lab], 1, sub).astype(np.uint8)
    out = m.copy()
    out[y0:y1, x0:x1] = sub[1:-1, 1:-1]
    return out


def room_mask(rid, o, lab, cl_row):
    h, w = lab.shape
    if "polygon" in o:
        return raster(o["polygon"], h, w)
    m = np.zeros((h, w), bool)
    if o.get("seeds"):
        m |= np.isin(lab, [seed_label(lab, x, y) for x, y in o["seeds"]])
    if o.get("clip"):
        if "guide" not in o:
            sys.exit("%s: \"clip\" needs a \"guide\" polygon" % rid)
        g = cv2.dilate(raster(o["guide"], h, w), np.ones((5, 5), np.uint8)) > 0
        m |= np.isin(lab, [seed_label(lab, x, y) for x, y in o["clip"]]) & g
    if o.get("mirror"):
        m |= m[np.clip(2 * cl_row - np.arange(h), 0, h - 1), :]
    for ex in o.get("exclude", []):
        m &= raster(ex, h, w) == 0
    m8 = m.astype(np.uint8)
    if not m8.any():
        sys.exit("%s: its seeds found no space" % rid)
    close = o.get("close", 9)
    if close:
        m8 = cv2.morphologyEx(m8, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close, close)))
    if o.get("shape") == "box":
        ys, xs = np.nonzero(m8)
        g = GROW
        return raster([[xs.min() - g, ys.min() - g], [xs.max() + g, ys.min() - g], [xs.max() + g, ys.max() + g],
                       [xs.min() - g, ys.max() + g]], h, w)
    m8 = fill_holes(m8, o.get("hole_max", HOLE_MAX))
    m8 = cv2.dilate(m8, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * GROW + 1, 2 * GROW + 1)))
    for ex in o.get("exclude", []):
        m8[raster(ex, h, w) > 0] = 0
    return m8


def keyholes(m, min_hole=30):
    """Fill tiny holes; cut a 3 px slit from each remaining hole to the room's outside along
    the shortest of the four directions."""
    m = fill_holes(m, min_hole)
    h, w = m.shape
    n, lab = cv2.connectedComponents((m == 0).astype(np.uint8), connectivity=4)
    outer = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
    for i in range(1, n):
        if i in outer:
            continue
        ys, xs = np.nonzero(lab == i)
        best = None
        for (y, x), (dy, dx) in (((ys.min(), xs[ys.argmin()]), (-1, 0)), ((ys.max(), xs[ys.argmax()]), (1, 0)),
                                 ((ys[xs.argmin()], xs.min()), (0, -1)), ((ys[xs.argmax()], xs.max()), (0, 1))):
            k = 0
            yy, xx = y + dy, x + dx
            while 0 <= yy < h and 0 <= xx < w and m[yy, xx]:
                yy, xx, k = yy + dy, xx + dx, k + 1
            if 0 <= yy < h and 0 <= xx < w and (best is None or k < best[0]):
                best = (k, y, x, yy, xx)
        if best:
            _, y, x, yy, xx = best
            cv2.line(m, (int(x), int(y)), (int(xx), int(yy)), 0, 3)
    return m


def polygon(m, eps=1.0):
    """One simple polygon: keyholes for holes, specks dropped, parts joined by thin bridges."""
    m = keyholes(m.astype(np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < 30:
            m[lab == i] = 0
    while True:
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if len(cs) <= 1:
            break
        cs = sorted(cs, key=cv2.contourArea, reverse=True)
        a = cs[0][:, 0, :].astype(np.float64)
        best = None
        for c in cs[1:]:
            b = c[:, 0, :].astype(np.float64)
            d = ((a[:, None, :] - b[None, :, :]) ** 2).sum(-1)
            i, j = np.unravel_index(np.argmin(d), d.shape)
            if best is None or d[i, j] < best[0]:
                best = (d[i, j], a[i], b[j])
        cv2.line(m, tuple(int(v) for v in best[1]), tuple(int(v) for v in best[2]), 1, 3)
    return cv2.approxPolyDP(cs[0], eps, True)[:, 0, :].astype(np.float64)


def fit_deck(img, rooms, over):
    lab = spaces(img)
    cl_row = centreline_row(img)
    masks = {}
    for r in rooms:
        if r["id"] not in over:
            sys.exit("%s has no entry in room_overrides.json" % r["id"])
        masks[r["id"]] = room_mask(r["id"], over[r["id"]], lab, cl_row) > 0
    taken = np.zeros(lab.shape, bool)
    polys = {}
    for rid in sorted(masks, key=lambda k: int(masks[k].sum())):
        m = masks[rid] & ~taken
        taken |= m
        polys[rid] = polygon(m)
    return polys


def preview(img, rooms, polys, path):
    fill = img.copy()
    for r in rooms:
        cv2.fillPoly(fill, [np.round(polys[r["id"]]).astype(np.int32)], CLASS_BGR.get(r.get("class"), CLASS_BGR["first"]))
    shown = cv2.addWeighted(fill, 0.35, img, 0.65, 0)
    for r in rooms:
        col = CLASS_BGR.get(r.get("class"), CLASS_BGR["first"])
        cv2.polylines(shown, [np.round(polys[r["id"]]).astype(np.int32)], True, tuple(int(c * 0.6) for c in col), 1,
                      cv2.LINE_AA)
    cv2.imwrite(path, shown)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="previews only; leave deckRooms.js alone")
    ap.add_argument("decks", nargs="*", choices=[[]] + DECKS, default=[])
    a = ap.parse_args()
    decks = a.decks or DECKS
    text = open(GAME_JS, encoding="utf-8", newline="").read()
    rooms_all = load("deckRooms", text)
    over_all = json.load(open(OVERRIDES, encoding="utf-8"))
    os.makedirs(WORK, exist_ok=True)
    fitted, sizes = {}, {}
    for deck in decks:
        img = cv2.imread(os.path.join(MAPS, deck + ".jpg"))
        sizes[deck] = img.shape[1::-1]
        rooms = rooms_all[deck]
        polys = fit_deck(img, rooms, over_all[deck])
        preview(img, rooms, polys, os.path.join(WORK, deck + ".png"))
        fitted[deck] = {rid: fmt(p) for rid, p in polys.items()}
        same = sum(fitted[deck][r["id"]] == r.get("coordinates") for r in rooms)
        print("%-10s %d rooms, %d unchanged from deckRooms.js" % (deck, len(rooms), same))
    if a.check:
        return

    nl = "\r\n" if "\r\n" in text else "\n"
    for name in ("deckViewBoxes", "deckRooms"):
        s, e = span(text, name)
        obj = json.loads(text[s:e])
        if json.dumps(obj, indent=2, ensure_ascii=False).replace("\n", nl) != text[s:e]:
            sys.exit("%s is not in the room editor's JSON layout; not writing" % name)
        for deck in decks:
            w, h = sizes[deck]
            if name == "deckViewBoxes":
                obj[deck] = "0 0 %d %d" % (w, h)
                continue
            for room in obj[deck]:
                room["coordinates"] = fitted[deck][room["id"]]
                if "x" in room and "y" in room:
                    p = points(room["coordinates"]).astype(np.float32)
                    mo = cv2.moments(p)
                    cx, cy = (mo["m10"] / mo["m00"], mo["m01"] / mo["m00"]) if mo["m00"] else p.mean(0)
                    room["x"], room["y"] = round(100.0 * cx / w, 1), round(100.0 * cy / h, 1)
        text = text[:s] + json.dumps(obj, indent=2, ensure_ascii=False).replace("\n", nl) + text[e:]
    open(GAME_JS, "w", encoding="utf-8", newline="").write(text)
    print("wrote", GAME_JS)


if __name__ == "__main__":
    main()
