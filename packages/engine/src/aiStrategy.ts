/**
 * The AI's strategic layer for units: per-land-mass continent plans, the objectives table
 * and the assignment of units to objectives.
 *
 * Port of the original's per-civilization routine 0x004ed2dd and its objective helpers
 * (docs/engine/ai-units.md, "The AI's strategic layer"). VERIFIED unless marked INFERRED. The
 * routine also runs for human civilizations in the original (tallies and plans only); the
 * engine does the same so every civilization's per-land-mass counts exist for the others.
 */
import { distance } from './city.js';
import { hitPoints, maxHitPoints } from './combat.js';
import { fertilityAt } from './fertility.js';
import { fortify, orderGoTo } from './orders.js';
import { ADVANCE, DOMAIN_AIR, DOMAIN_GROUND, DOMAIN_SEA, type EngineRules } from './rules.js';
import { ORDER } from './terraform.js';
import { OCEAN, SquareFlag, type City, type Point, type Unit, type World } from './world.js';

export const OBJECTIVE_SLOTS = 48;
export const GOAL_SLOTS = 16;
const CITY_WALLS = 8;
const WARRIORS = 2;
const ENGINEERS = 1;

/** Continent plans (per civilization, per land mass). */
export const PLAN = { attack: 0, defend: 1, full: 4, room: 5 } as const;

/** Per-land-mass flags a civilization keeps about the others. */
export const LAND_FLAG = {
  enemyCities: 1,
  peaceCities: 2,
  enemyUnits: 4,
  peaceUnits: 8,
  watch: 0x10,
  wanted: 0x80,
} as const;

/** An entry of the objectives table: a square, the AI role it wants there, and a priority. */
export interface Objective {
  x: number;
  y: number;
  /** AI role of the units wanted (0 attack, 1 defend, 2 naval, 4 transport, 5 settle, 21 work); −1 empty. */
  type: number;
  priority: number;
}

export interface CivStrategy {
  plans: Uint8Array;
  landFlags: Uint8Array;
  /** The 48-slot objectives table; priorities go negative once a turn has consumed them. */
  objectives: Objective[];
  /** The 16-slot table of persistent goals, re-added to the objectives every turn. */
  goals: Objective[];
  unitsOn: Uint16Array;
  attackOn: Uint16Array;
  citiesOn: Uint8Array;
  sizesOn: Uint8Array;
  caravansOn: Uint8Array;
  combatUnits: number;
  cities: number;
  seaUnits: number;
  population: number;
  attackSum: number;
  strengthSum: number;
  settlers: number;
  ownedPerType: number[];
  buildingPerType: number[];
}

export function emptyStrategy(): CivStrategy {
  return {
    plans: new Uint8Array(64).fill(PLAN.room),
    landFlags: new Uint8Array(64),
    objectives: [],
    goals: [],
    unitsOn: new Uint16Array(64),
    attackOn: new Uint16Array(64),
    citiesOn: new Uint8Array(64),
    sizesOn: new Uint8Array(64),
    caravansOn: new Uint8Array(64),
    combatUnits: 0,
    cities: 0,
    seaUnits: 0,
    population: 0,
    attackSum: 0,
    strengthSum: 0,
    settlers: 0,
    ownedPerType: Array<number>(64).fill(0),
    buildingPerType: Array<number>(64).fill(0),
  };
}

export interface StrategyContext {
  turn: number;
  difficulty: number;
  atWar: (a: number, b: number) => boolean;
  isHuman: (slot: number) => boolean;
  knows: (slot: number, advance: number) => boolean;
  /** The leader's "expand" value for a civilization (RULES @LEADERS). */
  expand: (slot: number) => number;
  /** Strategy records of the other civilizations, by slot (their last tallies). */
  strategyOf: (slot: number) => CivStrategy | undefined;
  /** The leading human's slot, or null. */
  mainHuman: number | null;
  /** Simplified combat off (hit points matter): damaged enemy units become attack objectives. */
  realisticCombat?: boolean;
}

/** Land squares and rated squares per land mass (the map maker's tables, 0x5ead50/0x5ead52). */
export interface LandmassStats {
  land: number[];
  rated: number[];
}

