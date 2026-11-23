"""Every picture cut into its own regions: Segment Anything 2.1 (Hiera-Large, Apache-2.0), automatic masks.

<gpu venv python> sam_seg.py <out_dir> <picture> [<picture> ...]

2026-11-17 (the user, of a night picture with a window lit in its lower half only, glowing bolts on a drain pipe and
night sky splashed over a deckhead: "we can do a lot better ... install whatever you need"): night4.py decided pixel by
pixel from colour what is glass and what is sky; now it decides region by region (sam_rules.py).

Light on the GPU (the user plays on the same card): the picture's embedding is made once, then a grid of single-point
prompts (GX x GY over the picture) is decoded in small batches at SAM's own 256-px mask scale; masks of good predicted
IoU and stability are kept, near-duplicates dropped by box NMS, and the rest laid largest first, smallest on top, at
half size, so each pixel belongs to the finest region holding it (a pane, a frame bar, a door, a deckhead panel).

Writes <out_dir>/<name>.sam.png (16-bit region labels at the picture's size, 0 = none) and <name>.sam.json (each
region's area at half size, predicted IoU and stability). Run in the GPU venv
(C:/Users/JTP20/AppData/Local/rbvrpg-night/venv-gpu, HF_HOME .../rbvrpg-night/hf).
"""
import json
import os
import sys
import time

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from torchvision.ops import nms
from transformers import Sam2Model, Sam2Processor

MODEL = "facebook/sam2.1-hiera-large"
GX, GY = int(os.environ.get("SAM_GX", "64")), int(os.environ.get("SAM_GY", "36"))
BATCH = int(os.environ.get("SAM_BATCH", "64"))
IOU_MIN, STAB_MIN = 0.74, 0.82

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
dev = "cuda" if torch.cuda.is_available() else "cpu"
proc = Sam2Processor.from_pretrained(MODEL)
model = Sam2Model.from_pretrained(MODEL).to(dev).eval()


def regions(im):
    W, H = im.size
    inp = proc(images=im, return_tensors="pt")
    osz = inp["original_sizes"]
    with torch.no_grad():
        emb = model.get_image_embeddings(inp["pixel_values"].to(dev))
    xs = (np.arange(GX) + 0.5) * W / GX
    ys = (np.arange(GY) + 0.5) * H / GY
    pts = [(float(x), float(y)) for y in ys for x in xs]
    h2, w2 = H // 2, W // 2
    keep_logits, keep_score, keep_stab = [], [], []
    for k in range(0, len(pts), BATCH):
        b = pts[k:k + BATCH]
        pi = proc(input_points=[[[[x, y]] for x, y in b]], input_labels=[[[1] for _ in b]], original_sizes=osz,
                  return_tensors="pt")
        with torch.no_grad():
            o = model(input_points=pi["input_points"].to(dev), input_labels=pi["input_labels"].to(dev),
                      image_embeddings=emb, multimask_output=True)
        lo = o.pred_masks[0].flatten(0, 1)                     # (n*3, 256, 256) logits in the model's square frame
        sc = o.iou_scores[0].flatten()
        # SAM's frame: the longest side scaled to the square; the picture fills its top part
        side = lo.shape[-1]
        hh = int(round(side * H / max(W, H)))
        ww = int(round(side * W / max(W, H)))
        lo = lo[:, :hh, :ww]
        inter = (lo > 1.0).flatten(1).sum(1).float()
        union = (lo > -1.0).flatten(1).sum(1).float()
        stab = inter / union.clamp_min(1)
        ok = (sc > IOU_MIN) & (stab > STAB_MIN) & (inter > 2)
        # a prompt none of whose three masks passes keeps its best one when that is fair (a big dark pane whose sky
        # gradient makes its edge less stable: it was left with no region at all)
        q = (sc * stab).view(-1, 3)
        best = q.argmax(1)
        none = ~ok.view(-1, 3).any(1)
        fb = none & (sc.view(-1, 3).gather(1, best[:, None])[:, 0] > 0.60) & (stab.view(-1, 3).gather(1, best[:, None])[:, 0] > 0.65)
        if fb.any():
            idx = torch.nonzero(fb)[:, 0] * 3 + best[fb]
            ok[idx] = True
        if ok.any():
            up = F.interpolate(lo[ok][:, None], size=(h2, w2), mode="bilinear", align_corners=False)[:, 0]
            keep_logits.append((up > 0).cpu())
            keep_score.append(sc[ok].cpu())
            keep_stab.append(stab[ok].cpu())
    if not keep_logits:
        return np.zeros((H, W), np.uint16), []
    m = torch.cat(keep_logits)
    s = torch.cat(keep_score)
    st = torch.cat(keep_stab)
    area = m.flatten(1).sum(1)
    good = area >= 6
    m, s, st, area = m[good], s[good], st[good], area[good]
    # boxes for NMS
    rows = m.any(2)
    cols = m.any(1)
    y0 = rows.float().argmax(1)
    y1 = h2 - 1 - rows.flip(1).float().argmax(1)
    x0 = cols.float().argmax(1)
    x1 = w2 - 1 - cols.flip(1).float().argmax(1)
    boxes = torch.stack([x0, y0, x1, y1], 1).float()
    kept = nms(boxes, s * st, 0.7)
    m, s, st, area = m[kept], s[kept], st[kept], area[kept]
    order = torch.argsort(area, descending=True)
    lab = np.zeros((h2, w2), np.uint16)
    info = []
    for j, i in enumerate(order.tolist(), 1):
        mm = m[i].numpy()
        lab[mm] = j
        info.append({"id": j, "area": int(area[i]), "iou": round(float(s[i]), 3), "stab": round(float(st[i]), 3)})
    full = np.asarray(Image.fromarray(lab).resize((W, H), Image.NEAREST))
    return full, info


for p in sys.argv[2:]:
    t0 = time.time()
    name = os.path.splitext(os.path.basename(p))[0]
    im = Image.open(p).convert("RGB")
    lab, info = regions(im)
    Image.fromarray(lab).save(os.path.join(out, name + ".sam.png"))
    json.dump({"regions": info, "covered": round(float((lab > 0).mean()), 4)}, open(os.path.join(out, name + ".sam.json"), "w"))
    print("%s %.1fs %d regions, %.0f%% covered" % (name, time.time() - t0, len(info), 100 * (lab > 0).mean()), flush=True)
    if dev == "cuda":
        torch.cuda.empty_cache()
