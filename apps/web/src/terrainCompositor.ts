/**
 * Composes one square's terrain the way the original does: base tile, then either dithered
 * blends toward differing land neighbours or coastline quarters for ocean, then the forest /
 * hills / mountains relief overlay chosen by which edge-neighbours share the type, rivers and
 * river mouths, and finally roads and railroads joined toward neighbours that have them.
 *
 * Every rule here is INFERRED from the community reimplementation and listed in
 * docs/formats/assets.md ("Compositing a square"); the viewer exists so they can be judged by
 * eye against the original. Sprite rectangles come from `@mudbrick/formats`.
 */
import { OCEAN, SquareFlag, type World } from '@mudbrick/engine';
import { sprites } from '@mudbrick/formats';
import type { Sheet } from './gameFiles.js';

const { TILE_W, TILE_H } = sprites;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Terrain ids whose relief lives in TERRAIN2 overlays instead of the base tile. */
const RELIEF: Record<number, sprites.OverlayGroup> = { 3: 'forest', 4: 'hill', 5: 'mountain' };

/** The four dither quadrants, in direct-neighbour order NE, SE, SW, NW: where each is drawn. */
const QUADRANT: { x: number; y: number }[] = [
  { x: 32, y: 0 },
  { x: 32, y: 16 },
  { x: 0, y: 16 },
  { x: 0, y: 0 },
];

/** Coast sides: which three of the eight neighbours (N, NE, E, SE, S, SW, W, NW) form each side's 3-bit value. */
const COAST_SIDES: {
  side: 'N' | 'S' | 'W' | 'E';
  bits: [number, number, number];
  x: number;
  y: number;
}[] = [
  { side: 'N', bits: [7, 0, 1], x: 16, y: 0 }, // NW=1, N=2, NE=4
  { side: 'S', bits: [3, 4, 5], x: 16, y: 16 }, // SE=1, S=2, SW=4
  { side: 'W', bits: [5, 6, 7], x: 0, y: 8 }, // SW=1, W=2, NW=4
  { side: 'E', bits: [1, 2, 3], x: 32, y: 8 }, // NE=1, E=2, SE=4
];

/** Road segments: TERRAIN1 road/railroad column 1–8 is "toward" NE, E, SE, S, SW, W, NW, N. */
const ROAD_ORDER = [1, 2, 3, 4, 5, 6, 7, 0];

export interface DitherSet {
  /** [terrain][quadrant] → 32×16 canvas of that terrain's base tile seen through the dither mask. */
  quads: OffscreenCanvas[][];
}

/**
 * Pre-render the dithered quadrant of every terrain's base tile. The dither tile at (1,447) is
 * black where the neighbour's pixels show through and magenta/grey where they do not.
 */
export function prepareDither(terrain1: Sheet): DitherSet {
  const mask = sprites.DITHER_MASK;
  const quads: OffscreenCanvas[][] = [];
  for (let t = 0; t <= 10; t++) {
    const base = sprites.terrainBase(t);
    const row: OffscreenCanvas[] = [];
    for (const q of QUADRANT) {
      const c = new OffscreenCanvas(32, 16);
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('2D canvas unavailable');
      ctx.drawImage(terrain1.canvas, base.x + q.x, base.y + q.y, 32, 16, 0, 0, 32, 16);
      const img = ctx.getImageData(0, 0, 32, 16);
      const m = terrain1.pixels;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 32; x++) {
          const mi = ((mask.y + q.y + y) * m.width + (mask.x + q.x + x)) * 4;
          const keep = m.data[mi] === 0 && m.data[mi + 1] === 0 && m.data[mi + 2] === 0;
          if (!keep) img.data[(y * 32 + x) * 4 + 3] = 0;
        }
      }
      ctx.putImageData(img, 0, 0);
      row.push(c);
    }
    quads.push(row);
  }
  return { quads };
}

function blit(ctx: Ctx, sheet: OffscreenCanvas, r: sprites.Rect, px: number, py: number): void {
  ctx.drawImage(sheet, r.x, r.y, r.w, r.h, px, py, r.w, r.h);
}

