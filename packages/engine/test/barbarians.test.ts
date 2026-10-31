import { describe, expect, it } from 'vitest';
import {
  BARBARIAN_UNITS,
  barbarianMoves,
  spawnBarbarians,
  type BarbarianContext,
} from '../src/barbarians.js';
import { computeFertility } from '../src/fertility.js';
import { Rng } from '../src/rng.js';
import { GOVERNMENT, type EngineRules } from '../src/rules.js';
import { CITY_CENTRE_INDEX, OCEAN, World, type City, type Civ, type Unit } from '../src/world.js';

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
const units: EngineRules['units'] = Array.from({ length: 62 }, (_, i) => unitType(`u${i}`));
units[BARBARIAN_UNITS.warriors] = unitType('Warriors', { role: 1, costRows: 1 });
units[BARBARIAN_UNITS.archers] = unitType('Archers', { attack: 3, defence: 2, role: 0 });
units[BARBARIAN_UNITS.legion] = unitType('Legion', { attack: 4, defence: 2, role: 0 });
units[BARBARIAN_UNITS.horsemen] = unitType('Horsemen', { attack: 2, move: 2, role: 0 });
units[BARBARIAN_UNITS.chariot] = unitType('Chariot', { attack: 3, move: 2, role: 0 });
units[BARBARIAN_UNITS.trireme] = unitType('Trireme', { domain: 2, move: 3, role: 4, holds: 2 });
units[BARBARIAN_UNITS.leader] = unitType('Diplomat', { attack: 0, move: 2, role: 6 });
units[BARBARIAN_UNITS.armor] = unitType('Armor', {
  attack: 10,
  defence: 5,
  move: 3,
  preq: { kind: 'advance', index: 55 },
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
  units,
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
function city(world: World, x: number, y: number, owner: number, size = 5): City {
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
function civ(slot: number, isHuman: boolean): Civ {
  return {
    slot,
    tribe: 0,
    name: slot === 0 ? 'Barbarians' : `Civ ${slot}`,
    adjective: slot === 0 ? 'Barbarian' : `C${slot}`,
    leader: 'L',
    cityStyle: 0,
    epoch: 0,
    colour: slot,
    government: GOVERNMENT.monarchy,
    treasury: 500,
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
/** Land in the west half, ocean in the east half. */
function world(): World {
  const w = new World({ columns: 30, rows: 40, flatEarth: true });
  for (let i = 0; i < w.area; i++) {
    const p = w.position(i);
    const sea = p.x >= 30;
    w.terrain[i] = sea ? OCEAN : 2;
    w.landmass[i] = sea ? 2 : 1;
  }
  w.civs.push(civ(0, false), civ(2, true));
  computeFertility(w, rules);
  return w;
}
function civAt(w: World, slot: number): Civ {
  const c = w.civs.find((x) => x.slot === slot);
  if (!c) throw new Error(`no civ ${slot}`);
  return c;
}
/** Ocean in the west half, land in the east half. */
function worldWestSea(): World {
  const w = new World({ columns: 30, rows: 40, flatEarth: true });
  for (let i = 0; i < w.area; i++) {
    const p = w.position(i);
    const sea = p.x < 30;
    w.terrain[i] = sea ? OCEAN : 2;
    w.landmass[i] = sea ? 2 : 1;
  }
  w.civs.push(civ(0, false), civ(2, true));
  computeFertility(w, rules);
  return w;
}
function ctx(w: World, over: Partial<BarbarianContext> = {}): BarbarianContext {
  return {
    rng: new Rng(5),
    turn: 103,
    year: -1000,
    difficulty: 2,
    activity: 2,
    realisticCombat: true,
    anyoneKnows: () => false,
    humanKnows: () => false,
    isHuman: (slot) => slot === 2,
    mainHuman: 2,
    cityCount: (slot) => w.cities.filter((c) => c.owner === slot).length,
    wondersOf: () => Array<boolean>(67).fill(false),
    guerillaWarfareDiscovered: false,
    ...over,
  };
}

describe('barbarian spawner', () => {
  it('waits for the activity schedule', () => {
    const w = world();
    city(w, 10, 10, 2);
    expect(spawnBarbarians(w, rules, ctx(w, { turn: 50 }))).toEqual([]);
    expect(w.units).toHaveLength(0);
    expect(spawnBarbarians(w, rules, ctx(w, { activity: 0 }))).toEqual([]);
  });

  it('lands a fleet on the schedule: a ship, a leader and troops at sea', () => {
    const w = worldWestSea();
    city(w, 40, 10, 2);
    const stubbed = { ...ctx(w), rng: { nextInt: () => 0 } as unknown as Rng };
    spawnBarbarians(w, rules, { ...stubbed, turn: 103 }); // (103 + 1) & 7 === 0
    const sea = w.units.filter(
      (u) => u.owner === 0 && w.terrainAt(u.position.x, u.position.y) === OCEAN,
    );
    expect(sea.map((u) => u.type).sort((a, b) => a - b)).toEqual([
      BARBARIAN_UNITS.archers,
      BARBARIAN_UNITS.trireme,
      BARBARIAN_UNITS.leader,
    ]);
  });

  it('raises an uprising near a rich human city with the plunder chance', () => {
    const w = world();
    city(w, 20, 20, 2, 6);
    const stubbed = { ...ctx(w, { turn: 104 }), rng: { nextInt: () => 0 } as unknown as Rng };
    const ev = spawnBarbarians(w, rules, stubbed);
    expect(ev.some((e) => e.text.includes('rise'))).toBe(true);
    const rising = w.units.filter((u) => u.owner === 0);
    expect(rising.length).toBe(3); // count clamps to 2, plus the leader
    expect(rising.some((u) => u.type === BARBARIAN_UNITS.leader)).toBe(true);
    expect(rising.every((u) => u.position.x === 14 && u.position.y === 14)).toBe(true);
  });
});

describe('barbarian moves', () => {
  it('a lone barbarian far from any city fades away on its fourth turn', () => {
    const w = world();
    city(w, 10, 10, 2);
    const u = unit(w, BARBARIAN_UNITS.legion, 10, 30, 0);
    const c = ctx(w, { turn: 4 - (u.id & 3) }); // (turn + id) & 3 === 0
    barbarianMoves(w, rules, civAt(w, 0), c);
    expect(w.units.includes(u)).toBe(false);
  });

  it('an undefended human city draws a ransom demand and falls when it is refused', () => {
    const w = world();
    const target = city(w, 10, 10, 2);
    city(w, 20, 10, 2);
    const legion = unit(w, BARBARIAN_UNITS.legion, 12, 10, 0);
    const ev = barbarianMoves(w, rules, civAt(w, 0), ctx(w, { turn: 5 }));
    expect(ev.some((e) => e.text.includes('demand'))).toBe(true);
    expect(target.owner).toBe(0);
    expect(legion.position).toEqual({ x: 10, y: 10 });
  });

  it('a paid ransom clears the raiders around the city', () => {
    const w = world();
    const target = city(w, 10, 10, 2);
    city(w, 20, 10, 2);
    unit(w, BARBARIAN_UNITS.legion, 12, 10, 0);
    const paid: number[] = [];
    barbarianMoves(
      w,
      rules,
      civAt(w, 0),
      ctx(w, { turn: 5, payRansom: (_, amount) => (paid.push(amount), true) }),
    );
    expect(paid).toHaveLength(1);
    expect(target.owner).toBe(2);
    expect(w.units.filter((u) => u.owner === 0)).toHaveLength(0);
    expect(civAt(w, 2).treasury).toBe(500 - (paid[0] ?? 0));
  });
});
