import { describe, expect, it } from 'vitest';
import { OCEAN, SquareFlag, World } from '../src/world.js';

describe('World', () => {
  const round = new World({ columns: 4, rows: 4, flatEarth: false }); // 8×4 game squares
  const flat = new World({ columns: 4, rows: 4, flatEarth: true });

  it('indexes squares and converts back', () => {
    expect(round.index(0, 0)).toBe(0);
    expect(round.index(3, 1)).toBe(5);
    expect(round.position(5)).toEqual({ x: 3, y: 1 });
    expect(() => round.index(1, 0)).toThrow(RangeError); // x + y odd
    expect(() => round.index(0, 4)).toThrow(RangeError); // below the map
  });

  it('wraps east-west only on round worlds', () => {
    expect(round.wrapX(8, 0)).toBe(0);
    expect(round.wrapX(-2, 0)).toBe(6);
    expect(flat.wrapX(8, 0)).toBeNull();
    expect(round.isSquare(9, 1)).toBe(true);
    expect(flat.isSquare(9, 1)).toBe(false);
  });

  it('lists eight neighbours clockwise from north with map edges as null', () => {
    const n = round.neighbours(2, 2);
    expect(n.map((p) => (p ? `${p.x},${p.y}` : '-'))).toEqual([
      '2,0',
      '3,1',
      '4,2',
      '3,3',
      '-',
      '1,3',
      '0,2',
      '1,1',
    ]);
    expect(round.neighbours(0, 2)[6]).toEqual({ x: 6, y: 2 }); // wraps west
    expect(flat.neighbours(0, 2)[6]).toBeNull();
  });

  it('stores terrain and flags', () => {
    expect(round.terrainAt(0, 0)).toBe(OCEAN);
    round.terrain[round.index(2, 0)] = 2;
    expect(round.isLand(2, 0)).toBe(true);
    round.setFlag(2, 0, SquareFlag.River);
    round.setFlag(2, 0, SquareFlag.Road);
    expect(round.hasFlag(2, 0, SquareFlag.River)).toBe(true);
    round.setFlag(2, 0, SquareFlag.River, false);
    expect(round.hasFlag(2, 0, SquareFlag.River)).toBe(false);
    expect(round.hasFlag(2, 0, SquareFlag.Road)).toBe(true);
  });

  it('finds cities and units by wrapped position', () => {
    round.cities.push({
      id: 0,
      position: { x: 6, y: 2 },
      owner: 1,
      name: 'Ur',
      size: 3,
      improvements: [],
      foodStored: 0,
      shieldsStored: 0,
      inDisorder: false,
    });
    expect(round.cityAt(-2, 2)?.name).toBe('Ur');
    expect(round.unitsAt(6, 2)).toEqual([]);
  });
});
