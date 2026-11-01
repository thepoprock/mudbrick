# The AI's city production choice

Read from the original's production advisor, 0x00474edb (about 2,100 decompiled lines). It
serves two purposes: computer players call it to decide what each city builds, and the human
player's military and domestic advisors use its two secondary outputs. Everything in this file is
VERIFIED from that routine unless marked INFERRED; the engine's `packages/engine/src/aiBuild.ts`
implements it with the inputs the engine has and states its defaults.

**Scale:** every candidate gets a number; **lower is better**; 999 means never; a negative
number is an emergency. At the end the candidate with the lowest number is built.

## Facts gathered first

- The city's totals (yields, support, happy and unhappy counts); `borderline` = happy equals
  unhappy; `disorder` = in disorder or flagged for it.
- The continent's AI plan (per-civilization, per-land-mass byte, assigned in ai-units.md): plans 0
  (an enemy there is stronger) and 1 (the civilization is the stronger party) make the land mass
  **contested**, which favours military builds below; so does plan 4 when the "no barbarians"
  option bit is set, and a continent where human-held cities of the civilization's own founding
  exceed `attack personality + 1` (reconquest). The code calls this flag `expanding`.
- Counts: own cities on the continent with Barracks (+4 if the civilization holds Sun Tzu's),
  Airports, Port Facilities; own cities building the same item; other civilizations building each
  wonder; own units of each type on the continent; total units; settlers without a home; enemy
  units in the city radius; ocean squares in the radius; farmland squares; wonders owned and
  wonders in this city; the spaceship race state; distance to the capital.
- **Free irrigation (AI only):** a computer city with zero food surplus, no settlers to support
  and the "no auto-improve" flag clear picks one worked, unirrigated radius square whose terrain
  can be irrigated and irrigates it at once (adding a road when there is no river), gaining one
  food. Grassland with a special resource stops the search.
- **Redundant buildings (AI only):** a computer civilization sells a Granary when it holds the
  Pyramids, a Research Lab with the Internet, a Police Station with Women's Suffrage, a Cathedral
  with Michelangelo's — for the building's full shield cost in gold.
- **Defenders wanted:** `size / d` where `d` is 4 when no enemy exerts a zone of control on the
  city square and 3 otherwise, +1 under continent plan 5 (without a Palace), −1 with a Palace,
  +1 when expanding or the continent has an AI task; a capital wants at least 1, 2 above size 3,
  3 with more than 7 cities, 4 with more than 11. With no defender at all the need is urgent
  (`urgent = 2`); below the want it is 1 (`need`), and two below is urgent as well.
- Early exits: a computer civilization with **no units** under Anarchy or Despotism builds the
  highest-indexed Defend-role unit it can (paratroopers excluded). **Barbarian** cities keep their
  current unit, or build Legion until anyone knows Explosives and then Knights, upgrading to the
  obsoleting advance's replacement once enough civilizations know it.

## Improvements (1–34, only those the city can build)

| improvement                                                             | number (before scaling)                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Palace                                                                  | 2 (1 above size 9, 0 above size 14) when the civilization has no capital and the plan is 0, 4 or 5 or the city is restless; else never                                                                                                                                                                                                                                                                                                                |
| Barracks                                                                | `civilize + barracks + 4 − attack` (+ barracks again for peaceful leaders); military. Human: ×1.5 at King, ×2 above                                                                                                                                                                                                                                                                                                                                   |
| Granary                                                                 | without the Pyramids: 8 if shields < 3 else 4; +2 when happy ≤ unhappy; human: + max(0, difficulty + 4 − size)                                                                                                                                                                                                                                                                                                                                        |
| Temple                                                                  | 9 when borderline; **−5 in disorder**                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Marketplace                                                             | clamp(10 − trade / 2, 1, 10); −1 borderline; **−4 in disorder**                                                                                                                                                                                                                                                                                                                                                                                       |
| Library                                                                 | clamp(10 − trade / 3, 1, 10)                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Courthouse                                                              | `14 − (unhappy × 2 + corruption)`; Democracy in disorder: −1; AI: − half the human's war weariness                                                                                                                                                                                                                                                                                                                                                    |
| City Walls                                                              | without the Great Wall: `10 − size / 2`, −2 per human at war or with a vendetta, −1 per human with cities on the continent, +2 each when Rocketry-era advances are known by anyone; clamp 1–10; −4 in a capital; military                                                                                                                                                                                                                             |
| Aqueduct                                                                | when `size ≥ aqueduct size − surplus / 2`: clamp(aqueduct size + 4 − size − surplus / 2, 1, 20)                                                                                                                                                                                                                                                                                                                                                       |
| Bank                                                                    | clamp(10 − trade / 3, 1, 10); −1 borderline; **0 in disorder**                                                                                                                                                                                                                                                                                                                                                                                        |
| Cathedral                                                               | without Michelangelo's: 8 borderline; **−3 in disorder**                                                                                                                                                                                                                                                                                                                                                                                              |
| University                                                              | with a science rate, outside the late space race: clamp(10 − trade / 4, 2, 10)                                                                                                                                                                                                                                                                                                                                                                        |
| Mass Transit, Solar Plant                                               | never (the pollution advisor handles them)                                                                                                                                                                                                                                                                                                                                                                                                            |
| Colosseum                                                               | **−2 in disorder**, else never                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Factory, Hydro Plant                                                    | clamp(14 − shields, 1, 14)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Power Plant                                                             | clamp(12 − shields / 5, 2, 14)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Manufacturing Plant, Recycling Center, Nuclear Plant and other unlisted | clamp(12 − shields / 4, 2, 12)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| SDI Defense                                                             | not in disorder: (clamp(15 − size, 1, 15) + 1) / 2, ×2 while the Manhattan Project is unbuilt, ×2 while the human has no nuclear units, −1 above size 9, **0 in a capital**; military                                                                                                                                                                                                                                                                 |
| Stock Exchange                                                          | clamp(11 − trade / 4, 2, 11); −1 borderline; 0 in disorder; skipped late in the space race                                                                                                                                                                                                                                                                                                                                                            |
| Sewer System                                                            | when `size ≥ sewer size − surplus / 2` and the race is not on: clamp(sewer size + 4 − size − surplus / 2, 1, 20)                                                                                                                                                                                                                                                                                                                                      |
| Supermarket                                                             | clamp(14 − size / 2 − 2 × farmland + 2 × race + surplus / 2, 2, 14)                                                                                                                                                                                                                                                                                                                                                                                   |
| Superhighways                                                           | clamp(15 − size / 2 + 6 × race, 2, 15)                                                                                                                                                                                                                                                                                                                                                                                                                |
| Research Lab                                                            | like the University, clamp(11 − trade / 4, 2, 10)                                                                                                                                                                                                                                                                                                                                                                                                     |
| SAM Battery                                                             | 12 − (Stealth Bombers × 2 + Bombers × 2 + Cruise Missiles + Helicopters) × 2 of the main human — a human owner instead sums the plain four over every other civilization, halved unless at war with it or it holds a vendetta against us (RULES indices 31, 28, 44, 29); clamp 1–12; −3 with city byte 6 bit 2 (meaning unknown; never set here); military, or `expanding` when a human of reputation above 4 or one at war with us exists — VERIFIED |
| Coastal Fortress                                                        | coastal cities: 12 − (AEGIS Cruisers × 3 + Cruisers × 3 + Battleships × 5 + Ironclads + Destroyers) of the main human — a human owner: half the Ironclads and Destroyers + Battleships × 2 + Cruisers + AEGIS over the others, halved as above (RULES indices 36–40); clamp 1–12; military as the SAM Battery — VERIFIED                                                                                                                              |
| Harbour                                                                 | not in disorder: clamp(16 − ocean squares, 2, 16), halved when food surplus < 1                                                                                                                                                                                                                                                                                                                                                                       |
| Offshore Platform                                                       | not in disorder: clamp(16 − ocean squares, 2, 16), halved with a Factory, halved again with a Manufacturing Plant, −2 when shields are poor for the size                                                                                                                                                                                                                                                                                              |
| Airport                                                                 | `airports × 4 + 4 − attack`; halved under plan 4; ×2 without Advanced Flight; capped by own cities on the continent; **0 in a capital**                                                                                                                                                                                                                                                                                                               |
| Police Station                                                          | without Women's Suffrage: `10 − w` where `w` = the support pass's count of units causing military unhappiness (×2 under Democracy, +2 under Republic/Democracy when `w` ≠ 0 and happy − unhappy < 2) — VERIFIED                                                                                                                                                                                                                                       |
| Port Facility                                                           | coastal: clamp(11 − min(capital distance, 40) / 4 − 5 × warships + 2 × ports − attack + civilize, 2, 15)                                                                                                                                                                                                                                                                                                                                              |
| Spaceship parts                                                         | 4 (2 once a human has a spaceship) when the Apollo Program exists, the part is allowed and the civilization is not behind the human in parts; −1/−2 at high difficulty; otherwise never                                                                                                                                                                                                                                                               |

Then, for every improvement: `n = (20 or 10) × n × 3 / (civilize + 3)` — 10 when the item's
military flag equals the continent's expansion flag (so civilian items are favoured on settled
continents and military items where the civilization is expanding); `+ n / (barracks / 2 + 3)`
with Barracks in the city; `+ n / 3` in the city holding Shakespeare's Theatre.

