"""Round 16 (2026-11-23). win6.py: a thing in front of a window (a deck chair, a rail) is told by its covering the window's
own frame, not by its brightness (a chair in a deckhead's shade is as dark as the glass and was lit as glass: its slats
glowed). Wood inside the outline that is joined to wood outside it WITHOUT passing through the window's bars is in front;
a room's wooden furniture seen through the glass never covers the frame."""
import ast, os
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()
i0 = s.index("                # a thing in front: orange wood that runs out over the window's outline (a chair, a rail)\n")
i1 = s.index("                if gl.sum() < 30:\n                    continue\n")
new = '''                # a thing in front: orange wood that runs out over the window's outline (a chair, a rail), covering its frame
                wdc_ = ndi.binary_closing(wood0[y0:y1, x0:x1] & ~sub_bars, structure=K3) & ~Cb
                wl, wn = ndi.label(wdc_ & ndi.binary_dilation(hull, iterations=14), structure=K3)
                hull2_ = ndi.binary_dilation(hull, iterations=2)
                for j in range(1, wn + 1):
                    wj = wl == j
                    ins, outs = int((wj & hull).sum()), int((wj & ~hull2_).sum())
                    if ins >= 12 and outs >= 30:
                        dbg([x0, y0, x1, y1], "in front: wood", "ins", ins, "outs", outs)
                        gl &= ~ndi.binary_dilation(wj, iterations=2)
'''
s = s[:i0] + new + s[i1:]
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("win6 patched (round 16)")
