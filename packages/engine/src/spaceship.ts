/**
 * The spaceship.
 *
 * Ported from the part table (0x005bd798: limits 39/8/8/4/4/4, masses 1/4/4/16/16/16), the
 * per-civilization part limits (0x0053dcd0), the evaluation (0x0053e0bd: mass, life support,
 * energy, fuel, flight time, success, arrival year), building a part with the computer's launch
 * decision (0x0053f36b), the launch (0x0053e5cf), the space-race test (0x0053ff14) and the
 * arrival in the yearly routine (0x00467591: the landing wins the game; no loss roll exists —
 * the success percentage weights the score, 0x0047c9e0). VERIFIED unless marked INFERRED.
 * docs/engine/spaceship.md.
 */
import type { Civ, World } from './world.js';

export const PART_LIMITS = [39, 8, 8, 4, 4, 4] as const;
export const PART_MASSES = [1, 4, 4, 16, 16, 16] as const;
export const PART_NAMES = [
  'structural',
  'propulsion',
  'fuel',
  'habitation',
  'life support',
  'solar',
] as const;
/** Flag bits of the spaceship byte (civilization record +0x400). */
export const SHIP_FLAG = {
  started: 1,
  launched: 2,
  arrived: 4,
  fusion: 8,
  won: 16,
} as const;

export interface Spaceship {
  flags: number;
  /** Year the ship arrives (set at launch and re-estimated while building). */
  arrival: number;
  launchYear: number;
  /** Habitation modules at launch × 10,000 people, for the score. */
  population: number;
  /** structural, propulsion, fuel, habitation, life support, solar. */
  parts: Int16Array;
}

export function shipOf(civ: Civ): Spaceship {
  civ.spaceship ??= {
    flags: 0,
    arrival: 0,
    launchYear: 0,
    population: 0,
    parts: new Int16Array(6),
  };
  return civ.spaceship;
}
export function hasLaunched(civ: Civ): boolean {
  return ((civ.spaceship?.flags ?? 0) & SHIP_FLAG.launched) !== 0;
}
export function hasStarted(civ: Civ): boolean {
  return ((civ.spaceship?.flags ?? 0) & SHIP_FLAG.started) !== 0;
}

/**
 * How many of a part the structure supports (0x0053dcd0): propulsion `(s + 1) / 4`, fuel
 * `(s − 1) / 4`, habitation `(s + 1) / 8`, life support `(s − 3) / 8`, solar `(s − 7) / 8`, each
 * capped by the table; a computer player's modules count at most one each.
 */
