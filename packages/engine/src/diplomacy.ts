/**
 * Diplomacy between civilizations: the treaty words, attitudes, first contact, the AI's war and
 * peace reviews, tech exchange between allies, military aid, and the per-turn housekeeping.
 *
 * Ported from the original's treaty helpers (0x0044de95 set, 0x0044ddc0 clear, 0x0044e123 "at
 * war", 0x0044df74 attitude, 0x00440a60 attitude change), the contact review 0x00510ac7 (the
 * computer-to-computer branch), the "wants war" test 0x0050fdc6, the ally-joins-war rule
 * 0x00510871, the ally tech exchange 0x005103ce, military aid 0x005129ba and the per-turn
 * routine 0x0051326d. VERIFIED unless marked INFERRED. docs/engine/diplomacy.md.
 */
import { distance } from './city.js';
import { IMPROVEMENT, type EngineRules } from './rules.js';
import { OCEAN, SquareFlag, type Civ, type Unit, type World } from './world.js';

/** Bits of the 32-bit treaty word a civilization keeps about each other slot. */
export const TREATY = {
  contact: 1 << 0,
  ceaseFire: 1 << 1,
  peace: 1 << 2,
  alliance: 1 << 3,
  vendetta: 1 << 4,
  /** Set by an ally's vendetta on a common foe; a truce in strain (INFERRED name). */
  strain: 1 << 5,
  /** Set when a strained truce breaks (INFERRED name). */
  broken: 1 << 6,
  embassy: 1 << 7,
  /** Set on both sides when one attacks the other's unit (the combat routine). */
  attacked: 1 << 9,
  /** Met this turn; cleared by the next turn's housekeeping. */
  metThisTurn: 1 << 10,
  /** A grudge that keeps a war from lapsing (INFERRED name; cleared every 32 turns). */
  grudge: 1 << 11,
  /** Set on the declarer's word by the first declaration of a war (0x00526d80; INFERRED name). */
  warDeclared: 1 << 12,
  war: 1 << 13,
  /** First contact this turn (cleared next turn). */
  firstContact: 1 << 14,
  /** An ally has been asked to join a war against a human (INFERRED name). */
  allyWarPending: 1 << 16,
  /** A tech gift has been given this cycle (cleared each turn for computer partners). */
  techGiven: 1 << 18,
  /** Keeps the grudge from lapsing at the 32-turn mark (INFERRED name). */
  grudgeRenewed: 1 << 19,
  /** War declared this turn (cleared next turn). */
  warThisTurn: 1 << 21,
} as const;

/** Wonders the diplomacy rules name, by @IMPROVE index (39 + wonder number). */
export const WONDER = {
  greatWall: 45,
  michelangelos: 49,
  shakespeares: 52,
  statueOfLiberty: 58,
  womensSuffrage: 60,
  unitedNations: 63,
} as const;

const NUCLEAR_MISSILE = 45;

export interface DiplomacyEvent {
  kind: 'diplomacy';
  text: string;
  a: number;
  b: number;
}

export function civOf(world: World, slot: number): Civ | undefined {
  return world.civs.find((c) => c.slot === slot);
}

export function treatiesOf(civ: Civ): Uint32Array {
  civ.treaties ??= new Uint32Array(8);
  return civ.treaties;
}

export function attitudesOf(civ: Civ): Uint8Array {
  civ.attitudes ??= new Uint8Array(8);
  return civ.attitudes;
}

/** Per slot: the turn that slot last attacked or declared war on this civilization (−1 none). */
export function lastWarTurnsOf(civ: Civ): Int16Array {
  civ.lastWarTurns ??= new Int16Array(8).fill(-1);
  return civ.lastWarTurns;
}

export function treaty(world: World, a: number, b: number): number {
  const civ = civOf(world, a);
  return civ ? (treatiesOf(civ)[b] ?? 0) : 0;
}

export function hasTreaty(world: World, a: number, b: number, bit: number): boolean {
  return (treaty(world, a, b) & bit) !== 0;
}

/** Set treaty bits both ways (0x0044de95): an alliance implies peace; cease-fire, peace or
 * alliance clear strain, broken, attacked, grudge and war; war clears those three and marks
 * the turn. */
export function setTreaty(world: World, a: number, b: number, flags: number): void {
  if ((flags & TREATY.alliance) !== 0) setTreaty(world, a, b, TREATY.peace);
  if ((flags & (TREATY.ceaseFire | TREATY.peace | TREATY.alliance)) !== 0)
    clearTreaty(world, a, b, 0x2a60);
  let f = flags;
  if ((flags & TREATY.war) !== 0) {
    clearTreaty(world, a, b, TREATY.ceaseFire | TREATY.peace | TREATY.alliance);
    f |= TREATY.warThisTurn;
  }
  const ca = civOf(world, a);
  const cb = civOf(world, b);
  if (ca) treatiesOf(ca)[b] = (treatiesOf(ca)[b] ?? 0) | f;
  if (cb) treatiesOf(cb)[a] = (treatiesOf(cb)[a] ?? 0) | f;
}

/** Clear treaty bits both ways (0x0044ddc0): clearing peace clears the alliance, clearing war
 * clears bits 11 and 12, clearing contact clears war. */
