/**
 * Combat resolution between one attacker and one defender.
 *
 * Specification: docs/engine/rules-combat.md — VERIFIED against the original executable's
 * attack handler, so the arithmetic below deliberately mirrors it: strengths are integers in
 * eighths of a point, "×1.5" is `x += x >> 1`, and each round compares two independent draws.
 * All randomness goes through `Rng`, so a battle is reproducible from the generator state.
 */
import type { Rng } from './rng.js';
import { DOMAIN_AIR, DOMAIN_GROUND, DOMAIN_SEA, IMPROVEMENT, type EngineRules } from './rules.js';
import { SquareFlag, type Unit, type World } from './world.js';

/** Unit type indices the original special-cases by position in @UNITS. */
export const UNIT_TYPE = { archers: 4, legion: 5, partisans: 9 } as const;

/** Order code that grants the fortified bonus (save format: unit record +15). */
export const ORDER_FORTIFY = 2;

export interface StrengthBreakdown {
  /** Final integer strength in eighths of a point. */
  value: number;
  /** Multipliers applied, in order, for display and debugging. */
  modifiers: { label: string; factor: number }[];
}

export interface CombatRound {
  attackerWon: boolean;
  attackerHp: number;
  defenderHp: number;
}

export interface CombatResult {
  attack: StrengthBreakdown;
  defence: StrengthBreakdown;
  attackerFirepower: number;
  defenderFirepower: number;
  rounds: CombatRound[];
  attackerWon: boolean;
  survivorHp: number;
  /** Whether the survivor earned veteran status. */
  promoted: boolean;
}

/** Everything about the two sides the strength rules need beyond the units themselves. */
export interface CombatContext {
  /** Improvements of the city on the defender's square, by @IMPROVE index; undefined = no city. */
  defenderCity?: boolean[];
  /** Wonders owned by each side's civilization, by @IMPROVE index. */
  attackerWonders?: boolean[];
  defenderWonders?: boolean[];
  /** Whether the defender carries the Fortify order. */
  defenderFortified: boolean;
  /** For barbarian attackers: facts about the defending civilization. */
  defenderIsHuman?: boolean;
  defenderCityCount?: number;
  /** Difficulty 0–5, for barbarian attacks on humans. */
  difficulty?: number;
  /** Attacker's moves left in thirds: a real attack scales by min(left, 3) / 3 (VERIFIED). */
  attackerMovesLeft?: number;
  /** Simplified combat OFF (default true): fight to the death. When false one round decides (VERIFIED). */
  realisticCombat?: boolean;
}

const DEFAULT_CTX: CombatContext = { defenderFortified: false };

export function maxHitPoints(rules: EngineRules, unitType: number): number {
  return (rules.units[unitType]?.hitPointsTens ?? 1) * 10;
}

export function hitPoints(rules: EngineRules, unit: Unit): number {
  return Math.max(0, maxHitPoints(rules, unit.type) - unit.hitPointsLost);
}

const halfMore = (x: number) => x + (x >> 1);

function note(b: StrengthBreakdown, label: string, factor: number): void {
  b.modifiers.push({ label, factor });
}

/**
 * 0x0052b404: attack × 8, ×1.5 for veteran. Damage does NOT reduce it. The attack handler
 * (0x0052d472, VERIFIED) then scales a real attack by the moves left, capped at one full move:
 * `A × min(movesLeft, 3) / 3` — the FATIGUE rule.
 */
export function attackStrength(
  rules: EngineRules,
  attacker: Unit,
  movesLeft?: number,
): StrengthBreakdown {
  const type = rules.units[attacker.type];
  const b: StrengthBreakdown = { value: (type?.attack ?? 0) * 8, modifiers: [] };
  if (attacker.veteran) {
    b.value = halfMore(b.value);
    note(b, 'veteran', 1.5);
  }
  const oneMove = rules.cosmic?.roadMoveMultiplier ?? 3;
  if (movesLeft !== undefined && movesLeft < oneMove) {
    b.value = Math.trunc((b.value * Math.max(0, movesLeft)) / oneMove);
    note(b, 'fatigue', Math.max(0, movesLeft) / oneMove);
  }
  return b;
}

