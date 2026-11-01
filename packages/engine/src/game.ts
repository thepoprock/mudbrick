/**
 * The game loop: one civilization's turn, one city's turn, and the end of a full turn.
 *
 * Specification: docs/engine/rules-turn.md and rules-city.md. Every step marked VERIFIED there
 * is implemented in the original's order; steps the original performs that are not yet decoded
 * are listed in the docs and skipped here. Choices the original leaves to the player are
 * surfaced as events for the UI.
 */
import {
  boxRows,
  distance,
  mood,
  processGrowth,
  rawYields,
  settlersFood,
  shieldTotals,
  tradeSplit,
  unitSupport,
  workerStatus,
  type CityContext,
  corruption,
  assignWorkers,
  gridDistance,
} from './city.js';
import {
  applyCityMood,
  disbandForDisorder,
  disbandForShortage,
  researchChoices,
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
import {
  ADVANCE,
  advanceIndex,
  GOVERNMENT,
  IMPROVEMENT,
  type EngineRules,
  DOMAIN_SEA,
} from './rules.js';
import { beginUnitsTurn, type UnitTurnEvent } from './turnStart.js';
import { fallout } from './nuclear.js';
import { enterHut } from './huts.js';
import { rushEmptyCity } from './aiShips.js';
import { cityPollution, meltdownRoll, pollutionRoll, type PollutionEvent } from './pollution.js';
import { aiChooseProduction } from './aiBuild.js';
import { runStrategy, type StrategyEvent } from './aiStrategy.js';
import { gameYear, formatYear, type CalendarOptions } from './calendar.js';
import { routeIncomeTotal, type TradeContext, routeModifier } from './trade.js';
import type { EspionageContext } from './espionage.js';
import {
  aiNextPartKind,
  buildPart,
  checkArrivals,
  hasLaunched,
  spaceRaceOn,
  spaceRacePressure,
  type SpaceshipContext,
  type SpaceshipEvent,
} from './spaceship.js';
import { computeSupplyDemand, supplyDemandDue } from './supplyDemand.js';
import { terraformTasks } from './aiTerraform.js';
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
  adjustAttitude,
  canAttack as treatyCanAttack,
  treatiesOf,
  contactSweep,
  diplomacyTurn,
  type DiplomacyContext,
  type DiplomacyEvent,
  hasTreaty,
  TREATY,
} from './diplomacy.js';
import {
  aiPickGovernment,
  throneOf,
  anarchyTurn,
  cityGovernmentScores,
  civGovernmentScores,
  governmentScoresOf,
  resetGovernmentScores,
  type GovernmentEvent,
  startRevolution,
} from './government.js';
import { aiMoveUnits, type AiUnitEvent } from './aiUnits.js';
import { removeCity } from './fertility.js';
import { civilizationScore, retirementStage, type ScoreBreakdown } from './score.js';
import { advanceValue, type ResearchValueContext } from './aiResearch.js';
import { restartCivilization, type NewGameLeader } from './newGame.js';
import { lookAround } from './sight.js';
import {
  newEventState,
  ScenarioEvents,
  type EventContext,
  type EventState,
  type ScenarioEffect,
  type ScenarioEvent,
} from './events.js';
import { inEnemyZoc } from './movement.js';
import { payUpkeep, type UpkeepEvent } from './upkeep.js';
import { citySquareClick } from './humanOrders.js';
import { history, type HistoryEvent } from './reports.js';
import { advanceEffects, leonardoUpgrades, type AdvanceEvent } from './advances.js';
import {
  conversation,
  powerRanks,
  powerScores,
  relationsTurn,
  spokenBy,
  type Conversation,
  type NegotiationEnv,
} from './negotiation.js';
import { CITY_CENTRE_INDEX, type City, type Civ, type World, type Production } from './world.js';

export interface GameState {
  turn: number;
  /** 0 Chieftain … 5 Deity. */
  difficulty: number;
  /** Simplified combat OFF. */
  realisticCombat: boolean;
  /** Per advance: slot that discovered it first, 0 = nobody. */
  firstDiscoveredBy: number[];
  /** Scenario parameters in effect. */
  scenario?: ScenarioState;
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
  /** Time allowed a human's turn in milliseconds, 0 or unset for none (0x005d9790). */
  turnTimerMs?: number;
  /** Turns since the last battle between civilizations, counted from turn 200 (header +32). */
  turnsOfPeace?: number;
  /** Civilizations destroyed so far (header +25, INFERRED), for the conquest score bonus. */
  destroyedCivilizations?: number;
  /** Options byte 1 bit 0: "don't restart if eliminated". */
  noRestart?: boolean;
  /** Options byte 0 bit 7: bloodlust (no space race; the game ends by conquest). */
  bloodlust?: boolean;
  /** Save file offset 8: from this turn on the calendar advances one year per turn (−1 / unset: never). */
  calendarLockTurn?: number;
  /** The next slot to play in this round, 0 between rounds. */
  nextSlot?: number;
  /** The power graph's table, by quarter of the turn. */
  powerHistory?: number[][];
  /** Play by file: each human's turn ends with a saved game passed to the next (PBEM1). */
  byFile?: boolean;
  /** The human whose move it is. */
  movingHuman?: number;
  /** Past this turn the historian reports (header +0x142). */
  nextHistory?: number;
  /** Times each tribe (leader index) has played, for restarts. */
  tribesPlayed?: number[];
  /** The scenario's events (events.txt, parsed) and their mutable state. */
  scenarioEvents?: ScenarioEvent[];
  eventState?: EventState;
  /** DONTPLAYWONDERS has run. */
  wonderMoviesOff?: boolean;
  /** The game has ended: who won and how; 'retirement' is the year 2020 (the best score wins). */
  gameOver?: { winner: number; reason: 'spaceship' | 'conquest' | 'retirement' };
}

/** Scenario parameters the engine uses (docs/formats/save-format.md, the 100-byte block). */
export interface ScenarioState {
  techParadigm: number;
  fixedCost: boolean;
  /** The scenario calendar (0x0046520c): `startingYear + |yearsPerTurn| × turn − 1` when both are set. */
  yearsPerTurn?: number;
  startingYear?: number;
  /** The scenario's last turn (+88); the game ends on it, with a warning five turns before. */
  endTurn?: number;
  /** Scenario flag bit 1: victory by objectives; bit 2: wonders count as objectives. */
  objectiveVictory?: boolean;
  countWondersAsObjectives?: boolean;
  /** The protagonist slot (+90); 0 = each civilization is measured on its own objectives. */
  protagonist?: number;
  /** Objectives needed (+92 … +98). */
  objectives?: {
    decisiveVictory: number;
    marginalVictory: number;
    marginalDefeat: number;
    decisiveDefeat: number;
  };
}

/** The year limit's messages (0x0046b0fa). */
export interface RetirementEvent {
  kind: 'retirement';
  text: string;
  /** True when the game has ended. */
  final: boolean;
}

export type GrowthNote =
  { kind: 'grew' | 'starved' | 'destroyed' } | { kind: 'growth-blocked'; blockedBy: number };
export type CityTurnEvent = CityEvent | ProductionEvent | UpkeepEvent | GrowthNote | PollutionEvent;

export type TurnEvent =
  | { slot: number; city: number; event: CityTurnEvent }
  | { slot: number; event: ResearchEvent }
  | { slot: number; event: AdvanceEvent }
  | { slot: number; event: HistoryEvent }
  | { slot: number; event: UnitTurnEvent }
  | { slot: number; event: AiUnitEvent }
  | { slot: number; event: StrategyEvent }
  | { slot: number; event: BarbarianEvent }
  | { slot: number; event: SpaceshipEvent }
  | { slot: number; event: DiplomacyEvent }
  | { slot: number; event: RetirementEvent }
  | { slot: number; event: ScenarioEffect }
  | { slot: number; event: GovernmentEvent }
  | { slot: number; event: { kind: 'rates'; science: number; tax: number; luxuries: number } };

