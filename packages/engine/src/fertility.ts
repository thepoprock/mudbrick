/**
 * The map's fertility rating (map square byte 5, low nibble), the territory owner (byte 2,
 * bits 5–7) and the AI's land value.
 *
 * VERIFIED from the original: the map maker rates every plains and grassland square 8–15 from
 * the yields of its 21-square radius (0x0040291f); founding a city takes 8 off the rating of the
 * 45 squares around it and claims the 21 radius squares as territory (0x0042e7f6); removing a
 * city gives the 8 back, releases its territory and re-marks the remaining cities (0x004aeab6).
 * Computer settlers found cities on the land value (docs/engine/ai-units.md, "Settlers").
 */
import type { EngineRules } from './rules.js';
import { grasslandShieldAt, specialAt } from './terrainSpecials.js';
import {
  CITY_RADIUS_OFFSETS,
  OCEAN,
  SquareFlag,
  type City,
  type Point,
  type World,
} from './world.js';

const PLAINS = 1;
const GRASSLAND = 2;
const HILLS = 4;

/**
 * The original's 45-entry square table (0x5b2e38/0x5b2e68): the 21 radius squares, then the
 * four squares four steps along the axes, then a ring of twenty at distance three to five.
 */
export const CITY_SPACING_OFFSETS: readonly Point[] = [
  ...CITY_RADIUS_OFFSETS,
  { x: 4, y: 0 },
  { x: -4, y: 0 },
  { x: 0, y: 4 },
  { x: 0, y: -4 },
  { x: 1, y: -5 },
  { x: 2, y: -4 },
  { x: 3, y: -3 },
  { x: 4, y: -2 },
  { x: 5, y: -1 },
  { x: 5, y: 1 },
  { x: 4, y: 2 },
  { x: 3, y: 3 },
  { x: 2, y: 4 },
  { x: 1, y: 5 },
  { x: -1, y: 5 },
  { x: -2, y: 4 },
  { x: -3, y: 3 },
  { x: -4, y: 2 },
  { x: -5, y: 1 },
  { x: -5, y: -1 },
  { x: -4, y: -2 },
  { x: -3, y: -3 },
  { x: -2, y: -4 },
  { x: -1, y: -5 },
];

function spacingSquare(world: World, centre: Point, i: number): Point | null {
  const off = CITY_SPACING_OFFSETS[i];
  if (!off) return null;
  const y = centre.y + off.y;
  if (y < 0 || y >= world.rows) return null;
  const x = world.wrapX(centre.x + off.x, y);
  return x === null ? null : { x, y };
}

/** Per terrain (0–10) and per terrain-with-special (11–21): the square value the rating sums. */
export function fertilityTerrainValues(rules: EngineRules): number[] {
  const out: number[] = [];
  for (let t = 0; t < 22; t++) {
    const base = t % 11;
    const row = rules.terrain[base];
    if (!row) {
      out.push(0);
      continue;
    }
    const y = t < 11 ? row : row.specials[0];
    let v = y.food * 3 + y.trade;
    if (base !== GRASSLAND) v += y.shields * 2;
    if (row.mine.kind === 'yes') v += base === HILLS ? 3 : 1;
    else if (row.irrigate.kind === 'yes') v += 2;
    out.push(v);
  }
  return out;
}

