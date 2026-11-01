/**
 * A simulated human plays a whole game at random, trying every order the UI offers, while each
 * turn the world is checked for damage. Finds crashes and corrupt state that scripted tests miss.
 *
 *   npx vite-node scripts/fuzz-game.ts <game-folder> <seed> <turns> [humans]
 */
import { readFileSync } from 'node:fs';
import {
  airlift,
  airliftTargets,
  buyProduction,
  canFoundCity,
  changeProduction,
  cycleSpecialist,
  fortify,
  foundCity,
  Game,
  movesLeft,
  newGame,
  restoreGame,
  Rng,
  sellImprovement,
  setHomeCity,
  setRates,
  snapshotGame,
  startRevolution,
  tryMove,
  type Conversation,
} from '@mudbrick/engine';
import { decodeText, parseRules } from '@mudbrick/formats';
import { engineRules } from '../apps/web/src/worldFromSave.js';

const [dir, seedArg, turnsArg, humansArg] = process.argv.slice(2);
if (!dir) throw new Error('usage: fuzz-game.ts <game-folder> <seed> <turns> [humans]');
const seed = Number(seedArg ?? 1);
const turns = Number(turnsArg ?? 300);
const rules = engineRules(parseRules(decodeText(new Uint8Array(readFileSync(`${dir}/RULES.TXT`)))));
const rng = new Rng(seed);
const dice = new Rng(seed + 1000);
const result = newGame(rules, rng, {
  map: {
    columns: 50,
    rows: 80,
    flatEarth: false,
    landMass: 1,
    landForm: 1,
    climate: 1,
    temperature: 1,
    age: 1,
  },
  difficulty: seed % 6,
  civCount: 7,
  humanTribe: seed % 21,
  leaders: rules.leaders,
  barbarianActivity: seed % 4,
} as never);
let extra = Number(humansArg ?? 1) - 1;
for (const c of result.world.civs) {
  if (extra <= 0 || c.slot === 0 || !c.inPlay || c.isHuman) continue;
  c.isHuman = true;
  extra -= 1;
}
let game = new Game(result.world, rules, rng, { ...result.state, nextSlot: 0 });
game.wantsTalks = true;

const problems = new Map<string, number>();
function problem(text: string): void {
  problems.set(text, (problems.get(text) ?? 0) + 1);
}
const recomputed = new WeakMap<object, { size: number; turn: number; owner: number }>();
{
  // On the prototype, so that it survives the reloads below.
  const ensureWorkers = Game.prototype.ensureWorkers;
  Game.prototype.ensureWorkers = function (this: Game, city, ...rest) {
    ensureWorkers.call(this, city, ...rest);
    recomputed.set(city, { size: city.size, turn: this.state.turn, owner: city.owner });
  };
}

function check(): void {
  const w = game.world;
  const seen = new Set<string>();
  for (const c of w.cities) {
    const k = `${c.position.x},${c.position.y}`;
    if (seen.has(k)) problem('two cities on a square');
    seen.add(k);
    if (!(c.size >= 1) || !Number.isInteger(c.size)) problem(`city size ${c.size}`);
    if (!Number.isFinite(c.foodStored) || !Number.isFinite(c.shieldsStored))
      problem('city box NaN');
    const sp = c.specialists;
    if (sp.entertainers < 0 || sp.taxCollectors < 0 || sp.scientists < 0)
      problem('negative specialists');
    let workers = 0;
    for (let i = 0; i < 20; i++) if (c.worked & (1 << i)) workers += 1;
    // The original lowers a city's size in battle and leaves its citizens where they stand until
    // the next recompute (0x0052d472, 0x00528720). So what is exact is this: no more citizens than
    // the city's size at its last recompute, and a recompute every round.
    const placed = workers + sp.entertainers + sp.taxCollectors + sp.scientists;
    const last = recomputed.get(c);
    if (last && placed > last.size) problem('too many citizens placed');
    // A city taken before its turn and retaken after it misses that round, so two turns is allowed.
    if (last && last.owner === c.owner && game.state.turn - last.turn > 2)
      problem('a city missed its recompute');
    if (c.production.kind === 'unit' && !rules.units[c.production.index])
      problem('bad unit production');
    if (c.production.kind === 'improvement' && !rules.improvements[c.production.index])
      problem('bad improvement production');
    if (!w.civs.some((x) => x.slot === c.owner && (x.inPlay || c.owner === 0)))
      problem('city of a dead civ');
  }
  const ids = new Set(w.cities.map((c) => c.id));
  for (const u of w.units) {
    const { x, y } = u.position;
    if (!Number.isInteger(x) || !Number.isInteger(y) || y < 0 || y >= w.rows)
      problem('unit off the map');
    else if ((x + y) & 1) problem('unit on a bad square');
    if (!rules.units[u.type]) problem('bad unit type');
    if (u.homeCity !== null && !ids.has(u.homeCity)) problem('unit with a missing home');
    if (!Number.isFinite(u.movesSpent) || u.movesSpent < 0) problem('moves NaN');
    if (
      u.hitPointsLost < 0 ||
      u.hitPointsLost >= (rules.units[u.type]?.hitPointsTens ?? 1) * 10 + 1
    )
      problem('bad damage');
  }
  for (const c of w.civs) {
    if (!Number.isFinite(c.treasury)) problem('treasury NaN');
    if (c.taxRate + c.scienceRate > 10 || c.taxRate < 0 || c.scienceRate < 0)
      problem(`rates ${c.taxRate}/${c.scienceRate}`);
    if (!Number.isFinite(c.reputation ?? 0)) problem('reputation NaN');
  }
}

