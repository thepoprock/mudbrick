import { describe, expect, it } from 'vitest';
import { emptyStrategy } from '../src/aiStrategy.js';
import { coastal, transportDecision, wantedUnits } from '../src/aiShips.js';
import { gatherCargo, tryMove } from '../src/movement.js';
import { Rng } from '../src/rng.js';
import type { EngineRules } from '../src/rules.js';
import { ORDER } from '../src/terraform.js';
import { CITY_CENTRE_INDEX, OCEAN, World, type City, type Unit } from '../src/world.js';

const rules = {
  cosmic: { roadMoveMultiplier: 3 },
  terrain: Array.from({ length: 11 }, (_, i) => ({
    moveCost: i === OCEAN ? 1 : 1,
    defenceHalves: 2,
  })),
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
      name: 'Settlers',
      domain: 0,
      move: 1,
      range: 0,
      attack: 0,
      defence: 1,
      hitPointsTens: 2,
      firepower: 1,
      costRows: 4,
      role: 5,
      flags: {},
    },
    {
      name: 'Trireme',
      domain: 2,
      move: 3,
      range: 0,
      attack: 1,
      defence: 1,
      hitPointsTens: 1,
      firepower: 1,
      costRows: 4,
      role: 4,
      holds: 2,
      flags: {},
    },
  ],
  advances: [],
  improvements: Array.from({ length: 67 }, (_, i) => ({ name: `i${i}`, costRows: 4, upkeep: 1 })),
} as unknown as EngineRules;

