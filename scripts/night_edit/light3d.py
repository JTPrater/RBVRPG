"""The ship's own lights in 3D for night4.py: the picture's depth (Depth Anything V2's relative inverse depth, calibrated on
the deck plane), its surfaces' normals, and light from lamps and lit windows that falls off with distance, follows the
surfaces' slope and is shadowed by what stands between (screen-space ray marching through the depth). Camera: pinhole,
x right, y down, z forward, focal FOCAL px, centre at the picture's middle, pitched so the horizon row is where the
picture shows it; the eye EYE m over the deck it stands on."""
import cv2
import numpy as np


def gblur(x, s):
    return cv2.GaussianBlur(x, (0, 0), s, borderType=cv2.BORDER_REFLECT)


def boxf(x, r):
    return cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1), normalize=True, borderType=cv2.BORDER_REFLECT)


def guided(I, p, r, eps):
    """He et al. guided filter: colour guide I (HxWx3), input p (HxW or HxWxC, each channel filtered)."""
    if p.ndim == 3:
        return np.stack([guided(I, p[..., k], r, eps) for k in range(p.shape[2])], -1)
    mI, mp = boxf(I, r), boxf(p, r)
    cov = boxf(I * p[..., None], r) - mI * mp[..., None]
    V = np.empty(I.shape[:2] + (3, 3), np.float32)
    for i in range(3):
        for j in range(i, 3):
            V[..., i, j] = V[..., j, i] = boxf(I[..., i] * I[..., j], r) - mI[..., i] * mI[..., j]
    V += eps * np.eye(3, dtype=np.float32)
    a = np.linalg.solve(V, cov[..., None])[..., 0]
    b = mp - (a * mI).sum(-1)
    return (boxf(a, r) * I).sum(-1) + boxf(b, r)


