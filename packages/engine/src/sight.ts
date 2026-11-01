import { DOMAIN_AIR, DOMAIN_SEA, type EngineRules } from './rules.js';
import type { Unit, World } from './world.js';

/**
 * What a unit sees (VERIFIED 0x0041aad6, the "look around" the original runs when a unit
 * arrives on a square or is created): its own square and the eight neighbours always; with the
 * two-square-visibility flag also the sixteen squares at distance two — but only those of its
 * own element: a sea unit sees the ocean squares of that ring, a land unit the land squares, an
 * air unit all of them. The ring is the original's offset table (0x5b2e38 entries 8–19 and
 * 21–24): the twelve outer squares of a city radius plus the four points four columns or rows
 * away.
 *
 * The same routine also makes first contact with the civilizations it finds and wakes sentried
 * units that an enemy comes next to; those live in diplomacy.ts and the unit orders.
 */
export const OUTER_RING: readonly (readonly [number, number])[] = [
  [2, -2],
  [2, 2],
  [-2, 2],
  [-2, -2],
  [1, -3],
  [3, -1],
  [3, 1],
  [1, 3],
  [-1, 3],
  [-3, 1],
  [-3, -1],
  [-1, -3],
  [4, 0],
  [-4, 0],
  [0, 4],
  [0, -4],
];

export function lookAround(world: World, rules: EngineRules, unit: Unit): void {
  const { x, y } = unit.position;
  const slot = unit.owner;
  world.reveal(x, y, slot);
  const type = rules.units[unit.type];
  if (!type?.flags.twoSquareVisibility) return;
  const seaUnit = type.domain === DOMAIN_SEA;
  for (const [dx, dy] of OUTER_RING) {
    const p = world.offsetSquare(x, y, dx, dy);
    if (!p) continue;
    const ocean = !world.isLand(p.x, p.y);
    if (type.domain === DOMAIN_AIR || ocean === seaUnit) world.revealSquare(p.x, p.y, slot);
  }
}
