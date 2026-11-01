/**
 * Unit behaviour for computer players.
 *
 * The direction choice is a port of the original's move chooser (docs/engine/ai-units.md, "The
 * direction choice"); the terms it scores are VERIFIED there, and the stand-ins this engine
 * still needs (combat odds, treaties, continent plans) are marked INFERRED. The role special
 * cases — where a settler founds, how many defenders a city keeps, what caravans do — are
 * interim approximations until the objective and plan machinery is ported.
 */
import { addGoal, addObjective, removeGoals, type CivStrategy } from './aiStrategy.js';
import { resolveAttack } from './attack.js';
import { captureCity } from './conquest.js';
import { distance, gridDistance } from './city.js';
import { combatOdds, hitPoints, maxHitPoints } from './combat.js';
import { chooseDefender } from './defender.js';
import { attitude, hasTreaty, TREATY } from './diplomacy.js';
import { landValue } from './fertility.js';
import { canFoundCity, foundCity } from './founding.js';
import {
  applyMove,
  checkMove,
  inEnemyZoc,
  movesLeft,
  THIRDS,
  tryMove,
  type MovementContext,
} from './movement.js';
import { fortify, sentry } from './orders.js';
import type { Rng } from './rng.js';
import { DOMAIN_AIR, DOMAIN_GROUND, IMPROVEMENT, type EngineRules, DOMAIN_SEA } from './rules.js';
import { ORDER } from './terraform.js';
import { workerRules } from './aiTerraform.js';
import { nuclearFollowUp } from './nuclear.js';
import { applyShipDecision, transportDecision } from './aiShips.js';
import { airDecision, applyAirDecision } from './aiAir.js';
import {
  aiEspionageChoice,
  bribeUnit,
  performEspionage,
  type EspionageContext,
} from './espionage.js';
import { hutAt } from './terrainSpecials.js';
import {
  aiCaravanDestination,
  establishTradeRoute,
  helpWonder,
  type TradeContext,
  type TradeEvent,
} from './trade.js';
import { gotoDirection } from './pathfinding.js';
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

