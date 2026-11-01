/**
 * Talking with a computer player: the assessment (0x00440b9e), the conversation (0x00449c70), the
 * human's menu (0x00449960) and what each entry does (0x00445022, 0x004478c6, 0x00448bf8), and the
 * technology exchange (0x00443055, 0x00442d14).
 *
 * The conversation is a generator. Each yield is one dialog, named by its GAME.TXT section, and
 * the answer sent back is the chosen entry, 0-based. This keeps the rules free of any UI.
 *
 * Specification: docs/engine/negotiation.md. VERIFIED from those routines unless marked. The
 * scenario-only branches and the multiplayer messages are not ported.
 */
import { advanceIndex, IMPROVEMENT, type EngineRules } from './rules.js';
import {
  adjustAttitude,
  attitude,
  attitudesOf,
  civOf,
  clearTreaty,
  setTreaty,
  treatiesOf,
  TREATY,
} from './diplomacy.js';
import type { Rng } from './rng.js';
import { gridDistance } from './city.js';
import { SquareFlag, type City, type Civ, type Unit, type World } from './world.js';

/** Unit type 45, Nuclear Missile: the count the original keeps at civilization +0x105. */
const NUCLEAR_MISSILE = 45;
const NO_DEAL = 999;
const NOT_NUCLEAR_SHARED = 1 << 8;
const ALLY_WAR_PENDING_DONE = 1 << 20;
const BETRAYAL = 1 << 5;
const CLEAR = 1 << 18;
/** Set on leaving in a huff; the next visit is refused (0x00449c70 tests bit 21). */
const SENT_AWAY = 1 << 21;
const ANNOYED = 1 << 22;
const TALKED = 1 << 23;

export interface NegotiationEnv {
  world: World;
  rules: EngineRules;
  rng: Rng;
  turn: number;
  difficulty: number;
  bloodlust: boolean;
  /** 0 to 7 per slot, 7 strongest (0x00465607, `powerRanks`). */
  rank: (slot: number) => number;
  ownsWonder: (slot: number, improvement: number) => boolean;
  knows: (slot: number, advance: number) => boolean;
  /** Give an advance through the one routine (research.ts plus Game.advanceGained). */
  gain: (civ: Civ, advance: number, from: number) => void;
  advanceValue: (slot: number, advance: number) => number;
  spaceRace: (slot: number) => boolean;
  /** Has this civilization launched (0x00480857)? */
  launched: (slot: number) => boolean;
  unitsOn: (slot: number, mass: number) => number;
  attackOn: (slot: number, mass: number) => number;
  planOn: (slot: number, mass: number) => number;
  power: (slot: number) => number;
  leaderAttack: (slot: number) => number;
  leaderCivilize: (slot: number) => number;
  leaderExpand: (slot: number) => number;
}

export interface Dialog {
  /** GAME.TXT section. */
  key: string;
  strings?: Record<number, string>;
  numbers?: Record<number, number>;
  /** Indices of the section's entries to offer; absent means all. */
  offer?: number[];
  /** Gold amounts to pick from, for MONEYGIFT. */
  amounts?: number[];
  /** Civilizations to pick from, for MUSTATTACK. */
  civs?: number[];
  /** The civilization speaking: the UI shows its leader. */
  speaker?: number;
  /** Replaces the section's own text. */
  title?: string;
  /** A list to pick from: the answer is the entry's `value`, or −1 to cancel. */
  pick?: { label: string; value: number }[];
}

/** One answer per dialog. */
export type Conversation = Generator<Dialog, void, number>;

/** Attitude bands (0x0044dfde). */
export function attitudeBand(a: number): number {
  if (a < 0) return 0;
  if (a < 11) return 1;
  if (a < 26) return 2;
  if (a < 39) return 3;
  if (a < 62) return 4;
  if (a < 75) return 5;
  if (a < 90) return 6;
  if (a < 100) return 7;
  return 8;
}

/** How much attitude a sum of gold buys (0x00444fba). */
export function goldGoodwill(gold: number): number {
  let total = 0;
  let divisor = 10;
  let step = 50;
  let left = gold;
  while (left > 0) {
    total += Math.trunc(Math.min(left, step) / divisor);
    divisor += 5;
    left -= step;
    step = 100;
  }
  return total;
}

/** The power ranking (0x00465607): 7 for the strongest civilization in play, down from there. */
export function powerScores(world: World, population: (slot: number) => number): number[] {
  const score = Array<number>(8).fill(0);
  for (const c of world.civs) {
    if (c.slot < 1 || c.slot > 7 || !c.inPlay) continue;
    score[c.slot] = c.advancesCount * 3 + population(c.slot) * 8 + (c.treasury >> 5);
  }
  return score;
}

export function powerRanks(world: World, population: (slot: number) => number): number[] {
  const score = powerScores(world, population);
  const ranks = Array<number>(8).fill(0);
  for (let place = 1; place < 8; place++) {
    let best = -1;
    let who = 0;
    for (let s = 1; s < 8; s++) {
      if ((score[s] ?? 0) > best) {
        best = score[s] ?? 0;
        who = s;
      }
    }
    ranks[who] = 8 - place;
    score[who] = -1;
  }
  return ranks;
}

export interface Assessment {
  tribute: number;
  hostile: boolean;
  wasHostile: boolean;
  fear: number;
  mood: number;
  stance: number;
  restraint: number;
  leader: boolean;
  betrayal: boolean;
  spaceRace: boolean;
  outranked: boolean;
  exposed: number;
  ceded: number;
  enemyAlly: number;
  strongestEnemy: number;
  weakestEnemy: number;
  lastTalk: number;
  ask: number;
  ask2: number;
  offer: number;
  firstHostile: boolean;
}

/** Everything both sides of the conversation read. */
export class Talk {
  readonly h: Civ;
  readonly c: Civ;
  a: Assessment;
  giftRound = 0;
  /** The emissary has been announced (0x005b1928) and turned away (0x005b192c = −1). */
  met = false;
  refused = false;
  /** 0x005b1914 is clear only during the first assessment of a conversation. */
  firstPass = true;
  /** The talk ended without counting as a talk (the original's bVar9). */
  quiet = false;
  /** A payment or gift closed the matter: the rest of the round's talks are used up. */
  settled = false;
  /** Bit 22 stood when the talk began: the computer will not press it again. */
  annoyed = false;
  constructor(
    readonly env: NegotiationEnv,
    readonly hs: number,
    readonly cs: number,
    readonly calledByHuman: boolean,
  ) {
    const h = civOf(env.world, hs);
    const c = civOf(env.world, cs);
    if (!h || !c) throw new Error('negotiation needs two civilizations');
    this.h = h;
    this.c = c;
    this.a = {
      tribute: 0,
      hostile: false,
      wasHostile: false,
      fear: 0,
      mood: 0,
      stance: 1,
      restraint: 0,
      leader: false,
      betrayal: false,
      spaceRace: false,
      outranked: false,
      exposed: 0,
      ceded: 0,
      enemyAlly: -1,
      strongestEnemy: -1,
      weakestEnemy: -1,
      lastTalk: 0,
      ask: -1,
      ask2: -1,
      offer: -1,
      firstHostile: false,
    };
  }
  word(a: Civ, b: number): number {
    return treatiesOf(a)[b] ?? 0;
  }
  /** The computer's treaty word toward the human, the one the routines read most. */
  get cw(): number {
    return this.word(this.c, this.hs);
  }
  get hw(): number {
    return this.word(this.h, this.cs);
  }
  get allied(): boolean {
    return (this.cw & TREATY.alliance) !== 0;
  }
  get atPeace(): boolean {
    return (this.cw & TREATY.peace) !== 0;
  }
  get vendetta(): boolean {
    return (this.cw & TREATY.vendetta) !== 0;
  }
  get atWar(): boolean {
    return (this.cw & TREATY.war) !== 0;
  }
  /** The human's reputation less what this computer player has forgiven. */
  get gap(): number {
    return (this.h.reputation ?? 0) - (this.c.pardons?.[this.hs] ?? 0);
  }
  get talks(): number {
    return this.c.talks ?? 0;
  }
  set talks(n: number) {
    this.c.talks = n;
  }
  rankOf(s: number): number {
    return this.env.rank(s);
  }
  nukes(civ: Civ): number {
    return this.env.world.units.filter((u) => u.owner === civ.slot && u.type === NUCLEAR_MISSILE)
      .length;
  }
  shielded(slot: number): boolean {
    return (
      this.env.ownsWonder(slot, IMPROVEMENT.greatWall) ||
      this.env.ownsWonder(slot, IMPROVEMENT.unitedNations)
    );
  }
  /** Conversation limit (0x00440acb). */
  limit(): number {
    let n = this.a.mood < 25 ? 3 : 2;
    if (this.a.mood > 60) n -= 1;
    if (this.env.ownsWonder(this.hs, IMPROVEMENT.eiffelTower)) n += 1;
    if (this.atPeace) n += 1;
    if (this.allied) n += 2;
    if (this.atWar) n = 2;
    return n;
  }
  pay(from: Civ, to: Civ, gold: number): void {
    from.treasury -= gold;
    to.treasury += gold;
  }
  sign(flags: number): void {
    setTreaty(this.env.world, this.cs, this.hs, flags);
  }
  warm(delta: number): void {
    adjustAttitude(this.env.world, this.cs, this.hs, delta);
  }
  lastTalkNow(offset = 0): void {
    this.lastWar()[this.cs] = this.env.turn + offset;
  }
  lastWar(): Int16Array {
    this.h.lastWarTurns ??= new Int16Array(8);
    return this.h.lastWarTurns;
  }
  name(c: Civ): string {
    return c.name;
  }

  /** The emissary's announcement (0x00442942). True once the human has received them. */
  *meet(): Generator<Dialog, boolean, number> {
    if (this.calledByHuman) return true;
    if (this.met) return !this.refused;
    this.met = true;
    const answer = yield {
      key: 'EMISSARY',
      strings: { 1: '', 2: this.c.leader, 3: this.c.name, 4: this.c.leader },
    };
    this.refused = answer === 1;
    if (this.refused) return false;
    const { env, h, c, cs } = this;
    // The audience opens (0x004425fa): a greeting, and a word about either side's missiles.
    yield {
      key: `GREETINGS${this.vendetta ? 1 : 0}${env.rng.nextInt(4)}`,
      strings: { 1: c.leader, 3: c.name, 6: h.name },
    };
    if (this.nukes(c) !== 0) yield { key: 'NUCLEARWEAPONS' };
    if (this.nukes(h) !== 0 && (this.hw & (0x100 | TREATY.peace)) !== 0x100) {
      yield { key: `YOURNUKES${this.nukes(c) === 0 ? 1 : 2}` };
      treatiesOf(h)[cs] = this.hw | 0x100;
    }
    return true;
  }

