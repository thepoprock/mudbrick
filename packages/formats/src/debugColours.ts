/**
 * A flat colour per terrain index, for debugging renders and tools when no sprite sheet is
 * available. Presentation only — nothing in the game rules depends on these values.
 */
export const DEBUG_TERRAIN_COLOURS: readonly string[] = [
  '#d9c27a', // 0 Desert
  '#b8a84a', // 1 Plains
  '#6fa84a', // 2 Grassland
  '#2f6b2f', // 3 Forest
  '#8f7a3f', // 4 Hills
  '#8a8a8a', // 5 Mountains
  '#a9a98a', // 6 Tundra
  '#e8eef5', // 7 Glacier
  '#5d7a4a', // 8 Swamp
  '#3f7a3a', // 9 Jungle
  '#1f4f9a', // 10 Ocean
];

/** `#rrggbb` → [r, g, b]. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
