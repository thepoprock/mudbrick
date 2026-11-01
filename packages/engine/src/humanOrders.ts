/**
 * Orders only a human gives: buying, selling, tax rates, moving workers, airlift, paradrop, home
 * cities. Specification: docs/engine/human-orders.md.
 */
import { gridDistance } from './city.js';
import { IMPROVEMENT, type EngineRules } from './rules.js';
import {
  CITY_CENTRE_INDEX,
  SquareFlag,
  type City,
  type Civ,
  type Unit,
  type World,
} from './world.js';

const CAPITALIZATION = 38;

/** The highest rate a government allows, in tenths (VERIFIED 0x00405230). */
export function maxRate(government: number): number {
  if (government < 2) return 6;
  if (government === 2) return 7;
  if (government < 6) return 8;
  return 10;
}

/**
 * Set tax and science in tenths; the rest is luxuries (VERIFIED 0x00406284): nothing may pass the
 * government's limit, and what doesn't fit moves to tax, then science.
 */
export function setRates(civ: Civ, tax: number, science: number): void {
  const max = maxRate(civ.government);
  let t = Math.max(0, Math.min(max, tax));
  let s = Math.max(0, Math.min(max, science));
  while (t + s > 10) {
    if (s > 0) s -= 1;
    else t -= 1;
  }
  while (10 - t - s > max) {
    if (t < max) t += 1;
    else s += 1;
  }
  civ.taxRate = t;
  civ.scienceRate = s;
}

/** What it costs to finish the production box, or null when it cannot be bought (0x004d0358). */
export function buyCost(rules: EngineRules, city: City): number | null {
  const p = city.production;
  if (p.kind === 'improvement' && p.index === CAPITALIZATION) return null;
  const rows =
    p.kind === 'unit'
      ? (rules.units[p.index]?.costRows ?? 1)
      : (rules.improvements[p.index]?.costRows ?? 1);
  const left = Math.min(999, Math.max(0, rows * rules.cosmic.shieldBoxRows - city.shieldsStored));
  let gold: number;
  if (p.kind === 'unit') gold = Math.trunc((left * left) / 20) + left * 2;
  else gold = left * (p.index > 34 ? 4 : 2);
  if (city.shieldsStored === 0) gold *= 2;
  return gold;
}

export type BuyRefusal = 'capitalization' | 'disorder' | 'gold';

/** Buy the production. A unit cannot be bought in a city in disorder (the COMPLETE2 text). */
export function buyProduction(rules: EngineRules, civ: Civ, city: City): BuyRefusal | null {
  const gold = buyCost(rules, city);
  if (gold === null) return 'capitalization';
  if (city.production.kind === 'unit' && city.inDisorder) return 'disorder';
  if (gold > civ.treasury) return 'gold';
  civ.treasury -= gold;
  const p = city.production;
  const rows =
    p.kind === 'unit'
      ? (rules.units[p.index]?.costRows ?? 1)
      : (rules.improvements[p.index]?.costRows ?? 1);
  city.shieldsStored = rows * rules.cosmic.shieldBoxRows;
  return null;
}

/** Sell one improvement, one a turn per city, never the Palace (VERIFIED 0x004cc57d). */
export function sellImprovement(
  rules: EngineRules,
  civ: Civ,
  city: City,
  improvement: number,
): 'palace' | 'sold-already' | 'none' | null {
  if (city.soldThisTurn) return 'sold-already';
  if (improvement === IMPROVEMENT.palace) return 'palace';
  if (improvement < 1 || improvement > 38 || !city.improvements[improvement]) return 'none';
  city.improvements[improvement] = false;
  civ.treasury += (rules.improvements[improvement]?.costRows ?? 0) * rules.cosmic.shieldBoxRows;
  city.soldThisTurn = true;
  return null;
}

