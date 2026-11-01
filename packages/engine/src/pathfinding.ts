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
 * outside a city or fortress adds 16 per unit of the same role; a square beside an enemy unit
 * adds a movement point for combat roles. Air units pay 1 a step. INFERRED details: the river
 * test is "both squares have a river", and the search is a plain shortest-path search rather
 * than the original's ring buffer.
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

/** Per-square facts gathered once per search, so the inner loop touches only arrays. */
interface Board {
  /** Owner slot of the units on the square, −1 when empty. */
  unitOwner: Int8Array;
  /** Own units of the moving unit's role on the square. */
  sameRole: Uint8Array;
  /** Owner slot of a city on the square, −1 when none. */
  cityOwner: Int8Array;
}

function board(world: World, rules: EngineRules, unit: Unit): Board {
  const role = rules.units[unit.type]?.role ?? 0;
  const unitOwner = new Int8Array(world.area).fill(-1);
  const sameRole = new Uint8Array(world.area);
  const cityOwner = new Int8Array(world.area).fill(-1);
  for (const u of world.units) {
    const i = world.index(u.position.x, u.position.y);
    unitOwner[i] = u.owner;
    if (u.owner === unit.owner && (rules.units[u.type]?.role ?? 0) === role)
      sameRole[i] = (sameRole[i] ?? 0) + 1;
  }
  for (const c of world.cities) cityOwner[world.index(c.position.x, c.position.y)] = c.owner;
  return { unitOwner, sameRole, cityOwner };
}

function neighbourIndex(world: World, i: number, dir: number): number {
  const off = NEIGHBOUR_OFFSETS[dir];
  if (!off) return -1;
  const p = world.position(i);
  const y = p.y + off.y;
  if (y < 0 || y >= world.rows) return -1;
  const x = world.wrapX(p.x + off.x, y);
  return x === null ? -1 : world.index(x, y);
}

function manhattan(world: World, a: Point, b: Point): number {
  let dx = Math.abs(a.x - b.x);
  if (!world.flatEarth) dx = Math.min(dx, world.widthX2 - dx);
  return dx + Math.abs(a.y - b.y);
}

/** Cost of stepping from square `from` onto square `to` (indices) for `unit`. */
function stepCost(
  world: World,
  rules: EngineRules,
  unit: Unit,
  b: Board,
  from: number,
  to: number,
): number {
  const type = rules.units[unit.type];
  if (!type) return MAX_COST;
  const roadMult = rules.cosmic.roadMoveMultiplier;
  if (type.domain === DOMAIN_AIR) return 1;
  const flagsFrom = world.flags[from] ?? 0;
  const flagsTo = world.flags[to] ?? 0;
  const cityFrom = (b.cityOwner[from] ?? -1) >= 0;
  const cityTo = (b.cityOwner[to] ?? -1) >= 0;
  const railFrom = (flagsFrom & SquareFlag.Railroad) !== 0 || cityFrom;
  const railTo = (flagsTo & SquareFlag.Railroad) !== 0 || cityTo;
  const roadFrom = (flagsFrom & SquareFlag.Road) !== 0 || cityFrom;
  const roadTo = (flagsTo & SquareFlag.Road) !== 0 || cityTo;
  let cost: number;
  if (railFrom && railTo) cost = 1;
  else if (type.flags.alpine) cost = 4;
  else if (roadFrom && roadTo) cost = 4;
  else if ((flagsFrom & SquareFlag.River) !== 0 && (flagsTo & SquareFlag.River) !== 0) cost = 4;
  else if (type.move * 3 > roadMult)
    cost = (rules.terrain[world.terrain[to] ?? OCEAN]?.moveCost ?? 1) * roadMult * 4;
  else cost = roadMult * 4;
  if (type.role < 5) {
    for (let dir = 0; dir < 8; dir++) {
      const n = neighbourIndex(world, to, dir);
      if (n < 0) continue;
      const o = b.unitOwner[n] ?? -1;
      if (o >= 0 && o !== unit.owner) {
        cost += roadMult * 4;
        break;
      }
    }
  }
  if ((b.unitOwner[to] ?? -1) === unit.owner && !cityTo && (flagsTo & SquareFlag.Fortress) === 0)
    cost += (b.sameRole[to] ?? 0) * 16;
  return cost;
}

function passable(
  world: World,
  rules: EngineRules,
  unit: Unit,
  b: Board,
  i: number,
  goal: number,
): boolean {
  const type = rules.units[unit.type];
  if (!type) return false;
  const ocean = (world.terrain[i] ?? OCEAN) === OCEAN;
  const isGoal = i === goal;
  const cityOwner = b.cityOwner[i] ?? -1;
  if (type.domain === DOMAIN_GROUND && ocean && !isGoal) return false;
  if (type.domain === DOMAIN_SEA && !ocean && !isGoal && cityOwner < 0) return false;
  const o = b.unitOwner[i] ?? -1;
  if (o >= 0 && o !== unit.owner) return false;
  if (cityOwner >= 0 && cityOwner !== unit.owner && !isGoal) return false;
  return true;
}

