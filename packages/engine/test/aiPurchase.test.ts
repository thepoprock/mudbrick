import { describe, expect, it } from 'vitest';
import { computerPurchase, purchaseShare, type PurchaseContext } from '../src/aiPurchase.js';
import type { EngineRules } from '../src/rules.js';
import { CITY_CENTRE_INDEX, World, type City, type Civ } from '../src/world.js';

const rules = {
  units: [{ role: 1 }, { role: 5 }],
} as unknown as EngineRules;

function setup(treasury: number) {
  const world = new World({ columns: 10, rows: 10, flatEarth: true });
  const city: City = {
    id: 0,
    position: { x: 4, y: 4 },
    owner: 2,
    name: 'A',
    size: 5,
    improvements: Array<boolean>(67).fill(false),
    foodStored: 0,
    shieldsStored: 10,
    worked: 1 << CITY_CENTRE_INDEX,
    specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
    production: { kind: 'improvement', index: 40 },
    inDisorder: false,
    celebrating: false,
    tradeRoutes: [],
  };
  world.cities.push(city);
  const civ = { slot: 2, treasury } as Civ;
  const ctx: PurchaseContext = {
    surplus: 5,
    cost: 400,
    difficulty: 2,
    topHumanRank: 3,
    mainTreasury: 5000,
    plan: 2,
    wonderTally: () => ({ mine: 1, humanLowest: 0, humanHighest: 3, main: 0 }),
    anyHumanLaunched: false,
    spaceRacePressure: false,
    unitCount: () => 0,
  };
  return { world, city, civ, ctx };
}

describe('computer purchases (0x004b7e74)', () => {
  it('wonders draw on the treasury by the era tally', () => {
    const { world, city, civ, ctx } = setup(1600);
    expect(purchaseShare(world, rules, city, civ, ctx)).toBe(1600 >> 7);
    const first = {
      ...ctx,
      wonderTally: () => ({ mine: 0, humanLowest: 0, humanHighest: 3, main: 0 }),
    };
    expect(purchaseShare(world, rules, city, civ, first)).toBe(1600 >> 6);
    const ahead = {
      ...ctx,
      wonderTally: () => ({ mine: 5, humanLowest: 0, humanHighest: 3, main: 0 }),
    };
    expect(purchaseShare(world, rules, city, civ, ahead)).toBe(1600 >> 8);
  });

  it('shields rise by the share and the treasury pays less the difficulty refund', () => {
    const { world, city, civ, ctx } = setup(1600);
    expect(computerPurchase(world, rules, city, civ, ctx)).toBe(12);
    expect(city.shieldsStored).toBe(22);
    // 2 × 12 / 10 = 2, / (8 − 3) = 0
    expect(civ.treasury).toBe(1588);
  });

  it('an attacked city buys its defender with an eighth of the treasury, up to the price', () => {
    const { world, city, civ, ctx } = setup(800);
    city.production = { kind: 'unit', index: 0 };
    city.attacked = true;
    expect(purchaseShare(world, rules, city, civ, { ...ctx, cost: 30 })).toBe(20);
    expect(purchaseShare(world, rules, city, civ, { ...ctx, cost: 500 })).toBe(100);
  });

  it('a unit that fits the land mass plan draws a sixty-fourth, and nothing is spent idly', () => {
    const { world, city, civ, ctx } = setup(640);
    world.units.push({ position: { x: 4, y: 4 } } as never);
    city.production = { kind: 'unit', index: 1 };
    expect(purchaseShare(world, rules, city, civ, { ...ctx, plan: 1 })).toBe(0);
    city.production = { kind: 'unit', index: 0 };
    expect(purchaseShare(world, rules, city, civ, { ...ctx, plan: 1 })).toBe(10);
  });
});
