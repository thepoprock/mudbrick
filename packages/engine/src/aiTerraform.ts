/**
 * The computer's terrain work: what a city asks for and what a settler does where it stands.
 *
 * Ported from the city turn's terraform-task routine (0x004bc284) with its road-link finder
 * (0x004bbe2e), and from the move handler's worker rules (0x004f44cc, the block after the
 * settle rule): pollution, the chokepoint fortress, irrigation or a mine on a worthwhile square,
 * roads and railroads, stepping to a neighbour worth improving, and the wanted worker's duties
 * around its home city. VERIFIED unless marked INFERRED. docs/engine/ai-units.md ("Workers").
 */
import { addGoal, addObjective, objectiveAt, removeGoals, type CivStrategy } from './aiStrategy.js';
import { distance, gridDistance } from './city.js';
import { hasTreaty, TREATY } from './diplomacy.js';
import { planningBoard, gotoDirection } from './pathfinding.js';
import { DOMAIN_GROUND, IMPROVEMENT, type EngineRules } from './rules.js';
import { canOrder, doWork, ORDER, type WorkContext } from './terraform.js';
import { specialAt } from './terrainSpecials.js';
import {
  NEIGHBOUR_OFFSETS,
  OCEAN,
  SquareFlag,
  type City,
  type Point,
  type Unit,
  type World,
} from './world.js';

/** The AI role of a wanted worker; objectives of this type ask for terrain work. */
export const WORK_ROLE = 21;
const BRIDGE_BUILDING = 7;
const CONSTRUCTION = 18;
const RAILROAD = 67;
const REFRIGERATION = 70;

function landmassAt(world: World, p: Point): number {
  return (world.landmass[world.index(p.x, p.y)] ?? 0) & 63;
}

/** Walk the go-to path from one city toward another (a ground unit of the owner). */
function walkPath(
  world: World,
  rules: EngineRules,
  owner: number,
  from: Point,
  to: Point,
  visit: (p: Point) => boolean,
): void {
  const groundType = rules.units.findIndex((t) => t.domain === DOMAIN_GROUND && t.move > 0);
  if (groundType < 0) return;
  const walker: Unit = {
    id: -1,
    position: { x: from.x, y: from.y },
    owner,
    type: groundType,
    veteran: false,
    hitPointsLost: 0,
    movesSpent: 0,
    fortified: false,
    homeCity: null,
    order: null,
    workCounter: 0,
    gotoTarget: null,
    lastDirection: null,
    gotoSteps: 0,
  };
  const board = planningBoard(world, rules, walker, true);
  for (let steps = 0; steps < 50; steps++) {
    const dir = gotoDirection(world, rules, walker, to, { board });
    if (dir === null) return;
    const off = NEIGHBOUR_OFFSETS[dir];
    if (!off) return;
    const y = walker.position.y + off.y;
    const x = y >= 0 && y < world.rows ? world.wrapX(walker.position.x + off.x, y) : null;
    if (x === null) return;
    walker.position = { x, y };
    if (x === to.x && y === to.y) return;
    if (!visit({ x, y })) return;
  }
}

/**
 * The first missing link on the road (or railroad, once known) between this city and another
 * of the owner's on the same land mass within 22 squares — then of a civilization at peace or
 * allied (0x004bbe2e). Needs at least two own cities on the land mass.
 */
