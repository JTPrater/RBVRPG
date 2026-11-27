"""C deck amidships, forward and under the forecastle, in the game: the rooms' pictures (2026-11-27; 37 rooms in two
releases).

The pictures are our own renders (blender/c_deck_midships/renders, 1920 x 1080; see its README.md, which is
kept beside the Blender files and not in git): rooms with a window or sidelights in three lights (renders/day,
sunset, night), inner rooms in one lamp-lit set (renders/lamp) that the game shows at every hour. For each view this
writes

    public/images/animations/locations/britannic/<Name> <k>.jpg            the master picture the game names
    public/images/animations/locations/britannic (day)/<Name> <k>.webp     its light copy (what the game shows)
    public/images/animations/locations/britannic (twilight)/<Name> <k>.webp   the sunset render   (three-light rooms)
    public/images/animations/locations/britannic (night)/<Name> <k>.webp      the night render    (three-light rooms)

and then the tables: roomImages.js (a marked block, one entry a room), scripts/night_edit/rendered_list_c_deck_midships.tsv
and timeOfDayImages.js (make_tod_manifest.py;
lamp-lit rooms are not listed, so they keep their one picture at night), dayImages.js (day_webp.py), and in
deckRooms.js each room's first picture. Run again after new renders: pictures older than their render are made again.

usage: python scripts/images/install_c_deck_midships.py [--renders DIR] [--undo] [--dry]
"""
import argparse
import json
import os
import re
import subprocess
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RENDERS_DEFAULT = os.path.join(ROOT, "blender", "c_deck_midships", "renders")
LOC = os.path.join(ROOT, "public", "images", "animations", "locations")
DATA = os.path.join(ROOT, "public", "game", "data")
LIST = os.path.join(ROOT, "scripts", "night_edit", "rendered_list_c_deck_midships.tsv")
JPG_Q, WEBP_Q, WEBP_M = 90, 90, 6

