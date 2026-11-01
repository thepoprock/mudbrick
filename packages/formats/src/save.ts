/**
 * Parser for the original save and scenario files (`.SAV`, `.SCN`, `.HOT`, `.NET`).
 *
 * Specification: docs/formats/save-format.md. Versions 39, 40 and 44 share one layout with a
 * few version-dependent sizes; Test of Time files (version > 44) are rejected.
 *
 * The structure (block sizes and positions) is verified against all 42 shipped files. Many field
 * meanings are still INFERRED; the spec says which, and the `offsets` returned here let anyone
 * open a hex editor at the right place to check one.
 */
import { decodeText } from './text.js';
import { SQUARE_BYTES, type MapFile, type Point } from './map.js';

/** Which civilization slot (0 = barbarians, 1–7 = players) a value refers to. */
export type Slot = number;

export interface GameOptions {
  simplifiedCombat: boolean;
  bloodlust: boolean;
  dontRestartIfEliminated: boolean;
  flatEarth: boolean;
  music: boolean;
  soundEffects: boolean;
  grid: boolean;
  enterClosesCityScreen: boolean;
  moveUnitsWithoutMouse: boolean;
  tutorialHelp: boolean;
  instantAdvice: boolean;
  fastPieceSlide: boolean;
  noPauseAfterEnemyMoves: boolean;
  showEnemyMoves: boolean;
  autosaveEachTurn: boolean;
  alwaysWaitAtEndOfTurn: boolean;
  cheatMenu: boolean;
  wonderMovies: boolean;
  throneRoom: boolean;
  diplomacyScreenGraphics: boolean;
  encyclopediaOnNewAdvance: boolean;
  highCouncil: boolean;
  animatedHeralds: boolean;
  cheatPenaltyDisabled: boolean;
  scoringComplete: boolean;
  isScenarioFile: boolean;
  scenarioFlagToggled: boolean;
  /** The twelve raw option bytes, for the bits not named above. */
  raw: Uint8Array;
}

export interface GameParameters {
  turn: number;
  turnForGameYear: number;
  /** Index into `units`, or null when 0xFFFF. */
  selectedUnit: number | null;
  humanSlot: Slot;
  mapShownForSlot: Slot;
  /** RULES.TXT @LEADERS index of the human player's civilization. */
  playerTribe: number;
  mapRevealed: boolean;
  difficulty: number;
  barbarianActivity: number;
  slotsInPlay: boolean[];
  humanSlots: boolean[];
  globalWarmingCount: number;
  pollutionSquares: number;
  /** File offset 8 (i16): from this turn on the calendar advances one year per turn; −1 none (VERIFIED 0x0046520c). */
  calendarLockTurn: number;
  /** File offset 32 (i16): turns of peace, ×3 (at most 100) in the score after turn 200 (VERIFIED 0x0047c9e0). */
  turnsOfPeace: number;
  unitCount: number;
  cityCount: number;
  firstAirUnitBuilt: boolean;
  firstNavalUnitBuilt: boolean;
  firstCaravanBuilt: boolean;
  republicOrDemocracyAdopted: boolean;
}

export interface TechState {
  /** Per advance: slot that discovered it first (raw byte). */
  firstDiscoveredBy: number[];
  /** Per advance: bit n set = slot n knows it. */
  knownByMask: number[];
}

export interface WonderState {
  /** RULES.TXT @IMPROVE index (39 … 66). */
  improvementIndex: number;
  /** City id that holds it, or null if never built. */
  cityId: number | null;
  destroyed: boolean;
}

export interface CivNames {
  slot: Slot;
  cityStyle: number;
  leader: string;
  plural: string;
  adjective: string;
  /** Ruler title under each of the 7 governments; empty = use RULES.TXT. */
  titles: string[];
}

export interface Treaty {
  /** The whole 32-bit word (bits documented in docs/formats/save-format.md). */
  raw: number;
  contact: boolean;
  ceaseFire: boolean;
  peace: boolean;
  alliance: boolean;
  vendetta: boolean;
  embassy: boolean;
  war: boolean;
}

export interface Spaceship {
  /** Bits: 1 started, 2 launched, 4 arrived, 8 Fusion Power known, 16 won (VERIFIED). */
  flags: number;
  launched: boolean;
  estimatedArrival: number;
  launchYear: number;
  /** Habitation modules at launch × 10,000 people. */
  population: number;
  structural: number;
  propulsion: number;
  fuel: number;
  habitation: number;
  lifeSupport: number;
  solar: number;
}

