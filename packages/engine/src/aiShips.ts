/**
 * The computer's ships.
 *
 * Transports follow the move handler's transport block (0x004f44cc, VERIFIED decode in
 * docs/engine/ai-units.md "Transports"): in port with room they pick an own coastal city on
 * another land mass short of units (the wanted number 0x004f266b), post gathering objectives at
 * the port and sail; loaded, they head for an enemy city they may attack, an own coastal city
 * short of units, or any enemy city by trade and distance, and unload where the cargo's land is
 * wanted; without a destination they ferry to a foreign city, a random other land mass, or
 * wander. The scoring details are INFERRED simplifications where noted. Warships use the
 * direction chooser like ground units.
 */
import { addObjective, type CivStrategy } from './aiStrategy.js';
import { distance } from './city.js';
import { orderGoTo, sentry } from './orders.js';
import { DOMAIN_GROUND, type EngineRules } from './rules.js';
import { NEIGHBOUR_OFFSETS, OCEAN, type City, type Point, type Unit, type World } from './world.js';

const ROLE_TRANSPORT = 4;
const PLAN_FULL = 4;

/** Units a land mass should hold for its cities (0x004f266b): the first five count 3, the next five 2, the next five 1. */
export function wantedUnits(citiesOn: number): number {
  let left = citiesOn;
  let weight = 3;
  let total = 0;
  while (left > 0 && weight > 0) {
    const chunk = Math.min(left, 5);
    total += weight * chunk;
    left -= chunk;
    weight -= 1;
  }
  return total;
}

function landmassAt(world: World, p: Point): number {
  return (world.landmass[world.index(p.x, p.y)] ?? 0) & 63;
}

/** A city with an ocean neighbour (city flag bit 7, set at founding — VERIFIED). */
export function coastal(world: World, city: City): boolean {
  for (const off of NEIGHBOUR_OFFSETS) {
    const y = city.position.y + off.y;
    if (y < 0 || y >= world.rows) continue;
    const x = world.wrapX(city.position.x + off.x, y);
    if (x !== null && world.terrainAt(x, y) === OCEAN) return true;
  }
  return false;
}

export interface ShipContext {
  turn: number;
  rng: { nextInt: (n: number) => number };
  strategy?: CivStrategy;
  canAttack: (slot: number) => boolean;
  atWar: (slot: number) => boolean;
  isAlly: (slot: number) => boolean;
  isHuman: (slot: number) => boolean;
  cityTrade: (city: City) => number;
}

export type ShipDecision =
  { kind: 'hold' } | { kind: 'goto'; target: Point; tag: string } | { kind: 'chooser' };

/** Own coastal cities on other land masses whose land mass is short of units and not "full". */
function portsWantingUnits(world: World, ship: Unit, ctx: ShipContext): City[] {
  const s = ctx.strategy;
  const here = landmassAt(world, ship.position);
  const out: City[] = [];
  for (const c of world.cities) {
    if (c.owner !== ship.owner || !coastal(world, c)) continue;
    const lm = landmassAt(world, c.position);
    if (lm === here || lm === 0) continue;
    if (s) {
      if ((s.plans[lm] ?? 0) === PLAN_FULL) continue;
      if ((s.unitsOn[lm] ?? 0) >= wantedUnits(s.citiesOn[lm] ?? 0)) continue;
    }
    out.push(c);
  }
  return out;
}

/** Post the gathering objectives at a port (VERIFIED types; priority 4 under attack/defend plans, else 2). */
function postGathering(port: City, targetPlan: number, s: CivStrategy): void {
  const p = targetPlan === 0 || targetPlan === 1 ? 4 : 2;
  const at = { x: port.position.x, y: port.position.y };
  addObjective(s, { ...at, type: 1, priority: p });
  addObjective(s, { ...at, type: 21, priority: p });
  addObjective(s, { ...at, type: 0, priority: p });
  addObjective(s, { ...at, type: 5, priority: p });
  if (targetPlan === 4 || targetPlan === 5) addObjective(s, { ...at, type: 6, priority: 2 });
  addObjective(s, { ...at, type: 7, priority: 2 });
}

