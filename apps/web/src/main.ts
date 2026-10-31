/**
 * Entry point of the browser app.
 *
 * Viewer: the player picks their own game folder (RULES.TXT and the sprite sheets are read in the
 * browser and never leave the machine), then a map (.MP) or a save/scenario (.SAV/.SCN); the world
 * is drawn with the original tiles. Play: with a save loaded, "Play" hands the human civilization
 * to the player — orders, movement, cities, research and the end of turn go through the engine.
 */
import { Game, isSnapshot, newGame, restoreGame, Rng, snapshotGame, World } from '@mudbrick/engine';
import {
  decodeSquare,
  parseMap,
  parseSave,
  toGameCoords,
  type MapFile,
  type SaveFile,
} from '@mudbrick/formats';
import { installDevLoader } from './devLoader.js';
import { gameFromSave } from './gameFromSave.js';
import { loadGameFolder, type GameFolder } from './gameFiles.js';
import { drawMap, hitTest } from './mapRenderer.js';
import { PlaySession } from './play.js';
import { downloadBytes, saveFromGame } from './saveFromGame.js';
import { engineRules, worldFromSave } from './worldFromSave.js';
import { drawWorld, WORLD_TOP_PAD } from './worldRenderer.js';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

const canvas = byId<HTMLCanvasElement>('map');
const info = byId<HTMLParagraphElement>('info');
const statusLine = byId<HTMLSpanElement>('statusLine');
const zoomSelect = byId<HTMLSelectElement>('zoom');
const showUnits = byId<HTMLInputElement>('showUnits');
const showCities = byId<HTMLInputElement>('showCities');
const playButton = byId<HTMLButtonElement>('play');
const endTurnButton = byId<HTMLButtonElement>('endTurn');
const saveButton = byId<HTMLButtonElement>('save');
const newGameButton = byId<HTMLButtonElement>('newGame');

let folder: GameFolder | undefined;
let map: MapFile | undefined;
let save: SaveFile | undefined;
let saveBytes: Uint8Array | undefined;
let world: World | undefined;
let session: PlaySession | undefined;
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

function renderOptions() {
  return {
    zoom: Number(zoomSelect.value),
    showUnits: showUnits.checked,
    showCities: showCities.checked,
    // Fog of war: while playing, only what the human's civilization has seen is drawn.
    ...(session ? { viewer: session.humanSlot } : {}),
  };
}

function headline(): string {
  if (session) {
    return `${sourceName}: playing the ${session.civ.name}. Click a unit or city; keys are listed under "Selected unit".`;
  }
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
  if (session) {
    session.refresh();
  } else if (world && folder) {
    drawWorld(canvas, world, folder, renderOptions());
  } else if (map) {
    const terrain = folder?.sheets.TERRAIN1;
    drawMap(canvas, map, Number(zoomSelect.value), terrain ? { image: terrain.canvas } : undefined);
  }
  info.textContent = `${headline()}\nHover a square for details.`;
  playButton.disabled = !(world && folder && save) || session !== undefined;
  newGameButton.disabled = !folder || session !== undefined;
  endTurnButton.disabled = session === undefined;
  saveButton.disabled = session === undefined;
}

function showError(name: string, err: unknown): void {
  info.textContent = `Could not read ${name}: ${err instanceof Error ? err.message : String(err)}`;
}

function applyFolder(f: GameFolder): void {
  folder = f;
  const difficulty = byId<HTMLSelectElement>('ngDifficulty');
  difficulty.replaceChildren(
    ...f.rules.difficulty.map((name, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = name;
      o.selected = i === 2;
      return o;
    }),
  );
  const tribe = byId<HTMLSelectElement>('ngTribe');
  tribe.replaceChildren(
    ...f.rules.leaders.map((l) => {
      const o = document.createElement('option');
      o.value = String(l.index);
      o.textContent = `${l.plural} (${l.name})`;
      return o;
    }),
  );
  const sheets = Object.keys(f.sheets).join(', ');
  statusLine.textContent = `rules loaded (${f.rules.units.length} unit types); sheets: ${sheets || 'none'}`;
  if (save) world = worldFromSave(save, f.rules);
  session = undefined;
  redraw();
}

function applyGame(name: string, bytes: Uint8Array): void {
  sourceName = name;
  session = undefined;
  if (name.toLowerCase().endsWith('.json')) {
    const text = new TextDecoder().decode(bytes);
    if (!isSnapshot(text)) {
      info.textContent = `${name} is not a Mudbrick save.`;
      return;
    }
    if (!folder) {
      info.textContent = 'Pick the game folder first; a Mudbrick save needs its rules and tiles.';
      return;
    }
    const restored = restoreGame(text, engineRules(folder.rules));
    save = undefined;
    saveBytes = undefined;
    map = undefined;
    world = restored.game.world;
    session = new PlaySession(
      restored.game,
      folder,
      restored.humanSlot,
      {
        canvas,
        status: byId('status'),
        unitPanel: byId('unitPanel'),
        cityPanel: byId('cityPanel'),
        researchPanel: byId('researchPanel'),
        log: byId('log'),
      },
      renderOptions,
    );
    session.log(`Loaded ${name} at turn ${restored.game.state.turn}.`);
    redraw();
    if (session.selected) session.centreOn(session.selected.position);
    return;
  }
  if (name.toLowerCase().endsWith('.mp')) {
    map = parseMap(bytes);
    save = undefined;
    world = undefined;
  } else {
    save = parseSave(bytes);
    saveBytes = bytes;
    map = save.map;
    world = folder ? worldFromSave(save, folder.rules) : undefined;
  }
  redraw();
}

