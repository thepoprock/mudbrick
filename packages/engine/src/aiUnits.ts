/**
 * Unit behaviour for computer players.
 *
 * The direction choice is a port of the original's move chooser (docs/engine/ai-units.md, "The
 * direction choice"); the terms it scores are VERIFIED there, and the stand-ins this engine
 * still needs (combat odds, treaties, continent plans) are marked INFERRED. The role special
 * cases — where a settler founds, how many defenders a city keeps, what caravans do — are
 * interim approximations until the objective and plan machinery is ported.
 */
import { resolveAttack } from './attack.js';
import { distance } from './city.js';
import { attackStrength, defenceStrength, hitPoints, maxHitPoints } from './combat.js';
import { chooseDefender } from './defender.js';
import { landValue } from './fertility.js';
import { canFoundCity, foundCity } from './founding.js';
import {
  checkMove,
  inEnemyZoc,
  movesLeft,
  THIRDS,
  tryMove,
  type MovementContext,
} from './movement.js';
import { fortify, sentry } from './orders.js';
import type { Rng } from './rng.js';
import { DOMAIN_AIR, DOMAIN_GROUND, IMPROVEMENT, type EngineRules } from './rules.js';
import { canOrder, doWork, ORDER } from './terraform.js';
import { hutAt } from './terrainSpecials.js';
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

export interface AiUnitContext extends MovementContext {
  rng: Rng;
  civ: Civ;
  difficulty: number;
  realisticCombat: boolean;
  turn: number;
  /** Is the acting civilization at war with `slot`? INFERRED stand-in for the treaty table. */
  atWar: (slot: number) => boolean;
  knows: (advance: number) => boolean;
  wondersOf: (slot: number) => boolean[];
  cityCount: (slot: number) => number;
  nextCityName: () => string;
  /** Bloodlust option: attack odds double against a defender at a third of its hit points or less. */
  bloodlust?: boolean;
  /** Scenario flag: computer units do not explore. */
  noExploration?: boolean;
}

export interface AiUnitEvent {
  kind: 'ai-unit';
  text: string;
}

const ROLE_ATTACK = 0;
const ROLE_DEFEND = 1;
const ROLE_NAVAL = 2;
const ROLE_TRANSPORT = 4;
const ROLE_SETTLE = 5;
const ROLE_DIPLOMAT = 6;
const ROLE_TRADE = 7;
const ROLE_TRANSFORM = 21;
const FLOOR = -999;

export interface Candidate {
  dir: number;
  to: Point;
  score: number;
  attack: boolean;
}

function neighbour(world: World, p: Point, dir: number): Point | null {
  const off = NEIGHBOUR_OFFSETS[dir];
  if (!off) return null;
  const y = p.y + off.y;
  if (y < 0 || y >= world.rows) return null;
  const x = world.wrapX(p.x + off.x, y);
  return x === null ? null : { x, y };
}

function neighboursOf(world: World, p: Point): Point[] {
  const out: Point[] = [];
  for (let d = 0; d < 8; d++) {
    const n = neighbour(world, p, d);
    if (n) out.push(n);
  }
  return out;
}

/**
 * A unit of another civilization stands next to `p` (0x0055629a; with `sameDomainAs` only
 * squares of the same kind count, as in 0x00556397). Alliances are not modelled.
 */
function foreignUnitAdjacent(world: World, p: Point, me: number, sameDomainAs?: Point): boolean {
  const wantOcean = sameDomainAs ? world.terrainAt(sameDomainAs.x, sameDomainAs.y) === OCEAN : null;
  for (const n of neighboursOf(world, p)) {
    if (wantOcean !== null && (world.terrainAt(n.x, n.y) === OCEAN) !== wantOcean) continue;
    if (world.unitsAt(n.x, n.y).some((u) => u.owner !== me)) return true;
  }
  return false;
}

function countRole(rules: EngineRules, units: Unit[], role: number): number {
  return units.filter((u) => rules.units[u.type]?.role === role).length;
}