/** Decide what a transport does (one decision per turn; the dispatcher follows the go-to). */
export function transportDecision(
  world: World,
  rules: EngineRules,
  ship: Unit,
  ctx: ShipContext,
): ShipDecision {
  const type = rules.units[ship.type];
  if (!type) return { kind: 'hold' };
  const here = ship.position;
  const cityHere = world.cityAt(here.x, here.y);
  const stack = world
    .unitsAt(here.x, here.y)
    .filter(
      (u) => u !== ship && u.owner === ship.owner && rules.units[u.type]?.domain === DOMAIN_GROUND,
    );
  const aboard = stack.filter((u) => u.aboard === ship.id);
  const atSea = world.terrainAt(here.x, here.y) === OCEAN;
  const holds = type.holds ?? 0;
  const lmHere = landmassAt(world, here);

  // A loaded transport.
  const loaded = atSea ? stack.length > 0 : aboard.length > 0 || stack.length >= holds;
  if (loaded && (atSea || stack.length > 0)) {
    // Unload where the cargo's land mass is wanted (tag 5): next to land of a land mass with own
    // cities short of units, or with no own city at all and settlers aboard.
    if (atSea) {
      for (const off of NEIGHBOUR_OFFSETS) {
        const y = here.y + off.y;
        if (y < 0 || y >= world.rows) continue;
        const x = world.wrapX(here.x + off.x, y);
        if (x === null || world.terrainAt(x, y) === OCEAN) continue;
        const lm = landmassAt(world, { x, y });
        const s = ctx.strategy;
        const citiesOn = s?.citiesOn[lm] ?? 0;
        const unitsOn = s?.unitsOn[lm] ?? 0;
        const settlersAboard = stack.some((u) => rules.units[u.type]?.role === 5);
        const foreignCities = world.cities.some(
          (c) => c.owner !== ship.owner && landmassAt(world, c.position) === lm,
        );
        if (
          (citiesOn > 0 && unitsOn < wantedUnits(citiesOn)) ||
          (citiesOn === 0 && settlersAboard && !foreignCities)
        )
          return { kind: 'hold' };
        if (ship.gotoTarget && distance(world, ship.gotoTarget, { x, y }) <= 1)
          return { kind: 'hold' };
      }
    }
    if (ship.order !== null && ship.gotoTarget)
      return { kind: 'goto', target: ship.gotoTarget, tag: 'keep' };
    // A: the nearest enemy city we may attack, on another land mass.
    let best: City | null = null;
    let bestD = 9999;
    for (const c of world.cities) {
      if (c.owner === ship.owner || !ctx.canAttack(c.owner) || !ctx.atWar(c.owner)) continue;
      if (landmassAt(world, c.position) === lmHere && !atSea) continue;
      const d = distance(world, here, c.position);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best)
      return {
        kind: 'goto',
        target: shoreNear(world, best.position, here) ?? best.position,
        tag: 'A',
      };
    // 4: the nearest own coastal city on another land mass short of units.
    const ports = portsWantingUnits(world, ship, ctx);
    let port: City | null = null;
    bestD = 9999;
    for (const c of ports) {
      const d = distance(world, here, c.position);
      if (d < bestD) {
        bestD = d;
        port = c;
      }
    }
    if (port) return { kind: 'goto', target: port.position, tag: '4' };
    // T: any enemy city by trade × distance / 8 (INFERRED: the lowest wins).
    let score = 1e9;
    for (const c of world.cities) {
      if (c.owner === ship.owner || !ctx.atWar(c.owner)) continue;
      const v = Math.trunc((ctx.cityTrade(c) * distance(world, here, c.position)) / 8);
      if (v < score) {
        score = v;
        best = c;
      }
    }
    if (best)
      return {
        kind: 'goto',
        target: shoreNear(world, best.position, here) ?? best.position,
        tag: 'T',
      };
    // Settlers aboard and nowhere wanted: a land mass with no own city (tag V).
    if (stack.some((u) => rules.units[u.type]?.role === 5)) {
      const v = otherLandmass(world, ship, ctx);
      if (v) return { kind: 'goto', target: v, tag: 'V' };
    }
    return { kind: 'hold' };
  }

  // In port with room: a destination for units gathered here (tag 3).
  if (cityHere && cityHere.owner === ship.owner) {
    for (const u of aboard) if (u.fortified) delete u.aboard; // release fortified cargo
    const s = ctx.strategy;
    const candidates = portsWantingUnits(world, ship, ctx);
    let best: City | null = null;
    let bestScore = 9999;
    const transportsHere = world
      .unitsAt(here.x, here.y)
      .filter((u) => u.owner === ship.owner && rules.units[u.type]?.role === ROLE_TRANSPORT).length;
    for (const c of candidates) {
      const lm = landmassAt(world, c.position);
      let score = distance(world, here, c.position);
      if (transportsHere >= 4) score += 16;
      const plan = s?.plans[lm] ?? 5;
      // INFERRED reading of "+16 or −(units on that land mass / 4) by plan".
      if (plan === 0 || plan === 1) score -= (s?.unitsOn[lm] ?? 0) >> 2;
      else score += 16;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best && s) {
      postGathering(cityHere, s.plans[landmassAt(world, best.position)] ?? 5, s);
      // Wait a turn for the gathering unless something is already aboard or waiting here.
      if (stack.length === 0) return { kind: 'hold' };
      return { kind: 'goto', target: best.position, tag: '3' };
    }
    // Ferry to a city of anyone on another land mass by trade and distance (INFERRED weights).
    let ferry: City | null = null;
    let fScore = -1;
    for (const c of world.cities) {
      if (landmassAt(world, c.position) === lmHere || !coastal(world, c)) continue;
      const d = distance(world, here, c.position);
      let v = Math.trunc((ctx.cityTrade(c) * 32) / (d + 8));
      if (c.owner === ship.owner) v >>= 1;
      else if (ctx.atWar(c.owner)) v -= Math.trunc(v / 3);
      else if (ctx.isAlly(c.owner)) v += Math.trunc(v / 3);
      if (v > fScore) {
        fScore = v;
        ferry = c;
      }
    }
    if (ferry && stack.length > 0) return { kind: 'goto', target: ferry.position, tag: 'T' };
    if (stack.length === 0) return { kind: 'hold' };
    const v = otherLandmass(world, ship, ctx);
    if (v) return { kind: 'goto', target: v, tag: 'V' };
    return { kind: 'chooser' };
  }
  // At sea and empty: home to the nearest own coastal city.
  if (atSea && stack.length === 0) {
    let home: City | null = null;
    let bestD = 9999;
    for (const c of world.cities) {
      if (c.owner !== ship.owner || !coastal(world, c)) continue;
      const d = distance(world, here, c.position);
      if (d < bestD) {
        bestD = d;
        home = c;
      }
    }
    if (home) return { kind: 'goto', target: home.position, tag: 'home' };
  }
  return { kind: 'chooser' };
}