  assess(): void {
    const { env, h, c, hs, cs } = this;
    const a = this.a;
    const turn = env.turn;
    const difficulty = env.difficulty;
    const nukesH = this.nukes(h);
    const nukesC = this.nukes(c);
    const rep = h.reputation ?? 0;
    a.spaceRace = env.spaceRace(cs);
    let enemies = 0;
    for (let s = 1; s < 8; s++) {
      const civ = civOf(env.world, s);
      if (((this.word(h, s) >> 8) & 0x20) !== 0) enemies += 1;
      if (civ?.isHuman && env.launched(s) && difficulty > 3) a.spaceRace = true;
    }
    a.outranked = this.rankOf(hs) < this.rankOf(cs);
    a.firstHostile = false;
    a.wasHostile = false;
    a.lastTalk = this.lastWar()[cs] ?? 0;
    let fear = 0;
    let tribute = 0;
    let hostile = false;
    let stance = 1;
    const citiesC = env.world.cities.filter((x) => x.owner === cs).length;
    const citiesH = env.world.cities.filter((x) => x.owner === hs).length;
    for (let m = 1; m < 64; m++) {
      const unitsC = env.unitsOn(cs, m);
      const unitsH = env.unitsOn(hs, m);
      const attackH = env.attackOn(hs, m);
      const attackC = env.attackOn(cs, m);
      const planC = env.planOn(cs, m);
      const planH = env.planOn(hs, m);
      if ((citiesC > 1 ? 1 : 0) < planC && unitsC < attackH) {
        fear += Math.trunc((attackH * (difficulty === 0 ? 4 : 2)) / (unitsC + 1));
        continue;
      }
      if (unitsC !== 0 && unitsH !== 0) hostile = true;
      if (planH === 0) {
        if (planC === 0) tribute += Math.trunc((attackC - attackH) / 4);
        else tribute += Math.trunc((unitsC - attackH) / 2);
      } else if (
        planC < 2 &&
        (turn <= 200 - 50 * enemies || this.rankOf(hs) > 6 || this.rankOf(cs) > 6)
      ) {
        tribute += attackC;
      } else {
        tribute += attackC - attackH;
      }
    }
    if (env.ownsWonder(cs, IMPROVEMENT.marcoPolo)) tribute += tribute >> 2;
    a.leader =
      this.rankOf(hs) === 7 &&
      citiesH > 4 &&
      citiesC > 1 &&
      nukesH === 0 &&
      difficulty !== 0 &&
      turn > 200;
    let mood = attitude(env.world, cs, hs);
    if ((a.leader || (this.vendetta && env.power(hs) < env.power(cs) * 3)) && nukesH === 0) {
      tribute = Math.max(tribute, this.rankOf(cs) * 2);
      if (!hostile)
        tribute = Math.min(
          Math.max(tribute, 0),
          Math.trunc(Math.trunc(h.treasury / 50) / (8 - this.rankOf(cs))),
        );
      hostile = true;
      fear = 0;
      if (mood < 76) mood = 75;
    }
    if (a.spaceRace && a.outranked) hostile = true;
    if (nukesC !== 0) {
      treatiesOf(c)[hs] = this.cw | NOT_NUCLEAR_SHARED;
      if (nukesH === 0) {
        hostile = true;
        tribute = Math.max(tribute, 100);
      }
    }
    if (nukesH !== 0 && !this.allied) {
      if (nukesC === 0) {
        fear = Math.max((rep >> 1) + 1, 4);
      } else {
        tribute = Math.trunc((nukesC * Math.trunc(tribute / 2)) / nukesH);
      }
    }
    fear = Math.trunc(fear / (Math.trunc((rep - 1) / 2) + 1));
    if (this.allied) mood -= 25;
    if ((this.cw & TREATY.war) !== 0) mood += 25;
    if (rep !== 0) mood += (rep - 1 - (c.pardons?.[hs] ?? 0)) * 5;
    if (mood < 26) {
      tribute = Math.trunc(tribute / 2);
      hostile = false;
    } else if (attitudeBand(mood) < 4) {
      tribute = Math.trunc((tribute * 2) / 3);
    } else if (mood > 74) {
      tribute = Math.trunc((tribute * 3) / 2);
      hostile = true;
    }
    if ((this.cw & TREATY.grudge) !== 0) hostile = true;
    if (env.bloodlust && c.scienceRate === 0) hostile = true;
    if (fear !== 0) {
      hostile = false;
      stance = 0;
    }
    if (this.shielded(hs)) {
      a.leader = false;
      a.wasHostile = hostile;
      hostile = false;
      mood -= 10;
      clearTreaty(env.world, cs, hs, TREATY.allyWarPending);
    }
    if (rep !== 0) tribute += Math.trunc((rep * tribute) / 2);
    if (this.vendetta) tribute *= 2;
    else if ((this.cw & TREATY.allyWarPending) !== 0) tribute >>= 2;
    a.exposed = 0;
    for (const city of env.world.cities) {
      if (city.owner !== hs) continue;
      const defended = env.world.units.some(
        (u) => u.position.x === city.position.x && u.position.y === city.position.y,
      );
      if (defended) continue;
      const near = env.world.units.some(
        (u) => u.owner === cs && gridDistance(env.world, u.position, city.position) < 3,
      );
      if (near) {
        tribute *= 2;
        a.exposed = 1;
        break;
      }
    }
    tribute = Math.min(20, Math.max(0, ((difficulty + 1) * tribute) >> 5)) * 50;
    if (tribute > h.treasury && tribute < h.treasury * 2 && h.treasury >= 50)
      tribute = Math.trunc(h.treasury / 50) * 50;
    if (tribute === 0 || env.power(cs) * 3 < env.power(hs)) hostile = false;
    if (hostile) stance = 2;
    else if (this.allied) stance = 0;
    a.firstHostile = hostile;

    let restraint = this.vendetta ? -2 : 0;
    if (env.bloodlust && c.scienceRate === 0) restraint -= 1;
    if (rep !== 0) restraint -= Math.trunc((rep - 1) / 2);
    a.strongestEnemy = -1;
    a.weakestEnemy = -1;
    a.enemyAlly = -1;
    let strongest = 0;
    let weakest = 9999;
    let grudges = 0;
    for (let s = 1; s < 8; s++) {
      if (s === hs || s === cs) continue;
      const toThird = this.word(c, s);
      const humanToThird = this.word(h, s);
      if ((toThird & TREATY.alliance) !== 0) {
        if (this.rankOf(cs) < this.rankOf(hs)) restraint -= 1;
        if (
          this.rankOf(hs) === 7 &&
          citiesH > 4 &&
          turn > 200 &&
          difficulty !== 0 &&
          (this.word(civOf(env.world, s) ?? h, hs) & TREATY.contact) !== 0
        ) {
          if (fear === 0) {
            if ((this.word(civOf(env.world, s) ?? h, hs) & TREATY.war) !== 0 && !this.shielded(hs))
              hostile = true;
          } else {
            fear = Math.max(0, Math.min(99, fear - 4));
          }
        }
      }
      if ((toThird & TREATY.grudge) !== 0) grudges += 1;
      const third = civOf(env.world, s);
      const atWarWithThird =
        (toThird & TREATY.war) !== 0 ||
        ((toThird & (TREATY.alliance | TREATY.peace)) === 0 &&
          (toThird & TREATY.contact) !== 0 &&
          attitude(env.world, cs, s) > 49);
      if (third && atWarWithThird) {
        if (env.power(cs) < env.power(s) * 4) restraint += 1;
        if (env.power(cs) < env.power(s)) restraint += 1;
        if ((humanToThird & TREATY.contact) !== 0 && (humanToThird & TREATY.war) === 0)
          a.enemyAlly = s;
        if ((toThird & TREATY.war) !== 0 && (toThird & TREATY.attacked) !== 0) {
          if (strongest < env.power(s)) {
            strongest = env.power(s);
            a.strongestEnemy = s;
          }
          if (env.power(s) < weakest) {
            weakest = env.power(s);
            a.weakestEnemy = s;
          }
        }
      }
    }
    if (grudges === 0) clearTreaty(env.world, cs, hs, ALLY_WAR_PENDING_DONE);
    restraint -= env.leaderAttack(cs);
    if (env.power(hs) < env.power(cs)) restraint -= 1;
    const atWarAttitude =
      this.atWar ||
      ((this.cw & (TREATY.alliance | TREATY.peace)) === 0 &&
        (this.cw & TREATY.contact) !== 0 &&
        attitude(env.world, cs, hs) > 49);
    if (
      (atWarAttitude ? 1 : 0) < restraint &&
      !a.leader &&
      (this.cw & (TREATY.grudge | TREATY.alliance)) === 0
    ) {
      hostile = false;
      if (((turn + cs + hs) & 32) !== 0) tribute = 0;
    }
    a.ceded = env.world.cities.filter((x) => x.previousOwner === cs && x.owner === hs).length;
    const noWar = !this.atWar || a.ceded > 4;
    a.betrayal =
      (this.firstPass || this.gap > 6) &&
      noWar &&
      !this.allied &&
      (hostile ||
        (a.spaceRace && difficulty > 2) ||
        (a.wasHostile && this.gap > 6 && this.vendetta)) &&
      (env.power(cs) < env.power(hs) || this.vendetta || this.gap > 6);
    if (a.betrayal) {
      hostile = false;
      stance = 0;
      if (mood > 29) mood = 30;
    }
    // A computer senate backs a hostile leader down from a much stronger human (end of 0x00440b9e).
    a.mood = mood;
    if (
      this.firstPass &&
      this.talks < this.limit() &&
      c.government > 4 &&
      hostile &&
      (this.cw & (TREATY.alliance | ANNOYED)) === 0 &&
      env.power(cs) * 2 < env.power(hs) * 3 &&
      !a.leader &&
      !this.vendetta
    ) {
      hostile = false;
    }
    if (fear === 0 && mood < 2) mood = 1;
    if (!((this.hw & TREATY.war) !== 0) && mood > 98) mood = 99;
    if (((this.hw & TREATY.alliance) !== 0 || stance === 0) && mood > 73) mood = 74;
    if ((this.hw & TREATY.war) !== 0 && mood < 27) mood = 26;
    a.tribute = tribute;
    a.hostile = hostile;
    a.fear = fear;
    a.mood = mood;
    a.stance = stance;
    a.restraint = restraint;
  }

