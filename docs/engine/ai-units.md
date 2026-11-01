# The AI's strategic layer for units

Read from the per-civilization unit routine that the turn driver runs after the city turn,
0x004ed2dd (about 850 decompiled lines). It prepares the computer player's view of the world,
assigns a **plan** to every land mass, keeps a table of **objectives**, hands units go-to orders
toward them, and finally calls the per-unit move loop (0x004709d5). VERIFIED
unless marked INFERRED; the last section says what the engine implements.

## Order of work

1. **Paratroopers.** A computer civilization that knows the paradrop advance and has the paradrop
   flag set repositions paratroopers so that enemy cities within drop range have a paratrooper in
   an own city within range.
2. **Wonders per era** are recounted (four eras of seven wonders).
3. **Per-continent tables are rebuilt:** own units, own attack strength, caravans, cities and
   city sizes per land mass; civilization totals of units, cities, sea units, population, attack
   and attack + defence; units of each type owned and in production.
4. **Settlers:** each settlers unit without a home city is flagged; a land mass wants
   `(d / 2 − expand − 1 + cities on it) / d` settlers where `d` is 4 under Anarchy or Despotism,
   3 up to Fundamentalism, 2 under Republic and Democracy (+1 for Engineers), capped by the number
   of settle objectives on that land mass; surplus settlers lose the flag. A homed settler within 4
   squares of its city marks the city "has a worker nearby".
5. **Order hygiene for computer units:** a sentried unit wakes unless it is a ground unit at
   sea; orders above 15 are cleared; a unit with no order standing in a foreign zone of control
   gets the AI's hold order (16), which keeps it out of this turn's assignment. Fortify orders
   set the "fortified" flag bit. With simplified combat off (hit points matter), enemy units at half hit points
   or less that the civilization can see become attack objectives (type 0 on land, 2 at sea).
6. **City objectives.** Every own city with no unit on it posts a **defend** objective (type 1,
   priority 5). Every foreign city the civilization may act against — once
   `difficulty × turn > 200`, or when it has seen the city, or when the owner is a computer
   player — posts, when at war with the owner and `(turn + city index) % 3 ≠ 0`, an **attack**
   objective (type 0) of priority 4, or 2 against City Walls; an empty city of a civilization
   with no treaty also posts a defend objective of priority 2 and an attack objective of
   priority 3.
