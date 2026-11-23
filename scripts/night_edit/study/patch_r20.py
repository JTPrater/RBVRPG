"""Round 20 (2026-11-23 01:30). Looking at the first finished pictures beside the set in the game showed that two of my changes
had altered the LOOK the user called fine ("the edits look fine but some of the windows dont have a light at all"), not only
removed blemishes:
 - the sunset's sun share (I had made it a faint, even grade: duller funnels, greyer paint, pale green windows);
 - the lit windows (even panes: the "flat amber panels" the user laughed at on 2026-11-17; the code's own comments say so).
Both go back to the earlier look, without its blemishes:
 A. sunset: the earlier formula for the sun's share (brightness over a material's reflectance), its hard material classes
    made soft and read from a slightly smoothed picture (no pixel flips); under a deckhead the share is evened out over each
    stretch (the brown / violet patchwork from beam face to beam face), on open decks smoothed within surfaces only.
 B. windows: the earlier drawing (a room's light: ceiling, walls, a lamp, darker below and towards the sides; or the glass's
    own day detail where it shows a room; each pane set back in its frame), now PER WINDOW found by win6.py with its clean
    matte: one room a window, the day values read from the panes' insides (no rim lines), room and day detail BLENDED by how
    much the glass shows (it was a switch: like windows side by side came out in two styles), level and warmth from a smooth
    field (neighbours alike). Windows marked "see" by hand keep the room's own picture."""
import ast
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "night4.py")
s = open(p, encoding="utf-8").read()

# ---- A. the sunset's sun share
i0 = s.index("    # (2026-11-22) the sun's share was read off the guessed albedo (see above) and came out as patchwork: one face of a\n")
i1 = s.index("    TWI_S = s_\n")
newA = '''    # (2026-11-23) the sun's share as it was before 2026-11-22 (the user found the sunset pictures fine), its material classes
    # soft and read from a slightly smoothed picture (hard limits flipped from pixel to pixel)
    Lb_ = cv2.GaussianBlur(relit, (0, 0), 1.5)
    ub_ = np.log(np.maximum(Lb_[..., 0], 1e-4) / np.maximum(Lb_[..., 1], 1e-4))
    wb_ = np.log(np.maximum(Lb_[..., 2], 1e-4) / np.maximum(Lb_[..., 1], 1e-4))

    def _rmp(x_, a_, b_):
        return np.clip((x_ - a_) / (b_ - a_), 0, 1)
    wn_ = (1 - _rmp(np.abs(ub_), 0.09, 0.15)) * (1 - _rmp(np.abs(wb_), 0.17, 0.27))      # (was |u| < 0.12 and |w| < 0.22)
    ww_ = _rmp(ub_, 0.09, 0.15) * _rmp(-wb_, 0.02, 0.08)                                   # (was u > 0.12 and w < -0.05)
    wo_ = np.clip(1 - wn_ - ww_, 0, 1)
    ref_s = 0.15 * wo_
    for wt_, hi_, lo_ in ((wn_, 0.70, 0.05), (ww_, 0.32, 0.10)):
        mm = ((wt_ > 0.5) & solid).astype(np.float32)
        if mm.sum() < 100:
            ref_s = ref_s + wt_ * 0.15
            continue
        lvl_, ld_ = masked_blur(np.sqrt(np.maximum(Yr, 0)), mm, 60)
        lvl_ = np.where(ld_ > 0.02, lvl_ ** 2, float(np.percentile(Yr[mm > 0.5], 80)))
        ref_s = ref_s + wt_ * (lo_ + (hi_ - lo_) * _rmp(Yr / np.maximum(lvl_, 1e-4), 0.22, 0.40))    # (was: bright if over 0.30 of the level)
    ref_s = ref_s / np.maximum(wn_ + ww_ + wo_, 1e-4)
    grain_ = np.clip(Yr / np.maximum(gblur(Yr, 6), 1e-4), 0.6, 1.5)
    Ei = Yr / np.maximum(ref_s * grain_, 1e-4)
    s_ = np.clip((np.log(np.maximum(Ei, 1e-4)) - np.log(0.42)) / (np.log(0.95) - np.log(0.42)), 0, 1)
    s_ = s_ * s_ * (3 - 2 * s_)
    s_ = np.maximum(s_, sunp) if cov.any() else s_                      # a sun patch under a deckhead is sun
    wood_ = ((yy > hy + 25) & solid).astype(np.float32) * ww_            # deck planking seen from above
    s_ = s_ * (1 - 0.38 * wood_)
    s_ = gblur(s_.astype(np.float32), 0.8)
    # under a deckhead the share is evened out over each stretch (it changed from one face of a beam to the next: brown
    # and violet patchwork); everywhere it is smoothed within surfaces, the picture's own edges kept
    cs_ = (cov & solid).astype(np.float32)
    if cs_.sum() > 500:
        sm_, sd_ = masked_blur(s_, cs_, 45)
        cf_ = np.clip(gblur(cs_, 6), 0, 1)
        s_ = s_ * (1 - cf_) + np.where(sd_ > 0.02, sm_, s_) * cf_
    s_ = np.clip(light3d.guided(im.astype(np.float32), s_.astype(np.float32), 8, 4e-3), 0, 1)
'''
s = s[:i0] + newA + s[i1:]

