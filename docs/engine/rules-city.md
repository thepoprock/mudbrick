# City rules

Status: the per-city turn **structure** and the growth, starvation, celebration and revolt rules
are **VERIFIED by decompilation** (0x004bc513 city turn, 0x004b7654 growth, 0x004bafef
happiness/disorder, 0x004b3924 food constants, 0x00430ac9 growth blockers). Yield, happiness,
support, trade and production formulas are being read next; anything about them below is
INFERRED and labelled.

## Order of a city's turn (VERIFIED, 0x004bc513)

1. Every 64 turns a city held by a conqueror becomes "originally theirs" (founder := owner).
2. **Growth and starvation** (0x004b7654) on last turn's stored food. A destroyed city ends
   processing (the caller sees −999).
3. Totals computed (0x004b6f63 with 1): worker placement (0x004b49b5), yields, support, happiness,
   trade split. This pass runs with the city-turn flag 0x005b864c clear.
4. Food surplus = food − size × food-per-citizen − supported settlers × settlers' food, added to
   storage. FOODSHORTAGE warning when storage fell this turn and `stored + 3 × surplus < 0`.
5. **Production** (0x004b7e74), then the shield-shortage disband (0x004ba99a), then totals again,
   this time with 0x005b864c set. The workers are placed again in this pass, so a citizen spent
   on Settlers drops a spare specialist before happiness is judged, and a computer city puts one
   specialist back to work. This pass, not the first, is the "city turn's own recompute" below.
6. Per-civilization AI statistics: shield shortfall, units over each government's free support,
   and the attitude counters toward the human player.
7. **Disorder, celebration and revolt** (0x004bafef).
8. **Science** to the owner's research (0x004bb63d).
9. Human owner only: the pollution roll (0x004bb7bb) and **upkeep with forced sales**
   (0x004bbc98). VERIFIED by the call graph that computer players never do either: each routine
   has this one caller, and the per-improvement cost routine's other callers are the city
   screen, the sell dialog and the computer player's budget assessment (0x0049155b), which only
   reads. Computer cities neither pollute by the roll nor pay improvement upkeep.
10. AI worker and pollution task assignment for the city radius (0x004bc284).

The owner's turn (0x00467c61) processes its cities from the last slot to the first, then sets
the AI's rates (see rules-research.md). The turn driver (0x00469773) clamps the treasury to
0 … 30000 before the turn and autosaves afterwards when that option is on.

## Upkeep (VERIFIED, 0x004bbb67 and 0x004bbc98)

Each improvement costs its RULES upkeep every turn, with these changes:

- **Barracks:** one less at Chieftain and Warlord; one more once the owner knows Gunpowder and
  one more again with Mobile Warfare (the original walks the prerequisite chain down from Mobile
  Warfare to the first reachable advance, which in the shipped rules is Mobile Warfare itself).
- **Adam Smith's Trading Co.** pays every improvement whose upkeep comes to exactly 1.
- Under **Fundamentalism** the Temple, Colosseum and Cathedral cost nothing.
- Under **Anarchy** nothing is paid at all.

Payment runs over improvements 1–38 in index order. When the treasury would go negative it is
set to zero, that improvement is sold (the INHOCK message) and its full shield cost
(`cost rows × shield-box rows`) is added to the treasury. The engine's `payUpkeep` returns the
sale as an event.

## Food

- Each citizen eats `@COSMIC[2]` food (2). Each Settlers/Engineers unit supported by the city eats
  `@COSMIC[5]` under Anarchy, Despotism and Monarchy, and `@COSMIC[6]` from Communism up
  (government index > 2). VERIFIED.
- Surplus = food produced − citizens × 2 − settlers × settlersFood. Added to storage every turn.

### The food box (VERIFIED)

The city grows when `stored ≥ (size + 1) × K`:

- Human players: `K = @COSMIC[3]` (10).
- AI players: `K` depends on difficulty: Chieftain 15, Warlord 13, Prince 12, King 10, Emperor 9,
  Deity 8; after turn 200 at Prince or above, up to 2 less depending on the diplomatic situation
  of the leading human. If `@COSMIC[3]` is not 10, `K` is scaled by `@COSMIC[3] / 10` and made even.

On growth: size + 1; storage becomes 0, or `(size + 1) × (@COSMIC[3] / 2)` if the city has a
Granary **or its civilization owns the Pyramids** (the Pyramids act as a Granary everywhere).

