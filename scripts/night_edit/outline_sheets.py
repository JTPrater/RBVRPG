"""python -I outline_sheets.py <mask_dir> <sheet_prefix> [names_file]
The ship's outline on each day picture: what will be replaced (sky, sea) tinted magenta, its border drawn in yellow, the
ship left as it is. A ship part tinted magenta is a leak; sky or sea left untinted is a miss. 9 a sheet (3 x 3 at 640 x 360),
in the game's room order (exterior_list.tsv)."""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

MD, PRE = sys.argv[1], sys.argv[2]
G = "C:/Users/JTP20/OneDrive/Desktop/RBVRPG/public/images/animations/locations/britannic"
HERE = os.path.dirname(os.path.abspath(__file__))
rows = [l.rstrip("\n").split("\t") for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
names = [os.path.splitext(f)[0] for _, f in rows]
if len(sys.argv) > 3:
    keep = {l.strip() for l in open(sys.argv[3], encoding="utf-8") if l.strip()}
    names = [n for n in names if n in keep]
try:
    font = ImageFont.truetype("arial.ttf", 14)
except OSError:
    font = ImageFont.load_default()
TW, TH, LH = 640, 360, 18


def tile(n):
    day = np.asarray(Image.open(f"{G}/{n}.png").convert("RGB")).astype(np.float32)
    m = np.asarray(Image.open(os.path.join(MD, n + ".mask.png"))).astype(np.float32) / 255
    tint = np.array([255, 0, 200], np.float32)
    out = day * (1 - 0.55 * m[..., None]) + tint * (0.55 * m[..., None])
    edge = (m > 0.5) & ~ndi.binary_erosion(m > 0.5, iterations=2)
    edge |= (m <= 0.5) & ndi.binary_dilation(m > 0.5, iterations=1) & ~ndi.binary_erosion(m <= 0.5, iterations=1)
    out[edge] = (255, 255, 0)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).resize((TW, TH), Image.LANCZOS)


k = 0
for i in range(0, len(names), 9):
    chunk = names[i:i + 9]
    nrow = (len(chunk) + 2) // 3
    s = Image.new("RGB", (3 * TW, nrow * (TH + LH)), (0, 0, 0))
    d = ImageDraw.Draw(s)
    for j, n in enumerate(chunk):
        x, y = (j % 3) * TW, (j // 3) * (TH + LH)
        s.paste(tile(n), (x, y + LH))
        d.text((x + 4, y + 1), f"{i + j + 1}. {n}", fill=(255, 255, 0), font=font)
    k += 1
    s.save(f"{PRE}_{k:02d}.jpg", quality=88)
print("sheets", k)
