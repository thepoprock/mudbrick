/**
 * Combat resolution between one attacker and one defender.
 *
 * Specification: docs/engine/rules-combat.md. The round structure and modifiers are INFERRED
 * from the original manual and community documentation; the document lists what still has to
 * be confirmed against the executable. All randomness goes through `Rng`, so a battle is
 * reproducible from the generator state.
 */
import type { Rng } from './rng.js';
import { DOMAIN_AIR, DOMAIN_GROUND, DOMAIN_SEA, type EngineRules } from './rules.js';
import { SquareFlag, type Unit, type World } from './world.js';

export interface StrengthBreakdown {
  base: number;
  /** Multipliers applied, in order, each with a label for display and debugging. */
  modifiers: { label: string; factor: number }[];
  /** Final strength, scaled for damage taken. */
  value: number;
}

export interface CombatRound {
  attackerWon: boolean;
  attackerHp: number;
  defenderHp: number;
}

export interface CombatResult {
  attack: StrengthBreakdown;
  defence: StrengthBreakdown;
  rounds: CombatRound[];
  attackerWon: boolean;
  /** Hit points remaining for the survivor. */
  survivorHp: number;
}

export function maxHitPoints(rules: EngineRules, unitType: number): number {
  return (rules.units[unitType]?.hitPointsTens ?? 1) * 10;
}

export function hitPoints(rules: EngineRules, unit: Unit): number {
  return Math.max(0, maxHitPoints(rules, unit.type) - unit.hitPointsLost);
}

function apply(b: StrengthBreakdown, label: string, factor: number): void {
  if (factor === 1) return;
  b.modifiers.push({ label, factor });
  b.value *= factor;
}

/** Attack strength with veteran status and damage scaling. */
export function attackStrength(rules: EngineRules, attacker: Unit): StrengthBreakdown {
  const type = rules.units[attacker.type];
  const b: StrengthBreakdown = { base: type?.attack ?? 0, modifiers: [], value: type?.attack ?? 0 };
  if (attacker.veteran) apply(b, 'veteran', 1.5);
  const max = maxHitPoints(rules, attacker.type);
  const hp = hitPoints(rules, attacker);
  if (hp < max) apply(b, 'damaged', hp / max);
  return b;
}

export interface DefenceContext {
  /** The defender's city has City Walls. */
  cityWalls: boolean;
  /** The defender's city has a Coastal Fortress. */
  coastalFortress: boolean;
  /** The defender's city has a SAM Missile Battery. */
  samBattery: boolean;
}

const NO_CITY: DefenceContext = { cityWalls: false, coastalFortress: false, samBattery: false };

/** Defence strength on the defender's square against this attacker. */
export function defenceStrength(
  world: World,
  rules: EngineRules,
  defender: Unit,
  attacker: Unit,
  ctx: DefenceContext = NO_CITY,
): StrengthBreakdown {
  const type = rules.units[defender.type];
  const aType = rules.units[attacker.type];
  const b: StrengthBreakdown = {
    base: type?.defence ?? 0,
    modifiers: [],
    value: type?.defence ?? 0,
  };
  const { x, y } = defender.position;
  const terrain = rules.terrain[world.terrainAt(x, y)];
  const inCity = world.cityAt(x, y) !== undefined;

  if (type?.domain === DOMAIN_GROUND || type?.domain === DOMAIN_SEA) {
    apply(b, 'terrain', (terrain?.defenceHalves ?? 2) / 2);
  }
  if (type?.domain === DOMAIN_GROUND && world.hasFlag(x, y, SquareFlag.River))
    apply(b, 'river', 1.5);
  if (defender.veteran) apply(b, 'veteran', 1.5);
  if (type?.domain === DOMAIN_GROUND) {
    if (defender.fortified || inCity) apply(b, inCity ? 'in city' : 'fortified', 1.5);
    else if (world.hasFlag(x, y, SquareFlag.Fortress)) apply(b, 'fortress', 2);
  }
  if (inCity && aType) {
    if (ctx.cityWalls && aType.domain === DOMAIN_GROUND && !aType.flags.negatesCityWalls) {
      apply(b, 'city walls', 3);
    }
    if (ctx.coastalFortress && aType.domain === DOMAIN_SEA) apply(b, 'coastal fortress', 2);
    if (ctx.samBattery && aType.domain === DOMAIN_AIR) apply(b, 'SAM battery', 2);
  }
  if (
    aType &&
    type?.flags.doubleDefenceVsHorse &&
    aType.domain === DOMAIN_GROUND &&
    aType.move === 2
  ) {
    apply(b, 'pikemen vs horse', 2);
  }
  if (aType && type?.flags.doubleDefenceVsAir && aType.domain === DOMAIN_AIR)
    apply(b, 'AEGIS vs air', 2);
  const max = maxHitPoints(rules, defender.type);
  const hp = hitPoints(rules, defender);
  if (hp < max) apply(b, 'damaged', hp / max);
  return b;
}

/**
 * Fight to the death. Each round the attacker wins with probability A / (A + D) and the loser
 * of the round loses hit points equal to the winner's firepower.
 */
export function resolveCombat(
  world: World,
  rules: EngineRules,
  rng: Rng,
  attacker: Unit,
  defender: Unit,
  ctx: DefenceContext = NO_CITY,
): CombatResult {
  const attack = attackStrength(rules, attacker);
  const defence = defenceStrength(world, rules, defender, attacker, ctx);
  const aFp = rules.units[attacker.type]?.firepower ?? 1;
  const dFp = rules.units[defender.type]?.firepower ?? 1;
  let aHp = hitPoints(rules, attacker);
  let dHp = hitPoints(rules, defender);
  const rounds: CombatRound[] = [];
  // Strengths are compared as integers in the original; scale to thirds-of-points precision.
  const a = Math.round(attack.value * 8);
  const d = Math.round(defence.value * 8);
  if (a + d === 0) {
    return { attack, defence, rounds, attackerWon: false, survivorHp: dHp };
  }
  while (aHp > 0 && dHp > 0) {
    const attackerWon = rng.nextInt(a + d) < a;
    if (attackerWon) dHp = Math.max(0, dHp - aFp);
    else aHp = Math.max(0, aHp - dFp);
    rounds.push({ attackerWon, attackerHp: aHp, defenderHp: dHp });
  }
  const attackerWon = dHp === 0;
  return { attack, defence, rounds, attackerWon, survivorHp: attackerWon ? aHp : dHp };
}

/** Write a combat result back onto the units: the loser is marked destroyed via hit points 0. */
export function applyCombat(
  rules: EngineRules,
  result: CombatResult,
  attacker: Unit,
  defender: Unit,
): void {
  const winner = result.attackerWon ? attacker : defender;
  const loser = result.attackerWon ? defender : attacker;
  winner.hitPointsLost = maxHitPoints(rules, winner.type) - result.survivorHp;
  loser.hitPointsLost = maxHitPoints(rules, loser.type);
}
