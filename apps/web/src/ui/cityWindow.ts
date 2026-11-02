/**
 * The city window: 636 × 421 (VERIFIED 0x004c785f) on the player's own CITY.GIF. The panes sit on
 * that picture's own frames: citizens along the top, the map of the city's squares, the resource
 * rows, food storage, production, units and improvements. Every number comes from the engine.
 */
import {
  buyCost,
  buyProduction,
  changeProduction,
  CITY_CENTRE_INDEX,
  cycleSpecialist,
  mood,
  rawYields,
  sellImprovement,
  shieldTotals,
  squareYield,
  tradeSplit,
  unitSupport,
  type City,
  type Game,
  type Production,
  type Unit,
  type World,
} from '@mudbrick/engine';
import { sprites } from '@mudbrick/formats';
import type { GameFolder } from '../gameFiles.js';
import { drawSquareTerrain } from '../terrainCompositor.js';
import { drawCity as drawCitySprite, ditherFor } from '../worldRenderer.js';
import { productionIcon, spriteCanvas, unitIcon, improvementIcon } from './spriteIcon.js';
import { askButtons, askList, askText, askYes, tell, type ListItem } from './windows.js';

const WIDTH = 636;
const HEIGHT = 421;
/** The map's frame on the picture. */
const MAP = { x: 7, y: 64, w: 188, h: 139 };

export interface CityHost {
  game: Game;
  folder: GameFolder;
  humanSlot: number;
  readonly world: World;
  refresh(): void;
  log(line: string): void;
  playSound(name: string | null): void;
  showCityView(city: City): void;
  showPedia(category: 'units' | 'improvements', row: number): void;
  selectUnit(u: Unit): void;
  closeCity(): void;
}

function pane(x: number, y: number, w: number, h: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cityPane';
  el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
  return el;
}

function head(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'paneHead';
  el.textContent = text;
  return el;
}

export class CityWindow {
  private readonly root: HTMLElement;
  private readonly frame: HTMLElement;
  private readonly sheet: HTMLElement;
  private wallpaper: string | null = null;
  private city: City | null = null;
  private info = false;
  private happy = false;

  constructor(
    private readonly host: CityHost,
    root: HTMLElement,
  ) {
    this.root = root;
    this.frame = document.createElement('div');
    this.frame.id = 'cityFrame';
    this.sheet = document.createElement('div');
    this.sheet.id = 'citySheet';
    this.frame.append(this.sheet);
    this.root.append(this.frame);
    window.addEventListener('resize', () => this.fit());
    void host.folder.file('CITY.GIF').then((f) => {
      if (!f) return;
      this.wallpaper = URL.createObjectURL(f);
      this.sheet.style.backgroundImage = `url(${this.wallpaper})`;
    });
  }

  get isOpen(): boolean {
    return this.city !== null;
  }

  open(city: City): void {
    this.city = city;
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.city = null;
    this.info = false;
    this.happy = false;
    this.root.hidden = true;
  }

  private fit(): void {
    const scale = Math.max(
      0.6,
      Math.min((innerWidth - 16) / (WIDTH + 4), (innerHeight - 16) / (HEIGHT + 28), 2.5),
    );
    this.frame.style.transform = `scale(${scale})`;
  }

  /** The player's cities in order, to step through. */
  private ownCities(): City[] {
    return this.host.world.cities.filter((c) => c.owner === this.host.humanSlot);
  }

  step(by: number): void {
    const city = this.city;
    if (!city) return;
    const own = this.ownCities();
    const next = own[(own.indexOf(city) + by + own.length) % own.length];
    if (next) this.open(next);
  }