export function roadLinkTask(
  world: World,
  rules: EngineRules,
  city: City,
  knows: (advance: number) => boolean,
): Point | null {
  const lm = landmassAt(world, city.position);
  const own = world.cities.filter(
    (c) => c.owner === city.owner && landmassAt(world, c.position) === lm,
  );
  if (own.length < 2) return null;
  const rail = knows(RAILROAD);
  const bridge = knows(BRIDGE_BUILDING);
  for (let pass = 0; pass < 2; pass++) {
    for (const other of world.cities) {
      if (other === city || landmassAt(world, other.position) !== lm) continue;
      const friendly =
        other.owner === city.owner ||
        (pass === 1 && hasTreaty(world, city.owner, other.owner, TREATY.peace | TREATY.alliance));
      if (!friendly) continue;
      if (gridDistance(world, other.position, city.position) >= 23) continue;
      const hit: { p: Point | null } = { p: null };
      walkPath(world, rules, city.owner, city.position, other.position, (p) => {
        if (world.cityAt(p.x, p.y)) return true;
        const road = world.hasFlag(p.x, p.y, SquareFlag.Road);
        const river = world.hasFlag(p.x, p.y, SquareFlag.River);
        if (!road) {
          if (river && !bridge) return true;
          hit.p = p;
          return false;
        }
        if (!world.hasFlag(p.x, p.y, SquareFlag.Railroad) && rail) {
          hit.p = p;
          return false;
        }
        return true;
      });
      const found = hit.p;
      if (found) {
        const owner = world.territory[world.index(found.x, found.y)] ?? 0;
        const foreign = world.unitsAt(found.x, found.y).some((u) => u.owner !== city.owner);
        // INFERRED: the two owner tests (0x005592c4, 0x0055930c) read as the territory owner and
        // a unit's owner on the square.
        if ((owner === 0 || owner === city.owner) && !foreign) return found;
      }
    }
  }
  return null;
}

/**
 * The city turn's terraform tasks (0x004bc284): a work objective (priority 6) on every polluted
 * square of the radius, else the first missing road or railroad link toward another city
 * (priority 2 for a road, 5 for a railroad, +1 for size above 4, +1 with the Palace, −1 for
 * size below 4). The city remembers whether it has a task (flag bit 19).
 */
export function terraformTasks(
  world: World,
  rules: EngineRules,
  city: City,
  strategy: CivStrategy,
  knows: (advance: number) => boolean,
): void {
  let found = false;
  for (let i = 0; i < 20; i++) {
    const q = world.radiusSquare(city.position.x, city.position.y, i);
    if (!q || !world.hasFlag(q.x, q.y, SquareFlag.Pollution)) continue;
    addObjective(strategy, { x: q.x, y: q.y, type: WORK_ROLE, priority: 6 });
    found = true;
  }
  if (found) {
    city.terraformTask = true;
    return;
  }
  // INFERRED: the priority scratch global starts each call below 4.
  let priority = 0;
  let task: Point | null = null;
  if (knows(RAILROAD)) {
    priority = 3;
    task = roadLinkTask(world, rules, city, knows);
    if (!task) {
      city.terraformTask = false;
      return;
    }
  }
  priority += 2;
  if (!task) {
    priority = 2;
    task = roadLinkTask(world, rules, city, knows);
  }
  if (!task) {
    city.terraformTask = false;
    return;
  }
  if (priority > 2) {
    if (city.size > 4) priority += 1;
    if (city.improvements[IMPROVEMENT.palace]) priority += 1;
  }
  if (city.size < 4) priority -= 1;
  addObjective(strategy, { x: task.x, y: task.y, type: WORK_ROLE, priority });
  city.terraformTask = true;
}

/**
 * Whether the computer would irrigate (1) or mine (2) a square (0x00558029): no city, no mine,
 * no irrigation unless Refrigeration is known; irrigation needs water (the square or a
 * neighbour across a corner holding ocean, a river or irrigation), a result terrain and an AI
 * government level at or below the owner's; a mine needs the same without irrigation present.
 */
