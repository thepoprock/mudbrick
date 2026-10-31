import { describe, expect, it } from 'vitest';
import { emptyStrategy } from '../src/aiStrategy.js';
import {
  aiImprovement,
  roadLinkTask,
  terraformTasks,
  workerRules,
  WORK_ROLE,
} from '../src/aiTerraform.js';
import type { EngineRules } from '../src/rules.js';
import { ORDER } from '../src/terraform.js';
import { CITY_CENTRE_INDEX, SquareFlag, World, type City, type Unit } from '../src/world.js';

function terrainRow(over: Record<string, unknown> = {}) {
  return {
    name: 't',
    moveCost: 1,
    defenceHalves: 2,
    food: 2,
    shields: 1,
    trade: 0,
    specials: [
      { food: 2, shields: 1, trade: 0 },
      { food: 2, shields: 1, trade: 0 },
    ],
    irrigate: { kind: 'yes' },
    irrigateBonus: 1,
    irrigateTurns: 5,
    irrigateAiGovt: 1,
    mine: { kind: 'no' },
    mineBonus: 0,
    mineTurns: 10,
    mineAiGovt: 0,
    transformTo: { kind: 'no' },
    ...over,
  };
}
const rules = {
  cosmic: { roadMoveMultiplier: 3 },
  terrain: [
    terrainRow(), // desert
    terrainRow(), // plains
    terrainRow(), // grassland
    terrainRow({ irrigate: { kind: 'no' }, irrigateAiGovt: 0 }), // forest
    terrainRow({ irrigateAiGovt: 2, mine: { kind: 'yes' }, mineAiGovt: 1, mineBonus: 3 }), // hills
    terrainRow({
      irrigate: { kind: 'no' },
      irrigateAiGovt: 0,
      mine: { kind: 'yes' },
      mineAiGovt: 1,
    }), // mountains
    terrainRow(),
    terrainRow(),
    terrainRow(),
    terrainRow(),
    terrainRow({ irrigate: { kind: 'no' }, irrigateAiGovt: 0 }), // ocean
  ],
  units: [
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
      preq: { kind: 'none' },
    },
  ],
  advances: [],
  improvements: Array.from({ length: 67 }, (_, i) => ({ name: `i${i}`, costRows: 4, upkeep: 1 })),
} as unknown as EngineRules;

function city(world: World, id: number, x: number, y: number, size = 5): City {
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
  };
  world.cities.push(c);
  return c;
}
function settler(world: World, x: number, y: number, home: number | null): Unit {
  const u: Unit = {
    id: world.units.length,
    position: { x, y },
    owner: 1,
    type: 0,
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
  };
  world.units.push(u);
  return u;
}
function world(): World {
  const w = new World({ columns: 30, rows: 30, flatEarth: true });
  w.terrain.fill(2);
  w.landmass.fill(1);
  return w;
}

describe('terraform tasks', () => {
  it('a city asks for the first missing road toward its neighbour, then a railroad', () => {
    const w = world();
    const a = city(w, 0, 10, 10);
    city(w, 1, 18, 10);
    const s = emptyStrategy();
    terraformTasks(w, rules, a, s, () => false);
    const o = s.objectives.find((x) => x.type === WORK_ROLE);
    expect(o).toBeDefined();
    expect(o?.priority).toBe(2);
    expect(o && Math.abs(o.x - 10) + Math.abs(o.y - 10)).toBeLessThanOrEqual(2);
    expect(a.terraformTask).toBe(true);
    for (let x = 10; x <= 18; x += 2) w.setFlag(x, 10, SquareFlag.Road, true);
    expect(roadLinkTask(w, rules, a, () => false)).toBeNull();
    const rail = roadLinkTask(w, rules, a, (adv) => adv === 67);
    expect(rail).not.toBeNull();
    const s2 = emptyStrategy();
    terraformTasks(w, rules, a, s2, (adv) => adv === 67);
    expect(s2.objectives.find((x) => x.type === WORK_ROLE)?.priority).toBe(6); // 5 + size > 4
  });

  it('pollution outranks everything', () => {
    const w = world();
    const a = city(w, 0, 10, 10);
    city(w, 1, 18, 10);
    w.setFlag(11, 11, SquareFlag.Pollution, true);
    const s = emptyStrategy();
    terraformTasks(w, rules, a, s, () => false);
    expect(s.objectives[0]).toMatchObject({ x: 11, y: 11, type: WORK_ROLE, priority: 6 });
  });
});

describe('worker rules', () => {
  it('irrigates a watered field next to its city, mines hills, and builds roads on bare fields', () => {
    const w = world();
    const c = city(w, 0, 10, 10, 5);
    w.setFlag(12, 10, SquareFlag.River, true);
    const u = settler(w, 12, 10, 0);
    u.wanted = true;
    const ctx = {
      knows: () => false,
      turn: 3,
      government: 1,
      isHuman: false,
      strategy: emptyStrategy(),
    };
    const near = { nearestOwn: c, ownDist: 1, nearestAny: c, anyDist: 1 };
    expect(aiImprovement(w, rules, { x: 12, y: 10 }, 1, () => false)).toBe(1);
    const v = workerRules(w, rules, u, near, ctx);
    expect(v).toEqual({ kind: 'worked', order: ORDER.irrigation });
    expect(u.order).toBe(ORDER.irrigation);
    // Hills: the mine's AI level is lower than irrigation's, so the mine wins.
    w.terrain[w.index(11, 11)] = 4;
    const h = settler(w, 11, 11, 0);
    h.wanted = true;
    expect(workerRules(w, rules, h, near, ctx)).toEqual({ kind: 'worked', order: ORDER.mine });
    // A square two away from the city on grassland with nothing to irrigate: a road.
    const r = settler(w, 14, 10, 0);
    r.wanted = true;
    const v3 = workerRules(
      w,
      rules,
      r,
      { nearestOwn: c, ownDist: 2, nearestAny: c, anyDist: 2 },
      ctx,
    );
    expect(v3).toEqual({ kind: 'worked', order: ORDER.road });
  });

  it('a wanted worker far from home heads home; a settler alone asks for a defender', () => {
    const w = world();
    const c = city(w, 0, 10, 10, 5);
    const u = settler(w, 20, 10, 0);
    u.wanted = true;
    const s = emptyStrategy();
    const v = workerRules(
      w,
      rules,
      u,
      { nearestOwn: c, ownDist: 5, nearestAny: c, anyDist: 5 },
      { knows: () => false, turn: 0, government: 1, isHuman: false, strategy: s },
    );
    expect(v).toMatchObject({ kind: 'goto', target: { x: 10, y: 10 } });
    expect(s.objectives.some((o) => o.type === 1 && o.x === 20 && o.y === 10)).toBe(true);
  });
});
