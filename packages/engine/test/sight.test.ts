import { describe, expect, it } from 'vitest';
import type { EngineRules } from '../src/rules.js';
import { lookAround, OUTER_RING } from '../src/sight.js';
import { OCEAN, World, type Unit } from '../src/world.js';

const type = (domain: number, twoSquareVisibility: boolean) => ({
  name: 'U',
  domain,
  move: 1,
  range: 0,
  attack: 1,
  defence: 1,
  hitPointsTens: 1,
  firepower: 1,
  costRows: 1,
  role: 0,
  flags: { twoSquareVisibility },
});
const rules = {
  units: [type(0, false), type(0, true), type(2, true), type(1, true)],
} as unknown as EngineRules;

function unit(w: World, t: number, x: number, y: number): Unit {
  const u: Unit = {
    id: w.units.length,
    position: { x, y },
    owner: 1,
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
const seen = (w: World, x: number, y: number) => ((w.seen[w.index(x, y)] ?? 0) & 2) !== 0;

describe('sight (0x0041aad6)', () => {
  it('a unit sees its neighbours; the two-square flag adds the outer ring of its own element', () => {
    const w = new World({ columns: 20, rows: 30, flatEarth: true });
    w.terrain.fill(2);
    // Ocean on the east half of the outer ring.
    for (const [dx, dy] of OUTER_RING) if (dx > 0) w.terrain[w.index(20 + dx, 14 + dy)] = OCEAN;
    const plain = unit(w, 0, 20, 14);
    lookAround(w, rules, plain);
    expect(seen(w, 20, 14)).toBe(true);
    expect(seen(w, 21, 13)).toBe(true); // ring one
    expect(seen(w, 18, 12)).toBe(false); // ring two, no flag
    w.seen.fill(0);
    lookAround(w, rules, unit(w, 1, 20, 14)); // land unit with the flag
    expect(seen(w, 18, 12)).toBe(true); // land square of the ring
    expect(seen(w, 16, 14)).toBe(true);
    expect(seen(w, 22, 12)).toBe(false); // ocean square of the ring: not for a land unit
    expect(seen(w, 24, 14)).toBe(false);
    w.seen.fill(0);
    lookAround(w, rules, unit(w, 2, 20, 14)); // sea unit with the flag
    expect(seen(w, 22, 12)).toBe(true);
    expect(seen(w, 18, 12)).toBe(false);
    w.seen.fill(0);
    lookAround(w, rules, unit(w, 3, 20, 14)); // air unit
    expect(seen(w, 22, 12)).toBe(true);
    expect(seen(w, 18, 12)).toBe(true);
    expect(OUTER_RING).toHaveLength(16);
  });
});
