/**
 * City production: shields into the box, completion of units, improvements and wonders.
 *
 * Specification: docs/engine/rules-city.md, "Production" — VERIFIED against the original's
 * production routine. The engine changes world state and returns events; dialogs, sounds and
 * AI choices are the caller's business. Decisions the original asks the player for (caravan
 * commodity, ghost-town confirmation) are taken from `ProductionChoices`.
 */
import { boxRows } from './city.js';
import { releaseCitySite } from './fertility.js';
import type { Rng } from './rng.js';
import {
  advanceIndex,
  DOMAIN_AIR,
  DOMAIN_GROUND,
  DOMAIN_SEA,
  GOVERNMENT,
  IMPROVEMENT,
  type EngineRules,
} from './rules.js';
import type { City, Production, Unit, World } from './world.js';

export const FIRST_WONDER = 39;
export const SPACESHIP_PARTS = [35, 36, 37] as const;
export const ROLE_SETTLE = 5;
export const ROLE_DIPLOMACY = 6;
export const ROLE_TRADE = 7;

export interface ProductionContext {
  government: number;
  isHuman: boolean;
  difficulty: number;
  /** Simplified combat OFF (options bit 4). */
  realisticCombat: boolean;
  cityCount: number;
  knows: (advance: number) => boolean;
  ownsWonder: (improvement: number) => boolean;
  /** City id holding each completed wonder (index 39–66), or null. Shared across civilizations. */
  wonderCity: (improvement: number) => number | null;
  /** The civilization can build spaceship parts (Apollo Program exists, ship not launched). */
  canBuildSpaceship: boolean;
  /** Shield-box rows for this owner; `boxRows(rules, ctx, true)` normally. */
  shieldRows: number;
}

export interface ProductionChoices {
  /** Caravan commodity for a human city: index 0–2 into the city's supplied list, or 3 = food. */
  caravanCommodity?: (city: City, supplied: number[]) => number;
  /** Let a size-1 human city disband into Settlers? Default no. */
  allowGhostTown?: (city: City) => boolean;
}

export type ProductionEvent =
  | { kind: 'shields'; added: number }
  | { kind: 'capitalization'; gold: number }
  | { kind: 'bad-build'; production: Production }
  | { kind: 'bad-space'; production: Production }
  | { kind: 'built-improvement'; improvement: number }
  | { kind: 'built-wonder'; improvement: number }
  | { kind: 'palace-moved' }
  | {
      kind: 'wonder-effect';
      improvement: number;
      effect: 'manhattan' | 'darwin' | 'leonardo' | 'eiffel' | 'apollo';
    }
  | { kind: 'upgraded'; from: number; to: number }
  | { kind: 'built-unit'; unit: Unit }
  | { kind: 'ghost-town'; unit: Unit }
  | { kind: 'waiting'; reason: 'last-city-settlers' | 'ghost-town-declined' };

function cost(rules: EngineRules, p: Production, rows: number): number {
  if (p.kind === 'unit') return (rules.units[p.index]?.costRows ?? 1) * rows;
  return (rules.improvements[p.index]?.costRows ?? 1) * rows;
}

/** The type a completed unit becomes when its obsoleting advance is known (same role, prerequisite = that advance). */
export function upgradeTarget(
  rules: EngineRules,
  type: number,
  knows: (advance: number) => boolean,
  obsoleteWith: (t: number) => number | null,
  prereq: (t: number) => number | null,
): number {
  const obs = obsoleteWith(type);
  if (obs === null || !knows(obs)) return type;
  const role = rules.units[type]?.role;
  for (let t = 0; t < rules.units.length; t++) {
    if (prereq(t) === obs && rules.units[t]?.role === role) return t;
  }
  return type;
}

