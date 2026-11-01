/**
 * Parser for RULES.TXT — the game's data tables (constants, advances, improvements, wonders,
 * units, terrain, governments, leaders, commodities, orders, difficulty levels, attitudes).
 *
 * Specification: docs/formats/rules-format.md. Everything here follows that document; when the
 * two disagree, fix both.
 *
 * Row ORDER is the identity of every table: the original executable addresses advances,
 * improvements, units and terrain by index. Parsers must never reorder rows.
 */
import { fields, num as numStrict, splitSections, stripComment, type Section } from './text.js';

/** Warnings of the parse under way (the lenient number reader appends to them). */
let currentWarnings: string[] = [];

/**
 * A number as the original reads it (0x0047c824 → an atoi): a field that does not start with
 * an integer reads as 0, with a warning.
 */
function num(field: string): number {
  try {
    return numStrict(field);
  } catch {
    currentWarnings.push(
      `number expected, got "${field.trim()}" (read as 0, as the original does)`,
    );
    return 0;
  }
}

/** The @COSMIC clamps of the original's reader (0x00410603), in file order. */
const COSMIC_RANGES: [number, number][] = [
  [1, 10],
  [1, 100],
  [0, 10],
  [4, 20],
  [4, 20],
  [0, 10],
  [0, 10],
  [4, 12],
  [10, 100],
  [4, 50],
  [4, 50],
  [3, 10],
  [5, 100],
  [0, 8],
  [0, 8],
  [0, 8],
  [1, 20],
  [0, 100],
  [0, 100],
  [4, 100],
  [25, 200],
  [0, 10],
];

/** The 22 "Cosmic Principles" engine constants, in file order. */
export interface CosmicConstants {
  roadMoveMultiplier: number;
  /** 1 in N chance a trireme is lost at sea (modified by Seafaring, Navigation). */
  triremeLossChance: number;
  foodPerCitizen: number;
  /** Rows in the food box; box = rows × (citySize + 1). */
  foodBoxRows: number;
  shieldBoxRows: number;
  /** Food eaten by Settlers when government ≤ Monarchy. */
  settlersFoodEarlyGovt: number;
  /** Food eaten by Settlers when government ≥ Communism. */
  settlersFoodLateGovt: number;
  /** City size at which the first unhappy citizen appears at Chieftain level. */
  unhappinessCitySizeChieftain: number;
  /** Riot factor based on number of cities (higher lessens the effect). */
  riotFactor: number;
  aqueductSize: number;
  sewerSize: number;
  /** Higher slows research. */
  techParadigm: number;
  /** Base time for engineers to transform terrain (×2). */
  transformBaseTurns: number;
  monarchyFreeUnits: number;
  communismFreeUnits: number;
  fundamentalismFreeUnits: number;
  communismPalaceDistance: number;
  fundamentalismSciencePenaltyPct: number;
  productionChangePenaltyPct: number;
  maxParadropRange: number;
  /** Increasing slows spaceship travel. */
  massThrustParadigm: number;
  /** ×10 → percent (5 = 50%). Added by patch 1.08. */
  fundamentalismMaxScienceRate: number;
}

const COSMIC_KEYS: (keyof CosmicConstants)[] = [
  'roadMoveMultiplier',
  'triremeLossChance',
  'foodPerCitizen',
  'foodBoxRows',
  'shieldBoxRows',
  'settlersFoodEarlyGovt',
  'settlersFoodLateGovt',
  'unhappinessCitySizeChieftain',
  'riotFactor',
  'aqueductSize',
  'sewerSize',
  'techParadigm',
  'transformBaseTurns',
  'monarchyFreeUnits',
  'communismFreeUnits',
  'fundamentalismFreeUnits',
  'communismPalaceDistance',
  'fundamentalismSciencePenaltyPct',
  'productionChangePenaltyPct',
  'maxParadropRange',
  'massThrustParadigm',
  'fundamentalismMaxScienceRate',
];

export enum Epoch {
  Ancient = 0,
  Renaissance = 1,
  Industrial = 2,
  Modern = 3,
}

export enum AdvanceCategory {
  Military = 0,
  Economic = 1,
  Social = 2,
  Academic = 3,
  Applied = 4,
}

/**
 * A prerequisite reference. `kind: 'none'` = `nil` (no prerequisite needed);
 * `kind: 'never'` = `no` (the item is disabled); otherwise the index into `advances`.
 */
