/**
 * The advisors' figures, as plain data. The routines around 0x00420e90 to 0x00426090 mostly draw;
 * what they compute is here. Specification: docs/engine/advisors.md.
 */
import { attitudeBand } from './negotiation.js';
import { attitude, hasTreaty, TREATY, treatiesOf } from './diplomacy.js';
import { improvementUpkeep } from './upkeep.js';
import { advanceIndex, IMPROVEMENT } from './rules.js';
import { hasLaunched, shipOf } from './spaceship.js';
import type { Game } from './game.js';
import type { City } from './world.js';

/** Citizens counted as the original counts them: 1 + 2 + … + size (0x0042bcce). */
export function cityPopulation(size: number): number {
  let n = 0;
  for (let i = 1; i <= size; i++) n += i;
  return n < 2 ? 1 : n;
}

/** A civilization's population in the same units, clamped to 1 … 32000 (0x0042bd35). */
export function civPopulation(game: Game, slot: number): number {
  let n = 0;
  for (const c of game.world.cities) if (c.owner === slot) n += cityPopulation(c.size);
  if (n < 0 || n > 32000) n = 32000;
  return n < 2 ? 1 : n;
}

export interface CityRow {
  city: City;
  food: number;
  shields: number;
  trade: number;
  tax: number;
  science: number;
  luxuries: number;
  happy: number;
  unhappy: number;
  content: number;
  specialists: number;
}

export function cityRows(game: Game, slot: number): CityRow[] {
  return game.world.cities
    .filter((c) => c.owner === slot)
    .map((city) => {
      const f = game.cityFigures(city);
      const sp = city.specialists;
      const specialists = sp.entertainers + sp.taxCollectors + sp.scientists;
      return {
        city,
        ...f,
        specialists,
        content: Math.max(0, city.size - specialists - f.happy - f.unhappy),
      };
    });
}

/** F2: units in play and in production, per type. */
export function defenseRows(game: Game, slot: number) {
  const rows = game.rules.units.map((type, index) => ({ index, type, active: 0, building: 0 }));
  for (const u of game.world.units) {
    const r = rows[u.type];
    if (u.owner === slot && r) r.active += 1;
  }
  for (const c of game.world.cities) {
    if (c.owner !== slot || c.production.kind !== 'unit') continue;
    const r = rows[c.production.index];
    if (r) r.building += 1;
  }
  return rows.filter((r) => r.active > 0 || r.building > 0);
}

/** F3: the civilizations this one has met. */
export function foreignRows(game: Game, slot: number) {
  const me = game.world.civs.find((c) => c.slot === slot);
  const out = [];
  for (const c of game.world.civs) {
    if (c.slot < 1 || c.slot > 7 || c.slot === slot || !c.inPlay || !me) continue;
    const w = treatiesOf(me)[c.slot] ?? 0;
    if ((w & TREATY.contact) === 0) continue;
    const status =
      (w & TREATY.war) !== 0
        ? 'war'
        : (w & TREATY.alliance) !== 0
          ? 'alliance'
          : (w & TREATY.peace) !== 0
            ? 'peace'
            : (w & TREATY.ceaseFire) !== 0
              ? 'cease-fire'
              : 'contact';
    out.push({
      civ: c,
      status,
      embassy: hasTreaty(game.world, slot, c.slot, TREATY.embassy),
      attitudeBand: attitudeBand(attitude(game.world, c.slot, slot)),
      cities: game.world.cities.filter((x) => x.owner === c.slot).length,
    });
  }
  return out;
}

/** F5: income and what the improvements cost. */
export function tradeReport(game: Game, slot: number) {
  const civ = game.civ(slot);
  const rows = cityRows(game, slot);
  const ctx = {
    difficulty: game.state.difficulty,
    ownsWonder: (i: number) => game.ownsWonder(slot, i),
    shieldRows: game.rules.cosmic.shieldBoxRows,
  };
  const upkeep = new Map<number, { count: number; cost: number }>();
  for (const { city } of rows) {
    for (let i = 1; i < 39; i++) {
      if (!city.improvements[i]) continue;
      const u = upkeep.get(i) ?? { count: 0, cost: 0 };
      u.count += 1;
      u.cost += improvementUpkeep(game.rules, civ, i, ctx);
      upkeep.set(i, u);
    }
  }
  const income = rows.reduce((n, r) => n + (r.city.inDisorder ? 0 : r.tax), 0);
  const costs = [...upkeep.values()].reduce((n, u) => n + u.cost, 0);
  return {
    rows,
    upkeep: [...upkeep.entries()].map(([index, u]) => ({ index, ...u })),
    income,
    costs,
    science: rows.reduce((n, r) => n + r.science, 0),
  };
}

