import { describe, expect, it } from 'vitest';
import { airDecision, fuelBudget, type AirContext } from '../src/aiAir.js';
import { Rng } from '../src/rng.js';
import type { EngineRules } from '../src/rules.js';
import { CITY_CENTRE_INDEX, World, type City, type Unit } from '../src/world.js';

const rules = {
  cosmic: { roadMoveMultiplier: 3 },
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
      name: 'Fighter',
      domain: 1,
      move: 10,
      range: 1,
      attack: 4,
      defence: 4,
      hitPointsTens: 2,
      firepower: 2,
      costRows: 6,
      role: 3,
      flags: {},
    },
    {
      name: 'Bomber',
      domain: 1,
      move: 8,
      range: 2,
      attack: 12,
      defence: 1,
      hitPointsTens: 2,
      firepower: 2,
      costRows: 12,
      role: 0,
      flags: {},
    },
  ],
  advances: [],
  improvements: Array.from({ length: 67 }, (_, i) => ({ name: `i${i}`, costRows: 4, upkeep: 1 })),
} as unknown as EngineRules;

function city(world: World, id: number, x: number, y: number, owner: number): City {
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
  };
  world.cities.push(c);
  return c;
}
function unit(world: World, type: number, x: number, y: number, owner: number): Unit {
  const u: Unit = {
    id: world.units.length,
    position: { x, y },
    owner,
    type,
    veteran: false,
    hitPointsLost: 0,
    movesSpent: 0,
    fortified: false,
    homeCity: null,
    order: null,
    workCounter: 0,
    gotoTarget: null,
    lastDirection: null,
    gotoSteps: 0,
  };
  world.units.push(u);
  return u;
}
function world(): World {
  const w = new World({ columns: 30, rows: 30, flatEarth: true });
  w.terrain.fill(2);
  w.landmass.fill(1);
  w.seen.fill(0xff);
  return w;
}
function ctx(): AirContext {
  return {
    rng: new Rng(1),
    atWar: (s) => s === 2,
    canAttack: (s) => s === 2,
    isHuman: () => false,
    isAlly: () => false,
    movement: {},
  };
}

describe('aircraft', () => {
  it('a fighter strikes a lone weak enemy next door and a bomber heads for a garrisoned city', () => {
    const w = world();
    city(w, 0, 10, 10, 1);
    const f = unit(w, 1, 12, 10, 1);
    expect(fuelBudget(rules, f, ctx())).toBe(30);
    unit(w, 0, 14, 10, 2);
    const d = airDecision(w, rules, f, ctx());
    expect(d.kind).toBe('attack');
    const target = city(w, 1, 20, 10, 2);
    unit(w, 0, 20, 10, 2);
    const b = unit(w, 2, 12, 10, 1);
    const db = airDecision(w, rules, b, ctx());
    expect(db).toMatchObject({ kind: 'goto', target: target.position, tag: 'B' });
  });

  it('a bomber that has flown half its range turns home', () => {
    const w = world();
    const home = city(w, 0, 10, 10, 1);
    const b = unit(w, 2, 16, 10, 1);
    b.workCounter = 1;
    expect(airDecision(w, rules, b, ctx())).toMatchObject({
      kind: 'goto',
      target: home.position,
      tag: 'H',
    });
  });
});
