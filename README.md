# Epochs (working title)

A free, open-source, browser-based re-creation of the classic 1996 turn-based
civilization-building game, written in TypeScript from a clean-room specification.

**Status: early.** The data-file formats are being decoded and documented; the first
playable milestone is not here yet. What works today:

- Parsers for the original rules tables (`RULES.TXT`) and map files (`.MP`), with tests
  against the real files.
- A documented layout of every sprite in the original art sheets.
- A browser map viewer that renders the original world maps from your own copy of the game.

## Why

The original game is still loved and still unavailable for sale. Its owner has not re-released
it. We cannot and do not distribute it, but the _ideas_ in a game are not copyrightable, and
building a compatible engine from an independent specification is legal and well-trodden ground
(the same path as OpenRA, OpenMW and Freeciv). The goal is a version anyone can play with a
single link, on any device, that people can read, learn from and improve.

## Legal footing, in one paragraph

Copyright in the original game belongs to Take-Two Interactive and runs until 2091. This
project contains none of its code, art, sound or text. Players who own the original may point
the browser at their own game folder; the files are read locally and never uploaded. Everything
here is written from behaviour and format descriptions in [`docs/`](docs/README.md), never from
copied code. See [CONTRIBUTING.md](CONTRIBUTING.md) for the rules that keep it that way. The
working title is deliberately not the original trademark.

## Quick start

```sh
npm install
npm run dev          # browser map viewer at http://localhost:5173
npm test             # unit tests; conformance tests run only if CIV2_DIR is set
CIV2_DIR=/path/to/your/civ2 npm test
npm run check        # format + lint + typecheck + tests, what CI runs
```

Requires Node 20 or newer.

## Repository layout

| path               | what                                                                               |
| ------------------ | ---------------------------------------------------------------------------------- |
| `packages/formats` | Parsers for the original data files. Pure TypeScript, runs anywhere.               |
| `packages/engine`  | The simulation: rules, world, turns, AI. Deterministic, no UI, no platform APIs.   |
| `apps/web`         | The browser front end (Vite). Renders and takes input; contains no game rules.     |
| `docs/formats`     | File-format specifications, each derived from and verified against the real files. |
| `docs/engine`      | Behaviour notes recovered from the original executable, written as prose/formulas. |
| `docs/research`    | Inventory and hashes of the original edition the specifications were made from.    |

The engine/UI split is a hard rule: nothing in `packages/engine` may import from the DOM or
Node, so the same code runs in a browser tab, in a Web Worker, on a server for multiplayer and
inside tests.

## Documentation

Start at [`docs/README.md`](docs/README.md). Every statement in the specs is marked
**VERIFIED** (checked against the files or the running game) or **INFERRED** (believed, not yet
checked). Please keep that honesty when you add to them.

## Roadmap

1. Formats: rules, maps, sprite layout — done. Dialog text, labels, saves/scenarios — next.
2. World model and rendering: terrain, rivers, overlays, cities, units from original or free art.
3. Rules engine: movement, combat, cities, trade, research, government, diplomacy.
4. AI, then multiplayer, then a free replacement art set so no original files are needed.

## License

MIT. See [LICENSE](LICENSE).
