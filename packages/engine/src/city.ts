/**
 * City economy and happiness.
 *
 * Specification: docs/engine/rules-city.md — VERIFIED against the original executable's
 * per-city turn code: square yields, shield multipliers, waste, corruption, the trade split,
 * happiness, unit support, growth and starvation. The arithmetic mirrors the original's integer
 * operations. Production completion is still INFERRED (0x004b7e74 not yet read).
 */
import {
  DOMAIN_AIR,
  DOMAIN_GROUND,
  DOMAIN_SEA,
  GOVERNMENT,
  IMPROVEMENT,
  ADVANCE,
  type EngineRules,
} from './rules.js';
import { grasslandShieldAt, specialAt } from './terrainSpecials.js';
import { CITY_CENTRE_INDEX, OCEAN, SquareFlag, type City, type Unit, type World } from './world.js';

/** Facts about the owning civilization and the game that the city rules need. */
export interface CityContext {
  government: number;
  difficulty: number;
  isHuman: boolean;
  /** Cities owned by the civilization. */
  cityCount: number;
  /** Rates in tenths. Luxuries are the remainder. */
  scienceRate: number;
  taxRate: number;
  knows: (advance: number) => boolean;
  /** Civilization-wide wonder ownership (any of its cities holds it). */
  ownsWonder: (improvement: number) => boolean;
  /** Squares to the nearest own city holding the Palace; 32 when none. */
  distanceToCapital: number;
  /** 0 … 2: 1 for the capital itself (2 with Railroad), per 0x004b33d7. */
  connectedToCapital: number;
  /** Scenario "double production" flag. */
  doubleProduction?: boolean;
  /** Options word bit 4 (simplified combat off) — unused here, kept for parity. */
  damageMatters?: boolean;
}

export type YieldKind = 0 | 1 | 2; // food, shields, trade
export const FOOD: YieldKind = 0;
export const SHIELDS: YieldKind = 1;
export const TRADE: YieldKind = 2;

const halfMore = (x: number) => x + (x >> 1);

/** Settlers' food under the current government (@COSMIC[5] up to Monarchy, [6] from Communism). */
export function settlersFood(rules: EngineRules, government: number): number {
  return government <= GOVERNMENT.monarchy
    ? rules.cosmic.settlersFoodEarlyGovt
    : rules.cosmic.settlersFoodLateGovt;
}

/** Rows per food-box step: @COSMIC[3] for humans, a difficulty ladder for the AI (0x004b3924). */
export function boxRows(
  rules: EngineRules,
  ctx: { isHuman: boolean; difficulty: number },
  shields: boolean,
): number {
  const base = shields ? rules.cosmic.shieldBoxRows : rules.cosmic.foodBoxRows;
  if (ctx.isHuman) return base;
  let k = 13 - ctx.difficulty;
  if (ctx.difficulty < 3) k += 1;
  if (ctx.difficulty === 0) k += 1;
  if (base !== 10) {
    k = Math.floor((base * k) / 10);
    if (k & 1) k += 1;
  }
  return k;
}

export function foodBox(rules: EngineRules, ctx: CityContext, size: number): number {
  return (size + 1) * boxRows(rules, ctx, false);
}

/** Improvement index that blocks growth at this size, or 0 (0x00430ac9). */
export function growthBlocker(rules: EngineRules, city: City): number {
  if (city.size >= rules.cosmic.aqueductSize && !city.improvements[IMPROVEMENT.aqueduct]) {
    return IMPROVEMENT.aqueduct;
  }
  if (city.size >= rules.cosmic.sewerSize && !city.improvements[IMPROVEMENT.sewerSystem]) {
    return IMPROVEMENT.sewerSystem;
  }
  return 0;
}

