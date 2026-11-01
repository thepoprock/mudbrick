# Negotiation with a human

Read from the assessment routine 0x00440b9e(computer, human), which runs before the negotiation
screen 0x00449c70 opens. VERIFIED from that routine unless marked INFERRED. The names of its
results are INFERRED from how they are used here; the screen itself (0x00449c70, 0x00445022) is
not read yet, and nothing in this file is ported yet.

Below, `A` is the computer player and `H` the human.

## What it produces

| Global     | Name here   | Meaning                                                           |
| ---------- | ----------- | ----------------------------------------------------------------- |
| 0x005cfd4c | `tribute`   | gold it would ask for, a multiple of 50                           |
| 0x005cfd2c | `hostile`   | it means to threaten or fight                                     |
| 0x005cfd20 | `fear`      | how much it fears H; non-zero clears `hostile`                    |
| 0x005cfd48 | `mood`      | attitude toward H, adjusted, 1 to 99                              |
| 0x005cfd7c | `stance`    | 0 wary, 1 neutral, 2 hostile                                      |
| 0x005cfd74 | `restraint` | a score; above its limit `hostile` is dropped                     |
| 0x005cfd50 | `leader`    | it is ranked first and may press its lead                         |
| 0x005cfd1c | `betrayal`  | H has been a bad partner; it refuses to deal                      |
| 0x005cfd64 | `spaceRace` | a spaceship is under way (0x0053ff14, or a human one late enough) |
| 0x005cfd60 | `outranked` | A is ranked below H                                               |
| 0x005cfd68 | `exposed`   | one of A's undefended cities has H's unit within two squares      |
| 0x005cfd28 | `ceded`     | cities A holds that H founded                                     |

## The sequence

1. **Per continent.** For each of the 63 land masses, H's strength there is compared with A's.
   Where H has an attack plan and is stronger, `fear` grows by A's strength × (4 on Chieftain,
   otherwise 2) / (H's strength + 1), subject to the note below. Otherwise,
   if both have units there `hostile` is set, and `tribute` grows: on a mass A has no plan for,
   by a quarter or a half of the strength gap; on one A has a plan for, by H's full strength early
   (turn ≤ 200 − 50 × A's vendettas, or either side ranked above 6) when H's plan is weak, and by
   the gap otherwise.
2. H owning Marco Polo's adds a quarter to `tribute`.
3. `leader` holds when A ranks 7, has more than 4 cities, H more than 1, A has no spaceship, the
   difficulty is above Chieftain and the turn is past 200.
4. `mood` starts at A's attitude toward H. When `leader` holds, or H is in vendetta with A and A
   has under three times H's power, and A has no spaceship: `tribute` is at least twice H's rank,
   and capped by what A can pay if `hostile` was clear; `hostile` is set, `fear` cleared, `mood`
   at least 75.
5. `spaceRace` with `outranked` sets `hostile`.
6. If H has a spaceship, the treaty bit 8 is set and, when A has none, `hostile` is set with
   `tribute` at least 100. If A has one and they are not allied, `fear` is forced to at least 4
   when H has none (half A's reputation plus one), or `tribute` is halved and scaled by the two
   ships' sizes.
7. `fear` is divided by `(reputation − 1) / 2 + 1`.
8. `mood` adjustments: −25 allied, +25 for a recent attack by H, and with any reputation
   `(reputation − 1 − A's per-civilization offset) × 5`.
9. Mood bands: below 26 halves `tribute` and clears `hostile`. Band under 4 (0x0044dfde) takes
   two thirds. Above 74 takes half as much again and sets `hostile`.
10. Grudge bit 11 sets `hostile`, as does an options bit when H's science rate is 0. Any `fear`
    clears `hostile` and sets `stance` to 0.
11. **A owns the Great Wall or the United Nations:** `leader` clears, `hostile` is remembered and
    cleared, `mood` falls by 10, and the bit 16 note is recorded.
12. Reputation scales `tribute` by half per point. A vendetta doubles it; bit 16 quarters it.
13. Any city of A with no defender and an H unit within two squares doubles `tribute` once and
    counts as `exposed`.
14. `tribute` becomes `(difficulty + 1) × tribute / 32`, clamped to 0 to 20, × 50. If that is
    between one and two times A's gold, and A has at least 50, it is A's gold rounded down to 50.
15. `hostile` clears with no tribute, or when A has over three times H's power. A pair counter
    above 9 is zeroed and clears `hostile`. `stance` becomes 2 when hostile, else 0 if allied.
16. **Restraint** starts at −2 for a vendetta, −1 more under that options bit with no science,
    minus half of A's reputation. Each third civilization adjusts it:
    - allied with H: −1 if H ranks below A, and when A is `leader`-shaped and has contact with
      that civilization, `fear` falls by 4, or `hostile` sets if that civilization holds a grudge
      against A and A owns neither the Wall nor the UN;
    - at war with H: +1 if H's power is under four times its power, +1 if under its power. It
      is remembered as a possible ally when A has contact and no grudge. Those with bits 13 and 9
      toward H are tracked as the strongest and weakest such enemies.
      H having no third party in bit 11 records bit 20. Then the government of H (0x005da118 table)
      is subtracted, and −1 if A has less power than H. If restraint exceeds 1 at war, or 0
      otherwise, with no `leader` and no alliance or bit 11, `hostile` clears, and `tribute` is
      zeroed on some turns (`(turn + A + H) & 32`).
17. `ceded` counts cities A holds that H founded. **Betrayal** requires H's standing or the
    negotiation-limit option, no bit 13 past 4 ceded, no alliance, and hostility or a late space
    race or a remembered hostility with reputation gap over 6, and H weaker than A or in vendetta
    or that gap. It clears `hostile` and `stance`, and caps `mood` at 30.
18. Scenario flag (bit 15 at 0x005d0880): hard-coded pairs for the shipped Cold War scenario force
    `hostile`, INFERRED from the slot numbers.
19. Under a senate (H's government above 4, with the patience test) a hostile A either backs down,
    when H is much weaker and neither `leader` nor vendetta holds, or the human's senate is
    consulted (0x0051278c).
20. Clamps: `mood` at least 1 with no `fear`; at most 99 unless H has bit 13 toward A; at most 74
    when A is allied or `stance` is 0; at least 26 when H has bit 13 toward A.

Note on step 1: the test compares a boolean with H's plan byte, so with more than one city a plan
of 2 or more counts and with one city any plan does.
