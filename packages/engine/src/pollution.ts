/**
 * Pollution: a city's pollution value, the per-turn roll that dirties a square, and nuclear
 * meltdowns.
 *
 * Specification: docs/engine/rules-city.md — the value is VERIFIED (0x004b5686) and the roll and
 * meltdown are VERIFIED (0x004bb7bb). The original rolls only for human cities inside the city
 * turn, and so does the game (the roll's one caller is in the human-only branch).
 */
import type { Rng } from './rng.js';
import { ADVANCE, IMPROVEMENT } from './rules.js';
import {
  CITY_CENTRE_INDEX,
  OCEAN,
  SquareFlag,
  type City,
  type World,
  CITY_RADIUS_OFFSETS,
} from './world.js';

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
  | { kind: 'climate'; text: string }
  | { kind: 'polluted'; x: number; y: number }
  | { kind: 'meltdown'; city: City };

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

export interface WarmingState {
  counter: number;
  events: number;
  /** Polluted squares in all (0x005da732). */
  polluted: number;
  /** Those inside computer players' radii, counted in the scoring pass (0x005da730). */
  baseline: number;
}

/**
 * The yearly reckoning (VERIFIED 0x00466e4e): pollution pushes a counter up and Solar Plants and past
 * warming push it down, shared among the humans. Returns 'warn' at 12 with enough pollution, 'warm'
 * past 16.
 */
export function warmingTurn(
  s: WarmingState,
  humans: number,
  solarPlants: number,
): 'warn' | 'warm' | null {
  let dirt = s.polluted - s.baseline + Math.trunc(s.baseline / 2);
  if (humans > 1) dirt = Math.trunc((humans - 1 + dirt) / humans);
  const push = dirt * 2 - s.events * 4 - solarPlants - s.counter;
  if (push >= 1) s.counter += 1;
  else if (push < 0) s.counter -= 1;
  s.counter = Math.max(0, Math.min(99, s.counter));
  s.baseline = 0;
  if (s.counter > 16) {
    s.counter = 0;
    s.events += 1;
    return 'warm';
  }
  return s.counter === 12 && dirt > 6 ? 'warn' : null;
}

/**
 * The climate changes (VERIFIED 0x00466b1b), event `n` counting from 0: desert, plains, grassland
 * and forest far from the sea go, one in eight squares, to desert or plains; near the sea they
 * become swamp or, from forest, jungle, and lose irrigation and mines.
 */
export function globalWarming(world: World, n: number): void {
  for (let i = 0; i < world.area; i++) {
    const t = world.terrain[i] ?? OCEAN;
    if (t >= 4) continue;
    const { x, y } = world.position(i);
    let sea = 0;
    for (const off of CITY_RADIUS_OFFSETS) {
      const py = y + off.y;
      const px = py >= 0 && py < world.rows ? world.wrapX(x + off.x, py) : null;
      if (px !== null && world.terrainAt(px, py) === OCEAN) sea += 1;
    }
    if (sea < 7 - n) {
      if (((x * 3 - y * 3) & 7) === n) {
        if (world.visited[i] === 15) world.visited[i] = 0;
        world.terrain[i] = t < 2 ? 0 : 1;
      }
    } else {
      if (world.visited[i] === 15) world.visited[i] = 0;
      world.terrain[i] = t === 3 ? 9 : 8;
      world.setFlag(x, y, SquareFlag.Irrigation, false);
      world.setFlag(x, y, SquareFlag.Mine, false);
    }
  }
}
