# The AI's strategic layer for units

Read from the per-civilization unit routine that the turn driver runs after the city turn,
0x004ed2dd (about 850 decompiled lines). It prepares the computer player's view of the world,
assigns a **plan** to every land mass, keeps a table of **objectives**, hands units go-to orders
toward them, and finally calls the per-unit move loop (0x004709d5, not yet read). VERIFIED
unless marked INFERRED; the engine does not implement this layer yet — see the last section.

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
   set the "fortified" flag bit. Under the **bloodlust** option, enemy units at half hit points
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
   `distance × (budget / (1 + (type is 0))) / (priority + 1)`, with air units kept inside their
   range; defenders already fortified only move for high-priority objectives; the closest wins
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
- **Diplomats (role 6)** pick a city: own cities score `99 − distance`; foreign cities score 100,
  plus our attitude toward the owner, or plus 100 when at war, divided by `distance + 1`, halved
  for a city already "worked" (city flag bit 3) and halved again when the owner is six or more
  advances ahead, and halved for treaty partners unless a long list of conditions says the
  partner is a fair target (not human, or behind in advances and score, or ahead on our land
  mass). Then +100. The best city becomes the go-to target.
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
- **Transports (sea units with holds)** in a city release fortified cargo. With room to spare
  they look for an own city flagged "wants units" (city flag bit 7) on another land mass whose
  plan is not 4 and whose unit count is below its wanted number (0x004f266b): scored by distance,
  +16 when the port already holds four transports, +16 or −(units on that land mass / 4)
  by plan. The chosen city becomes the target (tag `3`) and objectives are posted at the port so
  land units gather: "defend" and "escort" (types 5 and 21) at priority 2 or 4 by plan, "attack"
  (type 1) and "settle" (type 0) the same, "explore" (type 6) under plans 4 and 5, and a
  "board" objective (type 7, priority 2). A transport that cannot find a destination ferries to a
  city of any civilization on another land mass scored by `trade × distance factor`, ×½ for own
  cities, −⅓ at war, +⅓ for allies, and falls back to a random square on another land mass
  (tag `V`) or a random walk (tag `6`).
- **Loaded transports with cargo** head for the nearest enemy land with a city we can attack
  (tag `A`), for a war target with a human we are fighting (tag `I`, scored by distance, halved
  when another human is also at war with the owner, doubled against a walled city), for the
  nearest "wants units" own city on another land mass (tag `4`), for any enemy city scored
  `trade × distance / 8` (tag `T`), or unload where the cargo's land mass is wanted (tag `5`).
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
50`. The odds (0x0052d472, the combat evaluator) are scaled: `× (sum of costs in the enemy
stack + 1) / own cost`, ×3 for a city, ×2 for a naval unit attacking a transport; for a unit
   not needed as a defender ×2 under plan 0, ×2 when the stack's attack total is more than
   twice its own, ×2 when the enemy stack has attackers, ×2 with an attack objective on our
   square, ×2 under the bloodlust option when the defender has a third of its hit points or less,
   ×3 against a defender type with flag bit 3; a unit needed as a defender halves the odds and
   drops to 0 unless its attack beats the target's. Against barbarians non-combat targets +12;
   diplomats double. Odds of 6 or more (12 against barbarians) add `4 × odds`; below that the
   direction is out, and a fortified lone enemy on rough ground is instead subject to the demand
   routine (0x0049c5c6, INFERRED a diplomatic demand) one time in three. At peace or cease-fire a
   unit never attacks; against a treaty partner on plan 0 or beside an own city at Prince and above
   the demand routine runs instead (one time in eight, always when a human's city is nearest).
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

## What the engine does

`packages/engine/src/aiUnits.ts` ports the direction choice above for ground units: the random
base, terrain and stacking terms, the turning penalty, the treaty avoidance (with the engine's
war-by-default stand-in for treaties), the undefended-city and village bonuses, the exploration
terms over a per-civilization "seen" mask (map byte 4, kept by the world and revealed with a
sight radius of one around units and the city radius around cities — INFERRED radii), the
attack gate and the fatigue rule. Settlers follow the verified site rule over the fertility
rating and territory (`fertility.ts`, exact against the shipped fresh game), and the defender
quota is the verified formula. Stand-ins marked INFERRED in the code: the combat evaluator
(eight times the strength ratio replaces 0x0052d472), continent plan 5 for the quota, the
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
