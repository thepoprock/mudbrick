/**
 * Founding and joining cities.
 *
 * Specification: docs/engine/rules-units.md, "Founding and joining a city" — VERIFIED against the
 * original's found-city (0x005352e6), settle (0x00497dbe) and create-city (0x0042e8ff) routines.
 */
import { advanceIndex, IMPROVEMENT, type EngineRules } from './rules.js';
import { ROLE_SETTLERS } from './terraform.js';
import {
  CITY_CENTRE_INDEX,
  OCEAN,
  SquareFlag,
  type City,
  type Civ,
  type Unit,
  type World,
} from './world.js';

export type FoundVerdict =
  | { ok: true; joins: City | null }
  | { ok: false; reason: 'only-settlers' | 'at-sea' | 'adjacent-city' | 'city-full' };

/** May `unit` found a city here, or join the one standing here? */
export function canFoundCity(world: World, rules: EngineRules, unit: Unit): FoundVerdict {
  const type = rules.units[unit.type];
  if (!type || type.role !== ROLE_SETTLERS) return { ok: false, reason: 'only-settlers' };
  const { x, y } = unit.position;
  if (world.terrainAt(x, y) === OCEAN) return { ok: false, reason: 'at-sea' };
  const here = world.cityAt(x, y);
  if (here) {
    return here.size < rules.cosmic.aqueductSize
      ? { ok: true, joins: here }
      : { ok: false, reason: 'city-full' };
  }
  for (const n of world.neighbours(x, y)) {
    if (n && world.cityAt(n.x, n.y)) return { ok: false, reason: 'adjacent-city' };
  }
  return { ok: true, joins: null };
}

/** Initial production of a new city (VERIFIED): the best Defend-role unit per cost the owner can build, later types winning ties. */
export function initialProduction(rules: EngineRules, canBuild: (type: number) => boolean): number {
  let best = 0;
  let bestScore = 0;
  for (let t = 2; t < rules.units.length; t++) {
    const u = rules.units[t];
    if (!u || u.role !== 1 || !canBuild(t)) continue;
    let score = Math.trunc((u.defence * 8) / Math.max(1, u.costRows));
    if (u.flags.doubleDefenceVsHorse) score += 1;
    if (bestScore <= score) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** Default "can build" test: prerequisite known and not obsolete. */
export function canBuildUnit(rules: EngineRules, civ: Civ, type: number): boolean {
  const u = rules.units[type];
  if (!u) return false;
  const pre = advanceIndex(u.preq);
  if (pre !== null && !civ.knownAdvances[pre]) return false;
  const obs = advanceIndex(u.obsoleteWith);
  return !(obs !== null && civ.knownAdvances[obs]);
}

export interface FoundOptions {
  name: string;
  /** Defaults to `canBuildUnit`. */
  canBuild?: (type: number) => boolean;
}

/**
 * Found a city with `unit` (VERIFIED initialisation): size 1, empty stores, the owner's first
 * city gets the Palace, the square loses its improvements, and the unit is consumed.
 */
export function foundCity(
  world: World,
  rules: EngineRules,
  civ: Civ,
  unit: Unit,
  opts: FoundOptions,
): City {
  const { x, y } = unit.position;
  const firstCity = !world.cities.some((c) => c.owner === civ.slot);
  const improvements = Array<boolean>(Math.max(67, rules.improvements.length)).fill(false);
  if (firstCity) improvements[IMPROVEMENT.palace] = true;
  const id = world.cities.reduce((m, c) => Math.max(m, c.id), -1) + 1;
  const canBuild = opts.canBuild ?? ((t: number) => canBuildUnit(rules, civ, t));
  const city: City = {
    id,
    position: { x, y },
    owner: civ.slot,
    name: opts.name,
    size: 1,
    improvements,
    foodStored: 0,
    shieldsStored: 0,
    worked: 1 << CITY_CENTRE_INDEX,
    specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
    production: { kind: 'unit', index: initialProduction(rules, canBuild) },
    inDisorder: false,
    celebrating: false,
    tradeRoutes: [],
  };
  for (const f of [
    SquareFlag.Irrigation,
    SquareFlag.Farmland,
    SquareFlag.Mine,
    SquareFlag.Road,
    SquareFlag.Railroad,
    SquareFlag.Fortress,
    SquareFlag.Airbase,
  ]) {
    world.setFlag(x, y, f, false);
  }
  world.cities.push(city);
  world.units.splice(world.units.indexOf(unit), 1);
  return city;
}

/** Add the settlers to the city (VERIFIED): one citizen, the unit is consumed. */
export function joinCity(world: World, unit: Unit, city: City): void {
  city.size += 1;
  world.units.splice(world.units.indexOf(unit), 1);
}
