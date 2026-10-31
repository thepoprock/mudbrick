/**
 * A city's supplied and demanded commodities.
 *
 * Ported from the original's recompute routine (0x0042c44f, 8 KB): sixteen supply scores and
 * sixteen demand scores from the terrain, rivers and roads of the city radius, the city's
 * size, its civilization's advances, improvements, land mass and position; a commodity is
 * either supplied or demanded; the three best of each are kept, a position-hashed commodity
 * overrides the middle entry of each list, and entries carried by routes or caravans are
 * negated. VERIFIED unless marked INFERRED. docs/engine/rules-trade.md.
 */
import { landmassStats } from './aiStrategy.js';
import { IMPROVEMENT, type EngineRules } from './rules.js';
import { specialAt } from './terrainSpecials.js';
import { suppliedOf, demandedOf, refreshCommodityUse } from './trade.js';
import { SquareFlag, type City, type World } from './world.js';

const ADV = {
  automobile: 5,
  chemistry: 10,
  combustion: 14,
  computers: 16,
  economics: 22,
  electricity: 23,
  industrialization: 37,
  ironWorking: 39,
  massProduction: 48,
  nuclearFission: 58,
  pottery: 65,
  refrigeration: 70,
};
const TRIBE_FRENCH = 9;
const TRIBE_AZTECS = 10;
const TRIBE_CHINESE = 11;
const TRIBE_SPANISH = 17;

export interface SupplyDemandContext {
  turn: number;
  knows: (slot: number, advance: number) => boolean;
  ownsWonder: (slot: number, improvement: number) => boolean;
  /** Advances discovered by the owner (research-cost count). */
  advancesOf: (slot: number) => number;
  tribeOf: (slot: number) => number | null;
  /** Someone in the world knows Combustion (the oil supply stays an eighth until then). */
  combustionKnown: boolean;
}

