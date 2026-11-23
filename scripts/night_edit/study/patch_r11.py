"""Round 11 (2026-11-23).
win6.py   "add": the class may stand anywhere after the box; the default mode leaves out only the bright paint that is joined
          to the wall round the shape (a white-framed window's tracery), not every pale thing in the room behind (that made
          speckle of a trellis); "keepout": a colour mode may take what the matte calls outside (a pane that mirrors the sky).
night4.py a window found by win6 is the ship's, whatever the matte took it for; each window's level and warmth come from a
          smooth field over the picture (panes of one window found as two can no longer differ; neighbours differ a little,
          far ones more).
win5_review.py  the matte's outside tinted magenta; the annotation's doorway interiors outlined orange."""
import ast
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def patch(name, pairs):
    p = os.path.join(HERE, name)
    s = open(p, encoding="utf-8").read()
    for a, b in pairs:
        assert s.count(a) == 1, (name, s.count(a), a[:90])
        s = s.replace(a, b)
    ast.parse(s)
    open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
    os.replace(p + ".tmp", p)


patch("win6.py", [
    ('''            fcls = bx[4] if len(bx) > 4 and bx[4] in ("navy", "see", "pale") else None
''', '''            fcls = ([v for v in bx[4:] if v in ("navy", "see", "pale")] or [None])[0]
'''),
    ('''            only_blue, raw = "blue" in bx[4:], "raw" in bx[4:]
''', '''            only_blue, raw = "blue" in bx[4:], "raw" in bx[4:]
            keepout = "keepout" in bx[4:]
'''),
    ('''            only_blue, raw = bool(bx.get("blue")), bool(bx.get("raw"))
''', '''            only_blue, raw = bool(bx.get("blue")), bool(bx.get("raw"))
            keepout = bool(bx.get("keepout"))
'''),
    ('''        only_navy = replace = only_blue = raw = False
''', '''        only_navy = replace = only_blue = raw = keepout = False
'''),
    ('''            if only_navy:
                gl &= ndi.binary_closing(navy, structure=K3) & ~outside
            elif only_blue:                                  # bluish glass of any brightness: sky-mirroring panes, navy
                bl_ = (((b - r) > 0.10) & (sat > 0.30) & (g > r)) | navy
                gl &= ndi.binary_closing(bl_, structure=K3) & ~outside
            elif not fall:
                gl &= ~(paint & (Y > 0.80 * wallY))
''', '''            out_ = outside if not keepout else np.zeros((H, W), bool)
            if only_navy:
                nv_ = (Y < 0.24) & (Y > 0.02) & ((b - r) > 0.03) & ((b - r) < 0.30) & (g >= r - 0.01) & (b >= g - 0.02)
                gl &= ndi.binary_closing(nv_, structure=K3) & ~out_
            elif only_blue:                                  # bluish glass of any brightness: sky-mirroring panes, navy
                nv_ = (Y < 0.24) & (Y > 0.02) & ((b - r) > 0.03) & ((b - r) < 0.30) & (g >= r - 0.01) & (b >= g - 0.02)
                bl_ = (((b - r) > 0.10) & (sat > 0.30) & (g > r)) | nv_
                gl &= ndi.binary_closing(bl_, structure=K3) & ~out_
            elif not fall:
                # the wall's paint and whatever bright paint is joined to it (the frame, its tracery): not the pale things
                # of the room behind the glass
                band_ = ndi.binary_dilation(sub, iterations=4) & ~sub
                br_ = (((sat < 0.24) & (Y > 0.85 * wallY)) & ndi.binary_dilation(sub, iterations=4)) | band_
                bl2_, bn2_ = ndi.label(br_, structure=K3)
                ids_ = np.unique(bl2_[band_])
                gl &= ~np.isin(bl2_, ids_[ids_ > 0])
'''),
])

