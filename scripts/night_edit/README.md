# Night and sunrise/sunset versions of the game's exterior pictures (2026-11-16, 2026-11-17)

The game's exterior location pictures (`public/images/animations/locations/britannic/`) are day screenshots. These
scripts make night versions of them by editing, for a test: the user's direction of 2026-11-16 ("edit them really good
and take into account for lights and stuff. you cant add any lights earlier"), then "just keep improving until its
essentially perfect". Renders go to `work/out/` (night) and `work/twilight/` (sunrise/sunset); `export_sets.py` puts
them in the game (2026-11-17, the user: "do sunset/sunrise (id just do a universal one for that) ... then apply them to
the game").

## Running

- `depth.py` (in the private venv `C:/Users/JTP20/AppData/Local/rbvrpg-night/venv`, with `HF_HOME` set to
  `.../rbvrpg-night/hf`): Depth Anything V2 Small (Apache-2.0), relative depth of each picture to `work/depth/<name>.disp.npy`.
- `night4.py <day.png> <out.png> ann/<name>.json <debug_dir>`: one picture; with `TOD=twilight` in the environment, its
  sunrise/sunset version (one set serves both).
- `sh run_tod.sh <script> <out_dir> <name> ...`: the same through any copy of the renderer (for trying changes).
- `sh run_set.sh <out_dir> <name> ...`: several; `PAR=4 sh run_stale.sh work/out`: every picture whose output is missing or
  older than its annotation or the code, four at a time.
- `review.py`, `quad.py`, `grid.py`, `sheet.py`: contact sheets and gridded crops for checking and placing things.
- `exterior_list.tsv`: the 133 exterior pictures the game uses, by room (from `public/game/data/roomImages.js`).
- `export_sets.py`: `work/out` -> `public/images/animations/locations/britannic (night)/<name>.webp`, `work/twilight` ->
  `britannic (twilight)/<name>.webp` (WebP q 90), then `make_tod_manifest.py` writes `public/game/data/timeOfDayImages.js`
  (the list, the folders, and which set shows for the sun's altitude: night below -5 deg, sunrise/sunset up to 9 deg).

## What night4.py does

1. **The mask.** The sky and the sea are replaced; the ship is kept. Sky and sea are found by colour (blue, and clouds
   flooded from the sky), then checked against the depth map: above the horizon anything at a distance is ship (the model
   gives the sky distance zero), below it anything not blue or nearer than the sea at that row is ship. The edge is matted
   pixel by pixel with a two-colour model, so rails and rigging keep their own colour.
2. **The horizon** (fitted to the sky/sea step) and every pixel's elevation (the renders' 70 degree vertical field).
3. **The sun.** Under deckheads ('covered') its patches are taken off by material; on open decks its shadows stay as the
   moon's.
4. **Moonlight**: darker, desaturated, blue in shade, silver in the light.
5. **The ship's own lights, only those the picture shows** (annotation): lamps (a glowing lens or core, bloom, light
   cast in 3D from the depth map: falling off with distance, following the surfaces' slope, shadowed by what stands
   between), lit window glass inside marked zones (shaped glow, each window its own level, some blinds), interiors seen
   through open doors, and their light on the deck and walls.
6. **The night outside**: the game's own night sky colours (`game.js` SKY_PALETTES.night) by elevation, stars, clouds
   re-lit, the game's moon (`public/images/moon phase/full.webp`) where the sun stood, the sea mirroring the sky with the
   picture's own waves and a moon path.