  render(): void {
    const city = this.city;
    if (!city) return;
    if (!this.host.world.cities.includes(city) || city.owner !== this.host.humanSlot) {
      this.host.closeCity();
      return;
    }
    this.fit();
    const { game, world } = this.host;
    const rules = game.rules;
    const ctx = game.cityContext(city);
    const raw = rawYields(world, rules, city, ctx);
    const homed = world.units.filter((u) => u.homeCity === city.id);
    const support = unitSupport(world, rules, city, ctx, homed);
    const shields = shieldTotals(rules, city, ctx, raw.shields, support.shields);
    const trade = tradeSplit(rules, city, ctx, raw.trade);
    const m = mood(rules, city, ctx, {
      luxuries: trade.luxuries,
      militaryInCity: support.inCity,
      militaryAbroad: support.abroad,
      noMilitaryUnhappiness: support.abroad === 0,
    });
    const eaten = city.size * rules.cosmic.foodPerCitizen + support.settlers;
    const civ = game.civ(city.owner);

    const top = this.citizens(city, m, civ.epoch);
    const title = pane(8, 40, 430, 18);
    title.style.cssText += ';color:#fff;font-size:14px;text-shadow:1px 1px 0 #000';
    title.textContent = `${city.name}${
      city.inDisorder ? ' (Civil Disorder)' : city.celebrating ? ' (Celebrating)' : ''
    }    Treasury: ${civ.treasury} gold`;

    const left = this.happy ? this.moodPane(city, m, trade.luxuries, support) : this.mapPane(city);
    const rows = this.resourceRows(raw, eaten, shields, support.shields, trade);
    const food = this.foodPane(city, raw.food - eaten);
    const production = this.productionPane(city, shields.produced);
    const buildings = this.buildingPane(city);
    const [units, present] = this.info
      ? [this.routesPane(city), this.presentPane(city)]
      : [this.supportPane(city, homed), this.presentPane(city)];
    const buttons = this.buttonPane(city);
    this.sheet.replaceChildren(
      top,
      title,
      left,
      rows,
      food,
      production,
      units,
      present,
      buildings,
      buttons,
    );
  }

  private citizens(
    city: City,
    m: { happy: number; content: number; unhappy: number },
    epoch: number,
  ) {
    const box = pane(8, 6, 428, 32);
    box.style.display = 'flex';
    const sp = city.specialists;
    const workers = Math.max(0, city.size - sp.entertainers - sp.taxCollectors - sp.scientists);
    const faces: { col: number; special?: 0 | 1 | 2 }[] = [];
    const happy = Math.min(m.happy, workers);
    const content = Math.min(m.content, workers - happy);
    for (let i = 0; i < workers; i++) {
      const female = i % 2;
      if (i < happy) faces.push({ col: female });
      else if (i < happy + content) faces.push({ col: 2 + female });
      else faces.push({ col: 4 + female });
    }
    (['entertainers', 'taxCollectors', 'scientists'] as const).forEach((k, n) => {
      for (let i = 0; i < sp[k]; i++) faces.push({ col: 8 + n, special: n as 0 | 1 | 2 });
    });
    const pitch = Math.min(27, Math.floor(420 / Math.max(1, faces.length)));
    const sheet = this.people;
    for (const f of faces) {
      const c = sheet
        ? spriteCanvas(sheet, sprites.citizenFace(f.col, Math.min(3, epoch)))
        : document.createElement('canvas');
      c.style.flex = 'none';
      c.style.marginRight = `${pitch - 27}px`;
      if (f.special !== undefined) {
        const special = f.special;
        c.style.cursor = 'pointer';
        c.title = 'Click to change this specialist';
        c.addEventListener('click', () => {
          cycleSpecialist(city, special);
          this.host.refresh();
        });
      }
      box.append(c);
    }
    if (!sheet) void this.loadPeople();
    return box;
  }

  private people: import('../gameFiles.js').Sheet | undefined;
  private peopleLoading = false;

