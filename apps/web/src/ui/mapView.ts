/**
 * The map window: draws only what is on screen around a camera, wraps round the world, and holds
 * the terrain and the still pieces in a picture of their own, so the selected unit can blink and
 * slide without redrawing the world. The map's own scale is the original's: eighths, 1/8 to 2.
 *
 * World pixels: a square (x, y) in game coordinates has its diamond's corner at (32x, 16y).
 */
import { SquareFlag, type City, type Point, type Unit, type World } from '@mudbrick/engine';
import { sprites } from '@mudbrick/formats';
import type { GameFolder } from '../gameFiles.js';
import { drawSquareTerrain, drawUnexploredEdges } from '../terrainCompositor.js';
import { cityStyleRow, citySizeColumn, ditherFor } from '../worldRenderer.js';

const { TILE_W, TILE_H, SPRITE_H } = sprites;
const LIFT = SPRITE_H - TILE_H;

export interface MapScene {
  world: World;
  folder: GameFolder;
  /** Whose explored squares to show; undefined shows the whole world. */
  viewer?: number;
  /** The unit waiting for orders: it blinks, so it is left out of the still picture. */
  selected: Unit | null;
  /** A city whose square is marked. */
  marked: City | null;
  grid: boolean;
  /** The square under the view cursor, in View Pieces. */
  cursor: Point | null;
  /** Show Hidden Terrain: pieces and cities stand aside. */
  hidePieces: boolean;
  /** Letter on a unit's shield. */
  orderLetter: (u: Unit) => string;
  /** Hit points left, as a share of the full bar. */
  health: (u: Unit) => number;
  /** Which unit shows on a stack. */
  topUnit: (units: Unit[]) => Unit | undefined;
  colourOf: (slot: number) => number;
}

/** Sets the sprite's shade for a civilization: bright colour from the sheet's own strip. */
function stripColour(folder: GameFolder, colour: number): string {
  const sheet = folder.sheets.CITIES;
  if (!sheet) return '#fff';
  const r = sprites.playerTextColourStrip(colour);
  const i = (r.y * sheet.pixels.width + r.x + 1) * 4;
  const d = sheet.pixels.data;
  return `rgb(${d[i] ?? 255},${d[i + 1] ?? 255},${d[i + 2] ?? 255})`;
}

export class MapView {
  /** Camera centre in world pixels. */
  cx = 0;
  cy = 0;
  /** −7 to 8: the scale is (8 + zoom) / 8. */
  zoom = 0;
  private scene: MapScene | null = null;
  private base = new OffscreenCanvas(16, 16);
  private readonly ctx: CanvasRenderingContext2D;
  private blinkOn = true;
  private slide: { unit: Unit; from: Point; to: Point; start: number; ms: number } | null = null;
  private burst: { at: Point; start: number; ms: number } | null = null;
  private frame = 0;
  private blinkTimer: number | undefined;
  private sight = new Set<number>();
  showNames = true;
  animations = true;
  /** Runs after each drawing, for the world map's frame. */
  onDraw: (() => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    new ResizeObserver(() => this.draw()).observe(canvas);
    this.blinkTimer = window.setInterval(() => {
      this.blinkOn = !this.blinkOn;
      if (this.scene?.selected && !this.slide) this.present();
    }, 330);
  }

  stop(): void {
    window.clearInterval(this.blinkTimer);
  }

  get scale(): number {
    return (8 + this.zoom) / 8;
  }

  private get dpr(): number {
    return window.devicePixelRatio || 1;
  }

  /** The screen's size in world pixels. */
  private get span(): { w: number; h: number } {
    return {
      w: this.canvas.clientWidth / this.scale,
      h: this.canvas.clientHeight / this.scale,
    };
  }

  /** What part of the world shows, for the world map's frame. */
  viewRect(): { x: number; y: number; w: number; h: number } {
    const { w, h } = this.span;
    return { x: this.cx - w / 2, y: this.cy - h / 2, w, h };
  }

  setZoom(z: number): void {
    this.zoom = Math.max(-7, Math.min(8, z));
    this.clampCamera();
    this.draw();
  }

