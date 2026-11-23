"""Where do the game's materials sit in light units, in sun and in shade? (2026-11-22, a study for a picture-only sun removal.)
For each picture: the density of solid pixels over x = ln(uR/uB) (warmth), y = ln(uG) (brightness), u = -ln(1 - linear)."""
import os, sys
import cv2
import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = os.path.normpath(os.path.join(HERE, "..", "..", "public", "images", "animations", "locations", "britannic"))


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def plot(n):
    P = cv2.imread(os.path.join(G, n + ".png"))[..., ::-1].astype(np.float64) / 255
    m = cv2.imread(os.path.join(HERE, "work", "auto_night", "dbg", n + ".mask.png"), 0)
    solid = (m < 128) if m is not None else np.ones(P.shape[:2], bool)
    u = -np.log(np.clip(1 - lin(P), 1e-4, 1))
    u = np.maximum(u, 1e-4)
    x = np.log(u[..., 0] / u[..., 2])[solid]
    y = np.log(u[..., 1])[solid]
    Hh, xe, ye = np.histogram2d(x, y, bins=(300, 300), range=((-1.2, 3.0), (-6.0, 2.2)))
    im = np.log1p(Hh.T[::-1])
    im = (im / im.max() * 255).astype(np.uint8)
    im = cv2.applyColorMap(im, cv2.COLORMAP_INFERNO)
    im = cv2.resize(im, (600, 600), interpolation=cv2.INTER_NEAREST)
    for xv in (-1, 0, 1, 2):
        px = int((xv + 1.2) / 4.2 * 600)
        cv2.line(im, (px, 0), (px, 599), (90, 90, 90), 1)
        cv2.putText(im, str(xv), (px + 2, 595), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
    for yv in (-5, -4, -3, -2, -1, 0, 1, 2):
        py = int((2.2 - yv) / 8.2 * 600)
        cv2.line(im, (0, py), (599, py), (90, 90, 90), 1)
        cv2.putText(im, str(yv), (2, py - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
    cv2.putText(im, n + "  x ln(uR/uB), y ln(uG)", (40, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
    return im


names = sys.argv[2:]
tiles = [plot(n) for n in names]
cv2.imwrite(sys.argv[1], np.concatenate(tiles, 1), [cv2.IMWRITE_JPEG_QUALITY, 92])
