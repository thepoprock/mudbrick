import { describe, expect, it } from 'vitest';
import { advanceValue, leadsTo, type ResearchValueContext } from '../src/aiResearch.js';
import type { EngineRules } from '../src/rules.js';

// Advances: 0 Alphabet, 1 Writing (needs 0), 2 Literacy (needs 1), 3 Masonry; the rest unreachable.
const adv = (name: string, p1: number, p2: number, aiValue: number, mod = 0) => ({
  name,
  preq1: p1 < 0 ? { kind: 'none' as const } : { kind: 'advance' as const, index: p1 },
  preq2: p2 < 0 ? { kind: 'none' as const } : { kind: 'advance' as const, index: p2 },
  epoch: 0,
  category: 0,
  aiValue,
  civilizedModifier: mod,
});
const advances = Array.from({ length: 100 }, (_, i) =>
  i === 0
    ? adv('Alphabet', -1, -1, 3)
    : i === 1
      ? adv('Writing', 0, -1, 4, 1)
      : i === 2
        ? adv('Literacy', 1, -1, 5)
        : i === 47
          ? adv('Masonry', -1, -1, 2)
          : { ...adv(`a${i}`, -1, -1, 1), preq1: { kind: 'never' as const } },
);
const rules = {
  cosmic: { aqueductSize: 8, sewerSize: 12 },
  advances,
  units: Array.from({ length: 62 }, () => ({ preq: { kind: 'none' } })),
  improvements: Array.from({ length: 67 }, () => ({ name: 'i', costRows: 1, upkeep: 0 })),
} as unknown as EngineRules;

function ctx(over: Partial<ResearchValueContext> = {}): ResearchValueContext {
  return {
    knows: () => false,
    knownBy: () => 0,
    humanMask: 2,
    isHuman: (s) => s === 1,
    atWar: () => false,
    advancesOf: () => 0,
    reputationOf: () => 0,
    civilize: 1,
    tribe: 13, // Mongols: no tastes
    largeMap: false,
    ownsWonder: () => false,
    wonderOwner: () => null,
    seaUnits: 0,
    maxCitySize: 3,
    ...over,
  };
}

describe('the research value (verified)', () => {
  it('walks the prerequisite tree', () => {
    expect(leadsTo(rules, 2, 0)).toBe(true);
    expect(leadsTo(rules, 2, 2)).toBe(true);
    expect(leadsTo(rules, 0, 2)).toBe(false);
    expect(leadsTo(rules, -1, 0)).toBe(false);
  });

  it('starts from modifier × civilize + value, +1 unknown to all, −1 per known advance it leads to', () => {
    // Writing: 1 × 1 + 4 = 5, nobody knows it: 6.
    expect(advanceValue(rules, 2, 1, ctx())).toBe(6);
    // Known to someone: 5; and when the player knows Literacy, which Writing leads to: 4.
    expect(advanceValue(rules, 2, 1, ctx({ knownBy: () => 2 }))).toBe(5);
    expect(advanceValue(rules, 2, 1, ctx({ knownBy: () => 2, knows: (_, a) => a === 2 }))).toBe(4);
    // Never below one.
    expect(advanceValue(rules, 2, 90, ctx({ knownBy: () => 2 }))).toBe(1);
  });

  it('applies the tribe tastes and the war-with-a-leading-human civilize penalty', () => {
    // Egyptians (3) favour Masonry (47) by 2: 2 + 1 + 2 = 5.
    expect(advanceValue(rules, 2, 47, ctx({ tribe: 3 }))).toBe(5);
    // At war with the human who leads and shares Masonry (the loop runs over advances 1 … 62,
    // so a shared Alphabet would not count): civilize 1 → 0, so Writing is 4 + 1.
    const war = ctx({
      atWar: (a, b) => a === 2 && b === 1,
      advancesOf: (s) => (s === 1 ? 3 : 1),
      knows: (_, a) => a === 47,
    });
    expect(advanceValue(rules, 2, 1, war)).toBe(5);
  });
});
