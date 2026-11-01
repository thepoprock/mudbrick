# Units: movement, orders, terrain work, founding cities

Everything here was read from the original executable's unit move handler (0x00539099), the
settlers' work routine (0x00497340), the order validation (0x00535adf), the found-city routine
(0x005352e6) and the create-city routine (0x0042e8ff). Addresses and record layouts are in
[exe-notes.md](exe-notes.md). Engine: `packages/engine/src/movement.ts`, `terraform.ts`,
`founding.ts`.

## Movement points

Movement is counted in **thirds**: a unit with movement 1 has 3 thirds per turn. The allowance
(VERIFIED, 0x00554169) is in [rules-movement.md](rules-movement.md): Nuclear Power +1, Magellan's
+2 and the Lighthouse +1 (not triremes) for sea units; damage slows units when simplified combat
is off. "Moves left" = allowance − moves spent, never below zero.

## Cost of a step (VERIFIED)

For a **ground** unit stepping onto an adjacent square:

| condition (in this order)                                                             | cost                      |
| ------------------------------------------------------------------------------------- | ------------------------- |
| both squares have a railroad or are city squares                                      | 0                         |
| the unit is Alpine                                                                    | 1 third                   |
| both squares have a road, a railroad, or are city squares                             | 1 third                   |
| both squares have a river and the step is to an edge-neighbour (a diagonal on screen) | 1 third                   |
| otherwise                                                                             | terrain movement cost × 3 |

A **city square** counts as road and railroad (its square record carries the city bit; the move
handler tests road-or-city and railroad-or-city). Air and sea units pay one full move (3 thirds)
per step regardless of terrain.

## The partial-move gamble (VERIFIED)

A ground unit may attempt a step costing more than it has left. If it has **not yet moved this
turn** (moves spent = 0) the step always succeeds — this is why a one-point unit can always enter
mountains. Otherwise the original rolls `rand() % cost` and the step succeeds only when
`moves left > roll`; so the chance is `moves left / cost`. A failed roll ends the unit's turn
where it stands. The cost is then added to moves spent (which may exceed the allowance; moves
left is clamped at zero).

## Zones of control (VERIFIED)

A square is in an enemy zone of control for a civilization when a neighbour of the same kind
(land for land, sea for sea) holds a unit of another, non-allied civilization. **A city square is
never in a zone of control.** A ground unit may not move from a zone-of-control square to another
one unless it ignores zones of control, the destination holds a friendly unit, or it is
disembarking from a boat. Moving into a square with a friendly unit is therefore always allowed.

## Boarding, landfall and transports (VERIFIED)

- A ground unit may step onto an ocean square only if a friendly transport with free capacity is
  there; boarding **ends the unit's turn**.
- A ship ordered onto land with no city there asks to make **landfall**: a carried ground unit
  with its **full** movement allowance moves instead. With none available the move is refused.
- A ship entering a city wakes every sentried unit aboard.
- **Who sails (VERIFIED, the stack routine 0x00556b62 the move handler calls before relocating
  the ship):** the mover is detached from its square's stack (0x005572df); a ship first gathers
  its passengers into its own list, up to its capacity: the ground units sentried aboard it (a
  sentried passenger keeps the ship's index in its go-to x field), then — at sea — every other
  ground unit of the owner on the square; in port, a computer player's units that are not
  fortified (unless they stand on a land mass whose plan is "defend" and have a combat role), or a
  human player's sentried units not aboard another ship. Carriers take air units instead (not
  modelled). Then the ship and its list move together (0x00555214). The stack lists in the save
  are per owner and square (verified on the shipped scenarios: every multi-unit square is fully
  linked).

## Attacking (VERIFIED)

Moving onto a square held by another civilization's unit is an attack (resolved as in
[rules-combat.md](rules-combat.md)). A unit with less than one full move left is asked to
confirm (FATIGUE). Attacking from a boat needs the Amphibious Assault ability; submarines cannot
attack land; a unit with attack 0 cannot attack at all; sea units and fuelled air units cannot
occupy a city; nuclear units (attack 99) destroy it instead. Attacking a civilization you have a
cease-fire, peace or alliance with first asks whether to break the treaty.

## Air units (VERIFIED)

An air unit with a range lands when it ends its moves in a city, on an airbase, on a carrier, or
(missiles) on a submarine: its fuel counter resets. Otherwise each time it runs out of moves away
from a base its fuel counter rises by one, and it crashes when the counter reaches its range: a
fighter (range 1) must get home the same turn, a bomber (range 2) the next.

## Triremes (VERIFIED)

