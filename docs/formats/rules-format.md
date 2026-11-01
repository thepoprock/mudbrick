# RULES.TXT — format specification (original game, Multiplayer Gold Edition, English)

Source of truth: the comment headers inside RULES.TXT itself plus parsing of the shipped file (`tools/parse_rules.py` → `docs/rules-data.json`). Everything below is VERIFIED against the shipped file unless marked INFERRED.

## Lexical rules

- `;` starts a comment to end of line. Blank lines ignored.
- `@NAME` on its own line starts a section. Twelve sections, in this order: COSMIC, CIVILIZE, IMPROVE, ENDWONDER, UNITS, TERRAIN, GOVERNMENTS, LEADERS, CARAVAN, ORDERS, DIFFICULTY, ATTITUDES.
- Data rows are comma-separated. Whitespace around fields is ignored. Trailing commas occur (IMPROVE, CARAVAN).
- Numeric fields may carry a unit-letter suffix that the game ignores: `1.` (move), `0a` `1d` (attack/defense), `2h` (hitpoints), `1f` (firepower). Parser strips them. VERIFIED in the executable: movement is stored multiplied by the road multiplier (thirds) and hit points multiplied by 10; the 20-byte unit record layout is in docs/engine/exe-notes.md.
- Advances are referenced by a fixed 3-letter abbreviation (`Alp`, `Bro`, `Rad`…), written in the `;` comment of the CIVILIZE row. Special tokens: `nil` = none/no prerequisite, `no` = disabled/never.
- Row ORDER is the identity: the executable addresses advances, improvements, units and terrain by index, not by name. Renaming is safe; reordering changes the game. (INFERRED from the fixed-slot comments; to be confirmed in the exe.)
- The file ships two typos where a comment line begins with `:` instead of `;`: `:               0 = Ground` (lands in @ENDWONDER's data) and `: Extra1.wav through extra8.wav for the 8 test units.` (lands in @UNITS). The game evidently tolerates them; parsers must skip rows that are not well-formed data, with a warning. VERIFIED.
- Custom sounds: CUSTOM1–3.WAV for the three extra units, EXTRA1–8.WAV for the eight test units (8-bit mono 22050 Hz), per the @UNITS comment block.

## @COSMIC — 22 engine constants, one integer per line (order is the identity). The executable clamps each value to a range and forces the food-box rows even; see docs/engine/exe-notes.md (VERIFIED by decompilation).

| #   | value | meaning (from the file's own comment)                                         |
| --- | ----- | ----------------------------------------------------------------------------- |
| 0   | 3     | Road movement multiplier                                                      |
| 1   | 2     | 1 in x chance Trireme lost (modified by Seafaring, Navigation)                |
| 2   | 2     | Food each citizen eats per turn                                               |
| 3   | 10    | Rows in food box (rows × (city_size+1) = box)                                 |
| 4   | 10    | Rows in shield box                                                            |
| 5   | 1     | Settlers food cost, govt ≤ Monarchy                                           |
| 6   | 2     | Settlers food cost, govt ≥ Communism                                          |
| 7   | 7     | City size for first unhappiness at Chieftain                                  |
| 8   | 14    | Riot factor based on # cities (higher lessens effect)                         |
| 9   | 8     | Aqueduct needed to exceed this size                                           |
| 10  | 12    | Sewer System needed to exceed this size                                       |
| 11  | 10    | Tech paradigm (higher slows research)                                         |
| 12  | 20    | Base time for engineers to transform terrain (×2)                             |
| 13  | 3     | Monarchy free unit support per city                                           |
| 14  | 3     | Communism free unit support per city                                          |
| 15  | 10    | Fundamentalism free unit support per city                                     |
| 16  | 0     | Communism is equivalent of this palace distance                               |
| 17  | 50    | Fundamentalism loses this % of science                                        |
| 18  | 50    | % shield penalty for production type change                                   |
| 19  | 10    | Max paradrop range                                                            |
| 20  | 75    | Mass/Thrust paradigm (increasing slows spaceship)                             |
| 21  | 5     | Max effective science rate in fundamentalism (×10 → 50%), added in patch 1.08 |

## @CIVILIZE — 100 rows: 89 real advances + 11 user slots (U1–U3, X1–X8)

`name, ai_value, civilized_mod, preq1, preq2, epoch, category ; abbrev`

- ai_value: base worth to AI (research choice, trades, gift value). civilized_mod: + favours civilized leaders, − militaristic.
- epoch: 0 Ancient · 1 Renaissance · 2 Industrial · 3 Modern. category: 0 Military · 1 Economic · 2 Social · 3 Academic · 4 Applied.
- User slots have `no, no` prerequisites = disabled.

## @IMPROVE — 67 rows: index 0–38 city improvements (0 = "Nothing", 1 = Palace … 38 = Capitalization), index 39–66 = the 28 Wonders (Pyramids … Cure for Cancer)

`name, cost (×10 shields), upkeep (gold/turn), preq`

## @ENDWONDER — 28 rows, same order as the wonders in IMPROVE

`expiry_advance ; wonder name` — `nil` = never expires.

## @UNITS — 62 rows: 51 standard units + 11 user slots (Extra Land/Ship/Air, Test Unit 1–8)

`name, until, domain, move, range, att, def, hit, firepwr, cost, hold, role, preq, flags`

- until: advance that obsoletes the unit (`nil` never). domain: 0 Ground · 1 Air · 2 Sea. move: squares/turn (road multiplier applies). range: turns of fuel, 0 for non-air.
- att/def: combat factors. hit: hit points in tens (2h = 20 HP). firepwr: damage per hit scored. cost: shield rows (×10). hold: transport capacity.
- role: 0 Attack · 1 Defend · 2 Naval Superiority · 3 Air Superiority · 4 Sea Transport · 5 Settle · 6 Diplomacy · 7 Trade. Roles ≥5 change abilities, not just AI use.
- flags: 15-char bitstring, rightmost = bit 0:
  bit0 two-square visibility · bit1 ignore ZOC · bit2 amphibious assault · bit3 submarine · bit4 can attack air (fighter) · bit5 must stay near land (trireme) · bit6 negates city walls (howitzer) · bit7 carries air units (carrier) · bit8 paradrop · bit9 alpine (all squares as road) · bit10 ×2 defence vs horse (pikemen) · bit11 free support under Fundamentalism (fanatics) · bit12 destroyed after attacking (missiles) · bit13 ×2 defence vs air (AEGIS) · bit14 spots submarines.
- Custom unit sounds: CUSTOM1–3.WAV, 8-bit mono 22050 Hz.

## @TERRAIN — 11 base rows, then 22 special-resource rows: the FIRST special of every terrain in base order (rows 12–22), then the SECOND special of every terrain (rows 23–33). Not interleaved pairs — VERIFIED (an interleaved reading gives Ocean "Fruit/Whales")

Base: `name, movecost, defense, food, shields, trade, irrigate, irr_bonus, irr_turns, irr_ai_govt, mine, mine_bonus, mine_turns, mine_ai_govt, transform_to ; abbrev`

- defense ×50% = defence multiplier (3 → 150%). irrigate/mine: `yes`, `no`, or the terrain abbreviation it converts to. ai_govt: minimum government (0 never … 6 Democracy) before the AI bothers.
- Base order: Desert, Plains, Grassland, Forest, Hills, Mountains, Tundra, Glacier, Swamp, Jungle, Ocean.
  Specials: `name, movecost, defense, food, shields, trade`. First-special list: Oasis, Buffalo, Grassland (shield), Pheasant, Coal, Gold, Game, Ivory, Peat, Gems, Fish. Second-special list: Desert Oil, Wheat, Grassland (shield), Silk, Wine, Iron, Furs, Glacier Oil, Spice, Fruit, Whales. So Desert→Oasis/Desert Oil … Jungle→Gems/Fruit, Ocean→Fish/Whales. The first list is drawn at TERRAIN1.GIF column x=131, the second at x=196 (see assets.md). VERIFIED against the shipped file and the known game.

## @GOVERNMENTS — 7 rows, index = government id: Anarchy 0, Despotism 1, Monarchy 2, Communism 3, Fundamentalism 4, Republic 5, Democracy 6

`name, male_title, female_title`

## @LEADERS — 21 civilizations (+2 malformed example rows "Saladin/Arabs", "Atawallpa/Incas" with a missing field; the game cannot be using them as written — INFERRED)

`leader, female_leader, female(0/1), color(1–7), style(0–3), plural, adjective, attack(±1), expand(±1), civilize(±1), [govt, male_title, female_title]…`

- color: one of 7 colour sets; 3 civs share each colour and are mutually exclusive in a game. style: 0 Bronze Age · 1 Classical · 2 Far East · 3 Medieval (city graphics row). Personality axes: attack 1 aggressive / −1 rational; expand 1 expansionist / −1 perfectionist; civilize 1 civilized / −1 militaristic.
- Optional repeating triples override the ruler title under a given government id.

## @CARAVAN — 16 trade commodities, index = commodity id. @ORDERS — 11 unit orders with hotkey. @DIFFICULTY — 6 levels (Chieftain…Deity). @ATTITUDES — 9 diplomatic attitudes (Worshipful…Enraged).

## How tolerant the original's loader is (VERIFIED)

- **Where the file comes from** (0x00415127, and 0x00438216 for the sheets): with a scenario
  open, RULES.TXT and each GIF sheet are read from the scenario's folder when it has them, else
  from the game folder. The web app does the same once a scenario file is opened.
- **Numbers** (0x0047c824 → an `atoi`): a field that does not start with an integer reads as 0.
  `parseRules` does the same and records a warning.
- **Prerequisite codes** (0x00487c00): `no` → −2 (cannot be acquired), `nil` → −1 (none), a
  code matching an advance's abbreviation → its index, anything else → −3 with a message — a
  prerequisite nothing can satisfy, which `parseRules` records as `never` with a warning.
- **@COSMIC** (0x00410603): exactly 22 lines are read and each is clamped — road multiplier
  1–10, trireme loss 1–100, food per citizen 0–10, food box rows 4–20 (made even), shield box
  rows 4–20, settlers' food 0–10 twice, unhappiness size 4–12, riot factor 10–100, Aqueduct and
  Sewer sizes 4–50, tech paradigm 3–10, transform base 5–100, free support 0–8 three times,
  base turns 1–20, Communism palace distance 0–100, Fundamentalism penalty 0–100 and maximum
  rate 4–100, mass/thrust 25–200, the last 0–10. A short list reads what follows (0 here).
- **@CIVILIZE** (0x00410929): up to 100 rows until a blank or `;` line; the rest are named
  "Advance n" with values 3/0 and prerequisites `no`.