7. **Continent plans** (per civilization, per land mass; the city advisor reads them). Another
   civilization counts as present on a land mass when it has combat units there and either its
   attack total exceeds a quarter of ours or it has cities there. Against each present enemy:
   when its units are fewer than our attack total, or its attack total below our unit count,
   or we have no city there, it is **outmatched**; otherwise it **outmatches** us. A present
   human at peace or cease-fire whose attack total exceeds half ours plus our unit count counts
   as a strong neighbour. Barbarian cities count as an outmatched enemy.
   - **plan 0 (attack):** any outmatched enemy is present, or the civilization has neither
     units nor cities on the land mass (unless only a peace partner's units are there);
   - **plan 1 (defend):** any enemy outmatches us, or a strong human neighbour is present; the
     land mass also gets the "watch" flag;
   - otherwise **plan 4 (full)** when the land squares are fewer than twice the units of every
     present civilization, or the rated squares (the fertility count) are fewer than
     `(cities of every present civilization) × d + 2` where `d` is 6 (7 once the leading human
     has more than four cities after turn 150), plus the leader's expand value plus 1 when no
     foreigner is present — and only once the civilization knows Map Making; else **plan 5
     (room to grow)**.
     Per land mass the civilization also notes whether enemies or peace partners have cities or
     units there (flags 1, 2, 4, 8). Plans 0 and 1 are what the city advisor treats as the
     "military" continent flag.
8. **Lost civilization:** a computer player with no settlers and no cities is removed; every
   eighth turn its diplomacy is revisited.
9. **Objective assignment.** Each objective has a position, a type and a priority (how many units
   it still wants). Walking the units from the last record down, a computer unit with an
   assignable order (none, hold, go-to or a work order) is scored against every objective whose
   type matches its AI role (0x004ecd17; bombers against walled cities when they can attack them):
   `distance × (budget / (1 + (type is 0))) / (priority + 1)`. Air units differ: a fighter takes
   an objective within `(moves − 2) / 2` at plain distance; a bomber takes odd priorities on
   alternate turns at `distance × (4 in reach, else 2) / (priority + 1)`; aircraft with a Fighter's
   attack or more also answer naval objectives, on any land mass; defenders already fortified only move for high-priority objectives; the closest wins
   and receives a go-to there (or the hold order when already on the square), and the objective's
   budget rises. The budget per objective is `clamp(units / 8, 3, 99)`, doubled for type-0
   objectives.
10. **Free upgrades (computer only):** one unit in sixteen each turn (by `turn & index & 15`)
    whose type is obsolete — or Warriors under Monarchy and above on a "full" land mass — is
    upgraded in place to the successor of the same role, unless a human can see it, it stands in
    a city with other defenders, or it sits in a fortress; in those cases it is disbanded into
    the nearest city's production box for half its cost.
11. **Scenario special case:** with the "special WWII AI" flag, civilization 3's armour and
    alpine troops in a band of rows receive scripted go-to targets.
12. Finally the objective housekeeping runs (0x004709d5): objectives already consumed
    (negative priority) are dropped, this turn's priorities are negated (an objective lives for
    the turn that posted it), and the 16 **persistent goals** (civilization record +0x534, same
    6-byte layout, added with 0x004707c5 and removed by type within a distance with 0x0046ffe5)
    are posted again. The objectives table itself is 48 entries of 6 bytes at civilization
    record +0x414: x, y (i16), type (the AI role wanted: 0 attack, 1 defend, 2 naval, 4
    transport, 5 settle, 21 work; −1 empty) and priority. Adding (0x004703f8) does nothing when
    the square and type already carry at least the priority, else inserts before the first
    lower-priority entry and drops the 48th.

## The move chooser (0x004f44cc)

Read in full (about 3000 decompiled lines). It is called once per unit from the civilization's
unit loop (0x004ff777 → 0x004ff621); a unit keeps being called while it has moves, up to twenty
times. It returns 1 when the unit's turn is over and 0 after a step. VERIFIED unless marked.

Barbarian units use their own routine (0x004f0c4c), **air units** theirs (0x004f2dd3) and
**nuclear units** theirs (0x004f26ee); none of the three is read yet. A unit with a terrain order
is left alone.

### Facts gathered first

Terrain and whether the square is a fortress; whether it lies in a foreign zone of control
(0x005564c0: no city here and a non-allied foreign unit of the same domain adjacent); the nearest
city of anyone and the nearest own city (0x0042c0ca), their distances and land masses; the unit's
AI role (0x004ecd17), domain, flags and the continent plan of its land mass; and a damage level —
0 none, 1 some, 2 a quarter or more of the hit points lost, 3 half or more. Every decision below
writes a one-letter tag into byte 12 of the unit record (`9 0 A B F I M P R S T U V X a b d i m p r
s t u`), the letter the original shows next to computer units in its debug mode.

### Special cases, in order

- **Sneak attacks.** A unit standing in the zone of control of a civilization it is at peace with
  lowers that civilization's attitude; against a human above Prince, when reputation allows and
  the human is ranked higher, the computer may declare war on the spot.
- A ground unit of role below 6 adjacent to a foreign city with no treaty drops its order and
  heads for the city.
- **Damage.** A damaged unit adjacent to an own city goes home; badly damaged units fortify on
  rough or fortified ground to heal; a transport without moves waits.
- **Diplomats (role 6)** pick a city reachable by land: own cities score `99 − distance`; others
  100, halved under a treaty, plus our attitude toward the owner or plus 100 at war, divided by
  `distance + 1`, halved for a city already robbed (city flag bit 3) and again if its owner leads
  by more than six advances (and set to 1 under space race pressure), then +100. Distance is 8 more
  for a city not in the unit's third of the table, once beyond 3 squares (4 from a road). **A treaty partner is
  skipped** if it is a computer player, or already robbed. Without space race pressure a human one
  is also skipped if it ranks below us; if the unit is no Spy, its owner is under ten advances ahead
  and we are a Republic or Democracy, it ranks under 7, or it is an ally behind us; or if, not
  allied, it is a Republic or Democracy whose attack total here beats our unit count on a land mass
  where we hold cities. A Diplomat with
  no target and no go-to disbands (VERIFIED).
