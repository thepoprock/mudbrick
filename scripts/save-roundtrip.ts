/**
 * Play a few turns of a save with the engine, write it back with the web app's builder, and
 * parse the result: a Node-side check that saving a running game produces a file the parser
 * accepts and that carries the game forward. Needs the dev-game symlink or an explicit folder.
 *
 *   npx vite-node scripts/save-roundtrip.ts [folder] [TUTORIAL.SAV] [turns]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Game, Rng, type GameState } from '@mudbrick/engine';
import { decodeText, parseRules, parseSave } from '@mudbrick/formats';
import { saveFromGame } from '../apps/web/src/saveFromGame.js';
import { engineRules, worldFromSave } from '../apps/web/src/worldFromSave.js';

const [, , folderArg = 'apps/web/dev-game', gameArg = 'TUTORIAL.SAV', turnsArg = '3'] =
  process.argv;
const folder = folderArg;
const rulesName = readdirSync(folder).find((f) => f.toLowerCase() === 'rules.txt');
if (!rulesName) throw new Error(`no RULES.TXT in ${folder}`);
const rules = parseRules(decodeText(new Uint8Array(readFileSync(join(folder, rulesName)))));
const bytes = new Uint8Array(readFileSync(join(folder, gameArg)));
const parsed = parseSave(bytes);
const world = worldFromSave(parsed, rules);
const state: GameState = {
  turn: parsed.parameters.turn,
  difficulty: parsed.parameters.difficulty,
  realisticCombat: !parsed.options.simplifiedCombat,
  firstDiscoveredBy: [...parsed.techs.firstDiscoveredBy],
};
const game = new Game(world, engineRules(rules), new Rng(42), state);
const turns = Number(turnsArg);
for (let i = 0; i < turns; i++) game.endTurn();
const written = saveFromGame(bytes, parsed, game);
const again = parseSave(written);
console.log(
  `${gameArg}: turn ${parsed.parameters.turn} → ${again.parameters.turn}; ` +
    `units ${parsed.units.length} → ${again.units.length}; cities ${parsed.cities.length} → ${again.cities.length}; ` +
    `bytes ${bytes.length} → ${written.length}; warnings: ${again.warnings.join('; ') || 'none'}`,
);
const human = again.civs.find((c) => again.parameters.humanSlots[c.slot]);
console.log(
  `human treasury ${human?.treasury}, research ${human?.researchProgress}/${human?.researching ?? 'none'}`,
);
for (const c of again.cities.slice(0, 3))
  console.log(
    ` city ${c.name} size ${c.size} owner ${c.owner} food ${c.foodStored} shields ${c.shieldsStored} prod ${JSON.stringify(c.production)} worked ${c.workedSquaresMask.toString(2)}`,
  );
const world2 = worldFromSave(again, rules);
if (
  world2.units.length !== game.world.units.length ||
  world2.cities.length !== game.world.cities.length
) {
  throw new Error('reloaded world differs in unit or city count');
}
console.log('reloaded world matches the running game in unit and city counts');
