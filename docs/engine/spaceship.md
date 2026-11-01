# The spaceship

Read from the part table (0x005bd798), the per-civilization part limits (0x0053dcd0), the
evaluation (0x0053e0bd) with its thrust helper (0x0053e063), building a part and the computer's
launch decision (0x0053f36b), the launch (0x0053e5cf), the "kind complete" test (0x0053fbd4),
the space-race test (0x0053ff14), the arrival in the yearly routine (0x00467591) and the score
credit (0x0047c9e0). VERIFIED unless marked INFERRED. `packages/engine/src/spaceship.ts`
implements it; the research panel shows the ship and a Launch button.

## Parts

| part         | production item | limit | mass |
| ------------ | --------------- | ----- | ---- |
| structural   | 35              | 39    | 1    |
| propulsion   | 36 (component)  | 8     | 4    |
| fuel         | 36 (component)  | 8     | 4    |
| habitation   | 37 (module)     | 4     | 16   |
| life support | 37 (module)     | 4     | 16   |
| solar        | 37 (module)     | 4     | 16   |

A component goes to the emptier of propulsion and fuel, a module to the lowest of the three (the
original asks a human; INFERRED: the engine picks the same way). A kind is complete when every
part of it stands at its limit (0x0053fbd4); the city then reports BADSPACE. The structure
supports only so many of the others (0x0053dcd0): propulsion `(s + 1) / 4`, fuel `(s − 1) / 4`,
habitation `(s + 1) / 8`, life support `(s − 3) / 8`, solar `(s − 7) / 8`, each at most the
limit, and a computer player's modules count at most one each. The first part marks the ship
started (flag bit 0) and clears every human's war-turn memory (a VERIFIED oddity).

The spaceship byte (civilization record +0x400): bit 0 started, bit 1 launched, bit 2 arrived,
bit 3 Fusion Power known at the last evaluation, bit 4 won. Then the arrival year (+0x402), the
launch year (+0x404), the population aboard (+0x406: habitation modules at launch, × 10,000) and
the six counts (+0x408 …).

## Evaluation (0x0053e0bd)

With the counts clamped to what the structure supports: mass = Σ count × mass; a "full mass"
adds the mass of every kind still at zero. Life support % = `life × 100 / habitation`; energy %
= `solar × 200 / (habitation + life)`; fuel % = `fuel × 100 / propulsion` (each divisor at
least 1). Success starts at 100, is scaled by the energy % (capped at 100) and — only when the
spaceship screen asks (the computer's launch test does not; VERIFIED quirk) — by the life
support %. Thrust units of n engines or tanks: one each, two from the fifth, three from the
seventh (0x0053e063). Speed = the Mass/Thrust paradigm (@COSMIC 20, 75), ×¾ with Fusion Power,
halved until at most 100 with the halvings remembered. Flight time in tenths of a year = `mass ×
speed / (thrust × 10 + 1)` (INFERRED: the decompiler shows the tanks' thrust capping the
engines'), times the halvings; above 15.0 years the success drops by `(tenths − 150) / 10`.
The arrival year uses the full mass; the estimate is kept on the record until the launch fixes
it.

## Launch, arrival, loss

A human launches from the screen. A computer player decides after every part it adds
(0x0053f36b): nothing below 40 % success; with structure, propulsion and fuel complete it
launches; otherwise it waits for a human launch to beat (launching when its own arrival is
earlier), or launches at over 75 % success, or when a human outranks it or has a started ship
and more than 999 gold; at King and above it also yields to a computer ship already due
earlier (INFERRED reading of the last branches). The launch (0x0053e5cf) records the year, the
population aboard and the first launch turn; a computer player re-chooses every city's
production; a human launch sours the computer players whose ships would arrive later (treaty
flags; not modelled).

Each year the first launched ship whose arrival year has come lands (0x00467591): its
civilization wins and the game ends. **There is no loss roll**: the success percentage only
weights the score — population aboard × success (0x0047c9e0). A capital captured takes an
unlaunched ship with it (the capture routine tests the started flag).

## The engine's end of game

`GameState.gameOver` records the winner and reason. Besides the landing, the engine ends the
game when one civilization remains (INFERRED: the original sets its game-over flag when a
civilization dies leaving fewer than two) and removes a civilization with no city and no unit,
or with no city after turn 20 (INFERRED).
