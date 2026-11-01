import { advanceIndex, type EngineRules } from './rules.js';

/**
 * The computer player's value of an advance (0x004920ac, VERIFIED), the number the research
 * choice (0x00494f3a) rolls against. docs/engine/rules-research.md. The original addresses
 * several advances, units and improvements by their RULES slot (Space Flight 76, Fusion Power
 * 32, Computers 16, University 85, Invention 38, Industrialization 37, Navigation 57; the
 * Trireme, Caravel, Frigate, Transport and Bomber; the Aqueduct, Sewer System, Port Facility
 * and the three spaceship parts), so modified rules keep those roles by slot.
 */
export interface ResearchValueContext {
  knows: (slot: number, advance: number) => boolean;
  /** Bit n set when slot n knows the advance (the header's known-by table). */
  knownBy: (advance: number) => number;
  humanMask: number;
  isHuman: (slot: number) => boolean;
  /** The treaty word of a toward b carries the war bit. */
  atWar: (a: number, b: number) => boolean;
  advancesOf: (slot: number) => number;
  reputationOf: (slot: number) => number;
  /** The leader's civilize trait and the tribe (RULES @LEADERS index). */
  civilize: number;
  tribe: number;
  /** Options byte 8 bit 2. */
  researchDearer: boolean;
  ownsWonder: (slot: number, wonder: number) => boolean;
  /** Slot holding the wonder, or null. */
  wonderOwner: (wonder: number) => number | null;
  /** The strategic tally of sea units (civilization +0x6a, INFERRED the same count). */
  seaUnits: number;
  maxCitySize: number;
}

/** Is `advance` the advance `target` or one of its prerequisite ancestors (0x00492025)? */
export function leadsTo(rules: EngineRules, target: number, advance: number): boolean {
  if (target < 0) return false;
  if (target === advance) return true;
  const r = rules.advances[target];
  if (!r) return false;
  const p1 = advanceIndex(r.preq1);
  const p2 = advanceIndex(r.preq2);
  return (
    (p1 !== null && leadsTo(rules, p1, advance)) || (p2 !== null && leadsTo(rules, p2, advance))
  );
}

/** The tribes' favourite and disliked advances (the routine's switch on the @LEADERS index). */
const TRIBE_TASTES: Record<number, [number, number][]> = {
  0: [
    [39, 2],
    [8, 2],
    [86, 2],
    [55, -1],
  ],
  1: [[12, 1]],
  2: [
    [6, 1],
    [82, 1],
    [60, 1],
  ],
  3: [[47, 2]],
  4: [
    [21, 2],
    [15, -1],
    [73, 1],
    [16, 1],
    [42, 1],
  ],
  5: [
    [64, 1],
    [8, 1],
    [1, 1],
    [46, 1],
    [55, -1],
    [60, 2],
  ],
  6: [
    [64, 2],
    [36, 1],
    [56, 1],
    [9, 1],
    [55, -1],
  ],
  7: [
    [15, 2],
    [60, 1],
    [34, 1],
  ],
  8: [
    [64, 2],
    [36, 1],
    [56, 1],
    [9, 1],
    [8, -1],
    [39, -1],
  ],
  9: [
    [42, 1],
    [81, 1],
    [17, 1],
  ],
  10: [
    [35, -2],
    [55, -1],
  ],
  11: [[35, 1]],
  12: [[55, 1]],
  15: [
    [79, 1],
    [52, 1],
  ],
  16: [[46, 1]],
  17: [[55, 1]],
  18: [
    [64, 2],
    [36, 1],
    [56, 1],
    [9, 1],
    [55, -1],
  ],
  19: [
    [64, 2],
    [36, 1],
    [56, 1],
    [9, 1],
    [55, -1],
  ],
  20: [[36, 2]],
};

const unitPreq = (rules: EngineRules, t: number): number =>
  advanceIndex(rules.units[t]?.preq) ?? -1;
const improvementPreq = (rules: EngineRules, i: number): number =>
  advanceIndex(rules.improvements[i]?.preq) ?? -1;

