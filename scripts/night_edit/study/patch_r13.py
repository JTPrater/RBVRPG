"""Round 13 (2026-11-23). win6.py: a navy pane with a thin line of shade hanging on it (a beam's edge) is freed of the line
before it is judged (it was thrown out as "a line": one dark pane in a lit window); an "add ... all" leaves out only THIN bars
(a room's dark red curtain behind the glass is no frame)."""
import ast, os
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()
def sub(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:90])
    s = s.replace(a, b)
sub('''            m = ok_[bl_]
            a_ = float(m.sum())
            if a_ < 24:
                continue
            ys, xs = np.nonzero(m)
''', '''            m = ok_[bl_]
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
''')
sub('''            gl = sub & ~bars & (inst == 0)
            out_ = outside if not keepout else np.zeros((H, W), bool)
''', '''            gl = sub & ~bars & (inst == 0)
            if fall:                                         # only thin bars are frame: a broad dark red thing is the room's
                gl = sub & ~(bars & ~ndi.binary_opening(bars, structure=np.ones((13, 13), bool))) & (inst == 0)
            out_ = outside if not keepout else np.zeros((H, W), bool)
''')
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("win6 patched (round 13)")
