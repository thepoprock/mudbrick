/**
 * The game loop: one civilization's turn, one city's turn, and the end of a full turn.
 *
 * Specification: docs/engine/rules-turn.md and rules-city.md. Every step marked VERIFIED there
 * is implemented in the original's order; steps the original performs that are not yet decoded
 * are listed in the docs and skipped here. Choices the original leaves to the player are
 * surfaced as events for the UI; the AI's choices here are deliberate placeholders (INFERRED)
 * until the AI routines are read.
 */
import {
  boxRows,
  distance,
  FOOD,
  mood,
  processGrowth,
  rawYields,
  settlersFood,
  shieldTotals,
  squareYield,
  tradeSplit,
  unitSupport,
  type CityContext,
} from './city.js';
import {
  applyCityMood,
  disbandForShortage,
  researchableAdvances,
  type CityEvent,
} from './outcome.js';
import { processProduction, type ProductionContext, type ProductionEvent } from './production.js';
import {
  addScience,
  aiRates,
  cityScienceToCiv,
  reachableAdvanceCount,
  researchCost,
  type ResearchEvent,
} from './research.js';
import type { Rng } from './rng.js';
import { ADVANCE, advanceIndex, GOVERNMENT, IMPROVEMENT, type EngineRules } from './rules.js';
import { beginUnitsTurn, type UnitTurnEvent } from './turnStart.js';
import { cityPollution, meltdownRoll, pollutionRoll, type PollutionEvent } from './pollution.js';
import { aiChooseProduction } from './aiBuild.js';
import { aiMoveUnits, type AiUnitEvent } from './aiUnits.js';
import { releaseCitySite } from './fertility.js';
import { inEnemyZoc } from './movement.js';
import { payUpkeep, type UpkeepEvent } from './upkeep.js';
import { CITY_CENTRE_INDEX, type City, type Civ, type World } from './world.js';

export interface GameState {
  turn: number;
  /** 0 Chieftain … 5 Deity. */
  difficulty: number;
  /** Simplified combat OFF. */
  realisticCombat: boolean;
  /** Per advance: slot that discovered it first, 0 = nobody. */
  firstDiscoveredBy: number[];
  /** Scenario parameters in effect. */
  scenario?: { techParadigm: number; fixedCost: boolean };
  researchDearer?: boolean;
  researchCheaper?: boolean;
  /** Scenario: governments may not change. */
  forbidGovernmentChange?: boolean;
  /** Scenario: no pollution at all. */
  eliminatePollution?: boolean;
  /** World pollution count (the save header's value), kept for global warming later. */
  pollutionSquares?: number;
  /** Pairs of slots at peace; every other pair is at war (INFERRED stand-in for the treaty table). */
  peace?: [number, number][];
}

export type GrowthNote =
  { kind: 'grew' | 'starved' | 'destroyed' } | { kind: 'growth-blocked'; blockedBy: number };
export type CityTurnEvent = CityEvent | ProductionEvent | UpkeepEvent | GrowthNote | PollutionEvent;

export type TurnEvent =
  | { slot: number; city: number; event: CityTurnEvent }
  | { slot: number; event: ResearchEvent }
  | { slot: number; event: UnitTurnEvent }
  | { slot: number; event: AiUnitEvent }
  | { slot: number; event: { kind: 'rates'; science: number; tax: number; luxuries: number } };

/** Advances that end the AI's science: Fusion Power, The Laser, and the spaceship parts' prerequisites. */
export const AI_SPACE_ADVANCES = [32, 41] as const;

export class Game {
  private nextUnitId: number;

  constructor(
    public readonly world: World,
    public readonly rules: EngineRules,
    public readonly rng: Rng,
    public readonly state: GameState,
  ) {
    this.nextUnitId = world.units.reduce((m, u) => Math.max(m, u.id), -1) + 1;
  }

  civ(slot: number): Civ {
    const c = this.world.civs.find((x) => x.slot === slot);
    if (!c) throw new RangeError(`no civilization in slot ${slot}`);
    return c;
  }

  citiesOf(slot: number): City[] {
    return this.world.cities.filter((c) => c.owner === slot);
  }

