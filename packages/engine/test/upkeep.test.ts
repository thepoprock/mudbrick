import { describe, expect, it } from 'vitest';
import { GOVERNMENT, IMPROVEMENT, type EngineRules } from '../src/rules.js';
import { improvementUpkeep, payUpkeep, GUNPOWDER, MOBILE_WARFARE } from '../src/upkeep.js';
import { CITY_CENTRE_INDEX, type City, type Civ } from '../src/world.js';

const rules = {
  improvements: Array.from({ length: 67 }, (_, i) => ({
    name: `i${i}`,
    costRows: 4,
    upkeep:
      i === IMPROVEMENT.barracks ||
      i === IMPROVEMENT.temple ||
      i === IMPROVEMENT.library ||
      i === IMPROVEMENT.marketplace
        ? 1
        : i === IMPROVEMENT.courthouse
          ? 1
          : i === IMPROVEMENT.cathedral
            ? 3
            : 2,
  })),
  advances: Array.from({ length: 100 }, () => ({
    name: 'a',
    preq1: { kind: 'none' as const },
    preq2: { kind: 'none' as const },
    epoch: 0,
    category: 0,
  })),
} as unknown as EngineRules;

function civ(over: Partial<Civ> = {}): Civ {
  return {
    slot: 1,
    tribe: 0,
    name: 'T',
    adjective: 'T',
    leader: 'T',
    cityStyle: 0,
    epoch: 0,
    colour: 1,
    government: GOVERNMENT.monarchy,
    treasury: 100,
    isHuman: true,
    inPlay: true,
    scienceStored: 0,
    researching: null,
    advancesCount: 0,
    futureTechs: 0,
    scienceRate: 5,
    taxRate: 3,
    knownAdvances: Array<boolean>(100).fill(false),
    freeAdvancePending: false,
    ...over,
  };
}
function city(improvements: number[]): City {
  const imps = Array<boolean>(67).fill(false);
  for (const i of improvements) imps[i] = true;
  return {
    id: 0,
    position: { x: 2, y: 2 },
    owner: 1,
    name: 'Ur',
    size: 4,
    improvements: imps,
    foodStored: 0,
    shieldsStored: 0,
    worked: 1 << CITY_CENTRE_INDEX,
    specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
    production: { kind: 'unit', index: 0 },
    inDisorder: false,
    celebrating: false,
    tradeRoutes: [],
  };
}
const ctx = { difficulty: 2, ownsWonder: () => false, shieldRows: 10 };

describe('improvement upkeep (verified)', () => {
  it('raises Barracks upkeep with Gunpowder and Mobile Warfare and waives it at low difficulty', () => {
    const c = civ();
    expect(improvementUpkeep(rules, c, IMPROVEMENT.barracks, ctx)).toBe(1);
    expect(improvementUpkeep(rules, c, IMPROVEMENT.barracks, { ...ctx, difficulty: 0 })).toBe(0);
    c.knownAdvances[GUNPOWDER] = true;
    expect(improvementUpkeep(rules, c, IMPROVEMENT.barracks, ctx)).toBe(2);
    c.knownAdvances[MOBILE_WARFARE] = true;
    expect(improvementUpkeep(rules, c, IMPROVEMENT.barracks, ctx)).toBe(3);
  });
  it("Adam Smith's pays one-gold buildings; Fundamentalism exempts the faith buildings", () => {
    const c = civ();
    const smith = { ...ctx, ownsWonder: (i: number) => i === IMPROVEMENT.adamSmiths };
    expect(improvementUpkeep(rules, c, IMPROVEMENT.temple, smith)).toBe(0);
    expect(improvementUpkeep(rules, c, IMPROVEMENT.cathedral, smith)).toBe(3);
    c.government = GOVERNMENT.fundamentalism;
    expect(improvementUpkeep(rules, c, IMPROVEMENT.cathedral, ctx)).toBe(0);
    expect(improvementUpkeep(rules, c, IMPROVEMENT.colosseum, ctx)).toBe(0);
    expect(improvementUpkeep(rules, c, IMPROVEMENT.university, ctx)).toBe(2);
  });
});

describe('paying upkeep (verified)', () => {
  it('pays in index order and sells the first unaffordable improvement for its shield cost', () => {
    const c = civ({ treasury: 3 });
    const town = city([
      IMPROVEMENT.temple,
      IMPROVEMENT.marketplace,
      IMPROVEMENT.library,
      IMPROVEMENT.courthouse,
    ]);
    const ev = payUpkeep(rules, c, town, ctx);
    expect(ev.map((e) => e.kind)).toEqual(['paid', 'paid', 'paid', 'sold']);
    expect(town.improvements[IMPROVEMENT.courthouse]).toBe(false);
    expect(c.treasury).toBe(40);
  });
  it('pays nothing under Anarchy', () => {
    const c = civ({ treasury: 0, government: GOVERNMENT.anarchy });
    const town = city([IMPROVEMENT.temple]);
    expect(payUpkeep(rules, c, town, ctx)).toEqual([]);
    expect(town.improvements[IMPROVEMENT.temple]).toBe(true);
  });
});
