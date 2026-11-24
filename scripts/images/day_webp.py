"""WebP copies of the rooms' day pictures (2026-11-24).

The day pictures are 1920x1080 PNG and JPEG files of 2 to 4 MB each, and a room
loads all its views as it is entered: a promenade with six views cost 13 MB.
Each picture named in public/game/data/roomImages.js gets a WebP copy in a
folder beside its own ("britannic" -> "britannic (day)", "southampton" ->
"southampton (day)"), at the settings of the night and sunrise/sunset sets
(scripts/night_edit: Pillow WEBP quality 90, method 6), and
public/game/data/dayImages.js lists the copies; the game shows a copy where
there is one and the original otherwise (game.js lighterPicture). The originals
stay as they are: they are the masters (the night sets are made from them).

Run again after adding or changing a day picture: copies older than their
original are made again.

usage: python scripts/images/day_webp.py [--force] [--jobs N]
"""
import argparse
import json
import os
import re
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOCATIONS = os.path.join(ROOT, "public", "images", "animations", "locations")
ROOM_IMAGES = os.path.join(ROOT, "public", "game", "data", "roomImages.js")
MANIFEST = os.path.join(ROOT, "public", "game", "data", "dayImages.js")
FOLDERS = ["britannic", "southampton"]
QUALITY, METHOD = 90, 6


def named_pictures():
    """The picture names roomImages.js gives the rooms."""
    src = open(ROOM_IMAGES, encoding="utf-8").read()
    return sorted(set(re.findall(r'"([^"/\\]+\.(?:png|jpe?g))"', src, re.I)))


def copy_path(folder, name):
    stem = os.path.splitext(name)[0]
    return os.path.join(LOCATIONS, f"{folder} (day)", stem + ".webp")


def convert(job):
    src, dst = job
    im = Image.open(src)
    im.load()
    if im.mode in ("RGBA", "LA") and im.getchannel("A").getextrema()[0] == 255:
        im = im.convert("RGB")  # an alpha channel with nothing in it
    elif im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA" if "A" in im.mode or "transparency" in im.info else "RGB")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = dst + ".tmp"
    im.save(tmp, "WEBP", quality=QUALITY, method=METHOD)
    os.replace(tmp, dst)
    return src, os.path.getsize(src), os.path.getsize(dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="make every copy again")
    ap.add_argument("--jobs", type=int, default=max(1, min(10, (os.cpu_count() or 2) - 2)))
    args = ap.parse_args()

    have = {f: [] for f in FOLDERS}
    jobs, missing = [], []
    for name in named_pictures():
        for folder in FOLDERS:
            src = os.path.join(LOCATIONS, folder, name)
            if os.path.isfile(src):
                dst = copy_path(folder, name)
                have[folder].append(name)
                if args.force or not os.path.isfile(dst) or os.path.getmtime(dst) < os.path.getmtime(src):
                    jobs.append((src, dst))
                break
        else:
            missing.append(name)

    before = after = 0
    if jobs:
        print(f"making {len(jobs)} copies with {args.jobs} workers...", flush=True)
        with ProcessPoolExecutor(max_workers=args.jobs) as ex:
            for i, (src, a, b) in enumerate(ex.map(convert, jobs, chunksize=2), 1):
                before += a
                after += b
                if i % 25 == 0 or i == len(jobs):
                    print(f"  {i}/{len(jobs)}", flush=True)
        print(f"made: {before / 2**20:.1f} MB of originals -> {after / 2**20:.1f} MB of WebP")

    total_src = sum(os.path.getsize(os.path.join(LOCATIONS, f, n)) for f in FOLDERS for n in have[f])
    total_dst = sum(os.path.getsize(copy_path(f, n)) for f in FOLDERS for n in have[f])
    print(f"all copies: {sum(len(v) for v in have.values())} pictures, {total_src / 2**20:.1f} MB -> {total_dst / 2**20:.1f} MB")
    if missing:
        print(f"named in roomImages.js but not found ({len(missing)}): {', '.join(missing)}")

    lists = {f: sorted(v) for f, v in have.items()}
    body = (
        "// The rooms' day pictures that have a WebP copy (written by scripts/images/day_webp.py):\n"
        "// <folder>/<name>.png or .jpg has <folder> (day)/<name>.webp, a tenth of the size. game.js\n"
        "// lighterPicture shows the copy, and the original where a copy is missing or fails.\n"
        "(function (RBV) {\n"
        f"  const NAMES = {json.dumps(lists, indent=2, ensure_ascii=False)};\n"
        "  const have = {};\n"
        "  for (const [folder, names] of Object.entries(NAMES)) have[folder] = new Set(names);\n"
        "  const AT = /^\\/images\\/animations\\/locations\\/([^/]+)\\/([^/]+)\\.(png|jpe?g)$/i;\n"
        "\n"
        "  // a day picture's WebP copy, or the path as it is\n"
        "  function lighter(path) {\n"
        "    const m = AT.exec(path || \"\");\n"
        "    if (!m || !have[m[1]] || !have[m[1]].has(`${m[2]}.${m[3]}`)) return path;\n"
        "    return `/images/animations/locations/${m[1]} (day)/${m[2]}.webp`;\n"
        "  }\n"
        "\n"
        "  RBV.data = RBV.data || {};\n"
        "  RBV.data.dayImages = { NAMES, lighter };\n"
        "})(window.RBV);\n"
    )
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        f.write(body)
    print(f"wrote {os.path.relpath(MANIFEST, ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
