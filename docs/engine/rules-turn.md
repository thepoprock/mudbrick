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
