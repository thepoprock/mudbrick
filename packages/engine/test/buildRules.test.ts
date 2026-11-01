import { describe, expect, it } from 'vitest';
import { canBuildImprovementAt, canBuildUnitType, type BuildContext } from '../src/buildRules.js';
import type { EngineRules } from '../src/rules.js';
import { CITY_CENTRE_INDEX, World, type City, type Civ } from '../src/world.js';

const rules = {
  improvements: Array.from({ length: 67 }, (_, i) => ({ name: `i${i}`, preq: { kind: 'none' } })),
  units: Array.from({ length: 12 }, (_, i) => ({
    name: `u${i}`,
    role: i === 3 ? 1 : 0,
    domain: i === 4 ? 2 : 0,
    move: 1,
    attack: 1,
    defence: i === 7 ? 3 : 1,
    preq: { kind: 'none' },
  })),
} as unknown as EngineRules;

function world(): { w: World; c: City } {
  const w = new World({ columns: 20, rows: 20, flatEarth: true });
  w.terrain.fill(2);
  const c: City = {
    id: 0,
    position: { x: 10, y: 10 },
    owner: 1,
    name: 'A',
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
  };
  w.cities.push(c);
  return { w, c };
}
const ctx: BuildContext = {
  knows: () => true,
  ownsWonder: () => false,
  wonderBuilt: () => false,
  afterChrist: true,
  bloodlust: false,
  launched: false,
};
const civ = (over: Partial<Civ>) =>
  ({ government: 1, isHuman: true, knownAdvances: Array(100).fill(false), ...over }) as Civ;

describe('what can be built', () => {
  it('a Bank needs a Marketplace, and a Courthouse is not for the capital', () => {
    const { w, c } = world();
    expect(canBuildImprovementAt(w, rules, c, 10, ctx)).toBe(false);
    c.improvements[5] = true;
    expect(canBuildImprovementAt(w, rules, c, 10, ctx)).toBe(true);
    expect(canBuildImprovementAt(w, rules, c, 7, ctx)).toBe(true);
    c.improvements[1] = true;
    expect(canBuildImprovementAt(w, rules, c, 7, ctx)).toBe(false);
  });

  it('plants need a Factory and exclude one another; a Harbor needs the coast', () => {
    const { w, c } = world();
    expect(canBuildImprovementAt(w, rules, c, 19, ctx)).toBe(false);
    c.improvements[15] = true;
    expect(canBuildImprovementAt(w, rules, c, 19, ctx)).toBe(true);
    expect(canBuildImprovementAt(w, rules, c, 19, { ...ctx, ownsWonder: (i) => i === 61 })).toBe(
      false,
    );
    expect(canBuildImprovementAt(w, rules, c, 30, ctx)).toBe(false);
  });

  it('the spaceship waits for Apollo; a wonder is built once', () => {
    const { w, c } = world();
    expect(canBuildImprovementAt(w, rules, c, 35, ctx)).toBe(false);
    expect(canBuildImprovementAt(w, rules, c, 35, { ...ctx, wonderBuilt: (i) => i === 64 })).toBe(
      true,
    );
    expect(canBuildImprovementAt(w, rules, c, 40, { ...ctx, wonderBuilt: (i) => i === 40 })).toBe(
      false,
    );
  });

  it('Gunpowder retires weak defenders and Fanatics need Fundamentalism', () => {
    const old = civ({});
    expect(canBuildUnitType(rules, old, 3)).toBe(true);
    const later = civ({});
    later.knownAdvances[35] = true;
    expect(canBuildUnitType(rules, later, 3)).toBe(false);
    expect(canBuildUnitType(rules, civ({}), 8)).toBe(false);
    expect(canBuildUnitType(rules, civ({ government: 4 }), 8)).toBe(true);
  });

  it('a ship needs real sea', () => {
    const { w, c } = world();
    expect(canBuildUnitType(rules, civ({}), 4, { world: w, city: c, manhattanBuilt: false })).toBe(
      false,
    );
  });
});
