import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Conformance tests read the ORIGINAL game files, which are never part of this repository.
 * Set CIV2_DIR to a folder containing RULES.TXT, *.MP, *.GIF … to enable them.
 * The default below is only a convenience for the maintainers' machines.
 */
export const CIV2_DIR = process.env['CIV2_DIR'] ?? join(homedir(), 'civ2-decode', 'game', 'civ2');
export const hasGameFiles = existsSync(join(CIV2_DIR, 'RULES.TXT'));

export function gameFile(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(CIV2_DIR, name)));
}

/** All files under CIV2_DIR (recursively) whose lower-cased name ends with `ext`. */
export function gameFilesWithExtension(ext: string, dir = CIV2_DIR): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...gameFilesWithExtension(ext, p));
    else if (e.name.toLowerCase().endsWith(ext)) out.push(p);
  }
  return out;
}
