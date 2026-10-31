import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeText, parseRules } from '@mudbrick/formats';
import { generateMap } from '../src/mapgen.js';
import { newGame } from '../src/newGame.js';
import { Rng } from '../src/rng.js';
import type { EngineRules } from '../src/rules.js';
import { OCEAN } from '../src/world.js';

const dir = process.env.ORIGINAL_GAME_DIR;
const rules = dir
  ? (parseRules(
      decodeText(new Uint8Array(readFileSync(`${dir}/RULES.TXT`))),
    ) as unknown as EngineRules)
  : undefined;
const leaders = dir
  ? parseRules(decodeText(new Uint8Array(readFileSync(`${dir}/RULES.TXT`)))).leaders
  : [];

describe.skipIf(!rules)('the map maker', () => {
  it('fills a normal world with the land share the settings ask for', () => {
    if (!rules) return;
    for (const [landMass, lo, hi] of [
      [0, 0.12, 0.45],
      [1, 0.2, 0.55],
      [2, 0.28, 0.65],
    ] as const) {
      const w = generateMap(
        {
          columns: 50,
          rows: 80,
          flatEarth: false,
          landMass,
          landForm: 0,
          climate: 0,
          temperature: 0,
          age: 1,
        },
        rules,
        new Rng(7 + landMass),
      );
      let land = 0;
      for (let i = 0; i < w.area; i++) if ((w.terrain[i] ?? OCEAN) !== OCEAN) land += 1;
      const share = land / w.area;
      expect(share).toBeGreaterThan(lo);
      expect(share).toBeLessThan(hi);
      // Polar rows are glacier with tundra sprinkled in on a round world.
      for (let x = 0; x < w.widthX2; x += 2) expect([6, 7]).toContain(w.terrainAt(x, 0));
      const ids = new Set<number>();
      for (let i = 0; i < w.area; i++)
        if ((w.terrain[i] ?? OCEAN) !== OCEAN) ids.add((w.landmass[i] ?? 0) & 63);
      expect(ids.size).toBeGreaterThan(1);
    }
  });

  it('a wet warm old world has more grassland and jungle than an arid cool young one', () => {
    if (!rules) return;
    const count = (w: ReturnType<typeof generateMap>, t: number) => {
      let n = 0;
      for (let i = 0; i < w.area; i++) if (w.terrain[i] === t) n += 1;
      return n;
    };
    const wet = generateMap(
      {
        columns: 50,
        rows: 80,
        flatEarth: false,
        landMass: 1,
        landForm: 0,
        climate: 1,
        temperature: 1,
        age: 2,
      },
      rules,
      new Rng(3),
    );
    const dry = generateMap(
      {
        columns: 50,
        rows: 80,
        flatEarth: false,
        landMass: 1,
        landForm: 0,
        climate: -1,
        temperature: -1,
        age: 0,
      },
      rules,
      new Rng(3),
    );
    expect(count(wet, 2) + count(wet, 9)).toBeGreaterThan(count(dry, 2) + count(dry, 9));
    expect(count(dry, 0) + count(dry, 6)).toBeGreaterThan(count(wet, 0) + count(wet, 6));
  });
});

describe.skipIf(!rules)('a new game', () => {
  it('seats the civilizations with a Settlers each on land, apart from one another', () => {
    if (!rules) return;
    const { world, state, humanSlot, notes } = newGame(rules, new Rng(11), {
      map: {
        columns: 50,
        rows: 80,
        flatEarth: false,
        landMass: 1,
        landForm: 0,
        climate: 0,
        temperature: 0,
        age: 1,
      },
      difficulty: 2,
      civCount: 7,
      humanTribe: 0,
      leaders,
      barbarianActivity: 1,
    });
    expect(state.turn).toBe(0);
    const playing = world.civs.filter((c) => c.inPlay);
    expect(playing.length).toBeGreaterThanOrEqual(5);
    const human = world.civs.find((c) => c.isHuman);
    expect(human?.slot).toBe(humanSlot);
    expect(human?.tribe).toBe(0);
    expect(human?.scienceRate).toBe(6);
    for (const c of playing) {
      const units = world.units.filter((u) => u.owner === c.slot);
      expect(units.length).toBeGreaterThanOrEqual(1);
      const u = units[0];
      if (!u) continue;
      expect(world.terrainAt(u.position.x, u.position.y)).not.toBe(OCEAN);
      expect(u.type).toBe(0);
      expect(world.isSeen(u.position.x, u.position.y, c.slot)).toBe(true);
      for (const d of playing) {
        if (d === c) continue;
        const v = world.units.find((x) => x.owner === d.slot);
        if (v)
          expect(
            Math.max(Math.abs(u.position.x - v.position.x), Math.abs(u.position.y - v.position.y)),
          ).toBeGreaterThan(3);
      }
      expect(c.attitudes?.[c.slot]).toBe(100);
      expect(c.name.length).toBeGreaterThan(0);
    }
    expect(Array.isArray(notes)).toBe(true);
  });
});
