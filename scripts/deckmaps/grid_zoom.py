"""Zoomed crop of a deck map with a labelled pixel grid and the room outlines from
deckRooms.js, for reading off coordinates.

    python scripts/deckmaps/grid_zoom.py <deck> x0 y0 x1 y1 [--zoom Z] [--step S]

Writes scripts/deckmaps/work/grid_<deck>_<x0>_<y0>.png.
"""
import argparse
import os

import cv2
import numpy as np

from room_outlines import GAME_JS, MAPS, WORK, load, points


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("deck")
    ap.add_argument("box", nargs=4, type=int, metavar="x0 y0 x1 y1")
    ap.add_argument("--zoom", type=float, default=2.0)
    ap.add_argument("--step", type=int, default=20)
    a = ap.parse_args()
    x0, y0, x1, y1 = a.box
    img = cv2.imread(os.path.join(MAPS, a.deck + ".jpg"))
    crop = cv2.resize(img[y0:y1, x0:x1], None, fx=a.zoom, fy=a.zoom, interpolation=cv2.INTER_CUBIC)
    rooms = load("deckRooms", open(GAME_JS, encoding="utf-8").read()).get(a.deck, [])
    cols = [(220, 60, 0), (0, 150, 0), (0, 0, 220), (160, 0, 160), (0, 140, 200)]
    for k, r in enumerate(rooms):
        if r.get("coordinates"):
            p = (points(r["coordinates"]) - [x0, y0]) * a.zoom
            cv2.polylines(crop, [np.round(p).astype(np.int32)], True, cols[k % len(cols)], 2, cv2.LINE_AA)
    for gx in range((x0 // a.step + 1) * a.step, x1, a.step):
        X = int((gx - x0) * a.zoom)
        cv2.line(crop, (X, 0), (X, crop.shape[0]), (0, 180, 255), 1)
        cv2.putText(crop, str(gx), (X + 2, 12), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 120, 255), 1, cv2.LINE_AA)
    for gy in range((y0 // a.step + 1) * a.step, y1, a.step):
        Y = int((gy - y0) * a.zoom)
        cv2.line(crop, (0, Y), (crop.shape[1], Y), (0, 180, 255), 1)
        cv2.putText(crop, str(gy), (2, Y - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 120, 255), 1, cv2.LINE_AA)
    os.makedirs(WORK, exist_ok=True)
    path = os.path.join(WORK, "grid_%s_%d_%d.png" % (a.deck, x0, y0))
    cv2.imwrite(path, crop)
    print("wrote", path)


if __name__ == "__main__":
    main()