## Wonders (39–66)

Considered when the city already has 40 or more shields in a wonder, or when the continent is
not flagged for war, the city is above size 2 and not restless, and the civilization has at least
`4 − civilize` cities on the continent (or anywhere, when the plan is 0).

Base: `max(1, wonders owned + wonders here + 8 − treasury / 200) + wonders of the era already
owned` (+2 when above the era's quota; −1 when below the leading civilization's count). The
wonder is skipped when another human is building it at Chieftain/Warlord, when the advance that
obsoletes it is known, or when Fusion-era conditions apply (case by case). Per-wonder adjustments
(lower = keener): Pyramids `−(3 civilize + 2)`; Hanging Gardens `−(cities / 3 + 1)`; Colossus
`−1` Palace, `−1` Marketplace, `−size / 3`; Lighthouse `−(ships + 2) / 4`; Great Library by the
advances others know; Oracle `−(cities / 4 − turn / 25)`; Great Wall `+2 civilize`; Sun Tzu's
`−(3 attack + expand − 2 civilize + 1)`; King Richard's `−clamp(2 shields / 3, 0, 3)`; Marco
Polo's `−1` per human at peace or allied; Michelangelo's `−cities / 4`; Copernicus `−trade / 8 −
1` (−1 Palace); Magellan's `−(ships + 3) / 4`; Shakespeare's `−size / 5`; Leonardo's `−4`; J.S.
Bach's `−(continent unhappiness / 16)` (−1 Palace); Newton's `−size / 6` (−1 Palace); Adam
Smith's `−cities / 4`; Darwin's `−3`; Statue of Liberty `−2` (−1 knowing Communism); Eiffel by
the human's attitude; Women's Suffrage `−1` (−2 for gentle leaders), −1 with war weariness, −1
Republic, −1 Democracy; Hoover Dam `−fertility / 20`; Manhattan only when the civilization leads
in it; United Nations `−(civilize − 2 attack)` (−1 when ranked last); Apollo `−(3 civilize − 2
attack)`; Internet `−(2 civilize + 2)`; Cure for Cancer `−(attack + 2)`.

