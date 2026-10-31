/**
 * The random map maker.
 *
 * Ported from the original's map routine 0x00402cd3 and its helpers: continent growth
 * (0x00404512 → 0x00404703 / 0x004048cd / 0x00404a42), the diagonal fix, terrain by latitude,
 * the two moisture sweeps, erosion and smoothing by age, rivers (0x00404bf8), the polar rows and
 * the deep-ocean "no special" bits. VERIFIED structure and constants; the random draws follow the
 * original's order where that costs nothing, but the result is not byte-identical to the
 * original's for a given seed (INFERRED divergences are noted inline). docs/engine/map-generation.md.
 */
import { computeFertility } from './fertility.js';
import type { Rng } from './rng.js';
import type { EngineRules } from './rules.js';
import { NEIGHBOUR_OFFSETS, OCEAN, SquareFlag, World } from './world.js';

export interface MapParams {
  /** Stored columns (half the x extent); the original's small/normal/large worlds are 40, 50, 75 wide. */
  columns: number;
  rows: number;
  flatEarth: boolean;
  /** Land mass: 0 small, 1 normal, 2 large. */
  landMass: number;
  /** Land form: −1 archipelago, 0 varied, 1 continents (INFERRED mapping of the dialog). */
  landForm: number;
  /** Climate: −1 arid, 0 normal, 1 wet. */
  climate: number;
  /** Temperature: −1 cool, 0 temperate, 1 warm. */
  temperature: number;
  /** Age: 0 three, 1 four, 2 five billion years. */
  age: number;
}

const DESERT = 0;
const PLAINS = 1;
const GRASSLAND = 2;
const FOREST = 3;
const HILLS = 4;
const MOUNTAINS = 5;
const TUNDRA = 6;
const GLACIER = 7;
const SWAMP = 8;
const JUNGLE = 9;

/** The four river directions (0x5b2e04/0x5b2e0c): NE, SE, SW, NW. */
const RIVER_DIRS = [
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];
/** The axis steps continent growth takes (every other neighbour: E, S, W, N). */
const AXIS = [
  { x: 2, y: 0 },
  { x: 0, y: 2 },
  { x: -2, y: 0 },
  { x: 0, y: -2 },
];

class Builder {
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;
  /** How many times land was laid on the square (0 ocean, 1 lowland, 2 hills, more mountains). */
  readonly height2: Uint8Array;
  readonly mark: Uint8Array;
  readonly river: Uint8Array;
  landCount = 0;
  xMin: number;
  xMax: number;
  yMin = 0;
  yMax: number;

  constructor(
    readonly params: MapParams,
    readonly rng: Rng,
  ) {
    this.width = params.columns * 2;
    this.height = params.rows;
    const area = params.columns * params.rows;
    this.terrain = new Uint8Array(area).fill(OCEAN);
    this.height2 = new Uint8Array(area);
    this.mark = new Uint8Array(area);
    this.river = new Uint8Array(area);
    this.xMin = params.flatEarth ? 3 : -1e9;
    this.xMax = params.flatEarth ? this.width - 3 : 1e9;
    this.yMax = this.height - 1;
  }

  rand(n: number): number {
    return n <= 1 ? 0 : this.rng.nextInt(n);
  }

  wrap(x: number): number | null {
    if (this.params.flatEarth) return x < 0 || x >= this.width ? null : x;
    return ((x % this.width) + this.width) % this.width;
  }

  index(x: number, y: number): number {
    return (y * this.width + x) >> 1;
  }

  valid(x: number, y: number): boolean {
    return y >= 0 && y < this.height && ((x + y) & 1) === 0 && this.wrap(x) !== null;
  }

  inBounds(x: number, y: number): boolean {
    if (this.params.flatEarth && (x < this.xMin || x > this.xMax)) return false;
    return y >= this.yMin && y <= this.yMax;
  }

  at(x: number, y: number): number {
    const wx = this.wrap(x);
    if (wx === null || y < 0 || y >= this.height) return OCEAN;
    return this.terrain[this.index(wx, y)] ?? OCEAN;
  }

