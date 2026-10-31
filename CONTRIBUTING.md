# Contributing

Thank you for helping. This page is short on purpose; please read all of it.

## The clean-room rule (non-negotiable)

1. **Never copy code from the original game**, whether decompiled, disassembled, or
   "translated" into another language. Read it if you must, understand it, close it, and
   write your own. If a function in this repo was written while looking at a decompiler, it
   does not get merged.
2. **Never commit original game files**: no executables, DLLs, GIFs, WAVs, saves, scenarios,
   maps, or text files, and no byte-for-byte extracts of them (sprites, palettes, strings).
   `.gitignore` blocks the common extensions, but the rule is about intent, not extensions.
3. **Describe behaviour, don't transcribe it.** Findings from the executable go into
   `docs/engine/` as prose, tables and formulas ("city growth needs (rows × (size+1)) food,
   rows from cosmic constant 3"). The code is then written from the document.
4. **Keep the original trademarks out of names.** _Civilization_, _Civ_, _Sid Meier's_,
   _MicroProse_ and the game's coined feature names belong to their owners. They may appear
   in plain text to identify the product we are compatible with, never in identifiers, file
   names, package names, UI labels, logos or release names. See [LEGAL.md](LEGAL.md).

If you are unsure whether something crosses a line, open an issue before writing code.

## VERIFIED or INFERRED

Every factual claim in `docs/` carries one of two labels:

- **VERIFIED**: you checked it against the real files, the running original game, or a test
  in this repository that fails if it is wrong.
- **INFERRED**: you believe it (from community knowledge, another project, or reasoning) but
  have not checked it.

Upgrading INFERRED claims to VERIFIED is some of the most valuable work there is. Marking a
guess as VERIFIED is the fastest way to waste someone else's week.

## Tests

- Unit tests use inline fixtures and always run.
- Conformance tests read the original files from `ORIGINAL_GAME_DIR` and are skipped when it is
  unset. CI does not have the files, so unit coverage must stand on its own.
- A format parser is done when it parses every shipped instance of that file type (all 42
  saves/scenarios, all 11 maps, …) and the test says so.

## Code

- TypeScript strict mode, `noUncheckedIndexedAccess` on. If the compiler complains, the
  code is unclear, not the compiler.
- `packages/engine` and `packages/formats` import nothing from the DOM or Node. Put platform
  code in `apps/` or `scripts/`.
- Row order in the original tables is identity (units, advances, terrain are addressed by
  index). Parsers never reorder; the engine never renumbers.
- Randomness only through `Rng`; its state is part of the game state.
- Every source file starts with a comment saying what it is for and which spec it implements.
- Prefer a small named function over a comment explaining a block.
- `npm run check` must pass before you open a pull request.

## Commits and pull requests

- One topic per pull request. Format changes and engine changes do not mix.
- Reference the spec section you implemented or changed, and update the spec in the same PR.
- Describe how you verified it (which original files, which test).

## Adding a new file format

1. Write or update `docs/formats/<name>.md` first, with offsets, sizes and meanings, each
   labelled VERIFIED/INFERRED.
2. Implement `packages/formats/src/<name>.ts` with explicit types; no `any`.
3. Add an inline-fixture unit test and a conformance test over every shipped file.
4. Note anything the original tolerates that a strict parser would reject, and tolerate it
   the same way, with a warning.
