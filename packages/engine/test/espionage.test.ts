import { describe, expect, it } from 'vitest';
import { hasTreaty, TREATY } from '../src/diplomacy.js';
import {
  aiEspionageChoice,
  bribeCost,
  bribeUnit,
  inciteCost,
  performEspionage,
  SPY_TYPE,
  type EspionageContext,
} from '../src/espionage.js';
import { Rng } from '../src/rng.js';
import type { EngineRules } from '../src/rules.js';
import { CITY_CENTRE_INDEX, World, type City, type Civ, type Unit } from '../src/world.js';

const units = Array.from({ length: 50 }, (_, i) => ({
  name: `u${i}`,
  domain: 0,
  move: 1,
  range: 0,
  attack: 1,
  defence: 1,
  hitPointsTens: 1,
  firepower: 1,
  costRows: 3,
  role: 0,
  flags: {},
}));
function setType(i: number, over: Partial<(typeof units)[number]>): void {
  const base = units[i];
  if (base) units[i] = { ...base, ...over };
}
setType(46, { name: 'Diplomat', role: 6, attack: 0 });
setType(47, { name: 'Spy', role: 6, attack: 0 });
setType(1, { name: 'Settlers', role: 5, costRows: 4 });
const rules = {
  cosmic: { roadMoveMultiplier: 3 },
  terrain: Array.from({ length: 11 }, () => ({ moveCost: 1, defenceHalves: 2 })),
  units,
  advances: Array.from({ length: 100 }, (_, i) => ({
    name: `a${i}`,
    preq1: { kind: 'none' },
    preq2: { kind: 'none' },
  })),
  improvements: Array.from({ length: 67 }, (_, i) => ({ name: `i${i}`, costRows: 4, upkeep: 1 })),
} as unknown as EngineRules;

