/**
 * Which sound the original plays (the table at 0x005b5228, 133 names of 8 letters, played by
 * 0x00452e10 from the SOUND folder). The UI turns a name into `SOUND/NAME.WAV`.
 */
import type { UnitTypeRule } from './rules.js';

/** The attacker's sound, as the combat routine chooses it from the unit's slot (0x0052d472). */
export function attackSound(t: UnitTypeRule, slot: number, defender?: UnitTypeRule): string | null {
  const custom: Record<number, string> = {
    51: 'CUSTOM1',
    52: 'CUSTOM2',
    53: 'CUSTOM3',
    54: 'EXTRA1',
    55: 'EXTRA2',
    56: 'EXTRA3',
    57: 'EXTRA4',
    58: 'EXTRA5',
    59: 'EXTRA6',
    60: 'EXTRA7',
    61: 'EXTRA8',
  };
  if (custom[slot]) return custom[slot] ?? null;
  if (t.flags.destroyedAfterAttack) return t.attack < 99 ? 'MISSILE' : null;
  if (t.domain === 1) {
    if (defender?.domain === 1) return slot < 30 ? 'AIRCOMBT' : 'JETCOMBT';
    if (t.range === 0) return 'HELISHOT';
    return slot < 30 ? 'DIVEBOMB' : 'JETBOMB';
  }
  if (t.domain === 2) {
    if (t.flags.submarine) return 'TORPEDOS';
    return slot >= 37 && slot <= 40 ? 'NAVBTTLE' : 'BIGGUN';
  }
  if (slot === 17) return 'ELEPHANT';
  if (slot === 15 || slot === 16 || slot === 18 || slot === 19) return 'SWRDHORS';
  if (slot === 20 || slot === 21) return 'CAVALRY';
  if (slot === 7 || slot === 9 || slot === 10 || slot === 11) return 'INFANTRY';
  if (slot === 8 || slot === 12 || slot === 13 || slot === 14) return 'MCHNGUNS';
  if (slot < 22 || slot > 26) return 'SWORDFGT';
  if (slot === 23) return 'CATAPULT';
  return slot > 23 ? 'FIRE---' : 'MEDGUN';
}

/** The sound of a finished improvement (the switch in 0x004b7e74). */
export function improvementSound(index: number): string {
  if (index >= 39) return 'NEWONDER';
  if (index >= 35) return 'BLDSPCSH';
  const special: Record<number, string> = {
    2: 'BARRACKS',
    9: 'AQUEDUCT',
    10: 'NEWBANK',
    11: 'CATHEDRL',
    12: 'CHEERS',
    22: 'STKMARKT',
  };
  return special[index] ?? 'CHEERS';
}
