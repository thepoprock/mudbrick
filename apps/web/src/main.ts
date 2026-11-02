/**
 * Entry point of the browser app: the title screen, the new game questions, and the handover to
 * the play session. The player's own game folder supplies the rules and art; files are read in
 * the browser and never leave the machine.
 */
import { Game, isSnapshot, newGame, restoreGame, Rng, snapshotGame, World } from '@mudbrick/engine';
import {
  decodeSquare,
  blankMap,
  paintSquare,
  parseMap,
  serializeMap,
  parseSave,
  sprites,
  toGameCoords,
  type MapFile,
  type SaveFile,
  decodeText,
  parseEvents,
} from '@mudbrick/formats';
import { gameFromSave } from './gameFromSave.js';
import {
  loadGameFolder,
  loadGameFolderFromFiles,
  loadGameFolderFromUrl,
  type GameFolder,
  withScenarioFolder,
} from './gameFiles.js';
import { fameLines, readFame } from './hallOfFame.js';
import { drawMap, hitTest } from './mapRenderer.js';
import { NetLink } from './net.js';
import { PlaySession } from './play.js';
import { downloadBytes, saveFromGame } from './saveFromGame.js';
import { filesOf, pickFolder, rememberedFolder } from './ui/folderStore.js';
import './ui/game.css';
import { addButton, askList, askNumber, askText, openWindow, tell } from './ui/windows.js';
import { engineRules, worldFromMap, worldFromSave } from './worldFromSave.js';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

const canvas = byId<HTMLCanvasElement>('map');
const editCanvas = byId<HTMLCanvasElement>('editCanvas');

let folder: GameFolder | undefined;
let map: MapFile | undefined;
let save: SaveFile | undefined;
let saveBytes: Uint8Array | undefined;
let world: World | undefined;
let session: PlaySession | undefined;
let sourceName = '';
/** The loaded map is the world for the next new game. */
let premade = false;

function showScreen(which: 'title' | 'game' | 'editor'): void {
  byId('titleScreen').hidden = which !== 'title';
  byId('game').hidden = which !== 'game';
  byId('editor').hidden = which !== 'editor';
}

/** The game has a session: on to the map. */
function enterGame(): void {
  showScreen('game');
  session?.refresh();
  const s = session;
  if (s?.selected) s.centreOn(s.selected.position);
}

function leaveGame(): void {
  session?.dispose();
  session = undefined;
  save = undefined;
  saveBytes = undefined;
  map = undefined;
  world = undefined;
  premade = false;
  showScreen('title');
  renderTitle();
}

function saveGame(): void {
  if (!session) return;
  const base = sourceName.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-');
  const turn = session.game.state.turn;
  if (save && saveBytes) {
    const bytes = saveFromGame(saveBytes, save, session.game);
    downloadBytes(bytes, `${base}-turn${turn}.SAV`);
    session.log(`Saved ${base}-turn${turn}.SAV (${bytes.length} bytes).`);
  } else {
    // A game started here: Mudbrick's own format, which Load Game reads back.
    const text = snapshotGame(session.game, session.humanSlot);
    downloadBytes(new TextEncoder().encode(text), `${base}-turn${turn}.mudbrick.json`);
    session.log(`Saved ${base}-turn${turn}.mudbrick.json.`);
  }
  session.refresh();
}

function openSession(game: Game, slot: number): PlaySession {
  if (!folder) throw new Error('no game folder');
  return new PlaySession(game, folder, slot, {
    canvas,
    minimap: byId('minimap'),
    menuBar: byId('menuBar'),
    status: byId('status'),
    unitPanel: byId('unitPanel'),
    cityPanel: byId('cityWindow'),
    log: byId('log'),
    onSave: saveGame,
    onLoad: chooseGameFile,
    onJoin: joinNetwork,
    onQuit: leaveGame,
  });
}

