import { describe, expect, it } from 'vitest';
import { rawYields, shieldTotals, tradeSplit, unitSupport } from '../src/city.js';
import { removeCity } from '../src/fertility.js';
import { adjustAttitude, hasTreaty, setTreaty, TREATY } from '../src/diplomacy.js';
import {
  cheatCreateUnit,
  cheatDestroyUnits,
  cheatEditCity,
  cheatKillCivilization,
  cheatSetMoney,
} from '../src/cheats.js';
import { Game } from '../src/game.js';
import { tryMove } from '../src/movement.js';
import { longMoveCount } from '../src/turnStart.js';
import { researchChoices, researchableAdvances } from '../src/outcome.js';
import { applyCityMood, researchableAdvances } from '../src/outcome.js';
import { Rng } from '../src/rng.js';
import { GOVERNMENT, IMPROVEMENT, type EngineRules } from '../src/rules.js';
import { CITY_CENTRE_INDEX, World, type City, type Civ, type Unit } from '../src/world.js';

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
const civ2 = (slot: number) => civ({ slot, name: `C${slot}` });
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

  it('a citizen spent on Settlers takes the spare specialist with it in the same turn', () => {
    const worked = (1 << CITY_CENTRE_INDEX) | 1 | 2 | 4;
    const { world, city, civ, game } = setup({
      size: 4,
      worked,
      specialists: { entertainers: 1, taxCollectors: 0, scientists: 0 },
      production: { kind: 'unit', index: 0 },
      shieldsStored: 200,
    });
    civ.isHuman = true;
    world.revealRadius(city.position.x, city.position.y, city.owner);
    game.processCity(city);
    expect(city.size).toBe(3);
    expect(city.specialists.entertainers).toBe(0);
    expect(city.worked).toBe(worked);
  });

  it('play stops after a human moves in its slot, and goes on to the next human', () => {
    const { game, world, civ } = setup();
    civ.isHuman = true;
    const other = { ...civ, slot: 2, name: 'Second', isHuman: true };
    world.civs.push(other);
    world.units.push({ ...(world.units[0] as Unit), id: 1, owner: 2, homeCity: null });
    game.state.nextSlot = 0;
    game.playUntilHuman();
    expect(game.state.movingHuman).toBe(1);
    expect(game.state.nextSlot).toBe(2);
    expect(game.state.turn).toBe(10);
    game.playUntilHuman();
    expect(game.state.movingHuman).toBe(2);
    game.playUntilHuman();
    expect(game.state.movingHuman).toBe(1);
    expect(game.state.turn).toBe(11);
  });

  it('above Chieftain the research list hides a third of its choices, never the first', () => {
    const civ = setup().world.civs[0];
    if (!civ) throw new Error('no civ');
    civ.advancesCount = 1;
    const all = researchableAdvances(rules, civ);
    const hard = researchChoices(rules, civ, 2);
    expect(researchChoices(rules, civ, 0)).toEqual(all);
    expect(hard[0]).toBe(all[0]);
    expect(hard.slice(1).every((a) => (a - 1) % 3 !== 0)).toBe(true);
  });

  it('power rank belongs to the strongest civilization, human or not', () => {
    const { world, game } = setup();
    const human = world.civs[0];
    const rival = world.civs[1];
    if (!human || !rival) throw new Error('no civs');
    human.isHuman = true;
    human.treasury = 0;
    rival.treasury = 30000;
    expect(game.powerRank(rival.slot)).toBe(7);
    expect(game.powerRank(human.slot)).toBeLessThan(7);
  });

  it('an ally under attack calls on a human, and refusal can end the alliance', () => {
    const { world, game } = setup();
    const ally = world.civs[1];
    if (!ally) throw new Error('no civs');
    const human = { ...ally, slot: 4, name: 'Us' };
    world.civs.push(human, { ...ally, slot: 3, name: 'Foe' });
    human.isHuman = true;
    ally.isHuman = false;
    game.wantsTalks = true;
    setTreaty(world, human.slot, ally.slot, TREATY.alliance);
    setTreaty(world, ally.slot, human.slot, TREATY.alliance);
    game.attacked(3, ally.slot);
    game.attacked(3, ally.slot);
    expect(game.allyCalls).toHaveLength(1);
    const call = game.allyCalls[0];
    if (!call) throw new Error('no call');
    adjustAttitude(world, ally.slot, human.slot, 60);
    game.answerAllyCall(call, false);
    expect(hasTreaty(world, human.slot, ally.slot, TREATY.alliance)).toBe(false);
  });

  it('a hurt unit moving into an ally stays out, is repaired and ends its move', () => {
    const { world, city } = setup();
    const ally = world.civs[1];
    if (!ally) throw new Error('no civs');
    const friend = { ...ally, slot: 5, name: 'Friend' };
    world.civs.push(friend);
    (ally.treaties ??= new Uint32Array(8))[5] = TREATY.alliance | TREATY.contact;
    city.owner = 5;
    const from = world.neighbours(city.position.x, city.position.y).find((p) => p);
    if (!from) throw new Error('no square');
    const u: Unit = {
      id: 50,
      position: { ...from },
      owner: ally.slot,
      type: 0,
      veteran: false,
      hitPointsLost: 9,
      movesSpent: 0,
      fortified: false,
      homeCity: null,
      order: null,
      workCounter: 0,
      gotoTarget: null,
      lastDirection: null,
      gotoSteps: 0,
    };
    world.units.push(u);
    const r = tryMove(world, rules, new Rng(1), u, city.position, {});
    expect(r.kind).toBe('repaired');
    expect(u.position).toEqual(from);
    expect(u.hitPointsLost).toBeLessThan(9);
  });

  it('the go-to counter adds one a step and fifteen more for turning back', () => {
    expect(longMoveCount(0, false)).toBe(1);
    expect(longMoveCount(1, true)).toBe(17);
  });

  it('a dead city takes its homed units with it, and routes to it go', () => {
    const { world, city, rulesFor } = { ...setup(), rulesFor: rules };
    const other = {
      ...city,
      id: 5,
      position: { x: 2, y: 2 },
      tradeRoutes: [{ partner: 0, food: false, commodity: 1 }],
    };
    world.cities.push(other);
    removeCity(world, rulesFor, city);
    expect(world.cities).toEqual([other]);
    expect(other.tradeRoutes).toEqual([]);
    expect(world.units).toEqual([]);
  });

  it("Darwin's Voyage completes the research target and the next one", () => {
    const { city, civ, game } = setup({
      production: { kind: 'improvement', index: IMPROVEMENT.darwins },
    });
    civ.researching = 0;
    civ.scienceStored = 40;
    city.improvements[0] = false;
    city.shieldsStored = 999;
    game.processCity(city);
    expect(civ.knownAdvances[0]).toBe(true);
    expect(civ.scienceStored).toBeLessThan(40);
    expect(civ.advancesCount).toBe(2);
  });

  it('the Eiffel Tower forgives once; the Manhattan Project halves everyone within 0 to 6', () => {
    const { city, civ, game, world } = setup({
      production: { kind: 'improvement', index: IMPROVEMENT.eiffelTower },
      shieldsStored: 999,
    });
    world.civs.push(civ2(2));
    civ.reputation = 8;
    game.processCity(city);
    expect(civ.reputation).toBe(4);
    expect(civ.eiffelApplied).toBe(true);
    civ.reputation = 7;
    city.production = { kind: 'improvement', index: IMPROVEMENT.manhattanProject };
    city.shieldsStored = 999;
    game.processCity(city);
    expect(civ.reputation).toBe(4);
  });

  it('the Apollo Program shows the map to everyone', () => {
    const { city, game, world } = setup({
      production: { kind: 'improvement', index: IMPROVEMENT.apolloProgram },
      shieldsStored: 999,
    });
    expect(world.isSeen(0, 0, 3)).toBe(false);
    game.processCity(city);
    expect(world.isSeen(0, 0, 3)).toBe(true);
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

  it('gives every citizen a square before the city turn runs', () => {
    const { city, game } = setup({ size: 2, worked: 1 << CITY_CENTRE_INDEX });
    game.endTurn();
    let working = 0;
    for (let i = 0; i < CITY_CENTRE_INDEX; i++) if ((city.worked >> i) & 1) working++;
    expect(working).toBe(2);
  });

  it('a civilization that has held a city dies with its last one; one that never did lingers', () => {
    const { world, game, civ: c } = setup({}, { isHuman: false });
    c.hadCity = true;
    world.cities.length = 0;
    game.endTurn();
    expect(c.inPlay).toBe(false);
    expect(world.units.some((u) => u.owner === 1)).toBe(false);
    const fresh = setup({}, { isHuman: false });
    fresh.world.cities.length = 0;
    fresh.civ.hadCity = false;
    fresh.game.endTurn();
    expect(fresh.civ.inPlay).toBe(true);
  });

  it('runs the AI rate policy for computer players', () => {
    const { game, civ } = setup({}, { isHuman: false });
    const events = game.endTurn();
    expect(events.some((e) => e.event.kind === 'rates')).toBe(true);
    expect(civ.scienceRate + civ.taxRate).toBeLessThanOrEqual(10);
  });
});

