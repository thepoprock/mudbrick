import { hasLaunched, hasStarted, loseShip } from './spaceship.js';
/**
 * Capturing a city.
 *
 * Specification: docs/engine/rules-combat.md, "Capturing a city" — VERIFIED against the original's
 * capture routine (0x00528720), its plunder formula (0x00526efb) and its conquest-advance routine
 * (0x005273ba). Diplomacy side effects (attitudes, civil war, the Palace escape) are not modelled.
 */
import { removeCity, remarkTerritory } from './fertility.js';
import { initialProduction, canBuildUnit } from './founding.js';
import { grantAdvance } from './research.js';
import type { Rng } from './rng.js';
import { GOVERNMENT, IMPROVEMENT, type EngineRules } from './rules.js';
import { SquareFlag, type City, type Civ, type Unit, type World } from './world.js';

/** Unit type the original creates as partisans (type 9 in the shipped rules). */
export const PARTISANS_TYPE = 9;
/** Advances the partisan rule tests, as indices in the shipped rules. */
export const CONQUEST_ADVANCES = {
  communism: 15,
  conscription: 17,
  guerillaWarfare: 34,
  gunpowder: 35,
} as const;
/** Advances a scenario that forbids government changes also keeps from conquest. */
export const GOVERNMENT_ADVANCES = [31, 54, 15, 71, 21] as const;

export interface CaptureContext {
  /** Run the consequences of an advance just granted (Game.advanceGained). */
  advanceGained?: (civ: Civ, advance: number) => void;
  /** Scenario events: CITYTAKEN, after the city has changed hands. */
  /** A capital fell with a ship building or in flight (0x0048090d). */
  shipLost?: (loser: Civ, launched: boolean) => void;
  onCityTaken?: (city: string, attacker: number, defender: number) => void;
  /** A capital falls while its owner still holds it; true when the government got away. */
  capitalFalls?: (city: City, loser: Civ, captor: Civ) => boolean;
  turn: number;
  difficulty: number;
  /** Conquest by force (true) or another transfer such as diplomacy (false). */
  conquest: boolean;
  /** Any civilization has discovered Guerilla Warfare. */
  guerillaWarfareDiscovered: boolean;
  /** Scenario flags. */
  forbidTechFromConquests?: boolean;
  forbidGovernmentSwitching?: boolean;
  /** Rank bytes per slot (the original's power ranking); defaults to equal ranks. */
  rank?: (slot: number) => number;
  /** Loser's reputation (for veteran partisans); default 4 = none veteran. */
  loserReputation?: number;
  /** Pick the stolen advance among candidates; default = highest AI value, later index on ties. */
  chooseAdvance?: (candidates: number[]) => number;
}

export interface CaptureEvent {
  plunder: number;
  liberated: boolean;
  destroyedImprovements: number[];
  lostCitizen: boolean;
  cityDestroyed: boolean;
  disbandedUnits: Unit[];
  rehomedUnits: Unit[];
  partisans: Unit[];
  stolenAdvance: number | null;
}

/** Plunder on capture (VERIFIED): treasury × size / (total population + 1). */
export function plunder(loser: Civ, city: City, loserPopulation: number): number {
  const t = loser.treasury;
  let gold: number;
  if (t < Math.trunc(32000 / Math.max(1, city.size)))
    gold = Math.trunc((city.size * t) / (loserPopulation + 1));
  else gold = Math.trunc(t / (loserPopulation + 1)) * city.size;
  if (gold < 0) gold = 32000;
  return Math.max(0, Math.min(t, gold));
}

