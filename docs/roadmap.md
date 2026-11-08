# Roadmap: how the original program works, and how to read it

This page is for someone who knows Civilization II Multiplayer Gold well as a player and wants to
understand the program itself: to change it, to build their own version, or to check how a rule
really works. It gives you a working map of the whole executable in about half an hour, then shows
how to find any rule in it.

You need your own copy of the game. Nothing from the game is in this repository. What is here is
our own work: names, one-line descriptions, write-ups and tools that you apply to your copy.

## 1. Get a named copy of the program (30 minutes)

1. Check your edition. This map is for the Multiplayer Gold `civ2.exe` with SHA-256
   `f5196e31a6bc1331e503064b38feafc1353141735650079d90f95079edb04c40`
   (`shasum -a 256 civ2.exe`). Other editions have different addresses.
2. Install [Ghidra](https://github.com/NationalSecurityAgency/ghidra/releases) 12.x and the JDK it
   asks for. The details are in [../tools/ghidra/README.md](../tools/ghidra/README.md).
3. Import and analyse your `civ2.exe` with the default options.
4. Apply the map: run `tools/ghidra/ApplyFunctionMap.java` from the Script Manager and pick
   [functions/function-map.tsv](functions/function-map.tsv), or headless:

   ```sh
   analyzeHeadless ~/ghidra-proj civ2 -process civ2.exe -noanalysis \
     -scriptPath tools/ghidra -postScript ApplyFunctionMap.java docs/functions/function-map.tsv
   ```

Every function now carries our name, and a comment above it says what it does, how sure we are,
which write-up covers it and which Mudbrick file ports it. The main data tables get names too
(`CivTable`, `CityTable`, `UnitTable`, `UnitTypes`, `Cosmic`, `MapWidth`). The attack handler,
for example, reads as `AttackUnit` calling `BestDefender`, `DefenceStrength` and `UnitMaxHp`
instead of `FUN_0052d472` calling `FUN_0052b823`.

No Ghidra? Open [functions/function-map.tsv](functions/function-map.tsv) in a spreadsheet and filter
the `system` column. That shows the whole program as a list.

## 2. How the program is put together

It is a 1998 Windows program written in C++ with Microsoft's MFC library. 5,140 functions:

| part                                          | described | what it is                                       |
| --------------------------------------------- | --------- | ------------------------------------------------ |
| game rules (turn, city, unit, AI, diplomacy…) | 549       | the game itself                                  |
| screens and dialogs                           | 575       | the city window, advisors, Civilopedia, editors  |
| network play                                  | 96        | the multiplayer protocol                         |
| graphics, sound, video, text                  | 320       | drawing, palettes, GIF loading, CD audio, AVI    |
| platform and helpers                          | 406       | files, memory, timers, small shared routines     |
| library and compiler code                     | 1,440     | MFC, the C runtime, exception stubs, forwarders  |
| not described yet                             | 1,754     | small helpers (1,501) and window internals (253) |

### The game state lives in a few fixed tables

All of the game is in a handful of tables at fixed addresses. The save file is a straight copy of
them, so [formats/save-format.md](formats/save-format.md) is also the memory map.

| table          | address                                   | record                                  | field layout                                                   |
| -------------- | ----------------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| civilizations  | `0x5d12c0`                                | 0x594 bytes, slots 0–7 (0 = barbarians) | save-format.md, "Civilization record"                          |
| cities         | `0x5d3f60`                                | 0x58 bytes; count at `0x5da738`         | save-format.md, "City record"                                  |
| units          | `0x5dad10`                                | 0x20 bytes; count at `0x5da736`         | save-format.md, "Unit record"                                  |
| unit types     | `0x5cfdd8`                                | 20 bytes × 62                           | [engine/exe-notes.md](engine/exe-notes.md), "Unit-type record" |
| @COSMIC values | `0x5d08e8`                                | 22 bytes                                | exe-notes.md, "@COSMIC clamps"                                 |
| game header    | `0x5da6fc`                                | turn, year, options, counts             | save-format.md, "Game parameters"                              |
| map            | pointer at `0x5bea30`; size at `0x62e660` | 6 bytes a square                        | [formats/map-format.md](formats/map-format.md)                 |

The civilization, city, unit, unit-type and @COSMIC addresses and sizes are VERIFIED in
exe-notes.md. The unit count and the map pointer are INFERRED from the loops and the square
lookup (`SquarePtr`) that use them.

When Ghidra shows `(&DAT_005d3f68)[city * 0x58]`, that is field +8 of a city record: the owner.
`civ * 0x594` is a civilization, `unit * 0x20` a unit. With the record layouts beside you, most
of the rules code reads directly.

### One turn, from the top

Every name below is a function in the map. Addresses are in brackets.

- `GameMain` (0x00416169)
  - `StartupInit` (0x00411da6), which reads CIV.INI and `LoadRules` (0x004118f4): `LoadCosmic`,
    `LoadAdvances`, `LoadImprovements`, `LoadUnits`, `LoadTerrain`, `LoadGovernmentsAndLeaders`
  - `MainMenuLoop` (0x0041577e)
    - new game: `NewGameDialogs` (0x00412316), then `MakeMap` (0x00402cd3) and `NewGame`
      (0x00483c9f), which runs `CivBirth` (0x00480fc9) and `BalanceStarts` (0x00480a34)
    - load: `LoadGameDialog` (0x0045bb69), then `LoadGame` (0x004594a6)
  - `GameRound` (0x0046b55e), once per turn:
    - `YearlyRoutine` (0x00467591): barbarians, global warming, power rating, the year, historians
    - `CivTurn` (0x00469773), for each civilization:
      - `PreTurnHealing` (0x00468f0f)
      - `CivilizationTurn` (0x00467c61), which runs `CityTurn` (0x004bc513) for every city:
        `CityGrowth`, `CityProduction`, `ShieldShortageDisband`, `CityDisorderAndCelebration`,
        `CityScienceToCiv`, `PollutionRoll`, `PayUpkeep`, with `CityRecompute` (0x004b6f63)
        working out the yields, trade and happiness
      - `DiplomacyTurn` (0x0051326d)
      - `AiStrategy` (0x004ed2dd): the computer's plans and objectives
      - `PostTurnChecks` (0x004694b2) and `AutoSave` (0x00468b57)
    - `HumanTurn` (0x0046a634): `HumanUnitLoop` (0x0046a222) carries on orders. Clicks, keys
      and menus arrive through `NetPoll` (0x00460379), the message pump, and reach
      `MapClickCommand`, `MapKeyCommand` and `MenuCommand`
    - `AiUnitsTurn` (0x004ff777): `AiMoveOneUnit`, then `AiUnitMove` (0x004f44cc), the largest
      function in the program
    - `EventTurn` and the other scenario triggers, `GameYearLimit` (0x0046b0fa), and at the end
      `GameOverSequence` (0x0046b383)
- Moving a unit, for human and computer alike, goes through `MoveUnit` (0x00539099). It calls
  `AttackUnit` (0x0052d472), `CaptureCity` (0x00528720), `DiplomatInCity` (0x00499c93),
  `CaravanMenu` (0x0053893b) and `EnterHut` (0x00537aa0).

### The systems

Every function has a `system` tag. Here is each system, where to start reading, and where we wrote
it up.

| system        | functions | start with                                                            | write-up                                                                                   |
| ------------- | --------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| turn          | 19        | `GameRound`, `CivTurn`, `YearlyRoutine`                               | [engine/rules-turn.md](engine/rules-turn.md)                                               |
| city          | 66        | `CityTurn`, `CityRecompute`, `SquareYield`, `CityProduction`          | [engine/rules-city.md](engine/rules-city.md)                                               |
| unit, move    | 104       | `MoveUnit`, `UnitMoves`, `SettlerWork`, `GotoStep`, `PathSearch`      | [rules-units.md](engine/rules-units.md), [rules-movement.md](engine/rules-movement.md)     |
| combat        | 12        | `AttackUnit`, `AttackStrength`, `DefenceStrength`, `BestDefender`     | [engine/rules-combat.md](engine/rules-combat.md)                                           |
| research      | 11        | `ResearchCost`, `AddResearch`, `GainAdvance`, `AiChooseResearch`      | [engine/rules-research.md](engine/rules-research.md)                                       |
| trade         | 13        | `CaravanMenu`, `CaravanArrives`, `SupplyAndDemand`, `TradeRouteValue` | [engine/rules-trade.md](engine/rules-trade.md)                                             |
| diplomacy     | 30        | `DiplomacyTurn`, `ContactReview`, `AiWantsWar`, `BreakTreaty`         | [engine/diplomacy.md](engine/diplomacy.md)                                                 |
| negotiation   | 51        | `Parley`, `ParleyMenuAction`, `ParleyAssessment`, `AiApproachHuman`   | [engine/negotiation.md](engine/negotiation.md)                                             |
| espionage     | 9         | `DiplomatInCity`, `AgentFate`, `BribeUnit`, `DiplomaticIncident`      | [engine/espionage.md](engine/espionage.md)                                                 |
| ai            | 41        | `AiStrategy`, `AiUnitMove`, `AiChooseProduction`, `AiAdvanceValue`    | [ai-units.md](engine/ai-units.md), [ai-city.md](engine/ai-city.md)                         |
| spaceship     | 17        | `ShipEvaluate`, `LaunchSpaceship`, `AiShipDecision`                   | [engine/spaceship.md](engine/spaceship.md)                                                 |
| map, mapgen   | 60        | `SquarePtr` and the `Square…` getters, `MakeMap`                      | [map-generation.md](engine/map-generation.md), [rules-map.md](engine/rules-map.md)         |
| newgame       | 17        | `NewGame`, `CivBirth`, `AcceleratedStart`, `AdvancedOptions`          | [engine/new-game.md](engine/new-game.md)                                                   |
| events        | 30        | `ParseEvents`, `EventDispatch`, the `Event…` triggers and actions     | [engine/events.md](engine/events.md), [formats/events-format.md](formats/events-format.md) |
| save          | 28        | `SaveGame`, `LoadGame`, `SaveMap`, `LoadMap`                          | [formats/save-format.md](formats/save-format.md)                                           |
| rules-load    | 19        | `LoadRules` and the `RulesNext…` readers                              | [formats/rules-format.md](formats/rules-format.md)                                         |
| score         | 6         | `Score`, `CivPopulationUnits`, the Hall of Fame                       | rules-turn.md, [engine/advisors.md](engine/advisors.md)                                    |
| ui-advisor    | 71        | the reports F1–F11, `HighCouncil`, `ThroneRoom`, `SpaceshipScreen`    | [engine/advisors.md](engine/advisors.md)                                                   |
| ui-city       | 50        | `OpenCityWindow`, `CityWindowDraw`, `CityWinMouse`                    | [engine/human-orders.md](engine/human-orders.md)                                           |
| ui-map        | 51        | `MapViewDraw`, `DrawTerrainSquare`, `DrawUnit`, `DrawCity`            | [formats/assets.md](formats/assets.md)                                                     |
| ui-dialog     | 68        | `Popup`, `DialogFromText`, `PopupShow`                                | [formats/textdata.md](formats/textdata.md)                                                 |
| network       | 96        | `NetPoll`, `NetSend`, `NetStateDiff`, `NetSimultaneousTurnHost`       | [engine/multiplayer.md](engine/multiplayer.md)                                             |
| cheat, editor | 70        | `MenuCommand` dispatches them; `CheatEditKing`, the events editor     | `packages/engine/src/cheats.ts`                                                            |

## 3. How to find a rule

**From a message you have seen in the game.** Every message is a section of GAME.TXT, such as
`INHOCK` when a building is sold because the treasury ran dry. Search Ghidra's strings for the
section name, or run `FindStringRefs.java INHOCK`. The function that uses it is the one that
decides to show it: here `PayUpkeep`, which hands `INHOCK` to `CityMessage`. The values in the
message are set just before, with `SetTextStringLabel` and `SetTextNumber`.

**From a number in a save.** Find the field in [formats/save-format.md](formats/save-format.md).
Its memory address is the table address + record number × record size + the field's offset. Run
`RefsToAddrs.java` on it to list every function that reads or writes it.

**From a rule you want to understand.** Look in the write-ups under [engine/](engine/). Each rule
cites the addresses it came from, and the map's `docs` column points back the other way.

**From a function you are reading.** The comment at its top names the write-up and the Mudbrick
file that ports it. Mudbrick's TypeScript in `packages/engine/src/` is a readable version of the
same rule, often the quickest way to see what the C is doing.

## 4. Reading tips

- **Messages:** text is built in a shared buffer with `TextAppend`. Arguments are set with
  `SetTextString` and `SetTextNumber`, and shown with `Popup` or `PopupShow`.
- **Network calls:** many changes to the map go through `MapSet…` calls that also notify the
  other players. In a single-player game they are plain setters, so read past the network part.
- **Compiler stubs:** names starting `cleanup_`, `seh_restore_` and `init_g` are compiler-made
  stubs, and `fwd_` only calls one other function. Skip them.
- **Identical functions:** the description says which function a copy shares its code with.
- **Random numbers:** the C runtime `rand()` at 0x00591da0, used as `rand() % n`.

## 5. Checking what you read

Reading alone misses things. The best check is to run the original and compare. Saves are memory
images, so compare a save from the original with what your reading predicts. Mudbrick's
`scripts/compare-saves.ts` and `scripts/compare-builds.ts` do this for the engine, and
[decoding.md](decoding.md) describes how we did it and what it found.

## 6. How sure each line is

The `basis` column of the map says where each description came from:

| basis              | functions | meaning                                                                                                                                           |
| ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cited`            | 441       | the function is cited in a write-up or in Mudbrick's source, and the line agrees with that write-up                                               |
| `evidence`         | 924       | written from the functions it calls, the tables and fields it touches, the messages it shows and its constants, plus the code for short functions |
| `same-code`        | 346       | identical code to a described function                                                                                                            |
| `pattern`          | 1,167     | a compiler stub, forwarder, getter, setter or thin Windows wrapper, recognised by its shape                                                       |
| `ghidra-signature` | 508       | a library function Ghidra itself recognised                                                                                                       |
| `none`             | 1,754     | not described yet; named `sub_` plus the address                                                                                                  |

Treat `evidence` lines as a strong lead, not proof: open the function before relying on a detail.
The `cited` lines are backed by the write-ups, whose own claims are marked VERIFIED or INFERRED.

Known open points:

- The original's ordinary go-to uses a half-cleared table left over from earlier searches. That
  depends on memory no save keeps, so it cannot be reproduced exactly ([decoding.md](decoding.md)).
- The chat-spy attitude table is INFERRED past index 8.
- The 1,754 undescribed functions are small helpers, mostly window and drawing internals. They
  were displayed during the decode and none was found to hold a game rule. Each still needs its
  own line.

To add or correct a line, edit `docs/functions/function-map.tsv`: keep the address, give a name
and a description in your own words, set `basis`, and never paste code from the program.
