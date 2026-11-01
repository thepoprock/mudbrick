# Calibration against the original

The original (Civilization II Multiplayer Gold, the operator's own copy) runs under Wine on the
operator's bm3 machine for side-by-side measurement; `scripts/analyze-save.ts` reads its
autosaves and `scripts/probe-engine.ts` runs the engine with the same settings. Settings of
run 1 (2026-10-31): normal round world, Prince, seven civilizations, roving barbarians; the
human (Romans) founds one city and only fortifies units. The engine games use random worlds, so
only the aggregate shape is comparable, not the exact numbers.

| turn | measure (computer players) | original run 1                         | engine seed 1 / 2 (after the advisor fix) |
| ---- | -------------------------- | -------------------------------------- | ----------------------------------------- |
| 51   | cities per civilization    | 1–3                                    | 1–2                                       |
| 51   | advances                   | 4–7                                    | 2–5                                       |
| 101  | cities per civilization    | 1–4 (16 total)                         | 1–4 (22 total)                            |
| 101  | settlers alive             | 1–2 each                               | 1–3 each                                  |
| 101  | roads per city radius      | 1.0–3.5                                | 0–1.3                                     |
| 101  | trade per city             | 3–5                                    | 1–4.8                                     |
| 183  | cities per civilization    | 1–9 (32 total)                         | 1–8 (44 total)                            |
| 183  | advances                   | 1–19                                   | 5–17                                      |
| 225  | cities                     | 36 total                               | 44–55 total                               |
| 225  | units                      | 178                                    | 200–230                                   |
| 225  | advances                   | 6–24                                   | 6–26                                      |
| 225  | roads per city radius      | 1.7–6.1                                | 1.1–5.8                                   |
| 225  | irrigation per city radius | 1.2–6.0                                | 0.3–3.7                                   |
| 225  | trade per city             | 3–10                                   | 3.3–9.0                                   |
| 225  | governments                | Republic ×1, Monarchy ×1, Despotism ×4 | Despotism ×7 (open)                       |

A second run of the original (2026-10-31, 22:04, same settings, a fresh world) against two
engine seeds at the same turn:

| turn | measure (computer players)  | original run 2                         | engine seeds 3 / 4                                                |
| ---- | --------------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| 103  | cities per civilization     | 2–6 (23 total)                         | 2–5 (25 total)                                                    |
| 103  | advances                    | 4–8                                    | 5–11                                                              |
| 103  | roads / irrigation per city | 1.0–3.7 / 0.3–3.7                      | 0.3–6.5 / 0.3–4.5                                                 |
| 211  | cities, units               | 39, 168                                | 51, 212 / 41, 159                                                 |
| 211  | advances                    | 13–26                                  | 15–27 / 13–28                                                     |
| 211  | governments                 | Republic ×3, Monarchy ×1, Despotism ×2 | Republic ×1, Monarchy ×5 / Republic ×1, Monarchy ×4, Despotism ×1 |
| 211  | roads / irrigation per city | 3.0–4.5 / 1.1–5.3                      | 2.0–4.9 / 0.8–3.3 / 1.2–7.0 / 0.3–3.0                             |

After the worker-placement port (bfe4ce3) the same two engine seeds at turn 211 read 38 / 44
cities, 141 / 176 units, advances 11–19 / 8–22, city sizes 2–7 and gold 345–1193 — the sizes and
gold now sit where the original's do (its computer players pay no upkeep), research a shade
slower.

What the comparison found and fixed (all VERIFIED against the executable afterwards):

1. **The build advisor's sixteen-fold factor** (0x00474edb) applies to every unit except
   settlers, before the cost and strength terms. The port had it on a dead branch, so cheap
   defenders scored near zero and crowded out settlers, caravans and improvements: 23 cities
   at turn 183 against the original's 32; with the fix, 44.
2. **Road-link tasks flipped** between two squares every turn because the planning walk
   charged the worker standing on the link as a same-role obstacle; planning walks now ignore
   own units, and a settler arriving by go-to gets its work order the same turn.
3. **The first settler founds on turn 1**, settlers route with the pathfinder and found in
   place after four failed approaches (earlier the Zulu settler of one seed stood still for a
   whole game).

4. **The government scores were starved.** The original feeds them from three routines
   besides the city's own share — the square yield, corruption and the trade split
   (docs/engine/diplomacy.md) — and compares shields with support, not food, for the
   "current state" shortfall. Read straight from the original's saves (`scripts/probe-gov.ts`),
   Despotism's score ran to −13 for a four-city civilization at turn 101 while Monarchy's was
   0; the port had Despotism at or above Monarchy forever. With the three contributions ported,
   computer players adopt Monarchy between turns 69 and 187 and some the Republic, as in the
   original (Egyptians Monarchy by turn 101, Germans the Republic by 183).

5. **A unit in a foreign zone of control could choose a square it may not enter.** The
   original's direction loop skips a zone-of-control square when the unit already stands in one
   (unless it ignores zones of control or a unit stands there); the port scored such squares
   and the move rules then refused them, so a settler beside a foreign horseman stood still
   for two hundred turns and its civilization stayed at one city. With the gate the Sioux of
   seed 1 reach four cities by turn 101 and six by 225.

6. **The advisor's production rank for wonders** (`+0x3d2`, the civilization's best
   `2 × shields − support` this turn) was not tracked, so every city weighed wonders alike;
   now a city at or below half the best finds them twice as costly and the best city a third
   cheaper, as docs/engine/ai-city.md describes.