/** Advances that end the AI's science: Fusion Power, The Laser, and the spaceship parts' prerequisites. */
export const AI_SPACE_ADVANCES = [32, 41] as const;

/** The calendar options a game's state implies (research options, scenario calendar, calendar lock). */
export function calendarOptionsOf(state: GameState): CalendarOptions {
  const sc = state.scenario;
  return {
    researchDearer: state.researchDearer ?? false,
    researchCheaper: state.researchCheaper ?? false,
    ...(sc && sc.yearsPerTurn !== undefined && sc.startingYear !== undefined
      ? { scenario: { yearsPerTurn: sc.yearsPerTurn, startingYear: sc.startingYear } }
      : {}),
    ...(state.calendarLockTurn !== undefined ? { lockTurn: state.calendarLockTurn } : {}),
  };
}

/** The year shown for the game's turn (0x0046520c); months × 12 in a scenario counting months. */
export function yearOf(state: GameState): number {
  return gameYear(state.turn, state.difficulty, calendarOptionsOf(state));
}

/** The year as the original prints it, "July 1861" in a scenario counting months. */
export function yearTextOf(state: GameState): string {
  return formatYear(yearOf(state), calendarOptionsOf(state));
}

export class Game {
  private nextUnitId: number;

  /** Events raised outside a turn step (spaceship parts), drained after each civilization. */
  private pendingEvents: TurnEvent[] = [];
  /** Units killed this session, newest last. The original keeps its timeline in memory too. */
  casualtyLog: { turn: number; type: number; attacker: number; defender: number }[] = [];
  /** Set by a UI that can hold a conversation: reviews then queue here instead of deciding. */
  wantsTalks = false;
  pendingTalks: { human: number; computer: number; relations?: boolean }[] = [];

