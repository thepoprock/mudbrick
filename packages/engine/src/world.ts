import type { CivStrategy } from './aiStrategy.js';
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

/**
 * The original's eight-neighbour table (VERIFIED, read from the executable's data at
 * 0x5b2e18/0x5b2e28): clockwise from north-east. Road segments 1–8 and several other tables
 * use this order.
 */
export const NEIGHBOUR_OFFSETS: readonly Point[] = [
  { x: 1, y: -1 }, // NE
  { x: 2, y: 0 }, // E
  { x: 1, y: 1 }, // SE
  { x: 0, y: 2 }, // S
  { x: -1, y: 1 }, // SW
  { x: -2, y: 0 }, // W
  { x: -1, y: -1 }, // NW
  { x: 0, y: -2 }, // N
];

/**
 * The 21 squares of a city's radius in the original's order (VERIFIED, 0x5b2e38/0x5b2e68):
 * the eight neighbours above, the four distance-2 diagonals, the eight outer squares, and
 * finally the city square itself (index 20). Bit i of a city's worked-squares mask is square i.
 */
export const CITY_RADIUS_OFFSETS: readonly Point[] = [
  ...NEIGHBOUR_OFFSETS,
  { x: 2, y: -2 },
  { x: 2, y: 2 },
  { x: -2, y: 2 },
  { x: -2, y: -2 },
  { x: 1, y: -3 },
  { x: 3, y: -1 },
  { x: 3, y: 1 },
  { x: 1, y: 3 },
  { x: -1, y: 3 },
  { x: -3, y: 1 },
  { x: -3, y: -1 },
  { x: -1, y: -3 },
  { x: 0, y: 0 },
];
export const CITY_CENTRE_INDEX = 20;

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
  /** The civilization has held a city (so losing its last one destroys it, 0x00483657). */
  hadCity?: boolean;
  /** Beakers toward the current research target. */
  scienceStored: number;
  /** Advance index being researched, or null. */
  researching: number | null;
  /** Discoveries so far (drives research cost). */
  advancesCount: number;
  futureTechs: number;
  /** Rates in tenths; luxuries are the remainder. */
  scienceRate: number;
  taxRate: number;
  /** Indexed by advance index. */
  knownAdvances: boolean[];
  /** A free advance (Philosophy) is owed and granted at the next discovery check. */
  freeAdvancePending: boolean;
  /** The AI's strategic state (aiStrategy.ts); created on first use. */
  strategy?: CivStrategy;
  /** Treaty words toward each slot (diplomacy.ts TREATY bits; civilization record +32). */
  treaties?: Uint32Array;
  /** Attitude toward each slot, 0–100 (record +64). */
  attitudes?: Uint8Array;
  /** Reputation 0–100 (record +30). */
  reputation?: number;
  /** Civilization flags 0x100 and 0x80: it has signed an alliance, it has traded knowledge. */
  everAllied?: boolean;
  everExchanged?: boolean;
  /** The Eiffel Tower's one-time amnesty has been used (civilization byte 0 bit 4, 0x004b7d88). */
  eiffelApplied?: boolean;
  /** Conversations with humans this round (record +31); the patience counter in negotiation. */
  talks?: number;
  /** What this civilization has forgiven of each other's reputation (record +72, signed). */
  pardons?: Int8Array;
  /** Civilization flag bit 2, read by the senate test under the Republic (0x0050f0ea). */
  senateActive?: boolean;
  /** A per-turn random 0–99 the original keeps at record +22 (patience, INFERRED name). */
  patience?: number;
  /** A counter at record +31 that falls every third turn (INFERRED name). */
  restraint?: number;
  /** Per slot: the turn that slot last attacked or declared war on us, −1 none (record +994). */
  lastWarTurns?: Int16Array;
  /** Record +0x48, 8 bytes: treaty breaks charged per slot (INFERRED name; 0x004447be writes it). */
  treatyBreaks?: Uint8Array;
  /** Government preference scores, 7 × i16 (record +980). */
  governmentScores?: Int16Array;
  /** The best `2 × shields − support` over the cities processed so far this turn (+0x3d2),
   * for the advisor's wonder rule; reset with the government scores. */
  bestProduction?: number;
  /** The record's leading flag word (+0): bit 0 revolution pending, bit 2 a per-turn toggle. */
  civFlags?: number;
  /** Diplomatic incidents suffered or caused (civilization record +28; bribes +1, incitements +2). */
  incidents?: number;
  /** The spaceship (civilization record +0x400; spaceship.ts). */
  spaceship?: import('./spaceship.js').Spaceship;
}

export type Production = { kind: 'unit'; index: number } | { kind: 'improvement'; index: number };

export interface Specialists {
  entertainers: number;
  taxCollectors: number;
  scientists: number;
}