function sumCost(rules: EngineRules, units: Unit[]): number {
  return units.reduce((s, u) => s + (rules.units[u.type]?.costRows ?? 0), 0);
}

function sumAttack(rules: EngineRules, units: Unit[]): number {
  return units.reduce((s, u) => s + (rules.units[u.type]?.attack ?? 0), 0);
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

/**
 * Score the eight neighbours of a unit's square and return the best step, or null to stay.
 * Port of the original's direction choice; docs/engine/ai-units.md lists every term.
 */
export function chooseDirection(
  world: World,
  rules: EngineRules,
  unit: Unit,
  ctx: AiUnitContext,
): Candidate | null {
  const type = rules.units[unit.type];
  if (!type) return null;
  const me = unit.owner;
  const here = unit.position;
  const role = type.role;
  const hereOcean = world.terrainAt(here.x, here.y) === OCEAN;
  const nearestAny = nearestCity(world, here, () => true);
  const nearestAnyDist = nearestAny ? distance(world, here, nearestAny.position) : 99;
  const nearestOwn = nearestCity(world, here, (c) => c.owner === me);
  const nearestIsForeign = nearestAny !== null && nearestAny !== nearestOwn;
  // VERIFIED: exploration terms apply outside foreign zones of control (and, in the original,
  // when the unit has no objective — objectives are not modelled yet).
  const exploring = !ctx.noExploration && !hereOcean && !foreignUnitAdjacent(world, here, me, here);
  const roadMult = rules.cosmic.roadMoveMultiplier;
  const left = movesLeft(rules, unit, ctx);
  const ownStack = world.unitsAt(here.x, here.y).filter((u) => u.owner === me);

  let best: Candidate | null = null;
  let bestRaw = FLOOR;
  let bestScaled = FLOOR;
  let bestBonus = 0;

  for (let dir = 0; dir < 8; dir++) {
    const to = neighbour(world, here, dir);
    if (!to) continue;
    const terrain = world.terrainAt(to.x, to.y);
    const tr = rules.terrain[terrain];
    if (!tr) continue;
    const ocean = terrain === OCEAN;
    // INFERRED: computer ground units never board ships through this path.
    if (type.domain === DOMAIN_GROUND && ocean) continue;
    if (type.domain !== DOMAIN_GROUND && !ocean && !world.cityAt(to.x, to.y)) continue;
    const occupants = world.unitsAt(to.x, to.y);
    const city = world.cityAt(to.x, to.y);
    const occupantOwner = occupants[0]?.owner ?? city?.owner ?? null;
    const ownThere = occupants.length > 0 && occupantOwner === me;
    const foreignUnits = occupants.length > 0 && occupantOwner !== me;

    // 1. Base.
    let score = type.domain === DOMAIN_AIR ? ctx.rng.nextInt(3) : ctx.rng.nextInt(5);

    if (type.domain !== DOMAIN_AIR) {
      if (!ownThere) {
        // 2. Terrain.
        if (role < ROLE_DIPLOMAT) score += tr.defenceHalves * 4;
        else {
          score += 6 - (tr.moveCost - 1) * roadMult;
          if (nearestAny && nearestAnyDist < 4 && nearestIsForeign) {
            const d = distance(world, to, nearestAny.position);
            if (d === 1) score += tr.moveCost > roadMult ? -4 : 8;
            else if (
              d === 2 &&
              tr.moveCost <= roadMult &&
              world.hasFlag(to.x, to.y, SquareFlag.Road)
            )
              score += 4;
          }
        }
      } else if (
        !city &&
        !world.hasFlag(to.x, to.y, SquareFlag.Fortress) &&
        foreignUnitAdjacent(world, to, me)
      ) {
        // 3. Stacking in a foreign zone of control.
        const att = countRole(rules, occupants, ROLE_ATTACK);
        const def = countRole(rules, occupants, ROLE_DEFEND);
        switch (role) {
          case ROLE_ATTACK:
            score += att < 1 && def > 0 ? 8 : -8 * att;
            break;
          case ROLE_DEFEND:
            score += def < 1 ? 8 : -4 * def;
            break;
          case ROLE_NAVAL:
            if (countRole(rules, occupants, ROLE_TRANSPORT) > 0) score += 8;
            score -= 4 * countRole(rules, occupants, ROLE_NAVAL);
            break;
          case ROLE_TRANSPORT:
            if (countRole(rules, occupants, ROLE_NAVAL) > 0) score += 8;
            score -= 8 * countRole(rules, occupants, ROLE_TRANSPORT);
            break;
          case ROLE_SETTLE:
          case ROLE_TRANSFORM:
            score -= 4;
            break;
          case ROLE_DIPLOMAT:
            if (att + def > 0) score += 8;
            break;
          default:
            break;
        }
      } else {
        // 3. Stacking elsewhere (stack totals: cost sum, attack sum, count).
        const cost = sumCost(rules, occupants);
        switch (role) {
          case ROLE_ATTACK:
            score += Math.trunc((cost * 4) / (occupants.length + 1));
            break;
          case ROLE_DEFEND:
            score += Math.trunc((sumAttack(rules, occupants) * 2) / (cost + 1));
            break;
          case ROLE_SETTLE:
            score += (tr.defenceHalves + cost) * 2;
            break;
          case ROLE_DIPLOMAT:
            if (
              countRole(rules, occupants, ROLE_ATTACK) + countRole(rules, occupants, ROLE_DEFEND) >
              0
            )
              score += 8;
            break;
          default:
            break;
        }
      }
    }

    // 4. Turning penalty.
    if (unit.lastDirection !== null) {
      let turn = Math.abs(unit.lastDirection - dir);
      if (turn > 4) turn = 8 - turn;
      score -= turn * turn * 2;
    }

    let attack = false;
    let bonus = 0; // the original's "ac": thirds of movement an attack may forgo
    if (occupants.length === 0) {
      // 5. Treaties around an empty square.
      if (!ocean && role < ROLE_SETTLE) {
        let movingAway = false;
        if (nearestAny && nearestAnyDist < 4 && nearestIsForeign && !ctx.atWar(nearestAny.owner)) {
          const d = distance(world, to, nearestAny.position);
          if (nearestAnyDist < d && nearestAnyDist < 3) {
            score += 5;
            movingAway = true;
          }
          if (d < nearestAnyDist) continue;
          if (d === nearestAnyDist) score -= 5;
        }
        const owner = world.territory[world.index(to.x, to.y)] ?? 0;
        if (owner > 0 && owner !== me && !ctx.atWar(owner) && !movingAway) {
          // INFERRED: the original rejects the square under a fresh peace and otherwise
          // penalises it when attitude is low; without attitudes the penalty always applies.
          score -= 5;
          if (
            world.hasFlag(to.x, to.y, SquareFlag.Irrigation) ||
            world.hasFlag(to.x, to.y, SquareFlag.Mine) ||
            world.hasFlag(to.x, to.y, SquareFlag.Road)
          )
            score -= 3;
        }
      }
      if (city && city.owner !== me) {
        if (!ctx.atWar(city.owner)) continue;
        score = 999; // an undefended enemy city is taken
      }
      if (!city && !ocean && hutAt(world, to.x, to.y)) score += 20;
    } else if (foreignUnits && occupantOwner !== null) {
      // 7. Attacking.
      if (role === ROLE_SETTLE || role === ROLE_TRADE) continue;
      if (hereOcean && type.domain === DOMAIN_GROUND) continue; // INFERRED: no amphibious flag yet
      if (!ctx.atWar(occupantOwner)) continue; // at peace or cease-fire a unit never attacks
      if (type.attack === 0) continue;
      const defender = chooseDefender(world, rules, occupants, unit, {
        defenderFortified: occupants.some((u) => u.fortified),
        ...(city ? { defenderCity: city.improvements } : {}),
      });
      if (!defender) continue;
      const dType = rules.units[defender.type];
      if (!dType) continue;
      const airbase = world.hasFlag(to.x, to.y, SquareFlag.Airbase);
      if (
        dType.domain === DOMAIN_AIR &&
        dType.range !== 0 &&
        !type.flags.canAttackAir &&
        !city &&
        !airbase
      )
        continue;
      const a = attackStrength(rules, unit, left).value;
      const d = defenceStrength(world, rules, defender, unit, {
        defenderFortified: defender.fortified,
        ...(city ? { defenderCity: city.improvements } : {}),
        attackerWonders: ctx.wondersOf(me),
        defenderWonders: ctx.wondersOf(occupantOwner),
      }).value;
      // INFERRED stand-in for the original's combat evaluator (0x0052d472): eight times the
      // strength ratio, so even odds score 8 and the threshold of 6 admits slightly worse.
      let odds = d === 0 ? 99 : Math.trunc((8 * a) / d);
      odds = Math.trunc(((sumCost(rules, occupants) + 1) * odds) / Math.max(1, type.costRows));
      if (city) odds *= 3;
      if (role === ROLE_NAVAL && dType.role === ROLE_TRANSPORT) odds *= 2;
      if (role === ROLE_ATTACK) {
        if (type.attack * 2 < sumAttack(rules, ownStack)) {
          odds *= 2;
          bonus = 1;
        }
        if (countRole(rules, occupants, ROLE_ATTACK) > 0) {
          odds *= 2;
          bonus = 1;
        }
      }
      if (ctx.bloodlust && hitPoints(rules, defender) * 3 <= maxHitPoints(rules, defender.type)) {
        odds *= 2;
        bonus = 1;
      }
      if (occupantOwner === 0 && dType.role > ROLE_TRANSPORT) bonus = 2;
      if (occupantOwner === 0) {
        if (dType.role === ROLE_TRADE) odds = Math.trunc(odds / 2);
        else if (dType.role > ROLE_TRANSPORT) odds += 12;
      } else if (dType.role === ROLE_DIPLOMAT) odds *= 2;
      const threshold = occupantOwner === 0 ? 12 : 6;
      if (odds < threshold) continue;
      score += odds * 4;
      attack = true;
    }

    // 6. Exploration.
    if (exploring && !ownThere && !foreignUnits) {
      const off = NEIGHBOUR_OFFSETS[dir];
      if (off) {
        const fy = here.y + off.y * 4;
        const fx = fy >= 0 && fy < world.rows ? world.wrapX(here.x + off.x * 4, fy) : null;
        if (fx !== null) {
          if (!world.isSeen(fx, fy, me)) score += world.terrainAt(fx, fy) === OCEAN ? 2 : 8;
          for (const n of neighboursOf(world, { x: fx, y: fy })) {
            const nOcean = world.terrainAt(n.x, n.y) === OCEAN;
            if (!world.isSeen(n.x, n.y, me) && (!nOcean || type.domain !== DOMAIN_GROUND))
              score += 2;
            if (world.unitsAt(n.x, n.y).length > 0) score -= 2;
            if (role === ROLE_SETTLE) score += rules.terrain[world.terrainAt(n.x, n.y)]?.food ?? 0;
          }
        }
      }
    }
    if (to.y === 0 || to.y === world.rows - 1) score = Math.trunc(score / 3);

    // 8. Fatigue: a tired attacker's score shrinks unless the target is a city.
    const raw = score;
    let scaled = score;
    if (attack && left < THIRDS && !city) {
      const attackTotal = Math.min(99, Math.max(1, sumAttack(rules, ownStack)));
      scaled = Math.trunc(sumCost(rules, ownStack) / attackTotal) * score;
    }
    if (scaled > bestScaled) {
      bestScaled = scaled;
      best = { dir, to, score: scaled, attack };
      bestBonus = bonus;
    }
    if (raw > bestRaw) bestRaw = raw;
  }

  if (!best || bestScaled <= FLOOR) return null;
  if (best.attack && left < THIRDS - bestBonus) return null; // wait for a fuller move
  if (bestRaw !== bestScaled) return null; // the best option is an attack worth waiting for
  return best;
}

function defendersIn(world: World, rules: EngineRules, c: City): number {
  return world
    .unitsAt(c.position.x, c.position.y)
    .filter((u) => u.owner === c.owner && rules.units[u.type]?.role === ROLE_DEFEND).length;
}

/**
 * Defenders a city wants (VERIFIED): `size / d + 1` where d is 3 in a foreign zone of control
 * else 4, +1 under plan 5 without a Palace (plan 5 INFERRED until plans exist), −1 with one;
 * a capital wants at least 1, 2 above size 3, 3 with eight cities, 4 with twelve.
 */
export function wantedDefenders(world: World, c: City, ownCities: number): number {
  let divisor = foreignUnitAdjacent(world, c.position, c.owner, c.position) ? 3 : 4;
  const palace = c.improvements[IMPROVEMENT.palace] === true;
  divisor += palace ? -1 : 1;
  let wanted = Math.trunc(c.size / divisor) + 1;
  if (palace) {
    let min = 1;
    if (c.size > 3) min = 2;
    if (ownCities > 7) min = 3;
    if (ownCities > 11) min = 4;
    wanted = Math.max(wanted, min);
  }
  return wanted;
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
  let bestDir = -1;
  let bestD = distance(world, unit.position, target);
  for (let dir = 0; dir < 8; dir++) {
    const n = neighbour(world, unit.position, dir);
    if (!n) continue;
    const v = checkMove(world, rules, unit, n, ctx);
    if (!v.ok || v.boards) continue;
    if (world.unitsAt(n.x, n.y).some((u) => u.owner !== unit.owner)) continue;
    const d = distance(world, n, target);
    if (d < bestD) {
      bestD = d;
      best = n;
      bestDir = dir;
    }
  }
  if (!best) return false;
  const r = tryMove(world, rules, ctx.rng, unit, best, ctx);
  if (r.kind === 'moved') unit.lastDirection = bestDir;
  return r.kind === 'moved';
}

/** Carry out the chosen step or attack. Returns false when the unit should stop for this turn. */
function act(
  world: World,
  rules: EngineRules,
  unit: Unit,
  c: Candidate,
  ctx: AiUnitContext,
  events: AiUnitEvent[],
): boolean {
  const type = rules.units[unit.type];
  if (!type) return false;
  if (c.attack) {
    const ev = resolveAttack(world, rules, ctx.rng, unit, c.to, {
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
  const r = tryMove(world, rules, ctx.rng, unit, c.to, ctx);
  if (r.kind === 'moved') {
    unit.lastDirection = c.dir;
    return true;
  }
  return false;
}

/** Move every unit of a computer civilization once. */
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
      // INFERRED: ships and aircraft hold until their own choosers are read.
      if (unit.order === null) sentry(unit);
      continue;
    }
    let guard = 0;
    while (movesLeft(rules, unit, ctx) > 0 && world.units.includes(unit) && guard++ < 12) {
      const cityHere = world.cityAt(unit.position.x, unit.position.y);
      if (type.role === ROLE_SETTLE || type.role === ROLE_TRANSFORM) {
        if (!settlersAct(world, rules, unit, ctx, events)) break;
        continue;
      }
      if (type.role === ROLE_TRADE) {
        if (!caravanAct(world, rules, unit, ctx, events)) break;
        continue;
      }
      if (type.role === ROLE_DEFEND) {
        const ownCities = ctx.cityCount(slot);
        if (cityHere && cityHere.owner === slot) {
          // VERIFIED quota; the best defender stays (chooseDefender), the rest may leave.
          const defenders = world
            .unitsAt(cityHere.position.x, cityHere.position.y)
            .filter((u) => u.owner === slot && rules.units[u.type]?.role === ROLE_DEFEND);
          const wanted = wantedDefenders(world, cityHere, ownCities);
          const keep = chooseDefender(world, rules, defenders, null, {
            defenderFortified: false,
            defenderCity: cityHere.improvements,
          });
          if (defenders.length <= wanted || keep === unit) {
            fortify(unit);
            break;
          }
        }
        // INFERRED stand-in for "defend" objectives: walk to the nearest own city short of defenders.
        const needy = nearestCity(
          world,
          unit.position,
          (c) =>
            c.owner === slot &&
            c !== cityHere &&
            defendersIn(world, rules, c) < wantedDefenders(world, c, ownCities),
        );
        if (needy) {
          if (!stepToward(world, rules, unit, needy.position, ctx)) {
            fortify(unit);
            break;
          }
          continue;
        }
        if (cityHere && cityHere.owner === slot) {
          fortify(unit);
          break;
        }
      }
      const c = chooseDirection(world, rules, unit, ctx);
      if (!c) {
        // VERIFIED: a unit that stays fortifies.
        unit.lastDirection = null;
        fortify(unit);
        break;
      }
      if (!act(world, rules, unit, c, ctx, events)) break;
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
  const me = unit.owner;
  const landmass = world.landmass[world.index(here.x, here.y)];
  const nearestAny = nearestCity(world, here, () => true);
  const nearestDist = nearestAny ? distance(world, here, nearestAny.position) : 99;
  const ownCitiesHere = world.cities.some(
    (c) => c.owner === me && world.landmass[world.index(c.position.x, c.position.y)] === landmass,
  );
  // VERIFIED site rule (docs/engine/ai-units.md, "Settlers"): the land value here, capped at 8
  // within three squares of a city on the same land mass, against the best of the 20 squares
  // around; found when the best is here and far enough from the nearest city, or when the land
  // mass has no own city yet, or after waiting more than four turns (unit byte 14).
  let best = world.terrainAt(here.x, here.y) === OCEAN ? 0 : landValue(world, here.x, here.y);
  if (
    nearestAny &&
    nearestDist < 4 &&
    best > 7 &&
    world.landmass[world.index(nearestAny.position.x, nearestAny.position.y)] === landmass
  )
    best = 8;
  if (best !== 0) {
    let bestIndex = -1;
    for (let i = 0; i < 20; i++) {
      const q = world.radiusSquare(here.x, here.y, i);
      if (!q || world.terrainAt(q.x, q.y) === OCEAN) continue;
      if (world.landmass[world.index(q.x, q.y)] !== landmass) continue;
      const v = landValue(world, q.x, q.y);
      if (v > best) {
        best = v;
        bestIndex = i;
      }
    }
    if (best > 7 && !inEnemyZoc(world, here.x, here.y, me)) {
      const ready =
        best >= 15 - nearestDist ||
        (bestIndex < 0 && !ownCitiesHere) ||
        (bestIndex < 0 && ++unit.gotoSteps > 4);
      if (ready) {
        if (bestIndex < 0) {
          const verdict = canFoundCity(world, rules, unit);
          if (verdict.ok && verdict.joins === null) {
            const city = foundCity(world, rules, ctx.civ, unit, { name: ctx.nextCityName() });
            events.push({ kind: 'ai-unit', text: `founds ${city.name}` });
            return false;
          }
        } else {
          const target = world.radiusSquare(here.x, here.y, bestIndex);
          if (target) return stepToward(world, rules, unit, target, ctx);
        }
      }
    }
  }
  // INFERRED interim duties: improve squares near own cities, else explore.
  const ownCities = ctx.cityCount(me);
  const near = nearestCity(
    world,
    here,
    (c) => c.owner === me && distance(world, here, c.position) <= 2,
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
  const c = chooseDirection(world, rules, unit, ctx);
  if (!c || c.attack) {
    sentry(unit);
    return false;
  }
  return act(world, rules, unit, c, ctx, events);
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
