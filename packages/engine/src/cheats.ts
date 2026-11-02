/**
 * The Cheat menu (Menu.txt @CHEAT; the routines 0x00508b16 to 0x0050b507). These only reach the
 * game's records. Turning cheat mode on sets a flag in the game state, as the original does, and
 * the original has no score penalty for it.
 */
import {
  attitudesOf,
  clearTreaty,
  lastWarTurnsOf,
  setTreaty,
  treatiesOf,
  TREATY,
} from './diplomacy.js';
import { removeCity } from './fertility.js';
import { computeFertility } from './fertility.js';
import type { Game } from './game.js';
import { lookAround } from './sight.js';
import { ORDER } from './terraform.js';
import { OCEAN, SquareFlag, type City, type Unit } from './world.js';

export function cheatCreateUnit(
  game: Game,
  type: number,
  owner: number,
  x: number,
  y: number,
): Unit {
  const unit: Unit = {
    id: game.world.units.reduce((m, u) => Math.max(m, u.id), -1) + 1,
    position: { x, y },
    owner,
    type,
    veteran: false,
    hitPointsLost: 0,
    movesSpent: 0,
    fortified: false,
    homeCity: null,
    order: null,
    workCounter: 0,
    gotoTarget: null,
    lastDirection: null,
    gotoSteps: 0,
  };
  game.world.units.push(unit);
  lookAround(game.world, game.rules, unit);
  return unit;
}

/** Reveal Map (0x0050a12f) as a lasting change: `slot` sees every square. */
export function cheatRevealMap(game: Game, slot: number): void {
  const bit = 1 << slot;
  for (let i = 0; i < game.world.seen.length; i++)
    game.world.seen[i] = (game.world.seen[i] ?? 0) | bit;
}

/** Set Human Player (0x0050a35f): the player takes over `slot`. */
export function cheatSetHuman(game: Game, from: number, slot: number): void {
  game.civ(from).isHuman = false;
  game.civ(slot).isHuman = true;
  game.state.movingHuman = slot;
}

/** Kill Civilization (0x0050a5ab): every city goes, then the civilization. */
export function cheatKillCivilization(game: Game, slot: number): void {
  const civ = game.civ(slot);
  civ.isHuman = false;
  for (const c of game.world.cities.filter((x) => x.owner === slot))
    removeCity(game.world, game.rules, c);
  for (const u of game.world.units.filter((x) => x.owner === slot))
    game.world.units.splice(game.world.units.indexOf(u), 1);
  civ.inPlay = false;
  game.state.destroyedCivilizations = (game.state.destroyedCivilizations ?? 0) + 1;
}

/**
 * Change Terrain At Cursor, base terrain (VERIFIED 0x005094bf). A city square is left alone. When
 * a square crosses between land and ocean it takes the lowest land mass number among its neighbours
 * of the new kind, 63 when it has none; becoming ocean also clears the no-special bit.
 */
export function cheatChangeTerrain(game: Game, x: number, y: number, terrain: number): void {
  const world = game.world;
  if (world.cityAt(x, y)) return;
  const i = world.index(x, y);
  const was = world.terrain[i];
  if (was === terrain) return;
  world.terrain[i] = terrain;
  if (terrain === OCEAN) world.setFlag(x, y, SquareFlag.NoSpecial, false);
  if (terrain === OCEAN || was === OCEAN) {
    let lowest = 63;
    for (const n of world.neighbours(x, y)) {
      if (!n || (world.terrainAt(n.x, n.y) === OCEAN) !== (terrain === OCEAN)) continue;
      lowest = Math.min(lowest, (world.landmass[world.index(n.x, n.y)] ?? 0) & 63);
    }
    world.landmass[i] = lowest;
  }
  computeFertility(world, game.rules);
}

/**
 * The irrigate column followed from a land terrain, which is the short list Change Terrain offers
 * first (VERIFIED 0x005094bf); the dialog's other button opens all eleven.
 */
export function cheatTerrainChain(game: Game, terrain: number): number[] {
  const out = [terrain];
  for (let t = game.rules.terrain[terrain]?.irrigate; t?.kind === 'becomes';) {
    if (out.includes(t.terrainIndex)) break;
    out.push(t.terrainIndex);
    t = game.rules.terrain[t.terrainIndex]?.irrigate;
  }
  return out;
}