export interface City {
  id: number;
  position: Point;
  owner: number;
  name: string;
  size: number;
  /** Indexed by RULES.TXT @IMPROVE index; wonders (39–66) are set on the city that holds them. */
  improvements: boolean[];
  foodStored: number;
  shieldsStored: number;
  /** Bit i = square CITY_RADIUS_OFFSETS[i] is worked (the centre, bit 20, always is). */
  worked: number;
  specialists: Specialists;
  production: Production;
  inDisorder: boolean;
  /** Set on the second consecutive turn of disorder (the original's flag bit 13). */
  disorderRepeated?: boolean;
  /** Owner before the last capture (the save's byte 10); a recapture by it is a liberation. */
  previousOwner?: number;
  /** Turn of the last capture (the save's byte 11). */
  capturedTurn?: number;
  celebrating: boolean;
  /** Owners of outgoing trade routes' partner cities and whether each carries food. */
  /** Up to three routes: the partner city id and the commodity (−1 = food). */
  tradeRoutes: { partner: number; food: boolean; commodity?: number }[];
  /** Commodities offered, three signed bytes; negative = carried by a route (city record +59). */
  supplied?: Int8Array;
  /** Commodities wanted, three signed bytes; negative = already received (city record +62). */
  demanded?: Int8Array;
  /** Trade after corruption and before routes, from the last city turn (city record +30). */
  lastTrade?: number;
  /** Shields made at the last city turn (the record's byte 81), for the advisor's comparisons. */
  lastShields?: number;
  /** Happy and unhappy citizens at the last city turn (bytes 82 and 83), for the score. */
  lastHappy?: number;
  lastUnhappy?: number;
  /** The commodity lists must be recomputed at the next city turn (city flag bit 17). */
  recomputeTrade?: boolean;
  /** AI: the city has a terrain-work objective out (city flag bit 19). */
  terraformTask?: boolean;
  /** An advance was stolen from here (city flag bit 3); a second theft is harder. */
  techStolen?: boolean;
  /** A spy has investigated the city (city flag bit 22). */
  investigated?: boolean;
  /** AI: a wanted settler stands within four squares (city flag 0x40). */
  workerNearby?: boolean;
  /** Scenario objective city (the record's byte 7 bit 2), for objective victory. */
  objective?: boolean;
  /** Has completed a wonder (city flag bit 8; the AI then values wonders ×3). */
  wonderCity?: boolean;
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
  /** True while the order is Fortified (kept in step with `order`). */
  fortified: boolean;
  homeCity: number | null;
  /** Standing order as a RULES @ORDERS index (see terraform.ts ORDER), or null. */
  order: number | null;
  /** Settlers' work progress, or an air unit's turns of fuel used. */
  workCounter: number;
  gotoTarget: Point | null;
  /** 0–7 clockwise from north-east, or null. */
  lastDirection: number | null;
  /** Go-to steps taken toward the current target (the original asks to give up past 47). */
  gotoSteps: number;
  /** Moved this turn (the original's flag bit 6); such a unit does not heal next turn. */
  moved?: boolean;
  /** Caravans/freight: RULES @CARAVAN commodity index, or 0xFF for a food caravan. */
  commodity?: number;
  /** AI: a settler the strategic layer wants to found a city (unit flag 0x200). */
  wanted?: boolean;
  /** AI: the unit stands on its objective (unit flag 0x80). */
  arrived?: boolean;
  /** Carried by this ship (the original keeps the ship's index in the go-to x field of a sentried passenger). */
  aboard?: number;
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
  /** Per square: bit n = civilization slot n has seen it (map byte 4). */
  readonly seen: Uint8Array;
  /** Per square: civilization slot whose city radius claims it, 0 none (map byte 2). */
  readonly territory: Uint8Array;
  /** Per square: fertility rating 0 or 8–15 (map byte 5, low nibble; fertility.ts). */
  readonly fertility: Uint8Array;
  /** Land and rated squares per land mass, computed on first use (aiStrategy.ts). */
  landmassStats?: { land: number[]; rated: number[] };
  readonly civs: Civ[] = [];
  /** A battle between two civilizations happened this turn (resets the turns of peace). */
  peaceBroken = false;
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
    this.seen = new Uint8Array(area);
    this.territory = new Uint8Array(area);
    this.fertility = new Uint8Array(area);
  }

  /** Has civilization `slot` seen square (x, y)? Map byte 4 bit n (VERIFIED). */
  isSeen(x: number, y: number, slot: number): boolean {
    return ((this.seen[this.index(x, y)] ?? 0) & (1 << slot)) !== 0;
  }

  /** Mark (x, y) and its eight neighbours seen by `slot` (INFERRED sight radius of one). */
  /** Mark one square seen by `slot`. */
  revealSquare(x: number, y: number, slot: number): void {
    const i = this.index(x, y);
    this.seen[i] = (this.seen[i] ?? 0) | (1 << slot);
  }

  /** The square `dx`, `dy` away in game coordinates, wrapped; null off the map. */
  offsetSquare(x: number, y: number, dx: number, dy: number): Point | null {
    const ny = y + dy;
    if (ny < 0 || ny >= this.rows) return null;
    const nx = this.wrapX(x + dx, ny);
    return nx === null ? null : { x: nx, y: ny };
  }

  /** Mark a square and its eight neighbours seen by `slot` (a unit's basic sight). */
  reveal(x: number, y: number, slot: number): void {
    const bit = 1 << slot;
    const mark = (p: Point | null) => {
      if (p) this.seen[this.index(p.x, p.y)] = (this.seen[this.index(p.x, p.y)] ?? 0) | bit;
    };
    mark({ x, y });
    for (const n of this.neighbours(x, y)) mark(n);
  }

  /** Mark the 21 squares of a city radius seen by `slot`. */
  revealRadius(x: number, y: number, slot: number): void {
    const bit = 1 << slot;
    for (let i = 0; i < 21; i++) {
      const p = this.radiusSquare(x, y, i);
      if (p) this.seen[this.index(p.x, p.y)] = (this.seen[this.index(p.x, p.y)] ?? 0) | bit;
    }
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

  /** Game coordinates of radius square `i` of a city at (x, y), or null when off the map. */
  radiusSquare(x: number, y: number, i: number): Point | null {
    const o = CITY_RADIUS_OFFSETS[i];
    if (!o) return null;
    const ny = y + o.y;
    if (ny < 0 || ny >= this.rows) return null;
    const nx = this.wrapX(x + o.x, ny);
    return nx === null ? null : { x: nx, y: ny };
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