  /** The advances worth trading (the first half of 0x00443055). */
  pickTrades(): { hKnows: number; cKnows: number; bestAsk: number; secondAsk: number } {
    const { env, hs, cs } = this;
    const a = this.a;
    a.ask = -1;
    a.ask2 = -1;
    a.offer = -1;
    let bestAsk = 0;
    let secondAsk = 0;
    let bestOffer = 0;
    let hKnows = 0;
    let cKnows = 0;
    for (let i = 0; i < 100; i++) {
      const r = env.rules.advances[i];
      if (!r || (r.preq1.kind === 'never' && r.preq2.kind === 'never')) continue;
      const he = env.knows(hs, i);
      const ce = env.knows(cs, i);
      if (he) hKnows += 1;
      if (ce) {
        cKnows += 1;
        if (!he) {
          const v = env.advanceValue(hs, i);
          if (bestOffer <= v) {
            a.offer = i;
            bestOffer = v;
          }
        }
      }
      if (he && !ce) {
        const v = env.advanceValue(cs, i);
        if (v < bestAsk) {
          if (secondAsk <= v) {
            a.ask2 = i;
            secondAsk = v;
          }
        } else {
          if (a.ask >= 0) {
            a.ask2 = a.ask;
            secondAsk = bestAsk;
          }
          a.ask = i;
          bestAsk = v;
        }
      }
    }
    return { hKnows, cKnows, bestAsk, secondAsk };
  }

  *sellTech(mode: number): Generator<Dialog, boolean, number> {
    const { env, h, cs, hs } = this;
    const a = this.a;
    if (a.offer < 0) return false;
    let price = env.advanceValue(cs, a.offer) * 20;
    if (a.mood > 50) price = Math.trunc((price * a.mood) / 50);
    if (this.rankOf(hs) === 7 && this.citiesOf(hs) > 4 && env.turn > 200 && env.difficulty !== 0)
      price *= 2;
    let knowers = 0;
    for (const c of env.world.civs)
      if (c.slot >= 1 && c.slot <= 7 && c.knownAdvances[a.offer]) knowers += 1;
    price = Math.trunc(price / Math.max(1, knowers - 1)) * 10;
    if (h.treasury > 1500) price = Math.trunc((price * 3) / 2);
    if (h.treasury > 3000) price = Math.trunc((price * 3) / 2);
    if ((this.hw & TREATY.alliance) !== 0) {
      if (h.advancesCount < this.c.advancesCount) price = Math.trunc(price / 2);
      else price -= price >> 2;
      if (h.advancesCount + 4 < this.c.advancesCount) price = Math.trunc(price / 2);
    }
    if (price < 0) price = 30000;
    if (price < 100) price = 100;
    if (h.treasury < price) return false;
    const name = env.rules.advances[a.offer]?.name ?? '';
    const answer = yield {
      key: mode < 2 ? 'SELLTECH' : 'SELLTECH2',
      strings: { 1: name },
      numbers: { 0: price },
    };
    if (answer === 1) {
      h.treasury -= price;
      env.gain(h, a.offer, cs);
      this.assess();
    }
    return true;
  }

  citiesOf(slot: number): number {
    return this.env.world.cities.filter((c) => c.owner === slot).length;
  }

  /**
   * The exchange (0x00443055). `mode`: 0 the human asked, 1 the opening, 2 and 3 from an ally's
   * request. Returns true when something was said or given.
   */
  *exchange(mode: number): Generator<Dialog, boolean, number> {
    const { env, h, c, hs, cs } = this;
    const a = this.a;
    const allied = this.allied;
    for (;;) {
      const { hKnows, cKnows, bestAsk, secondAsk } = this.pickTrades();
      const leaderHere = this.rankOf(hs) === 7 && this.citiesOf(hs) > 4;
      if (!allied) {
        if (this.vendetta || (this.hw & TREATY.warDeclared) !== 0 || a.ceded !== 0) {
          if (mode === 0)
            yield { key: env.rng.nextInt(2) === 0 ? 'NOEXCHANGEMEDIUM' : 'NOEXCHANGEMAD' };
          return false;
        }
        if (
          (this.cw & TREATY.attacked) !== 0 ||
          (a.hostile && cKnows > 5) ||
          attitudeBand(a.mood) > 5
        ) {
          if (mode === 0)
            yield { key: env.rng.nextInt(2) === 0 ? 'NOEXCHANGEMEDIUM' : 'NOEXCHANGEMAD' };
          return false;
        }
      }
      if (hKnows < cKnows) {
        if (mode === 1) return false;
        if (attitudeBand(a.mood) > 5 - (this.atPeace ? 0 : 1) && !allied) {
          if (yield* this.sellTech(mode)) return true;
          if (mode === 0) yield { key: 'NOEXCHANGEMEDIUM' };
          return false;
        }
      }
      if (a.ask < 0 && a.offer >= 0 && allied) {
        const margin =
          h.advancesCount +
          6 -
          env.leaderCivilize(cs) -
          Math.min(5, Math.max(0, Math.trunc(c.advancesCount / 12)));
        if (margin < c.advancesCount && (this.talks < 2 || mode === 3)) {
          const name = env.rules.advances[a.offer]?.name ?? '';
          yield { key: mode < 2 ? 'EXCHANGEGIFT' : 'EXCHANGEGIFT2', strings: { 1: name } };
          env.gain(h, a.offer, cs);
          a.offer = -1;
          if (mode < 2) this.talks += 2;
          return true;
        }
      }
      if (a.offer < 0 || a.ask < 0) {
        if (mode !== 1) {
          if (yield* this.sellTech(mode)) return true;
          if (mode === 0) yield { key: 'NOEXCHANGENOW' };
        }
        return false;
      }
      if (mode > 1) return false;
      if (!(yield* this.meet())) return false;
      const yours = env.rules.advances[a.offer]?.name ?? '';
      const mine = env.rules.advances[a.ask]?.name ?? '';
      const other = a.ask2 >= 0 ? (env.rules.advances[a.ask2]?.name ?? '') : '';
      const offer: Dialog = {
        key: mode === 0 && !a.hostile && attitudeBand(a.mood) < 4 ? 'EXCHANGE1' : 'EXCHANGE0',
        strings: { 1: yours, 2: h.name, 3: mine, 4: other },
      };
      if (a.ask2 < 0 || a.ask2 === a.ask) offer.offer = [0, 1];
      const answer = yield offer;
      if (answer === 0) return true;
      let cost = bestAsk * 2;
      if (answer === 2) {
        if (
          env.knows(cs, a.ask2) ||
          env.ownsWonder(cs, IMPROVEMENT.marcoPolo) ||
          leaderHere ||
          (secondAsk < bestAsk && (hKnows < cKnows || attitudeBand(a.mood) > 4))
        ) {
          yield { key: 'EXCHANGEPETTY' };
          this.talks += 1;
          return true;
        }
        const t = a.ask;
        a.ask = a.ask2;
        a.ask2 = t;
        cost = secondAsk;
      }
      env.gain(c, a.ask, hs);
      env.gain(h, a.offer, cs);
      a.ask = a.ask2;
      a.ask2 = -1;
      this.warm(-cost);
      a.hostile = false;
      h.everExchanged = true;
      c.everExchanged = true;
      if (mode === 0) return true;
    }
  }

  /** The alliance, peace and cease-fire signings (0x0044407f, 0x004441f6, 0x004442f3). */
  *sign3(kind: 'alliance' | 'peace' | 'cease'): Generator<Dialog, void, number> {
    const { env, h, c, hs, cs } = this;
    if (kind === 'alliance') {
      this.warm(-25);
      this.sign(TREATY.alliance);
      h.everAllied = true;
      c.everAllied = true;
    } else if (kind === 'peace') {
      this.sign(TREATY.peace | TREATY.firstContact);
    } else {
      this.sign(TREATY.ceaseFire | TREATY.firstContact);
      clearTreaty(env.world, cs, hs, CLEAR);
    }
    if (kind !== 'alliance') {
      attitudesOf(c)[hs] = Math.min(50, attitude(env.world, cs, hs));
    }
    this.assess();
    if (kind !== 'cease') this.talks = 0;
    if (kind === 'alliance') this.a.betrayal = false;
    this.lastTalkNow();
    yield {
      key: kind === 'alliance' ? 'ALLIANCE' : kind === 'peace' ? 'TREATY' : 'CEASEFIRE',
      strings: { 1: c.name, 2: h.name },
    };
    if (kind === 'cease') {
      for (let s = 1; s < 8; s++) {
        const o = civOf(env.world, s);
        if (o) treatiesOf(o)[hs] = (treatiesOf(o)[hs] ?? 0) & ~TREATY.grudge;
      }
    }
  }

  /** Breaking with a third party at someone's request (0x004447be). */
  breakWith(breaker: Civ, third: number, witness: number): void {
    const { env } = this;
    const eiffel = env.ownsWonder(breaker.slot, IMPROVEMENT.eiffelTower);
    const towardThird = this.word(breaker, third);
    const rep = () => {
      if (env.difficulty !== 0 && !eiffel) breaker.reputation = (breaker.reputation ?? 0) + 1;
    };
    const w = civOf(env.world, witness);
    if (witness >= 0 && w) {
      w.pardons ??= new Int8Array(8);
      w.pardons[breaker.slot] = (w.pardons[breaker.slot] ?? 0) + 1;
    }
    if ((towardThird & TREATY.alliance) === 0) {
      if ((towardThird & (TREATY.peace | TREATY.ceaseFire)) === 0) {
        if (witness >= 0) adjustAttitude(env.world, witness, breaker.slot, -5);
      } else {
        rep();
        if (witness >= 0) adjustAttitude(env.world, witness, breaker.slot, -15);
      }
      setTreaty(env.world, breaker.slot, third, TREATY.war);
      return;
    }
    rep();
    if (witness >= 0) adjustAttitude(env.world, witness, breaker.slot, -25);
    clearTreaty(env.world, breaker.slot, third, TREATY.alliance);
  }

  /** The senate's veto test (0x0050f0ea). */
  senateBlocks(): boolean {
    const { h, c, env } = this;
    if (h.government < 5) return false;
    let need = (this.cw & TREATY.warDeclared) !== 0 ? 25 : 0;
    if (env.ownsWonder(this.hs, IMPROVEMENT.unitedNations)) need = 50;
    need = Math.min(75, Math.max(0, need + (c.reputation ?? 0) * 15));
    if ((h.patience ?? 0) < need) return false;
    if (h.government < 6) return h.senateActive === true;
    return true;
  }

  *warnHawks(): Generator<Dialog, void, number> {
    if (this.h.government < 5) return;
    yield {
      key: this.env.ownsWonder(this.hs, IMPROVEMENT.unitedNations) ? 'CONTINUEUN' : 'CONTINUEHAWKS',
      strings: { 1: this.c.name },
    };
  }
}

/**
 * The conversation with a computer player. `calledByHuman` is the original's fifth argument:
 * false when the computer's emissary arrives, true when the human asks for an audience.
 */
export function* conversation(
  env: NegotiationEnv,
  human: number,
  computer: number,
  calledByHuman: boolean,
): Conversation {
  const t = new Talk(env, human, computer, calledByHuman);
  if (!calledByHuman) t.talks = 0;
  t.assess();
  t.firstPass = false;
  yield* talk(t);
  finish(t);
}

