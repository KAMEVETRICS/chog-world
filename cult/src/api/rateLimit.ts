/** Fixed-window counter per key, in memory. One process only; a multi-process deployment needs a shared store. */
export class RateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #windows = new Map<string, { start: number; count: number }>();

  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  /** Counts one attempt for `key`; false once the window's limit is used up. */
  allow(key: string, nowMs: number): boolean {
    const window = this.#windows.get(key);
    if (!window || nowMs - window.start >= this.#windowMs) {
      this.#windows.set(key, { start: nowMs, count: 1 });
      if (this.#windows.size > 10_000) this.#prune(nowMs);
      return true;
    }
    window.count += 1;
    return window.count <= this.#limit;
  }

  #prune(nowMs: number): void {
    for (const [key, window] of this.#windows) if (nowMs - window.start >= this.#windowMs) this.#windows.delete(key);
  }
}
