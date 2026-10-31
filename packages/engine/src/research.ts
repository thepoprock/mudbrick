/**
 * Research: the cost of the next advance, science income, discovery, and the AI's rate policy.
 *
 * Specification: docs/engine/rules-research.md — VERIFIED against the original executable's
 * research-cost routine, its science-income routine, its advance-granting routine and the
 * civilization-turn routine that sets the AI's tax, luxury and science rates. Integer
 * arithmetic mirrors the original (C division truncates toward zero).
 */
import { advanceIndex, type EngineRules } from './rules.js';
import type { Civ } from './world.js';

/** Advance index of Future Technology in the shipped rules. */
export const FUTURE_TECHNOLOGY = 89;

/**
 * Research cost is normalised to a tree of this many advances: a ruleset with more reachable
 * advances makes each one proportionally cheaper (VERIFIED; the number is the size of the
 * first game's tree, INFERRED).
 */
export const BASELINE_ADVANCE_COUNT = 67;

const trunc = Math.trunc;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface ResearchContext {
  isHuman: boolean;
  /** 0 Chieftain … 5 Deity. */
  difficulty: number;
  turn: number;
  /** Advances known by the civilization everyone is measured against (the human player). */
  leaderAdvances: number;
  /** Number of advances the rules make reachable (`reachableAdvanceCount`). */
  reachableAdvances: number;
  /** @COSMIC tech paradigm (10 = normal). */
  techParadigm: number;
  /** Scenario parameters in effect (options byte 8 bit 7); their paradigm replaces the cosmic one. */
  scenario?: { techParadigm: number; fixedCost: boolean };
  /** Options byte 8 bit 2: research costs 25 % more. */
  researchDearer?: boolean;
  /** Options byte 8 bit 3: research costs 20 % less. */
  researchCheaper?: boolean;
}

/** Advances whose first prerequisite is not `no` in the rules (VERIFIED: the loader's rule). */
export function reachableAdvanceCount(rules: EngineRules): number {
  return rules.advances.filter((a) => a.preq1.kind !== 'never').length;
}

/** Beakers needed for the next advance of a civilization that knows `advancesKnown` (VERIFIED). */
export function researchCost(advancesKnown: number, ctx: ResearchContext): number {
  const n = advancesKnown < 2 ? 1 : advancesKnown;
  const d = clamp(ctx.difficulty, 0, 4);
  let k = ctx.isHuman ? 2 * d + 6 : 14 - d;
  const scen = ctx.scenario;
  if (!scen || !scen.fixedCost) {
    const leader = ctx.leaderAdvances;
    if (n < leader) {
      if (ctx.difficulty !== 0) k -= 1;
      if (ctx.difficulty === 5 && n + 4 < leader && ctx.turn > 150) k -= 1;
    } else {
      k += trunc((n - leader) / 3);
    }
    if (n > 19) k += clamp(n - trunc(ctx.turn / 8), 0, 6);
  }
  if (!scen) {
    if (ctx.techParadigm !== 10) k = trunc((ctx.techParadigm * k) / 10);
  } else if (scen.techParadigm !== 10) {
    k = trunc((scen.techParadigm * k) / 10);
  }
  let bonus = trunc((k * 3) / 4);
  if (advancesKnown < 20) bonus = trunc((advancesKnown * bonus) / 20);
  k += bonus;
  if (ctx.reachableAdvances > BASELINE_ADVANCE_COUNT) {
    k = trunc((k * BASELINE_ADVANCE_COUNT) / ctx.reachableAdvances);
  }
  if (ctx.researchDearer) k = trunc((k * 5) / 4);
  if (ctx.researchCheaper) k = trunc((k * 4) / 5);
  if (ctx.isHuman && k < 11 - n) k = 11 - n;
  const cost = n * k;
  return cost < 1 || cost > 32000 ? 32000 : cost;
}

export interface ScienceIncomeContext {
  isHuman: boolean;
  difficulty: number;
  /** Per advance: nonzero when some civilization has already discovered it. */
  firstDiscoveredBy: readonly number[];
  /** AI only: the spaceship race is on for this civilization. */
  aiSpaceRace?: boolean;
}

/**
 * Science a city contributes to its civilization this turn (VERIFIED):
 * doubled for a Chieftain human researching an advance someone already knows, doubled for an AI
 * above Warlord that is in the spaceship race but lacks a spaceship part's prerequisite, and
 * discarded entirely under Anarchy.
 */
