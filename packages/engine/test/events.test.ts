import { describe, expect, it } from 'vitest';
import type { ScenarioEvent } from '@mudbrick/formats';
import { newEventState, ScenarioEvents, type EventContext } from '../src/events.js';
import { Rng } from '../src/rng.js';
import type { EngineRules } from '../src/rules.js';
import { ORDER } from '../src/terraform.js';
import { CITY_CENTRE_INDEX, World, type City, type Civ, type Unit } from '../src/world.js';

const rules = {
  cosmic: { roadMoveMultiplier: 3 },
  terrain: Array.from({ length: 11 }, () => ({ moveCost: 1, defenceHalves: 2 })),
  units: [
    {
      name: 'Settlers',
      domain: 0,
      move: 1,
      range: 0,
      attack: 0,
      defence: 1,
      hitPointsTens: 2,
      firepower: 1,
      costRows: 4,
      role: 5,
      flags: {},
    },
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
      role: 0,
      flags: {},
    },
    {
      name: 'Nuclear',
      domain: 0,
      move: 1,
      range: 0,
      attack: 99,
      defence: 1,
      hitPointsTens: 1,
      firepower: 1,
      costRows: 1,
      role: 0,
      flags: {},
    },
  ],
  advances: Array.from({ length: 100 }, (_, i) => ({
    name: `a${i}`,
    preq1: { kind: 'none' },
    preq2: { kind: 'none' },
  })),
  improvements: Array.from({ length: 67 }, (_, i) => ({ name: `i${i}`, costRows: 4, upkeep: 1 })),
} as unknown as EngineRules;

