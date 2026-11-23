"""Windows as INSTANCES (2026-11-22; the user: "we arent implementing anything until theres no weird artifacts ... these need
to be perfect. research etc"). night4.py's glass was decided pixel by pixel and pane by pane; a window came out lit in part,
veiled, ragged. Here every window of a day picture is found as one object, its glass told from its frame, and written down
for night4.py to light whole.

  <gpu venv python> -I win5.py <out_dir> <name> [<name> ...]      (names of game pictures; --all: every exterior picture)

Per picture:
 1. proposals   Grounding DINO (IDEA-Research/grounding-dino-base, Apache-2.0) with the text "window . porthole . lamp ." on
                the picture and on four overlapping tiles (small far windows); clusters of dark navy panes (the game's own
                glass colour); boxes of work/win5_fix.json ("add").
 2. the window  SAM 2.1 (facebook/sam2.1-hiera-large) with the box as prompt on a zoomed crop: the mask M of the whole window.
 3. the glass   inside M the frame and glazing bars are the thin structure of the frame's colour (what deviates from the
                masked local median and has the colour that rules M's own border); glass is the rest. Class: 'navy' (the
                game's opaque dark glass), 'see' (a room shows through), 'pale' (curtained or frosted). Navy glass is
                further held to its own colour, so a chair or a rail in front of it is no glass.
 4. alpha       the glass mask matted to the picture's own edges (a guided filter on the picture's luminance).
Writes <out_dir>/<name>.w5.npz (inst: uint16 window ids, alpha: uint8 glass coverage) and <name>.w5.json (each window's
box, class, source, score; the lamp proposals). Corrections (work/win5_fix.json, {name: {...}}; x, y in picture pixels):
  "drop_at": [[x, y], ...]            no window at this point (a proposal that is none)
  "add": [[x0, y0, x1, y1], ...]      a window the proposals missed (box round the whole window)
  "cls_at": [[x, y, "see"], ...]      this window's class
  "sub": [[x, y], ...]                a thing standing in front of a window at this point (SAM point prompt): not glass
  "only_add": true                    take no proposals but "add" (a picture whose proposals are hopeless)
"""
import json
import os
import sys
import time

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from scipy import ndimage as ndi
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor, Sam2Model, Sam2Processor

HERE = os.path.dirname(os.path.abspath(__file__))
G = os.path.normpath(os.path.join(HERE, "..", "..", "public", "images", "animations", "locations", "britannic"))
E = "E:/rbvrpg-night/hf"
DEV = "cuda" if torch.cuda.is_available() else "cpu"
GD_THR = float(os.environ.get("W5_GD", "0.23"))
TEXT = "window . porthole . lamp ."

gproc = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-base", cache_dir=E)
gmodel = AutoModelForZeroShotObjectDetection.from_pretrained("IDEA-Research/grounding-dino-base", cache_dir=E, use_safetensors=True).to(DEV).eval()
sproc = Sam2Processor.from_pretrained("facebook/sam2.1-hiera-large")
smodel = Sam2Model.from_pretrained("facebook/sam2.1-hiera-large").to(DEV).eval()


def gdino(pil, off=(0, 0)):
    """[(x0, y0, x1, y1, score, label)] in the full picture's pixels."""
    inp = gproc(images=pil, text=TEXT, return_tensors="pt").to(DEV)
    with torch.no_grad():
        out = gmodel(**inp)
    try:
        res = gproc.post_process_grounded_object_detection(out, inp.input_ids, threshold=GD_THR, text_threshold=0.20, target_sizes=[pil.size[::-1]])[0]
    except TypeError:
        res = gproc.post_process_grounded_object_detection(out, inp.input_ids, box_threshold=GD_THR, text_threshold=0.20, target_sizes=[pil.size[::-1]])[0]
    labs = res.get("text_labels", res.get("labels"))
    r = []
    for b, s, l in zip(res["boxes"].tolist(), res["scores"].tolist(), labs):
        r.append((b[0] + off[0], b[1] + off[1], b[2] + off[0], b[3] + off[1], float(s), str(l)))
    return r


def sam_masks(crop_pil, boxes=None, points=None):
    """SAM 2.1 on a crop: for each prompt the three masks (bool, crop size) and their predicted IoUs."""
    W, H = crop_pil.size
    inp = sproc(images=crop_pil, return_tensors="pt")
    osz = inp["original_sizes"]
    with torch.no_grad():
        emb = smodel.get_image_embeddings(inp["pixel_values"].to(DEV))
        if boxes is not None:
            pi = sproc(input_boxes=[[list(map(float, b)) for b in boxes]], original_sizes=osz, return_tensors="pt")
            o = smodel(input_boxes=pi["input_boxes"].to(DEV), image_embeddings=emb, multimask_output=True)
        else:
            pi = sproc(input_points=[[[[float(x), float(y)]] for x, y in points]], input_labels=[[[1] for _ in points]], original_sizes=osz, return_tensors="pt")
            o = smodel(input_points=pi["input_points"].to(DEV), input_labels=pi["input_labels"].to(DEV), image_embeddings=emb, multimask_output=True)
    lo = o.pred_masks[0]                                         # (n, 3, s, s) logits in SAM's square frame
    side = lo.shape[-1]
    hh, ww = int(round(side * H / max(W, H))), int(round(side * W / max(W, H)))
    up = F.interpolate(lo[:, :, :hh, :ww].float(), size=(H, W), mode="bilinear", align_corners=False)
    return (up > 0).cpu().numpy(), o.iou_scores[0].float().cpu().numpy()