/** The square's improvements as Change Terrain's seven check boxes (VERIFIED 0x005094bf). */
export interface CheatSquareImprovements {
  irrigation: boolean;
  mine: boolean;
  road: boolean;
  railroad: boolean;
  fortress: boolean;
  airbase: boolean;
  pollution: boolean;
}

export function cheatSquareImprovements(game: Game, x: number, y: number): CheatSquareImprovements {
  const has = (f: SquareFlag) => game.world.hasFlag(x, y, f);
  const farm = has(SquareFlag.Farmland);
  return {
    irrigation: has(SquareFlag.Irrigation) || farm,
    mine: has(SquareFlag.Mine) || farm,
    road: has(SquareFlag.Road),
    railroad: has(SquareFlag.Railroad),
    fortress: has(SquareFlag.Fortress) && !has(SquareFlag.Airbase),
    airbase: has(SquareFlag.Airbase),
    pollution: has(SquareFlag.Pollution),
  };
}

/**
 * Write the check boxes back (VERIFIED 0x005094bf). In the original's bits both irrigation and
 * mine make farmland, a railroad brings its road, and an airbase wins over a fortress.
 */
export function cheatSetSquareImprovements(
  game: Game,
  x: number,
  y: number,
  v: CheatSquareImprovements,
): void {
  const set = (f: SquareFlag, on: boolean) => game.world.setFlag(x, y, f, on);
  set(SquareFlag.Farmland, v.irrigation && v.mine);
  set(SquareFlag.Irrigation, v.irrigation && !v.mine);
  set(SquareFlag.Mine, v.mine && !v.irrigation);
  set(SquareFlag.Road, v.road || v.railroad);
  set(SquareFlag.Railroad, v.railroad);
  set(SquareFlag.Fortress, v.fortress && !v.airbase);
  set(SquareFlag.Airbase, v.airbase);
  set(SquareFlag.Pollution, v.pollution);
  computeFertility(game.world, game.rules);
}

/** Destroy All Units At Cursor. */
export function cheatDestroyUnits(game: Game, x: number, y: number): void {
  for (const u of game.world.unitsAt(x, y)) game.world.units.splice(game.world.units.indexOf(u), 1);
}

/** Change Money (0x0050ac80): clamped to 0 to 30,000. */
export function cheatSetMoney(game: Game, slot: number, amount: number): void {
  game.civ(slot).treasury = Math.max(0, Math.min(30000, amount));
}

/**
 * Edit Unit (VERIFIED 0x0050ad7f): toggle veteran, restore its moves, set hit points, home city
 * (null for none), toggle Fortified on a land unit, and a caravan's commodity (0xFF for none).
 */
export function cheatEditUnit(
  game: Game,
  unit: Unit,
  change: {
    toggleVeteran?: boolean;
    restoreMoves?: boolean;
    hitPointsLost?: number;
    homeCity?: number | null;
    toggleFortified?: boolean;
    commodity?: number;
  },
): void {
  const rule = game.rules.units[unit.type];
  if (change.toggleVeteran) unit.veteran = !unit.veteran;
  if (change.restoreMoves) unit.movesSpent = 0;
  if (change.hitPointsLost !== undefined) unit.hitPointsLost = Math.max(0, change.hitPointsLost);
  if (change.homeCity !== undefined) unit.homeCity = change.homeCity;
  if (change.toggleFortified && rule?.domain === 0) {
    const on = unit.order !== ORDER.fortified;
    unit.order = on ? ORDER.fortified : null;
    unit.fortified = on;
  }
  if (change.commodity !== undefined && rule?.role === 7) unit.commodity = change.commodity;
}

/**
 * Edit City (VERIFIED 0x0050b507): size, clear its wonders, clear disorder and celebration, copy
 * another city's improvements while keeping its own Palace state, shields, and toggle objective.
 */
