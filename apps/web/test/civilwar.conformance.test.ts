import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rawYields } from '@mudbrick/engine';
import { decodeText, parseRules, parseSave } from '@mudbrick/formats';
import { gameFromSave } from '../src/gameFromSave.js';
import { worldFromSave } from '../src/worldFromSave.js';

/**
 * The original's City Status (F1) for the Federals at the first turn of the shipped Civil War
 * scenario, read off the running game: total food per city. The scenario's own RULES.TXT is in
 * force. This pins the worked-square mask's byte order and the square yields together.
 */
const ORIGINAL_FOOD: Record<string, number> = {
  Washington: 17,
  Boston: 38,
  'New York': 51,
  Philadelphia: 38,
  Baltimore: 31,
  Harrisburg: 22,
  Providence: 33,
  Springfield: 34,
  Concord: 25,
  Albany: 29,
  "Harper's Ferry": 7,
  Syracuse: 24,
  Pittsburgh: 31,
  Buffalo: 28,
  Cleveland: 27,
  Columbus: 23,
  Indianapolis: 24,
  'Terra Haute': 25,
  Chicago: 23,
  'Fort Wayne': 13,
  Detroit: 19,
  Lansing: 18,
  Milwaukee: 18,
  Springfield2: 23,
};

const dir = process.env.ORIGINAL_GAME_DIR;
const folder = dir ? `${dir}/SCENARIO/CIVILWAR` : undefined;
const present = folder !== undefined && existsSync(`${folder}/civilwar.SCN`);

describe('Civil War scenario against the original', () => {
  it.skipIf(!present)("reproduces the original's City Status food totals at the first turn", () => {
    if (!folder) return;
    const rules = parseRules(decodeText(new Uint8Array(readFileSync(`${folder}/rules.txt`))));
    const save = parseSave(new Uint8Array(readFileSync(`${folder}/civilwar.SCN`)));
    const world = worldFromSave(save, rules);
    const game = gameFromSave(save, rules, world);
    const federals = world.civs.find((c) => c.name === 'Federals' || c.adjective === 'Federal');
    const slot = federals?.slot ?? 5;
    for (const [name, food] of Object.entries(ORIGINAL_FOOD)) {
      const city = world.cities.find((c) => c.name === name && c.owner === slot);
      expect(city, name).toBeDefined();
      if (!city) continue;
      expect(rawYields(world, rules, city, game.cityContext(city)).food, name).toBe(food);
    }
  });
});
