/**
 * What follows the fall of a capital (0x00528720): civil war (0x00527a44), the flight of the
 * government, or a new Palace in production. VERIFIED. docs/engine/diplomacy.md, "A capital falls".
 */
import { distance } from './city.js';
import { treatiesOf, TREATY } from './diplomacy.js';
import { remarkTerritory } from './fertility.js';
import { IMPROVEMENT } from './rules.js';
import type { EngineRules } from './rules.js';
import type { City, Civ, World } from './world.js';

const SAM = 27;
const SDI = 17;

function landOf(world: World, c: City): number {
  return (world.landmass[world.index(c.position.x, c.position.y)] ?? 0) & 63;
}

/** The city nearest the others of its owner: the new capital (0x005277c5). */
export function mostCentralCity(world: World, slot: number, except?: City): City | null {
  const own = world.cities.filter((c) => c.owner === slot && c !== except);
  let best: City | null = null;
  let least = 0x7fff;
  for (const c of own) {
    let sum = 0;
    for (const o of own) sum += distance(world, c.position, o.position);
    if (sum < least) {
      least = sum;
      best = c;
    }
  }
  return best;
}

export interface CivilWarContext {
  turn: number;
  /** Re-seat a slot as a new civilization (0x00480fc9); false when none can start. */
  restart: (slot: number) => boolean;
  /** Scenario NOSCHISM event for the civilization (0x004c3fdd). */
  noSchism?: (slot: number) => boolean;
}

/** A civilization splits; true if it happened. The rebels hold what is furthest from the throne. */
export function civilWar(
  world: World,
  rules: EngineRules,
  loser: Civ,
  ctx: CivilWarContext,
): boolean {
  if (ctx.noSchism?.(loser.slot) === true) return false;
  let slot = -1;
  for (let s = 1; s < 8; s++) {
    if (!world.units.some((u) => u.owner === s) && !world.cities.some((c) => c.owner === s))
      slot = s;
  }
  if (slot < 1) return false;
  const sizes = new Array<number>(64).fill(0);
  let throne: City | null = null;
  for (const c of world.cities) {
    if (c.owner !== loser.slot) continue;
    sizes[landOf(world, c)] = (sizes[landOf(world, c)] ?? 0) + c.size;
    if (c.improvements[IMPROVEMENT.palace] && throne === null) throne = c;
  }
  if (!throne) return false;
  if (!ctx.restart(slot)) return false;
  const rebels = world.civs.find((c) => c.slot === slot);
  if (!rebels) return false;

  rebels.treasury = Math.trunc(loser.treasury / 2);
  loser.treasury -= rebels.treasury;
  rebels.government = loser.government;
  rebels.scienceStored = loser.scienceStored;
  rebels.advancesCount = loser.advancesCount;
  rebels.knownAdvances = [...loser.knownAdvances];
  for (const c of world.civs) {
    const t = c.lastWarTurns;
    if (t) t[slot] = ctx.turn - 8;
  }
  treatiesOf(rebels)[loser.slot] = TREATY.war | TREATY.contact;
  treatiesOf(loser)[slot] = 0x82801;
  const oldBit = 1 << loser.slot;
  const newBit = 1 << slot;
  for (let i = 0; i < world.area; i++) {
    if (((world.seen[i] ?? 0) & oldBit) !== 0) world.seen[i] = (world.seen[i] ?? 0) | newBit;
  }

  const hand = (c: City) => {
    const from = c.owner;
    c.owner = slot;
    remarkTerritory(world, c, from);
  };
  const home = landOf(world, throne);
  let keep = sizes[home] ?? 0;
  let away = 0;
  const side = new Array<number>(64).fill(0);
  for (let lm = 0; lm < 64; lm++) {
    const n = sizes[lm] ?? 0;
    if (n === 0) continue;
    if (keep < away || lm === home) {
      if (lm !== home) keep += n;
      side[lm] = 1;
    } else {
      away += n;
      side[lm] = 2;
    }
  }
  if (keep < away * 2 && away <= keep) {
    for (const c of [...world.cities]) {
      if (c.owner === loser.slot && side[landOf(world, c)] === 2) hand(c);
    }
  } else {
    const total = world.cities.reduce((n, c) => n + (c.owner === loser.slot ? c.size : 0), 0);
    let taken = 0;
    while (taken * 3 < total) {
      let far: City | null = null;
      let most = 1;
      for (const c of world.cities) {
        if (c.owner !== loser.slot) continue;
        const d = distance(world, throne.position, c.position);
        if (most < d) {
          most = d;
          far = c;
        }
      }
      if (!far) break;
      taken += far.size;
      hand(far);
    }
  }
  // Units follow the city they stand in, or else their home.
  for (const u of world.units) {
    if (u.owner !== loser.slot) continue;
    const c =
      world.cityAt(u.position.x, u.position.y) ?? world.cities.find((x) => x.id === u.homeCity);
    if (!c || (c.owner !== loser.slot && c.owner !== slot)) continue;
    u.owner = c.owner;
    const h = world.cities.find((x) => x.id === u.homeCity);
    if (h && h.owner !== c.owner) u.homeCity = c.id;
  }
  const capital = mostCentralCity(world, slot);
  if (capital) capital.improvements[IMPROVEMENT.palace] = true;
  const old = mostCentralCity(world, loser.slot, throne);
  if (old) old.improvements[IMPROVEMENT.palace] = true;
  void rules;
  return true;
}

/** Where the government would flee to (0x00528720), or null. */
export function escapeCity(
  world: World,
  city: City,
  slot: number,
  greatWall: boolean,
): City | null {
  let best = -999;
  let pick: City | null = null;
  for (const c of world.cities) {
    if (c.owner !== slot || c === city) continue;
    if (Math.trunc(city.size / 2) > c.size || c.size <= 7) continue;
    let v = c.size * 3 - distance(world, c.position, city.position);
    v += world.unitsAt(c.position.x, c.position.y).length * 4;
    if (c.improvements[SAM]) v = Math.trunc((v * 3) / 2);
    if (c.improvements[IMPROVEMENT.cityWalls] || greatWall) v <<= 1;
    if (c.improvements[SDI]) v *= 3;
    if (landOf(world, c) !== landOf(world, city)) v = Math.trunc(v / 2);
    if (best < v) {
      best = v;
      pick = c;
    }
  }
  return pick;
}
