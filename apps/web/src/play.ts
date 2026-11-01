/**
 * The interactive layer: a human plays one civilization from a loaded save.
 *
 * All rules live in the engine; this module only maps keys and clicks to engine calls, keeps the
 * selection, and renders panels. Places where the original's behaviour is not yet decoded are
 * marked INFERRED in the log text shown to the player.
 */
import {
  advanceIndex,
  canBuildUnit,
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
  gameYear,
  gotoStep,
  hutAt,
  joinCity,
  mood,
  movesLeft,
  ORDER,
  orderGoTo,
  pillage,
  pillageOptions,
  rawYields,
  researchableAdvances,
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
} from '@mudbrick/engine';
import { ADVANCE, IMPROVEMENT } from '@mudbrick/engine';
import { sprites } from '@mudbrick/formats';
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
  selected: Unit | null = null;
  openCity: City | null = null;
  gotoMode = false;
  private readonly logLines: string[] = [];
  private cityNames = 0;

  constructor(
    readonly game: Game,
    readonly folder: GameFolder,
    readonly humanSlot: number,
    readonly el: PlayElements,
    readonly renderOptions: () => WorldRenderOptions,
  ) {
    this.log(`You lead the ${this.civ.name}. Arrow keys or the number pad move the selected unit.`);
    this.selectNext();
    this.refresh();
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
    switch (e.key) {
      case 'Enter':
        this.endTurn();
        return true;
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
    });
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
      turn: this.game.state.turn,
      difficulty: this.game.state.difficulty,
      conquest: true,
      guerillaWarfareDiscovered: (this.game.state.firstDiscoveredBy[34] ?? 0) !== 0,
      ...(this.game.state.forbidGovernmentChange ? { forbidGovernmentSwitching: true } : {}),
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
      year: gameYear(this.game.state.turn, this.game.state.difficulty),
      difficulty: this.game.state.difficulty,
      barbarianActivity: 1,
      knownByAnyone: (a) => this.world.civs.some((c) => c.knownAdvances[a]),
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
    pillage(this.world, this.rules, unit, choice);
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

  endTurn(): void {
    const events = this.game.endTurn();
    for (const e of events) {
      if (e.slot !== this.humanSlot) continue;
      const text = this.eventText(e);
      if (text) this.log(text);
    }
    this.log(`— Turn ${this.game.state.turn}, ${this.yearText()} —`);
    this.selected = null;
    this.selectNext();
    this.refresh();
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
      case 'discovered':
        return `Discovery: ${this.rules.advances[ev.advance]?.name ?? ev.advance}.`;
      case 'choose-research':
        return 'Choose what to research next.';
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
      case 'meltdown':
        return `Nuclear meltdown in ${cityName}! The Nuclear Plant is destroyed.`;
      case 'disbanded-for-shortage':
        return `${cityName} cannot support ${this.unitName(ev.unit)}; it is disbanded.`;
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
    const y = gameYear(this.game.state.turn, this.game.state.difficulty);
    return y < 0 ? `${-y} BC` : `${y} AD`;
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

  private renderStatus(): void {
    const civ = this.civ;
    const waiting = this.humanUnits().filter((u) => this.needsOrders(u)).length;
    const gov =
      this.folder.rules.governments[civ.government]?.name ?? `government ${civ.government}`;
    this.el.status.textContent =
      `${civ.name} · ${gov} · Turn ${this.game.state.turn} (${this.yearText()}) · ` +
      `${civ.treasury} gold · tax ${civ.taxRate * 10} % lux ${(10 - civ.taxRate - civ.scienceRate) * 10} % sci ${civ.scienceRate * 10} % · ` +
      (waiting > 0 ? `${waiting} unit(s) awaiting orders` : 'press Enter to end the turn');
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
        bribeUnit(this.world, this.rules, unit, target, ctx),
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
    const canBuildOption = (opt: { kind: 'unit' | 'improvement'; index: number }) => {
      if (opt.kind === 'unit') return canBuildUnit(this.rules, this.civ, opt.index);
      const imp = this.rules.improvements[opt.index];
      if (!imp || opt.index === 0 || imp.preq?.kind === 'never') return false;
      if (opt.index >= 39 && this.game.wonderCity(opt.index) !== null) return false;
      if (opt.index < 39 && city.improvements[opt.index]) return false;
      const pre = advanceIndex(imp.preq);
      return pre === null || this.civ.knownAdvances[pre] === true;
    };
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
    el.replaceChildren(header, label);
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
    const label = document.createElement('label');
    label.textContent = 'Research: ';
    const select = document.createElement('select');
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '(choose)';
    select.append(none);
    for (const a of researchableAdvances(this.rules, civ)) {
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
    el.replaceChildren(text, label, govLabel);
  }
}