def lin_y(rgb):
    return rgb @ np.array([0.299, 0.587, 0.114], np.float32)


def navy_clusters(rgb):
    """Boxes round clusters of the game's dark navy panes (its opaque glass), by colour alone: proposals only."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    Y = lin_y(rgb)
    navy = (Y < 0.24) & (Y > 0.02) & ((b - r) > 0.03) & ((b - r) < 0.30) & (g >= r - 0.01) & (b >= g - 0.02)
    navy = ndi.binary_opening(navy, iterations=1)
    lab, n = ndi.label(ndi.binary_dilation(navy, iterations=7))
    out = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        m = (lab[sl] == i) & navy[sl]
        a = int(m.sum())
        h, w = m.shape
        if a < 60 or a > 0.10 * navy.size or h < 8 or w < 5:
            continue
        ys, xs = np.nonzero(m)
        x0, x1, y0, y1 = xs.min() + sl[1].start, xs.max() + sl[1].start + 1, ys.min() + sl[0].start, ys.max() + sl[0].start + 1
        if (x1 - x0) > 9 * (y1 - y0) or (y1 - y0) > 9 * (x1 - x0) or a < 0.30 * (x1 - x0) * (y1 - y0):
            continue
        out.append((x0 - 3, y0 - 3, x1 + 3, y1 + 3, 0.30, "navy"))
    return out


def iou(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - ix * iy
    return ix * iy / max(u, 1e-6)


def inside_frac(a, b):
    """The share of box a that lies in box b."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    return ix * iy / max((a[2] - a[0]) * (a[3] - a[1]), 1e-6)


def masked_median(img, M, k):
    """A median of img over a k x k window that sees only M's pixels (outside M: the nearest pixel of M)."""
    idx = ndi.distance_transform_edt(~M, return_distances=False, return_indices=True)
    fill = img[idx[0], idx[1]]
    return np.stack([ndi.median_filter(fill[..., c], size=k, mode="nearest") for c in range(3)], -1)


def guided(I, p, r, eps):
    k = (2 * r + 1, 2 * r + 1)
    mI, mp = cv2.blur(I, k), cv2.blur(p, k)
    a = (cv2.blur(I * p, k) - mI * mp) / (cv2.blur(I * I, k) - mI * mI + eps)
    b = mp - a * mI
    return cv2.blur(a, k) * I + cv2.blur(b, k)


