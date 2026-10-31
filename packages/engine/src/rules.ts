/**
 * The slice of the game rules the engine needs, as plain interfaces.
 *
 * `@mudbrick/formats` produces a `Rules` object from RULES.TXT whose shape satisfies these
 * interfaces structurally, so the engine never has to import a file-format module. Keeping
 * the fields minimal also documents exactly which rule data each system depends on.
 */

export interface TerrainSpecialRule {
  food: number;
  shields: number;
  trade: number;
}

export interface TerrainRule {
  /** Movement points to enter (1 = one full move). */
  moveCost: number;
  /** Defence multiplier in halves: 2 = ×1.0, 3 = ×1.5, 4 = ×2.0. */
  defenceHalves: number;
  food: number;
  shields: number;
  trade: number;
  /** Extra food from irrigation. */
  irrigateBonus: number;
  /** Extra shields from a mine. */
  mineBonus: number;
  /** The terrain's two special resources (RULES @TERRAIN first and second lists). */
  specials: [TerrainSpecialRule, TerrainSpecialRule];
}

export interface UnitFlagsRule {
  ignoreZonesOfControl: boolean;
  alpine: boolean;
  mustStayNearLand: boolean;
  negatesCityWalls: boolean;
  doubleDefenceVsHorse: boolean;
  doubleDefenceVsAir: boolean;
  submarine: boolean;
  canAttackAir: boolean;
  destroyedAfterAttack: boolean;
  freeSupportUnderFundamentalism: boolean;
}

export interface UnitTypeRule {
  name: string;
  /** 0 ground, 1 air, 2 sea. */
  domain: number;
  move: number;
  /** Turns of fuel for air units; 0 otherwise. */
  range: number;
  attack: number;
  defence: number;
  /** Hit points in tens: 2 = 20 HP. */
  hitPointsTens: number;
  firepower: number;
  /** Cost in shield rows. */
  costRows: number;
  /** AI role 0–7; role 3 (air superiority) and 5 (settle) matter to the rules. */
  role: number;
  flags: UnitFlagsRule;
}

export interface ImprovementRule {
  name: string;
  costRows: number;
  upkeep: number;
}

export interface CosmicRule {
  roadMoveMultiplier: number;
  foodPerCitizen: number;
  foodBoxRows: number;
  shieldBoxRows: number;
  settlersFoodEarlyGovt: number;
  settlersFoodLateGovt: number;
  unhappinessCitySizeChieftain: number;
  riotFactor: number;
  aqueductSize: number;
  sewerSize: number;
  monarchyFreeUnits: number;
  communismFreeUnits: number;
  fundamentalismFreeUnits: number;
  communismPalaceDistance: number;
  fundamentalismSciencePenaltyPct: number;
  fundamentalismMaxScienceRate: number;
}

export interface EngineRules {
  cosmic: CosmicRule;
  terrain: TerrainRule[];
  units: UnitTypeRule[];
  /** Indexed by RULES @IMPROVE row: 0 Nothing, 1 Palace … 38 Capitalization, 39–66 wonders. */
  improvements: ImprovementRule[];
}

export const DOMAIN_GROUND = 0;
export const DOMAIN_AIR = 1;
export const DOMAIN_SEA = 2;

/** Government indices (RULES @GOVERNMENTS order). */
export const GOVERNMENT = {
  anarchy: 0,
  despotism: 1,
  monarchy: 2,
  communism: 3,
  fundamentalism: 4,
  republic: 5,
  democracy: 6,
} as const;

/** RULES @IMPROVE indices the rules refer to by position. */
export const IMPROVEMENT = {
  nothing: 0,
  palace: 1,
  barracks: 2,
  granary: 3,
  temple: 4,
  marketplace: 5,
  library: 6,
  courthouse: 7,
  cityWalls: 8,
  aqueduct: 9,
  bank: 10,
  cathedral: 11,
  university: 12,
  massTransit: 13,
  colosseum: 14,
  factory: 15,
  manufacturingPlant: 16,
  sdiDefense: 17,
  recyclingCenter: 18,
  powerPlant: 19,
  hydroPlant: 20,
  nuclearPlant: 21,
  stockExchange: 22,
  sewerSystem: 23,
  supermarket: 24,
  superhighways: 25,
  researchLab: 26,
  samBattery: 27,
  coastalFortress: 28,
  solarPlant: 29,
  harbour: 30,
  offshorePlatform: 31,
  airport: 32,
  policeStation: 33,
  portFacility: 34,
  capitalization: 38,
  // wonders
  pyramids: 39,
  hangingGardens: 40,
  colossus: 41,
  lighthouse: 42,
  greatLibrary: 43,
  oracle: 44,
  greatWall: 45,
  sunTzu: 46,
  kingRichards: 47,
  marcoPolo: 48,
  michelangelos: 49,
  copernicus: 50,
  magellans: 51,
  shakespeares: 52,
  leonardos: 53,
  jsBachs: 54,
  isaacNewtons: 55,
  adamSmiths: 56,
  darwins: 57,
  statueOfLiberty: 58,
  eiffelTower: 59,
  womensSuffrage: 60,
  hooverDam: 61,
  manhattanProject: 62,
  unitedNations: 63,
  apolloProgram: 64,
  seti: 65,
  cureForCancer: 66,
} as const;

/** RULES @CIVILIZE indices the rules refer to by position (alphabetical in the shipped file). */
export const ADVANCE = {
  automobile: 5,
  ceremonialBurial: 9,
  communism: 15,
  electronics: 24,
  environmentalism: 26,
  industrialization: 37,
  massProduction: 48,
  monotheism: 55,
  mysticism: 56,
  nuclearPower: 59,
  plastics: 62,
  railroad: 67,
  sanitation: 74,
  theology: 82,
} as const;
