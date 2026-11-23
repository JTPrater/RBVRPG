import ast, os
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()
def sub(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:80])
    s = s.replace(a, b)
sub('''    def no(why):
        rej[why] = rej.get(why, 0) + 1
''', '''    def no(why):
        rej[why] = rej.get(why, 0) + 1

    DB = [int(v) for v in os.environ["W6_DBG"].split(",")] if os.environ.get("W6_DBG") else None

    def dbg(box, *a):
        """W6_DBG=x0,y0,x1,y1: say what was decided for whatever overlaps that box."""
        if DB and box[0] < DB[2] and box[2] > DB[0] and box[1] < DB[3] and box[3] > DB[1]:
            print("   DBG", box, *a, flush=True)
''')
sub('''            if why:
                no(why)
                continue
            forced = None''', '''            dbg([x0, y0, x1, y1], "bars", "area", area, "hull", ha, "holes", int(holes.sum()), "filled", int(filled.sum()), "glass", int(gl.sum()), "->", why)
            if why:
                no(why)
                continue
            forced = None''')
sub('''            if why_:
                no(why_)
                continue
            # its sides: upright and straight''', '''            dbg([gx0, gy0, gx1, gy1], "navy group", "a", a_, "inz", inz, "pr", round(pr, 2), "by", by_win, "->", why_)
            if why_:
                no(why_)
                continue
            # its sides: upright and straight''')
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("dbg added")
