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
  corruption,
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
  grantAdvance,
} from './research.js';
import type { Rng } from './rng.js';
import { ADVANCE, advanceIndex, GOVERNMENT, IMPROVEMENT, type EngineRules } from './rules.js';
import { beginUnitsTurn, type UnitTurnEvent } from './turnStart.js';
import { cityPollution, meltdownRoll, pollutionRoll, type PollutionEvent } from './pollution.js';
import { aiChooseProduction } from './aiBuild.js';
import { runStrategy, type StrategyEvent } from './aiStrategy.js';
import { gameYear } from './calendar.js';
import { routeIncomeTotal, type TradeContext } from './trade.js';
import {
  barbarianMoves,
  spawnBarbarians,
  type BarbarianContext,
  type BarbarianEvent,
} from './barbarians.js';
import {
  attitude,
  atPeace as treatyAtPeace,
  atWar as treatyAtWar,
  canAttack as treatyCanAttack,
  contactSweep,
  diplomacyTurn,
  type DiplomacyContext,
  type DiplomacyEvent,
} from './diplomacy.js';
import {
  aiPickGovernment,
  anarchyTurn,
  cityGovernmentScores,
  civGovernmentScores,
  resetGovernmentScores,
  type GovernmentEvent,
} from './government.js';
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
  /** Header barbarian activity: 0 villages only, 1 roving, 2 restless, 3 raging. */
  barbarianActivity?: number;
}

export type GrowthNote =
  { kind: 'grew' | 'starved' | 'destroyed' } | { kind: 'growth-blocked'; blockedBy: number };
export type CityTurnEvent = CityEvent | ProductionEvent | UpkeepEvent | GrowthNote | PollutionEvent;

