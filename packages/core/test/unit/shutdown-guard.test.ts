import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  forceCloseHttpConnections,
  installHardShutdownDeadline,
  resetHardShutdownDeadlineForTests,
  withTimeout,
} from '../../src/shutdown-guard';

describe('shutdown-guard', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetHardShutdownDeadlineForTests();
  });

  it('withTimeout rejects when the promise never settles', async () => {
    await expect(withTimeout(new Promise(() => {}), 30, 'x')).rejects.toThrow(/timed out after 30ms/);
  });

  it('forceCloseHttpConnections calls closeAllConnections when present', () => {
    const closeAllConnections = vi.fn();
    forceCloseHttpConnections({ closeAllConnections } as any);
    expect(closeAllConnections).toHaveBeenCalledTimes(1);
    expect(() => forceCloseHttpConnections(undefined)).not.toThrow();
  });

  it('installHardShutdownDeadline exits after the deadline on SIGINT', () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    installHardShutdownDeadline(100);
    process.emit('SIGINT');
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(exit).toHaveBeenCalledWith(130);
    exit.mockRestore();
  });
});
