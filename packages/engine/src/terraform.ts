/**
 * Settlers' orders: validation, work progress and completion.
 *
 * Specification: docs/engine/rules-units.md, "Terrain work" — VERIFIED against the original's
 * order validation (0x00535adf) and work routine (0x00497340). Orders are RULES @ORDERS indices.
 */
import { advanceIndex, type EngineRules } from './rules.js';
import { OCEAN, SquareFlag, type Point, type Unit, type World } from './world.js';

/** RULES @ORDERS indices. The save file stores index + 1 (0xFF = none). */
export const ORDER = {
  fortify: 0,
  fortified: 1,
  sleep: 2,
  fortress: 3,
  road: 4,
  irrigation: 5,
  mine: 6,
  transform: 7,
  pollution: 8,
  airbase: 9,
  goTo: 10,
} as const;
export type Order = (typeof ORDER)[keyof typeof ORDER];

export const ROLE_SETTLERS = 5;
/** The original tests unit type 1 for "is Engineers" (double work, may transform). */
export const ENGINEERS_TYPE = 1;

/** Advances the orders need, as indices in the shipped rules. */
export const WORK_ADVANCES = {
  bridgeBuilding: 7,
  construction: 18,
  radio: 66,
  railroad: 67,
  refrigeration: 70,
} as const;

export interface WorkContext {
  knows: (advance: number) => boolean;
}

export type OrderRefusal =
  | 'only-settlers'
  | 'needs-engineers'
  | 'cant-improve'
  | 'already-fortress'
  | 'already-airbase'
  | 'already-railroad'
  | 'already-mine'
  | 'already-farmland'
  | 'no-water'
  | 'no-pollution'
  | 'not-a-work-order'
  | { needsAdvance: number };

export type OrderVerdict = { ok: true } | { ok: false; reason: OrderRefusal };

const WORK_ORDERS: readonly number[] = [
  ORDER.fortress,
  ORDER.road,
  ORDER.irrigation,
  ORDER.mine,
  ORDER.transform,
  ORDER.pollution,
  ORDER.airbase,
];

/** The irrigate / mine / transform column for an order, as the parsed rules carry it. */
type Change = { kind: 'yes' } | { kind: 'no' } | { kind: 'becomes'; terrainIndex: number };
function change(rules: EngineRules, terrain: number, order: number): Change | undefined {
  const t = rules.terrain[terrain];
  if (!t) return undefined;
  if (order === ORDER.irrigation) return t.irrigate;
  if (order === ORDER.mine) return t.mine;
  if (order === ORDER.transform) return t.transformTo;
  return undefined;
}

/** Water for irrigation (VERIFIED): the square or one of its four edge-neighbours is ocean, has a river or is irrigated. */
export function hasWaterSource(world: World, p: Point): boolean {
  const spots: (Point | null)[] = [p, ...world.directNeighbours(p.x, p.y)];
  for (const s of spots) {
    if (!s) continue;
    if (world.terrainAt(s.x, s.y) === OCEAN) return true;
    if (world.hasFlag(s.x, s.y, SquareFlag.River)) return true;
    if (
      world.hasFlag(s.x, s.y, SquareFlag.Irrigation) ||
      world.hasFlag(s.x, s.y, SquareFlag.Farmland)
    ) {
      return true;
    }
  }
  return false;
}

