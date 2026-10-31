import { describe, expect, it } from 'vitest';
import { applyCombat, attackStrength, defenceStrength, resolveCombat } from '../src/combat.js';
import { blockedByZoc, checkMove, partialMoveChance, stepCost } from '../src/movement.js';
import { Rng } from '../src/rng.js';
import type { EngineRules } from '../src/rules.js';
import { SquareFlag, World, type Unit } from '../src/world.js';

const flags = (over: Partial<EngineRules['units'][number]['flags']> = {}) => ({
  ignoreZonesOfControl: false,
  alpine: false,
  mustStayNearLand: false,
  negatesCityWalls: false,
  doubleDefenceVsHorse: false,
  doubleDefenceVsAir: false,
  submarine: false,
  canAttackAir: false,
  destroyedAfterAttack: false,
  ...over,
});

/** Tiny rule set: terrain 0 grassland, 1 hills; units 0 warriors, 1 knights, 2 pikemen, 3 trireme, 4 fighter, 5 explorer. */
const rules: EngineRules = {
  cosmic: { roadMoveMultiplier: 3 },
  terrain: [
    { moveCost: 1, defenceHalves: 2 },
    { moveCost: 2, defenceHalves: 4 },
    { moveCost: 1, defenceHalves: 2 },
    { moveCost: 1, defenceHalves: 2 },
    { moveCost: 1, defenceHalves: 2 },
    { moveCost: 1, defenceHalves: 2 },
    { moveCost: 1, defenceHalves: 2 },
    { moveCost: 1, defenceHalves: 2 },
    { moveCost: 1, defenceHalves: 2 },
    { moveCost: 1, defenceHalves: 2 },
    { moveCost: 1, defenceHalves: 2 },
  ],
  units: [
    {
      name: 'Warriors',
      domain: 0,
      move: 1,
      attack: 1,
      defence: 1,
      hitPointsTens: 1,
      firepower: 1,
      flags: flags(),
    },
    {
      name: 'Knights',
      domain: 0,
      move: 2,
      attack: 4,
      defence: 2,
      hitPointsTens: 1,
      firepower: 1,
      flags: flags(),
    },
    {
      name: 'Pikemen',
      domain: 0,
      move: 1,
      attack: 1,
      defence: 2,
      hitPointsTens: 1,
      firepower: 1,
      flags: flags({ doubleDefenceVsHorse: true }),
    },
    {
      name: 'Trireme',
      domain: 2,
      move: 3,
      attack: 1,
      defence: 1,
      hitPointsTens: 1,
      firepower: 1,
      flags: flags({ mustStayNearLand: true }),
    },
    {
      name: 'Fighter',
      domain: 1,
      move: 10,
      attack: 4,
      defence: 4,
      hitPointsTens: 2,
      firepower: 2,
      flags: flags({ canAttackAir: true }),
    },
    {
      name: 'Explorer',
      domain: 0,
      move: 1,
      attack: 0,
      defence: 1,
      hitPointsTens: 1,
      firepower: 1,
      flags: flags({ ignoreZonesOfControl: true, alpine: true }),
    },
  ],
};

function world(): World {
  const w = new World({ columns: 5, rows: 6, flatEarth: true });
  w.terrain.fill(0); // all grassland
  w.terrain[w.index(4, 2)] = 1; // hills
  w.terrain[w.index(6, 4)] = 10; // one ocean square
  return w;
}

function unit(
  id: number,
  type: number,
  x: number,
  y: number,
  owner = 1,
  over: Partial<Unit> = {},
): Unit {
  return {
    id,
    position: { x, y },
    owner,
    type,
    veteran: false,
    hitPointsLost: 0,
    movesSpent: 0,
    fortified: false,
    homeCity: null,
    ...over,
  };
}