/**
 * 0x0052b47b: (terrain halves + river) × defence × 4, then one position multiplier in halves,
 * then ×1.5 for veteran.
 */
export function defenceStrength(
  world: World,
  rules: EngineRules,
  defender: Unit,
  attacker: Unit,
  ctx: CombatContext = DEFAULT_CTX,
): StrengthBreakdown {
  const type = rules.units[defender.type];
  const aType = rules.units[attacker.type];
  const { x, y } = defender.position;
  const halves = rules.terrain[world.terrainAt(x, y)]?.defenceHalves ?? 2;
  const river = world.hasFlag(x, y, SquareFlag.River) ? 1 : 0;
  const b: StrengthBreakdown = {
    value: (halves + river) * (type?.defence ?? 0) * 4,
    modifiers: [],
  };
  note(b, 'terrain', halves / 2);
  if (river) note(b, 'river (+½)', (halves + 1) / halves);

  const inCity = ctx.defenderCity !== undefined;
  const dGround = type?.domain === DOMAIN_GROUND;
  const aAir = aType?.domain === DOMAIN_AIR;
  const aNegatesWalls = aType?.flags.negatesCityWalls === true;
  let m = 2;
  let label = '';
  if (ctx.defenderFortified && dGround) {
    m = 3;
    label = 'fortified';
  }
  if (world.hasFlag(x, y, SquareFlag.Fortress) && !inCity && !aAir && !aNegatesWalls) {
    m = 4;
    label = 'fortress';
  }
  let fighterInCity = false;
  if (inCity) {
    const dFighter = type?.domain === DOMAIN_AIR && type.flags.canAttackAir;
    const aMissile = aType?.flags.destroyedAfterAttack === true;
    if (dFighter && aAir && !aMissile) {
      fighterInCity = true;
      const bomber = aType?.flags.canAttackAir !== true;
      m = bomber ? m << 2 : m << 1;
      label = bomber ? 'fighter in city vs bomber' : 'fighter in city vs fighter';
    } else {
      const walls =
        ctx.defenderCity?.[IMPROVEMENT.cityWalls] === true ||
        ctx.defenderWonders?.[IMPROVEMENT.greatWall] === true;
      if (walls && dGround && aType?.domain === DOMAIN_GROUND && !aNegatesWalls) {
        m = 6;
        label = ctx.defenderCity?.[IMPROVEMENT.cityWalls] ? 'city walls' : 'Great Wall';
      }
    }
  }
  if (!dGround && !fighterInCity) {
    m = 2;
    label = '';
  }
  if (m !== 2) {
    b.value = (b.value * m) >> 1;
    note(b, label, m / 2);
  }
  if (defender.veteran) {
    b.value = halfMore(b.value);
    note(b, 'veteran', 1.5);
  }
  return b;
}

interface Sides {
  a: number;
  d: number;
  aFp: number;
  dFp: number;
  doubleRoll: boolean;
  attack: StrengthBreakdown;
  defence: StrengthBreakdown;
}

