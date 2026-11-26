"""Writes public/game/data/timeOfDayImages.js: the exterior pictures that have night and sunrise/sunset ("twilight")
versions (exterior_list.tsv), and the game's rules for which set shows. Run after exporting the sets (export_sets.py)."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
names = [l.rstrip("\n").split("\t")[1] for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
# rooms whose night and sunrise/sunset pictures are our own renders, not edits (scripts/images/install_officers_house.py)
RENDERED = os.path.join(HERE, "rendered_list.tsv")
if os.path.exists(RENDERED):
    names += [l.rstrip("\n").split("\t")[1] for l in open(RENDERED, encoding="utf-8") if l.strip()]
for tod, folder in (("night", "britannic (night)"), ("twilight", "britannic (twilight)")):
    d = os.path.join(ROOT, "public", "images", "animations", "locations", folder)
    missing = [n for n in names if not os.path.exists(os.path.join(d, os.path.splitext(n)[0] + ".webp"))]
    if missing:
        sys.exit("%s: %d missing, e.g. %s" % (folder, len(missing), missing[:3]))
body = ",\n".join("    " + json.dumps(n) for n in names)
js = r"""// Night and sunrise/sunset versions of the Britannic's exterior location pictures, made from the day pictures
// (scripts/night_edit; written by make_tod_manifest.py). Sunrise and sunset share one set ("twilight"). A version has
// the day picture's name with a .webp extension, in its own folder beside images/animations/locations/britannic.
// After them come the rooms rendered in all three lights (rendered_list.tsv): the officers' house on the boat deck.
(function (RBV) {
  const FOLDERS = { night: "britannic (night)", twilight: "britannic (twilight)" };
  const NAMES = [
%s,
  ];
  const have = new Set(NAMES);

  // The set for the sun's altitude in degrees: night below -5 (from nautical twilight on, as the sky's ms-4, ms-5 and
  // night palettes), sunrise/sunset up to 9 (the low sun of ms-3 to ms-1), day above
  function forSunAltitude(alt) {
    if (alt < -5) return "night";
    if (alt < 9) return "twilight";
    return "day";
  }

  // The same from the sky's hourly palette name, for before the celestial layer knows the sun
  function forPalette(name) {
    if (!name || name === "day") return "day";
    if (name === "night" || name === "ms-5" || name === "ms-4") return "night";
    return name.startsWith("ms") ? "twilight" : "day";
  }

  // A Britannic location picture's path in a time of day's set; the day picture's where the set has no version
  function path(imageName, tod) {
    if (tod && tod !== "day" && FOLDERS[tod] && have.has(imageName)) {
      const webp = imageName.replace(/\.(png|jpe?g)$/i, ".webp");
      return `/images/animations/locations/${FOLDERS[tod]}/${webp}`;
    }
    return `/images/animations/locations/britannic/${imageName}`;
  }

  RBV.data = RBV.data || {};
  RBV.data.timeOfDayImages = { FOLDERS, NAMES, forSunAltitude, forPalette, path };
})(window.RBV);
""" % body
out = os.path.join(ROOT, "public", "game", "data", "timeOfDayImages.js")
open(out, "w", encoding="utf-8", newline="\n").write(js)
print("wrote", out, len(names), "pictures")
