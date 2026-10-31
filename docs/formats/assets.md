# Sprite sheets — layout specification (original game, Multiplayer Gold Edition)

All measurements VERIFIED against the shipped GIFs with `tools/sprites.py` (edge-uniformity and marker-pixel checks; contact sheets in `docs/assets/*.png`, palettes in `docs/assets/*_palette.txt`, machine-readable report `docs/assets/sprite_report.json`). The rectangle table was seeded from the axx0 clone and then checked pixel by pixel; one correction found (roads row).

## Common conventions

- GIF87a, 640×480, 256-colour palette, single frame, no extensions. Palette index **253 = magenta (255,0,255) = transparent** in every sheet. Index **254 = green (0,255,0) = grid separator** in UNITS, CITIES, TERRAIN1, TERRAIN2. Index **250 = blue (0,0,255)** and **249 = orange (255,155,0)** are marker pixels placed on the separator line above/left of a cell: blue marks the flag/shield anchor, orange the city-size-box anchor. ICONS additionally uses index 255 = light pink (255,159,163) as a second transparent colour.
- Cells sit inside a 1-pixel green grid: a 64-wide cell at x=1+65·col, a 48-high cell at y=1+49·row, a 32-high tile at y=1+33·row.
- Unit/city cells are 64×48; terrain tiles are 64×32 isometric diamonds (the diamond occupies the full 64×32; corners are magenta).

## UNITS.GIF — 9 columns × 7 rows of 64×48, origin (1,1), pitch 65×49

Slot i = row i÷9, col i%9, in RULES.TXT @UNITS order (slot 0 Settlers … slot 61 Test Unit 8). Slot 62 is unused (dark gradient). Every slot has a blue marker on its top and left separator giving the shield anchor (slot 0: x=12, y=12). Extras: HP/owner shield 12×20 at (597,30); back-shields 12×20 at (586,1) and (599,1).

## CITIES.GIF

- City sprites 64×48: open cities at x=1+65·col (col 0–3), walled cities at x=334+65·col (col 0–3); rows y=39+49·row, row = city style 0–5 (RULES @LEADERS style 0–3 = Bronze Age, Classical, Far East, Medieval; rows 4–5 = later eras, INFERRED: Industrial, Modern). Columns = city size class, growing left to right. Each cell carries both markers: blue = flag anchor, orange = size-box anchor (e.g. open style 0 col 0: flag (31,30), size (12,22)).
- Player text colours: nine 14×1 strips at (1+15·c, 423). Flags: 14×22 at (1+15·c, 425) and (1+15·c, 448), c=0–8 (9 colour sets: 7 civs + barbarian + extra; order INFERRED to follow RULES colour ids).
- Fortified-unit overlay (143,423) · Fortress (208,423) · Airbase empty (273,423) · Airbase occupied (338,423), all 64×48.

## TERRAIN1.GIF — base terrain, 64×32 tiles

- Rows y=1+33·r, r = terrain id 0–10 in RULES @TERRAIN order (Desert, Plains, Grassland, Forest, Hills, Mountains, Tundra, Glacier, Swamp, Jungle, Ocean). Columns: x=1 base tile · x=66 alternate base tile · x=131 special resource 1 · x=196 special resource 2 (RULES @TERRAIN specials pair). Forest/Hills/Mountains rows are labelled "base filler" in-sheet: their visible relief comes from TERRAIN2 overlays.
- Roads: nine 64×32 tiles at (1+65·c, **364**) — the clone's table says 363; the pixel check shows 363 is the green separator and 364 is correct (9/9 top and bottom edges uniform at 364, 3/9 at 363). Railroads: nine at (1+65·c, 397). Index 0 = isolated segment, 1–8 = connection toward each of the 8 neighbours (INFERRED from count; to confirm in exe).
- Single tiles, column x=456: Irrigation y=100 · Farmland y=133 · Mine y=166 · Pollution y=199 · Grassland shield resource y=232 · Hut y=265.
- Bottom row y=447: Dither mask (1,447) · Mouse cursor tile (66,447) · Blank/black diamond (131,447) · second cursor (196,447) (labels drawn in-sheet: "Dither", "Mouse", "Blank", "Mouse 2").
- Upper-right block x≈390–520, y≈0–100: additional resource/special art (not yet mapped — TODO).

