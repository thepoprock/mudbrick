import type { EventActions, ScenarioEvent, TribeRef, UnitRef } from '@mudbrick/formats';
import { releaseCitySite } from './fertility.js';
import { grantAdvance } from './research.js';
import type { Rng } from './rng.js';
import { DOMAIN_AIR, DOMAIN_SEA, type EngineRules } from './rules.js';
import { lookAround } from './sight.js';
import { ORDER } from './terraform.js';
import type { Civ, Unit, World } from './world.js';
import { declareWar, setTreaty, TREATY, type DiplomacyContext } from './diplomacy.js';

/**
 * The scenario event runtime (VERIFIED against the original's evaluators 0x004c37dc …
 * 0x004c408b, the dispatcher 0x004c417e and the action routines 0x004c24d7 … 0x004c3382;
 * docs/engine/events.md). The records are the parsed events; the mutable part — which have
 * fired, and the attacker / defender / receiver a trigger wrote back over ANYBODY — is the
 * `EventState`, kept in the game state.
 */
export interface EventState {
  fired: boolean[];
  /** The slot a trigger wrote over an ANYBODY attacker, defender or receiver (−2 = still anybody). */
  attacker: number[];
  defender: number[];
  receiver: number[];
}

export type ScenarioEffect =
  | { kind: 'scenario-text'; lines: string[] }
  | { kind: 'scenario-sound'; file: string }
  | { kind: 'scenario-track'; track: number }
  | { kind: 'scenario-note'; text: string };

export interface EventContext {
  /** Run the consequences of an advance just granted (Game.advanceGained). */
  advanceGained?: (civ: Civ, advance: number) => void;
  turn: number;
  rng: Rng;
  isHuman: (slot: number) => boolean;
  inPlay: (slot: number) => boolean;
  knows: (slot: number, advance: number) => boolean;
  /** A civilization loses its cities and units, then dies (restarting when the rules allow). */
  destroyCivilization: (slot: number) => void;
  /** Re-check for civilizations left without a city (after a terrain change). */
  eliminateCityless: () => void;
  /** Wonder movies off (DONTPLAYWONDERS). */
  dontPlayWonders: () => void;
  /** The diplomacy context, for MAKEAGGRESSION's declaration of war (0x00526d80). */
  diplomacy?: DiplomacyContext;
}

export function newEventState(events: ScenarioEvent[]): EventState {
  const n = events.length;
  return {
    fired: Array<boolean>(n).fill(false),
    attacker: Array<number>(n).fill(-2),
    defender: Array<number>(n).fill(-2),
    receiver: Array<number>(n).fill(-2),
  };
}

const ANYBODY = -2;

function slotOf(ref: TribeRef): number {
  return ref.kind === 'slot'
    ? ref.slot
    : ref.kind === 'anybody'
      ? ANYBODY
      : ref.kind === 'triggerAttacker'
        ? -3
        : -4;
}

/** The parser's codes with the trigger's attacker (−3) and defender / receiver (−4) read back. */
function resolve(ref: TribeRef, st: EventState, i: number): number {
  const v = slotOf(ref);
  if (v === -3) return st.attacker[i] ?? ANYBODY;
  if (v === -4) return st.defender[i] ?? ANYBODY;
  return v;
}

/** Match a stored trigger tribe against a slot; ANYBODY matches and is written over. */
function matchTribe(stored: number[], i: number, ref: TribeRef, slot: number): boolean {
  const have = stored[i] ?? slotOf(ref);
  if (have === ANYBODY) {
    stored[i] = slot;
    return true;
  }
  return have === slot;
}

function current(stored: number[], i: number, ref: TribeRef): number {
  return stored[i] ?? slotOf(ref);
}

export class ScenarioEvents {
  constructor(
    readonly world: World,
    readonly rules: EngineRules,
    readonly events: ScenarioEvent[],
    readonly state: EventState,
  ) {
    for (let i = 0; i < events.length; i++) {
      const t = events[i]?.trigger;
      if (!t) continue;
      if ('attacker' in t && state.attacker[i] === undefined)
        state.attacker[i] = slotOf(t.attacker);
      if ('defender' in t && state.defender[i] === undefined)
        state.defender[i] = slotOf(t.defender);
      if (t.kind === 'receivedTechnology' && state.receiver[i] === undefined)
        state.receiver[i] = slotOf(t.receiver);
      if (t.kind === 'negotiation') {
        state.attacker[i] = slotOf(t.talker);
        state.defender[i] = slotOf(t.listener);
      }
      if ('attacker' in t) state.attacker[i] = state.attacker[i] ?? slotOf(t.attacker);
      if ('defender' in t) state.defender[i] = state.defender[i] ?? slotOf(t.defender);
    }
  }

