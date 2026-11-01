# Combat rules

Status: **VERIFIED by decompilation** of the original executable (Multiplayer Gold Edition):
the attack handler at 0x0052d472, attack strength at 0x0052b404, defence strength at
0x0052b47b (see exe-notes.md). Implemented in `packages/engine/src/combat.ts`. Items still
marked INFERRED are named as such.

Several widely repeated community claims turned out to be wrong and are called out below.

## Strengths are integers

The original works in eighths of a combat point. Veteran and similar "×1.5" steps are computed
as `x += x >> 1` (integer, rounding down), so the engine does the same.

### Attack strength `A`

```
A = attack × 8
if veteran:                       A += A >> 1          (×1.5)
real attack (handler 0x0052d472): A = A × min(movesLeft, 3) / 3   — a unit with a third of a move left attacks at a third (VERIFIED; the FATIGUE confirmation asks first)
if status bit 4 set:              A += A >> 1          (×1.5; meaning of the bit unknown — INFERRED none of the shipped files set it)
if attacker has less than one full move left: A = A × movesLeft / 3   (thirds; see rules-movement.md)
```

**Damage does not reduce strength.** A unit at 1 hit point attacks and defends at full strength;
it simply has fewer hit points to lose. The "fights at reduced strength when damaged" claim is
false for this edition.

### Defence strength `D`

```
D = (terrainDefenceHalves + river) × defence × 4
```

`terrainDefenceHalves` is the RULES @TERRAIN defence field (grassland 2, forest 3, hills 4,
mountains 6). A river on the defender's square **adds 1 to the halves**: grassland with river
is ×1.5, hills with river ×2.5. (Not a flat ×1.5 multiplier.)

Then one terrain-position multiplier `m`, in halves, default 2 (×1); only one of these applies,
in this order of precedence:

| condition                                                                                                                                                                                 | m         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| defender is a ground unit under the **Fortify order** (order code 2)                                                                                                                      | 3         |
| square has a fortress and no city, attacker is not air and does not negate walls (howitzer flag)                                                                                          | 4         |
| in a city: defender is an air unit with the "can attack air" flag (fighter), attacker is air and not a missile: ×4 of the current `m` if the attacker cannot attack air (bomber), else ×2 | m×4 / m×2 |
| in a city with City Walls, or defender's civilization owns the Great Wall; defender is ground; attacker is ground and does not negate walls                                               | 6         |
| defender is not a ground unit (and not the fighter case above)                                                                                                                            | 2         |

```
D = D × m / 2
if veteran: D += D >> 1
```

Note: being inside a city does **not** by itself grant the fortified ×1.5; the unit must carry
the Fortify order. (Whether the game auto-fortifies units in cities is a separate, unverified,
question for the orders code.)

### Situational multipliers applied by the attack handler

| condition                                                                                                   | effect                                                                       |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| attacker role 3 (air superiority) vs air defender with range 0 (helicopter)                                 | D −= D >> 1; defender firepower = 1                                          |
| defender has the "×2 vs horse" flag (pikemen) vs ground attacker whose full move is 2 and max HP is 10      | D += D >> 1 (**+50 %**, not ×2)                                              |
| defender has the "×2 vs air" flag (AEGIS) vs air attacker                                                   | D ×5 if the attacker is a missile (destroyed-after-attack flag), else **×3** |
| defender's city has Coastal Fortress (improvement 28), attacker is sea, defender is not sea                 | D ×2                                                                         |
| attacker is air, defender's city has SDI Defense (17), attacker is a missile with attack < 99 (not nuclear) | D ×2                                                                         |
| attacker is air, defender's city has SAM Missile Battery (27)                                               | D ×2                                                                         |
| attacker is unit type 9 (Partisans) vs a defender with attack 0                                             | A ×8                                                                         |
| attacker is sea, defender is ground (shore bombardment)                                                     | both firepowers = 1                                                          |
| defender has the submarine flag                                                                             | defender firepower = 1                                                       |
| defender is sea, not in a city, attacker is not sea                                                         | defender firepower = 1, attacker firepower ×2                                |
| **barbarian attacker** vs AI civilization                                                                   | A = A / 2                                                                    |
| barbarian attacker vs human                                                                                 | A = A × (difficulty + 1) / 4                                                 |
| barbarian attacker vs a civilization with fewer than 2 cities                                               | A = 0                                                                        |
| barbarian attacker vs a city holding the Palace                                                             | A = A / 2 and the defender gets the double-roll (below)                      |
| barbarian attacker vs a civilization with fewer than 8 cities                                               | defender gets the double-roll                                                |
| barbarian attacker vs a civilization owning the Great Wall                                                  | A = A / 2                                                                    |
| barbarian defender that is unit type 4 (Archers), or type 5 (Legion) under a condition not yet read         | D = max(1, D / 2)                                                            |
| attacker's civilization owns the Great Wall vs a barbarian defender                                         | A ×2                                                                         |

