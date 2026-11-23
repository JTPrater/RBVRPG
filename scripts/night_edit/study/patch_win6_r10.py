"""win6.py round 10 (2026-11-23): a frameless navy window that stands on its own evidence (framed / alone / oval) is an
ANCHOR for rows too (the B deck's forward end has no red-barred window to measure by); "add" modes "blue" (bluish glass of
any brightness: sky-mirroring panes and navy) and "raw" (everything in the shape), and no "add" in a colour mode takes the
outside (sky and sea are blue too)."""
import ast
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()


def sub(a, b, n=1):
    global s
    assert s.count(a) == n, (s.count(a), a[:90])
    s = s.replace(a, b)


sub('''        # ---- evidence: rows with an anchor
        has_anchor = hz is not None and any(q["anchor"] for q in bc)
        items = bc + nc + fc
        rowev = [False] * len(items)
        if hz is not None and any(q["anchor"] for q in bc):
''', '''        # ---- evidence: rows with an anchor
        for cd in nc:                                       # a navy group that stands on its own evidence
            st_ = straddles(cd["box"], cd["c"][0])
            cd["solo"] = None
            if cd["framed"]:
                cd["solo"] = "framed"
            elif (not cd["thin"] and cd["a"] >= 260 and cd["a"] >= 0.78 * cd["h"] * cd["w"] and cd["pr"] >= 0.85
                  and 0.6 <= cd["h"] / cd["w"] <= 3.2 and cd["up"]):
                cd["solo"] = "alone"
            elif covered and st_ and cd["oval"] and cd["a"] >= 200 and cd["pr"] >= 0.85 and 1.0 <= cd["h"] / cd["w"] <= 4.0:
                cd["solo"] = "alone, oval"
            if (covered and st_ is False) or (restricted and not cd["inz"]) or (cd["thin"] and st_ is False):
                cd["solo"] = None
        has_anchor = hz is not None and (any(q["anchor"] for q in bc) or any(q["solo"] for q in nc))
        items = bc + nc + fc
        rowev = [False] * len(items)
        if has_anchor:
''')
sub('''                    anc = np.array([bool(items[k_].get("anchor")) for _, k_ in inl])''',
    '''                    anc = np.array([bool(items[k_].get("anchor") or items[k_].get("solo")) for _, k_ in inl])''')
sub('''            elif cd["framed"]:
                ev = "framed"
            elif rowev[len(bc) + k_]:
                ev = "row"
            elif (not cd["thin"] and cd["a"] >= 260 and cd["a"] >= 0.78 * cd["h"] * cd["w"] and cd["pr"] >= 0.85
                  and 0.6 <= cd["h"] / cd["w"] <= 3.2 and cd["up"]):
                ev = "alone"
            elif covered and strad and cd["oval"] and cd["a"] >= 200 and cd["pr"] >= 0.85 and 1.0 <= cd["h"] / cd["w"] <= 4.0:
                ev = "alone, oval"
''', '''            elif cd["solo"]:
                ev = cd["solo"]
            elif rowev[len(bc) + k_]:
                ev = "row"
''')
sub('''            only_navy, replace = bool(bx.get("navy")), bool(bx.get("replace"))
''', '''            only_navy, replace = bool(bx.get("navy")), bool(bx.get("replace"))
            only_blue, raw = bool(bx.get("blue")), bool(bx.get("raw"))
''')
sub('''            only_navy, replace = "navyonly" in bx[4:], "replace" in bx[4:]
''', '''            only_navy, replace = "navyonly" in bx[4:], "replace" in bx[4:]
            only_blue, raw = "blue" in bx[4:], "raw" in bx[4:]
''')
sub('''        sub = np.zeros((H, W), bool)
        only_navy = replace = False
''', '''        sub = np.zeros((H, W), bool)
        only_navy = replace = only_blue = raw = False
''')
sub('''        gl = sub & ~bars & (inst == 0)
        if only_navy:
            gl &= ndi.binary_closing(navy, structure=K3)
        elif not fall:
            gl &= ~(paint & (Y > 0.80 * wallY))
        gl = ndi.binary_opening(gl, structure=K3)
''', '''        if raw:
            gl = sub & (inst == 0)
        else:
            gl = sub & ~bars & (inst == 0)
            if only_navy:
                gl &= ndi.binary_closing(navy, structure=K3) & ~outside
            elif only_blue:                                  # bluish glass of any brightness: sky-mirroring panes, navy
                bl_ = (((b - r) > 0.10) & (sat > 0.30) & (g > r)) | navy
                gl &= ndi.binary_closing(bl_, structure=K3) & ~outside
            elif not fall:
                gl &= ~(paint & (Y > 0.80 * wallY))
            gl = ndi.binary_opening(gl, structure=K3)
''')
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("win6 patched (round 10)")
