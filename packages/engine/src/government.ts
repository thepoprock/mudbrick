/**
 * Governments: which a civilization may adopt, how the computer chooses one, revolutions and
 * the end of anarchy.
 *
 * Ported from the original's government picker (0x0051278c, run for computer players every
 * eighth turn from the strategic layer), its allowed-government test (0x0050f468), the change
 * routine (0x0050f88e → 0x0050f257), the per-city and per-civilization score accumulation
 * (city turn 0x004bc513, civilization turn 0x00467c61) and the anarchy rule of the per-turn
 * routine 0x0051326d. VERIFIED unless marked INFERRED. docs/engine/diplomacy.md.
 */
import { clearTreaty, TREATY, WONDER } from './diplomacy.js';
import { GOVERNMENT, IMPROVEMENT, type EngineRules } from './rules.js';
import type { City, Civ, World } from './world.js';

/** Advance each government needs (RULES @CIVILIZE indices the original hard-codes). */
export const GOVERNMENT_ADVANCE: Record<number, number> = {
  2: 54, // Monarchy
  3: 15, // Communism
  4: 31, // Fundamentalism
  5: 71, // The Republic
  6: 21, // Democracy
};

export interface GovernmentEvent {
  kind: 'government';
  text: string;
  slot: number;
  /** The human must pick a government (anarchy has ended). */
  choose?: boolean;
}

export function governmentScoresOf(civ: Civ): Int16Array {
  civ.governmentScores ??= new Int16Array(7);
  return civ.governmentScores;
}

/** May the civilization adopt government g (0x0050f468)? Despotism always; the rest need
 * their advance or the Statue of Liberty; Fundamentalism also needs the rules to allow it. */
export function governmentAllowed(
  g: number,
  knows: (advance: number) => boolean,
  ownsStatue: boolean,
  fundamentalismAllowed = true,
): boolean {
  if (g <= 1) return true;
  const advance = GOVERNMENT_ADVANCE[g];
  if (advance === undefined) return false;
  if (!knows(advance) && !ownsStatue) return false;
  if (g === 4 && !fundamentalismAllowed) return false;
  return true;
}

/** The civilization turn starts every score at zero (0x00467c61). */
export function resetGovernmentScores(civ: Civ): void {
  governmentScoresOf(civ).fill(0);
}

export interface CityGovernmentFacts {
  foodProduced: number;
  foodEaten: number;
  /** Units the city supports (INFERRED: the original's per-city support count). */
  unitsSupported: number;
  /** Military units away from home that cause unhappiness. */
  unitsAway: number;
}

/**
 * Each city adds to the scores (0x004bc513): a food shortfall and support beyond Monarchy's
 * free units count against the current state (score 0); each government loses the support it
 * would have to pay; Republic and Democracy lose war weariness scaled by the civilization's
 * civilize personality and the city's happiness buildings.
 */
