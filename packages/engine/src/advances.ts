/**
 * What gaining an advance sets off (VERIFIED, the add-advance routine 0x004935e5). The bookkeeping
 * is `grantAdvance` in research.ts; this module is the rest: Barracks sold at Gunpowder and the
 * later advance, the Philosophy flag, Leonardo's Workshop, the Great Library.
 *
 * Specification: docs/engine/rules-research.md, "Gaining an advance".
 */
import { grantAdvance } from './research.js';
import { advanceIndex, IMPROVEMENT, type EngineRules } from './rules.js';
import type { Civ, World } from './world.js';

const GUNPOWDER = 35;
const MOBILE_WARFARE = 53;
const PHILOSOPHY = 60;
const ROLE_DEFEND = 1;
const MUSKETEERS = 7;

export type AdvanceEvent =
  | { kind: 'barracks-sold'; advance: number; cities: number; gold: number }
  | { kind: 'units-upgraded'; from: number; to: number }
  | { kind: 'great-library'; advance: number }
  | { kind: 'wonder-expired'; advance: number; improvement: number }
  | { kind: 'golden-age' };

export interface AdvanceEffectContext {
  turn: number;
  firstDiscoveredBy: number[];
  /** The owner of a wonder, counting it as gone once expired (0x0043e3ef). */
  wonderOwner: (improvement: number) => number | null;
  knows: (slot: number, advance: number) => boolean;
}

/**
 * The second advance that closes Barracks: Mobile Warfare, or when a ruleset has disabled it the
 * nearest enabled advance down its first prerequisites (VERIFIED, the walk in 0x004935e5).
 */
export function barracksClosedBy(rules: EngineRules): number | null {
  let a: number | null = MOBILE_WARFARE;
  while (a !== null) {
    const r: EngineRules['advances'][number] | undefined = rules.advances[a];
    if (!r || r.preq1.kind !== 'never') return a;
    a = advanceIndex(r.preq1);
  }
  return null;
}

/** All of a civilization's units whose replacement it knows become that type and lose veteran
 * status (VERIFIED, 0x00492c44, run while it owns Leonardo's Workshop). */
export function leonardoUpgrades(
  world: World,
  rules: EngineRules,
  civ: Civ,
  knows: (advance: number) => boolean,
): AdvanceEvent[] {
  const events: AdvanceEvent[] = [];
  const announced = new Set<number>();
  const musketeers = rules.units[MUSKETEERS]?.defence ?? 0;
  for (const unit of world.units) {
    if (unit.owner !== civ.slot) continue;
    const t = rules.units[unit.type];
    if (!t) continue;
    let closing = advanceIndex(t.obsoleteWith);
    if (t.role === ROLE_DEFEND && t.defence < musketeers && knows(GUNPOWDER)) closing = GUNPOWDER;
    if (closing === null || !knows(closing)) continue;
    let target = -1;
    for (let k = 0; k < rules.units.length; k++) {
      const r = rules.units[k];
      if (r && advanceIndex(r.preq) === closing && r.role === t.role) {
        if ((t.holds ?? 0) <= (r.holds ?? 0)) target = k;
      }
    }
    if (target < 0) continue;
    if (!announced.has(unit.type)) {
      announced.add(unit.type);
      events.push({ kind: 'units-upgraded', from: unit.type, to: target });
    }
    unit.type = target;
    unit.veteran = false;
  }
  return events;
}

/**
 * Run after `grantAdvance`, when `first` says nobody knew the advance before. Nothing here runs on
 * turn 0: the original returns from the routine before any of it while a game is being set up.
 */
export function advanceEffects(
  world: World,
  rules: EngineRules,
  civ: Civ,
  advance: number,
  first: boolean,
  ctx: AdvanceEffectContext,
): AdvanceEvent[] {
  if (ctx.turn === 0) return [];
  const events: AdvanceEvent[] = [];

  if (advance === GUNPOWDER || advance === barracksClosedBy(rules)) {
    let cities = 0;
    for (const c of world.cities) {
      if (c.owner !== civ.slot) continue;
      if (c.improvements[IMPROVEMENT.barracks]) cities += 1;
      c.improvements[IMPROVEMENT.barracks] = false;
    }
    if (cities > 0) {
      const each = rules.improvements[IMPROVEMENT.barracks]?.costRows ?? 0;
      const gold = each * rules.cosmic.shieldBoxRows * cities;
      civ.treasury += gold;
      events.push({ kind: 'barracks-sold', advance, cities, gold });
    }
  }

  if (first) {
    if (advance === PHILOSOPHY) {
      civ.freeAdvancePending = true;
      events.push({ kind: 'golden-age' });
    }
    if ((ctx.firstDiscoveredBy[advance] ?? 0) === 0) ctx.firstDiscoveredBy[advance] = civ.slot;
    for (let i = IMPROVEMENT.pyramids; i < rules.improvements.length; i++) {
      if (advanceIndex(rules.improvements[i]?.expiresWith) !== advance) continue;
      if (world.cities.some((c) => c.improvements[i]))
        events.push({ kind: 'wonder-expired', advance, improvement: i });
    }
  }

  if (ctx.wonderOwner(IMPROVEMENT.leonardos) === civ.slot)
    events.push(...leonardoUpgrades(world, rules, civ, (a) => ctx.knows(civ.slot, a)));

  // The Great Library, while it stands: its owner gains what two civilizations know.
  const owner = ctx.wonderOwner(IMPROVEMENT.greatLibrary);
  if (owner !== null && owner > 0 && !ctx.knows(owner, advance)) {
    let knowers = 0;
    for (let s = 1; s < 8; s++) if (ctx.knows(s, advance)) knowers += 1;
    const library = world.civs.find((c) => c.slot === owner);
    if (knowers > 1 && library) {
      grantAdvance(library, advance, 'other');
      events.push({ kind: 'great-library', advance });
      events.push(...advanceEffects(world, rules, library, advance, false, ctx));
    }
  }
  return events;
}
