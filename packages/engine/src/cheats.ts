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
import type { City, Unit } from './world.js';

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

/** Change Terrain At Cursor (0x005094bf). */
export function cheatChangeTerrain(game: Game, x: number, y: number, terrain: number): void {
  game.world.terrain[game.world.index(x, y)] = terrain;
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

/** Edit Unit (0x0050ad7f). */
export function cheatEditUnit(
  unit: Unit,
  change: { veteran?: boolean; hitPointsLost?: number },
): void {
  if (change.veteran !== undefined) unit.veteran = change.veteran;
  if (change.hitPointsLost !== undefined) unit.hitPointsLost = Math.max(0, change.hitPointsLost);
}

/** Edit City (0x0050b507). */
export function cheatEditCity(city: City, change: { size?: number; shields?: number }): void {
  if (change.size !== undefined) city.size = Math.max(1, Math.min(99, change.size));
  if (change.shields !== undefined) city.shieldsStored = Math.max(0, change.shields);
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
