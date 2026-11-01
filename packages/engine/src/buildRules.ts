/**
 * What can be built, and where: the original's tests for improvements (0x00494938, wonders
 * 0x00494862) and units (0x004943e4). VERIFIED. docs/engine/rules-city.md, "What can be built".
 */
import { advanceIndex, IMPROVEMENT, type EngineRules } from './rules.js';
import { OCEAN, SquareFlag, type City, type Civ, type World } from './world.js';

const MUSKETEERS = 7;
const FANATICS = 8;
const GUNPOWDER = 35;
const KNIGHTS = 19;
const ROCKETRY = 58;
const WONDER = 39;

const I = {
  library: 6,
  marketplace: 5,
  granary: 3,
  courthouse: 7,
  aqueduct: 9,
  bank: 10,
  cathedral: 11,
  university: 12,
  factory: 15,
  manufacturing: 16,
  power: 19,
  hydro: 20,
  nuclear: 21,
  stock: 22,
  sewer: 23,
  research: 26,
  coastalFortress: 28,
  solar: 29,
  harbor: 30,
  offshore: 31,
  police: 33,
  port: 34,
};

function around(world: World, c: City): { x: number; y: number }[] {
  const out = [{ x: c.position.x, y: c.position.y }];
  for (const n of world.neighbours(c.position.x, c.position.y)) if (n) out.push(n);
  return out;
}

/** City flag bit 7: an ocean square within reach (0x0042e8ff). */
export function cityCoastal(world: World, c: City): boolean {
  return around(world, c).some((p) => world.terrainAt(p.x, p.y) === OCEAN);
}

/** City flag bit 21: the ocean beside it is more than a lake (0x0042e8ff). */
export function citySeaworthy(world: World, c: City): boolean {
  return around(world, c).some((p) => {
    if (world.terrainAt(p.x, p.y) !== OCEAN) return false;
    const id = (world.landmass[world.index(p.x, p.y)] ?? 0) & 63;
    return id >= 63 || (world.landmassStats?.oceans[id] ?? 2) > 1;
  });
}

/** City flag bit 11: a river or mountains in reach, for a Hydro Plant (0x0042e8ff). */
export function cityRiver(world: World, c: City): boolean {
  return around(world, c).some(
    (p) => world.hasFlag(p.x, p.y, SquareFlag.River) || world.terrainAt(p.x, p.y) === 5,
  );
}

export interface BuildContext {
  knows: (advance: number) => boolean;
  ownsWonder: (improvement: number) => boolean;
  wonderBuilt: (improvement: number) => boolean;
  /** The game year is AD (or a scenario is running). */
  afterChrist: boolean;
  bloodlust: boolean;
  launched: boolean;
}

export function canBuildImprovementAt(
  world: World,
  rules: EngineRules,
  city: City,
  imp: number,
  ctx: BuildContext,
): boolean {
  const rule = rules.improvements[imp];
  if (!rule || imp === 0 || rule.preq?.kind === 'never') return false;
  const pre = advanceIndex(rule.preq);
  if (pre !== null && !ctx.knows(pre)) return false;
  if (imp >= WONDER) return !ctx.wonderBuilt(imp);
  const has = (i: number) => city.improvements[i] === true;
  const after = (i: number) => {
    const p = advanceIndex(rules.improvements[i]?.preq);
    return has(i) && (p === null || ctx.knows(p));
  };
  if (has(imp)) return false;
  if ((imp === I.harbor || imp === I.offshore) && !cityCoastal(world, city)) return false;
  if (
    (imp === I.port || imp === I.coastalFortress) &&
    !(citySeaworthy(world, city) && cityCoastal(world, city))
  )
    return false;
  if (imp === I.granary && ctx.ownsWonder(IMPROVEMENT.pyramids)) return false;
  if (imp === I.cathedral && ctx.ownsWonder(IMPROVEMENT.michelangelos)) return false;
  if (imp === I.courthouse && has(IMPROVEMENT.palace)) return false;
  if (imp === I.bank && !after(I.marketplace)) return false;
  if (imp === I.stock && !after(I.bank)) return false;
  if (imp === I.university && !after(I.library)) return false;
  if (imp === I.research && (ctx.ownsWonder(WONDER + 26) || !after(I.university))) return false;
  if (imp === I.sewer && !has(I.aqueduct)) return false;
  if (imp === I.police && ctx.ownsWonder(IMPROVEMENT.womensSuffrage)) return false;
  if (imp === I.manufacturing && !after(I.factory)) return false;
  if (imp === I.hydro && !cityRiver(world, city)) return false;
  if (imp === I.power || imp === I.hydro || imp === I.solar || imp === I.nuclear) {
    if (!has(I.factory) && !has(I.manufacturing)) return false;
    if (imp !== I.solar) {
      if (ctx.ownsWonder(IMPROVEMENT.hooverDam) || has(I.power) || has(I.solar)) return false;
      if (has(I.nuclear) && imp !== I.power) return false;
    }
  }
  if (imp >= 35 && imp <= 37) {
    if (ctx.bloodlust || !ctx.wonderBuilt(IMPROVEMENT.apolloProgram)) return false;
    if (!ctx.afterChrist || ctx.launched) return false;
  }
  return true;
}

/** Facts the unit test needs beyond the rules. */
export interface UnitBuildContext {
  world: World;
  city?: City;
  manhattanBuilt: boolean;
}

export function canBuildUnitType(
  rules: EngineRules,
  civ: Civ,
  type: number,
  ctx?: UnitBuildContext,
): boolean {
  const u = rules.units[type];
  if (!u || u.preq?.kind === 'never') return false;
  const known = (a: number | null) => a !== null && civ.knownAdvances[a] === true;
  const pre = advanceIndex(u.preq);
  if (pre !== null && !known(pre)) return false;
  if (known(advanceIndex(u.obsoleteWith))) return false;
  if (u.role === 1 && known(GUNPOWDER) && u.defence < (rules.units[MUSKETEERS]?.defence ?? 0))
    return false;
  const two = u.move === 2;
  const knights = rules.units[KNIGHTS];
  if (
    u.role === 0 &&
    two &&
    knights &&
    u.attack <= knights.attack &&
    u.defence < knights.defence &&
    known(advanceIndex(knights.preq))
  )
    return false;
  if (u.attack >= 99 && ctx && !(ctx.manhattanBuilt && known(ROCKETRY))) return false;
  if (
    ctx?.city &&
    u.domain === 2 &&
    !(citySeaworthy(ctx.world, ctx.city) && cityCoastal(ctx.world, ctx.city))
  )
    return false;
  if (!civ.isHuman && u.domain === 0 && u.move > 1) {
    for (const [i, o] of rules.units.entries()) {
      if (i === type || o.role !== u.role || o.domain !== u.domain || o.move <= 1) continue;
      if (!known(advanceIndex(o.preq))) continue;
      if (u.attack > o.attack || u.defence > o.defence) continue;
      if (u.attack !== o.attack || u.defence !== o.defence) return false;
    }
  }
  if (type === FANATICS && civ.government !== 4) return false;
  return true;
}
