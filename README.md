# Mudbrick

A free, open-source, browser-based re-creation of a 1996 classic of turn-based strategy, written
from scratch in TypeScript. Mudbrick can load the data files of _Sid Meier's Civilization II_
(Multiplayer Gold Edition), a trademark of Take-Two Interactive, which is not affiliated with
this project. See [LEGAL.md](LEGAL.md) for the full picture.

**Status: early.** The data-file formats are being decoded and documented; the first playable
milestone is not here yet. What works today:

- Parsers for the original rules tables (`RULES.TXT`) and map files (`.MP`), with tests that
  run against the real files when you have them.
- A documented layout of every sprite in the original art sheets.
- A browser map viewer that renders the original world maps from your own copy of the game.
- A headless renderer that turns a map into a PNG from the command line.

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
npm run dev                 # browser map viewer; the terminal prints the local URL
npm test                    # unit tests (inline fixtures)
ORIGINAL_GAME_DIR=/path/to/your/copy npm test     # also the conformance tests over the real files
npm run check               # format + lint + typecheck + tests, exactly what CI runs
npm run render-map -- /path/to/WORLD.MP world.png # headless PNG of a map
```

Requires Node 20 or newer. `ORIGINAL_GAME_DIR` is the folder of your own installation that holds
`RULES.TXT`, the `*.MP` maps and the `*.GIF` sheets.

## Playing (alpha)

Load your game folder and a `.SAV`/`.SCN`, then press **Play** to take over the human
civilization. Click a unit to select it; the side panel lists the keys (arrows or the number pad
to move, `f` fortify, `s` sleep, `g` go to, `b` build or join a city, `r`/`i`/`m`/`o` for roads,
irrigation, mines and transforming, `F` fortress, `E` airbase, `p` clean pollution, `P` pillage,
`D` disband, `Tab` next unit, `Enter` end turn). Click a city for its yields, mood and production
menu; the research panel sets the research target.

Everything the player does runs through the engine's verified rules; the log says INFERRED where
a rule has not been read from the original yet. Computer players grow and build but do not move
units, there is no diplomacy, and games cannot be saved yet — see the roadmap.

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

`npm run dev` starts the viewer with hot reload. To avoid re-picking files after every reload,
create a symlink to your own copy of the game at `apps/web/dev-game` (it is gitignored):

```sh
ln -s /path/to/your/copy apps/web/dev-game
```

The dev build then shows a "Load dev-game folder" button and an input for a game file, and
`http://localhost:5173/?game=WWII.SCN` loads both straight away, which is handy for screenshots
and browser tests. None of this exists in the production build. `npm run play-smoke TUTORIAL.SAV out.png http://localhost:5173 5`
plays a few turns headless and fails on any browser error.

## License

MIT. See [LICENSE](LICENSE). The original game and its trademarks belong to their owners; see
[LEGAL.md](LEGAL.md).
