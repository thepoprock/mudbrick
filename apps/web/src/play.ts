import { PART_SHEETS, PARTS_OVER, PARTS_UNDER, SHIP_FRAMES, type PartRow } from './shipParts.js';
import { descriptionFor, parseCityPreferences } from '@mudbrick/formats';
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
  movesLeft,
  GOVERNMENT,
  ORDER,
  orderGoTo,
  cityRows,
  airlift,
  airliftTargets,
  airliftThreat,
  councilRatings,
  councilSpeech,
  defenseRows,
  demographics,
  foreignRows,
  maxRate,
  paradropCheck,
  setHomeCity,
  setRates,
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
  resolveAttack,
  sentry,
  tryMove,
  wake,
  type City,
  type Civ,
  type Game,
  cheatChangeTerrain,
  cheatCreateUnit,
  cheatSetSquareImprovements,
  cheatSquareImprovements,
  cheatTerrainChain,
  cheatDestroyUnits,
  cheatEditCity,
  cheatEditUnit,
  cheatKillCivilization,
  cheatRevealMap,
  cheatSetHuman,
  cheatSetMoney,
  grantAdvance,
  type MovementContext,
  type ParleyItem,
  OCEAN,
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
  senateBlocks,
  adjustAttitude,
  expelAgent,
  gridDistance,
  hasTreaty,
  type DiplomacyEvent,
  commoditySearch,
  cheatEditKing,
} from '@mudbrick/engine';
import { ADVANCE, IMPROVEMENT, SquareFlag } from '@mudbrick/engine';
import { drawCityView } from './cityView.js';
import { addFameEntry, fameLines, readFame } from './hallOfFame.js';
import type { GameFolder } from './gameFiles.js';
import { CityWindow, type CityHost } from './ui/cityWindow.js';
import { drawMinimap, MapView } from './ui/mapView.js';
import { buildMenuBar, parseMenu, type MenuEntry } from './ui/menuBar.js';
import { unitIcon } from './ui/spriteIcon.js';
import {
  addButton,
  askList,
  askNumber,
  askText,
  askYes,
  openWindow,
  tell,
  windowIsOpen,
} from './ui/windows.js';

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
  minimap: HTMLCanvasElement;
  menuBar: HTMLElement;
  status: HTMLElement;
  unitPanel: HTMLElement;
  cityPanel: HTMLElement;
  log: HTMLElement;
  /** What the Game menu does outside the game itself. */
  onSave: () => void;
  onLoad: () => void;
  onJoin: () => void;
  onQuit: () => void;
}

/** How long a pause in orders hands the lock back in simultaneous play. */
const LOCK_HOLD_MS = 400;

