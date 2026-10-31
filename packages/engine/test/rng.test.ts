import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng.js';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 8 }, () => a.nextU32());
    const seqB = Array.from({ length: 8 }, () => b.nextU32());
    expect(seqA).toEqual(seqB);
  });

  it('differs across seeds', () => {
    expect(new Rng(1).nextU32()).not.toBe(new Rng(2).nextU32());
  });

  it('round-trips its state', () => {
    const a = new Rng(99);
    a.nextU32();
    a.nextU32();
    const b = Rng.fromState(a.state());
    expect(b.nextU32()).toBe(a.nextU32());
  });

  it('bounds nextInt and covers the range', () => {
    const r = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.nextInt(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
    expect(() => r.nextInt(0)).toThrow(RangeError);
  });

  it('produces floats in [0,1) with a sane mean', () => {
    const r = new Rng(3);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const f = r.nextFloat();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      sum += f;
    }
    expect(sum / 10000).toBeGreaterThan(0.48);
    expect(sum / 10000).toBeLessThan(0.52);
  });

  it('shuffles as a permutation', () => {
    const out = new Rng(5).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
