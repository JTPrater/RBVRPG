"""win6.py round 8: classify gives the texture measure (night4 blends the flat and the see-through rendering by it); panes of
one window (frame, bars or white muntins between them) are one instance; a bar structure on an annotated port is the port's.
night4.py: one window rendering, blended by that texture measure."""
import ast
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()


def sub(a, b, n=1):
    global s
    assert s.count(a) == n, (s.count(a), a[:90])
    s = s.replace(a, b)


sub('''    if forced:
        return forced, note
    if float(lum(med)) < 0.30 and (med[2] - med[0]) > 0.012 and tex < 0.30 and cstd < 0.060:
        return "navy", note
    if tex >= 0.22 or cstd >= 0.060:
        return "see", note
    return "pale", note
''', '''    if forced:
        return forced, note, (1.0 if forced == "see" else 0.0)
    if float(lum(med)) < 0.30 and (med[2] - med[0]) > 0.012 and tex < 0.30 and cstd < 0.060:
        return "navy", note, tex
    if tex >= 0.22 or cstd >= 0.060:
        return "see", note, tex
    return "pale", note, tex
''')
sub('''    def add(gl, cls, src, note, box):
        k = len(meta) + 1
        inst[gl & (inst == 0)] = k
        meta.append(dict(id=k, box=box, cls=cls, src=src, px=int(gl.sum()), note=note))
''', '''    def add(gl, cls, src, note, box, tex=0.0, forced=False):
        k = len(meta) + 1
        inst[gl & (inst == 0)] = k
        meta.append(dict(id=k, box=box, cls=cls, src=src, px=int(gl.sum()), note=note, tex=round(float(tex), 3), forced=bool(forced)))
''')
sub('''cls, note = classify(sub_rgb, enclosed if enclosed.sum() >= 30 else gl, forced)''',
    '''cls, note, tex_ = classify(sub_rgb, enclosed if enclosed.sum() >= 30 else gl, forced)''')
sub('''cls=cls, note=note, anchor=anchor))''', '''cls=cls, note=note, anchor=anchor, tex=tex_, forced=bool(forced)))''')
sub('''[int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1])
        # ---- take: navy groups''', '''[int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1], tex=q["tex"], forced=q["forced"])
        # ---- take: navy groups''')
sub('''        cls, note = classify(rgb, gl, fcls)
        ys, xs = np.nonzero(gl)
        add(gl, cls, "add", note, [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1])''',
    '''        cls, note, tex_ = classify(rgb, gl, fcls)
        ys, xs = np.nonzero(gl)
        add(gl, cls, "add", note, [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1], tex=tex_, forced=bool(fcls))''')
# ports
sub('''                if woody and not anchor:
                    no("a small orange frame")
                    continue
''', '''                if woody and not anchor:
                    no("a small orange frame")
                    continue
                if any(hb[0] - 4 <= P["c"][0] <= hb[2] + 4 and hb[1] - 4 <= P["c"][1] <= hb[3] + 4 and max(hw_, hh_) < 3.0 * 2 * max(P["c"][2], P["c"][3])
                       for P in ann.get("ports", []) if P.get("c")):
                    no("a port (its own rule)")
                    continue
''')
# same window
sub('''        navy_taken = []
        later = []
''', '''        frame_any = bars | paint | ((Y < 0.22) & ~navy & ~outside)

        def same_window(a, b, need=0.5):
            """Two glass patches with nothing but frame between them (bars, white muntins, a dark frame) within 20 px."""
            ax0, ay0, ax1, ay1 = a["box"]
            bx0, by0, bx1, by1 = b["box"]
            if not (ax0 < bx1 + 20 and ax1 > bx0 - 20 and ay0 < by1 + 20 and ay1 > by0 - 20):
                return False
            x0_, y0_ = max(0, min(ax0, bx0) - 2), max(0, min(ay0, by0) - 2)
            x1_, y1_ = min(W, max(ax1, bx1) + 2), min(H, max(ay1, by1) + 2)
            A_, B_ = a["m"][y0_:y1_, x0_:x1_], b["m"][y0_:y1_, x0_:x1_]
            gap = ndi.binary_dilation(A_, iterations=10) & ndi.binary_dilation(B_, iterations=10) & ~A_ & ~B_
            if gap.sum() < 12:
                return False
            return float(frame_any[y0_:y1_, x0_:x1_][gap].mean()) >= need
        navy_taken = []
        later = []
''')
i0 = s.index("            mate = None                                      # a pane of a window taken already: bars between the two")
i1 = s.index("            if mate is not None:\n")
s = s[:i0] + '''            mate = None                                      # a pane of a window taken already: only frame between the two
            for kk, q in navy_taken:
                if same_window(cd, q):
                    mate = kk
                    break
''' + s[i1:]
i0 = s.index("            for cd in list(later):\n")
i1 = s.index("        for cd in later:\n")
s = s[:i0] + '''            for cd in list(later):
                for kk, q in navy_taken:
                    if cd["a"] >= 150 and same_window(cd, q, 0.6):
                        inst[cd["m"] & (inst == 0)] = kk
                        meta[kk - 1]["px"] += int(cd["m"].sum())
                        bx = meta[kk - 1]["box"]
                        meta[kk - 1]["box"] = [min(bx[0], cd["box"][0]), min(bx[1], cd["box"][1]), max(bx[2], cd["box"][2]), max(bx[3], cd["box"][3])]
                        navy_taken.append((kk, cd))
                        later.remove(cd)
                        changed = True
                        break
''' + s[i1:]
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)