def glass_of(rgb, M, forced_cls=None):
    """(glass bool, class, note) of a window: rgb float crop, M its mask in the crop."""
    h, w = M.shape
    ys, xs = np.nonzero(M)
    if len(ys) < 30:
        return np.zeros_like(M), "none", "tiny"
    bh, bw = ys.max() - ys.min() + 1, xs.max() - xs.min() + 1
    s = int(min(bh, bw))
    k = int(max(5, round(0.28 * s))) | 1
    P = masked_median(rgb, M, min(k, 61))
    dev = np.abs(rgb - P).max(-1)
    band = M & ~ndi.binary_erosion(M, iterations=max(2, int(round(0.05 * s))))
    T = M & (dev > 0.055)
    frame = np.zeros_like(M)
    note = ""
    if T.sum() >= 20:
        px = rgb[T].astype(np.float32)
        crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5)
        K = 2 if len(px) >= 60 else 1
        _c, lab, cen = cv2.kmeans(px, K, None, crit, 3, cv2.KMEANS_PP_CENTERS)
        lab = lab.ravel()
        tb = band[T]
        # the frame's colour: the cluster that rules the window's own border (its outer frame), else the bigger one
        share = [float((lab == j).mean()) for j in range(K)]
        inb = [float(tb[lab == j].mean()) if (lab == j).any() else 0.0 for j in range(K)]
        j = int(np.argmax([inb[q] * 0.7 + share[q] * 0.3 for q in range(K)]))
        cf = cen[j]
        near = np.abs(rgb - cf).max(-1) < 0.085
        fr = M & near & ((dev > 0.03) | band)
        # thin structure only: what an opening by a third of a pane leaves is no bar (a shutter, a dark curtain)
        thick = ndi.binary_opening(fr, structure=np.ones((3, 3), bool), iterations=max(2, int(round(0.07 * s))))
        fr = fr & ~ndi.binary_dilation(thick, iterations=2)
        fl, fn = ndi.label(fr, structure=np.ones((3, 3), bool))
        for i, sl in enumerate(ndi.find_objects(fl), 1):
            comp = fl[sl] == i
            ch, cw = comp.shape
            if max(ch, cw) >= 0.30 * s or (comp & band[sl]).any():
                frame[sl] |= comp
        note = "frame %d,%d,%d" % tuple(int(255 * v) for v in cf)
    g0 = M & ~frame
    if g0.sum() < 20:
        return g0, "none", "no glass"
    med = np.median(rgb[g0], axis=0)
    Y = lin_y(rgb)
    hp = (Y - cv2.GaussianBlur(Y, (0, 0), max(2.0, 0.06 * s)))[g0]
    tex = float(np.std(hp)) / max(float(np.median(Y[g0])), 0.04)
    cstd = float(np.abs(rgb[g0] - med).max(-1).mean())
    if forced_cls:
        cls = forced_cls
    elif float(lin_y(med)) < 0.30 and (med[2] - med[0]) > 0.012 and tex < 0.30 and cstd < 0.060:
        cls = "navy"
    elif tex >= 0.22 or cstd >= 0.060:
        cls = "see"
    else:
        cls = "pale"
    if cls == "navy":
        # the opaque glass keeps to its own colour: a chair, a rail, a stanchion in front of it is no glass
        g = g0 & (np.abs(rgb - P).max(-1) < 0.075) & (np.abs(P - med).max(-1) < 0.16)
        g = ndi.binary_opening(g, iterations=1) if s > 14 else g
        holes = ndi.binary_fill_holes(g) & ~g & M & ~frame
        hl, hn = ndi.label(holes)
        if hn:
            hs = ndi.sum(holes, hl, np.arange(1, hn + 1))
            small = np.zeros(hn + 1, bool)
            small[1:] = hs < max(12, 0.02 * g.sum())
            g |= small[hl]
    else:
        g = g0
    return g, cls, note + " tex %.2f cstd %.3f" % (tex, cstd)


