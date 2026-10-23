import { isLocale, matchLocale, type Locale } from '@opencms/schema';

export function resolveAdminLocale({
  userLocale,
  stored,
  browser,
}: {
  userLocale?: string | null;
  stored?: string | null;
  browser?: readonly string[];
}): Locale {
  if (isLocale(userLocale)) return userLocale;
  if (isLocale(stored)) return stored;
  return matchLocale(browser);
}

/**
 * Decides the first-render locale from client-only signals and whether a non-default bundle must load
 * before children render (so Login/Setup never flash English).
 */
export function initialLocaleState(input: {
  initialLocale?: Locale;
  stored?: string | null;
  browser?: readonly string[];
}): { locale: Locale; needsLoad: boolean } {
  const locale = input.initialLocale ?? resolveAdminLocale({ stored: input.stored, browser: input.browser });
  return { locale, needsLoad: locale !== 'en-US' };
}