describe('calls for help (0x0051520a)', () => {
  function table() {
    const { world, game } = setup();
    world.civs.push(
      civ({ slot: 2, name: 'Caller', isHuman: false, inPlay: true, treasury: 450 }),
      civ({ slot: 3, name: 'Foe', isHuman: false, inPlay: true }),
      civ({ slot: 4, name: 'Player', isHuman: true, inPlay: true, treasury: 10 }),
    );
    const [caller, foe, human] = [2, 3, 4].map((s) => game.civ(s));
    if (!caller || !foe || !human) throw new Error('no civs');
    caller.knownAdvances[7] = true;
    caller.strategy = { strengthSum: 10 } as NonNullable<Civ['strategy']>;
    foe.strategy = { strengthSum: 30 } as NonNullable<Civ['strategy']>;
    setTreaty(world, 2, 3, TREATY.contact | TREATY.attacked);
    setTreaty(world, 4, 2, TREATY.contact);
    setTreaty(world, 4, 3, TREATY.contact);
    game.state.turn = 8; // 2 × 4
    game.wantsTalks = true;
    return { world, game, caller, foe, human };
  }

  it('only speaks on its own turn of the 32', () => {
    const { game } = table();
    game.state.turn = 9;
    game.askForHelp(2, 4);
    expect(game.helpCalls).toHaveLength(0);
  });

  it('badly outmatched, it offers gold; acceptance is an alliance and a war', () => {
    const { world, game, caller, human } = table();
    game.askForHelp(2, 4);
    const call = game.helpCalls[0];
    expect(call).toMatchObject({ kind: 'help', foe: 3, gold: 200 });
    if (!call) throw new Error('no call');
    game.answerHelpCall(call, true);
    expect(hasTreaty(world, 4, 2, TREATY.alliance)).toBe(true);
    expect(hasTreaty(world, 4, 3, TREATY.war)).toBe(true);
    expect(human.treasury).toBe(210);
    expect(caller.treasury).toBe(250);
  });

  it('refusal keeps the peace and only moves the last talk', () => {
    const { world, game, human } = table();
    game.askForHelp(2, 4);
    const call = game.helpCalls[0];
    if (!call) throw new Error('no call');
    game.answerHelpCall(call, false);
    expect(hasTreaty(world, 4, 3, TREATY.war)).toBe(false);
    expect(human.lastWarTurns?.[2]).toBe(-1);
  });
});

