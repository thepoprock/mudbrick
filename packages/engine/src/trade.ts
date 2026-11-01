/**
 * Trade routes and caravans.
 *
 * Ported from the original's caravan arrival (0x0053893b), the establish-route routine
 * (0x0042f7a0) with its one-time bonus, the route tables (0x0042f4a1 / 0x0042f43b), the route
 * modifier (0x00468c65), the per-turn route income in the city trade routine (0x004b6359) and
 * the food-route bookkeeping (0x004b6d9c). VERIFIED unless marked INFERRED.
 * docs/engine/rules-trade.md.
 */
import { adjustAttitude, hasTreaty, TREATY } from './diplomacy.js';
import { distance, gridDistance } from './city.js';
import { gotoDirection } from './pathfinding.js';
import { DOMAIN_GROUND, IMPROVEMENT, type EngineRules } from './rules.js';
import {
  NEIGHBOUR_OFFSETS,
  OCEAN,
  SquareFlag,
  type City,
  type Civ,
  type Unit,
  type World,
} from './world.js';

const FREIGHT = 49;
const AIRPORT = 32;
const SUPERHIGHWAYS = 25;
const INVENTION = 38;
const NAVIGATION = 57;
const RAILROAD = 67;
const FLIGHT = 30;
/** A food route (commodity byte 0xFF in the file, −1 in memory). */
export const FOOD_ROUTE = -1;

export interface TradeEvent {
  kind: 'trade';
  text: string;
  city: number;
}

function landmassOf(world: World, p: { x: number; y: number }): number {
  return (world.landmass[world.index(p.x, p.y)] ?? 0) & 63;
}

function cityById(world: World, id: number): City | undefined {
  return world.cities.find((c) => c.id === id);
}

/** The commodities a city offers (positive) or has in use (negative); three signed bytes. */
export function suppliedOf(city: City): Int8Array {
  city.supplied ??= new Int8Array(3).fill(-1);
  return city.supplied;
}

/** The commodities a city asks for (positive) or already receives (negative). */
export function demandedOf(city: City): Int8Array {
  city.demanded ??= new Int8Array(3).fill(-1);
  return city.demanded;
}

/**
 * The route modifier (0x00468c65): 0 unless the cities share a land mass within 22 squares
 * and the path between them (up to 50 steps) stays on roads, passes no other own city and no
 * foreign city or unit that is not an ally; 2 when the whole path is railroad, else 1. The
 * engine walks its own pathfinder (INFERRED equivalence) with a ground unit of the owner.
 */
export function routeModifier(
  world: World,
  rules: EngineRules,
  owner: number,
  a: City,
  b: City,
): number {
  if (landmassOf(world, a.position) !== landmassOf(world, b.position)) return 0;
  if (gridDistance(world, a.position, b.position) >= 23) return 0;
  const groundType = rules.units.findIndex((t) => t.domain === DOMAIN_GROUND && t.move > 0);
  if (groundType < 0) return 0;
  const walker: Unit = {
    id: -1,
    position: { x: a.position.x, y: a.position.y },
    owner,
    type: groundType,
    veteran: false,
    hitPointsLost: 0,
    movesSpent: 0,
    fortified: false,
    homeCity: null,
    order: null,
    workCounter: 0,
    gotoTarget: null,
    lastDirection: null,
    gotoSteps: 0,
  };
  let allRail = true;
  for (let steps = 0; steps < 50; steps++) {
    const dir = gotoDirection(world, rules, walker, b.position, { ignoreOwnUnits: true });
    if (dir === null) return 0;
    const off = NEIGHBOUR_OFFSETS[dir];
    if (!off) return 0;
    const y = walker.position.y + off.y;
    const x = y >= 0 && y < world.rows ? world.wrapX(walker.position.x + off.x, y) : null;
    if (x === null) return 0;
    walker.position = { x, y };
    if (x === b.position.x && y === b.position.y) return allRail ? 2 : 1;
    const city = world.cityAt(x, y);
    if (city && city.owner === owner) return 0;
    if (city && city.owner !== owner && !hasTreaty(world, owner, city.owner, TREATY.alliance))
      return 0;
    const foreign = world.unitsAt(x, y).find((u) => u.owner !== owner);
    if (foreign && !hasTreaty(world, owner, foreign.owner, TREATY.alliance)) return 0;
    if (!world.hasFlag(x, y, SquareFlag.Road) && !world.hasFlag(x, y, SquareFlag.Railroad))
      return 0;
    if (!world.hasFlag(x, y, SquareFlag.Railroad)) allRail = false;
  }
  return 0;
}

