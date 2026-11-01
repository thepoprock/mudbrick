import { describe, expect, it } from 'vitest';
import {
  changeProduction,
  processProduction,
  productionCategory,
  startsVeteran,
  type ProductionContext,
} from '../src/production.js';
import { Rng } from '../src/rng.js';
import { GOVERNMENT, IMPROVEMENT, type EngineRules } from '../src/rules.js';
import { CITY_CENTRE_INDEX, World, type City } from '../src/world.js';

const flags = (over = {}) => ({
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
const terrain = {
  moveCost: 1,
  defenceHalves: 2,
  food: 2,
  shields: 1,
  trade: 0,
  irrigateBonus: 1,
  mineBonus: 0,
  irrigate: { kind: 'yes' as const },
  irrigateTurns: 5,
  mine: { kind: 'no' as const },
  mineTurns: 10,
  transformTo: { kind: 'no' as const },
  specials: [
    { food: 0, shields: 0, trade: 0 },
    { food: 0, shields: 0, trade: 0 },
  ] as [
    { food: number; shields: number; trade: number },
    { food: number; shields: number; trade: number },
  ],
};
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
  terrain: Array.from({ length: 11 }, () => terrain),
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
      name: 'Warriors',
      domain: 0,
      move: 1,
      range: 0,
      attack: 1,
      defence: 1,
      hitPointsTens: 1,
      firepower: 1,
      costRows: 1,
      role: 1, // same role as Pikemen, as the upgrade rule requires
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
      flags: flags(),
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
      flags: flags(),
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
      flags: flags(),
    },
    {
      name: 'Diplomat',
      domain: 0,
      move: 2,
      range: 0,
      attack: 0,
      defence: 1,
      hitPointsTens: 1,
      firepower: 1,
      costRows: 3,
      role: 6,
      flags: flags(),
    },
  ],
  advances: [],
  improvements: Array.from({ length: 67 }, (_, i) => ({
    name: `i${i}`,
    costRows: i === IMPROVEMENT.palace ? 10 : 4,
    upkeep: 1,
  })),
};
// Warriors (1) are obsoleted by advance 7, whose "prerequisite" unit is Pikemen (2).
const obsoleteWith = (t: number) => (t === 1 ? 7 : null);
const prereq = (t: number) => (t === 2 ? 7 : null);

function ctx(over: Partial<ProductionContext> = {}): ProductionContext {
  return {
    government: GOVERNMENT.monarchy,
    isHuman: true,
    difficulty: 2,
    realisticCombat: true,
    cityCount: 3,
    knows: () => false,
    ownsWonder: () => false,
    wonderCity: () => null,
    canBuildSpaceship: false,
    shieldRows: 10,
    ...over,
  };
}
function makeCity(world: World, over: Partial<City> = {}): City {
  const c: City = {
    id: 0,
    position: { x: 4, y: 4 },
    owner: 1,
    name: 'Ur',
    size: 3,
    improvements: Array<boolean>(67).fill(false),
    foodStored: 0,
    shieldsStored: 0,
    worked: 1 << CITY_CENTRE_INDEX,
    specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
    production: { kind: 'unit', index: 1 },
    inDisorder: false,
    celebrating: false,
    tradeRoutes: [],
    ...over,
  };
  world.cities.push(c);
  return c;
}
let nextId = 100;
const inputs = (surplus: number, supplied = [3, 5, -2]) => ({
  surplus,
  supplied,
  obsoleteWith,
  prereq,
  nextUnitId: () => nextId++,
});

