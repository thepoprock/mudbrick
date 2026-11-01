/**
 * Diplomats and spies.
 *
 * Ported from the diplomat-in-city routine (0x00499c93), its resolution (0x0049904c: a spy may
 * escape to the nearest own city, a diplomat is spent), the hard-action catch test (0x00499548),
 * the capital-distance helper (0x00499670), the incite transfer (0x00499758), the diplomatic
 * incident (0x00498a90), the bribe (0x0049c5c6) and the diplomat-versus-unit menu (0x0049cf5b).
 * VERIFIED unless marked INFERRED. docs/engine/espionage.md.
 */
import { captureCity } from './conquest.js';
import { distance } from './city.js';
import { adjustAttitude, clearTreaty, hasTreaty, setTreaty, TREATY } from './diplomacy.js';
import { nuclearStrike } from './nuclear.js';
import { grantAdvance } from './research.js';
import { advanceIndex, GOVERNMENT, IMPROVEMENT, type EngineRules } from './rules.js';
import type { Rng } from './rng.js';
import type { City, Civ, Unit, World } from './world.js';

/** The original tests unit type 47 for "is a Spy" (VERIFIED hard-coded). */
export const SPY_TYPE = 47;
const ROLE_DIPLOMAT = 6;
const DIPLOMAT = 46;
const ROLE_SETTLERS = 5;
const ROLE_TRADE = 7;
/** Improvements that cannot be sabotaged (0, the Palace, and SDI Defense — VERIFIED skip list). */
const UNSABOTAGEABLE = new Set([0, IMPROVEMENT.palace, 17]);

export type EspionageAction =
  'embassy' | 'investigate' | 'steal' | 'sabotage' | 'poison' | 'nuke' | 'incite';

export interface EspionageEvent {
  kind: 'espionage';
  text: string;
  city?: number;
  /** For "investigate": the city's record is open to the agent's owner. */
  investigated?: number;
}

export interface EspionageContext {
  /** Run the consequences of an advance just granted (Game.advanceGained). */
  advanceGained?: (civ: Civ, advance: number) => void;
  turn: number;
  difficulty: number;
  rng: Rng;
  isHuman: (slot: number) => boolean;
  knows: (slot: number, advance: number) => boolean;
  ownsWonder: (slot: number, improvement: number) => boolean;
  /** The wonder stands somewhere (the Manhattan Project enables nuclear devices). */
  wonderBuilt: (improvement: number) => boolean;
  /** Advances with an impossible prerequisite are never stolen (RULES "no" preqs). */
  researchable: (advance: number) => boolean;
  /** The government falls (a Senate scandal after an incident under Republic or Democracy). */
  revolution?: (slot: number) => void;
}

function civOf(world: World, slot: number): Civ | undefined {
  return world.civs.find((c) => c.slot === slot);
}
function isSpy(unit: Unit): boolean {
  return unit.type === SPY_TYPE;
}

/** Distance from a civilization's Palace to a square, 16 without one (0x00499670). */
export function capitalDistance(world: World, slot: number, p: { x: number; y: number }): number {
  let best = 16;
  for (const c of world.cities) {
    if (c.owner !== slot || !c.improvements[IMPROVEMENT.palace]) continue;
    best = Math.min(best, distance(world, c.position, p));
  }
  return best;
}

/** Remove the agent from the world. */
function spend(world: World, unit: Unit): void {
  const i = world.units.indexOf(unit);
  if (i >= 0) world.units.splice(i, 1);
}

/**
 * The agent's fate (0x0049904c). `mode` −1 is the catch test before a hard action, 0 after an
 * ordinary act, 1 after a specific theft. A spy escapes to the nearest own city with chance
 * `1 − 1/n`, n = 3 (test) or 2 (act), doubled for a veteran, halved for mode 1, and a lone
 * chance rounded up; a diplomat is always spent. Returns true when the agent is lost.
 */
