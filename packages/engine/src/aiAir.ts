/**
 * The computer's aircraft (the air chooser 0x004f2dd3, VERIFIED decode in docs/engine/ai-units.md
 * "Air units"): the fuel budget, returning to base, missiles, fighters and bombers. The engine
 * version keeps the documented tests; where the notes leave a detail open it is marked INFERRED.
 */
import { gridDistance } from './city.js';
import { attackStrength, defenceStrength } from './combat.js';
import { fullMoves, movesLeft } from './movement.js';
import { orderGoTo, sentry } from './orders.js';
import { DOMAIN_AIR, DOMAIN_SEA, type EngineRules } from './rules.js';
import {
  NEIGHBOUR_OFFSETS,
  OCEAN,
  SquareFlag,
  type City,
  type Point,
  type Unit,
  type World,
} from './world.js';

export interface AirContext {
  rng: { nextInt: (n: number) => number };
  atWar: (slot: number) => boolean;
  canAttack: (slot: number) => boolean;
  isHuman: (slot: number) => boolean;
  /** A human whose treaty lets our aircraft use its cities (INFERRED: an alliance). */
  isAlly: (slot: number) => boolean;
  movement: {
    nuclearPower?: boolean;
    magellans?: boolean;
    lighthouse?: boolean;
    damageSlowsUnits?: boolean;
  };
}

export type AirDecision =
  | { kind: 'hold' }
  | { kind: 'goto'; target: Point; tag: string }
  | { kind: 'attack'; target: Point; tag: string };

/** Fuel left in movement points: `(range − turns flown − 1) × full moves + moves left` (twice the moves for range 0). */
export function fuelBudget(rules: EngineRules, unit: Unit, ctx: AirContext): number {
  const type = rules.units[unit.type];
  if (!type) return 0;
  const full = fullMoves(rules, unit, ctx.movement);
  const left = movesLeft(rules, unit, ctx.movement);
  if (type.range === 0) return full * 2;
  return (type.range - unit.workCounter - 1) * full + left;
}

function nearestOwnCity(world: World, unit: Unit): { city: City; dist: number } | null {
  let best: { city: City; dist: number } | null = null;
  for (const c of world.cities) {
    if (c.owner !== unit.owner) continue;
    const d = gridDistance(world, unit.position, c.position);
    if (!best || d < best.dist) best = { city: c, dist: d };
  }
  return best;
}

/** Squares beside a point that are empty (no unit, no city). */
function emptyNeighbours(world: World, p: Point): Point[] {
  const out: Point[] = [];
  for (const off of NEIGHBOUR_OFFSETS) {
    const y = p.y + off.y;
    if (y < 0 || y >= world.rows) continue;
    const x = world.wrapX(p.x + off.x, y);
    if (x === null) continue;
    if (world.unitsAt(x, y).length > 0 || world.cityAt(x, y)) continue;
    out.push({ x, y });
  }
  return out;
}