# ---- B. the windows
i0 = s.index('        cls = W5["m"][wid]["cls"]\n        hh_, ww_ = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start\n')
i1 = s.index("        glow[sl] = np.where(sub[..., None], g_, glow[sl])\n        emw[sl] = np.where(sub, e_, emw[sl])\n")
newB = '''        cls = W5["m"][wid]["cls"]
        hh_, ww_ = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        ty = (yy[sl] - sl[0].start) / max(hh_, 1)
        tx = (xx[sl] - sl[1].start) / max(ww_, 1)
        _cx, _cy = 0.5 * (sl[1].start + sl[1].stop), 0.5 * (sl[0].start + sl[0].stop)
        rw = np.random.default_rng(int(1915 + 7919 * wid + 31 * int(_cx) + 17 * int(_cy)))     # this window's own room
        lvl = 0.925 + 0.14 * _fld(_cx, _cy, 0)              # (the earlier 0.75 .. 1.10; neighbours alike: _fld)
        col = WIN_GLOW * (1 + 0.10 * _fld(_cx, _cy, 3) * np.array([0.0, 0.5, 1.0], np.float32))
        forced_see = cls == "see" and bool(W5["m"][wid].get("forced"))
        # the day picture's values from the panes' INSIDES, spread to their rims (a rim pixel is a mixture with the frame)
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
        c_ = dayL[sl]
        cden_ = np.maximum(den_, 1e-4)[..., None]
        cin_ = np.where((den_ > 0.05)[..., None], cv2.GaussianBlur(c_ * iw_[..., None], (0, 0), 2.0) / cden_, c_)
        chrom = cin_ / np.maximum(cin_ @ LUM, 1e-4)[..., None]
        # each pane set back in its frame: darker towards its edges (by the pane's own size)
        dg = cv2.distanceTransform(core.astype(np.uint8), cv2.DIST_L2, 3)
        pl_, pn_ = ndi.label(core)
        dmx_ = np.ones(pn_ + 1, np.float32)
        if pn_:
            dmx_[1:] = np.maximum(ndi.maximum(dg, pl_, index=np.arange(1, pn_ + 1)), 1.0)
        dmap_ = cv2.dilate(dmx_[pl_], np.ones((5, 5), np.uint8))          # (the alpha fringe takes its pane's)
        recess = 0.60 + 0.40 * np.clip(dg / dmap_ / 0.40, 0, 1) ** 0.8
        if forced_see:
            # the room behind the glass, lit: its own picture as warm light. The glass's veil (the window's darkest level) is
            # taken off; what is left is scaled so that the room's bright parts reach a lit pane's level, over a floor (a lit
            # room is nowhere black), with a little of its own colour; the daylight in the room's far windows (by far its
            # brightest, and bluish) is a dark window now.
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
            g_ = col[None, None, :] * np.clip(0.30 * chrom + 0.70, 0.6, 1.5) * (0.30 * WL * lvl * (0.86 + 0.14 * recess) * vs_)[..., None]
            e_ = 0.40
        else:
            # the room's light as it was drawn before: brighter towards the top, a soft highlight, falling off to the sides
            hx = rw.uniform(0.3, 0.7)
            prof = 0.80 + 0.32 * (1 - ty) ** 1.4 + 0.25 * np.exp(-(((tx - hx) / 0.35) ** 2 + (ty / 0.45) ** 2))
            prof = prof * (0.68 + 0.32 * np.clip(np.sin(np.pi * np.clip(tx, 0, 1)), 0, 1) ** 0.7)
            shape_ = 0.85 + 0.15 * np.clip(prof * lvl, 0, 2) / 1.2
            p85 = max(float(np.percentile(yv[inner], 85)), 1e-3)
            d_ = np.clip(Yin / p85, 0.04, 1.35)
            hp_ = d_ - cv2.GaussianBlur(d_, (0, 0), max(2.0, 0.06 * min(hh_, ww_)))
            # how much of a room the glass shows by day, 0 .. 1 (it was a switch at 0.045 / 0.10)
            ws_ = float(np.clip((float(np.std(hp_[inner])) - 0.035) / 0.035, 0, 1) * np.clip((float(np.std(d_[inner])) - 0.08) / 0.07, 0, 1))
            if cls == "navy":
                ws_ = 0.0
            # a pane that shows nothing by day shows the lit room behind it: its ceiling across the top with its lamp, its
            # walls in the middle, darker below; no texture of any kind, only light falling off
            ceil_ = rw.uniform(0.18, 0.32)
            floor_ = rw.uniform(0.66, 0.80)
            room = np.where(ty < ceil_, 0.95, np.where(ty < floor_, rw.uniform(0.55, 0.70), rw.uniform(0.26, 0.40)))
            room = cv2.GaussianBlur(room.astype(np.float32), (0, 0), max(1.0, 0.05 * hh_))
            lx_, ly_ = rw.uniform(0.25, 0.75), ceil_ * rw.uniform(0.45, 0.75)
            room = room + 0.38 * np.exp(-(((tx - lx_) / 0.20) ** 2 + ((ty - ly_) / 0.11) ** 2))
            room = room * (0.72 + 0.28 * np.clip(np.sin(np.pi * np.clip(tx, 0, 1)), 0, 1) ** 0.6)
            det = np.clip(room, 0.15, 1.35) * (0.94 + 0.12 * np.clip(d_, 0, 1.3)) * (1 - ws_) + d_ * ws_
            det = cv2.GaussianBlur(det.astype(np.float32), (0, 0), 1.8)
            det = 0.40 + 0.60 * np.clip(det, 0, 1.35)                    # lit from behind the glass glows on the whole
            g_ = col[None, None, :] * (0.25 * chrom + 0.75) * ((0.06 + 0.94 * det ** 1.15) * 0.30 * shape_ * WL * recess)[..., None]
            e_ = 0.55
'''
s = s[:i0] + newB + s[i1:]
a = '''        emis += glow * (A5 * emw * LS * 0.5)[..., None]
'''
assert s.count(a) == 1
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("round 20 patched: night4.py (the sunset's sun share; the windows' earlier look per window)")
