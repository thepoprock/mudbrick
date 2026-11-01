# What the difficulty level changes

Every place the original reads the difficulty (0x005da728), found by searching the decompiled rules
routines, levels numbered 0 (easiest) to 5. The conditions are VERIFIED; a row marked INFERRED is sure of
the test but not of what it is for. All of these are deliberate: a
port that drops one changes how hard the game is, so check here before changing any of them.

## The computer's economy

| Rule                                                                                                                                                                                               | Where                            | Engine                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------- |
| Shield and food box rows for computers: `13 − level`, 14 at level 0, one more below level 3                                                                                                        | 0x004b3b24                       | `boxRows`                             |
| From turn 200 at level 2 or above, while a human is the strongest, computer boxes lose up to 2 rows; Manhattan Project with Rocketry among computers, or Apollo with Space Flight, gives rows back | 0x004b3b24                       | `rowsRelief`                          |
| Treasury purchases refund `level × share / 10 / (8 − top human rank)`                                                                                                                              | 0x004b7e74                       | `computerPurchase`                    |
| INFERRED: science, research cost by level                                                                                                                                                          | 0x004b6359 and research routines | `cityScienceToCiv`, `researchCostFor` |

## What the computer will build

| Rule                                                                                          | Where      | Engine                |
| --------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| Levels 0 and 1: no wonder before a human knows its advance, and none a human city is building | 0x00474edb | `aiChooseProduction`  |
| Any level: a civilization holding Rocketry alone leaves all wonders but the Manhattan Project | 0x00474edb | `aiChooseProduction`  |
| Level 0: a size 1 city never finishes Settlers                                                | 0x004b7e74 | `processProduction`   |
| Level 0: no spaceship pressure, and no spaceship priority                                     | 0x00474edb | see note              |
| Level 2 and above: Diplomats and Spies valued higher under space race pressure                | 0x00474edb | `aiChooseProduction`  |
| Wonder made obsolete: `value × 3 + level × 50`                                                | 0x00474edb | `aiChooseProduction`  |
| Barracks and Courthouse priority for humans' auto-build                                       | 0x00474edb | `improvementPriority` |

## Combat

| Rule                                                     | Where      | Engine          |
| -------------------------------------------------------- | ---------- | --------------- |
| Levels 0 and 1: a computer's attack on a human is halved | 0x0052d472 | `resolveCombat` |
| Level 0: a human's attack is doubled                     | 0x0052d472 | `resolveCombat` |
| Barbarians against a human: attack × `(level + 1) / 4`   | 0x0052d472 | `resolveCombat` |
| Level 0: a human city does not lose a citizen to attack  | 0x0052d472 | `resolveAttack` |

## Behaviour

| Rule                                                                                                                                               | Where      | Engine       |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ |
| Harder levels: `rand % 10 <= level` puts a new computer agent at the front                                                                         | 0x004b7e74 | `placeAgent` |
| Level 3 and above: a stronger human's unit in a computer's country at peace may provoke a break                                                    | 0x004f44cc | `aiUnits`    |
| INFERRED: level 3 and above, ground units attack treaty partners' agents                                                                           | 0x004f44cc | `aiUnits`    |
| INFERRED: `level × turn > 200` lets the computer see further when picking targets                                                                  | 0x004ed2dd | `aiStrategy` |
| Not ported, INFERRED: level 1 and above, a settler near a richer human's city may found a city to block it (0x004f44cc, the test above 0x00497dbe) |            |              |
| INFERRED: happiness base by level                                                                                                                  | 0x004b6359 | `mood`       |

## Calibrating

Compare only at the same level and with a human in the game. A game of computers alone is not
equivalent: `scripts/probe-engine.ts` keeps an idle human for that reason.
