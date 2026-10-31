import { describe, expect, it } from 'vitest';
import { computeSupplyDemand, type SupplyDemandContext } from '../src/supplyDemand.js';
import { addRoute, suppliedOf, demandedOf } from '../src/trade.js';
import type { EngineRules } from '../src/rules.js';
import { CITY_CENTRE_INDEX, SquareFlag, World, type City } from '../src/world.js';

const rules = {
  cosmic: { roadMoveMultiplier: 3 },
  terrain: Array.from({ length: 11 }, () => ({
    moveCost: 1,
    defenceHalves: 2,
    food: 2,
    shields: 1,
    trade: 1,
    specials: [
      { food: 2, shields: 1, trade: 1 },
      { food: 2, shields: 1, trade: 1 },
    ],
    irrigate: { kind: 'no' },
    irrigateTurns: 5,
    mine: { kind: 'no' },
    mineTurns: 10,
    transformTo: { kind: 'no' },
  })),
  units: [],
  advances: [],
  improvements: Array.from({ length: 67 }, (_, i) => ({ name: `i${i}`, costRows: 4, upkeep: 1 })),
} as unknown as EngineRules;

function city(world: World, id: number, x: number, y: number, size: number): City {
  const c: City = {
    id,
    position: { x, y },
    owner: 1,
    name: `C${id}`,
    size,
    improvements: Array<boolean>(67).fill(false),
    foodStored: 0,
    shieldsStored: 0,
    worked: 1 << CITY_CENTRE_INDEX,
    specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
    production: { kind: 'unit', index: 0 },
    inDisorder: false,
    celebrating: false,
    tradeRoutes: [],
    lastTrade: 10,
  };
  world.cities.push(c);
  return c;
}
function ctx(over: Partial<SupplyDemandContext> = {}): SupplyDemandContext {
  return {
    turn: 10,
    knows: () => false,
    ownsWonder: () => false,
    advancesOf: () => 4,
    tribeOf: () => 0,
    combustionKnown: false,
    ...over,
  };
}

describe('supply and demand', () => {
  it('a grassland city with rivers supplies dye and wine and never both supplies and demands one', () => {
    const w = new World({ columns: 40, rows: 50, flatEarth: true });
    w.terrain.fill(2);
    w.landmass.fill(1);
    for (let x = 18; x <= 22; x += 2) w.setFlag(x, 24, SquareFlag.River, true);
    const c = city(w, 0, 20, 24, 5);
    computeSupplyDemand(w, rules, c, ctx());
    const s = Array.from(suppliedOf(c));
    const d = Array.from(demandedOf(c));
    expect(s).toHaveLength(3);
    expect(d).toHaveLength(3);
    expect(s[0]).toBe(7); // Dye: grassland × 5 + rivers, doubled
    for (const x of s) if (x >= 0) expect(d).not.toContain(x);
    // The middle demanded entry is the position hash (24 × 5 + 20 × 3) % 14 = 180 % 14 = 12 (Gems).
    expect(d[1]).toBe(12);
    // The middle supplied entry: (24 × 7 + 20 × 13) % 14 = 428 % 14 = 8 (Wine).
    expect(s[1]).toBe(8);
  });

  it('oil and uranium wait for Industrialization and Nuclear Fission, and a route negates its commodity', () => {
    const w = new World({ columns: 40, rows: 50, flatEarth: true });
    w.terrain.fill(0); // desert
    w.landmass.fill(1);
    const c = city(w, 0, 20, 24, 8);
    computeSupplyDemand(w, rules, c, ctx({ advancesOf: () => 40 }));
    // Oil may be supplied before anyone knows Combustion (at an eighth of the score); uranium
    // waits for Nuclear Fission, and demand for either waits for the advances.
    expect(Array.from(suppliedOf(c))).not.toContain(15);
    expect(Array.from(demandedOf(c))).not.toContain(14);
    expect(Array.from(demandedOf(c))).not.toContain(15);
    computeSupplyDemand(
      w,
      rules,
      c,
      ctx({ advancesOf: () => 40, knows: (_s, a) => a === 37 || a === 58, combustionKnown: true }),
    );
    const s = Array.from(suppliedOf(c));
    const d = Array.from(demandedOf(c));
    expect([...s, ...d].some((x) => x === 14 || x === 15)).toBe(true);
    const partner = city(w, 1, 30, 30, 5);
    const commodity = s.find((x) => x >= 0) ?? 0;
    addRoute(w, rules, c, partner, commodity);
    expect(c.recomputeTrade).toBe(true);
    computeSupplyDemand(
      w,
      rules,
      c,
      ctx({ advancesOf: () => 40, knows: (_s, a) => a === 37 || a === 58, combustionKnown: true }),
    );
    if (commodity !== 0) expect(Array.from(suppliedOf(c))).toContain(-commodity);
    expect(c.recomputeTrade).toBe(false);
  });
});