export function cityGovernmentScores(
  rules: EngineRules,
  civ: Civ,
  city: City,
  facts: CityGovernmentFacts,
  ownsWonder: (improvement: number) => boolean,
  personality: { attack: number; civilize: number },
  shakespearesHere: boolean,
): void {
  const s = governmentScoresOf(civ);
  if (facts.foodProduced < facts.foodEaten)
    s[0] = (s[0] ?? 0) + (facts.foodEaten - facts.foodProduced) * 5;
  s[0] =
    (s[0] ?? 0) +
    Math.max(0, Math.min(city.size, facts.unitsSupported - rules.cosmic.monarchyFreeUnits));
  const free: Record<number, number> = {
    1: city.size,
    2: rules.cosmic.monarchyFreeUnits,
    3: rules.cosmic.communismFreeUnits,
    4: rules.cosmic.fundamentalismFreeUnits,
    5: 0,
    6: 0,
  };
  for (let g = 1; g < 7; g++) {
    const threshold = free[g] ?? 0;
    if (threshold < facts.unitsSupported) s[g] = (s[g] ?? 0) - (facts.unitsSupported - threshold);
  }
  const suffrage =
    ownsWonder(WONDER.womensSuffrage) || city.improvements[IMPROVEMENT.policeStation] === true
      ? 1
      : 0;
  let weariness = 7 - personality.civilize;
  if (city.improvements[IMPROVEMENT.marketplace]) weariness = 5 - personality.civilize;
  if (city.improvements[IMPROVEMENT.bank]) weariness -= 1;
  if (
    city.improvements[IMPROVEMENT.temple] &&
    (city.improvements[IMPROVEMENT.cathedral] || ownsWonder(WONDER.michelangelos))
  )
    weariness -= 1;
  if (!shakespearesHere) {
    const away = personality.attack + facts.unitsAway;
    s[6] = (s[6] ?? 0) - Math.max(0, Math.min(99, (2 - suffrage) * (away + 1))) * weariness;
    s[5] = (s[5] ?? 0) - Math.max(0, Math.min(99, away * (1 - suffrage))) * weariness;
  }
}

export interface CivGovernmentContext {
  isHuman: boolean;
  knows: (advance: number) => boolean;
  ownsWonder: (improvement: number) => boolean;
  personality: { attack: number; civilize: number };
  /** The original's per-civilization "control" byte (INFERRED: 7 human, else difficulty). */
  control: number;
  advances: number;
  treasury: number;
  /** The leading human: diplomats and spies fielded, advances, treasury, government, control. */
  mainHuman: {
    diplomatsAndSpies: number;
    advances: number;
    treasury: number;
    government: number;
    control: number;
  } | null;
  spaceshipLaunched: boolean;
  anyHumanSpaceshipLaunched: boolean;
  difficulty: number;
  bloodlust: boolean;
  scienceRate: number;
}

/** After the cities, the civilization turn adjusts the scores (0x00467c61). */
export function civGovernmentScores(civ: Civ, ctx: CivGovernmentContext): void {
  const s = governmentScoresOf(civ);
  s[0] = (s[0] ?? 0) + (s[1] ?? 0) * 2;
  if (ctx.isHuman) return;
  const h = ctx.mainHuman;
  // Democracy's immunity to incited revolt: the more diplomats and spies the leading human
  // fields, the more a computer player values it (the original's +0x1c count is INFERRED 0).
  let c = 0;
  if ((ctx.knows(21) || ctx.ownsWonder(WONDER.statueOfLiberty)) && h?.government === 4) c = 1;
  if (h) {
    s[6] = (s[6] ?? 0) + h.diplomatsAndSpies * c;
    if (ctx.treasury < h.treasury) s[6] = (s[6] ?? 0) + 10;
  }
  if (
    c === 0 &&
    (ctx.knows(15) || ctx.knows(31) || ctx.ownsWonder(WONDER.statueOfLiberty)) &&
    ctx.control <= ctx.personality.attack + (4 - (ctx.anyHumanSpaceshipLaunched ? 1 : 0)) &&
    h !== null &&
    ctx.advances < h.advances
  ) {
    s[6] = 0;
    s[5] = 0;
  }
  if (ctx.personality.attack >= 0) {
    if (
      h === null ||
      ctx.personality.attack === 1 ||
      (ctx.personality.attack === 0 && ctx.personality.civilize < 0)
    ) {
      s[6] = Math.trunc(((s[6] ?? 0) * 3) / 4);
      s[5] = Math.trunc(((s[5] ?? 0) * 3) / 4);
    }
    if (ctx.personality.attack !== 0 || (ctx.personality.civilize < 0 && c === 0)) {
      const k = ctx.personality.attack * 2 - ctx.personality.civilize;
      if (h && (ctx.control >= h.control - 1 || h.advances <= ctx.advances)) {
        if (ctx.advances + k * 4 < h.advances) {
          if (h.advances <= ctx.advances + k * 8) {
            s[6] = Math.trunc((s[6] ?? 0) / 2);
            s[5] = Math.trunc((s[5] ?? 0) / 2);
          }
        } else {
          s[6] = 0;
          s[5] = 0;
        }
      }
    }
  }
  if (ctx.spaceshipLaunched && ctx.difficulty > 3) {
    s[6] = Math.trunc((s[6] ?? 0) / 2);
    s[5] = Math.trunc((s[5] ?? 0) / 2);
  }
  if (ctx.bloodlust && ctx.scienceRate === 0) {
    s[6] = 0;
    if (ctx.personality.attack >= 0) s[5] = 0;
  }
}