### Growth blockers (VERIFIED, 0x00430ac9)

- size ≥ `@COSMIC[9]` (8) without an Aqueduct (improvement 9): growth is undone and the
  AQUEDUCT dialog shown once.
- size ≥ `@COSMIC[10]` (12) without a Sewer System (23): growth undone, FURTHERGROWTH dialog.

### Starvation (VERIFIED)

When storage is negative: if a Settlers-role unit (role 5) is supported by the city, it is
disbanded (FAMINE dialog names the unit); otherwise the city shrinks by one, and a size-1 city is
destroyed. Storage resets to 0.

## Wonders that have expired (VERIFIED, 0x0043e2b0)

Every wonder test goes through 0x0043e361 or 0x0043e328, and both treat a wonder as absent once
any of civilizations 1 to 7 knows the advance in @ENDWONDER. This covers the bonuses of the
Colossus and King Richard's as well as the owner tests. One extra case in 0x0043e361 is not
explained: wonder 20 also reads as absent when an options bit and a rules byte are both set.

Audit of all 64 routines that test a wonder (0x0043e361, 0x0043e328, 0x0043e3ef), against the
engine. The Great Library and the four completion effects were missing and are ported. Marco
Polo's and the United Nations act as an embassy with everyone, and most of their 40-odd tests only
decide what a human is told (reports, the foreign advisor, the news). The tests that change play
are in the negotiation routines 0x00440b9e, 0x00445022 and 0x00449c70, and in the senate test
0x0050f0ea. Those wait for the negotiation screen, as do the Great Wall tests in them. The Great
Wall's other tests, the Statue of Liberty and the Eiffel Tower are ported.

## Disorder, celebration and gold (VERIFIED, 0x004bafef)

After the totals, with `happy` and `unhappy` counted and the city not barbarian:

- **Disorder** when `unhappy > happy`. The city enters disorder (flag bit 0, bit 14 set); the AI
  re-chooses production. If it was **already** in disorder, bit 13 is set as well, and a human
  **Democracy** falls into revolution (REVOLT) unless the scenario forbids government changes.
  No gold is collected from a city in disorder.
- **Order restored** when `unhappy ≤ happy` and the city was in disorder: bits 0, 13 and 20 are
  cleared (RESTORED message).
- When `happy == unhappy`, the shield surplus is positive and the food surplus is not negative,
  bit 14 ("content") is set; otherwise cleared.
- **Gold:** when not in disorder and the government is not Anarchy, the city's tax (after the
  trade split and its building bonuses) is added to the treasury.
- **We Love the King Day** when `unhappy == 0`, size ≥ 3, at least half the citizens rounded up
  are happy (`(size + 1) / 2 ≤ happy`) and the government is not Anarchy. Starting it sets flag
  bit 1 and shows WELOVEKING. While it continues under **Republic or Democracy**, the city grows by
  one each turn ("rapture growth") when `food produced > size × food-per-citizen + settlers ×
settlers' food` and no Aqueduct/Sewer blocker applies — food storage is untouched. Under
  Monarchy, Communism and Fundamentalism the celebration effects are in the yields (Republic-level
  trade) and in corruption (one government step better).
- The celebration **ends** (WEDONTLOVEKING, bit 1 cleared) the turn its conditions fail.

The routine's result, `happy − unhappy`, is what the civilization turn inspects.

## Shields and unit support (VERIFIED structure: 0x004b3b24, 0x004ba99a)

- The shield box uses `K₂ = @COSMIC[4]` (10) rows per step for humans; for AI civilizations the
  same difficulty ladder as the food box (Chieftain 15 … Deity 8), scaled when @COSMIC[4] ≠ 10.
- Units "belong" to the city whose id is in their home-city field; only roles 0–5 are supported.
  Whether a supported unit costs a shield (VERIFIED, 0x004b37f2), counting the city's units in order:
  - Anarchy, Despotism: units beyond the **city size** cost 1 shield each.
  - Monarchy: units beyond `@COSMIC[13]` (3) cost 1 each. Communism: beyond `@COSMIC[14]` (3).
  - Fundamentalism: units with the "free support under Fundamentalism" flag (fanatics) are always
    free; others beyond `@COSMIC[15]` (10) cost 1 each.
  - Republic, Democracy: every unit costs 1 shield.
