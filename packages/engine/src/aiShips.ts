/**
 * The computer's ships.
 *
 * Transports follow the move handler's transport block (0x004f44cc, VERIFIED decode in
 * docs/engine/ai-units.md "Transports"): in port with room they pick an own coastal city on
 * another land mass short of units (the wanted number 0x004f266b), post gathering objectives at
 * the port and sail; loaded, they head for an enemy city they may attack, an own coastal city
 * short of units, or any enemy city by trade and distance, and unload where the cargo's land is
 * wanted; without a destination they ferry to a foreign city, a random other land mass, or
 * wander. All of it follows the decode. Warships use the direction chooser like ground
 * units.
 */
import { addObjective, objectiveAt, type CivStrategy } from './aiStrategy.js';
import { distance } from './city.js';
import { hasTreaty, TREATY } from './diplomacy.js';
import { CITY_SPACING_OFFSETS } from './fertility.js';
import { orderGoTo, sentry } from './orders.js';
import { DOMAIN_GROUND, type EngineRules } from './rules.js';
import { NEIGHBOUR_OFFSETS, OCEAN, type City, type Point, type Unit, type World } from './world.js';

const ROLE_TRANSPORT = 4;
const PLAN_DEFEND = 1;
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
  /** The civilization ranked first (0x005da851). */
  leader?: number;
  cityTrade: (city: City) => number;
}

export type ShipDecision =
  | { kind: 'hold' }
  | { kind: 'goto'; target: Point; tag: string }
  | { kind: 'chooser' }
  /** The ship ends its move and wakes cargo of these roles (a mask), or just the first. */
  | { kind: 'unload'; roles: number; first: boolean };

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
  const stack = world
    .unitsAt(here.x, here.y)
    .filter(
      (u) => u !== ship && u.owner === ship.owner && rules.units[u.type]?.domain === DOMAIN_GROUND,
    );
  const aboard = stack.filter((u) => u.aboard === ship.id);
  const atSea = world.terrainAt(here.x, here.y) === OCEAN;
  const holds = type.holds ?? 0;

  // A loaded transport.
  const loaded = atSea ? stack.length > 0 : aboard.length > 0 || stack.length >= holds;
  if (loaded && (atSea || stack.length > 0)) {
    if (atSea) {
      const landing = unloadDecision(world, rules, ship, stack, ctx);
      if (landing) return landing;
    }
    if (ship.order !== null && ship.gotoTarget)
      return { kind: 'goto', target: ship.gotoTarget, tag: 'keep' };
    return loadedDestination(world, rules, ship, stack, ctx);
  }

  return emptyDestination(world, rules, ship, stack, ctx);
}

/** Post the objectives that gather units for a transport (0x004f44cc). */
function postGathering(
  world: World,
  rules: EngineRules,
  at: Point,
  plan: number,
  priority: number,
  s: CivStrategy,
): void {
  const here = { x: at.x, y: at.y };
  const settlers = world.unitsAt(at.x, at.y).some((u) => rules.units[u.type]?.role === 5);
  if (!settlers && plan !== 5) {
    addObjective(s, { ...here, type: 5, priority });
    addObjective(s, { ...here, type: 21, priority: priority - 1 });
  }
  if (plan !== 1) addObjective(s, { ...here, type: 1, priority });
  if (plan !== 0) addObjective(s, { ...here, type: 0, priority });
  if (plan === 4 || plan === 5) addObjective(s, { ...here, type: 6, priority });
  addObjective(s, { ...here, type: 7, priority: 2 });
}

/**
 * A transport with room (0x004f44cc): tag 3 sails to an own coastal city where units can be
 * collected. A land mass short of units keeps them, unless caravans wait there, so such ports are
 * passed over. With nowhere worth sailing to, a port with enough units gathers them here and the
 * ship waits. Otherwise the ship takes the same chain as a loaded one.
 */