/** The modifier with the Airport and Superhighways terms the income rule adds (0x004b6359). */
function incomeModifier(world: World, rules: EngineRules, city: City, partner: City): number {
  let m = routeModifier(world, rules, city.owner, city, partner);
  if (city.improvements[AIRPORT] && partner.improvements[AIRPORT] && m < 2) m = 1;
  if (city.improvements[SUPERHIGHWAYS]) m += 1;
  return m;
}

/**
 * A route's trade each turn (0x004b6359): `(own net trade + partner's trade + 4) / 8`, plus
 * half of that per modifier point, nothing for a food route, halved for a domestic partner.
 * `ownTrade` is the city's trade after corruption and before routes.
 */
export function routeIncome(
  world: World,
  rules: EngineRules,
  city: City,
  route: { partner: number; commodity: number },
  ownTrade: number,
): number {
  const partner = cityById(world, route.partner);
  if (!partner) return 0;
  let income = (ownTrade + (partner.lastTrade ?? 0) + 4) >> 3;
  const m = incomeModifier(world, rules, city, partner);
  if (m !== 0) income += (m * income) >> 1;
  if (route.commodity < 0) income = 0;
  if (partner.owner === city.owner) income >>= 1;
  return income;
}

export function routeIncomeTotal(
  world: World,
  rules: EngineRules,
  city: City,
  ownTrade: number,
): number {
  let total = 0;
  for (const r of city.tradeRoutes)
    total += routeIncome(
      world,
      rules,
      city,
      { partner: r.partner, commodity: r.commodity ?? (r.food ? FOOD_ROUTE : 0) },
      ownTrade,
    );
  return total;
}

/** Food routes into a city (0x004b6d9c): one food per food route from elsewhere. */
export function incomingFoodRoutes(world: World, city: City): number {
  let n = 0;
  for (const c of world.cities) {
    if (c === city) continue;
    for (const r of c.tradeRoutes)
      if (r.partner === city.id && (r.commodity ?? (r.food ? -1 : 0)) < 0) n += 1;
  }
  return n;
}

/** Add a route to a city's table (0x0042f4a1); returns true when the table changed. */
export function addRoute(
  world: World,
  rules: EngineRules,
  a: City,
  b: City,
  commodity: number,
): boolean {
  if (
    a.tradeRoutes.some(
      (r) => r.partner === b.id && (r.commodity ?? (r.food ? -1 : 0)) === commodity,
    )
  )
    return false;
  const entry = { partner: b.id, food: commodity < 0, commodity };
  a.recomputeTrade = true;
  if (a.tradeRoutes.length < 3) {
    a.tradeRoutes.push(entry);
    return true;
  }
  let weakest = 9999;
  let at = -1;
  for (let i = 0; i < a.tradeRoutes.length; i++) {
    const r = a.tradeRoutes[i];
    if (!r) continue;
    const rc = r.commodity ?? (r.food ? -1 : 0);
    if (rc < 0 && commodity < 0) return false;
    const partner = cityById(world, r.partner);
    let value = partner?.lastTrade ?? 0;
    if (partner) {
      let m = routeModifier(world, rules, a.owner, a, partner);
      if (a.improvements[AIRPORT] && partner.improvements[AIRPORT] && m < 2) m = 1;
      if (m !== 0) value += (m * value) >> 1;
      if (partner.owner === a.owner) value >>= 1;
    }
    if (value < weakest) {
      weakest = value;
      at = i;
    }
  }
  if (at >= 0 && weakest <= (b.lastTrade ?? 0)) {
    a.tradeRoutes[at] = entry;
    return true;
  }
  return false;
}

/** Mark supplied and demanded commodities in use by the routes (0x0042c44f, the sign flips). */
export function refreshCommodityUse(world: World, city: City): void {
  const supplied = suppliedOf(city);
  const demanded = demandedOf(city);
  for (let i = 0; i < 3; i++) {
    supplied[i] = Math.abs(supplied[i] ?? 0) * (supplied[i] === -1 ? -1 : 1);
    demanded[i] = Math.abs(demanded[i] ?? 0) * (demanded[i] === -1 ? -1 : 1);
  }
  for (const r of city.tradeRoutes) {
    const c = r.commodity ?? (r.food ? -1 : 0);
    if (c < 0) continue;
    for (let i = 0; i < 3; i++) if (supplied[i] === c) supplied[i] = -c;
    const partner = cityById(world, r.partner);
    const back = partner?.tradeRoutes.find((x) => x.partner === city.id);
    const bc = back ? (back.commodity ?? (back.food ? -1 : 0)) : -1;
    if (bc >= 0) for (let i = 0; i < 3; i++) if (demanded[i] === bc) demanded[i] = -bc;
  }
  for (const u of world.units) {
    if (u.homeCity !== city.id || u.commodity === undefined || u.commodity >= 0x80) continue;
    for (let i = 0; i < 3; i++) if (supplied[i] === u.commodity) supplied[i] = -u.commodity;
  }
}

