import { describe, expect, it } from 'vitest';
import {
  aiChooseProduction,
  fighterAllowed,
  improvementPriority,
  nuclearAllowed,
  type AiBuildFacts,
} from '../src/aiBuild.js';
import { GOVERNMENT, IMPROVEMENT, type EngineRules } from '../src/rules.js';
import { emptyStrategy } from '../src/aiStrategy.js';
import { CITY_CENTRE_INDEX, World, type City, type Civ } from '../src/world.js';

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
  units: [
    unitType('Settlers', { attack: 0, hitPointsTens: 2, costRows: 4, role: 5 }),
    unitType('Engineers', {
      attack: 0,
      hitPointsTens: 2,
      costRows: 4,
      role: 5,
      preq: { kind: 'advance', index: 28 },
    }),
    unitType('Warriors', { costRows: 1, role: 1 }),
    unitType('Phalanx', { defence: 2, costRows: 2, role: 1 }),
    unitType('Legion', { attack: 4, defence: 2, costRows: 4, role: 0 }),
  ],
  advances: Array.from({ length: 100 }, () => ({
    name: 'a',
    preq1: { kind: 'none' as const },
    preq2: { kind: 'none' as const },
    epoch: 0,
    category: 0,
  })),
  improvements: Array.from({ length: 67 }, (_, i) => ({ name: `i${i}`, costRows: 4, upkeep: 1 })),
};

