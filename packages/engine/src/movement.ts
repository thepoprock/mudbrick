/**
 * Movement rules: how far a unit may move, what a step costs, and whether it is allowed.
 *
 * Specification: docs/engine/rules-units.md and rules-movement.md — VERIFIED against the original
 * executable's movement allowance routine and its unit move handler. Movement is counted in
 * thirds of a movement point: a unit with `move` 1 has 3 thirds per turn.
 */
import { lookAround } from './sight.js';
import type { Rng } from './rng.js';
import { DOMAIN_AIR, DOMAIN_GROUND, DOMAIN_SEA, type EngineRules } from './rules.js';
import { OCEAN, SquareFlag, type City, type Point, type Unit, type World } from './world.js';

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
  /** Whether a slot is human-controlled (the cargo rule differs); default: every slot is. */
  isHuman?: (slot: number) => boolean;
  /** The owner's continent plan for a land mass (computer cargo on a "defend" land mass stays). */
  planOf?: (slot: number, landmass: number) => number;
}

const ORDER_FORTIFY = 0;
const ORDER_FORTIFIED = 1;
const ORDER_SLEEP = 2;

/** Full movement allowance of a unit, in thirds (VERIFIED, 0x00554169). */
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

/** Spend everything: the original's "end this unit's move" helper (0x00557ebb). */
export function endUnitMove(rules: EngineRules, unit: Unit, ctx: MovementContext = {}): void {
  unit.movesSpent = fullMoves(rules, unit, ctx);
}

/** A city square counts as road and railroad (VERIFIED: the handler tests the city bit alongside). */
function roadLike(world: World, p: Point): boolean {
  return (
    world.hasFlag(p.x, p.y, SquareFlag.Road) ||
    world.hasFlag(p.x, p.y, SquareFlag.Railroad) ||
    world.cityAt(p.x, p.y) !== undefined
  );
}

function railLike(world: World, p: Point): boolean {
  return world.hasFlag(p.x, p.y, SquareFlag.Railroad) || world.cityAt(p.x, p.y) !== undefined;
}

/** True when `to` is one of the four edge-neighbours of `from` (a diagonal step on screen). */
export function isEdgeNeighbour(world: World, from: Point, to: Point): boolean {
  return world.directNeighbours(from.x, from.y).some((n) => n?.x === to.x && n.y === to.y);
}

/**
 * Cost in thirds for `unit` to step from `from` to the adjacent square `to` (VERIFIED), ignoring
 * whether it has that many left. Returns null when the step is impossible for its domain; an
 * ocean square for a ground unit means boarding, which `checkMove` handles.
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
  if (type.domain === DOMAIN_SEA) return toTerrain === OCEAN || toCity ? THIRDS : null;
  if (type.domain !== DOMAIN_GROUND) return null;
  if (toTerrain === OCEAN && !toCity) return null;

  if (railLike(world, from) && railLike(world, to)) return 0;
  if (type.flags.alpine) return 1;
  if (roadLike(world, from) && roadLike(world, to)) return 1;
  if (
    world.hasFlag(from.x, from.y, SquareFlag.River) &&
    world.hasFlag(to.x, to.y, SquareFlag.River) &&
    isEdgeNeighbour(world, from, to)
  ) {
    return 1;
  }
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
 * A ground unit may not step from an enemy zone of control into another one (VERIFIED) unless it
 * ignores zones of control, the destination already holds a unit (friend or foe — a foe means an
 * attack), or it is disembarking from a boat.
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
  if (world.unitsAt(to.x, to.y).length > 0) return false;
  if (!world.isLand(from.x, from.y)) return false;
  return (
    inEnemyZoc(world, from.x, from.y, unit.owner, ctx) &&
    inEnemyZoc(world, to.x, to.y, unit.owner, ctx)
  );
}

/** Used transport capacity on a square: ground units sharing it with the ship. */
export function transportWithRoom(
  world: World,
  rules: EngineRules,
  at: Point,
  owner: number,
): Unit | null {
  const here = world.unitsAt(at.x, at.y);
  const carried = here.filter((u) => rules.units[u.type]?.domain === DOMAIN_GROUND).length;
  let room = 0;
  let ship: Unit | null = null;
  for (const u of here) {
    const t = rules.units[u.type];
    if (!t || u.owner !== owner || t.domain !== DOMAIN_SEA) continue;
    room += t.holds ?? 0;
    ship ??= u;
  }
  return ship && room > carried ? ship : null;
}

