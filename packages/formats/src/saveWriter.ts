/**
 * Write a save file: start from the original bytes, replace the fields the game changes, and
 * rebuild the unit and city blocks (whose lengths change as units die and cities are founded).
 *
 * Only fields the parser understands are written; everything else is copied byte for byte from
 * the source record (or zeroed for new records). `patchFromSave` turns a parsed file back into a
 * patch, which is how the round-trip test proves the writer faithful: parse → patch → write →
 * parse equals the original.
 *
 * Spec: docs/formats/save-format.md. Stack links (unit record +22/+24) are VERIFIED from real
 * saves: units on one square form a doubly linked list in record order, "above" pointing to the
 * next record and "below" to the previous, 0xFFFF at both ends.
 */
import { encodeText } from './text.js';
import type { Point } from './map.js';
import type { CityRecord, CivRecord, SaveFile, UnitRecord } from './save.js';

export interface UnitWrite {
  /** Original record id to copy unknown bytes from; omit for a new unit. */
  source?: number;
  x: number;
  y: number;
  owner: number;
  type: number;
  veteran: boolean;
  hasMoved: boolean;
  waiting?: boolean;
  movesSpent: number;
  hitPointsLost: number;
  lastMoveDirection: number | null;
  /** Work counter, fuel used or caravan commodity. */
  counter: number;
  /** File order code: RULES @ORDERS index + 1, 0xFF none. */
  order: number;
  /** City record index, 0xFF none. */
  homeCity: number;
  goTo: Point | null;
  visibleToMask?: number;
  /** Stack links to keep (record indices in the new file); computed in record order when absent. */
  linkAbove?: number;
  linkBelow?: number;
}

export interface CityWrite {
  source?: number;
  x: number;
  y: number;
  owner: number;
  size: number;
  founder: number;
  capturedTurn: number;
  name: string;
  foodStored: number;
  shieldsStored: number;
  /** Bits 0–20 in the original's radius order (bit 20 = centre). */
  workedMask: number;
  /** Per-citizen specialist codes (0 none, 1 entertainer, 2 tax collector, 3 scientist), up to 16. */
  specialists: number[];
  /** Indexed by @IMPROVE index; 1–38 are written. */
  improvements: boolean[];
  production: { kind: 'unit' | 'improvement'; index: number };
  civilDisorder: boolean;
  weLoveTheKingDay: boolean;
  /** Routes (up to three): partner city id and commodity (−1 food). */
  routes?: { partner: number; commodity: number }[];
  /** Three signed commodity bytes each (+59, +62). */
  supplied?: number[];
  demanded?: number[];
  /** Display figures the original keeps in the record; optional. */
  totals?: {
    science: number;
    tax: number;
    trade: number;
    foodProduction: number;
    shieldProduction: number;
    happy: number;
    unhappy: number;
  };
}

export interface CivWrite {
  slot: number;
  treasury: number;
  researchProgress: number;
  researching: number | null;
  advancesCount: number;
  futureTechs: number;
  scienceRate: number;
  taxRate: number;
  government: number;
  knownAdvances: boolean[];
  cities?: number;
  sumCitySizes?: number;
  /** Treaty words toward each slot (8 × u32 at +32). */
  treaties?: number[];
  /** Attitudes (8 bytes at +64). */
  attitudes?: number[];
  reputation?: number;
  patience?: number;
  /** Turn each slot last attacked us (8 × i16 at +994). */
  lastContact?: number[];
  /** Government scores (7 × i16 at +980). */
  governmentScores?: number[];
  /** Spaceship: flags byte, arrival year, launch year, population, six part counts. */
  spaceship?: {
    flags: number;
    arrival: number;
    launchYear: number;
    population: number;
    parts: number[];
  };
}

export interface SavePatch {
  turn?: number;
  year?: number;
  pollutionSquares?: number;
  /** Per advance: first discoverer slot. */
  firstDiscoveredBy?: number[];
  /** Per advance: bit n = slot n knows it. Omit to keep the file's table. */
  knownByMask?: number[];
  /** Per wonder (28): city record index, null = never built, 'destroyed' = −2. */
  wonders?: (number | null | 'destroyed')[];
  civs: CivWrite[];
  /** Full 6 × area square block; omit to keep the original squares. */
  squares?: Uint8Array;
  units: UnitWrite[];
  cities: CityWrite[];
}

const UNIT_TYPES = 62;