- **Caravans (role 7)** pick a destination on their land mass: `(trade of home + trade of
target) × distance / 24`, halved for own cities, scaled by `(200 − attitude) / 100` for foreign
  ones, halved when a route to it already exists, times `(5 − routes of the target) / 5`, and
  divided by three (halved again for a human) when a foreign city of a different owner is
  nearer. Without a candidate they go home, or to any own city on the land mass.
- **Settlers (role 5, and the "transform" role 21)** use the land value (0x00559162: the
  territory owner when a city radius claims the square — never a site — else the fertility
  rating raised to at least 8, else 0; docs/formats/map-format.md explains the rating and how
  founding a city takes 8 off the 45 squares around it). The value here is capped at 8 within
  three squares of a city on the same land mass, then compared with the 20 squares around (same
  land mass, not ocean); a strictly better square becomes the candidate. When the best is above
  7 and the settler is not in a foreign zone of control, it acts if `best ≥ 15 − distance to the
nearest city`, or the best is here and the land mass has no own city yet, or the best is here
  and the settler has waited more than four turns (unit byte 14 counts): found when the best is
  here, else step toward it (a go-to for the outer squares). The very first settler founds at
  its start position on turn 1. A combat unit that finds a better square nearby adds a "settle"
  objective there, and a combat unit next to a village steps onto it. At Prince and above a
  settler next to a stronger human's city with a square of value above 8 and `≥ 14 − distance`
  founds at once.
