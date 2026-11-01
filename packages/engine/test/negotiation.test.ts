import { describe, expect, it } from 'vitest';
import { setTreaty, TREATY } from '../src/diplomacy.js';
import {
  attitudeBand,
  conversation,
  goldGoodwill,
  powerRanks,
  relationsTurn,
  type NegotiationEnv,
} from '../src/negotiation.js';
import { Rng } from '../src/rng.js';
import type { EngineRules } from '../src/rules.js';
import { World, type Civ } from '../src/world.js';

function civ(slot: number, isHuman = false): Civ {
  return {
    slot,
    name: `Civ${slot}`,
    leader: `L${slot}`,
    isHuman,
    inPlay: true,
    treasury: 500,
    government: 1,
    advancesCount: 5,
    scienceRate: 5,
    taxRate: 3,
    knownAdvances: Array<boolean>(100).fill(false),
  } as unknown as Civ;
}
function env(world: World): NegotiationEnv {
  return {
    world,
    rules: { advances: [], units: [], improvements: [] } as unknown as EngineRules,
    rng: new Rng(3),
    turn: 50,
    difficulty: 2,
    bloodlust: false,
    rank: () => 3,
    ownsWonder: () => false,
    knows: () => false,
    gain: () => undefined,
    advanceValue: () => 1,
    spaceRace: () => false,
    launched: () => false,
    unitsOn: () => 0,
    attackOn: () => 0,
    planOn: () => 0,
    power: () => 10,
    leaderAttack: () => 0,
    leaderCivilize: () => 0,
    leaderExpand: () => 0,
  };
}
function setup() {
  const w = new World({ columns: 10, rows: 10, flatEarth: true });
  const h = civ(1, true);
  const c = civ(2);
  w.civs.push(h, c);
  return { w, h, c };
}

describe('negotiation arithmetic', () => {
  it('bands attitude as 0x0044dfde does', () => {
    expect([-1, 10, 25, 38, 61, 74, 89, 99, 100].map(attitudeBand)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });
  it('gold buys goodwill at a falling rate', () => {
    expect(goldGoodwill(50)).toBe(5);
    expect(goldGoodwill(150)).toBe(5 + 6);
    expect(goldGoodwill(250)).toBe(5 + 6 + 5);
  });
  it('ranks by advances, citizens and gold, strongest 7', () => {
    const { w, h, c } = setup();
    h.advancesCount = 1;
    c.advancesCount = 9;
    const ranks = powerRanks(w, () => 0);
    expect(ranks[2]).toBe(7);
    expect(ranks[1]).toBe(6);
  });
});

describe('a conversation', () => {
  it('an emissary that is turned away asks nothing more', () => {
    const { w } = setup();
    const talk = conversation(env(w), 1, 2, false);
    let step = talk.next();
    const keys: string[] = [];
    while (!step.done) {
      keys.push(step.value.key);
      step = talk.next(step.value.key === 'EMISSARY' ? 1 : 0);
    }
    expect(keys.filter((k) => k === 'EMISSARY').length).toBeLessThanOrEqual(1);
    expect(keys).not.toContain('DIPLOMACYMENU');
  });

  it('on the easiest level a civilization with Writing swaps ambassadors after the talk', () => {
    const { w, h } = setup();
    setTreaty(w, 1, 2, TREATY.contact);
    const e = { ...env(w), difficulty: 0, knows: (_: number, a: number) => a === 88 };
    const talk = conversation(e, 1, 2, false);
    const keys: string[] = [];
    let step = talk.next();
    while (!step.done && keys.length < 60) {
      keys.push(step.value.key);
      step = talk.next(0);
    }
    expect(keys).toContain('AMBASSADORS');
    expect((h.treaties?.[2] ?? 0) & TREATY.embassy).not.toBe(0);
  });

  it('a human who calls and accepts peace gets a treaty on both sides', () => {
    const { w, h, c } = setup();
    setTreaty(w, 1, 2, TREATY.contact);
    const talk = conversation(env(w), 1, 2, true);
    let step = talk.next();
    while (!step.done) {
      const key = step.value.key;
      step = talk.next(key === 'DIPLOMACYMENU' ? 2 : 0);
      if (key === 'TREATY') break;
    }
    expect((c.treaties?.[1] ?? 0) & TREATY.peace).not.toBe(0);
    expect((h.treaties?.[2] ?? 0) & TREATY.peace).not.toBe(0);
  });

  it('with the talk limit reached the human is sent away and it does not count', () => {
    const { w, c } = setup();
    setTreaty(w, 1, 2, TREATY.contact | (1 << 23));
    c.talks = 9;
    const talk = conversation(env(w), 1, 2, true);
    const first = talk.next();
    expect(first.done).toBe(false);
    if (!first.done) expect(first.value.key).toBe('OUTAHERE');
    expect(talk.next(0).done).toBe(true);
    expect(c.talks).toBe(9);
  });
});

describe("a computer player's turn toward a human", () => {
  it('warmer feelings make the attitude figure fall, and no contact leaves it alone', () => {
    const { w, c } = setup();
    c.attitudes = new Uint8Array(8);
    c.attitudes[1] = 50;
    const talk = relationsTurn(env(w), 1, 2, false);
    expect(talk.next().done).toBe(true);
    expect(c.attitudes[1]).toBe(50);
    setTreaty(w, 1, 2, TREATY.contact | TREATY.peace);
    const talk2 = relationsTurn(env(w), 1, 2, false);
    expect(talk2.next().done).toBe(true);
    expect(c.attitudes[1]).toBe(48); // peace −2, not at war −1, first in advances +1
  });
});
