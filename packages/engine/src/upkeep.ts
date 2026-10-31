/**
 * Improvement upkeep and forced sales.
 *
 * Specification: docs/engine/rules-city.md, "Upkeep" — VERIFIED against the original's upkeep
 * routine and its per-city gold step.
 */
import { GOVERNMENT, IMPROVEMENT, type EngineRules } from './rules.js';
import type { City, Civ } from './world.js';

/** Advances that raise Barracks upkeep (indices in the shipped rules). */
export const GUNPOWDER = 35;
export const MOBILE_WARFARE = 53;

export interface UpkeepContext {
  difficulty: number;
  ownsWonder: (improvement: number) => boolean;
  /** Shield-box rows for the owner: a sold improvement returns `costRows × rows` gold. */
  shieldRows: number;
}

/** Gold per turn one improvement costs its owner (VERIFIED). */
export function improvementUpkeep(
  rules: EngineRules,
  civ: Civ,
  improvement: number,
  ctx: UpkeepContext,
): number {
  let u = rules.improvements[improvement]?.upkeep ?? 0;
  if (improvement === IMPROVEMENT.barracks) {
    if (ctx.difficulty < 2 && u !== 0) u -= 1;
    if (civ.knownAdvances[GUNPOWDER]) u += 1;
    // The original walks down from Mobile Warfare to the first reachable advance; a disabled
    // advance has no reachable chain, so this is Mobile Warfare itself or nothing.
    const mobileWarfare = rules.advances[MOBILE_WARFARE];
    if (
      mobileWarfare &&
      mobileWarfare.preq1.kind !== 'never' &&
      civ.knownAdvances[MOBILE_WARFARE]
    ) {
      u += 1;
    }
  }
  if (u === 1 && ctx.ownsWonder(IMPROVEMENT.adamSmiths)) u = 0;
  if (
    u !== 0 &&
    civ.government === GOVERNMENT.fundamentalism &&
    (improvement === IMPROVEMENT.temple ||
      improvement === IMPROVEMENT.colosseum ||
      improvement === IMPROVEMENT.cathedral)
  ) {
    u = 0;
  }
  return u;
}

export type UpkeepEvent =
  | { kind: 'paid'; improvement: number; gold: number }
  | { kind: 'sold'; improvement: number; gold: number };

/**
 * Pay a city's upkeep from its owner's treasury (VERIFIED): improvements 1–38 in index order;
 * the first one the treasury cannot cover is sold for its full shield cost in gold. Nothing is
 * paid under Anarchy.
 */
export function payUpkeep(
  rules: EngineRules,
  civ: Civ,
  city: City,
  ctx: UpkeepContext,
): UpkeepEvent[] {
  const events: UpkeepEvent[] = [];
  if (civ.government === GOVERNMENT.anarchy) return events;
  for (let imp = 1; imp < 39; imp++) {
    if (!city.improvements[imp]) continue;
    const u = improvementUpkeep(rules, civ, imp, ctx);
    civ.treasury -= u;
    if (civ.treasury < 0) {
      civ.treasury = 0;
      city.improvements[imp] = false;
      const gold = (rules.improvements[imp]?.costRows ?? 0) * ctx.shieldRows;
      civ.treasury += gold;
      events.push({ kind: 'sold', improvement: imp, gold });
    } else if (u !== 0) {
      events.push({ kind: 'paid', improvement: imp, gold: u });
    }
  }
  return events;
}