export function resolveAgent(
  world: World,
  rules: EngineRules,
  unit: Unit,
  mode: number,
  ctx: EspionageContext,
  events: EspionageEvent[],
): boolean {
  if (mode >= 0) unit.movesSpent += rules.cosmic.roadMoveMultiplier;
  if (isSpy(unit)) {
    let n = mode < 0 ? 3 : 2;
    if (unit.veteran) n *= 2;
    if (mode > 0) n = Math.trunc(n / 2);
    if (n < 2 && ctx.rng.nextInt(2) === 0) n += 1;
    const roll = n > 1 ? ctx.rng.nextInt(n) : 0;
    if (roll !== 0) {
      let home: City | null = null;
      let bestD = 9999;
      for (const c of world.cities) {
        if (c.owner !== unit.owner) continue;
        const d = distance(world, unit.position, c.position);
        if (d < bestD) {
          bestD = d;
          home = c;
        }
      }
      if (home) unit.position = { x: home.position.x, y: home.position.y };
      unit.movesSpent = 999;
      unit.order = null;
      if (mode >= 0) {
        events.push({
          kind: 'espionage',
          text: unit.veteran ? 'the spy escapes again' : 'the spy escapes and is promoted',
        });
        unit.veteran = true;
      }
      return false;
    }
  }
  if (mode >= 0)
    events.push({ kind: 'espionage', text: `the ${isSpy(unit) ? 'spy' : 'diplomat'} is lost` });
  spend(world, unit);
  return true;
}

/**
 * A diplomatic incident (0x00498a90) between the agent's owner and the victim: without a treaty
 * the victim's attitude worsens by 20; with one, a human victim is asked for a pretext (the
 * engine lets it pass — INFERRED), a human agent against a computer victim brings a vendetta
 * (Fundamentalism) or war, an ally's grudge, and a human Republic (half the time) or Democracy
 * suffers a Senate scandal.
 */
export function incident(
  world: World,
  me: number,
  them: number,
  action: EspionageAction,
  ctx: EspionageContext,
  events: EspionageEvent[],
): void {
  if (hasTreaty(world, them, me, TREATY.strain)) return;
  const treaty = hasTreaty(world, me, them, TREATY.ceaseFire | TREATY.peace | TREATY.alliance);
  if (!treaty) {
    adjustAttitude(world, them, me, 20);
    return;
  }
  const meCiv = civOf(world, me);
  if (ctx.isHuman(me) && !ctx.isHuman(them) && meCiv) {
    if (!hasTreaty(world, me, them, TREATY.alliance)) {
      if (meCiv.government === GOVERNMENT.fundamentalism) {
        setTreaty(world, them, me, TREATY.vendetta);
        adjustAttitude(world, them, me, 10);
        events.push({ kind: 'espionage', text: 'the victims swear a vendetta' });
      } else {
        setTreaty(world, me, them, TREATY.war);
        events.push({ kind: 'espionage', text: 'the incident means war' });
      }
    } else {
      const themCiv = civOf(world, them);
      if (action === 'steal' && themCiv && meCiv.advancesCount < themCiv.advancesCount) {
        adjustAttitude(world, them, me, ctx.rng.nextInt(15) + 5);
        events.push({ kind: 'espionage', text: 'the allies grumble' });
        return;
      }
      clearTreaty(world, me, them, TREATY.alliance);
      setTreaty(world, me, them, TREATY.war);
      events.push({ kind: 'espionage', text: 'the alliance is broken and war declared' });
    }
  }
  if (ctx.isHuman(me) && meCiv) {
    const g = meCiv.government;
    if (g === GOVERNMENT.democracy || (g === GOVERNMENT.republic && ctx.rng.nextInt(2) === 0)) {
      events.push({ kind: 'espionage', text: 'a Senate scandal brings the government down' });
      ctx.revolution?.(me);
    }
  }
}

