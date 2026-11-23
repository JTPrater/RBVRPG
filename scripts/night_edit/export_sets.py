"""Exports the rendered night and sunrise/sunset sets into the game: work/out -> public/images/animations/locations/
britannic (night)/<name>.webp, work/twilight -> britannic (twilight)/<name>.webp (WebP q 90: about a tenth of the
PNGs), then writes public/game/data/timeOfDayImages.js (make_tod_manifest.py).

2026-11-17 (the user: "split those sunset/sunrise and night time renders 50/50 from the editing and the actual blender
model"): a picture with a render from the Blender model (work/blender_night/<name>.png, work/blender_twilight/<name>.png,
made by blender/tod_renders) takes that render instead of its edit; work/sources.json records which each one is.

python -I export_sets.py [--check]   (--check: report what would be written, write nothing)"""
import os, subprocess, sys
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
names = [l.rstrip("\n").split("\t")[1] for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
CHECK = "--check" in sys.argv
tot = 0
sources = {}
for src, bsrc, folder in (("out", "blender_night", "britannic (night)"), ("twilight", "blender_twilight", "britannic (twilight)")):
    sd = os.path.join(HERE, "work", src)
    bd = os.path.join(HERE, "work", bsrc)
    dd = os.path.join(ROOT, "public", "images", "animations", "locations", folder)
    miss = [n for n in names if not os.path.exists(os.path.join(sd, os.path.splitext(n)[0] + ".png"))]
    if miss:
        sys.exit("%s: %d renders missing, e.g. %s" % (src, len(miss), miss[:3]))
    if CHECK:
        print(folder, len(names), "to write"); continue
    os.makedirs(dd, exist_ok=True)
    for n in names:
        b = os.path.splitext(n)[0]
        bp = os.path.join(bd, b + ".png")
        use_b = os.path.exists(bp)
        sources.setdefault(b, {})[folder] = "blender" if use_b else "edit"
        im = Image.open(bp if use_b else os.path.join(sd, b + ".png")).convert("RGB")
        assert im.size == (1920, 1080), (n, im.size)
        o = os.path.join(dd, b + ".webp")
        im.save(o + ".part", "WEBP", quality=90, method=6)
        os.replace(o + ".part", o)
        tot += os.path.getsize(o)
    print(folder, len(names), "written")
if not CHECK:
    import json
    json.dump(sources, open(os.path.join(HERE, "work", "sources.json"), "w"), indent=1)
    nb = sum(1 for v in sources.values() if "blender" in v.values())
    print("from Blender: %d pictures; from the edits: %d" % (nb, len(sources) - nb))
    print("total %.1f MB" % (tot / 1e6))
    subprocess.check_call([sys.executable, "-I", os.path.join(HERE, "make_tod_manifest.py")])
