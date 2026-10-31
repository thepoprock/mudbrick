# Save and scenario file format (`.SAV`, `.SCN`, `.HOT`, `.NET`)

One container format with a version byte. The shipped edition contains 42 files: `TUTORIAL.SAV`,
`ROME.SCN`, `WWII.SCN` and 39 scenario files, 31 of them version 39 and 11 version 40. All 42
walk correctly with the layout below: every plain save ends exactly 338 bytes after the last
fixed block (the destroyed-civilizations block) and every scenario exactly 438 (that block plus
the 100-byte scenario parameters), and the first city in every file decodes to a real name
(Rome, Berlin, Pella, Tokyo, Kyoto …). That is the evidence behind the VERIFIED labels on the
_structure_. Field _meanings_ inside records are largely INFERRED from the community
reimplementation's reader until a test or the running game confirms them; each row says which.

Little-endian throughout. Strings are NUL-terminated inside fixed-width fields, Windows-1252.

Versions: 39 = the first expansion era (CiC), 40 = the second expansion (FW), 44 = Multiplayer
Gold Edition, > 44 = Test of Time (different layout, **not covered here**). No shipped file is
version 44, so the MGE-specific record sizes are INFERRED from the community reader.

## Fixed part

| offset       | size             | field                                                                   | status            |
| ------------ | ---------------- | ----------------------------------------------------------------------- | ----------------- |
| 0            | 8                | magic `CIVILIZE`                                                        | VERIFIED          |
| 8            | 2                | `00 1A`                                                                 | VERIFIED          |
| 10           | 1                | version (39, 40, 44, …)                                                 | VERIFIED          |
| 12           | 12               | options bit-field (table below)                                         | INFERRED          |
| 24           | 42               | game parameters (table below)                                           | partly            |
| 66           | T                | per advance: id of the civilization that discovered it first            | INFERRED          |
| 66 + T       | T                | per advance: bit n = civilization slot n knows it                       | INFERRED          |
| 66 + 2T      | 28 × i16         | per wonder (RULES @IMPROVE order from 39): city id, −1 none, −2 lost    | INFERRED          |
| W + 318      | 7 × 242          | civilization names (slots 1–7; slot 0 = barbarians, not stored)         | INFERRED          |
| C            | 8 × S            | civilization records (slot 0 = barbarians)                              | partly            |
| M            | 14               | map header                                                              | VERIFIED          |
| M + 14       | 7 × area         | per civilization slot 1–7: what it has seen on each square (bits)       | INFERRED          |
| M + 14 + 7a  | 6 × area         | square records, same 6-byte layout as `.MP` files                       | VERIFIED          |
| M + 14 + 13a | 2 × lx × ly      | unknown (minimap-sized)                                                 | VERIFIED size     |
| … + 1024     | 1024             | unknown                                                                 | VERIFIED size     |
| U            | n_units × 26/32  | unit records                                                            | VERIFIED size     |
| C₂           | n_cities × 84/88 | city records                                                            | VERIFIED size     |
| T₂           | 63               | 21 × 3 bytes; byte 1 of each triple = cities founded by that tribe      | INFERRED          |
| O            | 4                | cursor square x, y (i16)                                                | INFERRED          |
| O + 4        | 48 × humans      | one 48-byte block per human player                                      | VERIFIED size     |
| … next       | 1200             | power-graph history: 150 records × 8 civs, one byte each, every 4 turns | INFERRED          |
| … next       | 110              | unknown                                                                 | VERIFIED size     |
| O + Oo       | 76               | clicked square x, y (i16), zoom (i16, −7 … +8), 70 unknown              | INFERRED          |
| O + Oo + 76  | 100 (optional)   | scenario parameters, present in `.SCN` and saves derived from them      | VERIFIED presence |
| then         | 338              | destroyed civilizations                                                 | VERIFIED size     |
| then         | optional         | `EVNT` block (scenario events compiled from events.txt)                 | not parsed yet    |

