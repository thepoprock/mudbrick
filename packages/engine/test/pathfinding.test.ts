import { describe, expect, it } from 'vitest';
import { gotoDirection } from '../src/pathfinding.js';
import { Rng } from '../src/rng.js';
import type { EngineRules } from '../src/rules.js';
import { ORDER } from '../src/terraform.js';
import { gotoStep } from '../src/turnStart.js';
import { OCEAN, SquareFlag, World, type Unit } from '../src/world.js';

const flags = () => ({
  ignoreZonesOfControl: false,
  alpine: false,
  mustStayNearLand: false,
  negatesCityWalls: false,
  doubleDefenceVsHorse: false,
  doubleDefenceVsAir: false,
  submarine: false,
  canAttackAir: false,
  destroyedAfterAttack: false,
  freeSupportUnderFundamentalism: false,
});
const rules = {
  cosmic: { roadMoveMultiplier: 3 },
  terrain: Array.from({ length: 11 }, (_, t) => ({ moveCost: t === 4 ? 2 : 1 })),
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
      flags: flags(),
    },
    {
      name: 'Trireme',
      domain: 2,
      move: 3,
      range: 0,
      attack: 1,
      defence: 1,
      hitPointsTens: 1,
      firepower: 1,
      costRows: 4,
      role: 4,
      flags: flags(),
      holds: 2,
    },
  ],
} as unknown as EngineRules;

function unit(type: number, x: number, y: number): Unit {
  return {
    id: 1,
    position: { x, y },
    owner: 2,
    type,
    veteran: false,
    hitPointsLost: 0,
    movesSpent: 0,
    fortified: false,
    homeCity: null,
    order: ORDER.goTo,
    workCounter: 0,
    gotoTarget: null,
    lastDirection: null,
    gotoSteps: 0,
  };
}

describe('go-to pathfinding', () => {
  it('walks around a bay instead of stopping at the shore', () => {
    const w = new World({ columns: 30, rows: 40, flatEarth: true });
    w.terrain.fill(2);
    // An ocean wall across x = 20..23 except a gap at the top rows.
    for (let i = 0; i < w.area; i++) {
      const p = w.position(i);
      if (p.x >= 20 && p.x <= 23 && p.y > 4) w.terrain[i] = OCEAN;
    }
    const u = unit(0, 10, 20);
    expect(gotoDirection(w, rules, u, { x: 30, y: 20 })).not.toBeNull();
    u.gotoTarget = { x: 30, y: 20 };
    w.units.push(u);
    // Turn after turn the go-to must find its way through the gap rather than stall at the shore.
    let arrived = false;
    for (let turn = 0; turn < 60 && !arrived; turn++) {
      u.movesSpent = 0;
      u.order = ORDER.goTo;
      u.gotoTarget = { x: 30, y: 20 };
      const r = gotoStep(w, rules, new Rng(1), u, {});
      expect(r.kind).toBe('goto-step');
      arrived = r.kind === 'goto-step' && r.arrived;
    }
    expect(arrived).toBe(true);
    expect(u.position).toEqual({ x: 30, y: 20 });
  });

  it('prefers a road to open ground and a ship stays at sea', () => {
    const w = new World({ columns: 30, rows: 40, flatEarth: true });
    w.terrain.fill(2);
    for (let x = 10; x <= 30; x += 2) w.setFlag(x, 20, SquareFlag.Road, true);
    const u = unit(0, 10, 20);
    expect(gotoDirection(w, rules, u, { x: 30, y: 20 })).toBe(1); // east along the road
    for (let i = 0; i < w.area; i++) if (w.position(i).y > 30) w.terrain[i] = OCEAN;
    const ship = unit(1, 10, 34);
    const d = gotoDirection(w, rules, ship, { x: 30, y: 34 });
    expect(d).toBe(1);
    expect(gotoDirection(w, rules, ship, { x: 30, y: 20 })).toBeNull(); // no sea route onto land
  });
});
