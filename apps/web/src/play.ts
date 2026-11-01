import { PART_SHEETS, PARTS_OVER, PARTS_UNDER, SHIP_FRAMES, type PartRow } from './shipParts.js';
import { decodeText, descriptionFor } from '@mudbrick/formats';
/**
 * The interactive layer: a human plays one civilization from a loaded save.
 *
 * All rules live in the engine; this module only maps keys and clicks to engine calls, keeps the
 * selection, and renders panels. Places where the original's behaviour is not yet decoded are
 * marked INFERRED in the log text shown to the player.
 */
import {
  advanceIndex,
  canFoundCity,
  canOrder,
  captureCity,
  changeProduction,
  disbandUnit,
  doWork,
  DOMAIN_GROUND,
  enterHut,
  fortify,
  foundCity,
  fullMoves,
  gotoStep,
  hutAt,
  joinCity,
  lookAround,
  mood,
  movesLeft,
  GOVERNMENT,
  ORDER,
  orderGoTo,
  cityRows,
  cycleSpecialist,
  airlift,
  airliftTargets,
  airliftThreat,
  buyCost,
  buyProduction,
  CITY_CENTRE_INDEX,
  councilRatings,
  councilSpeech,
  defenseRows,
  demographics,
  foreignRows,
  maxRate,
  paradropCheck,
  sellImprovement,
  setHomeCity,
  setRates,
  squareYield,
  attackSound,
  HISTORY_KINDS,
  improvementSound,
  parseCouncil,
  scienceReport,
  researchChoices,
  researchPaths,
  spaceshipRows,
  topCities,
  tradeReport,
  wonderRows,
  treatiesOf,
  type Conversation,
  type Dialog,
  pillage,
  pillageOptions,
  rawYields,
  resolveAttack,
  sentry,
  shieldTotals,
  tradeSplit,
  tryMove,
  unitSupport,
  wake,
  type City,
  type Civ,
  type Game,
  type MovementContext,
  type Point,
  type TurnEvent,
  type Unit,
  changeGovernment,
  governmentAllowed,
  startRevolution,
  establishTradeRoute,
  helpWonder,
  type TradeEvent,
  bribeCost,
  bribeUnit,
  espionageOptions,
  inciteCost,
  performEspionage,
  sabotageUnit,
  SPY_TYPE,
  type EspionageAction,
  type EspionageEvent,
  evaluateShip,
  hasLaunched,
  hasStarted,
  launchShip,
  buildPart,
  PART_LIMITS,
  shipOf,
  throneOf,
  partLimit,
  type Spaceship,
  PART_NAMES,
  type SpaceshipEvent,
  yearOf,
  yearTextOf,
  declareWar,
  treaty,
  TREATY,
  type DiplomacyEvent,
} from '@mudbrick/engine';
import { ADVANCE, IMPROVEMENT } from '@mudbrick/engine';
import { sprites } from '@mudbrick/formats';
import { drawCityView } from './cityView.js';
import type { GameFolder } from './gameFiles.js';
import { hitTest, squareOrigin } from './mapRenderer.js';
import { drawWorld, WORLD_TOP_PAD, type WorldRenderOptions } from './worldRenderer.js';

const { TILE_W, TILE_H } = sprites;

const DIRECTIONS: Record<string, Point> = {
  N: { x: 0, y: -2 },
  NE: { x: 1, y: -1 },
  E: { x: 2, y: 0 },
  SE: { x: 1, y: 1 },
  S: { x: 0, y: 2 },
  SW: { x: -1, y: 1 },
  W: { x: -2, y: 0 },
  NW: { x: -1, y: -1 },
};

/** x, y, width, height of each of the four levels of the seven parts (pv.dll, 0x005a9068). */
/** The event engravings of tiles.dll (0x004b7280); each has a later twin at + 1. */
const NEWS_CAPTURE = 70;
const NEWS_DISORDER = 72;
const NEWS_CELEBRATION = 74;
const NEWS_FOUNDED = 76;

const THRONE_ART = [
  145, 1, 322, 318, 118, 1, 360, 311, 137, 1, 348, 298, 169, 1, 267, 325, 1, 278, 640, 203, 1, 277,
  640, 204, 1, 277, 640, 204, 1, 277, 640, 204, 1, 301, 640, 180, 213, 299, 202, 182, 247, 315, 110,
  166, 204, 306, 217, 175, 1, 1, 640, 296, 1, 1, 640, 303, 1, 1, 640, 300, 1, 1, 640, 298, 177, 1,
  276, 195, 173, 110, 264, 187, 207, 36, 189, 266, 184, 1, 234, 299, 1, 1, 640, 311, 1, 33, 640,
  274, 1, 1, 640, 310, 1, 1, 640, 313, 236, 269, 125, 39, 299, 234, 40, 72, 200, 198, 209, 123, 242,
  154, 122, 151, 1, 1, 640, 480, 1, 1, 640, 480, 1, 1, 640, 480, 1, 1, 640, 480,
];
/** The seven extra pieces' rectangles (0x005a9268), pictures 160 to 166. */
/** Back to front: parts 0 to 7, then 8 + n for extra piece n. */
const THRONE_LAYERS = [0, 1, 2, 8, 3, 9, 10, 4, 11, 5, 6, 12, 13, 14, 7];
const THRONE_EXTRA = [
  1, 311, 640, 43, 78, 14, 449, 240, 1, 235, 640, 67, 209, 142, 192, 155, 148, 251, 312, 70, 32,
  273, 576, 65, 1, 139, 640, 342,
];

type PediaCategory =
  'ADVANCE' | 'IMPROVEMENT' | 'WONDER' | 'UNIT' | 'GOVERNMENT' | 'TERRAIN_AND_RESOURCE' | 'CONCEPT';

const KEY_DIRECTIONS: Record<string, string> = {
  ArrowUp: 'N',
  ArrowDown: 'S',
  ArrowLeft: 'W',
  ArrowRight: 'E',
  Home: 'NW',
  PageUp: 'NE',
  End: 'SW',
  PageDown: 'SE',
  '8': 'N',
  '9': 'NE',
  '6': 'E',
  '3': 'SE',
  '2': 'S',
  '1': 'SW',
  '4': 'W',
  '7': 'NW',
};

export interface PlayElements {
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  unitPanel: HTMLElement;
  cityPanel: HTMLElement;
  researchPanel: HTMLElement;
  log: HTMLElement;
}

export class PlaySession {
  /** Anarchy has ended and the engine waits for the player's choice. */
  governmentChoiceDue = false;
  /** The government chosen when the revolution started, applied when anarchy ends. */
  wantedGovernment: number | null = null;
  /** A diplomat or spy waiting for the player's choice at a foreign city or unit. */
  pendingAgent: { unit: Unit; city: City } | { unit: Unit; target: Unit } | null = null;
  /** Network play: this browser's seat, and the call that sends the game on. */
  seat: number | null = null;
  onTurnPassed: ((moving: number) => void) | null = null;
  onChat: ((text: string) => void) | null = null;
  /** The conversation on screen, if any. */
  private talk: Conversation | null = null;
  selected: Unit | null = null;
  openCity: City | null = null;
  gotoMode = false;
  paradropMode = false;
  private seatPending = false;
  muted = false;
  private readonly logLines: string[] = [];
  private cityNames = 0;

  constructor(
    readonly game: Game,
    readonly folder: GameFolder,
    public humanSlot: number,
    readonly el: PlayElements,
    readonly renderOptions: () => WorldRenderOptions,
  ) {
    game.wantsTalks = folder.popups.size > 0;
    game.askEscape = (c) =>
      window.confirm(`Pay 1000 gold to move the government to ${c.name} and save the spaceship?`);
    this.startTimer();
    void this.buildMenuBar();
    this.log(`You lead the ${this.civ.name}. Arrow keys or the number pad move the selected unit.`);
    if (game.state.nextSlot === 0) {
      this.playOn();
    } else if (game.state.nextSlot === undefined) {
      game.state.nextSlot = humanSlot + 1;
      game.state.movingHuman = humanSlot;
    }
    this.selectNext();
    this.refresh();
    if (!this.selected) {
      const home =
        this.world.cities.find((c) => c.owner === humanSlot) ??
        this.world.units.find((u) => u.owner === humanSlot);
      if (home) this.centreOn(home.position);
    }
  }

  get world() {
    return this.game.world;
  }
  get rules() {
    return this.game.rules;
  }
  get civ(): Civ {
    return this.game.civ(this.humanSlot);
  }

  private moveCtx(): MovementContext {
    const slot = this.humanSlot;
    return {
      nuclearPower: this.game.knows(slot, ADVANCE.nuclearPower),
      magellans: this.game.ownsWonder(slot, IMPROVEMENT.magellans),
      lighthouse: this.game.ownsWonder(slot, IMPROVEMENT.lighthouse),
      damageSlowsUnits: this.game.state.realisticCombat,
    };
  }

  log(line: string): void {
    this.logLines.push(line);
    if (this.logLines.length > 60) this.logLines.shift();
  }

  // ---- selection

  humanUnits(): Unit[] {
    return this.world.units.filter((u) => u.owner === this.humanSlot);
  }

  needsOrders(u: Unit): boolean {
    return u.order === null && movesLeft(this.rules, u, this.moveCtx()) > 0;
  }

  selectNext(): void {
    const units = this.humanUnits().filter((u) => this.needsOrders(u));
    if (units.length === 0) {
      this.selected = null;
      return;
    }
    const currentId = this.selected?.id ?? -1;
    this.selected = units.find((u) => u.id > currentId) ?? units[0] ?? null;
  }

  select(unit: Unit | null): void {
    this.selected = unit;
    this.openCity = null;
    this.gotoMode = false;
    this.refresh();
  }

  // ---- input

  handleKey(e: KeyboardEvent): boolean {
    if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return false;
    const dir = KEY_DIRECTIONS[e.key];
    if (dir && this.selected) {
      this.moveSelected(dir);
      return true;
    }
    if (this.talk) return true;
    if (!this.ourMove) return false;
    if (e.ctrlKey) {
      if (e.key === 'c') this.chat();
      else if (e.key === 'r') this.retire();
      else if (e.key === 'd') this.showCasualties();
      else if (e.key === 't') this.showTimer();
      else return false;
      return true;
    }
    if (e.key === 'Escape' && document.getElementById('talkBox')?.style.display === 'block') {
      this.closeTalk();
      return true;
    }
    switch (e.key) {
      case 'F1':
      case 'F2':
      case 'F3':
      case 'F4':
      case 'F5':
      case 'F6':
      case 'F7':
      case 'F8':
      case 'F9':
      case 'F11':
      case 'F12':
        this.showReport(e.key);
        return true;
      case 'M':
        this.muted = !this.muted;
        this.log(this.muted ? 'Sound off.' : 'Sound on.');
        return true;
      case 'G':
        this.showPowerGraph(false);
        return true;
      case 'O':
        this.showOptions();
        return true;
      case 'F10':
        this.showCouncil();
        return true;
      case '?':
        this.showPedia();
        return true;
      case 'Enter':
        this.endTurn();
        return true;
      case 'H':
        return this.withSelected((u) => {
          const c = setHomeCity(this.world, u);
          this.log(c ? `Home city is now ${c.name}.` : 'Move into one of your cities first.');
        });
      case 'l':
        return this.withSelected((u) => {
          this.airliftMenu(u);
        });
      case 'j':
        return this.withSelected((u) => {
          this.paradropMode = !this.paradropMode;
          this.log(
            this.paradropMode ? `${this.unitName(u)}: click the drop square.` : 'Drop cancelled.',
          );
        });
      case 'u':
        return this.withSelected((u) => {
          for (const o of this.world.unitsAt(u.position.x, u.position.y))
            if (o !== u && o.owner === u.owner && o.order === ORDER.sleep) o.order = null;
          this.log('Units aboard are awake.');
        });
      case 'C':
        this.findCity();
        return true;
      case 'T':
        this.log(`Rates are in the panel: up to ${maxRate(this.civ.government) * 10} % each.`);
        return true;
      case 'R':
        if (this.civ.government !== GOVERNMENT.anarchy) {
          startRevolution(this.world, this.civ);
          this.sound('REVOLT');
          this.log('Revolution! The government falls into Anarchy.');
          this.refresh();
        }
        return true;
      case 'k':
        return this.withSelected((u) => {
          if (this.rules.units[u.type]?.role !== 5) return;
          u.automated = true;
          this.log(`${this.unitName(u)} works on its own.`);
          this.skipSelected();
        });
      case 'a':
        return this.withSelected((u) => {
          for (const o of this.world.unitsAt(u.position.x, u.position.y)) {
            if (o.owner !== u.owner) continue;
            o.automated = false;
            if (o.order === ORDER.sleep) o.order = null;
          }
          this.log('Units here are awake.');
        });
      case 'w':
      case ' ':
        this.skipSelected();
        return true;
      case 'f':
        return this.withSelected((u) => {
          fortify(u);
          this.log(`${this.unitName(u)} fortifies.`);
        });
      case 's':
        return this.withSelected((u) => {
          sentry(u);
          this.log(`${this.unitName(u)} goes to sleep.`);
        });
      case 'g':
        if (this.selected) {
          this.gotoMode = true;
          this.log('Click the destination square.');
          this.refresh();
        }
        return true;
      case 'b':
        return this.withSelected((u) => this.buildCity(u));
      case 'r':
        return this.withSelected((u) => this.work(u, ORDER.road));
      case 'i':
        return this.withSelected((u) => this.work(u, ORDER.irrigation));
      case 'm':
        return this.withSelected((u) => this.work(u, ORDER.mine));
      case 'o':
        return this.withSelected((u) => this.work(u, ORDER.transform));
      case 'F':
        return this.withSelected((u) => this.work(u, ORDER.fortress));
      case 'E':
        return this.withSelected((u) => this.work(u, ORDER.airbase));
      case 'p':
        return this.withSelected((u) => this.work(u, ORDER.pollution));
      case 'P':
        return this.withSelected((u) => this.pillageSelected(u));
      case 'D':
        return this.withSelected((u) => this.disbandSelected(u));
      case 't':
        return this.withSelected((u) => this.caravanTrade(u));
      case 'h':
        return this.withSelected((u) => this.caravanHelp(u));
      case 'c':
        if (this.selected) this.centreOn(this.selected.position);
        return true;
      case 'Tab':
        this.selectNext();
        this.refresh();
        return true;
      default:
        return false;
    }
  }

