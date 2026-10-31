import { describe, expect, it } from 'vitest';
import { gameYear, yearLabel } from '../src/calendar.js';

describe('calendar (verified table)', () => {
  it('starts every game at 4000 BC and follows the Prince timeline', () => {
    expect(gameYear(0, 2)).toBe(-4000);
    expect(gameYear(1, 2)).toBe(-4000);
    expect(gameYear(2, 2)).toBe(-3950);
    expect(gameYear(61, 2)).toBe(-1000);
    expect(gameYear(62, 2)).toBe(-975);
    expect(gameYear(101, 2)).toBe(1); // no year 0
    expect(gameYear(102, 2)).toBe(10);
    expect(gameYear(251, 2)).toBe(1500);
    expect(gameYear(401, 2)).toBe(1900);
    expect(gameYear(402, 2)).toBe(1901); // one year per turn after the table
  });
  it('runs slowly at Chieftain and fast at Emperor', () => {
    expect(gameYear(2, 0)).toBe(-3980);
    expect(gameYear(251, 0)).toBe(1000);
    expect(gameYear(2, 4)).toBe(-3950);
    expect(gameYear(176, 4)).toBe(1500);
    expect(gameYear(176, 5)).toBe(1500);
  });
  it('honours a scenario calendar and the one-year lock', () => {
    expect(gameYear(10, 2, { scenario: { yearsPerTurn: 2, startingYear: 1939 } })).toBe(1958);
    expect(gameYear(70, 2, { lockTurn: 61 })).toBe(-1000 + 9);
    expect(yearLabel(-1000)).toBe('1000 BC');
    expect(yearLabel(1901)).toBe('1901 AD');
  });
});
