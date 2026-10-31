import { describe, expect, it } from 'vitest';
import { enterHut, type HutContext } from '../src/huts.js';
import { disbandUnit, fortify, orderGoTo, pillage, pillageOptions, sentry } from '../src/orders.js';
import { Rng } from '../src/rng.js';
import { IMPROVEMENT, type EngineRules, type TerrainRule } from '../src/rules.js';
import { ORDER } from '../src/terraform.js';
import { beginUnitTurn, checkFuel, healUnit } from '../src/turnStart.js';
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
const terrain = (over: Partial<TerrainRule> = {}): TerrainRule => ({
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
  transformTo: { kind: 'no' },
  ...over,
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
    transformBaseTurns: 20,
  },
  terrain: Array.from({ length: 11 }, (_, i) =>
    terrain(i === 10 ? { irrigate: { kind: 'no' } } : {}),
  ),
  units: Array.from({ length: 22 }, (_, i) => unitType(`u${i}`)),
  advances: Array.from({ length: 100 }, () => ({
    name: 'a',
    preq1: { kind: 'none' as const },
    preq2: { kind: 'none' as const },
    epoch: 0,
    category: 0,
  })),
  improvements: Array.from({ length: 67 }, (_, i) => ({ name: `i${i}`, costRows: 4, upkeep: 1 })),
};
rules.units[0] = unitType('Settlers', { attack: 0, hitPointsTens: 2, costRows: 4, role: 5 });
rules.units[2] = unitType('Warriors', { costRows: 1, role: 1 });
rules.units[3] = unitType('Legion', {
  attack: 4,
  defence: 2,
  costRows: 4,
  role: 0,
  hitPointsTens: 1,
});
rules.units[12] = unitType('Fighter', {
  domain: 1,
  move: 10,
  range: 1,
  attack: 4,
  defence: 2,
  hitPointsTens: 2,
  costRows: 6,
});
rules.units[13] = unitType('Bomber', {
  domain: 1,
  move: 8,
  range: 2,
  attack: 12,
  defence: 1,
  hitPointsTens: 2,
  costRows: 12,
});
rules.units[14] = unitType('Helicopter', {
  domain: 1,
  move: 6,
  range: 0,
  attack: 10,
  defence: 3,
  hitPointsTens: 2,
  costRows: 10,
});
rules.units[20] = unitType('Battleship', {
  domain: 2,
  move: 4,
  attack: 12,
  defence: 12,
  hitPointsTens: 4,
  costRows: 16,
});

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
function city(world: World, x: number, y: number, owner = 1, imps: number[] = []): City {
  const improvements = Array<boolean>(67).fill(false);
  for (const i of imps) improvements[i] = true;
  const c: City = {
    id: world.cities.length,
    position: { x, y },
    owner,
    name: 'C',
    size: 3,
    improvements,
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
function land(): World {
  const w = new World({ columns: 20, rows: 30, flatEarth: true });
  w.terrain.fill(2);
  return w;
}

describe('healing (verified)', () => {
  it('heals 10 % in the field, more near and in cities, fully with the right building', () => {
    const w = land();
    const field = unit(w, 3, 2, 2, { hitPointsLost: 5 });
    expect(healUnit(w, rules, field)).toEqual({ kind: 'healed', unit: field, amount: 1 });
    w.setFlag(4, 4, SquareFlag.Fortress);
    const fort = unit(w, 3, 4, 4, { hitPointsLost: 5 });
    expect(healUnit(w, rules, fort)?.amount).toBe(2);
    city(w, 10, 10);
    const near = unit(w, 3, 12, 10, { hitPointsLost: 5 }); // one square away: +1 → 20 %
    expect(healUnit(w, rules, near)?.amount).toBe(2);
    const inside = unit(w, 3, 10, 10, { hitPointsLost: 9 }); // (1 + 1) × 2 = 4 → 40 %
    expect(healUnit(w, rules, inside)?.amount).toBe(4);
    city(w, 20, 10, 1, [IMPROVEMENT.barracks]);
    const barracks = unit(w, 3, 20, 10, { hitPointsLost: 9 });
    expect(healUnit(w, rules, barracks)?.amount).toBe(9); // full
    const ship = unit(w, 20, 10, 10, { hitPointsLost: 20 }); // sea unit in a city without a Port Facility: 1 × 2 = 20 %
    expect(healUnit(w, rules, ship)?.amount).toBe(8);
    const moved = unit(w, 3, 2, 6, { hitPointsLost: 5, moved: true });
    expect(healUnit(w, rules, moved)).toBeNull();
  });

  it('wakes a healed sentry and wears down helicopters that moved', () => {
    const w = land();
    const s = unit(w, 3, 2, 2, { hitPointsLost: 1, order: ORDER.sleep });
    healUnit(w, rules, s);
    expect(s.order).toBeNull();
    const heli = unit(w, 14, 4, 4, { moved: true });
    expect(healUnit(w, rules, heli)).toEqual({ kind: 'helicopter-damage', unit: heli, amount: 2 });
    city(w, 6, 6);
    const safe = unit(w, 14, 6, 6, { moved: true });
    expect(healUnit(w, rules, safe)).toBeNull();
  });
});

describe('fuel and orders at turn start', () => {
  it('crashes a fighter away from base after one turn and a bomber after two', () => {
    const w = land();
    const fighter = unit(w, 12, 2, 2);
    expect(checkFuel(w, rules, fighter)).toEqual({ kind: 'crashed', unit: fighter });
    expect(w.units.includes(fighter)).toBe(false);
    const bomber = unit(w, 13, 2, 2);
    expect(checkFuel(w, rules, bomber)).toEqual({ kind: 'fuel', unit: bomber, used: 1, range: 2 });
    expect(checkFuel(w, rules, bomber)?.kind).toBe('crashed');
    city(w, 4, 4);
    const home = unit(w, 12, 4, 4, { workCounter: 1 });
    expect(checkFuel(w, rules, home)).toBeNull();
    expect(home.workCounter).toBe(0);
  });

  it('completes fortify, continues work, and walks a go-to', () => {
    const w = land();
    const f = unit(w, 3, 2, 2);
    fortify(f);
    expect(
      beginUnitTurn(w, rules, new Rng(1), f, { knows: () => false }).map((e) => e.kind),
    ).toEqual(['fortified']);
    expect(f.fortified).toBe(true);
    const s = unit(w, 0, 4, 4, { order: ORDER.road, workCounter: 1 });
    const ev = beginUnitTurn(w, rules, new Rng(1), s, { knows: () => false });
    expect(ev[0]?.kind).toBe('work');
    expect(w.hasFlag(4, 4, SquareFlag.Road)).toBe(true);
    expect(s.movesSpent).toBe(3);
    const g = unit(w, 3, 6, 6);
    orderGoTo(g, { x: 10, y: 6 });
    const step = beginUnitTurn(w, rules, new Rng(1), g, { knows: () => false });
    expect(step.map((e) => e.kind)).toEqual(['goto-step']);
    expect(g.position).toEqual({ x: 8, y: 6 });
    expect(g.order).toBe(ORDER.goTo);
    beginUnitTurn(w, rules, new Rng(1), g, { knows: () => false });
    expect(g.position).toEqual({ x: 10, y: 6 });
    expect(g.order).toBeNull();
    const z = unit(w, 3, 12, 12);
    sentry(z);
    expect(z.order).toBe(ORDER.sleep);
  });
});

describe('pillage and disband (verified)', () => {
  it('lists what can be pillaged in the original order and removes the choice', () => {
    const w = land();
    const legion = unit(w, 3, 2, 2);
    expect(pillageOptions(w, rules, legion)).toEqual({ ok: false, reason: 'nothing' });
    w.setFlag(2, 2, SquareFlag.Irrigation);
    w.setFlag(2, 2, SquareFlag.Farmland);
    w.setFlag(2, 2, SquareFlag.Road);
    w.setFlag(2, 2, SquareFlag.Railroad);
    w.setFlag(2, 2, SquareFlag.Fortress);
    expect(pillageOptions(w, rules, legion)).toEqual({
      ok: true,
      options: ['farmland', 'fortress', 'railroad'],
    });
    pillage(w, rules, legion, 'railroad');
    expect(w.hasFlag(2, 2, SquareFlag.Railroad)).toBe(false);
    expect(w.hasFlag(2, 2, SquareFlag.Road)).toBe(true);
    expect(legion.movesSpent).toBe(3);
    expect(pillageOptions(w, rules, unit(w, 0, 2, 2))).toEqual({ ok: false, reason: 'non-combat' });
    city(w, 4, 4);
    expect(pillageOptions(w, rules, unit(w, 3, 4, 4))).toEqual({ ok: false, reason: 'in-city' });
  });

  it('refunds half the cost when disbanding inside a city', () => {
    const w = land();
    const c = city(w, 4, 4);
    const legion = unit(w, 3, 4, 4);
    expect(disbandUnit(w, rules, legion, { isHuman: true }, 2)).toBe(20);
    expect(c.shieldsStored).toBe(20);
    expect(disbandUnit(w, rules, unit(w, 3, 8, 8), { isHuman: true }, 2)).toBe(0);
    expect(w.units).toHaveLength(0);
  });
});

describe('huts (verified decision tree)', () => {
  const ctx = (over: Partial<HutContext> = {}): HutContext => ({
    turn: 20,
    year: -3000,
    difficulty: 2,
    barbarianActivity: 1,
    knownByAnyone: () => false,
    nextCityName: () => 'Hut Town',
    ...over,
  });

  it('gives an AI with no city on this land mass an advanced tribe', () => {
    const w = land();
    const ai = civ({ isHuman: false });
    w.civs.push(civ({ slot: 0, isHuman: false }), ai);
    // Its only city is far away on another land mass.
    w.landmass.fill(1);
    w.landmass[w.index(18, 28)] = 2;
    city(w, 18, 28);
    const scout = unit(w, 3, 2, 2);
    const out = enterHut(w, rules, new Rng(9), ai, scout, ctx());
    expect(out.kind).toBe('tribe');
    if (out.kind === 'tribe') {
      expect(out.city.size).toBe(1);
      expect(out.city.improvements[IMPROVEMENT.palace]).toBe(false);
    }
    expect(w.hasFlag(2, 2, SquareFlag.NoSpecial)).toBe(true);
  });

  it('follows the roll for a human and applies the gold and nomad rules', () => {
    const w = land();
    const me = civ();
    w.civs.push(civ({ slot: 0, isHuman: false }), me);
    city(w, 10, 10);
    const scout = unit(w, 3, 2, 2);
    const probe = new Rng(4);
    const roll = probe.nextInt(5);
    const out = enterHut(w, rules, new Rng(4), me, scout, ctx({ turn: 20 }));
    const expected: Record<number, string[]> = {
      0: ['tribe'],
      1: ['mercenaries'],
      2: ['gold'],
      3: ['nothing', 'barbarians', 'mercenaries', 'tribe'],
      4: ['scrolls', 'gold', 'tribe', 'mercenaries'],
    };
    expect(expected[roll]).toContain(out.kind);
    if (out.kind === 'gold') expect([25, 50, 100]).toContain(out.gold);
  });

  it('turns nomads into gold once anyone knows Explosives', () => {
    const w = land();
    const me = civ();
    w.civs.push(civ({ slot: 0, isHuman: false }), me);
    city(w, 10, 10);
    // Find a seed whose first roll is 5 % 5 → use outcome 5 path by searching seeds.
    let seed = 1;
    for (; seed < 200; seed++) if (new Rng(seed).nextInt(5) === 0) break;
    const scout = unit(w, 3, 2, 2);
    const out = enterHut(
      w,
      rules,
      new Rng(seed),
      me,
      scout,
      ctx({ landValue: 5, knownByAnyone: (a) => a === 28 }),
    );
    // outcome 0 → land value too low → nomads → Explosives known → gold
    expect(out.kind).toBe('gold');
  });
});
