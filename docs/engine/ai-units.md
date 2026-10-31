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
5. **Order hygiene for computer units:** a sentried ground unit on land loses the sentry; orders
   above 15 are cleared; a unit with no order standing in an enemy zone of control gets the AI's
   hold order (16); a ground unit at sea is marked as cargo. Fortify orders set the "fortified"
   flag bit. Badly damaged units (half hit points or less) of civilizations at peace create a
   "heal here" objective.
6. **City objectives:** every own city without a village square becomes a defend objective
   (type 5, priority 1). Enemy cities the civilization may act against (seen, or late enough in
   the game) become attack objectives — type 2 against cities without walls, type 4 against
   walled ones — plus a type 3 objective when no treaty forbids it.
7. **Continent plans** (per civilization, per land mass; the city advisor reads them):
   - compare own units and attack strength on the land mass with every other civilization's;
   - **plan 0** when an enemy is present there and stronger (or barbarian cities exist, or the
     civilization has neither units nor cities there and has not been told the mass is friendly);
   - **plan 1** when the civilization is the stronger party against an enemy there, or a human at
     peace or cease-fire is much stronger (which also sets the "watch" flag);
   - otherwise **plan 4** when the land mass is full — land squares fewer than twice the units on
     it, or its value below `(cities on it) × (expand + 7, or 6 when contested) + 2` — and the
     civilization knows Map Making; else **plan 5** (room to grow).
     A changed plan re-plans the cities on that land mass. Plans 0 and 1 are what the city advisor
     treats as the "military" continent flag.
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
12. Finally the per-unit move loop runs (0x004709d5), and the "worker nearby" and
    "has objective" city flags are cleared for the next turn.

## What the engine does instead (INFERRED)

Computer players currently move no units. The planned interim behaviour, to be labelled INFERRED
in the code: settlers found cities on good unclaimed squares, one or two defenders fortify in each
city, spare combat units attack adjacent enemies and otherwise hold, and explorers roam. The real
objective and plan machinery above will replace it as the move loop is read.