export type AdvanceRef = { kind: 'none' } | { kind: 'never' } | { kind: 'advance'; index: number };

export interface Advance {
  index: number;
  name: string;
  /** Three-letter abbreviation used by every other table to refer to this advance. */
  abbrev: string;
  aiValue: number;
  civilizedModifier: number;
  preq1: AdvanceRef;
  preq2: AdvanceRef;
  epoch: Epoch;
  category: AdvanceCategory;
}

export interface Improvement {
  /** Index into @IMPROVE. 0 = "Nothing", 1 = Palace … 38 = Capitalization, 39–66 = wonders. */
  index: number;
  name: string;
  /** Cost in shield rows (×10 shields). */
  costRows: number;
  /** Gold per turn. */
  upkeep: number;
  preq: AdvanceRef;
  isWonder: boolean;
}

export interface WonderExpiry {
  /** Index into `improvements` (39–66). */
  improvementIndex: number;
  /** Advance whose discovery (by anyone) cancels the wonder; `none` = never expires. */
  expiresWith: AdvanceRef;
}

export enum UnitDomain {
  Ground = 0,
  Air = 1,
  Sea = 2,
}

export enum UnitRole {
  Attack = 0,
  Defend = 1,
  NavalSuperiority = 2,
  AirSuperiority = 3,
  SeaTransport = 4,
  Settle = 5,
  Diplomacy = 6,
  Trade = 7,
}

/** The 15 special-ability flags, bit 0 = rightmost character of the bitstring. */
export interface UnitFlags {
  raw: number;
  twoSquareVisibility: boolean;
  ignoreZonesOfControl: boolean;
  amphibiousAssault: boolean;
  submarine: boolean;
  canAttackAir: boolean;
  mustStayNearLand: boolean;
  negatesCityWalls: boolean;
  carriesAirUnits: boolean;
  canParadrop: boolean;
  alpine: boolean;
  doubleDefenceVsHorse: boolean;
  freeSupportUnderFundamentalism: boolean;
  destroyedAfterAttack: boolean;
  doubleDefenceVsAir: boolean;
  spotsSubmarines: boolean;
}

export interface UnitType {
  index: number;
  name: string;
  /** Advance that makes the unit obsolete; `none` = never. */
  obsoleteWith: AdvanceRef;
  domain: UnitDomain;
  /** Movement points per turn (whole squares; the road multiplier applies on top). */
  move: number;
  /** Turns of fuel for air units; 0 otherwise. */
  range: number;
  attack: number;
  defence: number;
  /** Hit points in tens (the file writes `2h` for 20 HP). */
  hitPointsTens: number;
  firepower: number;
  costRows: number;
  /** Transport capacity. */
  holds: number;
  role: UnitRole;
  preq: AdvanceRef;
  flags: UnitFlags;
}

/** `yes`, `no`, or the index of the terrain the square becomes. */
export type TerrainChange =
  { kind: 'yes' } | { kind: 'no' } | { kind: 'becomes'; terrainIndex: number };

export interface TerrainSpecial {
  name: string;
  moveCost: number;
  defenceHalves: number;
  food: number;
  shields: number;
  trade: number;
}

export interface Terrain {
  index: number;
  name: string;
  abbrev: string;
  moveCost: number;
  /** Defence multiplier in halves: 2 = ×1.0, 3 = ×1.5, 4 = ×2.0. */
  defenceHalves: number;
  food: number;
  shields: number;
  trade: number;
  irrigate: TerrainChange;
  irrigateBonus: number;
  irrigateTurns: number;
  /** Minimum government index before the AI bothers to irrigate (0 = never). */
  irrigateAiGovt: number;
  mine: TerrainChange;
  mineBonus: number;
  mineTurns: number;
  mineAiGovt: number;
  transformTo: TerrainChange;
  /** The two special-resource variants of this terrain. */
  specials: [TerrainSpecial, TerrainSpecial];
}

export interface Government {
  index: number;
  name: string;
  maleTitle: string;
  femaleTitle: string;
}

export interface LeaderTitle {
  governmentIndex: number;
  male: string;
  female: string;
}

