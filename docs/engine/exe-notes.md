# civ2.exe — engine notes (Ghidra project tools/ghidra-proj/civ2mge)

Binary: civ2.exe (Multiplayer Gold Edition), sha256 f5196e31a6bc1331e503064b38feafc1353141735650079d90f95079edb04c40, PE32 i386, MSVC linker 4.20, link time 1998-11-16 21:31:32 UTC. Image base 0x400000, entry 0x5969b0. 5,179 functions after auto-analysis (541 carry names: CRT, imports, FID matches). Full table: functions.tsv (address, size, name, callers, callees, thunk).

Workflow: `. tools/ghidra-env.sh` → `analyzeHeadless tools/ghidra-proj civ2mge -process civ2.exe -noanalysis -scriptPath tools/ghidra-scripts -postScript DecompileOne.java <addr> <out.c>`.
Rule: read the C, write the behaviour down in words and formulas here. Never copy decompiled code into the new engine.

## Identified so far (VERIFIED by decompilation unless marked)

| address    | name (ours)     | evidence                                                                                                                                                                                                                                                                           |
| ---------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0x0041bc9c | GetLabel(index) | Walks a global string heap at DAT_005c5308 skipping `index` NUL-terminated strings and returns a pointer to the next. 166 call sites. This is the Labels.txt @LABELS accessor: labels are stored back-to-back, addressed by position — confirms "index = identity" for Labels.txt. |

## Largest functions (candidates for the big game-logic routines; INFERRED, not yet read)

0x004f44cc (44 KB) · 0x00474edb (20 KB) · 0x00539099 (18 KB) · 0x00449c70 (16 KB) · 0x0052d472 (15 KB) · 0x004ed2dd (15 KB) · 0x004a224f (13 KB) · 0x004c42e6 (13 KB)

## Imported subsystems (VERIFIED from import table)

DirectDraw (DDRAW), Video for Windows + AVIFile (wonder/herald movies via MSVFW32/AVIFIL32, MCIWnd), WinMM (WAV + CD audio), COMCTL32/comdlg32 (dialogs), XDaemon.dll `XD_*` (MicroProse network layer: connections, lobby launch, secure/broadcast send), cv.dll / pv.dll / mk.dll / ss.dll / Tiles.dll (game-specific DLLs, roles TBD — candidates: city view, palace view, map kit, spaceship, terrain tiles), timerdll.dll.
