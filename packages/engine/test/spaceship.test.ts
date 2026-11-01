import { describe, expect, it } from 'vitest';
import {
  buildPart,
  PART_ASKED,
  checkArrivals,
  evaluateShip,
  kindComplete,
  launchShip,
  loseShip,
  partLimit,
  SHIP_FLAG,
  shipOf,
  thrust,
  type SpaceshipContext,
  type SpaceshipEvent,
  aiNextPartKind,
} from '../src/spaceship.js';
import { World, type Civ } from '../src/world.js';

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
    advancesCount: 10,
    futureTechs: 0,
    scienceRate: 5,
    taxRate: 3,
    knownAdvances: Array<boolean>(100).fill(false),
    freeAdvancePending: false,
  };
}
function ctx(w: World, year = 1990): SpaceshipContext {
  return {
    turn: 300,
    year,
    difficulty: 2,
    massThrust: 75,
    isHuman: (s) => w.civs.find((c) => c.slot === s)?.isHuman ?? false,
    knowsFusion: () => false,
    rank: () => 0,
  };
}

describe('the spaceship', () => {
  it('structure limits the engines and modules; thrust grows per engine', () => {
    const c = civ(1, true);
    const ship = shipOf(c);
    expect(partLimit(ship, 1, true)).toBe(0);
    ship.parts[0] = 39;
    expect(partLimit(ship, 1, true)).toBe(8);
    expect(partLimit(ship, 2, true)).toBe(8);
    expect(partLimit(ship, 3, true)).toBe(4);
    expect(partLimit(ship, 5, true)).toBe(4);
    expect(partLimit(ship, 5, false)).toBe(1);
    expect(thrust(4)).toBe(4);
    expect(thrust(6)).toBe(8);
    expect(thrust(8)).toBe(14);
  });

  it('a full ship flies fast with full success; a bare one is slow and hopeless', () => {
    const c = civ(1, true);
    const ship = shipOf(c);
    ship.parts.set([39, 8, 8, 4, 4, 4]);
    const full = evaluateShip(ship, true, 75, false, 1990, true);
    expect(full.success).toBe(100);
    expect(full.mass).toBe(39 + 64 + 192);
    expect(full.flightTenths).toBe(Math.trunc((295 * 75) / (14 * 10 + 1)));
    expect(full.arrivalYear).toBe(1990 + Math.trunc(full.flightTenths / 10));
    ship.parts.set([10, 2, 2, 1, 0, 0]);
    const bare = evaluateShip(ship, true, 75, false, 1990, true);
    expect(bare.success).toBe(0);
  });

  it('parts are built in kinds, the computer launches a good ship, and the landing wins', () => {
    const w = new World({ columns: 10, rows: 10, flatEarth: true });
    const ai = civ(2);
    w.civs.push(civ(0), civ(1, true), ai);
    const events: SpaceshipEvent[] = [];
    const cx = ctx(w);
    for (let i = 0; i < 39; i++) expect(buildPart(w, ai, 0, cx, events)).toBe(0);
    expect(buildPart(w, ai, 0, cx, events)).toBe(-1);
    expect(kindComplete(shipOf(ai), 0)).toBe(true);
    for (let i = 0; i < 16; i++) expect([1, 2]).toContain(buildPart(w, ai, 1, cx, events));
    // Modules: habitation, then life support, then solar.
    // A human with a screen to answer is asked instead, and the part goes where it says.
    const asked = { ...cx, isHuman: () => true, askHuman: true };
    const parts = [...(ai.spaceship?.parts ?? [])];
    expect(buildPart(w, ai, 2, asked, events)).toBe(PART_ASKED);
    expect(ai.pendingParts).toEqual([2]);
    expect([...(ai.spaceship?.parts ?? [])]).toEqual(parts);
    expect(buildPart(w, ai, 2, cx, events)).toBe(3);
    expect(buildPart(w, ai, 2, cx, events)).toBe(4);
    expect(buildPart(w, ai, 2, cx, events)).toBe(5);
    expect((shipOf(ai).flags & SHIP_FLAG.launched) !== 0).toBe(true); // the hull is complete and success is high
    const arrival = shipOf(ai).arrival;
    expect(arrival).toBeGreaterThan(1990);
    expect(checkArrivals(w, arrival - 1, events)).toBeNull();
    expect(checkArrivals(w, arrival, events)).toBe(ai);
    expect(events.some((e) => e.text.includes('Alpha Centauri'))).toBe(true);
  });

  it('the computer asks for structurals first, then modules before components', () => {
    const w = new World({ columns: 10, rows: 10, flatEarth: true });
    const c = civ(2);
    w.civs.push(c);
    const ship = shipOf(c);
    expect(aiNextPartKind(w, c, 0, ctx(w))).toBe(0);
    ship.parts[0] = 39;
    expect(aiNextPartKind(w, c, 0, ctx(w))).toBe(2);
    expect(aiNextPartKind(w, c, 1, ctx(w))).toBe(1);
    ship.parts.set([39, 8, 8, 4, 4, 4]);
    expect(aiNextPartKind(w, c, 0, ctx(w))).toBe(-2);
    // An advance the player lacks closes a kind.
    ship.parts.set([39, 0, 0, 0, 0, 0]);
    expect(aiNextPartKind(w, c, 2, { ...ctx(w), knowsPartAdvance: (_, k) => k !== 2 })).toBe(1);
  });

  it('a human launches by hand; losing the capital loses an unlaunched ship', () => {
    const w = new World({ columns: 10, rows: 10, flatEarth: true });
    const h = civ(1, true);
    w.civs.push(civ(0), h);
    const events: SpaceshipEvent[] = [];
    shipOf(h).parts.set([20, 4, 4, 1, 1, 1]);
    shipOf(h).flags |= SHIP_FLAG.started;
    expect(loseShip(h)).toBe(true);
    expect(shipOf(h).parts[0]).toBe(0);
    shipOf(h).parts.set([20, 4, 4, 1, 1, 1]);
    shipOf(h).flags |= SHIP_FLAG.started;
    launchShip(w, h, ctx(w, 2000), events);
    expect(shipOf(h).launchYear).toBe(2000);
    expect(loseShip(h)).toBe(false);
  });
});
