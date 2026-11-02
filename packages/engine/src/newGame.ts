/**
 * Starting a new game.
 *
 * Ported from the original's new-game routine (0x00483c9f), the civilization birth routine
 * (0x00480fc9: the tribe, the leader, attitudes, the start-site search, the first Settlers) and
 * the start balancing pass (0x00480a34: a second Settlers and free advances for poorer sites).
 * VERIFIED unless marked INFERRED. docs/engine/new-game.md.
 */
import { locatorGrid } from './pathfinding.js';
import { emptyStrategy, landmassStats } from './aiStrategy.js';
import { attitudesOf, lastWarTurnsOf, treatiesOf } from './diplomacy.js';
import { distance } from './city.js';
import { landValue } from './fertility.js';
import type { GameState } from './game.js';
import { generateMap, type MapParams } from './mapgen.js';
import { researchableAdvances } from './outcome.js';
import { canBuildUnit } from './founding.js';
import { acceleratedStart, acceleratedTurn } from './accelerated.js';
import { grantAdvance } from './research.js';
import type { Rng } from './rng.js';
import { GOVERNMENT, type EngineRules } from './rules.js';
import { hutAt } from './terrainSpecials.js';
import { OCEAN, SquareFlag, World, type Civ, type Unit } from './world.js';

/** What the rules know about a leader (the @LEADERS table). */
export interface NewGameLeader {
  index: number;
  name: string;
  femaleName: string;
  female: boolean;
  /** Colour set 1–7: the civilization slot. */
  color: number;
  cityStyle: number;
  plural: string;
  adjective: string;
  attack: number;
  expand: number;
  civilize: number;
}

export interface NewGameOptions {
  map: MapParams;
  /** 0 Chieftain … 5 Deity. */
  difficulty: number;
  /** Civilizations in play including the human, 2–7. */
  civCount: number;
  /** The human's tribe (leader index). */
  humanTribe: number;
  /** A tribe of the player's own (VERIFIED 0x004df9af, the custom tribe and city style boxes). */
  customTribe?: {
    leader?: string;
    name?: string;
    adjective?: string;
    cityStyle?: number;
    titles?: string[];
  };
  leaders: NewGameLeader[];
  /** 0 villages only, 1 roving, 2 restless, 3 raging. */
  barbarianActivity: number;
  /** Simplified combat off (the default). */
  realisticCombat?: boolean;
  /** Accelerated start: none, or level 0 (turn 21) or 1 (turn 41). */
  accelerated?: number;
  /** Options byte 0 bit 7. */
  bloodlust?: boolean;
  /** Options byte 1 bit 0: "don't restart if eliminated". */
  noRestart?: boolean;
  /** A world made beforehand, for a game on a premade map; `map` is then not used. */
  premade?: World;
  /** The map's start positions, by tribe (the `.MP` file's table). */
  startSites?: ({ x: number; y: number } | null)[];
  /** Select Computer Opponents (dialog OPPONENT, 0x004e37ea): a tribe for a slot, or null for random. */
  chooseOpponent?: (slot: number, tribes: NewGameLeader[]) => number | null;
  /** Overrides the leader's gender flip (INFERRED: the original asks the human). */
  humanFemale?: boolean;
}

export interface NewGameResult {
  world: World;
  state: GameState;
  humanSlot: number;
  /** What happened during setup (a civilization that found no start site, extra Settlers…). */
  notes: string[];
}

const SETTLERS = 0;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function placeUnit(world: World, type: number, owner: number, x: number, y: number): Unit {
  const unit: Unit = {
    id: world.units.reduce((m, u) => Math.max(m, u.id), -1) + 1,
    position: { x, y },
    owner,
    type,
    veteran: false,
    hitPointsLost: 0,
    movesSpent: 0,
    fortified: false,
    homeCity: null,
    order: null,
    workCounter: 0,
    gotoTarget: null,
    lastDirection: null,
    gotoSteps: 0,
  };
  world.units.push(unit);
  return unit;
}

function blankCiv(slot: number, advances: number): Civ {
  return {
    slot,
    tribe: null,
    name: slot === 0 ? 'Barbarians' : `Civilization ${slot}`,
    adjective: slot === 0 ? 'Barbarian' : '',
    leader: '',
    cityStyle: 0,
    epoch: 0,
    colour: slot,
    government: GOVERNMENT.despotism,
    treasury: 0,
    isHuman: false,
    inPlay: false,
    scienceStored: 0,
    researching: null,
    advancesCount: 0,
    futureTechs: 0,
    scienceRate: 4,
    taxRate: 4,
    knownAdvances: Array<boolean>(advances).fill(false),
    freeAdvancePending: false,
    strategy: emptyStrategy(),
    reputation: 0,
  };
}

