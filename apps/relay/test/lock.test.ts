import { describe, expect, it } from 'vitest';
import { SeatLock } from '../src/lock.js';

describe('SeatLock', () => {
  it('serves one seat at a time, in order of asking', () => {
    const lock = new SeatLock();
    expect(lock.request(1)).toBe(true);
    expect(lock.request(1)).toBe(true);
    expect(lock.request(2)).toBe(false);
    expect(lock.request(3)).toBe(false);
    expect(lock.release(1)).toBe(2);
    expect(lock.release(2)).toBe(3);
    expect(lock.release(3)).toBeNull();
    expect(lock.request(2)).toBe(true);
  });

  it('drops a seat that leaves the queue', () => {
    const lock = new SeatLock();
    lock.request(1);
    lock.request(2);
    lock.request(3);
    expect(lock.release(2)).toBeNull();
    expect(lock.release(1)).toBe(3);
  });
});