/** F6: research. Discoveries every `cost / beakers` turns, rounded up, at least 1. */
export function scienceReport(game: Game, slot: number) {
  const civ = game.civ(slot);
  const cost = game.researchCostFor(civ);
  const perTurn = cityRows(game, slot).reduce((n, r) => n + r.science, 0);
  const every = perTurn > 0 ? Math.max(1, Math.ceil(cost / perTurn)) : null;
  const known: number[] = [];
  for (let i = 0; i < game.rules.advances.length; i++) if (civ.knownAdvances[i]) known.push(i);
  return { researching: civ.researching, stored: civ.scienceStored, cost, perTurn, every, known };
}

/** F7: every wonder that has been built or lost, in rules order. */
export function wonderRows(game: Game) {
  const out = [];
  for (let i = IMPROVEMENT.pyramids; i < game.rules.improvements.length; i++) {
    const city = game.world.cities.find((c) => c.improvements[i]);
    if (!city) continue;
    out.push({
      index: i,
      city,
      expired: game.wonderExpired(i),
      expiresWith: advanceIndex(game.rules.improvements[i]?.expiresWith),
    });
  }
  return out;
}

/** F8 (VERIFIED 0x00425878): size + happy − unhappy, +10 for each wonder; ties to the earlier. */
export function topCities(game: Game): City[] {
  const scored = game.world.cities.map((city) => {
    const f = game.cityFigures(city);
    let score = city.size + f.happy - f.unhappy;
    for (let i = IMPROVEMENT.pyramids; i < 67; i++) if (city.improvements[i]) score += 10;
    return { city, score };
  });
  const top: typeof scored = [];
  for (const s of scored) {
    let at = 0;
    while (at < top.length && s.score <= (top[at]?.score ?? 0)) at += 1;
    if (at < 5) top.splice(at, 0, s);
    if (top.length > 5) top.pop();
  }
  return top.map((t) => t.city);
}

export interface DemographicRow {
  label: string;
  value: number;
  /** 1 is best; a measure where less is better is ranked by its negation. */
  rank: number;
}

const ADV = { alphabet: 1, university: 88, literacy: 43, theoryOfGravity: 85, medicine: 50 };
const CURE_FOR_CANCER = IMPROVEMENT.cureForCancer;

