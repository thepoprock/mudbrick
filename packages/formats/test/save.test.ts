import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeSquare } from '../src/map.js';
import { parseSave } from '../src/save.js';
import { gameFile, gameFilesWithExtension, hasGameFiles } from './helpers.js';

/**
 * Build a minimal but structurally complete version-40 save: one human, one unit, one city,
 * a 4×2 map, no scenario block. Sizes follow docs/formats/save-format.md exactly.
 */
function synthetic(): Uint8Array {
  const T = 100;
  const civRecordSize = 1428;
  const widthX2 = 8;
  const height = 2;
  const area = (widthX2 / 2) * height;
  const lx = Math.ceil(widthX2 / 4);
  const ly = Math.ceil(height / 4);
  const mapOff = 66 + 2 * T + 318 + 7 * 242 + 8 * civRecordSize; // 13702
  const unitsOff = mapOff + 14 + 13 * area + 2 * lx * ly + 1024;
  const citiesOff = unitsOff + 26;
  const otherOff = citiesOff + 84 + 63;
  const clickedOff = otherOff + 48 * 1 + 1314;
  const destroyedOff = clickedOff + 76;
  const b = new Uint8Array(destroyedOff + 338);
  const v = new DataView(b.buffer);
  b.set(
    Array.from('CIVILIZE', (c) => c.charCodeAt(0)),
    0,
  );
  b[9] = 0x1a;
  b[10] = 40;
  v.setUint16(24 + 4, 12, true); // turn
  b[24 + 15] = 3; // human slot
  b[24 + 20] = 2; // difficulty
  b[24 + 22] = 0b0000_1110; // slots 1-3 in play
  b[24 + 23] = 0b0000_1000; // slot 3 human
  v.setUint16(24 + 34, 1, true); // units
  v.setUint16(24 + 36, 1, true); // cities
  v.setInt16(66 + 2 * T, 7, true); // Pyramids in city 7
  v.setInt16(66 + 2 * T + 2, -2, true); // Hanging Gardens destroyed
  const names = 66 + 2 * T + 318 + 242 * 2; // slot 3
  b.set(
    Array.from('Hatshepsut', (c) => c.charCodeAt(0)),
    names + 2,
  );
  const civ3 = 66 + 2 * T + 318 + 7 * 242 + civRecordSize * 3;
  v.setUint16(civ3 + 2, 250, true); // treasury
  b[civ3 + 21] = 2; // monarchy
  b[civ3 + 88] = 0b0000_0101; // knows advances 0 and 2
  v.setUint16(mapOff, widthX2, true);
  v.setUint16(mapOff + 2, height, true);
  v.setUint16(mapOff + 4, area, true);
  v.setUint16(mapOff + 10, lx, true);
  v.setUint16(mapOff + 12, ly, true);
  b[mapOff + 14 + 7 * area + 6 * 1] = 2; // square 1 = grassland
  v.setUint16(unitsOff, 3, true); // unit at (3,1)
  v.setUint16(unitsOff + 2, 1, true);
  b[unitsOff + 5] = 0b0010_0000; // veteran
  b[unitsOff + 6] = 5; // type
  b[unitsOff + 7] = 3; // owner
  b[unitsOff + 11] = 0xff; // no last move
  v.setUint16(citiesOff, 2, true); // city at (2,0)
  b[citiesOff + 8] = 3; // owner
  b[citiesOff + 9] = 6; // size
  b.set(
    Array.from('Thebes', (c) => c.charCodeAt(0)),
    citiesOff + 32,
  );
  b[citiesOff + 52] = 0b0000_0010; // Palace
  b[citiesOff + 57] = 0xff; // producing improvement 1
  v.setInt16(clickedOff + 4, -3, true); // zoom
  v.setInt16(destroyedOff, 1, true); // one destroyed civ
  v.setInt16(destroyedOff + 2, 40, true);
  b.set(
    Array.from('Hittites', (c) => c.charCodeAt(0)),
    destroyedOff + 50,
  );
  return b;
}

