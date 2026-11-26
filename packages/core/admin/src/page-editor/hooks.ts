// React hooks of the page editor. Both are safe under StrictMode (mount → cleanup → mount keeps working).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { resolvePage, writePageContent, type BlockRegistry, type ContentFetcher, type PuckData } from '@opencloudcms/core/blocks';
import type { Locale, PageKind, PageLayout } from '@opencloudcms/schema';
import { createAutosave, type Autosave, type AutosaveOptions, type AutosaveState } from './autosave';
import { loadBaseFrame } from './BaseFrame';
import type { BaseState } from './editor-context';
import { dataSignature, indexResolved, regionsIntoContent, type ResolvedItem } from './field-logic';

/** States in which leaving the editor may lose edits (pending, in flight, or not saved). */
export const UNSAVED_STATES: readonly AutosaveState[] = ['dirty', 'saving', 'error', 'conflict'];

/**
 * One autosave for the component's lifetime (create the component again, e.g. with a `key`, for another document).
 * Unmount and `beforeunload` flush; the instance is never disposed, so StrictMode's re-mount keeps saving.
 * `opts` is read once; `save` is always the latest one passed.
 */
export function useAutosave<T>(opts: AutosaveOptions<T>): { autosave: Autosave<T>; state: AutosaveState } {
  const saveRef = useRef(opts.save);
  saveRef.current = opts.save;
  const [autosave] = useState(() => createAutosave<T>({ ...opts, save: (d, m) => saveRef.current(d, m) }));
  const state = useSyncExternalStore(autosave.subscribe, () => autosave.state, () => autosave.state);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!UNSAVED_STATES.includes(autosave.state)) return;
      void autosave.flush();
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      void autosave.flush();
    };
  }, [autosave]);
  return { autosave, state };
}

/**
 * Resolved data-field values for the canvas: `schedule(data)` resolves 300 ms after the last change that touches a
 * data field (see `dataSignature`); `initial` is resolved on mount. Stale responses are dropped.
 */
export function usePreviewResolution(
  registry: BlockRegistry,
  initial: PuckData,
  fetcher: ContentFetcher,
  o: { locale: Locale; defaultLocale: Locale },
  debounceMs = 300,
): { resolved: ReadonlyMap<string, ResolvedItem>; schedule: (data: PuckData) => void } {
  const [resolved, setResolved] = useState<ReadonlyMap<string, ResolvedItem>>(() => new Map());
  const signature = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const { locale, defaultLocale } = o;

  const schedule = useCallback(
    (data: PuckData) => {
      const sig = dataSignature(data, registry);
      if (sig === signature.current) return;
      signature.current = sig;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        const n = ++seq.current;
        const content = writePageContent(regionsIntoContent(data), registry);
        void resolvePage(content, registry, fetcher, { locale, defaultLocale }).then(
          (out) => n === seq.current && setResolved(indexResolved(content.data as PuckData, out, registry)),
          () => undefined,
        );
      }, debounceMs);
    },
    [registry, fetcher, locale, defaultLocale, debounceMs],
  );

  useEffect(() => {
    schedule(initial);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      signature.current = ''; // the next mount (StrictMode, new deps) must schedule again
      seq.current++; // drop responses of this mount
    };
  }, [initial, schedule]);

  return { resolved, schedule };
}

/**
 * The base page framing the edited page (`BaseContext`): `layout` null → the default base page, `baseId: null` or a
 * base page being edited → none. `load` reads the base's draft in the page's locale (null when there is none).
 */
export function useBasePage(o: {
  kind: PageKind;
  layout: PageLayout;
  registry: BlockRegistry;
  fetcher: ContentFetcher;
  locale: Locale;
  defaultLocale: Locale;
  load: (id: string, locale: Locale) => Promise<{ content?: unknown; [k: string]: unknown } | null>;
}): BaseState {
  const { kind, registry, fetcher, locale, defaultLocale, load } = o;
  const key = kind === 'base' ? null : o.layout === null || o.layout.baseId === undefined ? 'default' : o.layout.baseId;
  const [state, setState] = useState<BaseState>(() => ({ kind, registry, locale, key, status: key === null ? 'none' : 'loading', frame: null, regions: [] }));
  useEffect(() => {
    const at = { kind, registry, locale, key };
    if (key === null) {
      setState({ ...at, status: 'none', frame: null, regions: [] });
      return;
    }
    let live = true;
    setState({ ...at, status: 'loading', frame: null, regions: [] });
    load(key, locale)
      .then(
        (entry): Promise<Pick<BaseState, 'status' | 'frame' | 'regions'>> | Pick<BaseState, 'status' | 'frame' | 'regions'> =>
          entry ? loadBaseFrame(entry.content, registry, fetcher, { locale, defaultLocale }) : { status: key === 'default' ? 'missing' : 'invalid', frame: null, regions: [] },
      )
      .then(
        (r) => live && setState({ ...at, ...r }),
        () => live && setState({ ...at, status: 'invalid', frame: null, regions: [] }),
      );
    return () => {
      live = false;
    };
  }, [kind, key, registry, fetcher, locale, defaultLocale, load]);
  return state;
}
