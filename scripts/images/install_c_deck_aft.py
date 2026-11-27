"""C deck aft, under the poop, in the game: its rooms' pictures (2026-11-26).

The pictures are our own renders (blender/c_deck_aft/renders, 1920 x 1080; see blender/c_deck_aft/README.md, which is
kept beside the Blender files and not in git): rooms with sidelights in three lights (renders/day, sunset, night),
inner rooms in one lamp-lit set (renders/lamp) that the game shows at every hour, and the padded room
(renders/padded_room). For each view this writes

    public/images/animations/locations/britannic/<Name> <k>.jpg            the master picture the game names
    public/images/animations/locations/britannic (day)/<Name> <k>.webp     its light copy (what the game shows)
    public/images/animations/locations/britannic (twilight)/<Name> <k>.webp   the sunset render   (three-light rooms)
    public/images/animations/locations/britannic (night)/<Name> <k>.webp      the night render    (three-light rooms)

and then the tables: roomImages.js (a marked block, one entry a room; the padded room, the moderators' cell, takes the
ship's real padded room), scripts/night_edit/rendered_list_c_deck_aft.tsv and timeOfDayImages.js (make_tod_manifest.py;
lamp-lit rooms are not listed, so they keep their one picture at night), dayImages.js (day_webp.py), and in
deckRooms.js each room's first picture. Run again after new renders: pictures older than their render are made again.

usage: python scripts/images/install_c_deck_aft.py [--renders DIR] [--undo] [--dry]
"""
import argparse
import json
import os
import re
import subprocess
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RENDERS_DEFAULT = os.path.join(ROOT, "blender", "c_deck_aft", "renders")
LOC = os.path.join(ROOT, "public", "images", "animations", "locations")
DATA = os.path.join(ROOT, "public", "game", "data")
LIST = os.path.join(ROOT, "scripts", "night_edit", "rendered_list_c_deck_aft.tsv")
JPG_Q, WEBP_Q, WEBP_M = 90, 90, 6

# room id -> (picture name, the renders' room names in order, the renders' folder: "3" = day/sunset/night, else one)
ROOMS = [
    ("third_class_entrance_c", "C Deck 3rd Class Entrance", ["Entrance"], "3"),
    ("third_class_general_room_c", "C Deck 3rd Class General Room", ["General_Room"], "3"),
    ("third_class_waiting_room_c", "C Deck 3rd Class Waiting Room", ["Waiting_Room"], "3"),
    ("surgery_c", "C Deck Surgery", ["Surgery"], "3"),
    ("infectious_hospital_1_c", "C Deck Infectious Hospital One", ["Infectious_Hospital_1"], "3"),
    ("infectious_hospital_2_c", "C Deck Infectious Hospital Two", ["Infectious_Hospital_2"], "3"),
    ("hospital_1_c", "C Deck Hospital One", ["Hospital_1"], "lamp"),
    ("hospital_2_c", "C Deck Hospital Two", ["Hospital_2"], "lamp"),
    ("hospital_3_c", "C Deck Hospital Three", ["Hospital_3"], "lamp"),
    ("hospital_4_c", "C Deck Hospital Four", ["Hospital_4"], "lamp"),
    ("hospital_attendants_c", "C Deck Hospital Attendants", ["Hospital_Attendants"], "lamp"),
    ("infectious_hospitals_passage_c", "C Deck Infectious Hospitals Passage", ["Hospital_Passage_1"], "lamp"),
    ("infectious_hospitals_bath_c", "C Deck Infectious Hospitals Bath", ["Hospital_Baths_1"], "lamp"),
    ("hospital_passage_c", "C Deck Hospital Passage", ["Hospital_Passage_2", "Hospital_Passage_3", "Hospital_Passage_4"],
     "lamp"),
    ("hospital_bath_c", "C Deck Hospital Bath", ["Hospital_Baths_2", "Hospital_Baths_3"], "lamp"),
    ("padded_room", "C Deck Padded Room", ["Padded_Room"], "padded_room"),
]
ON_PLAN = [r for r in ROOMS if r[0] != "padded_room"]       # the padded room is the moderators' cell, on no plan
KINDS = (("day", None), ("sunset", "britannic (twilight)"), ("night", "britannic (night)"))
BEGIN = "// >>> C deck aft, under the poop: our own renders (scripts/images/install_c_deck_aft.py)"
END = "// <<< C deck aft"


def views(renders, render_room, folder):
    """A render room's views, in order: [(n, stem, {kind: path})]. Three-light rooms keep only views found in all
    three lights. A render room named with its view ("Hospital_Passage_1") is that one view."""
    kinds = [k for k, _ in KINDS] if folder == "3" else [folder]
    found = {}
    m_view = re.fullmatch(r"(.+)_(\d+)", render_room)
    for kind in kinds:
        d = os.path.join(renders, kind)
        for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            m = re.match(re.escape(render_room) + r"_(\d+)_(.+)\.png$", f)
            n = int(m.group(1)) if m else None
            if m is None and m_view and re.match(re.escape(render_room) + r"_[a-z]", f) and f.endswith(".png"):
                n = int(m_view.group(2))
            if n is None:
                continue
            found.setdefault((n, f[:-4]), {})[kind] = os.path.join(d, f)
    return [(n, stem, paths) for (n, stem), paths in sorted(found.items()) if len(paths) == len(kinds)]


