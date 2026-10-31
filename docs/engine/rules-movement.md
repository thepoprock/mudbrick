# Movement rules

Status: the movement allowance and the step-cost rules are **VERIFIED by decompilation** of the
original executable (0x00554169 full moves, 0x0055436d moves left, 0x00485e3d / 0x00484325
go-to weighting; see exe-notes.md). Zones of control and the partial-move gamble are still
**INFERRED** and marked below. Implemented in `packages/engine/src/movement.ts`.

## Units of measure

Movement is counted in thirds of a movement point: the @UNITS loader multiplies the file's
`move` by the road multiplier (@COSMIC first value, 3) when it builds the unit table, so a unit
type with `move` N has 3N thirds. The save file stores spent movement in the same thirds.

## Full movement allowance of a unit (VERIFIED)

```
moves = type.move × 3
sea units:
    +3  if the civilization knows Nuclear Power
    +6  if it owns Magellan's Expedition
    +3  if it owns the Lighthouse, unless the unit has the "stay near land" flag (Trireme)
damaged units (when the options word has bit 4 set, i.e. simplified combat is OFF), not air:
    moves = moves × hitPointsLeft / maxHitPoints, rounded UP to a whole movement point,
    minimum 1 MP (2 MP for sea units)
movesLeft = max(0, moves − spent)
```

So in the default (non-simplified) game a Battleship at a quarter of its hit points still has
two movement points, and a damaged Armor never drops below one.

## Cost to enter a square (VERIFIED as the weighting the go-to code applies; the move handler itself is still to be read)

| situation                                                                              | cost (thirds)          |
| -------------------------------------------------------------------------------------- | ---------------------- |
| air or sea unit, any legal square                                                      | 3                      |
| ground unit, railroad on both squares (a city counts)                                  | 0                      |
| ground unit, road on both squares (a city counts), or Alpine flag                      | 1                      |
| ground unit, river on both squares, step to an **edge-neighbour** (diagonal on screen) | 1                      |
| ground unit whose full allowance is one MP or less                                     | 3 (any terrain)        |
| ground unit, otherwise                                                                 | 3 × terrain `moveCost` |

Legal squares: sea units need ocean or a city; ground units cannot enter ocean (boarding a
transport is a separate action). Trireme-flagged units are steered away from squares whose
byte-0 bit 6 is set (INFERRED: "no land adjacent"), which is how "must stay near land" is
weighted rather than forbidden.

## Attempting a step with too little movement left (INFERRED)

A unit with any movement left may attempt a step that costs more than it has and succeeds with
probability `left / cost`; on failure it stays and its movement is spent. The handler that
decides this has not been read yet.

## Zones of control (core VERIFIED: 0x005564c0 → 0x00556397)

A square is "in the zone of control" of civilization C when **no city stands on it** and at
least one of its eight neighbours holds units of another civilization that is **not allied**
with C (treaty bit 3), and that neighbour is the same kind of square — land next to land, sea
next to sea. Allied units never exert zones of control; a square with a city is never in one.

The go-to code refuses a step when the start square is in enemy ZOC, the destination is in enemy
ZOC, and the unit lacks the "ignore zones of control" flag (RULES flag bit 1). Whether a friendly
unit already standing on the destination lifts the restriction, as the manual says, is INFERRED
until the move handler itself is read.

## Still to read

The move handler proper (the function that applies a step and decides the partial-move case),
transport loading, paradrops, pillage, the turn-end reset, terrain transformation.
