# Documentation index

Everything here was derived from one specific edition of the original game, recorded in
[research/inventory.md](research/inventory.md) with SHA-256 hashes of every file, so anyone can
confirm they are looking at the same bytes. The legal basis for this work is in
[../LEGAL.md](../LEGAL.md).

Labels: **VERIFIED** = checked against the files, the game or a test; **INFERRED** = not yet.

## File formats (`formats/`)

| document                                   | covers                                                                             | parser                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [rules-format.md](formats/rules-format.md) | `RULES.TXT`: constants, advances, improvements, wonders, units, terrain, leaders … | `packages/formats/src/rules.ts`                                        |
| [textdata.md](formats/textdata.md)         | The seven families of text files: dialogs, labels, encyclopedia, city names, menus | `text.ts`, `popups.ts`, `labels.ts`, `cityNames.ts`, `descriptions.ts` |
| [map-format.md](formats/map-format.md)     | `.MP` map files: header, start positions, 6-byte square records                    | `packages/formats/src/map.ts`                                          |
| [save-format.md](formats/save-format.md)   | `.SAV` / `.SCN` saves and scenarios: options, civilizations, map, units, cities    | `packages/formats/src/save.ts`                                         |
| [assets.md](formats/assets.md)             | Sprite-sheet layout: every rectangle in the GIF sheets, marker pixels, palette     | `packages/formats/src/sprites.ts`                                      |

Scenario events: [formats/events-format.md](formats/events-format.md) (the `events.txt` language, as the
original's parser reads it) and [engine/events.md](engine/events.md) (what the triggers and actions do).
Not yet ported: the editors, videos, music, the Throne Room.
Of the game's rules, what stands in for an unread detail is marked INFERRED where it is written.

## Engine behaviour (`engine/`)

| document                                      | covers                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [exe-notes.md](engine/exe-notes.md)           | What has been recovered from the executable so far, as behaviour                                  |
| [rules-movement.md](engine/rules-movement.md) | Movement costs in thirds, roads/rails/rivers, domains, zones of control (INFERRED)                |
| [rules-combat.md](engine/rules-combat.md)     | Strength modifiers, round formula, and the list of things to confirm in the executable (INFERRED) |

## Research (`research/`)

| document                                      | covers                                                      |
| --------------------------------------------- | ----------------------------------------------------------- |
| [inventory.md](research/inventory.md)         | The edition, every file, sizes, executables, sheets, sounds |
| [inventory.sha256](research/inventory.sha256) | Hash of every file in that edition                          |

- [engine/map-generation.md](engine/map-generation.md) — the random map maker, pass by pass
- [engine/new-game.md](engine/new-game.md) — civilization birth, start sites, start balancing
- [engine/calibration.md](engine/calibration.md) — measuring the engine against the original running under Wine
- [engine/spaceship.md](engine/spaceship.md) — parts, limits, evaluation, launch, arrival, the end of the game
- [engine/espionage.md](engine/espionage.md) — diplomats and spies: missions, the agent's fate, incidents, bribes
- [engine/rules-trade.md](engine/rules-trade.md) — caravans, trade routes, their bonus and income
- [engine/diplomacy.md](engine/diplomacy.md) — treaties, contact, the AI's war and peace reviews, governments
