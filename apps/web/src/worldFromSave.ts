/**
 * Builds the engine's `World` from a parsed original save or scenario file plus the rules.
 *
 * This is the only place that knows both the file format (`@mudbrick/formats`) and the engine
 * model (`@mudbrick/engine`), so the engine stays free of file-format knowledge. Field meanings
 * follow docs/formats/save-format.md; anything marked INFERRED there is INFERRED here too.
 */
import { SquareFlag, World, type EngineRules } from '@mudbrick/engine';
import { decodeSquare, type Rules, type SaveFile } from '@mudbrick/formats';

/**
 * The parsed rules already have the shape the engine needs; this function is the compile-time
 * proof (and the one place to adapt should the shapes ever diverge).
 */
export function engineRules(rules: Rules): EngineRules {
  return rules;
}

export function worldFromSave(save: SaveFile, rules: Rules): World {
  const world = new World({
    columns: save.map.columns,
    rows: save.map.rows,
    flatEarth: save.map.header.flatEarth,
    resourceSeed: save.map.header.resourceSeed,
  });

  for (let i = 0; i < save.map.header.area; i++) {
    const s = decodeSquare(save.map, i);
    world.terrain[i] = s.terrain;
    world.landmass[i] = s.landmassId;
    world.seen[i] = s.visibilityMask;
    world.territory[i] = s.cityRadiusOwnerRaw >> 5;
    world.fertility[i] = s.fertility;
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
    if (s.resourceFlag) f |= SquareFlag.NoSpecial;
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
      scienceStored: rec?.researchProgress ?? 0,
      researching: rec?.researching ?? null,
      advancesCount: rec?.advancesCount ?? 0,
      futureTechs: rec?.futureTechs ?? 0,
      scienceRate: rec?.scienceRate ?? 0,
      taxRate: rec?.taxRate ?? 0,
      knownAdvances: [...(rec?.knownAdvances ?? [])],
      freeAdvancePending: false,
      ...(rec
        ? {
            treaties: Uint32Array.from(rec.treaties.map((t) => t.raw)),
            attitudes: Uint8Array.from(rec.attitudes),
            reputation: rec.reputation,
            eiffelApplied: (rec.stateFlags & 0x10) !== 0,
            patience: rec.patience,
            talks: rec.talks,
            portrait: rec.portrait,
            throne: rec.throne,
            thronePieces: rec.thronePieces,
            casualties: rec.casualties,
            pardons: Int8Array.from(rec.pardons),
            senateActive: (rec.stateFlags & 4) !== 0,
            everExchanged: (rec.stateFlags & 0x80) !== 0,
            everAllied: (rec.gender & 1) !== 0,
            lastWarTurns: Int16Array.from(rec.lastContact),
            governmentScores: Int16Array.from(rec.governmentScores),
            spaceship: {
              flags: rec.spaceship.flags,
              arrival: rec.spaceship.estimatedArrival,
              launchYear: rec.spaceship.launchYear,
              population: rec.spaceship.population,
              parts: Int16Array.from([
                rec.spaceship.structural,
                rec.spaceship.propulsion,
                rec.spaceship.fuel,
                rec.spaceship.habitation,
                rec.spaceship.lifeSupport,
                rec.spaceship.solar,
              ]),
            },
          }
        : {}),
      inPlay: slot === 0 || (save.parameters.slotsInPlay[slot] ?? false),
      hadCity: save.cities.some((c) => c.owner === slot),
    });
  }

  for (const c of save.cities) {
    const improvements = [...c.improvements];
    for (const w of save.wonders) if (w.cityId === c.id) improvements[w.improvementIndex] = true;
    const specialists = { entertainers: 0, taxCollectors: 0, scientists: 0 };
    for (const s of c.specialists) {
      if (s === 1) specialists.entertainers++;
      else if (s === 2) specialists.taxCollectors++;
      else if (s === 3) specialists.scientists++;
    }
    world.cities.push({
      id: c.id,
      position: c.position,
      owner: c.owner,
      name: c.name,
      size: c.size,
      improvements,
      foodStored: c.foodStored,
      shieldsStored: c.shieldsStored,
      worked: c.workedSquaresMask | (1 << 20),
      specialists,
      production: c.production,
      inDisorder: c.civilDisorder,
      celebrating: c.weLoveTheKingDay,
      soldThisTurn: c.improvementSoldThisTurn,
      airlifted: c.airlifted,
      ...(typeof c.founder === 'number' ? { previousOwner: c.founder } : {}),
      ...(c.objectiveX1 ? { objective: true } : {}),
      ...(c.wonderCity ? { wonderCity: true } : {}),
      tradeRoutes: c.routePartners.slice(0, c.activeTradeRoutes).map((partner, i) => {
        const raw = c.routeCommodities[i] ?? 0;
        return { partner, food: raw >= 0x80, commodity: raw >= 0x80 ? -1 : raw };
      }),
      supplied: Int8Array.from(c.commoditiesSupplied.map((v) => (v >= 0x80 ? v - 256 : v))),
      demanded: Int8Array.from(c.commoditiesDemanded.map((v) => (v >= 0x80 ? v - 256 : v))),
      lastTrade: c.netTrade,
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
      automated: u.automated,
      warned: u.warned,
      hitPointsLost: u.hitPointsLost,
      movesSpent: u.movesSpent,
      // The save stores RULES @ORDERS index + 1, 0xFF for none (VERIFIED in the executable).
      fortified: u.order === 2,
      homeCity: u.homeCity === 0xff ? null : u.homeCity,
      order: u.order === 0xff || u.order === 0 ? null : u.order - 1,
      workCounter: u.counterOrCommodity,
      gotoTarget: u.order === 11 || u.order === 28 ? u.goTo : null,
      lastDirection: u.lastMoveDirection,
      gotoSteps: 0,
    });
  }

  return world;
}
