/**
 * Report the per-civilization state of a save in the metrics the engine probes use:
 * cities, units, advances, terrain work in city radii, trade, caravans and routes.
 *   npx vite-node scripts/analyze-save.ts <game-folder> <file.SAV>
 */
import { readFileSync } from 'node:fs';
import { SquareFlag } from '@mudbrick/engine';
import { decodeText, parseRules, parseSave } from '@mudbrick/formats';
import { worldFromSave } from '../apps/web/src/worldFromSave.js';

const [dir, file] = process.argv.slice(2);
if (!dir || !file) throw new Error('usage: analyze-save.ts <game-folder> <file.SAV>');
const rules = parseRules(decodeText(new Uint8Array(readFileSync(`${dir}/RULES.TXT`))));
const save = parseSave(new Uint8Array(readFileSync(file)));
const w = worldFromSave(save, rules);
console.log(
  `turn ${save.parameters.turn}, difficulty ${save.parameters.difficulty}, ${w.cities.length} cities, ${w.units.length} units`,
);
const lmOf = (p: { x: number; y: number }) => (w.landmass[w.index(p.x, p.y)] ?? 0) & 63;
for (const c of w.civs) {
  if (c.slot === 0 || !c.inPlay) continue;
  const cities = w.cities.filter((x) => x.owner === c.slot);
  const units = w.units.filter((u) => u.owner === c.slot);
  let roads = 0,
    irr = 0,
    mines = 0,
    trade = 0,
    routes = 0;
  for (const city of cities) {
    trade += city.lastTrade ?? 0;
    routes += city.tradeRoutes.length;
    for (let i = 0; i < 21; i++) {
      const q = w.radiusSquare(city.position.x, city.position.y, i);
      if (!q) continue;
      if (w.hasFlag(q.x, q.y, SquareFlag.Road)) roads++;
      if (w.hasFlag(q.x, q.y, SquareFlag.Irrigation)) irr++;
      if (w.hasFlag(q.x, q.y, SquareFlag.Mine)) mines++;
    }
  }
  const n = Math.max(1, cities.length);
  const byRole = new Map<number, number>();
  for (const u of units) {
    const r = rules.units[u.type]?.role ?? -1;
    byRole.set(r, (byRole.get(r) ?? 0) + 1);
  }
  const lms = new Set(cities.map((x) => lmOf(x.position)));
  console.log(
    `${(c.isHuman ? '*' : ' ') + c.name.padEnd(13)} cities ${String(cities.length).padStart(2)} (sizes ${cities.map((x) => x.size).join(',')}) on ${lms.size} lm | units ${String(units.length).padStart(3)} [settlers ${byRole.get(5) ?? 0}, caravans ${byRole.get(7) ?? 0}, diplomats ${byRole.get(6) ?? 0}, ships ${units.filter((u) => rules.units[u.type]?.domain === 2).length}] | advances ${c.advancesCount} gov ${c.government} gold ${c.treasury} | per city: roads ${(roads / n).toFixed(1)} irr ${(irr / n).toFixed(1)} mines ${(mines / n).toFixed(1)} trade ${(trade / n).toFixed(1)} routes ${routes}`,
  );
}