  private withSelected(fn: (u: Unit) => void): boolean {
    if (!this.selected) return false;
    fn(this.selected);
    this.afterAction();
    return true;
  }

  handleClick(clientX: number, clientY: number): void {
    const rect = this.el.canvas.getBoundingClientRect();
    const zoom = this.renderOptions().zoom;
    const hit = hitTest(
      { header: { widthX2: this.world.widthX2, height: this.world.rows } } as never,
      zoom,
      clientX - rect.left,
      clientY - rect.top - WORLD_TOP_PAD * zoom,
    );
    if (!hit) return;
    const x = hit.c * 2 + (hit.y & 1);
    const y = hit.y;
    const p = { x, y };
    if (this.paradropMode && this.selected) {
      this.paradrop(this.selected, p);
      return;
    }
    if (this.gotoMode && this.selected) {
      orderGoTo(this.selected, p);
      const r = gotoStep(this.world, this.rules, this.game.rng, this.selected, this.moveCtx());
      this.gotoMode = false;
      this.log(
        r.kind === 'goto-blocked'
          ? 'No path from here.'
          : `${this.unitName(this.selected)} heads for (${x}, ${y}).`,
      );
      this.afterAction();
      return;
    }
    const mine = this.world.unitsAt(x, y).filter((u) => u.owner === this.humanSlot);
    const city = this.world.cityAt(x, y);
    if (
      city &&
      (mine.length === 0 || (this.selected?.position.x === x && this.selected.position.y === y))
    ) {
      this.openCity = city;
      this.selected = null;
      this.refresh();
      return;
    }
    if (mine.length > 0) {
      const idx = this.selected ? mine.indexOf(this.selected) : -1;
      const next = mine[(idx + 1) % mine.length] ?? null;
      if (next && next.order !== null) wake(next);
      this.select(next);
      return;
    }
    this.openCity = null;
    this.refresh();
  }

  // ---- actions

  moveSelected(dirName: string): void {
    const unit = this.selected;
    const d = DIRECTIONS[dirName];
    if (!unit || !d) return;
    const ny = unit.position.y + d.y;
    if (ny < 0 || ny >= this.world.rows) return;
    const nx = this.world.wrapX(unit.position.x + d.x, ny);
    if (nx === null) return;
    const to = { x: nx, y: ny };
    const hadHut = hutAt(this.world, nx, ny);
    const r = tryMove(this.world, this.rules, this.game.rng, unit, to, this.moveCtx());
    switch (r.kind) {
      case 'moved':
        this.log(`${this.unitName(unit)} moves to (${nx}, ${ny}).`);
        if (hadHut) this.resolveHut(unit);
        break;
      case 'boarded':
        this.log(`${this.unitName(unit)} boards the ${this.unitName(r.ship)}.`);
        break;
      case 'failed-roll':
        this.log(`${this.unitName(unit)} runs out of movement before reaching the square.`);
        break;
      case 'diplomat':
        this.pendingAgent = { unit, city: r.city };
        this.log(
          `${this.unitName(unit)} at the gates of ${r.city.name}: choose a mission in the unit panel.`,
        );
        break;
      case 'diplomat-unit':
        this.pendingAgent = { unit, target: r.target };
        this.log(
          `${this.unitName(unit)} approaches a lone ${this.unitName(r.target)}: choose in the unit panel.`,
        );
        break;
      case 'caravan': {
        const events: TradeEvent[] = [];
        establishTradeRoute(this.world, this.rules, unit, r.city, this.game.tradeContext(), events);
        for (const e of events) this.log(`${e.text}.`);
        this.selected = null;
        break;
      }
      case 'attack':
        this.attack(unit, to);
        break;
      case 'refused':
        this.log(this.refusalText(r.reason));
        break;
    }
    this.afterAction();
  }

  private refusalText(reason: string): string {
    switch (reason) {
      case 'zoc':
        return 'Cannot move from one enemy zone of control into another.';
      case 'needs-transport':
        return 'No transport there to board.';
      case 'amphibious':
        return 'Only units with amphibious assault can attack from a ship.';
      case 'submarine':
        return 'A submarine cannot attack a land square.';
      case 'impassable':
        return 'That unit cannot enter that square.';
      case 'no-moves':
        return 'No movement left this turn.';
      default:
        return `Move refused (${reason}).`;
    }
  }

  private attack(unit: Unit, to: Point): void {
    const city = this.world.cityAt(to.x, to.y);
    const enemies = this.world.unitsAt(to.x, to.y).filter((u) => u.owner !== unit.owner);
    // VERIFIED (the attack handler 0x0052d472): attacking a civilization at cease-fire or peace
    // asks whether to break the treaty, then declares war (0x00526d80).
    const victim = enemies[0]?.owner ?? (city && city.owner !== unit.owner ? city.owner : null);
    if (victim !== null && victim !== 0) {
      const word = treaty(this.world, unit.owner, victim);
      if ((word & (TREATY.ceaseFire | TREATY.peace)) !== 0) {
        const ok =
          typeof window === 'undefined' ||
          window.confirm(
            `Attacking the ${this.world.civs.find((c) => c.slot === victim)?.name ?? 'civilization'} breaks our treaty. Declare war?`,
          );
        if (!ok) return;
        const events: DiplomacyEvent[] = [];
        declareWar(this.world, unit.owner, victim, this.game.diplomacyContext(), events);
        for (const e of events) this.log(`${e.text}.`);
      }
    }
    if (enemies.length === 0 && city && city.owner !== unit.owner) {
      if (this.rules.units[unit.type]?.domain !== DOMAIN_GROUND) {
        this.log('Only ground units can occupy a city.');
        return;
      }
      this.takeCity(unit, city);
      return;
    }
    const ev = resolveAttack(this.world, this.rules, this.game.rng, unit, to, {
      civ: (slot) => this.world.civs.find((c) => c.slot === slot),
      wondersOf: (slot) => this.wondersOf(slot),
      cityCount: (slot) => this.game.citiesOf(slot).length,
      difficulty: this.game.state.difficulty,
      realisticCombat: this.game.state.realisticCombat,
      barbarianActivity: 1,
      attackerMovesLeft: movesLeft(this.rules, unit, this.moveCtx()),
      onUnitKilled: (t, a, d) => this.game.unitKilled(t, a, d),
      onCityEmptied: (c) => this.game.cityEmptied(c),
      onAttacked: (a, d) => this.game.attacked(a, d),
    });
    if (ev.kind === 'nuclear') {
      this.sound('NUKEXPLO');
      this.selected = null;
      this.log(
        ev.blast.stoppedBy
          ? `SDI Defense in ${ev.blast.stoppedBy.name} stops the missile.`
          : `Nuclear strike: ${ev.blast.killed.length} units destroyed.`,
      );
      this.afterAction();
      return;
    }
    if (ev.kind === 'cannot-attack') {
      this.log('This unit cannot attack.');
      return;
    }
    if (ev.kind === 'no-defender') {
      this.log('Nothing there can defend against this unit.');
      return;
    }
    const a = Math.round((ev.result.attack.value / 8) * 10) / 10;
    const d = Math.round((ev.result.defence.value / 8) * 10) / 10;
    const winner = ev.attackerWon ? unit : ev.defender;
    this.log(
      `${this.unitName(unit)} (${a}) attacks ${this.unitName(ev.defender)} (${d}): ` +
        `${ev.attackerWon ? 'victory' : 'defeat'} after ${ev.result.rounds.length} round(s)` +
        (ev.result.promoted ? `; ${this.unitName(winner)} becomes veteran` : '') +
        '.',
    );
    const attackerType = this.rules.units[unit.type];
    if (attackerType)
      this.sound(attackSound(attackerType, unit.type, this.rules.units[ev.defender.type]));
    if (ev.stackLost.length > 0)
      this.log(`${ev.stackLost.length} more enemy unit(s) destroyed with the defender.`);
    if (ev.cityDestroyed) this.log(`${ev.cityShrunk?.name ?? 'The city'} is destroyed.`);
    else if (ev.cityShrunk) this.log(`${ev.cityShrunk.name} loses a citizen.`);
    if (ev.ransom > 0) this.log(`Barbarian leader captured: ${ev.ransom} gold ransom.`);
    if (ev.attackerConsumed) this.selected = null;
  }

  /** 't': a caravan in a city other than its home establishes a trade route (rules-trade.md). */
  private caravanTrade(unit: Unit): void {
    const city = this.world.cityAt(unit.position.x, unit.position.y);
    if (!city || (this.rules.units[unit.type]?.role ?? 0) !== 7) {
      this.log('Only a caravan or freight in a city can establish a trade route.');
      return;
    }
    if (city.id === unit.homeCity) {
      this.log('A caravan cannot trade with its own home city.');
      return;
    }
    const events: TradeEvent[] = [];
    establishTradeRoute(this.world, this.rules, unit, city, this.game.tradeContext(), events);
    for (const e of events) this.log(`${e.text}.`);
    this.selected = null;
    this.refresh();
  }

  /** 'h': a caravan helps build the wonder the city is working on. */
  private caravanHelp(unit: Unit): void {
    const city = this.world.cityAt(unit.position.x, unit.position.y);
    if (!city || (this.rules.units[unit.type]?.role ?? 0) !== 7) {
      this.log('Only a caravan or freight in a city can help build a wonder.');
      return;
    }
    const events: TradeEvent[] = [];
    if (!helpWonder(this.world, this.rules, unit, city, events)) {
      this.log(`${city.name} is not building a wonder.`);
      return;
    }
    for (const e of events) this.log(`${e.text}.`);
    this.selected = null;
    this.refresh();
  }

  private takeCity(unit: Unit, city: City): void {
    const loser = this.world.civs.find((c) => c.slot === city.owner);
    if (!loser) return;
    const ev = captureCity(this.world, this.rules, this.game.rng, city, this.civ, loser, {
      capitalFalls: (c, l, w) => this.game.capitalFalls(c, l, w),
      turn: this.game.state.turn,
      difficulty: this.game.state.difficulty,
      conquest: true,
      guerillaWarfareDiscovered: (this.game.state.firstDiscoveredBy[34] ?? 0) !== 0,
      ...(this.game.state.forbidGovernmentChange ? { forbidGovernmentSwitching: true } : {}),
      onCityTaken: (c, a, d) => this.game.cityTaken(c, a, d),
      advanceGained: (c, a) => this.game.advanceGained(c, a),
    });
    if (ev.cityDestroyed) {
      this.log(`${this.unitName(unit)} destroys the ${loser.adjective} city of ${city.name}.`);
    } else {
      unit.position = { x: city.position.x, y: city.position.y };
      this.log(
        `${this.unitName(unit)} captures ${city.name}: ${ev.plunder} gold plundered` +
          (ev.destroyedImprovements.length
            ? `, ${ev.destroyedImprovements.length} building(s) destroyed`
            : '') +
          (ev.partisans.length ? `, ${ev.partisans.length} partisans rise` : '') +
          (ev.stolenAdvance !== null
            ? `, you learn ${this.rules.advances[ev.stolenAdvance]?.name ?? 'an advance'}`
            : '') +
          '.',
      );
      this.queueNews(NEWS_CAPTURE, `${city.name} falls to the ${this.civ.name}.`);
      this.nextTalk();
      this.openCity = city;
    }
    unit.movesSpent = fullMoves(this.rules, unit, this.moveCtx());
    unit.moved = true;
    unit.order = null;
  }