/** Draw the full terrain stack of square (x, y) with its top-left at (px, py). */
export function drawSquareTerrain(
  ctx: Ctx,
  world: World,
  x: number,
  y: number,
  px: number,
  py: number,
  terrain1: Sheet,
  terrain2: Sheet | undefined,
  dither: DitherSet,
): void {
  const i = world.index(x, y);
  const t = world.terrain[i] ?? OCEAN;
  const flags = world.flags[i] ?? 0;
  const direct = world.directNeighbours(x, y);
  const all = world.neighbours(x, y);
  const typeOf = (p: { x: number; y: number } | null): number | null =>
    p ? (world.terrain[world.index(p.x, p.y)] ?? OCEAN) : null;
  const flagsOf = (p: { x: number; y: number } | null): number =>
    p ? (world.flags[world.index(p.x, p.y)] ?? 0) : 0;

  blit(ctx, terrain1.canvas, sprites.terrainBase(t), px, py);

  if (t !== OCEAN) {
    // Blend toward each differing edge-neighbour; ocean neighbours blend as grassland.
    direct.forEach((n, q) => {
      let nt = typeOf(n);
      if (nt === null) return;
      if (nt === OCEAN) nt = 2;
      if (nt === t) return;
      const quad = dither.quads[nt]?.[q];
      const at = QUADRANT[q];
      if (quad && at) ctx.drawImage(quad, px + at.x, py + at.y);
    });
  } else if (terrain2) {
    // Coastline quarters: each side's variant is a 3-bit code of its three land neighbours.
    for (const side of COAST_SIDES) {
      let code = 0;
      side.bits.forEach((nIndex, bit) => {
        const nt = typeOf(all[nIndex] ?? null);
        if (nt !== null && nt !== OCEAN) code |= 1 << bit;
      });
      if (code !== 0)
        blit(ctx, terrain2.canvas, sprites.coast(code, side.side), px + side.x, py + side.y);
    }
    // River mouths where an edge-neighbour's river meets this ocean square.
    direct.forEach((n, q) => {
      if (flagsOf(n) & SquareFlag.River) blit(ctx, terrain2.canvas, sprites.riverMouth(q), px, py);
    });
  }

  const relief = RELIEF[t];
  if (relief && terrain2) {
    let mask = 0;
    direct.forEach((n, q) => {
      if (typeOf(n) === t) mask |= 1 << q;
    });
    blit(ctx, terrain2.canvas, sprites.overlay(relief, mask), px, py);
  }

  if (flags & SquareFlag.River && terrain2) {
    let mask = 0;
    direct.forEach((n, q) => {
      const nt = typeOf(n);
      if (nt !== null && (flagsOf(n) & SquareFlag.River || nt === OCEAN)) mask |= 1 << q;
    });
    blit(ctx, terrain2.canvas, sprites.overlay('river', mask), px, py);
  }

  if (flags & SquareFlag.Irrigation) blit(ctx, terrain1.canvas, sprites.IRRIGATION, px, py);
  if (flags & SquareFlag.Farmland) blit(ctx, terrain1.canvas, sprites.FARMLAND, px, py);
  if (flags & SquareFlag.Mine) blit(ctx, terrain1.canvas, sprites.MINE, px, py);

  if (flags & (SquareFlag.Road | SquareFlag.Railroad)) {
    const rail = (flags & SquareFlag.Railroad) !== 0;
    let joined = false;
    all.forEach((n, k) => {
      const nf = flagsOf(n);
      if (!(nf & (SquareFlag.Road | SquareFlag.Railroad))) return;
      joined = true;
      const seg = ROAD_ORDER.indexOf(k) + 1;
      const bothRail = rail && (nf & SquareFlag.Railroad) !== 0;
      blit(ctx, terrain1.canvas, bothRail ? sprites.railroad(seg) : sprites.road(seg), px, py);
    });
    if (!joined && !world.cityAt(x, y)) {
      blit(ctx, terrain1.canvas, rail ? sprites.railroad(0) : sprites.road(0), px, py);
    }
  }

  if (flags & SquareFlag.Pollution) blit(ctx, terrain1.canvas, sprites.POLLUTION, px, py);
}

export { TILE_W, TILE_H };
