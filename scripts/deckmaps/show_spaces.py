"""Number the wall-bounded spaces in part of a deck map, to pick seed points for
room_overrides.json.

    python scripts/deckmaps/show_spaces.py <deck> x0 y0 x1 y1 [--zoom Z] [--min-area N]

Writes scripts/deckmaps/work/spaces_<deck>_<x0>_<y0>.png (each space tinted and numbered) and
prints, per space: number, area, bounding box and an interior point to use as a seed.
Spaces touching the map's edge (open decks reaching past the drawing) are left untinted.
"""
import argparse
import os

import cv2
import numpy as np

from room_outlines import MAPS, WORK, spaces


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("deck")
    ap.add_argument("box", nargs=4, type=int, metavar="x0 y0 x1 y1")
    ap.add_argument("--zoom", type=float, default=2.0)
    ap.add_argument("--min-area", type=int, default=60)
    a = ap.parse_args()
    x0, y0, x1, y1 = a.box
    img = cv2.imread(os.path.join(MAPS, a.deck + ".jpg"))
    lab = spaces(img)
    area = np.bincount(lab.ravel())
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) | {0}
    sub = lab[y0:y1, x0:x1]
    rng = np.random.default_rng(7)
    base = img[y0:y1, x0:x1].copy()
    tint = base.copy()
    rows = []
    for i in np.unique(sub):
        if i in edge or area[i] < a.min_area:
            continue
        m = (lab == i).astype(np.uint8)
        ys, xs = np.nonzero(m)
        bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max(), ys.max()
        crop = np.pad(m[by0:by1 + 1, bx0:bx1 + 1], 1)
        dt = cv2.distanceTransform(crop, cv2.DIST_L2, 3)
        py, px = np.unravel_index(np.argmax(dt), dt.shape)
        rows.append((int(i), int(area[i]), (bx0, by0, bx1, by1), (int(px + bx0 - 1), int(py + by0 - 1))))
        tint[sub == i] = tuple(int(c) for c in rng.integers(60, 230, 3))
    shown = cv2.resize(cv2.addWeighted(tint, 0.45, base, 0.55, 0), None, fx=a.zoom, fy=a.zoom,
                       interpolation=cv2.INTER_CUBIC)
    for i, _, _, (px, py) in rows:
        if x0 <= px < x1 and y0 <= py < y1:
            cv2.putText(shown, str(i), (int((px - x0) * a.zoom) - 8, int((py - y0) * a.zoom) + 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 0, 0), 1, cv2.LINE_AA)
    os.makedirs(WORK, exist_ok=True)
    path = os.path.join(WORK, "spaces_%s_%d_%d.png" % (a.deck, x0, y0))
    cv2.imwrite(path, shown)
    for i, ar, b, p in sorted(rows, key=lambda r: (r[2][1] // 40, r[2][0])):
        print("%5d  area %6d  box %4d,%3d-%4d,%3d  seed %d,%d" % (i, ar, b[0], b[1], b[2], b[3], p[0], p[1]))
    print("wrote", path)


if __name__ == "__main__":
    main()