- **Workers (VERIFIED, the handler's block after the settle rule; `aiTerraform.ts`).** The setup
  clears a computer settler's "wanted" flag when its nearest own city is more than eight away or
  on another land mass. Then, for any settler-type unit on a square without a city: alone (no
  stack, no unit on a neighbour) it adds a defend objective (type 1, priority 2) on its square
  and consumes work goals there; polluted → clean it; at an isthmus (chokepoint 2, below) with no
  foreign non-allied unit adjacent or in a stack → fortress; a square holding a work objective
  counts as wanted (`want = 1`); within two of a city whose size is at least `irrigate turns / 5
× 3 − 3` for the terrain (or on a special) and improvable (0x00558029: no city, mine or
  irrigation; irrigation needs water on the square or a corner neighbour, a result terrain and an
  AI government level 1 … the owner's government; a mine likewise without irrigation) — or on a
  "full" land mass — counts doubly (`want |= 2`): then irrigate or mine; else a road where
  something is already built on a river or on desert, plains or grassland, or (road present,
  Railroad known) a railroad on a special, a mine or two-shield terrain; a chokepoint of either
  kind → fortress; next to a city, the first of the eight neighbours (from `turn & 7`) without a
  city, holding no foreign unit or settler, improvable, fitting the size rule, within two → step
  there; a bare desert, plains or grassland square within two of a city → road. For a wanted
  worker (role 21) away from any city: home (the home city, or the nearest own city when the home
  lies on another land mass) when more than four away; a road here when none; the nearest own
  city when a non-allied foreign unit is adjacent; within two of a city: a mine when the terrain's
  mine AI level is below its irrigation level, else irrigation (bare squares only), pollution,
  a railroad (Railroad known), then a go-to to the first radius square of the nearest city that
  is bare (mine or irrigation by the same priority) or lacks a road (or a railroad once known);
  farther out only the railroad applies. The engine skips water squares the original would
  order a go-to onto (INFERRED). Rivers need Bridge Building for roads throughout.
  **Chokepoint** (Construction known, settler-type or defender, next to no own-only city, no
  fortress here, not ocean): a neighbour with a lone fortress or a city, four or more ocean
  neighbours, or a defend objective on a neighbour → none; a road square two or three from the
  nearest city (own = nearest of anyone) → 1; ocean or lone fortresses two squares away on both
  north and south (and not both east and west) or both east and west (and not both north and
  south) → 2. A settler-type unit adds a defend goal (type 1, priority 2) there; another unit a
  work goal of priority `chokepoint + (distance < 4)`.
- **Terrain tasks from the city turn (0x004bc284, VERIFIED):** each polluted radius square
  becomes a work objective of priority 6; else the first missing link toward another city of the
  owner's on the land mass within 22 squares (then of a civilization at peace or allied): the
  go-to path is walked up to 50 steps and the first square without a road (rivers need Bridge
  Building) or, Railroad known, without a railroad, becomes the objective when nobody else claims
  or stands on it — priority 2 for a road, 5 for a railroad, +1 above size 4, +1 with the
  Palace, −1 below size 4. The city remembers an open task (flag bit 19).
- **Paratroopers** (flag bit 0 of byte 5) in a city with full moves drop next to an enemy city of
  a civilization we are at war with and within the paradrop range (cosmic byte 0x13): the city
  square itself scores 500, a fortress +50, defensive terrain ×3, plus distance; the drop is
  refused when an own unit already stands there.
- **Defenders in a city.** The city wants `size / d + 1` defenders where `d` is 3 in a foreign
  zone of control, else 4, +1 under plan 5 without a Palace and −1 with one; a capital wants at
  least 1, 2 (size above 3), 3 (eight or more cities) or 4 (twelve or more). The best defender (0x0052b823) stays
  fortified; when the city holds more than it wants, a surplus unit whose index matches
  `(turn + index) & 7 == 0` is released; a lone defender in a city with a weaker neighbour adds a
  "defend" objective (type 5, priority 1).
- **Transports (sea units with holds)** in a city release fortified cargo. With room (three
  units at most in a city, one elsewhere) they look for an own **coastal** city to collect from
  (tag `3`, VERIFIED 0x004f44cc): reachable, not already chosen by another ship, and scored by
  distance, +16 when transports already stand there, `− attack total on that land mass / 4` when
  its plan is 4 or it has no land flags, else +16. A land mass **short of units keeps them**: such
  a port is skipped unless caravans wait there. The ship goes when the score beats 6 (12 for a plan
  4 land mass), and only every fourth turn from a city, unless it is settlers only. Objectives
  gather land units **at the destination**: "defend" and "escort" (types 5, 21; priority one less
  for the second) unless settlers stand there or the plan is 5, "attack" and "settle" (types 1, 0)
  unless that is the plan, "explore" (6) under plans 4 and 5, and "board" (7, priority 2). Failing
  that, a port with fewer than two transports and units to spare gathers them there and the ship
  waits, three times in four. Otherwise the ship takes the chain for a loaded one.
- **Loaded transports with cargo** without a go-to take the first of these that finds anything
  (0x004f44cc). Reach is by ocean: in port, a city sharing one of the port's oceans or land touching
  one; at sea, the ocean the ship is on. "Cargo" is the mask of cargo roles.
  - `A`, with attackers or defenders aboard: the nearest own city on a defend land mass within 24;
    an empty one counts half, one with a type 1 objective two thirds.
  - `I`, same cargo: the nearest undefended city of a civilization we are at war with; half for a
    war a human ally shares, double for a known Coastal Fortress. It also sets the ship's step.
  - `4`, unless the cargo is settlers alone: every eighth city from the ship's step, of a
    non-ally we are not at peace with (or whose peace is strained), on another land mass, and only
    if the top-ranked civilization is not a human other than us; half for an ally's war, half for
    a grudge, half for an empty city at war, double for a known Coastal Fortress.
  - `T`, a caravan aboard: the best city on another land mass by distance from the caravan's home
    × trade / (distance from here / 8 + 1); half for own cities, −⅓ at war, +⅓ allied, half for a
    human ranked first.
  - `5`: the nearest own city over 7 away on another land mass not full, doubled when the cargo has
    no role matching that land mass's plan.
  - `V`: one random square of a land mass rated above 16 with no own city, reachable, kept while the
    go-to runs. `6`: 22 random rays from here for such land, the last hit winning. Both sail for an
    ocean square beside that land (0x004ed0e3).
  - Otherwise the direction chooser.
  - **Landing** (0x004f44cc, tags `b`, `U`, `u`), for a ship with no room at sea, except one bound
    for a coastal own city of tag `A` on this ocean on 15 turns in 16. For each land neighbour free
    of foreign units, skipping one near a peace partner's city unless carrying caravans, the ship
    lands when: units there are short of wanted and the plan is not full; there are no own cities and
    under 8 units; the plan matches attackers or defenders aboard; attackers are near a human enemy's
    city, far from our own; the go-to was bound for that land; or the ship is hurt past a quarter.
    Non-settler cargo on unflagged land lands only if nobody is there and it has over 49 squares,
    flagging it and sending one unit first. Beside a city at war it lands; caravan-only cargo lands
    only for a caravan's reasons. With a move left it first steps to the best square to land from
    (0x004ecd74). Landing ends the ship's move and wakes the cargo.
- **Pollution and fortresses.** An Engineers unit (role 21) or settler finds the nearest
  pollution within the radius of its city and goes to clean it (tag `p`); on rough terrain
  between two own cities, or at a choke point between oceans, a settler builds a fortress (tag
  `X`); otherwise it works the square it stands on when the city needs it — mine when the terrain
  mines to shields, irrigate when a water source is adjacent and the city has food to gain, road
  when the square is a worked square (tags `m`, `i`, `r`, `R`), with the same choices applied to
  the 21 squares of the city radius when the home square needs nothing.
- **Fortify where you are.** A defender outside a city with no objective fortifies on a fortress
  or on terrain with a defence factor above 1 when enemies are near (tag `F`). An attacker
  without an objective on a land mass with plan 0 or 1 holds in place.

### The direction choice

Any unit that reaches the end without a decision scores its eight neighbours and steps to the
best one (tag `9`), or stays when nothing scores above the floor of −999.

Before any scoring, a square is skipped when the unit stands in a foreign zone of control and
the square lies in one too (0x005564c0 on both), unless the unit ignores zones of control or a
unit of the first five roles already stands there (VERIFIED: the loop's candidate gate; the
move rules would refuse such a step, and a unit that kept choosing one never moved).

1. **Base.** A random 0–4. A unit that no other civilization can see (unit byte 9, the
   visible-to mask, is zero) explores instead: random 0–2 minus twice the move cost (attackers)
   or minus the defence factor (others). Air units use random 0–2 only.
2. **Terrain.** With no own unit on the square, combat roles add `4 × defence factor`;
   non-combat roles add `6 − (move cost − 1) × road multiplier`, and when the square is one step
   from a foreign city within three squares, −4 on rough terrain else +8, or +4 two steps away on
   a road.
3. **Stacking with own units** in a foreign zone of control: attackers +8 when the stack has
   defenders and no attackers, else −8 per attacker; defenders +8 when it has none, else −4 per
   defender; naval units +8 with a transport present else −4 per naval unit; transports +8 with a
   naval escort else −8 per transport; settlers −4; diplomats +8 when the stack has fighters.
   Elsewhere: attackers `+ 4 × attackers / (units + 1)`, defenders `+ 2 × attack sum /
(attackers + 1)`, settlers `+ 2 × (defence factor + attackers)`, diplomats +8 with fighters.
4. **Turning penalty** `−2 × (steps of turn from the last chosen direction)²` (unit byte 11).
5. **Treaties.** An empty square for a combat role: when the nearest city belongs to a
   cease-fire or peace partner that is not an ally (and the peace is fresh or our attitude is
   below 50): moving away within three squares +5, moving closer rejects the direction, same
   distance −5. A treaty partner's territory (map byte 2) is rejected under a fresh peace, else
   −5 and −3 more when the square carries irrigation, a mine or a road. An allied unit on the
   square −6. A foreign city on the square with any treaty is rejected (unless its owner has a
   vendetta against us and reputation 7 or more); without a treaty it scores 999 — an undefended
   city is taken. A village +20.
6. **Exploration** (outside zones of control, with no objective, and unless the scenario forbids
   it): the square four steps out in the same direction adds +8 on unseen land or +2 on unseen
   ocean; each of its eight neighbours adds +2 when unseen and −2 when a unit stands there;
   settlers add the terrain food of those squares. Polar rows divide the score by 3.
7. **Attacking.** An enemy unit on the square: settlers, caravans, transports with cargo, and
   units attacking from a ship without the amphibious flag never attack. A ground unit may not
   attack an aircraft in the open unless it has "can attack air" (0x5cfddc bit 4); a city or
   airbase makes the aircraft attackable. With no cease-fire or peace, computer owners are
   evaluated directly; a human owner only when `reputation × 5 + attitude + random(0..19) − 10 >
50`. The odds come from the combat routine's evaluate-only branch (0x0052d472, VERIFIED:
   `8 × A / (D + 1)` over the real-fight strengths weighted by `hit points + firepower × 8`
   when hit points matter, capped at 1024 — combat.ts `combatOdds`) and are scaled: `× (sum of costs in the enemy
stack + 1) / own cost`, ×3 for a city, ×2 for a naval unit attacking a transport; for a unit
   not needed as a defender ×2 under plan 0, ×2 when the stack's attack total is more than
   twice its own, ×2 when the enemy stack has attackers, ×2 with an attack objective on our
   square, ×2 with simplified combat off when the defender has a third of its hit points or less,
   ×3 against a defender type with flag bit 3; a unit needed as a defender halves the odds and
   drops to 0 unless its attack beats the target's. Against barbarians non-combat targets +12;
   diplomats double. Odds of 6 or more (12 against barbarians) add `4 × odds`; below that the
   direction is out, and a lone enemy that is veteran or fortified, on terrain defending above 1.5 or in a
   fortress and not in a city, is instead **bought** (the bribe, 0x0049c5c6, with no Diplomat) one
   time in four, by a ground unit of role 0 on plan 0. At peace or cease-fire a
   unit never attacks; against a treaty partner on plan 0 or beside an own city at Prince and above
   the bribe runs instead (one time in eight, always when a human's city is nearest; only where
   no human has a city on the land mass, or the victim is a computer on bad terms with no human).
8. **Fatigue.** An attack reached with less than a full move left keeps the score only in a
   city; when the best score came from such an attack the unit waits for next turn.

The move is a one-step go-to (order 27, target = the neighbour). A unit that stays fortifies
(settlers excepted), air units end their turn, and a unit whose go-to target is its own square is
marked "arrived" (unit flag bit 7).

**Helpers VERIFIED along the way:** 0x00558f04 ocean at square · 0x00558f3d owner nibble of map
byte 5 (15 = nobody) · 0x005591c6 city owner at square · 0x00559282 unit owner at square ·
0x00559235 airbase owner · 0x0055951a village at square (the hut formula in
`terrainSpecials.ts`) · 0x00556397 / 0x0055629a foreign non-allied unit adjacent (same domain /
any) · 0x00559085 square seen by civilization (map byte 4 bit n) · 0x00558fc8 land mass of a land
square · 0x00556aea units of a role in a stack · 0x005567e1 stack totals (mode 0 cost, 1
defence, 2 count, 3 attack, 4 homed defenders, 5 sea units, 6 free cargo room, 7 ranged aircraft,
8–10 flag counts).

## Air units (0x004f2dd3, VERIFIED; ported in `aiAir.ts`)

The move chooser hands aircraft to their own routine. It first works out the **fuel budget** in
movement points: `(range − turns flown − 1) × full moves + moves left` (twice the full moves for
range 0), and the distance to the nearest own city.

- **Return to base.** A fighter (range 1) with no go-to, half its moves or less left and the
  nearest own city just within the budget turns home (tag `H`, the return-to-base routine
  0x0049857a). A bomber (range above 1) that has flown half its range or more and can still
  reach the nearest own city does the same.
- **Missiles** (the destroyed-after-attacking flag, attack below 99) look for an enemy
  non-air unit within the budget worth at least four times the missile's own cost: a unit in a
  city, fortress or airbase is worth its cost (doubled when alone, doubled again with an own
  unit adjacent), a stack in the open its total cost; doubled at sea and doubled on a fortress,
  plus the type's capacity. The missile is placed on an empty square beside the best target and
  attacks it at once. With more than one missile stacked and none worth firing, the surplus is
  moved to an own city within the budget that holds fewer. Otherwise it waits.
- **Fighters (role 3)** score every visible enemy unit of a civilization they are at war with:
  aircraft by `2 × distance` (halved for a human's), −1 for ranged types and −1 when alone;
  other units only when the fighter's attack, hit points and firepower (×3 when veteran, ×2
  otherwise) beat one and a half times the target's defence, hit points, firepower and terrain
  factor and the target stands alone (transports: fewer than two ships). The lowest score wins.
  It attacks when adjacent with fuel to reach home afterwards, or when it cannot reach home
  anyway; otherwise it checks the empty squares beside the target for one from which an own
  city is reachable inside the budget and goes for the target when the round trip fits (tag
  `A`). Failing that it moves to the own city nearest the target within the budget, or to a
  human's city that allows it under a treaty (tag `a`), else waits (tag `h`) or turns home.
- **Bombers (role 0 with range)** with fuel left score every enemy city of a civilization
  without a treaty within reach that holds units: `size × 10 − units × 25`, +40 on the bomber's
  land mass, +60 for each own unit adjacent; the best becomes the go-to (tag `B`). A bomber
  already on a go-to with its fuel spent reports that it must land.

## Barbarians

**Where they appear (0x00465e35, once per turn from the turn driver, VERIFIED).** Nothing
with barbarian activity 0. The schedule starts at turn `((3 − activity) × 3 + 30) × (5 −
difficulty)` below Deity, `(3 − activity) × 3 + 15` at Deity.

- **Sea landings** every 16 turns at Roving and every 8 at Restless and Raging (`(turn + 1) &
mask == 0`), only while nobody knows the prerequisite of unit type 22 (Armor — Mobile
  Warfare in the shipped rules). A random empty ocean square (rows 3 to height − 4) in a water
  body of at least 16 squares is tried up to 1000 times. The party is `clamp(turn / (250 − 50 ×
activity) + 1, 1, 5)` plus 1 (plus 2 at Raging) units: the last is the **leader** (the
  Diplomat type, 46), the rest a troop type — Warriors; Archers with options byte 0 bit 0 (set
  in every shipped file); Legion when a human knows Iron Working; Knights (Crusaders on odd x
  with that option bit) when anyone knows Metallurgy, or Chivalry at Raging; Dragoons when a
  human knows Tactics with the option bit. They board a Trireme, a Caravel once anyone knows
  Navigation, a Frigate with Magnetism.
- **Uprisings** every turn near one random city when it is a human's: the chance in percent is
  the city's plunder value (conquest.ts). The square is picked within six squares (x offsets −6
  to +18 in steps of two, as the original rolls them, y −6 to +6) at distance 5 or more from
  every city, outside the barbarians' zone of control, on land, empty and on the land mass of
  the nearest city, with `50 × activity` tries. The party is `random(size)` units (at Raging
  after turn 149, one time in `10 − difficulty`, half the size more plus `random(size / 2)`),
  clamped to 2–99, plus the leader; every fourth index is type A, the rest type B: Chariot/
  Horsemen (swapped one time in three); Archers/Elephant with Gunpowder and the option bit;
  Cannon/Musketeers with Industrialization, Riflemen for B once Mobile Warfare is known, then
  Artillery for A with the option bit, and with Guerrilla Warfare Cavalry/Partisans when the
  human is below Republic or the city was taken from its founder, else Fanatics for B.

