"""Round 22 (2026-11-23 02:00), from the scan for sky showing through the ship (study/matte_islands.py) and the far views of
the superstructure's front (forecastle2, forecastle4).
win6.py
 - "add", default mode: a pale pane (a white curtain behind the glass) was thrown out with the wall when its 1 px frame let
   one light pixel through (8-connected). Paint counts as joined to the wall only through a neck 2 px wide or more
   (4-connected, after a 2 x 2 opening); option "tracery" keeps the old rule (a fanlight's thin white muntins).
 - the annotation's "lit" boxes: one that the finds cover less than 45 % is cleared and taken whole (a far window found in
   pieces was lit in pieces); not where a hand correction of work/win5_fix.json stands.
work/win5_fix.json, ann/*.json: the windows and round lights the scan showed (see the list in the code)."""
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


sub('''                thin_ = br0_ & ~broad_                                    # 2. thin paint joined to that: the tracery
                bl3_, bn3_ = ndi.label(thin_ | wall_, structure=K3)
                ids_ = np.unique(bl3_[wall_])
                gl &= ~np.isin(bl3_, ids_[ids_ > 0])
''', '''                thin_ = br0_ & ~broad_                                    # 2. thin paint joined to that: the tracery
                if tracery:
                    bl3_, bn3_ = ndi.label(thin_ | wall_, structure=K3)
                    ids_ = np.unique(bl3_[wall_])
                    gl &= ~np.isin(bl3_, ids_[ids_ > 0])
                else:
                    # joined through a neck 2 px wide or more (a pale curtain behind a 1 px frame is no wall)
                    cand_ = ndi.binary_opening(thin_ | wall_, structure=np.ones((2, 2), bool))
                    bl3_, bn3_ = ndi.label(cand_)
                    ids_ = np.unique(bl3_[wall_ & cand_])
                    jn_ = np.isin(bl3_, ids_[ids_ > 0])
                    gl &= ~((ndi.binary_dilation(jn_, structure=K3) & (thin_ | wall_)) | wall_)
''')
sub('''        only_navy = replace = only_blue = raw = keepout = hull_o = soft = False
''', '''        only_navy = replace = only_blue = raw = keepout = hull_o = soft = tracery = False
''')
sub('''            soft = bool(bx.get("soft"))
''', '''            soft = bool(bx.get("soft"))
            tracery = bool(bx.get("tracery"))
''')
sub('''            soft = "soft" in bx[4:]
''', '''            soft = "soft" in bx[4:]
            tracery = "tracery" in bx[4:]
''')
sub('''                if (inst[by0:by1, bx0:bx1] > 0).mean() < 0.15:
                    fx["add"] = list(fx.get("add", [])) + [[bx0, by0, bx1, by1]]
''', '''                hand = False                                 # (a hand correction stands there: it is the window)
                for hb in fix.get(name, {}).get("add", []):
                    if isinstance(hb, dict):
                        pts = hb.get("poly") or ([[hb["ell"][0] - hb["ell"][2], hb["ell"][1] - hb["ell"][3]], [hb["ell"][0] + hb["ell"][2], hb["ell"][1] + hb["ell"][3]]] if "ell" in hb else
                                                 [[hb["box"][0], hb["box"][1]], [hb["box"][2], hb["box"][3]]])
                        hx0, hy0 = min(v[0] for v in pts), min(v[1] for v in pts)
                        hx1, hy1 = max(v[0] for v in pts), max(v[1] for v in pts)
                    else:
                        hx0, hy0, hx1, hy1 = hb[:4]
                    if hx0 - 3 <= (bx0 + bx1) / 2.0 <= hx1 + 3 and hy0 - 3 <= (by0 + by1) / 2.0 <= hy1 + 3:
                        hand = True
                if hand:
                    continue
                if (inst[by0:by1, bx0:bx1] > 0).mean() < 0.45:
                    fx["add"] = list(fx.get("add", [])) + [[bx0, by0, bx1, by1, "replace"]]
''')
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("win6 patched (round 22)")

# ---- corrections
p = os.path.join(HERE, "work", "win5_fix.json")
j = json.load(open(p, encoding="utf-8"))


def more(name, key, items):
    e = j.setdefault(name, {})
    e[key] = [q for q in e.get(key, []) if q not in items] + items


more("BD first port prom2", "add", [[0, 806, 100, 900, "blue", "keepout"]])                      # the window behind the deck chair
more("BD first starb prom2", "add", [[12, 558, 73, 595, "blue", "keepout", "navy"], [105, 561, 139, 599, "blue", "keepout", "navy"]])
more("1st A starb prom10", "add", [[381, 561, 410, 583, "blue", "keepout", "navy"]])
j["2nd class b starb prom4"]["add"] = [q for q in j["2nd class b starb prom4"].get("add", []) if q[:4] not in ([1385, 545, 1430, 618], [1343, 443, 1448, 517])] + [
    [1343, 443, 1448, 517, "blue", "keepout"], [1385, 525, 1445, 622, "blue", "keepout"],
    [1171, 520, 1185, 626, "blue", "keepout", "replace"], [1208, 548, 1219, 620, "blue", "keepout"]]
more("1st A port prom10", "add", [[1332, 706, 1376, 802, "blue", "keepout"]])
more("BD first starb prom5", "add", [[282, 500, 294, 548, "blue", "keepout", "navy"], [248, 506, 272, 520, "blue", "keepout"]])
more("forecastle4", "add", [[1053, 508, 1071, 536, "replace", "see"], [1112, 505, 1132, 534, "replace", "see"], [1192, 500, 1215, 532, "replace", "see"],
                            [832, 593, 847, 620, "blue", "navy"], [1222, 600, 1239, 622, "blue", "navy"],
                            {"ell": [961.5, 530.2, 6.5, 7.0], "blue": True, "cls": "navy"}])
more("forecastle2", "add", [[500, 477, 520, 503, "replace", "see"], [570, 480, 588, 505, "replace", "see"], [623, 482, 640, 504, "replace", "see"],
                            [685, 485, 702, 508, "replace", "see"]])
for e in j["starb 2nd class prom3"]["add"]:
    if isinstance(e, dict):
        e["tracery"] = True
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(json.dumps(j, indent=1, ensure_ascii=False))
os.replace(p + ".tmp", p)
print(len(j) - 1, "pictures with corrections")

# ---- annotations: the instruments' glass on the bridge is no sky; round lights that were not marked
for n, key, items in (("Bridge2", "not_sky", [[1807, 757, 8, 20, 0]]),
                      ("starb 2nd class prom4", "ports", [{"c": [1512.0, 516.0, 9.5, 26.0, 0.0], "m": "on"}]),
                      ("forecastle2", "ports", [{"c": [717.3, 498.0, 5.0, 6.8, 0.0], "m": "on"}])):
    ap = os.path.join(HERE, "ann", n + ".json")
    a = json.load(open(ap, encoding="utf-8"))
    bk = os.path.join(HERE, "work", "ann_backup_%s_2026-11-23.json" % n)
    if not os.path.exists(bk):
        json.dump(a, open(bk, "w", encoding="utf-8"))
    a[key] = [q for q in (a.get(key) or []) if q not in items] + items
    json.dump(a, open(ap + ".tmp", "w", encoding="utf-8"), indent=1)
    os.replace(ap + ".tmp", ap)
    print("ann", n, key, len(a[key]))