/** Change government at once (0x0050f257): going into anarchy, or any change by a computer
 * player, clears every vendetta. */
export function changeGovernment(world: World, civ: Civ, g: number, isHuman: boolean): void {
  const before = civ.government;
  civ.government = g;
  if (g !== before && (g === 0 || !isHuman)) {
    for (let j = 0; j < 8; j++)
      if (j !== civ.slot) clearTreaty(world, civ.slot, j, TREATY.vendetta);
  }
}

/**
 * The computer picks a government (0x0051278c): among the allowed ones up to a ceiling (6; 5,
 * or 4 two times in three, after a sneak attack; 3 when the current state scores above 0, and
 * only Despotism then unless already a Democracy), the highest score wins (later ties win).
 */
export function aiPickGovernment(
  world: World,
  civ: Civ,
  ctx: {
    knows: (advance: number) => boolean;
    ownsStatue: boolean;
    sneakAttack?: boolean;
    nextInt: (n: number) => number;
    fundamentalismAllowed?: boolean;
  },
): number | null {
  const s = governmentScoresOf(civ);
  let max = 6;
  if (ctx.sneakAttack) max = ctx.nextInt(3) !== 0 ? 4 : 5;
  if ((s[0] ?? 0) > 0) max = civ.government < 6 ? 1 : 3;
  let best = -999;
  let pick = 1;
  for (let g = 1; g <= max; g++) {
    if (!governmentAllowed(g, ctx.knows, ctx.ownsStatue, ctx.fundamentalismAllowed)) continue;
    if ((s[g] ?? 0) >= best) {
      best = s[g] ?? 0;
      pick = g;
    }
  }
  if (pick === civ.government) return null;
  changeGovernment(world, civ, pick, false);
  return pick;
}

/** A human starts a revolution: anarchy now, a choice when it ends. */
export function startRevolution(world: World, civ: Civ): void {
  changeGovernment(world, civ, GOVERNMENT.anarchy, true);
  civ.civFlags = (civ.civFlags ?? 0) | 1;
}

/**
 * Anarchy ends (0x0051326d): for a computer player on a turn divisible by four, or at once with
 * the Statue of Liberty, into Despotism; for a human on the same turns the choice is offered —
 * not on the turn the revolution began.
 */
export function anarchyTurn(
  world: World,
  civ: Civ,
  ctx: { turn: number; isHuman: boolean; ownsStatue: boolean },
  events: GovernmentEvent[],
): void {
  if (civ.government !== GOVERNMENT.anarchy) return;
  const due = (ctx.turn & 3) === 0 || ctx.ownsStatue;
  if (!ctx.isHuman) {
    if (due) {
      changeGovernment(world, civ, GOVERNMENT.despotism, false);
      events.push({ kind: 'government', text: `${civ.name} settle for Despotism`, slot: civ.slot });
    }
    return;
  }
  if (((civ.civFlags ?? 0) & 1) !== 0) {
    civ.civFlags = (civ.civFlags ?? 0) & ~1;
    if (!ctx.ownsStatue) return;
  }
  if (due)
    events.push({
      kind: 'government',
      text: `the anarchy in ${civ.name} ends: choose a government`,
      slot: civ.slot,
      choose: true,
    });
}
