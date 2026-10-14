export interface RateLimiter {
  hit(key: string, limit: number, windowSec: number): { ok: boolean; retryAfterSec: number };
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private lastPrune = 0;

  hit(key: string, limit: number, windowSec: number): { ok: boolean; retryAfterSec: number } {
    const now = Date.now();
    this.prune(now);
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowSec * 1000 };
      this.windows.set(key, w);
    }
    if (w.count >= limit) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
    }
    w.count++;
    return { ok: true, retryAfterSec: 0 };
  }

  private prune(now: number): void {
    if (now - this.lastPrune < 60_000) return;
    this.lastPrune = now;
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
  }
}