export interface CivRecord {
  slot: Slot;
  gender: number;
  treasury: number;
  tribeId: number;
  researchProgress: number;
  /** Advance index being researched, or null when −1. */
  researching: number | null;
  advancesCount: number;
  futureTechs: number;
  /** Tenths: 5 = 50 %. */
  scienceRate: number;
  taxRate: number;
  government: number;
  reputation: number;
  patience: number;
  treaties: Treaty[];
  attitudes: number[];
  /** 7 × i16 at +980: the AI's government preference scores (VERIFIED, 0x0051278c). */
  governmentScores: number[];
  /** Indexed by advance index. */
  knownAdvances: boolean[];
  militaryUnits: number;
  cities: number;
  sumCitySizes: number;
  unitsActive: number[];
  unitsLost: number[];
  unitsInProduction: number[];
  lastContact: number[];
  throneRoom: number[];
  spaceship: Spaceship;
}

export interface UnitRecord {
  id: number;
  /** Game coordinates; null when the slot is unused (0xFFFF). */
  position: Point | null;
  hasMoved: boolean;
  veteran: boolean;
  waiting: boolean;
  type: number;
  owner: Slot;
  movesSpent: number;
  visibleToMask: number;
  hitPointsLost: number;
  /** 0–7 clockwise from up-right, or null. */
  lastMoveDirection: number | null;
  counterOrCommodity: number;
  order: number;
  homeCity: number;
  goTo: Point;
  linkAbove: number;
  linkBelow: number;
}

export type Production = { kind: 'unit'; index: number } | { kind: 'improvement'; index: number };

export interface CityRecord {
  id: number;
  position: Point;
  civilDisorder: boolean;
  /** Byte 5 bit 0: the city has completed a wonder (set at completion, 0x004b7e74). */
  wonderCity: boolean;
  weLoveTheKingDay: boolean;
  improvementSoldThisTurn: boolean;
  stolenTech: boolean;
  canBuildCoastal: boolean;
  canBuildHydro: boolean;
  canBuildShips: boolean;
  autoBuildMilitary: boolean;
  autoBuildDomestic: boolean;
  objectiveX1: boolean;
  objectiveX3: boolean;
  owner: Slot;
  size: number;
  founder: Slot;
  turnsSinceCapture: number;
  knownToMask: number;
  lastSizeShown: number[];
  /** 16 entries: 0 none, 1 entertainer, 2 tax collector, 3 scientist. */
  specialists: number[];
  foodStored: number;
  shieldsStored: number;
  netTrade: number;
  name: string;
  /** 21 bits, one per square of the city radius (mapping to positions is still INFERRED). */
  workedSquaresMask: number;
  specialistCount: number;
  /** Indexed by RULES.TXT @IMPROVE index; entries 1–34 are meaningful. */
  improvements: boolean[];
  production: Production;
  activeTradeRoutes: number;
  commoditiesSupplied: number[];
  commoditiesDemanded: number[];
  routeCommodities: number[];
  routePartners: number[];
  science: number;
  tax: number;
  tradeIcons: number;
  foodProduction: number;
  shieldProduction: number;
  happy: number;
  unhappy: number;
}

export interface ScenarioParameters {
  totalWar: boolean;
  objectiveVictory: boolean;
  countWondersAsObjectives: boolean;
  forbidGovernmentSwitching: boolean;
  forbidTechFromConquests: boolean;
  eliminatePollution: boolean;
  specialRulesOverride: boolean;
  specialWwiiAi: boolean;
  name: string;
  techParadigm: number;
  yearsPerTurn: number;
  startingYear: number;
  maxTurns: number;
  protagonist: Slot;
  objectivesDecisiveVictory: number;
  objectivesMarginalVictory: number;
  objectivesMarginalDefeat: number;
  objectivesDecisiveDefeat: number;
}

/**
 * One record of an `EVNT` block (VERIFIED 0x00457ffe writer / 0x004594a6 reader): the 111 ints
 * of the parsed event as the game holds them in memory, followed in the file by a NUL-terminated
 * string for every non-zero name-pointer field. The layout of the ints is in
 * docs/formats/events-format.md; `eventsFromRecords` turns records into events.
 */
