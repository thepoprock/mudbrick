import { describe, expect, it } from 'vitest';
import { civilizationScore, retirementStage, type ScoreContext } from '../src/score.js';
import { SHIP_FLAG, shipOf, shipScore } from '../src/spaceship.js';
import { CITY_CENTRE_INDEX, World, type City, type Civ } from '../src/world.js';

function civ(slot: number, inPlay = true): Civ {
  return {
    slot,
    tribe: 0,
    name: `Civ${slot}`,
    adjective: `C${slot}`,
    leader: 'L',
    cityStyle: 0,
    epoch: 0,
    colour: slot,
    government: 1,
    treasury: 0,
    isHuman: false,
    inPlay,
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
function city(w: World, owner: number, size: number, happy: number, unhappy: number): City {
  const c: City = {
    id: w.cities.length,
    position: { x: 2 + w.cities.length * 4, y: 2 },
    owner,
    name: `C${w.cities.length}`,
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
    lastHappy: happy,
    lastUnhappy: unhappy,
  };
  w.cities.push(c);
  return c;
}
function ctx(over: Partial<ScoreContext> = {}): ScoreContext {
  return {
    turn: 250,
    turnsOfPeace: 40,
    pollutionSquares: 3,
    barbarianActivity: 1,
    isHuman: () => false,
    massThrust: 75,
    knowsFusion: () => false,
    year: 1900,
    ...over,
  };
}

describe('the civilization score (verified)', () => {
  it('adds citizens, wonders, peace, future technologies and the barbarian level, less pollution', () => {
    const w = new World({ columns: 20, rows: 20, flatEarth: true });
    const a = civ(1);
    const b = civ(2);
    w.civs.push(a, b);
    city(w, 1, 5, 2, 1); // 5 + 2 − 1 = 6
    const second = city(w, 1, 3, 0, 2); // 3 − 2 = 1
    second.improvements[45] = true; // a wonder: 20
    city(w, 2, 9, 9, 0);
    a.futureTechs = 2;
    const s = civilizationScore(w, a, ctx());
    expect(s.citizens).toBe(7);
    expect(s.wonders).toBe(20);
    expect(s.pollution).toBe(-30);
    expect(s.peace).toBe(100); // 40 × 3 capped
    expect(s.futureTechs).toBe(10);
    expect(s.barbarians).toBe(-25);
    expect(s.conquest).toBe(0);
    expect(s.total).toBe(7 + 20 - 30 + 100 + 10 - 25);
    // Before turn 200 the peace term is nothing, and the score never drops below zero.
    expect(civilizationScore(w, a, ctx({ turn: 150, pollutionSquares: 20 })).total).toBe(0);
  });

  it('credits a ship only once it has won, and the last civilization gets the conquest bonus', () => {
    const w = new World({ columns: 20, rows: 20, flatEarth: true });
    const a = civ(1);
    w.civs.push(a, civ(2, false));
    city(w, 1, 4, 0, 0);
    const ship = shipOf(a);
    ship.flags = SHIP_FLAG.launched;
    ship.population = 4;
    expect(civilizationScore(w, a, ctx()).spaceship).toBe(0);
    ship.flags = SHIP_FLAG.won;
    ship.parts.set([12, 2, 2, 1, 1, 1]);
    expect(civilizationScore(w, a, ctx()).spaceship).toBe(shipScore(a, false, 75, false, 1900));
    // Alone in play at turn 250 with one civilization destroyed: 100 + 640 + 400.
    const s = civilizationScore(w, a, ctx({ destroyedCivilizations: 1 }));
    expect(s.conquest).toBe(100 + (570 - 250) * 2 + 400);
    expect(s.total).toBe(Math.max(s.civilization, s.conquest));
    const dearer = civilizationScore(
      w,
      a,
      ctx({ destroyedCivilizations: 1, researchDearer: true }),
    );
    expect(dearer.conquest).toBe(Math.trunc((s.conquest * 5) / 4));
    const early = civilizationScore(w, a, ctx({ turn: 100, noRestart: true }));
    expect(early.conquest).toBe((570 - 250) * 2 + 400);
  });

  it('warns in 2000 and ends in 2020', () => {
    expect(retirementStage(1999)).toBeNull();
    expect(retirementStage(2000)).toBe('warn');
    expect(retirementStage(2020)).toBe('end');
    expect(retirementStage(2021)).toBeNull();
  });
});