/** Cost of stepping from `from` onto `to` for `unit` (the pathfinder's step cost). */
export function stepPathCost(
  world: World,
  rules: EngineRules,
  unit: Unit,
  from: Point,
  to: Point,
): number {
  return stepCost(
    world,
    rules,
    unit,
    board(world, rules, unit),
    world.index(from.x, from.y),
    world.index(to.x, to.y),
  );
}

/**
 * The direction (0–7) of the first step toward `goal`, or null when no path within the window
 * and cost limit exists. A goal 48 or more squares away (x plus y) is out of the window.
 */
export function gotoDirection(
  world: World,
  rules: EngineRules,
  unit: Unit,
  goal: Point,
  opts: { ignoreOwnUnits?: boolean } = {},
): number | null {
  const here = unit.position;
  if (here.x === goal.x && here.y === goal.y) return null;
  if (manhattan(world, here, goal) >= WINDOW) return null;
  const b = board(world, rules, unit);
  // Planning walks (road links, route modifiers) ignore the stacking cost of own units, else a
  // worker standing on the link shifts the link away from itself every turn.
  if (opts.ignoreOwnUnits) b.sameRole.fill(0);
  const goalIndex = world.index(goal.x, goal.y);
  const hereIndex = world.index(here.x, here.y);
  const cost = new Int32Array(world.area); // 0 = unreached
  // A binary heap of (cost, square index).
  const heapCost: number[] = [];
  const heapSquare: number[] = [];
  const push = (c: number, i: number) => {
    heapCost.push(c);
    heapSquare.push(i);
    let k = heapCost.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if ((heapCost[parent] ?? 0) <= (heapCost[k] ?? 0)) break;
      [heapCost[parent], heapCost[k]] = [heapCost[k] ?? 0, heapCost[parent] ?? 0];
      [heapSquare[parent], heapSquare[k]] = [heapSquare[k] ?? 0, heapSquare[parent] ?? 0];
      k = parent;
    }
  };
  const pop = (): [number, number] | null => {
    if (heapCost.length === 0) return null;
    const top: [number, number] = [heapCost[0] ?? 0, heapSquare[0] ?? 0];
    const lastC = heapCost.pop() ?? 0;
    const lastS = heapSquare.pop() ?? 0;
    if (heapCost.length > 0) {
      heapCost[0] = lastC;
      heapSquare[0] = lastS;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heapCost.length && (heapCost[l] ?? 0) < (heapCost[m] ?? 0)) m = l;
        if (r < heapCost.length && (heapCost[r] ?? 0) < (heapCost[m] ?? 0)) m = r;
        if (m === k) break;
        [heapCost[m], heapCost[k]] = [heapCost[k] ?? 0, heapCost[m] ?? 0];
        [heapSquare[m], heapSquare[k]] = [heapSquare[k] ?? 0, heapSquare[m] ?? 0];
        k = m;
      }
    }
    return top;
  };
  cost[goalIndex] = 1;
  push(1, goalIndex);
  for (;;) {
    const top = pop();
    if (!top) break;
    const [c, i] = top;
    if ((cost[i] ?? 0) < c) continue;
    if (c > MAX_COST) continue;
    if (i === hereIndex) continue;
    const p = world.position(i);
    for (let dir = 0; dir < 8; dir++) {
      const n = neighbourIndex(world, i, dir);
      if (n < 0) continue;
      if (manhattan(world, world.position(n), goal) >= WINDOW) continue;
      const isHere = n === hereIndex;
      if (!isHere && !passable(world, rules, unit, b, n, goalIndex)) continue;
      // Paths are walked toward the goal: the step is from n onto this square.
      const nc = c + stepCost(world, rules, unit, b, n, i);
      if (nc > MAX_COST) continue;
      const known = cost[n] ?? 0;
      if (known !== 0 && known <= nc) continue;
      cost[n] = nc;
      if (!isHere) push(nc, n);
    }
    void p;
  }
  const hereCost = cost[hereIndex] ?? 0;
  if (hereCost === 0) return null;
  let best = -1;
  let bestTotal = Infinity;
  let bestDist = Infinity;
  for (let dir = 0; dir < 8; dir++) {
    const n = neighbourIndex(world, hereIndex, dir);
    if (n < 0) continue;
    const c = cost[n] ?? 0;
    if (c === 0 || c >= hereCost) continue;
    if (!passable(world, rules, unit, b, n, goalIndex)) continue;
    const total = c + stepCost(world, rules, unit, b, hereIndex, n);
    const d = distance(world, goal, world.position(n));
    if (total < bestTotal || (total === bestTotal && d < bestDist)) {
      bestTotal = total;
      bestDist = d;
      best = dir;
    }
  }
  return best < 0 ? null : best;
}