function emptyDestination(
  world: World,
  rules: EngineRules,
  ship: Unit,
  stack: Unit[],
  ctx: ShipContext,
): ShipDecision {
  const me = ship.owner;
  const here = ship.position;
  const s = ctx.strategy;
  const cityHere = world.cityAt(here.x, here.y);
  const inPort = cityHere !== null && cityHere !== undefined && cityHere.owner === me;
  const holds = rules.units[ship.type]?.holds ?? 0;
  if (cityHere) {
    if ((ship.cityStep ?? 0) < 0) ship.cityStep = ctx.turn & 7;
    for (const u of stack) if (u.fortified) delete u.aboard; // release fortified cargo
  }
  if (!cityHere && ship.order !== null && ship.gotoTarget)
    return { kind: 'goto', target: ship.gotoTarget, tag: 'keep' };
  const onlySettlers = stack.length > 0 && stack.every((u) => rules.units[u.type]?.role === 5);
  const hasSettlers = stack.some((u) => rules.units[u.type]?.role === 5);
  const room = stack.length < (cityHere ? Math.min(holds, 3) : 1);
  if (s && room) {
    const ocean = landmassAt(world, here);
    let best = 999;
    let target: City | null = null;
    for (const c of world.cities) {
      if (c.owner !== me || !coastal(world, c)) continue;
      const mine = (ship.cityStep ?? 0) === -1 - (world.cities.indexOf(c) & 0x3f);
      // Set for two passes of the unit routine (0x004ed2dd clears it a bit at a time).
      if (c.ferryDue !== undefined && ctx.turn - c.ferryDue <= 1 && !mine) continue;
      const reach = inPort
        ? oceansBeside(world, cityHere).some((o) => oceansBeside(world, c).includes(o))
        : oceansBeside(world, c).includes(ocean);
      if (!reach) continue;
      const lm = landmassAt(world, c.position);
      const plan = s.plans[lm] ?? 5;
      if ((s.unitsOn[lm] ?? 0) < wantedUnits(s.citiesOn[lm] ?? 0) && plan !== PLAN_FULL) {
        if ((s.caravansOn[lm] ?? 0) === 0) continue;
      }
      let score = distance(world, here, c.position);
      const transports = world
        .unitsAt(c.position.x, c.position.y)
        .filter((u) => u.owner === me && rules.units[u.type]?.role === ROLE_TRANSPORT).length;
      if (transports > (score === 0 ? 1 : 0)) score += 16;
      if (plan === PLAN_FULL || (s.landFlags[lm] ?? 0) === 0) score -= (s.attackOn[lm] ?? 0) >> 2;
      else score += 16;
      if (score < best) {
        best = score;
        target = c;
      }
    }
    if (
      cityHere &&
      (((ship.cityStep ?? 0) ^ ((ctx.turn - 1) & 3)) & 3) !== 0 &&
      (!hasSettlers || onlySettlers || stack.length < holds)
    )
      best = 1000;
    const plan = target ? (s.plans[landmassAt(world, target.position)] ?? 5) : 5;
    const priority = plan === PLAN_FULL ? 4 : 2;
    if (target && best < priority * 3) {
      ship.cityStep = -1 - (world.cities.indexOf(target) & 0x3f);
      target.ferryDue = ctx.turn;
      postGathering(world, rules, target.position, plan, priority, s);
      return { kind: 'goto', target: target.position, tag: '3' };
    }
    if (inPort) {
      const lm = landmassAt(world, here);
      const planHere = s.plans[lm] ?? 5;
      const transportsHere = world
        .unitsAt(here.x, here.y)
        .filter((u) => u.owner === me && rules.units[u.type]?.role === ROLE_TRANSPORT).length;
      const roll = ctx.rng.nextInt(4);
      if (
        transportsHere < 2 &&
        (roll !== 0 || best === 1000) &&
        ((s.landFlags[lm] ?? 0) & 0x10) === 0
      ) {
        const surplus =
          (s.unitsOn[lm] ?? 0) >= wantedUnits(s.citiesOn[lm] ?? 0) || planHere === PLAN_FULL;
        const caravans = (s.caravansOn[lm] ?? 0) !== 0;
        if (surplus || caravans) {
          cityHere.ferryDue = ctx.turn;
          const p = planHere === PLAN_FULL ? 4 : 2;
          if (surplus) postGathering(world, rules, here, planHere, p, s);
          else addObjective(s, { x: here.x, y: here.y, type: 7, priority: 2 });
          return { kind: 'hold' };
        }
      }
    }
  }
  if (stack.length === 0 && !world.cityAt(here.x, here.y)) {
    // At sea and empty: home to the nearest own coastal city.
    let home: City | null = null;
    let bestD = 9999;
    for (const c of world.cities) {
      if (c.owner !== me || !coastal(world, c)) continue;
      const d = distance(world, here, c.position);
      if (d < bestD) {
        bestD = d;
        home = c;
      }
    }
    if (home) return { kind: 'goto', target: home.position, tag: 'home' };
  }
  return loadedDestination(world, rules, ship, stack, ctx);
}

