import { describe, expect, it } from 'vitest';
import {
  canBuildUnit,
  canFoundCity,
  foundCity,
  initialProduction,
  joinCity,
} from '../src/founding.js';
import {
  checkMove,
  partialMoveChance,
  rollPartialMove,
  stepCost,
  tryMove,
} from '../src/movement.js';
import { Rng } from '../src/rng.js';
import { IMPROVEMENT, type EngineRules, type TerrainRule } from '../src/rules.js';
import {
  canOrder,
  completeWork,
  doWork,
  hasWaterSource,
  ORDER,
  WORK_ADVANCES,
  workTurns,
} from '../src/terraform.js';
import {
  CITY_CENTRE_INDEX,
  SquareFlag,
  World,
  type City,
  type Civ,
  type Unit,
} from '../src/world.js';

const flags = (over: Partial<Record<string, boolean>> = {}) => ({
  ignoreZonesOfControl: false,
  alpine: false,
  mustStayNearLand: false,
  negatesCityWalls: false,
  doubleDefenceVsHorse: false,
  doubleDefenceVsAir: false,
  submarine: false,
  canAttackAir: false,
  destroyedAfterAttack: false,
  freeSupportUnderFundamentalism: false,
  ...over,
});
const terrain = (over: Partial<TerrainRule>): TerrainRule => ({
  moveCost: 1,
  defenceHalves: 2,
  food: 2,
  shields: 1,
  trade: 0,
  irrigateBonus: 1,
  mineBonus: 0,
  specials: [
    { food: 2, shields: 1, trade: 0 },
    { food: 2, shields: 1, trade: 0 },
  ],
  irrigate: { kind: 'yes' },
  irrigateTurns: 5,
  mine: { kind: 'no' },
  mineTurns: 10,
  transformTo: { kind: 'becomes', terrainIndex: 1 },
  ...over,
});
// 0 desert, 1 plains, 2 grassland, 3 forest (irrigate → plains), 4 hills (mine yes, cost 2), 10 ocean
const rules: EngineRules = {
  cosmic: {
    roadMoveMultiplier: 3,
    foodPerCitizen: 2,
    foodBoxRows: 10,
    shieldBoxRows: 10,
    settlersFoodEarlyGovt: 1,
    settlersFoodLateGovt: 2,
    unhappinessCitySizeChieftain: 7,
    riotFactor: 14,
    aqueductSize: 8,
    sewerSize: 12,
    monarchyFreeUnits: 3,
    communismFreeUnits: 3,
    fundamentalismFreeUnits: 10,
    communismPalaceDistance: 0,
    fundamentalismSciencePenaltyPct: 50,
    fundamentalismMaxScienceRate: 5,
    transformBaseTurns: 20,
  },
  terrain: Array.from({ length: 11 }, (_, i) => {
    if (i === 3)
      return terrain({
        moveCost: 2,
        irrigate: { kind: 'becomes', terrainIndex: 1 },
        mine: { kind: 'becomes', terrainIndex: 4 },
      });
    if (i === 4)
      return terrain({ moveCost: 2, mine: { kind: 'yes' }, mineTurns: 10, irrigateTurns: 10 });
    if (i === 10)
      return terrain({
        irrigate: { kind: 'no' },
        mine: { kind: 'no' },
        transformTo: { kind: 'no' },
      });
    return terrain({});
  }),
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
      flags: flags(),
    },
    {
      name: 'Engineers',
      domain: 0,
      move: 2,
      range: 0,
      attack: 0,
      defence: 2,
      hitPointsTens: 2,
      firepower: 1,
      costRows: 4,
      role: 5,
      flags: flags(),
    },
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
      flags: flags(),
    },
    {
      name: 'Phalanx',
      domain: 0,
      move: 1,
      range: 0,
      attack: 1,
      defence: 2,
      hitPointsTens: 1,
      firepower: 1,
      costRows: 2,
      role: 1,
      flags: flags(),
    },
    {
      name: 'Pikemen',
      domain: 0,
      move: 1,
      range: 0,
      attack: 1,
      defence: 2,
      hitPointsTens: 1,
      firepower: 1,
      costRows: 2,
      role: 1,
      flags: flags({ doubleDefenceVsHorse: true }),
      preq: { kind: 'advance', index: 29 },
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
      flags: flags({ mustStayNearLand: true }),
      holds: 2,
    },
    {
      name: 'Alpine Troops',
      domain: 0,
      move: 1,
      range: 0,
      attack: 5,
      defence: 5,
      hitPointsTens: 2,
      firepower: 1,
      costRows: 5,
      role: 1,
      flags: flags({ alpine: true }),
    },
    {
      name: 'Explorer',
      domain: 0,
      move: 1,
      range: 0,
      attack: 0,
      defence: 1,
      hitPointsTens: 1,
      firepower: 1,
      costRows: 3,
      role: 0,
      flags: flags({ ignoreZonesOfControl: true }),
    },
  ],
  advances: [],
  improvements: Array.from({ length: 67 }, (_, i) => ({ name: `i${i}`, costRows: 4, upkeep: 1 })),
};