  private wondersOf(slot: number): boolean[] {
    const out = Array<boolean>(67).fill(false);
    for (const c of this.world.cities) {
      if (c.owner !== slot) continue;
      for (let i = 39; i < 67; i++) if (c.improvements[i]) out[i] = true;
    }
    return out;
  }

  private resolveHut(unit: Unit): void {
    const civ = this.civ;
    const out = enterHut(this.world, this.rules, this.game.rng, civ, unit, {
      turn: this.game.state.turn,
      year: yearOf(this.game.state),
      difficulty: this.game.state.difficulty,
      barbarianActivity: this.game.state.barbarianActivity ?? 0,
      knownByAnyone: (a) => this.world.civs.some((c) => c.knownAdvances[a]),
      advanceGained: (c, a) => this.game.advanceGained(c, a),
      nextCityName: () => this.nextCityName(),
    });
    const names: Record<string, string> = {
      tribe: 'An advanced tribe joins you and founds a city!',
      mercenaries: 'Mercenaries join your cause.',
      gold: 'You find valuable metals.',
      barbarians: 'Barbarians! They pour out of the village.',
      scrolls: 'Scrolls of ancient wisdom: a new advance.',
      nomads: 'Friendly nomads join you as Settlers.',
      nothing: 'The village is deserted.',
    };
    this.log(
      `Village: ${names[out.kind] ?? out.kind}${out.kind === 'gold' ? ` (${out.gold} gold)` : ''}`,
    );
  }

  private nextCityName(): string {
    this.cityNames += 1;
    return `${this.civ.adjective} City ${this.world.cities.filter((c) => c.owner === this.humanSlot).length + 1}`;
  }

  private buildCity(unit: Unit): void {
    const v = canFoundCity(this.world, this.rules, unit);
    if (!v.ok) {
      const text: Record<string, string> = {
        'only-settlers': 'Only Settlers can found cities.',
        'at-sea': 'A city cannot be founded at sea.',
        'adjacent-city': 'Too close to another city.',
        'city-full': 'The city is too large for Settlers to join.',
      };
      this.log(text[v.reason] ?? v.reason);
      return;
    }
    if (v.joins) {
      joinCity(this.world, unit, v.joins);
      this.log(`Settlers join ${v.joins.name} (now size ${v.joins.size}).`);
      this.selected = null;
      return;
    }
    const name = window.prompt('Name the new city', this.nextCityName()) ?? '';
    if (!name) return;
    const city = foundCity(this.world, this.rules, this.civ, unit, { name });
    this.game.ensureWorkers(city);
    this.log(`${name} founded.`);
    this.queueNews(NEWS_FOUNDED, `${name} founded.`);
    this.nextTalk();
    this.selected = null;
    this.openCity = city;
  }

  private work(unit: Unit, order: number): void {
    const knows = (a: number) => this.game.knows(this.humanSlot, a);
    const v = canOrder(this.world, this.rules, unit, order, { knows });
    if (!v.ok) {
      if (typeof v.reason === 'string') {
        const text: Record<string, string> = {
          'only-settlers': 'Only Settlers and Engineers can do that.',
          'needs-engineers': 'Only Engineers can transform terrain.',
          'cant-improve': 'That cannot be built here.',
          'already-fortress': 'There is already a fortress here.',
          'already-airbase': 'There is already an airbase here.',
          'already-railroad': 'There is already a railroad here.',
          'already-mine': 'There is already a mine here.',
          'already-farmland': 'There is already farmland here.',
          'no-water': 'No water source for irrigation.',
          'no-pollution': 'There is no pollution here.',
          'not-a-work-order': 'Not a terrain order.',
        };
        this.log(text[v.reason] ?? v.reason);
      } else {
        this.log(`Requires ${this.rules.advances[v.reason.needsAdvance]?.name ?? 'an advance'}.`);
      }
      return;
    }
    const ev = doWork(this.world, this.rules, unit, order, { knows });
    unit.movesSpent = fullMoves(this.rules, unit, this.moveCtx());
    if (ev.kind === 'completed') this.log(`${this.unitName(unit)} completes the work at once.`);
    else this.log(`${this.unitName(unit)} starts work (${ev.progress}/${ev.needed}).`);
  }

  private pillageSelected(unit: Unit): void {
    const v = pillageOptions(this.world, this.rules, unit);
    if (!v.ok) {
      this.log(`Cannot pillage here (${v.reason}).`);
      return;
    }
    const choice =
      v.options.length === 1
        ? v.options[0]
        : (window.prompt(`Pillage which? ${v.options.join(', ')}`, v.options[0]) as
            (typeof v.options)[number] | null);
    if (!choice || !v.options.includes(choice)) return;
    const events: DiplomacyEvent[] = [];
    pillage(this.world, this.rules, unit, choice, { ctx: this.game.diplomacyContext(), events });
    for (const e of events) this.log(`${e.text}.`);
    this.log(`${this.unitName(unit)} pillages the ${choice}.`);
  }

  private disbandSelected(unit: Unit): void {
    if (!window.confirm(`Disband ${this.unitName(unit)}?`)) return;
    const refund = disbandUnit(this.world, this.rules, unit, this.civ, this.game.state.difficulty);
    this.log(
      `${this.unitName(unit)} disbanded${refund ? ` (${refund} shields to the city)` : ''}.`,
    );
    this.selected = null;
  }

  skipSelected(): void {
    if (!this.selected) return;
    this.selected.movesSpent = fullMoves(this.rules, this.selected, this.moveCtx());
    this.afterAction();
  }

  /** Is it this browser's move? */
  get ourMove(): boolean {
    return this.seat === null || (this.game.state.movingHuman ?? this.seat) === this.seat;
  }

  endTurn(): void {
    if (!this.ourMove) return;
    this.playOn();
  }

  /** Run the round on to the next human (Game.playUntilHuman), and hand the seat over. */
  private playOn(): void {
    const before = this.humanSlot;
    const events = this.game.playUntilHuman();
    const moving = this.game.state.movingHuman ?? this.humanSlot;
    if (this.onTurnPassed && moving !== this.seat) {
      this.onTurnPassed(moving);
      this.log(`Waiting for the ${this.game.civ(moving).name}.`);
      this.refresh();
      return;
    }
    this.humanSlot = moving;
    if (this.humanSlot !== before) {
      this.log(`— The ${this.civ.name} to move —`);
      this.announceSeat();
    }
    for (const e of events) {
      if (e.slot !== this.humanSlot) continue;
      const text = this.eventText(e);
      if (text) this.log(text);
      this.eventSound(e.event);
      if (e.event.kind === 'discovered') this.offerRevolution(e.event.advance);
      if (text && e.event.kind === 'disorder') this.queueNews(NEWS_DISORDER, text);
      if (text && e.event.kind === 'celebration-start') this.queueNews(NEWS_CELEBRATION, text);
    }
    if (this.game.throneDue(this.humanSlot)) this.showThrone(true);
    this.sound('ENDOTURN');
    this.startTimer();
    this.log(`— Turn ${this.game.state.turn}, ${this.yearText()} —`);
    this.nextTalk();
    if (this.game.state.gameOver) {
      const w = this.world.civs[this.game.state.gameOver.winner];
      this.log(`GAME OVER: the ${w?.name ?? '?'} win by ${this.game.state.gameOver.reason}.`);
    }
    this.selected = null;
    this.selectNext();
    this.refresh();
  }

  /** Play SOUND/NAME.WAV from the game folder, if it is there. */
  private sound(name: string | null): void {
    if (!name || this.muted) return;
    const file = name === 'CHEERS' ? `CHEERS${this.game.rng.nextInt(3) + 1}` : name;
    void this.folder.file(`SOUND/${file}.WAV`).then((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.addEventListener('ended', () => URL.revokeObjectURL(url));
      void a.play().catch(() => undefined);
    });
  }

  private eventSound(ev: TurnEvent['event']): void {
    switch (ev.kind) {
      case 'built-improvement':
      case 'built-wonder':
        this.sound(improvementSound(ev.improvement));
        break;
      case 'disorder':
        this.sound('CIVDISOR');
        break;
      case 'discovered':
        this.sound('POS1');
        break;
      default:
    }
  }

  private eventText(e: TurnEvent): string | null {
    const cityName =
      'city' in e ? (this.world.cities.find((c) => c.id === e.city)?.name ?? `city ${e.city}`) : '';
    const ev = e.event;
    switch (ev.kind) {
      case 'built-unit':
        return `${cityName} completes ${this.unitName(ev.unit)}.`;
      case 'built-improvement':
      case 'built-wonder':
        return `${cityName} completes ${this.rules.improvements[ev.improvement]?.name ?? 'a building'}.`;
      case 'wonder-yielded':
        return `${cityName} holds ${this.rules.improvements[ev.improvement]?.name ?? 'a wonder'} back.`;
      case 'discovered':
        return `Discovery: ${this.rules.advances[ev.advance]?.name ?? ev.advance}.`;
      case 'history': {
        const best = this.game.civ(ev.order[0] ?? 1).name;
        return `Historians name the ${best} the ${HISTORY_KINDS[ev.category] ?? ''} civilization: ${ev.order.map((s) => this.game.civ(s).name).join(', ')}.`;
      }
      case 'great-library':
        return `The Great Library yields ${this.rules.advances[ev.advance]?.name ?? ev.advance}.`;
      case 'barracks-sold':
        return `${this.rules.advances[ev.advance]?.name ?? 'An advance'} closes ${ev.cities} Barracks for ${ev.gold} gold.`;
      case 'units-upgraded':
        return `Leonardo's Workshop turns ${this.rules.units[ev.from]?.name ?? 'a unit'} into ${this.rules.units[ev.to]?.name ?? 'a unit'}.`;
      case 'wonder-expired':
        return `${this.rules.advances[ev.advance]?.name ?? 'An advance'} ends ${this.rules.improvements[ev.improvement]?.name ?? 'a wonder'}.`;
      case 'golden-age':
        return 'A golden age: one free advance.';
      case 'choose-research':
        return 'Choose what to research next.';
      case 'retirement':
        return ev.text;
      case 'scenario-text':
        return ev.lines.join(' ');
      case 'scenario-sound':
        return `(sound: ${ev.file})`;
      case 'scenario-track':
        return `(music: CD track ${ev.track})`;
      case 'scenario-note':
        return `Scenario: ${ev.text}.`;
      case 'disorder':
        return `Civil disorder in ${cityName}!`;
      case 'restored':
        return `Order restored in ${cityName}.`;
      case 'celebration-start':
        return `${cityName} celebrates "We Love the King Day".`;
      case 'grew':
        return `${cityName} grows.`;
      case 'starved':
        return `Famine in ${cityName}.`;
      case 'sold':
        return `${cityName} sells ${this.rules.improvements[ev.improvement]?.name ?? 'a building'} for lack of funds.`;
      case 'crashed':
        return `${this.unitName(ev.unit)} runs out of fuel and is lost.`;
      case 'work':
        return ev.event.kind === 'completed'
          ? `${this.unitName(ev.unit)} finishes its work.`
          : null;
      case 'revolt':
        return 'Revolution! The government has fallen into Anarchy.';
      case 'ai-unit':
      case 'ai-strategy':
        return null;
      case 'diplomacy':
        return 'text' in e.event ? `${e.event.text}.` : null;
      case 'government':
        if ('choose' in e.event && e.event.choose && e.slot === this.humanSlot) {
          if (this.wantedGovernment !== null) {
            changeGovernment(this.world, this.civ, this.wantedGovernment, true);
            this.wantedGovernment = null;
            return `The anarchy ends: ${this.civ.name} become a new government.`;
          }
          this.governmentChoiceDue = true;
        }
        return 'text' in e.event ? `${e.event.text}.` : null;
      case 'barbarians':
        return `Barbarians: ${'text' in e.event ? e.event.text : ''}.`;
      case 'polluted':
        return `Pollution near ${cityName}.`;
      case 'climate':
        return ev.text;
      case 'meltdown':
        return `Nuclear meltdown in ${cityName}! The Nuclear Plant is destroyed.`;
      case 'disbanded-for-shortage':
        return `${cityName} cannot support ${this.unitName(ev.unit)}; it is disbanded.`;
      case 'disbanded-for-disorder':
        return `${cityName} in disorder disbands ${this.unitName(ev.unit)}.`;
      default:
        return null;
    }
  }