/** An ocean square next to a land target, nearest to the ship (ships cannot enter foreign cities). */
function shoreNear(world: World, target: Point, from: Point): Point | null {
  let best: Point | null = null;
  let bestD = 9999;
  for (const off of NEIGHBOUR_OFFSETS) {
    const y = target.y + off.y;
    if (y < 0 || y >= world.rows) continue;
    const x = world.wrapX(target.x + off.x, y);
    if (x === null || world.terrainAt(x, y) !== OCEAN) continue;
    const d = distance(world, from, { x, y });
    if (d < bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

/**
 * A random square on another land mass of at least 17 rated squares with no own city (tag V,
 * VERIFIED shape: the original draws a random square and checks these), tried a few times.
 */
function otherLandmass(world: World, ship: Unit, ctx: ShipContext): Point | null {
  const s = ctx.strategy;
  const here = landmassAt(world, ship.position);
  for (let tries = 0; tries < 24; tries++) {
    const y = ctx.rng.nextInt(world.rows);
    const x = ctx.rng.nextInt(world.widthX2 >> 1) * 2 + (y & 1);
    if (!world.isSquare(x, y) || world.terrainAt(x, y) === OCEAN) continue;
    if (y < 2 || y > world.rows - 3) continue;
    const lm = landmassAt(world, { x, y });
    if (lm === here || lm === 0) continue;
    if (s && (s.citiesOn[lm] ?? 0) !== 0) continue;
    if ((world.landmassStats?.rated[lm] ?? 17) <= 16) continue;
    return { x, y };
  }
  return null;
}

/** Apply a decision to the ship's orders. Returns true when the ship should keep moving this turn. */
export function applyShipDecision(ship: Unit, d: ShipDecision): boolean {
  if (d.kind === 'goto') {
    if (!ship.gotoTarget || ship.gotoTarget.x !== d.target.x || ship.gotoTarget.y !== d.target.y)
      orderGoTo(ship, d.target);
    else ship.order = ship.order ?? 10;
    return true;
  }
  if (d.kind === 'hold') {
    if (ship.order === null) sentry(ship);
    return false;
  }
  return true;
}
