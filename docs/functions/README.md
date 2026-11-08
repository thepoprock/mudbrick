# The function map

[function-map.tsv](function-map.tsv) lists every one of the 5,140 functions in the Multiplayer Gold
`civ2.exe` (SHA-256 `f5196e31…b04c40`) with a name and a one-line description in our own words.
Start with [../roadmap.md](../roadmap.md), which explains how the program fits together and how to
put these names into your own Ghidra copy with `tools/ghidra/ApplyFunctionMap.java`.

| column        | meaning                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------- |
| `address`     | where the function starts in `civ2.exe`                                                       |
| `size`        | bytes of machine code                                                                         |
| `name`        | our name; a repeated name gets the address added. `sub_` plus the address = not described yet |
| `system`      | which part of the game it belongs to (turn, city, combat, ui-city, network …)                 |
| `basis`       | how the description was made: see the table in the roadmap, section 6                         |
| `description` | what it does, in plain words; other functions are referred to by their names                  |
| `docs`        | the write-ups in `docs/` that cite it                                                         |
| `port`        | the Mudbrick source files that cite it                                                        |

Words in capitals in a description, such as `INHOCK` or `CARAVANMENU`, are the GAME.TXT sections
of the messages the function shows. They are the quickest way to recognise a function in the
running game.

The map holds no code or text from the program. Corrections and new descriptions are welcome:
keep them in your own words and set `basis` honestly.
