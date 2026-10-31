/**
 * Builds the engine's `World` from a parsed original save or scenario file plus the rules.
 *
 * This is the only place that knows both the file format (`@mudbrick/formats`) and the engine
 * model (`@mudbrick/engine`), so the engine stays free of file-format knowledge. Field meanings
 * follow docs/formats/save-format.md; anything marked INFERRED there is INFERRED here too.
 */
import { SquareFlag, World } from '@mudbrick/engine';
import { decodeSquare, type Rules, type SaveFile } from '@mudbrick/formats';

export function worldFromSave(save: SaveFile, rules: Rules): World {
  const world = new World({
    columns: save.map.columns,
    rows: save.map.rows,
    flatEarth: save.map.header.flatEarth,
  });

  for (let i = 0; i < save.map.header.area; i++) {
    const s = decodeSquare(save.map, i);
    world.terrain[i] = s.terrain;
    world.landmass[i] = s.landmassId;
    let f = 0;
    if (s.river) f |= SquareFlag.River;
    if (s.road) f |= SquareFlag.Road;
    if (s.railroad) f |= SquareFlag.Railroad;
    if (s.irrigation) f |= SquareFlag.Irrigation;
    if (s.farmland) f |= SquareFlag.Farmland;
    if (s.mine) f |= SquareFlag.Mine;
    if (s.fortress) f |= SquareFlag.Fortress;
    if (s.airbase) f |= SquareFlag.Airbase;
    if (s.pollution) f |= SquareFlag.Pollution;
    world.flags[i] = f;
  }

  for (let slot = 0; slot < 8; slot++) {
    const rec = save.civs[slot];
    const names = slot === 0 ? undefined : save.civNames[slot - 1];
    const leader = slot === 0 ? undefined : rules.leaders[rec?.tribeId ?? -1];
    world.civs.push({
      slot,
      tribe: slot === 0 ? null : (rec?.tribeId ?? null),
      name: names?.plural || leader?.plural || (slot === 0 ? 'Barbarians' : `Civilization ${slot}`),
      adjective: names?.adjective || leader?.adjective || (slot === 0 ? 'Barbarian' : ''),
      leader: names?.leader || leader?.name || '',
      cityStyle: names?.cityStyle ?? leader?.cityStyle ?? 0,
      epoch: Math.max(
        0,
        ...(rec?.knownAdvances ?? []).map((known, i) =>
          known ? (rules.advances[i]?.epoch ?? 0) : 0,
        ),
      ),
      colour: slot === 0 ? 0 : (leader?.color ?? slot),
      government: rec?.government ?? 0,
      treasury: rec?.treasury ?? 0,
      isHuman: save.parameters.humanSlots[slot] ?? false,
      inPlay: slot === 0 || (save.parameters.slotsInPlay[slot] ?? false),
    });
  }

  for (const c of save.cities) {
    world.cities.push({
      id: c.id,
      position: c.position,
      owner: c.owner,
      name: c.name,
      size: c.size,
      improvements: c.improvements,
      foodStored: c.foodStored,
      shieldsStored: c.shieldsStored,
      inDisorder: c.civilDisorder,
    });
  }

  for (const u of save.units) {
    if (!u.position) continue; // unused slot
    world.units.push({
      id: u.id,
      position: u.position,
      owner: u.owner,
      type: u.type,
      veteran: u.veteran,
      hitPointsLost: u.hitPointsLost,
      movesSpent: u.movesSpent,
      // Order codes are INFERRED; the original uses this value for "fortified" per the reader
      // the spec was cross-checked against. Treat with suspicion until verified in a real game.
      fortified: u.order === 1 || u.order === 2,
      homeCity: u.homeCity === 0xff ? null : u.homeCity,
    });
  }

  return world;
}