export function landmassStats(world: World, rules: EngineRules): LandmassStats {
  if (world.landmassStats) return world.landmassStats;
  const land = Array<number>(64).fill(0);
  const rated = Array<number>(64).fill(0);
  for (let i = 0; i < world.area; i++) {
    if ((world.terrain[i] ?? OCEAN) === OCEAN) continue;
    const lm = (world.landmass[i] ?? 0) & 63;
    land[lm] = (land[lm] ?? 0) + 1;
    const p = world.position(i);
    if (fertilityAt(world, rules, p.x, p.y) !== 0) rated[lm] = (rated[lm] ?? 0) + 1;
  }
  world.landmassStats = { land, rated };
  return world.landmassStats;
}

/** The AI role of a unit (0x004ecd17): the type's role, 21 for a settler flagged as wanted. */
export function aiRole(rules: EngineRules, unit: Unit): number {
  const role = rules.units[unit.type]?.role ?? 0;
  return role === 5 && unit.wanted === true ? 21 : role;
}

/**
 * Add an objective (0x004703f8): nothing when the same square and type already carries at
 * least this priority; otherwise it goes before the first entry of lower priority (or into an
 * empty slot), pushing the rest down and dropping the last when the table is full.
 */
export function addObjective(s: CivStrategy, o: Objective): void {
  if (
    s.objectives.some(
      (e) => e.x === o.x && e.y === o.y && e.type === o.type && o.priority <= e.priority,
    )
  )
    return;
  let slot = s.objectives.findIndex((e) => e.priority < o.priority || e.type === -1);
  if (slot < 0) slot = s.objectives.length;
  if (slot >= OBJECTIVE_SLOTS) return;
  if (s.objectives[slot]?.type === -1) s.objectives[slot] = { ...o };
  else s.objectives.splice(slot, 0, { ...o });
  if (s.objectives.length > OBJECTIVE_SLOTS) s.objectives.length = OBJECTIVE_SLOTS;
}

/** Add a persistent goal (0x004707c5); same rules as the objectives, 16 slots. */
export function addGoal(s: CivStrategy, o: Objective): void {
  if (
    s.goals.some((e) => e.x === o.x && e.y === o.y && e.type === o.type && o.priority <= e.priority)
  )
    return;
  let slot = s.goals.findIndex((e) => e.priority < o.priority || e.type === -1);
  if (slot < 0) slot = s.goals.length;
  if (slot >= GOAL_SLOTS) return;
  if (s.goals[slot]?.type === -1) s.goals[slot] = { ...o };
  else s.goals.splice(slot, 0, { ...o });
  if (s.goals.length > GOAL_SLOTS) s.goals.length = GOAL_SLOTS;
}

/** Remove persistent goals of a type within `within` squares of (x, y) (0x0046ffe5). */
export function removeGoals(
  world: World,
  s: CivStrategy,
  type: number,
  at: Point,
  within: number,
): void {
  for (const g of s.goals) {
    if (g.type === type && distance(world, at, g) <= within) {
      g.type = -1;
      g.priority = 0;
    }
  }
}

/** Is there an objective of `type` on the square? (the chooser's 0x00470234, INFERRED name). */
export function objectiveAt(s: CivStrategy, p: Point, type: number): boolean {
  return s.objectives.some((o) => o.type === type && o.x === p.x && o.y === p.y);
}

/**
 * End-of-turn housekeeping (0x004709d5): objectives already consumed (negative priority) go,
 * this turn's are marked consumed, and every persistent goal is added back.
 */
export function endOfTurnObjectives(s: CivStrategy): void {
  s.objectives = s.objectives.filter((o) => o.type !== -1 && o.priority >= 0);
  for (const o of s.objectives) o.priority = -Math.abs(o.priority);
  for (const g of s.goals) if (g.type !== -1) addObjective(s, g);
}

function landmassOfLand(world: World, p: Point): number {
  return world.terrainAt(p.x, p.y) === OCEAN
    ? -1
    : (world.landmass[world.index(p.x, p.y)] ?? 0) & 63;
}

function landmassOf(world: World, p: Point): number {
  return (world.landmass[world.index(p.x, p.y)] ?? 0) & 63;
}

