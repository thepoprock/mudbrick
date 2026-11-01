# Map rules: special resources and huts

Status: **VERIFIED by decompilation** (0x00559401 special resources, 0x0055951a huts,
0x004051e0 grassland shield, 0x00558b1e seed). Implemented in `packages/engine/src/terrainSpecials.ts`.

The original does not store which squares carry a special resource or a hut. It derives them
from the square's coordinates and the map's **resource seed** (map header +8, saved in `.MP`
and `.SAV` files; a fresh map takes `rand() & 0x7fff`, or 1 if that is 0).

## Coordinates used by both formulas

For game coordinates `(x, y)` (x + y even):

```
a = (x + y) >> 1            // diagonal row
b = x - ((x + y) >> 1)      // diagonal column
```

## Special resource at (x, y) — returns none, first special, or second special

```
if the square's byte 0 has bit 6 set → none          (the bit SUPPRESSES a special; it is not a marker)
if terrain is Grassland (2)        → none          (grassland has its shield pattern instead)
if ((a & 3) + (b & 3) × 4) == (((x + y) >> 3) × 11 + seed + (b >> 2) × 13) & 0xF:
    special = first
    bit = 1 << ((seed >> 4) & 3)
    if (b & bit) == (a & bit): special = second
else none
```

The two specials are the RULES @TERRAIN "first" and "second" lists (docs/formats/rules-format.md),
drawn from TERRAIN1 columns x=131 and x=196 (docs/formats/assets.md).

## Hut at (x, y)

```
if ocean → none
if a city stands here → none
hut = ((a & 3) + (b & 3) × 4) == ((b >> 2) × 13 + ((x + y) >> 3) × 11 + seed + 8) & 0x1F
```

There is no record of a hut being entered. A hut exists only on a square whose byte 5 high nibble
is still 15 (0x0055951a), and that nibble takes the owner of a unit placed on an empty square
(0x00554b8f). So any unit standing there ends it, barbarians included.

## Grassland shield (VERIFIED, 0x004051e0)

```
a = (x + y) >> 1
shield = (−(a + x)) & 2 == 0
```

Half of all grassland squares carry the shield, in diagonal stripes two squares wide. The AI's
city-site rating (0x0040291f) counts it as +2 and penalises a grassland site without one.

## The two distance measures (VERIFIED 0x0055083d, 0x005506d0)

The original measures distance in two ways, with `dx` wrapped on a round world, in the doubled
map coordinates. The main one (`distance`, used for the capital distance behind corruption, for
nearest-city searches, for caravan payments and for most of the unit AI) takes the larger and
smaller of `dx` and `dy` and gives `large − ((⌊(dx + dy) / 2⌋ − small + 1) >> 1)`, so a long straight
line costs half as much again as a diagonal. The grid one (`gridDistance`, used by the unit
support and fortress checks, road links and the go-to search, the air AI and fuel) is
`⌊(dx + dy) / 2⌋`. Call sites were sorted by which routine they came from; those in routines
using both (the unit handler 0x004f44cc, 0x004ba99a) were sorted where the decompile was read, and
the rest stay on the main measure — INFERRED.