**How they move (0x004f0c4c, VERIFIED).** A barbarian on the two polar rows is removed.

- **Ships** vanish with fewer than two passengers (leaders excepted) or after thirty turns at
  sea (unit byte 13 counts). Beside land on the land mass of a city within eight squares, with
  no city on the square, they unload — unless the party is fewer than three without an attacker
  or defender and the city is within two squares, when the ship vanishes. A foreign ship
  alongside is attacked. Otherwise the ship sails for the city with the highest `(plunder +

50. / (distance + 1)`, or vanishes when there is none.

- **On a city or a fortress** a unit stays fortified unless the stack (leaders excepted) is
  larger than one or it stands in a zone of control and it is not a defender, or the stack is
  at least 2 (+1 on a city, +1 outside zones of control) and its attack is at least its
  defence.
- Every fourth turn (`(turn + unit index) & 3`), a land unit whose nearest city is on another
  land mass or more than eight squares away vanishes.
- The preferred heading points at the nearest city when it is a human's on the same land
  mass and its owner has at least two cities and 100 gold.
- **Leaders** stay with a stack; alone on land they go to the nearest barbarian stack within
  three squares when it is led by an attacker or defender, else vanish once the nearest city
  is `(turn & 7) + 4` or more away; at sea they vanish within two squares of a city.
