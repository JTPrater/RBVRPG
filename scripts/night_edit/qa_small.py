"""Night-only contact sheets of a set, 30 pictures a sheet with their names (2026-11-22: the review of every picture).
python -I qa_night.py <night dir> <out dir>"""
import os, sys
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
names = [os.path.splitext(l.rstrip("\n").split("\t")[1])[0] for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
tw, th, per_row, rows = 316, 178, 6, 6
for k, s0 in enumerate(range(0, len(names), per_row * rows), 1):
    chunk = names[s0:s0 + per_row * rows]
    s = Image.new("RGB", (per_row * (tw + 4), rows * (th + 14)), (255, 255, 255))
    d = ImageDraw.Draw(s)
    for i, n in enumerate(chunk):
        x0, y0 = (i % per_row) * (tw + 4), (i // per_row) * (th + 14)
        d.text((x0 + 2, y0 + 1), "%d %s" % (s0 + i + 1, n[:52]), fill=(0, 0, 0))
        p = os.path.join(src, n + ".png")
        if os.path.exists(p):
            s.paste(Image.open(p).convert("RGB").resize((tw, th), Image.LANCZOS), (x0, y0 + 13))
    s.save(os.path.join(out, "night_%02d.jpg" % k), quality=88)
print("sheets", k)
