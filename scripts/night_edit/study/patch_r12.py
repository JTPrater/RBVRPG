"""Round 12 (2026-11-23).
win6.py   a navy pane that lies inside a found window's outline is that window's pane (a frame with a gap left it out: one dark
          pane in a lit window); a pane off the eye's level under a deckhead is not thrown out at once but may join a window
          taken beside it (the fanlight of a tall window); "add" option "hull" (each patch's convex hull: straight edges for a
          pane seen edge-on, whose colour edge is ragged); the default "add" mode tells a white frame's thin tracery and the
          wall from broad pale things of the room behind (two steps: broad paint joined to the wall, then thin paint joined to
          that); windows left without a pixel are not listed.
night4.py an annotation's "interior" shape that a found window covers is left to the window (a rough quadrilateral lit the
          window's bars with the room)."""
import ast
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def patch(name, pairs):
    p = os.path.join(HERE, name)
    s = open(p, encoding="utf-8").read()
    for a, b in pairs:
        assert s.count(a) == 1, (name, s.count(a), a[:90])
        s = s.replace(a, b)
    ast.parse(s)
    open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
    os.replace(p + ".tmp", p)


patch("win6.py", [
    # the hull of every accepted bar structure
    ('''anchor=anchor, tex=tex_, forced=bool(forced)))
                seen[y0:y1, x0:x1] |= hull
''', '''anchor=anchor, tex=tex_, forced=bool(forced)))
                bc[-1]["hm"] = np.zeros((H, W), bool)
                bc[-1]["hm"][y0:y1, x0:x1] = hull
                seen[y0:y1, x0:x1] |= hull
'''),
    ('''            by_win = None
            medn = np.median(rgb[y0:y1, x0:x1][m], axis=0)
''', '''            by_win = None
            pane_of = None
            for k_, q in enumerate(bc):                     # mostly inside a found window's outline: its pane
                if float((m & q["hm"][y0:y1, x0:x1]).sum()) >= 0.7 * a_:
                    pane_of = k_
                    break
            medn = np.median(rgb[y0:y1, x0:x1][m], axis=0)
'''),
    ('''            elif not inz and (gy0 <= 1 or gx0 <= 1 or gy1 >= H - 1 or gx1 >= W - 1):
                why_ = "navy at the edge"
            elif h_ * w_ > (0.20 if inz else 0.03) * H * W:
                why_ = "navy too big"
            else:
''', '''            elif pane_of is not None:
                by_win = pane_of
            elif not inz and (gy0 <= 1 or gx0 <= 1 or gy1 >= H - 1 or gx1 >= W - 1):
                why_ = "navy at the edge"
            elif h_ * w_ > (0.20 if inz else 0.03) * H * W:
                why_ = "navy too big"
            else:
'''),
    ('''                if not framed and not pane and (pr < (0.45 if inz else 0.62) or''', '''                if pane_of is not None:
                    pass
                elif not framed and not pane and (pr < (0.45 if inz else 0.62) or'''),
    ('''                           thin=thin_, inz=inz, by=by_win, framed=framed))''', '''                           thin=thin_, inz=inz, by=by_win, framed=framed, is_pane=pane_of is not None))'''),
    # take
    ('''            cx_, cy_ = int(cd["c"][0]), int(cd["c"][1])
            strad = straddles(cd["box"], cd["c"][0])
            ev = None
            if cd["inz"]:
''', '''            cx_, cy_ = int(cd["c"][0]), int(cd["c"][1])
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
'''),
    ('''                if covered and strad is False and cd["by"] is None and not near_strad(cd):
                    no("navy off the eye's level under a deckhead")      # (a zone drawn wide takes in the deckhead's ironwork)
                    continue
''', '''                if covered and strad is False and cd["by"] is None and not near_strad(cd):
                    cd["why_later"] = "navy off the eye's level under a deckhead"      # (a zone drawn wide takes in the deckhead's ironwork)
                    later.append(cd)                         # (unless it is a pane of a window taken beside it)
                    continue
'''),
    ('''            elif covered and strad is False and not near_strad(cd):
                no("navy off the eye's level under a deckhead")
                continue
''', '''            elif covered and strad is False and not near_strad(cd):
                cd["why_later"] = "navy off the eye's level under a deckhead"
                later.append(cd)
                continue
'''),
    ('''        for cd in later:
            no("navy without evidence")
''', '''        for cd in later:
            no(cd.get("why_later", "navy without evidence"))
'''),
    # add: hull, two-step tracery
    ('''        only_navy = replace = only_blue = raw = keepout = False
''', '''        only_navy = replace = only_blue = raw = keepout = hull_o = False
'''),
    ('''            keepout = bool(bx.get("keepout"))
''', '''            keepout = bool(bx.get("keepout"))
            hull_o = bool(bx.get("hull"))
'''),
    ('''            keepout = "keepout" in bx[4:]
''', '''            keepout = "keepout" in bx[4:]
            hull_o = "hull" in bx[4:]
'''),
    ('''                band_ = ndi.binary_dilation(sub, iterations=4) & ~sub
                br_ = (((sat < 0.24) & (Y > 0.85 * wallY)) & ndi.binary_dilation(sub, iterations=4)) | band_
                bl2_, bn2_ = ndi.label(br_, structure=K3)
                ids_ = np.unique(bl2_[band_])
                gl &= ~np.isin(bl2_, ids_[ids_ > 0])
''', '''                sy_, sx_ = np.nonzero(sub)
                ks_ = max(9, int(0.06 * min(sy_.max() - sy_.min() + 1, sx_.max() - sx_.min() + 1))) | 1
                band_ = ndi.binary_dilation(sub, iterations=ks_ + 2) & ~sub
                br0_ = (((sat < 0.24) & (Y > 0.80 * wallY)) & ndi.binary_dilation(sub, iterations=4)) | band_
                broad_ = ndi.binary_opening(br0_, structure=np.ones((ks_, ks_), bool))
                bl2_, bn2_ = ndi.label(broad_, structure=K3)             # 1. broad paint joined to the wall: wall, broad frame
                ids_ = np.unique(bl2_[band_])
                wall_ = np.isin(bl2_, ids_[ids_ > 0])
                thin_ = br0_ & ~broad_                                    # 2. thin paint joined to that: the tracery
                bl3_, bn3_ = ndi.label(thin_ | wall_, structure=K3)
                ids_ = np.unique(bl3_[wall_])
                gl &= ~np.isin(bl3_, ids_[ids_ > 0])
'''),
    ('''            gl = ndi.binary_opening(gl, structure=K3)
        if gl.sum() < 20:
            no("add: nothing in the box")
            continue
''', '''            gl = ndi.binary_opening(gl, structure=K3)
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
        if gl.sum() < 20:
            no("add: nothing in the box")
            continue
'''),
    ('''    json.dump(dict(windows=meta, lamps=[], rejected=rej, empty_zones=empty_z), open(os.path.join(out, name + ".w5.json"), "w"))
''', '''    have_ = set(int(v) for v in np.unique(inst_a))
    meta = [q for q in meta if q["id"] in have_]            # (a find that an "add ... replace" cleared is not listed)
    json.dump(dict(windows=meta, lamps=[], rejected=rej, empty_zones=empty_z), open(os.path.join(out, name + ".w5.json"), "w"))
'''),
])

patch("night4.py", [
    ('''inter = poly_mask(ANN.get("interior"), H, W) & solid          # (its far windows' sky is the outside's, drawn in 6.)
''', '''inter = np.zeros((H, W), bool)                               # (its far windows' sky is the outside's, drawn in 6.)
for _q in ANN.get("interior") or []:
    _pm = poly_mask([_q], H, W) & solid
    # (2026-11-23) a shape that a window found by win6 covers is that window's: its panes are exact, the hand-drawn
    # quadrilateral lit the bars with the room
    if W5 is not None and _pm.any() and float((W5["a"][_pm] > 0.5).mean()) > 0.30:
        rep["interior_left_to_windows"] = rep.get("interior_left_to_windows", 0) + 1
        continue
    inter |= _pm
'''),
])
print("round 12 patched: win6.py, night4.py")
