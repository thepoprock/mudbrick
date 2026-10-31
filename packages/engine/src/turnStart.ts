/**
 * What happens to a civilization's units when its turn begins: healing (VERIFIED, pre-turn
 * routine 0x00468f0f), fuel for air units (thresholds VERIFIED from the move handler, timing
 * INFERRED: counted at turn start instead of at the last move), and the continuation of standing
 * orders (VERIFIED dispatch 0x004984a8; the go-to step is an INFERRED greedy simplification).
 */
import { distance } from './city.js';
import { maxHitPoints } from './combat.js';
import { checkMove, endUnitMove, fullMoves, tryMove, type MovementContext } from './movement.js';
import { gotoDirection } from './pathfinding.js';
import type { Rng } from './rng.js';
import { DOMAIN_AIR, DOMAIN_GROUND, DOMAIN_SEA, IMPROVEMENT, type EngineRules } from './rules.js';
import { doWork, ORDER, type WorkContext, type WorkEvent } from './terraform.js';
import {
  SquareFlag,
  type City,
  type Civ,
  type Unit,
  type World,
  NEIGHBOUR_OFFSETS,
} from './world.js';

export type UnitTurnEvent =
  | { kind: 'healed'; unit: Unit; amount: number }
  | { kind: 'helicopter-damage'; unit: Unit; amount: number }
  | { kind: 'fuel'; unit: Unit; used: number; range: number }
  | { kind: 'crashed'; unit: Unit }
  | { kind: 'fortified'; unit: Unit }
  | { kind: 'work'; unit: Unit; event: WorkEvent }
  | { kind: 'goto-step'; unit: Unit; arrived: boolean }
  | { kind: 'goto-blocked'; unit: Unit }
  | { kind: 'woke'; unit: Unit };

/** Nearest city of the owner on the unit's land mass, and its distance (VERIFIED lookup shape). */
function nearestOwnCity(world: World, unit: Unit): { city: City; dist: number } | null {
  let best: { city: City; dist: number } | null = null;
  const mass = world.landmass[world.index(unit.position.x, unit.position.y)];
  for (const c of world.cities) {
    if (c.owner !== unit.owner) continue;
    if (world.landmass[world.index(c.position.x, c.position.y)] !== mass) continue;
    const d = distance(world, unit.position, c.position);
    if (!best || d < best.dist) best = { city: c, dist: d };
  }
  return best;
}

/** Heal (or damage) one unit at the start of its owner's turn (VERIFIED). */
export function healUnit(world: World, rules: EngineRules, unit: Unit): UnitTurnEvent | null {
  const type = rules.units[unit.type];
  if (!type) return null;
  const max = maxHitPoints(rules, unit.type);
  const { x, y } = unit.position;
  const onBaseSquare = world.cityAt(x, y) !== undefined || world.hasFlag(x, y, SquareFlag.Airbase);
  if (unit.moved) {
    if (type.domain === DOMAIN_AIR && type.range === 0 && !onBaseSquare) {
      const before = unit.hitPointsLost;
      unit.hitPointsLost = Math.min(max - 1, unit.hitPointsLost + Math.trunc(max / 10));
      return { kind: 'helicopter-damage', unit, amount: unit.hitPointsLost - before };
    }
    return null;
  }
  if (unit.hitPointsLost === 0) return null;
  let factor = 1;
  const near = nearestOwnCity(world, unit);
  const dist = near ? near.dist : 99;
  if (world.hasFlag(x, y, SquareFlag.Fortress) && !world.hasFlag(x, y, SquareFlag.Airbase)) {
    factor = 2;
  }
  let full = false;
  if (dist < 4 && type.domain === DOMAIN_GROUND && near) {
    factor += near.city.improvements[IMPROVEMENT.barracks] ? 2 : 1;
  }
  if (dist === 0 && near) {
    const building =
      type.domain === DOMAIN_GROUND
        ? IMPROVEMENT.barracks
        : type.domain === DOMAIN_AIR
          ? IMPROVEMENT.airport
          : type.domain === DOMAIN_SEA
            ? IMPROVEMENT.portFacility
            : -1;
    if (building >= 0 && near.city.improvements[building]) {
      full = true;
      factor <<= 1;
    }
    factor <<= 1;
  }
  let heal = Math.trunc(max / 10) * factor;
  if (full && dist === 0) heal = unit.hitPointsLost;
  if (type.domain === DOMAIN_AIR && world.hasFlag(x, y, SquareFlag.Airbase))
    heal = unit.hitPointsLost;
  heal = Math.min(heal, unit.hitPointsLost);
  unit.hitPointsLost -= heal;
  if (unit.hitPointsLost === 0 && unit.order === ORDER.sleep) {
    if (type.domain !== DOMAIN_GROUND || world.isLand(x, y)) unit.order = null;
  }
  return { kind: 'healed', unit, amount: heal };
}

/** Is the air unit somewhere it can refuel: a city, an airbase, a carrier, or (missiles) a submarine? */
export function atAirBase(world: World, rules: EngineRules, unit: Unit): boolean {
  const { x, y } = unit.position;
  if (world.cityAt(x, y) || world.hasFlag(x, y, SquareFlag.Airbase)) return true;
  const type = rules.units[unit.type];
  for (const other of world.unitsAt(x, y)) {
    if (other === unit || other.owner !== unit.owner) continue;
    const t = rules.units[other.type];
    if (!t) continue;
    if (t.flags.carriesAirUnits) return true;
    if (t.flags.submarine && type?.flags.destroyedAfterAttack) return true;
  }
  return false;
}