  private async loadPeople(): Promise<void> {
    if (this.peopleLoading) return;
    this.peopleLoading = true;
    const f = await this.host.folder.file('PEOPLE.GIF');
    if (!f) return;
    const bitmap = await createImageBitmap(f);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext('2d');
    if (!g) return;
    g.drawImage(bitmap, 0, 0);
    const pixels = g.getImageData(0, 0, bitmap.width, bitmap.height);
    const d = pixels.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 255) d[i + 3] = 0;
    }
    g.putImageData(pixels, 0, 0);
    this.people = { canvas, pixels };
    this.render();
  }

  /** The city's 21 squares: terrain, the city, and the yields of the squares being worked. */
  private mapPane(city: City): HTMLElement {
    const { game, folder, world } = this.host;
    const box = pane(MAP.x, MAP.y, MAP.w, MAP.h);
    const canvas = document.createElement('canvas');
    const dpr = 2;
    canvas.width = MAP.w * dpr;
    canvas.height = MAP.h * dpr;
    canvas.style.cssText = `width:${MAP.w}px;height:${MAP.h}px;cursor:pointer`;
    const g = canvas.getContext('2d');
    if (!g) return box;
    const scale = (MAP.w * dpr) / 320;
    const tileW = 64 * scale;
    const tileH = 32 * scale;
    const cx = (MAP.w * dpr) / 2;
    const cy = (MAP.h * dpr) / 2;
    const dx = (p: { x: number }) => {
      let d = p.x - city.position.x;
      if (!world.flatEarth) {
        const W = world.widthX2;
        if (d > W / 2) d -= W;
        if (d < -W / 2) d += W;
      }
      return d;
    };
    const squares: { i: number; px: number; py: number }[] = [];
    for (let i = 0; i <= CITY_CENTRE_INDEX; i++) {
      const p = world.radiusSquare(city.position.x, city.position.y, i);
      if (!p || !world.isSeen(p.x, p.y, this.host.humanSlot)) continue;
      squares.push({
        i,
        px: cx + (dx(p) * tileW) / 2 - tileW / 2,
        py: cy + ((p.y - city.position.y) * tileH) / 2 - tileH / 2,
      });
    }
    squares.sort((a, b) => a.py - b.py);
    const terrain1 = folder.sheets.TERRAIN1;
    const dither = ditherFor(folder);
    if (terrain1 && dither) {
      const tile = new OffscreenCanvas(64, 32);
      const t = tile.getContext('2d');
      g.imageSmoothingEnabled = true;
      for (const s of squares) {
        const p = world.radiusSquare(city.position.x, city.position.y, s.i);
        if (!p || !t) continue;
        t.clearRect(0, 0, 64, 32);
        drawSquareTerrain(t, world, p.x, p.y, 0, 0, terrain1, folder.sheets.TERRAIN2, dither);
        g.drawImage(tile, s.px, s.py, tileW, tileH);
      }
    }
    // The city itself, in the middle, at the same scale as the squares.
    const sprite = new OffscreenCanvas(64, 48);
    const sg = sprite.getContext('2d');
    if (sg) {
      drawCitySprite(
        sg as unknown as CanvasRenderingContext2D,
        world,
        folder,
        city,
        folder.rules.improvements.find((i) => i.name === 'Palace')?.index ?? 1,
        folder.rules.improvements.find((i) => i.name === 'City Walls')?.index ?? 8,
        16,
        { x: 0, y: 0 },
      );
      g.drawImage(sprite, cx - tileW / 2, cy - tileH / 2 - 16 * scale, tileW, 48 * scale);
    }
    const ctx = game.cityContext(city);
    const icons = folder.sheets.ICONS;
    for (const s of squares) {
      const worked = s.i === CITY_CENTRE_INDEX || (city.worked & (1 << s.i)) !== 0;
      if (!worked || !icons) continue;
      const runs = ([0, 1, 2] as const).flatMap((k) =>
        Array<number>(squareYield(world, game.rules, city, s.i, k, ctx)).fill(k),
      );
      const size = 8 * dpr;
      const pitch = Math.min(size, (tileW - size) / Math.max(1, runs.length - 1));
      const start = s.px + tileW / 2 - (pitch * (runs.length - 1) + size) / 2;
      runs.forEach((k, n) => {
        const r = sprites.smallIcon(k);
        g.imageSmoothingEnabled = false;
        g.drawImage(
          icons.canvas,
          r.x,
          r.y,
          r.w,
          r.h,
          start + n * pitch,
          s.py + tileH / 2 - size / 2,
          size,
          size,
        );
      });
    }
    canvas.addEventListener('click', (e) => {
      const box = canvas.getBoundingClientRect();
      const mx = ((e.clientX - box.left) / box.width) * canvas.width;
      const my = ((e.clientY - box.top) / box.height) * canvas.height;
      for (const s of squares) {
        const nx = Math.abs(mx - (s.px + tileW / 2)) / (tileW / 2);
        const ny = Math.abs(my - (s.py + tileH / 2)) / (tileH / 2);
        if (nx + ny <= 1) {
          game.clickCitySquare(city, s.i);
          this.host.refresh();
          return;
        }
      }
    });
    box.append(canvas);
    return box;
  }

  private moodPane(
    city: City,
    m: { happy: number; content: number; unhappy: number },
    luxuries: number,
    support: { inCity: number; abroad: number },
  ): HTMLElement {
    const box = pane(MAP.x, MAP.y, MAP.w, MAP.h);
    box.style.cssText += ';color:#fff;padding:6px;box-sizing:border-box;font-size:13px';
    box.textContent = [
      `${m.happy} happy`,
      `${m.content} content`,
      `${m.unhappy} unhappy`,
      `Luxuries: ${luxuries}`,
      `Military at home: ${support.inCity}`,
      `Military away: ${support.abroad}`,
      city.inDisorder ? 'The city is in disorder.' : '',
    ]
      .filter(Boolean)
      .join('\n');
    box.style.whiteSpace = 'pre-wrap';
    return box;
  }

  private iconRun(sheetRect: sprites.Rect, count: number, room: number): HTMLElement {
    const { folder } = this.host;
    const run = document.createElement('div');
    run.className = 'iconRun';
    const n = Math.min(count, 60);
    const pitch = n > 0 ? Math.min(14, room / n) : 14;
    for (let i = 0; i < n; i++) {
      const c = spriteCanvas(folder.sheets.ICONS, sheetRect);
      c.style.marginRight = `${pitch - 14}px`;
      run.append(c);
    }
    return run;
  }

  private resourceRows(
    raw: { food: number; shields: number; trade: number },
    eaten: number,
    shields: { produced: number; waste: number },
    supported: number,
    trade: { luxuries: number; science: number; tax: number; corruption: number },
  ): HTMLElement {
    const box = pane(200, 58, 236, 142);
    box.append(head('City Resources'));
    const row = (y: number, left: HTMLElement, right: HTMLElement, text: string) => {
      const r = document.createElement('div');
      r.className = 'cityRow';
      r.style.top = `${y}px`;
      r.append(left, right);
      r.title = text;
      box.append(r);
    };
    const food = sprites.bigIcon(0, 1);
    const shield = sprites.bigIcon(1, 1);
    const coin = sprites.bigIcon(2, 1);
    const label = (t: string) => {
      const s = document.createElement('span');
      s.textContent = t;
      return s;
    };
    const left = (rect: sprites.Rect, n: number, t: string) => {
      const d = document.createElement('div');
      d.style.cssText = 'display:flex;gap:3px;align-items:center';
      d.append(label(t), this.iconRun(rect, n, 150));
      return d;
    };
    row(
      18,
      left(food, raw.food, `Food ${raw.food}`),
      label(`${raw.food - eaten >= 0 ? '+' : ''}${raw.food - eaten}`),
      `${raw.food} food, ${eaten} eaten`,
    );
    row(
      58,
      left(coin, raw.trade, `Trade ${raw.trade}`),
      label(`corrupt ${trade.corruption}`),
      'Trade and corruption',
    );
    row(
      82,
      label(`Lux ${trade.luxuries}`),
      label(`Tax ${trade.tax}   Sci ${trade.science}`),
      'Trade after corruption',
    );
    row(
      123,
      left(shield, raw.shields, `Shields ${shields.produced}`),
      label(`support ${supported}${shields.waste ? `  waste ${shields.waste}` : ''}`),
      'Shields made, used for support, and lost to waste',
    );
    return box;
  }

  private grid(
    box: HTMLElement,
    rect: sprites.Rect,
    columns: number,
    lines: number,
    filled: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const { folder } = this.host;
    const pitchX = Math.min(14, (w - 14) / Math.max(1, columns - 1));
    const pitchY = Math.min(14, (h - 14) / Math.max(1, lines - 1));
    const shown = Math.min(filled, columns * lines);
    for (let n = 0; n < shown; n++) {
      const c = spriteCanvas(folder.sheets.ICONS, rect);
      c.style.position = 'absolute';
      c.style.left = `${x + (n % columns) * pitchX}px`;
      c.style.top = `${y + Math.floor(n / columns) * pitchY}px`;
      box.append(c);
    }
  }

  private foodPane(city: City, surplus: number): HTMLElement {
    const rules = this.host.game.rules;
    const box = pane(438, 0, 194, 164);
    box.append(head('Food Storage'));
    const rows = rules.cosmic.foodBoxRows;
    const columns = city.size + 1;
    const capacity = rows * columns;
    this.grid(box, sprites.bigIcon(0, 1), columns, rows, city.foodStored, 6, 18, 182, 128);
    const note = document.createElement('div');
    note.style.cssText =
      'position:absolute;left:0;right:0;bottom:2px;text-align:center;color:#fff;text-shadow:1px 1px 0 #000';
    note.textContent = `${city.foodStored} / ${capacity}${
      surplus > 0
        ? `  grows in ${Math.max(1, Math.ceil((capacity - city.foodStored) / surplus))}`
        : surplus < 0
          ? '  shrinking'
          : ''
    }`;
    box.append(note);
    return box;
  }

  private itemName(p: Pick<Production, 'kind' | 'index'>): string {
    const rules = this.host.game.rules;
    return (
      (p.kind === 'unit' ? rules.units[p.index]?.name : rules.improvements[p.index]?.name) ?? '?'
    );
  }

  private itemCost(city: City, p: Pick<Production, 'kind' | 'index'>): number {
    const { game } = this.host;
    const rules = game.rules;
    const rows = game.productionContext(city).shieldRows;
    return (
      rows *
      (p.kind === 'unit'
        ? (rules.units[p.index]?.costRows ?? 0)
        : (rules.improvements[p.index]?.costRows ?? 0))
    );
  }

  private productionPane(city: City, shields: number): HTMLElement {
    const { game, folder } = this.host;
    const box = pane(438, 165, 194, 190);
    const item = city.production;
    box.append(head('Production'));
    const name = document.createElement('div');
    name.style.cssText =
      'display:flex;gap:6px;align-items:center;justify-content:center;height:30px;color:#fff;text-shadow:1px 1px 0 #000;font-size:13px;cursor:pointer';
    name.append(productionIcon(folder, item, 30));
    const label = document.createElement('span');
    label.textContent = this.itemName(item);
    name.append(label);
    name.addEventListener('click', () => void this.change(city));
    box.append(name);
    const cost = this.itemCost(city, item);
    const rows = game.productionContext(city).shieldRows;
    const lines = Math.max(1, Math.ceil(cost / Math.max(1, rows)));
    this.grid(box, sprites.bigIcon(1, 1), rows, lines, city.shieldsStored, 6, 50, 182, 118);
    const note = document.createElement('div');
    note.style.cssText =
      'position:absolute;left:0;right:0;bottom:2px;text-align:center;color:#fff;text-shadow:1px 1px 0 #000';
    const left = Math.max(0, cost - city.shieldsStored);
    note.textContent = `${city.shieldsStored} / ${cost}${
      shields > 0 ? `  in ${Math.max(1, Math.ceil(left / shields))} turns` : ''
    }`;
    box.append(note);
    return box;
  }

  private buildingPane(city: City): HTMLElement {
    const { game, folder } = this.host;
    const box = pane(199, 217, 231, 197);
    box.style.overflowY = 'auto';
    box.append(head('City Improvements'));
    city.improvements.forEach((has, i) => {
      const imp = game.rules.improvements[i];
      if (!has || !imp || i === 0) return;
      const row = document.createElement('div');
      row.className = 'buildingRow';
      const icon = improvementIcon(folder, i);
      icon.style.height = '13px';
      icon.style.width = '23px';
      const label = document.createElement('span');
      label.textContent = imp.name;
      row.append(icon, label);
      row.addEventListener('click', () => void this.sell(city, i));
      box.append(row);
    });
    return box;
  }

  private async sell(city: City, i: number): Promise<void> {
    const { game } = this.host;
    const imp = game.rules.improvements[i];
    if (!imp) return;
    if (i >= 39 || i < 2) {
      this.host.showPedia('improvements', i);
      return;
    }
    if (city.soldThisTurn) {
      await tell('This city has already sold an improvement this turn.', city.name);
      return;
    }
    const price = (imp.costRows ?? 0) * game.rules.cosmic.shieldBoxRows;
    if (!(await askYes(`Sell ${imp.name} for ${price} gold?`, city.name))) return;
    sellImprovement(game.rules, game.civ(city.owner), city, i);
    this.host.playSound('SELL');
    this.host.log(`${city.name} sells ${imp.name}.`);
    this.host.refresh();
  }

  private unitChip(u: Unit): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'unitChip';
    chip.title = this.host.game.rules.units[u.type]?.name ?? '';
    chip.append(unitIcon(this.host.folder, u.type, 26));
    chip.addEventListener('click', () => {
      this.host.closeCity();
      this.host.selectUnit(u);
    });
    return chip;
  }

  private supportPane(city: City, homed: Unit[]): HTMLElement {
    const box = pane(7, 215, 180, 70);
    box.append(head(`Units Supported by ${city.name}`));
    const list = document.createElement('div');
    list.className = 'cityUnits';
    for (const u of homed.slice(0, 18)) list.append(this.unitChip(u));
    box.append(list);
    return box;
  }

  private presentPane(city: City): HTMLElement {
    const box = pane(7, 307, 164, 106);
    box.append(head('Units Present'));
    const list = document.createElement('div');
    list.className = 'cityUnits';
    for (const u of this.host.world.unitsAt(city.position.x, city.position.y).slice(0, 24))
      list.append(this.unitChip(u));
    box.append(list);
    return box;
  }

  private routesPane(city: City): HTMLElement {
    const box = pane(7, 215, 180, 70);
    box.style.cssText += ';color:#fff;text-shadow:1px 1px 0 #000';
    box.append(head('Trade Routes'));
    const names = this.host.folder.rules as unknown as { commodities?: string[] };
    const partner = (id: number) => this.host.world.cities.find((c) => c.id === id)?.name ?? '?';
    for (const r of city.tradeRoutes) {
      const line = document.createElement('div');
      const goods = r.commodity === undefined ? undefined : names.commodities?.[r.commodity];
      line.textContent = `${partner(r.partner)}${goods ? `: ${goods}` : ''}`;
      box.append(line);
    }
    return box;
  }

  private buttonPane(city: City): HTMLElement {
    const box = document.createElement('div');
    box.className = 'cityButtons';
    const add = (label: string, run: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', run);
      box.append(b);
      return b;
    };
    add('Buy', () => void this.buy(city)).disabled = buyCost(this.host.game.rules, city) === null;
    add('Change', () => void this.change(city));
    add('Info', () => {
      this.info = !this.info;
      this.render();
    });
    add('Rename', () => void this.rename(city));
    add('Happy', () => {
      this.happy = !this.happy;
      this.render();
    });
    add('View', () => this.host.showCityView(city));
    add('◀ ▶', () => this.step(1));
    add('Exit', () => this.host.closeCity());
    return box;
  }

  private async rename(city: City): Promise<void> {
    const name = await askText(city.name, 'New name for this city', city.name, { maxLength: 15 });
    if (name && name.trim()) city.name = name.trim();
    this.host.refresh();
  }

  async buy(city: City): Promise<void> {
    const { game } = this.host;
    const civ = game.civ(city.owner);
    const price = buyCost(game.rules, city);
    if (price === null) return;
    const name = this.itemName(city.production);
    if (price > civ.treasury) {
      await tell(`${name} costs ${price} gold. You have ${civ.treasury}.`, city.name);
      return;
    }
    const answer = await askButtons(
      city.name,
      `Complete ${name} for ${price} gold?\nTreasury: ${civ.treasury} gold`,
      ['Yes', 'No'],
      1,
    );
    if (answer !== 0) return;
    const r = buyProduction(game.rules, civ, city);
    if (r === null) this.host.playSound('POS1');
    if (r === 'disorder') this.host.log(`${city.name} is in disorder: no units can be bought.`);
    this.host.refresh();
  }

  async change(city: City): Promise<void> {
    const { game, folder } = this.host;
    const rules = game.rules;
    const rows = game.productionContext(city).shieldRows;
    const stored = city.shieldsStored;
    const items: { kind: 'unit' | 'improvement'; index: number }[] = [];
    rules.units.forEach((_, i) => {
      if (game.canBuildUnitAt(city, i)) items.push({ kind: 'unit', index: i });
    });
    rules.improvements.forEach((_, i) => {
      if (game.canBuildImprovement(city, i)) items.push({ kind: 'improvement', index: i });
    });
    const shieldsPerTurn = () => {
      const ctx = game.cityContext(city);
      const raw = rawYields(game.world, rules, city, ctx);
      const homed = game.world.units.filter((u) => u.homeCity === city.id);
      const support = unitSupport(game.world, rules, city, ctx, homed);
      return shieldTotals(rules, city, ctx, raw.shields, support.shields).produced;
    };
    const rate = shieldsPerTurn();
    const list: ListItem[] = items.map((o) => {
      const cost =
        (o.kind === 'unit'
          ? rules.units[o.index]?.costRows
          : rules.improvements[o.index]?.costRows) ?? 0;
      const total = cost * rows;
      const turns = rate > 0 ? Math.max(1, Math.ceil((total - stored) / rate)) : 0;
      const icon = productionIcon(folder, o, 20);
      return {
        label: this.itemName(o),
        icon,
        note: `${total}${turns ? `  (${turns} turns)` : ''}`,
      };
    });
    const selected = items.findIndex(
      (o) => o.kind === city.production.kind && o.index === city.production.index,
    );
    const advice = game.adviseProduction(city);
    const name = (p: Production | null) => (p ? this.itemName(p) : 'nothing');
    const pick = await askList(
      `What shall ${city.name} build?`,
      `Military advises ${name(advice.military)}. Domestic advises ${name(advice.domestic)}.`,
      list,
      {
        ...(selected >= 0 ? { selected } : {}),
        extra: [
          {
            label: 'Help',
            run: (n) => {
              const o = items[n];
              if (o) this.host.showPedia(o.kind === 'unit' ? 'units' : 'improvements', o.index);
            },
          },
        ],
      },
    );
    if (pick === null) return;
    const chosen = items[pick];
    if (!chosen) return;
    const lost = changeProduction(rules, city, chosen, game.state.difficulty);
    this.host.log(
      `${city.name} now builds ${this.itemName(chosen)}${lost ? ` (${lost} shields lost to the change)` : ''}.`,
    );
    this.host.refresh();
  }

  /** The Auto choice: the advisors pick what the city builds. */
  async auto(city: City): Promise<void> {
    const { game } = this.host;
    const modes = ['off', 'both', 'military', 'domestic'] as const;
    const pick = await askList(
      city.name,
      'Who chooses what this city builds?',
      [
        { label: 'You' },
        { label: 'Both advisors' },
        { label: 'Military advisor' },
        { label: 'Domestic advisor' },
      ],
      { selected: Math.max(0, modes.indexOf(city.autoProduction ?? 'off')) },
    );
    if (pick === null) return;
    const v = modes[pick];
    game.setAutoProduction(city, v === 'off' || v === undefined ? null : v);
    this.host.refresh();
  }
}
