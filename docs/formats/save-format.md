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

| offset       | size             | field                                                                                                                                                                                             | status                                                                              |
| ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 0            | 8                | magic `CIVILIZE`                                                                                                                                                                                  | VERIFIED                                                                            |
| 8            | 2                | `00 1A`                                                                                                                                                                                           | VERIFIED                                                                            |
| 10           | 1                | version (39, 40, 44, …)                                                                                                                                                                           | VERIFIED                                                                            |
| 12           | 12               | options bit-field (table below)                                                                                                                                                                   | partly VERIFIED (see the notes under the table)                                     |
| 24           | 42               | game parameters (table below)                                                                                                                                                                     | partly                                                                              |
| 66           | T                | per advance: slot of the civilization that discovered it first, 0 = nobody yet                                                                                                                    | VERIFIED (the executable reads it by advance index for the Chieftain science bonus) |
| 66 + T       | T                | per advance: bit n = civilization slot n knows it                                                                                                                                                 | INFERRED                                                                            |
| 66 + 2T      | 28 × i16         | per wonder (RULES @IMPROVE order from 39): city id, −1 none, −2 lost. The executable addresses the table as `base + 2 × improvement` with the first wonder at 39                                  | VERIFIED                                                                            |
| W + 56       | 262              | mostly unknown. The executable keeps civilization-level bytes here: +2 the civilization the AI measures itself against (the human player, INFERRED), +4 … +11 one byte per slot, +19 a slot index | partly                                                                              |
| W + 318      | 7 × 242          | civilization names (slots 1–7; slot 0 = barbarians, not stored)                                                                                                                                   | INFERRED                                                                            |
| C            | 8 × S            | civilization records (slot 0 = barbarians)                                                                                                                                                        | partly                                                                              |
| M            | 14               | map header                                                                                                                                                                                        | VERIFIED                                                                            |
| M + 14       | 7 × area         | per civilization slot 1–7: what it has seen on each square (bits)                                                                                                                                 | INFERRED                                                                            |
| M + 14 + 7a  | 6 × area         | square records, same 6-byte layout as `.MP` files                                                                                                                                                 | VERIFIED                                                                            |
| M + 14 + 13a | 2 × lx × ly      | unknown (minimap-sized)                                                                                                                                                                           | VERIFIED size                                                                       |
| … + 1024     | 1024             | unknown                                                                                                                                                                                           | VERIFIED size                                                                       |
| U            | n_units × 26/32  | unit records                                                                                                                                                                                      | VERIFIED size                                                                       |
| C₂           | n_cities × 84/88 | city records                                                                                                                                                                                      | VERIFIED size                                                                       |
| T₂           | 63               | 21 × 3 bytes; byte 1 of each triple = cities founded by that tribe                                                                                                                                | INFERRED                                                                            |
| O            | 4                | cursor square x, y (i16)                                                                                                                                                                          | INFERRED                                                                            |
| O + 4        | 48 × humans      | one 48-byte block per human player                                                                                                                                                                | VERIFIED size                                                                       |
| … next       | 1200             | power-graph history: 150 records × 8 civs, one byte each, every 4 turns                                                                                                                           | INFERRED                                                                            |
| … next       | 110              | unknown                                                                                                                                                                                           | VERIFIED size                                                                       |
| O + Oo       | 76               | clicked square x, y (i16), zoom (i16, −7 … +8), 70 unknown                                                                                                                                        | INFERRED                                                                            |
| O + Oo + 76  | 100 (optional)   | scenario parameters, present in `.SCN` and saves derived from them                                                                                                                                | VERIFIED presence                                                                   |
| then         | 338              | destroyed civilizations                                                                                                                                                                           | VERIFIED size                                                                       |
| then         | optional         | `EVNT` block (scenario events compiled from events.txt)                                                                                                                                           | not parsed yet                                                                      |

