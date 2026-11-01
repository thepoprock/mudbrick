# Orders a human gives

`packages/engine/src/humanOrders.ts`. VERIFIED from the routines named unless marked INFERRED.

**Tax rates** (0x00406284, 0x00405230). Limits in tenths: Anarchy and Despotism 6, Monarchy 7,
Communism, Fundamentalism and the Republic 8, Democracy 10. Luxuries are the rest and obey the
limit too.

**Buying** (0x004d0358). `left = clamp(cost − stored, 0, 999)`, cost from the @COSMIC shield rows
with no difficulty scaling. A unit costs `left² / 20 + 2 × left`, an improvement `2 × left`, a
wonder or spaceship part `4 × left`. An empty box doubles the price. Capitalization cannot be
bought, nor a unit in a city in disorder. The box is filled and the city completes it at its turn.

**Selling** (0x004cc57d). Rows × shield rows in gold, once a turn per city (flag bit 2, cleared by
the city turn). Never the Palace.

**Disbanding in a city** (0x004cce77). Half the unit's cost goes into the box.

**Airlift** (0x005373fc, 0x0049d26b). Land units only, from a city with an Airport to another of
yours, one airlift per city per turn, at either end. Enemy fighters in range of either city may
shoot it down: each counts 1, or 2 if veteran, and on a warning the unit dies one time in six. This
fighter check is not ported. INFERRED that the flag clears each turn.

**Paradrop** (0x00536a8b, 0x0049d43c). The unit must not have moved, and must start in a city or
at an airbase. The target must be land, free of enemy units, within @COSMIC's range by the grid
measure. Capture on landing and the check against treaties are not ported.

**Workers** INFERRED: the click handler in the city window was not found. A worked square freed
becomes an entertainer; a free square takes a specialist back. Specialists other than entertainers
need size 5.
