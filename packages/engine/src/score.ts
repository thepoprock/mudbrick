import { SHIP_FLAG, shipOf, shipScore } from './spaceship.js';
import type { Civ, World } from './world.js';

/**
 * The civilization score (0x0047c9e0, VERIFIED): citizens (content 1, happy 2, unhappy 0:
 * `size + happy − unhappy` per city, from the city record's bytes 82 and 83), 20 a wonder,
 * the landed spaceship's credit (population aboard × success, once the ship has won), −10 a
 * polluted square beyond the header's baseline, after turn 200 three a turn of peace (capped at
 * 100 — the counter runs from turn 200 and any battle between two civilizations resets it),
 * five a future technology, and the barbarian level × 25 − 50; never below zero. The last
 * civilization standing also scores a conquest bonus: civilizations destroyed × 100 +
 * (570 − turn) × 2 + 400 (the turn floored at 250 when "don't restart if eliminated" is on),
 * ×5/4 under dearer research, ×4/5 under cheaper; the score is the larger of the two. The
 * objective-based scoring of a scenario (scenario flag bit 1) is not modelled. The year limit
 * (0x0046b0fa): the year 2000 warns of retirement, 2020 ends the game. docs/engine/rules-turn.md.
 */
export interface ScoreContext {
  turn: number;
  turnsOfPeace: number;
  pollutionSquares: number;
  /** The header's +28 word, 0 in an ordinary game (INFERRED: a baseline for scenarios). */
  pollutionBaseline?: number;
  barbarianActivity: number;
  /** Header +25 (INFERRED from its use: civilizations destroyed, × 100 in the conquest bonus). */
  destroyedCivilizations?: number;
  /** Options byte 1 bit 0: "don't restart if eliminated". */
  noRestart?: boolean;
  researchDearer?: boolean;
  researchCheaper?: boolean;
  /** For the landed ship's credit. */
  isHuman: (slot: number) => boolean;
  massThrust: number;
  knowsFusion: (slot: number) => boolean;
  year: number;
}

export interface ScoreBreakdown {
  citizens: number;
  wonders: number;
  spaceship: number;
  pollution: number;
  peace: number;
  futureTechs: number;
  barbarians: number;
  /** The seven terms above, floored at zero. */
  civilization: number;
  /** The conquest bonus, 0 unless the civilization is the last in play. */
  conquest: number;
  total: number;
}

export function civilizationScore(world: World, civ: Civ, ctx: ScoreContext): ScoreBreakdown {
  let citizens = 0;
  for (const c of world.cities) {
    if (c.owner !== civ.slot) continue;
    citizens += c.size + (c.lastHappy ?? 0) - (c.lastUnhappy ?? 0);
  }
  let wonders = 0;
  for (const c of world.cities) {
    if (c.owner !== civ.slot) continue;
    for (let w = 39; w < 67; w++) if (c.improvements[w]) wonders += 20;
  }
  const ship = shipOf(civ);
  const spaceship =
    (ship.flags & SHIP_FLAG.won) !== 0
      ? shipScore(civ, ctx.isHuman(civ.slot), ctx.massThrust, ctx.knowsFusion(civ.slot), ctx.year)
      : 0;
  const pollution = (ctx.pollutionSquares - (ctx.pollutionBaseline ?? 0)) * -10;
  const peace = ctx.turn > 199 ? Math.max(0, Math.min(100, ctx.turnsOfPeace * 3)) : 0;
  const futureTechs = civ.futureTechs * 5;
  const barbarians = ctx.barbarianActivity * 25 - 50;
  const civilization = Math.max(
    0,
    citizens + wonders + spaceship + pollution + peace + futureTechs + barbarians,
  );
  let conquest = 0;
  const alive = world.civs.filter((c) => c.slot !== 0 && c.inPlay);
  if (alive.length === 1 && alive[0] === civ) {
    let turn = ctx.turn;
    if (ctx.noRestart && turn < 251) turn = 250;
    conquest = (ctx.destroyedCivilizations ?? 0) * 100 + (570 - turn) * 2 + 400;
    if (ctx.researchDearer) conquest = Math.trunc((conquest * 5) / 4);
    if (ctx.researchCheaper) conquest = Math.trunc((conquest * 4) / 5);
  }
  return {
    citizens,
    wonders,
    spaceship,
    pollution,
    peace,
    futureTechs,
    barbarians,
    civilization,
    conquest,
    total: Math.max(civilization, conquest),
  };
}

/** The year limit (0x0046b0fa): 'warn' in the year 2000, 'end' in 2020. */
export function retirementStage(year: number): 'warn' | 'end' | null {
  if (year === 2000) return 'warn';
  if (year === 2020) return 'end';
  return null;
}
