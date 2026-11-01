/**
 * The City View (0x0043e690): a background chosen by site and era, the city's buildings at fixed
 * places, and houses on the unused places, chosen by a generator seeded from the city's square, so
 * a city always looks the same. Specification: docs/engine/advisors.md, "City View".
 *
 * The tables are layout coordinates, read from the program as numbers. No picture is included.
 */
import { councilEra, IMPROVEMENT, SquareFlag, type City, type Game } from '@mudbrick/engine';
import type { GameFolder } from './gameFiles.js';

/** x, y per place, 60 places, for each of the three sites. */
const PLACES = [
  6, 0, 0, 0, 165, 47, 268, 10, 401, 10, 546, 3, 651, 0, 726, 8, 849, 7, 979, 3, 1115, 3, 59, 107,
  170, 98, 268, 96, 370, 97, 513, 63, 622, 50, 370, 97, 96, 155, 192, 154, 291, 151, 460, 120, 585,
  103, 675, 113, 775, 104, 871, 102, 958, 115, 1060, 104, 1156, 104, 539, 150, 536, 197, 657, 156,
  780, 156, 915, 168, 1033, 175, 1157, 213, 1, 213, 110, 260, 209, 226, 332, 226, 13, 298, 170, 291,
  293, 291, 4, 364, 131, 356, 253, 356, 451, 257, 572, 257, 411, 324, 533, 324, 732, 251, 679, 284,
  842, 260, 369, 390, 924, 276, 898, 296, 762, 246, 917, 365, 1070, 319, 1176, 304, 6, 0, 0, 0, 165,
  47, 268, 10, 438, 1, 546, 3, 651, 0, 726, 8, 849, 7, 979, 3, 1115, 3, 59, 107, 170, 98, 268, 96,
  370, 97, 513, 63, 460, 120, 622, 50, 585, 103, 675, 113, 539, 150, 536, 197, 775, 104, 871, 102,
  958, 115, 1060, 104, 1156, 104, 370, 97, 96, 155, 192, 154, 291, 151, 1, 213, 110, 260, 209, 226,
  332, 226, 13, 298, 170, 291, 293, 291, 4, 364, 131, 356, 253, 356, 657, 156, 780, 156, 915, 168,
  1033, 175, 1157, 213, 451, 257, 572, 257, 411, 324, 533, 324, 732, 251, 679, 284, 842, 260, 369,
  390, 806, 317, 973, 242, 1117, 365, 0, 0, 0, 0, 0, 0, 0, 0, 165, 47, 268, 10, 438, 1, 546, 3, 651,
  0, 726, 8, 849, 7, 979, 3, 1115, 3, 59, 107, 170, 98, 268, 96, 370, 97, 513, 63, 460, 120, 622,
  50, 585, 103, 675, 113, 775, 104, 871, 102, 958, 115, 1060, 104, 1156, 104, 370, 97, 96, 155, 192,
  154, 291, 151, 539, 150, 536, 197, 657, 156, 780, 156, 915, 168, 1033, 175, 1157, 213, 1, 213,
  110, 260, 209, 226, 332, 226, 13, 298, 170, 291, 293, 291, 4, 364, 131, 356, 253, 356, 451, 257,
  572, 257, 732, 251, 679, 284, 842, 260, 411, 324, 533, 324, 369, 390, 863, 333, 796, 317, 1020,
  256, 1043, 328, 927, 273, 1156, 288, 1156, 397,
];
/** Places for improvements, 31 per site, −1 unused. */
const IMPROVEMENT_PLACES = [
  17, 11, 28, 2, 37, 18, 27, 26, 12, 33, 19, 25, 13, 20, 52, 24, 14, 6, 5, 16, 15, 50, 23, 22, 21,
  30, 29, -1, -1, -1, -1, 27, 11, 26, 2, 32, 28, 25, 24, 12, 43, 29, 23, 13, 30, 22, 52, 14, 6, 5,
  17, 15, 50, 19, 18, 16, 21, 20, -1, -1, -1, -1, 59, 58, 57, 34, 24, 10, 23, 1, 36, 25, 22, 21, 11,
  32, 26, 20, 12, 27, 15, 49, 13, 5, 4, 16, 14, 47, 18, 17, 19, 29, 28,
];
/** Places for wonders, 24 per site. */
const WONDER_PLACES = [
  43, 0, 40, 10, 36, 34, 44, 3, 41, 38, 9, 45, 8, 49, 48, 51, 42, 7, 4, 39, 32, 47, 46, 31, 56, 38,
  0, 35, 31, 10, 39, 44, 36, 3, 33, 40, 37, 9, 8, 49, 48, 34, 51, 7, 47, 46, 42, 41, 9, 56, 42, 39,
  35, 55, 2, 8, 7, 43, 33, 44, 40, 37, 41, 6, 51, 50, 48, 38, 46, 45, 31, 30,
];
/** x, y, width, height of improvements 1 to 34 in picture 300. */
const IMPROVEMENT_ART = [
  373, 333, 123, 82, 249, 250, 123, 82, 373, 1, 123, 82, 1, 333, 123, 82, 125, 84, 123, 82, 497, 1,
  123, 82, 125, 1, 123, 82, 249, 416, 357, 78, 1, 1, 123, 82, 125, 167, 123, 82, 373, 250, 123, 82,
  373, 167, 123, 82, 125, 618, 123, 82, 249, 167, 123, 82, 249, 1, 123, 82, 1, 84, 123, 82, 497,
  167, 123, 82, 1, 416, 123, 82, 125, 333, 123, 82, 249, 333, 123, 82, 249, 84, 123, 82, 497, 333,
  123, 82, 497, 250, 123, 82, 497, 84, 123, 82, 0, 0, 0, 0, 373, 84, 123, 82, 125, 250, 123, 82, 1,
  250, 123, 82, 1, 618, 123, 82, 1, 499, 220, 100, 590, 499, 105, 105, 1, 167, 123, 82, 125, 416,
  123, 82, 222, 499, 367, 118,
];
/** x, y, width, height of the 28 wonders in picture 305. */
const WONDER_ART = [
  1, 576, 158, 114, 1, 116, 158, 114, 407, 852, 94, 160, 253, 852, 76, 133, 478, 1, 158, 114, 478,
  116, 158, 114, 1, 691, 304, 160, 160, 461, 158, 114, 478, 461, 158, 114, 319, 461, 158, 114, 319,
  116, 158, 114, 478, 231, 158, 114, 478, 346, 158, 113, 1, 231, 158, 114, 1, 461, 158, 114, 319,
  346, 158, 114, 160, 346, 158, 114, 160, 576, 158, 114, 1, 346, 158, 114, 1, 852, 125, 253, 319,
  576, 158, 114, 160, 1, 158, 114, 319, 1, 158, 114, 160, 116, 158, 114, 160, 231, 158, 114, 1, 1,
  158, 114, 319, 231, 158, 114, 478, 576, 158, 114,
];

