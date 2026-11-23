"""Round 24 (2026-11-23 02:40), from the independent check (monday/review/CRITIC.md) laid beside the set in the game:
night4.py
 - SAM's region maps are OFF unless USE_SAM=1. The set in the game was made without them (1 picture of 133 had a map); I had
   since made maps for all 133, and their sky veto cut pieces out of the sky seen through the bridge's and the enclosed
   promenades' windows (ragged stair-stepped day-sky patches at night, teal patches at sunset): a regression.
 - sunset: the sun's share is no longer evened out under deckheads (it washed a bridge's consoles flat orange with a hard
   edge); only the edge-keeping smoothing stays.
win6.py  "add" option "lightblue": sky-mirroring glass only, no navy (a dark rope crossing such a pane was lit with it)."""
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
patch("night4.py", [
    ("SAM = sam_rules.load(SAMP, H, W) if os.path.exists(SAMP) else None\n",
     "SAM = sam_rules.load(SAMP, H, W) if (os.environ.get(\"USE_SAM\") == \"1\" and os.path.exists(SAMP)) else None      # (off: see study/patch_r24.py)\n"),
    ("""    cs_ = (cov & solid).astype(np.float32)
    if cs_.sum() > 500:
        sm_, sd_ = masked_blur(s_, cs_, 45)
        cf_ = np.clip(gblur(cs_, 6), 0, 1)
        s_ = s_ * (1 - cf_) + np.where(sd_ > 0.02, sm_, s_) * cf_
""", ""),
])
patch("win6.py", [
    ("            elif only_blue:                                  # bluish glass of any brightness: sky-mirroring panes, navy\n",
     "            elif lightblue:                                  # sky-mirroring glass only (no navy: a dark rope in front is not glass)\n"
     "                gl &= ndi.binary_closing(((b - r) > 0.10) & (sat > 0.30) & (g > r), structure=K3) & ~out_\n"
     "            elif only_blue:                                  # bluish glass of any brightness: sky-mirroring panes, navy\n"),
    ("        only_navy = replace = only_blue = raw = keepout = hull_o = soft = tracery = False\n",
     "        only_navy = replace = only_blue = raw = keepout = hull_o = soft = tracery = lightblue = False\n"),
    ("            tracery = bool(bx.get(\"tracery\"))\n", "            tracery = bool(bx.get(\"tracery\"))\n            lightblue = bool(bx.get(\"lightblue\"))\n"),
    ("            tracery = \"tracery\" in bx[4:]\n", "            tracery = \"tracery\" in bx[4:]\n            lightblue = \"lightblue\" in bx[4:]\n"),
])
p = os.path.join(HERE, "work", "win5_fix.json")
j = json.load(open(p, encoding="utf-8"))
j["BD first port prom3"]["add"] = [[1625, 780, 1860, 925, "lightblue"]]
open(p + ".tmp", "w", encoding="utf-8", newline=chr(10)).write(json.dumps(j, indent=1, ensure_ascii=False))
os.replace(p + ".tmp", p)
print("round 24 patched")
