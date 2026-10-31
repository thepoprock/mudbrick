import { describe, expect, it } from 'vitest';
import { aiMoveUnits, type AiUnitContext } from '../src/aiUnits.js';
import { Rng } from '../src/rng.js';
import { GOVERNMENT, IMPROVEMENT, type EngineRules } from '../src/rules.js';
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
    unitType('Caravan', { attack: 0, costRows: 5, role: 7 }),
  ],
  advances: [],
  improvements: Array.from({ length: 67 }, (_, i) => ({ name: `i${i}`, costRows: 4, upkeep: 1 })),
};
let nextId = 0;
function unit(
  world: World,
  type: number,
  x: number,
  y: number,
  owner = 2,
  over: Partial<Unit> = {},
): Unit {
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
    ...over,
  };
  world.units.push(u);
  return u;
}
function city(world: World, x: number, y: number, owner = 2, size = 3): City {
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
function civ(slot = 2): Civ {
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
function world(): World {
  const w = new World({ columns: 30, rows: 40, flatEarth: true });
  w.terrain.fill(2);
  w.landmass.fill(1);
  return w;
}
function ctx(w: World, c: Civ): AiUnitContext {
  let n = 0;
  return {
    rng: new Rng(3),
    civ: c,
    difficulty: 2,
    realisticCombat: true,
    turn: 10,
    atWar: (slot) => slot === 0,
    knows: () => false,
    wondersOf: () => Array<boolean>(67).fill(false),
    cityCount: (slot) => w.cities.filter((x) => x.owner === slot).length,
    nextCityName: () => `New ${++n}`,
  };
}

describe('interim computer-player units (INFERRED)', () => {
  it('settlers of a civilization without cities found one at once', () => {
    const w = world();
    const c = civ();
    unit(w, 0, 20, 20);
    const ev = aiMoveUnits(w, rules, 2, ctx(w, c));
    expect(ev.some((e) => e.text.startsWith('founds'))).toBe(true);
    expect(w.cities.length).toBe(1);
    expect(w.cities[0]?.improvements[IMPROVEMENT.palace]).toBe(true);
  });

  it('one defender stays fortified in a garrisoned city and the spare walks to an empty one', () => {
    const w = world();
    const c = civ();
    const a = city(w, 10, 10);
    const b = city(w, 16, 10);
    const first = unit(w, 3, 10, 10);
    const second = unit(w, 3, 10, 10);
    aiMoveUnits(w, rules, 2, ctx(w, c));
    const stayed = [first, second].filter((u) => u.position.x === 10 && u.position.y === 10);
    const moved = [first, second].filter((u) => u.position.x > 10);
    expect(stayed).toHaveLength(1);
    expect(moved).toHaveLength(1);
    expect(stayed[0]?.order).toBe(ORDER.fortify);
    expect(w.unitsAt(a.position.x, a.position.y).length).toBe(1);
    expect(b.owner).toBe(2);
  });

  it('an attacker strikes an adjacent weaker barbarian and a caravan helps a wonder', () => {
    const w = world();
    const c = civ();
    const legion = unit(w, 4, 10, 10);
    unit(w, 2, 11, 11, 0); // barbarian warriors
    const ev = aiMoveUnits(w, rules, 2, ctx(w, c));
    expect(ev.some((e) => e.text.includes('attacks'))).toBe(true);
    expect(legion.movesSpent).toBeGreaterThan(0);
    const wonderTown = city(w, 20, 20);
    wonderTown.production = { kind: 'improvement', index: 39 };
    unit(w, 5, 20, 20);
    const ev2 = aiMoveUnits(w, rules, 2, ctx(w, c));
    expect(ev2.some((e) => e.text.includes('caravan adds'))).toBe(true);
    expect(wonderTown.shieldsStored).toBe(50);
  });
});