/** Rate one square as the map maker does: 0 unless plains or grassland, else 8–15. */
export function fertilityAt(
  world: World,
  rules: EngineRules,
  x: number,
  y: number,
  values = fertilityTerrainValues(rules),
): number {
  const centre = world.terrainAt(x, y);
  if (centre !== PLAINS && centre !== GRASSLAND) return 0;
  let total = 0;
  for (let i = 0; i < CITY_RADIUS_OFFSETS.length; i++) {
    const q = world.radiusSquare(x, y, i);
    if (!q) continue;
    const terrain = world.terrainAt(q.x, q.y);
    let v = 0;
    if (terrain === GRASSLAND && grasslandShieldAt(q.x, q.y)) v += 2;
    let row = terrain;
    if (i !== 20 && specialAt(world, q.x, q.y) !== 0) row += 11;
    v += values[row] ?? 0;
    const river = world.hasFlag(q.x, q.y, SquareFlag.River);
    if (river) v += 1;
    if (i === 20) {
      v *= 4;
      if (river) v += Math.trunc(v / 2);
    } else if (i < 8) {
      v *= 2;
    }
    total += v;
  }
  if (centre !== PLAINS && !grasslandShieldAt(x, y)) total -= 16;
  const rating = Math.min(15, Math.max(1, (total - 120) >> 3));
  return (rating >> 1) + 8;
}

/**
 * Rate every square into `world.fertility` as a freshly made map is rated (no cities yet) and
 * return the count of rated squares per land mass (the original's per-land-mass value).
 */
export function computeFertility(world: World, rules: EngineRules): number[] {
  const values = fertilityTerrainValues(rules);
  const perLandmass: number[] = Array<number>(64).fill(0);
  for (let i = 0; i < world.area; i++) {
    const p = world.position(i);
    const f = fertilityAt(world, rules, p.x, p.y, values);
    world.fertility[i] = f;
    if (f !== 0 && world.terrain[i] !== OCEAN) {
      const lm = world.landmass[i] ?? 0;
      perLandmass[lm] = (perLandmass[lm] ?? 0) + 1;
    }
  }
  return perLandmass;
}

/**
 * A city has been founded (or is being re-marked): the 45 spacing squares lose the 8 of their
 * rating and the 21 radius squares become the owner's territory (0x0042e7f6).
 */
export function claimCitySite(world: World, city: City): void {
  for (let i = 0; i < CITY_SPACING_OFFSETS.length; i++) {
    const q = spacingSquare(world, city.position, i);
    if (!q) continue;
    const k = world.index(q.x, q.y);
    world.fertility[k] = (world.fertility[k] ?? 0) & 7;
    if (i < CITY_RADIUS_OFFSETS.length) world.territory[k] = city.owner & 7;
  }
}

/**
 * A city has been removed from `world.cities`: its 45 land squares get the 8 back (which also
 * makes never-rated land a minimum site, as in the original), its territory is released, and
 * every remaining city re-marks its own squares (0x004aeab6).
 */
export function releaseCitySite(world: World, city: City): void {
  for (let i = 0; i < CITY_SPACING_OFFSETS.length; i++) {
    const q = spacingSquare(world, city.position, i);
    if (!q) continue;
    const k = world.index(q.x, q.y);
    if (world.terrainAt(q.x, q.y) !== OCEAN) world.fertility[k] = (world.fertility[k] ?? 0) | 8;
    if (i < CITY_RADIUS_OFFSETS.length && world.territory[k] === city.owner) world.territory[k] = 0;
  }
  for (const other of world.cities) claimCitySite(world, other);
}

/** A city changed hands: its radius squares follow the new owner (INFERRED condition). */
export function remarkTerritory(world: World, city: City, previousOwner: number): void {
  for (let i = 0; i < CITY_RADIUS_OFFSETS.length; i++) {
    const q = world.radiusSquare(city.position.x, city.position.y, i);
    if (!q) continue;
    const k = world.index(q.x, q.y);
    const t = world.territory[k] ?? 0;
    if (t === previousOwner || t === 0) world.territory[k] = city.owner & 7;
  }
}

/**
 * The AI's land value of a square (VERIFIED, 0x00559162): the territory owner when a city
 * radius claims it (never a site), else its fertility raised to at least 8, else 0.
 */
export function landValue(world: World, x: number, y: number): number {
  const i = world.index(x, y);
  const owner = world.territory[i] ?? 0;
  if (owner !== 0) return owner;
  const f = world.fertility[i] ?? 0;
  return f === 0 ? 0 : Math.max(8, f);
}