- **Direction scoring** over the eight neighbours of the unit's domain. For combat roles: a
  foreign city with no unit in it is taken outright — for a human owner first a **ransom** of
  the larger of `size × 25` and `max(50, treasury / 2)` is demanded (a human with more than
  four cities after 200 AD: the treasury rounded down to hundreds, or the treasury plus one
  when that is below 1000); paying clears every barbarian unit in the city's radius. Otherwise
  the square scores +4 when someone else stands or lives there, +8 for a fortress, else +6 for
  irrigation or a mine, plus random 0–5; an empty square must pass the zone-of-control gate (not
  in a zone of control now, or not an attacker, or the square is outside one, or the unit
  ignores zones); the last direction +6, each matching heading sign +2; a square with a foreign
  unit that is not a leader scores +99 (Partisans only attack non-combat units); a barbarian
  unit's square is skipped on land and −20 at sea. Ships and leaders score +99 for a barbarian
  unit, −99 for a foreign one, plus the move cost, random 0–2 and four times the distance to
  the nearest city. The best (later ties win) is taken.
- A lone unit in a city stays unless an attack scores. With no attack, full movement and a
  human's city nearest, a square with irrigation, a mine or a fortress (a road for Partisans)
  is **pillaged** instead of moving.

The engine's `barbarians.ts` ports both routines; the RANSOMCITY dialog is a callback the web
app may answer (unset means refuse), and barbarians take an empty city by moving in.

