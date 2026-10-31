import { describe, expect, it } from 'vitest';
import { resolveAttack } from '../src/attack.js';
import { captureCity, plunder } from '../src/conquest.js';
import { Rng } from '../src/rng.js';
import { GOVERNMENT, IMPROVEMENT, type EngineRules } from '../src/rules.js';
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
  },
  terrain: Array.from({ length: 11 }, () => ({
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
    ] as [
      { food: number; shields: number; trade: number },
      { food: number; shields: number; trade: number },
    ],
    irrigate: { kind: 'yes' as const },
    irrigateTurns: 5,
    mine: { kind: 'no' as const },
    mineTurns: 10,
    transformTo: { kind: 'no' as const },
  })),
  units: Array.from({ length: 12 }, (_, i) => unitType(`u${i}`)),
  advances: Array.from({ length: 100 }, (_, i) => ({
    name: `adv${i}`,
    preq1: { kind: 'none' as const },
    preq2: { kind: 'none' as const },
    epoch: 0,
    category: 0,
    aiValue: i === 7 ? 9 : 3,
  })),
  improvements: Array.from({ length: 67 }, (_, i) => ({ name: `i${i}`, costRows: 4, upkeep: 1 })),
};
rules.units[2] = unitType('Warriors', { role: 1, costRows: 1 });
rules.units[3] = unitType('Legion', { attack: 4, defence: 2, costRows: 4 });
rules.units[9] = unitType('Partisans', { attack: 4, defence: 4, role: 1 });
rules.units[10] = unitType('Missile', {
  domain: 1,
  move: 12,
  attack: 18,
  defence: 0,
  hitPointsTens: 1,
  firepower: 3,
  flags: flags({ destroyedAfterAttack: true }),
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
function civ(slot: number, over: Partial<Civ> = {}): Civ {
  return {
    slot,
    tribe: 0,
    name: `Civ ${slot}`,
    adjective: `C${slot}`,
    leader: 'L',
    cityStyle: 0,
    epoch: 0,
    colour: slot,
    government: GOVERNMENT.monarchy,
    treasury: 300,
    isHuman: slot === 1,
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
function city(
  world: World,
  x: number,
  y: number,
  owner: number,
  size = 4,
  imps: number[] = [],
): City {
  const improvements = Array<boolean>(67).fill(false);
  for (const i of imps) improvements[i] = true;
  const c: City = {
    id: world.cities.length,
    position: { x, y },
    owner,
    name: `City${world.cities.length}`,
    size,
    improvements,
    foodStored: 0,
    shieldsStored: 15,
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
function land(): World {
  const w = new World({ columns: 20, rows: 30, flatEarth: true });
  w.terrain.fill(2);
  w.civs.push(civ(0, { isHuman: false }), civ(1), civ(2, { isHuman: false }));
  return w;
}
const attackCtx = (w: World, attacker: Unit, over: Record<string, unknown> = {}) => ({
  civ: (slot: number) => w.civs.find((c) => c.slot === slot),
  wondersOf: () => Array<boolean>(67).fill(false),
  cityCount: (slot: number) => w.cities.filter((c) => c.owner === slot).length,
  difficulty: 2,
  realisticCombat: true,
  barbarianActivity: 2,
  attackerMovesLeft: 3,
  ...over,
});

describe('attack aftermath (verified)', () => {
  it('kills the whole stack in the open but not in a fortress, and spends a full move', () => {
    const w = land();
    const legion = unit(w, 3, 10, 10);
    unit(w, 2, 11, 11, { owner: 2 });
    unit(w, 2, 11, 11, { owner: 2 });
    // Legion 4 vs Warriors 1: run until the legion wins.
    let ev;
    for (let seed = 1; seed < 50; seed++) {
      const w2 = land();
      const l = unit(w2, 3, 10, 10);
      unit(w2, 2, 11, 11, { owner: 2 });
      unit(w2, 2, 11, 11, { owner: 2 });
      ev = resolveAttack(w2, rules, new Rng(seed), l, { x: 11, y: 11 }, attackCtx(w2, l));
      if (ev.kind === 'fought' && ev.attackerWon) {
        expect(ev.stackLost).toHaveLength(1);
        expect(w2.unitsAt(11, 11)).toHaveLength(0);
        expect(l.movesSpent).toBe(3);
        break;
      }
    }
    expect(ev?.kind).toBe('fought');
    w.setFlag(11, 11, SquareFlag.Fortress);
    for (let seed = 1; seed < 50; seed++) {
      const r = resolveAttack(
        w,
        rules,
        new Rng(seed),
        legion,
        { x: 11, y: 11 },
        attackCtx(w, legion),
      );
      legion.movesSpent = 0;
      if (r.kind === 'fought' && r.attackerWon) {
        expect(r.stackLost).toHaveLength(0);
        expect(w.unitsAt(11, 11)).toHaveLength(1);
        break;
      }
      if (r.kind === 'fought' && !r.attackerWon) break; // legion died; fine for this check
    }
  });

  it('costs an unwalled city a citizen when its defender dies, and consumes missiles', () => {
    for (let seed = 1; seed < 60; seed++) {
      const w = land();
      const c = city(w, 11, 11, 2, 3);
      unit(w, 2, 11, 11, { owner: 2 });
      const missile = unit(w, 10, 10, 10);
      const ev = resolveAttack(
        w,
        rules,
        new Rng(seed),
        missile,
        { x: 11, y: 11 },
        attackCtx(w, missile, { attackerMovesLeft: 36 }),
      );
      if (ev.kind === 'fought' && ev.attackerWon) {
        expect(c.size).toBe(2);
        expect(ev.cityShrunk).toBe(c);
        expect(ev.attackerConsumed).toBe(true);
        expect(w.units.includes(missile)).toBe(false);
        return;
      }
    }
    throw new Error('missile never won');
  });

  it('decides simplified combat in one round', () => {
    const w = land();
    const legion = unit(w, 3, 10, 10);
    unit(w, 2, 11, 11, { owner: 2 });
    const ev = resolveAttack(
      w,
      rules,
      new Rng(5),
      legion,
      { x: 11, y: 11 },
      attackCtx(w, legion, { realisticCombat: false }),
    );
    expect(ev.kind).toBe('fought');
    if (ev.kind === 'fought') expect(ev.result.rounds).toHaveLength(1);
  });
});

describe('city capture (verified)', () => {
  it('plunders by population share', () => {
    const loser = civ(2, { treasury: 300 });
    const w = land();
    const c = city(w, 4, 4, 2, 4);
    expect(plunder(loser, c, 10)).toBe(Math.trunc((4 * 300) / 11));
  });

  it('destroys half the buildings plus Palace, Temple, Cathedral, Courthouse; shrinks; steals an advance', () => {
    const w = land();
    const captor = w.civs[1] as Civ;
    const loser = w.civs[2] as Civ;
    loser.knownAdvances[7] = true;
    loser.knownAdvances[8] = true;
    const c = city(w, 4, 4, 2, 5, [
      IMPROVEMENT.palace,
      IMPROVEMENT.temple,
      IMPROVEMENT.barracks,
      IMPROVEMENT.granary,
      IMPROVEMENT.library,
      IMPROVEMENT.marketplace,
    ]);
    city(w, 12, 12, 2, 6); // keeps the loser alive with population
    const homed = unit(w, 2, 6, 4, { owner: 2, homeCity: c.id });
    const ev = captureCity(w, rules, new Rng(3), c, captor, loser, {
      turn: 50,
      difficulty: 2,
      conquest: true,
      guerillaWarfareDiscovered: false,
    });
    expect(ev.plunder).toBeGreaterThan(0);
    expect(captor.treasury).toBe(300 + ev.plunder);
    expect(c.owner).toBe(1);
    expect(c.size).toBe(4);
    expect(c.improvements[IMPROVEMENT.palace]).toBe(false);
    expect(c.improvements[IMPROVEMENT.temple]).toBe(false);
    // Of Barracks(2) Granary(3) Library(6) Marketplace(5) exactly one parity survives.
    const kept = [
      IMPROVEMENT.barracks,
      IMPROVEMENT.granary,
      IMPROVEMENT.library,
      IMPROVEMENT.marketplace,
    ].filter((i) => c.improvements[i]);
    expect(kept.length).toBe(2);
    expect(new Set(kept.map((i) => i & 1)).size).toBe(1);
    expect(ev.disbandedUnits).toContain(homed);
    expect(ev.stolenAdvance).toBe(7); // the higher AI value
    expect(captor.knownAdvances[7]).toBe(true);
    expect(c.previousOwner).toBe(2);
    expect(c.capturedTurn).toBe(50);
    expect(c.shieldsStored).toBe(0);
  });

  it('destroys a size-1 city taken by force and keeps buildings on liberation', () => {
    const w = land();
    const captor = w.civs[1] as Civ;
    const loser = w.civs[2] as Civ;
    const small = city(w, 4, 4, 2, 1, [IMPROVEMENT.temple]);
    const ev = captureCity(w, rules, new Rng(1), small, captor, loser, {
      turn: 10,
      difficulty: 2,
      conquest: true,
      guerillaWarfareDiscovered: false,
    });
    expect(ev.cityDestroyed).toBe(true);
    expect(w.cities.includes(small)).toBe(false);
    const mine = city(w, 8, 8, 2, 3, [IMPROVEMENT.temple, IMPROVEMENT.courthouse]);
    mine.previousOwner = 1;
    const lib = captureCity(w, rules, new Rng(1), mine, captor, loser, {
      turn: 10,
      difficulty: 2,
      conquest: true,
      guerillaWarfareDiscovered: false,
    });
    expect(lib.liberated).toBe(true);
    expect(mine.improvements[IMPROVEMENT.temple]).toBe(true);
    expect(mine.improvements[IMPROVEMENT.courthouse]).toBe(true);
    expect(mine.size).toBe(2); // size > 1 still loses one
  });

  it('raises partisans for a Communist or Democratic loser that knows Guerilla Warfare', () => {
    const w = land();
    const captor = w.civs[1] as Civ;
    const loser = w.civs[2] as Civ;
    loser.government = GOVERNMENT.democracy;
    loser.knownAdvances[34] = true;
    loser.knownAdvances[17] = true;
    const c = city(w, 10, 10, 2, 12);
    const ev = captureCity(w, rules, new Rng(2), c, captor, loser, {
      turn: 200,
      difficulty: 2,
      conquest: true,
      guerillaWarfareDiscovered: true,
    });
    // (12 + 6) / 8 = 2; × (|6 − 2| + 0 + 1) / 2 = 5; +1 because the captor lacks Guerilla Warfare… ×2 → 10
    expect(ev.partisans.length).toBe(10);
    expect(ev.partisans.every((p) => p.type === 9 && p.owner === 2 && p.fortified)).toBe(true);
  });
});