export function cheatEditCity(
  city: City,
  change: {
    size?: number;
    shields?: number;
    clearWonders?: boolean;
    clearOrderFlags?: boolean;
    copyImprovementsFrom?: City;
    toggleObjective?: boolean;
  },
): void {
  if (change.size !== undefined) city.size = Math.max(1, Math.min(99, change.size));
  if (change.shields !== undefined) city.shieldsStored = Math.max(0, change.shields);
  if (change.clearWonders) for (let i = 39; i <= 66; i++) city.improvements[i] = false;
  if (change.clearOrderFlags) {
    city.inDisorder = false;
    city.celebrating = false;
  }
  const from = change.copyImprovementsFrom;
  if (from && from !== city)
    for (let i = 2; i <= 38; i++) city.improvements[i] = from.improvements[i] === true;
  if (change.toggleObjective) {
    if (city.objective) delete city.objective;
    else city.objective = true;
  }
}

/**
 * Edit King (VERIFIED 0x0050ba78): the items that change a civilization. Treaties take a bit mask
 * of the seven the dialog lists; `copyAdvancesFrom` gives it another civilization's knowledge.
 */
export function cheatEditKing(
  game: Game,
  slot: number,
  change: {
    treatiesWith?: { other: number; flags: number };
    attitudeTo?: { other: number; value: number };
    reputation?: number;
    progress?: number;
    clearResearch?: boolean;
    clearPatience?: boolean;
    names?: { leader?: string; name?: string; adjective?: string };
    copyAdvancesFrom?: number;
    lastContact?: { other: number; turn: number };
    clearLastContact?: boolean;
    toggleFemale?: boolean;
  },
): void {
  const civ = game.civ(slot);
  if (change.treatiesWith) {
    // VERIFIED order: strain and broken always clear; war replaces the three pacts; the last two
    // bits are vendetta and embassy.
    const { other, flags } = change.treatiesWith;
    const on = (i: number) => ((flags >> i) & 1) === 1;
    clearTreaty(game.world, slot, other, TREATY.strain | TREATY.broken);
    if (on(0)) setTreaty(game.world, slot, other, TREATY.contact);
    else clearTreaty(game.world, slot, other, TREATY.contact);
    if (on(4)) setTreaty(game.world, slot, other, TREATY.war);
    else {
      clearTreaty(
        game.world,
        slot,
        other,
        TREATY.war | TREATY.ceaseFire | TREATY.peace | TREATY.alliance,
      );
      if (on(1)) setTreaty(game.world, slot, other, TREATY.ceaseFire);
      if (on(2)) setTreaty(game.world, slot, other, TREATY.peace);
      if (on(3)) setTreaty(game.world, slot, other, TREATY.alliance);
    }
    const t = treatiesOf(civ);
    t[other] = ((t[other] ?? 0) & ~(TREATY.vendetta | TREATY.embassy)) >>> 0;
    if (on(5)) t[other] = ((t[other] ?? 0) | TREATY.vendetta) >>> 0;
    if (on(6)) t[other] = ((t[other] ?? 0) | TREATY.embassy) >>> 0;
  }
  if (change.clearPatience) civ.talks = 0;
  if (change.attitudeTo)
    attitudesOf(civ)[change.attitudeTo.other] = Math.max(0, Math.min(100, change.attitudeTo.value));
  if (change.reputation !== undefined) civ.reputation = change.reputation;
  if (change.progress !== undefined) civ.scienceStored = change.progress;
  if (change.clearResearch) civ.researching = null;
  if (change.names?.leader) civ.leader = change.names.leader;
  if (change.names?.name) civ.name = change.names.name;
  if (change.names?.adjective) civ.adjective = change.names.adjective;
  if (change.copyAdvancesFrom !== undefined) {
    civ.knownAdvances = [...game.civ(change.copyAdvancesFrom).knownAdvances];
    civ.advancesCount = civ.knownAdvances.filter(Boolean).length;
  }
  if (change.lastContact) lastWarTurnsOf(civ)[change.lastContact.other] = change.lastContact.turn;
  // VERIFIED: "clear" stamps every pair of every civilization with the present turn.
  if (change.clearLastContact)
    for (const c of game.world.civs) lastWarTurnsOf(c).fill(game.state.turn);
  if (change.toggleFemale) civ.female = civ.female !== true;
}