export function clearTreaty(world: World, a: number, b: number, flags: number): void {
  if ((flags & TREATY.peace) !== 0) clearTreaty(world, a, b, TREATY.alliance);
  if ((flags & TREATY.war) !== 0) clearTreaty(world, a, b, 0x1800);
  if ((flags & TREATY.contact) !== 0) clearTreaty(world, a, b, TREATY.war);
  const ca = civOf(world, a);
  const cb = civOf(world, b);
  if (ca) treatiesOf(ca)[b] = (treatiesOf(ca)[b] ?? 0) & ~flags;
  if (cb) treatiesOf(cb)[a] = (treatiesOf(cb)[a] ?? 0) & ~flags;
}

export function attitude(world: World, a: number, b: number): number {
  const civ = civOf(world, a);
  return civ ? (attitudesOf(civ)[b] ?? 0) : 0;
}

/** Raise or lower a's attitude toward b (0x00440a60; the setter 0x0044dfa3 clamps to 0–100, VERIFIED). */
export function adjustAttitude(world: World, a: number, b: number, delta: number): void {
  const civ = civOf(world, a);
  if (!civ) return;
  attitudesOf(civ)[b] = Math.max(0, Math.min(100, (attitudesOf(civ)[b] ?? 0) + delta));
}

/**
 * Are a and b at war (0x0044e123)? The war bit, or — short of an alliance — contact without
 * peace and an attitude above 49. Barbarians (slot 0) are everyone's enemy (INFERRED: the
 * original's loops never ask about slot 0).
 */
export function atWar(world: World, a: number, b: number): boolean {
  if (a === b) return false;
  if (a === 0 || b === 0) return true;
  const t = treaty(world, a, b);
  if ((t & TREATY.war) !== 0) return true;
  if ((t & TREATY.alliance) !== 0) return false;
  if ((t & (TREATY.contact | TREATY.peace)) === TREATY.contact) return attitude(world, a, b) > 49;
  return false;
}

/** May a attack b's units? Neither a cease-fire nor peace stands between them (the chooser's test). */
export function canAttack(world: World, a: number, b: number): boolean {
  if (a === b) return false;
  if (a === 0 || b === 0) return true;
  return (treaty(world, a, b) & (TREATY.ceaseFire | TREATY.peace)) === 0;
}

/** A cease-fire or peace without an alliance: the partner the chooser keeps its distance from. */
export function atPeace(world: World, a: number, b: number): boolean {
  if (a === b || a === 0 || b === 0) return false;
  const t = treaty(world, a, b);
  return (t & (TREATY.ceaseFire | TREATY.peace)) !== 0 && (t & TREATY.alliance) === 0;
}

export interface DiplomacyContext {
  /** Open the negotiation with a human: the review stops here and the screen decides. */
  requestTalk?: (human: number, computer: number) => void;
  /** Scenario events: may `talker` approach `listener` (NEGOTIATION)? Default yes. */
  negotiationAllowed?: (talker: number, listener: number) => boolean;
  /** The research value of an advance to a slot (0x004920ac); the RULES base when absent. */
  advanceValue?: (slot: number, advance: number) => number;
  rules: EngineRules;
  turn: number;
  difficulty: number;
  isHuman: (slot: number) => boolean;
  inPlay: (slot: number) => boolean;
  ownsWonder: (slot: number, improvement: number) => boolean;
  knows: (slot: number, advance: number) => boolean;
  cityCount: (slot: number) => number;
  advancesOf: (slot: number) => number;
  /** The leader's attack personality (RULES @LEADERS). */
  attackPersonality: (slot: number) => number;
  /** The original's per-civilization "control" byte: 7 for a human, the difficulty otherwise (INFERRED). */
  control: (slot: number) => number;
  /** Per-land-mass tallies from the strategic layer (combat units, attack, cities). */
  tallies: (
    slot: number,
  ) =>
    | { unitsOn: Uint16Array; attackOn: Uint16Array; citiesOn: Uint8Array; strength: number }
    | undefined;
  grantAdvance: (slot: number, advance: number, from: number) => void;
  spaceshipLaunched: (slot: number) => boolean;
  /** The leading human's slot, or null. */
  mainHuman: number | null;
  /** Options byte 0 bit 0 (set in every shipped file). */
  optionBit0?: boolean;
  /** Random numbers. */
  nextInt: (n: number) => number;
  /** A human's answer to an AI proposal (INFERRED stand-in for the negotiation screens): default accepts peace and declines alliances. */
  humanAccepts?: (kind: 'peace' | 'alliance', human: number, other: number) => boolean;
}

function strength(ctx: DiplomacyContext, slot: number): number {
  return ctx.tallies(slot)?.strength ?? 0;
}

function nukes(world: World, slot: number): number {
  return world.units.filter((u) => u.owner === slot && u.type === NUCLEAR_MISSILE).length;
}