Added 2026-11-17 (the user: round windows lit "even if the door is open to the room its connected to ... it just looks
ai generated ... you need to properly outline everything"):
- **Round windows** (`ports.py`, annotation `ports`): each fitted to its own glass in the day picture (flood fill,
  edge RANSAC, or the blue of sky-mirroring glass; all 46 checked on gridded zooms, misplaced guesses moved or dropped)
  and given a state: `on` (a cabin's light), `room` (a door's frosted glass with a lit room behind: dim, darker below,
  no glare), `off` (a door standing open: dark glass). Things in front of the glass (rails, posts, rope) are left out.
- **Rooms seen through doors**: never sky (their white ceilings had become cloud); their far windows show the night;
  their light comes out of the opening (the wall round the door gives its depth and facing), softened by the opening's
  size, so no hot spots on jambs; lit glass and rooms take none of the deck's light.
- **Panes** are softened inside and shaded towards their frames (a lit window reads as glass in a wall).
- **Rigging** against the sky (stays, rope ladders, wires) is found as thin dark lines and kept as rope; the sky flood
  had taken it.
- **The far sea** (found by the sunset set: a speckled dark island under a low sun): a calm hazy sea reads green over
  red 0.06, on the sea-colour test's edge, and the depth model puts the horizon line a little nearer than the sky (so
  the sky's depth veto took it). Below and along the horizon, far (depth under 0.25-0.30) and blue is sea, except thin
  lines darker than the sea round them (wires crossing it).
- **Funnel smoke** (also taken with the sky): its cover is how far the day pixel moved from the clear sky towards smoke
  grey (clouds move towards white); laid back over the new sky, near black at night, grey-brown at sunrise/sunset.
- **Sunrise/sunset** (`TOD=twilight`): the day's light at each pixel split into the sun's share (the picture over its
  material's albedo) and the sky's, each recoloured (white sun -> low orange sun, blue-white sky -> dusk violet) as a
  ratio on the picture, decks taking less of a low sun than walls; the sun's patches under deckheads kept; the sky in
  the game's sunset palette by elevation, the sun 3 deg up where the day's stood (or its glow on the brighter side),
  clouds lit from below (gold low, rose higher), the sea mirroring it with a glitter path, far parts in haze; the ship's
  lights at 40 percent.

Second round 2026-11-17 (the user, of 1st A port prom1 at night: "look at this lmao. install whatever you need ...
we can do a lot better": a tall window lit in its lower half, sparkles along a door, night sky splashed on the deckhead):
- **Glass is very dark or clearly coloured** (a test for glass also passed white paint in shade, darker than the sunlit
  wall: a beam under the deckhead was lit as a ragged pane, the "splash"); very dark navy passes whatever its
  saturation (0.95 at the top of the tall pane, which split it); a zone reaching the picture's edge no longer rejects
  glass touching that edge; panes found inside white frames must be glass too, and 80 px or more (no bolts).
- **Windows show a room**, not a flat panel, where the day picture showed nothing behind the glass (judged by fine
  detail, not spread: a sky gradient is no content): a lit ceiling band with its lamp, walls, darker furniture below,
  curtains drawn back in soft folds, each window its own; windows seen at a glance lose their glow to reflection
  (Fresnel, from the depth model's normals).
- **Frosted glass in wooden frames** is lit whole: whatever a wooden frame encloses is its glass (the frosted
  pattern's bright flecks had failed the pixel tests and left dark holes); its day pattern is softened and its
  darkest specks lifted (lit from behind such glass glows on the whole); lit specks under 60 px outside the fine
  zones are dropped.
- **Specks** under deckheads at night (slivers the day's sun lit, too thin for the sun-patch pass) are brought down to
  what is round them.
- **SAM 2.1 regions** (`sam_seg.py`, Hiera-Large, Apache-2.0; GPU venv `C:/Users/JTP20/AppData/Local/rbvrpg-night/
  venv-gpu`: torch 2.14.1+cu130, torchvision 0.29.1, transformers 5.23; about 20 s a picture on the RTX 3060, which the
  user also games on) make the pixel tests' glass whole per region and drop specks in regions that are not glass, and
  take back sky that crept into a mostly-ship region where the depth model says near (`sam_rules.py`). Used where
  `work/sam/<name>.sam.png` exists (so far 1st A port prom1 only: the pixel fixes above carried the rest).
- Tried and dropped: OneFormer ADE20K semantic classes (on these renders it calls windows "wall"; its ceilings are
  right but coarse at the edges, so vetoes from them cut window tops and cracked the sky seen through screens).

## Checking the ship's outline (the mask)

- `sh run_masks.sh work/masks` (or `run_masks_list.sh work/masks <names file>`): the mask only of every picture
  (`MASK_ONLY=1`), `work/masks/<name>.mask.png` (white = sky and sea replaced, black = ship kept).
- `outline_sheets.py work/masks <prefix> [names]`: each day picture with what will be replaced tinted magenta and its
  border in yellow. Ship tinted magenta is a leak; sky or sea left untinted is a miss.
- `ann_sheets.py <prefix> [names]`: every annotation drawn on its picture (zones cyan, lit orange, interiors green, lamps
  yellow, horizon yellow line). `ann_check.py`: real sky (depth zero, sky coloured) inside zones.
- Rules the checks led to: below the horizon only sea colour is outside (a white roof or green winch seen against the
  sea is ship), and the sea's dark wave troughs are flooded from the sea through sea colour; above it the depth model
  vetoes ship parts (the sky is at zero), except clear blue seen through glass when the camera is under a deckhead
  (`through_glass`); window zones, lit shapes and interiors never claim depth-zero sky; pictures with no sea line take
  their horizon from the annotation (`horizon`, set by eye).

## Annotations (`ann/<name>.json`)

`horizon`, `through_glass`, `covered`, `fill`, `lamps` ({p, k: ceiling|wall|post|point, lens / lens_ell, s, h}), `zones` / `zones_fine` (window glass
lit inside), `lit` / `lit_blue` / `dark`, `ports` ({c: [x, y, r] or [x, y, rx, ry, deg] | poly: [...], m: on|room|off}),
`interior`, `sky` (where to look for sky in a room's far window) / `not_sky` / `sky_cand`, `sun` / `moon`, `exposure`.
Every lamp was checked at full size (two first marked were boat davits). Backup of the annotations before the ports
work: `work/ann_backup_2026-11-17/` (with the renderer before it); `work/convert_ports_2026-11-17.py` made the change.

## In the game (2026-11-17)

`public/game/game.js` shows a location's picture from the set for the sun's real altitude (as the sky's colours use it;
the hour before the celestial layer is up): `locationTimeOfDay()` and `britannicImagePath()`, used on entering a room,
by the refresh button, by the preloader and every second as the sun moves; a missing version falls back to the day
picture. `window.forceSetRoomVariant("night" | "twilight" | "day")` forces a set for testing (null follows the sun). The
old AI-made sunset set in `britannic (sunset)` (1376 x 768, titles burnt in) and the `variants` lists in
`roomImages.js` that pointed at it are no longer used; the folder is left as it was.

## Not done

- Daytime rail and davit shadows stay as hard shadows (the moon's at night, a high sun's at sunset).
