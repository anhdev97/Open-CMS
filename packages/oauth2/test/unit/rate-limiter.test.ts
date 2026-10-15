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

  it('holds at most 10_000 keys, evicting the oldest insertion first (M4)', () => {
    const rl = new InMemoryRateLimiter();
    expect(rl.hit('oldest', 1, 900).ok).toBe(true);
    expect(rl.hit('oldest', 1, 900).ok).toBe(false);
    for (let i = 0; i < 9_999; i++) rl.hit(`k${i}`, 1, 900);
    expect(rl.size).toBe(10_000);
    expect(rl.hit('oldest', 1, 900).ok).toBe(false); // still tracked

    rl.hit('one-more', 1, 900);
    expect(rl.size).toBe(10_000);
    expect(rl.hit('oldest', 1, 900).ok).toBe(true); // evicted, so a fresh window
    expect(rl.hit('k9998', 1, 900).ok).toBe(false); // newer keys survive
  });

  it('a window restarted after expiry counts as a new insertion for eviction', () => {
    const rl = new InMemoryRateLimiter({ maxKeys: 2 });
    rl.hit('a', 1, 1);
    rl.hit('b', 1, 900);
    vi.advanceTimersByTime(1_500);
    expect(rl.hit('a', 1, 900).ok).toBe(true); // 'a' restarts → now newest
    rl.hit('c', 1, 900); // evicts 'b', the oldest insertion
    expect(rl.hit('a', 1, 900).ok).toBe(false);
    expect(rl.hit('b', 1, 900).ok).toBe(true);
  });
});