export interface TradeContext {
  turn: number;
  knows: (slot: number, advance: number) => boolean;
  /** The civilization's current research cost (caps the bonus at two thirds of it). */
  researchCost: (slot: number) => number;
  /** Food box rows for the city's owner (the food caravan adds half a box). */
  foodBoxRows: (slot: number) => number;
  nextInt: (n: number) => number;
}

/**
 * A caravan establishes a trade route (0x0042f7a0). Returns the one-time bonus. The caravan
 * is removed. Food caravans add half a food box instead and open a food route.
 */
export function establishTradeRoute(
  world: World,
  rules: EngineRules,
  unit: Unit,
  city: City,
  ctx: TradeContext,
  events: TradeEvent[],
): number {
  const civ = world.civs.find((c) => c.slot === unit.owner);
  if (!civ) return 0;
  const home =
    (unit.homeCity !== null ? cityById(world, unit.homeCity) : undefined) ??
    nearestCityOf(world, unit.owner, unit.position) ??
    world.cities[0];
  if (!home) return 0;
  const commodity =
    unit.commodity === undefined ? 0 : unit.commodity >= 0x80 ? FOOD_ROUTE : unit.commodity;
  const d = distance(world, city.position, home.position);
  // VERIFIED 0x0042f7a0: distance counts for less on a large map, more on a small one.
  const dist = world.largeMap ? Math.trunc((d * 4) / 5) : world.smallMap ? (d * 5) >> 2 : d;
  let base = Math.trunc((((home.lastTrade ?? 0) + (city.lastTrade ?? 0)) * (dist + 10)) / 24);
  if (landmassOf(world, city.position) !== landmassOf(world, home.position)) base <<= 1;
  if (city.owner === unit.owner) base >>= 1;
  const freight = unit.type === FREIGHT;
  if (freight) base += base >> 1;
  let m = routeModifier(world, rules, unit.owner, city, home);
  if (city.improvements[AIRPORT] && home.improvements[AIRPORT])
    m += landmassOf(world, city.position) === landmassOf(world, home.position) ? 1 : 2;
  if (city.improvements[SUPERHIGHWAYS]) m += 1;
  if (home.improvements[SUPERHIGHWAYS]) m += 1;
  base += (m * base) >> 1;
  let extra = 0;
  switch (commodity) {
    case 3:
    case 5:
    case 8:
    case 10:
      extra = Math.trunc(base / 2);
      break;
    case 9:
    case 11:
    case 12:
    case 13:
      extra = base;
      break;
    case 14:
      extra = Math.trunc((base * 3) / 2);
      break;
    case 15:
      extra = base * 2;
      break;
    default:
      break;
  }
  const demanded = demandedOf(city);
  if (commodity >= 0 && Array.from(demanded).includes(commodity)) base = base * 2 + extra;
  if (ctx.turn < 200 && !ctx.knows(unit.owner, INVENTION) && !ctx.knows(unit.owner, NAVIGATION))
    base <<= 1;
  if (ctx.knows(unit.owner, RAILROAD)) base -= Math.trunc(base / 3);
  if (ctx.knows(unit.owner, FLIGHT)) base -= Math.trunc(base / 3);
  const cap = Math.trunc((ctx.researchCost(unit.owner) * 2) / 3);
  const bonus = Math.max(0, Math.min(cap, base));
  adjustAttitude(world, city.owner, unit.owner, -10);
  adjustAttitude(world, unit.owner, city.owner, -10);
  if (commodity < 0) {
    city.foodStored += Math.trunc(((city.size + 1) * ctx.foodBoxRows(city.owner)) / 2);
    events.push({ kind: 'trade', text: `a food caravan arrives in ${city.name}`, city: city.id });
  } else {
    civ.treasury += bonus;
    civ.scienceStored += bonus;
    events.push({
      kind: 'trade',
      text: `${home.name} opens a trade route with ${city.name}: ${bonus} gold and research`,
      city: city.id,
    });
  }
  const i = world.units.indexOf(unit);
  if (i >= 0) world.units.splice(i, 1);
  addRoute(world, rules, home, city, commodity);
  if (commodity >= 0) {
    // The destination's return route carries the best of what it supplies and the home demands.
    const supplied = suppliedOf(city);
    const homeDemanded = demandedOf(home);
    let best = 0;
    let pick = FOOD_ROUTE;
    for (let s = 0; s < 3; s++) {
      let score = ctx.nextInt(8);
      const raw = supplied[s] ?? 0;
      const cand = raw < 0 ? -raw : raw;
      if (raw >= 0) score += 10;
      if (cand === commodity) continue;
      if (score >= 10 && Array.from(homeDemanded).includes(cand)) score += 10;
      if (score >= best) {
        best = score;
        pick = cand;
      }
    }
    addRoute(world, rules, city, home, pick);
  }
  refreshCommodityUse(world, home);
  refreshCommodityUse(world, city);
  return bonus;
}