/** Yield of radius square `i` of a city for one kind (0x004b4102). Off-map squares yield 0. */
export function squareYield(
  world: World,
  rules: EngineRules,
  city: City,
  i: number,
  kind: YieldKind,
  ctx: CityContext,
): number {
  const p = world.radiusSquare(city.position.x, city.position.y, i);
  if (!p) return 0;
  const si = world.index(p.x, p.y);
  const terrain = world.terrain[si] ?? OCEAN;
  const flags = world.flags[si] ?? 0;
  const t = rules.terrain[terrain];
  if (!t) return 0;
  const special = specialAt(world, p.x, p.y);
  const row = special === 0 ? t : (t.specials[special - 1] ?? t);
  let v = kind === FOOD ? row.food : kind === SHIELDS ? row.shields : row.trade;
  if (ctx.doubleProduction) v <<= 1;
  const isCentre = i === CITY_CENTRE_INDEX;
  const irrigated = (flags & (SquareFlag.Irrigation | SquareFlag.Farmland)) !== 0 || isCentre;
  const farmland = (flags & SquareFlag.Farmland) !== 0 || isCentre;
  const mined = (flags & SquareFlag.Mine) !== 0;
  const road = (flags & (SquareFlag.Road | SquareFlag.Railroad)) !== 0 || isCentre;
  const rail = (flags & SquareFlag.Railroad) !== 0;
  const river = (flags & SquareFlag.River) !== 0;

  if (terrain === OCEAN) {
    if (kind === FOOD && city.improvements[IMPROVEMENT.harbour]) v += 1;
    if (kind === SHIELDS && city.improvements[IMPROVEMENT.offshorePlatform]) v += 1;
    if (kind === TRADE && city.improvements[IMPROVEMENT.colossus]) v += 1;
  } else if (kind === FOOD) {
    if (irrigated) {
      v += t.irrigateBonus;
      if (city.improvements[IMPROVEMENT.supermarket] && farmland) v = halfMore(v);
    }
  } else if (kind === SHIELDS) {
    if (
      (mined && !((flags & SquareFlag.Irrigation) !== 0)) ||
      (isCentre && t.irrigateBonus === 0)
    ) {
      v += t.mineBonus;
    }
    if (terrain === 2 && !grasslandShieldAt(p.x, p.y)) v = 0;
    if (isCentre && v === 0) v = 1;
  } else {
    if (river) v += 1;
    if (road && (terrain < 3 || v !== 0)) v += 1;
    if (v !== 0 && city.improvements[IMPROVEMENT.colossus]) v += 1;
  }

  if (kind === SHIELDS) {
    if (city.improvements[IMPROVEMENT.kingRichards]) v += 1;
    if (rail || (isCentre && ctx.knows(ADVANCE.railroad))) v = halfMore(v);
  }
  if (v > 2 && !city.celebrating && ctx.government < GOVERNMENT.monarchy) v -= 1;
  if (v !== 0 && kind === TRADE) {
    const threshold = city.celebrating ? GOVERNMENT.monarchy : GOVERNMENT.republic;
    if (ctx.government >= threshold) v += 1;
  }
  if (kind === TRADE && road && city.improvements[IMPROVEMENT.superhighways])
    v += Math.floor(v / 2);
  if (flags & SquareFlag.Pollution) v = (v + 1) >> 1;
  return Math.max(0, v);
}

export interface Yields {
  food: number;
  shields: number;
  trade: number;
}

/** Totals over the worked squares, before multipliers, waste and corruption. */
export function rawYields(world: World, rules: EngineRules, city: City, ctx: CityContext): Yields {
  const y: Yields = { food: 0, shields: 0, trade: 0 };
  for (let i = 0; i <= CITY_CENTRE_INDEX; i++) {
    if (((city.worked >> i) & 1) === 0 && i !== CITY_CENTRE_INDEX) continue;
    y.food += squareYield(world, rules, city, i, FOOD, ctx);
    y.shields += squareYield(world, rules, city, i, SHIELDS, ctx);
    y.trade += squareYield(world, rules, city, i, TRADE, ctx);
  }
  for (const r of city.tradeRoutes) if ((r.commodity ?? (r.food ? -1 : 0)) < 0) y.food -= 1;
  // Food routes from other cities feed this one (0x004b6d9c).
  for (const c of world.cities) {
    if (c === city) continue;
    for (const r of c.tradeRoutes)
      if (r.partner === city.id && (r.commodity ?? (r.food ? -1 : 0)) < 0) y.food += 1;
  }
  return y;
}

