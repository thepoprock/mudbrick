/** Small pictures cut from the sheets, as elements for the panels and windows. */
import type { Production } from '@mudbrick/engine';
import { sprites } from '@mudbrick/formats';
import type { GameFolder, Sheet } from '../gameFiles.js';

export function spriteCanvas(
  sheet: Sheet | undefined,
  r: sprites.Rect,
  width = r.w,
  height = r.h,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  c.width = width * dpr;
  c.height = height * dpr;
  c.style.width = `${width}px`;
  c.style.height = `${height}px`;
  const g = c.getContext('2d');
  if (g && sheet) {
    g.imageSmoothingEnabled = false;
    g.drawImage(sheet.canvas, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  }
  return c;
}

/** A unit type's picture, shrunk to a height. */
export function unitIcon(folder: GameFolder, type: number, height = 24): HTMLCanvasElement {
  const r = sprites.unitCell(type);
  return spriteCanvas(folder.sheets.UNITS, r, Math.round((r.w * height) / r.h), height);
}

export function improvementIcon(folder: GameFolder, index: number): HTMLCanvasElement {
  return spriteCanvas(folder.sheets.ICONS, sprites.improvementIcon(index));
}

export function productionIcon(
  folder: GameFolder,
  item: Pick<Production, 'kind' | 'index'>,
  unitHeight = 24,
): HTMLCanvasElement {
  return item.kind === 'unit'
    ? unitIcon(folder, item.index, unitHeight)
    : improvementIcon(folder, item.index);
}