- **Military unhappiness count** (Republic/Democracy): an air unit that is not air-superiority
  always counts; a ground or sea unit counts when it is outside the city, not inside any
  friendly city, and not in a fortress within 3 squares of one of the owner's cities.
- **Shield shortage**: when supported units cost more shields than the city makes, the game
  disbands one supported unit — the one farthest from the city, preferring units not sitting in
  a city or a nearby fortress — and shows the SUPPORT dialog. A unit disbanded inside a city adds
  `cost × K₂ / 2` shields to that city's production box (the 50 % disband rule).
- **Disorder under a senate** (VERIFIED, the branch beside the shortage): a computer player's
  city in disorder under the Republic or Democracy, when `(turn + unit index) & 7 == 0` for one
  of its supported units, disbands its farthest supported land unit of roles 0–4 that stands
  outside every city and not in a fortress within three squares of an own city, and the
  disorder flag is cleared with it (so one unit a turn at most; `outcome.ts`
  `disbandForDisorder`). With options byte 8 bit 0 set and a human ahead in advances the
  routine instead vetoes both senate governments (−999) — not modelled.

## Worker placement (VERIFIED, 0x004b49b5 with the status passes 0x004b30b1 and 0x004b33d7)

Every recompute of a city's totals places its workers again (`city.ts` `assignWorkers`). First
the square status: a radius square is blocked when it is off the map or unseen by the owner,
when a foreign military unit stands on it (the stack is walked until an own or allied unit, which
does not block, or one with attack, which does — and a human's unit is remembered besides), when
a city stands on it, or when another city within six squares works it (or stands on it) and it
lies within two squares of this city. Workers on blocked squares are freed.

The citizens are `size + 1`, the centre working too. A computer city not in disorder puts one
specialist back to work during the city turn's own recompute (its "keep specialists" flag, city
flag bit 14, is INFERRED never set); in disorder it drops every worker. A human city, a computer
city on three turns in four (`(turn + city index) & 3 ≠ 0`), one in disorder or one blocked by a
human's unit keeps its current workers — centre first, then the radius in order — unless there
are more workers than citizens, when everything is placed afresh; if the citizens left over are
exactly its specialists, nothing more happens. Then the centre is worked; then, while the food
gathered plus one citizen's food for every citizen still free is short of `size × food per
citizen + settlers × settlers' food` (or the city is below size 3), the free square with the most
food is worked (ties: most `2 × shields + trade`; the last citizen of a city with no shields yet
never takes a shieldless square); a computer city in disorder then gains an entertainer; the
remaining citizens take, one by one, the square maximising `16 / surplus × food + 3 × size /
(shields − support) × shields + 2 × size / trade × trade` with each divisor clamped to 1 … 99
and the weights truncated — when no square scores above zero the rest become specialists
(existing tax collectors and scientists stay, the others entertain). Finally a city short of food
with nothing stored marks −1 in its store, and one that is fed clears a negative store.

## Square yields (VERIFIED, 0x004b4102)

For a worked square of terrain `t` with special `s` (0, 1, 2 from rules-map.md), base yield =
the RULES @TERRAIN row `s × 11 + t` (base terrains, then the first specials, then the second
specials — the same order as the file). Then:

| kind    | modifier                                                                                                                                                                                                                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| food    | ocean: +1 with a Harbour (30). Land: irrigated square or the city square → + terrain `irrigateBonus`; with a Supermarket (24), farmland (irrigation + mine bits) or the city square → +50 % (rounded down).                                                                                                                                                                           |
| shields | ocean: +1 with an Offshore Platform (31). Land: mined square, or the city square when the terrain has no irrigation bonus → + terrain `mineBonus`. Grassland without the shield stripe → 0. The city square always yields at least 1. King Richard's Crusade (wonder 47) in the city → +1. Railroad on the square, or the city square once Railroad is known → +50 %.                 |
| trade   | +1 for a river. Road (or the city square) → +1 on Desert, Plains, Grassland, or on any square that already has trade. Colossus (41) in the city → +1 on every square that has trade, and +1 on ocean squares. Superhighways (25) with a road → +50 %. Republic or Democracy → +1 on squares with trade; a city celebrating We Love the King Day gets this bonus from Monarchy upward. |
| all     | **Despotism/Anarchy penalty**: any yield above 2 loses 1, unless the city is celebrating. Pollution on the square: yield = (yield + 1) ÷ 2. Scenario "double production" flag: ×2.                                                                                                                                                                                                    |

