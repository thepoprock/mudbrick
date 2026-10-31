/**
 * Movement rules: what a step costs and whether it is allowed.
 *
 * Specification: docs/engine/rules-movement.md. Everything there is INFERRED from the original
 * manual and long-standing community documentation until the executable analysis confirms it;
 * this module is written to be checked against that document, not the other way round.
 *
 * Movement is counted in thirds of a movement point, as the original does: a unit with `move`
 * 1 has 3 thirds per turn, a road step costs 1 third, a railroad step 0.
 */
import { DOMAIN_AIR, DOMAIN_GROUND, DOMAIN_SEA, type EngineRules } from './rules.js';
import { OCEAN, SquareFlag, type Point, type Unit, type World } from './world.js';

export const THIRDS = 3;

/** Full movement allowance of a unit type, in thirds. */
export function fullMoves(rules: EngineRules, unitType: number): number {
  return (rules.units[unitType]?.move ?? 1) * THIRDS;
}

export function movesLeft(rules: EngineRules, unit: Unit): number {
  return Math.max(0, fullMoves(rules, unit.type) - unit.movesSpent);
}

function hasRoadLike(world: World, p: Point): boolean {
  return (
    world.hasFlag(p.x, p.y, SquareFlag.Road) ||
    world.hasFlag(p.x, p.y, SquareFlag.Railroad) ||
    world.cityAt(p.x, p.y) !== undefined
  );
}

function hasRail(world: World, p: Point): boolean {
  return world.hasFlag(p.x, p.y, SquareFlag.Railroad) || world.cityAt(p.x, p.y) !== undefined;
}

/**
 * Cost in thirds for `unit` to step from `from` to the adjacent square `to`, ignoring whether
 * it has that many left. Returns null if the step is impossible for its domain.
 */
export function stepCost(
  world: World,
  rules: EngineRules,
  unit: Unit,
  from: Point,
  to: Point,
): number | null {
  const type = rules.units[unit.type];
  if (!type) return null;
  const toTerrain = world.terrainAt(to.x, to.y);
  const toCity = world.cityAt(to.x, to.y) !== undefined;

  if (type.domain === DOMAIN_AIR) return THIRDS;
  if (type.domain === DOMAIN_SEA) {
    return toTerrain === OCEAN || toCity ? THIRDS : null;
  }
  if (type.domain !== DOMAIN_GROUND) return null;
  if (toTerrain === OCEAN && !toCity) return null; // boarding a transport is a separate action

  if (hasRail(world, from) && hasRail(world, to)) return 0;
  if ((hasRoadLike(world, from) && hasRoadLike(world, to)) || type.flags.alpine) return 1;
  // Following a river: both squares carry one.
  if (
    world.hasFlag(from.x, from.y, SquareFlag.River) &&
    world.hasFlag(to.x, to.y, SquareFlag.River)
  ) {
    return 1;
  }
  const cost = rules.terrain[toTerrain]?.moveCost ?? 1;
  return cost * THIRDS;
}

/**
 * Zone of control: a ground unit may not move from a square next to an enemy ground unit into
 * another square next to an enemy ground unit, unless the destination holds a friendly unit or
 * city, the unit ignores zones of control, or it starts in a city.
 */
export function blockedByZoc(
  world: World,
  rules: EngineRules,
  unit: Unit,
  from: Point,
  to: Point,
): boolean {
  const type = rules.units[unit.type];
  if (!type || type.domain !== DOMAIN_GROUND || type.flags.ignoreZonesOfControl) return false;
  if (world.cityAt(from.x, from.y)) return false;
  const toCity = world.cityAt(to.x, to.y);
  if (toCity?.owner === unit.owner) return false;
  if (world.unitsAt(to.x, to.y).some((u) => u.owner === unit.owner)) return false;
  const enemyGroundAdjacent = (p: Point) =>
    world
      .neighbours(p.x, p.y)
      .some(
        (n) =>
          n !== null &&
          world
            .unitsAt(n.x, n.y)
            .some((u) => u.owner !== unit.owner && rules.units[u.type]?.domain === DOMAIN_GROUND),
      );
  return enemyGroundAdjacent(from) && enemyGroundAdjacent(to);
}

export type MoveVerdict =
  | {
      ok: true;
      cost: number;
      /** True when the unit lacks full cost and the step is a gamble. */ partial: boolean;
    }
  | { ok: false; reason: 'impassable' | 'not-adjacent' | 'no-moves' | 'zoc' };

/** Can `unit` attempt the step now? Does not change state. */
export function checkMove(world: World, rules: EngineRules, unit: Unit, to: Point): MoveVerdict {
  const from = unit.position;
  const adjacent = world.neighbours(from.x, from.y).some((n) => n?.x === to.x && n.y === to.y);
  if (!adjacent) return { ok: false, reason: 'not-adjacent' };
  const cost = stepCost(world, rules, unit, from, to);
  if (cost === null) return { ok: false, reason: 'impassable' };
  const left = movesLeft(rules, unit);
  if (left <= 0) return { ok: false, reason: 'no-moves' };
  if (blockedByZoc(world, rules, unit, from, to)) return { ok: false, reason: 'zoc' };
  return { ok: true, cost, partial: cost > left };
}

/**
 * Chance (0–1) that a step costing `cost` succeeds with only `left` thirds remaining. The
 * original lets a unit with any movement left attempt a costlier step and succeeds with
 * probability left/cost. INFERRED.
 */
export function partialMoveChance(cost: number, left: number): number {
  if (cost <= left) return 1;
  if (left <= 0) return 0;
  return left / cost;
}

/** Apply a successful step: position and movement spent. Caller has already rolled any gamble. */
export function applyMove(rules: EngineRules, unit: Unit, to: Point, cost: number): void {
  unit.position = { x: to.x, y: to.y };
  unit.movesSpent = Math.min(fullMoves(rules, unit.type), unit.movesSpent + cost);
  unit.fortified = false;
}
