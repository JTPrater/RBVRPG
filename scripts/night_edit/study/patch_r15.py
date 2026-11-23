"""Round 15 (2026-11-23). night4.py section 3 (the sun under deckheads): the material classes were hard colour limits on
8-bit colour, and white paint in a deckhead's blue shade sits on the limit (ln(B/G) about 0.22 .. 0.40), so a pixel was in the
class and its neighbour not: one was brought down as "sun", the other left, a dither of light and dark specks in bands along
every beam (the user's "weird artifacts"; it went on into the night's base and the albedo). Now: the class of a pixel is read
from the picture without its 8-bit grain (a small blur), it is a WEIGHT with soft limits, white paint's class takes in its blue
shade, and the shift is applied by the weight."""
import ast
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "night4.py")
s = open(p, encoding="utf-8").read()
i0 = s.index("    u = np.log(np.maximum(L[..., 0], 1e-4) / np.maximum(L[..., 1], 1e-4))\n    w = np.log(np.maximum(L[..., 2], 1e-4) / np.maximum(L[..., 1], 1e-4))\n    usable = cov & (Yd > 0.004)\n")
i1 = s.index("    sunp = np.clip(cv2.GaussianBlur(sunp, (0, 0), 1.2), 0, 1)\n")
new = '''    # (2026-11-23) the classes: soft, read from the picture without its 8-bit grain; white paint's takes in its blue shade
    Lb_ = cv2.GaussianBlur(L, (0, 0), 1.5)
    u = np.log(np.maximum(Lb_[..., 0], 1e-4) / np.maximum(Lb_[..., 1], 1e-4))
    w = np.log(np.maximum(Lb_[..., 2], 1e-4) / np.maximum(Lb_[..., 1], 1e-4))
    usable = cov & (Yd > 0.004)

    def _ramp(x_, a_, b_):
        return np.clip((x_ - a_) / (b_ - a_), 0, 1)
    classes = {"neutral": (1 - _ramp(np.abs(u), 0.10, 0.16)) * (1 - _ramp(w, 0.42, 0.55)) * (1 - _ramp(-w, 0.18, 0.26)),
               "warm": _ramp(u, 0.10, 0.16) * _ramp(-w, 0.03, 0.08)}
    for name, wgt in classes.items():
        wgt = (wgt * usable).astype(np.float32)
        m = wgt > 0.5
        if m.sum() < 500:
            continue
        mf = m.astype(np.float32)
        lvl, _ = masked_blur(logY, mf, 40)
        hi = m & (logY > lvl + 0.35)
        shade_m = m & ~hi
        gshade = float(logY[shade_m].mean()) if shade_m.any() else float(logY[m].mean())
        lvl2, d2 = masked_blur(logY, shade_m.astype(np.float32), 90)
        lvl2 = np.where(d2 > 0.03, lvl2, gshade)
        hi = m & (logY > lvl2 + 0.35)
        lvl2, d2 = masked_blur(logY, (m & ~hi).astype(np.float32), 90)
        lvl2 = np.where(d2 > 0.03, lvl2, gshade)
        ex = logY - lvl2
        p = np.clip((ex - np.log(1.8)) / 0.25, 0, 1) * wgt              # clearly brighter than its shade: sun
        # the patch's own level, so its grain is kept when it is brought down
        pl, pd = masked_blur(logY, (p > 0.5).astype(np.float32), 6)
        sh = np.where(pd > 0.05, pl - lvl2, ex)
        sunp = np.maximum(sunp, p)
        shiftlog = np.maximum(shiftlog, p * np.clip(sh, 0, 3.5))
'''
s = s[:i0] + new + s[i1:]
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("round 15 patched: night4.py section 3")
