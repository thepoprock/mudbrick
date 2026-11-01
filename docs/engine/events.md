# Scenario events at run time

VERIFIED against the evaluators 0x004c37dc (TURN), 0x004c386c (TURNINTERVAL), 0x004c38ff
(RANDOMTURN), 0x004c39ad (RECEIVEDTECHNOLOGY), 0x004c3afb (SCENARIOLOADED), 0x004c3b6d
(UNITKILLED), 0x004c3fdd (NOSCHISM), 0x004c408b (CITYTAKEN), 0x004c3c54 (NEGOTIATION), the
dispatcher 0x004c417e and the action routines; `packages/engine/src/events.ts`
(`ScenarioEvents`). The parsed events are plain data in the game state; their mutable part — what
has fired, and the slot a trigger wrote over an ANYBODY — is the `EventState` beside them.

## When triggers are asked

- At the commencement of a turn: TURN (`every` or the turn), TURNINTERVAL (interval 0, or the
  turn a multiple of it), RANDOMTURN (one chance in the denominator: `rand() % d + 1 == d`; a
  denominator below 2 always), RECEIVEDTECHNOLOGY (the receiver, or with ANYBODY every slot in
  play, that knows the advance — the receiver is written over, and the event fires again every
  turn unless JUSTONCE). The order among the four is INFERRED.
- SCENARIOLOADED: right after the file is read — in the original only when the music option is
  on, the trigger being meant for PLAYCDTRACK; the engine runs it at load.
- UNITKILLED when a unit falls to an attacker (the attack routines' hook): the unit type must
  match; attacker and defender match their slots or ANYBODY — and an ANYBODY is **written over
  with the slot that matched**, so the event is thereafter bound to it.
- CITYTAKEN when a city changes hands (the capture routine's hook): the name
  case-insensitively, then as above.
- NOSCHISM when a capital falls (the engine does not split civilizations, so only the actions
  matter): events naming the defender or ANYBODY run.
- NEGOTIATION: may a talker approach a listener? An event matching talker and listener (slot
  or ANYBODY, each of the right human/computer type) runs its actions and blocks the talk; the
  engine asks before a computer player's review of a pair (INFERRED placement).

## What actions do

The dispatcher skips a JUSTONCE event that has fired, then runs in this order: PLAYWAVEFILE
(an effect for the UI), PLAYCDTRACK (track 2 and up), CREATEUNIT, MOVEUNIT, CHANGETERRAIN,
MAKEAGGRESSION, CHANGEMONEY, DESTROYACIVILIZATION, GIVETECHNOLOGY, TEXT, DONTPLAYWONDERS, and
marks a JUSTONCE event fired. `TRIGGERATTACKER` and `TRIGGERDEFENDER` in an action read the
slots the trigger wrote.

- CREATEUNIT (0x004c2ca4): the owner must be in play; the locations are tried in order — a sea
  unit needs ocean or a coastal city, any other unit a land square (air units may stand on
  ocean) with no foreign city and no foreign unit; the first that fits gets the unit, veteran as
  asked, homed to the named city when it is the owner's.
- MOVEUNIT (0x004c306f): the owner must be in play and a computer player; its units of the type
  (or any) inside the rectangle that are not nuclear (attack 99) and not under a fortress, work
  or go-to order — fortified and sentried units do go, whatever the help says — get a go-to to
  the square, from the last unit down, up to the number (ALL = every one).
- CHANGETERRAIN (0x004c3382): every square from the first corner's column to the second's and
  from the first corner's row to the fourth's loses its city and units, takes the terrain with
  improvements, river and special cleared, is revealed to all; a civilization left without a
  city dies (and may restart).
- MAKEAGGRESSION (0x004c2976): both in play → `who` declares war on `whom`.
- CHANGEMONEY (0x004c2714): the receiver in play; the treasury moves by the amount and is kept
  within 0 … 30,000.
- DESTROYACIVILIZATION (0x004c2ad2): the civilization loses its cities and units and dies (a
  human: game over; a computer player may restart).
- GIVETECHNOLOGY (0x004c2bcb): the receiver in play learns the advance.
- TEXT: the lines, an effect for the UI. DONTPLAYWONDERS: wonder movies off (a flag).

The web app reads the EVENTS.TXT beside a picked .SCN/.SAV inside the game folder, with the
save's civilization names and the rules' unit names, and logs the effects.
