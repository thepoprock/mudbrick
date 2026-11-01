/**
 * Treaties between human players (the original's Parley, carried out by 0x004ab8d5). One player
 * offers, the other accepts, and each item takes effect in the order given. An offer waits in the
 * game state, so it reaches the other player the same way in hot seat, by file and over a relay.
 * VERIFIED for the effects; the waiting list is ours, since the original holds a live dialog open
 * over its network layer.
 */
import { adjustAttitude, clearTreaty, hasTreaty, setTreaty, TREATY } from './diplomacy.js';
import { goldGoodwill } from './negotiation.js';
import { OCEAN, type City, type Point, type Unit, type World } from './world.js';
import { DOMAIN_AIR, DOMAIN_GROUND, DOMAIN_SEA, type EngineRules } from './rules.js';
import { distance } from './city.js';

export type ParleyItem =
  /** 0x004ad5bb: cease fire, peace, alliance, or an end to all three. */
  | { kind: 'treaty'; level: 'ceaseFire' | 'peace' | 'alliance' | 'cancel' }
  | { kind: 'gold'; amount: number }
  | { kind: 'advances'; list: number[] }
  /** 0x004abefd: the giver's explored squares become known to the receiver. */
  | { kind: 'map' }
  | { kind: 'units'; ids: number[] }
  | { kind: 'cities'; ids: number[] }
  /** 0x004ac326: the receiver of this item goes to war with each slot. */
  | { kind: 'war'; on: number[] };

export interface ParleyOffer {
  id: number;
  from: number;
  to: number;
  /** What `from` hands over. */
  give: ParleyItem[];
  /** What `from` asks of `to`; empty for a gift. */
  take: ParleyItem[];
}

export interface ParleyContext {
  grantAdvance: (receiver: number, advance: number, giver: number) => void;
  giveCity: (city: City, receiver: number) => void;
}

/** Spiral of squares searched for a place to set a unit down (0x004ad1b3). */
function placeFor(world: World, rules: EngineRules, unit: Unit, owner: number): Point | null {
  const domain = rules.units[unit.type]?.domain;
  const fits = (p: Point) => {
    const ocean = world.terrainAt(p.x, p.y) === OCEAN;
    if (domain === DOMAIN_GROUND && ocean) return false;
    if (domain === DOMAIN_SEA && !ocean) return false;
    if (domain !== DOMAIN_GROUND && domain !== DOMAIN_SEA && domain !== DOMAIN_AIR) return false;
    const city = world.cityAt(p.x, p.y);
    if (city && city.owner !== owner) return false;
    return !world.unitsAt(p.x, p.y).some((u) => u.owner !== owner);
  };
  const here = unit.position;
  if (!world.cityAt(here.x, here.y) && !world.unitsAt(here.x, here.y).some((u) => u !== unit))
    return here;
  for (let i = 0; i < 44; i++) {
    const p = world.radiusSquare(here.x, here.y, i);
    if (p && fits(p)) return p;
  }
  return null;
}

/** 0x004ace3c: a unit in a stack of ships' cargo leaves the stack first; home is the nearest city. */
function giveUnit(world: World, rules: EngineRules, unit: Unit, to: number): void {
  if (unit.owner === to) return;
  const was = unit.owner;
  if (rules.units[unit.type]?.domain === DOMAIN_SEA) {
    for (const u of world.unitsAt(unit.position.x, unit.position.y)) {
      if (u === unit || u.owner !== was) continue;
      const p = placeFor(world, rules, u, was);
      if (p) u.position = { x: p.x, y: p.y };
      else world.units.splice(world.units.indexOf(u), 1);
    }
  }
  const spot = placeFor(world, rules, unit, to);
  if (!spot) return;
  unit.position = { x: spot.x, y: spot.y };
  unit.owner = to;
  unit.order = null;
  unit.gotoTarget = null;
  unit.movesSpent = 0;
  let best: City | null = null;
  let bestD = 9999;
  for (const c of world.cities) {
    if (c.owner !== to) continue;
    const d = distance(world, unit.position, c.position);
    if (d <= bestD) {
      best = c;
      bestD = d;
    }
  }
  unit.homeCity = best?.id ?? null;
}

function treaty(world: World, a: number, b: number, level: string): void {
  if (level === 'cancel') {
    for (const t of [TREATY.ceaseFire, TREATY.peace, TREATY.alliance])
      if (hasTreaty(world, a, b, t)) clearTreaty(world, a, b, t);
    return;
  }
  const bit =
    level === 'ceaseFire' ? TREATY.ceaseFire : level === 'peace' ? TREATY.peace : TREATY.alliance;
  setTreaty(world, a, b, bit);
}

function apply(
  world: World,
  rules: EngineRules,
  item: ParleyItem,
  from: number,
  to: number,
  ctx: ParleyContext,
): void {
  const civ = (s: number) => world.civs.find((c) => c.slot === s);
  switch (item.kind) {
    case 'treaty':
      treaty(world, from, to, item.level);
      break;
    case 'gold': {
      const payer = civ(from);
      const payee = civ(to);
      if (!payer || !payee) break;
      const amount = Math.max(0, Math.min(item.amount, payer.treasury));
      payer.treasury -= amount;
      payee.treasury += amount;
      adjustAttitude(world, to, from, -Math.trunc((goldGoodwill(amount) * 3) / 2));
      break;
    }
    case 'advances':
      for (const a of item.list) {
        if (civ(from)?.knownAdvances[a] && !civ(to)?.knownAdvances[a])
          ctx.grantAdvance(to, a, from);
      }
      break;
    case 'map': {
      const giver = 1 << from;
      const taker = 1 << to;
      for (let i = 0; i < world.seen.length; i++) {
        if (((world.seen[i] ?? 0) & giver) !== 0) world.seen[i] = (world.seen[i] ?? 0) | taker;
      }
      break;
    }
    case 'units':
      for (const id of item.ids) {
        const u = world.units.find((x) => x.id === id);
        if (u) giveUnit(world, rules, u, to);
      }
      break;
    case 'cities':
      for (const id of item.ids) {
        const c = world.cities.find((x) => x.id === id);
        if (c && c.owner === from) ctx.giveCity(c, to);
      }
      break;
    case 'war':
      for (const s of item.on) setTreaty(world, to, s, TREATY.war);
      break;
  }
}

/** Carry the offer out: what `to` gives first, as the original runs a swap's second half first. */
export function executeParley(
  world: World,
  rules: EngineRules,
  offer: ParleyOffer,
  ctx: ParleyContext,
): void {
  for (const item of offer.take) apply(world, rules, item, offer.to, offer.from, ctx);
  for (const item of offer.give) apply(world, rules, item, offer.from, offer.to, ctx);
}
