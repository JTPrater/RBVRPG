"""Round 14 (2026-11-23, after the first full run was looked at beside the set in the game).
night4.py  the window rendering again. What the run showed: a window classed "see" whose room is dark came out as dark panes
           with bright rims (the rim of a pane is a mixture with its frame: the "room" was only that), and a room's daylit
           patches came out as blocks. A room's brightness by day says little of its brightness by night. So:
             - every window is a lit pane; its shading is the day picture's own, faint (0.78 .. 1.12 of the pane's level),
               read from the pane's INSIDE and spread to its rim (no rim lines);
             - opaque navy glass has no shading at all;
             - only a window marked "see" BY HAND (work/win5_fix.json) is drawn as its room, with the same rim care.
win6.py    the texture measure leaves out a pane's rim."""
import ast
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

p = os.path.join(HERE, "night4.py")
s = open(p, encoding="utf-8").read()
i0 = s.index('        cls = W5["m"][wid]["cls"]\n        hh_, ww_ = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start\n')
i1 = s.index("        glow[sl] = np.where(sub[..., None], g_, glow[sl])\n        emw[sl] = np.where(sub, e_, emw[sl])\n")
new = '''        cls = W5["m"][wid]["cls"]
        hh_, ww_ = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        ty = (yy[sl] - sl[0].start) / max(hh_, 1)
        _cx, _cy = 0.5 * (sl[1].start + sl[1].stop), 0.5 * (sl[0].start + sl[0].stop)
        lvl = 0.98 + 0.08 * _fld(_cx, _cy, 0)
        col = WIN_GLOW * (1 + 0.08 * _fld(_cx, _cy, 3) * np.array([0.0, 0.5, 1.0], np.float32))
        forced_see = cls == "see" and bool(W5["m"][wid].get("forced"))
        # the pane's inside (its rim is a mixture with the frame): the day picture's values there, spread to the rim
        inner = ndi.binary_erosion(core, iterations=2)
        if inner.sum() < 0.30 * core.sum():
            inner = ndi.binary_erosion(core, iterations=1)
        if inner.sum() < 0.30 * core.sum():
            inner = core
        iw_ = inner.astype(np.float32)
        den_ = cv2.GaussianBlur(iw_, (0, 0), 2.0)
        den4_ = cv2.GaussianBlur(iw_, (0, 0), 6.0)
        yv = dayY[sl]
        ext_ = np.where(den_ > 0.05, cv2.GaussianBlur(yv * iw_, (0, 0), 2.0) / np.maximum(den_, 1e-4),
                        cv2.GaussianBlur(yv * iw_, (0, 0), 6.0) / np.maximum(den4_, 1e-4))
        Yin = np.where(inner, cv2.GaussianBlur(yv, (0, 0), 0.6), ext_).astype(np.float32)
        dg = cv2.distanceTransform(core.astype(np.uint8), cv2.DIST_L2, 3)
        rec = 0.86 + 0.14 * np.clip(dg / max(2.0, 0.10 * min(hh_, ww_)), 0, 1)
        val = (0.93 + 0.12 * (1 - ty)) * rec * lvl
        if cls != "navy" and not forced_see:                # a curtain's, frosted glass's, a dim room's own shading, faintly
            p85 = max(float(np.percentile(yv[inner], 85)), 1e-3)
            val = val * cv2.GaussianBlur(np.clip(Yin / p85, 0.78, 1.12).astype(np.float32), (0, 0), 1.0)
        g_ = col[None, None, :] * (0.30 * WL * val)[..., None]
        e_ = 0.55
        if forced_see:
            # the room behind the glass, lit: its own picture as warm light. The glass's veil (the window's darkest level) is
            # taken off; what is left is scaled so that the room's bright parts reach a lit pane's level, over a floor (a lit
            # room is nowhere black), with a little of its own colour; the daylight in the room's far windows (by far its
            # brightest, and bluish) is a dark window now.
            c_ = dayL[sl]
            d_ = np.clip(Yin - float(np.percentile(yv[inner], 4)), 0, None)
            med_ = max(float(np.median(d_[inner])), 1e-4)
            far = (d_ > max(4.0 * med_, 0.06)) & (c_[..., 2] > 1.02 * c_[..., 0]) & core
            far = ndi.binary_closing(ndi.binary_opening(far, iterations=1), structure=np.ones((3, 3), bool), iterations=3)
            far = ndi.binary_fill_holes(far) & sub
            fsoft = cv2.GaussianBlur(far.astype(np.float32), (0, 0), 1.6)
            rest = inner & ~far
            p90 = max(float(np.percentile(d_[rest], 90)) if rest.any() else med_, 0.012)      # (a floor: a dark room's grain is not raised into a pattern)
            t_ = np.clip(d_ / p90, 0, 1.25)
            vs_ = (0.24 + 0.76 * t_ ** 0.9) * (1 - fsoft) + 0.12 * fsoft
            cden_ = np.maximum(den_, 1e-4)[..., None]
            cin_ = np.where((den_ > 0.05)[..., None], cv2.GaussianBlur(c_ * iw_[..., None], (0, 0), 2.0) / cden_, c_)
            chrom = cin_ / np.maximum(cin_ @ LUM, 1e-4)[..., None]
            chrom = np.clip(0.30 * chrom + 0.70, 0.6, 1.5)
            g_ = col[None, None, :] * chrom * (0.30 * WL * lvl * rec * vs_)[..., None]
            e_ = 0.40
'''
s = s[:i0] + new + s[i1:]
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)

p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()
a = '''    s = max(4.0, 0.04 * np.sqrt(float(g.sum())))
    hp = (Y - cv2.GaussianBlur(Y, (0, 0), s))[g]
'''
b = '''    s = max(4.0, 0.04 * np.sqrt(float(g.sum())))
    gi = ndi.binary_erosion(g, iterations=2)                # (a pane's rim is a mixture with its frame: no texture of the glass)
    if gi.sum() < 0.3 * g.sum():
        gi = g
    hp = (Y - cv2.GaussianBlur(Y, (0, 0), s))[gi]
'''
assert s.count(a) == 1
s = s.replace(a, b)
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("round 14 patched: night4.py (window rendering), win6.py (texture without rims)")