function* talk(t: Talk): Generator<Dialog, void, number> {
  const { env, h, c, hs: human, cs: computer, calledByHuman } = t;
  const a = t.a;
  const hadCease = (t.cw & TREATY.ceaseFire) !== 0;
  const noContact = (t.cw & TREATY.contact) === 0;
  if (!calledByHuman) {
    t.lastWar()[computer] = env.turn;
    clearTreaty(env.world, human, computer, TREATY.techGiven | TREATY.ceaseFire);
  } else {
    if (t.talks < 0) t.talks = 0;
    if ((t.hw & TREATY.grudge) !== 0) t.talks = t.limit();
    if ((t.hw & TREATY.allyWarPending) !== 0) {
      t.talks = 0;
      clearTreaty(env.world, computer, human, SENT_AWAY);
    } else if (
      env.difficulty > 3 &&
      env.launched(computer) &&
      env.launched(human) &&
      (t.cw & TREATY.war) !== 0
    ) {
      setTreaty(env.world, computer, human, SENT_AWAY);
    }
    if ((t.cw & SENT_AWAY) !== 0) {
      t.quiet = true;
      yield { key: 'OUTAHERE' };
      return;
    }
    if (t.talks >= t.limit() && (t.hw & TALKED) !== 0) {
      t.quiet = true;
      yield { key: t.allied ? 'OUTAHEREALLY' : 'OUTAHERE' };
      return;
    }
  }
  setTreaty(env.world, human, computer, TALKED);
  t.annoyed = (t.cw & ANNOYED) !== 0;
  clearTreaty(env.world, computer, human, ANNOYED);
  yield* t.exchange(1);
  if (
    !a.hostile &&
    !calledByHuman &&
    (t.cw & (TREATY.ceaseFire | TREATY.peace)) !== 0 &&
    a.fear > 2
  )
    return;
  t.assess();

  let resolved = false;
  let bullied = false;
  let spoke = false;
  let brokeOff = false;
  if (a.enemyAlly > 0 && (a.stance !== 0 || t.allied) && (yield* t.meet())) {
    const answer = yield {
      key: `CANCELTREATY${(t.word(h, a.enemyAlly) & TREATY.alliance) !== 0 ? 0 : (t.word(h, a.enemyAlly) & TREATY.peace) !== 0 ? 1 : 2}`,
      strings: { 1: civOf(env.world, a.enemyAlly)?.name ?? '' },
    };
    if (answer === 0) {
      if (t.allied) {
        if (a.stance !== 0) t.warm(20);
        bullied = true;
      } else t.warm(5);
      t.talks += 1;
    } else {
      t.breakWith(h, a.enemyAlly, computer);
      brokeOff = true;
      a.hostile = false;
      a.enemyAlly = -1;
      if (t.allied) {
        a.tribute = 0;
        resolved = true;
      } else if (env.rng.nextInt(2) === 1) {
        a.tribute = 0;
        if (hadCease) t.sign(TREATY.ceaseFire);
      }
    }
    t.assess();
  }
  if ((t.hw & TREATY.alliance) !== 0) {
    if (t.gap > 4 && !resolved) bullied = true;
    if (a.ask >= 0) {
      const richer = h.treasury < c.treasury;
      const ahead = c.advancesCount < h.advancesCount;
      if (t.rankOf(computer) < t.rankOf(human) ? ahead || h.treasury < c.treasury : ahead && richer)
        a.tribute = 0;
    }
    if (a.spaceRace && a.outranked) {
      bullied = true;
      a.tribute = 0;
    }
  }
  if (
    a.tribute > 0 &&
    (a.stance === 2 || bullied) &&
    a.tribute <= h.treasury &&
    (yield* t.meet())
  ) {
    if (t.allied) a.tribute = Math.min(a.tribute, Math.max(100, Math.trunc(h.treasury / 2)));
    let variant = env.rng.nextInt(4);
    if (variant === 3 && env.power(computer) < env.power(human)) variant = 2;
    if (t.allied) variant = 9;
    const answer = yield {
      key: `TRIBUTE${variant}`,
      numbers: { 0: a.tribute },
      strings: { 3: c.name },
    };
    if (answer === 1) {
      t.pay(h, c, a.tribute);
      a.hostile = false;
      resolved = true;
      if (t.talks !== 0) t.talks -= 1;
      t.warm(-goldGoodwill(a.tribute));
      t.assess();
      if (hadCease) t.sign(TREATY.ceaseFire);
    }
    a.tribute = NO_DEAL;
  }
  if (t.allied && attitudeBand(a.mood) > 3) bullied = true;
  if ((a.stance !== 0 || bullied) && a.ask >= 0 && a.tribute !== NO_DEAL && (yield* t.meet())) {
    const answer = yield {
      key: `TAKECIV${t.allied ? 9 : env.rng.nextInt(2)}`,
      strings: { 1: env.rules.advances[a.ask]?.name ?? '', 3: c.name },
    };
    if (answer === 1) {
      const taken = a.ask;
      env.gain(c, taken, human);
      t.warm(-Math.trunc((env.advanceValue(computer, taken) * 3) / 2));
      a.ask = a.ask2;
      a.ask2 = -1;
      if (a.exposed === 0 || !a.hostile || a.ask < 0) resolved = true;
      else {
        const more = yield {
          key: 'OVERABARREL',
          strings: { 1: env.rules.advances[a.ask]?.name ?? '' },
        };
        if (more === 1) {
          env.gain(c, a.ask, human);
          t.warm(-Math.trunc((env.advanceValue(computer, a.ask) * 3) / 2));
          a.ask = -1;
          resolved = true;
        }
      }
      if (resolved) {
        a.hostile = false;
        if (hadCease) t.sign(TREATY.ceaseFire);
        if (t.talks !== 0) t.talks -= 1;
      }
    } else if (t.allied) {
      t.warm((h.reputation ?? 0) + 2 - (c.pardons?.[human] ?? 0));
      t.talks += 1;
    }
    t.assess();
    a.tribute = NO_DEAL;
  }
  if (t.allied && (a.hostile || a.mood > 49 || (a.spaceRace && a.outranked)) && !resolved) {
    yield* t.meet();
    yield { key: a.tribute === NO_DEAL ? 'BEGONE0' : 'BEGONE1' };
    clearTreaty(env.world, computer, human, TREATY.alliance);
    t.lastTalkNow();
    if (a.spaceRace && env.difficulty > 3) a.betrayal = true;
    return;
  }
  const holdFire = t.annoyed && a.hostile;
  if (holdFire) a.hostile = false;
  if (
    noContact &&
    !resolved &&
    a.tribute === NO_DEAL &&
    !a.hostile &&
    attitudeBand(a.mood) > (a.firstHostile ? 2 : 4) &&
    !t.shielded(human) &&
    c.government < 6 - env.rng.nextInt(2)
  ) {
    a.hostile = true;
  }
  const war = () => {
    t.sign(TREATY.war);
    if (attitude(env.world, computer, human) < 75) attitudesOf(c)[human] = 75;
    t.lastTalkNow();
  };
  if (
    a.hostile &&
    a.tribute > 50 &&
    (t.atPeace || (!t.atWar && a.lastTalk > 0 && (t.cw & TREATY.allyWarPending) === 0))
  ) {
    yield* t.meet();
    yield { key: `PROVOKE${env.rng.nextInt(2)}` };
    war();
    return;
  }
  if (a.hostile && a.tribute === NO_DEAL) {
    war();
    yield { key: 'REJECT0' };
    return;
  }
  if (a.hostile && (a.lastTalk < 0 || (t.cw & TREATY.allyWarPending) !== 0 || calledByHuman)) {
    yield* t.meet();
    war();
    yield { key: 'RID0' };
    return;
  }
  if (a.hostile) return;
  if (a.wasHostile && !t.allied && (yield* t.meet())) {
    yield { key: env.ownsWonder(human, IMPROVEMENT.greatWall) ? 'ACCURSEDWALL' : 'ACCURSEDUN' };
  }
  // Offers while at peace: an alliance.
  if (t.atPeace && !t.allied && !a.leader) {
    let allies = 0;
    for (let s = 1; s < 8; s++) if ((t.word(h, s) & TREATY.alliance) !== 0) allies += 1;
    const small = t.rankOf(human) < 6 && t.rankOf(computer) < 6;
    if (small && a.enemyAlly < 1 && env.turn > 200) {
      let best = 8;
      for (let s = 1; s < 8; s++) {
        if (s === computer || s === human) continue;
        const r = t.rankOf(s);
        if (r < t.rankOf(computer) || r < t.rankOf(human) || r > best) continue;
        const hws = t.word(h, s);
        if ((hws & TREATY.contact) === 0 || (hws & TREATY.war) !== 0) continue;
        if ((t.word(c, s) & (TREATY.war | TREATY.alliance)) !== 0) continue;
        a.enemyAlly = s;
        best = r;
      }
    }
    const pact = a.enemyAlly > 0 && (t.word(h, a.enemyAlly) & 0xe) !== 0;
    if (
      (a.fear !== 0 || small || pact) &&
      (a.restraint > 1 || small) &&
      allies === 0 &&
      (a.mood < 25 || (a.mood < 50 && pact)) &&
      (pact || small || brokeOff) &&
      t.gap < 4 &&
      (t.cw & TREATY.ceaseFire) === 0 &&
      a.ceded < 2 &&
      (t.rankOf(human) < 6 || t.rankOf(computer) < 5) &&
      (yield* t.meet())
    ) {
      const answer = yield { key: 'PROPOSEALLIANCE' };
      if (answer === 0) {
        let go = true;
        if (a.enemyAlly > 0) {
          go = false;
          const join = yield {
            key: 'PERHAPSSOLIDARITY',
            strings: { 4: civOf(env.world, a.enemyAlly)?.name ?? '' },
          };
          if (join === 1) {
            t.breakWith(h, a.enemyAlly, computer);
            a.enemyAlly = -1;
            go = true;
          } else {
            t.warm(10);
            t.assess();
            if (a.fear === 0 || t.gap > 2 || a.mood > 25) yield { key: 'PERHAPSDIDNTPROVE' };
            else go = true;
          }
        }
        if (go) yield* t.sign3('alliance');
        spoke = true;
      }
    }
  }
  // At war: a cease-fire.
  let refused = false;
  if (t.atWar && (yield* t.meet())) {
    const strings = { 1: c.name };
    let answer = yield {
      key: resolved ? 'GRANTCEASE' : !a.wasHostile && !holdFire ? 'PROPOSECEASE' : 'WALLCEASE',
      strings,
    };
    if (answer !== 0) {
      if (!t.shielded(human)) {
        if (t.senateBlocks()) {
          yield { key: 'OVERRULECEASE', strings };
          answer = 0;
          refused = true;
        } else yield* t.warnHawks();
      } else {
        yield {
          key: env.ownsWonder(human, IMPROVEMENT.greatWall) ? 'WALLOVERCEASE' : 'UNOVERCEASE',
          strings,
        };
        answer = 0;
        refused = true;
      }
    }
    let n = t.gap + 1;
    if (t.vendetta) n *= 2;
    if (answer !== 0 && (n < 2 ? 0 : env.rng.nextInt(n)) === 0) {
      if (a.fear > 3 && a.offer >= 0) {
        const name = env.rules.advances[a.offer]?.name ?? '';
        if ((yield { key: 'GIVECIV', strings: { 1: name } }) !== 0) {
          answer = 0;
          env.gain(h, a.offer, computer);
          t.settled = true;
        }
      }
      if (answer !== 0) {
        let gold = Math.min(Math.max(a.fear * 2 - 4, 0), Math.trunc(c.treasury / 50)) * 50;
        if (t.shielded(computer)) gold = Math.trunc(gold / 2);
        if (gold !== 0 && (yield { key: 'GIVECASH', numbers: { 0: gold } }) !== 0) {
          t.pay(c, h, gold);
          answer = 0;
          t.settled = true;
        }
      }
      if (answer !== 0 && a.fear !== 0 && t.citiesOf(computer) < 2 && !t.shielded(computer)) {
        if ((yield { key: 'GROVEL', numbers: { 0: c.treasury } }) !== 0) {
          answer = 0;
          t.pay(c, h, c.treasury);
          for (let i = 0; i < 100; i++) {
            const r = env.rules.advances[i];
            if (!r || (r.preq1.kind === 'never' && r.preq2.kind === 'never')) continue;
            if (env.knows(computer, i) && !env.knows(human, i)) env.gain(h, i, computer);
          }
          t.settled = true;
        }
      }
      if (answer === 0) a.lastTalk = env.turn;
    }
    if (answer !== 0) {
      yield { key: 'CONTINUEWAR' };
      t.lastTalkNow();
      return;
    }
    spoke = true;
    yield* t.sign3('cease');
    if (t.gap > 6) yield { key: 'WORTHLESS' };
  }
  // No treaty yet: peace.
  if (!t.atPeace) {
    let wants = 3;
    const ph = env.power(human);
    const pc = env.power(computer);
    if (ph * 2 < pc) wants = 2;
    if (Math.trunc((ph * 3) / 2) < pc) wants -= 1;
    if (pc < ph) wants += 1;
    if (pc * 2 < ph) wants += 1;
    const asked =
      a.wasHostile ||
      ((resolved || noContact) && (t.cw & TREATY.ceaseFire) === 0) ||
      ((a.fear !== 0 || attitudeBand(a.mood) <= wants) &&
        !a.leader &&
        t.gap + a.ceded < a.fear + 4);
    if (asked && (yield* t.meet())) {
      let answer = yield { key: 'PROPOSEPEACE', strings: { 1: c.name } };
      if (answer !== 0) {
        const roll = () => refused && env.rng.nextInt(2) === 0;
        if (t.shielded(human) && !roll()) {
          yield {
            key: env.ownsWonder(human, IMPROVEMENT.greatWall) ? 'WALLOVERPEACE' : 'UNOVERPEACE',
          };
          answer = 0;
        } else if (t.senateBlocks() && !roll()) {
          yield { key: 'OVERRULEPEACE' };
          answer = 0;
        } else if ((t.cw & TREATY.firstContact) === 0) {
          yield* t.warnHawks();
        }
      }
      if (answer !== 0) {
        let n = t.gap + 1;
        if (t.vendetta) n *= 2;
        if ((n < 2 ? 0 : env.rng.nextInt(n)) === 0) {
          let gold = Math.min(Math.max(a.fear * 2 - 4, 0), Math.trunc(c.treasury / 50)) * 50;
          if (t.shielded(computer)) gold = Math.trunc(gold / 2);
          if (gold !== 0 && (yield { key: 'CASHFORPEACE', numbers: { 0: gold } }) !== 0) {
            t.pay(c, h, gold);
            answer = 0;
            t.settled = true;
          }
        }
      }
      spoke = true;
      if (answer === 0) yield* t.sign3('peace');
      else yield { key: 'NOPEACE' };
    }
  }

  if (t.met || calledByHuman || (!t.atPeace && (a.fear !== 0 || t.atWar || noContact))) {
    if (t.gap > 6) {
      let allies = 0;
      for (let s = 1; s < 8; s++) if ((t.word(c, s) & TREATY.alliance) !== 0) allies += 1;
      if (t.vendetta && (allies !== 0 || a.leader || env.power(human) < env.power(computer)))
        a.betrayal = true;
    }
    if (noContact) yield* t.meet();
    if ((!t.met || t.refused) && !calledByHuman) {
      if (!a.betrayal) yield* autoTerms(t);
    } else {
      if (!spoke || resolved || a.tribute !== NO_DEAL) yield greeting(t, calledByHuman, resolved);
      yield* menuLoop(t);
    }
  }
}

