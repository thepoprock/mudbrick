import { describe, expect, it } from 'vitest';
import {
  applyCombat,
  attackStrength,
  defenceStrength,
  resolveCombat,
  type CombatContext,
} from '../src/combat.js';
import {
  blockedByZoc,
  checkMove,
  fullMoves,
  inEnemyZoc,
  partialMoveChance,
  stepCost,
} from '../src/movement.js';
import { chooseDefender } from '../src/defender.js';
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
  freeSupportUnderFundamentalism: false,
  ...over,
});

type U = EngineRules['units'][number];
const unitType = (name: string, over: Partial<U>): U => ({
  name,
  domain: 0,
  move: 1,
  range: 0,
  attack: 1,
  defence: 1,
  hitPointsTens: 1,
  firepower: 1,
  costRows: 1,
  role: 0,
  flags: flags(),
  ...over,
});

/** Tiny rule set. Terrain 0 grassland (2), 1 hills (4); the rest grassland; 10 ocean. */
const special = { food: 0, shields: 0, trade: 0 };
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
  terrain: Array.from({ length: 11 }, (_, i) => ({
    moveCost: i === 1 ? 2 : 1,
    defenceHalves: i === 1 ? 4 : 2,
    food: 1,
    shields: 0,
    trade: 0,
    irrigateBonus: 1,
    mineBonus: 0,
    specials: [special, special] as [typeof special, typeof special],
  })),
  improvements: Array.from({ length: 67 }, (_, i) => ({
    name: `improvement ${i}`,
    costRows: 1,
    upkeep: 0,
  })),
  units: [
    unitType('Warriors', {}),
    unitType('Knights', { move: 2, attack: 4, defence: 2 }),
    unitType('Pikemen', { defence: 2, flags: flags({ doubleDefenceVsHorse: true }) }),
    unitType('Trireme', { domain: 2, move: 3, flags: flags({ mustStayNearLand: true }) }),
    unitType('Fighter', {
      domain: 1,
      move: 10,
      range: 1,
      attack: 4,
      defence: 4,
      hitPointsTens: 2,
      firepower: 2,
      role: 3,
      flags: flags({ canAttackAir: true }),
    }),
    unitType('Explorer', { attack: 0, flags: flags({ ignoreZonesOfControl: true, alpine: true }) }),
    unitType('Armor', { move: 3, attack: 10, defence: 5, hitPointsTens: 3 }),
    unitType('Bomber', {
      domain: 1,
      move: 8,
      range: 2,
      attack: 12,
      defence: 1,
      hitPointsTens: 2,
      firepower: 2,
    }),
  ],
};

