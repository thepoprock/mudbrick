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

| byte | bits | meaning                                                                         | status                                                     |
| ---- | ---- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 0    | 0–3  | terrain index into @TERRAIN: 0 Desert … 10 Ocean                                | VERIFIED (range over all files, land/sea ratios plausible) |
| 0    | 6    | "has special resource" flag — the game actually derives specials from a formula | INFERRED                                                   |
| 0    | 7    | river                                                                           | INFERRED                                                   |
| 1    | 0    | unit present                                                                    | INFERRED                                                   |
| 1    | 1    | city present                                                                    | INFERRED                                                   |
| 1    | 2    | irrigation (with bit 3 also set: farmland)                                      | INFERRED                                                   |
| 1    | 3    | mine (with bit 2 also set: farmland)                                            | INFERRED                                                   |
| 1    | 4    | road                                                                            | INFERRED                                                   |
| 1    | 5    | railroad (only meaningful with bit 4)                                           | INFERRED                                                   |
| 1    | 6    | fortress (with bit 1 also set: airbase)                                         | INFERRED                                                   |
| 1    | 7    | pollution                                                                       | INFERRED                                                   |
| 2    | all  | which civilization's city radius covers the square                              | INFERRED                                                   |
| 3    | all  | land-mass / water-body id                                                       | INFERRED                                                   |
| 4    | 0–7  | square has been seen by civilization slot n                                     | INFERRED                                                   |
| 5    | 0–3  | AI fertility rating                                                             | INFERRED                                                   |
| 5    | 4–7  | ownership                                                                       | INFERRED                                                   |

The byte-1 bit meanings are the same ones the save-game format uses for its terrain block; the
save-file work will verify them against real games with cities, roads and pollution. The
INFERRED rows come from the community-maintained reimplementation's reader and from editor
behaviour; they are consistent with the files but have not been exercised yet.