class Scene:
    def __init__(self, disp, horizon_y, focal, eye, floor, scale=0.5, rng=None):
        """disp: HxW relative inverse depth; horizon_y: the horizon row at the picture's middle; floor: HxW bool, deck
        pixels to calibrate on. The lighting is worked at `scale` of the picture's size."""
        H, W = disp.shape
        self.H, self.W, self.f, self.eye = H, W, focal, eye
        self.cx, self.cy = W / 2.0, H / 2.0
        self.theta = np.arctan((horizon_y - self.cy) / focal)          # pitch: looking up is positive
        st, ct = np.sin(self.theta), np.cos(self.theta)
        self.up = np.array([0.0, -ct, st], np.float32)                 # world up in camera axes
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        rdot = -ct * (yy - self.cy) / focal + st                        # (ray with z = 1) . up
        inv_true = -rdot / eye                                          # 1 / Z of a point on the deck plane
        m = floor & (inv_true > 1e-3)
        rng = rng or np.random.default_rng(7)
        idx = np.flatnonzero(m.ravel())
        self.ok = len(idx) > 400
        if self.ok:
            pick = rng.choice(idx, min(len(idx), 30000), replace=False)
            xd, yt = disp.ravel()[pick].astype(np.float64), inv_true.ravel()[pick].astype(np.float64)
            best, bestn = None, -1
            for _ in range(300):                                        # disp = a * invZ + b, robustly
                i, j = rng.choice(len(pick), 2, replace=False)
                if abs(yt[i] - yt[j]) < 0.02:
                    continue
                a = (xd[j] - xd[i]) / (yt[j] - yt[i])
                if a <= 0:
                    continue
                b_ = xd[i] - a * yt[i]
                res = np.abs(xd - (a * yt + b_))
                n_in = int((res < 0.06 * (xd.max() - xd.min() + 1e-6)).sum())
                if n_in > bestn:
                    best, bestn = (a, b_), n_in
            a, b_ = best
            inl = np.abs(xd - (a * yt + b_)) < 0.06 * (xd.max() - xd.min() + 1e-6)
            A = np.c_[yt[inl], np.ones(inl.sum())]
            a, b_ = np.linalg.lstsq(A, xd[inl], rcond=None)[0]
            self.fit = (float(a), float(b_), int(inl.sum()), len(pick))
            inv = (disp - b_) / max(a, 1e-6)
        else:                                                           # no deck seen: a rough guess, near = 2 m, far = 200 m
            d0, d1 = np.percentile(disp, [2, 98])
            inv = 0.005 + (disp - d0) / max(d1 - d0, 1e-6) * 0.5
            self.fit = None
        self.Z = 1.0 / np.clip(inv, 1.0 / 300.0, 4.0)                   # m along the camera axis, 0.25 .. 300
        # working resolution
        self.s = scale
        self.h, self.w = int(round(H * scale)), int(round(W * scale))
        self.Zs = cv2.resize(self.Z, (self.w, self.h), interpolation=cv2.INTER_AREA)
        ys, xs = np.mgrid[0:self.h, 0:self.w].astype(np.float32)
        self.fs, self.cxs, self.cys = focal * scale, self.w / 2.0, self.h / 2.0
        self.P = np.stack([(xs - self.cxs) / self.fs * self.Zs, (ys - self.cys) / self.fs * self.Zs, self.Zs], -1)

    def normals(self, guide_small):
        P = self.P
        dx = (np.roll(P, -2, 1) - np.roll(P, 2, 1))
        dy = (np.roll(P, -2, 0) - np.roll(P, 2, 0))
        n = np.cross(dx, dy)
        n = guided(guide_small, n.astype(np.float32), 3, 1e-3)
        n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
        flip = (n * P).sum(-1) > 0                                      # face the camera
        n[flip] *= -1
        self.N = n.astype(np.float32)
        return self.N

    def point(self, x, y, r=4, mask=None):
        """The 3D point (camera axes) at picture pixel (x, y): the median depth in a small window round it; with a mask
        (the solid, not-sky pixels), the nearer fifth of the masked depths within a wider window (a lamp seen against the
        sky takes its own depth, not the sky's)."""
        xi, yi = int(round(x)), int(round(y))
        if mask is not None:
            rr = max(r, 12)
            win = self.Z[max(0, yi - rr):yi + rr + 1, max(0, xi - rr):xi + rr + 1]
            mw = mask[max(0, yi - rr):yi + rr + 1, max(0, xi - rr):xi + rr + 1]
            if mw.sum() >= 4:
                z = float(np.percentile(win[mw], 20))
                return np.array([(x - self.cx) / self.f * z, (y - self.cy) / self.f * z, z], np.float32), z
        z = float(np.median(self.Z[max(0, yi - r):yi + r + 1, max(0, xi - r):xi + r + 1]))
        return np.array([(x - self.cx) / self.f * z, (y - self.cy) / self.f * z, z], np.float32), z

    def normal_at(self, x, y, r=6):
        xs, ys = int(round(x * self.s)), int(round(y * self.s))
        n = self.N[max(0, ys - r):ys + r + 1, max(0, xs - r):xs + r + 1].reshape(-1, 3).mean(0)
        return n / max(float(np.linalg.norm(n)), 1e-6)

    def irradiance(self, Q, power, lobe=None, k=22, soft=0.0, rng=None, samples=1, r0=0.2, shadows=True):
        """Light falling on every working pixel from a point light at Q (camera axes, m): power cos / (d^2 + r0^2), times
        the emitter's lobe (a function of the unit direction from Q to the surface), times visibility (the depth buffer
        marched from the surface towards Q). r0: the emitter's size (an area light's is bigger: no hot spot near it)."""
        rng = rng or np.random.default_rng(3)
        P, N, Zs = self.P, self.N, self.Zs
        tot = np.zeros(Zs.shape, np.float32)
        for si in range(samples):
            q = Q + (rng.normal(0, soft, 3).astype(np.float32) if soft > 0 else 0)
            Lv = q[None, None, :] - P
            d = np.linalg.norm(Lv, axis=-1)
            Ld = Lv / np.maximum(d[..., None], 1e-6)
            cos = np.clip((N * Ld).sum(-1), 0, 1)
            e = power * cos / (d * d + r0 * r0)
            if lobe is not None:
                e = e * lobe(-Ld)
            vis = np.ones_like(e)
            # (shadows=False: an area light's shadows are soft past seeing; the depth march near it only adds speckle,
            # the user's "night sky splashed on the deckhead" was a window's light so cut up)
            live = (e > 1e-5) & shadows
            if live.any():
                Pl, Ll, dl = P[live], Lv[live], d[live]
                occ = np.zeros(len(Pl), bool)
                for t in (np.linspace(0, 1, k + 2)[1:-1] ** 1.6):
                    S = Pl + Ll * (0.03 + 0.94 * t)
                    z = S[:, 2]
                    good = z > 0.1
                    u = np.where(good, S[:, 0] / np.maximum(z, 0.1) * self.fs + self.cxs, -1)
                    v = np.where(good, S[:, 1] / np.maximum(z, 0.1) * self.fs + self.cys, -1)
                    inside = good & (u >= 0) & (u < self.w - 1) & (v >= 0) & (v < self.h - 1)
                    zb = np.full(len(Pl), np.inf, np.float32)
                    zb[inside] = Zs[v[inside].astype(int), u[inside].astype(int)]
                    gap = z - zb
                    tol = 0.05 + 0.012 * z
                    thick = 0.8 + 0.03 * z
                    occ |= inside & (gap > tol) & (gap < thick)
                vis[live] = np.where(occ, 0.0, 1.0)
                # 2026-11-22 (the user: "no weird artifacts"): a shadow marched through a monocular depth map is speckled
                # (the map's own noise shades itself) and jagged; at full size it showed as stipple on every deckhead. Lone
                # specks are taken out (a median), holes closed, and the edge is a soft penumbra.
                v8 = cv2.medianBlur((vis * 255).astype(np.uint8), 5)
                v8 = cv2.morphologyEx(v8, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
                vis = cv2.GaussianBlur(v8.astype(np.float32) / 255.0, (0, 0), 2.5)
            tot += e * vis
        return tot / samples

    def up_res(self, E, guide_full):
        """A working-resolution light map back to the picture's size, its edges following the picture's."""
        big = cv2.resize(E, (self.W, self.H), interpolation=cv2.INTER_LINEAR)
        return np.maximum(guided(guide_full, big.astype(np.float32), 4, 2e-3), 0)
