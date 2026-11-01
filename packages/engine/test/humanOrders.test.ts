import { describe, expect, it } from 'vitest';
import {
  buyCost,
  buyProduction,
  cycleSpecialist,
  maxRate,
  sellImprovement,
  setRates,
  toggleWorker,
} from '../src/humanOrders.js';
import { IMPROVEMENT, type EngineRules } from '../src/rules.js';
import type { City, Civ } from '../src/world.js';

const rules = {
  cosmic: { shieldBoxRows: 10 },
  units: [{ costRows: 3 }],
  improvements: Array.from({ length: 67 }, (_, i) => ({ costRows: i === 40 ? 30 : 6 })),
} as unknown as EngineRules;
function city(over: Partial<City> = {}): City {
  return {
    size: 6,
    shieldsStored: 10,
    production: { kind: 'unit', index: 0 },
    improvements: Array<boolean>(67).fill(false),
    worked: 1,
    specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
    inDisorder: false,
    ...over,
  } as unknown as City;
}
const civ = (over: Partial<Civ> = {}) =>
  ({ treasury: 1000, government: 1, taxRate: 3, scienceRate: 3, ...over }) as unknown as Civ;

describe('buying', () => {
  it('a unit costs rem² / 20 + 2 rem, doubled from an empty box', () => {
    expect(buyCost(rules, city())).toBe(20 + 40);
    expect(buyCost(rules, city({ shieldsStored: 0 }))).toBe((45 + 60) * 2);
  });
  it('an improvement is 2 a shield and a wonder 4', () => {
    expect(buyCost(rules, city({ production: { kind: 'improvement', index: 5 } }))).toBe(100);
    expect(buyCost(rules, city({ production: { kind: 'improvement', index: 40 } }))).toBe(1160);
  });
  it('fills the box, refuses units in disorder and Capitalization', () => {
    const c = city();
    const me = civ();
    expect(buyProduction(rules, me, c)).toBe(null);
    expect(c.shieldsStored).toBe(30);
    expect(me.treasury).toBe(940);
    expect(buyProduction(rules, me, city({ inDisorder: true }))).toBe('disorder');
    expect(buyCost(rules, city({ production: { kind: 'improvement', index: 38 } }))).toBe(null);
  });
});

describe('selling', () => {
  it('one a turn, never the Palace', () => {
    const c = city();
    c.improvements[IMPROVEMENT.temple] = true;
    c.improvements[IMPROVEMENT.library] = true;
    c.improvements[IMPROVEMENT.palace] = true;
    const me = civ();
    expect(sellImprovement(rules, me, c, IMPROVEMENT.palace)).toBe('palace');
    expect(sellImprovement(rules, me, c, IMPROVEMENT.temple)).toBe(null);
    expect(me.treasury).toBe(1060);
    expect(sellImprovement(rules, me, c, IMPROVEMENT.library)).toBe('sold-already');
  });
});

describe('rates', () => {
  it('each government has its limit', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(maxRate)).toEqual([6, 6, 7, 8, 8, 8, 10]);
  });
  it('rates stay in the limit and sum to at most ten', () => {
    const me = civ({ government: 2 });
    setRates(me, 9, 9);
    expect(me.taxRate).toBe(7);
    expect(me.scienceRate).toBe(3);
    setRates(me, 0, 0);
    expect(10 - me.taxRate - me.scienceRate).toBe(7);
  });
});

describe('workers', () => {
  it('freeing and taking back a square moves a citizen', () => {
    const c = city();
    expect(toggleWorker(c, 0)).toBe(true);
    expect(c.worked).toBe(0);
    expect(c.specialists.entertainers).toBe(1);
    expect(toggleWorker(c, 3)).toBe(true);
    expect(c.worked).toBe(8);
    expect(c.specialists.entertainers).toBe(0);
    expect(toggleWorker(c, 5)).toBe(false);
  });
  it('specialists cycle only from size 5', () => {
    const c = city({ specialists: { entertainers: 1, taxCollectors: 0, scientists: 0 } });
    expect(cycleSpecialist(c, 0)).toBe(true);
    expect(c.specialists.taxCollectors).toBe(1);
    expect(cycleSpecialist(city({ size: 4 }), 0)).toBe(false);
  });
});