Then: ×3 + 50 × difficulty when the wonder is obsolete (anyone knows its expiring advance); +5
per other own city on the land mass building a wonder (−2 when none, or a wonder is under way
here with 40 shields, and no wonder of the era is owned yet); + enemy units in the radius + 1
under plan 1, else half of them; when this city is already building it: ×(1 + own cities with
more shields building it) + that count (halved first if a foreign city builds it too); when an
own city with more shields is building this city's current wonder: every other wonder ×2 + 1;
when a wonder is under way with 40 shields, no defence need and not obsolete: with no other
wonder builder the favoured flag is set (or, already set, the score halves), and three quarters
of the cost in hand (half, with fewer than three other builders) sets it; ×2 when the city's
`2 × shields − support` is at most half the civilization's best (a human's city below 6 that
is not the best too); −1/3 when it is the best; the 10-or-20 scaling (10 when favoured; the
flag starts as "the land mass plan is not 0 or 1"); +n / 3 … Barracks; −n / 3 with a Palace
(halved again with no wonder here or none of the era); ×3 when the city is flagged "wonder city"
(city flag bit 8 — the engine never sets it, INFERRED clear), else when a wonder is under way
and not obsolete, progress discounts it: `n = ((cost − stored) × 3n / 4 / cost + n / 4) / 3`.
All in `aiBuild.ts`; `cost` is the wonder's rows × the city's shield box rows + 1.

