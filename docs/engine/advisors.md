# Advisors, the High Council and the Civilopedia

`packages/engine/src/reports.ts` and `council.ts`. The report routines (0x00420e90 to 0x00426090)
mostly draw, so only what they compute is specified. VERIFIED from the routines named.

## Reports

| Key | Report               | Source                                         |
| --- | -------------------- | ---------------------------------------------- |
| F1  | City Status          | the city records                               |
| F2  | Defense Minister     | units by type, active and in production        |
| F3  | Foreign Minister     | 0x0042351e, with the emissary (negotiation.md) |
| F4  | Attitude Advisor     | the city records                               |
| F5  | Trade Advisor        | tax and upkeep                                 |
| F6  | Science Advisor      | the research figures                           |
| F7  | Wonders of the World |                                                |
| F8  | Top Five Cities      | 0x00425878                                     |
| F9  | Civilization Score   | score.ts                                       |
| F10 | High Council         | below                                          |
| F11 | Demographics         | 0x00426090                                     |
| F12 | Spaceships           |                                                |

Top Five: `size + happy − unhappy`, +10 per wonder in the city, keeping five, earlier city first
on a tie.

Population (0x0042bcce, 0x0042bd35): a city counts `1 + 2 + … + size`, at least 1, and a
civilization's sum is clamped to 1 to 32000.

Demographics, per civilization, with P = 1 + total city sizes. Each line is ranked among those in
play by how many beat it.

| Line               | Formula                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approval           | `Σ(size + happy − unhappy) × 50 / P`                                                                                                                           |
| GNP                | `Σ(luxuries × 2 + tax)`                                                                                                                                        |
| Manufactured goods | `Σ shields`                                                                                                                                                    |
| Land area          | squares owned (map byte 5 high nibble)                                                                                                                         |
| Literacy           | `(P × 2 + Σ size with Library + Σ size with University) × 2 / P`, doubled by each of advances 1, 88, 43, 85, capped at 100                                     |
| Disease            | `P × 50 / (D + P)`, D being Σ size for Granary or Pyramids, for Aqueduct and for Sewer System; halved by advance 50 and by Cure for Cancer. Lower ranks better |
| Pollution          | `Σ positive (shields / divisor − 20 + size × tech / 4)`. Lower ranks better                                                                                    |
| Life expectancy    | `1800 / (disease + 20) − pollution × 10 / P`, clamped to 20 to 99                                                                                              |
| Family size        | `Σ(food − size × 2) × 40 / P + 20`, in tenths                                                                                                                  |
| Military service   | `combat units × 10 / P`                                                                                                                                        |
| Annual income      | `advances × GNP / P`                                                                                                                                           |
| Productivity       | `Σ(shields + route trade + food) × 10 / P`                                                                                                                     |

## Historians (0x0042526d, from the turn driver 0x00467591)

When the turn passes the date at file offset 0x142, the next date becomes `turn + 20 + rand % 40`.
A random historian ranks the civilizations by one of five: treasury, power, advances known,
`Σ(size + happy − unhappy)` or `Σ size`.

## The High Council (0x004d8480)

Era (0x00519291): modern with advances 5 and 24, middle with 60 and 38, else ancient; it selects
COUNCIL0–2.TXT. Under Anarchy the council does not meet. Each advisor rates 1 to 7 and speaks
section `M3`, `S5` and so on.

- **Military** (0x00490e40): 1 too few units, `(cities − 1 + units) / cities` under 2, or 3 below
  the Republic. 2 behind over half the others in land types, 3 in sea types. 5 no walls in the
  capital when Masonry is known and the Great Wall is absent. 4 no Barracks anywhere. 7 at peace
  with everyone at rank over 4, otherwise 6.
- **Science** (0x0049126a): 7 first in advances. 2 science rate under 6 (under 4 for a Republic or
  Democracy; never under Fundamentalism). 3 under half the cities have the era's building, when
  available. 4 trade known and routes under a quarter of the cities. 5 ahead of half the others,
  else 1.
