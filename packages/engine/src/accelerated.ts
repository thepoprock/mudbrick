/**
 * The accelerated start (0x00482a65, terrain 0x00482693): the game opens at turn 21 or 41 with each
 * civilization already settled. VERIFIED. docs/engine/new-game.md.
 */
import { foundCity } from './founding.js';
import { grantAdvance } from './research.js';
import { gridDistance } from './city.js';
import { walkPath } from './aiTerraform.js';
import { researchableAdvances } from './outcome.js';
import { CITY_SPACING_OFFSETS } from './fertility.js';
import { grasslandShieldAt, specialAt } from './terrainSpecials.js';
import type { Rng } from './rng.js';
import type { EngineRules } from './rules.js';
import {
  NEIGHBOUR_OFFSETS,
  OCEAN,
  SquareFlag,
  type City,
  type Civ,
  type Point,
  type Unit,
  type World,
} from './world.js';

const WARRIOR_LINE = { archers: 4, pikemen: 6, phalanx: 3, legion: 5 };
const MOUNTED = { horsemen: 15, chariot: 16, elephants: 17 };
const IMPROVEMENT = { barracks: 2, granary: 3, temple: 4, marketplace: 5, colosseum: 14 };
const FIRST_ADVANCES = [36, 9, 1, 8];
const RICH_ADVANCES = [20, 47, 18, 56, 12, 54];
const BRIDGE_BUILDING = 7;

/** The turn the game opens on at a level: 21 at level 0, 41 at level 1. */
export function acceleratedTurn(level: number): number {
  return (level * 4 + 4) * 5 + 1;
}

/** Roads and irrigation on the best empty squares, and sight of the land around (0x00482693). */
function improveLand(world: World, rules: EngineRules, city: City, count: number): void {
  const { x, y } = city.position;
  const at = (i: number): Point | null => {
    const off = CITY_SPACING_OFFSETS[i];
    if (!off) return null;
    const py = y + off.y;
    if (py < 0 || py >= world.rows) return null;
    const px = world.wrapX(x + off.x, py);
    return px === null ? null : { x: px, y: py };
  };
  const improved = SquareFlag.Road | SquareFlag.Irrigation | SquareFlag.Mine;
  for (let n = 0; n < count; n++) {
    let best = 0;
    let pick: Point | null = null;
    for (let i = 0; i < 20; i++) {
      const p = at(i);
      if (!p) continue;
      const k = world.index(p.x, p.y);
      if (((world.flags[k] ?? 0) & improved) !== 0 || world.cityAt(p.x, p.y)) continue;
      let v = 0;
      const t = world.terrainAt(p.x, p.y);
      if (t === 0) v = 1;
      else if (t === 1) v = 4;
      else if (t === 2) v = grasslandShieldAt(p.x, p.y) ? 5 : 3;
      else if (t === 4) v = 2;
      if (v === 0) continue;
      if (i < 8) v += 1;
      if (specialAt(world, p.x, p.y) !== 0) v += 3;
      if (best < v) {
        best = v;
        pick = p;
      }
    }
    if (!pick) break;
    world.setFlag(pick.x, pick.y, SquareFlag.Road, true);
    const hills = world.terrainAt(pick.x, pick.y) === 4;
    world.setFlag(pick.x, pick.y, hills ? SquareFlag.Mine : SquareFlag.Irrigation, true);
  }
  const land = (world.landmass[world.index(x, y)] ?? 0) & 63;
  for (let i = 0; i < CITY_SPACING_OFFSETS.length; i++) {
    const p = at(i);
    if (!p || world.terrainAt(p.x, p.y) === OCEAN) continue;
    const k = world.index(p.x, p.y);
    if (((world.landmass[k] ?? 0) & 63) !== land) continue;
    world.seen[k] = (world.seen[k] ?? 0) | (1 << city.owner);
  }
  void rules;
}