export function aiImprovement(
  world: World,
  rules: EngineRules,
  p: Point,
  government: number,
  knows: (advance: number) => boolean,
): number {
  if (world.cityAt(p.x, p.y)) return 0;
  if (world.hasFlag(p.x, p.y, SquareFlag.Mine)) return 0;
  const irrigated = world.hasFlag(p.x, p.y, SquareFlag.Irrigation);
  if (irrigated && !knows(REFRIGERATION)) return 0;
  const row = rules.terrain[world.terrainAt(p.x, p.y)];
  if (!row) return 0;
  for (let c = 0; c < 2; c++) {
    if (c === 0) {
      if (!waterFor(world, p)) return 0;
    } else if (irrigated) return 0;
    const change = c === 0 ? row.irrigate : row.mine;
    const level = (c === 0 ? row.irrigateAiGovt : row.mineAiGovt) ?? 0;
    if (change.kind !== 'no' && level !== 0 && level <= government) return c + 1;
  }
  return 0;
}

/** Water for irrigation (0x005359ed): the square or its four corner neighbours hold ocean, a river or irrigation. */
export function waterFor(world: World, p: Point): boolean {
  const offs = [
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: -1 },
    { x: 0, y: 0 },
  ];
  for (const o of offs) {
    const y = p.y + o.y;
    if (y < 0 || y >= world.rows) continue;
    const x = world.wrapX(p.x + o.x, y);
    if (x === null) continue;
    if (world.terrainAt(x, y) === OCEAN) return true;
    if (world.hasFlag(x, y, SquareFlag.River)) return true;
    if (world.hasFlag(x, y, SquareFlag.Irrigation)) return true;
  }
  return false;
}

export interface WorkerContext extends WorkContext {
  turn: number;
  government: number;
  strategy?: CivStrategy;
  /** The owner's tribe's expand personality (unused for now; the go-to keep rule is the dispatcher's). */
  isHuman: boolean;
}

export interface WorkerSurroundings {
  nearestOwn: City | null;
  ownDist: number;
  nearestAny: City | null;
  anyDist: number;
}

export type WorkerVerdict =
  | { kind: 'none' }
  | { kind: 'worked'; order: number }
  | { kind: 'goto'; target: Point; tag: string }
  | { kind: 'step'; target: Point };

/** A foreign unit not allied next to the square (0x0055629a). */
function foreignNotAlliedAdjacent(world: World, p: Point, me: number): boolean {
  for (const off of NEIGHBOUR_OFFSETS) {
    const y = p.y + off.y;
    if (y < 0 || y >= world.rows) continue;
    const x = world.wrapX(p.x + off.x, y);
    if (x === null) continue;
    for (const u of world.unitsAt(x, y)) {
      if (u.owner !== me && !hasTreaty(world, me, u.owner, TREATY.alliance)) return true;
    }
  }
  return false;
}

