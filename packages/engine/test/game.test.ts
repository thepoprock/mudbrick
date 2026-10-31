import { describe, expect, it } from 'vitest';
import { rawYields, shieldTotals, tradeSplit, unitSupport } from '../src/city.js';
import { Game } from '../src/game.js';
import { applyCityMood, researchableAdvances } from '../src/outcome.js';
import { Rng } from '../src/rng.js';
import { GOVERNMENT, IMPROVEMENT, type EngineRules } from '../src/rules.js';
import { CITY_CENTRE_INDEX, World, type City, type Civ } from '../src/world.js';

const special = (food: number, shields: number, trade: number) => ({ food, shields, trade });
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
    irrigate: { kind: 'yes' as const },
    irrigateTurns: 5,
    mine: { kind: 'no' as const },
    mineTurns: 10,
    transformTo: { kind: 'no' as const },
    specials: [special(2, 1, 0), special(2, 1, 0)] as [
      ReturnType<typeof special>,
      ReturnType<typeof special>,
    ],
  })),
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
      role: 1,
      flags: flags(),
    },
  ],
  advances: Array.from({ length: 100 }, (_, i) => ({
    name: `adv${i}`,
    preq1:
      i === 1
        ? { kind: 'advance' as const, index: 0 }
        : i >= 90
          ? { kind: 'never' as const }
          : { kind: 'none' as const },
    preq2: { kind: 'none' as const },
    epoch: 0,
    category: 0,
  })),
  improvements: Array.from({ length: 67 }, (_, i) => ({ name: `i${i}`, costRows: 4, upkeep: 1 })),
};

function civ(over: Partial<Civ> = {}): Civ {
  return {
    slot: 1,
    tribe: 0,
    name: 'Testers',
    adjective: 'Test',
    leader: 'T',
    cityStyle: 0,
    epoch: 0,
    colour: 1,
    government: GOVERNMENT.monarchy,
    treasury: 50,
    isHuman: true,
    inPlay: true,
    scienceStored: 0,
    researching: 2,
    advancesCount: 0,
    futureTechs: 0,
    scienceRate: 5,
    taxRate: 3,
    knownAdvances: Array<boolean>(100).fill(false),
    freeAdvancePending: false,
    ...over,
  };
}
function setup(cityOver: Partial<City> = {}, civOver: Partial<Civ> = {}) {
  const world = new World({ columns: 15, rows: 24, flatEarth: true, resourceSeed: 1 });
  world.terrain.fill(2);
  world.civs.push(civ({ slot: 0, name: 'Barbarians', isHuman: false, inPlay: true }), civ(civOver));
  const city: City = {
    id: 0,
    position: { x: 10, y: 10 },
    owner: 1,
    name: 'Ur',
    size: 3,
    improvements: Array<boolean>(67).fill(false),
    foodStored: 5,
    shieldsStored: 0,
    worked: (1 << CITY_CENTRE_INDEX) | 1 | 2 | 4,
    specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
    production: { kind: 'unit', index: 1 },
    inDisorder: false,
    celebrating: false,
    tradeRoutes: [],
    ...cityOver,
  };
  city.improvements[IMPROVEMENT.palace] = true;
  world.cities.push(city);
  world.units.push({
    id: 0,
    position: { x: 10, y: 10 },
    owner: 1,
    type: 1,
    veteran: false,
    hitPointsLost: 0,
    movesSpent: 2,
    fortified: true,
    homeCity: 0,
    order: null,
    workCounter: 0,
    gotoTarget: null,
    lastDirection: null,
    gotoSteps: 0,
  });
  const game = new Game(world, rules, new Rng(7), {
    turn: 10,
    difficulty: 2,
    realisticCombat: true,
    firstDiscoveredBy: Array<number>(100).fill(0),
  });
  return { world, city, game, civ: world.civs[1] as Civ };
}

