/**
 * Barbarians: where they appear and how they move.
 *
 * Port of the original's uprising and landing spawner (0x00465e35, run once per turn from the
 * turn driver 0x00467591) and the barbarian move chooser (0x004f0c4c, the branch the move
 * chooser takes for civilization 0). VERIFIED unless marked INFERRED; the unit types and
 * advances the original names by index are listed below exactly as it hard-codes them.
 * docs/engine/ai-units.md, "Barbarians".
 */
import { resolveAttack } from './attack.js';
import { distance } from './city.js';
import { captureCity, plunder } from './conquest.js';
import { makeUnit } from './huts.js';
import {
  applyMove,
  inEnemyZoc,
  movesLeft,
  THIRDS,
  tryMove,
  type MovementContext,
} from './movement.js';
import { fortify, orderGoTo, pillage, pillageOptions, sentry } from './orders.js';
import type { Rng } from './rng.js';
import { DOMAIN_SEA, type EngineRules } from './rules.js';
import { ORDER } from './terraform.js';
import { gotoStep } from './turnStart.js';
import {
  NEIGHBOUR_OFFSETS,
  OCEAN,
  SquareFlag,
  type City,
  type Civ,
  type Point,
  type Unit,
  type World,
} from './world.js';

/** Unit type indices the original hard-codes for barbarians (RULES @UNITS order). */
export const BARBARIAN_UNITS = {
  warriors: 2,
  archers: 4,
  legion: 5,
  musketeers: 7,
  fanatics: 8,
  partisans: 9,
  riflemen: 11,
  horsemen: 15,
  chariot: 16,
  elephant: 17,
  crusaders: 18,
  knights: 19,
  dragoons: 20,
  cavalry: 21,
  armor: 22,
  cannon: 24,
  artillery: 25,
  trireme: 32,
  caravel: 33,
  frigate: 35,
  /** The barbarian leader is the Diplomat unit type owned by civilization 0. */
  leader: 46,
} as const;

/** Advance indices the original hard-codes (RULES @CIVILIZE order). */
export const BARBARIAN_ADVANCES = {
  chivalry: 11,
  guerrillaWarfare: 34,
  gunpowder: 35,
  industrialization: 37,
  ironWorking: 39,
  magnetism: 45,
  metallurgy: 51,
  navigation: 57,
  tactics: 81,
} as const;

const ROLE_ATTACK = 0;
const ROLE_DEFEND = 1;
const ROLE_LEADER = 6;

export interface BarbarianContext extends MovementContext {
  /** Scenario events: UNITKILLED. */
  onUnitKilled?: (type: number, attacker: number, defender: number) => void;
  onCityEmptied?: (city: City) => void;
  rng: Rng;
  turn: number;
  /** Game year, for the ransom rule. */
  year: number;
  difficulty: number;
  /** Header barbarian activity: 0 villages only, 1 roving, 2 restless, 3 raging. */
  activity: number;
  realisticCombat: boolean;
  anyoneKnows: (advance: number) => boolean;
  humanKnows: (advance: number) => boolean;
  isHuman: (slot: number) => boolean;
  mainHuman: number | null;
  cityCount: (slot: number) => number;
  wondersOf: (slot: number) => boolean[];
  guerillaWarfareDiscovered: boolean;
  /** A human's answer to a ransom demand (the RANSOMCITY dialog); INFERRED default: refuse. */
  payRansom?: (city: City, amount: number) => boolean;
  /** Options byte 0 bit 0, set in every shipped file (meaning INFERRED: the expanded unit set). */
  optionBit0?: boolean;
}

export interface BarbarianEvent {
  kind: 'barbarians';
  text: string;
  at?: Point;
}

const waterCache = new WeakMap<World, number[]>();

/** Ocean squares per water body id (the map maker's per-land-mass table, +4). */
function waterBodySizes(world: World): number[] {
  const cached = waterCache.get(world);
  if (cached) return cached;
  const out = Array<number>(64).fill(0);
  for (let i = 0; i < world.area; i++) {
    if ((world.terrain[i] ?? OCEAN) !== OCEAN) continue;
    const id = (world.landmass[i] ?? 0) & 63;
    out[id] = (out[id] ?? 0) + 1;
  }
  waterCache.set(world, out);
  return out;
}

