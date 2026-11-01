import { describe, expect, it } from 'vitest';
import { civilWar, escapeCity, mostCentralCity } from '../src/civilWar.js';
import { hasTreaty, TREATY } from '../src/diplomacy.js';
import type { EngineRules } from '../src/rules.js';
import { CITY_CENTRE_INDEX, World, type City, type Civ } from '../src/world.js';

function civ(slot: number): Civ {
  return {
    slot,
    tribe: slot,
    name: `C${slot}`,
    adjective: `C${slot}`,
    leader: 'L',
    cityStyle: 0,
    epoch: 0,
    colour: slot,
    government: 5,
    treasury: 1000,
    isHuman: false,
    inPlay: true,
    scienceStored: 40,
    researching: null,
    advancesCount: 10,
    futureTechs: 0,
    scienceRate: 5,
    taxRate: 3,
    knownAdvances: Array<boolean>(100).fill(false),
    freeAdvancePending: false,
  };
}
function city(w: World, id: number, x: number, y: number, size: number): City {
  const c: City = {
    id,
    position: { x, y },
    owner: 1,
    name: `C${id}`,
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
  w.cities.push(c);
  return c;
}
function world(): World {
  const w = new World({ columns: 40, rows: 40, flatEarth: true });
  w.terrain.fill(2);
  w.landmass.fill(1);
  for (let s = 0; s < 8; s++) w.civs.push(civ(s));
  return w;
}
const rules = {} as EngineRules;

describe('the fall of a capital', () => {
  it('splits the far cities off to a rebel civilization at war with the old', () => {
    const w = world();
    const loser = w.civs[1] as Civ;
    const rebels = w.civs[7] as Civ;
    rebels.inPlay = false;
    const capital = city(w, 0, 2, 2, 6);
    capital.improvements[1] = true;
    city(w, 1, 6, 2, 6);
    city(w, 2, 10, 2, 6);
    const far = city(w, 3, 60, 2, 6);
    const done = civilWar(w, rules, loser, {
      turn: 100,
      restart: (s) => {
        expect(s).toBe(7); // the highest free slot
        rebels.inPlay = true;
        return true;
      },
    });
    expect(done).toBe(true);
    expect(far.owner).toBe(7);
    expect(rebels.treasury).toBe(500);
    expect(loser.treasury).toBe(500);
    expect(rebels.government).toBe(5);
    expect(hasTreaty(w, 7, 1, TREATY.war)).toBe(true);
    expect(w.cities.some((c) => c.owner === 7 && c.improvements[1] === true)).toBe(true);
  });

  it('needs a palace and a free slot, and the capital goes to the middle', () => {
    const w = world();
    city(w, 0, 2, 2, 3);
    const mid = city(w, 1, 10, 2, 3);
    city(w, 2, 18, 2, 3);
    expect(mostCentralCity(w, 1)).toBe(mid);
    expect(civilWar(w, rules, w.civs[1] as Civ, { turn: 1, restart: () => true })).toBe(false);
    mid.improvements[1] = true;
    for (let s = 2; s < 8; s++) city(w, 10 + s, 30, s * 2, 1).owner = s;
    expect(civilWar(w, rules, w.civs[1] as Civ, { turn: 1, restart: () => true })).toBe(false);
  });

  it('a government flees to a big city, preferring walls', () => {
    const w = world();
    const taken = city(w, 0, 2, 2, 10);
    const plain = city(w, 1, 12, 2, 9);
    const walled = city(w, 2, 14, 2, 9);
    walled.improvements[8] = true;
    city(w, 3, 16, 2, 4);
    expect(escapeCity(w, taken, 1, false)).toBe(walled);
    expect(plain.owner).toBe(1);
  });
});