Improvement and wonder numbers are RULES @IMPROVE indices (Palace 1, City Walls 8, SDI 17,
Coastal Fortress 28, SAM 27; wonders 39+n: Great Wall = 45, Sun Tzu's War Academy = 46).

## Rounds

Hit points are `hitPointsTens × 10`. Each round:

```
a = A > 1 ? rand() % A : 0
d = D > 1 ? rand() % D : 0
attackerWinsRound = d < a                      (strictly less)
if defender has the double-roll:               (barbarian cases above)
    a2 = rand() % A ; d2 = rand() % D
    if a2 < d2: attackerWinsRound = false
if attackerWinsRound: defender.hp -= attackerFirepower
else:                 attacker.hp -= defenderFirepower
```

until one side has no hit points left. This is **not** `rand(A + D) < A`: two independent draws
are compared, which gives the stronger side slightly better odds than the simple ratio. The
original's `rand()` is the C runtime generator (15-bit); the engine uses its own uniform
generator over the same ranges.

## After the battle

- The winner's hit points stay as they are. The loser is destroyed.
- **Veteran promotion:** if the attacker lost, the defender is promoted when
  `rand() % (A + D) <= A` or its civilization owns Sun Tzu's War Academy; if the attacker won, it
  is promoted when `rand() % (A + D) <= D` or its civilization owns Sun Tzu's. So beating a
  stronger opponent promotes more often, and the chance is never zero.
- The attacker spends one movement point (3 thirds) on the attack (INFERRED from one branch;
  the exact condition is not yet read).
- A per-civilization-pair "losses" counter is incremented when the attacker loses and reset
  when it wins; the AI reads it.

## Odds preview

When the handler is called in preview mode (the "attack odds" display) it returns
`(A × 8) / (D + 1)`, capped at 1024, after optionally weighting each side by
`hitPoints + firepower × 8` when the relevant option bit is set, and after halving both sides
while A ≥ 4000.

## Which unit defends (VERIFIED: 0x0052b823)

Every unit on the attacked square is scored and the highest score defends (ties go to the unit
examined later). Ground units standing on an ocean square (passengers) are skipped. The score is:

```
score = DefenceStrength(unit, attacker)              (the function above, before the handler's adjustments)
if simplified combat is off: score = score × hitPointsLeft / maxHitPoints
if unit has the pikemen flag: score += 1
if unit has the AEGIS flag: no attacker → +1; air attacker → ×3, or ×5 for a missile
if unit can attack air and the attacker is an air unit that can attack air: ×2
if unit is a sea unit inside a city: ×2 against an air attacker when the city has no SAM battery, otherwise ÷2
```

Note that damage influences _who_ defends even though it does not reduce the strength used in
the rounds.

## Still to read

The attack-cost condition, the Legion-vs-barbarian
condition, nuclear attacks (attack 99), and what status bit 4 means.

## After the fight (VERIFIED, 0x0052d472)

- A real attack costs the attacker **one full move** (the road multiplier in thirds, 3 in the
  shipped rules), whatever it had left.
- With **simplified combat on** a single round decides the battle and the loser is destroyed; with
  it off the units fight to the death, damage accumulating by the winner's firepower each round.
- The loser is destroyed. When the **defender** loses **in the open** — no city, fortress or
  airbase on its square — every other unit on that square dies with it.
- A **barbarian leader** (a barbarian unit of role 5 or higher) beaten by the attacker pays a
  ransom of `50 × barbarian activity` gold.
- A **city** whose defender falls to an attacker standing **on land** loses one citizen unless it
  has City Walls, its owner holds the Great Wall, or the owner is a human at Chieftain. A city
  emptied this way is destroyed.
- Units that are **destroyed after attacking** (missiles) are consumed whether they won or lost.
- Promotion as above: `rand() % (A + D) ≤ loser strength`, or always with Sun Tzu's.
- A computer attacker that wins against an emptied city walks in at once; a human must move in.

## Capturing a city (VERIFIED, 0x00528720, 0x00526efb, 0x005273ba)

Entering an undefended enemy city with a ground unit captures it:

- **Plunder:** `treasury × city size / (loser's total population + 1)` gold moves from the loser to
  the captor (none for barbarians).
- The shield box empties; disorder and celebration end.
- Unless the captor is the civilization the city was last taken **from** (a liberation): the
  Palace, Temple, Cathedral and Courthouse are destroyed, and — on conquest by force — **half the
  remaining improvements**: all buildings whose index has one parity (even or odd, chosen at
  random) are lost.
- The city loses **one citizen** on conquest or whenever it is larger than 1; a size-1 city taken
  by force is destroyed.
- Units supported by the city: partisans keep going without a home; a Defend-role unit standing in
  another city of the loser is re-homed there; everything else is disbanded.
- A human captor under Republic or Democracy (above Chieftain) finds the city in disorder.
- Production that is no longer valid resets to the best defensive unit (as for a new city).
- **Partisans** rise for a loser under Communism or Democracy, or once anyone has discovered
  Guerilla Warfare, or when the loser knows Communism: count `= ((size + 6) / 8) × (|government
difference| + |rank difference| + 1) / 2`, halved when not by force, −1 without Conscription;
  without Guerilla Warfare the count is zero unless the loser knows Communism and Gunpowder; with
  it the count doubles when the captor lacks Guerilla Warfare, else +1. They appear fortified on the
  best radius squares (defence × 2, +1 road, +1 railroad, ×2 fortress), veteran by a reputation roll.
- The captor **learns one advance** the loser knows (the highest AI value; a human chooses), unless
  the scenario forbids it; a scenario that forbids government changes also withholds the
  government advances.
- Not modelled yet: attitude changes, the civil-war split when an AI capital falls, the 1000-gold
  Palace escape, wonder-movie and Leonardo's/Eiffel effects of a captured wonder.

## The AI's odds (VERIFIED, the evaluate-only entry of 0x0052d472)

The same routine that fights also answers "how good is this attack" for the AI (its third
argument 0): it prepares both sides with every modifier above but without the fatigue scaling,
then — with simplified combat off — weights each side by `hit points left + firepower × 8`,
halves both while the attacker's exceeds 3999, and returns `8 × A / (D + 1)` capped at 1024
(999 when no unit stands on the target square). The engine's `combatOdds` is this.

## Nuclear (VERIFIED 0x0052cb14, 0x00559699)

A unit with attack 99 or more detonates over its target. An SDI Defense within three squares of the
target, in a city not the attacker's, stops it, and the missile is lost either way. A spy's
device skips that test. Every unit on the nine squares dies. Each owner hit sets vendetta and bit 8
on its word toward the attacker, the attacker sets bit 17 on its word, and the owner's attitude
rises by 100.

Fallout on the nine squares: a city loses `size >> 1` citizens. Land outside cities loses a
fortress, and at even odds each of railroad, mine and irrigation, and takes pollution two times in
three. Everyone's memory of the square is refreshed.

A computer player that detonates follows up (0x0052cfed): one paratrooper in a city within range
drops on the target, and land attackers within six squares on the same land mass, its own or a
non-human ally's, get a go-to there.
