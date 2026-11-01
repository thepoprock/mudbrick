/**
 * The AI's city production choice.
 *
 * Specification: docs/engine/ai-city.md — the original's production advisor (0x00474edb).
 * Lower numbers win; 999 = never. Inputs the engine does not model yet take the documented
 * INFERRED defaults; every case is named by its improvement or unit role so it can be refined.
 */
import { hasLaunched, hasStarted } from './spaceship.js';
import { boxRows, distance, type CityContext } from './city.js';
import { canBuildUnit } from './founding.js';
import type { Production } from './world.js';
import {
  advanceIndex,
  ADVANCE,
  DOMAIN_AIR,
  DOMAIN_GROUND,
  DOMAIN_SEA,
  GOVERNMENT,
  IMPROVEMENT,
  type EngineRules,
} from './rules.js';
import { OCEAN, SquareFlag, type City, type Civ, type World } from './world.js';

export interface AiBuildFacts {
  shields: number;
  support: number;
  /** The civilization's best `2 × shields − support` this turn so far (+0x3d2); defaults to this city's. */
  bestProduction?: number;
  trade: number;
  corruption: number;
  foodSurplus: number;
  happy: number;
  unhappy: number;
  settlersSupported: number;
  /** Defend-role units standing in the city. */
  defendersInCity: number;
  /** Enemy units in the city radius. */
  threat: number;
  /** Any enemy unit adjacent to the city square (zone of control). */
  zocAtCity: boolean;
  /** RULES @LEADERS personality −1 … 1. */
  attack: number;
  expand: number;
  civilize: number;
  difficulty: number;
  turn: number;
  /** Simplified combat ON lowers the unit strength factor to 2. */
  simplifiedCombat: boolean;
  /** Spaceship race on for this civilization (0/1) plus one when anyone launched. */
  spaceRace: number;
  /** The civilization has its first city (a capital exists somewhere). */
  hasCapital: boolean;
  /** Units of the city causing military unhappiness (the support pass's count, 0x004b6359). */
  unitsAway?: number;
  /** City record byte 6 bit 2 (meaning unknown; the engine never sets it) — SAM Battery −3. */
  samPenalty?: boolean;
  /** Land-mass flag: expanding continent (INFERRED default: fewer than 4 cities). */
  expanding: boolean;
  /** Continent plan of the city's land mass (aiStrategy.ts PLAN); undefined before the first pass. */
  plan?: number;
  /** Own cities on the city's land mass. */
  citiesOnContinent?: number;
  /** Plan 4 only: an enemy at war has no city on this land mass (the advisor's local_34). */
  warWithoutCitiesHere?: boolean;
  /** Distance to the nearest other own city (9999 when none). */
  nearestOwnCityDistance?: number;
  /** A wanted settler stands near the city (city flag 0x40). */
  workerNearby?: boolean;
  /** Knows the advance that doubles the attack personality's pull (INFERRED: unused when absent). */
  knowsAttackDoubler?: boolean;
  /** A caravan is homed here (city flag bit 12), which stops another being built. */
  cityHasCaravan?: boolean;
  /** The civilization's caravans on the city's land mass (the strategic tally). */
  caravansOnContinent?: number;
  /** Slots the civilization has met (contact), for the diplomat rule. */
  metSlots?: number[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const NEVER = 999;

/** Improvement priority before the common scaling; null = never. Cases follow the original's switch. */
export function improvementPriority(
  imp: number,
  city: City,
  f: AiBuildFacts,
  env: {
    rules: EngineRules;
    cityCount: number;
    continentCities: number;
    barracksOnContinent: number;
    airportsOnContinent: number;
    portsOnContinent: number;
    oceanSquares: number;
    farmlandSquares: number;
    coastal: boolean;
    distanceToCapital: number;
    knows: (a: number) => boolean;
    ownsWonder: (i: number) => boolean;
    wonderBuilt: (i: number) => boolean;
    scienceRate: number;
    government: number;
    isHuman: boolean;
  } & ForeignStrengthEnv,
): { n: number; military: boolean } | null {
  const has = (i: number) => city.improvements[i] === true;
  const disorder = city.inDisorder;
  const borderline = !disorder && f.happy === f.unhappy;
  const half = f.foodSurplus >> 1;
  const im = IMPROVEMENT;
  let n: number | null = null;
  let military = false;
  switch (imp) {
    case im.palace:
      if (!f.hasCapital) {
        n = 2;
        if (city.size > 9) n = 1;
        if (city.size > 14) n -= 1;
      }
      break;
    case im.barracks:
      n = f.civilize + env.barracksOnContinent + 4 - f.attack;
      if ((f.attack < 0 || f.civilize > 0) && f.attack + f.civilize !== 0)
        n += env.barracksOnContinent;
      military = true;
      if (env.isHuman) {
        if (f.difficulty === 3) n = Math.trunc((n * 3) / 2);
        if (f.difficulty > 3) n <<= 1;
      }
      break;
    case im.granary:
      if (!env.ownsWonder(im.pyramids)) {
        n = f.shields < 3 ? 8 : 4;
        if (f.happy <= f.unhappy) n += 2;
        if (env.isHuman) n += Math.max(0, f.difficulty + 4 - city.size);
      }
      break;
    case im.temple:
      if (borderline) n = 9;
      if (disorder) n = -5;
      break;
    case im.marketplace:
      n = clamp(10 - (f.trade >> 1), 1, 10);
      if (borderline) n -= 1;
      if (disorder) n = -4;
      break;
    case im.library:
      n = clamp(10 - Math.trunc(f.trade / 3), 1, 10);
      break;
    case im.courthouse:
      n = 14 - (f.unhappy * 2 + f.corruption);
      if (env.government === GOVERNMENT.democracy && disorder) n = -1;
      break;
    case im.cityWalls:
      if (!env.ownsWonder(im.greatWall)) {
        n = clamp(10 - (city.size >> 1), 1, 10);
        if (has(im.palace)) n -= 4;
        military = true;
      }
      break;
    case im.aqueduct:
      if (city.size >= env.rules.cosmic.aqueductSize - half) {
        n = clamp(env.rules.cosmic.aqueductSize + 4 - city.size - half, 1, 20);
      }
      break;
    case im.bank:
      n = clamp(10 - Math.trunc(f.trade / 3), 1, 10);
      if (borderline) n -= 1;
      if (disorder) n = 0;
      break;
    case im.cathedral:
      if (!env.ownsWonder(im.michelangelos)) {
        if (borderline) n = 8;
        if (disorder) n = -3;
      }
      break;
    case im.university:
      if (env.scienceRate !== 0) n = clamp(10 - (f.trade >> 2), 2, 10);
      break;
    case im.colosseum:
      if (disorder) n = -2;
      break;
    case im.factory:
    case im.hydroPlant:
      n = clamp(14 - f.shields, 1, 14);
      break;
    case im.sdiDefense:
      if (!disorder) {
        n = (clamp(15 - city.size, 1, 15) + 1) >> 1;
        if (!env.wonderBuilt(im.manhattanProject)) n <<= 1;
        if (city.size > 9) n -= 1;
        if (has(im.palace)) n = 0;
      }
      military = true;
      break;
    case im.powerPlant:
      n = clamp(12 - Math.trunc(f.shields / 5), 2, 14);
      break;
    case im.stockExchange:
      if (!borderline || f.spaceRace < 2) {
        n = clamp(11 - (f.trade >> 2), 2, 11);
        if (borderline) n -= 1;
        if (disorder) n = 0;
      }
      break;
    case im.sewerSystem:
      if (f.spaceRace < 2 && city.size >= env.rules.cosmic.sewerSize - half) {
        n = clamp(env.rules.cosmic.sewerSize + 4 - city.size - half, 1, 20);
      }
      break;
    case im.supermarket:
      n = clamp(14 - (city.size >> 1) - env.farmlandSquares * 2 + f.spaceRace * 2 + half, 2, 14);
      break;
    case im.superhighways:
      n = clamp(15 - (city.size >> 1) + f.spaceRace * 6, 2, 15);
      break;
    case im.researchLab:
      if (env.scienceRate !== 0) n = clamp(11 - (f.trade >> 2), 2, 10);
      break;
    case im.samBattery: {
      // VERIFIED: Stealth Bombers and Bombers ×2, Cruise Missiles and Helicopters, all ×2 for
      // the main human; the plain sum of the four for other civilizations (RULES indices 31, 28,
      // 44, 29). Then 12 − that, within 1 … 12.
      const v = foreignStrength(
        env,
        (c) => (c(31) * 2 + c(28) * 2 + c(44) + c(29)) * 2,
        (c) => c(44) + c(28) + c(29) + c(31),
      );
      n = v === null ? 12 : clamp(12 - v, 1, 12);
      if (f.samPenalty) n -= 3;
      military = humanThreat(env) ? f.expanding : true;
      break;
    }
    case im.coastalFortress:
      if (env.coastal) {
        // VERIFIED: AEGIS Cruisers and Cruisers ×3, Battleships ×5, Ironclads and Destroyers
        // for the main human; half the Ironclads and Destroyers, Battleships ×2, Cruisers and
        // AEGIS for others (RULES indices 36–40). Then 12 − that, within 1 … 12.
        const v = foreignStrength(
          env,
          (c) => c(39) * 3 + c(38) * 3 + c(40) * 5 + c(36) + c(37),
          (c) => (c(36) >> 1) + (c(37) >> 1) + c(40) * 2 + c(38) + c(39),
        );
        n = v === null ? 12 : clamp(12 - v, 1, 12);
        military = humanThreat(env) ? f.expanding : true;
      }
      break;
    case im.harbour:
      if (!disorder) {
        n = clamp(16 - env.oceanSquares, 2, 16);
        if (f.foodSurplus < 1) n = Math.trunc(n / 2);
      }
      break;
    case im.offshorePlatform:
      if (!disorder) {
        n = clamp(16 - env.oceanSquares, 2, 16);
        if (has(im.factory)) n = Math.trunc(n / 2);
        if (has(im.manufacturingPlant)) n = Math.trunc(n / 2);
        if (f.shields - f.support <= Math.trunc(f.shields / 3) || f.shields < city.size >> 1) {
          if (city.size >> 1 <= env.oceanSquares >> 2) n -= 2;
        }
      }
      break;
    case im.airport:
      n = env.airportsOnContinent * 4 + 4 - f.attack;
      if (!env.knows(0)) n <<= 1; // Advanced Flight is advance 0 in the shipped rules
      if (env.continentCities < n) n = env.continentCities;
      if (has(im.palace) && n >= 0) n = 0;
      military = f.expanding;
      break;
    case im.policeStation:
      if (!env.ownsWonder(im.womensSuffrage)) {
        let w = f.unitsAway ?? 0; // VERIFIED: the support pass's military-unhappiness count
        if (env.government === GOVERNMENT.democracy) w <<= 1;
        if (env.government > GOVERNMENT.fundamentalism && w !== 0 && f.happy - f.unhappy < 2)
          w += 2;
        n = 10 - w;
      }
      break;
    case im.portFacility:
      if (env.coastal) {
        const d = Math.min(env.distanceToCapital, 40);
        n = clamp(11 - (d >> 2) + env.portsOnContinent * 2 - f.attack + f.civilize, 2, 15);
        if (f.attack < 0) n += env.portsOnContinent;
      }
      break;
    case im.massTransit:
    case im.solarPlant:
      break;
    default:
      if (imp >= 35) break; // spaceship parts are scored in aiChooseProduction
      n = clamp(12 - (f.shields >> 2), 2, 12);
      break;
  }
  if (n === null) return null;
  return { n, military };
}

/** The common scaling every candidate gets (VERIFIED): favoured items count half. */
function scaleCommon(
  n: number,
  favoured: boolean,
  civilize: number,
  city: City,
  barracksOnContinent: number,
  shakespeares: boolean,
): number {
  if (n >= 400) return 0x3fff;
  let v = Math.trunc(((favoured ? 10 : 20) * n * 3) / (civilize + 3));
  if (city.improvements[IMPROVEMENT.barracks])
    v += Math.trunc(v / ((barracksOnContinent >> 1) + 3));
  if (shakespeares) v += Math.trunc(v / 3);
  return v;
}

export interface AiBuildEnv {
  world: World;
  rules: EngineRules;
  civ: Civ;
  city: City;
  ctx: CityContext;
  facts: AiBuildFacts;
  cityCount: number;
  wonderCity: (improvement: number) => number | null;
  ownsWonder: (improvement: number) => boolean;
  canBuildImprovement: (improvement: number) => boolean;
  /** Has anyone discovered the advance that expires this wonder? (default: never) */
  wonderExpired?: (improvement: number) => boolean;
  /** The ship's next kind for a request (spaceship.ts aiNextPartKind); negative = nothing to build. */
  nextShipKind?: (kind: number) => number;
  /** Other civilizations' strength for the defence valuations. */
  foreign?: Omit<ForeignStrengthEnv, 'slot'>;
  /** Debug hook: every candidate and its score (lower wins). */
  trace?: (score: number, p: Production) => void;
}

/** What the defence valuations (SAM Battery, Coastal Fortress) read about other civilizations. */
export interface ForeignStrengthEnv {
  slot: number;
  /** The main human's slot (null without one). */
  mainHuman?: number | null;
  isHumanSlot?: (slot: number) => boolean;
  /** Active units of a type a civilization has (the civilization record's per-type counts). */
  unitCount?: (slot: number, type: number) => number;
  atWar?: (a: number, b: number) => boolean;
  /** `a` holds a vendetta against `b`. */
  vendettaAgainst?: (a: number, b: number) => boolean;
  atPeace?: (a: number, b: number) => boolean;
  reputationOf?: (slot: number) => number;
}

/**
 * May a nuclear unit (attack 99) be considered (VERIFIED 0x00474edb)? Fewer than four active and
 * fewer than two in production.
 */
export function nuclearAllowed(active: number, inProduction: number): boolean {
  return active < 4 && inProduction < 2;
}

/**
 * May an air-superiority unit (role 3) be considered (VERIFIED 0x00474edb)? Our Fighters and
 * Stealth Fighters (RULES indices 27 and 30), active and in production, must number fewer than
 * the main human's Bombers, Helicopters and Stealth Bombers (28, 29, 31) plus two; and at peace
 * with that human only while none of this type exist or are being built. The original reads the
 * main human's slot as it stands (slot 0 without one).
 */
export function fighterAllowed(
  foreign: Omit<ForeignStrengthEnv, 'slot'> | undefined,
  slot: number,
  type: number,
  active: (type: number) => number,
  inProduction: (type: number) => number,
): boolean {
  const count = foreign?.unitCount;
  if (!count) return false;
  const h = foreign?.mainHuman ?? 0;
  const mine = active(27) + inProduction(27) + active(30) + inProduction(30);
  const theirs = count(h, 28) + count(h, 29) + count(h, 31) + 2;
  if (mine >= theirs) return false;
  if (foreign?.atPeace?.(slot, h) && active(type) + inProduction(type) !== 0) return false;
  return true;
}

/**
 * Foreign strength of a kind (VERIFIED 0x00474edb, the SAM Battery and Coastal Fortress cases):
 * a computer player weighs the main human's units with `mine`; a human player sums every other
 * civilization's with `others`, halved unless it is at war with that civilization or that
 * civilization holds a vendetta against it. Null when the context brings no unit counts.
 */
function foreignStrength(
  env: ForeignStrengthEnv,
  mine: (count: (type: number) => number) => number,
  others: (count: (type: number) => number) => number,
): number | null {
  const unitCount = env.unitCount;
  const isHuman = env.isHumanSlot;
  if (!unitCount || !isHuman) return null;
  const me = env.slot;
  const counter = (slot: number) => (type: number) => unitCount(slot, type);
  if (!isHuman(me)) {
    const h = env.mainHuman ?? null;
    return h === null ? 0 : mine(counter(h));
  }
  let total = 0;
  for (let s = 1; s < 8; s++) {
    if (s === me) continue;
    let v = others(counter(s));
    if (!env.atWar?.(me, s) && !env.vendettaAgainst?.(s, me)) v = Math.trunc(v / 2);
    total += v;
  }
  return total;
}

/** A human of reputation above 4, or one we are at war with (the defence cases' "military" test). */
function humanThreat(env: ForeignStrengthEnv): boolean {
  for (let s = 1; s < 8; s++) {
    if (!env.isHumanSlot?.(s)) continue;
    if ((env.reputationOf?.(s) ?? 0) > 4 || env.atWar?.(env.slot, s)) return true;
  }
  return false;
}

/** Choose what a computer-controlled city builds next. */
export function aiChooseProduction(env: AiBuildEnv): Production {
  const { world, rules, civ, city, facts: f } = env;
  const knows = (a: number) => civ.knownAdvances[a] === true;
  const buildable = (t: number) => canBuildUnit(rules, civ, t);
  const bestDefender = (): number => {
    let pick = -1;
    for (let t = rules.units.length - 1; t >= 0; t--) {
      const u = rules.units[t];
      if (u && u.role === 1 && buildable(t)) {
        pick = t;
        break;
      }
    }
    return pick;
  };
  const myUnits = world.units.filter((u) => u.owner === civ.slot);

  // Early exit: a civilization with no units under Anarchy/Despotism builds its best defender.
  if (myUnits.length === 0 && civ.government < GOVERNMENT.monarchy) {
    const d = bestDefender();
    if (d >= 0) return { kind: 'unit', index: d };
  }
  // Barbarians keep producing units.
  if (civ.slot === 0) {
    if (city.production.kind === 'unit' && buildable(city.production.index)) return city.production;
    const d = bestDefender();
    return { kind: 'unit', index: d >= 0 ? d : 0 };
  }

  const mass = world.landmass[world.index(city.position.x, city.position.y)] ?? 0;
  const onMass = (c: City) => world.landmass[world.index(c.position.x, c.position.y)] === mass;
  const myCities = world.cities.filter((c) => c.owner === civ.slot);
  const continentCities = myCities.filter(onMass).length;
  const barracksOnContinent =
    (env.ownsWonder(IMPROVEMENT.sunTzu) ? 4 : 0) +
    myCities.filter((c) => onMass(c) && c.improvements[IMPROVEMENT.barracks]).length +
    myCities.filter(
      (c) =>
        c !== city &&
        c.production.kind === 'improvement' &&
        c.production.index === IMPROVEMENT.barracks,
    ).length;
  const airportsOnContinent = myCities.filter(
    (c) => onMass(c) && c.improvements[IMPROVEMENT.airport],
  ).length;
  const portsOnContinent = myCities.filter(
    (c) => onMass(c) && c.improvements[IMPROVEMENT.portFacility],
  ).length;
  let oceanSquares = 0;
  let farmlandSquares = 0;
  let coastal = false;
  for (let i = 0; i < 20; i++) {
    const p = world.radiusSquare(city.position.x, city.position.y, i);
    if (!p) continue;
    if (world.terrainAt(p.x, p.y) === OCEAN) {
      oceanSquares += 1;
      if (i < 8) coastal = true;
    }
    if (world.hasFlag(p.x, p.y, SquareFlag.Farmland)) farmlandSquares += 1;
  }
  let distanceToCapital = 32;
  for (const c of myCities) {
    if (c.improvements[IMPROVEMENT.palace])
      distanceToCapital = Math.min(distanceToCapital, distance(world, city.position, c.position));
  }
  const shakespeares = env.wonderCity(IMPROVEMENT.shakespeares) === city.id;

  // Defenders wanted.
  let want: number;
  const d = f.zocAtCity ? 3 : 4;
  want = Math.trunc(city.size / d) + (f.expanding ? 1 : 0);
  if (city.improvements[IMPROVEMENT.palace]) {
    want -= 1;
    let min = 1;
    if (city.size > 3) min = 2;
    if (env.cityCount > 7) min = 3;
    if (env.cityCount > 11) min = 4;
    want = Math.max(want, min);
  }
  let need = 0;
  let urgent = 0;
  if (f.defendersInCity < 1) {
    need = 2;
    urgent = 2;
  } else if (f.defendersInCity < want) {
    need = 1;
    if (f.defendersInCity + 1 < want) urgent = 1;
  }

  let best = NEVER * 100;
  let pick: Production | null = null;
  const consider = (n: number, p: Production) => {
    env.trace?.(n, p);
    if (n < best) {
      best = n;
      pick = p;
    }
  };

  // Improvements.
  for (let imp = 1; imp < 39; imp++) {
    if (!env.canBuildImprovement(imp)) continue;
    if (imp >= 35) {
      // VERIFIED (ai-city.md): one "spaceship part" candidate, structural by name, worth 4 (2
      // once a human has a spaceship) while the Apollo Program stands, the ship is not launched
      // and the ship's own chooser (0x0053ef43) can name a kind to build; the kind actually
      // built is chosen again when the part completes (production.ts).
      if (imp !== 35) continue;
      if (env.wonderCity(IMPROVEMENT.apolloProgram) === null || hasLaunched(civ)) continue;
      if ((env.nextShipKind?.(0) ?? 0) < 0) continue;
      const humanShip = world.civs.some((c) => c.isHuman && hasStarted(c));
      consider(
        scaleCommon(
          humanShip ? 2 : 4,
          f.expanding,
          f.civilize,
          city,
          barracksOnContinent,
          shakespeares,
        ),
        { kind: 'improvement', index: imp },
      );
      continue;
    }
    const r = improvementPriority(imp, city, f, {
      rules,
      cityCount: env.cityCount,
      continentCities,
      barracksOnContinent,
      airportsOnContinent,
      portsOnContinent,
      oceanSquares,
      farmlandSquares,
      coastal,
      distanceToCapital,
      knows,
      ownsWonder: env.ownsWonder,
      wonderBuilt: (i) => env.wonderCity(i) !== null,
      scienceRate: civ.scienceRate,
      government: civ.government,
      isHuman: civ.isHuman,
      slot: civ.slot,
      ...(env.foreign ?? {}),
    });
    if (!r) continue;
    consider(
      scaleCommon(
        r.n,
        r.military === f.expanding,
        f.civilize,
        city,
        barracksOnContinent,
        shakespeares,
      ),
      { kind: 'improvement', index: imp },
    );
  }

  // Wonders (the base and the per-wonder adjustments the engine can evaluate).
  const wondersOwned = myCities.reduce(
    (s, c) => s + c.improvements.slice(39, 67).filter(Boolean).length,
    0,
  );
  const wondersHere = city.improvements.slice(39, 67).filter(Boolean).length;
  // VERIFIED (the advisor's city sweep): other own cities on this land mass building a wonder;
  // which civilizations build each wonder elsewhere (an own city only when it makes more
  // shields than this one; bit 0 when an own city has the wonder's cost in hand); own cities on
  // the same work with more shields; foreign cities on the same work.
  const lmOf = (c: City) => world.landmass[world.index(c.position.x, c.position.y)];
  const hereLm = lmOf(city);
  const sameWork = (c: City) =>
    c.production.kind === city.production.kind && c.production.index === city.production.index;
  const shieldRows = boxRows(rules, { isHuman: civ.isHuman, difficulty: f.difficulty }, true);
  let othersBuildingWonders = 0;
  const buildersOf = new Array<number>(28).fill(0);
  let betterOnSameWork = 0;
  let foreignOnSameWork = 0;
  for (const c of world.cities) {
    if (c === city) continue;
    const cw =
      c.production.kind === 'improvement' && c.production.index >= 39
        ? c.production.index - 39
        : -1;
    if (c.owner === civ.slot) {
      if (sameWork(c) && (c.lastShields ?? 0) > f.shields) betterOnSameWork++;
      if (lmOf(c) !== hereLm) continue;
      if (cw >= 0) {
        othersBuildingWonders++;
        if ((c.lastShields ?? 0) > f.shields)
          buildersOf[cw] = (buildersOf[cw] ?? 0) | (1 << civ.slot);
        if ((rules.improvements[cw + 39]?.costRows ?? 0) * shieldRows <= c.shieldsStored)
          buildersOf[cw] = (buildersOf[cw] ?? 0) | 1;
      }
    } else {
      if (sameWork(c)) foreignOnSameWork++;
      if (cw >= 0) buildersOf[cw] = (buildersOf[cw] ?? 0) | (1 << c.owner);
    }
  }
  const eraOwned = [0, 0, 0, 0];
  for (let w = 39; w < 67; w++) {
    const e = Math.trunc((w - 39) / 7);
    if (myCities.some((c) => c.improvements[w])) eraOwned[e] = (eraOwned[e] ?? 0) + 1;
  }
  const currentWonder =
    city.production.kind === 'improvement' && city.production.index >= 39
      ? city.production.index
      : null;
  const wonderInProgress = currentWonder !== null && city.shieldsStored > 39;
  const wonderAllowed =
    wonderInProgress || (city.size > 2 && !city.inDisorder && continentCities >= 4 - f.civilize);
  if (wonderAllowed) {
    for (let w = 39; w < 67; w++) {
      if (!env.canBuildImprovement(w) || env.wonderCity(w) !== null) continue;
      let n = Math.max(1, wondersOwned + wondersHere + 8 - Math.trunc(civ.treasury / 200));
      const i = w - 39;
      const size = city.size;
      switch (i) {
        case 0:
          n -= f.civilize * 3 + 2;
          break;
        case 1:
          n -= Math.trunc(env.cityCount / 3) + 1;
          break;
        case 2:
          n -=
            (city.improvements[IMPROVEMENT.palace] ? 1 : 0) +
            (city.improvements[IMPROVEMENT.marketplace] ? 1 : 0) +
            Math.trunc(size / 3);
          break;
        case 3:
          n -= 0;
          break;
        case 5:
          n -= (env.cityCount >> 2) - Math.trunc(f.turn / 25);
          break;
        case 6:
          n += f.civilize * 2;
          break;
        case 7:
          n -= f.attack * 3 + f.expand - f.civilize * 2 + 1;
          break;
        case 8:
          n -= clamp(Math.trunc((f.shields * 2) / 3), 0, 3);
          break;
        case 10:
          n -= env.cityCount >> 2;
          break;
        case 11:
          n -= (f.trade >> 3) + 1 + (city.improvements[IMPROVEMENT.palace] ? 1 : 0);
          break;
        case 13:
          n -= Math.trunc(size / 5);
          break;
        case 14:
          n -= 4;
          break;
        case 16:
          n -= Math.trunc(size / 6) + (city.improvements[IMPROVEMENT.palace] ? 1 : 0);
          break;
        case 17:
          n -= env.cityCount >> 2;
          break;
        case 18:
          n -= 3;
          break;
        case 19:
          n -= knows(ADVANCE.communism) ? 1 : 2;
          break;
        case 21:
          n -=
            (f.attack >= 0 && f.expand >= 0 && f.civilize >= 0 ? 2 : 1) +
            (civ.government > GOVERNMENT.fundamentalism ? 1 : 0) +
            (civ.government > GOVERNMENT.republic ? 1 : 0);
          break;
        case 24:
          n -= f.civilize - f.attack * 2;
          break;
        case 25:
          n -= f.civilize * 3 - f.attack * 2;
          break;
        case 26:
          n -= f.civilize * 2 + 2;
          break;
        case 27:
          n -= f.attack + 2;
          break;
        default:
          break;
      }
      // VERIFIED order (the wonder loop): obsolete ×3 + 50 × difficulty; +5 per other own city
      // on the land mass building a wonder, −2 with none (or a wonder under way here) and no
      // wonder of this era owned; the threat (+1 under plan 1, else half); the same-work terms;
      // the in-progress adjustments of the favoured flag; the production rank; the common
      // scaling; the Palace; the progress discount. The "wonder city" flag (city flag bit 8)
      // is INFERRED clear: the engine never sets it.
      const obsolete = env.wonderExpired?.(w) ?? false;
      if (obsolete) n = n * 3 + f.difficulty * 50;
      n += othersBuildingWonders * 5;
      const era = Math.trunc((w - 39) / 7);
      if ((othersBuildingWonders === 0 || wonderInProgress) && (eraOwned[era] ?? 0) === 0) n -= 2;
      n += f.plan === 1 ? f.threat + 1 : f.threat >> 1;
      const buildingThis = currentWonder === w;
      if (buildingThis) {
        if (foreignOnSameWork > 0) n = Math.trunc(n / 2);
        n = (betterOnSameWork + 1) * n + betterOnSameWork;
      } else if (
        currentWonder !== null &&
        ((buildersOf[currentWonder - 39] ?? 0) & (1 << civ.slot)) !== 0
      ) {
        n = n * 2 + 1;
      }
      const cost = (rules.improvements[w]?.costRows ?? 0) * shieldRows + 1;
      // The favoured (×10) scaling: the original compares its running flag with the land-mass
      // flag that `expanding` models; for wonders they differ exactly when the plan is 0 or 1.
      let favoured = !f.expanding;
      if (wonderInProgress && urgent === 0 && !obsolete) {
        if (othersBuildingWonders === 0) {
          if (favoured) n = Math.trunc(n / 2);
          else favoured = true;
        }
        if (Math.trunc((cost * 3) / 4) <= city.shieldsStored) favoured = true;
        if (!favoured && Math.trunc(cost / 2) <= city.shieldsStored && othersBuildingWonders < 3)
          favoured = true;
      }
      // VERIFIED (against the civilization's +0x3d2): unless a wonder here already has forty
      // shields, a city making no more than half the civilization's best `2 × shields −
      // support` finds every wonder twice as costly (a human's strong city that is not the
      // best and makes less than 6 too); the best city finds them a third cheaper.
      const p2 = f.shields * 2 - f.support;
      const best = f.bestProduction ?? p2;
      if (!wonderInProgress) {
        if (best >> 1 < p2) {
          if (civ.isHuman && best !== p2 && p2 < 6) n <<= 1;
        } else n <<= 1;
      }
      if (best === p2) n -= Math.trunc(n / 3);
      let v = scaleCommon(n, favoured, f.civilize, city, barracksOnContinent, shakespeares);
      if (city.improvements[IMPROVEMENT.palace]) {
        v -= Math.trunc(v / 3);
        if (wondersHere === 0 || (eraOwned[era] ?? 0) === 0) v = Math.trunc(v / 2);
      }
      if (wonderInProgress && !obsolete)
        v = Math.trunc(
          (Math.trunc(((cost - city.shieldsStored) * Math.trunc((v * 3) / 4)) / cost) +
            Math.trunc(v / 4)) /
            3,
        );
      consider(v, { kind: 'improvement', index: w });
    }
  }

  // Units.
  if (urgent === 2) {
    const d = bestDefender();
    if (d >= 0) return { kind: 'unit', index: d };
  }
  const totalUnits = myUnits.length;
  if (totalUnits < 512) {
    for (let t = 0; t < rules.units.length; t++) {
      const u = rules.units[t];
      if (!u || !buildable(t) || (u.role > 5 && u.role !== 7 && u.role !== 6)) continue;
      const onContinent = myUnits.filter(
        (x) => x.type === t && world.landmass[world.index(x.position.x, x.position.y)] === mass,
      ).length;
      const building = myCities.filter(
        (c) => c !== city && c.production.kind === 'unit' && c.production.index === t,
      ).length;
      if (u.role === 5) {
        const settlersFood =
          civ.government <= GOVERNMENT.monarchy
            ? rules.cosmic.settlersFoodEarlyGovt
            : rules.cosmic.settlersFoodLateGovt;
        if (!(f.foodSurplus >= settlersFood || (f.settlersSupported === 0 && building === 0)))
          continue;
        if (city.size < 2 || building >= 2) continue;
      }
      if (t === 2 && civ.government >= GOVERNMENT.monarchy) continue; // Warriors only early
      if (t === 42) continue; // VERIFIED: the Carrier (by index) is never chosen
      const activeOf = (ty: number) => myUnits.filter((x) => x.type === ty).length;
      const producing = (ty: number) =>
        myCities.filter((c) => c.production.kind === 'unit' && c.production.index === ty).length;
      if (u.attack >= 99 && !nuclearAllowed(activeOf(t), producing(t))) continue;
      if (u.role === 3 && !fighterAllowed(env.foreign, civ.slot, t, activeOf, producing)) continue;
      if (u.domain === DOMAIN_SEA && !coastal) continue;
      let n = building * 2 + onContinent;
      // VERIFIED: with an urgent defence need nothing but a defender is considered.
      if (need === 2 && u.role !== 1) continue;
      if (u.role === 6) {
        // VERIFIED shape (ai-city.md): 11, or `clamp(10 − (their advances − ours), 2, 10)` against
        // a civilization ahead of us that we have met; never with one already on the land mass
        // (INFERRED: the space-race halving is left out). Then the non-combat scaling.
        if (onContinent > 0) continue;
        let v = 11;
        for (const other of world.civs) {
          if (other.slot === 0 || other.slot === civ.slot || !other.inPlay) continue;
          if (!(f.metSlots?.includes(other.slot) ?? false)) continue;
          const ahead = other.advancesCount - civ.advancesCount;
          if (ahead > 0) v = Math.min(v, clamp(10 - ahead, 2, 10));
        }
        v = Math.trunc(((f.expanding ? 20 : 10) * v * 3) / (f.civilize + 3));
        if (city.improvements[IMPROVEMENT.barracks]) v += v >> 2;
        consider(v, { kind: 'unit', index: t });
        continue;
      }
      if (u.role === 7) {
        // VERIFIED caravans (0x00474edb): `10 − (5 − expand) × trade / 10` while the city has
        // fewer than three routes, +2 per route, at least 2, plus the civilization's caravans on
        // the land mass; then the non-combat scaling `× 10 × 3 / (civilize + 3)` (×20 under a
        // military plan), +¼ with Barracks. A city flagged for a caravan builds none.
        if (f.cityHasCaravan) continue;
        let v = 10;
        if (city.tradeRoutes.length < 3) v = 10 - Math.trunc(((5 - f.expand) * f.trade) / 10);
        v = Math.max(2, v + city.tradeRoutes.length * 2) + (f.caravansOnContinent ?? 0);
        v = Math.trunc(((f.expanding ? 20 : 10) * v * 3) / (f.civilize + 3));
        if (city.improvements[IMPROVEMENT.barracks]) v += v >> 2;
        consider(v, { kind: 'unit', index: t });
        continue;
      }
      // VERIFIED: on a full land mass (plan 4) every unit costs `1 − expand` more (twice for
      // non-settlers), halved when an enemy at war has no city there; attackers then shed the
      // attack personality + 1 (doubled with the advance) and clamp to 0–99.
      if (f.plan === 4 && (u.role !== 0 || u.attack !== 0)) {
        let d = (1 - f.expand) * (u.role === 5 ? 1 : 2);
        if (f.warWithoutCitiesHere) d = Math.trunc(d / 2);
        n += d;
        if (f.warWithoutCitiesHere && u.role === 0) {
          let pull = f.attack + 1;
          if (f.knowsAttackDoubler) pull <<= 1;
          n = clamp(n - pull, 0, 99);
        }
      }
      if (u.role === 5) {
        let base =
          city.improvements[IMPROVEMENT.granary] || env.ownsWonder(IMPROVEMENT.pyramids) ? 4 : 6;
        base -= onContinent < (civ.government + 1) >> 1 ? f.civilize : f.expand;
        // VERIFIED "expansion room": the nearest other own city more than 8 away counts 1 (unless a
        // wanted settler is near, settlers are supported, the plan is defend, or size ≤ 2), and
        // a city above size 6 under Republic or Democracy with settlers food and a plan other
        // than attack counts 1 more.
        const roomAllowed =
          !f.workerNearby && f.settlersSupported === 0 && f.plan !== 1 && city.size > 2;
        let room = 0;
        if (roomAllowed && (f.nearestOwnCityDistance ?? 9999) > 8) room = 1;
        if (
          roomAllowed &&
          city.size > 6 &&
          civ.government > 4 &&
          settlersFoodFor(rules, civ) > 0 &&
          f.plan !== 0
        )
          room += 1;
        n = (base - room) * Math.max(1, n);
        for (let s = 0; s < f.settlersSupported; s++) n += (s + 1) * (city.size < 4 ? 16 : 8);
        if (city.size < 2) n <<= 1;
        if (onContinent === 0 && f.foodSurplus === settlersFoodFor(rules, civ)) n -= n >> 1;
        // VERIFIED continent share: with no urgent defence need, a land mass short of settlers
        // halves the value (twice under some governments), and with none at all anywhere it
        // halves again — or drops to 0 (build now) while the land mass has fewer cities than
        // `expand + 3` (+2 under plan defend, +1 more under plan room), except on a full land mass.
        const citiesOn = f.citiesOnContinent ?? env.cityCount;
        if (need < 2) {
          if (building === 0) {
            if (civ.government < 5) {
              if (civ.government > 1) {
                if (onContinent < clamp(citiesOn >> 1, 1, 3)) n = Math.trunc(n / 2);
                if (onContinent < Math.trunc(citiesOn / 5)) n = Math.trunc(n / 2);
              }
            } else if (onContinent < clamp(citiesOn - 1, 1, 6)) n = Math.trunc(n / 2);
            if (onContinent < citiesOn >> 2) n = Math.trunc(n / 2);
          }
          if (onContinent === 0 && building === 0) {
            n = Math.trunc(n / 2);
            if (f.plan !== 4) {
              let k = f.expand + 3;
              if (f.plan === 1) k = f.expand + 2;
              if (f.plan === 5) k += 1;
              if (citiesOn < k) n = 0;
            }
          }
        }
      } else {
        // VERIFIED (0x00474edb, the else of the settlers branch): every other unit is
        // scaled sixteen-fold before the cost and strength terms — this is what lets
        // settlers (and improvements) outrank cheap defenders.
        if (u.role === 1 && need > 0) {
          n = Math.trunc(2 / need);
          if (need === 2 && !city.inDisorder) n = -1;
        } else if (u.role !== 1) {
          n <<= 1;
          if (f.plan !== undefined && u.role !== f.plan) n <<= 1;
        }
        n <<= 4;
      }
      n = (u.costRows + 2) * Math.max(0, n);
      if (u.attack === 0 && u.defence === 0) n = 0;
      else {
        const fp = f.simplifiedCombat ? 2 : clamp(u.hitPointsTens + u.firepower, 2, 4);
        let strength = (u.attack + u.defence) * fp;
        if (u.flags.doubleDefenceVsHorse) strength += 1;
        if (t === 9) strength += 1;
        n = Math.trunc(n / Math.max(1, Math.trunc(((u.move + 1) * strength) / 2)));
      }
      if (u.domain === DOMAIN_SEA) {
        n = f.expanding ? n << 2 : n << 1;
        if (city.improvements[IMPROVEMENT.portFacility]) n -= n >> 2;
      }
      if (u.domain === DOMAIN_AIR) {
        n <<= 1;
        if (city.improvements[IMPROVEMENT.airport]) n -= n >> 2;
      }
      if (totalUnits > 119) n <<= 2;
      if (need === 0 && u.role < 6) {
        let extra = 0;
        if (f.support !== 0 && f.shields !== 0)
          extra = Math.trunc(((3 - (f.expanding ? 1 : 0)) * (f.support + 1) * n) / f.shields);
        if (u.role === 5) extra >>= 1;
        else if (!f.expanding && f.shields <= f.support) n <<= 1;
        n += extra;
      }
      consider(n, { kind: 'unit', index: t });
    }
  }

  if (pick === null) {
    if (!city.improvements[IMPROVEMENT.temple] && env.canBuildImprovement(IMPROVEMENT.temple))
      return { kind: 'improvement', index: IMPROVEMENT.temple };
    const d = bestDefender();
    return { kind: 'unit', index: d >= 0 ? d : 0 };
  }
  return pick;
}

function settlersFoodFor(rules: EngineRules, civ: Civ): number {
  return civ.government <= GOVERNMENT.monarchy
    ? rules.cosmic.settlersFoodEarlyGovt
    : rules.cosmic.settlersFoodLateGovt;
}

export { DOMAIN_GROUND, advanceIndex };