describe('parseSave (synthetic v40)', () => {
  const s = parseSave(synthetic());

  it('reads header, parameters and offsets', () => {
    expect(s.version).toBe(40);
    expect(s.parameters.turn).toBe(12);
    expect(s.parameters.humanSlot).toBe(3);
    expect(s.parameters.humanSlots[3]).toBe(true);
    expect(s.parameters.slotsInPlay).toEqual([false, true, true, true, false, false, false, false]);
    expect(s.offsets.map).toBe(13702);
    expect(s.offsets.end).toBe(synthetic().byteLength);
    expect(s.scenario).toBeNull();
    expect(s.hasEvents).toBe(false);
    expect(s.warnings).toEqual([]);
  });

  it('reads wonders, names and civilization records', () => {
    expect(s.wonders[0]).toEqual({ improvementIndex: 39, cityId: 7, destroyed: false });
    expect(s.wonders[1]).toEqual({ improvementIndex: 40, cityId: null, destroyed: true });
    expect(s.civNames[2]?.leader).toBe('Hatshepsut');
    expect(s.civs[3]?.treasury).toBe(250);
    expect(s.civs[3]?.government).toBe(2);
    expect(s.civs[3]?.knownAdvances.slice(0, 4)).toEqual([true, false, true, false]);
  });

  it('exposes the map in .MP shape', () => {
    expect(s.map.columns).toBe(4);
    expect(decodeSquare(s.map, 1).terrain).toBe(2);
    expect(s.knowledge.byteLength).toBe(7 * 8);
  });

  it('reads units and cities', () => {
    expect(s.units[0]?.position).toEqual({ x: 3, y: 1 });
    expect(s.units[0]?.veteran).toBe(true);
    expect(s.units[0]?.type).toBe(5);
    expect(s.units[0]?.lastMoveDirection).toBeNull();
    expect(s.cities[0]?.name).toBe('Thebes');
    expect(s.cities[0]?.size).toBe(6);
    expect(s.cities[0]?.improvements[1]).toBe(true);
    expect(s.cities[0]?.improvements[2]).toBe(false);
    expect(s.cities[0]?.production).toEqual({ kind: 'improvement', index: 1 });
  });

  it('reads the trailing blocks', () => {
    expect(s.zoom).toBe(-3);
    expect(s.destroyed).toEqual([{ turn: 40, destroyedBy: 0, slot: 0, name: 'Hittites' }]);
  });

  it('rejects other formats', () => {
    const bad = synthetic();
    bad[10] = 50;
    expect(() => parseSave(bad)).toThrow(/Test of Time/);
    expect(() => parseSave(new Uint8Array(100))).toThrow(/magic/);
  });
});

describe.skipIf(!hasGameFiles)('parseSave (all shipped saves and scenarios)', () => {
  const files = hasGameFiles
    ? [...gameFilesWithExtension('.sav'), ...gameFilesWithExtension('.scn')]
    : [];

  it('finds all 42 shipped files', () => {
    expect(files).toHaveLength(42);
  });

  for (const f of files) {
    it(`walks ${basename(f)} to the byte`, () => {
      const s = parseSave(new Uint8Array(readFileSync(f)));
      expect([39, 40]).toContain(s.version);
      expect(s.warnings).toEqual([]);
      expect(s.offsets.end).toBe(s.offsets.events ?? readFileSync(f).byteLength);
      expect(s.scenario !== null).toBe(f.toLowerCase().endsWith('.scn'));
      for (const u of s.units) {
        if (!u.position) continue;
        expect(u.position.x).toBeLessThan(s.map.header.widthX2);
        expect(u.position.y).toBeLessThan(s.map.rows);
        expect((u.position.x + u.position.y) & 1).toBe(0);
      }
      for (const c of s.cities) {
        expect(c.position.x).toBeLessThan(s.map.header.widthX2);
        expect(c.position.y).toBeLessThan(s.map.rows);
        // Fan-made scenarios contain one city with an empty name (Santa) and sizes of 59 and
        // 127 (Atolon, Zeus) set in the editor, so only printability and the byte range are checked.
        // Names are Windows-1252 ("España" in Zeus), so only control characters are rejected.
        const codes = Array.from(c.name, (ch) => ch.charCodeAt(0));
        expect(codes.every((code) => code >= 0x20 && code !== 0x7f)).toBe(true);
        expect(c.size).toBeLessThanOrEqual(127);
      }
      for (let i = 0; i < s.map.header.area; i++) {
        expect(decodeSquare(s.map, i).terrain).toBeLessThanOrEqual(10);
      }
    });
  }

  it('matches known cities in the three top-level files', () => {
    const first = (name: string) => parseSave(gameFile(name)).cities[0]?.name;
    expect(first('TUTORIAL.SAV')).toBe('Moscow');
    expect(first('ROME.SCN')).toBe('Rome');
    expect(first('WWII.SCN')).toBe('Berlin');
  });

  it('reads real improvement bits: capitals hold a Palace', () => {
    const s = parseSave(gameFile('WWII.SCN'));
    const berlin = s.cities.find((c) => c.name === 'Berlin');
    expect(berlin?.improvements[1]).toBe(true);
  });
});