/** Does a see reason to fight b (0x0050fdc6)? */
export function wantsWar(world: World, a: number, b: number, ctx: DiplomacyContext): boolean {
  const t = treaty(world, a, b);
  if ((t & TREATY.grudge) !== 0) return true;
  if ((t & TREATY.vendetta) !== 0) return true;
  for (let c = 1; c < 8; c++) {
    if (!ctx.inPlay(c)) continue;
    if (
      atWar(world, a, c) &&
      strength(ctx, b) < strength(ctx, c) &&
      !hasTreaty(world, b, c, TREATY.alliance)
    )
      return false;
    if (
      atWar(world, b, c) &&
      strength(ctx, a) < strength(ctx, c) &&
      !hasTreaty(world, a, c, TREATY.alliance)
    )
      return false;
  }
  if (nukes(world, a) < nukes(world, b)) return false;
  let n = 0;
  for (let c = 1; c < 8; c++) {
    if (c === a || c === b) continue;
    if (atWar(world, a, c)) n += 1;
    if (
      hasTreaty(world, a, c, TREATY.alliance) &&
      hasTreaty(world, b, c, TREATY.alliance) &&
      ctx.inPlay(c)
    ) {
      n += 1;
      if (ctx.control(a) < ctx.control(c) && ctx.control(b) < ctx.control(c)) n += 1;
    }
    if (
      hasTreaty(world, a, c, TREATY.alliance) &&
      hasTreaty(world, b, c, TREATY.war) &&
      ctx.inPlay(c)
    )
      n -= 1;
    if (ctx.control(c) === 7 && ctx.turn > 199 && hasTreaty(world, b, c, TREATY.war)) n -= 1;
  }
  if (!atWar(world, a, b)) n += 1;
  if ((t & TREATY.alliance) !== 0) n += 1;
  const ta = ctx.tallies(a);
  const tb = ctx.tallies(b);
  let myAttack = 0;
  let theirPower = 1;
  let myCities = 0;
  if (ta && tb) {
    for (let lm = 1; lm < 63; lm++) {
      if (
        (ta.citiesOn[lm] ?? 0) !== 0 &&
        (ta.unitsOn[lm] ?? 0) + (ta.attackOn[lm] ?? 0) < (tb.attackOn[lm] ?? 0)
      )
        return false;
      if ((ta.attackOn[lm] ?? 0) !== 0 && (tb.unitsOn[lm] ?? 0) !== 0) {
        myAttack += ta.attackOn[lm] ?? 0;
        theirPower += ((tb.attackOn[lm] ?? 0) >> 1) + (tb.unitsOn[lm] ?? 0);
        myCities += ta.citiesOn[lm] ?? 0;
      }
    }
  }
  if (Math.trunc((myAttack * 4) / theirPower) < n - ctx.attackPersonality(a) + 4 && myCities !== 0)
    return false;
  return true;
}

/** Allies exchange advances (0x005103ce); returns true when anything changed hands. */
export function techExchange(world: World, a: number, b: number, ctx: DiplomacyContext): boolean {
  const leadingHuman =
    ctx.mainHuman !== null &&
    ctx.difficulty !== 0 &&
    ctx.cityCount(ctx.mainHuman) >= 5 &&
    ctx.turn >= 201 &&
    ctx.advancesOf(ctx.mainHuman) > ctx.advancesOf(a) &&
    ctx.advancesOf(ctx.mainHuman) > ctx.advancesOf(b);
  let bestA = -1;
  let bestAValue = 0;
  let bestB = -1;
  let bestBValue = 0;
  for (let adv = 0; adv < ctx.rules.advances.length; adv++) {
    const rule = ctx.rules.advances[adv];
    if (!rule || (rule.preq1.kind === 'never' && rule.preq2.kind === 'never')) continue;
    // VERIFIED: rand() % 3 plus the receiver's research value (0x004920ac, aiResearch.ts); the
    // RULES base stands in when the context brings no value routine.
    const value = (receiver: number) =>
      ctx.nextInt(3) + (ctx.advanceValue ? ctx.advanceValue(receiver, adv) : (rule.aiValue ?? 1));
    if (!ctx.knows(a, adv) && ctx.knows(b, adv)) {
      const v = value(a);
      if (bestA < 0 || bestAValue < v) {
        bestA = adv;
        bestAValue = v;
      }
    } else if (!ctx.knows(b, adv) && ctx.knows(a, adv)) {
      const v = value(b);
      if (bestB < 0 || bestBValue < v) {
        bestB = adv;
        bestBValue = v;
      }
    }
  }
  if (bestA >= 0 && bestB >= 0) {
    ctx.grantAdvance(a, bestA, b);
    ctx.grantAdvance(b, bestB, a);
    return true;
  }
  const gap = (6 - ctx.difficulty) * 2;
  if (bestA >= 0) {
    if (
      hasTreaty(world, a, b, TREATY.alliance) &&
      (ctx.advancesOf(a) + gap < ctx.advancesOf(b) || leadingHuman) &&
      !hasTreaty(world, a, b, TREATY.techGiven)
    ) {
      setTreaty(world, a, b, TREATY.techGiven);
      ctx.grantAdvance(a, bestA, b);
      return true;
    }
  } else if (
    bestB >= 0 &&
    hasTreaty(world, a, b, TREATY.alliance) &&
    (ctx.advancesOf(b) + gap < ctx.advancesOf(a) || leadingHuman) &&
    !hasTreaty(world, a, b, TREATY.techGiven)
  ) {
    setTreaty(world, a, b, TREATY.techGiven);
    ctx.grantAdvance(b, bestB, a);
    return true;
  }
  return false;
}