/** Whether a freshly built unit starts veteran. */
export function startsVeteran(
  rules: EngineRules,
  city: City,
  ctx: ProductionContext,
  type: number,
): boolean {
  const t = rules.units[type];
  if (!t) return false;
  if (t.role === ROLE_DIPLOMACY && ctx.government === GOVERNMENT.communism) return true;
  if (t.flags.destroyedAfterAttack) return false;
  const barracks = city.improvements[IMPROVEMENT.barracks] || ctx.ownsWonder(IMPROVEMENT.sunTzu);
  if (t.domain === DOMAIN_GROUND || !ctx.realisticCombat)
    return barracks && t.role < ROLE_DIPLOMACY;
  if (t.domain === DOMAIN_SEA)
    return city.improvements[IMPROVEMENT.portFacility] || ctx.ownsWonder(IMPROVEMENT.lighthouse);
  if (t.domain === DOMAIN_AIR) return city.improvements[IMPROVEMENT.airport] === true;
  return false;
}

export interface ProductionInputs {
  /** Shields produced this turn after waste, minus unit support (0 in disorder). */
  surplus: number;
  /** The city's three supplied commodities (negative = already used), for caravans. */
  supplied: number[];
  /** Obsolescence lookups; default to the rules' `obsoleteWith` / `preq` references. */
  obsoleteWith?: (type: number) => number | null;
  prereq?: (type: number) => number | null;
  /** Next free unit id. */
  nextUnitId: () => number;
}

/** One turn of production for a city. Mutates `city` and `world.units`; returns what happened. */
export function processProduction(
  world: World,
  rules: EngineRules,
  rng: Rng,
  city: City,
  ctx: ProductionContext,
  inputs: ProductionInputs,
  choices: ProductionChoices = {},
): ProductionEvent[] {
  const events: ProductionEvent[] = [];
  const surplus = Math.max(0, city.inDisorder ? 0 : inputs.surplus);
  const p = city.production;

  if (p.kind === 'improvement' && p.index === IMPROVEMENT.capitalization) {
    events.push({ kind: 'capitalization', gold: surplus });
    return events;
  }
  city.shieldsStored += surplus;
  events.push({ kind: 'shields', added: surplus });

  if (p.kind === 'improvement') {
    const idx = p.index;
    const isWonder = idx >= FIRST_WONDER;
    const taken = isWonder && ctx.wonderCity(idx) !== null && ctx.wonderCity(idx) !== city.id;
    if ((!isWonder && city.improvements[idx]) || taken) {
      events.push({ kind: 'bad-build', production: p });
      return events;
    }
    if (SPACESHIP_PARTS.includes(idx as 35 | 36 | 37) && !ctx.canBuildSpaceship) {
      events.push({ kind: 'bad-space', production: p });
      return events;
    }
    const c = cost(rules, p, ctx.shieldRows);
    if (city.shieldsStored < c) return events;
    city.improvements[idx] = true;
    city.shieldsStored -= c;
    if (ctx.isHuman) city.shieldsStored = 0;
    if (idx === IMPROVEMENT.palace) {
      for (const other of world.cities)
        if (other !== city && other.owner === city.owner)
          other.improvements[IMPROVEMENT.palace] = false;
      events.push({ kind: 'palace-moved' });
    }
    events.push(
      isWonder
        ? { kind: 'built-wonder', improvement: idx }
        : { kind: 'built-improvement', improvement: idx },
    );
    const effects: Partial<
      Record<number, 'manhattan' | 'darwin' | 'leonardo' | 'eiffel' | 'apollo'>
    > = {
      [IMPROVEMENT.manhattanProject]: 'manhattan',
      [IMPROVEMENT.darwins]: 'darwin',
      [IMPROVEMENT.leonardos]: 'leonardo',
      [IMPROVEMENT.eiffelTower]: 'eiffel',
      [IMPROVEMENT.apolloProgram]: 'apollo',
    };
    const effect = effects[idx];
    if (effect) events.push({ kind: 'wonder-effect', improvement: idx, effect });
    return events;
  }

  // ---- unit
  let type = p.index;
  const upgraded = upgradeTarget(
    rules,
    type,
    ctx.knows,
    inputs.obsoleteWith ?? ((t) => advanceIndex(rules.units[t]?.obsoleteWith)),
    inputs.prereq ?? ((t) => advanceIndex(rules.units[t]?.preq)),
  );
  if (upgraded !== type) {
    events.push({ kind: 'upgraded', from: type, to: upgraded });
    type = upgraded;
    city.production = { kind: 'unit', index: type };
  }
  const t = rules.units[type];
  if (!t) return events;
  const c = t.costRows * ctx.shieldRows;
  if (city.shieldsStored < c) return events;

  if (t.role === ROLE_SETTLE && city.size === 1) {
    if (ctx.cityCount === 1) {
      events.push({ kind: 'waiting', reason: 'last-city-settlers' });
      return events;
    }
    if (ctx.isHuman && !(choices.allowGhostTown?.(city) ?? false)) {
      events.push({ kind: 'waiting', reason: 'ghost-town-declined' });
      return events;
    }
  }
  city.shieldsStored -= c;
  if (ctx.isHuman) city.shieldsStored = 0;

  const unit: Unit = {
    id: inputs.nextUnitId(),
    position: { x: city.position.x, y: city.position.y },
    owner: city.owner,
    type,
    veteran: startsVeteran(rules, city, ctx, type),
    hitPointsLost: 0,
    movesSpent: 0,
    fortified: false,
    homeCity: city.id,
    order: null,
    workCounter: 0,
    gotoTarget: null,
    lastDirection: null,
    gotoSteps: 0,
  };
  world.units.push(unit);

  if (t.role === ROLE_TRADE) {
    if (ctx.isHuman) {
      const pick =
        choices.caravanCommodity?.(city, inputs.supplied) ??
        inputs.supplied.findIndex((s) => s >= 0);
      if (pick >= 0 && pick < 3) {
        const commodity = inputs.supplied[pick] ?? 0;
        inputs.supplied[pick] = -Math.abs(commodity); // marked used, as the original does
        unit.commodity = Math.abs(commodity);
      } else {
        unit.commodity = 0xff; // food caravan
      }
    } else {
      unit.commodity = rng.nextInt(16);
    }
  }

  if (t.role === ROLE_SETTLE) {
    city.size -= 1;
    if (city.size < 1) {
      world.cities.splice(world.cities.indexOf(city), 1);
      releaseCitySite(world, city);
      events.push({ kind: 'ghost-town', unit });
      return events;
    }
  }
  events.push({ kind: 'built-unit', unit });
  return events;
}