export interface SaveEventRecord {
  ints: number[];
  /** Strings by the index of the pointer field they belong to. */
  strings: Record<number, string>;
}
export const EVENT_RECORD_INTS = 111;
export const EVENT_RECORD_BYTES = 0x1bc;
/** The name-pointer fields outside the TEXT lines, in the order their strings are written. */
export const EVENT_STRING_SLOTS_BEFORE_TEXT = [2, 4, 5, 8];
export const EVENT_STRING_SLOTS_AFTER_TEXT = [34, 36, 49, 51, 53, 55, 79, 80, 82, 93, 97];

/** The pointer fields whose strings follow a record, in file order (TEXT lines stop at the first zero). */
export function eventStringOrder(ints: number[]): number[] {
  const out: number[] = [];
  for (const k of EVENT_STRING_SLOTS_BEFORE_TEXT) if ((ints[k] ?? 0) !== 0) out.push(k);
  for (let k = 14; k < 34 && (ints[k] ?? 0) !== 0; k++) out.push(k);
  for (const k of EVENT_STRING_SLOTS_AFTER_TEXT) if ((ints[k] ?? 0) !== 0) out.push(k);
  return out;
}

/**
 * Where a civilization record's fields sit in the file. VERIFIED from the loader 0x004574a0: a
 * version-40 record is the executable's 0x594-byte memory record as is; a version-39 record
 * (1396 bytes) is read in pieces — 88 bytes, 12 bytes of known advances (93 advances), 14 bytes
 * from memory +102, 93 per-advance bytes from +116, three 54-entry unit-type arrays from +216,
 * +278 and +340, one byte skipped, then 1026 bytes from +402 to the end — so everything from
 * the strategy arrays on sits 32 bytes earlier than in memory.
 */
export interface CivLayout {
  unitTypes: number;
  unitsActive: number;
  unitsLost: number;
  unitsInProduction: number;
  militaryUnits: number;
  cities: number;
  sumCitySizes: number;
  /** Offset of the memory record's +402 (the strategy arrays) in the file record. */
  tail: number;
}
export function civLayout(version: number): CivLayout {
  if (version <= 39) {
    return {
      unitTypes: 54,
      unitsActive: 207,
      unitsLost: 261,
      unitsInProduction: 315,
      militaryUnits: 100,
      cities: 102,
      sumCitySizes: 106,
      tail: 370,
    };
  }
  return {
    unitTypes: 62,
    unitsActive: 216,
    unitsLost: 278,
    unitsInProduction: 340,
    militaryUnits: 102,
    cities: 104,
    sumCitySizes: 108,
    tail: 402,
  };
}

/** Read an `EVNT` block at `off` (the tag): count, records, then each record's strings. */
export function readEventBlock(
  bytes: Uint8Array,
  off: number,
  warnings: string[],
): SaveEventRecord[] | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = off + 4;
  if (p + 4 > bytes.length) {
    warnings.push('EVNT block: no record count');
    return null;
  }
  const count = dv.getInt32(p, true);
  p += 4;
  if (count < 0 || p + count * EVENT_RECORD_BYTES > bytes.length) {
    warnings.push(`EVNT block: ${count} records do not fit`);
    return null;
  }
  const records: SaveEventRecord[] = [];
  for (let i = 0; i < count; i++) {
    const ints = Array.from({ length: EVENT_RECORD_INTS }, (_, k) => dv.getInt32(p + 4 * k, true));
    p += EVENT_RECORD_BYTES;
    records.push({ ints, strings: {} });
  }
  for (const rec of records) {
    for (const k of eventStringOrder(rec.ints)) {
      let end = p;
      while (end < bytes.length && bytes[end] !== 0) end++;
      if (end >= bytes.length) {
        warnings.push('EVNT block: strings truncated');
        return records;
      }
      rec.strings[k] = decodeText(bytes.subarray(p, end));
      p = end + 1;
    }
  }
  return records;
}

export interface DestroyedCiv {
  turn: number;
  destroyedBy: Slot;
  slot: Slot;
  name: string;
}

/** Absolute byte offsets of every block, for hex-editor work and tests. */
export interface SaveOffsets {
  techs: number;
  wonders: number;
  civNames: number;
  civs: number;
  civRecordSize: number;
  map: number;
  knowledge: number;
  squares: number;
  units: number;
  unitRecordSize: number;
  cities: number;
  cityRecordSize: number;
  citiesFounded: number;
  other: number;
  clicked: number;
  scenario: number | null;
  destroyed: number;
  events: number | null;
  end: number;
}

