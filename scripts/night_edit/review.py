"""python -I review.py <out_dir> <sheet_prefix> [per_sheet] [tile_w]
Night results in the game's room order (exterior_list.tsv), labelled 'room: picture', per_sheet a sheet (default 9, 3 x 3)."""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

OUT, PRE = sys.argv[1], sys.argv[2]
PER = int(sys.argv[3]) if len(sys.argv) > 3 else 9
TW = int(sys.argv[4]) if len(sys.argv) > 4 else 640
HERE = os.path.dirname(os.path.abspath(__file__))
rows = [l.rstrip("\n").split("\t") for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
items = [(room, os.path.splitext(f)[0]) for room, f in rows if os.path.exists(os.path.join(OUT, os.path.splitext(f)[0] + ".png"))]
try:
    font = ImageFont.truetype("arial.ttf", 14)
except OSError:
    font = ImageFont.load_default()
TH = TW * 9 // 16
COLS = 3
k = 0
for i in range(0, len(items), PER):
    chunk = items[i:i + PER]
    nrow = (len(chunk) + COLS - 1) // COLS
    s = Image.new("RGB", (COLS * TW, nrow * (TH + 18)), (0, 0, 0))
    d = ImageDraw.Draw(s)
    for j, (room, n) in enumerate(chunk):
        x, y = (j % COLS) * TW, (j // COLS) * (TH + 18)
        im = Image.open(os.path.join(OUT, n + ".png")).convert("RGB").resize((TW, TH), Image.LANCZOS)
        s.paste(im, (x, y + 18))
        d.text((x + 4, y + 1), f"{i + j + 1}. {n}", fill=(255, 255, 0), font=font)
    k += 1
    s.save(f"{PRE}_{k:02d}.jpg", quality=86)
print("sheets", k, "pictures", len(items))