describe('production (verified)', () => {
  it('accumulates shields, completes a unit, and humans lose the overflow', () => {
    const w = new World({ columns: 4, rows: 8, flatEarth: true });
    const c = makeCity(w, { shieldsStored: 8 });
    const ev = processProduction(w, rules, new Rng(1), c, ctx(), inputs(5));
    expect(ev.map((e) => e.kind)).toEqual(['shields', 'built-unit']);
    expect(w.units).toHaveLength(1);
    expect(w.units[0]?.homeCity).toBe(0);
    expect(c.shieldsStored).toBe(0); // 13 − 10, then reset for humans
  });

  it('keeps the AI carry-over and does nothing in disorder', () => {
    const w = new World({ columns: 4, rows: 8, flatEarth: true });
    const c = makeCity(w, { shieldsStored: 8 });
    processProduction(w, rules, new Rng(1), c, ctx({ isHuman: false }), inputs(5));
    expect(c.shieldsStored).toBe(3);
    const d = makeCity(w, { id: 1, shieldsStored: 8, inDisorder: true });
    processProduction(w, rules, new Rng(1), d, ctx(), inputs(5));
    expect(d.shieldsStored).toBe(8);
  });

  it('upgrades an obsolete unit on completion', () => {
    const w = new World({ columns: 4, rows: 8, flatEarth: true });
    const c = makeCity(w, { shieldsStored: 20 });
    const ev = processProduction(
      w,
      rules,
      new Rng(1),
      c,
      ctx({ knows: (a) => a === 7 }),
      inputs(0),
    );
    expect(ev.some((e) => e.kind === 'upgraded' && e.to === 2)).toBe(true);
    expect(w.units[0]?.type).toBe(2);
  });

  it('builds improvements and wonders, rejects duplicates and taken wonders, moves the Palace', () => {
    const w = new World({ columns: 4, rows: 8, flatEarth: true });
    const old = makeCity(w, { id: 0 });
    old.improvements[IMPROVEMENT.palace] = true;
    const c = makeCity(w, {
      id: 1,
      position: { x: 6, y: 6 },
      shieldsStored: 100,
      production: { kind: 'improvement', index: IMPROVEMENT.palace },
    });
    let ev = processProduction(w, rules, new Rng(1), c, ctx(), inputs(0));
    expect(ev.map((e) => e.kind)).toContain('palace-moved');
    expect(old.improvements[IMPROVEMENT.palace]).toBe(false);
    expect(c.improvements[IMPROVEMENT.palace]).toBe(true);
    c.production = { kind: 'improvement', index: IMPROVEMENT.palace };
    c.shieldsStored = 100;
    ev = processProduction(w, rules, new Rng(1), c, ctx(), inputs(0));
    expect(ev.map((e) => e.kind)).toContain('bad-build');
    c.production = { kind: 'improvement', index: IMPROVEMENT.darwins };
    c.shieldsStored = 100;
    ev = processProduction(w, rules, new Rng(1), c, ctx({ wonderCity: () => 7 }), inputs(0));
    expect(ev.map((e) => e.kind)).toContain('bad-build');
    // A computer city yields while a human is about to finish the same wonder.
    ev = processProduction(
      w,
      rules,
      new Rng(1),
      c,
      ctx({ isHuman: false, humanReadyForWonder: () => true }),
      inputs(0),
    );
    expect(ev.map((e) => e.kind)).toContain('wonder-yielded');
    expect(c.improvements[IMPROVEMENT.darwins]).toBe(false);
    expect(c.wonderCity).toBeUndefined();
    ev = processProduction(w, rules, new Rng(1), c, ctx(), inputs(0));
    expect(ev.map((e) => e.kind)).toEqual(['shields', 'built-wonder', 'wonder-effect']);
    expect(c.wonderCity).toBe(true);
    c.production = { kind: 'improvement', index: 35 };
    c.shieldsStored = 100;
    expect(
      processProduction(w, rules, new Rng(1), c, ctx(), inputs(0)).map((e) => e.kind),
    ).toContain('bad-space');
  });

  it('charges population for settlers and respects the last-city and ghost-town rules', () => {
    const w = new World({ columns: 4, rows: 8, flatEarth: true });
    const c = makeCity(w, { size: 3, shieldsStored: 40, production: { kind: 'unit', index: 0 } });
    processProduction(w, rules, new Rng(1), c, ctx(), inputs(0));
    expect(c.size).toBe(2);
    const small = makeCity(w, {
      id: 1,
      size: 1,
      shieldsStored: 40,
      production: { kind: 'unit', index: 0 },
    });
    expect(
      processProduction(w, rules, new Rng(1), small, ctx({ cityCount: 1 }), inputs(0)).map(
        (e) => e.kind,
      ),
    ).toContain('waiting');
    expect(
      processProduction(w, rules, new Rng(1), small, ctx(), inputs(0)).map((e) => e.kind),
    ).toContain('waiting');
    const ev = processProduction(w, rules, new Rng(1), small, ctx(), inputs(0), {
      allowGhostTown: () => true,
    });
    expect(ev.map((e) => e.kind)).toContain('ghost-town');
    expect(w.cities.includes(small)).toBe(false);
  });

  it('decides veteran status by domain and buildings, and Communist diplomats', () => {
    const w = new World({ columns: 4, rows: 8, flatEarth: true });
    const c = makeCity(w);
    expect(startsVeteran(rules, c, ctx(), 1)).toBe(false);
    c.improvements[IMPROVEMENT.barracks] = true;
    expect(startsVeteran(rules, c, ctx(), 1)).toBe(true);
    expect(startsVeteran(rules, c, ctx(), 3)).toBe(false); // trireme needs a Port Facility under realistic combat
    expect(startsVeteran(rules, c, ctx({ realisticCombat: false }), 3)).toBe(true);
    c.improvements[IMPROVEMENT.portFacility] = true;
    expect(startsVeteran(rules, c, ctx(), 3)).toBe(true);
    expect(startsVeteran(rules, c, ctx({ government: GOVERNMENT.communism }), 5)).toBe(true);
  });

  it('gives caravans a commodity and marks it used', () => {
    const w = new World({ columns: 4, rows: 8, flatEarth: true });
    const c = makeCity(w, { shieldsStored: 50, production: { kind: 'unit', index: 4 } });
    const supplied = [3, 5, -2];
    processProduction(w, rules, new Rng(1), c, ctx(), inputs(0, supplied), {
      caravanCommodity: () => 1,
    });
    expect(w.units[0]?.commodity).toBe(5);
    expect(supplied[1]).toBe(-5);
    const ai = makeCity(w, { id: 1, shieldsStored: 50, production: { kind: 'unit', index: 4 } });
    processProduction(w, rules, new Rng(3), ai, ctx({ isHuman: false }), inputs(0));
    expect(w.units[1]?.commodity).toBeLessThan(16);
  });

  it('charges the change penalty only across categories and above Chieftain', () => {
    const w = new World({ columns: 4, rows: 8, flatEarth: true });
    expect(productionCategory({ kind: 'unit', index: 3 })).toBe(0);
    expect(productionCategory({ kind: 'improvement', index: 34 })).toBe(1);
    expect(productionCategory({ kind: 'improvement', index: 35 })).toBe(2);
    expect(productionCategory({ kind: 'improvement', index: 40 })).toBe(2);
    const c = makeCity(w, { shieldsStored: 30, production: { kind: 'unit', index: 1 } });
    expect(changeProduction(rules, c, { kind: 'unit', index: 2 }, 2)).toBe(0);
    expect(changeProduction(rules, c, { kind: 'improvement', index: 2 }, 2)).toBe(15);
    expect(c.shieldsStored).toBe(15);
    expect(changeProduction(rules, c, { kind: 'unit', index: 1 }, 0)).toBe(0);
  });
});
