"""Round windows (portholes, door lights): the glass found in the day picture round an annotated guess, as an ellipse.

2026-11-16 (the user: the round windows "have lights on them even if the door is open to the room its connected to ... it
just looks ai generated ... you need to properly outline everything"): the annotated circles were rough guesses, so a lit
disc sat beside the real glass (a crescent of day glass left over), or on a bare door or wall. Each annotated port is now
snapped to its glass: flood fills from seeds round the guess, each fill's outline fitted with an ellipse, the fill that
is most elliptical, most unlike the paint round it and nearest the guess in place and size wins.

Annotation ("ports" in ann/<name>.json), one entry a window:
  {"c": [x, y, r] or [x, y, rx, ry, angle_deg], "m": "on" | "room" | "off", "snap": true}
  m "on": a lit cabin or room seen through its own porthole; "room": the light of a door to a lit room (dimmer, frosted,
  no glare); "off": dark glass (a door standing open, the glass now looks onto the wall or the deck).
  "snap": false keeps the ellipse as given (checked by eye, or the fill fails).
"""
import cv2
import numpy as np
from scipy import ndimage as ndi


def _ellipse_of(entry):
    c = entry["c"]
    if len(c) == 3:
        return float(c[0]), float(c[1]), float(c[2]), float(c[2]), 0.0
    return float(c[0]), float(c[1]), float(c[2]), float(c[3]), float(c[4])


