/**
 * Draws an engine `World` with the original sprite sheets: composited terrain (see
 * `terrainCompositor.ts`), then cities and the top unit of each occupied square, with owner
 * flags on the marker anchors.
 *
 * Sprite rectangles: docs/formats/assets.md. City sprite selection (style row by era, column by
 * size, capital bump, walled variant) is INFERRED from the community reimplementation and noted
 * in that document; it is drawn here so it can be judged against the original by eye.
 */
import { type City, type Unit, type World } from '@mudbrick/engine';
import { sprites, type Rules } from '@mudbrick/formats';
import type { GameFolder } from './gameFiles.js';
import { squareOrigin } from './mapRenderer.js';
import { drawSquareTerrain, prepareDither, type DitherSet } from './terrainCompositor.js';

const { TILE_W, TILE_H, SPRITE_H } = sprites;

/** Pixels left free above row 0 so 48-pixel-high city and unit sprites are not clipped. */
export const WORLD_TOP_PAD = SPRITE_H - TILE_H;

/** Row in CITIES.GIF for a civilization: its style, or the industrial/modern rows by era. */
export function cityStyleRow(cityStyle: number, epoch: number): number {
  if (epoch === 2) return 4;
  if (epoch === 3) return 5;
  return cityStyle;
}

/** Column in CITIES.GIF for a city of this size in this style row, before the capital bump. */
export function citySizeColumn(styleRow: number, size: number): number {
  if (styleRow === 4) return size <= 4 ? 0 : size <= 7 ? 1 : size <= 10 ? 2 : 3;
  if (styleRow === 5) return size <= 4 ? 0 : size <= 10 ? 1 : size <= 18 ? 2 : 3;
  return size <= 3 ? 0 : size <= 5 ? 1 : size <= 7 ? 2 : 3;
}

function improvementIndex(rules: Rules, name: string, fallback: number): number {
  return rules.improvements.find((i) => i.name === name)?.index ?? fallback;
}

export interface WorldRenderOptions {
  zoom: number;
  showUnits: boolean;
  showCities: boolean;
  /** Draw only what this civilization slot has seen (map byte 4); undefined shows everything. */
  viewer?: number;
}

const ditherCache = new WeakMap<GameFolder, DitherSet>();