/**
 * The square to land from (0x004ecd74): this one or a free ocean neighbour, the one touching the
 * most free land a human's treaty does not close. Beside a hostile empty city, staying scores 12
 * more. Null means no ocean to stand on; here means stay.
 */
function bestLanding(world: World, ship: Unit, ctx: ShipContext): Point | null {
  const me = ship.owner;
  let best = -1;
  let found: Point | null = null;
  const options = [
    ...world.neighbours(ship.position.x, ship.position.y),
    ship.position as Point | null,
  ];
  for (const [i, p] of options.entries()) {
    const stay = i === options.length - 1;
    if (!p || world.terrainAt(p.x, p.y) !== OCEAN) continue;
    if (!stay && world.unitsAt(p.x, p.y).length > 0) continue;
    let score = 0;
    for (const n of world.neighbours(p.x, p.y)) {
      if (!n || world.terrainAt(n.x, n.y) === OCEAN) continue;
      if (world.unitsAt(n.x, n.y).length > 0) continue;
      const owner = world.territory[world.index(n.x, n.y)] ?? 0;
      if (
        owner > 0 &&
        owner <= 7 &&
        ctx.isHuman(owner) &&
        hasTreaty(world, me, owner, TREATY.ceaseFire | TREATY.peace)
      )
        continue;
      const city = world.cityAt(n.x, n.y);
      if (city && city.owner !== me && hasTreaty(world, me, city.owner, TREATY.war) && stay)
        score += 12;
      score += 1;
    }
    if (best <= score) {
      best = score;
      found = stay ? ship.position : p;
    }
  }
  return found;
}

/**
 * Does a ship at sea land its cargo here (0x004f44cc, tags b, U and u)? For each land neighbour
 * free of foreign units: where units are short, where nobody has settled and the cargo suits,
 * where the go-to was bound, when the ship is badly hurt, or beside a hostile city. Caravans land
 * near a city that wants them. Otherwise null, and the ship sails on.
 */
