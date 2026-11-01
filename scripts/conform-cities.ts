/**
 * Compare the engine's city figures with the ones the original stored in a save: every city
 * record holds its last computed food, shields, trade, tax, science and happiness. Needs no UI
 * and no screenshots, and AI moves cannot disturb it.
 *
 *   npx vite-node scripts/conform-cities.ts <rules.txt> <file.SAV>... [--show N]
 */
import { readFileSync } from 'node:fs';
import {
  corruption,
  mood,
  rawYields,
  routeIncomeTotal,
  shieldTotals,
  tradeSplit,
  unitSupport,
} from '@mudbrick/engine';
import { decodeText, parseRules, parseSave } from '@mudbrick/formats';
import { gameFromSave } from '../apps/web/src/gameFromSave.js';
import { worldFromSave } from '../apps/web/src/worldFromSave.js';

const args = process.argv.slice(2);
const showAt = args.indexOf('--show');
const show = showAt >= 0 ? Number(args[showAt + 1]) : 0;
const [rulesPath, ...rest] = showAt >= 0 ? args.slice(0, showAt) : args;
if (!rulesPath || rest.length === 0)
  throw new Error('usage: conform-cities.ts <rules.txt> <file.SAV>...');
const rules = parseRules(decodeText(new Uint8Array(readFileSync(rulesPath))));
const FIELDS = ['food', 'shields', 'trade', 'tax', 'science', 'happy', 'unhappy'] as const;
for (const file of rest) {
  const save = parseSave(new Uint8Array(readFileSync(file)));
  const world = worldFromSave(save, rules);
  const game = gameFromSave(save, rules, world);
  const miss: Record<string, number> = {};
  const humanMiss: Record<string, number> = {};
  let humans = 0;
  const lines: string[] = [];
  let n = 0;
  for (const city of world.cities) {
    const rec = save.cities.find(
      (r) =>
        r.name === city.name &&
        r.position.x === city.position.x &&
        r.position.y === city.position.y,
    );
    if (!rec) continue;
    n += 1;
    const human = world.civs.find((c) => c.slot === city.owner)?.isHuman === true;
    if (human) humans += 1;
    const ctx = game.cityContext(city);
    const raw = rawYields(world, rules, city, ctx);
    const support = unitSupport(
      world,
      rules,
      city,
      ctx,
      world.units.filter((u) => u.homeCity === city.id),
    );
    const shields = shieldTotals(rules, city, ctx, raw.shields, support.shields);
    const own = raw.trade - corruption(rules, city, ctx, raw.trade, false);
    const routes = routeIncomeTotal(world, rules, city, own);
    const split = tradeSplit(rules, city, ctx, raw.trade + routes);
    const m = mood(rules, city, ctx, {
      luxuries: split.luxuries,
      militaryInCity: support.inCity,
      militaryAbroad: support.abroad,
      noMilitaryUnhappiness: support.abroad === 0,
    });
    const mine = {
      food: raw.food,
      shields: shields.produced,
      trade: raw.trade + routes - split.corruption,
      tax: split.tax,
      science: split.science,
      happy: m.happy,
      unhappy: m.unhappy,
    };
    const theirs = {
      food: rec.foodProduction,
      shields: rec.shieldProduction,
      trade: rec.tradeIcons,
      tax: rec.tax,
      science: rec.science,
      happy: rec.happy,
      unhappy: rec.unhappy,
    };
    const bad = FIELDS.filter((f) => mine[f] !== theirs[f]);
    for (const f of bad) {
      miss[f] = (miss[f] ?? 0) + 1;
      if (human) humanMiss[f] = (humanMiss[f] ?? 0) + 1;
    }
    if (bad.length > 0 && lines.length < show)
      lines.push(
        `  ${city.name} (slot ${city.owner}, size ${city.size}): ${bad.map((f) => `${f} ${mine[f]} vs ${theirs[f]}`).join(', ')}`,
      );
  }
  console.log(
    `${file.split('/').pop()} t${save.parameters.turn} cities ${n}: ` +
      FIELDS.map((f) => `${f} ${n - (miss[f] ?? 0)}`).join(' ') +
      ` | human ${humans}: ` +
      FIELDS.map((f) => humanMiss[f] ?? 0).join('/'),
  );
  for (const l of lines) console.log(l);
}
