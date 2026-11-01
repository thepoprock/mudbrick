import { describe, expect, it } from 'vitest';
import {
  blankMap,
  decodeSquare,
  paintSquare,
  parseMap,
  serializeMap,
  squareIndex,
} from '../src/map.js';

describe('writing a map', () => {
  it('reads back what was painted', () => {
    const map = blankMap(40, 50, false, 77);
    const i = squareIndex(map, 3, 4);
    paintSquare(map, i, { terrain: 2, river: true });
    map.startPositions[5] = { x: 6, y: 4 };
    const back = parseMap(serializeMap(map));
    expect(back.header).toEqual(map.header);
    expect(back.startPositions[5]).toEqual({ x: 6, y: 4 });
    expect(back.startPositions[0]).toBeNull();
    expect(decodeSquare(back, i).terrain).toBe(2);
    expect(decodeSquare(back, i).river).toBe(true);
    expect(decodeSquare(back, 0).terrain).toBe(10);
  });
});
