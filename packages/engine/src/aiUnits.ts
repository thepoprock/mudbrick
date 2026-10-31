/**
 * Interim unit behaviour for computer players — INFERRED, not the original's.
 *
 * The original decides moves in a 44 KB routine driven by continent plans and an objectives
 * table (docs/engine/ai-units.md). Until that is read, this module gives computer civilizations
 * simple, sane behaviour so games progress: settlers found cities on good sites and irrigate,
 * defenders garrison cities, attackers hit weaker neighbours and otherwise hold, caravans help
 * wonders, ships and aircraft stay put. Every rule here is a placeholder.
 */
import { resolveAttack } from './attack.js';
import { distance } from './city.js';
import { attackStrength, defenceStrength } from './combat.js';
import { chooseDefender } from './defender.js';
import { canFoundCity, foundCity } from './founding.js';
import { checkMove, movesLeft, tryMove, type MovementContext } from './movement.js';
import { fortify, sentry } from './orders.js';
import type { Rng } from './rng.js';
import { DOMAIN_GROUND, IMPROVEMENT, type EngineRules } from './rules.js';
import { canOrder, doWork, ORDER } from './terraform.js';
import {
  OCEAN,
  SquareFlag,
  type City,
  type Civ,
  type Point,
  type Unit,
  type World,
} from './world.js';

export interface AiUnitContext extends MovementContext {
  rng: Rng;
  civ: Civ;
  difficulty: number;
  realisticCombat: boolean;
  turn: number;
  /** Is `slot` an enemy of the acting civilization? */
  atWar: (slot: number) => boolean;
  knows: (advance: number) => boolean;
  wondersOf: (slot: number) => boolean[];
  cityCount: (slot: number) => number;
  nextCityName: () => string;
  /** Called when a unit is created or destroyed so the caller can keep its own bookkeeping. */
  onEvent?: (text: string) => void;
}

export interface AiUnitEvent {
  kind: 'ai-unit';
  text: string;
}

const ROLE_DEFEND = 1;
const ROLE_SETTLE = 5;
const ROLE_TRADE = 7;

function neighboursOf(world: World, p: Point): Point[] {
  return world.neighbours(p.x, p.y).filter((n): n is Point => n !== null);
}