/** An ally a joins b's war against c (0x00510871); returns true when war is declared. */
export function allyJoinsWar(
  world: World,
  a: number,
  c: number,
  b: number,
  ctx: DiplomacyContext,
  events: DiplomacyEvent[],
): boolean {
  if ((treaty(world, a, c) & (TREATY.war | TREATY.alliance)) !== 0) return false;
  if (!hasTreaty(world, b, c, TREATY.war)) {
    if (hasTreaty(world, a, c, TREATY.vendetta) && hasTreaty(world, b, c, TREATY.vendetta)) {
      const ca = civOf(world, a);
      const cb = civOf(world, b);
      if (ca) treatiesOf(ca)[c] = (treatiesOf(ca)[c] ?? 0) | TREATY.strain;
      if (cb) treatiesOf(cb)[c] = (treatiesOf(cb)[c] ?? 0) | TREATY.strain;
    }
    return false;
  }
  if (ctx.isHuman(c)) {
    const cc = civOf(world, c);
    if (!hasTreaty(world, a, c, TREATY.vendetta)) {
      if (cc && (lastWarTurnsOf(cc)[a] ?? -1) - ctx.turn < 6) return false;
      if (ctx.control(c) < 7 && ctx.nextInt(3) !== 0) return false;
    }
    if (cc) {
      lastWarTurnsOf(cc)[a] = ctx.turn;
      lastWarTurnsOf(cc)[b] = ctx.turn;
    }
  }
  events.push({
    kind: 'diplomacy',
    text: `${name(world, a)} join ${name(world, b)} in war against ${name(world, c)}`,
    a,
    b: c,
  });
  setTreaty(world, a, c, TREATY.war);
  return true;
}

/** Record +0x48: treaty breaks charged per slot. */
export function treatyBreaksOf(civ: Civ): Uint8Array {
  civ.treatyBreaks ??= new Uint8Array(8);
  return civ.treatyBreaks;
}

/**
 * Breaking a treaty (VERIFIED 0x004447be): `a` turns on `b`; `witness` is the civilization whose
 * attitude suffers (an espionage victim's friend, for instance), null when the deed speaks for
 * itself. Outside an alliance: at mere contact only the witness's attitude drops (−5); at
 * cease-fire or peace the breaker's reputation worsens — once for a fully human-controlled
 * breaker with more than four cities and no witness, once above Chieftain without the Eiffel
 * Tower, and (the original repeats both tests when both the peace and cease-fire bits stand) —
 * the human breaker's count toward the victim drops, the witness's attitude drops by 15; a human
 * breaker earns the victim's vendetta, war is declared, the human's word gains the grudge bits,
 * the last-war turn is noted and the victim's allies join. Inside an alliance: reputation
 * worsens above Chieftain without the Eiffel Tower and once more without a witness, the
 * witness's attitude drops by 25, the alliance is cancelled and a human breaker earns a vendetta.
 */
export function breakTreaty(
  world: World,
  a: number,
  b: number,
  witness: number | null,
  ctx: DiplomacyContext,
  events: DiplomacyEvent[],
): void {
  const ca = civOf(world, a);
  const cb = civOf(world, b);
  if (!ca || !cb) return;
  const human = ctx.isHuman(a);
  if (witness !== null) {
    const cw = civOf(world, witness);
    if (cw) treatyBreaksOf(cw)[a] = (treatyBreaksOf(cw)[a] ?? 0) + 1;
  }
  const worsen = () => {
    ca.reputation = Math.min(255, (ca.reputation ?? 0) + 1);
  };
  const eiffel = ctx.ownsWonder(a, IMPROVEMENT.eiffelTower);
  if (!hasTreaty(world, a, b, TREATY.alliance)) {
    const word = treaty(world, a, b);
    if ((word & (TREATY.ceaseFire | TREATY.peace)) === 0) {
      if (witness !== null) adjustAttitude(world, witness, a, -5);
    } else {
      const both = (word & TREATY.peace) !== 0 && (word & TREATY.ceaseFire) !== 0;
      const charge = () => {
        if (ctx.control(a) === 7 && ctx.cityCount(a) > 4 && witness === null) worsen();
        if (ctx.difficulty !== 0 && !eiffel) worsen();
        if (witness === null && human) treatyBreaksOf(ca)[b] = (treatyBreaksOf(ca)[b] ?? 0) - 1;
      };
      if (both) charge();
      charge();
      if (witness !== null) adjustAttitude(world, witness, a, -15);
    }
    if (human) treatiesOf(cb)[a] = (treatiesOf(cb)[a] ?? 0) | TREATY.vendetta;
    setTreaty(world, a, b, TREATY.war);
    if (human) {
      treatiesOf(ca)[b] = (treatiesOf(ca)[b] ?? 0) | TREATY.grudge | TREATY.grudgeRenewed;
      lastWarTurnsOf(ca)[b] = ctx.turn;
      alliesJoinWar(world, b, a, ctx, events);
    }
  } else {
    if (ctx.difficulty !== 0 && !eiffel) worsen();
    if (witness === null) {
      worsen();
      if (human) treatyBreaksOf(ca)[b] = (treatyBreaksOf(ca)[b] ?? 0) - 1;
    }
    if (witness !== null) adjustAttitude(world, witness, a, -25);
    cancelAlliance(world, a, b, events);
    if (human) treatiesOf(cb)[a] = (treatiesOf(cb)[a] ?? 0) | TREATY.vendetta;
  }
}

