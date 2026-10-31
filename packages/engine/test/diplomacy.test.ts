import { describe, expect, it } from 'vitest';
import { emptyStrategy } from '../src/aiStrategy.js';
import {
  atWar,
  canAttack,
  clearTreaty,
  contactSweep,
  diplomacyTurn,
  hasTreaty,
  reviewRelations,
  setTreaty,
  techExchange,
  TREATY,
  treaty,
  wantsWar,
  type DiplomacyContext,
  type DiplomacyEvent,
} from '../src/diplomacy.js';
import { Rng } from '../src/rng.js';
import { GOVERNMENT, type EngineRules } from '../src/rules.js';
import { World, type Civ, type Unit } from '../src/world.js';

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
      flags: {},
    },
  ],
  advances: [
    { name: 'Alphabet', preq1: { kind: 'none' }, preq2: { kind: 'none' }, aiValue: 3 },
    { name: 'Bronze', preq1: { kind: 'none' }, preq2: { kind: 'none' }, aiValue: 2 },
    { name: 'Dead', preq1: { kind: 'never' }, preq2: { kind: 'never' }, aiValue: 9 },
  ],
  improvements: [],
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
    government: GOVERNMENT.monarchy,
    treasury: 100,
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
function unit(w: World, x: number, y: number, owner: number): Unit {
  const u: Unit = {
    id: w.units.length,
    position: { x, y },
    owner,
    type: 0,
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
  w.units.push(u);
  return u;
}
function world(): World {
  const w = new World({ columns: 20, rows: 30, flatEarth: true });
  w.terrain.fill(2);
  w.landmass.fill(1);
  w.civs.push(civ(0), civ(1), civ(2), civ(3));
  for (const c of w.civs) c.strategy = emptyStrategy();
  return w;
}
/** Balanced forces and cities on land mass 1, so neither side is deterred nor dominant. */
function presence(w: World, slot: number): void {
  const st = w.civs.find((c) => c.slot === slot)?.strategy;
  if (!st) return;
  st.attackOn[1] = 4;
  st.unitsOn[1] = 4;
  st.citiesOn[1] = 2;
  st.strengthSum = 8;
}
function ctx(w: World, over: Partial<DiplomacyContext> = {}): DiplomacyContext {
  const rng = new Rng(9);
  return {
    rules,
    turn: 40,
    difficulty: 2,
    isHuman: (s) => w.civs.find((c) => c.slot === s)?.isHuman ?? false,
    inPlay: (s) => s > 0 && s < 4,
    ownsWonder: () => false,
    knows: (s, a) => w.civs.find((c) => c.slot === s)?.knownAdvances[a] === true,
    cityCount: () => 3,
    advancesOf: (s) => w.civs.find((c) => c.slot === s)?.advancesCount ?? 0,
    attackPersonality: () => 0,
    control: (s) => (w.civs.find((c) => c.slot === s)?.isHuman ? 7 : 2),
    tallies: (s) => {
      const st = w.civs.find((c) => c.slot === s)?.strategy;
      return st
        ? {
            unitsOn: st.unitsOn,
            attackOn: st.attackOn,
            citiesOn: st.citiesOn,
            strength: st.strengthSum,
          }
        : undefined;
    },
    grantAdvance: (s, a) => {
      const c = w.civs.find((x) => x.slot === s);
      if (c) {
        c.knownAdvances[a] = true;
        c.advancesCount += 1;
      }
    },
    spaceshipLaunched: () => false,
    mainHuman: null,
    nextInt: (n) => rng.nextInt(n),
    ...over,
  };
}

describe('treaty words', () => {
  it('peace clears war both ways, war clears peace and marks the turn, losing contact ends war', () => {
    const w = world();
    setTreaty(w, 1, 2, TREATY.war);
    expect(hasTreaty(w, 2, 1, TREATY.war)).toBe(true);
    expect(hasTreaty(w, 1, 2, TREATY.warThisTurn)).toBe(true);
    expect(atWar(w, 1, 2)).toBe(true);
    expect(canAttack(w, 1, 2)).toBe(true);
    setTreaty(w, 1, 2, TREATY.peace);
    expect(hasTreaty(w, 2, 1, TREATY.war)).toBe(false);
    expect(atWar(w, 2, 1)).toBe(false);
    expect(canAttack(w, 2, 1)).toBe(false);
    setTreaty(w, 1, 2, TREATY.alliance);
    expect(hasTreaty(w, 1, 2, TREATY.peace)).toBe(true);
    clearTreaty(w, 1, 2, TREATY.peace);
    expect(hasTreaty(w, 1, 2, TREATY.alliance)).toBe(false);
    setTreaty(w, 1, 2, TREATY.war);
    clearTreaty(w, 1, 2, TREATY.contact);
    expect(treaty(w, 1, 2) & TREATY.war).toBe(0);
  });

  it('contact without peace counts as war only when the attitude is hostile', () => {
    const w = world();
    setTreaty(w, 1, 2, TREATY.contact);
    expect(atWar(w, 1, 2)).toBe(false);
    const c1 = w.civs.find((c) => c.slot === 1);
    if (c1) {
      c1.attitudes = new Uint8Array(8);
      c1.attitudes[2] = 60;
    }
    expect(atWar(w, 1, 2)).toBe(true);
    expect(atWar(w, 2, 1)).toBe(false);
  });
});

describe('contact and reviews', () => {
  it('first contact between two evenly matched computer players ends in peace', () => {
    const w = world();
    presence(w, 1);
    presence(w, 2);
    unit(w, 10, 10, 1);
    unit(w, 12, 10, 2);
    const events: DiplomacyEvent[] = [];
    contactSweep(w, 1, ctx(w), events);
    expect(hasTreaty(w, 1, 2, TREATY.contact)).toBe(true);
    expect(hasTreaty(w, 1, 2, TREATY.peace)).toBe(true);
    expect(events.some((e) => e.text.includes('peace'))).toBe(true);
  });

  it('a grudge or a vendetta means war at the review', () => {
    const w = world();
    setTreaty(w, 1, 2, TREATY.contact | TREATY.vendetta);
    expect(wantsWar(w, 1, 2, ctx(w))).toBe(true);
    const events: DiplomacyEvent[] = [];
    reviewRelations(w, 1, 2, ctx(w, { turn: 41 }), events); // (41 + 1 + 2) & 3 === 0
    expect(hasTreaty(w, 1, 2, TREATY.war)).toBe(true);
    expect(hasTreaty(w, 1, 2, TREATY.vendetta)).toBe(false);
    expect(hasTreaty(w, 1, 2, TREATY.grudge)).toBe(true);
    expect(events.some((e) => e.text.includes('declare war'))).toBe(true);
  });

  it('a civilization much stronger on a shared land mass wants war', () => {
    const w = world();
    const s1 = w.civs.find((c) => c.slot === 1)?.strategy;
    const s2 = w.civs.find((c) => c.slot === 2)?.strategy;
    if (s1 && s2) {
      s1.attackOn[1] = 40;
      s1.citiesOn[1] = 4;
      s1.unitsOn[1] = 10;
      s2.attackOn[1] = 2;
      s2.unitsOn[1] = 2;
      s2.citiesOn[1] = 1;
    }
    setTreaty(w, 1, 2, TREATY.contact);
    expect(wantsWar(w, 1, 2, ctx(w))).toBe(true);
    expect(wantsWar(w, 2, 1, ctx(w))).toBe(false);
  });

  it('a war without a grudge peters out at the sixteen-turn mark', () => {
    const w = world();
    setTreaty(w, 1, 2, TREATY.contact | TREATY.war);
    const events: DiplomacyEvent[] = [];
    diplomacyTurn(w, 1, ctx(w, { turn: 48 }), events);
    expect(hasTreaty(w, 1, 2, TREATY.contact)).toBe(false);
    expect(hasTreaty(w, 1, 2, TREATY.war)).toBe(false);
    expect(events.some((e) => e.text.includes('peters out'))).toBe(true);
  });

  it('allies swap advances', () => {
    const w = world();
    const c1 = w.civs.find((c) => c.slot === 1);
    const c2 = w.civs.find((c) => c.slot === 2);
    if (c1 && c2) {
      c1.knownAdvances[0] = true;
      c1.advancesCount = 1;
      c2.knownAdvances[1] = true;
      c2.advancesCount = 1;
    }
    setTreaty(w, 1, 2, TREATY.alliance);
    expect(techExchange(w, 1, 2, ctx(w))).toBe(true);
    expect(c1?.knownAdvances[1]).toBe(true);
    expect(c2?.knownAdvances[0]).toBe(true);
  });

  it("a human at war accepts a computer player's peace by default", () => {
    const w = world();
    presence(w, 1);
    presence(w, 2);
    presence(w, 3);
    const h = w.civs.find((c) => c.slot === 3);
    if (h) h.isHuman = true;
    setTreaty(w, 1, 3, TREATY.contact | TREATY.war);
    const events: DiplomacyEvent[] = [];
    reviewRelations(w, 1, 3, ctx(w, { turn: 40 }), events); // (40 + 1 + 3) & 3 === 0
    expect(hasTreaty(w, 1, 3, TREATY.peace)).toBe(true);
    const refused: DiplomacyEvent[] = [];
    setTreaty(w, 2, 3, TREATY.contact | TREATY.war);
    reviewRelations(w, 2, 3, ctx(w, { turn: 39, humanAccepts: () => false }), refused); // (39 + 2 + 3) & 3 === 0
    expect(hasTreaty(w, 2, 3, TREATY.war)).toBe(true);
  });
});