where `T` = 93 for version 39 and 100 from version 40; `W` = 66 + 2T (252 / 266);
`C` = W + 56 + 1694 (2264 / 2278); `S` = 1396 (v39) / 1428 (v40, v44);
`M` = C + 8S (13432 / 13702); `a` = map area; `lx`, `ly` = minimap size from the map header;
`Oo` = 48 × humans + 1314; unit record 26 bytes for v ≤ 40 and 32 for v44; city record 84 / 88.

### Options (offset 12), bit = set unless noted

| byte | bit | option                                                                                                                                                                                                                     |
| ---- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | 4   | simplified combat **off** (bit clear = on)                                                                                                                                                                                 |
| 0    | 7   | bloodlust                                                                                                                                                                                                                  |
| 1    | 0   | don't restart if eliminated                                                                                                                                                                                                |
| 1    | 7   | flat earth                                                                                                                                                                                                                 |
| 2    | 3–7 | music, sound effects, grid, Enter closes city screen, move units without mouse                                                                                                                                             |
| 3    | 0–7 | tutorial help, instant advice, fast piece slide, no pause after enemy moves, show enemy moves, autosave each turn, always wait at end of turn, cheat menu                                                                  |
| 4    | 0–5 | wonder movies, throne room, diplomacy screen graphics, encyclopedia on new advance, high council, animated heralds                                                                                                         |
| 8    | 4–7 | cheat penalty disabled, scoring complete, this is a scenario file, scenario flag toggled                                                                                                                                   |
| 10   | 0–7 | **clear = on**: warn city growth halted, show improvements built, show non-combat units built, show invalid build instructions, announce disorder, announce order restored, announce "we love the king" day, warn food low |
| 11   | 0–2 | **clear = on**: warn pollution, warn production change costs shields, zoom-to-city is not default                                                                                                                          |

### Game parameters (offset 24)

| +   | size | field                                                                                                                         | status                                                              |
| --- | ---- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 0   | 1    | bits: 1 first air unit built, 2 first naval, 4 first caravan, 5 Republic/Democracy ever adopted, 6+7 first badly damaged unit | INFERRED                                                            |
| 4   | u16  | turn number                                                                                                                   | VERIFIED (plausible in all files: 0, 1, 6, 7, 101, 151, 201)        |
| 6   | u16  | turn number used for the game-year calculation                                                                                | INFERRED                                                            |
| 10  | u16  | selected unit index (0xFFFF none)                                                                                             | INFERRED                                                            |
| 15  | 1    | human player's civilization slot                                                                                              | INFERRED                                                            |
| 16  | 1    | whose map is shown                                                                                                            | INFERRED                                                            |
| 17  | 1    | player's civilization number (RULES @LEADERS index)                                                                           | INFERRED                                                            |
| 19  | 1    | map revealed (1)                                                                                                              | INFERRED                                                            |
| 20  | 1    | difficulty 0–5                                                                                                                | INFERRED                                                            |
| 21  | 1    | barbarian activity                                                                                                            | INFERRED                                                            |
| 22  | 1    | bit n = civilization slot n is in play                                                                                        | INFERRED                                                            |
| 23  | 1    | bit n = slot n is human (multiplayer)                                                                                         | VERIFIED (count drives the block arithmetic that matches all files) |
| 27  | 1    | global temperature rise count                                                                                                 | INFERRED                                                            |
| 30  | u16  | pollution squares                                                                                                             | INFERRED                                                            |
| 32  | 1    | turns of peace                                                                                                                | INFERRED                                                            |
| 34  | u16  | number of units                                                                                                               | VERIFIED (block arithmetic)                                         |
| 36  | u16  | number of cities                                                                                                              | VERIFIED (block arithmetic)                                         |

### Civilization names (7 × 242 bytes, slots 1–7)

`+0` city style · `+2` leader (24) · `+26` tribe plural (24) · `+50` adjective (24) · `+74 … +218`
ruler title under each of the 7 governments (24 each). Empty = use RULES.TXT. INFERRED.