## What the engine does

`packages/engine/src/aiUnits.ts` ports the direction choice above for ground units: the random
base, terrain and stacking terms, the turning penalty, the treaty avoidance (with the engine's
war-by-default stand-in for treaties), the undefended-city and village bonuses, the exploration
terms over a per-civilization "seen" mask (map byte 4, kept by the world and revealed with a
a sight radius of one around units, two for units with the two-square-visibility flag on squares of their element — VERIFIED 0x0041aad6, see rules-movement.md — and the city radius around cities (INFERRED)), the
attack gate and the fatigue rule. Settlers follow the verified site rule over the fertility
rating and territory (`fertility.ts`, exact against the shipped fresh game), and the defender
quota is the verified formula. Stand-ins marked INFERRED in the code: continent plan 5 for the quota, the
go-to toward an outer site square as greedy steps. Still interim: settlers with nothing to found
improve squares near their cities or explore; caravans deliver their cost to a wonder in
progress; surplus defenders walk to a city short of its quota in place of "defend" objectives;
ships and aircraft hold. Barbarians are everyone's enemy; every other pair of civilizations is
at war unless listed in the game state's peace list, the original's state before contact. The
strategic layer (`aiStrategy.ts`) is ported: tallies, continent plans, the objectives table with
its housekeeping and persistent goals, settlers wanted, free upgrades, and the assignment that
hands ground units go-to orders; aircraft are not assigned yet, hold is modelled as fortify, and
the immediate go-to for naval and air objectives is left out. The barbarian, air and nuclear
choosers and the combat evaluator remain to be read.

## Reactions outside the move chooser

- **A city left empty** by a fight it survives (0x0052d472): a computer owner re-chooses production
  in all its cities on that land mass at once (0x00431591, 0x00430b61 with 99). Under a human owner,
  every loaded computer transport at sea within reach, not at peace with the owner, turns for the
  city (0x004f2495).
- **A computer caravan's commodity** (0x004b7c3c): the first unused entry of the city's supply list
  from a random start, else any of the three.
- **The warned-off flag** (0x0046732a) clears on the unit's turn in four unless it was warned in the
  turn just gone.