export type TurnEvent =
  | { slot: number; city: number; event: CityTurnEvent }
  | { slot: number; event: ResearchEvent }
  | { slot: number; event: UnitTurnEvent }
  | { slot: number; event: AiUnitEvent }
  | { slot: number; event: StrategyEvent }
  | { slot: number; event: BarbarianEvent }
  | { slot: number; event: DiplomacyEvent }
  | { slot: number; event: GovernmentEvent }
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

  /** Are two civilizations at war (the treaty rules of diplomacy.ts)? */
  atWar(a: number, b: number): boolean {
    return treatyAtWar(this.world, a, b);
  }

  /** The human's answer to a computer proposal; unset accepts peace and declines alliances. */
  humanAccepts?: (kind: 'peace' | 'alliance', human: number, other: number) => boolean;

  tradeContext(): TradeContext {
    return {
      turn: this.state.turn,
      knows: (s, a) => this.knows(s, a),
      researchCost: (s) => {
        const c = this.world.civs.find((x) => x.slot === s);
        return c ? this.researchCostFor(c) : 100;
      },
      foodBoxRows: (s) => {
        const c = this.world.civs.find((x) => x.slot === s);
        return boxRows(
          this.rules,
          { isHuman: c?.isHuman ?? true, difficulty: this.state.difficulty },
          false,
        );
      },
      nextInt: (n) => this.rng.nextInt(n),
    };
  }

  diplomacyContext(): DiplomacyContext {
    const humans = this.world.civs.filter((c) => c.isHuman).map((c) => c.slot);
    const civ = (s: number) => this.world.civs.find((c) => c.slot === s);
    return {
      rules: this.rules,
      turn: this.state.turn,
      difficulty: this.state.difficulty,
      isHuman: (s) => civ(s)?.isHuman ?? false,
      inPlay: (s) => civ(s)?.inPlay ?? false,
      ownsWonder: (s, i) => this.ownsWonder(s, i),
      knows: (s, a) => this.knows(s, a),
      cityCount: (s) => this.citiesOf(s).length,
      advancesOf: (s) => civ(s)?.advancesCount ?? 0,
      attackPersonality: (s) => this.rules.leaders?.[civ(s)?.tribe ?? -1]?.attack ?? 0,
      control: (s) => (civ(s)?.isHuman ? 7 : this.state.difficulty),
      tallies: (s) => {
        const st = civ(s)?.strategy;
        return st
          ? {
              unitsOn: st.unitsOn,
              attackOn: st.attackOn,
              citiesOn: st.citiesOn,
              strength: st.strengthSum,
            }
          : undefined;
      },
      grantAdvance: (s, a) => {
        const c = civ(s);
        if (c && c.knownAdvances[a] !== true) grantAdvance(c, a, 'other');
      },
      spaceshipLaunched: () => false,
      mainHuman: humans[0] ?? null,
      nextInt: (n) => this.rng.nextInt(n),
      ...(this.humanAccepts ? { humanAccepts: this.humanAccepts } : {}),
    };
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
      // Trade routes (0x004b6359): the net trade before routes is the city's term and is kept
      // for its partners; the route income joins the trade before the split.
      const ownNet = raw.trade - corruption(this.rules, city, ctx, raw.trade, false);
      city.lastTrade = ownNet;
      const routes = routeIncomeTotal(this.world, this.rules, city, ownNet);
      const trade = tradeSplit(this.rules, city, ctx, raw.trade + routes);
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
    // Government preference scores (0x004bc513): the cities' share.
    if (this.world.cities.includes(city)) {
      const tt = totals();
      const leader = this.rules.leaders?.[civ.tribe ?? -1];
      const settlersFood =
        civ.government <= GOVERNMENT.monarchy
          ? this.rules.cosmic.settlersFoodEarlyGovt
          : this.rules.cosmic.settlersFoodLateGovt;
      cityGovernmentScores(
        this.rules,
        civ,
        city,
        {
          foodProduced: tt.raw.food,
          foodEaten:
            city.size * this.rules.cosmic.foodPerCitizen + settlers().length * settlersFood,
          unitsSupported: homed().length,
          unitsAway: tt.support.abroad,
        },
        (i) => this.ownsWonder(slot, i),
        { attack: leader?.attack ?? 0, civilize: leader?.civilize ?? 0 },
        this.wonderCity(IMPROVEMENT.shakespeares) === city.id,
      );
    }
    return out;
  }

  /** The civilization's turn: cities last-to-first, then the AI's rates. */
  processCivilization(slot: number): TurnEvent[] {
    const out: TurnEvent[] = [];
    const civ = this.civ(slot);
    this.revealFor(slot);
    resetGovernmentScores(civ);
    {
      const events: DiplomacyEvent[] = [];
      contactSweep(this.world, slot, this.diplomacyContext(), events);
      for (const e of events) out.push({ slot, event: e });
    }
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
    // Diplomacy and government (0x0051326d) run after the cities and before the strategic layer.
    {
      const leader = this.rules.leaders?.[civ.tribe ?? -1];
      const human = this.world.civs.find((c) => c.isHuman);
      civGovernmentScores(civ, {
        isHuman: civ.isHuman,
        knows: (a) => this.knows(slot, a),
        ownsWonder: (i) => this.ownsWonder(slot, i),
        personality: { attack: leader?.attack ?? 0, civilize: leader?.civilize ?? 0 },
        control: civ.isHuman ? 7 : this.state.difficulty,
        advances: civ.advancesCount,
        treasury: civ.treasury,
        mainHuman: human
          ? {
              diplomatsAndSpies: this.world.units.filter(
                (u) => u.owner === human.slot && (u.type === 46 || u.type === 47),
              ).length,
              advances: human.advancesCount,
              treasury: human.treasury,
              government: human.government,
              control: 7,
            }
          : null,
        spaceshipLaunched: false,
        anyHumanSpaceshipLaunched: false,
        difficulty: this.state.difficulty,
        bloodlust: false,
        scienceRate: civ.scienceRate,
      });
      const govEvents: GovernmentEvent[] = [];
      anarchyTurn(
        this.world,
        civ,
        { turn: this.state.turn, isHuman: civ.isHuman, ownsStatue: this.ownsWonder(slot, 58) },
        govEvents,
      );
      if (!civ.isHuman && ((this.state.turn + slot) & 7) === 0 && civ.government !== 0) {
        const picked = aiPickGovernment(this.world, civ, {
          knows: (a) => this.knows(slot, a),
          ownsStatue: this.ownsWonder(slot, 58),
          nextInt: (n) => this.rng.nextInt(n),
        });
        if (picked !== null)
          govEvents.push({
            kind: 'government',
            text: `${civ.name} adopt government ${picked}`,
            slot,
          });
      }
      for (const e of govEvents) out.push({ slot, event: e });
      const dipEvents: DiplomacyEvent[] = [];
      diplomacyTurn(this.world, slot, this.diplomacyContext(), dipEvents);
      for (const e of dipEvents) out.push({ slot, event: e });
    }
    // The strategic layer runs for every civilization (tallies, plans; orders for computer players).
    const humans = this.world.civs.filter((c) => c.isHuman).map((c) => c.slot);
    for (const e of runStrategy(this.world, this.rules, slot, {
      turn: this.state.turn,
      difficulty: this.state.difficulty,
      atWar: (a, b) => this.atWar(a, b),
      isHuman: (s) => this.world.civs.find((c) => c.slot === s)?.isHuman ?? false,
      knows: (s, a) => this.knows(s, a),
      expand: (s) => {
        const tribe = this.world.civs.find((c) => c.slot === s)?.tribe ?? 0;
        return this.rules.leaders?.[tribe]?.expand ?? 0;
      },
      strategyOf: (s) => this.world.civs.find((c) => c.slot === s)?.strategy,
      mainHuman: humans[0] ?? null,
      realisticCombat: this.state.realisticCombat,
    })) {
      out.push({ slot, event: e });
    }
    if (!civ.isHuman) {
      let names = this.citiesOf(slot).length;
      for (const e of aiMoveUnits(this.world, this.rules, slot, {
        rng: this.rng,
        civ,
        difficulty: this.state.difficulty,
        realisticCombat: this.state.realisticCombat,
        turn: this.state.turn,
        atWar: (other) => this.atWar(slot, other),
        canAttack: (other) => treatyCanAttack(this.world, slot, other),
        atPeace: (other) => treatyAtPeace(this.world, slot, other),
        knows: (a) => this.knows(slot, a),
        wondersOf: (s) => this.wondersOf(s),
        cityCount: (s) => this.citiesOf(s).length,
        nextCityName: () => `${civ.adjective} City ${++names}`,
        guerillaWarfareDiscovered: (this.state.firstDiscoveredBy[34] ?? 0) !== 0,
        ...(civ.strategy ? { strategy: civ.strategy } : {}),
        trade: this.tradeContext(),
        attitude: (other) => attitude(this.world, slot, other),
        nuclearPower: this.knows(slot, ADVANCE.nuclearPower),
        magellans: this.ownsWonder(slot, IMPROVEMENT.magellans),
        lighthouse: this.ownsWonder(slot, IMPROVEMENT.lighthouse),
        damageSlowsUnits: this.state.realisticCombat,
      })) {
        out.push({ slot, event: e });
      }
    }
    {
      // Contacts made by this turn's moves (the original notices them as each unit arrives).
      const events: DiplomacyEvent[] = [];
      contactSweep(this.world, slot, this.diplomacyContext(), events);
      for (const e of events) out.push({ slot, event: e });
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
        // VERIFIED meaning: a continent plan in the expansion states (5, room to grow) on some
        // land mass the civilization holds (aiStrategy.ts).
        expanding: this.citiesOf(slot).some(
          (c) =>
            (civ.strategy?.plans[
              (this.world.landmass[this.world.index(c.position.x, c.position.y)] ?? 0) & 63
            ] ?? 5) === 5,
        ),
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
    // The turn driver spawns barbarians before the civilizations move (0x00467591, turn ≠ 0).
    if (this.state.turn !== 0) {
      for (const e of spawnBarbarians(this.world, this.rules, this.barbarianContext()))
        out.push({ slot: 0, event: e });
    }
    for (const civ of this.world.civs) {
      if (civ.slot === 0 || !civ.inPlay) continue;
      civ.treasury = civ.treasury > 30000 ? 30000 : civ.treasury < 0 ? 0 : civ.treasury;
      out.push(...this.processCivilization(civ.slot));
    }
    out.push(...this.processBarbarians());
    this.state.turn += 1;
    return out;
  }

  private barbarianContext(): BarbarianContext {
    const humans = this.world.civs.filter((c) => c.isHuman).map((c) => c.slot);
    return {
      rng: this.rng,
      turn: this.state.turn,
      year: gameYear(this.state.turn, this.state.difficulty),
      difficulty: this.state.difficulty,
      activity: this.state.barbarianActivity ?? 0,
      realisticCombat: this.state.realisticCombat,
      anyoneKnows: (a) => this.world.civs.some((c) => c.slot !== 0 && c.knownAdvances[a] === true),
      humanKnows: (a) => this.world.civs.some((c) => c.isHuman && c.knownAdvances[a] === true),
      isHuman: (s) => this.world.civs.find((c) => c.slot === s)?.isHuman ?? false,
      mainHuman: humans[0] ?? null,
      cityCount: (s) => this.citiesOf(s).length,
      wondersOf: (s) => this.wondersOf(s),
      guerillaWarfareDiscovered: (this.state.firstDiscoveredBy[34] ?? 0) !== 0,
      ...(this.payRansom ? { payRansom: this.payRansom } : {}),
      damageSlowsUnits: this.state.realisticCombat,
    };
  }

  /** A human's answer to a barbarian ransom demand; unset means refuse (INFERRED default). */
  payRansom?: (city: City, amount: number) => boolean;

  /** The barbarians' turn: unit upkeep as for anyone, then the barbarian move chooser. */
  private processBarbarians(): TurnEvent[] {
    const out: TurnEvent[] = [];
    const barbarians = this.world.civs.find((c) => c.slot === 0);
    if (!barbarians) return out;
    if (!this.world.units.some((u) => u.owner === 0)) return out;
    for (const e of beginUnitsTurn(this.world, this.rules, this.rng, barbarians, {
      knows: () => false,
      nuclearPower: false,
      magellans: false,
      lighthouse: false,
      damageSlowsUnits: this.state.realisticCombat,
    })) {
      out.push({ slot: 0, event: e });
    }
    for (const e of barbarianMoves(this.world, this.rules, barbarians, this.barbarianContext()))
      out.push({ slot: 0, event: e });
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
        // The advisor's "military" continent flag: plans 0 and 1 (aiStrategy.ts); before the first
        // strategy pass the INFERRED default stands in.
        ...(() => {
          const lm =
            (this.world.landmass[this.world.index(city.position.x, city.position.y)] ?? 0) & 63;
          const lmOf = (c: City) =>
            (this.world.landmass[this.world.index(c.position.x, c.position.y)] ?? 0) & 63;
          const plan = civ.strategy?.plans[lm];
          const nearest = this.world.cities
            .filter((c) => c.owner === city.owner && c !== city)
            .reduce(
              (best, c) => Math.min(best, distance(this.world, city.position, c.position)),
              9999,
            );
          const warWithoutCitiesHere =
            plan === 4 &&
            this.world.civs.some(
              (o) =>
                o.slot !== city.owner &&
                o.slot !== 0 &&
                this.atWar(city.owner, o.slot) &&
                !this.world.cities.some((c) => c.owner === o.slot && lmOf(c) === lm),
            );
          return {
            ...(plan !== undefined ? { plan } : {}),
            citiesOnContinent: this.world.cities.filter(
              (c) => c.owner === city.owner && lmOf(c) === lm,
            ).length,
            warWithoutCitiesHere,
            nearestOwnCityDistance: nearest,
            workerNearby: city.workerNearby === true,
          };
        })(),
        expanding: (() => {
          const plan =
            civ.strategy?.plans[
              (this.world.landmass[this.world.index(city.position.x, city.position.y)] ?? 0) & 63
            ];
          return plan === undefined ? cityCount < 4 : plan === 0 || plan === 1;
        })(),
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
