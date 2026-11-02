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
 * adds a movement point for combat roles. Air units pay 1 a step. VERIFIED: the river rule needs
 * a river on both squares and a step of one column and one row, the map's edge neighbours. The
 * search is a plain shortest-path search rather than the original's ring buffer, which finds the
 * same costs.
 */
import { gridDistance } from './city.js';
import { DOMAIN_AIR, DOMAIN_GROUND, DOMAIN_SEA, type EngineRules } from './rules.js';
import {
  type LocatorGrid,
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
export interface Board {
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

/**
 * The facts a search reads. Planning walks (road links, route modifiers) ignore the stacking cost
 * of own units, else a worker standing on the link shifts the link away from itself every turn.
 * A walk of many steps builds this once and passes it along.
 */
export function planningBoard(
  world: World,
  rules: EngineRules,
  unit: Unit,
  ignoreOwnUnits: boolean,
): Board {
  const b = board(world, rules, unit);
  if (ignoreOwnUnits) b.sameRole.fill(0);
  return b;
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

/** One column and one row apart (0x0055062e and the row test): the squares share an edge. */
function diagonalStep(world: World, from: number, to: number): boolean {
  const rowOf = (i: number) => Math.trunc(i / world.columns);
  const xOf = (i: number) => (i % world.columns) * 2 + (rowOf(i) & 1);
  if (Math.abs(rowOf(from) - rowOf(to)) !== 1) return false;
  let dx = Math.abs(xOf(from) - xOf(to));
  if (!world.flatEarth) dx = Math.min(dx, world.widthX2 - dx);
  return dx === 1;
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
  else if (
    (flagsFrom & SquareFlag.River) !== 0 &&
    (flagsTo & SquareFlag.River) !== 0 &&
    diagonalStep(world, from, to)
  )
    cost = 4;
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
  opts: { ignoreOwnUnits?: boolean; board?: Board } = {},
): number | null {
  const here = unit.position;
  if (here.x === goal.x && here.y === goal.y) return null;
  if (manhattan(world, here, goal) >= WINDOW) return null;
  const b = opts.board ?? planningBoard(world, rules, unit, opts.ignoreOwnUnits === true);
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
    // Everything cheaper than this square is settled, which is all the choice below reads.
    const reached = cost[hereIndex] ?? 0;
    if (reached !== 0 && c >= reached) break;
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
    const d = gridDistance(world, goal, world.position(n));
    if (total < bestTotal || (total === bestTotal && d < bestDist)) {
      bestTotal = total;
      bestDist = d;
      best = dir;
    }
  }
  return best < 0 ? null : best;
}

/**
 * The locator grid (VERIFIED 0x0050df10, saved in every game after the map): cells of four game
 * columns by four rows, one byte per cell for land and one for sea. A bit says the cell reaches
 * that neighbouring cell. The original builds it once when a world starts and never again, so
 * terraforming does not touch it. Built here on first use and kept with the world.
 */
export type { LocatorGrid } from './world.js';

/** Cell steps in bit order (VERIFIED, the tables at 0x005b2e98 and 0x005b2ea8). */
const CELL_DX = [0, 1, 1, 1, 0, -1, -1, -1];
const CELL_DY = [-1, -1, 0, 1, 1, 1, 0, -1];

/** The first square of a cell on the wanted kind of terrain (0x0050e1c7 and 0x00485ac5). */
function cellSquare(world: World, x: number, y: number, sea: boolean): Point | null {
  for (let k = 0; k < 2; k++) {
    const sy = y + k;
    if (sy < 0 || sy >= world.rows) continue;
    const sx = world.wrapX(x + k, sy);
    if (sx === null || !world.isSquare(sx, sy)) continue;
    if ((world.terrain[world.index(sx, sy)] === OCEAN) === sea) return { x: sx, y: sy };
  }
  return null;
}

/**
 * The original's search table as the grid build leaves it (VERIFIED 0x00484325): 48 by 48 cells
 * around the goal, of which each new search clears only the first 0x1200 bytes, half the table.
 * Costs in the other half survive from earlier searches and steer the result, so the links depend
 * on the order of the searches. The build replays them in that order to get the same grid.
 */
class SearchTable {
  private readonly cost = new Int32Array(48 * 48);
  private cachedGoal: number | null = null;
  private best = 0;

  constructor(private readonly world: World) {}

  private at(x: number, y: number, gx: number, gy: number): number {
    const dx = x - gx;
    return 48 * dx - 47 * ((y - gy + dx) >> 1) + 1176;
  }

  private read(x: number, y: number, gx: number, gy: number): number {
    return this.cost[this.at(x, y, gx, gy)] ?? 0;
  }

  /** The cost the search reports from `a` to `b`, or −1 when it finds no first step. */
  search(a: Point, b: Point, sea: boolean, limit: number): number {
    const w = this.world;
    if (a.x === b.x && a.y === b.y) return 0;
    if (gridDistance(w, a, b) >= 23) return -1;
    const goalIndex = w.index(b.x, b.y);
    const startIndex = w.index(a.x, a.y);
    let sx = a.x - b.x;
    if (!w.flatEarth) {
      if (sx < 0) sx += w.widthX2;
      if (sx >= w.widthX2 >> 1) sx -= w.widthX2;
    }
    sx += b.x;
    const window = (x: number, y: number) => ((Math.abs(x - b.x) + Math.abs(y - b.y)) & ~1) < 48;
    const open = (x: number, y: number): boolean => {
      const wx = w.wrapX(x, y);
      if (wx === null || !w.isSquare(wx, y)) return false;
      const i = w.index(wx, y);
      return (w.terrain[i] === OCEAN) === sea || i === startIndex || i === goalIndex;
    };
    if (this.cachedGoal !== goalIndex || this.read(sx, a.y, b.x, b.y) === 0) {
      this.cachedGoal = goalIndex;
      this.cost.fill(0, 0, 1152);
      this.cost[this.at(b.x, b.y, b.x, b.y)] = 1;
      this.best = limit;
      const qx = new Int32Array(0x900);
      const qy = new Int32Array(0x900);
      qx[0] = b.x;
      qy[0] = b.y;
      let head = 0;
      let tail = 1;
      do {
        const x = qx[head] ?? 0;
        const y = qy[head] ?? 0;
        head = head + 1 > 0x8ff ? 0 : head + 1;
        const c = this.read(x, y, b.x, b.y);
        if (c > this.best) continue;
        const wx = w.wrapX(x, y);
        if (wx === a.x && y === a.y) {
          this.best = c;
          continue;
        }
        let full = false;
        for (let dir = 0; dir < 8 && !full; dir++) {
          const off = NEIGHBOUR_OFFSETS[dir];
          const nx = x + (off?.x ?? 0);
          const ny = y + (off?.y ?? 0);
          if (!window(nx, ny) || ny < 0 || ny >= w.rows || !open(nx, ny)) continue;
          const seen = this.read(nx, ny, b.x, b.y);
          if (seen !== 0 && c + 1 >= seen) continue;
          this.cost[this.at(nx, ny, b.x, b.y)] = c + 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail = tail + 1 > 0x8ff ? 0 : tail + 1;
          full = head === tail;
        }
        if (full) break;
      } while (head !== tail && head !== 0);
    }
    if (this.best >= limit) return -1;
    const here = this.read(sx, a.y, b.x, b.y);
    for (let dir = 0; dir < 8; dir++) {
      const off = NEIGHBOUR_OFFSETS[dir];
      const nx = a.x + (off?.x ?? 0);
      const ny = a.y + (off?.y ?? 0);
      if (ny < 0 || ny >= w.rows || !window(nx, ny) || !open(nx, ny)) continue;
      let rel = nx - b.x;
      if (!w.flatEarth) {
        if (rel < 0) rel += w.widthX2;
        if (rel >= w.widthX2 >> 1) rel -= w.widthX2;
      }
      const c = this.read(b.x + rel, ny, b.x, b.y);
      if (c !== 0 && c < here) return this.best;
    }
    return -1;
  }
}

export function locatorGrid(world: World): LocatorGrid {
  if (world.locator) return world.locator;
  const columns = (world.widthX2 + 3) >> 2;
  const rows = (world.rows + 3) >> 2;
  const cellX = (x: number) => {
    if (world.flatEarth) return x;
    if (x < 0) return columns + x;
    return x >= columns ? x - columns : x;
  };
  const table = new SearchTable(world);
  const build = (sea: boolean): Uint8Array => {
    const grid = new Uint8Array(columns * rows);
    for (let cx = 0; cx < columns; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        const x = cx * 4 + 1;
        const y = cy * 4 + 1;
        const here = cellSquare(world, x, y, sea);
        if (!here) continue;
        const body = world.landmass[world.index(here.x, here.y)];
        for (let dir = 0; dir < 4; dir++) {
          const ny = y + (CELL_DY[dir] ?? 0) * 4;
          if (ny < 0 || ny >= world.rows) continue;
          const nx = world.wrapX(x + (CELL_DX[dir] ?? 0) * 4, ny);
          if (nx === null || !world.isSquare(nx, ny)) continue;
          const there = cellSquare(world, nx, ny, sea);
          if (!there || world.landmass[world.index(there.x, there.y)] !== body) continue;
          const cost = table.search(here, there, sea, 5);
          if (cost <= 0 || cost >= 5) continue;
          const at = cy * columns + cx;
          grid[at] = (grid[at] ?? 0) | (1 << dir);
          const ox = cellX(cx + (CELL_DX[dir] ?? 0));
          const oy = cy + (CELL_DY[dir] ?? 0);
          if (ox >= 0 && oy >= 0 && ox < columns && oy < rows) {
            const back = oy * columns + ox;
            grid[back] = (grid[back] ?? 0) | (1 << ((dir - 4) & 7));
          }
        }
      }
    }
    return grid;
  };
  const made = { columns, rows, land: build(false), sea: build(true) };
  world.locator = made;
  return made;
}

/** Steps of real cost from `a` to `b` for the standard unit of the domain, −1 past `limit`. */
function reachCost(
  world: World,
  rules: EngineRules,
  a: Point,
  b: Point,
  sea: boolean,
  limit: number,
): number {
  const start = world.index(a.x, a.y);
  const goal = world.index(b.x, b.y);
  if (start === goal) return 0;
  if (gridDistance(world, a, b) >= 23) return -1;
  // VERIFIED (0x00485412): Warriors (unit 2) on land, unit 33 at sea, and nobody's units in the way.
  const type = sea ? 33 : 2;
  const walker = { type, owner: -1 } as Unit;
  const board: Board = {
    unitOwner: new Int8Array(world.area).fill(-1),
    sameRole: new Uint8Array(world.area),
    cityOwner: new Int8Array(world.area).fill(-1),
  };
  for (const c of world.cities) board.cityOwner[world.index(c.position.x, c.position.y)] = c.owner;
  const cost = new Map<number, number>([[goal, 1]]);
  const open = [goal];
  while (open.length > 0) {
    const i = open.shift() ?? 0;
    const c = cost.get(i) ?? 0;
    if (c > limit) continue;
    for (let dir = 0; dir < 8; dir++) {
      const n = neighbourIndex(world, i, dir);
      if (n < 0) continue;
      if (n !== start && (world.terrain[n] === OCEAN) !== sea) continue;
      const nc = c + stepCost(world, rules, walker, board, n, i);
      if (nc >= (cost.get(n) ?? Infinity)) continue;
      cost.set(n, nc);
      open.push(n);
    }
  }
  const found = cost.get(start);
  return found !== undefined && found < limit ? found : -1;
}

/** The cell a square routes from (VERIFIED 0x00485b63): its own, else the nearest neighbour. */
function routeCell(
  world: World,
  rules: EngineRules,
  p: Point,
  sea: boolean,
): { x: number; y: number; ok: boolean } {
  const g = locatorGrid(world);
  const bits = sea ? g.sea : g.land;
  const cx = p.x >> 2;
  const cy = p.y >> 2;
  if (bits[cy * g.columns + cx]) {
    const own = cellSquare(world, cx * 4 + 1, cy * 4 + 1, sea);
    if (own && reachCost(world, rules, own, p, sea, 18) >= 0) return { x: cx, y: cy, ok: true };
  }
  let best = -1;
  let bestDistance = 99;
  const wrap = (x: number) => {
    if (world.flatEarth) return x;
    if (x < 0) return g.columns + x;
    return x >= g.columns ? x - g.columns : x;
  };
  for (let dir = 0; dir < 8; dir++) {
    const nx = wrap(cx + (CELL_DX[dir] ?? 0));
    const ny = cy + (CELL_DY[dir] ?? 0);
    if (nx < 0 || ny < 0 || nx >= g.columns || ny >= g.rows) continue;
    if (!bits[ny * g.columns + nx]) continue;
    const base = { x: nx * 4 + 1, y: ny * 4 + 1 };
    if (!world.isSquare(base.x, base.y)) continue;
    const d = gridDistance(world, p, base);
    if (d >= bestDistance) continue;
    const square = cellSquare(world, base.x, base.y, sea);
    if (square && reachCost(world, rules, square, p, sea, 18) >= 0) {
      best = dir;
      bestDistance = d;
    }
  }
  if (best < 0) return { x: cx, y: cy, ok: false };
  return { x: wrap(cx + (CELL_DX[best] ?? 0)), y: cy + (CELL_DY[best] ?? 0), ok: true };
}

/**
 * The next waypoint of a long trip (VERIFIED 0x00485550): a breadth search over the locator grid
 * from the goal's cell back to the unit's, in the original's 256-entry ring. The waypoint is the
 * neighbouring cell nearest the goal, its first square of the right kind. Null when no route
 * exists, and the caller then heads straight for the goal.
 */
export function longRouteWaypoint(
  world: World,
  rules: EngineRules,
  from: Point,
  goal: Point,
  sea: boolean,
): Point | null {
  const start = routeCell(world, rules, from, sea);
  if (!start.ok) return null;
  const end = routeCell(world, rules, goal, sea);
  const g = locatorGrid(world);
  const bits = sea ? g.sea : g.land;
  const wrap = (x: number) => {
    if (world.flatEarth) return x;
    if (x < 0) return g.columns + x;
    return x >= g.columns ? x - g.columns : x;
  };
  const seen = new Uint8Array(g.columns * g.rows);
  const qx = new Int32Array(256);
  const qy = new Int32Array(256);
  let head = 0;
  let tail = 1;
  qx[0] = end.x;
  qy[0] = end.y;
  seen[end.y * g.columns + end.x] = 1;
  let found = false;
  for (;;) {
    const x = qx[head] ?? 0;
    const y = qy[head] ?? 0;
    head = (head + 1) & 0xff;
    if (x === start.x && y === start.y) {
      found = true;
      break;
    }
    const level = seen[y * g.columns + x] ?? 0;
    const mask = bits[y * g.columns + x] ?? 0;
    for (let dir = 0; dir < 8; dir++) {
      if ((mask & (1 << dir)) === 0) continue;
      const nx = wrap(x + (CELL_DX[dir] ?? 0));
      const ny = y + (CELL_DY[dir] ?? 0);
      if (nx < 0 || ny < 0 || nx >= g.columns || ny >= g.rows) continue;
      if (seen[ny * g.columns + nx]) continue;
      seen[ny * g.columns + nx] = level + 1;
      qx[tail] = nx;
      qy[tail] = ny;
      tail = (tail + 1) & 0xff;
    }
    if (head === tail) break;
  }
  if (!found) return null;
  let best = -1;
  let bestLevel = 99;
  let bestDistance = 0;
  const mask = bits[start.y * g.columns + start.x] ?? 0;
  for (let dir = 0; dir < 8; dir++) {
    if ((mask & (1 << dir)) === 0) continue;
    const nx = wrap(start.x + (CELL_DX[dir] ?? 0));
    const ny = start.y + (CELL_DY[dir] ?? 0);
    if (nx < 0 || ny < 0 || nx >= g.columns || ny >= g.rows) continue;
    const level = seen[ny * g.columns + nx] ?? 0;
    if (level === 0) continue;
    const d = gridDistance(world, goal, { x: nx * 4 + 1, y: ny * 4 + 1 });
    if (level < bestLevel || (level === bestLevel && d < bestDistance)) {
      best = dir;
      bestLevel = level;
      bestDistance = d;
    }
  }
  if (best < 0) return null;
  const x = wrap(start.x + (CELL_DX[best] ?? 0)) * 4 + 1;
  const y = (start.y + (CELL_DY[best] ?? 0)) * 4 + 1;
  return cellSquare(world, x, y, sea) ?? { x, y };
}

/**
 * The original's step chooser for a unit under orders (VERIFIED 0x00485e3d): the window search
 * under 23 squares, then a waypoint of the long route, then the caller's straight walk. Air units
 * skip the search; other callers that want only the window use `gotoDirection`.
 */
export function chooseGotoStep(
  world: World,
  rules: EngineRules,
  unit: Unit,
  goal: Point,
): number | null {
  const domain = rules.units[unit.type]?.domain;
  if (domain === DOMAIN_AIR) return null;
  if (gridDistance(world, unit.position, goal) < 23) {
    const direct = gotoDirection(world, rules, unit, goal);
    if (direct !== null) return direct;
  }
  const waypoint = longRouteWaypoint(world, rules, unit.position, goal, domain === DOMAIN_SEA);
  if (!waypoint || gridDistance(world, unit.position, waypoint) >= 23) return null;
  return gotoDirection(world, rules, unit, waypoint);
}