/** The herald films by tribe (VERIFIED, the table at 0x005b6820). */
const HERALDS =
  'ROM BAB GER EGY AME GRE IND RUS ZUL FRE AZT CHI ENG MON CEL JAP VIK SPA PER CAR SIO'.split(' ');

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
  onChat: ((text: string, to: number[], anonymous: boolean) => void) | null = null;
  /** Simultaneous play over the network: ask the relay for the lock, and send the state and let go. */
  onLock: (() => void) | null = null;
  onRelease: (() => void) | null = null;
  private lockHeld = false;
  private fameEntered = false;
  private readonly seatsSeen = new Set<number>();
  private lockAsked = false;
  private tracks: string[] | null = null;
  private lastTrack: string | null = null;
  private replaying = false;
  private pendingOrder: (() => void) | null = null;
  private releaseTimer: number | null = null;
  /** The conversation on screen, if any. */
  private talk: Conversation | null = null;
  selected: Unit | null = null;
  openCity: City | null = null;
  readonly map: MapView;
  private readonly cityWindow: CityWindow;
  showGrid = false;
  /** View Pieces: the cursor square; null while moving units. */
  private viewCursor: Point | null = null;
  private hidePieces = false;
  private lastSelected: Unit | null = null;
  gotoMode = false;
  paradropMode = false;
  private seatPending = false;
  muted = false;
  private readonly logLines: string[] = [];
  private cityNames = 0;

  constructor(
    public game: Game,
    readonly folder: GameFolder,
    public humanSlot: number,
    readonly el: PlayElements,
  ) {
    this.bindGame(game);
    this.map = new MapView(el.canvas);
    this.map.onDraw = () => this.drawWorldMap();
    this.cityWindow = new CityWindow(this.cityHost(), el.cityPanel);
    this.bindMapInput();
    for (const panel of [el.cityPanel, el.unitPanel]) {
      panel.addEventListener('click', (e) => this.guardPanel(e, () => this.reclick(e)), true);
      panel.addEventListener('change', (e) => this.guardPanel(e, () => this.rechange(e)), true);
    }
    this.startTimer();
    void this.playMusic();
    void this.buildMenus();
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

  private bindGame(game: Game): void {
    game.wantsTalks = this.folder.popups.size > 0;
    if (this.folder.cityPreferences !== undefined) {
      game.cityPreferences = parseCityPreferences(
        this.folder.cityPreferences,
        (i) => game.rules.improvements[i]?.name,
      );
    }
    game.askPretext = (victim, agent, allied) =>
      victim === this.humanSlot &&
      window.confirm(
        allied
          ? `The ${game.civ(agent).name} spied on us. End our alliance?`
          : `The ${game.civ(agent).name} spied on us. Use it as a reason for war?`,
      );
    game.askEscape = (c) =>
      window.confirm(`Pay 1000 gold to move the government to ${c.name} and save the spaceship?`);
  }

  /** Simultaneous play: another seat's state replaces ours; what was open stays open. */
  adopt(game: Game): void {
    const moving = this.awaitingUs;
    const unit = this.selected?.id;
    const city = this.openCity?.id;
    this.bindGame(game);
    this.game = game;
    this.selected = this.world.units.find((u) => u.id === unit) ?? null;
    this.openCity = this.world.cities.find((c) => c.id === city) ?? null;
    if (!moving && this.awaitingUs) {
      this.log('All moved. Your move.');
      this.selectNext();
    }
    this.refresh();
  }

  /** The seat is known: look at this seat's own units. */
  takeSeat(): void {
    if (this.selected?.owner === this.humanSlot) return;
    this.selected = null;
    this.selectNext();
    const home =
      this.selected ??
      this.world.cities.find((c) => c.owner === this.humanSlot) ??
      this.world.units.find((u) => u.owner === this.humanSlot);
    if (home) this.centreOn(home.position);
    this.refresh();
  }

  /** The lock the relay grants has arrived: carry out the order that asked for it. */
  lockGranted(): void {
    this.lockHeld = true;
    this.lockAsked = false;
    const run = this.pendingOrder;
    this.pendingOrder = null;
    run?.();
    this.holdLockBriefly();
  }

  /**
   * Passwords (VERIFIED 0x00474844, 0x004745ba and 0x00474a7b): a civilization with one asks for
   * it when its player takes over the shared screen. The original scrambles the save block; this
   * only keeps a friend from reading the next player's map, as there.
   */
  private async askPassword(slot: number): Promise<void> {
    const want = this.game.state.passwords?.[slot];
    if (!want) return;
    for (;;) {
      const typed = await askText('Password', `Password for the ${this.game.civ(slot).name}`, '', {
        password: true,
      });
      if (typed === want) return;
      if (typed === null && (await askYes('Skip this turn view?'))) return;
    }
  }

  private async setPassword(): Promise<void> {
    const slot = this.humanSlot;
    const old = this.game.state.passwords?.[slot];
    if (old && (await askText('Password', 'Current password', '', { password: true })) !== old)
      return;
    const next = await askText('Password', 'New password (empty for none)', '', { password: true });
    if (next === null) return;
    (this.game.state.passwords ??= {})[slot] = next;
  }

  /** Network seats (0x0046db32): a player who was here and has gone turns to the computer. */
  seatsChanged(seats: number[]): void {
    for (const s of seats) this.seatsSeen.add(s);
    if (this.seat === null || this.seat !== Math.min(...seats)) return;
    const gone = this.world.civs.filter(
      (c) => c.isHuman && this.seatsSeen.has(c.slot) && !seats.includes(c.slot),
    );
    if (gone.length === 0) return;
    for (const c of gone) {
      this.seatsSeen.delete(c.slot);
      this.log(`The ${c.name} have lost their player. The computer takes over.`);
      this.game.dropHuman(c.slot);
    }
    this.onTurnPassed?.(this.game.state.movingHuman ?? this.seat);
    this.refresh();
  }

  /** May this seat change the game now? If not, ask for the lock and do `order` once it comes. */
  private writable(order: () => void): boolean {
    if (!this.game.state.simultaneous || this.seat === null) return true;
    if (!this.awaitingUs) return false;
    if (this.lockHeld) {
      this.holdLockBriefly();
      return true;
    }
    this.pendingOrder = order;
    if (!this.lockAsked) {
      this.lockAsked = true;
      this.onLock?.();
    }
    return false;
  }

  /** The panels change the game too: hold their input until this seat has the lock. */
  private guardPanel(e: Event, replay: () => void): void {
    if (this.replaying || this.writable(replay)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  private reclick(e: Event): void {
    this.replaying = true;
    if (e.target instanceof HTMLElement) e.target.click();
    this.replaying = false;
  }

  private rechange(e: Event): void {
    this.replaying = true;
    e.target?.dispatchEvent(new Event('change', { bubbles: true }));
    this.replaying = false;
  }

  /** Orders come in bursts: send the state on once the player pauses. */
  private holdLockBriefly(): void {
    if (this.releaseTimer !== null) window.clearTimeout(this.releaseTimer);
    this.releaseTimer = window.setTimeout(() => {
      this.releaseTimer = null;
      if (!this.lockHeld) return;
      if (this.talk) {
        this.holdLockBriefly();
        return;
      }
      this.lockHeld = false;
      this.onRelease?.();
    }, LOCK_HOLD_MS);
  }

  private get awaitingUs(): boolean {
    return (this.game.state.awaitingMoves ?? []).includes(this.seat ?? this.humanSlot);
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
    this.gotoMode = false;
    this.refresh();
    if (unit) this.map.keepInView(unit.position);
  }

  // ---- input

  handleKey(e: KeyboardEvent): boolean {
    if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return false;
    if (windowIsOpen()) return false;
    if (!this.writable(() => this.handleKey(e))) return true;
    const talkUp = document.getElementById('talkBox')?.style.display === 'block';
    if (talkUp) {
      if (e.key === 'Escape') this.closeTalk();
      else if (e.key === 'Enter') {
        const buttons = document.querySelectorAll<HTMLButtonElement>('#talkBox button');
        if (buttons.length === 1) buttons[0]?.click();
      }
      return true;
    }
    if (this.openCity) {
      const city = this.openCity;
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') this.closeCity();
      else if (e.key === 'ArrowLeft') this.cityWindow.step(-1);
      else if (e.key === 'ArrowRight') this.cityWindow.step(1);
      else if (e.key === 'b') void this.cityWindow.buy(city);
      else if (e.key === 'c') void this.cityWindow.change(city);
      else if (e.key === 'a') void this.cityWindow.auto(city);
      return true;
    }
    const dir = KEY_DIRECTIONS[e.key];
    if (dir && this.viewCursor) {
      const step = DIRECTIONS[dir];
      const y = this.viewCursor.y + (step?.y ?? 0);
      const x =
        y >= 0 && y < this.world.rows
          ? this.world.wrapX(this.viewCursor.x + (step?.x ?? 0), y)
          : null;
      if (x !== null) {
        this.viewCursor = { x, y };
        this.map.keepInView(this.viewCursor);
        this.refresh();
      }
      return true;
    }
    if (dir && !this.selected) {
      const step = DIRECTIONS[dir];
      if (step) this.map.panBy(step.x * 32, step.y * 16);
      return true;
    }
    if (dir && this.selected) {
      this.moveSelected(dir);
      return true;
    }
    if (this.talk) return true;
    if (!this.ourMove) return false;
    if (e.ctrlKey) {
      if (e.key === 'c') void this.chat();
      else if (e.key === 'r') void this.retire();
      else if (e.key === 'd') this.showCasualties();
      else if (e.key === 't') this.showTimer();
      else if (e.key === 'p') this.showParley();
      else if (e.key === 's') this.el.onSave();
      else if (e.key === 'l') this.el.onLoad();
      else if (e.key === 'q') void this.quit();
      else if (e.key === 'o') this.showOptions();
      else if (e.key === 'g') {
        this.showGrid = !this.showGrid;
        this.refresh();
      } else if (e.key === 'n') this.endTurn();
      else return false;
      return true;
    }
    if (e.ctrlKey || e.metaKey) return false;
    switch (e.key) {
      case 'z':
        this.map.setZoom(this.map.zoom + 1);
        return true;
      case 'x':
        this.map.setZoom(this.map.zoom - 1);
        return true;
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
      case 'v':
        this.toggleViewPieces();
        return true;
      case 'Enter': {
        // VERIFIED by the menu: the turn ends here only once nothing waits; Ctrl+N always ends it.
        const at = this.viewCursor ?? this.selected?.position;
        const city = at ? this.world.cityAt(at.x, at.y) : undefined;
        if (city?.owner === this.humanSlot) this.showCity(city);
        else if (!this.humanUnits().some((u) => this.needsOrders(u))) this.endTurn();
        return true;
      }
      case 'H':
        this.showThrone(false);
        return true;
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
        this.showTaxRate();
        return true;
      case 'R':
        void this.askRevolution();
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
          if (this.rules.units[u.type]?.role === 5) {
            this.work(u, ORDER.fortress);
            return;
          }
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
      case 'e':
        return this.withSelected((u) => this.work(u, ORDER.airbase));
      case 'p':
        return this.withSelected((u) => this.work(u, ORDER.pollution));
      case 'P':
        return this.withSelected((u) => void this.pillageSelected(u));
      case 'D':
        return this.withSelected((u) => void this.disbandSelected(u));
      case 't':
        if (this.selected && this.rules.units[this.selected.type]?.role === 7)
          return this.withSelected((u) => this.caravanTrade(u));
        this.hidePieces = !this.hidePieces;
        this.refresh();
        return true;
      case 'h':
        return this.withSelected((u) => {
          const city = this.world.cityAt(u.position.x, u.position.y);
          if (this.rules.units[u.type]?.role === 7 && city?.production.kind === 'improvement') {
            this.caravanHelp(u);
            return;
          }
          const c = setHomeCity(this.world, u);
          this.log(c ? `Home city is now ${c.name}.` : 'Move into one of your cities first.');
        });
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
    if (!this.writable(() => this.handleClick(clientX, clientY))) return;
    const hit = this.map.squareAt(clientX, clientY);
    if (!hit) return;
    const { x, y } = hit;
    const p = hit;
    if (this.viewCursor) {
      this.viewCursor = p;
      this.refresh();
      return;
    }
    if (this.paradropMode && this.selected) {
      void this.paradrop(this.selected, p);
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
    if (city && city.owner === this.humanSlot) {
      this.showCity(city);
      return;
    }
    if (city && this.world.isSeen(x, y, this.humanSlot)) {
      const owner = this.world.civs[city.owner]?.adjective ?? '';
      this.log(`${city.name}: ${owner} city, size ${city.size}.`);
    }
    if (mine.length > 0) {
      const idx = this.selected ? mine.indexOf(this.selected) : -1;
      const next = mine[(idx + 1) % mine.length] ?? null;
      if (next && next.order !== null) wake(next);
      this.select(next);
      return;
    }
    this.refresh();
  }

  private bindMapInput(): void {
    const canvas = this.el.canvas;
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = this.map.squareAt(e.clientX, e.clientY);
      if (p) this.map.centreOn(p);
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.ctrlKey) this.map.setZoom(this.map.zoom + (e.deltaY < 0 ? 1 : -1));
        else this.map.panBy(e.deltaX, e.deltaY);
      },
      { passive: false },
    );
    const pick = (e: PointerEvent) => {
      const world = this.world;
      const box = this.el.minimap.getBoundingClientRect();
      const x = Math.floor(((e.clientX - box.left) / box.width) * world.widthX2);
      const y = Math.floor(((e.clientY - box.top) / box.height) * world.rows);
      this.map.centreOn({ x: x - ((x + y) & 1), y });
    };
    this.el.minimap.addEventListener('pointerdown', (e) => {
      this.el.minimap.setPointerCapture(e.pointerId);
      pick(e);
    });
    this.el.minimap.addEventListener('pointermove', (e) => {
      if (e.buttons) pick(e);
    });
  }

  private cityHost(): CityHost {
    const game = () => this.game;
    const humanSlot = () => this.humanSlot;
    const world = () => this.world;
    return {
      get game() {
        return game();
      },
      folder: this.folder,
      get humanSlot() {
        return humanSlot();
      },
      get world() {
        return world();
      },
      refresh: () => this.refresh(),
      log: (line) => this.log(line),
      playSound: (name) => this.sound(name),
      showCityView: (city) => this.showCityView(city),
      showPedia: (category, row) =>
        this.showPedia(category === 'units' ? 'UNIT' : row >= 39 ? 'WONDER' : 'IMPROVEMENT', row),
      selectUnit: (u) => {
        wake(u);
        this.select(u);
        this.map.centreOn(u.position);
      },
      closeCity: () => this.closeCity(),
    };
  }

  showCity(city: City): void {
    this.openCity = city;
    this.cityWindow.open(city);
    this.refresh();
  }

  closeCity(): void {
    this.openCity = null;
    this.cityWindow.close();
    this.refresh();
  }

  // ---- actions

  moveSelected(dirName: string): void {
    if (!this.writable(() => this.moveSelected(dirName))) return;
    const unit = this.selected;
    const d = DIRECTIONS[dirName];
    if (!unit || !d) return;
    const ny = unit.position.y + d.y;
    if (ny < 0 || ny >= this.world.rows) return;
    const nx = this.world.wrapX(unit.position.x + d.x, ny);
    if (nx === null) return;
    const to = { x: nx, y: ny };
    const hadHut = hutAt(this.world, nx, ny);
    const from = { ...unit.position };
    const r = tryMove(this.world, this.rules, this.game.rng, unit, to, this.moveCtx());
    switch (r.kind) {
      case 'moved':
        if (hadHut) this.resolveHut(unit);
        void this.map.slideUnit(unit, from, to).then(() => this.afterAction());
        return;
      case 'boarded':
        this.log(`${this.unitName(unit)} boards the ${this.unitName(r.ship)}.`);
        break;
      case 'repaired':
        this.log(`Our allies in ${r.city.name} repair the ${this.unitName(unit)}.`);
        break;
      case 'failed-roll':
        this.log(`${this.unitName(unit)} runs out of movement before reaching the square.`);
        break;
      case 'diplomat':
        this.pendingAgent = { unit, city: r.city };
        break;
      case 'diplomat-unit':
        this.pendingAgent = { unit, target: r.target };
        break;
      case 'caravan': {
        const events: TradeEvent[] = [];
        establishTradeRoute(this.world, this.rules, unit, r.city, this.game.tradeContext(), events);
        for (const e of events) this.log(`${e.text}.`);
        this.selected = null;
        break;
      }
      case 'attack':
        void this.attack(unit, to).then(() => this.afterAction());
        return;
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

  private async attack(unit: Unit, to: Point): Promise<void> {
    const city = this.world.cityAt(to.x, to.y);
    const enemies = this.world.unitsAt(to.x, to.y).filter((u) => u.owner !== unit.owner);
    // VERIFIED (the attack handler 0x0052d472): attacking a civilization at cease-fire or peace
    // asks whether to break the treaty, then declares war (0x00526d80).
    const victim = enemies[0]?.owner ?? (city && city.owner !== unit.owner ? city.owner : null);
    if (victim !== null && victim !== 0) {
      const lone = enemies.length === 1 ? enemies[0] : undefined;
      if (
        lone &&
        !city &&
        this.rules.units[lone.type]?.role === 6 &&
        hasTreaty(this.world, lone.owner, unit.owner, TREATY.ceaseFire | TREATY.peace)
      ) {
        // VERIFIED 0x00539099: an agent can be put out, but only near one of our own cities.
        let nearest: City | null = null;
        let least = 9999;
        for (const c of this.world.cities) {
          const d = gridDistance(this.world, c.position, to);
          if (d < least) {
            least = d;
            nearest = c;
          }
        }
        if (nearest?.owner !== unit.owner) {
          this.log('We cannot expel an agent from foreign land.');
          return;
        }
        const name = this.rules.units[lone.type]?.name ?? 'agent';
        if (await askYes(`Expel the ${this.game.civ(lone.owner).adjective} ${name}?`)) {
          const home = expelAgent(this.world, lone);
          this.log(`The ${name} is sent home${home ? ` to ${home.name}` : ''}.`);
          adjustAttitude(this.world, lone.owner, unit.owner, this.game.rng.nextInt(4));
          this.refresh();
          return;
        }
      }
      const word = treaty(this.world, unit.owner, victim);
      if ((word & TREATY.alliance) !== 0) {
        this.log(`We are allied with the ${this.game.civ(victim).name}.`); // ANNOYALLIED
        return;
      }
      if ((word & (TREATY.ceaseFire | TREATY.peace)) !== 0) {
        const ok = await askYes(
          `Attacking the ${this.world.civs.find((c) => c.slot === victim)?.name ?? 'civilization'} breaks our treaty. Declare war?`,
        );
        if (!ok) return;
        const un = this.game.ownsWonder(unit.owner, IMPROVEMENT.unitedNations);
        if (senateBlocks(this.world, unit.owner, victim, un)) {
          this.log('The Senate overrules the order: the treaty stands.'); // OVERRULE
          return;
        }
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
    await this.map.explode(ev.attackerWon ? to : { ...unit.position });
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
      shipLost: (l, launched) =>
        this.game.tellHumans(
          launched
            ? `The ${l.name} spaceship returns to earth: its capital has fallen.`
            : `The ${l.name} spaceship has been destroyed.`,
        ),
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
    void this.nameCity(unit);
  }

  private async nameCity(unit: Unit): Promise<void> {
    const name = (
      await askText('Name Your City', 'Name of the new city', this.nextCityName(), {
        maxLength: 15,
      })
    )?.trim();
    if (!name) return;
    const city = foundCity(this.world, this.rules, this.civ, unit, { name });
    this.game.ensureWorkers(city);
    this.sound('BLDCITY');
    this.log(`${name} founded.`);
    this.queueNews(NEWS_FOUNDED, `${name} founded.`);
    this.nextTalk();
    this.selected = null;
    this.afterAction();
    this.showCity(city);
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

  private async pillageSelected(unit: Unit): Promise<void> {
    const v = pillageOptions(this.world, this.rules, unit);
    if (!v.ok) {
      this.log(`Cannot pillage here (${v.reason}).`);
      return;
    }
    let choice = v.options[0];
    if (v.options.length > 1) {
      const pick = await askList(
        'Pillage',
        'What should we pillage?',
        v.options.map((o) => ({ label: o })),
      );
      if (pick === null) return;
      choice = v.options[pick];
    }
    if (!choice) return;
    const events: DiplomacyEvent[] = [];
    pillage(this.world, this.rules, unit, choice, { ctx: this.game.diplomacyContext(), events });
    for (const e of events) this.log(`${e.text}.`);
    this.log(`${this.unitName(unit)} pillages the ${choice}.`);
    this.afterAction();
  }

  private async disbandSelected(unit: Unit): Promise<void> {
    if (!(await askYes(`Disband ${this.unitName(unit)}?`))) return;
    const refund = disbandUnit(this.world, this.rules, unit, this.civ, this.game.state.difficulty);
    this.log(
      `${this.unitName(unit)} disbanded${refund ? ` (${refund} shields to the city)` : ''}.`,
    );
    this.selected = null;
    this.afterAction();
  }

  skipSelected(): void {
    if (!this.selected) return;
    this.selected.movesSpent = fullMoves(this.rules, this.selected, this.moveCtx());
    this.afterAction();
  }

  /** Is it this browser's move? */
  get ourMove(): boolean {
    if (this.game.state.simultaneous) return this.awaitingUs;
    return this.seat === null || (this.game.state.movingHuman ?? this.seat) === this.seat;
  }

  endTurn(): void {
    if (!this.ourMove) return;
    if (!this.writable(() => this.endTurn())) return;
    if (this.game.state.simultaneous) {
      this.game.finishMoves(this.seat ?? this.humanSlot);
      if ((this.game.state.awaitingMoves?.length ?? 0) > 0) {
        if (this.seat === null) this.playOn();
        else this.log('Waiting for the others to finish.');
        this.refresh();
        return;
      }
    }
    this.playOn();
  }

  /** Run the round on to the next human (Game.playUntilHuman), and hand the seat over. */
  private playOn(): void {
    const before = this.humanSlot;
    const events = this.game.playUntilHuman();
    const moving = this.game.state.simultaneous
      ? this.seat === null
        ? (this.game.state.awaitingMoves?.[0] ?? this.humanSlot)
        : this.seat
      : (this.game.state.movingHuman ?? this.humanSlot);
    if (this.onTurnPassed && moving !== this.seat) {
      this.onTurnPassed(moving);
      this.log(`Waiting for the ${this.game.civ(moving).name}.`);
      this.refresh();
      return;
    }
    this.humanSlot = moving;
    if (this.humanSlot !== before) {
      void this.askPassword(moving);
      this.log(`— The ${this.civ.name} to move —`);
      this.announceSeat();
    }
    for (const e of events) {
      if (e.slot !== this.humanSlot) continue;
      const text = this.eventText(e);
      if (text) this.log(text);
      this.eventSound(e.event);
      if (e.event.kind === 'discovered') this.offerRevolution(e.event.advance);
      if (text && (e.event.kind === 'built-improvement' || e.event.kind === 'built-wonder')) {
        const city = this.world.cities.find((c) => 'city' in e && c.id === e.city);
        if (city) this.news.push({ picture: -1, text, city });
      }
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
      void this.endOfGame();
    }
    this.selected = null;
    this.selectNext();
    this.refresh();
  }

  /**
   * The soundtrack: the player's own CD tracks, named track02.wav and so on, in the game folder.
   * VERIFIED 0x00453110: a random track, never the same one twice in a row.
   */
  private async playMusic(): Promise<void> {
    if (this.tracks === null) {
      this.tracks = [];
      for (let n = 2; n < 25; n++) {
        const name = `track${String(n).padStart(2, '0')}.wav`;
        if (await this.folder.file(name)) this.tracks.push(name);
      }
    }
    if (this.tracks.length === 0 || this.muted) return;
    const options = this.tracks.filter((t) => t !== this.lastTrack);
    const name = options[Math.floor(Math.random() * options.length)] ?? this.tracks[0];
    if (!name) return;
    this.lastTrack = name;
    const blob = await this.folder.file(name);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    a.volume = 0.5;
    a.addEventListener('ended', () => {
      URL.revokeObjectURL(url);
      void this.playMusic();
    });
    void a.play().catch(() => undefined);
  }

  /**
   * A film from the player's copy, converted to MP4 by scripts/convert-videos.ts, since browsers
   * cannot play the original Indeo files. Without the converted file nothing shows.
   */
  async playVideo(name: string): Promise<void> {
    if (this.muted) return;
    const blob = await this.folder.file(`${name}.mp4`);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.src = url;
    v.autoplay = true;
    v.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;' +
      'box-shadow:0 0 0 100vmax rgb(0 0 0 / 70%);cursor:pointer';
    v.title = 'Click to skip';
    const done = () => {
      v.remove();
      URL.revokeObjectURL(url);
      window.removeEventListener('keydown', skip, true);
    };
    const skip = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      done();
    };
    window.addEventListener('keydown', skip, true);
    v.addEventListener('ended', done);
    v.addEventListener('click', done);
    v.addEventListener('error', done);
    document.body.append(v);
  }

  /** Play SOUND/NAME.WAV from the game folder, if it is there. */
  private sound(name: string | null): void {
    // Sounds overlap by design; a missing file is simply silent.
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
        // VERIFIED (0x00490a0b): no wonder film in a scenario, or with the films switched off.
        if (!this.game.state.wonderMoviesOff && !this.game.state.scenario)
          void this.playVideo(`WONDER${String(ev.improvement - 39).padStart(2, '0')}`);
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
    this.map.centreOn(p);
  }

  /** The owner's colour on the world map and in the panels. */
  private colourOf(slot: number): number {
    return this.world.civs[slot]?.colour ?? slot;
  }

  /** The piece that shows on a stack: the strongest defender, as the original picks. */
  private topUnit(units: Unit[]): Unit | undefined {
    let best: Unit | undefined;
    let score = -1;
    for (const u of units) {
      const t = this.rules.units[u.type];
      const v = (t?.defence ?? 0) * 2 + (t?.attack ?? 0);
      if (v > score) {
        score = v;
        best = u;
      }
    }
    return best;
  }

  private orderLetter(u: Unit): string {
    if (u.fortified || u.order === ORDER.fortified) return 'F';
    switch (u.order) {
      case ORDER.fortify:
        return 'F';
      case ORDER.sleep:
        return 'S';
      case ORDER.fortress:
        return 'F';
      case ORDER.road:
        return 'R';
      case ORDER.irrigation:
        return 'I';
      case ORDER.mine:
        return 'M';
      case ORDER.transform:
        return 'O';
      case ORDER.pollution:
        return 'P';
      case ORDER.airbase:
        return 'E';
      case ORDER.goTo:
        return 'G';
      default:
        return u.automated ? 'A' : '';
    }
  }

  private healthOf(u: Unit): number {
    const full = (this.rules.units[u.type]?.hitPointsTens ?? 1) * 10;
    return Math.max(0, (full - u.hitPointsLost) / full);
  }

  private drawWorldMap(): void {
    const palette = ['#fff', '#d22', '#ddd', '#2c2', '#28f', '#ee2', '#2dd', '#e82', '#b4e'];
    drawMinimap(this.el.minimap, this.world, this.humanSlot, this.map.viewRect(), (slot) => {
      return palette[this.colourOf(slot)] ?? '#fff';
    });
  }

  refresh(): void {
    this.showParleyOffer();
    if (this.selected && !this.world.units.includes(this.selected)) this.selected = null;
    this.map.setScene({
      world: this.world,
      folder: this.folder,
      viewer: this.humanSlot,
      selected: this.selected,
      marked: null,
      grid: this.showGrid,
      cursor: this.viewCursor,
      hidePieces: this.hidePieces,
      orderLetter: (u) => this.orderLetter(u),
      health: (u) => this.healthOf(u),
      topUnit: (units) => this.topUnit(units),
      colourOf: (slot) => this.colourOf(slot),
    });
    if (this.selected && this.selected !== this.lastSelected)
      this.map.keepInView(this.selected.position);
    this.lastSelected = this.selected;
    this.el.canvas.classList.toggle('targeting', this.gotoMode || this.paradropMode);
    this.renderStatus();
    this.renderUnitPanel();
    this.renderAgentChoice();
    if (this.openCity) this.cityWindow.render();
    this.el.log.textContent = this.logLines.slice(-40).join('\n');
    this.el.log.parentElement?.scrollTo({ top: 1e6 });
    this.promptGovernment();
  }

  /** A diplomat or spy's choices come up in a box as soon as it arrives. */
  private renderAgentChoice(): void {
    const pending = this.pendingAgent;
    const box = document.getElementById('talkBox');
    if (pending && this.world.units.includes(pending.unit)) {
      if (this.agentShown === pending) return;
      this.agentShown = pending;
      const b = this.talkBox();
      const heading = document.createElement('h3');
      heading.textContent = this.unitName(pending.unit);
      b.replaceChildren(heading, this.agentMenu(pending));
    } else if (this.agentShown) {
      this.agentShown = null;
      this.pendingAgent = null;
      if (box) box.style.display = 'none';
    }
  }

  private agentShown: typeof this.pendingAgent = null;

  /** Anarchy has ended and the new government is the player's to pick. */
  private promptGovernment(): void {
    if (!this.governmentChoiceDue || this.governmentAsked || windowIsOpen() || this.talk) return;
    this.governmentAsked = true;
    void this.chooseGovernment();
  }

  private governmentAsked = false;

  private async chooseGovernment(): Promise<void> {
    const civ = this.civ;
    const ownsStatue = this.game.ownsWonder(this.humanSlot, 58);
    const names = this.folder.rules.governments.map((g) => g.name);
    const options: number[] = [];
    for (let g = 1; g < 7; g++)
      if (governmentAllowed(g, (a) => this.game.knows(this.humanSlot, a), ownsStatue))
        options.push(g);
    const pick = await askList(
      'Revolution Ends',
      'What form of government shall we adopt?',
      options.map((g) => ({ label: names[g] ?? `Government ${g}` })),
    );
    this.governmentAsked = false;
    const g = pick === null ? null : (options[pick] ?? null);
    if (g === null) {
      this.refresh();
      return;
    }
    changeGovernment(this.world, civ, g, true);
    this.governmentChoiceDue = false;
    this.log(`The ${civ.name} adopt ${names[g] ?? 'a new government'}.`);
    this.refresh();
  }

  /** Tax Rate (Shift+T): the three rates, ten per cent at a time, up to the government's limit. */
  showTaxRate(): void {
    const civ = this.civ;
    const max = maxRate(civ.government);
    const close = () => {
      win.close();
      this.refresh();
    };
    const win = openWindow({
      title: 'Tax Rate',
      width: 400,
      id: 'taxWindow',
      onCancel: close,
      onAccept: close,
    });
    const gov = this.folder.rules.governments[civ.government]?.name ?? '';
    const intro = document.createElement('p');
    intro.className = 'windowText';
    const rows = document.createElement('div');
    const render = () => {
      intro.textContent = `Government: ${gov}\nMaximum rate: ${max * 10}%\nTreasury: ${civ.treasury} gold`;
      rows.replaceChildren();
      const lux = 10 - civ.taxRate - civ.scienceRate;
      const slider = (name: string, value: number, set: (v: number) => void) => {
        const label = document.createElement('label');
        label.style.cssText =
          'display:grid;grid-template-columns:92px 1fr 44px;gap:8px;margin:6px 0';
        const text = document.createElement('span');
        text.textContent = name;
        const r = document.createElement('input');
        r.type = 'range';
        r.min = '0';
        r.max = String(max);
        r.value = String(value);
        r.addEventListener('input', () => {
          set(Number(r.value));
          render();
        });
        const pct = document.createElement('span');
        pct.textContent = `${value * 10}%`;
        label.append(text, r, pct);
        rows.append(label);
      };
      slider('Taxes', civ.taxRate, (v) => {
        setRates(civ, v, Math.min(civ.scienceRate, 10 - v));
      });
      slider('Luxuries', lux, (v) => {
        const room = 10 - v;
        const tax = Math.min(civ.taxRate, room);
        setRates(civ, tax, room - tax);
      });
      slider('Science', civ.scienceRate, (v) => {
        setRates(civ, Math.min(civ.taxRate, 10 - v), v);
      });
    };
    render();
    win.body.append(intro, rows);
    addButton(win, 'OK', close);
  }

  /** Revolution (Shift+R), after the question the original asks. */
  private async askRevolution(): Promise<void> {
    if (this.civ.government === GOVERNMENT.anarchy) return;
    if (!(await askYes('Are you sure you want to start a revolution?', 'Revolution'))) return;
    startRevolution(this.world, this.civ);
    this.sound('REVOLT');
    this.log('Revolution! The government falls into Anarchy.');
    this.refresh();
  }

  private clockText(): string {
    if (this.timerEnds === 0) return '';
    const left = Math.max(0, Math.ceil((this.timerEnds - Date.now()) / 1000));
    const seconds = String(left % 60).padStart(2, '0');
    return `${String(Math.trunc(left / 60)).padStart(2, '0')}:${seconds} left · `;
  }

  private populationText(): string {
    // Size n stands for n(n+1)/2 × 10,000 people.
    let total = 0;
    for (const c of this.world.cities)
      if (c.owner === this.humanSlot) total += ((c.size * (c.size + 1)) / 2) * 10000;
    return total.toLocaleString('en-US');
  }

  private renderStatus(): void {
    const civ = this.civ;
    const el = this.el.status;
    const gov = this.folder.rules.governments[civ.government]?.name ?? '';
    const lux = 10 - civ.taxRate - civ.scienceRate;
    const line = (text: string) => {
      const d = document.createElement('div');
      d.textContent = text;
      return d;
    };
    const gold = line(`${civ.treasury} Gold (${civ.taxRate}.${lux}.${civ.scienceRate})`);
    gold.className = 'goldLine';
    gold.title = 'Tax Rate';
    gold.addEventListener('click', () => this.showTaxRate());
    const cost = this.game.researchCostFor(civ);
    const current =
      civ.researching === null
        ? 'Nothing'
        : (this.rules.advances[civ.researching]?.name ?? `advance ${civ.researching}`);
    const research = line(`Researching: ${current}`);
    research.className = 'goldLine';
    research.title = 'Research';
    research.addEventListener('click', () => this.showResearch());
    const bar = document.createElement('div');
    bar.id = 'researchBar';
    const fill = document.createElement('div');
    fill.style.width = `${cost > 0 ? Math.min(100, (civ.scienceStored / cost) * 100) : 0}%`;
    bar.append(fill);
    const over = this.game.state.gameOver;
    el.replaceChildren(
      line(`The ${civ.name} (${gov})`),
      line(`Population: ${this.populationText()}`),
      line(`${this.yearText()} (Turn ${this.game.state.turn})`),
      gold,
      research,
      bar,
      ...(this.timerEnds ? [line(this.clockText())] : []),
      ...(over
        ? [
            line(
              `Game over: the ${this.world.civs[over.winner]?.name ?? '?'} win by ${over.reason}`,
            ),
          ]
        : []),
    );
  }

  private unitLines(u: Unit): HTMLElement {
    const row = document.createElement('div');
    row.className = 'unitLine';
    if (u === this.selected) row.classList.add('current');
    const left = movesLeft(this.rules, u, this.moveCtx());
    const type = this.rules.units[u.type];
    const full = type ? type.hitPointsTens * 10 : 0;
    const home =
      u.homeCity === null
        ? 'None'
        : (this.world.cities.find((c) => c.id === u.homeCity)?.name ?? '?');
    const text = document.createElement('div');
    text.className = 'unitText';
    text.textContent =
      `${this.civ.adjective} ${this.unitName(u)}${u.veteran ? ' (Veteran)' : ''}\n` +
      `Moves: ${Math.floor(left / 3)}${left % 3 ? ` ${left % 3}/3` : ''}  HP: ${full - u.hitPointsLost}/${full}\n` +
      `Home: ${home}`;
    text.style.whiteSpace = 'pre-wrap';
    row.append(unitIcon(this.folder, u.type, 36), text);
    row.addEventListener('click', () => {
      wake(u);
      this.select(u);
    });
    return row;
  }

  private terrainText(p: Point): string {
    const t = this.rules.terrain[this.world.terrainAt(p.x, p.y)] as { name?: string } | undefined;
    const name = t?.name ?? this.folder.rules.terrain[this.world.terrainAt(p.x, p.y)]?.name ?? '';
    const marks: [number, string][] = [
      [SquareFlag.Road, 'Road'],
      [SquareFlag.Railroad, 'Railroad'],
      [SquareFlag.Irrigation, 'Irrigation'],
      [SquareFlag.Mine, 'Mine'],
      [SquareFlag.Fortress, 'Fortress'],
      [SquareFlag.Airbase, 'Airbase'],
      [SquareFlag.Pollution, 'Pollution'],
    ];
    const extras = marks
      .filter(([f]) => this.world.hasFlag(p.x, p.y, f as never))
      .map(([, n]) => n);
    return extras.length > 0 ? `${name} (${extras.join(', ')})` : name;
  }

  private renderUnitPanel(): void {
    const el = this.el.unitPanel;
    const u = this.selected;
    const waiting = this.humanUnits().filter((o) => this.needsOrders(o)).length;
    const parts: HTMLElement[] = [];
    if (u) {
      const stack = this.world
        .unitsAt(u.position.x, u.position.y)
        .filter((o) => o.owner === this.humanSlot);
      const where = document.createElement('div');
      where.textContent = this.terrainText(u.position);
      const mode = document.createElement('div');
      mode.textContent = this.gotoMode
        ? 'Go to: click the destination.'
        : this.paradropMode
          ? 'Paradrop: click the square.'
          : '';
      parts.push(this.unitLines(u), where, mode);
      for (const o of stack) if (o !== u) parts.push(this.unitLines(o));
    }
    if (waiting === 0 && this.ourMove && !this.game.state.gameOver) {
      const end = document.createElement('div');
      end.className = 'endTurnPrompt';
      end.textContent = 'End of Turn\n(Press ENTER)';
      end.style.whiteSpace = 'pre-wrap';
      end.addEventListener('click', () => this.endTurn());
      parts.push(end);
    }
    el.replaceChildren(...parts);
  }

  /** What a menu item does, or null when the game has nothing for it. */
  private menuAction(entry: MenuEntry): (() => void) | null {
    const { section, label } = entry;
    const key = (k: string) => () => {
      this.handleKey({ key: k, target: null } as unknown as KeyboardEvent);
      this.refresh();
    };
    const zoom = (z: number) => () => this.map.setZoom(z);
    if (section === 'CHEAT') return () => void this.runCheat(label);
    if (section === 'PEDIA')
      return label.startsWith('About')
        ? () =>
            void tell(
              'Mudbrick is a free re-creation written from a clean-room specification. It reads the art and text from your own copy of the original game.',
              'About',
            )
        : key('?');
    const table: Record<string, (() => void) | undefined> = {
      'Game Options': key('O'),
      'Graphic Options': () => this.showGraphicOptions(),
      'Join Game': () => this.el.onJoin(),
      'Move Pieces': () => {
        if (this.viewCursor) this.toggleViewPieces();
      },
      'View Pieces': () => {
        if (!this.viewCursor) this.toggleViewPieces();
      },
      'Show Hidden Terrain': () => {
        this.hidePieces = !this.hidePieces;
        this.refresh();
      },
      'Save Game': () => this.el.onSave(),
      'Load Game': () => this.el.onLoad(),
      'Set Password': () => void this.setPassword(),
      'Change Timer': () => this.showTimer(),
      Retire: () => void this.retire(),
      Quit: () => void this.quit(),
      'Pick Music': () => void this.playMusic(),
      'Tax Rate': () => this.showTaxRate(),
      'View Throne Room': () => this.showThrone(false),
      'Find City': () => this.findCity(),
      REVOLUTION: () => void this.askRevolution(),
      'Zoom In': () => this.map.setZoom(this.map.zoom + 1),
      'Zoom Out': () => this.map.setZoom(this.map.zoom - 1),
      'Max Zoom In': zoom(8),
      'Standard Zoom': zoom(0),
      'Medium Zoom Out': zoom(-4),
      'Max Zoom Out': zoom(-7),
      'Show Map Grid': () => {
        this.showGrid = !this.showGrid;
        this.refresh();
      },
      'Center View': key('c'),
      'Build New City': key('b'),
      'Build Road': key('r'),
      'Build Irrigation': key('i'),
      'Build Mines': key('m'),
      'Transform to ...': key('o'),
      'Build Airbase': key('e'),
      'Build Fortress': key('F'),
      'Automate Settler': key('k'),
      'Clean Up Pollution': key('p'),
      Pillage: key('P'),
      Unload: key('u'),
      'Go To': key('g'),
      Paradrop: key('j'),
      Airlift: key('l'),
      'Set Home City': key('h'),
      Fortify: key('f'),
      Sleep: key('s'),
      Disband: key('D'),
      'Activate Unit': key('a'),
      Wait: key('w'),
      'Skip Turn': key(' '),
      'End Player Turn': () => this.endTurn(),
      'Chat with Kings': () => this.chat(),
      'Consult High Council': key('F10'),
      'City Status': key('F1'),
      'Defense Minister': key('F2'),
      'Foreign Minister': key('F3'),
      'Attitude Advisor': key('F4'),
      'Trade Advisor': key('F5'),
      'Science Advisor': key('F6'),
      'Casualty Timeline': () => this.showCasualties(),
      'Wonders of the World': key('F7'),
      'Top 5 Cities': key('F8'),
      'Civilization Score': key('F9'),
      Demographics: key('F11'),
      Spaceships: key('F12'),
    };
    return table[label] ?? null;
  }

  private toggleViewPieces(): void {
    if (this.viewCursor) {
      this.viewCursor = null;
      if (!this.selected) this.selectNext();
    } else {
      const c = this.map.viewRect();
      const y = Math.max(0, Math.min(this.world.rows - 1, Math.round((c.y + c.h / 2) / 16)));
      const x = Math.round((c.x + c.w / 2) / 32);
      const u = this.selected?.position;
      this.viewCursor = u ?? { x: x - ((x + y) & 1), y };
      this.selected = null;
    }
    this.refresh();
  }

  /** Graphic Options: what the map shows. */
  private showGraphicOptions(): void {
    const close = () => {
      win.close();
      this.refresh();
    };
    const win = openWindow({
      title: 'Graphic Options',
      width: 320,
      onCancel: close,
      onAccept: close,
    });
    const grid = document.createElement('div');
    grid.className = 'optionGrid';
    const box = (name: string, value: boolean, set: (v: boolean) => void) => {
      const l = document.createElement('label');
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = value;
      c.addEventListener('change', () => {
        set(c.checked);
      });
      l.append(c, name);
      grid.append(l);
    };
    box('City names', this.map.showNames, (v) => {
      this.map.showNames = v;
    });
    box('Animated moves and battles', this.map.animations, (v) => {
      this.map.animations = v;
    });
    box('Map grid', this.showGrid, (v) => {
      this.showGrid = v;
    });
    win.body.append(grid);
    addButton(win, 'OK', close);
  }

  private async quit(): Promise<void> {
    if (await askYes('Quit this game? Anything not saved is lost.', 'Quit')) this.el.onQuit();
  }

  /** Stops the clock and the map before the game is left. */
  dispose(): void {
    this.map.stop();
    this.cityWindow.close();
    clearInterval(this.timerTick);
    document.getElementById('talkBox')?.remove();
  }

  /** The menu bar, from the folder's Menu.txt: same labels, same keys. */
  private async buildMenus(): Promise<void> {
    const file = await this.folder.file('MENU.TXT');
    if (!file) return;
    const menus = parseMenu(new Uint8Array(await file.arrayBuffer()));
    buildMenuBar(this.el.menuBar, menus, (entry) => this.menuAction(entry));
  }

  /** The Cheat menu (cheats.ts). Each item asks what the original's dialog asks. */
  private async runCheat(item: string): Promise<void> {
    const state = this.game.state;
    if (item.startsWith('Toggle')) {
      if (!state.cheatMode && !(await askYes('Cheat mode changes the game. Turn it on?'))) return;
      state.cheatMode = !state.cheatMode;
      this.log(`Cheat mode ${state.cheatMode ? 'on' : 'off'}.`);
      return;
    }
    if (!state.cheatMode) {
      this.log('Turn cheat mode on first.');
      return;
    }
    const ask = (q: string, d: number) => askNumber('Cheat', q, d);
    const slot = () => ask('Which civilization, by slot?', this.humanSlot);
    const unit = this.selected;
    const at = unit?.position ?? this.openCity?.position;
    const name = item.replace(/&/g, '');
    if (name.startsWith('Create Unit') && at) {
      const t = await ask(`Unit type, 0 to ${this.rules.units.length - 1}`, 0);
      if (t !== null) cheatCreateUnit(this.game, t, this.humanSlot, at.x, at.y);
    } else if (name.startsWith('Reveal Map')) {
      const s = await slot();
      if (s !== null) cheatRevealMap(this.game, s);
    } else if (name.startsWith('Set Human')) {
      const s = await slot();
      if (s !== null) {
        cheatSetHuman(this.game, this.humanSlot, s);
        this.humanSlot = s;
        this.selected = null;
        this.selectNext();
      }
    } else if (name.startsWith('Set Game Year')) {
      const t = await ask('Turn number', state.turn);
      if (t !== null) state.turn = t;
    } else if (name.startsWith('Kill')) {
      const s = await slot();
      if (s !== null) cheatKillCivilization(this.game, s);
    } else if (name.startsWith('Technology') || name.startsWith('Edit Technologies')) {
      const s = await slot();
      const a = await ask(`Advance, 0 to ${this.rules.advances.length - 1}`, 0);
      if (s !== null && a !== null) {
        const c = this.game.civ(s);
        grantAdvance(c, a, 'other');
        this.game.advanceGained(c, a);
      }
    } else if (name.startsWith('Force Government')) {
      const s = await slot();
      const g = await ask('Government, 0 to 6', 1);
      if (s !== null && g !== null) changeGovernment(this.world, this.game.civ(s), g, false);
    } else if (name.startsWith('Change Terrain') && at) {
      await this.changeTerrain(at, ask);
    } else if (name.startsWith('Destroy') && at) {
      cheatDestroyUnits(this.game, at.x, at.y);
      this.selected = null;
    } else if (name.startsWith('Change Money')) {
      const s = await slot();
      const m = s === null ? null : await ask('Gold', this.game.civ(s).treasury);
      if (s !== null && m !== null) cheatSetMoney(this.game, s, m);
    } else if (name.startsWith('Edit Unit') && unit) {
      await this.editUnit(unit, ask);
    } else if (name.startsWith('Edit King')) {
      await this.editKing(ask);
    } else if (name.startsWith('Edit City') && this.openCity) {
      await this.editCity(this.openCity, ask);
    } else {
      this.log('That needs the scenario tools, which are parked, or something selected first.');
    }
    this.refresh();
  }

  /** Change Terrain At Cursor (0x005094bf): the base terrain, then the seven check boxes. */
  private async changeTerrain(
    at: Point,
    ask: (q: string, d: number) => Promise<number | null>,
  ): Promise<void> {
    if (this.world.cityAt(at.x, at.y)) return;
    const was = this.world.terrainAt(at.x, at.y);
    const list = was === OCEAN ? [] : cheatTerrainChain(this.game, was);
    const t = await ask(
      list.length > 1
        ? `Terrain, 0 to 10 (the short list is ${list.join(', ')})`
        : 'Terrain, 0 to 10',
      was,
    );
    if (t === null) return;
    cheatChangeTerrain(this.game, at.x, at.y, t);
    if (was === OCEAN || t === OCEAN) return;
    const b = cheatSquareImprovements(this.game, at.x, at.y);
    const names = Object.keys(b) as (keyof typeof b)[];
    const sum = names.reduce((n, k, i) => n + (b[k] ? 1 << i : 0), 0);
    const v = await ask(
      'Improvements as a sum: 1 irrigation, 2 mine, 4 road, 8 railroad, 16 fortress, 32 airbase, 64 pollution',
      sum,
    );
    if (v === null) return;
    for (const [i, k] of names.entries()) b[k] = (v & (1 << i)) !== 0;
    cheatSetSquareImprovements(this.game, at.x, at.y, b);
  }

  /** Edit Unit (0x0050ad7f): the dialog's items, chosen by number. */
  private async editUnit(
    unit: Unit,
    ask: (q: string, d: number) => Promise<number | null>,
  ): Promise<void> {
    const item = await ask(
      '1 toggle veteran, 2 restore moves, 3 hit points lost, 4 home city, 5 toggle fortified, 6 commodity',
      1,
    );
    if (item === 1) cheatEditUnit(this.game, unit, { toggleVeteran: true });
    else if (item === 2) cheatEditUnit(this.game, unit, { restoreMoves: true });
    else if (item === 3) {
      const h = await ask('Hit points lost', unit.hitPointsLost);
      if (h !== null) cheatEditUnit(this.game, unit, { hitPointsLost: h });
    } else if (item === 4) {
      const own = this.world.cities.filter((c) => c.owner === unit.owner);
      const list = own.map((c) => `${c.id} ${c.name}`).join(', ');
      const h = await ask(`Home city by number, -1 for none: ${list}`, unit.homeCity ?? -1);
      if (h === -1) cheatEditUnit(this.game, unit, { homeCity: null });
      else if (own.some((c) => c.id === h)) cheatEditUnit(this.game, unit, { homeCity: h });
    } else if (item === 5) cheatEditUnit(this.game, unit, { toggleFortified: true });
    else if (item === 6) {
      const c = await ask('Commodity, 0 to 15, or -1 for none', unit.commodity ?? -1);
      if (c !== null) cheatEditUnit(this.game, unit, { commodity: c < 0 ? 0xff : c });
    }
  }

  /** Edit City (0x0050b507): the dialog's items, chosen by number. */
  private async editCity(
    city: City,
    ask: (q: string, d: number) => Promise<number | null>,
  ): Promise<void> {
    const item = await ask(
      '1 size, 2 clear wonders, 3 clear disorder and celebration, 4 copy improvements, 5 shields, 6 toggle objective',
      1,
    );
    if (item === 1) {
      const n = await ask('City size', city.size);
      if (n !== null) cheatEditCity(city, { size: n });
    } else if (item === 2) cheatEditCity(city, { clearWonders: true });
    else if (item === 3) cheatEditCity(city, { clearOrderFlags: true });
    else if (item === 4) {
      const list = this.world.cities.filter((c) => c !== city);
      const n = await ask(`Copy from: ${list.map((c) => `${c.id} ${c.name}`).join(', ')}`, -1);
      const from = list.find((c) => c.id === n);
      if (from) cheatEditCity(city, { copyImprovementsFrom: from });
    } else if (item === 5) {
      const n = await ask('Shields stored', city.shieldsStored);
      if (n !== null) cheatEditCity(city, { shields: n });
    } else if (item === 6) cheatEditCity(city, { toggleObjective: true });
  }

  /** Edit King (0x0050ba78): the dialog's items, chosen by number. */
  private async editKing(ask: (q: string, d: number) => Promise<number | null>): Promise<void> {
    const slot = await ask('Which civilization, by slot?', this.humanSlot);
    if (slot === null) return;
    const item = await ask(
      '1 treaties, 2 attitude, 3 reputation, 4 research progress, 5 clear research, 6 names, 7 copy advances, 8 clear patience, 9 research goal, 10 last contact, 11 clear all last contact, 12 toggle female',
      1,
    );
    const other = () => ask('Toward which civilization, by slot?', this.humanSlot);
    if (item === 1) {
      const o = await other();
      const f = await ask(
        'Treaties as a sum: 1 contact, 2 cease-fire, 4 peace, 8 alliance, 16 war, 32 vendetta, 64 embassy',
        1,
      );
      if (o !== null && f !== null)
        cheatEditKing(this.game, slot, { treatiesWith: { other: o, flags: f } });
    } else if (item === 2) {
      const o = await other();
      const v = await ask('Attitude', 50);
      if (o !== null && v !== null)
        cheatEditKing(this.game, slot, { attitudeTo: { other: o, value: v } });
    } else if (item === 3) {
      const v = await ask('Reputation', this.game.civ(slot).reputation ?? 0);
      if (v !== null) cheatEditKing(this.game, slot, { reputation: v });
    } else if (item === 4) {
      const v = await ask('Research progress', this.game.civ(slot).scienceStored);
      if (v !== null) cheatEditKing(this.game, slot, { progress: v });
    } else if (item === 5) {
      cheatEditKing(this.game, slot, { clearResearch: true });
    } else if (item === 6) {
      const c = this.game.civ(slot);
      cheatEditKing(this.game, slot, {
        names: {
          leader: (await askText('Edit King', 'Leader', c.leader)) ?? '',
          name: (await askText('Edit King', 'Tribe', c.name)) ?? '',
          adjective: (await askText('Edit King', 'Adjective', c.adjective)) ?? '',
        },
      });
    } else if (item === 8) {
      cheatEditKing(this.game, slot, { clearPatience: true });
    } else if (item === 9) {
      this.showResearch();
    } else if (item === 7) {
      const o = await other();
      if (o !== null) cheatEditKing(this.game, slot, { copyAdvancesFrom: o });
    } else if (item === 10) {
      const o = await other();
      const v = await ask('Turn of last contact', this.game.state.turn);
      if (o !== null && v !== null)
        cheatEditKing(this.game, slot, { lastContact: { other: o, turn: v } });
    } else if (item === 11) {
      cheatEditKing(this.game, slot, { clearLastContact: true });
    } else if (item === 12) {
      cheatEditKing(this.game, slot, { toggleFemale: true });
    }
  }

  /** The player's title under the present government (their own, or the rules' for the tribe). */
  private titleOf(civ: Civ): string {
    const own = civ.titles?.[civ.government];
    if (own) return own;
    const row = this.folder.rules.leaders[civ.tribe ?? 0]?.titles;
    const t = row?.find((x: { governmentIndex: number }) => x.governmentIndex === civ.government);
    return (civ.female ? t?.female : t?.male) ?? '';
  }

  /** Offer another human a treaty (the original's parley dialogs, 0x004ec15a). */
  showParley(): void {
    const others = this.world.civs.filter(
      (c) => c.isHuman && c.inPlay && c.slot !== 0 && c.slot !== this.humanSlot,
    );
    if (others.length === 0) {
      this.log('There is no other human player to talk to.');
      return;
    }
    const box = this.talkBox();
    box.replaceChildren();
    const row = (label: string, field: HTMLElement) => {
      const l = document.createElement('label');
      l.style.display = 'block';
      l.textContent = `${label} `;
      l.append(field);
      box.append(l);
    };
    const select = (options: [string, string][]) => {
      const s = document.createElement('select');
      for (const [value, text] of options) {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = text;
        s.append(o);
      }
      return s;
    };
    const number = () => {
      const i = document.createElement('input');
      i.type = 'number';
      i.min = '0';
      i.value = '0';
      i.style.width = '6em';
      return i;
    };
    const who = select(others.map((c) => [String(c.slot), c.name]));
    const treaty = select([
      ['', 'no treaty'],
      ['ceaseFire', 'cease fire'],
      ['peace', 'peace'],
      ['alliance', 'alliance'],
      ['cancel', 'cancel our treaties'],
    ]);
    const giveGold = number();
    const askGold = number();
    const advanceChoices = (a: Civ, b: Civ): [string, string][] => [
      ['', 'none'],
      ...this.rules.advances.flatMap((adv, i): [string, string][] =>
        a.knownAdvances[i] && !b.knownAdvances[i] ? [[String(i), adv.name]] : [],
      ),
    ];
    const other = () => this.game.civ(Number(who.value));
    let giveAdvance = select(advanceChoices(this.civ, other()));
    let askAdvance = select(advanceChoices(other(), this.civ));
    const cityChoices = (slot: number): [string, string][] => [
      ['', 'none'],
      ...this.world.cities
        .filter((c) => c.owner === slot)
        .map((c): [string, string] => [String(c.id), c.name]),
    ];
    const giveCity = select(cityChoices(this.humanSlot));
    let askCity = select(cityChoices(other().slot));
    const check = () => {
      const c = document.createElement('input');
      c.type = 'checkbox';
      return c;
    };
    const giveMap = check();
    const askMap = check();
    const giveUnit = check();
    who.addEventListener('change', () => {
      const a = select(advanceChoices(this.civ, other()));
      const b = select(advanceChoices(other(), this.civ));
      const c = select(cityChoices(other().slot));
      askAdvance.replaceWith(b);
      giveAdvance.replaceWith(a);
      askCity.replaceWith(c);
      giveAdvance = a;
      askAdvance = b;
      askCity = c;
    });
    row('To', who);
    row('Treaty', treaty);
    row('We give gold', giveGold);
    row('We ask gold', askGold);
    row('We give advance', giveAdvance);
    row('We ask advance', askAdvance);
    row('We give city', giveCity);
    row('We ask city', askCity);
    row('We give our map', giveMap);
    row('We ask their map', askMap);
    if (this.selected?.owner === this.humanSlot) row('We give the selected unit', giveUnit);
    const unit = this.selected;
    this.talkButton(box, 'Send offer', () => {
      const give: ParleyItem[] = [];
      const take: ParleyItem[] = [];
      const t = treaty.value;
      if (t === 'ceaseFire' || t === 'peace' || t === 'alliance' || t === 'cancel')
        give.push({ kind: 'treaty', level: t });
      if (Number(giveGold.value) > 0) give.push({ kind: 'gold', amount: Number(giveGold.value) });
      if (Number(askGold.value) > 0) take.push({ kind: 'gold', amount: Number(askGold.value) });
      if (giveAdvance.value) give.push({ kind: 'advances', list: [Number(giveAdvance.value)] });
      if (askAdvance.value) take.push({ kind: 'advances', list: [Number(askAdvance.value)] });
      if (giveCity.value) give.push({ kind: 'cities', ids: [Number(giveCity.value)] });
      if (askCity.value) take.push({ kind: 'cities', ids: [Number(askCity.value)] });
      if (giveMap.checked) give.push({ kind: 'map' });
      if (askMap.checked) take.push({ kind: 'map' });
      if (giveUnit.checked && unit) give.push({ kind: 'units', ids: [unit.id] });
      this.closeTalk();
      if (give.length + take.length === 0) return;
      this.game.offerParley(this.humanSlot, Number(who.value), give, take);
      this.log(`Offer sent to the ${this.game.civ(Number(who.value)).name}.`);
      this.refresh();
    });
    this.talkButton(box, 'End our treaty', () => {
      const other = Number(who.value);
      this.closeTalk();
      if (!this.writable(() => this.game.cancelHumanTreaty(this.humanSlot, other))) return;
      this.game.cancelHumanTreaty(this.humanSlot, other);
      this.log(`Treaty with the ${this.game.civ(other).name} ended.`);
      this.refresh();
    });
    this.talkButton(box, 'Cancel', () => this.closeTalk());
  }

  private parleyText(items: ParleyItem[]): string {
    return items
      .map((i) => {
        switch (i.kind) {
          case 'treaty':
            return i.level === 'cancel' ? 'an end to our treaties' : i.level;
          case 'gold':
            return `${i.amount} gold`;
          case 'advances':
            return i.list.map((a) => this.rules.advances[a]?.name ?? '?').join(', ');
          case 'map':
            return 'a map';
          case 'units':
            return `${i.ids.length} unit(s)`;
          case 'cities':
            return i.ids.map((c) => this.world.cities.find((x) => x.id === c)?.name).join(', ');
          case 'war':
            return 'war';
        }
      })
      .join(', ');
  }

  /** An offer from another human, when this seat is free to answer. */
  private showParleyOffer(): void {
    if (
      this.talk ||
      this.seatPending ||
      document.getElementById('talkBox')?.style.display === 'block'
    )
      return;
    const offer = this.game.state.parleyOffers?.find((o) => o.to === this.humanSlot);
    if (!offer) return;
    const box = this.talkBox();
    box.replaceChildren();
    const text = document.createElement('div');
    text.textContent = `The ${this.game.civ(offer.from).name} offer ${this.parleyText(offer.give) || 'nothing'} and ask ${this.parleyText(offer.take) || 'nothing'}.`;
    box.append(text);
    const answer = (yes: boolean) => () => {
      const run = () => {
        for (const e of this.game.answerParley(offer.id, yes)) {
          const line = this.eventText(e);
          if (line) this.log(line);
        }
        this.log(yes ? 'The offer is accepted.' : 'The offer is refused.');
        this.closeTalk();
      };
      if (this.writable(run)) run();
    };
    this.talkButton(box, 'Accept', answer(true));
    this.talkButton(box, 'Refuse', answer(false));
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

  private readonly news: { picture: number; text: string; city?: City }[] = [];

  /** An event worth an engraving (0x004b7280): the second of each pair after advance 37. */
  private queueNews(picture: number, text: string): void {
    this.news.push({ picture: picture + (this.civ.knownAdvances[37] === true ? 1 : 0), text });
  }

  private showNews(item: { picture: number; text: string; city?: City }): void {
    const box = this.talkBox();
    box.replaceChildren();
    const city = item.city;
    if (city) {
      const text = document.createElement('p');
      text.textContent = item.text;
      box.append(text);
      this.talkButton(box, 'Continue', () => this.closeTalk());
      this.talkButton(box, 'Zoom to City', () => {
        this.closeTalk();
        this.showCity(city);
      });
      return;
    }
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
      void (async () => {
        const minutes = (await askNumber('Game timer', 'Minutes', 10)) ?? 0;
        const seconds = (await askNumber('Game timer', 'Seconds', 0)) ?? 0;
        set(Math.max(0, minutes * 60000 + seconds * 1000));
      })();
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
    text.textContent =
      `${this.titleOf(this.civ)} ${this.civ.leader} of the ${this.civ.name}: your turn.`.trim();
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
    box.style.width = 'min(960px, calc(100vw - 40px))';
    box.style.zIndex = '46';
    box.replaceChildren();
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;image-rendering:auto';
    box.appendChild(canvas);
    void drawCityView(canvas, this.game, this.folder, city).then((ok) => {
      if (!ok) canvas.remove();
    });
    this.talkButton(box, 'Close', () => {
      box.style.width = '';
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
      this.talkButton(box, c.name, async () => {
        const threat = airliftThreat(
          this.world,
          this.rules,
          unit,
          c,
          (o) => ((treatiesOf(this.civ)[o] ?? 0) & TREATY.war) !== 0,
        );
        if (threat.count > 0 && !(await askYes('Enemy fighters are in range. Fly anyway?'))) return;
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

  private async paradrop(unit: Unit, to: Point): Promise<void> {
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
        if (!(await askYes(`This breaks your treaty with the ${name}. Proceed?`))) return;
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
    // VERIFIED (0x004d8857): the council's film for the era, a different one under Anarchy.
    void this.playVideo(`${this.civ.government === 0 ? 'ANARCHY' : 'COUNCIL'}${era}`);
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
    this.talkButton(box, 'Hall of Fame', () => {
      const list = document.createElement('pre');
      list.textContent = fameLines(readFame()).join('\n');
      box.append(list);
    });
    if (this.world.civs.filter((c) => c.isHuman).length > 1)
      this.talkButton(box, 'Set password', () => this.setPassword());
    this.talkButton(box, 'Close', () => this.closeTalk());
  }

  private async chat(): Promise<void> {
    if (!this.onChat) {
      this.log('Chat needs a network game.');
      return;
    }
    const humans = this.world.civs.filter(
      (c) => c.isHuman && c.inPlay && c.slot !== this.humanSlot,
    );
    const who = await askText(
      'Chat',
      `Send to which players? ${humans.map((c) => `${c.slot} ${c.name}`).join(', ')} (empty for all)`,
    );
    if (who === null) return;
    const text = await askText('Chat', 'Message');
    if (!text) return;
    const to = who.trim() === '' ? humans.map((c) => c.slot) : who.split(/[ ,]+/).map(Number);
    // VERIFIED (0x0048fb53): a spy listening to the sender gets a copy of everything.
    for (const c of humans)
      if (
        !to.includes(c.slot) &&
        hasTreaty(this.world, c.slot, this.humanSlot, TREATY.chatIntercept)
      )
        to.push(c.slot);
    // VERIFIED (0x0048fb53, box 0x40d at 0x004ec448): the sender can leave their name off.
    const anonymous = await askYes('Send without your name?', 'Chat');
    this.onChat(text, to, anonymous);
  }

  /** Retire (0x004af61c): the power graph, then the score, and the game ends. */
  private async retire(): Promise<void> {
    if (this.seat !== null && !this.game.state.byFile) {
      // Network play: this player leaves and the game goes on (0x004aeab6).
      if (!(await askYes('Really leave the game?'))) return;
      const seat = this.seat;
      if (!this.writable(() => this.game.retireHuman(seat))) return;
      this.game.retireHuman(seat);
      this.refresh();
      return;
    }
    if (await askYes('Really retire?')) this.showPowerGraph(true);
  }

  /**
   * The close of a game (VERIFIED 0x0046b383): the ending's film, the destroyed civilizations on
   * a conquest, the score, and alone against the computer the choice to play on. A defeated
   * player has no such choice.
   */
  private async endOfGame(): Promise<void> {
    const over = this.game.state.gameOver;
    if (!over) return;
    if (over.reason === 'defeat') void this.playVideo('LOSER');
    else if (over.winner === this.humanSlot && over.reason !== 'retirement')
      void this.playVideo('WINWIN');
    if (over.reason === 'conquest')
      for (const d of this.game.state.destroyedLog ?? [])
        this.log(`${d.year < 0 ? `${-d.year} BC` : `${d.year} AD`}: the ${d.name} fell.`);
    this.enterHallOfFame();
    const alone = this.seat === null && this.world.civs.filter((c) => c.isHuman).length === 1;
    if (!alone || over.reason === 'defeat') return;
    if (await askYes('Your final score is in. Keep playing? No further score is recorded.')) {
      this.game.keepPlaying();
      this.fameEntered = false;
      this.log('The game goes on.');
    }
  }

  /** The score goes in the Hall of Fame once (0x00429bb6, from 0x0046b383 and 0x004af61c). */
  private enterHallOfFame(): void {
    if (this.fameEntered || this.game.state.keptPlaying) return;
    this.fameEntered = true;
    const list = addFameEntry({
      name: this.civ.leader,
      tribe: this.civ.name,
      score: this.game.scoreOf(this.humanSlot).total,
      difficulty: this.game.state.difficulty,
      turn: this.game.state.turn,
      year: this.yearText(),
      cheated: this.game.state.cheatMode === true,
    });
    this.log(fameLines(list).join('\n'));
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
      if (ending) {
        this.game.state.gameOver = { winner: this.humanSlot, reason: 'retirement' };
        this.enterHallOfFame();
      }
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
  /** Find Commodity on the trade advisor's page (0x0041e8b7 and 0x0041e494). */
  private commodityFinder(box: HTMLElement): void {
    const pick = document.createElement('select');
    this.folder.rules.caravanCommodities.forEach((name, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = name;
      pick.append(o);
    });
    const out = document.createElement('pre');
    out.style.cssText = 'margin:4px 0;font:12px monospace';
    const find = () => {
      const r = commoditySearch(this.world, this.humanSlot, Number(pick.value));
      const row = (c: City) =>
        `  ${c.name} (${c.size})${c.owner === this.humanSlot ? '' : `, ${this.game.civ(c.owner).name}`}`;
      out.textContent = [
        'Wanted in:',
        ...r.wanted.map(row),
        'Supplied by:',
        ...r.supplied.map(row),
      ].join('\n');
    };
    pick.addEventListener('change', find);
    box.append('Find commodity ', pick, out);
    find();
  }

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
    if (key === 'F5' && this.civ.knownAdvances[84] === true) this.commodityFinder(box);
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
      this.shipControls(box);
    }
    this.talkButton(box, 'Close', () => this.closeTalk());
  }

  /** The spaceship's figures, and the launch while it has a structure and has not flown. */
  private shipControls(box: HTMLElement): void {
    const civ = this.civ;
    const ship = civ.spaceship;
    if (!ship || !hasStarted(civ)) return;
    const ev = evaluateShip(
      ship,
      true,
      this.rules.cosmic.massThrustParadigm ?? 75,
      this.game.knows(this.humanSlot, 32),
      yearOf(this.game.state),
      true,
    );
    const text = document.createElement('p');
    text.textContent =
      `${PART_NAMES.map((n, i) => `${ship.parts[i] ?? 0} ${n}`).join(', ')}\n` +
      `Success ${ev.success} %, flight ${(ev.flightTenths / 10).toFixed(1)} years, ` +
      (hasLaunched(civ)
        ? `launched ${ship.launchYear}, arrives ${ship.arrival}`
        : `would arrive ${ev.arrivalYear}`);
    box.append(text);
    if (hasLaunched(civ) || (ship.parts[0] ?? 0) === 0) return;
    this.talkButton(box, 'Launch', () => {
      const events: SpaceshipEvent[] = [];
      launchShip(this.world, civ, this.game.shipContext(), events);
      void this.playVideo('LAUNCH');
      for (const e of events) this.log(`${e.text}.`);
      this.closeTalk();
    });
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
      document.body.appendChild(box);
    }
    box.style.display = 'block';
    return box;
  }

  private talkButton(box: HTMLElement, label: string, run: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
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
    const herald = talk ? this.game.pendingTalkFrom : null;
    if (herald !== null)
      void this.playVideo(`HRLD${HERALDS[this.game.civ(herald).tribe ?? 0] ?? ''}`);
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
      const h = this.game.helpCalls.findIndex((c) => c.human === this.humanSlot);
      if (h >= 0) {
        const [call] = this.game.helpCalls.splice(h, 1);
        if (call) {
          this.talk = this.game.helpTalk(call);
          this.showDialog(this.talk.next());
        }
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
      // VERIFIED on the original's saves: a female leader's portrait is the tribe's plus 21.
      const index = (civ.tribe ?? civ.portrait ?? 0) + (civ.female ? 21 : 0);
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
          intercept: 'Intercept communications',
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
}
