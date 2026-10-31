import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSave } from '../src/save.js';
import { patchFromSave, writeSave } from '../src/saveWriter.js';
import { ORIGINAL_GAME_DIR } from './helpers.js';

function findSaves(dir: string, depth = 0): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (depth < 2) out.push(...findSaves(p, depth + 1));
    } else if (/\.(sav|scn)$/i.test(name)) out.push(p);
  }
  return out;
}

const describeIf = ORIGINAL_GAME_DIR ? describe : describe.skip;

describeIf('save writer round trip', () => {
  const files = ORIGINAL_GAME_DIR ? findSaves(ORIGINAL_GAME_DIR) : [];
  it('finds the shipped saves and scenarios', () => {
    expect(files.length).toBeGreaterThan(10);
  });
  for (const file of files) {
    it(`reproduces ${file.slice((ORIGINAL_GAME_DIR ?? '').length + 1)}`, () => {
      const bytes = new Uint8Array(readFileSync(file));
      const parsed = parseSave(bytes);
      const written = writeSave(bytes, parsed, patchFromSave(parsed));
      expect(written.length).toBe(bytes.length);
      const again = parseSave(written);
      expect(again.units).toEqual(parsed.units);
      expect(again.cities).toEqual(parsed.cities);
      expect(again.civs).toEqual(parsed.civs);
      expect(again.techs).toEqual(parsed.techs);
      expect(again.wonders).toEqual(parsed.wonders);
      expect(again.parameters).toEqual(parsed.parameters);
      expect(again.map.squares).toEqual(parsed.map.squares);
      // Everything else was copied verbatim, so the files should match byte for byte except
      // where the original kept stale link or unknown bytes; count the differences.
      let diffs = 0;
      for (let i = 0; i < bytes.length; i++) if (bytes[i] !== written[i]) diffs++;
      expect(diffs).toBeLessThan(bytes.length / 1000);
    });
  }
});