/** A caravan adds its cost in shields to a wonder under construction (0x0053893b). */
export function helpWonder(
  world: World,
  rules: EngineRules,
  unit: Unit,
  city: City,
  events: TradeEvent[],
): boolean {
  if (city.production.kind !== 'improvement' || city.production.index < 39) return false;
  const gift = (rules.units[unit.type]?.costRows ?? 5) * rules.cosmic.shieldBoxRows;
  city.shieldsStored += gift;
  const i = world.units.indexOf(unit);
  if (i >= 0) world.units.splice(i, 1);
  events.push({
    kind: 'trade',
    text: `a caravan adds ${gift} shields to the wonder in ${city.name}`,
    city: city.id,
  });
  return true;
}

function nearestCityOf(world: World, slot: number, p: { x: number; y: number }): City | undefined {
  let best: City | undefined;
  let bestD = 9999;
  for (const c of world.cities) {
    if (c.owner !== slot) continue;
    const d = distance(world, p, c.position);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * The AI's caravan destination (the move chooser's role-7 rule, VERIFIED): among cities on the
 * caravan's land mass, `(home trade + target trade) × distance / 24`, halved for own cities,
 * scaled by `(200 − attitude) / 100` for foreign ones, halved when a route to the target
 * exists, times `(5 − routes of the target) / 5`.
 */
export function aiCaravanDestination(
  world: World,
  unit: Unit,
  attitude: (toward: number) => number,
): City | null {
  const home =
    (unit.homeCity !== null ? cityById(world, unit.homeCity) : undefined) ??
    nearestCityOf(world, unit.owner, unit.position);
  if (!home) return null;
  const lm = landmassOf(world, unit.position);
  let best: City | null = null;
  let bestScore = 0;
  for (const c of world.cities) {
    if (c === home || landmassOf(world, c.position) !== lm) continue;
    if (world.terrainAt(c.position.x, c.position.y) === OCEAN) continue;
    let score = Math.trunc(
      (((home.lastTrade ?? 0) + (c.lastTrade ?? 0)) * distance(world, unit.position, c.position)) /
        24,
    );
    if (c.owner === unit.owner) score = Math.trunc(score / 2);
    else score = Math.trunc(((200 - attitude(c.owner)) * score) / 100);
    if (home.tradeRoutes.some((r) => r.partner === c.id)) score = Math.trunc(score / 2);
    score = Math.trunc(((5 - c.tradeRoutes.length) * score) / 5);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

export const TRADE_PALACE = IMPROVEMENT.palace;
export type { Civ as TradeCiv };

/**
 * The Find Commodity search (VERIFIED 0x0041e494, offered with the advance at index 84, 0x0041e8b7):
 * cities the civilization owns or has seen that want the commodity, then its own cities that
 * supply it. A commodity already carried or received reads as negative and is not listed.
 */
export function commoditySearch(
  world: World,
  slot: number,
  commodity: number,
): { wanted: City[]; supplied: City[] } {
  const seen = (c: City) => c.owner === slot || world.isSeen(c.position.x, c.position.y, slot);
  return {
    wanted: world.cities.filter((c) => seen(c) && demandedOf(c).includes(commodity)),
    supplied: world.cities.filter((c) => c.owner === slot && suppliedOf(c).includes(commodity)),
  };
}
