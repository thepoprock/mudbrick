/**
 * Calibrate against the original: for each of its saves, report the facts the original recorded
 * and what the engine computes from the same state. Government scores are at civ record +0x3d4;
 * research rank is where the original's choice falls in our valuation (0 = our top choice).
 *   npx vite-node scripts/compare-saves.ts <game-folder> <file.SAV>...
 * Compare whole games only at the same difficulty with a human present: see probe-engine.ts.
 */
import { readFileSync } from 'node:fs';
import { advanceValue, governmentScoresOf, researchChoices } from '@mudbrick/engine';
import { decodeText, parseRules, parseSave } from '@mudbrick/formats';
import { gameFromSave } from '../apps/web/src/gameFromSave.js';
import { engineRules, worldFromSave } from '../apps/web/src/worldFromSave.js';

const [dir, ...files] = process.argv.slice(2);
const parsed = parseRules(decodeText(new Uint8Array(readFileSync(`${dir}/RULES.TXT`))));
const rules = engineRules(parsed);
for (const f of files) {
  const bytes = new Uint8Array(readFileSync(f));
  const save = parseSave(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const before = worldFromSave(save, parsed);
  const units = new Map<string, number>();
  for (const u of before.units) {
    if (u.owner === 0) continue;
    const n = rules.units[u.type]?.name ?? String(u.type);
    units.set(n, (units.get(n) ?? 0) + 1);
  }
  const counts = [...units.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  let irrigated = 0;
  let mined = 0;
  let roads = 0;
  for (const flags of before.flags) {
    if (flags & 8) irrigated += 1;
    if (flags & 32) mined += 1;
    if (flags & 2) roads += 1;
  }
  console.log(`turn ${save.parameters.turn}, difficulty ${save.parameters.difficulty}`);
  console.log(`  ${before.cities.length} cities, ${before.units.length} units`);
  console.log(`  terrain: irrigation ${irrigated}, mines ${mined}, roads ${roads}`);
  console.log(`  units: ${counts.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const game = gameFromSave(save, parsed, before);
  const ctxOf = game.researchValueContext.bind(game);
  for (const c of before.civs) {
    if (c.slot === 0 || c.isHuman || c.researching === null) continue;
    const ctx = ctxOf(c);
    const list = researchChoices(rules, c, save.parameters.difficulty)
      .map((a) => ({ a, v: advanceValue(rules, c.slot, a, ctx) }))
      .sort((x, y) => y.v - x.v);
    const at = list.findIndex((x) => x.a === c.researching);
    console.log(`  ${c.name}: research rank ${at} of ${list.length}`);
  }
  const after = worldFromSave(save, parsed);
  const next = gameFromSave(save, parsed, after);
  next.endTurn();
  for (const c of after.civs) {
    if (c.slot === 0) continue;
    const o = save.offsets.civs + save.offsets.civRecordSize * c.slot;
    const original = Array.from({ length: 7 }, (_, i) => dv.getInt16(o + 0x3d4 + i * 2, true));
    const ours = [...governmentScoresOf(c)].join(',');
    console.log(`  ${c.name}: scores ${original.join(',')} | engine ${ours} (one turn on)`);
  }
}