/**
 * The start-site search (0x00480fc9): random squares until one is land, worth at least 12 to a
 * settler, at least 16 squares from every unit, on a land mass of at least 32 squares, with no
 * hut or city; every requirement relaxes as the tries mount (a human at turn 0 keeps trying).
 */
export function findStartSite(
  world: World,
  rules: EngineRules,
  rng: Rng,
  isHuman: boolean,
  turn = 0,
): { x: number; y: number } | null {
  const width = world.widthX2;
  const rows = world.rows;
  const stats = landmassStats(world, rules);
  // VERIFIED (the same routine at a restart): after turn 0 only cities count for the distance,
  // the land mass must have room less `turn / 16`, after turn 200 no city of anyone on it, and
  // the square must lie in no city's territory.
  const cityCount = new Map<number, number>();
  for (const c of world.cities) {
    const lm = (world.landmass[world.index(c.position.x, c.position.y)] ?? 0) & 63;
    cityCount.set(lm, (cityCount.get(lm) ?? 0) + 1);
  }
  let tries = 0;
  let x = 0;
  let y = 0;
  for (;;) {
    if (!world.flatEarth || width < 81 || tries > 1499) x = rng.nextInt(width);
    else x = rng.nextInt(width - 16) + 8;
    if (!world.flatEarth || rows < 40 || tries > 1499) y = rng.nextInt(rows);
    else y = rng.nextInt(rows - 16) + 8;
    if ((x & 1) !== 0) x -= 1;
    if ((y & 1) !== 0) x += 1;
    tries += 1;
    let nearest = 30;
    for (const c of world.cities)
      nearest = Math.min(nearest, distance(world, { x, y }, c.position));
    if (turn === 0)
      for (const u of world.units)
        nearest = Math.min(nearest, distance(world, { x, y }, u.position));
    const lm = (world.landmass[world.index(x, y)] ?? 0) & 63;
    const land = stats.land[lm] ?? 0;
    const bad =
      world.terrainAt(x, y) === OCEAN ||
      landValue(world, x, y) < 12 - (tries >> 5) ||
      nearest < 16 - (tries >> 7) ||
      (nearest < 2 && tries < 2001) ||
      nearest < 1 ||
      land < 32 - (turn >> 4) - (tries >> 6) ||
      (turn > 200 && (cityCount.get(lm) ?? 0) > 0) ||
      (hutAt(world, x, y) && tries < 2001) ||
      (world.territory[world.index(x, y)] ?? 0) !== 0 ||
      world.cityAt(x, y) !== undefined;
    if (!bad) break;
    if (tries >= 2001 && !isHuman) return null;
    if (tries >= 20000) return null;
  }
  if (y < 3 || y >= rows - 3) return null;
  return { x, y };
}

