import { describe, expect, it } from 'vitest';
import {
  cityPollution,
  globalWarming,
  meltdownRoll,
  pollutionRoll,
  warmingTurn,
} from '../src/pollution.js';
import { Rng } from '../src/rng.js';
import { ADVANCE, IMPROVEMENT } from '../src/rules.js';
import { CITY_CENTRE_INDEX, SquareFlag, World, type City } from '../src/world.js';

function city(size: number, imps: number[] = []): City {
  const improvements = Array<boolean>(67).fill(false);
  for (const i of imps) improvements[i] = true;
  return {
    id: 0,
    position: { x: 10, y: 10 },
    owner: 1,
    name: 'C',
    size,
    improvements,
    foodStored: 0,
    shieldsStored: 0,
    worked: 1 << CITY_CENTRE_INDEX,
    specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
    production: { kind: 'unit', index: 0 },
    inDisorder: false,
    celebrating: false,
    tradeRoutes: [],
  };
}
const ctx = (knows: number[], over = {}) => ({
  knows: (a: number) => knows.includes(a),
  advancesCount: 40,
  difficulty: 2,
  ...over,
});

describe('pollution (verified)', () => {
  it('adds production over 20 and size × tech factor / 4', () => {
    expect(cityPollution(city(8), 30, ctx([]))).toBe(10);
    expect(cityPollution(city(8), 30, ctx([ADVANCE.industrialization, ADVANCE.automobile]))).toBe(
      10 + Math.trunc((8 * 3) / 4),
    ); // 2 known + 1 without Sanitation
    expect(
      cityPollution(
        city(8),
        30,
        ctx([ADVANCE.industrialization, ADVANCE.automobile, ADVANCE.sanitation]),
      ),
    ).toBe(10 + 4);
    expect(
      cityPollution(city(8, [IMPROVEMENT.massTransit]), 30, ctx([ADVANCE.industrialization])),
    ).toBe(10);
    expect(cityPollution(city(8, [IMPROVEMENT.recyclingCenter]), 90, ctx([]))).toBe(10);
    expect(
      cityPollution(city(8, [IMPROVEMENT.solarPlant]), 90, ctx([ADVANCE.industrialization])),
    ).toBe(Math.trunc((8 * 1) / 4)); // 1 + 1 (no Sanitation) − 1 solar
    expect(cityPollution(city(8), 30, ctx([]), true)).toBe(0); // Hoover Dam halves production pollution: 15 − 20 < 0
  });

  it('rolls against 256 − advances × difficulty / 2 and dirties a land square', () => {
    const counter = { value: 0 };
    let polluted = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const w = new World({ columns: 20, rows: 30, flatEarth: true });
      w.terrain.fill(2);
      const c = city(10);
      w.cities.push(c);
      const r = pollutionRoll(w, new Rng(seed), c, 60, ctx([]), counter); // 2 × 60 = 120 of 216
      if (r) {
        polluted++;
        const dirty = w.flags.reduce((n, f) => n + ((f & SquareFlag.Pollution) !== 0 ? 1 : 0), 0);
        expect(dirty).toBe(1);
        expect(w.terrainAt(r.x, r.y)).not.toBe(10);
      }
    }
    expect(polluted).toBeGreaterThan(60);
    expect(counter.value).toBe(polluted);
    const w = new World({ columns: 20, rows: 30, flatEarth: true });
    w.terrain.fill(2);
    const c = city(10);
    w.cities.push(c);
    expect(pollutionRoll(w, new Rng(1), c, 0, ctx([]))).toBeNull();
    expect(pollutionRoll(w, new Rng(1), c, 60, ctx([], { eliminatePollution: true }))).toBeNull();
  });

  it('melts down a disordered Nuclear Plant without Fusion Power', () => {
    const c = city(10, [IMPROVEMENT.nuclearPlant]);
    expect(meltdownRoll(new Rng(1), c, ctx([]))).toBeNull(); // not in disorder
    c.inDisorder = true;
    expect(meltdownRoll(new Rng(1), c, ctx([ADVANCE.fusionPower]))).toBeNull();
    let melted = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const copy = city(10, [IMPROVEMENT.nuclearPlant]);
      copy.inDisorder = true;
      if (meltdownRoll(new Rng(seed), copy, ctx([], { difficulty: 5 }))) {
        melted++;
        expect(copy.improvements[IMPROVEMENT.nuclearPlant]).toBe(false);
      }
    }
    expect(melted).toBe(100); // 1 / (6 − 5): certain at Deity
  });

  it('warming builds with pollution, is held back by Solar Plants, and strikes past 16', () => {
    const s = { counter: 16, events: 0, polluted: 40, baseline: 0 };
    expect(warmingTurn(s, 1, 0)).toBe('warm');
    expect(s).toMatchObject({ counter: 0, events: 1 });
    const held = { counter: 5, events: 0, polluted: 3, baseline: 0 };
    expect(warmingTurn(held, 1, 6)).toBe(null);
    expect(held.counter).toBe(4);
    const warn = { counter: 11, events: 0, polluted: 20, baseline: 0 };
    expect(warmingTurn(warn, 1, 0)).toBe('warn');
  });

  it('the coast turns to swamp and jungle, and loses its works', () => {
    const w = new World({ columns: 20, rows: 20, flatEarth: true });
    w.terrain.fill(10);
    w.terrain[w.index(10, 10)] = 2;
    w.terrain[w.index(12, 10)] = 3;
    w.setFlag(10, 10, SquareFlag.Irrigation, true);
    globalWarming(w, 0);
    expect(w.terrain[w.index(10, 10)]).toBe(8);
    expect(w.terrain[w.index(12, 10)]).toBe(9);
    expect(w.hasFlag(10, 10, SquareFlag.Irrigation)).toBe(false);
  });
});