### Civilization record (8 × S bytes, slot 0 = barbarians)

| +    | size      | field                                                                                                                        |
| ---- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1    | 1         | gender (0 male, 2 female)                                                                                                    |
| 2    | u16       | treasury                                                                                                                     |
| 6    | 1         | tribe id (RULES @LEADERS index)                                                                                              |
| 8    | u16       | research progress (beakers)                                                                                                  |
| 10   | 1         | advance being researched (0xFF none)                                                                                         |
| 16   | 1         | advances discovered                                                                                                          |
| 17   | 1         | future techs discovered                                                                                                      |
| 19   | 1         | science rate (tenths)                                                                                                        |
| 20   | 1         | tax rate (tenths)                                                                                                            |
| 21   | 1         | government 0–6                                                                                                               |
| 30   | 1         | reputation                                                                                                                   |
| 31   | 1         | patience                                                                                                                     |
| 32   | 8 × 4     | treaty with slot n: byte0 bits 0 contact, 1 cease-fire, 2 peace, 3 alliance, 4 vendetta, 7 embassy; byte1 bit 5 war          |
| 64   | 8         | attitude toward slot n (RULES @ATTITUDES index)                                                                              |
| 88   | 13        | known advances, bit per advance (100 bits)                                                                                   |
| 102  | u16       | military units                                                                                                               |
| 104  | u16       | cities                                                                                                                       |
| 108  | u16       | sum of city sizes                                                                                                            |
| 216  | 3 × 62    | per unit type: active, casualties, in production                                                                             |
| X    | 8 × u16   | last contact turn with slot n, X = 216 + 3·62 + 592 = 994                                                                    |
| X+17 | 9         | throne room pieces                                                                                                           |
| X+30 | 1         | bit 0: has launched a spaceship                                                                                              |
| X+32 | u16 … u16 | spaceship: estimated arrival, launch year, (gap), structural, propulsion, fuel, habitation, life support, solar at +38 … +48 |

All INFERRED. The 62-entry unit-type arrays are known for version 40/44; version 39 has a
smaller record and may differ.

### Unit record (26 bytes; v44 appends 6 unknown bytes)

| +   | size | field                                                                         |
| --- | ---- | ----------------------------------------------------------------------------- |
| 0   | u16  | x (game coordinates; 0xFFFF = dead/unused slot)                               |
| 2   | u16  | y                                                                             |
| 4   | 1    | bit 6: has moved this turn                                                    |
| 5   | 1    | bit 5 veteran, bit 6 waiting                                                  |
| 6   | 1    | unit type (RULES @UNITS index)                                                |
| 7   | 1    | owner slot                                                                    |
| 8   | 1    | movement points spent (thirds)                                                |
| 9   | 1    | visible to slot n (bits)                                                      |
| 10  | 1    | hit points lost                                                               |
| 11  | 1    | last move direction 0–7 clockwise from up-right, 0xFF none                    |
| 13  | 1    | work counter (settlers), fuel-out / lost-at-sea flag, or caravan commodity id |
| 15  | 1    | order code                                                                    |
| 16  | 1    | home city id                                                                  |
| 18  | u16  | go-to x                                                                       |
| 20  | u16  | go-to y                                                                       |
| 22  | u16  | link: next unit on top in the same square                                     |
| 24  | u16  | link: next unit underneath                                                    |

Coordinates VERIFIED in bounds with the right parity in all 42 files; types < 62 and owners < 8
VERIFIED; the rest INFERRED.

### City record (84 bytes; v44 appends 4 unknown bytes)

