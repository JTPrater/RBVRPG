"""python -I sheet.py <out.jpg> <tile w> <cols> <image> [<image> ...]: a plain contact sheet (labels = file names)."""
import os
import sys

from PIL import Image, ImageDraw

out, tw, cols = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ims = sys.argv[4:]
tiles = []
for p in ims:
    im = Image.open(p).convert("RGB")
    th = int(im.height * tw / im.width)
    tiles.append((im.resize((tw, th), Image.LANCZOS), os.path.basename(p)))
th = max(t.height for t, _ in tiles)
rows = (len(tiles) + cols - 1) // cols
s = Image.new("RGB", (tw * cols, (th + 16) * rows))
d = ImageDraw.Draw(s)
for i, (t, n) in enumerate(tiles):
    x, y = (i % cols) * tw, (i // cols) * (th + 16)
    s.paste(t, (x, y + 16))
    d.text((x + 4, y + 2), n, fill=(255, 255, 0))
s.save(out, quality=88)
