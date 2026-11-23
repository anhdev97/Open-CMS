import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosave } from '../../admin/src/page-editor/autosave';

type Saved = { data: string; ifMatch: string | undefined };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const stale = Object.assign(new Error('stale'), { status: 409, code: 'stale_draft' });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createAutosave', () => {
  it('debounces two quick changes into one save', async () => {
    const calls: Saved[] = [];
    const a = createAutosave<string>({
      save: async (data, ifMatch) => {
        calls.push({ data, ifMatch });
        return { updatedAt: 't1' };
      },
      debounceMs: 1500,
      ifMatch: 't0',
    });
    expect(a.state).toBe('idle');
    a.change('a');
    expect(a.state).toBe('dirty');
    await vi.advanceTimersByTimeAsync(1000);
    a.change('ab');
    await vi.advanceTimersByTimeAsync(1499);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([{ data: 'ab', ifMatch: 't0' }]);
    expect(a.state).toBe('saved');
    expect(a.ifMatch).toBe('t1');
  });

  it('defaults to a 1500 ms debounce', async () => {
    const save = vi.fn(async () => ({ updatedAt: 't1' }));
    const a = createAutosave<string>({ save });
    a.change('x');
    await vi.advanceTimersByTimeAsync(1499);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves a change made during a save after the first resolves, with the new If-Match', async () => {
    const calls: Saved[] = [];
    const first = deferred<{ updatedAt: string }>();
    const a = createAutosave<string>({
      save: (data, ifMatch) => {
        calls.push({ data, ifMatch });
        return calls.length === 1 ? first.promise : Promise.resolve({ updatedAt: 't2' });
      },
      debounceMs: 1500,
      ifMatch: 't0',
    });
    a.change('a');
    await vi.advanceTimersByTimeAsync(1500);
    expect(a.state).toBe('saving');
    a.change('b');
    await vi.advanceTimersByTimeAsync(1500); // the debounce elapses while the first save is in flight
    expect(calls).toHaveLength(1);
    first.resolve({ updatedAt: 't1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([
      { data: 'a', ifMatch: 't0' },
      { data: 'b', ifMatch: 't1' },
    ]);
    expect(a.state).toBe('saved');
    expect(a.ifMatch).toBe('t2');
  });

  it('goes to conflict on 409 stale_draft, keeps the local data and never saves again', async () => {
    const save = vi.fn(async () => {
      throw stale;
    });
    const a = createAutosave<string>({ save, debounceMs: 1500, ifMatch: 't0' });
    a.change('a');
    await vi.advanceTimersByTimeAsync(1500);
    expect(a.state).toBe('conflict');
    expect(a.data).toBe('a');
    a.change('b');
    await vi.advanceTimersByTimeAsync(5000);
    await a.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(a.state).toBe('conflict');
    expect(a.data).toBe('b');
  });

  it('flush saves immediately', async () => {
    const save = vi.fn(async () => ({ updatedAt: 't1' }));
    const a = createAutosave<string>({ save, debounceMs: 1500, ifMatch: 't0' });
    a.change('a');
    await a.flush();
    expect(save).toHaveBeenCalledWith('a', 't0');
    expect(a.state).toBe('saved');
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush without changes does nothing; flush during a save waits for it and saves the rest', async () => {
    const first = deferred<{ updatedAt: string }>();
    const save = vi.fn((_d: string, _m: string | undefined) => (save.mock.calls.length === 1 ? first.promise : Promise.resolve({ updatedAt: 't2' })));
    const a = createAutosave<string>({ save, debounceMs: 1500, ifMatch: 't0' });
    await a.flush();
    expect(save).not.toHaveBeenCalled();
    a.change('a');
    const p1 = a.flush();
    a.change('b');
    const p2 = a.flush();
    first.resolve({ updatedAt: 't1' });
    await Promise.all([p1, p2]);
    expect(save.mock.calls).toEqual([
      ['a', 't0'],
      ['b', 't1'],
    ]);
  });

  it('goes to error on other failures, does not retry by itself and retries on the next change', async () => {
    let fail = true;
    const save = vi.fn(async () => {
      if (fail) throw new Error('boom');
      return { updatedAt: 't1' };
    });
    const a = createAutosave<string>({ save, debounceMs: 1500, ifMatch: 't0' });
    a.change('a');
    await vi.advanceTimersByTimeAsync(1500);
    expect(a.state).toBe('error');
    expect((a.error as Error).message).toBe('boom');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(1);
    fail = false;
    a.change('ab');
    await vi.advanceTimersByTimeAsync(1500);
    expect(save).toHaveBeenLastCalledWith('ab', 't0');
    expect(a.state).toBe('saved');
    expect(a.error).toBeNull();
  });

  it('notifies subscribers on every state change', async () => {
    const a = createAutosave<string>({ save: async () => ({ updatedAt: 't1' }), debounceMs: 10 });
    const seen: string[] = [];
    const off = a.subscribe((s) => seen.push(s));
    a.change('a');
    await vi.advanceTimersByTimeAsync(10);
    off();
    a.change('b');
    expect(seen).toEqual(['dirty', 'saving', 'saved']);
  });

  it('dispose cancels a pending save', async () => {
    const save = vi.fn(async () => ({ updatedAt: 't1' }));
    const a = createAutosave<string>({ save, debounceMs: 10 });
    a.change('a');
    a.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(save).not.toHaveBeenCalled();
  });
});