/** Corruption of `amount` trade (or shields when `forWaste`) — 0x004b530c. */
export function corruption(
  rules: EngineRules,
  city: City,
  ctx: CityContext,
  amount: number,
  forWaste: boolean,
): number {
  if (amount <= 0) return 0;
  if (ctx.government === GOVERNMENT.democracy || ctx.government === GOVERNMENT.fundamentalism)
    return 0;
  let g = ctx.government;
  if (city.celebrating) g += 1;
  const factor = 4 + (g > 0 ? 1 : 0) + (g > 1 ? 1 : 0) + (g > 2 ? 1 : 0) + (g > 4 ? 1 : 0);
  let dist: number;
  if (ctx.government === GOVERNMENT.communism) {
    dist = rules.cosmic.communismPalaceDistance;
  } else {
    dist = ctx.distanceToCapital;
    if (forWaste && dist > 16) dist = 16;
    if (g < 2 && dist !== 0 && ctx.isHuman) dist = Math.min(32, Math.max(0, dist + ctx.difficulty));
  }
  let c = Math.floor((amount * dist * 3) / (factor * 20));
  c = Math.max(0, Math.min(amount, c));
  if (city.improvements[IMPROVEMENT.courthouse] || city.improvements[IMPROVEMENT.palace]) c >>= 1;
  return c;
}

export interface ShieldResult {
  /** Shields after Factory/Power multipliers. */
  produced: number;
  /** Shields lost to waste. */
  waste: number;
  /** Shields spent supporting units. */
  support: number;
  /** Net shields toward production this turn. */
  surplus: number;
  pollutionDivisor: number;
}

/** 0x004b5686 — multipliers and waste. `support` is the shield cost of supported units. */
export function shieldTotals(
  rules: EngineRules,
  city: City,
  ctx: CityContext,
  base: number,
  support: number,
): ShieldResult {
  const imp = city.improvements;
  let f = 0;
  if (imp[IMPROVEMENT.factory]) f = 2;
  if (imp[IMPROVEMENT.manufacturingPlant]) f += 2;
  let p = 0;
  let pollutionDivisor = 1;
  if (imp[IMPROVEMENT.powerPlant]) p = 2;
  if (
    imp[IMPROVEMENT.hydroPlant] ||
    imp[IMPROVEMENT.nuclearPlant] ||
    ctx.ownsWonder(IMPROVEMENT.hooverDam)
  ) {
    p = 2;
    pollutionDivisor = 2;
  }
  if (imp[IMPROVEMENT.recyclingCenter]) pollutionDivisor = 3;
  if (imp[IMPROVEMENT.solarPlant]) {
    p = 2;
    pollutionDivisor = 3;
  }
  if (p > f) p = f;
  let produced = base + ((base * p) >> 2) + ((base * f) >> 2);
  let waste = Math.floor(
    ((3 - ctx.connectedToCapital) * corruption(rules, city, ctx, produced - support, true)) /
      3 /
      ((ctx.government >> 1) + 1),
  );
  waste = Math.min(waste, produced - (support + 1));
  if (waste < 0) waste = 0;
  if (ctx.government === GOVERNMENT.democracy || ctx.government === GOVERNMENT.fundamentalism)
    waste = 0;
  if (
    city.production.kind === 'improvement' &&
    city.production.index === IMPROVEMENT.palace &&
    ctx.distanceToCapital >= 32
  )
    waste = 0;
  produced -= waste;
  return { produced, waste, support, surplus: produced - support, pollutionDivisor };
}

export interface TradeSplit {
  luxuries: number;
  science: number;
  tax: number;
  corruption: number;
}

