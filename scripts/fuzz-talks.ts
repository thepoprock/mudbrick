/**
 * Plays every conversation in a save with random answers, to prove the negotiation script always
 * ends, and reports which dialogs it reached.
 *
 *   npx vite-node scripts/fuzz-talks.ts <rules.txt> <GAME.TXT> <file.SAV>... [rounds]
 */
import { readFileSync } from 'node:fs';
import { Rng } from '@mudbrick/engine';
import { decodeText, parsePopups, parseRules, parseSave } from '@mudbrick/formats';
import { gameFromSave } from '../apps/web/src/gameFromSave.js';
import { worldFromSave } from '../apps/web/src/worldFromSave.js';

const args = process.argv.slice(2);
const [rulesPath, textPath, ...rest] = args;
if (!rulesPath || !textPath) throw new Error('usage: fuzz-talks.ts <rules> <GAME.TXT> <SAV>...');
const rounds = Number(rest[rest.length - 1]) > 0 ? Number(rest.pop()) : 50;
const rulesText = decodeText(new Uint8Array(readFileSync(rulesPath)));
const popups = parsePopups(decodeText(new Uint8Array(readFileSync(textPath))));
const seen = new Map<string, number>();
const dice = new Rng(12345);
let talks = 0;
let longest = 0;
for (const file of rest) {
  for (let round = 0; round < rounds; round++) {
    const bytes = new Uint8Array(readFileSync(file));
    const save = parseSave(bytes);
    const rules = parseRules(rulesText);
    const world = worldFromSave(save, rules);
    const game = gameFromSave(save, rules, world);
    const human = world.civs.find((c) => c.isHuman && c.slot !== 0)?.slot ?? 1;
    for (const c of world.civs) {
      if (c.slot === 0 || c.slot === human || !c.inPlay) continue;
      const talk = game.talkTo(human, c.slot, round % 2 === 0);
      let step = talk.next();
      let n = 0;
      while (!step.done) {
        n += 1;
        if (n > 400) throw new Error(`no end: ${step.value.key}`);
        const d = step.value;
        seen.set(d.key, (seen.get(d.key) ?? 0) + 1);
        if (!popups.has(d.key)) throw new Error(`no section ${d.key}`);
        const lines = popups.get(d.key)?.text ?? [];
        const gap = lines.indexOf('');
        const count = gap < 0 ? 1 : lines.slice(gap + 1).filter((l) => l !== '').length;
        let answer = dice.nextInt(Math.max(1, count));
        if (d.offer) answer = d.offer[dice.nextInt(d.offer.length)] ?? 0;
        if (d.civs) answer = d.civs[dice.nextInt(d.civs.length + 1)] ?? 0;
        if (d.amounts) answer = d.amounts[dice.nextInt(d.amounts.length + 1)] ?? 0;
        step = talk.next(answer);
      }
      talks += 1;
      longest = Math.max(longest, n);
    }
  }
}
console.log(`${talks} conversations, longest ${longest} dialogs, ${seen.size} dialogs reached`);
console.log(
  [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(' · '),
);