/** The stone of the panels and windows, from the player's own sheet. */
async function applyStone(f: GameFolder): Promise<void> {
  const icons = f.sheets.ICONS;
  if (!icons) return;
  const cut = async (r: sprites.Rect) => {
    const c = new OffscreenCanvas(r.w, r.h);
    c.getContext('2d')?.drawImage(icons.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    return URL.createObjectURL(await c.convertToBlob());
  };
  const root = document.documentElement.style;
  const stone = `url(${await cut(sprites.PANEL_INNER)})`;
  root.setProperty('--stone-inner', stone);
  root.setProperty('--stone-outer', stone);
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
  void applyStone(f);
  void f.art('CIV2ART.DLL', 30000, true).then((url) => {
    if (url) byId('titleScreen').style.backgroundImage = `url(${url})`;
  });
  if (save) world = worldFromSave(save, f.rules);
  renderTitle();
}

/** The folder (upper case, trailing slash) a picked file sits in, from the folder listing or its own path. */
function folderOf(name: string, f: GameFolder): string {
  const upper = name.toUpperCase();
  const hit = f.paths.find((p) => p === upper || p.endsWith('/' + upper)) ?? upper;
  return hit.includes('/') ? hit.slice(0, hit.lastIndexOf('/') + 1) : '';
}

/** A picked file: a Mudbrick save, a saved game or scenario, or a map for a new game. */
async function openGameFile(name: string, bytes: Uint8Array): Promise<void> {
  sourceName = name;
  if (!folder) {
    await tell('Choose your game folder first.');
    return;
  }
  if (name.toLowerCase().endsWith('.json')) {
    const text = new TextDecoder().decode(bytes);
    if (!isSnapshot(text)) {
      await tell(`${name} is not a Mudbrick save.`);
      return;
    }
    session?.dispose();
    const restored = restoreGame(text, engineRules(folder.rules));
    save = undefined;
    saveBytes = undefined;
    map = undefined;
    world = restored.game.world;
    session = openSession(restored.game, restored.humanSlot);
    attachByFile(session);
    session.log(`Loaded ${name} at turn ${restored.game.state.turn}.`);
    enterGame();
    return;
  }
  if (name.toLowerCase().endsWith('.mp')) {
    map = parseMap(bytes);
    save = undefined;
    world = undefined;
    premade = true;
    await startWizard(false);
    return;
  }
  session?.dispose();
  session = undefined;
  save = parseSave(bytes);
  saveBytes = bytes;
  map = save.map;
  // A scenario's own folder supplies its RULES.TXT and sheets (VERIFIED: the original reads
  // them from there when present, else from the game folder).
  const dir = folderOf(name, folder);
  if (dir !== folder.prefix) applyFolder(await withScenarioFolder(folder, dir));
  world = worldFromSave(save, folder.rules);
  await startPlay();
}

function chooseGameFile(): void {
  byId<HTMLInputElement>('gameFile').click();
}

function selectValue(id: string): number {
  return Number(byId<HTMLSelectElement>(id).value);
}

/** The custom map box's limits (VERIFIED 0x00413cdb): each side 20 to 250, area 1000 to 10000. */
function customSize(columns: number, rows: number): [number, number] {
  let c = Math.min(250, Math.max(20, Math.floor(columns) || 50));
  let r = Math.min(250, Math.max(20, Math.floor(rows) || 80));
  while (c * r < 1000) {
    if (c < 250) c++;
    else r++;
  }
  while (c * r > 10000) {
    if (c > 20) c--;
    else r--;
  }
  return [c, r];
}

/** "New game": a random world from the panel's settings, then play as the chosen tribe. */
function startNewGame(opponents?: Map<number, number | null>): void {
  if (!folder) return;
  const size = byId<HTMLSelectElement>('ngSize').value;
  const [columns, rows] =
    size === 'custom'
      ? customSize(
          Number(byId<HTMLInputElement>('ngColumns').value),
          Number(byId<HTMLInputElement>('ngRows').value),
        )
      : size.split('x').map(Number);
  const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
  const rng = new Rng(seed);
  const rules = engineRules(folder.rules);
  const result = newGame(rules, rng, {
    map: {
      columns: columns ?? 50,
      rows: rows ?? 80,
      flatEarth: byId<HTMLInputElement>('ngFlat').checked,
      ...worldChoices(rng),
    },
    difficulty: selectValue('ngDifficulty'),
    civCount: selectValue('ngCivs') || 3 + rng.nextInt(5),
    ...(opponents ? { chooseOpponent: (slot: number) => opponents.get(slot) ?? null } : {}),
    ...(map && premade
      ? { premade: worldFromMap(map, folder.rules), startSites: map.startPositions }
      : {}),
    ...(byId<HTMLSelectElement>('ngGender').value
      ? { humanFemale: byId<HTMLSelectElement>('ngGender').value === 'f' }
      : {}),
    humanTribe: selectValue('ngTribe'),
    customTribe: {
      leader: byId<HTMLInputElement>('ngLeader').value.trim(),
      name: byId<HTMLInputElement>('ngTribeName').value.trim(),
      adjective: byId<HTMLInputElement>('ngAdjective').value.trim(),
      titles: byId<HTMLInputElement>('ngTitles')
        .value.split(',')
        .map((t) => t.trim()),
      ...(byId<HTMLSelectElement>('ngStyle').value
        ? { cityStyle: Number(byId<HTMLSelectElement>('ngStyle').value) }
        : {}),
    },
    leaders: folder.rules.leaders,
    barbarianActivity: selectValue('ngBarb'),
    ...(byId<HTMLInputElement>('ngSimple').checked ? { realisticCombat: false } : {}),
    ...(byId<HTMLInputElement>('ngBloodlust').checked ? { bloodlust: true } : {}),
    ...(byId<HTMLInputElement>('ngNoRestart').checked ? { noRestart: true } : {}),
    ...(selectValue('ngStart') > 0 ? { accelerated: selectValue('ngStart') - 1 } : {}),
  });
  save = undefined;
  saveBytes = undefined;
  map = undefined;
  world = result.world;
  sourceName = `New game ${seed.toString(16)}`;
  // Hot seat: the first civilizations after the chosen one become humans too (HOTSEAT1).
  let extra = selectValue('ngHumans') - 1;
  for (const c of result.world.civs) {
    if (extra <= 0 || c.slot === 0 || !c.inPlay || c.isHuman) continue;
    c.isHuman = true;
    extra -= 1;
  }
  const byFile = byId<HTMLInputElement>('ngByFile').checked;
  const game = new Game(result.world, rules, rng, {
    ...result.state,
    nextSlot: 0,
    ...(byFile ? { byFile } : {}),
    ...multiplayerOptions(),
  });
  game.introduceHumans();
  session = openSession(game, result.humanSlot);
  attachByFile(session);
  for (const n of result.notes) session.log(`${n}.`);
  enterGame();
  void session?.playVideo('OPENING');
}

/**
 * A scenario's events: the EVENTS.TXT beside the picked .SCN/.SAV inside the game folder (the
 * original reads it from the scenario's folder when the scenario loads), parsed with the save's
 * civilization names and the rules' unit names, then SCENARIOLOADED runs.
 */
async function attachScenarioEvents(
  game: Game,
  loaded: SaveFile,
  gameFolder: GameFolder,
  name: string,
): Promise<string[]> {
  const lines: string[] = [];
  if (game.state.scenarioEvents) {
    // The save's own EVNT block (VERIFIED: the loader skips EVENTS.TXT when a save brought events).
    lines.push(`${game.state.scenarioEvents.length} scenario events restored from the save.`);
  } else {
    // The picked file's folder: from the folder listing when the file was picked by name alone
    // (the player path), else from the path itself (the dev loader keeps it).
    const eventsPath = folderOf(name, gameFolder) + 'EVENTS.TXT';
    const blob = await gameFolder.file(eventsPath);
    if (!blob) return [];
    const text = decodeText(new Uint8Array(await blob.arrayBuffer()));
    const tribes: (string | undefined)[] = ['Barbarians'];
    for (const n of loaded.civNames) tribes[n.slot] = n.plural;
    const parsed = parseEvents(text, { tribes, units: gameFolder.rules.units.map((u) => u.name) });
    if (!parsed.ok) return [`${eventsPath}: rejected — ${parsed.error} (line ${parsed.line}).`];
    game.loadEvents(parsed.events);
    lines.push(`${parsed.events.length} scenario events loaded from ${eventsPath}.`);
  }
  for (const e of game.scenarioLoaded()) {
    const ev = e.event;
    if (ev.kind === 'scenario-text') lines.push(ev.lines.join(' '));
    else if (ev.kind === 'scenario-track') lines.push(`(music: CD track ${ev.track})`);
    else if (ev.kind === 'scenario-sound') lines.push(`(sound: ${ev.file})`);
    else if (ev.kind === 'scenario-note') lines.push(`Scenario: ${ev.text}.`);
  }
  return lines;
}

async function startPlay(): Promise<void> {
  if (!save || !world || !folder) return;
  const game = gameFromSave(save, folder.rules, world);
  const eventLines = await attachScenarioEvents(game, save, folder, sourceName);
  const human =
    world.civs.find((c) => c.isHuman && c.slot !== 0) ??
    world.civs.find((c) => c.slot === save?.parameters.humanSlot);
  if (!human) {
    await tell('This save has no human civilization to play.');
    return;
  }
  session = openSession(game, human.slot);
  for (const line of eventLines) session.log(line);
  enterGame();
}

byId<HTMLInputElement>('folder').addEventListener('change', (e) => {
  const list = (e.target as HTMLInputElement).files;
  if (!list || list.length === 0) return;
  byId('titleNote').textContent = 'Reading your game folder…';
  loadGameFolder(list)
    .then(applyFolder)
    .catch((err: unknown) => {
      byId('titleNote').textContent = err instanceof Error ? err.message : String(err);
    });
});

byId<HTMLInputElement>('gameFile').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  file
    .arrayBuffer()
    .then((buf) => openGameFile(file.name, new Uint8Array(buf)))
    .catch((err: unknown) => {
      void tell(`Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    })
    .finally(() => {
      input.value = '';
    });
});

window.addEventListener('keydown', (e) => {
  if (session?.handleKey(e)) e.preventDefault();
});

canvas.addEventListener('click', (e) => {
  session?.handleClick(e.clientX, e.clientY);
});

// ---- the map editor (Civ2Map.exe's job): paints a `.MP` file directly
function redrawEditor(): void {
  if (!map) return;
  const terrain = folder?.sheets.TERRAIN1;
  drawMap(editCanvas, map, 1, terrain ? { image: terrain.canvas } : undefined);
}

function fillBrushes(): void {
  const brush = byId<HTMLSelectElement>('edBrush');
  if (!folder || brush.options.length > 0) return;
  const add = (value: string, text: string) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    brush.append(o);
  };
  folder.rules.terrain.slice(0, 11).forEach((t, i) => add(`t${i}`, t.name));
  add('river', 'River on or off');
  folder.rules.leaders.forEach((l, i) => add(`s${i}`, `Start: ${l.plural}`));
}

editCanvas.addEventListener('click', (e) => {
  if (!map) return;
  const rect = editCanvas.getBoundingClientRect();
  const hit = hitTest(map, 1, e.clientX - rect.left, e.clientY - rect.top);
  if (!hit) return;
  const brush = byId<HTMLSelectElement>('edBrush').value;
  const index = hit.index;
  if (brush.startsWith('t')) paintSquare(map, index, { terrain: Number(brush.slice(1)) });
  else if (brush === 'river') paintSquare(map, index, { river: !decodeSquare(map, index).river });
  else if (brush.startsWith('s'))
    map.startPositions[Number(brush.slice(1))] = toGameCoords(hit.c, hit.y);
  redrawEditor();
});

byId<HTMLButtonElement>('edBack').addEventListener('click', () => {
  map = undefined;
  showScreen('title');
});

byId<HTMLButtonElement>('edNew').addEventListener('click', () => {
  const [columns, rows] = byId<HTMLSelectElement>('edSize').value.split('x').map(Number);
  map = blankMap(columns ?? 50, rows ?? 80, false, 1 + Math.floor(Math.random() * 0x7fff));
  save = undefined;
  world = undefined;
  redrawEditor();
});

byId<HTMLButtonElement>('edSave').addEventListener('click', () => {
  if (map) downloadBytes(serializeMap(map), 'MAP.MP');
});

/** Play by file: the end of a turn saves the game for the next player to open. */
function attachByFile(s: PlaySession): void {
  if (!s.game.state.byFile) return;
  s.seat = s.game.state.movingHuman ?? s.humanSlot;
  s.onTurnPassed = (moving) => {
    const text = snapshotGame(s.game, moving);
    const who = s.game.civ(moving).name;
    downloadBytes(new TextEncoder().encode(text), `${who}-turn-${s.game.state.turn}.json`);
    s.log(`Saved for the ${who}. Send them the file.`);
  };
}

/**
 * The world's character. VERIFIED 0x004140ae and 0x00550970: each of the four rolls one of three,
 * and the land form stays varied unless a one in three makes it follow the land mass.
 */
function worldChoices(rng: Rng) {
  if (!byId<HTMLInputElement>('ngRandomWorld').checked)
    return {
      landMass: selectValue('ngLand'),
      landForm: selectValue('ngForm'),
      climate: selectValue('ngClimate'),
      temperature: selectValue('ngTemp'),
      age: selectValue('ngAge'),
    };
  const roll = () => rng.nextInt(3) - 1;
  const land = roll();
  const form = rng.nextInt(3) === 0 ? land : 0;
  return {
    landMass: land + 1,
    landForm: form,
    temperature: roll(),
    climate: roll(),
    age: roll() + 1,
  };
}

/** The Select Multiplayer Features choices (dialog ADVANCEDMP) from the new game panel. */
function multiplayerOptions() {
  const on = (id: string) => byId<HTMLInputElement>(id).checked;
  if (selectValue('ngHumans') < 2) return {};
  return {
    ...(on('ngSimultaneous') ? { simultaneous: true } : {}),
    ...(on('ngDoubleProduction') ? { doubleProduction: true } : {}),
    ...(on('ngDoubleMoves') ? { doubleMoves: true } : {}),
    ...(on('ngShowStarts') ? { showHumanStarts: true } : {}),
    ...(on('ngKillRetire') ? { killOnRetirement: true } : {}),
    ...(on('ngOpenGame') ? { openGame: true } : {}),
  };
}

// ---- network play: a room on a relay, one seat per browser (apps/relay, net.ts)
let net: NetLink | undefined;

function restoreFrom(text: string, seat: number): void {
  if (!folder) return;
  const restored = restoreGame(text, engineRules(folder.rules));
  const moving = restored.game.state.movingHuman ?? seat;
  world = restored.game.world;
  session = openSession(
    restored.game,
    restored.game.state.simultaneous || moving === seat ? seat : moving,
  );
  attachNet(session, seat);
  if (restored.game.joinHuman(seat)) {
    session.log(`You take over the ${restored.game.civ(seat).name}.`);
    net?.sendState(snapshotGame(restored.game, moving), moving);
  }
  if (moving === seat) session.log('Your move.');
  else session.log(`Waiting for the ${restored.game.civ(moving).name}.`);
  enterGame();
}

function attachNet(s: PlaySession, seat: number): void {
  s.seat = seat;
  s.humanSlot = seat;
  s.takeSeat();
  s.onTurnPassed = (moving) => net?.sendState(snapshotGame(s.game, moving), moving);
  s.onChat = (text, to, anonymous) => net?.chat(text, to, anonymous);
  if (!s.game.state.byFile) s.game.state.networkGame = true;
  s.onLock = () => net?.lock();
  s.onRelease = () => {
    net?.sendState(snapshotGame(s.game, seat), seat);
    net?.unlock();
  };
}

function join(): void {
  const url = byId<HTMLInputElement>('netUrl').value;
  const room = byId<HTMLInputElement>('netRoom').value;
  const seat = Number(byId<HTMLInputElement>('netSeat').value);
  net = new NetLink(url, room, seat, (m) => {
    if (m.type === 'lock') session?.lockGranted();
    if (m.type === 'state' && m.text) {
      if (session?.game.state.simultaneous && folder)
        session.adopt(restoreGame(m.text, engineRules(folder.rules)).game);
      else if (m.moving === seat) restoreFrom(m.text, seat);
      else if (!session) restoreFrom(m.text, seat);
    }
    if (m.type === 'seats') {
      byId('netStatus').textContent = `seats: ${(m.seats ?? []).join(', ')}`;
      session?.seatsChanged(m.seats ?? []);
    }
    if (m.type === 'error') byId('netStatus').textContent = m.message ?? 'error';
    if (m.type === 'chat') {
      session?.log(m.seat === -1 ? `Unsigned: ${m.text}` : `Seat ${m.seat}: ${m.text}`);
      session?.refresh();
    }
  });
  if (session) {
    attachNet(session, seat);
    const s = session;
    window.setTimeout(() => {
      net?.sendState(snapshotGame(s.game, s.humanSlot), s.game.state.movingHuman ?? seat);
    }, 300);
  }
}

/** One question from a select of the setup form, worded by the folder's own Game.txt. */
async function askSelect(id: string, popup: string, fallback: string): Promise<boolean> {
  const select = byId<HTMLSelectElement>(id);
  const title = folder?.popups.get(popup)?.title ?? fallback;
  const options = Array.from(select.options);
  const pick = await askList(
    title,
    '',
    options.map((o) => ({ label: o.textContent ?? '' })),
    { selected: Math.max(0, select.selectedIndex), width: 400, accept: 'Next' },
  );
  if (pick === null) return false;
  select.selectedIndex = pick;
  return true;
}

/** Tick boxes and the rarer settings, on one page. */
function askRules(): Promise<boolean> {
  return new Promise((resolve) => {
    const home = byId('newGamePanel');
    const parts = Array.from(home.querySelectorAll<HTMLElement>('label')).filter(
      (l) =>
        l.querySelector('input[type=checkbox]') !== null &&
        !l.querySelector('#ngFlat, #ngOnMap, #ngRandomWorld'),
    );
    const start = byId('ngStart').closest('label') as HTMLElement | null;
    const humans = byId('ngHumans').closest('label') as HTMLElement | null;
    const finish = (ok: boolean) => {
      for (const p of [...parts, start, humans]) if (p) home.append(p);
      win.close();
      resolve(ok);
    };
    const win = openWindow({
      title: 'Customize Rules',
      width: 620,
      onCancel: () => finish(false),
      onAccept: () => finish(true),
    });
    const grid = document.createElement('div');
    grid.className = 'optionGrid';
    for (const p of [start, humans, ...parts]) if (p) grid.append(p);
    win.body.append(grid);
    addButton(win, 'Next', () => finish(true));
    addButton(win, 'Cancel', () => finish(false));
  });
}

/** Select Computer Opponents (dialog OPPONENT): the tribe for each colour, or Random. */
async function askOpponents(f: GameFolder): Promise<Map<number, number | null> | null> {
  const picks = new Map<number, number | null>();
  for (let slot = 1; slot < 8; slot++) {
    const tribes = f.rules.leaders.filter((l) => l.color === slot);
    if (tribes.length === 0) continue;
    const pick = await askList(
      `Opponent for colour ${slot}`,
      '',
      [{ label: 'Random' }, ...tribes.map((t) => ({ label: t.plural }))],
      { accept: 'Next' },
    );
    if (pick === null) return null;
    picks.set(slot, pick === 0 ? null : (tribes[pick - 1]?.index ?? null));
  }
  return picks;
}

/** The new game questions, in the original's order. A cancel goes back to the title screen. */
async function startWizard(customize: boolean): Promise<void> {
  const f = folder;
  if (!f) return;
  byId<HTMLInputElement>('ngRandomWorld').checked = false;
  if (!premade) {
    if (!(await askSelect('ngSize', 'SIZEOFMAP', 'Select Size of World'))) return;
    if (byId<HTMLSelectElement>('ngSize').value === 'custom') {
      const columns = await askNumber('Custom World', 'Map width (20 to 250)', 50);
      const rows = await askNumber('Custom World', 'Map height (20 to 250)', 80);
      if (columns === null || rows === null) return;
      byId<HTMLInputElement>('ngColumns').value = String(columns);
      byId<HTMLInputElement>('ngRows').value = String(rows);
    }
    if (customize) {
      if (!(await askSelect('ngLand', 'CUSTOMLAND', 'Land Mass'))) return;
      if (!(await askSelect('ngForm', 'CUSTOMFORM', 'Land Form'))) return;
      if (!(await askSelect('ngClimate', 'CUSTOMCLIMATE', 'Climate'))) return;
      if (!(await askSelect('ngTemp', 'CUSTOMTEMP', 'Temperature'))) return;
      if (!(await askSelect('ngAge', 'CUSTOMAGE', 'Age'))) return;
    }
  }
  if (!(await askSelect('ngDifficulty', 'DIFFICULTY', 'Select Difficulty Level'))) return;
  if (!(await askSelect('ngCivs', 'ENEMIES', 'Select Level Of Competition'))) return;
  if (!(await askSelect('ngBarb', 'BARBARITY', 'Select Level Of Barbarian Activity'))) return;
  const rules = await askList(
    f.popups.get('RULES')?.title ?? 'Select Game Rules',
    '',
    (f.popups.get('RULES')?.entries ?? ['Use Standard Rules', 'Customize Rules']).map((label) => ({
      label,
    })),
    { accept: 'Next', width: 400 },
  );
  if (rules === null) return;
  if (rules === 1 && !(await askRules())) return;
  if (!(await askSelect('ngGender', 'GENDER', 'Select Gender'))) return;
  if (!(await askSelect('ngTribe', 'TRIBE', 'Select Your Tribe'))) return;
  const leader = f.rules.leaders[byId<HTMLSelectElement>('ngTribe').selectedIndex];
  const female = byId<HTMLSelectElement>('ngGender').value === 'f';
  const name = await askText(
    f.popups.get('NAME')?.title ?? 'Please Enter Your Name',
    'Name',
    (female ? leader?.femaleName : undefined) ?? leader?.name ?? '',
    { maxLength: 23 },
  );
  if (name === null) return;
  byId<HTMLInputElement>('ngLeader').value = name.trim();
  if (rules === 1 && byId<HTMLInputElement>('ngOpponents').checked) {
    const picks = await askOpponents(f);
    if (picks === null) return;
    startNewGame(picks);
    return;
  }
  startNewGame();
}

function showFame(): void {
  void tell(fameLines(readFame()).join('\n') || 'No scores yet.', 'Hall of Fame');
}

function showEditor(): void {
  showScreen('editor');
  fillBrushes();
  if (!map) {
    map = blankMap(50, 80, false, 1 + Math.floor(Math.random() * 0x7fff));
    save = undefined;
    world = undefined;
  }
  redrawEditor();
}

function joinNetwork(): void {
  const panel = byId('netPanel');
  const home = byId('setup');
  const done = () => {
    home.append(panel);
    win.close();
  };
  const win = openWindow({ title: 'Multiplayer Game', width: 420, onCancel: done });
  win.body.append(panel);
  addButton(win, 'Join', () => {
    join();
    done();
  });
  addButton(win, 'Cancel', done);
}

async function chooseFolder(): Promise<void> {
  const note = byId('titleNote');
  try {
    const handle = await pickFolder();
    if (!handle) {
      byId<HTMLInputElement>('folder').click();
      return;
    }
    note.textContent = 'Reading your game folder…';
    applyFolder(await loadGameFolderFromFiles(await filesOf(handle)));
  } catch (err) {
    note.textContent = err instanceof Error ? err.message : String(err);
  }
}

async function resumeFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  const note = byId('titleNote');
  try {
    if ((await handle.requestPermission({ mode: 'read' })) !== 'granted') return;
    note.textContent = 'Reading your game folder…';
    applyFolder(await loadGameFolderFromFiles(await filesOf(handle)));
  } catch (err) {
    note.textContent = err instanceof Error ? err.message : String(err);
  }
}

let remembered: FileSystemDirectoryHandle | null = null;

function renderTitle(): void {
  const menu = byId('titleMenu');
  menu.replaceChildren();
  const add = (label: string, run: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', run);
    menu.append(b);
  };
  const note = byId('titleNote');
  if (!folder) {
    if (remembered) {
      const handle = remembered;
      add(`Continue with ${handle.name}`, () => void resumeFolder(handle));
    }
    add('Choose Your Game Folder', () => void chooseFolder());
    return;
  }
  note.textContent = `${folder.rules.units.length} unit types loaded from your copy.`;
  add('Start a New Game', () => {
    premade = false;
    map = undefined;
    void startWizard(false);
  });
  add('Start on Premade World', () => {
    chooseGameFile();
  });
  add('Customize World', () => {
    premade = false;
    map = undefined;
    void startWizard(true);
  });
  add('Load a Game', chooseGameFile);
  add('Multiplayer Game', joinNetwork);
  add('Map Editor', showEditor);
  add('View Hall of Fame', showFame);
}

byId<HTMLSelectElement>('ngSize').addEventListener('change', (e) => {
  byId('ngCustomSize').hidden = (e.target as HTMLSelectElement).value !== 'custom';
});

/** Starts: the remembered folder is offered; development reads the dev-game link at once. */
async function boot(): Promise<void> {
  remembered = await rememberedFolder();
  renderTitle();
  if (!import.meta.env.DEV) return;
  // For automated checks of screens that are slow to reach by clicking.
  (window as unknown as { mudbrick: () => PlaySession | undefined }).mudbrick = () => session;
  const f = await loadGameFolderFromUrl('/dev-game/').catch(() => undefined);
  if (!f) return;
  applyFolder(f);
  // ?game=NAME opens that file straight away, for screenshots and tests.
  const name = new URLSearchParams(location.search).get('game');
  if (!name) return;
  const res = await fetch(`/dev-game/${name}`);
  if (res.ok) await openGameFile(name, new Uint8Array(await res.arrayBuffer()));
}

void boot();
