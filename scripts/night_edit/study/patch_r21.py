"""Round 21 (2026-11-23 01:35). night4.py section 4, the albedo the ship's own lights fall on. My "continuous" albedo of
2026-11-22 (brightness over the local white level) had made decks under the lamps darker than in the set in the game (a deck
in a deckhead's shade read as dark wood: 0.08 instead of 0.32), a change of the LOOK. The earlier albedo by MATERIAL is put
back (white paint 0.70, black paint 0.05, light wood 0.32, varnished wood 0.10, the rest 0.15, times the picture's grain and
colour), with what made it speckle taken out: the classes are soft weights read from a slightly smoothed picture, the
bright / dark decision within a class is a ramp, and white paint's class takes in its blue shade under a deckhead (it was
"the rest", 0.15: the ragged dark patches on lamp-lit deckheads)."""
import ast
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "night4.py")
s = open(p, encoding="utf-8").read()
i0 = s.index('# 2026-11-22 (the user: "no weird artifacts"): the albedo was a guess of the MATERIAL by hard thresholds (white paint 0.70,\n')
i1 = s.index("alb = albY[..., None] * chrom\n") + len("alb = albY[..., None] * chrom\n")
new = '''# 2026-11-23: the albedo by MATERIAL, as it was until 2026-11-22 (so that decks and paint take the lamps' light as in the set
# the user called fine), without what made it speckle: soft classes read from a slightly smoothed picture, a ramp for
# bright / dark within a class, and white paint's class taking in its blue shade under a deckhead.
_Lb = cv2.GaussianBlur(relit, (0, 0), 1.5)
_ub = np.log(np.maximum(_Lb[..., 0], 1e-4) / np.maximum(_Lb[..., 1], 1e-4))
_wb = np.log(np.maximum(_Lb[..., 2], 1e-4) / np.maximum(_Lb[..., 1], 1e-4))


def _ramp01(x_, a_, b_):
    return np.clip((x_ - a_) / (b_ - a_), 0, 1)


_wn = (1 - _ramp01(np.abs(_ub), 0.10, 0.16)) * (1 - _ramp01(_wb, 0.42, 0.55)) * (1 - _ramp01(-_wb, 0.18, 0.26))     # paint, its blue shade too
_ww = _ramp01(_ub, 0.10, 0.16) * _ramp01(-_wb, 0.03, 0.08)                                                           # wood
_wo = np.clip(1 - _wn - _ww, 0, 1)
ref = 0.15 * _wo
for _wt, hi_, lo_ in ((_wn, 0.70, 0.05), (_ww, 0.32, 0.10)):
    mm = ((_wt > 0.5) & solid).astype(np.float32)
    if mm.sum() < 100:
        ref = ref + _wt * 0.15
        continue
    lvl_, ld_ = masked_blur(np.sqrt(np.maximum(Yr, 0)), mm, 60)      # a local level of the class (sqrt: robust)
    lvl_ = np.where(ld_ > 0.02, lvl_ ** 2, float(np.percentile(Yr[mm > 0.5], 80)))
    ref = ref + _wt * (lo_ + (hi_ - lo_) * _ramp01(Yr / np.maximum(lvl_, 1e-4), 0.22, 0.40))       # (was: bright if over 0.30 of the level)
ref = (ref / np.maximum(_wn + _ww + _wo, 1e-4)).astype(np.float32)
grain = np.clip(Yr / np.maximum(gblur(Yr, 6), 1e-4), 0.6, 1.5)
chrom = relit / np.maximum(Yr, 1e-4)[..., None]
chrom = (chrom @ LUM)[..., None] * 0.3 + chrom * 0.7
alb = (ref * grain)[..., None] * chrom
'''
s = s[:i0] + new + s[i1:]
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
os.replace(p + ".tmp", p)
print("round 21 patched: night4.py (albedo by material, soft)")