/** Make a world and its civilizations, ready for turn 0. */
export function newGame(rules: EngineRules, rng: Rng, opts: NewGameOptions): NewGameResult {
  const notes: string[] = [];
  const world = opts.premade ?? generateMap(opts.map, rules, rng);
  const advances = rules.advances.length;
  for (let slot = 0; slot < 8; slot++) world.civs.push(blankCiv(slot, advances));

  // VERIFIED 0x004e37ea: the human's slot, then slots drawn at random until the count is met.
  const humanLeader = opts.leaders[opts.humanTribe];
  if (!humanLeader) throw new Error(`no leader ${opts.humanTribe}`);
  const humanSlot = clamp(humanLeader.color, 1, 7);
  const inPlay = new Set<number>([humanSlot]);
  while (inPlay.size < clamp(opts.civCount, 2, 7)) inPlay.add(1 + rng.nextInt(7));
  const used = new Map<number, number>();

  // Birth (0x00480fc9), in slot order.
  for (let slot = 1; slot < 8; slot++) {
    const civ = world.civs[slot];
    if (!civ || !inPlay.has(slot)) continue;
    civ.inPlay = true;
    civ.isHuman = slot === humanSlot;
    let leader: NewGameLeader;
    if (civ.isHuman) leader = humanLeader;
    else {
      // The tribe: one of the colour's three, unused ones first.
      let pool = opts.leaders.filter(
        (l) => l.color === slot && l.index !== opts.humanTribe && !used.has(l.index),
      );
      if (pool.length === 0) pool = opts.leaders.filter((l) => l.color === slot);
      const chosen = opts.chooseOpponent?.(
        slot,
        opts.leaders.filter((l) => l.color === slot),
      );
      const pick =
        opts.leaders.find((l) => l.index === chosen) ??
        pool[rng.nextInt(Math.max(1, pool.length))] ??
        pool[0];
      if (!pick) {
        civ.inPlay = false;
        notes.push(`no tribe for slot ${slot}`);
        continue;
      }
      leader = pick;
    }
    used.set(leader.index, (used.get(leader.index) ?? 0) + 1);
    // One time in three the leader's gender flips (VERIFIED).
    let female = leader.female;
    if (rng.nextInt(3) === 0) female = !female;
    if (civ.isHuman && opts.humanFemale !== undefined) female = opts.humanFemale;
    civ.tribe = leader.index;
    civ.name = leader.plural;
    civ.adjective = leader.adjective;
    civ.leader = female ? leader.femaleName || leader.name : leader.name;
    civ.cityStyle = leader.cityStyle;
    if (civ.isHuman && opts.customTribe) {
      const c = opts.customTribe;
      if (c.leader) civ.leader = c.leader;
      if (c.name) civ.name = c.name;
      if (c.adjective) civ.adjective = c.adjective;
      if (c.cityStyle !== undefined) civ.cityStyle = c.cityStyle;
      if (c.titles?.some((t) => t !== '')) civ.titles = c.titles;
    }
    civ.colour = slot;
    civ.government = GOVERNMENT.despotism;
    // Rates: a human keeps the defaults (science 6, tax 4); the computer sets science to
    // civilize + 3 and tax to the rest of nine (VERIFIED).
    if (civ.isHuman) {
      civ.scienceRate = 6;
      civ.taxRate = 4;
      if (opts.difficulty === 0) civ.treasury = 50;
    } else {
      civ.scienceRate = leader.civilize + 3;
      civ.taxRate = 9 - civ.scienceRate;
    }
    // Attitudes: 100 toward oneself; 10–89 between computer players; toward and from a human
    // `difficulty × 5 + 10–89`, clamped to 10–75 (VERIFIED).
    const mine = attitudesOf(civ);
    mine[slot] = 100;
    for (let other = 1; other < 8; other++) {
      if (other === slot) continue;
      const o = world.civs[other];
      if (!o) continue;
      const theirs = attitudesOf(o);
      const human = other === humanSlot || civ.isHuman;
      const value = human
        ? clamp(opts.difficulty * 5 + rng.nextInt(80) + 10, 10, 75)
        : rng.nextInt(80) + 10;
      theirs[slot] = value;
      mine[other] = value;
    }
    treatiesOf(civ).fill(0);
    lastWarTurnsOf(civ).fill(-1);
    civ.strategy = emptyStrategy();
    civ.treasury = civ.isHuman ? civ.treasury : 0;
  }

  // Start sites and the first Settlers, in slot order.
  const starts = new Map<number, { x: number; y: number }>();
  for (let slot = 1; slot < 8; slot++) {
    const civ = world.civs[slot];
    if (!civ?.inPlay) continue;
    // VERIFIED 0x00480fc9: on turn 0 a tribe's place on the map, if it has one, comes first.
    const fixed = opts.startSites?.[civ.tribe ?? -1];
    const site =
      fixed && !world.unitsAt(fixed.x, fixed.y).length
        ? fixed
        : findStartSite(world, rules, rng, civ.isHuman);
    if (!site) {
      civ.inPlay = false;
      notes.push(`${civ.name}: no start site; they sit this game out`);
      continue;
    }
    starts.set(slot, site);
    placeUnit(world, SETTLERS, slot, site.x, site.y);
    world.revealRadius(site.x, site.y, slot);
  }

  // Balancing (0x00480a34): a site score from the nearest neighbour on the land mass, rivers
  // or grassland in the city radius and the land mass's size; the best-placed sets the bar.
  const stats = landmassStats(world, rules);
  const scores = new Map<number, number>();
  let best = 0;
  for (const [slot, site] of starts) {
    const lm = (world.landmass[world.index(site.x, site.y)] ?? 0) & 63;
    let nearest = 999;
    for (const [other, p] of starts) {
      if (other === slot) continue;
      if (((world.landmass[world.index(p.x, p.y)] ?? 0) & 63) !== lm) continue;
      nearest = Math.min(nearest, distance(world, site, p));
    }
    let score = 0;
    const land = stats.land[lm] ?? 0;
    if (nearest >= 10) {
      if (nearest < 20) score += 1;
      else if (nearest === 999) score += clamp(Math.trunc(land / 50), 3, 6);
      else score += 2;
    }
    let grass = 0;
    let rivers = 0;
    for (let i = 0; i < 21; i++) {
      const q = world.radiusSquare(site.x, site.y, i);
      if (!q) continue;
      if (world.terrainAt(q.x, q.y) === 2) grass += 1;
      if (world.hasFlag(q.x, q.y, SquareFlag.River)) rivers += 1;
    }
    if (rivers >= 4) score += 4;
    else if (grass > 3) score += 2;
    score += Math.min(3, Math.trunc(land / 50));
    scores.set(slot, score);
    best = Math.max(best, score);
  }
  for (const [slot, site] of starts) {
    const civ = world.civs[slot];
    if (!civ) continue;
    let score = scores.get(slot) ?? 0;
    const humanAtDeity = civ.isHuman && opts.difficulty === 5;
    if (best - score > 3 || humanAtDeity) {
      placeUnit(world, SETTLERS, slot, site.x, site.y);
      score += humanAtDeity ? 1 : 3;
      notes.push(`${civ.name} start with a second Settlers`);
    }
    let granted = 0;
    for (let i = 0; i < best - score; i++) {
      // The original grants the research target, choosing one first (INFERRED: a random
      // researchable advance stands in for its chooser).
      const choices = researchableAdvances(rules, civ);
      const advance = civ.researching ?? choices[rng.nextInt(Math.max(1, choices.length))];
      if (advance === undefined) break;
      grantAdvance(civ, advance, 'other', true);
      granted += 1;
    }
    if (granted > 0)
      notes.push(`${civ.name} start knowing ${granted} advance${granted > 1 ? 's' : ''}`);
  }

  const tribesPlayed: number[] = [];
  for (const [index, count] of used) tribesPlayed[index] = count;
  if (opts.accelerated !== undefined) {
    acceleratedStart(world, rules, rng, opts.accelerated, (t, o, x, y) =>
      placeUnit(world, t, o, x, y),
    );
  }
  const state: GameState = {
    turn: opts.accelerated !== undefined ? acceleratedTurn(opts.accelerated) : 0,
    ...(opts.bloodlust ? { bloodlust: true } : {}),
    ...(opts.noRestart ? { noRestart: true } : {}),
    difficulty: opts.difficulty,
    ...(world.largeMap ? { largeMap: true } : {}),
    ...(world.smallMap ? { smallMap: true } : {}),
    realisticCombat: opts.realisticCombat ?? true,
    firstDiscoveredBy: Array<number>(advances).fill(0),
    barbarianActivity: opts.barbarianActivity,
    tribesPlayed,
  };
  locatorGrid(world); // built once, before anything changes the land (0x00402cd3)
  return { world, state, humanSlot, notes };
}

