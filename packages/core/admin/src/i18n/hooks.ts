'use client';

import { useContext, useMemo } from 'react';
import {
  createTranslator,
  formatDateTime as fmtDate,
  formatNumber as fmtNumber,
  type Locale,
  type MessageTree,
} from '@opencloudcms/schema';
import { LocaleContext } from './context';

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** Translator for a component- or plugin-owned bundle; falls back to the bundle's en-US. */
export function useTranslator(messages: { 'en-US': MessageTree } & Partial<Record<Locale, MessageTree>>) {
  const locale = useLocale();
  return useMemo(() => createTranslator(messages, locale), [messages, locale]);
}

export function useFormat() {
  const locale = useLocale();
  return useMemo(
    () => ({
      formatDateTime: (v: Date | string | number, opts?: Intl.DateTimeFormatOptions) => fmtDate(v, locale, opts),
      formatNumber: (v: number, opts?: Intl.NumberFormatOptions) => fmtNumber(v, locale, opts),
    }),
    [locale],
  );
}