export interface AiUnitContext extends MovementContext {
  rng: Rng;
  civ: Civ;
  difficulty: number;
  realisticCombat: boolean;
  turn: number;
  /** Is the acting civilization at war with `slot` (0x0044e123)? */
  atWar: (slot: number) => boolean;
  /** May it attack `slot`'s units: no cease-fire or peace (defaults to `atWar`). */
  canAttack?: (slot: number) => boolean;
  /** A cease-fire or peace partner that is not an ally (defaults to never). */
  atPeace?: (slot: number) => boolean;
  knows: (advance: number) => boolean;
  wondersOf: (slot: number) => boolean[];
  cityCount: (slot: number) => number;
  nextCityName: () => string;
  /** Scenario flag: computer units do not explore. */
  noExploration?: boolean;
  /** Has anyone discovered Guerilla Warfare (partisans on capture)? */
  guerillaWarfareDiscovered?: boolean;
  /** The civilization's strategic state, for settle goals (aiStrategy.ts). */
  strategy?: CivStrategy;
  /** Trade-route context for caravans; without it caravans only help wonders. */
  trade?: TradeContext;
  /** Attitude toward a slot, for caravan destinations. */
  attitude?: (slot: number) => number;
  /** Power rank, 7 for the strongest (0x005da842). */
  rankOf?: (slot: number) => number;
  /** The space race worries this civilization (0x0053ff14). */
  raceWorry?: boolean;
  /** Allied with a slot (transports ferrying to friends). */
  isAlly?: (slot: number) => boolean;
  /** Espionage context for diplomats and spies (espionage.ts); without it they only guard. */
  espionage?: EspionageContext;
  /** Human-controlled slot (the cargo rule differs); the game passes it. */
  isHuman?: (slot: number) => boolean;
  /** The civilization's continent plan for a land mass (cargo on a "defend" land mass stays home). */
  planOf?: (slot: number, landmass: number) => number;
  /** The civilization ranked first (0x005da851). */
  leader?: number;
  /** Scenario event hooks (UNITKILLED, CITYTAKEN). */
  onUnitKilled?: (type: number, attacker: number, defender: number) => void;
  onCityTaken?: (city: string, attacker: number, defender: number) => void;
  /** A human's turn: only the units on automatic move (order `k`, unit flag 0x8000). */
  automatedOnly?: boolean;
  /** Run the consequences of an advance just granted (Game.advanceGained). */
  advanceGained?: (civ: Civ, advance: number) => void;
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
const SPY = 47;
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

function landOf(world: World, p: Point): number {
  return (world.landmass[world.index(p.x, p.y)] ?? 0) & 63;
}

function buyUnit(
  world: World,
  rules: EngineRules,
  me: number,
  target: Unit,
  ctx: AiUnitContext,
): void {
  if (ctx.espionage) bribeUnit(world, rules, me, target, ctx.espionage);
}

/**
 * Does a computer unit buy a lone foreign unit it may not attack (0x004f44cc)? A treaty partner's
 * Diplomat beside one of our cities is left to the other test. Above Prince, an agent, or a unit
 * whose nearest city is its own, on a land mass with no human city, buys one time in eight,
 * or always when a human's city is the nearest.
 */
function bribeAtPeace(
  world: World,
  rules: EngineRules,
  unit: Unit,
  target: Unit,
  nearestAny: City | null,
  nearestOwn: City | null,
  ctx: AiUnitContext,
): boolean {
  const me = unit.owner;
  const them = target.owner;
  const type = rules.units[unit.type];
  if (type?.domain !== DOMAIN_GROUND || ctx.difficulty <= 2) return false;
  const role = type.role;
  const lm = landOf(world, unit.position);
  const plan = ctx.planOf?.(me, lm) ?? -1;
  const treaty = hasTreaty(world, me, them, TREATY.ceaseFire | TREATY.peace);
  if (
    treaty &&
    rules.units[target.type]?.role === ROLE_DIPLOMAT &&
    type.attack !== 0 &&
    nearestAny?.owner === me
  )
    return false;
  if (role === ROLE_DIPLOMAT) {
    if (plan !== 0 && plan !== 5 && treaty) return false;
  } else {
    if (plan !== 0 || role !== ROLE_ATTACK) return false;
    if (nearestAny !== nearestOwn) return false;
  }
  const human = (slot: number) => world.civs.find((c) => c.slot === slot)?.isHuman === true;
  // 0x0044e123: at war, or in contact with neither peace nor alliance and an attitude above 49.
  const hostile = (a: number, b: number) =>
    hasTreaty(world, a, b, TREATY.war) ||
    (!hasTreaty(world, a, b, TREATY.alliance) &&
      hasTreaty(world, a, b, TREATY.contact) &&
      !hasTreaty(world, a, b, TREATY.peace) &&
      attitude(world, a, b) > 49);
  const humans = world.civs.filter((c) => c.isHuman && c.slot !== 0);
  let free = !human(them) && humans.some((h) => !hostile(them, h.slot));
  if (!free)
    free = !humans.some((h) =>
      world.cities.some((c) => c.owner === h.slot && landOf(world, c.position) === lm),
    );
  if (!free) return false;
  return ctx.rng.nextInt(8) === 0 || (nearestAny !== null && human(nearestAny.owner));
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
  const exploring =
    !ctx.noExploration &&
    !hereOcean &&
    unit.order !== ORDER.goTo &&
    !foreignUnitAdjacent(world, here, me, here);
  const roadMult = rules.cosmic.roadMoveMultiplier;
  const left = movesLeft(rules, unit, ctx);
  const ownStack = world.unitsAt(here.x, here.y).filter((u) => u.owner === me);
  const canAttack = ctx.canAttack ?? ctx.atWar;
  const hereZoc = inEnemyZoc(world, here.x, here.y, me);

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
    // VERIFIED (the handler's candidate gate, 0x005564c0 on both squares): a ground unit in a
    // foreign zone of control does not consider another square in one unless it ignores zones
    // of control or a unit of the first five roles already stands there. Without this the
    // chooser keeps picking a square the move rules then refuse, and the unit never moves.
    if (
      hereZoc &&
      type.domain === DOMAIN_GROUND &&
      !type.flags.ignoreZonesOfControl &&
      !occupants.some((u) => (rules.units[u.type]?.role ?? 9) <= 4) &&
      inEnemyZoc(world, to.x, to.y, me)
    )
      continue;
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
    // VERIFIED 0x004f44cc: an ally's square is worth less.
    if (occupantOwner !== null && occupantOwner !== me) {
      if (hasTreaty(world, me, occupantOwner, TREATY.alliance)) score -= 6;
    }
    if (occupants.length === 0) {
      // 5. Treaties around an empty square.
      if (!ocean && role < ROLE_SETTLE) {
        const pact = (o: number) =>
          hasTreaty(world, me, o, TREATY.ceaseFire | TREATY.peace) &&
          !hasTreaty(world, me, o, TREATY.alliance);
        const mood = (o: number) => ctx.attitude?.(o) ?? 50;
        let movingAway = false;
        const nearOwner = nearestAny?.owner ?? me;
        if (
          nearestAny &&
          nearestAnyDist < 4 &&
          nearOwner !== me &&
          pact(nearOwner) &&
          (hasTreaty(world, me, nearOwner, TREATY.peace) || mood(nearOwner) < 50)
        ) {
          const d = distance(world, to, nearestAny.position);
          if (nearestAnyDist < d && nearestAnyDist < 3) {
            score += 5;
            movingAway = true;
          }
          if (d < nearestAnyDist) continue;
          if (d === nearestAnyDist) score -= 5;
        }
        const owner = world.territory[world.index(to.x, to.y)] ?? 0;
        if (owner > 0 && owner !== me && pact(owner)) {
          // VERIFIED 0x004f44cc: a peace the other side's reputation still honours closes its
          // land, unless the unit is already leaving a city's neighbourhood.
          const rep = world.civs.find((c) => c.slot === owner)?.reputation ?? 0;
          const fresh =
            hasTreaty(world, me, owner, TREATY.peace) && rep - (ctx.civ.pardons?.[me] ?? 0) < 7;
          if (fresh && !movingAway) continue;
          if (fresh || mood(owner) < 50) {
            score -= 5;
            if (
              world.hasFlag(to.x, to.y, SquareFlag.Irrigation) ||
              world.hasFlag(to.x, to.y, SquareFlag.Mine) ||
              world.hasFlag(to.x, to.y, SquareFlag.Road)
            )
              score -= 3;
          }
        }
      }
      if (city && city.owner !== me) {
        if (!canAttack(city.owner)) continue;
        score = 999; // an undefended enemy city is taken
      }
      if (!city && !ocean && hutAt(world, to.x, to.y)) score += 20;
    } else if (foreignUnits && occupantOwner !== null) {
      // 7. Attacking.
      if (role === ROLE_SETTLE || role === ROLE_TRADE) continue;
      // VERIFIED (ai-units.md): a ground unit at sea attacks only with the amphibious flag.
      if (hereOcean && type.domain === DOMAIN_GROUND && !type.flags.amphibiousAssault) continue;
      if (!canAttack(occupantOwner)) {
        // At peace or cease-fire a unit never attacks; it may buy the unit instead.
        const lone = occupants.length === 1 ? occupants[0] : undefined;
        if (lone && !city && bribeAtPeace(world, rules, unit, lone, nearestAny, nearestOwn, ctx))
          buyUnit(world, rules, me, lone, ctx);
        continue;
      }
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
      // VERIFIED: the original's combat evaluator (combat.ts combatOdds).
      let odds = combatOdds(world, rules, unit, defender, {
        defenderFortified: defender.fortified,
        ...(city ? { defenderCity: city.improvements } : {}),
        attackerWonders: ctx.wondersOf(me),
        defenderWonders: ctx.wondersOf(occupantOwner),
        realisticCombat: ctx.realisticCombat,
        difficulty: ctx.difficulty,
        defenderIsHuman: false,
        defenderCityCount: ctx.cityCount(occupantOwner),
      });
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
      // VERIFIED: with simplified combat off (hit points matter) a defender at a third of its
      // hit points or less doubles the odds.
      if (
        ctx.realisticCombat &&
        hitPoints(rules, defender) * 3 <= maxHitPoints(rules, defender.type)
      ) {
        odds *= 2;
        bonus = 1;
      }
      if (occupantOwner === 0 && dType.role > ROLE_TRANSPORT) bonus = 2;
      if (occupantOwner === 0) {
        if (dType.role === ROLE_TRADE) odds = Math.trunc(odds / 2);
        else if (dType.role > ROLE_TRANSPORT) odds += 12;
      } else if (dType.role === ROLE_DIPLOMAT) odds *= 2;
      const threshold = occupantOwner === 0 ? 12 : 6;
      if (odds < threshold) {
        // A dug-in lone unit too strong to attack is bought one time in four (0x004f44cc).
        if (
          !city &&
          role === ROLE_ATTACK &&
          type.domain === DOMAIN_GROUND &&
          ctx.planOf?.(me, landOf(world, unit.position)) === 0 &&
          (defender.veteran || defender.fortified) &&
          occupants.length === 1 &&
          ((rules.terrain[world.terrainAt(to.x, to.y)]?.defenceHalves ?? 0) > 3 ||
            (world.hasFlag(to.x, to.y, SquareFlag.Fortress) &&
              !world.hasFlag(to.x, to.y, SquareFlag.Airbase))) &&
          ctx.rng.nextInt(4) === 0
        )
          buyUnit(world, rules, me, defender, ctx);
        continue;
      }
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

/**
 * Defenders a city wants (VERIFIED): `size / d + 1` where d is 3 in a foreign zone of control
 * else 4, +1 under plan 5 without a Palace, −1 with one; a capital wants at least 1, 2 above size
 * 3, 3 with eight cities, 4 with twelve.
 */
export function wantedDefenders(world: World, c: City, ownCities: number, plan: number): number {
  let divisor = foreignUnitAdjacent(world, c.position, c.owner, c.position) ? 3 : 4;
  const palace = c.improvements[IMPROVEMENT.palace] === true;
  if (palace) divisor -= 1;
  else if (plan === 5) divisor += 1;
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

/**
 * Does a defender leave its post (0x004f44cc)? In a city the best defender stays, as does anyone
 * while the garrison is at or under what the city wants, and a short garrison asks for more with
 * a type 1 objective. A surplus unit that would be the best when fortified and is needed by the
 * homed count stays too; other surplus units are released one turn in eight. Alone on open ground
 * at home it holds the square.
 */
function defenderMoves(
  world: World,
  rules: EngineRules,
  unit: Unit,
  cityHere: City | null | undefined,
  ctx: AiUnitContext,
): boolean {
  const me = unit.owner;
  const here = unit.position;
  const s = ctx.strategy;
  if (cityHere && cityHere.owner === me) {
    const defenders = world
      .unitsAt(here.x, here.y)
      .filter((u) => u.owner === me && rules.units[u.type]?.role === ROLE_DEFEND);
    if (defenders.length < 2) return false;
    const plan = ctx.planOf?.(me, landOf(world, here)) ?? 5;
    const wanted = wantedDefenders(world, cityHere, ctx.cityCount(me), plan);
    const best = (fortifiedUnit: Unit | null) =>
      chooseDefender(world, rules, defenders, null, {
        defenderFortified: fortifiedUnit !== null,
        defenderCity: cityHere.improvements,
      });
    if (best(null) === unit) return false;
    if (defenders.length < wanted && s)
      addObjective(s, { x: here.x, y: here.y, type: 1, priority: 3 });
    if (wanted >= defenders.length) return false;
    const homed = defenders.filter((u) => u.homeCity === cityHere.id).length;
    if (best(unit) === unit && homed <= wanted) return false;
    if (((ctx.turn + world.units.indexOf(unit)) & 7) === 0) {
      unit.order = null;
      unit.fortified = false;
      return true;
    }
    return !unit.fortified;
  }
  if (world.unitsAt(here.x, here.y).length >= 2) return true;
  const owner = world.territory[world.index(here.x, here.y)] ?? 0;
  if (owner >= 1 && owner !== me) return true;
  if (s) addObjective(s, { x: here.x, y: here.y, type: 1, priority: 5 });
  return false;
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
  // The go-to pathfinder first (the original orders a go-to for the outer squares), so a bay or
  // a mountain between the unit and its square is walked around.
  const planned = gotoDirection(world, rules, unit, target);
  if (planned !== null) {
    const n = neighbour(world, unit.position, planned);
    if (n) {
      const v = checkMove(world, rules, unit, n, ctx);
      if (v.ok && !v.boards && !world.unitsAt(n.x, n.y).some((u) => u.owner !== unit.owner)) {
        best = n;
        bestDir = planned;
      }
    }
  }
  let bestD = gridDistance(world, unit.position, target);
  for (let dir = 0; best === null && dir < 8; dir++) {
    const n = neighbour(world, unit.position, dir);
    if (!n) continue;
    const v = checkMove(world, rules, unit, n, ctx);
    if (!v.ok || v.boards) continue;
    if (world.unitsAt(n.x, n.y).some((u) => u.owner !== unit.owner)) continue;
    const d = gridDistance(world, n, target);
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
      ...(ctx.onUnitKilled ? { onUnitKilled: ctx.onUnitKilled } : {}),
    });
    if (ev.kind === 'nuclear' && !ev.blast.stoppedBy)
      nuclearFollowUp(
        world,
        rules,
        unit.owner,
        c.to.x,
        c.to.y,
        (s) => ctx.isAlly?.(s) === true && ctx.isHuman?.(s) !== true,
      );
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
  if (r.kind === 'attack') {
    // The movement rules report any foreign city as an attack; an empty one is simply taken.
    const city = world.cityAt(c.to.x, c.to.y);
    if (city && city.owner !== unit.owner && world.unitsAt(c.to.x, c.to.y).length === 0) {
      applyMove(rules, unit, c.to, THIRDS, ctx);
      unit.lastDirection = c.dir;
      takeCityHere(world, rules, unit, ctx, events);
      return true;
    }
  }
  if (r.kind === 'diplomat' || r.kind === 'diplomat-unit' || r.kind === 'caravan') {
    return agentArrives(world, rules, unit, r, ctx, events);
  }
  return false;
}

/** A unit that stepped into an undefended enemy city takes it (the capture rules of conquest.ts). */
function takeCityHere(
  world: World,
  rules: EngineRules,
  unit: Unit,
  ctx: AiUnitContext,
  events: AiUnitEvent[],
): void {
  const city = world.cityAt(unit.position.x, unit.position.y);
  if (!city || city.owner === unit.owner) return;
  const loser = world.civs.find((c) => c.slot === city.owner);
  if (!loser) return;
  const ev = captureCity(world, rules, ctx.rng, city, ctx.civ, loser, {
    turn: ctx.turn,
    difficulty: ctx.difficulty,
    conquest: true,
    guerillaWarfareDiscovered: ctx.guerillaWarfareDiscovered ?? false,
    ...(ctx.onCityTaken ? { onCityTaken: ctx.onCityTaken } : {}),
    ...(ctx.advanceGained ? { advanceGained: ctx.advanceGained } : {}),
  });
  events.push({
    kind: 'ai-unit',
    text: ev.cityDestroyed ? `destroys ${city.name}` : `captures ${city.name}`,
  });
}

/** A diplomat, spy or caravan that reached a foreign city or a lone foreign unit (the handler's special cases). */
function agentArrives(
  world: World,
  rules: EngineRules,
  unit: Unit,
  r:
    | { kind: 'diplomat'; city: City }
    | { kind: 'diplomat-unit'; target: Unit }
    | { kind: 'caravan'; city: City },
  ctx: AiUnitContext,
  events: AiUnitEvent[],
): boolean {
  if (r.kind === 'caravan') {
    if (!ctx.trade) return false;
    const tradeEvents: TradeEvent[] = [];
    establishTradeRoute(world, rules, unit, r.city, ctx.trade, tradeEvents);
    for (const e of tradeEvents) events.push({ kind: 'ai-unit', text: e.text });
    return false;
  }
  if (!ctx.espionage) {
    sentry(unit);
    return false;
  }
  if (r.kind === 'diplomat') {
    const action = aiEspionageChoice(world, unit, r.city, ctx.espionage);
    for (const e of performEspionage(world, rules, unit, r.city, action, ctx.espionage))
      events.push({ kind: 'ai-unit', text: e.text });
    return false;
  }
  for (const e of bribeUnit(world, rules, unit.owner, r.target, ctx.espionage))
    events.push({ kind: 'ai-unit', text: e.text });
  return false;
}

/**
 * A diplomat picks a city it can reach by land (0x004f44cc): own cities `99 − distance`; others
 * `100 + attitude` (+100 at war, half the base under a treaty) over `distance + 1`, halved when
 * already robbed and again when its owner leads by more than six advances, then +100. A treaty
 * partner is left alone unless it is a human who is ahead, or weak on our land mass when its
 * government is a Republic or Democracy. Cities not in the unit's third count 8 squares further.
 */
function diplomatTarget(world: World, unit: Unit, ctx: AiUnitContext): City | null {
  const me = unit.owner;
  const here = unit.position;
  const atSea = world.terrainAt(here.x, here.y) === OCEAN;
  const land = landOf(world, here);
  const rank = (s: number) => ctx.rankOf?.(s) ?? 0;
  const civ = (s: number) => world.civs.find((c) => c.slot === s);
  const myAdvances = ctx.civ.advancesCount;
  const home = world.cities.findIndex((c) => c.id === unit.homeCity);
  const road = world.hasFlag(here.x, here.y, SquareFlag.Road) ? 1 : 0;
  const treaties = TREATY.ceaseFire | TREATY.peace | TREATY.alliance;
  const pressure = ctx.raceWorry === true;
  let best: City | null = null;
  let bestScore = -999;
  for (const [i, c] of world.cities.entries()) {
    const lm = landOf(world, c.position);
    const reach = atSea
      ? world
          .neighbours(here.x, here.y)
          .some((n) => n && world.terrainAt(n.x, n.y) !== OCEAN && landOf(world, n) === lm)
      : lm === land;
    if (!reach) continue;
    let d = distance(world, here, c.position);
    if ((home < 0 ? 255 : home) % 3 !== i % 3 && d > road + 3) d += 8;
    let score: number;
    if (c.owner === me) score = 99 - d;
    else {
      const o = c.owner;
      const them = civ(o);
      const theirs = them?.advancesCount ?? 0;
      const allied = hasTreaty(world, me, o, TREATY.alliance);
      score = 100;
      if (hasTreaty(world, me, o, treaties)) {
        const spy = unit.type === SPY;
        const leave =
          !(ctx.isHuman?.(o) ?? false) ||
          c.techStolen === true ||
          (!pressure &&
            (rank(o) < rank(me) ||
              (!spy &&
                theirs - myAdvances < 10 &&
                (ctx.civ.government > 4 || rank(o) < 7 || (allied && theirs < myAdvances))) ||
              (!allied &&
                (them?.government ?? 0) > 4 &&
                (ctx.strategy?.unitsOn[land] ?? 0) < (them?.strategy?.attackOn[land] ?? 0) &&
                (ctx.strategy?.citiesOn[land] ?? 0) !== 0)));
        if (leave) continue;
        score >>= 1;
      }
      score += hasTreaty(world, me, o, TREATY.war) ? 100 : (ctx.attitude?.(o) ?? 50);
      score = Math.trunc(score / (d + 1));
      if (c.techStolen) {
        score >>= 1;
        if (myAdvances + 6 < theirs) score >>= 1;
        if (pressure) score = 1;
      }
      score += 100;
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function diplomatAct(
  world: World,
  rules: EngineRules,
  unit: Unit,
  ctx: AiUnitContext,
  events: AiUnitEvent[],
): boolean {
  const here = unit.position;
  const me = unit.owner;
  const goal = unit.gotoTarget;
  const goalCity = unit.order === ORDER.goTo && goal ? world.cityAt(goal.x, goal.y) : null;
  const mask = TREATY.ceaseFire | TREATY.peace | TREATY.alliance;
  let best: City | null = null;
  if (goalCity && goalCity.owner !== me && !hasTreaty(world, me, goalCity.owner, mask)) {
    best = goalCity; // bound for a city with no treaty in the way
  } else {
    best = diplomatTarget(world, unit, ctx);
    if (!best) {
      if (unit.order === ORDER.goTo) return true;
      world.units.splice(world.units.indexOf(unit), 1); // VERIFIED: nothing to do, it disbands
      return false;
    }
  }
  if (best.owner !== me && distance(world, here, best.position) <= 1) {
    const r = tryMove(world, rules, ctx.rng, unit, best.position, ctx);
    if (r.kind === 'diplomat') return agentArrives(world, rules, unit, r, ctx, events);
    sentry(unit);
    return false;
  }
  if (best.position.x === here.x && best.position.y === here.y) {
    sentry(unit);
    return false;
  }
  if (stepToward(world, rules, unit, best.position, ctx)) return true;
  sentry(unit);
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
    if (ctx.automatedOnly && !unit.automated) continue;
    const type = rules.units[unit.type];
    if (!type) continue;
    if (unit.order !== null && unit.order >= ORDER.fortress && unit.order <= ORDER.airbase)
      continue; // working
    if (movesLeft(rules, unit, ctx) <= 0) continue;
    if (type.domain === DOMAIN_AIR) {
      // Aircraft (aiAir.ts): a decision per turn; attacks resolve here, go-tos below.
      const d = airDecision(world, rules, unit, {
        rng: ctx.rng,
        atWar: ctx.atWar,
        canAttack: ctx.canAttack ?? ctx.atWar,
        isHuman: ctx.isHuman ?? (() => false),
        isAlly: ctx.isAlly ?? (() => false),
        movement: ctx,
      });
      if (d.kind === 'attack') {
        const r = tryMove(world, rules, ctx.rng, unit, d.target, ctx);
        if (r.kind === 'attack') {
          const ev = resolveAttack(world, rules, ctx.rng, unit, d.target, {
            civ: (slot) => (slot === ctx.civ.slot ? ctx.civ : undefined),
            wondersOf: ctx.wondersOf,
            cityCount: ctx.cityCount,
            difficulty: ctx.difficulty,
            realisticCombat: ctx.realisticCombat,
            barbarianActivity: 1,
            attackerMovesLeft: movesLeft(rules, unit, ctx),
            ...(ctx.onUnitKilled ? { onUnitKilled: ctx.onUnitKilled } : {}),
            ...(ctx.onUnitKilled ? { onUnitKilled: ctx.onUnitKilled } : {}),
          });
          if (ev.kind === 'fought')
            events.push({
              kind: 'ai-unit',
              text: `${type.name} strikes ${rules.units[ev.defender.type]?.name ?? 'a unit'}: ${ev.attackerWon ? 'wins' : 'loses'}`,
            });
        }
        continue;
      }
      if (!applyAirDecision(unit, d)) continue;
    }
    if (type.domain === DOMAIN_SEA && (type.holds ?? 0) > 0) {
      // Transports (aiShips.ts): a decision per turn, then the go-to below carries it out.
      const d = transportDecision(world, rules, unit, {
        turn: ctx.turn,
        rng: ctx.rng,
        ...(ctx.strategy ? { strategy: ctx.strategy } : {}),
        canAttack: ctx.canAttack ?? ctx.atWar,
        atWar: ctx.atWar,
        isAlly: ctx.isAlly ?? (() => false),
        isHuman: ctx.isHuman ?? (() => false),
        ...(ctx.leader !== undefined ? { leader: ctx.leader } : {}),
        cityTrade: (c) => c.lastTrade ?? 0,
      });
      if (!applyShipDecision(world, rules, unit, d)) continue;
    }
    let guard = 0;
    while (movesLeft(rules, unit, ctx) > 0 && world.units.includes(unit) && guard++ < 12) {
      // An objective's go-to (aiStrategy.ts) is followed before anything else.
      if (unit.order === ORDER.goTo && unit.gotoTarget) {
        const r = gotoStep(world, rules, ctx.rng, unit, ctx);
        if (r.kind === 'goto-step' && r.arrived) {
          unit.order = null;
          unit.arrived = true;
          takeCityHere(world, rules, unit, ctx, events);
          // VERIFIED: the handler runs for a unit that has just arrived; a settler's work order
          // needs no movement points, so it is given this turn rather than next.
          if (
            (type.role === ROLE_SETTLE || type.role === ROLE_TRANSFORM) &&
            world.units.includes(unit) &&
            movesLeft(rules, unit, ctx) <= 0
          ) {
            settlersAct(world, rules, unit, ctx, events);
            break;
          }
          continue;
        }
        if (r.kind !== 'goto-step') {
          unit.order = null;
          unit.gotoTarget = null;
          continue;
        }
        takeCityHere(world, rules, unit, ctx, events);
        continue;
      }
      const cityHere = world.cityAt(unit.position.x, unit.position.y);
      if (type.role === ROLE_SETTLE || type.role === ROLE_TRANSFORM) {
        if (!settlersAct(world, rules, unit, ctx, events)) break;
        continue;
      }
      if (type.role === ROLE_TRADE) {
        if (!caravanAct(world, rules, unit, ctx, events)) break;
        continue;
      }
      if (type.role === ROLE_DIPLOMAT) {
        if (!diplomatAct(world, rules, unit, ctx, events)) break;
        continue;
      }
      if (type.role === ROLE_DEFEND && !defenderMoves(world, rules, unit, cityHere, ctx)) {
        fortify(unit);
        break;
      }
      if (type.role < 2) postSettleGoal(world, unit, ctx);
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

/**
 * VERIFIED: an attacker or defender that finds a neighbouring square of higher land value,
 * far enough from the nearest city (`value ≥ 15 − distance`), posts a persistent settle goal
 * there (0x004707c5, type 5, priority 2) for a settler to be sent to.
 */
function postSettleGoal(world: World, unit: Unit, ctx: AiUnitContext): void {
  const s = ctx.strategy;
  if (!s) return;
  const here = unit.position;
  if (world.terrainAt(here.x, here.y) === OCEAN) return;
  const landmass = world.landmass[world.index(here.x, here.y)];
  const nearestAny = nearestCity(world, here, () => true);
  const nearestDist = nearestAny ? distance(world, here, nearestAny.position) : 99;
  let best = landValue(world, here.x, here.y);
  if (
    nearestAny &&
    nearestDist < 4 &&
    best > 7 &&
    world.landmass[world.index(nearestAny.position.x, nearestAny.position.y)] === landmass
  )
    best = 8;
  if (best === 0) return;
  let bestIndex = -1;
  for (let i = 0; i < 8; i++) {
    const q = neighbour(world, here, i);
    if (!q || world.terrainAt(q.x, q.y) === OCEAN) continue;
    if (world.landmass[world.index(q.x, q.y)] !== landmass) continue;
    const v = landValue(world, q.x, q.y);
    if (v > best) {
      best = v;
      bestIndex = i;
    }
  }
  if (bestIndex < 0 || best <= 7) return;
  if (inEnemyZoc(world, here.x, here.y, unit.owner)) return;
  if (best < 15 - nearestDist) return;
  const site = neighbour(world, here, bestIndex);
  if (site) addGoal(s, { x: site.x, y: site.y, type: 5, priority: 2 });
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
  // VERIFIED: a settler clears the settle goal on its own square (0x0046ffe5, type 5, distance 0).
  if (ctx.strategy) removeGoals(world, ctx.strategy, 5, here, 0);
  // VERIFIED (docs/engine/ai-units.md): the very first settler founds at its start position on
  // turn 1.
  if (ctx.turn <= 1 && ctx.cityCount(me) === 0) {
    const verdict = canFoundCity(world, rules, unit);
    if (verdict.ok && verdict.joins === null) {
      const city = foundCity(world, rules, ctx.civ, unit, { name: ctx.nextCityName() });
      events.push({ kind: 'ai-unit', text: `founds ${city.name}` });
      return false;
    }
  }
  const landmass = world.landmass[world.index(here.x, here.y)];
  const nearestAny = nearestCity(world, here, () => true);
  const nearestDist = nearestAny ? distance(world, here, nearestAny.position) : 99;
  const nearestOwn = nearestCity(world, here, (c) => c.owner === me);
  const ownDist = nearestOwn ? distance(world, here, nearestOwn.position) : 99;
  // VERIFIED (the handler's setup): more than eight squares from the nearest own city, or on
  // another land mass, a computer settler stops being a "wanted" worker for this move.
  if (
    unit.wanted &&
    (ownDist > 8 ||
      (nearestOwn &&
        world.landmass[world.index(nearestOwn.position.x, nearestOwn.position.y)] !== landmass))
  )
    unit.wanted = false;
  const ownCitiesHere = world.cities.some(
    (c) => c.owner === me && world.landmass[world.index(c.position.x, c.position.y)] === landmass,
  );
  // VERIFIED site rule (docs/engine/ai-units.md, "Settlers"): the land value here, capped at 8
  // within three squares of a city on the same land mass, against the best of the 20 squares
  // around; found when the best is here and far enough from the nearest city, or when the land
  // mass has no own city yet, or after waiting more than four turns (unit byte 14).
  let best =
    world.terrainAt(here.x, here.y) === OCEAN || unit.wanted === true
      ? 0
      : landValue(world, here.x, here.y);
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
          if (target && stepToward(world, rules, unit, target, ctx)) return true;
          // INFERRED: a better square it cannot reach (a bay, a foreign unit) counts as a wait;
          // after four the settler founds where it stands rather than standing forever.
          if (++unit.gotoSteps > 4) {
            const verdict = canFoundCity(world, rules, unit);
            if (verdict.ok && verdict.joins === null) {
              const city = foundCity(world, rules, ctx.civ, unit, { name: ctx.nextCityName() });
              events.push({ kind: 'ai-unit', text: `founds ${city.name}` });
            }
          }
          return false;
        }
      }
    }
  }
  // VERIFIED worker rules (aiTerraform.ts): pollution, fortresses, irrigation, mines, roads,
  // railroads here or on a neighbour, and the wanted worker's duties around its home city.
  const verdict = workerRules(
    world,
    rules,
    unit,
    { nearestOwn, ownDist, nearestAny, anyDist: nearestDist },
    {
      knows: ctx.knows,
      turn: ctx.turn,
      government: ctx.civ.government,
      ...(ctx.strategy ? { strategy: ctx.strategy } : {}),
      isHuman: false,
    },
  );
  if (verdict.kind === 'worked') return false;
  if (verdict.kind === 'goto') {
    unit.order = ORDER.goTo;
    unit.gotoTarget = { x: verdict.target.x, y: verdict.target.y };
    return true;
  }
  if (verdict.kind === 'step') {
    if (stepToward(world, rules, unit, verdict.target, ctx)) return true;
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
  const tradeEvents: TradeEvent[] = [];
  if (here && here.owner === unit.owner && helpWonder(world, rules, unit, here, tradeEvents)) {
    for (const e of tradeEvents) events.push({ kind: 'ai-unit', text: e.text });
    return false;
  }
  if (here && here.id !== unit.homeCity && ctx.trade) {
    // VERIFIED: a computer caravan at its destination establishes the route.
    if (
      unit.gotoTarget === null ||
      (unit.gotoTarget.x === here.position.x && unit.gotoTarget.y === here.position.y)
    ) {
      establishTradeRoute(world, rules, unit, here, ctx.trade, tradeEvents);
      for (const e of tradeEvents) events.push({ kind: 'ai-unit', text: e.text });
      return false;
    }
  }
  const wonderCity = nearestCity(
    world,
    unit.position,
    (c) =>
      c.owner === unit.owner && c.production.kind === 'improvement' && c.production.index >= 39,
  );
  if (wonderCity) return stepToward(world, rules, unit, wonderCity.position, ctx);
  const target = aiCaravanDestination(world, unit, (slot) => ctx.attitude?.(slot) ?? 50);
  if (target) {
    unit.gotoTarget = { x: target.position.x, y: target.position.y };
    return stepToward(world, rules, unit, target.position, ctx);
  }
  sentry(unit);
  return false;
}
