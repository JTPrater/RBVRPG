"""night4.py's region-level decisions from SAM 2.1's regions (sam_seg.py), 2026-11-17.

The user's example (1st A port prom1 at night): a tall pane lit in its lower half only (the pixel tests split it where
its blue gradient crossed a threshold), the bolts on a white drain pipe glowing (any dark spot ringed by white paint was
taken for a pane) and night sky splashed over the deckhead (blue-grey shade let the sky flood in). Decided per region
instead: a pane lights whole or not at all, a bolt is no pane, a deckhead panel is no sky.
"""
import numpy as np
from scipy import ndimage as ndi


def load(path, H, W):
    from PIL import Image
    lab = np.asarray(Image.open(path)).astype(np.int32)
    if lab.shape != (H, W):
        return None
    return lab


def region_stats(lab, *maps):
    """Per region (index = label) the pixel count and the mean of each map."""
    n = int(lab.max()) + 1
    cnt = np.bincount(lab.ravel(), minlength=n).astype(np.float64)
    means = [np.bincount(lab.ravel(), weights=m.ravel().astype(np.float64), minlength=n) / np.maximum(cnt, 1)
             for m in maps]
    return cnt, means


def veto_sky(lab, outside, skycol, near, min_area=150):
    """Sky that came into a region which is mostly ship (a deckhead panel, a white wall in blue shade) goes back to the
    ship: the region's own majority decides, when it is clear (a third or less outside) and the region is not sky
    coloured on the whole, and only for pixels the depth model puts near (`near`): real sky seen through a frame that
    shares a region with it reads far and stays sky. Returns the corrected mask and how many pixels it took back."""
    n = int(lab.max()) + 1
    if n <= 1:
        return outside, 0
    cnt, (fo, fs) = region_stats(lab, outside.astype(np.float32), skycol.astype(np.float32))
    bad = np.zeros(n, bool)
    bad[1:] = (cnt[1:] >= min_area) & (fo[1:] > 0) & (fo[1:] <= 0.34) & (fs[1:] < 0.5)
    take = bad[lab] & outside & near
    return outside & ~take, int(take.sum())


def glass_refine(lab, glass, zone, glassy, min_area=30, speck=150):
    """The pixel tests' glass, made whole region by region: a pane already mostly found (40 percent) and mostly glass
    coloured is completed with its glass-coloured pixels (a tall pane's sky gradient had split it: lit below, dark
    above); glass found only as specks in a region that is otherwise not glass (bolts on a drain pipe, rivets) is
    dropped. The edges stay the pixel tests' own (SAM's regions are at half size)."""
    n = int(lab.max()) + 1
    if n <= 1:
        return glass, {}
    cnt, (fg, inz, fgl) = region_stats(lab, glass.astype(np.float32), zone.astype(np.float32), glassy.astype(np.float32))
    comp = np.zeros(n, bool)
    comp[1:] = (inz[1:] >= 0.85) & (fg[1:] >= 0.40) & (fgl[1:] >= 0.55) & (cnt[1:] >= min_area)
    out = glass | (comp[lab] & glassy & zone)
    clean = np.zeros(n, bool)
    clean[1:] = (fg[1:] > 0) & (fg[1:] < 0.12) & (cnt[1:] >= 4 * speck)
    cl = clean[lab] & out
    if cl.any():
        cc, k = ndi.label(cl)
        if k:
            sz = ndi.sum(np.ones_like(cc), cc, np.arange(1, k + 1))
            small = np.zeros(k + 1, bool)
            small[1:] = sz < speck
            out &= ~small[cc]
    return out, {"sam_completed_px": int((out & ~glass).sum()), "sam_specks_px": int((glass & ~out).sum())}
