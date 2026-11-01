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
  /** The header's +28 word: polluted squares inside computer players' city radii, counted by
   * the square-status pass (0x004b30b1) during the scoring pass — so only the rest is charged. */
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
  /** A scenario with objective victory (scenario flag bit 1): the objective-based score. */
  scenario?: {
    /** Scenario flag bit 2: every wonder in a city is an objective too. */
    countWondersAsObjectives: boolean;
    /** The protagonist slot, 0 = each civilization is measured on its own objectives. */
    protagonist: number;
    objectives: {
      decisiveVictory: number;
      marginalVictory: number;
      marginalDefeat: number;
      decisiveDefeat: number;
    };
  };
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
  /** Scenario objective victory: objectives held and the level (0 decisive victory … 4 decisive defeat). */
  objectives?: number;
  objectiveLevel?: number;
  total: number;
}

/** A city's objective value (0x0042bf49): one when flagged, plus one per wonder in it when the
 * scenario counts wonders as objectives. */
export function objectiveValue(
  city: { objective?: boolean; improvements: boolean[] },
  countWonders: boolean,
): number {
  let v = city.objective ? 1 : 0;
  if (countWonders) for (let w = 39; w < 67; w++) if (city.improvements[w]) v += 1;
  return v;
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
  const base = {
    citizens,
    wonders,
    spaceship,
    pollution,
    peace,
    futureTechs,
    barbarians,
    civilization,
    conquest,
  };
  if (!ctx.scenario) return { ...base, total: Math.max(civilization, conquest) };
  // VERIFIED (the objective-victory branch): the protagonist's objectives (or the
  // civilization's own without one) place it at decisive victory, marginal victory, neither,
  // marginal defeat or decisive defeat against the four thresholds; everyone else sees the
  // level mirrored; 1000 / 750 / 500 / 250 / 0 plus ten an objective held, doubled with a
  // conquest bonus.
  const sc = ctx.scenario;
  let protagonistHeld = 0;
  let mine = 0;
  for (const c of world.cities) {
    const v = objectiveValue(c, sc.countWondersAsObjectives);
    if (c.owner === sc.protagonist) protagonistHeld += v;
    if (c.owner === civ.slot) mine += v;
  }
  if (sc.protagonist === 0) protagonistHeld = mine;
  const t = sc.objectives;
  let level = 2;
  if (protagonistHeld < t.decisiveVictory) {
    if (protagonistHeld < t.marginalVictory) {
      if (t.decisiveDefeat < protagonistHeld) {
        if (protagonistHeld <= t.marginalDefeat) level = 3;
      } else level = 4;
    } else level = 1;
  } else level = 0;
  const own = sc.protagonist !== 0 && sc.protagonist !== civ.slot ? 4 - level : level;
  let total = ([1000, 750, 500, 250, 0][own] ?? 0) + mine * 10;
  if (conquest > 0) total *= 2;
  return { ...base, objectives: mine, objectiveLevel: own, total };
}

/** The year limit (0x0046b0fa): 'warn' in the year 2000, 'end' in 2020 — or, for a scenario
 * with an end turn, 'warn' five turns before it and 'end' on it. */
export function retirementStage(
  year: number,
  turn = 0,
  scenarioEndTurn = 0,
): 'warn' | 'end' | null {
  if (scenarioEndTurn > 0) {
    if (turn === scenarioEndTurn - 5) return 'warn';
    if (turn === scenarioEndTurn) return 'end';
    return null;
  }
  if (year === 2000) return 'warn';
  if (year === 2020) return 'end';
  return null;
}
