/**
 * Calibrate the computer's build choice against the original: load the original's own saves, run
 * the engine's chooser for every computer city in exactly that state, and compare with what the
 * original was building. `same` is a measured match count; a city keeps what it chose earlier, so
 * 100 % is not reachable. Set SHOW=n to print the best-scored options of the first n cities.
 *   npx vite-node scripts/compare-builds.ts <game-folder> <file.SAV>...
 */
import { readFileSync } from 'node:fs';
import type { Production } from '@mudbrick/engine';
import { decodeText, parseRules, parseSave } from '@mudbrick/formats';
import { gameFromSave } from '../apps/web/src/gameFromSave.js';
import { engineRules, worldFromSave } from '../apps/web/src/worldFromSave.js';

const [dir, ...files] = process.argv.slice(2);
const parsed = parseRules(decodeText(new Uint8Array(readFileSync(`${dir}/RULES.TXT`))));
const rules = engineRules(parsed);
const show = Number(process.env.SHOW ?? 0);
const name = (p: Production): string =>
  p.kind === 'unit'
    ? `U:${rules.units[p.index]?.name ?? p.index}`
    : `I:${rules.improvements[p.index]?.name ?? p.index}`;
const tally = (m: Map<string, number>): string =>
  [...m.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');

for (const f of files) {
  const save = parseSave(new Uint8Array(readFileSync(f)));
  // One year's run supplies the strategy tables a loaded game has not yet computed.
  const warmWorld = worldFromSave(save, parsed);
  const warm = gameFromSave(save, parsed, warmWorld);
  for (const c of warmWorld.civs) c.isHuman = false;
  warm.endTurn();
  const world = worldFromSave(save, parsed);
  const game = gameFromSave(save, parsed, world);
  for (const c of world.civs) {
    const o = warmWorld.civs.find((x) => x.slot === c.slot);
    if (o?.strategy) c.strategy = o.strategy;
  }
  const original = new Map<string, number>();
  const engine = new Map<string, number>();
  let same = 0;
  let n = 0;
  for (const city of world.cities) {
    const civ = world.civs.find((x) => x.slot === city.owner);
    if (!civ || civ.isHuman) continue;
    const before = city.production;
    const scores: [number, string][] = [];
    game.buildTrace = (_c, score, p) => scores.push([score, name(p)]);
    game.aiChooseProduction(city);
    const a = name(before);
    const b = name(city.production);
    original.set(a, (original.get(a) ?? 0) + 1);
    engine.set(b, (engine.get(b) ?? 0) + 1);
    if (a === b) same += 1;
    if (n < show) {
      scores.sort((x, y) => x[0] - y[0]);
      const top = scores.slice(0, 9).map(([s, p]) => `${p} ${s}`);
      console.log(`${city.name} size ${city.size} civ ${city.owner} was ${a} | ${top.join(', ')}`);
    }
    n += 1;
    city.production = before;
  }
  console.log(`turn ${save.parameters.turn}: ${n} cities, ${same} same`);
  console.log(`  original ${tally(original)}`);
  console.log(`  engine   ${tally(engine)}`);
}