/** The chokepoint test (the handler's fortress rule): 1 a road square near a city, 2 an isthmus. */
export function chokepoint(
  world: World,
  unit: Unit,
  s: WorkerSurroundings,
  ctx: WorkerContext,
  settlerType: boolean,
  role: number,
): number {
  if (!(settlerType || role === 1) || !ctx.knows(CONSTRUCTION)) return 0;
  const here = unit.position;
  if (
    s.ownDist === 0 ||
    s.nearestOwn !== s.nearestAny ||
    world.hasFlag(here.x, here.y, SquareFlag.Fortress) ||
    world.terrainAt(here.x, here.y) === OCEAN
  )
    return 0;
  const fortressAlone = (x: number, y: number) =>
    world.hasFlag(x, y, SquareFlag.Fortress) && !world.cityAt(x, y);
  let oceans = 0;
  let n = 0;
  let sth = 0;
  let w = 0;
  let e = 0;
  for (const off of NEIGHBOUR_OFFSETS) {
    const y = here.y + off.y;
    if (y < 0 || y >= world.rows) continue;
    const x = world.wrapX(here.x + off.x, y);
    if (x === null) continue;
    if (fortressAlone(x, y) || world.cityAt(x, y)) return 0;
    if (world.terrainAt(x, y) === OCEAN) {
      oceans += 1;
      if (oceans > 3) return 0;
      if (off.y < 0) n = 1;
      if (off.y > 0) sth = 1;
      if (off.x < 0) w = 1;
      if (off.x > 0) e = 1;
    }
    if (ctx.strategy && objectiveAt(ctx.strategy, { x, y }, 1)) return 0;
  }
  let choke = 0;
  if (
    world.hasFlag(here.x, here.y, SquareFlag.Road) &&
    s.ownDist > 1 &&
    s.ownDist < 4 &&
    s.nearestOwn === s.nearestAny
  )
    choke = 1;
  // Squares two rows or two columns away; the original's loop also visits the off-parity
  // positions between them, which are not squares (INFERRED: it reads them as nothing).
  const blocked = (x: number | null, y: number) =>
    x !== null && world.isSquare(x, y) && (world.terrainAt(x, y) === OCEAN || fortressAlone(x, y));
  for (let dx = -2; dx <= 2; dx++) {
    if (n === 0 && blocked(world.wrapX(here.x + dx, here.y - 2), here.y - 2)) n = 2;
    if (sth === 0 && blocked(world.wrapX(here.x + dx, here.y + 2), here.y + 2)) sth = 2;
  }
  for (let dy = -2; dy <= 2; dy++) {
    if (w === 0 && blocked(world.wrapX(here.x - 2, here.y + dy), here.y + dy)) w = 2;
    if (e === 0 && blocked(world.wrapX(here.x + 2, here.y + dy), here.y + dy)) e = 2;
  }
  if (sth + n > 1 && (w === 0 || e === 0)) choke = 2;
  if (e + w > 1 && (n === 0 || sth === 0)) choke = 2;
  if (choke !== 0 && ctx.strategy) {
    if (settlerType) addGoal(ctx.strategy, { x: here.x, y: here.y, type: 1, priority: 2 });
    else
      addGoal(ctx.strategy, {
        x: here.x,
        y: here.y,
        type: WORK_ROLE,
        priority: (s.ownDist < 4 ? 1 : 0) + choke,
      });
  }
  return choke;
}

/**
 * The worker rules of the move handler for a settler-type unit on a square without a city
 * (VERIFIED order): a defender goal when alone; pollution; the isthmus fortress; on a square
 * holding a work objective or within two of a city whose size suits the terrain, irrigation or a
 * mine (0x00558029) else a road (where something is already built or on desert, plains and
 * grassland) or a railroad (specials, mines, two-shield terrain); the fortress for any
 * chokepoint; a step to a neighbour worth improving when next to a city; a road near a city on
 * the three field terrains. Then, for a wanted worker: home when more than four away, a road,
 * retreat from enemies, irrigation or a mine by the rules' AI priority, pollution, railroads,
 * and a go-to to the first radius square of the nearest city that wants work.
 */
