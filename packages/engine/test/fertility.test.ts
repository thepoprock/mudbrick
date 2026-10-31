import { describe, expect, it } from 'vitest';
import {
  CITY_SPACING_OFFSETS,
  claimCitySite,
  computeFertility,
  fertilityTerrainValues,
  landValue,
  releaseCitySite,
} from '../src/fertility.js';
import type { EngineRules, TerrainRule } from '../src/rules.js';
import { CITY_CENTRE_INDEX, CITY_RADIUS_OFFSETS, OCEAN, World, type City } from '../src/world.js';

const terrain = (over: Partial<TerrainRule>): TerrainRule => ({
  moveCost: 1,
  defenceHalves: 2,
  food: 1,
  shields: 1,
  trade: 0,
  irrigateBonus: 1,
  mineBonus: 0,
  specials: [
    { food: 3, shields: 1, trade: 0 },
    { food: 1, shields: 3, trade: 0 },
  ],
  irrigate: { kind: 'no' },
  irrigateTurns: 5,
  mine: { kind: 'no' },
  mineTurns: 10,
  transformTo: { kind: 'no' },
  ...over,
});
const rules = {
  terrain: [
    terrain({}), // 0 desert
    terrain({ food: 1, shields: 1, irrigate: { kind: 'yes' } }), // 1 plains
    terrain({ food: 2, shields: 0, irrigate: { kind: 'yes' } }), // 2 grassland
    terrain({ food: 1, shields: 2 }), // 3 forest
    terrain({ food: 1, shields: 0, mine: { kind: 'yes' } }), // 4 hills
    terrain({ food: 0, shields: 1, mine: { kind: 'yes' } }), // 5 mountains
    terrain({}),
    terrain({}),
    terrain({}),
    terrain({}),
    terrain({ food: 1, shields: 0, trade: 2 }), // 10 ocean
  ],
} as unknown as EngineRules;

function world(fill: number): World {
  const w = new World({ columns: 20, rows: 30, flatEarth: true, resourceSeed: 7 });
  w.terrain.fill(fill);
  w.landmass.fill(fill === OCEAN ? 0 : 1);
  return w;
}

describe('fertility rating', () => {
  it('values terrain as food × 3 + trade, shields × 2 except grassland, plus the work bonus', () => {
    const v = fertilityTerrainValues(rules);
    expect(v[1]).toBe(1 * 3 + 0 + 1 * 2 + 2); // plains: irrigable
    expect(v[2]).toBe(2 * 3 + 0 + 2); // grassland: shields ignored, irrigable
    expect(v[4]).toBe(1 * 3 + 0 + 3); // hills: mineable, +3
    expect(v[5]).toBe(0 + 1 * 2 + 1); // mountains: mineable, +1
    expect(v[12]).toBe(3 * 3 + 1 * 2 + 2); // plains with its first special
  });

  it('rates only plains and grassland, between 8 and 15', () => {
    const w = world(2);
    for (let k = 0; k < 20; k++) w.terrain[w.index(2 * k + 1, 1)] = 3; // a forest row
    const per = computeFertility(w, rules);
    let rated = 0;
    for (let i = 0; i < w.area; i++) {
      const f = w.fertility[i] ?? 0;
      if (w.terrain[i] === 3) expect(f).toBe(0);
      else {
        expect(f).toBeGreaterThanOrEqual(8);
        expect(f).toBeLessThanOrEqual(15);
        rated += 1;
      }
    }
    expect(per[1]).toBe(rated);
    expect(computeFertility(world(OCEAN), rules).every((n) => n === 0)).toBe(true);
  });

  it('a founded city demotes 45 squares and claims 21; removal restores them', () => {
    const w = world(2);
    computeFertility(w, rules);
    const city: City = {
      id: 0,
      position: { x: 20, y: 14 },
      owner: 3,
      name: 'A',
      size: 1,
      improvements: [],
      foodStored: 0,
      shieldsStored: 0,
      worked: 1 << CITY_CENTRE_INDEX,
      specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
      production: { kind: 'unit', index: 0 },
      inDisorder: false,
      celebrating: false,
      tradeRoutes: [],
    };
    const before = Uint8Array.from(w.fertility);
    w.cities.push(city);
    claimCitySite(w, city);
    expect(CITY_SPACING_OFFSETS).toHaveLength(45);
    CITY_SPACING_OFFSETS.forEach((o, i) => {
      const k = w.index(20 + o.x, 14 + o.y);
      expect(w.fertility[k]).toBe((before[k] ?? 0) & 7);
      expect(w.territory[k]).toBe(i < CITY_RADIUS_OFFSETS.length ? 3 : 0);
    });
    expect(landValue(w, 20, 14)).toBe(3); // claimed: the owner, never a site
    expect(landValue(w, 25, 15)).toBe(8); // demoted: the minimum site value
    expect(landValue(w, 32, 14)).toBe(before[w.index(32, 14)]);
    w.cities.splice(0, 1);
    releaseCitySite(w, city);
    for (const o of CITY_SPACING_OFFSETS) {
      const k = w.index(20 + o.x, 14 + o.y);
      expect(w.fertility[k]).toBe(before[k]);
      expect(w.territory[k]).toBe(0);
    }
  });
});
