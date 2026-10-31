/**
 * Entry point of the browser viewer.
 *
 * Step 1: the player picks their own game folder; RULES.TXT and the sprite sheets are read in
 * the browser and never leave the machine. Step 2: they pick a map (.MP) or a save/scenario
 * (.SAV/.SCN) and the world is drawn with the original tiles, cities and units. Hovering a
 * square shows what the parsers decoded for it. Contains no game rules.
 */
import { World } from '@mudbrick/engine';
import {
  decodeSquare,
  parseMap,
  parseSave,
  toGameCoords,
  type MapFile,
  type SaveFile,
} from '@mudbrick/formats';
import { installDevLoader } from './devLoader.js';
import { loadGameFolder, type GameFolder } from './gameFiles.js';
import { drawMap, hitTest } from './mapRenderer.js';
import { worldFromSave } from './worldFromSave.js';
import { drawWorld, WORLD_TOP_PAD } from './worldRenderer.js';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

const canvas = byId<HTMLCanvasElement>('map');
const info = byId<HTMLParagraphElement>('info');
const status = byId<HTMLSpanElement>('status');
const zoomSelect = byId<HTMLSelectElement>('zoom');
const showUnits = byId<HTMLInputElement>('showUnits');
const showCities = byId<HTMLInputElement>('showCities');

let folder: GameFolder | undefined;
let map: MapFile | undefined;
let save: SaveFile | undefined;
let world: World | undefined;
let sourceName = '';

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

function headline(): string {
  if (save && world) {
    const h = save.map.header;
    const humans = world.civs.filter((c) => c.isHuman).map((c) => c.name);
    return (
      `${sourceName}: save version ${save.version}, turn ${save.parameters.turn}, ` +
      `${h.widthX2}×${h.height} ${h.flatEarth ? 'flat' : 'round'} world, ` +
      `${world.cities.length} cities, ${world.units.length} units, human: ${humans.join(', ') || '?'}` +
      (save.scenario ? `, scenario "${save.scenario.name}"` : '')
    );
  }
  if (save) {
    return `${sourceName}: save version ${save.version}, turn ${save.parameters.turn}. Pick the game folder to draw cities and units.`;
  }
  if (map) {
    const h = map.header;
    return `${sourceName}: ${h.widthX2}×${h.height} game squares, ${h.area} squares, ${h.flatEarth ? 'flat' : 'round'} world, resource seed ${h.resourceSeed}`;
  }
  return 'Choose a .MP map or a .SAV/.SCN game from your own copy.';
}

function redraw(): void {
  const zoom = Number(zoomSelect.value);
  if (world && folder) {
    drawWorld(canvas, world, folder, {
      zoom,
      showUnits: showUnits.checked,
      showCities: showCities.checked,
    });
  } else if (map) {
    const terrain = folder?.sheets.TERRAIN1;
    drawMap(canvas, map, zoom, terrain ? { image: terrain.canvas } : undefined);
  }
  info.textContent = `${headline()}\nHover a square for details.`;
}

function showError(name: string, err: unknown): void {
  info.textContent = `Could not read ${name}: ${err instanceof Error ? err.message : String(err)}`;
}

function applyFolder(f: GameFolder): void {
  folder = f;
  const sheets = Object.keys(f.sheets).join(', ');
  status.textContent = `rules loaded (${f.rules.units.length} unit types); sheets: ${sheets || 'none'}`;
  if (save) world = worldFromSave(save, f.rules);
  redraw();
}

function applyGame(name: string, bytes: Uint8Array): void {
  sourceName = name;
  if (name.toLowerCase().endsWith('.mp')) {
    map = parseMap(bytes);
    save = undefined;
    world = undefined;
  } else {
    save = parseSave(bytes);
    map = save.map;
    world = folder ? worldFromSave(save, folder.rules) : undefined;
  }
  redraw();
}

byId<HTMLInputElement>('folder').addEventListener('change', (e) => {
  const list = (e.target as HTMLInputElement).files;
  if (!list || list.length === 0) return;
  status.textContent = 'reading folder…';
  loadGameFolder(list)
    .then(applyFolder)
    .catch((err: unknown) => {
      status.textContent = '';
      showError('game folder', err);
    });
});

byId<HTMLInputElement>('gameFile').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  file
    .arrayBuffer()
    .then((buf) => applyGame(file.name, new Uint8Array(buf)))
    .catch((err: unknown) => showError(file.name, err));
});

zoomSelect.addEventListener('change', redraw);
showUnits.addEventListener('change', redraw);
showCities.addEventListener('change', redraw);

if (import.meta.env.DEV) {
  installDevLoader(byId<HTMLSpanElement>('dev'), {
    onFolder: applyFolder,
    onGame: applyGame,
    onError: showError,
  });
}

canvas.addEventListener('mousemove', (e) => {
  if (!map) return;
  const rect = canvas.getBoundingClientRect();
  const zoom = Number(zoomSelect.value);
  const topPad = world && folder ? WORLD_TOP_PAD : 0;
  const hit = hitTest(map, zoom, e.clientX - rect.left, e.clientY - rect.top - topPad * zoom);
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
    s.fortress && 'fortress',
    s.airbase && 'airbase',
    s.pollution && 'pollution',
  ]
    .filter(Boolean)
    .join(', ');
  const terrain = TERRAIN_NAMES[s.terrain] ?? `terrain ${s.terrain}`;
  let line = `square x=${g.x} y=${g.y}  ${terrain}  landmass ${s.landmassId}${flags ? `  [${flags}]` : ''}`;
  if (world) {
    const city = world.cityAt(g.x, g.y);
    if (city) {
      const owner = world.civs[city.owner]?.adjective ?? `slot ${city.owner}`;
      const built = city.improvements
        .map((has, i) => (has ? folder?.rules.improvements[i]?.name : undefined))
        .filter(Boolean)
        .join(', ');
      line += `\n${owner} city "${city.name}" size ${city.size}${built ? `: ${built}` : ''}`;
    }
    const units = world.unitsAt(g.x, g.y);
    if (units.length > 0) {
      const names = units
        .slice(0, 6)
        .map((u) => {
          const owner = world?.civs[u.owner]?.adjective ?? String(u.owner);
          const type = folder?.rules.units[u.type]?.name ?? `type ${u.type}`;
          return `${owner} ${type}${u.veteran ? ' (vet)' : ''}`;
        })
        .join(', ');
      line += `\n${units.length} unit${units.length > 1 ? 's' : ''}: ${names}${units.length > 6 ? ', …' : ''}`;
    }
  }
  info.textContent = `${headline()}\n${line}`;
});
