"""win6.py round 4: a navy pane in a dark frame in a wall is a window ('framed'); hull-only pixels of a navy window may be
any navy; the orange-frame pass only on open decks."""
import ast, os
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()
def sub(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:90])
    s = s.replace(a, b)
sub("        bar_pass(frames2, True)                             # frames the sun turns orange (they pass as wood)",
    "        if not covered:\n            bar_pass(frames2, True)                         # frames the sun turns orange (they pass as wood): open decks only")
sub("                gl = enclosed | like_navy(sub_rgb, extra, enclosed if enclosed.sum() >= 30 else gl)",
    "                gl = enclosed | like_navy(sub_rgb, extra, enclosed if enclosed.sum() >= 30 else gl) | (extra & navy[y0:y1, x0:x1])")
sub("            y0, y1, x0, x1 = max(0, sl[0].start - 20), min(H, sl[0].stop + 20), max(0, sl[1].start - 20), min(W, sl[1].stop + 20)\n            m = (grp[y0:y1, x0:x1] == i) & nv[y0:y1, x0:x1]",
    "            y0, y1, x0, x1 = max(0, sl[0].start - 34), min(H, sl[0].stop + 34), max(0, sl[1].start - 34), min(W, sl[1].stop + 34)\n            m = (grp[y0:y1, x0:x1] == i) & nv[y0:y1, x0:x1]")
sub('''                if pr < (0.45 if inz else 0.62) or float(np.percentile(Y[y0:y1, x0:x1][ring], 75)) < float(Y[y0:y1, x0:x1][m].mean()) + 0.06:
                    why_ = "navy not in a wall"                # (the ring's lighter quarter: a thick dark frame is in the ring too)''',
'''                # (a pane in a thick dark FRAME in a wall: the ring is the frame, the wall lies beyond it)
                fr_ = float((((Y < 0.22) & ~navy & ~outside) | bars)[y0:y1, x0:x1][ring].mean())
                wide = ndi.binary_dilation(blob, iterations=30) & ~ndi.binary_dilation(blob, iterations=14)
                wl_ = float(paint[y0:y1, x0:x1][wide].mean()) if wide.sum() > 40 else 0.0
                framed = fr_ >= 0.55 and wl_ >= 0.35 and a_ >= 400
                if not framed and (pr < (0.45 if inz else 0.62) or float(np.percentile(Y[y0:y1, x0:x1][ring], 75)) < float(Y[y0:y1, x0:x1][m].mean()) + 0.06):
                    why_ = "navy not in a wall"                # (the ring's lighter quarter: a thick dark frame is in the ring too)''')
sub('''            pr = 0.0
            if why_ is None:
                blob = ndi.binary_dilation(m, iterations=2)''', '''            pr = 0.0
            framed = False
            if why_ is None:
                blob = ndi.binary_dilation(m, iterations=2)''')
sub('''                           thin=thin_, inz=inz, by=by_win))''', '''                           thin=thin_, inz=inz, by=by_win, framed=framed))''')
sub('''            elif covered and strad is False:
                no("navy off the eye's level under a deckhead")
                continue
            elif rowev[len(bc) + k_]:
                ev = "row"''', '''            elif covered and strad is False and not near_strad(cd):
                no("navy off the eye's level under a deckhead")
                continue
            elif cd["framed"]:
                ev = "framed"
            elif rowev[len(bc) + k_]:
                ev = "row"''')
sub('''            dbg([gx0, gy0, gx1, gy1], "navy group", "a", a_, "inz", inz, "pr", round(pr, 2), "by", by_win, "->", why_)''',
    '''            dbg([gx0, gy0, gx1, gy1], "navy group", "a", a_, "inz", inz, "pr", round(pr, 2), "framed", framed, "by", by_win, "->", why_)''')
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("win6 patched (round 4)")
