"""win6.py round 9 (2026-11-23 00:45): a frameless pane's glass grows to its frame (its edge is the frame's, not a colour
threshold's); small far things (navy groups under 300 px, the fine zones' specks) need a place in a window ROW when the
picture has near windows to measure by; "add" entries take "navy" (navy pixels only), "replace" (what was found in the
box is cleared first) and "ell" ([cx, cy, rx, ry], an oval). night4.py: the see-through share starts at a higher texture."""
import ast
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()


def sub(a, b, n=1):
    global s
    assert s.count(a) == n, (s.count(a), a[:90])
    s = s.replace(a, b)


# ---- 1. grow to the frame
sub('''    bc, nc = [], []                                         # candidates: bar structures, navy groups
''', '''    bc, nc = [], []                                         # candidates: bar structures, navy groups
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
''')
sub('''            full = np.zeros((H, W), bool)
            full[y0:y1, x0:x1] = m
            nc.append(dict(m=full, box=[gx0, gy0, gx1, gy1], c=(cxm, cym), h=float(h_), w=float(w_), a=a_, pr=pr, up=upright, oval=oval,''',
    '''            full = np.zeros((H, W), bool)
            full[y0:y1, x0:x1] = m
            if a_ >= 150:
                full = grow(full, a_)
                ys, xs = np.nonzero(full)
                gx0, gy0, gx1, gy1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
                a_ = float(full.sum())
                h_, w_ = gy1 - gy0, gx1 - gx0
            nc.append(dict(m=full, box=[gx0, gy0, gx1, gy1], c=(cxm, cym), h=float(h_), w=float(w_), a=a_, pr=pr, up=upright, oval=oval,''')

# ---- 2. fine candidates before the evidence
sub('''        # ---- evidence: rows with an anchor
        items = bc + nc
''', '''        # ---- the annotation's FINE zones (rows of far windows a few px wide, drawn by hand), and under a deckhead the zones
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
        has_anchor = hz is not None and any(q["anchor"] for q in bc)
        items = bc + nc + fc
''')
sub('''            if cd["inz"]:
                zm_ = max([zmax[zi] for zi, zr in enumerate(zone_rects) if zr[0] <= cx_ < zr[2] and zr[1] <= cy_ < zr[3]] or [0.0])
                if cd["a"] < 40.0 and not rowev[len(bc) + k_]:
                    no("navy scrap in a zone")
                    continue
''', '''            if cd["inz"]:
                zm_ = max([zmax[zi] for zi, zr in enumerate(zone_rects) if zr[0] <= cx_ < zr[2] and zr[1] <= cy_ < zr[3]] or [0.0])
                if cd["a"] < 40.0 and not rowev[len(bc) + k_]:
                    no("navy scrap in a zone")
                    continue
                if cd["a"] < 300.0 and has_anchor and not rowev[len(bc) + k_] and not cd["framed"] and cd["by"] is None:
                    later.append(cd)                         # (small and far: only in a window row; or as a pane of a taken window)
                    continue
''')
# the fine specks are taken after the navy groups; the old block goes
i0 = s.index("    # ---- the annotation's FINE zones (rows of far windows a few px wide, drawn by hand): night4's old rule, for whatever in")
i1 = s.index("    # ---- my own boxes: whatever in the box is neither wall paint nor bar")
s = s[:i0] + s[i1:]
sub('''        for cd in later:
            no("navy without evidence")
''', '''        for cd in later:
            no("navy without evidence")
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
''')

# ---- 3. add options
i0 = s.index("    for bx in fx.get(\"add\", []):\n")
i1 = s.index("    # ---- 6. alpha\n")
s = s[:i0] + '''    for bx in fx.get("add", []):
        sub = np.zeros((H, W), bool)
        only_navy = replace = False
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
        else:
            x0, y0, x1, y1 = [int(v) for v in bx[:4]]
            sub[y0:y1, x0:x1] = True
            fcls = bx[4] if len(bx) > 4 and bx[4] in ("navy", "see", "pale") else None
            fall = "all" in bx[4:]
            only_navy, replace = "navyonly" in bx[4:], "replace" in bx[4:]
        if replace:                                         # what was found in the box goes: this entry stands for it
            inst[sub] = 0
        ring = ndi.binary_dilation(sub, iterations=10) & ~sub
        wallY = float(np.median(Y[ring & paint])) if (ring & paint).any() else 1.0
        gl = sub & ~bars & (inst == 0)
        if only_navy:
            gl &= ndi.binary_closing(navy, structure=K3)
        elif not fall:
            gl &= ~(paint & (Y > 0.80 * wallY))
        gl = ndi.binary_opening(gl, structure=K3)
        if gl.sum() < 20:
            no("add: nothing in the box")
            continue
        cls, note, tex_ = classify(rgb, gl, fcls)
        ys, xs = np.nonzero(gl)
        add(gl, cls, "add", note, [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1], tex=tex_, forced=bool(fcls))
''' + s[i1:]
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)

p = os.path.join(HERE, "night4.py")
s = open(p, encoding="utf-8").read()
sub('''            wsee = float(np.clip((tex_w - 0.17) / 0.12, 0, 1) * np.clip((npx - 800) / 2200.0, 0, 1))''',
    '''            wsee = float(np.clip((tex_w - 0.24) / 0.12, 0, 1) * np.clip((npx - 800) / 2200.0, 0, 1))''')
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("win6 + night4 patched (round 9)")