function unloadDecision(
  world: World,
  rules: EngineRules,
  ship: Unit,
  stack: Unit[],
  ctx: ShipContext,
): ShipDecision | null {
  const s = ctx.strategy;
  const type = rules.units[ship.type];
  if (!s || !type) return null;
  const me = ship.owner;
  const here = ship.position;
  const ocean = landmassAt(world, here);
  const goal = ship.gotoTarget;
  if (ship.order !== null && goal && ship.goalTag === 'A' && (ctx.turn & 15) !== 0) {
    const c = world.cityAt(goal.x, goal.y);
    if (c && coastal(world, c) && oceansBeside(world, c).includes(ocean)) return null;
  }
  let mask = 0;
  for (const u of stack) mask |= 1 << (rules.units[u.type]?.role ?? 0);
  const anyCity = nearestCityOf(world, here, null);
  const ownCity = nearestCityOf(world, here, me);
  const anyDist = anyCity ? distance(world, here, anyCity.position) : 99;
  const ownDist = ownCity ? distance(world, here, ownCity.position) : 99;
  const anyLand = anyCity ? landmassAt(world, anyCity.position) : -1;
  const settlersWithRoom = (mask & 0xff7f) === 0x20 && stack.length < (type.holds ?? 0);
  const onlyCaravans = mask === 0x80;
  const max = type.hitPointsTens * 10;
  const hurt = ship.hitPointsLost > max >> 2;
  const worst = ship.hitPointsLost > max >> 1;
  const planHere = s.plans[ocean] ?? 5;
  for (const n of world.neighbours(here.x, here.y)) {
    if (!n || world.terrainAt(n.x, n.y) === OCEAN) continue;
    const there = world.unitsAt(n.x, n.y);
    const owner = there[0]?.owner;
    if (owner !== undefined && owner !== me) continue;
    if (owner === me && there.length > 1) continue;
    const nearPeace =
      anyCity !== null &&
      anyCity.owner !== me &&
      hasTreaty(world, me, anyCity.owner, TREATY.peace) &&
      anyDist < 4;
    const lm = landmassAt(world, n);
    let carry = false;
    if ((mask & 0x80) === 0) {
      if (nearPeace) continue;
    } else if (anyCity && anyLand === lm) {
      const caravan = stack.find((u) => rules.units[u.type]?.role === 7);
      const home =
        world.cities.find((c) => c.id === caravan?.homeCity) ??
        nearestCityOf(world, n, me) ??
        world.cities[0];
      if (home) {
        const apart = distance(world, anyCity.position, home.position);
        carry = ship.goalTag !== '3';
        if (landmassAt(world, home.position) === anyLand && apart < 16) carry = false;
        if (anyCity.owner === me && (anyCity.size < 8 || apart < 16)) carry = false;
        if (home.tradeRoutes.some((r) => r.partner === anyCity.id)) carry = false;
      }
    }
    const plan = s.plans[lm] ?? 5;
    const units = s.unitsOn[lm] ?? 0;
    const cities = s.citiesOn[lm] ?? 0;
    let land = false;
    let one = false;
    if (units < wantedUnits(cities) && plan !== PLAN_FULL) land = true;
    if (cities === 0 && units < 8) land = true;
    if (((1 << plan) & mask & 3) !== 0) land = true;
    if (
      (mask & 1) !== 0 &&
      anyCity !== null &&
      ownCity !== anyCity &&
      ownDist > 10 &&
      anyDist < 4 &&
      anyLand === lm &&
      ctx.isHuman(anyCity.owner) &&
      hasTreaty(world, me, anyCity.owner, TREATY.war)
    )
      land = true;
    if (ship.order !== null && goal && ship.goalTag !== '3' && landmassAt(world, goal) === lm)
      land = true;
    if ((mask & 0x20) === 0 && (s.landFlags[lm] ?? 0) === 0) {
      if (units === 0 && (world.landmassStats?.land[lm] ?? 0) > 49) {
        s.landFlags[lm] = (s.landFlags[lm] ?? 0) | 0x80;
        one = true;
      } else land = false;
    }
    if (settlersWithRoom && ((s.landFlags[lm] ?? 0) & 5) !== 0) land = false;
    if (hurt || worst) land = true;
    const city = world.cityAt(n.x, n.y);
    if (!settlersWithRoom && city && city.owner !== me) {
      if (hasTreaty(world, me, city.owner, TREATY.war)) land = true;
    }
    if (onlyCaravans) land = false;
    const rows = n.y > 1 && n.y < world.rows - 2;
    if (land && (world.landmassStats?.rated[lm] ?? 17) > 4 && rows) {
      const left = type.move * 3 - ship.movesSpent >= rules.cosmic.roadMoveMultiplier;
      if (left && (anyDist !== 0 || planHere !== 1)) {
        const from = bestLanding(world, ship, ctx);
        if (from && (from.x !== here.x || from.y !== here.y))
          return { kind: 'goto', target: from, tag: 'b' };
      }
      if (plan === 0) addObjective(s, { x: here.x, y: here.y, type: 2, priority: 5 });
      return { kind: 'unload', roles: carry ? mask : mask & ~0x80, first: one };
    }
    if (carry && rows) {
      if (plan === 0) addObjective(s, { x: here.x, y: here.y, type: 2, priority: 5 });
      return { kind: 'unload', roles: nearPeace ? 0x80 : 0x82, first: false };
    }
    if ((ctx.turn & 3) === 0) ship.order = null;
  }
  return null;
}