function civ(over: Partial<Civ> = {}): Civ {
  return {
    slot: 2,
    tribe: 0,
    name: 'AI',
    adjective: 'AI',
    leader: 'L',
    cityStyle: 0,
    epoch: 0,
    colour: 2,
    government: GOVERNMENT.monarchy,
    treasury: 100,
    isHuman: false,
    inPlay: true,
    scienceStored: 0,
    researching: null,
    advancesCount: 5,
    futureTechs: 0,
    scienceRate: 5,
    taxRate: 3,
    knownAdvances: Array<boolean>(100).fill(false),
    freeAdvancePending: false,
    ...over,
  };
}
function city(world: World, size: number, imps: number[] = []): City {
  const improvements = Array<boolean>(67).fill(false);
  for (const i of imps) improvements[i] = true;
  const c: City = {
    id: world.cities.length,
    position: { x: 10, y: 10 },
    owner: 2,
    name: 'AI City',
    size,
    improvements,
    foodStored: 0,
    shieldsStored: 0,
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
const facts = (over: Partial<AiBuildFacts> = {}): AiBuildFacts => ({
  shields: 5,
  support: 1,
  trade: 4,
  corruption: 1,
  foodSurplus: 2,
  happy: 1,
  unhappy: 1,
  settlersSupported: 0,
  defendersInCity: 1,
  threat: 0,
  zocAtCity: false,
  attack: 0,
  expand: 0,
  civilize: 0,
  difficulty: 2,
  turn: 50,
  simplifiedCombat: false,
  spaceRace: 0,
  hasCapital: true,
  expanding: false,
  ...over,
});
function env(world: World, c: City, f: AiBuildFacts, owner = civ()) {
  return {
    world,
    rules,
    civ: owner,
    city: c,
    ctx: {} as never,
    facts: f,
    cityCount: world.cities.filter((x) => x.owner === owner.slot).length,
    wonderCity: () => null,
    ownsWonder: () => false,
    canBuildImprovement: (i: number) => i < 39 && !c.improvements[i],
  };
}

describe('AI production choice (verified structure)', () => {
  it('ranks the emergencies of the original: Temple in disorder, Palace without a capital', () => {
    const w = new World({ columns: 20, rows: 30, flatEarth: true });
    w.terrain.fill(2);
    const c = city(w, 5);
    expect(
      improvementPriority(IMPROVEMENT.temple, c, facts({ happy: 1, unhappy: 1 }), {
        rules,
        cityCount: 3,
        continentCities: 3,
        barracksOnContinent: 0,
        airportsOnContinent: 0,
        portsOnContinent: 0,
        oceanSquares: 0,
        farmlandSquares: 0,
        coastal: false,
        distanceToCapital: 5,
        knows: () => false,
        ownsWonder: () => false,
        wonderBuilt: () => false,
        scienceRate: 5,
        government: 2,
        isHuman: false,
        slot: 1,
      }),
    ).toEqual({ n: 9, military: false });
    c.inDisorder = true;
    const r = improvementPriority(IMPROVEMENT.temple, c, facts(), {
      rules,
      cityCount: 3,
      continentCities: 3,
      barracksOnContinent: 0,
      airportsOnContinent: 0,
      portsOnContinent: 0,
      oceanSquares: 0,
      farmlandSquares: 0,
      coastal: false,
      distanceToCapital: 5,
      knows: () => false,
      ownsWonder: () => false,
      wonderBuilt: () => false,
      scienceRate: 5,
      government: 2,
      isHuman: false,
      slot: 1,
    });
    expect(r?.n).toBe(-5);
    const pick = aiChooseProduction(env(w, c, facts({ unhappy: 3, happy: 0 })));
    expect(pick).toEqual({ kind: 'improvement', index: IMPROVEMENT.temple });
  });

  it('builds a defender first when the city is empty and a settler when food allows', () => {
    const w = new World({ columns: 20, rows: 30, flatEarth: true });
    w.terrain.fill(2);
    const c = city(w, 4, [IMPROVEMENT.temple, IMPROVEMENT.palace]);
    w.units.push({
      id: 0,
      position: { x: 2, y: 2 },
      owner: 2,
      type: 4,
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
    });
    expect(aiChooseProduction(env(w, c, facts({ defendersInCity: 0 })))).toEqual({
      kind: 'unit',
      index: 3,
    });
    const settled = aiChooseProduction(
      env(w, c, facts({ defendersInCity: 2, foodSurplus: 4, trade: 30, shields: 30 })),
    );
    expect(['unit', 'improvement']).toContain(settled.kind);
    // With nothing left to build and the land mass short of cities (fewer than expand + 3), the
    // settlers' continent-share rule scores 0 and wins (VERIFIED, ai-city.md).
    const e = env(w, c, facts({ defendersInCity: 2, foodSurplus: 4 }));
    e.canBuildImprovement = () => false;
    expect(aiChooseProduction(e)).toEqual({ kind: 'unit', index: 0 });
  });

  it('a unit-less early civilization builds its best defender', () => {
    const w = new World({ columns: 20, rows: 30, flatEarth: true });
    w.terrain.fill(2);
    const c = city(w, 1);
    expect(
      aiChooseProduction(env(w, c, facts(), civ({ government: GOVERNMENT.despotism }))),
    ).toEqual({ kind: 'unit', index: 3 });
  });
});

describe('defence valuations (0x00474edb)', () => {
  it("SAM Battery and Coastal Fortress weigh the main human's air and naval units", () => {
    const w = new World({ columns: 20, rows: 30, flatEarth: true });
    w.terrain.fill(2);
    const c = city(w, 5);
    const counts: Record<string, number> = { '2:28': 2, '2:31': 1, '2:40': 1 };
    const base = {
      rules,
      cityCount: 3,
      continentCities: 3,
      barracksOnContinent: 0,
      airportsOnContinent: 0,
      portsOnContinent: 0,
      oceanSquares: 0,
      farmlandSquares: 0,
      coastal: true,
      distanceToCapital: 5,
      knows: () => false,
      ownsWonder: () => false,
      wonderBuilt: () => false,
      scienceRate: 5,
      government: 2,
      isHuman: false,
      slot: 1,
      mainHuman: 2,
      isHumanSlot: (s: number) => s === 2,
      unitCount: (s: number, ty: number) => counts[`${s}:${ty}`] ?? 0,
      atWar: () => false,
      vendettaAgainst: () => false,
      reputationOf: () => 0,
    };
    // (Stealth Bombers × 2 + Bombers × 2) × 2 = 12 → 12 − 12 = 0 → at least 1.
    expect(improvementPriority(IMPROVEMENT.samBattery, c, facts(), base)).toEqual({
      n: 1,
      military: true,
    });
    // One Battleship × 5 → 7.
    expect(improvementPriority(IMPROVEMENT.coastalFortress, c, facts(), base)).toEqual({
      n: 7,
      military: true,
    });
    // A human owner sums the others, halved without war or vendetta: 2 + 1 = 3 → 1 → 11.
    const human = {
      ...base,
      isHuman: true,
      slot: 3,
      isHumanSlot: (s: number) => s === 2 || s === 3,
    };
    expect(improvementPriority(IMPROVEMENT.samBattery, c, facts(), human)?.n).toBe(11);
    // With a human of reputation above 4 the military flag follows the expanding flag.
    const rep = { ...base, reputationOf: () => 5 };
    expect(
      improvementPriority(IMPROVEMENT.samBattery, c, facts({ expanding: false }), rep)?.military,
    ).toBe(false);
    // SDI Defense: (clamp(15 − 5) + 1) / 2 = 5, ×2 without the Manhattan Project, ×2 while the
    // human has no Nuclear Missiles → 20; one missile halves that.
    expect(improvementPriority(IMPROVEMENT.sdiDefense, c, facts(), base)?.n).toBe(20);
    const nukes = { ...base, unitCount: (s: number, ty: number) => (s === 2 && ty === 45 ? 1 : 0) };
    expect(improvementPriority(IMPROVEMENT.sdiDefense, c, facts(), nukes)?.n).toBe(10);
    // Police Station: 10 − the units away, doubled under Democracy, +2 when barely content.
    expect(
      improvementPriority(IMPROVEMENT.policeStation, c, facts({ unitsAway: 2 }), {
        ...base,
        government: GOVERNMENT.democracy,
      })?.n,
    ).toBe(4);
  });
});

describe('unit candidates the chooser skips (0x00474edb)', () => {
  it("caps nuclear units and ties fighters to the main human's bombers", () => {
    expect(nuclearAllowed(3, 1)).toBe(true);
    expect(nuclearAllowed(4, 0)).toBe(false);
    expect(nuclearAllowed(0, 2)).toBe(false);
    const counts: Record<string, number> = { '2:28': 1, '2:29': 1 };
    const foreign = {
      mainHuman: 2,
      unitCount: (s: number, ty: number) => counts[`${s}:${ty}`] ?? 0,
      atPeace: () => false,
    };
    const none = () => 0;
    // Their 2 + 2 = 4: three of ours still pass, four do not.
    expect(fighterAllowed(foreign, 1, 27, (ty) => (ty === 27 ? 3 : 0), none)).toBe(true);
    expect(
      fighterAllowed(
        foreign,
        1,
        27,
        (ty) => (ty === 27 ? 2 : 0),
        (ty) => (ty === 30 ? 2 : 0),
      ),
    ).toBe(false);
    // At peace with the human: only while none of the type exist or are being built.
    const peace = { ...foreign, atPeace: () => true };
    expect(fighterAllowed(peace, 1, 27, none, none)).toBe(true);
    expect(fighterAllowed(peace, 1, 27, (ty) => (ty === 27 ? 1 : 0), none)).toBe(false);
    expect(fighterAllowed(undefined, 1, 27, none, none)).toBe(false);
  });
});

describe('diplomat valuation (0x00474edb)', () => {
  const withDiplomat = {
    ...rules,
    units: [...rules.units, unitType('Diplomat', { role: 6, attack: 0 })],
  };
  const diplomat = rules.units.length;
  function scoresFor(w: World, c: City, f: AiBuildFacts, owner: Civ) {
    const scores = new Map<string, number>();
    aiChooseProduction({
      ...env(w, c, f, owner),
      rules: withDiplomat,
      trace: (n, p) => scores.set(`${p.kind}:${p.index}`, n),
    });
    return scores;
  }
  it('values a diplomat at 11 with no target, by the advance gap against one, never with one here', () => {
    const w = new World({ columns: 20, rows: 30, flatEarth: true });
    w.terrain.fill(2);
    const me = civ({ slot: 1, advancesCount: 0 });
    w.civs.push(me);
    const c = city(w, 5);
    c.owner = 1;
    // No civilization with cities on the land mass: 11 × 10 × 3 / 3.
    expect(scoresFor(w, c, facts({ citiesOnContinent: 1 }), me).get(`unit:${diplomat}`)).toBe(110);
    // A rival with cities here and no peace: clamp(10 − (5 − 0), 2, 10) = 5 → 50.
    const rival = civ({ slot: 2, advancesCount: 5 });
    rival.strategy = emptyStrategy();
    rival.strategy.citiesOn[0] = 1;
    w.civs.push(rival);
    expect(scoresFor(w, c, facts({ citiesOnContinent: 1 }), me).get(`unit:${diplomat}`)).toBe(50);
    // A diplomat already on the land mass: not a candidate.
    w.units.push({
      id: 0,
      position: { x: c.position.x, y: c.position.y },
      owner: 1,
      type: diplomat,
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
    });
    expect(scoresFor(w, c, facts({ citiesOnContinent: 1 }), me).has(`unit:${diplomat}`)).toBe(
      false,
    );
  });
});