describe('movement', () => {
  const w = world();
  const warriors = unit(0, 0, 2, 2);

  it('charges terrain cost in thirds', () => {
    expect(stepCost(w, rules, warriors, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(3); // grassland
    expect(stepCost(w, rules, warriors, { x: 2, y: 2 }, { x: 4, y: 2 })).toBe(6); // hills
  });

  it('makes roads, railroads and rivers cheap when both squares have them', () => {
    w.setFlag(2, 2, SquareFlag.Road);
    w.setFlag(3, 3, SquareFlag.Road);
    expect(stepCost(w, rules, warriors, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(1);
    w.setFlag(2, 2, SquareFlag.Railroad);
    w.setFlag(3, 3, SquareFlag.Railroad);
    expect(stepCost(w, rules, warriors, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(0);
    w.setFlag(4, 2, SquareFlag.River);
    w.setFlag(2, 2, SquareFlag.River);
    expect(stepCost(w, rules, warriors, { x: 2, y: 2 }, { x: 4, y: 2 })).toBe(1);
  });

  it('treats domains correctly', () => {
    const trireme = unit(1, 3, 6, 4);
    expect(stepCost(w, rules, trireme, { x: 6, y: 4 }, { x: 7, y: 5 })).toBeNull(); // land
    expect(stepCost(w, rules, warriors, { x: 5, y: 3 }, { x: 6, y: 4 })).toBeNull(); // ocean
    const fighter = unit(2, 4, 2, 2);
    expect(stepCost(w, rules, fighter, { x: 2, y: 2 }, { x: 4, y: 2 })).toBe(3); // hills, still 1 move
    const explorer = unit(3, 5, 2, 0);
    expect(stepCost(w, rules, explorer, { x: 2, y: 0 }, { x: 4, y: 0 })).toBe(1); // alpine
  });

  it('applies zones of control', () => {
    const z = world();
    const mine = unit(0, 0, 2, 2, 1);
    z.units.push(mine, unit(9, 0, 4, 2, 2)); // enemy at (4,2): adjacent to (2,2)? no — (4,2) is E of (2,2)
    // (3,1) and (3,3) are both adjacent to the enemy at (4,2) and to (2,2)
    expect(blockedByZoc(z, rules, mine, { x: 3, y: 1 }, { x: 3, y: 3 })).toBe(true);
    expect(blockedByZoc(z, rules, mine, { x: 3, y: 1 }, { x: 2, y: 0 })).toBe(false); // (2,0) not adjacent to enemy
    z.units.push(unit(5, 0, 3, 3, 1)); // friend at destination lifts the block
    expect(blockedByZoc(z, rules, mine, { x: 3, y: 1 }, { x: 3, y: 3 })).toBe(false);
    const explorer = unit(6, 5, 3, 1, 1);
    expect(blockedByZoc(z, rules, explorer, { x: 3, y: 1 }, { x: 3, y: 3 })).toBe(false);
  });

  it('checks a move end to end', () => {
    const c = world();
    const u = unit(0, 0, 2, 2);
    expect(checkMove(c, rules, u, { x: 3, y: 3 })).toEqual({ ok: true, cost: 3, partial: false });
    expect(checkMove(c, rules, u, { x: 4, y: 2 })).toEqual({ ok: true, cost: 6, partial: true });
    expect(checkMove(c, rules, u, { x: 6, y: 2 })).toEqual({ ok: false, reason: 'not-adjacent' });
    u.movesSpent = 3;
    expect(checkMove(c, rules, u, { x: 3, y: 3 })).toEqual({ ok: false, reason: 'no-moves' });
    expect(partialMoveChance(6, 3)).toBeCloseTo(0.5);
    expect(partialMoveChance(3, 3)).toBe(1);
  });
});

describe('combat', () => {
  const w = world();

  it('builds strength breakdowns with the documented modifiers', () => {
    const knights = unit(0, 1, 2, 2, 1, { veteran: true });
    const pikemen = unit(1, 2, 4, 2, 2, { fortified: true }); // on hills
    w.setFlag(4, 2, SquareFlag.River);
    const a = attackStrength(rules, knights);
    expect(a.value).toBe(6); // 4 × 1.5
    const d = defenceStrength(w, rules, pikemen, knights);
    // 2 × hills 2.0 × river 1.5 × fortified 1.5 × pikemen-vs-horse 2
    expect(d.value).toBeCloseTo(2 * 2 * 1.5 * 1.5 * 2);
    expect(d.modifiers.map((m) => m.label)).toEqual([
      'terrain',
      'river',
      'fortified',
      'pikemen vs horse',
    ]);
  });

  it('walls triple defence against ground attackers only', () => {
    const c = world();
    c.cities.push({
      id: 0,
      position: { x: 2, y: 2 },
      owner: 2,
      name: 'Wall',
      size: 3,
      improvements: [],
      foodStored: 0,
      shieldsStored: 0,
      inDisorder: false,
    });
    const defender = unit(1, 0, 2, 2, 2);
    const knights = unit(0, 1, 3, 3, 1);
    const fighter = unit(2, 4, 3, 3, 1);
    const ctx = { cityWalls: true, coastalFortress: false, samBattery: false };
    expect(defenceStrength(c, rules, defender, knights, ctx).value).toBeCloseTo(1 * 1.5 * 3); // in city, walls
    expect(defenceStrength(c, rules, defender, fighter, ctx).value).toBeCloseTo(1 * 1.5); // walls do not apply
  });

  it('fights deterministic battles to the death and writes the result back', () => {
    const knights = unit(0, 1, 2, 2, 1);
    const warriors = unit(1, 0, 3, 3, 2);
    const result = resolveCombat(w, rules, new Rng(42), knights, warriors);
    expect(result.rounds.length).toBeGreaterThan(0);
    const last = result.rounds[result.rounds.length - 1];
    expect(last?.attackerHp === 0 || last?.defenderHp === 0).toBe(true);
    applyCombat(rules, result, knights, warriors);
    if (result.attackerWon) {
      expect(warriors.hitPointsLost).toBe(10);
      expect(knights.hitPointsLost).toBe(10 - result.survivorHp);
    } else {
      expect(knights.hitPointsLost).toBe(10);
    }
    // Same seed, same battle.
    const again = resolveCombat(w, rules, new Rng(42), unit(0, 1, 2, 2, 1), unit(1, 0, 3, 3, 2));
    expect(again.rounds).toEqual(result.rounds);
  });

  it('strong attackers win most of the time', () => {
    let wins = 0;
    const rng = new Rng(7);
    for (let i = 0; i < 200; i++) {
      const r = resolveCombat(w, rules, rng, unit(0, 1, 2, 2, 1), unit(1, 0, 3, 3, 2)); // 4 vs 1
      if (r.attackerWon) wins++;
    }
    expect(wins).toBeGreaterThan(190);
  });
});
