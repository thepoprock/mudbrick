/**
 * Where special resources and huts appear.
 *
 * Specification: docs/engine/rules-map.md — VERIFIED against the original executable. The
 * original stores neither; both are pure functions of the square's coordinates and the map's
 * resource seed, with one square-record bit able to suppress a special.
 */
import { OCEAN, SquareFlag, type World } from './world.js';

/** RULES @TERRAIN index of Grassland, which never carries a special (it has the shield pattern). */
export const GRASSLAND = 2;

export type Special = 0 | 1 | 2;

/** Diagonal coordinates the original's formulas use. */
function diagonal(x: number, y: number): { a: number; b: number } {
  const a = (x + y) >> 1;
  return { a, b: x - a };
}

/**
 * 0 = none, 1 = the terrain's first special, 2 = its second (RULES @TERRAIN first/second lists).
 * `suppressed` is the square's "no special here" bit (map square byte 0, bit 6).
 */
export function specialPattern(
  x: number,
  y: number,
  seed: number,
  terrain: number,
  suppressed = false,
): Special {
  if (suppressed || terrain === GRASSLAND) return 0;
  const { a, b } = diagonal(x, y);
  const key = (a & 3) + (b & 3) * 4;
  const target = (((x + y) >> 3) * 11 + seed + (b >> 2) * 13) & 0xf;
  if (key !== target) return 0;
  const bit = 1 << ((seed >> 4) & 3);
  return (b & bit) === (a & bit) ? 2 : 1;
}

/** True when a hut sits on a land square with nothing standing on it. */
export function hutPattern(x: number, y: number, seed: number): boolean {
  const { a, b } = diagonal(x, y);
  const key = (a & 3) + (b & 3) * 4;
  const target = ((b >> 2) * 13 + ((x + y) >> 3) * 11 + seed + 8) & 0x1f;
  return key === target;
}

/**
 * Grassland shield pattern (VERIFIED, 0x004051e0): with a = (x + y) >> 1, the square has the
 * shield when bit 1 of −(a + x) is clear. Grassland yields an extra shield there.
 */
export function grasslandShieldAt(x: number, y: number): boolean {
  const a = (x + y) >> 1;
  return (-(a + x) & 2) === 0;
}

/** Special resource on a world square, honouring terrain and the suppression flag. */
export function specialAt(world: World, x: number, y: number): Special {
  const i = world.index(x, y);
  const terrain = world.terrain[i] ?? OCEAN;
  const suppressed = ((world.flags[i] ?? 0) & SquareFlag.NoSpecial) !== 0;
  return specialPattern(x, y, world.resourceSeed, terrain, suppressed);
}

/** Hut on a world square (0x0055951a): land, the pattern, no city, and no unit ever stood here. */
export function hutAt(world: World, x: number, y: number): boolean {
  if ((world.visited[world.index(x, y)] ?? 15) !== 15) return false;
  if (!world.isLand(x, y) || world.cityAt(x, y)) return false;
  return hutPattern(x, y, world.resourceSeed);
}
