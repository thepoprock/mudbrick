/**
 * Parser for the original `.MP` map files (the seven preset worlds and scenario maps).
 *
 * Specification: docs/formats/map-format.md.
 *
 * Coordinates. The game world is an isometric grid in which a square exists only where
 * (x + y) is even. Files store the squares row by row as `columns = widthX2 / 2` records per
 * row, so storage column `c` on row `y` is game square x = 2c + (y mod 2), y = y.
 */

export interface MapHeader {
  /** Game-coordinate width, which is twice the number of stored columns. */
  widthX2: number;
  height: number;
  /** Number of stored squares = widthX2 × height / 2. */
  area: number;
  flatEarth: boolean;
  /** Resource/goody-hut pattern seed; 64 distinct patterns (value mod 64). 0 or 1 → random in-game. */
  resourceSeed: number;
  /** Minimap width = ceil(widthX2 / 4), as written by the editor. */
  locatorWidth: number;
  /** Minimap height = ceil(height / 4). */
  locatorHeight: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Decoded view of one 6-byte square record. */
export interface Square {
  /** Index into RULES.TXT @TERRAIN (0 Desert … 10 Ocean). */
  terrain: number;
  river: boolean;
  /** Bit 6 of byte 0. Marked in the file but NOT authoritative: the game places specials by formula. */
  resourceFlag: boolean;
  unit: boolean;
  city: boolean;
  irrigation: boolean;
  farmland: boolean;
  mine: boolean;
  road: boolean;
  railroad: boolean;
  fortress: boolean;
  airbase: boolean;
  pollution: boolean;
  /** Byte 2: which civilization's city radius contains the square (raw). */
  cityRadiusOwnerRaw: number;
  /** Byte 3: land-mass / body-of-water identifier. */
  landmassId: number;
  /** Byte 4: one visibility bit per civilization slot 0–7. */
  visibilityMask: number;
  /** Byte 5 low nibble: AI fertility rating. */
  fertility: number;
  /** Byte 5 high nibble: ownership (raw). */
  ownershipRaw: number;
}

export interface MapFile {
  header: MapHeader;
  /** Stored columns per row = widthX2 / 2. */
  columns: number;
  rows: number;
  /** 21 starting positions in RULES.TXT @LEADERS order; `null` where the file has 0xFFFF. */
  startPositions: (Point | null)[];
  /** Raw 6 × area bytes, square-major. Use `squareAt` / `decodeSquare` to read them. */
  squares: Uint8Array;
}

export const MAP_HEADER_BYTES = 14;
export const START_POSITIONS = 21;
export const SQUARE_BYTES = 6;

const u16 = (v: DataView, off: number) => v.getUint16(off, true);

export function parseMap(bytes: Uint8Array): MapFile {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < MAP_HEADER_BYTES + START_POSITIONS * 4) {
    throw new Error(`map file too short (${bytes.byteLength} bytes)`);
  }
  const header: MapHeader = {
    widthX2: u16(v, 0),
    height: u16(v, 2),
    area: u16(v, 4),
    flatEarth: u16(v, 6) !== 0,
    resourceSeed: u16(v, 8),
    locatorWidth: u16(v, 10),
    locatorHeight: u16(v, 12),
  };
  if (header.widthX2 % 2 !== 0) throw new Error(`map width ${header.widthX2} is not even`);
  const columns = header.widthX2 / 2;
  if (columns * header.height !== header.area) {
    throw new Error(`map area ${header.area} ≠ ${columns} × ${header.height}`);
  }
  const expected = MAP_HEADER_BYTES + START_POSITIONS * 4 + header.area * SQUARE_BYTES;
  if (bytes.byteLength !== expected) {
    throw new Error(`map file is ${bytes.byteLength} bytes, expected ${expected}`);
  }
  const startPositions: (Point | null)[] = [];
  for (let i = 0; i < START_POSITIONS; i++) {
    const x = u16(v, MAP_HEADER_BYTES + 2 * i);
    const y = u16(v, MAP_HEADER_BYTES + 2 * START_POSITIONS + 2 * i);
    startPositions.push(x === 0xffff || y === 0xffff ? null : { x, y });
  }
  const squares = bytes.subarray(MAP_HEADER_BYTES + START_POSITIONS * 4);
  return { header, columns, rows: header.height, startPositions, squares };
}

/** Storage index of the square at stored column `c`, row `y`. */
export function squareIndex(map: MapFile, c: number, y: number): number {
  if (c < 0 || c >= map.columns || y < 0 || y >= map.rows) {
    throw new RangeError(`square (${c}, ${y}) outside ${map.columns}×${map.rows}`);
  }
  return y * map.columns + c;
}

/** Convert stored (column, row) to game coordinates. */
export function toGameCoords(c: number, y: number): Point {
  return { x: 2 * c + (y & 1), y };
}

/** Convert game coordinates to stored (column, row). Throws if (x + y) is odd. */
export function toStorageCoords(p: Point): { c: number; y: number } {
  if (((p.x + p.y) & 1) !== 0) {
    throw new RangeError(`(${p.x}, ${p.y}) is not a square: x + y must be even`);
  }
  return { c: (p.x - (p.y & 1)) / 2, y: p.y };
}

export function decodeSquare(map: MapFile, index: number): Square {
  const v = new DataView(map.squares.buffer, map.squares.byteOffset, map.squares.byteLength);
  return decodeSquareBytes(v, index * SQUARE_BYTES);
}

/**
 * Decode one 6-byte square record at `o`. Shared by `.MP` maps and the terrain block of save
 * files, which use the identical layout (docs/formats/map-format.md, "Square record").
 */
export function decodeSquareBytes(v: DataView, o: number): Square {
  const b0 = v.getUint8(o);
  const b1 = v.getUint8(o + 1);
  const b2 = v.getUint8(o + 2);
  const b3 = v.getUint8(o + 3);
  const b4 = v.getUint8(o + 4);
  const b5 = v.getUint8(o + 5);
  const bit = (b: number, n: number) => ((b >> n) & 1) === 1;
  const irrigationBit = bit(b1, 2);
  const mineBit = bit(b1, 3);
  const cityBit = bit(b1, 1);
  const fortressBit = bit(b1, 6);
  return {
    terrain: b0 & 0x0f,
    river: bit(b0, 7),
    resourceFlag: bit(b0, 6),
    unit: bit(b1, 0),
    city: cityBit,
    irrigation: irrigationBit && !mineBit,
    farmland: irrigationBit && mineBit,
    mine: mineBit && !irrigationBit,
    road: bit(b1, 4),
    railroad: bit(b1, 4) && bit(b1, 5),
    fortress: fortressBit && !cityBit,
    airbase: cityBit && fortressBit,
    pollution: bit(b1, 7),
    cityRadiusOwnerRaw: b2,
    landmassId: b3,
    visibilityMask: b4,
    fertility: b5 & 0x0f,
    ownershipRaw: b5 >> 4,
  };
}

export function squareAt(map: MapFile, c: number, y: number): Square {
  return decodeSquare(map, squareIndex(map, c, y));
}