| +   | size    | field                                                                                                                                          |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | u16     | x                                                                                                                                              |
| 2   | u16     | y                                                                                                                                              |
| 4   | 1       | bits: 0 civil disorder, 1 "we love the king" day, 2 improvement sold this turn, 3 stolen tech, 4 auto-build military rule, 7 can build coastal |
| 5   | 1       | bit 3: can build hydro                                                                                                                         |
| 6   | 1       | bit 5: can build ships                                                                                                                         |
| 7   | 1       | bits: 0 auto-build military advisor, 1 auto-build domestic advisor, 2 objective ×1, 4 objective ×3                                             |
| 8   | 1       | owner slot                                                                                                                                     |
| 9   | 1       | size                                                                                                                                           |
| 10  | 1       | founder slot                                                                                                                                   |
| 11  | 1       | turns since capture                                                                                                                            |
| 12  | 1       | known to slot n (bits)                                                                                                                         |
| 13  | 8       | last size shown to slot n                                                                                                                      |
| 22  | 4       | specialists: 16 × 2 bits (0 none, 1 entertainer, 2 tax collector, 3 scientist)                                                                 |
| 26  | u16     | food in storage                                                                                                                                |
| 28  | u16     | shields toward current production                                                                                                              |
| 30  | u16     | net trade                                                                                                                                      |
| 32  | 16      | name                                                                                                                                           |
| 48  | 3       | worked squares, one bit per square of the 21-square radius, MSB first                                                                          |
| 51  | 1       | specialists × 4                                                                                                                                |
| 52  | 5       | improvements: bit per RULES @IMPROVE index 1–34 (Palace … last buildable), bit 0 unused                                                        |
| 57  | i8      | production: 0–61 = unit type; negative = improvement, −k = @IMPROVE index k                                                                    |
| 58  | 1       | active trade routes                                                                                                                            |
| 59  | 3       | commodities supplied                                                                                                                           |
| 62  | 3       | commodities demanded                                                                                                                           |
| 65  | 3       | commodity carried on each route                                                                                                                |
| 68  | 3 × u16 | trade-route partner city id                                                                                                                    |
| 74  | u16     | science output                                                                                                                                 |
| 76  | u16     | tax output                                                                                                                                     |
| 78  | u16     | trade icons                                                                                                                                    |
| 80  | 1       | food production                                                                                                                                |
| 81  | 1       | shield production                                                                                                                              |
| 82  | 1       | happy citizens                                                                                                                                 |
| 83  | 1       | unhappy citizens                                                                                                                               |

Names, coordinates and owner < 8 are VERIFIED across all 42 files; the rest INFERRED. Values a strict reader must tolerate, all VERIFIED in shipped fan scenarios: an empty city name (Santa), sizes of 59 and 127 set in the editor (Atolon, Zeus), and a food-storage word that has wrapped past 65000 (Atolon, a barbarian city). Treat size as a plain byte and food as u16 as stored.

### Scenario parameters (100 bytes, optional)

`+0` flags: bit 0 total war, 1 objective victory, 2 count wonders as objectives, 4 forbid
government switching, 5 forbid tech from conquests, 6 eliminate pollution · `+1` bit 1 special
rules-file override, bit 7 special WWII-only AI · `+2` scenario name, NUL-terminated, up to 80 ·
`+82` u16 tech paradigm · `+84` i16 years per turn · `+86` u16 starting year · `+88` u16 max turns ·
`+90` protagonist slot · `+92 … +98` u16 objectives needed for decisive victory, marginal victory,
marginal defeat, decisive defeat. Presence VERIFIED (exactly 100 extra bytes in all 41
scenarios); fields INFERRED.

### Destroyed civilizations (338 bytes)

`+0` i16 count · `+2` 12 × i16 turn destroyed · `+26` 12 destroyer slots · `+38` 12 destroyed
slots · `+50` 12 × 24 names. Size VERIFIED, fields INFERRED.

## Open items

- Version 44 (MGE-written) record sizes need a real MGE save to confirm. Anyone who owns the
  game can produce one in a minute: start a game, save, and run the conformance test.
- `EVNT` blocks (scenario events) are detected but not parsed.
- The 48-byte per-human blocks, the 110- and 70-byte gaps and the two minimap-sized blocks are
  unmapped.
