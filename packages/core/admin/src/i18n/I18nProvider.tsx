'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { isLocale, type Locale } from '@opencloudcms/schema';
import { LocaleContext } from './context';
import { loadMessages, setActiveMessages } from './index';
import { initialLocaleState } from './resolve';

const STORAGE_KEY = 'opencloudcms-locale';

let listener: ((l: Locale) => void) | null = null;

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Loads the bundle for `l`, persists the choice and re-renders the tree. */
export async function setAdminLocale(l: Locale): Promise<void> {
  if (!isLocale(l)) return;
  const messages = await loadMessages(l);
  setActiveMessages(l, messages);
  try {
    document.documentElement.lang = l;
  } catch {
    /* no document */
  }
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* storage unavailable */
  }
  listener?.(l);
}

export function I18nProvider({ initialLocale, children }: { initialLocale?: Locale; children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('en-US');
  // Server and first client render both output nothing, so there is no hydration mismatch and
  // no flash of the wrong language: children mount once the initial bundle is active.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    listener = setLocale;
    const { locale: initial } = initialLocaleState({
      initialLocale,
      stored: readStored(),
      browser: typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [],
    });
    let live = true;
    void setAdminLocale(initial).finally(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
      if (listener === setLocale) listener = null;
    };
  }, [initialLocale]);

  // Consumers (the route root calls useLocale) re-render on change; nothing is remounted.
  return <LocaleContext.Provider value={locale}>{ready ? children : null}</LocaleContext.Provider>;
}
