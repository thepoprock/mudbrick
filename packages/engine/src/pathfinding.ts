/**
 * The go-to pathfinder (VERIFIED structure, 0x00484325, called by the go-to step chooser
 * 0x00485e3d): costs flow outward from the goal over a 48-square window, then the unit takes
 * the neighbour whose cost plus the step's cost is lowest, nearer to the goal on ties.
 *
 * Step costs as the original adds them (a road step is 4, so a full movement point is
 * `road multiplier × 4`): 1 along a railroad (or into a city from a railroad), 4 along a road
 * or a river, 4 for everything with the alpine flag, else `terrain move cost × road multiplier
 * × 4` for units with more than one movement point and `road multiplier × 4` for the rest.
 * Squares holding another civilization's units are impassable; a crowded square of own units
 * in a foreign zone of control adds 16 per unit of the same role; a square beside an enemy
 * unit adds a movement point for combat roles. Air units pay 1 a step. INFERRED details: the
 * river test is "both squares have a river", and the path search is a plain shortest-path
 * search rather than the original's ring buffer.
 */
import { distance } from './city.js';
import { DOMAIN_AIR, DOMAIN_GROUND, DOMAIN_SEA, type EngineRules } from './rules.js';
import {
  NEIGHBOUR_OFFSETS,
  OCEAN,
  SquareFlag,
  type Point,
  type Unit,
  type World,
} from './world.js';

const WINDOW = 48;
const MAX_COST = 999;

function neighbour(world: World, p: Point, dir: number): Point | null {
  const off = NEIGHBOUR_OFFSETS[dir];
  if (!off) return null;
  const y = p.y + off.y;
  if (y < 0 || y >= world.rows) return null;
  const x = world.wrapX(p.x + off.x, y);
  return x === null ? null : { x, y };
}

function manhattan(world: World, a: Point, b: Point): number {
  let dx = Math.abs(a.x - b.x);
  if (!world.flatEarth) dx = Math.min(dx, world.widthX2 - dx);
  return dx + Math.abs(a.y - b.y);
}

function passable(world: World, rules: EngineRules, unit: Unit, p: Point, goal: Point): boolean {
  const type = rules.units[unit.type];
  if (!type) return false;
  const ocean = world.terrainAt(p.x, p.y) === OCEAN;
  const isGoal = p.x === goal.x && p.y === goal.y;
  if (type.domain === DOMAIN_GROUND && ocean && !isGoal) return false;
  if (type.domain === DOMAIN_SEA && !ocean && !isGoal && !world.cityAt(p.x, p.y)) return false;
  if (world.unitsAt(p.x, p.y).some((u) => u.owner !== unit.owner)) return false;
  const city = world.cityAt(p.x, p.y);
  if (city && city.owner !== unit.owner && !isGoal) return false;
  return true;
}

/** Cost of stepping from `from` onto `to` for `unit`. */
export function stepPathCost(
  world: World,
  rules: EngineRules,
  unit: Unit,
  from: Point,
  to: Point,
): number {
  const type = rules.units[unit.type];
  if (!type) return MAX_COST;
  const roadMult = rules.cosmic.roadMoveMultiplier;
  if (type.domain === DOMAIN_AIR) return 1;
  const cityTo = world.cityAt(to.x, to.y) !== undefined;
  const railFrom =
    world.hasFlag(from.x, from.y, SquareFlag.Railroad) ||
    world.cityAt(from.x, from.y) !== undefined;
  const railTo = world.hasFlag(to.x, to.y, SquareFlag.Railroad) || cityTo;
  const roadFrom =
    world.hasFlag(from.x, from.y, SquareFlag.Road) || world.cityAt(from.x, from.y) !== undefined;
  const roadTo = world.hasFlag(to.x, to.y, SquareFlag.Road) || cityTo;
  let cost: number;
  if (railFrom && railTo) cost = 1;
  else if (type.flags.alpine) cost = 4;
  else if (roadFrom && roadTo) cost = 4;
  else if (
    world.hasFlag(from.x, from.y, SquareFlag.River) &&
    world.hasFlag(to.x, to.y, SquareFlag.River)
  )
    cost = 4;
  else if (type.move * 3 > roadMult)
    cost = (rules.terrain[world.terrainAt(to.x, to.y)]?.moveCost ?? 1) * roadMult * 4;
  else cost = roadMult * 4;
  if (
    type.role < 5 &&
    world
      .neighbours(to.x, to.y)
      .some((n) => n && world.unitsAt(n.x, n.y).some((u) => u.owner !== unit.owner))
  )
    cost += roadMult * 4;
  const own = world.unitsAt(to.x, to.y).filter((u) => u.owner === unit.owner);
  if (own.length > 0 && !cityTo && !world.hasFlag(to.x, to.y, SquareFlag.Fortress)) {
    const sameRole = own.filter((u) => rules.units[u.type]?.role === type.role).length;
    cost += sameRole * 16;
  }
  return cost;
}

