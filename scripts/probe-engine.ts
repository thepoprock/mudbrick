/**
 * Run the engine's own new game with the calibration settings (normal world, Prince, seven
 * civilizations, roving barbarians) and print the same metrics analyze-save.ts prints, at the
 * turns given.   npx vite-node scripts/probe-engine.ts <game-folder> <seed> <turn,turn,...>
 */
import { readFileSync } from 'node:fs';
import { Game, newGame, Rng, SquareFlag, type World } from '@mudbrick/engine';
import { decodeText, parseRules, type Rules } from '@mudbrick/formats';
import { engineRules } from '../apps/web/src/worldFromSave.js';

const [dir, seedArg, turnsArg] = process.argv.slice(2);
if (!dir) throw new Error('usage: probe-engine.ts <game-folder> [seed] [turns]');
const seed = Number(seedArg ?? 1);
const turns = (turnsArg ?? '51,100,150,200').split(',').map(Number);
const parsed = parseRules(decodeText(new Uint8Array(readFileSync(`${dir}/RULES.TXT`))));
const rules = engineRules(parsed);

function report(w: World, rulesIn: Rules, turn: number): void {
  console.log(`turn ${turn}, ${w.cities.length} cities, ${w.units.length} units`);
  const lmOf = (p: { x: number; y: number }) => (w.landmass[w.index(p.x, p.y)] ?? 0) & 63;
  for (const c of w.civs) {
    if (c.slot === 0 || !c.inPlay) continue;
    const cities = w.cities.filter((x) => x.owner === c.slot);
    const units = w.units.filter((u) => u.owner === c.slot);
    let roads = 0;
    let irr = 0;
    let mines = 0;
    let trade = 0;
    let routes = 0;
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
      const r = rulesIn.units[u.type]?.role ?? -1;
      byRole.set(r, (byRole.get(r) ?? 0) + 1);
    }
    const lms = new Set(cities.map((x) => lmOf(x.position)));
    console.log(
      `${(c.isHuman ? '*' : ' ') + c.name.padEnd(13)} cities ${String(cities.length).padStart(2)} (sizes ${cities.map((x) => x.size).join(',')}) on ${lms.size} lm | units ${String(units.length).padStart(3)} [settlers ${byRole.get(5) ?? 0}, caravans ${byRole.get(7) ?? 0}, diplomats ${byRole.get(6) ?? 0}, ships ${units.filter((u) => rulesIn.units[u.type]?.domain === 2).length}] | advances ${c.advancesCount} gov ${c.government} gold ${c.treasury} | per city: roads ${(roads / n).toFixed(1)} irr ${(irr / n).toFixed(1)} mines ${(mines / n).toFixed(1)} trade ${(trade / n).toFixed(1)} routes ${routes}`,
    );
  }
}

const rng = new Rng(seed);
const r = newGame(rules, rng, {
  map: {
    columns: 50,
    rows: 80,
    flatEarth: false,
    landMass: 1,
    landForm: 0,
    climate: 0,
    temperature: 0,
    age: 1,
  },
  difficulty: 2,
  civCount: 7,
  humanTribe: 0,
  leaders: parsed.leaders,
  barbarianActivity: 1,
});
// The human stays, idle. Removing it changes computer behaviour: unit totals rose by half.
const game = new Game(r.world, rules, rng, r.state);
let t = 0;
for (const target of turns) {
  while (t < target) {
    game.endTurn();
    t++;
  }
  report(r.world, parsed, t);
}