/** The actions open to a human agent in a foreign city (the SPYOPTIONS menu, VERIFIED). */
export function espionageOptions(
  world: World,
  unit: Unit,
  city: City,
  ctx: EspionageContext,
): EspionageAction[] {
  const me = unit.owner;
  const them = city.owner;
  const spy = isSpy(unit);
  const out: EspionageAction[] = [];
  if (!hasTreaty(world, me, them, TREATY.embassy) && !ctx.ownsWonder(me, 39 + 24))
    out.push('embassy');
  out.push('investigate');
  if (!city.techStolen || spy) out.push('steal');
  out.push('sabotage');
  if (spy && city.size > 1) out.push('poison');
  if (spy && ctx.knows(me, 73) && ctx.knows(me, 58) && ctx.wonderBuilt(39 + 23)) out.push('nuke');
  if (!city.improvements[IMPROVEMENT.palace]) out.push('incite');
  return out;
}

/** The computer's choice (VERIFIED order of tests). */
export function aiEspionageChoice(
  world: World,
  unit: Unit,
  city: City,
  ctx: EspionageContext,
): EspionageAction {
  const me = unit.owner;
  const them = city.owner;
  const themCiv = civOf(world, them);
  let choice: EspionageAction = 'steal';
  if (hasTreaty(world, me, them, TREATY.vendetta) && ctx.rng.nextInt(3) === 0 && isSpy(unit))
    choice = 'poison';
  if (hasTreaty(world, me, them, TREATY.peace)) choice = 'steal';
  const incidents = themCiv?.incidents ?? 0;
  if (
    (ctx.difficulty > 3 || (ctx.difficulty === 3 && incidents > 5)) &&
    choice === 'steal' &&
    (hasTreaty(world, me, them, TREATY.war) || hasTreaty(world, me, them, TREATY.vendetta)) &&
    themCiv?.government !== GOVERNMENT.democracy
  )
    choice = 'incite';
  if (hasTreaty(world, me, them, TREATY.alliance)) choice = 'steal';
  if (city.techStolen && !isSpy(unit) && choice === 'steal') {
    choice = 'sabotage';
    if (hasTreaty(world, me, them, TREATY.ceaseFire | TREATY.peace | TREATY.alliance))
      choice = 'embassy';
  }
  return choice;
}

/** The incite cost (VERIFIED). */
export function inciteCost(world: World, unit: Unit, city: City): number {
  const them = civOf(world, city.owner);
  if (!them) return 30000;
  let dist = capitalDistance(world, city.owner, unit.position);
  if (them.government === GOVERNMENT.communism && dist > 9) dist = 10;
  if (city.improvements[IMPROVEMENT.courthouse]) dist = Math.trunc(dist / 2);
  let cost = city.size * Math.trunc((them.treasury + 1000) / (dist + 3));
  if (cost < 0) cost = 30000;
  if (city.inDisorder) cost = Math.trunc(cost / 2);
  if (world.unitsAt(city.position.x, city.position.y).length === 0) cost = Math.trunc(cost / 2);
  if (city.previousOwner === unit.owner) cost = Math.trunc(cost / 2);
  if (isSpy(unit)) cost -= Math.trunc(cost / (unit.veteran ? 3 : 6));
  return cost;
}

/** Units in or next to the city (not in another city) change sides; the city changes hands (0x00499758). */
function inciteTransfer(
  world: World,
  rules: EngineRules,
  city: City,
  me: number,
  ctx: EspionageContext,
  events: EspionageEvent[],
): void {
  const them = civOf(world, city.owner);
  const meCiv = civOf(world, me);
  if (!them || !meCiv) return;
  for (const u of world.units) {
    if (u.owner !== them.slot) continue;
    const d = distance(world, u.position, city.position);
    if (d >= 2) continue;
    if (d !== 0 && world.cityAt(u.position.x, u.position.y)) continue;
    u.owner = me;
    u.homeCity = city.id;
    u.movesSpent = 999;
    if (u.order !== 0 && u.order !== 1) u.order = null;
  }
  captureCity(world, rules, ctx.rng, city, meCiv, them, {
    turn: ctx.turn,
    difficulty: ctx.difficulty,
    conquest: false,
    guerillaWarfareDiscovered: false,
  });
  world.revealRadius(city.position.x, city.position.y, me);
  events.push({
    kind: 'espionage',
    text: `${city.name} rises in revolt and joins us`,
    city: city.id,
  });
}

