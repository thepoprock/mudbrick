# Movement rules

Status: **INFERRED** throughout, from the original manual and community documentation, and
implemented in `packages/engine/src/movement.ts` so each rule can be tested and later confirmed
or corrected from the executable. Confirmed items will be relabelled VERIFIED with the evidence.

## Units of measure

Movement is counted in thirds of a movement point. A unit type with `move` N in RULES.TXT has
3N thirds per turn. The save file stores a unit's spent movement in the same thirds
(docs/formats/save-format.md, unit record +8).

## Cost to enter a square

| situation                                                                 | cost (thirds)                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| air unit, any square                                                      | 3                                                      |
| sea unit entering ocean or a city                                         | 3                                                      |
| sea unit entering land that is not a city                                 | impossible                                             |
| ground unit entering ocean that is not a city                             | impossible (boarding a transport is a separate action) |
| ground unit, railroad on both squares (a city counts as railroad)         | 0                                                      |
| ground unit, road on both squares (a city counts as road), or Alpine flag | 1                                                      |
| ground unit, river on both squares                                        | 1                                                      |
| ground unit, otherwise                                                    | 3 × terrain `moveCost`                                 |

`roadMoveMultiplier` in @COSMIC is 3, which is why one third is the road step: a road
multiplies movement by 3.

## Attempting a step with too little movement left

A unit with any movement left may attempt a step that costs more than it has. It succeeds with
probability `left / cost`; on failure the unit stays and its movement is spent. (The original's
exact rule for the failure case is one of the first things to confirm in the executable.)

## Zones of control

A ground unit may not move from a square adjacent to an enemy ground unit directly into another
square adjacent to an enemy ground unit, unless:

- the unit ignores zones of control (RULES flag bit 1: diplomats, explorers, partisans), or
- it starts the move inside a city, or
- the destination holds a friendly unit or a friendly city.

Sea and air units neither exert nor suffer zones of control.

## Still to specify

Transport loading and unloading; triremes and the "must stay near land" flag; paradrops;
pillage; the turn-end reset of movement; terrain transformation times (RULES @TERRAIN turns).
