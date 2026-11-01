/**
 * Simple unit orders: fortify, sentry, wake, go to, pillage, disband.
 *
 * Specification: docs/engine/rules-units.md — pillage and disband VERIFIED (0x0053644e,
 * 0x00535725); fortify VERIFIED (becomes Fortified next turn, 0x00497b7a).
 */
import {
  breakTreaty,
  hasTreaty,
  setTreaty,
  TREATY,
  type DiplomacyContext,
  type DiplomacyEvent,
} from './diplomacy.js';
import { boxRows } from './city.js';
import { DOMAIN_GROUND, type EngineRules } from './rules.js';
import { ORDER } from './terraform.js';
import { SquareFlag, type Point, type Unit, type World } from './world.js';

export function fortify(unit: Unit): void {
  unit.order = ORDER.fortify;
  unit.fortified = false;
}

export function sentry(unit: Unit): void {
  unit.order = ORDER.sleep;
  unit.fortified = false;
}

export function wake(unit: Unit): void {
  unit.order = null;
  unit.fortified = false;
  unit.gotoTarget = null;
  unit.gotoSteps = 0;
}

export function orderGoTo(unit: Unit, target: Point): void {
  unit.order = ORDER.goTo;
  unit.fortified = false;
  unit.gotoTarget = { x: target.x, y: target.y };
  unit.gotoSteps = 0;
}

export type PillageTarget =
  'farmland' | 'irrigation' | 'mine' | 'airbase' | 'fortress' | 'railroad' | 'road';

export type PillageVerdict =
  | { ok: true; options: PillageTarget[] }
  | { ok: false; reason: 'non-combat' | 'not-ground' | 'in-city' | 'nothing' };

/** What a unit could pillage where it stands (VERIFIED order of the original's menu). */
export function pillageOptions(world: World, rules: EngineRules, unit: Unit): PillageVerdict {
  const type = rules.units[unit.type];
  if (!type || type.attack === 0) return { ok: false, reason: 'non-combat' };
  if (type.domain !== DOMAIN_GROUND) return { ok: false, reason: 'not-ground' };
  const { x, y } = unit.position;
  if (world.cityAt(x, y)) return { ok: false, reason: 'in-city' };
  const has = (f: number) => world.hasFlag(x, y, f);
  const options: PillageTarget[] = [];
  if (has(SquareFlag.Farmland)) options.push('farmland');
  else if (has(SquareFlag.Irrigation)) options.push('irrigation');
  else if (has(SquareFlag.Mine)) options.push('mine');
  if (has(SquareFlag.Airbase)) options.push('airbase');
  else if (has(SquareFlag.Fortress)) options.push('fortress');
  if (has(SquareFlag.Railroad)) options.push('railroad');
  else if (has(SquareFlag.Road)) options.push('road');
  return options.length === 0 ? { ok: false, reason: 'nothing' } : { ok: true, options };
}

/**
 * Pillage (VERIFIED 0x00498170 after the chooser 0x0053644e): the chosen improvement goes and the
 * unit's turn ends. Inside another civilization's city radius the treaty is broken first when
 * not already at war (0x004447be) and war is declared outright; the human is asked before.
 */
export function pillage(
  world: World,
  rules: EngineRules,
  unit: Unit,
  target: PillageTarget,
  diplomacy?: { ctx: DiplomacyContext; events: DiplomacyEvent[] },
): void {
  const { x, y } = unit.position;
  const owner = world.territory[world.index(x, y)] ?? 0;
  if (diplomacy && owner !== 0 && owner !== unit.owner) {
    if (!hasTreaty(world, unit.owner, owner, TREATY.war))
      breakTreaty(world, unit.owner, owner, null, diplomacy.ctx, diplomacy.events);
    setTreaty(world, unit.owner, owner, TREATY.war);
  }
  const clear = (f: number) => world.setFlag(x, y, f, false);
  switch (target) {
    case 'farmland':
      clear(SquareFlag.Farmland);
      break;
    case 'irrigation':
      clear(SquareFlag.Irrigation);
      break;
    case 'mine':
      clear(SquareFlag.Mine);
      break;
    case 'airbase':
      clear(SquareFlag.Airbase);
      clear(SquareFlag.Fortress);
      break;
    case 'fortress':
      clear(SquareFlag.Fortress);
      break;
    case 'railroad':
      clear(SquareFlag.Railroad);
      break;
    case 'road':
      clear(SquareFlag.Road);
      break;
  }
  const type = rules.units[unit.type];
  unit.movesSpent = (type?.move ?? 1) * 3;
  unit.fortified = false;
  unit.order = null;
}

/** Disband a unit (VERIFIED): inside a city, half its shield cost goes to the production box. */
export function disbandUnit(
  world: World,
  rules: EngineRules,
  unit: Unit,
  owner: { isHuman: boolean },
  difficulty: number,
): number {
  const city = world.cityAt(unit.position.x, unit.position.y);
  let refund = 0;
  if (city && city.owner === unit.owner) {
    const rows = boxRows(rules, { isHuman: owner.isHuman, difficulty }, true);
    refund = Math.trunc(((rules.units[unit.type]?.costRows ?? 0) * rows) / 2);
    city.shieldsStored += refund;
  }
  world.units.splice(world.units.indexOf(unit), 1);
  return refund;
}
