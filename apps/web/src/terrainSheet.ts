/**
 * Loads the player's own TERRAIN1.GIF into an offscreen canvas and turns the magenta colour key
 * into real transparency, so tiles can be drawn with `drawImage`.
 *
 * Which colour is the key, and why: docs/formats/assets.md ("Common conventions").
 */
import { sprites } from '@mudbrick/formats';

/** TERRAIN1.GIF decoded once, with the magenta key turned into real transparency. */
export interface TerrainSheet {
  image: CanvasImageSource;
}

const [TR, TG, TB] = sprites.TRANSPARENT;

export async function loadTerrainSheet(file: Blob): Promise<TerrainSheet> {
  const bitmap = await createImageBitmap(file);
  const off = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = off.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, off.width, off.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] === TR && d[i + 1] === TG && d[i + 2] === TB) d[i + 3] = 0;
  }
  ctx.putImageData(img, 0, 0);
  return { image: off };
}
