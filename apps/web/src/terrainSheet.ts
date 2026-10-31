/**
 * The minimal thing `mapRenderer.ts` needs to draw real tiles: any drawable image of
 * TERRAIN1.GIF with the magenta key already made transparent (see `gameFiles.ts`).
 */
export interface TerrainSheet {
  image: CanvasImageSource;
}
