import { describe, expect, it } from 'vitest';
import { shipOf, spaceRaceOn, spaceRacePressure } from '../src/spaceship.js';
import { World, type Civ } from '../src/world.js';

function civ(slot: number, isHuman: boolean): Civ {
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

describe('the space race (0x0053feba, 0x0053ff14)', () => {
  it('is on once Apollo stands or a human knows Space Flight, never under bloodlust', () => {
    expect(
      spaceRaceOn({ bloodlust: false, apolloBuilt: false, humanKnowsSpaceFlight: false }),
    ).toBe(false);
    expect(spaceRaceOn({ bloodlust: false, apolloBuilt: true, humanKnowsSpaceFlight: false })).toBe(
      true,
    );
    expect(spaceRaceOn({ bloodlust: false, apolloBuilt: false, humanKnowsSpaceFlight: true })).toBe(
      true,
    );
    expect(spaceRaceOn({ bloodlust: true, apolloBuilt: true, humanKnowsSpaceFlight: true })).toBe(
      false,
    );
  });

  it('presses on a computer player a human ship matches or beats', () => {
    const w = new World({ columns: 10, rows: 10, flatEarth: true });
    const ai = civ(1, false);
    const human = civ(2, true);
    w.civs.push(ai, human);
    const ctx = {
      raceOn: true,
      gameEnded: false,
      difficulty: 3,
      isHuman: (s: number) => s === 2,
      knows: (s: number, a: number) => s === 2 && a === 76,
      partCostRows: (kind: number) => [16, 16, 32][kind] ?? 0,
    };
    // Both ships empty: equal value counts as pressure once the human knows Space Flight.
    expect(spaceRacePressure(w, ai, ctx)).toBe(true);
    shipOf(ai).parts[0] = 2; // 32 against the human's 0
    expect(spaceRacePressure(w, ai, ctx)).toBe(false);
    shipOf(human).parts[3] = 1; // a module: 32
    expect(spaceRacePressure(w, ai, ctx)).toBe(true);
    expect(spaceRacePressure(w, ai, { ...ctx, difficulty: 0 })).toBe(false);
    expect(spaceRacePressure(w, ai, { ...ctx, raceOn: false })).toBe(false);
    expect(spaceRacePressure(w, human, ctx)).toBe(false);
  });
});
