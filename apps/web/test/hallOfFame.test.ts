import { describe, expect, it } from 'vitest';
import { fameLines, placeFameEntry, type FameEntry } from '../src/hallOfFame.js';

const entry = (score: number): FameEntry => ({
  name: 'N',
  tribe: 'T',
  score,
  difficulty: 2,
  turn: 100,
  year: '500 AD',
  cheated: false,
});

describe('hall of fame', () => {
  it('keeps the six best, highest first', () => {
    let list: FameEntry[] = [];
    for (const s of [10, 50, 30, 70, 20, 60, 40, 5]) list = placeFameEntry(list, entry(s));
    expect(list.map((e) => e.score)).toEqual([70, 60, 50, 40, 30, 20]);
    expect(fameLines(list)[1]).toContain('Prince');
  });
});