export interface SaveFile {
  version: number;
  options: GameOptions;
  parameters: GameParameters;
  techs: TechState;
  wonders: WonderState[];
  /** Slots 1–7 (index 0 of this array is slot 1). */
  civNames: CivNames[];
  /** Slots 0–7. */
  civs: CivRecord[];
  /** Same shape as a parsed `.MP` file, so map tools work on saves unchanged. */
  map: MapFile;
  /** 7 × area bytes: what each player slot 1–7 has seen on each square. */
  knowledge: Uint8Array;
  units: UnitRecord[];
  cities: CityRecord[];
  /** Cities founded so far per RULES.TXT tribe (21 entries). */
  citiesFounded: number[];
  cursor: Point;
  clicked: Point;
  zoom: number;
  scenario: ScenarioParameters | null;
  destroyed: DestroyedCiv[];
  hasEvents: boolean;
  /** The `EVNT` block's records (a save made inside a scenario), else null. */
  events: SaveEventRecord[] | null;
  offsets: SaveOffsets;
  warnings: string[];
}

export const SAVE_MAGIC = 'CIVILIZE';
const UNIT_TYPES = 62;
const WONDERS = 28;
const DESTROYED_BLOCK = 338;
const SCENARIO_BLOCK = 100;

class Reader {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8(o: number): number {
    return this.view.getUint8(o);
  }
  u16(o: number): number {
    return this.view.getUint16(o, true);
  }
  i32(o: number): number {
    return this.view.getInt32(o, true);
  }
  i16(o: number): number {
    return this.view.getInt16(o, true);
  }
  i8(o: number): number {
    return this.view.getInt8(o);
  }
  bit(o: number, n: number): boolean {
    return ((this.u8(o) >> n) & 1) === 1;
  }
  bits8(o: number): boolean[] {
    return Array.from({ length: 8 }, (_, n) => this.bit(o, n));
  }
  str(o: number, len: number): string {
    const slice = this.bytes.subarray(o, o + len);
    const nul = slice.indexOf(0);
    return decodeText(nul < 0 ? slice : slice.subarray(0, nul));
  }
  point(o: number): Point {
    return { x: this.u16(o), y: this.u16(o + 2) };
  }
  need(end: number, what: string): void {
    if (end > this.bytes.byteLength) {
      throw new Error(
        `save file truncated: ${what} needs ${end} bytes, file has ${this.bytes.byteLength}`,
      );
    }
  }
}

function findAscii(bytes: Uint8Array, needle: string, from: number): number | null {
  const n = Array.from(needle, (c) => c.charCodeAt(0));
  outer: for (let i = from; i + n.length <= bytes.length; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer;
    return i;
  }
  return null;
}

