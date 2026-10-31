# Starting a game

Read from the new-game routine (0x00483c9f), the civilization birth routine (0x00480fc9) and
the start balancing pass (0x00480a34). VERIFIED unless marked INFERRED.
`packages/engine/src/newGame.ts` implements it.

## The game (0x00483c9f)

Turn 0, year −4000 (the header's year word is −4000), no wonders built, every tribe unused,
every civilization record reset; then the birth routine runs for all eight slots and the
"ever in play" mask copies the in-play mask. Humans keep the default rates (science 6, tax 4)
unless a saved default sums to more than ten or exceeds six; at Chieftain a human starts with
50 gold (everyone else with none).

## A civilization's birth (0x00480fc9)

- Reset: government Despotism, rates 4/4, reputation 0, treaties cleared both ways, plans
  "room" (5) on every land mass, last-war turns −1.
- Attitudes: 100 toward oneself; between two computer players `rand() % 80 + 10` the same both
  ways; toward or from a human `difficulty × 5 + rand() % 80 + 10` clamped to 10 … 75.
- A computer player's tribe is drawn from the three sharing its colour, preferring unused
  ones; a used tribe may decline to return (`rand() % (uses + 1) ≠ 0`). One time in three the
  leader's gender flips, which picks the other name. A computer player's science rate becomes
  `civilize + 3` and its tax rate the rest of nine.
- Advances for a civilization born after turn 0 (civil war): each advance known to three or
  more civilizations is granted with chance `(difficulty) / (difficulty + 1)`.
- **The start site:** up to 2000 random squares (a human at turn 0 keeps trying): on a flat
  world 81+ wide the first 1500 tries keep eight columns from the edges, likewise eight rows
  when 40+ tall; the x parity is fixed to the row. The square is refused while it is ocean,
  its land value (0x00559162) is under `12 − tries / 32`, the nearest unit or city is nearer
  than `16 − tries / 128` (nearer than 2 before the tries run out, nearer than 1 ever), its
  land mass has fewer than `32 − turn / 16 − tries / 64` squares, after turn 200 another
  civilization has cities on the land mass, a hut sits on it (before the tries run out) or a
  city does. A tribe with a scenario start location uses it instead. Rows 0–2 and the last
  three rows fail the civilization: it leaves play, and the game ends when fewer than two
  remain.
- Barbarian units within eight squares are removed. One Settlers (unit type 0) appears; after
  turn 20 a second one when no human has seen the square, after turn 40 a unit of type 3 when
  the civilization can build it. The twenty-one squares around the site become seen.

## Balancing (0x00480a34)

Each civilization's first unit is scored: the nearest other start on the same land mass at
10–19 squares +1, at 20 or more +2, none at all + the land mass's squares / 50 clamped to
3 … 6; four or more river squares in the city radius +4, else more than three grassland +2;
the land mass's squares / 50 up to +3. The highest score sets the bar: a civilization more
than three below it gets a second Settlers (+3 to its score; a human at Deity always gets one,
worth +1), then one free advance per remaining point of difference — the civilization's
research target, chosen first when it has none (INFERRED: the engine draws a random
researchable advance in place of the chooser).

## What the engine leaves out

The multiplayer branches, scenario start locations, the first-turn popups, and the exact
`rand()` stream (the C runtime's generator is not reproduced).
