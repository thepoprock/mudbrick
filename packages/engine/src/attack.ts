/**
 * An attack on a square: choose the defender, fight, and apply the aftermath.
 *
 * Specification: docs/engine/rules-combat.md, "After the fight" — VERIFIED against the original's
 * attack handler (0x0052d472): the attacker spends one full move; the loser dies; a defender
 * beaten in the open takes the whole stack with it (not in a city, fortress or airbase); a city
 * without City Walls loses a citizen when its defender falls (unless the owner has the Great
 * Wall, or the defender is a human at Chieftain, or the attacker fires from the sea); a
 * barbarian leader pays a ransom; missiles are consumed.
 */
import {
  applyCombat,
  maxHitPoints,
  resolveCombat,
  type CombatContext,
  type CombatResult,
} from './combat.js';
import { chooseDefender } from './defender.js';
import { NUCLEAR_ATTACK, nuclearStrike, type Blast } from './nuclear.js';
import { removeCity } from './fertility.js';
import type { Rng } from './rng.js';
import { DOMAIN_GROUND, DOMAIN_SEA, IMPROVEMENT, type EngineRules } from './rules.js';
import {
  OCEAN,
  SquareFlag,
  type City,
  type Civ,
  type Point,
  type Unit,
  type World,
} from './world.js';

export interface AttackContext {
  /** Civilization records by slot (for wonders, human flag, city counts). */
  civ: (slot: number) => Civ | undefined;
  /** Wonders held by a civilization, by @IMPROVE index. */
  wondersOf: (slot: number) => boolean[];
  cityCount: (slot: number) => number;
  difficulty: number;
  /** Simplified combat OFF: fight to the death and let damage matter. */
  realisticCombat: boolean;
  /** 0 … 3; a barbarian leader's ransom is 50 × this. */
  barbarianActivity: number;
  /** Attacker's moves left in thirds (FATIGUE scaling). */
  attackerMovesLeft: number;
  /** Scenario events: a unit of this type, owned by `defender`, fell to `attacker` (UNITKILLED). */
  onUnitKilled?: (type: number, attacker: number, defender: number) => void;
}

export type AttackEvent =
  | { kind: 'no-defender' }
  | { kind: 'cannot-attack'; reason: 'non-combat' }
  | { kind: 'nuclear'; blast: Blast }
  | {
      kind: 'fought';
      result: CombatResult;
      defender: Unit;
      attackerWon: boolean;
      /** Other enemy units destroyed with the defender in the open. */
      stackLost: Unit[];
      /** The city lost a citizen; `destroyed` when that emptied it. */
      cityShrunk: City | null;
      cityDestroyed: boolean;
      ransom: number;
      attackerConsumed: boolean;
    };

