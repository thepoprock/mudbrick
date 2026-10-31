/**
 * The world model: the map and everything standing on it.
 *
 * This is the engine's own representation, independent of any file format. Loaders (for the
 * original save files, or our own) build a `World`; the renderer and the rules read it. Square
 * data lives in flat typed arrays indexed by `squareIndex`, which keeps a 150×120 map cheap to
 * copy, hash and ship to a worker.
 *
 * Coordinates follow the original game's isometric convention (docs/formats/map-format.md): a
 * square exists only where x + y is even; stored column c on row y is game x = 2c + (y mod 2).
 */

/** Terrain index into RULES.TXT @TERRAIN: 0 Desert … 10 Ocean. */
export type TerrainId = number;
export const OCEAN: TerrainId = 10;

/** Bit flags stored per square in `World.flags`. */
export const SquareFlag = {
  River: 1 << 0,
  Road: 1 << 1,
  Railroad: 1 << 2,
  Irrigation: 1 << 3,
  Farmland: 1 << 4,
  Mine: 1 << 5,
  Fortress: 1 << 6,
  Airbase: 1 << 7,
  Pollution: 1 << 8,
  /** Map square byte 0 bit 6: the special-resource formula is suppressed on this square. */
  NoSpecial: 1 << 9,
} as const;
export type SquareFlag = (typeof SquareFlag)[keyof typeof SquareFlag];

export interface Point {
  x: number;
  y: number;
}

export interface Civ {
  /** 0 = barbarians, 1–7 = players. */
  slot: number;
  /** RULES.TXT @LEADERS index, or null for barbarians. */
  tribe: number | null;
  name: string;
  adjective: string;
  leader: string;
  /** City graphics style 0–3 from the rules (Bronze Age, Classical, Far East, Medieval). */
  cityStyle: number;
  /** 0 Ancient … 3 Modern: the highest epoch among the advances this civilization knows. */
  epoch: number;
  /** Colour set 1–7 (barbarians use 0). */
  colour: number;
  government: number;
  treasury: number;
  isHuman: boolean;
  inPlay: boolean;
}

export interface City {
  id: number;
  position: Point;
  owner: number;
  name: string;
  size: number;
  /** Indexed by RULES.TXT @IMPROVE index. */
  improvements: boolean[];
  foodStored: number;
  shieldsStored: number;
  inDisorder: boolean;
}

export interface Unit {
  id: number;
  position: Point;
  owner: number;
  /** RULES.TXT @UNITS index. */
  type: number;
  veteran: boolean;
  hitPointsLost: number;
  movesSpent: number;
  fortified: boolean;
  homeCity: number | null;
}

export interface WorldInit {
  columns: number;
  rows: number;
  flatEarth: boolean;
  /** Resource seed from the map header; drives the special-resource and hut patterns. */
  resourceSeed?: number;
}

export class World {
  readonly columns: number;
  readonly rows: number;
  readonly flatEarth: boolean;
  /** Resource seed (map header +8). See docs/engine/rules-map.md. */
  readonly resourceSeed: number;
  /** One terrain id per square. */
  readonly terrain: Uint8Array;
  /** `SquareFlag` bits per square. */
  readonly flags: Uint16Array;
  /** Land-mass / water-body id per square, as the original tracks it. */
  readonly landmass: Uint8Array;
  readonly civs: Civ[] = [];
  readonly cities: City[] = [];
  readonly units: Unit[] = [];

  constructor(init: WorldInit) {
    if (init.columns < 1 || init.rows < 1) throw new RangeError('world needs at least one square');
    this.columns = init.columns;
    this.rows = init.rows;
    this.flatEarth = init.flatEarth;
    this.resourceSeed = init.resourceSeed ?? 1;
    const area = init.columns * init.rows;
    this.terrain = new Uint8Array(area).fill(OCEAN);
    this.flags = new Uint16Array(area);
    this.landmass = new Uint8Array(area);
  }

