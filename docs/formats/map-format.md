# `.MP` map file format

Preset worlds (`WORLD.MP`, `WORLD_M.MP`, `WORLD_S.MP`, `EUROPE.MP`, `GREECE.MP`, `MEDITERR.MP`,
`PACIFIC.MP`) and the maps shipped inside scenario folders. All eleven shipped files parse with
`packages/formats/src/map.ts`; the conformance test in `packages/formats/test/map.test.ts`
checks every one of them. Little-endian throughout.

## Coordinate system (VERIFIED by the file sizes and the editor's locator fields)

The world is an isometric grid. A square exists only where `x + y` is even. A map advertised
as 150×120 therefore has 75 stored columns per row and 9000 squares, not 18000.

- Stored row `y`, stored column `c` ⇄ game square `x = 2c + (y mod 2)`, `y`.
- Storage order: row-major, `index = y × columns + c`.

## Layout

| offset | size     | field                                                                                            |
| ------ | -------- | ------------------------------------------------------------------------------------------------ |
| 0      | u16      | width in game coordinates (= 2 × stored columns) — VERIFIED                                      |
| 2      | u16      | height (rows) — VERIFIED                                                                         |
| 4      | u16      | area = width × height / 2 — VERIFIED (all 11 files)                                              |
| 6      | u16      | flat earth flag: 0 round, non-zero flat — VERIFIED                                               |
| 8      | u16      | resource seed; 64 patterns (mod 64); 0 or 1 → the game picks randomly — INFERRED (community)     |
| 10     | u16      | minimap (locator) width = ceil(width / 4) — VERIFIED                                             |
| 12     | u16      | minimap height = ceil(height / 4) — VERIFIED                                                     |
| 14     | 21 × u16 | start X per civilization, in RULES.TXT @LEADERS order; 0xFFFF = none — VERIFIED (bounds, parity) |
| 56     | 21 × u16 | start Y, same order — VERIFIED                                                                   |
| 98     | area × 6 | square records (below)                                                                           |

Total size is always `98 + 6 × area` (54098 bytes for 150×120, 24098 for 100×80, 12098 for
80×50).

## Square record (6 bytes)

| byte | bits | meaning                                                                                                                                                                                                                               | status                                                                                                         |
| ---- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 0    | 0–3  | terrain index into @TERRAIN: 0 Desert … 10 Ocean                                                                                                                                                                                      | VERIFIED (WORLD.MP renders as Earth: polar Glacier, Saharan Desert, Ocean; `scripts/render-map.ts`)            |
| 0    | 6    | "has special resource" flag — the game actually derives specials from a formula                                                                                                                                                       | INFERRED                                                                                                       |
| 0    | 7    | river                                                                                                                                                                                                                                 | VERIFIED (roads need Bridge Building here; rendered rivers trace real river systems in WORLD.MP and EUROPE.MP) |
| 1    | 0    | unit present                                                                                                                                                                                                                          | INFERRED                                                                                                       |
| 1    | 1    | city present (set on founding; the move handler treats it as road and railroad). With bit 6: airbase                                                                                                                                  | VERIFIED                                                                                                       |
| 1    | 2    | irrigation (with bit 3 also set: farmland)                                                                                                                                                                                            | VERIFIED (work completion sets them so)                                                                        |
| 1    | 3    | mine (with bit 2 also set: farmland)                                                                                                                                                                                                  | VERIFIED                                                                                                       |
| 1    | 4    | road                                                                                                                                                                                                                                  | VERIFIED                                                                                                       |
| 1    | 5    | railroad (set together with bit 4)                                                                                                                                                                                                    | VERIFIED                                                                                                       |
| 1    | 6    | fortress (with bit 1 also set: airbase)                                                                                                                                                                                               | VERIFIED                                                                                                       |
| 1    | 7    | pollution                                                                                                                                                                                                                             | VERIFIED (cleaning clears it and lowers the world count)                                                       |
| 2    | 5–7  | civilization slot whose city radius claims the square, 0 none: set on the 21 radius squares when a city is founded, cleared when it is removed, re-marked for the remaining cities                                                    | VERIFIED (0x0055a169 writes bits 5–7, 0x00559010 reads them; 0x0042e7f6, 0x004aeab6)                           |
| 2    | 0–4  | unknown                                                                                                                                                                                                                               | —                                                                                                              |
| 3    | all  | land-mass / water-body id                                                                                                                                                                                                             | INFERRED                                                                                                       |
| 4    | 0–7  | square has been seen by civilization slot n                                                                                                                                                                                           | VERIFIED (0x00559085; the AI's exploration terms read it)                                                      |
| 5    | 0–3  | fertility rating: 0 unrated; the map maker rates plains and grassland 8–15 from the radius yields (0x0040291f, see below); founding a city takes 8 off the 45 squares around it (0x0042e7f6), removing one gives it back (0x004aeab6) | VERIFIED (engine `fertility.ts`; exact match on the shipped fresh game)                                        |
| 5    | 4–7  | owner of the unit or city standing on the square, 15 none                                                                                                                                                                             | VERIFIED (0x00558f3d reads, 0x00559f08 writes)                                                                 |

The byte-1 bit meanings are the same ones the save-game format uses for its terrain block; the
save-file work will verify them against real games with cities, roads and pollution. The
INFERRED rows come from the community-maintained reimplementation's reader and from editor
behaviour; they are consistent with the files but have not been exercised yet.

## Visual check

`npx vite-node scripts/render-map.ts WORLD.MP world.png` draws the map with the debug palette. The seven preset maps render as the recognisable regions their names promise, with rivers and start positions on land, which is the evidence behind the VERIFIED labels above. Improvement bits (byte 1) cannot be checked on preset maps because they carry none; the save-file work will cover them.

## The fertility rating (byte 5, low nibble) — VERIFIED, 0x0040291f

Computed once when a map is made, for plains and grassland squares only. Each terrain `t` (and
each terrain with its first special, at `t + 11`) gets a value `3 × food + trade`, plus
`2 × shields` except for grassland, plus 3 when hills can be mined, 1 when any other terrain can
be mined, else 2 when it can be irrigated. The square's total sums its 21 radius squares: a
grassland square with the shield pattern adds 2, a square with a special uses the `t + 11`
value (the centre never does), a river adds 1; the eight neighbours count double, the centre
four times (six with a river), the outer twelve once. A grassland centre without the shield
loses 16. The rating is `clamp((total − 120) >> 3, 1, 15) >> 1`, plus 8 — so a rated square
is 8–15 and everything else 0. The map maker also counts rated squares per land mass (the AI's
"land mass value", 0x5ead52). Founding a city clears bit 3 on the 45 squares around it (the 21
radius squares, the four squares four steps along the axes, and a ring of twenty at distance
three to five), which the AI's land value reads as the minimum site value 8; the 21 radius
squares also take the owner in byte 2. Removing a city sets bit 3 back on its 45 land squares
(so never-rated land there becomes a minimum site too), clears the territory it owned, and
re-marks every remaining city. The engine reproduces the shipped fresh game's ratings and
territory exactly (`apps/web/test/fertility.conformance.test.ts`).
