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

Stand-in: land area uses the map's territory byte, because the engine does not carry the high
nibble of byte 5.

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