A unit that "must stay near land" ending its moves with no land in the 8 neighbouring squares is
lost with probability `1 / N`, where `N` is @COSMIC "chance of trireme loss" (default 2), doubled
by Seafaring (minimum 2) and doubled again by Navigation. The Lighthouse removes the risk.

## Orders

The save file stores an order as **RULES @ORDERS index + 1**, 0xFF for none (VERIFIED: Go To is
stored as 11, the fortify-complete step turns 1 into 2). At the start of its owner's turn a unit
continues its order: Fortify becomes Fortified, terrain work advances, Go To takes a step.

| @ORDERS | order            | notes                                                  |
| ------- | ---------------- | ------------------------------------------------------ |
| 0       | Fortify          | completes next turn as Fortified (1)                   |
| 2       | Sleep (sentry)   | woken by a ship entering a city, or by the player      |
| 3       | Build Fortress   | needs Construction                                     |
| 4       | Build Road       | road, or railroad when a road exists                   |
| 5       | Build Irrigation | irrigation, or farmland when irrigation exists         |
| 6       | Build Mine       |                                                        |
| 7       | Transform        | Engineers only                                         |
| 8       | Clean Pollution  |                                                        |
| 9       | Build Airbase    | needs Radio                                            |
| 10      | Go to            | up to 47 steps before the unit asks whether to give up |

## Terrain work (VERIFIED, 0x00535adf and 0x00497340)

Only settlers-role units (role 5) may work. Validation, in the original's order:

- **Airbase:** Radio known; not on a city, a fortress or water; no airbase already.
- **Fortress:** Construction known; not on a city or water; no fortress already.
- **Road:** not on a city or water; a river square needs Bridge Building; refused when a railroad
  exists; building on an existing road (a railroad) needs Railroad.
- **Irrigation / Mine:** the terrain row's irrigate / mine column decides: `no` is refused, `yes`
  adds the improvement, a terrain name changes the terrain instead (no further checks). Not on a
  city square. Irrigation needs **water**: the square or one of its four edge-neighbours is ocean,
  has a river, or is already irrigated. Irrigating an irrigated square makes **farmland** and needs
  Refrigeration; a farmland square is refused. Mining a mined square is refused.
- **Transform:** not on water; the unit must be Engineers (the original tests unit type 1).
- **Clean Pollution:** the square must be polluted.

**Turns needed** (work counter must reach this value):

| job             | turns                                                                      |
| --------------- | -------------------------------------------------------------------------- |
| Fortress        | terrain movement cost / 2 + 3                                              |
| Road            | 2 × movement cost; 4 × when a road exists (railroad); +2 on a river square |
| Irrigation      | the terrain row's irrigation turns                                         |
| Mine            | the terrain row's mining turns                                             |
| Transform       | movement cost × @COSMIC "transform base time"                              |
| Clean Pollution | 4                                                                          |
| Airbase         | 4                                                                          |

The counter rises by 1 each time the work routine runs — once when the order is given, then at
the start of every turn — and by 2 for Engineers. When another settlers unit on the same square
has the same order, its counter is **pooled** into the worker's and zeroed. On completion every
settlers unit on the square with that order is released. Effects: a fortress clears an airbase
mark; a road becomes a railroad when a road exists; irrigation becomes farmland; mining clears
irrigation and irrigation clears a mine (farmland holds both bits); a transform or
terrain-changing job sets the new terrain and drops irrigation or mines the new terrain cannot
carry; cleaning pollution lowers the world pollution count. The city square never carries these
improvements: founding a city clears them.

## Founding and joining a city (VERIFIED, 0x005352e6, 0x0042e8ff)

- Only a settlers-role unit on land may found a city, and never **adjacent** to another city.
- A settlers unit on a city square **joins** it when the city is smaller than @COSMIC "aqueduct
  size"; the unit is consumed.
- A new city has size 1, no stores, its founder set, and its square loses irrigation, mines,
  roads, railroads and fortresses. The civilization's **first** city gets the Palace.
- **Initial production:** among unit types 2 and up with the Defend role that the owner can build,
  the one with the highest `defence × 8 / cost rows` (+1 for the double-defence-against-horse
  ability); later types win ties.
- Late-starting AI civilizations (after turn 39) get free irrigation around their first city and,
  after turn 40, a larger first city with Temple, Marketplace and Library — see exe-notes.

## Huts (VERIFIED structure, 0x00537aa0; unit names INFERRED from the shipped rules)

Entering a hut with a ground unit rolls one of five outcomes (`rand() % 5`), then adjusts:

- An AI, or a human with a 1-in-3 roll, that owns at least one city but **none on this
  continent** gets the **advanced tribe** (outcome 0) when the continent has no AI plan or its
  nearest city is more than 12 squares away.