export function partLimit(ship: Spaceship, part: number, isHuman: boolean): number {
  const limit = PART_LIMITS[part] ?? 0;
  const s = ship.parts[0] ?? 0;
  if (part === 0) return limit;
  if (part === 1 || part === 2) return clamp(limit, 0, Math.trunc((s + 1 - (part * 2 - 2)) / 4));
  let v = clamp(limit, 0, Math.trunc((s + 1 - (part * 4 - 12)) / 8));
  if (!isHuman) v = clamp(v, 0, 1);
  return Math.max(0, v);
}
function usable(ship: Spaceship, part: number, isHuman: boolean): number {
  return clamp(ship.parts[part] ?? 0, 0, partLimit(ship, part, isHuman));
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
/** Thrust units of n engines or tanks (0x0053e063): 1 each, 2 from the fifth, 3 from the seventh. */
export function thrust(n: number): number {
  let t = 0;
  for (let i = 0; i < n; i++) t += 1 + (i > 3 ? 1 : 0) + (i > 5 ? 1 : 0);
  return t;
}

export interface ShipEvaluation {
  mass: number;
  lifeSupportPct: number;
  energyPct: number;
  fuelPct: number;
  /** Flight time in tenths of a year. */
  flightTenths: number;
  /** Chance of success, 0–100. */
  success: number;
  /** Arrival year when launched now. */
  arrivalYear: number;
}

/**
 * Evaluate the ship (0x0053e0bd). `massThrust` is the rules' Mass/Thrust paradigm; `display`
 * folds the life-support coverage into the success as the spaceship screen does (the computer's
 * launch test calls it without — VERIFIED quirk).
 */
export function evaluateShip(
  ship: Spaceship,
  isHuman: boolean,
  massThrust: number,
  knowsFusion: boolean,
  year: number,
  display = false,
): ShipEvaluation {
  if (knowsFusion) ship.flags |= SHIP_FLAG.fusion;
  let mass = 0;
  for (let i = 0; i < 6; i++) mass += (ship.parts[i] ?? 0) * (PART_MASSES[i] ?? 0);
  let massFull = mass;
  for (let i = 0; i < 6; i++) if ((ship.parts[i] ?? 0) === 0) massFull += PART_MASSES[i] ?? 0;
  let success = 100;
  const hab = usable(ship, 3, isHuman);
  const life = usable(ship, 4, isHuman);
  const sol = usable(ship, 5, isHuman);
  const lifeSupportPct = Math.trunc((life * 100) / Math.max(1, hab));
  if (display) success = Math.trunc((clamp(lifeSupportPct, 0, 100) * success) / 100);
  const energyPct = Math.trunc((sol * 200) / Math.max(1, hab + life));
  success = Math.trunc((clamp(energyPct, 0, 100) * success) / 100);
  const prop = usable(ship, 1, isHuman);
  const fuel = usable(ship, 2, isHuman);
  const fuelPct = Math.trunc((fuel * 100) / Math.max(1, prop));
  let speed = (ship.flags & SHIP_FLAG.fusion) !== 0 ? (massThrust * 3) >> 2 : massThrust;
  let doublings = 1;
  while (speed > 100) {
    speed >>= 1;
    doublings <<= 1;
  }
  // INFERRED: the decompiler shows the fuel's thrust capping the engines' thrust.
  const units = Math.min(thrust(prop), thrust(fuel));
  let flightTenths = Math.trunc((mass * speed) / (units * 10 + 1));
  let travel = Math.trunc((speed * massFull) / (units * 10 + 1));
  if (doublings > 1) {
    flightTenths *= doublings;
    travel *= doublings;
  }
  if (flightTenths > 150) success -= Math.trunc((flightTenths - 150) / 10);
  success = clamp(success, 0, 100);
  return {
    mass,
    lifeSupportPct,
    energyPct,
    fuelPct,
    flightTenths,
    success,
    arrivalYear: year + Math.trunc(travel / 10),
  };
}

/**
 * The computer's next part kind (0x0053ef43, VERIFIED): asked for `kind` (0 structural, 1
 * component, 2 module) when a part completes, it answers the kind to add — −1 once launched, −2
 * when nothing of the sort can be built. "Racing" means the ship's arrival is set, within 14
 * years and ahead of every human's. A structural request turns to modules while the structure
 * allows more modules than are usable, else (not racing) to components; a request the ship can
 * use and the player can build stands (components never while racing); otherwise the kinds are
 * tried from modules down — to components for a structural request, to structurals for the
 * others — taking the first buildable kind with room. A structural answer becomes components
 * when a human has launched a ship due no later than this one's estimate, components are not
 * complete, their advance is known and either count is within its structural limit. "Can
 * build" means: the kind's count is below its structural limit (or zero), the kind is not
 * complete, and its advance is known.
 */
export function aiNextPartKind(
  world: World,
  civ: Civ,
  kind: number,
  ctx: SpaceshipContext,
): number {
  const ship = shipOf(civ);
  const human = ctx.isHuman(civ.slot);
  const estimate = evaluateShip(
    ship,
    human,
    ctx.massThrust,
    ctx.knowsFusion(civ.slot),
    ctx.year,
    false,
  ).arrivalYear;
  if (hasLaunched(civ)) return -1;
  let earliestHuman = 9999;
  for (const o of world.civs) {
    if (o.slot === 0 || !ctx.isHuman(o.slot)) continue;
    const a = o.spaceship?.arrival ?? 0;
    if (a > 0 && a < earliestHuman) earliestHuman = a;
  }
  const racing =
    ship.arrival !== 0 && ship.arrival - ctx.year <= 14 && ship.arrival < earliestHuman;
  const partsOf = (k: number) => (k === 0 ? [0] : k === 1 ? [1, 2] : [3, 4, 5]);
  const usableByKind = (k: number) => partsOf(k).reduce((s, p) => s + usable(ship, p, human), 0);
  const limitByKind = (k: number) => partsOf(k).reduce((s, p) => s + partLimit(ship, p, human), 0);
  const countByKind = (k: number) => partsOf(k).reduce((s, p) => s + (ship.parts[p] ?? 0), 0);
  const canBuild = (k: number) =>
    (countByKind(k) < limitByKind(k) || countByKind(k) === 0) &&
    !kindComplete(ship, k) &&
    (ctx.knowsPartAdvance?.(civ.slot, k) ?? true);
  let switched = false;
  if (kind === 0) {
    if (usableByKind(2) < limitByKind(2)) switched = true;
    else if (!racing && usableByKind(1) < limitByKind(1)) switched = true;
  }
  let chosen = kind;
  let done = false;
  if (
    !switched &&
    (kind !== 1 || !racing) &&
    usableByKind(kind) < limitByKind(kind) &&
    canBuild(kind)
  )
    done = true;
  if (!done) {
    for (let k = 2; k >= (kind === 0 ? 1 : 0); k--) {
      if (canBuild(k) && (k !== 1 || !racing) && usableByKind(k) < limitByKind(k)) {
        chosen = k;
        break;
      }
    }
  }
  if (chosen === 0) {
    for (const o of world.civs) {
      if (o.slot === 0 || !ctx.isHuman(o.slot) || !hasLaunched(o)) continue;
      if ((o.spaceship?.arrival ?? 0) > estimate) continue;
      if (kindComplete(ship, 1) || !(ctx.knowsPartAdvance?.(civ.slot, 1) ?? true)) continue;
      if ((ship.parts[1] ?? 0) <= partLimit(ship, 1, human)) return 1;
      if ((ship.parts[2] ?? 0) <= partLimit(ship, 2, human)) return 1;
    }
  }
  return canBuild(chosen) ? chosen : -2;
}

/** Can the civilization add another part of this production kind (0 structural, 1 component, 2 module)? (0x0053fbd4) */
export function kindComplete(ship: Spaceship, kind: number): boolean {
  const p = ship.parts;
  if (kind === 0) return (p[0] ?? 0) >= PART_LIMITS[0];
  if (kind === 1) return (p[1] ?? 0) >= PART_LIMITS[1] && (p[2] ?? 0) >= PART_LIMITS[2];
  return (
    (p[3] ?? 0) >= PART_LIMITS[3] && (p[4] ?? 0) >= PART_LIMITS[4] && (p[5] ?? 0) >= PART_LIMITS[5]
  );
}

export interface SpaceshipContext {
  turn: number;
  year: number;
  difficulty: number;
  massThrust: number;
  isHuman: (slot: number) => boolean;
  knowsFusion: (slot: number) => boolean;
  /** Power ranking per slot (the original's 0x005da842), higher is stronger. */
  rank: (slot: number) => number;
  /** The computer re-chooses every city's production on launch; the game passes it. */
  rechooseProduction?: (slot: number) => void;
  /** Does the slot know the advance of the parts of this kind (RULES @IMPROVE 35–37)? Default yes. */
  knowsPartAdvance?: (slot: number, kind: number) => boolean;
}

export interface SpaceshipEvent {
  kind: 'spaceship';
  text: string;
  slot: number;
}

/**
 * Add a part of a production kind (0x0053f36b). Components go to the emptier of propulsion and
 * fuel, modules to the lowest of the three (a human chooses in the original — INFERRED: the
 * same pick). Returns the part index, or −1 when the kind is complete. The first part marks
 * the ship started and clears every human's war-turn memory (VERIFIED oddity of the original).
 * Afterwards a computer player decides whether to launch.
 */
export function buildPart(
  world: World,
  civ: Civ,
  kind: number,
  ctx: SpaceshipContext,
  events: SpaceshipEvent[],
): number {
  const ship = shipOf(civ);
  if (hasLaunched(civ) || kindComplete(ship, kind)) return -1;
  const human = ctx.isHuman(civ.slot);
  let part: number;
  if (kind === 0) part = 0;
  else if (kind === 1) part = (ship.parts[1] ?? 0) < (ship.parts[2] ?? 0) ? 1 : 2;
  else {
    part = 3;
    for (let i = 4; i < 6; i++) if ((ship.parts[i] ?? 0) < (ship.parts[part] ?? 0)) part = i;
  }
  if ((ship.parts[part] ?? 0) >= (PART_LIMITS[part] ?? 0)) return -1;
  if (!hasStarted(civ)) {
    ship.flags |= SHIP_FLAG.started;
    for (const other of world.civs) {
      if (other.slot === 0 || !ctx.isHuman(other.slot)) continue;
      if (other.slot !== civ.slot && hasStarted(other)) continue;
      other.lastWarTurns?.fill(0);
    }
  }
  ship.parts[part] = (ship.parts[part] ?? 0) + 1;
  events.push({
    kind: 'spaceship',
    text: `${civ.name} complete a ${PART_NAMES[part] ?? 'part'} section`,
    slot: civ.slot,
  });
  const ev = evaluateShip(ship, human, ctx.massThrust, ctx.knowsFusion(civ.slot), ctx.year);
  if (!hasLaunched(civ)) ship.arrival = ev.arrivalYear;
  if (!human) aiLaunchDecision(world, civ, ev, ctx, events);
  return part;
}

/** The computer's launch rule after a part (VERIFIED order; the deepest branch INFERRED). */
function aiLaunchDecision(
  world: World,
  civ: Civ,
  ev: ShipEvaluation,
  ctx: SpaceshipContext,
  events: SpaceshipEvent[],
): void {
  const ship = shipOf(civ);
  if (hasLaunched(civ) || ev.success <= 39) return;
  const hullDone = [0, 1, 2].every((k) => (ship.parts[k] ?? 0) >= (PART_LIMITS[k] ?? 0));
  if (hullDone) {
    launchShip(world, civ, ctx, events);
    return;
  }
  let humanLaunched: Civ | null = null;
  for (const o of world.civs) {
    if (o.slot === 0 || !ctx.isHuman(o.slot) || !hasLaunched(o)) continue;
    if (!humanLaunched || (o.spaceship?.arrival ?? 0) < (humanLaunched.spaceship?.arrival ?? 0))
      humanLaunched = o;
  }
  if (!humanLaunched && ctx.difficulty > 3) {
    for (const o of world.civs) {
      if (o.slot === 0 || o.slot === civ.slot || ctx.isHuman(o.slot) || !hasLaunched(o)) continue;
      if ((o.spaceship?.arrival ?? 0) < ship.arrival) return;
    }
  }
  if (!humanLaunched) {
    let go = ev.success > 75;
    if (!go) {
      for (const o of world.civs) {
        if (o.slot === 0 || !ctx.isHuman(o.slot)) continue;
        if (ctx.rank(civ.slot) < ctx.rank(o.slot)) go = true;
        if (hasStarted(o) && o.treasury > 999) go = true;
      }
    }
    if (go) launchShip(world, civ, ctx, events);
  } else if (ship.arrival < (humanLaunched.spaceship?.arrival ?? 0))
    launchShip(world, civ, ctx, events);
}

/** Launch (0x0053e5cf): the ship is fixed, the arrival year set, the first launch turn kept. */
export function launchShip(
  world: World,
  civ: Civ,
  ctx: SpaceshipContext,
  events: SpaceshipEvent[],
): void {
  const ship = shipOf(civ);
  if (hasLaunched(civ)) return;
  const human = ctx.isHuman(civ.slot);
  const ev = evaluateShip(ship, human, ctx.massThrust, ctx.knowsFusion(civ.slot), ctx.year);
  ship.population = usable(ship, 3, human);
  ship.launchYear = ctx.year;
  ship.arrival = ev.arrivalYear;
  ship.flags |= SHIP_FLAG.launched;
  events.push({
    kind: 'spaceship',
    text: `${civ.name} launch their spaceship; arrival ${ship.arrival}`,
    slot: civ.slot,
  });
  if (!human) ctx.rechooseProduction?.(civ.slot);
  void world;
}

/** The ship is lost (the capital falls): parts and flags cleared (VERIFIED: the capture routine tests the started flag). */
export function loseShip(civ: Civ): boolean {
  if (!civ.spaceship || !hasStarted(civ) || hasLaunched(civ)) return false;
  civ.spaceship = { flags: 0, arrival: 0, launchYear: 0, population: 0, parts: new Int16Array(6) };
  return true;
}

/** Arrivals this year (0x00467591): the first launched ship whose year has come lands and wins. */
export function checkArrivals(world: World, year: number, events: SpaceshipEvent[]): Civ | null {
  for (const civ of world.civs) {
    if (civ.slot === 0 || !civ.inPlay || !hasLaunched(civ)) continue;
    const ship = shipOf(civ);
    if ((ship.flags & SHIP_FLAG.arrived) !== 0 || year < ship.arrival) continue;
    ship.flags |= SHIP_FLAG.arrived | SHIP_FLAG.won;
    events.push({
      kind: 'spaceship',
      text: `the ${civ.name} spaceship reaches Alpha Centauri`,
      slot: civ.slot,
    });
    return civ;
  }
  return null;
}

/** Score credit for the ship (0x0047c9e0): population aboard × success. */
export function shipScore(
  civ: Civ,
  isHuman: boolean,
  massThrust: number,
  knowsFusion: boolean,
  year: number,
): number {
  const ship = civ.spaceship;
  if (!ship || ship.population === 0) return 0;
  return ship.population * evaluateShip(ship, isHuman, massThrust, knowsFusion, year, true).success;
}

/**
 * Is the space race on (VERIFIED 0x0053feba)? Never under bloodlust; otherwise once the Apollo
 * Program is built or a human knows Space Flight (advance 76).
 */
export function spaceRaceOn(ctx: {
  bloodlust: boolean;
  apolloBuilt: boolean;
  humanKnowsSpaceFlight: boolean;
}): boolean {
  if (ctx.bloodlust) return false;
  return ctx.apolloBuilt || ctx.humanKnowsSpaceFlight;
}

/**
 * Does the space race press on a computer player (VERIFIED 0x0053ff14)? Only while the race is
 * on, the game not ended, above Chieftain, for a computer player that has not launched: yes when
 * a human has launched, or when a human knowing Space Flight has a ship worth at least as much —
 * parts weighted by the RULES cost of their kind (structural; components; modules).
 */
export function spaceRacePressure(
  world: World,
  civ: Civ,
  ctx: {
    raceOn: boolean;
    gameEnded: boolean;
    difficulty: number;
    isHuman: (slot: number) => boolean;
    knows: (slot: number, advance: number) => boolean;
    /** RULES cost rows of the spaceship improvement for a part kind 0 structural, 1 component, 2 module. */
    partCostRows: (kind: number) => number;
  },
): boolean {
  if (!ctx.raceOn || hasLaunched(civ) || ctx.gameEnded || ctx.difficulty === 0) return false;
  if (ctx.isHuman(civ.slot)) return false;
  const humans = world.civs.filter((c) => c.slot !== 0 && ctx.isHuman(c.slot));
  if (humans.some((h) => hasLaunched(h))) return true;
  const value = (c: Civ) => {
    const ship = c.spaceship;
    if (!ship) return 0;
    let v = 0;
    for (let i = 0; i < 6; i++)
      v += (ship.parts[i] ?? 0) * ctx.partCostRows(Math.min(2, (i + 1) >> 1));
    return v;
  };
  const mine = value(civ);
  return humans.some((h) => h.slot !== civ.slot && ctx.knows(h.slot, 76) && mine <= value(h));
}
