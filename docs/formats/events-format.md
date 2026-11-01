# Scenario events (`events.txt`)

The original keeps a scenario's events as text: an `EVENTS.TXT` in the scenario's folder,
read when the scenario loads (the loader 0x0045bb69 looks for the file, allocates a 50,000-byte
pool and runs the parser 0x004c42e6 on the `@BEGINEVENTS` section; a rejected file shows
BADEVENTSFILE and the scenario plays without events). No shipped scenario file carries a
compiled copy; a save made inside such a scenario holds one in its `EVNT` block, which the
parser's record layout below describes and which `@mudbrick/formats` does not read yet — the
engine takes the text. Everything here is VERIFIED against the parser unless marked.

## Reading the text

The file is read line by line; a line is trimmed of trailing whitespace, blank lines and `;`
comments are passed over wherever a keyword or field is being looked for (inside TEXT they are
kept). Keywords compare case-insensitively against the whole line; a field is a line that
begins with its name and `=` (compared over that length), the rest of the line being the value.
`@IF` allocates a new event record at once, `@THEN` ends the trigger, `@ENDIF` ends the event;
`@BEGINEVENTS` and `@ENDEVENTS` bracket the list; `@DEBUG` turns the parser's logging on. While a
trigger or action is still missing a field, a line starting with `@` is an "illegal statement"
and the whole file is rejected; so is an end of file. A name that does not resolve is logged
and skipped, leaving its field unsatisfied.

Tribes (0x004c2020): `ANYBODY` (−2), `TRIGGERATTACKER` (−3), `TRIGGERDEFENDER` and
`TRIGGERRECEIVER` (both −4), else a slot 0–7 whose civilization name matches
(case-insensitively; slot 0 is the barbarians). Units (0x004c2129): `ANYUNIT` (−2) or a RULES
@UNITS name. Numbers are read by `atoi` from the start of the value; `turn=` and `interval=`
also accept a leading `+` or `−`.

## Triggers (one per event; the record's type word)

| keyword              | type  | fields                                                                                                      |
| -------------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| `UNITKILLED`         | 1     | `unit=` (a type; ANYUNIT is refused here), `attacker=`, `defender=`                                         |
| `CITYTAKEN`          | 2     | `city=` (the name, matched case-insensitively at run time), `attacker=`, `defender=`                        |
| `TURN`               | 4     | `turn=` a number or `EVERY` (−1)                                                                            |
| `TURNINTERVAL`       | 8     | `interval=`                                                                                                 |
| `NEGOTIATION`        | 0x10  | `talker=`, `talkertype=`, `listener=`, `listenertype=` — types `HUMAN` 1, `COMPUTER` 2, `HUMANORCOMPUTER` 4 |
| `SCENARIOLOADED`     | 0x20  | none                                                                                                        |
| `RANDOMTURN`         | 0x40  | `denominator=` 1 … 1000 (outside that the file is rejected)                                                 |
| `NOSCHISM`           | 0x80  | `defender=`                                                                                                 |
| `RECEIVEDTECHNOLOGY` | 0x100 | `receiver=`, `technology=` (an advance index)                                                               |

## Actions (any number per event; bits in the record's flag word)

| keyword                | bit   | fields                                                                                                                                                                      |
| ---------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEXT`                 | 0x1   | the following lines up to `ENDTEXT`, at most twenty kept                                                                                                                    |
| `MOVEUNIT`             | 0x2   | `unit=`, `owner=`, `maprect` then eight numbers (four corners: upper-left, upper-right, lower-right, lower-left), `moveto` then two, `numbertomove=` a number or `ALL` (−2) |
| `CREATEUNIT`           | 0x4   | `unit=`, `owner=`, `veteran=` yes/true/no/false, `homecity=`, `locations` then up to ten `x,y` lines ending at `endlocations`                                               |
| `CHANGEMONEY`          | 0x8   | `receiver=`, `amount=`                                                                                                                                                      |
| `PLAYWAVEFILE`         | 0x10  | the next line, a file name                                                                                                                                                  |
| `MAKEAGGRESSION`       | 0x20  | `who=`, `whom=`                                                                                                                                                             |
| `JUSTONCE`             | 0x40  | none                                                                                                                                                                        |
| `PLAYCDTRACK`          | 0x80  | the next line, a track number (kept when above 0)                                                                                                                           |
| `DONTPLAYWONDERS`      | 0x100 | none                                                                                                                                                                        |
| `CHANGETERRAIN`        | 0x200 | `terraintype=` (the range test `(−1 < t) ‖ (t < 11)` is always true), `maprect` then eight numbers                                                                          |
| `DESTROYACIVILIZATION` | 0x400 | `whom=`                                                                                                                                                                     |
| `GIVETECHNOLOGY`       | 0x800 | `receiver=`, `technology=`                                                                                                                                                  |

Bit 0x2000 of the same word marks a JUSTONCE event that has fired.

## The record (0x1c4 bytes, 32-bit fields; `EVNT` holds these in order)

`[0]` trigger type · `[1]` action bits · `[2]`/`[3]` UNITKILLED unit name pointer and type ·
`[4]` CITYTAKEN city name · `[5]`/`[6]` attacker (or talker) name and slot · `[7]` talker type ·
`[8]`/`[9]` defender (listener, receiver) name and slot · `[10]` listener type · `[11]` turn or
interval · `[12]` denominator · `[13]` technology · `[14]`–`[33]` TEXT lines · `[34]`/`[35]`
MOVEUNIT owner · `[36]`/`[37]` unit · `[38]` number to move · `[39]`–`[46]` rectangle · `[47]`/`[48]`
move-to · `[49]`/`[50]` MAKEAGGRESSION whom · `[51]`/`[52]` who · `[53]`/`[54]` CREATEUNIT owner ·
`[55]`/`[56]` unit · `[57]`–`[76]` locations · `[77]` their count · `[78]` veteran · `[79]` home city
name · `[93]`/`[94]` CHANGEMONEY receiver · `[95]` amount · `[96]` 0x1000 for NEGOTIATION (the
"block the talk" mark) · `[97]` wave file name · `[98]` CD track · `[99]` CHANGETERRAIN terrain ·
`[100]`–`[107]` rectangle · `[108]` DESTROYACIVILIZATION whom · `[109]`/`[110]` GIVETECHNOLOGY
technology and receiver · `[111]`/`[112]` next and previous record. Name pointers point into the
pool, so the saved copy needs the pool's strings to mean anything — INFERRED, not yet read.

`packages/formats/src/events.ts` (`parseEvents`) reads the text; the runtime is described in
docs/engine/events.md.