/** A random advance the victim knows and the thief does not (VERIFIED scan; INFERRED: the first found). */
function stealable(
  world: World,
  rules: EngineRules,
  me: number,
  them: number,
  ctx: EspionageContext,
): number {
  const meCiv = civOf(world, me);
  const themCiv = civOf(world, them);
  if (!meCiv || !themCiv) return -1;
  const start = ctx.rng.nextInt(100);
  for (let i = 0; i < 100; i++) {
    const a = (start + i) % 100;
    if (a >= rules.advances.length || !ctx.researchable(a)) continue;
    if (meCiv.knownAdvances[a] === true || themCiv.knownAdvances[a] !== true) continue;
    return a;
  }
  return -1;
}

/**
 * Carry out an action in a foreign city. `option` picks the sabotage target (an improvement
 * index, 0 for production) or the incite form (1 incite, 2 incite and claim).
 */
export function performEspionage(
  world: World,
  rules: EngineRules,
  unit: Unit,
  city: City,
  action: EspionageAction,
  ctx: EspionageContext,
  option?: number,
): EspionageEvent[] {
  const events: EspionageEvent[] = [];
  const me = unit.owner;
  const them = city.owner;
  const meCiv = civOf(world, me);
  if (!meCiv) return events;
  setTreaty(world, me, them, TREATY.contact);
  const spy = isSpy(unit);
  const hard = () => resolveAgent(world, rules, unit, -1, ctx, events);
  const done = (mode: number) => resolveAgent(world, rules, unit, mode, ctx, events);
  // Diplomats defending the city catch the thief: 20%, a spy 40%, a veteran spy 60%.
  const guarded = (): boolean => {
    for (const g of world.unitsAt(city.position.x, city.position.y)) {
      if (rules.units[g.type]?.role !== ROLE_DIPLOMAT) continue;
      let chance = 20;
      if (g.type === SPY_TYPE) chance = g.veteran ? 60 : 40;
      if (ctx.rng.nextInt(100) < chance) {
        events.push({
          kind: 'espionage',
          text: `caught by the ${rules.units[g.type]?.name ?? 'guard'} in ${city.name}`,
        });
        spend(world, unit);
        return true;
      }
    }
    return false;
  };
  switch (action) {
    case 'embassy': {
      if (!hasTreaty(world, me, them, TREATY.embassy)) {
        setTreaty(world, me, them, TREATY.embassy);
        events.push({
          kind: 'espionage',
          text: `an embassy is established with the ${civOf(world, them)?.name ?? 'foreigners'}`,
          city: city.id,
        });
        if (spy) unit.movesSpent += 1;
        else spend(world, unit);
        return events;
      }
      return performEspionage(world, rules, unit, city, 'investigate', ctx);
    }
    case 'investigate': {
      events.push({
        kind: 'espionage',
        text: `${city.name} is investigated`,
        city: city.id,
        investigated: city.id,
      });
      if (!ctx.isHuman(me)) spend(world, unit);
      else if (!spy) done(0);
      else if (!city.investigated) unit.movesSpent += 1;
      city.investigated = true;
      return events;
    }
    case 'steal': {
      const adv = stealable(world, rules, me, them, ctx);
      if (adv < 0) {
        events.push({ kind: 'espionage', text: `nothing to steal in ${city.name}` });
        unit.movesSpent += rules.cosmic.roadMoveMultiplier;
        return events;
      }
      let mode = 0;
      if (city.techStolen) {
        if (hard()) return events;
        mode = 1;
      }
      if (guarded()) return events;
      grantAdvance(meCiv, adv, 'other');
      ctx.advanceGained?.(meCiv, adv);
      city.techStolen = true;
      events.push({
        kind: 'espionage',
        text: `${rules.advances[adv]?.name ?? 'an advance'} is stolen from ${city.name}`,
        city: city.id,
      });
      done(mode);
      incident(world, me, them, 'steal', ctx, events);
      return events;
    }
    case 'sabotage': {
      let target = 0;
      let specific = false;
      if (
        option !== undefined &&
        option > 0 &&
        city.improvements[option] &&
        !UNSABOTAGEABLE.has(option) &&
        spy
      ) {
        target = option;
        specific = true;
        if (option === IMPROVEMENT.cityWalls || city.improvements[IMPROVEMENT.palace]) {
          if (hard()) return events;
        }
      } else {
        const start = ctx.rng.nextInt(39);
        for (let i = 0; i < 39; i++) {
          const imp = (start + i) % 39;
          if (UNSABOTAGEABLE.has(imp) || !city.improvements[imp]) continue;
          target = imp;
          break;
        }
        if (city.shieldsStored > 0 && target !== 0) {
          let n = spy ? 3 : 2;
          if (unit.veteran) n += 1;
          if (ctx.rng.nextInt(n) === 0) target = 0;
        }
      }
      if (target === 0) {
        city.shieldsStored = 0;
        events.push({
          kind: 'espionage',
          text: `production in ${city.name} is destroyed`,
          city: city.id,
        });
      } else {
        city.improvements[target] = false;
        events.push({
          kind: 'espionage',
          text: `the ${rules.improvements[target]?.name ?? 'building'} in ${city.name} is destroyed`,
          city: city.id,
        });
      }
      done(specific ? 1 : 0);
      incident(world, me, them, 'sabotage', ctx, events);
      return events;
    }
    case 'poison': {
      if (!spy) return events;
      if (city.size < 2) city.foodStored = 0;
      else city.size -= 1;
      events.push({
        kind: 'espionage',
        text: `the water supply of ${city.name} is poisoned`,
        city: city.id,
      });
      done(ctx.rng.nextInt(2));
      incident(world, me, them, 'poison', ctx, events);
      return events;
    }
    case 'nuke': {
      if (!spy) return events;
      for (let i = 0; i < 3; i++) if (hard()) return events;
      if (city.improvements[IMPROVEMENT.palace] && hard()) return events;
      events.push({
        kind: 'espionage',
        text: `a nuclear device destroys ${city.name}`,
        city: city.id,
      });
      nuclearStrike(world, ctx.rng, me, city.position.x, city.position.y, false);
      if (meCiv.government !== GOVERNMENT.fundamentalism) {
        const n = unit.veteran ? 4 : 2;
        if (ctx.rng.nextInt(n) === 0) {
          events.push({ kind: 'espionage', text: 'the world learns who planted it' });
          for (const c of world.civs) {
            if (c.slot === 0 || c.slot === me) continue;
            adjustAttitude(world, c.slot, me, 100);
            setTreaty(world, me, c.slot, TREATY.war);
          }
        }
      }
      return events;
    }
    case 'incite': {
      const themCiv = civOf(world, them);
      if (!themCiv) return events;
      if (themCiv.government === GOVERNMENT.democracy) {
        events.push({
          kind: 'espionage',
          text: `${city.name} will not revolt against a Democracy`,
        });
        return events;
      }
      if (capitalDistance(world, them, unit.position) <= 1) {
        events.push({
          kind: 'espionage',
          text: `${city.name} is the capital and cannot be incited`,
        });
        return events;
      }
      const cost = inciteCost(world, unit, city);
      const form = option === 2 ? 2 : 1;
      if (meCiv.treasury < cost * form) {
        events.push({ kind: 'espionage', text: `inciting ${city.name} would cost ${cost} gold` });
        return events;
      }
      meCiv.treasury -= cost * form;
      meCiv.incidents = (meCiv.incidents ?? 0) + 2;
      spend(world, unit);
      if (form === 2) {
        setTreaty(world, them, me, TREATY.vendetta);
        city.previousOwner = me;
      }
      inciteTransfer(world, rules, city, me, ctx, events);
      if (form === 1) incident(world, me, them, 'incite', ctx, events);
      return events;
    }
    default:
      return events;
  }
}

