/**
 * Village (hut) outcomes.
 *
 * Specification: docs/engine/rules-units.md, "Huts" — the decision tree is VERIFIED against the
 * original's hut routine (0x00537aa0); the unit types it hands out are indices into the shipped
 * rules and are listed here as read from the executable (names INFERRED from RULES.TXT).
 */
import { distance } from './city.js';
import { researchableAdvances } from './outcome.js';
import { grantAdvance } from './research.js';
import type { Rng } from './rng.js';
import { DOMAIN_GROUND, IMPROVEMENT, type EngineRules } from './rules.js';
import { ROLE_SETTLERS } from './terraform.js';
import { hutAt } from './terrainSpecials.js';
import {
  CITY_CENTRE_INDEX,
  OCEAN,
  SquareFlag,
  type City,
  type Civ,
  type Point,
  type Unit,
  type World,
} from './world.js';

/** Unit-type indices the original hands out, with the advance (index) that unlocks each. */
export const MERCENARY_MOUNTED = {
  base: 15,
  chariot: 16,
  knights: 19,
  elephants: 17,
  crusaders: 18,
  dragoons: 20,
  riflemen: 11,
} as const;
export const MERCENARY_FOOT = { fanatics: 8, musketeers: 7, legion: 5, archers: 4 } as const;
export const HUT_ADVANCES = {
  chivalry: 11,
  polytheism: 64,
  monotheism: 55,
  leadership: 42,
  conscription: 17,
  fundamentalism: 34,
  gunpowder: 35,
  ironWorking: 39,
  invention: 38,
  explosives: 28,
} as const;
/** Barbarian types by terrain: open ground gets the mounted column, rough ground the foot column. */
export const BARBARIAN_TYPES = { mounted: [15, 19, 21, 9], foot: [5, 7, 11, 8] } as const;

export interface HutContext {
  turn: number;
  /** Game year (negative = BC). */
  year: number;
  difficulty: number;
  /** 0 villages only … 3 raging hordes. */
  barbarianActivity: number;
  knownByAnyone: (advance: number) => boolean;
  /** Land value of the hut square (the original's 0x00559162); above 11 allows an advanced tribe. INFERRED default 12. */
  landValue?: number;
  /** AI only: ranked below the leading civilization. */
  rankBelowLeader?: boolean;
  /** Advance that unlocks the third barbarian type (the original reads a rules-derived index). */
  barbarianThirdAdvance?: number;
  nextCityName: () => string;
}

export type HutOutcome =
  | { kind: 'tribe'; city: City }
  | { kind: 'mercenaries'; unit: Unit }
  | { kind: 'gold'; gold: number }
  | { kind: 'barbarians'; units: Unit[] }
  | { kind: 'scrolls'; advance: number }
  | { kind: 'nomads'; unit: Unit }
  | { kind: 'nothing' };

function citiesOnLandmass(world: World, slot: number, mass: number): number {
  return world.cities.filter(
    (c) => c.owner === slot && world.landmass[world.index(c.position.x, c.position.y)] === mass,
  ).length;
}

function nearestOwnCityDistance(world: World, slot: number, p: Point): number {
  let best = 9999;
  for (const c of world.cities)
    if (c.owner === slot) best = Math.min(best, distance(world, p, c.position));
  return best;
}

function unhomedSettlers(world: World, rules: EngineRules, slot: number | null): number {
  return world.units.filter(
    (u) =>
      rules.units[u.type]?.role === ROLE_SETTLERS &&
      u.homeCity === null &&
      (slot === null || u.owner === slot),
  ).length;
}

export function makeUnit(
  world: World,
  type: number,
  owner: number,
  p: Point,
  homeCity: number | null,
): Unit {
  const unit: Unit = {
    id: world.units.reduce((m, u) => Math.max(m, u.id), -1) + 1,
    position: { x: p.x, y: p.y },
    owner,
    type,
    veteran: false,
    hitPointsLost: 0,
    movesSpent: 0,
    fortified: false,
    homeCity,
    order: null,
    workCounter: 0,
    gotoTarget: null,
    lastDirection: null,
    gotoSteps: 0,
  };
  world.units.push(unit);
  return unit;
}

