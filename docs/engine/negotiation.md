# Negotiation with a human

`packages/engine/src/negotiation.ts` ports the conversation. VERIFIED from the routines named
below unless marked INFERRED. Names of the working values are INFERRED from how they are used.
Multiplayer messages and the branches for scenario flags are not ported.

The conversation is a generator. Each yield is a dialog named by its GAME.TXT section, and the
answer is the chosen entry counted from 0, as the original's dialog call returns it. The entries
follow the first blank line of a section.

In the routines the first argument is the human, who pays tribute, and the second the computer
player. Below, H is the human and C the computer player.

## Fields it uses

| Civilization field | Name here                            | Notes                                                              |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------ |
| +0x105             | Nuclear Missile count                | one byte of the unit-type table at +0xd8, type 45                  |
| +22                | `patience`                           | fresh random 0 to 99 each turn, read by the senate test            |
| +31                | `talks`                              | signed, counts this round's exchanges with a human                 |
| +30                | reputation                           |                                                                    |
| +72 + n            | `pardons`                            | signed, what this civilization has forgiven of slot n's reputation |
| +0x6c              | citizens                             |                                                                    |
| +0x6e              | `power`                              | sum of attack + defence over its units (`strengthSum`)             |
| +994 + 2n          | turn of last talk or war with slot n |                                                                    |

`gap` is H's reputation less C's pardon for H.

The mapping of +0x192 to `unitsOn` and +0x212 to `attackOn` is INFERRED from the existing
strategy port.

## Assessment (0x00440b9e)

Run at the start and again after each treaty or payment. Results: `tribute`, a multiple of 50;
`hostile`; `fear`, how far C is outmatched, which clears `hostile`; `mood`, adjusted attitude;
`stance` 0 wary, 1 neutral, 2 hostile; `restraint`; `leader`, H ranked 7 and pressing its lead;
`betrayal`, C will not deal; `exposed`; `ceded`, cities C founded that H holds.

