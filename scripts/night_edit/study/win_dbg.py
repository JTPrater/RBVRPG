"""Why was a window not found? python -I win_dbg.py <name> x0 y0 x1 y1 : what win6's colour masks cover in the box."""
import json, os, sys
import cv2
import numpy as np
from scipy import ndimage as ndi
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = os.path.normpath(os.path.join(HERE, "..", "..", "public", "images", "animations", "locations", "britannic"))
name = sys.argv[1]
x0, y0, x1, y1 = [int(v) for v in sys.argv[2:6]]
bgr = cv2.imread(os.path.join(G, name + ".png"))
H, W = bgr.shape[:2]
rgb = bgr[..., ::-1].astype(np.float32) / 255.0
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
Y = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
mx, mn = rgb.max(-1), rgb.min(-1)
sat = (mx - mn) / np.maximum(mx, 1e-6)
mp = os.path.join(HERE, "work", "auto_night", "dbg", name + ".mask.png")
outside = (cv2.imread(mp, cv2.IMREAD_UNCHANGED) > 127) if os.path.exists(mp) else np.zeros((H, W), bool)
paint = (sat < 0.24) & (Y > 0.10) & ~outside
bars = (r > 0.035) & (Y < 0.24) & ((g < 0.42 * r) | ((b > 0.75 * g) & (r > 1.45 * g) & (r > 1.45 * b))) & (r > 1.3 * b) & ~outside
wood0 = (r > g + 0.05) & (g > b + 0.015) & (Y > 0.06)
bars2 = (Y < 0.42) & (r > 0.25) & (g < 0.48 * r) & (b < 0.42 * r) & ~outside
bhat = cv2.morphologyEx(Y, cv2.MORPH_BLACKHAT, np.ones((11, 11), np.uint8))
red_ = (r - 0.5 * (g + b)) / np.maximum(Y, 0.05)
bars3 = (bhat > 0.05) & (red_ > 0.14) & (b >= g - 0.012) & (Y < 0.45) & ~wood0 & ~outside
navy = (Y < 0.24) & (Y > 0.02) & ((b - r) > 0.03) & ((b - r) < 0.30) & (g >= r - 0.01) & (b >= g - 0.02) & ~outside
s = (slice(y0, y1), slice(x0, x1))
n = float((y1 - y0) * (x1 - x0))
print(name, [x0, y0, x1, y1], "outside %.2f paint %.2f bars %.2f bars_sun %.2f bars_hazy %.2f navy %.2f wood %.2f" % (
    outside[s].sum() / n, paint[s].sum() / n, bars[s].sum() / n, bars2[s].sum() / n, bars3[s].sum() / n, navy[s].sum() / n, wood0[s].sum() / n))
rest = ~(paint | bars | bars2 | bars3 | navy | outside)[s]
px = (rgb[s][rest] * 255).astype(int)
if len(px):
    print("  neither (%.2f): median %s  p10 %s  p90 %s" % (rest.sum() / n, np.median(px, 0).astype(int), np.percentile(px, 10, 0).astype(int), np.percentile(px, 90, 0).astype(int)))
for nm, m in (("navy", navy), ("bars", bars | bars2 | bars3)):
    px = (rgb[s][m[s]] * 255).astype(int)
    if len(px):
        print("  %s median %s" % (nm, np.median(px, 0).astype(int)))
j = json.load(open(os.path.join(HERE, "work", "win6", name + ".w5.json")))
print("  rejected:", j["rejected"])
for w in j["windows"]:
    bx = w["box"]
    if bx[0] < x1 and bx[2] > x0 and bx[1] < y1 and bx[3] > y0:
        print("  instance", w["id"], bx, w["cls"], w["src"], w["px"], w["note"])