const SPECIAL: [number, number, boolean][][] = [
  [
    [8, 0x35, true],
    [0x1c, 0x23, false],
    [0x1e, 0x36, true],
    [0x1f, 0x39, true],
    [0x22, 0x37, true],
  ],
  [[8, 0x35, true]],
  [[8, 0x34, true]],
];
const WONDER_SPECIAL: [number, number][][] = [
  [
    [2, 0x3a],
    [3, 0x3b],
    [6, 1],
    [0x13, 0x38],
  ],
  [
    [2, 0x36],
    [3, 4],
    [6, 1],
    [0x13, 0x37],
  ],
  [
    [2, 0x36],
    [3, 3],
    [6, 0],
    [0x13, 0x39],
  ],
];

/** The program's own generator (0x00540d13), for the same layout from the same seed. */
class CityRandom {
  constructor(private seed: number) {}
  range(a: number, b: number): number {
    this.seed = (Math.imul(this.seed, 0x19660d) + 0x3c6ef35f) >>> 0;
    if (a === b) return a;
    return a + Math.trunc((this.seed / 0xffffffff) * (b - a + 1));
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
}

/** 0 coast, 1 river, 2 inland (0x0043f3b3). */
function citySite(game: Game, city: City): number {
  const { world } = game;
  const { x, y } = city.position;
  const coast = world.neighbours(x, y).some((n) => n && !world.isLand(n.x, n.y));
  if (coast) return 0;
  const river = world.neighbours(x, y).some((n) => n && world.hasFlag(n.x, n.y, SquareFlag.River));
  return river ? 1 : 2;
}

/** Draw the view of a city on a 1280 × 480 canvas. */
export async function drawCityView(
  canvas: HTMLCanvasElement,
  game: Game,
  folder: GameFolder,
  city: City,
): Promise<boolean> {
  const g = canvas.getContext('2d');
  if (!g) return false;
  const site = citySite(game, city);
  const era = councilEra(game, city.owner);
  const picture = 340 + site * 5 + (city.improvements[IMPROVEMENT.superhighways] ? 3 : era);
  const [bg, sheet, wonders, houses] = await Promise.all(
    [picture, 300, 305, 310].map((id) => folder.art('CV.DLL', id, id === picture)),
  );
  if (!bg || !sheet || !wonders || !houses) return false;
  const [back, art, wonderArt, house] = await Promise.all(
    [bg, sheet, wonders, houses].map(loadImage),
  );
  if (!back || !art || !wonderArt || !house) return false;
  canvas.width = 1280;
  canvas.height = 480;
  g.drawImage(back, 0, 0);

  const placeCount = [60, 57, 60][site] ?? 60;
  const rng = new CityRandom(
    ((city.position.x * 256 + city.position.y + (game.world.resourceSeed ?? 0)) >>> 0 || 1) >>> 0,
  );
  const pool = (table: number[], stride: number, n: number) =>
    table.slice(site * stride, site * stride + n);
  const free1 = pool(IMPROVEMENT_PLACES, 31, site === 2 ? 31 : 27);
  const free2 = pool(WONDER_PLACES, 24, 24);
  const take = (list: number[]): number => {
    if (list.length === 0) return -1;
    const n = list.length;
    const i = rng.range(Math.trunc((n * 3 - 3) / 4), n - 1);
    const v = list[i] ?? -1;
    list[i] = list[n - 1] ?? -1;
    list.pop();
    return v;
  };
  interface Draw {
    image: CanvasImageSource;
    sx: number;
    sy: number;
    w: number;
    h: number;
  }
  const drawn: (Draw | null)[] = Array<Draw | null>(placeCount).fill(null);
  const modern = era > 1 ? 0x73 : 0;
  const large = (row: number, n: number): Draw => ({
    image: house,
    sx: 1 + n * 0x9f,
    sy: row === 0 ? 1 : 0x74 + modern,
    w: 0x9e,
    h: 0x72,
  });
  const small = (row: number, n: number): Draw => ({
    image: house,
    sx: 1 + n * 0x7c,
    sy: row === 0 ? 0x15a : 0x1ad + (modern ? 0x53 : 0),
    w: 0x7b,
    h: 0x52,
  });
  let left = city.size + 2;
  const fill = (place: number, flagged: boolean, kind: typeof large) => {
    const n = rng.range(0, 3);
    if (left === 0) {
      if (!flagged && place !== -1) drawn[place] = kind(0, n);
    } else if (!flagged) {
      left -= 1;
      if (place !== -1) drawn[place] = kind(1, n);
    }
  };
  for (let i = 1; i < 0x23; i++) {
    const special = SPECIAL[site]?.find((s) => s[0] === i);
    const skipped = site !== 0 && [0x1c, 0x1e, 0x1f, 0x22].includes(i);
    if (skipped) continue;
    const place = special ? special[1] : take(free1);
    if (place === -1) continue;
    const flagged = special?.[2] ?? false;
    if (city.improvements[i]) {
      const r = (i - 1) * 4;
      drawn[place] = {
        image: art,
        sx: IMPROVEMENT_ART[r] ?? 0,
        sy: IMPROVEMENT_ART[r + 1] ?? 0,
        w: IMPROVEMENT_ART[r + 2] ?? 0,
        h: IMPROVEMENT_ART[r + 3] ?? 0,
      };
      rng.range(0, 0);
    } else fill(place, flagged, large);
  }
  for (let p = take(free1); p !== -1; p = take(free1)) fill(p, false, large);
  left = city.size + 2;
  for (let w = 0; w < 0x1c; w++) {
    const special = WONDER_SPECIAL[site]?.find((s) => s[0] === w);
    const place = special ? special[1] : take(free2);
    if (place === -1) continue;
    if (city.improvements[IMPROVEMENT.pyramids + w]) {
      const r = w * 4;
      drawn[place] = {
        image: wonderArt,
        sx: WONDER_ART[r] ?? 0,
        sy: WONDER_ART[r + 1] ?? 0,
        w: WONDER_ART[r + 2] ?? 0,
        h: WONDER_ART[r + 3] ?? 0,
      };
      rng.range(0, 0);
    } else fill(place, special !== undefined, small);
  }
  for (let p = take(free2); p !== -1; p = take(free2)) fill(p, false, small);
  drawn.forEach((d, place) => {
    if (!d) return;
    const i = (site * 60 + place) * 2;
    g.drawImage(d.image, d.sx, d.sy, d.w, d.h, PLACES[i] ?? 0, PLACES[i + 1] ?? 0, d.w, d.h);
  });
  return true;
}