function landmassOf(world: World, p: Point): number {
  return (world.landmass[world.index(p.x, p.y)] ?? 0) & 63;
}

function nearestCity(world: World, p: Point, pick: (c: City) => boolean = () => true) {
  let best: City | null = null;
  let bestD = 9999;
  for (const c of world.cities) {
    if (!pick(c)) continue;
    const d = distance(world, p, c.position);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best ? { city: best, dist: bestD } : null;
}

function randomBelow(rng: Rng, n: number): number {
  return n - 1 < 1 ? 0 : rng.nextInt(n);
}

/** The mobile-warfare advance: the prerequisite of unit type 22 (Armor), as the original reads it. */
function mobileWarfare(rules: EngineRules): number | null {
  const preq = rules.units[BARBARIAN_UNITS.armor]?.preq;
  return preq?.kind === 'advance' ? preq.index : null;
}

/**
 * Once per turn: a sea landing on the activity's schedule while nobody knows the mobile-warfare
 * advance, and an uprising near a random human city with a chance equal to its plunder value.
 */
export function spawnBarbarians(
  world: World,
  rules: EngineRules,
  ctx: BarbarianContext,
): BarbarianEvent[] {
  const events: BarbarianEvent[] = [];
  const { activity, turn, difficulty, rng } = ctx;
  if (activity === 0) return events;
  if (difficulty < 5) {
    if (turn < ((3 - activity) * 3 + 30) * (5 - difficulty)) return events;
  } else if (turn < (3 - activity) * 3 + 15) return events;
  const opt = ctx.optionBit0 ?? true;
  const anyone = (a: number | null) => a !== null && ctx.anyoneKnows(a);
  const human = (a: number | null) => a !== null && ctx.humanKnows(a);

  // Sea landings.
  const mask = activity === 1 ? 15 : 7;
  if (((turn + 1) & mask) === 0 && !anyone(mobileWarfare(rules))) {
    let square: Point | null = null;
    for (let tries = 0; tries < 1000; tries++) {
      let x = randomBelow(rng, world.widthX2);
      const y = randomBelow(rng, world.rows - 6) + 3;
      if ((x & 1) !== 0) x -= 1;
      if ((y & 1) !== 0) x += 1;
      if (!world.isSquare(x, y)) continue;
      if (world.terrainAt(x, y) !== OCEAN) continue;
      if (world.unitsAt(x, y).length > 0) continue;
      if ((waterBodySizes(world)[landmassOf(world, { x, y })] ?? 0) < 16) continue;
      square = { x, y };
      break;
    }
    if (square) {
      const base = Math.min(5, Math.max(1, Math.trunc(turn / (250 - 50 * activity)) + 1));
      const count = base + (activity === 3 ? 2 : 1);
      let ship: number = BARBARIAN_UNITS.trireme;
      if (anyone(BARBARIAN_ADVANCES.navigation)) ship = BARBARIAN_UNITS.caravel;
      if (anyone(BARBARIAN_ADVANCES.magnetism)) ship = BARBARIAN_UNITS.frigate;
      let troop: number = BARBARIAN_UNITS.warriors;
      if (opt) troop = BARBARIAN_UNITS.archers;
      if (human(BARBARIAN_ADVANCES.ironWorking)) troop = BARBARIAN_UNITS.legion;
      if (
        anyone(BARBARIAN_ADVANCES.metallurgy) ||
        (activity === 3 && anyone(BARBARIAN_ADVANCES.chivalry))
      )
        troop = (square.x & 1) === 0 || !opt ? BARBARIAN_UNITS.knights : BARBARIAN_UNITS.crusaders;
      if (human(BARBARIAN_ADVANCES.tactics) && opt) troop = BARBARIAN_UNITS.dragoons;
      for (let i = count - 1; i >= 0; i--) {
        const type = i !== 0 && i === count - 1 ? BARBARIAN_UNITS.leader : troop;
        if (!rules.units[type]) continue;
        const u = makeUnit(world, type, 0, square, null);
        sentry(u); // aboard
      }
      if (rules.units[ship]) {
        makeUnit(world, ship, 0, square, null);
        events.push({ kind: 'barbarians', text: 'a barbarian fleet puts to sea', at: square });
      }
    }
  }

  // Uprisings.
  if (world.cities.length === 0) return events;
  const pickIndex = randomBelow(rng, world.cities.length);
  const city = world.cities[pickIndex];
  if (!city || !ctx.isHuman(city.owner)) return events;
  const owner = world.civs.find((c) => c.slot === city.owner);
  if (!owner) return events;
  const population = world.cities
    .filter((c) => c.owner === city.owner)
    .reduce((s, c) => s + c.size, 0);
  if (rng.nextInt(100) >= plunder(owner, city, population)) return events;
  let square: Point | null = null;
  let near: { city: City; dist: number } | null = null;
  let tries = 0;
  const limit = activity * 50;
  while (tries < limit) {
    let x = city.position.x + rng.nextInt(13) * 2 - 6;
    const y = city.position.y + rng.nextInt(13) - 6;
    if ((x & 1) !== 0) x -= 1;
    if ((y & 1) !== 0) x += 1;
    const wrapped = y >= 0 && y < world.rows ? world.wrapX(x, y) : null;
    if (wrapped !== null) x = wrapped;
    const valid = wrapped !== null && world.isSquare(x, y);
    if (valid) {
      near = nearestCity(world, { x, y });
      if (!near) {
        tries = 200;
        break;
      }
    }
    tries += 1;
    if (tries >= limit) break;
    if (!valid || !near || near.dist < 5) continue;
    if (inEnemyZoc(world, x, y, 0)) continue;
    if (world.terrainAt(x, y) === OCEAN) continue;
    if (world.unitsAt(x, y).length > 0) continue;
    if (landmassOf(world, near.city.position) !== landmassOf(world, { x, y })) continue;
    square = { x, y };
    break;
  }
  if (!square || !near || tries >= limit) return events;
  const size = near.city.size;
  let count = randomBelow(rng, size);
  if (activity === 3 && turn > 149) {
    const roll = 9 - difficulty < 1 ? 0 : rng.nextInt(10 - difficulty);
    if (roll === 0) {
      const half = Math.trunc(size / 2);
      const extra = half - 1 < 1 ? 0 : rng.nextInt(half);
      count += extra + half;
    }
  }
  count = Math.min(99, Math.max(2, count));
  let a: number = BARBARIAN_UNITS.chariot;
  let b: number = BARBARIAN_UNITS.horsemen;
  if (rng.nextInt(3) === 0) [a, b] = [b, a];
  if (anyone(BARBARIAN_ADVANCES.gunpowder) && opt) {
    a = BARBARIAN_UNITS.archers;
    b = BARBARIAN_UNITS.elephant;
  }
  if (anyone(BARBARIAN_ADVANCES.industrialization)) {
    a = BARBARIAN_UNITS.cannon;
    b = BARBARIAN_UNITS.musketeers;
    if (anyone(mobileWarfare(rules))) {
      b = BARBARIAN_UNITS.riflemen;
      if (opt) {
        a = BARBARIAN_UNITS.artillery;
        if (anyone(BARBARIAN_ADVANCES.guerrillaWarfare)) {
          const humanGov =
            ctx.mainHuman === null
              ? 0
              : (world.civs.find((c) => c.slot === ctx.mainHuman)?.government ?? 0);
          const founder = near.city.previousOwner ?? near.city.owner;
          if (humanGov < 5 || founder !== near.city.owner) {
            a = BARBARIAN_UNITS.cavalry;
            b = BARBARIAN_UNITS.partisans;
          } else {
            b = BARBARIAN_UNITS.fanatics;
          }
        }
      }
    }
  }
  let made = 0;
  for (let i = count; i >= 0; i--) {
    const type = i === count ? BARBARIAN_UNITS.leader : (i & 4) !== 0 ? a : b;
    if (!rules.units[type]) continue;
    makeUnit(world, type, 0, square, null);
    made += 1;
  }
  if (made > 0) {
    events.push({
      kind: 'barbarians',
      text: `barbarians rise near ${near.city.name}`,
      at: square,
    });
    if (ctx.isHuman(near.city.owner)) world.reveal(square.x, square.y, near.city.owner);
  }
  return events;
}

function deleteUnit(world: World, unit: Unit): void {
  const i = world.units.indexOf(unit);
  if (i >= 0) world.units.splice(i, 1);
}

/** A ship lost at sea takes the land units aboard with it (INFERRED: the original's cargo rule). */
function deleteShip(world: World, rules: EngineRules, ship: Unit): void {
  if (world.terrainAt(ship.position.x, ship.position.y) === OCEAN) {
    for (const u of [...world.unitsAt(ship.position.x, ship.position.y)]) {
      if (u !== ship && u.owner === ship.owner && rules.units[u.type]?.domain !== DOMAIN_SEA)
        deleteUnit(world, u);
    }
  }
  deleteUnit(world, ship);
}

function neighbour(world: World, p: Point, dir: number): Point | null {
  const off = NEIGHBOUR_OFFSETS[dir];
  if (!off) return null;
  const y = p.y + off.y;
  if (y < 0 || y >= world.rows) return null;
  const x = world.wrapX(p.x + off.x, y);
  return x === null ? null : { x, y };
}

function countRole(rules: EngineRules, units: Unit[], role: number): number {
  return units.filter((u) => rules.units[u.type]?.role === role).length;
}

function sign(n: number): number {
  return n < 0 ? -1 : n > 0 ? 1 : 0;
}

/** Move every barbarian unit once (the original's 0x004f0c4c per unit, called while it has moves). */
export function barbarianMoves(
  world: World,
  rules: EngineRules,
  barbarians: Civ,
  ctx: BarbarianContext,
): BarbarianEvent[] {
  const events: BarbarianEvent[] = [];
  for (const unit of [...world.units]) {
    if (unit.owner !== 0 || !world.units.includes(unit)) continue;
    let guard = 0;
    while (world.units.includes(unit) && movesLeft(rules, unit, ctx) > 0 && guard++ < 12) {
      if (unit.order === ORDER.goTo && unit.gotoTarget) {
        const r = gotoStep(world, rules, ctx.rng, unit, ctx);
        if (r.kind !== 'goto-step') {
          unit.order = null;
          unit.gotoTarget = null;
          continue;
        }
        if (r.arrived) unit.order = null;
        continue;
      }
      if (!barbarianStep(world, rules, barbarians, unit, ctx, events)) break;
    }
  }
  return events;
}

/** One decision for a barbarian unit; returns true when it moved and may act again. */
export function barbarianStep(
  world: World,
  rules: EngineRules,
  barbarians: Civ,
  unit: Unit,
  ctx: BarbarianContext,
  events: BarbarianEvent[],
): boolean {
  const type = rules.units[unit.type];
  if (!type) return false;
  const here = unit.position;
  if (here.y < 2 || here.y >= world.rows - 2) {
    deleteUnit(world, unit);
    return false;
  }
  const inZoc = inEnemyZoc(world, here.x, here.y, 0);
  const near = nearestCity(world, here);
  const stack = world.unitsAt(here.x, here.y);
  const leaders = countRole(rules, stack, ROLE_LEADER);
  const hereOcean = world.terrainAt(here.x, here.y) === OCEAN;

  if ((type.holds ?? 0) !== 0) {
    // Ships: disband with fewer than two passengers or after thirty turns; unload next to a
    // city's land mass; attack a foreign ship alongside; otherwise sail for the richest city.
    if (stack.length - leaders < 2) {
      deleteShip(world, rules, unit);
      return false;
    }
    unit.workCounter += 1;
    if (unit.workCounter > 30) {
      deleteShip(world, rules, unit);
      return false;
    }
    for (let dir = 0; dir < 8; dir++) {
      const n = neighbour(world, here, dir);
      if (!n) continue;
      const land = world.terrainAt(n.x, n.y) !== OCEAN;
      if (
        near &&
        near.dist < 9 &&
        land &&
        !world.cityAt(n.x, n.y) &&
        n.y > 1 &&
        n.y < world.rows - 2 &&
        landmassOf(world, near.city.position) === landmassOf(world, n)
      ) {
        if (
          stack.length < 3 &&
          countRole(rules, stack, ROLE_ATTACK) === 0 &&
          countRole(rules, stack, ROLE_DEFEND) === 0 &&
          near.dist < 3
        ) {
          deleteShip(world, rules, unit);
          return false;
        }
        let landed = 0;
        for (const cargo of [...stack]) {
          if (cargo === unit || rules.units[cargo.type]?.domain === DOMAIN_SEA) continue;
          cargo.order = null;
          const r = tryMove(world, rules, ctx.rng, cargo, n, ctx);
          if (r.kind === 'moved') landed += 1;
        }
        if (landed > 0) {
          events.push({
            kind: 'barbarians',
            text: `barbarians land near ${near.city.name}`,
            at: n,
          });
          if (ctx.isHuman(near.city.owner)) world.reveal(n.x, n.y, near.city.owner);
        }
        return false;
      }
      if (!land && world.unitsAt(n.x, n.y).some((u) => u.owner > 0)) {
        attackSquare(world, rules, barbarians, unit, n, ctx, events);
        return false;
      }
    }
    if (unit.order !== ORDER.goTo) {
      let best: City | null = null;
      let bestScore = 0;
      for (const c of world.cities) {
        if (c.owner === 0) continue;
        const owner = world.civs.find((v) => v.slot === c.owner);
        if (!owner) continue;
        const population = world.cities
          .filter((x) => x.owner === c.owner)
          .reduce((s, x) => s + x.size, 0);
        const score = Math.trunc(
          (plunder(owner, c, population) + 50) / (distance(world, here, c.position) + 1),
        );
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (!best) {
        deleteShip(world, rules, unit);
        return false;
      }
      orderGoTo(unit, best.position);
    }
    return false;
  }

  // Land units.
  const onCity = near !== null && near.dist === 0;
  const fortress = world.hasFlag(here.x, here.y, SquareFlag.Fortress);
  if (onCity || fortress) {
    const roam =
      ((stack.length - leaders > 1 || inZoc) && type.role !== ROLE_DEFEND) ||
      (stack.length >= (onCity ? 1 : 0) + 2 + (inZoc ? 0 : 1) && type.defence <= type.attack);
    if (!roam) {
      fortify(unit);
      return false;
    }
  }
  if (near && ((ctx.turn + unit.id) & 3) === 0 && !hereOcean) {
    if (landmassOf(world, near.city.position) !== landmassOf(world, here) || near.dist > 8) {
      deleteUnit(world, unit);
      return false;
    }
  }
  // Preferred heading: toward the nearest city when it is a human's on this land mass with
  // at least two cities and 100 gold.
  let dx = -3;
  let dy = -3;
  if (
    near &&
    landmassOf(world, near.city.position) === landmassOf(world, here) &&
    ctx.isHuman(near.city.owner)
  ) {
    let ddx = near.city.position.x - here.x;
    if (!world.flatEarth && Math.abs(ddx) >= world.widthX2 >> 1) ddx = -ddx;
    dx = sign(ddx);
    dy = sign(near.city.position.y - here.y);
    const owner = world.civs.find((c) => c.slot === near.city.owner);
    if (
      near.city.owner === 0 ||
      ctx.cityCount(near.city.owner) < 2 ||
      (owner?.treasury ?? 0) < 100
    ) {
      dx = -3;
      dy = -3;
    }
  }
  if (type.role > 4) {
    // Leaders stay with a stack; alone they look for a barbarian stack nearby, else fade away.
    if (stack.length > 1 && !hereOcean && countRole(rules, stack, type.role) < 2) {
      unit.lastDirection = null;
      return false;
    }
    if (hereOcean) {
      if (near && near.dist < 3) {
        deleteUnit(world, unit);
        return false;
      }
    } else {
      let other: Unit | null = null;
      let otherDist = 9999;
      for (const u of world.units) {
        if (u === unit || u.owner !== 0) continue;
        const d = distance(world, here, u.position);
        if (d <= otherDist) {
          otherDist = d;
          other = u;
        }
      }
      if (other && otherDist < 4 && (rules.units[other.type]?.role ?? 9) < 2) {
        orderGoTo(unit, other.position);
        return false;
      }
      if (near && near.dist >= (ctx.turn & 7) + 4) {
        deleteUnit(world, unit);
        return false;
      }
    }
  }

  // Direction scoring.
  let best = -999;
  let bestDir = 8;
  let bestAttack: Point | null = null;
  for (let dir = 0; dir < 8; dir++) {
    const n = neighbour(world, here, dir);
    if (!n) continue;
    const nOcean = world.terrainAt(n.x, n.y) === OCEAN;
    if ((type.domain === DOMAIN_SEA) !== nOcean) continue;
    const occupants = world.unitsAt(n.x, n.y);
    const occupantOwner = occupants[0]?.owner ?? -1;
    const cityAt = world.cityAt(n.x, n.y);
    let score = 0;
    let attack = false;
    if (type.role < 5) {
      if (cityAt && cityAt.owner !== 0) {
        if (hereOcean) continue;
        if (occupants.length === 0) {
          const owner = world.civs.find((c) => c.slot === cityAt.owner);
          if (owner) {
            // Ransom: the city's size × 25 or half the treasury (at least 50), whichever is
            // more; a human with more than four cities after 200 AD pays the treasury rounded
            // down to hundreds, and an amount below 1000 becomes the treasury plus one.
            let amount = Math.max(cityAt.size * 25, Math.max(50, Math.trunc(owner.treasury / 2)));
            if (ctx.isHuman(cityAt.owner) && ctx.year > 200 && ctx.cityCount(cityAt.owner) > 4) {
              amount = Math.trunc(owner.treasury / 100) * 100;
              if (amount < 1000) amount = owner.treasury + 1;
            }
            if (ctx.isHuman(cityAt.owner) && amount <= owner.treasury) {
              events.push({
                kind: 'barbarians',
                text: `barbarians demand ${amount} gold for ${cityAt.name}`,
                at: n,
              });
              if (ctx.payRansom?.(cityAt, amount) === true) {
                owner.treasury -= amount;
                for (let i = 0; i < 20; i++) {
                  const q = world.radiusSquare(cityAt.position.x, cityAt.position.y, i);
                  if (!q) continue;
                  for (const u of [...world.unitsAt(q.x, q.y)])
                    if (u.owner === 0) deleteUnit(world, u);
                }
                return false;
              }
            }
          }
          bestDir = dir;
          bestAttack = null;
          best = 999;
          break;
        }
        continue;
      }
      // No foreign city: terrain and heading terms.
      const standing = cityAt?.owner ?? occupantOwner;
      if (standing >= 0 && standing !== 0) score += 4;
      if (world.hasFlag(n.x, n.y, SquareFlag.Fortress)) score += 8;
      else if (
        world.hasFlag(n.x, n.y, SquareFlag.Irrigation) ||
        world.hasFlag(n.x, n.y, SquareFlag.Mine)
      )
        score += 6;
      score += ctx.rng.nextInt(6);
      if (occupants.length === 0) {
        // fall through to the zone-of-control gate below
      } else if (occupantOwner === 0) {
        if (!hereOcean) continue;
        score -= 20;
      } else {
        if (hereOcean) continue;
        const targetRole = rules.units[occupants[0]?.type ?? 0]?.role ?? 0;
        if (unit.type === BARBARIAN_UNITS.partisans) {
          if (targetRole < 5) continue;
          score += 99;
        } else if (targetRole !== ROLE_LEADER) score += 99;
        attack = true;
      }
      const gate =
        !inZoc ||
        type.role !== ROLE_ATTACK ||
        occupants.length > 0 ||
        !inEnemyZoc(world, n.x, n.y, 0) ||
        type.flags.ignoreZonesOfControl;
      if (!gate) continue;
      if (unit.lastDirection === dir) score += 6;
      const off = NEIGHBOUR_OFFSETS[dir];
      if (off && dx !== -3 && sign(off.x) === dx) score += 2;
      if (off && dy !== -3 && sign(off.y) === dy) score += 2;
    } else {
      if (occupants.length > 0) score = occupantOwner === 0 ? 99 : -99;
      const nNear = nearestCity(world, n);
      score +=
        (rules.terrain[world.terrainAt(n.x, n.y)]?.moveCost ?? 1) +
        ctx.rng.nextInt(3) +
        (nNear ? nNear.dist : 0) * 4;
    }
    if (score >= best) {
      best = score;
      bestDir = dir;
      bestAttack = attack ? n : null;
    }
  }
  if (world.cityAt(here.x, here.y) && stack.length <= 1 && best <= 98) bestDir = 8;
  else if (
    best < 99 &&
    movesLeft(rules, unit, ctx) <= THIRDS &&
    near &&
    ctx.isHuman(near.city.owner)
  ) {
    const options = pillageOptions(world, rules, unit);
    const road = world.hasFlag(here.x, here.y, SquareFlag.Road);
    const worth =
      world.hasFlag(here.x, here.y, SquareFlag.Irrigation) ||
      world.hasFlag(here.x, here.y, SquareFlag.Mine) ||
      world.hasFlag(here.x, here.y, SquareFlag.Fortress) ||
      (unit.type === BARBARIAN_UNITS.partisans && road);
    if (worth && options.ok && options.options[0]) {
      pillage(world, rules, unit, options.options[0]);
      events.push({
        kind: 'barbarians',
        text: `barbarians pillage near ${near.city.name}`,
        at: here,
      });
      unit.movesSpent = 999;
      return false;
    }
  }
  if (bestDir === 8) {
    unit.lastDirection = null;
    if (type.role === ROLE_DEFEND || fortress) fortify(unit);
    return false;
  }
  const target = neighbour(world, here, bestDir);
  if (!target) return false;
  if (bestAttack) {
    attackSquare(world, rules, barbarians, unit, target, ctx, events);
    return false;
  }
  const r = tryMove(world, rules, ctx.rng, unit, target, ctx);
  if (r.kind === 'attack') {
    const city = world.cityAt(target.x, target.y);
    if (city && city.owner !== 0 && world.unitsAt(target.x, target.y).length === 0) {
      takeCity(world, rules, barbarians, unit, city, ctx, events);
      return false;
    }
    attackSquare(world, rules, barbarians, unit, target, ctx, events);
    return false;
  }
  if (r.kind !== 'moved') return false;
  unit.lastDirection = bestDir;
  return true;
}

/** Walk into an undefended city and take it (the capture rules of conquest.ts). */
function takeCity(
  world: World,
  rules: EngineRules,
  barbarians: Civ,
  unit: Unit,
  city: City,
  ctx: BarbarianContext,
  events: BarbarianEvent[],
): void {
  const loser = world.civs.find((c) => c.slot === city.owner);
  if (!loser) return;
  const at = { x: city.position.x, y: city.position.y };
  const ev = captureCity(world, rules, ctx.rng, city, barbarians, loser, {
    turn: ctx.turn,
    difficulty: ctx.difficulty,
    conquest: true,
    guerillaWarfareDiscovered: ctx.guerillaWarfareDiscovered,
  });
  if (!ev.cityDestroyed) applyMove(rules, unit, at, THIRDS, ctx);
  events.push({
    kind: 'barbarians',
    text: ev.cityDestroyed ? `barbarians destroy ${city.name}` : `barbarians take ${city.name}`,
    at,
  });
}

function attackSquare(
  world: World,
  rules: EngineRules,
  barbarians: Civ,
  unit: Unit,
  target: Point,
  ctx: BarbarianContext,
  events: BarbarianEvent[],
): void {
  const ev = resolveAttack(world, rules, ctx.rng, unit, target, {
    civ: (slot) => (slot === 0 ? barbarians : world.civs.find((c) => c.slot === slot)),
    wondersOf: ctx.wondersOf,
    cityCount: ctx.cityCount,
    difficulty: ctx.difficulty,
    realisticCombat: ctx.realisticCombat,
    barbarianActivity: ctx.activity,
    attackerMovesLeft: movesLeft(rules, unit, ctx),
    ...(ctx.onUnitKilled ? { onUnitKilled: ctx.onUnitKilled } : {}),
    ...(ctx.onCityEmptied ? { onCityEmptied: ctx.onCityEmptied } : {}),
  });
  if (ev.kind === 'fought') {
    events.push({
      kind: 'barbarians',
      text: `barbarians attack ${rules.units[ev.defender.type]?.name ?? 'a unit'}: ${ev.attackerWon ? 'win' : 'lose'}`,
      at: target,
    });
  }
}
