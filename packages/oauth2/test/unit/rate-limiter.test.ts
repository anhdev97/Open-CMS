import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InMemoryRateLimiter } from '../../src/security/rate-limiter';

describe('InMemoryRateLimiter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('blocks the 6th hit and recovers after the window', () => {
    const rl = new InMemoryRateLimiter();
    for (let i = 0; i < 5; i++) expect(rl.hit('k', 5, 900)).toEqual({ ok: true, retryAfterSec: 0 });
    const r = rl.hit('k', 5, 900);
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(rl.hit('other', 5, 900).ok).toBe(true);
    vi.advanceTimersByTime(901_000);
    expect(rl.hit('k', 5, 900).ok).toBe(true);
  });
});