function civ(slot: number): Civ {
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
    treasury: 100,
    isHuman: slot === 1,
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
function unit(
  w: World,
  type: number,
  x: number,
  y: number,
  owner: number,
  over: Partial<Unit> = {},
): Unit {
  const u: Unit = {
    id: w.units.length,
    position: { x, y },
    owner,
    type,
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
    ...over,
  };
  w.units.push(u);
  return u;
}
function city(w: World, x: number, y: number, owner: number, name: string): City {
  const c: City = {
    id: w.cities.length,
    position: { x, y },
    owner,
    name,
    size: 3,
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
  const w = new World({ columns: 20, rows: 30, flatEarth: true });
  w.terrain.fill(2);
  w.landmass.fill(1);
  w.civs.push(civ(0), civ(1), civ(2), civ(3));
  return w;
}
const calls: string[] = [];
function ctx(w: World, turn = 5): EventContext {
  return {
    turn,
    rng: new Rng(1),
    isHuman: (s) => w.civs.find((c) => c.slot === s)?.isHuman ?? false,
    inPlay: (s) => w.civs.find((c) => c.slot === s)?.inPlay ?? false,
    knows: (s, a) => w.civs.find((c) => c.slot === s)?.knownAdvances[a] === true,
    destroyCivilization: (s) => calls.push(`destroy ${s}`),
    eliminateCityless: () => calls.push('eliminate'),
    dontPlayWonders: () => calls.push('no movies'),
  };
}
const ev = (
  trigger: ScenarioEvent['trigger'],
  actions: Partial<ScenarioEvent['actions']>,
): ScenarioEvent => ({
  trigger,
  actions: { justOnce: false, dontPlayWonders: false, ...actions },
  names: {},
});

describe('scenario events (verified against the original)', () => {
  it('TURN fires each turn or once, JUSTONCE once, CHANGEMONEY clamps', () => {
    const w = world();
    const events = [
      ev({ kind: 'turn', turn: 'every' }, { text: ['hello'] }),
      ev(
        { kind: 'turn', turn: 6 },
        { changeMoney: { receiver: { kind: 'slot', slot: 2 }, amount: -500 }, justOnce: true },
      ),
      ev(
        { kind: 'turnInterval', interval: 3 },
        { changeMoney: { receiver: { kind: 'slot', slot: 3 }, amount: 40000 } },
      ),
    ];
    const se = new ScenarioEvents(w, rules, events, newEventState(events));
    expect(se.turnStart(ctx(w, 5)).map((e) => e.kind)).toEqual(['scenario-text']);
    se.turnStart(ctx(w, 6));
    expect(w.civs[2]?.treasury).toBe(0); // 100 − 500 floors at 0
    expect(w.civs[3]?.treasury).toBe(30000); // 100 + 40000 caps at 30000
    const c2 = w.civs.find((c) => c.slot === 2);
    if (c2) c2.treasury = 100;
    se.turnStart(ctx(w, 6));
    expect(w.civs[2]?.treasury).toBe(100); // JUSTONCE
  });

  it('UNITKILLED writes the slot over ANYBODY and CITYTAKEN matches by name', () => {
    const w = world();
    const events = [
      ev(
        {
          kind: 'unitKilled',
          unit: { kind: 'type', type: 1 },
          attacker: { kind: 'anybody' },
          defender: { kind: 'slot', slot: 2 },
        },
        { text: ['killed'] },
      ),
      ev(
        {
          kind: 'cityTaken',
          city: 'Rome',
          attacker: { kind: 'slot', slot: 3 },
          defender: { kind: 'anybody' },
        },
        { changeMoney: { receiver: { kind: 'triggerAttacker' }, amount: 50 } },
      ),
    ];
    const st = newEventState(events);
    const se = new ScenarioEvents(w, rules, events, st);
    expect(se.unitKilled(1, 3, 2, ctx(w))).toHaveLength(1);
    expect(st.attacker[0]).toBe(3);
    expect(se.unitKilled(1, 1, 2, ctx(w))).toHaveLength(0); // now only attacker 3 matches
    expect(se.unitKilled(1, 3, 2, ctx(w))).toHaveLength(1);
    se.cityTaken('rome', 3, 1, ctx(w));
    expect(w.civs[3]?.treasury).toBe(150); // TRIGGERATTACKER = 3
    expect(se.cityTaken('Rome', 3, 2, ctx(w))).toHaveLength(0); // defender fixed to 1 now
  });

  it("MOVEUNIT sends a computer owner's free units inside the rectangle, not nuclear or working ones", () => {
    const w = world();
    const a = unit(w, 1, 10, 10, 2);
    const nuke = unit(w, 2, 10, 12, 2);
    const busy = unit(w, 1, 12, 10, 2, { order: ORDER.road });
    const outside = unit(w, 1, 30, 10, 2);
    const events = [
      ev(
        { kind: 'turn', turn: 'every' },
        {
          moveUnit: {
            unit: { kind: 'anyunit' },
            owner: { kind: 'slot', slot: 2 },
            rect: [
              { x: 8, y: 8 },
              { x: 14, y: 8 },
              { x: 14, y: 14 },
              { x: 8, y: 14 },
            ],
            moveTo: { x: 4, y: 4 },
            numberToMove: -2,
          },
        },
      ),
    ];
    const se = new ScenarioEvents(w, rules, events, newEventState(events));
    se.turnStart(ctx(w));
    expect(a.order).toBe(ORDER.goTo);
    expect(a.gotoTarget).toEqual({ x: 4, y: 4 });
    expect(nuke.order).toBeNull();
    expect(busy.order).toBe(ORDER.road);
    expect(outside.order).toBeNull();
  });

  it('CREATEUNIT takes the first fitting location; CHANGETERRAIN clears the rectangle', () => {
    const w = world();
    city(w, 10, 10, 3, 'Theirs');
    unit(w, 1, 12, 10, 3);
    const events = [
      ev(
        { kind: 'turn', turn: 'every' },
        {
          createUnit: {
            unit: 1,
            owner: { kind: 'slot', slot: 2 },
            veteran: true,
            homeCity: 'none',
            locations: [
              { x: 10, y: 10 },
              { x: 12, y: 10 },
              { x: 14, y: 10 },
            ],
          },
        },
      ),
      ev(
        { kind: 'turn', turn: 'every' },
        {
          changeTerrain: {
            terrain: 10,
            rect: [
              { x: 10, y: 10 },
              { x: 12, y: 10 },
              { x: 12, y: 12 },
              { x: 10, y: 12 },
            ],
          },
        },
      ),
    ];
    const se = new ScenarioEvents(w, rules, events, newEventState(events));
    calls.length = 0;
    se.turnStart(ctx(w));
    const made = w.units.find((u) => u.owner === 2);
    expect(made?.position).toEqual({ x: 14, y: 10 });
    expect(made?.veteran).toBe(true);
    expect(w.cities.length).toBe(0);
    expect(w.terrainAt(10, 10)).toBe(10);
    expect(w.units.some((u) => u.position.x === 12 && u.position.y === 10)).toBe(false);
    expect(calls).toContain('eliminate');
  });
});