  /** The turn's commencement: TURN, TURNINTERVAL, RANDOMTURN, then RECEIVEDTECHNOLOGY (INFERRED order). */
  turnStart(ctx: EventContext): ScenarioEffect[] {
    const out: ScenarioEffect[] = [];
    this.events.forEach((e, i) => {
      if (e.trigger.kind === 'turn' && (e.trigger.turn === 'every' || e.trigger.turn === ctx.turn))
        out.push(...this.run(i, ctx));
    });
    this.events.forEach((e, i) => {
      const t = e.trigger;
      if (t.kind === 'turnInterval' && (t.interval === 0 || ctx.turn % t.interval === 0))
        out.push(...this.run(i, ctx));
    });
    this.events.forEach((e, i) => {
      const t = e.trigger;
      if (t.kind !== 'randomTurn') return;
      // VERIFIED: one chance in the denominator (a denominator below 2 always fires).
      const roll = t.denominator < 2 ? 1 : ctx.rng.nextInt(t.denominator) + 1;
      if (roll === t.denominator) out.push(...this.run(i, ctx));
    });
    this.events.forEach((e, i) => {
      const t = e.trigger;
      if (t.kind !== 'receivedTechnology') return;
      const r = current(this.state.receiver, i, t.receiver);
      if (r === ANYBODY) {
        // VERIFIED: every slot in play that knows the advance fires it, and the receiver is
        // written over each time — the event keeps firing every turn unless JUSTONCE.
        for (let s = 0; s < 8; s++) {
          if (!ctx.inPlay(s) || !ctx.knows(s, t.technology)) continue;
          this.state.receiver[i] = s;
          this.state.defender[i] = s;
          out.push(...this.run(i, ctx));
        }
      } else if (ctx.inPlay(r) && ctx.knows(r, t.technology)) {
        this.state.defender[i] = r;
        out.push(...this.run(i, ctx));
      }
    });
    return out;
  }

  scenarioLoaded(ctx: EventContext): ScenarioEffect[] {
    const out: ScenarioEffect[] = [];
    this.events.forEach((e, i) => {
      if (e.trigger.kind === 'scenarioLoaded') out.push(...this.run(i, ctx));
    });
    return out;
  }

  /** A unit of `type` owned by `defender` fell to `attacker`'s unit (0x004c3b6d). */
  unitKilled(
    type: number,
    attacker: number,
    defender: number,
    ctx: EventContext,
  ): ScenarioEffect[] {
    const out: ScenarioEffect[] = [];
    this.events.forEach((e, i) => {
      const t = e.trigger;
      if (t.kind !== 'unitKilled' || t.unit.kind !== 'type' || t.unit.type !== type) return;
      if (
        current(this.state.defender, i, t.defender) !== defender &&
        current(this.state.defender, i, t.defender) !== ANYBODY
      )
        return;
      if (
        current(this.state.attacker, i, t.attacker) !== attacker &&
        current(this.state.attacker, i, t.attacker) !== ANYBODY
      )
        return;
      matchTribe(this.state.attacker, i, t.attacker, attacker);
      matchTribe(this.state.defender, i, t.defender, defender);
      out.push(...this.run(i, ctx));
    });
    return out;
  }

  /** `city` changed hands from `defender` to `attacker` (0x004c408b). */
  cityTaken(city: string, attacker: number, defender: number, ctx: EventContext): ScenarioEffect[] {
    const out: ScenarioEffect[] = [];
    this.events.forEach((e, i) => {
      const t = e.trigger;
      if (t.kind !== 'cityTaken' || t.city.toUpperCase() !== city.toUpperCase()) return;
      const a = current(this.state.attacker, i, t.attacker);
      const d = current(this.state.defender, i, t.defender);
      if (a !== attacker && a !== ANYBODY) return;
      if (d !== defender && d !== ANYBODY) return;
      matchTribe(this.state.attacker, i, t.attacker, attacker);
      matchTribe(this.state.defender, i, t.defender, defender);
      out.push(...this.run(i, ctx));
    });
    return out;
  }

  /** May `defender`'s capital fall without a schism (0x004c3fdd)? False when an event matched. */
  noSchism(defender: number, ctx: EventContext, effects: ScenarioEffect[]): boolean {
    let matched = false;
    this.events.forEach((e, i) => {
      const t = e.trigger;
      if (t.kind !== 'noSchism') return;
      const d = current(this.state.defender, i, t.defender);
      if (d !== defender && d !== ANYBODY) return;
      effects.push(...this.run(i, ctx));
      matched = true;
    });
    return !matched;
  }

