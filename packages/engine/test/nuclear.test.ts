import { describe, expect, it } from 'vitest';
import { nuclearStrike } from '../src/nuclear.js';
import { Rng } from '../src/rng.js';
import { IMPROVEMENT } from '../src/rules.js';
import { TREATY } from '../src/diplomacy.js';
import { World, type City, type Civ, type Unit } from '../src/world.js';

function setup() {
  const w = new World({ columns: 20, rows: 20, flatEarth: true });
  w.terrain.fill(2);
  w.civs.push({ slot: 1 } as unknown as Civ, { slot: 2 } as unknown as Civ);
  w.cities.push({
    id: 0,
    owner: 2,
    size: 7,
    position: { x: 10, y: 10 },
    improvements: Array<boolean>(67).fill(false),
  } as unknown as City);
  w.units.push({ id: 0, owner: 2, position: { x: 10, y: 10 } } as unknown as Unit);
  return { w, c: w.cities[0] as City };
}

describe('a nuclear strike', () => {
  it('kills the stack, halves the city up, and earns a vendetta', () => {
    const { w, c } = setup();
    const b = nuclearStrike(w, new Rng(1), 1, 10, 10, true);
    expect(b.killed).toHaveLength(1);
    expect(w.units).toHaveLength(0);
    expect(c.size).toBe(4);
    expect((w.civs[1]?.treaties?.[1] ?? 0) & TREATY.vendetta).not.toBe(0);
  });
  it('an SDI Defense within three squares stops a missile, not a planted device', () => {
    const { w, c } = setup();
    c.improvements[IMPROVEMENT.sdiDefense] = true;
    const stopped = nuclearStrike(w, new Rng(1), 1, 10, 10, true);
    expect(stopped.stoppedBy).toBe(c);
    expect(c.size).toBe(7);
    expect(nuclearStrike(w, new Rng(1), 1, 10, 10, false).killed).toHaveLength(1);
  });
});