  /** Debug hook: the build advisor's candidates for a city (score, production). */
  buildTrace?: (city: City, score: number, p: Production) => void;

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
    if (this.wonderExpired(improvement)) return false;
    return this.world.cities.some((c) => c.owner === slot && c.improvements[improvement]);
  }

  /** Anyone knows the advance that ends this wonder (VERIFIED, 0x0043e2b0). */
  wonderExpired(improvement: number): boolean {
    const a = advanceIndex(this.rules.improvements[improvement]?.expiresWith);
    if (a === null) return false;
    return this.world.civs.some((c) => c.slot >= 1 && c.slot <= 7 && c.knownAdvances[a] === true);
  }

  /** The owner of a standing wonder, or null when it is unbuilt or expired (0x0043e3ef). */
  wonderOwner(improvement: number): number | null {
    if (this.wonderExpired(improvement)) return null;
    return this.world.cities.find((c) => c.improvements[improvement])?.owner ?? null;
  }

  /** Everything negotiation.ts reads of the game. */
  private rankCache: { turn: number; ranks: number[] } | null = null;

  /** A civilization's power rank, 7 for the strongest (0x005da842, set once a turn, 0x00465607). */
  powerRank(slot: number): number {
    if (this.rankCache?.turn !== this.state.turn) {
      const population = (s: number) => this.citiesOf(s).reduce((n, c) => n + c.size, 0);
      this.rankCache = { turn: this.state.turn, ranks: powerRanks(this.world, population) };
    }
    return this.rankCache.ranks[slot] ?? 0;
  }

  negotiationEnv(): NegotiationEnv {
    const strategy = (s: number) => this.world.civs.find((c) => c.slot === s)?.strategy;
    const ranks = powerRanks(this.world, (s) => this.citiesOf(s).reduce((n, c) => n + c.size, 0));
    const leader = (s: number) =>
      this.rules.leaders?.[this.world.civs.find((c) => c.slot === s)?.tribe ?? -1];
    return {
      world: this.world,
      rules: this.rules,
      rng: this.rng,
      turn: this.state.turn,
      difficulty: this.state.difficulty,
      bloodlust: this.state.bloodlust ?? false,
      rank: (s) => ranks[s] ?? 0,
      ownsWonder: (s, i) => this.ownsWonder(s, i),
      knows: (s, a) => this.knows(s, a),
      gain: (civ, advance) => {
        grantAdvance(civ, advance, 'other');
        this.advanceGained(civ, advance);
      },
      advanceValue: (slot, a) => {
        const c = this.world.civs.find((x) => x.slot === slot);
        return c ? advanceValue(this.rules, slot, a, this.researchValueContext(c)) : 1;
      },
      spaceRace: (s) => {
        const c = this.world.civs.find((x) => x.slot === s);
        return c ? this.spaceRace(c).pressure : false;
      },
      launched: (s) => {
        const c = this.world.civs.find((x) => x.slot === s);
        return c ? hasLaunched(c) : false;
      },
      unitsOn: (s, m) => strategy(s)?.unitsOn[m] ?? 0,
      attackOn: (s, m) => strategy(s)?.attackOn[m] ?? 0,
      planOn: (s, m) => strategy(s)?.plans[m] ?? 0,
      power: (s) => strategy(s)?.strengthSum ?? 0,
      dropSenate: (s) => {
        aiPickGovernment(this.world, this.civ(s), {
          knows: (x) => this.knows(s, x),
          ownsStatue: this.ownsWonder(s, IMPROVEMENT.statueOfLiberty),
          sneakAttack: true,
          nextInt: (n) => this.rng.nextInt(n),
        });
      },
      leaderAttack: (s) => leader(s)?.attack ?? 0,
      leaderCivilize: (s) => leader(s)?.civilize ?? 0,
      leaderExpand: (s) => leader(s)?.expand ?? 0,
    };
  }

  /** A conversation; answer each yielded dialog with the chosen entry. */
  talkTo(human: number, computer: number, calledByHuman: boolean): Conversation {
    return spokenBy(conversation(this.negotiationEnv(), human, computer, calledByHuman), computer);
  }

  /** The next queued conversation, if any. */
  nextPendingTalk(human: number): Conversation | null {
    const at = this.pendingTalks.findIndex((t) => t.human === human);
    const next = at >= 0 ? this.pendingTalks.splice(at, 1)[0] : undefined;
    if (!next) return null;
    const civ = this.world.civs.find((c) => c.slot === next.computer);
    if (next.relations && civ)
      return relationsTurn(
        this.negotiationEnv(),
        next.human,
        next.computer,
        this.spaceRace(civ).on,
      );
    return this.talkTo(next.human, next.computer, false);
  }

  /** With nobody to ask, every question is answered with its first entry. */
  private settleQuietly(talk: Conversation): void {
    let step = talk.next();
    while (!step.done) step = talk.next(0);
  }

  /** A click on a square of the city map (0x004c8b01), then the placement again. */
  clickCitySquare(city: City, square: number): boolean {
    const ctx = this.cityContext(city);
    const civ = this.civ(city.owner);
    const blocked =
      (workerStatus(this.world, this.rules, city, {
        turn: this.state.turn,
        isHuman: civ.isHuman,
        inCityTurn: false,
        settlers: 0,
        support: 0,
        isAlly: (a, b) => hasTreaty(this.world, a, b, TREATY.alliance),
        isHumanSlot: (s) => this.world.civs.find((c) => c.slot === s)?.isHuman ?? false,
      })[square] ?? 0) !== 0;
    const changed = citySquareClick(city, square, blocked);
    if (changed) this.ensureWorkers(city, ctx);
    return changed;
  }

  /**
   * Has the human earned a Throne Room piece (VERIFIED 0x0046708f)? With a Palace, past turn 1,
   * when the score reaches `Σ (7 − difficulty) × n / 2 + 1` for the next piece. Stops at 38.
   */
  throneDue(slot: number): boolean {
    const civ = this.civ(slot);
    if (!this.citiesOf(slot).some((c) => c.improvements[IMPROVEMENT.palace])) return false;
    if (this.state.turn <= 1) return false;
    const next = (civ.thronePieces ?? 0) + 1;
    let sum = 0;
    for (let i = 0; i <= next; i++) sum += (7 - this.state.difficulty) * i;
    if (this.scoreOf(slot).total < Math.trunc(sum / 2) + 1) return false;
    civ.thronePieces = next;
    if (next >= 38) return false;
    // VERIFIED 0x004389e0: only the first seven parts are checked, and the extras.
    return (
      throneOf(civ)
        .slice(0, 7)
        .some((v) => v < 4) || (~(civ.throneExtras ?? 0) & 0x7f) !== 0
    );
  }

  /** Leonardo's Workshop's sweep over a civilization's units (0x00492c44). */
  private runLeonardo(civ: Civ): void {
    for (const e of leonardoUpgrades(this.world, this.rules, civ, (a) => this.knows(civ.slot, a)))
      this.pendingEvents.push({ slot: civ.slot, event: e });
  }

  /** What a finished wonder does at once (VERIFIED, the end of 0x004b7e74). */
  private wonderEffect(
    civ: Civ,
    effect: 'manhattan' | 'darwin' | 'leonardo' | 'eiffel' | 'apollo',
  ) {
    if (effect === 'leonardo') this.runLeonardo(civ);
    if (effect === 'darwin') {
      this.darwinAdvance(civ);
      this.darwinAdvance(civ);
    }
    if (effect === 'manhattan') {
      for (const c of this.world.civs) {
        if (c.slot < 1 || c.slot > 7) continue;
        c.reputation = Math.min(6, Math.max(0, ((c.reputation ?? 0) + 1) >> 1));
      }
    }
    if (effect === 'eiffel' && !civ.eiffelApplied) {
      // 0x004b7d88: once per civilization, whoever built it first.
      civ.reputation = (civ.reputation ?? 0) >> 1;
      civ.eiffelApplied = true;
      for (let s = 1; s < 8; s++) {
        if (s === civ.slot) continue;
        adjustAttitude(this.world, s, civ.slot, -25);
        // One way only: what the others hold against the builder.
        const other = this.world.civs.find((c) => c.slot === s);
        if (other)
          treatiesOf(other)[civ.slot] = (treatiesOf(other)[civ.slot] ?? 0) & ~TREATY.vendetta;
      }
    }
    // 0x004bcc9a: the whole map is seen by everyone.
    if (effect === 'apollo') this.world.seen.fill(0xff);
  }

  /**
   * Darwin's Voyage, one of its two advances (VERIFIED, 0x0049675f): the current research target
   * completes at once and the beakers go. With no target the original picks one, asking a human;
   * here the advisor's recommendation stands in for that question.
   */
  private darwinAdvance(civ: Civ): void {
    if (civ.researching === null) {
      if (civ.isHuman) civ.researching = this.suggestResearch(civ);
      else this.aiChooseResearch(civ);
    }
    const advance = civ.researching;
    if (advance === null) return;
    grantAdvance(civ, advance, 'research');
    this.pendingEvents.push({
      slot: civ.slot,
      event: { kind: 'discovered', advance, free: false },
    });
    this.advanceGained(civ, advance);
  }

  /** The consequences of an advance `civ` has just been given (0x004935e5). */
  advanceGained(civ: Civ, advance: number): void {
    const first =
      advance <= 99 &&
      this.world.civs.every(
        (c) => c.slot < 1 || c.slot > 7 || c.slot === civ.slot || c.knownAdvances[advance] !== true,
      ) &&
      (this.state.firstDiscoveredBy[advance] ?? 0) === 0;
    const events = advanceEffects(this.world, this.rules, civ, advance, first, {
      turn: this.state.turn,
      firstDiscoveredBy: this.state.firstDiscoveredBy,
      wonderOwner: (i) => this.wonderOwner(i),
      knows: (s, a) => this.knows(s, a),
    });
    for (const e of events) this.pendingEvents.push({ slot: civ.slot, event: e });
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

  espionageContext(): EspionageContext {
    return {
      advanceGained: (c, a) => this.advanceGained(c, a),
      turn: this.state.turn,
      difficulty: this.state.difficulty,
      rng: this.rng,
      isHuman: (s) => this.world.civs.find((c) => c.slot === s)?.isHuman ?? false,
      knows: (s, a) => this.knows(s, a),
      ownsWonder: (s, i) => this.ownsWonder(s, i),
      wonderBuilt: (i) => this.world.cities.some((c) => c.improvements[i]),
      researchable: (a) => {
        const adv = this.rules.advances[a];
        return adv !== undefined && adv.preq1.kind !== 'never' && adv.preq2.kind !== 'never';
      },
      revolution: (s) => {
        const c = this.world.civs.find((x) => x.slot === s);
        if (c) startRevolution(this.world, c);
      },
    };
  }

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
      control: (s) => this.powerRank(s),
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
        if (c && c.knownAdvances[a] !== true) {
          grantAdvance(c, a, 'other');
          this.advanceGained(c, a);
        }
      },
      spaceshipLaunched: () => false,
      mainHuman: humans[0] ?? null,
      negotiationAllowed: (a, b) => this.negotiationAllowed(a, b),
      advanceValue: (slot, adv) => {
        const c = this.world.civs.find((x) => x.slot === slot);
        return c ? advanceValue(this.rules, slot, adv, this.researchValueContext(c)) : 1;
      },
      nextInt: (n) => this.rng.nextInt(n),
      ...(this.humanAccepts ? { humanAccepts: this.humanAccepts } : {}),
      ...(this.wantsTalks
        ? {
            requestTalk: (h: number, c: number) => {
              if (!this.pendingTalks.some((t) => t.human === h && t.computer === c))
                this.pendingTalks.push({ human: h, computer: c });
            },
          }
        : {}),
    };
  }

  /**
   * A city lost its last defender and lived (0x0052d472): a computer player rethinks production on
   * that land mass at once (0x00431591), and raiders turn for a human's (0x004f2495).
   */
  cityEmptied(city: City): void {
    const civ = this.civ(city.owner);
    if (civ.isHuman) {
      rushEmptyCity(this.world, this.rules, city);
      return;
    }
    const land = (c: City) => this.world.landmass[this.world.index(c.position.x, c.position.y)];
    for (const c of this.citiesOf(city.owner))
      if (land(c) === land(city)) this.aiChooseProduction(c);
  }

  /** Mark what a civilization's units and cities can see (unit sight VERIFIED, city radius INFERRED). */
  revealFor(slot: number): void {
    for (const u of this.world.units) if (u.owner === slot) lookAround(this.world, this.rules, u);
    for (const c of this.world.cities)
      if (c.owner === slot) this.world.revealRadius(c.position.x, c.position.y, slot);
  }

  /** Wonders held by a civilization, by @IMPROVE index. */
  wondersOf(slot: number): boolean[] {
    const out = Array<boolean>(67).fill(false);
    for (const c of this.world.cities) {
      if (c.owner !== slot) continue;
      for (let i = 39; i < 67; i++) if (c.improvements[i] && !this.wonderExpired(i)) out[i] = true;
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
      connectedToCapital: this.connectedToCapital(city, isCapital),
    };
  }

  /**
   * VERIFIED (0x004b33d7): the capital itself counts 1, 2 once Railroad is known; another city
   * counts 1 when it and the capital both have an Airport, and on the capital's land mass the
   * road walk between them (0x00468c65: 0 none, 1 road, 2 railroad) replaces that.
   */
  connectedToCapital(city: City, isCapital: boolean): number {
    const slot = city.owner;
    if (isCapital) return this.knows(slot, ADVANCE.railroad) ? 2 : 1;
    const capital = this.world.cities.find(
      (c) => c !== city && c.owner === slot && c.improvements[IMPROVEMENT.palace] === true,
    );
    if (!capital) return 0;
    let v = 0;
    if (city.improvements[IMPROVEMENT.airport] && capital.improvements[IMPROVEMENT.airport]) v = 1;
    const lm = (c: City) => this.world.landmass[this.world.index(c.position.x, c.position.y)];
    if (lm(city) === lm(capital)) v = routeModifier(this.world, this.rules, slot, city, capital);
    return v;
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
      canBuildSpaceship: this.wonderCity(IMPROVEMENT.apolloProgram) !== null && !hasLaunched(civ),
      nextShipKind: (s, kind) => aiNextPartKind(this.world, this.civ(s), kind, this.shipContext()),
      humanReadyForWonder: (w) =>
        this.world.cities.some((c) => {
          if (!this.civ(c.owner).isHuman) return false;
          if (c.production.kind !== 'improvement' || c.production.index !== w) return false;
          const rows = boxRows(
            this.rules,
            { isHuman: true, difficulty: this.state.difficulty },
            true,
          );
          return c.shieldsStored >= (this.rules.improvements[w]?.costRows ?? 0) * rows;
        }),
      buildShipPart: (s, kind) => {
        const events: SpaceshipEvent[] = [];
        const part = buildPart(this.world, this.civ(s), kind, this.shipContext(), events);
        for (const e of events) this.pendingEvents.push({ slot: s, event: e });
        return part;
      },
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
    city.soldThisTurn = false;
    city.airlifted = false;
    const slot = city.owner;
    const civ = this.civ(slot);
    const ctx = this.cityContext(city);
    const push = (event: CityTurnEvent) => out.push({ slot, city: city.id, event });
    const homed = () => this.world.units.filter((u) => u.homeCity === city.id);
    const settlers = () => homed().filter((u) => this.rules.units[u.type]?.role === 5);

    this.ensureWorkers(city, ctx);
    // Commodity lists (0x0042c44f): every sixteenth turn by city index, or when flagged.
    if (supplyDemandDue(this.state.turn, city)) {
      computeSupplyDemand(this.world, this.rules, city, {
        turn: this.state.turn,
        knows: (s, a) => this.knows(s, a),
        ownsWonder: (s, i) => this.ownsWonder(s, i),
        advancesOf: (s) => this.civ(s).advancesCount,
        tribeOf: (s) => this.civ(s).tribe,
        combustionKnown: (this.state.firstDiscoveredBy[14] ?? 0) !== 0,
      });
    }
    // Terrain work the city asks for (0x004bc284): pollution, then the road or railroad link.
    if (!civ.isHuman && civ.strategy)
      terraformTasks(this.world, this.rules, city, civ.strategy, (a) => this.knows(slot, a));
    // 1. Growth and starvation on last turn's stored food.
    const growth = processGrowth(this.rules, city, ctx, settlers());
    if (growth.disbandedSettler) {
      this.world.units.splice(this.world.units.indexOf(growth.disbandedSettler), 1);
    }
    if (growth.starved) push({ kind: 'starved' });
    if (growth.destroyed) {
      removeCity(this.world, this.rules, city);
      push({ kind: 'destroyed' });
      return out;
    }
    if (growth.grew) push({ kind: 'grew' });
    if (growth.blockedBy) push({ kind: 'growth-blocked', blockedBy: growth.blockedBy });
    // The first recompute (0x004b6f63) places the workers for the size growth left.
    this.ensureWorkers(city, ctx);

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
      if (e.kind === 'wonder-effect') this.wonderEffect(civ, e.effect);
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
    for (const e of disbandForDisorder(this.world, this.rules, city, {
      turn: this.state.turn,
      isHuman: civ.isHuman,
      government: civ.government,
    }))
      push(e);
    // The second recompute runs with the city-turn flag (0x005b864c): the workers are placed
    // again, so a citizen spent on Settlers leaves a specialist's place if that was the spare one,
    // and a computer city puts one specialist back to work.
    this.placeNewWorker(city, ctx);
    t = totals();
    city.lastHappy = t.mood.happy;
    city.lastUnhappy = t.mood.unhappy;

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
      if (e.kind === 'rapture-growth') this.ensureWorkers(city, ctx);
    }

    // 6. Science.
    const science = cityScienceToCiv(this.rules, civ, t.trade.science, {
      isHuman: civ.isHuman,
      difficulty: this.state.difficulty,
      firstDiscoveredBy: this.state.firstDiscoveredBy,
    });
    for (const e of addScience(civ, science, (c) => this.researchCostFor(c))) {
      out.push({ slot, event: e });
      if (e.kind === 'discovered') this.advanceGained(civ, e.advance);
      if (e.kind === 'choose-research' && !civ.isHuman) this.aiChooseResearch(civ);
    }

    // 7. Pollution roll and meltdown — VERIFIED human cities only: the roll (0x004bb7bb) has one
    // caller, inside the city turn's human-only branch; computer cities never pollute by it.
    if (civ.isHuman && this.world.cities.includes(city)) {
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
      if (melt) {
        push(melt);
        fallout(this.world, this.rng, city.position.x, city.position.y); // VERIFIED 0x004bb7bb
      }
    }

    // 8. Upkeep — VERIFIED human cities only: the paying routine (0x004bbc98) has one caller,
    // in the same human-only branch, and the per-improvement cost routine's other callers are
    // the city screen, the sell dialog and the computer player's budget assessment
    // (0x0049155b), which only reads. Computer players pay no improvement upkeep.
    if (civ.isHuman)
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
    // Government preference scores: the city turn's one scoring pass (the original's
    // 0x005b8648 switch around its recompute). The yields, waste, trade corruption and trade
    // split feed the scores as they run; then the city's own share (0x004bc513).
    if (this.world.cities.includes(city)) {
      const leader = this.rules.leaders?.[civ.tribe ?? -1];
      const sctx: CityContext = {
        ...ctx,
        governmentScores: governmentScoresOf(civ),
        civilize: leader?.civilize ?? 0,
      };
      const raw = rawYields(this.world, this.rules, city, sctx);
      const support = unitSupport(this.world, this.rules, city, sctx, homed());
      const shields = shieldTotals(this.rules, city, sctx, raw.shields, support.shields);
      const ownNet = raw.trade - corruption(this.rules, city, ctx, raw.trade, false);
      tradeSplit(
        this.rules,
        city,
        sctx,
        raw.trade + routeIncomeTotal(this.world, this.rules, city, ownNet),
      );
      cityGovernmentScores(
        this.rules,
        civ,
        city,
        {
          shieldsProduced: shields.produced,
          shieldSupport: support.shields,
          unitsSupported: support.supported,
          unitsAway: support.abroad,
        },
        (i) => this.ownsWonder(slot, i),
        { attack: leader?.attack ?? 0, civilize: leader?.civilize ?? 0 },
        this.wonderCity(IMPROVEMENT.shakespeares) === city.id,
      );
      // VERIFIED (the city turn's last line): the civilization remembers its best
      // `2 × shields − support` over the cities processed this turn.
      const p2 = shields.produced * 2 - support.shields;
      if ((civ.bestProduction ?? 0) <= p2) civ.bestProduction = p2;
      city.lastShields = shields.produced;
    }
    return out;
  }

  /** The scenario's event runtime, when the game carries events. */
  events(): ScenarioEvents | null {
    const list = this.state.scenarioEvents;
    if (!list || list.length === 0) return null;
    this.state.eventState ??= newEventState(list);
    this.eventRuntime ??= new ScenarioEvents(this.world, this.rules, list, this.state.eventState);
    return this.eventRuntime;
  }

  private eventRuntime: ScenarioEvents | null = null;

  eventContext(): EventContext {
    return {
      advanceGained: (c, a) => this.advanceGained(c, a),
      turn: this.state.turn,
      rng: this.rng,
      isHuman: (s) => this.world.civs.find((c) => c.slot === s)?.isHuman ?? false,
      inPlay: (s) => this.world.civs.find((c) => c.slot === s)?.inPlay ?? false,
      knows: (s, a) => this.knows(s, a),
      destroyCivilization: (s) => {
        for (const c of [...this.world.cities]) {
          if (c.owner !== s) continue;
          removeCity(this.world, this.rules, c);
        }
        for (const u of [...this.world.units])
          if (u.owner === s) this.world.units.splice(this.world.units.indexOf(u), 1);
        const civ = this.world.civs.find((c) => c.slot === s);
        if (civ) civ.hadCity = true;
        this.pendingEvents.push(...this.eliminateCityless());
      },
      eliminateCityless: () => {
        this.pendingEvents.push(...this.eliminateCityless());
      },
      dontPlayWonders: () => {
        this.state.wonderMoviesOff = true;
      },
      diplomacy: this.diplomacyContext(),
    };
  }

  /** Install a scenario's parsed events (the loader does this once), with a saved state or fresh. */
  loadEvents(events: ScenarioEvent[], state?: EventState): void {
    this.state.scenarioEvents = events;
    this.state.eventState = state ?? newEventState(events);
    this.eventRuntime = null;
  }

  /** SCENARIOLOADED (the loader runs it right after the events are read, with music on). */
  scenarioLoaded(): TurnEvent[] {
    return (this.events()?.scenarioLoaded(this.eventContext()) ?? []).map((e) => ({
      slot: 0,
      event: e,
    }));
  }

  /** UNITKILLED hook for the attack routines. */
  unitKilled(type: number, attacker: number, defender: number): void {
    const loser = this.world.civs.find((c) => c.slot === defender);
    if (loser) {
      loser.casualties ??= Array<number>(62).fill(0);
      loser.casualties[type] = Math.min(255, (loser.casualties[type] ?? 0) + 1);
    }
    this.casualtyLog.push({ turn: this.state.turn, type, attacker, defender });
    const ev = this.events();
    if (!ev) return;
    for (const e of ev.unitKilled(type, attacker, defender, this.eventContext()))
      this.pendingEvents.push({ slot: 0, event: e });
  }

  /** CITYTAKEN hook for the capture routine. */
  cityTaken(city: string, attacker: number, defender: number): void {
    // A city that changes hands with Leonardo's Workshop runs it for the new owner (0x004ac56a).
    const taker = this.world.civs.find((c) => c.slot === attacker);
    const home = this.world.cities.find((c) => c.name === city && c.owner === attacker);
    if (
      taker &&
      home?.improvements[IMPROVEMENT.leonardos] &&
      !this.wonderExpired(IMPROVEMENT.leonardos)
    )
      this.runLeonardo(taker);
    const ev = this.events();
    if (!ev) return;
    for (const e of ev.cityTaken(city, attacker, defender, this.eventContext()))
      this.pendingEvents.push({ slot: 0, event: e });
  }

  /** NEGOTIATION hook for diplomacy: may `talker` approach `listener`? */
  negotiationAllowed(talker: number, listener: number): boolean {
    const ev = this.events();
    if (!ev) return true;
    const effects: ScenarioEffect[] = [];
    const ok = ev.negotiationAllowed(talker, listener, this.eventContext(), effects);
    for (const e of effects) this.pendingEvents.push({ slot: 0, event: e });
    return ok;
  }

  /** A city's figures as its record would store them (0x004b6f63 without placement). */
  cityFigures(city: City) {
    const ctx = this.cityContext(city);
    const raw = rawYields(this.world, this.rules, city, ctx);
    const homed = this.world.units.filter((u) => u.homeCity === city.id);
    const support = unitSupport(this.world, this.rules, city, ctx, homed);
    const shields = shieldTotals(this.rules, city, ctx, raw.shields, support.shields);
    const own = raw.trade - corruption(this.rules, city, ctx, raw.trade, false);
    const routes = routeIncomeTotal(this.world, this.rules, city, own);
    const split = tradeSplit(this.rules, city, ctx, raw.trade + routes);
    const m = mood(this.rules, city, ctx, {
      luxuries: split.luxuries,
      militaryInCity: support.inCity,
      militaryAbroad: support.abroad,
      noMilitaryUnhappiness: support.abroad === 0,
    });
    return {
      food: raw.food,
      shields: shields.produced,
      trade: raw.trade + routes - split.corruption,
      tax: split.tax,
      science: split.science,
      luxuries: split.luxuries,
      routes,
      happy: m.happy,
      unhappy: m.unhappy,
    };
  }

  /** The pollution figure the city screen and the demographics read (0x004b6d9c). */
  cityPollutionFigures(city: City): number {
    const slot = city.owner;
    const civ = this.civ(slot);
    return cityPollution(
      city,
      this.cityFigures(city).shields,
      {
        knows: (a: number) => this.knows(slot, a),
        advancesCount: civ.advancesCount,
        difficulty: this.state.difficulty,
      },
      this.ownsWonder(slot, IMPROVEMENT.hooverDam),
    );
  }

  /** The civilization score and its parts (0x0047c9e0). */
  scoreOf(slot: number): ScoreBreakdown {
    const civ = this.civ(slot);
    return civilizationScore(this.world, civ, {
      turn: this.state.turn,
      turnsOfPeace: this.state.turnsOfPeace ?? 0,
      pollutionSquares: this.state.pollutionSquares ?? 0,
      barbarianActivity: this.state.barbarianActivity ?? 0,
      ...(this.state.destroyedCivilizations !== undefined
        ? { destroyedCivilizations: this.state.destroyedCivilizations }
        : {}),
      ...(this.state.researchDearer ? { researchDearer: true } : {}),
      ...(this.state.researchCheaper ? { researchCheaper: true } : {}),
      ...(this.state.noRestart ? { noRestart: true } : {}),
      isHuman: (s) => this.civ(s).isHuman,
      massThrust: this.rules.cosmic.massThrustParadigm ?? 75,
      knowsFusion: (s) => this.knows(s, 32),
      year: yearOf(this.state),
      ...(this.state.scenario?.objectiveVictory && this.state.scenario.objectives
        ? {
            scenario: {
              countWondersAsObjectives: this.state.scenario.countWondersAsObjectives ?? false,
              protagonist: this.state.scenario.protagonist ?? 0,
              objectives: this.state.scenario.objectives,
            },
          }
        : {}),
    });
  }

  /** The civilization's turn: cities last-to-first, then the AI's rates. */
  processCivilization(slot: number): TurnEvent[] {
    const out: TurnEvent[] = [];
    const civ = this.civ(slot);
    // VERIFIED 0x0046732a: a warning off foreign land fades on the unit's turn in four.
    this.world.units.forEach((u, i) => {
      if (u.owner !== slot) return;
      if (u.warned && !u.warnedNow && ((this.state.turn ^ (i & 3)) & 3) === 0) delete u.warned;
      delete u.warnedNow;
    });
    this.revealFor(slot);
    resetGovernmentScores(civ);
    civ.bestProduction = 0;
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
      // VERIFIED: the city turn returns happy − unhappy, and the rate policy notes a city above
      // size 5 whose result is zero.
      if (city.size > 5 && (city.lastHappy ?? 0) === (city.lastUnhappy ?? 0)) anyLargeQuiet = true;
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
        control: this.powerRank(slot),
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
              control: this.powerRank(human.slot),
            }
          : null,
        spaceshipLaunched: hasLaunched(civ),
        anyHumanSpaceshipLaunched: this.world.civs.some((c) => c.isHuman && hasLaunched(c)),
        difficulty: this.state.difficulty,
        bloodlust: this.state.bloodlust ?? false,
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
      // Toward each human it has met (0x0051326d, 0x00513f7e): borders and the attitude drift.
      if (!civ.isHuman) {
        for (const h of this.world.civs) {
          if (!h.isHuman || h.slot === 0 || !hasTreaty(this.world, slot, h.slot, TREATY.contact))
            continue;
          if (this.wantsTalks)
            this.pendingTalks.push({ human: h.slot, computer: slot, relations: true });
          else
            this.settleQuietly(
              relationsTurn(this.negotiationEnv(), h.slot, slot, this.spaceRace(civ).on),
            );
        }
      }
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
    const automated = civ.isHuman && this.world.units.some((u) => u.owner === slot && u.automated);
    if (!civ.isHuman || automated) {
      let names = this.citiesOf(slot).length;
      for (const e of aiMoveUnits(this.world, this.rules, slot, {
        automatedOnly: civ.isHuman,
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
        enterVillage: (u) => {
          enterHut(this.world, this.rules, this.rng, civ, u, {
            turn: this.state.turn,
            year: yearOf(this.state),
            difficulty: this.state.difficulty,
            barbarianActivity: this.state.barbarianActivity ?? 0,
            knownByAnyone: (x) => this.world.civs.some((c) => c.knownAdvances[x]),
            advanceGained: (c, x) => this.advanceGained(c, x),
            nextCityName: () => `${civ.adjective} City ${++names}`,
          });
        },
        onUnitKilled: (t, a, d) => this.unitKilled(t, a, d),
        onCityEmptied: (c) => this.cityEmptied(c),
        onCityTaken: (c, a, d) => this.cityTaken(c, a, d),
        advanceGained: (c, a) => this.advanceGained(c, a),
        guerillaWarfareDiscovered: (this.state.firstDiscoveredBy[34] ?? 0) !== 0,
        ...(civ.strategy ? { strategy: civ.strategy } : {}),
        trade: this.tradeContext(),
        attitude: (other) => attitude(this.world, slot, other),
        rankOf: (s) => this.powerRank(s),
        raceWorry: this.spaceRace(civ).pressure,
        isAlly: (other) => hasTreaty(this.world, slot, other, TREATY.alliance),
        espionage: this.espionageContext(),
        isHuman: (s) => this.world.civs.find((c) => c.slot === s)?.isHuman ?? false,
        leader: [1, 2, 3, 4, 5, 6, 7].find((s) => this.powerRank(s) === 7) ?? 0,
        planOf: (s, lm) => this.world.civs.find((c) => c.slot === s)?.strategy?.plans[lm] ?? 5,
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
  /** The opening of a round (0x00467591): events, the historian, barbarian landings. */
  private beginRound(): TurnEvent[] {
    const out: TurnEvent[] = [];
    // Scenario events at the turn's commencement (TURN, TURNINTERVAL, RANDOMTURN, RECEIVEDTECHNOLOGY).
    for (const e of this.events()?.turnStart(this.eventContext()) ?? [])
      out.push({ slot: 0, event: e });
    // The historian reports at a random interval (0x00467591, header +0x142).
    if (this.state.turn > (this.state.nextHistory ?? 0)) {
      this.state.nextHistory = this.state.turn + this.rng.nextInt(40) + 20;
      const historian = this.rng.nextInt(11);
      out.push({ slot: 0, event: history(this, historian, this.rng.nextInt(5)) });
    }
    // The turn driver spawns barbarians before the civilizations move (0x00467591, turn ≠ 0).
    if (this.state.turn !== 0) {
      for (const e of spawnBarbarians(this.world, this.rules, this.barbarianContext()))
        out.push({ slot: 0, event: e });
    }
    return out;
  }

  /** One slot's turn in the round's order: slot 0 is the barbarians (0x0046b55e). */
  private playSlot(slot: number): TurnEvent[] {
    const out: TurnEvent[] = [];
    for (const u of this.world.units) this.world.markVisited(u.position.x, u.position.y, u.owner);
    if (slot === 0) {
      out.push(...this.processBarbarians());
      return out;
    }
    const civ = this.world.civs.find((c) => c.slot === slot);
    if (!civ?.inPlay) return out;
    // VERIFIED 0x00469773: a debt past −16384 is taken for an overflow and becomes the maximum.
    if (civ.treasury > 30000 || civ.treasury < -0x4000) civ.treasury = 30000;
    if (civ.treasury < 0) civ.treasury = 0;
    out.push(...this.processCivilization(slot));
    out.push(...this.pendingEvents.splice(0));
    out.push(...this.eliminateCityless());
    return out;
  }

  /** The close of a round: the turn counter and the year's bookkeeping. */
  private endRound(): TurnEvent[] {
    const out: TurnEvent[] = [];
    this.state.turn += 1;
    // VERIFIED (0x00467591): from turn 200 every turn adds a turn of peace; a battle between
    // two civilizations has reset the count during the turn.
    if (this.world.peaceBroken) {
      this.state.turnsOfPeace = 0;
      this.world.peaceBroken = false;
    }
    if (this.state.turn > 199) this.state.turnsOfPeace = (this.state.turnsOfPeace ?? 0) + 1;
    // VERIFIED (0x00467591): every 12 × (difficulty + 1) turns a civilization's reputation
    // recovers a point when the turn is also a multiple of 24 × (difficulty + 1) or it holds
    // the Eiffel Tower, provided the reputation is above 1 (any, with the Tower) and not zero.
    // (The original then caps every civilization's +0x48 counter toward a human at the new
    // reputation — a field the engine does not model.)
    const steps = this.state.difficulty + 1;
    if (this.state.turn % (12 * steps) === 0) {
      for (const civ of this.world.civs) {
        const eiffel = this.ownsWonder(civ.slot, IMPROVEMENT.eiffelTower);
        const rep = civ.reputation ?? 0;
        if ((this.state.turn % (24 * steps) === 0 || eiffel) && (rep > 1 || eiffel) && rep !== 0)
          civ.reputation = rep - 1;
      }
    }
    this.recordPower();
    out.push(...this.endOfYear());
    return out;
  }

  /** The power graph's table (0x00465607): every fourth turn, one byte per civilization. */
  private recordPower(): void {
    if (this.state.turn >= 600) return;
    const at = (this.state.turn >> 2) % 150;
    const history = (this.state.powerHistory ??= Array<number[]>(150)
      .fill([])
      .map(() => Array<number>(8).fill(0)));
    const scores = powerScores(this.world, (s) => this.citiesOf(s).reduce((n, c) => n + c.size, 0));
    history[at] = scores.map((v) => Math.min(255, Math.max(0, v >> 3)));
  }

  /** A whole round with nobody stopping to move. */
  endTurn(): TurnEvent[] {
    const out = this.beginRound();
    for (let slot = 0; slot < 8; slot++) out.push(...this.playSlot(slot));
    out.push(...this.endRound());
    return out;
  }

  /**
   * Play on from where the round stands until a human is to move, as the original does: each
   * civilization moves in its slot, so a human sees what earlier slots did this turn, and later
   * slots answer in the same turn. `state.nextSlot` is 0 between rounds. Stops after the human's
   * cities are processed; `state.movingHuman` names who moves. With no human left it plays one
   * round and stops.
   */
  playUntilHuman(): TurnEvent[] {
    const out: TurnEvent[] = [];
    for (let rounds = 0; rounds < 2; rounds++) {
      if ((this.state.nextSlot ?? 0) === 0) out.push(...this.beginRound());
      for (let slot = this.state.nextSlot ?? 0; slot < 8; slot++) {
        out.push(...this.playSlot(slot));
        const civ = this.world.civs.find((c) => c.slot === slot);
        if (slot !== 0 && civ?.inPlay && civ.isHuman) {
          this.state.nextSlot = slot + 1;
          this.state.movingHuman = slot;
          return out;
        }
      }
      this.state.nextSlot = 0;
      out.push(...this.endRound());
      if (!this.world.civs.some((c) => c.isHuman && c.inPlay && c.slot !== 0)) return out;
    }
    return out;
  }

  /**
   * VERIFIED (0x00483657, run after a capture, a city's destruction, a ghost town or a
   * disband): a civilization left without a city is destroyed — its units disbanded, its slot
   * out of play, the destruction recorded. The engine checks after every civilization's turn
   * and at the end of the turn, which can lag the original by part of a turn. A civilization
   * that never founded a city is not touched (the original only asks on those events); one with
   * neither city nor unit is dropped as well (INFERRED). A computer player's slot then restarts
   * (0x00480fc9, `restart`).
   */
  eliminateCityless(): TurnEvent[] {
    const out: TurnEvent[] = [];
    for (const civ of this.world.civs) {
      if (civ.slot === 0 || !civ.inPlay) continue;
      if (this.citiesOf(civ.slot).length > 0) continue;
      const units = this.world.units.filter((u) => u.owner === civ.slot).length;
      if (!civ.hadCity && units > 0) continue;
      civ.inPlay = false;
      this.state.destroyedCivilizations = (this.state.destroyedCivilizations ?? 0) + 1;
      for (const u of [...this.world.units])
        if (u.owner === civ.slot) this.world.units.splice(this.world.units.indexOf(u), 1);
      out.push({
        slot: civ.slot,
        event: {
          kind: 'spaceship',
          text: `the ${civ.name} civilization is destroyed`,
          slot: civ.slot,
        },
      });
      if (!civ.isHuman) out.push(...this.restart(civ.slot));
    }
    return out;
  }

  /** A new civilization in a destroyed computer player's slot (newGame.ts restartCivilization). */
  restart(slot: number): TurnEvent[] {
    const leaders = (this.rules.leaders ?? []).filter(
      (l): l is NewGameLeader =>
        l.index !== undefined && l.color !== undefined && l.plural !== undefined,
    );
    if (leaders.length === 0) return [];
    const humanTribe = this.world.civs.find((c) => c.isHuman)?.tribe ?? -1;
    this.state.tribesPlayed ??= [];
    const r = restartCivilization(this.world, this.rules, this.rng, slot, leaders, {
      turn: this.state.turn,
      difficulty: this.state.difficulty,
      noRestart: this.state.noRestart ?? false,
      isHuman: (s) => this.world.civs.find((c) => c.slot === s)?.isHuman ?? false,
      humanTribe,
      knownBy: (a) => {
        let m = 0;
        for (const c of this.world.civs) if (c.slot !== 0 && c.knownAdvances[a]) m |= 1 << c.slot;
        return m;
      },
      firstDiscoveredBy: this.state.firstDiscoveredBy,
      tribesPlayed: this.state.tribesPlayed,
    });
    return r.notes.map((text) => ({ slot, event: { kind: 'spaceship' as const, text, slot } }));
  }

  /** Spaceship arrivals, dead civilizations and the end of the game (the yearly routine's tail). */
  private endOfYear(): TurnEvent[] {
    const out: TurnEvent[] = [];
    if (this.state.gameOver) return out;
    const year = yearOf(this.state);
    const shipEvents: SpaceshipEvent[] = [];
    const winner = checkArrivals(this.world, year, shipEvents);
    for (const e of shipEvents) out.push({ slot: e.slot, event: e });
    if (winner) {
      this.state.gameOver = { winner: winner.slot, reason: 'spaceship' };
      return out;
    }
    out.push(...this.eliminateCityless());
    const alive = this.world.civs.filter((c) => c.slot !== 0 && c.inPlay);
    if (alive.length === 1 && this.state.turn > 1 && alive[0]) {
      this.state.gameOver = { winner: alive[0].slot, reason: 'conquest' };
      out.push({
        slot: alive[0].slot,
        event: {
          kind: 'spaceship',
          text: `the ${alive[0].name} rule the world`,
          slot: alive[0].slot,
        },
      });
    }
    // VERIFIED (0x0046b0fa): in the year 2000 the players are told to plan their retirement;
    // in 2020 the game ends for everyone — here the best civilization score wins. A scenario's
    // end turn (warned five turns before) is not modelled yet.
    if (!this.state.gameOver) {
      const scenarioEnd = this.state.scenario?.endTurn ?? 0;
      const stage = retirementStage(yearOf(this.state), this.state.turn, scenarioEnd);
      if (stage === 'warn') {
        for (const civ of this.world.civs) {
          if (civ.slot === 0 || !civ.inPlay || !civ.isHuman) continue;
          out.push({
            slot: civ.slot,
            event: {
              kind: 'retirement',
              text:
                scenarioEnd > 0
                  ? 'The scenario ends in five turns.'
                  : 'The year 2000: plan your retirement — the game ends in 2020.',
              final: false,
            },
          });
        }
      } else if (stage === 'end') {
        let best: Civ | null = null;
        let bestScore = -1;
        for (const civ of this.world.civs) {
          if (civ.slot === 0 || !civ.inPlay) continue;
          const score = this.scoreOf(civ.slot).total;
          if (score > bestScore) {
            bestScore = score;
            best = civ;
          }
        }
        if (best) {
          this.state.gameOver = { winner: best.slot, reason: 'retirement' };
          out.push({
            slot: best.slot,
            event: {
              kind: 'retirement',
              text: `${scenarioEnd > 0 ? 'The scenario has ended' : 'The year 2020: the game ends'}. The ${best.name} lead with a score of ${bestScore}.`,
              final: true,
            },
          });
        }
      }
    }
    return out;
  }

  shipContext(): SpaceshipContext {
    return {
      turn: this.state.turn,
      year: yearOf(this.state),
      difficulty: this.state.difficulty,
      massThrust: this.rules.cosmic.massThrustParadigm ?? 75,
      isHuman: (s) => this.world.civs.find((c) => c.slot === s)?.isHuman ?? false,
      knowsFusion: (s) => this.knows(s, 32),
      knowsPartAdvance: (s, k) => {
        const p = advanceIndex(this.rules.improvements[35 + k]?.preq);
        return p === null || this.knows(s, p);
      },
      rank: (s) => this.powerRank(s),
      askHuman: this.wantsTalks,
      rechooseProduction: (s) => {
        for (const c of this.citiesOf(s)) this.aiChooseProduction(c);
      },
    };
  }

  private barbarianContext(): BarbarianContext {
    const humans = this.world.civs.filter((c) => c.isHuman).map((c) => c.slot);
    return {
      rng: this.rng,
      turn: this.state.turn,
      year: yearOf(this.state),
      difficulty: this.state.difficulty,
      activity: this.state.barbarianActivity ?? 0,
      onUnitKilled: (t, a, d) => this.unitKilled(t, a, d),
      onCityEmptied: (c) => this.cityEmptied(c),
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

  /** The barbarians' turn: unit upkeep and cities as for anyone, then the barbarian move chooser. */
  private processBarbarians(): TurnEvent[] {
    const out: TurnEvent[] = [];
    const barbarians = this.world.civs.find((c) => c.slot === 0);
    if (!barbarians) return out;
    for (const e of beginUnitsTurn(this.world, this.rules, this.rng, barbarians, {
      knows: () => false,
      nuclearPower: false,
      magellans: false,
      lighthouse: false,
      damageSlowsUnits: this.state.realisticCombat,
    })) {
      out.push({ slot: 0, event: e });
    }
    // VERIFIED 0x0046b55e: the round's loop starts at slot 0, which is in play in every save read,
    // so a city the barbarians hold takes a city turn like anyone's (0x00467c61).
    const cities = this.citiesOf(0);
    for (let i = cities.length - 1; i >= 0; i--) {
      const city = cities[i];
      if (city && this.world.cities.includes(city)) out.push(...this.processCity(city));
    }
    if (!this.world.units.some((u) => u.owner === 0)) return out;
    for (const e of barbarianMoves(this.world, this.rules, barbarians, this.barbarianContext()))
      out.push({ slot: 0, event: e });
    return out;
  }

  /** Give every citizen a square or a specialist slot (the original's auto-arrange runs on founding and growth). */
  /**
   * Place the city's workers as the original does on every recompute (0x004b49b5, city.ts
   * `assignWorkers`); `inCityTurn` marks the city turn's own recompute.
   */
  ensureWorkers(city: City, ctx: CityContext = this.cityContext(city), inCityTurn = false): void {
    const civ = this.civ(city.owner);
    const homed = this.world.units.filter((u) => u.homeCity === city.id);
    const settlers = homed.filter((u) => this.rules.units[u.type]?.role === 5).length;
    const support = unitSupport(this.world, this.rules, city, ctx, homed).shields;
    assignWorkers(this.world, this.rules, city, ctx, {
      turn: this.state.turn,
      isHuman: civ.isHuman,
      inCityTurn,
      settlers,
      support,
      isAlly: (a, b) => hasTreaty(this.world, a, b, TREATY.alliance),
      isHumanSlot: (slot) => this.world.civs.find((c) => c.slot === slot)?.isHuman ?? false,
    });
  }

  /** The city turn's second recompute of the workers, flagged by 0x005b864c. */
  placeNewWorker(city: City, ctx: CityContext): void {
    this.ensureWorkers(city, ctx, true);
  }

  /** The context the research value (0x004920ac) reads for a civilization. */
  researchValueContext(civ: Civ): ResearchValueContext {
    const leader = this.rules.leaders?.[civ.tribe ?? -1];
    const slot = civ.slot;
    const knownBy = (a: number) => {
      let m = 0;
      for (const c of this.world.civs) if (c.slot !== 0 && c.knownAdvances[a]) m |= 1 << c.slot;
      return m;
    };
    let humanMask = 0;
    let maxCitySize = 0;
    for (const c of this.world.civs) if (c.isHuman) humanMask |= 1 << c.slot;
    for (const c of this.world.cities)
      if (c.owner === slot && c.size > maxCitySize) maxCitySize = c.size;
    return {
      knows: (s: number, a: number) => this.knows(s, a),
      knownBy,
      humanMask,
      isHuman: (s: number) => this.world.civs.find((c) => c.slot === s)?.isHuman ?? false,
      atWar: (a: number, b: number) => hasTreaty(this.world, a, b, TREATY.war),
      advancesOf: (s: number) => this.world.civs.find((c) => c.slot === s)?.advancesCount ?? 0,
      reputationOf: (s: number) => this.world.civs.find((c) => c.slot === s)?.reputation ?? 0,
      civilize: leader?.civilize ?? 0,
      tribe: civ.tribe ?? -1,
      researchDearer: this.state.researchDearer ?? false,
      ownsWonder: (s: number, w: number) => this.ownsWonder(s, w),
      wonderOwner: (w: number) => {
        const id = this.wonderCity(w);
        return id === null ? null : (this.world.cities.find((c) => c.id === id)?.owner ?? null);
      },
      seaUnits:
        civ.strategy?.seaUnits ??
        this.world.units.filter(
          (u) => u.owner === slot && this.rules.units[u.type]?.domain === DOMAIN_SEA,
        ).length,
      maxCitySize,
    };
  }

  /**
   * The AI's research choice (VERIFIED, 0x00494f3a): every researchable advance scores
   * `rand() % value` with the value of 0x004920ac (aiResearch.ts) and the highest wins.
   */
  /** What the science advisor recommends to a human (0x00494f3a): value, give or take one. */
  suggestResearch(civ: Civ): number | null {
    const ctx = this.researchValueContext(civ);
    let best = -1;
    let pick: number | null = null;
    for (const a of researchChoices(this.rules, civ, this.state.difficulty)) {
      const score = advanceValue(this.rules, civ.slot, a, ctx) + this.rng.nextInt(3) - 1;
      if (score > best) {
        best = score;
        pick = a;
      }
    }
    return pick;
  }

  aiChooseResearch(civ: Civ): void {
    const options = researchableAdvances(this.rules, civ);
    const slot = civ.slot;
    const ctx = this.researchValueContext(civ);
    let best = -1;
    let pick: number | null = null;
    for (const a of options) {
      const value = advanceValue(this.rules, slot, a, ctx);
      const score = value > 1 ? this.rng.nextInt(value) : 0;
      if (score > best) {
        best = score;
        pick = a;
      }
    }
    civ.researching = pick;
  }

  /** The space race as the production chooser sees it (0x0053feba, 0x0053ff14). */
  spaceRace(civ: Civ): { on: boolean; pressure: boolean } {
    const isHuman = (s: number) => this.world.civs.find((c) => c.slot === s)?.isHuman ?? false;
    const on = spaceRaceOn({
      bloodlust: this.state.bloodlust ?? false,
      apolloBuilt: this.wonderCity(IMPROVEMENT.apolloProgram) !== null,
      humanKnowsSpaceFlight: this.world.civs.some((c) => c.isHuman && this.knows(c.slot, 76)),
    });
    const pressure = spaceRacePressure(this.world, civ, {
      raceOn: on,
      gameEnded: this.state.gameOver !== undefined,
      difficulty: this.state.difficulty,
      isHuman,
      knows: (s, a) => this.knows(s, a),
      partCostRows: (kind) => this.rules.improvements[35 + kind]?.costRows ?? 0,
    });
    return { on, pressure };
  }

  /** The AI's production choice (docs/engine/ai-city.md), from the city's current totals. */
  aiChooseProduction(
    city: City,
    totals?: {
      raw: { food: number; shields: number; trade: number };
      support: { shields: number; settlers: number; inCity: number; abroad: number };
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
    const race = this.spaceRace(civ);
    city.production = aiChooseProduction({
      world: this.world,
      rules: this.rules,
      civ,
      city,
      ctx,
      facts: {
        shields: t.shields.produced,
        support: t.support.shields,
        bestProduction: civ.bestProduction ?? 0,
        trade: t.raw.trade,
        corruption: t.trade.corruption,
        foodSurplus: t.raw.food - eaten,
        happy: t.mood.happy,
        unhappy: t.mood.unhappy,
        settlersSupported: t.support.settlers,
        unitsAway: t.support.abroad,
        defendersInCity: defenders,
        threat,
        zocAtCity: inEnemyZoc(this.world, city.position.x, city.position.y, city.owner),
        attack: leader?.attack ?? 0,
        expand: leader?.expand ?? 0,
        civilize: leader?.civilize ?? 0,
        difficulty: this.state.difficulty,
        turn: this.state.turn,
        simplifiedCombat: !this.state.realisticCombat,
        spaceRace: (race.on ? 1 : 0) + (race.pressure ? 1 : 0),
        spaceRacePressure: race.pressure,
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
              (best, c) => Math.min(best, gridDistance(this.world, city.position, c.position)),
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
            cityHasCaravan: this.world.units.some(
              (u) => u.homeCity === city.id && this.rules.units[u.type]?.role === 7,
            ),
            caravansOnContinent: civ.strategy?.caravansOn[lm] ?? 0,
            metSlots: this.world.civs
              .filter(
                (o) =>
                  o.slot !== 0 &&
                  o.slot !== civ.slot &&
                  hasTreaty(this.world, civ.slot, o.slot, TREATY.contact),
              )
              .map((o) => o.slot),
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
      ...(this.buildTrace ? { trace: (n, p) => this.buildTrace?.(city, n, p) } : {}),
      canBuildImprovement: (i) => this.canBuildImprovement(city, i),
      wonderExpired: (w) => this.wonderExpired(w),
      nextShipKind: (kind) => aiNextPartKind(this.world, civ, kind, this.shipContext()),
      foreign: {
        mainHuman: this.world.civs.find((c) => c.isHuman && c.slot !== 0)?.slot ?? null,
        isHumanSlot: (s) => this.world.civs.find((c) => c.slot === s)?.isHuman ?? false,
        rankOf: (s) => this.powerRank(s),
        unitCount: (s, type) =>
          this.world.units.reduce((n, u) => (u.owner === s && u.type === type ? n + 1 : n), 0),
        atWar: (x, y) => hasTreaty(this.world, x, y, TREATY.war),
        vendettaAgainst: (x, y) => hasTreaty(this.world, x, y, TREATY.vendetta),
        atPeace: (x, y) => hasTreaty(this.world, x, y, TREATY.peace),
        reputationOf: (s) => this.world.civs.find((c) => c.slot === s)?.reputation ?? 0,
      },
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
