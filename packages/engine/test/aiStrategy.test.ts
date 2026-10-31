import { describe, expect, it } from 'vitest';
import {
  addGoal,
  addObjective,
  emptyStrategy,
  endOfTurnObjectives,
  LAND_FLAG,
  PLAN,
  runStrategy,
  type StrategyContext,
} from '../src/aiStrategy.js';
import { computeFertility } from '../src/fertility.js';
import { GOVERNMENT, type EngineRules } from '../src/rules.js';
import { ORDER } from '../src/terraform.js';
import { CITY_CENTRE_INDEX, World, type City, type Civ, type Unit } from '../src/world.js';

const flags = () => ({
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
});
const unitType = (name: string, over: Partial<EngineRules['units'][number]> = {}) => ({
  name,
  domain: 0,
  move: 1,
  range: 0,
  attack: 1,
  defence: 1,
  hitPointsTens: 1,
  firepower: 1,
  costRows: 2,
  role: 0,
  flags: flags(),
  ...over,
});
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
  },
  terrain: Array.from({ length: 11 }, () => ({
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
    ] as [
      { food: number; shields: number; trade: number },
      { food: number; shields: number; trade: number },
    ],
    irrigate: { kind: 'yes' as const },
    irrigateTurns: 5,
    mine: { kind: 'no' as const },
    mineTurns: 10,
    transformTo: { kind: 'no' as const },
  })),
  units: [
    unitType('Settlers', { attack: 0, hitPointsTens: 2, costRows: 4, role: 5 }),
    unitType('Engineers', { attack: 0, hitPointsTens: 2, costRows: 4, role: 5 }),
    unitType('Warriors', { costRows: 1, role: 1 }),
    unitType('Phalanx', { defence: 2, role: 1 }),
    unitType('Legion', { attack: 4, defence: 2, costRows: 4, role: 0 }),
  ],
  advances: [],
  improvements: Array.from({ length: 67 }, (_, i) => ({ name: `i${i}`, costRows: 4, upkeep: 1 })),
};
let nextId = 0;
function unit(world: World, type: number, x: number, y: number, owner: number): Unit {
  const u: Unit = {
    id: nextId++,
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
function city(world: World, x: number, y: number, owner: number, size = 3): City {
  const c: City = {
    id: world.cities.length,
    position: { x, y },
    owner,
    name: `C${world.cities.length}`,
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
function civ(slot: number, isHuman = false): Civ {
  return {
    slot,
    tribe: 0,
    name: `Civ ${slot}`,
    adjective: `C${slot}`,
    leader: 'L',
    cityStyle: 0,
    epoch: 0,
    colour: slot,
    government: GOVERNMENT.monarchy,
    treasury: 50,
    isHuman,
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
function world(): World {
  const w = new World({ columns: 30, rows: 40, flatEarth: true });
  w.terrain.fill(2);
  w.landmass.fill(1);
  w.civs.push(civ(2), civ(3));
  computeFertility(w, rules);
  return w;
}
function ctx(w: World, over: Partial<StrategyContext> = {}): StrategyContext {
  return {
    turn: 20,
    difficulty: 2,
    atWar: (a, b) => a !== b,
    isHuman: () => false,
    knows: () => true,
    expand: () => 0,
    strategyOf: (slot) => w.civs.find((c) => c.slot === slot)?.strategy,
    mainHuman: null,
    ...over,
  };
}

describe('objectives table', () => {
  it('keeps the higher priority for a repeated square and drops the lowest when full', () => {
    const s = emptyStrategy();
    addObjective(s, { x: 1, y: 1, type: 0, priority: 2 });
    addObjective(s, { x: 1, y: 1, type: 0, priority: 1 });
    expect(s.objectives).toHaveLength(1);
    addObjective(s, { x: 1, y: 1, type: 0, priority: 4 });
    expect(s.objectives[0]?.priority).toBe(4);
    for (let i = 0; i < 60; i++) addObjective(s, { x: 2 * i, y: 2, type: 1, priority: 1 });
    expect(s.objectives).toHaveLength(48);
    expect(s.objectives[0]?.priority).toBe(4);
  });

  it("consumes a turn's objectives and re-adds persistent goals", () => {
    const s = emptyStrategy();
    addObjective(s, { x: 1, y: 1, type: 0, priority: 3 });
    addGoal(s, { x: 5, y: 5, type: 5, priority: 2 });
    endOfTurnObjectives(s);
    expect(s.objectives.find((o) => o.x === 1)?.priority).toBe(-3);
    expect(s.objectives.find((o) => o.x === 5)?.priority).toBe(2);
    endOfTurnObjectives(s);
    expect(s.objectives.find((o) => o.x === 1)).toBeUndefined();
    expect(s.objectives.find((o) => o.x === 5)?.priority).toBe(2);
  });
});

describe('strategic layer', () => {
  it('posts a defend objective for an empty own city and sends a defender there', () => {
    const w = world();
    const home = city(w, 10, 10, 2);
    unit(w, 3, 10, 10, 2); // garrison
    const empty = city(w, 20, 10, 2);
    const spare = unit(w, 3, 12, 10, 2);
    runStrategy(w, rules, 2, ctx(w));
    const s = w.civs[0]?.strategy;
    expect(s?.citiesOn[1]).toBe(2);
    expect(s?.objectives.some((o) => o.x === empty.position.x && o.type === 1)).toBe(true);
    expect(spare.order).toBe(ORDER.goTo);
    expect(spare.gotoTarget).toEqual(empty.position);
    expect(home.owner).toBe(2);
  });

  it('plans attack where an enemy is weaker and defend where it is stronger', () => {
    const w = world();
    city(w, 10, 10, 2);
    unit(w, 4, 10, 10, 2); // our legion, attack 4
    city(w, 30, 10, 3);
    unit(w, 2, 30, 10, 3); // their lone warriors
    runStrategy(w, rules, 3, ctx(w)); // their tallies first
    runStrategy(w, rules, 2, ctx(w));
    runStrategy(w, rules, 3, ctx(w)); // now they can see our strength
    expect(w.civs[0]?.strategy?.plans[1]).toBe(PLAN.attack);
    expect(w.civs[1]?.strategy?.plans[1]).toBe(PLAN.defend);
    expect((w.civs[1]?.strategy?.landFlags[1] ?? 0) & LAND_FLAG.watch).toBe(LAND_FLAG.watch);
    expect((w.civs[0]?.strategy?.landFlags[1] ?? 0) & LAND_FLAG.enemyUnits).toBe(
      LAND_FLAG.enemyUnits,
    );
  });

  it('an enemy city becomes an attack objective and an attacker marches on it', () => {
    const w = world();
    city(w, 10, 10, 2);
    const target = city(w, 24, 10, 3);
    unit(w, 2, 24, 10, 3);
    const legion = unit(w, 4, 12, 10, 2);
    runStrategy(w, rules, 2, ctx(w, { turn: 21 })); // (turn + index 1) % 3 != 0
    expect(legion.order).toBe(ORDER.goTo);
    expect(legion.gotoTarget).toEqual(target.position);
  });

  it('a human civilization gets tallies and plans but no orders', () => {
    const w = world();
    const me = w.civs[0];
    if (me) me.isHuman = true;
    city(w, 10, 10, 2);
    city(w, 20, 10, 2);
    const u = unit(w, 3, 12, 10, 2);
    runStrategy(w, rules, 2, ctx(w, { isHuman: (slot) => slot === 2 }));
    expect(w.civs[0]?.strategy?.cities).toBe(2);
    expect(u.order).toBeNull();
  });
});