/**
 * The direction (0–7) of the first step toward `goal`, or null when no path within the window
 * and cost limit exists. A goal more than 24 squares away in either axis is out of the window.
 */
export function gotoDirection(
  world: World,
  rules: EngineRules,
  unit: Unit,
  goal: Point,
): number | null {
  const here = unit.position;
  if (here.x === goal.x && here.y === goal.y) return null;
  if (manhattan(world, here, goal) >= WINDOW) return null;
  // Shortest path costs from the goal outward (the original's cost grid).
  const cost = new Map<number, number>();
  const key = (p: Point) => p.y * world.widthX2 + p.x;
  const heap: { c: number; p: Point }[] = [];
  const push = (c: number, p: Point) => {
    heap.push({ c, p });
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const a = heap[i];
      const b = heap[parent];
      if (!a || !b || b.c <= a.c) break;
      heap[i] = b;
      heap[parent] = a;
      i = parent;
    }
  };
  const pop = (): { c: number; p: Point } | undefined => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        const hm = heap[m];
        const hl = heap[l];
        const hr = heap[r];
        if (hl && hm && hl.c < hm.c) m = l;
        const hm2 = heap[m];
        if (hr && hm2 && hr.c < hm2.c) m = r;
        if (m === i) break;
        const a = heap[i];
        const b = heap[m];
        if (!a || !b) break;
        heap[i] = b;
        heap[m] = a;
        i = m;
      }
    }
    return top;
  };
  cost.set(key(goal), 1);
  push(1, goal);
  while (heap.length > 0) {
    const cur = pop();
    if (!cur) break;
    if ((cost.get(key(cur.p)) ?? Infinity) < cur.c) continue;
    if (cur.c > MAX_COST) continue;
    if (cur.p.x === here.x && cur.p.y === here.y) continue;
    for (let dir = 0; dir < 8; dir++) {
      const n = neighbour(world, cur.p, dir);
      if (!n) continue;
      if (manhattan(world, n, goal) >= WINDOW) continue;
      const isHere = n.x === here.x && n.y === here.y;
      if (!isHere && !passable(world, rules, unit, n, goal)) continue;
      // The cost of stepping from n onto cur (paths are walked toward the goal).
      const c = cur.c + stepPathCost(world, rules, unit, n, cur.p);
      if (c > MAX_COST) continue;
      const k = key(n);
      if ((cost.get(k) ?? Infinity) <= c) continue;
      cost.set(k, c);
      if (!isHere) push(c, n);
    }
  }
  const hereCost = cost.get(key(here));
  if (hereCost === undefined) return null;
  let best = -1;
  let bestTotal = Infinity;
  let bestDist = Infinity;
  for (let dir = 0; dir < 8; dir++) {
    const n = neighbour(world, here, dir);
    if (!n) continue;
    const c = cost.get(key(n));
    if (c === undefined || c >= hereCost) continue;
    if (!passable(world, rules, unit, n, goal)) continue;
    const total = c + stepPathCost(world, rules, unit, here, n);
    const d = distance(world, goal, n);
    if (total < bestTotal || (total === bestTotal && d < bestDist)) {
      bestTotal = total;
      bestDist = d;
      best = dir;
    }
  }
  return best < 0 ? null : best;
}
