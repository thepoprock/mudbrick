import { readFileSync } from 'node:fs';
import { distance, SquareFlag, type World } from '@mudbrick/engine';
import { decodeText, parseRules, parseSave, type Rules } from '@mudbrick/formats';
import { worldFromSave } from '../apps/web/src/worldFromSave.js';
if (process.argv[1]?.endsWith('probe-orig.ts')) {
  const [dir, file] = process.argv.slice(2);
  const rules = parseRules(decodeText(new Uint8Array(readFileSync(`${dir}/RULES.TXT`))));
  const save = parseSave(new Uint8Array(readFileSync(file ?? '')));
  report(worldFromSave(save, rules), rules, save.parameters.turn);
}
export function report(w: World, rulesIn: Rules, turn: number): void {
  console.log(`turn ${turn}`);
  for (const c of w.civs) {
    if (c.slot === 0 || !c.inPlay) continue;
    const settlers = w.units.filter((u) => u.owner === c.slot && rulesIn.units[u.type]?.role === 5);
    const desc = settlers.map((u) => {
      const own = w.cities
        .filter((x) => x.owner === c.slot)
        .map((x) => distance(w, u.position, x.position));
      const d = own.length ? Math.min(...own) : 99;
      return `d${d}/o${u.order === null ? '-' : u.order}/h${u.homeCity === null ? '-' : 'y'}`;
    });
    // roads outside any own city radius (links) vs inside
    let inRadius = 0;
    for (let i = 0; i < w.area; i++) {
      if (!w.hasFlag(w.position(i).x, w.position(i).y, SquareFlag.Road)) continue;
      const p = w.position(i);
      if (
        w.territory[i] !== c.slot &&
        !w.cities.some((x) => x.owner === c.slot && distance(w, x.position, p) <= 2)
      )
        continue;
      if (w.cities.some((x) => x.owner === c.slot && distance(w, x.position, p) <= 2)) inRadius++;
    }
    console.log(
      `${(c.isHuman ? '*' : ' ') + c.name.padEnd(12)} sci ${c.scienceRate} tax ${c.taxRate} beakers ${c.scienceStored} researching ${c.researching} | settlers ${settlers.length}: ${desc.join(' ')} | roads near cities ${inRadius}`,
    );
  }
}
