/**
 * What happens to a city once its citizens are counted: disorder, order restored, revolution,
 * celebration and rapture growth, gold into the treasury — and the shield-shortage disband.
 *
 * Specification: docs/engine/rules-city.md ("Disorder, celebration and gold", VERIFIED
 * 0x004bafef; "Shields and unit support", VERIFIED structure 0x004ba99a).
 */
import {
  boxRows,
  distance,
  growthBlocker,
  shieldTotals,
  unitSupport,
  type CityContext,
  gridDistance,
} from './city.js';
import { FUTURE_TECHNOLOGY } from './research.js';
import { advanceIndex, GOVERNMENT, type EngineRules, DOMAIN_GROUND } from './rules.js';
import { SquareFlag, type City, type Civ, type Unit, type World } from './world.js';

export type CityEvent =
  | { kind: 'disorder' }
  | { kind: 'restored' }
  | { kind: 'revolt' }
  | { kind: 'gold'; gold: number }
  | { kind: 'celebration-start' }
  | { kind: 'celebration-end' }
  | { kind: 'rapture-growth' }
  | { kind: 'disbanded-for-shortage'; unit: Unit; shieldsRefunded: number }
  | { kind: 'disbanded-for-disorder'; unit: Unit };

export interface MoodOutcomeInputs {
  happy: number;
  unhappy: number;
  shieldSurplus: number;
  foodSurplus: number;
  /** Food the worked squares produced (routes already subtracted). */
  foodProduced: number;
  /** Citizens' food plus the settlers' food. */
  foodEaten: number;
  /** The city's tax after the trade split and building bonuses. */
  tax: number;
}

/**
 * Apply the disorder / celebration / gold rules (VERIFIED against 0x004bafef: disorder on
 * happy < unhappy, a human Democracy's revolt on the second turn of it, order restored and the
 * tax banked otherwise except under Anarchy; celebration with no unhappy citizen, size above 2
 * and happy at least half the size rounded up, rapture growth under a senate with food to spare
 * and nothing blocking growth). Mutates `city` and `civ`.
 */
export function applyCityMood(
  rules: EngineRules,
  civ: Civ,
  city: City,
  m: MoodOutcomeInputs,
  opts: { allowRevolt: boolean },
): CityEvent[] {
  const events: CityEvent[] = [];
  if (city.owner === 0) return events; // barbarians have no mood
  const d = m.happy - m.unhappy;
  if (d < 0) {
    if (!city.inDisorder) {
      city.inDisorder = true;
      city.disorderRepeated = false;
      events.push({ kind: 'disorder' });
    } else {
      city.disorderRepeated = true;
      if (civ.isHuman && civ.government === GOVERNMENT.democracy && opts.allowRevolt) {
        civ.government = GOVERNMENT.anarchy;
        events.push({ kind: 'revolt' });
      }
    }
  } else {
    if (city.inDisorder) {
      city.inDisorder = false;
      city.disorderRepeated = false;
      events.push({ kind: 'restored' });
    }
    if (civ.government !== GOVERNMENT.anarchy) {
      civ.treasury += m.tax;
      events.push({ kind: 'gold', gold: m.tax });
    }
  }
  const halfUp = (city.size + 1) >> 1;
  if (
    m.unhappy === 0 &&
    city.size > 2 &&
    halfUp <= m.happy &&
    civ.government !== GOVERNMENT.anarchy
  ) {
    if (!city.celebrating) {
      city.celebrating = true;
      events.push({ kind: 'celebration-start' });
    } else if (
      civ.government > GOVERNMENT.fundamentalism &&
      m.foodEaten < m.foodProduced &&
      growthBlocker(rules, city) === 0
    ) {
      city.size += 1;
      events.push({ kind: 'rapture-growth' });
    }
  } else if (city.celebrating) {
    city.celebrating = false;
    events.push({ kind: 'celebration-end' });
  }
  return events;
}

/**
 * Disband supported units while they cost more shields than the city makes (VERIFIED
 * structure): the farthest unit goes first, preferring one not sitting in a city or a fortress
 * near one; a unit disbanded inside the city refunds half its cost to the production box.
 */
