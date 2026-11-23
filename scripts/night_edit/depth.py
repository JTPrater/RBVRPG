"""Relative depth of game pictures with Depth Anything V2 Small (Apache-2.0), CPU.

<venv python> depth.py <out_dir> <picture> [<picture> ...]

Writes <out_dir>/<name>.disp.npy: float32 at the picture's size, the model's relative inverse depth (larger = nearer;
affine-invariant: night4.py calibrates it on the deck plane), the mean of the picture and its mirror image (less noise),
run with the short side at 770 px (thin rigging and rails come out better than at the default 518). A preview png too.
Run in the private venv (C:/Users/JTP20/AppData/Local/rbvrpg-night/venv); HF_HOME there holds the model.
"""
import os
import sys
import time

import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForDepthEstimation

MODEL = "depth-anything/Depth-Anything-V2-Small-hf"
SHORT = 770

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
torch.set_num_threads(max(1, os.cpu_count() or 1))
proc = AutoImageProcessor.from_pretrained(MODEL)
model = AutoModelForDepthEstimation.from_pretrained(MODEL, use_safetensors=True).eval()


def run(im):
    inputs = proc(images=im, return_tensors="pt", size={"height": SHORT, "width": SHORT})
    with torch.no_grad():
        d = model(**inputs).predicted_depth                      # (1, h, w)
    d = torch.nn.functional.interpolate(d[:, None], size=(im.height, im.width), mode="bicubic", align_corners=False)
    return d[0, 0].numpy().astype(np.float32)


for p in sys.argv[2:]:
    t0 = time.time()
    im = Image.open(p).convert("RGB")
    d1 = run(im)
    d2 = run(im.transpose(Image.FLIP_LEFT_RIGHT))[:, ::-1]
    d = 0.5 * (d1 + d2)
    base = os.path.splitext(os.path.basename(p))[0]
    np.save(os.path.join(out, base + ".disp.npy"), d)
    v = (d - d.min()) / max(float(d.max() - d.min()), 1e-6)
    Image.fromarray((v * 255).astype(np.uint8)).resize((im.width // 2, im.height // 2)).save(os.path.join(out, base + ".disp.png"))
    print(f"{base}: {time.time() - t0:.1f} s, disp {d.min():.3f}..{d.max():.3f}", flush=True)