function foreignUnitAdjacentSameDomain(world: World, p: Point, me: number): boolean {
  const ocean = world.terrainAt(p.x, p.y) === OCEAN;
  for (const n of world.neighbours(p.x, p.y)) {
    if (!n) continue;
    if ((world.terrainAt(n.x, n.y) === OCEAN) !== ocean) continue;
    if (world.unitsAt(n.x, n.y).some((u) => u.owner !== me)) return true;
  }
  return false;
}

function nearestCityAny(world: World, p: Point): { city: City; dist: number } | null {
  let best: City | null = null;
  let bestD = 99;
  for (const c of world.cities) {
    const d = distance(world, p, c.position);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best ? { city: best, dist: bestD } : null;
}

export interface StrategyEvent {
  kind: 'ai-strategy';
  text: string;
}

/** Run the strategic layer for one civilization. Returns the events worth logging. */
export function runStrategy(
  world: World,
  rules: EngineRules,
  slot: number,
  ctx: StrategyContext,
): StrategyEvent[] {
  const events: StrategyEvent[] = [];
  const civ = world.civs.find((c) => c.slot === slot);
  if (!civ) return events;
  const s = (civ.strategy ??= emptyStrategy());
  const human = ctx.isHuman(slot);
  const stats = landmassStats(world, rules);

  // Tallies start over; last turn's city counts per land mass feed the settlers rule.
  const prevCitiesOn = Uint8Array.from(s.citiesOn);
  s.unitsOn.fill(0);
  s.attackOn.fill(0);
  s.sizesOn.fill(0);
  s.caravansOn.fill(0);
  s.landFlags.fill(0);
  s.ownedPerType.fill(0);
  s.buildingPerType.fill(0);
  s.combatUnits = 0;
  s.cities = 0;
  s.seaUnits = 0;
  s.population = 0;
  s.attackSum = 0;
  s.strengthSum = 0;
  s.settlers = 0;
  const settlersOn = new Int32Array(64);
  const settleGoalsOn = new Int32Array(64);
  for (const o of s.objectives) {
    if (o.type === 21 && o.priority > 0) {
      const lm = landmassOfLand(world, o);
      if (lm >= 0) settleGoalsOn[lm] = (settleGoalsOn[lm] ?? 0) + 1;
    }
  }
  for (const c of world.cities) if (c.owner === slot) c.workerNearby = false; // INFERRED reset point

  // Settlers, first pass: who is "wanted" (flag 0x200) and which cities have a worker nearby.
  for (const u of world.units) {
    if (u.owner !== slot) continue;
    u.arrived = false;
    u.wanted = false;
    const type = rules.units[u.type];
    if (!type || type.role !== 5) continue;
    if (human) u.wanted = true;
    if (u.homeCity === null) {
      s.settlers += 1;
      const lm = landmassOfLand(world, u.position);
      if (lm >= 0) {
        u.wanted = true;
        settlersOn[lm] = (settlersOn[lm] ?? 0) + 1;
        const near = nearestCityAny(world, u.position);
        if (near && near.dist < 4 && near.city.owner === slot) near.city.workerNearby = true;
      }
    }
  }

  // Every unit: own tallies, order hygiene, settlers wanted; enemy cripples under bloodlust.
  for (const u of world.units) {
    const type = rules.units[u.type];
    if (!type) continue;
    if (u.owner === slot) {
      s.ownedPerType[u.type] = (s.ownedPerType[u.type] ?? 0) + 1;
      if (type.attack >= 99) continue;
      const ocean = world.terrainAt(u.position.x, u.position.y) === OCEAN;
      const lm = landmassOfLand(world, u.position);
      if (!human) {
        // A sentried unit wakes unless it is a ground unit at sea (aboard a ship).
        if (u.order === ORDER.sleep && (type.domain !== DOMAIN_GROUND || !ocean)) u.order = null;
      }
      if (type.role < 5) {
        s.combatUnits += 1;
        if (lm >= 0) s.unitsOn[lm] = (s.unitsOn[lm] ?? 0) + 1;
      }
      if (type.role === 7 && u.homeCity !== null && lm >= 0)
        s.caravansOn[lm] = (s.caravansOn[lm] ?? 0) + 1;
      if (type.role === 5 && u.homeCity !== null) {
        s.settlers += 1;
        if (lm >= 0) {
          settlersOn[lm] = (settlersOn[lm] ?? 0) + 1;
          if ((prevCitiesOn[lm] ?? 0) !== 0) {
            const gov = civ.government;
            const d = gov < 2 ? 4 : gov < 5 ? 3 : 2;
            let wanted = Math.trunc(
              ((d >> 1) - ctx.expand(slot) - 1 + (prevCitiesOn[lm] ?? 0)) / d,
            );
            if (u.type === ENGINEERS) wanted += 1;
            wanted = Math.min(wanted, settleGoalsOn[lm] ?? 0);
            if ((settlersOn[lm] ?? 0) <= wanted) u.wanted = true;
          }
          const home = world.cities.find((c) => c.id === u.homeCity);
          if (home) {
            if (home.workerNearby && u.wanted && !human) {
              settlersOn[lm] = (settlersOn[lm] ?? 0) - 1;
              u.wanted = false;
            }
            if (u.wanted && distance(world, u.position, home.position) < 5)
              home.workerNearby = true;
          }
        }
      }
      if (type.domain === DOMAIN_SEA) s.seaUnits += 1;
      s.attackSum += type.attack;
      s.strengthSum += type.attack + type.defence;
      if (lm >= 0) s.attackOn[lm] = (s.attackOn[lm] ?? 0) + type.attack;
    } else if (
      ctx.realisticCombat &&
      ctx.atWar(slot, u.owner) &&
      world.isSeen(u.position.x, u.position.y, slot) &&
      hitPoints(rules, u) * 2 <= maxHitPoints(rules, u.type)
    ) {
      const ocean = world.terrainAt(u.position.x, u.position.y) === OCEAN;
      // INFERRED priority: the original passes none (it reads whatever is on the stack).
      addObjective(s, { x: u.position.x, y: u.position.y, type: ocean ? 2 : 0, priority: 2 });
    }
  }

  // Cities: own tallies and the defend/attack objectives.
  s.citiesOn.fill(0);
  world.cities.forEach((c, index) => {
    const lm = landmassOfLand(world, c.position);
    const empty = world.unitsAt(c.position.x, c.position.y).length === 0;
    if (c.owner === slot) {
      s.cities += 1;
      s.population += c.size;
      if (c.production.kind === 'unit')
        s.buildingPerType[c.production.index] = (s.buildingPerType[c.production.index] ?? 0) + 1;
      if (lm >= 0) {
        s.sizesOn[lm] = (s.sizesOn[lm] ?? 0) + c.size;
        s.citiesOn[lm] = (s.citiesOn[lm] ?? 0) + 1;
      }
      if (empty) addObjective(s, { x: c.position.x, y: c.position.y, type: 1, priority: 5 });
    } else if (
      ctx.difficulty * ctx.turn > 200 ||
      world.isSeen(c.position.x, c.position.y, slot) ||
      !ctx.isHuman(c.owner)
    ) {
      const war = ctx.atWar(slot, c.owner);
      if (war && (ctx.turn + index) % 3 !== 0) {
        const walls = c.improvements[CITY_WALLS] === true;
        addObjective(s, { x: c.position.x, y: c.position.y, type: 0, priority: walls ? 2 : 4 });
      }
      if (empty && war) {
        addObjective(s, { x: c.position.x, y: c.position.y, type: 1, priority: 2 });
        addObjective(s, { x: c.position.x, y: c.position.y, type: 0, priority: 3 });
      }
    }
  });

  // Continent plans.
  s.plans[0] = PLAN.room;
  s.plans[63] = PLAN.room;
  for (let lm = 1; lm < 63; lm++) {
    let weakerEnemies = 0;
    let strongerEnemies = 0;
    let strongHumans = 0;
    let unitsAll = 0;
    let citiesAll = 0;
    const myUnits = s.unitsOn[lm] ?? 0;
    const myAttack = s.attackOn[lm] ?? 0;
    const myCities = s.citiesOn[lm] ?? 0;
    for (let c = 1; c < 8; c++) {
      const other = c === slot ? s : ctx.strategyOf(c);
      if (!other) continue;
      const units = other.unitsOn[lm] ?? 0;
      const attack = other.attackOn[lm] ?? 0;
      const cities = other.citiesOn[lm] ?? 0;
      if (units === 0 || !(myAttack >> 2 < attack || cities !== 0)) continue;
      if (c !== slot) {
        const war = ctx.atWar(slot, c);
        if (war) {
          if (units < myAttack || attack < myUnits || myCities === 0) weakerEnemies += 1;
          else strongerEnemies += 1;
        }
        if (ctx.isHuman(c) && !war && (myAttack >> 1) + myUnits < attack) strongHumans += 1;
      }
      unitsAll += units;
      citiesAll += cities;
      if (c !== slot) {
        // Alliances are not modelled: every other civilization counts as non-allied.
        const war = ctx.atWar(slot, c);
        if (cities !== 0)
          s.landFlags[lm] =
            (s.landFlags[lm] ?? 0) | (war ? LAND_FLAG.enemyCities : LAND_FLAG.peaceCities);
        if (units !== 0)
          s.landFlags[lm] =
            (s.landFlags[lm] ?? 0) | (war ? LAND_FLAG.enemyUnits : LAND_FLAG.peaceUnits);
      }
    }
    if (world.cities.some((c) => c.owner === 0 && landmassOfLand(world, c.position) === lm))
      weakerEnemies += 1;
    let k = 6;
    if (
      ctx.mainHuman !== null &&
      (ctx.strategyOf(ctx.mainHuman)?.cities ?? 0) > 4 &&
      ctx.turn > 150
    )
      k = 7;
    let full = (stats.land[lm] ?? 0) < (myUnits + unitsAll) * 2;
    const d = (s.landFlags[lm] ?? 0) === 0 ? ctx.expand(slot) + k + 1 : k;
    if ((stats.rated[lm] ?? 0) < (myCities + citiesAll) * d + 2) full = true;
    if (!ctx.knows(slot, ADVANCE.mapMaking)) full = false;
    s.plans[lm] = full ? PLAN.full : PLAN.room;
    if (weakerEnemies !== 0) s.plans[lm] = PLAN.attack;
    if (strongerEnemies !== 0 || strongHumans !== 0) s.plans[lm] = PLAN.defend;
    if (strongerEnemies !== 0) s.landFlags[lm] = (s.landFlags[lm] ?? 0) | LAND_FLAG.watch;
    if (myUnits === 0 && myCities === 0 && ((s.landFlags[lm] ?? 0) & 0xc) !== LAND_FLAG.peaceUnits)
      s.plans[lm] = PLAN.attack;
  }

  if (!human) {
    assignObjectives(world, rules, slot, s, ctx, events);
  }
  endOfTurnObjectives(s);
  return events;
}

function assignObjectives(
  world: World,
  rules: EngineRules,
  slot: number,
  s: CivStrategy,
  ctx: StrategyContext,
  events: StrategyEvent[],
): void {
  const base = Math.min(99, Math.max(3, s.combatUnits >> 3));
  const budget = s.objectives.map((o) => (o.type === 0 ? base * 2 : base));
  for (let i = world.units.length - 1; i >= 0; i--) {
    const u = world.units[i];
    if (!u || u.owner !== slot) continue;
    const type = rules.units[u.type];
    if (!type || type.attack >= 99) continue;
    const assignable =
      u.order === null ||
      u.order === ORDER.goTo ||
      u.order === ORDER.fortify ||
      u.order === ORDER.fortified;
    if (!assignable) continue;
    const ocean = world.terrainAt(u.position.x, u.position.y) === OCEAN;
    const lm = landmassOf(world, u.position);
    const cityHere = world.cityAt(u.position.x, u.position.y);
    const stack = world.unitsAt(u.position.x, u.position.y);

    // Free upgrades: one unit in sixteen a turn, obsolete types or Warriors on a full land mass.
    if ((ctx.turn & i & 15) === 0) {
      const obsolete = type.obsoleteWith;
      const obsoleteKnown = obsolete?.kind === 'advance' && ctx.knows(slot, obsolete.index);
      const warriorsOnFull =
        (world.civs.find((c) => c.slot === slot)?.government ?? 0) > 1 &&
        s.plans[lm] === PLAN.full &&
        u.type === WARRIORS;
      if (
        (obsoleteKnown || warriorsOnFull) &&
        !foreignUnitAdjacentSameDomain(world, u.position, slot) &&
        (!cityHere || stack.length > 1) &&
        !ocean &&
        ((s.landFlags[lm] ?? 0) & LAND_FLAG.watch) === 0
      ) {
        const seenByHuman =
          ctx.mainHuman !== null && world.isSeen(u.position.x, u.position.y, ctx.mainHuman);
        const fortress = world.hasFlag(u.position.x, u.position.y, SquareFlag.Fortress);
        if (!obsoleteKnown || seenByHuman || (!fortress && (!cityHere || stack.length !== 1))) {
          // Disband into the nearest city's production box for half the cost.
          const near = nearestCityAny(world, u.position);
          if (near && near.city.owner === slot)
            near.city.shieldsStored += Math.trunc((type.costRows * rules.cosmic.shieldBoxRows) / 2);
          world.units.splice(i, 1);
          events.push({ kind: 'ai-strategy', text: `${type.name} disbanded as obsolete` });
          continue;
        }
        const successor = rules.units.findIndex(
          (t, ti) =>
            ti !== u.type &&
            t.role === type.role &&
            t.preq?.kind === 'advance' &&
            obsolete?.kind === 'advance' &&
            t.preq.index === obsolete.index,
        );
        if (successor >= 0) {
          events.push({
            kind: 'ai-strategy',
            text: `${type.name} upgraded to ${rules.units[successor]?.name ?? '?'}`,
          });
          u.type = successor;
        }
      }
    }

    const role = aiRole(rules, u);
    if (role === 7 && u.order === ORDER.goTo && u.gotoTarget) {
      const target = world.cityAt(u.gotoTarget.x, u.gotoTarget.y);
      if (target && target.owner !== slot) continue;
    }
    if (role === 0 && type.attack === 0) continue;
    const fortifiedNow = u.order === ORDER.fortify || u.order === ORDER.fortified;
    let best = -1;
    let bestScore = 9999;
    s.objectives.forEach((o, oi) => {
      if (o.type === -1 || o.priority <= 0) return;
      // VERIFIED 0x004ed2dd: a sub-spotting warship also answers type 18; a heavy aircraft answers
      // its own type and naval (type 2) objectives wherever they lie.
      const air = type.domain === DOMAIN_AIR;
      const wanted = o.type === 18 && role === 2 && type.flags.spotsSubmarines ? 18 : role;
      const heavy = air && type.attack >= (rules.units[28]?.attack ?? 99);
      if (
        !(o.type === wanted && landmassOf(world, o) === lm) &&
        !(heavy && (o.type === wanted || o.type === 2))
      )
        return;
      const dist = distance(world, u.position, o);
      const share = Math.trunc((budget[oi] ?? base) / (o.type === 0 ? 2 : 1));
      let score: number;
      if (!air) {
        score = Math.trunc((share * dist) / (o.priority + 1));
      } else if (type.range === 1) {
        // A fighter goes only within half its range and back.
        if (dist > (type.move - 2) >> 1) return;
        score = dist;
      } else {
        // A bomber answers odd priorities on alternate turns, nearer ones counting double.
        if ((o.priority & 1) === 0 || (((ctx.turn >> 1) + oi) & 1) === 0) return;
        score = Math.trunc(((dist <= type.move ? 4 : 2) * dist) / (o.priority + 1));
      }
      if (
        fortifiedNow &&
        !(o.priority > 1 && (score <= o.priority * base || share === base) && !cityHere)
      )
        return;
      if (score < bestScore && Math.trunc(score / base) < o.priority * 4) {
        bestScore = score;
        best = oi;
      }
    });
    if (best < 0) continue;
    const o = s.objectives[best];
    if (!o) continue;
    if (o.x === u.position.x && o.y === u.position.y) {
      u.arrived = true;
      if (type.role !== 5) fortify(u); // the original's hold order
      continue;
    }
    if (role === 1 && world.hasFlag(u.position.x, u.position.y, SquareFlag.Fortress)) {
      if ((o.priority & 1) === 0) continue;
      addGoal(s, { x: u.position.x, y: u.position.y, type: 1, priority: 2 });
    }
    orderGoTo(u, { x: o.x, y: o.y });
    if (role === 5 && world.cityAt(o.x, o.y)) o.priority = 0;
    budget[best] = (budget[best] ?? base) + 1;
  }
}
