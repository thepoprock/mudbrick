import { describe, expect, it } from 'vitest';
import { TREATY, setTreaty, hasTreaty } from '../src/diplomacy.js';
import {
  aiPickGovernment,
  anarchyTurn,
  cityGovernmentScores,
  civGovernmentScores,
  governmentAllowed,
  governmentScoresOf,
  resetGovernmentScores,
  startRevolution,
  type GovernmentEvent,
} from '../src/government.js';
import { GOVERNMENT, type EngineRules } from '../src/rules.js';
import { CITY_CENTRE_INDEX, World, type City, type Civ } from '../src/world.js';

const rules = {
  cosmic: {
    monarchyFreeUnits: 3,
    communismFreeUnits: 3,
    fundamentalismFreeUnits: 10,
  },
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
    government: GOVERNMENT.despotism,
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
function city(size: number): City {
  return {
    id: 0,
    position: { x: 2, y: 2 },
    owner: 1,
    name: 'A',
    size,
    improvements: Array<boolean>(67).fill(false),
    foodStored: 0,
    shieldsStored: 0,
    worked: 1 << CITY_CENTRE_INDEX,
    specialists: { entertainers: 0, taxCollectors: 0, scientists: 0 },
    production: { kind: 'unit', index: 0 },
    inDisorder: false,
    celebrating: false,
    tradeRoutes: [],
  };
}

describe('governments', () => {
  it('needs the advance or the Statue of Liberty', () => {
    const knows = (a: number) => a === 54;
    expect(governmentAllowed(1, knows, false)).toBe(true);
    expect(governmentAllowed(2, knows, false)).toBe(true); // Monarchy
    expect(governmentAllowed(6, knows, false)).toBe(false); // Democracy
    expect(governmentAllowed(6, knows, true)).toBe(true);
    expect(governmentAllowed(4, () => true, false, false)).toBe(false);
  });

  it('cities charge each government its unit support and Republic and Democracy their weariness', () => {
    const c = civ(1);
    resetGovernmentScores(c);
    cityGovernmentScores(
      rules,
      c,
      city(6),
      { foodProduced: 10, foodEaten: 12, unitsSupported: 5, unitsAway: 2 },
      () => false,
      { attack: 1, civilize: 0 },
      false,
    );
    const s = governmentScoresOf(c);
    expect(s[0]).toBe(2 * 5 + 2); // food shortfall × 5, support beyond Monarchy's free units
    expect(s[1]).toBe(0); // Despotism supports up to the city size
    expect(s[2]).toBe(-2); // Monarchy: 5 − 3
    expect(s[4]).toBe(0); // Fundamentalism: 10 free
    expect(s[5]).toBe(-(5 - 0) - 3 * 7); // Republic: support, then weariness 3 × (7 − civilize)
    expect(s[6]).toBe(-(5 - 0) - 2 * 4 * 7); // Democracy: 2 × (away + 1) × 7
  });

  it('the computer picks the best allowed government every eighth turn', () => {
    const w = new World({ columns: 10, rows: 10, flatEarth: true });
    const c = civ(1);
    w.civs.push(c);
    c.knownAdvances[54] = true; // Monarchy
    const s = governmentScoresOf(c);
    s[1] = -10;
    s[2] = -4;
    s[6] = 50; // Democracy would win but is not allowed
    expect(
      aiPickGovernment(w, c, {
        knows: (a) => c.knownAdvances[a] === true,
        ownsStatue: false,
        nextInt: () => 0,
      }),
    ).toBe(2);
    expect(c.government).toBe(2);
    s[0] = 5; // the current state hurts: only Despotism is considered below Democracy
    expect(aiPickGovernment(w, c, { knows: () => true, ownsStatue: false, nextInt: () => 0 })).toBe(
      1,
    );
  });

  it('a change by a computer player clears its vendettas', () => {
    const w = new World({ columns: 10, rows: 10, flatEarth: true });
    const c = civ(1);
    w.civs.push(c, civ(2));
    setTreaty(w, 1, 2, TREATY.vendetta);
    civGovernmentScores(c, {
      isHuman: false,
      knows: () => true,
      ownsWonder: () => false,
      personality: { attack: 0, civilize: 0 },
      control: 2,
      advances: 5,
      treasury: 100,
      mainHuman: null,
      spaceshipLaunched: false,
      anyHumanSpaceshipLaunched: false,
      difficulty: 2,
      bloodlust: false,
      scienceRate: 5,
    });
    governmentScoresOf(c)[5] = 9;
    expect(aiPickGovernment(w, c, { knows: () => true, ownsStatue: false, nextInt: () => 0 })).toBe(
      5,
    );
    expect(hasTreaty(w, 1, 2, TREATY.vendetta)).toBe(false);
  });

  it('anarchy ends on a turn divisible by four: Despotism for the computer, a choice for a human', () => {
    const w = new World({ columns: 10, rows: 10, flatEarth: true });
    const ai = civ(1);
    const human = civ(2, true);
    w.civs.push(ai, human);
    ai.government = GOVERNMENT.anarchy;
    const events: GovernmentEvent[] = [];
    anarchyTurn(w, ai, { turn: 41, isHuman: false, ownsStatue: false }, events);
    expect(ai.government).toBe(GOVERNMENT.anarchy);
    anarchyTurn(w, ai, { turn: 44, isHuman: false, ownsStatue: false }, events);
    expect(ai.government).toBe(GOVERNMENT.despotism);
    startRevolution(w, human);
    expect(human.government).toBe(GOVERNMENT.anarchy);
    anarchyTurn(w, human, { turn: 44, isHuman: true, ownsStatue: false }, events); // the revolution's own turn
    expect(events.some((e) => e.choose)).toBe(false);
    anarchyTurn(w, human, { turn: 48, isHuman: true, ownsStatue: false }, events);
    expect(events.some((e) => e.choose)).toBe(true);
  });
});
