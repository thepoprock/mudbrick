# Diplomacy and governments

Read from the original's treaty helpers, the contact review, the per-turn routine and the
government picker (addresses below). VERIFIED unless marked INFERRED. The engine's
`packages/engine/src/diplomacy.ts` and `government.ts` implement what is described; the human's
negotiation screens (0x00449c70, 16 KB; the computer's approaches to a human 0x00513f7e and
0x0051520a) are not read, so a human's side of a proposal is a callback with a default.

## The treaty word (civilization record +32, one 32-bit word per slot)

| bit | meaning                                            | evidence                                                                                                                                                                    |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | contact                                            | set on meeting (0x00510ac7); clearing it clears war (0x0044ddc0)                                                                                                            |
| 1   | cease-fire                                         | cleared by war                                                                                                                                                              |
| 2   | peace                                              | implied by an alliance; clearing it clears the alliance                                                                                                                     |
| 3   | alliance                                           |                                                                                                                                                                             |
| 4   | vendetta                                           | turns into a grudge (bit 11) when war is declared at a review                                                                                                               |
| 5   | strained truce (INFERRED name)                     | set on both allies' words toward a common vendetta foe (0x00510871); each turn a computer player breaks a strained truce with chance 1 in `clamp(3 − reputation / 4, 1, 3)` |
| 6   | broken (INFERRED name)                             | set with bits 11 and 19 when a strained truce breaks                                                                                                                        |
| 7   | embassy                                            |                                                                                                                                                                             |
| 9   | attacked                                           | set both ways when one attacks the other's unit (the combat routine)                                                                                                        |
| 10  | met this turn                                      | set at a review, cleared by the next turn's housekeeping                                                                                                                    |
| 11  | grudge (INFERRED name)                             | keeps a war from lapsing; cleared every 32 turns unless bit 19                                                                                                              |
| 13  | war                                                | setting it clears cease-fire, peace and alliance and sets bit 21                                                                                                            |
| 14  | first contact this turn                            | cleared next turn                                                                                                                                                           |
| 16  | ally's war pending against a human (INFERRED name) |                                                                                                                                                                             |
| 18  | tech gift given                                    | cleared each turn for computer partners                                                                                                                                     |
| 19  | grudge renewed (INFERRED name)                     |                                                                                                                                                                             |
| 21  | war declared this turn                             | cleared next turn                                                                                                                                                           |

Setting bits (0x0044de95) writes both civilizations' words; cease-fire, peace or alliance clear
bits 5, 6, 9, 11 and 13. **At war** (0x0044e123): the war bit, or — short of an alliance —
contact without peace and an attitude above 49. Attitudes are one byte per slot at +64
(0x0044df74; 0x00440a60 adds to one); reputation is the byte at +30. The 8 × i16 table at +994
holds the turn each slot last attacked or declared war on the civilization (set by the combat
routine and by 0x00510871). The engine treats barbarians as everyone's enemy (INFERRED: the
original's loops skip slot 0).

## Contact and the review (0x00510ac7)

A unit that arrives beside a foreign unit of a civilization it has no contact with opens the
contact (VERIFIED in the arrival handler 0x0041aad6: one of the eight neighbouring squares, the
mover a land unit on land and not a Caravan, and only when the move allows talking); the engine
sweeps each civilization's units once a turn instead and also counts cities (INFERRED
equivalence). With a human on either side the original
opens the negotiation screens; the engine queues the same conversation (`Game.pendingTalks`, negotiation.md) when a UI holds
one, and otherwise asks `humanAccepts` (default: accept peace, decline alliances). Between computer players the review records contact and, on first contact or every
fourth turn for the pair (`(turn + a + b) & 3 == 0`):

- Each side is **willing** when it does not want war (below), or the other owns the Great Wall
  or the United Nations, or it is a Republic or Democracy not at war with the other (the
  senate).
- Both willing: allies-to-be exchange advances (below); not yet at peace → **peace** (the
  Great Wall and the United Nations force it on a civilization at war); already at peace → the
  **alliance review**: a common enemy is sought — the leading human (difficulty above
  Chieftain, five cities, turn 200 or later), else for allies any civilization neither is at
  peace with, else (unless a human faces a computer player of control 4 or more) one both are
  at war with and neither outranks; with no candidate, or allies around and no gate, an
  existing alliance is cancelled; otherwise an alliance is signed and each ally joins the war on
  the candidate (0x00510871: never against an ally or a current foe; against a human only six
  turns after its last attack, two times in three for a computer player; the turn is recorded).