function civ(slot: number, isHuman = false): Civ {
  return {
    slot,
    tribe: 0,
    name: `Civ${slot}`,
    adjective: `C${slot}`,
    leader: 'L',
    cityStyle: 0,
    epoch: 0,
    colour: slot,
    government: 2,
    treasury: 500,
    isHuman,
    inPlay: true,
    scienceStored: 0,
    researching: null,
    advancesCount: 0,
    futureTechs: 0,
    scienceRate: 5,
    taxRate: 3,
    knownAdvances: Array<boolean>(100).fill(false),
    freeAdvancePending: false,
  };
}
function city(world: World, id: number, x: number, y: number, owner: number, size = 5): City {
  const c: City = {
    id,
    position: { x, y },
    owner,
    name: `C${id}`,
    size,
    improvements: Array<boolean>(67).fill(false),
    foodStored: 0,
    shieldsStored: 20,
    worked: 1 << CITY_CENTRE_INDEX,
    specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
    production: { kind: 'unit', index: 0 },
    inDisorder: false,
    celebrating: false,
    tradeRoutes: [],
  };
  world.cities.push(c);
  return c;
}
function unit(world: World, type: number, x: number, y: number, owner: number): Unit {
  const u: Unit = {
    id: world.units.length,
    position: { x, y },
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
  world.units.push(u);
  return u;
}
function world(): World {
  const w = new World({ columns: 20, rows: 20, flatEarth: true });
  w.terrain.fill(2);
  w.landmass.fill(1);
  w.civs.push(civ(0), civ(1), civ(2));
  return w;
}
function ctx(w: World, over: Partial<EspionageContext> = {}): EspionageContext {
  return {
    turn: 50,
    difficulty: 2,
    rng: new Rng(4),
    isHuman: (s) => w.civs.find((c) => c.slot === s)?.isHuman ?? false,
    knows: (s, a) => w.civs.find((c) => c.slot === s)?.knownAdvances[a] === true,
    ownsWonder: () => false,
    wonderBuilt: () => false,
    researchable: () => true,
    ...over,
  };
}

describe('espionage', () => {
  it('a diplomat steals an advance and is spent; the victims resent it', () => {
    const w = world();
    const target = city(w, 0, 10, 10, 2);
    const them = w.civs[2];
    if (them) {
      them.knownAdvances[5] = true;
      them.advancesCount = 1;
    }
    const d = unit(w, 46, 9, 9, 1);
    const events = performEspionage(w, rules, d, target, 'steal', ctx(w));
    expect(w.civs[1]?.knownAdvances[5]).toBe(true);
    expect(target.techStolen).toBe(true);
    expect(w.units).not.toContain(d);
    expect(events.some((e) => e.text.includes('stolen'))).toBe(true);
    expect(w.civs[2]?.attitudes?.[1]).toBeGreaterThanOrEqual(20);
    // A second theft is hard: a diplomat is always caught.
    const d2 = unit(w, 46, 9, 9, 1);
    if (them) them.knownAdvances[6] = true;
    performEspionage(w, rules, d2, target, 'steal', ctx(w));
    expect(w.civs[1]?.knownAdvances[6]).toBe(false);
    expect(w.units).not.toContain(d2);
  });

  it('an embassy, sabotage and poison follow the rules; the computer picks by treaty', () => {
    const w = world();
    const target = city(w, 0, 10, 10, 2, 4);
    target.improvements[4] = true; // a temple
    const d = unit(w, 46, 9, 9, 1);
    performEspionage(w, rules, d, target, 'embassy', ctx(w));
    expect(hasTreaty(w, 1, 2, TREATY.embassy)).toBe(true);
    const s = unit(w, SPY_TYPE, 9, 9, 1);
    const ev = performEspionage(w, rules, s, target, 'sabotage', ctx(w, { rng: new Rng(9) }));
    expect(ev.some((e) => e.text.includes('destroyed'))).toBe(true);
    expect(target.improvements[4] === false || target.shieldsStored === 0).toBe(true);
    const s2 = unit(w, SPY_TYPE, 9, 9, 1);
    performEspionage(w, rules, s2, target, 'poison', ctx(w));
    expect(target.size).toBe(3);
    expect(aiEspionageChoice(w, unit(w, 46, 9, 9, 1), target, ctx(w))).toBe('steal');
    target.techStolen = true;
    expect(aiEspionageChoice(w, unit(w, 46, 9, 9, 1), target, ctx(w))).toBe('sabotage');
  });

  it('inciting a revolt costs by size, treasury and distance from the capital, then flips the city', () => {
    const w = world();
    const capital = city(w, 0, 2, 2, 2, 6);
    capital.improvements[1] = true;
    const target = city(w, 1, 12, 12, 2, 4);
    const them = w.civs[2];
    if (them) them.treasury = 200;
    const d = unit(w, 46, 11, 11, 1);
    // Nine squares from the capital: 4 × (200 + 1000) / 12 = 400, halved while the city is empty.
    expect(inciteCost(w, d, target)).toBe(200);
    const me = w.civs[1];
    if (me) me.treasury = 500;
    const guard = unit(w, 0, 12, 12, 2); // a garrison: the full 400 now
    expect(inciteCost(w, d, target)).toBe(400);
    const ev = performEspionage(w, rules, d, target, 'incite', ctx(w), 1);
    expect(ev.some((e) => e.text.includes('revolt'))).toBe(true);
    expect(target.owner).toBe(1);
    expect(guard.owner).toBe(1);
    // 400 paid; the capture routine the original also runs adds its plunder from the loser.
    expect(me?.treasury).toBeGreaterThanOrEqual(100);
    expect(me?.treasury).toBeLessThan(500);
  });

  it('a lone unit can be bribed for its cost unless its owner is a Democracy', () => {
    const w = world();
    const capital = city(w, 0, 2, 2, 2, 6);
    capital.improvements[1] = true;
    const them = w.civs[2];
    if (them) them.treasury = 250;
    const t = unit(w, 0, 8, 8, 2); // distance 6: 3 × (250 + 750) / 8 = 375, halved for a non-settler = 187
    expect(bribeCost(w, rules, t, 1)).toBe(187);
    const d = unit(w, 46, 7, 7, 1);
    const me = w.civs[1];
    if (me) me.treasury = 300;
    const ev = bribeUnit(w, rules, d, t, ctx(w, { isHuman: () => true }));
    expect(ev.some((e) => e.text.includes('deserts'))).toBe(true);
    expect(t.owner).toBe(1);
    expect(me?.treasury).toBe(113);
    if (them) them.government = 6;
    const t2 = unit(w, 0, 14, 14, 2);
    expect(bribeCost(w, rules, t2, 1)).toBeNull();
  });
});