/** May `unit` start `order` where it stands? Mirrors the original's checks and messages. */
export function canOrder(
  world: World,
  rules: EngineRules,
  unit: Unit,
  order: number,
  ctx: WorkContext,
): OrderVerdict {
  const type = rules.units[unit.type];
  if (!type || type.role !== ROLE_SETTLERS) return { ok: false, reason: 'only-settlers' };
  if (!WORK_ORDERS.includes(order)) return { ok: false, reason: 'not-a-work-order' };
  const { x, y } = unit.position;
  const city = world.cityAt(x, y) !== undefined;
  const water = world.terrainAt(x, y) === OCEAN;
  const has = (f: number) => world.hasFlag(x, y, f);
  const fortress = has(SquareFlag.Fortress) && !has(SquareFlag.Airbase);
  const no = (reason: OrderRefusal): OrderVerdict => ({ ok: false, reason });

  if (order === ORDER.airbase) {
    if (!ctx.knows(WORK_ADVANCES.radio)) return no({ needsAdvance: WORK_ADVANCES.radio });
    if (city || fortress || water) return no('cant-improve');
    if (has(SquareFlag.Airbase)) return no('already-airbase');
  }
  if (order === ORDER.fortress) {
    if (!ctx.knows(WORK_ADVANCES.construction))
      return no({ needsAdvance: WORK_ADVANCES.construction });
    if (city || water) return no('cant-improve');
    if (fortress) return no('already-fortress');
  }
  if (order === ORDER.road) {
    if (city || water) return no('cant-improve');
    if (has(SquareFlag.River) && !ctx.knows(WORK_ADVANCES.bridgeBuilding)) {
      return no({ needsAdvance: WORK_ADVANCES.bridgeBuilding });
    }
    if (has(SquareFlag.Railroad)) return no('already-railroad');
    if (has(SquareFlag.Road) && !ctx.knows(WORK_ADVANCES.railroad)) {
      return no({ needsAdvance: WORK_ADVANCES.railroad });
    }
  }
  if (order === ORDER.irrigation || order === ORDER.mine) {
    const c = change(rules, world.terrainAt(x, y), order);
    if (c && c.kind !== 'becomes') {
      if (c.kind === 'no') return no('cant-improve');
      if (city) return no('cant-improve');
      if (order === ORDER.mine) {
        if (has(SquareFlag.Mine) && !has(SquareFlag.Farmland)) return no('already-mine');
      } else {
        if (!hasWaterSource(world, unit.position)) return no('no-water');
        if (has(SquareFlag.Farmland)) return no('already-farmland');
        if (has(SquareFlag.Irrigation) && !ctx.knows(WORK_ADVANCES.refrigeration)) {
          return no({ needsAdvance: WORK_ADVANCES.refrigeration });
        }
      }
    }
  }
  if (order === ORDER.transform) {
    if (water) return no('cant-improve');
    if (unit.type !== ENGINEERS_TYPE) return no('needs-engineers');
    const c = change(rules, world.terrainAt(x, y), order);
    if (!c || c.kind === 'no') return no('cant-improve');
  }
  if (order === ORDER.pollution && !has(SquareFlag.Pollution)) return no('no-pollution');
  return { ok: true };
}

/** Work-counter value that completes `order` on the unit's square (VERIFIED table). */
export function workTurns(world: World, rules: EngineRules, unit: Unit, order: number): number {
  const { x, y } = unit.position;
  const terrain = rules.terrain[world.terrainAt(x, y)];
  const move = terrain?.moveCost ?? 1;
  switch (order) {
    case ORDER.fortress:
      return Math.trunc(move / 2) + 3;
    case ORDER.road: {
      let t = (world.hasFlag(x, y, SquareFlag.Road) ? 4 : 2) * move;
      if (world.hasFlag(x, y, SquareFlag.River)) t += 2;
      return t;
    }
    case ORDER.irrigation:
      return terrain?.irrigateTurns ?? 5;
    case ORDER.mine:
      return terrain?.mineTurns ?? 10;
    case ORDER.transform:
      return move * (rules.cosmic.transformBaseTurns ?? 20);
    case ORDER.pollution:
    case ORDER.airbase:
      return 4;
    default:
      return 1;
  }
}

export type WorkEvent =
  | { kind: 'working'; order: number; progress: number; needed: number }
  | { kind: 'completed'; order: number; terrainChangedTo?: number };

/**
 * Run the work routine for `unit` with `order` (VERIFIED): sets the order, pools a stacked
 * settler's progress, adds this unit's effort (2 for Engineers), and completes when due.
 * The original calls this once when the order is given and again at the start of each turn.
 */
