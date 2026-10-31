/**
 * Movement rules: how far a unit may move and what a step costs.
 *
 * Specification: docs/engine/rules-movement.md. The allowance and step costs are VERIFIED
 * against the original executable; zones of control and the partial-move gamble are INFERRED.
 *
 * Movement is counted in thirds of a movement point, as the original does: a unit with `move`
 * 1 has 3 thirds per turn, a road step costs 1 third, a railroad step 0.
 */
import { DOMAIN_AIR, DOMAIN_GROUND, DOMAIN_SEA, type EngineRules } from './rules.js';
import { OCEAN, SquareFlag, type Point, type Unit, type World } from './world.js';

export const THIRDS = 3;

/** Facts about the unit's civilization and the game options that change its allowance. */
export interface MovementContext {
  /** The civilization knows Nuclear Power (+1 MP for sea units). */
  nuclearPower?: boolean;
  /** Owns Magellan's Expedition (+2 MP for sea units). */
  magellans?: boolean;
  /** Owns the Lighthouse (+1 MP for sea units other than triremes). */
  lighthouse?: boolean;
  /** Options word bit 4: simplified combat OFF, so damage slows units down. */
  damageSlowsUnits?: boolean;
}

/** Full movement allowance of a unit, in thirds (0x00554169). */
export function fullMoves(rules: EngineRules, unit: Unit, ctx: MovementContext = {}): number {
  const type = rules.units[unit.type];
  if (!type) return 0;
  let moves = type.move * THIRDS;
  if (moves === 0) return 0;
  if (type.domain === DOMAIN_SEA) {
    if (ctx.nuclearPower) moves += THIRDS;
    if (ctx.magellans) moves += 2 * THIRDS;
    if (ctx.lighthouse && !type.flags.mustStayNearLand) moves += THIRDS;
  }
  if (ctx.damageSlowsUnits && unit.hitPointsLost > 0 && type.domain !== DOMAIN_AIR) {
    const max = Math.max(1, type.hitPointsTens * 10);
    const left = Math.max(0, max - unit.hitPointsLost);
    moves = Math.floor((left * moves) / max);
    if (moves % THIRDS !== 0) moves += THIRDS - (moves % THIRDS);
    const minimum = type.domain === DOMAIN_SEA ? 2 * THIRDS : THIRDS;
    if (moves <= minimum) moves = minimum;
  }
  return moves;
}

