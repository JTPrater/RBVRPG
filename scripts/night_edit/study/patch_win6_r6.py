"""win6.py round 6: holes that show wood are no glass (a chair's back); small bars under a deckhead stand at the eye's level,
zone or not; a big frameless navy patch must be real navy (shade on white paint is grey-blue) and not a thin line; a pane
joins a window only if it touches it; the annotation's fine zones keep their old rule for far windows nothing else found."""
import ast, os
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()
def sub(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:90])
    s = s.replace(a, b)
sub('''                if why is None and level(ring, y0, x0):
                    why = "on a deck or a deckhead"
''', '''                if why is None and level(ring, y0, x0):
                    why = "on a deck or a deckhead"
                if why is None:
                    mg_ = np.median(sub_rgb[enclosed if enclosed.sum() >= 30 else gl], axis=0)
                    if mg_[0] > mg_[1] + 0.04 and mg_[1] > mg_[2] + 0.012 and float(lum(mg_)) > 0.08:
                        why = "its holes show wood"            # (a chair's back, a bench: orange in the deck's light)
''')
sub('''            if not q["anchor"] and not inz:
                if covered and strad is False:
                    no("small bars off the eye's level under a deckhead")
                    continue
                if not rowev[k_]:
                    no("small or slanting bars without evidence")
                    continue
''', '''            if not q["anchor"] and covered and strad is False:
                no("small bars off the eye's level under a deckhead")
                continue
            if not q["anchor"] and not inz and not rowev[k_]:
                no("small or slanting bars without evidence")
                continue
''')
sub('''            if a_ < 0.12 * h_ * w_ or h_ > 25 * w_ or w_ > 6 * h_:
                why_ = "navy line"                          # (a shadow's edge along a beam or a pillar; in a zone too)
''', '''            medn = np.median(rgb[y0:y1, x0:x1][m], axis=0)
            satn = float((medn.max() - medn.min()) / max(float(medn.max()), 1e-6))
            if a_ < 0.12 * h_ * w_ or h_ > 25 * w_ or w_ > 6 * h_ or (max(h_, w_) > 100 and a_ < 0.30 * h_ * w_):
                why_ = "navy line"                          # (a shadow's edge along a beam or a pillar; in a zone too)
            elif a_ >= 600 and satn < 0.42:
                why_ = "grey-blue shade, not navy glass"     # (glass reads 11, 24, 41: sat 0.7; a pillar's shaded side 47, 51, 57)
''')
sub('''            for q in nc:
                if q is cd or straddles(q["box"], q["c"][0]) is not True:
                    continue
                if (cd["box"][0] < q["box"][2] + 18 and cd["box"][2] > q["box"][0] - 18 and cd["box"][1] < q["box"][3] + 18
                        and cd["box"][3] > q["box"][1] - 18):
                    return True
            return False''', '''            for q in nc:
                if q is cd or straddles(q["box"], q["c"][0]) is not True:
                    continue
                if (cd["box"][0] < q["box"][2] + 18 and cd["box"][2] > q["box"][0] - 18 and cd["box"][1] < q["box"][3] + 18
                        and cd["box"][3] > q["box"][1] - 18):
                    bx_ = [max(0, min(cd["box"][0], q["box"][0]) - 20), max(0, min(cd["box"][1], q["box"][1]) - 20),
                           max(cd["box"][2], q["box"][2]) + 20, max(cd["box"][3], q["box"][3]) + 20]
                    sl_ = (slice(bx_[1], bx_[3]), slice(bx_[0], bx_[2]))
                    if (ndi.binary_dilation(cd["m"][sl_], iterations=16) & q["m"][sl_]).any():      # they all but touch
                        return True
            return False''')
# the fine zones' own rule, for what nothing else found
sub('''    # ---- my own boxes: whatever in the box is neither wall paint nor bar''', '''    # ---- the annotation's FINE zones (rows of far windows a few px wide, drawn by hand): night4's old rule, for whatever in
    # them nothing above found: compact specks darker than the wall round them
    fine_r = [q for q in (ann.get("zones_fine") or []) if len(q) == 4 and not isinstance(q[0], (list, tuple))]
    if fine_r and not fx.get("only_add"):
        fine = np.zeros((H, W), bool)
        for q in fine_r:
            fine[max(0, int(q[1])):int(q[3]), max(0, int(q[0])):int(q[2])] = True
        medY = cv2.medianBlur(np.clip(Y * 255, 0, 255).astype(np.uint8), 31).astype(np.float32) / 255
        dk = fine & (Y < float(ann.get("fine_dark", 0.80)) * medY) & (Y > 0.035) & ~outside & ~ndi.binary_dilation(inst > 0, iterations=4)
        dk = ndi.binary_closing(ndi.binary_opening(dk, structure=K3), structure=K3)
        dk = ndi.binary_fill_holes(dk) & fine
        fl, fn = ndi.label(dk)
        for i, sl in enumerate(ndi.find_objects(fl), 1):
            sub_ = fl[sl] == i
            sz = int(sub_.sum())
            hh, ww = sub_.shape
            if not (10 <= sz <= int(ann.get("fine_max", 2500)) and min(hh, ww) >= 3 and sz / float(hh * ww) >= 0.50 and max(hh, ww) / max(min(hh, ww), 1) <= 7):
                continue
            cx_ = (sl[1].start + sl[1].stop) / 2.0
            if covered and straddles([sl[1].start, sl[0].start, sl[1].stop, sl[0].stop], cx_) is False:
                no("fine speck off the eye's level")
                continue
            full = np.zeros((H, W), bool)
            full[sl] = sub_
            add(full, "navy", "fine", "fine %dx%d" % (ww, hh), [sl[1].start, sl[0].start, sl[1].stop, sl[0].stop])
    # ---- my own boxes: whatever in the box is neither wall paint nor bar''')
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("win6 patched (round 6)")