/** Resolve a hut entered by `unit` (which stays where it is). Mutates the world. */
export function enterHut(
  world: World,
  rules: EngineRules,
  rng: Rng,
  civ: Civ,
  unit: Unit,
  ctx: HutContext,
): HutOutcome {
  const type = rules.units[unit.type];
  if (civ.slot === 0 || !type || type.domain !== DOMAIN_GROUND) return { kind: 'nothing' };
  const p = unit.position;
  // A taken hut is marked with the square's suppression bit (the same bit that hides a special).
  world.setFlag(p.x, p.y, SquareFlag.NoSpecial, true);
  const mass = world.landmass[world.index(p.x, p.y)] ?? 0;
  const cities = world.cities.filter((c) => c.owner === civ.slot).length;
  const nearest = nearestOwnCityDistance(world, civ.slot, p);
  let outcome = rng.nextInt(5);
  if (
    (!civ.isHuman || rng.nextInt(3) === 0) &&
    cities !== 0 &&
    citiesOnLandmass(world, civ.slot, mass) === 0 &&
    nearest > 12
  ) {
    outcome = 0;
  }
  for (let guard = 0; guard < 8; guard++) {
    switch (outcome) {
      case 0: {
        if (nearest < 4) {
          outcome = 1;
          continue;
        }
        if (cities === 0 && ctx.turn < 50 && unhomedSettlers(world, rules, null) > 1) {
          outcome = 1;
          continue;
        }
        if ((ctx.landValue ?? 12) <= 11) {
          outcome = 5;
          continue;
        }
        const city = foundTribeCity(world, rules, rng, civ, p, ctx);
        return { kind: 'tribe', city };
      }
      case 1: {
        let mounted: number = MERCENARY_MOUNTED.knights;
        if (!ctx.knownByAnyone(HUT_ADVANCES.chivalry)) {
          mounted = rng.nextInt(3) === 0 ? MERCENARY_MOUNTED.chariot : MERCENARY_MOUNTED.base;
          if (ctx.knownByAnyone(HUT_ADVANCES.polytheism) && rng.nextInt(2) === 1)
            mounted = MERCENARY_MOUNTED.elephants;
        }
        if (ctx.knownByAnyone(HUT_ADVANCES.monotheism)) mounted = MERCENARY_MOUNTED.crusaders;
        if (ctx.knownByAnyone(HUT_ADVANCES.leadership)) mounted = MERCENARY_MOUNTED.dragoons;
        if (ctx.knownByAnyone(HUT_ADVANCES.conscription)) mounted = MERCENARY_MOUNTED.riflemen;
        let foot: number = MERCENARY_FOOT.fanatics;
        if (!ctx.knownByAnyone(HUT_ADVANCES.fundamentalism)) foot = MERCENARY_FOOT.musketeers;
        if (!ctx.knownByAnyone(HUT_ADVANCES.gunpowder)) foot = MERCENARY_FOOT.legion;
        if (!ctx.knownByAnyone(HUT_ADVANCES.ironWorking)) foot = MERCENARY_FOOT.archers;
        const chosen = rng.nextInt(2) === 0 ? mounted : foot;
        const merc = makeUnit(world, chosen, civ.slot, p, null);
        return { kind: 'mercenaries', unit: merc };
      }
      case 2: {
        let gold = 50;
        if (rng.nextInt(3) === 0) gold = rng.nextInt(10) - ctx.difficulty + 2 < 5 ? 25 : 100;
        if (ctx.year > 1000) gold <<= 1;
        civ.treasury += gold;
        return { kind: 'gold', gold };
      }
      case 3: {
        if (nearest < 4 || (cities === 0 && ctx.turn < 50)) {
          outcome = 1;
          continue;
        }
        if (!civ.isHuman && ctx.rankBelowLeader && rng.nextInt(8) < ctx.difficulty) {
          outcome = 0;
          continue;
        }
        let emptyCheck = false;
        if (ctx.barbarianActivity < 3) {
          if (ctx.turn < 30) emptyCheck = true;
          else if (ctx.turn < 50 && rng.nextInt(2) === 0) emptyCheck = true;
        }
        if (emptyCheck && citiesOnLandmass(world, civ.slot, mass) !== 0 && nearest < 24) {
          return { kind: 'nothing' };
        }
        let single = true;
        if (ctx.turn > 49) single = ctx.turn <= 74 && rng.nextInt(2) === 0;
        const units = spawnBarbarians(world, rules, civ, p, ctx, single);
        return { kind: 'barbarians', units };
      }
      case 4: {
        if (ctx.turn === 0 || civ.knownAdvances[HUT_ADVANCES.invention]) {
          outcome = 2;
          continue;
        }
        const options = researchableAdvances(rules, civ).filter((a) => a < 100);
        if (options.length === 0) {
          outcome = 0;
          continue;
        }
        let pick = rng.nextInt(100);
        for (let i = 0; i < 100; i++) {
          const a = (pick + i) % 100;
          if (options.includes(a)) {
            pick = a;
            break;
          }
        }
        if (!options.includes(pick)) pick = options[0] ?? 0;
        grantAdvance(civ, pick, 'other');
        return { kind: 'scrolls', advance: pick };
      }
      case 5: {
        if (ctx.knownByAnyone(HUT_ADVANCES.explosives)) {
          outcome = 2;
          continue;
        }
        if (unhomedSettlers(world, rules, civ.slot) <= cities >> 3) {
          const settlers = makeUnit(world, 0, civ.slot, p, null);
          return { kind: 'nomads', unit: settlers };
        }
        outcome = 4;
        continue;
      }
      default:
        return { kind: 'nothing' };
    }
  }
  return { kind: 'nothing' };
}

