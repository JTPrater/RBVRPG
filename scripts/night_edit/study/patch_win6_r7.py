"""win6.py round 7: "at the eye's level" is a band (within 1.5 of its own heights of the horizon: the B deck's oval lights sit
a little above it, and the horizon's row is good to a few px only); a scrap in a zone is judged by its own size; a mid-sized
frameless patch must be bluish too; empty zones under a deckhead take the fine zones' rule."""
import ast, os
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()
def sub(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:90])
    s = s.replace(a, b)
sub('''        return bool(box[1] < hrow_at(cx) - 1 and box[3] > hrow_at(cx) + 1)''',
    '''        return bool(abs((box[1] + box[3]) / 2.0 - hrow_at(cx)) <= 1.5 * (box[3] - box[1]) + 4)      # (near the eye's level)''')
sub('''                if cd["a"] < max(40.0, 0.015 * zm_) and not rowev[len(bc) + k_]:''', '''                if cd["a"] < 40.0 and not rowev[len(bc) + k_]:''')
sub('''            elif a_ >= 600 and satn < 0.42:''', '''            elif (a_ >= 600 and satn < 0.42) or (a_ >= 150 and satn < 0.28):''')
sub('''    fine_r = [q for q in (ann.get("zones_fine") or []) if len(q) == 4 and not isinstance(q[0], (list, tuple))]
''', '''    fine_r = [q for q in (ann.get("zones_fine") or []) if len(q) == 4 and not isinstance(q[0], (list, tuple))]
    if covered:                                             # (and the zones in which nothing was found, under a deckhead)
        fine_r += [q for q in (ann.get("zones") or []) if len(q) == 4 and not isinstance(q[0], (list, tuple))
                   and not (inst[max(0, int(q[1])):int(q[3]), max(0, int(q[0])):int(q[2])] > 0).any()]
''')
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("win6 patched (round 7)")