export function parseSave(bytes: Uint8Array): SaveFile {
  const r = new Reader(bytes);
  const warnings: string[] = [];
  r.need(66, 'header');
  if (r.str(0, 8) !== SAVE_MAGIC) throw new Error('not a save file: missing CIVILIZE magic');
  const version = r.u8(10);
  if (version > 44) throw new Error(`save version ${version} (Test of Time) is not supported yet`);
  if (version < 39) throw new Error(`save version ${version} is older than any documented layout`);

  // ---- version-dependent sizes (spec: "Fixed part")
  const T = version <= 39 ? 93 : 100;
  const civRecordSize = version <= 39 ? 1396 : 1428;
  const unitRecordSize = version <= 40 ? 26 : 32;
  const cityRecordSize = version <= 40 ? 84 : 88;

  // ---- options (12) and parameters (24)
  const O = 12;
  const options: GameOptions = {
    simplifiedCombat: !r.bit(O, 4),
    bloodlust: r.bit(O, 7),
    dontRestartIfEliminated: r.bit(O + 1, 0),
    flatEarth: r.bit(O + 1, 7),
    music: r.bit(O + 2, 3),
    soundEffects: r.bit(O + 2, 4),
    grid: r.bit(O + 2, 5),
    enterClosesCityScreen: r.bit(O + 2, 6),
    moveUnitsWithoutMouse: r.bit(O + 2, 7),
    tutorialHelp: r.bit(O + 3, 0),
    instantAdvice: r.bit(O + 3, 1),
    fastPieceSlide: r.bit(O + 3, 2),
    noPauseAfterEnemyMoves: r.bit(O + 3, 3),
    showEnemyMoves: r.bit(O + 3, 4),
    autosaveEachTurn: r.bit(O + 3, 5),
    alwaysWaitAtEndOfTurn: r.bit(O + 3, 6),
    cheatMenu: r.bit(O + 3, 7),
    wonderMovies: r.bit(O + 4, 0),
    throneRoom: r.bit(O + 4, 1),
    diplomacyScreenGraphics: r.bit(O + 4, 2),
    encyclopediaOnNewAdvance: r.bit(O + 4, 3),
    highCouncil: r.bit(O + 4, 4),
    animatedHeralds: r.bit(O + 4, 5),
    cheatPenaltyDisabled: r.bit(O + 8, 4),
    scoringComplete: r.bit(O + 8, 5),
    isScenarioFile: r.bit(O + 8, 6),
    scenarioFlagToggled: r.bit(O + 8, 7),
    raw: bytes.slice(O, O + 12),
  };
  const P = 24;
  const selected = r.u16(P + 10);
  const parameters: GameParameters = {
    turn: r.u16(P + 4),
    turnForGameYear: r.u16(P + 6),
    selectedUnit: selected === 0xffff ? null : selected,
    humanSlot: r.u8(P + 15),
    mapShownForSlot: r.u8(P + 16),
    playerTribe: r.u8(P + 17),
    mapRevealed: r.u8(P + 19) === 1,
    difficulty: r.u8(P + 20),
    barbarianActivity: r.u8(P + 21),
    slotsInPlay: r.bits8(P + 22),
    humanSlots: r.bits8(P + 23),
    globalWarmingCount: r.u8(P + 27),
    pollutionSquares: r.u16(P + 30),
    calendarLockTurn: r.i16(P + 8),
    turnsOfPeace: r.i16(P + 32),
    unitCount: r.u16(P + 34),
    cityCount: r.u16(P + 36),
    firstAirUnitBuilt: r.bit(P, 1),
    firstNavalUnitBuilt: r.bit(P, 2),
    firstCaravanBuilt: r.bit(P, 4),
    republicOrDemocracyAdopted: r.bit(P, 5),
  };
  const humans = parameters.humanSlots.filter(Boolean).length;

  // ---- techs, wonders, civilization names, civilization records
  const techsOff = 66;
  const wondersOff = techsOff + 2 * T;
  const civNamesOff = wondersOff + 318;
  const civsOff = civNamesOff + 7 * 242;
  const mapOff = civsOff + 8 * civRecordSize;
  r.need(mapOff + 14, 'fixed part');

  const techs: TechState = {
    firstDiscoveredBy: Array.from({ length: T }, (_, i) => r.u8(techsOff + i)),
    knownByMask: Array.from({ length: T }, (_, i) => r.u8(techsOff + T + i)),
  };
  const wonders: WonderState[] = Array.from({ length: WONDERS }, (_, i) => {
    const v = r.i16(wondersOff + 2 * i);
    return { improvementIndex: 39 + i, cityId: v >= 0 ? v : null, destroyed: v === -2 };
  });
  const civNames: CivNames[] = Array.from({ length: 7 }, (_, i) => {
    const o = civNamesOff + 242 * i;
    return {
      slot: i + 1,
      cityStyle: r.u8(o),
      leader: r.str(o + 2, 24),
      plural: r.str(o + 26, 24),
      adjective: r.str(o + 50, 24),
      titles: Array.from({ length: 7 }, (_, g) => r.str(o + 74 + 24 * g, 24)),
    };
  });
  const L = civLayout(version);
  const civs: CivRecord[] = Array.from({ length: 8 }, (_, slot) => {
    const o = civsOff + civRecordSize * slot;
    // Memory +994 (contact turns, throne room, spaceship) = tail + 592.
    const X = o + L.tail + 592;
    const researching = r.i16(o + 10);
    const knownAdvances: boolean[] = [];
    for (let i = 0; i < T; i++) knownAdvances.push(r.bit(o + 88 + (i >> 3), i & 7));
    return {
      slot,
      gender: r.u8(o + 1),
      treasury: r.i32(o + 2),
      tribeId: r.u16(o + 6),
      researchProgress: r.i16(o + 8),
      researching: researching < 0 ? null : researching,
      advancesCount: r.u8(o + 16),
      futureTechs: r.u8(o + 17),
      scienceRate: r.u8(o + 19),
      taxRate: r.u8(o + 20),
      government: r.u8(o + 21),
      reputation: r.u8(o + 30),
      patience: r.u8(o + 31),
      treaties: Array.from({ length: 8 }, (_, n) => {
        const t = o + 32 + 4 * n;
        return {
          raw: r.i32(t) >>> 0,
          contact: r.bit(t, 0),
          ceaseFire: r.bit(t, 1),
          peace: r.bit(t, 2),
          alliance: r.bit(t, 3),
          vendetta: r.bit(t, 4),
          embassy: r.bit(t, 7),
          war: r.bit(t + 1, 5),
        };
      }),
      attitudes: Array.from({ length: 8 }, (_, n) => r.u8(o + 64 + n)),
      knownAdvances,
      militaryUnits: r.u16(o + L.militaryUnits),
      cities: r.u16(o + L.cities),
      sumCitySizes: r.u16(o + L.sumCitySizes),
      unitsActive: Array.from({ length: UNIT_TYPES }, (_, t) =>
        t < L.unitTypes ? r.u8(o + L.unitsActive + t) : 0,
      ),
      unitsLost: Array.from({ length: UNIT_TYPES }, (_, t) =>
        t < L.unitTypes ? r.u8(o + L.unitsLost + t) : 0,
      ),
      unitsInProduction: Array.from({ length: UNIT_TYPES }, (_, t) =>
        t < L.unitTypes ? r.u8(o + L.unitsInProduction + t) : 0,
      ),
      // Memory +980 = tail + 578.
      governmentScores: Array.from({ length: 7 }, (_, n) => r.i16(o + L.tail + 578 + 2 * n)),
      lastContact: Array.from({ length: 8 }, (_, n) => r.i16(X + 2 * n)),
      throneRoom: Array.from({ length: 9 }, (_, n) => r.u8(X + 17 + n)),
      spaceship: {
        flags: r.u8(X + 30),
        launched: r.bit(X + 30, 1),
        estimatedArrival: r.u16(X + 32),
        launchYear: r.u16(X + 34),
        population: r.u16(X + 36),
        structural: r.u16(X + 38),
        propulsion: r.u16(X + 40),
        fuel: r.u16(X + 42),
        habitation: r.u16(X + 44),
        lifeSupport: r.u16(X + 46),
        solar: r.u16(X + 48),
      },
    };
  });

  // ---- map
  const header = {
    widthX2: r.u16(mapOff),
    height: r.u16(mapOff + 2),
    area: r.u16(mapOff + 4),
    flatEarth: r.u16(mapOff + 6) !== 0,
    resourceSeed: r.u16(mapOff + 8),
    locatorWidth: r.u16(mapOff + 10),
    locatorHeight: r.u16(mapOff + 12),
  };
  if (header.widthX2 % 2 !== 0 || (header.widthX2 / 2) * header.height !== header.area) {
    throw new Error(
      `save map header inconsistent: ${header.widthX2}×${header.height} vs area ${header.area}`,
    );
  }
  const knowledgeOff = mapOff + 14;
  const squaresOff = knowledgeOff + 7 * header.area;
  const unknown1Off = squaresOff + SQUARE_BYTES * header.area;
  const unitsOff = unknown1Off + 2 * header.locatorWidth * header.locatorHeight + 1024;
  const citiesOff = unitsOff + unitRecordSize * parameters.unitCount;
  const citiesFoundedOff = citiesOff + cityRecordSize * parameters.cityCount;
  const otherOff = citiesFoundedOff + 63;
  const clickedOff = otherOff + 48 * humans + 1314;
  const afterOtherOff = clickedOff + 76;
  r.need(afterOtherOff, 'variable part');

  const map: MapFile = {
    header,
    columns: header.widthX2 / 2,
    rows: header.height,
    startPositions: [],
    squares: bytes.subarray(squaresOff, unknown1Off),
  };
  const knowledge = bytes.subarray(knowledgeOff, squaresOff);

  // ---- units
  const units: UnitRecord[] = Array.from({ length: parameters.unitCount }, (_, id) => {
    const o = unitsOff + unitRecordSize * id;
    const x = r.u16(o);
    const dir = r.u8(o + 11);
    return {
      id,
      // VERIFIED: a removed unit is parked off the map at (owner × 4 + 4) × −25 on both axes
      // (0x005548ce, called when a unit is deleted), so any negative x is an empty slot.
      position: x >= 0x8000 ? null : { x, y: r.u16(o + 2) },
      hasMoved: r.bit(o + 4, 6),
      veteran: r.bit(o + 5, 5),
      waiting: r.bit(o + 5, 6),
      type: r.u8(o + 6),
      owner: r.u8(o + 7),
      movesSpent: r.u8(o + 8),
      visibleToMask: r.u8(o + 9),
      hitPointsLost: r.u8(o + 10),
      lastMoveDirection: dir === 0xff ? null : dir,
      counterOrCommodity: r.u8(o + 13),
      order: r.u8(o + 15),
      homeCity: r.u8(o + 16),
      goTo: r.point(o + 18),
      linkAbove: r.u16(o + 22),
      linkBelow: r.u16(o + 24),
    };
  });

  // ---- cities
  const cities: CityRecord[] = Array.from({ length: parameters.cityCount }, (_, id) => {
    const o = citiesOff + cityRecordSize * id;
    const specialists: number[] = [];
    for (let j = 0; j < 4; j++) {
      const b = r.u8(o + 22 + j);
      for (let k = 0; k < 4; k++) specialists.push((b >> (2 * k)) & 3);
    }
    const improvements: boolean[] = [false];
    for (let idx = 1; idx <= 34; idx++) improvements.push(r.bit(o + 52 + (idx >> 3), idx & 7));
    const prod = r.i8(o + 57);
    // VERIFIED: bytes 48–51 are the executable's little-endian dword at +0x30 — bits 0–19 the
    // radius squares in radius order, bit 20 the centre, bits 26–31 the specialist count. (The
    // original's City Status in the Civil War scenario matches this reading for all 24 cities.)
    const worked = (r.u8(o + 48) | (r.u8(o + 49) << 8) | (r.u8(o + 50) << 16)) & 0x1fffff;
    return {
      id,
      position: r.point(o),
      civilDisorder: r.bit(o + 4, 0),
      wonderCity: r.bit(o + 5, 0),
      weLoveTheKingDay: r.bit(o + 4, 1),
      improvementSoldThisTurn: r.bit(o + 4, 2),
      stolenTech: r.bit(o + 4, 3),
      autoBuildMilitary: r.bit(o + 7, 0),
      autoBuildDomestic: r.bit(o + 7, 1),
      objectiveX1: r.bit(o + 7, 2),
      objectiveX3: r.bit(o + 7, 4),
      canBuildCoastal: r.bit(o + 4, 7),
      canBuildHydro: r.bit(o + 5, 3),
      canBuildShips: r.bit(o + 6, 5),
      owner: r.u8(o + 8),
      size: r.u8(o + 9),
      founder: r.u8(o + 10),
      turnsSinceCapture: r.u8(o + 11),
      knownToMask: r.u8(o + 12),
      lastSizeShown: Array.from({ length: 8 }, (_, n) => r.u8(o + 13 + n)),
      specialists,
      foodStored: r.u16(o + 26),
      shieldsStored: r.u16(o + 28),
      netTrade: r.u16(o + 30),
      name: r.str(o + 32, 16),
      workedSquaresMask: worked,
      specialistCount: r.u8(o + 51) >> 2,
      improvements,
      production: prod >= 0 ? { kind: 'unit', index: prod } : { kind: 'improvement', index: -prod },
      activeTradeRoutes: r.u8(o + 58),
      commoditiesSupplied: [r.u8(o + 59), r.u8(o + 60), r.u8(o + 61)],
      commoditiesDemanded: [r.u8(o + 62), r.u8(o + 63), r.u8(o + 64)],
      routeCommodities: [r.u8(o + 65), r.u8(o + 66), r.u8(o + 67)],
      routePartners: [r.u16(o + 68), r.u16(o + 70), r.u16(o + 72)],
      science: r.u16(o + 74),
      tax: r.u16(o + 76),
      tradeIcons: r.u16(o + 78),
      foodProduction: r.u8(o + 80),
      shieldProduction: r.u8(o + 81),
      happy: r.u8(o + 82),
      unhappy: r.u8(o + 83),
    };
  });

  const citiesFounded = Array.from({ length: 21 }, (_, t) => r.u8(citiesFoundedOff + 3 * t + 1));
  const cursor = { x: r.i16(otherOff), y: r.i16(otherOff + 2) };
  const clicked = { x: r.i16(clickedOff), y: r.i16(clickedOff + 2) };
  const zoom = r.i16(clickedOff + 4);

  // ---- optional scenario parameters, destroyed civilizations, events
  const eventsOff = findAscii(bytes, 'EVNT', afterOtherOff);
  const tailEnd = eventsOff ?? bytes.byteLength;
  const tail = tailEnd - afterOtherOff;
  let scenario: ScenarioParameters | null = null;
  let scenarioOff: number | null = null;
  let destroyedOff = afterOtherOff;
  if (tail >= DESTROYED_BLOCK + SCENARIO_BLOCK) {
    scenarioOff = afterOtherOff;
    destroyedOff = afterOtherOff + SCENARIO_BLOCK;
    const s = scenarioOff;
    scenario = {
      totalWar: r.bit(s, 0),
      objectiveVictory: r.bit(s, 1),
      countWondersAsObjectives: r.bit(s, 2),
      forbidGovernmentSwitching: r.bit(s, 4),
      forbidTechFromConquests: r.bit(s, 5),
      eliminatePollution: r.bit(s, 6),
      specialRulesOverride: r.bit(s + 1, 1),
      specialWwiiAi: r.bit(s + 1, 7),
      name: r.str(s + 2, 80),
      techParadigm: r.u16(s + 82),
      yearsPerTurn: r.i16(s + 84),
      startingYear: r.i16(s + 86), // signed: the Rise of Rome starts at −277
      maxTurns: r.u16(s + 88),
      protagonist: r.u8(s + 90),
      objectivesDecisiveVictory: r.u16(s + 92),
      objectivesMarginalVictory: r.u16(s + 94),
      objectivesMarginalDefeat: r.u16(s + 96),
      objectivesDecisiveDefeat: r.u16(s + 98),
    };
  }
  if (tail !== DESTROYED_BLOCK && tail !== DESTROYED_BLOCK + SCENARIO_BLOCK) {
    warnings.push(
      `unexpected ${tail} bytes after the fixed blocks (expected ${DESTROYED_BLOCK} or ${DESTROYED_BLOCK + SCENARIO_BLOCK})`,
    );
  }
  r.need(destroyedOff + DESTROYED_BLOCK, 'destroyed civilizations');
  const destroyedCount = r.i16(destroyedOff);
  const destroyed: DestroyedCiv[] = Array.from(
    { length: Math.max(0, Math.min(12, destroyedCount)) },
    (_, i) => ({
      turn: r.i16(destroyedOff + 2 + 2 * i),
      destroyedBy: r.u8(destroyedOff + 26 + i),
      slot: r.u8(destroyedOff + 38 + i),
      name: r.str(destroyedOff + 50 + 24 * i, 24),
    }),
  );

  for (const u of units) {
    if (u.type >= UNIT_TYPES) warnings.push(`unit ${u.id}: type ${u.type} out of range`);
    if (u.owner > 7) warnings.push(`unit ${u.id}: owner ${u.owner} out of range`);
  }
  for (const c of cities) {
    if (c.owner > 7) warnings.push(`city ${c.id} "${c.name}": owner ${c.owner} out of range`);
  }

  return {
    version,
    options,
    parameters,
    techs,
    wonders,
    civNames,
    civs,
    map,
    knowledge,
    units,
    cities,
    citiesFounded,
    cursor,
    clicked,
    zoom,
    scenario,
    destroyed,
    hasEvents: eventsOff !== null,
    events: eventsOff === null ? null : readEventBlock(bytes, eventsOff, warnings),
    offsets: {
      techs: techsOff,
      wonders: wondersOff,
      civNames: civNamesOff,
      civs: civsOff,
      civRecordSize,
      map: mapOff,
      knowledge: knowledgeOff,
      squares: squaresOff,
      units: unitsOff,
      unitRecordSize,
      cities: citiesOff,
      cityRecordSize,
      citiesFounded: citiesFoundedOff,
      other: otherOff,
      clicked: clickedOff,
      scenario: scenarioOff,
      destroyed: destroyedOff,
      events: eventsOff,
      end: destroyedOff + DESTROYED_BLOCK,
    },
    warnings,
  };
}