/** Resolve an attack by `attacker` on the adjacent square `to`. Mutates the world. */
export function resolveAttack(
  world: World,
  rules: EngineRules,
  rng: Rng,
  attacker: Unit,
  to: Point,
  ctx: AttackContext,
): AttackEvent {
  const aType = rules.units[attacker.type];
  if (!aType || aType.attack === 0) return { kind: 'cannot-attack', reason: 'non-combat' };
  if (aType.attack >= NUCLEAR_ATTACK) {
    world.units.splice(world.units.indexOf(attacker), 1);
    return { kind: 'nuclear', blast: nuclearStrike(world, rng, attacker.owner, to.x, to.y, true) };
  }
  const enemies = world.unitsAt(to.x, to.y).filter((u) => u.owner !== attacker.owner);
  const city = world.cityAt(to.x, to.y) ?? null;
  const defenderSlot = enemies[0]?.owner ?? city?.owner ?? 0;
  const defenderCiv = ctx.civ(defenderSlot);
  const combatCtx: CombatContext & { damageMatters?: boolean } = {
    defenderFortified: enemies.some((u) => u.fortified),
    attackerWonders: ctx.wondersOf(attacker.owner),
    defenderWonders: ctx.wondersOf(defenderSlot),
    defenderIsHuman: defenderCiv?.isHuman ?? false,
    defenderCityCount: ctx.cityCount(defenderSlot),
    difficulty: ctx.difficulty,
    attackerMovesLeft: ctx.attackerMovesLeft,
    realisticCombat: ctx.realisticCombat,
    damageMatters: ctx.realisticCombat,
    ...(city ? { defenderCity: city.improvements } : {}),
  };
  const defender = chooseDefender(world, rules, enemies, attacker, combatCtx);
  if (!defender) return { kind: 'no-defender' };
  const result = resolveCombat(world, rules, rng, attacker, defender, combatCtx);
  applyCombat(rules, result, attacker, defender);
  // VERIFIED 0x0052d472: a Coastal Fortress that doubled the defence against a ship is now known.
  if (
    city?.improvements[IMPROVEMENT.coastalFortress] === true &&
    aType.domain === DOMAIN_SEA &&
    rules.units[defender.type]?.domain !== DOMAIN_SEA
  )
    city.coastalFortressKnown = true;

  // VERIFIED 0x0052d472: every caller of the mover asks for this (0x00539099 with mode 3).
  attacker.movesSpent += rules.cosmic.roadMoveMultiplier;
  attacker.moved = true;
  attacker.order = null;
  attacker.fortified = false;

  const remove = (u: Unit) => {
    const i = world.units.indexOf(u);
    if (i >= 0) world.units.splice(i, 1);
  };
  const stackLost: Unit[] = [];
  let cityShrunk: City | null = null;
  let cityDestroyed = false;
  let ransom = 0;
  let attackerConsumed = false;

  if (result.attackerWon) {
    remove(defender);
    ctx.onUnitKilled?.(defender.type, attacker.owner, defender.owner);
    const dType = rules.units[defender.type];
    if (defender.owner === 0 && (dType?.role ?? 0) > 4) {
      ransom = ctx.barbarianActivity * 50;
      const me = ctx.civ(attacker.owner);
      if (me) me.treasury += ransom;
    }
    const fortress =
      world.hasFlag(to.x, to.y, SquareFlag.Fortress) ||
      world.hasFlag(to.x, to.y, SquareFlag.Airbase);
    if (!city && !fortress) {
      for (const u of world.unitsAt(to.x, to.y)) {
        if (u.owner !== attacker.owner) {
          stackLost.push(u);
          remove(u);
        }
      }
    }
    if (city) {
      const attackerOnLand = world.terrainAt(attacker.position.x, attacker.position.y) !== OCEAN;
      const walls = city.improvements[IMPROVEMENT.cityWalls] === true;
      const greatWall = ctx.wondersOf(city.owner)[IMPROVEMENT.greatWall] === true;
      const spared = ctx.difficulty === 0 && (defenderCiv?.isHuman ?? false);
      if (attackerOnLand && !walls && !greatWall && !spared) {
        city.size -= 1;
        cityShrunk = city;
        if (city.size <= 0) {
          removeCity(world, rules, city);
          cityDestroyed = true;
        }
      }
    }
    if (aType.flags.destroyedAfterAttack) {
      remove(attacker);
      attackerConsumed = true;
    }
  } else {
    remove(attacker);
    attackerConsumed = true;
  }
  // Keep hit points consistent for the survivor when simplified combat ended after one round.
  const survivor = result.attackerWon ? attacker : defender;
  if (survivor.hitPointsLost >= maxHitPoints(rules, survivor.type)) {
    survivor.hitPointsLost = maxHitPoints(rules, survivor.type) - 1;
  }
  // VERIFIED (the combat handler): a battle between two civilizations resets the turns of peace.
  if (attacker.owner !== 0 && defender.owner !== 0) world.peaceBroken = true;
  return {
    kind: 'fought',
    result,
    defender,
    attackerWon: result.attackerWon,
    stackLost,
    cityShrunk,
    cityDestroyed,
    ransom,
    attackerConsumed,
  };
}

export const GROUND = DOMAIN_GROUND;