export function movesLeft(rules: EngineRules, unit: Unit, ctx: MovementContext = {}): number {
  return Math.max(0, fullMoves(rules, unit, ctx) - unit.movesSpent);
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

/** True when `to` is one of the four edge-neighbours of `from` (a diagonal step on screen). */
function isEdgeNeighbour(from: Point, to: Point, world: World): boolean {
  return world.directNeighbours(from.x, from.y).some((n) => n?.x === to.x && n.y === to.y);
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
  ctx: MovementContext = {},
): number | null {
  const type = rules.units[unit.type];
  if (!type) return null;
  const toTerrain = world.terrainAt(to.x, to.y);
  const toCity = world.cityAt(to.x, to.y) !== undefined;

  if (type.domain === DOMAIN_AIR) return THIRDS;
  if (type.domain === DOMAIN_SEA) return toTerrain === OCEAN || toCity ? THIRDS : null;
  if (type.domain !== DOMAIN_GROUND) return null;
  if (toTerrain === OCEAN && !toCity) return null;

  if (hasRail(world, from) && hasRail(world, to)) return 0;
  if ((hasRoadLike(world, from) && hasRoadLike(world, to)) || type.flags.alpine) return 1;
  if (
    world.hasFlag(from.x, from.y, SquareFlag.River) &&
    world.hasFlag(to.x, to.y, SquareFlag.River) &&
    isEdgeNeighbour(from, to, world)
  ) {
    return 1;
  }
  // A unit with one movement point or less pays one point for any terrain.
  if (fullMoves(rules, unit, ctx) <= THIRDS) return THIRDS;
  return (rules.terrain[toTerrain]?.moveCost ?? 1) * THIRDS;
}

/** Facts about diplomacy the zone-of-control rule needs. */
export interface ZocContext {
  /** Are these two civilization slots allied (treaty bit 3)? Allies never exert zones of control. */
  isAllied?: (a: number, b: number) => boolean;
}

/**
 * Is square (x, y) inside an enemy zone of control for `civ`? VERIFIED (0x005564c0 → 0x00556397):
 * never when a city stands on the square; otherwise when a neighbour of the same kind (land next
 * to land, sea next to sea) holds units of another, non-allied civilization.
 */
export function inEnemyZoc(
  world: World,
  x: number,
  y: number,
  civ: number,
  ctx: ZocContext = {},
): boolean {
  if (world.cityAt(x, y)) return false;
  const ocean = !world.isLand(x, y);
  for (const n of world.neighbours(x, y)) {
    if (!n) continue;
    if (!world.isLand(n.x, n.y) !== ocean) continue;
    const owner = world.unitsAt(n.x, n.y)[0]?.owner;
    if (owner === undefined || owner === civ) continue;
    if (ctx.isAllied?.(owner, civ)) continue;
    return true;
  }
  return false;
}

/**
 * The go-to code refuses a step from an enemy zone of control into another unless the unit
 * ignores zones of control (VERIFIED). The manual's exception for a destination already holding
 * a friendly unit is kept as INFERRED until the move handler is read.
 */
export function blockedByZoc(
  world: World,
  rules: EngineRules,
  unit: Unit,
  from: Point,
  to: Point,
  ctx: ZocContext = {},
): boolean {
  const type = rules.units[unit.type];
  if (!type || type.domain !== DOMAIN_GROUND || type.flags.ignoreZonesOfControl) return false;
  if (world.unitsAt(to.x, to.y).some((u) => u.owner === unit.owner)) return false;
  return (
    inEnemyZoc(world, from.x, from.y, unit.owner, ctx) &&
    inEnemyZoc(world, to.x, to.y, unit.owner, ctx)
  );
}

export type MoveVerdict =
  | { ok: true; cost: number; partial: boolean }
  | { ok: false; reason: 'impassable' | 'not-adjacent' | 'no-moves' | 'zoc' };

/** Can `unit` attempt the step now? Does not change state. */
export function checkMove(
  world: World,
  rules: EngineRules,
  unit: Unit,
  to: Point,
  ctx: MovementContext = {},
): MoveVerdict {
  const from = unit.position;
  const adjacent = world.neighbours(from.x, from.y).some((n) => n?.x === to.x && n.y === to.y);
  if (!adjacent) return { ok: false, reason: 'not-adjacent' };
  const cost = stepCost(world, rules, unit, from, to, ctx);
  if (cost === null) return { ok: false, reason: 'impassable' };
  const left = movesLeft(rules, unit, ctx);
  if (left <= 0) return { ok: false, reason: 'no-moves' };
  if (blockedByZoc(world, rules, unit, from, to)) return { ok: false, reason: 'zoc' };
  return { ok: true, cost, partial: cost > left };
}

/**
 * Chance (0–1) that a step costing `cost` succeeds with only `left` thirds remaining (INFERRED:
 * the original lets a unit with any movement left attempt a costlier step).
 */
export function partialMoveChance(cost: number, left: number): number {
  if (cost <= left) return 1;
  if (left <= 0) return 0;
  return left / cost;
}

/** Apply a successful step: position and movement spent. Caller has already rolled any gamble. */
export function applyMove(
  rules: EngineRules,
  unit: Unit,
  to: Point,
  cost: number,
  ctx: MovementContext = {},
): void {
  unit.position = { x: to.x, y: to.y };
  unit.movesSpent = Math.min(fullMoves(rules, unit, ctx), unit.movesSpent + cost);
  unit.fortified = false;
}