export function doWork(
  world: World,
  rules: EngineRules,
  unit: Unit,
  order: number,
  ctx: WorkContext,
  pollutionCount?: { value: number },
): WorkEvent {
  const needed = workTurns(world, rules, unit, order);
  unit.order = order;
  unit.fortified = false;
  const { x, y } = unit.position;
  const partner = world
    .unitsAt(x, y)
    .find((u) => u !== unit && rules.units[u.type]?.role === ROLE_SETTLERS && u.order === order);
  if (partner) {
    unit.workCounter += partner.workCounter;
    partner.workCounter = 0;
  }
  unit.workCounter += unit.type === ENGINEERS_TYPE ? 2 : 1;
  if (unit.workCounter < needed) {
    return { kind: 'working', order, progress: unit.workCounter, needed };
  }
  for (const u of world.unitsAt(x, y)) {
    if (rules.units[u.type]?.role === ROLE_SETTLERS && u.order === order) {
      u.workCounter = 0;
      u.order = null;
    }
  }
  const changedTo = completeWork(world, rules, unit.position, order, ctx, pollutionCount);
  return changedTo === null
    ? { kind: 'completed', order }
    : { kind: 'completed', order, terrainChangedTo: changedTo };
}

/** Apply the finished job to the square (VERIFIED effects). Returns the new terrain when it changed. */
export function completeWork(
  world: World,
  rules: EngineRules,
  p: Point,
  order: number,
  ctx: WorkContext,
  pollutionCount?: { value: number },
): number | null {
  const { x, y } = p;
  const has = (f: number) => world.hasFlag(x, y, f);
  const set = (f: number, on = true) => world.setFlag(x, y, f, on);
  const city = world.cityAt(x, y) !== undefined;
  switch (order) {
    case ORDER.fortress:
      if (!city) {
        set(SquareFlag.Fortress);
        set(SquareFlag.Airbase, false);
      }
      return null;
    case ORDER.road:
      if (!has(SquareFlag.Road) && !city) set(SquareFlag.Road);
      else if (ctx.knows(WORK_ADVANCES.railroad)) {
        set(SquareFlag.Road);
        set(SquareFlag.Railroad);
      }
      return null;
    case ORDER.irrigation:
    case ORDER.mine: {
      const c = change(rules, world.terrainAt(x, y), order);
      if (!c || c.kind === 'no') return null;
      if (c.kind === 'yes') {
        if (order === ORDER.mine) {
          set(SquareFlag.Irrigation, false);
          set(SquareFlag.Farmland, false);
          set(SquareFlag.Mine);
        } else if (!has(SquareFlag.Irrigation) && !has(SquareFlag.Farmland)) {
          set(SquareFlag.Mine, false);
          set(SquareFlag.Irrigation);
        } else if (ctx.knows(WORK_ADVANCES.refrigeration)) {
          set(SquareFlag.Irrigation);
          set(SquareFlag.Farmland);
        }
        return null;
      }
      return becomeTerrain(world, rules, p, c.terrainIndex);
    }
    case ORDER.transform: {
      const c = change(rules, world.terrainAt(x, y), order);
      if (!c || c.kind !== 'becomes') return null;
      return becomeTerrain(world, rules, p, c.terrainIndex);
    }
    case ORDER.pollution:
      if (has(SquareFlag.Pollution)) {
        set(SquareFlag.Pollution, false);
        if (pollutionCount) pollutionCount.value -= 1;
      }
      return null;
    case ORDER.airbase:
      if (!city) {
        set(SquareFlag.Fortress);
        set(SquareFlag.Airbase);
      }
      return null;
    default:
      return null;
  }
}

/** Change a square's terrain and drop improvements the new terrain cannot carry (VERIFIED). */
function becomeTerrain(world: World, rules: EngineRules, p: Point, terrain: number): number {
  const { x, y } = p;
  world.terrain[world.index(x, y)] = terrain;
  const t = rules.terrain[terrain];
  if (
    t?.irrigate.kind !== 'yes' &&
    (world.hasFlag(x, y, SquareFlag.Irrigation) || world.hasFlag(x, y, SquareFlag.Farmland))
  ) {
    world.setFlag(x, y, SquareFlag.Irrigation, false);
    world.setFlag(x, y, SquareFlag.Farmland, false);
  }
  if (
    t?.mine.kind !== 'yes' &&
    world.hasFlag(x, y, SquareFlag.Mine) &&
    !world.hasFlag(x, y, SquareFlag.Farmland)
  ) {
    world.setFlag(x, y, SquareFlag.Mine, false);
  }
  return terrain;
}

/** Advance index a work refusal asks for, if any. */
export function refusalAdvance(v: OrderVerdict): number | null {
  if (v.ok || typeof v.reason === 'string') return null;
  return v.reason.needsAdvance;
}

export { advanceIndex };
