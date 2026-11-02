/**
 * Where every sprite lives inside the original 640×480 GIF sheets.
 *
 * Specification: docs/formats/assets.md. Every rectangle below was verified pixel-by-pixel
 * against the shipped files (grid separators and marker pixels), so treat changes here as
 * format changes, not tweaks.
 *
 * This module is pure data + arithmetic; image decoding belongs to the renderer.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Rgb = readonly [number, number, number];

/** Magenta: transparent in every sheet. */
export const TRANSPARENT: Rgb = [255, 0, 255];
/** Light pink: second transparent colour used in ICONS.GIF. */
export const TRANSPARENT_ALT: Rgb = [255, 159, 163];
/** Green: the 1-pixel grid between cells. Never part of a sprite. */
export const GRID_LINE: Rgb = [0, 255, 0];
/** Blue marker pixel on a cell's top/left grid line: flag / shield anchor. */
export const FLAG_MARKER: Rgb = [0, 0, 255];
/** Orange marker pixel on a cell's top/left grid line: city size-box anchor. */
export const SIZE_MARKER: Rgb = [255, 155, 0];
/** Purple: fills the corners outside the diamond footprint in UNITS.GIF cells. Transparent. */
export const UNIT_CORNER_FILL: Rgb = [135, 83, 135];
/**
 * Grey: fills the corners outside the diamonds in TERRAIN1, TERRAIN2 and CITIES. Transparent
 * there, but a real colour inside UNITS and ICONS art, so key it per sheet.
 */
export const SHEET_FILL: Rgb = [135, 135, 135];

export const TILE_W = 64;
export const TILE_H = 32;
export const SPRITE_H = 48;

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

/** UNITS.GIF: slot i (RULES.TXT @UNITS order) — 9 per row, 64×48, pitch 65×49, origin (1,1). */
export const UNITS_PER_ROW = 9;
export function unitCell(slot: number): Rect {
  return rect(
    1 + 65 * (slot % UNITS_PER_ROW),
    1 + 49 * Math.floor(slot / UNITS_PER_ROW),
    TILE_W,
    SPRITE_H,
  );
}
export const UNIT_HP_SHIELD = rect(597, 30, 12, 20);
export const UNIT_BACK_SHIELDS = [rect(586, 1, 12, 20), rect(599, 1, 12, 20)] as const;

/** CITIES.GIF: style row 0–5, size column 0–3, open or walled. */
export function cityCell(style: number, sizeClass: number, walled: boolean): Rect {
  return rect((walled ? 334 : 1) + 65 * sizeClass, 39 + 49 * style, TILE_W, SPRITE_H);
}
export function playerTextColourStrip(colourSet: number): Rect {
  return rect(1 + 15 * colourSet, 423, 14, 1);
}
export function flag(colourSet: number, row: 0 | 1): Rect {
  return rect(1 + 15 * colourSet, 425 + 23 * row, 14, 22);
}
export const FORTIFIED_OVERLAY = rect(143, 423, TILE_W, SPRITE_H);
export const FORTRESS = rect(208, 423, TILE_W, SPRITE_H);
export const AIRBASE_EMPTY = rect(273, 423, TILE_W, SPRITE_H);
export const AIRBASE_OCCUPIED = rect(338, 423, TILE_W, SPRITE_H);

