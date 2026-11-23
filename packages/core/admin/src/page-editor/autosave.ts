// Autosave state machine of the page editor. Pure (timers only); relative imports only (root vitest).

export type AutosaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error';

export interface AutosaveOptions<T> {
  /** Writes `data`; `ifMatch` is the `updatedAt` the client last saw (undefined: no optimistic check). */
  save(data: T, ifMatch: string | undefined): Promise<{ updatedAt: string }>;
  /** Quiet time after the last change before saving. Default 1500 ms. */
  debounceMs?: number;
  /** `updatedAt` of the loaded draft. */
  ifMatch?: string;
  /** Default: a 409 `stale_draft` error (`{ status: 409, code: 'stale_draft' }`). */
  isConflict?(error: unknown): boolean;
}

export interface Autosave<T> {
  /** Records new local data and (re)starts the debounce. In `conflict` it only keeps the data. */
  change(data: T): void;
  /** Saves pending data now (after any save in flight). Never rejects; read `state`/`error` afterwards. */
  flush(): Promise<void>;
  readonly state: AutosaveState;
  /** Last failure (`error` or `conflict` state), else null. */
  readonly error: unknown;
  /** `updatedAt` sent with the next save. */
  readonly ifMatch: string | undefined;
  /** Latest local data (kept on conflict). */
  readonly data: T | undefined;
  subscribe(listener: (state: AutosaveState) => void): () => void;
  /** Cancels a pending debounce; a save in flight still completes. */
  dispose(): void;
}

const defaultIsConflict = (e: unknown) =>
  !!e && typeof e === 'object' && (e as { status?: unknown }).status === 409 && (e as { code?: unknown }).code === 'stale_draft';

/**
 * Debounced saves with optimistic concurrency: each save sends the `updatedAt` returned by the previous one.
 * One save at a time; changes made meanwhile are saved after it. A 409 `stale_draft` stops saving for good
 * (`conflict`, the editor offers a reload); other failures go to `error` and are retried on the next change or flush.
 */
export function createAutosave<T>(opts: AutosaveOptions<T>): Autosave<T> {
  const debounceMs = opts.debounceMs ?? 1500;
  const isConflict = opts.isConflict ?? defaultIsConflict;
  const listeners = new Set<(s: AutosaveState) => void>();
  let state: AutosaveState = 'idle';
  let error: unknown = null;
  let ifMatch = opts.ifMatch;
  let latest: T | undefined;
  let hasPending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let disposed = false;

  const setState = (s: AutosaveState) => {
    if (s === state) return;
    state = s;
    for (const l of [...listeners]) l(s);
  };
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const run = (): Promise<void> => {
    if (!hasPending || state === 'conflict') return Promise.resolve();
    const data = latest as T;
    hasPending = false;
    error = null;
    setState('saving');
    const p = (async () => {
      // Yield first: `inFlight = p` below must be set before this body can reach `finally` (a save that throws
      // synchronously would otherwise leave `inFlight` set forever).
      await null;
      try {
        const r = await opts.save(data, ifMatch);
        ifMatch = r.updatedAt;
      } catch (e) {
        error = e;
        if (isConflict(e)) {
          hasPending = false;
          clearTimer();
          setState('conflict');
        } else {
          hasPending = true; // retried on the next change / flush, never by itself
          setState('error');
        }
        return;
      } finally {
        inFlight = null;
      }
      if (hasPending && !timer && !disposed) await run();
      else if (!hasPending) setState('saved');
      else setState('dirty');
    })();
    inFlight = p;
    return p;
  };

  const onTimer = () => {
    timer = null;
    if (!inFlight) void run(); // otherwise the save in flight picks the data up when it finishes
  };

  return {
    change(data) {
      latest = data;
      if (state === 'conflict' || disposed) return;
      hasPending = true;
      clearTimer();
      timer = setTimeout(onTimer, debounceMs);
      if (state !== 'saving') setState('dirty');
    },
    async flush() {
      clearTimer();
      while (inFlight) await inFlight;
      await run();
    },
    get state() {
      return state;
    },
    get error() {
      return error;
    },
    get ifMatch() {
      return ifMatch;
    },
    get data() {
      return latest;
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}