def snap(im, cx, cy, rx, ry, ang=0.0, search=0.6):
    """im: HxWx3 float 0..1 (the day picture). Returns (cx, cy, rx, ry, angle_deg, score) of the glass, or None."""
    H, W = im.shape[:2]
    rr = max(rx, ry)
    R = int(rr * (1 + search) * 2.0 + 12)
    x0, y0 = max(0, int(cx - R)), max(0, int(cy - R))
    x1, y1 = min(W, int(cx + R + 1)), min(H, int(cy + R + 1))
    roi = cv2.GaussianBlur(np.clip(im[y0:y1, x0:x1] * 255, 0, 255).astype(np.uint8), (0, 0), 0.8)
    h, w = roi.shape[:2]
    roif = roi.astype(np.float32)
    area0 = np.pi * rx * ry
    lim = int(round(rr * search))
    step = max(1, int(round(rr * search / 3)))
    best = None
    seen = []
    for dy in range(-lim, lim + 1, step):
        for dx in range(-lim, lim + 1, step):
            sx, sy = int(round(cx + dx - x0)), int(round(cy + dy - y0))
            if not (0 <= sx < w and 0 <= sy < h):
                continue
            for tol in (5, 8, 12, 16):
                mask = np.zeros((h + 2, w + 2), np.uint8)
                cv2.floodFill(roi.copy(), mask, (sx, sy), (0, 0, 0), (tol,) * 3, (tol,) * 3,
                              4 | cv2.FLOODFILL_MASK_ONLY | (255 << 8))
                reg = mask[1:-1, 1:-1] > 0
                A = int(reg.sum())
                if A < 0.22 * area0 or A > 3.2 * area0:
                    continue
                if reg[0].any() or reg[-1].any() or reg[:, 0].any() or reg[:, -1].any():
                    continue
                reg = ndi.binary_fill_holes(reg)
                key = (int(reg.sum()), int(np.argmax(reg)))
                if key in seen:
                    continue
                seen.append(key)
                cnts, _ = cv2.findContours(reg.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
                c = max(cnts, key=len)
                if len(c) < 10:
                    continue
                (ex, ey), (ea, eb), eang = cv2.fitEllipse(c)
                if min(ea, eb) < 4:
                    continue
                em = np.zeros((h, w), np.uint8)
                cv2.ellipse(em, ((ex, ey), (ea, eb), eang), 1, -1)
                em = em > 0
                iou = float((reg & em).sum()) / max(float((reg | em).sum()), 1.0)
                ring = ndi.binary_dilation(reg, iterations=3) & ~reg
                if ring.sum() < 10:
                    continue
                con = float(np.abs(roif[reg].mean(0) - roif[ring].mean(0)).max()) / 255
                dist = float(np.hypot(ex + x0 - cx, ey + y0 - cy)) / rr
                size = abs(np.log(max(float(reg.sum()), 1.0) / area0))
                score = 2.0 * iou + min(con / 0.06, 1.5) - 0.6 * dist - 0.5 * size
                if iou < 0.82:
                    continue
                if best is None or score > best[-1]:
                    best = (ex + x0, ey + y0, ea / 2, eb / 2, eang, score)
    return best


def refine_edges(im, cx, cy, rx, ry, ang=0.0, band=0.20, iters=400, seed=5):
    """A measured guess made exact: the strong edges round the guessed outline (within `band` of its radius, their
    gradient pointing across the outline), an ellipse fitted to them by RANSAC. For big or low-contrast glass the flood
    fill cannot hold (frosted grey glass in a white door, a sky gradient in the glass). Returns (cx, cy, rx, ry, ang,
    inlier share) or None."""
    H, W = im.shape[:2]
    rr = max(rx, ry)
    R = int(rr * (1 + band) + 6)
    x0, y0 = max(0, int(cx - R)), max(0, int(cy - R))
    x1, y1 = min(W, int(cx + R + 1)), min(H, int(cy + R + 1))
    roi = im[y0:y1, x0:x1].astype(np.float32)
    lum = cv2.GaussianBlur(roi @ np.array([0.299, 0.587, 0.114], np.float32), (0, 0), 1.0)
    chroma = cv2.GaussianBlur(roi[..., 2] - roi[..., 0], (0, 0), 1.0)
    gx = cv2.Sobel(lum, cv2.CV_32F, 1, 0, ksize=3) + 0.6 * cv2.Sobel(chroma, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(lum, cv2.CV_32F, 0, 1, ksize=3) + 0.6 * cv2.Sobel(chroma, cv2.CV_32F, 0, 1, ksize=3)
    gm = np.hypot(gx, gy)
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    t = np.radians(ang)
    X, Y = xx - cx, yy - cy
    u = X * np.cos(t) + Y * np.sin(t)
    v = -X * np.sin(t) + Y * np.cos(t)
    d = np.sqrt((u / rx) ** 2 + (v / ry) ** 2)
    # the outline's normal at each pixel (the gradient of d), and the image gradient's agreement with it
    nu, nv = u / rx ** 2, v / ry ** 2
    nx = nu * np.cos(t) - nv * np.sin(t)
    ny = nu * np.sin(t) + nv * np.cos(t)
    nn = np.maximum(np.hypot(nx, ny), 1e-6)
    cosang = np.abs(gx * nx + gy * ny) / (nn * np.maximum(gm, 1e-6))
    ring = (np.abs(d - 1) < band) & (cosang > 0.75)
    if ring.sum() < 20:
        return None
    thr = np.percentile(gm[ring], 60)
    pts = np.stack([xx[ring & (gm >= thr)], yy[ring & (gm >= thr)]], 1)
    # one point per angle step's strongest: thins the edge to a line (the strongest of the rim's two edges)
    ang_ = np.arctan2(v[ring & (gm >= thr)] / ry, u[ring & (gm >= thr)] / rx)
    gsel = gm[ring & (gm >= thr)]
    nb = max(24, int(2 * np.pi * rr / 1.5))
    bins = ((ang_ + np.pi) / (2 * np.pi) * nb).astype(int) % nb
    keep = []
    for k in range(nb):
        ii = np.nonzero(bins == k)[0]
        if len(ii):
            keep.append(ii[np.argmax(gsel[ii])])
    pts = pts[keep]
    if len(pts) < 12:
        return None
    rng = np.random.default_rng(seed)
    best, bestn = None, -1
    P = pts.astype(np.float32)
    for _ in range(iters):
        sel = rng.choice(len(P), 6, replace=False)
        try:
            (ex, ey), (ea, eb), eg = cv2.fitEllipse(P[sel])
        except cv2.error:
            continue
        if not (0.6 * min(rx, ry) < min(ea, eb) / 2 and max(ea, eb) / 2 < 1.4 * rr):
            continue
        tg = np.radians(eg)
        U = (P[:, 0] - ex) * np.cos(tg) + (P[:, 1] - ey) * np.sin(tg)
        V = -(P[:, 0] - ex) * np.sin(tg) + (P[:, 1] - ey) * np.cos(tg)
        res = np.abs(np.sqrt((U / (ea / 2)) ** 2 + (V / (eb / 2)) ** 2) - 1) * min(ea, eb) / 2
        n = int((res < 1.5).sum())
        if n > bestn:
            best, bestn = (ex, ey, ea, eb, eg, res < 1.5), n
    if best is None or bestn < 10:
        return None
    (ex, ey), (ea, eb), eg = cv2.fitEllipse(P[best[5]])
    return ex, ey, ea / 2, eb / 2, eg, bestn / len(P)


def snap_blue(im, cx, cy, rx, ry, ang=0.0, grow=1.6):
    """Glass that mirrors the sky (blue in a brass or white rim): the blue pixels round the guess, the component nearest
    it with holes filled (a rail or a post in front cuts it), its outline fitted. Returns (cx, cy, rx, ry, ang, share)."""
    H, W = im.shape[:2]
    rr = max(rx, ry)
    R = int(rr * grow + 6)
    x0, y0 = max(0, int(cx - R)), max(0, int(cy - R))
    x1, y1 = min(W, int(cx + R + 1)), min(H, int(cy + R + 1))
    roi = im[y0:y1, x0:x1].astype(np.float32)
    r_, g_, b_ = roi[..., 0], roi[..., 1], roi[..., 2]
    sat = (roi.max(2) - roi.min(2)) / np.maximum(roi.max(2), 1e-6)
    blue = ((b_ - r_) > 0.07) & (sat > 0.18) & ((b_ - g_) > -0.02)
    lab, n = ndi.label(blue)
    if not n:
        return None
    yy, xx = np.mgrid[y0:y1, x0:x1]
    best, bd = None, 1e9
    for i in range(1, n + 1):
        m = lab == i
        if m.sum() < 8:
            continue
        dd = float(np.hypot(xx[m].mean() - cx, yy[m].mean() - cy)) - 0.02 * m.sum() ** 0.5
        if dd < bd:
            best, bd = i, dd
    if best is None:
        return None
    m = lab == best
    # the parts of the same glass on the other side of a post: blue components that touch the first's hull
    hull = cv2.convexHull(np.stack(np.nonzero(m)[::-1], 1).astype(np.int32))
    hm = np.zeros(m.shape, np.uint8)
    cv2.fillPoly(hm, [hull], 1)
    hm = cv2.dilate(hm, np.ones((5, 5), np.uint8))
    for i in range(1, n + 1):
        if i != best and (lab == i).sum() >= 4 and ((lab == i) & (hm > 0)).sum() > 0:
            cand = m | (lab == i)
            h2 = cv2.convexHull(np.stack(np.nonzero(cand)[::-1], 1).astype(np.int32))
            if cv2.contourArea(h2) < 2.2 * np.pi * rx * ry:
                m = cand
    hull = cv2.convexHull(np.stack(np.nonzero(m)[::-1], 1).astype(np.int32))
    if len(hull) < 5:
        return None
    (ex, ey), (ea, eb), eg = cv2.fitEllipse(hull.astype(np.float32))
    return ex + x0, ey + y0, ea / 2, eb / 2, eg, float(m.sum()) / max(np.pi * ea * eb / 4, 1)


def port_masks(im, entries, H, W, seed=0):
    """Per mode, the glass of the annotated ports as soft masks (anti-aliased), with each window's normalised radius
    (0 at the middle, 1 at the rim) and height share (0 top, 1 bottom) for shading the glass, a per-window level
    (each room's light its own), and the shapes used (for the report). Things in front of the glass (a rail, a post, a
    rope) are left out of it: pixels far from the glass's own colour and neutral."""
    out = {m: np.zeros((H, W), np.float32) for m in ("on", "room", "off")}
    rho = np.full((H, W), 2.0, np.float32)
    tyy = np.zeros((H, W), np.float32)
    lvl = np.ones((H, W), np.float32)
    used = []
    rng = np.random.default_rng(seed)
    Y = im @ np.array([0.299, 0.587, 0.114], np.float32)
    sat = (im.max(2) - im.min(2)) / np.maximum(im.max(2), 1e-6)
    for e in entries or []:
        m = e.get("m", "on")
        S = 4
        if "poly" in e:
            P = np.array(e["poly"], np.float32)
            x0, y0 = int(max(0, P[:, 0].min() - 3)), int(max(0, P[:, 1].min() - 3))
            x1, y1 = int(min(W, P[:, 0].max() + 4)), int(min(H, P[:, 1].max() + 4))
            big = np.zeros(((y1 - y0) * S, (x1 - x0) * S), np.uint8)
            cv2.fillPoly(big, [np.round((P - [x0, y0]) * S + (S - 1) / 2).astype(np.int32)], 255)
            aa = cv2.resize(big.astype(np.float32) / 255, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA)
            dist = cv2.distanceTransform((big > 0).astype(np.uint8), cv2.DIST_L2, 5)
            dist = cv2.resize(dist, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA) / S
            d = 1 - dist / max(float(dist.max()), 1e-3)
            ty = np.clip((np.arange(y0, y1, dtype=np.float32)[:, None] - P[:, 1].min()) /
                         max(float(np.ptp(P[:, 1])), 1), 0, 1) * np.ones((1, x1 - x0), np.float32)
            used.append([m, "poly", len(P)])
        else:
            cx, cy, rx, ry, ang = _ellipse_of(e)
            s = None
            if e.get("snap") == "edge":
                s = refine_edges(im, cx, cy, rx, ry, ang)
            elif e.get("snap") == "blue":
                s = snap_blue(im, cx, cy, rx, ry, ang)
            elif e.get("snap", False) is True:
                s = snap(im, cx, cy, rx, ry, ang)
            if s is not None:
                cx, cy, rx, ry, ang = s[:5]
            # the glass stops a little short of the fitted outline (the rim's shadow line)
            rx_, ry_ = max(rx - 0.8, 1.0), max(ry - 0.8, 1.0)
            t = np.radians(ang)
            x0, x1 = int(max(0, cx - max(rx, ry) - 3)), int(min(W, cx + max(rx, ry) + 4))
            y0, y1 = int(max(0, cy - max(rx, ry) - 3)), int(min(H, cy + max(rx, ry) + 4))
            yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
            X, Yc = xx - cx, yy - cy
            u = X * np.cos(t) + Yc * np.sin(t)
            v = -X * np.sin(t) + Yc * np.cos(t)
            d = np.sqrt((u / rx_) ** 2 + (v / ry_) ** 2)
            aa = np.clip((1.0 - d) * min(rx_, ry_) + 0.5, 0, 1)          # anti-aliased, a pixel wide
            top = cy - np.sqrt((rx * np.sin(t)) ** 2 + (ry * np.cos(t)) ** 2)
            ht = 2 * (cy - top)
            ty = np.clip((yy - top) / max(ht, 1), 0, 1)
            used.append([m, round(float(cx), 1), round(float(cy), 1), round(float(rx), 1), round(float(ry), 1),
                         round(float(ang), 1), e.get("snap", False) if s is not None else "as given"])
        # what stands in front of the glass: far from the glass's median colour and neutral (white rails, black rope)
        inside = aa > 0.5
        if inside.sum() >= 12:
            Yw, sw = Y[y0:y1, x0:x1], sat[y0:y1, x0:x1]
            med = float(np.median(Yw[inside]))
            occ = inside & (np.abs(Yw - med) > 0.22) & (sw < 0.22)
            occ = cv2.morphologyEx(occ.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)) > 0
            occ = cv2.dilate(occ.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
            if occ.sum() < 0.45 * inside.sum():
                aa = aa * ~occ
        sl = (slice(y0, y1), slice(x0, x1))
        out[m][sl] = np.maximum(out[m][sl], aa)
        nz = aa > 0
        rho[sl] = np.where(nz, np.minimum(rho[sl], d), rho[sl])
        tyy[sl] = np.where(nz, ty, tyy[sl])
        lvl[sl] = np.where(nz, rng.uniform(0.80, 1.10), lvl[sl])
    return out, rho, tyy, lvl, used
