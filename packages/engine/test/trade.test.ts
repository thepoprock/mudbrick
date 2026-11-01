import { describe, expect, it } from 'vitest';
import {
  addRoute,
  aiCaravanDestination,
  establishTradeRoute,
  FOOD_ROUTE,
  helpWonder,
  incomingFoodRoutes,
  routeIncome,
  routeModifier,
  type TradeContext,
  type TradeEvent,
} from '../src/trade.js';
import type { EngineRules } from '../src/rules.js';
import {
  CITY_CENTRE_INDEX,
  SquareFlag,
  World,
  type City,
  type Civ,
  type Unit,
} from '../src/world.js';

const rules = {
  cosmic: { roadMoveMultiplier: 3, shieldBoxRows: 10, foodBoxRows: 10 },
  terrain: Array.from({ length: 11 }, () => ({ moveCost: 1, defenceHalves: 2 })),
  units: [
    {
      name: 'Warriors',
      domain: 0,
      move: 1,
      range: 0,
      attack: 1,
      defence: 1,
      hitPointsTens: 1,
      firepower: 1,
      costRows: 1,
      role: 1,
      flags: {},
    },
    {
      name: 'Caravan',
      domain: 0,
      move: 1,
      range: 0,
      attack: 0,
      defence: 1,
      hitPointsTens: 1,
      firepower: 1,
      costRows: 5,
      role: 7,
      flags: {},
    },
  ],
  advances: [],
  improvements: Array.from({ length: 67 }, (_, i) => ({ name: `i${i}`, costRows: 4, upkeep: 1 })),
} as unknown as EngineRules;

function civ(slot: number): Civ {
  return {
    slot,
    tribe: 0,
    name: `Civ${slot}`,
    adjective: `C${slot}`,
    leader: 'L',
    cityStyle: 0,
    epoch: 0,
    colour: slot,
    government: 1,
    treasury: 100,
    isHuman: false,
    inPlay: true,
    scienceStored: 0,
    researching: null,
    advancesCount: 0,
    futureTechs: 0,
    scienceRate: 5,
    taxRate: 3,
    knownAdvances: Array<boolean>(100).fill(false),
    freeAdvancePending: false,
  };
}
function city(world: World, id: number, x: number, y: number, owner: number, trade: number): City {
  const c: City = {
    id,
    position: { x, y },
    owner,
    name: `C${id}`,
    size: 5,
    improvements: Array<boolean>(67).fill(false),
    foodStored: 0,
    shieldsStored: 0,
    worked: 1 << CITY_CENTRE_INDEX,
    specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
    production: { kind: 'unit', index: 0 },
    inDisorder: false,
    celebrating: false,
    tradeRoutes: [],
    lastTrade: trade,
  };
  world.cities.push(c);
  return c;
}
function caravan(
  world: World,
  x: number,
  y: number,
  owner: number,
  home: number,
  commodity: number,
): Unit {
  const u: Unit = {
    id: world.units.length,
    position: { x, y },
    owner,
    type: 1,
    veteran: false,
    hitPointsLost: 0,
    movesSpent: 0,
    fortified: false,
    homeCity: home,
    order: null,
    workCounter: 0,
    gotoTarget: null,
    lastDirection: null,
    gotoSteps: 0,
    commodity,
  };
  world.units.push(u);
  return u;
}
function world(): World {
  const w = new World({ columns: 60, rows: 60, flatEarth: true });
  w.terrain.fill(2);
  w.landmass.fill(1);
  w.civs.push(civ(1), civ(2));
  return w;
}
function ctx(over: Partial<TradeContext> = {}): TradeContext {
  return {
    turn: 50,
    knows: () => false,
    researchCost: () => 300,
    foodBoxRows: () => 10,
    nextInt: () => 0,
    ...over,
  };
}