p = os.path.join(HERE, "night4.py")
s = open(p, encoding="utf-8").read()
i0 = s.index('        cls = W5["m"][wid]["cls"]\n        hh_, ww_ = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start\n')
i1 = s.index("        glow[sl] = np.where(sub[..., None], g_, glow[sl])\n        emw[sl] = np.where(sub, e_, emw[sl])\n")
new = '''        cls = W5["m"][wid]["cls"]
        hh_, ww_ = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        ty = (yy[sl] - sl[0].start) / max(hh_, 1)
        lvl = rng.uniform(0.90, 1.06)
        col = WIN_GLOW * (1 + 0.08 * rng.uniform(-1, 1) * np.array([0.0, 0.5, 1.0], np.float32))
        # (2026-11-22 night) one rendering, not two: every window is a lit pane (even, a little brighter towards the top, a
        # touch darker at its bars) and, by how much of a room its glass really shows by day (its texture; nothing for
        # opaque navy glass and for windows too small to show one), the room itself. Like windows side by side no longer
        # come out in two styles because a threshold fell between them.
        npx = int(core.sum())
        if W5["m"][wid].get("forced"):
            wsee = 1.0 if cls == "see" else 0.0
        elif cls == "navy":
            wsee = 0.0
        else:
            tex_w = float(W5["m"][wid].get("tex", 0.30 if cls == "see" else 0.0))
            wsee = float(np.clip((tex_w - 0.17) / 0.12, 0, 1) * np.clip((npx - 800) / 2200.0, 0, 1))
        dg = cv2.distanceTransform(core.astype(np.uint8), cv2.DIST_L2, 3)
        rec = 0.86 + 0.14 * np.clip(dg / max(2.0, 0.10 * min(hh_, ww_)), 0, 1)
        val = (0.93 + 0.12 * (1 - ty)) * rec * lvl
        if cls != "navy":                                   # a curtain's or frosted glass's own fine shading, faintly
            p85 = max(float(np.percentile(dayY[sl][core], 85)), 1e-3)
            val = val * cv2.GaussianBlur(np.clip(dayY[sl] / p85, 0.80, 1.12).astype(np.float32), (0, 0), 1.2)
        g_ = col[None, None, :] * (0.30 * WL * val)[..., None]
        e_ = 0.55
        if wsee > 0:
            # the room behind the glass, lit: its own picture as warm light. The glass's veil (the window's darkest level) is
            # taken off; what is left is scaled so that the room's bright parts reach a lit pane's level, over a floor (a lit
            # room is nowhere black), with a little of its own colour; the daylight in the room's far windows (by far its
            # brightest, and bluish) is a dark window now.
            c_ = dayL[sl]
            yv = dayY[sl]
            d_ = np.clip(yv - float(np.percentile(yv[core], 4)), 0, None)
            med_ = max(float(np.median(d_[core])), 1e-4)
            far = (d_ > max(4.0 * med_, 0.06)) & (c_[..., 2] > 1.02 * c_[..., 0])
            far = ndi.binary_closing(ndi.binary_opening(far, iterations=1), structure=np.ones((3, 3), bool), iterations=3)
            far = ndi.binary_fill_holes(far) & sub
            fsoft = cv2.GaussianBlur(far.astype(np.float32), (0, 0), 1.6)
            rest = core & ~far
            p90 = max(float(np.percentile(d_[rest], 90)) if rest.any() else med_, 0.012)      # (a floor: a dark room's grain is not raised into a pattern)
            t_ = np.clip(cv2.GaussianBlur(d_.astype(np.float32), (0, 0), 0.8) / p90, 0, 1.25)
            vs_ = (0.20 + 0.80 * t_ ** 0.9) * (1 - fsoft) + 0.10 * fsoft
            chrom = c_ / np.maximum(yv, 1e-4)[..., None]
            chrom = np.clip(0.30 * chrom + 0.70, 0.6, 1.5)
            gs_ = col[None, None, :] * chrom * (0.30 * WL * lvl * vs_)[..., None]
            g_ = g_ * (1 - wsee) + gs_ * wsee
            e_ = 0.55 * (1 - wsee) + 0.40 * wsee
'''
s = s[:i0] + new + s[i1:]
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("win6 + night4 patched (round 8)")