  set(x: number, y: number, t: number): void {
    const wx = this.wrap(x);
    if (wx === null || y < 0 || y >= this.height) return;
    this.terrain[this.index(wx, y)] = t;
  }

  markLand(x: number, y: number): void {
    const wx = this.wrap(x);
    if (wx === null || !this.inBounds(x, y) || y < 0 || y >= this.height) return;
    this.mark[this.index(wx, y)] = 1;
  }

  /** The three-square brush (0x00404830). */
  brush(x: number, y: number): void {
    this.markLand(x, y);
    this.markLand(x + 1, y - 1);
    this.markLand(x + 1, y + 1);
  }

  /** One continent (0x00404512 with argument 0) or one island (argument 1). */
  grow(island: boolean): void {
    this.mark.fill(0);
    let x = 0;
    let y = 0;
    for (;;) {
      x = this.rand(this.width - 16) + 8;
      y = this.rand(this.height - 8) + 4;
      if (!island) {
        const f = this.params.landForm;
        const stop = f + 1 < 1 ? 0 : this.rand(f + 2);
        if (stop !== 0) break;
      }
      const wx = this.wrap(x);
      if (wx !== null && (this.height2[this.index(wx, y)] ?? 0) === 0) break;
    }
    if (!island) {
      const wx = this.wrap(x) ?? 0;
      const onLand = (this.height2[this.index(wx, y)] ?? 0) !== 0;
      if (this.params.landForm < 1) {
        let steps = this.rng.nextInt(64);
        if (onLand) steps >>= 1;
        steps += 1;
        while (steps > 0 && this.inBounds(x, y)) {
          this.brush(x, y);
          const a = AXIS[this.rng.nextInt(4)] ?? AXIS[0];
          x += a?.x ?? 0;
          y += a?.y ?? 0;
          steps -= 1;
        }
      } else {
        let steps = this.rng.nextInt(48);
        if (onLand) steps >>= 1;
        steps += 1;
        while (steps > 0 && this.inBounds(x, y)) {
          this.brush(x, y);
          if (this.rng.nextInt(4) === 0) this.brush(x + 2, y);
          if (this.rng.nextInt(4) === 0) this.brush(x - 2, y);
          if (this.rng.nextInt(4) === 0) this.brush(x, y + 2);
          if (this.rng.nextInt(4) === 0) this.brush(x, y - 2);
          const a = AXIS[this.rng.nextInt(4)] ?? AXIS[0];
          x += a?.x ?? 0;
          y += a?.y ?? 0;
          steps -= 1;
        }
      }
    } else {
      const r = this.rng.nextInt(10);
      this.islandWalk(x, y);
      if (r > 6) this.islandWalk(x, y);
      if (r > 8) this.islandWalk(x, y);
    }
    for (let i = 0; i < this.mark.length; i++) {
      if (this.mark[i] !== 0) {
        this.height2[i] = (this.height2[i] ?? 0) + 1;
        this.landCount += 1;
      }
    }
  }

  islandWalk(x: number, y: number): void {
    let steps = this.rng.nextInt(16) + 1;
    while (steps > 0 && this.inBounds(x, y)) {
      this.markLand(x, y);
      const d = NEIGHBOUR_OFFSETS[this.rng.nextInt(8)] ?? NEIGHBOUR_OFFSETS[0];
      x += d?.x ?? 0;
      y += d?.y ?? 0;
      steps -= 1;
    }
  }
}

function landmassIds(w: World): number {
  // Flood-fill land masses (ids 1…) and water bodies (ids 1… in the same numbering the
  // original shares between both: it labels land first). INFERRED: the original's labelling
  // order; the engine only needs distinct ids per connected area.
  w.landmass.fill(0);
  let next = 1;
  const stack: number[] = [];
  for (let i = 0; i < w.area; i++) {
    if (w.landmass[i] !== 0) continue;
    const ocean = (w.terrain[i] ?? OCEAN) === OCEAN;
    const id = Math.min(63, next++);
    stack.push(i);
    w.landmass[i] = id;
    while (stack.length > 0) {
      const k = stack.pop() ?? 0;
      const p = w.position(k);
      for (const n of w.neighbours(p.x, p.y)) {
        if (!n) continue;
        const j = w.index(n.x, n.y);
        if (w.landmass[j] !== 0) continue;
        if (((w.terrain[j] ?? OCEAN) === OCEAN) !== ocean) continue;
        w.landmass[j] = id;
        stack.push(j);
      }
    }
  }
  return next - 1;
}