# room id -> (picture name, the renders' room names in order, the renders' folder: "3" = day/sunset/night, else one)
ROOMS = [
    # amidships, the house abaft the turbine engine casing (frames 70 to 61)
    ("doctor_c", "C Deck Doctors Room", ["Doctor"], "3"),
    ("chief_steward_c", "C Deck Chief Stewards Room", ["Chief_Steward"], "3"),
    ("restaurant_manager_c", "C Deck Restaurant Managers Room", ["Restaurant_Manager"], "3"),
    ("assistant_doctor_c", "C Deck Assistant Doctors Room", ["Assistant_Doctor"], "lamp"),
    ("stewardesses_c", "C Deck Stewardesses Room", ["Stewardesses"], "lamp"),
    ("crew_passage_c", "C Deck Crew Passage", ["Crew_Passage"], "lamp"),
    ("first_class_gents_lavatory_c", "C Deck 1st Class Gentlemens Lavatory", ["Gents_Lavatory"], "lamp"),
    ("first_class_ladies_lavatory_c", "C Deck 1st Class Ladies Lavatory", ["Ladies_Lavatory"], "lamp"),
    ("first_class_gents_bath_c", "C Deck 1st Class Gentlemens Bath", ["Gents_Bath"], "lamp"),
    ("first_class_ladies_bath_c", "C Deck 1st Class Ladies Bath", ["Ladies_Bath"], "lamp"),
    # under the forecastle, C deck's fore end
    ("seamens_mess_c", "C Deck Seamens Mess", ["Seamens_Mess"], "3"),
    ("petty_officers_c", "C Deck Petty Officers Room", ["Petty_Officers"], "3"),
    ("bosuns_mates_c", "C Deck Boatswains Mates Room", ["Bosuns_Mates"], "3"),
    ("firemens_wash_place_c", "C Deck Firemens Wash Place", ["Firemens_Wash_Place"], "3"),
    ("greasers_mess_c", "C Deck Greasers Mess", ["Greasers_Mess"], "3"),
    ("lamp_trimmer_storekeeper_c", "C Deck Lamp Trimmer and Storekeepers Room", ["Lamp_Trimmer_and_Storekeeper"], "3"),
    # first class's other public lavatories and baths: between Nos. 2 and 3 boiler casings, and forward
    ("first_class_midship_gents_lavatory_c", "C Deck 1st Class Midship Gentlemens Lavatory", ["Midship_Gents_Lavatory"], "lamp"),
    ("first_class_midship_gents_bath_c", "C Deck 1st Class Midship Gentlemens Bath", ["Midship_Gents_Bath"], "lamp"),
    ("first_class_midship_ladies_lavatory_c", "C Deck 1st Class Midship Ladies Lavatory", ["Midship_Ladies_Lavatory"], "lamp"),
    ("first_class_midship_ladies_bath_port_c", "C Deck 1st Class Midship Ladies Port Bath", ["Midship_Ladies_Bath_Port"],
     "lamp"),
    ("first_class_midship_ladies_bath_starboard_c", "C Deck 1st Class Midship Ladies Starboard Bath",
     ["Midship_Ladies_Bath_Starboard"], "lamp"),
    ("first_class_forward_ladies_lavatory_c", "C Deck 1st Class Forward Ladies Lavatory", ["Forward_Ladies_Lavatory"], "lamp"),
    ("first_class_forward_ladies_bath_port_c", "C Deck 1st Class Forward Ladies Port Bath", ["Forward_Ladies_Bath_Port"],
     "lamp"),
    ("first_class_forward_ladies_bath_starboard_c", "C Deck 1st Class Forward Ladies Starboard Bath",
     ["Forward_Ladies_Bath_Starboard"], "lamp"),
    ("first_class_forward_gents_lavatory_c", "C Deck 1st Class Forward Gentlemens Lavatory", ["Forward_Gents_Lavatory"], "lamp"),
    ("first_class_forward_gents_bath_1_c", "C Deck 1st Class Forward Gentlemens Bath One", ["Forward_Gents_Bath_1"], "lamp"),
    ("first_class_forward_gents_bath_2_c", "C Deck 1st Class Forward Gentlemens Bath Two", ["Forward_Gents_Bath_2"], "lamp"),
    ("first_class_forward_gents_bath_3_c", "C Deck 1st Class Forward Gentlemens Bath Three", ["Forward_Gents_Bath_3"], "lamp"),
    # the Purser's and two more stewardesses' rooms
    ("purser_c", "C Deck Pursers Cabin", ["Forward_Purser"], "lamp"),
    ("forward_stewardesses_c", "C Deck Forward Stewardesses Room", ["Forward_Stewardesses"], "lamp"),
    ("midship_stewardesses_c", "C Deck Midship Stewardesses Room", ["Midship_Stewardesses"], "lamp"),
    # more crew spaces under the forecastle (the bugler boys' room is not in: its pictures failed the check)
    ("firemens_entrance_port_c", "C Deck Firemens Port Entrance", ["Firemens_Entrance_Port"], "lamp"),
    ("firemens_entrance_starboard_c", "C Deck Firemens Starboard Entrance", ["Firemens_Entrance_Starboard"], "lamp"),
    ("seamens_entrance_c", "C Deck Seamens Entrance", ["Seamens_Entrance"], "lamp"),
    ("trimmers_wcs_c", "C Deck Trimmers WCs", ["Trimmers_WCs"], "3"),
    ("carpenters_shop_c", "C Deck Carpenters Shop", ["Carpenters_Shop"], "lamp"),
    ("carpenters_store_c", "C Deck Carpenters Store", ["Carpenters_Store"], "lamp"),
]
ON_PLAN = [r for r in ROOMS if r[0] != "padded_room"]       # the padded room is the moderators' cell, on no plan
KINDS = (("day", None), ("sunset", "britannic (twilight)"), ("night", "britannic (night)"))
BEGIN = "// >>> C deck amidships and under the forecastle: our own renders (scripts/images/install_c_deck_midships.py)"
END = "// <<< C deck amidships and under the forecastle"


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
