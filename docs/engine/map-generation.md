# The random map maker

Read from the map routine (0x00402cd3) and its helpers: continent growth (0x00404512 →
0x00404703, 0x004048cd, 0x00404a42), the lake test (0x00404adf), the river maker (0x00404bf8),
the map buffer setup (0x00558500) and the resource seed (0x00558b1e). VERIFIED unless marked
INFERRED. `packages/engine/src/mapgen.ts` implements it; the result is a world of the same
character, not the original's byte-for-byte map for a seed (the C runtime's `rand()` is not
reproduced and the divergences below are INFERRED to be harmless).

The dialog's settings reach the routine as small integers: land mass 0–2 (`L`), land form −1
archipelago / 0 varied / 1 continents (`F`; INFERRED mapping), climate −1 arid / 0 / 1 wet
(`C`), temperature −1 cool / 0 / 1 warm (`T`), age 0–2 (`A`); on a flat world climate and
temperature are doubled. The worlds are 40×50, 50×80 and 75×120 stored columns × rows
(game x runs to twice the columns).

## Passes

1. **Setup (0x00558500):** every square ocean (terrain 10) with the five other bytes zero; the
   resource seed is the clock's low 15 bits, never zero (0x00558b1e); on a flat world the
   climate and temperature settings are doubled. The growth window keeps a four-row margin at
   the top or a five-row margin at the bottom (a coin toss), and columns 3 … width − 3 on a
   flat world.
2. **Continents (0x00404512 with 0):** repeat until the land count reaches
   `(columns × rows / 400) × ((L × 8 + 8 + max(0, F) × 8) × 5 + 80) × 8 / 10`. Each continent
   starts at a random square (x 8 … width − 9, y 4 … rows − 5), retried while the square is
   already land — unless a `rand() % (F + 2)` draw says to accept it, so the continents setting
   lets continents pile onto one another. A random walk of `rand() % 64 + 1` axis steps (two
   squares east, south, west or north) lays a three-square brush (the square and its two eastern
   neighbours); on land masses already taken the walk is halved. Under the continents setting the
   walk is `rand() % 48 + 1` steps and the brush spreads two squares in each direction with a one
   in four chance each. Every square the walk touched gains one height level.
3. **Islands (argument 1):** one per free land-mass id (64 less the ids already used, water
   bodies included): one to three random eight-direction walks of `rand() % 16 + 1` single
   squares.
4. **No diagonal joins:** every 2×2 block of the pattern "6" or "9" (two squares touching only
   at a corner) gets its three other squares filled, and the scan backs up to look again.
5. **Terrain by height and latitude:** height 0 ocean; height 2 hills; 3 or more mountains;
   height 1 by distance from the equator: `lat = |rows / 2 + 8 − (y + rand() % 16 + 1)| − 3T`
   (−6T flat), floored at 0, in bands of `rows / 12` (`rows / 8` flat, at least 2): band 0
   desert, 1–3 plains, 4 plains or tundra, 5–6 tundra, 7+ glacier.
6. **Moisture, eastward:** per row a moisture count starts at `rand() % (4T + inner + 5)` where
   `inner = | rows / 4 − |rows / 2 − y| |`; each ocean square adds one (capped at
   `4T + 4 + inner`); each land square spends `rand() % (7 − 2T)` and turns desert → plains,
   plains → grassland, hills → forest, tundra → forest; mountains cost three more.
7. **Moisture, westward:** the same walking the map buffer backwards (the engine walks each row
   east to west, INFERRED equivalent since the parameters are symmetric): cap
   `|rows / 2 − y| / 2 + T + 1`, spend `rand() % (5 − 2T)`; desert → plains, plains →
   grassland, grassland → jungle (within ten rows of the equator) or swamp (within three tenths)
   or forest and two more spent, hills → forest, tundra → plains, swamp → forest, mountains
   cost three.
8. **Erosion (age):** `(5A + 10) × 160` steps alternating a random square and a random
   neighbour of the last: desert → plains, plains → hills, grassland → forest, forest → jungle
   (near the equator) or plains, hills → mountains, mountains → a lake when land lies two
   squares away in all four directions (0x00404adf), tundra → hills, glacier → mountains,
   swamp → grassland, jungle → swamp.
9. **Smoothing:** `(3 − (A + 2)) × 800` steps (the youngest worlds only) in the same walk: a
   land square takes the most common land terrain among its neighbours (orthogonal neighbours
   count double, rough terrain counts once more when the square is rough), with the climate
   and temperature settings adding or removing a vote for a few terrains first.
10. **Rivers (0x00404bf8):** up to 1024 attempts for `2L + 2T + 12` rivers. A river starts on
    a random non-mountain land square, heads NE, SE, SW or NW, and each step rewrites the
    square (desert → grassland or plains, plains → grassland four times in ten, forest →
    grassland seven in ten, hills and mountains → grassland, tundra → plains, glacier → tundra,
    swamp → jungle six in ten) and marks the river; the heading drifts by `rand() % 2` less the
    step's parity. It ends when a diagonal neighbour is ocean, it leaves the map or meets a
    river already laid. A river that reached the sea or another river and ran at least
    `5 − attempt / 800` squares is kept; otherwise the map is restored.
11. **Poles (round worlds):** glacier on the top row beside land below and on the bottom row
    beside land above; after the land-mass tables are built both rows become glacier outright
    with `width / 8` random tundra squares on rows 0, 1, rows − 2 and rows − 1.
12. **Land masses (0x00489f7e), fertility (0x0040291f), deep ocean:** the ids and their land
    counts, the fertility nibbles, then any ocean square with no land in its twenty radius
    squares has its special suppressed (the "no special" bit).
