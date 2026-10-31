/**
 * Which unit on a square defends against an attack.
 *
 * Specification: docs/engine/rules-combat.md, "Which unit defends" — VERIFIED against the
 * original's selection routine. The score is the defence strength with a few tie-breakers and
 * situational factors; the highest score defends, later units winning ties.
 */
import {
  defenceStrength,
  IMPROVEMENT,
  maxHitPoints,
  hitPoints,
  type CombatContext,
} from './combat.js';
import { DOMAIN_AIR, DOMAIN_GROUND, DOMAIN_SEA, type EngineRules } from './rules.js';
import { OCEAN, type Unit, type World } from './world.js';

export interface DefenderChoiceContext extends CombatContext {
  /** Options word bit 4: simplified combat OFF, so damage lowers a unit's score. */
  damageMatters?: boolean;
}

/** Score a candidate defender; higher defends. */
export function defenderScore(
  world: World,
  rules: EngineRules,
  unit: Unit,
  attacker: Unit | null,
  ctx: DefenderChoiceContext,
): number {
  const type = rules.units[unit.type];
  const aType = attacker ? rules.units[attacker.type] : undefined;
  const probe = attacker ?? unit;
  let score = defenceStrength(world, rules, unit, probe, ctx).value;
  if (ctx.damageMatters) {
    score = Math.floor((hitPoints(rules, unit) * score) / maxHitPoints(rules, unit.type));
  }
  if (type?.flags.doubleDefenceVsHorse) score += 1;
  if (type?.flags.doubleDefenceVsAir) {
    if (!aType) score += 1;
    else if (aType.domain === DOMAIN_AIR) score *= aType.flags.destroyedAfterAttack ? 5 : 3;
  }
  if (type?.flags.canAttackAir && aType?.domain === DOMAIN_AIR && aType.flags.canAttackAir)
    score <<= 1;
  if (type?.domain === DOMAIN_SEA && ctx.defenderCity) {
    if (aType?.domain === DOMAIN_AIR && !ctx.defenderCity[IMPROVEMENT.samBattery]) score <<= 1;
    else score = Math.floor(score / 2);
  }
  return score;
}

/**
 * Pick the defender among `candidates` (the units on one square). Ground units on an ocean
 * square never defend. Returns null if nothing can defend.
 */
export function chooseDefender(
  world: World,
  rules: EngineRules,
  candidates: Unit[],
  attacker: Unit | null,
  ctx: DefenderChoiceContext,
): Unit | null {
  let best: Unit | null = null;
  let bestScore = -1;
  for (const unit of candidates) {
    const onOcean = world.terrainAt(unit.position.x, unit.position.y) === OCEAN;
    if (onOcean && rules.units[unit.type]?.domain === DOMAIN_GROUND) continue;
    const score = defenderScore(world, rules, unit, attacker, ctx);
    if (score >= bestScore) {
      bestScore = score;
      best = unit;
    }
  }
  return best;
}
