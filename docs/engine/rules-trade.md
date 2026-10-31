# Trade routes and caravans

Read from the caravan arrival (0x0053893b), the establish-route routine (0x0042f7a0), the
route tables (0x0042f4a1, 0x0042f43b), the route modifier (0x00468c65), the city trade
routine (0x004b6359) and the food-route bookkeeping (0x004b6d9c). VERIFIED unless marked
INFERRED. The engine's `packages/engine/src/trade.ts` implements it.

## A caravan in a city (0x0053893b)

A human gets the caravan menu: keep moving; establish a trade route (unless this is the
caravan's home city); help build a wonder (when the city builds one). A computer caravan takes
the route when the city is its go-to target and not its home (a city flagged for a caravan
objective is passed through). Helping a wonder adds `unit cost rows × shield box rows` shields
and consumes the caravan; the home city is flagged "caravan delivered" (city flag bit 17).

## Establishing a route (0x0042f7a0)

With `home` the caravan's home city (else the nearest own city) and `d` the distance (the
original scales it by 4/5 or 5/4 under two option bits the engine does not model):

1. `bonus = (home trade + city trade) × (d + 10) / 24` (trade after corruption and before
   routes, the value each city keeps from its last turn);
2. ×2 when the cities are on different land masses; ÷2 when the city is the caravan's own;
   +½ for Freight;
3. `+ m × bonus / 2` with `m` the route modifier (below) + 1 when both cities have an Airport
   (+2 on different land masses) + 1 for each city with Superhighways;
4. a commodity term: Cloth, Coal, Wine, Silver ½ bonus; Silk, Spice, Gems, Gold the bonus;
   Oil 1½; Uranium 2 — applied only when the city **demands** the commodity, when the bonus
   becomes `2 × bonus + term`;
5. ×2 before turn 200 while the owner knows neither Invention nor Navigation; −⅓ with
   Railroad; −⅓ again with Flight;
6. capped at two thirds of the owner's current research cost.

Both civilizations' attitudes toward each other improve by 10. The bonus goes to the treasury
**and** to research progress. A food caravan instead adds `(size + 1) × food box rows / 2`
food to the city and opens a food route. The caravan is consumed; the home city's table gains
the route (0x0042f4a1: nothing when the same route exists; appended while fewer than three;
otherwise the weakest route — partner trade raised by half per modifier point, halved when
domestic — is replaced when it is worth no more than the new partner's trade; a second food
route is never added). The destination's table gains a return route whose commodity is the
best of what it supplies and the home demands (a random 0–7, +10 when the supply is free, +10
when the home demands it), defaulting to a food route.

**Route modifier (0x00468c65):** 0 unless the cities share a land mass within 22 squares and
the go-to path between them (up to 50 steps) stays on roads without passing another own city
or a foreign city or unit that is not an ally; 2 when every square is railroad, else 1. The
engine walks its own pathfinder (INFERRED equivalence).

## Income each turn (0x004b6359, 0x004b6d9c)

Each route adds `(own net trade + partner's trade + 4) / 8`, plus half of that per modifier
point (both Airports count 1 when the roads give less, own Superhighways +1), nothing for a
food route, halved for a domestic partner; corruption is then taken on the whole. A city loses
one food per food route it sends and gains one per food route it receives.

## Supply and demand (0x0042c44f)

Every sixteenth turn (`(turn + city index) & 15 = 0`) and whenever the city is flagged (a route
added; INFERRED: founding) the city recomputes the three commodities it supplies and the three it
demands. `packages/engine/src/supplyDemand.ts` implements it. Inputs: the terrain counts of the
21 radius squares (`n[t]`, a square with a special resource counting four), rivers `rv` and
roads `rd` in the radius, the size, `sz5 = (size + 2) / 5`, the owner's advances count `adv`,
the land mass id `lm` and its land count, the distance from the equator `lat` and from the
middle meridian `lon` (and whether the city lies south or east of them), the tribe, the city's
improvements and the owner's advances. Commodity numbers follow the rules' caravan list: 0 Hides,
1 Wool, 2 Beads, 3 Cloth, 4 Salt, 5 Coal, 6 Copper, 7 Dye, 8 Wine, 9 Silk, 10 Silver, 11 Spice,
12 Gems, 13 Gold, 14 Oil, 15 Uranium. `/` truncates, `>>` is an arithmetic shift, "+½" adds half.

