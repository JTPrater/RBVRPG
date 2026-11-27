"""The boat-deck officers' house in the game: its rooms' pictures in three lights (2026-11-26).

The pictures are our own renders (blender/boat_deck_cabins/renders/<day|sunset|night>/<Room>_<n>_<view>.png,
1920 x 1080, made by obd_final_renders.py). For every view that exists in all three lights this writes

    public/images/animations/locations/britannic/<Name> <k>.jpg            the day picture (the master the game names)
    public/images/animations/locations/britannic (day)/<Name> <k>.webp     its light copy (what the game shows)
    public/images/animations/locations/britannic (twilight)/<Name> <k>.webp   the sunset render
    public/images/animations/locations/britannic (night)/<Name> <k>.webp      the night render

and then the tables: roomImages.js (a marked block, one entry a room), scripts/night_edit/rendered_list.tsv and
timeOfDayImages.js (make_tod_manifest.py), dayImages.js (day_webp.py), and in deckRooms.js each room's first picture
and its type. Run again after new renders: pictures older than their render are made again.

usage: python scripts/images/install_officers_house.py [--renders DIR] [--undo] [--dry]
"""
import json
import os
import re
import subprocess
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RENDERS = os.path.join(ROOT, "blender", "boat_deck_cabins", "renders")
for _i, _a in enumerate(sys.argv):                     # --renders DIR (a release worktree has no blender/ folder)
    if _a == "--renders" and _i + 1 < len(sys.argv):
        RENDERS = sys.argv[_i + 1]
LOC = os.path.join(ROOT, "public", "images", "animations", "locations")
DATA = os.path.join(ROOT, "public", "game", "data")
LIST = os.path.join(ROOT, "scripts", "night_edit", "rendered_list.tsv")
JPG_Q, WEBP_Q, WEBP_M = 90, 90, 6

# room id -> (picture name, the renders' room names in order, the room's type in the game)
ROOMS = [
    ("sixth_officers_cabin_bd", "6th Officer Cabin", ["6th_Officer"], "cabin"),
    ("fifth_officers_cabin_bd", "5th Officer Cabin", ["5th_Officer"], "cabin"),
    ("pilots_cabin_bd", "Pilot Cabin", ["Pilot"], "cabin"),
    ("fourth_officers_cabin_bd", "4th Officer Cabin", ["4th_Officer"], "cabin"),
    ("second_officers_cabin_bd", "2nd Officer Cabin", ["2nd_Officer"], "cabin"),
    ("first_officers_cabin_bd", "1st Officer Cabin", ["1st_Officer"], "cabin"),
    ("chief_officers_cabin_bd", "Chief Officer Cabin", ["Chief_Officer"], "cabin"),
    ("assistant_commanders_cabin_bd", "Assistant Commander Cabin", ["Asst_Commander"], "cabin"),
    ("third_officers_cabin_bd", "3rd Officer Cabin", ["3rd_Officer"], "cabin"),
    ("captains_bathroom_bd", "Captain Bathroom", ["Captain_Bath"], "bathroom"),
    ("captains_bedroom_bd", "Captain Bedroom", ["Captain_Bedroom"], "cabin"),
    ("captains_sitting_room_bd", "Captain Sitting Room", ["Captain_Sitting_Room"], "lounge"),
    ("officers_port_corridor_bd", "Officers Port Corridor", ["Port_Corridor"], "corridor"),
    ("officers_starboard_corridor_bd", "Officers Starboard Corridor", ["Starboard_Corridor"], "corridor"),
    ("officers_entrance_bd", "Officers Entrance", ["Cross_Passage", "Port_Vestibule", "Starboard_Vestibule"], "corridor"),
    ("officers_smoke_room_bd", "Officers Smoke Room", ["Smoke_Room"], "smoking-room"),
    ("officers_pantry_bd", "Officers Pantry", ["Pantry"], "pantry"),
    ("stewards_room_bd", "Stewards Room", ["Stewards"], "cabin"),
    ("officers_lavatory_bd", "Officers Lavatory", ["Officers_Lavatory"], "lavatory"),
    ("officers_bath_bd", "Officers Bath", ["Officers_Bath"], "bathroom"),
    ("assistant_commanders_wc_bd", "Assistant Commander WC", ["AC_WC"], "wc"),
    ("officers_wc_bd", "Officers WC", ["Officers_WC"], "wc"),
    ("oilskin_locker_bd", "Oilskin Locker", ["Oilskins"], "locker"),
]
# render stems (without the light's folder) left out of the game, with the reason
EXCLUDE = {  # the independent picture check of 2026-11-26
    "Port_Corridor_3_chief_officers_door": "half the frame is one blank wall",
    "Starboard_Corridor_3_captains_door": "walls close to the lens fill most of the frame",
    "Officers_Lavatory_4_urinal": "two blank walls fill three quarters of the frame",
    "Pantry_4_sink": "the plates in the rack, close to the lens, read as pillows (second check)",
    "Captain_Bath_1_from_the_bedroom_door": "a door at the lens fills a third of the frame (second check)",
}
KINDS = (("day", None), ("sunset", "britannic (twilight)"), ("night", "britannic (night)"))
BEGIN = "// >>> the boat-deck officers' house: our own renders in three lights (scripts/images/install_officers_house.py)"
END = "// <<< the boat-deck officers' house"


