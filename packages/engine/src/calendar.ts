/**
 * The game calendar: which year a turn falls in.
 *
 * VERIFIED against the original's year routine (0x0046520c) and its table in the data section
 * (0x005b63d0): four timelines chosen by difficulty, each six segments of
 * (starting year, number of turns, years per turn), then one year per turn.
 */

export interface CalendarSegment {
  start: number;
  turns: number;
  yearsPerTurn: number;
}

/** Rows: Chieftain/Warlord, Prince, King, Emperor/Deity (difficulty − 1 clamped to 0 … 3). */
export const CALENDAR: readonly (readonly CalendarSegment[])[] = [
  [
    { start: -4000, turns: 250, yearsPerTurn: 20 },
    { start: 1000, turns: 50, yearsPerTurn: 10 },
    { start: 1500, turns: 50, yearsPerTurn: 5 },
    { start: 1750, turns: 50, yearsPerTurn: 2 },
    { start: 1850, turns: 50, yearsPerTurn: 1 },
    { start: 1900, turns: 100, yearsPerTurn: 1 },
  ],
  [
    { start: -4000, turns: 60, yearsPerTurn: 50 },
    { start: -1000, turns: 40, yearsPerTurn: 25 },
    { start: 0, turns: 150, yearsPerTurn: 10 },
    { start: 1500, turns: 50, yearsPerTurn: 5 },
    { start: 1750, turns: 50, yearsPerTurn: 2 },
    { start: 1850, turns: 50, yearsPerTurn: 1 },
  ],
  [
    { start: -4000, turns: 60, yearsPerTurn: 50 },
    { start: -1000, turns: 40, yearsPerTurn: 25 },
    { start: 0, turns: 50, yearsPerTurn: 20 },
    { start: 1000, turns: 50, yearsPerTurn: 10 },
    { start: 1500, turns: 50, yearsPerTurn: 5 },
    { start: 1750, turns: 50, yearsPerTurn: 2 },
  ],
  [
    { start: -4000, turns: 60, yearsPerTurn: 50 },
    { start: -1000, turns: 40, yearsPerTurn: 25 },
    { start: 0, turns: 75, yearsPerTurn: 20 },
    { start: 1500, turns: 25, yearsPerTurn: 10 },
    { start: 1750, turns: 50, yearsPerTurn: 2 },
    { start: 1850, turns: 50, yearsPerTurn: 1 },
  ],
];

export interface CalendarOptions {
  /** Options byte 8 bit 2 / bit 3: shift the timeline one difficulty row down / up. */
  researchDearer?: boolean;
  researchCheaper?: boolean;
  /** Scenario calendar: `startingYear + |yearsPerTurn| × turn − 1` when yearsPerTurn ≠ 0. */
  scenario?: { yearsPerTurn: number; startingYear: number };
  /** Header offset 32: from this turn on the calendar advances one year per turn (−1 / undefined = never). */
  lockTurn?: number;
}

/** The year (negative = BC) shown for `turn` (VERIFIED). There is no year 0: it is shown as 1. */
export function gameYear(turn: number, difficulty: number, opts: CalendarOptions = {}): number {
  let extra = 0;
  let t = turn;
  if (opts.lockTurn !== undefined && opts.lockTurn >= 0) {
    extra = Math.max(0, t - opts.lockTurn);
    t -= extra;
  }
  if (opts.scenario && opts.scenario.yearsPerTurn !== 0 && opts.scenario.startingYear !== 0) {
    return opts.scenario.startingYear + Math.abs(opts.scenario.yearsPerTurn) * t - 1 + extra;
  }
  let d = difficulty;
  if (opts.researchDearer) d -= 1;
  if (opts.researchCheaper) d += 1;
  const row = CALENDAR[Math.max(0, Math.min(3, d - 1))] ?? CALENDAR[1];
  if (!row) return -4000;
  if (t !== 0) t -= 1;
  let i = 0;
  while (i < 6 && (row[i]?.turns ?? 0) < t) {
    t -= row[i]?.turns ?? 0;
    i++;
  }
  let year: number;
  const seg = row[i];
  const last = row[5];
  if (seg) year = seg.start + seg.yearsPerTurn * t;
  else if (last) year = last.start + last.yearsPerTurn * last.turns + t;
  else year = -4000;
  if (year === 0) year = 1;
  return year + extra;
}

/** "3950 BC" / "1 AD" style label. */
export function yearLabel(year: number): string {
  return year < 0 ? `${-year} BC` : `${year} AD`;
}

/** Month names for a scenario counting in months (LABELS.TXT entries 420–431; English here). */
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * The year as the original prints it (VERIFIED 0x00465428): "N BC" / "N AD" normally; when a
 * scenario's years-per-turn is negative the value counts months — the month is `year % 12`
 * (counted from the end for a negative value) and the year `year / 12`, both truncated.
 */
export function formatYear(year: number, opts: CalendarOptions = {}): string {
  const sc = opts.scenario;
  if (sc && sc.yearsPerTurn < 0) {
    const m = year % 12;
    const month = year < 1 ? MONTH_NAMES[(11 + m) % 12] : MONTH_NAMES[m];
    return `${month ?? ''} ${Math.abs(Math.trunc(year / 12))}`;
  }
  return year < 0 ? `${-year} BC` : `${year} AD`;
}
