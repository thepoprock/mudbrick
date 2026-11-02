# Mudbrick

A free, open-source, browser-based re-creation of a 1996 classic of turn-based strategy, written
from scratch in TypeScript. Mudbrick can load the data files of _Sid Meier's Civilization II_
(Multiplayer Gold Edition), a trademark of Take-Two Interactive, which is not affiliated with
this project. See [LEGAL.md](LEGAL.md) for the full picture.

**Status: playable, alone, hot seat, by file or over a relay, with your own copy of the game's
data.** What works today:

- A full turn: cities, production, research, combat, terrain work, trade, diplomacy, espionage,
  barbarians, the computer players, spaceships, nuclear weapons and the end of the game.
- Negotiation with computer players, every advisor report, the High Council, the Civilopedia,
  the menus and the sound effects, all read from your own files.
- Saved games load and save in the original format.

- Hot seat, and network play through a small relay, with players moving in turn.

Not yet: the scenario editors.

Music plays from your own CD tracks (`track02.wav` and so on) in the game folder. Films need `scripts/convert-videos.ts`, because browsers cannot play the original format.

**The decode is not finished.** [docs/decoding.md](docs/decoding.md) says how far it has got and how
to help.

## Why

The original game is still loved and has never been re-released, so it cannot be bought today.
We cannot and do not distribute it. But the _ideas_ in a game are not copyrightable, and building
a compatible engine from an independent specification is lawful and well-trodden ground, the same
path as OpenRA, OpenMW and Freeciv. The goal is a version anyone can play with a single link, on
any device, that people can read, learn from and improve.

## The rules we follow

- **Clean room.** Nothing here is copied or translated from the original program. Behaviour is
  written down as facts and formulas in [`docs/`](docs/README.md), then implemented from the
  document.
- **No original files.** Players point the browser at their own copy; files are read locally and
  never uploaded. The repository contains no art, sound, text or code from the game.
- **Trademarks stay in plain text.** The original names appear only to say what Mudbrick is
  compatible with, never in names, logos or packages.

Details and the reasoning: [LEGAL.md](LEGAL.md). How to contribute without breaking them:
[CONTRIBUTING.md](CONTRIBUTING.md).

## Quick start

```sh
npm install
npm run dev                 # the game; the terminal prints the local URL
npm test                    # unit tests (inline fixtures)
ORIGINAL_GAME_DIR=/path/to/your/copy npm test     # also the conformance tests over the real files
npm run check               # format + lint + typecheck + tests, exactly what CI runs
npm run render-map -- /path/to/WORLD.MP world.png # headless PNG of a map
```

Requires Node 20 or newer. `ORIGINAL_GAME_DIR` is the folder of your own installation that holds
`RULES.TXT`, the `*.MP` maps and the `*.GIF` sheets.

## Playing

The Pages workflow (`.github/workflows/pages.yml`, run by hand once GitHub Pages is enabled for the
repository) publishes the app at https://thepoprock.github.io/mudbrick/; it ships no game data. On
the title screen, choose the folder of your own installed copy (Chrome and Edge remember it for
next time), then start a new game, start on a premade world, or load a saved game or scenario.

The screen is the familiar one: the menu bar from your copy's Menu.txt, the map, and on the right
the world map, the status box and a log. Click a unit to select it and a city to open it. The keys
are the menus' own: arrows or the number pad move, `b` build city, `f` fortify (fortress for
Settlers), `s` sleep, `g` go to, `r` `i` `m` `o` road, irrigation, mine, transform, `e` airbase,
`p` clean pollution, `h` home city, `Shift+T` tax rate, `Shift+R` revolution, `F1` to `F12` the
advisors, `?` the Civilopedia, `v` view pieces, `z` and `x` zoom, right click to centre. `Enter`
opens the city a unit stands in, and ends the turn once nothing is waiting; `Ctrl+N` always ends it.
Click the status box's gold line for the tax rates and its research line for research.

`Ctrl+S` writes a `.SAV` in the original format when one was loaded, else Mudbrick's own
`.mudbrick.json`, which Load Game reads back. Everything the player does runs through the engine.

## Repository layout

| path               | what                                                                               |
| ------------------ | ---------------------------------------------------------------------------------- |
| `packages/formats` | Parsers for the original data files. Pure TypeScript, no DOM, no Node APIs.        |
| `packages/engine`  | The simulation: rules, world, turns, AI. Deterministic, no UI, no platform APIs.   |
| `apps/web`         | The browser front end (Vite). Renders and takes input; contains no game rules.     |
| `scripts`          | Command-line tools for contributors (map renderer).                                |
| `docs/formats`     | File-format specifications, each derived from and verified against the real files. |
| `docs/engine`      | Behaviour notes recovered from the original executable, written as prose/formulas. |
| `docs/research`    | Inventory and hashes of the original edition the specifications were made from.    |

The engine/UI split is a hard rule: nothing in `packages/engine` or `packages/formats` may import
from the DOM or Node, so the same code runs in a browser tab, in a Web Worker, on a server for
multiplayer, and inside tests.

## Documentation

Start at [`docs/README.md`](docs/README.md). Every statement in the specs is marked
**VERIFIED** (checked against the files or the running game) or **INFERRED** (believed, not yet
checked). Please keep that honesty when you add to them.

## Roadmap

1. Formats: rules, maps, sprite layout — done. Dialog text, labels, saves and scenarios — next.
2. World model and rendering: terrain, rivers, overlays, cities, units, from original or free art.
3. Rules engine: movement, combat, cities, trade, research, government, diplomacy.
4. AI, then multiplayer, then a free replacement art set so no original files are needed.

## Developing

`npm run dev` starts the game with hot reload. To avoid picking the folder at all, create a symlink to your own copy of the game at `apps/web/dev-game` (it is gitignored):

```sh
ln -s /path/to/your/copy apps/web/dev-game
```

The dev build reads that folder on start, and `http://localhost:5173/?game=WWII.SCN` opens a game
straight away, which is handy for screenshots and browser tests. None of this exists in the production build. `npm run play-smoke TUTORIAL.SAV out.png http://localhost:5173 5`
plays a few turns headless and fails on any browser error; `npm run save-roundtrip apps/web/dev-game TUTORIAL.SAV 12`
plays turns with the engine alone, writes the game back as a save and re-parses it.

## License

MIT. See [LICENSE](LICENSE). The original game and its trademarks belong to their owners; see
[LEGAL.md](LEGAL.md).