  knows(slot: number, advance: number): boolean {
    return this.civ(slot).knownAdvances[advance] === true;
  }

  /** The civilization holds the wonder in one of its cities. */
  ownsWonder(slot: number, improvement: number): boolean {
    return this.world.cities.some((c) => c.owner === slot && c.improvements[improvement]);
  }

  /** City holding a wonder, anywhere in the world. */
  wonderCity(improvement: number): number | null {
    const c = this.world.cities.find((x) => x.improvements[improvement]);
    return c ? c.id : null;
  }

  /**
   * Are two civilizations at war? INFERRED: without diplomacy every pair is at war (the
   * original's state before contact) unless listed in `state.peace`; barbarians always are.
   */
  atWar(a: number, b: number): boolean {
    if (a === b) return false;
    if (a === 0 || b === 0) return true;
    return !(
      this.state.peace?.some(([x, y]) => (x === a && y === b) || (x === b && y === a)) ?? false
    );
  }

  /** Mark what a civilization's units and cities can see (INFERRED sight radii). */
  revealFor(slot: number): void {
    for (const u of this.world.units)
      if (u.owner === slot) this.world.reveal(u.position.x, u.position.y, slot);
    for (const c of this.world.cities)
      if (c.owner === slot) this.world.revealRadius(c.position.x, c.position.y, slot);
  }

  /** Wonders held by a civilization, by @IMPROVE index. */
  wondersOf(slot: number): boolean[] {
    const out = Array<boolean>(67).fill(false);
    for (const c of this.world.cities) {
      if (c.owner !== slot) continue;
      for (let i = 39; i < 67; i++) if (c.improvements[i]) out[i] = true;
    }
    return out;
  }

  /** Squares to the nearest own city holding the Palace; 32 when none. */
  distanceToCapital(city: City): number {
    let best = 32;
    for (const c of this.world.cities) {
      if (c.owner !== city.owner || !c.improvements[IMPROVEMENT.palace]) continue;
      best = Math.min(best, distance(this.world, city.position, c.position));
    }
    return best;
  }

  cityContext(city: City): CityContext {
    const civ = this.civ(city.owner);
    const slot = city.owner;
    const isCapital = city.improvements[IMPROVEMENT.palace] === true;
    return {
      government: civ.government,
      difficulty: this.state.difficulty,
      isHuman: civ.isHuman,
      cityCount: this.citiesOf(slot).length,
      scienceRate: civ.scienceRate,
      taxRate: civ.taxRate,
      knows: (a) => this.knows(slot, a),
      ownsWonder: (i) => this.ownsWonder(slot, i),
      distanceToCapital: isCapital ? 0 : this.distanceToCapital(city),
      // INFERRED: 1 for the capital, 2 once Railroad is known; 0 elsewhere until 0x00468c65 is read.
      connectedToCapital: isCapital ? (this.knows(slot, ADVANCE.railroad) ? 2 : 1) : 0,
    };
  }

  productionContext(city: City): ProductionContext {
    const civ = this.civ(city.owner);
    const slot = city.owner;
    return {
      government: civ.government,
      isHuman: civ.isHuman,
      difficulty: this.state.difficulty,
      realisticCombat: this.state.realisticCombat,
      cityCount: this.citiesOf(slot).length,
      knows: (a) => this.knows(slot, a),
      ownsWonder: (i) => this.ownsWonder(slot, i),
      wonderCity: (i) => this.wonderCity(i),
      canBuildSpaceship: this.wonderCity(IMPROVEMENT.apolloProgram) !== null,
      shieldRows: boxRows(
        this.rules,
        { isHuman: civ.isHuman, difficulty: this.state.difficulty },
        true,
      ),
    };
  }

  researchCostFor(civ: Civ): number {
    const human = this.world.civs.find((c) => c.isHuman);
    return researchCost(civ.advancesCount, {
      isHuman: civ.isHuman,
      difficulty: this.state.difficulty,
      turn: this.state.turn,
      leaderAdvances: human?.advancesCount ?? civ.advancesCount,
      reachableAdvances: reachableAdvanceCount(this.rules),
      techParadigm: this.rules.cosmic.techParadigm ?? 10,
      ...(this.state.scenario ? { scenario: this.state.scenario } : {}),
      ...(this.state.researchDearer ? { researchDearer: true } : {}),
      ...(this.state.researchCheaper ? { researchCheaper: true } : {}),
    });
  }