class Writer {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8(o: number, v: number): void {
    this.view.setUint8(o, v & 0xff);
  }
  u16(o: number, v: number): void {
    this.view.setUint16(o, v & 0xffff, true);
  }
  i16(o: number, v: number): void {
    this.view.setInt16(o, v, true);
  }
  i32(o: number, v: number): void {
    this.view.setInt32(o, v, true);
  }
  bit(o: number, n: number, on: boolean): void {
    const b = this.view.getUint8(o);
    this.view.setUint8(o, on ? b | (1 << n) : b & ~(1 << n));
  }
  str(o: number, len: number, s: string): void {
    const enc = encodeText(s);
    for (let i = 0; i < len; i++)
      this.view.setUint8(o + i, i < enc.length && i < len - 1 ? (enc[i] ?? 0) : 0);
  }
}

/** Build the identity patch from a parsed save (every modelled field, as parsed). */
export function patchFromSave(save: SaveFile): SavePatch {
  return {
    turn: save.parameters.turn,
    year: save.parameters.turnForGameYear,
    pollutionSquares: save.parameters.pollutionSquares,
    firstDiscoveredBy: save.techs.firstDiscoveredBy,
    knownByMask: save.techs.knownByMask,
    wonders: save.wonders.map((w) => (w.destroyed ? 'destroyed' : w.cityId)),
    civs: save.civs.map(civWrite),
    units: save.units.map(unitWrite),
    cities: save.cities.map(cityWrite),
  };
}

export function civWrite(c: CivRecord): CivWrite {
  return {
    slot: c.slot,
    treasury: c.treasury,
    researchProgress: c.researchProgress,
    researching: c.researching,
    advancesCount: c.advancesCount,
    futureTechs: c.futureTechs,
    scienceRate: c.scienceRate,
    taxRate: c.taxRate,
    government: c.government,
    knownAdvances: c.knownAdvances,
    cities: c.cities,
    sumCitySizes: c.sumCitySizes,
  };
}

export function unitWrite(u: UnitRecord): UnitWrite {
  return {
    source: u.id,
    x: u.position?.x ?? 0xffff,
    y: u.position?.y ?? 0xffff,
    owner: u.owner,
    type: u.type,
    veteran: u.veteran,
    hasMoved: u.hasMoved,
    waiting: u.waiting,
    movesSpent: u.movesSpent,
    hitPointsLost: u.hitPointsLost,
    lastMoveDirection: u.lastMoveDirection,
    counter: u.counterOrCommodity,
    order: u.order,
    homeCity: u.homeCity,
    goTo: u.goTo.x === 0xffff ? null : u.goTo,
    visibleToMask: u.visibleToMask,
    linkAbove: u.linkAbove,
    linkBelow: u.linkBelow,
  };
}

export function cityWrite(c: CityRecord): CityWrite {
  return {
    source: c.id,
    x: c.position.x,
    y: c.position.y,
    owner: c.owner,
    size: c.size,
    founder: c.founder,
    capturedTurn: c.turnsSinceCapture,
    name: c.name,
    foodStored: c.foodStored,
    shieldsStored: c.shieldsStored,
    workedMask: c.workedSquaresMask,
    specialists: c.specialists,
    improvements: c.improvements,
    production: c.production,
    civilDisorder: c.civilDisorder,
    weLoveTheKingDay: c.weLoveTheKingDay,
    totals: {
      science: c.science,
      tax: c.tax,
      trade: c.tradeIcons,
      foodProduction: c.foodProduction,
      shieldProduction: c.shieldProduction,
      happy: c.happy,
      unhappy: c.unhappy,
    },
  };
}