export interface RestartContext {
  turn: number;
  difficulty: number;
  /** Options byte 1 bit 0: "don't restart if eliminated". */
  noRestart: boolean;
  isHuman: (slot: number) => boolean;
  /** The human's tribe (never handed to a restarted civilization). */
  humanTribe: number;
  /** Per advance: slots that know it (bit n) and the first discoverer (0 = nobody). */
  knownBy: (advance: number) => number;
  firstDiscoveredBy: number[];
  /** Times each tribe has played this game (leader index → count). */
  tribesPlayed: number[];
}

export interface RestartResult {
  restarted: boolean;
  civ: Civ;
  notes: string[];
}

/** Count the set bits of a slot mask. */
function popcount(mask: number): number {
  let n = 0;
  for (let m = mask; m !== 0; m &= m - 1) n += 1;
  return n;
}

/**
 * A destroyed computer civilization's slot is born again (VERIFIED, 0x00480fc9 after turn 0): the
 * record is reset; a tribe of the slot's colour that has not played is chosen (any of the colour
 * failing that; none, and the slot stays empty); gender, names, rates and attitudes as at the
 * start; of the advances a human knows, each whose first discoverer is not a human or that more
 * than two civilizations know is granted with probability `difficulty / (difficulty + 1)`; a start
 * site is sought with the turn's relaxations (findStartSite); and while the turn is at most
 * `350 − 35 × difficulty` and "don't restart" is off, the civilization is placed: barbarian units
 * within eight squares disbanded, Settlers on the site, a second Settlers after turn 20 when no
 * human has seen the square — with a Phalanx (unit type 3) after turn 40 when it can be built —
 * and the 21 squares around revealed. A failure leaves the slot out of play.
 */