/** 0x004b5c68 with the corruption of 0x004b6359 applied first. */
export function tradeSplit(
  rules: EngineRules,
  city: City,
  ctx: CityContext,
  trade: number,
): TradeSplit {
  const corrupt = corruption(rules, city, ctx, trade, false);
  const net = trade - corrupt;
  let sci = ctx.scienceRate;
  if (
    ctx.government === GOVERNMENT.fundamentalism &&
    sci > rules.cosmic.fundamentalismMaxScienceRate
  ) {
    sci = rules.cosmic.fundamentalismMaxScienceRate;
  }
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  let lux = clamp(Math.floor(((10 - (ctx.scienceRate + ctx.taxRate)) * net + 4) / 10), 0, net);
  let science = clamp(Math.floor((sci * net + 4) / 10), 0, net - lux);
  let tax = net - (science + lux);
  if (!ctx.isHuman && ctx.government === GOVERNMENT.fundamentalism) {
    science += lux;
    lux = 0;
  }
  lux += city.specialists.entertainers * 2;
  tax += city.specialists.taxCollectors * 3;
  science += city.specialists.scientists * 3;
  if (ctx.government === GOVERNMENT.fundamentalism) {
    science -= Math.floor((rules.cosmic.fundamentalismSciencePenaltyPct * science) / 100);
    tax += contentValueOfBuildings(city, ctx);
  }
  const imp = city.improvements;
  const market =
    (imp[IMPROVEMENT.marketplace] ? 1 : 0) +
    (imp[IMPROVEMENT.bank] ? 1 : 0) +
    (imp[IMPROVEMENT.stockExchange] ? 1 : 0);
  lux += (market * lux) >> 1;
  tax += (market * tax) >> 1;
  const labs =
    (imp[IMPROVEMENT.library] ? 1 : 0) +
    (imp[IMPROVEMENT.university] ? 1 : 0) +
    (imp[IMPROVEMENT.researchLab] || ctx.ownsWonder(IMPROVEMENT.seti) ? 1 : 0);
  let bonus = labs * science;
  if (!imp[IMPROVEMENT.isaacNewtons]) bonus >>= 1;
  science += bonus;
  if (imp[IMPROVEMENT.copernicus]) science <<= 1;
  return { luxuries: lux, science, tax, corruption: corrupt };
}

/** How many unhappy citizens Temple, Colosseum, Cathedral and J. S. Bach's make content (also the Fundamentalist tithe). */
export function contentValueOfBuildings(city: City, ctx: CityContext): number {
  const imp = city.improvements;
  let v = 0;
  if (imp[IMPROVEMENT.temple]) {
    let t = (ctx.knows(ADVANCE.mysticism) ? 1 : 0) + (ctx.knows(ADVANCE.ceremonialBurial) ? 1 : 0);
    if (ctx.ownsWonder(IMPROVEMENT.oracle)) t <<= 1;
    v += t;
  }
  if (imp[IMPROVEMENT.colosseum]) v += 3 + (ctx.knows(ADVANCE.electronics) ? 1 : 0);
  if (
    ctx.knows(ADVANCE.monotheism) &&
    (imp[IMPROVEMENT.cathedral] || ctx.ownsWonder(IMPROVEMENT.michelangelos))
  ) {
    v += (ctx.knows(ADVANCE.communism) ? 0 : 1) + (3 - (ctx.knows(ADVANCE.theology) ? 0 : 1));
  }
  if (ctx.ownsWonder(IMPROVEMENT.jsBachs)) v += 2;
  return v;
}

export interface Mood {
  happy: number;
  content: number;
  unhappy: number;
}

export interface MoodInputs {
  luxuries: number;
  /** Military units in the city (attack > 0), for martial law. */
  militaryInCity: number;
  /** Units counted as "abroad" for Republic/Democracy unhappiness. */
  militaryAbroad: number;
  /** True when no unit of this city is away and none is adjacent (Palace special case). */
  noMilitaryUnhappiness: boolean;
  /** City id holding Shakespeare's Theatre, if any. */
  shakespearesCity?: number;
}