/** An emissary turned away: the human's senate settles it (end of 0x00449c70). */
function* autoTerms(t: Talk): Generator<Dialog, void, number> {
  const { env, c, cs: computer } = t;
  const a = t.a;
  const strings = { 1: c.name };
  if (!t.shielded(computer) && !t.senateBlocks()) {
    yield* t.warnHawks();
    return;
  }
  const senate = !t.shielded(computer);
  const wall = env.ownsWonder(computer, IMPROVEMENT.greatWall);
  if (!t.atPeace && a.fear !== 0) {
    yield { key: senate ? 'SENATEPEACE' : wall ? 'WALLOVERPEACE' : 'UNOVERPEACE', strings };
    t.sign(TREATY.peace);
    t.lastWar()[computer] = env.turn + 16;
  }
  if (t.atWar) {
    yield { key: senate ? 'SENATECEASE' : wall ? 'WALLOVERCEASE' : 'UNOVERCEASE', strings };
    t.sign(TREATY.ceaseFire);
    t.lastTalkNow();
  }
}

function greeting(t: Talk, calledByHuman: boolean, resolved: boolean): Dialog {
  const a = t.a;
  const strings = { 1: t.c.name, 2: t.h.name, 3: t.h.name, 4: t.h.name };
  if (a.tribute === NO_DEAL && !resolved)
    return {
      key: t.allied ? 'ATTITUDEALLY' : (t.cw & 6) !== 0 ? 'ATTITUDEPEACE' : 'ATTITUDE',
      strings,
    };
  if (!calledByHuman) {
    return {
      key: t.allied ? 'WELCOMEALLY' : t.atPeace ? 'WELCOMEPEACE' : 'WELCOME',
      strings,
    };
  }
  if (t.talks < 2)
    return { key: t.allied ? 'HOWDYALLY' : t.atPeace ? 'HOWDYPEACE' : 'HOWDY', strings };
  return { key: t.allied ? 'DOODYALLY' : 'DOODY', strings };
}

function finish(t: Talk): void {
  const { env, hs, cs, c } = t;
  clearTreaty(env.world, cs, hs, TREATY.allyWarPending);
  if (t.a.betrayal && (t.hw & (TREATY.war | TREATY.alliance)) === 0) {
    treatiesOf(c)[hs] = t.cw | BETRAYAL;
  } else {
    treatiesOf(c)[hs] = t.cw & ~BETRAYAL;
  }
  if (!t.quiet) t.talks += 1;
  if (t.settled || t.annoyed) {
    while (t.talks < (t.annoyed ? 1 : 0) + t.limit()) t.talks += 1;
  }
}

function* menuLoop(t: Talk): Generator<Dialog, void, number> {
  const { h } = t;
  for (;;) {
    if (t.talks < 0) t.talks = 0;
    t.assess();
    const offer = [0, 7, 8];
    if (t.atPeace) offer.push(1);
    if (!t.atPeace && !t.allied) offer.push(2);
    if (t.allied) offer.push(3, 6);
    if (!t.allied && h.government < 5) offer.push(4);
    if (t.atPeace && !t.allied && (t.cw & TREATY.firstContact) === 0) offer.push(5);
    offer.sort((x, y) => x - y);
    const choice = yield { key: 'DIPLOMACYMENU', offer };
    if (choice === 0) {
      t.quiet = true;
      return;
    }
    let ended = false;
    if (choice === 7) yield* favours(t);
    else if (choice === 8) yield* gifts(t);
    else ended = yield* proposal(t, choice);
    if (ended) return;
    t.talks += 1;
    if (t.talks >= t.limit()) {
      t.assess();
      yield { key: t.allied ? 'PATIENCEALLY' : 'PATIENCE' };
      return;
    }
  }
}