## Units

A city whose civilization has fewer than 512 units considers every buildable unit:

- **Diplomats/Spies (role 6):** 11, or `clamp(10 − (target's advances − own), 2, 10)` against a
  civilization that is ahead and present on the continent; a target in the space race halves it;
  never when one of the type already sits on the continent (unless racing).
- **Caravans/Freight (role 7):** `10 − (5 − expand) × trade / 10` while fewer than 3 routes, at
  least 2, `+2 × routes + continent caravan count`.
- **Combat and settlers (roles 0–5):** start from `2 × cities building it + units of it on the
continent` (humans: halved, +2 for siege types). Settlers only with a food surplus covering
  them (or none supported and settlers under way), size above 1, and fewer than 2 settlers being
  built; Warriors only under Anarchy/Despotism; nuclear units (attack 99) only with fewer than four active and fewer than two in production; air-superiority units (role 3) only while our Fighters and Stealth Fighters (RULES indices 27, 30; active and in production) are fewer than the main human's Bombers, Helicopters and Stealth Bombers (28, 29, 31) plus two, and at peace with that human only while none of the type exist or are being built; the Carrier (index 42) never — VERIFIED 0x00474edb. Sea units need a sea route of
  value (continent plan) and a port square. Settlers get `(6, or 4 with a Granary or the Pyramids)
− (civilize or expand) − expansion room`, plus `8 or 16 per settler already supported`, ×2 below
  size 2, halved with no settlers anywhere and a surplus equal to their food, halved again when the
  continent already has its share. Defenders (role 1) when needed: `2 / need` (−1 when urgent and
  not in disorder); when the need is urgent nothing but a defender is considered. Other roles ×2,
  ×4 when the role differs from the continent plan.
- Cost-effectiveness: `n = (cost rows + 2) × n / ((moves + 1) × (attack + defence) × f / 2)` with
  `f` = 2 under simplified combat else clamp(hit points / 10 + firepower, 2, 4) (+1 for
  double-defence-vs-horse, +1 for partisans); 0 for units with no attack and no defence. Sea: ×2,
  or ×4 when expanding, −¼ with a Port Facility; air: ×2, −¼ with an Airport; role 1: −(targets +
  1. / 2; ×4 above 119 units. Support pressure when no defender is needed: `+ (3 − expansion) ×
(support + 1) × n / shields`; `×2` when shields are no more than the units supported.
- A computer city with a Palace-less empire and no Temple that found nothing builds a Temple.

## What the engine implements

`aiChooseProduction` follows this order with the inputs the engine has. The continent plan comes
from the ported strategic layer (ai-units.md), so the military flag, the plan-4 unit surcharge and
the settlers' expansion-room and continent-share terms are the original's; before the first
strategy pass the INFERRED default "fewer than four cities" stands in for the military flag.
AI targets, the human's unit counts and war weariness are zero; the airlift and the sale of
redundant buildings are done; the free irrigation is applied. Each formula above is implemented
as written where its inputs exist and skipped (candidate = never) where they do not; the code
comments name the case.