  private clampCamera(): void {
    const world = this.scene?.world;
    if (!world) return;
    const W = world.widthX2 * 32;
    const H = (world.rows + 1) * 16;
    const { w, h } = this.span;
    this.cy = h >= H ? H / 2 : Math.max(h / 2, Math.min(H - h / 2, this.cy));
    if (world.flatEarth) this.cx = w >= W ? W / 2 : Math.max(w / 2, Math.min(W - w / 2, this.cx));
    else this.cx = ((this.cx % W) + W) % W;
  }

  centreOn(p: Point): void {
    this.cx = p.x * 32 + TILE_W / 2;
    this.cy = p.y * 16 + TILE_H / 2;
    this.clampCamera();
    this.draw();
  }

  panBy(dx: number, dy: number): void {
    this.cx += dx / this.scale;
    this.cy += dy / this.scale;
    this.clampCamera();
    this.draw();
  }

  /** Recentres when a square is off the screen or within a square of the edge. */
  keepInView(p: Point): void {
    const world = this.scene?.world;
    if (!world) return;
    const { w, h } = this.span;
    const W = world.widthX2 * 32;
    let dx = p.x * 32 + TILE_W / 2 - this.cx;
    if (!world.flatEarth) dx = ((dx + W / 2 + W) % W) - W / 2;
    const dy = p.y * 16 + TILE_H / 2 - this.cy;
    if (Math.abs(dx) > w / 2 - TILE_W || Math.abs(dy) > h / 2 - TILE_H) this.centreOn(p);
  }

  /** The square under a point on the screen, diamond-exact. */
  squareAt(clientX: number, clientY: number): Point | null {
    const world = this.scene?.world;
    if (!world) return null;
    const box = this.canvas.getBoundingClientRect();
    const { x: left, y: top } = this.viewRect();
    const wx = (clientX - box.left) / this.scale + left;
    const wy = (clientY - box.top) / this.scale + top;
    const row = Math.floor(wy / 16);
    for (const y of [row, row - 1, row + 1]) {
      if (y < 0 || y >= world.rows) continue;
      const x0 = Math.floor(wx / 32);
      for (const x of [x0, x0 - 1, x0 + 1]) {
        if (((x % 2) + 2) % 2 !== (y & 1)) continue;
        const dx = Math.abs(wx - (x * 32 + TILE_W / 2)) / (TILE_W / 2);
        const dy = Math.abs(wy - (y * 16 + TILE_H / 2)) / (TILE_H / 2);
        if (dx + dy > 1) continue;
        const W = world.widthX2;
        if (world.flatEarth) return x >= 0 && x < W ? { x, y } : null;
        return { x: ((x % W) + W) % W, y };
      }
    }
    return null;
  }

  setScene(scene: MapScene): void {
    const first = this.scene === null;
    this.scene = scene;
    if (first) this.clampCamera();
    this.draw();
  }

  /** Squares the viewer can see into now: next to their units, and round their cities. */
  private computeSight(world: World, viewer: number): void {
    this.sight.clear();
    const key = (x: number, y: number) => y * world.widthX2 + x;
    const look = (p: Point, reach: number) => {
      this.sight.add(key(p.x, p.y));
      for (let dy = -2 * reach; dy <= 2 * reach; dy++) {
        const row = p.y + dy;
        if (row < 0 || row >= world.rows) continue;
        for (let dx = -2 * reach; dx <= 2 * reach; dx++) {
          if ((dx + dy) % 2 !== 0 || Math.abs(dx) + Math.abs(dy) > 2 * reach) continue;
          const W = world.widthX2;
          const x = world.flatEarth ? p.x + dx : (p.x + dx + W) % W;
          if (x >= 0 && x < W) this.sight.add(key(x, row));
        }
      }
    };
    for (const u of world.units) if (u.owner === viewer) look(u.position, 1);
    for (const c of world.cities) if (c.owner === viewer) look(c.position, 1);
  }

  /** Enemy units are drawn on squares in sight; own units and the full map always. */
  private unitShows(world: World, viewer: number | undefined, u: Unit): boolean {
    if (viewer === undefined || u.owner === viewer) return true;
    return this.sight.has(u.position.y * world.widthX2 + u.position.x);
  }