/** Transfer `city` from `loser` to `captor`. Mutates the world; returns what happened. */
export function captureCity(
  world: World,
  rules: EngineRules,
  rng: Rng,
  city: City,
  captor: Civ,
  loser: Civ,
  ctx: CaptureContext,
): CaptureEvent {
  const liberated = city.previousOwner === captor.slot;
  const population = world.cities
    .filter((c) => c.owner === loser.slot)
    .reduce((s, c) => s + c.size, 0);
  const gold = plunder(loser, city, population);
  loser.treasury -= gold;
  if (captor.slot !== 0) captor.treasury += gold;

  city.shieldsStored = 0;
  city.inDisorder = false;
  city.celebrating = false;
  city.disorderRepeated = false;

  const destroyed: number[] = [];
  if (!liberated) {
    for (const i of [
      IMPROVEMENT.palace,
      IMPROVEMENT.temple,
      IMPROVEMENT.cathedral,
      IMPROVEMENT.courthouse,
    ]) {
      if (city.improvements[i]) {
        if (i === IMPROVEMENT.palace) {
          // Civil war, flight or a new Palace; a ship survives only a flight (0x00528720).
          const fled = ctx.capitalFalls?.(city, loser, captor) ?? false;
          if (!fled) {
            const launched = hasLaunched(loser);
            const started = hasStarted(loser);
            loseShip(loser);
            if (launched || started) ctx.shipLost?.(loser, launched);
          }
        }
        city.improvements[i] = false;
        destroyed.push(i);
      }
    }
  }
  if (ctx.conquest && !liberated) {
    // Half the improvements fall: every bit of one parity in the 40-bit field (0xAA or 0x55 masks).
    const keepOdd = rng.nextInt(2) === 0; // mask 0xAA keeps odd bit positions within each byte
    for (let i = 1; i < 39; i++) {
      if (!city.improvements[i]) continue;
      const bitOdd = (i & 1) === 1;
      if (bitOdd !== keepOdd) {
        city.improvements[i] = false;
        destroyed.push(i);
      }
    }
  }

  let lostCitizen = false;
  let cityDestroyed = false;
  if ((ctx.conquest && !liberated) || city.size > 1) {
    city.size -= 1;
    lostCitizen = true;
    if (city.size <= 0) {
      removeCity(world, rules, city);
      cityDestroyed = true;
    }
  }

  const disbanded: Unit[] = [];
  const rehomed: Unit[] = [];
  const partisans: Unit[] = [];
  let stolen: number | null = null;

  if (!cityDestroyed) {
    city.previousOwner = loser.slot;
    city.capturedTurn = ctx.turn;
    city.owner = captor.slot;
    captor.hadCity = true;
    remarkTerritory(world, city, loser.slot);
    for (const u of [...world.units]) {
      if (u.owner !== loser.slot || u.homeCity !== city.id) continue;
      if (u.type === PARTISANS_TYPE) {
        u.homeCity = null;
        continue;
      }
      const standingIn = world.cityAt(u.position.x, u.position.y);
      // VERIFIED 0x00528720: only a computer's lone defender in another of its cities stays, homed
      // there; any other unit of a computer's that dies in such a city leaves the city alarmed.
      if (!loser.isHuman && standingIn && standingIn.owner === loser.slot && standingIn !== city) {
        const defenders = world
          .unitsAt(standingIn.position.x, standingIn.position.y)
          .filter((x) => rules.units[x.type]?.role === 1).length;
        if (rules.units[u.type]?.role === 1 && defenders === 1) {
          u.homeCity = standingIn.id;
          rehomed.push(u);
          continue;
        }
        standingIn.attacked = true;
      }
      world.units.splice(world.units.indexOf(u), 1);
      disbanded.push(u);
    }
    if (captor.isHuman && captor.government > GOVERNMENT.fundamentalism && ctx.difficulty !== 0) {
      city.inDisorder = true;
    }
    if (!captor.isHuman && captor.slot === 0) {
      city.production = { kind: 'unit', index: 5 };
    } else {
      const p = city.production;
      const ok =
        p.kind === 'improvement'
          ? !city.improvements[p.index]
          : canBuildUnit(rules, captor, p.index);
      if (!ok)
        city.production = {
          kind: 'unit',
          index: initialProduction(rules, (t) => canBuildUnit(rules, captor, t)),
        };
    }
    // Partisans.
    const gov = (c: Civ) => c.government;
    const loserPartisanGovt =
      gov(loser) === GOVERNMENT.communism || gov(loser) === GOVERNMENT.democracy;
    if (
      !liberated &&
      (loserPartisanGovt ||
        ctx.guerillaWarfareDiscovered ||
        loser.knownAdvances[CONQUEST_ADVANCES.communism])
    ) {
      const rank = ctx.rank ?? (() => 0);
      const govDiff = Math.abs(gov(loser) - gov(captor));
      const rankDiff = Math.abs(rank(loser.slot) - rank(captor.slot));
      let count = Math.trunc((Math.trunc((city.size + 1 + 5) / 8) * (govDiff + rankDiff + 1)) / 2);
      if (!ctx.conquest) count = Math.trunc(count / 2);
      if (!loser.knownAdvances[CONQUEST_ADVANCES.conscription]) count -= 1;
      if (!loser.knownAdvances[CONQUEST_ADVANCES.guerillaWarfare]) {
        if (!loser.knownAdvances[CONQUEST_ADVANCES.communism]) count = 0;
        if (!loser.knownAdvances[CONQUEST_ADVANCES.gunpowder]) count = 0;
      } else if (!captor.knownAdvances[CONQUEST_ADVANCES.guerillaWarfare]) count <<= 1;
      else count += 1;
      const vetChance = Math.max(0, (ctx.loserReputation ?? 4) - 4);
      for (let n = 0; n < count; n++) {
        let best = 0;
        let spot: { x: number; y: number } | null = null;
        for (let i = 0; i < 20; i++) {
          const p = world.radiusSquare(city.position.x, city.position.y, i);
          if (
            !p ||
            !world.isLand(p.x, p.y) ||
            world.unitsAt(p.x, p.y).length > 0 ||
            world.cityAt(p.x, p.y)
          )
            continue;
          let score = (rules.terrain[world.terrainAt(p.x, p.y)]?.defenceHalves ?? 2) * 2;
          if (world.hasFlag(p.x, p.y, SquareFlag.Road)) score += 1;
          if (world.hasFlag(p.x, p.y, SquareFlag.Railroad)) score += 1;
          if (
            world.hasFlag(p.x, p.y, SquareFlag.Fortress) &&
            !world.hasFlag(p.x, p.y, SquareFlag.Airbase)
          )
            score <<= 1;
          if (score > best) {
            best = score;
            spot = p;
          }
        }
        if (!spot) break;
        const unit: Unit = {
          id: world.units.reduce((m, u) => Math.max(m, u.id), -1) + 1,
          position: { x: spot.x, y: spot.y },
          owner: loser.slot,
          type: PARTISANS_TYPE,
          veteran: vetChance > 0 && rng.nextInt(vetChance + 1) !== 0,
          hitPointsLost: 0,
          movesSpent: 0,
          fortified: true,
          homeCity: null,
          order: 1,
          workCounter: 0,
          gotoTarget: null,
          lastDirection: null,
          gotoSteps: 0,
        };
        world.units.push(unit);
        partisans.push(unit);
      }
    }
    // An advance from the conquered.
    if (captor.slot !== 0 && loser.slot !== 0 && !ctx.forbidTechFromConquests) {
      const candidates: number[] = [];
      for (let a = 0; a < rules.advances.length; a++) {
        const adv = rules.advances[a];
        if (!adv || captor.knownAdvances[a] || !loser.knownAdvances[a]) continue;
        if (adv.preq1.kind === 'never' && adv.preq2.kind === 'never') continue;
        if (ctx.forbidGovernmentSwitching && (GOVERNMENT_ADVANCES as readonly number[]).includes(a))
          continue;
        candidates.push(a);
      }
      if (candidates.length > 0) {
        const pick =
          ctx.chooseAdvance?.(candidates) ??
          candidates.reduce(
            (best, a) =>
              (rules.advances[a]?.aiValue ?? 0) >= (rules.advances[best]?.aiValue ?? 0) ? a : best,
            candidates[0] ?? 0,
          );
        grantAdvance(captor, pick, 'other');
        ctx.advanceGained?.(captor, pick);
        stolen = pick;
      }
    }
  }
  ctx.onCityTaken?.(city.name, captor.slot, loser.slot);
  return {
    plunder: gold,
    liberated,
    destroyedImprovements: destroyed,
    lostCitizen,
    cityDestroyed,
    disbandedUnits: disbanded,
    rehomedUnits: rehomed,
    partisans,
    stolenAdvance: stolen,
  };
}