def newer(src, dst):
    return not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src)


def plan(renders):
    """[(room id, folder, [(picture name, {kind: render path})])]"""
    rooms = []
    for rid, name, render_rooms, folder in ROOMS:
        pics = []
        for rr in render_rooms:
            for _n, _stem, paths in views(renders, rr, folder):
                pics.append((f"{name} {len(pics) + 1}.jpg", paths))
        rooms.append((rid, folder, pics))
    return rooms


def write_pictures(rooms, dry):
    made = 0
    for _rid, folder, pics in rooms:
        for name, paths in pics:
            webp = os.path.splitext(name)[0] + ".webp"
            master = paths["day"] if folder == "3" else paths[folder]
            jobs = [(master, os.path.join(LOC, "britannic", name), "JPEG"),
                    (master, os.path.join(LOC, "britannic (day)", webp), "WEBP")]
            if folder == "3":
                for kind, sub in KINDS[1:]:
                    jobs.append((paths[kind], os.path.join(LOC, sub, webp), "WEBP"))
            for src, dst, fmt in jobs:
                if not newer(src, dst):
                    continue
                made += 1
                if dry:
                    continue
                im = Image.open(src)
                im.load()
                im = im.convert("RGB")
                assert im.size == (1920, 1080), (src, im.size)
                tmp = dst + ".tmp"
                if fmt == "JPEG":
                    im.save(tmp, "JPEG", quality=JPG_Q, optimize=True)
                else:
                    im.save(tmp, "WEBP", quality=WEBP_Q, method=WEBP_M)
                os.replace(tmp, dst)
    return made


def remove_pictures():
    n = 0
    for _rid, name, _rr, _f in ROOMS:
        for folder, ext in (("britannic", ".jpg"), ("britannic (day)", ".webp"), ("britannic (twilight)", ".webp"),
                            ("britannic (night)", ".webp")):
            d = os.path.join(LOC, folder)
            for f in os.listdir(d):
                if re.fullmatch(re.escape(name) + r" \d+" + re.escape(ext), f):
                    os.remove(os.path.join(d, f))
                    n += 1
    return n


def room_images(rooms):
    p = os.path.join(DATA, "roomImages.js")
    s = open(p, encoding="utf-8", newline="").read()
    nl = "\r\n" if "\r\n" in s else "\n"
    s = re.sub(re.escape(BEGIN) + r".*?" + re.escape(END) + r"(\r?\n)+", "", s, flags=re.S)
    block = ""
    if any(p_ for _r, _f, p_ in rooms):
        lines = [BEGIN]
        for rid, _f, pics in rooms:
            if pics:
                lines += [f"roomImages.{rid} = {{", "  images: [" + ", ".join(json.dumps(n) for n, _ in pics) + "],",
                          "  currentIndex: 0,", "};", ""]
        lines += [END, "", ""]
        block = nl.join(lines)
    anchor = "  RBV.data = RBV.data || {};"
    assert s.count(anchor) == 1
    s = s.replace(anchor, block + anchor)
    open(p, "w", encoding="utf-8", newline="").write(s)


def deck_rooms(rooms, undo):
    sys.path.insert(0, os.path.join(ROOT, "scripts", "deckmaps"))
    import room_outlines as RO
    p = os.path.join(DATA, "deckRooms.js")
    text = open(p, encoding="utf-8", newline="").read()
    nl = "\r\n" if "\r\n" in text else "\n"
    s, e = RO.span(text, "deckRooms")
    obj = json.loads(text[s:e])
    assert json.dumps(obj, indent=2, ensure_ascii=False).replace("\n", nl) == text[s:e], "not in the editor's layout"
    by_id = {r["id"]: r for r in obj["c_deck"]}
    for rid, _f, pics in rooms:
        if rid in by_id:
            by_id[rid]["location"]["image"] = "placeholder.jpg" if undo or not pics else pics[0][0]
    text = text[:s] + json.dumps(obj, indent=2, ensure_ascii=False).replace("\n", nl) + text[e:]
    open(p, "w", encoding="utf-8", newline="").write(text)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--renders", default=RENDERS_DEFAULT)
    ap.add_argument("--undo", action="store_true")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    rooms = plan(a.renders)
    if a.undo:
        rooms = [(rid, f, []) for rid, f, _ in rooms]
    print("rooms", len(rooms), "views", sum(len(p) for _r, _f, p in rooms))
    for rid, f, pics in rooms:
        print("  %-32s %-11s %d" % (rid, f, len(pics)))
    if a.dry:
        print("would write", write_pictures(rooms, True), "files")
        return
    if a.undo:
        print("removed", remove_pictures(), "pictures")
    else:
        print("wrote", write_pictures(rooms, False), "files")
    room_images(rooms)
    deck_rooms(rooms, a.undo)
    with open(LIST, "w", encoding="utf-8", newline="\n") as f:
        for rid, folder, pics in rooms:
            if folder == "3":
                for name, _paths in pics:
                    f.write(f"{rid}\t{name}\n")
    for script in (os.path.join(ROOT, "scripts", "night_edit", "make_tod_manifest.py"),
                   os.path.join(ROOT, "scripts", "images", "day_webp.py")):
        subprocess.run([sys.executable, script], check=True)


if __name__ == "__main__":
    main()
