import { describe, expect, it } from 'vitest';
import {
  assignWorkers,
  boxRows,
  corruption,
  foodBox,
  growthBlocker,
  mood,
  processGrowth,
  rawYields,
  shieldTotals,
  squareYield,
  tradeSplit,
  unitSupport,
  type CityContext,
  workerStatus,
} from '../src/city.js';
import { disbandForDisorder } from '../src/outcome.js';
import { GOVERNMENT, IMPROVEMENT, ADVANCE, type EngineRules } from '../src/rules.js';
import { CITY_CENTRE_INDEX, SquareFlag, World, type City, type Unit } from '../src/world.js';

const special = (food: number, shields: number, trade: number) => ({ food, shields, trade });
/** Terrain 0 desert, 1 plains, 2 grassland, 4 hills, 10 ocean; the rest grassland-like. */
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
  terrain: Array.from({ length: 11 }, (_, i) => {
    const base = {
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
    };
    if (i === 0)
      return {
        ...base,
        food: 0,
        shields: 1,
        trade: 0,
        irrigateBonus: 1,
        mineBonus: 1,
        irrigate: { kind: 'yes' as const },
        irrigateTurns: 5,
        mine: { kind: 'no' as const },
        mineTurns: 10,
        transformTo: { kind: 'no' as const },
        specials: [special(3, 1, 0), special(0, 4, 0)] as const,
      };
    if (i === 1)
      return {
        ...base,
        food: 1,
        shields: 1,
        specials: [special(1, 3, 0), special(3, 1, 0)] as const,
      };
    if (i === 4)
      return {
        ...base,
        moveCost: 2,
        defenceHalves: 4,
        food: 1,
        shields: 0,
        irrigateBonus: 1,
        mineBonus: 3,
        irrigate: { kind: 'yes' as const },
        irrigateTurns: 5,
        mine: { kind: 'no' as const },
        mineTurns: 10,
        transformTo: { kind: 'no' as const },
        specials: [special(1, 2, 0), special(1, 0, 4)] as const,
      };
    if (i === 10)
      return {
        ...base,
        food: 1,
        shields: 0,
        trade: 2,
        irrigateBonus: 0,
        specials: [special(3, 0, 2), special(2, 2, 3)] as const,
      };
    return { ...base, specials: [special(2, 1, 0), special(2, 1, 0)] as const };
  }).map((t) => ({
    ...t,
    specials: [t.specials[0], t.specials[1]] as [
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
      flags: noFlags(),
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
      role: 0,
      flags: noFlags(),
    },
    {
      name: 'Fanatics',
      domain: 0,
      move: 1,
      range: 0,
      attack: 4,
      defence: 4,
      hitPointsTens: 2,
      firepower: 1,
      costRows: 2,
      role: 1,
      flags: { ...noFlags(), freeSupportUnderFundamentalism: true },
    },
  ],
  advances: [],
  improvements: Array.from({ length: 67 }, (_, i) => ({
    name: `improvement ${i}`,
    costRows: i === 1 ? 10 : 4,
    upkeep: 1,
  })),
};

function noFlags() {
  return {
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
  };
}

function ctx(over: Partial<CityContext> = {}): CityContext {
  return {
    government: GOVERNMENT.monarchy,
    difficulty: 2,
    isHuman: true,
    cityCount: 5,
    scienceRate: 5,
    taxRate: 3,
    knows: () => false,
    ownsWonder: () => false,
    distanceToCapital: 5,
    connectedToCapital: 0,
    ...over,
  };
}

function city(world: World, over: Partial<City> = {}): City {
  const c: City = {
    id: 0,
    position: { x: 10, y: 10 },
    owner: 1,
    name: 'Test',
    size: 5,
    improvements: Array<boolean>(67).fill(false),
    foodStored: 0,
    shieldsStored: 0,
    worked: 1 << CITY_CENTRE_INDEX,
    specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
    production: { kind: 'unit', index: 1 },
    inDisorder: false,
    celebrating: false,
    tradeRoutes: [],
    ...over,
  };
  world.cities.push(c);
  return c;
}

function grassWorld(): World {
  const w = new World({ columns: 15, rows: 24, flatEarth: true, resourceSeed: 1 });
  w.terrain.fill(2); // grassland everywhere; seed 1 keeps specials off grassland anyway
  return w;
}

describe('square yields (verified)', () => {
  it('applies the despotism penalty, irrigation, the centre minimum and roads', () => {
    const w = grassWorld();
    const c = city(w);
    // Grassland centre: food 2 + irrigation 1 = 3 → despotism penalty → 2 under Despotism, 3 under Monarchy.
    expect(
      squareYield(w, rules, c, CITY_CENTRE_INDEX, 0, ctx({ government: GOVERNMENT.despotism })),
    ).toBe(2);
    expect(squareYield(w, rules, c, CITY_CENTRE_INDEX, 0, ctx())).toBe(3);
    // Centre shields: grassland without the shield stripe yields 0 → minimum 1 on the city square.
    const centreShield = squareYield(w, rules, c, CITY_CENTRE_INDEX, 1, ctx());
    expect(centreShield).toBeGreaterThanOrEqual(1);
    // Centre trade: grassland 0 + road (city) +1 = 1; Republic adds 1 more; celebrating Monarchy too.
    expect(squareYield(w, rules, c, CITY_CENTRE_INDEX, 2, ctx())).toBe(1);
    expect(
      squareYield(w, rules, c, CITY_CENTRE_INDEX, 2, ctx({ government: GOVERNMENT.republic })),
    ).toBe(2);
    c.celebrating = true;
    expect(squareYield(w, rules, c, CITY_CENTRE_INDEX, 2, ctx())).toBe(2);
    c.celebrating = false;
    // A plain grassland neighbour: 2 food, 0 shields unless striped, 0 trade; with a river +1 trade.
    const n = w.radiusSquare(10, 10, 1);
    expect(n).not.toBeNull();
    if (n) {
      w.setFlag(n.x, n.y, SquareFlag.River);
      expect(squareYield(w, rules, c, 1, 2, ctx())).toBe(1);
      w.setFlag(n.x, n.y, SquareFlag.Pollution);
      expect(squareYield(w, rules, c, 1, 0, ctx())).toBe(1); // (2 + 1) / 2
    }
  });

  it('sums worked squares and subtracts outgoing food routes', () => {
    const w = grassWorld();
    const c = city(w, {
      worked: (1 << CITY_CENTRE_INDEX) | 1 | 2,
      tradeRoutes: [{ partner: 3, food: true }],
    });
    const y = rawYields(w, rules, c, ctx());
    expect(y.food).toBe(3 + 2 + 2 - 1);
  });
});

describe('shields, waste and corruption (verified)', () => {
  const w = grassWorld();
  it('multiplies with Factory, Power and Manufacturing Plant and caps power at the factory bonus', () => {
    const c = city(w);
    expect(shieldTotals(rules, c, ctx({ distanceToCapital: 0 }), 20, 0).produced).toBe(20);
    c.improvements[IMPROVEMENT.powerPlant] = true;
    expect(shieldTotals(rules, c, ctx({ distanceToCapital: 0 }), 20, 0).produced).toBe(20); // power without factory
    c.improvements[IMPROVEMENT.factory] = true;
    expect(shieldTotals(rules, c, ctx({ distanceToCapital: 0 }), 20, 0).produced).toBe(40);
    c.improvements[IMPROVEMENT.manufacturingPlant] = true;
    expect(shieldTotals(rules, c, ctx({ distanceToCapital: 0 }), 20, 0).produced).toBe(50);
  });
  it('computes corruption from distance and government, halved by a courthouse', () => {
    const c = city(w);
    // Monarchy: G = 6, distance 10: 100 × 10 × 3 / 120 = 25
    expect(corruption(rules, c, ctx({ distanceToCapital: 10 }), 100, false)).toBe(25);
    expect(
      corruption(
        rules,
        c,
        ctx({ distanceToCapital: 10, government: GOVERNMENT.democracy }),
        100,
        false,
      ),
    ).toBe(0);
    expect(
      corruption(
        rules,
        c,
        ctx({ distanceToCapital: 10, government: GOVERNMENT.communism }),
        100,
        false,
      ),
    ).toBe(0); // palace distance 0
    c.improvements[IMPROVEMENT.courthouse] = true;
    expect(corruption(rules, c, ctx({ distanceToCapital: 10 }), 100, false)).toBe(12);
    // Despotism adds the difficulty to the distance for humans: G = 5, distance 12: 100×12×3/100 = 36
    c.improvements[IMPROVEMENT.courthouse] = false;
    expect(
      corruption(
        rules,
        c,
        ctx({ distanceToCapital: 10, government: GOVERNMENT.despotism }),
        100,
        false,
      ),
    ).toBe(36);
  });
});

describe('trade split (verified)', () => {
  const w = grassWorld();
  it('splits by rates, adds specialists, buildings and Newton', () => {
    const c = city(w);
    const base = ctx({ distanceToCapital: 0, scienceRate: 5, taxRate: 3 });
    let s = tradeSplit(rules, c, base, 20);
    expect([s.luxuries, s.science, s.tax]).toEqual([4, 10, 6]);
    c.specialists = { entertainers: 1, taxCollectors: 1, scientists: 1 };
    s = tradeSplit(rules, c, base, 20);
    expect([s.luxuries, s.science, s.tax]).toEqual([6, 13, 9]);
    c.specialists = { entertainers: 0, taxCollectors: 0, scientists: 0 };
    c.improvements[IMPROVEMENT.marketplace] = true;
    c.improvements[IMPROVEMENT.library] = true;
    s = tradeSplit(rules, c, base, 20);
    expect([s.luxuries, s.science, s.tax]).toEqual([6, 15, 9]);
    c.improvements[IMPROVEMENT.isaacNewtons] = true;
    expect(tradeSplit(rules, c, base, 20).science).toBe(20);
  });
  it('caps Fundamentalist science and adds tithes', () => {
    const c = city(w);
    c.improvements[IMPROVEMENT.temple] = true;
    const f = ctx({
      distanceToCapital: 0,
      government: GOVERNMENT.fundamentalism,
      scienceRate: 8,
      taxRate: 2,
      knows: (a) => a === ADVANCE.ceremonialBurial,
    });
    const s = tradeSplit(rules, c, f, 20);
    expect(s.science).toBe(5); // 50 % of 10
    expect(s.tax).toBe(20 - 10 + 1); // rest plus the temple tithe
  });
});

describe('happiness (verified)', () => {
  const w = grassWorld();
  const inputs = { luxuries: 0, militaryInCity: 0, militaryAbroad: 0, noMilitaryUnhappiness: true };
  it('uses the content base, luxuries, temples and martial law', () => {
    const c = city(w, { size: 6 });
    // Prince (difficulty 2): content base 5 → unhappy = 5 − 3 = 2, plus empire size term 0 for 5 cities
    const human = ctx({ difficulty: 2, cityCount: 5 });
    expect(mood(rules, c, human, inputs)).toEqual({ happy: 0, content: 4, unhappy: 2 });
    expect(mood(rules, c, human, { ...inputs, luxuries: 4 })).toEqual({
      happy: 0,
      content: 6,
      unhappy: 0,
    });
    expect(mood(rules, c, human, { ...inputs, luxuries: 6 })).toEqual({
      happy: 1,
      content: 5,
      unhappy: 0,
    });
    c.improvements[IMPROVEMENT.temple] = true;
    expect(
      mood(
        rules,
        c,
        ctx({ difficulty: 2, cityCount: 5, knows: (a) => a === ADVANCE.ceremonialBurial }),
        inputs,
      ),
    ).toEqual({ happy: 0, content: 5, unhappy: 1 });
    c.improvements[IMPROVEMENT.temple] = false;
    expect(mood(rules, c, human, { ...inputs, militaryInCity: 2 })).toEqual({
      happy: 0,
      content: 6,
      unhappy: 0,
    });
  });
  it('adds republican military unhappiness and wonder bonuses', () => {
    const c = city(w, { size: 6 });
    const rep = ctx({ difficulty: 2, cityCount: 5, government: GOVERNMENT.republic });
    expect(mood(rules, c, rep, { ...inputs, militaryAbroad: 3 })).toEqual({
      happy: 0,
      content: 2,
      unhappy: 4,
    });
    const dem = ctx({ difficulty: 2, cityCount: 5, government: GOVERNMENT.democracy });
    expect(mood(rules, c, dem, { ...inputs, militaryAbroad: 1 })).toEqual({
      happy: 0,
      content: 2,
      unhappy: 4,
    });
    c.improvements[IMPROVEMENT.policeStation] = true;
    expect(mood(rules, c, dem, { ...inputs, militaryAbroad: 1 })).toEqual({
      happy: 0,
      content: 3,
      unhappy: 3,
    });
    const gardens = ctx({
      difficulty: 2,
      cityCount: 5,
      ownsWonder: (i) => i === IMPROVEMENT.hangingGardens,
    });
    expect(mood(rules, c, gardens, inputs)).toEqual({ happy: 1, content: 3, unhappy: 2 });
    c.improvements[IMPROVEMENT.hangingGardens] = true;
    expect(mood(rules, c, gardens, inputs)).toEqual({ happy: 3, content: 1, unhappy: 2 });
  });
  it('AI content base and Fundamentalism', () => {
    const c = city(w, { size: 6 });
    expect(mood(rules, c, ctx({ isHuman: false }), inputs).unhappy).toBe(3); // 5 − 2
    expect(mood(rules, c, ctx({ government: GOVERNMENT.fundamentalism }), inputs).unhappy).toBe(0);
  });
});

describe('support, growth and boxes (verified)', () => {
  const w = grassWorld();
  function unit(id: number, type: number, x: number, y: number): Unit {
    return {
      id,
      position: { x, y },
      owner: 1,
      type,
      veteran: false,
      hitPointsLost: 0,
      movesSpent: 0,
      fortified: false,
      homeCity: 0,
      order: null,
      workCounter: 0,
      gotoTarget: null,
      lastDirection: null,
      gotoSteps: 0,
    };
  }
  it('charges shields per government and counts settlers and units abroad', () => {
    const c = city(w, { size: 2 });
    const units = [unit(0, 0, 10, 10), unit(1, 1, 10, 10), unit(2, 1, 12, 10), unit(3, 1, 14, 12)];
    const des = unitSupport(w, rules, c, ctx({ government: GOVERNMENT.despotism }), units);
    expect(des.shields).toBe(2); // 4 units, size 2 free
    expect(des.settlers).toBe(1);
    expect(des.abroad).toBe(2);
    expect(des.inCity).toBe(1);
    expect(unitSupport(w, rules, c, ctx({ government: GOVERNMENT.monarchy }), units).shields).toBe(
      1,
    );
    expect(unitSupport(w, rules, c, ctx({ government: GOVERNMENT.republic }), units).shields).toBe(
      4,
    );
    const fan = unitSupport(w, rules, c, ctx({ government: GOVERNMENT.fundamentalism }), [
      unit(9, 2, 10, 10),
      ...units,
    ]);
    expect(fan.shields).toBe(0);
  });
  it('sizes the boxes for humans and AI and blocks growth without aqueducts', () => {
    expect(foodBox(rules, ctx(), 3)).toBe(40);
    expect(boxRows(rules, ctx({ isHuman: false, difficulty: 0 }), false)).toBe(15);
    expect(boxRows(rules, ctx({ isHuman: false, difficulty: 3 }), false)).toBe(10);
    expect(boxRows(rules, ctx({ isHuman: false, difficulty: 5 }), false)).toBe(8);
    const c = city(w, { size: 8 });
    expect(growthBlocker(rules, c)).toBe(IMPROVEMENT.aqueduct);
    c.improvements[IMPROVEMENT.aqueduct] = true;
    expect(growthBlocker(rules, c)).toBe(0);
    c.size = 12;
    expect(growthBlocker(rules, c)).toBe(IMPROVEMENT.sewerSystem);
  });
  it('grows, keeps half a box with a Granary or the Pyramids, starves settlers first', () => {
    const c = city(w, { size: 3, foodStored: 40 });
    expect(processGrowth(rules, c, ctx(), []).grew).toBe(true);
    expect(c.size).toBe(4);
    expect(c.foodStored).toBe(0);
    c.foodStored = 50;
    expect(
      processGrowth(rules, c, ctx({ ownsWonder: (i) => i === IMPROVEMENT.pyramids }), []).grew,
    ).toBe(true);
    expect(c.foodStored).toBe((5 + 1) * 5);
    const starving = city(w, { id: 1, size: 3, foodStored: -1 });
    const settler = unit(5, 0, 10, 10);
    const out = processGrowth(rules, starving, ctx(), [settler]);
    expect(out.starved).toBe(true);
    expect(out.disbandedSettler).toBe(settler);
    expect(starving.size).toBe(3);
    const tiny = city(w, { id: 2, size: 1, foodStored: -1 });
    expect(processGrowth(rules, tiny, ctx(), []).destroyed).toBe(true);
  });
});

describe('government scoring pass (verified)', () => {
  it('yields, corruption and the trade split feed the scores while the switch is on', () => {
    const w = grassWorld();
    const c = city(w, { worked: (1 << CITY_CENTRE_INDEX) | 1 });
    const scores = new Int16Array(7);
    const sctx = ctx({
      government: GOVERNMENT.despotism,
      governmentScores: scores,
      civilize: 1,
      distanceToCapital: 10,
    });
    // Centre food 3 costs Despotism a point; the centre's one trade gives the Republic and
    // Democracy a point each; the plain neighbour makes nothing above 2 and no trade.
    rawYields(w, rules, c, sctx);
    expect(scores[1]).toBe(-1);
    expect(scores[5]).toBe(1);
    expect(scores[6]).toBe(1);
    scores.fill(0);
    // 20 trade ten squares from the capital, a human at difficulty 2: Despotism pays at
    // distance 12 and factor 5 (7), Monarchy at 10 and 6 (5), the Republic at 10 and 8 (3),
    // Communism its palace distance at Despotism's factor; nothing against the rest.
    corruption(rules, c, sctx, 20, false, true);
    const communism = 0 - Math.trunc((rules.cosmic.communismPalaceDistance * 20 * 3) / (5 * 20));
    expect(Array.from(scores)).toEqual([0, -7, -5, communism, 0, -3, 0]);
    scores.fill(0);
    // Fundamentalism's terms on 20 uncorrupted trade at rates 5/3: luxuries 4 → +2, science
    // 10 → −(1 + 3) × 10 / 4 = −10, no buildings so no tithe.
    tradeSplit(rules, c, ctx({ governmentScores: scores, civilize: 1, distanceToCapital: 0 }), 20);
    expect(scores[4]).toBe(2 - 10);
  });
});

describe('disorder under a senate (verified)', () => {
  const soldier = (id: number, x: number, y: number): Unit => ({
    id,
    position: { x, y },
    owner: 1,
    type: 1,
    veteran: false,
    hitPointsLost: 0,
    movesSpent: 0,
    fortified: false,
    homeCity: 0,
    order: null,
    workCounter: 0,
    gotoTarget: null,
    lastDirection: null,
    gotoSteps: 0,
  });
  it('a computer city in disorder disbands its farthest land unit outside cities on its turn', () => {
    const w = grassWorld();
    const c = city(w, { inDisorder: true });
    const near = soldier(0, 12, 10);
    const far = soldier(8, 14, 14);
    const inTown = soldier(16, 10, 10);
    for (const u of [near, far, inTown]) w.units.push(u);
    const ctx = { turn: 40, isHuman: false, government: GOVERNMENT.republic };
    // Unit 0 at turn 40: (40 + 0) & 7 = 0 — the cycle fires; the farthest unit outside goes.
    const ev = disbandForDisorder(w, rules, c, ctx);
    expect(ev.map((e) => e.kind)).toEqual(['disbanded-for-disorder']);
    expect(w.units.includes(far)).toBe(false);
    expect(c.inDisorder).toBe(false);
    // Order restored: nothing more; a human or a monarchy never does this.
    expect(disbandForDisorder(w, rules, c, ctx)).toEqual([]);
    c.inDisorder = true;
    expect(disbandForDisorder(w, rules, c, { ...ctx, isHuman: true })).toEqual([]);
    expect(disbandForDisorder(w, rules, c, { ...ctx, government: GOVERNMENT.monarchy })).toEqual(
      [],
    );
    // Off the cycle (turn 41: 41 & 7, 57 & 7 are not 0) nothing happens either.
    expect(disbandForDisorder(w, rules, c, { ...ctx, turn: 41 })).toEqual([]);
  });
});

describe('worker placement (verified)', () => {
  const opts = {
    turn: 0,
    isHuman: false,
    inCityTurn: false,
    settlers: 0,
    support: 0,
    isAlly: () => false,
    isHumanSlot: () => false,
  };
  function seen(w: World): void {
    for (let y = 0; y < w.rows; y++)
      for (let x = 0; x < w.columns; x++) if (w.isSquare(x, y)) w.reveal(x, y, 1);
  }
  it('works the centre and three squares for a size-3 city, none twice with a neighbour', () => {
    const w = grassWorld();
    seen(w);
    const c = city(w, { size: 3, worked: 1 << CITY_CENTRE_INDEX });
    if (!w.cities.includes(c)) w.cities.push(c);
    assignWorkers(w, rules, c, ctx({ government: GOVERNMENT.despotism }), opts);
    const worked = Array.from({ length: 21 }, (_, i) => i).filter((i) => (c.worked >> i) & 1);
    expect(worked).toContain(CITY_CENTRE_INDEX);
    expect(worked.length).toBe(4);
    expect(
      c.specialists.entertainers + c.specialists.taxCollectors + c.specialists.scientists,
    ).toBe(0);
    // A neighbour two squares east working its own radius blocks the squares both share.
    const other = city(w, {
      id: 1,
      position: { x: 12, y: 10 },
      size: 2,
      worked: 1 << CITY_CENTRE_INDEX,
    });
    w.cities.push(other);
    assignWorkers(w, rules, other, ctx({ government: GOVERNMENT.despotism }), opts);
    const st = workerStatus(w, rules, c, opts);
    const shared = Array.from({ length: 20 }, (_, i) => i).filter(
      (i) => ((st[i] ?? 0) & 0x10) !== 0,
    );
    expect(shared.length).toBeGreaterThan(0);
    assignWorkers(w, rules, c, ctx({ government: GOVERNMENT.despotism }), opts);
    for (const i of shared) expect((c.worked >> i) & 1).toBe(0);
    // A square under a foreign soldier is off limits; a human's soldier keeps the workers as they are.
    const unseen = workerStatus(w, rules, c, { ...opts, isHumanSlot: () => true });
    expect(unseen[CITY_CENTRE_INDEX]).toBe(8); // our own centre: a city stands there
  });

  it('a computer city in disorder gains an entertainer during the city turn, a human keeps its workers', () => {
    const w = grassWorld();
    seen(w);
    const c = city(w, { size: 4, worked: 1 << CITY_CENTRE_INDEX });
    if (!w.cities.includes(c)) w.cities.push(c);
    assignWorkers(w, rules, c, ctx({ government: GOVERNMENT.despotism }), opts);
    c.inDisorder = true;
    assignWorkers(w, rules, c, ctx({ government: GOVERNMENT.despotism }), {
      ...opts,
      inCityTurn: true,
    });
    expect(c.specialists.entertainers).toBe(1);
    c.inDisorder = false;
    assignWorkers(w, rules, c, ctx({ government: GOVERNMENT.despotism }), {
      ...opts,
      inCityTurn: true,
    });
    expect(c.specialists.entertainers).toBe(0);
    // A human city keeps its arrangement: the same worked mask with a citizen to spare stays.
    const keep = c.worked;
    assignWorkers(w, rules, c, ctx({ government: GOVERNMENT.despotism }), {
      ...opts,
      isHuman: true,
    });
    expect(c.worked).toBe(keep);
  });
});