  /** May `talker` open negotiations with `listener` (0x004c3c54)? False when an event blocks it. */
  negotiationAllowed(
    talker: number,
    listener: number,
    ctx: EventContext,
    effects: ScenarioEffect[],
  ): boolean {
    for (let i = 0; i < this.events.length; i++) {
      const t = this.events[i]?.trigger;
      if (!t || t.kind !== 'negotiation') continue;
      const typeOk = (slot: number, type: number) =>
        ctx.isHuman(slot) ? type === 1 || type === 4 : type === 2 || type === 4;
      const tk = slotOf(t.talker);
      const ls = slotOf(t.listener);
      const talkerOk = (tk === talker || tk === ANYBODY) && typeOk(talker, t.talkerType);
      const listenerOk = (ls === listener || ls === ANYBODY) && typeOk(listener, t.listenerType);
      if (talkerOk && listenerOk) {
        effects.push(...this.run(i, ctx));
        return false;
      }
    }
    return true;
  }

  /** The dispatcher (0x004c417e): a JUSTONCE event fires once; the actions run in its order. */
  run(i: number, ctx: EventContext): ScenarioEffect[] {
    const e = this.events[i];
    if (!e) return [];
    const a = e.actions;
    if (a.justOnce && this.state.fired[i]) return [];
    const out: ScenarioEffect[] = [];
    if (a.playWaveFile !== undefined) out.push({ kind: 'scenario-sound', file: a.playWaveFile });
    if (a.playCdTrack !== undefined && a.playCdTrack >= 2)
      out.push({ kind: 'scenario-track', track: a.playCdTrack });
    if (a.createUnit) this.createUnit(i, a, ctx, out);
    if (a.moveUnit) this.moveUnit(i, a, ctx, out);
    if (a.changeTerrain) this.changeTerrain(a, ctx, out);
    if (a.makeAggression) {
      const who = resolve(a.makeAggression.who, this.state, i);
      const whom = resolve(a.makeAggression.whom, this.state, i);
      if (who >= 1 && who <= 7 && whom >= 1 && whom <= 7 && ctx.inPlay(who) && ctx.inPlay(whom)) {
        if (ctx.diplomacy) declareWar(this.world, who, whom, ctx.diplomacy, []);
        else setTreaty(this.world, who, whom, TREATY.war);
        out.push({ kind: 'scenario-note', text: `war: ${who} on ${whom}` });
      }
    }
    if (a.changeMoney) {
      const r = resolve(a.changeMoney.receiver, this.state, i);
      const civ = this.world.civs.find((c) => c.slot === r);
      if (civ && r >= 1 && r <= 7 && ctx.inPlay(r)) {
        const sum = civ.treasury + a.changeMoney.amount;
        civ.treasury = sum < 0 ? 0 : sum > 30000 ? 30000 : sum;
      }
    }
    if (a.destroyACivilization) {
      const w = resolve(a.destroyACivilization.whom, this.state, i);
      if (w >= 1 && w <= 7 && ctx.inPlay(w)) ctx.destroyCivilization(w);
    }
    if (a.giveTechnology) {
      const r = resolve(a.giveTechnology.receiver, this.state, i);
      const civ = this.world.civs.find((c) => c.slot === r);
      if (
        civ &&
        r >= 1 &&
        r <= 7 &&
        ctx.inPlay(r) &&
        !civ.knownAdvances[a.giveTechnology.technology]
      ) {
        grantAdvance(civ, a.giveTechnology.technology, 'other');
        ctx.advanceGained?.(civ, a.giveTechnology.technology);
      }
    }
    if (a.text) out.push({ kind: 'scenario-text', lines: a.text });
    if (a.dontPlayWonders) ctx.dontPlayWonders();
    if (a.justOnce) this.state.fired[i] = true;
    return out;
  }