- **Advanced tribe:** refused within 3 squares of your own city (mercenaries instead), and for a
  civilization with no city before turn 50 while two or more unhomed settlers exist (mercenaries
  instead). Needs a land value above 11; otherwise nomads. Founds a city for you; after the year
  1000 it has size 1–4, a Temple, and 50 % / 33 % / 25 % chances of Marketplace, Granary, Library.
- **Mercenaries (1):** a free unit at the hut, 50 % mounted / 50 % defensive. Mounted: Horsemen
  (or Chariot 1 in 3) until anyone knows Chivalry, then Knights; Elephants 50 % once Polytheism is
  known; Crusaders with Monotheism, Dragoons with Leadership, Riflemen with Conscription.
  Defensive: Archers, then Legion (Iron Working), Musketeers (Gunpowder), Fanatics
  (Fundamentalism). The checks use "known by any civilization".
- **Gold (2):** 50; 1 in 3 rolls `rand() % 10 − difficulty + 2 < 5 ? 25 : 100`; doubled after the
  year 1000.
- **Barbarians (3):** within 3 squares of your city, or before turn 50 with no city: mercenaries
  instead. A weak AI (ranked below the leader) turns it into a city with chance `difficulty / 8`.
  With barbarian activity below Raging: before turn 30 (and 50 % until turn 50) the hut is **empty**
  when you have a city on the continent within 24 squares. Otherwise barbarian units appear on
  land squares around the hut: one unit until turn 49 (50 % until turn 74), several after,
  mounted on open terrain and foot units on rough, types rising with the advances the world knows.
- **Scrolls (4):** a random advance you could research now (searching upward from a random
  index); gold instead on turn 0 or once you know advance 38 (Invention in the shipped rules).
- **Nomads (5):** free Settlers, unless anyone knows advance 28 (Explosives: gold instead) or you
  already have more unhomed settlers than cities / 8 (scrolls instead).

## Pillage (VERIFIED, 0x0053644e) and disband (VERIFIED, 0x00535725)

- **Pillage** needs a ground unit with attack above 0, outside a city, on a square with
  irrigation, a mine, a road or railroad, a fortress or an airbase. With more than one, the player
  chooses: farmland, irrigation, mine, airbase, fortress, railroad (a railroad goes before the
  road). Pillaging inside another civilization's city radius while at cease-fire, peace or
  alliance asks whether to break the treaty and sours attitudes. The pillage itself (VERIFIED
  0x00498170) removes the chosen improvement, breaks the treaty (0x004447be) when not already at
  war with the owner of the city radius and declares war outright, and spends the unit's turn.
- **Disband** asks for confirmation. A unit disbanded inside a city adds half its shield cost
  (`cost rows × shield-box rows / 2`) to the city's production box.

## Fortify (VERIFIED, 0x00497b7a)

A Fortify order (0) becomes Fortified (1) at the start of the next turn; the unit then defends
with the fortified bonus of [rules-combat.md](rules-combat.md).

## Healing (VERIFIED, 0x00468f0f)

At the start of its owner's turn a damaged unit that did **not move** last turn heals
`maxHP / 10 × factor`: factor 1, or 2 on a fortress; +1 for a ground unit within 3 squares of
one of its own cities (+2 when that city has Barracks); doubled when standing in a city, and
doubled again — then made a **full** heal — when the city has the unit's building (Barracks for
ground, Airport for air, Port Facility for sea). An air unit on an airbase heals fully. A sentried
unit that reaches full health wakes up. A helicopter (air unit with range 0) that moved and is not
on a city or airbase square loses `maxHP / 10` instead.

## Go-to pathfinding (VERIFIED structure, 0x00485e3d → 0x00484325)

A go-to one square away steps straight. Otherwise, for a goal within 22 squares, the pathfinder
spreads costs outward from the goal over a window of 48 squares (a ring buffer of 2304 slots in
the original) and the unit takes the neighbour whose cost plus the step's own cost is lowest,
the one nearer the goal on ties; when the search fails and a waypoint finder (0x00485550) offers
an intermediate goal, it tries again with a looser limit. Step costs: 1 along a railroad (a city
counts as both road and railroad), 4 along a road, 4 along a river, 4 everywhere for alpine
units, else `terrain move cost × road multiplier × 4` for units with more than one movement
point and `road multiplier × 4` for the rest; squares with another civilization's units are
impassable; a square of own units outside a city or fortress in a foreign zone of control adds
16 per unit of the same role; a square beside an enemy unit adds a movement point for combat
roles; air units pay 1 a step. Beyond the window the unit falls back to a weighted greedy step
whose terms are the same costs plus the distance to the goal. The engine's `pathfinding.ts`
implements the search and the step choice; the greedy fallback is the engine's own.