export interface Leader {
  index: number;
  name: string;
  femaleName: string;
  female: boolean;
  /** Colour set 1–7; three civilizations share each colour and are mutually exclusive. */
  color: number;
  /** City graphics style 0–3: Bronze Age, Classical, Far East, Medieval. */
  cityStyle: number;
  plural: string;
  adjective: string;
  /** 1 aggressive, 0 neutral, −1 rational. */
  attack: number;
  /** 1 expansionist, −1 perfectionist. */
  expand: number;
  /** 1 civilized, −1 militaristic. */
  civilize: number;
  titles: LeaderTitle[];
}

export interface Order {
  name: string;
  key: string;
}

export interface Rules {
  cosmic: CosmicConstants;
  advances: Advance[];
  improvements: Improvement[];
  wonderExpiry: WonderExpiry[];
  units: UnitType[];
  terrain: Terrain[];
  governments: Government[];
  leaders: Leader[];
  caravanCommodities: string[];
  orders: Order[];
  difficulty: string[];
  attitudes: string[];
  /** Non-fatal oddities found while parsing (malformed rows that the game itself tolerates). */
  warnings: string[];
}

/** Index of the first wonder in @IMPROVE. The 39 entries before it are city improvements. */
export const FIRST_WONDER_INDEX = 39;

interface Row {
  body: string;
  comment: string;
  line: number;
}

function dataRows(section: Section): Row[] {
  return section.lines
    .map((l, i) => ({ ...stripComment(l), line: section.startLine + 1 + i }))
    .filter((r) => r.body.trim() !== '');
}

function need(sections: Map<string, Section>, name: string): Section {
  const s = sections.get(name);
  if (!s) throw new Error(`RULES.TXT: missing @${name} section`);
  return s;
}

function at(f: string[], i: number, where: string): string {
  const v = f[i];
  if (v === undefined) throw new Error(`${where}: missing field ${i + 1}`);
  return v;
}

function pick<T>(items: T[], i: number): T {
  const v = items[i];
  if (v === undefined) throw new Error(`internal: index ${i} out of ${items.length}`);
  return v;
}