- Otherwise, when not already at war: **war** — peace is cancelled, the war bit set, and a
  vendetta becomes a grudge on the declarer's word.

**Wanting war (0x0050fdc6):** always with a grudge or a vendetta; never when either side is at
war with someone stronger than the other (and not allied to them), or when the other has more
nuclear missiles; else a count — +1 per civilization a is at war with, +1 per common ally (+2
when it outranks both), −1 per ally of a at war with b, −1 per human at war with b after turn
200, +1 when not at war with b, +1 when allied — is compared with the forces on shared land
masses: never when b's attack exceeds a's units plus attack on a land mass where a has cities;
over the land masses where both are present, a is deterred when `4 × a's attack / (b's attack / 2

- b's units + 1)`is below`count − a's attack personality + 4` and a has cities there.

**Ally tech exchange (0x005103ce):** each side's best advance the other lacks (the receiver's
research value, 0x004920ac in aiResearch.ts, plus a random 0–2 — VERIFIED); both have one →
swap; only one → the lagging ally receives it when `(6 − difficulty) × 2` or more advances
behind (or the leading human is ahead of both), once per cycle (bit 18).

## The per-turn housekeeping (0x0051326d)

For each civilization after its cities: bits 14, 21 and 23 lapse; a random 0–99 goes into byte
+22 and the civilization's flag bit 2 flips one time in three; byte +31 falls every third turn.
For a computer player and each other civilization in play: a strained truce may break (above);
toward computer partners the tech-gift bit is cleared, every 32 turns the grudge lapses unless
renewed, and every 16 turns (when they have not met this turn) a pair that is not allied either
reviews its relations (at peace, with options byte 0 bit 0 set) or, when not at peace, lets a
war without a grudge **peter out by losing contact** — a message when at war; allies exchange
advances instead, as they also do every 8 turns. Then the computer approaches each human it has
contact with (negotiation.md) and makes demands.