1. Each land mass 1 to 63. When C has a plan there and fewer units than H has attack, `fear` grows
   by H's attack × (4 on Chieftain, else 2) / (C's units + 1). Otherwise units of both set
   `hostile`, and `tribute` grows by a quarter or half of the gap, or by C's whole attack early
   (turn ≤ 200 − 50 × H's wars, or either ranked above 6) where C's plan is below 2.
2. C owning Marco Polo's adds a quarter. `leader` needs H at rank 7, over 4 cities, C over 1, H
   with no nuclear missiles, above Chieftain, past turn 200.
3. With `leader`, or a vendetta and C under three times H's power, and H with no missiles:
   `tribute` is at least twice C's rank, capped by H's means if not yet hostile; `hostile` sets,
   `fear` clears, `mood` is at least 75.
4. C with missiles sets bit 8, and if H has none, `hostile` and at least 100 tribute. H with
   missiles and no alliance: `fear` is at least 4 if C has none, otherwise `tribute` scales by the
   two counts.
5. `fear` divides by `(reputation − 1) / 2 + 1`. `mood` starts at C's attitude: −25 allied, +25 at
   war, `(reputation − 1 − pardon) × 5`.
6. Below 26 halves `tribute` and clears `hostile`. Band under 4 takes two thirds. Above 74 takes
   half as much again and sets `hostile`. Grudge sets it, as does bloodlust with C's science at 0
   (INFERRED that options bit is bloodlust). `fear` clears it.
7. H owning the Great Wall or United Nations clears `leader` and `hostile`, remembers it, and
   takes 10 from `mood`.
8. Reputation adds half per point; vendetta doubles; bit 16 quarters. An undefended city of H
   with a C unit within two squares doubles once and sets `exposed`.
9. `tribute = clamp((difficulty + 1) × tribute / 32, 0, 20) × 50`, reduced to H's gold when that
   is at least half. No tribute, or H over three times C's power, clears `hostile`.
10. `restraint` starts −2 for a vendetta, −1 for the bloodlust case, less half reputation, then
    takes each third civilization: allies below, wars above, C's leader `attack`, and −1 if H
    has less power. Above its limit `hostile` drops, and `tribute` too when `(turn + H + C) & 32`.
11. `betrayal` needs (first pass or `gap` > 6), no war or over 4 ceded, no alliance, hostility or
    a space race above Prince, and C weaker, or a vendetta, or `gap` > 6. It clears `hostile` and
    `stance` and caps `mood` at 30.
12. On the first pass a C Republic or Democracy with a hostile leader backs off from a much stronger
    H. Otherwise the leader overrides the senate: C picks a new government, none above Fundamentalism
    two times in three and none above Republic the rest (0x0051278c with 1).
13. Clamps: at least 1 with no `fear`; at most 99 unless H is at war; at most 74 if H is allied or
    `stance` is 0; at least 26 when H is at war.

## Conversation (0x00449c70)

`talks` resets when the emissary comes to H. When H calls: a grudge fills `talks`, an owed
ally-war clears it, and bit 21 or `talks` at the limit (0x00440acb) ends it at once with OUTAHERE.

The emissary is announced once, on the first thing C wants to say (0x00442942). Turning them away
skips every offer, and the end of the talk then falls to H's senate or Wonders.

In order: the exchange offer; a demand to break with C's enemy (CANCELTREATY); TRIBUTE; TAKECIV,
with OVERABARREL for a second advance when a city is `exposed`; an ally's BEGONE; war by PROVOKE,
REJECT0 or RID0; the alliance offer; at war a cease-fire, with GIVECIV, GIVECASH or GROVEL as
sweeteners; with no treaty, peace with CASHFORPEACE. The senate (0x0050f0ea) or the Wall or UN can
force a refused cease-fire or peace onto H. Then a greeting and the menu.

## The menu (0x00449960, 0x00445022)

Entries: 0 end; 1 alliance, at peace; 2 peace, with neither treaty; 3 a gift from allies; 4
tribute, under a government below the Republic and not allied; 5 withdraw, at peace with bit 14
clear; 6 cancel the alliance; 7 a proposal; 8 a gift. Each pass raises `talks`, and reaching the
limit ends with PATIENCE.

Alliance and peace test the standing, then may ask a secret (PERHAPSSECRET), gold (PERHAPSTHROWIN)
and the break with C's enemy (PERHAPSSOLIDARITY). Asking for a gift or tribute reaches the same
branch: C may withdraw troops from near H's cities (APOLOGIZE), pay, give an advance, or provoke.

## Proposals and gifts (0x004478c6, 0x00448bf8, 0x00443055, 0x00442d14)

Exchange: the best advance each side lacks, valued by 0x004920ac. C refuses on a vendetta, a
declared war, cities ceded, or a bad mood; may sell for gold (SELLTECH); an ally may give freely.
The second-best advance may be asked instead (EXCHANGEPETTY when it is not worth it).

War against a third party costs a computed fee, or two secrets from a rich C (CYBERCOP). The third
party may turn on H (MERCBETRAY). Maps need Map Making on both sides and `mood` of 25 or less.

Gifts raise attitude and take `talks` back down. An advance counts 4 × its value, or 2 × for the
second; gold counts 1.5 × `goldGoodwill` (0x00444fba).

A military unit goes to C's nearest city, unless C dislikes H or has more advances, rank or power.
It counts `cost rows × 3` attitude, half if C knows its prerequisite. If C does not, the first
advance C lacks in that tree may come with it (BREAKTHROUGH, even odds).

## A computer player's turn toward a human (0x00513f7e, 0x0050edb0)

Run from 0x0051326d for each human C has met.

Borders: the human's units on land inside a C city's radius are counted. Each adds 1 to a severity
figure, with more for the road, railroad, mine, irrigation or fortress under it. A unit already
warned, or more than three at a city, is a strike. With no treaty C may strain relations and
every fourth turn sends NEARCITY or ADMIRECITY. Under peace it sends INTRUDER, then VIOLATOR on a
repeat: agreeing teleports the units home, refusing breaks the treaty with war, a senate scandal
under Democracy (half the time under the Republic) bringing the government down, and +50 attitude.

Drift: then C's attitude toward H moves by the severity plus these terms. Lower is friendlier.
Allied: C's relative gold, advances and power, or the wars C is in. Peace −2. Not at war −1.
H ranked below 7 past turn 200: `−(7 − rank)`, halved up before turn 400, −1 in a space race.
H ranked 7 with over 3 cities past turn 200: `+(difficulty / 3 + 1)`, halved if H has enemies to
match its reputation gap. Missiles, C's leader's `attack × 3 + expand × 2`, the rank gap, the
power gap, the Great Wall or UN, leading in advances, C's leader's `civilize`, and the Eiffel Tower
on either side. No contact means no change.

Not ported: the TERMS message (0x006200e8) and the header flag 0x005da710 bit 0, read as clear.
