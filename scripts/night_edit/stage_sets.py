"""Stage the edited night and sunrise/sunset sets as the game's WebP files WITHOUT touching public/images (2026-11-21):
python -I stage_sets.py  ->  work/stage/britannic (night)/*.webp, work/stage/britannic (twilight)/*.webp
The same settings as export_sets.py (WebP q 90, method 6), from the edits only (work/out, work/twilight): the Blender
composites of 2026-11-17 in work/blender_night|blender_twilight are stale and are not used."""
import os, sys
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
names = [l.rstrip("\n").split("\t")[1] for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
tot = 0
for src, folder in (("out", "britannic (night)"), ("twilight", "britannic (twilight)")):
    dd = os.path.join(HERE, "work", "stage", folder)
    os.makedirs(dd, exist_ok=True)
    for n in names:
        b = os.path.splitext(n)[0]
        im = Image.open(os.path.join(HERE, "work", src, b + ".png")).convert("RGB")
        assert im.size == (1920, 1080), (n, im.size)
        o = os.path.join(dd, b + ".webp")
        im.save(o, "WEBP", quality=90, method=6)
        tot += os.path.getsize(o)
    print(folder, len(names), "staged", flush=True)
print("total %.1f MB" % (tot / 1e6))