/** TERRAIN1.GIF: base tiles by terrain index 0–10. */
export function terrainBase(terrain: number, alternate = false): Rect {
  return rect(alternate ? 66 : 1, 1 + 33 * terrain, TILE_W, TILE_H);
}
export function terrainSpecial(terrain: number, which: 0 | 1): Rect {
  return rect(which === 0 ? 131 : 196, 1 + 33 * terrain, TILE_W, TILE_H);
}
/** Road / railroad segments 0–8 (0 = isolated; 1–8 = toward each neighbour, order to be confirmed). */
export function road(segment: number): Rect {
  return rect(1 + 65 * segment, 364, TILE_W, TILE_H);
}
export function railroad(segment: number): Rect {
  return rect(1 + 65 * segment, 397, TILE_W, TILE_H);
}
export const IRRIGATION = rect(456, 100, TILE_W, TILE_H);
export const FARMLAND = rect(456, 133, TILE_W, TILE_H);
export const MINE = rect(456, 166, TILE_W, TILE_H);
export const POLLUTION = rect(456, 199, TILE_W, TILE_H);
export const GRASSLAND_SHIELD = rect(456, 232, TILE_W, TILE_H);
export const HUT = rect(456, 265, TILE_W, TILE_H);
export const DITHER_MASK = rect(1, 447, TILE_W, TILE_H);
export const BLANK_TILE = rect(131, 447, TILE_W, TILE_H);

/** TERRAIN2.GIF overlays: 16 variants per group (neighbour mask), 8 per row. */
export type OverlayGroup = 'connection' | 'river' | 'forest' | 'mountain' | 'hill';
const OVERLAY_Y: Record<OverlayGroup, number> = {
  connection: 1,
  river: 67,
  forest: 133,
  mountain: 199,
  hill: 265,
};
export function overlay(group: OverlayGroup, variant: number): Rect {
  return rect(
    1 + 65 * (variant % 8),
    OVERLAY_Y[group] + 33 * Math.floor(variant / 8),
    TILE_W,
    TILE_H,
  );
}
export function riverMouth(variant: number): Rect {
  return rect(1 + 65 * variant, 331, TILE_W, TILE_H);
}
/** Coastline quarter tiles 32×16: eight variants × N/S/W/E. */
export function coast(variant: number, side: 'N' | 'S' | 'W' | 'E'): Rect {
  const x = 1 + 66 * variant;
  switch (side) {
    case 'N':
      return rect(x, 429, 32, 16);
    case 'S':
      return rect(x, 446, 32, 16);
    case 'W':
      return rect(x, 463, 32, 16);
    case 'E':
      return rect(x + 33, 463, 32, 16);
  }
}

/** ICONS.GIF */
export function improvementIcon(improvementIndex: number): Rect {
  if (improvementIndex < 39) {
    return rect(
      343 + 37 * (improvementIndex % 8),
      1 + 21 * Math.floor(improvementIndex / 8),
      36,
      20,
    );
  }
  const w = improvementIndex - 39;
  return rect(343 + 37 * (w % 7), 106 + 21 * Math.floor(w / 7), 36, 20);
}
/** The 14×14 row icons: column 0 food, 1 shields, 2 trade on row 1; luxury, gold, science on row 2; row 0 the same in dark. */
export function bigIcon(column: number, row: number): Rect {
  return rect(1 + 15 * column, 290 + 15 * row, 14, 14);
}
/** The 10×10 yield icons on a city's map: food, shields, trade. */
export function smallIcon(column: number): Rect {
  return rect(49 + 11 * column, 334, 10, 10);
}
export function advanceCategoryIcon(category: number, variant: number): Rect {
  return rect(343 + 37 * category, 211 + 21 * variant, 36, 20);
}
export const VIEW_PIECE = rect(199, 256, TILE_W, TILE_H);
export const GRID_OVERLAY = rect(183, 430, TILE_W, TILE_H);
export const GRID_OVERLAY_VISIBLE = rect(248, 430, TILE_W, TILE_H);
export function battleFrame(frame: number): Rect {
  return rect(1 + 33 * frame, 356, 32, 32);
}
export const PANEL_OUTER = rect(199, 322, TILE_W, TILE_H);
export const PANEL_INNER = rect(298, 190, 32, 32);

/** PEOPLE.GIF: 11 columns × 4 era rows of 27×30 faces. */
export function citizenFace(column: number, era: number): Rect {
  return rect(2 + 28 * column, 6 + 31 * era, 27, 30);
}
