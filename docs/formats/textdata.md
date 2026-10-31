# Text data files — formats (original game, Multiplayer Gold Edition, English)

All text files are CP1252 (Windows-1252) with CRLF line endings. `;` begins a comment line. A line beginning `@NAME` opens a section; sections run to the next `@`-line. Counts below are VERIFIED against the shipped files.

## Family 1 — "popup" files: Game.txt (802 sections), PEDIA.TXT (87), HELP.TXT (36), TUTORIAL.TXT (31), ADVICE.TXT (5), DEBUG.TXT, HERALD.TXT, scenario *.TXT

Each section describes one dialog box. Directives (all start with `@` inside the section, VERIFIED census from Game.txt):

| directive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | count | meaning                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------ |
| `@title=…`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 649   | dialog title                                           |
| `@width=N`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 587   | dialog width in pixels                                 |
| `@options`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 71    | following lines are a radio/option list (one per line) |
| `@button=…`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 37    | adds a button with this label (repeatable)             |
| `@listbox` / `@listbox=N`                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 23    | following lines fill a list box; N = visible rows      |
| `@checkbox`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 8     | options become check boxes                             |
| `@default=N`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 8     | pre-selected option                                    |
| `@columns=N`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | —     | multi-column list (seen in PEDIA.TXT)                  |
| `@x=` `@y=`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —     | fixed position (DEBUG.TXT)                             |
| Body text: plain lines are the dialog message. `^` at line start = indent/bullet continuation (23×); `^^` = centred line (198×). `_` (30×) is a spacing/underscore marker inside option labels — exact rendering INFERRED, to be confirmed in the exe. Substitution tokens filled by the engine at runtime: `%STRING0`–`%STRING6` (text), `%NUMBER0`–`%NUMBER5` (integers); `{%NUMBER0$}` wraps a number as money (DEBUG.TXT @MONEY). The engine looks sections up by name, so section order is free. |

## Family 2 — Labels.txt (indexed string table)

- `@STRINGHEAP` then one integer: heap size (50000).
- `@POPUPS`: 4 lines — the standard button labels OK / Help / Cancel / Custom.
- `@LABELS`: first line is the declared count (**873**), followed by the strings; the engine addresses them by zero-based index. Shipped file has 874 non-blank lines after the count line (one more than declared — the tail line is INFERRED to be ignored or a terminator; check in exe).

## Family 3 — RULES.TXT → see rules-format.md. LEADERS.TXT = a copy of the @LEADERS table rows alone (no header), 21 rows.

## Family 4 — CITY.TXT (city-name lists)

50 sections, one per civilization plural (`@ROMANS`, `@BABYLONIANS`, …) plus extras; one city name per line, max 15 characters (stated in the file header). Indexed by the civ's plural name from RULES.TXT @LEADERS (INFERRED: lookup is by name since the section is named).

## Family 5 — Describe.txt (in-game encyclopedia long descriptions, 213 KB, 7 top-level sections)

Per category (@ADVANCE_DESCRIPTIONS, improvements, wonders, units, concepts…): an `@@<CAT>_INDEX` list mapping rules-order → description-order, one integer per line terminated with a comma, `-1` = no description, list terminates with `-2`; then the descriptions themselves, each beginning with `@@`. The index exists because the descriptions are in alphabetical order while RULES.TXT is not. Multi-line prose, `^` indentation as in Family 1.

## Family 6 — menus: Menu.txt (9 sections: GAME KINGDOM VIEW ORDERS ADVISORS WORLD CHEAT EDITOR PEDIA) and MAPMENU.TXT (5: EDITOR VIEW MAP BRUSH TOOLS)

One menu item per line under each `@MENU` section; hotkeys and separators are encoded inline (exact syntax to document when read fully).

## Family 7 — misc

MISC.TXT (504 lines, no `@` sections — plain blocks), CREDITS.TXT / fcredits / mpcredits / SCREDITS.TXT (plain), CIV2FAQ.TXT, CIV2FANW.TXT (fan-written docs), COUNCIL0–2.TXT (High Council advisor lines per era, popup family), PATCH.TXT (patch history 1.04 → 1.11, see disc-README.txt for MGE-specific notes), SC.TXT (credits roll).

## What is NOT in text

Combat resolution, movement, city growth, trade-route math, AI, diplomacy, map generation, and all the UI drawing are in civ2.exe. The text files only hold data tables and strings. Those behaviours are Phase 5 (Ghidra).