describe('trade routes', () => {
  it('a foreign route far away pays well, is capped, and lands in gold and research', () => {
    const w = world();
    const home = city(w, 0, 2, 2, 1, 10);
    const target = city(w, 1, 22, 2, 2, 10);
    const u = caravan(w, 22, 2, 1, 0, 9); // Silk
    const events: TradeEvent[] = [];
    const bonus = establishTradeRoute(w, rules, u, target, ctx(), events);
    // 20 columns away is 15 by the original's measure: (10 + 10) × 25 / 24 = 20; early game ×2 =
    // 40 (silk only counts when demanded)
    expect(bonus).toBe(40);
    const c1 = w.civs.find((c) => c.slot === 1);
    expect(c1?.treasury).toBe(140);
    expect(c1?.scienceStored).toBe(40);
    expect(w.units).toHaveLength(0);
    expect(home.tradeRoutes).toEqual([{ partner: 1, food: false, commodity: 9 }]);
    expect(target.tradeRoutes[0]?.partner).toBe(0);
    expect(events[0]?.text).toContain('trade route');
    // The bonus is capped at two thirds of the research cost.
    const u2 = caravan(w, 22, 4, 1, 0, 15);
    const far = city(w, 2, 22, 4, 2, 200);
    expect(establishTradeRoute(w, rules, u2, far, ctx({ researchCost: () => 30 }), events)).toBe(
      20,
    );
  });

  it('a demanded commodity doubles the route and adds its own bonus', () => {
    const w = world();
    city(w, 0, 2, 2, 1, 10);
    const target = city(w, 1, 22, 2, 2, 10);
    target.demanded = Int8Array.from([13, 2, 4]); // Gold is wanted
    const u = caravan(w, 22, 2, 1, 0, 13);
    const bonus = establishTradeRoute(w, rules, u, target, ctx({ turn: 250 }), []);
    expect(bonus).toBe(20 * 2 + 20); // base 20 doubled plus the gold bonus (= base)
  });

  it('a road between the cities raises the income and a food route feeds the partner', () => {
    const w = world();
    const a = city(w, 0, 2, 2, 1, 20);
    const b = city(w, 1, 12, 2, 1, 20);
    expect(routeModifier(w, rules, 1, a, b)).toBe(0);
    for (let x = 2; x <= 12; x += 2) w.setFlag(x, 2, SquareFlag.Road, true);
    expect(routeModifier(w, rules, 1, a, b)).toBe(1);
    for (let x = 2; x <= 12; x += 2) w.setFlag(x, 2, SquareFlag.Railroad, true);
    expect(routeModifier(w, rules, 1, a, b)).toBe(2);
    addRoute(w, rules, a, b, 3);
    // (20 + 20 + 4) / 8 = 5, plus 2 × 5 / 2 = 5 → 10, halved for a domestic partner → 5
    expect(routeIncome(w, rules, a, { partner: 1, commodity: 3 }, 20)).toBe(5);
    addRoute(w, rules, b, a, FOOD_ROUTE);
    expect(incomingFoodRoutes(w, a)).toBe(1);
    expect(routeIncome(w, rules, b, { partner: 0, commodity: FOOD_ROUTE }, 20)).toBe(0);
  });

  it('a fourth route replaces the weakest when the newcomer is worth more', () => {
    const w = world();
    const a = city(w, 0, 2, 2, 1, 20);
    const p1 = city(w, 1, 10, 2, 2, 5);
    const p2 = city(w, 2, 12, 4, 2, 9);
    const p3 = city(w, 3, 14, 6, 2, 12);
    const p4 = city(w, 4, 16, 8, 2, 7);
    for (const p of [p1, p2, p3]) addRoute(w, rules, a, p, 1);
    expect(addRoute(w, rules, a, p4, 2)).toBe(true);
    expect(a.tradeRoutes.map((r) => r.partner)).toEqual([4, 2, 3]);
    const p5 = city(w, 5, 18, 10, 2, 3);
    expect(addRoute(w, rules, a, p5, 2)).toBe(false);
  });

  it('a caravan helps a wonder and the computer picks a lucrative destination', () => {
    const w = world();
    const home = city(w, 0, 2, 2, 1, 10);
    home.production = { kind: 'improvement', index: 40 };
    const u = caravan(w, 2, 2, 1, 0, 0);
    const events: TradeEvent[] = [];
    expect(helpWonder(w, rules, u, home, events)).toBe(true);
    expect(home.shieldsStored).toBe(50);
    const u2 = caravan(w, 2, 2, 1, 0, 0);
    city(w, 1, 6, 2, 1, 10); // near, domestic
    const far = city(w, 2, 24, 2, 2, 10); // far, foreign
    expect(aiCaravanDestination(w, u2, () => 50)).toBe(far);
  });
});