function nearestCityOf(world: World, from: Point, owner: number | null): City | null {
  let best: City | null = null;
  let bestD = 9999;
  for (const c of world.cities) {
    if (owner !== null && c.owner !== owner) continue;
    const d = distance(world, from, c.position);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * A human's city stands empty (0x004f2495): every loaded computer transport at sea that could reach
 * it this turn, not at peace with the owner, turns for it.
 */
export function rushEmptyCity(world: World, rules: EngineRules, city: City): void {
  for (const u of world.units) {
    const type = rules.units[u.type];
    if (u.owner === 0 || u.owner === city.owner || !type || (type.holds ?? 0) === 0) continue;
    if (world.civs.find((c) => c.slot === u.owner)?.isHuman === true) continue;
    if (hasTreaty(world, u.owner, city.owner, TREATY.peace)) continue;
    if (world.terrainAt(u.position.x, u.position.y) !== OCEAN) continue;
    if (world.unitsAt(u.position.x, u.position.y).length < 2) continue;
    if (distance(world, city.position, u.position) >= type.move * 3) continue;
    orderGoTo(u, city.position);
  }
}

/** Which land masses touch which oceans (the original's table 0x005ead57, read by 0x00559951). */
const shores = new WeakMap<World, Set<number>>();

function landTouchesOcean(world: World, land: number, ocean: number): boolean {
  let table = shores.get(world);
  if (!table) {
    table = new Set<number>();
    for (let i = 0; i < world.area; i++) {
      if ((world.terrain[i] ?? OCEAN) !== OCEAN) continue;
      const p = world.position(i);
      const o = landmassAt(world, p);
      for (const n of world.neighbours(p.x, p.y)) {
        if (n && world.terrainAt(n.x, n.y) !== OCEAN) table.add(landmassAt(world, n) * 64 + o);
      }
    }
    shores.set(world, table);
  }
  return table.has(land * 64 + ocean);
}

function oceansBeside(world: World, c: City): number[] {
  const out: number[] = [];
  for (const n of world.neighbours(c.position.x, c.position.y)) {
    if (n && world.terrainAt(n.x, n.y) === OCEAN) out.push(landmassAt(world, n));
  }
  return out;
}

/**
 * Where a loaded transport goes (0x004f44cc), each step only if the last found nothing:
 * A an own city on a defend land mass, I a human-allied war's undefended city, 4 a foe's land, T a
 * city for a caravan, 5 an own city elsewhere, V or 6 a land mass with no own city.
 * In port, reach is by the port's oceans; at sea, by the ocean the ship is on.
 */
function loadedDestination(
  world: World,
  rules: EngineRules,
  ship: Unit,
  stack: Unit[],
  ctx: ShipContext,
): ShipDecision {
  const me = ship.owner;
  const here = ship.position;
  const s = ctx.strategy;
  const atSea = world.terrainAt(here.x, here.y) === OCEAN;
  const port = world.cityAt(here.x, here.y);
  const inPort = port !== null && port !== undefined && port.owner === me;
  const ocean = atSea ? landmassAt(world, here) : -1;
  const landHere = atSea ? -1 : landmassAt(world, here);
  const cityReach = (c: City) =>
    inPort
      ? oceansBeside(world, port).some((o) => oceansBeside(world, c).includes(o))
      : oceansBeside(world, c).includes(ocean);
  const landReach = (lm: number) =>
    inPort
      ? landmassAt(world, port.position) === lm ||
        oceansBeside(world, port).some((o) => landTouchesOcean(world, lm, o))
      : landTouchesOcean(world, lm, ocean);
  const planOf = (c: City) => s?.plans[landmassAt(world, c.position)] ?? 5;
  const empty = (c: City) => world.unitsAt(c.position.x, c.position.y).length === 0;
  const war = (a: number, b: number) => hasTreaty(world, a, b, TREATY.war);
  const humans = world.civs.filter((c) => c.isHuman && c.slot !== 0);
  const goTo = (c: City, tag: string): ShipDecision => ({
    kind: 'goto',
    target: c.owner === me ? c.position : (shoreNear(world, c.position, here) ?? c.position),
    tag,
  });
  let mask = 0;
  for (const u of stack) mask |= 1 << (rules.units[u.type]?.role ?? 0);
  const holds = rules.units[ship.type]?.holds ?? 0;

  let found: City | null = null;
  if ((mask & 3) !== 0 && holds > 0) {
    let best = 24;
    for (const c of world.cities) {
      if (c.owner !== me || planOf(c) !== PLAN_DEFEND || !cityReach(c)) continue;
      let d = distance(world, here, c.position);
      if (empty(c)) d >>= 1;
      else if (s && objectiveAt(s, c.position, 1)) d -= Math.trunc(d / 3);
      if (d < best) {
        best = d;
        found = c;
      }
    }
    if (found) return goTo(found, 'A');
  }
  if ((mask & 3) !== 0) {
    let best = 999;
    for (const c of world.cities) {
      if (c.owner === me || !war(me, c.owner) || !empty(c) || !cityReach(c)) continue;
      let d = distance(world, here, c.position);
      if (humans.some((h) => hasTreaty(world, me, h.slot, TREATY.alliance) && war(h.slot, c.owner)))
        d >>= 1;
      if (c.coastalFortressKnown) d <<= 1;
      if (d < best) {
        best = d;
        found = c;
        ship.cityStep = world.cities.indexOf(c) & 7;
      }
    }
    if (found) return goTo(found, 'I');
  }
  let ally = -1;
  for (let o = 0; o < 8; o++) {
    if (hasTreaty(world, me, o, TREATY.alliance) && (ctx.isHuman(o) || ally < 0)) ally = o;
  }
  if ((mask & 1) !== 0 || (mask & 0x20) === 0) {
    let best = 999;
    // Only one city in eight is looked at, a different eighth as ship.cityStep moves.
    for (let i = (ship.cityStep ?? ctx.turn) & 7; i < world.cities.length; i += 8) {
      const c = world.cities[i];
      if (!c) continue;
      const o = c.owner;
      if (o === me || hasTreaty(world, me, o, TREATY.alliance)) continue;
      if (hasTreaty(world, me, o, TREATY.peace) && !hasTreaty(world, me, o, TREATY.strain))
        continue;
      if (ctx.leader !== undefined && ctx.isHuman(ctx.leader) && ctx.leader !== me) continue;
      const lm = landmassAt(world, c.position);
      if (lm === landHere || !landReach(lm)) continue;
      let d = distance(world, here, c.position);
      if (ally > 0 && war(ally, o)) d >>= 1;
      if (hasTreaty(world, me, o, TREATY.grudge)) d >>= 1;
      if (war(me, o) && empty(c)) d >>= 1;
      if (c.coastalFortressKnown) d <<= 1;
      if (d < best) {
        best = d;
        found = c;
      }
    }
    if (found) return goTo(found, '4');
  }
  if ((mask & 0x80) !== 0 && holds > 0) {
    let best = -999;
    const caravan = stack.find((u) => rules.units[u.type]?.role === 7);
    const home =
      world.cities.find((c) => c.id === caravan?.homeCity) ??
      nearestOwnCity(world, me, here) ??
      world.cities[0];
    for (const c of home ? world.cities : []) {
      const lm = landmassAt(world, c.position);
      if (lm === landHere || !home) continue;
      if (c.owner === me ? !cityReach(c) : !landReach(lm)) continue;
      let v = distance(world, home.position, c.position);
      if (c.owner === me) v >>= 1;
      if (war(me, c.owner)) v -= Math.trunc(v / 3);
      if (hasTreaty(world, me, c.owner, TREATY.alliance)) v += Math.trunc(v / 3);
      if (ctx.isHuman(c.owner) && ctx.leader === c.owner) v >>= 1;
      v *= ctx.cityTrade(c);
      v = Math.trunc(v / ((distance(world, here, c.position) >> 3) + 1));
      if (v > best) {
        best = v;
        found = c;
      }
    }
    if (found) return goTo(found, 'T');
  }
  {
    let best = 999;
    for (const c of world.cities) {
      if (c.owner !== me) continue;
      let d = distance(world, here, c.position);
      const lm = landmassAt(world, c.position);
      if (d <= 7 || lm === landHere || planOf(c) === PLAN_FULL || !cityReach(c)) continue;
      if ((mask & (1 << planOf(c))) === 0) d <<= 1;
      if (d < best) {
        best = d;
        found = c;
      }
    }
    if (found) return goTo(found, '5');
  }
  if (holds > 0) {
    const noOwnCity = (x: number, y: number) => {
      if (!world.isSquare(x, y) || world.terrainAt(x, y) === OCEAN) return false;
      const lm = landmassAt(world, { x, y });
      return lm !== landHere && (s?.citiesOn[lm] ?? 0) === 0 && landReach(lm);
    };
    // One random square a turn; the go-to keeps it once chosen.
    const y = ctx.rng.nextInt(world.rows);
    const x = ctx.rng.nextInt(world.widthX2 >> 1) * 2 + (y & 1);
    const lm = world.isSquare(x, y) ? landmassAt(world, { x, y }) : 0;
    if (lm > 0 && lm < 63 && (world.landmassStats?.rated[lm] ?? 17) > 16 && noOwnCity(x, y))
      return { kind: 'goto', target: landingSquare(world, ship, { x, y }), tag: 'V' };
    let walk: Point | null = null;
    for (let r = 2; r < 24; r++) {
      const off = NEIGHBOUR_OFFSETS[ctx.rng.nextInt(8)];
      if (!off) continue;
      const y = here.y + off.y * r;
      const x = y >= 0 && y < world.rows ? world.wrapX(here.x + off.x * r, y) : null;
      if (x === null || y <= 1 || y > world.rows - 3) continue;
      if (noOwnCity(x, y)) walk = { x, y };
    }
    if (walk) return { kind: 'goto', target: landingSquare(world, ship, walk), tag: '6' };
  }
  return { kind: 'chooser' };
}

/**
 * The ocean square to sail for when landing near a target (0x004ed0e3): the first of the twenty
 * radius squares on the ship's ocean with land of the target's land mass beside it and no city
 * there; otherwise the target itself.
 */
function landingSquare(world: World, ship: Unit, target: Point): Point {
  const ocean = landmassAt(world, ship.position);
  const land = landmassAt(world, target);
  for (const off of CITY_SPACING_OFFSETS.slice(0, 20)) {
    const y = target.y + off.y;
    const x = y >= 0 && y < world.rows ? world.wrapX(target.x + off.x, y) : null;
    if (x === null || world.terrainAt(x, y) !== OCEAN) continue;
    if (landmassAt(world, { x, y }) !== ocean) continue;
    const beside = world
      .neighbours(x, y)
      .some(
        (n) =>
          n &&
          world.terrainAt(n.x, n.y) !== OCEAN &&
          landmassAt(world, n) === land &&
          !world.cityAt(n.x, n.y),
      );
    if (beside) return { x, y };
  }
  return target;
}

function nearestOwnCity(world: World, me: number, from: Point): City | undefined {
  let best: City | undefined;
  let bestD = 9999;
  for (const c of world.cities) {
    if (c.owner !== me) continue;
    const d = distance(world, from, c.position);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
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

/** Apply a decision to the ship's orders. Returns true when the ship should keep moving this turn. */
export function applyShipDecision(
  world: World,
  rules: EngineRules,
  ship: Unit,
  d: ShipDecision,
): boolean {
  if (d.kind === 'unload') {
    ship.order = null;
    ship.gotoTarget = null;
    delete ship.goalTag;
    ship.movesSpent = (rules.units[ship.type]?.move ?? 0) * 3;
    for (const u of world.unitsAt(ship.position.x, ship.position.y)) {
      if (u === ship || u.owner !== ship.owner) continue;
      if (u.aboard === undefined || ((1 << (rules.units[u.type]?.role ?? 0)) & d.roles) === 0)
        continue;
      delete u.aboard;
      u.order = null;
      if (d.first) break;
    }
    return false;
  }
  if (d.kind === 'goto') {
    if (d.tag !== 'keep') ship.goalTag = d.tag;
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
