# Decoding the original

The port is built from a full reading of the original program. This page says how to take part and
what is left. `docs/engine/function-status.tsv` lists every function in the executable.

## The list

| column  | meaning                                                                              |
| ------- | ------------------------------------------------------------------------------------ |
| address | where it starts in `civ2.exe`                                                        |
| size    | bytes of machine code                                                                |
| kind    | sorted automatically by what it touches: rules, screen, interface, network, runtime, |
|         | library or helper. A first sort, not a verdict: open the function before trusting it |
| status  | `read`: decompiled and looked at for the port, possibly only in part. `named`: its   |
|         | address appears in the notes. `unread`: nobody has opened it yet                     |
| callers | how many functions call it                                                           |
| touches | which game tables it reads or writes                                                 |

## Setting up

You need your own copy of Civilization II Multiplayer Gold; none of it belongs in this repository.

1. Install Ghidra and import `civ2.exe` with the default analysis.
2. Copy `tools/ghidra/*.java` to a script folder.
3. Run `DecompileAll.java <folder>` headless to write one C file per function. All 5,140 take about
   a minute.

Keep that output on your own machine. Decompiled code does not go in this repository (`LEGAL.md`):
write down the rule in your own words, cite the address, and mark it VERIFIED or INFERRED.

## Where the decode stands

Every function in `docs/engine/function-status.tsv` has a `category`:

| Category              | Functions |   Bytes | Meaning                                                                              |
| --------------------- | --------- | ------: | ------------------------------------------------------------------------------------ |
| `read`                | 699       | 801,915 | Opened and compared with the rules                                                   |
| `library`             | 508       |  85,009 | The C and MFC runtime, not the game's own                                            |
| `generic`             | 3,175     | 317,733 | Touches no game table: arithmetic, lists, graphics, windows                          |
| `interface`           | 489       | 262,331 | Draws or handles a window                                                            |
| `game-data`           | 227       | 164,220 | Reads game tables but is display, file loading, options or the map and event editors |
| `editor-or-reference` | 21        |  40,477 | Editors, cheats, the Civilopedia                                                     |
| `network`             | 21        |  19,996 | Multiplayer transport                                                                |

The categories other than `read` came from a signature search, then a scan of all 227 `game-data`
functions and of every unread function that writes game state and is reachable from the turn
routines: none held a game rule missed by the port. The `generic` and `interface` functions were not
read one by one, and multiplayer rules for simultaneous moves are not decoded. So the claim is:
no rule of the single-player game is known to be missing, not that every line has been read.

## Checking against the original

Reading alone misses things. The computer's treasury spending sat in a routine marked read for
weeks. Run the engine on the original's own saves instead:

- `scripts/compare-builds.ts` compares the build chooser with what the original was building.
- `scripts/compare-saves.ts` reports government scores, research rank, units and terrain.
- `scripts/probe-engine.ts` plays a whole game. It keeps an idle human on purpose: computers alone
  build about half as many units again.

Compare only at the same difficulty; `docs/engine/difficulty.md` lists what difficulty changes.

## Known gaps

Simultaneous moves are not ported.

## How to help

Take a function not marked `read`, `game-data` first. Read it, add the rule to the right file in
`docs/engine/`, compare it with the engine, and fix the engine if they differ. A note is only
VERIFIED if you read the code or measured the running game.
