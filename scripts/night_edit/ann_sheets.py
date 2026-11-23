"""python -I ann_sheets.py <sheet_prefix> [names_file]
Every annotation drawn on its day picture, to check where things were put: window zones (cyan; fine zones dashed), lit
glass (orange), lit by blue (orange, dotted), left dark (red), lit interiors (green), sky (magenta), not sky (white),
sky through gaps (violet), lamps (yellow dot, kind letter, lens outline), the sun (yellow ring), the horizon (thin yellow
line), covered decks (blue tint). Only pictures with something placed; 9 a sheet (3 x 3 at 640 x 360)."""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

PRE = sys.argv[1]
G = "C:/Users/JTP20/OneDrive/Desktop/RBVRPG/public/images/animations/locations/britannic"
HERE = os.path.dirname(os.path.abspath(__file__))
rows = [l.rstrip("\n").split("\t") for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
names = [os.path.splitext(f)[0] for _, f in rows]
if len(sys.argv) > 2:
    keep = {l.strip() for l in open(sys.argv[2], encoding="utf-8") if l.strip()}
    names = [n for n in names if n in keep]
PLACED = ("zones", "zones_fine", "lit", "lit_blue", "dark", "interior", "sky", "not_sky", "sky_cand", "lamps", "sun", "moon")
try:
    font = ImageFont.truetype("arial.ttf", 14)
    small = ImageFont.truetype("arialbd.ttf", 28)
except OSError:
    font = small = ImageFont.load_default()
TW, TH, LH, S = 640, 360, 18, 3.0      # tile, label height, the picture's scale down


def shape(d, p, col, width=3, dash=False):
    if len(p) == 3 and not isinstance(p[0], (list, tuple)):
        x, y, r = p
        d.ellipse([x - r, y - r, x + r, y + r], outline=col, width=width)
    elif len(p) == 5 and not isinstance(p[0], (list, tuple)):
        x, y, rx, ry, _ = p
        d.ellipse([x - rx, y - ry, x + rx, y + ry], outline=col, width=width)
    elif len(p) == 4 and not isinstance(p[0], (list, tuple)):
        x0, y0, x1, y1 = p
        if dash:
            for a, b in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
                n = max(1, int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) / 24))
                for k in range(0, n, 2):
                    t0, t1 = k / n, min(1, (k + 1) / n)
                    d.line([(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0),
                            (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)], fill=col, width=width)
        else:
            d.rectangle([x0, y0, x1, y1], outline=col, width=width)
    else:
        pts = [tuple(q) for q in p]
        d.line(pts + [pts[0]], fill=col, width=width)


def tile(n):
    a = json.load(open(os.path.join(HERE, "ann", n + ".json"), encoding="utf-8"))
    im = Image.open(f"{G}/{n}.png").convert("RGB")
    W, H = im.size
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    cv = a.get("covered")
    if cv == "all":
        od.rectangle([0, 0, W, H], fill=(60, 120, 255, 40))
    elif cv:
        for p in cv:
            if len(p) == 4 and not isinstance(p[0], (list, tuple)):
                od.rectangle(p, fill=(60, 120, 255, 40))
            else:
                od.polygon([tuple(q) for q in p], fill=(60, 120, 255, 40))
    im = Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB")
    d = ImageDraw.Draw(im)
    if "horizon" in a:
        y0, y1 = a["horizon"]
        d.line([(0, y0), (W, y1)], fill=(255, 255, 0), width=2)
    for key, col, dash in (("zones", (0, 255, 255), False), ("zones_fine", (0, 255, 255), True), ("lit", (255, 150, 0), False),
                           ("lit_blue", (255, 150, 0), True), ("dark", (255, 0, 0), False), ("interior", (0, 255, 0), False),
                           ("sky", (255, 0, 255), False), ("not_sky", (255, 255, 255), False), ("sky_cand", (170, 90, 255), True)):
        for p in a.get(key) or []:
            shape(d, p, col, 5, dash)
    for lp in a.get("lamps", []):
        x, y = lp["p"]
        if "lens_ell" in lp:
            rx, ry = lp["lens_ell"]
            d.ellipse([x - rx, y - ry, x + rx, y + ry], outline=(255, 255, 0), width=4)
        if "lens" in lp:
            r = lp["lens"]
            d.ellipse([x - r, y - r, x + r, y + r], outline=(255, 255, 0), width=4)
        d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=(255, 255, 0))
        d.text((x + 12, y - 30), {"ceiling": "C", "wall": "W", "post": "P", "point": "pt"}.get(lp.get("k", "wall"), "?"),
               fill=(255, 255, 0), font=small)
    for key in ("sun", "moon"):
        if a.get(key):
            x, y = a[key]
            d.ellipse([x - 30, y - 30, x + 30, y + 30], outline=(255, 255, 0) if key == "sun" else (200, 200, 255), width=5)
    return im.resize((TW, TH), Image.LANCZOS)


todo = [n for n in names if any(k in json.load(open(os.path.join(HERE, "ann", n + ".json"), encoding="utf-8")) for k in PLACED)]
k = 0
for i in range(0, len(todo), 9):
    chunk = todo[i:i + 9]
    nrow = (len(chunk) + 2) // 3
    s = Image.new("RGB", (3 * TW, nrow * (TH + LH)), (0, 0, 0))
    d = ImageDraw.Draw(s)
    for j, n in enumerate(chunk):
        x, y = (j % 3) * TW, (j // 3) * (TH + LH)
        s.paste(tile(n), (x, y + LH))
        d.text((x + 4, y + 1), f"{n}", fill=(255, 255, 0), font=font)
    k += 1
    s.save(f"{PRE}_{k:02d}.jpg", quality=88)
print("sheets", k, "pictures", len(todo))