where `T` = 93 for version 39 and 100 from version 40; `W` = 66 + 2T (252 / 266);
`C` = W + 56 + 1694 (2264 / 2278); `S` = 1396 (v39) / 1428 (v40, v44);
`M` = C + 8S (13432 / 13702); `a` = map area; `lx`, `ly` = minimap size from the map header;
`Oo` = 48 × humans + 1314; unit record 26 bytes for v ≤ 40 and 32 for v44; city record 84 / 88 (88 VERIFIED: the executable's in-memory city stride is 0x58; the 32-byte unit record likewise matches the in-memory unit stride 0x20).

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

Bits the executable is seen to read (VERIFIED): byte 0 bit 4 (simplified combat, in the veteran and
movement rules) and bit 7 (bloodlust zeroes the AI's attitude counters); byte 3 bit 0 (tutorial
popups); byte 1 bit 0 ("don't restart if eliminated" floors the conquest score's turn at 250);
byte 4 bit 0 (wonder movies) and bit 3 (encyclopedia on a new advance); byte 8 bit 1 (set when
the game has ended by retirement in 2020 or a scenario's end turn, 0x0046b0fa); byte 8 bit 7
(scenario parameters in effect — the scenario's tech paradigm replaces the cosmic one); byte 8
bits 2 and 3 (research 25 % dearer / 20 % cheaper; not named by the community reader). In memory
the header starts at 0x005da6fc, so file offset = address − 0x005da6fc for the whole fixed part.

### Game parameters (offset 24)

| +   | size | field                                                                                                                                                    | status                                                                                      |
| --- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 0   | 1    | bits: 1 first air unit built, 2 first naval, 4 first caravan, 5 Republic/Democracy ever adopted, 6+7 first badly damaged unit                            | INFERRED                                                                                    |
| 4   | u16  | turn number                                                                                                                                              | VERIFIED (the executable's turn counter; plausible in all files: 0, 1, 6, 7, 101, 151, 201) |
| 6   | i16  | game year (negative = BC), recomputed from the turn each turn                                                                                            | VERIFIED (set to −4000 at a new game; compared with 999/1000 by the hut routine)            |
| 8   | i16  | calendar lock turn: from this turn the year advances by one per turn; −1 none                                                                            | VERIFIED                                                                                    |
| 10  | u16  | selected unit index (0xFFFF none)                                                                                                                        | INFERRED                                                                                    |
| 14  | 1    | game mode; values above 2 take the executable's multiplayer messaging paths                                                                              | INFERRED                                                                                    |
| 15  | 1    | human player's civilization slot                                                                                                                         | INFERRED                                                                                    |
| 16  | 1    | whose map is shown                                                                                                                                       | INFERRED                                                                                    |
| 17  | 1    | player's civilization number (RULES @LEADERS index)                                                                                                      | INFERRED                                                                                    |
| 19  | 1    | map revealed (1)                                                                                                                                         | INFERRED                                                                                    |
| 20  | 1    | difficulty 0–5                                                                                                                                           | VERIFIED (research cost, food box)                                                          |
| 21  | 1    | barbarian activity                                                                                                                                       | INFERRED                                                                                    |
| 22  | 1    | bit n = civilization slot n is in play                                                                                                                   | VERIFIED (production checks)                                                                |
| 23  | 1    | bit n = slot n is human (multiplayer)                                                                                                                    | VERIFIED (count drives the block arithmetic that matches all files)                         |
| 25  | 1    | civilizations destroyed (INFERRED from its only read: × 100 in the conquest score bonus, 0x0047c9e0)                                                     | INFERRED                                                                                    |
| 28  | u16  | polluted squares inside computer players' city radii (counted by the square-status pass 0x004b30b1 in the scoring pass); the score charges only the rest | INFERRED                                                                                    |
| 27  | 1    | global temperature rise count                                                                                                                            | INFERRED                                                                                    |
| 30  | u16  | pollution squares                                                                                                                                        | INFERRED                                                                                    |
| 32  | 1    | turns of peace                                                                                                                                           | INFERRED                                                                                    |
| 34  | u16  | number of units                                                                                                                                          | VERIFIED (block arithmetic)                                                                 |
| 36  | u16  | number of cities                                                                                                                                         | VERIFIED (block arithmetic; the executable's city loop bound)                               |
| 38  | u16  | number of reachable advances in RULES (first prerequisite not `no`): 90 in the shipped rules. Scales research cost                                       | VERIFIED                                                                                    |

### Civilization names (7 × 242 bytes, slots 1–7)

`+0` city style · `+2` leader (24) · `+26` tribe plural (24) · `+50` adjective (24) · `+74 … +218`
ruler title under each of the 7 governments (24 each). Empty = use RULES.TXT. INFERRED.

### Civilization record (8 × S bytes, slot 0 = barbarians)

| +    | size      | field                                                                                                                                                                                                                                                         |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 1         | gender (0 male, 2 female)                                                                                                                                                                                                                                     |
| 2    | i32       | treasury (the executable reads 32 bits) — VERIFIED                                                                                                                                                                                                            |
| 6    | u16       | tribe id (RULES @LEADERS index; the executable reads 16 bits) — VERIFIED                                                                                                                                                                                      |
| 8    | i16       | research progress (beakers) — VERIFIED                                                                                                                                                                                                                        |
| 10   | i16       | advance being researched, −1 none — VERIFIED (16-bit in the executable)                                                                                                                                                                                       |
| 16   | 1         | advances discovered (drives research cost) — VERIFIED                                                                                                                                                                                                         |
| 17   | 1         | future techs discovered — VERIFIED (shown in the discovery popup)                                                                                                                                                                                             |
| 18   | 1         | added to byte 16 in the research-cost formula; the executable only ever zeroes it (vestigial) — VERIFIED                                                                                                                                                      |
| 19   | 1         | science rate (tenths) — VERIFIED (AI rate policy)                                                                                                                                                                                                             |
| 20   | 1         | tax rate (tenths); luxuries = 10 − science − tax — VERIFIED                                                                                                                                                                                                   |
| 21   | 1         | government 0–6 — VERIFIED (Anarchy discards science)                                                                                                                                                                                                          |
| 30   | 1         | reputation                                                                                                                                                                                                                                                    |
| 31   | 1         | patience                                                                                                                                                                                                                                                      |
| 32   | 8 × 4     | treaty word toward slot n — all bits in docs/engine/diplomacy.md (0 contact, 1 cease-fire, 2 peace, 3 alliance, 4 vendetta, 7 embassy, 9 attacked, 10 met this turn, 11 grudge, 13 war, 14 first contact, 18 tech gift, 21 war declared this turn) — VERIFIED |
| 64   | 8         | attitude toward slot n (RULES @ATTITUDES index)                                                                                                                                                                                                               |
| 88   | 13        | known advances, bit per advance (100 bits)                                                                                                                                                                                                                    |
| 102  | u16       | military units                                                                                                                                                                                                                                                |
| 980  | 7 × i16   | the AI's government preference scores (0x0051278c reads, the city and civilization turns write) — VERIFIED                                                                                                                                                    |
| 994  | 8 × i16   | turn slot n last attacked or declared war on this civilization, −1 none (the combat routine and 0x00510871 write it) — VERIFIED                                                                                                                               |
| 104  | u16       | cities                                                                                                                                                                                                                                                        |
| 108  | u16       | sum of city sizes                                                                                                                                                                                                                                             |
| 216  | 3 × 62    | per unit type: active, casualties, in production                                                                                                                                                                                                              |
| X    | 8 × u16   | last contact turn with slot n, X = 216 + 3·62 + 592 = 994                                                                                                                                                                                                     |
| X+17 | 9         | throne room pieces                                                                                                                                                                                                                                            |
| X+30 | 1         | spaceship flags: bit 0 started (a part built), bit 1 launched, bit 2 arrived, bit 3 Fusion Power at the last evaluation, bit 4 won — VERIFIED (0x00480857/0x00480886, 0x00467591)                                                                             |
| X+32 | u16 … u16 | spaceship: estimated arrival, launch year, population aboard (habitation modules at launch), structural, propulsion, fuel, habitation, life support, solar at +38 … +48                                                                                       |

Rows marked VERIFIED were confirmed by reading the executable (its civilization record is a memory image of this one, stride 0x594); the rest are INFERRED. The 62-entry unit-type arrays are known for version 40/44; version 39 has a
smaller record and may differ.

### Unit record (26 bytes; v44 appends 6 unknown bytes)

| +   | size | field                                                                                                                                                                                                       |
| --- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | u16  | x (game coordinates; 0xFFFF = dead/unused slot)                                                                                                                                                             |
| 2   | u16  | y                                                                                                                                                                                                           |
| 4   | 1    | bit 6: has moved this turn — VERIFIED (set by the move handler)                                                                                                                                             |
| 5   | 1    | bit 5 veteran, bit 6 waiting                                                                                                                                                                                |
| 6   | 1    | unit type (RULES @UNITS index)                                                                                                                                                                              |
| 7   | 1    | owner slot                                                                                                                                                                                                  |
| 8   | 1    | movement points spent (thirds)                                                                                                                                                                              |
| 9   | 1    | visible to slot n (bits) — VERIFIED (the AI explores when the byte is zero)                                                                                                                                 |
| 10  | 1    | hit points lost                                                                                                                                                                                             |
| 11  | 1    | last move direction 0–7 clockwise from up-right, 0xFF none — VERIFIED (written after every step)                                                                                                            |
| 12  | 1    | AI decision tag: an ASCII letter written by the move chooser (ai-units.md), shown beside computer units in the original's debug mode — VERIFIED                                                             |
| 13  | 1    | settlers' work counter, air unit's turns of fuel used, or caravan commodity id — VERIFIED                                                                                                                   |
| 14  | 1    | go-to loop counter: +1 per go-to step, +15 on a reversal; past 47 the game asks whether to give up — VERIFIED; the AI reuses it as a settler's turns spent waiting for a site and a transport's target slot |
| 15  | 1    | order: RULES @ORDERS index + 1 (1 Fortify … 11 Go To; 27 a second go-to form), 0xFF none — VERIFIED                                                                                                         |
| 16  | 1    | home city id                                                                                                                                                                                                |
| 18  | u16  | go-to x                                                                                                                                                                                                     |
| 20  | u16  | go-to y                                                                                                                                                                                                     |
| 22  | u16  | stack link: the next unit record on the same square (0xFFFF for the last) — VERIFIED from real saves: units sharing a square form a doubly linked list in record order                                      |
| 24  | u16  | stack link: the previous unit record on the same square (0xFFFF for the first) — VERIFIED                                                                                                                   |

Coordinates VERIFIED in bounds with the right parity in all 42 files; types < 62 and owners < 8
VERIFIED; the rest INFERRED.

### City record (84 bytes; v44 appends 4 unknown bytes)

| +   | size    | field                                                                                                                                                                        |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | u16     | x                                                                                                                                                                            |
| 2   | u16     | y                                                                                                                                                                            |
| 4   | 1       | bits: 0 civil disorder, 1 "we love the king" day, 2 improvement sold this turn, 3 stolen tech, 4 auto-build military rule, 7 can build coastal                               |
| 5   | 1       | bit 3: can build hydro                                                                                                                                                       |
| 6   | 1       | bit 5: can build ships                                                                                                                                                       |
| 7   | 1       | bits: 0 auto-build military advisor, 1 auto-build domestic advisor, 2 objective ×1, 4 objective ×3                                                                           |
| 8   | 1       | owner slot                                                                                                                                                                   |
| 9   | 1       | size                                                                                                                                                                         |
| 10  | 1       | owner before the last capture (the founder until then); the executable compares it with a captor to detect a liberation — VERIFIED                                           |
| 11  | 1       | turn of the last capture (the executable stores the turn number; every 64 turns a held city becomes 'originally' its holder's) — VERIFIED                                    |
| 12  | 1       | known to slot n (bits)                                                                                                                                                       |
| 13  | 8       | last size shown to slot n                                                                                                                                                    |
| 22  | 4       | specialists: 16 × 2 bits (0 none, 1 entertainer, 2 tax collector, 3 scientist)                                                                                               |
| 26  | u16     | food in storage                                                                                                                                                              |
| 28  | u16     | shields toward current production                                                                                                                                            |
| 30  | u16     | net trade                                                                                                                                                                    |
| 32  | 16      | name                                                                                                                                                                         |
| 48  | 3       | worked squares, one bit per square of the 21-square radius, MSB first                                                                                                        |
| 51  | 1       | specialists × 4                                                                                                                                                              |
| 52  | 5       | improvements: bit per RULES @IMPROVE index 1–34 (Palace … last buildable), bit 0 unused                                                                                      |
| 57  | i8      | production: 0–61 = unit type; negative = improvement, −k = @IMPROVE index k                                                                                                  |
| 58  | 1       | active trade routes (0–3) — VERIFIED                                                                                                                                         |
| 59  | 3       | commodities supplied                                                                                                                                                         |
| 62  | 3       | commodities demanded                                                                                                                                                         |
| 65  | 3       | commodity carried on each route, 0xFF a food route — VERIFIED                                                                                                                |
| 68  | 3 × u16 | trade-route partner city id — VERIFIED (rules-trade.md; the supplied list at +59 and demanded list at +62 are signed bytes, negative = in use by a route or a homed caravan) |
| 74  | u16     | science output                                                                                                                                                               |
| 76  | u16     | tax output                                                                                                                                                                   |
| 78  | u16     | trade icons                                                                                                                                                                  |
| 80  | 1       | food production                                                                                                                                                              |
| 81  | 1       | shield production                                                                                                                                                            |
| 82  | 1       | happy citizens                                                                                                                                                               |
| 83  | 1       | unhappy citizens                                                                                                                                                             |

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

## Writing

`writeSave` (packages/formats/src/saveWriter.ts) rebuilds a file from the original bytes: the
fixed part is copied, the modelled header, tech, wonder and civilization fields are rewritten,
the unit and city blocks are rebuilt record by record (unknown bytes copied from the source
record, zeroed for new ones), stack links recomputed, and the tail from the cities-founded table
onward copied unchanged. `patchFromSave` turns a parsed file into the identity patch; the
round-trip test writes every shipped save and scenario back and checks that parsing the result
gives the same units, cities, civilizations, techs, wonders, parameters and squares, with fewer
than one byte in a thousand differing (stale link bytes in the originals).
