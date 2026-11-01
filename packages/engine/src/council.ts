/**
 * The High Council (0x004d8480): five advisors rate the civilization 1 to 7, and each rating
 * selects a section of COUNCIL0–2.TXT. Specification: docs/engine/advisors.md.
 */
import { treatiesOf, TREATY } from './diplomacy.js';
import { advanceIndex, IMPROVEMENT } from './rules.js';
import { improvementUpkeep } from './upkeep.js';
import type { Game } from './game.js';
import type { Rng } from './rng.js';

const CARAVAN = 48;
const FREIGHT = 49;
const TRADE = 84;
const CITY_WALLS = 8;

const peers = () => [1, 2, 3, 4, 5, 6, 7];

/** 0 ancient, 1 middle, 2 modern (0x00519291). */
export function councilEra(game: Game, slot: number): number {
  if (game.knows(slot, 5) && game.knows(slot, 24)) return 2;
  if (game.knows(slot, 60) && game.knows(slot, 38)) return 1;
  return 0;
}

function caravans(game: Game, slot: number): number {
  return game.world.units.filter(
    (u) => u.owner === slot && (u.type === CARAVAN || u.type === FREIGHT),
  ).length;
}

/** 0x00490e40. */
export function militaryRating(game: Game, slot: number): number {
  const civ = game.civ(slot);
  const cities = game.world.cities.filter((c) => c.owner === slot);
  const n = Math.max(1, cities.length);
  const barracks = cities.filter((c) => c.improvements[IMPROVEMENT.barracks]).length;
  const capital = cities.find((c) => c.improvements[IMPROVEMENT.palace]);
  const units = game.world.units.filter((u) => u.owner === slot).length;
  if (Math.trunc((n - 1 + units) / n) < (civ.government < 5 ? 1 : 0) + 2) return 1;
  const sea = Array<number>(8).fill(0);
  const land = Array<number>(8).fill(0);
  for (const s of peers()) {
    if (game.knows(s, 75)) sea[s] = (sea[s] ?? 0) + 1;
    if (game.knows(s, 59)) sea[s] = (sea[s] ?? 0) + 1;
    for (const t of game.rules.units) {
      const p = advanceIndex(t.preq);
      if (p !== null && !game.knows(s, p)) continue;
      if (t.domain === 2) sea[s] = (sea[s] ?? 0) + 1;
      else if (t.role === 0 || t.role === 1) land[s] = (land[s] ?? 0) + 1;
    }
  }
  let landBehind = 0;
  let seaBehind = 0;
  let wars = 0;
  for (const s of peers()) {
    if (s === slot) continue;
    if (((treatiesOf(civ)[s] ?? 0) & TREATY.war) !== 0) wars += 1;
    if ((sea[slot] ?? 0) < (sea[s] ?? 0)) seaBehind += 1;
    if ((land[slot] ?? 0) < (land[s] ?? 0)) landBehind += 1;
  }
  const half = (game.world.civs.filter((c) => c.inPlay).length - 1) >> 1;
  if (landBehind > half) return 2;
  if (seaBehind > half) return 3;
  const walled =
    !game.knows(slot, 47) ||
    !capital ||
    capital.improvements[CITY_WALLS] === true ||
    game.ownsWonder(slot, IMPROVEMENT.greatWall);
  if (!walled) return 5;
  if (barracks === 0) return 4;
  return wars === 0 && game.negotiationEnv().rank(slot) > 4 ? 7 : 6;
}

/** 0x0049126a. */
export function scienceRating(game: Game, slot: number, era: number): number {
  const civ = game.civ(slot);
  let ahead = 0;
  for (const s of peers()) {
    if (s === slot) continue;
    const o = game.world.civs.find((c) => c.slot === s);
    if (civ.advancesCount <= (o?.advancesCount ?? 0)) ahead += 1;
  }
  if (ahead === 0) return 7;
  if (civ.government < 5) {
    if (civ.government !== 4 && civ.scienceRate < 6) return 2;
  } else if (civ.scienceRate < 4) return 2;
  const building = [6, 12, 26][era] ?? 26;
  const cities = game.world.cities.filter((c) => c.owner === slot);
  const have = cities.filter((c) => c.improvements[building]).length;
  const routes = caravans(game, slot) + cities.reduce((n, c) => n + c.tradeRoutes.length, 0);
  const preq = advanceIndex(game.rules.improvements[building]?.preq);
  if (preq !== null && game.knows(slot, preq) && have < cities.length >> 1) return 3;
  if (game.knows(slot, TRADE) && routes < cities.length >> 2) return 4;
  const inPlay = game.world.civs.filter((c) => c.inPlay).length;
  return ahead < inPlay >> 1 ? 5 : 1;
}

/** 0x0049155b. */
export function tradeRating(game: Game, slot: number, era: number): number {
  const civ = game.civ(slot);
  const cities = game.world.cities.filter((c) => c.owner === slot);
  const [advance, building, share] = [
    [20, 5, 2],
    [6, 10, 3],
    [22, 22, 4],
  ][era] ?? [22, 22, 4];
  let income = 0;
  let costs = 0;
  let have = 0;
  const ctx = {
    difficulty: game.state.difficulty,
    ownsWonder: (i: number) => game.ownsWonder(slot, i),
    shieldRows: game.rules.cosmic.shieldBoxRows,
  };
  let routes = caravans(game, slot);
  for (const c of cities) {
    routes += c.tradeRoutes.length;
    if (c.improvements[building ?? 0]) have += 1;
    if (!c.inDisorder) income += game.cityFigures(c).tax;
    for (let i = 0; i < 39; i++)
      if (c.improvements[i]) costs += improvementUpkeep(game.rules, civ, i, ctx);
  }
  if (income < costs && civ.treasury < 100) return 1;
  if (!game.knows(slot, advance ?? 0)) return 2;
  if (have < Math.trunc(cities.length / (share ?? 1))) return 3;
  if (!game.knows(slot, TRADE)) return 4;
  if (routes < cities.length >> 2) return 5;
  return income - costs < 6 ? 6 : 7;
}

