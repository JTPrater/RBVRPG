"""Round 25 (2026-11-23 03:55), the classes both critics still named and that the set in the game has too:
light3d.py  ripples and wavy ribbons of lamp light on deckheads and pillars: the depth map's noise went straight into the
            surface normals. The depth is smoothed within surfaces before the normals are taken (wider baseline, stronger
            edge-keeping filter), the facing term is softened (a wrapped cosine), and the light map is brought to full size
            with a wider edge-keeping filter.
night4.py   an annotation's "streaks" shapes: inside them the day's thin sun streaks that desun.py's base is too coarse for
            (pale wavy outlines on a wall at night) are brought down to what is round them.
ann         poop3: the big round light at the right edge is in an OPEN door's leaf: 'off' (it was lit as a room: a huge
            flat amber oval); 2nd class b prom2: "streaks" over the right wall and the left rail panel."""
import ast, json, os
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def patch(name, pairs):
    p = os.path.join(HERE, name)
    s = open(p, encoding="utf-8").read()
    for a, b in pairs:
        assert s.count(a) == 1, (name, s.count(a), a[:80])
        s = s.replace(a, b)
    ast.parse(s)
    open(p + ".tmp", "w", encoding="utf-8", newline=chr(10)).write(s)
    os.replace(p + ".tmp", p)
patch("light3d.py", [
    ("""        P = self.P
        dx = (np.roll(P, -2, 1) - np.roll(P, 2, 1))
        dy = (np.roll(P, -2, 0) - np.roll(P, 2, 0))
        n = np.cross(dx, dy)
        n = guided(guide_small, n.astype(np.float32), 3, 1e-3)
""", """        # (2026-11-23) the depth smoothed within surfaces first (inverse depth, the picture as the guide): its noise made
        # ripples and wavy ribbons of light on deckheads and pillars
        inv_s = guided(guide_small, (1.0 / self.Zs).astype(np.float32), 6, 2e-3)
        Zn = 1.0 / np.clip(inv_s, 1.0 / 300.0, 4.0)
        ys, xs = np.mgrid[0:self.h, 0:self.w].astype(np.float32)
        P = np.stack([(xs - self.cxs) / self.fs * Zn, (ys - self.cys) / self.fs * Zn, Zn], -1)
        dx = (np.roll(P, -3, 1) - np.roll(P, 3, 1))
        dy = (np.roll(P, -3, 0) - np.roll(P, 3, 0))
        n = np.cross(dx, dy)
        n = guided(guide_small, n.astype(np.float32), 8, 3e-3)
"""),
    ("""            cos = np.clip((N * Ld).sum(-1), 0, 1)
""", """            cos = np.clip(((N * Ld).sum(-1) + 0.25) / 1.25, 0, 1)        # (a wrapped cosine: less of the normals' noise)
"""),
    ("""        return np.maximum(guided(guide_full, big.astype(np.float32), 4, 2e-3), 0)
""", """        return np.maximum(guided(guide_full, big.astype(np.float32), 10, 3e-3), 0)
"""),
])
patch("night4.py", [
    ("""rep["lamps"] = len(ANN.get("lamps", []))
""", """if not TWI and ANN.get("streaks"):
    # (2026-11-23) the day's thin sun streaks on a plain wall (desun.py's base is too coarse for them: pale wavy outlines
    # at night): inside the annotation's shapes a feature thinner than 15 px and brighter than what is round it is
    # brought down to it
    sm_ = poly_mask(ANN["streaks"], H, W) & solid & (own[..., 0] < 0.05)
    Ln = (night @ LUM).astype(np.float32)
    ref_ = cv2.GaussianBlur(cv2.morphologyEx(Ln, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))), (0, 0), 3.0)
    k_ = np.where(sm_ & (Ln > 1.05 * ref_), (1.02 * ref_) / np.maximum(Ln, 1e-6), 1.0).astype(np.float32)
    night = night * np.minimum(cv2.GaussianBlur(k_, (0, 0), 0.7), 1.0)[..., None]
    rep["streaks_px"] = int((k_ < 0.98).sum())
rep["lamps"] = len(ANN.get("lamps", []))
"""),
])
for n, fn in (("poop3", lambda a: [q.update(m="off") for q in a["ports"] if abs(q["c"][0] - 1850.0) < 2]),
              ("2nd class b prom2", lambda a: a.update(streaks=[[[960, 250], [1190, 250], [1190, 730], [960, 730]], [[30, 620], [140, 620], [140, 790], [30, 790]]]))):
    ap = os.path.join(HERE, "ann", n + ".json")
    a = json.load(open(ap, encoding="utf-8"))
    bk = os.path.join(HERE, "work", "ann_backup_%s_2026-11-23.json" % n)
    if not os.path.exists(bk):
        json.dump(a, open(bk, "w", encoding="utf-8"))
    fn(a)
    json.dump(a, open(ap + ".tmp", "w", encoding="utf-8"), indent=1)
    os.replace(ap + ".tmp", ap)
print("round 25 patched")