/**
 * The victim's allies join a war (VERIFIED 0x0044442f): when `victim` has contact with the
 * breaker, each ally of the victim with contact and neither war nor alliance with the breaker
 * declares war (war, met-this-turn and contact bits) with the grudge bits — when the breaker is a
 * computer player only for a human victim; when the breaker is human always, the ally's attitude
 * toward the breaker jumping to the maximum, the victim's word gaining the grudge bits too and
 * the breaker's last-war turn toward the ally noted.
 */
export function alliesJoinWar(
  world: World,
  victim: number,
  breaker: number,
  ctx: DiplomacyContext,
  events: DiplomacyEvent[],
): void {
  if (!hasTreaty(world, victim, breaker, TREATY.contact)) return;
  const cv = civOf(world, victim);
  const cb = civOf(world, breaker);
  if (!cv || !cb) return;
  for (let k = 1; k < 8; k++) {
    if (k === victim || k === breaker) continue;
    if (!hasTreaty(world, victim, k, TREATY.alliance)) continue;
    if ((treaty(world, k, breaker) & (TREATY.war | TREATY.alliance)) !== 0) continue;
    if (!hasTreaty(world, k, breaker, TREATY.contact)) continue;
    const ck = civOf(world, k);
    if (!ck) continue;
    const breakerHuman = ctx.isHuman(breaker);
    if (!breakerHuman && !ctx.isHuman(victim)) continue;
    events.push({
      kind: 'diplomacy',
      text: `${name(world, k)} join ${name(world, victim)} in war against ${name(world, breaker)}`,
      a: k,
      b: breaker,
    });
    if (breakerHuman) {
      adjustAttitude(world, k, breaker, 100);
      treatiesOf(cv)[breaker] =
        (treatiesOf(cv)[breaker] ?? 0) | TREATY.grudge | TREATY.grudgeRenewed;
      lastWarTurnsOf(cb)[k] = ctx.turn;
    }
    setTreaty(world, k, breaker, TREATY.war | TREATY.metThisTurn | TREATY.contact);
    treatiesOf(ck)[breaker] = (treatiesOf(ck)[breaker] ?? 0) | TREATY.grudge | TREATY.grudgeRenewed;
  }
}

/**
 * Cancelling an alliance (VERIFIED 0x0044e525 for the treaty; the unit relocation 0x0044e1e2 is
 * read only as far as its targets): the alliance bit goes, and each side's units standing in
 * the other's cities move to the nearest own city (INFERRED: a coastal one for sea units; the
 * original's further conditions were not read).
 */
export function cancelAlliance(world: World, a: number, b: number, events: DiplomacyEvent[]): void {
  clearTreaty(world, a, b, TREATY.alliance);
  events.push({
    kind: 'diplomacy',
    text: `the alliance between ${name(world, a)} and ${name(world, b)} is cancelled`,
    a,
    b,
  });
  for (const [owner, host] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const u of world.units) {
      if (u.owner !== owner) continue;
      const city = world.cityAt(u.position.x, u.position.y);
      if (!city || city.owner !== host) continue;
      let best: { x: number; y: number } | null = null;
      let bestD = 9999;
      for (const c of world.cities) {
        if (c.owner !== owner) continue;
        const dd = distance(world, u.position, c.position);
        if (dd < bestD) {
          bestD = dd;
          best = c.position;
        }
      }
      if (best) u.position = { x: best.x, y: best.y };
    }
  }
}

/**
 * Declaring war (VERIFIED 0x00526d80): the strain and broken bits go; at cease-fire or peace with
 * a human on either side the treaty is broken (above); peace and alliance go; with contact the
 * war bit is set, both attitudes jump to the maximum, and the first declaration of the war marks
 * the declarer's word (bit 12) — the routine answers true then.
 */
export function declareWar(
  world: World,
  a: number,
  b: number,
  ctx: DiplomacyContext,
  events: DiplomacyEvent[],
): boolean {
  clearTreaty(world, a, b, TREATY.strain | TREATY.broken);
  if (
    (treaty(world, b, a) & (TREATY.ceaseFire | TREATY.peace)) !== 0 &&
    (ctx.isHuman(a) || ctx.isHuman(b))
  )
    breakTreaty(world, a, b, null, ctx, events);
  clearTreaty(world, a, b, TREATY.peace | TREATY.alliance);
  if (!hasTreaty(world, a, b, TREATY.contact)) return false;
  setTreaty(world, a, b, TREATY.war);
  const ca = civOf(world, a);
  const cb = civOf(world, b);
  if (ca) attitudesOf(ca)[b] = 100;
  if (cb) attitudesOf(cb)[a] = 100;
  events.push({
    kind: 'diplomacy',
    text: `${name(world, a)} declare war on ${name(world, b)}`,
    a,
    b,
  });
  if (
    !hasTreaty(world, b, a, TREATY.warDeclared) &&
    !hasTreaty(world, a, b, TREATY.warDeclared) &&
    ca
  ) {
    treatiesOf(ca)[b] = (treatiesOf(ca)[b] ?? 0) | TREATY.warDeclared;
    return true;
  }
  return false;
}

function name(world: World, slot: number): string {
  return civOf(world, slot)?.name ?? `civilization ${slot}`;
}

function gov(world: World, slot: number): number {
  return civOf(world, slot)?.government ?? 0;
}

