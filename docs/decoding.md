# Decoding the original

The port is built from a full reading of the original program. This page says how to take part and
what is left. For a guided tour of the program and a name and description for every function, see
[roadmap.md](roadmap.md) and [functions/function-map.tsv](functions/function-map.tsv). `docs/engine/function-status.tsv` lists every function in the executable.

## The list

| column  | meaning                                                                              |
| ------- | ------------------------------------------------------------------------------------ |
| address | where it starts in `civ2.exe`                                                        |
| size    | bytes of machine code                                                                |
| kind    | sorted automatically by what it touches: rules, screen, interface, network, runtime, |
|         | library or helper. A first sort, not a verdict: open the function before trusting it |
| status  | `read`: opened one by one. `swept`: displayed in the batch pass over library, same-  |
|         | code, runtime and forwarder functions. `named`: its address appears in the notes     |
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

Every one of the 5,140 functions in `docs/engine/function-status.tsv` has now been displayed and
read at least in part. The `kind` column says what each function is. The last pass read 611 window,
graphics, sound and file library functions, 144 small forwarders and helpers, 1,937 functions
identical in shape to another, and 353 C and MFC runtime functions. None holds a game rule. In the
same-code and runtime batches, repeated boilerplate lines such as debug asserts and cleanup calls
were filtered out of the display.

The gap left by the earlier passes is closed. Those passes opened long functions through a filter
that drops drawing calls, and bodies over 1,800 characters in the last of them showed only their
first 30 lines. All 218 functions below 0x0055a000 that this could affect were then read from
line 31 to the end, with drawing calls filtered out and runs of empty `case` labels collapsed. They
hold windows, screens, file loaders and writers, editors, the popup system and network setup. They
added no new rule of the standard game. What they did add is the rest of the Cheat menu dialogs:
Edit City, Edit Unit and Change Terrain At Cursor, and the anonymous chat box. Those are ported.
The other 269 long functions outside that log were read in earlier passes; this cannot be proved
line by line, since no log of those displays was kept. The network packet code is not ported,
since the relay does that job differently.

The original's random numbers are the C library generator at 0x00591da0, seeded from the clock at
startup (0x0057b6f6). VERIFIED. The port keeps its own generator, so games reproduce from a seed on
every machine; it does not reproduce the original's sequences.

That pass found rules the earlier searches missed: the locator grid for long trips, map size
rules, custom map limits, passwords, the Hall of Fame, Find Commodity, custom tribes, the Parley
cancel button and the computer taking over a lost player. All are ported. So the claim is: no rule
of the standard game is known to be missing. It is not that every line of the window library has
been read.

The locator grid is a case worth knowing. The search at 0x00484325 clears only the first 0x1200
bytes of its 48 by 48 table of ints, half of it, so costs from earlier searches steer later ones.
Replaying the build in the original's order with that half-cleared table matches a generated
world's saved grid on all 1,494 links, VERIFIED on one world. A game loaded from a save keeps the saved
grid. The same stale table affects the original's ordinary go-to; the port's go-to does not copy
that, since it depends on process memory that no save holds.

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
