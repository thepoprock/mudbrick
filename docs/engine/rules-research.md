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
- Future Technology (advance 89, or any index above 99) raises its own counter; everything else
  sets the known bit, records who supplied it and marks the known-by mask. See "Gaining an
  advance" below.
- Side effects on discovery that the original shows as popups: fortresses become available with
  Construction, railroads with Railroad, farmland, airlift and paradrop with the advances the
  rules name, and the Philosophy free advance.

## Gaining an advance (VERIFIED, 0x004935e5)

Every source goes through this one routine: research, trade, theft, conquest, huts, events and the
Great Library. `packages/engine/src/advances.ts` and `grantAdvance` implement it.

1. The research target clears only if it is this advance.
2. The advance is recorded. On turn 0 the routine stops here, so the advances a civilization
   starts with never enter its advances count and none of the effects below run. The saves agree:
   early in a game most civilizations know one or two advances more than their count.
3. The advances count rises by one, even for an advance already known.
4. Gunpowder (35) and Mobile Warfare (53) close every Barracks the civilization has. It is paid
   `Barracks cost rows × shield box rows × cities`, whoever it is; only a human sees the message.
   If a ruleset disables advance 53, the walk goes down first prerequisites to the nearest
   enabled advance.
5. When nobody knew it before: Philosophy (60) sets the free-advance flag whatever the source, the
   first-discovery table is filled, and a wonder it ends is announced to its human owner.
6. Leonardo's Workshop, while it stands, sweeps the civilization's units (0x00492c44). Each unit
   whose obsoleting advance is known becomes the last unit type requiring that advance with the
   same role and at least its holds, and loses veteran status. A defensive-role unit weaker
   in defence than unit 7 (Musketeers) counts as obsoleted by Gunpowder. The same sweep runs when
   the wonder is completed, and for the new owner when its city changes hands (0x004ac56a,
   0x00528720).
7. The Great Library, while it stands: when its owner lacks the advance and at least two
   civilizations know it, the owner gains it through this same routine, with source −2.

Stand-in: the engine does not keep the per-advance record of who supplied it (civilization
+0x74 + advance), because nothing it has ported reads that yet.

## The AI's rate policy (VERIFIED, in the civilization turn 0x00467c61)

At the start of its turn, after its cities are processed, an AI civilization sets its rates
(tenths):

1. `lux = 10 − (science + tax)`. If any city is in disorder and `lux < 4`, `lux += 1`. Every
   fourth turn with no disorder and no city of size 6 or more whose turn result was zero (INFERRED:
   a quiet large city), `lux −= 1` while above 2.
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

## The AI's research choice (VERIFIED, 0x00494f3a and the value routine 0x004920ac)

Every researchable advance (unknown, prerequisites known, reachable) scores `rand() % value`,
and the highest score is researched (the earliest index on ties). For a human the science
advisor suggests `value + rand() % 3 − 1`; at Chieftain the research list hides every advance
for which `(index − advances known) % 3 == 0` except the first.

The value (`aiResearch.ts`, `advanceValue`) is built as follows, with "leads to X" meaning the
advance is X or one of X's prerequisite ancestors (0x00492025):

1. The leader's civilize trait, lowered for a computer player at war with a human who has more
   advances: one per advance the two share (floor −1), and to −1 outright when that human's
   reputation is above 6. Then `civilized modifier × civilize + AI value` (RULES @CIVILIZE).
2. The naval ladder: leads to the Trireme's advance 3, the Caravel's or Frigate's 2, the
   Transport's 1 (RULES @UNITS slots 32, 33, 35, 43), doubled under dearer research; it adds one
   point for a computer player (for a human only under dearer research) — the branch adding the
   whole ladder to a player with no one to trade with can never run, its test finding another
   civilization as soon as the player knows any advance.
3. The Port Facility's advance (slot 34): + sea units / 4 (the civilization's +0x6a count,
   INFERRED the strategic sea-unit tally).
4. Computer players only: when a human knows advance 76 (Space Flight), +2 for anything leading
   to advance 32 (Fusion Power) and +3 for the three spaceship parts' advances; when a human
   knows the Bomber's advance (unit slot 28), +2 for anything leading to it and +5 for it;
   per wonder whose expiring advance this is: −2 if the player holds the wonder (never for
   advance 37, Industrialization), +2 if a human holds it.
5. The Aqueduct's or Sewer System's advance: +2 (whenever the cosmic size caps are nonzero).
6. With a civilize of 0 or more and advance 85 (University) known: + civilize + 1 for anything
   leading to advance 16 (Computers), +2 for Computers itself. With advance 38 (Invention)
   known: +1 for anything leading to 37 (Industrialization), +2 if 57 (Navigation) is known.
7. The tribe's tastes (@LEADERS index): Romans +2 Iron Working, Bronze Working, Warrior Code,
   −1 Monotheism; Babylonians +1 Code of Laws; Germans +1 Banking, Theology, Philosophy;
   Egyptians +2 Masonry; Americans +2 Democracy, −1 Communism, +1 Rocketry, Computers,
   Leadership; Greeks +1 Polytheism, Bronze Working, Alphabet, Map Making, −1 Monotheism, +2
   Philosophy; Indians, Persians and Carthaginians +2 Polytheism, +1 Horseback Riding,
   Mysticism, Ceremonial Burial, −1 Monotheism; Russians +2 Communism, +1 Philosophy, Guerrilla
   Warfare; Zulus +2 Polytheism, +1 Horseback Riding, Mysticism, Ceremonial Burial, −1 Bronze
   Working, Iron Working; French +1 Leadership, Tactics, Conscription; Aztecs −2 Gunpowder, −1
   Monotheism; Chinese +1 Gunpowder; English +1 Monotheism and +1 for the naval ladder;
   Japanese +1 Steel, Miniaturization; Vikings +1 Map Making; Spanish +1 Monotheism and +1 when
   the ladder is above 1; Sioux +2 Horseback Riding; Mongols and Celts nothing.
8. +1 when no civilization knows it; −1 for every advance the player knows that has it as a
   prerequisite; never below 1.

## Civilization turn order (VERIFIED, 0x00467c61)

Cities are processed from the **last** city slot to the first. Then the AI rate policy runs,
then the AI's attitude counters toward the human player are updated (not yet decoded in
detail). City sizes become visible to allied civilizations and to everyone once the Apollo
Program exists.

## Still to read

The research-target chooser (0x00495ee8), the add-advance routine with its obsolescence and
Future Technology handling (0x004935e5), and the AI attitude arithmetic.