**Military aid** (0x005129ba) was written to send one strong land unit from a city on a full land
mass to an ally at war with someone at least as strong, into an ally's city on a defend-plan land
mass with units in it and no enemy adjacent. In the shipped game it never happens: its first test
on a candidate unit passes only when the unit is out of map bounds (VERIFIED in the machine code
at 0x00512c94, both exits jump to the loop's next unit). `militaryAid` is written but not called.

## Governments

**Allowed (0x0050f468):** Despotism always; Monarchy, Communism, Fundamentalism, the Republic
and Democracy need their advance (54, 15, 31, 71, 21 in the shipped rules) or the Statue of
Liberty; Fundamentalism also needs the rules to allow it.

**Scores (7 × i16 at +980, VERIFIED):** reset at the start of the civilization's turn and fed
during each city's turn by one scoring pass — the switch at 0x005b8648 is set around the city
turn's recompute (also while founding and capturing), and while it is set three routines add to
the scores as they run:

- the square yield (0x004b4102) takes a point from Despotism for every worked square making
  more than 2 of anything (not while celebrating) and gives the Republic and Democracy a point
  for every worked square with trade;
- corruption (0x004b530c, its fourth argument: the waste call and the trade call that includes
  the routes) takes from Despotism, Monarchy and the Republic what each would lose at the city's
  distance from the capital (16 at most for waste; a human's difficulty added below Monarchy),
  and from Communism its cosmic palace distance at the current government's factor
  (0x004b52bb: 4, +1 past Anarchy, Despotism, Monarchy and Fundamentalism) — no courthouse
  halving, nothing against Fundamentalism or Democracy;
- the trade split (0x004b5c68) gives Fundamentalism half the luxuries, takes
  `(civilize + 3) / 4` of the science, and adds `(Marketplace + Bank + Stock Exchange + 2) ×
tithe / 2`.

Then the city's own share (0x004bc513): a shield shortfall (support beyond what the city makes
after waste) × 5 and its unit support beyond Monarchy's free units (up to the city size) to
score 0, the "current state"; every government loses the support it would have to pay
(Despotism beyond the city size, Monarchy and Communism beyond their free units,
Fundamentalism beyond its, the Republic and Democracy everything), counting homed units of
roles 0–5; unless Shakespeare's Theatre is here, Democracy loses
`(2 − suffrage) × (attack personality + units away + 1)` and the Republic
`(attack personality + units away) × (1 − suffrage)`, each times `7 − civilize` (5 with a
Marketplace, −1 with a Bank, −1 with a Temple and a Cathedral or Michelangelo's), where
suffrage means Women's Suffrage or a Police Station. The civilization turn (0x00467c61) then
adds twice score 1 to score 0, and for a computer player: Democracy gains for every diplomat and
spy the leading human fields when the human is a Fundamentalist and the player could be a
Democracy (the +0x1c count is INFERRED 0), +10 when poorer than the human; both Republic and
Democracy drop to 0 for an aggressive player behind the human in advances, are cut to three
quarters for timid personalities, halved or zeroed by the advance gap rule, halved after a
spaceship launch at Emperor and above, and zeroed under bloodlust with no science.

Not ported (INFERRED, bit meaning unknown; the bit is clear in an ordinary game): when options
byte 8 bit 0 is set, the picker sets Democracy to −2 and the Republic to −1 for a computer
player 7 or 9 advances behind the human, and the support routine (0x004ba99a) vetoes both with
−999 when a human leads in advances. Also open: the same support routine disbands, every eighth
turn per unit, the farthest land unit of a computer player's rioting city under the Republic or
Democracy.

**The pick (0x0051278c):** every eighth turn (`(turn + slot) & 7 == 0`, from the strategic
layer) and after a sneak attack by a senate government (ceiling 5, or 4 two times in three) the
computer takes the highest-scoring allowed government up to the ceiling — 6, but 3 when score 0
is positive and 1 unless it is already a Democracy; later ties win. The change is immediate
(0x0050f257) and clears every vendetta; the OVERTHROWN and CHANGED messages are cosmetic.

**Anarchy (0x0051326d):** a computer player in anarchy becomes a Despotism on the first turn
divisible by four (at once with the Statue of Liberty); a human is offered the choice on such a
turn, never on the turn the revolution began. A human Democracy with a city in disorder two
turns running falls into anarchy (the happiness routine, already in the engine).

## Breaking a treaty, declaring war, allies, cancelling an alliance (VERIFIED)

- **Breaking a treaty** (0x004447be; `breakTreaty(a, b, witness)`): outside an alliance, at
  mere contact only the witness's attitude toward the breaker drops by 5; at cease-fire or
  peace the breaker's reputation byte rises (worsens) once for a fully human-controlled breaker
  with more than four cities when there is no witness and once above Chieftain without the
  Eiffel Tower — the original runs both tests twice when the peace and cease-fire bits both
  stand — a human breaker's count toward the victim (record +0x48) drops, the witness's attitude
  drops by 15; then a human breaker earns the victim's vendetta, war is declared, the human's
  word gains the grudge bits, the last-war turn is noted and the victim's allies join (below).
  Inside an alliance: reputation worsens above Chieftain without the Eiffel Tower and once more
  without a witness, the witness's attitude drops by 25, the alliance is cancelled and a human
  breaker earns a vendetta.
- **Declaring war** (0x00526d80; `declareWar`): the strain and broken bits go; at cease-fire or
  peace with a human on either side the treaty is broken as above; peace and alliance go; with
  contact the war bit is set, both attitudes jump to 100, and the first declaration of the war
  marks the declarer's word (bit 12). Called by the MAKEAGGRESSION event, by the attack handler
  after the human confirms breaking the treaty, and by the negotiation screens.
- **Allies join** (0x0044442f; `alliesJoinWar`): when the victim has contact with the breaker,
  each ally of the victim that has contact and neither war nor alliance with the breaker declares
  war (war, met-this-turn, contact) with the grudge bits — for a computer breaker only when the
  victim is human; for a human breaker always, the ally's attitude toward the breaker going to
  100, the victim's word gaining the grudge bits and the breaker's last-war turn noted.
- **Cancelling an alliance** (0x0044e525; `cancelAlliance`): the alliance bit goes and each
  side's units standing in the other's cities move to the nearest own city (0x0044e1e2; the
  original's further conditions — coastal cities for ships — were not read in full, INFERRED).
- **Pillage** (0x00498170) inside another civilization's city radius breaks the treaty when not
  already at war and declares war outright (rules-units.md).