  /** Width in game coordinates (twice the stored columns). */
  get widthX2(): number {
    return this.columns * 2;
  }

  get area(): number {
    return this.columns * this.rows;
  }

  /** True if (x, y) names a real square: inside the map and with x + y even. */
  isSquare(x: number, y: number): boolean {
    return y >= 0 && y < this.rows && ((x + y) & 1) === 0 && this.wrapX(x, y) !== null;
  }

  /**
   * Wrap an x coordinate on a round world; return null if it is off the map.
   * On a flat world nothing wraps.
   */
  wrapX(x: number, y: number): number | null {
    const w = this.widthX2;
    if (x >= 0 && x < w) return x;
    if (this.flatEarth) return null;
    const wrapped = ((x % w) + w) % w;
    return ((wrapped + y) & 1) === 0 ? wrapped : null;
  }

  /** Flat index of game square (x, y). Throws if it is not a square. */
  index(x: number, y: number): number {
    const wx = this.wrapX(x, y);
    if (wx === null || y < 0 || y >= this.rows || ((wx + y) & 1) !== 0) {
      throw new RangeError(`(${x}, ${y}) is not a square on a ${this.widthX2}×${this.rows} world`);
    }
    return y * this.columns + ((wx - (y & 1)) >> 1);
  }

  /** Game coordinates of a flat index. */
  position(index: number): Point {
    const y = Math.floor(index / this.columns);
    const c = index - y * this.columns;
    return { x: 2 * c + (y & 1), y };
  }

  terrainAt(x: number, y: number): TerrainId {
    return this.terrain[this.index(x, y)] ?? OCEAN;
  }

  hasFlag(x: number, y: number, flag: SquareFlag): boolean {
    return ((this.flags[this.index(x, y)] ?? 0) & flag) !== 0;
  }

  setFlag(x: number, y: number, flag: SquareFlag, on = true): void {
    const i = this.index(x, y);
    const cur = this.flags[i] ?? 0;
    this.flags[i] = on ? cur | flag : cur & ~flag;
  }

  isLand(x: number, y: number): boolean {
    return this.terrainAt(x, y) !== OCEAN;
  }

  /**
   * The eight neighbours of a square, clockwise from north (up): N, NE, E, SE, S, SW, W, NW,
   * in the isometric grid where "north" is (x, y − 2) and "north-east" is (x + 1, y − 1).
   * Off-map neighbours (flat world edges, top and bottom rows) are null.
   */
  neighbours(x: number, y: number): (Point | null)[] {
    const d: [number, number][] = [
      [0, -2],
      [1, -1],
      [2, 0],
      [1, 1],
      [0, 2],
      [-1, 1],
      [-2, 0],
      [-1, -1],
    ];
    return d.map(([dx, dy]) => {
      const ny = y + dy;
      if (ny < 0 || ny >= this.rows) return null;
      const nx = this.wrapX(x + dx, ny);
      return nx === null ? null : { x: nx, y: ny };
    });
  }

  /**
   * The four edge-sharing neighbours of an isometric square, in the order the original art
   * expects for 4-bit variant masks: NE (x+1, y−1), SE (x+1, y+1), SW (x−1, y+1), NW (x−1, y−1).
   * Bit 0 of such a mask is NE, bit 3 is NW. Off-map neighbours are null.
   */
  directNeighbours(x: number, y: number): (Point | null)[] {
    const n = this.neighbours(x, y);
    return [n[1] ?? null, n[3] ?? null, n[5] ?? null, n[7] ?? null];
  }

  cityAt(x: number, y: number): City | undefined {
    const wx = this.wrapX(x, y);
    return this.cities.find((c) => c.position.x === wx && c.position.y === y);
  }

  unitsAt(x: number, y: number): Unit[] {
    const wx = this.wrapX(x, y);
    return this.units.filter((u) => u.position.x === wx && u.position.y === y);
  }
}