export function restartCivilization(
  world: World,
  rules: EngineRules,
  rng: Rng,
  slot: number,
  leaders: NewGameLeader[],
  ctx: RestartContext,
): RestartResult {
  const civ = world.civs.find((c) => c.slot === slot);
  const notes: string[] = [];
  if (!civ) throw new Error(`no civilization ${slot}`);
  const fresh = blankCiv(slot, rules.advances.length);
  Object.assign(civ, fresh);
  delete civ.spaceship;
  delete civ.governmentScores;
  civ.incidents = 0;
  civ.civFlags = 0;
  civ.hadCity = false;
  civ.bestProduction = 0;
  treatiesOf(civ).fill(0);
  lastWarTurnsOf(civ).fill(-1);
  for (const other of world.civs) {
    if (other.slot === slot) continue;
    treatiesOf(other)[slot] = 0;
    const theirs = other.lastWarTurns;
    if (theirs) theirs[slot] = -1;
  }
  let pool = leaders.filter(
    (l) => l.color === slot && l.index !== ctx.humanTribe && (ctx.tribesPlayed[l.index] ?? 0) === 0,
  );
  if (pool.length === 0)
    pool = leaders.filter((l) => l.color === slot && l.index !== ctx.humanTribe);
  const leader = pool[rng.nextInt(Math.max(1, pool.length))] ?? pool[0];
  if (!leader) {
    civ.inPlay = false;
    notes.push(`no tribe left for slot ${slot}`);
    return { restarted: false, civ, notes };
  }
  ctx.tribesPlayed[leader.index] = (ctx.tribesPlayed[leader.index] ?? 0) + 1;
  let female = leader.female;
  if (rng.nextInt(3) === 0) female = !female;
  civ.tribe = leader.index;
  civ.name = leader.plural;
  civ.adjective = leader.adjective;
  civ.leader = female ? leader.femaleName || leader.name : leader.name;
  civ.cityStyle = leader.cityStyle;
  civ.colour = slot;
  civ.government = GOVERNMENT.despotism;
  civ.scienceRate = leader.civilize + 3;
  civ.taxRate = 9 - civ.scienceRate;
  civ.inPlay = true;
  const mine = attitudesOf(civ);
  mine[slot] = 100;
  for (const other of world.civs) {
    if (other.slot === 0 || other.slot === slot) continue;
    const theirs = attitudesOf(other);
    const value = ctx.isHuman(other.slot)
      ? clamp(ctx.difficulty * 5 + rng.nextInt(80) + 10, 10, 75)
      : rng.nextInt(80) + 10;
    theirs[slot] = value;
    mine[other.slot] = value;
  }
  let humanMask = 0;
  for (let s = 1; s < 8; s++) if (ctx.isHuman(s)) humanMask |= 1 << s;
  for (let a = 0; a < rules.advances.length; a++) {
    const known = ctx.knownBy(a);
    if ((known & humanMask) === 0) continue;
    const first = ctx.firstDiscoveredBy[a] ?? 0;
    if ((humanMask & (1 << first)) !== 0 && popcount(known) <= 2) continue;
    if (ctx.difficulty > 0 && rng.nextInt(ctx.difficulty + 1) !== 0) grantAdvance(civ, a, 'other');
  }
  const site = findStartSite(world, rules, rng, false, ctx.turn);
  const allowed = site !== null && !ctx.noRestart && ctx.turn <= 350 - 35 * ctx.difficulty;
  if (!allowed || !site) {
    civ.inPlay = false;
    notes.push(`the ${civ.name} find no place to start`);
    return { restarted: false, civ, notes };
  }
  for (const u of [...world.units])
    if (u.owner === 0 && distance(world, site, u.position) < 9)
      world.units.splice(world.units.indexOf(u), 1);
  placeUnit(world, SETTLERS, slot, site.x, site.y);
  let humanSaw = false;
  for (let s = 1; s < 8; s++)
    if (ctx.isHuman(s) && world.isSeen(site.x, site.y, s)) humanSaw = true;
  if (ctx.turn > 20 && !humanSaw) {
    placeUnit(world, SETTLERS, slot, site.x, site.y);
    if (ctx.turn > 40 && canBuildUnit(rules, civ, 3)) placeUnit(world, 3, slot, site.x, site.y);
  }
  world.revealRadius(site.x, site.y, slot);
  notes.push(`a new civilization, the ${civ.name}, arises`);
  return { restarted: true, civ, notes };
}