**Supply scores.** Hides `jungle×3 + tundra×6 + forest×4 + rv×3`, ×2 under 16 advances, ×2
under 24, ×2 under 49 when size < 3 (else ÷2), ÷2 when size > 7. Wool `(rv/2 + hills×2 +
grassland) × (tundra + 2)` (+3 beyond a third of the map from the equator). Beads `ocean×8 −
lat`, ÷2 when size > 9, ÷2 over 32 advances. Cloth `(plains×3 + desert − rv) × clamp(adv/10, 1,
2)`, ×1½ with Industrialization, ÷2 under 8 advances, ÷2 under 16. Salt `ocean×3 + desert×4 +
swamp×2 − adv/6`, ÷3 without Pottery, +½ with an Aqueduct, +½ on an odd land mass below 6.
Coal `(jungle + plains + forest + swamp + 1) × hills × 5`, shifted by `min(sz5/2, 2) − 1`, +½
on an odd land mass above 1, ÷2 under 20 advances. Copper `(hills + mountains) × 5`, ×2 on an
even land mass. Dye `(grassland×5 − plains + rv) × 2` (×4 when the land mass is a multiple of
four). Wine: `a = clamp(rv×5 − grassland, 0, plains×4)`, `b = clamp(plains×4, 0, a)`, `b + (width/2 −
lon)/2 + a`, ÷2 south of the equator, shifted by `clamp(sz5 − 1, −2, 1)`, +½ when `lm − 2` is a
multiple of four, ×2 for the French, ÷2 when size > 10. Silk `(forest×2 + jungle + 1) × (hills + 1)`,
then + 2 × east of the meridian and ×2 on a land mass divisible by five; ×2 for the Chinese and ×2
for the Aztecs. Silver `mountains×8`, then + hills + lon, ÷2 without Iron Working, +½ on a land
mass above 8, ÷2 when size < 5. Spice `(desert×2 + swamp×2 + jungle×3) × (ocean + rv)/2`, then
×2 within ten rows of the equator, − lat, +½ on a land mass under 26 squares, ÷2 over 300, ÷2
on land mass 1. Gems `(mountains+1)(swamp+1)(desert+1) + plains`, × clamp(sz5, 1, 4) / 2, +½ on
land mass 7. Gold `(mountains + hills/2 + 1) × (rv + 2)`, ×2 with more than two mountains, ×2
when size > 4, ×2 when size > 9. Oil `swamp×6 + tundra×8 + desert×10`, ÷8 until anyone knows
Combustion, −1 (never) when zero, else ×3 on land mass 17 or +½ when `lm − 1` is a multiple of
eight, × clamp(sz5/2 − 2, 1, 2). Uranium `(tundra + desert + 1)(hills + rv + 1)(mountains + 1)`,
−1 without Nuclear Fission, +½ on a land mass divisible by ten, × min(sz5, 6) / 6.

**Demand scores.** Hides `(tundra + glacier)×5 + lat×3/2 + mountains×2 + forest`, ×2 when size
< 3, ÷3 with Industrialization, 1 with Mass Production, ×2 under 10 advances, ×2 under 20, ÷2
over 47. Wool `|rows/4 − lat|×2 + plains×2 + forest`, ×2 with Industrialization. Beads `lat +
(21 − ocean)×3/2`, +½ when size < 4, ÷2 when size > 11, ÷2 over 47 advances. Cloth `forest×4 +
hills×4 + (adv/10 × raw hides demand) / 8`. Salt: the size taken in chunks of five weighted 8, 4,
2, 1, minus adv/2. Coal `(lat + 10) × sz5 + adv`, 0 when size < 5, ÷2 when size < 8, ×2 with
Industrialization, ×2 with Electricity, ×2 with a Power Plant, ÷8 with a Hydro, Nuclear or Solar
Plant. Copper `(rd + rv + 1) × sz5`, ÷2 when no more than the copper supply, +½ with a
Marketplace, +½ with a Bank, +½ with Electricity, ÷4 with Computers, ÷2 when size < 5. Dye `cloth
supply + rd`, ÷2 with Chemistry, ÷2 with Mass Production. Wine `sz5×4 + 4 + |x − y|`. Silk
`(rows/2 − lat)×2 − lon + width/2 + swamp×2 + jungle×4 + plains/2 + desert×4`, shifted by
`clamp(sz5 − 1, −1, 1)`, +½ on land mass 1 for cities whose index has bit 1 set, ÷2 when size
< 7. Silver `size × 8`; by `(x + y) mod 3` Gems (1) or Gold (2) also gets `size × 8`, and that
entry (Silver when 0) is ×1½ with a Cathedral or Michelangelo's, ×1½ with a Bank, ÷2 with
Economics, ÷2 with Computers, ×2 for the Spanish. Spice `land/10 − max(0, adv − 12)`, ÷2 when
size < 4; on a land mass over 400 squares ×2 when size > 7 and 0 when `−x − y` is a multiple of
four; ÷2 with Refrigeration. Oil −1 without Industrialization, else `(sz5 + 2) × adv/3`, ÷2
when no more than the oil supply, without a Factory ÷2 under size 5, ÷2 under 10, ÷2 under 20
(with one ×1½), ×3 with Automobile, ×2 with Superhighways, ÷2 with Mass Transit, ÷2 with a
Recycling Center. Uranium −1 without Nuclear Fission, else `adv²` shifted by `clamp(sz5 − 3,
−3, 0)`, ×2 with a Nuclear Plant or SDI Defense.

**Choosing.** For each commodity the lower of its two positive scores is zeroed, so it is
supplied or demanded, never both. Both lists are sorted (a stable bubble sort) and the three
highest non-negative scores become the city's supplied and demanded commodities. Then two
position hashes override the middle entries: `(5y + 3x) mod 14` for demand and `(7y + 13x) mod 14`
for supply (`mod 9 + 5` once the owner has 32 advances); equal hashes drop the supply one; a hash
already in either list is dropped; a dropped demand hash becomes Uranium when the owner knows
Nuclear Fission and no demanded entry is Oil or Uranium already; a dropped supply hash becomes Oil
when the owner knows Industrialization and no supplied entry is Oil or Uranium. Finally entries in
use are negated: a supplied commodity carried by one of the city's routes or by a caravan homed
there, a demanded one received by a partner's route back (Hides, number 0, cannot be marked — the
original has the same quirk).