Food caravans: each outgoing food trade route costs the city 1 food per turn and each incoming
one adds 1 (0x004b6d9c).

## Worker placement (VERIFIED, 0x004b49b5)

A city of size N has N working citizens plus the city square; the save stores the worked squares as
21 bits and the specialist count in the top 6 bits of the same 32-bit word (`+48`). The
auto-arrange keeps currently worked usable squares, then fills food first until food covers
citizens and settlers (or while size < 3), choosing by food then by 2 × shields + trade, and
assigns the remaining workers by a weighted score of food, shield and trade surplus. Squares are
unusable when off-map, unseen by the owner, occupied by a non-allied enemy military unit on
land, or worked by another city within 2 squares.

## Shield multipliers, waste and pollution (VERIFIED, 0x004b5686)

```
f = 2 with a Factory (15), 4 with Factory + Manufacturing Plant (16)        (quarters)
p = 2 with a Power Plant (19), Hydro Plant (20), Nuclear Plant (21), Solar Plant (29) or the
    Hoover Dam (61); p is capped at f, so power without a factory adds nothing
shields = base + base × f / 4 + base × p / 4           (Factory +50 %, +Power +50 %, +Mfg +50 %)
pollutionDivisor = 1; Hydro/Nuclear/Hoover → 2; Recycling Center (18) → 3; Solar Plant → 3
productionPollution = shields / pollutionDivisor − 20           (0 with a Solar Plant)
techFactor (without Mass Transit (13)) = count of {Industrialization, Automobile, Mass Production,
    Plastics} known, +1 if any and Sanitation unknown, −1 with Environmentalism, −1 with a Solar Plant
pollutionChance% = productionPollution + size × techFactor / 4
waste = corruption(shields − support, forWaste) × (3 − connectedToCapital) / 3 / (government / 2 + 1),
    capped at shields − support − 1, 0 under Democracy and Fundamentalism, and 0 when the
    civilization has no Palace and this city is building one
```

## Corruption (VERIFIED, 0x004b530c and 0x004b52bb)

```
G = 4 (Anarchy), 5 (Despotism), 6 (Monarchy), 7 (Communism, Fundamentalism), 8 (Republic, Democracy);
    a celebrating city counts as one government higher
distance = squares to the nearest own city holding a Palace (32 if none); for waste capped at 16;
    under Anarchy/Despotism a human player adds the difficulty level (cap 32)
Communism: distance = @COSMIC[16] for every city
corruption = trade × distance × 3 / (G × 20), clamped to [0, trade]; halved by a Courthouse (7) or
    the Palace. Democracy and Fundamentalism: 0 (applied by the callers).
```

## Trade split (VERIFIED, 0x004b5c68)

With rates in tenths (`sci`, `tax` from the civilization record; luxuries = the remainder):

```
lux = round((10 − sci − tax) × trade / 10);  science = round(sci × trade / 10) ≤ trade − lux;  tax = rest
Fundamentalism: sci rate capped at @COSMIC[21]; AI players fold luxuries into science;
    science −= @COSMIC[17] % ; "tithes" = the content-making value of Temple, Colosseum,
    Cathedral/Michelangelo's and J. S. Bach's are added to tax
entertainer +2 lux, tax collector +3 gold, scientist +3 beakers
Marketplace (5), Bank (10), Stock Exchange (22): each +50 % to lux and to tax
Library (6), University (12), Research Lab (26) or SETI (65): each +50 % science, each +100 %
    in the city holding Isaac Newton's College (55); Copernicus' Observatory (50): city science ×2
Producing Capitalization: surplus shields become gold
```

## Happiness (VERIFIED, 0x004b6359)

Start: happy = 0, `content base` C:

```
human:  C = @COSMIC[7] − difficulty                                  (7 at Chieftain … 2 at Deity)
        with fewer than 3 content, a city holding the Palace with no military unhappiness gets 2
AI:     C = @COSMIC[7] − 5 + ... (same shape, difficulty-independent)
unhappy = (size − 1) − (C − 2)
empire size (not Communism): step = ((government / 2 + 2) × (@COSMIC[8] − 2 × difficulty)) / 2, min 1;
        unhappy += (cities − step + cityId mod step) / step
clamp unhappy to size; the excess is remembered and re-applied as buildings make people content
```

Then in order, each step recorded for the city screen:

1. Luxuries (VERIFIED 0x004b6359 with the normalisation 0x004b5aa3): the happy count is set outright to half the luxuries; the normalisation then clamps both counts to the city size and, while happy + unhappy exceed the workers, turns one happy and one unhappy into content (an unhappy beyond the size is dropped first). So luxuries never calm an unhappy citizen directly: two luxuries make a content citizen happy, and only a happy citizen paired with an unhappy one makes two content. Checked against the original's Civil War scenario at Deity (Washington: 3 happy, 2 unhappy).
2. Colosseum (14): −3 unhappy, −4 with Electronics. Cathedral (11) or Michelangelo's (49) once
   Monotheism is known: −3 unhappy, −1 of that without Theology, −1 with Communism (the advance).
   Temple (4): −1 with Ceremonial Burial, −1 more with Mysticism, doubled by the Oracle (44).
   Courthouse (7) or Palace under Democracy: +1 happy.
3. Fundamentalism: unhappy = 0. Monarchy and below: **martial law** — each military unit in the
   city makes 1 unhappy content, 2 under Communism, up to 3 units (6 under Communism).
   Republic/Democracy: **military unhappiness** — each unit counted as "abroad" (see support)
   adds 1 unhappy (2 under Democracy), reduced by 1 per unit with a Police Station (33) or
   Women's Suffrage (60); the Republic ignores the first unit.
4. Hanging Gardens (40): +1 happy everywhere, +3 in its city. Cure for Cancer (66): +1 happy.
   Shakespeare's Theatre (52): no unhappiness in its city. J. S. Bach's (54): −2 unhappy.
5. The city record stores science, tax, trade, food, shields, happy and unhappy (+74 … +83).

The outcome rules (disorder, celebration) are in the Happiness outcomes section above.

## Production (VERIFIED, 0x004b7e74)

Each turn the city's shield surplus (shields − support, 0 while in disorder) is added to the
production box, except while producing Capitalization (38), where it becomes gold instead.
Cost of an item = its RULES cost rows × the shield-box rows (`K₂`, 10 for humans).

### Changing production (VERIFIED, 0x004b2ec8, 0x004b2f4f)

Production falls into three categories: units; improvements 1–34; spaceship parts and wonders
(35 and up). Above Chieftain, switching to a different category loses @COSMIC "percent shield
penalty for production type change" (50) of the stored shields; within a category it is free.

### Completing an improvement or wonder (production value < 0, index = −value)

- An improvement the city already has, or a wonder another city has already completed, is
  flagged BADBUILD (the AI re-chooses; the human is told).
- Spaceship parts (35–37) need the Apollo Program and a living spaceship; otherwise BADSPACE.
- On completion the improvement is added, the shield box loses the cost, and **for human players
  the box is then reset to 0** (overflow is lost; the AI keeps its carry-over for improvements).
- Building the **Palace** removes it from the owner's other cities and moves the capital.
- A computer city whose shields cover a wonder nobody has built yet completes nothing this turn
  while a human city is building the same wonder with shields enough for it (VERIFIED
  0x004b7e74; the shields and the production stay). Completing a wonder sets the city's
  "has built a wonder" flag (city flag bit 8), which the AI's wonder valuation reads.
- Wonder effects on completion:
  - Manhattan Project: every civilization's reputation becomes `(reputation + 1) / 2`, clamped to
    0 to 6, and it announces itself.
  - Darwin's Voyage: 0x0049675f twice. Each call finishes the research target, zeroes the beakers
    and passes through the advance routine. With no target one is chosen, asking a human. The
    engine's picker stands in for that question.
  - Leonardo's Workshop: the unit sweep 0x00492c44.
  - Eiffel Tower (0x004b7d88): once per civilization, shown by byte 0 bit 4. Reputation halves
    (`>> 1`), every other civilization's attitude changes by −25 and its vendetta bit toward
    the builder clears, one way only.
  - Apollo Program (0x004bcc9a): every square is seen by everyone and every city is known to all
    at its true size. The engine has no per-civilization city knowledge, so only the map part
    applies.

  Other AI cities building the same wonder re-choose.

### Completing a unit (production value ≥ 0 = unit type)

- **Automatic upgrade:** if the owner knows the advance that obsoletes the type, the completed
  unit becomes the type with the same role whose prerequisite is that advance (UPGRADED dialog
  for humans).
