/**
 * The computer player's purchases (the tail of 0x004b7e74): at the end of its city turn a computer
 * city draws a share of the treasury into its shield box, part of it refunded by difficulty.
 *
 * Specification: docs/engine/rules-city.md. VERIFIED.
 */
import { IMPROVEMENT, type EngineRules } from './rules.js';
import type { City, Civ, World } from './world.js';

/** A civilization's wonders in one era against the humans' (0x005d12d7, 0x0046ab4b). */
export interface WonderTally {
  mine: number;
  humanLowest: number;
  humanHighest: number;
  main: number;
}

export interface PurchaseContext {
  /** Shield surplus this turn; zero in disorder (0x0061be6c − 0x0061be08). */
  surplus: number;
  /** The price of what the city is building. */
  cost: number;
  difficulty: number;
  /** The highest power rank a human holds (0x005da840). */
  topHumanRank: number;
  /** The treasury of the main human (0x005da841). */
  mainTreasury: number;
  /** The civilization's plan for this city's land mass (0x005d1652). */
  plan: number;
  wonderTally: (era: number) => WonderTally;
  anyHumanLaunched: boolean;
  spaceRacePressure: boolean;
  /** How many of a unit type this civilization has (0x005d1398). */
  unitCount: (type: number) => number;
}

const NUCLEAR_MISSILE = 45;

/** The share of the treasury this city may spend. */
export function purchaseShare(
  world: World,
  rules: EngineRules,
  city: City,
  civ: Civ,
  ctx: PurchaseContext,
): number {
  const t = civ.treasury;
  const p = city.production;
  const unit = p.kind === 'unit' ? rules.units[p.index] : undefined;
  const idx = p.kind === 'improvement' ? p.index : 0;
  const started = city.shieldsStored !== 0;
  let share = 0;
  if ((ctx.plan === 0 || ctx.plan === 1 || ctx.plan === 4) && ctx.surplus !== 0 && unit) {
    if (unit.role === ctx.plan) share = t >> 6;
  }
  if (idx > 38) {
    const era = ctx.wonderTally(Math.trunc((idx - 39) / 7));
    if (era.mine === 0 || era.mine < era.humanLowest) share = t >> 6;
    else if (era.humanHighest + 1 < era.mine) share = t >> 8;
    else share = t >> 7;
    if (t > 2499) share <<= 1;
  }
  if (idx > 34 && idx < 39) {
    if (ctx.anyHumanLaunched) share = t >> 7;
    if (ctx.spaceRacePressure) share <<= 1;
  }
  if (city.inDisorder && idx !== 0 && started) share = t >> 3;
  const empty = world.unitsAt(city.position.x, city.position.y).length === 0;
  if ((empty || city.attacked === true) && p.kind === 'unit' && started) share = t >> 3;
  if (idx === IMPROVEMENT.palace && started) share = t >> 3;
  if (
    p.kind === 'unit' &&
    p.index === NUCLEAR_MISSILE &&
    ctx.unitCount(NUCLEAR_MISSILE) === 0 &&
    started
  )
    share = t >> 4;
  if (t > 2000) share += t >> 9;
  return Math.min(Math.max(0, share), ctx.cost - city.shieldsStored);
}

/** Spend it: shields go up one for one, and the treasury pays less the difficulty's refund. */
export function computerPurchase(
  world: World,
  rules: EngineRules,
  city: City,
  civ: Civ,
  ctx: PurchaseContext,
): number {
  const share = purchaseShare(world, rules, city, civ, ctx);
  city.shieldsStored += share;
  let refund = Math.trunc(Math.trunc((ctx.difficulty * share) / 10) / (8 - ctx.topHumanRank));
  if (ctx.mainTreasury < civ.treasury) {
    if (civ.treasury > 999) refund = Math.trunc(refund / 2);
    if (civ.treasury > 1999) refund = 0;
  }
  civ.treasury -= share - refund;
  return share;
}
