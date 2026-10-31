import { describe, expect, it } from 'vitest';
import { combatOdds } from '../src/combat.js';
import type { EngineRules } from '../src/rules.js';
import { World, type Unit } from '../src/world.js';

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
const rules = {
  cosmic: { roadMoveMultiplier: 3 },
  terrain: Array.from({ length: 11 }, () => ({ moveCost: 1, defenceHalves: 2 })),
  units: [
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
      role: 1,
      flags: flags(),
    },
    {
      name: 'Legion',
      domain: 0,
      move: 1,
      range: 0,
      attack: 4,
      defence: 2,
      hitPointsTens: 1,
      firepower: 1,
      costRows: 4,
      role: 0,
      flags: flags(),
    },
  ],
  improvements: Array.from({ length: 67 }, (_, i) => ({ name: `i${i}`, costRows: 4, upkeep: 1 })),
} as unknown as EngineRules;

function mk(type: number, x: number, owner: number): Unit {
  return {
    id: x,
    position: { x, y: 2 },
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
}

describe('combat odds (the evaluator)', () => {
  it('even strengths score about 8 and a crippled defender raises the odds', () => {
    const w = new World({ columns: 20, rows: 30, flatEarth: true });
    w.terrain.fill(2);
    const a = mk(0, 2, 1);
    const d = mk(0, 4, 2);
    w.units.push(a, d);
    const even = combatOdds(w, rules, a, d, { defenderFortified: false, realisticCombat: false });
    expect(even).toBeGreaterThanOrEqual(7);
    expect(even).toBeLessThanOrEqual(8);
    const weighted = combatOdds(w, rules, a, d, {
      defenderFortified: false,
      realisticCombat: true,
    });
    expect(weighted).toBeGreaterThanOrEqual(7);
    expect(weighted).toBeLessThanOrEqual(8);
    d.hitPointsLost = 9;
    expect(
      combatOdds(w, rules, a, d, { defenderFortified: false, realisticCombat: true }),
    ).toBeGreaterThan(weighted);
  });

  it('attack 4 against defence 1 scores 8 × 32 / 9 = 28 and the cap is 1024', () => {
    const w = new World({ columns: 20, rows: 30, flatEarth: true });
    w.terrain.fill(2);
    const legion = mk(1, 2, 1);
    const warriors = mk(0, 4, 2);
    w.units.push(legion, warriors);
    const odds = combatOdds(w, rules, legion, warriors, {
      defenderFortified: false,
      realisticCombat: false,
    });
    expect(odds).toBe(28);
    warriors.hitPointsLost = 10; // no hit points left: the weighted defence collapses
    expect(
      combatOdds(w, rules, legion, warriors, { defenderFortified: false, realisticCombat: true }),
    ).toBeLessThanOrEqual(1024);
  });
});
