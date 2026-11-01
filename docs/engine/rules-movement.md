# Movement allowance

Status: VERIFIED by decompilation of the original executable (0x00554169 full moves,
0x0055436d moves left). The rest of movement — what a step costs, the partial-move gamble, zones
of control, boarding, landfall, air fuel and trireme loss — was read from the unit move handler
and lives in [rules-units.md](rules-units.md). Implemented in `packages/engine/src/movement.ts`.

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

## Go-to pathing (VERIFIED as a weighting, 0x00485e3d / 0x00484325)

The go-to step chooser weighs each of the eight directions by the step cost of
[rules-units.md](rules-units.md) plus the remaining distance, steers "stay near land" units away
from squares flagged as far from land, and refuses zone-of-control violations. A go-to counter
grows by one per step and by fifteen when the unit reverses; past 47 the player is asked whether
to give up (LONGMOVE).

## Sight (VERIFIED 0x0041aad6)

When a unit arrives on a square (or is created) the original "looks around" from it: the
square and its eight neighbours become seen by the owner. A unit whose type has the
two-square-visibility flag (RULES `@UNITS` flag bit 0) also sees the sixteen squares at distance
two — the twelve outer squares of a city radius plus the four points four columns or rows away
(the offset table at 0x5b2e38, entries 8–19 and 21–24) — but only the squares of its own
element: an ocean square when the unit is a sea unit, a land square when it is a land unit, any
square for an air unit. There is no larger radius anywhere; hills and mountains add nothing.

The same routine makes first contact with the owners of the units and cities it finds, wakes a
sentried unit an enemy steps next to, and records which civilizations can see the unit
(byte +9 of the unit record, a "seen by" mask). `packages/engine/src/sight.ts` ports the sight;
the contact and waking live in diplomacy.ts and the unit orders. Cities reveal their 21-square
radius when founded (INFERRED; the original's founding routine shows it only for a computer
player's first city, whose radius it reveals square by square, and reveals the city square
itself to every civilization).