/** Decide an aircraft's move for this turn. */
export function airDecision(
  world: World,
  rules: EngineRules,
  unit: Unit,
  ctx: AirContext,
): AirDecision {
  const type = rules.units[unit.type];
  if (!type || type.domain !== DOMAIN_AIR) return { kind: 'hold' };
  const full = fullMoves(rules, unit, ctx.movement);
  const left = movesLeft(rules, unit, ctx.movement);
  const budget = fuelBudget(rules, unit, ctx);
  const home = nearestOwnCity(world, unit);
  const homeCost = home ? home.dist * 3 : 9999;

  // Return to base: a fighter with half its moves or less and home just within the budget; a
  // bomber that has flown half its range and can still reach home.
  if (home) {
    if (type.range === 1 && unit.order === null && left * 2 <= full && homeCost <= budget)
      return { kind: 'goto', target: home.city.position, tag: 'H' };
    if (type.range > 1 && unit.workCounter * 2 >= type.range && homeCost <= budget)
      return { kind: 'goto', target: home.city.position, tag: 'H' };
  }

  const enemies = world.units.filter(
    (u) =>
      u.owner !== unit.owner &&
      ctx.atWar(u.owner) &&
      ctx.canAttack(u.owner) &&
      world.isSeen(u.position.x, u.position.y, unit.owner),
  );

  // Missiles: a non-air enemy within the budget worth four times the missile's own cost.
  if (type.flags.destroyedAfterAttack && type.attack < 99) {
    let best: Unit | null = null;
    let bestWorth = type.costRows * 4 - 1;
    for (const e of enemies) {
      const et = rules.units[e.type];
      if (!et || et.domain === DOMAIN_AIR) continue;
      const d = gridDistance(world, unit.position, e.position);
      if (d * 3 > budget) continue;
      const stack = world.unitsAt(e.position.x, e.position.y);
      const sheltered =
        world.cityAt(e.position.x, e.position.y) !== undefined ||
        world.hasFlag(e.position.x, e.position.y, SquareFlag.Fortress) ||
        world.hasFlag(e.position.x, e.position.y, SquareFlag.Airbase);
      let worth: number;
      if (sheltered) {
        worth = et.costRows;
        if (stack.length === 1) worth *= 2;
        if (
          emptyNeighbours(world, e.position).length < 8 &&
          world.units.some(
            (u) => u.owner === unit.owner && gridDistance(world, u.position, e.position) === 1,
          )
        )
          worth *= 2;
      } else worth = stack.reduce((s, u) => s + (rules.units[u.type]?.costRows ?? 0), 0);
      if (world.terrainAt(e.position.x, e.position.y) === OCEAN) worth *= 2;
      if (world.hasFlag(e.position.x, e.position.y, SquareFlag.Fortress)) worth *= 2;
      worth += et.holds ?? 0;
      if (worth > bestWorth) {
        bestWorth = worth;
        best = e;
      }
    }
    if (best) {
      const pads = emptyNeighbours(world, best.position);
      const pad = pads.sort(
        (a, b) => gridDistance(world, unit.position, a) - gridDistance(world, unit.position, b),
      )[0];
      if (pad) return { kind: 'attack', target: best.position, tag: 'M' };
    }
    return { kind: 'hold' };
  }

  // Fighters (role 3): the lowest-scoring beatable enemy.
  if (type.role === 3) {
    let best: Unit | null = null;
    let bestScore = 1e9;
    for (const e of enemies) {
      const et = rules.units[e.type];
      if (!et) continue;
      const d = gridDistance(world, unit.position, e.position);
      let score: number;
      if (et.domain === DOMAIN_AIR) {
        score = 2 * d;
        if (ctx.isHuman(e.owner)) score >>= 1;
        if (et.range > 0) score -= 1;
        if (world.unitsAt(e.position.x, e.position.y).length === 1) score -= 1;
      } else {
        const stack = world.unitsAt(e.position.x, e.position.y);
        if (
          et.domain === DOMAIN_SEA
            ? stack.filter((u) => rules.units[u.type]?.domain === DOMAIN_SEA).length >= 2
            : stack.length > 1
        )
          continue;
        // INFERRED: the attack and defence strengths stand in for "attack, hit points and
        // firepower" against "defence, hit points, firepower and terrain".
        const mine = attackStrength(rules, unit).value * (type.hitPointsTens * type.firepower);
        const theirs =
          defenceStrength(world, rules, e, unit).value * (et.hitPointsTens * et.firepower);
        if (mine * 2 <= theirs * 3) continue;
        score = d;
      }
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) {
      const d = gridDistance(world, unit.position, best.position);
      const homeAfter = home ? gridDistance(world, best.position, home.city.position) * 3 : 9999;
      if (d <= 1 && (homeAfter <= budget - 3 || homeCost > budget))
        return { kind: 'attack', target: best.position, tag: 'A' };
      for (const p of emptyNeighbours(world, best.position)) {
        const there = gridDistance(world, unit.position, p) * 3;
        const back = home ? gridDistance(world, p, home.city.position) * 3 : 9999;
        if (there + back <= budget) return { kind: 'goto', target: p, tag: 'A' };
      }
      if (home) {
        let near: City | null = null;
        let nd = 9999;
        for (const c of world.cities) {
          const ok = c.owner === unit.owner || (ctx.isHuman(c.owner) && ctx.isAlly(c.owner));
          if (!ok) continue;
          if (gridDistance(world, unit.position, c.position) * 3 > budget) continue;
          const dd = gridDistance(world, c.position, best.position);
          if (dd < nd) {
            nd = dd;
            near = c;
          }
        }
        if (near) return { kind: 'goto', target: near.position, tag: 'a' };
      }
    }
    return { kind: 'hold' };
  }

  // Bombers (role 0 with range): the best enemy city holding units.
  if (type.role === 0 && type.range > 0 && budget > 0) {
    const lm = (world.landmass[world.index(unit.position.x, unit.position.y)] ?? 0) & 63;
    let best: City | null = null;
    let bestScore = -1;
    for (const c of world.cities) {
      if (c.owner === unit.owner || !ctx.atWar(c.owner) || !ctx.canAttack(c.owner)) continue;
      const d = gridDistance(world, unit.position, c.position);
      if (d * 3 > budget) continue;
      const units = world.unitsAt(c.position.x, c.position.y).length;
      if (units === 0) continue;
      let score = c.size * 10 - units * 25;
      if (((world.landmass[world.index(c.position.x, c.position.y)] ?? 0) & 63) === lm) score += 40;
      for (const off of NEIGHBOUR_OFFSETS) {
        const y = c.position.y + off.y;
        if (y < 0 || y >= world.rows) continue;
        const x = world.wrapX(c.position.x + off.x, y);
        if (x !== null && world.unitsAt(x, y).some((u) => u.owner === unit.owner)) score += 60;
      }
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) {
      if (gridDistance(world, unit.position, best.position) <= 1)
        return { kind: 'attack', target: best.position, tag: 'B' };
      return { kind: 'goto', target: best.position, tag: 'B' };
    }
  }
  if (
    home &&
    unit.order === null &&
    homeCost <= budget &&
    !world.cityAt(unit.position.x, unit.position.y)
  )
    return { kind: 'goto', target: home.city.position, tag: 'H' };
  return { kind: 'hold' };
}

/** Apply a decision; true when the unit should keep moving this turn. */
export function applyAirDecision(unit: Unit, d: AirDecision): boolean {
  if (d.kind === 'goto') {
    if (!unit.gotoTarget || unit.gotoTarget.x !== d.target.x || unit.gotoTarget.y !== d.target.y)
      orderGoTo(unit, d.target);
    else unit.order = unit.order ?? 10;
    return true;
  }
  if (d.kind === 'hold') {
    if (unit.order === null) sentry(unit);
    return false;
  }
  return true;
}
