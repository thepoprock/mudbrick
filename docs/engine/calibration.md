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

Open: irrigation runs lower than the original's; the advisor's `+0x3d2` production field (the
best `2 × shields − support` over the cities) is not ported.

The rig: `/mnt/t7/civ2-wine` on bm3 — a 32-bit Wine prefix, the operator's disc image mounted
as D:, Xvfb :98, `civ2-autoplay.sh` pressing Enter (Escape and `f` in turn) and clicking the
High Council away, autosave each turn to `Ca_Auto.SAV`.