function city(world: World, id: number, x: number, y: number, owner = 1): City {
  const c: City = {
    id,
    position: { x, y },
    owner,
    name: `C${id}`,
    size: 3,
    improvements: Array<boolean>(67).fill(false),
    foodStored: 0,
    shieldsStored: 0,
    worked: 1 << CITY_CENTRE_INDEX,
    specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
    production: { kind: 'unit', index: 0 },
    inDisorder: false,
    celebrating: false,
    tradeRoutes: [],
    lastTrade: 5,
  };
  world.cities.push(c);
  return c;
}
function unit(world: World, type: number, x: number, y: number, owner = 1): Unit {
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
/** Two islands: x 0–9 and x 20–29 (rows 10–14), ocean elsewhere. */
function islands(): World {
  const w = new World({ columns: 20, rows: 30, flatEarth: true });
  w.terrain.fill(OCEAN);
  for (let y = 10; y <= 14; y++)
    for (let x = y & 1; x < 40; x += 2) if (x < 10 || x >= 28) w.terrain[w.index(x, y)] = 2;
  w.landmass.fill(3);
  for (let i = 0; i < w.area; i++)
    if (w.terrain[i] !== OCEAN) {
      const p = w.position(i);
      w.landmass[i] = p.x < 10 ? 1 : 2;
    }
  return w;
}

describe('cargo', () => {
  it('a sentried unit sails with a human ship, a fortified one stays, and a city wakes it', () => {
    const w = islands();
    const port = city(w, 0, 8, 12);
    const ship = unit(w, 2, 8, 12);
    const rider = unit(w, 0, 8, 12);
    rider.order = ORDER.sleep;
    const guard = unit(w, 0, 8, 12);
    guard.order = ORDER.fortified;
    guard.fortified = true;
    expect(coastal(w, port)).toBe(true);
    expect(gatherCargo(w, rules, ship)).toEqual([rider]);
    const r = tryMove(w, rules, new Rng(1), ship, { x: 10, y: 12 });
    expect(r.kind).toBe('moved');
    expect(rider.position).toEqual({ x: 10, y: 12 });
    expect(rider.aboard).toBe(ship.id);
    expect(guard.position).toEqual({ x: 8, y: 12 });
    // Back into the port: the passenger wakes.
    tryMove(w, rules, new Rng(1), ship, { x: 8, y: 12 });
    expect(rider.position).toEqual({ x: 8, y: 12 });
    expect(rider.order).toBeNull();
    expect(rider.aboard).toBeUndefined();
  });

  it("a computer ship sweeps its port's unfortified units aboard, up to its holds", () => {
    const w = islands();
    city(w, 0, 8, 12);
    const ship = unit(w, 2, 8, 12);
    const a = unit(w, 1, 8, 12);
    const b = unit(w, 0, 8, 12);
    const c = unit(w, 0, 8, 12);
    const d = unit(w, 0, 8, 12);
    d.order = ORDER.fortified;
    const cargo = gatherCargo(w, rules, ship, { isHuman: () => false });
    expect(cargo).toHaveLength(2);
    expect(cargo).toContain(a);
    expect(cargo).not.toContain(d);
    expect([b, c].some((u) => cargo.includes(u))).toBe(true);
  });
});

describe('transports', () => {
  it('wants 3 per city for five, then 2, then 1', () => {
    expect(wantedUnits(1)).toBe(3);
    expect(wantedUnits(5)).toBe(15);
    expect(wantedUnits(7)).toBe(19);
    expect(wantedUnits(16)).toBe(30);
  });

  it('an empty transport sails to a port with units to spare, not one short of them', () => {
    const w = islands();
    city(w, 0, 8, 12);
    const spare = city(w, 1, 28, 12);
    const s = emptyStrategy();
    s.citiesOn[1] = 1;
    s.citiesOn[2] = 1;
    s.unitsOn[1] = 0; // home is short, so it keeps its units
    s.unitsOn[2] = 9;
    s.attackOn[2] = 24; // a strong force there brings the 15 squares down to 9
    s.plans[2] = 4;
    const ship = unit(w, 2, 8, 12);
    ship.cityStep = 3; // the two low bits decide which turns it may leave on
    const ctx = {
      turn: 12,
      rng: new Rng(3),
      strategy: s,
      canAttack: () => false,
      atWar: () => false,
      isAlly: () => false,
      isHuman: () => false,
      cityTrade: (c: City) => c.lastTrade ?? 0,
    };
    expect(transportDecision(w, rules, ship, ctx)).toMatchObject({
      kind: 'goto',
      target: spare.position,
      tag: '3',
    });
    expect(s.objectives.some((o) => o.x === 28 && o.y === 12 && o.type === 7)).toBe(true);
    // Short of units with no caravans waiting, the same port is passed over.
    const other = islands();
    city(other, 0, 8, 12);
    city(other, 1, 28, 12);
    const t = emptyStrategy();
    t.citiesOn[1] = 1;
    t.citiesOn[2] = 1;
    t.plans[1] = 5;
    t.plans[2] = 5;
    const second = unit(other, 2, 8, 12);
    second.cityStep = 3;
    expect(transportDecision(other, rules, second, { ...ctx, strategy: t })).not.toMatchObject({
      tag: '3',
    });
  });

  it('a loaded ship at sea makes for an own city on a defend land mass, else its other cities', () => {
    const w = islands();
    const near = city(w, 0, 8, 12);
    const far = city(w, 1, 28, 12);
    const s = emptyStrategy();
    s.plans[1] = 5;
    s.plans[2] = 1;
    s.citiesOn[1] = 1;
    s.citiesOn[2] = 1;
    const ship = unit(w, 2, 24, 12);
    unit(w, 0, 24, 12); // Warriors aboard
    const ctx = {
      turn: 10,
      rng: new Rng(3),
      strategy: s,
      canAttack: () => false,
      atWar: () => false,
      isAlly: () => false,
      isHuman: () => false,
      cityTrade: (c: City) => c.lastTrade ?? 0,
    };
    expect(transportDecision(w, rules, ship, ctx)).toMatchObject({
      kind: 'goto',
      target: far.position,
      tag: 'A',
    });
    s.plans[2] = 5;
    // No defend land mass now: the nearest own city over 7 away.
    expect(transportDecision(w, rules, ship, ctx)).toMatchObject({
      kind: 'goto',
      target: near.position,
      tag: '5',
    });
  });
});