function selectValue(id: string): number {
  return Number(byId<HTMLSelectElement>(id).value);
}

/** "New game": a random world from the panel's settings, then play as the chosen tribe. */
function startNewGame(): void {
  if (!folder) return;
  const [columns, rows] = byId<HTMLSelectElement>('ngSize').value.split('x').map(Number);
  const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
  const rng = new Rng(seed);
  const rules = engineRules(folder.rules);
  const result = newGame(rules, rng, {
    map: {
      columns: columns ?? 50,
      rows: rows ?? 80,
      flatEarth: byId<HTMLInputElement>('ngFlat').checked,
      landMass: selectValue('ngLand'),
      landForm: selectValue('ngForm'),
      climate: selectValue('ngClimate'),
      temperature: selectValue('ngTemp'),
      age: selectValue('ngAge'),
    },
    difficulty: selectValue('ngDifficulty'),
    civCount: selectValue('ngCivs'),
    humanTribe: selectValue('ngTribe'),
    leaders: folder.rules.leaders,
    barbarianActivity: selectValue('ngBarb'),
  });
  save = undefined;
  saveBytes = undefined;
  map = undefined;
  world = result.world;
  sourceName = `New game ${seed.toString(16)}`;
  const game = new Game(result.world, rules, rng, result.state);
  session = new PlaySession(
    game,
    folder,
    result.humanSlot,
    {
      canvas,
      status: byId('status'),
      unitPanel: byId('unitPanel'),
      cityPanel: byId('cityPanel'),
      researchPanel: byId('researchPanel'),
      log: byId('log'),
    },
    renderOptions,
  );
  for (const n of result.notes) session.log(`${n}.`);
  byId<HTMLDetailsElement>('newGamePanel').open = false;
  redraw();
  if (session.selected) session.centreOn(session.selected.position);
}

function startPlay(): void {
  if (!save || !world || !folder) return;
  const game = gameFromSave(save, folder.rules, world);
  const human =
    world.civs.find((c) => c.isHuman && c.slot !== 0) ??
    world.civs.find((c) => c.slot === save?.parameters.humanSlot);
  if (!human) {
    info.textContent = 'This save has no human civilization to play.';
    return;
  }
  session = new PlaySession(
    game,
    folder,
    human.slot,
    {
      canvas,
      status: byId('status'),
      unitPanel: byId('unitPanel'),
      cityPanel: byId('cityPanel'),
      researchPanel: byId('researchPanel'),
      log: byId('log'),
    },
    renderOptions,
  );
  redraw();
  if (session.selected) session.centreOn(session.selected.position);
}

byId<HTMLInputElement>('folder').addEventListener('change', (e) => {
  const list = (e.target as HTMLInputElement).files;
  if (!list || list.length === 0) return;
  statusLine.textContent = 'reading folder…';
  loadGameFolder(list)
    .then(applyFolder)
    .catch((err: unknown) => {
      statusLine.textContent = '';
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

playButton.addEventListener('click', startPlay);
newGameButton.addEventListener('click', startNewGame);
endTurnButton.addEventListener('click', () => session?.endTurn());
saveButton.addEventListener('click', () => {
  if (!session) return;
  const base = sourceName.replace(/\.[^.]+$/, '');
  const turn = session.game.state.turn;
  if (save && saveBytes) {
    const bytes = saveFromGame(saveBytes, save, session.game);
    downloadBytes(bytes, `${base}-turn${turn}.SAV`);
    session.log(`Saved ${base}-turn${turn}.SAV (${bytes.length} bytes).`);
  } else {
    // A game started here: Mudbrick's own format (reload it through "Map or game").
    const text = snapshotGame(session.game, session.humanSlot);
    downloadBytes(new TextEncoder().encode(text), `${base}-turn${turn}.mudbrick.json`);
    session.log(`Saved ${base}-turn${turn}.mudbrick.json.`);
  }
  session.refresh();
});
zoomSelect.addEventListener('change', redraw);
showUnits.addEventListener('change', redraw);
showCities.addEventListener('change', redraw);

window.addEventListener('keydown', (e) => {
  if (!session) return;
  if (session.handleKey(e)) e.preventDefault();
});

canvas.addEventListener('click', (e) => {
  if (!session) return;
  session.handleClick(e.clientX, e.clientY);
});

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
      line += `\n${owner} city "${city.name}" size ${city.size}`;
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