/** The menu's first six actions (0x00445022). Returns true when the talk is over. */
function* proposal(t: Talk, choice: number): Generator<Dialog, boolean, number> {
  const { env, h, c, hs, cs } = t;
  const a = t.a;
  const rh = t.rankOf(hs);
  const rc = t.rankOf(cs);
  let gave = false;
  if (choice === 1) {
    let allies = 0;
    for (let s = 1; s < 8; s++) if ((t.word(h, s) & TREATY.alliance) !== 0) allies += 1;
    let bar = (a.enemyAlly === -1 ? 1 : 0) - (env.difficulty < 2 ? 1 : 0);
    if (rc < 5 && rh < 5) {
      if (env.difficulty > 1 && allies === 0) bar -= 1;
      bar -= 1;
    }
    if (rh < rc) {
      if (rc > 5) bar += 1;
      if (rc > 6) bar += 1;
      if (rh < 6 && env.power(cs) < env.power(hs)) bar -= 1;
    }
    if (!a.leader) {
      if (rh - rc > 2) bar -= 1;
    } else bar += 1;
    if (a.fear !== 0) bar -= 1;
    let ok = env.difficulty === 0 || (attitudeBand(a.mood) < 4 && bar < a.restraint);
    if (rh === 7 && allies !== 0) ok = false;
    if (t.gap > (env.difficulty === 0 ? 4 : 2)) ok = false;
    if (rh < 4 && rh * 20 < env.turn) ok = true;
    let reason = 0;
    if (ok && a.enemyAlly > 0 && (t.word(h, a.enemyAlly) & TREATY.contact) !== 0) {
      const third = t.word(h, a.enemyAlly);
      const need =
        (third & TREATY.peace) === 0 ? env.power(cs) * 2 : Math.trunc((env.power(cs) * 3) / 2);
      if ((t.word(c, a.enemyAlly) & TREATY.attacked) !== 0 && need <= env.power(a.enemyAlly)) {
        ok = true;
        reason = 2;
      }
    }
    if (a.enemyAlly > 0 && (t.word(h, a.enemyAlly) & TREATY.alliance) !== 0) {
      ok = true;
      reason |= 1;
    }
    if (a.mood > 75 || t.vendetta || t.gap > 4) ok = false;
    if (t.talks > 4 && env.difficulty !== 0) ok = false;
    t.assess();
    if (!ok) {
      if (!t.vendetta && t.gap < 3 && a.ceded === 0) {
        if (t.citiesOf(hs) < 4 || (rh !== 7 && (rh - rc < 3 || rh < 5))) {
          if (attitudeBand(a.mood) < 4) {
            if (rh < rc) yield { key: 'ALLIANCENOSMALL' };
            else if (t.talks < 3) yield { key: 'ALLIANCENOTHANKS' };
            else yield { key: 'ALLIANCENOPATIENCE' };
          } else yield { key: 'ALLIANCENODISLIKE' };
        } else yield { key: 'ALLIANCENOWINNING' };
      } else {
        yield {
          key: t.gap > 2 && !t.vendetta && a.fear !== 0 ? 'NOBETRAYWEAK' : 'ALLIANCENOBETRAY',
        };
        t.talks += 1;
      }
      return false;
    }
    let still = true;
    const pressed = t.talks > 1 || a.mood > 25 || (h.reputation ?? 0) !== 0 || a.betrayal;
    if (pressed && ((reason & 3) === 0 || a.betrayal) && a.ask > 0) {
      const answer = yield {
        key: `PERHAPSSECRET${env.rng.nextInt(2)}`,
        strings: { 3: env.rules.advances[a.ask]?.name ?? '' },
      };
      if (answer === 0) still = false;
      else {
        gave = true;
        env.gain(c, a.ask, hs);
        t.warm(-2 * env.advanceValue(cs, a.ask));
        t.assess();
        a.ask = a.ask2;
        a.ask2 = -1;
      }
    }
    if (pressed && ((reason & 2) === 0 || a.betrayal) && !gave && still) {
      let gold = askGold(t, (h.reputation ?? 0) * 2);
      if (gold > 0) {
        const answer = yield { key: `PERHAPSTHROWIN${env.rng.nextInt(2)}`, numbers: { 0: gold } };
        if (answer === 0) still = false;
        else {
          t.pay(h, c, gold);
          gave = true;
          t.warm(-goldGoodwill(gold));
          t.assess();
          gold = 0;
        }
      }
    }
    if (!still) {
      yield { key: 'ALLIANCENOPATIENCE' };
      return false;
    }
    if (a.enemyAlly > 0) {
      const answer = yield {
        key: 'PERHAPSSOLIDARITY',
        strings: { 4: civOf(env.world, a.enemyAlly)?.name ?? '' },
      };
      if (answer === 0) {
        if (reason !== 0 || rh === 7 || t.gap > 2 || a.betrayal) {
          t.talks += 1;
          yield { key: gave ? 'PERHAPSTHANKSANYWAY' : 'PERHAPSBYE' };
          return !gave;
        }
      } else {
        t.breakWith(h, a.enemyAlly, cs);
        a.enemyAlly = -1;
      }
    }
    yield* t.sign3('alliance');
    return false;
  }
  if (choice === 2) {
    let ok = !a.leader && a.mood < 51 && t.gap <= (env.difficulty === 0 ? 6 : 4) ? 1 : 0;
    if (a.enemyAlly > 0 && (t.word(h, a.enemyAlly) & TREATY.alliance) !== 0) ok |= 4;
    if ((t.vendetta && t.gap > 2 - env.leaderAttack(cs)) || t.gap > 6 || a.mood > 75) ok = 0;
    if (t.shielded(hs)) ok |= 8;
    if (ok === 0) {
      if (!t.vendetta && t.gap < 5 && a.ceded === 0) {
        if (!a.leader && rh <= rc + 2) {
          if (a.mood < 51 && (rc <= rh || a.mood < 26)) yield { key: 'PEACENOPATIENCE' };
          else yield { key: 'PEACENODISLIKE' };
        } else yield { key: 'PEACENOWINNING' };
      } else {
        yield { key: t.gap > 4 && !t.vendetta && a.fear !== 0 ? 'NOBETRAYWEAK' : 'PEACENOBETRAY' };
        t.talks += 1;
      }
      return false;
    }
    const pressed = t.talks > 1 || a.mood > 50 || t.gap > 1;
    if (pressed && (ok & 6) === 0 && a.ask > 0) {
      const answer = yield {
        key: `PERHAPSSECRET${env.rng.nextInt(2)}`,
        strings: { 3: env.rules.advances[a.ask]?.name ?? '' },
      };
      if (answer === 0) ok &= 8;
      else {
        gave = true;
        env.gain(c, a.ask, hs);
        t.warm(-2 * env.advanceValue(cs, a.ask));
        t.assess();
        a.ask = a.ask2;
        a.ask2 = -1;
      }
    }
    if (pressed && (ok & 4) === 0 && !gave && ok !== 0) {
      const gold = askGold(t, h.reputation ?? 0);
      if (gold > 0) {
        const answer = yield { key: `PERHAPSTHROWIN${env.rng.nextInt(2)}`, numbers: { 0: gold } };
        if (answer === 0) ok &= 8;
        else {
          t.pay(h, c, gold);
          gave = true;
          t.warm(-goldGoodwill(gold));
          t.assess();
        }
      }
    }
    if (ok === 0) {
      yield { key: 'PEACENOPATIENCE' };
      return false;
    }
    if (a.enemyAlly > 0) {
      const answer = yield {
        key: 'PERHAPSSOLIDARITY',
        strings: { 4: civOf(env.world, a.enemyAlly)?.name ?? '' },
      };
      if (answer === 0) {
        if ((ok & 6) !== 0 || rh === 7 || t.gap > 3) {
          t.talks += 1;
          yield { key: gave ? 'PERHAPSTHANKSANYWAY' : 'PERHAPSBYE' };
          return !gave;
        }
      } else {
        t.breakWith(h, a.enemyAlly, cs);
        a.enemyAlly = -1;
      }
    }
    yield* t.sign3('peace');
    return false;
  }
  if (choice === 6) {
    clearTreaty(env.world, cs, hs, TREATY.alliance);
    t.warm(50);
    t.assess();
    yield { key: 'CANCELALLY' };
    h.reputation = (h.reputation ?? 0) + 1;
    return false;
  }
  // 3 a gift from an ally, 4 tribute, 5 withdraw.
  const before = t.talks;
  if (choice < 5) t.talks = t.limit();
  else t.talks += 1;
  t.assess();
  if (a.betrayal || (t.cw & (TREATY.strain | TREATY.broken)) !== 0) {
    a.betrayal = false;
    t.sign(TREATY.war);
    t.lastTalkNow();
    yield { key: `PROVOKE${env.rng.nextInt(2)}` };
    return true;
  }
  if (choice === 3 && rh < rc) a.fear = rc - rh;
  let gold = Math.min(Math.max(a.fear, 0), Math.trunc(c.treasury / 50)) * 50;
  let tech = a.offer;
  const since = env.turn - a.lastTalk;
  if (since < 8) {
    gold = 0;
    tech = -1;
  }
  if (since < 16) gold = Math.trunc(gold / 2);
  if ((t.hw & TREATY.peace) === 0) gold = Math.trunc(gold / 2);
  if (t.shielded(cs)) gold = 0;
  if (
    t.allied &&
    tech >= 0 &&
    h.advancesCount + env.difficulty < c.advancesCount &&
    (env.power(cs) < env.power(hs) || rh < rc)
  ) {
    gold = 0;
    a.fear = 1;
  }
  let shield = t.shielded(hs);
  if (t.gap > 6) shield = false;
  let withdrawn = 0;
  if (t.atPeace && !t.allied) {
    const stay = (a.firstHostile || a.mood > 74) && a.fear === 0 && !shield;
    const defy =
      stay &&
      c.government < env.rng.nextInt(2) + 5 &&
      (t.cw & TREATY.firstContact) === 0 &&
      a.mood > 25;
    if (!defy) withdrawn = withdrawTroops(t);
  }
  if (choice === 5) t.warm(2);
  else {
    let warm = 10;
    if (choice === 3) {
      if (rh < rc) warm = 5;
      if ((h.advancesCount < c.advancesCount && rh < rc) || rh < 4) warm = 0;
    }
    t.warm(warm);
  }
  if (withdrawn !== 0) {
    yield { key: 'APOLOGIZE' };
    if (choice === 5) return false;
  }
  let ended = false;
  if ((gold === 0 && (tech < 0 || a.fear === 0)) || choice === 5) {
    if (!t.allied) {
      const calm =
        (!a.firstHostile && a.mood < 76) ||
        withdrawn !== 0 ||
        ((a.fear !== 0 || shield || (t.cw & TREATY.firstContact) !== 0 || a.mood < 26) &&
          (env.rng.nextInt(3) !== 0 || choice === 5));
      if (calm) {
        if (withdrawn === 0) yield { key: choice === 5 ? 'NOVIOLATORS' : 'FEEBLE' };
      } else {
        ended = true;
        t.assess();
        a.betrayal = false;
        t.sign(TREATY.war);
        yield { key: `PROVOKE${env.rng.nextInt(2)}` };
        t.lastTalkNow();
      }
    } else if (!(yield* t.exchange(before < 2 ? 3 : 2))) {
      if ((h.advancesCount < c.advancesCount && rh < rc) || rh < 4) yield { key: 'SYMPATHY' };
      else if (!a.firstHostile && a.mood < 51 && !a.leader) {
        if (withdrawn === 0) yield { key: 'FEEBLEALLY' };
      } else {
        yield { key: 'TAUNTALLY' };
        clearTreaty(env.world, hs, cs, TREATY.alliance);
        ended = true;
      }
    }
  } else {
    if (tech < 0 || (gold !== 0 && c.advancesCount <= h.advancesCount)) {
      yield { key: choice === 3 ? 'GIVEMOREALLY' : 'GIVEMORE', numbers: { 0: gold } };
      t.pay(c, h, gold);
    } else {
      yield { key: 'GIVEMORECIV', strings: { 1: env.rules.advances[tech]?.name ?? '' } };
      env.gain(h, tech, cs);
      a.offer = -1;
    }
    if ((t.hw & TREATY.peace) === 0) {
      if ((t.cw & TREATY.ceaseFire) === 0) setTreaty(env.world, cs, hs, CLEAR);
      t.sign(TREATY.ceaseFire);
    }
  }
  return ended;
}

function askGold(t: Talk, extra: number): number {
  const { h, env, hs, cs } = t;
  const p = env.power(cs);
  const q = env.power(hs);
  const base = Math.trunc((Math.trunc(h.treasury / 50) * p) / (p + q + 1)) + extra;
  let gold = base * (p < q ? 100 : 50);
  while (gold > h.treasury) gold -= 50;
  return gold;
}