/**
 * The contact review (0x00510ac7, the computer-to-computer branch): records contact, and on
 * first contact or every fourth turn for the pair decides peace (with tech exchange and the
 * alliance review) or war. With a human on either side the negotiation screens are replaced
 * by `ctx.humanAccepts` (INFERRED stand-in).
 */
export function reviewRelations(
  world: World,
  a: number,
  b: number,
  ctx: DiplomacyContext,
  events: DiplomacyEvent[],
): void {
  if (a === 0 || b === 0 || a === b || ctx.turn === 0) return;
  const first = !hasTreaty(world, a, b, TREATY.contact);
  if (first) setTreaty(world, a, b, TREATY.firstContact);
  setTreaty(world, a, b, TREATY.contact | TREATY.metThisTurn);
  if (!first && ((ctx.turn + a + b) & 3) !== 0) return;
  if (ctx.requestTalk && ctx.isHuman(a) !== ctx.isHuman(b)) {
    if (ctx.isHuman(a)) ctx.requestTalk(a, b);
    else ctx.requestTalk(b, a);
    return;
  }
  const peaceful = (x: number, y: number): boolean => {
    if (ctx.isHuman(x)) {
      const t = treaty(world, x, y);
      if ((t & TREATY.peace) !== 0) return true;
      return ctx.humanAccepts ? ctx.humanAccepts('peace', x, y) : true;
    }
    return (
      !wantsWar(world, x, y, ctx) ||
      ctx.ownsWonder(y, WONDER.greatWall) ||
      ctx.ownsWonder(y, WONDER.unitedNations) ||
      (gov(world, x) > 4 && !atWar(world, x, y))
    );
  };
  if (peaceful(a, b) && peaceful(b, a)) {
    if (!ctx.isHuman(a) && !ctx.isHuman(b)) techExchange(world, a, b, ctx);
    if (!hasTreaty(world, a, b, TREATY.peace)) {
      const forced = hasTreaty(world, a, b, TREATY.war)
        ? ctx.ownsWonder(b, WONDER.unitedNations) || ctx.ownsWonder(a, WONDER.unitedNations)
          ? ' (the United Nations force it)'
          : ctx.ownsWonder(b, WONDER.greatWall) || ctx.ownsWonder(a, WONDER.greatWall)
            ? ' (the Great Wall forces it)'
            : ''
        : '';
      events.push({
        kind: 'diplomacy',
        text: `${name(world, a)} and ${name(world, b)} sign peace${forced}`,
        a,
        b,
      });
      setTreaty(world, a, b, TREATY.peace);
      return;
    }
    // Already at peace: the alliance review.
    const allied = hasTreaty(world, a, b, TREATY.alliance);
    let gate = allied;
    let humanGate = false;
    if (ctx.control(a) === 7 && ctx.control(b) > 3) {
      gate = false;
      humanGate = true;
    }
    if (ctx.control(b) === 7 && ctx.control(a) > 3) {
      gate = false;
      humanGate = true;
    }
    let alliesAround = 0;
    let candidate = -1;
    let leading = false;
    for (let c = 1; c < 8; c++) {
      if (c === a || c === b) continue;
      if (!hasTreaty(world, a, c, TREATY.alliance) && !hasTreaty(world, b, c, TREATY.alliance)) {
        leading =
          ctx.isHuman(c) &&
          ctx.control(c) === 7 &&
          ctx.difficulty !== 0 &&
          ctx.cityCount(c) >= 5 &&
          ctx.turn >= 201;
        if (leading) {
          candidate = c;
          break;
        }
        if (ctx.difficulty !== 0) {
          if (gate) {
            if (!hasTreaty(world, a, c, TREATY.peace) && !hasTreaty(world, b, c, TREATY.peace)) {
              candidate = c;
              break;
            }
          } else if (
            !humanGate &&
            atWar(world, a, c) &&
            ctx.control(a) <= ctx.control(c) &&
            atWar(world, b, c) &&
            ctx.control(b) <= ctx.control(c)
          ) {
            candidate = c;
            break;
          }
        }
      } else alliesAround += 1;
    }
    const mainRep = ctx.mainHuman === null ? 0 : (civOf(world, ctx.mainHuman)?.reputation ?? 0);
    if (candidate < 1 || ((!leading || mainRep < alliesAround) && alliesAround !== 0 && !gate)) {
      if (allied) {
        events.push({
          kind: 'diplomacy',
          text: `${name(world, a)} and ${name(world, b)} end their alliance`,
          a,
          b,
        });
        clearTreaty(world, a, b, TREATY.alliance);
      }
      return;
    }
    if (ctx.isHuman(a) || ctx.isHuman(b)) {
      const human = ctx.isHuman(a) ? a : b;
      const other = human === a ? b : a;
      if (!allied && !(ctx.humanAccepts ? ctx.humanAccepts('alliance', human, other) : false))
        return;
    }
    if (!allied) {
      events.push({
        kind: 'diplomacy',
        text: `${name(world, a)} and ${name(world, b)} form an alliance against ${name(world, candidate)}`,
        a,
        b,
      });
      const joined =
        allyJoinsWar(world, a, candidate, b, ctx, events) ||
        allyJoinsWar(world, b, candidate, a, ctx, events);
      if (ctx.isHuman(candidate) && !ctx.spaceshipLaunched(candidate) && !joined) {
        if (!hasTreaty(world, a, candidate, TREATY.war))
          setTreaty(world, a, candidate, TREATY.allyWarPending);
        if (!hasTreaty(world, b, candidate, TREATY.war))
          setTreaty(world, b, candidate, TREATY.allyWarPending);
      }
    }
    setTreaty(world, a, b, TREATY.alliance);
    return;
  }
  if (!hasTreaty(world, a, b, TREATY.war) || first) {
    const hadPeace =
      hasTreaty(world, a, b, TREATY.peace) && !hasTreaty(world, a, b, TREATY.alliance);
    events.push({
      kind: 'diplomacy',
      text: hadPeace
        ? `${name(world, a)} cancel their peace treaty with ${name(world, b)}: war`
        : `${name(world, a)} declare war on ${name(world, b)}`,
      a,
      b,
    });
    clearTreaty(world, a, b, TREATY.peace);
    setTreaty(world, a, b, TREATY.war);
    if (hasTreaty(world, a, b, TREATY.vendetta)) {
      clearTreaty(world, a, b, TREATY.vendetta);
      const ca = civOf(world, a);
      if (ca) treatiesOf(ca)[b] = (treatiesOf(ca)[b] ?? 0) | TREATY.grudge;
    }
  }
}