/**
 * Production category (VERIFIED, 0x004b2ec8): 0 units, 1 improvements 1–34, 2 spaceship parts and
 * wonders (35 and up). Changing between categories costs shields.
 */
export function productionCategory(p: Production): 0 | 1 | 2 {
  if (p.kind === 'unit') return 0;
  return p.index >= 35 ? 2 : 1;
}

/**
 * Change what a city builds (VERIFIED, 0x004b2f4f): above Chieftain, switching to another
 * category loses @COSMIC "percent shield penalty for production type change" of the stored
 * shields. Returns the shields lost.
 */
export function changeProduction(
  rules: EngineRules,
  city: City,
  next: Production,
  difficulty: number,
): number {
  const before = city.shieldsStored;
  if (difficulty !== 0 && productionCategory(city.production) !== productionCategory(next)) {
    const pct = rules.cosmic.productionChangePenaltyPct ?? 50;
    city.shieldsStored -= Math.trunc((pct * (before & 0xffff)) / 100);
  }
  city.production = next;
  return before - city.shieldsStored;
}

/** Convenience: the shield rows the production code uses for this owner. */
export function shieldRowsFor(rules: EngineRules, isHuman: boolean, difficulty: number): number {
  return boxRows(rules, { isHuman, difficulty }, true);
}