/** The situational adjustments the attack handler applies after the two strength functions. */
function prepareSides(
  world: World,
  rules: EngineRules,
  attacker: Unit,
  defender: Unit,
  ctx: CombatContext,
): Sides {
  const aType = rules.units[attacker.type];
  const dType = rules.units[defender.type];
  const full = (rules.units[attacker.type]?.move ?? 1) * 3;
  const left = ctx.attackerMovesLeft ?? Math.max(0, full - attacker.movesSpent);
  const attack = attackStrength(rules, attacker, left);
  const defence = defenceStrength(world, rules, defender, attacker, ctx);
  let a = attack.value;
  let d = defence.value;
  let aFp = aType?.firepower ?? 1;
  let dFp = dType?.firepower ?? 1;
  const tag = (b: StrengthBreakdown, label: string, factor: number) => note(b, label, factor);

  const aAir = aType?.domain === DOMAIN_AIR;
  const aSea = aType?.domain === DOMAIN_SEA;
  const aGround = aType?.domain === DOMAIN_GROUND;
  const dAir = dType?.domain === DOMAIN_AIR;
  const dSea = dType?.domain === DOMAIN_SEA;
  const dGround = dType?.domain === DOMAIN_GROUND;
  const aMissile = aType?.flags.destroyedAfterAttack === true;
  const city = ctx.defenderCity;

  if (aType?.role === 3 && dAir && (dType?.range ?? 0) === 0) {
    d -= d >> 1;
    dFp = 1;
    tag(defence, 'fighter vs helicopter', 0.5);
  }
  if (
    dType?.flags.doubleDefenceVsHorse &&
    aGround &&
    (aType?.move ?? 0) === 2 &&
    maxHitPoints(rules, attacker.type) === 10
  ) {
    d = halfMore(d);
    tag(defence, 'pikemen vs horse', 1.5);
  }
  if (dType?.flags.doubleDefenceVsAir && aAir) {
    d *= aMissile ? 5 : 3;
    tag(defence, aMissile ? 'AEGIS vs missile' : 'AEGIS vs air', aMissile ? 5 : 3);
  }
  if (city && aSea && !dSea && city[IMPROVEMENT.coastalFortress]) {
    d <<= 1;
    tag(defence, 'coastal fortress', 2);
  }
  if (city && aAir) {
    const dFighter = dAir && dType?.flags.canAttackAir;
    if (!dFighter || aMissile) {
      if (city[IMPROVEMENT.sdiDefense] && aMissile && (aType?.attack ?? 0) < 99) {
        d <<= 1;
        tag(defence, 'SDI vs missile', 2);
      }
      if (city[IMPROVEMENT.samBattery]) {
        d <<= 1;
        tag(defence, 'SAM battery', 2);
      }
    }
  }
  if (attacker.type === UNIT_TYPE.partisans && (dType?.attack ?? 0) === 0) {
    a <<= 3;
    tag(attack, 'partisans vs non-combatant', 8);
  }
  if (aSea && dGround) {
    aFp = 1;
    dFp = 1;
  }
  if (dType?.flags.submarine) dFp = 1;
  if (dSea && !city && !aSea) {
    dFp = 1;
    aFp <<= 1;
  }

  let doubleRoll = false;
  if (attacker.owner === 0) {
    if (ctx.defenderIsHuman) {
      a = ((ctx.difficulty ?? 0) + 1) * a;
      a = a >> 2;
      tag(attack, 'barbarians vs human', ((ctx.difficulty ?? 0) + 1) / 4);
    } else {
      a = Math.floor(a / 2);
      tag(attack, 'barbarians vs AI', 0.5);
    }
    if ((ctx.defenderCityCount ?? 99) < 2) a = 0;
    if (city?.[IMPROVEMENT.palace]) {
      doubleRoll = true;
      a >>= 1;
      tag(attack, 'barbarians vs capital', 0.5);
    }
    if ((ctx.defenderCityCount ?? 99) < 8) doubleRoll = true;
    if (ctx.defenderWonders?.[IMPROVEMENT.greatWall]) {
      a = Math.floor(a / 2);
      tag(attack, 'Great Wall vs barbarians', 0.5);
    }
  }
  if (defender.owner === 0) {
    // VERIFIED 0x0052d472: a Legion only while no human knows advance 39.
    const humanKnows = world.civs.some((c) => c.isHuman && c.knownAdvances[39] === true);
    if (
      defender.type === UNIT_TYPE.archers ||
      (defender.type === UNIT_TYPE.legion && !humanKnows)
    ) {
      d = Math.max(1, Math.floor(d / 2));
      tag(defence, 'barbarian archers/legion', 0.5);
    }
    if (ctx.attackerWonders?.[IMPROVEMENT.greatWall]) {
      a <<= 1;
      tag(attack, 'Great Wall vs barbarians', 2);
    }
  }
  attack.value = a;
  defence.value = d;
  return { a, d, aFp, dFp, doubleRoll, attack, defence };
}

