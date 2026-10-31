/**
 * Pollution: a city's pollution value, the per-turn roll that dirties a square, and nuclear
 * meltdowns.
 *
 * Specification: docs/engine/rules-city.md — the value is VERIFIED (0x004b5686) and the roll and
 * meltdown are VERIFIED (0x004bb7bb). The original rolls only for human cities inside the city
 * turn; the engine rolls for every city (INFERRED for computer players).
 */
import type { Rng } from './rng.js';
import { ADVANCE, IMPROVEMENT } from './rules.js';
import { CITY_CENTRE_INDEX, OCEAN, SquareFlag, type City, type World } from './world.js';

export interface PollutionContext {
  knows: (advance: number) => boolean;
  /** The civilization's advances count (drives the tech-pollution threshold). */
  advancesCount: number;
  difficulty: number;
  /** Scenario "eliminate pollution" flag. */
  eliminatePollution?: boolean;
}

/** Divisor applied to production pollution by power and recycling buildings (VERIFIED). */
export function pollutionDivisor(city: City): number {
  const imp = city.improvements;
  let d = 1;
  if (imp[IMPROVEMENT.hydroPlant] || imp[IMPROVEMENT.nuclearPlant]) d = 2;
  if (imp[IMPROVEMENT.recyclingCenter]) d = 3;
  if (imp[IMPROVEMENT.solarPlant]) d = 3;
  return d;
}

/** The city's pollution value shown on its screen (VERIFIED): production part + size × tech factor / 4. */
export function cityPollution(
  city: City,
  shieldsProduced: number,
  ctx: PollutionContext,
  hooverDam = false,
): number {
  const imp = city.improvements;
  const divisor = hooverDam && pollutionDivisor(city) < 2 ? 2 : pollutionDivisor(city);
  let production = Math.trunc(shieldsProduced / divisor) - 20;
  if (imp[IMPROVEMENT.solarPlant]) production = 0;
  if (production < 0) production = 0;
  let tech = 0;
  if (!imp[IMPROVEMENT.massTransit]) {
    const known = [
      ADVANCE.industrialization,
      ADVANCE.automobile,
      ADVANCE.massProduction,
      ADVANCE.plastics,
    ].filter((a) => ctx.knows(a)).length;
    tech = known;
    if (known > 0 && !ctx.knows(ADVANCE.sanitation)) tech += 1;
    if (ctx.knows(ADVANCE.environmentalism)) tech -= 1;
    if (imp[IMPROVEMENT.solarPlant]) tech -= 1;
    if (tech < 0) tech = 0;
  }
  return production + Math.trunc((city.size * tech) / 4);
}

export type PollutionEvent =
  { kind: 'polluted'; x: number; y: number } | { kind: 'meltdown'; city: City };

/**
 * The per-turn roll (VERIFIED): `rand() % (256 − threshold) < 2 × pollution` dirties a random
 * radius square that is land, not a city and not yet polluted. `threshold = advances ×
 * difficulty / 2`, halved repeatedly below 256 when the city has a Solar Plant.
 */
export function pollutionRoll(
  world: World,
  rng: Rng,
  city: City,
  pollution: number,
  ctx: PollutionContext,
  counter?: { value: number },
): PollutionEvent | null {
  let threshold = (ctx.advancesCount * ctx.difficulty) >> 1;
  let value = pollution;
  if (ctx.eliminatePollution) {
    threshold = 0;
    value = 0;
  }
  if (city.improvements[IMPROVEMENT.solarPlant])
    while (threshold > 255) threshold = Math.trunc(threshold / 2);
  const span = 256 - threshold;
  const roll = span < 1 ? 0 : rng.nextInt(span);
  if (roll >= value * 2) return null;
  const i = rng.nextInt(20);
  const p = world.radiusSquare(city.position.x, city.position.y, i);
  if (!p || i === CITY_CENTRE_INDEX) return null;
  if (world.cityAt(p.x, p.y) || world.hasFlag(p.x, p.y, SquareFlag.Pollution)) return null;
  if (world.terrainAt(p.x, p.y) === OCEAN) return null;
  world.setFlag(p.x, p.y, SquareFlag.Pollution);
  if (counter) counter.value += 1;
  return { kind: 'polluted', x: p.x, y: p.y };
}

/**
 * Nuclear meltdown (VERIFIED): a city in disorder with a Nuclear Plant whose owner lacks Fusion
 * Power melts down with probability 1 / (6 − difficulty); the plant is lost. The blast itself
 * (0x0052c788) is not yet modelled — the caller decides what to do with the event.
 */
export function meltdownRoll(rng: Rng, city: City, ctx: PollutionContext): PollutionEvent | null {
  if (!city.inDisorder || !city.improvements[IMPROVEMENT.nuclearPlant]) return null;
  if (ctx.knows(ADVANCE.fusionPower)) return null;
  const span = 6 - ctx.difficulty;
  const roll = span < 1 ? 0 : rng.nextInt(span);
  if (roll !== 0) return null;
  city.improvements[IMPROVEMENT.nuclearPlant] = false;
  return { kind: 'meltdown', city };
}
