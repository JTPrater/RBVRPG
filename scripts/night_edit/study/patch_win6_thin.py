import ast, os
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()
def sub(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:80])
    s = s.replace(a, b)
sub("""            ok_ = np.zeros(bn_ + 1, bool)
            for j_, sl_ in enumerate(ndi.find_objects(bl_), 1):
                h_, w_ = sl_[0].stop - sl_[0].start, sl_[1].stop - sl_[1].start
                a_ = float(sizes_[j_ - 1])
                if a_ < 14 or h_ < 5 or w_ < 2:
                    why_ = "navy speck"
                elif w_ > 1.6 * h_:
                    why_ = "navy flat sliver"
                elif h_ > 4.6 * w_:
                    why_ = "navy thin sliver"
                elif a_ < 0.55 * h_ * w_:
                    why_ = "navy wedge"
                else:
                    ok_[j_] = True
                    continue
""", """            ok_ = np.zeros(bn_ + 1, bool)
            thin_ = False
            for j_, sl_ in enumerate(ndi.find_objects(bl_), 1):
                h_, w_ = sl_[0].stop - sl_[0].start, sl_[1].stop - sl_[1].start
                a_ = float(sizes_[j_ - 1])
                if a_ < 14 or h_ < 5 or w_ < 2:
                    why_ = "navy speck"
                elif w_ > 1.6 * h_:
                    why_ = "navy flat sliver"
                elif h_ > 12 * w_:
                    why_ = "navy thin sliver"
                elif a_ < 0.55 * h_ * w_:
                    why_ = "navy wedge"
                else:
                    ok_[j_] = True
                    thin_ = thin_ or h_ > 4.6 * w_              # (a window seen along its wall: taken only in a zone or a row)
                    continue
""")
sub("""            cands.append(dict(m=full, box=[gx0, gy0, gx1, gy1], c=(cxm, cym), h=float(h_), w=float(w_), a=a_, pr=pr, up=upright))""",
    """            cands.append(dict(m=full, box=[gx0, gy0, gx1, gy1], c=(cxm, cym), h=float(h_), w=float(w_), a=a_, pr=pr, up=upright, thin=thin_))""")
sub("""            if zone_ev[cy_, cx_]:
                ev = "zone"
            elif covered and strad is False:""", """            if cd["thin"] and strad is False:
                rej["navy thin sliver"] = rej.get("navy thin sliver", 0) + 1
                continue
            if zone_ev[cy_, cx_]:
                ev = "zone"
            elif covered and strad is False:""")
sub("""            elif cd["a"] >= 260 and cd["a"] >= 0.78 * cd["h"] * cd["w"] and cd["pr"] >= 0.85 and 0.6 <= cd["h"] / cd["w"] <= 3.2 and cd["up"]:""",
    """            elif not cd["thin"] and cd["a"] >= 260 and cd["a"] >= 0.78 * cd["h"] * cd["w"] and cd["pr"] >= 0.85 and 0.6 <= cd["h"] / cd["w"] <= 3.2 and cd["up"]:""")
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
p = os.path.join(HERE, "win5_review.py")
s = open(p, encoding="utf-8").read()
sub("""    ap = os.path.join(HERE, "ann", n + ".json")
    if os.path.exists(ap):
        j = json.load(open(ap, encoding="utf-8"))
""", """    ap = os.path.join(HERE, "ann", n + ".json")
    if os.path.exists(ap):
        j = json.load(open(ap, encoding="utf-8"))
        for key_ in ("zones", "zones_fine", "lit"):          # the annotation's window zones: thin white; none found in it: red
            for q in j.get(key_) or []:
                if len(q) == 4 and not isinstance(q[0], (list, tuple)):
                    e_ = os.path.exists(p) and not (inst[max(0, int(q[1])):int(q[3]), max(0, int(q[0])):int(q[2])] > 0).any()
                    cv2.rectangle(im, (int(q[0]), int(q[1])), (int(q[2]), int(q[3])), (0, 0, 255) if e_ else (255, 255, 255), 3 if e_ else 1)
""")
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("patched thin + review zones")