/** Make a random world. */
export function generateMap(params: MapParams, rules: EngineRules, rng: Rng): World {
  const b = new Builder(params, rng);
  const width = b.width;
  const rows = b.height;
  const L = params.landMass;
  const F = params.landForm;
  const C = params.flatEarth ? params.climate * 2 : params.climate;
  const T = params.flatEarth ? params.temperature * 2 : params.temperature;
  const A = params.age;

  // Growth bounds: a four-row margin at the top or a five-row margin at the bottom.
  if (rng.nextInt(2) === 0) b.yMax = rows - 5;
  else b.yMin = 4;

  // Continents until the land target.
  const target = Math.trunc(
    (Math.trunc((rows * width) / 2 / 400) * ((L * 8 + 8 + Math.max(0, F) * 8) * 5 + 80) * 8) / 10,
  );
  while (b.landCount < target) b.grow(false);

  // Islands for the land-mass ids still free (up to 63 land masses).
  {
    const w0 = new World({ columns: params.columns, rows, flatEarth: params.flatEarth });
    for (let i = 0; i < w0.area; i++) w0.terrain[i] = (b.height2[i] ?? 0) === 0 ? OCEAN : GRASSLAND;
    const used = landmassIds(w0);
    const free = 64 - (used + 1);
    for (let i = 0; i < free; i++) b.grow(true);
  }

  // No diagonal-only joins: fill the three squares of a 6 or 9 pattern.
  for (let y = 1; y < rows - 2; y++) {
    for (let x = y & 1; x < width - 2; x += 2) {
      const land = (px: number, py: number) => {
        const wx = b.wrap(px);
        return wx !== null && py >= 0 && py < rows && (b.height2[b.index(wx, py)] ?? 0) !== 0;
      };
      let bits = 0;
      if (land(x, y)) bits |= 1;
      if (land(x + 1, y + 1)) bits |= 2;
      if (land(x + 1, y - 1)) bits |= 4;
      if (land(x + 2, y)) bits |= 8;
      if (bits === 6 || bits === 9) {
        for (const [px, py] of [
          [x + 1, y + 1],
          [x + 1, y - 1],
          [x + 2, y],
        ] as const) {
          const wx = b.wrap(px);
          if (wx !== null && py >= 0 && py < rows) b.height2[b.index(wx, py)] = 1;
        }
        if (x < 2 || y < 2) {
          if (y < 2) {
            if (x > 1) x -= 2;
          } else {
            y -= 1;
            x += 1;
          }
        } else {
          x -= 1;
          y -= 1;
        }
      }
    }
  }

  // Terrain by height class and latitude.
  const band = Math.max(2, params.flatEarth ? rows >> 3 : Math.trunc(rows / 12));
  let y = 0;
  let x = 0;
  for (let i = 0; i < b.terrain.length; i++) {
    const cls = b.height2[i] ?? 0;
    let t: number;
    if (cls === 0) t = OCEAN;
    else if (cls === 1) {
      const shift = params.flatEarth ? -6 * T : -3 * T;
      let lat = (rows >> 1) + 8 - (y + rng.nextInt(16) + 1);
      if (lat < 1) lat = -lat;
      lat += shift;
      if (lat < 1) lat = 0;
      const zone = Math.trunc(lat / band);
      if (zone === 0) t = DESERT;
      else if (zone <= 3) t = PLAINS;
      else if (zone === 4) t = rng.nextInt(2) === 0 ? PLAINS : TUNDRA;
      else if (zone <= 6) t = TUNDRA;
      else t = GLACIER;
    } else if (cls === 2) t = HILLS;
    else t = MOUNTAINS;
    b.terrain[i] = t;
    x += 2;
    if (x >= width) {
      y += 1;
      x = y & 1;
    }
  }

  // Two moisture sweeps per row.
  for (let yy = 0; yy < rows; yy++) {
    const dist = Math.abs((rows >> 1) - yy);
    const inner = Math.abs((rows >> 2) - dist);
    const cap = T * 4 + 4 + inner;
    let m = cap < 1 ? 0 : rng.nextInt(T * 4 + inner + 5);
    for (let xx = yy & 1; xx < width; xx += 2) {
      const t = b.at(xx, yy);
      if (t === OCEAN) {
        if (m < cap) m += 1;
      } else if (m > 0) {
        if (6 - 2 * T > 0) m -= rng.nextInt(7 - 2 * T);
        switch (t) {
          case DESERT:
            b.set(xx, yy, PLAINS);
            break;
          case PLAINS:
            b.set(xx, yy, GRASSLAND);
            break;
          case HILLS:
            b.set(xx, yy, FOREST);
            break;
          case MOUNTAINS:
            m -= 3;
            break;
          case TUNDRA:
            b.set(xx, yy, FOREST);
            break;
          default:
            break;
        }
      }
    }
    // INFERRED: the original's second sweep walks the buffer backwards across all rows, which
    // pairs each row's parameters with its mirror row; the parameters are symmetric, so the
    // engine sweeps the row itself east to west.
    m = 0;
    for (let xx = width - ((yy & 1) + 1); xx >= 0; xx -= 2) {
      const t = b.at(xx, yy);
      if (t === OCEAN) {
        if (m < (dist >> 1) + T + 1) m += 1;
      } else if (m > 0) {
        if (6 - (2 * T + 2) > 0) m -= rng.nextInt(7 - (2 * T + 2));
        switch (t) {
          case DESERT:
            b.set(xx, yy, PLAINS);
            break;
          case PLAINS:
            b.set(xx, yy, GRASSLAND);
            break;
          case GRASSLAND:
            if (dist < Math.trunc((rows * 3) / 10)) b.set(xx, yy, dist < 10 ? JUNGLE : SWAMP);
            else b.set(xx, yy, FOREST);
            m -= 2;
            break;
          case HILLS:
            b.set(xx, yy, FOREST);
            break;
          case MOUNTAINS:
            m -= 3;
            break;
          case TUNDRA:
            b.set(xx, yy, PLAINS);
            break;
          case SWAMP:
            b.set(xx, yy, FOREST);
            break;
          default:
            break;
        }
      }
    }
  }

  // Erosion by age.
  const walk = { x: 0, y: 0 };
  const randomSquare = () => {
    walk.y = rng.nextInt(rows);
    walk.x = (walk.y & 1) + rng.nextInt(width >> 1) * 2;
  };
  const stepWalk = () => {
    const d = NEIGHBOUR_OFFSETS[rng.nextInt(8)] ?? NEIGHBOUR_OFFSETS[0];
    walk.x += d?.x ?? 0;
    walk.y += d?.y ?? 0;
    const wx = b.wrap(walk.x);
    if (wx !== null) walk.x = wx;
  };
  const erosions = (A * 5 + 10) * 160;
  for (let i = 0; i < erosions; i++) {
    if ((i & 1) === 0) randomSquare();
    else stepWalk();
    if (!b.valid(walk.x, walk.y)) continue;
    const dist = Math.abs((rows >> 1) - walk.y);
    switch (b.at(walk.x, walk.y)) {
      case DESERT:
        b.set(walk.x, walk.y, PLAINS);
        break;
      case PLAINS:
        b.set(walk.x, walk.y, HILLS);
        break;
      case GRASSLAND:
        b.set(walk.x, walk.y, FOREST);
        break;
      case FOREST:
        b.set(walk.x, walk.y, dist < Math.trunc((rows * 3) / 10) ? JUNGLE : PLAINS);
        break;
      case HILLS:
        b.set(walk.x, walk.y, MOUNTAINS);
        break;
      case MOUNTAINS: {
        // A mountain ringed by land at two squares along the axes becomes a lake (0x00404adf).
        const { x: px, y: py } = walk;
        if (
          px >= 2 &&
          py >= 2 &&
          px < width - 2 &&
          py < rows - 2 &&
          b.at(px - 2, py) !== OCEAN &&
          b.at(px + 2, py) !== OCEAN &&
          b.at(px, py - 2) !== OCEAN &&
          b.at(px, py + 2) !== OCEAN
        )
          b.set(px, py, OCEAN);
        break;
      }
      case TUNDRA:
        b.set(walk.x, walk.y, HILLS);
        break;
      case GLACIER:
        b.set(walk.x, walk.y, MOUNTAINS);
        break;
      case SWAMP:
        b.set(walk.x, walk.y, GRASSLAND);
        break;
      case JUNGLE:
        b.set(walk.x, walk.y, SWAMP);
        break;
      default:
        break;
    }
  }

  // Smoothing (only the youngest worlds): a square takes its most common neighbour.
  const smoothings = (3 - (A + 2)) * 800;
  let last = -1;
  for (let i = 0; i < smoothings; i++) {
    if ((i & 1) === 0) {
      randomSquare();
      last = -1;
    } else stepWalk();
    if (!b.valid(walk.x, walk.y) || b.at(walk.x, walk.y) === OCEAN) continue;
    const here = b.at(walk.x, walk.y);
    if (last >= 0 && last === here) continue;
    const rough = here > 2;
    const counts = new Int32Array(11);
    const add = (t: number, n: number) => {
      counts[t] = (counts[t] ?? 0) + n;
    };
    if (T === -1) {
      add(DESERT, 1);
      add(PLAINS, 1);
      add(SWAMP, -1);
    } else if (T === 1) {
      add(GRASSLAND, 1);
      add(SWAMP, 1);
      if (C >= 0) add(JUNGLE, 1);
    }
    if (C === -1) {
      add(TUNDRA, 1);
      add(FOREST, 1);
      add(DESERT, -1);
    } else if (C === 1) {
      add(PLAINS, 1);
      add(TUNDRA, -1);
      add(GLACIER, -1);
      if (T === -1) {
        add(GRASSLAND, -1);
        add(JUNGLE, -1);
      }
    }
    for (let d = 0; d < 8; d++) {
      const off = NEIGHBOUR_OFFSETS[d];
      if (!off) continue;
      const nx = walk.x + off.x;
      const ny = walk.y + off.y;
      if (!b.valid(nx, ny)) continue;
      const t = b.at(nx, ny);
      if (t === OCEAN) continue;
      if (t > 2 && rough && (counts[t] ?? 0) !== 0) add(t, 1);
      if ((d & 1) === 0) add(t, 1);
      add(t, 1);
    }
    let best = 0;
    for (let t = 0; t < 11; t++) {
      if ((counts[t] ?? 0) > best) {
        best = counts[t] ?? 0;
        b.set(walk.x, walk.y, t);
        last = t;
      }
    }
  }

  // Rivers (0x00404bf8).
  const wanted = L * 2 + T * 2 + 12;
  let rivers = 0;
  for (let attempt = 1; attempt <= 1024 && rivers < wanted; attempt++) {
    const backupT = Uint8Array.from(b.terrain);
    const backupR = Uint8Array.from(b.river);
    let ry = 0;
    let rx = 0;
    let t = OCEAN;
    for (;;) {
      ry = rng.nextInt(rows);
      rx = rng.nextInt(width >> 1) * 2 + (ry & 1);
      t = b.at(rx, ry);
      if (t !== MOUNTAINS && t !== OCEAN) break;
    }
    let dir = rng.nextInt(4);
    let length = 0;
    let reachedSea = false;
    let joined = false;
    for (;;) {
      switch (t) {
        case DESERT:
          t = rng.nextInt(10) > 1 || length > 3 ? GRASSLAND : PLAINS;
          break;
        case PLAINS:
          if (rng.nextInt(10) > 3) t = GRASSLAND;
          break;
        case FOREST:
          if (rng.nextInt(10) > 2) t = GRASSLAND;
          break;
        case HILLS:
        case MOUNTAINS:
          t = GRASSLAND;
          break;
        case TUNDRA:
          t = PLAINS;
          break;
        case GLACIER:
          t = TUNDRA;
          break;
        case SWAMP:
          if (rng.nextInt(10) > 3) t = JUNGLE;
          break;
        default:
          break;
      }
      b.set(rx, ry, t);
      const wx = b.wrap(rx);
      if (wx !== null) b.river[b.index(wx, ry)] = 1;
      length += 1;
      for (const d of RIVER_DIRS) {
        if (b.valid(rx + d.x, ry + d.y) && b.at(rx + d.x, ry + d.y) === OCEAN) reachedSea = true;
      }
      dir = (dir + rng.nextInt(2) - (length & 1)) & 3;
      const d = RIVER_DIRS[dir] ?? RIVER_DIRS[0];
      rx += d?.x ?? 0;
      ry += d?.y ?? 0;
      if (reachedSea || !b.valid(rx, ry)) break;
      const nwx = b.wrap(rx);
      if (nwx !== null && (backupR[b.index(nwx, ry)] ?? 0) !== 0) {
        joined = true;
        break;
      }
      t = b.at(rx, ry);
    }
    if ((reachedSea || joined) && length >= 5 - Math.trunc(attempt / 800)) rivers += 1;
    else {
      b.terrain.set(backupT);
      b.river.set(backupR);
    }
  }

  // Polar rows: glacier beside land at the poles (round worlds).
  if (!params.flatEarth) {
    for (let xx = 0; xx < width; xx += 2) {
      if (b.at(xx + 1, 1) !== OCEAN) b.set(xx, 0, GLACIER);
      if (b.at(xx, rows - 2) !== OCEAN) b.set(xx + 1, rows - 1, GLACIER);
    }
  }

  const world = new World({
    columns: params.columns,
    rows,
    flatEarth: params.flatEarth,
    resourceSeed: Math.max(1, rng.nextInt(0x7fff)),
  });
  world.terrain.set(b.terrain);
  for (let i = 0; i < world.area; i++)
    if ((b.river[i] ?? 0) !== 0) world.flags[i] = (world.flags[i] ?? 0) | SquareFlag.River;
  landmassIds(world);
  computeFertility(world, rules);

  if (!params.flatEarth) {
    for (let xx = 0; xx < width; xx += 2) {
      world.terrain[world.index(xx, 0)] = GLACIER;
      world.terrain[world.index(xx + 1, rows - 1)] = GLACIER;
    }
    for (let i = 0; i < width >> 3; i++) {
      world.terrain[world.index(rng.nextInt(width >> 1) * 2, 0)] = TUNDRA;
      world.terrain[world.index(rng.nextInt(width >> 1) * 2 + 1, 1)] = TUNDRA;
      world.terrain[world.index(rng.nextInt(width >> 1) * 2 + 1, rows - 1)] = TUNDRA;
      world.terrain[world.index(rng.nextInt(width >> 1) * 2, rows - 2)] = TUNDRA;
    }
  }
  // Deep ocean: an ocean square with a special but no land within the twenty radius squares
  // keeps the special suppressed.
  for (let i = 0; i < world.area; i++) {
    if ((world.terrain[i] ?? OCEAN) !== OCEAN) continue;
    const p = world.position(i);
    let land = false;
    for (let k = 0; k < 20 && !land; k++) {
      const q = world.radiusSquare(p.x, p.y, k);
      if (q && world.terrainAt(q.x, q.y) !== OCEAN) land = true;
    }
    if (!land) world.flags[i] = (world.flags[i] ?? 0) | SquareFlag.NoSpecial;
  }
  landmassIds(world);
  return world;
}