/** F11 (VERIFIED 0x00426090). */
export function demographics(game: Game, slot: number): DemographicRow[] {
  const { world } = game;
  const zero = () => Array<number>(8).fill(0);
  const happiness = zero();
  const gnp = zero();
  const surplus = zero();
  const output = zero();
  const shields = zero();
  const land = zero();
  const pollution = zero();
  const disease = zero();
  const reading = zero();
  const pop = Array<number>(8).fill(1);
  for (let i = 0; i < world.terrain.length; i++) {
    const owner = world.territory[i] ?? 0xff;
    if (owner < 8) land[owner] = (land[owner] ?? 0) + 1;
  }
  const add = (a: number[], s: number, n: number) => {
    a[s] = (a[s] ?? 0) + n;
  };
  for (const c of world.cities) {
    const s = c.owner;
    const f = game.cityFigures(c);
    add(pop, s, c.size);
    add(happiness, s, c.size + f.happy - f.unhappy);
    add(gnp, s, f.luxuries * 2 + f.tax);
    add(surplus, s, f.food - c.size * 2);
    add(output, s, f.shields + f.routes + f.food);
    add(shields, s, f.shields);
    const dirt = game.cityPollutionFigures(c);
    if (dirt > 0) add(pollution, s, dirt);
    if (c.improvements[IMPROVEMENT.granary] || game.ownsWonder(s, IMPROVEMENT.pyramids))
      add(disease, s, c.size);
    if (c.improvements[IMPROVEMENT.aqueduct]) add(disease, s, c.size);
    if (c.improvements[IMPROVEMENT.sewerSystem]) add(disease, s, c.size);
    if (c.improvements[IMPROVEMENT.library]) add(reading, s, c.size);
    if (c.improvements[IMPROVEMENT.university]) add(reading, s, c.size);
  }
  const figure = (s: number) => {
    const civ = world.civs.find((c) => c.slot === s);
    const p = Math.max(pop[s] ?? 1, 1);
    let literacy = Math.trunc((((pop[s] ?? 1) * 2 + (reading[s] ?? 0)) * 2) / p);
    for (const a of [ADV.alphabet, ADV.university, ADV.literacy, ADV.theoryOfGravity])
      if (game.knows(s, a)) literacy *= 2;
    literacy = Math.min(100, literacy);
    let sick = Math.trunc(((pop[s] ?? 1) * 50) / ((disease[s] ?? 0) + (pop[s] ?? 1)));
    if (game.knows(s, ADV.medicine)) sick = Math.trunc(sick / 2);
    if (game.ownsWonder(s, CURE_FOR_CANCER)) sick = Math.trunc(sick / 2);
    let life = Math.trunc(1800 / (sick + 20));
    life -= Math.trunc(((pollution[s] ?? 0) * 10) / (pop[s] ?? 1));
    const advances = civ?.advancesCount ?? 0;
    const income =
      (gnp[s] ?? 0) < Math.trunc(30000 / (advances + 1))
        ? Math.trunc((advances * (gnp[s] ?? 0)) / (pop[s] ?? 1))
        : Math.trunc((gnp[s] ?? 0) / (pop[s] ?? 1)) * advances;
    return {
      'Approval rating': Math.trunc(((happiness[s] ?? 0) * 50) / p),
      Population: civPopulation(game, s),
      GNP: gnp[s] ?? 0,
      'Manufactured goods': shields[s] ?? 0,
      'Land area': land[s] ?? 0,
      Literacy: literacy,
      Disease: -sick,
      Pollution: -(pollution[s] ?? 0),
      'Life expectancy': Math.min(99, Math.max(20, life)),
      'Family size': (Math.trunc(((surplus[s] ?? 0) * 40) / (pop[s] ?? 1)) + 20) / 10,
      'Military service': Math.trunc(((civ?.strategy?.combatUnits ?? 0) * 10) / (pop[s] ?? 1)),
      'Annual income': income,
      Productivity: Math.trunc(((output[s] ?? 0) * 10) / (pop[s] ?? 1)),
    };
  };
  const all = new Map<number, ReturnType<typeof figure>>();
  for (const c of world.civs)
    if (c.slot >= 1 && c.slot <= 7 && c.inPlay) all.set(c.slot, figure(c.slot));
  const mine = all.get(slot) ?? figure(slot);
  return (Object.keys(mine) as (keyof typeof mine)[]).map((label) => {
    let rank = 1;
    for (const f of all.values()) if (mine[label] < f[label]) rank += 1;
    return { label, value: Math.abs(mine[label]), rank };
  });
}

export const HISTORY_KINDS = [
  'wealthiest',
  'most powerful',
  'most advanced',
  'happiest',
  'largest',
];

export interface HistoryEvent {
  kind: 'history';
  historian: number;
  category: number;
  /** Civilizations from first to last. */
  order: number[];
}

/** The historian's ranking (VERIFIED 0x0042526d), in a random one of five categories. */
export function history(game: Game, historian: number, category: number): HistoryEvent {
  const { world } = game;
  const score = Array<number>(8).fill(0);
  for (const c of world.civs) {
    if (c.slot < 0 || c.slot > 7) continue;
    let n = 0;
    if (category === 0) n = c.treasury;
    if (category === 1) n = c.strategy?.strengthSum ?? 0;
    if (category === 2) n = c.knownAdvances.filter(Boolean).length;
    if (category > 2) {
      for (const city of world.cities) {
        if (city.owner !== c.slot) continue;
        const f = category === 3 ? game.cityFigures(city) : { happy: 0, unhappy: 0 };
        n += city.size + f.happy - f.unhappy;
      }
    }
    score[c.slot] = n;
  }
  const order = world.civs
    .filter((c) => c.slot >= 1 && c.slot <= 7 && c.inPlay)
    .map((c) => c.slot)
    .sort((a, b) => (score[b] ?? 0) - (score[a] ?? 0));
  return { kind: 'history', historian, category, order };
}

/** F12: each spaceship that has been started. */
export function spaceshipRows(game: Game) {
  return game.world.civs
    .filter((c) => c.spaceship && c.spaceship.parts.some((p) => p > 0))
    .map((civ) => ({
      civ,
      parts: Array.from(shipOf(civ).parts),
      launched: hasLaunched(civ),
      arrival: shipOf(civ).arrival,
    }));
}