- The shield box loses the cost; for humans it is then reset to 0 (overflow lost).
- **Settlers-role units (5)** cost one population: a size-1 city cannot build one if it is the
  civilization's only city; a human size-1 city is asked to confirm (GHOSTTOWN) and the city
  disbands into the unit when it does; otherwise size − 1.
- **Veteran status:** Communism makes role-6 units (diplomats/spies) veteran. Otherwise, with
  simplified combat OFF: ground units need Barracks (2) or Sun Tzu's War Academy; sea units need
  a Port Facility (34) or the Lighthouse; air units need an Airport (32); missiles never. With
  simplified combat on, Barracks/Sun Tzu's apply to every non-air, non-missile unit of role < 6.
- Role-4 units (sea transport) get a home-port marker in the counter field.
- **Caravans (role 7):** humans choose the commodity from the city's three supplied commodities
  or food (CARAVANBUILT/CARACONFIRM); the chosen supplied commodity is then marked used. AI
  caravans get `rand() % 16`.
- A unit whose attack is 99 (nuclear) resets every other civilization's "last contact" record.

### AI production purchases (VERIFIED, same routine; AI players only)

After the shield box is updated the AI may convert treasury to shields: a fraction of its gold
(`treasury >> 6` for units matching the continent's plan, `>> 6`/`>> 7`/`>> 8` for wonders
depending on how many wonders of that era it already has, `>> 7` for spaceship parts, `>> 3` for a
Palace, for a city in disorder, or for an empty city with a unit in production, `>> 4` for an
unprotected capital; doubled above 2500 gold, plus `treasury >> 9` extra over 2000), capped at
the remaining cost. The gold actually paid is reduced by `difficulty × bought / 10 / (8 − rank)`,
and halved or waived when the AI is already richer than the human leader. This is the AI's
production advantage.

## Pollution roll and meltdown (VERIFIED, 0x004bb7bb)