- **Trade** (0x0049155b): 1 losing money under 100 gold. 2 lacks the era's advance. 3 under the
  era's share of cities has its building. 4 no Trade. 5 too few routes. 6 net under 6, else 7.
- **Foreign** (0x0049198f): 1 nobody met. 3 lacks Writing, or Espionage in the modern era. 2 no
  ally ever. 4 bad reputation. 6 never traded knowledge. 5 no embassies. 7 otherwise.
- **Attitude** (0x00491c63): counts cities with more unhappy than happy, those rioting, balanced
  ones and celebrating ones, and asks whether luxuries are in use. 1 rioting under Democracy with
  luxuries on, 2 unhappy with none, 3 unhappy, 4 calm with no luxuries, 5 calm, 6 celebrating.

The council text (0x004d98b3) is one line per speech, with `start, end` frame numbers for the
videos, which are not used. The rated advisor speaks the first line. Coded lines add up to two
others, each advisor once: `t` any rating, `t3` only at 3. `r5` keeps the rest of its line at
(10 − 5) / 10. `#` runs the rest of its line only when the last line answered. `end` stops.

The council is offered every 50 turns (0x0046ac42) when its option is on. This offer is not
ported; F10 opens it at any time.

## The Civilopedia

Describe.txt supplies the text and RULES.TXT the facts: cost, upkeep, prerequisites, what an
advance leads to and allows. `?` opens it. Terrain and concepts are not offered yet.

## Sound

`packages/engine/src/sounds.ts`. The name table at 0x005b5228 holds 133 entries of 9 bytes;
0x00452e10 plays `SOUND/NAME.WAV`, and CHEERS picks one of three. The attack routine 0x0052d472
chooses by unit slot and domain, and production 0x004b7e74 by improvement. `M` mutes. Music
(the Pick Music menu and CD tracks) is not ported.

## City View (0x0043e690)

`apps/web/src/cityView.ts`. Pictures come from cv.dll at run time. The site is coast, river or
inland (0x0043f3b3), and the background is picture `340 + site × 5 + era`, or era 3 with
Superhighways. Improvements 1 to 34 take places in random order from a 31-entry list per site, a
few at fixed places (walls and others). Unbuilt ones leave a house. Wonders do the same from a
24-entry list. The generator is the program's (seed × 0x19660d + 0x3c6ef35f), seeded with
`x × 256 + y + map seed`, so a city's layout never changes. Places are drawn in order, back to front.

## Throne Room (0x004389e0)

A human with a Palace earns a piece when the score reaches `Σ (7 − difficulty) × n / 2 + 1` for
piece n (0x00467035, 0x0046708f), up to 38. The player raises one of eight parts, each with four
levels; a new civilization starts with parts 0, 1, 3 and 6 at level 1. The room is picture 100 of pv.dll with picture `105 + part × 5 + level − 1` on top, cut by
the table at 0x005a9068. Once all eight stand at level 4 the awards are seven extra pieces instead (a bit each at record
X + 25, pictures 160 to 166, table 0x005a9268). The room is drawn back to front in the order of
0x004398f2, with the extras between the parts. Whether more is due checks only parts 0 to 6 and the
extras (0x004389e0).

## Spaceship picture (0x004a224f)

The screen builds an 88-row table (`apps/web/src/shipParts.ts`). Over the starfield (ss.dll 499) it
draws rows 0 to 6, then the frame for the structurals built (pictures 400 to 440, cropped to the
row's rectangle), then rows 31 to 87. A part row appears once its kind's count reaches the row's
count, from the kind's lit sheet if the structure supports that many (0x0053ddd8), else from its
dim sheet.

## Negotiation backdrop (0x00471959, 0x00472c45)

The negotiation window is the picture `200 + the other civilization's government` of mk.dll with the
leader's portrait (`220 + portrait`) on it.

## Event engravings (0x004b7280)

City captured (CITYCAPTURE, CITYCAPTURE2, CITYWINALLY, CITYLOSEALLY) shows tiles.dll 70, disorder
72, We Love the King Day 74 and a founding 76, each one higher once the player knows advance 37.
