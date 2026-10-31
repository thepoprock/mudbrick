/**
 * The slice of the game rules the engine needs, as plain interfaces.
 *
 * `@mudbrick/formats` produces a `Rules` object from RULES.TXT whose shape satisfies these
 * interfaces structurally, so the engine never has to import a file-format module. Keeping
 * the fields minimal also documents exactly which rule data each system depends on.
 */

export interface TerrainRule {
  /** Movement points to enter (1 = one full move). */
  moveCost: number;
  /** Defence multiplier in halves: 2 = ×1.0, 3 = ×1.5, 4 = ×2.0. */
  defenceHalves: number;
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
  /** AI role 0–7; role 3 (air superiority) matters to combat. */
  role: number;
  flags: UnitFlagsRule;
}

export interface CosmicRule {
  roadMoveMultiplier: number;
}

export interface EngineRules {
  cosmic: CosmicRule;
  terrain: TerrainRule[];
  units: UnitTypeRule[];
}

export const DOMAIN_GROUND = 0;
export const DOMAIN_AIR = 1;
export const DOMAIN_SEA = 2;
