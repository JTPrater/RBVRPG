"""Check sheets of the "sun taken out first" run: day | new night | new sunset for all 133 (blender/tod_renders/monday/qa2),
and how many pictures each set holds. python -I qa_desun.py"""
import os
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
G = os.path.join(HERE, "..", "..", "public", "images", "animations", "locations", "britannic")
W = os.path.join(HERE, "work")
OUT = os.path.join(HERE, "..", "..", "blender", "tod_renders", "monday", "qa3")
names = [l.rstrip("\n").split("\t")[1] for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
tw, th, per_row, rows = 316, 178, 2, 4
os.makedirs(OUT, exist_ok=True)
miss = {"auto_night": [], "auto_twilight": []}
k = 0
for s0 in range(0, len(names), per_row * rows):
    chunk = names[s0:s0 + per_row * rows]
    s = Image.new("RGB", (per_row * (3 * tw + 6), rows * (th + 14)), (255, 255, 255))
    d = ImageDraw.Draw(s)
    for i, n in enumerate(chunk):
        b = os.path.splitext(n)[0]
        x0, y0 = (i % per_row) * (3 * tw + 6), (i // per_row) * (th + 14)
        d.text((x0 + 2, y0 + 1), "%d %s" % (s0 + i + 1, b[:44]), fill=(0, 0, 0))
        for c, p in enumerate((os.path.join(G, n), os.path.join(W, "auto_night", b + ".png"), os.path.join(W, "auto_twilight", b + ".png"))):
            if os.path.exists(p):
                s.paste(Image.open(p).convert("RGB").resize((tw, th)), (x0 + c * tw, y0 + 13))
            elif c:
                miss["auto_night" if c == 1 else "auto_twilight"].append(b)
    k += 1
    s.save(os.path.join(OUT, "qa_%02d.jpg" % k), quality=85)
print("sheets", k, "missing", {a: len(v) for a, v in miss.items()}, [v[:3] for v in miss.values()])