/** Fight to the death, exactly as the original's round loop does. */
/**
 * The AI's attack odds (VERIFIED, the evaluate-only branch of the original's combat routine
 * 0x0052d472): both strengths with every modifier of a real fight but no fatigue scaling;
 * with simplified combat off each side is weighted by `hit points left + firepower × 8`; both
 * are halved while the attacker's exceeds 3999; the result is `8 × A / (D + 1)`, at most 1024.
 * Even odds therefore come out near 8. The original returns 999 when no unit stands there.
 */
export function combatOdds(
  world: World,
  rules: EngineRules,
  attacker: Unit,
  defender: Unit,
  ctx: CombatContext = DEFAULT_CTX,
): number {
  const s = prepareSides(world, rules, attacker, defender, { ...ctx, attackerMovesLeft: 3 });
  let a = s.a;
  let d = s.d;
  if (ctx.realisticCombat ?? true) {
    a = (hitPoints(rules, attacker) + s.aFp * 8) * a;
    d = (hitPoints(rules, defender) + s.dFp * 8) * d;
  }
  while (a > 3999) {
    a >>= 1;
    d >>= 1;
  }
  return Math.min(1024, Math.trunc((a << 3) / (d + 1)));
}

export function resolveCombat(
  world: World,
  rules: EngineRules,
  rng: Rng,
  attacker: Unit,
  defender: Unit,
  ctx: CombatContext = DEFAULT_CTX,
): CombatResult {
  const s = prepareSides(world, rules, attacker, defender, ctx);
  let aHp = hitPoints(rules, attacker);
  let dHp = hitPoints(rules, defender);
  const rounds: CombatRound[] = [];
  const draw = (strength: number) => (strength > 1 ? rng.nextInt(strength) : 0);
  const toTheDeath = ctx.realisticCombat ?? true;
  let lastRound = false;
  while (aHp > 0 && dHp > 0) {
    let attackerWon = draw(s.d) < draw(s.a);
    if (s.doubleRoll && attackerWon && draw(s.a) < draw(s.d)) attackerWon = false;
    if (attackerWon) dHp = Math.max(0, dHp - s.aFp);
    else aHp = Math.max(0, aHp - s.dFp);
    rounds.push({ attackerWon, attackerHp: aHp, defenderHp: dHp });
    lastRound = attackerWon;
    if (!toTheDeath) break; // simplified combat: the first round decides, the loser is destroyed
  }
  const attackerWon = toTheDeath ? dHp === 0 : lastRound;
  const total = s.a + s.d;
  let promoted: boolean;
  if (attackerWon) {
    promoted =
      (total > 1 ? rng.nextInt(total) : 0) <= s.d ||
      ctx.attackerWonders?.[IMPROVEMENT.sunTzu] === true;
  } else {
    promoted =
      (total > 1 ? rng.nextInt(total) : 0) <= s.a ||
      ctx.defenderWonders?.[IMPROVEMENT.sunTzu] === true;
  }
  return {
    attack: s.attack,
    defence: s.defence,
    attackerFirepower: s.aFp,
    defenderFirepower: s.dFp,
    rounds,
    attackerWon,
    survivorHp: attackerWon ? aHp : dHp,
    promoted,
  };
}

/** Write a result back onto the units: hit points, destruction (hp 0) and promotion. */
export function applyCombat(
  rules: EngineRules,
  result: CombatResult,
  attacker: Unit,
  defender: Unit,
): void {
  const winner = result.attackerWon ? attacker : defender;
  const loser = result.attackerWon ? defender : attacker;
  winner.hitPointsLost = maxHitPoints(rules, winner.type) - result.survivorHp;
  loser.hitPointsLost = maxHitPoints(rules, loser.type);
  if (result.promoted) winner.veteran = true;
}
