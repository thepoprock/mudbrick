import { describe, expect, it } from 'vitest';
import {
  addScience,
  aiRates,
  cityScienceToCiv,
  researchCost,
  reachableAdvanceCount,
  type ResearchContext,
} from '../src/research.js';
import type { EngineRules } from '../src/rules.js';
import type { Civ } from '../src/world.js';

function ctx(over: Partial<ResearchContext> = {}): ResearchContext {
  return {
    isHuman: true,
    difficulty: 2,
    turn: 1,
    leaderAdvances: 0,
    reachableAdvances: 89,
    techParadigm: 10,
    ...over,
  };
}

function civ(over: Partial<Civ> = {}): Civ {
  return {
    slot: 1,
    tribe: 0,
    name: 'Testers',
    adjective: 'Test',
    leader: 'Tester',
    cityStyle: 0,
    epoch: 0,
    colour: 1,
    government: 1,
    treasury: 50,
    isHuman: true,
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

describe('research cost (verified)', () => {
  it('human at Prince: first and second advances cost 10, the third 18', () => {
    expect(researchCost(0, ctx())).toBe(10);
    expect(researchCost(1, ctx({ leaderAdvances: 1 }))).toBe(10);
    expect(researchCost(2, ctx({ leaderAdvances: 2 }))).toBe(18);
  });
  it('adds the late-game term and the three-quarter bonus from 20 advances', () => {
    expect(researchCost(20, ctx({ leaderAdvances: 20, turn: 100 }))).toBe(420);
  });
  it('AI at Deity catches up on a human far ahead', () => {
    expect(
      researchCost(10, ctx({ isHuman: false, difficulty: 5, leaderAdvances: 15, turn: 200 })),
    ).toBe(80);
  });
  it('applies the tech paradigm, the ruleset size and the option flags', () => {
    expect(researchCost(5, ctx({ leaderAdvances: 5, techParadigm: 20 }))).toBe(85);
    expect(researchCost(5, ctx({ leaderAdvances: 5, reachableAdvances: 60 }))).toBe(55);
    expect(researchCost(5, ctx({ leaderAdvances: 5, largeMap: true }))).toBe(50);
    expect(researchCost(5, ctx({ leaderAdvances: 5, smallMap: true }))).toBe(30);
    expect(
      researchCost(5, ctx({ leaderAdvances: 5, scenario: { techParadigm: 20, fixedCost: true } })),
    ).toBe(85);
  });
  it('clamps absurd costs to 32000', () => {
    expect(researchCost(400, ctx())).toBe(32000);
  });
  it('counts reachable advances from the rules', () => {
    const rules = {
      advances: [
        { name: 'a', preq1: { kind: 'none' }, preq2: { kind: 'none' }, epoch: 0, category: 0 },
        { name: 'b', preq1: { kind: 'never' }, preq2: { kind: 'never' }, epoch: 0, category: 0 },
      ],
    } as unknown as EngineRules;
    expect(reachableAdvanceCount(rules)).toBe(1);
  });
});

describe('science income and discovery (verified)', () => {
  const rules = {
    improvements: Array.from({ length: 67 }, (_, i) => ({
      name: `i${i}`,
      costRows: 4,
      upkeep: 1,
      preq:
        i >= 35 && i <= 37
          ? { kind: 'advance' as const, index: 70 + i }
          : { kind: 'none' as const },
    })),
  } as unknown as EngineRules;
  it('doubles for a Chieftain human on a known advance and discards under Anarchy', () => {
    const c = civ({ researching: 7 });
    const first = Array<number>(100).fill(0);
    expect(
      cityScienceToCiv(rules, c, 5, { isHuman: true, difficulty: 0, firstDiscoveredBy: first }),
    ).toBe(5);
    first[7] = 3;
    expect(
      cityScienceToCiv(rules, c, 5, { isHuman: true, difficulty: 0, firstDiscoveredBy: first }),
    ).toBe(10);
    expect(
      cityScienceToCiv(rules, c, 5, { isHuman: true, difficulty: 1, firstDiscoveredBy: first }),
    ).toBe(5);
    c.government = 0;
    expect(
      cityScienceToCiv(rules, c, 5, { isHuman: true, difficulty: 0, firstDiscoveredBy: first }),
    ).toBe(0);
  });
  it('doubles for an AI in the spaceship race that lacks a part prerequisite', () => {
    const c = civ({ isHuman: false, researching: 7 });
    const base = { isHuman: false, difficulty: 3, firstDiscoveredBy: [] as number[] };
    expect(cityScienceToCiv(rules, c, 5, base)).toBe(5);
    expect(cityScienceToCiv(rules, c, 5, { ...base, aiSpaceRace: true })).toBe(10);
    c.knownAdvances[105] = c.knownAdvances[106] = c.knownAdvances[107] = true;
    expect(cityScienceToCiv(rules, c, 5, { ...base, aiSpaceRace: true })).toBe(5);
  });
  it('discovers at the cost, resets beakers, and asks for a target when none is set', () => {
    const c = civ({ researching: 12, scienceStored: 6 });
    expect(addScience(c, 3, () => 10)).toEqual([]);
    const ev = addScience(c, 1, () => 10);
    expect(ev).toEqual([{ kind: 'discovered', advance: 12, free: false }]);
    expect(c.knownAdvances[12]).toBe(true);
    expect(c.advancesCount).toBe(1);
    expect(c.scienceStored).toBe(0);
    expect(c.researching).toBeNull();
    expect(addScience(c, 4, () => 10)).toEqual([{ kind: 'choose-research' }]);
    expect(c.scienceStored).toBe(4);
  });
  it('grants the pending free advance after a discovery', () => {
    const c = civ({ researching: 60, scienceStored: 9, freeAdvancePending: true });
    const ev = addScience(c, 1, () => 10);
    expect(ev.map((e) => e.kind)).toEqual(['discovered', 'choose-research']);
    expect(c.freeAdvancePending).toBe(false);
  });
});

describe('AI rate policy (verified)', () => {
  const base = {
    turn: 4,
    anyDisorder: false,
    anyLargeContentCity: false,
    civilize: 1,
    expanding: true,
    knowsAllSpaceAdvances: false,
  };
  it('splits a Despot treasury into science with a cap of 60 %', () => {
    const c = civ({ isHuman: false, government: 1, treasury: 150, scienceRate: 5, taxRate: 3 });
    expect(aiRates(c, base)).toEqual({ science: 6, tax: 2, luxuries: 2 });
  });
  it('a rich Democracy pours everything into science up to the luxury floor', () => {
    const c = civ({ isHuman: false, government: 6, treasury: 9000, scienceRate: 3, taxRate: 3 });
    expect(
      aiRates(c, { ...base, turn: 5, anyDisorder: true, civilize: 0, expanding: false }),
    ).toEqual({ science: 6, tax: 0, luxuries: 4 });
  });
  it('eases luxuries every fourth quiet turn and stops science when the spaceship tree is complete', () => {
    const c = civ({ isHuman: false, government: 2, treasury: 10, scienceRate: 4, taxRate: 3 });
    expect(aiRates(c, { ...base, turn: 8, civilize: 0 })).toEqual({
      science: 4,
      tax: 4,
      luxuries: 2,
    });
    expect(aiRates(c, { ...base, turn: 8, civilize: 0, knowsAllSpaceAdvances: true })).toEqual({
      science: 0,
      tax: 8,
      luxuries: 2,
    });
  });
});
