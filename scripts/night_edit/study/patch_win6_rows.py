"""Patch win6.py: a frameless navy blob needs EVIDENCE to be a window (2026-11-22). Run once: python -I patch_win6_rows.py"""
import ast
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()
i0 = s.index("        # ---- 3. far windows and frameless lights: navy blobs ringed by paint")
i1 = s.index("    # ---- my own boxes: whatever in the box is neither wall paint nor bar")
new = '''        # ---- 3. far windows and frameless lights: navy blobs ringed by paint. A lone dark blue blob is too often a sliver of
        # shade between a pillar and a beam (2026-11-22: such a one was lit as a cream fleck on a deckhead), so a blob is
        # taken only with EVIDENCE that it is a window: it stands where the annotation says windows are (zones, zones_fine,
        # lit); or it is one of a ROW (three or more windows or blobs whose middles lie on one line, as the windows of one
        # wall do in any view, their sizes changing steadily along it); or it is big, compact and wholly ringed by paint.
        taken = ndi.binary_dilation(inst > 0, iterations=6)
        nv = ndi.binary_opening(navy & ~taken, structure=K3)
        grp, gn = ndi.label(ndi.binary_dilation(nv, iterations=5))
        barw = [q["box"] for q in meta if q["src"] == "bars"]
        cands = []
        for i, sl in enumerate(ndi.find_objects(grp), 1):
            y0, y1, x0, x1 = max(0, sl[0].start - 20), min(H, sl[0].stop + 20), max(0, sl[1].start - 20), min(W, sl[1].stop + 20)
            m = (grp[y0:y1, x0:x1] == i) & nv[y0:y1, x0:x1]
            if int(m.sum()) < 24:
                continue
            # (a group of far windows side by side is wide: each of its blobs is judged on its own)
            bl_, bn_ = ndi.label(m)
            sizes_ = ndi.sum(m, bl_, np.arange(1, bn_ + 1)) if bn_ else []
            for j_, sl_ in enumerate(ndi.find_objects(bl_), 1):
                h_, w_ = sl_[0].stop - sl_[0].start, sl_[1].stop - sl_[1].start
                a_ = float(sizes_[j_ - 1])
                why_ = None
                if a_ < 14 or h_ < 5 or w_ < 2:
                    why_ = "navy speck"
                elif w_ > 1.6 * h_:
                    why_ = "navy flat sliver"
                elif h_ > 4.6 * w_:
                    why_ = "navy thin sliver"
                elif a_ < 0.55 * h_ * w_:
                    why_ = "navy wedge"
                if why_ is None:
                    mj = bl_ == j_
                    ys, xs = np.nonzero(mj)
                    gx0, gy0, gx1, gy1 = int(xs.min()) + x0, int(ys.min()) + y0, int(xs.max()) + x0 + 1, int(ys.max()) + y0 + 1
                    cxm, cym = float(xs.mean()) + x0, float(ys.mean()) + y0
                    if gy0 <= 1 or gx0 <= 1 or gy1 >= H - 1 or gx1 >= W - 1:
                        why_ = "navy at the edge"
                    elif h_ * w_ > 0.03 * H * W:
                        why_ = "navy too big"
                    else:
                        for bx0, by0, bx1, by1 in barw:
                            pd_ = max(3, min(14, int(0.25 * min(bx1 - bx0, by1 - by0))))
                            if gx0 < bx1 + pd_ and gx1 > bx0 - pd_ and gy0 < by1 + pd_ and gy1 > by0 - pd_:
                                why_ = "navy by a window"       # (a scrap of a pane cut off by its own frame, the gap between two frames)
                                break
                if why_ is None:
                    blob = ndi.binary_dilation(mj, iterations=2)
                    ring = ndi.binary_dilation(blob, iterations=10) & ~ndi.binary_dilation(blob, iterations=3)
                    pr = float((paint | bars)[y0:y1, x0:x1][ring].mean())
                    if pr < 0.62 or float(Y[y0:y1, x0:x1][ring].mean()) < float(Y[y0:y1, x0:x1][mj].mean()) + 0.06:
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
                full = np.zeros((H, W), bool)
                full[y0:y1, x0:x1] = mj
                cands.append(dict(m=full, box=[gx0, gy0, gx1, gy1], c=(cxm, cym), h=float(h_), w=float(w_), a=a_, pr=pr))
        # evidence
        items = [dict(c=((q[0] + q[2]) / 2.0, (q[1] + q[3]) / 2.0), h=float(q[3] - q[1]), bar=True) for q in barw] + cands
        rowev = [False] * len(items)
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
                    if abs(dx_ * uy - dy_ * ux) <= max(2.5, 0.22 * it["h"]):
                        inl.append((dx_ * ux + dy_ * uy, k_))
                if len(inl) < 3:
                    continue
                inl.sort()
                tt = np.array([t for t, _ in inl])
                lh = np.log(np.array([items[k_]["h"] for _, k_ in inl]))
                A_ = np.c_[tt, np.ones(len(tt))]
                co = np.linalg.lstsq(A_, lh, rcond=None)[0]
                good = np.abs(lh - A_ @ co) < 0.35               # sizes that change steadily along the line
                gaps_ok = np.ones(len(inl), bool)
                for q_ in range(len(inl)):                         # a neighbour within reach on one side at least
                    hq = items[inl[q_][1]]["h"]
                    near = [abs(tt[q_] - tt[r_]) for r_ in (q_ - 1, q_ + 1) if 0 <= r_ < len(inl) and good[r_]]
                    gaps_ok[q_] = bool(near) and min(near) < 14 * hq
                keep_ = good & gaps_ok
                if keep_.sum() >= 3:
                    for q_ in np.nonzero(keep_)[0]:
                        rowev[inl[q_][1]] = True
        for k_, cd in enumerate(cands):
            ev = None
            cx_, cy_ = int(cd["c"][0]), int(cd["c"][1])
            if zone_ev[cy_, cx_]:
                ev = "zone"
            elif rowev[len(barw) + k_]:
                ev = "row"
            elif cd["a"] >= 260 and cd["a"] >= 0.72 * cd["h"] * cd["w"] and cd["pr"] >= 0.85 and 0.6 <= cd["h"] / cd["w"] <= 3.2:
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
a = '''    drops = fx.get("drop_at", [])
    rej = {}
'''
b = '''    drops = fx.get("drop_at", [])
    rej = {}
    fx = dict(fx)
    zone_ev = np.zeros((H, W), bool)                        # where the annotation says windows are
    for key_ in ("zones", "zones_fine", "lit"):
        for q in ann.get(key_) or []:
            if len(q) == 4 and not isinstance(q[0], (list, tuple)):
                zone_ev[max(0, int(q[1]) - 4):int(q[3]) + 4, max(0, int(q[0]) - 4):int(q[2]) + 4] = True
            elif len(q) >= 3:
                zm_ = np.zeros((H, W), np.uint8)
                cv2.fillPoly(zm_, [np.array(q, np.int32)], 1)
                zone_ev |= zm_.astype(bool)
'''
assert s.count(a) == 1
s = s.replace(a, b)
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("win6 patched")