describe('Game turn loop', () => {
  it('applies food, shields, gold and science from the same totals the city rules compute', () => {
    const { world, city, game, civ } = setup();
    const ctx = game.cityContext(city);
    const raw = rawYields(world, rules, city, ctx);
    const support = unitSupport(world, rules, city, ctx, world.units);
    const shields = shieldTotals(rules, city, ctx, raw.shields, support.shields);
    const trade = tradeSplit(rules, city, ctx, raw.trade);
    const foodBefore = city.foodStored;
    const goldBefore = civ.treasury;
    const events = game.endTurn();
    expect(game.state.turn).toBe(11);
    expect(city.foodStored).toBe(foodBefore + raw.food - city.size * 2);
    expect(civ.treasury).toBe(goldBefore + trade.tax - 1); // Palace upkeep 1
    expect(civ.scienceStored).toBe(trade.science);
    expect(world.units[0]?.movesSpent).toBe(0);
    const built = events.filter((e) => 'city' in e && e.event.kind === 'built-unit');
    expect(built.length).toBe(shields.surplus >= 10 ? 1 : 0);
  });

  it('collects no gold in disorder and lets a Democracy fall after two disorder turns', () => {
    const { city, civ } = setup();
    civ.government = GOVERNMENT.democracy;
    const m = {
      happy: 0,
      unhappy: 2,
      shieldSurplus: 1,
      foodSurplus: 1,
      foodProduced: 8,
      foodEaten: 6,
      tax: 5,
    };
    let ev = applyCityMood(rules, civ, city, m, { allowRevolt: true });
    expect(ev.map((e) => e.kind)).toEqual(['disorder']);
    expect(civ.treasury).toBe(50);
    ev = applyCityMood(rules, civ, city, m, { allowRevolt: true });
    expect(ev.map((e) => e.kind)).toEqual(['revolt']);
    expect(civ.government).toBe(GOVERNMENT.anarchy);
    ev = applyCityMood(rules, civ, city, { ...m, happy: 2, unhappy: 0 }, { allowRevolt: true });
    expect(ev.map((e) => e.kind)).toEqual(['restored']); // no gold and no celebration under Anarchy
  });

  it('celebrates and grows by rapture under a Republic', () => {
    const { city, civ } = setup();
    civ.government = GOVERNMENT.republic;
    const m = {
      happy: 2,
      unhappy: 0,
      shieldSurplus: 1,
      foodSurplus: 2,
      foodProduced: 8,
      foodEaten: 6,
      tax: 3,
    };
    expect(applyCityMood(rules, civ, city, m, { allowRevolt: true }).map((e) => e.kind)).toEqual([
      'gold',
      'celebration-start',
    ]);
    expect(civ.treasury).toBe(53);
    expect(applyCityMood(rules, civ, city, m, { allowRevolt: true }).map((e) => e.kind)).toEqual([
      'gold',
      'rapture-growth',
    ]);
    expect(city.size).toBe(4);
    expect(
      applyCityMood(rules, civ, city, { ...m, unhappy: 1 }, { allowRevolt: true }).map(
        (e) => e.kind,
      ),
    ).toEqual(['gold', 'celebration-end']);
  });

  it('lists researchable advances from known prerequisites and lets the AI pick one', () => {
    const c = civ({ isHuman: false, researching: null });
    const options = researchableAdvances(rules, c);
    expect(options).not.toContain(1); // needs advance 0
    expect(options).not.toContain(95); // disabled
    c.knownAdvances[0] = true;
    expect(researchableAdvances(rules, c)).toContain(1);
    expect(researchableAdvances(rules, c)).not.toContain(0);
  });

  it('runs the AI rate policy for computer players', () => {
    const { game, civ } = setup({}, { isHuman: false });
    const events = game.endTurn();
    expect(events.some((e) => e.event.kind === 'rates')).toBe(true);
    expect(civ.scienceRate + civ.taxRate).toBeLessThanOrEqual(10);
  });
});
