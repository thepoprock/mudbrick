# Research

How a civilization pays for, earns and receives advances. Everything marked VERIFIED was read
from the original executable (addresses in [exe-notes.md](exe-notes.md)); the engine
implementation is `packages/engine/src/research.ts`.

## Cost of the next advance (VERIFIED, 0x00496d12)

Let `a` = advances discovered so far (the civilization record's count, which includes Future
Technologies), and `n = a` except that `n = 1` while `a < 2` — the first two advances cost the
same. Let `L` be the count of the civilization everyone is measured against (the human player).

1. **Base per-advance price `k`.** Humans: `k = 2·d + 6` with `d` = difficulty clamped to 0–4,
   so Chieftain 6, Warlord 8, Prince 10, King 12, Emperor and Deity 14. AI: `k = 14 − d`.
2. **Catch-up and lead** (skipped when scenario parameters are in effect and the scenario says
   so): if `n < L`, `k −= 1` above Chieftain, and `k −= 1` again at Deity when `n + 4 < L` after
   turn 150. Otherwise `k += (n − L) / 3`. From 20 advances `k += clamp(n − turn/8, 0, 6)`.
3. **Tech paradigm.** `k = paradigm · k / 10` when the paradigm is not 10 (@COSMIC entry 12, or
   the scenario's own paradigm when the scenario flag is set).
4. **Three-quarter bonus.** `k += 3k/4`, scaled by `a/20` while `a < 20`.
5. **Ruleset size.** If the rules make more than 67 advances reachable, `k = k · 67 / reachable`.
   The shipped rules reach 90 (89 advances plus Future Technology; the "no"-prerequisite rows
   are not counted), so every price is multiplied by 67/90. 67 is the size of the first game's
   tree (INFERRED).
6. **Option flags.** Options byte 8 bit 2: `k = 5k/4`; bit 3: `k = 4k/5`.
7. **Human floor.** `k = max(k, 11 − n)` for humans.
8. **Cost = n · k**, and any result below 1 or above 32000 becomes 32000.

All divisions truncate toward zero. Worked examples (Prince, human, normal rules): the first and
second advances cost 10 beakers, the third 18, the 21st at turn 100 costs 420.

## Science income (VERIFIED, 0x004bb63d, 0x004970fd)

Each city's science (after the trade split, see [rules-city.md](rules-city.md)) goes to its
civilization once per city turn:

- **Chieftain bonus:** a human at Chieftain researching an advance that some civilization has
  already discovered (and that is not Future Technology) gets double science.
- **AI space race:** an AI above Warlord whose spaceship race is on and which still lacks the
  prerequisite of any spaceship part gets double science.
- **Anarchy:** a civilization under Anarchy receives nothing.

The civilization's beaker total then rises; when it reaches the cost and a target is set, the
advance is granted. A civilization with beakers but no target is asked to choose one. The
"free advance owed" flag (set by Philosophy) grants a second advance straight after.

## Receiving an advance (VERIFIED for the bookkeeping, 0x0049675f)

- Beakers reset to **zero** when the advance was researched — overflow is lost. An advance gained
  any other way (trade, hut, theft, Darwin's Voyage, Philosophy) keeps the stored beakers.
- The research target is cleared; humans choose the next one at once (AI picks in its turn).
- Future Technology (advance 89) raises its own counter; the discoveries count rises for every
  advance (INFERRED: the add-advance routine 0x004935e5 has not been read).
- Side effects on discovery that the original shows as popups: fortresses become available with
  Construction, railroads with Railroad, farmland, airlift and paradrop with the advances the
  rules name, and the Philosophy free advance.

## The AI's rate policy (VERIFIED, in the civilization turn 0x00467c61)

At the start of its turn, after its cities are processed, an AI civilization sets its rates
(tenths):

1. `lux = 10 − (science + tax)`. If any city is in disorder and `lux < 4`, `lux += 1`. Every
   fourth turn with no disorder and no content city of size 6 or more, `lux −= 1` while above 2.
   `lux` is clamped to 0–4.
2. `science = civilize + (10 − lux) / 2`, where `civilize` is the leader's personality value
   from @LEADERS. `+1` when the treasury exceeds `turn + 100`, `+1` again above 2000 gold; above
   8000 gold science takes everything left (`10 − lux`). If no continent it holds is still in an
   expansion plan and science is below 7, `+1`.
3. Cap by government: 6 under Anarchy/Despotism, 7 under Monarchy/Communism/Fundamentalism, 8
   under Republic, 10 under Democracy — and never more than `10 − lux`.
4. Once the civilization knows Fusion Power, The Laser, Space Flight, Plastics and
   Superconductor (everything the spaceship needs), science drops to 0.
5. `tax = 10 − (science + lux)`.

## Civilization turn order (VERIFIED, 0x00467c61)

Cities are processed from the **last** city slot to the first. Then the AI rate policy runs,
then the AI's attitude counters toward the human player are updated (not yet decoded in
detail). City sizes become visible to allied civilizations and to everyone once the Apollo
Program exists.

## Still to read

The research-target chooser (0x00495ee8), the add-advance routine with its obsolescence and
Future Technology handling (0x004935e5), and the AI attitude arithmetic.