/** The computer pulls its units out of the human's cities' reach (the loop in 0x00445022). */
function withdrawTroops(t: Talk): number {
  const { env, hs, cs } = t;
  const near = (slot: number, x: number, y: number) => {
    let best: { x: number; y: number; d: number } | null = null;
    for (const city of env.world.cities) {
      if (city.owner !== slot) continue;
      const d = gridDistance(env.world, { x, y }, city.position);
      if (!best || d < best.d) best = { x: city.position.x, y: city.position.y, d };
    }
    return best;
  };
  let moved = 0;
  for (const u of env.world.units) {
    if (u.owner !== cs) continue;
    if ((env.rules.units[u.type]?.role ?? 9) >= 6) continue;
    const { x, y } = u.position;
    if (!env.world.isLand(x, y)) continue;
    const theirs = near(hs, x, y);
    if (!theirs || theirs.d >= 3) continue;
    const home = near(cs, x, y);
    if (!home) continue;
    u.position = { x: home.x, y: home.y };
    u.order = null;
    moved += 1;
  }
  return moved;
}

/** "Have a proposal to make" (0x004478c6). */
function* favours(t: Talk): Generator<Dialog, void, number> {
  const { env, h, c, hs, cs } = t;
  const a = t.a;
  for (;;) {
    const pick = yield { key: 'FAVORMENU' };
    if (pick === 0) {
      t.talks -= 1;
      return;
    }
    if (pick === 1) {
      const said = yield* t.exchange(0);
      if (said && t.talks + 1 < t.limit()) {
        t.talks += 1;
        continue;
      }
      return;
    }
    if (pick === 2) {
      const civs: number[] = [];
      for (const o of env.world.civs)
        if (o.slot >= 1 && o.slot <= 7 && o.slot !== hs && o.slot !== cs && o.inPlay)
          civs.push(o.slot);
      const target = yield { key: 'MUSTATTACK', civs };
      if (target === 0) return;
      const them = civOf(env.world, target);
      if (!them) return;
      const strings = { 1: them.name };
      if ((t.word(c, target) & TREATY.contact) === 0) {
        yield { key: 'NOCONTACT', strings };
        return;
      }
      if ((t.word(c, target) & TREATY.war) !== 0) {
        yield { key: 'ATWAR', strings };
        return;
      }
      let price =
        Math.min(
          500,
          Math.max(
            2,
            Math.trunc(
              (((h.reputation ?? 0) +
                Math.trunc(c.treasury / 100) -
                (them.reputation ?? 0) -
                (c.pardons?.[hs] ?? 0)) *
                (env.power(target) >> 1)) /
                1,
            ),
          ),
        ) * 50;
      if ((t.word(c, target) & 6) === 0) price -= Math.trunc(price / 3);
      if (c.treasury < h.treasury) price += Math.trunc(price / 3);
      if ((t.word(c, target) & TREATY.alliance) !== 0) {
        price = Math.min(price, 7000);
        price = Math.min(25000, Math.max(500, price * 3));
      }
      if (t.rankOf(target) === 7 && t.citiesOf(target) > 4) price = Math.trunc(price / 2);
      if ((t.word(h, target) & TREATY.war) === 0) price += Math.trunc(price / 3);
      if (t.allied) {
        let atPeaceAll = true;
        for (let s = 1; s < 8; s++) if ((t.word(c, s) & TREATY.war) !== 0) atPeaceAll = false;
        if (atPeaceAll) price -= price >> 2;
        if ((t.word(them, hs) & TREATY.warDeclared) !== 0) price -= price >> 2;
        if (t.rankOf(hs) < t.rankOf(cs)) price -= Math.trunc(price / 3);
      }
      price = Math.min(500, Math.max(1, Math.trunc(price / 100))) * 50;
      let refuse = t.gap - env.leaderAttack(cs);
      if (t.vendetta) refuse += 2;
      if ((t.word(h, target) & TREATY.war) === 0) refuse += 1;
      if (t.rankOf(target) < t.rankOf(hs)) refuse += 1;
      if (t.rankOf(cs) < t.rankOf(hs)) refuse += 1;
      if (t.allied) refuse = Math.trunc(refuse / 2);
      if (
        refuse > 6 &&
        ((t.word(c, target) & TREATY.alliance) !== 0 ||
          t.vendetta ||
          (t.word(h, target) & TREATY.war) === 0 ||
          t.rankOf(target) < t.rankOf(hs))
      ) {
        yield { key: 'HELLNOWEWONTGO', strings };
        return;
      }
      let techDeal = false;
      let answer: number;
      if ((t.word(c, target) & TREATY.alliance) !== 0) {
        answer = yield { key: 'ETERNALALLIES', strings, numbers: { 0: price } };
      } else if (c.treasury >= 1000 && c.treasury > h.treasury && a.ask >= 0 && a.ask2 >= 0) {
        techDeal = true;
        answer = yield {
          key: 'CYBERCOP',
          strings: {
            ...strings,
            2: env.rules.advances[a.ask]?.name ?? '',
            3: env.rules.advances[a.ask2]?.name ?? '',
          },
        };
      } else answer = yield { key: 'MERCENARY', strings, numbers: { 0: price } };
      if (answer === 0) return;
      if (techDeal) {
        env.gain(c, a.ask, hs);
        env.gain(c, a.ask2, hs);
        a.ask = -1;
        a.ask2 = -1;
      } else {
        if (h.treasury < price) {
          yield { key: 'UNFORTUNATE' };
          return;
        }
        t.pay(h, c, price);
      }
      setTreaty(env.world, cs, target, TREATY.war | TREATY.contact | TREATY.metThisTurn);
      treatiesOf(c)[target] = t.word(c, target) | TREATY.grudge | (1 << 19);
      treatiesOf(c)[hs] = t.cw | ALLY_WAR_PENDING_DONE;
      yield { key: 'MERCDECLARE', strings: { 1: c.name, 2: them.name } };
      const hToThem = t.word(them, hs);
      if ((hToThem & TREATY.alliance) !== 0) {
        if (env.rng.nextInt(2) === 0) {
          adjustAttitude(env.world, target, hs, 25);
          yield { key: 'MERCBETRAYALLY', strings: { 1: them.name } };
          clearTreaty(env.world, hs, target, TREATY.alliance);
        }
      } else if ((hToThem & TREATY.peace) !== 0 && env.rng.nextInt(2) === 0) {
        adjustAttitude(env.world, target, hs, 25);
        yield { key: 'MERCBETRAY', strings: { 1: them.name } };
        setTreaty(env.world, hs, target, TREATY.war);
        treatiesOf(them)[hs] = t.word(them, hs) | TREATY.vendetta;
      }
      return;
    }
    if (pick === 3) {
      const mapFriend =
        (t.hw & TREATY.alliance) !== 0 ||
        a.enemyAlly <= 0 ||
        env.ownsWonder(hs, IMPROVEMENT.marcoPolo) ||
        env.ownsWonder(hs, IMPROVEMENT.magellans);
      if (!mapFriend && (a.mood > 25 || !env.knows(cs, 46) || !env.knows(hs, 46))) {
        yield { key: 'MAPNO', strings: { 1: h.name } };
        return;
      }
      if (a.mood > 25 || !env.knows(cs, 46) || !env.knows(hs, 46)) {
        yield { key: 'MAPNO', strings: { 1: h.name } };
        return;
      }
      yield { key: 'MAPYES' };
      t.talks += 2;
      const both = (1 << hs) | (1 << cs);
      const seen = env.world.seen;
      for (let i = 0; i < seen.length; i++) {
        const s = seen[i] ?? 0;
        if ((s & both) !== 0) seen[i] = s | both;
      }
    }
    return;
  }
}

/** Is `target` in `advance`'s prerequisite tree (0x00492025)? */
function leadsTo(env: NegotiationEnv, advance: number | null, target: number): boolean {
  if (advance === null) return false;
  if (advance === target) return true;
  const r = env.rules.advances[advance];
  return (
    leadsTo(env, advanceIndex(r?.preq1), target) || leadsTo(env, advanceIndex(r?.preq2), target)
  );
}

/** "Wish to offer you a gift" (0x00448bf8). */
function* gifts(t: Talk): Generator<Dialog, void, number> {
  const { env, h, c, hs, cs } = t;
  const a = t.a;
  const pick = yield { key: 'GIFTMENU' };
  if (pick === 0) {
    t.talks -= 1;
    return;
  }
  const thanks = function* (): Generator<Dialog, void, number> {
    t.assess();
    yield { key: 'ACCEPT', strings: { 1: c.name } };
    t.talks -= t.giftRound + 2;
    t.giftRound += 1;
  };
  if (pick === 1) {
    t.pickTrades();
    if (a.ask < 0) {
      yield { key: 'KNOWNO', strings: { 1: h.name } };
      return;
    }
    const first = env.rules.advances[a.ask]?.name ?? '';
    const answer =
      a.ask2 < 0
        ? yield { key: 'TECHGIFT', strings: { 1: first } }
        : yield {
            key: 'TECHGIFT2',
            strings: { 1: first, 2: env.rules.advances[a.ask2]?.name ?? '' },
          };
    if (answer === 0) {
      yield { key: 'WASTING' };
      return;
    }
    const value = env.advanceValue(cs, a.ask);
    if (answer === 1) {
      env.gain(c, a.ask, hs);
      t.warm(-value * 4);
    } else {
      env.gain(c, a.ask2, hs);
      t.warm(-value * 2);
    }
    yield* thanks();
    return;
  }
  if (pick === 2) {
    const amounts: number[] = [];
    let last = 0;
    for (let i = 1; i < 5; i++) {
      const g = ((i * Math.trunc(h.treasury / 50)) >> 2) * 50;
      if (g > 0 && g !== last) amounts.push(g);
      last = g;
    }
    const gold = yield { key: 'MONEYGIFT', amounts };
    if (gold === 0) {
      yield { key: 'WASTING' };
      return;
    }
    t.pay(h, c, gold);
    t.warm(-Math.trunc((goldGoodwill(gold) * 3) / 2));
    yield* thanks();
    return;
  }
  if (pick === 3) {
    const cities = env.world.cities.filter((x) => x.owner === hs);
    if (cities.length === 0) {
      yield { key: 'MILITARYNONE' };
      t.talks -= 1;
      return;
    }
    const pickCity = yield {
      key: 'MILITARYSOURCE',
      pick: cities.map((x) => ({ label: x.name, value: x.id })),
    };
    const from = cities.find((x) => x.id === pickCity);
    if (!from) {
      t.talks -= 1;
      return;
    }
    const here = env.world.unitsAt(from.position.x, from.position.y);
    if (here.length === 0) {
      yield { key: 'MILITARYNONE' };
      t.talks -= 1;
      return;
    }
    const nearest = env.world.cities
      .filter((x) => x.owner === cs)
      .sort(
        (a2, b) =>
          gridDistance(env.world, from.position, a2.position) -
          gridDistance(env.world, from.position, b.position),
      )[0];
    if (
      !nearest ||
      attitudeBand(a.mood) > 4 ||
      h.advancesCount < c.advancesCount ||
      t.rankOf(hs) < t.rankOf(cs) ||
      env.power(hs) < env.power(cs)
    ) {
      yield { key: 'MILITARYNO', strings: { 1: c.name } };
      return;
    }
    const pickUnit = yield {
      key: 'MILITARYSOURCE',
      title: 'Select the unit to give',
      pick: here.map((u) => ({ label: env.rules.units[u.type]?.name ?? '?', value: u.id })),
    };
    const unit = here.find((u) => u.id === pickUnit);
    if (!unit) {
      t.talks -= 1;
      return;
    }
    const type = env.rules.units[unit.type];
    const closing = advanceIndex(type?.obsoleteWith);
    if (closing !== null && env.knows(cs, closing)) {
      yield { key: 'MILITARYNO', strings: { 1: c.name } };
      return;
    }
    unit.owner = cs;
    unit.homeCity = null;
    unit.position = { x: nearest.position.x, y: nearest.position.y };
    unit.order = null;
    let goodwill = (type?.costRows ?? 0) * 3;
    const preq = advanceIndex(type?.preq);
    if (preq !== null && env.knows(cs, preq)) goodwill = Math.trunc(goodwill / 2);
    t.warm(-goodwill);
    yield { key: 'ACCEPT', strings: { 1: c.name } };
    if (preq !== null && !env.knows(cs, preq)) {
      let found = -1;
      for (let i = 0; i < 100; i++) {
        if (!env.knows(cs, i) && leadsTo(env, preq, i)) {
          found = i;
          break;
        }
      }
      if (found > 0 && env.rng.nextInt(2) === 0) {
        yield { key: 'BREAKTHROUGH', strings: { 1: c.name } };
        env.gain(c, found, hs);
      }
    }
  }
}