export function workerRules(
  world: World,
  rules: EngineRules,
  unit: Unit,
  s: WorkerSurroundings,
  ctx: WorkerContext,
): WorkerVerdict {
  const here = unit.position;
  const me = unit.owner;
  const type = rules.units[unit.type];
  if (!type) return { kind: 'none' };
  const settlerType = type.role === 5;
  const wanted = unit.wanted === true;
  const role = wanted ? WORK_ROLE : type.role;
  if (world.cityAt(here.x, here.y)) return { kind: 'none' };
  const lm = landmassAt(world, here);
  const flags = (p: Point) => world.flags[world.index(p.x, p.y)] ?? 0;
  const f = flags(here);
  const road = (f & SquareFlag.Road) !== 0;
  const rail = (f & SquareFlag.Railroad) !== 0;
  const river = (f & SquareFlag.River) !== 0;
  const bridge = ctx.knows(BRIDGE_BUILDING);
  const terrain = world.terrainAt(here.x, here.y);
  const row = rules.terrain[terrain];
  const stack = world.unitsAt(here.x, here.y).filter((u) => u.owner === me).length;
  const tryWork = (order: number): WorkerVerdict | null => {
    if (!canOrder(world, rules, unit, order, ctx).ok) return null;
    doWork(world, rules, unit, order, ctx);
    return { kind: 'worked', order };
  };

  if (settlerType) {
    // A lone settler outside a city asks for a defender; work goals here are consumed.
    let covered = stack > 1;
    if (!covered) {
      for (const off of NEIGHBOUR_OFFSETS) {
        const y = here.y + off.y;
        if (y < 0 || y >= world.rows) continue;
        const x = world.wrapX(here.x + off.x, y);
        if (x !== null && world.unitsAt(x, y).length > 0) covered = true;
      }
    }
    if (ctx.strategy) {
      if (!covered) addObjective(ctx.strategy, { x: here.x, y: here.y, type: 1, priority: 2 });
      removeGoals(world, ctx.strategy, WORK_ROLE, here, 0);
    }
    if ((f & SquareFlag.Pollution) !== 0) {
      const v = tryWork(ORDER.pollution);
      if (v) return v;
    }
    const choke = chokepoint(world, unit, s, ctx, settlerType, role);
    const safe = !foreignNotAlliedAdjacent(world, here, me) || stack > 1;
    if (choke === 2 && !ctx.isHuman && safe) {
      const v = tryWork(ORDER.fortress);
      if (v) return v;
    }
    let want = 0;
    if (ctx.strategy && objectiveAt(ctx.strategy, here, WORK_ROLE)) want = 1;
    const nearFlagged = s.nearestOwn?.workerNearby === true;
    if (s.ownDist > 2 || !nearFlagged || wanted || unit.order !== ORDER.goTo) {
      const plan = ctx.strategy?.plans[lm] ?? 5;
      const sizeFits =
        s.nearestOwn !== null &&
        row !== undefined &&
        Math.trunc(row.irrigateTurns / 5) * 3 - 3 <= s.nearestOwn.size;
      const special = specialAt(world, here.x, here.y) !== 0;
      if (
        s.ownDist !== 0 &&
        s.ownDist < 3 &&
        (sizeFits || special) &&
        (aiImprovement(world, rules, here, ctx.government, ctx.knows) !== 0 || plan === 4)
      )
        want |= 2;
      if (want !== 0) {
        if ((want & 2) !== 0) {
          const r = aiImprovement(world, rules, here, ctx.government, ctx.knows);
          if (r === 1) {
            const v = tryWork(ORDER.irrigation);
            if (v) return v;
          }
          if (r === 2) {
            const v = tryWork(ORDER.mine);
            if (v) return v;
          }
        }
        const built = (f & (SquareFlag.Irrigation | SquareFlag.Mine)) !== 0;
        if (!road || rail) {
          if (!road && (!river || bridge)) {
            let w = want & 1;
            if (built && (river || terrain < 3)) w |= 2;
            if (w !== 0) {
              const v = tryWork(ORDER.road);
              if (v) return v;
            }
          }
        } else if (ctx.knows(RAILROAD)) {
          let w = want & 1;
          if (special) w |= 2;
          if ((f & SquareFlag.Mine) !== 0) w |= 2;
          if ((row?.shields ?? 0) > 1) w |= 2;
          if (w !== 0) {
            const v = tryWork(ORDER.road);
            if (v) return v;
          }
        }
      }
      if (choke !== 0 && !ctx.isHuman && safe) {
        const v = tryWork(ORDER.fortress);
        if (v) return v;
      }
      if (s.ownDist < 2 && s.nearestOwn) {
        for (let i = 0; i < 8; i++) {
          const d = (ctx.turn + i) & 7;
          const off = NEIGHBOUR_OFFSETS[d];
          if (!off) continue;
          const y = here.y + off.y;
          if (y < 0 || y >= world.rows) continue;
          const x = world.wrapX(here.x + off.x, y);
          if (x === null || world.cityAt(x, y)) continue;
          const there = world.unitsAt(x, y);
          if (there.some((u) => u.owner !== me)) continue;
          if (there.some((u) => rules.units[u.type]?.role === 5)) continue;
          if (aiImprovement(world, rules, { x, y }, ctx.government, ctx.knows) === 0) continue;
          const trow = rules.terrain[world.terrainAt(x, y)];
          const fits =
            trow !== undefined && Math.trunc(trow.irrigateTurns / 5) * 3 - 3 <= s.nearestOwn.size;
          if (!(fits || specialAt(world, x, y) !== 0)) continue;
          if (distance(world, here, { x, y }) >= 3) continue;
          return { kind: 'step', target: { x, y } };
        }
      }
      if (!road && (!river || bridge) && s.ownDist < 3 && terrain < 3) {
        const v = tryWork(ORDER.road);
        if (v) return v;
      }
    }
  }

  if (role === WORK_ROLE && s.ownDist !== 0) {
    let home: City | null =
      unit.homeCity !== null
        ? (world.cities.find((c) => c.id === unit.homeCity) ?? s.nearestOwn)
        : s.nearestOwn;
    if (home && landmassAt(world, home.position) !== lm) home = s.nearestOwn;
    if (home && distance(world, here, home.position) > 4)
      return { kind: 'goto', target: home.position, tag: 'home' };
    if (!road && (!river || bridge)) {
      const v = tryWork(ORDER.road);
      if (v) return v;
    }
    if (s.nearestOwn && foreignNotAlliedAdjacent(world, here, me))
      return { kind: 'goto', target: s.nearestOwn.position, tag: 'retreat' };
    if (s.ownDist < 3 && s.nearestOwn) {
      const bare = (f & (SquareFlag.Irrigation | SquareFlag.Mine)) === 0;
      if (bare && row) {
        if ((row.mineAiGovt ?? 0) !== 0 && (row.mineAiGovt ?? 0) < (row.irrigateAiGovt ?? 0)) {
          const v = tryWork(ORDER.mine);
          if (v) return v;
        }
        if ((row.irrigateAiGovt ?? 0) !== 0) {
          const v = tryWork(ORDER.irrigation);
          if (v) return v;
        }
      }
      if ((f & SquareFlag.Pollution) !== 0) {
        const v = tryWork(ORDER.pollution);
        if (v) return v;
      }
      if (!rail && ctx.knows(RAILROAD)) {
        const v = tryWork(ORDER.road);
        if (v) return v;
      }
      const c = s.nearestOwn;
      for (let i = 0; i < 20; i++) {
        const q = world.radiusSquare(c.position.x, c.position.y, i);
        if (!q) continue;
        // INFERRED: the original would order a go-to onto the sea and fail; the engine skips water.
        if (world.terrainAt(q.x, q.y) === OCEAN) continue;
        if (world.cityAt(q.x, q.y)) continue;
        const qf = flags(q);
        const qrow = rules.terrain[world.terrainAt(q.x, q.y)];
        if ((qf & (SquareFlag.Irrigation | SquareFlag.Mine)) === 0 && qrow) {
          if ((qrow.mineAiGovt ?? 0) !== 0 && (qrow.mineAiGovt ?? 0) < (qrow.irrigateAiGovt ?? 0))
            return { kind: 'goto', target: q, tag: 'mine' };
          if ((qrow.irrigateAiGovt ?? 0) !== 0) return { kind: 'goto', target: q, tag: 'irrigate' };
        }
        const qriver = (qf & SquareFlag.River) !== 0;
        const qroad = (qf & SquareFlag.Road) !== 0;
        const qrail = (qf & SquareFlag.Railroad) !== 0;
        if ((!qriver || bridge) && (!qroad || (!qrail && ctx.knows(RAILROAD))))
          return { kind: 'goto', target: q, tag: 'road' };
      }
    } else if (!rail && ctx.knows(RAILROAD)) {
      const v = tryWork(ORDER.road);
      if (v) return v;
    }
  }
  return { kind: 'none' };
}
