# Inventory of the original game files (Multiplayer Gold Edition, English) — research record, 2026-10-31

Source: Civilization II Multiplayer Gold Edition, English, disc image (bin/cue). ISO label `Civ2:MGE v1.0`, mastered 1998-11-17. Game files were inside the InstallShield cabinet `data1.cab` (954 files, 86 MB); extracted with unshield. Flattened install layout rebuilt at `game/civ2/` (root + SOUND/ + SCENARIO/). SHA-256 of every file: `docs/inventory.sha256`.

## Executables (all PE32 i386, MSVC linker 4.20, built 1998-11-16)

| file         | bytes   | role (INFERRED unless noted) |
| ------------ | ------- | ---------------------------- |
| civ2.exe     | 1970688 |                              |
| Civ2Map.exe  | 2449408 |                              |
| Civ2Art.dll  | 256512  |                              |
| cv.dll       | 4980224 |                              |
| pv.dll       | 1999360 |                              |
| mk.dll       | 3165696 |                              |
| ss.dll       | 1455616 |                              |
| Tiles.dll    | 1416704 |                              |
| Intro.dll    | 1151488 |                              |
| Wonder.dll   | 185856  |                              |
| timerdll.dll | 131072  |                              |
| XDaemon.dll  | 95744   |                              |

civ2.exe: sha256 f5196e31…b04c40, 1,970,688 bytes, entry 0x5969b0, image base 0x400000. Sections: .text 1,729,700 · ASMGRAF 2,307 (hand-written asm graphics) · .rdata · .data 603,320 virtual / 80,896 raw · .idata · .rsrc · .reloc. Imports (VERIFIED from strings): ADVAPI32 AVIFIL32 COMCTL32 comdlg32 DDRAW GDI32 KERNEL32 MSVFW32 USER32 WINMM + game DLLs cv.dll mk.dll pv.dll ss.dll TILES.DLL timerdll.dll XDaemon.dll. Version strings: "Civilization Gold", WRONGVERSION, WRONGXDAEMONVERSION.

## Sprite sheets (GIF)

| file         | bytes  | dimensions / palette   |
| ------------ | ------ | ---------------------- |
| CITIES.GIF   | 46452  | version 87a, 640 x 480 |
| CITY.GIF     | 66152  | version 87a, 640 x 480 |
| EDITORAS.GIF | 36558  | version 87a, 640 x 480 |
| EDITORPT.GIF | 40635  | version 87a, 640 x 480 |
| EDITORSA.GIF | 29841  | version 87a, 640 x 480 |
| EDITORSQ.GIF | 34060  | version 87a, 640 x 480 |
| ICONS.GIF    | 54217  | version 87a, 640 x 480 |
| PEOPLE.GIF   | 21227  | version 87a, 640 x 480 |
| SCREDITS.GIF | 139115 | version 87a, 600 x 400 |
| TERRAIN1.GIF | 46491  | version 87a, 640 x 480 |
| TERRAIN2.GIF | 55966  | version 87a, 640 x 480 |
| UNITS.GIF    | 54012  | version 87a, 640 x 480 |

## Binary game data

| file         | bytes  | type |
| ------------ | ------ | ---- |
| EUROPE.MP    | 54098  | MP   |
| GREECE.MP    | 24098  | MP   |
| MEDITERR.MP  | 24098  | MP   |
| PACIFIC.MP   | 54098  | MP   |
| WORLD_M.MP   | 24098  | MP   |
| WORLD_S.MP   | 12098  | MP   |
| WORLD.MP     | 54098  | MP   |
| ROME.SCN     | 77339  | SCN  |
| WWII.SCN     | 154951 | SCN  |
| TUTORIAL.SAV | 69749  | SAV  |

## Text data (Support_Files_-_English → root)

| file          | bytes  | lines | @sections |
| ------------- | ------ | ----- | --------- |
| ADVICE.TXT    | 5799   | 374   | 166       |
| ALEXANDR.TXT  | 791    | 16    | 4         |
| CITY.TXT      | 6785   | 720   | 50        |
| CIV2FANW.TXT  | 8799   | 201   | 0         |
| CIV2FAQ.TXT   | 10002  | 213   | 0         |
| COUNCIL0.TXT  | 11079  | 358   | 34        |
| COUNCIL1.TXT  | 11315  | 359   | 34        |
| COUNCIL2.TXT  | 11068  | 355   | 34        |
| CREDITS.TXT   | 2801   | 179   | 2         |
| DEBUG.TXT     | 8936   | 687   | 236       |
| HELP.TXT      | 24221  | 632   | 109       |
| HERALD.TXT    | 456    | 12    | 3         |
| LEADERS.TXT   | 2426   | 21    | 0         |
| MAPMENU.TXT   | 728    | 53    | 5         |
| MISC.TXT      | 21210  | 504   | 0         |
| PATCH.TXT     | 9091   | 245   | 0         |
| PEDIA.TXT     | 16673  | 640   | 187       |
| README.TXT    | 11902  | 280   | 3         |
| ROME.TXT      | 1210   | 20    | 4         |
| RULES.TXT     | 26906  | 637   | 12        |
| SC.TXT        | 2600   | 140   | 0         |
| SCREDITS.TXT  | 1400   | 114   | 2         |
| TUTORIAL.TXT  | 12833  | 392   | 104       |
| WWII.TXT      | 564    | 12    | 4         |
| Describe.txt  | 213099 | 1314  | 284       |
| fcredits.txt  | 2112   | 166   | 2         |
| Game.txt      | 107649 | 5194  |           |
| Labels.txt    | 12992  | 888   | 3         |
| Menu.txt      | 2480   | 135   | 9         |
| mpcredits.txt | 1287   | 107   | 2         |

## Sound: SOUND/ holds 78 WAV files (8.6M). Music = 11 CD-audio tracks (37 s – 204 s), ripped to game/mge-cdaudio/track02-12.wav.

## Scenarios: SCENARIO/ holds 25 folders (Conflicts in Civilization + Fantastic Worlds + Best of the Net 1/2), each with its own rules/text/GIF overrides and SOUND/.

## Videos (loose on disc, not in the cabinet): Civ2/KINGS/_.AVI (21 herald animations) and Civ2/VIDEO/_.AVI (wonders 00-27, councils, anarchy, launch, win, opening). LOSER.AVI is in support files.