  /** One city's turn in the verified order. */
  processCity(city: City): TurnEvent[] {
    const out: TurnEvent[] = [];
    const slot = city.owner;
    const civ = this.civ(slot);
    const ctx = this.cityContext(city);
    const push = (event: CityTurnEvent) => out.push({ slot, city: city.id, event });
    const homed = () => this.world.units.filter((u) => u.homeCity === city.id);
    const settlers = () => homed().filter((u) => this.rules.units[u.type]?.role === 5);

    this.ensureWorkers(city, ctx);
    // 1. Growth and starvation on last turn's stored food.
    const growth = processGrowth(this.rules, city, ctx, settlers());
    if (growth.disbandedSettler) {
      this.world.units.splice(this.world.units.indexOf(growth.disbandedSettler), 1);
    }
    if (growth.starved) push({ kind: 'starved' });
    if (growth.destroyed) {
      this.world.cities.splice(this.world.cities.indexOf(city), 1);
      releaseCitySite(this.world, city);
      push({ kind: 'destroyed' });
      return out;
    }
    if (growth.grew) push({ kind: 'grew' });
    if (growth.blockedBy) push({ kind: 'growth-blocked', blockedBy: growth.blockedBy });
    if (growth.grew) this.placeNewWorker(city, ctx);

    // 2. Totals.
    const shakespeares = this.wonderCity(IMPROVEMENT.shakespeares);
    const totals = () => {
      const raw = rawYields(this.world, this.rules, city, ctx);
      const support = unitSupport(this.world, this.rules, city, ctx, homed());
      const shields = shieldTotals(this.rules, city, ctx, raw.shields, support.shields);
      const trade = tradeSplit(this.rules, city, ctx, raw.trade);
      const m = mood(this.rules, city, ctx, {
        luxuries: trade.luxuries,
        militaryInCity: support.inCity,
        militaryAbroad: support.abroad,
        noMilitaryUnhappiness: support.abroad === 0,
        ...(shakespeares !== null ? { shakespearesCity: shakespeares } : {}),
      });
      return { raw, support, shields, trade, mood: m };
    };
    let t = totals();

    // 3. Food surplus into storage.
    const eaten =
      city.size * this.rules.cosmic.foodPerCitizen +
      t.support.settlers * settlersFood(this.rules, civ.government);
    const foodSurplus = t.raw.food - eaten;
    city.foodStored += foodSurplus;

    // 4. Production, shortage disband, totals again.
    const prodEvents = processProduction(
      this.world,
      this.rules,
      this.rng,
      city,
      this.productionContext(city),
      {
        surplus: t.shields.surplus,
        supplied: [],
        nextUnitId: () => this.nextUnitId++,
      },
    );
    for (const e of prodEvents) {
      push(e);
      if (e.kind === 'capitalization') civ.treasury += e.gold;
      if (e.kind === 'ghost-town') return out;
      if (
        !civ.isHuman &&
        (e.kind === 'built-unit' ||
          e.kind === 'built-improvement' ||
          e.kind === 'built-wonder' ||
          e.kind === 'bad-build' ||
          e.kind === 'bad-space')
      ) {
        this.aiChooseProduction(city, t); // the original re-chooses after every completion (0x00430b61 with 99)
      }
    }
    for (const e of disbandForShortage(this.world, this.rules, city, ctx, t.raw.shields)) push(e);
    t = totals();

    // 5. Disorder, celebration, gold.
    for (const e of applyCityMood(
      this.rules,
      civ,
      city,
      {
        happy: t.mood.happy,
        unhappy: t.mood.unhappy,
        shieldSurplus: t.shields.surplus,
        foodSurplus,
        foodProduced: t.raw.food,
        foodEaten: eaten,
        tax: t.trade.tax,
      },
      { allowRevolt: !this.state.forbidGovernmentChange },
    )) {
      push(e);
      if (e.kind === 'rapture-growth') this.placeNewWorker(city, ctx);
    }

    // 6. Science.
    const science = cityScienceToCiv(this.rules, civ, t.trade.science, {
      isHuman: civ.isHuman,
      difficulty: this.state.difficulty,
      firstDiscoveredBy: this.state.firstDiscoveredBy,
    });
    for (const e of addScience(civ, science, (c) => this.researchCostFor(c))) {
      out.push({ slot, event: e });
      if (e.kind === 'discovered') {
        if ((this.state.firstDiscoveredBy[e.advance] ?? 0) === 0)
          this.state.firstDiscoveredBy[e.advance] = slot;
        if (e.advance === 60 /* Philosophy */ && this.state.firstDiscoveredBy[60] === slot)
          civ.freeAdvancePending = true;
      }
      if (e.kind === 'choose-research' && !civ.isHuman) this.aiChooseResearch(civ);
    }

    // 7. Pollution roll and meltdown (the original rolls for human cities here; INFERRED for the AI).
    if (this.world.cities.includes(city)) {
      const pctx = {
        knows: (a: number) => this.knows(slot, a),
        advancesCount: civ.advancesCount,
        difficulty: this.state.difficulty,
        ...(this.state.eliminatePollution ? { eliminatePollution: true } : {}),
      };
      const counter = { value: this.state.pollutionSquares ?? 0 };
      const value = cityPollution(
        city,
        t.shields.produced,
        pctx,
        this.ownsWonder(slot, IMPROVEMENT.hooverDam),
      );
      const dirty = pollutionRoll(this.world, this.rng, city, value, pctx, counter);
      this.state.pollutionSquares = counter.value;
      if (dirty) push(dirty);
      const melt = meltdownRoll(this.rng, city, pctx);
      if (melt) push(melt);
    }

    // 8. Upkeep (the original does this here for humans; where the AI pays is not yet read — INFERRED same).
    for (const e of payUpkeep(this.rules, civ, city, {
      difficulty: this.state.difficulty,
      ownsWonder: (i) => this.ownsWonder(slot, i),
      shieldRows: boxRows(
        this.rules,
        { isHuman: civ.isHuman, difficulty: this.state.difficulty },
        true,
      ),
    })) {
      push(e);
    }
    return out;
  }

