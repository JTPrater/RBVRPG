"""win6.py round 5: a pane ringed by its own frame passes the wall test; panes beside a taken pane (bars between) join it;
lines and very long slivers are never glass, zone or not; the ports keep their own rule; the orange-frame pass takes
anchors only."""
import ast, os
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()
def sub(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:90])
    s = s.replace(a, b)
# the ring test
sub('''                framed = fr_ >= 0.55 and wl_ >= 0.35 and a_ >= 400
                if not framed and (pr < (0.45 if inz else 0.62) or float(np.percentile(Y[y0:y1, x0:x1][ring], 75)) < float(Y[y0:y1, x0:x1][m].mean()) + 0.06):
                    why_ = "navy not in a wall"                # (the ring's lighter quarter: a thick dark frame is in the ring too)''',
'''                framed = fr_ >= 0.55 and wl_ >= 0.35 and a_ >= 400
                pane = fr_ >= 0.50 and float((paint | bars | ((Y < 0.22) & ~navy & ~outside))[y0:y1, x0:x1][ring].mean()) >= 0.75   # ringed by its frame
                if not framed and not pane and (pr < (0.45 if inz else 0.62) or float(np.percentile(Y[y0:y1, x0:x1][ring], 75)) < float(Y[y0:y1, x0:x1][m].mean()) + 0.06):
                    why_ = "navy not in a wall"                # (the ring's lighter quarter: a thick dark frame is in the ring too)''')
# lines and long slivers, zone or not; ports
sub('''            why_ = None
            by_win = None
            if not inz and (gy0 <= 1 or gx0 <= 1 or gy1 >= H - 1 or gx1 >= W - 1):
                why_ = "navy at the edge"''', '''            why_ = None
            by_win = None
            if a_ < 0.12 * h_ * w_ or h_ > 25 * w_ or w_ > 6 * h_:
                why_ = "navy line"                          # (a shadow's edge along a beam or a pillar; in a zone too)
            elif any(abs(cxm - P["c"][0]) < P["c"][2] + 6 and abs(cym - P["c"][1]) < P["c"][3] + 6 for P in ann.get("ports", []) if P.get("c")):
                why_ = "a port (its own rule)"
            elif not inz and (gy0 <= 1 or gx0 <= 1 or gy1 >= H - 1 or gx1 >= W - 1):
                why_ = "navy at the edge"''')
# pass 2: anchors only
sub('''            anchor = ha >= 900 and ha >= 0.62 * hw_ * hh_ and hw_ <= 2.6 * hh_
''', '''            anchor = ha >= 900 and ha >= 0.62 * hw_ * hh_ and hw_ <= 2.6 * hh_
            if woody and not anchor:
                no("a small orange frame")
                continue
''')
# siblings: panes beside a taken pane join it
sub('''            if ev is None:
                no("navy without evidence")
                continue
            if cd["by"] is not None and cd["by"] in ids:      # the rest of a window whose bars enclose only part of it''',
'''            if ev is None:
                later.append(cd)
                continue
            if cd["by"] is not None and cd["by"] in ids:      # the rest of a window whose bars enclose only part of it''')
sub('''        navy_taken = []
        for k_, cd in sorted(enumerate(nc), key=lambda t: -t[1]["a"]):     # (the big panes first: the small join them)''',
'''        navy_taken = []
        later = []
        for k_, cd in sorted(enumerate(nc), key=lambda t: -t[1]["a"]):     # (the big panes first: the small join them)''')
sub('''            kk = add(cd["m"], "navy", "navy", "blob %dx%d %s" % (cd["w"], cd["h"], ev), cd["box"])
            navy_taken.append((kk, cd))
''', '''            kk = add(cd["m"], "navy", "navy", "blob %dx%d %s" % (cd["w"], cd["h"], ev), cd["box"])
            navy_taken.append((kk, cd))
        # panes with no evidence of their own beside a pane that was taken (bars between the two): the same window
        changed = True
        while changed and later and not restricted:
            changed = False
            for cd in list(later):
                for kk, q in navy_taken:
                    if (cd["box"][0] < q["box"][2] + 18 and cd["box"][2] > q["box"][0] - 18 and cd["box"][1] < q["box"][3] + 18
                            and cd["box"][3] > q["box"][1] - 18):
                        gx0_, gy0_ = max(min(cd["box"][0], q["box"][0]), min(cd["box"][2], q["box"][2]) - 18), max(min(cd["box"][1], q["box"][1]), min(cd["box"][3], q["box"][3]) - 18)
                        gx1_, gy1_ = min(max(cd["box"][2], q["box"][2]), max(cd["box"][0], q["box"][0]) + 18), min(max(cd["box"][3], q["box"][3]), max(cd["box"][1], q["box"][1]) + 18)
                        gap = bars[max(0, gy0_):gy1_, max(0, gx0_):gx1_]
                        if gap.size and float(gap.mean()) >= 0.20 and cd["a"] >= 150:
                            inst[cd["m"] & (inst == 0)] = kk
                            meta[kk - 1]["px"] += int(cd["m"].sum())
                            bx = meta[kk - 1]["box"]
                            meta[kk - 1]["box"] = [min(bx[0], cd["box"][0]), min(bx[1], cd["box"][1]), max(bx[2], cd["box"][2]), max(bx[3], cd["box"][3])]
                            navy_taken.append((kk, cd))
                            later.remove(cd)
                            changed = True
                            break
        for cd in later:
            no("navy without evidence")
''')
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("win6 patched (round 5)")