export type MoveVerdict =
  | { ok: true; cost: number; partial: boolean; boards: boolean }
  | {
      ok: false;
      reason:
        | 'impassable'
        | 'not-adjacent'
        | 'no-moves'
        | 'zoc'
        | 'needs-transport'
        | 'enemy'
        | 'amphibious'
        | 'submarine';
    };

/** Can `unit` attempt the step now? Does not change state. Attacks are reported as 'enemy'. */
export function checkMove(
  world: World,
  rules: EngineRules,
  unit: Unit,
  to: Point,
  ctx: MovementContext & ZocContext = {},
): MoveVerdict {
  const type = rules.units[unit.type];
  if (!type) return { ok: false, reason: 'impassable' };
  const from = unit.position;
  const adjacent = world.neighbours(from.x, from.y).some((n) => n?.x === to.x && n.y === to.y);
  if (!adjacent) return { ok: false, reason: 'not-adjacent' };
  const left = movesLeft(rules, unit, ctx);
  if (left <= 0) return { ok: false, reason: 'no-moves' };
  const there = world.unitsAt(to.x, to.y);
  const city = world.cityAt(to.x, to.y);
  const foreignUnit = there.some((u) => u.owner !== unit.owner);
  if (foreignUnit || (city && city.owner !== unit.owner)) {
    // VERIFIED (the move handler 0x00539099): a ground unit on an ocean square attacks a foreign
    // unit only with the amphibious flag; a submarine never attacks a land square.
    if (foreignUnit) {
      if (
        type.domain === DOMAIN_GROUND &&
        !world.isLand(from.x, from.y) &&
        !type.flags.amphibiousAssault
      )
        return { ok: false, reason: 'amphibious' };
      if (type.flags.submarine && world.isLand(to.x, to.y))
        return { ok: false, reason: 'submarine' };
    }
    return { ok: false, reason: 'enemy' };
  }
  const cost = stepCost(world, rules, unit, from, to);
  if (cost === null) {
    if (type.domain === DOMAIN_GROUND && !world.isLand(to.x, to.y)) {
      return transportWithRoom(world, rules, to, unit.owner)
        ? { ok: true, cost: left, partial: false, boards: true }
        : { ok: false, reason: 'needs-transport' };
    }
    return { ok: false, reason: 'impassable' };
  }
  if (blockedByZoc(world, rules, unit, from, to, ctx)) return { ok: false, reason: 'zoc' };
  return { ok: true, cost, partial: cost > left && unit.movesSpent !== 0, boards: false };
}

/**
 * Chance (0–1) that a step costing `cost` succeeds with `left` thirds remaining (VERIFIED): always
 * when affordable or when the unit has not moved yet this turn; otherwise `left / cost`.
 */
export function partialMoveChance(cost: number, left: number, movesSpent: number): number {
  if (cost <= left || movesSpent === 0) return 1;
  if (left <= 0) return 0;
  return left / cost;
}

/** The original's roll for a partial move: `rand() % cost`, success when `left > roll`. */
export function rollPartialMove(rng: Rng, cost: number, left: number, movesSpent: number): boolean {
  if (cost <= left || movesSpent === 0) return true;
  const roll = cost - 1 < 1 ? 0 : rng.nextInt(cost);
  return left > roll;
}

/** Apply a successful step: position and movement spent; any standing order is dropped. */
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
  unit.order = null;
  unit.lastDirection = null;
  unit.moved = true;
}

/**
 * The units that sail with a departing ship (VERIFIED, the stack routine 0x00556b62): up to the
 * ship's capacity, first the ground units sentried aboard it, then — at sea — every other ground
 * unit of the owner on the square; in port, a computer player's units that are not fortified
 * (unless they sit on a land mass whose plan is "defend" and have a combat role), or a human's
 * sentried units not aboard another ship. Carriers and submarines (air cargo) are not modelled.
 */
export function gatherCargo(
  world: World,
  rules: EngineRules,
  ship: Unit,
  ctx: MovementContext = {},
): Unit[] {
  const type = rules.units[ship.type];
  if (!type || type.domain !== DOMAIN_SEA) return [];
  let room = type.holds ?? 0;
  if (room <= 0) return [];
  const atSea = !world.isLand(ship.position.x, ship.position.y);
  const human = ctx.isHuman ? ctx.isHuman(ship.owner) : true;
  const stack = world
    .unitsAt(ship.position.x, ship.position.y)
    .filter(
      (u) => u !== ship && u.owner === ship.owner && rules.units[u.type]?.domain === DOMAIN_GROUND,
    );
  const taken: Unit[] = [];
  const lm = (world.landmass[world.index(ship.position.x, ship.position.y)] ?? 0) & 63;
  for (let pass = 0; pass < 2 && room > 0; pass++) {
    for (const u of stack) {
      if (room <= 0) break;
      if (taken.includes(u)) continue;
      let take = false;
      if (pass === 0) take = u.order === ORDER_SLEEP && u.aboard === ship.id;
      else if (!human) {
        if ((u.order !== ORDER_FORTIFY && u.order !== ORDER_FORTIFIED) || atSea) {
          if (!atSea && ctx.planOf) {
            const role = rules.units[u.type]?.role ?? 0;
            take = ctx.planOf(ship.owner, lm) !== 1 || role > 4;
          } else take = true;
        }
      } else take = (u.order === ORDER_SLEEP && u.aboard === undefined) || atSea;
      if (take) {
        taken.push(u);
        room -= 1;
      }
    }
  }
  return taken;
}

