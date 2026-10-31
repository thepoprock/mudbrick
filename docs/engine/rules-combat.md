# Combat rules

Status: **INFERRED** throughout, from the original manual and community documentation, and
implemented in `packages/engine/src/combat.ts`. The "to confirm" list at the end is the work
order for the executable analysis.

## Strengths

Attack strength starts from the unit type's `attack`; defence from the defender type's
`defence`. Multipliers are applied in this order:

| applies to | condition                                                              | factor  |
| ---------- | ---------------------------------------------------------------------- | ------- |
| defence    | terrain: RULES @TERRAIN `defence` halves ÷ 2 (hills 2.0, forest 1.5 …) | ×0.5…   |
| defence    | river on the defender's square (ground units)                          | ×1.5    |
| both       | veteran                                                                | ×1.5    |
| defence    | fortified, or inside a city (ground units)                             | ×1.5    |
| defence    | in a fortress, not in a city (ground units)                            | ×2      |
| defence    | city walls, attacker is a ground unit without the "negates walls" flag | ×3      |
| defence    | coastal fortress against a sea attacker                                | ×2      |
| defence    | SAM battery against an air attacker                                    | ×2      |
| defence    | "double vs horse" flag (pikemen) against a ground attacker with move 2 | ×2      |
| defence    | "double vs air" flag (AEGIS) against an air attacker                   | ×2      |
| both       | damage: × remaining HP ÷ maximum HP                                    | ×hp/max |

## Rounds

Hit points are `hitPointsTens × 10`. Each round the attacker wins with probability
A ÷ (A + D). The round's loser loses hit points equal to the winner's `firepower`. Rounds repeat
until one unit reaches zero; that unit is destroyed. The survivor keeps its remaining hit points.

The implementation scales A and D by 8 and rounds to integers before drawing, so that the
comparison is integer like the original's; the exact scale the original uses is unknown.

## To confirm in the executable (highest value first)

1. The round formula: is it `random(A + D) < A`, and in what units are A and D held?
2. Damage per round: firepower, or firepower × 10, or something else?
3. The river bonus value (×1.5 is the usual claim; ×1.25 also appears in guides).
4. Whether units inside a city are always treated as fortified.
5. The "shore bombardment" and "ship vs land" firepower adjustments.
6. How "horse" is recognised for the pikemen bonus (movement 2? a type list?).
7. Veteran promotion chance after winning (50 % is the usual claim).
8. Great Wall, SDI, submarines, missiles, air superiority and fighters vs bombers.
9. The random number generator itself.
