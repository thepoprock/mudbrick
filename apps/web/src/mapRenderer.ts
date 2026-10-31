import { DEBUG_TERRAIN_COLOURS, decodeSquare, sprites, type MapFile } from '@epochs/formats';
import type { TerrainSheet } from './terrainSheet.js';

const { TILE_W, TILE_H } = sprites;

/** Screen position of the top-left corner of the 64×32 diamond for stored (c, y). */
export function squareOrigin(c: number, y: number): { px: number; py: number } {
  return { px: c * TILE_W + (y & 1) * (TILE_W / 2), py: y * (TILE_H / 2) };
}

export function canvasSize(map: MapFile): { width: number; height: number } {
  return { width: map.columns * TILE_W + TILE_W / 2, height: (map.rows + 1) * (TILE_H / 2) };
}

export function drawMap(
  canvas: HTMLCanvasElement,
  map: MapFile,
  zoom: number,
  sheet?: TerrainSheet,
): void {
  const size = canvasSize(map);
  canvas.width = Math.ceil(size.width * zoom);
  canvas.height = Math.ceil(size.height * zoom);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(zoom, 0, 0, zoom, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size.width, size.height);
  for (let y = 0; y < map.rows; y++) {
    for (let c = 0; c < map.columns; c++) {
      const s = decodeSquare(map, y * map.columns + c);
      const { px, py } = squareOrigin(c, y);
      if (sheet) {
        const r = sprites.terrainBase(s.terrain);
        ctx.drawImage(sheet.image, r.x, r.y, r.w, r.h, px, py, TILE_W, TILE_H);
      } else {
        ctx.fillStyle = DEBUG_TERRAIN_COLOURS[s.terrain] ?? '#f0f';
        ctx.beginPath();
        ctx.moveTo(px + TILE_W / 2, py);
        ctx.lineTo(px + TILE_W, py + TILE_H / 2);
        ctx.lineTo(px + TILE_W / 2, py + TILE_H);
        ctx.lineTo(px, py + TILE_H / 2);
        ctx.closePath();
        ctx.fill();
        if (s.river) {
          ctx.fillStyle = '#4aa3ff';
          ctx.fillRect(px + TILE_W / 2 - 4, py + TILE_H / 2 - 2, 8, 4);
        }
      }
    }
  }
  ctx.fillStyle = '#ff3b3b';
  for (const p of map.startPositions) {
    if (!p) continue;
    const { px, py } = squareOrigin((p.x - (p.y & 1)) / 2, p.y);
    ctx.fillRect(px + TILE_W / 2 - 3, py + TILE_H / 2 - 3, 6, 6);
  }
}

/** Which stored square is under canvas pixel (sx, sy)? Diamond-exact hit test. */
export function hitTest(
  map: MapFile,
  zoom: number,
  sx: number,
  sy: number,
): { c: number; y: number; index: number } | undefined {
  const x = sx / zoom;
  const yy = sy / zoom;
  const rowGuess = Math.floor(yy / (TILE_H / 2));
  for (const y of [rowGuess, rowGuess - 1, rowGuess + 1]) {
    if (y < 0 || y >= map.rows) continue;
    const c = Math.floor((x - (y & 1) * (TILE_W / 2)) / TILE_W);
    if (c < 0 || c >= map.columns) continue;
    const { px, py } = squareOrigin(c, y);
    const dx = Math.abs(x - (px + TILE_W / 2)) / (TILE_W / 2);
    const dy = Math.abs(yy - (py + TILE_H / 2)) / (TILE_H / 2);
    if (dx + dy <= 1) return { c, y, index: y * map.columns + c };
  }
  return undefined;
}