Open: irrigation runs a little lower than the original's and the Republic is adopted a little
less often; both are within the spread of single runs so far. The rest of the wonder loop (other builders,
the in-progress adjustments, the Palace halving, the progress discount, obsolescence) is now
in the code as ai-city.md describes it; only the "wonder city" flag is left as clear.

The rig: `/mnt/t7/civ2-wine` on bm3 — a 32-bit Wine prefix, the operator's disc image mounted
as D:, Xvfb :98, `civ2-autoplay.sh` pressing Enter (Escape and `f` in turn) and clicking the
High Council away, autosave each turn to `Ca_Auto.SAV`.

## Scenario check: the Civil War at its first turn (2026-11-01)

Method: the original (Multiplayer Gold under Wine on a virtual display) opened
SCENARIO/CIVILWAR as the Federals at Deity; screenshots of its City Status (F1) and Attitude
Advisor (F4) at the first turn, July 1861. The engine loaded the same file with the scenario's
own RULES.TXT (`scripts/play-smoke.ts` drives the web app headlessly; the probes used
`worldFromSave` / `gameFromSave` directly).

| check                                | original              | engine before              | engine after       |
| ------------------------------------ | --------------------- | -------------------------- | ------------------ |
| gold after the first city processing | 138                   | 61–73                      | 138                |
| food totals, 24 cities (City Status) | e.g. Boston 38, NY 51 | 1 of 24 (Boston 29, NY 42) | 24 of 24           |
| Washington's mood                    | 4 happy, 2 unhappy    | 1 happy, 2 unhappy         | 4 happy, 2 unhappy |
| cities in disorder, famine at turn 1 | none                  | 11 in disorder, 2 starving | none               |
| date                                 | July 1861             | 4000 BC                    | July 1861          |
| rules in force                       | the scenario's        | the game folder's          | the scenario's     |

Causes found: the city record's worked-square mask was read in the wrong byte order (so every
loaded city worked the wrong squares); luxuries calmed unhappy citizens first instead of
setting the happy count outright; the scenario folder's RULES.TXT was ignored; the calendar
ignored scenario months. `apps/web/test/civilwar.conformance.test.ts` pins the food totals.

Second turn (the original's units put on sentry, its AI moving freely): the original reaches
August 1861 with 158 gold (+20) and 17,250,000 people after losing 4 units to Confederate
attacks. VERIFIED by running the engine's city turn for every Federal city on the July autosave
and comparing with the August one: the engine reaches 158 gold exactly. The 18-gold difference
from the sum of stored tax minus upkeep (502 − 464 = 38) is Pittsburgh: its Settlers complete,
its entertainer goes, 3 unhappy outnumber 2 happy and its 18 tax is lost that same turn.

The cities still differ only where the saves show an outside cause. Syracuse, Cleveland,
Indianapolis, Terra Haute, Detroit and Milwaukee each lost a unit homed there, which gives them
one more shield and 2 fewer unhappy in the original. Washington's workers moved, INFERRED because
an enemy entered a worked square. Springfield2's August figures are of the same kind: food 18,
surplus 5, trade 8 (tax 8, luxuries 8, science 3), production 8, 2 happy, 6 content, 1 entertainer.

The later turns have not been played forward under the same moves, so they stay unchecked.

## Conformance against stored city figures (`scripts/conform-cities.ts`)

Every city record holds the figures the original last computed, so a save checks the engine
without screenshots and without AI moves interfering: food, shields, net trade, tax, science,
happy and unhappy. On August 1861 of the Civil War all 29 Federal cities match on all seven. On
19 saves of two long Roman games net trade rose from about half to nearly all after the distance
fix, and five saves match completely. Tax and science gaps in computer cities are partly rates
changed after the cities were computed; the unhappy gap closed once martial law counted every armed unit in the city. Most misses left are single cities; several stored all zeros, which fits cities the original had not recomputed since capture (INFERRED).
