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

Every sixteenth turn (and when flagged) a city recomputes the three commodities it supplies and
the three it demands from its surroundings (not yet read; the engine keeps the file's lists —
INFERRED for new cities, which start empty). Entries in use are negated: a supplied commodity
carried by one of the city's routes or by a caravan homed there, a demanded one received by a
partner's route. Oil and Uranium take a slot once Industrialization and Nuclear Fission are known.
