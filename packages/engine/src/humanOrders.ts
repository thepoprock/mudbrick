/**
 * Orders only a human gives: buying, selling, tax rates, moving workers, airlift, paradrop, home
 * cities. Specification: docs/engine/human-orders.md.
 */
import { gridDistance } from './city.js';
import type { Rng } from './rng.js';
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
const ROLE_AIR_SUPERIORITY = 3;

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
 * A click on a city's map (VERIFIED 0x004c8b01). The centre clears every worker and specialist so
 * the placement starts over. A worked square becomes a specialist. A free square takes a
 * specialist back, or with none starts over; a blocked square does nothing. The caller re-runs the
 * placement. Specialists are a list in the original and a count here, so the one sent back to work
 * is an entertainer first (INFERRED: the original drops the last in its list).
 */
export function citySquareClick(city: City, square: number, blocked: boolean): boolean {
  const sp = city.specialists;
  const restart = () => {
    city.worked = 0;
    sp.entertainers = 0;
    sp.taxCollectors = 0;
    sp.scientists = 0;
  };
  if (square === CITY_CENTRE_INDEX) {
    restart();
    return true;
  }
  if (square < 0 || square > CITY_CENTRE_INDEX) return false;
  const bit = 1 << square;
  if ((city.worked & bit) !== 0) {
    city.worked &= ~bit;
    sp.entertainers += 1;
    return true;
  }
  if (blocked) return false;
  if (sp.entertainers > 0) sp.entertainers -= 1;
  else if (sp.taxCollectors > 0) sp.taxCollectors -= 1;
  else if (sp.scientists > 0) sp.scientists -= 1;
  else {
    restart();
    return true;
  }
  city.worked |= bit;
  return true;
}

/**
 * A click on a specialist (VERIFIED 0x004c8059): entertainer, tax collector, scientist and round.
 * Below size 5 the others turn back into entertainers and an entertainer stays one (ELVISERR).
 */
export function cycleSpecialist(city: City, kind: 0 | 1 | 2): boolean {
  const sp = city.specialists;
  const names = ['entertainers', 'taxCollectors', 'scientists'] as const;
  const from = names[kind];
  if (sp[from] <= 0) return false;
  if (city.size < 5) {
    if (kind === 0) return false;
    sp[from] -= 1;
    sp.entertainers += 1;
    return true;
  }
  const to = names[(kind + 1) % 3] ?? 'entertainers';
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

/** Enemy fighters that could reach either end (VERIFIED 0x005373fc): veterans count twice. */
export function airliftThreat(
  world: World,
  rules: EngineRules,
  unit: Unit,
  to: City,
  atWar: (owner: number) => boolean,
): { count: number; owner: number | null } {
  const from = world.cityAt(unit.position.x, unit.position.y);
  let count = 0;
  let owner: number | null = null;
  for (const f of world.units) {
    const t = rules.units[f.type];
    if (f.owner === unit.owner || t?.role !== ROLE_AIR_SUPERIORITY || !atWar(f.owner)) continue;
    const reachFrom = from ? gridDistance(world, from.position, f.position) : 99;
    if (t.move < reachFrom && t.move < gridDistance(world, to.position, f.position)) continue;
    owner = f.owner;
    count += f.veteran ? 2 : 1;
  }
  return { count, owner };
}

/**
 * Fly the unit (0x0049d26b): both cities are used for this turn, and each point of threat has one
 * chance in six of shooting it down. True when it arrives.
 */
export function airlift(world: World, rng: Rng, unit: Unit, to: City, threat: number): boolean {
  const from = world.cityAt(unit.position.x, unit.position.y);
  if (!from || to.airlifted) return false;
  from.airlifted = true;
  to.airlifted = true;
  unit.position = { x: to.position.x, y: to.position.y };
  unit.order = null;
  unit.movesSpent = 255;
  for (let i = 0; i < threat; i++) {
    if (rng.nextInt(6) === 0) {
      world.units.splice(world.units.indexOf(unit), 1);
      return false;
    }
  }
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
  if (unit.movesSpent !== 0 || unit.dropped) return 'moved';
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
