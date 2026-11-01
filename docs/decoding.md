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
| `read`                | 703       | 810,517 | Opened and compared with the rules                                                   |
| `library`             | 508       |  85,009 | The C and MFC runtime, not the game's own                                            |
| `generic`             | 3,175     | 317,733 | Touches no game table: arithmetic, lists, graphics, windows                          |
| `interface`           | 487       | 255,075 | Draws or handles a window                                                            |
| `game-data`           | 225       | 162,874 | Reads game tables but is display, file loading, options or the map and event editors |
| `editor-or-reference` | 21        |  40,477 | Editors, cheats, the Civilopedia                                                     |
| `network`             | 21        |  19,996 | Multiplayer transport                                                                |

The categories other than `read` came from a signature search, then a scan of all 227 `game-data`
functions and of every unread function that writes game state and is reachable from the turn
routines: none held a game rule missed by the port. The `generic` and `interface` functions were not
read one by one, and the network packet code is not ported, since the relay does that job differently. So the claim is:
no rule of the single-player game is known to be missing, not that every line has been read.

## Checking against the original

Reading alone misses things. The computer's treasury spending sat in a routine marked read for
weeks. Run the engine on the original's own saves instead:

- `scripts/compare-builds.ts` compares the build chooser with what the original was building.
- `scripts/compare-saves.ts` reports government scores, research rank, units and terrain.
- `scripts/probe-engine.ts` plays a whole game. It keeps an idle human on purpose: computers alone
  build about half as many units again.
- Run the engine forward from an original save and compare with the original's later saves. This
  found more than any other check: it isolates which number drifts from a state both games share.

Measured from the original's turn 172 save, run on to about turn 250:

| At turn 250 | Cities | Units | Irrigation | Mines | Roads |
| ----------- | ------ | ----- | ---------- | ----- | ----- |
| Original    | 44     | 176   | 141        | 40    | 186   |
| Engine      | 41     | 171   | 108        | 36    | 183   |

New games vary much more from seed to seed: at turn 250 three seeds gave 29 to 52 cities and 163 to
321 units, with 47 to 67 irrigated squares. They run heavy on Warriors, 32 to 150 against 18. Only
one original game exists to compare with, so part of that is one game's luck and part is a real gap
in the opening. From the turn 172 start the gap closes, so look before that turn first.

The two chooser comparisons can mislead. `compare-builds.ts` asks every city at once, so a rule
that wants one unit per land mass looks like an overbuild. Research picks are a weighted roll, so
the original's pick need only be among the high values, not on top.

Compare only at the same difficulty; `docs/engine/difficulty.md` lists what difficulty changes.

## Known gaps

Simultaneous moves are ported (0x0054d335, `Game.simultaneousRound`). The square locks of 0x0053d7b1 become one writer at a time on the relay (`apps/relay/src/lock.ts`), and each burst of orders sends the whole state, so a slow link will feel it. Treaties between humans (Parley, 0x004ab8d5) are in `packages/engine/src/parley.ts`; an offer waits in the game state, so it works in hot seat, by file and over the relay. Open games, where a new player joins mid-game, are not ported.

## How to help

Take a function not marked `read`, `game-data` first. Read it, add the rule to the right file in
`docs/engine/`, compare it with the engine, and fix the engine if they differ. A note is only
VERIFIED if you read the code or measured the running game.
