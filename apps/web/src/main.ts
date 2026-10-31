import { decodeSquare, parseMap, toGameCoords, type MapFile } from '@epochs/formats';
import { drawMap, hitTest } from './mapRenderer.js';
import { loadTerrainSheet, type TerrainSheet } from './terrainSheet.js';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

const canvas = byId<HTMLCanvasElement>('map');
const info = byId<HTMLParagraphElement>('info');
const zoomSelect = byId<HTMLSelectElement>('zoom');

let map: MapFile | undefined;
let sheet: TerrainSheet | undefined;
let mapName = '';

const TERRAIN_NAMES = [
  'Desert',
  'Plains',
  'Grassland',
  'Forest',
  'Hills',
  'Mountains',
  'Tundra',
  'Glacier',
  'Swamp',
  'Jungle',
  'Ocean',
];

function describe(m: MapFile): string {
  const h = m.header;
  const starts = m.startPositions.filter((p) => p !== null).length;
  return (
    `${mapName}: ${h.widthX2}×${h.height} game squares (${m.columns} stored columns), ` +
    `${h.area} squares, ${h.flatEarth ? 'flat' : 'round'} world, resource seed ${h.resourceSeed}, ` +
    `${starts} start positions`
  );
}

function redraw(): void {
  if (!map) return;
  drawMap(canvas, map, Number(zoomSelect.value), sheet);
  info.textContent = `${describe(map)}\nHover a square for details.`;
}

function showError(name: string, err: unknown): void {
  info.textContent = `Could not read ${name}: ${err instanceof Error ? err.message : String(err)}`;
}

byId<HTMLInputElement>('mapFile').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  void file
    .arrayBuffer()
    .then((buf) => {
      map = parseMap(new Uint8Array(buf));
      mapName = file.name;
      redraw();
    })
    .catch((err: unknown) => showError(file.name, err));
});

byId<HTMLInputElement>('terrainFile').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  void loadTerrainSheet(file)
    .then((s) => {
      sheet = s;
      redraw();
    })
    .catch((err: unknown) => showError(file.name, err));
});

zoomSelect.addEventListener('change', redraw);

canvas.addEventListener('mousemove', (e) => {
  if (!map) return;
  const rect = canvas.getBoundingClientRect();
  const hit = hitTest(map, Number(zoomSelect.value), e.clientX - rect.left, e.clientY - rect.top);
  if (!hit) return;
  const s = decodeSquare(map, hit.index);
  const g = toGameCoords(hit.c, hit.y);
  const flags = [
    s.river && 'river',
    s.road && 'road',
    s.railroad && 'railroad',
    s.irrigation && 'irrigation',
    s.farmland && 'farmland',
    s.mine && 'mine',
    s.city && 'city',
    s.fortress && 'fortress',
    s.airbase && 'airbase',
    s.pollution && 'pollution',
    s.resourceFlag && 'resource-flag',
  ]
    .filter(Boolean)
    .join(', ');
  const terrain = TERRAIN_NAMES[s.terrain] ?? `terrain ${s.terrain}`;
  info.textContent =
    `${describe(map)}\nsquare x=${g.x} y=${g.y} (stored col ${hit.c}, row ${hit.y})  ${terrain}` +
    `  landmass ${s.landmassId}  fertility ${s.fertility}${flags ? `  [${flags}]` : ''}`;
});