export function advanceValue(
  rules: EngineRules,
  slot: number,
  advance: number,
  ctx: ResearchValueContext,
): number {
  const human = ctx.isHuman(slot);
  // A computer player at war with a human ahead of it loses a point of civilize for every
  // advance the two share (never below −1), and all of it against a human of reputation above 6.
  let civilize = ctx.civilize;
  if (!human && civilize >= 0) {
    for (let h = 1; h < 8; h++) {
      if (!ctx.isHuman(h) || !ctx.atWar(slot, h) || ctx.advancesOf(slot) >= ctx.advancesOf(h))
        continue;
      for (let a = 1; a < 63; a++) {
        if (!ctx.knows(slot, a) || !ctx.knows(h, a)) continue;
        if (civilize > -1) civilize -= 1;
        if (ctx.reputationOf(h) > 6) civilize = -1;
      }
    }
  }
  const rule = rules.advances[advance];
  let v = (rule?.civilizedModifier ?? 0) * civilize + (rule?.aiValue ?? 0);
  // The naval ladder: toward the Trireme 3, the Caravel or Frigate 2, the Transport 1 (doubled
  // under dearer research); for a computer player (or anyone under dearer research) it is one
  // point — the "no one to trade with" branch that would add the whole ladder can never run,
  // since the test it makes finds another civilization as soon as the player knows an advance.
  let ladder = 0;
  if (leadsTo(rules, unitPreq(rules, 32), advance)) ladder = 3;
  else if (
    leadsTo(rules, unitPreq(rules, 33), advance) ||
    leadsTo(rules, unitPreq(rules, 35), advance)
  )
    ladder = 2;
  else if (leadsTo(rules, unitPreq(rules, 43), advance)) ladder = 1;
  if (ctx.researchDearer) ladder <<= 1;
  if (ladder !== 0 && (!human || ctx.researchDearer)) v += 1;
  if (improvementPreq(rules, 34) === advance) v += Math.trunc(ctx.seaUnits / 4);
  if (!human) {
    if ((ctx.humanMask & ctx.knownBy(76)) !== 0) {
      if (leadsTo(rules, 32, advance)) v += 2;
      for (let i = 35; i < 38; i++) if (improvementPreq(rules, i) === advance) v += 3;
    }
    const bomber = unitPreq(rules, 28);
    if (
      bomber >= 0 &&
      (ctx.humanMask & ctx.knownBy(bomber)) !== 0 &&
      leadsTo(rules, bomber, advance)
    )
      v += bomber === advance ? 5 : 2;
    for (let w = 0; w < 28; w++) {
      if (advanceIndex(rules.improvements[39 + w]?.expiresWith) !== advance) continue;
      if (ctx.ownsWonder(slot, 39 + w) && advance !== 37) v -= 2;
      const owner = ctx.wonderOwner(39 + w);
      if (owner !== null && ctx.isHuman(owner)) v += 2;
    }
  }
  const aqueduct = improvementPreq(rules, 9);
  const sewer = improvementPreq(rules, 23);
  if (advance === aqueduct || advance === sewer) {
    let cap = rules.cosmic.sewerSize;
    if ((advance === aqueduct ? 1 : 0) <= ctx.maxCitySize) cap = rules.cosmic.aqueductSize;
    if (cap !== 0) v += 2;
  }
  if (ctx.civilize >= 0 && ctx.knows(slot, 85)) {
    if (leadsTo(rules, 16, advance)) v += ctx.civilize + 1;
    if (advance === 16) v += 2;
  }
  if (ctx.knows(slot, 38) && leadsTo(rules, 37, advance)) v += ctx.knows(slot, 57) ? 2 : 1;
  for (const [a, d] of TRIBE_TASTES[ctx.tribe] ?? []) if (a === advance) v += d;
  if (ctx.tribe === 12 && ladder !== 0) v += 1;
  if (ctx.tribe === 17 && ladder > 1) v += 1;
  if (ctx.knownBy(advance) === 0) v += 1;
  for (let l = 0; l < rules.advances.length; l++) {
    const r = rules.advances[l];
    if (!r || !ctx.knows(slot, l)) continue;
    if (advanceIndex(r.preq1) === advance || advanceIndex(r.preq2) === advance) v -= 1;
  }
  return v < 2 ? 1 : v;
}
