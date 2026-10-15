export interface RateLimiter {
  hit(key: string, limit: number, windowSec: number): { ok: boolean; retryAfterSec: number };
}

/** Upper bound on tracked keys; beyond it the oldest insertion is dropped (M4: bounded memory). */
export const RATE_LIMITER_MAX_KEYS = 10_000;

export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly maxKeys: number;
  private lastPrune = 0;

  constructor(opts: { maxKeys?: number } = {}) {
    this.maxKeys = opts.maxKeys ?? RATE_LIMITER_MAX_KEYS;
  }

  /** Number of tracked keys. */
  get size(): number {
    return this.windows.size;
  }

  hit(key: string, limit: number, windowSec: number): { ok: boolean; retryAfterSec: number } {
    const now = Date.now();
    this.prune(now);
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowSec * 1000 };
      this.insert(key, w);
    }
    if (w.count >= limit) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
    }
    w.count++;
    return { ok: true, retryAfterSec: 0 };
  }

  /** (Re)inserts at the end of the Map's insertion order, evicting the oldest entries when full. */
  private insert(key: string, w: { count: number; resetAt: number }): void {
    this.windows.delete(key);
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) break;
      this.windows.delete(oldest);
    }
    this.windows.set(key, w);
  }

  private prune(now: number): void {
    if (now - this.lastPrune < 60_000) return;
    this.lastPrune = now;
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
  }
}
