'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { isLocale, type Locale } from '@opencms/schema';
import { LocaleContext } from './context';
import { loadMessages, setActiveMessages } from './index';
import { resolveAdminLocale } from './resolve';

const STORAGE_KEY = 'opencms-locale';

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

  useEffect(() => {
    listener = setLocale;
    const initial =
      initialLocale ??
      resolveAdminLocale({
        stored: readStored(),
        browser: typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [],
      });
    void setAdminLocale(initial);
    return () => {
      if (listener === setLocale) listener = null;
    };
  }, [initialLocale]);

  // Keyed subtree: existing `t()` call sites re-run when the active bundle changes.
  return (
    <LocaleContext.Provider value={locale}>
      <div key={locale} style={{ display: 'contents' }}>
        {children}
      </div>
    </LocaleContext.Provider>
  );
}