Once per city turn (for human cities in the original): `threshold = advances × difficulty / 2`
(halved repeatedly below 256 when the city has a Solar Plant; 0 when the scenario eliminates
pollution, which also zeroes the city's value). The city pollutes when `rand() % (256 −
threshold) < 2 × pollution value`: a random one of the 20 radius squares (not the centre) that
is land, has no city and is clean gets pollution and the world count rises.

A city **in disorder** with a **Nuclear Plant** whose owner lacks Fusion Power melts down with
probability `1 / (6 − difficulty)`: the plant is destroyed and the city and the eight squares
around it take a nuclear device's fallout (0x00559699, `fallout`): cities halve and the land is
damaged. 0x0052c788 is only the explosion's animation.

## Still to read

The AI build choice (0x00430b61), the nuclear blast (0x0052c788), the AI's exact content base,
the connected-to-capital test (0x00468c65), and the buy-cost formula for human purchases.

### Martial law and units abroad (VERIFIED 0x004b6359, 0x004b6359's support pass)

Martial law counts every armed unit standing in the city square, wherever it is homed (×2 under
Communism, at most 3, or 6 under Communism). Units causing unhappiness under Republic and
Democracy are the city's own: armed air units except fighters, and armed units outside any city,
unless on a fortress (not an airbase) within 3 of one of the owner's cities.

## A city removed (VERIFIED 0x00430421)

Trade routes to it are cut. Units homed there: Partisans (slot 9) lose their home, a computer
player's lone defender of another of its cities moves its home there, and every other one is
disbanded. `removeCity` in fertility.ts does this for every way a city can end.

## What can be built (VERIFIED 0x00494938, 0x00494862, 0x004943e4)

An improvement needs its advance and must not stand in the city. Then: Harbor and Offshore Platform
need the coast; Port Facility and Coastal Fortress need sea that is more than a lake; no Granary with
the Pyramids, no Cathedral with Michelangelo's, no Research Lab with SETI, no Police Station with
Women's Suffrage, no Courthouse in the capital. Bank needs a Marketplace, Stock Exchange a Bank,
University a Library, Research Lab a University, Manufacturing Plant a Factory, Sewer System an
Aqueduct, each with that building's advance known. Power, Hydro, Nuclear and Solar Plants need a
Factory or Manufacturing Plant; Hydro needs a river or mountains near; other than Solar none may be
built beside Hoover Dam, a Power Plant or a Solar Plant, and only Power beside a Nuclear Plant.
Spaceship parts need the Apollo Program, an AD date, no launch yet, and no bloodlust.

A unit needs its advance and must not be obsolete. Gunpowder retires defenders weaker than
Musketeers; Knights' advance retires two-move attackers no stronger. Nuclear units need the Manhattan
Project and Rocketry; ships need sea that is more than a lake; Fanatics need Fundamentalism. A computer
skips a fast ground unit when a better one of its role is available.

## Global warming (VERIFIED 0x00466e4e, 0x00466b1b)

Each year `dirt = polluted − base + base / 2` (shared among the humans if several). The counter goes
up one when `dirt × 2 − warmings × 4 − Solar Plants − counter` is positive, down one when negative,
between 0 and 99. At 12 with `dirt` above 6 the player is warned. Past 16 the climate changes and the
counter restarts. For warming `n` counting from 0, each desert, plains, grassland or forest square
with under `7 − n` ocean squares among its 20 neighbours goes, when `(3x − 3y) & 7` equals `n`, to
desert (from desert or plains) or plains. With more ocean near it becomes swamp, or jungle from
forest, and loses irrigation and mines.

## Computer purchases (VERIFIED 0x004b7e74, tail)

After production a computer city that was attacked since its last turn, or holds no units, chooses
again. Then it spends a share of treasury `t`, applied in this order, each replacing the last:

| Condition                                                                               | Share    |
| --------------------------------------------------------------------------------------- | -------- |
| Building a unit whose role equals the land mass plan (0, 1 or 4), with a shield surplus | `t >> 6` |
| Wonder, none yet of its era or fewer than the fewest any human holds                    | `t >> 6` |
| Wonder, over one past the most any human holds                                          | `t >> 8` |
| Other wonder (doubled when `t` is 2500 or more)                                         | `t >> 7` |
| Spaceship part once a human has launched (doubled under space race pressure)            | `t >> 7` |
| In disorder, building an improvement, shields in hand                                   | `t >> 3` |
| Attacked or empty, building a unit, shields in hand                                     | `t >> 3` |
| Palace, shields in hand                                                                 | `t >> 3` |
| Its first Nuclear Missile, shields in hand                                              | `t >> 4` |

Above 2000 gold it adds `t >> 9`, and the share stops at what the box still needs. Shields rise by
the share. The treasury pays the share less a refund of `difficulty × share / 10 / (8 − r)`, with `r`
the highest human power rank; the refund halves when the civilization is richer than the main human
and has 1000 gold, and vanishes at 2000. Not traced: the flag is also raised on cities receiving
units displaced by a conquest (0x00528720).

## The computer's choice of units (VERIFIED 0x00474edb)

A land unit starts from `building × 2 + on this land mass`, Archers counting Legion, and Crusaders or
Knights counting each other by attack personality. A land unit with no attack and role 0 (Explorer)
is wanted only away from attack and defend plans, while few exist. Ships and aircraft are considered
only with 4 units on the land mass (8 with two or more cities), and start from
`(owned + building × 2) × units here / (all units + 1)`; ships also need a sea that touches two land
masses, or one of over 47 squares for anything but a transport. Transports are wanted on full land
masses, or as the first of their type elsewhere. After the score a chosen wonder gives way to a
Temple if the city has none; a Palace under way is kept; and a wonder under way that no other city is
building, in a defended city, is not dropped for anything less. `scripts/compare-builds.ts` measures
the chooser against the original's saves.

## Computer sales and airlifts (VERIFIED 0x00474edb)

Before it chooses, a computer city sells at full price, with no limit of one a turn, any Granary
under Pyramids, Research Lab under wonder 26, Police Station under wonder 21, and Cathedral under
Michelangelo's. A city with an unused Airport, on a land mass not planned 4 or 5, may then pull a unit
of the land mass's plan role from another Airport with no foreign non-allied unit adjacent: on the
same land mass only when defenders are absent, otherwise from a land mass with a different plan, and
from a stack of 3 or more (2 from a plan 4 land mass). Enemy human fighters in reach of either end
shoot it down one time in six, one in four when veteran.

## Wonder reports (0x00430b61, VERIFIED; who hears them INFERRED)

When a computer city's choice starts a wonder no other of its cities is building, humans hear of it
once a civilization turn. Switching from a wonder that no other city is building, or that has been
built, reports the change and moves any other cities on the old wonder to the new one. Leaving a
wonder for something ordinary reports it abandoned. A computer's new Palace is also reported.