/**
 * First contacts for a civilization's units: a foreign city or unit beside one of them with no
 * contact yet triggers the review. VERIFIED trigger in the original (the arrival handler
 * 0x0041aad6): on each arrival, a foreign unit on one of the eight neighbouring squares whose
 * owner has no contact bit with the mover opens the contact when the mover may talk (a land
 * unit on land, not a Caravan); the engine sweeps once per turn instead (INFERRED equivalence).
 */
export function contactSweep(
  world: World,
  slot: number,
  ctx: DiplomacyContext,
  events: DiplomacyEvent[],
): void {
  if (slot === 0) return;
  const seen = new Set<number>();
  for (const u of world.units) {
    if (u.owner !== slot) continue;
    for (const n of world.neighbours(u.position.x, u.position.y)) {
      if (!n) continue;
      const other = world.cityAt(n.x, n.y)?.owner ?? world.unitsAt(n.x, n.y)[0]?.owner;
      if (other === undefined || other === slot || other === 0 || seen.has(other)) continue;
      if (hasTreaty(world, slot, other, TREATY.contact)) continue;
      seen.add(other);
      reviewRelations(world, slot, other, ctx, events);
    }
  }
}

/**
 * Military aid (0x005129ba): a computer civilization sends one strong land unit to an ally at
 * war with someone at least as strong, from a city on a full land mass (or any, when it is at
 * war with nobody) to an ally's city that wants units on a defend-plan land mass.
 */
export function militaryAid(
  world: World,
  slot: number,
  ctx: DiplomacyContext,
  events: DiplomacyEvent[],
): boolean {
  const mine = ctx.tallies(slot);
  const plans = civOf(world, slot)?.strategy?.plans;
  let myWars = 0;
  for (let c = 1; c < 8; c++) if (c !== slot && hasTreaty(world, slot, c, TREATY.war)) myWars += 1;
  for (let ally = 1; ally < 8; ally++) {
    if (ally === slot || !hasTreaty(world, slot, ally, TREATY.alliance)) continue;
    if (!((ctx.tallies(ally)?.strength ?? 0) <= (mine?.strength ?? 0) || myWars === 0)) continue;
    for (let foe = 1; foe < 8; foe++) {
      if (foe === slot || foe === ally) continue;
      const t = treaty(world, ally, foe);
      if ((t & TREATY.war) === 0 || (t & TREATY.attacked) === 0) continue;
      if ((ctx.tallies(ally)?.strength ?? 0) > (ctx.tallies(foe)?.strength ?? 0)) continue;
      if (ctx.control(ally) > ctx.control(foe)) continue;
      let best: Unit | null = null;
      let bestValue = 0;
      for (const u of world.units) {
        if (u.owner !== slot) continue;
        const type = ctx.rules.units[u.type];
        if (!type || type.role >= 2 || type.domain !== 0) continue;
        const city = world.cityAt(u.position.x, u.position.y);
        if (!city || world.unitsAt(u.position.x, u.position.y).length <= 1) continue;
        const lm = (world.landmass[world.index(u.position.x, u.position.y)] ?? 0) & 63;
        const plan = plans?.[lm] ?? 5;
        if (!(plan === 4 || (plan === 5 && myWars === 0))) continue;
        const value =
          (type.defence + type.attack * 2) * (type.hitPointsTens * 10 - u.hitPointsLost);
        if (value > bestValue) {
          bestValue = value;
          best = u;
        }
      }
      if (!best) continue;
      for (const city of world.cities) {
        if (city.owner !== ally) continue;
        if (world.unitsAt(city.position.x, city.position.y).length === 0) continue;
        const lm = (world.landmass[world.index(city.position.x, city.position.y)] ?? 0) & 63;
        if ((civOf(world, ally)?.strategy?.plans[lm] ?? 5) !== 1) continue;
        if (
          world
            .neighbours(city.position.x, city.position.y)
            .some((n) => n && world.unitsAt(n.x, n.y).some((u) => u.owner !== ally))
        )
          continue;
        const unit = best;
        unit.owner = ally;
        unit.homeCity = city.id;
        unit.position = { x: city.position.x, y: city.position.y };
        unit.order = null;
        unit.gotoTarget = null;
        events.push({
          kind: 'diplomacy',
          text: `${name(world, slot)} send ${ctx.rules.units[unit.type]?.name ?? 'a unit'} to help ${name(world, ally)} at ${city.name}`,
          a: slot,
          b: ally,
        });
        return true;
      }
    }
  }
  return false;
}

