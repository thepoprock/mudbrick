# Documentation index

Everything here was derived from one specific edition of the original game, recorded in
[research/inventory.md](research/inventory.md) with SHA-256 hashes of every file, so anyone can
confirm they are looking at the same bytes. The legal basis for this work is in
[../LEGAL.md](../LEGAL.md).

Labels: **VERIFIED** = checked against the files, the game or a test; **INFERRED** = not yet.

## File formats (`formats/`)

| document                                   | covers                                                                             | parser                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------- |
| [rules-format.md](formats/rules-format.md) | `RULES.TXT`: constants, advances, improvements, wonders, units, terrain, leaders … | `packages/formats/src/rules.ts`   |
| [textdata.md](formats/textdata.md)         | The seven families of text files: dialogs, labels, encyclopedia, city names, menus | `packages/formats/src/text.ts`    |
| [map-format.md](formats/map-format.md)     | `.MP` map files: header, start positions, 6-byte square records                    | `packages/formats/src/map.ts`     |
| [save-format.md](formats/save-format.md)   | `.SAV` / `.SCN` saves and scenarios: options, civilizations, map, units, cities    | `packages/formats/src/save.ts`    |
| [assets.md](formats/assets.md)             | Sprite-sheet layout: every rectangle in the GIF sheets, marker pixels, palette     | `packages/formats/src/sprites.ts` |

Coming next: the dialog-text parser, `EVNT` scenario events, the images stored inside the game's
DLLs.

## Engine behaviour (`engine/`)

| document                            | covers                                                           |
| ----------------------------------- | ---------------------------------------------------------------- |
| [exe-notes.md](engine/exe-notes.md) | What has been recovered from the executable so far, as behaviour |

## Research (`research/`)

| document                                      | covers                                                      |
| --------------------------------------------- | ----------------------------------------------------------- |
| [inventory.md](research/inventory.md)         | The edition, every file, sizes, executables, sheets, sounds |
| [inventory.sha256](research/inventory.sha256) | Hash of every file in that edition                          |