/** 0x004b6359 — the happy/unhappy count. Content = size − specialists − happy − unhappy. */
export function mood(rules: EngineRules, city: City, ctx: CityContext, inputs: MoodInputs): Mood {
  const size = city.size;
  const specialists =
    city.specialists.entertainers + city.specialists.taxCollectors + city.specialists.scientists;
  const workers = Math.max(0, size - specialists);
  let happy = 0;
  let unhappy: number;
  if (!ctx.isHuman) {
    unhappy = size - 1 - (rules.cosmic.unhappinessCitySizeChieftain - 5);
  } else {
    const riot = rules.cosmic.riotFactor - 2 * ctx.difficulty;
    const step = Math.max(1, Math.floor((((ctx.government >> 1) + 2) * riot) / 2));
    let contentBase = rules.cosmic.unhappinessCitySizeChieftain - ctx.difficulty;
    if (contentBase < 3 && city.improvements[IMPROVEMENT.palace] && inputs.noMilitaryUnhappiness)
      contentBase = 2;
    unhappy = size - 1 - (contentBase - 2);
    if (ctx.government !== GOVERNMENT.communism) {
      // C integer division truncates toward zero, so small empires never gain content here.
      unhappy += Math.trunc((ctx.cityCount - step + (city.id % step)) / step);
    }
  }
  let excess = 0;
  if (unhappy > size) {
    excess = unhappy - size;
    unhappy = size;
  }
  if (unhappy < 0) unhappy = 0;

  const clampAll = () => {
    happy = Math.max(0, Math.min(workers, happy));
    while (excess > 0 && unhappy < excess) {
      unhappy += 1;
      excess -= 1;
    }
    unhappy = Math.max(0, Math.min(workers, unhappy));
    while (unhappy + happy > workers) {
      if (excess === 0) happy = Math.max(0, happy - 1);
      else excess -= 1;
      unhappy = Math.max(0, unhappy - 1);
    }
    while (excess > 0 && unhappy + happy < workers) {
      unhappy += 1;
      excess -= 1;
    }
  };

  // Stage 0: luxuries — two per step, unhappy → content first, then content → happy.
  let steps = inputs.luxuries >> 1;
  while (steps > 0 && unhappy > 0) {
    unhappy -= 1;
    steps -= 1;
  }
  while (steps > 0 && happy + unhappy < workers) {
    happy += 1;
    steps -= 1;
  }
  clampAll();

  // Stage 1: buildings.
  const imp = city.improvements;
  if (imp[IMPROVEMENT.colosseum]) unhappy -= 3 + (ctx.knows(ADVANCE.electronics) ? 1 : 0);
  if (
    ctx.knows(ADVANCE.monotheism) &&
    (imp[IMPROVEMENT.cathedral] || ctx.ownsWonder(IMPROVEMENT.michelangelos))
  ) {
    unhappy -= (ctx.knows(ADVANCE.communism) ? 0 : 1) + (3 - (ctx.knows(ADVANCE.theology) ? 0 : 1));
  }
  if (imp[IMPROVEMENT.temple]) {
    let t = (ctx.knows(ADVANCE.mysticism) ? 1 : 0) + (ctx.knows(ADVANCE.ceremonialBurial) ? 1 : 0);
    if (ctx.ownsWonder(IMPROVEMENT.oracle)) t <<= 1;
    unhappy -= t;
  }
  if (
    (imp[IMPROVEMENT.courthouse] || imp[IMPROVEMENT.palace]) &&
    ctx.government === GOVERNMENT.democracy
  )
    happy += 1;
  clampAll();

  // Stage 2: government.
  if (ctx.government === GOVERNMENT.fundamentalism) {
    excess = 0;
    unhappy = 0;
  } else if (ctx.government < GOVERNMENT.republic) {
    const perUnit = ctx.government === GOVERNMENT.communism ? 2 : 1;
    const cap = ctx.government === GOVERNMENT.communism ? 6 : 3;
    const law = Math.min(cap, inputs.militaryInCity * perUnit);
    unhappy -= Math.max(0, Math.min(law, unhappy));
  } else {
    const per =
      (city.improvements[IMPROVEMENT.policeStation] || ctx.ownsWonder(IMPROVEMENT.womensSuffrage)
        ? 0
        : 1) + (ctx.government === GOVERNMENT.democracy ? 1 : 0);
    if (per !== 0) {
      let n = inputs.militaryAbroad;
      if (n !== 0 && ctx.government === GOVERNMENT.republic) n -= 1;
      unhappy += per * n;
    }
  }
  clampAll();

  // Stage 3: wonders.
  if (ctx.ownsWonder(IMPROVEMENT.hangingGardens)) {
    happy += 1;
    if (imp[IMPROVEMENT.hangingGardens]) happy += 2;
  }
  if (ctx.ownsWonder(IMPROVEMENT.cureForCancer)) happy += 1;
  if (inputs.shakespearesCity === city.id) unhappy = 0;
  if (ctx.ownsWonder(IMPROVEMENT.jsBachs)) unhappy -= 2;
  clampAll();

  return { happy, unhappy, content: Math.max(0, workers - happy - unhappy) };
}

