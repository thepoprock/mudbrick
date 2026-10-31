/**
 * Loads what the viewer needs from the player's own game folder. Everything stays in the
 * browser; nothing is uploaded.
 *
 * Two ways in: a directory picker (`loadGameFolder`) for players, and `loadGameFolderFromUrl`
 * for development, which fetches the same files from a gitignored `dev-game` folder served by
 * the dev server (see README "Developing").
 *
 * Sheets are decoded once into offscreen canvases with the magenta colour key made transparent
 * (docs/formats/assets.md, "Common conventions"), and the blue/orange marker pixels on each
 * unit and city cell's grid lines are read into anchor tables.
 */
import { decodeText, parseRules, sprites, type Rules } from '@mudbrick/formats';

export type SheetName = 'TERRAIN1' | 'TERRAIN2' | 'CITIES' | 'UNITS' | 'ICONS';
const SHEETS: SheetName[] = ['TERRAIN1', 'TERRAIN2', 'CITIES', 'UNITS', 'ICONS'];

export interface Anchor {
  x: number;
  y: number;
}

export interface Sheet {
  canvas: OffscreenCanvas;
  /** Raw pixels before the colour key was removed, for marker lookups. */
  pixels: ImageData;
}

/** [open, walled] anchors for one city cell. */
export type CellAnchors = [Anchor, Anchor];

export interface GameFolder {
  rules: Rules;
  sheets: Partial<Record<SheetName, Sheet>>;
  /** Shield anchor per unit slot (blue marker), when UNITS.GIF is present. */
  unitFlag: Anchor[];
  /** Flag (blue) anchors per [style row][size column], when CITIES.GIF is present. */
  cityFlag: CellAnchors[][];
  /** Size-box (orange) anchors per [style row][size column]. */
  citySize: CellAnchors[][];
  /** Fetch any other file from the folder by name (case-insensitive), e.g. a save. */
  file: (name: string) => Promise<Blob | undefined>;
}

/** Abstracts "a folder of files" over FileList and fetch. */
export type FileSource = (name: string) => Promise<Blob | undefined>;

const [TR, TG, TB] = sprites.TRANSPARENT;
const [PR, PG, PB] = sprites.TRANSPARENT_ALT;

const [UR, UG, UB] = sprites.UNIT_CORNER_FILL;
const [GR, GG, GB] = sprites.SHEET_FILL;

/** Which non-sprite colours to make transparent, besides magenta (always). */
interface ColourKeys {
  pink?: boolean;
  purple?: boolean;
  grey?: boolean;
}

/** Per docs/formats/assets.md "Common conventions" and "Palette and fill colours". */
const SHEET_KEYS: Record<SheetName, ColourKeys> = {
  TERRAIN1: { grey: true },
  TERRAIN2: { grey: true },
  CITIES: { grey: true },
  UNITS: { purple: true },
  ICONS: { pink: true },
};

async function loadSheet(file: Blob, keys: ColourKeys): Promise<Sheet> {
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const keyed = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
  const d = keyed.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    if (
      (r === TR && g === TG && b === TB) ||
      (keys.pink === true && r === PR && g === PG && b === PB) ||
      (keys.purple === true && r === UR && g === UG && b === UB) ||
      (keys.grey === true && r === GR && g === GG && b === GB)
    ) {
      d[i + 3] = 0;
    }
  }
  ctx.putImageData(keyed, 0, 0);
  return { canvas, pixels };
}

function pixelIs(img: ImageData, x: number, y: number, rgb: sprites.Rgb): boolean {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return false;
  const i = (y * img.width + x) * 4;
  return img.data[i] === rgb[0] && img.data[i + 1] === rgb[1] && img.data[i + 2] === rgb[2];
}

/** Marker on the grid line above (x) and left of (y) a cell; falls back to the cell centre. */
function anchorFor(img: ImageData, r: sprites.Rect, colour: sprites.Rgb): Anchor {
  let ax = -1;
  let ay = -1;
  for (let i = 0; i < r.w; i++) if (pixelIs(img, r.x + i, r.y - 1, colour)) ax = i;
  for (let j = 0; j < r.h; j++) if (pixelIs(img, r.x - 1, r.y + j, colour)) ay = j;
  return { x: ax < 0 ? r.w / 2 : ax, y: ay < 0 ? r.h / 2 : ay };
}

async function loadFrom(source: FileSource): Promise<GameFolder> {
  const rulesFile = await source('RULES.TXT');
  if (!rulesFile) throw new Error('RULES.TXT not found: choose the folder that contains it');
  const rules = parseRules(decodeText(new Uint8Array(await rulesFile.arrayBuffer())));

  const sheets: Partial<Record<SheetName, Sheet>> = {};
  for (const name of SHEETS) {
    const f = await source(`${name}.GIF`);
    if (f) sheets[name] = await loadSheet(f, SHEET_KEYS[name]);
  }

  const unitFlag: Anchor[] = [];
  const units = sheets.UNITS;
  if (units) {
    for (let slot = 0; slot < 63; slot++) {
      unitFlag.push(anchorFor(units.pixels, sprites.unitCell(slot), sprites.FLAG_MARKER));
    }
  }
  const cityFlag: CellAnchors[][] = [];
  const citySize: CellAnchors[][] = [];
  const cities = sheets.CITIES;
  if (cities) {
    for (let style = 0; style < 6; style++) {
      const flagRow: CellAnchors[] = [];
      const sizeRow: CellAnchors[] = [];
      for (let col = 0; col < 4; col++) {
        const open = sprites.cityCell(style, col, false);
        const walled = sprites.cityCell(style, col, true);
        flagRow.push([
          anchorFor(cities.pixels, open, sprites.FLAG_MARKER),
          anchorFor(cities.pixels, walled, sprites.FLAG_MARKER),
        ]);
        sizeRow.push([
          anchorFor(cities.pixels, open, sprites.SIZE_MARKER),
          anchorFor(cities.pixels, walled, sprites.SIZE_MARKER),
        ]);
      }
      cityFlag.push(flagRow);
      citySize.push(sizeRow);
    }
  }
  return { rules, sheets, unitFlag, cityFlag, citySize, file: source };
}

/** Player path: the FileList of an `<input type="file" webkitdirectory>`. */
export function loadGameFolder(list: FileList): Promise<GameFolder> {
  const byName = new Map<string, File>();
  for (const f of Array.from(list)) {
    // Keep the folder's relative path so scenario sub-folders stay addressable.
    const rel = f.webkitRelativePath.split('/').slice(1).join('/');
    byName.set(rel.toUpperCase(), f);
  }
  return loadFrom((name) => Promise.resolve(byName.get(name.toUpperCase())));
}

/** Development path: files served under `base` (e.g. `/dev-game/`) by the dev server. */
export function loadGameFolderFromUrl(base: string): Promise<GameFolder> {
  return loadFrom(async (name) => {
    const res = await fetch(base + name);
    if (!res.ok) return undefined;
    const type = res.headers.get('content-type') ?? '';
    // The dev server answers unknown paths with index.html; treat that as "not found".
    if (type.includes('text/html')) return undefined;
    return res.blob();
  });
}
