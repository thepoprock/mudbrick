import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeSquare, parseMap, squareAt, toGameCoords, toStorageCoords } from '../src/map.js';
import { gameFilesWithExtension, hasGameFiles } from './helpers.js';

function synthetic(widthX2: number, height: number): Uint8Array {
  const columns = widthX2 / 2;
  const area = columns * height;
  const b = new Uint8Array(14 + 84 + area * 6);
  const v = new DataView(b.buffer);
  v.setUint16(0, widthX2, true);
  v.setUint16(2, height, true);
  v.setUint16(4, area, true);
  v.setUint16(6, 1, true);
  v.setUint16(8, 7, true);
  v.setUint16(10, Math.ceil(widthX2 / 4), true);
  v.setUint16(12, Math.ceil(height / 4), true);
  for (let i = 0; i < 21; i++) {
    v.setUint16(14 + 2 * i, 0xffff, true);
    v.setUint16(14 + 42 + 2 * i, 0xffff, true);
  }
  v.setUint16(14, 3, true);
  v.setUint16(14 + 42, 1, true); // civ 0 starts at game (3, 1)
  const o = 98 + 6 * (1 * columns + 1); // stored column 1, row 1
  b[o] = 0x80 | 10; // ocean with river bit
  b[o + 1] = 0b0011_1100; // irrigation + mine (= farmland), road + railroad
  b[o + 3] = 5;
  b[o + 5] = 0x23;
  return b;
}

describe('parseMap (synthetic)', () => {
  const m = parseMap(synthetic(8, 4));

  it('reads the header and start positions', () => {
    expect(m.columns).toBe(4);
    expect(m.rows).toBe(4);
    expect(m.header.flatEarth).toBe(true);
    expect(m.startPositions[0]).toEqual({ x: 3, y: 1 });
    expect(m.startPositions[1]).toBeNull();
  });

  it('decodes a square', () => {
    const s = squareAt(m, 1, 1);
    expect(s.terrain).toBe(10);
    expect(s.river).toBe(true);
    expect(s.road).toBe(true);
    expect(s.railroad).toBe(true);
    expect(s.farmland).toBe(true);
    expect(s.irrigation).toBe(false);
    expect(s.landmassId).toBe(5);
    expect(s.fertility).toBe(3);
    expect(s.ownershipRaw).toBe(2);
    expect(decodeSquare(m, 0).terrain).toBe(0);
  });

  it('converts coordinates both ways', () => {
    expect(toGameCoords(1, 1)).toEqual({ x: 3, y: 1 });
    expect(toStorageCoords({ x: 3, y: 1 })).toEqual({ c: 1, y: 1 });
    expect(() => toStorageCoords({ x: 2, y: 1 })).toThrow(RangeError);
  });

  it('rejects wrong sizes', () => {
    expect(() => parseMap(synthetic(8, 4).subarray(0, 100))).toThrow();
  });
});

describe.skipIf(!hasGameFiles)('parseMap (shipped .MP files)', () => {
  const files = hasGameFiles ? gameFilesWithExtension('.mp') : [];

  it('finds the preset and scenario maps', () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  for (const f of files) {
    it(`parses ${basename(f)} consistently`, () => {
      const m = parseMap(new Uint8Array(readFileSync(f)));
      expect(m.header.locatorWidth).toBe(Math.ceil(m.header.widthX2 / 4));
      expect(m.header.locatorHeight).toBe(Math.ceil(m.rows / 4));
      let land = 0;
      for (let i = 0; i < m.header.area; i++) {
        const s = decodeSquare(m, i);
        expect(s.terrain).toBeLessThanOrEqual(10);
        if (s.terrain !== 10) land++;
      }
      expect(land).toBeGreaterThan(0);
      expect(land).toBeLessThan(m.header.area);
      for (const p of m.startPositions) {
        if (!p) continue;
        expect(p.x).toBeLessThan(m.header.widthX2);
        expect(p.y).toBeLessThan(m.rows);
        expect((p.x + p.y) & 1).toBe(0);
      }
    });
  }
});
