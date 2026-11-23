"""Round 19 (2026-11-23). A row of like windows must not be lit / dark / dark: the further windows of a wall seen at a grazing
angle show their glass as strips a few px wide between dark red bars, too fine for any hard mask (the finds were broken
slivers). win6.py "add" option "soft": inside the hand-drawn shape the glass's share of each pixel is read off its colour
(the bars are red, the glass in shade is neutral or bluish and dark; the wall is bright): a true, antialiased matte.
work/win5_fix.json: poop3's two further windows, poop8's edge-on one, the narrow ones of 2nd class b prom4 / prom5."""
import ast
import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:90])
    s = s.replace(a, b)


sub('''        only_navy = replace = only_blue = raw = keepout = hull_o = False
''', '''        only_navy = replace = only_blue = raw = keepout = hull_o = soft = False
''')
sub('''            hull_o = bool(bx.get("hull"))
''', '''            hull_o = bool(bx.get("hull"))
            soft = bool(bx.get("soft"))
''')
sub('''            hull_o = "hull" in bx[4:]
''', '''            hull_o = "hull" in bx[4:]
            soft = "soft" in bx[4:]
''')
sub('''        if raw:
            gl = sub & (inst == 0)
        else:
''', '''        if soft:
            red_ = r - 0.5 * (g + b)
            sa_ = np.clip((0.045 - red_) / 0.035, 0, 1) * np.clip((0.18 - Y) / 0.04, 0, 1)
            sa_ = sa_ * np.clip(cv2.GaussianBlur(sub.astype(np.float32), (0, 0), 0.8) * 2.0 - 1.0, 0, 1)    # (feathered just inside the shape)
            gl = sub & (sa_ > 0.03) & (inst == 0)
            softmap = np.where(gl, sa_, softmap)
        elif raw:
            gl = sub & (inst == 0)
        else:
''')
sub('''    for bx in fx.get("clear", []):                          # boxes wiped of whatever was found
''', '''    softmap = np.zeros((H, W), np.float32)                  # the "soft" adds' own mattes
    for bx in fx.get("clear", []):                          # boxes wiped of whatever was found
''')
sub('''    idx = ndi.distance_transform_edt(inst == 0, return_distances=False, return_indices=True)
''', '''    a = np.where(softmap > 0, softmap, a)
    idx = ndi.distance_transform_edt(inst == 0, return_distances=False, return_indices=True)
''')
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("win6 patched (round 19)")

p = os.path.join(HERE, "work", "win5_fix.json")
j = json.load(open(p, encoding="utf-8"))
j["poop3"] = {"clear": [[560, 340, 650, 560]],
              "add": [{"poly": [[607, 382], [632, 362], [635, 539], [610, 531]], "soft": True, "cls": "pale"},
                      {"poly": [[576, 398], [588, 391], [591, 526], [579, 522]], "soft": True, "cls": "pale"}]}
j["poop8"] = {"add": [{"poly": [[1795, 334], [1815, 344], [1816, 362], [1832, 363], [1825, 545], [1785, 556]], "soft": True, "cls": "pale"}]}
j["2nd class b prom5"] = {"drop_at": [[1340, 260]], "add": [[1304, 501, 1316, 571, "soft", "pale"]]}
j["2nd class b prom4"] = {"add": [[552, 515, 560, 557, "soft", "pale"], [563, 512, 572, 558, "soft", "pale"], [576, 509, 587, 560, "soft", "pale"]]}
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(json.dumps(j, indent=1, ensure_ascii=False))
os.replace(p + ".tmp", p)
print(len(j) - 1, "pictures with corrections")