/**
 * The per-turn diplomacy housekeeping for one civilization (0x0051326d without its
 * government part): transient bits, strained truces, lapsing wars, periodic reviews, ally tech
 * exchange, military aid.
 */
export function diplomacyTurn(
  world: World,
  slot: number,
  ctx: DiplomacyContext,
  events: DiplomacyEvent[],
): void {
  const civ = civOf(world, slot);
  if (!civ || slot === 0) return;
  const human = ctx.isHuman(slot);
  const t = treatiesOf(civ);
  civ.patience = ctx.nextInt(100);
  if (ctx.nextInt(3) === 0) civ.civFlags = (civ.civFlags ?? 0) ^ 4;
  if (ctx.turn % 3 === 0 && (civ.restraint ?? 0) !== 0) civ.restraint = (civ.restraint ?? 0) - 1;
  for (let j = 1; j < 8; j++) {
    if (j === slot) continue;
    t[j] = (t[j] ?? 0) & 0xff5fbfff; // first contact, war-this-turn and bit 23 lapse
    if (!ctx.inPlay(j) || human) continue;
    // INFERRED placement: the original asks at the diplomacy screen; the engine asks before a
    // computer player's review of the pair.
    if (ctx.negotiationAllowed && !ctx.negotiationAllowed(slot, j)) continue;
    if (((t[j] ?? 0) & TREATY.strain) !== 0) {
      const rep = civOf(world, j)?.reputation ?? 0;
      const chance = Math.max(1, Math.min(3, 3 - (rep >> 2)));
      if ((chance - 1 < 1 ? 0 : ctx.nextInt(chance)) === 0) {
        if (!hasTreaty(world, slot, j, TREATY.alliance)) {
          t[j] = ((t[j] ?? 0) & ~(TREATY.ceaseFire | TREATY.peace | TREATY.strain)) | 0x80840;
          const cj = civOf(world, j);
          if (cj) {
            const table = lastWarTurnsOf(cj);
            table[slot] = Math.max(table[slot] ?? -1, ctx.turn - 8);
          }
          events.push({
            kind: 'diplomacy',
            text: `the truce between ${name(world, slot)} and ${name(world, j)} breaks`,
            a: slot,
            b: j,
          });
        } else {
          adjustAttitude(world, slot, j, 100);
          const cj = civOf(world, j);
          if (cj) lastWarTurnsOf(cj)[slot] = -1;
          t[j] = (t[j] ?? 0) & ~TREATY.strain;
        }
      }
    }
    if (!ctx.isHuman(j)) {
      t[j] = (t[j] ?? 0) & ~TREATY.techGiven;
      if ((ctx.turn & 0x1f) === 0) {
        if (((t[j] ?? 0) & TREATY.grudgeRenewed) === 0) t[j] = (t[j] ?? 0) & ~TREATY.grudge;
        t[j] = (t[j] ?? 0) & ~TREATY.grudgeRenewed;
      }
      if ((ctx.turn & 0xf) === 0) {
        if (((t[j] ?? 0) & TREATY.metThisTurn) === 0) {
          if (!hasTreaty(world, slot, j, TREATY.alliance)) {
            if (!hasTreaty(world, slot, j, TREATY.peace) || !(ctx.optionBit0 ?? true)) {
              const grudge =
                hasTreaty(world, slot, j, TREATY.grudge) ||
                hasTreaty(world, j, slot, TREATY.grudge);
              if (
                hasTreaty(world, slot, j, TREATY.contact) &&
                hasTreaty(world, slot, j, TREATY.war) &&
                !grudge
              )
                events.push({
                  kind: 'diplomacy',
                  text: `the war between ${name(world, slot)} and ${name(world, j)} peters out`,
                  a: slot,
                  b: j,
                });
              if (hasTreaty(world, slot, j, TREATY.contact) && !grudge)
                clearTreaty(world, slot, j, TREATY.contact);
            } else {
              reviewRelations(world, slot, j, ctx, events);
            }
          } else {
            techExchange(world, slot, j, ctx);
          }
        }
        t[j] = (t[j] ?? 0) & ~TREATY.metThisTurn;
      } else if (
        (ctx.turn & 7) === 0 &&
        hasTreaty(world, slot, j, TREATY.alliance) &&
        ((t[j] ?? 0) & TREATY.metThisTurn) === 0
      ) {
        techExchange(world, slot, j, ctx);
      }
    }
  }
  if (!human) militaryAid(world, slot, ctx, events);
}

/** Squares to the nearest city of a civilization (for the UI and tests). */
export function nearestOwnCityDistance(world: World, slot: number, x: number, y: number): number {
  let best = 9999;
  for (const c of world.cities) {
    if (c.owner !== slot) continue;
    best = Math.min(best, distance(world, { x, y }, c.position));
  }
  return best;
}

export const DIPLOMACY_OCEAN = OCEAN;
export const DIPLOMACY_FLAGS = SquareFlag;