patch("night4.py", [
    ('''sea_cov = np.clip(yy + 0.5 - hy, 0, 1)
sky_here = outside & (yy < hy - 1)
solid = alpha < 0.5
''', '''# (2026-11-23) a window found by win6.py is the ship's, whatever the matte took it for (a pane that mirrors the sky is sky-blue)
_w5p = os.path.join(HERE, "work", os.environ.get("W5_DIR", "win6"), os.path.splitext(os.path.basename(SRC))[0] + ".w5.npz")
if os.environ.get("W5", "1") != "0" and os.path.exists(_w5p):
    _wa = np.load(_w5p)["alpha"].astype(np.float32) / 255.0
    if _wa.shape == alpha.shape:
        rep["w5_taken_from_matte_px"] = int(((alpha > 0.5) & (_wa > 0.5)).sum())
        alpha = (alpha * (1 - _wa)).astype(np.float32)
        outside = outside & (_wa < 0.5)
sea_cov = np.clip(yy + 0.5 - hy, 0, 1)
sky_here = outside & (yy < hy - 1)
solid = alpha < 0.5
'''),
    ('''    glow = np.zeros((H, W, 3), np.float32)
    emw = np.zeros((H, W), np.float32)
    for wid, sl in enumerate(ndi.find_objects(W5["i"]), 1):
''', '''    glow = np.zeros((H, W, 3), np.float32)
    emw = np.zeros((H, W), np.float32)
    _r5 = np.random.default_rng(2026)
    _ph = _r5.uniform(0, 2 * np.pi, 6)

    def _fld(cx_, cy_, k_):
        """A smooth field over the picture, -1 .. 1: like windows side by side come out alike, far ones differ."""
        return float(0.6 * np.sin(2 * np.pi * cx_ / 620.0 + _ph[k_]) * np.cos(2 * np.pi * cy_ / 900.0 + _ph[k_ + 1])
                     + 0.4 * np.sin(2 * np.pi * (cx_ + 0.6 * cy_) / 370.0 + _ph[k_ + 2]))
    for wid, sl in enumerate(ndi.find_objects(W5["i"]), 1):
'''),
    ('''        lvl = rng.uniform(0.90, 1.06)
        col = WIN_GLOW * (1 + 0.08 * rng.uniform(-1, 1) * np.array([0.0, 0.5, 1.0], np.float32))
        # (2026-11-22 night) one rendering, not two''', '''        _cx, _cy = 0.5 * (sl[1].start + sl[1].stop), 0.5 * (sl[0].start + sl[0].stop)
        lvl = 0.98 + 0.08 * _fld(_cx, _cy, 0)
        col = WIN_GLOW * (1 + 0.08 * _fld(_cx, _cy, 3) * np.array([0.0, 0.5, 1.0], np.float32))
        # (2026-11-22 night) one rendering, not two'''),
])

patch("win5_review.py", [
    ('''    im = cv2.imread(os.path.join(G, n + ".png"))
    H, W = im.shape[:2]
    p = os.path.join(wd, n + ".w5.npz")
''', '''    im = cv2.imread(os.path.join(G, n + ".png"))
    H, W = im.shape[:2]
    mp_ = os.path.join(HERE, "work", os.environ.get("W6_MATTE", "auto_night"), "dbg", n + ".mask.png")
    if os.path.exists(mp_) and not os.environ.get("NO_MATTE"):      # the matte's outside: tinted magenta
        o_ = cv2.imread(mp_, cv2.IMREAD_UNCHANGED) > 127
        im[o_] = (0.62 * im[o_] + 0.38 * np.array([255, 0, 255])).astype(np.uint8)
    p = os.path.join(wd, n + ".w5.npz")
'''),
    ('''        for L in j.get("lamps", []):
''', '''        for q in j.get("interior") or []:                    # doorway interiors: orange outline
            if len(q) >= 3 and isinstance(q[0], (list, tuple)):
                cv2.polylines(im, [np.array(q, np.int32)], True, (0, 140, 255), 2)
        for L in j.get("lamps", []):
'''),
])
print("round 11 patched: win6.py, night4.py, win5_review.py")