function foundTribeCity(
  world: World,
  rules: EngineRules,
  rng: Rng,
  civ: Civ,
  p: Point,
  ctx: HutContext,
): City {
  const improvements = Array<boolean>(Math.max(67, rules.improvements.length)).fill(false);
  if (!world.cities.some((c) => c.owner === civ.slot)) improvements[IMPROVEMENT.palace] = true;
  let size = 1;
  if (ctx.year > 999) {
    size = rng.nextInt(4) + 1;
    improvements[IMPROVEMENT.temple] = true;
    if (rng.nextInt(2) === 0) improvements[IMPROVEMENT.marketplace] = true;
    if (rng.nextInt(3) === 0) improvements[IMPROVEMENT.granary] = true;
    if (rng.nextInt(4) === 0) improvements[IMPROVEMENT.library] = true;
  }
  const city: City = {
    id: world.cities.reduce((m, c) => Math.max(m, c.id), -1) + 1,
    position: { x: p.x, y: p.y },
    owner: civ.slot,
    name: ctx.nextCityName(),
    size,
    improvements,
    foodStored: 0,
    shieldsStored: 0,
    worked: 1 << CITY_CENTRE_INDEX,
    specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
    production: { kind: 'unit', index: 2 },
    inDisorder: false,
    celebrating: false,
    tradeRoutes: [],
  };
  world.cities.push(city);
  return city;
}

function spawnBarbarians(
  world: World,
  rules: EngineRules,
  civ: Civ,
  p: Point,
  ctx: HutContext,
  single: boolean,
): Unit[] {
  const cities = world.cities.filter((c) => c.owner === civ.slot).length;
  const step = Math.max(1, Math.min(4, 4 - cities));
  const out: Unit[] = [];
  const third = ctx.barbarianThirdAdvance;
  const pick = (column: readonly number[]): number => {
    let t = column[0] ?? 0;
    if (ctx.knownByAnyone(51)) t = column[1] ?? t;
    if (third !== undefined && ctx.knownByAnyone(third)) t = column[2] ?? t;
    if (ctx.knownByAnyone(HUT_ADVANCES.fundamentalism)) t = column[3] ?? t;
    return t;
  };
  for (let i = 0; i < 8; i += step) {
    const dir = (ctx.turn + i) % 8;
    const n = world.neighbours(p.x, p.y)[(dir + 1) % 8]; // the original's table starts north-east
    if (!n) continue;
    if (hutAt(world, n.x, n.y) || world.cityAt(n.x, n.y) || world.terrainAt(n.x, n.y) === OCEAN)
      continue;
    const move = rules.terrain[world.terrainAt(n.x, n.y)]?.moveCost ?? 1;
    const type = pick(move < 3 ? BARBARIAN_TYPES.mounted : BARBARIAN_TYPES.foot);
    out.push(makeUnit(world, type, 0, n, null));
    if (single) break;
  }
  return out;
}