function world(): World {
  const w = new World({ columns: 5, rows: 6, flatEarth: true });
  w.terrain.fill(0);
  w.terrain[w.index(4, 2)] = 1; // hills
  w.terrain[w.index(6, 4)] = 10; // ocean
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
    expect(stepCost(w, rules, warriors, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(3);
    // Warriors have one MP, so hills cost them one MP; Armor pays the full two.
    expect(stepCost(w, rules, warriors, { x: 2, y: 2 }, { x: 4, y: 2 })).toBe(3);
    expect(stepCost(w, rules, unit(7, 6, 2, 2), { x: 2, y: 2 }, { x: 4, y: 2 })).toBe(6);
  });

  it('makes roads, railroads and rivers cheap when both squares have them', () => {
    w.setFlag(2, 2, SquareFlag.Road);
    w.setFlag(3, 3, SquareFlag.Road);
    expect(stepCost(w, rules, warriors, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(1);
    w.setFlag(2, 2, SquareFlag.Railroad);
    w.setFlag(3, 3, SquareFlag.Railroad);
    expect(stepCost(w, rules, warriors, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(0);
    w.setFlag(3, 1, SquareFlag.River);
    w.setFlag(2, 2, SquareFlag.River);
    expect(stepCost(w, rules, warriors, { x: 2, y: 2 }, { x: 3, y: 1 })).toBe(1); // along a river, diagonal step
  });

  it('treats domains correctly', () => {
    expect(stepCost(w, rules, unit(1, 3, 6, 4), { x: 6, y: 4 }, { x: 7, y: 5 })).toBeNull();
    expect(stepCost(w, rules, warriors, { x: 5, y: 3 }, { x: 6, y: 4 })).toBeNull();
    expect(stepCost(w, rules, unit(2, 4, 2, 2), { x: 2, y: 2 }, { x: 4, y: 2 })).toBe(3);
    expect(stepCost(w, rules, unit(3, 5, 2, 0), { x: 2, y: 0 }, { x: 4, y: 0 })).toBe(1);
  });

  it('applies zones of control', () => {
    const z = world();
    const mine = unit(0, 0, 2, 2, 1);
    z.units.push(mine, unit(9, 0, 4, 2, 2));
    expect(blockedByZoc(z, rules, mine, { x: 3, y: 1 }, { x: 3, y: 3 })).toBe(true);
    expect(blockedByZoc(z, rules, mine, { x: 3, y: 1 }, { x: 2, y: 0 })).toBe(false);
    z.units.push(unit(5, 0, 3, 3, 1));
    expect(blockedByZoc(z, rules, mine, { x: 3, y: 1 }, { x: 3, y: 3 })).toBe(false);
    expect(blockedByZoc(z, rules, unit(6, 5, 3, 1, 1), { x: 3, y: 1 }, { x: 3, y: 3 })).toBe(false);
  });

  it('computes the verified movement allowance', () => {
    const trireme = unit(1, 3, 6, 4);
    expect(fullMoves(rules, trireme)).toBe(9);
    expect(
      fullMoves(rules, trireme, { nuclearPower: true, magellans: true, lighthouse: true }),
    ).toBe(9 + 3 + 6); // no Lighthouse for triremes
    const armor = unit(2, 6, 2, 2, 1, { hitPointsLost: 20 }); // 10 of 30 HP left, move 3
    expect(fullMoves(rules, armor)).toBe(9); // simplified combat: no slowdown
    expect(fullMoves(rules, armor, { damageSlowsUnits: true })).toBe(3); // 9 × 10/30 = 3
    const badlyHurt = unit(3, 6, 2, 2, 1, { hitPointsLost: 29 });
    expect(fullMoves(rules, badlyHurt, { damageSlowsUnits: true })).toBe(3); // minimum one MP
    const hurtShip = unit(4, 3, 6, 4, 1, { hitPointsLost: 9 });
    expect(fullMoves(rules, hurtShip, { damageSlowsUnits: true })).toBe(6); // minimum two MP at sea
  });

  it('caps terrain cost for one-move units and limits river moves to edge-neighbours', () => {
    const c = world();
    expect(stepCost(c, rules, unit(0, 0, 2, 2), { x: 2, y: 2 }, { x: 4, y: 2 })).toBe(3); // warriors onto hills: one MP
    const armor = unit(1, 6, 2, 2);
    expect(stepCost(c, rules, armor, { x: 2, y: 2 }, { x: 4, y: 2 })).toBe(6); // armor pays the real hills cost
    c.setFlag(2, 2, SquareFlag.River);
    c.setFlag(4, 2, SquareFlag.River); // east neighbour (not an edge-neighbour)
    c.setFlag(3, 3, SquareFlag.River); // south-east edge-neighbour
    expect(stepCost(c, rules, armor, { x: 2, y: 2 }, { x: 4, y: 2 })).toBe(6);
    expect(stepCost(c, rules, armor, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(1);
  });

  it('zones of control ignore allies, cities and squares of the other kind', () => {
    const z = world();
    z.units.push(unit(9, 0, 4, 2, 2)); // enemy ground unit
    expect(inEnemyZoc(z, 3, 1, 1)).toBe(true);
    expect(
      inEnemyZoc(z, 3, 1, 1, { isAllied: (a, b) => (a === 2 && b === 1) || (a === 1 && b === 2) }),
    ).toBe(false);
    z.cities.push({
      id: 0,
      position: { x: 3, y: 1 },
      owner: 1,
      name: 'Fort',
      size: 1,
      improvements: [],
      foodStored: 0,
      shieldsStored: 0,
      inDisorder: false,
      celebrating: false,
      worked: 1 << 20,
      specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
      production: { kind: 'unit', index: 0 },
      tradeRoutes: [],
    });
    expect(inEnemyZoc(z, 3, 1, 1)).toBe(false); // city squares are never in a zone of control
    const sea = world();
    sea.terrain[sea.index(6, 4)] = 10;
    sea.units.push(unit(8, 3, 6, 4, 2)); // enemy trireme at sea
    expect(inEnemyZoc(sea, 5, 3, 1)).toBe(false); // land square next to a ship: different kind
  });

  it('checks a move end to end', () => {
    const c = world();
    const u = unit(0, 0, 2, 2);
    expect(checkMove(c, rules, u, { x: 3, y: 3 })).toEqual({ ok: true, cost: 3, partial: false });
    expect(checkMove(c, rules, u, { x: 4, y: 2 })).toEqual({ ok: true, cost: 3, partial: false });
    const armor = unit(1, 6, 2, 2, 1, { movesSpent: 6 }); // one MP left, hills cost two
    expect(checkMove(c, rules, armor, { x: 4, y: 2 })).toEqual({
      ok: true,
      cost: 6,
      partial: true,
    });
    expect(checkMove(c, rules, u, { x: 6, y: 2 })).toEqual({ ok: false, reason: 'not-adjacent' });
    u.movesSpent = 3;
    expect(checkMove(c, rules, u, { x: 3, y: 3 })).toEqual({ ok: false, reason: 'no-moves' });
    expect(partialMoveChance(6, 3)).toBeCloseTo(0.5);
    expect(partialMoveChance(3, 3)).toBe(1);
  });
});

describe('best defender (verified)', () => {
  it('prefers the strongest scorer, skips passengers, and applies the tie-breakers', () => {
    const c = world();
    const knights = unit(0, 1, 2, 2, 1);
    const warriors = unit(1, 0, 3, 3, 2);
    const pikemen = unit(2, 2, 3, 3, 2);
    expect(
      chooseDefender(c, rules, [warriors, pikemen], knights, { defenderFortified: false })?.id,
    ).toBe(2);
    const hurtPikemen = unit(3, 2, 3, 3, 2, { hitPointsLost: 9 });
    expect(
      chooseDefender(c, rules, [warriors, hurtPikemen], knights, { defenderFortified: false })?.id,
    ).toBe(3); // simplified combat: damage ignored
    expect(
      chooseDefender(c, rules, [warriors, hurtPikemen], knights, {
        defenderFortified: false,
        damageMatters: true,
      })?.id,
    ).toBe(1);
    const atSea = world();
    atSea.terrain[atSea.index(6, 4)] = 10;
    const passenger = unit(4, 6, 6, 4, 2); // armor aboard
    const trireme = unit(5, 3, 6, 4, 2);
    expect(
      chooseDefender(atSea, rules, [passenger, trireme], unit(6, 7, 5, 3, 1), {
        defenderFortified: false,
      })?.id,
    ).toBe(5);
  });
});

describe('combat (verified formulas)', () => {
  const w = world();
  const noCity: CombatContext = { defenderFortified: false };

  it('attack is attack×8 with integer ×1.5 for veterans and no damage scaling', () => {
    expect(attackStrength(rules, unit(0, 1, 2, 2)).value).toBe(32);
    expect(attackStrength(rules, unit(0, 1, 2, 2, 1, { veteran: true })).value).toBe(48);
    expect(attackStrength(rules, unit(0, 1, 2, 2, 1, { hitPointsLost: 9 })).value).toBe(32);
    expect(attackStrength(rules, unit(0, 0, 2, 2, 1, { veteran: true })).value).toBe(12); // 8 + 4
  });

  it('defence adds the river to the terrain halves and applies one position multiplier', () => {
    const pikemen = unit(1, 2, 4, 2, 2); // hills: halves 4
    const knights = unit(0, 1, 2, 2, 1);
    expect(defenceStrength(w, rules, pikemen, knights, noCity).value).toBe(2 * 4 * 4); // 32
    w.setFlag(4, 2, SquareFlag.River);
    expect(defenceStrength(w, rules, pikemen, knights, noCity).value).toBe(2 * 5 * 4); // 40
    const fortified = defenceStrength(w, rules, pikemen, knights, { defenderFortified: true });
    expect(fortified.value).toBe((40 * 3) >> 1); // 60
    w.setFlag(4, 2, SquareFlag.Fortress);
    const fortress = defenceStrength(w, rules, pikemen, knights, { defenderFortified: true });
    expect(fortress.value).toBe(80); // fortress ×2 wins over fortified
    expect(fortress.modifiers.map((m) => m.label)).toContain('fortress');
    const bomber = unit(2, 7, 2, 2, 1);
    expect(defenceStrength(w, rules, pikemen, bomber, { defenderFortified: true }).value).toBe(60); // fortress does not apply vs air
  });

  it('city walls triple ground defence against ground attackers only; fighters in cities', () => {
    const c = world();
    const walls = Array<boolean>(70).fill(false);
    walls[8] = true;
    const defender = unit(1, 0, 2, 2, 2);
    const knights = unit(0, 1, 3, 3, 1);
    const bomber = unit(2, 7, 3, 3, 1);
    expect(
      defenceStrength(c, rules, defender, knights, {
        defenderFortified: false,
        defenderCity: walls,
      }).value,
    ).toBe((8 * 6) >> 1); // 24
    expect(
      defenceStrength(c, rules, defender, bomber, { defenderFortified: false, defenderCity: walls })
        .value,
    ).toBe(8);
    const fighter = unit(3, 4, 2, 2, 2);
    expect(
      defenceStrength(c, rules, fighter, bomber, { defenderFortified: false, defenderCity: walls })
        .value,
    ).toBe((4 * 8 * 8) >> 1); // ×4 vs bomber
    const enemyFighter = unit(4, 4, 3, 3, 1);
    expect(
      defenceStrength(c, rules, fighter, enemyFighter, {
        defenderFortified: false,
        defenderCity: walls,
      }).value,
    ).toBe((4 * 8 * 4) >> 1); // ×2 vs fighter
  });

  it('applies the handler adjustments: pikemen +50 %, partial move, shore bombardment', () => {
    const c = world();
    const knights = unit(0, 1, 2, 2, 1); // move 2, 10 HP
    const pikemen = unit(1, 2, 3, 3, 2);
    const r = resolveCombat(c, rules, new Rng(1), knights, pikemen, noCity);
    expect(r.defence.value).toBe(16 + 8); // 2×2×4 = 16, +50 %
    expect(r.defence.modifiers.map((m) => m.label)).toContain('pikemen vs horse');
    const tired = unit(0, 1, 2, 2, 1, { movesSpent: 5 }); // one third left
    expect(resolveCombat(c, rules, new Rng(1), tired, pikemen, noCity).attack.value).toBe(
      Math.floor((32 * 1) / 3),
    );
    const trireme = unit(5, 3, 6, 4, 1);
    const shore = resolveCombat(c, rules, new Rng(1), trireme, unit(6, 6, 5, 5, 2), noCity); // sea vs armor on land
    expect(shore.attackerFirepower).toBe(1);
    expect(shore.defenderFirepower).toBe(1);
  });

  it('runs rounds by comparing two draws and deals firepower damage', () => {
    const c = world();
    const armor = unit(0, 6, 2, 2, 1); // 30 HP, fp 1
    const warriors = unit(1, 0, 3, 3, 2); // 10 HP
    const result = resolveCombat(c, rules, new Rng(42), armor, warriors, noCity);
    expect(result.attackerWon).toBe(true);
    const winsForAttacker = result.rounds.filter((r) => r.attackerWon).length;
    expect(winsForAttacker).toBe(10); // exactly ten hits of firepower 1 to kill 10 HP
    expect(result.survivorHp).toBe(30 - (result.rounds.length - 10));
    applyCombat(rules, result, armor, warriors);
    expect(warriors.hitPointsLost).toBe(10);
    expect(armor.hitPointsLost).toBe(result.rounds.length - 10);
    expect(
      resolveCombat(c, rules, new Rng(42), unit(0, 6, 2, 2, 1), unit(1, 0, 3, 3, 2), noCity).rounds,
    ).toEqual(result.rounds);
  });

  it('gives barbarians the documented handicaps', () => {
    const c = world();
    const barbarianKnights = unit(0, 1, 2, 2, 0);
    const defender = unit(1, 0, 3, 3, 1);
    const vsAi = resolveCombat(c, rules, new Rng(3), barbarianKnights, defender, {
      defenderFortified: false,
      defenderIsHuman: false,
      defenderCityCount: 10,
    });
    expect(vsAi.attack.value).toBe(16); // 32 / 2
    const vsHuman = resolveCombat(c, rules, new Rng(3), unit(0, 1, 2, 2, 0), unit(1, 0, 3, 3, 1), {
      defenderFortified: false,
      defenderIsHuman: true,
      difficulty: 3,
      defenderCityCount: 10,
    });
    expect(vsHuman.attack.value).toBe(32); // ×(3+1)/4
    const lastCity = resolveCombat(c, rules, new Rng(3), unit(0, 1, 2, 2, 0), unit(1, 0, 3, 3, 1), {
      defenderFortified: false,
      defenderIsHuman: true,
      difficulty: 3,
      defenderCityCount: 1,
    });
    expect(lastCity.attack.value).toBe(0);
    expect(lastCity.attackerWon).toBe(false);
  });

  it('promotes survivors with the verified odds and always with Sun Tzu', () => {
    const c = world();
    const sunTzu = Array<boolean>(70).fill(false);
    sunTzu[46] = true;
    const r = resolveCombat(c, rules, new Rng(9), unit(0, 6, 2, 2, 1), unit(1, 0, 3, 3, 2), {
      defenderFortified: false,
      attackerWonders: sunTzu,
    });
    expect(r.attackerWon).toBe(true);
    expect(r.promoted).toBe(true);
    let promotions = 0;
    const rng = new Rng(11);
    for (let i = 0; i < 300; i++) {
      const x = resolveCombat(c, rules, rng, unit(0, 1, 2, 2, 1), unit(1, 0, 3, 3, 2), noCity); // A 32 vs D 8
      if (x.attackerWon && x.promoted) promotions++;
    }
    // chance ≈ (D + 1) / (A + D) = 9/40 per win
    expect(promotions).toBeGreaterThan(30);
    expect(promotions).toBeLessThan(110);
  });
});