export function cityScienceToCiv(
  rules: EngineRules,
  civ: Civ,
  cityScience: number,
  ctx: ScienceIncomeContext,
): number {
  let s = cityScience;
  const r = civ.researching;
  if (
    ctx.isHuman &&
    ctx.difficulty === 0 &&
    r !== null &&
    r !== FUTURE_TECHNOLOGY &&
    (ctx.firstDiscoveredBy[r] ?? 0) !== 0
  ) {
    s <<= 1;
  }
  if (!ctx.isHuman && ctx.difficulty > 1 && ctx.aiSpaceRace) {
    for (let imp = 35; imp <= 37; imp++) {
      const prereq = advanceIndex(rules.improvements[imp]?.preq);
      if (prereq !== null && !civ.knownAdvances[prereq]) {
        s <<= 1;
        break;
      }
    }
  }
  return civ.government === 0 ? 0 : s;
}

export type ResearchEvent =
  { kind: 'discovered'; advance: number; free: boolean } | { kind: 'choose-research' };

/**
 * Add beakers (VERIFIED): on reaching the cost the advance is granted; a pending free advance
 * (Philosophy) is granted right after; beakers with nothing chosen ask for a research target.
 * The caller handles 'choose-research' and sets `civ.researching`; discovery of the chosen
 * advance happens on the next call with enough beakers stored.
 */
export function addScience(civ: Civ, amount: number, cost: (civ: Civ) => number): ResearchEvent[] {
  const events: ResearchEvent[] = [];
  if (amount <= 0) return events;
  civ.scienceStored += amount;
  if (civ.researching !== null) {
    if (cost(civ) <= civ.scienceStored) {
      const advance = civ.researching;
      grantAdvance(civ, advance, 'research');
      events.push({ kind: 'discovered', advance, free: false });
    }
    if (civ.freeAdvancePending) {
      civ.freeAdvancePending = false;
      events.push({ kind: 'choose-research' });
    }
  }
  if (civ.scienceStored !== 0 && civ.researching === null) events.push({ kind: 'choose-research' });
  return events;
}

/**
 * Give a civilization an advance (VERIFIED for the bookkeeping here). Beakers reset to zero
 * only when it was researched; an advance gained any other way keeps them. Future Technology
 * raises its own counter; the advances count rises for every discovery (INFERRED — the
 * add-advance routine itself is not yet read).
 */
export function grantAdvance(civ: Civ, advance: number, source: 'research' | 'other'): void {
  if (source === 'research') civ.scienceStored = 0;
  civ.researching = null;
  if (advance === FUTURE_TECHNOLOGY) civ.futureTechs += 1;
  else civ.knownAdvances[advance] = true;
  civ.advancesCount += 1;
}

export interface AiRateContext {
  turn: number;
  /** Any city of the civilization is in disorder this turn. */
  anyDisorder: boolean;
  /** Any city of size 6 or more whose turn result was zero (INFERRED: a quiet large city). */
  anyLargeContentCity: boolean;
  /** The leader's RULES @LEADERS "civilize" personality value (−1, 0, 1). */
  civilize: number;
  /** Still expanding: a continent plan in the expansion states for some continent it holds. */
  expanding: boolean;
  /** Known advances include everything needed for the spaceship (see rules-research.md). */
  knowsAllSpaceAdvances: boolean;
}

export interface Rates {
  science: number;
  tax: number;
  luxuries: number;
}

/** The AI's rate policy at the start of its turn (VERIFIED). Rates are tenths. */
export function aiRates(civ: Civ, ctx: AiRateContext): Rates {
  let lux = 10 - (civ.scienceRate + civ.taxRate);
  if (ctx.anyDisorder && lux < 4) lux += 1;
  if ((ctx.turn & 3) === 0 && !ctx.anyDisorder && !ctx.anyLargeContentCity && lux > 2) lux -= 1;
  lux = clamp(lux, 0, 4);
  let science = ctx.civilize + ((10 - lux) >> 1);
  if (civ.treasury > ctx.turn + 100) science += 1;
  if (civ.treasury > 2000) science += 1;
  if (civ.treasury > 8000) science = 10 - lux;
  if (!ctx.expanding && science < 7) science += 1;
  let cap = 6;
  if (civ.government > 1) cap = 7;
  if (civ.government > 4) cap = 8;
  if (civ.government > 5) cap = 10;
  cap = Math.min(cap, 10 - lux);
  science = clamp(science, 0, cap);
  if (ctx.knowsAllSpaceAdvances) science = 0;
  return { science, luxuries: lux, tax: 10 - (science + lux) };
}
