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
header word at offset 32 (−1 normally) names a turn from which the calendar advances one year per
turn. The engine's `gameYear` implements this; the year is recomputed from the turn, as the
original does at the start of each turn (0x00467591).