/** 0x0049198f. */
export function foreignRating(game: Game, slot: number, era: number): number {
  const civ = game.civ(slot);
  let met = 0;
  let allies = 0;
  let wars = 0;
  let embassies = 0;
  const marco =
    game.ownsWonder(slot, IMPROVEMENT.unitedNations) ||
    game.ownsWonder(slot, IMPROVEMENT.marcoPolo);
  for (const s of peers()) {
    if (s === slot) continue;
    const w = treatiesOf(civ)[s] ?? 0;
    if ((w & TREATY.contact) !== 0) met += 1;
    if ((w & TREATY.alliance) !== 0) allies += 1;
    if ((w & TREATY.war) !== 0) wars += 1;
    if ((w & TREATY.embassy) !== 0 || marco) embassies += 1;
  }
  if (met === 0) return 1;
  if (!game.knows(slot, era === 2 ? 27 : 88)) return 3;
  const rep = civ.reputation ?? 0;
  if (!(
    met < 2 ||
    rep > 1 ||
    allies !== 0 ||
    civ.everAllied === true ||
    game.negotiationEnv().rank(slot) > 6
  ))
    return 2;
  if (rep >= 3) return 4;
  if (met === wars && rep > 1) return 4;
  if (civ.everExchanged !== true) return 6;
  if (embassies === 0 || (met === wars && embassies < met)) return 5;
  return met === wars ? 6 : 7;
}

/** 0x00491c63. */
export function attitudeRating(game: Game, slot: number): number {
  const civ = game.civ(slot);
  let unhappy = 0;
  let rioting = 0;
  let balanced = 0;
  let rapture = 0;
  for (const c of game.world.cities) {
    if (c.owner !== slot) continue;
    const f = game.cityFigures(c);
    if (f.happy < f.unhappy) {
      unhappy += 1;
      if (c.inDisorder) rioting += 1;
    } else if (f.happy === f.unhappy) balanced += 1;
    if (c.celebrating) rapture += 1;
  }
  const sum = civ.scienceRate + civ.taxRate;
  const luxuryUsed =
    civ.government < 5
      ? !(unhappy === 0 && balanced !== 0 && rapture === 0 && sum === 10)
      : sum < 9;
  if (unhappy === 0) {
    if (!luxuryUsed) return 4;
    return rapture === 0 ? 5 : 6;
  }
  if (!luxuryUsed) return 2;
  return rioting === 0 || civ.government !== 6 ? 3 : 1;
}

export function councilRatings(game: Game, slot: number) {
  const era = councilEra(game, slot);
  return {
    era,
    ratings: [
      militaryRating(game, slot),
      scienceRating(game, slot, era),
      tradeRating(game, slot, era),
      foreignRating(game, slot, era),
      attitudeRating(game, slot),
    ],
  };
}

const LETTERS = 'MSTFA';
const CODES: Record<string, number> = { m: 0, s: 1, t: 2, f: 3, a: 4 };

/** Parse one COUNCILn.TXT into its sections. */
export function parseCouncil(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let lines: string[] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (l.startsWith('@')) {
      lines = [];
      out.set(l.slice(1), lines);
    } else if (lines && l !== '') lines.push(l);
  }
  return out;
}

/**
 * What the council says (VERIFIED 0x004d98b3): the rated advisor speaks the section's first line,
 * then up to two others, picked by the coded lines in order. `t3` answers only when the Trade
 * advisor's rating is 3, plain `t` always; each advisor answers once. `r5,` keeps the rest of its
 * line with probability (10 − 5) / 10. After `#,` a further code runs only if the last line
 * answered, and `end` stops.
 */
export function councilSpeech(
  sections: Map<string, string[]>,
  advisor: number,
  ratings: number[],
  rng: Rng,
): string[] {
  const lines = sections.get(`${LETTERS[advisor] ?? 'M'}${ratings[advisor] ?? 1}`);
  if (!lines?.[0]) return [];
  const speech = (l: string, skip: number) => {
    const fields = l.split(',').map((x) => x.trim());
    return fields.slice(skip).join(', ').trim();
  };
  const out = [speech(lines[0], 2)];
  let used = 1 << advisor;
  let last = true;
  for (let i = 1; i < lines.length && out.length < 3; i++) {
    const fields = (lines[i] ?? '').split(',').map((x) => x.trim());
    let f = 0;
    let stop = false;
    while (f < fields.length) {
      const token = fields[f] ?? '';
      f += 1;
      const c = token[0]?.toLowerCase() ?? '';
      if (c === '#') {
        if (last) continue;
        break;
      }
      if (c === ';') break;
      if (c === 'e') {
        stop = true;
        break;
      }
      if (c === 'r') {
        const roll = rng.nextInt(10) + 1;
        if (roll <= Number(token.slice(1))) {
          last = false;
          break;
        }
        continue;
      }
      const who = CODES[c];
      if (who === undefined) break;
      const level = token.slice(1);
      if ((used & (1 << who)) === 0 && (level === '' || ratings[who] === Number(level))) {
        out.push(
          fields
            .slice(f + 2)
            .join(', ')
            .trim(),
        );
        used |= 1 << who;
        last = true;
      } else last = false;
      break;
    }
    if (stop) break;
  }
  return out;
}
