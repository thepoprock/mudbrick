/**
 * Who may change the game right now when humans move at once. The original locks the squares a
 * move touches (0x0053d7b1) because every client plays on a shared state held by the server; here
 * each browser works on its own copy and sends the whole state on, so one writer at a time does
 * the same job: a move cannot start from a state another seat is already changing.
 */
export class SeatLock {
  private holder: number | null = null;
  private readonly waiting: number[] = [];

  /** Ask for the lock: true when it is yours now, false when you are in the queue. */
  request(seat: number): boolean {
    if (this.holder === seat) return true;
    if (this.holder === null) {
      this.holder = seat;
      return true;
    }
    if (!this.waiting.includes(seat)) this.waiting.push(seat);
    return false;
  }

  /** Give the lock up (or leave the queue); returns the seat it passes to, if any. */
  release(seat: number): number | null {
    const at = this.waiting.indexOf(seat);
    if (at >= 0) this.waiting.splice(at, 1);
    if (this.holder !== seat) return null;
    this.holder = this.waiting.shift() ?? null;
    return this.holder;
  }
}
