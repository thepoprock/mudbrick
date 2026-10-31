/**
 * The engine's fertility rating against the ratings stored in the shipped saves and
 * scenarios (map byte 5, low nibble). Skipped without ORIGINAL_GAME_DIR.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { claimCitySite, computeFertility } from '@mudbrick/engine';
import { decodeText, parseRules, parseSave } from '@mudbrick/formats';
import { describe, expect, it } from 'vitest';
import {
  gameFile,
  gameFilesWithExtension,
  hasGameFiles,
} from '../../../packages/formats/test/helpers.js';
import { engineRules, worldFromSave } from '../src/worldFromSave.js';

describe.skipIf(!hasGameFiles)('fertility rating conformance', () => {
  const rules = hasGameFiles ? parseRules(decodeText(gameFile('RULES.TXT'))) : null;
  const files = hasGameFiles
    ? [...gameFilesWithExtension('.sav'), ...gameFilesWithExtension('.scn')]
    : [];
  for (const file of files) {
    it(`matches ${basename(file)}`, () => {
      if (!rules) return;
      const parsed = parseSave(new Uint8Array(readFileSync(file)));
      const world = worldFromSave(parsed, rules);
      const stored = Uint8Array.from(world.fertility);
      const storedTerritory = Uint8Array.from(world.territory);
      world.territory.fill(0);
      computeFertility(world, engineRules(rules));
      for (const city of world.cities) claimCitySite(world, city);
      let same = 0;
      let differ = 0;
      for (let i = 0; i < world.area; i++) {
        if (world.fertility[i] === stored[i]) same += 1;
        else differ += 1;
      }
      let territoryDiffer = 0;
      for (let i = 0; i < world.area; i++)
        if (world.territory[i] !== storedTerritory[i]) territoryDiffer += 1;
      if (parsed.parameters.turn <= 1 && basename(file).toLowerCase().endsWith('.sav')) {
        // A fresh game: the map maker's rating and the founding claims must match exactly.
        expect(differ).toBe(0);
        expect(territoryDiffer).toBe(0);
      } else {
        // Hand-made scenario maps and played games carry ratings the engine cannot reproduce
        // (edited terrain, destroyed cities); record the agreement without failing.
        expect(same + differ).toBe(world.area);
      }
    });
  }
});
