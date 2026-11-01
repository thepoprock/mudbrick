import { describe, expect, it } from 'vitest';
import { cityPopulation } from '../src/reports.js';

describe('reports', () => {
  it('a city of size n holds 1 + 2 + … + n in the original count', () => {
    expect(cityPopulation(1)).toBe(1);
    expect(cityPopulation(4)).toBe(10);
  });
});
