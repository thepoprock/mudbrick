/**
 * Deterministic random numbers for the simulation.
 *
 * Every random decision in the engine goes through an `Rng` whose state is part of the game
 * state. Same seed + same inputs = same game, on every machine, which is what makes saves,
 * replays, multiplayer and regression tests possible.
 *
 * Algorithm: xoshiro128** (Blackman & Vigna, 2018), seeded with splitmix32. 32-bit arithmetic
 * only, so it behaves identically in every JavaScript engine. This is OUR generator; the
 * original game's generator is a separate question for the executable analysis.
 */

export interface RngState {
  readonly s0: number;
  readonly s1: number;
  readonly s2: number;
  readonly s3: number;
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

export class Rng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  constructor(seed: number) {
    const sm = splitmix32(seed);
    this.s0 = sm();
    this.s1 = sm();
    this.s2 = sm();
    this.s3 = sm();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1; // all-zero state is invalid
  }

  static fromState(state: RngState): Rng {
    const r = new Rng(0);
    r.s0 = state.s0 >>> 0;
    r.s1 = state.s1 >>> 0;
    r.s2 = state.s2 >>> 0;
    r.s3 = state.s3 >>> 0;
    return r;
  }

  state(): RngState {
    return { s0: this.s0 >>> 0, s1: this.s1 >>> 0, s2: this.s2 >>> 0, s3: this.s3 >>> 0 };
  }

  /** Uniform unsigned 32-bit integer. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform integer in [0, n), unbiased (rejection sampling). n must be 1 … 2^32. */
  nextInt(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 0x1_0000_0000) throw new RangeError(`nextInt(${n})`);
    const limit = 0x1_0000_0000 - (0x1_0000_0000 % n);
    let x = this.nextU32();
    while (x >= limit) x = this.nextU32();
    return x % n;
  }

  /** Uniform float in [0, 1) with 32 bits of precision. */
  nextFloat(): number {
    return this.nextU32() / 0x1_0000_0000;
  }

  /** True with probability k/n — the shape most of the original rules take ("1 in x chance"). */
  chance(k: number, n: number): boolean {
    return this.nextInt(n) < k;
  }

  /** In-place Fisher–Yates shuffle. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      // Both indices are in range by construction; the casts only satisfy noUncheckedIndexedAccess.
      [items[i], items[j]] = [items[j] as T, items[i] as T];
    }
    return items;
  }
}
