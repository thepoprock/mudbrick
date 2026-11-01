import { describe, expect, it } from 'vitest';
import { checkMove } from '../src/movement.js';
import type { EngineRules } from '../src/rules.js';
import { OCEAN, World, type Unit } from '../src/world.js';

const type = (domain: number, flags: Record<string, boolean>) => ({
  name: 'U',
  domain,
  move: 1,
  range: 0,
  attack: 2,
  defence: 1,
  hitPointsTens: 1,
  firepower: 1,
  costRows: 1,
  role: 0,
  flags: { twoSquareVisibility: false, ignoreZonesOfControl: false, ...flags },
});
const rules = {
  cosmic: { roadMoveMultiplier: 3 },
  terrain: Array.from({ length: 11 }, () => ({ moveCost: 1, defenceHalves: 2 })),
  units: [
    type(0, {}),
    type(0, { amphibiousAssault: true }),
    type(2, { submarine: true }),
    type(2, {}),
  ],
} as unknown as EngineRules;

function unit(w: World, t: number, x: number, y: number, owner: number): Unit {
  const u: Unit = {
    id: w.units.length,
    position: { x, y },
    owner,
    type: t,
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

describe('attacking from a ship (0x00539099)', () => {
  it('needs the amphibious flag for a ground unit at sea; a submarine never attacks land', () => {
    const w = new World({ columns: 20, rows: 30, flatEarth: true });
    w.terrain.fill(2);
    w.terrain[w.index(10, 10)] = OCEAN; // the attacker's square
    w.terrain[w.index(12, 10)] = OCEAN; // a sea square beside it
    unit(w, 0, 11, 11, 2); // a foreign unit on land next to the sea square
    unit(w, 3, 12, 10, 2); // a foreign ship on the sea square
    const infantry = unit(w, 0, 10, 10, 1);
    expect(checkMove(w, rules, infantry, { x: 11, y: 11 })).toEqual({
      ok: false,
      reason: 'amphibious',
    });
    const marines = unit(w, 1, 10, 10, 1);
    expect(checkMove(w, rules, marines, { x: 11, y: 11 })).toEqual({ ok: false, reason: 'enemy' });
    const sub = unit(w, 2, 10, 10, 1);
    expect(checkMove(w, rules, sub, { x: 11, y: 11 })).toEqual({ ok: false, reason: 'submarine' });
    expect(checkMove(w, rules, sub, { x: 12, y: 10 })).toEqual({ ok: false, reason: 'enemy' });
  });
});
