import type { Locale } from '@opencloudcms/schema';
import { api } from './api';

export interface LocalesResponse {
  supported: { code: Locale; name: string }[];
  locales: Locale[];
  defaultLocale: Locale;
  editable: boolean;
  entryCounts: Record<Locale, number>;
}

export interface LocaleSelection {
  locales: Locale[];
  defaultLocale: Locale;
}

export const fetchLocales = () => api<LocalesResponse>('/api/admin/locales');

export const saveLocales = (body: LocaleSelection & { confirmDisable?: Locale[] }) =>
  api<LocalesResponse>('/api/admin/locales', { method: 'PUT', json: body });

/** Locales being switched off that still hold entries; these need an explicit confirmation before saving. */
export function planLocaleChange(
  current: LocaleSelection,
  next: LocaleSelection,
  counts: Record<Locale, number>,
): { needsConfirm: Locale[] } {
  const needsConfirm = current.locales.filter((l) => !next.locales.includes(l) && (counts[l] ?? 0) > 0);
  return { needsConfirm };
}

/** Locale the content editor should use: the requested one when still enabled, else the default locale. */
export function pickEditorLocale(requested: string | null, enabled: readonly string[], defaultLocale: string): string {
  return requested && enabled.includes(requested) ? requested : defaultLocale;
}
