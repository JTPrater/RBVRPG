"""Windows as INSTANCES, by the game's own drawing (2026-11-22; rewritten that night after every picture's overlay was looked
at). Every house window of the game is a GRID OF THIN DARK RED BARS with its glass in the holes, whatever the glass shows
(opaque navy, a room, frosted). So:

  python -I win6.py <out_dir> <name> [<name> ...]      (--all: every exterior picture)      CPU, numpy / cv2 only

 1. bars        the frame colour: dark red-brown in the shade, brick red in the sun, a dull mauve far off over frosted glass
                (a thin dark line redder than what is round it).
 2. a window    a connected bar structure that encloses holes, is thin, about convex (its hull is the window's outline, so a
                pane whose bar is hidden behind a chair is still inside), stands in painted wall, and whose holes do not
                just show that wall (a chair's back, a ladder) nor lie on a deck (the B deck's red grating). A big, upright
                one is taken for itself (an ANCHOR); a small or slanting one (a boat's gunwale, a stair, a mast's table are
                red too) only with evidence, as the far ones below.
 3. far ones    navy blobs ringed by paint (far windows whose bars are thinner than a pixel, the B deck's oval lights,
                white-framed windows): taken only with EVIDENCE: in one of the annotation's hand-drawn zones; in a ROW with
                an anchor as perspective draws one (middles on one line, heights in step with the distance to where the line
                meets the horizon); or alone if big, upright and straight-sided (or an oval under a deckhead) and wholly
                ringed by paint. Under a deckhead a window stands at the eye's level (it straddles the horizon).
 4. class       'navy' (opaque dark glass), 'see' (a room shows through), 'pale' (curtained, frosted). The glass is all that
                the bars enclose; of what only the hull adds, what looks like the wall is left out; orange wood that runs out
                over the outline (a chair, a rail in front) is no glass.
 5. through     a window whose glass is mostly the outside (night4's matte of the last run): it looks out at the sky or the
                sea (the bridge, the screens) and is not lit.
 6. alpha       matted to the picture's own edges.
On the bridge and where the annotation says "auto_glass": false, only what stands in the annotation's zones is taken.
Writes <out_dir>/<name>.w5.npz {inst, alpha} / .w5.json {windows, rejected, empty_zones} (night4.py, win5_review.py).
Corrections: work/win5_fix.json  {name: {"drop_at": [[x, y], ...], "add": [[x0, y0, x1, y1, cls?, "all"?] or
{"poly": [[x, y], ...], "cls": c, "all": bool}], "cls_at": [[x, y, cls]], "only_add": bool}}. An "add" takes whatever in
its box is neither wall paint nor bar for glass ("all": everything but bars: frosted glass is paint-coloured)."""
import json
import os
import sys
import time

import cv2
import numpy as np
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
G = os.path.normpath(os.path.join(HERE, "..", "..", "public", "images", "animations", "locations", "britannic"))
MATTE = os.environ.get("W6_MATTE", "auto_night")
_vp = os.path.normpath(os.path.join(HERE, "..", "..", "blender", "tod_renders", "views_located8.json"))
VIEWS = json.load(open(_vp)) if os.path.exists(_vp) else {}
K3 = np.ones((3, 3), bool)


def lum(rgb):
    return rgb @ np.array([0.299, 0.587, 0.114], np.float32)


def guided(I, p, r, eps):
    k = (2 * r + 1, 2 * r + 1)
    mI, mp = cv2.blur(I, k), cv2.blur(p, k)
    a = (cv2.blur(I * p, k) - mI * mp) / (cv2.blur(I * I, k) - mI * mI + eps)
    b = mp - a * mI
    return cv2.blur(a, k) * I + cv2.blur(b, k)


def classify(rgb, g, forced=None):
    """Class of a window from its glass pixels g (bool): navy / see / pale, and a note."""
    px = rgb[g]
    med = np.median(px, axis=0)
    Y = lum(rgb)
    s = max(4.0, 0.04 * np.sqrt(float(g.sum())))
    gi = ndi.binary_erosion(g, iterations=2)                # (a pane's rim is a mixture with its frame: no texture of the glass)
    if gi.sum() < 0.3 * g.sum():
        gi = g
    hp = (Y - cv2.GaussianBlur(Y, (0, 0), s))[gi]
    tex = float(np.std(hp)) / max(float(np.median(Y[g])), 0.04)
    cstd = float(np.abs(px - med).max(-1).mean())
    note = "med %d,%d,%d tex %.2f cstd %.3f" % (*[int(255 * v) for v in med], tex, cstd)
    if forced:
        return forced, note, (1.0 if forced == "see" else 0.0)
    if float(lum(med)) < 0.30 and (med[2] - med[0]) > 0.012 and tex < 0.30 and cstd < 0.060:
        return "navy", note, tex
    if tex >= 0.22 or cstd >= 0.060:
        return "see", note, tex
    return "pale", note, tex


def like_navy(rgb, cand, ref):
    """Of the candidate pixels, those of the reference glass's own colour (opaque glass keeps to its colour)."""
    if not ref.any() or not cand.any():
        return cand & False
    med = np.median(rgb[ref], axis=0)
    loc = cv2.medianBlur((rgb * 255).astype(np.uint8), 9).astype(np.float32) / 255
    return cand & (np.abs(rgb - loc).max(-1) < 0.08) & (np.abs(loc - med).max(-1) < 0.17)


