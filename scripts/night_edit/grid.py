"""python -I grid.py <image> <out.jpg> [scale] [x0 y0 x1 y1]
The picture (or a crop of it) with a labelled grid every 100 px in the picture's own coordinates, for placing lights."""
import sys

from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
scale = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
im = Image.open(src).convert("RGB")
box = [int(v) for v in sys.argv[4:8]] if len(sys.argv) > 7 else [0, 0, im.width, im.height]
im = im.crop(box)
im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
d = ImageDraw.Draw(im)
try:
    font = ImageFont.truetype("arial.ttf", 11)
except OSError:
    font = ImageFont.load_default()
step = 100 if (box[2] - box[0]) > 700 else 50
x = (box[0] // step + 1) * step
while x < box[2]:
    X = (x - box[0]) * scale
    d.line([(X, 0), (X, im.height)], fill=(255, 0, 0) if x % 500 else (255, 255, 0), width=1)
    d.text((X + 2, 2), str(x), fill=(255, 255, 0), font=font)
    x += step
y = (box[1] // step + 1) * step
while y < box[3]:
    Y = (y - box[1]) * scale
    d.line([(0, Y), (im.width, Y)], fill=(255, 0, 0) if y % 500 else (255, 255, 0), width=1)
    d.text((2, Y + 2), str(y), fill=(255, 255, 0), font=font)
    y += step
im.save(out, quality=88)
