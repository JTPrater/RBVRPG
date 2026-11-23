"""python -I review2.py <out_dir> <sheet_prefix>
Night results in the game's room order, 12 a sheet (4 x 3 at 480 x 270), numbered and named, for the full review."""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

OUT, PRE = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
rows = [l.rstrip("\n").split("\t") for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
names = [os.path.splitext(f)[0] for _, f in rows]
try:
    font = ImageFont.truetype("arial.ttf", 13)
except OSError:
    font = ImageFont.load_default()
TW, TH, LH, COLS, PER = 480, 270, 16, 4, 12
k = 0
for i in range(0, len(names), PER):
    chunk = names[i:i + PER]
    nrow = (len(chunk) + COLS - 1) // COLS
    s = Image.new("RGB", (COLS * TW, nrow * (TH + LH)), (0, 0, 0))
    d = ImageDraw.Draw(s)
    for j, n in enumerate(chunk):
        x, y = (j % COLS) * TW, (j // COLS) * (TH + LH)
        p = os.path.join(OUT, n + ".png")
        if os.path.exists(p):
            s.paste(Image.open(p).convert("RGB").resize((TW, TH), Image.LANCZOS), (x, y + LH))
        d.text((x + 3, y + 1), f"{i + j + 1}. {n}", fill=(255, 255, 0), font=font)
    k += 1
    s.save(f"{PRE}_{k:02d}.jpg", quality=86)
print("sheets", k)