describe('computer sales (0x00474edb)', () => {
  it('sells what a wonder has made redundant', () => {
    const { world, city, game } = setup();
    const civ = world.civs.find((c) => c.slot === 1);
    if (!civ) throw new Error('no civ');
    civ.isHuman = false;
    city.improvements[IMPROVEMENT.granary] = true;
    city.improvements[39] = true;
    city.wonderCity = true;
    const before = civ.treasury;
    game.aiChooseProduction(city);
    expect(city.improvements[IMPROVEMENT.granary]).toBe(false);
    expect(civ.treasury).toBeGreaterThan(before);
  });
});

describe('late catch-up for computers (0x004b3b24)', () => {
  it('only from turn 200, at difficulty 2 or above, with a human strongest', () => {
    const { world, game } = setup();
    game.state.turn = 150;
    game.state.difficulty = 3;
    expect(game.rowsRelief()).toBe(0);
    game.state.turn = 220;
    const human = world.civs.find((c) => c.slot === 1);
    if (!human) throw new Error('no civ');
    human.isHuman = true;
    human.advancesCount = 90;
    expect(game.rowsRelief()).toBe(2);
    game.state.difficulty = 1;
    expect(game.rowsRelief()).toBe(0);
  });
});

describe('multiplayer options', () => {
  it('moves the computers first and closes the round with the last human', () => {
    const { world, game, civ } = setup();
    civ.isHuman = true;
    const other: Civ = { ...civ, slot: 3, knownAdvances: [...civ.knownAdvances] };
    world.civs.push(other);
    world.units.push({ ...(world.units[0] as Unit), id: 90, owner: 3, homeCity: null });
    game.state.simultaneous = true;
    game.state.nextSlot = 0;
    const start = game.state.turn;
    game.playUntilHuman();
    expect(game.state.awaitingMoves?.includes(civ.slot)).toBe(true);
    expect(game.state.awaitingMoves?.includes(3)).toBe(true);
    expect(game.playUntilHuman()).toEqual([]); // nothing runs while humans are moving
    game.finishMoves(civ.slot);
    expect(game.state.turn).toBe(start);
    game.finishMoves(3);
    expect(game.state.turn).toBe(start + 1);
    expect(game.state.awaitingMoves).toEqual([]);
  });

  it('doubles ground moves and terrain yields', () => {
    const { world, game, city } = setup();
    const doubled = new Game(world, rules, new Rng(1), { ...game.state, doubleMoves: true });
    expect(doubled.rules.units[0]?.move).toBe((rules.units[0]?.move ?? 0) * 2);
    const plain = rawYields(world, rules, city, game.cityContext(city));
    game.state.doubleProduction = true;
    const rich = rawYields(world, rules, city, game.cityContext(city));
    expect(rich.food).toBeGreaterThan(plain.food);
  });

  it('a retiring human gives way to the computer, or takes the civilization along', () => {
    const { world, game, civ } = setup();
    civ.isHuman = true;
    game.retireHuman(civ.slot);
    expect(civ.isHuman).toBe(false);
    expect(civ.inPlay).toBe(true);
    civ.isHuman = true;
    game.state.killOnRetirement = true;
    game.retireHuman(civ.slot);
    expect(civ.inPlay).toBe(false);
    expect(world.cities.filter((c) => c.owner === civ.slot)).toEqual([]);
  });

  it('introduces the humans at the start', () => {
    const { world, game, civ } = setup();
    civ.isHuman = true;
    const other: Civ = { ...civ, slot: 3, knownAdvances: [...civ.knownAdvances] };
    world.civs.push(other);
    game.state.showHumanStarts = true;
    world.revealSquare(4, 4, civ.slot);
    game.introduceHumans();
    expect(world.isSeen(4, 4, 3)).toBe(true);
    expect(hasTreaty(world, civ.slot, 3, TREATY.contact)).toBe(true);
  });
});

