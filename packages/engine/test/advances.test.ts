import { describe, expect, it } from 'vitest';
import { advanceEffects, barracksClosedBy, leonardoUpgrades } from '../src/advances.js';
import { grantAdvance } from '../src/research.js';
import { IMPROVEMENT, type EngineRules } from '../src/rules.js';
import { World, type City, type Civ, type Unit } from '../src/world.js';

const none = { kind: 'none' } as const;
const adv = (index: number) => ({ kind: 'advance', index }) as const;
const type = (name: string, role: number, defence: number, extra: object = {}) => ({
  name,
  role,
  defence,
  ...extra,
});
const units = [
  type('Warriors', 1, 1, { obsoleteWith: adv(9) }),
  type('Phalanx', 1, 2, { obsoleteWith: adv(9), preq: adv(8) }),
  type('Pikemen', 1, 2, { preq: adv(9) }),
  type('Trireme', 4, 0, { obsoleteWith: adv(10), holds: 2 }),
  type('Caravel', 4, 0, { preq: adv(10), holds: 3 }),
  type('Scout', 2, 0),
  type('Rider', 2, 1),
  type('Musketeers', 1, 3, { preq: adv(35) }),
];
const advances = Array.from({ length: 90 }, (_, i) => ({
  name: `a${i}`,
  preq1: i === 53 ? adv(50) : none,
  preq2: none,
  epoch: 0,
  category: 0,
}));
const rules = {
  cosmic: { shieldBoxRows: 10 },
  units,
  advances,
  improvements: Array.from({ length: 67 }, (_, i) => ({
    name: `i${i}`,
    costRows: i === IMPROVEMENT.barracks ? 4 : 1,
    upkeep: 1,
  })),
} as unknown as EngineRules;

function civ(slot: number): Civ {
  return {
    slot,
    treasury: 0,
    researching: null,
    advancesCount: 0,
    futureTechs: 0,
    scienceStored: 0,
    knownAdvances: Array<boolean>(100).fill(false),
    freeAdvancePending: false,
  } as unknown as Civ;
}
function city(id: number, owner: number, ...buildings: number[]): City {
  const improvements = Array<boolean>(67).fill(false);
  for (const b of buildings) improvements[b] = true;
  return { id, owner, improvements } as unknown as City;
}
function unit(id: number, owner: number, t: number, veteran = false): Unit {
  return { id, owner, type: t, veteran, position: { x: 0, y: 0 } } as unknown as Unit;
}
function setup(cities: City[]) {
  const w = new World({ columns: 10, rows: 10, flatEarth: true });
  const a = civ(1);
  const b = civ(2);
  const c = civ(3);
  w.civs.push(a, b, c);
  w.cities.push(...cities);
  const firstDiscoveredBy = Array<number>(100).fill(0);
  const ctx = {
    turn: 10,
    firstDiscoveredBy,
    wonderOwner: (i: number) => w.cities.find((x) => x.improvements[i])?.owner ?? null,
    knows: (s: number, n: number) => w.civs.find((x) => x.slot === s)?.knownAdvances[n] === true,
  };
  return { w, a, b, c, ctx };
}

describe('gaining an advance', () => {
  it('counts every gain but starting advances, and clears only a matching research target', () => {
    const c = civ(1);
    c.researching = 7;
    grantAdvance(c, 3, 'other', true);
    expect(c.knownAdvances[3]).toBe(true);
    expect(c.advancesCount).toBe(0);
    grantAdvance(c, 4, 'other');
    expect(c.advancesCount).toBe(1);
    expect(c.researching).toBe(7);
    grantAdvance(c, 7, 'other');
    expect(c.researching).toBe(null);
  });

  it('Gunpowder and Mobile Warfare close every Barracks of the civilization for gold', () => {
    const { w, a, ctx } = setup([
      city(0, 1, IMPROVEMENT.barracks),
      city(1, 1, IMPROVEMENT.barracks),
      city(2, 2, IMPROVEMENT.barracks),
    ]);
    const events = advanceEffects(w, rules, a, 35, false, ctx);
    expect(a.treasury).toBe(80);
    expect(events).toContainEqual({ kind: 'barracks-sold', advance: 35, cities: 2, gold: 80 });
    expect(w.cities.map((c) => c.improvements[IMPROVEMENT.barracks])).toEqual([false, false, true]);
    expect(advanceEffects(w, rules, a, 53, false, ctx)).toEqual([]);
  });

  it('a ruleset that disables Mobile Warfare moves the second closing down its prerequisites', () => {
    const r = {
      ...rules,
      advances: advances.map((x, i) =>
        i === 53 ? { ...x, preq1: { kind: 'never' as const } } : x,
      ),
    } as unknown as EngineRules;
    expect(barracksClosedBy(rules)).toBe(53);
    expect(barracksClosedBy(r)).toBe(null);
  });

  it('the Great Library gives its owner what two civilizations know', () => {
    const { w, a, b, c, ctx } = setup([city(0, 1, IMPROVEMENT.greatLibrary)]);
    b.knownAdvances[5] = true;
    expect(advanceEffects(w, rules, b, 5, true, ctx)).toEqual([]);
    expect(a.knownAdvances[5]).toBe(false);
    c.knownAdvances[5] = true;
    expect(advanceEffects(w, rules, c, 5, false, ctx)).toContainEqual({
      kind: 'great-library',
      advance: 5,
    });
    expect(a.knownAdvances[5]).toBe(true);
    expect(a.advancesCount).toBe(1);
  });

  it('nothing happens during set-up, and Philosophy pays only the first to it', () => {
    const { w, a, b, ctx } = setup([city(0, 1, IMPROVEMENT.barracks)]);
    expect(advanceEffects(w, rules, a, 35, true, { ...ctx, turn: 0 })).toEqual([]);
    expect(a.treasury).toBe(0);
    advanceEffects(w, rules, a, 60, true, ctx);
    expect(a.freeAdvancePending).toBe(true);
    expect(ctx.firstDiscoveredBy[60]).toBe(1);
    advanceEffects(w, rules, b, 60, false, ctx);
    expect(b.freeAdvancePending).toBe(false);
  });
});

describe("Leonardo's Workshop", () => {
  it('upgrades every unit whose replacement is known, and they lose veteran status', () => {
    const { w, a } = setup([]);
    w.units.push(unit(0, 1, 0, true), unit(1, 1, 0), unit(2, 2, 0), unit(3, 1, 3));
    const known = new Set([9]);
    const events = leonardoUpgrades(w, rules, a, (n) => known.has(n));
    expect(w.units.map((u) => u.type)).toEqual([2, 2, 0, 3]);
    expect(w.units[0]?.veteran).toBe(false);
    expect(events).toEqual([{ kind: 'units-upgraded', from: 0, to: 2 }]);
  });

  it('with Gunpowder any weaker defender becomes Musketeers', () => {
    const { w, a } = setup([]);
    w.units.push(unit(0, 1, 2));
    leonardoUpgrades(w, rules, a, (n) => n === 35);
    expect(w.units[0]?.type).toBe(7);
  });
});
