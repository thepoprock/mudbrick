# Diplomats and spies

Read from the diplomat-in-city routine (0x00499c93), the agent's fate (0x0049904c), the
hard-action catch test (0x00499548), the capital-distance helper (0x00499670), the incite
transfer (0x00499758), the diplomatic incident (0x00498a90), the bribe (0x0049c5c6) and the
diplomat-versus-unit menu (0x0049cf5b). VERIFIED unless marked INFERRED.
`packages/engine/src/espionage.ts` implements it; the play screen offers the missions in the unit
panel when a diplomat or spy steps at a foreign city or a lone foreign unit (the move handler
sends both to these routines before any combat). The original tests unit type 47 for "is a Spy".

## The menu (humans)

Establish an embassy (unless one exists or Marco Polo's is owned), investigate the city, steal
technology (not twice from one city with a diplomat), sabotage, poison the water supply (spies,
size above 1), plant a nuclear device (spies knowing Rocketry and Nuclear Fission once the
Manhattan Project stands), incite a revolt (not the capital). With a treaty (cease-fire, peace or
alliance) a human is first asked whether to cause an incident.

## The agent's fate (0x0049904c)

After an act the agent spends one move point. A **spy** rolls to escape: `n = 2` after an act,
3 for the catch test before a hard action, doubled for a veteran, halved after a specific theft,
and a lone chance rounded up half the time; a nonzero `rand() % n` sends the spy to the nearest
own city (out of moves) and promotes it to veteran. A **diplomat** is always spent. The catch
test (0x00499548, used before a second theft from a city, sabotage of the Palace or City Walls,
and three or four times for a nuclear device) is the same roll with `n = 3`: a diplomat always
fails it.

## Missions

- **Embassy:** sets the embassy treaty bit; a spy survives with one move spent.
- **Investigate:** opens the city record; a diplomat is spent, a spy keeps one move the first
  time (city flag bit 22 remembers).
- **Steal:** from a random start the first advance the victim knows and the thief does not, with
  possible prerequisites (INFERRED: the original keeps scanning under a condition not read).
  Nothing to steal spends a move point. A city already robbed (flag bit 3) needs the hard test.
  Diplomats defending the city catch the thief with 20 % each (a spy 40 %, a veteran spy 60 %).
  Then the advance is granted, the flag set, the agent resolved and an incident follows.
- **Sabotage:** a random improvement the city has (never the Palace or SDI Defense); with
  production in hand the production is wrecked instead one time in two (a spy one in three,
  less one for a veteran). A spy may name the target (the Palace and City Walls need the hard
  test). Incident.
- **Poison:** size −1 (a size-1 city loses its food); the spy escapes on a coin toss. Incident.
- **Nuclear device:** three hard tests (four with a Palace); the city is blasted (INFERRED: the
  engine halves the population and removes the units next to it); unless the planter is a
  Fundamentalist, one time in two (four for a veteran) everyone learns who did it: attitudes
  worsen by 100 and every civilization declares war.
- **Incite:** never against a Democracy, never the capital. Cost `size × (treasury + 1000) /
(distance from the capital + 3)` (Communism counts at most 10 squares, a Courthouse halves
  the distance), halved in disorder, halved when empty, halved for a city the inciter founded; a
  spy pays a sixth less (a third for a veteran). The computer needs twice the cost in hand and no
  treaty, else it steals instead. Paying it flips the city (0x00499758): every unit of the old
  owner in or next to it and not in another city changes sides, the radius is revealed, and the
  inciter's incident count rises by 2. A second form at twice the cost also marks a vendetta and
  the inciter as the city's founder. Incident.

## The incident (0x00498a90)

Without a treaty the victim's attitude toward the agent's owner worsens by 20. With one: a human
victim is asked for a pretext to declare war or end the alliance (INFERRED: the engine lets it
pass); a human agent against a computer victim brings a vendetta and −10 under Fundamentalism,
else war, or against an ally a grudge of `rand() % 15 + 5` when the thief trails in advances
and the alliance broken with war otherwise; a human Republic (half the time) or Democracy then
suffers a Senate scandal and falls into anarchy.

## Bribing a unit (0x0049c5c6)

The routine takes the unit and the civilization buying it, so no Diplomat need be present: the
computer's move chooser calls it directly (ai-units.md). Only a lone unit; a human can never buy a
Democracy's, a computer can; computer bribers need the Diplomat's prerequisite advance and never
bribe caravans. Cost `unit cost rows × (owner's treasury + 750) /
(distance from the owner's capital + 2)` (Communism counts at most 10), halved for anything but
settlers; the computer pays only from half its treasury. The unit changes sides with no moves
left, homed to the city it stands in when the briber owns it; the victim's incident count rises.
A human spy may instead blow up the unit: half its hit points, the spy resolved as after an act.

## The computer's choice (VERIFIED order)

Steal by default; poison one time in three with a vendetta and a spy; steal under peace; incite
at King and above (or Prince once the victim has caused more than five incidents) when at war or
under a vendetta and the victim is no Democracy; steal under an alliance; sabotage a city already
robbed when a diplomat, or an embassy when a treaty exists. The diplomat's target city follows
ai-units.md "Diplomats"; the engine's version halves treaty partners instead of the long
fair-target list (INFERRED).
