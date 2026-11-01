# The turn

How a game turn is driven. VERIFIED items were read from the original executable (addresses in
[exe-notes.md](exe-notes.md)); the engine's `Game` class in `packages/engine/src/game.ts`
follows this structure.

## Per civilization (VERIFIED, turn driver 0x00469773)

For the civilization whose turn begins:

1. The treasury is clamped: above 30000 becomes 30000, a wrapped negative below −16384 becomes
   30000, any other negative becomes 0. The value is remembered for the warning in step 5.
2. Pre-turn bookkeeping (0x00468f0f, not yet read in detail).
3. **The civilization turn** (0x00467c61): every city from the **last** slot to the first goes
   through the city turn ([rules-city.md](rules-city.md)); then the AI sets its rates
   ([rules-research.md](rules-research.md)); then the AI's attitude counters toward the human are
   updated; allied civilizations (and everyone once the Apollo Program exists) learn the sizes of
   the cities.
4. Two more per-civilization routines (0x0051326d, 0x004ed2dd — diplomacy and spaceship era
   handling, not yet read).
5. Post-turn (0x004694b2): a population-milestone message, and for a human with more than one
   city, under 100 gold and losing it fast enough to be broke within ten turns
   (`(treasury − before) × 10 + treasury < 0`), the TAXES warning offering the rate dialog.
6. Autosave when the option is on (options byte 3 bit 5).

Unit movement, orders and the AI's unit moves happen between these driver calls in the game's
main loop, which is not yet read. The order in which civilizations take their turns is slot
order (INFERRED).

## What the engine implements

`Game.processCity` and `Game.processCivilization` follow the verified order. Not yet
implemented and therefore skipped: the pollution roll (0x004bb7bb), the AI's production choice
and worker tasks, and the pre- and post-turn routines beyond the treasury clamp and warning.
Each skipped step is listed in the "Still to read" section of the rules file it belongs to.

## The calendar (VERIFIED, 0x0046520c and the table at 0x005b63d0)

The year of a turn comes from one of four timelines chosen by difficulty (Chieftain and Warlord
share the first, Emperor and Deity the last; options byte 8 bits 2/3 shift the row down/up).
Each timeline is six segments of (start year, turns, years per turn); after them the calendar
moves one year per turn. Turn 0 and turn 1 are both the start year; there is no year 0.

| row                | segments                                                                               |
| ------------------ | -------------------------------------------------------------------------------------- |
| Chieftain, Warlord | −4000 ×250 @20 · 1000 ×50 @10 · 1500 ×50 @5 · 1750 ×50 @2 · 1850 ×50 @1 · 1900 ×100 @1 |
| Prince             | −4000 ×60 @50 · −1000 ×40 @25 · 0 ×150 @10 · 1500 ×50 @5 · 1750 ×50 @2 · 1850 ×50 @1   |
| King               | −4000 ×60 @50 · −1000 ×40 @25 · 0 ×50 @20 · 1000 ×50 @10 · 1500 ×50 @5 · 1750 ×50 @2   |
| Emperor, Deity     | −4000 ×60 @50 · −1000 ×40 @25 · 0 ×75 @20 · 1500 ×25 @10 · 1750 ×50 @2 · 1850 ×50 @1   |

A scenario with its own years-per-turn uses `starting year + |years per turn| × turn − 1`. The
header word at file offset 8 (−1 normally) names a turn from which the calendar advances one year per
turn. The engine's `gameYear` implements this; the year is recomputed from the turn, as the
original does at the start of each turn (0x00467591).

Printing (VERIFIED 0x00465428): "N BC" / "N AD" normally; when a scenario's years-per-turn is
negative the value counts months — the month name is `value % 12` (LABELS.TXT entries 420–431,
counted from the end for a negative value) and the year `value / 12`, so the Civil War's 22338
reads "July 1861". `calendar.ts` has `gameYear` and `formatYear`; the game's `yearOf` and
`yearTextOf` apply the state's options.

## Reputation recovery (VERIFIED, 0x00467591)

Every `12 × (difficulty + 1)` turns, each civilization's reputation (civilization record +30, 0
= spotless) falls by one when the turn is also a multiple of `24 × (difficulty + 1)` or the
civilization holds the Eiffel Tower, provided it is above 1 (any value with the Tower) and not
zero. When a human's reputation falls, the original also caps every civilization's +0x48 counter
toward that human at the new value — a field the engine does not model.

## The end of the game and the score (VERIFIED, 0x0046b0fa and 0x0047c9e0)

The year limit runs with the calendar: in the year 2000 the players are told to plan their
retirement (PLANRETIRE), and in 2020 the game ends (DORETIRE): options byte 8 bit 1 is set, a
"game ending" state is entered and the turn driver stops. A scenario with an end turn warns five
turns before it (SCENARIOENDS) and ends on it (SCENARIOEND) instead. The engine ends the game in
2020 with the best civilization score as the winner (`reason: 'retirement'`); a scenario's end
turn (`ScenarioState.endTurn`) takes the place of the years, with the same warning five turns
before.

The civilization score (`score.ts`): per city `size + happy − unhappy` (content citizens count
1, happy 2; the record's bytes 82 and 83, cached each city turn); 20 a wonder owned; the landed
spaceship's credit — population aboard × success — once the ship has won; −10 a polluted square
(less the header's +28 word, 0 in an ordinary game — INFERRED a scenario baseline); after turn
200, three a turn of peace capped at 100; five a future technology; and the barbarian level
× 25 − 50. The sum is floored at zero. The turns of peace (header +32) count from turn 200 in
the yearly routine and are reset by the combat handler whenever two civilizations' units fight.
The last civilization in play also scores a conquest bonus: civilizations destroyed (header +25,
INFERRED from this use) × 100 + (570 − turn) × 2 + 400, the turn floored at 250 under "don't
restart if eliminated" (options byte 1 bit 0), ×5/4 under dearer research and ×4/5 under
cheaper (options byte 8 bits 2 and 3); the score is the larger of the two. A scenario with
objective victory (scenario flag bit 1) scores instead by objectives: a city's objective value
(0x0042bf49) is one when its record's byte 7 bit 2 is set, plus one per wonder in it when
scenario flag bit 2 counts wonders; the protagonist's total (or the civilization's own without
a protagonist) against the four thresholds gives decisive victory (1000), marginal victory
(750), neither (500), marginal defeat (250) or decisive defeat (0) — every other civilization
sees the level mirrored — plus ten an objective held, doubled with a conquest bonus.

## A civilization's end (VERIFIED, 0x00483657)

After a city capture, a city's destruction in combat, a ghost town or a disband, the game asks
whether the loser still holds a city; with none it is destroyed: the DESTROYED message, an entry
in the destroyed-civilizations table (turn, destroyer, name — the save's 338-byte block), every
unit of the civilization disbanded (units it carried are set down), the slot taken out of play
and, for the only human, the game over. A new civilization may then restart in the slot
(0x00480fc9: an unused tribe, a fresh start site — docs/engine/new-game.md, "Restarts"). The engine runs the check after
every civilization's turn and at the end of the turn (`eliminateCityless`), lagging the original
by at most part of a turn; a civilization that never founded a city is left alone, as the
original never asks about it, except when it has no unit either (INFERRED).
