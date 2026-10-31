import { type MapFile } from '@epochs/formats';
import type { TerrainSheet } from './terrainSheet.js';
/** Screen position of the top-left corner of the 64×32 diamond for stored (c, y). */
export declare function squareOrigin(
  c: number,
  y: number,
): {
  px: number;
  py: number;
};
export declare function canvasSize(map: MapFile): {
  width: number;
  height: number;
};
export declare function drawMap(
  canvas: HTMLCanvasElement,
  map: MapFile,
  zoom: number,
  sheet?: TerrainSheet,
): void;
/** Which stored square is under canvas pixel (sx, sy)? Diamond-exact hit test. */
export declare function hitTest(
  map: MapFile,
  zoom: number,
  sx: number,
  sy: number,
):
  | {
      c: number;
      y: number;
      index: number;
    }
  | undefined;
//# sourceMappingURL=mapRenderer.d.ts.map