/** The original recomputes every sixteenth turn by city index, or when the city is flagged. */
export function supplyDemandDue(turn: number, city: City): boolean {
  return city.recomputeTrade === true || ((turn + city.id) & 15) === 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
/** The original's shift helper (0x0055090c): left by n, or right by −n. */
function shift(v: number, n: number): number {
  return n > 0 ? v << n : n < 0 ? v >> -n : v;
}
/** Stable bubble sort ascending with a parallel index array (0x0040c752). */
function sortWithIndex(values: number[]): number[] {
  const idx = values.map((_, i) => i);
  let swapped = true;
  while (swapped) {
    swapped = false;
    for (let i = 0; i < values.length - 1 && !swapped; i++) {
      const a = values[i] ?? 0;
      const b = values[i + 1] ?? 0;
      if (b < a) {
        values[i] = b;
        values[i + 1] = a;
        const t = idx[i] ?? 0;
        idx[i] = idx[i + 1] ?? 0;
        idx[i + 1] = t;
        swapped = true;
      }
    }
  }
  return idx;
}
/** The three best commodities with a non-negative score, from the top down. */
function topThree(values: number[]): number[] {
  const idx = sortWithIndex(values);
  const out: number[] = [];
  let b = 15;
  for (let k = 0; k < 3; k++) {
    let pick = -1;
    do {
      pick = b >= 0 ? (idx[b] ?? -1) : -1;
      const v = b >= 0 ? (values[b] ?? -1) : 0;
      b -= 1;
      if (v >= 0 || b < 0) break;
    } while (b >= 0);
    out.push(pick);
  }
  return out;
}

export function computeSupplyDemand(
  world: World,
  rules: EngineRules,
  city: City,
  ctx: SupplyDemandContext,
): void {
  city.recomputeTrade = false;
  const slot = city.owner;
  const cx = city.position.x;
  const cy = city.position.y;
  const rows = world.rows;
  const width = world.widthX2;
  const lm = (world.landmass[world.index(cx, cy)] ?? 0) & 63;
  const land = landmassStats(world, rules).land[lm] ?? 0;
  const sz5 = Math.trunc((city.size + 2) / 5);
  const adv = ctx.advancesOf(slot);
  const size = city.size;
  const tribe = ctx.tribeOf(slot);
  const knows = (a: number) => ctx.knows(slot, a);
  const has = (i: number) => city.improvements[i] === true;
  const dy = cy - (rows >> 1);
  const dx = cx - (width >> 1);
  const lat = Math.abs(dy);
  const lon = Math.abs(dx);
  const south = dy > 0;
  const east = Math.max(0, dx);

  // Terrain in the city radius, specials counting three more; rivers and roads.
  const n = Array<number>(11).fill(0);
  let rv = 0;
  let rd = 0;
  for (let i = 0; i < 21; i++) {
    const q = world.radiusSquare(cx, cy, i);
    if (!q) continue;
    const t = world.terrainAt(q.x, q.y);
    n[t] = (n[t] ?? 0) + 1;
    if (specialAt(world, q.x, q.y) !== 0) n[t] = (n[t] ?? 0) + 3;
    if (world.hasFlag(q.x, q.y, SquareFlag.River)) rv += 1;
    if (world.hasFlag(q.x, q.y, SquareFlag.Road)) rd += 1;
  }
  n[6] = (n[6] ?? 0) + (n[7] ?? 0);
  n[7] = 0;
  const N = (t: number) => n[t] ?? 0;

  const s = Array<number>(16).fill(0);
  const d = Array<number>(16).fill(0);

  // Supply.
  let v = N(9) * 3 + N(6) * 6 + N(3) * 4 + rv * 3;
  if (adv < 16) v *= 2;
  if (adv < 24) v <<= 1;
  if (adv < 49) {
    if (size < 3) v <<= 1;
  } else v = Math.trunc(v / 2);
  if (size > 7) v = Math.trunc(v / 2);
  s[0] = v;
  s[1] =
    (Math.trunc(rv / 2) + N(4) * 2 + N(2)) * (lat > Math.trunc(rows / 3) ? N(6) + 3 : N(6) + 2);
  v = N(10) * 8 - lat;
  if (size > 9) v >>= 1;
  if (adv > 32) v >>= 1;
  s[2] = v;
  v = (N(1) * 3 + N(0) - rv) * clamp(Math.trunc(adv / 10), 1, 2);
  if (knows(ADV.industrialization)) v = (v * 3) >> 1;
  if (adv < 8) v >>= 1;
  if (adv < 16) v >>= 1;
  s[3] = v;
  v = N(10) * 3 + N(0) * 4 + N(8) * 2 - Math.trunc(adv / 6);
  if (!knows(ADV.pottery)) v = Math.trunc(v / 3);
  if (has(IMPROVEMENT.aqueduct)) v += v >> 1;
  if ((lm & 1) !== 0 && lm < 6) v += v >> 1;
  s[4] = v;
  v = (N(9) + N(1) + N(3) + N(8) + 1) * N(4) * 5;
  v = shift(v, Math.min(Math.trunc(sz5 / 2), 2) - 1);
  if ((lm & 1) !== 0 && lm > 1) v += v >> 1;
  if (adv < 20) v >>= 1;
  s[5] = v;
  v = N(4) * 5 + N(5) * 5;
  if (lm !== 0 && (lm & 1) === 0) v *= 2;
  s[6] = v;
  const dye = N(2) * 5 - N(1) + rv;
  s[7] = lm !== 0 && (lm & 3) === 0 ? dye * 4 : dye * 2;
  const wa = clamp(rv * 5 - N(2), 0, N(1) * 4);
  const wb = clamp(N(1) * 4, 0, wa);
  v = wb + Math.trunc(((width >> 1) - lon) / 2) + wa;
  if (south) v >>= 1;
  v = shift(v, clamp(sz5 - 1, -2, 1));
  if (((lm - 2) & 3) === 0) v += v >> 1;
  if (tribe === TRIBE_FRENCH) v <<= 1;
  if (size > 10) v >>= 1;
  s[8] = v;
  v = (N(3) * 2 + N(9) + 1) * (N(4) + 1);
  if (v !== 0) {
    v += east * 2;
    if (lm !== 0 && lm % 5 === 0) v *= 2;
  }
  if (tribe === TRIBE_CHINESE) v <<= 1;
  s[9] = v;
  v = N(5) * 8;
  if (v !== 0) {
    v += N(4) + lon;
    if (!knows(ADV.ironWorking)) v >>= 1;
    if (lm > 8) v += v >> 1;
    if (size < 5) v >>= 1;
  }
  s[10] = v;
  if (tribe === TRIBE_AZTECS) s[9] = (s[9] ?? 0) << 1;
  v = (N(0) * 2 + N(8) * 2 + N(9) * 3) * Math.trunc((N(10) + rv) / 2);
  if (v !== 0) {
    if (lat < 10) v *= 2;
    v -= lat;
    if (land < 26) v += v >> 1;
    if (land > 300) v >>= 1;
    if (lm === 1) v >>= 1;
  }
  s[11] = v;
  v = (N(5) + 1) * (N(8) + 1) * (N(0) + 1) + N(1);
  if (v !== 0) {
    v = Math.trunc((clamp(sz5, 1, 4) * v) / 2);
    if (lm === 7) v += v >> 1;
  }
  s[12] = v;
  v = (N(5) + Math.trunc(N(4) / 2) + 1) * (rv + 2);
  if (N(5) > 2) v *= 2;
  if (size > 4) v <<= 1;
  if (size > 9) v <<= 1;
  s[13] = v;
  v = N(8) * 6 + N(6) * 8 + N(7) * 12 + N(0) * 10;
  if (!ctx.combustionKnown) v >>= 3;
  if (v === 0) v = -1;
  else {
    if (lm === 17) v *= 3;
    else if (lm > 1 && ((lm - 1) & 7) === 0) v += v >> 1;
    v *= clamp(Math.trunc(sz5 / 2) - 2, 1, 2);
  }
  s[14] = v;
  v = (N(6) + N(0) + 1) * (N(4) + rv + 1) * (N(5) + 1);
  if (!knows(ADV.nuclearFission)) v = 0;
  if (v === 0) v = -1;
  else {
    if (lm !== 0 && lm % 10 === 0) v += v >> 1;
    v = Math.trunc((Math.min(sz5, 6) * v) / 6);
  }
  s[15] = v;

  // Demand.
  const hidesRaw = (N(6) + N(7)) * 5 + Math.trunc((lat * 3) / 2) + N(5) * 2 + N(3);
  d[3] = N(3) * 4 + N(4) * 4 + Math.trunc((Math.trunc(adv / 10) * hidesRaw) / 8);
  v = hidesRaw;
  if (size < 3) v *= 2;
  if (knows(ADV.industrialization)) v = Math.trunc(v / 3);
  if (knows(ADV.massProduction)) v = 1;
  if (adv < 10) v <<= 1;
  if (adv < 20) v <<= 1;
  if (adv > 47) v = Math.trunc(v / 2);
  d[0] = v;
  v = Math.abs((rows >> 2) - lat) * 2 + N(1) * 2 + N(3);
  if (knows(ADV.industrialization)) v <<= 1;
  d[1] = v;
  v = lat + Math.trunc(((21 - N(10)) * 3) / 2);
  if (size < 4) v += v >> 1;
  if (size > 11) v = Math.trunc(v / 2);
  if (adv > 47) v = Math.trunc(v / 2);
  d[2] = v;
  {
    let weight = 8;
    let rem = size;
    v = 0;
    while (weight !== 0 && rem > 0) {
      const chunk = clamp(rem, 0, 5);
      v += chunk * weight;
      weight = Math.trunc(weight / 2);
      rem -= chunk;
    }
    d[4] = v - Math.trunc(adv / 2);
  }
  v = (lat + 10) * sz5 + adv;
  if (size < 5) v = 0;
  if (size < 8) v >>= 1;
  if (knows(ADV.industrialization)) v <<= 1;
  if (knows(ADV.electricity)) v <<= 1;
  if (has(IMPROVEMENT.powerPlant)) v <<= 1;
  if (has(IMPROVEMENT.hydroPlant) || has(IMPROVEMENT.nuclearPlant) || has(IMPROVEMENT.solarPlant))
    v >>= 3;
  d[5] = v;
  v = (rd + rv + 1) * sz5;
  if (v <= (s[6] ?? 0)) v >>= 1;
  if (has(IMPROVEMENT.marketplace)) v += v >> 1;
  if (has(IMPROVEMENT.bank)) v += v >> 1;
  if (knows(ADV.electricity)) v += v >> 1;
  if (knows(ADV.computers)) v = Math.trunc(v / 4);
  if (size < 5) v >>= 1;
  d[6] = v;
  v = (s[3] ?? 0) + rd;
  if (knows(ADV.chemistry)) v = Math.trunc(v / 2);
  if (knows(ADV.massProduction)) v = Math.trunc(v / 2);
  d[7] = v;
  d[8] = sz5 * 4 + 4 + Math.abs(cx - cy);
  v =
    ((rows >> 1) - lat) * 2 -
    lon +
    (width >> 1) +
    N(8) * 2 +
    N(9) * 4 +
    Math.trunc(N(1) / 2) +
    N(0) * 4;
  v = shift(v, clamp(sz5 - 1, -1, 1));
  if (lm === 1 && (city.id & 2) !== 0) v += v >> 1;
  if (size < 7) v >>= 1;
  d[9] = v;
  d[10] = size << 3;
  let pick = 10;
  switch ((cy + cx) % 3) {
    case 1:
      pick = 12;
      d[12] = d[10];
      break;
    case 2:
      pick = 13;
      d[13] = d[10];
      break;
    default:
      break;
  }
  v = d[pick] ?? 0;
  if (has(IMPROVEMENT.cathedral) || ctx.ownsWonder(slot, IMPROVEMENT.michelangelos))
    v = (v * 3) >> 1;
  if (has(IMPROVEMENT.bank)) v = (v * 3) >> 1;
  if (knows(ADV.economics)) v >>= 1;
  if (knows(ADV.computers)) v >>= 1;
  if (tribe === TRIBE_SPANISH) v <<= 1;
  d[pick] = v;
  v = Math.trunc(land / 10) - Math.max(0, adv - 12);
  if (size < 4) v = Math.trunc(v / 2);
  if (land > 400) {
    if (size > 7) v <<= 1;
    if (((-cx - cy) & 3) === 0) v = 0;
  }
  if (knows(ADV.refrigeration)) v >>= 1;
  d[11] = v;
  if (!knows(ADV.industrialization)) d[14] = -1;
  else {
    v = (sz5 + 2) * Math.trunc(adv / 3);
    if (v <= (s[14] ?? 0)) v >>= 1;
    if (!has(IMPROVEMENT.factory)) {
      if (size < 5) v >>= 1;
      if (size < 10) v >>= 1;
      if (size < 20) v >>= 1;
    } else v = Math.trunc((v * 3) / 2);
    if (knows(ADV.automobile)) v *= 3;
    if (has(IMPROVEMENT.superhighways)) v <<= 1;
    if (has(IMPROVEMENT.massTransit)) v >>= 1;
    if (has(IMPROVEMENT.recyclingCenter)) v >>= 1;
    d[14] = v;
  }
  if (!knows(ADV.nuclearFission)) d[15] = -1;
  else {
    v = shift(adv * adv, clamp(sz5 - 3, -3, 0));
    if (has(IMPROVEMENT.nuclearPlant) || has(IMPROVEMENT.sdiDefense)) v <<= 1;
    d[15] = v;
  }

  // A commodity is supplied or demanded, never both.
  for (let i = 0; i < 16; i++) {
    const si = s[i] ?? 0;
    const di = d[i] ?? 0;
    if (si < di) {
      if (si > 0) s[i] = 0;
    } else if (di > 0) d[i] = 0;
  }
  const supplied = suppliedOf(city);
  const demanded = demandedOf(city);
  topThree([...s]).forEach((c, i) => (supplied[i] = c));
  topThree([...d]).forEach((c, i) => (demanded[i] = c));

  // The position-hashed commodities override the middle entries.
  let r1: number;
  let r2: number;
  if (adv < 32) {
    r1 = (cy * 5 + cx * 3) % 14;
    r2 = (cy * 7 + cx * 13) % 14;
  } else {
    r1 = ((cy * 5 + cx * 3) % 9) + 5;
    r2 = ((cy * 7 + cx * 13) % 9) + 5;
  }
  if (r2 === r1) r2 = -2;
  let demandedHigh = false;
  let suppliedHigh = false;
  for (let i = 0; i < 3; i++) {
    if ((demanded[i] ?? -1) > 13) demandedHigh = true;
    if ((supplied[i] ?? -1) > 13) suppliedHigh = true;
    if (supplied[i] === r1 || demanded[i] === r1) r1 = -2;
    if (supplied[i] === r2 || demanded[i] === r2) r2 = -2;
  }
  if (r1 < 0 && !demandedHigh) {
    if (knows(ADV.industrialization) && (r1 & 1) !== 0) r1 = 14;
    else if (knows(ADV.nuclearFission) && (r1 & 1) === 0) r1 = 15;
  }
  if (r1 >= 0) demanded[1] = r1;
  if (r2 < 0 && !suppliedHigh) {
    r2 = (r2 & 1) + 14;
    if (r2 === 14 && !knows(ADV.industrialization)) r2 = -1;
    if (r2 === 15 && !knows(ADV.nuclearFission)) r2 = -1;
  }
  if (r2 >= 0) supplied[1] = r2;

  // Entries carried by a route or a homed caravan are negated.
  refreshCommodityUse(world, city);
}