  private afterAction(): void {
    if (this.selected && !this.world.units.includes(this.selected)) this.selected = null;
    if (!this.selected || !this.needsOrders(this.selected)) {
      // Move on to the next unit that needs orders; with none left, keep the current unit
      // selected so it can still be given an order (found a city, fortify, …) as in the original.
      const previous = this.selected;
      this.selectNext();
      if (!this.selected && previous && this.world.units.includes(previous))
        this.selected = previous;
    }
    this.refresh();
  }

  // ---- rendering

  unitName(u: Unit): string {
    return this.rules.units[u.type]?.name ?? `unit ${u.type}`;
  }

  yearText(): string {
    return yearTextOf(this.game.state);
  }

  centreOn(p: Point): void {
    const zoom = this.renderOptions().zoom;
    const o = squareOrigin((p.x - (p.y & 1)) >> 1, p.y);
    const wrap = this.el.canvas.parentElement;
    if (!wrap) return;
    wrap.scrollLeft = o.px * zoom - wrap.clientWidth / 2;
    wrap.scrollTop = (o.py + WORLD_TOP_PAD) * zoom - wrap.clientHeight / 2;
  }

  refresh(): void {
    const opts = this.renderOptions();
    drawWorld(this.el.canvas, this.world, this.folder, opts);
    const ctx = this.el.canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(opts.zoom, 0, 0, opts.zoom, 0, 0);
      const mark = (p: Point, colour: string) => {
        const o = squareOrigin((p.x - (p.y & 1)) >> 1, p.y);
        ctx.strokeStyle = colour;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(o.px + TILE_W / 2, o.py + WORLD_TOP_PAD);
        ctx.lineTo(o.px + TILE_W, o.py + WORLD_TOP_PAD + TILE_H / 2);
        ctx.lineTo(o.px + TILE_W / 2, o.py + WORLD_TOP_PAD + TILE_H);
        ctx.lineTo(o.px, o.py + WORLD_TOP_PAD + TILE_H / 2);
        ctx.closePath();
        ctx.stroke();
      };
      if (this.selected) mark(this.selected.position, '#ffe066');
      if (this.openCity) mark(this.openCity.position, '#7fd4ff');
    }
    this.renderStatus();
    this.renderUnitPanel();
    this.renderCityPanel();
    this.renderResearchPanel();
    this.el.log.textContent = this.logLines.slice(-14).join('\n');
  }

  private clockText(): string {
    if (this.timerEnds === 0) return '';
    const left = Math.max(0, Math.ceil((this.timerEnds - Date.now()) / 1000));
    const seconds = String(left % 60).padStart(2, '0');
    return `${String(Math.trunc(left / 60)).padStart(2, '0')}:${seconds} left · `;
  }

  private renderStatus(): void {
    const civ = this.civ;
    const waiting = this.humanUnits().filter((u) => this.needsOrders(u)).length;
    const gov =
      this.folder.rules.governments[civ.government]?.name ?? `government ${civ.government}`;
    this.el.status.textContent =
      `${civ.name} · ${gov} · Turn ${this.game.state.turn} (${this.yearText()}) · ` +
      `${civ.treasury} gold · tax ${civ.taxRate * 10} % lux ${(10 - civ.taxRate - civ.scienceRate) * 10} % sci ${civ.scienceRate * 10} % · ` +
      `score ${this.game.scoreOf(civ.slot).total} · ` +
      this.clockText() +
      (this.game.state.gameOver
        ? ` · GAME OVER: ${this.world.civs[this.game.state.gameOver.winner]?.name ?? '?'} win by ${this.game.state.gameOver.reason}`
        : waiting > 0
          ? `${waiting} unit(s) awaiting orders`
          : 'press Enter to end the turn');
  }

  private renderUnitPanel(): void {
    const u = this.selected;
    const el = this.el.unitPanel;
    if (!u) {
      el.textContent = this.gotoMode
        ? 'Click a destination.'
        : 'No unit selected. Click one of your units, or press Enter to end the turn.';
      return;
    }
    const type = this.rules.units[u.type];
    const left = movesLeft(this.rules, u, this.moveCtx());
    const hp = type ? type.hitPointsTens * 10 - u.hitPointsLost : 0;
    const home =
      u.homeCity === null
        ? 'none'
        : (this.world.cities.find((c) => c.id === u.homeCity)?.name ?? '?');
    const pending = this.pendingAgent;
    if (pending && pending.unit === u && this.world.units.includes(u)) {
      el.replaceChildren(this.agentMenu(pending));
      return;
    }
    el.textContent =
      `${this.unitName(u)}${u.veteran ? ' (veteran)' : ''} at (${u.position.x}, ${u.position.y})\n` +
      `moves ${Math.floor(left / 3)}${left % 3 ? ` ${left % 3}/3` : ''} · HP ${hp}/${type ? type.hitPointsTens * 10 : '?'} · home ${home}\n` +
      (this.gotoMode ? 'Go to: click the destination.\n' : '') +
      `keys: arrows/numpad move · f fortify · s sleep · g go to · w wait · b build city\n` +
      `r road · i irrigate · m mine · o transform · F fortress · E airbase · p clean pollution\n` +
      `P pillage · D disband · t trade route · h help wonder · Tab next unit · c centre · Enter end turn`;
  }

  /** The menu bar, from the folder's Menu.txt: same labels, same keys. */
  private async buildMenuBar(): Promise<void> {
    const file = await this.folder.file('MENU.TXT');
    if (!file) return;
    const text = decodeText(new Uint8Array(await file.arrayBuffer()));
    const bar = document.createElement('div');
    bar.id = 'menuBar';
    bar.style.cssText = 'font:13px sans-serif;background:#ddd;padding:2px;user-select:none';
    const skip = new Set(['CHEAT', 'EDITOR']);
    let menu: HTMLSelectElement | null = null;
    let section = '';
    let first = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith(';') || line === '') continue;
      if (line.startsWith('@')) {
        section = line.slice(1);
        first = true;
        continue;
      }
      if (skip.has(section)) continue;
      const [label = '', key = ''] = line.replace(/&/g, '').split('|');
      if (first) {
        first = false;
        const m = document.createElement('select');
        const title = document.createElement('option');
        title.textContent = label;
        title.value = '';
        m.append(title);
        m.addEventListener('change', () => {
          const value = m.value;
          m.selectedIndex = 0;
          if (value === 'CASUALTY') this.showCasualties();
          else if (value === 'THRONE') this.showThrone(false);
          else if (value === 'RETIRE') this.retire();
          else if (value === 'TIMER') this.showTimer();
          else if (value === 'CHAT') this.chat();
          else if (value) this.handleKey({ key: value, target: null } as unknown as KeyboardEvent);
          this.refresh();
        });
        bar.append(m);
        menu = m;
        continue;
      }
      const opt = document.createElement('option');
      opt.textContent = key ? `${label}    ${key}` : label;
      let code = key.replace(/^Shift\+/, '');
      if (key.startsWith('Shift+')) code = code.toUpperCase();
      if (key === 'SPACE') code = ' ';
      if (label.startsWith('End Player')) code = 'Enter';
      if (label.startsWith('Change Timer')) code = 'TIMER';
      if (label === 'Consult High Council') code = 'F10';
      if (label.startsWith('Casualty')) code = 'CASUALTY';
      if (section === 'PEDIA') code = '?';
      if (label === 'Game Options') code = 'O';
      if (label === 'View Throne Room') code = 'THRONE';
      if (label === 'Retire') code = 'RETIRE';
      if (label === 'Chat with Kings') code = 'CHAT';
      const bound =
        /^F\d+$/.test(code) ||
        ['Enter', ' ', '?', 'CASUALTY', 'RETIRE', 'CHAT', 'O', 'THRONE', 'TIMER'].includes(code) ||
        (code.length === 1 && 'brimopgfshwkauljFEPDHCMTR'.includes(code));
      opt.value = bound ? code : '';
      opt.disabled = !bound;
      menu?.append(opt);
    }
    bar.style.position = 'sticky';
    bar.style.top = '0';
    bar.style.left = '0';
    bar.style.zIndex = '20';
    this.el.canvas.parentElement?.prepend(bar);
  }

  /** An ally asks for help (ALLYUNDERATTACK, DEMANDHELP, HELPBONUS, DIDNTHELP; 0x00444c22). */
  private showAllyCall(call: { human: number; ally: number; attacker: number }): void {
    const ally = this.game.civ(call.ally);
    const foe = this.game.civ(call.attacker);
    const box = this.talkBox();
    box.replaceChildren();
    const text = document.createElement('p');
    text.textContent = `The ${foe.name} attack our ${ally.name} allies, who ask us to declare war.`;
    box.append(text);
    const answer = (help: boolean, gold: number) => {
      this.game.answerAllyCall(call, help, gold);
      this.log(
        help ? `We declare war on the ${foe.name}.` : `The ${ally.name} remember our refusal.`,
      );
      this.closeTalk();
    };
    this.talkButton(box, 'Declare war', () => answer(true, 0));
    this.talkButton(box, 'Refuse', () => {
      const gold = this.game.allyBonus(call.ally, call.attacker);
      if (gold === 0) {
        answer(false, 0);
        return;
      }
      box.replaceChildren();
      const offer = document.createElement('p');
      offer.textContent = `The ${ally.name} offer ${gold} gold if we join them.`;
      box.append(offer);
      this.talkButton(box, 'Accept', () => answer(true, gold));
      this.talkButton(box, 'Refuse', () => answer(false, 0));
    });
  }

  /** A government advance offers a revolution (0x0049300e). */
  private offerRevolution(advance: number): void {
    const civ = this.civ;
    const now = civ.government;
    let asks = false;
    if (advance === 54) asks = now === 1;
    else if ([15, 21, 31, 71].includes(advance)) {
      const same =
        (advance === 71 && now === 5) ||
        (advance === 15 && now === 3) ||
        (advance === 31 && now === 4);
      asks = !same && now !== 6 && now !== 0;
    }
    if (!asks) return;
    this.pendingRevolution = advance;
  }

  private pendingRevolution: number | null = null;

  private showRevolution(advance: number): void {
    const box = this.talkBox();
    box.replaceChildren();
    const text = document.createElement('p');
    text.textContent = `With ${this.rules.advances[advance]?.name ?? 'this advance'} we could change our government. Start a revolution?`;
    box.append(text);
    this.talkButton(box, 'Yes', () => {
      startRevolution(this.world, this.civ);
      this.log(`The ${this.civ.name} begin a revolution.`);
      this.closeTalk();
    });
    this.talkButton(box, 'No', () => this.closeTalk());
  }

  private readonly news: { picture: number; text: string }[] = [];

  /** An event worth an engraving (0x004b7280): the second of each pair after advance 37. */
  private queueNews(picture: number, text: string): void {
    this.news.push({ picture: picture + (this.civ.knownAdvances[37] === true ? 1 : 0), text });
  }

  private showNews(item: { picture: number; text: string }): void {
    const box = this.talkBox();
    box.replaceChildren();
    const img = document.createElement('img');
    img.style.cssText = 'display:block;margin:0 auto 8px;max-width:100%';
    void this.folder.art('TILES.DLL', item.picture, true).then((url) => {
      if (url) img.src = url;
      else img.remove();
    });
    const text = document.createElement('p');
    text.textContent = item.text;
    box.append(img, text);
    this.talkButton(box, 'Continue', () => this.closeTalk());
  }

  /** The game timer's dialog (0x004df2a1): the fixed choices, or a custom time. */
  private showTimer(): void {
    const box = this.talkBox();
    box.replaceChildren();
    const heading = document.createElement('h3');
    heading.textContent = 'Game timer';
    box.append(heading);
    const set = (ms: number) => {
      this.game.state.turnTimerMs = ms;
      this.timerEnds = ms > 0 ? Date.now() + ms : 0;
      this.closeTalk();
    };
    const choices: [string, number][] = [
      ['Unlimited', 0],
      ['30 seconds', 30000],
      ['1 minute', 60000],
      ['2 minutes', 120000],
      ['3 minutes', 180000],
      ['5 minutes', 300000],
    ];
    for (const [label, ms] of choices) this.talkButton(box, label, () => set(ms));
    this.talkButton(box, 'Custom', () => {
      const minutes = Number(window.prompt('Minutes', '10') ?? 0);
      const seconds = Number(window.prompt('Seconds', '0') ?? 0);
      if (Number.isFinite(minutes) && Number.isFinite(seconds))
        set(Math.max(0, minutes * 60000 + seconds * 1000));
    });
  }

  private timerEnds = 0;
  private timerTick: ReturnType<typeof setInterval> | undefined;

  /** A human's turn starts: the clock restarts, and when it runs out the turn ends. */
  private startTimer(): void {
    const ms = this.game.state.turnTimerMs ?? 0;
    this.timerEnds = ms > 0 ? Date.now() + ms : 0;
    this.timerTick ??= setInterval(() => {
      if (this.timerEnds === 0) return;
      const left = this.timerEnds - Date.now();
      if (left > 0) {
        this.renderStatus();
        return;
      }
      if (this.talk || this.seatPending) return; // a question is answered first
      this.closeTalk();
      this.timerEnds = 0;
      this.endTurn();
    }, 500);
  }

  /** Choosing what to research (0x00495ee8): the advisor's pick first. */
  private showResearch(): void {
    if (this.researchOpen) return;
    const civ = this.civ;
    const options = researchChoices(this.rules, civ, this.game.state.difficulty);
    if (options.length === 0) return;
    this.researchOpen = true;
    const advised = this.game.suggestResearch(civ);
    const box = this.talkBox();
    box.replaceChildren();
    const heading = document.createElement('h3');
    heading.textContent = 'Research';
    const body = document.createElement('p');
    // The label changes once the civilization knows advance 38 (0x00495ee8).
    const who = civ.knownAdvances[38] === true ? 'scientists' : 'wise men';
    body.textContent = `What should our ${who} study next?`;
    box.append(heading, body);
    const close = (pick: number | null) => {
      this.researchOpen = false;
      if (pick !== null) civ.researching = pick;
      this.closeTalk();
      this.refresh();
    };
    const ordered = [...options].sort((a, b) => Number(b === advised) - Number(a === advised));
    for (const a of ordered) {
      const name = this.rules.advances[a]?.name ?? `advance ${a}`;
      this.talkButton(box, a === advised ? `${name} (advised)` : name, () => close(a));
    }
    this.talkButton(box, 'Goal', () => {
      this.showResearchGoal(0);
    });
    this.talkButton(box, 'Civilopedia', () => {
      this.researchOpen = false;
      this.showPedia();
    });
  }

  /** The Goal button (0x00495281): pick anything unknown and hear which choices lead there. */
  private showResearchGoal(tab: number): void {
    const civ = this.civ;
    const known = (a: number) => civ.knownAdvances[a] === true;
    const entries: { name: string; advance: number }[] = [];
    if (tab === 0) {
      this.rules.advances.forEach((a, i) => {
        if (a && a.preq1.kind !== 'never' && !known(i)) entries.push({ name: a.name, advance: i });
      });
    } else {
      const items = tab === 1 ? this.rules.units : this.rules.improvements;
      for (const item of items) {
        const advance = advanceIndex(item?.preq);
        if (!item || advance === null || known(advance)) continue;
        const via = this.rules.advances[advance]?.name ?? '';
        entries.push({ name: `${item.name} (${via})`, advance });
      }
    }
    const box = this.talkBox();
    box.replaceChildren();
    const heading = document.createElement('h3');
    heading.textContent = 'Research goal';
    box.append(heading);
    const list = document.createElement('div');
    list.style.cssText = 'max-height:50vh;overflow:auto';
    box.append(list);
    for (const e of entries) {
      this.talkButton(list, e.name, () => {
        const paths = researchPaths(this.rules, civ, this.game.state.difficulty, e.advance);
        const names = paths.map((a) => this.rules.advances[a]?.name ?? `${a}`);
        box.replaceChildren();
        const text = document.createElement('p');
        text.textContent = names.length
          ? `The way to ${e.name} lies through ${names.join(', ')}.`
          : `Nothing we can study now leads to ${e.name}.`;
        box.append(text);
        this.talkButton(box, 'Back', () => {
          this.researchOpen = false;
          this.showResearch();
        });
      });
    }
    ['Advances', 'Units', 'Improvements'].forEach((label, t) => {
      if (t !== tab) this.talkButton(box, label, () => this.showResearchGoal(t));
    });
    this.talkButton(box, 'Back', () => {
      this.researchOpen = false;
      this.showResearch();
    });
  }

  /** Which part a finished component or module becomes (COMPONENT, MODULE, 0x0053f36b). */
  private showPartChoice(kind: number): void {
    const civ = this.civ;
    const ship = shipOf(civ);
    const parts = kind === 1 ? [1, 2] : [3, 4, 5];
    const box = this.talkBox();
    box.replaceChildren();
    const heading = document.createElement('h3');
    heading.textContent = kind === 1 ? 'Spaceship component' : 'Spaceship module';
    box.append(heading);
    for (const part of parts) {
      const have = ship.parts[part] ?? 0;
      const full = have >= (PART_LIMITS[part] ?? 0);
      const label = `${PART_NAMES[part] ?? part}: ${have}${full ? ' (no room for more)' : ''}`;
      const button = this.talkButton(box, label, () => {
        const events: SpaceshipEvent[] = [];
        civ.pendingParts?.shift();
        buildPart(this.world, civ, kind, this.game.shipContext(), events, part);
        for (const e of events) this.log(`${e.text}.`);
        this.closeTalk();
      });
      button.disabled = full;
    }
  }

  /** The Casualty Timeline: units of ours lost, newest first. */
  private showCasualties(): void {
    const box = this.talkBox();
    box.replaceChildren();
    const body = document.createElement('pre');
    body.style.cssText = 'margin:8px 0;max-height:60vh;overflow:auto;font:12px monospace';
    const lines = this.game.casualtyLog
      .filter((c) => c.defender === this.humanSlot)
      .reverse()
      .map(
        (c) =>
          `Turn ${c.turn}: ${this.rules.units[c.type]?.name ?? '?'} lost to the ${this.world.civs.find((x) => x.slot === c.attacker)?.name ?? 'barbarians'}`,
      );
    body.textContent = lines.length ? lines.join('\n') : 'No casualties reported.';
    box.append(body);
    this.talkButton(box, 'Close', () => this.closeTalk());
  }

  /** Hot seat: nobody sees the map until the next player says so (HOTSEATTURN). */
  private announceSeat(): void {
    this.seatPending = true;
    const box = this.talkBox();
    box.replaceChildren();
    const text = document.createElement('div');
    text.textContent = `${this.civ.leader} of the ${this.civ.name}: your turn.`;
    box.appendChild(text);
    this.talkButton(box, 'OK', () => {
      this.seatPending = false;
      this.closeTalk();
      const home = this.world.cities.find((c) => c.owner === this.humanSlot);
      if (home) this.centreOn(home.position);
    });
  }

  /** The Throne Room: picture 100, then each part's level on top (pv.dll). */
  private async drawThrone(canvas: HTMLCanvasElement): Promise<void> {
    const g = canvas.getContext('2d');
    if (!g) return;
    canvas.width = 640;
    canvas.height = 480;
    const load = (url: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
    const base = await this.folder.art('PV.DLL', 100, true);
    if (!base) {
      canvas.remove();
      return;
    }
    g.drawImage(await load(base), 0, 0);
    const levels = throneOf(this.civ);
    const extras = levels.every((v) => v >= 4) ? (this.civ.throneExtras ?? 0) : 0;
    const blit = async (id: number, x: number, y: number, w: number, h: number) => {
      const url = await this.folder.art('PV.DLL', id);
      if (url) g.drawImage(await load(url), x, y, w, h, x - 1, y - 1, w, h);
    };
    const part = async (n: number) => {
      const level = levels[n] ?? 0;
      if (level === 0) return;
      const at = (n * 4 + level - 1) * 4;
      const [x = 1, y = 1, w = 0, h = 0] = THRONE_ART.slice(at, at + 4);
      await blit(105 + n * 5 + level - 1, x, y, w, h);
    };
    const extra = async (bit: number) => {
      if ((extras & (1 << bit)) === 0) return;
      const [x = 1, y = 1, w = 0, h = 0] = THRONE_EXTRA.slice(bit * 4, bit * 4 + 4);
      await blit(160 + bit, x, y, w, h);
    };
    // The layers of 0x004398f2, back to front.
    for (const step of THRONE_LAYERS) await (step < 8 ? part(step) : extra(step - 8));
  }

  private showThrone(award: boolean): void {
    const box = this.talkBox();
    box.style.width = '660px';
    box.replaceChildren();
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    box.appendChild(canvas);
    void this.drawThrone(canvas);
    const done = () => {
      box.style.width = '420px';
      this.closeTalk();
    };
    if (award) {
      const text = document.createElement('div');
      text.textContent = 'Your people wish to add to the Throne Room.';
      box.appendChild(text);
      const levels = throneOf(this.civ);
      if (levels.some((v) => v < 4)) {
        levels.forEach((v, part) => {
          if (v < 4)
            this.talkButton(box, `Improve part ${part + 1} (level ${v + 1})`, () => {
              levels[part] = v + 1;
              this.showThrone(false);
            });
        });
      } else {
        for (let bit = 0; bit < 7; bit++) {
          if (((this.civ.throneExtras ?? 0) & (1 << bit)) !== 0) continue;
          this.talkButton(box, `Add piece ${bit + 1}`, () => {
            this.civ.throneExtras = (this.civ.throneExtras ?? 0) | (1 << bit);
            this.showThrone(false);
          });
        }
      }
      return;
    }
    this.talkButton(box, 'Close', done);
  }

  /** The City View, for a city you can see. */
  private showCityView(city: City): void {
    const box = this.talkBox();
    box.style.width = '960px';
    box.replaceChildren();
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;image-rendering:auto';
    box.appendChild(canvas);
    void drawCityView(canvas, this.game, this.folder, city).then((ok) => {
      if (!ok) canvas.remove();
    });
    this.talkButton(box, 'Close', () => {
      box.style.width = '420px';
      this.closeTalk();
    });
  }

  private airliftMenu(unit: Unit): void {
    const r = airliftTargets(this.world, this.rules, unit);
    if ('refused' in r) {
      const text = {
        ship: 'Ships cannot be airlifted.',
        plane: 'Aircraft cannot be airlifted.',
        'no-airport': 'This city has no airport.',
        used: 'This city has used its airlift this turn.',
        'no-other': 'You have no other airport.',
      };
      this.log(text[r.refused]);
      return;
    }
    const box = this.talkBox();
    box.replaceChildren();
    for (const c of r.targets)
      this.talkButton(box, c.name, () => {
        const threat = airliftThreat(
          this.world,
          this.rules,
          unit,
          c,
          (o) => ((treatiesOf(this.civ)[o] ?? 0) & TREATY.war) !== 0,
        );
        if (threat.count > 0 && !window.confirm('Enemy fighters are in range. Fly anyway?')) return;
        if (airlift(this.world, this.game.rng, unit, c, threat.count))
          this.log(`${this.unitName(unit)} flies to ${c.name}.`);
        else {
          this.log(`${this.unitName(unit)} is shot down.`);
          this.selected = null;
        }
        this.closeTalk();
      });
    this.talkButton(box, 'Close', () => this.closeTalk());
  }

  private findCity(): void {
    const box = this.talkBox();
    box.replaceChildren();
    const list = document.createElement('div');
    list.style.cssText = 'max-height:60vh;overflow:auto';
    for (const c of this.world.cities.filter((x) =>
      this.world.isSeen(x.position.x, x.position.y, this.humanSlot),
    ))
      this.talkButton(list, c.name, () => {
        this.centreOn(c.position);
        this.closeTalk();
      });
    box.appendChild(list);
    this.talkButton(box, 'Close', () => this.closeTalk());
  }

  private paradrop(unit: Unit, to: Point): void {
    this.paradropMode = false;
    const range = this.folder.rules.cosmic.maxParadropRange;
    const why = paradropCheck(this.world, unit, to.x, to.y, range);
    if (why) {
      const text = {
        moved: 'Paratroopers must start the turn unmoved.',
        'not-from-base': 'They must start in a city or at an airbase.',
        ocean: 'They cannot land on ocean.',
        enemy: 'Enemy units hold that square.',
        range: `They can drop only ${range} squares.`,
      };
      this.log(text[why]);
      return;
    }
    const city = this.world.cityAt(to.x, to.y);
    if (city && city.owner !== unit.owner) {
      const word = treaty(this.world, unit.owner, city.owner);
      if ((word & (TREATY.ceaseFire | TREATY.peace | TREATY.alliance)) !== 0) {
        const name = this.world.civs.find((c) => c.slot === city.owner)?.name ?? '';
        if (!window.confirm(`This breaks your treaty with the ${name}. Proceed?`)) return;
        const events: DiplomacyEvent[] = [];
        declareWar(this.world, unit.owner, city.owner, this.game.diplomacyContext(), events);
        for (const e of events) this.log(`${e.text}.`);
      }
    }
    unit.position = to;
    unit.dropped = true;
    lookAround(this.world, this.rules, unit);
    if (city && city.owner !== unit.owner) this.takeCity(unit, city);
    this.afterAction();
  }

  /** The High Council: each advisor rates us and speaks, others answering (council.ts). */
  private showCouncil(): void {
    const box = this.talkBox();
    box.replaceChildren();
    const title = document.createElement('div');
    title.style.fontWeight = 'bold';
    title.textContent = 'High Council';
    const body = document.createElement('pre');
    body.style.cssText =
      'margin:8px 0;max-height:60vh;overflow:auto;font:12px monospace;white-space:pre-wrap';
    const { era, ratings } = councilRatings(this.game, this.humanSlot);
    const sections = parseCouncil(this.folder.council[era] ?? '');
    const lines: string[] = [];
    if (this.civ.government === 0) lines.push('Anarchy: the council cannot meet.');
    else
      for (let a = 0; a < 5; a++) {
        lines.push(...councilSpeech(sections, a, ratings, this.game.rng), '');
      }
    body.textContent = lines.join('\n');
    box.append(title, body);
    this.talkButton(box, 'Close', () => this.closeTalk());
  }

  /** The Civilopedia: Describe.txt with each entry's rules facts above it. */
  private showPedia(category?: PediaCategory, row?: number): void {
    const box = this.talkBox();
    box.replaceChildren();
    const rules = this.rules;
    const lists: Record<PediaCategory, { label: string; items: { name: string; row: number }[] }> =
      {
        ADVANCE: {
          label: 'Civilization Advances',
          items: rules.advances.map((a, i) => ({ name: a.name, row: i })),
        },
        IMPROVEMENT: {
          label: 'City Improvements',
          items: rules.improvements
            .map((a, i) => ({ name: a.name, row: i }))
            .filter((x) => x.row >= 1 && x.row < 39),
        },
        WONDER: {
          label: 'Wonders of the World',
          items: rules.improvements
            .map((a, i) => ({ name: a.name, row: i - 39 }))
            .filter((x) => x.row >= 0),
        },
        UNIT: { label: 'Unit Types', items: rules.units.map((a, i) => ({ name: a.name, row: i })) },
        GOVERNMENT: {
          label: 'Governments',
          items: this.folder.rules.governments.map((g, i) => ({ name: g.name, row: i })),
        },
        TERRAIN_AND_RESOURCE: {
          label: 'Terrain Types',
          items: this.groupItems('TERRAIN_AND_RESOURCE'),
        },
        CONCEPT: { label: 'Game Concepts', items: this.groupItems('CONCEPT') },
      };
    const heading = document.createElement('div');
    heading.style.fontWeight = 'bold';
    if (!category) {
      heading.textContent = 'Civilopedia';
      box.appendChild(heading);
      for (const k of Object.keys(lists) as PediaCategory[])
        this.talkButton(box, lists[k].label, () => this.showPedia(k));
      this.talkButton(box, 'Close', () => this.closeTalk());
      return;
    }
    if (row === undefined) {
      heading.textContent = lists[category].label;
      box.appendChild(heading);
      const list = document.createElement('div');
      list.style.cssText = 'max-height:60vh;overflow:auto';
      for (const it of lists[category].items)
        this.talkButton(list, it.name, () => this.showPedia(category, it.row));
      box.appendChild(list);
      this.talkButton(box, 'Back', () => this.showPedia());
      return;
    }
    const item = lists[category].items.find((x) => x.row === row);
    heading.textContent = item?.name ?? '';
    const body = document.createElement('div');
    body.style.cssText = 'max-height:60vh;overflow:auto;margin:8px 0';
    const group = this.folder.descriptions?.groups.get(category);
    const entry =
      category === 'TERRAIN_AND_RESOURCE' || category === 'CONCEPT'
        ? group?.entries[row]
        : this.folder.descriptions
          ? descriptionFor(this.folder.descriptions, category, row)
          : undefined;
    body.textContent = [...this.pediaFacts(category, row), '', ...(entry?.text ?? [])].join('\n');
    box.append(heading, body);
    this.talkButton(box, 'Back', () => this.showPedia(category));
  }

  private groupItems(category: PediaCategory): { name: string; row: number }[] {
    const g = this.folder.descriptions?.groups.get(category);
    return (g?.entries ?? []).map((e, row) => ({ name: e.title, row }));
  }

  /** The game options that mean something in a browser (the GAMEOPTIONS list). */
  private showOptions(): void {
    const box = this.talkBox();
    box.replaceChildren();
    const title = document.createElement('div');
    title.textContent = 'Game Options';
    box.appendChild(title);
    this.talkButton(box, `Sound effects: ${this.muted ? 'off' : 'on'}`, () => {
      this.muted = !this.muted;
      this.showOptions();
    });
    this.talkButton(box, 'Close', () => this.closeTalk());
  }

  private chat(): void {
    if (!this.onChat) {
      this.log('Chat needs a network game.');
      return;
    }
    const text = window.prompt('Message to the other players:');
    if (text) this.onChat(text);
  }

  /** Retire (0x004af61c): the power graph, then the score, and the game ends. */
  private retire(): void {
    if (window.confirm('Really retire?')) this.showPowerGraph(true);
  }

  private showPowerGraph(ending: boolean): void {
    const box = this.talkBox();
    box.replaceChildren();
    const title = document.createElement('div');
    title.textContent = 'Civilization Power';
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    box.append(title, canvas);
    const g = canvas.getContext('2d');
    const history = this.game.state.powerHistory ?? [];
    const last = Math.min(149, this.game.state.turn >> 2);
    const top = Math.max(1, ...history.flat());
    const colours = ['#888', '#fff', '#0a0', '#44f', '#ee0', '#0cc', '#f80', '#c0c'];
    if (g) {
      g.fillStyle = '#111';
      g.fillRect(0, 0, 400, 200);
      for (let s = 1; s < 8; s++) {
        g.strokeStyle = colours[s] ?? '#fff';
        g.beginPath();
        for (let t = 0; t <= last; t++) {
          const v = history[t]?.[s] ?? 0;
          const x = (t / Math.max(1, last)) * 396 + 2;
          const y = 198 - (v / top) * 196;
          if (t === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    const score = document.createElement('div');
    score.textContent = `Your score: ${this.game.scoreOf(this.humanSlot).total}`;
    box.appendChild(score);
    this.talkButton(box, ending ? 'End game' : 'Close', () => {
      if (ending) this.game.state.gameOver = { winner: this.humanSlot, reason: 'retirement' };
      this.closeTalk();
    });
  }

  private pediaFacts(category: PediaCategory, row: number): string[] {
    const rules = this.rules;
    const adv = (r: { kind: string; index?: number } | undefined) =>
      r?.kind === 'advance'
        ? (rules.advances[r.index ?? 0]?.name ?? '?')
        : r?.kind === 'never'
          ? 'never'
          : 'none';
    if (category === 'ADVANCE') {
      const a = rules.advances[row];
      if (!a) return [];
      const leads = rules.advances.filter(
        (x) =>
          (x.preq1.kind === 'advance' && x.preq1.index === row) ||
          (x.preq2.kind === 'advance' && x.preq2.index === row),
      );
      return [
        `Requires ${adv(a.preq1)}, ${adv(a.preq2)}.`,
        `Leads to ${leads.map((x) => x.name).join(', ') || 'nothing further'}.`,
        `Allows ${
          [
            ...rules.units.filter((u) => u.preq?.kind === 'advance' && u.preq.index === row),
            ...rules.improvements.filter((u) => u.preq?.kind === 'advance' && u.preq.index === row),
          ]
            .map((x) => x.name)
            .join(', ') || 'nothing to build'
        }.`,
      ];
    }
    if (category === 'UNIT') {
      const u = rules.units[row];
      if (!u) return [];
      return [
        `Attack ${u.attack}, defence ${u.defence}, moves ${u.move}, hit points ${u.hitPointsTens * 10}, firepower ${u.firepower}.`,
        `Cost ${u.costRows * rules.cosmic.shieldBoxRows} shields. Requires ${adv(u.preq)}. Obsolete with ${adv(u.obsoleteWith)}.`,
      ];
    }
    if (category === 'IMPROVEMENT' || category === 'WONDER') {
      const i = category === 'WONDER' ? row + 39 : row;
      const r = rules.improvements[i];
      if (!r) return [];
      return [
        `Cost ${r.costRows * rules.cosmic.shieldBoxRows} shields, upkeep ${r.upkeep} gold. Requires ${adv(r.preq)}.`,
        ...(category === 'WONDER' ? [`Ends with ${adv(r.expiresWith)}.`] : []),
      ];
    }
    return [];
  }

  /** The advisors: one text page each, closed with its button or Escape. */
  private showReport(key: string): void {
    const box = this.talkBox();
    box.replaceChildren();
    const page = this.reportPage(key);
    const title = document.createElement('div');
    title.style.fontWeight = 'bold';
    title.textContent = page.title;
    const body = document.createElement('pre');
    body.style.cssText = 'margin:8px 0;max-height:60vh;overflow:auto;font:12px monospace';
    body.textContent = page.lines.join('\n');
    box.append(title, body);
    if (key === 'F3') {
      for (const r of foreignRows(this.game, this.humanSlot))
        this.talkButton(box, `Send an emissary to the ${r.civ.name}`, () =>
          this.startTalk(r.civ.slot, true),
        );
    }
    if (key === 'F12') {
      const ship = this.civ.spaceship;
      if (ship) {
        const canvas = document.createElement('canvas');
        canvas.style.width = '100%';
        box.appendChild(canvas);
        void this.drawShip(canvas, ship);
      }
    }
    this.talkButton(box, 'Close', () => this.closeTalk());
  }

  /** The ship against the stars (0x004a224f): under-parts, the frame, then the parts on top. */
  private async drawShip(canvas: HTMLCanvasElement, ship: Spaceship): Promise<void> {
    const g = canvas.getContext('2d');
    if (!g) return;
    canvas.width = 640;
    canvas.height = 480;
    const load = async (id: number, opaque = false): Promise<HTMLImageElement | null> => {
      const url = await this.folder.art('SS.DLL', id, opaque);
      if (!url) return null;
      return new Promise((resolve) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => resolve(null);
        i.src = url;
      });
    };
    const stars = await load(499, true);
    if (!stars) {
      canvas.remove();
      return;
    }
    g.drawImage(stars, 0, 0);
    const parts = async (rows: readonly PartRow[]) => {
      for (const [kind, count, x, y, w, h, sheetX] of rows) {
        if ((ship.parts[kind] ?? 0) < count) continue;
        const fits = count <= Math.min(ship.parts[kind] ?? 0, partLimit(ship, kind, true));
        const sheet = await load(PART_SHEETS[kind]?.[fits ? 0 : 1] ?? 491);
        if (sheet) g.drawImage(sheet, sheetX, 1, w, h, x, y, w, h);
      }
    };
    await parts(PARTS_UNDER);
    const built = ship.parts[0] ?? 0;
    const frame = SHIP_FRAMES.filter((f) => f[0] <= built).at(-1);
    if (frame) {
      const [, id, x, y, w, h] = frame;
      const image = await load(id);
      if (image) g.drawImage(image, x, y, w, h, x, y, w, h);
    }
    await parts(PARTS_OVER);
  }

  private reportPage(key: string): { title: string; lines: string[] } {
    const game = this.game;
    const slot = this.humanSlot;
    const unit = (i: number) => this.rules.units[i]?.name ?? '?';
    const pad = (s: string | number, n: number) => String(s).padEnd(n);
    const num = (s: string | number, n: number) => String(s).padStart(n);
    switch (key) {
      case 'F1':
        return {
          title: `City Status: the ${this.civ.name}, ${this.yearText()}`,
          lines: [
            `${pad('City', 18)}${num('Size', 5)}${num('Food', 6)}${num('Shld', 6)}${num('Trade', 6)}  Building`,
            ...cityRows(game, slot).map(
              (r) =>
                `${pad(r.city.name, 18)}${num(r.city.size, 5)}${num(r.food, 6)}${num(r.shields, 6)}${num(r.trade, 6)}  ${
                  r.city.production.kind === 'unit'
                    ? unit(r.city.production.index)
                    : (this.rules.improvements[r.city.production.index]?.name ?? '?')
                }`,
            ),
          ],
        };
      case 'F2':
        return {
          title: 'Defense Minister',
          lines: [
            `${pad('Unit', 22)}${num('A/D/M', 9)}${num('Active', 8)}${num('Building', 10)}${num('Lost', 6)}`,
            ...defenseRows(game, slot).map(
              (r) =>
                `${pad(r.type.name, 22)}${num(`${r.type.attack}/${r.type.defence}/${r.type.move}`, 9)}${num(r.active, 8)}${num(r.building, 10)}${num(r.lost, 6)}`,
            ),
          ],
        };
      case 'F3':
        return {
          title: 'Foreign Minister',
          lines: foreignRows(game, slot).map(
            (r) =>
              `${pad(r.civ.name, 16)}${pad(r.status, 12)}${r.embassy ? `embassy, ${r.cities} cities` : 'no embassy'}, ${this.folder.rules.attitudes[r.attitudeBand] ?? ''}`,
          ),
        };
      case 'F4':
        return {
          title: 'Attitude Advisor',
          lines: [
            `${pad('City', 18)}${num('Happy', 6)}${num('Content', 8)}${num('Unhappy', 8)}${num('Spec', 5)}`,
            ...cityRows(game, slot).map(
              (r) =>
                `${pad(r.city.name, 18)}${num(r.happy, 6)}${num(r.content, 8)}${num(r.unhappy, 8)}${num(r.specialists, 5)}`,
            ),
          ],
        };
      case 'F5': {
        const t = tradeReport(game, slot);
        return {
          title: 'Trade Advisor',
          lines: [
            `Income ${t.income}, upkeep ${t.costs}, net ${t.income - t.costs}, science ${t.science}`,
            '',
            ...t.rows.map(
              (r) => `${pad(r.city.name, 18)}${num(r.tax, 5)} gold ${num(r.science, 4)} science`,
            ),
            '',
            ...t.upkeep.map(
              (u) =>
                `${pad(this.rules.improvements[u.index]?.name ?? '?', 22)}${num(u.count, 4)} × ${num(u.cost, 4)} gold`,
            ),
          ],
        };
      }
      case 'F6': {
        const s = scienceReport(game, slot);
        return {
          title: 'Science Advisor',
          lines: [
            `Researching ${s.researching === null ? 'nothing' : (this.rules.advances[s.researching]?.name ?? '?')}: ${s.stored} of ${s.cost}, +${s.perTurn} a turn`,
            s.every === null
              ? 'No discoveries at this rate.'
              : `Discoveries every ${s.every} turns.`,
            '',
            ...s.known.map((a) => this.rules.advances[a]?.name ?? '?'),
          ],
        };
      }
      case 'F7':
        return {
          title: 'Wonders of the World',
          lines: wonderRows(game).map(
            (w) =>
              `${pad(this.rules.improvements[w.index]?.name ?? '?', 28)}${pad(w.city.name, 16)}${this.world.civs.find((c) => c.slot === w.city.owner)?.name ?? ''}${w.expired ? ' (expired)' : ''}`,
          ),
        };
      case 'F8':
        return {
          title: 'Top Five Cities',
          lines: topCities(game).map(
            (c, i) =>
              `${i + 1}. ${pad(c.name, 18)}${pad(this.world.civs.find((x) => x.slot === c.owner)?.name ?? '', 16)}size ${c.size}`,
          ),
        };
      case 'F9': {
        const s = game.scoreOf(slot);
        return {
          title: 'Civilization Score (G: the power graph)',
          lines: Object.entries(s).map(([k, v]) => `${pad(k, 22)}${num(String(v), 8)}`),
        };
      }
      case 'F11':
        return {
          title: 'Demographics',
          lines: demographics(game, slot).map(
            (d) => `${pad(d.label, 22)}${num(d.value, 8)}   rank ${d.rank}`,
          ),
        };
      default: {
        const ships = spaceshipRows(game);
        return {
          title: 'Spaceships',
          lines: ships.length
            ? ships.map(
                (s) =>
                  `${pad(s.civ.name, 16)}parts ${s.parts.join(' ')}${s.launched ? `, arrives ${s.arrival}` : ''}`,
              )
            : ['No spaceship has been started.'],
        };
      }
    }
  }

  private talkBox(): HTMLElement {
    let box = document.getElementById('talkBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'talkBox';
      box.style.cssText =
        'position:fixed;left:50%;top:18%;transform:translateX(-50%);width:420px;padding:14px;' +
        'background:#efe6cf;color:#222;border:2px solid #333;z-index:50;white-space:pre-wrap';
      document.body.appendChild(box);
    }
    box.style.display = 'block';
    return box;
  }

  private talkButton(box: HTMLElement, label: string, run: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'display:block;width:100%;margin-top:6px;text-align:left';
    b.addEventListener('click', run);
    box.appendChild(b);
    return b;
  }

  private closeTalk(): void {
    this.talk = null;
    this.researchOpen = false;
    const box = document.getElementById('talkBox');
    if (box) box.style.display = 'none';
    this.refresh();
    this.nextTalk();
  }

  private researchOpen = false;

  private nextTalk(): void {
    if (this.talk || this.seatPending) return;
    const talk = this.game.nextPendingTalk(this.humanSlot);
    if (!talk) {
      if (this.pendingRevolution !== null) {
        const advance = this.pendingRevolution;
        this.pendingRevolution = null;
        this.showRevolution(advance);
        return;
      }
      const i = this.game.allyCalls.findIndex((c) => c.human === this.humanSlot);
      if (i >= 0) {
        const [call] = this.game.allyCalls.splice(i, 1);
        if (call) this.showAllyCall(call);
        return;
      }
      const item = this.news.shift();
      if (item) {
        this.showNews(item);
        return;
      }
      const part = this.civ.pendingParts?.[0];
      if (part !== undefined) this.showPartChoice(part);
      else if (this.civ.researching === null && this.game.state.turn > 0) this.showResearch();
      return;
    }
    this.talk = talk;
    this.showDialog(talk.next());
  }

  private startTalk(computer: number, byHuman: boolean): void {
    const gen = this.game.talkTo(this.humanSlot, computer, byHuman);
    this.talk = gen;
    this.showDialog(gen.next());
  }

  private answerTalk(n: number): void {
    if (this.talk) this.showDialog(this.talk.next(n));
  }

  private showDialog(step: IteratorResult<Dialog, void>): void {
    if (step.done) {
      this.closeTalk();
      return;
    }
    const d = step.value;
    const fill = (line: string) =>
      line
        .replace(/%STRING(\d)/g, (_, n) => d.strings?.[Number(n)] ?? '')
        .replace(/%NUMBER(\d)/g, (_, n) => String(d.numbers?.[Number(n)] ?? ''));
    const box = this.talkBox();
    box.replaceChildren();
    const popup = this.folder.popups.get(d.key);
    const lines = popup?.text ?? [d.key];
    const gap = lines.indexOf('');
    const message = gap < 0 ? lines : lines.slice(0, gap);
    const choices = popup?.entries.length
      ? popup.entries
      : gap < 0
        ? []
        : lines.slice(gap + 1).filter((l) => l !== '');
    if (d.speaker !== undefined) {
      const civ = this.game.civ(d.speaker);
      const img = document.createElement('img');
      img.style.cssText = 'float:left;height:150px;margin:0 10px 6px 0';
      // The leader sits against the backdrop of their government (mk.dll 200 + government).
      const stage = document.createElement('div');
      stage.style.cssText =
        'height:190px;margin-bottom:6px;background-size:cover;background-position:center';
      stage.appendChild(img);
      box.appendChild(stage);
      img.style.cssText = 'height:190px;display:block;margin:0 auto';
      void this.folder.art('MK.DLL', 200 + civ.government, true).then((url) => {
        if (url) stage.style.backgroundImage = `url(${url})`;
      });
      const index = civ.portrait ?? civ.tribe ?? 0;
      void this.folder.art('MK.DLL', 220 + index).then((url) => {
        if (url) img.src = url;
        else img.remove();
      });
    }
    const text = document.createElement('div');
    text.textContent = message.map(fill).join('\n');
    box.appendChild(text);
    if (d.title) text.textContent = d.title;
    if (d.pick) {
      this.talkButton(box, 'Never mind', () => this.answerTalk(-1));
      for (const p of d.pick) this.talkButton(box, p.label, () => this.answerTalk(p.value));
      return;
    }
    if (d.civs) {
      this.talkButton(box, 'Never mind', () => this.answerTalk(0));
      for (const s of d.civs) this.talkButton(box, this.game.civ(s).name, () => this.answerTalk(s));
      return;
    }
    if (d.amounts) {
      this.talkButton(box, 'Never mind', () => this.answerTalk(0));
      for (const g of d.amounts) this.talkButton(box, `${g} gold`, () => this.answerTalk(g));
      return;
    }
    if (choices.length === 0) {
      this.talkButton(box, 'OK', () => this.answerTalk(0));
      return;
    }
    choices.forEach((c, i) => {
      if (!d.offer || d.offer.includes(i)) this.talkButton(box, fill(c), () => this.answerTalk(i));
    });
  }

  /** Buttons for a diplomat's or spy's mission (espionage.ts). */
  private agentMenu(
    pending: { unit: Unit; city: City } | { unit: Unit; target: Unit },
  ): HTMLElement {
    const box = document.createElement('div');
    const title = document.createElement('div');
    const ctx = this.game.espionageContext();
    const button = (label: string, run: () => EspionageEvent[]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => {
        const events = run();
        for (const e of events) {
          this.log(`${e.text}.`);
          if (e.investigated !== undefined) {
            const c = this.world.cities.find((x) => x.id === e.investigated);
            if (c) this.openCity = c;
          }
        }
        this.pendingAgent = null;
        if (!this.world.units.includes(pending.unit)) this.selected = null;
        this.refresh();
      });
      box.appendChild(b);
    };
    const cancel = () => {
      this.pendingAgent = null;
      this.refresh();
    };
    if ('city' in pending) {
      const { unit, city } = pending;
      title.textContent = `${this.unitName(unit)} at ${city.name} (${this.world.civs[city.owner]?.name ?? '?'}):`;
      box.appendChild(title);
      for (const action of espionageOptions(this.world, unit, city, ctx)) {
        if (action === 'incite') {
          const cost = inciteCost(this.world, unit, city);
          button(`Incite a revolt (${cost} gold)`, () =>
            performEspionage(this.world, this.rules, unit, city, 'incite', ctx, 1),
          );
          continue;
        }
        if (action === 'sabotage' && unit.type === SPY_TYPE) {
          button('Sabotage (random)', () =>
            performEspionage(this.world, this.rules, unit, city, 'sabotage', ctx),
          );
          for (let i = 2; i < 39; i++) {
            if (!city.improvements[i] || i === 17) continue;
            button(`Sabotage ${this.rules.improvements[i]?.name ?? i}`, () =>
              performEspionage(this.world, this.rules, unit, city, 'sabotage', ctx, i),
            );
          }
          continue;
        }
        const labels: Record<EspionageAction, string> = {
          embassy: 'Establish an embassy',
          investigate: 'Investigate the city',
          steal: 'Steal technology',
          sabotage: 'Sabotage',
          poison: 'Poison the water supply',
          nuke: 'Plant a nuclear device',
          incite: 'Incite a revolt',
        };
        button(labels[action], () =>
          performEspionage(this.world, this.rules, unit, city, action, ctx),
        );
      }
    } else {
      const { unit, target } = pending;
      const cost = bribeCost(this.world, this.rules, target, unit.owner);
      title.textContent = `${this.unitName(unit)} meets a lone ${this.unitName(target)}:`;
      box.appendChild(title);
      button(cost === null ? 'Bribe (impossible)' : `Bribe for ${cost} gold`, () =>
        bribeUnit(this.world, this.rules, unit.owner, target, ctx),
      );
      if (unit.type === SPY_TYPE)
        button('Sabotage the unit', () => sabotageUnit(this.world, this.rules, unit, target, ctx));
    }
    const c = document.createElement('button');
    c.textContent = 'Keep moving';
    c.addEventListener('click', cancel);
    box.appendChild(c);
    return box;
  }

  private renderCityPanel(): void {
    const city = this.openCity;
    const el = this.el.cityPanel;
    if (!city || !this.world.cities.includes(city)) {
      el.replaceChildren();
      return;
    }
    const ctx = this.game.cityContext(city);
    const raw = rawYields(this.world, this.rules, city, ctx);
    const homed = this.world.units.filter((u) => u.homeCity === city.id);
    const support = unitSupport(this.world, this.rules, city, ctx, homed);
    const shields = shieldTotals(this.rules, city, ctx, raw.shields, support.shields);
    const trade = tradeSplit(this.rules, city, ctx, raw.trade);
    const m = mood(this.rules, city, ctx, {
      luxuries: trade.luxuries,
      militaryInCity: support.inCity,
      militaryAbroad: support.abroad,
      noMilitaryUnhappiness: support.abroad === 0,
    });
    const eaten = city.size * this.rules.cosmic.foodPerCitizen + support.settlers;
    const prodName =
      city.production.kind === 'unit'
        ? this.rules.units[city.production.index]?.name
        : this.rules.improvements[city.production.index]?.name;
    const cost =
      this.game.productionContext(city).shieldRows *
      (city.production.kind === 'unit'
        ? (this.rules.units[city.production.index]?.costRows ?? 0)
        : (this.rules.improvements[city.production.index]?.costRows ?? 0));
    const built = city.improvements
      .map((has, i) => (has ? this.rules.improvements[i]?.name : undefined))
      .filter((n): n is string => Boolean(n));
    const header = document.createElement('div');
    header.textContent =
      `${city.name} (size ${city.size})${city.inDisorder ? ' — DISORDER' : city.celebrating ? ' — celebrating' : ''}\n` +
      `food ${raw.food} − ${eaten} eaten (stored ${city.foodStored}) · shields ${shields.produced} − ${support.shields} support (waste ${shields.waste}) · ` +
      `trade ${raw.trade}: lux ${trade.luxuries} sci ${trade.science} tax ${trade.tax} (corruption ${trade.corruption})\n` +
      `citizens: ${m.happy} happy, ${m.content} content, ${m.unhappy} unhappy; ${city.specialists.entertainers + city.specialists.taxCollectors + city.specialists.scientists} specialists\n` +
      `producing ${prodName ?? '?'}: ${city.shieldsStored}/${cost} shields\n` +
      `buildings: ${built.join(', ') || 'none'}`;
    header.style.whiteSpace = 'pre-wrap';
    const label = document.createElement('label');
    label.textContent = 'Change production: ';
    const select = document.createElement('select');
    const canBuildOption = (opt: { kind: 'unit' | 'improvement'; index: number }) =>
      opt.kind === 'unit'
        ? this.game.canBuildUnitAt(city, opt.index)
        : this.game.canBuildImprovement(city, opt.index);
    const options: { kind: 'unit' | 'improvement'; index: number; label: string }[] = [];
    this.rules.units.forEach((u, i) => {
      if (canBuildOption({ kind: 'unit', index: i }))
        options.push({
          kind: 'unit',
          index: i,
          label: `${u.name} (${u.costRows * this.game.productionContext(city).shieldRows})`,
        });
    });
    this.rules.improvements.forEach((imp, i) => {
      if (canBuildOption({ kind: 'improvement', index: i }))
        options.push({
          kind: 'improvement',
          index: i,
          label: `${imp.name} (${imp.costRows * this.game.productionContext(city).shieldRows})`,
        });
    });
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = `${o.kind}:${o.index}`;
      opt.textContent = o.label;
      if (o.kind === city.production.kind && o.index === city.production.index) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener('change', () => {
      const [kind, idx] = select.value.split(':');
      if (kind === 'unit' || kind === 'improvement') {
        const lost = changeProduction(
          this.rules,
          city,
          { kind, index: Number(idx) },
          this.game.state.difficulty,
        );
        this.log(
          `${city.name} now builds ${select.selectedOptions[0]?.textContent ?? ''}${lost ? ` (${lost} shields lost to the change)` : ''}.`,
        );
        this.refresh();
      }
    });
    label.append(select);
    el.replaceChildren(header, label, this.cityOrders(city));
  }

  /** Buy, sell and the workers (humanOrders.ts). */
  private cityOrders(city: City): HTMLElement {
    const box = document.createElement('div');
    const civ = this.civ;
    const button = (label: string, run: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => {
        run();
        this.refresh();
      });
      return b;
    };
    const price = buyCost(this.rules, city);
    if (price !== null)
      box.appendChild(
        button(`Buy for ${price} gold`, () => {
          const r = buyProduction(this.rules, civ, city);
          if (r === null) this.sound('POS1');
          if (r === 'gold') this.log(`You need ${price} gold.`);
          if (r === 'disorder') this.log(`${city.name} is in disorder: no units can be bought.`);
        }),
      );
    box.appendChild(button('View', () => this.showCityView(city)));
    const sell = document.createElement('select');
    const none = document.createElement('option');
    none.textContent = city.soldThisTurn ? '(sold this turn)' : 'Sell…';
    none.value = '';
    sell.append(none);
    if (!city.soldThisTurn) {
      for (let i = 2; i < 39; i++) {
        if (!city.improvements[i]) continue;
        const o = document.createElement('option');
        const r = this.rules.improvements[i];
        o.value = String(i);
        o.textContent = `${r?.name ?? '?'} (${(r?.costRows ?? 0) * this.rules.cosmic.shieldBoxRows} gold)`;
        sell.append(o);
      }
    }
    sell.addEventListener('change', () => {
      if (sell.value === '') return;
      sellImprovement(this.rules, civ, city, Number(sell.value));
      this.sound('SELL');
      this.log(`${city.name} sells ${this.rules.improvements[Number(sell.value)]?.name ?? ''}.`);
      this.refresh();
    });
    box.appendChild(sell);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,28px);gap:1px;margin-top:4px';
    const { x: cx, y: cy } = city.position;
    const ctx = this.game.cityContext(city);
    const cells: (HTMLElement | null)[] = Array<HTMLElement | null>(49).fill(null);
    for (let i = 0; i <= CITY_CENTRE_INDEX; i++) {
      const p = this.world.radiusSquare(cx, cy, i);
      if (!p) continue;
      let dx = p.x - cx;
      if (dx > this.world.widthX2 / 2) dx -= this.world.widthX2;
      if (dx < -this.world.widthX2 / 2) dx += this.world.widthX2;
      const col = Math.round(dx / 2 + (p.y - cy) / 2) + 3;
      const row = Math.round((p.y - cy) / 2 - dx / 2) + 3;
      const cell = document.createElement('button');
      const worked = i === CITY_CENTRE_INDEX || (city.worked & (1 << i)) !== 0;
      const y = ([0, 1, 2] as const).map((k) =>
        squareYield(this.world, this.rules, city, i, k, ctx),
      );
      cell.textContent = y.join('');
      cell.title = 'food shields trade';
      cell.style.cssText = `padding:0;font:10px monospace;height:22px;background:${worked ? '#9c9' : '#ddd'}`;
      cell.addEventListener('click', () => {
        this.game.clickCitySquare(city, i);
        this.refresh();
      });
      cells[row * 7 + col] = cell;
    }
    for (const c of cells) grid.appendChild(c ?? document.createElement('span'));
    box.appendChild(grid);
    const sp = city.specialists;
    (['entertainers', 'taxCollectors', 'scientists'] as const).forEach((k, n) => {
      if (sp[k] > 0)
        box.appendChild(
          button(`${sp[k]} ${['entertainers', 'tax collectors', 'scientists'][n]}`, () => {
            cycleSpecialist(city, n as 0 | 1 | 2);
          }),
        );
    });
    return box;
  }

  private renderResearchPanel(): void {
    const civ = this.civ;
    const el = this.el.researchPanel;
    const current =
      civ.researching === null
        ? 'nothing'
        : (this.rules.advances[civ.researching]?.name ?? `advance ${civ.researching}`);
    const cost = this.game.researchCostFor(civ);
    const text = document.createElement('div');
    text.textContent = `Researching ${current}: ${civ.scienceStored}/${cost} beakers · ${civ.advancesCount} advances known`;
    if (civ.spaceship && hasStarted(civ)) {
      const ship = civ.spaceship;
      const ev = evaluateShip(
        ship,
        true,
        this.rules.cosmic.massThrustParadigm ?? 75,
        this.game.knows(this.humanSlot, 32),
        yearOf(this.game.state),
        true,
      );
      text.textContent += `\nSpaceship: ${PART_NAMES.map((n, i) => `${ship.parts[i] ?? 0} ${n}`).join(', ')} · success ${ev.success} % · flight ${(ev.flightTenths / 10).toFixed(1)} years · ${hasLaunched(civ) ? `launched ${ship.launchYear}, arrives ${ship.arrival}` : `would arrive ${ev.arrivalYear}`}`;
      if (!hasLaunched(civ) && (ship.parts[0] ?? 0) > 0) {
        const launch = document.createElement('button');
        launch.textContent = 'Launch';
        launch.addEventListener('click', () => {
          const events: SpaceshipEvent[] = [];
          launchShip(this.world, civ, this.game.shipContext(), events);
          for (const e of events) this.log(`${e.text}.`);
          this.refresh();
        });
        text.append(' ', launch);
      }
    }
    const label = document.createElement('label');
    label.textContent = 'Research: ';
    const select = document.createElement('select');
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '(choose)';
    select.append(none);
    for (const a of researchChoices(this.rules, civ, this.game.state.difficulty)) {
      const opt = document.createElement('option');
      opt.value = String(a);
      opt.textContent = this.rules.advances[a]?.name ?? String(a);
      if (a === civ.researching) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener('change', () => {
      civ.researching = select.value === '' ? null : Number(select.value);
      this.refresh();
    });
    label.append(select);
    const rates = document.createElement('div');
    const max = maxRate(civ.government);
    const slider = (name: string, value: number, set: (v: number) => void) => {
      const l = document.createElement('label');
      l.textContent = ` ${name} ${value * 10} %`;
      const r = document.createElement('input');
      r.type = 'range';
      r.min = '0';
      r.max = String(max);
      r.value = String(value);
      r.addEventListener('change', () => {
        set(Number(r.value));
        this.refresh();
      });
      l.append(r);
      return l;
    };
    rates.append(
      slider('Tax', civ.taxRate, (v) => {
        setRates(civ, v, civ.scienceRate);
      }),
      slider('Science', civ.scienceRate, (v) => {
        setRates(civ, civ.taxRate, v);
      }),
    );
    const govLabel = document.createElement('label');
    govLabel.textContent = ' Government: ';
    const govSelect = document.createElement('select');
    const names = [
      'Anarchy',
      'Despotism',
      'Monarchy',
      'Communism',
      'Fundamentalism',
      'Republic',
      'Democracy',
    ];
    const ownsStatue = this.game.ownsWonder(this.humanSlot, 58);
    for (let g = 1; g < 7; g++) {
      const opt = document.createElement('option');
      opt.value = String(g);
      opt.textContent = names[g] ?? String(g);
      opt.disabled = !governmentAllowed(
        g,
        (adv) => this.game.knows(this.humanSlot, adv),
        ownsStatue,
      );
      if (g === civ.government) opt.selected = true;
      govSelect.append(opt);
    }
    if (civ.government === 0) {
      const opt = document.createElement('option');
      opt.value = '0';
      opt.textContent = this.governmentChoiceDue ? 'Anarchy (choose now)' : 'Anarchy';
      opt.selected = true;
      govSelect.append(opt);
    }
    govSelect.addEventListener('change', () => {
      const g = Number(govSelect.value);
      if (civ.government === 0 && this.governmentChoiceDue) {
        changeGovernment(this.world, civ, g, true);
        this.governmentChoiceDue = false;
        this.log(`${civ.name} become a ${names[g] ?? 'new government'}.`);
      } else if (civ.government !== 0 && g !== civ.government) {
        startRevolution(this.world, civ);
        this.wantedGovernment = g;
        this.log(
          'Revolution! Anarchy until a turn divisible by four (at once with the Statue of Liberty).',
        );
      }
      this.refresh();
    });
    govLabel.append(govSelect);
    el.replaceChildren(text, label, rates, govLabel);
  }
}