/** The bribe cost for a lone unit (VERIFIED), or null when it cannot be bribed. */
export function bribeCost(
  world: World,
  rules: EngineRules,
  target: Unit,
  briber: number,
): number | null {
  if (world.unitsAt(target.position.x, target.position.y).length > 1) return null;
  const owner = civOf(world, target.owner);
  const type = rules.units[target.type];
  if (!owner || !type) return null;
  // Incorruptible, but only to a human: the original's test names the briber (0x0049c5c6).
  if (owner.government === GOVERNMENT.democracy && civOf(world, briber)?.isHuman === true)
    return null;
  let dist = capitalDistance(world, target.owner, target.position);
  if (civOf(world, briber)?.government === GOVERNMENT.communism && dist > 9) dist = 10;
  let cost = type.costRows * Math.trunc((owner.treasury + 750) / (dist + 2));
  if (cost < 0) cost = 30000;
  if (type.role !== ROLE_SETTLERS) cost = Math.trunc(cost / 2);
  return cost;
}

/**
 * Bribe a unit (0x0049c5c6): a civilization buys it, Diplomat or none. The computer players do this
 * from their move chooser with no agent at hand, once they know what a Diplomat needs.
 */
export function bribeUnit(
  world: World,
  rules: EngineRules,
  me: number,
  target: Unit,
  ctx: EspionageContext,
): EspionageEvent[] {
  const events: EspionageEvent[] = [];
  const meCiv = civOf(world, me);
  const type = rules.units[target.type];
  if (!meCiv || !type) return events;
  if (type.role === ROLE_TRADE && !ctx.isHuman(me)) return events;
  const needed = advanceIndex(rules.units[DIPLOMAT]?.preq);
  if (!ctx.isHuman(me) && needed !== null && !ctx.knows(me, needed)) return events;
  const cost = bribeCost(world, rules, target, me);
  if (cost === null) {
    events.push({ kind: 'espionage', text: 'that unit cannot be bribed' });
    return events;
  }
  if (!ctx.isHuman(me) && Math.trunc(meCiv.treasury / 2) < cost) return events;
  if (meCiv.treasury < cost) {
    events.push({ kind: 'espionage', text: `bribing the ${type.name} would cost ${cost} gold` });
    return events;
  }
  meCiv.treasury -= cost;
  const victim = civOf(world, target.owner);
  if (victim) victim.incidents = (victim.incidents ?? 0) + 1;
  target.owner = me;
  target.homeCity = null;
  target.movesSpent = 999;
  target.order = null;
  target.fortified = false;
  const here = world.cityAt(target.position.x, target.position.y);
  if (here && here.owner === me) target.homeCity = here.id;
  events.push({ kind: 'espionage', text: `the ${type.name} deserts to us for ${cost} gold` });
  return events;
}

