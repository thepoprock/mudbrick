import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeText, parseRules } from '@mudbrick/formats';
import { Game } from '../src/game.js';
import { newGame } from '../src/newGame.js';
import { Rng } from '../src/rng.js';
import type { EngineRules } from '../src/rules.js';
import { isSnapshot, restoreGame, snapshotGame } from '../src/snapshot.js';

const dir = process.env.ORIGINAL_GAME_DIR;
const parsed = dir
  ? parseRules(decodeText(new Uint8Array(readFileSync(`${dir}/RULES.TXT`))))
  : null;
const rules = parsed as unknown as EngineRules | null;

describe.skipIf(!rules)('the native save', () => {
  it('round-trips a new game and replays identically', () => {
    if (!rules || !parsed) return;
    const rng = new Rng(5);
    const r = newGame(rules, rng, {
      map: {
        columns: 40,
        rows: 50,
        flatEarth: false,
        landMass: 1,
        landForm: 0,
        climate: 0,
        temperature: 0,
        age: 1,
      },
      difficulty: 1,
      civCount: 5,
      humanTribe: 2,
      leaders: parsed.leaders,
      barbarianActivity: 1,
    });
    for (const c of r.world.civs) c.isHuman = false;
    const game = new Game(r.world, rules, rng, r.state);
    for (let t = 0; t < 20; t++) game.endTurn();
    const text = snapshotGame(game, r.humanSlot);
    expect(isSnapshot(text)).toBe(true);
    const back = restoreGame(text, rules);
    expect(back.humanSlot).toBe(r.humanSlot);
    expect(back.game.state.turn).toBe(game.state.turn);
    expect(back.game.world.cities.length).toBe(game.world.cities.length);
    expect(Array.from(back.game.world.terrain)).toEqual(Array.from(game.world.terrain));
    const c0 = back.game.world.civs[1];
    expect(c0?.attitudes).toBeInstanceOf(Uint8Array);
    expect(c0?.strategy?.plans).toBeInstanceOf(Uint8Array);
    // Same random state and same world: the next ten turns agree.
    for (let t = 0; t < 10; t++) {
      game.endTurn();
      back.game.endTurn();
    }
    expect(back.game.world.cities.map((c) => `${c.name}:${c.size}:${c.shieldsStored}`)).toEqual(
      game.world.cities.map((c) => `${c.name}:${c.size}:${c.shieldsStored}`),
    );
    expect(back.game.world.units.length).toBe(game.world.units.length);
  });
});
