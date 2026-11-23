"""Patch win6.py, second round (2026-11-22 night): sunlit and hazy bars, windows cut by the picture's edge, far windows by
group again with a row model that follows perspective, a stricter lone-window rule, and a report of annotation zones in
which no window was found. Run once: python -I patch_win6_rows2.py"""
import ast
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:80])
    s = s.replace(a, b)


# ---- bars: in the sun, and hazy ones by local contrast
sub('''    bars = (r > 0.035) & (Y < 0.24) & ((g < 0.42 * r) | ((b > 0.75 * g) & (r > 1.45 * g) & (r > 1.45 * b))) & (r > 1.3 * b) & ~outside
    wood = (r > g + 0.05) & (g > b + 0.015) & (Y > 0.06) & ~bars            # chairs, rails, planks: orange-brown
''', '''    bars = (r > 0.035) & (Y < 0.24) & ((g < 0.42 * r) | ((b > 0.75 * g) & (r > 1.45 * g) & (r > 1.45 * b))) & (r > 1.3 * b) & ~outside
    wood0 = (r > g + 0.05) & (g > b + 0.015) & (Y > 0.06)                  # chairs, rails, planks: orange-brown
    # (2026-11-22 night) bars in full sun are a bright brick red (150, 60, 45: "BD first port prom5"'s arched windows), and far
    # bars over frosted glass are a dull dark mauve (88, 62, 72: "BD first starb prom2"'s left two), red only against the
    # blue-grey glass and wall round them: a thin dark line (black-hat of the luminance) that is redder than neutral
    bars |= (Y < 0.42) & (r > 0.25) & (g < 0.48 * r) & (b < 0.42 * r) & ~outside
    bhat = cv2.morphologyEx(Y, cv2.MORPH_BLACKHAT, np.ones((11, 11), np.uint8))
    red_ = (r - 0.5 * (g + b)) / np.maximum(Y, 0.05)
    bars |= (bhat > 0.05) & (red_ > 0.14) & (b >= g - 0.012) & (Y < 0.45) & ~wood0 & ~outside
    wood = wood0 & ~bars
''')

# ---- a window cut by the picture's edge: the edge closes it
sub('''            filled = ndi.binary_fill_holes(C)
            holes = filled & ~C
            cs, _ = cv2.findContours(C.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
''', '''            Cb = C                                           # (the bars themselves; C may gain the picture's edge below)
            C = C.copy()
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
            filled = ndi.binary_fill_holes(C)
            holes = filled & ~C
            cs, _ = cv2.findContours(C.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
''')
sub('''            gl = inside & ~C & ~bars[y0:y1, x0:x1]
            if why is None and gl.sum() < 30:''', '''            gl = inside & ~Cb & ~bars[y0:y1, x0:x1]
            if why is None and gl.sum() < 30:''')