export interface Intrusion {
  /** Cities with the human's units in their radius. */
  cities: number;
  /** The units, counted once each. */
  units: number;
  /** Weighted by what they stand on (0x0050edb0). */
  severity: number;
  /** Repeat offences, and more than three units at one city. */
  strikes: number;
  city: City | null;
}

/** The human's units inside a computer city's radius, off roads to nowhere (0x0050edb0). */
export function scanIntrusions(env: NegotiationEnv, computer: number, human: number): Intrusion {
  const out: Intrusion = { cities: 0, units: 0, severity: 0, strikes: 0, city: null };
  const c = civOf(env.world, computer);
  if (!c || ((treatiesOf(c)[human] ?? 0) & TREATY.alliance) !== 0) return out;
  const counted = new Set<Unit>();
  for (const city of env.world.cities) {
    if (city.owner !== computer) continue;
    let here = 0;
    for (let i = 0; i < 20; i++) {
      const p = env.world.radiusSquare(city.position.x, city.position.y, i);
      if (!p || !env.world.isLand(p.x, p.y) || env.world.cityAt(p.x, p.y)) continue;
      const units = env.world.unitsAt(p.x, p.y);
      if (units[0]?.owner !== human) continue;
      for (const u of units) {
        if ((env.rules.units[u.type]?.role ?? 9) >= 6 || counted.has(u)) continue;
        counted.add(u);
        if (out.city !== city) out.cities += 1;
        out.city = city;
        if (u.warned) out.strikes += 1;
        u.warned = true;
        here += 1;
        out.units += 1;
        out.severity += 1;
        if (env.world.hasFlag(p.x, p.y, SquareFlag.Road)) out.severity += 2;
        if (env.world.hasFlag(p.x, p.y, SquareFlag.Railroad)) out.severity += 1;
        if (env.world.hasFlag(p.x, p.y, SquareFlag.Mine)) out.severity += 1;
        if (env.world.hasFlag(p.x, p.y, SquareFlag.Irrigation)) out.severity += 1;
        if (env.world.hasFlag(p.x, p.y, SquareFlag.Fortress)) out.severity += 2;
      }
    }
    if (here > 3) out.strikes += 1;
  }
  return out;
}

/** The attitude a computer player's feeling about a human moves by (the rest of 0x00513f7e). */
export function attitudeDrift(t: Talk, start: number, raceOn: boolean): number {
  const { env, h, c, hs, cs } = t;
  const advC = c.advancesCount;
  const advH = h.advancesCount;
  const pC = env.power(cs);
  const pH = env.power(hs);
  let ahead = 0;
  let wars = 0;
  let enemiesOfH = 0;
  for (let s = 1; s < 8; s++) {
    const o = civOf(env.world, s);
    if (!o) continue;
    if (advH < o.advancesCount) ahead += 1;
    if ((t.word(c, s) & TREATY.war) !== 0 && s !== cs) wars += 1;
    if ((t.word(o, hs) & TREATY.war) !== 0) enemiesOfH += pH < env.power(s) ? 2 : 1;
  }
  const attack = env.leaderAttack(cs);
  let d = start;
  if (t.allied) {
    if (wars === 0) {
      if (c.treasury < h.treasury) d += 1;
      if (advC < advH && env.difficulty !== 0) d += 1;
      if (advH < advC) d -= 1;
      if (pC < pH) d += 1;
      if (pH < pC) d -= 1;
    } else if (attack < 1 || wars > 1) {
      d -= Math.max(1, wars - attack - 1);
    }
    if (advC + 8 < advH) d += 1;
  }
  if (t.atPeace) d -= 2;
  if (!t.atWar) d -= 1;
  const rankH = t.rankOf(hs);
  if (rankH < 7 && env.turn > 200) {
    let x = 7 - rankH;
    if (raceOn) x = 1;
    if (env.turn < 400) x = (x + 1) >> 1;
    d -= x;
  }
  const lenient = t.gap <= enemiesOfH && !t.vendetta;
  if (rankH === 7 && t.citiesOf(hs) > 3 && env.turn > 200 && env.difficulty !== 0) {
    let x = Math.trunc(env.difficulty / 3) + 1;
    if (lenient) x >>= 1;
    d += x;
  }
  if (t.nukes(h) !== 0) {
    d -= 1;
    if (t.nukes(c) === 0 && d > 0) d -= 1;
  }
  let temperament = attack * 3 + env.leaderExpand(cs) * 2;
  if (temperament < -1) temperament = -2;
  let gap = t.rankOf(hs) - t.rankOf(cs);
  if (gap < 0 || !t.allied) gap = Math.trunc(gap / 2);
  d += temperament + gap;
  if (lenient) {
    if (pC * 4 < pH) d -= 1;
    if (pC * 2 < pH) d -= 1;
    if (Math.trunc((pC * 3) / 2) < pH) d -= 1;
  }
  if (!t.allied) {
    if (pH < pC) d += 1;
    if (pH * 2 < pC) d += 1;
  }
  if (t.shielded(hs)) d = d < 1 ? d - 1 : d >> 1;
  if (ahead === 0) d += 1;
  if (advC < advH) d += 1 - env.leaderCivilize(cs);
  if (t.atWar && d < 1) d = 0;
  if (env.ownsWonder(cs, IMPROVEMENT.eiffelTower)) d += 1;
  if (env.ownsWonder(hs, IMPROVEMENT.eiffelTower)) {
    if (d > 0) d = Math.trunc(d / 2);
    d = d - 1 >= 0 ? d - 2 : d - 1;
  }
  if ((t.cw & TREATY.contact) === 0) d = 0;
  return d;
}

/** One computer player's turn toward a human (0x00513f7e): borders, then the attitude drift. */
export function* relationsTurn(
  env: NegotiationEnv,
  human: number,
  computer: number,
  raceOn: boolean,
): Conversation {
  const t = new Talk(env, human, computer, false);
  t.assess();
  t.firstPass = false;
  const { h, c } = t;
  const seen = scanIntrusions(env, computer, human);
  let drift = seen.severity;
  if (seen.cities !== 0 && (t.cw & (TREATY.war | TREATY.alliance)) === 0 && seen.city) {
    const name = seen.city.name;
    if (!t.atPeace) {
      let strikes = seen.strikes;
      let friendly = env.rng.nextInt(2);
      if (t.vendetta) strikes += 1;
      const rep = (h.reputation ?? 0) + strikes;
      if (rep > 2 && (rep - 1 < 1 ? 0 : env.rng.nextInt(rep)) > 1) {
        friendly = 0;
        setTreaty(env.world, computer, human, TREATY.strain);
      }
      if (((env.turn + computer) & 3) === 0 && (yield* t.meet())) {
        yield { key: friendly === 0 ? 'NEARCITY' : 'ADMIRECITY', strings: { 1: name } };
      }
    } else {
      const talked = t.lastWar()[computer] ?? 0;
      if (!(talked < env.turn && env.turn - talked < 3)) {
        t.assess();
        if (seen.strikes === 0) {
          drift = seen.severity - 1;
          yield { key: seen.cities < 2 ? 'INTRUDER' : 'INTRUDERS', strings: { 1: name } };
        } else {
          const answer = yield {
            key: seen.cities < 2 ? 'VIOLATOR' : 'VIOLATORS',
            strings: { 1: name },
          };
          if (answer === 0) {
            for (const u of env.world.units) {
              if (u.owner !== human || !u.warned) continue;
              const home = env.world.cities
                .filter((x) => x.owner === human)
                .sort(
                  (a, b) =>
                    gridDistance(env.world, u.position, a.position) -
                    gridDistance(env.world, u.position, b.position),
                )[0];
              if (home) {
                u.position = { x: home.position.x, y: home.position.y };
                u.order = null;
              }
            }
            yield {
              key: seen.units === 1 ? 'WITHDRAWN1' : 'WITHDRAWN',
              numbers: { 0: seen.units },
            };
          } else {
            const senate = h.government === 6 || (h.government === 5 && env.rng.nextInt(2) === 1);
            if (senate) {
              yield { key: 'SENATESCANDAL', strings: { 0: h.name } };
              h.government = 0;
            }
            adjustAttitude(env.world, computer, human, 50);
            t.breakWith(h, computer, -1);
            yield { key: 'VIOLATE', strings: { 1: c.name } };
          }
        }
      }
    }
  }
  for (const u of env.world.units) if (u.owner === human) u.warned = false;
  const change = attitudeDrift(t, drift, raceOn);
  adjustAttitude(env.world, computer, human, change);
}

/** Mark every dialog of a conversation with who speaks. */
export function* spokenBy(talk: Conversation, slot: number): Conversation {
  let step = talk.next();
  while (!step.done) step = talk.next(yield { ...step.value, speaker: slot });
}