  /** The civilization's turn: cities last-to-first, then the AI's rates. */
  processCivilization(slot: number): TurnEvent[] {
    const out: TurnEvent[] = [];
    const civ = this.civ(slot);
    this.revealFor(slot);
    for (const e of beginUnitsTurn(this.world, this.rules, this.rng, civ, {
      knows: (a) => this.knows(slot, a),
      nuclearPower: this.knows(slot, ADVANCE.nuclearPower),
      magellans: this.ownsWonder(slot, IMPROVEMENT.magellans),
      lighthouse: this.ownsWonder(slot, IMPROVEMENT.lighthouse),
      damageSlowsUnits: this.state.realisticCombat,
    })) {
      out.push({ slot, event: e });
    }
    const cities = this.citiesOf(slot);
    let anyDisorder = false;
    let anyLargeQuiet = false;
    for (let i = cities.length - 1; i >= 0; i--) {
      const city = cities[i];
      if (!city || !this.world.cities.includes(city)) continue;
      const events = this.processCity(city);
      out.push(...events);
      if (city.inDisorder) anyDisorder = true;
      if (
        city.size > 5 &&
        !city.inDisorder &&
        !events.some((e) => 'city' in e && e.event.kind === 'celebration-start')
      ) {
        anyLargeQuiet = true; // INFERRED reading of "happy equals unhappy"
      }
    }
    if (!civ.isHuman) {
      // INFERRED interim behaviour until the original's move chooser is read (docs/engine/ai-units.md).
      let names = this.citiesOf(slot).length;
      for (const e of aiMoveUnits(this.world, this.rules, slot, {
        rng: this.rng,
        civ,
        difficulty: this.state.difficulty,
        realisticCombat: this.state.realisticCombat,
        turn: this.state.turn,
        atWar: (other) => this.atWar(slot, other),
        knows: (a) => this.knows(slot, a),
        wondersOf: (s) => this.wondersOf(s),
        cityCount: (s) => this.citiesOf(s).length,
        nextCityName: () => `${civ.adjective} City ${++names}`,
        nuclearPower: this.knows(slot, ADVANCE.nuclearPower),
        magellans: this.ownsWonder(slot, IMPROVEMENT.magellans),
        lighthouse: this.ownsWonder(slot, IMPROVEMENT.lighthouse),
        damageSlowsUnits: this.state.realisticCombat,
      })) {
        out.push({ slot, event: e });
      }
    }
    if (!civ.isHuman) {
      const civilize = this.rules.leaders?.[civ.tribe ?? -1]?.civilize ?? 0;
      const space = [
        ...AI_SPACE_ADVANCES,
        ...[35, 36, 37].map((i) => advanceIndex(this.rules.improvements[i]?.preq)),
      ];
      const rates = aiRates(civ, {
        turn: this.state.turn,
        anyDisorder,
        anyLargeContentCity: anyLargeQuiet,
        civilize,
        expanding: true, // INFERRED: continent plans are not modelled
        knowsAllSpaceAdvances: space.every((a) => a !== null && civ.knownAdvances[a] === true),
      });
      civ.scienceRate = rates.science;
      civ.taxRate = rates.tax;
      out.push({ slot, event: { kind: 'rates', ...rates } });
    }
    return out;
  }

