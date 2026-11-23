"""Round 17 (2026-11-23). win6.py: a red-barred window in a painted wall whose glass the matte took for the outside MIRRORS the
sky (the boat deck's and the second class house's sunlit windows): it is a window of the ship and is lit; only on the bridge
(and where the annotation restricts) does such a window look out and stay dark. The night pictures in the game show the stars
through these panes. Also "clear": boxes wiped of whatever was found, before the "add" entries.
Then the corrections file is brought up to date (work/win5_fix.json)."""
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


sub('''                if float((outside[y0:y1, x0:x1] & gl).sum()) / float(gl.sum()) > 0.40:
                    no("through")
                    continue
''', '''                if float((outside[y0:y1, x0:x1] & gl).sum()) / float(gl.sum()) > 0.40:
                    if restricted:
                        no("through")
                        continue
                    note += " (mirrors the sky)"
''')
sub('''    # ---- my own boxes: whatever in the box is neither wall paint nor bar
''', '''    for bx in fx.get("clear", []):                          # boxes wiped of whatever was found
        inst[int(bx[1]):int(bx[3]), int(bx[0]):int(bx[2])] = 0
    # ---- my own boxes: whatever in the box is neither wall paint nor bar
''')
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("win6 patched (round 17)")

p = os.path.join(HERE, "work", "win5_fix.json")
j = json.load(open(p, encoding="utf-8"))
j["1st A starb prom10"] = {"drop_at": [[1911, 372]]}
j["1st B port enclosed prom2"] = {"clear": [[1780, 0, 1920, 780]],
                                  "add": [{"box": [1800, 0, 1892, 740], "navy": True, "hull": True, "cls": "navy"}]}
j["2nd class b starb prom4"]["add"] = [q for q in j["2nd class b starb prom4"].get("add", []) if q[:4] != [1343, 443, 1448, 517]] + \
    [[1343, 443, 1448, 517, "blue", "keepout"]]
j["2nd class b prom4"] = {"add": [[551, 514, 560, 557, "navyonly"], [562, 511, 572, 558, "navyonly"], [575, 508, 587, 560, "navyonly"]]}
j["2nd class b prom5"] = {"drop_at": [[1340, 260]], "add": [[1303, 500, 1317, 572]]}
j["2nd class b prom6"] = {"add": [[0, 190, 70, 720, "blue", "replace"]]}
j["BD first port prom6"]["add"][0] = [545, 535, 765, 600, "blue", "keepout"]
j["poop3"] = {"add": [{"poly": [[575, 397], [589, 389], [592, 527], [578, 523]], "replace": True},
                      {"poly": [[606, 381], [633, 360], [636, 541], [609, 532]], "replace": True}]}
j["poop8"] = {"add": [{"poly": [[1795, 334], [1815, 344], [1816, 362], [1832, 363], [1825, 545], [1785, 556]]}]}
if "clear:" not in j["_about"]:
    j["_about"] += " More options: hull, navy (dict form of navyonly); clear: boxes wiped of whatever was found, before the adds."
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(json.dumps(j, indent=1, ensure_ascii=False))
os.replace(p + ".tmp", p)
print(len(j) - 1, "pictures with corrections")
