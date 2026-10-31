/**
 * Turn the running game back into a save file: the original bytes patched with the engine's
 * state (docs/formats/save-format.md, "Writing"). Fields the engine does not model keep the
 * original's values for records that existed when the game was loaded.
 */
import { gameYear, IMPROVEMENT, SquareFlag, type Game } from '@mudbrick/engine';
import {
  writeSave,
  type CityWrite,
  type CivWrite,
  type SaveFile,
  type UnitWrite,
} from '@mudbrick/formats';

const SQUARE_BYTES = 6;

export function saveFromGame(original: Uint8Array, parsed: SaveFile, game: Game): Uint8Array {
  const { world, rules, state } = game;
  // City record indices after compaction.
  const cityIndex = new Map<number, number>();
  world.cities.forEach((c, i) => cityIndex.set(c.id, i));

  const squares = new Uint8Array(parsed.map.squares);
  for (let i = 0; i < world.area; i++) {
    const p = world.position(i);
    const o = i * SQUARE_BYTES;
    const flags = world.flags[i] ?? 0;
    const has = (f: number) => (flags & f) !== 0;
    let b0 = (squares[o] ?? 0) & 0x30;
    b0 |= (world.terrain[i] ?? 10) & 0x0f;
    if (has(SquareFlag.NoSpecial)) b0 |= 0x40;
    if (has(SquareFlag.River)) b0 |= 0x80;
    squares[o] = b0;
    let b1 = 0;
    if (world.unitsAt(p.x, p.y).length > 0) b1 |= 1 << 0;
    if (world.cityAt(p.x, p.y) || has(SquareFlag.Airbase)) b1 |= 1 << 1;
    if (has(SquareFlag.Irrigation) || has(SquareFlag.Farmland)) b1 |= 1 << 2;
    if (has(SquareFlag.Mine) || has(SquareFlag.Farmland)) b1 |= 1 << 3;
    if (has(SquareFlag.Road) || has(SquareFlag.Railroad)) b1 |= 1 << 4;
    if (has(SquareFlag.Railroad)) b1 |= 1 << 5;
    if (has(SquareFlag.Fortress) || has(SquareFlag.Airbase)) b1 |= 1 << 6;
    if (has(SquareFlag.Pollution)) b1 |= 1 << 7;
    squares[o + 1] = b1;
  }

  const units: UnitWrite[] = world.units.map((u) => ({
    ...(u.id < parsed.units.length ? { source: u.id } : {}),
    x: u.position.x,
    y: u.position.y,
    owner: u.owner,
    type: u.type,
    veteran: u.veteran,
    hasMoved: u.moved ?? false,
    movesSpent: u.movesSpent,
    hitPointsLost: u.hitPointsLost,
    lastMoveDirection: u.lastDirection,
    counter: u.commodity ?? u.workCounter,
    order: u.order === null ? 0xff : u.order + 1,
    homeCity: u.homeCity === null ? 0xff : (cityIndex.get(u.homeCity) ?? 0xff),
    goTo: u.gotoTarget,
  }));

  const cities: CityWrite[] = world.cities.map((c) => {
    const specialists: number[] = [];
    for (let i = 0; i < c.specialists.entertainers; i++) specialists.push(1);
    for (let i = 0; i < c.specialists.taxCollectors; i++) specialists.push(2);
    for (let i = 0; i < c.specialists.scientists; i++) specialists.push(3);
    return {
      ...(c.id < parsed.cities.length ? { source: c.id } : {}),
      x: c.position.x,
      y: c.position.y,
      owner: c.owner,
      size: c.size,
      founder: c.previousOwner ?? c.owner,
      capturedTurn: c.capturedTurn ?? 0,
      name: c.name,
      foodStored: Math.max(0, c.foodStored),
      shieldsStored: Math.max(0, c.shieldsStored),
      workedMask: c.worked & 0x1fffff,
      specialists: specialists.slice(0, 16),
      improvements: c.improvements,
      production: c.production,
      civilDisorder: c.inDisorder,
      weLoveTheKingDay: c.celebrating,
    };
  });

  const civs: CivWrite[] = world.civs.map((civ) => ({
    slot: civ.slot,
    treasury: civ.treasury,
    researchProgress: civ.scienceStored,
    researching: civ.researching,
    advancesCount: civ.advancesCount,
    futureTechs: civ.futureTechs,
    scienceRate: civ.scienceRate,
    taxRate: civ.taxRate,
    government: civ.government,
    knownAdvances: civ.knownAdvances,
    cities: world.cities.filter((c) => c.owner === civ.slot).length,
    sumCitySizes: world.cities.filter((c) => c.owner === civ.slot).reduce((s, c) => s + c.size, 0),
  }));

  const wonders: (number | null | 'destroyed')[] = [];
  for (let w = 39; w < 67; w++) {
    const holder = world.cities.find((c) => c.improvements[w]);
    const was = parsed.wonders[w - 39];
    wonders.push(holder ? (cityIndex.get(holder.id) ?? null) : was?.destroyed ? 'destroyed' : null);
  }
  void IMPROVEMENT;
  void rules;

  return writeSave(original, parsed, {
    turn: state.turn,
    year: gameYear(state.turn, state.difficulty),
    ...(state.pollutionSquares !== undefined ? { pollutionSquares: state.pollutionSquares } : {}),
    firstDiscoveredBy: state.firstDiscoveredBy,
    knownByMask: Array.from({ length: 100 }, (_, a) =>
      world.civs.reduce((m, c) => (c.knownAdvances[a] ? m | (1 << c.slot) : m), 0),
    ),
    wonders,
    civs,
    squares,
    units,
    cities,
  });
}

/** Offer the bytes as a download in the browser. */
export function downloadBytes(bytes: Uint8Array, filename: string): void {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy.buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