export function drawWorld(
  canvas: HTMLCanvasElement,
  world: World,
  folder: GameFolder,
  opts: WorldRenderOptions,
): void {
  const width = world.columns * TILE_W + TILE_W / 2;
  const height = (world.rows + 1) * (TILE_H / 2) + WORLD_TOP_PAD;
  canvas.width = Math.ceil(width * opts.zoom);
  canvas.height = Math.ceil(height * opts.zoom);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(opts.zoom, 0, 0, opts.zoom, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  const terrain1 = folder.sheets.TERRAIN1;
  const top = WORLD_TOP_PAD;

  if (terrain1) {
    let dither = ditherCache.get(folder);
    if (!dither) {
      dither = prepareDither(terrain1);
      ditherCache.set(folder, dither);
    }
    for (let i = 0; i < world.area; i++) {
      const p = world.position(i);
      if (opts.viewer !== undefined && !world.isSeen(p.x, p.y, opts.viewer)) continue;
      const o = squareOrigin((p.x - (p.y & 1)) >> 1, p.y);
      drawSquareTerrain(
        ctx,
        world,
        p.x,
        p.y,
        o.px,
        o.py + top,
        terrain1,
        folder.sheets.TERRAIN2,
        dither,
      );
    }
  } else {
    for (let i = 0; i < world.area; i++) {
      const p = world.position(i);
      if (opts.viewer !== undefined && !world.isSeen(p.x, p.y, opts.viewer)) continue;
      const o = squareOrigin((p.x - (p.y & 1)) >> 1, p.y);
      ctx.fillStyle = (world.terrain[i] ?? 10) === 10 ? '#1f4f9a' : '#6fa84a';
      ctx.fillRect(o.px + 16, o.py + top + 8, 32, 16);
    }
  }

  const palace = improvementIndex(folder.rules, 'Palace', 1);
  const walls = improvementIndex(folder.rules, 'City Walls', 8);

  if (opts.showCities && folder.sheets.CITIES) {
    for (const city of world.cities) {
      if (opts.viewer !== undefined && !world.isSeen(city.position.x, city.position.y, opts.viewer))
        continue;
      drawCity(ctx, world, folder, city, palace, walls, top);
    }
  }
  if (opts.showUnits && folder.sheets.UNITS) {
    const drawn = new Set<number>();
    for (const unit of world.units) {
      const key = unit.position.y * world.widthX2 + unit.position.x;
      if (drawn.has(key)) continue; // top unit only; the save's stacking links are not resolved yet
      if (opts.viewer !== undefined && !world.isSeen(unit.position.x, unit.position.y, opts.viewer))
        continue;
      if (opts.showCities && world.cityAt(unit.position.x, unit.position.y)) continue;
      drawn.add(key);
      drawUnit(ctx, folder, unit, top);
    }
  }
}

function drawCity(
  ctx: CanvasRenderingContext2D,
  world: World,
  folder: GameFolder,
  city: City,
  palace: number,
  walls: number,
  top: number,
): void {
  const sheet = folder.sheets.CITIES;
  if (!sheet) return;
  const civ = world.civs[city.owner];
  const row = cityStyleRow(civ?.cityStyle ?? 0, civ?.epoch ?? 0);
  let col = citySizeColumn(row, city.size);
  if (col < 3 && city.improvements[palace]) col++;
  const walled = city.improvements[walls] === true;
  const r = sprites.cityCell(row, col, walled);
  const o = squareOrigin((city.position.x - (city.position.y & 1)) >> 1, city.position.y);
  const px = o.px;
  const py = o.py + top - (SPRITE_H - TILE_H);
  ctx.drawImage(sheet.canvas, r.x, r.y, r.w, r.h, px, py, r.w, r.h);
  const flag = folder.cityFlag[row]?.[col]?.[walled ? 1 : 0];
  if (flag && civ) {
    const fr = sprites.flag(Math.max(0, civ.colour - 1), 0);
    ctx.drawImage(
      sheet.canvas,
      fr.x,
      fr.y,
      fr.w,
      fr.h,
      px + flag.x,
      py + flag.y - fr.h + 5,
      fr.w,
      fr.h,
    );
  }
  const sizeAnchor = folder.citySize[row]?.[col]?.[walled ? 1 : 0];
  if (sizeAnchor) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(px + sizeAnchor.x - 1, py + sizeAnchor.y - 1, 12, 10);
    ctx.fillStyle = '#000';
    ctx.font = '8px sans-serif';
    ctx.fillText(String(city.size), px + sizeAnchor.x + 1, py + sizeAnchor.y + 7);
  }
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  folder: GameFolder,
  unit: Unit,
  top: number,
): void {
  const sheet = folder.sheets.UNITS;
  const cities = folder.sheets.CITIES;
  if (!sheet) return;
  const r = sprites.unitCell(unit.type);
  const o = squareOrigin((unit.position.x - (unit.position.y & 1)) >> 1, unit.position.y);
  const px = o.px;
  const py = o.py + top - (SPRITE_H - TILE_H);
  ctx.drawImage(sheet.canvas, r.x, r.y, r.w, r.h, px, py, r.w, r.h);
  const anchor = folder.unitFlag[unit.type];
  if (anchor && cities) {
    const colour = Math.max(0, (folder.rules.leaders[unit.owner - 1]?.color ?? unit.owner) - 1);
    const shield = sprites.UNIT_BACK_SHIELDS[0];
    const strip = sprites.playerTextColourStrip(colour);
    ctx.drawImage(
      sheet.canvas,
      shield.x,
      shield.y,
      shield.w,
      shield.h,
      px + anchor.x - 6,
      py + anchor.y - 10,
      shield.w,
      shield.h,
    );
    ctx.drawImage(
      cities.canvas,
      strip.x,
      strip.y,
      strip.w,
      strip.h,
      px + anchor.x - 5,
      py + anchor.y - 9,
      10,
      18,
    );
  }
}