let nextId = 0;
function unit(world: World, type: number, x: number, y: number, over: Partial<Unit> = {}): Unit {
  const u: Unit = {
    id: nextId++,
    position: { x, y },
    owner: 1,
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
    ...over,
  };
  world.units.push(u);
  return u;
}
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
    government: 2,
    treasury: 0,
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
function city(world: World, x: number, y: number, size = 3, owner = 1): City {
  const c: City = {
    id: world.cities.length,
    position: { x, y },
    owner,
    name: 'C',
    size,
    improvements: Array<boolean>(67).fill(false),
    foodStored: 0,
    shieldsStored: 0,
    worked: 1 << CITY_CENTRE_INDEX,
    specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
    production: { kind: 'unit', index: 2 },
    inDisorder: false,
    celebrating: false,
    tradeRoutes: [],
  };
  world.cities.push(c);
  return c;
}
function land(): World {
  const w = new World({ columns: 20, rows: 30, flatEarth: true });
  w.terrain.fill(2);
  return w;
}
const knows = (set: number[]) => ({ knows: (a: number) => set.includes(a) });

describe('step cost (verified)', () => {
  it('charges terrain × 3, roads 1, railroads 0, rivers 1 on diagonals, alpine 1', () => {
    const w = land();
    const u = unit(w, 2, 10, 10);
    expect(stepCost(w, rules, u, { x: 10, y: 10 }, { x: 11, y: 11 })).toBe(3);
    w.terrain[w.index(11, 11)] = 4;
    expect(stepCost(w, rules, u, { x: 10, y: 10 }, { x: 11, y: 11 })).toBe(6);
    w.setFlag(10, 10, SquareFlag.Road);
    w.setFlag(11, 11, SquareFlag.Road);
    expect(stepCost(w, rules, u, { x: 10, y: 10 }, { x: 11, y: 11 })).toBe(1);
    w.setFlag(10, 10, SquareFlag.Railroad);
    w.setFlag(11, 11, SquareFlag.Railroad);
    expect(stepCost(w, rules, u, { x: 10, y: 10 }, { x: 11, y: 11 })).toBe(0);
    // A city square counts as a railroad.
    city(w, 12, 10);
    w.setFlag(14, 10, SquareFlag.Railroad);
    expect(stepCost(w, rules, u, { x: 12, y: 10 }, { x: 14, y: 10 })).toBe(0);
    // Rivers: 1 on an edge-neighbour step, full cost on an orthogonal one.
    w.setFlag(2, 2, SquareFlag.River);
    w.setFlag(3, 3, SquareFlag.River);
    w.setFlag(4, 2, SquareFlag.River);
    expect(stepCost(w, rules, u, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(1);
    expect(stepCost(w, rules, u, { x: 2, y: 2 }, { x: 4, y: 2 })).toBe(3);
    const alpine = unit(w, 6, 10, 10);
    w.terrain[w.index(9, 11)] = 4;
    expect(stepCost(w, rules, alpine, { x: 10, y: 10 }, { x: 9, y: 11 })).toBe(1);
  });

  it('gambles only after the unit has moved this turn', () => {
    expect(partialMoveChance(6, 2, 0)).toBe(1);
    expect(partialMoveChance(6, 2, 1)).toBeCloseTo(1 / 3);
    expect(partialMoveChance(3, 3, 2)).toBe(1);
    const a = new Rng(5);
    const b = new Rng(5);
    expect(rollPartialMove(a, 6, 2, 1)).toBe(2 > b.nextInt(6));
    expect(rollPartialMove(new Rng(1), 6, 2, 0)).toBe(true);
  });
});

describe('move checks (verified)', () => {
  it('blocks zone-to-zone steps unless the destination holds a unit or the unit ignores zones', () => {
    const w = land();
    const mover = unit(w, 2, 10, 10);
    unit(w, 2, 12, 10, { owner: 2 }); // enemy next to both squares
    expect(checkMove(w, rules, mover, { x: 11, y: 11 })).toEqual({ ok: false, reason: 'zoc' });
    unit(w, 2, 11, 11); // a friend at the destination
    expect(checkMove(w, rules, mover, { x: 11, y: 11 }).ok).toBe(true);
    const explorer = unit(w, 7, 10, 10);
    expect(checkMove(w, rules, explorer, { x: 11, y: 9 }).ok).toBe(true);
    expect(checkMove(w, rules, mover, { x: 12, y: 10 })).toEqual({ ok: false, reason: 'enemy' });
  });

  it('needs a transport to step onto the sea and boarding ends the move', () => {
    const w = land();
    w.terrain[w.index(11, 11)] = 10;
    const mover = unit(w, 2, 10, 10);
    expect(checkMove(w, rules, mover, { x: 11, y: 11 })).toEqual({
      ok: false,
      reason: 'needs-transport',
    });
    const ship = unit(w, 5, 11, 11);
    const r = tryMove(w, rules, new Rng(1), mover, { x: 11, y: 11 });
    expect(r).toEqual({ kind: 'boarded', ship });
    expect(mover.movesSpent).toBe(3);
    expect(mover.position).toEqual({ x: 11, y: 11 });
  });

  it('moves and spends, and a failed gamble ends the turn in place', () => {
    const w = land();
    const mover = unit(w, 2, 10, 10, { movesSpent: 1 });
    w.terrain[w.index(11, 11)] = 4;
    const rng = new Rng(3);
    const probe = new Rng(3);
    const r = tryMove(w, rules, rng, mover, { x: 11, y: 11 });
    if (2 > probe.nextInt(6)) {
      expect(r).toEqual({ kind: 'moved', cost: 6 });
      expect(mover.position).toEqual({ x: 11, y: 11 });
    } else {
      expect(r).toEqual({ kind: 'failed-roll' });
      expect(mover.position).toEqual({ x: 10, y: 10 });
    }
    expect(mover.movesSpent).toBe(3);
  });
});

describe('terrain work (verified)', () => {
  it('validates orders with the original’s reasons', () => {
    const w = land();
    const s = unit(w, 0, 10, 10);
    expect(canOrder(w, rules, unit(w, 2, 10, 10), ORDER.road, knows([]))).toEqual({
      ok: false,
      reason: 'only-settlers',
    });
    expect(canOrder(w, rules, s, ORDER.fortress, knows([]))).toEqual({
      ok: false,
      reason: { needsAdvance: WORK_ADVANCES.construction },
    });
    expect(canOrder(w, rules, s, ORDER.fortress, knows([18])).ok).toBe(true);
    w.setFlag(10, 10, SquareFlag.River);
    expect(canOrder(w, rules, s, ORDER.road, knows([]))).toEqual({
      ok: false,
      reason: { needsAdvance: WORK_ADVANCES.bridgeBuilding },
    });
    expect(canOrder(w, rules, s, ORDER.road, knows([7])).ok).toBe(true);
    w.setFlag(10, 10, SquareFlag.Road);
    expect(canOrder(w, rules, s, ORDER.road, knows([7]))).toEqual({
      ok: false,
      reason: { needsAdvance: WORK_ADVANCES.railroad },
    });
    w.setFlag(10, 10, SquareFlag.River, false);
    // irrigation needs water
    expect(hasWaterSource(w, { x: 10, y: 10 })).toBe(false);
    expect(canOrder(w, rules, s, ORDER.irrigation, knows([]))).toEqual({
      ok: false,
      reason: 'no-water',
    });
    w.terrain[w.index(11, 9)] = 10;
    expect(hasWaterSource(w, { x: 10, y: 10 })).toBe(true);
    expect(canOrder(w, rules, s, ORDER.irrigation, knows([])).ok).toBe(true);
    w.setFlag(10, 10, SquareFlag.Irrigation);
    expect(canOrder(w, rules, s, ORDER.irrigation, knows([]))).toEqual({
      ok: false,
      reason: { needsAdvance: WORK_ADVANCES.refrigeration },
    });
    expect(canOrder(w, rules, s, ORDER.mine, knows([]))).toEqual({
      ok: false,
      reason: 'cant-improve',
    }); // grassland: mine = no
    expect(canOrder(w, rules, s, ORDER.transform, knows([]))).toEqual({
      ok: false,
      reason: 'needs-engineers',
    });
    expect(canOrder(w, rules, s, ORDER.pollution, knows([]))).toEqual({
      ok: false,
      reason: 'no-pollution',
    });
    const e = unit(w, 1, 10, 10);
    expect(canOrder(w, rules, e, ORDER.transform, knows([])).ok).toBe(true);
  });

  it('computes the turns each job needs', () => {
    const w = land();
    const s = unit(w, 0, 10, 10);
    expect(workTurns(w, rules, s, ORDER.fortress)).toBe(3);
    expect(workTurns(w, rules, s, ORDER.road)).toBe(2);
    w.setFlag(10, 10, SquareFlag.Road);
    expect(workTurns(w, rules, s, ORDER.road)).toBe(4);
    w.setFlag(10, 10, SquareFlag.River);
    expect(workTurns(w, rules, s, ORDER.road)).toBe(6);
    expect(workTurns(w, rules, s, ORDER.irrigation)).toBe(5);
    expect(workTurns(w, rules, s, ORDER.airbase)).toBe(4);
    w.terrain[w.index(10, 10)] = 4;
    expect(workTurns(w, rules, s, ORDER.mine)).toBe(10);
    expect(workTurns(w, rules, s, ORDER.transform)).toBe(40);
    expect(workTurns(w, rules, s, ORDER.fortress)).toBe(4);
  });

  it('advances work, doubles for Engineers, pools stacked settlers and applies the result', () => {
    const w = land();
    const s = unit(w, 0, 10, 10);
    expect(doWork(w, rules, s, ORDER.road, knows([]))).toEqual({
      kind: 'working',
      order: ORDER.road,
      progress: 1,
      needed: 2,
    });
    expect(s.order).toBe(ORDER.road);
    expect(doWork(w, rules, s, ORDER.road, knows([]))).toEqual({
      kind: 'completed',
      order: ORDER.road,
    });
    expect(w.hasFlag(10, 10, SquareFlag.Road)).toBe(true);
    expect(s.order).toBeNull();
    const e = unit(w, 1, 12, 10);
    expect(doWork(w, rules, e, ORDER.road, knows([])).kind).toBe('completed');
    // pooling: a second settler joining the same job finishes it
    const a = unit(w, 0, 14, 10);
    const b = unit(w, 0, 14, 10);
    doWork(w, rules, a, ORDER.fortress, knows([18])); // 1 of 3
    doWork(w, rules, a, ORDER.fortress, knows([18])); // 2 of 3
    expect(doWork(w, rules, b, ORDER.fortress, knows([18])).kind).toBe('completed'); // 2 + 1
    expect(w.hasFlag(14, 10, SquareFlag.Fortress)).toBe(true);
    expect(a.order).toBeNull();
    expect(a.workCounter).toBe(0);
  });

  it('turns irrigation into farmland, swaps mines and irrigation, and changes terrain', () => {
    const w = land();
    w.setFlag(4, 4, SquareFlag.Irrigation);
    completeWork(w, rules, { x: 4, y: 4 }, ORDER.irrigation, knows([70]));
    expect(w.hasFlag(4, 4, SquareFlag.Farmland)).toBe(true);
    w.terrain[w.index(6, 4)] = 4;
    w.setFlag(6, 4, SquareFlag.Irrigation);
    completeWork(w, rules, { x: 6, y: 4 }, ORDER.mine, knows([]));
    expect(w.hasFlag(6, 4, SquareFlag.Mine)).toBe(true);
    expect(w.hasFlag(6, 4, SquareFlag.Irrigation)).toBe(false);
    w.terrain[w.index(8, 4)] = 3; // forest: irrigate → plains
    expect(completeWork(w, rules, { x: 8, y: 4 }, ORDER.irrigation, knows([]))).toBe(1);
    expect(w.terrainAt(8, 4)).toBe(1);
    const pollution = { value: 3 };
    w.setFlag(8, 4, SquareFlag.Pollution);
    completeWork(w, rules, { x: 8, y: 4 }, ORDER.pollution, knows([]), pollution);
    expect(pollution.value).toBe(2);
    expect(w.hasFlag(8, 4, SquareFlag.Pollution)).toBe(false);
  });
});

describe('founding and joining cities (verified)', () => {
  it('refuses non-settlers, sea squares and squares next to a city; joins below the aqueduct size', () => {
    const w = land();
    expect(canFoundCity(w, rules, unit(w, 2, 10, 10))).toEqual({
      ok: false,
      reason: 'only-settlers',
    });
    w.terrain[w.index(2, 2)] = 10;
    expect(canFoundCity(w, rules, unit(w, 0, 2, 2))).toEqual({ ok: false, reason: 'at-sea' });
    const c = city(w, 10, 10, 7);
    expect(canFoundCity(w, rules, unit(w, 0, 11, 11))).toEqual({
      ok: false,
      reason: 'adjacent-city',
    });
    expect(canFoundCity(w, rules, unit(w, 0, 10, 10))).toEqual({ ok: true, joins: c });
    c.size = 8;
    expect(canFoundCity(w, rules, unit(w, 0, 10, 10))).toEqual({ ok: false, reason: 'city-full' });
    expect(canFoundCity(w, rules, unit(w, 0, 14, 10))).toEqual({ ok: true, joins: null });
  });

  it('creates the city with the verified initial state and production choice', () => {
    const w = land();
    const owner = civ();
    const s = unit(w, 0, 10, 10);
    w.setFlag(10, 10, SquareFlag.Road);
    w.setFlag(10, 10, SquareFlag.Irrigation);
    const c = foundCity(w, rules, owner, s, { name: 'Ur' });
    expect(c.size).toBe(1);
    expect(c.improvements[IMPROVEMENT.palace]).toBe(true);
    expect(w.hasFlag(10, 10, SquareFlag.Road)).toBe(false);
    expect(w.hasFlag(10, 10, SquareFlag.Irrigation)).toBe(false);
    expect(w.units.includes(s)).toBe(false);
    expect(c.production).toEqual({ kind: 'unit', index: 6 }); // Warriors, Phalanx and Alpine Troops all score 8; the later type wins ties; Pikemen need Feudalism
    owner.knownAdvances[29] = true;
    expect(initialProduction(rules, (t) => canBuildUnit(rules, owner, t))).toBe(4);
    const second = foundCity(w, rules, owner, unit(w, 0, 16, 10), { name: 'Uruk' });
    expect(second.improvements[IMPROVEMENT.palace]).toBe(false);
    expect(second.id).toBe(1);
    const joiner = unit(w, 0, 16, 10);
    joinCity(w, joiner, second);
    expect(second.size).toBe(2);
    expect(w.units.includes(joiner)).toBe(false);
  });
});
