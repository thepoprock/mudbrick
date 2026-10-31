import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Conformance tests read the ORIGINAL game's files, which are never part of this repository.
 * Point ORIGINAL_GAME_DIR at your own installed copy (the folder that holds RULES.TXT, the
 * *.MP maps and the *.GIF sheets) to enable them:
 *
 *   ORIGINAL_GAME_DIR=/path/to/your/copy npm test
 *
 * When the variable is unset the conformance suites are skipped and only the inline-fixture
 * unit tests run, which is what happens in CI.
 */
export const ORIGINAL_GAME_DIR = process.env['ORIGINAL_GAME_DIR'];
export const hasGameFiles =
  ORIGINAL_GAME_DIR !== undefined && existsSync(join(ORIGINAL_GAME_DIR, 'RULES.TXT'));

function gameDir(): string {
  if (!hasGameFiles || ORIGINAL_GAME_DIR === undefined) {
    throw new Error('ORIGINAL_GAME_DIR is not set or does not contain RULES.TXT');
  }
  return ORIGINAL_GAME_DIR;
}

/** Read one file from the original game folder. */
export function gameFile(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(gameDir(), name)));
}

/** All files under the original game folder (recursively) whose lower-cased name ends with `ext`. */
export function gameFilesWithExtension(ext: string, dir = gameDir()): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...gameFilesWithExtension(ext, p));
    else if (e.name.toLowerCase().endsWith(ext)) out.push(p);
  }
  return out;
}