def one(name, out, fix):
    t0 = time.time()
    pil = Image.open(os.path.join(G, name + ".png")).convert("RGB")
    W, H = pil.size
    rgb = np.asarray(pil).astype(np.float32) / 255.0
    Yg = lin_y(rgb)
    fx = fix.get(name, {})
    props = []
    if not fx.get("only_add"):
        props += gdino(pil)
        tw, th = int(W * 0.58), int(H * 0.58)
        for ox in (0, W - tw):
            for oy in (0, H - th):
                props += gdino(pil.crop((ox, oy, ox + tw, oy + th)), (ox, oy))
        props += navy_clusters(rgb)
    lamps = [p for p in props if "lamp" in p[5]]
    wins = [p for p in props if "lamp" not in p[5]]
    wins = [p for p in wins if (p[2] - p[0]) >= 5 and (p[3] - p[1]) >= 7 and (p[2] - p[0]) * (p[3] - p[1]) < 0.30 * W * H
            and not ((p[2] - p[0]) > 0.6 * W and (p[3] - p[1]) > 0.5 * H)]
    wins += [(b[0], b[1], b[2], b[3], 2.0, "add" + (":" + b[4] if len(b) > 4 else "")) for b in fx.get("add", [])]
    # a box that holds several others is a row of windows, not a window
    keep = []
    for i, p in enumerate(wins):
        if p[5].startswith("add"):
            keep.append(p)
            continue
        kids = [q for j, q in enumerate(wins) if j != i and inside_frac(q, p) > 0.85 and (q[2] - q[0]) * (q[3] - q[1]) < 0.6 * (p[2] - p[0]) * (p[3] - p[1])]
        if len(kids) >= 2:
            continue
        keep.append(p)
    keep.sort(key=lambda p: -p[4])
    sel = []
    for p in keep:
        if all(iou(p, q) < 0.55 for q in sel):
            sel.append(p)
    inst = np.zeros((H, W), np.uint16)
    alpha = np.zeros((H, W), np.float32)
    meta = []
    subs = np.zeros((H, W), bool)
    for x, y in fx.get("sub", []):
        x0, y0, x1, y1 = max(0, int(x) - 300), max(0, int(y) - 300), min(W, int(x) + 300), min(H, int(y) + 300)
        m, sc = sam_masks(pil.crop((x0, y0, x1, y1)), points=[(x - x0, y - y0)])
        j = int(np.argmax(sc[0]))
        subs[y0:y1, x0:x1] |= m[0, j]
    drops = fx.get("drop_at", [])
    for p in sorted(sel, key=lambda p: (p[2] - p[0]) * (p[3] - p[1])):
        bx0, by0, bx1, by1 = p[:4]
        bw, bh = bx1 - bx0, by1 - by0
        if any(bx0 <= dx <= bx1 and by0 <= dy <= by1 for dx, dy in drops):
            continue
        mgn = 0.45 * max(bw, bh) + 24
        cx0, cy0, cx1, cy1 = int(max(0, bx0 - mgn)), int(max(0, by0 - mgn)), int(min(W, bx1 + mgn)), int(min(H, by1 + mgn))
        crop = pil.crop((cx0, cy0, cx1, cy1))
        m, sc = sam_masks(crop, boxes=[(bx0 - cx0, by0 - cy0, bx1 - cx0, by1 - cy0)])
        best, bq = None, -1.0
        for j in range(m.shape[1]):
            mm = m[0, j]
            if mm.sum() < 20:
                continue
            ys, xs = np.nonzero(mm)
            mb = (xs.min() + cx0, ys.min() + cy0, xs.max() + cx0 + 1, ys.max() + cy0 + 1)
            q = iou(mb, p[:4]) * (0.5 + 0.5 * float(sc[0, j]))
            if q > bq:
                best, bq = mm, q
        weak = best is None or bq < 0.42
        if weak:
            if not p[5].startswith("add"):
                continue                                   # SAM sees no object of the box's shape: no window
            best = np.zeros((cy1 - cy0, cx1 - cx0), bool)
            best[int(by0 - cy0):int(by1 - cy0), int(bx0 - cx0):int(bx1 - cx0)] = True
        Mfull = np.zeros((H, W), bool)
        Mfull[cy0:cy1, cx0:cx1] = best
        if inst[Mfull].astype(bool).mean() > 0.35:         # a window already taken (the smaller proposal went first)
            continue
        forced = p[5].split(":")[1] if ":" in p[5] else None
        for cxp, cyp, cl in fx.get("cls_at", []):
            if 0 <= int(cyp) < H and 0 <= int(cxp) < W and Mfull[int(cyp), int(cxp)]:
                forced = cl
        g, cls, note = glass_of(rgb[cy0:cy1, cx0:cx1], best & ~inst[cy0:cy1, cx0:cx1].astype(bool), forced)
        g = g & ~subs[cy0:cy1, cx0:cx1]
        if cls == "none" or g.sum() < 16:
            continue
        if not p[5].startswith("add") and p[5] != "navy" and cls == "pale" and p[4] < 0.32:
            continue                                       # a pale flat thing a weak detection took for a window
        k = len(meta) + 1
        gf = np.zeros((H, W), bool)
        gf[cy0:cy1, cx0:cx1] = g
        inst[gf & (inst == 0)] = k
        ys, xs = np.nonzero(gf)
        meta.append(dict(id=k, box=[int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1], cls=cls, src=p[5], score=round(p[4], 3),
                         q=round(bq, 2), weak=bool(weak), px=int(gf.sum()), note=note))
    # alpha: the glass matted to the picture's own edges
    gl = (inst > 0).astype(np.float32)
    a = np.clip(guided(Yg, gl, 2, 4e-4), 0, 1)
    a = np.where(ndi.binary_dilation(inst > 0, iterations=1), a, 0.0)
    a = np.where(ndi.binary_erosion(inst > 0, iterations=2), 1.0, a)
    # each alpha pixel belongs to the nearest window
    idx = ndi.distance_transform_edt(inst == 0, return_distances=False, return_indices=True)
    inst_a = np.where(a > 0.02, inst[idx[0], idx[1]], 0).astype(np.uint16)
    np.savez_compressed(os.path.join(out, name + ".w5.npz"), inst=inst_a, alpha=(a * 255 + 0.5).astype(np.uint8))
    json.dump(dict(windows=meta, lamps=[[round(v, 1) for v in p[:5]] for p in lamps]), open(os.path.join(out, name + ".w5.json"), "w"))
    print("W5 %-34s %2d windows (%s), %d lamp boxes, %.1f s" % (name, len(meta), " ".join("%s%d" % (c[0], sum(1 for q in meta if q["cls"] == c)) for c in ("navy", "see", "pale")),
                                                           len(lamps), time.time() - t0), flush=True)


if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    names = sys.argv[2:]
    if names == ["--all"]:
        names = [os.path.splitext(l.rstrip("\n").split("\t")[1])[0] for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
    fp = os.path.join(HERE, "work", "win5_fix.json")
    fix = json.load(open(fp, encoding="utf-8")) if os.path.exists(fp) else {}
    for n in names:
        try:
            one(n, out, fix)
        except Exception as e:
            import traceback
            traceback.print_exc()
            print("W5 FAIL", n, repr(e)[:200], flush=True)
        if DEV == "cuda":
            torch.cuda.empty_cache()
