# City rules

Status: the per-city turn **structure** and the growth, starvation, celebration and revolt rules
are **VERIFIED by decompilation** (0x004bc513 city turn, 0x004b7654 growth, 0x004bafef
happiness/disorder, 0x004b3924 food constants, 0x00430ac9 growth blockers). Yield, happiness,
support, trade and production formulas are being read next; anything about them below is
INFERRED and labelled.

## Order of a city's turn (0x004bc513)

1. Every 64 turns a city held by a conqueror becomes "originally theirs" (founder := owner).
2. Food constants are set for the owner (below) and the city's totals computed.
3. **Growth and starvation** (0x004b7654). A destroyed city ends processing.
4. Totals recomputed; food surplus added to storage; FOODSHORTAGE warning when storage fell this
   turn and `stored + 3 × surplus < 0`.
5. **Production** (0x004b7e74): shields toward the current item, completion, AI build choice.
6. **Trade** (0x004ba99a): taxes, luxuries, science, corruption (to be read).
7. Per-civilization government statistics updated (unit support counts, celebration counts).
8. War-weariness bookkeeping for Republic/Democracy from units outside the home territory
   (Police Station, or Women's Suffrage in every city, halves it; Courthouse, Bank-like effects
   adjust the multiplier) — exact formula to be read.
9. **Happiness** (0x004bafef): disorder, order restored, We Love the King Day, rapture growth,
   Democracy revolt.
10. Science added to the owner's research (0x004bb63d) — doubled for the human at Chieftain
    when researching a specific advance, and for AI civilizations above Warlord that lack key
    advances.
11. Human owner only: pollution check (0x004bb7bb) and one more routine (0x004bbc98).
12. AI worker/pollution task assignment for the city radius (0x004bc284).

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

## Happiness outcomes (VERIFIED, 0x004bafef; the counting of happy/unhappy citizens is in 0x004b6f17, being read)

With `happy` and `unhappy` counted for the city (content citizens count as neither):

- `happy < unhappy` → **civil disorder** (flag bit 0). A second consecutive turn of disorder sets
  bit 13; under **Democracy** that triggers the REVOLT dialog and the government falls (the
  "second turn of disorder under Democracy" rule).
- Order is restored (flag cleared, RESTORED dialog) when `happy ≥ unhappy` again.
- **We Love the King Day** (flag bit 1): no unhappy citizens, size > 2, `happy ≥ (size + 1) / 2`,
  and the government is not Anarchy. While celebrating under a government with index > 4
  (Republic, Democracy), if food produced exceeds what citizens and settlers eat and growth is
  not blocked, the city grows by one each turn (rapture growth). The celebration ends when the
  condition fails (WEDONTLOVEKING).
- Under any government other than Anarchy, each turn's happiness surplus feeds the owner's
  score counter.

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
- Under Republic or Democracy a city in disorder may also lose a unit this way on an 8-turn
  cycle (AI only).

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

1. Luxuries: every 2 luxuries make one citizen one step happier (content → happy, unhappy → content).
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

## Still to read

Production and the AI build choice (0x004b7e74), the pollution roll (0x004bb7bb), the AI's
exact content base, and the connected-to-capital test (0x00468c65).