export function disbandForShortage(
  world: World,
  rules: EngineRules,
  city: City,
  ctx: CityContext,
  baseShields: number,
): CityEvent[] {
  const events: CityEvent[] = [];
  for (;;) {
    const homed = world.units.filter((u) => u.homeCity === city.id);
    const support = unitSupport(world, rules, city, ctx, homed);
    const totals = shieldTotals(rules, city, ctx, baseShields, support.shields);
    if (totals.surplus >= 0) return events;
    const candidates = homed.filter((u) => (rules.units[u.type]?.role ?? 9) <= 5);
    if (candidates.length === 0) return events;
    const safe = (u: Unit) =>
      world.cityAt(u.position.x, u.position.y) !== undefined ||
      (world.hasFlag(u.position.x, u.position.y, SquareFlag.Fortress) &&
        world.cities.some(
          (c) => c.owner === city.owner && gridDistance(world, c.position, u.position) < 4,
        ));
    candidates.sort((a, b) => {
      const sa = safe(a) ? 1 : 0;
      const sb = safe(b) ? 1 : 0;
      if (sa !== sb) return sa - sb;
      return (
        distance(world, city.position, b.position) - distance(world, city.position, a.position)
      );
    });
    const victim = candidates[0];
    if (!victim) return events;
    world.units.splice(world.units.indexOf(victim), 1);
    let refund = 0;
    if (victim.position.x === city.position.x && victim.position.y === city.position.y) {
      refund = ((rules.units[victim.type]?.costRows ?? 0) * boxRows(rules, ctx, true)) >> 1;
      city.shieldsStored += refund;
    }
    events.push({ kind: 'disbanded-for-shortage', unit: victim, shieldsRefunded: refund });
  }
}

/**
 * VERIFIED (0x004ba99a, the branch beside the shortage): a computer player's city in disorder
 * under the Republic or Democracy, when `(turn + index) & 7 == 0` for one of its supported units,
 * disbands its farthest supported land unit of the first five roles that stands outside every
 * city and not in a fortress within three squares of an own city — and the disorder flag goes
 * with it, so at most one unit a turn. (The veto of both senate governments when a human leads
 * in advances, under options byte 8 bit 0, is not modelled.)
 */
export function disbandForDisorder(
  world: World,
  rules: EngineRules,
  city: City,
  ctx: { turn: number; isHuman: boolean; government: number },
): CityEvent[] {
  if (ctx.isHuman || ctx.government < GOVERNMENT.republic || !city.inDisorder) return [];
  const homed = world.units.filter(
    (u) => u.homeCity === city.id && (rules.units[u.type]?.role ?? 9) <= 5,
  );
  if (!homed.some((u) => ((ctx.turn + u.id) & 7) === 0)) return [];
  let victim: Unit | null = null;
  let farthest = 0;
  for (const u of homed) {
    const type = rules.units[u.type];
    if (!type || type.role > 4 || type.domain !== DOMAIN_GROUND) continue;
    if (world.cityAt(u.position.x, u.position.y)) continue;
    if (
      world.hasFlag(u.position.x, u.position.y, SquareFlag.Fortress) &&
      world.cities.some(
        (c) => c.owner === city.owner && gridDistance(world, c.position, u.position) < 4,
      )
    )
      continue;
    const d = distance(world, city.position, u.position);
    if (d > farthest) {
      farthest = d;
      victim = u;
    }
  }
  if (!victim) return [];
  world.units.splice(world.units.indexOf(victim), 1);
  city.inDisorder = false;
  return [{ kind: 'disbanded-for-disorder', unit: victim }];
}

/** Advances a civilization may research now: unknown, reachable, prerequisites known. */
export function researchableAdvances(rules: EngineRules, civ: Civ): number[] {
  const out: number[] = [];
  const known = (ref: { kind: string; index?: number }) => {
    const i = advanceIndex(ref as Parameters<typeof advanceIndex>[0]);
    return ref.kind === 'none' || (i !== null && civ.knownAdvances[i] === true);
  };
  for (let a = 0; a < rules.advances.length; a++) {
    const adv = rules.advances[a];
    if (!adv || adv.preq1.kind === 'never') continue;
    if (a !== FUTURE_TECHNOLOGY && civ.knownAdvances[a]) continue;
    if (known(adv.preq1) && known(adv.preq2)) out.push(a);
  }
  return out;
}