/** Fuel accounting for an air unit with a range (thresholds VERIFIED). Returns a crash event when it falls. */
export function checkFuel(world: World, rules: EngineRules, unit: Unit): UnitTurnEvent | null {
  const type = rules.units[unit.type];
  if (!type || type.domain !== DOMAIN_AIR || type.range === 0) return null;
  if (atAirBase(world, rules, unit)) {
    unit.workCounter = 0;
    return null;
  }
  unit.workCounter += 1;
  if (unit.workCounter >= type.range) {
    world.units.splice(world.units.indexOf(unit), 1);
    return { kind: 'crashed', unit };
  }
  return { kind: 'fuel', unit, used: unit.workCounter, range: type.range };
}

/**
 * One go-to step: the pathfinder's first step (pathfinding.ts, the original's 0x00484325),
 * falling back to a greedy step when the goal is outside the pathfinder's window.
 */
export function gotoStep(
  world: World,
  rules: EngineRules,
  rng: Rng,
  unit: Unit,
  ctx: MovementContext = {},
): UnitTurnEvent {
  const target = unit.gotoTarget;
  if (!target) return { kind: 'goto-blocked', unit };
  if (target.x === unit.position.x && target.y === unit.position.y) {
    unit.order = null;
    unit.gotoTarget = null;
    return { kind: 'goto-step', unit, arrived: true };
  }
  while (fullMoves(rules, unit, ctx) > unit.movesSpent) {
    let best: { x: number; y: number } | null = null;
    const dir = gotoDirection(world, rules, unit, target);
    if (dir !== null) {
      const off = NEIGHBOUR_OFFSETS[dir];
      const y = unit.position.y + (off?.y ?? 0);
      const x = y >= 0 && y < world.rows ? world.wrapX(unit.position.x + (off?.x ?? 0), y) : null;
      if (x !== null) {
        const v = checkMove(world, rules, unit, { x, y }, ctx);
        if (v.ok && !v.boards) best = { x, y };
      }
    }
    let bestDist = distance(world, unit.position, target);
    if (!best) {
      for (const n of world.neighbours(unit.position.x, unit.position.y)) {
        if (!n) continue;
        const v = checkMove(world, rules, unit, n, ctx);
        if (!v.ok || v.boards) continue;
        const d = distance(world, n, target);
        if (d < bestDist) {
          bestDist = d;
          best = n;
        }
      }
    }
    if (!best) {
      unit.order = null;
      unit.gotoTarget = null;
      return { kind: 'goto-blocked', unit };
    }
    const r = tryMove(world, rules, rng, unit, best, ctx);
    unit.order = ORDER.goTo; // tryMove clears orders; a go-to continues
    unit.gotoTarget = target;
    unit.gotoSteps += 1;
    if (r.kind !== 'moved') break;
    if (unit.position.x === target.x && unit.position.y === target.y) {
      unit.order = null;
      unit.gotoTarget = null;
      return { kind: 'goto-step', unit, arrived: true };
    }
  }
  return { kind: 'goto-step', unit, arrived: false };
}

export interface UnitTurnContext extends MovementContext, WorkContext {
  pollutionCount?: { value: number };
}

/** Everything that happens to one unit at the start of its owner's turn. */
export function beginUnitTurn(
  world: World,
  rules: EngineRules,
  rng: Rng,
  unit: Unit,
  ctx: UnitTurnContext,
): UnitTurnEvent[] {
  const out: UnitTurnEvent[] = [];
  const healed = healUnit(world, rules, unit);
  if (healed) out.push(healed);
  unit.moved = false;
  unit.movesSpent = 0;
  const fuel = checkFuel(world, rules, unit);
  if (fuel) {
    out.push(fuel);
    if (fuel.kind === 'crashed') return out;
  }
  const order = unit.order;
  if (order === ORDER.fortify) {
    unit.order = ORDER.fortified;
    unit.fortified = true;
    out.push({ kind: 'fortified', unit });
  } else if (order !== null && order >= ORDER.fortress && order <= ORDER.airbase) {
    const ev = doWork(world, rules, unit, order, ctx, ctx.pollutionCount);
    out.push({ kind: 'work', unit, event: ev });
    endUnitMove(rules, unit, ctx);
  } else if (order === ORDER.goTo) {
    out.push(gotoStep(world, rules, rng, unit, ctx));
  }
  return out;
}

/** Start-of-turn processing for every unit of a civilization. */
export function beginUnitsTurn(
  world: World,
  rules: EngineRules,
  rng: Rng,
  civ: Civ,
  ctx: UnitTurnContext,
): UnitTurnEvent[] {
  const out: UnitTurnEvent[] = [];
  for (const unit of [...world.units]) {
    if (unit.owner !== civ.slot || !world.units.includes(unit)) continue;
    out.push(...beginUnitTurn(world, rules, rng, unit, ctx));
  }
  return out;
}