export function parseRules(text: string): Rules {
  const warnings: string[] = [];
  currentWarnings = warnings;
  const sections = new Map(splitSections(text).map((s) => [s.name, s]));

  // @COSMIC — one integer per line, identified by position.
  // VERIFIED (0x00410603): the original reads exactly this many lines and clamps each; a short
  // list reads whatever follows (0 here), food box rows are made even.
  const cosmicRows = dataRows(need(sections, 'COSMIC'));
  if (cosmicRows.length !== COSMIC_KEYS.length) {
    warnings.push(
      `@COSMIC: expected ${COSMIC_KEYS.length} values, found ${cosmicRows.length}; missing ones read as 0 and are clamped, extra ones are ignored`,
    );
  }
  const cosmic = Object.fromEntries(
    COSMIC_KEYS.map((k, i) => {
      const row = cosmicRows[i];
      const [lo, hi] = COSMIC_RANGES[i] ?? [0, 1000];
      let v = Math.max(lo, Math.min(hi, row ? num(row.body) : 0));
      if (i === 3 && (v & 1) !== 0) v += 1;
      return [k, v];
    }),
  ) as unknown as CosmicConstants;

  // @CIVILIZE — build the abbreviation table first so prerequisites can be resolved.
  const advRows = dataRows(need(sections, 'CIVILIZE'));
  const abbrevIndex = new Map<string, number>();
  advRows.forEach((r, i) => {
    if (r.comment === '') {
      throw new Error(`@CIVILIZE line ${r.line}: missing abbreviation comment`);
    }
    abbrevIndex.set(r.comment, i);
  });
  const ref = (token: string, where: string): AdvanceRef => {
    const t = token.trim();
    if (t === 'nil') return { kind: 'none' };
    if (t === 'no') return { kind: 'never' };
    const index = abbrevIndex.get(t);
    if (index === undefined) {
      // VERIFIED (0x00487c00): an unknown code becomes −3 with a message; nothing can satisfy it.
      warnings.push(
        `${where}: unknown advance "${t}" (treated as a prerequisite nothing can meet)`,
      );
      return { kind: 'never' };
    }
    return { kind: 'advance', index };
  };
  const advances: Advance[] = advRows.map((r, index) => {
    const where = `@CIVILIZE line ${r.line}`;
    const f = fields(r.body);
    return {
      index,
      name: at(f, 0, where),
      abbrev: r.comment,
      aiValue: num(at(f, 1, where)),
      civilizedModifier: num(at(f, 2, where)),
      preq1: ref(at(f, 3, where), where),
      preq2: ref(at(f, 4, where), where),
      epoch: num(at(f, 5, where)) as Epoch,
      category: num(at(f, 6, where)) as AdvanceCategory,
    };
  });

  // @IMPROVE
  const improvements: Improvement[] = dataRows(need(sections, 'IMPROVE')).map((r, index) => {
    const where = `@IMPROVE line ${r.line}`;
    const f = fields(r.body);
    return {
      index,
      name: at(f, 0, where),
      costRows: num(at(f, 1, where)),
      upkeep: num(at(f, 2, where)),
      preq: ref(at(f, 3, where), where),
      isWonder: index >= FIRST_WONDER_INDEX,
    };
  });

  // @ENDWONDER — one row per wonder, in @IMPROVE order. The shipped file contains a stray
  // comment line whose `;` was typed as `:`; the game ignores it and so do we (with a warning).
  const wonderExpiry: WonderExpiry[] = [];
  for (const r of dataRows(need(sections, 'ENDWONDER'))) {
    if (r.body.trimStart().startsWith(':') || r.comment === '') {
      warnings.push(`@ENDWONDER line ${r.line}: ignored malformed row "${r.body.trim()}"`);
      continue;
    }
    const where = `@ENDWONDER line ${r.line}`;
    wonderExpiry.push({
      improvementIndex: FIRST_WONDER_INDEX + wonderExpiry.length,
      expiresWith: ref(at(fields(r.body), 0, where), where),
    });
  }

  // @UNITS
  const units: UnitType[] = [];
  for (const r of dataRows(need(sections, 'UNITS'))) {
    const where = `@UNITS line ${r.line}`;
    const f = fields(r.body);
    if (f.length < 14) {
      warnings.push(`${where}: ignored row with ${f.length} fields`);
      continue;
    }
    const bits = at(f, 13, where);
    const raw = Number.parseInt(bits, 2);
    if (Number.isNaN(raw) || bits.length !== 15) {
      throw new Error(`${where}: flags must be a 15-character bitstring`);
    }
    const bit = (n: number) => ((raw >> n) & 1) === 1;
    units.push({
      index: units.length,
      name: at(f, 0, where),
      obsoleteWith: ref(at(f, 1, where), where),
      domain: num(at(f, 2, where)) as UnitDomain,
      move: num(at(f, 3, where)),
      range: num(at(f, 4, where)),
      attack: num(at(f, 5, where)),
      defence: num(at(f, 6, where)),
      hitPointsTens: num(at(f, 7, where)),
      firepower: num(at(f, 8, where)),
      costRows: num(at(f, 9, where)),
      holds: num(at(f, 10, where)),
      role: num(at(f, 11, where)) as UnitRole,
      preq: ref(at(f, 12, where), where),
      flags: {
        raw,
        twoSquareVisibility: bit(0),
        ignoreZonesOfControl: bit(1),
        amphibiousAssault: bit(2),
        submarine: bit(3),
        canAttackAir: bit(4),
        mustStayNearLand: bit(5),
        negatesCityWalls: bit(6),
        carriesAirUnits: bit(7),
        canParadrop: bit(8),
        alpine: bit(9),
        doubleDefenceVsHorse: bit(10),
        freeSupportUnderFundamentalism: bit(11),
        destroyedAfterAttack: bit(12),
        doubleDefenceVsAir: bit(13),
        spotsSubmarines: bit(14),
      },
    });
  }

  // @TERRAIN — base rows (15+ fields) followed by two special-resource rows per base terrain.
  const terrainRows = dataRows(need(sections, 'TERRAIN'));
  const baseRows = terrainRows.filter((r) => fields(r.body).length >= 15);
  const specialRows = terrainRows.filter((r) => fields(r.body).length < 15);
  if (specialRows.length !== 2 * baseRows.length) {
    throw new Error(
      `@TERRAIN: ${baseRows.length} terrains need ${2 * baseRows.length} specials, found ${specialRows.length}`,
    );
  }
  const terrainAbbrev = new Map(baseRows.map((r, i) => [r.comment, i]));
  const change = (token: string, where: string): TerrainChange => {
    if (token === 'yes') return { kind: 'yes' };
    if (token === 'no') return { kind: 'no' };
    const terrainIndex = terrainAbbrev.get(token);
    if (terrainIndex === undefined) throw new Error(`${where}: unknown terrain "${token}"`);
    return { kind: 'becomes', terrainIndex };
  };
  const special = (r: Row): TerrainSpecial => {
    const where = `@TERRAIN line ${r.line}`;
    const f = fields(r.body);
    return {
      name: at(f, 0, where),
      moveCost: num(at(f, 1, where)),
      defenceHalves: num(at(f, 2, where)),
      food: num(at(f, 3, where)),
      shields: num(at(f, 4, where)),
      trade: num(at(f, 5, where)),
    };
  };
  const terrain: Terrain[] = baseRows.map((r, index) => {
    const where = `@TERRAIN line ${r.line}`;
    const f = fields(r.body);
    return {
      index,
      name: at(f, 0, where),
      abbrev: r.comment,
      moveCost: num(at(f, 1, where)),
      defenceHalves: num(at(f, 2, where)),
      food: num(at(f, 3, where)),
      shields: num(at(f, 4, where)),
      trade: num(at(f, 5, where)),
      irrigate: change(at(f, 6, where), where),
      irrigateBonus: num(at(f, 7, where)),
      irrigateTurns: num(at(f, 8, where)),
      irrigateAiGovt: num(at(f, 9, where)),
      mine: change(at(f, 10, where), where),
      mineBonus: num(at(f, 11, where)),
      mineTurns: num(at(f, 12, where)),
      mineAiGovt: num(at(f, 13, where)),
      transformTo: change(at(f, 14, where), where),
      // The file lists the FIRST special of every terrain, then the SECOND special of every
      // terrain (Oasis, Buffalo, … Fish, then Desert Oil, Wheat, … Whales) — not pairs.
      specials: [
        special(pick(specialRows, index)),
        special(pick(specialRows, baseRows.length + index)),
      ],
    };
  });

  const governments: Government[] = dataRows(need(sections, 'GOVERNMENTS')).map((r, index) => {
    const f = fields(r.body);
    return {
      index,
      name: at(f, 0, `@GOVERNMENTS line ${r.line}`),
      maleTitle: f[1] ?? '',
      femaleTitle: f[2] ?? '',
    };
  });

  // @LEADERS — the shipped file ends with two example rows ("Saladin", "Atawallpa") that are
  // missing a field; the game cannot read them as written, so they are skipped with a warning.
  const leaders: Leader[] = [];
  for (const r of dataRows(need(sections, 'LEADERS'))) {
    const where = `@LEADERS line ${r.line}`;
    const f = fields(r.body);
    if (f.length < 10 || f[1] === '...') {
      warnings.push(`${where}: ignored malformed row "${f[0] ?? ''}"`);
      continue;
    }
    const rest = f.slice(10).filter((x) => x !== '');
    const titles: LeaderTitle[] = [];
    for (let i = 0; i + 2 < rest.length; i += 3) {
      titles.push({
        governmentIndex: num(at(rest, i, where)),
        male: at(rest, i + 1, where),
        female: at(rest, i + 2, where),
      });
    }
    leaders.push({
      index: leaders.length,
      name: at(f, 0, where),
      femaleName: at(f, 1, where),
      female: num(at(f, 2, where)) === 1,
      color: num(at(f, 3, where)),
      cityStyle: num(at(f, 4, where)),
      plural: at(f, 5, where),
      adjective: at(f, 6, where),
      attack: num(at(f, 7, where)),
      expand: num(at(f, 8, where)),
      civilize: num(at(f, 9, where)),
      titles,
    });
  }

  const caravanCommodities = dataRows(need(sections, 'CARAVAN')).map((r) =>
    at(fields(r.body), 0, `@CARAVAN line ${r.line}`),
  );
  const orders: Order[] = dataRows(need(sections, 'ORDERS')).map((r) => {
    const f = fields(r.body);
    return { name: at(f, 0, `@ORDERS line ${r.line}`), key: f[1] ?? '' };
  });
  const difficulty = dataRows(need(sections, 'DIFFICULTY')).map((r) => r.body.trim());
  const attitudes = dataRows(need(sections, 'ATTITUDES')).map((r) => r.body.trim());

  return {
    cosmic,
    advances,
    improvements,
    wonderExpiry,
    units,
    terrain,
    governments,
    leaders,
    caravanCommodities,
    orders,
    difficulty,
    attitudes,
    warnings,
  };
}
