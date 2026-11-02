/**
 * Mudbrick's own save format: the whole engine state as JSON.
 *
 * The original-format writer patches a file the player already has; a game started here has
 * none, so it is saved as a `.mudbrick.json` document and reloaded from it. Typed arrays are
 * encoded as base64 with their kind; everything else is plain JSON.
 */
import { Game, type GameState } from './game.js';
import { Rng, type RngState } from './rng.js';
import type { EngineRules } from './rules.js';
import { World, type LocatorGrid } from './world.js';

export const SNAPSHOT_FORMAT = 'mudbrick-save';
export const SNAPSHOT_VERSION = 1;

export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  savedAt: string;
  humanSlot: number;
  rng: RngState;
  state: GameState;
  world: unknown;
}

const KINDS = {
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
} as const;
type KindName = keyof typeof KINDS;

function toBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  return Buffer.from(bytes).toString('base64');
}
function fromBase64(text: string): Uint8Array {
  if (typeof atob === 'function') {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(text, 'base64'));
}

function replacer(_key: string, value: unknown): unknown {
  for (const [name, ctor] of Object.entries(KINDS)) {
    if (value instanceof ctor) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return { __typed: name, b64: toBase64(bytes) };
    }
  }
  return value;
}
function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && '__typed' in value && 'b64' in value) {
    const v = value as { __typed: string; b64: string };
    const ctor = KINDS[v.__typed as KindName];
    if (!ctor) return value;
    const bytes = fromBase64(v.b64);
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return new ctor(copy.buffer, 0, copy.byteLength / ctor.BYTES_PER_ELEMENT);
  }
  return value;
}

/** Serialize a game to JSON text. */
export function snapshotGame(game: Game, humanSlot: number): string {
  const w = game.world;
  const snap: Snapshot = {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    humanSlot,
    rng: game.rng.state(),
    state: game.state,
    world: {
      columns: w.columns,
      rows: w.rows,
      flatEarth: w.flatEarth,
      resourceSeed: w.resourceSeed,
      terrain: w.terrain,
      flags: w.flags,
      landmass: w.landmass,
      locator: w.locator,
      seen: w.seen,
      territory: w.territory,
      visited: w.visited,
      fertility: w.fertility,
      civs: w.civs,
      cities: w.cities,
      units: w.units,
    },
  };
  return JSON.stringify(snap, replacer);
}

/** Is this text one of our saves? */
export function isSnapshot(text: string): boolean {
  return text.trimStart().startsWith('{') && text.includes(`"${SNAPSHOT_FORMAT}"`);
}

/** Rebuild a game from JSON text. */
export function restoreGame(text: string, rules: EngineRules): { game: Game; humanSlot: number } {
  const snap = JSON.parse(text, reviver) as Snapshot;
  if (snap.format !== SNAPSHOT_FORMAT) throw new Error('not a Mudbrick save');
  if (snap.version > SNAPSHOT_VERSION) throw new Error(`save version ${snap.version} is newer`);
  const sw = snap.world as {
    columns: number;
    rows: number;
    flatEarth: boolean;
    resourceSeed: number;
    terrain: Uint8Array;
    flags: Uint16Array;
    landmass: Uint8Array;
    locator?: LocatorGrid;
    seen: Uint8Array;
    territory: Uint8Array;
    visited?: Uint8Array;
    fertility: Uint8Array;
    civs: World['civs'];
    cities: World['cities'];
    units: World['units'];
  };
  const world = new World({
    columns: sw.columns,
    rows: sw.rows,
    flatEarth: sw.flatEarth,
    resourceSeed: sw.resourceSeed,
  });
  world.terrain.set(sw.terrain);
  world.flags.set(sw.flags);
  world.landmass.set(sw.landmass);
  if (sw.locator) world.locator = sw.locator;
  world.seen.set(sw.seen);
  world.territory.set(sw.territory);
  if (sw.visited) world.visited.set(sw.visited);
  world.fertility.set(sw.fertility);
  world.civs.push(...sw.civs);
  world.cities.push(...sw.cities);
  world.units.push(...sw.units);
  const game = new Game(world, rules, Rng.fromState(snap.rng), snap.state);
  return { game, humanSlot: snap.humanSlot };
}