/** One greedy step toward `target`; returns false when no step is possible. */
function stepToward(
  world: World,
  rules: EngineRules,
  unit: Unit,
  target: Point,
  ctx: AiUnitContext,
): boolean {
  let best: Point | null = null;
  let bestD = distance(world, unit.position, target);
  for (const n of neighboursOf(world, unit.position)) {
    const v = checkMove(world, rules, unit, n, ctx);
    if (!v.ok || v.boards) continue;
    const d = distance(world, n, target);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  if (!best) return false;
  const r = tryMove(world, rules, ctx.rng, unit, best, ctx);
  return r.kind === 'moved';
}

/** Score a city site: land squares in the radius, minus closeness to other cities. */
function siteScore(world: World, p: Point): number {
  if (world.terrainAt(p.x, p.y) === OCEAN) return -1;
  for (const c of world.cities) if (distance(world, c.position, p) < 3) return -1;
  let land = 0;
  let water = 0;
  for (let i = 0; i < 21; i++) {
    const q = world.radiusSquare(p.x, p.y, i);
    if (!q) continue;
    if (world.terrainAt(q.x, q.y) === OCEAN) water += 1;
    else land += 1;
  }
  if (land < 12) return -1;
  let score = land + Math.min(water, 6);
  if (world.hasFlag(p.x, p.y, SquareFlag.River)) score += 3;
  const t = world.terrainAt(p.x, p.y);
  if (t === 1 || t === 2) score += 4; // plains, grassland
  if (t === 4) score += 2; // hills
  return score;
}

function nearestCity(world: World, from: Point, pick: (c: City) => boolean): City | null {
  let best: City | null = null;
  let bestD = 99;
  for (const c of world.cities) {
    if (!pick(c)) continue;
    const d = distance(world, from, c.position);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function defendersIn(world: World, rules: EngineRules, c: City): number {
  return world
    .unitsAt(c.position.x, c.position.y)
    .filter((u) => u.owner === c.owner && rules.units[u.type]?.role === ROLE_DEFEND).length;
}

function wanted(c: City): number {
  return Math.max(1, (c.size >> 2) + (c.improvements[IMPROVEMENT.palace] ? 2 : 1));
}

/** Attack an adjacent enemy if the odds look good. Returns true when an attack happened. */
function tryAttack(
  world: World,
  rules: EngineRules,
  unit: Unit,
  ctx: AiUnitContext,
  events: AiUnitEvent[],
): boolean {
  const type = rules.units[unit.type];
  if (!type || type.attack === 0) return false;
  let bestTarget: Point | null = null;
  let bestRatio = 0;
  for (const n of neighboursOf(world, unit.position)) {
    const enemies = world.unitsAt(n.x, n.y).filter((u) => ctx.atWar(u.owner));
    const city = world.cityAt(n.x, n.y);
    if (enemies.length === 0) {
      if (city && ctx.atWar(city.owner) && type.domain === DOMAIN_GROUND) {
        bestTarget = n;
        bestRatio = 99;
      }
      continue;
    }
    const defender = chooseDefender(world, rules, enemies, unit, {
      defenderFortified: enemies.some((u) => u.fortified),
      ...(city ? { defenderCity: city.improvements } : {}),
    });
    if (!defender) continue;
    const a = attackStrength(rules, unit, movesLeft(rules, unit, ctx)).value;
    const d = defenceStrength(world, rules, defender, unit, {
      defenderFortified: defender.fortified,
      ...(city ? { defenderCity: city.improvements } : {}),
    }).value;
    const ratio = d === 0 ? 99 : a / d;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestTarget = n;
    }
  }
  if (!bestTarget || bestRatio < 1.3) return false;
  const enemies = world.unitsAt(bestTarget.x, bestTarget.y).filter((u) => ctx.atWar(u.owner));
  if (enemies.length === 0) {
    // Walk into the empty enemy city: the caller's capture rule applies.
    const r = tryMove(world, rules, ctx.rng, unit, bestTarget, ctx);
    if (r.kind === 'attack' || r.kind === 'moved') {
      events.push({ kind: 'ai-unit', text: `${type.name} advances on an empty city` });
      return true;
    }
    return false;
  }
  const ev = resolveAttack(world, rules, ctx.rng, unit, bestTarget, {
    civ: (slot) => (slot === ctx.civ.slot ? ctx.civ : undefined),
    wondersOf: ctx.wondersOf,
    cityCount: ctx.cityCount,
    difficulty: ctx.difficulty,
    realisticCombat: ctx.realisticCombat,
    barbarianActivity: 1,
    attackerMovesLeft: movesLeft(rules, unit, ctx),
  });
  if (ev.kind === 'fought') {
    events.push({
      kind: 'ai-unit',
      text: `${type.name} attacks ${rules.units[ev.defender.type]?.name ?? 'a unit'}: ${ev.attackerWon ? 'wins' : 'loses'}`,
    });
    return true;
  }
  return false;
}

/** Move every unit of a computer civilization once (INFERRED behaviour). */
export function aiMoveUnits(
  world: World,
  rules: EngineRules,
  slot: number,
  ctx: AiUnitContext,
): AiUnitEvent[] {
  const events: AiUnitEvent[] = [];
  for (const unit of [...world.units]) {
    if (unit.owner !== slot || !world.units.includes(unit)) continue;
    const type = rules.units[unit.type];
    if (!type) continue;
    if (unit.order !== null && unit.order >= ORDER.fortress && unit.order <= ORDER.airbase)
      continue; // working
    if (movesLeft(rules, unit, ctx) <= 0) continue;
    if (type.domain !== DOMAIN_GROUND) {
      if (unit.order === null) sentry(unit);
      continue;
    }
    const cityHere = world.cityAt(unit.position.x, unit.position.y);
    let guard = 0;
    while (movesLeft(rules, unit, ctx) > 0 && world.units.includes(unit) && guard++ < 12) {
      if (type.role === ROLE_SETTLE) {
        if (!settlersAct(world, rules, unit, ctx, events)) break;
      } else if (type.role === ROLE_TRADE) {
        if (!caravanAct(world, rules, unit, ctx, events)) break;
      } else if (type.role === ROLE_DEFEND) {
        if (tryAttack(world, rules, unit, ctx, events)) continue;
        if (cityHere && cityHere.owner === slot) {
          if (
            defendersIn(world, rules, cityHere) <= wanted(cityHere) ||
            world.unitsAt(cityHere.position.x, cityHere.position.y).length <= 1
          ) {
            fortify(unit);
            break;
          }
        }
        const needy = nearestCity(
          world,
          unit.position,
          (c) => c.owner === slot && defendersIn(world, rules, c) < wanted(c),
        );
        if (needy && !(cityHere === needy)) {
          if (!stepToward(world, rules, unit, needy.position, ctx)) {
            fortify(unit);
            break;
          }
          if (world.cityAt(unit.position.x, unit.position.y) === needy) {
            fortify(unit);
            break;
          }
        } else {
          fortify(unit);
          break;
        }
      } else {
        // Attackers and everything else on land.
        if (tryAttack(world, rules, unit, ctx, events)) continue;
        const target = nearestCity(
          world,
          unit.position,
          (c) =>
            ctx.atWar(c.owner) &&
            distance(world, unit.position, c.position) <= 10 &&
            world.landmass[world.index(c.position.x, c.position.y)] ===
              world.landmass[world.index(unit.position.x, unit.position.y)],
        );
        if (target) {
          if (!stepToward(world, rules, unit, target.position, ctx)) break;
          continue;
        }
        if (cityHere && cityHere.owner === slot) {
          fortify(unit);
          break;
        }
        const home = nearestCity(world, unit.position, (c) => c.owner === slot);
        if (home && !stepToward(world, rules, unit, home.position, ctx)) {
          fortify(unit);
          break;
        }
        if (!home) {
          sentry(unit);
          break;
        }
      }
    }
  }
  return events;
}

function settlersAct(
  world: World,
  rules: EngineRules,
  unit: Unit,
  ctx: AiUnitContext,
  events: AiUnitEvent[],
): boolean {
  const here = unit.position;
  const verdict = canFoundCity(world, rules, unit);
  const ownCities = world.cities.filter((c) => c.owner === unit.owner).length;
  // Found a city when the site is decent, or anywhere legal when the civilization has none.
  if (verdict.ok && verdict.joins === null && (ownCities === 0 || siteScore(world, here) >= 20)) {
    const city = foundCity(world, rules, ctx.civ, unit, { name: ctx.nextCityName() });
    events.push({ kind: 'ai-unit', text: `founds ${city.name}` });
    return false;
  }
  // Improve a worked square of a nearby own city.
  const near = nearestCity(
    world,
    here,
    (c) => c.owner === unit.owner && distance(world, here, c.position) <= 2,
  );
  if (near && !world.cityAt(here.x, here.y) && ownCities >= 2) {
    for (const order of [ORDER.irrigation, ORDER.mine, ORDER.road]) {
      if (order === ORDER.mine && world.terrainAt(here.x, here.y) !== 4) continue;
      if (canOrder(world, rules, unit, order, ctx).ok) {
        doWork(world, rules, unit, order, ctx);
        return false;
      }
    }
  }
  // Otherwise head for the best site within reach.
  let best: Point | null = null;
  let bestScore = ownCities === 0 ? 0 : 19;
  for (let dy = -8; dy <= 8; dy++) {
    for (let dx = -8; dx <= 8; dx++) {
      if (((here.x + dx + here.y + dy) & 1) !== 0) continue;
      const y = here.y + dy;
      if (y < 0 || y >= world.rows) continue;
      const x = world.wrapX(here.x + dx, y);
      if (x === null) continue;
      if (world.landmass[world.index(x, y)] !== world.landmass[world.index(here.x, here.y)])
        continue;
      const s = siteScore(world, { x, y }) - Math.trunc(distance(world, here, { x, y }) / 2);
      if (s > bestScore) {
        bestScore = s;
        best = { x, y };
      }
    }
  }
  if (best) return stepToward(world, rules, unit, best, ctx);
  sentry(unit);
  return false;
}

function caravanAct(
  world: World,
  rules: EngineRules,
  unit: Unit,
  ctx: AiUnitContext,
  events: AiUnitEvent[],
): boolean {
  const here = world.cityAt(unit.position.x, unit.position.y);
  if (
    here &&
    here.owner === unit.owner &&
    here.production.kind === 'improvement' &&
    here.production.index >= 39
  ) {
    const rows = rules.cosmic.shieldBoxRows;
    const gift = (rules.units[unit.type]?.costRows ?? 5) * rows;
    here.shieldsStored += gift;
    world.units.splice(world.units.indexOf(unit), 1);
    events.push({
      kind: 'ai-unit',
      text: `caravan adds ${gift} shields to the wonder in ${here.name}`,
    });
    return false;
  }
  const wonderCity = nearestCity(
    world,
    unit.position,
    (c) =>
      c.owner === unit.owner && c.production.kind === 'improvement' && c.production.index >= 39,
  );
  if (wonderCity) return stepToward(world, rules, unit, wonderCity.position, ctx);
  sentry(unit);
  return false;
}