function talk(t: Conversation): void {
  let step = t.next();
  let n = 0;
  while (!step.done) {
    if ((n += 1) > 500) {
      problem('conversation never ends');
      return;
    }
    const d = step.value;
    let a = dice.nextInt(3);
    if (d.offer) a = d.offer[dice.nextInt(d.offer.length)] ?? 0;
    if (d.amounts) a = d.amounts[dice.nextInt(d.amounts.length + 1)] ?? 0;
    if (d.civs) a = d.civs[dice.nextInt(d.civs.length + 1)] ?? 0;
    if (d.pick) a = d.pick[dice.nextInt(d.pick.length)]?.value ?? -1;
    step = t.next(a);
  }
}

function play(slot: number): void {
  const w = game.world;
  const civ = game.civ(slot);
  const ctx = {
    nuclearPower: game.knows(slot, 59),
    magellans: false,
    lighthouse: false,
    damageSlowsUnits: game.state.realisticCombat,
  };
  for (let t = game.nextPendingTalk(slot); t; t = game.nextPendingTalk(slot)) talk(t);
  if (dice.nextInt(4) === 0) setRates(civ, dice.nextInt(11), dice.nextInt(11));
  if (dice.nextInt(150) === 0 && civ.government !== 0) startRevolution(w, civ);
  if (civ.government === 0 && dice.nextInt(3) === 0) civ.government = 1 + dice.nextInt(6);
  for (const c of [...w.cities]) {
    if (c.owner !== slot) continue;
    const r = dice.nextInt(8);
    if (r === 0) buyProduction(rules, civ, c);
    if (r === 1) sellImprovement(rules, civ, c, 2 + dice.nextInt(37));
    if (r === 2) game.clickCitySquare(c, dice.nextInt(21));
    if (r === 3) cycleSpecialist(c, dice.nextInt(3) as 0 | 1 | 2);
    if (r === 4) {
      const n = dice.nextInt(rules.units.length);
      changeProduction(rules, c, { kind: 'unit', index: n }, game.state.difficulty);
    }
    if (r === 5) {
      const n = 1 + dice.nextInt(38);
      changeProduction(rules, c, { kind: 'improvement', index: n }, game.state.difficulty);
    }
  }
  for (const c of w.civs) {
    if (c.slot !== 0 && c.slot !== slot && c.inPlay && dice.nextInt(12) === 0) {
      if (!c.isHuman) talk(game.talkTo(slot, c.slot, true));
    }
  }
  for (const u of [...w.units]) {
    if (u.owner !== slot || !w.units.includes(u)) continue;
    const v = canFoundCity(w, rules, u);
    if (v.ok && !v.joins && dice.nextInt(2) === 0) {
      const city = foundCity(w, rules, civ, u, { name: `C${w.cities.length}` });
      game.ensureWorkers(city);
      continue;
    }
    const r = dice.nextInt(10);
    if (r === 0) {
      fortify(u);
      continue;
    }
    if (r === 1) setHomeCity(w, u);
    if (r === 2) {
      const a = airliftTargets(w, rules, u);
      if ('targets' in a && a.targets[0]) airlift(w, dice, u, a.targets[0], 0);
    }
    for (let i = 0; i < 4 && w.units.includes(u) && movesLeft(rules, u, ctx) > 0; i++) {
      const ns = w.neighbours(u.position.x, u.position.y).filter(Boolean);
      const to = ns[dice.nextInt(ns.length)];
      if (!to) break;
      const m = tryMove(w, rules, game.rng, u, to, ctx);
      if (m.kind !== 'moved') break;
    }
  }
}

let last = -1;
let slowest = 0;
const started = Date.now();
for (let step = 0; game.state.turn < turns && !game.state.gameOver && step < turns * 10; step++) {
  const t0 = Date.now();
  game.playUntilHuman();
  const spent = Date.now() - t0;
  slowest = Math.max(slowest, spent);
  if (process.env.FUZZ_TIMES && game.state.turn % 25 === 0)
    console.log('turn', game.state.turn, spent, 'ms');
  check();
  const slot = game.state.movingHuman;
  if (slot === undefined) break;
  if (!game.world.civs.some((c) => c.isHuman && c.inPlay && c.slot !== 0)) break;
  play(slot);
  check();
  if (game.state.turn !== last && game.state.turn % 25 === 0) {
    last = game.state.turn;
    const text = snapshotGame(game, slot);
    const back = restoreGame(text, rules);
    back.game.wantsTalks = true;
    if (
      snapshotGame(back.game, slot).replace(/"savedAt":"[^"]*"/, '') !==
      text.replace(/"savedAt":"[^"]*"/, '')
    ) {
      problem('snapshot changes on reload');
      const a2 = text.replace(/"savedAt":"[^"]*"/, '');
      const b2 = snapshotGame(back.game, slot).replace(/"savedAt":"[^"]*"/, '');
      let i = 0;
      while (a2[i] === b2[i]) i += 1;
      if (process.env.FUZZ_DIFF)
        console.log(
          'DIFF',
          a2.length,
          b2.length,
          i,
          a2.slice(Math.max(0, i - 60), i + 60),
          ' <<>> ',
          b2.slice(Math.max(0, i - 60), i + 60),
        );
    }
    game = back.game;
  }
}
const w = game.world;
console.log(
  `seed ${seed}: turn ${game.state.turn}, ${w.cities.length} cities, ${w.units.length} units, over: ${game.state.gameOver?.reason ?? 'no'}, ${Math.round((Date.now() - started) / 1000)}s, slowest turn ${slowest} ms`,
);
for (const [k, v] of problems) console.log(`  PROBLEM ${k} × ${v}`);
