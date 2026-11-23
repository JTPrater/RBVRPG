"""python -I quad.py <out.jpg> <img1> [img2 img3 img4]: up to four pictures at half size in a 2 x 2 sheet, each with a grid
every 100 px labelled in the picture's own (full-size) coordinates and its file name."""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

out, ims = sys.argv[1], sys.argv[2:6]
try:
    font = ImageFont.truetype("arial.ttf", 11)
    big = ImageFont.truetype("arialbd.ttf", 15)
except OSError:
    font = big = ImageFont.load_default()
TW, TH = 960, 540
s = Image.new("RGB", (2 * TW, 2 * TH), (0, 0, 0))
for k, p in enumerate(ims):
    im = Image.open(p).convert("RGB")
    sc = TW / im.width
    t = im.resize((TW, int(im.height * sc)), Image.LANCZOS)
    d = ImageDraw.Draw(t)
    for x in range(100, im.width, 100):
        X = x * sc
        d.line([(X, 0), (X, t.height)], fill=(255, 255, 0) if x % 500 == 0 else (255, 40, 40), width=1)
        d.text((X + 2, 12), str(x), fill=(255, 255, 0), font=font)
    for y in range(100, im.height, 100):
        Y = y * sc
        d.line([(0, Y), (t.width, Y)], fill=(255, 255, 0) if y % 500 == 0 else (255, 40, 40), width=1)
        d.text((2, Y + 1), str(y), fill=(255, 255, 0), font=font)
    d.rectangle([0, 0, 8 + 8 * len(os.path.basename(p)), 12], fill=(0, 0, 0))
    d.text((3, -1), os.path.basename(p), fill=(0, 255, 255), font=font)
    s.paste(t, ((k % 2) * TW, (k // 2) * TH))
s.save(out, quality=88)