/**
 * A click on a radius square: a worked square frees its citizen as an entertainer, a free square
 * takes a specialist back to work. INFERRED: the click handler has not been found, this is the
 * documented behaviour with the worked-square mask the rest of the engine uses.
 */
export function toggleWorker(city: City, square: number): boolean {
  if (square < 0 || square >= CITY_CENTRE_INDEX) return false;
  const bit = 1 << square;
  const sp = city.specialists;
  if ((city.worked & bit) !== 0) {
    city.worked &= ~bit;
    sp.entertainers += 1;
    return true;
  }
  if (sp.entertainers > 0) sp.entertainers -= 1;
  else if (sp.taxCollectors > 0) sp.taxCollectors -= 1;
  else if (sp.scientists > 0) sp.scientists -= 1;
  else return false;
  city.worked |= bit;
  return true;
}

/** Entertainer to tax collector to scientist and round. INFERRED order; size 5 needed for the
 * others is the documented rule. */
export function cycleSpecialist(city: City, kind: 0 | 1 | 2): boolean {
  const sp = city.specialists;
  if (city.size < 5) return false;
  const names = ['entertainers', 'taxCollectors', 'scientists'] as const;
  const from = names[kind];
  const to = names[(kind + 1) % 3] ?? 'entertainers';
  if (sp[from] <= 0) return false;
  sp[from] -= 1;
  sp[to] += 1;
  return true;
}

/** Cities a land unit could be airlifted to, or the reason it cannot go (VERIFIED 0x005373fc). */
export function airliftTargets(
  world: World,
  rules: EngineRules,
  unit: Unit,
): { targets: City[] } | { refused: 'ship' | 'plane' | 'no-airport' | 'used' | 'no-other' } {
  const domain = rules.units[unit.type]?.domain;
  if (domain === 2) return { refused: 'ship' };
  if (domain === 1) return { refused: 'plane' };
  const from = world.cityAt(unit.position.x, unit.position.y);
  if (!from || !from.improvements[IMPROVEMENT.airport]) return { refused: 'no-airport' };
  if (from.airlifted) return { refused: 'used' };
  const targets = world.cities.filter(
    (c) => c.owner === unit.owner && c !== from && c.improvements[IMPROVEMENT.airport],
  );
  if (targets.length === 0) return { refused: 'no-other' };
  return { targets };
}

/** Fly the unit (0x0049d26b): both cities are used for this turn. */
export function airlift(world: World, unit: Unit, to: City): boolean {
  const from = world.cityAt(unit.position.x, unit.position.y);
  if (!from || to.airlifted) return false;
  from.airlifted = true;
  to.airlifted = true;
  unit.position = { x: to.position.x, y: to.position.y };
  unit.order = null;
  unit.movesSpent = 255;
  return true;
}

export type ParadropRefusal = 'moved' | 'not-from-base' | 'ocean' | 'enemy' | 'range';

/** Can the unit drop on (x, y)? VERIFIED 0x00536a8b, 0x0049d43c. Capture is left to the caller. */
export function paradropCheck(
  world: World,
  unit: Unit,
  x: number,
  y: number,
  range: number,
): ParadropRefusal | null {
  if (unit.movesSpent !== 0 || unit.moved) return 'moved';
  const { x: ux, y: uy } = unit.position;
  if (!world.cityAt(ux, uy) && !world.hasFlag(ux, uy, SquareFlag.Airbase)) return 'not-from-base';
  if (!world.isLand(x, y)) return 'ocean';
  if (world.unitsAt(x, y).some((u) => u.owner !== unit.owner)) return 'enemy';
  if (gridDistance(world, unit.position, { x, y }) > range) return 'range';
  return null;
}

/** Set the unit's home to the city it stands in (the SETHOMECITY rule). */
export function setHomeCity(world: World, unit: Unit): City | null {
  const city = world.cityAt(unit.position.x, unit.position.y);
  if (!city || city.owner !== unit.owner) return null;
  unit.homeCity = city.id;
  return city;
}
