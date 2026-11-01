/**
 * A nuclear detonation (VERIFIED 0x0052cb14, fallout 0x00559699). rules-combat.md, "Nuclear".
 */
import { gridDistance } from './city.js';
import { adjustAttitude, civOf, treatiesOf, TREATY } from './diplomacy.js';
import type { Rng } from './rng.js';
import { orderGoTo } from './orders.js';
import { IMPROVEMENT, type EngineRules } from './rules.js';
import { SquareFlag, type City, type Unit, type World } from './world.js';

/** An attack of 99 or more is a nuclear weapon. */
export const NUCLEAR_ATTACK = 99;

export interface Blast {
  /** The city's SDI Defense that stopped it, when one did. */
  stoppedBy: City | null;
  killed: Unit[];
  cities: City[];
}

function around(world: World, x: number, y: number) {
  const out = [{ x, y }];
  for (const n of world.neighbours(x, y)) if (n) out.push(n);
  return out;
}

/** What the blast leaves on the nine squares. Cities halve, rounded up, and take no fallout. */
export function fallout(world: World, rng: Rng, x: number, y: number): City[] {
  const hit: City[] = [];
  for (const p of around(world, x, y)) {
    const city = world.cityAt(p.x, p.y);
    if (city) {
      city.size -= city.size >> 1;
      hit.push(city);
      continue;
    }
    if (!world.isLand(p.x, p.y)) continue;
    if (
      world.hasFlag(p.x, p.y, SquareFlag.Fortress) &&
      !world.hasFlag(p.x, p.y, SquareFlag.Airbase)
    )
      world.setFlag(p.x, p.y, SquareFlag.Fortress, false);
    if (rng.nextInt(2) === 1) world.setFlag(p.x, p.y, SquareFlag.Railroad, false);
    if (rng.nextInt(2) === 1) world.setFlag(p.x, p.y, SquareFlag.Mine, false);
    if (rng.nextInt(2) === 1) world.setFlag(p.x, p.y, SquareFlag.Irrigation, false);
    if (rng.nextInt(3) !== 0) world.setFlag(p.x, p.y, SquareFlag.Pollution);
  }
  return hit;
}

/**
 * Detonate over (x, y). `checkSdi` is false for a spy's planted device. An SDI Defense within three
 * squares, not the attacker's, stops a missile. Every unit on the nine squares dies, and each
 * owner hit holds a vendetta and +100 attitude against the attacker.
 */
export function nuclearStrike(
  world: World,
  rng: Rng,
  attacker: number,
  x: number,
  y: number,
  checkSdi: boolean,
): Blast {
  if (checkSdi) {
    for (const c of world.cities) {
      if (c.owner === attacker || !c.improvements[IMPROVEMENT.sdiDefense]) continue;
      if (gridDistance(world, c.position, { x, y }) < 4)
        return { stoppedBy: c, killed: [], cities: [] };
    }
  }
  const killed: Unit[] = [];
  const me = civOf(world, attacker);
  for (const p of around(world, x, y)) {
    for (const u of world.unitsAt(p.x, p.y)) {
      killed.push(u);
      if (u.owner === attacker) continue;
      const them = civOf(world, u.owner);
      if (them)
        treatiesOf(them)[attacker] = (treatiesOf(them)[attacker] ?? 0) | TREATY.vendetta | 0x100;
      if (me) treatiesOf(me)[u.owner] = (treatiesOf(me)[u.owner] ?? 0) | (1 << 17);
      adjustAttitude(world, u.owner, attacker, 100);
    }
  }
  for (const u of killed) world.units.splice(world.units.indexOf(u), 1);
  return { stoppedBy: null, killed, cities: fallout(world, rng, x, y) };
}

/**
 * A computer player follows its strike (VERIFIED 0x0052cfed): a paratrooper in a city within range
 * drops on the square when it can, and every land attacker within six squares on the same land
 * mass, its own or a non-human ally's, heads for it.
 */
export function nuclearFollowUp(
  world: World,
  rules: EngineRules,
  attacker: number,
  x: number,
  y: number,
  isAlliedComputer: (slot: number) => boolean,
): void {
  const range = rules.cosmic.maxParadropRange ?? 0;
  const mass = world.landmass[world.index(x, y)];
  for (const u of world.units) {
    const t = rules.units[u.type];
    if (u.owner !== attacker || !t?.flags.canParadrop || !world.cityAt(u.position.x, u.position.y))
      continue;
    if (u.movesSpent !== 0 || u.dropped || gridDistance(world, u.position, { x, y }) > range)
      continue;
    if (!world.isLand(x, y) || world.unitsAt(x, y).some((o) => o.owner !== attacker)) break;
    u.position = { x, y };
    u.dropped = true;
    break;
  }
  for (const u of world.units) {
    const t = rules.units[u.type];
    if (!t || t.domain !== 0 || t.attack === 0) continue;
    if (u.owner !== attacker && !isAlliedComputer(u.owner)) continue;
    if (t.role === 1 && world.cityAt(u.position.x, u.position.y)) continue;
    if (gridDistance(world, u.position, { x, y }) >= 7) continue;
    if (world.landmass[world.index(u.position.x, u.position.y)] !== mass) continue;
    orderGoTo(u, { x, y });
  }
}