/** Carry the cargo along after a ship's step; entering a city wakes the sentried passengers (VERIFIED). */
function carryCargo(world: World, ship: Unit, cargo: Unit[], to: Point): void {
  const city = world.cityAt(to.x, to.y);
  for (const u of cargo) {
    u.position = { x: to.x, y: to.y };
    u.aboard = ship.id;
    if (city) {
      if (u.order === ORDER_SLEEP) u.order = null;
      delete u.aboard;
    } else if (u.order !== ORDER_SLEEP) {
      u.order = ORDER_SLEEP;
      u.fortified = false;
    }
  }
}

/**
 * Attempt a step with the verified rules: checks, the partial-move gamble, boarding. Returns
 * what happened; `attack` means the caller should resolve combat instead.
 */
export type MoveResult =
  | { kind: 'moved'; cost: number }
  | { kind: 'boarded'; ship: Unit }
  | { kind: 'failed-roll' }
  | { kind: 'attack' }
  /** A diplomat or spy at a foreign city: the espionage menu (espionage.ts). */
  | { kind: 'diplomat'; city: City }
  /** A diplomat or spy next to a lone foreign unit: bribe or sabotage it. */
  | { kind: 'diplomat-unit'; target: Unit }
  /** A caravan at a foreign city: a trade route (trade.ts). */
  | { kind: 'caravan'; city: City }
  | { kind: 'refused'; reason: Exclude<MoveVerdict, { ok: true }>['reason'] };

export function tryMove(
  world: World,
  rules: EngineRules,
  rng: Rng,
  unit: Unit,
  to: Point,
  ctx: MovementContext & ZocContext = {},
): MoveResult {
  const verdict = checkMove(world, rules, unit, to, ctx);
  if (!verdict.ok) {
    if (verdict.reason === 'enemy' && unit.owner !== 0) {
      // VERIFIED: the handler sends diplomats and caravans entering foreign cities to their own
      // routines before any combat; a diplomat next to a lone foreign unit gets the bribe menu.
      const role = rules.units[unit.type]?.role;
      const city = world.cityAt(to.x, to.y);
      if (city && city.owner !== unit.owner) {
        if (role === 6) return { kind: 'diplomat', city };
        if (role === 7) return { kind: 'caravan', city };
      } else if (role === 6) {
        const there = world.unitsAt(to.x, to.y);
        const target = there[0];
        if (target && there.length === 1 && target.owner !== unit.owner)
          return { kind: 'diplomat-unit', target };
      }
    }
    return verdict.reason === 'enemy'
      ? { kind: 'attack' }
      : { kind: 'refused', reason: verdict.reason };
  }
  if (verdict.boards) {
    const ship = transportWithRoom(world, rules, to, unit.owner);
    if (!ship) return { kind: 'refused', reason: 'needs-transport' };
    unit.position = { x: to.x, y: to.y };
    unit.fortified = false;
    unit.order = null;
    unit.moved = true;
    unit.aboard = ship.id;
    endUnitMove(rules, unit, ctx);
    return { kind: 'boarded', ship };
  }
  const left = movesLeft(rules, unit, ctx);
  if (!rollPartialMove(rng, verdict.cost, left, unit.movesSpent)) {
    endUnitMove(rules, unit, ctx);
    return { kind: 'failed-roll' };
  }
  const moverType = rules.units[unit.type];
  const cargo = moverType?.domain === DOMAIN_SEA ? gatherCargo(world, rules, unit, ctx) : [];
  applyMove(rules, unit, to, verdict.cost, ctx);
  if (cargo.length > 0) carryCargo(world, unit, cargo, to);
  if (moverType?.domain === DOMAIN_GROUND && world.isLand(to.x, to.y)) delete unit.aboard;
  lookAround(world, rules, unit);
  return { kind: 'moved', cost: verdict.cost };
}
