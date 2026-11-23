"""Patch win6.py, round 3 (2026-11-22 night, after tracing the misses): small gaps in a frame are closed before its holes are
looked for; brick-red sunlit bars a little wider; a frame's ring is judged without its neighbours' bars; the wall round a
navy pane by the ring's lighter quarter (a thick dark frame is in the ring too); panes of one window (navy groups with bars
between them) become one window; in a zone under a deckhead a navy group must still stand at the eye's level; a second pass
for frames that the sun turns orange (they pass as wood): taken only if what they enclose is blue glass."""
import ast
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()


def sub(a, b, n=1):
    global s
    assert s.count(a) == n, (s.count(a), a[:90])
    s = s.replace(a, b)


# 1. sunlit bars a little wider
sub("bars |= (Y < 0.42) & (r > 0.25) & (g < 0.48 * r) & (b < 0.42 * r) & ~outside",
    "bars |= (Y < 0.42) & (r > 0.25) & (g < 0.52 * r) & (b < 0.46 * r) & ~outside")

sub('''            filled = ndi.binary_fill_holes(C)
            holes = filled & ~C
''', '''            filled = ndi.binary_fill_holes(ndi.binary_closing(np.pad(C, 8), structure=np.ones((5, 5), bool), iterations=2)[8:-8, 8:-8] | C)
            holes = filled & ~C                             # (gaps of a few px in a frame are closed before its holes are looked for)
''')
sub('''            sub_rgb, sub_Y, sub_paint, sub_bars = rgb[y0:y1, x0:x1], Y[y0:y1, x0:x1], paint[y0:y1, x0:x1], bars[y0:y1, x0:x1]
''', '''            sub_rgb, sub_Y, sub_paint, sub_bars = rgb[y0:y1, x0:x1], Y[y0:y1, x0:x1], paint[y0:y1, x0:x1], fmask[y0:y1, x0:x1]
''')
sub('''                ring = ndi.binary_dilation(hull, iterations=12) & ~ndi.binary_dilation(hull, iterations=3)
                pr = float(sub_paint[ring].mean()) if ring.any() else 0.0
                if pr < 0.45:
                    why = "not in a painted wall"
''', '''                ring = ndi.binary_dilation(hull, iterations=12) & ~ndi.binary_dilation(hull, iterations=3)
                rq_ = ring & ~bars[y0:y1, x0:x1]             # (a neighbour's frame in the ring is no wall, and no lack of one)
                pr = float(sub_paint[rq_].mean()) if rq_.sum() > 20 else 0.0
                if pr < 0.45:
                    why = "not in a painted wall"
                elif woody and float(bluegl[y0:y1, x0:x1][enclosed].mean() if enclosed.any() else 0.0) < 0.60:
                    why = "an orange frame round no blue glass"
''')
sub('''            if why is None and level(ring, y0, x0):
                why = "on a deck or a deckhead"
            if why is None and any(x0 <= dx < x1 and y0 <= dy < y1 and hull[int(dy) - y0, int(dx) - x0] for dx, dy in drops):
                why = "dropped"
            dbg([x0, y0, x1, y1], "bars",''', '''            if why is None and level(ring, y0, x0):
                why = "on a deck or a deckhead"
            if why is None and any(x0 <= dx < x1 and y0 <= dy < y1 and hull[int(dy) - y0, int(dx) - x0] for dx, dy in drops):
                why = "dropped"
            dbg([x0, y0, x1, y1], "bars2" if woody else "bars",''')
sub('''            bc.append(dict(m=full, box=hb, c=((hb[0] + hb[2]) / 2.0, (hb[1] + hb[3]) / 2.0), h=float(hh_), cls=cls, note=note, anchor=anchor))
''', '''            bc.append(dict(m=full, box=hb, c=((hb[0] + hb[2]) / 2.0, (hb[1] + hb[3]) / 2.0), h=float(hh_), cls=cls, note=note, anchor=anchor))
            seen[y0:y1, x0:x1] |= hull
''')
# 3. navy: the wall by the ring's lighter quarter; bigger in a zone; under a deckhead at the eye's level even in a zone
sub('''            elif h_ * w_ > (0.10 if inz else 0.03) * H * W:''', '''            elif h_ * w_ > (0.20 if inz else 0.03) * H * W:''')
sub('''                if pr < (0.45 if inz else 0.62) or float(Y[y0:y1, x0:x1][ring].mean()) < float(Y[y0:y1, x0:x1][m].mean()) + 0.06:
                    why_ = "navy not in a wall"''', '''                if pr < (0.45 if inz else 0.62) or float(np.percentile(Y[y0:y1, x0:x1][ring], 75)) < float(Y[y0:y1, x0:x1][m].mean()) + 0.06:
                    why_ = "navy not in a wall"                # (the ring's lighter quarter: a thick dark frame is in the ring too)''')
