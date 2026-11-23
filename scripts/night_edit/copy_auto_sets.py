"""Put the "sun taken out first" night and sunrise/sunset sets into the game (the user, 2026-11-22: "Yes, copy them").

python -I copy_desun_sets.py        ->  1. the game's two folders as they are now are copied to work/game_sets_desun_2026-11-22
                                         (kept if that backup is already there);
                                     2. work/desun_night, work/desun_twilight are staged as WebP (q 90, method 6, as every
                                        set before) in work/stage_desun;
                                     3. checks: 133 names a set, each 1920 x 1080, the same names the game's folders hold;
                                     4. only then the staged files are copied over the game's;
                                     5. every game file is compared with its staged twin (md5) and opened.
Undo: copy work/game_sets_desun_2026-11-22/<folder>/* back over public/images/animations/locations/<folder>/."""
import hashlib
import os
import shutil
import sys
import time

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.normpath(os.path.join(HERE, "..", "..", "public", "images", "animations", "locations"))
W = os.path.join(HERE, "work")
BK = os.path.join(W, "game_sets_desun_2026-11-22")
ST = os.path.join(W, "stage_auto")
SETS = (("auto_night", "britannic (night)"), ("auto_twilight", "britannic (twilight)"))
names = [os.path.splitext(l.rstrip("\n").split("\t")[1])[0] for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
assert len(names) == 133 and len(set(names)) == 133, len(names)


def md5(p):
    return hashlib.md5(open(p, "rb").read()).hexdigest()


t0 = time.time()
# 1. the backup of what the game holds now
for _src, folder in SETS:
    g, b = os.path.join(GAME, folder), os.path.join(BK, folder)
    have = sorted(os.listdir(g))
    if not os.path.isdir(b):
        os.makedirs(b)
        for f in have:
            shutil.copy2(os.path.join(g, f), os.path.join(b, f))
    back = sorted(os.listdir(b))
    assert len(back) == 133, (folder, len(back))
    print("BACKUP %-22s %d files in %s" % (folder, len(back), b), flush=True)
# 2. staging
tot = 0
for src, folder in SETS:
    dd = os.path.join(ST, folder)
    os.makedirs(dd, exist_ok=True)
    for n in names:
        im = Image.open(os.path.join(W, src, n + ".png")).convert("RGB")
        assert im.size == (1920, 1080), (n, im.size)
        o = os.path.join(dd, n + ".webp")
        im.save(o, "WEBP", quality=90, method=6)
        tot += os.path.getsize(o)
    print("STAGED %-22s %d (%.0f s)" % (folder, len(names), time.time() - t0), flush=True)
# 3. checks before anything in public/ changes
for _src, folder in SETS:
    staged = sorted(os.listdir(os.path.join(ST, folder)))
    game = sorted(os.listdir(os.path.join(GAME, folder)))
    assert staged == sorted(n + ".webp" for n in names), (folder, "the staged names are not the list's")
    assert staged == game, (folder, "the game's folder holds other names", sorted(set(game) ^ set(staged))[:5])
print("CHECKED: both sets hold the game's 133 names; %.1f MB staged" % (tot / 1e6), flush=True)
# 4. the copy
for _src, folder in SETS:
    for f in sorted(os.listdir(os.path.join(ST, folder))):
        shutil.copyfile(os.path.join(ST, folder, f), os.path.join(GAME, folder, f))
# 5. what the game holds now
rec = []
for _src, folder in SETS:
    g = os.path.join(GAME, folder)
    fs = sorted(os.listdir(g))
    assert len(fs) == 133, (folder, len(fs))
    changed = 0
    for f in fs:
        a = md5(os.path.join(g, f))
        assert a == md5(os.path.join(ST, folder, f)), (folder, f)
        with Image.open(os.path.join(g, f)) as im:
            assert im.size == (1920, 1080), (f, im.size)
            im.load()
        changed += a != md5(os.path.join(BK, folder, f))
        rec.append("%s  %s/%s" % (a, folder, f))
    mb = sum(os.path.getsize(os.path.join(g, f)) for f in fs) / 1e6
    print("IN THE GAME %-22s 133 files, %.1f MB, %d differ from the backup, every one opens" % (folder, mb, changed), flush=True)
open(os.path.join(W, "COPIED_auto_2026-11-22.md5"), "w", encoding="utf-8", newline="\n").write("\n".join(rec) + "\n")
print("DONE %.0f s; record work/COPIED_auto_2026-11-22.md5; undo: copy %s/<folder>/* back" % (time.time() - t0, BK))