/** Shield cost of the units a city supports, and the unhappiness-causing count (0x004b37f2, 0x004b3b24). */
export function unitSupport(
  world: World,
  rules: EngineRules,
  city: City,
  ctx: CityContext,
  units: Unit[],
): { shields: number; settlers: number; abroad: number; inCity: number } {
  let count = 0;
  let shields = 0;
  let settlers = 0;
  let abroad = 0;
  let inCity = 0;
  for (const u of units) {
    const type = rules.units[u.type];
    if (!type || type.role > 5) continue;
    count += 1;
    switch (ctx.government) {
      case GOVERNMENT.anarchy:
      case GOVERNMENT.despotism:
        if (count > city.size) shields += 1;
        break;
      case GOVERNMENT.monarchy:
        if (count > rules.cosmic.monarchyFreeUnits) shields += 1;
        break;
      case GOVERNMENT.communism:
        if (count > rules.cosmic.communismFreeUnits) shields += 1;
        break;
      case GOVERNMENT.fundamentalism:
        if (
          !type.flags.freeSupportUnderFundamentalism &&
          count > rules.cosmic.fundamentalismFreeUnits
        )
          shields += 1;
        break;
      default:
        shields += 1;
    }
    if (type.role === 5) settlers += 1;
    if (type.attack !== 0) {
      const here = u.position.x === city.position.x && u.position.y === city.position.y;
      if (type.domain === DOMAIN_AIR) {
        if (type.role !== 3) abroad += 1;
        if (here) inCity += 1;
      } else if (here) {
        inCity += 1;
      } else if (!world.cityAt(u.position.x, u.position.y)) {
        const inFortressNearHome =
          world.hasFlag(u.position.x, u.position.y, SquareFlag.Fortress) &&
          world.cities.some(
            (c) => c.owner === city.owner && distance(world, c.position, u.position) < 4,
          );
        if (!inFortressNearHome) abroad += 1;
      }
    }
  }
  return { shields, settlers, abroad, inCity };
}

/** Distance in squares as the original measures it: max(|dx|/2 … ) — the standard isometric metric. */
export function distance(
  world: World,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  let dx = Math.abs(a.x - b.x);
  if (!world.flatEarth) dx = Math.min(dx, world.widthX2 - dx);
  const dy = Math.abs(a.y - b.y);
  return Math.max((dx + dy) >> 1, dy, dx >> 1);
}

export interface GrowthOutcome {
  grew: boolean;
  starved: boolean;
  destroyed: boolean;
  disbandedSettler: Unit | null;
  blockedBy: number;
}

/** 0x004b7654 — apply this turn's food to growth or starvation. `surplus` already added. */
export function processGrowth(
  rules: EngineRules,
  city: City,
  ctx: CityContext,
  supportedSettlers: Unit[],
): GrowthOutcome {
  const out: GrowthOutcome = {
    grew: false,
    starved: false,
    destroyed: false,
    disbandedSettler: null,
    blockedBy: 0,
  };
  if (city.foodStored < 0) {
    out.starved = true;
    const settler = supportedSettlers[0] ?? null;
    if (settler) out.disbandedSettler = settler;
    else {
      city.size -= 1;
      if (city.size < 1) out.destroyed = true;
    }
    city.foodStored = 0;
    return out;
  }
  if (city.foodStored >= foodBox(rules, ctx, city.size)) {
    const blocker = growthBlocker(rules, city);
    city.size += 1;
    if (city.improvements[IMPROVEMENT.granary] || ctx.ownsWonder(IMPROVEMENT.pyramids)) {
      city.foodStored = (city.size + 1) * (rules.cosmic.foodBoxRows >> 1);
    } else {
      city.foodStored = 0;
    }
    if (blocker !== 0) {
      city.size -= 1;
      out.blockedBy = blocker;
    } else {
      out.grew = true;
    }
  }
  return out;
}

/** Shield cost of the current production item. */
export function productionCost(rules: EngineRules, city: City, ctx: CityContext): number {
  const rows = boxRows(rules, ctx, true);
  if (city.production.kind === 'unit')
    return (rules.units[city.production.index]?.costRows ?? 1) * rows;
  return (rules.improvements[city.production.index]?.costRows ?? 1) * rows;
}

export const DOMAIN = { ground: DOMAIN_GROUND, air: DOMAIN_AIR, sea: DOMAIN_SEA } as const;