def one(name, out, fix):
    t0 = time.time()
    bgr = cv2.imread(os.path.join(G, name + ".png"))
    H, W = bgr.shape[:2]
    rgb = bgr[..., ::-1].astype(np.float32) / 255.0
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    Y = lum(rgb)
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-6)
    fx = dict(fix.get(name, {}))
    mp = os.path.join(HERE, "work", MATTE, "dbg", name + ".mask.png")
    outside = (cv2.imread(mp, cv2.IMREAD_UNCHANGED) > 127) if os.path.exists(mp) else np.zeros((H, W), bool)
    dp = os.path.join(HERE, "work", "depth", name + ".disp.npy")
    disp = np.load(dp) if os.path.exists(dp) else None
    paint = (sat < 0.24) & (Y > 0.10) & ~outside
    # the bars' red: very red in the shade (17, 5, 2), red with green = blue in the sun (48, 27, 27); the chairs' and rails' wood
    # is orange (46, 23, 7 in the shade, 150, 80, 30 in the sun: green well over blue, red only twice green)
    bars = (r > 0.035) & (Y < 0.24) & ((g < 0.42 * r) | ((b > 0.75 * g) & (r > 1.45 * g) & (r > 1.45 * b))) & (r > 1.3 * b) & ~outside
    wood0 = (r > g + 0.05) & (g > b + 0.015) & (Y > 0.06)                  # chairs, rails, planks: orange-brown
    # bars in full sun are a bright brick red (150, 60, 45), and far bars over frosted glass are a dull dark mauve (88, 62, 72),
    # red only against the blue-grey glass and wall round them: a thin dark line (black-hat) that is redder than neutral
    bars |= (Y < 0.42) & (r > 0.25) & (g < 0.52 * r) & (b < 0.46 * r) & ~outside
    bhat = cv2.morphologyEx(Y, cv2.MORPH_BLACKHAT, np.ones((11, 11), np.uint8))
    red_ = (r - 0.5 * (g + b)) / np.maximum(Y, 0.05)
    bars |= (bhat > 0.05) & (red_ > 0.14) & (b >= g - 0.012) & (Y < 0.45) & ~wood0 & ~outside
    wood = wood0 & ~bars
    navy = (Y < 0.24) & (Y > 0.02) & ((b - r) > 0.03) & ((b - r) < 0.30) & (g >= r - 0.01) & (b >= g - 0.02) & ~outside
    inst = np.zeros((H, W), np.uint16)
    meta = []
    ap = os.path.join(HERE, "ann", name + ".json")
    ann = json.load(open(ap, encoding="utf-8")) if os.path.exists(ap) else {}
    hz = ann.get("horizon")
    if hz is None and name in VIEWS:                        # the located camera never rolls: the horizon's row from its pitch
        hrow_ = H / 2 + (H / 2) / np.tan(np.radians(35.0)) * np.tan(np.radians(VIEWS[name]["pitch"]))
        hz = [hrow_, hrow_]
    lamps = [L["p"] for L in ann.get("lamps", [])]
    covered = bool(ann.get("covered"))
    restricted = "bridge" in name.lower() or ann.get("auto_glass") is False
    drops = fx.get("drop_at", [])
    rej = {}

    def no(why):
        rej[why] = rej.get(why, 0) + 1

    DB = [int(v) for v in os.environ["W6_DBG"].split(",")] if os.environ.get("W6_DBG") else None

    def dbg(box, *a):
        """W6_DBG=x0,y0,x1,y1: say what was decided for whatever overlaps that box."""
        if DB and box[0] < DB[2] and box[2] > DB[0] and box[1] < DB[3] and box[3] > DB[1]:
            print("   DBG", box, *a, flush=True)

    zone_rects = []
    zone_ev = np.zeros((H, W), bool)                        # where the annotation says windows are
    for key_ in ("zones", "zones_fine", "lit"):
        for q in ann.get(key_) or []:
            if len(q) == 4 and not isinstance(q[0], (list, tuple)):
                zr = [max(0, int(q[0]) - 4), max(0, int(q[1]) - 4), min(W, int(q[2]) + 4), min(H, int(q[3]) + 4)]
                zone_ev[zr[1]:zr[3], zr[0]:zr[2]] = True
                zone_rects.append(zr)
            elif len(q) >= 3:
                zm_ = np.zeros((H, W), np.uint8)
                cv2.fillPoly(zm_, [np.array(q, np.int32)], 1)
                zone_ev |= zm_.astype(bool)

    def hrow_at(x_):
        return hz[0] + (hz[1] - hz[0]) * x_ / float(W)

    def level(ring_mask, y0, x0):
        """True if the surface round a candidate is a deck or a deckhead (its depth changes down the picture as a level
        plane's does: disparity in proportion to the distance from the horizon's row), not a wall."""
        if disp is None or hz is None:
            return False
        ry, rx = np.nonzero(ring_mask & paint[y0:y0 + ring_mask.shape[0], x0:x0 + ring_mask.shape[1]])     # the painted surface itself
        if len(ry) < 40:
            return False
        gy, gx = ry + y0, rx + x0
        hrow = hz[0] + (hz[1] - hz[0]) * gx / float(W)
        dd = disp[gy, gx]
        tp, bt = gy <= np.percentile(gy, 30), gy >= np.percentile(gy, 70)
        if not tp.any() or not bt.any():
            return False
        yt, yb = float((gy[tp] - hrow[tp]).mean()), float((gy[bt] - hrow[bt]).mean())
        dt, db = float(np.median(dd[tp])), float(np.median(dd[bt]))
        if min(dt, db) < 1e-3 or yt * yb <= 0 or abs(yb - yt) < 6:
            return False                                    # (it straddles the horizon: a wall)
        want = abs(yb) / abs(yt)                            # a level plane: disparity in this proportion
        got = db / dt
        return abs(want - 1.0) > 0.08 and (got - 1.0) / (want - 1.0) > 0.55

    def straddles(box, cx):
        if hz is None:
            return None
        return bool(abs((box[1] + box[3]) / 2.0 - hrow_at(cx)) <= 1.5 * (box[3] - box[1]) + 4)      # (near the eye's level)

    def add(gl, cls, src, note, box, tex=0.0, forced=False):
        k = len(meta) + 1
        inst[gl & (inst == 0)] = k
        meta.append(dict(id=k, box=box, cls=cls, src=src, px=int(gl.sum()), note=note, tex=round(float(tex), 3), forced=bool(forced)))
        return k

    bc, nc = [], []                                         # candidates: bar structures, navy groups
    notglass = bars | paint | outside | wood0 | ((r >= g) & (r > b) & (Y < 0.08))

    def grow(full, a_):
        """A pane found by its navy colour, grown to whatever bounds it (bars, a dark frame, the wall's paint, wood): the
        whole pane, its brighter reflections too. Given up (the navy patch as it is) if it leaks."""
        ys, xs = np.nonzero(full)
        pad = int(max(10, 0.30 * max(ys.max() - ys.min() + 1, xs.max() - xs.min() + 1)))
        y0, y1, x0, x1 = max(0, ys.min() - pad), min(H, ys.max() + 1 + pad), max(0, xs.min() - pad), min(W, xs.max() + 1 + pad)
        seed = full[y0:y1, x0:x1]
        free = ndi.binary_opening(~notglass[y0:y1, x0:x1], structure=K3) | seed
        lab_, n_ = ndi.label(free)
        ids_ = np.unique(lab_[seed])
        g_ = np.isin(lab_, ids_[ids_ > 0])
        touch = int(g_[0, :].sum()) * (y0 > 0) + int(g_[-1, :].sum()) * (y1 < H) + int(g_[:, 0].sum()) * (x0 > 0) + int(g_[:, -1].sum()) * (x1 < W)
        if g_.sum() > 2.2 * a_ or touch > 0:
            return full
        out = full.copy()
        out[y0:y1, x0:x1] |= g_
        return out
    if not fx.get("only_add"):
        # ---- 1-2. bar structures that enclose holes
        bluegl = ((b - r) > 0.03) & (sat > 0.20)             # glass that is blue: navy, teal, the sky mirrored
        frames2 = (bars | (wood0 & ~ndi.binary_opening(wood0, structure=np.ones((15, 15), bool)))) & ~outside   # thin orange wood too
        seen = np.zeros((H, W), bool)

        def bar_pass(fmask, woody):
            cl = ndi.binary_closing(fmask, structure=K3, iterations=1)
            lab, n = ndi.label(cl, structure=K3)
            for i, sl in enumerate(ndi.find_objects(lab), 1):
                bh, bw = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
                if bh < 12 or bw < 8 or bh * bw > 0.20 * H * W:
                    continue
                if woody and (not (wood0[sl] & (lab[sl] == i)).any() or seen[sl][lab[sl] == i].mean() > 0.5):
                    continue                                    # (pass 2: only frames with orange wood in them, not found already)
                pad = 16
                y0, y1, x0, x1 = max(0, sl[0].start - pad), min(H, sl[0].stop + pad), max(0, sl[1].start - pad), min(W, sl[1].stop + pad)
                Cb = lab[y0:y1, x0:x1] == i                     # the bars themselves
                area = int(Cb.sum())
                if area < 40:
                    continue
                C = Cb.copy()                                   # (a window cut by the picture's edge: the edge closes it)
                if x0 == 0 and C[:, 0].sum() >= 2:
                    q_ = np.nonzero(C[:, 0])[0]
                    C[q_.min():q_.max() + 1, 0] = True
                if x1 == W and C[:, -1].sum() >= 2:
                    q_ = np.nonzero(C[:, -1])[0]
                    C[q_.min():q_.max() + 1, -1] = True
                if y0 == 0 and C[0, :].sum() >= 2:
                    q_ = np.nonzero(C[0, :])[0]
                    C[0, q_.min():q_.max() + 1] = True
                if y1 == H and C[-1, :].sum() >= 2:
                    q_ = np.nonzero(C[-1, :])[0]
                    C[-1, q_.min():q_.max() + 1] = True
                filled = ndi.binary_fill_holes(ndi.binary_closing(np.pad(C, 8), structure=np.ones((5, 5), bool), iterations=2)[8:-8, 8:-8] | C)
                holes = filled & ~C                             # (gaps of a few px in a frame are closed before its holes are looked for)
                cs, _ = cv2.findContours(C.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                hull = np.zeros(C.shape, np.uint8)
                cv2.fillConvexPoly(hull, cv2.convexHull(np.concatenate(cs)), 1)
                hull = hull.astype(bool)
                ha = int(hull.sum())
                why = None
                if holes.sum() < 0.30 * ha and (hull & ~C).sum() < 0.45 * ha:
                    why = "no holes"
                elif area > 0.62 * ha:
                    why = "not thin"
                elif filled.sum() < 0.50 * ha and holes.sum() < 0.25 * ha:
                    why = "not convex"
                sub_rgb, sub_Y, sub_paint, sub_bars = rgb[y0:y1, x0:x1], Y[y0:y1, x0:x1], paint[y0:y1, x0:x1], fmask[y0:y1, x0:x1]
                enclosed = filled & ~Cb & ~sub_bars             # what the bars enclose
                extra = hull & ~filled & ~sub_bars if filled.sum() < 0.88 * ha else np.zeros_like(hull)   # what only the hull adds
                gl = enclosed | extra
                ring = None
                wallY = 1.0
                if why is None and gl.sum() < 30:
                    why = "no glass"
                if why is None:
                    ring = ndi.binary_dilation(hull, iterations=12) & ~ndi.binary_dilation(hull, iterations=3)
                    rq_ = ring & ~bars[y0:y1, x0:x1]             # (a neighbour's frame in the ring is no wall, and no lack of one)
                    pr = float(sub_paint[rq_].mean()) if rq_.sum() > 20 else 0.0
                    if pr < 0.45:
                        why = "not in a painted wall"
                    elif woody and float(bluegl[y0:y1, x0:x1][enclosed].mean() if enclosed.any() else 0.0) < 0.60:
                        why = "an orange frame round no blue glass"
                    else:
                        wallY = float(np.median(sub_Y[ring & sub_paint]))
                        wallish = sub_paint & (np.abs(sub_Y - wallY) < 0.22 * max(wallY, 0.1))
                        if (gl & wallish).sum() > 0.55 * gl.sum():
                            why = "its holes show the wall"
                        else:
                            extra &= ~wallish                    # (the hull of a window seen askew takes in wall: left out)
                            gl = enclosed | extra
                if why is None and level(ring, y0, x0):
                    why = "on a deck or a deckhead"
                if why is None:
                    mg_ = np.median(sub_rgb[enclosed if enclosed.sum() >= 30 else gl], axis=0)
                    if mg_[0] > mg_[1] + 0.04 and mg_[1] > mg_[2] + 0.012 and float(lum(mg_)) > 0.08:
                        why = "its holes show wood"            # (a chair's back, a bench: orange in the deck's light)
                if why is None and any(x0 <= dx < x1 and y0 <= dy < y1 and hull[int(dy) - y0, int(dx) - x0] for dx, dy in drops):
                    why = "dropped"
                dbg([x0, y0, x1, y1], "bars2" if woody else "bars", "area", area, "hull", ha, "holes", int(holes.sum()), "filled", int(filled.sum()), "glass", int(gl.sum()), "->", why)
                if why:
                    no(why)
                    continue
                forced = None
                for cx, cy, c_ in fx.get("cls_at", []):
                    if x0 <= cx < x1 and y0 <= cy < y1 and hull[int(cy) - y0, int(cx) - x0]:
                        forced = c_
                cls, note, tex_ = classify(sub_rgb, enclosed if enclosed.sum() >= 30 else gl, forced)
                if cls == "navy" and extra.any():
                    gl = enclosed | like_navy(sub_rgb, extra, enclosed if enclosed.sum() >= 30 else gl) | (extra & navy[y0:y1, x0:x1])
                # a thing in front: orange wood that runs out over the window's outline (a chair, a rail), covering its frame
                wdc_ = ndi.binary_closing(wood0[y0:y1, x0:x1] & ~sub_bars, structure=K3) & ~Cb
                wl, wn = ndi.label(wdc_ & ndi.binary_dilation(hull, iterations=14), structure=K3)
                hull2_ = ndi.binary_dilation(hull, iterations=2)
                for j in range(1, wn + 1):
                    wj = wl == j
                    ins, outs = int((wj & hull).sum()), int((wj & ~hull2_).sum())
                    if ins >= 12 and outs >= 30:
                        dbg([x0, y0, x1, y1], "in front: wood", "ins", ins, "outs", outs)
                        gl &= ~ndi.binary_dilation(wj, iterations=2)
                if gl.sum() < 30:
                    continue
                if float((outside[y0:y1, x0:x1] & gl).sum()) / float(gl.sum()) > 0.40:
                    if restricted:
                        no("through")
                        continue
                    note += " (mirrors the sky)"
                full = np.zeros((H, W), bool)
                full[y0:y1, x0:x1] = gl
                hys, hxs = np.nonzero(hull)
                hb = [int(hxs.min()) + x0, int(hys.min()) + y0, int(hxs.max()) + x0 + 1, int(hys.max()) + y0 + 1]
                hw_, hh_ = hb[2] - hb[0], hb[3] - hb[1]
                anchor = ha >= 900 and ha >= 0.62 * hw_ * hh_ and hw_ <= 2.6 * hh_
                if woody and not anchor:
                    no("a small orange frame")
                    continue
                if any(hb[0] - 4 <= P["c"][0] <= hb[2] + 4 and hb[1] - 4 <= P["c"][1] <= hb[3] + 4 and max(hw_, hh_) < 3.0 * 2 * max(P["c"][2], P["c"][3])
                       for P in ann.get("ports", []) if P.get("c")):
                    no("a port (its own rule)")
                    continue
                bc.append(dict(m=full, box=hb, c=((hb[0] + hb[2]) / 2.0, (hb[1] + hb[3]) / 2.0), h=float(hh_), cls=cls, note=note, anchor=anchor, tex=tex_, forced=bool(forced)))
                bc[-1]["hm"] = np.zeros((H, W), bool)
                bc[-1]["hm"][y0:y1, x0:x1] = hull
                seen[y0:y1, x0:x1] |= hull
        bar_pass(bars, False)
        if not covered:
            bar_pass(frames2, True)                         # frames the sun turns orange (they pass as wood): open decks only
        # ---- 3. navy groups
        barhull = np.zeros((H, W), bool)
        for q in bc:
            barhull |= q["m"]
        taken = ndi.binary_dilation(barhull, iterations=6)
        nv = ndi.binary_opening(navy & ~taken, structure=K3)
        grp, gn = ndi.label(ndi.binary_dilation(nv, iterations=5))
        for i, sl in enumerate(ndi.find_objects(grp), 1):
            y0, y1, x0, x1 = max(0, sl[0].start - 34), min(H, sl[0].stop + 34), max(0, sl[1].start - 34), min(W, sl[1].stop + 34)
            m = (grp[y0:y1, x0:x1] == i) & nv[y0:y1, x0:x1]
            if int(m.sum()) < 24:
                continue
            gy_, gx_ = np.nonzero(m)
            inz = bool(zone_ev[int(gy_.mean()) + y0, int(gx_.mean()) + x0])
            # (a group of far panes side by side is wide: each of its blobs is judged on its own, the group is one window; in
            #  one of the annotation's zones only specks are dropped: a white-framed window's panes are wedges and slivers too)
            bl_, bn_ = ndi.label(m)
            sizes_ = ndi.sum(m, bl_, np.arange(1, bn_ + 1)) if bn_ else []
            big_ = float(max(sizes_)) if bn_ else 0.0
            ok_ = np.zeros(bn_ + 1, bool)
            thin_ = False
            for j_, sl_ in enumerate(ndi.find_objects(bl_), 1):
                h_, w_ = sl_[0].stop - sl_[0].start, sl_[1].stop - sl_[1].start
                a_ = float(sizes_[j_ - 1])
                if a_ < 14 or h_ < 5 or w_ < 2:
                    why_ = "navy speck"
                elif inz and a_ >= 0.04 * big_:
                    ok_[j_] = True
                    continue
                elif w_ > 1.6 * h_:
                    why_ = "navy flat sliver"
                elif h_ > 12 * w_:
                    why_ = "navy thin sliver"
                elif a_ < 0.55 * h_ * w_:
                    why_ = "navy wedge"
                else:
                    ok_[j_] = True
                    thin_ = thin_ or h_ > 4.6 * w_          # (a window seen along its wall: taken only in a zone or a row)
                    continue
                no(why_)
            m = ok_[bl_]
            if m.sum() >= 150:
                ys, xs = np.nonzero(m)
                hq_, wq_ = int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1)
                if max(hq_, wq_) > 100 and m.sum() < 0.30 * hq_ * wq_:      # a pane with a thin line hanging on it
                    m2_ = ndi.binary_opening(m, structure=np.ones((5, 5), bool))
                    if m2_.sum() >= 150:
                        l2_, n2_ = ndi.label(m2_)
                        m = l2_ == (int(np.argmax(ndi.sum(m2_, l2_, np.arange(1, n2_ + 1)))) + 1)
            a_ = float(m.sum())
            if a_ < 24:
                continue
            ys, xs = np.nonzero(m)
            h_, w_ = int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1)
            gx0, gy0, gx1, gy1 = int(xs.min()) + x0, int(ys.min()) + y0, int(xs.max()) + x0 + 1, int(ys.max()) + y0 + 1
            cxm, cym = float(xs.mean()) + x0, float(ys.mean()) + y0
            why_ = None
            by_win = None
            pane_of = None
            for k_, q in enumerate(bc):                     # mostly inside a found window's outline: its pane
                if float((m & q["hm"][y0:y1, x0:x1]).sum()) >= 0.7 * a_:
                    pane_of = k_
                    break
            medn = np.median(rgb[y0:y1, x0:x1][m], axis=0)
            satn = float((medn.max() - medn.min()) / max(float(medn.max()), 1e-6))
            if a_ < 0.12 * h_ * w_ or h_ > 25 * w_ or w_ > 6 * h_ or (max(h_, w_) > 100 and a_ < 0.30 * h_ * w_):
                why_ = "navy line"                          # (a shadow's edge along a beam or a pillar; in a zone too)
            elif (a_ >= 600 and satn < 0.42) or (a_ >= 150 and satn < 0.28):
                why_ = "grey-blue shade, not navy glass"     # (glass reads 11, 24, 41: sat 0.7; a pillar's shaded side 47, 51, 57)
            elif any(abs(cxm - P["c"][0]) < P["c"][2] + 6 and abs(cym - P["c"][1]) < P["c"][3] + 6 for P in ann.get("ports", []) if P.get("c")):
                why_ = "a port (its own rule)"
            elif pane_of is not None:
                by_win = pane_of
            elif not inz and (gy0 <= 1 or gx0 <= 1 or gy1 >= H - 1 or gx1 >= W - 1):
                why_ = "navy at the edge"
            elif h_ * w_ > (0.20 if inz else 0.03) * H * W:
                why_ = "navy too big"
            else:
                for k_, q in enumerate(bc):
                    bx0, by0, bx1, by1 = q["box"]
                    pd_ = max(3, min(14, int(0.25 * min(bx1 - bx0, by1 - by0))))
                    if gx0 < bx1 + pd_ and gx1 > bx0 - pd_ and gy0 < by1 + pd_ and gy1 > by0 - pd_:
                        by_win = k_
                        break
                if by_win is not None and not (inz and a_ >= max(400.0, 0.2 * float(bc[by_win]["m"].sum()))):
                    why_ = "navy by a window"               # (a scrap of a pane cut off by its own frame, the gap between two frames)
            pr = 0.0
            framed = False
            if why_ is None:
                blob = ndi.binary_dilation(m, iterations=2)
                ring = ndi.binary_dilation(blob, iterations=10) & ~ndi.binary_dilation(blob, iterations=3)
                pr = float((paint | bars)[y0:y1, x0:x1][ring].mean())
                # (a pane in a thick dark FRAME in a wall: the ring is the frame, the wall lies beyond it)
                fr_ = float((((Y < 0.22) & ~navy & ~outside) | bars)[y0:y1, x0:x1][ring].mean())
                wide = ndi.binary_dilation(blob, iterations=30) & ~ndi.binary_dilation(blob, iterations=14)
                wl_ = float(paint[y0:y1, x0:x1][wide].mean()) if wide.sum() > 40 else 0.0
                framed = fr_ >= 0.55 and wl_ >= 0.35 and a_ >= 400
                pane = fr_ >= 0.50 and float((paint | bars | ((Y < 0.22) & ~navy & ~outside))[y0:y1, x0:x1][ring].mean()) >= 0.75   # ringed by its frame
                if pane_of is not None:
                    pass
                elif not framed and not pane and (pr < (0.45 if inz else 0.62) or float(np.percentile(Y[y0:y1, x0:x1][ring], 75)) < float(Y[y0:y1, x0:x1][m].mean()) + 0.06):
                    why_ = "navy not in a wall"                # (the ring's lighter quarter: a thick dark frame is in the ring too)
                elif not inz and level(ring, y0, x0):
                    why_ = "navy on a deckhead"
                elif any(abs(cxm - lx) < 26 + w_ and abs(cym - ly) < 26 + h_ for lx, ly in lamps):
                    why_ = "a lamp"
                elif any(x0 <= dx < x1 and y0 <= dy < y1 and blob[int(dy) - y0, int(dx) - x0] for dx, dy in drops):
                    why_ = "dropped"
            dbg([gx0, gy0, gx1, gy1], "navy group", "a", a_, "inz", inz, "pr", round(pr, 2), "framed", framed, "by", by_win, "->", why_)
            if why_:
                no(why_)
                continue
            # its sides: upright and straight (a window's sides stay upright in these pictures: the camera never rolls)
            rws = [np.nonzero(m[q_])[0] for q_ in range(ys.min() + int(0.2 * h_), ys.max() + 1 - int(0.2 * h_))]
            rws = [(k_, q_.min(), q_.max()) for k_, q_ in enumerate(rws) if len(q_)]
            upright = False
            if len(rws) >= 4:
                rr_ = np.array(rws, np.float64)
                pl_, pr_ = np.polyfit(rr_[:, 0], rr_[:, 1], 1), np.polyfit(rr_[:, 0], rr_[:, 2], 1)
                dev = max(float(np.abs(np.polyval(pl_, rr_[:, 0]) - rr_[:, 1]).max()), float(np.abs(np.polyval(pr_, rr_[:, 0]) - rr_[:, 2]).max()))
                upright = abs(pl_[0]) < 0.15 and abs(pr_[0]) < 0.15 and dev <= max(1.5, 0.08 * w_)
            oval = abs(a_ / (0.7854 * h_ * w_) - 1.0) < 0.10
            full = np.zeros((H, W), bool)
            full[y0:y1, x0:x1] = m
            if a_ >= 150:
                full = grow(full, a_)
                ys, xs = np.nonzero(full)
                gx0, gy0, gx1, gy1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
                a_ = float(full.sum())
                h_, w_ = gy1 - gy0, gx1 - gx0
            nc.append(dict(m=full, box=[gx0, gy0, gx1, gy1], c=(cxm, cym), h=float(h_), w=float(w_), a=a_, pr=pr, up=upright, oval=oval,
                           thin=thin_, inz=inz, by=by_win, framed=framed, is_pane=pane_of is not None))
        # ---- the annotation's FINE zones (rows of far windows a few px wide, drawn by hand), and under a deckhead the zones
        # with no candidate in them: compact specks darker than the wall round them
        fc = []
        fine_r = [q for q in (ann.get("zones_fine") or []) if len(q) == 4 and not isinstance(q[0], (list, tuple))]
        if covered:
            fine_r += [q for q in (ann.get("zones") or []) if len(q) == 4 and not isinstance(q[0], (list, tuple))
                       and not any(int(q[0]) <= c_["c"][0] < int(q[2]) and int(q[1]) <= c_["c"][1] < int(q[3]) for c_ in bc + nc)]
        if fine_r:
            fine = np.zeros((H, W), bool)
            for q in fine_r:
                fine[max(0, int(q[1])):int(q[3]), max(0, int(q[0])):int(q[2])] = True
            occ = barhull.copy()
            for q in nc:
                occ |= q["m"]
            medY = cv2.medianBlur(np.clip(Y * 255, 0, 255).astype(np.uint8), 31).astype(np.float32) / 255
            dk = fine & (Y < float(ann.get("fine_dark", 0.80)) * medY) & (Y > 0.035) & ~outside & ~ndi.binary_dilation(occ, iterations=4)
            dk = ndi.binary_closing(ndi.binary_opening(dk, structure=K3), structure=K3)
            dk = ndi.binary_fill_holes(dk) & fine
            fl, fn = ndi.label(dk)
            for i, sl in enumerate(ndi.find_objects(fl), 1):
                sub_ = fl[sl] == i
                sz = int(sub_.sum())
                hh, ww = sub_.shape
                if not (10 <= sz <= int(ann.get("fine_max", 2500)) and min(hh, ww) >= 3 and sz / float(hh * ww) >= 0.50 and max(hh, ww) / max(min(hh, ww), 1) <= 7):
                    continue
                bx_ = [sl[1].start, sl[0].start, sl[1].stop, sl[0].stop]
                cx_ = (bx_[0] + bx_[2]) / 2.0
                if covered and straddles(bx_, cx_) is False:
                    no("fine speck off the eye's level")
                    continue
                if any(x0 <= dx < x1 and y0 <= dy < y1 for dx, dy in drops for x0, y0, x1, y1 in [bx_]):
                    no("dropped")
                    continue
                full = np.zeros((H, W), bool)
                full[sl] = sub_
                fc.append(dict(m=full, box=bx_, c=(cx_, (bx_[1] + bx_[3]) / 2.0), h=float(hh), w=float(ww), a=float(sz)))
        # ---- evidence: rows with an anchor
        for cd in nc:                                       # a navy group that stands on its own evidence
            st_ = straddles(cd["box"], cd["c"][0])
            cd["solo"] = None
            if cd["framed"]:
                cd["solo"] = "framed"
            elif (not cd["thin"] and cd["a"] >= 260 and cd["a"] >= 0.78 * cd["h"] * cd["w"] and cd["pr"] >= 0.85
                  and 0.6 <= cd["h"] / cd["w"] <= 3.2 and cd["up"]):
                cd["solo"] = "alone"
            elif covered and st_ and cd["oval"] and cd["a"] >= 200 and cd["pr"] >= 0.85 and 1.0 <= cd["h"] / cd["w"] <= 4.0:
                cd["solo"] = "alone, oval"
            if (covered and st_ is False) or (restricted and not cd["inz"]) or (cd["thin"] and st_ is False):
                cd["solo"] = None
        has_anchor = hz is not None and (any(q["anchor"] for q in bc) or any(q["solo"] for q in nc))
        items = bc + nc + fc
        rowev = [False] * len(items)
        if has_anchor:
            slope_h = (hz[1] - hz[0]) / float(W)
            for i_ in range(len(items)):
                for j_ in range(i_ + 1, len(items)):
                    (xa, ya), (xb, yb) = items[i_]["c"], items[j_]["c"]
                    L_ = float(np.hypot(xb - xa, yb - ya))
                    if L_ < 6:
                        continue
                    ux, uy = (xb - xa) / L_, (yb - ya) / L_
                    inl = []
                    for k_, it in enumerate(items):
                        dx_, dy_ = it["c"][0] - xa, it["c"][1] - ya
                        if abs(dx_ * uy - dy_ * ux) <= max(2.5, 0.20 * it["h"]):
                            inl.append((dx_ * ux + dy_ * uy, k_))
                    if len(inl) < 3:
                        continue
                    inl.sort()
                    tt = np.array([t for t, _ in inl])
                    hh = np.array([items[k_]["h"] for _, k_ in inl])
                    anc = np.array([bool(items[k_].get("anchor") or items[k_].get("solo")) for _, k_ in inl])
                    den = uy - slope_h * ux
                    if abs(den) > 0.03:                           # the line meets the horizon: heights in step with the distance to there
                        tvp = (hz[0] + slope_h * xa - ya) / den
                        dv = tt - tvp
                        if (dv > 0).any() and (dv < 0).any():
                            side = dv > 0 if (dv > 0).sum() >= (dv < 0).sum() else dv < 0
                        else:
                            side = np.ones(len(tt), bool)
                        cc = hh / np.maximum(np.abs(dv), 1.0)
                    else:                                         # a wall seen square on: all alike
                        side = np.ones(len(tt), bool)
                        cc = hh.copy()
                    if side.sum() < 3 or not (side & anc).any():
                        continue
                    med_ = float(np.median(cc[side & anc]))       # the anchors set the scale
                    good = side & (cc > 0.76 * med_) & (cc < 1.30 * med_)
                    gaps_ok = np.zeros(len(inl), bool)
                    for q_ in range(len(inl)):                     # a neighbour within reach
                        near = [abs(tt[q_] - tt[r_]) for r_ in range(len(inl)) if r_ != q_ and good[r_]]
                        gaps_ok[q_] = bool(near) and min(near) < 14 * hh[q_]
                    keep_ = good & gaps_ok
                    if keep_.sum() >= 3 and (keep_ & anc).any():
                        for q_ in np.nonzero(keep_)[0]:
                            rowev[inl[q_][1]] = True
        # ---- take: bar structures
        ids = {}
        for k_, q in enumerate(bc):
            inz = bool(zone_ev[int(q["c"][1]), int(q["c"][0])])
            strad = straddles(q["box"], q["c"][0])
            if restricted and not inz:
                no("outside the zones (bridge / auto_glass off)")
                continue
            if not q["anchor"] and covered and strad is False:
                no("small bars off the eye's level under a deckhead")
                continue
            if not q["anchor"] and not inz and not rowev[k_]:
                no("small or slanting bars without evidence")
                continue
            ys, xs = np.nonzero(q["m"])
            ids[k_] = add(q["m"], q["cls"], "bars", q["note"] + ("" if q["anchor"] else " (zone)" if inz else " (row)"),
                          [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1], tex=q["tex"], forced=q["forced"])
        # ---- take: navy groups
        def near_strad(cd):
            """A pane above or below the eye's level that belongs to a window which does stand at it: another navy group
            right beside it (bars between) straddles the horizon."""
            for q in nc:
                if q is cd or straddles(q["box"], q["c"][0]) is not True:
                    continue
                if (cd["box"][0] < q["box"][2] + 18 and cd["box"][2] > q["box"][0] - 18 and cd["box"][1] < q["box"][3] + 18
                        and cd["box"][3] > q["box"][1] - 18):
                    bx_ = [max(0, min(cd["box"][0], q["box"][0]) - 20), max(0, min(cd["box"][1], q["box"][1]) - 20),
                           max(cd["box"][2], q["box"][2]) + 20, max(cd["box"][3], q["box"][3]) + 20]
                    sl_ = (slice(bx_[1], bx_[3]), slice(bx_[0], bx_[2]))
                    if (ndi.binary_dilation(cd["m"][sl_], iterations=16) & q["m"][sl_]).any():      # they all but touch
                        return True
            return False
        zmax = {}
        for zi, zr in enumerate(zone_rects):                # the biggest window in each zone (slivers beside it are dropped)
            best = 0.0
            for q in list(bc) + list(nc):
                if zr[0] <= q["c"][0] < zr[2] and zr[1] <= q["c"][1] < zr[3]:
                    best = max(best, float(q["m"].sum()))
            zmax[zi] = best
        frame_any = bars | paint | ((Y < 0.22) & ~navy & ~outside)

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
        for k_, cd in sorted(enumerate(nc), key=lambda t: -t[1]["a"]):     # (the big panes first: the small join them)
            cx_, cy_ = int(cd["c"][0]), int(cd["c"][1])
            strad = straddles(cd["box"], cd["c"][0])
            ev = None
            if cd["is_pane"] and cd["by"] in ids:            # a pane of a window that was taken
                kk = ids[cd["by"]]
                inst[cd["m"] & (inst == 0)] = kk
                meta[kk - 1]["px"] += int(cd["m"].sum())
                bx = meta[kk - 1]["box"]
                meta[kk - 1]["box"] = [min(bx[0], cd["box"][0]), min(bx[1], cd["box"][1]), max(bx[2], cd["box"][2]), max(bx[3], cd["box"][3])]
                meta[kk - 1]["note"] += " +pane"
                continue
            if cd["inz"]:
                zm_ = max([zmax[zi] for zi, zr in enumerate(zone_rects) if zr[0] <= cx_ < zr[2] and zr[1] <= cy_ < zr[3]] or [0.0])
                if cd["a"] < 40.0 and not rowev[len(bc) + k_]:
                    no("navy scrap in a zone")
                    continue
                if cd["a"] < 300.0 and has_anchor and not rowev[len(bc) + k_] and not cd["framed"] and cd["by"] is None:
                    later.append(cd)                         # (small and far: only in a window row; or as a pane of a taken window)
                    continue
                if covered and strad is False and cd["by"] is None and not near_strad(cd):
                    cd["why_later"] = "navy off the eye's level under a deckhead"      # (a zone drawn wide takes in the deckhead's ironwork)
                    later.append(cd)                         # (unless it is a pane of a window taken beside it)
                    continue
                ev = "zone"
            elif restricted:
                no("outside the zones (bridge / auto_glass off)")
                continue
            elif cd["thin"] and strad is False:
                no("navy thin sliver")
                continue
            elif covered and strad is False and not near_strad(cd):
                cd["why_later"] = "navy off the eye's level under a deckhead"
                later.append(cd)
                continue
            elif cd["solo"]:
                ev = cd["solo"]
            elif rowev[len(bc) + k_]:
                ev = "row"
            if ev is None:
                later.append(cd)
                continue
            if cd["by"] is not None and cd["by"] in ids:      # the rest of a window whose bars enclose only part of it
                kk = ids[cd["by"]]
                inst[cd["m"] & (inst == 0)] = kk
                meta[kk - 1]["px"] += int(cd["m"].sum())
                bx = meta[kk - 1]["box"]
                meta[kk - 1]["box"] = [min(bx[0], cd["box"][0]), min(bx[1], cd["box"][1]), max(bx[2], cd["box"][2]), max(bx[3], cd["box"][3])]
                meta[kk - 1]["note"] += " +navy"
                continue
            mate = None                                      # a pane of a window taken already: only frame between the two
            for kk, q in navy_taken:
                if same_window(cd, q):
                    mate = kk
                    break
            if mate is not None:
                inst[cd["m"] & (inst == 0)] = mate
                meta[mate - 1]["px"] += int(cd["m"].sum())
                bx = meta[mate - 1]["box"]
                meta[mate - 1]["box"] = [min(bx[0], cd["box"][0]), min(bx[1], cd["box"][1]), max(bx[2], cd["box"][2]), max(bx[3], cd["box"][3])]
                navy_taken.append((mate, cd))
                continue
            kk = add(cd["m"], "navy", "navy", "blob %dx%d %s" % (cd["w"], cd["h"], ev), cd["box"])
            navy_taken.append((kk, cd))
        # panes with no evidence of their own beside a pane that was taken (bars between the two): the same window
        changed = True
        while changed and later and not restricted:
            changed = False
            for cd in list(later):
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
        for cd in later:
            no(cd.get("why_later", "navy without evidence"))
        for k_, cd in enumerate(fc):
            if (inst[cd["m"]] > 0).any():
                continue
            if has_anchor and not rowev[len(bc) + len(nc) + k_]:
                no("fine speck out of any row")
                continue
            if not has_anchor and not (cd["h"] >= cd["w"] and cd["a"] >= 20):
                no("fine speck, not upright")
                continue
            add(cd["m"], "navy", "fine", "fine %dx%d" % (cd["w"], cd["h"]), cd["box"])
        # the annotation's own "lit" boxes (single far windows marked by hand) that nothing above found
        for q in ann.get("lit") or []:
            if len(q) == 4 and not isinstance(q[0], (list, tuple)):
                bx0, by0, bx1, by1 = [int(v) for v in q]
                hand = False                                 # (a hand correction stands there: it is the window)
                for hb in fix.get(name, {}).get("add", []):
                    if isinstance(hb, dict):
                        pts = hb.get("poly") or ([[hb["ell"][0] - hb["ell"][2], hb["ell"][1] - hb["ell"][3]], [hb["ell"][0] + hb["ell"][2], hb["ell"][1] + hb["ell"][3]]] if "ell" in hb else
                                                 [[hb["box"][0], hb["box"][1]], [hb["box"][2], hb["box"][3]]])
                        hx0, hy0 = min(v[0] for v in pts), min(v[1] for v in pts)
                        hx1, hy1 = max(v[0] for v in pts), max(v[1] for v in pts)
                    else:
                        hx0, hy0, hx1, hy1 = hb[:4]
                    if hx0 - 3 <= (bx0 + bx1) / 2.0 <= hx1 + 3 and hy0 - 3 <= (by0 + by1) / 2.0 <= hy1 + 3:
                        hand = True
                if hand:
                    continue
                if (inst[by0:by1, bx0:bx1] > 0).mean() < 0.15:      # (0.45 and "replace" split a well-found window whose box sat askew: poop1)
                    fx["add"] = list(fx.get("add", [])) + [[bx0, by0, bx1, by1]]
    softmap = np.zeros((H, W), np.float32)                  # the "soft" adds' own mattes
    for bx in fx.get("clear", []):                          # boxes wiped of whatever was found
        inst[int(bx[1]):int(bx[3]), int(bx[0]):int(bx[2])] = 0
    # ---- my own boxes: whatever in the box is neither wall paint nor bar
    for bx in fx.get("add", []):
        sub = np.zeros((H, W), bool)
        only_navy = replace = only_blue = raw = keepout = hull_o = soft = tracery = lightblue = False
        sat_min = 0.30
        if isinstance(bx, dict):
            pm_ = np.zeros((H, W), np.uint8)
            if "poly" in bx:
                cv2.fillPoly(pm_, [np.array(bx["poly"], np.int32)], 1)
            elif "ell" in bx:
                e_ = bx["ell"]
                cv2.ellipse(pm_, (int(e_[0]), int(e_[1])), (int(e_[2]), int(e_[3])), float(e_[4]) if len(e_) > 4 else 0.0, 0, 360, 1, -1)
            else:
                pm_[int(bx["box"][1]):int(bx["box"][3]), int(bx["box"][0]):int(bx["box"][2])] = 1
            sub = pm_.astype(bool)
            fcls, fall = bx.get("cls"), bool(bx.get("all"))
            only_navy, replace = bool(bx.get("navy")), bool(bx.get("replace"))
            only_blue, raw = bool(bx.get("blue")), bool(bx.get("raw"))
            keepout = bool(bx.get("keepout"))
            hull_o = bool(bx.get("hull"))
            soft = bool(bx.get("soft"))
            tracery = bool(bx.get("tracery"))
            lightblue = bool(bx.get("lightblue"))
            sat_min = float(bx.get("sat", 0.30))             # ("sat": a paler sky-mirroring pane in a sunlit white wall)
        else:
            x0, y0, x1, y1 = [int(v) for v in bx[:4]]
            sub[y0:y1, x0:x1] = True
            fcls = ([v for v in bx[4:] if v in ("navy", "see", "pale")] or [None])[0]
            fall = "all" in bx[4:]
            only_navy, replace = "navyonly" in bx[4:], "replace" in bx[4:]
            only_blue, raw = "blue" in bx[4:], "raw" in bx[4:]
            keepout = "keepout" in bx[4:]
            hull_o = "hull" in bx[4:]
            soft = "soft" in bx[4:]
            tracery = "tracery" in bx[4:]
            lightblue = "lightblue" in bx[4:]
        if replace:                                         # what was found in the box goes: this entry stands for it
            inst[sub] = 0
        ring = ndi.binary_dilation(sub, iterations=10) & ~sub
        wallY = float(np.median(Y[ring & paint])) if (ring & paint).any() else 1.0
        if soft:
            # (the bars' red RELATIVE to their brightness: (17, 5, 2) and (7, 2, 1) are both 0.8, grey glass 0; read off the
            #  picture a little smoothed, the 8-bit grain of such dark pixels is as big as the difference)
            sm_ = cv2.GaussianBlur(rgb, (0, 0), 0.7)
            rr_ = (sm_[..., 0] - 0.5 * (sm_[..., 1] + sm_[..., 2])) / np.maximum(sm_[..., 0], 0.012)
            sa_ = np.clip((0.40 - rr_) / 0.25, 0, 1) * np.clip((0.18 - Y) / 0.04, 0, 1)
            # (the frame's outer edge is a mixture of frame and wall, greyish and half dark: within 2 px of the wall nothing is glass)
            sa_ = sa_ * ~ndi.binary_dilation((Y > 0.16) & ndi.binary_dilation(sub, iterations=3), iterations=2)
            sa_ = sa_ * np.clip(cv2.GaussianBlur(sub.astype(np.float32), (0, 0), 0.8) * 2.0 - 1.0, 0, 1)    # (feathered just inside the shape)
            gl = sub & (sa_ > 0.03) & (inst == 0)
            softmap = np.where(gl, sa_, softmap)
        elif raw:
            gl = sub & (inst == 0)
        else:
            gl = sub & ~bars & (inst == 0)
            if fall:                                         # only thin bars are frame: a broad dark red thing is the room's
                gl = sub & ~(bars & ~ndi.binary_opening(bars, structure=np.ones((13, 13), bool))) & (inst == 0)
            out_ = outside if not keepout else np.zeros((H, W), bool)
            if only_navy:
                nv_ = (Y < 0.24) & (Y > 0.02) & ((b - r) > 0.03) & ((b - r) < 0.30) & (g >= r - 0.01) & (b >= g - 0.02)
                gl &= ndi.binary_closing(nv_, structure=K3) & ~out_
            elif lightblue:                                  # sky-mirroring glass only (no navy: a dark rope in front is not glass)
                gl &= ndi.binary_closing(((b - r) > 0.10) & (sat > sat_min) & (g > r), structure=K3) & ~out_
            elif only_blue:                                  # bluish glass of any brightness: sky-mirroring panes, navy
                nv_ = (Y < 0.24) & (Y > 0.02) & ((b - r) > 0.03) & ((b - r) < 0.30) & (g >= r - 0.01) & (b >= g - 0.02)
                bl_ = (((b - r) > 0.10) & (sat > sat_min) & (g > r)) | nv_
                gl &= ndi.binary_closing(bl_, structure=K3) & ~out_
            elif not fall:
                # the wall's paint and whatever bright paint is joined to it (the frame, its tracery): not the pale things
                # of the room behind the glass
                sy_, sx_ = np.nonzero(sub)
                ks_ = max(9, int(0.06 * min(sy_.max() - sy_.min() + 1, sx_.max() - sx_.min() + 1))) | 1
                band_ = ndi.binary_dilation(sub, iterations=ks_ + 2) & ~sub
                br0_ = (((sat < 0.24) & (Y > 0.80 * wallY)) & ndi.binary_dilation(sub, iterations=4)) | band_
                broad_ = ndi.binary_opening(br0_, structure=np.ones((ks_, ks_), bool))
                bl2_, bn2_ = ndi.label(broad_, structure=K3)             # 1. broad paint joined to the wall: wall, broad frame
                ids_ = np.unique(bl2_[band_])
                wall_ = np.isin(bl2_, ids_[ids_ > 0])
                thin_ = br0_ & ~broad_                                    # 2. thin paint joined to that: the tracery
                if tracery:
                    bl3_, bn3_ = ndi.label(thin_ | wall_, structure=K3)
                    ids_ = np.unique(bl3_[wall_])
                    gl &= ~np.isin(bl3_, ids_[ids_ > 0])
                else:
                    # joined through a neck 2 px wide or more (a pale curtain behind a 1 px frame is no wall)
                    cand_ = ndi.binary_opening(thin_ | wall_, structure=np.ones((2, 2), bool))
                    bl3_, bn3_ = ndi.label(cand_)
                    ids_ = np.unique(bl3_[wall_ & cand_])
                    jn_ = np.isin(bl3_, ids_[ids_ > 0])
                    gl &= ~((ndi.binary_dilation(jn_, structure=K3) & (thin_ | wall_)) | wall_)
            sy_, sx_ = np.nonzero(sub)
            if min(sy_.max() - sy_.min() + 1, sx_.max() - sx_.min() + 1) >= 14:
                gl = ndi.binary_opening(gl, structure=K3)
            if hull_o:                                       # each patch's convex hull: straight edges for a pane seen edge-on
                hl_, hn_ = ndi.label(gl)
                hu_ = np.zeros((H, W), np.uint8)
                for i_ in range(1, hn_ + 1):
                    c_ = hl_ == i_
                    if c_.sum() < 30:
                        continue
                    cs_, _ = cv2.findContours(c_.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    cv2.fillConvexPoly(hu_, cv2.convexHull(np.concatenate(cs_)), 1)
                gl = hu_.astype(bool) & sub & ~bars & (inst == 0)
        if isinstance(bx, dict) and bx.get("minus"):         # shapes taken out of this window (a rope, a stay crossing it)
            mm_ = np.zeros((H, W), np.uint8)
            for q_ in bx["minus"]:
                cv2.fillPoly(mm_, [np.array(q_, np.int32)], 1)
            gl = gl & ~mm_.astype(bool)
        if gl.sum() < 20:
            no("add: nothing in the box")
            continue
        cls, note, tex_ = classify(rgb, gl, fcls)
        ys, xs = np.nonzero(gl)
        add(gl, cls, "add", note, [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1], tex=tex_, forced=bool(fcls))
    # ---- 6. alpha
    gl = (inst > 0).astype(np.float32)
    a = np.clip(guided(Y, gl, 2, 4e-4), 0, 1)
    a = np.where(ndi.binary_dilation(inst > 0, iterations=1), a, 0.0)
    a = np.where(ndi.binary_erosion(inst > 0, iterations=2), 1.0, a)
    a = np.where(softmap > 0, softmap, a)
    idx = ndi.distance_transform_edt(inst == 0, return_distances=False, return_indices=True)
    inst_a = np.where(a > 0.02, inst[idx[0], idx[1]], 0).astype(np.uint16)
    np.savez_compressed(os.path.join(out, name + ".w5.npz"), inst=inst_a, alpha=(a * 255 + 0.5).astype(np.uint8))
    empty_z = []
    for key_ in ("zones", "zones_fine"):
        for q in ann.get(key_) or []:
            if len(q) == 4 and not isinstance(q[0], (list, tuple)):
                zx0, zy0, zx1, zy1 = [int(v) for v in q]
                if not (inst[max(0, zy0):zy1, max(0, zx0):zx1] > 0).any():
                    empty_z.append([key_, zx0, zy0, zx1, zy1])
    have_ = set(int(v) for v in np.unique(inst_a))
    meta = [q for q in meta if q["id"] in have_]            # (a find that an "add ... replace" cleared is not listed)
    json.dump(dict(windows=meta, lamps=[], rejected=rej, empty_zones=empty_z), open(os.path.join(out, name + ".w5.json"), "w"))
    print("W6 %-34s %2d windows (%s) %.1f s | rejected %s" % (name, len(meta), " ".join("%s%d" % (c[0], sum(1 for q in meta if q["cls"] == c)) for c in ("navy", "see", "pale")),
                                                        time.time() - t0, rej), flush=True)


if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    names = sys.argv[2:]
    if names == ["--all"]:
        names = [os.path.splitext(l.rstrip("\n").split("\t")[1])[0] for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
    fp = os.path.join(HERE, "work", "win5_fix.json")
    fix = json.load(open(fp, encoding="utf-8")) if os.path.exists(fp) else {}
    for n in names:
        try:
            one(n, out, fix)
        except Exception as e:
            import traceback
            traceback.print_exc()
            print("W6 FAIL", n, repr(e)[:200], flush=True)