/** Give every civilization its head start; the caller sets the turn from `acceleratedTurn`. */
export function acceleratedStart(
  world: World,
  rules: EngineRules,
  rng: Rng,
  level: number,
  place: (type: number, owner: number, x: number, y: number) => Unit,
): void {
  const knows = (c: Civ, a: number) => c.knownAdvances[a] === true;
  for (let slot = 1; slot < 8; slot++) {
    const civ = world.civs.find((c) => c.slot === slot);
    const start = world.units.filter((u) => u.owner === slot).at(-1);
    if (!civ || !start) continue;
    const { x, y } = start.position;
    for (const a of FIRST_ADVANCES) grantAdvance(civ, a, 'other', true);
    civ.advancesCount = 4;
    if (level !== 0) {
      for (let i = 0; i < 3; i++) {
        const choices = researchableAdvances(rules, civ);
        const a = choices[rng.nextInt(Math.max(1, choices.length))];
        if (a !== undefined) grantAdvance(civ, a, 'other', true);
        civ.advancesCount += 1;
      }
    }
    let names = 0;
    const name = () => `${civ.adjective} City ${++names}`;
    const home = foundCity(world, rules, civ, start, { name: name() });
    civ.treasury = (rng.nextInt(50) + 25) * (level + 1);
    home.size = level === 0 ? 3 : 5;
    const unit = (type: number, at: Point, fort: boolean, city: City) => {
      const u = place(type, slot, at.x, at.y);
      u.homeCity = city.id;
      if (fort) {
        u.fortified = true;
        u.order = 2;
      }
      return u;
    };
    start.homeCity = home.id;
    const first =
      home.production.kind === 'unit' && home.production.index === WARRIOR_LINE.pikemen
        ? WARRIOR_LINE.pikemen
        : WARRIOR_LINE.archers;
    unit(first, { x, y }, true, home);
    unit(WARRIOR_LINE.phalanx, { x, y }, true, home);
    unit(knows(civ, 87) ? MOUNTED.chariot : MOUNTED.horsemen, { x, y }, false, home);
    if (level !== 0)
      unit(knows(civ, 64) ? MOUNTED.elephants : MOUNTED.chariot, { x, y }, false, home);
    home.improvements[IMPROVEMENT.temple] = true;
    if (level !== 0) {
      if (knows(civ, 65)) home.improvements[IMPROVEMENT.granary] = true;
      home.improvements[knows(civ, 20) ? IMPROVEMENT.marketplace : IMPROVEMENT.barracks] = true;
    }
    improveLand(world, rules, home, level === 0 ? 2 : 4);
    if (level === 0) continue;

    // A second city five squares out on the best open ground, or else a richer capital.
    const land = (world.landmass[world.index(x, y)] ?? 0) & 63;
    let best = -1;
    let site: Point | null = null;
    for (const off of NEIGHBOUR_OFFSETS) {
      const py = y + off.y * 5;
      const px = py >= 0 && py < world.rows ? world.wrapX(x + off.x * 5, py) : null;
      if (px === null || !world.isSquare(px, py)) continue;
      if (world.terrainAt(px, py) === OCEAN) continue;
      if (((world.landmass[world.index(px, py)] ?? 0) & 63) !== land) continue;
      let near = 99;
      for (const u of world.units) {
        if (world.cityAt(u.position.x, u.position.y)) continue;
        near = Math.min(near, gridDistance(world, u.position, { x: px, y: py }));
      }
      for (const c of world.cities)
        near = Math.min(near, gridDistance(world, c.position, { x: px, y: py }));
      if (near <= 4) continue;
      const t = world.terrainAt(px, py);
      let v = t === 2 ? 4 : t === 1 ? 2 : 0;
      if (v === 0) continue;
      if (world.hasFlag(px, py, SquareFlag.River)) v += 1;
      if (best < v) {
        best = v;
        site = { x: px, y: py };
      }
    }
    if (!site) {
      for (const a of RICH_ADVANCES) grantAdvance(civ, a, 'other', true);
      home.size = 7;
      home.improvements[IMPROVEMENT.colosseum] = true;
      civ.treasury += 25;
      improveLand(world, rules, home, 2);
      unit(WARRIOR_LINE.archers, { x, y }, false, home);
      unit(WARRIOR_LINE.legion, { x, y }, false, home);
      unit(MOUNTED.chariot, { x, y }, false, home);
      continue;
    }
    const settler = place(0, slot, site.x, site.y);
    const second = foundCity(world, rules, civ, settler, { name: name() });
    world.units.splice(world.units.indexOf(settler), 1);
    second.size = 3;
    const coin = rng.nextInt(2) === 0;
    unit(coin ? 2 : 3, site, true, second);
    unit(coin ? 4 : 3, site, true, second);
    unit(MOUNTED.horsemen, site, false, second);
    improveLand(world, rules, second, 2);
    if (gridDistance(world, second.position, home.position) < 23) {
      walkPath(world, rules, slot, second.position, home.position, (p) => {
        const river = world.hasFlag(p.x, p.y, SquareFlag.River);
        if (
          !world.cityAt(p.x, p.y) &&
          !world.hasFlag(p.x, p.y, SquareFlag.Road) &&
          (!river || knows(civ, BRIDGE_BUILDING)) &&
          world.unitsAt(p.x, p.y).length === 0
        )
          world.setFlag(p.x, p.y, SquareFlag.Road, true);
        return true;
      });
    }
  }
}