  /** Rebuilds the still picture and shows it. */
  draw(): void {
    const scene = this.scene;
    if (!scene) return;
    const { world, folder, viewer } = scene;
    const view = this.canvas;
    const pw = Math.max(1, Math.round(view.clientWidth * this.dpr));
    const ph = Math.max(1, Math.round(view.clientHeight * this.dpr));
    if (view.width !== pw || view.height !== ph) {
      view.width = pw;
      view.height = ph;
    }
    this.clampCamera();
    const { x: left, y: top, w, h } = this.viewRect();
    const bw = Math.ceil(w) + 2;
    const bh = Math.ceil(h) + 2;
    if (this.base.width !== bw || this.base.height !== bh) this.base = new OffscreenCanvas(bw, bh);
    const g = this.base.getContext('2d');
    if (!g) return;
    const ox = Math.floor(left);
    const oy = Math.floor(top);
    this.originX = ox;
    this.originY = oy;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#000';
    g.fillRect(0, 0, bw, bh);
    if (viewer !== undefined) this.computeSight(world, viewer);

    const terrain1 = folder.sheets.TERRAIN1;
    const dither = ditherFor(folder);
    const W = world.widthX2;
    const y0 = Math.max(0, Math.floor(oy / 16) - 2);
    const y1 = Math.min(world.rows - 1, Math.ceil((oy + bh) / 16) + 2);
    const x0 = Math.floor(ox / 32) - 2;
    const x1 = Math.ceil((ox + bw) / 32) + 1;
    const wrap = (x: number) => (world.flatEarth ? x : ((x % W) + W) % W);
    const seen = (x: number, y: number): boolean => {
      if (y < 0 || y >= world.rows) return true;
      const gx = wrap(x);
      if (gx < 0 || gx >= W) return true;
      return viewer === undefined || world.isSeen(gx, y, viewer);
    };
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (((x % 2) + 2) % 2 !== (y & 1)) continue;
        const gx = wrap(x);
        if (gx < 0 || gx >= W || !seen(x, y)) continue;
        const px = x * 32 - ox;
        const py = y * 16 - oy;
        if (terrain1 && dither)
          drawSquareTerrain(g, world, gx, y, px, py, terrain1, folder.sheets.TERRAIN2, dither);
        if (dither)
          drawUnexploredEdges(
            g,
            dither,
            [!seen(x + 1, y - 1), !seen(x + 1, y + 1), !seen(x - 1, y + 1), !seen(x - 1, y - 1)],
            px,
            py,
          );
      }
    }
    if (scene.grid) this.drawGrid(g, x0, x1, y0, y1, ox, oy);

    // Back to front, so tall pieces overlap the way they stand.
    const labels: { city: City; x: number; y: number }[] = [];
    for (let y = y0; y <= (scene.hidePieces ? -1 : y1); y++) {
      for (let x = x0; x <= x1; x++) {
        if (((x % 2) + 2) % 2 !== (y & 1)) continue;
        const gx = wrap(x);
        if (gx < 0 || gx >= W || !seen(x, y)) continue;
        const px = x * 32 - ox;
        const py = y * 16 - oy - LIFT;
        this.drawBases(g, world, folder, gx, y, px, py);
        const city = world.cityAt(gx, y);
        if (city) {
          this.drawCity(g, scene, city, px, py);
          labels.push({ city, x: x * 32 + TILE_W / 2, y: y * 16 + TILE_H });
        }
        if (city) continue;
        const here = world.unitsAt(gx, y).filter((u) => this.unitShows(world, viewer, u));
        if (here.some((u) => u === scene.selected || u === this.slide?.unit)) {
          const rest = here.filter((u) => u !== scene.selected && u !== this.slide?.unit);
          const top = scene.topUnit(rest);
          if (top && rest.length > 0) this.drawUnit(g, scene, top, px, py, rest.length);
          continue;
        }
        const top = scene.topUnit(here);
        if (top) this.drawUnit(g, scene, top, px, py, here.length);
      }
    }
    this.labels = labels;
    this.present();
  }

  private originX = 0;
  private originY = 0;
  private labels: { city: City; x: number; y: number }[] = [];

  private drawGrid(
    g: OffscreenCanvasRenderingContext2D,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    ox: number,
    oy: number,
  ): void {
    g.strokeStyle = 'rgb(255 255 255 / 25%)';
    g.lineWidth = 1;
    g.beginPath();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (((x % 2) + 2) % 2 !== (y & 1)) continue;
        const px = x * 32 - ox + 0.5;
        const py = y * 16 - oy + 0.5;
        g.moveTo(px + 32, py);
        g.lineTo(px + 64, py + 16);
        g.lineTo(px + 32, py + 32);
        g.lineTo(px, py + 16);
        g.closePath();
      }
    }
    g.stroke();
  }

  /** Fortress and airbase stand behind the square's pieces. */
  private drawBases(
    g: OffscreenCanvasRenderingContext2D,
    world: World,
    folder: GameFolder,
    x: number,
    y: number,
    px: number,
    py: number,
  ): void {
    const sheet = folder.sheets.CITIES;
    if (!sheet || world.cityAt(x, y)) return;
    const put = (r: sprites.Rect) =>
      g.drawImage(sheet.canvas, r.x, r.y, r.w, r.h, px, py, r.w, r.h);
    if (world.hasFlag(x, y, SquareFlag.Airbase))
      put(world.unitsAt(x, y).length > 0 ? sprites.AIRBASE_OCCUPIED : sprites.AIRBASE_EMPTY);
    else if (world.hasFlag(x, y, SquareFlag.Fortress)) put(sprites.FORTRESS);
  }

  private drawCity(
    g: OffscreenCanvasRenderingContext2D,
    scene: MapScene,
    city: City,
    px: number,
    py: number,
  ): void {
    const { world, folder } = scene;
    const sheet = folder.sheets.CITIES;
    if (!sheet) return;
    const civ = world.civs[city.owner];
    const row = cityStyleRow(civ?.cityStyle ?? 0, civ?.epoch ?? 0);
    let col = citySizeColumn(row, city.size);
    const palace = folder.rules.improvements.find((i) => i.name === 'Palace')?.index ?? 1;
    const walls = folder.rules.improvements.find((i) => i.name === 'City Walls')?.index ?? 8;
    if (col < 3 && city.improvements[palace]) col++;
    const walled = city.improvements[walls] === true;
    const r = sprites.cityCell(row, col, walled);
    g.drawImage(sheet.canvas, r.x, r.y, r.w, r.h, px, py, r.w, r.h);
    const colour = Math.max(0, scene.colourOf(city.owner) - 1);
    const flagAt = folder.cityFlag[row]?.[col]?.[walled ? 1 : 0];
    if (flagAt) {
      const fr = sprites.flag(colour, 0);
      g.drawImage(
        sheet.canvas,
        fr.x,
        fr.y,
        fr.w,
        fr.h,
        px + flagAt.x,
        py + flagAt.y - fr.h + 5,
        fr.w,
        fr.h,
      );
    }
    const box = folder.citySize[row]?.[col]?.[walled ? 1 : 0];
    if (box) {
      const text = String(city.size);
      const width = text.length > 1 ? 14 : 10;
      g.fillStyle = stripColour(folder, colour);
      g.fillRect(px + box.x, py + box.y, width, 11);
      g.strokeStyle = '#000';
      g.lineWidth = 1;
      g.strokeRect(px + box.x + 0.5, py + box.y + 0.5, width - 1, 10);
      g.fillStyle = '#000';
      g.font = 'bold 10px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      g.fillText(text, px + box.x + width / 2, py + box.y + 9);
    }
    if (city === scene.marked) {
      g.strokeStyle = '#7fd4ff';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(px + 32, py + LIFT);
      g.lineTo(px + 64, py + LIFT + 16);
      g.lineTo(px + 32, py + LIFT + 32);
      g.lineTo(px, py + LIFT + 16);
      g.closePath();
      g.stroke();
    }
  }

  private drawUnit(
    g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    scene: MapScene,
    unit: Unit,
    px: number,
    py: number,
    stack: number,
  ): void {
    const { folder } = scene;
    const sheet = folder.sheets.UNITS;
    if (!sheet) return;
    const r = sprites.unitCell(unit.type);
    const anchor = folder.unitFlag[unit.type];
    const cities = folder.sheets.CITIES;
    if (anchor) {
      const colour = Math.max(0, scene.colourOf(unit.owner) - 1);
      const sx = px + anchor.x - 6;
      const sy = py + anchor.y - 10;
      if (stack > 1) this.drawShield(g, folder, colour, sx - 2, sy + 2, '', 1);
      g.drawImage(sheet.canvas, r.x, r.y, r.w, r.h, px, py, r.w, r.h);
      if (unit.fortified && cities) {
        const f = sprites.FORTIFIED_OVERLAY;
        g.drawImage(cities.canvas, f.x, f.y, f.w, f.h, px, py, f.w, f.h);
      }
      this.drawShield(g, folder, colour, sx, sy, scene.orderLetter(unit), scene.health(unit));
    } else {
      g.drawImage(sheet.canvas, r.x, r.y, r.w, r.h, px, py, r.w, r.h);
    }
  }

  /** The owner's shield: a health bar across the top, and the order's letter. */
  private drawShield(
    g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    folder: GameFolder,
    colour: number,
    x: number,
    y: number,
    letter: string,
    health: number,
  ): void {
    const sheet = folder.sheets.UNITS;
    const cities = folder.sheets.CITIES;
    if (!sheet || !cities) return;
    const shield = sprites.UNIT_BACK_SHIELDS[0];
    const strip = sprites.playerTextColourStrip(colour);
    g.drawImage(sheet.canvas, shield.x, shield.y, shield.w, shield.h, x, y, shield.w, shield.h);
    g.drawImage(cities.canvas, strip.x, strip.y, strip.w, strip.h, x + 1, y + 1, 10, 18);
    g.fillStyle = '#000';
    g.fillRect(x + 1, y + 1, 10, 3);
    g.fillStyle = health > 0.6 ? '#22d622' : health > 0.3 ? '#ffd700' : '#e02020';
    g.fillRect(x + 1, y + 1, Math.max(1, Math.round(10 * health)), 3);
    if (letter) {
      g.fillStyle = '#000';
      g.font = 'bold 12px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      g.fillText(letter, x + 6, y + 16);
    }
  }

  /** Shows the still picture, then what moves over it. */
  private present(): void {
    const scene = this.scene;
    if (!scene) return;
    const c = this.ctx;
    const s = this.scale * this.dpr;
    const { x: left, y: top } = this.viewRect();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = this.scale < 1;
    c.drawImage(
      this.base,
      Math.round((this.originX - left) * s),
      Math.round((this.originY - top) * s),
      Math.round(this.base.width * s),
      Math.round(this.base.height * s),
    );
    c.setTransform(s, 0, 0, s, -left * s, -top * s);
    c.imageSmoothingEnabled = false;
    const W = scene.world.widthX2 * 32;
    const place = (x: number, y: number, draw: (px: number, py: number) => void) => {
      draw(x, y);
      if (!scene.world.flatEarth) {
        draw(x - W, y);
        draw(x + W, y);
      }
    };
    if (this.slide) {
      const { unit, from, to, start, ms } = this.slide;
      const t = Math.min(1, (performance.now() - start) / ms);
      const dx = this.shortDx(from.x, to.x);
      const x = (from.x + dx * t) * 32;
      const y = (from.y + (to.y - from.y) * t) * 16 - LIFT;
      place(x, y, (px, py) => this.drawUnit(c, scene, unit, px, py, 1));
    } else if (scene.selected && this.blinkOn && !scene.hidePieces) {
      const u = scene.selected;
      place(u.position.x * 32, u.position.y * 16 - LIFT, (px, py) =>
        this.drawUnit(c, scene, u, px, py, 1),
      );
    }
    const icons = scene.folder.sheets.ICONS;
    if (scene.cursor && icons) {
      const v = sprites.VIEW_PIECE;
      place(scene.cursor.x * 32, scene.cursor.y * 16, (px, py) =>
        c.drawImage(icons.canvas, v.x, v.y, v.w, v.h, px, py, v.w, v.h),
      );
    }
    if (this.burst && icons) {
      const t = (performance.now() - this.burst.start) / this.burst.ms;
      const r = sprites.battleFrame(Math.min(7, Math.floor(t * 8)));
      const { at } = this.burst;
      place(at.x * 32 + 16, at.y * 16, (px, py) =>
        c.drawImage(icons.canvas, r.x, r.y, r.w, r.h, px, py, r.w, r.h),
      );
    }
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.showNames) this.drawLabels(scene, left, top);
    this.onDraw?.();
  }

  /** City names, in the owner's colour, drawn at screen scale so they stay readable. */
  private drawLabels(scene: MapScene, left: number, top: number): void {
    const c = this.ctx;
    const size = Math.max(10, Math.round(13 * Math.min(1.5, this.scale)));
    c.font = `bold ${size}px 'Times New Roman', Times, serif`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    for (const { city, x, y } of this.labels) {
      const sx = (x - left) * this.scale;
      const sy = (y - top) * this.scale + 1;
      c.fillStyle = '#000';
      c.fillText(city.name, sx + 1, sy + 1);
      c.fillStyle = stripColour(scene.folder, Math.max(0, scene.colourOf(city.owner) - 1));
      c.fillText(city.name, sx, sy);
    }
  }

  private shortDx(a: number, b: number): number {
    const world = this.scene?.world;
    let d = b - a;
    if (world && !world.flatEarth) {
      const W = world.widthX2;
      if (d > W / 2) d -= W;
      if (d < -W / 2) d += W;
    }
    return d;
  }

  private animate(until: () => boolean, done: () => void): void {
    this.frame += 1;
    const id = this.frame;
    const step = () => {
      if (id !== this.frame) return;
      this.present();
      if (until()) done();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** A unit sliding one step. Resolves when it arrives. */
  slideUnit(unit: Unit, from: Point, to: Point, ms = 110): Promise<void> {
    return new Promise((resolve) => {
      if (document.hidden || !this.animations) {
        resolve();
        return;
      }
      this.slide = { unit, from, to, start: performance.now(), ms };
      this.draw();
      this.animate(
        () => performance.now() - (this.slide?.start ?? 0) >= ms,
        () => {
          this.slide = null;
          this.draw();
          resolve();
        },
      );
    });
  }

  /** The eight frames of a fight on a square. */
  explode(at: Point, ms = 480): Promise<void> {
    return new Promise((resolve) => {
      if (document.hidden || !this.animations) {
        resolve();
        return;
      }
      this.burst = { at, start: performance.now(), ms };
      this.animate(
        () => performance.now() - (this.burst?.start ?? 0) >= ms,
        () => {
          this.burst = null;
          this.present();
          resolve();
        },
      );
    });
  }
}

/** The world map: land, sea, cities and units in the viewer's sight, and the screen's frame. */
export function drawMinimap(
  canvas: HTMLCanvasElement,
  world: World,
  viewer: number | undefined,
  view: { x: number; y: number; w: number; h: number },
  colourOf: (slot: number) => string,
): void {
  const W = world.widthX2;
  const H = world.rows;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const g = canvas.getContext('2d');
  if (!g) return;
  const img = g.createImageData(W, H);
  const put = (x: number, y: number, r: number, gr: number, b: number) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = (y * W + x) * 4;
    img.data[i] = r;
    img.data[i + 1] = gr;
    img.data[i + 2] = b;
    img.data[i + 3] = 255;
  };
  for (let y = 0; y < H; y++) {
    for (let x = y & 1; x < W; x += 2) {
      const seen = viewer === undefined || world.isSeen(x, y, viewer);
      const ocean = world.terrainAt(x, y) === 10;
      const [r, gr, b] = !seen ? [0, 0, 0] : ocean ? [0, 32, 140] : [36, 124, 44];
      put(x, y, r, gr, b);
      put((x + 1) % W, y, r, gr, b);
      if (y + 1 < H) {
        put(x, y + 1, r, gr, b);
        put((x + 1) % W, y + 1, r, gr, b);
      }
    }
  }
  g.putImageData(img, 0, 0);
  const dot = (p: Point, colour: string, size: number) => {
    g.fillStyle = colour;
    g.fillRect(p.x - size / 2, p.y - size / 2, size, size);
  };
  const reach = Math.max(2, Math.round(W / 60));
  for (const c of world.cities) {
    if (viewer !== undefined && !world.isSeen(c.position.x, c.position.y, viewer)) continue;
    dot(c.position, colourOf(c.owner), reach + 1);
  }
  for (const u of world.units) {
    if (viewer !== undefined && u.owner !== viewer) continue;
    dot(u.position, colourOf(u.owner), reach);
  }
  g.strokeStyle = '#fff';
  g.lineWidth = Math.max(1, W / 200);
  const x = view.x / 32;
  const y = view.y / 16;
  const w = view.w / 32;
  const h = view.h / 16;
  g.strokeRect(x, y, w, h);
  if (!world.flatEarth) {
    g.strokeRect(x - W, y, w, h);
    g.strokeRect(x + W, y, w, h);
  }
}