  /** End the turn: every civilization in play, in slot order (INFERRED), then the counter. */
  endTurn(): TurnEvent[] {
    const out: TurnEvent[] = [];
    for (const civ of this.world.civs) {
      if (civ.slot === 0 || !civ.inPlay) continue;
      civ.treasury = civ.treasury > 30000 ? 30000 : civ.treasury < 0 ? 0 : civ.treasury;
      out.push(...this.processCivilization(civ.slot));
    }
    this.state.turn += 1;
    return out;
  }

  /** Give every citizen a square or a specialist slot (the original's auto-arrange runs on founding and growth). */
  ensureWorkers(city: City, ctx: CityContext = this.cityContext(city)): void {
    const specialists =
      city.specialists.entertainers + city.specialists.taxCollectors + city.specialists.scientists;
    let working = 0;
    for (let i = 0; i < CITY_CENTRE_INDEX; i++) if ((city.worked >> i) & 1) working++;
    let guard = 0;
    while (working + specialists < city.size && guard++ < 25) {
      const before = city.worked;
      this.placeNewWorker(city, ctx);
      if (city.worked === before) break; // became an entertainer
      working++;
    }
  }

  /** Put a new citizen on the best free square by food, then shields and trade (INFERRED simplification of 0x004b49b5). */
  placeNewWorker(city: City, ctx: CityContext): void {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < CITY_CENTRE_INDEX; i++) {
      if ((city.worked >> i) & 1) continue;
      const p = this.world.radiusSquare(city.position.x, city.position.y, i);
      if (!p) continue;
      if (this.world.cities.some((c) => c !== city && c.position.x === p.x && c.position.y === p.y))
        continue;
      const food = squareYield(this.world, this.rules, city, i, FOOD, ctx);
      const score =
        food * 4 +
        squareYield(this.world, this.rules, city, i, 1, ctx) * 2 +
        squareYield(this.world, this.rules, city, i, 2, ctx);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0) city.worked |= 1 << best;
    else city.specialists.entertainers += 1;
  }

  /**
   * The AI's research choice (VERIFIED shape, 0x00494f3a): every researchable advance scores
   * `rand() % value` and the highest wins, where the value is the RULES civilized modifier ×
   * the leader's civilize trait + the AI value (the base of 0x004920ac; its situational bonuses
   * are not yet modelled).
   */
  aiChooseResearch(civ: Civ): void {
    const options = researchableAdvances(this.rules, civ);
    const civilize = this.rules.leaders?.[civ.tribe ?? -1]?.civilize ?? 0;
    let best = -1;
    let pick: number | null = null;
    for (const a of options) {
      const adv = this.rules.advances[a];
      const value = Math.max(1, (adv?.civilizedModifier ?? 0) * civilize + (adv?.aiValue ?? 1));
      const score = value > 1 ? this.rng.nextInt(value) : 0;
      if (score > best) {
        best = score;
        pick = a;
      }
    }
    civ.researching = pick;
  }

  /** The AI's production choice (docs/engine/ai-city.md), from the city's current totals. */
  aiChooseProduction(
    city: City,
    totals?: {
      raw: { food: number; shields: number; trade: number };
      support: { shields: number; settlers: number; inCity: number };
      shields: { produced: number };
      trade: { corruption: number };
      mood: { happy: number; unhappy: number };
    },
  ): void {
    const civ = this.civ(city.owner);
    const ctx = this.cityContext(city);
    const leader = this.rules.leaders?.[civ.tribe ?? -1];
    const homed = this.world.units.filter((u) => u.homeCity === city.id);
    const t = totals ?? {
      raw: rawYields(this.world, this.rules, city, ctx),
      support: unitSupport(this.world, this.rules, city, ctx, homed),
      shields: { produced: 0 },
      trade: { corruption: 0 },
      mood: { happy: 0, unhappy: 0 },
    };
    if (!totals) {
      t.shields = shieldTotals(this.rules, city, ctx, t.raw.shields, t.support.shields);
      const split = tradeSplit(this.rules, city, ctx, t.raw.trade);
      t.trade = { corruption: split.corruption };
      t.mood = mood(this.rules, city, ctx, {
        luxuries: split.luxuries,
        militaryInCity: t.support.inCity,
        militaryAbroad: 0,
        noMilitaryUnhappiness: true,
      });
    }
    const here = this.world.unitsAt(city.position.x, city.position.y);
    const defenders = here.filter(
      (u) => u.owner === city.owner && this.rules.units[u.type]?.role === 1,
    ).length;
    let threat = 0;
    for (let i = 0; i < CITY_CENTRE_INDEX; i++) {
      const p = this.world.radiusSquare(city.position.x, city.position.y, i);
      if (p) threat += this.world.unitsAt(p.x, p.y).filter((u) => u.owner !== city.owner).length;
    }
    const eaten =
      city.size * this.rules.cosmic.foodPerCitizen +
      t.support.settlers * settlersFood(this.rules, civ.government);
    const cityCount = this.citiesOf(city.owner).length;
    city.production = aiChooseProduction({
      world: this.world,
      rules: this.rules,
      civ,
      city,
      ctx,
      facts: {
        shields: t.shields.produced,
        support: t.support.shields,
        trade: t.raw.trade,
        corruption: t.trade.corruption,
        foodSurplus: t.raw.food - eaten,
        happy: t.mood.happy,
        unhappy: t.mood.unhappy,
        settlersSupported: t.support.settlers,
        defendersInCity: defenders,
        threat,
        zocAtCity: inEnemyZoc(this.world, city.position.x, city.position.y, city.owner),
        attack: leader?.attack ?? 0,
        expand: leader?.expand ?? 0,
        civilize: leader?.civilize ?? 0,
        difficulty: this.state.difficulty,
        turn: this.state.turn,
        simplifiedCombat: !this.state.realisticCombat,
        spaceRace: 0,
        hasCapital: this.world.cities.some(
          (c) => c.owner === city.owner && c.improvements[IMPROVEMENT.palace],
        ),
        expanding: cityCount < 4,
      },
      cityCount,
      wonderCity: (i) => this.wonderCity(i),
      ownsWonder: (i) => this.ownsWonder(city.owner, i),
      canBuildImprovement: (i) => this.canBuildImprovement(city, i),
    });
  }

  /** May the city build this improvement: prerequisite known, not built, wonders unclaimed. */
  canBuildImprovement(city: City, imp: number): boolean {
    const rule = this.rules.improvements[imp];
    if (!rule || imp === 0 || rule.preq?.kind === 'never') return false;
    if (imp >= 39 && this.wonderCity(imp) !== null) return false;
    if (imp < 39 && city.improvements[imp]) return false;
    if (imp >= 35 && imp <= 37 && this.wonderCity(IMPROVEMENT.apolloProgram) === null) return false;
    const pre = advanceIndex(rule.preq);
    return pre === null || this.knows(city.owner, pre);
  }
}

export { GOVERNMENT };