  /** CREATEUNIT (0x004c2ca4): the first location that will take the unit. */
  private createUnit(i: number, a: EventActions, ctx: EventContext, out: ScenarioEffect[]): void {
    const cu = a.createUnit;
    if (!cu) return;
    const owner = resolve(cu.owner, this.state, i);
    if (owner < 0 || owner > 7 || !ctx.inPlay(owner)) return;
    const type = this.rules.units[cu.unit];
    if (!type) return;
    const w = this.world;
    for (const p of cu.locations) {
      if (!w.isSquare(p.x, p.y)) continue;
      const ocean = !w.isLand(p.x, p.y);
      const city = w.cityAt(p.x, p.y);
      const occupant = w.unitsAt(p.x, p.y)[0];
      if (type.domain === DOMAIN_SEA) {
        // A sea unit needs ocean or a coastal city (the city record's coastal flag, INFERRED
        // as any city on the shore here).
        if (!ocean && !(city && w.neighbours(p.x, p.y).some((n) => n && !w.isLand(n.x, n.y))))
          continue;
      } else {
        if (ocean && type.domain !== DOMAIN_AIR) continue;
        if (city && city.owner !== owner) continue;
        if (occupant && occupant.owner !== owner) continue;
      }
      const unit: Unit = {
        id: w.units.reduce((m, u) => Math.max(m, u.id), -1) + 1,
        position: { x: p.x, y: p.y },
        owner,
        type: cu.unit,
        veteran: cu.veteran,
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
      const home = w.cities.find((c) => c.name.toUpperCase() === cu.homeCity.toUpperCase());
      if (home && home.owner === owner) unit.homeCity = home.id;
      w.units.push(unit);
      lookAround(w, this.rules, unit); // INFERRED: the original's unit creator looks around
      out.push({
        kind: 'scenario-note',
        text: `${type.name} created for ${owner} at ${p.x},${p.y}`,
      });
      return;
    }
  }

  /**
   * MOVEUNIT (0x004c306f): a computer owner's units of the type (or any) inside the rectangle
   * — not nuclear, not under a work or go-to order (the original lets fortified and sentried
   * units go, whatever its help says) — get a go-to to the square, up to the number (ALL = all),
   * scanning from the last unit down.
   */
  private moveUnit(i: number, a: EventActions, ctx: EventContext, out: ScenarioEffect[]): void {
    const mu = a.moveUnit;
    if (!mu) return;
    const owner = resolve(mu.owner, this.state, i);
    if (owner < 0 || owner > 7 || !ctx.inPlay(owner) || ctx.isHuman(owner)) return;
    const [c1, c2, c3, c4] = mu.rect;
    let moved = 0;
    for (let k = this.world.units.length - 1; k >= 0; k--) {
      const u = this.world.units[k];
      if (!u || u.owner !== owner) continue;
      if (mu.unit.kind === 'type' && u.type !== mu.unit.type) continue;
      const type = this.rules.units[u.type];
      if (!type || type.attack > 98) continue;
      if (u.order !== null && (u.order === ORDER.fortress || u.order > ORDER.fortress)) continue;
      const { x, y } = u.position;
      if (x < c1.x || x > c2.x || x > c3.x || x < c4.x) continue;
      if (y < c1.y || y < c2.y || y > c3.y || y > c4.y) continue;
      u.order = ORDER.goTo;
      u.gotoTarget = { x: mu.moveTo.x, y: mu.moveTo.y };
      moved += 1;
      if (mu.numberToMove !== -2 && moved >= mu.numberToMove) break;
    }
    if (moved > 0)
      out.push({
        kind: 'scenario-note',
        text: `${moved} unit(s) of ${owner} sent to ${mu.moveTo.x},${mu.moveTo.y}`,
      });
  }

  /**
   * CHANGETERRAIN (0x004c3382): every square from the first corner's column to the second's and
   * from the first corner's row to the fourth's loses its city and units, takes the terrain
   * with every improvement, river and special cleared, and is revealed to all; a civilization
   * left without a city dies.
   */
  private changeTerrain(a: EventActions, ctx: EventContext, out: ScenarioEffect[]): void {
    const ct = a.changeTerrain;
    if (!ct) return;
    const [c1, c2, , c4] = ct.rect;
    const w = this.world;
    let count = 0;
    for (let x = c1.x; x <= c2.x; x++) {
      for (let y = c1.y; y <= c4.y; y++) {
        if (!w.isSquare(x, y)) continue;
        const city = w.cityAt(x, y);
        if (city) {
          releaseCitySite(w, city);
          w.cities.splice(w.cities.indexOf(city), 1);
        }
        for (const u of [...w.unitsAt(x, y)]) w.units.splice(w.units.indexOf(u), 1);
        const idx = w.index(x, y);
        w.terrain[idx] = ct.terrain;
        w.flags[idx] = 0;
        w.territory[idx] = 0;
        for (let s = 1; s < 8; s++) w.reveal(x, y, s);
        count += 1;
      }
    }
    if (count > 0)
      out.push({
        kind: 'scenario-note',
        text: `${count} square(s) changed to terrain ${ct.terrain}`,
      });
    ctx.eliminateCityless();
  }
}

export type { ScenarioEvent, EventActions, TribeRef, UnitRef };