sub('''            if cd["inz"]:
                zm_ = max([zmax[zi] for zi, zr in enumerate(zone_rects) if zr[0] <= cx_ < zr[2] and zr[1] <= cy_ < zr[3]] or [0.0])
                if cd["a"] < max(40.0, 0.015 * zm_) and not rowev[len(bc) + k_]:
                    no("navy scrap in a zone")
                    continue
                ev = "zone"''', '''            if cd["inz"]:
                zm_ = max([zmax[zi] for zi, zr in enumerate(zone_rects) if zr[0] <= cx_ < zr[2] and zr[1] <= cy_ < zr[3]] or [0.0])
                if cd["a"] < max(40.0, 0.015 * zm_) and not rowev[len(bc) + k_]:
                    no("navy scrap in a zone")
                    continue
                if covered and strad is False and cd["by"] is None and not near_strad(cd):
                    no("navy off the eye's level under a deckhead")      # (a zone drawn wide takes in the deckhead's ironwork)
                    continue
                ev = "zone"''')
sub('''        zmax = {}
        for zi, zr in enumerate(zone_rects):''', '''        def near_strad(cd):
            """A pane above or below the eye's level that belongs to a window which does stand at it: another navy group
            right beside it (bars between) straddles the horizon."""
            for q in nc:
                if q is cd or straddles(q["box"], q["c"][0]) is not True:
                    continue
                if (cd["box"][0] < q["box"][2] + 18 and cd["box"][2] > q["box"][0] - 18 and cd["box"][1] < q["box"][3] + 18
                        and cd["box"][3] > q["box"][1] - 18):
                    return True
            return False
        zmax = {}
        for zi, zr in enumerate(zone_rects):''')
# 4. panes of one window (accepted navy groups with bars between them) become one window
sub('''            add(cd["m"], "navy", "navy", "blob %dx%d %s" % (cd["w"], cd["h"], ev), cd["box"])
        # the annotation's own "lit" boxes''', '''            mate = None                                      # a pane of a window taken already: bars between the two
            for kk, q in navy_taken:
                if (cd["box"][0] < q["box"][2] + 18 and cd["box"][2] > q["box"][0] - 18 and cd["box"][1] < q["box"][3] + 18
                        and cd["box"][3] > q["box"][1] - 18):
                    gx0_, gy0_ = max(min(cd["box"][0], q["box"][0]), min(cd["box"][2], q["box"][2]) - 18), max(min(cd["box"][1], q["box"][1]), min(cd["box"][3], q["box"][3]) - 18)
                    gx1_, gy1_ = min(max(cd["box"][2], q["box"][2]), max(cd["box"][0], q["box"][0]) + 18), min(max(cd["box"][3], q["box"][3]), max(cd["box"][1], q["box"][1]) + 18)
                    gap = bars[max(0, gy0_):gy1_, max(0, gx0_):gx1_]
                    if gap.size and float(gap.mean()) >= 0.20:
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
        # the annotation's own "lit" boxes''')
sub('''        for k_, cd in enumerate(nc):
            cx_, cy_ = int(cd["c"][0]), int(cd["c"][1])
            strad = straddles(cd["box"], cd["c"][0])
            ev = None''', '''        navy_taken = []
        for k_, cd in sorted(enumerate(nc), key=lambda t: -t[1]["a"]):     # (the big panes first: the small join them)
            cx_, cy_ = int(cd["c"][0]), int(cd["c"][1])
            strad = straddles(cd["box"], cd["c"][0])
            ev = None''')
# 2. the bar pass becomes a function of the frame mask, run twice (red bars; then frames the sun turns orange)
i0 = s.index("        cl = ndi.binary_closing(bars, structure=K3, iterations=1)\n")
i1 = s.index("        # ---- 3. navy groups\n")
blk = s[i0:i1]
blk = blk.replace("cl = ndi.binary_closing(bars, structure=K3, iterations=1)", "cl = ndi.binary_closing(fmask, structure=K3, iterations=1)")
a_ = '''            if bh < 12 or bw < 8 or bh * bw > 0.20 * H * W:
                continue
'''
assert blk.count(a_) == 1
blk = blk.replace(a_, a_ + '''            if woody and (not (wood0[sl] & (lab[sl] == i)).any() or seen[sl][lab[sl] == i].mean() > 0.5):
                continue                                    # (pass 2: only frames with orange wood in them, not found already)
''')
blk = "".join(("    " + ln if ln.strip() else ln) for ln in blk.splitlines(True))
head = '''        bluegl = ((b - r) > 0.03) & (sat > 0.20)             # glass that is blue: navy, teal, the sky mirrored
        frames2 = (bars | (wood0 & ~ndi.binary_opening(wood0, structure=np.ones((15, 15), bool)))) & ~outside   # thin orange wood too
        seen = np.zeros((H, W), bool)

        def bar_pass(fmask, woody):
'''
tail = '''        bar_pass(bars, False)
        bar_pass(frames2, True)                             # frames the sun turns orange (they pass as wood)
'''
s = s[:i0] + head + blk + tail + s[i1:]
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("win6 patched (round 3)")