## TERRAIN2.GIF — overlays, 64×32, 8 columns × 2 rows per group, x=1+65·c

Coast/land connection y=1,34 · Rivers y=67,100 · Forest y=133,166 · Mountains y=199,232 · Hills y=265,298 · River mouths (4) y=331. Each 16-tile group is indexed by the 4-bit N/E/S/W neighbour mask (INFERRED; the original game's standard scheme, to confirm in the executable). Coastline quarter-tiles 32×16: eight columns at x=1+66·i, rows y=429 (N), 446 (S), 463 (W) and x=34+66·i, y=463 (E).

## ICONS.GIF (no green grid; magenta and light-pink backgrounds)

Improvement icons 36×20 at (343+37·c, 1+21·r), 8 per row, 39 total in RULES @IMPROVE order · Wonder icons 36×20 at (343+37·c, 106+21·r), 7 per row, 28 total · Advance-category icons 36×20 at (343+37·c, 211+21·r), 5 per row × 4 · View-piece cursor (199,256,64,32) · Grid overlays (183,430) and (248,430) 64×32 · Battle animation 8 frames 32×32 at (1+33·c, 356) · Big 14×14 icons at (1|16|31, 290|305|320) · research progress 4× at (49+15·c,290) · global warming 4× at (49+15·c,305) · small 10×10 at (49|60|71, 334) · window buttons 16×16 at (1|18|35, 389) · city prev/next arrows 18×24 at (227|246, 389) · panel wallpaper outer (199,322,64,32), inner (298,190,32,32).

## PEOPLE.GIF — citizen faces 27×30, 11 columns × 4 rows at (2+28·c, 6+31·r)

Rows = era (INFERRED: Ancient, Renaissance, Industrial, Modern). Columns (INFERRED, the original game's standard layout): 0–1 happy, 2–3 content, 4–5 unhappy (male/female alternating), 6–7 ?, 8 entertainer, 9 tax collector, 10 scientist. Black 1-px frame around each face instead of a green grid.

## CITY.GIF (640×480) — city-screen wallpaper; the clone uses the 636×421 top-left region. EDITOR*.GIF — map-editor toolbars. SCREDITS.GIF (600×400) — credits background.

## Images inside DLLs

Tiles.dll, Intro.dll, pv.dll, cv.dll, Wonder.dll, Civ2Art.dll carry bitmaps as Win32 resources (throne room, advisors' backgrounds, intro pictures, city view). The clone addresses them by raw file offset + length; Phase 3b will enumerate them properly from the PE resource tree.

## Palette and fill colours (VERIFIED)

- The six sprite sheets share one palette to within 3–7 entries (UNITS vs CITIES 253/256 identical, TERRAIN1/2 249/256, ICONS and PEOPLE 252/256). CITY.GIF (wallpaper) has its own palette (71/256 shared). A new engine can treat the sheets as true-colour and ignore palette indices entirely; only the three special colours matter.
- UNITS cells: outside the 64×32 magenta diamond footprint the corners are filled with purple (135,83,135), index 255. Both magenta and this purple are non-sprite fill and must be keyed out — VERIFIED by rendering: with only magenta keyed, every unit sits in a purple box.
- Dither mask tile (1,447): black (0,0,0), magenta and gray (135,135,135) — the game blends neighbouring terrain across tile edges using this mask. Blank tile (131,447): black diamond on gray.

## Choosing a city sprite (INFERRED, from the community reimplementation; drawn by the viewer so it can be judged by eye)

- Row = the civilization's style 0–3 from RULES.TXT @LEADERS, replaced by row 4 once the civilization is in the Industrial era and row 5 in the Modern era (era = highest epoch among known advances).
- Column by size: rows 0–3: ≤3 → 0, ≤5 → 1, ≤7 → 2, else 3. Row 4: ≤4, ≤7, ≤10, else 3. Row 5: ≤4, ≤10, ≤18, else 3. A city holding the Palace moves one column up (max 3).
- Walled variant (x = 334 + 65·col) when the city has City Walls.
- The blue marker gives the flag anchor (flag drawn with its bottom 5 px below the anchor), the orange marker the size-box anchor.
