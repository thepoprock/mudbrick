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

## How to help

Take an `unread` function, largest `rules` first. Read it, add the rule to the right file in
`docs/engine/`, compare it with the engine, and fix the engine if they differ. A note is only
VERIFIED if you read the code or measured the running game.