# ---- far windows: groups, evidence
i0 = s.index("        # ---- 3. far windows and frameless lights: navy blobs ringed by paint")
i1 = s.index("    # ---- my own boxes: whatever in the box is neither wall paint nor bar")
new = '''        # ---- 3. far windows and frameless lights: navy blobs ringed by paint. A lone dark blue blob is too often a sliver of
        # shade between a pillar and a beam (2026-11-22: such a one was lit as a cream fleck on a deckhead), so a group of
        # blobs is taken only with EVIDENCE that it is a window: it stands where the annotation says windows are (zones,
        # zones_fine, lit); or it is one of a ROW as perspective draws one (three or more windows whose middles lie on one
        # line and whose heights shrink in step with the distance to where that line meets the horizon; side by side and
        # alike on a wall seen square on); or it is big, compact, upright-sided and wholly ringed by paint. Under a deckhead
        # a window stands at the eye's level (it straddles the horizon): what hangs above that is the deckhead's ironwork.
        taken = ndi.binary_dilation(inst > 0, iterations=6)
        nv = ndi.binary_opening(navy & ~taken, structure=K3)
        grp, gn = ndi.label(ndi.binary_dilation(nv, iterations=5))
        barw = [q["box"] for q in meta if q["src"] == "bars"]
        covered = bool(ann.get("covered"))
        cands = []
        for i, sl in enumerate(ndi.find_objects(grp), 1):
            y0, y1, x0, x1 = max(0, sl[0].start - 20), min(H, sl[0].stop + 20), max(0, sl[1].start - 20), min(W, sl[1].stop + 20)
            m = (grp[y0:y1, x0:x1] == i) & nv[y0:y1, x0:x1]
            if int(m.sum()) < 24:
                continue
            # (a group of far panes side by side is wide: each of its blobs is judged on its own, the group is one window)
            bl_, bn_ = ndi.label(m)
            sizes_ = ndi.sum(m, bl_, np.arange(1, bn_ + 1)) if bn_ else []
            ok_ = np.zeros(bn_ + 1, bool)
            for j_, sl_ in enumerate(ndi.find_objects(bl_), 1):
                h_, w_ = sl_[0].stop - sl_[0].start, sl_[1].stop - sl_[1].start
                a_ = float(sizes_[j_ - 1])
                if a_ < 14 or h_ < 5 or w_ < 2:
                    why_ = "navy speck"
                elif w_ > 1.6 * h_:
                    why_ = "navy flat sliver"
                elif h_ > 4.6 * w_:
                    why_ = "navy thin sliver"
                elif a_ < 0.55 * h_ * w_:
                    why_ = "navy wedge"
                else:
                    ok_[j_] = True
                    continue
                rej[why_] = rej.get(why_, 0) + 1
            m = ok_[bl_]
            a_ = float(m.sum())
            if a_ < 24:
                continue
            ys, xs = np.nonzero(m)
            h_, w_ = int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1)
            gx0, gy0, gx1, gy1 = int(xs.min()) + x0, int(ys.min()) + y0, int(xs.max()) + x0 + 1, int(ys.max()) + y0 + 1
            cxm, cym = float(xs.mean()) + x0, float(ys.mean()) + y0
            why_ = None
            if gy0 <= 1 or gx0 <= 1 or gy1 >= H - 1 or gx1 >= W - 1:
                why_ = "navy at the edge"
            elif h_ * w_ > 0.03 * H * W:
                why_ = "navy too big"
            else:
                for bx0, by0, bx1, by1 in barw:
                    pd_ = max(3, min(14, int(0.25 * min(bx1 - bx0, by1 - by0))))
                    if gx0 < bx1 + pd_ and gx1 > bx0 - pd_ and gy0 < by1 + pd_ and gy1 > by0 - pd_:
                        why_ = "navy by a window"           # (a scrap of a pane cut off by its own frame, the gap between two frames)
                        break
            if why_ is None:
                blob = ndi.binary_dilation(m, iterations=2)
                ring = ndi.binary_dilation(blob, iterations=10) & ~ndi.binary_dilation(blob, iterations=3)
                pr = float((paint | bars)[y0:y1, x0:x1][ring].mean())
                if pr < 0.62 or float(Y[y0:y1, x0:x1][ring].mean()) < float(Y[y0:y1, x0:x1][m].mean()) + 0.06:
                    why_ = "navy not in a wall"
                elif level(ring, y0, x0):
                    why_ = "navy on a deckhead"
                elif any(abs(cxm - lx) < 26 + w_ and abs(cym - ly) < 26 + h_ for lx, ly in lamps):
                    why_ = "a lamp"
                elif any(x0 <= dx < x1 and y0 <= dy < y1 and blob[int(dy) - y0, int(dx) - x0] for dx, dy in drops):
                    why_ = "dropped"
            if why_:
                rej[why_] = rej.get(why_, 0) + 1
                continue
            # upright sides (a window's sides stay upright in these pictures: the camera never rolls)
            rws = [np.nonzero(m[q_])[0] for q_ in range(ys.min() + int(0.2 * h_), ys.max() + 1 - int(0.2 * h_))]
            rws = [(k_, q_.min(), q_.max()) for k_, q_ in enumerate(rws) if len(q_)]
            upright = False
            if len(rws) >= 4:
                rr_ = np.array(rws, np.float64)
                sl_l, sl_r = np.polyfit(rr_[:, 0], rr_[:, 1], 1)[0], np.polyfit(rr_[:, 0], rr_[:, 2], 1)[0]
                upright = abs(sl_l) < 0.15 and abs(sl_r) < 0.15
            full = np.zeros((H, W), bool)
            full[y0:y1, x0:x1] = m
            cands.append(dict(m=full, box=[gx0, gy0, gx1, gy1], c=(cxm, cym), h=float(h_), w=float(w_), a=a_, pr=pr, up=upright))

        def hrow_at(x_):
            return hz[0] + (hz[1] - hz[0]) * x_ / float(W)
        items = [dict(c=((q[0] + q[2]) / 2.0, (q[1] + q[3]) / 2.0), h=float(q[3] - q[1]), box=q) for q in barw] + cands
        rowev = [False] * len(items)
        if hz is not None:
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
                    if side.sum() < 3:
                        continue
                    med_ = float(np.median(cc[side]))
                    good = side & (cc > 0.78 * med_) & (cc < 1.28 * med_)
                    if good.sum() >= 3:
                        med_ = float(np.median(cc[good]))
                        good = side & (cc > 0.78 * med_) & (cc < 1.28 * med_)
                    gaps_ok = np.zeros(len(inl), bool)
                    for q_ in range(len(inl)):                     # a neighbour within reach on one side at least
                        near = [abs(tt[q_] - tt[r_]) for r_ in range(len(inl)) if r_ != q_ and good[r_]]
                        gaps_ok[q_] = bool(near) and min(near) < 14 * hh[q_]
                    keep_ = good & gaps_ok
                    if keep_.sum() >= 3:
                        for q_ in np.nonzero(keep_)[0]:
                            rowev[inl[q_][1]] = True
        for k_, cd in enumerate(cands):
            ev = None
            cx_, cy_ = int(cd["c"][0]), int(cd["c"][1])
            strad = None if hz is None else bool(cd["box"][1] < hrow_at(cd["c"][0]) - 1 and cd["box"][3] > hrow_at(cd["c"][0]) + 1)
            if zone_ev[cy_, cx_]:
                ev = "zone"
            elif covered and strad is False:
                rej["navy off the eye's level under a deckhead"] = rej.get("navy off the eye's level under a deckhead", 0) + 1
                continue
            elif rowev[len(barw) + k_]:
                ev = "row"
            elif cd["a"] >= 260 and cd["a"] >= 0.78 * cd["h"] * cd["w"] and cd["pr"] >= 0.85 and 0.6 <= cd["h"] / cd["w"] <= 3.2 and cd["up"]:
                ev = "alone"
            if ev is None:
                rej["navy without evidence"] = rej.get("navy without evidence", 0) + 1
                continue
            add(cd["m"], "navy", "navy", "blob %dx%d %s" % (cd["w"], cd["h"], ev), cd["box"])
        # the annotation's own "lit" boxes (single far windows marked by hand) that nothing above found
        for q in ann.get("lit") or []:
            if len(q) == 4 and not isinstance(q[0], (list, tuple)):
                bx0, by0, bx1, by1 = [int(v) for v in q]
                if (inst[by0:by1, bx0:bx1] > 0).mean() < 0.15:
                    fx["add"] = list(fx.get("add", [])) + [[bx0, by0, bx1, by1]]
'''
s = s[:i0] + new + s[i1:]

# ---- the report: annotation zones in which nothing was found
sub('''    json.dump(dict(windows=meta, lamps=[], rejected=rej), open(os.path.join(out, name + ".w5.json"), "w"))
''', '''    empty_z = []
    for key_ in ("zones", "zones_fine"):
        for q in ann.get(key_) or []:
            if len(q) == 4 and not isinstance(q[0], (list, tuple)):
                zx0, zy0, zx1, zy1 = [int(v) for v in q]
                if not (inst[max(0, zy0):zy1, max(0, zx0):zx1] > 0).any():
                    empty_z.append([key_, zx0, zy0, zx1, zy1])
    json.dump(dict(windows=meta, lamps=[], rejected=rej, empty_zones=empty_z), open(os.path.join(out, name + ".w5.json"), "w"))
''')
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("win6 patched (round 2)")