describe('parley between humans', () => {
  it('moves gold, gives advances and maps, and makes the treaty', () => {
    const { world, game, civ } = setup();
    civ.isHuman = true;
    civ.treasury = 100;
    const other: Civ = { ...civ, slot: 3, treasury: 50, knownAdvances: Array(100).fill(false) };
    world.civs.push(other);
    civ.knownAdvances[7] = true;
    world.revealSquare(4, 4, civ.slot);
    const offer = game.offerParley(
      civ.slot,
      3,
      [{ kind: 'treaty', level: 'peace' }, { kind: 'advances', list: [7] }, { kind: 'map' }],
      [{ kind: 'gold', amount: 30 }],
    );
    expect(game.state.parleyOffers).toHaveLength(1);
    game.answerParley(offer.id, true);
    expect(game.state.parleyOffers).toEqual([]);
    expect(civ.treasury).toBe(130);
    expect(other.treasury).toBe(20);
    expect(other.knownAdvances[7]).toBe(true);
    expect(world.isSeen(4, 4, 3)).toBe(true);
    expect(hasTreaty(world, civ.slot, 3, TREATY.peace)).toBe(true);
  });

  it('hands a city over whole, and a refused offer does nothing', () => {
    const { world, game, city, civ } = setup();
    civ.isHuman = true;
    const other: Civ = { ...civ, slot: 3, knownAdvances: [...civ.knownAdvances] };
    world.civs.push(other);
    const refused = game.offerParley(civ.slot, 3, [{ kind: 'cities', ids: [city.id] }], []);
    game.answerParley(refused.id, false);
    expect(city.owner).toBe(civ.slot);
    const size = city.size;
    const gold = civ.treasury;
    const taken = game.offerParley(civ.slot, 3, [{ kind: 'cities', ids: [city.id] }], []);
    game.answerParley(taken.id, true);
    expect(city.owner).toBe(3);
    expect(city.size).toBe(size);
    expect(civ.treasury).toBe(gold);
  });
});

describe('open games and cheats', () => {
  it('lets a new player take over a computer civilization only in an open game', () => {
    const { game, civ } = setup();
    civ.isHuman = false;
    expect(game.joinHuman(civ.slot)).toBe(false);
    game.state.openGame = true;
    expect(game.joinHuman(civ.slot)).toBe(true);
    expect(civ.isHuman).toBe(true);
    expect(game.joinHuman(civ.slot)).toBe(false);
  });

  it('applies the cheat menu to the records', () => {
    const { world, game, civ, city } = setup();
    const u = cheatCreateUnit(game, 0, civ.slot, 6, 6);
    expect(world.unitsAt(6, 6)).toContain(u);
    cheatDestroyUnits(game, 6, 6);
    expect(world.unitsAt(6, 6)).toHaveLength(0);
    cheatSetMoney(game, civ.slot, 99999);
    expect(civ.treasury).toBe(30000);
    cheatEditCity(city, { size: 12 });
    expect(city.size).toBe(12);
    cheatKillCivilization(game, civ.slot);
    expect(civ.inPlay).toBe(false);
  });
});