/** A human spy may blow up a lone unit instead: it loses half its hit points and the spy is spent. */
export function sabotageUnit(
  world: World,
  rules: EngineRules,
  spy: Unit,
  target: Unit,
  ctx: EspionageContext,
): EspionageEvent[] {
  const events: EspionageEvent[] = [];
  const type = rules.units[target.type];
  if (!type || !isSpy(spy)) return events;
  target.hitPointsLost += Math.trunc((type.hitPointsTens * 10) / 2);
  events.push({ kind: 'espionage', text: `the spy blows up the ${type.name}` });
  resolveAgent(world, rules, spy, 0, ctx, events);
  return events;
}

/**
 * Expel a treaty partner's lone agent from our land (0x00539099, EXPEL): it goes to its owner's
 * largest city, the capital counting 50 more.
 */
export function expelAgent(world: World, target: Unit): City | null {
  let best = -1;
  let home: City | null = null;
  for (const c of world.cities) {
    if (c.owner !== target.owner) continue;
    const v = c.size + (c.improvements[IMPROVEMENT.palace] ? 50 : 0);
    if (best < v) {
      best = v;
      home = c;
    }
  }
  if (home) {
    target.position = { x: home.position.x, y: home.position.y };
    target.order = null;
    target.gotoTarget = null;
  }
  return home;
}
