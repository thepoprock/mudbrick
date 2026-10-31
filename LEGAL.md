# Legal notes

This page explains what Mudbrick is, what it is not, and the rules the project follows so that
it stays on the right side of copyright and trademark law. It is written for players and
contributors, not lawyers, and it is not legal advice.

## What Mudbrick is

Mudbrick is an independent, open-source game engine and browser front end, written from scratch
in TypeScript and released under the MIT license. It is designed to be **compatible with the data
files** of a 1996 turn-based strategy game, _Sid Meier's Civilization II_ (Multiplayer Gold
Edition, 1998), so that people who own that game can play it in a modern browser, and so that a
free replacement art set can eventually make the original files unnecessary.

## What Mudbrick does not contain

- No program code from the original game, in any form: not copied, not decompiled, not
  "translated" into another language.
- No art, sound, music, video, fonts, text or other content from the original game, and no
  extracts or conversions of them.
- No copies of the original game's files, and no links to downloads of it.

The repository holds only code and documentation written by contributors.

## Copyright

The original game is protected by copyright, held today by Take-Two Interactive Software, Inc.,
and remains protected for decades to come. Mudbrick respects that.

Copyright protects the _expression_ of a work: its code, art, sound and text. It does not protect
ideas, rules, methods of operation, facts or file formats. Mudbrick documents the formats and
behaviour of the original game as facts and formulas (see [`docs/`](docs/README.md)) and
implements an independent program from those documents. Studying a program you own in order to
build a compatible one is lawful reverse engineering for interoperability; it is the method
behind projects such as OpenRA, OpenMW, ScummVM and Freeciv, and it is recognised in United States
case law (_Sega v. Accolade_, 1992; _Sony v. Connectix_, 2000) and statute (17 U.S.C. § 1201(f)).
The original data files carry no copy protection, so nothing is circumvented.

## Trademarks

_Civilization_, _Civ_, _Sid Meier's Civilization_ and related names are trademarks of Take-Two
Interactive Software, Inc. _MicroProse_ is a trademark of its current owner. These names appear in
this project only in plain text, only to identify the product Mudbrick is compatible with. That is
nominative fair use, and the project keeps to its limits:

- The marks never appear in the project name, repository name, package names, domains, logos,
  release names, or feature names.
- No logos, box art, screenshots or other branding from the original game are used anywhere.
- Every compatibility statement is accompanied by this notice: **Mudbrick is not affiliated with,
  endorsed by, or sponsored by Take-Two Interactive, Firaxis Games or 2K.**

## For players

To use the original graphics, sounds and maps you need your own, legitimately obtained copy of the
original game. Mudbrick reads those files inside your browser; nothing is uploaded anywhere. If
you do not own the game, you can use Mudbrick once free replacement assets exist, and you are
welcome to help make them.

## For contributors

The clean-room rules in [CONTRIBUTING.md](CONTRIBUTING.md) exist to keep the promises above true:
never copy the original code, never commit the original files, describe behaviour in the docs and
then implement from the docs, and keep the original trademarks out of names. If you are unsure
whether something is allowed, ask in an issue before writing it.

## Rights holders

If you hold rights in the original game and believe something in this repository infringes them,
please open an issue describing the concern. The maintainers will respond promptly and in good
faith.
