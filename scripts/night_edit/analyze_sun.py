"""python -I analyze_sun.py <image> x0 y0 x1 y1 [...more boxes]
For each box: 2-means on luminance (log), the mean log-RGB of the bright and dark clusters, their difference
(the sun's own log-colour shift if the box is one material in sun and shade), and the luminance ratio."""
import sys

import numpy as np
from PIL import Image


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


im = lin(np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float64) / 255)
a = [int(v) for v in sys.argv[2:]]
for k in range(0, len(a), 4):
    x0, y0, x1, y1 = a[k:k + 4]
    p = im[y0:y1, x0:x1].reshape(-1, 3)
    p = p[(p > 0.004).all(1)]
    lg = np.log(p)
    Y = lg @ np.array([0.2126, 0.7152, 0.0722])
    c = np.percentile(Y, [25, 75])
    for _ in range(20):
        lab = np.abs(Y[:, None] - c[None, :]).argmin(1)
        c = np.array([Y[lab == i].mean() for i in (0, 1)])
    dark, bright = lg[lab == 0], lg[lab == 1]
    d = bright.mean(0) - dark.mean(0)
    srgb = lambda x: np.round(255 * np.where(x <= 0.0031308, 12.92 * x, 1.055 * x ** (1 / 2.4) - 0.055))
    print(f"box {a[k:k+4]}: n {len(dark)}/{len(bright)}; dark sRGB {srgb(np.exp(dark.mean(0)))} bright sRGB {srgb(np.exp(bright.mean(0)))}; "
          f"dlog {np.round(d, 3)} (minus mean {np.round(d - d.mean(), 3)}); lum ratio {np.exp(c[1] - c[0]):.2f}; "
          f"spread dark {np.round(dark.std(0), 3)} bright {np.round(bright.std(0), 3)}")
