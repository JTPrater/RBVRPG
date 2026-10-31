# Deck maps

The in-game deck maps (`public/images/decks/<deck>.jpg`) are redrawn from Harland & Wolff's
1914 general-arrangement drawings for yard No. 433, Britannic, as dark ink on white,
3200 px wide. The clickable room outlines in `public/game/data/deckRooms.js` are fitted to
the walls of those maps.

Needs Python 3 with `numpy`, `opencv-python` and `pillow`. Run the scripts from the
repository root. Scratch output goes to `scripts/deckmaps/work/`, which git ignores.

## Redraw the maps

```
python scripts/deckmaps/redraw_decks.py --scans "C:/Users/JTP20/Downloads"
```

The scans are `0_Profile_Tank_Top.jpg`, `1_Boat_Deck.jpg`, `2_A_Deck_B_Deck.jpg`,
`3_C_Deck_D_Deck.jpg`, `4_E_Deck_F_Deck.jpg` and `5_G_Deck_Orlop_Deck.jpg`.

The script crops each deck, flattens the linen and straightens the drawing on its red
centreline. It drops the deck titles and title stamp, then writes all nine maps (boat to
tank top). Name decks to redo only those, e.g. `... redraw_decks.py a_deck b_deck`.

Redrawing changes the maps' pixel geometry, so refit the room outlines afterwards.

## Refit the room outlines

```
python scripts/deckmaps/room_outlines.py --check
python scripts/deckmaps/room_outlines.py
```

`room_overrides.json` says which wall-bounded spaces make up each clickable room. Its
coordinates are pixels on the 3200 px maps. The full list of keys is at the top of
`room_outlines.py`.

The script grows each outline to the wall centrelines and resolves overlaps (the smaller
room wins). It keeps every room a single SVG polygon. It then writes the coordinates, the
markers and the decks' view boxes into `deckRooms.js`.

`--check` only renders previews to `work/<deck>.png`. It reports how many rooms would
change.

To add or move a room, find its spaces with:

```
python scripts/deckmaps/show_spaces.py a_deck 2590 90 3080 480
python scripts/deckmaps/grid_zoom.py a_deck 2590 90 3080 480
```

Put the seed points in `room_overrides.json`, check, then write.

Choices worth knowing:

- Boundaries follow the 1914 drawing.
  - The boat-deck officers' promenades start at the barriers.
  - The bridge, its wings and the wheelhouse are separate rooms.
  - The B-deck poop deck runs forward to the rail at the second-class promenade.
- The forward A-deck cabins A1–A23 map in order onto the drawing's cabins.
  - Odd numbers are starboard and even numbers port.
  - A1/A2 are the two-berth rooms at the bow; A3/A4 are the three-berth corner rooms.
- Only the port A-deck verandah is the Palm Court room. The starboard verandah is left out of
  the promenade rather than mislabelled.