def views(render_room):
    """A render room's views present in all three lights, in order: [(n, stem)]."""
    found = {}
    for kind, _ in KINDS:
        d = os.path.join(RENDERS, kind)
        if not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            m = re.match(re.escape(render_room) + r"_(\d+)_(.+)\.png$", f)
            if m:
                found.setdefault((int(m.group(1)), f[:-4]), set()).add(kind)
    out, short = [], []
    for (n, stem), kinds in sorted(found.items()):
        if stem in EXCLUDE:
            continue
        (out if len(kinds) == 3 else short).append((n, stem))
    return out, short


def newer(src, dst):
    return not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src)


def rgb(path):
    im = Image.open(path)
    im.load()
    return im.convert("RGB")


def plan():
    """[(room id, type, [(picture name, stem)])], and the views that lack a light."""
    rooms, lacking = [], []
    for rid, name, render_rooms, typ in ROOMS:
        pics = []
        for rr in render_rooms:
            full, short = views(rr)
            lacking += [s for _n, s in short]
            for _n, stem in full:
                pics.append((f"{name} {len(pics) + 1}.jpg", stem))
        rooms.append((rid, typ, pics))
    return rooms, lacking


def write_pictures(rooms, dry):
    made = 0
    for _rid, _typ, pics in rooms:
        for name, stem in pics:
            webp = os.path.splitext(name)[0] + ".webp"
            day = os.path.join(RENDERS, "day", stem + ".png")
            jobs = [(day, os.path.join(LOC, "britannic", name), "JPEG"),
                    (day, os.path.join(LOC, "britannic (day)", webp), "WEBP")]
            for kind, folder in KINDS[1:]:
                jobs.append((os.path.join(RENDERS, kind, stem + ".png"), os.path.join(LOC, folder, webp), "WEBP"))
            for src, dst, fmt in jobs:
                if not newer(src, dst):
                    continue
                made += 1
                if dry:
                    continue
                im = rgb(src)
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
    for _rid, name, _rr, _typ in ROOMS:
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
    if rooms:
        lines = [BEGIN]
        for rid, _typ, pics in rooms:
            if not pics:
                continue
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
    by_id = {r["id"]: r for r in obj["boat_deck"]}
    for rid, typ, pics in rooms:
        r = by_id[rid]
        r["type"] = typ
        r["location"]["image"] = "placeholder.jpg" if undo or not pics else pics[0][0]
    text = text[:s] + json.dumps(obj, indent=2, ensure_ascii=False).replace("\n", nl) + text[e:]
    open(p, "w", encoding="utf-8", newline="").write(text)


def main():
    undo, dry = "--undo" in sys.argv, "--dry" in sys.argv
    rooms, lacking = plan()
    if undo:
        rooms = [(rid, typ, []) for rid, typ, _ in rooms]
    n_pics = sum(len(p) for _r, _t, p in rooms)
    print("rooms", len(rooms), "views", n_pics, "| views lacking a light:", len(lacking), lacking[:6])
    for rid, _typ, pics in rooms:
        print("  %-32s %d" % (rid, len(pics)))
    if dry:
        print("would write", write_pictures(rooms, True), "files")
        return
    if undo:
        print("removed", remove_pictures(), "pictures")
    else:
        print("wrote", write_pictures(rooms, False), "files")
    room_images(rooms)
    deck_rooms(rooms, undo)
    with open(LIST, "w", encoding="utf-8", newline="\n") as f:
        for rid, _typ, pics in rooms:
            for name, _stem in pics:
                f.write(f"{rid}\t{name}\n")
    record = {name: stem for _r, _t, pics in rooms for name, stem in pics}
    with open(os.path.join(RENDERS, "_game_names.json"), "w", encoding="utf-8") as f:
        json.dump(record, f, indent=1)
    for script in (os.path.join(ROOT, "scripts", "night_edit", "make_tod_manifest.py"),
                   os.path.join(ROOT, "scripts", "images", "day_webp.py")):
        subprocess.run([sys.executable, script], check=True)


if __name__ == "__main__":
    main()