/** Produce a complete save file from the original bytes and the patch. */
export function writeSave(original: Uint8Array, save: SaveFile, patch: SavePatch): Uint8Array {
  const o = save.offsets;
  const usz = o.unitRecordSize;
  const csz = o.cityRecordSize;
  const T = save.version <= 39 ? 93 : 100;
  const unitsLen = patch.units.length * usz;
  const citiesLen = patch.cities.length * csz;
  const tailStart = o.citiesFounded;
  const out = new Uint8Array(o.units + unitsLen + citiesLen + (original.length - tailStart));
  out.set(original.subarray(0, o.units), 0);
  const citiesOff = o.units + unitsLen;
  const newTail = citiesOff + citiesLen;
  out.set(original.subarray(tailStart), newTail);
  const w = new Writer(out);

  // Header.
  const P = 24;
  w.u16(P + 34, patch.units.length);
  w.u16(P + 36, patch.cities.length);
  if (patch.turn !== undefined) w.u16(P + 4, patch.turn);
  if (patch.year !== undefined) w.i16(P + 6, patch.year);
  if (patch.pollutionSquares !== undefined) w.u16(P + 30, patch.pollutionSquares);

  // Techs.
  if (patch.firstDiscoveredBy) {
    for (let i = 0; i < T; i++) w.u8(o.techs + i, patch.firstDiscoveredBy[i] ?? 0);
  }
  if (patch.knownByMask) {
    for (let i = 0; i < T; i++) w.u8(o.techs + T + i, patch.knownByMask[i] ?? 0);
  }
  // Wonders.
  if (patch.wonders) {
    patch.wonders.forEach((v, i) => {
      w.i16(o.wonders + 2 * i, v === 'destroyed' ? -2 : v === null ? -1 : v);
    });
  }
  // Civilizations.
  for (const c of patch.civs) {
    const b = o.civs + o.civRecordSize * c.slot;
    w.i32(b + 2, c.treasury);
    if (c.treaties) for (let n = 0; n < 8; n++) w.i32(b + 32 + 4 * n, (c.treaties[n] ?? 0) | 0);
    if (c.attitudes) for (let n = 0; n < 8; n++) w.u8(b + 64 + n, c.attitudes[n] ?? 0);
    if (c.reputation !== undefined) w.u8(b + 30, c.reputation);
    if (c.patience !== undefined) w.u8(b + 31, c.patience);
    if (c.governmentScores)
      for (let n = 0; n < 7; n++) w.i16(b + 980 + 2 * n, c.governmentScores[n] ?? 0);
    if (c.lastContact) for (let n = 0; n < 8; n++) w.i16(b + 994 + 2 * n, c.lastContact[n] ?? -1);
    if (c.spaceship) {
      const X = b + 994;
      w.u8(X + 30, c.spaceship.flags);
      w.u16(X + 32, c.spaceship.arrival);
      w.u16(X + 34, c.spaceship.launchYear);
      w.u16(X + 36, c.spaceship.population);
      for (let n = 0; n < 6; n++) w.u16(X + 38 + 2 * n, c.spaceship.parts[n] ?? 0);
    }
    w.i16(b + 8, c.researchProgress);
    w.i16(b + 10, c.researching ?? -1);
    w.u8(b + 16, c.advancesCount);
    w.u8(b + 17, c.futureTechs);
    w.u8(b + 19, c.scienceRate);
    w.u8(b + 20, c.taxRate);
    w.u8(b + 21, c.government);
    for (let i = 0; i < T; i++) w.bit(b + 88 + (i >> 3), i & 7, c.knownAdvances[i] === true);
    if (c.cities !== undefined) w.u16(b + 104, c.cities);
    if (c.sumCitySizes !== undefined) w.u16(b + 108, c.sumCitySizes);
  }
  // Squares.
  if (patch.squares)
    out.set(
      patch.squares.subarray(0, o.units - o.squares - (o.units - o.squares - patch.squares.length)),
      o.squares,
    );

  // Units.
  const bySquare = new Map<string, number[]>();
  patch.units.forEach((u, i) => {
    const b = o.units + usz * i;
    if (u.source !== undefined && u.source < save.units.length) {
      out.set(original.subarray(o.units + usz * u.source, o.units + usz * (u.source + 1)), b);
    } else {
      out.fill(0, b, b + usz);
      w.u8(b + 12, 0x39); // the AI counter's initial value seen in fresh records
      w.u16(b + 18, 0xffff);
      w.u16(b + 20, 0xffff);
      if (usz > 26) w.u8(b + 26, 1); // INFERRED: the in-use flag the executable keeps at +0x1a
    }
    w.u16(b, u.x);
    w.u16(b + 2, u.y);
    w.bit(b + 4, 6, u.hasMoved);
    w.bit(b + 5, 5, u.veteran);
    if (u.waiting !== undefined) w.bit(b + 5, 6, u.waiting);
    w.u8(b + 6, u.type);
    w.u8(b + 7, u.owner);
    w.u8(b + 8, u.movesSpent);
    if (u.visibleToMask !== undefined) w.u8(b + 9, u.visibleToMask);
    else if (u.source === undefined) w.u8(b + 9, 1 << u.owner);
    w.u8(b + 10, u.hitPointsLost);
    w.u8(b + 11, u.lastMoveDirection ?? 0xff);
    w.u8(b + 13, u.counter);
    w.u8(b + 15, u.order);
    w.u8(b + 16, u.homeCity);
    w.u16(b + 18, u.goTo ? u.goTo.x : 0xffff);
    w.u16(b + 20, u.goTo ? u.goTo.y : 0xffff);
    if (u.x !== 0xffff) {
      const k = `${u.x},${u.y}`;
      bySquare.set(k, [...(bySquare.get(k) ?? []), i]);
    } else {
      w.u16(b + 22, 0xffff);
      w.u16(b + 24, 0xffff);
    }
  });
  for (const ids of bySquare.values()) {
    // Keep the given links when every unit on the square has them and they stay on the square
    // (the original's lists are in arrival order); otherwise link in record order.
    const set = new Set(ids);
    const keep = ids.every((id) => {
      const u = patch.units[id];
      if (!u || u.linkAbove === undefined || u.linkBelow === undefined) return false;
      return (
        (u.linkAbove === 0xffff || set.has(u.linkAbove)) &&
        (u.linkBelow === 0xffff || set.has(u.linkBelow))
      );
    });
    ids.forEach((id, n) => {
      const b = o.units + usz * id;
      const u = patch.units[id];
      if (keep && u) {
        w.u16(b + 22, u.linkAbove ?? 0xffff);
        w.u16(b + 24, u.linkBelow ?? 0xffff);
      } else {
        w.u16(b + 22, n + 1 < ids.length ? (ids[n + 1] ?? 0xffff) : 0xffff);
        w.u16(b + 24, n > 0 ? (ids[n - 1] ?? 0xffff) : 0xffff);
      }
    });
  }

  // Cities.
  patch.cities.forEach((c, i) => {
    const b = citiesOff + csz * i;
    if (c.source !== undefined && c.source < save.cities.length) {
      out.set(original.subarray(o.cities + csz * c.source, o.cities + csz * (c.source + 1)), b);
    } else {
      out.fill(0, b, b + csz);
      w.u8(b + 5, 0x02); // flag word 0x20000 the original sets on founding
    }
    w.u16(b, c.x);
    w.u16(b + 2, c.y);
    w.bit(b + 4, 0, c.civilDisorder);
    w.bit(b + 4, 1, c.weLoveTheKingDay);
    if (c.routes) {
      w.u8(b + 58, Math.min(3, c.routes.length));
      for (let i = 0; i < 3; i++) {
        const r = c.routes[i];
        w.u8(b + 65 + i, r ? (r.commodity < 0 ? 0xff : r.commodity & 0xff) : 0);
        w.u16(b + 68 + 2 * i, r ? r.partner : 0);
      }
    }
    if (c.supplied) for (let i = 0; i < 3; i++) w.u8(b + 59 + i, (c.supplied[i] ?? -1) & 0xff);
    if (c.demanded) for (let i = 0; i < 3; i++) w.u8(b + 62 + i, (c.demanded[i] ?? -1) & 0xff);
    w.u8(b + 8, c.owner);
    w.u8(b + 9, c.size);
    w.u8(b + 10, c.founder);
    w.u8(b + 11, c.capturedTurn);
    for (let j = 0; j < 4; j++) {
      let byte = 0;
      for (let k = 0; k < 4; k++) byte |= ((c.specialists[j * 4 + k] ?? 0) & 3) << (2 * k);
      w.u8(b + 22 + j, byte);
    }
    w.u16(b + 26, c.foodStored);
    w.u16(b + 28, c.shieldsStored);
    w.str(b + 32, 16, c.name);
    const m = c.workedMask & 0x1fffff;
    w.u8(b + 48, (m >> 13) & 0xff);
    w.u8(b + 49, (m >> 5) & 0xff);
    w.u8(b + 50, (m & 0x1f) << 3);
    const specialistCount = c.specialists.filter((s) => s !== 0).length;
    w.u8(b + 51, (specialistCount & 0x3f) << 2);
    for (let idx = 1; idx <= 38; idx++)
      w.bit(b + 52 + (idx >> 3), idx & 7, c.improvements[idx] === true);
    w.u8(b + 57, c.production.kind === 'unit' ? c.production.index : -c.production.index & 0xff);
    if (c.totals) {
      w.u16(b + 74, c.totals.science);
      w.u16(b + 76, c.totals.tax);
      w.u16(b + 78, c.totals.trade);
      w.u8(b + 80, c.totals.foodProduction);
      w.u8(b + 81, c.totals.shieldProduction);
      w.u8(b + 82, c.totals.happy);
      w.u8(b + 83, c.totals.unhappy);
    }
  });
  return out;
}

export const UNIT_TYPE_COUNT = UNIT_TYPES;
