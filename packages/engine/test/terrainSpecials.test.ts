import { describe, expect, it } from 'vitest';
import {
  grasslandShieldAt,
  hutPattern,
  specialAt,
  specialPattern,
} from '../src/terrainSpecials.js';
import { SquareFlag, World } from '../src/world.js';

describe('special resources and huts (verified formulas)', () => {
  it('places exactly one special per 16 diagonal cells and never on grassland or suppressed squares', () => {
    let count = 0;
    let total = 0;
    for (let y = 0; y < 120; y++) {
      for (let x = y & 1; x < 150; x += 2) {
        total++;
        if (specialPattern(x, y, 33, 0) !== 0) count++;
      }
    }
    expect(count / total).toBeGreaterThan(1 / 16 - 0.01);
    expect(count / total).toBeLessThan(1 / 16 + 0.01);
    expect(specialPattern(10, 10, 33, 2)).toBe(0);
    let hit: [number, number] | undefined;
    for (let y = 0; y < 20 && !hit; y++) {
      for (let x = y & 1; x < 40; x += 2) {
        if (specialPattern(x, y, 33, 0) !== 0) {
          hit = [x, y];
          break;
        }
      }
    }
    expect(hit).toBeDefined();
    if (hit) expect(specialPattern(hit[0], hit[1], 33, 0, true)).toBe(0);
  });

  it('splits specials into first and second kinds by the seed', () => {
    const kinds = new Set<number>();
    for (let y = 0; y < 60; y++)
      for (let x = y & 1; x < 100; x += 2) kinds.add(specialPattern(x, y, 7, 0));
    expect(kinds).toEqual(new Set([0, 1, 2]));
  });

  it('places roughly one hut per 32 cells', () => {
    let count = 0;
    let total = 0;
    for (let y = 0; y < 120; y++) {
      for (let x = y & 1; x < 150; x += 2) {
        total++;
        if (hutPattern(x, y, 33)) count++;
      }
    }
    expect(count / total).toBeGreaterThan(1 / 32 - 0.006);
    expect(count / total).toBeLessThan(1 / 32 + 0.006);
  });

  it('reads the suppression flag from the world', () => {
    const w = new World({ columns: 20, rows: 20, flatEarth: true, resourceSeed: 33 });
    w.terrain.fill(0);
    let found: { x: number; y: number } | undefined;
    for (let y = 0; y < 20 && !found; y++)
      for (let x = y & 1; x < 40; x += 2)
        if (specialAt(w, x, y) !== 0) {
          found = { x, y };
          break;
        }
    expect(found).toBeDefined();
    if (found) {
      w.setFlag(found.x, found.y, SquareFlag.NoSpecial);
      expect(specialAt(w, found.x, found.y)).toBe(0);
    }
  });

  it('puts the grassland shield on exactly half the squares in two-wide diagonal stripes', () => {
    let count = 0;
    let total = 0;
    for (let y = 0; y < 40; y++)
      for (let x = y & 1; x < 80; x += 2) {
        total++;
        if (grasslandShieldAt(x, y)) count++;
      }
    expect(count * 2).toBe(total);
    // Moving along a diagonal row (x+2, y) flips every two squares.
    const row = [0, 2, 4, 6, 8, 10, 12, 14].map((x) => grasslandShieldAt(x, 0));
    expect(row).toEqual([row[0], row[0], !row[0], !row[0], row[0], row[0], !row[0], !row[0]]);
  });
});
